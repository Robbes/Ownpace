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
import { CheckCircle2, XCircle, HelpCircle, Loader2, Plus } from 'lucide-react';
import {
  credentialFieldsFor,
  isFailureCategory,
  formDefaultsFor,
  wizardTypeForConnectionKind,
  type FailureCategory,
} from '@openmig/shared';
import { connectionKindName } from '../components/ProviderTile.tsx';
import { FrontDoorChooser } from '../components/FrontDoorChooser.tsx';
import { frontDoorCards, type FrontDoorCard } from '../components/front-door-cards.ts';
import { isSelfHost } from '../services/edition.ts';
import { EXPORT_CARD } from '../services/start-plan.ts';
import {
  type ConnectionDeleted,
  connectionsApi,
  type ConnectionSummary,
  type TestConnectionResult,
} from '../services/mapping-service.ts';
import { useT, useLocale, useFormatters, type StringKey } from '../i18n/index.tsx';
import {
  measuredText,
  probeText,
  qualificationEvidence,
  qualificationText,
} from '../i18n/probe-text.ts';
// The remedy sentence per failure category — the one map the migration page
// and the operator's support screen read too, so all three say the same words.
import { FAILURE_KEY } from '../i18n/failure-key.ts';
import { SendItToUs } from '../components/SendItToUs.tsx';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import { serverMessage } from '../services/api.ts';
import { QUALIFICATION_KEYS } from '@openmig/shared';
import { Hint } from '../components/Hint.tsx';
import { ProviderConsentPanel, useProviderConsent } from '../components/ProviderConsent.tsx';
import { AccountForm, usePlaceholderFor, useRefusalText } from '../components/AccountForm.tsx';

/**
 * The categories where the CONNECTION is the thing to act on (workplan 0094
 * T5), so the standing line invites a Test to tell which of a migration's two
 * connections failed.
 *
 * EVERY OTHER CATEGORY IS LEFT OUT FOR ITS OWN REASON, and this comment said
 * "the other three resolve on their own" until 2026-09-18 — true of the six,
 * and quietly false from the moment there were eight. Three kinds of absence,
 * and none of them wants a Test:
 *
 *  - `rate_limited`, `quota_exceeded`, `network` resolve on their own, and
 *    their sentence says "no action needed"; a tail inviting a Test would
 *    contradict it.
 *  - `source_refused` and `format_refused` DO need a person, but not here —
 *    the thing to change is a file's sharing setting or the mapping's export
 *    format, and the connection is fine.
 *  - `policy_refused` is this migration's own decision (0125 T4). Testing a
 *    connection over it would be the wrong errand in the purest form: nothing
 *    about either account is in question.
 *  - `too_large` is this service's own limit (0143 T4): a file larger than a
 *    pass may carry, refused before a byte was read. Neither account is in
 *    question there either.
 */
const ASK_TEST: ReadonlySet<FailureCategory> = new Set<FailureCategory>([
  'auth_expired',
  'target_refused',
  'unknown',
]);

/**
 * The stored kinds that more than one card saves as, where those cards'
 * checklists differ (workplan 0148 T5 (a)).
 *
 * *Via IMAP* and *Via the Graph API* both store `o365` with the same fields,
 * and nothing on a stored row says which card made it.
 * `wizardTypeForConnectionKind` answers `graph`, which is right for the fields
 * and wrong for a Via IMAP connection's checklist: its token needs Office 365
 * Exchange Online's `IMAP.AccessAsApp`, and Graph's recipe says `Mail.Read`
 * and nothing else. So the row links both checklists, each by its card's
 * name, and the person picks the card they used.
 */
const CARDS_OF_ONE_KIND: ReadonlyMap<string, ReadonlyArray<{ type: string; nameKey: StringKey }>> = new Map([
  [
    'o365',
    [
      { type: 'oauth2', nameKey: 'wizard.m365.viaImap' },
      { type: 'graph', nameKey: 'wizard.m365.viaGraph' },
    ],
  ],
]);

const StatusIcon: React.FC<{ status: ConnectionSummary['status'] }> = ({ status }) => {
  if (status === 'connected') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  if (status === 'error') return <XCircle className="w-4 h-4 text-red-600" />;
  return <HelpCircle className="w-4 h-4 text-gray-400" />;
};

