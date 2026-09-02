// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Connections, as things you can see and re-test (workplan 0062).
 *
 * These rows have always existed — creating a mapping inserts two — but
 * nothing ever showed them, so a credential could expire and the only way to
 * find out was a failing pass. The point of this page is the **Test** button:
 * it runs the same read-only probe the wizard runs, through the builders a
 * sync pass uses, against the stored credentials, and shows the provider's
 * own words.
 *
 * A refusal is an ANSWER here, not an error state: "your refresh token was
 * revoked" is exactly what somebody came to find out, so it renders as text
 * rather than a toast that disappears.
 */

import React from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, HelpCircle, Loader2 } from 'lucide-react';
import {
  credentialFieldsFor,
  wizardTypeForConnectionKind,
  type CredentialField,
} from '@openmig/shared';
import { FrontDoorChooser } from '../components/FrontDoorChooser.tsx';
import { frontDoorCards } from '../components/front-door-cards.ts';
import {
  connectionsApi,
  mappingApi,
  type ConnectionSummary,
  type TestConnectionResult,
  providerAccountsApi,
} from '../services/mapping-service.ts';
import { useT, useLocale, useFormatters, type StringKey } from '../i18n/index.tsx';
import { probeText, qualificationEvidence, qualificationText, schedulingText } from '../i18n/probe-text.ts';
import {
  inUseMigrations,
  invalidCredentialFields,
  missingCredentialFields,
  serverMessage,
} from '../services/api.ts';

/**
 * A refusal in the reader's own language wherever we authored it (0071).
 *
 * A provider's words render verbatim — that is the whole value of a probe
 * result, and translating it would put a layer between the operator and the
 * console they must paste it into. But `missing_fields` is OUR refusal about
 * OUR form, and it arrived as English prose naming storage keys: the owner met
 * `Still needed: clientId.` in a Dutch UI, beside a form whose matching input
 * is labelled *App-sleutel*. The keys are the handle; the labels already exist
 * (the descriptor reuses the wizard's own i18n keys), so this renders the same
 * sentence the wizard's blocked-Next line renders.
 */
const useRefusalText = (fields: ReadonlyArray<{ key: string; labelKey: string }>) => {
  const t = useT();
  return (err: unknown): string => {
    const label = (key: string) => {
      const field = fields.find((f) => f.key === key);
      // An unknown key is shown as itself rather than swallowed: a descriptor
      // and a route that disagree is a bug worth seeing.
      return field ? t(field.labelKey as StringKey) : key;
    };

    const missing = missingCredentialFields(err);
    if (missing) return `${t('wizard.missing.lead')} ${missing.map(label).join(', ')}`;

    // Filled in, but the wrong shape — a different sentence from "still
    // needed", and no longer a raw zod path in English (0072).
    const invalid = invalidCredentialFields(err);
    if (invalid) {
      return `${t('connections.invalidValues.lead')} ${invalid.map(label).join(', ')}`;
    }
    const inUse = inUseMigrations(err);
    if (inUse) {
      // The names are the server's, the frame is ours (0068 T4's three
      // questions, in the reader's language and two lines rather than five).
      // A nameless migration still gets a Dutch sentence — dropping back to
      // the server's English for it was the 0072 regression.
      const named =
        inUse.names.length > 0
          ? inUse.names.map((n) => `“${n}”`).join(', ')
          : t('connections.inUse.unnamed');
      return `${t('connections.inUse.lead')} ${named}. ${t('connections.inUse.why')}`;
    }
    return serverMessage(err);
  };
};

/**
 * The example value for a field, from the descriptor (workplan 0077).
 *
 * The wizard has always shown these; this form never did, so somebody adding
 * a Dropbox connection here was asked for an "App key" with no indication of
 * what one looks like — while the same field two screens away showed a shape.
 * Since 0075 the examples live on the descriptor, so both doors can read them
 * instead of one door owning them.
 */
