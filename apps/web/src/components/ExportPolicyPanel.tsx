// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE SCREEN BEHIND "SET AN EXPORT POLICY ON THE MAPPING" (workplan 0125 T3).
 *
 * ## The defect this closes
 *
 * The owner's live Google migration refused thirty files. Twenty-one of them
 * carried this remedy, per item, by name:
 *
 * > *"…is not copied here because this migration is configured with
 * > `nativeFilePolicy="refuse"`. **Set an export policy on the mapping** —
 * > "export-odf", "export-office" or "export-pdf" — to migrate these, or move
 * > them out of scope."*
 *
 * Neither instruction could be carried out. `nativeFilePolicy` appeared in the
 * entire web app in ONE file — the creation wizard — and `PUT
 * /api/migrations/:mappingId` parsed a `sourceConfig` and dropped it. So the
 * product's own remedy named a setting with no screen behind it, which is the
 * shape of defect that makes a person conclude the tool is broken rather than
 * that they have missed something.
 *
 * #1004 made the route apply it and refuse what may not change; #1005 made the
 * detail route answer the MAPPING's own policy rather than its connection's.
 * This is the third piece: somewhere to press.
 *
 * ## What may change is not decided here
 *
 * `mayRevise` lives in `shared` and is called by both editions — hard rule 5,
 * the rule 0125 exists to extend. This panel ASKS it rather than knowing the
 * answer: if the field is ever refused, the panel stops offering the press and
 * says the reason, with no second copy of the table to keep in step. The same
 * call supplies whether there is a consequence worth stating before the press.
 *
 * ## The consequence is shown BEFORE the press, not after
 *
 * Items already copied keep the format they were copied in — this product does
 * not overwrite what is on a target (hard rule 2), so the new policy applies to
 * what is copied from here on. And since a Google document's name is its
 * format's, every one is copied again under its new name, while the old copy
 * stays and the Deletions screen lists it as an earlier export (0042 T8 (b):
 * the owner, 2026-09-23, *"The export-format setting says this before you
 * save"*). Facts somebody should have before they press, not things they
 * discover about their own migration afterwards.
 *
 * ## And a refusal is shown as a refusal
 *
 * The route answers 409 with every refused field and its reason. This panel
 * only ever proposes the export policy, which the table permits — so a 409 here
 * means the rule changed under it, and hard rule 9 says that must not look like
 * a save that worked. The server's own sentences are rendered rather than a
 * client-side guess at what it must have meant.
 *
 * ## And how many were refused under the format it had (0125 T5)
 *
 * §7 asks the change to REPORT *"21 items were refused under the old policy"*.
 * The sentence shipped without the number, because nothing on the detail
 * payload carries failures by category. It is counted here instead, from the
 * failures queue the Failures screen already reads — and only once a save has
 * landed, because a count taken on every load of the migration page would be a
 * request for a line nobody has asked for yet.
 *
 * A count nobody managed to take reads as no count, never as a count of
 * nothing: `refusedByPolicy` answers `undefined` for "we did not ask or could
 * not", `0` for "we asked and there are none", and the sentence keeps its
 * number-free wording for both. Hard rule 9, in the one place on this panel
 * where a silence could be mistaken for an all-clear.
 *
 * ## And a Dropbox migration's Paper docs (workplan 0150 T3 (d))
 *
 * D7 chose one key, one panel and one revision rule for both sources. So on a
 * Dropbox migration this same panel shows `PaperFormatChooser`, titled
 * *Export format for Paper docs*, the words the Paper refusal names, and
 * sends `{ paper }` under the same key through the same save. What it says
 * before and after the press is the same fact about Paper docs: a new format
 * gives each one a new name, so it is copied again and the old copy stays.
 * The count after the press counts Paper docs only: the other kinds of
 * Dropbox's own share their category, and no format here exports them.
 */
import React from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import {
  GOOGLE_EDITOR_KINDS,
  carriesGoogleNativeFiles,
  isDropboxPaperPolicy,
  mayRevise,
  nativeFilePoliciesOf,
  type DropboxPaperPolicy,
  type FailuresQueue,
  type GoogleNativeFilePolicy,
  type NativeFilePolicies,
} from '@openmig/shared';
import { mappingApi } from '../services/mapping-service.ts';
import { fetchFailures } from '../services/operating-service.ts';
import { revisionRefusals, serverMessage } from '../services/api.ts';
import { useT } from '../i18n/index.tsx';
import { Hint } from './Hint.tsx';
import {
  NativeFilePolicyChooser,
  type NativeFilePolicyByKind,
} from './NativeFilePolicyChooser.tsx';
import { PaperFormatChooser } from './PaperFormatChooser.tsx';
import type { StringKey } from '../i18n/strings.ts';

/**
 * The policy this migration is running under, as a value the chooser can show.
 *
 * `undefined` is `refuse` and says so, because that is what the engine does
 * with an absent value — `parseNativeFilePolicy`'s default, and the reason
 * thirty of the owner's files were refused by a setting he had never been
 * offered. A chooser showing nothing selected would read as "no answer yet"
 * about a migration that has already acted on one.
 */
export function policyInForce(value: unknown): GoogleNativeFilePolicy {
  return value === 'export-odf' || value === 'export-office' || value === 'export-pdf'
    ? value
    : 'refuse';
}

/**
 * The format each kind is exported in, as the chooser shows it (workplan 0042
 * T9): a kind's own format where the migration has one, the single format
 * where it has not, and `refuse` where neither says.
 *
 * `nativeFilePoliciesOf` decides that, the same function the engine exports
 * with, so this panel cannot show a kind in one format while the next pass
 * copies it in another. Each value is read through `policyInForce` first, for
 * the reason given there.
 */
export function policiesInForce(
  sourceConfig:
    | { readonly nativeFilePolicy?: unknown; readonly nativeFilePolicies?: unknown }
    | undefined,
): NativeFilePolicyByKind {
  const own = sourceConfig?.nativeFilePolicies;
  const perKind: Record<string, GoogleNativeFilePolicy> = {};
  if (typeof own === 'object' && own !== null) {
    for (const kind of GOOGLE_EDITOR_KINDS) {
      const value = (own as Record<string, unknown>)[kind];
      if (value !== undefined) perKind[kind] = policyInForce(value);
    }
  }
  return nativeFilePoliciesOf({
    nativeFilePolicy: policyInForce(sourceConfig?.nativeFilePolicy),
    nativeFilePolicies: perKind as NativeFilePolicies,
  });
}

/**
 * The format a Dropbox migration's Paper docs arrive in, as the chooser shows
 * it (workplan 0150 T3 (d)): the one it holds, and `refuse` where it holds
 * none or one this screen does not know, which is what its source does then
 * (D1), for the reason `policyInForce` gives.
 */
export function paperInForce(
  sourceConfig: { readonly nativeFilePolicies?: unknown } | undefined,
): DropboxPaperPolicy {
  const own = sourceConfig?.nativeFilePolicies;
  const paper = typeof own === 'object' && own !== null ? (own as Record<string, unknown>).paper : undefined;
  return isDropboxPaperPolicy(paper) ? paper : 'refuse';
}

/**
 * A migration's formats, kind by kind, as the route takes them under
 * `nativeFilePolicies`: Google's four kinds, or Dropbox's one.
 */
type FormatsByKind = Readonly<Record<string, string>>;

/** Whether two choices differ for any kind either names. */
function differs(a: FormatsByKind, b: FormatsByKind): boolean {
  return Object.keys({ ...a, ...b }).some((kind) => a[kind] !== b[kind]);
}

/** A choice as a string, for an effect to key on: the object is new on every render. */
function keyOf(formats: FormatsByKind): string {
  return Object.keys(formats)
    .sort()
    .map((kind) => `${kind}:${formats[kind]}`)
    .join(',');
}

/**
 * How many of this mapping's failures were refused by its export policy.
 *
 * `undefined` means the queue was not read — not in flight, refused, or simply
 * never asked for. `0` means it WAS read and none were. The screen must be
 * able to tell those apart, which is the whole reason this returns a union
 * rather than defaulting a missing queue to zero.
 *
 * Both halves of the queue are counted. A policy refusal is recorded as a
 * decision and so normally waits in `needsDecision`, but "refused by the
 * format you had" is true of the row wherever it currently sits, and a count
 * that depended on which bucket the queue happened to file it under would be
 * a fact about our plumbing rather than about the migration.
 */
export function refusedByPolicy(queue: FailuresQueue | undefined): number | undefined {
  if (queue === undefined) return undefined;
  return [...queue.needsDecision, ...queue.retrying].filter(
    (f) => f.category === 'policy_refused',
  ).length;
}

/**
 * How many of a Dropbox migration's failures are Paper docs its format left
 * behind (workplan 0150 T3 (d)), with `refusedByPolicy`'s `undefined`.
 *
 * By the name the row carries, `.paper` or `.papert`: a Paper doc refused is
 * listed under its own name, and the other kinds of Dropbox's own are
 * `policy_refused` too, which no format here exports. Counting them would
 * promise the next pass tries files it never will.
 */
export function refusedPaperDocs(queue: FailuresQueue | undefined): number | undefined {
  if (queue === undefined) return undefined;
  return [...queue.needsDecision, ...queue.retrying].filter(
    (f) => f.category === 'policy_refused' && /\.papert?$/i.test(f.displayName ?? ''),
  ).length;
}

/** The connection kind whose formats are its Paper docs' (0150 T3 (d)). */
const DROPBOX = 'dropbox';

/** What the panel says, by whose formats it holds: the one place the two differ in words. */
const WORDS: Readonly<
  Record<'google' | 'paper', Readonly<Record<'title' | 'consequence' | 'consequenceWhy' | 'refusedBefore' | 'refusedBeforeCount' | 'refusedBeforeWhy', StringKey>>>
> = {
  google: {
    title: 'settings.exportPolicy',
    consequence: 'settings.exportPolicy.consequence',
    consequenceWhy: 'settings.exportPolicy.consequence.why',
    refusedBefore: 'settings.exportPolicy.refusedBefore',
    refusedBeforeCount: 'settings.exportPolicy.refusedBefore.count',
    refusedBeforeWhy: 'settings.exportPolicy.refusedBefore.why',
  },
  paper: {
    title: 'settings.exportPolicy.paper',
    consequence: 'settings.exportPolicy.paper.consequence',
    consequenceWhy: 'settings.exportPolicy.paper.consequence.why',
    refusedBefore: 'settings.exportPolicy.paper.refusedBefore',
    refusedBeforeCount: 'settings.exportPolicy.paper.refusedBefore.count',
    refusedBeforeWhy: 'settings.exportPolicy.paper.refusedBefore.why',
  },
};

const ExportPolicyPanel: React.FC<{
  mappingId: string;
  /** The connection kind this migration reads from. */
  sourceType: string;
  /** What it carries — a migration with no files has no Docs to decide about. */
  domains: ReadonlyArray<string>;
  /** The detail payload's `sourceConfig`: the single format and the per-kind ones. */
  current:
    | { readonly nativeFilePolicy?: unknown; readonly nativeFilePolicies?: unknown }
    | undefined;
}> = ({ mappingId, sourceType, domains, current }) => {
  const t = useT();
  const queryClient = useQueryClient();
  // WHOSE FORMATS THESE ARE (0150 T3 (d)): a Dropbox migration's one kind,
  // Paper, or Google's four. Held as the map the route takes, so the save and
  // the comparison below are the same for both.
  const paper = sourceType === DROPBOX;
  const words = WORDS[paper ? 'paper' : 'google'];
  const inForce: FormatsByKind = paper ? { paper: paperInForce(current) } : policiesInForce(current);
  // A key, because `inForce` is a new object on every render and an effect
  // keyed on it would reset the choice each time anything re-rendered.
  const inForceKey = keyOf(inForce);
  const [chosen, setChosen] = React.useState<FormatsByKind>(inForce);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState<FormatsByKind | null>(null);
  const [refused, setRefused] = React.useState<
    ReadonlyArray<{ field: string; reason: string }>
  >([]);
  const [failed, setFailed] = React.useState<string | null>(null);

  // The same key the Failures screen uses, so the two share one cache rather
  // than each holding its own idea of the queue. `enabled` keeps this off the
  // migration page's normal load entirely: the number is part of what a SAVE
  // reports, and until one lands there is nothing to say it about.
  const { data: queues } = useQuery({
    queryKey: ['failures', mappingId],
    queryFn: () => fetchFailures(mappingId),
    enabled: saved !== null,
    staleTime: 30_000,
  });
  const refusedCount = (paper ? refusedPaperDocs : refusedByPolicy)(queues?.[mappingId]);

  // What the mapping holds is the source of truth, and it changes under this
  // panel every time a save lands and the query refetches. Without this, a
  // second save would be offered against the value that was on screen when the
  // page loaded.
  // Keyed on `inForceKey`, which IS `current`'s meaning: keyed on the object,
  // this would run on every render.
  React.useEffect(() => {
    setChosen(inForce);
  }, [inForceKey]);
  const changed = differs(chosen, inForce);

  const verdict = mayRevise('source.nativeFilePolicy');

  // The two questions the wizard asks before offering this control, asked
  // again here so the settings panel and the wizard cannot disagree about
  // whose migration the question belongs to.
  // And a Dropbox migration's Paper docs since 0150 T3 (d): the wizard asks
  // every Dropbox migration that carries files (D1), so this does too.
  if (!(paper || carriesGoogleNativeFiles(sourceType)) || !domains.includes('file')) return null;

  const save = async () => {
    setSaving(true);
    // WHAT THE LAST PRESS SAID IS CLEARED BEFORE THIS ONE SPEAKS, and it is the
    // only thing keeping "Saved" and a refusal off the screen together: the
    // three renders below ask `saved !== null` and nothing more. A second,
    // compound condition on each of them was written first and removed — with
    // this reset in place no test could reach it, and a branch nothing can
    // execute is a branch nothing can prove. The sequence it guards (a refusal,
    // then a successful save) is a test instead.
    setRefused([]);
    setFailed(null);
    setSaved(null);
    try {
      await mappingApi.setNativeFilePolicies(mappingId, chosen);
      setSaved(chosen);
      // The panel reads its current value off the detail query, so the save is
      // not finished until that has been re-read.
      await queryClient.invalidateQueries({ queryKey: ['mapping', mappingId] });
    } catch (err) {
      const refusal = revisionRefusals(err);
      // A refusal that named nothing readable still is not a save that worked:
      // it falls through to the server's own sentence rather than to silence.
      if (refusal !== null && refusal.length > 0) setRefused(refusal);
      else setFailed(serverMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-8 p-4 bg-white border border-gray-200 rounded-lg">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Settings2 className="w-4 h-4 text-gray-500" />
        {t(words.title)}
      </h3>
      {verdict.allowed ? (
        <>
          <div className="mt-3">
            {paper ? (
              <PaperFormatChooser
                id="settings-paper-format"
                value={chosen.paper as DropboxPaperPolicy}
                onChange={(next) => setChosen({ paper: next })}
                disabled={saving}
              />
            ) : (
              <NativeFilePolicyChooser
                id="settings-native-file-policy"
                value={chosen as NativeFilePolicyByKind}
                onChange={setChosen}
                disabled={saving}
              />
            )}
          </div>
          {/* BEFORE the press, and only when something would actually change:
              restating it under a chooser nobody has touched is noise, and the
              rule this repo keeps is one line per thing to read. */}
          {changed && verdict.consequence !== undefined && (
            <Hint
              tone="caution"
              className="mt-3"
              text={t(words.consequence)}
              why={t(words.consequenceWhy)}
            />
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !changed}
              className="px-3 py-1 text-sm font-medium rounded border border-blue-300 text-blue-800 hover:bg-blue-50 disabled:opacity-50"
            >
              {saving ? t('settings.exportPolicy.saving') : t('settings.exportPolicy.save')}
            </button>
            {saved !== null && (
              <span className="text-sm text-green-700">{t('settings.exportPolicy.saved')}</span>
            )}
          </div>
          {/* WHAT HAPPENS TO THE ITEMS THE OLD POLICY REFUSED (0125 T5; since
              0042 T8 (b) the pass does it, not this save). A Google file's
              name comes from its format, so under a new one the next pass
              lists it under a new name and tries it, and closes the refusal
              left under the old name once that name is gone from the listing.
              The save resets nothing, which is still the rule: a settings save
              that silently emptied a queue of decisions would be the bulk
              mutation this codebase refuses to make. The link is for watching
              it happen, not a second button. */}
          {/* Not after Paper docs are set to be left behind: no pass tries
              them in a format then, and the sentence would say one does. */}
          {saved !== null && !(paper && saved.paper === 'refuse') && (
            <Hint
              className="mt-2"
              // The number when we have one, and the same sentence without it
              // when we do not. `refusedCount === 0` takes the number-free
              // wording too: "0 files already refused" is a sentence about
              // nothing, and the link below still leads somewhere worth
              // looking if the rows have not been categorised yet — the
              // owner's own thirty read `unknown` until next attempted (§7).
              text={
                refusedCount !== undefined && refusedCount > 0
                  ? t(words.refusedBeforeCount, {
                      count: String(refusedCount),
                    })
                  : t(words.refusedBefore)
              }
              why={t(words.refusedBeforeWhy)}
            />
          )}
          {saved !== null && (
            <Link
              to={`/mappings/${encodeURIComponent(mappingId)}/failures`}
              className="mt-1 inline-block text-sm font-medium text-blue-700 hover:underline"
            >
              {t('settings.exportPolicy.toFailures')}
            </Link>
          )}
        </>
      ) : (
        // Unreachable while the table permits this field, and deliberately not
        // asserted away: the panel asks rather than assumes, so the day the
        // rule changes it says so instead of offering a press the route will
        // refuse. The reason is the table's own words.
        <p className="mt-2 text-sm text-amber-800">{verdict.reason}</p>
      )}
      {refused.length > 0 && (
        <div className="mt-2">
          <p className="text-sm text-amber-800">{t('settings.exportPolicy.refused')}</p>
          <ul className="mt-1 list-disc pl-5">
            {refused.map((r) => (
              <li key={r.field} className="text-sm text-amber-800">
                {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {failed !== null && (
        <p className="mt-2 text-sm text-red-700">
          {t('settings.exportPolicy.failed')} {failed}
        </p>
      )}
    </section>
  );
};

export default ExportPolicyPanel;
