// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHERE A MIGRATION IS, IN THE WORDS A PERSON READS (workplan 0154 T1 (a)).
 *
 * The screens say where a migration is with its lifecycle word: *Active*,
 * *Paused*, *In cutover*. Those are the scheduler's words, and they answer
 * the operator's question. A family asks a different one: has my mail
 * arrived, and can I switch? The stages answer that, from states the server
 * ALREADY reports. None is new:
 *
 * | stage             | when |
 * |-------------------|------|
 * | `not_started`     | created, before Start: a `ready` path, or `paused` and never run |
 * | `paused`          | held after it started: `paused`, a data type its owner stopped, or one switched off with its copies kept |
 * | `copying`         | running, and its first complete pass has not finished |
 * | `kept_in_step`    | running, a first complete pass has finished, and passes continue; also the continuous lane after the switch |
 * | `ready_to_switch` | running, the check passed, and nothing blocks Finish (`finishTransition`, the same decision the Finish button takes) |
 * | `switching`       | in cutover, 0128's grace period |
 * | `done`            | finished |
 *
 * THE PHASE IS A DATA TYPE'S (0128 T5). It is `path-phase.ts`'s word, which is
 * the migration's own status until a data type has a phase of its own. So one
 * migration can have its mail switching while its files are kept in step, and
 * each row says so.
 *
 * `a-stage-for-every-state.unit.test.ts` fails when a lifecycle word or a data
 * type's pass state has no stage, and the ledger's
 * `every-path-state-has-a-stage.unit.test.ts` does the same for the path
 * states. That is `a-sixth-state-added-to-only-one-list`'s lesson applied to a
 * seventh list: a state added to one list and missing here would be a row on
 * a person's page with no word on it.
 */

import { finishTransition } from './lifecycle.ts';
import type { MappingLifecycle } from './operating-contract.ts';
import type { DomainState } from './ports.ts';

/** The stages, least advanced first: the order `leastAdvancedStage` reads. */
export const STAGES = [
  'not_started',
  'paused',
  'copying',
  'kept_in_step',
  'ready_to_switch',
  'switching',
  'done',
] as const;
export type Stage = (typeof STAGES)[number];

/** A data type's phase: the lifecycle word, or `ready` for a path row that has not started. */
export type StagePhase = MappingLifecycle | 'ready';

/** Every phase `stageOf` places. `ready` is `path_lifecycle.state`'s, before Start. */
export const STAGE_PHASES: readonly StagePhase[] = ['ready', 'paused', 'active', 'cutover', 'done', 'continuous'];

/** What the server reports about one data type of one migration. */
export interface StageFacts {
  /** Its phase: `PathPhase.phase`, or the migration's status where it has none of its own. */
  readonly phase: string;
  /** Whether its owner stopped it (0128 T4, `PathPhase.stopped`). */
  readonly stopped?: boolean;
  /** Its pass state (`DomainStatusReport.state`). Absent before a pass has touched it. */
  readonly domainState?: DomainState;
  /** Whether a pass over it has completed once (`DomainStatusReport.lastSyncedAt` is set). */
  readonly completedOnce: boolean;
  /** Whether the migration's check passed. Absent means it has not run. */
  readonly checkPassed?: boolean;
  /** Failures that block Finish, the count `finishTransition` refuses on. */
  readonly unresolvedFailures?: number;
}

/** Nothing has run: no completed pass, and no pass state past waiting its turn. */
function neverRan(facts: StageFacts): boolean {
  return !facts.completedOnce && (facts.domainState === undefined || facts.domainState === 'pending');
}

/** Switched off by its owner, or as a data type, with its copies kept. */
function heldBack(facts: StageFacts): boolean {
  return facts.stopped === true || facts.domainState === 'stopped';
}

/**
 * The stage of one data type of one migration.
 *
 * Undefined in two cases, and a screen shows neither as a stage. One is a data
 * type the migration does not copy (`skipped`), which has no row to put a
 * stage on. The other is a phase this table does not know. That one is shown
 * as the server said it, never guessed into a stage (hard rule 9); the tests
 * keep every phase the product has from reaching it.
 */
export function stageOf(facts: StageFacts): Stage | undefined {
  if (facts.domainState === 'skipped') return undefined;
  switch (facts.phase) {
    case 'done':
      return 'done';
    case 'cutover':
      return 'switching';
    case 'ready':
      return 'not_started';
    case 'paused':
      return neverRan(facts) ? 'not_started' : 'paused';
    case 'continuous':
      return heldBack(facts) ? 'paused' : 'kept_in_step';
    case 'active': {
      if (heldBack(facts)) return 'paused';
      if (!facts.completedOnce) return 'copying';
      if (facts.checkPassed !== true) return 'kept_in_step';
      const finish = finishTransition('active', facts.unresolvedFailures ?? 0);
      return 'finish' in finish && finish.finish ? 'ready_to_switch' : 'kept_in_step';
    }
    default:
      return undefined;
  }
}

/**
 * A person's stage, or a migration's from its data types: the least advanced
 * of them (0154 T1 (d)), so the line says what is holding them back.
 *
 * A data type that has not started does not pull the rest back to *Not
 * started*, unless nothing has started. Photos waiting for a Takeout export
 * would otherwise hide that the mail is kept in step. That row says *Not
 * started* itself, and what it waits for is in what needs the person
 * (T1 (c)). This is the drawing's reading (`wf-person-page.svg`).
 */
export function leastAdvancedStage(stages: readonly (Stage | undefined)[]): Stage | undefined {
  const known = stages.filter((s): s is Stage => s !== undefined);
  if (known.length === 0) return undefined;
  const started = known.filter((s) => s !== 'not_started');
  const pool = started.length > 0 ? started : known;
  return pool.reduce((least, s) => (STAGES.indexOf(s) < STAGES.indexOf(least) ? s : least));
}
