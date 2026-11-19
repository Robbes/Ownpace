// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A RUN LEAVES IN TRIGGER.DEV'S OWN DATABASE (workplan 0134, open
 * question 3, answered (a) on 2026-09-27).
 *
 * The task plane keeps every run's error, output and logs in `triggerdb`, with
 * no limit, and every dump of it carries them (0134 T1 (c)). A tester's words
 * got in through three doors: a failed run's error, discovery's output, and the
 * run's logs. Each can hold a folder or file name, a mailbox name, an address,
 * or the provider's own sentence. So a dump of live's `triggerdb` was a backup
 * of testers' data, and `BACKUP_RETENTION_DAYS=0` was not true.
 *
 * Now each door lets through a reference and a category instead, as the Test
 * button's answer does (0136 T3):
 *
 * - **A failed run's error.** Every task's `run` is wrapped in
 *   {@link leavesAReference}, so whatever it throws leaves as
 *   {@link planeErrorFor}'s error: the task or data type, a category, and a
 *   reference, or one of each for every data type of a pass that failed
 *   ({@link planeErrorForEach}). It has to be done INSIDE `run`: Trigger.dev's `run()` span
 *   records the exception it sees before any `catchError` hook could swap it
 *   (`TriggerTracer.startActiveSpan`, 4.5.16).
 * - **Discovery's output.** {@link outcomesForThePlane} keeps a failed data
 *   type's category and reference, and drops its error text.
 * - **The run's logs.** `trigger.config.ts` turns Trigger.dev's console
 *   interceptor off, so `log.*` writes to the container's output only, and no
 *   task uses the SDK's `logger`, which writes to the plane directly.
 *
 * The text itself is not lost. It is written to the container's output on a
 * line with the same reference, and it stays in the application's own records
 * where it always was: a pass's run log and status, discovery's own row, a
 * verification run, an apply receipt, a cutover's ledger. The erasure reaches
 * those; it never reached Trigger.dev. `app_event` holds the reference and the
 * category for the operator's log page (0129 T1), and no text: it has no column
 * for any.
 */

import { AbortTaskRunError } from '@trigger.dev/sdk';
import { PassAbortError, failureSideOf } from '@openmig/core';
import {
  classifyFailure,
  log,
  newReference,
  recordAppEvent,
  statedFailureCategoryOf,
  type FailureCategory,
} from '@openmig/shared';

/** Which task failed, and for whom. */
export interface RunWhere {
  /** The task's id, as `schemaTask` registers it. */
  readonly task: string;
  readonly tenantId?: string;
  readonly mappingId?: string;
}

/**
 * A failure the caller has already logged with its full text and recorded as
 * an event: the pass's own catch does both for a data type (0129 T1), so the
 * error only has to carry the same reference.
 */
export interface AlreadyRecorded {
  /** What was being done, from code: `email sync`, never a sentence. */
  readonly doing: string;
  readonly reference: string;
  readonly category: FailureCategory;
}

/**
 * One data type's failure in a pass, as the pass's own catch recorded it: what
 * it threw, kept for its class (whether the run may be retried), and what was
 * said of it.
 */
export interface RecordedFailure {
  readonly error: unknown;
  readonly recorded: AlreadyRecorded;
}

/** The errors this module made, so a second pass through it changes nothing. */
const made = new WeakSet<object>();

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return '';
  }
}

/** A task's own verdict: an `AbortTaskRunError` it threw on purpose. */
const isVerdict = (error: unknown): boolean => error instanceof Error && error.name === 'AbortTaskRunError';

/**
 * A refusal from Trigger.dev's own API that its executor would not retry: a 4xx
 * other than 408 and 429 (`TaskExecutor`'s `#handleError`, 4.5.16). Kept, so
 * the error made here is not retried where the one it replaces would not be.
 */
