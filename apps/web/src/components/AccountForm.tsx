// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE ACCOUNT, ADDED AND TESTED (workplan 0153 T4; moved from the Accounts
 * page's *Add an account*, where it was written and where its tests live).
 *
 * For a card already chosen, on either side, this draws what the card asks
 * for and saves the account:
 *
 * - the fields the shared descriptor names (`credentialFieldsFor`), with a
 *   named provider's published servers already in the boxes (0106);
 * - the provider's consent, where the card's token comes from one (0114,
 *   `useProviderConsent`), which saves and tests the account in one go when
 *   it lands;
 * - *Add and test*, which saves the account and runs the probe a sync pass
 *   would run, and the probe's answer in the provider's own words.
 *
 * TWO DOORS, ONE FORM. The Accounts page draws it under its role switch and
 * provider chooser; *Start a migration* draws it on its connect and
 * destination screens, once a person has said which provider and what moves
 * (0153 T4). So both ask for the same fields, in the same words, with the
 * same consent — the drift two copies would grow is 0077's lesson.
 *
 * WHAT IS TYPED BELONGS TO THE DOOR. The values and the name are the caller's
 * state: the Accounts page keeps them through a Cancel, and the flow keeps
 * them while a person goes back and forth between its screens. What the form
 * keeps itself — the probe's answer, whether the row now exists, the consent
 * — begins afresh each time the form is drawn, so an old answer is never
 * shown (and announced) as a new one (0145 T4).
 */

import React from 'react';
import { Link } from 'react-router';
import {
  choiceDefaults,
  credentialFieldRequired,
  credentialFieldsFor,
  followedField,
  providerDefaultsProvenance,
  type CredentialField,
} from '@openmig/shared';
import { ChoiceField } from './ChoiceField.tsx';
import { ExperimentalTag, wholeDomainOptionIsExperimental } from './ExperimentalTag.tsx';
import { Hint } from './Hint.tsx';
import { ProviderConsentPanel, useProviderConsent } from './ProviderConsent.tsx';
import { isSelfHost } from '../services/edition.ts';
import { connectionsApi, type TestConnectionResult } from '../services/mapping-service.ts';
import {
  inUseMigrations,
  invalidCredentialFields,
  missingCredentialFields,
  serverMessage,
  tooManyTests,
} from '../services/api.ts';
import { conditionsRefusal } from '../services/acceptance.ts';
import { useT, useLocale, type StringKey } from '../i18n/index.tsx';
import { optionName } from '../i18n/option-name.ts';
import { measuredText, probeText, qualificationEvidence, qualificationText } from '../i18n/probe-text.ts';

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
export const useRefusalText = (fields: ReadonlyArray<{ key: string; labelKey: string }>) => {
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
      return `${t('connections.inUse.lead')} ${named}. ${t('connections.inUse.reason')}`;
    }
    // The limit on tests (0136 T3): ours, so in the reader's language.
    if (tooManyTests(err)) return t('probe.tooManyTests');
    // The texts not accepted yet (0139 T3): ours too. The screen comes up at
    // the same time (`AcceptanceGate`); this is what the form says after.
    const conditions = conditionsRefusal(err, t);
    if (conditions) return conditions;
    return serverMessage(err);
  };
};

/**
 * The example value for a field, from the descriptor (workplan 0077).
 *
 * The wizard has always shown these; the Accounts page never did, so somebody
 * adding a Dropbox connection there was asked for an "App key" with no
 * indication of what one looks like — while the same field two screens away
 * showed a shape. Since 0075 the examples live on the descriptor, so every
 * door can read them instead of one door owning them.
 */
export const usePlaceholderFor = () => {
  const t = useT();
  return (field: CredentialField): string | undefined =>
    field.placeholder ?? (field.placeholderKey ? t(field.placeholderKey as StringKey) : undefined);
};

export interface AccountFormProps {
  readonly role: 'source' | 'target';
  /** The card, already chosen: its id in `credentialFieldsFor`. */
  readonly type: string;
  /** What is typed, held by the door (see the header). */
  readonly values: Record<string, string>;
  readonly onValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** The name the account is saved under. */
  readonly displayName: string;
  readonly onDisplayName: (name: string) => void;
  /** Once the account's row exists, with the probe's answer: it is saved even when that says no. */
  readonly onAdded: (added: TestConnectionResult & { id: string }) => void;
  /** The second button, and what it does. Left out, there is none. */
  readonly onCancel?: () => void;
}

