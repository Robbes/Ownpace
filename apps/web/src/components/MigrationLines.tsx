// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MIGRATION'S LINES, ONE PER DATA TYPE (workplan 0153 T3, T5): the data
 * type, where from and where to as two tiles, its stage in words (0154 T1),
 * and its last pass. A person's card on Migrations and the person's own page
 * draw them alike, so they cannot say two things about one migration.
 *
 * The stage is read from what the list carries: the lifecycle, and whether a
 * pass has completed. A migration whose check passed shows *Kept in step*,
 * not *Ready to switch*, until the list carries the check (0154 T2).
 */
import React from 'react';
import { stageOf, type Stage } from '@openmig/shared';
import type { MappingListItem } from '../services/mapping-service.ts';
import StateChip from './StateChip.tsx';
import ProviderTile from './ProviderTile.tsx';
import { DataTypeLabel } from './icons/data-type-icons.tsx';
import { useT, useFormatters } from '../i18n/index.tsx';

/** A migration's stage, from what the list carries (see the header). */
export function listStage(m: Pick<MappingListItem, 'status' | 'lastSyncAt'>): Stage | undefined {
  return stageOf({ phase: m.status, completedOnce: Boolean(m.lastSyncAt) });
}

export const MigrationLines: React.FC<{ migration: MappingListItem }> = ({ migration: m }) => {
  const t = useT();
  const { relativeToNow } = useFormatters();
  const stage = listStage(m);
  return (
    <ul className="mt-1">
      {m.domains.map((domain) => (
        <li key={domain} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1 text-sm">
          <DataTypeLabel domain={domain} size={18} />
          <span className="flex items-center gap-2 text-gray-700">
            <ProviderTile type={m.sourceType} role="source" size={20} />
            <span aria-hidden="true">→</span>
            <ProviderTile type={m.targetType} role="target" size={20} />
          </span>
          {stage && <StateChip entity="stage" state={stage} />}
          <span className="text-gray-500">
            {m.lastSyncAt ? t('people.lastPass', { when: relativeToNow(m.lastSyncAt) }) : t('people.noPassYet')}
          </span>
        </li>
      ))}
    </ul>
  );
};
