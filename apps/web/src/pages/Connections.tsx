// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
  connectableTypes,
  credentialFieldsFor,
  wizardTypeForConnectionKind,
  type CredentialField,
} from '@openmig/shared';
import {
  connectionsApi,
  type ConnectionSummary,
  type TestConnectionResult,
} from '../services/mapping-service';
import { useT, useFormatters, type StringKey } from '../i18n';
import { probeText } from '../i18n/probe-text';
import {
  inUseMigrations,
  invalidCredentialFields,
  missingCredentialFields,
  serverMessage,
} from '../services/api';

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
  const t = useT();
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
  const rotatableFields = allFields.filter((f) => f.required || f.secret);
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
          )}
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
const AddConnection: React.FC<{ onAdded: () => void }> = ({ onAdded }) => {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [role, setRole] = React.useState<'source' | 'target'>('source');
  const [type, setType] = React.useState('box');
  const [displayName, setDisplayName] = React.useState('');
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<TestConnectionResult | null>(null);

  const fields = credentialFieldsFor(role, type);
  const refusalText = useRefusalText(fields);
  const placeholderFor = usePlaceholderFor();

  const submit = async () => {
    setBusy(true);
    setResult(null);
    try {
      const answer = await connectionsApi.add({ role, type, displayName, values });
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

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block text-gray-700 mb-1">{t('connections.role')}</span>
          <select
            className="input w-full"
            value={role}
            onChange={(e) => {
              const next = e.target.value as 'source' | 'target';
              setRole(next);
              setType(connectableTypes(next)[0] ?? '');
              setValues({});
            }}
          >
            <option value="source">{t('connections.sources')}</option>
            <option value="target">{t('connections.targets')}</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-gray-700 mb-1">{t('connections.type')}</span>
          <select
            className="input w-full"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setValues({});
            }}
          >
            {connectableTypes(role).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm sm:col-span-2">
          <span className="block text-gray-700 mb-1">{t('connections.name')}</span>
          <input
            className="input w-full"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </label>

        {fields.map((field) => (
          <label key={field.key} className={`text-sm ${field.multiline ? 'sm:col-span-2' : ''}`}>
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
        ))}
      </div>

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
          )}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || !displayName.trim()}
          onClick={submit}
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
