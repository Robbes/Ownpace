// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * One decision over a GROUP of failures (2026-09-12).
 *
 * A connector bug parks items by the dozen, and **its fix parks nothing** —
 * parking is a stored attempt count, and deploying a fix does not lower it.
 * Live 2026-09-11: a non-recursive MKCOL refused every file in a subfolder, the
 * fix landed, and 82 files stayed exactly where they were with the migration
 * reporting itself complete over the hole. Clearing them meant 82 presses or
 * SQL against the ledger.
 *
 * ## What this panel is for, and what the per-row buttons are for
 *
 * "Migrate without all of these" above the list already presses `accept` on
 * every undecided row, in a loop. That is the right shape for a screenful of
 * items a person has just read. This is the other case: a wording shared by
 * items the screen may not even be showing all of, and a `retry` — which is
 * TWO things, zeroing the attempts AND clearing the mapping's cursors
 * (ADR-0020). A loop pays for the second one once per item.
 *
 * ## The count is shown before the press, and it is the SAME count
 *
 * The queue is already in the browser, so the panel can say how many rows a
 * match reaches before anybody presses anything. That number must be the
 * number the server changes, which is why the caller passes BOTH sections:
 * `needsDecision` and `retrying` are both `status = 'failed'` rows, and a
 * preview drawn from the parked half alone would promise three and do four.
 * (The repo has been here: a digest that said four pointing at a queue showing
 * three sent the owner hunting for an item that did not exist.)
 *
 * The filter here mirrors the server's exactly — `===` on the domain and
 * `String.includes` on the error. The substring is LITERAL on both sides: `%`
 * and `_` are LIKE's own wildcards, and PgLedger escapes them precisely so a
 * needle out of a real filename (`(50%).pdf`) means what it looks like.
 *
 * ## It refuses to press with nothing selected
 *
 * The server answers 400 to a match that narrows on neither field, and this
 * disables the buttons for the same reason rather than a different one: the
 * queue also holds policy refusals, which re-park the moment they are seen
 * again, so "retry everything" costs a refetch per undecidable item and
 * changes nothing about them. The disabled state is a courtesy, not the
 * boundary — if it were bypassed the server would still refuse, and that
 * refusal is shown verbatim like every other one on this surface.
 */

import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DiscoveryDomain, FailureCategory, ItemFailure } from '@openmig/shared';
import { useT } from '../../i18n/index.tsx';
import { Hint } from '../Hint.tsx';
import { ActionButton, Refused, Resolved } from './primitives.tsx';
import { DecisionRefusedError, decideFailureGroup } from '../../services/operating-service.ts';
import { DOMAIN_STRING_KEY } from '../../i18n/domain-words.ts';
// The same eight sentences the row above prints, from the same map: the
// group and its members have to be called one thing.
import { FAILURE_KEY } from '../../i18n/failure-key.ts';

/**
 * The server's match, applied to the rows already on screen.
 *
 * Exported so the guard can hold it against the SQL's behaviour without
 * rendering anything — the two have to agree about `%`, about an empty
 * substring, and about which rows a domain-only match reaches.
 */
export function matchingFailures(
  failures: readonly ItemFailure[],
  match: {
    readonly domain?: string;
    readonly category?: string;
    readonly errorContains?: string;
  },
): readonly ItemFailure[] {
  const needle = match.errorContains ?? '';
  return failures.filter(
    (f) =>
      (!match.domain || f.domain === match.domain) &&
      // EXACT, and a row with NO category is reached by no category match —
      // `f.category` is undefined there, and the SQL's `=` never matches its
      // NULL either. The two have to agree about this or the count promised
      // here is not the count the server changes.
      (!match.category || f.category === match.category) &&
      // Literal, exactly as the ledger's escaped LIKE is.
      (needle === '' || f.lastError.includes(needle)),
  );
}

/**
 * The groups the rows on screen actually fall into, biggest first.
 *
 * The owner, on being shown a box to type a substring into (2026-09-17):
 * *"why now detail groups that share sumilarities and offer those to pick from
 * to do bulk actions?"* Typing a needle is how somebody describes a group they
 * have already worked out; this is the product reading the groups off its own
 * rows and offering them.
 *
 * KIND CROSSED WITH CATEGORY, because those are the two words the row already
 * shows. The error prose is deliberately not a grouping key: it carries paths,
 * UIDs and status lines, so no two rows share it exactly and any scheme for
 * deciding they are "similar enough" would be this screen inventing a
 * similarity the server cannot then reproduce. The fold-out still takes a
 * substring for the cases a person can see and the categories cannot.
 *
 * A group with NO category is returned too, and is the one a caller must not
 * offer a bulk press for: it can only be described to the server as its domain,
 * which would reach every OTHER category in that domain as well. `pressable`
 * says so rather than leaving each caller to work it out.
 */
