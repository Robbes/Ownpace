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
import type { DiscoveryDomain, ItemFailure } from '@openmig/shared';
import { useT } from '../../i18n/index.tsx';
import { Hint } from '../Hint.tsx';
import { ActionButton, Refused, Resolved } from './primitives.tsx';
import { DecisionRefusedError, decideFailureGroup } from '../../services/operating-service.ts';
import { DOMAIN_STRING_KEY } from '../../i18n/domain-words.ts';

/**
 * The server's match, applied to the rows already on screen.
 *
 * Exported so the guard can hold it against the SQL's behaviour without
 * rendering anything — the two have to agree about `%`, about an empty
 * substring, and about which rows a domain-only match reaches.
 */
export function matchingFailures(
  failures: readonly ItemFailure[],
  match: { readonly domain?: string; readonly errorContains?: string },
): readonly ItemFailure[] {
  const needle = match.errorContains ?? '';
  return failures.filter(
    (f) =>
      (!match.domain || f.domain === match.domain) &&
      // Literal, exactly as the ledger's escaped LIKE is.
      (needle === '' || f.lastError.includes(needle)),
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
  const [outcome, setOutcome] = React.useState<Outcome>({ state: 'idle' });

  const needle = errorContains.trim();
  // Offered from the rows that are actually here, so the select cannot name a
  // domain with nothing in it and then report "nothing matched".
  const domains: readonly DiscoveryDomain[] = [...new Set(failures.map((f) => f.domain))].sort();
  const matched = matchingFailures(failures, {
    ...(domain ? { domain } : {}),
    ...(needle ? { errorContains: needle } : {}),
  }).length;
  const narrowed = domain !== '' || needle !== '';

  const press = (action: 'retry' | 'accept') => {
    setOutcome({ state: 'pending' });
    void decideFailureGroup(mappingId, action, {
      ...(domain ? { domain: domain as DiscoveryDomain } : {}),
      ...(needle ? { errorContains: needle } : {}),
    })
      .then((r) => {
        setOutcome({ state: 'done', effect: r.effect });
        // Re-read rather than patch: the server decides what the decision did
        // to the queue, and guessing it here would be a second copy of rules
        // that already exist once.
        void queryClient.invalidateQueries({ queryKey: ['failures'] });
      })
      .catch((err: unknown) => {
        if (err instanceof DecisionRefusedError) {
          const { refusal } = err;
          setOutcome({
            state: 'refused',
            text: refusal.reason ?? refusal.hint ?? refusal.error,
          });
          return;
        }
        setOutcome({
          state: 'refused',
          text: err instanceof Error ? err.message : t('common.requestFailed'),
        });
      });
  };

  return (
    <div className="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50">
      <h5 className="text-sm font-semibold text-gray-900 mb-1">{t('failures.group.title')}</h5>
      <Hint className="mb-2" text={t('failures.group.hint')} why={t('failures.group.hint.why')} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-700">
          <span className="block mb-1">{t('failures.group.domain')}</span>
          <select
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value);
              setOutcome({ state: 'idle' });
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
              setOutcome({ state: 'idle' });
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
          pending={outcome.state === 'pending' || !narrowed || matched === 0}
          title={t('failures.retryCost')}
          onClick={() => press('retry')}
        >
          {t('failures.group.retry')}
        </ActionButton>
        <ActionButton
          pending={outcome.state === 'pending' || !narrowed || matched === 0}
          onClick={() => press('accept')}
        >
          {t('failures.group.accept')}
        </ActionButton>
        {outcome.state === 'done' && <Resolved effect={outcome.effect} />}
        {outcome.state === 'refused' && <Refused text={outcome.text} />}
      </div>
    </div>
  );
};
