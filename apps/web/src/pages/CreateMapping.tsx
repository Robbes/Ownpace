// Copyright 2026 The Ownpace authors (Apache-2.0)
import React, { useState } from 'react';
import { useT, useLocale, useFormatters } from '../i18n/index.tsx';
import { probeText, qualificationEvidence, qualificationText, schedulingText } from '../i18n/probe-text.ts';
import type { StringKey } from '../i18n/index.tsx';
import { useNavigate, Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Server,
  Database,
  Settings,
  FileText,
  Calendar,
  Users,
  Folder,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react';
import {
  PROVIDER_ACCOUNT_DOMAINS,
  TARGET_TYPE_DOMAINS,
  sourceTypeDomains,
  sourceDomainRefusal,
  targetDomainRefusal,
  describeCronScheduleProblem,
  credentialFieldsFor,
  qualifiedAnswerFor,
  type CredentialField,
} from '@openmig/shared';
// The SAME cron library — same pinned version — the managed tick evaluates
// schedules with, so the "next syncs" echo below cannot disagree with what
// the scheduler will actually do.
import { Cron } from 'croner';
import {
  connectionsApi,
  mappingApi,
  providerAccountsApi,
  type ConnectionSummary,
  type TestConnectionResult,
} from '../services/mapping-service.ts';
import { duplicateMapping, serverMessage } from '../services/api.ts';
import { FrontDoorChooser } from '../components/FrontDoorChooser.tsx';
import { SOURCE_CARDS, TARGET_CARDS } from '../components/front-door-cards.ts';
import { useMutation } from '@tanstack/react-query';

type Step = 'source' | 'target' | 'migration' | 'review';

// Matches the shared/API domain enum so the wizard submits a schema-valid config.
type Domain = 'email' | 'calendar' | 'contact' | 'file';

interface FormData {
  name: string;
  sourceType: 'imap' | 'oauth2' | 'graph' | 'google-drive' | 'gmail' | 'google-calendar' | 'google-contacts' | 'google' | 'dropbox' | 'box';
  targetType: 'jmap' | 'imap' | 'caldav' | 'carddav' | 'webdav' | 'soverin';
  sourceHost: string;
  /** Kept as the raw INPUT string (0037 T3): parseInt on change turned a
   *  cleared field into NaN, which disabled Next with no clue — the honest
   *  state is "what was typed", validated where the gate can name it. */
  sourcePort: string;
  sourceUsername: string;
  sourcePassword: string;
  sourceSsl: boolean;
  /** The per-customer Entra app registration (0037 T6, owner decision
   *  2026-08-10; ADR-0006's row-14 model): oauth2/graph sources authenticate
   *  with the customer's OWN app — tenant + client id here, and the client
   *  secret beside the mailbox address on the same source step (0070). */
  sourceTenantId: string;
  sourceClientId: string;
  sourceClientSecret: string;
  /** Google Drive (workplan 0042): the delegated, read-only refresh token —
   *  docs/google-workspace-setup.md is where all three of its values come
   *  from, and the wizard says so beside the fields. */
  sourceRefreshToken: string;
  /** ADR-0033: a pasted key file selects domain-wide delegation. */
  sourceServiceAccountKey: string;
  /** Google Drive: root the migration somewhere other than My Drive. */
  sourceRootFolderId: string;
  /** Dropbox: root the migration at a folder ('' = the whole Dropbox). */
  sourceRootPath: string;
  /** Box (workplan 0056): the NUMERIC user id the CCG token reads for. */
  sourceBoxUserId: string;
  /**
   * What to CALL the connection this side saves (workplan 0076).
   *
   * Empty means "name it after what it connects to" — the auto-name below.
   * The owner asked for this at the moment of testing, which is also the
   * moment they know what it is for; a connection they cannot name is one
   * they cannot tell apart from the next one later (0069 T7b).
   */
  sourceConnectionName: string;
  targetConnectionName: string;
  /** Reuse a stored connection instead of re-typing its credentials (0064). */
  sourceConnectionId: string;
  targetConnectionId: string;
  targetHost: string;
  targetPort: string;
  /** DAV targets only (0105 T1): full DAV base URL; wins over host+port when set. */
  targetUrl: string;
  /** soverin only (0106 T4b): the account's IMAP host — typed, never guessed. */
  targetMailHost: string;
  targetMailPort: string;
  targetUsername: string;
  targetPassword: string;
  targetSsl: boolean;
  /** '' = merge into the account root (the default). See wizard.targetPrefix.hint. */
  targetFolderPrefix: string;
  domains: Domain[];
  schedule: string;
}

const initialFormData: FormData = {
  name: '',
  sourceType: 'imap',
  targetType: 'jmap',
  sourceHost: '',
  sourcePort: '993',
  sourceUsername: '',
  sourcePassword: '',
  sourceSsl: true,
  sourceTenantId: '',
  sourceClientId: '',
  sourceClientSecret: '',
  sourceRefreshToken: '',
  sourceServiceAccountKey: '',
  sourceRootFolderId: '',
  sourceRootPath: '',
  sourceBoxUserId: '',
  sourceConnectionName: '',
  targetConnectionName: '',
  sourceConnectionId: '',
  targetConnectionId: '',
  targetHost: '',
  targetPort: '443',
  targetUrl: '',
  targetMailHost: '',
  targetMailPort: '',
  targetUsername: '',
  targetPassword: '',
  targetSsl: true,
  targetFolderPrefix: '',
  domains: ['email'],
  schedule: '',
};

/**
 * The `connection.kind` a wizard source type stores as — the client half of
 * the server's `sourceKindFor`, so the picker only offers connections that
 * would actually work for the selected source.
 */
function sourceKindOf(sourceType: string): string {
  if (sourceType === 'google-drive') return 'google_drive';
  if (sourceType === 'google-calendar') return 'google_calendar';
  if (sourceType === 'google-contacts') return 'google_contacts';
  if (sourceType === 'gmail') return 'gmail';
  // The account kind's wizard word and connection kind are the same word,
  // so this is an identity — spelled out because the ones around it are not.
  if (sourceType === 'google') return 'google';
  if (sourceType === 'dropbox') return 'dropbox';
  if (sourceType === 'box') return 'box';
  return sourceType === 'imap' ? 'imap' : 'o365';
}

/**
 * The Google ACCOUNT card's hint where the deployment's own application
 * carries the restricted scopes (ADR-0041). Declared `StringKey` rather than
 * cast at the call site: a typo is then a build error, where a cast would have
 * shipped a card rendering its own key name.
 */
const RESTRICTED_GOOGLE_HINT: StringKey = 'wizard.proto.google.hint.restricted';

const steps: { id: Step; nameKey: StringKey; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
  // Four steps, not six (workplan 0070): each side carries its own
  // credentials and is finished when it tests, so what is left is one step for
  // what is true of the migration itself.
  { id: 'source', nameKey: 'wizard.step.source', icon: Server },
  { id: 'target', nameKey: 'wizard.step.target', icon: Database },
  { id: 'migration', nameKey: 'wizard.step.migration', icon: Settings },
  { id: 'review', nameKey: 'wizard.step.review', icon: Check },
];

const dataTypes: {
  id: Domain;
  nameKey: StringKey;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  hintKey: StringKey;
}[] = [
  { id: 'email', nameKey: 'domain.email', icon: FileText, hintKey: 'wizard.domain.email.hint' },
  { id: 'calendar', nameKey: 'domain.calendar', icon: Calendar, hintKey: 'wizard.domain.calendar.hint' },
  { id: 'contact', nameKey: 'domain.contact', icon: Users, hintKey: 'wizard.domain.contact.hint' },
  { id: 'file', nameKey: 'domain.file', icon: Folder, hintKey: 'wizard.domain.file.hint' },
];

/** The sources whose credentials can be minted by the clickable consent
 *  (0089 T1) — exactly the four that authenticate with a Google OAuth
 *  client, spelled out rather than derived: `isGoogleSource` includes
 *  Dropbox for credential-SHAPE reasons, which is not this question. */
const GOOGLE_CONSENT_SOURCES: ReadonlyArray<string> = [
  'gmail',
  'google-calendar',
  'google-contacts',
  'google-drive',
  // The ACCOUNT (0106 T3b). Same button, different ask: the four above each
  // consent to one fixed scope, and this one consents to exactly the faces
  // ticked on the next step — which is why the button below is disabled
  // until something is ticked, rather than sending an empty consent the
  // server would refuse.
  'google',
];

const isValidPort = (raw: string): boolean => {
  if (!/^\d+$/.test(raw)) return false;
  const n = Number(raw);
  return n >= 1 && n <= 65535;
};

/**
 * What to forget when the source provider changes (workplan 0068).
 *
 * The per-provider inputs share form fields underneath — Box's client id and
 * Dropbox's "App key" are both `sourceClientId` — so switching provider used to
 * carry the old value across and present it under the new provider's label. The
 * owner found it by typing a Box client id and then seeing it waiting in
 * Dropbox's App-sleutel field.
 *
 * `sourceConnectionId` is the one that matters beyond tidiness. The picker only
 * OFFERS connections whose kind matches the selected type, but a stored id
 * survived a provider switch, and the create route verifies a reused
 * connection's tenant and role — not its kind. So choosing a Box connection and
 * then switching to Dropbox could submit a Box connection for a Dropbox mapping.
 * Clearing it here closes that; the route ought to check kind too, which is
 * noted in the workplan rather than fixed blind.
 *
 * Deliberately NOT cleared: `name`, `sourceUsername`, the domains and the
 * schedule. Those are answers about this migration that survive a change of
 * provider, and re-typing them is the annoyance this function exists to reduce.
 */
function clearedSourceFields(prev: FormData, next: string): Partial<FormData> {
  if (prev.sourceType === next) return {};
  return {
    sourceHost: '',
    sourcePort: '993',
    sourcePassword: '',
    sourceTenantId: '',
    sourceClientId: '',
    sourceClientSecret: '',
    sourceRefreshToken: '',
    sourceServiceAccountKey: '',
    sourceRootFolderId: '',
    sourceRootPath: '',
    sourceBoxUserId: '',
    sourceConnectionId: '',
  };
}

/** The red asterisk beside a gating field's label (0037 T3). */
const Required: React.FC = () => (
  <span className="text-red-500" aria-hidden="true">
    {' '}
    *
  </span>
);

/**
 * "Use one you already have" (workplans 0064, 0067). Renders nothing when
 * there is nothing to reuse, so a first-time tenant never sees an empty
 * shortcut. Lives on the step whose credential fields it replaces — see the
 * comment at its source-step call site for why that placement is the feature.
 */
const ConnectionPicker: React.FC<{
  labelKey: StringKey;
  options: ConnectionSummary[];
  value: string;
  onChange: (id: string) => void;
}> = ({ labelKey, options, value, onChange }) => {
  const t = useT();
  if (options.length === 0) return null;
  return (
    <div className="border border-gray-200 rounded-lg p-4 mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">{t(labelKey)}</label>
      <select className="input w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('wizard.reuseNone')}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName} ({c.kind})
          </option>
        ))}
      </select>
      <p className="mt-1 text-sm text-gray-500">{t('wizard.reuse.hint')}</p>
    </div>
  );
};