const usePlaceholderFor = () => {
  const t = useT();
  return (field: CredentialField): string | undefined =>
    field.placeholder ?? (field.placeholderKey ? t(field.placeholderKey as StringKey) : undefined);
};

const StatusIcon: React.FC<{ status: ConnectionSummary['status'] }> = ({ status }) => {
  if (status === 'connected') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  if (status === 'error') return <XCircle className="w-4 h-4 text-red-600" />;
  return <HelpCircle className="w-4 h-4 text-gray-400" />;
};

const Row: React.FC<{ connection: ConnectionSummary; onChanged: () => void }> = ({
  connection,
  onChanged,
}) => {
  const { t, locale } = useLocale();
  const { relativeToNow } = useFormatters();
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<TestConnectionResult | null>(null);
  const [rotating, setRotating] = React.useState(false);
  const [newValues, setNewValues] = React.useState<Record<string, string>>({});

  /**
   * Every field the rotate ROUTE requires, plus the secrets (workplan 0071).
   *
   * This used to be `f.secret || f.key === 'username'`, on the reasoning that
   * rotation replaces a credential and re-presenting a root folder id would
   * invite somebody to change where a migration is rooted while fixing a
   * login. That reasoning is still right, and it is why the non-required
   * extras stay out — but it silently dropped the required fields that are
   * not secret, and the route validates EVERY required field. Dropbox's App
   * key is required and not a secret, so the panel could not supply it and
   * the refusal read `Still needed: clientId.` — naming a storage key for an
   * input that was never on screen. Rotation was therefore impossible for
   * every type except the four Google ones: box, dropbox, graph, oauth2, imap
   * and EVERY target were all dead ends (the owner found it on Dropbox).
   *
   * This is the fourth time a gate has demanded a field its screen does not
   * render — 0037 T1, 0067 T1, 0067 T2 — so the rule is pinned by a test
   * across every connectable type rather than restated in a comment.
   */
  const placeholderFor = usePlaceholderFor();
  const allFields = credentialFieldsFor(
    connection.role,
    wizardTypeForConnectionKind(connection.kind),
  );
  // And the OTHER HALF of any pair a secret belongs to (ADR-0041): a Google
  // client id is neither required nor secret since the deployment may carry
  // the client, and a panel offering the secret alone sent half a pair to a
  // door that now refuses exactly that. The descriptor says which field is
  // whose partner; this reads it rather than naming Google here.
  const rotatableFields = allFields.filter((f) => f.required || f.secret || f.pairedWith);
  const refusalText = useRefusalText(allFields);

  /** The server decides whether this is allowed; its refusal is the message. */
  const remove = async () => {
    setTesting(true);
    setResult(null);
    try {
      await connectionsApi.remove(connection.id);
      onChanged();
    } catch (err) {
      setResult({ ok: false, reason: refusalText(err) });
    } finally {
      setTesting(false);
    }
  };

  const rotate = async () => {
    setTesting(true);
    setResult(null);
    try {
      const answer = await connectionsApi.rotate(connection.id, newValues);
      setResult(answer);
      if (answer.rotated) {
        setRotating(false);
        setNewValues({});
        onChanged();
      }
    } catch (err) {
      setResult({ ok: false, reason: refusalText(err) });
    } finally {
      setTesting(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await connectionsApi.test(connection.id));
    } catch (err) {
      setResult({ ok: false, reason: serverMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <li className="border border-gray-200 rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusIcon status={connection.status} />
        <span className="font-medium text-gray-900">{connection.displayName}</span>
        <span className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
          {connection.kind}
        </span>
        <span className="text-sm text-gray-500">
          {connection.usedByMailboxes} {t('connections.usedBy')}
        </span>
        <span className="text-xs text-gray-400">{relativeToNow(connection.createdAt)}</span>
        {connection.qualification && (
          /* What the LAST test measured this account can carry (0106 T2) —
             the stored record, visible without pressing Test. The title
             carries each domain's evidence line for whoever hovers. */
          <span
            className="text-xs text-gray-500"
            title={(['mail', 'calendar', 'contact', 'file'] as const)
              .map((d) => connection.qualification!.domains[d].detail)
              .join('\n')}
          >
            {qualificationText(t, connection.qualification)}
          </span>
        )}
        {/* And WHY each `?` is a `?`, on screen (2026-09-02): the hover
            above is not on a phone, and the sentence is the remedy. */}
        {qualificationEvidence(t, connection.qualification ?? undefined).map((line) => (
          <span key={line} className="block w-full text-xs text-amber-800 break-words">
            {line}
          </span>
        ))}

        {/* wrap, and only push right once there is room to (workplan 0068):
            on a phone these four actions overflowed the card horizontally and
            the last one sat off-screen. */}
        <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          {/* The prerequisites for this provider, in case the answer is
              "somebody has to re-authorise the app". */}
          <Link
            // BY WIZARD TYPE, not by kind: the profiles are keyed the wizard's
            // way, and looking one up by kind answers an empty checklist that
            // reads as "nothing to set up" (workplan 0065).
            to={`/setup/${connection.role}/${wizardTypeForConnectionKind(connection.kind)}`}
            // Say where this link came FROM, so the checklist's back link
            // returns here instead of to a wizard nobody opened (0074).
            state={{ from: '/connections' }}
            className="text-sm text-blue-700 hover:underline"
          >
            {t('connections.setupSteps')}
          </Link>
          <button
            type="button"
            onClick={test}
            disabled={testing}
            className="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {testing && <Loader2 className="w-3 h-3 animate-spin" />}
            {testing ? t('connections.testing') : t('connections.test')}
          </button>
          <button
            type="button"
            onClick={() =>
              setRotating((open) => {
                // Opening: start from what the connection ALREADY knows
                // (workplan 0078). Rotating an expired secret used to mean
                // retyping the server address and the account name that had
                // not changed. Only non-secret config values arrive here —
                // the encrypted record is never opened — so the secrets are
                // still, correctly, blank.
                if (!open) setNewValues({ ...(connection.knownValues ?? {}) });
                return !open;
              })
            }
            className="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
          >
            {t('connections.rotate')}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={testing}
            className="text-sm px-3 py-1 border border-gray-300 rounded text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {t('connections.delete')}
          </button>
        </div>
      </div>

      {rotating && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          <p className="text-sm text-gray-600">{t('connections.rotate.hint')}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {rotatableFields.map((field) => (
              <label key={field.key} className="text-sm">
                <span className="block text-gray-700 mb-1">{t(field.labelKey as StringKey)}</span>
                <input
                  // A numeric field says so (0072): a port asked for in a bare
                  // text box came back as `port: Invalid input: expected
                  // number, received NaN` — a zod path, in English, for a
                  // mistake the input could have prevented.
                  type={field.secret ? 'password' : field.numeric ? 'number' : 'text'}
                  inputMode={field.numeric ? 'numeric' : undefined}
                  autoComplete={field.autoComplete ?? (field.secret ? 'new-password' : 'off')}
                  // The example the wizard has always shown, from the same
                  // descriptor (0077) — an App key is a good deal easier to
                  // paste correctly when the box says what one looks like.
                  placeholder={placeholderFor(field)}
                  className="input w-full"
                  value={newValues[field.key] ?? ''}
                  onChange={(e) =>
                    setNewValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={testing}
            onClick={rotate}
            className="mt-3 text-sm px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50"
          >
            {testing ? t('connections.testing') : t('connections.rotate.save')}
          </button>
        </div>
      )}

      {result && (
        <p
          className={`mt-3 text-sm ${result.ok ? 'text-green-800 bg-green-50 border-green-200' : 'text-amber-900 bg-amber-50 border-amber-200'} border rounded p-2`}
        >
          {/* Verbatim, both ways: the provider's sentence is the whole value. */}
          {probeText(
            t,
            result.outcome,
            result.ok ? (result.detail ?? t('connections.ok')) : (result.reason ?? t('connections.failed')),
            locale,
          )}
          {result.scheduling && (
            /* What this target will DO with calendar writes (0105 T0) —
               measured by the probe, said in the reader's language. */
            <span className="block mt-1">{schedulingText(t, result.scheduling)}</span>
          )}
          {result.qualification && (
            /* What this account CAN CARRY (0106 T0) — per domain, measured. */
            <span className="block mt-1">{qualificationText(t, result.qualification)}</span>
          )}
          {qualificationEvidence(t, result.qualification).map((line) => (
            /* Why a face is `?` — on screen, since a phone has no hover. */
            <span key={line} className="block mt-1 text-xs break-words">
              {line}
            </span>
          ))}
        </p>
      )}
    </li>
  );
};

/**
 * Add a connection without creating a mapping.
 *
 * The FIELDS come from the shared descriptor, so this form and the wizard ask
 * for the same things in the same words — and a provider added in the
 * descriptor appears here with no change to this file. What the server does
 * with the answers is the create route's shape builders, unchanged, so a
 * connection added here is one a sync pass can use.
 */
/** The faces a Google account can be asked to serve — the wizard's domain
 *  ids, and the consent route's own union. */
type Domain = 'email' | 'calendar' | 'contact' | 'file';
const GRANT_FACES: ReadonlyArray<Domain> = ['email', 'calendar', 'contact', 'file'];

const AddConnection: React.FC<{ onAdded: () => void }> = ({ onAdded }) => {
  const { t, locale } = useLocale();
  const [open, setOpen] = React.useState(false);
  const [role, setRole] = React.useState<'source' | 'target'>('source');
  // The first card of the side, the same one the role switch below lands on —
  // so opening the form and switching the role read as the same door.
  const [type, setType] = React.useState(frontDoorCards('source')[0]?.id ?? '');
  const [displayName, setDisplayName] = React.useState('');
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<TestConnectionResult | null>(null);

  const fields = credentialFieldsFor(role, type);
  const refusalText = useRefusalText(fields);
  const placeholderFor = usePlaceholderFor();
  // The same fact the wizard reads (ADR-0041): does this deployment carry its
  // own Google client? Read over the wire, never compiled in, and defaulting
  // to "no" while the answer is on its way — the direction that cannot
  // under-ask.
  const { data: providerAccounts } = useQuery({
    queryKey: ['provider-accounts'],
    queryFn: providerAccountsApi.get,
    retry: false,
    staleTime: Infinity,
  });
  const deploymentGoogleClient = providerAccounts?.google?.client === 'deployment';
  // THE PAIR FOLDS AWAY where the deployment carries the client (owner
  // remark 2026-09-02): a person grants Ownpace's own application, and "use
  // your own" is the exception. Which kinds have such a pair is the
  // descriptor's to say — an id `pairedWith` its secret — not a Google list
  // kept in this page. Dropbox's and Box's ids are required, unpaired, and
  // stay in plain view.
  const folded =
    role === 'source' &&
    deploymentGoogleClient &&
    fields.some((f) => f.key === 'clientId' && f.pairedWith === 'clientSecret');
  const pairedSecret = folded ? fields.find((f) => f.key === 'clientSecret') : undefined;
  // AND THE TOKEN FOLDS WITH THEM (owner remark, after the first round trip):
  // on the consent path the token arrives from Google and is never typed, so
  // a box with an asterisk above the fold asked for what the button below
  // supplies. Inside the fold it is the manual alternative it always was.
  const pairedToken = folded ? fields.find((f) => f.key === 'refreshToken') : undefined;

  // THE CONSENT YOU CAN CLICK, on this door too (owner step 4, 2026-09-02).
  // The wizard has had it since 0089 T1; this form folded the pair away
  // (#709) and left no way to obtain the token the fold took the pair from —
  // on a managed deployment its Gmail and Drive paths were dead ends. Which
  // kinds have a consent is the descriptor's answer, as the fold's is: an id
  // paired with its secret AND a refresh token to fill — Google's own kinds,
  // and not Dropbox, whose id is unpaired.
  const googleGrantKind =
    role === 'source' &&
    fields.some((f) => f.key === 'clientId' && f.pairedWith === 'clientSecret') &&
    fields.some((f) => f.key === 'refreshToken');
  // The ACCOUNT kind asks for the faces ticked and nothing else (0106 T3b);
  // a connection has no mapping yet to read them from, so it asks here.
  const isAccountKind = googleGrantKind && type === 'google';
  const [domains, setDomains] = React.useState<Domain[]>([]);
  const [googleConsent, setGoogleConsent] = React.useState<string | null>(null);
  const [googleRedirect, setGoogleRedirect] = React.useState<string | null>(null);
  const clientIdTyped = (values.clientId ?? '').trim() !== '';
  const clientSecretTyped = (values.clientSecret ?? '').trim() !== '';
  // One half typed is a pair being typed, never a pair left to the
  // deployment (ADR-0041): both or neither, as every door refuses it.
  const pairRequired = !deploymentGoogleClient || clientIdTyped !== clientSecretTyped;
  const ownPair =
    clientIdTyped && clientSecretTyped
      ? { clientId: (values.clientId ?? '').trim(), clientSecret: values.clientSecret ?? '' }
      : {};
  const pairMissing = pairRequired && !(clientIdTyped && clientSecretTyped);
  const facesMissing = isAccountKind && domains.length === 0;

  // The popup hands the token back over postMessage; the wizard's own rule
  // applies verbatim — same origin, the flow's own shape, a non-empty token —
  // and it lands in the SAME field a pasted one does (ADR-0037).
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; refreshToken?: string } | null;
      if (event.origin !== window.location.origin) return;
      if (!data || data.type !== 'ownpace-google-consent') return;
      if (typeof data.refreshToken !== 'string' || data.refreshToken.length === 0) return;
      setValues((v) => ({ ...v, refreshToken: data.refreshToken as string }));
      setGoogleConsent('received');
      setConsentLanded((n) => n + 1);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const startGoogleConsent = async () => {
    setGoogleConsent(null);
    try {
      const { url, redirectUri } = await mappingApi.googleAuthorize(
        isAccountKind
          ? { domains, ...ownPair }
          : {
              sourceType: type as 'gmail' | 'google-calendar' | 'google-contacts' | 'google-drive',
              ...ownPair,
            },
      );
      // The address this consent used, shown on every attempt: it has to be
      // registered with Google BEFORE the first one can work.
      setGoogleRedirect(redirectUri ?? null);
      window.open(url, 'ownpace-google-consent', 'popup,width=520,height=640');
    } catch (err) {
      setGoogleConsent(refusalText(err));
    }
  };

  const resetConsent = () => {
    setDomains([]);
    setGoogleConsent(null);
    setGoogleRedirect(null);
  };

  const submit = async (name: string = displayName) => {
    setBusy(true);
    setResult(null);
    try {
      const answer = await connectionsApi.add({ role, type, displayName: name, values });
      setResult(answer);
      // Added either way — a credential that does not work YET is still worth
      // keeping while somebody chases an administrator.
      onAdded();
    } catch (err) {
      setResult({ ok: false, reason: refusalText(err) });
    } finally {
      setBusy(false);
    }
  };

  /**
   * ONE GO (owner remark 2026-09-02): a consent that lands saves and tests
   * the connection at once — the grant is the person's word, and pressing
   * Add after it was a second word for the same thing. The name defaults to
   * the address when none was typed, the way the wizard names what it saves.
   * A counter, not the 'received' flag, so a second consent submits again.
   */
  const [consentLanded, setConsentLanded] = React.useState(0);
  const submitRef = React.useRef<(name?: string) => Promise<void>>(async () => {});
  submitRef.current = submit;
  React.useEffect(() => {
    if (consentLanded === 0) return;
    const name = displayName.trim() || (values.username ?? '').trim() || type;
    if (!displayName.trim()) setDisplayName(name);
    void submitRef.current(name);
    // The values of THIS render carry the token the handler just set; the
    // name is read the same way. Re-running on their later changes would
    // submit again for a keystroke, which is why only the landing counts.
  }, [consentLanded]);

  /** One labelled box; where it goes is the map below's decision. */
  const fieldBox = (field: CredentialField) => (
    <label className={`text-sm ${field.multiline ? 'sm:col-span-2' : ''}`}>
      <span className="block text-gray-700 mb-1">
        {t(field.labelKey as StringKey)}
        {field.required && <span className="text-red-600"> *</span>}
      </span>
      {field.multiline ? (
        <textarea
          className="input w-full font-mono text-xs"
          rows={4}
          placeholder={placeholderFor(field)}
          value={values[field.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
        />
      ) : (
        <input
          // Secrets are masked here for the same reason they are never
          // returned by the API: nothing should read one over a shoulder;
          // a numeric field is numeric here too (0072).
          type={field.secret ? 'password' : field.numeric ? 'number' : 'text'}
          inputMode={field.numeric ? 'numeric' : undefined}
          autoComplete={field.autoComplete ?? (field.secret ? 'new-password' : 'off')}
          placeholder={placeholderFor(field)}
          className="input w-full"
          value={values[field.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
        />
      )}
    </label>
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 text-sm px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50"
      >
        {t('connections.add')}
      </button>
    );
  }

  return (
    <div className="mt-4 border border-gray-200 rounded-lg p-4">
      <h3 className="font-medium text-gray-900">{t('connections.add')}</h3>

      {/* THE SAME DOOR THE WIZARD DRAWS (workplan 0107; owner remark
          2026-09-01). This used to be two drop-downs — role, then a
          `<select>` of raw ids in `<optgroup>`s — which was "the same
          authority, rendered plainly" and read, next to the wizard's cards,
          as a different product. Now the role is a two-way switch and the
          provider is the wizard's own chooser: icons, names, hints, family
          headings, from the one component. Presentation only — every id,
          field and stored kind is exactly what it was. */}
      <div className="mt-3">
        <span className="block text-sm text-gray-700 mb-1">{t('connections.role')}</span>
        <div role="radiogroup" aria-label={t('connections.role')} className="inline-flex rounded-md border border-gray-300 overflow-hidden">
          {(['source', 'target'] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={role === r}
              onClick={() => {
                setRole(r);
                setType(frontDoorCards(r)[0]?.id ?? '');
                setValues({});
                setResult(null);
                resetConsent();
              }}
              className={`px-4 py-1.5 text-sm font-medium ${
                role === r ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {r === 'source' ? t('connections.sources') : t('connections.targets')}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <span className="block text-sm text-gray-700 mb-2">{t('connections.type')}</span>
        <FrontDoorChooser
          cards={frontDoorCards(role)}
          selectedId={type}
          onPick={(card) => {
            setType(card.id);
            setValues({});
            setResult(null);
            resetConsent();
          }}
          gridClass={role === 'source' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          <span className="block text-gray-700 mb-1">{t('connections.name')}</span>
          <input
            className="input w-full"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>

        {fields.map((field) => {
          if (folded && (field.key === 'clientSecret' || field.key === 'refreshToken')) return null;
          if (folded && field.key === 'clientId') {
            return (
              <details key={field.key} className="sm:col-span-2 rounded-md border border-gray-200 p-3">
                <summary className="cursor-pointer text-sm text-gray-700">
                  {t('wizard.google.ownClient')}
                </summary>
                <p className="mt-2 text-sm text-gray-500">{t('wizard.google.deploymentClient')}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {fieldBox(field)}
                  {pairedSecret && fieldBox(pairedSecret)}
                  {pairedToken && fieldBox(pairedToken)}
                </div>
              </details>
            );
          }
          return <React.Fragment key={field.key}>{fieldBox(field)}</React.Fragment>;
        })}
      </div>

      {googleGrantKind && (
        <div className="mt-4">
          {isAccountKind && (
            <fieldset className="mb-3">
              <legend className="block text-sm text-gray-700 mb-1">
                {t('connections.googleFaces')}
              </legend>
              <div className="flex flex-wrap gap-4">
                {GRANT_FACES.map((face) => (
                  <label key={face} className="inline-flex items-center gap-1 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={domains.includes(face)}
                      onChange={() =>
                        setDomains((d) => (d.includes(face) ? d.filter((x) => x !== face) : [...d, face]))
                      }
                    />
                    {t(`domain.${face}` as StringKey)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <button
            type="button"
            onClick={startGoogleConsent}
            disabled={pairMissing || facesMissing}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            title={
              pairMissing
                ? deploymentGoogleClient
                  ? t('wizard.google.connect.halfClient')
                  : t('wizard.google.connect.needsClient')
                : facesMissing
                  ? t('wizard.google.connect.needsDomains')
                  : undefined
            }
          >
            {t('wizard.google.connect')}
          </button>
          <p className="mt-1 text-sm text-gray-500">{t('wizard.google.connect.hint')}</p>
          {googleConsent && (
            <p className={`mt-1 text-sm ${googleConsent === 'received' ? 'text-green-700' : 'text-amber-800'}`}>
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

      {/* The prerequisites for whatever is selected — often the reason a value
          is missing is that nobody has been to the provider's console yet. */}
      <p className="mt-3">
        <Link to={`/setup/${role}/${type}`} className="text-sm text-blue-700 hover:underline">
          {t('connections.setupSteps')}
        </Link>
      </p>

      {result && (
        <p
          className={`mt-3 text-sm border rounded p-2 ${result.ok ? 'text-green-800 bg-green-50 border-green-200' : 'text-amber-900 bg-amber-50 border-amber-200'}`}
        >
          {probeText(
            t,
            result.outcome,
            result.ok ? (result.detail ?? t('connections.ok')) : (result.reason ?? t('connections.failed')),
            locale,
          )}
          {result.scheduling && (
            <span className="block mt-1">{schedulingText(t, result.scheduling)}</span>
          )}
          {result.qualification && (
            <span className="block mt-1">{qualificationText(t, result.qualification)}</span>
          )}
          {qualificationEvidence(t, result.qualification).map((line) => (
            <span key={line} className="block mt-1 text-xs break-words">
              {line}
            </span>
          ))}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || !displayName.trim()}
          onClick={() => void submit()}
          className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {busy ? t('connections.testing') : t('connections.addAndTest')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm px-3 py-1.5 border border-gray-300 rounded"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
};

const Connections: React.FC = () => {
  const t = useT();
  const { data, isLoading, error, refetch } = useQuery<ConnectionSummary[]>({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
  });

  if (isLoading) return <div className="p-6 text-gray-500">{t('common.loading')}</div>;
  if (error) return <div className="p-6 text-red-700">{serverMessage(error)}</div>;

  const sources = (data ?? []).filter((c) => c.role === 'source');
  const targets = (data ?? []).filter((c) => c.role === 'target');

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-xl font-semibold text-gray-900">{t('connections.title')}</h2>
      <p className="mt-1 text-sm text-gray-600">{t('connections.intro')}</p>

      <AddConnection onAdded={() => void refetch()} />

      {(data ?? []).length === 0 ? (
        <p className="mt-6 text-gray-600">{t('connections.none')}</p>
      ) : (
        <>
          <h3 className="mt-6 font-medium text-gray-900">{t('connections.sources')}</h3>
          <ul className="mt-2 space-y-3">
            {sources.map((c) => (
              <Row key={c.id} connection={c} onChanged={() => void refetch()} />
            ))}
          </ul>

          <h3 className="mt-6 font-medium text-gray-900">{t('connections.targets')}</h3>
          <ul className="mt-2 space-y-3">
            {targets.map((c) => (
              <Row key={c.id} connection={c} onChanged={() => void refetch()} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default Connections;