function isPlaneRefusal(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'TriggerApiError') return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * The error a task fails with, given the one it threw: the same verdict for
 * Trigger.dev, and none of the words.
 *
 * **A DELIBERATE STOP IS NOT RETRIED.** `PassAbortError` is the pass saying "25
 * items failed in a row, the world is broken, stop". Rethrown as an ordinary
 * error it went through `trigger.config.ts`'s default retry (three attempts,
 * 5s/10s/20s apart), so ONE tick produced three failed runs inside a minute
 * against a target that had already said no (live, 2026-09-11: four failed
 * passes inside 13:01, and the only way to halt them was `docker stop` on the
 * worker). `AbortTaskRunError` fails the run ONCE, and the sync tick's
 * failing-backoff ladder spaces the next attempts out. A task's own
 * `AbortTaskRunError`, a verdict such as a refused cutover, stays one too, and
 * so does a refusal Trigger.dev's own API gave, which its executor would not
 * have retried either.
 *
 * **Everything else is still retried**, and that half matters as much: a thrown
 * pool error, an OOM, a provider 500 are all worth another go, and a blanket
 * abort here would turn one bad minute into a migration that never resumes on
 * its own. The decision is the CLASS, never the words.
 *
 * **What it says:** what was being done, the category and the reference, for
 * example `email sync failed (target_refused). Reference 1a2b3c4d.` Nothing a
 * tester or a provider wrote. Unless the caller has {@link AlreadyRecorded} it,
 * the full text goes to the container's output under the same reference, and
 * the operator's log page gets a `task.<id>.failed` event.
 *
 * Never rejects, and the event is written before it resolves: a run that
 * throws may be the process's last act. Returns an error it made itself
 * unchanged.
 *
 * `failedBefore` are the data types of a pass that failed before `error` ended
 * it (workplan 0143 T5, 2026-11-19). A failed data type no longer ends the
 * pass, so something else may end it after one has failed, a read between two
 * data types for instance. They are named first, as {@link planeErrorForEach}
 * names them, so the plane's error still names every data type that failed.
 */
export async function planeErrorFor(
  error: unknown,
  where: RunWhere,
  recorded?: AlreadyRecorded,
  failedBefore: readonly RecordedFailure[] = [],
): Promise<Error> {
  if (typeof error === 'object' && error !== null && made.has(error)) return error as Error;

  let said: AlreadyRecorded;
  if (recorded) {
    said = recorded;
  } else {
    const verdict = isVerdict(error);
    const category = classifyFailure(messageOf(error), failureSideOf(error), statedFailureCategoryOf(error));
    said = { doing: where.task, reference: newReference(), category };
    // A task's own verdict is an answer; everything else went wrong.
    const level = verdict ? 'warn' : 'error';
    // The words, where the operator can read them and the plane cannot keep
    // them: the container's output. With the error itself, for its stack.
    log[level](`[${where.task}] failed [ref ${said.reference}]:`, error);
    await recordAppEvent({
      level,
      event: `task.${where.task}.failed`,
      reference: said.reference,
      ...(where.tenantId !== undefined ? { tenantId: where.tenantId } : {}),
      ...(where.mappingId !== undefined ? { mappingId: where.mappingId } : {}),
      category: said.category,
    });
  }

  return planeErrorOf([...failedBefore, { error, recorded: said }]);
}

/**
 * The error a pass fails with when one or more of its data types failed
 * (workplan 0143 T5, 2026-11-19). The pass no longer ends at the first one: the
 * data types after it still have their turn, and the pass fails once they have
 * had it, as hard rule 9 asks.
 *
 * **Each failure is said as {@link planeErrorFor} says one,** with the reference
 * and the category the pass's own catch recorded for it, in the order the pass
 * took them, and still without the words. One failure reads exactly as it
 * always did; two read `calendar sync failed (target_refused). Reference
 * 1a2b3c4d. email sync failed (source_unreachable). Reference 5e6f7a8b.` Each
 * reference is the one its data type's run event, status row and app event
 * carry, so the operator's log page finds every one of them.
 *
 * **Not retried if any of them may not be.** A retry runs the whole pass again,
 * so a data type that stopped itself after items failed in a row would be run
 * again against a target that had already said no, which is what the first
 * rule of {@link planeErrorFor} exists to stop. The others are named all the
 * same, and the sync tick's failing-backoff ladder brings the next pass. When
 * every one of them is worth another go, the pass is retried, as a pass with
 * one such failure always was.
 *
 * At least one, by its type: a pass in which nothing failed has no error to fail
 * with.
 */
export function planeErrorForEach(failures: readonly [RecordedFailure, ...RecordedFailure[]]): Error {
  return planeErrorOf(failures);
}

/** One failure, as the plane hears it: whether it fails its run once, and its sentence. */
function sentenceOf({ error, recorded }: RecordedFailure): { readonly failsOnce: boolean; readonly sentence: string } {
  const stopped = error instanceof PassAbortError;
  const failsOnce = stopped || isVerdict(error) || isPlaneRefusal(error);
  const what = stopped
    ? 'stopped itself after items failed in a row'
    : failsOnce
      ? 'ended, and is not retried'
      : 'failed';
  return { failsOnce, sentence: `${recorded.doing} ${what} (${recorded.category}). Reference ${recorded.reference}.` };
}

