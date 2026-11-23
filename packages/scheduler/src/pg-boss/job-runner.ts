// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MANAGED EDITION'S JOB RUNNER, ON OUR OWN POSTGRES (ADR-0054, workplan 0167).
 *
 * What the managed edition asked of Trigger.dev until alpha.18 (0167 §1), said
 * once over pg-boss, each ask proved against a real Postgres (0167 §3):
 *
 *  - a QUEUE per task, whose runs are retried as a whole (three attempts,
 *    exponential, 5 s to 60 s), capped in time, and kept alive by a heartbeat
 *    so a worker that dies has its run picked up again;
 *  - NO MORE RUNS AT ONCE THAN THE WORKER'S LIMIT (`runsAtOnce`, Trigger.dev's
 *    environment limit), every queue together: a run past it is not fetched
 *    and waits in its queue, unclaimed and at its attempt (`./run-slots.ts`).
 *    So the queues are worked on pg-boss's `fetch`, `touch`, `complete` and
 *    `fail`, not its `work()`, whose loops fetch whenever they are idle;
 *  - ONE RUN AT A TIME PER KEY (`serializeBy`, Trigger.dev's `concurrencyKey`):
 *    a `singleton` queue lets one job per key be active and any number wait;
 *  - JOINING A RUN ALREADY ASKED FOR (`idempotency`, Trigger.dev's
 *    `idempotencyKey` + `idempotencyKeyTTL`): the same key within the window
 *    hands back the run it started, measured from that run's creation, not
 *    from a clock-aligned slot. pg-boss's own `singletonSeconds` is a slot, and
 *    shares `singletonKey` with the per-key limit, so it cannot answer both
 *    questions; the join is done here, under a transaction-scoped advisory
 *    lock, which also holds through PgBouncer in transaction mode;
 *  - A RUN THAT SAYS "DO NOT TRY AGAIN" (`RunNotRetried`, Trigger.dev's
 *    `AbortTaskRunError`, and a payload that failed its schema, `ZodError`):
 *    settled as pg-boss's `deadletter`, which fails the job terminally
 *    whatever attempts it had left. Decided by the error's NAME, because a run
 *    in a forked process hands back a name and a message, never a class;
 *  - WAITING FOR A CHILD (`enqueueAndWait`, Trigger.dev's `triggerAndWait`):
 *    pg-boss has no in-handler await, so the parent polls the child's row;
 *  - CANCEL and STATUS BY THE RUN'S ID ALONE (`orchestrator_ref` holds only
 *    the id), CRON, and an OPERATOR'S VIEW of every queue, read with bounded
 *    queries.
 *
 * TWO CLIENTS. `PgBossJobRunner` is the worker's: it migrates the schema,
 * declares the queues, supervises, fires the cron schedules and works the
 * queues. `PgBossProducer` is everyone else's (the API, and a run that
 * enqueues another): it never migrates, supervises, schedules, works or
 * creates a queue. A producer that fired schedules would fire every cron job
 * from the API with the worker stopped.
 *
 * A RUN NEVER OUTLIVES ITS TIME LIMIT, OR ITS CLAIM. pg-boss fails a run that
 * passes its queue's `expireInSeconds` and retries it, and on a `singleton`
 * queue the retry may start at once; if the old run were still going, one
 * mapping would have two writers. So `work` aborts the run's signal itself,
 * `killMarginSeconds` before that limit, and when pg-boss reports the claim
 * lost (a cancel, or another supervisor failing the run); `workInChild` kills
 * the run's process on that signal and settles only after the process has
 * exited. A run in this process must stop on `ctx.signal` itself.
 *
 * THE WORKER (`apps/worker/src/runner/worker.ts`) works the managed edition's
 * jobs on it, in pg-boss mode, `managed.yml`'s default since workplan 0167 T7;
 * the API enqueues through `PgBossProducer`. This module is reachable
 * only through the `@openmig/scheduler/pg-boss` subpath, so neither edition
 * loads pg-boss unless something imports that path on purpose, and the
 * appliance may not (`apps/selfhost/src/no-managed-leakage.unit.test.ts`). The
 * appliance's `Scheduler` port (croner, in-process) is untouched.
 *
 * ONE SCHEMA VERSION, THE ONE IT WAS PROVED ON. pg-boss installs its schema at
 * `start()`, or migrates an older one up. A schema that a LATER release has
 * migrated further it leaves as it is, and runs on without a word. So pg-boss
 * is pinned exactly, and both clients' `start()` refuse any schema version but
 * `PG_BOSS_SCHEMA_VERSION`, which
 * `scripts/a-job-schema-the-runner-was-not-proved-on.unit.test.ts` holds to
 * the pinned release's own.
 *
 * PAYLOADS STAY IDS-ONLY (ADR-0004): what a job row carries is what the caller
 * passes, and the callers pass tenant and mapping ids, never content.
 */

import { PgBoss } from 'pg-boss';
import type { ConstructorOptions, Db, JobWithMetadata, QueueResult, SendOptions } from 'pg-boss';
import pg from 'pg';
import { log } from '@openmig/shared';
import { runInChild } from './run-in-child.ts';
import { RunSlots, workQueue, type ClaimedRun, type QueueSource, type Settlement } from './run-slots.ts';

