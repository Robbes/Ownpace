// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * One migration's hub (workplan 0019 T4).
 *
 * Every per-mapping operating screen existed and was URL-reachable ONLY — a
 * managed operator could not reach the decision queues without typing an
 * address, which made §11.2's "the owner stays in control" a claim about
 * routes rather than about people. This page is the navigation: the queues,
 * the check, and the finish checklist for THIS mapping, in the runbook's
 * cutover order.
 *
 * The links are the deliverable and must not depend on anything loading —
 * the detail card above them is best-effort (managed has a mapping API; a
 * failure to read it degrades to the links, never to a dead end).
 */

import React from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Flag,
  ListChecks,
  MoveRight,
  Trash2,
} from 'lucide-react';
import { isSelfHost } from '../services/edition';
import { mappingApi } from '../services/mapping-service';
import { fetchStatus } from '../services/operating-service';
import { useT } from '../i18n';
import RunsPanel from '../components/RunsPanel';
import CompletionReportDownload from '../components/CompletionReportDownload';
import LiveProgress from '../components/LiveProgress';
import StateChip from '../components/StateChip';
import type { StringKey } from '../i18n';

const SCREENS: ReadonlyArray<{
  nameKey: StringKey;
  path: string;
  icon: typeof Trash2;
  blurbKey: StringKey;
}> = [
  { nameKey: 'hub.deletions.name', path: 'deletions', icon: Trash2, blurbKey: 'hub.deletions.blurb' },
  { nameKey: 'hub.moves.name', path: 'moves', icon: MoveRight, blurbKey: 'hub.moves.blurb' },
  { nameKey: 'hub.failures.name', path: 'failures', icon: AlertTriangle, blurbKey: 'hub.failures.blurb' },
  { nameKey: 'hub.check.name', path: 'verify', icon: ListChecks, blurbKey: 'hub.check.blurb' },
  { nameKey: 'hub.finish.name', path: 'finish', icon: Flag, blurbKey: 'hub.finish.blurb' },
];

const MappingDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const t = useT();

  // Best-effort context; managed-only (the appliance has no mapping API and
  // its operators reach the queues from the top-level nav anyway).
  const detail = useQuery({
    queryKey: ['mapping', id],
    queryFn: () => mappingApi.get(id!),
    enabled: Boolean(id) && !isSelfHost(),
    retry: false,
  });

  // The live per-domain strip (0033 T5): one component, two data sources.
  // Selfhost reads the appliance-wide /status and filters to this mapping;
  // managed reads it off the detail payload above. Both are
  // DomainStatusReport rows built by the same shared function, so the strip
  // cannot mean different things per edition.
  const status = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    enabled: Boolean(id) && isSelfHost(),
    refetchInterval: 30_000,
  });

  if (!id) {
    return <p className="text-sm text-amber-800">{t('hub.noId')}</p>;
  }

  const progressDomains = isSelfHost()
    ? status.data?.mappings.find((m) => m.mappingId === id)?.domains
    : detail.data?.domainStatus;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">
          {detail.data?.name ?? t('hub.fallbackTitle')}
        </h2>
        {detail.data?.status && <StateChip entity="lifecycle" state={detail.data.status} />}
      </div>
      <p className="mt-1 text-sm text-gray-500 font-mono">{id}</p>
      {/* The completion report (workplan 0047): every number on it already
          lives on some screen below — this is the ONE document version, for
          handing over. */}
      <div className="mt-2">
        <CompletionReportDownload mappingId={id} />
      </div>
      {detail.error != null && (
        <p className="mt-1 text-sm text-amber-800">{t('hub.detailError')}</p>
      )}

      {progressDomains && progressDomains.length > 0 && (
        <div className="mt-4">
          <LiveProgress domains={progressDomains} />
        </div>
      )}

      {/* The list IS a sequence (0034 T4): the runbook's cutover order was a
          real IA decision that no screen ever stated — a first-time operator
          had no way to know the five links are steps, or where they were in
          them. Numbered, with one intro sentence; no wizard, no gating — the
          screens already gate themselves (Finish refuses over open failures). */}
      <p className="mt-6 text-sm text-gray-600">{t('hub.orderIntro')}</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {SCREENS.map((s, i) => (
          <li key={s.path}>
            <Link
              to={`/mappings/${encodeURIComponent(id)}/${s.path}`}
              className="flex items-start gap-3 p-4 h-full bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-sm"
            >
              <s.icon className="w-5 h-5 mt-0.5 text-gray-500 flex-shrink-0" />
              <span>
                <span className="block text-sm font-medium text-gray-900">
                  {i + 1}. {t(s.nameKey)}
                </span>
                <span className="block mt-0.5 text-sm text-gray-600">{t(s.blurbKey)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Run history (0026 T3 row 23) — what each pass did, errors verbatim.
          Below the links on purpose: the queues are decisions, this is the
          record. */}
      <RunsPanel mappingId={id} />
    </div>
  );
};

export default MappingDetail;