/** The plane's error for the failures given, in their order: see {@link planeErrorForEach}. */
function planeErrorOf(failures: readonly RecordedFailure[]): Error {
  const said = failures.map(sentenceOf);
  const sentence = said.map((s) => s.sentence).join(' ');
  const planeError = said.some((s) => s.failsOnce) ? new AbortTaskRunError(sentence) : new Error(sentence);
  made.add(planeError);
  return planeError;
}

/** The ids a task's payload carries, when it carries them. */
function whereFrom(task: string, payload: unknown): RunWhere {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
  return {
    task,
    ...(typeof p.tenantId === 'string' ? { tenantId: p.tenantId } : {}),
    ...(typeof p.mappingId === 'string' ? { mappingId: p.mappingId } : {}),
  };
}

/**
 * How a run hands over what it opened, to be ended once the run is over and,
 * if it failed, once its failure is recorded: `afterwards(() => pools.end())`.
 */
export type Afterwards = (end: () => Promise<void>) => void;

/**
 * A task's `run`, whose every throw leaves through {@link planeErrorFor}.
 *
 * Every task under `src/jobs` is defined with one (the guard
 * `a-run-that-kept-a-testers-words` reads them all), so a task added later
 * cannot let a tester's words out by forgetting.
 *
 * **WHAT A RUN OPENED IS ENDED AFTER ITS FAILURE IS RECORDED.** The run gets a
 * third argument, {@link Afterwards}, and what it hands over there is ended
 * here, last handed first, once the run has returned or its failure is on the
 * operator's log page. That page is on the tenant pool a run opens
 * (`openTaskPools`), and the failure is recorded here, after the run: ended in
 * the run's own `finally`, as run-cutover and run-rollback ended theirs until
 * 0138 T1 step 2's review, the pool was gone by then, and every such failure
 * left a reference that named no event. An end that fails is said on the
 * container's output and changes neither the plane's error nor what the run
 * returned: the run's outcome is what happened, and a run failed for a pool
 * that would not close would be retried, a cutover or a rollback done twice.
 */
export function leavesAReference<P, C, R>(
  task: string,
  run: (payload: P, context: C, afterwards: Afterwards) => Promise<R>,
): (payload: P, context: C) => Promise<R> {
  return async (payload, context) => {
    const ends: Array<() => Promise<void>> = [];
    try {
      return await run(payload, context, (end) => {
        ends.push(end);
      });
    } catch (error) {
      throw await planeErrorFor(error, whereFrom(task, payload));
    } finally {
      for (const end of ends.reverse()) {
        try {
          await end();
        } catch (error) {
          log.error(`[${task}] could not end what the run opened:`, error);
        }
      }
    }
  };
}

/** One data type's count, as discovery hands it back. */
export interface CountedOutcome {
  readonly domain: string;
  readonly ok: boolean;
  readonly error?: string;
}

/** The same, as the plane keeps it: a failure's category and reference, and no text. */
export type OutcomeForThePlane =
  | { readonly domain: string; readonly ok: true }
  | { readonly domain: string; readonly ok: false; readonly category: FailureCategory; readonly reference: string };

/**
 * Discovery's output, without the error text of a data type it could not count.
 *
 * The text is already in discovery's own row, where the wizard reads it
 * (`recordDiscoveryError`). Here it goes to the container's output under a new
 * reference, and the operator's log page gets `discovery.<domain>.failed`.
 * Nothing reads a run's output back: the wizard polls the row.
 */
export async function outcomesForThePlane(
  outcomes: readonly CountedOutcome[],
  where: RunWhere,
): Promise<OutcomeForThePlane[]> {
  const kept: OutcomeForThePlane[] = [];
  for (const outcome of outcomes) {
    if (outcome.ok) {
      kept.push({ domain: outcome.domain, ok: true });
      continue;
    }
    const reference = newReference();
    // Discovery only reads the source.
    const category = classifyFailure(outcome.error ?? '', 'source');
    log.warn(`[${where.task}] ${outcome.domain} could not be counted [ref ${reference}]:`, outcome.error);
    await recordAppEvent({
      level: 'error',
      event: `discovery.${outcome.domain}.failed`,
      reference,
      ...(where.tenantId !== undefined ? { tenantId: where.tenantId } : {}),
      ...(where.mappingId !== undefined ? { mappingId: where.mappingId } : {}),
      category,
    });
    kept.push({ domain: outcome.domain, ok: false, category, reference });
  }
  return kept;
}