export function failureGroups(
  failures: readonly ItemFailure[],
): ReadonlyArray<{
  readonly domain: DiscoveryDomain;
  readonly category?: FailureCategory;
  readonly count: number;
  readonly pressable: boolean;
}> {
  const byKey = new Map<
    string,
    { domain: DiscoveryDomain; category?: FailureCategory; count: number }
  >();
  for (const f of failures) {
    const key = `${f.domain}\u0000${f.category ?? ''}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.count += 1;
      continue;
    }
    byKey.set(key, {
      domain: f.domain,
      ...(f.category ? { category: f.category } : {}),
      count: 1,
    });
  }
  return [...byKey.values()]
    .map((g) => ({ ...g, pressable: g.category !== undefined }))
    .sort((a, b) =>
      // Biggest first, then a stable order so the list does not reshuffle
      // between renders of the same queue.
      b.count - a.count ||
      a.domain.localeCompare(b.domain) ||
      (a.category ?? '').localeCompare(b.category ?? ''),
    );
}

type Outcome =
  | { readonly state: 'idle' }
  | { readonly state: 'pending' }
  | { readonly state: 'done'; readonly effect: string }
  | { readonly state: 'refused'; readonly text: string };

export const FailureGroupPanel: React.FC<{
  mappingId: string;
  /** EVERY failed row on this screen — both sections. See the docblock. */
  failures: readonly ItemFailure[];
}> = ({ mappingId, failures }) => {
  const t = useT();
  const queryClient = useQueryClient();
  const [domain, setDomain] = React.useState('');
  const [errorContains, setErrorContains] = React.useState('');
  /**
   * One outcome, tagged with WHICH press it belongs to.
   *
   * There are now several buttons on this panel. A single untagged outcome
   * would put "82 items" under whichever group the reader happened to look at
   * next, which on a surface that decides what happens to somebody's data is
   * not a cosmetic mistake.
   */
  const [outcome, setOutcome] = React.useState<{
    readonly on: string;
    readonly result: Outcome;
  }>({ on: '', result: { state: 'idle' } });

  const needle = errorContains.trim();
  // Offered from the rows that are actually here, so the select cannot name a
  // domain with nothing in it and then report "nothing matched".
  const domains: readonly DiscoveryDomain[] = [...new Set(failures.map((f) => f.domain))].sort();
  const matched = matchingFailures(failures, {
    ...(domain ? { domain } : {}),
    ...(needle ? { errorContains: needle } : {}),
  }).length;
  const narrowed = domain !== '' || needle !== '';
  const manualMatch = {
    ...(domain ? { domain: domain as DiscoveryDomain } : {}),
    ...(needle ? { errorContains: needle } : {}),
  };
  const manual: Outcome = outcome.on === 'manual' ? outcome.result : { state: 'idle' };

  const press = (
    on: string,
    action: 'retry' | 'accept',
    match: {
      readonly domain?: DiscoveryDomain;
      readonly category?: FailureCategory;
      readonly errorContains?: string;
    },
  ) => {
    setOutcome({ on, result: { state: 'pending' } });
    void decideFailureGroup(mappingId, action, match)
      .then((r) => {
        setOutcome({ on, result: { state: 'done', effect: r.effect } });
        // Re-read rather than patch: the server decides what the decision did
        // to the queue, and guessing it here would be a second copy of rules
        // that already exist once.
        void queryClient.invalidateQueries({ queryKey: ['failures'] });
      })
      .catch((err: unknown) => {
        if (err instanceof DecisionRefusedError) {
          const { refusal } = err;
          setOutcome({
            on,
            result: { state: 'refused', text: refusal.reason ?? refusal.hint ?? refusal.error },
          });
          return;
        }
        setOutcome({
          on,
          result: {
            state: 'refused',
            text: err instanceof Error ? err.message : t('common.requestFailed'),
          },
        });
      });
  };

  /** The groups this queue actually holds, biggest first. */
  const groups = failureGroups(failures);

  return (
    <div className="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50">
      <h5 className="text-sm font-semibold text-gray-900 mb-1">{t('failures.group.title')}</h5>
      <Hint className="mb-2" text={t('failures.group.hint')} why={t('failures.group.hint.why')} />

      {/*
        THE GROUPS, READ OFF THE ROWS (the owner, 2026-09-17: *"why now detail
        groups that share sumilarities and offer those to pick from to do bulk
        actions?"*). The box below still takes a substring, because a person
        can see a shared wording the categories cannot — but it is now the
        second answer, folded away, instead of the only one.
      */}
      <p className="text-xs font-medium text-gray-700">{t('failures.group.found')}</p>
      <ul className="mt-1 mb-3 space-y-1">
        {groups.map((g) => {
          const key = `${g.domain}/${g.category ?? ''}`;
          const mine = outcome.on === key ? outcome.result : { state: 'idle' as const };
          return (
            <li
              key={key}
              className="flex flex-wrap items-center gap-2 p-2 bg-white border border-gray-200 rounded"
            >
              <span className="text-xs font-medium text-gray-900">
                {t(DOMAIN_STRING_KEY[g.domain])}
              </span>
              <span className="text-xs text-gray-700 flex-1 min-w-[10rem]">
                {g.category ? (
                  t(FAILURE_KEY[g.category])
                ) : (
                  // NOT PRESSABLE, and it says why rather than sitting there
                  // greyed out. Its only description to the server would be
                  // its domain, which reaches every other category in that
                  // domain too — so the count above the button would be a
                  // promise the press does not keep.
                  <Hint
                    text={t('failures.group.noCategory')}
                    why={t('failures.group.noCategory.why')}
                  />
                )}
              </span>
              <span className="text-xs text-gray-500 whitespace-nowrap tabular-nums">
                {g.count === 1
                  ? t('failures.group.items.one')
                  : t('failures.group.items.many', { count: String(g.count) })}
              </span>
              {g.pressable && (
                <>
                  <ActionButton
                    pending={mine.state === 'pending'}
                    title={t('failures.retryCost')}
                    onClick={() =>
                      press(key, 'retry', {
                        domain: g.domain,
                        ...(g.category ? { category: g.category } : {}),
                      })
                    }
                  >
                    {t('failures.group.retry')}
                  </ActionButton>
                  <ActionButton
                    pending={mine.state === 'pending'}
                    onClick={() =>
                      press(key, 'accept', {
                        domain: g.domain,
                        ...(g.category ? { category: g.category } : {}),
                      })
                    }
                  >
                    {t('failures.group.accept')}
                  </ActionButton>
                </>
              )}
              {mine.state === 'done' && <Resolved effect={mine.effect} />}
              {mine.state === 'refused' && <Refused text={mine.text} />}
            </li>
          );
        })}
      </ul>

      {/*
        The typed match, kept and folded. It is the answer for a wording the
        eight categories cannot separate — one connector defect inside one
        category, which is the case this panel was built for in the first
        place (82 files behind a non-recursive MKCOL).
      */}
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-700">{t('failures.group.manual')}</summary>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-700">
            <span className="block mb-1">{t('failures.group.domain')}</span>
            <select
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value);
                setOutcome({ on: '', result: { state: 'idle' } });
              }}
              className="px-2 py-1 text-xs border border-gray-300 rounded bg-white"
            >
              <option value="">{t('failures.group.domain.any')}</option>
              {domains.map((d) => (
                <option key={d} value={d}>
                  {t(DOMAIN_STRING_KEY[d])}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-700 flex-1 min-w-[12rem]">
            <span className="block mb-1">{t('failures.group.error')}</span>
            <input
              type="text"
              value={errorContains}
              placeholder={t('failures.group.error.placeholder')}
              onChange={(e) => {
                setErrorContains(e.target.value);
                setOutcome({ on: '', result: { state: 'idle' } });
              }}
              className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-600">
          {narrowed
            ? t('failures.group.matches', { count: String(matched), total: String(failures.length) })
            : t('failures.group.needsNarrowing')}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/*
            Disabled until the match narrows, and while nothing matches: pressing
            either one would be a request the server answers with a refusal or a
            `matched: 0`, and offering a button whose only outcome is "nothing
            happened" is how somebody concludes the screen is broken.
          */}
          <ActionButton
            pending={manual.state === 'pending' || !narrowed || matched === 0}
            title={t('failures.retryCost')}
            onClick={() => press('manual', 'retry', manualMatch)}
          >
            {t('failures.group.retry')}
          </ActionButton>
          <ActionButton
            pending={manual.state === 'pending' || !narrowed || matched === 0}
            onClick={() => press('manual', 'accept', manualMatch)}
          >
            {t('failures.group.accept')}
          </ActionButton>
          {manual.state === 'done' && <Resolved effect={manual.effect} />}
          {manual.state === 'refused' && <Refused text={manual.text} />}
        </div>
      </details>
    </div>
  );
};
