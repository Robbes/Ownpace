// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A MIGRATION'S LINES, ONE PER DATA TYPE (workplan 0153 T3, T5; 0154 T1 (b)
 * to (d)): the data type, where from and where to as two tiles, its stage in
 * words, and one sentence under it. A person's card on Migrations and the
 * person's own page draw them alike, so they cannot say two things about one
 * migration.
 *
 * With the progress read (`progress-service.ts`), each data type has its own
 * stage, from its own phase, stop and pass, and the sentence says how far it
 * is: *18,234 of ~19,000 · last pass 2 minutes ago*, or *The check passed
 * yesterday* (`stage-line.ts`). Without it, while it loads or where it failed,
 * a line falls back to what the list carries: the migration's stage, and its
 * last pass. That reading cannot say *Ready to switch*, since the list does not
 * carry the check, and says *Kept in step* instead.
 */
import React from 'react';
import { stageOf, type Stage } from '@openmig/shared';
import type { MappingListItem } from '../services/mapping-service.ts';
import {
  fitLine,
  lineParts,
  lineStage,
  type LineFacts,
  type LinePart,
  type LinesProgress,
} from '../services/stage-line.ts';
import StateChip from './StateChip.tsx';
import ProviderTile from './ProviderTile.tsx';
import { DataTypeLabel } from './icons/data-type-icons.tsx';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
import { formatNumber } from '../i18n/datetime.ts';

/** A migration's stage, from what the list carries (see the header). */
export function listStage(m: Pick<MappingListItem, 'status' | 'lastSyncAt'>): Stage | undefined {
  return stageOf({ phase: m.status, completedOnce: Boolean(m.lastSyncAt) });
}

/**
 * What a migration's lines read: the list's row on managed, and the status's
 * on the appliance, which has no list (0153 T8).
 */
export type MigrationLineFacts = Pick<MappingListItem, 'sourceType' | 'targetType' | 'status' | 'domains' | 'lastSyncAt'>;

function factsOf(m: MigrationLineFacts, domain: string, progress: LinesProgress): LineFacts {
  return {
    row: progress.report.domains.find((d) => d.domain === domain),
    migrationStatus: m.status,
    check: progress.report.check,
    failuresWaiting: progress.failuresWaiting,
  };
}

/**
 * Each line's stage, as the lines draw them: what a person's stage is the least
 * advanced of. Without the progress read, the migration's one stage.
 */
export function lineStages(m: MigrationLineFacts, progress?: LinesProgress): (Stage | undefined)[] {
  if (!progress) return [listStage(m)];
  return m.domains.map((domain) => lineStage(factsOf(m, domain, progress)));
}

export const MigrationLines: React.FC<{ migration: MigrationLineFacts; progress?: LinesProgress }> = ({
  migration: m,
  progress,
}) => {
  const t = useT();
  const { locale } = useLocale();
  const { relativeToNow } = useFormatters();
  const say = (part: LinePart): string => {
    switch (part.kind) {
      case 'ofAbout':
        return t('confirm.progress.ofAbout', {
          done: formatNumber(part.done, locale),
          total: formatNumber(part.total, locale),
        });
      case 'bytesOfAbout':
        return t('confirm.progress.ofAbout', { done: part.done, total: part.total });
      case 'totalNotKnown':
        return t('confirm.progress.totalNotKnown', { done: formatNumber(part.done, locale) });
      case 'noneFound':
        return t('confirm.progress.noneFound');
      case 'leftAsIs':
        return t('people.line.leftAsIs', { count: formatNumber(part.count, locale) });
      case 'lastPass':
        return t('people.line.lastPass', { when: relativeToNow(part.at) });
      case 'checkPassed':
        return t('people.line.checkPassed', { when: relativeToNow(part.at) });
    }
  };
  return (
    <ul className="mt-1">
      {m.domains.map((domain) => {
        const facts = progress ? factsOf(m, domain, progress) : undefined;
        const stage = facts ? lineStage(facts) : listStage(m);
        const sentence = facts ? fitLine(lineParts(stage, facts, locale).map(say)).join(' · ') : undefined;
        return (
          <li
            key={domain}
            data-domain={domain}
            {...(stage ? { 'data-stage': stage } : {})}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1 text-sm"
          >
            <DataTypeLabel domain={domain} size={18} />
            <span className="flex items-center gap-2 text-gray-700">
              <ProviderTile type={m.sourceType} role="source" size={20} />
              <span aria-hidden="true">→</span>
              <ProviderTile type={m.targetType} role="target" size={20} />
            </span>
            {stage && <StateChip entity="stage" state={stage} />}
            {facts ? (
              sentence && <span className="text-gray-600">{sentence}</span>
            ) : (
              <span className="text-gray-500">
                {m.lastSyncAt ? t('people.lastPass', { when: relativeToNow(m.lastSyncAt) }) : t('people.noPassYet')}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
};
