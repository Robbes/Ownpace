// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
import React, { useState } from 'react';
import { useT, useFormatters } from '../i18n';
import type { StringKey } from '../i18n';
import { useNavigate } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Server,
  Database,
  Settings,
  Clock,
  FileText,
  Calendar,
  Users,
  Folder,
  AlertCircle,
  Eye,
  EyeOff
} from 'lucide-react';
import {
  SOURCE_TYPE_DOMAINS,
  TARGET_TYPE_DOMAINS,
  sourceDomainRefusal,
  targetDomainRefusal,
  describeCronScheduleProblem,
} from '@openmig/shared';
// The SAME cron library — same pinned version — the managed tick evaluates
// schedules with, so the "next syncs" echo below cannot disagree with what
// the scheduler will actually do.
import { Cron } from 'croner';
import { mappingApi, type TestConnectionResult } from '../services/mapping-service';
import { serverMessage } from '../services/api';
import { useMutation } from '@tanstack/react-query';

type Step = 'source' | 'target' | 'credentials' | 'data-types' | 'schedule' | 'review';

// Matches the shared/API domain enum so the wizard submits a schema-valid config.
type Domain = 'email' | 'calendar' | 'contact' | 'file';

interface FormData {
  name: string;
  sourceType: 'imap' | 'oauth2' | 'graph' | 'google-drive' | 'gmail' | 'google-calendar' | 'google-contacts' | 'dropbox';
  targetType: 'jmap' | 'imap' | 'caldav' | 'carddav' | 'webdav';
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
   *  with the customer's OWN app — tenant + client id here, the client
   *  secret on the credentials step beside the mailbox address. */
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
  targetHost: string;
  targetPort: string;
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
  targetHost: '',
  targetPort: '443',
  targetUsername: '',
  targetPassword: '',
  targetSsl: true,
  targetFolderPrefix: '',
  domains: ['email'],
  schedule: '',
};