/**
 * The schema version of the pg-boss release `packages/scheduler/package.json`
 * pins: what that release names as `pgboss.schema` in its own `package.json`,
 * and what `PgBoss#schemaVersion()` reads back from a database it installed or
 * migrated. It moves with the pin and only with it, once that release's
 * migration has been read; the guard above fails until the two agree.
 */
const PG_BOSS_SCHEMA_VERSION = 46;

/** Thrown by a handler to fail its run now, with no further attempts. */
export class RunNotRetried extends Error {
  override name = 'RunNotRetried';
}

/**
 * What a run that reached its queue's time limit is failed with. Not retried,
 * as Trigger.dev does not retry `MAX_DURATION_EXCEEDED`: a pass that hung once
 * would otherwise hold its mapping's key for every attempt's hour.
 */
export class RunTimedOut extends Error {
  override name = 'RunTimedOut';
}

/**
 * The error names that fail a run with no further attempts, so that a run
 * settles as Trigger.dev 4.8.8 settled it (ADR-0054 §2):
 *  - ours, which the jobs throw (`apps/worker/src/jobs/what-a-run-leaves.ts`),
 *    and Trigger.dev's, which no job has thrown since alpha.18;
 *  - a payload that failed its schema, which no retry can mend;
 *  - a run that reached its time limit (`MAX_DURATION_EXCEEDED`);
 *  - a run whose process ran out of its heap (`RunOutOfMemory`, V8's line or
 *    SIGABRT), which the retry would meet again;
 *  - a run whose process a SIGKILL from outside ended (`RunPossiblyOutOfMemory`):
 *    in a container with a memory limit, the kernel's out-of-memory killer,
 *    which Trigger.dev reads as `TASK_PROCESS_MAYBE_OOM_KILLED` and does not retry.
 * A run the runner itself stopped keeps its own settlement (`RunTimedOut`, a
 * cancel). A claim lost because the worker died or restarted is retried, by
 * pg-boss's own sweep: the passes converge (0167 point 2).
 */
export const NOT_RETRIED_ERROR_NAMES: ReadonlySet<string> = new Set([
  'RunNotRetried',
  'AbortTaskRunError',
  'ZodError',
  'RunTimedOut',
  'RunOutOfMemory',
  'RunPossiblyOutOfMemory',
]);

/** How pg-boss is to settle a run that threw `err`. */
export function settlementFor(err: unknown): 'deadletter' | 'failed' {
  return err instanceof Error && NOT_RETRIED_ERROR_NAMES.has(err.name) ? 'deadletter' : 'failed';
}

/** How a queue's runs are admitted, retried and kept alive. */
export interface QueueSpec {
  readonly name: string;
  /**
   * `singleton`: one active run per `serializeBy` key (or per queue, for jobs
   * sent without one), any number waiting. `stately`: at most one waiting and
   * one active, which is what a tick wants. `standard`: no limit.
   */
  readonly policy: 'singleton' | 'stately' | 'standard';
  /** Attempts in all, the first included. Default 3. */
  readonly attempts?: number;
  readonly retryDelaySeconds?: number;
  readonly retryDelayMaxSeconds?: number;
  /**
   * The run's time limit, pg-boss's `expireInSeconds`. Default 3600, the
   * `maxDuration` Trigger.dev's config set until alpha.18.
   */
  readonly maxDurationSeconds?: number;
  /** A run whose worker stops beating for this long is failed and retried. Default 30, minimum 10. */
  readonly heartbeatSeconds?: number;
}

const DEFAULT_MAX_DURATION_SECONDS = 3600;

/**
 * How long before pg-boss's own time limit the worker stops a run itself.
 *
 * pg-boss counts the limit from the run's `started_on`, written in the fetch,
 * before the handler is called; the worker's timer starts at the handler, so
 * it trails pg-boss's by the fetch-to-handler latency. In the margin, the run
 * must also be killed, its process reaped, and its failure written, all before
 * pg-boss fails it on its own and a retry can be fetched. Each of those is
 * milliseconds on a quiet worker and can be seconds on a loaded one (an event
 * loop held by another run, a pool waiting for a connection). 30 s covers
 * several seconds of each with room, and is under 1 % of the hour every
 * catalog queue has. A limit that short is only a test's, which gets a tenth,
 * and at least 1 s.
 */
export function killMarginSeconds(maxDurationSeconds: number): number {
  return Math.min(30, Math.max(1, Math.floor(maxDurationSeconds / 10)));
}

export interface RunContext {
  readonly queue: string;
  readonly runId: string;
  /** 1 on the first attempt. */
  readonly attempt: number;
  /**
   * Aborted when the run is cancelled, its claim is otherwise lost, or it
   * reaches its time limit (`reason` is then a `RunTimedOut`).
   */
  readonly signal: AbortSignal;
}

export type RunHandler<P, R> = (payload: P, ctx: RunContext) => Promise<R>;

