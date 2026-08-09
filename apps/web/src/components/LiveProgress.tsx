// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
 */

import React from 'react';
import type { DomainStatusReport } from '@openmig/shared';
import { useT, useLocale } from '../i18n';
import { formatNumber } from '../i18n/datetime';
import type { StringKey } from '../i18n';

export const DOMAIN_KEY: Record<DomainStatusReport['domain'], StringKey> = {
  email: 'domain.email',
  calendar: 'domain.calendar',
  contact: 'domain.contact',
  file: 'domain.file',
};

export const STATE_KEY: Record<DomainStatusReport['state'], StringKey> = {
  pending: 'confirm.state.pending',
  in_progress: 'confirm.state.in_progress',
  completed: 'confirm.state.completed',
  failed: 'confirm.state.failed',
  skipped: 'confirm.state.skipped',
};

export const STATE_CLASS: Record<DomainStatusReport['state'], string> = {
  pending: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  skipped: 'bg-gray-100 text-gray-500',
};

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
}

const LiveProgress: React.FC<{ domains: readonly LiveProgressRow[] }> = ({ domains }) => {
  const t = useT();
  const { locale } = useLocale();
  const running = domains.filter((d) => d.state !== 'skipped');
  if (running.length === 0) return null;
  return (
    <div className="mb-3">
      <h4 className="text-sm font-medium text-gray-700 mb-1">{t('confirm.progress.heading')}</h4>
      <ul className="space-y-1">
        {running.map((d) => (
          <li key={d.domain} className="text-sm text-gray-800 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium">{t(DOMAIN_KEY[d.domain])}</span>
            <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${STATE_CLASS[d.state]}`}>
              {t(STATE_KEY[d.state])}
            </span>
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
            {d.lastError && (
              // Verbatim (the prose boundary): this is the line the operator
              // acts on, and a paraphrase is a different claim.
              <span className="basis-full font-mono text-xs text-red-800">{d.lastError}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default LiveProgress;