const steps: { id: Step; nameKey: StringKey; icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
  { id: 'source', nameKey: 'wizard.step.source', icon: Server },
  { id: 'target', nameKey: 'wizard.step.target', icon: Database },
  { id: 'credentials', nameKey: 'wizard.step.credentials', icon: Settings },
  { id: 'data-types', nameKey: 'wizard.step.dataTypes', icon: FileText },
  { id: 'schedule', nameKey: 'wizard.step.schedule', icon: Clock },
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

const isValidPort = (raw: string): boolean => {
  if (!/^\d+$/.test(raw)) return false;
  const n = Number(raw);
  return n >= 1 && n <= 65535;
};

/** The red asterisk beside a gating field's label (0037 T3). */
const Required: React.FC = () => (
  <span className="text-red-500" aria-hidden="true">
    {' '}
    *
  </span>
);

const CreateMapping: React.FC = () => {
  const t = useT();
  const { dateTime } = useFormatters();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [showSourcePassword, setShowSourcePassword] = useState(false);
  const [showTargetPassword, setShowTargetPassword] = useState(false);

  const createMutation = useMutation({
    mutationFn: mappingApi.create,
    // 0013 T6 via a real URL (0037 T2): the confirm/green-light screen used
    // to be swapped in as component state, which no route reached — a refresh
    // stranded the paused mapping. Navigating gives the green light an
    // address that survives the wizard.
    onSuccess: (mapping: { id: string }) => {
      navigate(`/mappings/${mapping.id}/confirm`);
    },
  });

  // Leaving a dirty wizard is a question, not a silent discard (0037 T5).
  // All wizard state is plain useState, so refresh/close throws away six
  // steps of typed input; beforeunload covers those, and handleBack's
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
          : isGmailSource || isGoogleDavSource
          ? {
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
  // drives.list instead of a paste out of the admin console. Lives on the
  // credentials step because that is where the three values it needs are
  // typed; the id it picks lands in the same field the source step shows.
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
  const browseSharedDrives = () => {
    setBrowsing(true);
    setSharedDrivesError(null);
    const creds = {
      clientId: formData.sourceClientId,
      clientSecret: formData.sourceClientSecret,
      refreshToken: formData.sourceRefreshToken,
    };
    Promise.allSettled([
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

    // The connection test (workplan 0046): both sides probed in parallel,
  // read-only, results shown verbatim — the same sentence the first pass
  // would have failed with, before anything exists.
  const [probing, setProbing] = React.useState(false);
  const [probeResults, setProbeResults] = React.useState<{
    source?: TestConnectionResult;
    target?: TestConnectionResult;
  }>({});
  const runProbes = () => {
    setProbing(true);
    setProbeResults({});
    const asResult = (settled: PromiseSettledResult<TestConnectionResult>): TestConnectionResult =>
      settled.status === 'fulfilled'
        ? settled.value
        : { ok: false, reason: serverMessage(settled.reason) };
    Promise.allSettled([
      mappingApi.testConnection({
        side: 'source',
        sourceType: formData.sourceType,
        sourceConfig: builtSourceConfig(),
      }),
      mappingApi.testConnection({
        side: 'target',
        targetType: formData.targetType,
        targetConfig: builtTargetConfig(),
      }),
    ])
      .then(([src, tgt]) => setProbeResults({ source: asResult(src), target: asResult(tgt) }))
      .finally(() => setProbing(false));
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    } else {
      if (dirty && !window.confirm(t('wizard.leaveConfirm'))) return;
      navigate('/mappings');
    }
  };

  const updateField = (field: keyof FormData, value: string | number | boolean | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
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
  const sourceAllowed = SOURCE_TYPE_DOMAINS[formData.sourceType];
  const allowedDomains = TARGET_TYPE_DOMAINS[formData.targetType].filter(
    (d) => !sourceAllowed || sourceAllowed.includes(d),
  );

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
  const isGoogleSource = isDriveSource || isGmailSource || isGoogleDavSource || isDropboxSource;

  /** The problem with a non-empty custom cron, or null (empty = default). */
  const cronProblem = (): string | null =>
    formData.schedule.trim() === '' ? null : describeCronScheduleProblem(formData.schedule);

  // Each step's gate checks only fields that step RENDERS (0037 T1, pulled
  // forward into 0033 T3 because no wizard test can exist without it): the
  // old source/target gates required sourceUsername/targetUsername — inputs
  // that render two steps later, on 'credentials' — so Next was disabled
  // forever on the first screen, with no message, and the wizard could not
  // be completed at all. The username requirement now lives on the step
  // that shows the fields.
  const canProceed = () => {
    switch (steps[currentStep].id) {
      case 'source':
        if (isGoogleSource)
          // Either flow (ADR-0033): an OAuth client, or a service-account key.
          return (
            formData.sourceClientId.trim() !== '' ||
            formData.sourceServiceAccountKey.trim() !== ''
          );
        return isO365Source
          ? formData.sourceTenantId.trim() !== '' && formData.sourceClientId.trim() !== ''
          : Boolean(formData.sourceHost) && isValidPort(formData.sourcePort);
      case 'target':
        return Boolean(formData.targetHost) && isValidPort(formData.targetPort);
      case 'credentials':
        return (
          formData.name.trim() !== '' &&
          Boolean(formData.sourceUsername && formData.targetUsername) &&
          (!isO365Source || formData.sourceClientSecret !== '') &&
          (!isGoogleSource ||
            formData.sourceServiceAccountKey.trim() !== '' ||
            (formData.sourceClientSecret !== '' && formData.sourceRefreshToken !== ''))
        );
      case 'data-types':
        return (
          formData.domains.length > 0 &&
          targetDomainRefusal(formData.targetType, formData.domains) === null &&
          sourceDomainRefusal(formData.sourceType, formData.domains) === null
        );
      case 'schedule':
        return cronProblem() === null; // empty = the default cadence, fine
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
        if (isGoogleSource) {
          if (
            formData.sourceClientId.trim() === '' &&
            formData.sourceServiceAccountKey.trim() === ''
          )
            out.push(t('wizard.clientId'));
        } else if (isO365Source) {
          if (formData.sourceTenantId.trim() === '') out.push(t('wizard.tenantId'));
          if (formData.sourceClientId.trim() === '') out.push(t('wizard.clientId'));
        } else {
          if (!formData.sourceHost) out.push(t('wizard.host'));
          if (!isValidPort(formData.sourcePort)) out.push(t('wizard.port'));
        }
        break;
      case 'target':
        if (!formData.targetHost) out.push(t('wizard.host'));
        if (!isValidPort(formData.targetPort)) out.push(t('wizard.port'));
        break;
      case 'credentials':
        if (formData.name.trim() === '') out.push(t('wizard.migrationName'));
        if (!formData.sourceUsername) out.push(t('wizard.sourceUsername'));
        if (isO365Source && formData.sourceClientSecret === '') out.push(t('wizard.sourceClientSecret'));
        if (isGoogleSource && formData.sourceServiceAccountKey.trim() === '') {
          if (formData.sourceClientSecret === '') out.push(t('wizard.sourceClientSecret'));
          if (formData.sourceRefreshToken === '') out.push(t('wizard.refreshToken'));
        }
        if (!formData.targetUsername) out.push(t('wizard.targetUsername'));
        break;
      case 'data-types':
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
    if (stepId === 'data-types' && formData.domains.length > 0) {
      return (
        targetDomainRefusal(formData.targetType, formData.domains) ??
        sourceDomainRefusal(formData.sourceType, formData.domains)
      );
    }
    if (stepId === 'schedule') {
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

  const renderStep = () => {
    switch (steps[currentStep].id) {
      case 'source':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('wizard.selectSource')}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(
                  [
                    { id: 'imap', name: 'IMAP', hintKey: 'wizard.proto.imap.hint' },
                    { id: 'oauth2', name: 'OAuth2', hintKey: 'wizard.proto.oauth2.hint' },
                    { id: 'graph', name: 'Microsoft Graph', hintKey: 'wizard.proto.graph.hint' },
                    {
                      id: 'google-drive',
                      name: 'Google Drive',
                      hintKey: 'wizard.proto.googleDrive.hint',
                    },
                    { id: 'gmail', name: 'Gmail', hintKey: 'wizard.proto.gmail.hint' },
                    {
                      id: 'google-calendar',
                      name: 'Google Calendar',
                      hintKey: 'wizard.proto.googleCalendar.hint',
                    },
                    {
                      id: 'google-contacts',
                      name: 'Google Contacts',
                      hintKey: 'wizard.proto.googleContacts.hint',
                    },
                    { id: 'dropbox', name: 'Dropbox', hintKey: 'wizard.proto.dropbox.hint' },
                  ] as const
                ).map((type) => (
                  <button
                    key={type.id}
                    onClick={() =>
                      // A Google credential reads exactly one API, so choosing
                      // it also chooses that domain — the same constraint the
                      // server refuses by name (sourceDomainRefusal). Setting it
                      // here spares the data-types step a dead end; switching
                      // AWAY leaves the selection alone, which the matrices then
                      // re-police. Drive pins the file domain and a file-capable
                      // target; Gmail pins email and a mail-capable one.
                      type.id === 'google-drive' || type.id === 'dropbox'
                        ? setFormData((prev) => ({
                            ...prev,
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
                              sourceType: type.id,
                              domains: ['email'],
                              targetType:
                                prev.targetType === 'jmap' || prev.targetType === 'imap'
                                  ? prev.targetType
                                  : 'jmap',
                            }))
                          : type.id === 'google-calendar'
                            ? setFormData((prev) => ({
                                ...prev,
                                sourceType: type.id,
                                domains: ['calendar'],
                                // The one calendar-capable target (JMAP calendar
                                // is parked by owner decision, 0031 T1).
                                targetType: 'caldav',
                              }))
                            : type.id === 'google-contacts'
                              ? setFormData((prev) => ({
                                  ...prev,
                                  sourceType: type.id,
                                  domains: ['contact'],
                                  targetType:
                                    prev.targetType === 'jmap' || prev.targetType === 'carddav'
                                      ? prev.targetType
                                      : 'carddav',
                                }))
                              : updateField('sourceType', type.id)
                    }
                    className={`p-4 border-2 rounded-lg text-left transition-colors ${
                      formData.sourceType === type.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{type.name}</p>
                    <p className="text-sm text-gray-500 mt-1">{t(type.hintKey)}</p>
                  </button>
                ))}
              </div>
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

            {isDropboxSource ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.dropboxAppKey')}
                    <Required />
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.sourceClientId}
                    onChange={(e) => updateField('sourceClientId', e.target.value)}
                    className="input w-full"
                  />
                </div>
              </div>
            ) : isGmailSource || isGoogleDavSource ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.clientId')}
                    <Required />
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.sourceClientId}
                    onChange={(e) => updateField('sourceClientId', e.target.value)}
                    className="input w-full"
                    placeholder="…apps.googleusercontent.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.serviceAccountKey')}
                  </label>
                  {/* ADR-0033: pasting the key FILE selects domain-wide
                      delegation — the OAuth client and refresh token stop
                      being required. The copy under the field states the
                      grant's width; the mapping still names one subject. */}
                  <textarea
                    value={formData.sourceServiceAccountKey}
                    onChange={(e) => updateField('sourceServiceAccountKey', e.target.value)}
                    className="input w-full font-mono text-xs"
                    rows={4}
                    placeholder={t('wizard.serviceAccountKey.placeholder')}
                  />
                  <p className="mt-1 text-xs text-amber-800">
                    {t('wizard.serviceAccountKey.width')}
                  </p>
                </div>
              </div>
            ) : isDriveSource ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.clientId')}
                    <Required />
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.sourceClientId}
                    onChange={(e) => updateField('sourceClientId', e.target.value)}
                    className="input w-full"
                    placeholder="…apps.googleusercontent.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.rootFolderId')}
                  </label>
                  <input
                    type="text"
                    value={formData.sourceRootFolderId}
                    onChange={(e) => updateField('sourceRootFolderId', e.target.value)}
                    className="input w-full"
                    placeholder={t('wizard.rootFolderId.placeholder')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.serviceAccountKey')}
                  </label>
                  {/* ADR-0033: pasting the key FILE selects domain-wide
                      delegation — the OAuth client and refresh token stop
                      being required. The copy under the field states the
                      grant's width; the mapping still names one subject. */}
                  <textarea
                    value={formData.sourceServiceAccountKey}
                    onChange={(e) => updateField('sourceServiceAccountKey', e.target.value)}
                    className="input w-full font-mono text-xs"
                    rows={4}
                    placeholder={t('wizard.serviceAccountKey.placeholder')}
                  />
                  <p className="mt-1 text-xs text-amber-800">
                    {t('wizard.serviceAccountKey.width')}
                  </p>
                </div>
              </div>
            ) : isO365Source ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.tenantId')}
                    <Required />
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.sourceTenantId}
                    onChange={(e) => updateField('sourceTenantId', e.target.value)}
                    className="input w-full"
                    placeholder="contoso.onmicrosoft.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.clientId')}
                    <Required />
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.sourceClientId}
                    onChange={(e) => updateField('sourceClientId', e.target.value)}
                    className="input w-full"
                    placeholder="00000000-0000-0000-0000-000000000000"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.host')}
                    <Required />
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.sourceHost}
                    onChange={(e) => updateField('sourceHost', e.target.value)}
                    className="input w-full"
                    placeholder="imap.example.com"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('wizard.port')}
                      <Required />
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={65535}
                      value={formData.sourcePort}
                      onChange={(e) => updateField('sourcePort', e.target.value)}
                      className="input w-full"
                      placeholder="993"
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="sourceSsl"
                      checked={formData.sourceSsl}
                      onChange={(e) => updateField('sourceSsl', e.target.checked)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="sourceSsl" className="ml-2 block text-sm text-gray-700">
                      {t('wizard.useSsl')}
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'target':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">{t('wizard.selectTarget')}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {(
                  [
                    { id: 'jmap', name: 'JMAP', hintKey: 'wizard.proto.jmap.hint' },
                    { id: 'imap', name: 'IMAP', hintKey: 'wizard.proto.imap.hint' },
                    { id: 'caldav', name: 'CalDAV', hintKey: 'wizard.proto.caldav.hint' },
                    { id: 'carddav', name: 'CardDAV', hintKey: 'wizard.proto.carddav.hint' },
                    { id: 'webdav', name: 'WebDAV', hintKey: 'wizard.proto.webdav.hint' },
                  ] as const
                ).map((type) => (
                  <button
                    key={type.id}
                    onClick={() => updateField('targetType', type.id)}
                    className={`p-4 border-2 rounded-lg text-left transition-colors ${
                      formData.targetType === type.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="font-medium text-gray-900">{type.name}</p>
                    <p className="text-sm text-gray-500 mt-1">{t(type.hintKey)}</p>
                  </button>
                ))}
              </div>
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

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('wizard.host')}
                  <Required />
                </label>
                <input
                  type="text"
                  required
                  value={formData.targetHost}
                  onChange={(e) => updateField('targetHost', e.target.value)}
                  className="input w-full"
                  placeholder="jmap.example.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.port')}
                    <Required />
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={65535}
                    value={formData.targetPort}
                    onChange={(e) => updateField('targetPort', e.target.value)}
                    className="input w-full"
                    placeholder="443"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="targetSsl"
                    checked={formData.targetSsl}
                    onChange={(e) => updateField('targetSsl', e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="targetSsl" className="ml-2 block text-sm text-gray-700">
                    {t('wizard.useSsl')}
                  </label>
                </div>
              </div>

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
          </div>
        );

      case 'credentials':
        return (
          <div className="space-y-6">
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

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">{t('wizard.credentials')}</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.sourceUsername')}
                    <Required />
                  </label>
                  {/* autocomplete says what these fields ARE (0037 T3): the
                      bare inputs invited the browser to autofill the admin's
                      OWN login into the source mailbox's password field. */}
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    value={formData.sourceUsername}
                    onChange={(e) => updateField('sourceUsername', e.target.value)}
                    className="input w-full"
                    placeholder="user@example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {/* For oauth2/graph the secret beside the mailbox is the
                        app registration's CLIENT SECRET (0037 T6), not a
                        mailbox password — labeled as what it is, and required:
                        without it the client-credentials flow cannot mint a
                        single token. */}
                    {isO365Source || isGoogleSource
                      ? t('wizard.sourceClientSecret')
                      : t('wizard.sourcePassword')}
                    {(isO365Source || isGoogleSource) && <Required />}
                  </label>
                  <div className="relative">
                    <input
                      type={showSourcePassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={
                        isO365Source || isGoogleSource
                          ? formData.sourceClientSecret
                          : formData.sourcePassword
                      }
                      onChange={(e) =>
                        updateField(
                          isO365Source || isGoogleSource ? 'sourceClientSecret' : 'sourcePassword',
                          e.target.value,
                        )
                      }
                      className="input w-full pr-10"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSourcePassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                      aria-label={t(showSourcePassword ? 'wizard.hidePassword' : 'wizard.showPassword')}
                    >
                      {showSourcePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {isGoogleSource && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('wizard.refreshToken')}
                      <Required />
                    </label>
                    {/* A password in every way that matters: it grants read
                        access to that Drive until revoked. Rendered masked,
                        never echoed back by the API. */}
                    <input
                      type="password"
                      required
                      autoComplete="off"
                      value={formData.sourceRefreshToken}
                      onChange={(e) => updateField('sourceRefreshToken', e.target.value)}
                      className="input w-full"
                      placeholder="1//…"
                    />
                    <p className="mt-1 text-sm text-gray-500">{t('wizard.refreshToken.hint')}</p>
                  </div>
                )}

                {/* Workplan 0049: once the three values above are typed, the
                    shared drives they can see are one click away — and picking
                    one fills rootFolderId, the field an operator otherwise
                    fetches from the admin console by hand. Drive only: the
                    other Google sources have no root to choose. */}
                {isDriveSource && (
                  <div>
                    <button
                      type="button"
                      onClick={browseSharedDrives}
                      disabled={
                        browsing ||
                        !formData.sourceClientId ||
                        !formData.sourceClientSecret ||
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
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.targetUsername')}
                    <Required />
                  </label>
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    value={formData.targetUsername}
                    onChange={(e) => updateField('targetUsername', e.target.value)}
                    className="input w-full"
                    placeholder="user@example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('wizard.targetPassword')}
                  </label>
                  <div className="relative">
                    <input
                      type={showTargetPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={formData.targetPassword}
                      onChange={(e) => updateField('targetPassword', e.target.value)}
                      className="input w-full pr-10"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTargetPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                      aria-label={t(showTargetPassword ? 'wizard.hidePassword' : 'wizard.showPassword')}
                    >
                      {showTargetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
              {/* What happens to these secrets — a claim the code already
                  makes true (SecretStore.encryptCredentials; GET masks). */}
              <p className="mt-4 text-sm text-blue-900">{t('wizard.credentials.storage')}</p>
            </div>

            {/* The connection test (workplan 0046): the docs' "one read-only
                command that proves the credentials", as a button — because a
                managed operator has no shell. Optional: Next never gates on
                it, a probe can time out on a slow provider and the create API
                re-refuses everything anyway. */}
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={runProbes}
                  disabled={probing}
                  className="btn-secondary text-sm disabled:opacity-50"
                >
                  {probing ? t('wizard.testing') : t('wizard.testConnections')}
                </button>
                <p className="text-sm text-gray-500">{t('wizard.testConnections.hint')}</p>
              </div>
              {(probeResults.source || probeResults.target) && (
                <dl className="mt-3 space-y-2 text-sm">
                  {(['source', 'target'] as const).map((side) => {
                    const r = probeResults[side];
                    if (!r) return null;
                    return (
                      <div key={side} className="flex items-start gap-2">
                        {r.ok ? (
                          <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-600" />
                        ) : (
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
                        )}
                        <dt className="font-medium text-gray-900">
                          {t(side === 'source' ? 'wizard.step.source' : 'wizard.step.target')}:
                        </dt>
                        {/* The provider's words, verbatim (rule 9) — the same
                            sentence the first pass would have failed with. */}
                        <dd className="text-gray-700 min-w-0 break-words">
                          {r.ok ? r.detail : r.reason}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </div>
          </div>
        );

      case 'data-types':
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">
              {t('wizard.selectDataTypes')}
            </h3>
            <p className="text-sm text-gray-500">{t('wizard.selectDataTypesHint')}</p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {dataTypes.map((type) => {
                const unavailable = !allowedDomains.includes(type.id);
                // A selected-but-unavailable type stays clickable: it must be
                // DESELECTABLE, or going back and changing the target would
                // trap the wizard behind a button that cannot be un-pressed.
                const locked = unavailable && !formData.domains.includes(type.id);
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
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );

      case 'schedule':
        return (
          <div className="space-y-6">
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
                      {formData.targetType} ({formData.targetHost}:{formData.targetPort})
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
          <div>
            <p className="font-medium">{t('createMapping.createFailed')}</p>
            <p className="mt-1">{serverMessage(createMutation.error)}</p>
          </div>
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
