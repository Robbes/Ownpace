// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE LINE PER DATA TYPE: ITS STAGE, AND ONE SENTENCE UNDER IT (workplan 0154
 * T1 (b) and (d)).
 *
 * A person's card and their page drew every data type of a migration with the
 * migration's stage, read from the list's lifecycle word, and a last pass. With
 * the progress read (`progress-service.ts`) each data type has its own stage,
 * from its own phase, stop and pass, and a sentence that says how far it is:
 *
 * | stage            | the sentence |
 * |------------------|--------------|
 * | Copying          | *1,204 of ~2,000* |
 * | Kept in step     | *18,234 of ~19,000 · last pass 2 minutes ago* |
 * |                  | *210 of ~612 · 402 left as they are* (the last pass dropped for the budget) |
 * | Ready to switch  | *The check passed yesterday* |
 * | Paused           | *18,234 of ~19,000 · last pass 3 days ago* |
 * | Switching, Done  | *18,234 of ~19,000* |
 * | Not started      | nothing: the stage says it |
 *
 * The count is T2's (`progress-totals.ts`): *of ~* a total discovery found,
 * *total not known* where it found none, never *of 0*. Files lead with their
 * bytes when both sides were measured, *12.4 of ~38 GB*, as the drawing
 * has them (`wf-migrations-page.svg`): for files the bytes are the measure a
 * person knows. T3's time left joins the sentence when it is built.
 *
 * READY TO SWITCH IS NEVER GUESSED. It needs the check passed, as the Finish
 * page reads it, and the failures that block Finish counted: where they could
 * not be counted, the line stays *Kept in step* (hard rule 9).
 *
 * Pure, so a test can hold every rule; the component draws what this returns.
 */
import {
  stageOf,
  type CheckFacts,
  type DomainProgress,
  type MappingAttention,
  type MigrationProgressReport,
  type ProgressReport,
  type Stage,
} from '@openmig/shared';
import type { Locale } from '../i18n/strings.ts';
import { bytesOfAbout, progressTotals } from './progress-totals.ts';

/** What a line's sentence reads of a row: its counts and its last pass. */
export type LineRow = Pick<
  DomainProgress,
  'domain' | 'itemsSynced' | 'itemsFound' | 'itemsAdopted' | 'bytesTransferred' | 'bytesFound' | 'lastSyncedAt'
>;

/**
 * What a line's sentence is read from: a row's counts and the migration's
 * check. A person's progress page has these and not a row's phase, since its
 * stage is worked out on the server (0154 T8), so the sentence asks for no more.
 */
export interface SentenceFacts {
  readonly row: LineRow | undefined;
  readonly check: CheckFacts;
}

/** What one line is read from. */
export interface LineFacts extends SentenceFacts {
  /** The data type's row from the progress read; absent when no pass has touched it. */
  readonly row: DomainProgress | undefined;
  /** The migration's lifecycle word, for a data type with no row. */
  readonly migrationStatus: string;
  /** The migration's check. */
  readonly check: CheckFacts;
  /** The failures that block Finish, or undefined when they could not be counted. */
  readonly failuresWaiting: number | undefined;
}

/** A data type's stage, from its own facts. */
export function lineStage(f: LineFacts): Stage | undefined {
  const row = f.row;
  return stageOf({
    phase: row?.phase ?? f.migrationStatus,
    ...(row?.stopped ? { stopped: true } : {}),
    ...(row ? { domainState: row.state } : {}),
    completedOnce: Boolean(row?.lastSyncedAt),
    checkPassed: f.check.state === 'passed' && f.failuresWaiting !== undefined,
    unresolvedFailures: f.failuresWaiting ?? 0,
  });
}

