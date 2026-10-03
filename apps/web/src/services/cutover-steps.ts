// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE STEPS BEFORE A SWITCH, AS ONE LIST (workplan 0153 T5, 0154 T4).
 *
 * Seven steps in cutover order (0034's, and its numbers): Deletions, Moves,
 * Failures, Sharing, Check, Confirmed, Finish. A migration's page lists them
 * for that migration, and a person's page sums each across that person's
 * migrations. Each row has three things (0154 T4):
 *
 * - **its count**, from the read the queue pages and the menu share
 *   (`GET /api/attention`), or *could not be read* where a queue was not read.
 *   The check's is what it last said, from the progress read
 *   (`MigrationProgressReport.check`): not run, running, could not run, not
 *   passed, or passed, and when;
 * - **its state**, *Done*, *Needs you* or *Not yet*;
 * - which migrations it comes from, so the row opens each migration's own
 *   page for that step.
 *
 * WHAT DECIDES A STATE:
 * - Deletions, Moves and Failures need the person while anything waits in
 *   them, and are done when nothing does.
 * - Sharing is worked after finishing, so it is *Not yet* until every one of
 *   the migrations is done; then it needs the person while rows are open.
 * - Check is done when every migration's check has passed, or the migration
 *   is already in its cutover or done, which only a passed check lets it be.
 *   A check that did not pass, or never ran, is *Not yet*: the copy may still
 *   be catching up, and the check's own page says what differed.
 * - Confirmed follows the check: *Not yet* until it passes, then *Done*, a list
 *   ready to read. It is never a queue, so it has no count.
 * - Finish needs the person while a migration is in its cutover, and is done
 *   when every one is.
 *
 * A check the progress read did not reach is unread, never *not run* (hard
 * rule 9): *"nobody ran it"* and *"we could not ask"* are different claims.
 *
 * Pure, so a test can hold every rule; the list draws what this returns.
 */
import type { CheckFacts, MappingAttention } from '@openmig/shared';

export type StepKey = 'deletions' | 'moves' | 'failures' | 'sharing' | 'check' | 'confirmed' | 'finish';
export type StepState = 'done' | 'needsYou' | 'notYet';

export interface StepsMigration {
  readonly id: string;
  /**
   * The migration's lifecycle, as the list or the status carries it;
   * undefined where it could not be read, which leaves Sharing's state and
   * Finish unknown rather than guessed.
   */
  readonly status: string | undefined;
}

/**
 * What the check row says. Of one migration, its own facts and when. Of
 * several, how many passed, and *not run* only when none of them ran.
 */
export type CheckSaid =
  | { readonly kind: 'passed'; readonly at?: string }
  | { readonly kind: 'partly'; readonly passed: number; readonly total: number }
  | { readonly kind: 'notRun' }
  | { readonly kind: 'running' }
  | { readonly kind: 'couldNotRun'; readonly at: string }
  | { readonly kind: 'notPassed'; readonly at?: string };

export interface Step {
  readonly key: StepKey;
  /** What waits in this step across the migrations; undefined when it could not be read. */
  readonly count: number | undefined;
  /** Each migration's own count for this step, for the row's links. */
  readonly perMigration: ReadonlyArray<{ readonly id: string; readonly count: number | undefined }>;
  /** Undefined when the count could not be read: a state from half a read would be a guess. */
  readonly state: StepState | undefined;
  /** The check row's words; undefined on the other rows, and where the check could not be read. */
  readonly check?: CheckSaid;
}

const QUEUE: Readonly<Record<'deletions' | 'moves' | 'failures' | 'sharing', keyof MappingAttention>> = {
  deletions: 'deletionsWaiting',
  moves: 'movesWaiting',
  failures: 'failuresWaiting',
  sharing: 'sharingOpen',
};

/** Past its check: only a passed check lets a migration into its cutover. */
const pastCheck = (m: StepsMigration): boolean => m.status === 'cutover' || m.status === 'done';

/**
 * The seven steps for one migration, or for a person's several. `attention`
 * and `checks` are keyed by migration id, and undefined when their read
 * failed: every count resting on one is then unknown, and so is every state.
 */
export function cutoverSteps(
  migrations: readonly StepsMigration[],
  attention: ReadonlyMap<string, MappingAttention> | undefined,
  checks: ReadonlyMap<string, CheckFacts> | undefined,
): Step[] {
  const lifecycleUnread = migrations.some((m) => m.status === undefined);
  const read = (m: StepsMigration): MappingAttention | 'unread' | undefined => {
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
      state = lifecycleUnread ? undefined : !allDone ? 'notYet' : count > 0 ? 'needsYou' : 'done';
    } else state = count > 0 ? 'needsYou' : 'done';
    return { key, count, perMigration, state };
  };

  // Each migration's check: past it by its lifecycle, or what the progress
  // read says of it. A migration the read does not list is unread: the read
  // is older than the migration, and says nothing of it.
  const factsOf = (m: StepsMigration): CheckFacts | undefined => checks?.get(m.id);
  const checkUnread = migrations.some((m) => !pastCheck(m) && factsOf(m) === undefined);
  const passed = (m: StepsMigration): boolean => pastCheck(m) || factsOf(m)?.state === 'passed';
  const passedCount = migrations.filter(passed).length;
  const everyCheckPassed = migrations.length > 0 && passedCount === migrations.length;

  const said = ((): CheckSaid | undefined => {
    if (checkUnread || migrations.length === 0) return undefined;
    if (migrations.length === 1) {
      const m = migrations[0]!;
      const facts = factsOf(m);
      if (pastCheck(m)) return facts?.state === 'passed' ? { kind: 'passed', at: facts.at } : { kind: 'passed' };
      switch (facts!.state) {
        case 'passed':
          return { kind: 'passed', at: facts!.at };
        case 'not_passed':
          return { kind: 'notPassed', at: facts!.at };
        case 'could_not_run':
          return { kind: 'couldNotRun', at: facts!.at };
        case 'running':
          return { kind: 'running' };
        case 'not_run':
          return { kind: 'notRun' };
      }
    }
    if (everyCheckPassed) return { kind: 'passed' };
    if (passedCount > 0) return { kind: 'partly', passed: passedCount, total: migrations.length };
    return migrations.every((m) => factsOf(m)?.state === 'not_run') ? { kind: 'notRun' } : { kind: 'notPassed' };
  })();

  const check: Step = {
    key: 'check',
    count: checkUnread ? undefined : passedCount,
    perMigration: migrations.map((m) => ({ id: m.id, count: passed(m) ? 1 : 0 })),
    state: checkUnread ? undefined : everyCheckPassed ? 'done' : 'notYet',
    ...(said ? { check: said } : {}),
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
    count: lifecycleUnread ? undefined : migrations.filter((m) => m.status === 'done').length,
    perMigration: migrations.map((m) => ({
      id: m.id,
      count: m.status === undefined ? undefined : m.status === 'done' ? 1 : 0,
    })),
    state: lifecycleUnread ? undefined : allDone ? 'done' : inCutover > 0 ? 'needsYou' : 'notYet',
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

/** Each migration's check, by id, from the progress read; undefined where that read is not in. */
export function checksOf(
  progress: { readonly mappings: ReadonlyArray<{ readonly mappingId: string; readonly check: CheckFacts }> } | undefined,
): ReadonlyMap<string, CheckFacts> | undefined {
  return progress === undefined ? undefined : new Map(progress.mappings.map((m) => [m.mappingId, m.check]));
}