/**
 * The half of the wizard that is safe to remember (workplan 0069).
 *
 * The credentials are now kept as a stored CONNECTION once they test — see
 * `runProbes` — which leaves the cheap half: a name, which accounts, the
 * domains and a schedule. Those are seconds to retype and worth nothing to an
 * attacker, so they survive a navigation in `sessionStorage`.
 *
 * **The secrets are deliberately absent from this list, and that is the point.**
 * Writing a half-typed client secret or mailbox password into web storage would
 * hand every script on the page a credential the product otherwise only ever
 * holds encrypted, server-side. `sessionStorage` also dies with the tab, so an
 * abandoned draft does not outlive the sitting.
 */
const DRAFT_KEY = 'wizard.draft.v1';
const DRAFT_FIELDS = [
  'name',
  'sourceType',
  'targetType',
  'sourceUsername',
  'targetUsername',
  'sourceConnectionId',
  'targetConnectionId',
  'sourceConnectionName',
  'targetConnectionName',
  'sourceHost',
  'sourcePort',
  'sourceRootFolderId',
  'sourceRootPath',
  'sourceBoxUserId',
  'sourceTenantId',
  'targetHost',
  'targetPort',
  'targetUrl',
  'targetMailHost',
  'targetMailPort',
  'targetFolderPrefix',
  'domains',
  'schedule',
] as const;

function restoreDraft(): FormData {
  try {
    const raw = globalThis.sessionStorage?.getItem(DRAFT_KEY);
    if (!raw) return initialFormData;
    const saved = JSON.parse(raw) as Partial<FormData>;
    const picked = Object.fromEntries(
      DRAFT_FIELDS.filter((k) => saved[k] !== undefined).map((k) => [k, saved[k]]),
    );
    return { ...initialFormData, ...picked };
  } catch {
    // A malformed draft is not worth a broken wizard.
    return initialFormData;
  }
}

function saveDraft(form: FormData): void {
  try {
    const picked = Object.fromEntries(DRAFT_FIELDS.map((k) => [k, form[k]]));
    globalThis.sessionStorage?.setItem(DRAFT_KEY, JSON.stringify(picked));
  } catch {
    // Private mode, quota, no storage at all — the wizard still works.
  }
}

