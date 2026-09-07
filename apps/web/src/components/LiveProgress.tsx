// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Live per-domain progress — ONE component, both editions (0033 T5).
 *
 * Born inside Confirm.tsx (#355) after a Windows operator compared the
 * discovery snapshot's 510 against the ledger's 1149: what the migration is
 * doing NOW, from the same numbers `/status` serves, so the screen and
 * `Invoke-RestMethod .../status` can never disagree. Extracted so the managed
 * hub (MappingDetail) renders the identical strip from
 * `GET /migrations/{id}`'s `domainStatus` — both payloads are
 * `DomainStatusReport` rows built by the same shared function, which is what
 * makes this a data-source seam and not a feature fork (hard rule 5).
 *
 * `lastError` renders VERBATIM (the prose boundary): it is the line the
 * operator acts on, and a paraphrase is a different claim.
 *
 * Since 0110 T3 a CATEGORY renders above it, and the two are not in tension —
 * they answer different people. The prose stays exactly as the provider said
 * it, because precision is what an engineer needs and a paraphrase would be a
 * different claim. The category's sentence is what the CUSTOMER can act on,
 * which the owner's reframing of 2026-08-27 made the point: *"most of it must
 * be self-service."* Nobody self-serves from `invalid_grant`. Both, in that
 * order — the way out first, the evidence under it.
 */

import React from 'react';
import type { DomainStatusReport, FailureCategory, FailureSide } from '@openmig/shared';
import { useT, useLocale, useFormatters } from '../i18n/index.tsx';
import StateChip from './StateChip.tsx';
import { formatNumber } from '../i18n/datetime.ts';
// One map, shared with the operator's support screen (0110 T4) so the person
// who phones and the person they phone read the same sentence.
import { FAILURE_KEY, FAILURE_SIDE_KEY } from '../i18n/failure-key.ts';
// And one map for the domain words, shared with the confirm screen and the
// probe text — this was the fifth copy of it (workplan 0113 T5).
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';

export const DOMAIN_KEY = DOMAIN_STRING_KEY satisfies Record<
  DomainStatusReport['domain'],
  unknown
>;

/** Only what the strip renders — `DomainStatusReport` satisfies this, and so
 *  does the detail schema's parsed row. */
export interface LiveProgressRow {
  readonly domain: DomainStatusReport['domain'];
  readonly state: DomainStatusReport['state'];
  readonly itemsSynced: number;
  readonly itemsFailed: number;
  readonly itemsRetrying: number;
  readonly lastSyncedAt?: string;
  readonly lastError?: string;
  readonly lastErrorCategory?: FailureCategory;
  /** Which side the pass named when it failed (0094 T5); absent when it could not tell. */
  readonly failedSide?: FailureSide;
}

const LiveProgress: React.FC<{ domains: readonly LiveProgressRow[] }> = ({ domains }) => {
  const t = useT();
  const { locale } = useLocale();
  const { relativeToNow } = useFormatters();
  const running = domains.filter((d) => d.state !== 'skipped');
  if (running.length === 0) return null;
  return (
    <div className="mb-3">
      <h4 className="text-sm font-medium text-gray-700 mb-1">{t('confirm.progress.heading')}</h4>
      <ul className="space-y-1">
        {running.map((d) => (
          <li key={d.domain} className="text-sm text-gray-800 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium">{t(DOMAIN_KEY[d.domain])}</span>
            <StateChip entity="domain" state={d.state} />
            <span>
              {formatNumber(d.itemsSynced, locale)} {t('confirm.progress.synced')}
            </span>
            {d.itemsFailed > 0 && (
              <span className="text-red-700">
                {formatNumber(d.itemsFailed, locale)} {t('confirm.progress.failed')}
              </span>
            )}
            {d.itemsRetrying > 0 && (
              <span className="text-amber-700">
                {formatNumber(d.itemsRetrying, locale)} {t('confirm.progress.retrying')}
              </span>
            )}
            {d.lastSyncedAt && (
              // The as-of the payload always carried and the strip never
              // showed (0036 T1) — both editions serve it via
              // buildDomainStatusReports.
              <span className="text-gray-500">
                {t('confirm.progress.lastSynced')} {relativeToNow(d.lastSyncedAt)}
              </span>
            )}
            {d.lastErrorCategory && (
              // The way OUT, first: a sentence the person whose migration
              // stopped can act on without contacting anybody (0110 T3).
              <span className="basis-full text-xs text-red-900">
                {t(FAILURE_KEY[d.lastErrorCategory])}
                {/* And the side, when the pass could tell (0094 T5, second
                    slice): "reconnect it" then points at the right account. */}
                {d.failedSide && <> {t(FAILURE_SIDE_KEY[d.failedSide])}</>}
              </span>
            )}
            {d.lastError && (
              // Verbatim (the prose boundary): this is the line the operator
              // acts on, and a paraphrase is a different claim. It stays,
              // under the sentence above rather than instead of it — the
              // category is coarse and actionable, this is precise.
              <span className="basis-full font-mono text-xs text-red-800">{d.lastError}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default LiveProgress;
