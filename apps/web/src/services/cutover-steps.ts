// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A PERSON'S STEPS BEFORE THEY SWITCH, AS ONE LIST (workplan 0153 T5, 0154 T4).
 *
 * The migration hub shows seven cards in cutover order: Deletions, Moves,
 * Failures, Sharing, Check, Confirmed, Finish. A person's page shows the same
 * seven as one ordered list, each summed across that person's migrations,
 * with three things on each row (0154 T4):
 *
 * - **its count**, from the read the queue pages and the menu share
 *   (`GET /api/attention`), or *could not be read* where a queue was not read;
 * - **its state**, *Done*, *Needs you* or *Not yet*;
 * - which of the person's migrations it comes from, so the row opens each
 *   migration's own page for that step.
 *
 * WHAT DECIDES A STATE:
 * - Deletions, Moves and Failures need the person while anything waits in
 *   them, and are done when nothing does.
 * - Sharing is worked after finishing, so it is *Not yet* until every one of
 *   the person's migrations is done; then it needs them while rows are open.
 * - Check is done when every migration's check has passed: the read says
 *   *ready to finish*, or the migration is already in its cutover or done.
 * - Confirmed follows the check: *Not yet* until it passes, then *Done*, a list
 *   ready to read. It is never a queue, so it has no count.
 * - Finish needs the person while a migration is in its cutover, and is done
 *   when every one is.
 *
 * Pure, so a test can hold every rule; the page draws what this returns.
 */
import type { MappingAttention } from '@openmig/shared';

export type StepKey = 'deletions' | 'moves' | 'failures' | 'sharing' | 'check' | 'confirmed' | 'finish';
export type StepState = 'done' | 'needsYou' | 'notYet';

export interface PersonMigrationStatus {
  readonly id: string;
  /** The migration's lifecycle, as the list carries it. */
  readonly status: string;
}

export interface Step {
  readonly key: StepKey;
  /** What waits in this step across the person's migrations; undefined when it could not be read. */
  readonly count: number | undefined;
  /** Each migration's own count for this step, for the row's links. */
  readonly perMigration: ReadonlyArray<{ readonly id: string; readonly count: number | undefined }>;
  /** Undefined when the count could not be read: a state from half a read would be a guess. */
  readonly state: StepState | undefined;
}

const QUEUE: Readonly<Record<'deletions' | 'moves' | 'failures' | 'sharing', keyof MappingAttention>> = {
  deletions: 'deletionsWaiting',
  moves: 'movesWaiting',
  failures: 'failuresWaiting',
  sharing: 'sharingOpen',
};

const checkPassed = (m: PersonMigrationStatus, a: MappingAttention | undefined): boolean =>
  m.status === 'cutover' || m.status === 'done' || a?.readyForCutover === true;

/**
 * The seven steps for one person. `attention` is keyed by migration id, and
 * undefined when the read failed: every count is then unknown, and so is
 * every state that rests on one.
 */
export function personSteps(
  migrations: readonly PersonMigrationStatus[],
  attention: ReadonlyMap<string, MappingAttention> | undefined,
): Step[] {
  const read = (m: PersonMigrationStatus): MappingAttention | 'unread' | undefined => {
    if (attention === undefined) return 'unread';
    const a = attention.get(m.id);
    if (a && (a.blindSpots?.length ?? 0) > 0) return 'unread';
    return a;
  };

  const queueStep = (key: 'deletions' | 'moves' | 'failures' | 'sharing'): Step => {
    const perMigration = migrations.map((m) => {
      const a = read(m);
      if (a === 'unread') return { id: m.id, count: undefined };
      return { id: m.id, count: a ? Number(a[QUEUE[key]] ?? 0) : 0 };
    });
    const count = perMigration.some((p) => p.count === undefined)
      ? undefined
      : perMigration.reduce((sum, p) => sum + (p.count ?? 0), 0);
    let state: StepState | undefined;
    if (count === undefined) state = undefined;
    else if (key === 'sharing') {
      const allDone = migrations.length > 0 && migrations.every((m) => m.status === 'done');
      state = !allDone ? 'notYet' : count > 0 ? 'needsYou' : 'done';
    } else state = count > 0 ? 'needsYou' : 'done';
    return { key, count, perMigration, state };
  };

  const everyCheckPassed =
    migrations.length > 0 &&
    migrations.every((m) => {
      const a = read(m);
      return checkPassed(m, a === 'unread' ? undefined : a);
    });
  const checkUnread = migrations.some((m) => read(m) === 'unread' && m.status !== 'cutover' && m.status !== 'done');
  const passedCount = (m: PersonMigrationStatus) => {
    const a = read(m);
    return checkPassed(m, a === 'unread' ? undefined : a) ? 1 : 0;
  };
  const check: Step = {
    key: 'check',
    count: checkUnread ? undefined : migrations.reduce((sum, m) => sum + passedCount(m), 0),
    perMigration: migrations.map((m) => ({ id: m.id, count: passedCount(m) })),
    state: checkUnread ? undefined : everyCheckPassed ? 'done' : 'notYet',
  };

  const inCutover = migrations.filter((m) => m.status === 'cutover').length;
  const allDone = migrations.length > 0 && migrations.every((m) => m.status === 'done');
  const confirmed: Step = {
    key: 'confirmed',
    count: undefined,
    perMigration: migrations.map((m) => ({ id: m.id, count: undefined })),
    state: checkUnread ? undefined : everyCheckPassed ? 'done' : 'notYet',
  };
  const finish: Step = {
    key: 'finish',
    count: migrations.filter((m) => m.status === 'done').length,
    perMigration: migrations.map((m) => ({ id: m.id, count: m.status === 'done' ? 1 : 0 })),
    state: allDone ? 'done' : inCutover > 0 ? 'needsYou' : 'notYet',
  };

  return [
    queueStep('deletions'),
    queueStep('moves'),
    queueStep('failures'),
    queueStep('sharing'),
    check,
    confirmed,
    finish,
  ];
}
