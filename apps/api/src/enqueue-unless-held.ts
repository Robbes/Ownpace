// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The one way this API enqueues a task, and the platform hold and a closed
 * organisation at every door (workplan 0132 T6 (b); 0131 §6 R7 step 4; 0085
 * T2).
 *
 * An operator hold (managed migration 0023, `routes/platform-pause.ts`) is a
 * drain: start nothing new, wait until the tick's log says no pass is still
 * in flight, deploy, lift the hold. The sync tick read it. The eight places
 * here that enqueue on a person's request did not: *Sync now*, a cutover's
 * preparation, a discovery count, the first pass on *Start*, a verification,
 * a deletion or a relocation followed through, and a confirmation pass. So a
 * tester who pressed *Sync now* during a deploy started a pass after the
 * operator had watched the in-flight count reach 0, on tasks about to be
 * replaced.
 *
 * Every enqueue now goes through `enqueueUnlessHeld`. It reads the open hold.
 * While one is open it answers 409 with the hold's sentence and hands back
 * nothing, and the door returns having written and enqueued nothing.
 * Otherwise it hands back the enqueue, which holds the only `tasks.trigger(`
 * in `apps/api/src`, and the only pg-boss enqueue (0167 T6: the runner
 * `OWNPACE_JOB_RUNNER` names, `job-runner.ts`).
 * `a-hold-that-holds-every-door.unit.test.ts` sweeps the source for any other.
 *
 * *Sync now*'s gates live in `routes/migrations/sync-now.ts` (`pressSyncNow`),
 * which the route and the machine's press for live's pass check
 * (`scripts/live-pass.ts`, workplan 0132 T9) both call, and a stored rotation
 * too, for the migrations failing on the connection it repaired
 * (`routes/connections.ts`). Held, each of those presses is refused here.
 *
 * ## Asked before the first write
 *
 * Four doors write before they enqueue. *Start* activates the migration, a
 * verification opens its row, and each apply records a receipt and who
 * ordered it. A refusal after those writes would leave an active migration
 * with no first pass, a row saying `running` with nothing behind it, or a
 * removal recorded as ordered that never was. So those doors ask before their
 * first write, and use the enqueue they are handed afterwards. Every door asks
 * after its own refusals (a migration not found, a grant withdrawn, a gate the
 * ledger shuts), because those still stand once the hold is lifted.
 *
 * ## Joins
 *
 * A press the route itself joins to work already under way enqueues nothing
 * and is not asked: *Start* on a migration already active, a verification
 * already running, an apply whose receipt is still queued, a confirmation
 * already running. Discovery is different. Its join is the runner's (the
 * idempotency key in `discoveryTriggerOptions`), decided inside the enqueue,
 * so the door asks first, and while a hold is open a discovery press is
 * refused even when it would only have joined a count begun in the last
 * `DISCOVERY_JOIN_WINDOW`. That count still lands. The confirm screen that
 * starts it shows the refusal's sentence under whatever rows arrive, and
 * counts again once it reads the hold lifted (`ConfirmMigration.tsx`).
 *
 * ## The sentence
 *
 * The operator's own words, verbatim (ADR-0024's prose boundary). During the
 * alpha the operator writes them in Dutch when starting the hold (0132 D6, T6
 * step 2). When they typed none, the door says `HELD_DEFAULT`, in English, as
 * this API's other refusals are. The banner above every screen has its own
 * default in the reader's language (`pause.hold.default` in the web app).
 *
 * ## A closed organisation (0085 T2)
 *
 * Closing an organisation stops everything that would start a pass, and these
 * eight doors all would. So the close is read here too, in the same
 * transaction as the hold and before it: 409 `account_closed`, with the
 * sentence that names the close and the day the data is removed
 * (`closed-organisation.ts`), and nothing enqueued or written. The close
 * comes first because it outlasts a hold: once the hold is lifted, the
 * organisation is still closed. A reopen sets it open again, and the next
 * press goes through.
 *
 * ## A read that fails is not "no hold"
 *
 * Hard rule 9. The error goes to the door's own catch, which answers 500. A
 * hold or a close that could not be read must not start the pass it would
 * have stopped.
 *
 * ## A start nobody pressed
 *
 * One start has nobody to answer: a migration that starts by itself when its
 * person's grant lands (`start-when-granted.ts`; ADR-0035's amendment, the
 * owner's answer of 2026-10-03). `enqueueIfFree` asks the same two questions
 * and says which stopped it instead of answering 409, and the migration then
 * stays as it was, for the owner to start.
 */