export const AccountForm: React.FC<AccountFormProps> = ({
  role,
  type,
  values,
  onValues: setValues,
  displayName,
  onDisplayName: setDisplayName,
  onAdded,
  onCancel,
}) => {
  const { t, locale } = useLocale();
  /** Prefix for the chosen option's line, which its select points at. */
  const chosenIdBase = React.useId();
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<TestConnectionResult | null>(null);
  /**
   * ONE ROW PER FORM (2026-09-06). A consent that lands saves and tests in
   * one go, and the form stays open so the person can read the verdict —
   * with the Add button live beneath it. The owner's first green Test showed
   * exactly that screen; a second press would have stored a second
   * connection with the same grant. Once a row exists the button says so and
   * does nothing; the way onward is Close.
   */
  const [added, setAdded] = React.useState(false);

  const declared = credentialFieldsFor(role, type);
  /**
   * What the form holds: what was typed, over this edition's default for every
   * choice that has one (0148 T9 — the archive's `where`). It is also what is
   * posted, so an untouched choice is sent as the answer the screen shows.
   */
  const answers: Record<string, string> = { ...choiceDefaults(declared, isSelfHost()), ...values };
  // A field's label, hint and example can follow another answer: the archive's
  // path names a folder of the destination's files, or a path on a disk.
  const fields = declared.map((field) => followedField(field, answers));
  /** Whose published settings sit in the boxes, when a named provider's do. */
  const provenance = providerDefaultsProvenance(role, type);
  const refusalText = useRefusalText(fields);
  const placeholderFor = usePlaceholderFor();
  // WHOSE CONSENT mints this kind's token, whether the deployment carries the
  // application, which faces to ask for, and the round trip itself — all of it
  // lives in one place every door imports, because Replace credentials
  // needed exactly this and had none of it (`components/ProviderConsent.tsx`).
  const consent = useProviderConsent({
    role,
    type,
    fields,
    values,
    onToken: (refreshToken) => setValues((v) => ({ ...v, refreshToken })),
    refusalText,
  });
  const deploymentClient = consent.deploymentClient;
  const clientIdTyped = (values.clientId ?? '').trim() !== '';
  const clientSecretTyped = (values.clientSecret ?? '').trim() !== '';
  // THE PAIR FOLDS AWAY where the deployment carries the application (owner
  // remark 2026-09-02): a person grants Ownpace's own, and "use your own" is
  // the exception. The pair is the descriptor's to name — an id `pairedWith`
  // its secret. Box's id is required, unpaired, and stays in plain view.
  const folded =
    deploymentClient && fields.some((f) => f.key === 'clientId' && f.pairedWith === 'clientSecret');
  const pairedSecret = folded ? fields.find((f) => f.key === 'clientSecret') : undefined;
  // AND THE TOKEN FOLDS WITH THEM (owner remark, after the first round trip):
  // on the consent path the token arrives from the provider and is never
  // typed, so a box with an asterisk above the fold asked for what the button
  // below supplies. Inside the fold it is the manual alternative it always was.
  const pairedToken = folded ? fields.find((f) => f.key === 'refreshToken') : undefined;
  const ps = consent.words;

  const submit = async (name: string = displayName) => {
    setBusy(true);
    setResult(null);
    try {
      const answer = await connectionsApi.add({ role, type, displayName: name, values: answers });
      setResult(answer);
      // Added either way — a credential that does not work YET is still worth
      // keeping while somebody chases an administrator.
      setAdded(true);
      onAdded(answer);
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
  const submitRef = React.useRef<(name?: string) => Promise<void>>(async () => {});
  submitRef.current = submit;
  React.useEffect(() => {
    if (consent.landed === 0) return;
    const name = displayName.trim() || (values.username ?? '').trim() || type;
    if (!displayName.trim()) setDisplayName(name);
    void submitRef.current(name);
    // The values of THIS render carry the token the handler just set; the
    // name is read the same way. Re-running on their later changes would
    // submit again for a keystroke, which is why only the landing counts.
  }, [consent.landed]);

  /**
   * THE ASTERISK TELLS THE TRUTH ON AN APPLIANCE TOO (2026-09-07). A client
   * pair is `required: false` because the DEPLOYMENT may carry one; where it
   * does not, the same two fields are the only way forward. Asking the
   * descriptor alone marked them optional at the one moment they were
   * mandatory. The shared rule knows the difference — and the wizard, which
   * learned this first for Google, now asks the same one.
   */
  const requiredHere = (field: CredentialField): boolean =>
    credentialFieldRequired(field, {
      deploymentClient: Boolean(deploymentClient),
      halfPairTyped: clientIdTyped !== clientSecretTyped,
      sideStepped: (values.serviceAccountKey ?? '').trim() !== '',
    });

  /** The chosen option's own line key, where it has one (0148 T3, D7). */
  const chosenHintKey = (field: CredentialField): string | undefined =>
    field.options?.find((o) => o.value === (values[field.key] ?? ''))?.hintKey;

  /** One labelled box, or a choice with an answer already marked (0148 T9). */
  const labelledBox = (field: CredentialField) =>
    field.defaultValue ? (
      // A choice with an answer already marked (0148 T9): radio buttons, the
      // way the wizard draws it, from the one component both doors use.
      <ChoiceField
        className="text-sm sm:col-span-2"
        field={field}
        name={`add-${field.key}`}
        value={values[field.key]}
        onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
      />
    ) : (
    <label className={`block text-sm ${field.multiline ? 'sm:col-span-2' : ''}`}>
      <span className="block text-gray-700 mb-1">
        {t(field.labelKey as StringKey)}
        {role === 'source' && wholeDomainOptionIsExperimental(field.key) && <ExperimentalTag />}
        {requiredHere(field) && <span className="text-red-600"> *</span>}
      </span>
      {field.multiline ? (
        <textarea
          className="input w-full font-mono text-xs"
          rows={4}
          placeholder={placeholderFor(field)}
          value={values[field.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
        />
      ) : field.options ? (
        // A CLOSED LIST IS A CHOICE, not a box to spell an id into (0116 T1's
        // `options`, first rendered here after E2E (managed) #154 found the
        // kind could be offered and not added). Which export an archive is
        // selects the reader, and a misspelt `google-takeout` is not refused
        // — the wrong reader finds none of its landmarks and reports nothing.
        <select
          className="input w-full"
          aria-describedby={chosenHintKey(field) ? `${chosenIdBase}-${field.key}` : undefined}
          value={values[field.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
        >
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {optionName(t, option)}
            </option>
          ))}
        </select>
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

  /**
   * One labelled box; where it goes is the map below's decision. Google's
   * whole-domain option, not yet run against a real Workspace (0131 T2),
   * carries the tag in its label and its why in a fold under the box, as the
   * wizard shows it. The fold sits outside the `<label>`, so its words are not
   * read as part of the box's name and pressing it does not focus the box.
   */
  const fieldBox = (field: CredentialField) =>
    role === 'source' && wholeDomainOptionIsExperimental(field.key) ? (
      <div className={`text-sm ${field.multiline ? 'sm:col-span-2' : ''}`}>
        {labelledBox(field)}
        <Hint className="mt-1" why={t('frontDoor.experimental.wholeDomain.why')} />
      </div>
    ) : (
      labelledBox(field)
    );

  /**
   * The chosen option's own line, under its field (0148 T3, D7): an export no
   * reader opens yet says so before anybody asks Apple for a week's wait. A
   * sibling of the label rather than inside it, so it is not read out as part
   * of the field's name.
   */
  const chosenLine = (field: CredentialField) => {
    const key = chosenHintKey(field);
    // It appears on a choice, so it is a status a screen reader announces,
    // and the select's description while it stands.
    return key ? (
      <div id={`${chosenIdBase}-${field.key}`} role="status" className="sm:col-span-2">
        <Hint text={t(key as StringKey)} tone="caution" />
      </div>
    ) : null;
  };

  return (
    <>
      {provenance && (
        <p className="mt-2 text-xs text-gray-600">{t('wizard.providerDefaults.note', provenance)}</p>
      )}

      {/* Read the asterisks: one line, because "(optional)" is gone from the
          labels and the marker is now the only thing that says which fields
          this deployment demands. Only where there IS one — before a kind is
          picked there are no fields, and a legend about a marker nobody can
          see explains nothing. */}
      {fields.some(requiredHere) && (
        <p className="mt-4 text-xs text-gray-500">{t('form.requiredLegend')}</p>
      )}

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
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
                  {ps('ownClient')}
                </summary>
                <p className="mt-2 text-sm text-gray-500">{ps('deploymentClient')}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {fieldBox(field)}
                  {pairedSecret && fieldBox(pairedSecret)}
                  {pairedToken && fieldBox(pairedToken)}
                </div>
              </details>
            );
          }
          return (
            <React.Fragment key={field.key}>
              {fieldBox(field)}
              {chosenLine(field)}
            </React.Fragment>
          );
        })}
      </div>

      <ProviderConsentPanel consent={consent} />

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
            result.said,
          )}
          {result.qualification && (
            <span className="block mt-1">{qualificationText(t, result.qualification)}</span>
          )}
          {result.qualification && measuredText(t, result.qualification, locale) && (
            <span className="block mt-1">{measuredText(t, result.qualification, locale)}</span>
          )}
          {result.qualificationPending && (
            /* The door answered before the measuring finished (2026-09-02). */
            <span className="block mt-1">{t('probe.measuring')}</span>
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
          disabled={busy || added || !displayName.trim()}
          onClick={() => void submit()}
          className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {busy ? t('connections.testing') : added ? t('connections.added') : t('connections.addAndTest')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 border border-gray-300 rounded">
            {added ? t('common.close') : t('common.cancel')}
          </button>
        )}
      </div>
    </>
  );
};