/** One part of the sentence; the component says it in the reader's language. */
export type LinePart =
  | { readonly kind: 'ofAbout'; readonly done: number; readonly total: number }
  | { readonly kind: 'bytesOfAbout'; readonly done: string; readonly total: string }
  | { readonly kind: 'totalNotKnown'; readonly done: number }
  | { readonly kind: 'noneFound' }
  | { readonly kind: 'leftAsIs'; readonly count: number }
  | { readonly kind: 'lastPass'; readonly at: string }
  | { readonly kind: 'checkPassed'; readonly at: string };

/** How far it is: the bytes for files when both sides were measured, the items otherwise. */
function countPart(row: LineRow | undefined, locale: Locale): LinePart | undefined {
  if (!row) return undefined;
  if (row.domain === 'file') {
    const bytes = bytesOfAbout(row, locale);
    if (bytes) return { kind: 'bytesOfAbout', done: bytes.done, total: bytes.total };
  }
  const totals = progressTotals(row);
  if (totals.kind === 'ofAbout') return { kind: 'ofAbout', done: row.itemsSynced, total: totals.total };
  if (totals.kind === 'noneFound') return { kind: 'noneFound' };
  return { kind: 'totalNotKnown', done: row.itemsSynced };
}

/** The sentence's parts for a data type at `stage`, most important first. */
export function lineParts(stage: Stage | undefined, f: SentenceFacts, locale: Locale): LinePart[] {
  const count = countPart(f.row, locale);
  // What the count leaves out but the new system holds: without it, contacts
  // kept in step read *210 of ~612*, a third done, while the other 402
  // were already there (0124 T2).
  const left: LinePart | undefined =
    f.row?.itemsAdopted !== undefined && f.row.itemsAdopted > 0 ? { kind: 'leftAsIs', count: f.row.itemsAdopted } : undefined;
  const lastPass: LinePart | undefined = f.row?.lastSyncedAt ? { kind: 'lastPass', at: f.row.lastSyncedAt } : undefined;
  const parts: (LinePart | undefined)[] = (() => {
    switch (stage) {
      case 'copying':
      case 'switching':
      case 'done':
        return [count, left];
      case 'kept_in_step':
      case 'paused':
        return [count, left, lastPass];
      case 'ready_to_switch':
        return f.check.state === 'passed' ? [{ kind: 'checkPassed', at: f.check.at }] : [count, left];
      default:
        return [];
    }
  })();
  return parts.filter((p): p is LinePart => p !== undefined);
}

/** 0118's budget for a line under a stage. */
export const LINE_WORDS = 12;

/**
 * The sentence, within the budget: parts are dropped from the least important
 * end until it fits, and the first is never dropped. `said` is each part in
 * words, in the order `lineParts` gave them.
 */
export function fitLine(said: readonly string[], words = LINE_WORDS): string[] {
  const kept = [...said];
  const count = (parts: readonly string[]) => parts.join(' ').split(/\s+/).filter(Boolean).length;
  while (kept.length > 1 && count(kept) > words) kept.pop();
  return kept;
}

/** What a migration's lines read beyond the list: its progress, and what blocks its Finish. */
export interface LinesProgress {
  readonly report: MigrationProgressReport;
  /** Failures that block Finish, or undefined when they could not be counted. */
  readonly failuresWaiting: number | undefined;
}

/**
 * One migration's lines' facts, from the progress read and the attention read.
 * Undefined while the progress read has no row for it, and the lines then draw
 * what the list carries. The failures that block Finish are the ones needing a
 * decision, which is what `failuresWaiting` counts and what the Finish button
 * refuses on; a read that failed, or one that could not look, counts none.
 */
export function linesProgressOf(
  progress: ProgressReport | undefined,
  mappingId: string,
  attention: MappingAttention | undefined,
  attentionRead: boolean,
): LinesProgress | undefined {
  const report = progress?.mappings.find((m) => m.mappingId === mappingId);
  if (!report) return undefined;
  const counted = attentionRead && (attention?.blindSpots?.length ?? 0) === 0;
  return { report, failuresWaiting: counted ? (attention?.failuresWaiting ?? 0) : undefined };
}