import type { Pool } from 'pg';
import type { LedgerDriver } from '@openmig/ledger';
import { readOpenPause, readOrganisationClosure } from '@openmig/managed';
import { getTriggerClient } from '@openmig/scheduler';
import type { EnqueueOptions } from '@openmig/scheduler/pg-boss';
import { log } from '@openmig/shared';
import { withTenantDb } from './middleware/auth.ts';
import { accountClosedAnswer } from './closed-organisation.ts';
import { jobRunner, pgBossProducer } from './job-runner.ts';
import type { Answerable } from './types/api.ts';

/** What a door asks of the enqueue besides the task and its payload: Trigger.dev's names for them. */
export interface EnqueueAsked {
  readonly tags?: readonly string[];
  /** One running run per value: Trigger.dev's `concurrencyKey`, pg-boss's singleton key. */
  readonly concurrencyKey?: string;
  /** The same key within `idempotencyKeyTTL` hands back the run it started. */
  readonly idempotencyKey?: string;
  /** Trigger.dev's duration, as `job-resolution.ts` writes it: `<n>s`, `<n>m`, `<n>h` or `<n>d`. */
  readonly idempotencyKeyTTL?: string;
}

/**
 * The enqueue, on whichever runner `OWNPACE_JOB_RUNNER` names (0167 T6),
 * handed out only while no hold is open. Every door reads the run's `id` and
 * nothing else of what comes back; on pg-boss `joined` also says whether an
 * earlier run with the same idempotency key was handed back.
 */
export type Enqueue = (
  taskId: string,
  payload: Record<string, unknown>,
  options?: EnqueueAsked,
) => Promise<{ readonly id: string; readonly joined?: boolean }>;

/** What a held door says when the operator typed no sentence. */
export const HELD_DEFAULT =
  'We have paused copying while we update the platform. Nothing was started. Try again when copying resumes.';

/** The organisation's close and the platform hold, read in one transaction, the close first. */
async function whatStopsAStart(tenantId: string, source: Pool | LedgerDriver) {
  return withTenantDb(tenantId, source, async (db) => ({
    closure: await readOrganisationClosure(db, tenantId),
    hold: await readOpenPause(db),
  }));
}

/**
 * Ask whether the organisation is closed, then the platform hold; answer 409
 * and return null when either stops the press.
 *
 * Otherwise returns the enqueue. The client is built when the enqueue is
 * called, not here, so a deployment without `TRIGGER_SECRET_KEY` (or, on
 * pg-boss, without `JOBS_DATABASE_URL`) still fails where each door already
 * lands that failure on its own row.
 */
export async function enqueueUnlessHeld(
  res: Answerable,
  tenantId: string,
  source: Pool | LedgerDriver,
): Promise<Enqueue | null> {
  const { closure, hold } = await whatStopsAStart(tenantId, source);
  if (closure) {
    res.status(409).json(accountClosedAnswer(closure));
    return null;
  }
  if (hold) {
    const sentence = hold.message ?? HELD_DEFAULT;
    res.status(409).json({
      error: 'platform_held',
      message: sentence,
      reason: sentence,
      since: hold.startedAt,
    });
    return null;
  }
  return enqueue;
}

/**
 * `enqueueUnlessHeld` for a start nobody pressed: the same two questions, in
 * the same order, with nobody to answer. Hands back the enqueue, or says what
 * stopped it.
 */
export async function enqueueIfFree(
  tenantId: string,
  source: Pool | LedgerDriver,
): Promise<{ readonly enqueue: Enqueue } | { readonly stopped: 'closed' | 'held' }> {
  const { closure, hold } = await whatStopsAStart(tenantId, source);
  if (closure) return { stopped: 'closed' };
  if (hold) return { stopped: 'held' };
  return { enqueue };
}

/**
 * The one enqueue in this API, handed out only by the two doors above. On
 * Trigger.dev it is the SDK's own `tasks.trigger`, called exactly as before,
 * so every test that mocks `@openmig/scheduler` still hears it. On pg-boss it
 * is the producer's, which this module reaches only on that branch.
 */