export interface EnqueueOptions {
  /** One active run per value of this key in a `singleton` queue. */
  readonly serializeBy?: string;
  /** The same key within `ttlSeconds` of the run it started hands that run back. */
  readonly idempotency?: { readonly key: string; readonly ttlSeconds: number };
  readonly tags?: readonly string[];
}

export interface Enqueued {
  /**
   * Null only on a `stately` queue that already has a run waiting: the new one
   * was turned away, which for a tick is the point (one waiting, one running).
   */
  readonly runId: string | null;
  /** True when an earlier run with the same idempotency key was handed back. */
  readonly joined: boolean;
}

export type RunState = 'queued' | 'retrying' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface RunStatus {
  readonly runId: string;
  readonly queue: string;
  readonly state: RunState;
  readonly attempt: number;
  readonly tags: readonly string[];
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  /** The handler's return value once completed; `{ name, message }` once failed. */
  readonly output: unknown;
}

export type RunOutcome<R> =
  | { readonly ok: true; readonly runId: string; readonly output: R }
  | { readonly ok: false; readonly runId: string; readonly state: 'failed' | 'cancelled'; readonly error: unknown };

export interface QueueOverview {
  readonly queue: string;
  readonly policy: string;
  readonly queued: number;
  readonly active: number;
  readonly failed: number;
  readonly total: number;
  /** The keys with a run active now, for a `singleton` or `stately` queue. */
  readonly activeKeys: readonly string[];
}

export interface FailedRun {
  readonly runId: string;
  readonly queue: string;
  readonly attempt: number;
  readonly failedAt: Date | null;
  readonly error: unknown;
  readonly tags: readonly string[];
}

/** What both clients are given. */
export interface PgBossClientOptions {
  readonly connectionString: string;
  /** The schema pg-boss installs into. It must exist and belong to the connecting role. */
  readonly schema: string;
  readonly maxConnections?: number;
}

export interface PgBossJobRunnerOptions extends PgBossClientOptions {
  /** How often an idle worker asks for work. Default 2. */
  readonly pollingIntervalSeconds?: number;
  /**
   * The most runs this worker runs at once, across every queue it works:
   * `MAX_PASSES_IN_FLIGHT` + 2 on the managed stack, as Trigger.dev's
   * environment limit was until alpha.18. A run past it is not fetched, and
   * waits in its queue
   * (`./run-slots.ts`). Default: no limit but each queue's own.
   */
  readonly runsAtOnce?: number;
  /** How often queue counters are refreshed for `overview()`. Default 15. */
  readonly monitorIntervalSeconds?: number;
  /**
   * How often runs whose heartbeat stopped, or whose time ran out, are failed
   * and retried. pg-boss's own default is 60, which adds up to a minute to
   * picking up a run whose worker died; 15 here. Measured in workplan 0167.
   */
  readonly superviseIntervalSeconds?: number;
  /** How often due cron schedules are sent. Default 5. */
  readonly cronWorkerIntervalSeconds?: number;
  /**
   * How often one instance may run a cron pass, claimed across every instance
   * on the schema. pg-boss's default, 30, is what production uses; a schedule
   * is sent within its due window of 60 s either way.
   */
  readonly cronMonitorIntervalSeconds?: number;
}

/** What a job row's `data` holds: the caller's payload, plus what the runner itself reads. */
interface JobData<P> {
  readonly payload: P;
  readonly idem?: string;
  readonly tags?: readonly string[];
}

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'cancelled', 'failed']);

const STATE_NAMES: Readonly<Record<JobWithMetadata['state'], RunState>> = {
  created: 'queued',
  retry: 'retrying',
  active: 'running',
  completed: 'completed',
  cancelled: 'cancelled',
  failed: 'failed',
};

/** A pg-boss job id. A ref of Trigger.dev's shape (`run_…`) is never one. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A schema or table name pg-boss made, put into SQL only after this check. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
/** The most failures `recentFailures` hands back in one call. */
const MAX_FAILURES = 1000;

function errorRecord(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'NonError', message: typeof err === 'string' ? err : JSON.stringify(err) };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function identifier(what: string, name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`The jobs ${what} "${name}" is not a plain identifier.`);
  return name;
}

function assertRunId(runId: string): void {
  if (!RUN_ID.test(runId)) throw new Error(`"${runId}" is not a pg-boss run id; this runner never started it.`);
}

/** The pg-boss queue options a spec stands for. */
function queueOptions(spec: QueueSpec): {
  policy: QueueSpec['policy'];
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  retryDelayMax: number;
  expireInSeconds: number;
  heartbeatSeconds: number;
} {
  return {
    policy: spec.policy,
    retryLimit: (spec.attempts ?? 3) - 1,
    retryDelay: spec.retryDelaySeconds ?? 5,
    retryBackoff: true,
    retryDelayMax: spec.retryDelayMaxSeconds ?? 60,
    expireInSeconds: spec.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS,
    heartbeatSeconds: spec.heartbeatSeconds ?? 30,
  };
}

