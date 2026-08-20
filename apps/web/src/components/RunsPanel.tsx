// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Run history for one mapping (workplan 0026 T3 row 23).
 *
 * Why a screen exists at all: both editions have written a `run` row per pass
 * since 2026-08-05, and nothing read them. The cost of that was demonstrated
 * on a real migration on 2026-08-09 — a pass whose email domain failed
 * outright logged `pass complete (0 created)`, and the operator diagnosed it
 * from PowerShell log tails while these rows held the failure verbatim.
 *
 * Events render VERBATIM (the i18n prose boundary: translate the frame,
 * never the finding). A failed run's log is open by default — it is the one
 * the operator came for; a clean run's log is a <details> fold, because
 * twenty green lines above the fold would bury the red one below it.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RunReport } from '@openmig/shared';
import { fetchRuns } from '../services/operating-service.ts';
import { useT, useLocale } from '../i18n/index.tsx';
import StateChip from './StateChip.tsx';
import { formatDateTime, formatNumber } from '../i18n/datetime.ts';

const EventLine: React.FC<{ event: RunReport['events'][number] }> = ({ event }) => (
  <li
    className={`font-mono text-xs whitespace-pre-wrap ${
      event.level === 'error'
        ? 'text-red-800'
        : event.level === 'warn'
          ? 'text-amber-800'
          : 'text-gray-600'
    }`}
  >
    {event.message}
  </li>
);

const RunRow: React.FC<{ run: RunReport }> = ({ run }) => {
  const t = useT();
  const { locale } = useLocale();
  // The failure log is what a reader of a failed run came for; folding it
  // would hide the panel's whole reason to exist behind a click.
  const openByDefault = run.status === 'failed' || run.errors > 0;

  return (
    <li className="border border-gray-200 rounded-lg bg-white p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StateChip entity="run" state={run.status} />
        <span className="text-sm text-gray-700">
          {run.startedAt ? formatDateTime(run.startedAt, locale) : formatDateTime(run.createdAt, locale)}
        </span>
        <span className="text-xs text-gray-500">
          {t('runs.items')}: {formatNumber(run.itemsProcessed, locale)}
        </span>
        {run.errors > 0 && (
          <span className="text-xs font-medium text-red-700">
            {t('runs.errors')}: {formatNumber(run.errors, locale)}
          </span>
        )}
      </div>
      {run.events.length > 0 && (
        <details className="mt-2" open={openByDefault}>
          <summary className="cursor-pointer text-xs text-gray-500 select-none">
            {t('runs.events')} ({formatNumber(run.events.length, locale)})
          </summary>
          <ul className="mt-1 space-y-0.5 pl-1 border-l-2 border-gray-100">
            {run.events.map((e, i) => (
              <EventLine key={i} event={e} />
            ))}
          </ul>
          {run.eventsTruncated && (
            <p className="mt-1 text-xs text-gray-500">{t('runs.eventsTruncated')}</p>
          )}
        </details>
      )}
    </li>
  );
};

const RunsPanel: React.FC<{ mappingId: string }> = ({ mappingId }) => {
  const t = useT();
  const runs = useQuery({
    queryKey: ['runs', mappingId],
    queryFn: () => fetchRuns(mappingId),
    refetchInterval: 30_000,
  });

  return (
    <section className="mt-8">
      <h3 className="text-base font-semibold text-gray-900">{t('runs.title')}</h3>
      <p className="mt-0.5 text-sm text-gray-500">{t('runs.blurb')}</p>
      {runs.error != null && (
        // The read failing is a finding, not a blank: an operator who cannot
        // see history should know they cannot, or silence reads as "no runs".
        <p className="mt-3 text-sm text-amber-800">{t('runs.error')}</p>
      )}
      {runs.data && runs.data.runs.length === 0 && (
        <p className="mt-3 text-sm text-gray-500">{t('runs.empty')}</p>
      )}
      {runs.data && runs.data.runs.length > 0 && (
        <>
          <ul className="mt-3 space-y-2">
            {runs.data.runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
          {/* Only when the server SAYS it truncated (0036 T3) — a label on an
              exactly-20 history would be almost-honest. */}
          {runs.data.truncated && (
            <p className="mt-2 text-xs text-gray-500">{t('runs.truncated')}</p>
          )}
        </>
      )}
    </section>
  );
};

export default RunsPanel;