const enqueue: Enqueue = async (taskId, payload, options = {}) => {
  if (jobRunner() === 'trigger') {
    const { tags, ...rest } = options;
    return getTriggerClient().tasks.trigger(taskId, payload, { ...rest, ...(tags ? { tags: [...tags] } : {}) });
  }
  return enqueueOnPgBoss(taskId, payload, options);
};

/**
 * The pg-boss half, reached only through the enqueue the two doors above hand
 * out; not exported, so no door can enqueue round the hold through it
 * (`a-hold-that-holds-every-door`). A queue the worker has not made (it never
 * started on this schema) fails here, naming the queue, and the door lands
 * that on its row as any failed enqueue. A connection that failed is said in
 * `QUEUE_UNREACHABLE`, with no address, and logged as it was: the doors echo
 * the message to the person who pressed, and node-postgres names the host
 * and port it could not reach.
 */
async function enqueueOnPgBoss(
  taskId: string,
  payload: Record<string, unknown>,
  options: EnqueueAsked,
): Promise<{ readonly id: string; readonly joined: boolean }> {
  let enqueued: { runId: string | null; joined: boolean };
  try {
    const producer = await pgBossProducer();
    enqueued = await producer.enqueue(taskId, payload, pgBossOptionsFor(options));
  } catch (err) {
    if (!isUnreachable(err)) throw err;
    log.error(`[jobs] the job queue could not be reached to enqueue "${taskId}":`, err);
    // The cause is for the server's log; the doors echo the message alone.
    throw new Error(QUEUE_UNREACHABLE, { cause: err });
  }
  // Only a `stately` queue turns a run away without an id, and none of the
  // queues this API enqueues on is one; said, never returned as a run.
  if (enqueued.runId === null) throw new Error(`pg-boss turned the run on "${taskId}" away: one is already waiting.`);
  return { id: enqueued.runId, joined: enqueued.joined };
}

/** What a door says, and stores, when the jobs database could not be reached. */
export const QUEUE_UNREACHABLE = 'The job queue could not be reached, so nothing was enqueued. Try again shortly.';

/** Socket errors Node gives for a host it could not reach or that dropped the connection. */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

/**
 * Whether the enqueue failed on the way to the database rather than in it:
 * a socket error, Postgres's connection-exception class (`08…`), a refused
 * login (`28…`), a server shutting down or not yet up (`57P0…`), or a
 * dropped or timed-out connection. Read
 * through `cause` and an `AggregateError`'s errors, which is how Node reports
 * a name that resolved to several addresses.
 */
export function isUnreachable(err: unknown, depth = 0): boolean {
  if (depth > 5 || err === null || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  if (UNREACHABLE_CODES.has(code) || /^(08|28|57P0)/.test(code)) return true;
  const message = typeof e.message === 'string' ? e.message : '';
  if (/Connection terminated|timeout expired when connecting|^connect E[A-Z]+ /.test(message)) return true;
  if (Array.isArray(e.errors) && e.errors.some((x) => isUnreachable(x, depth + 1))) return true;
  return isUnreachable(e.cause, depth + 1);
}

/** Trigger.dev's options in the runner's words: the singleton key, the idempotency key and its seconds, the tags. */
export function pgBossOptionsFor(options: EnqueueAsked): EnqueueOptions {
  if (options.idempotencyKey !== undefined && options.idempotencyKeyTTL === undefined) {
    throw new Error('An idempotency key was asked for without how long it holds (idempotencyKeyTTL).');
  }
  return {
    ...(options.concurrencyKey !== undefined ? { serializeBy: options.concurrencyKey } : {}),
    ...(options.idempotencyKey !== undefined
      ? { idempotency: { key: options.idempotencyKey, ttlSeconds: durationSeconds(options.idempotencyKeyTTL!) } }
      : {}),
    ...(options.tags ? { tags: [...options.tags] } : {}),
  };
}

const UNIT_SECONDS: Readonly<Record<string, number>> = { s: 1, m: 60, h: 3_600, d: 86_400 };

/** `'15m'` → 900: the duration forms Trigger.dev's `idempotencyKeyTTL` takes. Throws on any other. */
export function durationSeconds(duration: string): number {
  const m = /^(\d+)([smhd])$/.exec(duration);
  if (!m) throw new Error(`"${duration}" is not a duration this API can read (a number and s, m, h or d).`);
  return Number(m[1]) * UNIT_SECONDS[m[2]!]!;
}