/** Resolves once every one of `runs` has settled, or after `ms`, whichever is first. */
async function settledWithin(runs: readonly Promise<void>[], ms: number): Promise<void> {
  if (runs.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(runs),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}

function hasCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;
}

/** What both clients share: enqueueing, waiting, status and cancel by id, the operator's view. */
abstract class PgBossClient {
  readonly #boss: PgBoss;
  protected readonly pool: pg.Pool;
  protected readonly schema: string;
  protected readonly specs = new Map<string, QueueSpec>();
  protected started = false;
  /** pg-boss was asked to start, and so may hold connections, whether or not it started. */
  #opened = false;

  protected constructor(opts: PgBossClientOptions, boss: Partial<ConstructorOptions>, poolName: string) {
    this.schema = identifier('schema', opts.schema);
    this.#boss = new PgBoss({
      connectionString: opts.connectionString,
      schema: opts.schema,
      max: opts.maxConnections ?? 5,
      // The schema is created by whoever provisions the role; pg-boss only migrates inside it.
      createSchema: false,
      // Polling only: LISTEN does not survive PgBouncer's transaction pooling.
      useListenNotify: false,
      ...boss,
    });
    // pg-boss reports trouble on an event; an unhandled 'error' event would kill
    // the process, and swallowing it would hide it (hard rule 9). It is logged
    // whole but for the values a database error carries (the shared log,
    // workplan 0168); the operation that failed rejects on its own.
    this.boss.on('error', (err: unknown) => {
      log.error('[jobs] pg-boss error:', err);
    });
    this.pool = new pg.Pool({ connectionString: opts.connectionString, max: 2, application_name: poolName });
  }

  /** The pg-boss instance; only this class makes it. */
  protected get boss(): PgBoss {
    return this.#boss;
  }

  /**
   * Start pg-boss and refuse a schema at any version but the one this runner
   * was proved on. One that a later release migrated further is still there as
   * it was, and is refused here rather than run on.
   */
  protected async startBoss(refusal: (err: unknown) => Error | null): Promise<void> {
    // Read before pg-boss starts: a started pg-boss has already registered
    // itself on the schema and run its first cron pass.
    const found = await this.#schemaVersionNow();
    if (found !== null && found > PG_BOSS_SCHEMA_VERSION) throw this.#refusal(found);
    this.#opened = true;
    try {
      await this.boss.start();
    } catch (err) {
      const said = refusal(err);
      if (said === null) throw err;
      throw said;
    }
    this.started = true;
    const version = await this.#boss.schemaVersion();
    if (version !== PG_BOSS_SCHEMA_VERSION) {
      this.started = false;
      const refused = this.#refusal(version);
      await this.boss.stop({ graceful: false }).catch((err: unknown) => {
        // The refusal is the answer; a stop that failed is said beside it, never instead of it.
        log.error('[jobs] pg-boss did not stop after refusing the schema:', err);
      });
      throw refused;
    }
  }

  /** pg-boss's own version row, or null before pg-boss has installed the schema. */
  async #schemaVersionNow(): Promise<number | null> {
    const installed = await this.pool.query<{ t: string | null }>('SELECT to_regclass($1)::text AS t', [
      `${this.schema}.version`,
    ]);
    if (installed.rows[0]?.t == null) return null;
    const { rows } = await this.pool.query<{ version: number }>(`SELECT version FROM ${this.schema}.version LIMIT 1`);
    return rows[0] === undefined ? null : Number(rows[0].version);
  }

  #refusal(version: number | null): Error {
    return new Error(
      `The jobs schema "${this.schema}" is at pg-boss schema version ${String(version)}, and this runner was ` +
        `proved on version ${PG_BOSS_SCHEMA_VERSION} only (ADR-0054). A later pg-boss migrated it: run the release ` +
        'that did, or move the pin and PG_BOSS_SCHEMA_VERSION together.',
    );
  }

  /** Stop polling; `graceful` waits for running handlers to settle first. */
  async stop(opts: { graceful?: boolean; timeoutMs?: number } = {}): Promise<void> {
    // Also after a start() that threw: pg-boss may have opened its pool, and stop() closes it.
    if (this.started || this.#opened) {
      await this.boss.stop({ graceful: opts.graceful ?? true, timeout: opts.timeoutMs ?? 30_000 });
      this.started = false;
      this.#opened = false;
    }
    await this.pool.end();
  }

  /** Put a run on `queue`; see `EnqueueOptions`. */
  async enqueue<P>(queue: string, payload: P, opts: EnqueueOptions = {}): Promise<Enqueued> {
    const spec = this.spec(queue);
    try {
      return await this.#enqueue(spec, payload, opts);
    } catch (err) {
      if (hasCode(err, 'PGBOSS_QUEUE_NOT_FOUND')) {
        throw new Error(
          `The queue "${queue}" does not exist in the jobs schema "${this.schema}". The worker creates every ` +
            'queue when it starts, so it has not started on this schema yet; nothing was enqueued.',
          { cause: err },
        );
      }
      throw err;
    }
  }

  async #enqueue<P>(spec: QueueSpec, payload: P, opts: EnqueueOptions): Promise<Enqueued> {
    const queue = spec.name;
    const data: JobData<P> = {
      payload,
      ...(opts.idempotency ? { idem: opts.idempotency.key } : {}),
      ...(opts.tags ? { tags: [...opts.tags] } : {}),
    };
    const send: SendOptions = opts.serializeBy !== undefined ? { singletonKey: opts.serializeBy } : {};
    if (!opts.idempotency) {
      const runId = await this.boss.send(queue, data as object, send);
      if (runId === null && spec.policy !== 'stately') {
        throw new Error(`pg-boss refused a run on "${queue}" and gave no id.`);
      }
      return { runId, joined: false };
    }
    const { key, ttlSeconds } = opts.idempotency;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Two requests with one key queue here, one after the other, until COMMIT.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ownpace-jobs:${queue}:${key}`]);
      const db: Db = { executeSql: (text, values) => client.query(text, values) };
      const { rows } = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
      const cutoff = rows[0]!.now.getTime() - ttlSeconds * 1000;
      const earlier = (await this.boss.findJobs<JobData<P>>(queue, { data: { idem: key }, db }))
        .filter((j) => j.createdOn.getTime() >= cutoff)
        .sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime())[0];
      if (earlier) {
        await client.query('COMMIT');
        return { runId: earlier.id, joined: true };
      }
      const runId = await this.boss.send(queue, data as object, { ...send, db });
      if (runId === null) throw new Error(`pg-boss refused a run on "${queue}" and gave no id.`);
      await client.query('COMMIT');
      return { runId, joined: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Enqueue a child run and wait for it to settle (Trigger.dev's
   * `triggerAndWait`). The parent's own `signal` stops the wait, not the child.
   */
  async enqueueAndWait<P, R>(
    queue: string,
    payload: P,
    opts: EnqueueOptions & { pollMs?: number; signal?: AbortSignal } = {},
  ): Promise<RunOutcome<R>> {
    const { runId } = await this.enqueue(queue, payload, opts);
    if (runId === null) throw new Error(`"${queue}" already has a run waiting; there is no child to wait for.`);
    for (;;) {
      const status = await this.#statusOn(queue, runId);
      if (status === null) throw new Error(`Run ${runId} on "${queue}" is gone before it settled.`);
      if (status.state === 'completed') {
        return { ok: true, runId, output: (status.output as { value: R }).value };
      }
      if (status.state === 'failed' || status.state === 'cancelled') {
        return { ok: false, runId, state: status.state, error: status.output };
      }
      await sleep(opts.pollMs ?? 1000, opts.signal);
    }
  }

  /**
   * A run's status, by its id alone (what `orchestrator_ref` holds), or on a
   * queue already known. Null when no declared queue holds the run: pg-boss
   * deletes a settled run after its retention, so a caller holding a ref it
   * once saw reads null as "finished, and gone".
   */
  async status(runId: string): Promise<RunStatus | null>;
  async status(queue: string, runId: string): Promise<RunStatus | null>;
  async status(a: string, b?: string): Promise<RunStatus | null> {
    if (b !== undefined) return this.#statusOn(a, b);
    const queue = await this.#queueOf(a);
    return queue === null ? null : this.#statusOn(queue, a);
  }

  async #statusOn(queue: string, runId: string): Promise<RunStatus | null> {
    assertRunId(runId);
    const job = await this.boss.getJobById<JobData<unknown>>(queue, runId);
    return job === null ? null : toStatus(job);
  }

  /**
   * Cancel a run, by its id alone or on a known queue; true when a run not yet
   * settled was cancelled. A running handler sees its `signal` abort at its
   * next heartbeat.
   */
  async cancel(runId: string): Promise<boolean>;
  async cancel(queue: string, runId: string): Promise<boolean>;
  async cancel(a: string, b?: string): Promise<boolean> {
    const runId = b ?? a;
    assertRunId(runId);
    const queue = b !== undefined ? a : await this.#queueOf(runId);
    if (queue === null) return false;
    const result = await this.boss.cancel(queue, runId);
    return result.affected > 0;
  }

  /**
   * Which queue holds `runId`: every queue in the schema, not only those this
   * client declared, so a live run is never read as gone because this client
   * does not know its queue. At most one statement per job table (every queue
   * shares one unless partitioned), each on the table's `(name, id)` key.
   */
  async #queueOf(runId: string): Promise<string | null> {
    assertRunId(runId);
    const queues = await this.boss.getQueues();
    const byTable = new Map<string, string[]>();
    for (const q of queues) {
      const table = identifier('table', q.table);
      byTable.set(table, [...(byTable.get(table) ?? []), q.name]);
    }
    for (const [table, names] of byTable) {
      const { rows } = await this.pool.query<{ name: string }>(
        `SELECT name FROM ${this.schema}.${table} WHERE name = ANY($1::text[]) AND id = $2::uuid`,
        [names, runId],
      );
      if (rows[0]) return rows[0].name;
    }
    return null;
  }

  /**
   * Every declared queue: what waits, what runs, what failed. One read of
   * pg-boss's queue table, whose counters the worker's monitor refreshes;
   * no job row is read.
   */
  async overview(): Promise<QueueOverview[]> {
    const queues: QueueResult[] = await this.boss.getQueues([...this.specs.keys()]);
    return queues.map((q) => ({
      queue: q.name,
      policy: String(q.policy),
      queued: q.queuedCount,
      active: q.activeCount,
      failed: q.failedCount,
      total: q.totalCount,
      activeKeys: q.singletonsActive ?? [],
    }));
  }

  /**
   * The most recent failed runs on `queue`, newest first, with their errors as
   * stored. Returns at most `limit` (1,000 at most), read in the order of
   * pg-boss's own `(name, completed_on)` index and stopped there; the read
   * passes the completed runs newer than the oldest failure it returns. When
   * the queue holds fewer failures than `limit`, that is every completed run
   * it keeps, which pg-boss's retention bounds (7 days by default).
   */
  async recentFailures(queue: string, limit = 20): Promise<FailedRun[]> {
    this.spec(queue);
    const take = Math.max(1, Math.min(MAX_FAILURES, Math.floor(limit)));
    const q = await this.boss.getQueue(queue);
    if (q === null) return [];
    const { rows } = await this.pool.query<{
      id: string;
      retry_count: number;
      completed_on: Date | null;
      output: unknown;
      tags: string[] | null;
    }>(recentFailuresSql(this.schema, identifier('table', q.table)), [queue, take]);
    return rows.map((j) => ({
      runId: j.id,
      queue,
      attempt: j.retry_count + 1,
      failedAt: j.completed_on,
      error: j.output,
      tags: j.tags ?? [],
    }));
  }

  protected spec(queue: string): QueueSpec {
    const spec = this.specs.get(queue);
    if (!spec) throw new Error(`Queue "${queue}" was not declared to this jobs client.`);
    return spec;
  }
}

/**
 * The statement `recentFailures` runs: on pg-boss's `<table>_i16` index
 * (`job_common_i16` for a queue not partitioned), `(name, completed_on) WHERE
 * completed_on IS NOT NULL`, read backwards and stopped at the limit.
 * Exported for the test that reads its plan.
 */
export function recentFailuresSql(schema: string, table: string): string {
  return (
    `SELECT id, retry_count, completed_on, output, data->'tags' AS tags FROM ${identifier('schema', schema)}.` +
    `${identifier('table', table)} WHERE name = $1 AND state = 'failed' AND completed_on IS NOT NULL ` +
    'ORDER BY completed_on DESC LIMIT $2'
  );
}

/**
 * THE PRODUCER: for the API, and for a run that enqueues another (the tick,
 * cutover). It enqueues, waits, reads and cancels, and nothing more: no
 * migration, no supervision, no cron, no work, no queue made. It knows each
 * queue's spec from its constructor, so it needs no `start(queues)`; a queue
 * the worker has not created yet fails the enqueue, by name.
 */
export class PgBossProducer extends PgBossClient {
  constructor(opts: PgBossClientOptions, queues: readonly QueueSpec[]) {
    super(
      opts,
      {
        migrate: false,
        supervise: false,
        schedule: false,
        application_name: 'ownpace-jobs-producer',
      },
      'ownpace-jobs-producer-enqueue',
    );
    for (const spec of queues) this.specs.set(spec.name, spec);
  }

  /** Connect, and refuse a jobs schema the worker has not installed, or one at another version. */
  async start(): Promise<void> {
    await this.startBoss((err) => {
      const message = err instanceof Error ? err.message : '';
      if (message === 'pg-boss is not installed' || message === 'pg-boss database requires migrations') {
        return new Error(
          `The jobs schema "${this.schema}" is not at pg-boss schema version ${PG_BOSS_SCHEMA_VERSION} ` +
            `(pg-boss: "${message}"). A producer never migrates it; the worker does, when it starts.`,
          { cause: err },
        );
      }
      return null;
    });
  }
}

/** THE WORKER: migrates, declares the queues, supervises, fires the schedules, works the runs. */
export class PgBossJobRunner extends PgBossClient {
  readonly #pollingIntervalSeconds: number;
  /** The worker's count of runs at once, which every queue's loop takes a slot of before it fetches. */
  readonly #slots: RunSlots;
  /** Aborted at the stop: no loop fetches again. */
  readonly #stop = new AbortController();
  /** Aborted once the stop's wait is spent: every run still going is told its claim is gone. */
  readonly #abandon = new AbortController();
  /** Each queue's loop, which resolves once it has stopped fetching. */
  readonly #loops: Promise<void>[] = [];
  /** The runs going, each until it has settled. */
  readonly #going = new Set<Promise<void>>();

  constructor(opts: PgBossJobRunnerOptions) {
    super(
      opts,
      {
        migrate: true,
        monitorIntervalSeconds: opts.monitorIntervalSeconds ?? 15,
        superviseIntervalSeconds: opts.superviseIntervalSeconds ?? 15,
        cronWorkerIntervalSeconds: opts.cronWorkerIntervalSeconds ?? 5,
        ...(opts.cronMonitorIntervalSeconds !== undefined ? { cronMonitorIntervalSeconds: opts.cronMonitorIntervalSeconds } : {}),
        application_name: 'ownpace-jobs',
      },
      'ownpace-jobs-enqueue',
    );
    this.#pollingIntervalSeconds = opts.pollingIntervalSeconds ?? 2;
    this.#slots = new RunSlots(opts.runsAtOnce ?? Number.POSITIVE_INFINITY);
  }

  /** The slots of the worker's limit taken now, and the queues in line for one: for a test, and the stop's line. */
  get runsNow(): { readonly limit: number; readonly inUse: number; readonly waiting: number } {
    return { limit: this.#slots.limit, inUse: this.#slots.inUse, waiting: this.#slots.waiting };
  }

  async start(queues: readonly QueueSpec[]): Promise<void> {
    await this.startBoss(() => null);
    for (const spec of queues) {
      const options = queueOptions(spec);
      const existing = await this.boss.getQueue(spec.name);
      if (existing === null) await this.boss.createQueue(spec.name, options);
      else {
        const { policy: _policy, ...changeable } = options;
        await this.boss.updateQueue(spec.name, changeable);
      }
      this.specs.set(spec.name, spec);
    }
  }

  /**
   * Work `queue` in this process, `concurrency` runs at a time, and never more
   * runs at once across every queue than the worker's `runsAtOnce`: a run past
   * either is not fetched, and waits in its queue (`./run-slots.ts`). The
   * handler's `signal` aborts on a cancel, a lost claim, or
   * `killMarginSeconds` before the queue's time limit; a handler that ignores
   * it can outlive its run, so a pass belongs in `workInChild`, which cannot.
   */
  async work<P, R>(queue: string, handler: RunHandler<P, R>, opts: { concurrency?: number } = {}): Promise<void> {
    this.spec(queue);
    if (this.#stop.signal.aborted || !this.started) throw new Error(`The jobs runner is not running; "${queue}" is not worked.`);
    const table = identifier('table', (await this.boss.getQueue(queue))?.table ?? '');
    const boss = this.boss;
    const source: QueueSource<JobData<P>> = {
      fetch: async () => {
        const [job] = await boss.fetch<JobData<P>>(queue, { batchSize: 1 });
        return job ?? null;
      },
      touch: async (run) => {
        const touched = await boss.touch(queue, [{ id: run.id, retryCount: run.retryCount }]);
        return touched.affected > 0;
      },
      settle: (run, settlement) => this.#settle(queue, table, run, settlement),
      giveBack: (run) => this.#giveBack(queue, table, run),
    };
    this.#loops.push(
      workQueue<JobData<P>>({
        queue,
        source,
        slots: this.#slots,
        concurrency: opts.concurrency ?? 1,
        pollingIntervalMs: this.#pollingIntervalSeconds * 1000,
        stop: this.#stop.signal,
        run: (job, claim) => this.#runOne(queue, job, claim, handler),
        started: (settled) => {
          this.#going.add(settled);
          void settled.finally(() => this.#going.delete(settled));
        },
        onError: (err: unknown) => {
          log.error(`[jobs] working "${queue}":`, err);
        },
      }),
    );
  }

  /** One run, to the answer it settles with: what it returned, or what it threw, by name. */
  async #runOne<P, R>(
    queue: string,
    job: ClaimedRun<JobData<P>>,
    claim: AbortSignal,
    handler: RunHandler<P, R>,
  ): Promise<Settlement> {
    // The row's own limit, which pg-boss and its supervisor go by, not the spec's: a run sent
    // before the spec's limit changed keeps the limit it was sent with.
    const limitSeconds = job.expireInSeconds;
    const stopAfterMs = (limitSeconds - killMarginSeconds(limitSeconds)) * 1000;
    const deadline = new AbortController();
    const timer = setTimeout(() => {
      deadline.abort(new RunTimedOut(`The run reached its time limit of ${limitSeconds} s on "${queue}" and was stopped.`));
    }, stopAfterMs);
    // A claim this runner no longer holds: lost to a cancel or a lapse, or the runner stopped.
    const lost = AbortSignal.any([claim, this.#abandon.signal]);
    try {
      const output = await handler(job.data.payload, {
        queue,
        runId: job.id,
        attempt: job.retryCount + 1,
        signal: AbortSignal.any([lost, deadline.signal]),
      });
      return { status: 'completed', output: { value: output ?? null } };
    } catch (err) {
      // A run stopped at its limit is failed as having reached it, whatever the stop made it
      // throw (a killed process, a pass's own "stopped", an AbortError). An answer that is
      // itself not retried (a RunNotRetried the run gave first, say) stands as it was given.
      const stoppedAtLimit = deadline.signal.aborted && !lost.aborted && settlementFor(err) === 'failed';
      const said: unknown = stoppedAtLimit ? deadline.signal.reason : err;
      return { status: settlementFor(said), output: errorRecord(said) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Settle a claim, fenced on its attempt as pg-boss's own worker settles one:
   * a claim that lapsed lands on nothing. `deadletter` fails the run with no
   * attempt left, as pg-boss's `work()` does for a per-job `deadletter`: its
   * `fail()` keeps a run whose attempt is its last failed, so the attempt
   * limit is brought down to the attempt the claim holds first, in the same
   * transaction and under the same fence.
   */
  async #settle(queue: string, table: string, run: ClaimedRun<unknown>, settlement: Settlement): Promise<void> {
    const claim = [{ id: run.id, retryCount: run.retryCount }];
    if (settlement.status === 'completed') {
      await this.boss.complete(queue, claim, settlement.output);
      return;
    }
    if (settlement.status === 'failed') {
      await this.boss.fail(queue, claim, settlement.output);
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE ${this.schema}.${table} SET retry_limit = retry_count ` +
          "WHERE name = $1 AND id = $2::uuid AND state = 'active' AND retry_count = $3",
        [queue, run.id, run.retryCount],
      );
      const db: Db = { executeSql: (text, values) => client.query(text, values) };
      await this.boss.fail(queue, claim, settlement.output, { db });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Put back a claim that landed after the stop, before its run started: what
   * pg-boss's own `restore()` writes (it is not on the client's surface), at
   * the attempt it had, so its next claim is the same attempt. Fenced on the
   * claim. Nothing else in this worker fetches the queue by then.
   *
   * False when the queue's policy index refuses it back (23505). A stately
   * queue holds one run waiting as `created`, and the claim goes back as
   * `created` whatever it was, a retry included, so that place can be taken:
   * by a run sent since the claim, or by one that waited beside the retry the
   * claim was. pg-boss's own give-back (`#giveBack`, beside `fetch` in its
   * manager) leaves such a claim active and runs it; so does this runner, and
   * the claim keeps its attempt, which its beat and settlement are fenced on.
   */
  async #giveBack(queue: string, table: string, run: ClaimedRun<unknown>): Promise<boolean> {
    try {
      await this.pool.query(
        `UPDATE ${this.schema}.${table} SET state = 'created', started_on = NULL, heartbeat_on = NULL, upsert_by_key = NULL ` +
          "WHERE name = $1 AND id = $2::uuid AND state = 'active' AND retry_count = $3",
        [queue, run.id, run.retryCount],
      );
      return true;
    } catch (err) {
      if (hasCode(err, '23505')) return false;
      throw err;
    }
  }

  /**
   * Stop fetching, at once and on every queue; then, when `graceful`, wait up
   * to `timeoutMs` for the runs going to settle. A run still going after that
   * has its signal aborted and is given a second to settle; whatever has not
   * is failed by pg-boss's supervisor once its beat stops, and retried. A run
   * that waited for a slot was never fetched, and is still in its queue; one
   * claimed as the stop came is back in it, or, where its queue refused it
   * back, is one of the runs going, waited for here.
   */
  override async stop(opts: { graceful?: boolean; timeoutMs?: number } = {}): Promise<void> {
    this.#stop.abort();
    await Promise.all(this.#loops);
    if (opts.graceful ?? true) await settledWithin([...this.#going], opts.timeoutMs ?? 30_000);
    this.#abandon.abort(new Error('The jobs runner stopped.'));
    await settledWithin([...this.#going], 1000);
    await super.stop(opts);
  }

  /**
   * Work `queue` with one forked process per run (`runInChild`): the entry
   * module, ending in `serveRuns(...)`, gets the payload and `{ queue, runId,
   * attempt }`. Its process is killed on the run's signal, and the run is
   * settled only after it has exited, so a retry never starts beside it. Its
   * output reaches this process's own, each line prefixed with the queue and
   * the run id; none of it reaches the job's row.
   */
  async workInChild<P>(
    queue: string,
    entryUrl: string,
    opts: { maxOldSpaceMb: number; call?: string; concurrency?: number },
  ): Promise<void> {
    await this.work<P, unknown>(
      queue,
      (payload, ctx) =>
        runInChild(entryUrl, payload, {
          maxOldSpaceMb: opts.maxOldSpaceMb,
          ...(opts.call !== undefined ? { call: opts.call } : {}),
          signal: ctx.signal,
          run: { queue: ctx.queue, runId: ctx.runId, attempt: ctx.attempt },
        }),
      opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {},
    );
  }

  /** Send `payload` to `queue` on a cron expression, in UTC. */
  async schedule<P>(queue: string, cron: string, payload: P): Promise<void> {
    this.spec(queue);
    const data: JobData<P> = { payload };
    await this.boss.schedule(queue, cron, data as object, { tz: 'UTC' });
  }

  async unschedule(queue: string): Promise<void> {
    await this.boss.unschedule(queue);
  }
}

function toStatus(job: JobWithMetadata<JobData<unknown>>): RunStatus {
  return {
    runId: job.id,
    queue: job.name,
    state: STATE_NAMES[job.state],
    attempt: job.retryCount + 1,
    tags: job.data.tags ?? [],
    createdAt: job.createdOn,
    startedAt: job.startedOn ?? null,
    completedAt: TERMINAL.has(job.state) ? job.completedOn : null,
    output: job.output ?? null,
  };
}