export function clearDraft(): void {
  try {
    globalThis.sessionStorage?.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
}

const CreateMapping: React.FC = () => {
  const { t, locale } = useLocale();
  const { dateTime } = useFormatters();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(restoreDraft);
  const [showSourcePassword, setShowSourcePassword] = useState(false);
  const [showTargetPassword, setShowTargetPassword] = useState(false);

  const createMutation = useMutation({
    mutationFn: mappingApi.create,
    // 0013 T6 via a real URL (0037 T2): the confirm/green-light screen used
    // to be swapped in as component state, which no route reached — a refresh
    // stranded the paused mapping. Navigating gives the green light an
    // address that survives the wizard.
    onSuccess: (mapping: { id: string }) => {
      // The draft has become a migration; keeping it would re-seed the next
      // wizard with the last one's name and schedule.
      clearDraft();
      void navigate(`/mappings/${mapping.id}/confirm`);
    },
  });

  // Remember the safe half as it is typed (workplan 0069). Cheap to write, and
  // it means a navigation costs a name and a schedule rather than everything.
  React.useEffect(() => {
    saveDraft(formData);
  }, [formData]);

  /** Set when the refusal is "this migration already exists" (0071 T6). */
  const duplicate = createMutation.isError ? duplicateMapping(createMutation.error) : null;

  // Leaving a dirty wizard is a question, not a silent discard (0037 T5).
  // All wizard state is plain useState, so refresh/close throws away every
  // step of typed input; beforeunload covers those, and handleBack's
  // confirm covers the in-app Cancel. (A full in-app navigation blocker
  // needs a data router this app does not use yet.)
  const dirty = JSON.stringify(formData) !== JSON.stringify(initialFormData);
  React.useEffect(() => {
    if (!dirty || createMutation.isSuccess) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy engines ignore preventDefault without a returnValue.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, createMutation.isSuccess]);

  // What can be reused. Failing to load them must not block the wizard — the
  // form still works, it just cannot offer the shortcut (workplan 0064).
  const { data: existingConnections } = useQuery<ConnectionSummary[]>({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
    retry: false,
  });
  /**
   * WHAT ONE GOOGLE ACCOUNT MAY SERVE HERE (ADR-0041, owner decision
   * 2026-09-01) — asked, not compiled in.
   *
   * A deployment whose own Google application carries the restricted scopes
   * declares `GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`, and the API then builds
   * a four-face consent. That declaration is read at run time; this bundle was
   * built before it, so a constant here would offer two ticks against a server
   * willing to ask for four — the half-reachable feature this replaces.
   *
   * FALLS BACK TO THE NARROW ANSWER, and every failure falls back with it: an
   * unreachable route, a shape this build does not recognise, a request still
   * in flight. Over-offering is the one direction that costs something — a
   * tick the create door then refuses — so the default is the one that cannot.
   */
  const { data: providerAccounts } = useQuery({
    queryKey: ['provider-accounts'],
    queryFn: providerAccountsApi.get,
    retry: false,
    staleTime: Infinity,
  });
  const googleAccountDomains = providerAccounts?.google?.domains ?? PROVIDER_ACCOUNT_DOMAINS.google;
  /**
   * Does this deployment carry its own Google OAuth client (ADR-0041, owner
   * decision 2026-09-01)? The server has accepted a consent and a create
   * without a client id and secret since the pair became configurable; this
   * screen kept demanding both, because nothing had told it. Same fact, same
   * route, same default as the domains above: until the answer arrives the
   * pair is asked for — the direction that cannot under-ask.
   */
  const deploymentGoogleClient = providerAccounts?.google?.client === 'deployment';

  const reusableSources = (existingConnections ?? []).filter(
    (c) => c.role === 'source' && c.kind === sourceKindOf(formData.sourceType),
  );
  // Target kinds ARE the wizard's target types (jmap/imap/caldav/carddav/
  // webdav are all valid connection kinds), so no mapping is needed here.
  const reusableTargets = (existingConnections ?? []).filter(
    (c) => c.role === 'target' && c.kind === formData.targetType,
  );

  // The config shapes, shared by submit AND the connection test (workplan
  // 0046) — the probe must run on exactly what create would post, or "test
  // passed, create failed" becomes possible by construction.
  const builtSourceConfig = () =>
    isDropboxSource
          ? {
              username: formData.sourceUsername,
              clientId: formData.sourceClientId,
              clientSecret: formData.sourceClientSecret,
              refreshToken: formData.sourceRefreshToken,
              ...(formData.sourceRootPath.trim()
                ? { rootPath: formData.sourceRootPath.trim() }
                : {}),
            }
          : isBoxSource
          ? {
              username: formData.sourceUsername,
              clientId: formData.sourceClientId,
              clientSecret: formData.sourceClientSecret,
              userId: formData.sourceBoxUserId.trim(),
              ...(formData.sourceRootFolderId.trim()
                ? { rootFolderId: formData.sourceRootFolderId.trim() }
                : {}),
            }
          : isDriveSource
          ? {
              username: formData.sourceUsername,
              clientId: formData.sourceClientId,
              clientSecret: formData.sourceClientSecret,
              refreshToken: formData.sourceRefreshToken,
              ...(formData.sourceServiceAccountKey.trim()
                ? { serviceAccountKey: formData.sourceServiceAccountKey }
                : {}),
              ...(formData.sourceRootFolderId.trim()
                ? { rootFolderId: formData.sourceRootFolderId.trim() }
                : {}),
            }
          : isGmailSource || isGoogleDavSource || isGoogleAccountSource
          ? {
              // The account kind (0106 T4) carries the same OAuth trio as
              // Gmail and the DAV kinds — one client, one token, every domain.
              // It fell through to the server-shaped default below until
              // 2026-09-02, so the owner's first consented account was stored
              // as host/port/password with no token, and its first test said
              // "missing refreshToken" about a token the consent had just
              // handed over.
              username: formData.sourceUsername,
              clientId: formData.sourceClientId,
              clientSecret: formData.sourceClientSecret,
              refreshToken: formData.sourceRefreshToken,
              ...(formData.sourceServiceAccountKey.trim()
                ? { serviceAccountKey: formData.sourceServiceAccountKey }
                : {}),
            }
          : isO365Source
          ? {
              username: formData.sourceUsername,
              tenantId: formData.sourceTenantId,
              clientId: formData.sourceClientId,
              clientSecret: formData.sourceClientSecret,
            }
          : {
              host: formData.sourceHost,
              port: Number(formData.sourcePort),
              username: formData.sourceUsername,
              password: formData.sourcePassword,
              useSsl: formData.sourceSsl,
            };
  const builtTargetConfig = () => ({
    host: formData.targetHost,
    port: Number(formData.targetPort),
    username: formData.targetUsername,
    password: formData.targetPassword,
    useSsl: formData.targetSsl,
    ...(formData.targetUrl.trim() ? { url: formData.targetUrl.trim() } : {}),
    ...(formData.targetMailHost.trim()
      ? {
          mailHost: formData.targetMailHost.trim(),
          ...(formData.targetMailPort.trim()
            ? { mailPort: Number(formData.targetMailPort) }
            : {}),
        }
      : {}),
  });

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Submit form. An oauth2/graph source posts its app registration
      // instead of a server address — the server refuses the mismatch by
      // name, so the shapes here mirror CreateMappingSchema's demands.
      const mappingData = {
        name: formData.name,
        sourceType: formData.sourceType,
        targetType: formData.targetType,
        // Reuse rather than re-create: the server then takes credentials from
        // the stored connection and demands none here (workplan 0064).
        ...(formData.sourceConnectionId ? { sourceConnectionId: formData.sourceConnectionId } : {}),
        ...(formData.targetConnectionId ? { targetConnectionId: formData.targetConnectionId } : {}),
        sourceConfig: builtSourceConfig(),
        targetConfig: builtTargetConfig(),
        syncConfig: {
          domains: formData.domains,
          schedule: formData.schedule || '0 2 * * *',
        },
        ...(formData.targetFolderPrefix.trim()
          ? { targetFolderPrefix: formData.targetFolderPrefix.trim() }
          : {}),
      };
      createMutation.mutate(mappingData);
    }
  };

  // The shared-drive browse (workplan 0049): fills rootFolderId from
  // drives.list instead of a paste out of the admin console. Rendered with
  // the source credentials, because that is where the three values it needs
  // are typed; the id it picks lands in the rootFolderId field beside them.
  const [sharedDrives, setSharedDrives] = React.useState<
    Array<{ id: string; name: string }> | null
  >(null);
  // Folders other accounts shared with the credential (workplan 0051) — the
  // browse's second half, fetched by the same click: both lists answer the
  // same onboarding question, "which id goes in rootFolderId?".
  const [sharedFolders, setSharedFolders] = React.useState<
    Array<{ id: string; name: string; owner?: string }> | null
  >(null);
  const [sharedDrivesError, setSharedDrivesError] = React.useState<string | null>(null);
  const [browsing, setBrowsing] = React.useState(false);
  /**
   * The client pair as a whole or not at all (ADR-0041): absent, the server
   * uses the deployment's own — the consent and the browse resolve it the
   * same way. Never as empty strings, which the routes' schemas refuse; half
   * a pair never gets this far, because the buttons refuse it first.
   */
  const ownGoogleClient =
    formData.sourceClientId.trim() && formData.sourceClientSecret.trim()
      ? { clientId: formData.sourceClientId.trim(), clientSecret: formData.sourceClientSecret }
      : {};
  const browseSharedDrives = () => {
    setBrowsing(true);
    setSharedDrivesError(null);
    const creds = { ...ownGoogleClient, refreshToken: formData.sourceRefreshToken };
    void Promise.allSettled([
      mappingApi.listSharedDrives(creds),
      mappingApi.listSharedFolders(creds),
    ])
      .then(([drives, folders]) => {
        // A refusal on either half is shown verbatim; the half that answered
        // still renders — one bad scope must not blank the whole picker.
        const reasons: string[] = [];
        if (drives.status === 'fulfilled') {
          if (drives.value.ok) setSharedDrives([...drives.value.drives]);
          else reasons.push(drives.value.reason);
        } else reasons.push(serverMessage(drives.reason));
        if (folders.status === 'fulfilled') {
          if (folders.value.ok) setSharedFolders([...folders.value.folders]);
          else reasons.push(folders.value.reason);
        } else reasons.push(serverMessage(folders.reason));
        if (reasons.length > 0) setSharedDrivesError(reasons.join(' '));
      })
      .finally(() => setBrowsing(false));
  };

  // Dropbox's turn at the same browse (workplan 0055 follow-up): the shared
  // folders the credential can see, from sharing/list_folders. Only a MOUNTED
  // folder has a path to put in rootPath; an unmounted one is listed disabled
  // so the owner knows it exists — mounting happens in Dropbox itself.
  const [dropboxFolders, setDropboxFolders] = React.useState<
    Array<{ id: string; name: string; path?: string }> | null
  >(null);
  const [dropboxFoldersError, setDropboxFoldersError] = React.useState<string | null>(null);
  const browseDropboxFolders = () => {
    setBrowsing(true);
    setDropboxFoldersError(null);
    mappingApi
      .listDropboxSharedFolders({
        clientId: formData.sourceClientId,
        clientSecret: formData.sourceClientSecret,
        refreshToken: formData.sourceRefreshToken,
      })
      .then((result) => {
        // A refusal (a missing sharing.read scope, most likely) arrives in
        // Dropbox's own words and is shown verbatim.
        if (result.ok) setDropboxFolders([...result.folders]);
        else setDropboxFoldersError(result.reason);
      })
      .catch((err) => setDropboxFoldersError(serverMessage(err)))
      .finally(() => setBrowsing(false));
  };

    // The connection test (workplan 0046): both sides probed in parallel,
  // read-only, results shown verbatim — the same sentence the first pass
  // would have failed with, before anything exists.
  const [probing, setProbing] = React.useState(false);
  const [probeResults, setProbeResults] = React.useState<{
    source?: TestConnectionResult;
    target?: TestConnectionResult;
  }>({});
  /**
   * A side's typed credentials, keyed the way the shared descriptor keys them
   * (workplan 0069). The wizard's form fields are prefixed by side; the
   * descriptor is not, so this is the one place the two vocabularies meet.
   */
  const credentialValuesFor = (role: 'source' | 'target'): Record<string, string> => {
    const from: Record<string, string> =
      role === 'source'
        ? {
            username: formData.sourceUsername,
            password: formData.sourcePassword,
            host: formData.sourceHost,
            port: formData.sourcePort,
            tenantId: formData.sourceTenantId,
            clientId: formData.sourceClientId,
            clientSecret: formData.sourceClientSecret,
            refreshToken: formData.sourceRefreshToken,
            serviceAccountKey: formData.sourceServiceAccountKey,
            rootFolderId: formData.sourceRootFolderId,
            rootPath: formData.sourceRootPath,
            userId: formData.sourceBoxUserId,
          }
        : {
            username: formData.targetUsername,
            password: formData.targetPassword,
            host: formData.targetHost,
            port: formData.targetPort,
            url: formData.targetUrl,
            mailHost: formData.targetMailHost,
            mailPort: formData.targetMailPort,
          };
    // Only what this provider actually asks for, and only what was filled in:
    // posting an empty optional would store "" where the connector expects the
    // key to be absent.
    const wanted = credentialFieldsFor(role, role === 'source' ? formData.sourceType : formData.targetType);
    return Object.fromEntries(
      wanted.map((f) => [f.key, from[f.key] ?? '']).filter(([, v]) => v !== ''),
    );
  };

  /**
   * Test, and KEEP what works (owner request, workplan 0069).
   *
   * The probe used to be transient: it told you the credentials were good and
   * then threw them away with the rest of the form the moment you navigated
   * anywhere. Since the expensive half of this wizard is the credentials — and
   * a connection is already a first-class thing that can be probed, stored and
   * reused — testing now SAVES. A side that passes becomes a stored connection
   * and the wizard holds only its id, so leaving and coming back costs you a
   * name and a schedule instead of another trip to somebody's admin console.
   *
   * Retrying rotates the SAME row rather than adding another. The add route
   * stores a failing credential deliberately (somebody mid-setup waiting on an
   * admin should not lose it), which without this would leave a trail of broken
   * connections behind every corrected typo. Rotation also probes before it
   * replaces, so a worse second attempt cannot destroy a working first one.
   */
  const [draftConnection, setDraftConnection] = React.useState<{
    source?: string;
    target?: string;
  }>({});

  /**
   * Forget a side's probe result (workplan 0073).
   *
   * A result is a statement about ONE credential, and nothing used to retire
   * it: the green "the credentials still work" from the connection you tested
   * stayed on screen after you picked a different connection from the picker,
   * and even after you switched provider entirely. The owner watched a
   * Dropbox verdict sit above a different source type. That is worse than no
   * verdict — it is a verdict about something else, and the whole point of
   * this button is to let somebody trust what it says.
   *
   * Called where the SUBJECT changes (provider, or chosen connection), not
   * from an effect: `runProbe` itself sets `sourceConnectionId` when a probe
   * saves, and an effect keyed on that would wipe the result it just earned.
   */
  const forgetProbe = (side: 'source' | 'target') =>
    setProbeResults((prev) => ({ ...prev, [side]: undefined }));

  /** What this side will be saved as: what was typed, else what it connects to. */
  const connectionNameFor = (role: 'source' | 'target'): string => {
    const typed = (role === 'source' ? formData.sourceConnectionName : formData.targetConnectionName).trim();
    if (typed) return typed;
    const type = role === 'source' ? formData.sourceType : formData.targetType;
    const who = role === 'source' ? formData.sourceUsername : formData.targetUsername;
    return who ? `${type} · ${who}` : type;
  };

  /**
   * Is that name already taken? (workplan 0076.)
   *
   * A WARNING, not a refusal. Two connections may legitimately share a name —
   * nothing keys off it — but the owner met two called `dropbox · anna@…` and
   * said it plainly: *that is asking for issues*. A name exists to tell things
   * apart, so a collision is worth saying at the moment it is created rather
   * than discovering it in a picker a week later. Blocking the save would be
   * friction at the worst possible moment: you have just proved a credential.
   */
  const connectionNameTaken = (role: 'source' | 'target'): boolean => {
    const chosen = role === 'source' ? formData.sourceConnectionId : formData.targetConnectionId;
    if (chosen) return false;
    const name = connectionNameFor(role);
    return (existingConnections ?? []).some((c) => c.role === role && c.displayName === name);
  };

  const runProbe = (only?: 'source' | 'target') => {
    setProbing(true);

    const saveSide = async (role: 'source' | 'target'): Promise<TestConnectionResult> => {
      const chosen = role === 'source' ? formData.sourceConnectionId : formData.targetConnectionId;
      /**
       * Reusing a stored connection: probe THE STORED CREDENTIAL, by id
       * (workplan 0072).
       *
       * This used to post `builtSourceConfig()` — values read out of the form.
       * But choosing a stored connection is exactly what HIDES those inputs, so
       * the form holds empty strings, and the probe refused every time with
       * *clientId, clientSecret, refreshToken are not set* — a sentence about
       * fields the person was deliberately not asked for. Testing a reused
       * connection could therefore never pass, which is the one thing the
       * reuse path most needs to be able to prove before you commit to it.
       *
       * `POST /connections/:id/test` is the route that decrypts and probes what
       * is actually stored; the Connections page has used it since 0062. There
       * is nothing of ours to save here either way, so this stays the plain
       * read-only check it was always described as.
       */
      if (chosen) {
        return connectionsApi.test(chosen);
      }

      const values = credentialValuesFor(role);
      const type = role === 'source' ? formData.sourceType : formData.targetType;
      const existing = draftConnection[role];

      if (existing) {
        const rotated = await connectionsApi.rotate(existing, values);
        if (rotated.ok) updateField(role === 'source' ? 'sourceConnectionId' : 'targetConnectionId', existing);
        return rotated;
      }

      const added = await connectionsApi.add({
        role,
        type,
        // What the person called it, or — failing that — what it connects to.
        // Never the migration's name: the migration does not exist yet at this
        // point in the wizard, and the connection outlives it anyway.
        displayName: connectionNameFor(role),
        values,
      });
      setDraftConnection((d) => ({ ...d, [role]: added.id }));
      if (added.ok) {
        updateField(role === 'source' ? 'sourceConnectionId' : 'targetConnectionId', added.id);
      }
      return added;
    };

    const asResult = (settled: PromiseSettledResult<TestConnectionResult>): TestConnectionResult =>
      settled.status === 'fulfilled'
        ? settled.value
        : { ok: false, reason: serverMessage(settled.reason) };

    // One side at a time now that each has its own step (workplan 0070):
    // probing the other would report on credentials the person has not been
    // asked for yet.
    const sides: Array<'source' | 'target'> = only ? [only] : ['source', 'target'];
    void Promise.allSettled(sides.map(saveSide))
      .then((settled) =>
        setProbeResults((prev) => ({
          ...prev,
          ...Object.fromEntries(sides.map((side, i) => [side, asResult(settled[i]!)])),
        })),
      )
      .finally(() => {
        setProbing(false);
        // The pickers on steps 1 and 2 read this list; a connection saved here
        // must appear there if the person walks back.
        void queryClient.invalidateQueries({ queryKey: ['connections'] });
      });
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else {
      if (dirty && !window.confirm(t('wizard.leaveConfirm'))) return;
      void navigate('/mappings');
    }
  };

  const updateField = (field: keyof FormData, value: string | number | boolean | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  /**
   * The clickable consent's landing (workplan 0089 T1). The popup's result
   * page posts the refresh token back to THIS window; through the /api
   * proxy both share an origin, and only same-origin messages of the flow's
   * own shape are trusted. The token lands in the SAME field a pasted one
   * does — storage, probing and create see no difference (ADR-0037).
   */
  const [googleConsent, setGoogleConsent] = React.useState<string | null>(null);
  /** The callback address the last consent asked Google to return to. */
  const [googleRedirect, setGoogleRedirect] = React.useState<string | null>(null);
  /**
   * ONE GO (owner remark 2026-09-02, after the first working round trip):
   * "I would expect an automatic save — the app did receive the grant — and
   * the connection tested." The consent used to land the token in a box
   * behind a fold and leave the person on the same screen with the same
   * button, which read as nothing having happened. So a consent that lands
   * runs the source probe at once — the same probe the Test button runs,
   * which saves the connection and reports what it can carry.
   *
   * A counter rather than the 'received' flag: a second consent in the same
   * sitting must run the probe again, and a flag that is already set would
   * not fire the effect.
   */
  const [consentLanded, setConsentLanded] = React.useState(0);
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; refreshToken?: string } | null;
      if (event.origin !== window.location.origin) return;
      if (!data || data.type !== 'ownpace-google-consent') return;
      if (typeof data.refreshToken !== 'string' || data.refreshToken.length === 0) return;
      setFormData((prev) => ({ ...prev, sourceRefreshToken: data.refreshToken as string }));
      setGoogleConsent('received');
      setConsentLanded((n) => n + 1);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  // The probe of THIS render, so the effect below never runs a stale one.
  const runProbeRef = React.useRef<(only?: 'source' | 'target') => void>(() => {});
  runProbeRef.current = runProbe;
  React.useEffect(() => {
    if (consentLanded > 0) runProbeRef.current('source');
  }, [consentLanded]);

  const startGoogleConsent = async () => {
    setGoogleConsent(null);
    try {
      // The ACCOUNT asks for exactly the faces ticked (workplan 0106 T3b);
      // the four single-purpose sources ask for their own one scope. The
      // domain set is sent rather than a source type, so the consent screen
      // and the ticks cannot disagree — and the server refuses an empty set
      // rather than substituting a default, which is why the button is
      // disabled until something is ticked.
      const { url, redirectUri } = await mappingApi.googleAuthorize(
        isGoogleAccountSource
          ? {
              domains: formData.domains,
              ...ownGoogleClient,
            }
          : {
              sourceType: formData.sourceType as
                | 'gmail'
                | 'google-calendar'
                | 'google-contacts'
                | 'google-drive',
              ...ownGoogleClient,
            },
      );
      /**
       * THE ADDRESS THIS CONSENT USED, kept rather than discarded.
       *
       * The route has always answered with `redirectUri` — the exact string
       * Google matches against the client's registered list — and this handler
       * destructured only `url` and threw it away. So the one value somebody
       * needs in order to register the callback was computed, returned, and
       * never shown.
       *
       * The owner met the consequence on 2026-09-01: Google answered
       * `Fout 400: redirect_uri_mismatch`, which says a string did not match
       * and does not say what the string was. Registering the right one meant
       * reading a route's source.
       *
       * Shown on every attempt, not only on failure, because it has to be
       * registered BEFORE the first one can work.
       */
      setGoogleRedirect(redirectUri ?? null);
      window.open(url, 'ownpace-google-consent', 'popup,width=520,height=640');
    } catch (error) {
      setGoogleConsent(serverMessage(error));
    }
  };

  const toggleDomain = (domain: Domain) => {
    setFormData((prev) => ({
      ...prev,
      domains: prev.domains.includes(domain)
        ? prev.domains.filter((d) => d !== domain)
        : [...prev.domains, domain],
    }));
  };

  // The data types the chosen target protocol can actually receive AND the
  // chosen source can provide — the shared matrices the create API refuses
  // against (0037 T4; 0042 for the source side; ADR-0026's one contract): the
  // wizard constrains the choice, the server refuses it verbatim for any
  // other client.
  const sourceAllowed = sourceTypeDomains(formData.sourceType, googleAccountDomains);
  const allowedDomains = TARGET_TYPE_DOMAINS[formData.targetType].filter(
    (d) => !sourceAllowed || sourceAllowed.includes(d),
  );

  // The chosen target ACCOUNT's measured record (0106 T3a): a reused
  // connection's stored qualification, or — for freshly typed credentials —
  // what the last Test measured. It refines the domain step BENEATH the
  // static matrix: a measured no locks the tick carrying the account's own
  // evidence, unknown stays tickable with the unmeasured hint, and an
  // absent record changes nothing (unqualified is not disqualified).
  const targetQualification =
    (formData.targetConnectionId
      ? reusableTargets.find((c) => c.id === formData.targetConnectionId)?.qualification
      : undefined) ?? probeResults.target?.qualification;
  const measuredAnswerFor = (d: Domain) => qualifiedAnswerFor(targetQualification, d);

  // oauth2/graph authenticate with the customer's own Entra app registration
  // (0037 T6): no host/port to type, an app registration to enter instead.
  // google-drive authenticates with the customer's own Google OAuth client
  // (workplan 0042) — a THIRD shape, not a variant of the O365 one: it has a
  // refresh token and no tenant.
  const isO365Source = formData.sourceType === 'oauth2' || formData.sourceType === 'graph';
  const isDriveSource = formData.sourceType === 'google-drive';
  // Dropbox rides the same credential trio (its App key/secret in the client
  // fields — the create schema's dropbox refusal names the mapping).
  const isDropboxSource = formData.sourceType === 'dropbox';
  // gmail (workplan 0044) shares Drive's credential SHAPE — a Google OAuth
  // client and a refresh token — but not its domain: the token is consented
  // with the mail scope, so the source serves email and nothing else.
  const isGmailSource = formData.sourceType === 'gmail';
  // The Google DAV pair (workplan 0045): CalDAV/CardDAV transports, the same
  // Google credential shape as Drive and Gmail, one pinned domain each.
  const isGoogleDavSource =
    formData.sourceType === 'google-calendar' || formData.sourceType === 'google-contacts';
  // One Google ACCOUNT (workplan 0106 T3b): the same credential trio as the
  // four above — one OAuth client, one refresh token — and the only one whose
  // consent asks for a SET of scopes, decided by the domains ticked.
  const isGoogleAccountSource = formData.sourceType === 'google';
  const isGoogleSource =
    isDriveSource || isGmailSource || isGoogleDavSource || isGoogleAccountSource || isDropboxSource;
  // Box (workplan 0056) is deliberately NOT in the refresh-token group: it
  // uses the Client Credentials Grant (Box rotates refresh tokens, so none is
  // stored) — client id + secret plus the numeric subject user id.
  const isBoxSource = formData.sourceType === 'box';
  // The kinds the deployment's client can stand in for: Google's own, and NOT
  // Dropbox, which rides the same three field names with its own app pair.
  const isGoogleGrantSource =
    isDriveSource || isGmailSource || isGoogleDavSource || isGoogleAccountSource;
  // One half of a pair typed is a pair being typed, not a pair left to the
  // deployment: the server fills only what is missing, key by key, and a
  // customer's id with the deployment's secret fails at Google's token
  // endpoint hours later. So the pair is optional as a WHOLE, never by half.
  const googleClientHalfTyped =
    (formData.sourceClientId.trim() !== '') !== (formData.sourceClientSecret.trim() !== '');
  const googleClientPairRequired =
    !(deploymentGoogleClient && isGoogleGrantSource) || googleClientHalfTyped;

  /** The problem with a non-empty custom cron, or null (empty = default). */
  const cronProblem = (): string | null =>
    formData.schedule.trim() === '' ? null : describeCronScheduleProblem(formData.schedule);

  // Each step's gate checks only fields that step RENDERS (0037 T1, pulled
  // forward into 0033 T3 because no wizard test can exist without it): the
  // old source/target gates required sourceUsername/targetUsername — inputs
  // that rendered two steps later, on a shared 'credentials' step — so Next
  // was disabled forever on the first screen, with no message, and the
  // wizard could not be completed at all. Each side now renders and gates
  // its own account (workplan 0070), which is that rule made structural.
  /**
   * What the SOURCE step is still missing, by the label it is shown under
   * (workplan 0067). One function, used by both the gate and the message, for
   * the reason this defect existed at all: they were two switch statements
   * that agreed by hand until Box was added to one of them and not the other.
   *
   * Box then demanded a Host it never renders — Next disabled forever, with
   * "Host" named beside it — and Dropbox's message said "Client ID" while its
   * field is labelled "App key". Deriving both from one list means a provider
   * can be wrong, but it cannot be *inconsistently* wrong.
   */
  const sideStepMissing = (side: 'source' | 'target'): string[] => {
    const out: string[] = [];

    if (side === 'target') {
      // A reused target connection carries the server AND the account.
      if (formData.targetConnectionId) return out;
      if (!formData.targetHost) out.push(t('wizard.host'));
      if (!isValidPort(formData.targetPort)) out.push(t('wizard.port'));
      if (!formData.targetUsername) out.push(t('wizard.targetUsername'));
      if (formData.targetPassword === '') out.push(t('wizard.targetPassword'));
      return out;
    }

    // A stored connection answers every credential-identifying field on this
    // step, and the step hides them all. Nothing left to require.
    if (formData.sourceConnectionId) return out;

    // WHICH account, always — it names the mailbox or drive this migration
    // moves, and no shared connection can know it.
    if (!formData.sourceUsername) out.push(t('wizard.sourceUsername'));

    if (isDropboxSource) {
      // Labelled as the Dropbox App Console labels it, which is not "Client ID".
      if (formData.sourceClientId.trim() === '') out.push(t('wizard.dropboxAppKey'));
      if (formData.sourceClientSecret === '') out.push(t('wizard.sourceClientSecret'));
      if (formData.sourceRefreshToken === '') out.push(t('wizard.refreshToken'));
    } else if (isBoxSource) {
      if (formData.sourceClientId.trim() === '') out.push(t('wizard.clientId'));
      // The CCG subject: without it there is no "whose files" to read.
      if (formData.sourceBoxUserId.trim() === '') out.push(t('wizard.boxUserId'));
      if (formData.sourceClientSecret === '') out.push(t('wizard.sourceClientSecret'));
    } else if (isGoogleSource) {
      // Either flow (ADR-0033): a service-account key, or the OAuth trio —
      // of which the client pair is the deployment's to supply where it has
      // one (ADR-0041), and the refresh token never is: it says whose data.
      if (formData.sourceServiceAccountKey.trim() === '') {
        if (googleClientPairRequired) {
          if (formData.sourceClientId.trim() === '') out.push(t('wizard.clientId'));
          if (formData.sourceClientSecret === '') out.push(t('wizard.sourceClientSecret'));
        }
        // On the consent path the token box sits inside the fold, so what is
        // missing is named by the button that fills it, not by a box the
        // person is not looking at.
        if (formData.sourceRefreshToken === '') {
          out.push(googleClientPairRequired ? t('wizard.refreshToken') : t('wizard.google.connect'));
        }
      }
    } else if (isO365Source) {
      if (formData.sourceTenantId.trim() === '') out.push(t('wizard.tenantId'));
      if (formData.sourceClientId.trim() === '') out.push(t('wizard.clientId'));
      if (formData.sourceClientSecret === '') out.push(t('wizard.sourceClientSecret'));
    } else {
      if (!formData.sourceHost) out.push(t('wizard.host'));
      if (!isValidPort(formData.sourcePort)) out.push(t('wizard.port'));
    }
    return out;
  };

  const canProceed = () => {
    switch (steps[currentStep].id) {
      case 'source':
      case 'target':
        // Each side now renders its own credentials, so each side's gate is
        // its own missing-field list (workplan 0070) — one function per step,
        // for the reason the last two of these bugs existed: two switches that
        // agree by hand stop agreeing the moment a provider is added to one.
        return sideStepMissing(steps[currentStep].id as 'source' | 'target').length === 0;
      case 'migration':
        return (
          formData.name.trim() !== '' &&
          formData.domains.length > 0 &&
          targetDomainRefusal(formData.targetType, formData.domains) === null &&
          sourceDomainRefusal(formData.sourceType, formData.domains, googleAccountDomains) ===
            null &&
          cronProblem() === null // empty = the default cadence, fine
        );
      case 'review':
        return true;
      default:
        return false;
    }
  };

  /** Gating fields of the CURRENT step that are still missing, by label. */
  const missingFields = (): string[] => {
    const out: string[] = [];
    switch (steps[currentStep].id) {
      case 'source':
      case 'target':
        out.push(...sideStepMissing(steps[currentStep].id as 'source' | 'target'));
        break;
      case 'migration':
        if (formData.name.trim() === '') out.push(t('wizard.migrationName'));
        if (formData.domains.length === 0) out.push(t('wizard.missing.dataTypes'));
        break;
    }
    return out;
  };

  /**
   * WHY Next is disabled, in words beside the button (0037 T3). The only
   * feedback used to be the disabled state itself — no required markers, no
   * message, nothing naming the field. Incoherent data types and a broken
   * cron get their real sentences (shared prose, the same words the server
   * refuses with); everything else gets the missing-field list.
   */
  const blockedReason = (): string | null => {
    if (canProceed()) return null;
    const stepId = steps[currentStep].id;
    if (stepId === 'migration') {
      // The data types and the schedule share this step now (workplan 0070),
      // so neither reason may return early on the other's behalf: an
      // incoherent domain used to answer for a broken cron with `null`,
      // leaving Next disabled and silent — the exact defect 0037 T3 removed.
      const refusal =
        targetDomainRefusal(formData.targetType, formData.domains) ??
        sourceDomainRefusal(formData.sourceType, formData.domains, googleAccountDomains);
      if (refusal) return refusal;
      const problem = cronProblem();
      if (problem) return `${t('wizard.cron.invalidLead')} ${problem}`;
    }
    const fields = missingFields();
    return fields.length > 0 ? `${t('wizard.missing.lead')} ${fields.join(', ')}` : null;
  };

  /** The next few firings of a VALID custom cron, so the admin can check
   *  their expression says what they meant (0037 T4's human-readable echo). */
  const nextRuns = (): Date[] => {
    try {
      return new Cron(formData.schedule.trim()).nextRuns(3);
    } catch {
      return [];
    }
  };

  /**
   * A side's credentials, rendered on that side's own step (workplan 0070).
   *
   * They used to share a step two screens later, which is why the reuse picker
   * was unreachable and why testing could not save: by the time you could
   * prove a credential, the wizard had already asked you for the other side's.
   * Each side is now self-contained — pick a provider, enter its credentials,
   * test, saved — and what remains is one step to finalise between the two.
   */
  /**
   * Which form field each descriptor key writes to. The descriptor is not
   * prefixed by side and this form is — this is the one place the two
   * vocabularies meet for the SOURCE, exactly as `credentialValuesFor` is for
   * the probe payload.
   */
  const TARGET_FORM_FIELD: Readonly<Record<string, keyof FormData>> = {
    host: 'targetHost',
    port: 'targetPort',
    username: 'targetUsername',
    password: 'targetPassword',
    url: 'targetUrl',
    mailHost: 'targetMailHost',
    mailPort: 'targetMailPort',
  };

  const SOURCE_FORM_FIELD: Readonly<Record<string, keyof FormData>> = {
    username: 'sourceUsername',
    password: 'sourcePassword',
    host: 'sourceHost',
    port: 'sourcePort',
    tenantId: 'sourceTenantId',
    clientId: 'sourceClientId',
    clientSecret: 'sourceClientSecret',
    refreshToken: 'sourceRefreshToken',
    serviceAccountKey: 'sourceServiceAccountKey',
    rootFolderId: 'sourceRootFolderId',
    rootPath: 'sourceRootPath',
    userId: 'sourceBoxUserId',
  };

  /**
   * Does this field gate Next RIGHT NOW? (workplan 0075 T2.)
   *
   * The red asterisk used to be written by hand beside each input, and for the
   * Google sources it lied: Client ID and Refresh token were marked required
   * unconditionally, while `sideStepMissing` stops requiring them the moment a
   * service-account key is pasted (ADR-0033's either-flow). Same condition,
   * one place, so a marker cannot disagree with the gate it claims to explain.
   */
  const sourceFieldRequiredNow = (field: CredentialField): boolean => {
    if (isGoogleSource && ['clientId', 'clientSecret', 'refreshToken'].includes(field.key)) {
      if (formData.sourceServiceAccountKey.trim() !== '') return false;
      // The pair is the deployment's where it has one (ADR-0041); the token
      // is always this account's.
      return field.key === 'refreshToken' || googleClientPairRequired;
    }
    return field.required === true;
  };

  /** The shared-drive browse (0049), anchored to the field it fills. */
  const renderDriveBrowse = () => (
    <div>
      <button
        type="button"
        onClick={browseSharedDrives}
        disabled={
          browsing ||
          (googleClientPairRequired &&
            (!formData.sourceClientId.trim() || !formData.sourceClientSecret.trim())) ||
          !formData.sourceRefreshToken
        }
        className="text-sm text-blue-700 hover:underline disabled:opacity-50"
      >
        {browsing ? t('wizard.testing') : t('wizard.browseSharedDrives')}
      </button>
      {sharedDrivesError && (
        <p className="mt-1 text-sm text-amber-800">{sharedDrivesError}</p>
      )}
      {sharedDrives &&
        sharedDrives.length === 0 &&
        sharedFolders &&
        sharedFolders.length === 0 && (
          <p className="mt-1 text-sm text-gray-500">
            {t('wizard.noSharedDrives')}
          </p>
        )}
      {((sharedDrives?.length ?? 0) > 0 || (sharedFolders?.length ?? 0) > 0) && (
        <select
          className="input w-full mt-2"
          value={formData.sourceRootFolderId}
          onChange={(e) => updateField('sourceRootFolderId', e.target.value)}
        >
          <option value="">{t('wizard.review.myDrive')}</option>
          {sharedDrives && sharedDrives.length > 0 && (
            <optgroup label={t('wizard.sharedDrivesGroup')}>
              {sharedDrives.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </optgroup>
          )}
          {sharedFolders && sharedFolders.length > 0 && (
            <optgroup label={t('wizard.sharedFoldersGroup')}>
              {/* The owner disambiguates two shares named alike. */}
              {sharedFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.owner ? `${f.name} — ${f.owner}` : f.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
    </div>
  );

  /** Dropbox's shared-folder browse (0055 follow-up), likewise. */
  const renderDropboxBrowse = () => (
    <div>
      <button
        type="button"
        onClick={browseDropboxFolders}
        disabled={
          browsing ||
          !formData.sourceClientId ||
          !formData.sourceClientSecret ||
          !formData.sourceRefreshToken
        }
        className="text-sm text-blue-700 hover:underline disabled:opacity-50"
      >
        {browsing ? t('wizard.testing') : t('wizard.browseDropboxFolders')}
      </button>
      {dropboxFoldersError && (
        <p className="mt-1 text-sm text-amber-800">{dropboxFoldersError}</p>
      )}
      {dropboxFolders && dropboxFolders.length === 0 && (
        <p className="mt-1 text-sm text-gray-500">
          {t('wizard.noDropboxSharedFolders')}
        </p>
      )}
      {dropboxFolders && dropboxFolders.length > 0 && (
        <select
          className="input w-full mt-2"
          value={formData.sourceRootPath}
          onChange={(e) => updateField('sourceRootPath', e.target.value)}
        >
          <option value="">{t('wizard.review.wholeDropbox')}</option>
          {dropboxFolders.map((f) => (
            <option key={f.id} value={f.path ?? ''} disabled={!f.path}>
              {f.path ? f.name : `${f.name} — ${t('wizard.dropboxUnmounted')}`}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  /**
   * The source's fields, in the ONE order the descriptor declares (0075 T1).
   *
   * This was two things: a hand-written block per provider holding its config,
   * and a shared blue "Credentials" panel bolted on after it holding the
   * account, the secret and the refresh token. Workplan 0070 moved that panel
   * onto the step that owns it and stopped there — so on a Drive source the
   * order a person met was Client ID, root folder, service-account key, and
   * only THEN the account, client secret and refresh token. **The three values
   * that come from one page of the Google console were separated by two fields
   * belonging to neither.** The owner reported it three rounds running.
   *
   * `credential-fields.ts` has declared the right order since 0063 and this
   * file never read it. Now it does, which also means a provider gains a field
   * in one place instead of four, and the Connections page and the wizard can
   * no longer disagree about what Dropbox asks for.
   */
  const renderSideFields = (side: 'source' | 'target') => {
    const isSource = side === 'source';
    const chosen = isSource ? formData.sourceConnectionId : formData.targetConnectionId;
    const reveal = isSource ? showSourcePassword : showTargetPassword;
    const setReveal = isSource ? setShowSourcePassword : setShowTargetPassword;
    const fields = credentialFieldsFor(
      side,
      isSource ? formData.sourceType : formData.targetType,
    );
    /**
     * One labelled box (workplan 0075: one input in this file instead of
     * thirty). Where it goes is the loop's decision below; what it is stays
     * here. `htmlFor`/`id` pair kept (0068 T10) so a screen reader can attach
     * the label to its box.
     */
    const fieldControl = (field: CredentialField): React.ReactNode => {
      const formKey = isSource ? SOURCE_FORM_FIELD[field.key] : TARGET_FORM_FIELD[field.key];
      if (!formKey) return null;
      const value = String(formData[formKey] ?? '');
      const placeholder =
        field.placeholder ??
        (field.placeholderKey ? t(field.placeholderKey as StringKey) : undefined);
      const set = (v: string) => updateField(formKey, v);
      const id = `${side}-${field.key}`;
      return (
        <div>
          <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">
            {t(field.labelKey as StringKey)}
            {(isSource ? sourceFieldRequiredNow(field) : field.required === true) && <Required />}
          </label>
          {field.multiline ? (
            <textarea
              id={id}
              value={value}
              onChange={(e) => set(e.target.value)}
              className="input w-full font-mono text-xs"
              rows={4}
              placeholder={placeholder}
            />
          ) : field.revealable ? (
            <div className="relative">
              <input
                id={id}
                type={reveal ? 'text' : 'password'}
                autoComplete={field.autoComplete}
                value={value}
                onChange={(e) => set(e.target.value)}
                className="input w-full pr-10"
                placeholder={placeholder}
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                aria-label={t(reveal ? 'wizard.hidePassword' : 'wizard.showPassword')}
              >
                {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <input
              id={id}
              type={field.secret ? 'password' : field.numeric ? 'number' : 'text'}
              inputMode={field.numeric ? 'numeric' : undefined}
              min={field.numeric ? 1 : undefined}
              max={field.numeric ? 65535 : undefined}
              autoComplete={field.autoComplete ?? 'off'}
              value={value}
              onChange={(e) => set(e.target.value)}
              className="input w-full"
              placeholder={placeholder}
            />
          )}
          {field.hintKey && (
            <p
              className={
                field.key === 'serviceAccountKey'
                  ? 'mt-1 text-xs text-amber-800'
                  : 'mt-1 text-sm text-gray-500'
              }
            >
              {t(field.hintKey as StringKey)}
            </p>
          )}
        </div>
      );
    };
    return (
      <div className="space-y-4">
        {fields.map((field) => {
          // A stored connection answers everything except THIS mapping's own
          // question — whose files, and from which folder (0066 T4a).
          if (chosen && !field.perMapping) return null;
          if (!(isSource ? SOURCE_FORM_FIELD[field.key] : TARGET_FORM_FIELD[field.key])) return null;
          // THE PAIR FOLDS AWAY where the deployment carries the client
          // (ADR-0041; owner remark 2026-09-02). On a managed deployment a
          // person grants Ownpace's own Google application, and "use your
          // own" is the exception — so the default screen is the address and
          // the consent button, and the two boxes sit behind a fold. The
          // secret renders INSIDE the id's fold, never on its own: half a pair
          // is refused at every door, and the screen should not make it easy
          // to type one.
          //
          // AND THE TOKEN FOLDS WITH THEM (owner's second remark, the same
          // day, after the first consent round trip): on the consent path the
          // refresh token arrives from Google and is never typed, so a box
          // with a red asterisk above the fold asked for something the button
          // beside it supplies. Inside the fold it is what it always was — the
          // manual alternative, for a token minted against one's own
          // application. Where the deployment carries no client, nothing
          // folds and the token stays in plain view, as before.
          const folded =
            isSource &&
            isGoogleGrantSource &&
            deploymentGoogleClient &&
            (field.key === 'clientId' ||
              field.key === 'clientSecret' ||
              field.key === 'refreshToken');
          if (folded && field.key !== 'clientId') return null;
          const secretField = folded ? fields.find((f) => f.key === 'clientSecret') : undefined;
          const tokenField = folded ? fields.find((f) => f.key === 'refreshToken') : undefined;
          return (
            <React.Fragment key={field.key}>
              {isSource && field.key === 'rootFolderId' && isDriveSource && renderDriveBrowse()}
              {isSource && field.key === 'rootPath' && isDropboxSource && renderDropboxBrowse()}
              {folded ? (
                <details className="rounded-md border border-gray-200 p-3">
                  <summary className="cursor-pointer text-sm text-gray-700">
                    {t('wizard.google.ownClient')}
                  </summary>
                  <p className="mt-2 text-sm text-gray-500">{t('wizard.google.deploymentClient')}</p>
                  <div className="mt-3 space-y-4">
                    {fieldControl(field)}
                    {secretField && fieldControl(secretField)}
                    {tokenField && fieldControl(tokenField)}
                  </div>
                </details>
              ) : (
                fieldControl(field)
              )}
              {/* TLS belongs to the server, so it sits with host and port —
                  it is not a credential and the descriptor does not carry it. */}
              {field.key === 'port' && !chosen && (
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id={isSource ? 'sourceSsl' : 'targetSsl'}
                    checked={isSource ? formData.sourceSsl : formData.targetSsl}
                    onChange={(e) => updateField(isSource ? 'sourceSsl' : 'targetSsl', e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor={isSource ? 'sourceSsl' : 'targetSsl'} className="ml-2 block text-sm text-gray-700">
                    {t('wizard.useSsl')}
                  </label>
                </div>
              )}
            </React.Fragment>
          );
        })}
        {/* What happens to these secrets — one sentence, at the foot of the
            fields it is about rather than in a panel of its own. */}
        {!chosen && <p className="text-sm text-blue-900">{t('wizard.credentials.storage')}</p>}
      </div>
    );
  };

  /**
   * Test this side, and keep it if it works (workplan 0069, now per side).
   *
   * Optional — Next never gates on it, because a probe can time out on a slow
   * provider and the create route re-refuses everything anyway. But it is the
   * only way to leave with the credentials kept, so it says so.
   */
  const renderProbe = (side: 'source' | 'target') => {
    const chosen = side === 'source' ? formData.sourceConnectionId : formData.targetConnectionId;
    const r = probeResults[side];
    return (
      <div className="border border-gray-200 rounded-lg p-4">
        {/* Name it HERE, because testing is what saves it (0069 T2) and this
            is the moment the person knows what it is for (workplan 0076).
            Optional: left empty it is named after what it connects to, which
            is what it always was. */}
        {!chosen && (
          <div className="mb-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('wizard.connectionName')}
            </label>
            <input
              type="text"
              value={side === 'source' ? formData.sourceConnectionName : formData.targetConnectionName}
              onChange={(e) =>
                updateField(
                  side === 'source' ? 'sourceConnectionName' : 'targetConnectionName',
                  e.target.value,
                )
              }
              className="input w-full"
              placeholder={connectionNameFor(side)}
            />
            {connectionNameTaken(side) && (
              // A warning, not a refusal: nothing keys off the name, but a
              // name that does not tell two things apart is not doing its job.
              <p className="mt-1 text-sm text-amber-800">{t('wizard.connectionName.taken')}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => runProbe(side)}
            disabled={probing}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            {probing ? t('wizard.testing') : t('wizard.testConnections')}
          </button>
          <p className="text-sm text-gray-500">
            {chosen ? t('wizard.testConnections.reused') : t('wizard.testConnections.hint')}
          </p>
        </div>
        {r && (
          <div className="mt-3 flex items-start gap-2 text-sm">
            {r.ok ? (
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
            )}
            {/* Ours in the reader's language, theirs verbatim (workplan
                0080). `probeText` reads the outcome code to tell which is
                which; a provider's refusal always falls through unchanged,
                because that string is what you paste into their console. */}
            <p className="text-gray-700 min-w-0 break-words">
              {probeText(t, r.outcome, (r.ok ? r.detail : r.reason) ?? '', locale)}
              {r.scheduling && (
                /* What this target will DO with calendar writes (0105 T0). */
                <span className="block mt-1">{schedulingText(t, r.scheduling)}</span>
              )}
              {r.qualification && (
                /* What this account CAN CARRY (0106 T0). */
                <span className="block mt-1">{qualificationText(t, r.qualification)}</span>
              )}
              {qualificationEvidence(t, r.qualification).map((line) => (
                /* Why a face is `?` — on screen, since a phone has no hover. */
                <span key={line} className="block mt-1 text-xs break-words">
                  {line}
                </span>
              ))}
            </p>
          </div>
        )}
        {/* "We kept this" (workplan 0069 T7c).
 
            A failing credential is stored deliberately — somebody mid-setup
            waiting on an administrator should not lose it (0063 T4) — and the
            wizard said only what went wrong, so the storing was invisible. The
            reasonable inference from a red panel is that nothing was saved and
            the whole form has to be retyped, which is the opposite of what
            happened. Shown only when there IS something of ours saved:
            `draftConnection[side]` is set by the add/rotate path and never by
            the read-only probe of a connection already being reused. */}
        {r && !r.ok && draftConnection[side] && (
          <p className="mt-2 text-sm text-gray-600">{t('wizard.testConnections.kept')}</p>
        )}
      </div>
    );
  };

  /**
   * The Google ACCOUNT card's hint follows what this deployment's application
   * carries (ADR-0041).
   *
   * The default hint ends "Gmail and Drive stay separate cards for now: they
   * need a Google security review we have not bought yet" — true of the client
   * Ownpace publishes to strangers, and a lie on an installation whose owner
   * registered their own application and accepted the restricted tier. A card
   * that names a wall which is not there is worse than one that says nothing:
   * it sends somebody looking for the wrong problem.
   *
   * Keyed off the ceiling itself rather than off the setting, so the two
   * cannot say different things.
   */
  const sourceCardFor = (card: (typeof SOURCE_CARDS)[number]) =>
    card.id === 'google' &&
    googleAccountDomains.includes('email') &&
    googleAccountDomains.includes('file')
      ? { ...card, hintKey: RESTRICTED_GOOGLE_HINT }
      : card;

  const onPickSource = (type: (typeof SOURCE_CARDS)[number]) => {
      // A verdict about the OLD provider must not survive the
      // switch (0073) — it is a statement about a credential
      // this screen no longer asks for.
      forgetProbe('source');
      // A Google credential reads exactly one API, so choosing
      // it also chooses that domain — the same constraint the
      // server refuses by name (sourceDomainRefusal). Setting it
      // here spares the data-types step a dead end; switching
      // AWAY leaves the selection alone, which the matrices then
      // re-police. Drive pins the file domain and a file-capable
      // target; Gmail pins email and a mail-capable one.
      // `void`: the chain below is an expression chosen for its
      // effect, and it is left as one rather than rewritten —
      // reshaping a live nested ternary is the edit 0070 T6
      // records going wrong.
      void (type.id === 'google-drive' || type.id === 'dropbox' || type.id === 'box'
        ? setFormData((prev) => ({
            ...prev,
            ...clearedSourceFields(prev, type.id),
            sourceType: type.id,
            domains: ['file'],
            targetType:
              prev.targetType === 'jmap' || prev.targetType === 'webdav'
                ? prev.targetType
                : 'webdav',
          }))
        : type.id === 'gmail'
          ? setFormData((prev) => ({
              ...prev,
              ...clearedSourceFields(prev, type.id),
              sourceType: type.id,
              domains: ['email'],
              targetType:
                prev.targetType === 'jmap' || prev.targetType === 'imap'
                  ? prev.targetType
                  : 'jmap',
            }))
          : type.id === 'google'
            ? setFormData((prev) => ({
                ...prev,
                ...clearedSourceFields(prev, type.id),
                sourceType: type.id,
                // Pinned to the faces this account kind serves, the same way
                // every other card pins its own (workplan 0106 T3b).
                //
                // Both ticked rather than none, and it is a judgement call
                // worth naming: none would be the strictest least-privilege
                // default, but it would also leave the consent button on this
                // step disabled with nothing on this step to tick — the ticks
                // live on the migration step. Somebody who chose the ACCOUNT
                // card chose it BECAUSE it carries several faces, and
                // narrowing is one untick away on step 3, after which the
                // consent asks for less. The empty case stays guarded: untick
                // both and the button refuses with a sentence rather than
                // sending a consent for nothing.
                domains: [...googleAccountDomains],
              }))
          : type.id === 'google-calendar'
            ? setFormData((prev) => ({
                ...prev,
                ...clearedSourceFields(prev, type.id),
                sourceType: type.id,
                domains: ['calendar'],
                // The one calendar-capable target (JMAP calendar
                // is parked by owner decision, 0031 T1).
                targetType: 'caldav',
              }))
            : type.id === 'google-contacts'
              ? setFormData((prev) => ({
                  ...prev,
                  ...clearedSourceFields(prev, type.id),
                  sourceType: type.id,
                  domains: ['contact'],
                  targetType:
                    prev.targetType === 'jmap' || prev.targetType === 'carddav'
                      ? prev.targetType
                      : 'carddav',
                }))
              : setFormData((prev) => ({ ...prev, ...clearedSourceFields(prev, type.id), sourceType: type.id })));
  };

  const onPickTarget = (type: (typeof TARGET_CARDS)[number]) => {
    forgetProbe('target');
    updateField('targetType', type.id);
  };

  const renderStep = () => {
    switch (steps[currentStep].id) {
      case 'source':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('wizard.selectSource')}</h3>
              <FrontDoorChooser
                cards={SOURCE_CARDS}
                selectedId={formData.sourceType}
                onPick={onPickSource}
                gridClass="sm:grid-cols-2"
                cardFor={sourceCardFor}
              />
              {/* 0037 T6, answered 2026-08-10: oauth2/graph use the
                  per-customer Entra app registration (ADR-0006's row-14
                  model) — say what these fields ARE and where the rest of
                  the registration goes, instead of the retired interim
                  confession that only username+password were collected. */}
              {isO365Source && (
                <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {t('wizard.source.appRegistration')}
                </p>
              )}
              {/* Workplan 0042: the customer's own Google OAuth client, a
                  delegated read-only token, and the doc that walks all of it.
                  Also the one place to say what happens to Google Docs —
                  reported un-migratable one by one, by design, until export
                  byte-stability is measured (T3). */}
              {isDriveSource && (
                <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {t('wizard.source.driveSetup')}
                </p>
              )}
              {/* Workplan 0055: Dropbox's App Console words mapped onto the
                  shared credential fields, said up front. */}
              {isDropboxSource && (
                <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {t('wizard.source.dropboxSetup')}
                </p>
              )}
              {/* Workplan 0056: Box's Client Credentials Grant — why there is
                  no refresh-token field, and where the admin authorization
                  happens, said up front. */}
              {isBoxSource && (
                <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {t('wizard.source.boxSetup')}
                </p>
              )}
              {/* Workplan 0044: the same Google OAuth client as Drive, but the
                  refresh token must be consented with the mail scope — the one
                  mistake this box exists to prevent. */}
              {isGmailSource && (
                <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {t('wizard.source.gmailSetup')}
                </p>
              )}
              {/* Workplan 0045: same OAuth client, per-product consent — the
                  scope each token must carry is the mistake this box exists
                  to prevent, exactly like Gmail's. */}
              {isGoogleDavSource && (
                <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {t('wizard.source.googleDavSetup')}
                </p>
              )}
            </div>

            {/* The prerequisites as a checklist that REMEMBERS (workplan 0061).
                The panels above say what to do; this is where it gets ticked
                off, per tenant, so an interrupted setup can be resumed — and
                so a colleague can finish what somebody else started. */}
            <p className="mt-3">
              <Link
                to={`/setup/source/${formData.sourceType}`}
                state={{ from: '/mappings/new' }}
                className="text-sm text-blue-700 hover:underline"
              >
                {t('setup.openChecklist')}
              </Link>
            </p>

            {/* Reuse instead of re-typing (workplan 0064), offered HERE rather
                than on the credentials step (workplan 0067). It has to be on
                the step that gates the fields it replaces: a Box or Microsoft
                365 source cannot leave this screen without a client id, so a
                picker that removes the need for one two steps later removes it
                after the person has already been forced to find it. */}
            <ConnectionPicker
              labelKey="wizard.reuseSource"
              options={reusableSources}
              value={formData.sourceConnectionId}
              onChange={(id) => {
                forgetProbe('source');
                updateField('sourceConnectionId', id);
              }}
            />

            {renderSideFields('source')}
            {/* The consent you can click (workplan 0089 T1): the round-trip
                the manual sent people to the OAuth Playground for, run by the
                wizard against the customer's OWN client. The fields above
                stay — an operator holding a token can still paste it, and
                the appliance's file-configured path is untouched. */}
            {GOOGLE_CONSENT_SOURCES.includes(formData.sourceType) &&
              !formData.sourceConnectionId && (
                <div className="mt-4">
                  {/* THE FACES, HERE, for the account kind. Its consent asks
                      Google for exactly what is ticked (0106 T3b), and the
                      ticks lived two steps further on — behind a gate this
                      button is the only way through. The owner met the
                      dead end on 2026-09-02: a button that waits for ticks
                      nobody can reach. Same state as the migration step's
                      cards, so ticking here is ticking there. */}
                  {isGoogleAccountSource && (
                    <fieldset className="mb-3">
                      <legend className="block text-sm text-gray-700 mb-1">
                        {t('connections.googleFaces')}
                      </legend>
                      <div className="flex flex-wrap gap-4">
                        {dataTypes.map((face) => (
                          <label
                            key={face.id}
                            className="inline-flex items-center gap-1 text-sm text-gray-700"
                          >
                            <input
                              type="checkbox"
                              checked={formData.domains.includes(face.id)}
                              onChange={() => toggleDomain(face.id)}
                            />
                            {t(face.nameKey)}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <button
                    type="button"
                    onClick={startGoogleConsent}
                    disabled={
                      (googleClientPairRequired &&
                        (!formData.sourceClientId.trim() || !formData.sourceClientSecret.trim())) ||
                      // The account consent asks for the ticked faces and
                      // nothing else, so with nothing ticked there is nothing
                      // to ask for. The server refuses that with a sentence;
                      // the button refuses it before the round trip, which is
                      // the same answer given sooner.
                      (isGoogleAccountSource && formData.domains.length === 0)
                    }
                    className="btn btn-secondary"
                    title={
                      googleClientPairRequired &&
                      (!formData.sourceClientId.trim() || !formData.sourceClientSecret.trim())
                        ? deploymentGoogleClient
                          ? t('wizard.google.connect.halfClient')
                          : t('wizard.google.connect.needsClient')
                        : isGoogleAccountSource && formData.domains.length === 0
                          ? t('wizard.google.connect.needsDomains')
                          : undefined
                    }
                  >
                    {t('wizard.google.connect')}
                  </button>
                  <p className="mt-1 text-sm text-gray-500">{t('wizard.google.connect.hint')}</p>
                  {googleConsent && (
                    <p
                      className={`mt-1 text-sm ${
                        googleConsent === 'received' ? 'text-green-700' : 'text-amber-800'
                      }`}
                    >
                      {googleConsent === 'received' ? t('wizard.google.received') : googleConsent}
                    </p>
                  )}
                  {googleRedirect && googleConsent !== 'received' && (
                    <p className="mt-1 text-sm text-gray-500">
                      {t('wizard.google.redirectUri')}{' '}
                      <code className="break-all font-mono text-xs">{googleRedirect}</code>
                    </p>
                  )}
                </div>
              )}
            {renderProbe('source')}
          </div>
        );

      case 'target':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('wizard.selectTarget')}</h3>
              <FrontDoorChooser
                cards={TARGET_CARDS}
                selectedId={formData.targetType}
                onPick={onPickTarget}
                gridClass="sm:grid-cols-3"
              />
              {/* ADR-0011's consequence, on the step where the destination is
                  chosen (owner decision 2026-08-10 — it previously rendered on
                  the SOURCE step): whatever server the owner points this at is
                  THEIRS. We migrate into it; we do not run it, monitor it,
                  back it up, or carry an SLA for it. Said before the
                  connection details are typed, not after. */}
              <p className="mt-4 text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                {t('createMapping.target.userOperated')}
              </p>
            </div>

            <ConnectionPicker
              labelKey="wizard.reuseTarget"
              options={reusableTargets}
              value={formData.targetConnectionId}
              onChange={(id) => {
                forgetProbe('target');
                updateField('targetConnectionId', id);
              }}
            />

            <div className="space-y-4">
              {/* Host and port describe the SERVER, which is what a target
                  connection already holds — so a reused one answers them and
                  re-asking would be asking somebody to confirm a value they
                  cannot see. The target USERNAME stays on the credentials
                  step: it names which account this mapping writes to, which a
                  shared connection cannot know. */}
              {renderSideFields('target')}

              {/* The merge-or-subfolder choice (owner decision 2026-08-16),
                  made where the destination is chosen. Empty means MERGE —
                  the default on purpose — and the hint says what the other
                  answer is for, so consolidating owners find it here rather
                  than in a source step that cannot know it is one of two. */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('wizard.targetPrefix')}
                </label>
                <input
                  type="text"
                  value={formData.targetFolderPrefix}
                  onChange={(e) => updateField('targetFolderPrefix', e.target.value)}
                  className="input w-full"
                  placeholder={t('wizard.targetPrefix.placeholder')}
                />
                <p className="mt-1 text-sm text-gray-500">{t('wizard.targetPrefix.hint')}</p>
              </div>
            </div>
            {renderProbe('target')}
          </div>
        );

      case 'migration':
        return (
          <div className="space-y-6">
            {/* Both sides are settled by the time anyone gets here (workplan
                0070): this step is only what is true of THIS migration —
                what to call it, what to move, and how often. */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('wizard.migrationName')}
                <Required />
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                className="input w-full"
                placeholder="My Migration"
              />
              <p className="mt-1 text-sm text-gray-500">{t('wizard.migrationNameHint')}</p>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">
                {t('wizard.selectDataTypes')}
              </h3>
              <p className="text-sm text-gray-500">{t('wizard.selectDataTypesHint')}</p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {dataTypes.map((type) => {
                  const unavailable = !allowedDomains.includes(type.id);
                  const measured = measuredAnswerFor(type.id);
                  // The account's own record, beneath the matrix (0106 T3a):
                  // only a MEASURED no locks a matrix-allowed tick — the
                  // create API refuses the same combination in the same
                  // sentence (measuredNoRefusal) — while unknown never locks
                  // anything (a refusal is never a no, and neither is
                  // silence).
                  const measuredNo = !unavailable && measured?.answer === 'no';
                  // A selected-but-unavailable type stays clickable: it must be
                  // DESELECTABLE, or going back and changing the target would
                  // trap the wizard behind a button that cannot be un-pressed.
                  const locked =
                    (unavailable || measuredNo) && !formData.domains.includes(type.id);
                  return (
                    <button
                      key={type.id}
                      onClick={() => toggleDomain(type.id)}
                      disabled={locked}
                      className={`p-4 border-2 rounded-lg text-left transition-colors ${
                        formData.domains.includes(type.id)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      } ${locked ? 'opacity-50 cursor-not-allowed hover:border-gray-200' : ''}`}
                    >
                      <div className="flex items-center">
                        <type.icon
                          className={`w-6 h-6 mr-3 ${
                            formData.domains.includes(type.id)
                              ? 'text-blue-600'
                              : 'text-gray-400'
                          }`}
                        />
                        <div>
                          <p className="font-medium text-gray-900">{t(type.nameKey)}</p>
                          <p className="text-sm text-gray-500">{t(type.hintKey)}</p>
                          {unavailable && (
                            <p className="text-xs text-amber-700 mt-1">
                              {t('wizard.domain.notForTarget')}
                            </p>
                          )}
                          {measuredNo && (
                            <p className="text-xs text-amber-700 mt-1" title={measured?.detail}>
                              {t('wizard.domain.measuredNo')}
                            </p>
                          )}
                          {!unavailable && !measuredNo && measured?.answer === 'unknown' && (
                            <p className="text-xs text-gray-400 mt-1" title={measured?.detail}>
                              {t('wizard.domain.unmeasured')}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('wizard.schedule')}</h3>
              <p className="text-sm text-gray-500 mb-4">{t('wizard.scheduleHint')}</p>

              <div className="space-y-3">
                {(
                  [
                    { value: '0 * * * *', labelKey: 'wizard.schedule.hourly', hintKey: 'wizard.schedule.hourly.hint' },
                    { value: '0 2 * * *', labelKey: 'wizard.schedule.daily', hintKey: 'wizard.schedule.daily.hint' },
                    { value: '0 */6 * * *', labelKey: 'wizard.schedule.sixHourly', hintKey: 'wizard.schedule.sixHourly.hint' },
                    { value: '*/15 * * * *', labelKey: 'wizard.schedule.quarterHourly', hintKey: 'wizard.schedule.quarterHourly.hint' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    onClick={() => updateField('schedule', option.value)}
                    className={`w-full p-4 border-2 rounded-lg text-left transition-colors ${
                      formData.schedule === option.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{t(option.labelKey)}</p>
                    <p className="text-sm text-gray-500">{t(option.hintKey)}</p>
                  </button>
                ))}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('wizard.customCron')}
                </label>
                <input
                  type="text"
                  value={formData.schedule}
                  onChange={(e) => updateField('schedule', e.target.value)}
                  className="input w-full"
                  placeholder="0 2 * * *"
                  aria-invalid={cronProblem() !== null}
                />
                <p className="mt-1 text-xs text-gray-500">{t('wizard.customCronHint')}</p>
                {/* The echo (0037 T4): a VALID expression shows its next
                    firings — computed by the exact croner version the tick
                    worker uses — so "did I say what I meant?" has an answer
                    before the value is stored. */}
                {formData.schedule.trim() !== '' && cronProblem() === null && (
                  <p className="mt-2 text-xs text-gray-600" data-testid="cron-next-runs">
                    {t('wizard.cron.nextRuns')}{' '}
                    {nextRuns()
                      .map((d) => dateTime(d))
                      .join(' · ')}
                  </p>
                )}
              </div>
            </div>
          </div>
        );

      case 'review':
        return (
          <div className="space-y-6">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center">
                <Check className="w-5 h-5 text-green-600 mr-2" />
                <h3 className="font-medium text-green-900">{t('wizard.readyToCreate')}</h3>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">{t('wizard.reviewDetails')}</h4>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-gray-500">{t('wizard.review.name')}</dt>
                    <dd className="text-sm font-medium text-gray-900">{formData.name}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">{t('wizard.review.source')}</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {formData.sourceType}{' '}
                      {isDriveSource
                        ? formData.sourceRootFolderId
                          ? `(${formData.sourceRootFolderId})`
                          : `(${t('wizard.review.myDrive')})`
                        : isDropboxSource
                          ? formData.sourceRootPath
                            ? `(${formData.sourceRootPath})`
                            : `(${t('wizard.review.wholeDropbox')})`
                        : isBoxSource
                          ? `(${t('wizard.review.boxUser')} ${formData.sourceBoxUserId})`
                        : isGmailSource || isGoogleDavSource
                          ? `(${formData.sourceUsername})`
                          : isO365Source
                            ? `(${formData.sourceTenantId})`
                            : `(${formData.sourceHost}:${formData.sourcePort})`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">{t('wizard.review.target')}</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {formData.targetType}{' '}
                      {formData.targetUrl.trim()
                        ? `(${formData.targetUrl.trim()})`
                        : `(${formData.targetHost}:${formData.targetPort})`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">{t('wizard.review.schedule')}</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {formData.schedule || t('wizard.review.scheduleDefault')}
                    </dd>
                  </div>
                </dl>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">{t('wizard.review.dataTypes')}</h4>
                <div className="flex flex-wrap gap-2">
                  {formData.domains.map((domain) => (
                    <span
                      key={domain}
                      className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full"
                    >
                      {t(`domain.${domain}` as StringKey)}
                    </span>
                  ))}
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm text-yellow-800">
                  <strong>{t('wizard.review.noteLead')}</strong> {t('wizard.review.note')}
                </p>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('wizard.title')}</h1>
        <p className="text-gray-500 mt-1">{t('wizard.subtitle')}</p>
      </div>

      {/* Progress Steps */}
      <nav aria-label="Progress">
        <ol className="flex items-center">
          {steps.map((step, index) => (
            <li key={step.id} className={`relative ${index !== steps.length - 1 ? 'flex-1' : ''}`}>
              <div
                className={`flex items-center ${
                  index <= currentStep ? 'text-blue-600' : 'text-gray-400'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                    index < currentStep
                      ? 'bg-blue-600 border-blue-600'
                      : index === currentStep
                      ? 'bg-white border-blue-600'
                      : 'bg-white border-gray-300'
                  }`}
                >
                  {index < currentStep ? (
                    <Check className="w-5 h-5 text-white" />
                  ) : (
                    <step.icon className="w-5 h-5" />
                  )}
                </div>
                <span className="ml-2 text-sm font-medium">{t(step.nameKey)}</span>
              </div>
              {index !== steps.length - 1 && (
                <div
                  className={`absolute top-4 left-0 right-0 h-0.5 ${
                    index < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                  style={{ left: '4rem' }}
                />
              )}
            </li>
          ))}
        </ol>
      </nav>

      {/* Step Content */}
      <div className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
        {renderStep()}
      </div>

      {/* A failed submit says so, with the SERVER's words (0033 T3). Before
          this block, createMutation.isError rendered nothing anywhere: the
          operator clicked "Create Migration" and the button simply returned
          to rest. The form stays — no data loss — and the message names what
          the server refused. */}
      {createMutation.isError && (
        <div className="mt-6 flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {/* A duplicate is a REFUSAL with a way out, not a fault (0071 T6):
              the existing migration's name is the server's finding and the
              explanation is ours, so it reads in the operator's own language —
              and its id turns "no" into a link to the thing already doing it.
              Everything else still renders the server's sentence verbatim. */}
          {duplicate ? (
            <div>
              <p className="font-medium">{t('createMapping.duplicate.lead')}</p>
              <p className="mt-1">
                {duplicate.name ? `“${duplicate.name}”` : duplicate.id}
              </p>
              <p className="mt-1">{t('createMapping.duplicate.why')}</p>
              <Link
                to={`/mappings/${duplicate.id}`}
                className="mt-2 inline-block underline hover:no-underline"
              >
                {t('createMapping.duplicate.open')}
              </Link>
            </div>
          ) : (
            <div>
              <p className="font-medium">{t('createMapping.createFailed')}</p>
              <p className="mt-1">{serverMessage(createMutation.error)}</p>
            </div>
          )}
        </div>
      )}

      {/* Why Next is disabled, said beside it (0037 T3/T4). */}
      {blockedReason() !== null && (
        <p className="mt-6 text-sm text-amber-800" role="status">
          {blockedReason()}
        </p>
      )}

      {/* Navigation Buttons */}
      <div className="mt-6 flex justify-between">
        <button
          onClick={handleBack}
          className="flex items-center px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          {currentStep === 0 ? t('wizard.cancel') : t('wizard.back')}
        </button>

        <button
          onClick={handleNext}
          disabled={!canProceed() || createMutation.isPending}
          className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {createMutation.isPending ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2" />
              {t('wizard.creating')}
            </>
          ) : (
            <>
              {currentStep === steps.length - 1 ? t('wizard.create') : t('wizard.next')}
              <ArrowRight className="w-5 h-5 ml-2" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default CreateMapping;