const Row: React.FC<{
  connection: ConnectionSummary;
  onChanged: () => void;
  /**
   * A delete that went through, with what happened to the grant behind it.
   * Lifted to the page rather than shown here: `onChanged` refetches the list
   * and this row is gone with it, and the one sentence that matters — "we
   * could not revoke it, withdraw it yourself" — must outlive the row.
   */
  onRemoved: (answer: ConnectionDeleted | null) => void;
}> = ({ connection, onChanged, onRemoved }) => {
  const { t, locale } = useLocale();
  const { relativeToNow } = useFormatters();
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<TestConnectionResult | null>(null);
  const [rotating, setRotating] = React.useState(false);
  const [newValues, setNewValues] = React.useState<Record<string, string>>({});
  // Where one link to a checklist would pick a card for the person (0148 T5 (a)).
  const cardsOfThisKind = CARDS_OF_ONE_KIND.get(connection.kind);

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
  // AND THE WAY TO OBTAIN ONE (owner, 2026-09-08). A refresh token is the
  // credential most likely to need replacing — it is the one a provider
  // revokes — and this panel offered a box for it with no button beside it.
  // On a managed deployment the person has no client pair of their own, so
  // there was no way to mint a replacement anywhere in the product for a
  // connection that already existed: the panel was unusable for exactly the
  // credential it exists to fix.
  //
  // The same hook the add form uses, over the same descriptors, writing into
  // the same box a pasted token goes in. Not a second implementation of the
  // consent — the add door and this one are the same question asked about the
  // same connection, and two implementations of that drift.
  const rotateConsent = useProviderConsent({
    role: connection.role,
    type: wizardTypeForConnectionKind(connection.kind),
    fields: rotatableFields,
    values: newValues,
    onToken: (refreshToken) => setNewValues((v) => ({ ...v, refreshToken })),
    refusalText,
  });

  /** The server decides whether this is allowed; its refusal is the message. */
  const remove = async () => {
    setTesting(true);
    setResult(null);
    try {
      const answer = await connectionsApi.remove(connection.id);
      onRemoved(answer);
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
      setResult({ ok: false, reason: refusalText(err) });
    } finally {
      setTesting(false);
      // AND RE-READ THE ROW, or the card contradicts its own answer.
      //
      // `POST /:id/test` writes: the status, and the qualification
      // `qualifyAndRemember` just measured. The list was fetched when the page
      // opened and nothing refetched it, so the card kept rendering the
      // record from page load while the panel directly beneath it showed the
      // new one — the same account, the same screen, two different answers,
      // for as long as nobody reloaded.
      //
      // The owner met this on 2026-09-07 and reasonably read it as the Test
      // having failed to save, asking whether he should have deleted the
      // connections and made them again. (He should not: every one of those
      // rows was used by a migration, and `mailbox.connection_id` cascades.)
      //
      // In `finally` rather than beside the success: a failed probe writes
      // `status: 'error'` too, so the card is out of date either way, and a
      // refetch after a client-side throw costs one request and resyncs.
      onChanged();
    }
  };

  return (
    /* ONE ROW OF A WHITE CARD (2026-10-05). The owner, on the paper the app
       took that day: the rows sat on the page with nothing to lift them, and
       each wrapped wherever its words ran out. Now the name leads, what it is
       used by and what it carries are the lines under it, and the actions
       keep one place, at the right, on every row. */
    <li className="py-4 first:pt-3 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusIcon status={connection.status} />
            <span className="font-medium text-gray-900">{connection.displayName}</span>
            {connectionKindName(connection.kind, locale) && (
              <span className="text-xs text-gray-600 bg-gray-100 rounded px-1.5 py-0.5">
                {connectionKindName(connection.kind, locale)}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-600">
            <span>
              {connection.usedByMigrations === 0
                ? t('connections.usedBy.none')
                : connection.usedByMigrations === 1
                  ? t('connections.usedBy.one')
                  : t('connections.usedBy.other', { count: connection.usedByMigrations })}
            </span>
            <span aria-hidden="true"> · </span>
            <span>{t('connections.addedWhen', { when: relativeToNow(connection.createdAt) })}</span>
            <span aria-hidden="true"> · </span>
            {/* The prerequisites for this provider, in case the answer is
                "somebody has to re-authorise the app". On this line rather
                than among the buttons, which keep the same width on every
                row (2026-10-05). */}
            {cardsOfThisKind ? (
              // A kind two cards store as, whose checklists differ: one link per
              // card, by the card's name, rather than one of them picked for the
              // person (0148 T5 (a)).
              <span>
                <span className="whitespace-nowrap">{t('connections.setupSteps')}:</span>{' '}
                {cardsOfThisKind.map((card, i) => (
                  <React.Fragment key={card.type}>
                    {i > 0 && <span aria-hidden="true"> · </span>}
                    <Link
                      to={`/setup/${connection.role}/${card.type}`}
                      className="whitespace-nowrap text-blue-700 hover:underline"
                    >
                      {t(card.nameKey)}
                    </Link>
                  </React.Fragment>
                ))}
              </span>
            ) : (
              <Link
                // BY WIZARD TYPE, not by kind: the profiles are keyed the wizard's
                // way, and looking one up by kind answers an empty checklist that
                // reads as "nothing to set up" (workplan 0065).
                to={`/setup/${connection.role}/${wizardTypeForConnectionKind(connection.kind)}`}
                className="whitespace-nowrap text-blue-700 hover:underline"
              >
                {t('connections.setupSteps')}
              </Link>
            )}
          </p>
          {connection.qualification && (
            /* What the LAST test measured this account can carry (0106 T2) —
               the stored record, visible without pressing Test. The title
               carries each domain's evidence line for whoever hovers. */
            <p
              className="mt-0.5 text-sm text-gray-500"
              /* Every face the record actually carries — walked from the one
                 list, and skipping a face an older record never had rather
                 than reading `undefined.detail` off it (0113 T5). */
              title={QUALIFICATION_KEYS.map((d) => connection.qualification?.domains[d]?.detail)
                .filter((line): line is string => Boolean(line))
                .join('\n')}
            >
              {qualificationText(t, connection.qualification)}
            </p>
          )}
          {/* NO `Found:` LINE HERE, deliberately (owner, 2026-09-07).
            
              Three surfaces measure the same account and this is the worst of
              them: the card's figures are from whenever Test was last pressed —
              days, weeks — while Test re-measures on the spot and the preflight
              counts every collection properly for the decision that actually
              needs a number. Showing the stalest and least precise one
              permanently, with no age beside it, invited people to size a
              migration off it. *"If one wants to know a bit more, they press
              Test or look at the preflight."*
            
              So the card answers WHICH connection this is and WHETHER it is
              healthy — the two questions a list item is scanned for — and the
              quantities live where they are fresh. `measuredText` is unchanged
              and still renders in the three places below that show a result
              somebody just asked for. */}
          {/* WHY a face is missing, on screen (2026-09-02): the hover above is
              not on a phone, and the sentence is the remedy. `measures: false`
              drops the failed-MEASURE footnote with the line it footnotes — a
              note explaining a missing number, under a card that shows no
              numbers, explains nothing. It still speaks in the Test panel. */}
          {qualificationEvidence(t, connection.qualification ?? undefined, { measures: false }).map(
            (line) => (
              <span key={line} className="mt-1 block text-xs text-amber-800 break-words">
                {line}
              </span>
            ),
          )}
          {/* What is STANDING against this connection (workplan 0094 T5): a
              pass that failed since the last Test, by category, with the
              category's own remedy — and the button it names (Reconnect or
              Replace credentials, whichever this row shows) is beside it.
              The line sits on the side the pass named, or on both cards when
              it could not tell; where the connection is the thing to act on,
              the tail says which case this is. The guard is against a category
              this build has no sentence for. */}
          {(connection.standingFailures ?? [])
            .filter((f) => isFailureCategory(f.category))
            .map((f) => (
              <span
                key={`${f.mappingId}:${f.category}`}
                className="mt-1 block text-xs text-red-900 break-words"
              >
                {t('connections.standing.migration')}{' '}
                <Link to={`/mappings/${f.mappingId}`} className="underline">
                  {f.mappingName ?? f.mappingId.slice(0, 8)}
                </Link>{' '}
                {t('connections.standing.stopped', {
                  when: relativeToNow(f.asOf),
                  domains: f.domains.map((d) => t(DOMAIN_STRING_KEY[d])).join(', '),
                })}{' '}
                {t(FAILURE_KEY[f.category])}{' '}
                <SendItToUs
                  category={f.category}
                  migrationId={f.mappingId}
                  {...(f.side ? { side: f.side } : {})}
                  {...(f.domains.length === 1 ? { dataType: f.domains[0] } : {})}
                />
                {ASK_TEST.has(f.category) && (
                  <> {t(f.side ? 'connections.standing.thisSide' : 'connections.standing.whichSide')}</>
                )}
              </span>
            ))}
        </div>

        {/* wrap, and only push right once there is room to (workplan 0068):
            on a phone these four actions overflowed the card horizontally and
            the last one sat off-screen. Beside the details from `sm` up,
            under them on a phone. */}
        <div className="flex flex-wrap items-center gap-2 sm:max-w-[55%] sm:shrink-0 sm:justify-end">
          <button
            type="button"
            onClick={test}
            disabled={testing}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {testing && <Loader2 className="w-3 h-3 animate-spin" />}
            {testing ? t('connections.testing') : t('connections.test')}
          </button>
          <button
            type="button"
            onClick={() => {
              // Closed or opened, the fold starts without the last consent's
              // answer (0145 T4). The note outlives the fold, and a panel
              // drawn again with a refusal already in it is a new alert: a
              // screen reader would say a failure nobody just caused.
              rotateConsent.reset();
              setRotating((open) => {
                // Opening: start from what the connection ALREADY knows
                // (workplan 0078). Rotating an expired secret used to mean
                // retyping the server address and the account name that had
                // not changed. Only non-secret config values arrive here —
                // the encrypted record is never opened — so the secrets are
                // still, correctly, blank.
                if (!open) setNewValues({ ...(connection.knownValues ?? {}) });
                return !open;
              });
            }}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-md bg-white hover:bg-gray-50"
          >
            {/* NAMED FOR WHAT IT DOES HERE (workplan 0140 T2 (b)). On a row
                whose kind has a consent button, what this panel mints is a new
                token from the provider's consent: Reconnect, the word the
                failure line always used and no button said. Every other row
                keeps Replace credentials. The same panel either way, and the
                same fact the panel reads to draw its consent button (the
                descriptor's `consent`), not a list of kinds kept here. So it
                follows the KIND, not what the row stores: a Gmail row holding
                an app password says Reconnect too, which is why
                failure.authExpired names both words and leaves the choice to
                the row. */}
            {rotateConsent.isGrantKind ? t('connections.reconnect') : t('connections.rotate')}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={testing}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-md bg-white text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {t('connections.delete')}
          </button>
        </div>
      </div>

      {rotating && (
        <div className="mt-3 border-t border-gray-200 pt-3">
          <Hint className="" text={t('connections.rotate.hint')} why={t('connections.rotate.why')} />
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
          <ProviderConsentPanel consent={rotateConsent} className="mt-3" />
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
            result.said,
          )}
          {result.qualification && (
            /* What this account CAN CARRY (0106 T0) — per domain, measured. */
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
/**
 * The cards this page offers. On managed, not the export archive (the owner,
 * 2026-10-04, on 0153's *not carried over*: *"6. A"*): *Start a migration*
 * reads a Takeout from the folder `Takeout` of the destination's files, and
 * an archive saved here led nowhere. The appliance keeps the card, as before.
 */
function accountCards(role: 'source' | 'target'): ReadonlyArray<FrontDoorCard> {
  const cards = frontDoorCards(role);
  return isSelfHost() ? cards : cards.filter((card) => card.id !== EXPORT_CARD);
}

const AddConnection: React.FC<{ open: boolean; onClose: () => void; onAdded: () => void }> = ({
  open,
  onClose,
  onAdded,
}) => {
  const t = useT();
  const [role, setRole] = React.useState<'source' | 'target'>('source');
  // The first card of the side, the same one the role switch below lands on —
  // so opening the form and switching the role read as the same door.
  const [type, setType] = React.useState(accountCards('source')[0]?.id ?? '');
  // What is typed stays here, so a Cancel keeps it for the next opening; the
  // form below begins its probe answer and its consent afresh each time it
  // is drawn (`AccountForm`, 0145 T4).
  const [displayName, setDisplayName] = React.useState('');
  // The start a pick of the same card gives: its usual port, where it has one.
  const [values, setValues] = React.useState<Record<string, string>>(() => ({ ...formDefaultsFor('source', type) }));

  // Mounted while closed, so what was typed is still here at the next opening.
  // Its button is the page's, beside the title (`Connections`).
  if (!open) return null;

  return (
    <section aria-labelledby="accounts-add" className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h2 id="accounts-add" className="text-lg font-semibold text-gray-900">{t('connections.add')}</h2>

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
                const first = accountCards(r)[0]?.id ?? '';
                setRole(r);
                setType(first);
                setValues({ ...formDefaultsFor(r, first) });
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
          cards={accountCards(role)}
          role={role}
          selectedId={type}
          onPick={(card) => {
            setType(card.id);
            // THE DIRECTORY FILLS THE BOXES (0106 T5, owner 2026-09-03): a
            // named provider's published servers and ports, editable, and
            // measured by Test like anything typed. A protocol card names no
            // provider, so it starts from its usual port alone (owner
            // 2026-10-04): "IMAP" is 993 whoever serves it.
            setValues({ ...formDefaultsFor(role, card.id) });
          }}
          gridClass={role === 'source' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}
        />
      </div>

      {/* A fresh form for each card: its answer and its consent belong to
          the card they were given for. */}
      <AccountForm
        key={`${role}:${type}`}
        role={role}
        type={type}
        values={values}
        onValues={setValues}
        displayName={displayName}
        onDisplayName={setDisplayName}
        onAdded={() => onAdded()}
        onCancel={onClose}
      />
    </section>
  );
};

/**
 * The sentence for a delete that went through (2026-09-20).
 *
 * The frame is ours and translated; the provider's reason, when there is one,
 * is the finding and renders verbatim after it (prose boundary class 2, as the
 * in-use refusal above). `failed` is the sentence that matters and must not be
 * softened: somebody who reads it goes and withdraws the access themselves.
 */
function removalText(t: ReturnType<typeof useT>, answer: ConnectionDeleted | null): { text: string; tone: string } {
  if (!answer) return { text: '', tone: 'text-gray-700 bg-gray-50 border-gray-200' };
  const { status, reason } = answer.revocation;
  const withReason = (frame: string): string => (reason ? `${frame} ${reason}` : frame);
  switch (status) {
    case 'revoked':
      return { text: t('connections.removed.revoked'), tone: 'text-green-800 bg-green-50 border-green-200' };
    case 'failed':
      return { text: withReason(t('connections.removed.failed')), tone: 'text-amber-900 bg-amber-50 border-amber-200' };
    case 'unsupported':
      return { text: withReason(t('connections.removed.unsupported')), tone: 'text-gray-700 bg-gray-50 border-gray-200' };
    case 'no_credential':
      return { text: t('connections.removed.none'), tone: 'text-gray-700 bg-gray-50 border-gray-200' };
  }
}

const Connections: React.FC = () => {
  const t = useT();
  const { data, isLoading, error, refetch } = useQuery<ConnectionSummary[]>({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
  });
  const [removed, setRemoved] = React.useState<{ name: string; answer: ConnectionDeleted | null } | null>(null);
  const [adding, setAdding] = React.useState(false);

  if (isLoading) return <div className="text-gray-500">{t('common.loading')}</div>;
  if (error) return <div className="text-red-700">{serverMessage(error)}</div>;

  const groups = [
    { id: 'accounts-sources', titleKey: 'connections.sources', rows: (data ?? []).filter((c) => c.role === 'source') },
    { id: 'accounts-targets', titleKey: 'connections.targets', rows: (data ?? []).filter((c) => c.role === 'target') },
  ] as const;

  /* THE PAGE THE OTHERS ARE (2026-10-05): its title and the sentence under it
     on the paper, its one action beside them, and each group a white card,
     as Migrations, Needs you and Team are. It had been a narrower column of
     its own, the rows drawn straight on the page. */
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('connections.title')}</h1>
          <p className="mt-1 text-gray-600">{t('connections.intro')}</p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-[44px] items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5 mr-2" aria-hidden="true" />
            {t('connections.add')}
          </button>
        )}
      </div>

      <AddConnection open={adding} onClose={() => setAdding(false)} onAdded={() => void refetch()} />

      {removed && (
        <div role="status" className={`text-sm border rounded-lg p-3 ${removalText(t, removed.answer).tone}`}>
          <strong>{removed.name}</strong> {t('connections.removed.done')}{' '}
          <span>{removalText(t, removed.answer).text}</span>
        </div>
      )}

      {(data ?? []).length === 0 ? (
        <p className="bg-white rounded-lg border border-gray-200 p-6 text-gray-600">{t('connections.none')}</p>
      ) : (
        groups
          .filter((group) => group.rows.length > 0)
          .map((group) => (
            <section
              key={group.id}
              aria-labelledby={group.id}
              className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6"
            >
              <h2 id={group.id} className="text-lg font-semibold text-gray-900">
                {t(group.titleKey)}
              </h2>
              <ul className="divide-y divide-gray-200">
                {group.rows.map((c) => (
                  <Row
                    key={c.id}
                    connection={c}
                    onChanged={() => void refetch()}
                    onRemoved={(answer) => setRemoved({ name: c.displayName, answer })}
                  />
                ))}
              </ul>
            </section>
          ))
      )}
    </div>
  );
};

export default Connections;
