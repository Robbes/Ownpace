// Copyright 2026 The Ownpace authors (Apache-2.0)
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Flag,
  ListChecks,
  MoveRight,
  Pause,
  Share2,
  Trash2,
} from 'lucide-react';
import { isSelfHost } from '../services/edition.ts';
import { mappingApi } from '../services/mapping-service.ts';
import { fetchStatus } from '../services/operating-service.ts';
import { useT } from '../i18n/index.tsx';
import RunsPanel from '../components/RunsPanel.tsx';
import MappingLinksPanel from '../components/MappingLinksPanel.tsx';
import CompletionReportDownload from '../components/CompletionReportDownload.tsx';
import LiveProgress from '../components/LiveProgress.tsx';
import StateChip from '../components/StateChip.tsx';
import type { StringKey } from '../i18n/index.tsx';

const SCREENS: ReadonlyArray<{
  nameKey: StringKey;
  path: string;
  icon: typeof Trash2;
  blurbKey: StringKey;
}> = [
  { nameKey: 'hub.deletions.name', path: 'deletions', icon: Trash2, blurbKey: 'hub.deletions.blurb' },
  { nameKey: 'hub.moves.name', path: 'moves', icon: MoveRight, blurbKey: 'hub.moves.blurb' },
  { nameKey: 'hub.failures.name', path: 'failures', icon: AlertTriangle, blurbKey: 'hub.failures.blurb' },
  { nameKey: 'hub.sharing.name', path: 'sharing', icon: Share2, blurbKey: 'hub.sharing.blurb' },
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

  // Pause, from the page the operator is actually looking at when a
  // migration misbehaves (live 2026-09-11: a looping migration, and the
  // only stop was `docker stop` on the worker). Same call as the list row.
  const queryClient = useQueryClient();
  const [pauseFailed, setPauseFailed] = React.useState<string | null>(null);
  const [pausing, setPausing] = React.useState(false);
  const pause = async () => {
    if (!id) return;
    setPausing(true);
    setPauseFailed(null);
    try {
      await mappingApi.pause(id);
      await queryClient.invalidateQueries({ queryKey: ['mapping', id] });
      await queryClient.invalidateQueries({ queryKey: ['mappings'] });
    } catch (err) {
      setPauseFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setPausing(false);
    }
  };

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
        <div className="flex items-center gap-3">
          {(detail.data?.status === 'active' || detail.data?.status === 'continuous') && (
            <button
              onClick={() => void pause()}
              disabled={pausing}
              className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium rounded border border-amber-300 text-amber-800 hover:bg-amber-50 disabled:opacity-50"
              title={t('mappings.action.pause.why')}
            >
              <Pause className="w-4 h-4" />
              {t('mappings.action.pause')}
            </button>
          )}
          {detail.data?.status === 'paused' && id && (
            <Link
              to={`/mappings/${encodeURIComponent(id)}/confirm`}
              className="text-sm font-medium text-green-700 hover:underline"
            >
              {t('mappings.action.reviewAndStart')}
            </Link>
          )}
          {detail.data?.status && <StateChip entity="lifecycle" state={detail.data.status} />}
        </div>
      </div>
      {pauseFailed && <p className="mt-1 text-sm text-red-700">{pauseFailed}</p>}
      <p className="mt-1 text-sm text-gray-500 font-mono">{id}</p>
      {/* WHICH accounts, by name — the mapping's own, not the tenant's first
          (the API read the wrong ones until 2026-09-11). A migration named
          "G to Sov" that is in fact wired to the Nextcloud target is a fact
          this line makes readable without a database. */}
      {detail.data && (detail.data.sourceConnection || detail.data.targetConnection) && (
        <p className="mt-1 text-sm text-gray-600">
          {t('hub.connections', {
            source: detail.data.sourceConnection?.name ?? detail.data.sourceType,
            target: detail.data.targetConnection?.name ?? detail.data.targetType,
          })}
        </p>
      )}
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

      {/* Grant links (0108 T3) — how the person being migrated gives access to
          their own account. Above the run history because it is a thing to DO,
          and often the first: until somebody grants, there is nothing to run.
          Renders nothing on the appliance, whose API does not serve it yet. */}
      <MappingLinksPanel mappingId={id} />

      {/* Run history (0026 T3 row 23) — what each pass did, errors verbatim.
          Below the links on purpose: the queues are decisions, this is the
          record. */}
      <RunsPanel mappingId={id} />
    </div>
  );
};

export default MappingDetail;
