// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT THIS MIGRATION WILL NOT COPY, AND SOMEBODY SAYING THEY SAW IT.
 *
 * `DiscoveryCounts` has shown this number since 0118, and its own comment says
 * why it is on the confirm screen rather than anywhere else: the person
 * choosing the export policy needs it *"while the choice is still open — and
 * not as a queue full of failure rows after the first pass"*.
 *
 * Two things were missing from that.
 *
 * The connector did not COUNT native files under `nativeFilePolicy="refuse"`,
 * on the argument that the policy's own name already says it refuses them.
 * True of a policy somebody chose; `refuse` is the default, and a default
 * tells nobody anything. So the screen said nothing at all in the one case
 * where it had the most to say. That half is fixed in `google-drive-source.ts`.
 *
 * And a number on a screen is not the same as a number somebody read. The
 * owner ran a full migration past this line on 2026-09-22 and met the
 * consequence afterwards, as twenty refusals in the failures queue. So the
 * count now carries a tick-box, and Start waits for it.
 *
 * NOT A BLOCK, deliberately. `refuse` is a legitimate answer — an export is
 * lossy and the original is not recoverable from the result — so the product
 * must not push anybody off it. What it must never do is let the consequence
 * be discovered afterwards. One click, and the screen has been read.
 */

import React from 'react';
import type { DiscoveryRecord } from '@openmig/shared';
import { useT } from '../../i18n/index.tsx';
import { nativeKindKey } from '../../i18n/native-kind-key.ts';

/**
 * A domain count, as far as this file is concerned.
 *
 * `Pick` of the real record rather than a hand-written shape: a structural
 * twin drifts the moment the field's type changes, and the one thing this
 * module must never get wrong is what it is counting.
 */
export type RefusingDomain = Pick<DiscoveryRecord, 'refusedNative'>;

/**
 * The refusals across every domain, by editor kind, commonest first.
 *
 * Shared rather than duplicated: the sentence and the tick-box have to agree
 * about what is refused, and a second copy of this loop is the way they stop
 * agreeing.
 */
export function refusedByKind(
  domains: ReadonlyArray<RefusingDomain>,
): ReadonlyArray<readonly [string, number]> {
  const total = new Map<string, number>();
  for (const d of domains) {
    for (const [kind, n] of Object.entries(d.refusedNative ?? {})) {
      if (n > 0) total.set(kind, (total.get(kind) ?? 0) + n);
    }
  }
  return [...total.entries()].sort((a, b) => b[1] - a[1]);
}

/** How many files in total, which is what the tick-box has to name. */
export function refusedTotal(domains: ReadonlyArray<RefusingDomain>): number {
  return refusedByKind(domains).reduce((sum, [, n]) => sum + n, 0);
}

/**
 * True when there is something to acknowledge — and therefore when Start waits.
 *
 * A screen with nothing refused is unchanged: no box, no extra click, no new
 * way for a migration with nothing to warn about to fail to start.
 */
export function needsAcknowledgement(domains: ReadonlyArray<RefusingDomain>): boolean {
  return refusedTotal(domains) > 0;
}

/**
 * The tick-box. Renders nothing at all when nothing is refused.
 *
 * It names the count and the kinds rather than saying "some files": *"3 items
 * will not be copied"* sends somebody hunting through their Drive, and *"3
 * Google Slides"* does not — the same rule `DiscoveryCounts` already follows
 * one line above this one.
 */
export const RefusedNativeAcknowledgement: React.FC<{
  readonly domains: ReadonlyArray<RefusingDomain>;
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  /** Distinguishes the boxes when a page renders one per mapping. */
  readonly id?: string;
}> = ({ domains, checked, onChange, id }) => {
  const t = useT();
  const kinds = refusedByKind(domains);
  if (kinds.length === 0) return null;
  const inputId = id ? `refused-ack-${id}` : 'refused-ack';

  return (
    <label
      htmlFor={inputId}
      className="mt-3 flex items-start gap-2 text-sm text-amber-800 cursor-pointer"
    >
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 flex-shrink-0"
      />
      <span>
        {t('confirm.refusedAck', {
          n: refusedTotal(domains),
          kinds: kinds.map(([kind, n]) => `${n} ${t(nativeKindKey(kind))}`).join(', '),
        })}
      </span>
    </label>
  );
};

export default RefusedNativeAcknowledgement;
