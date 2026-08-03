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
import { useT } from '../i18n';
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

  if (!id) {
    return <p className="text-sm text-amber-800">{t('hub.noId')}</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">
          {detail.data?.name ?? t('hub.fallbackTitle')}
        </h2>
        {detail.data?.status && (
          <span className="text-xs text-gray-500">{detail.data.status}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500 font-mono">{id}</p>
      {detail.error != null && (
        <p className="mt-1 text-sm text-amber-800">{t('hub.detailError')}</p>
      )}

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {SCREENS.map((s) => (
          <li key={s.path}>
            <Link
              to={`/mappings/${encodeURIComponent(id)}/${s.path}`}
              className="flex items-start gap-3 p-4 h-full bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-sm"
            >
              <s.icon className="w-5 h-5 mt-0.5 text-gray-500 flex-shrink-0" />
              <span>
                <span className="block text-sm font-medium text-gray-900">{t(s.nameKey)}</span>
                <span className="block mt-0.5 text-sm text-gray-600">{t(s.blurbKey)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MappingDetail;
