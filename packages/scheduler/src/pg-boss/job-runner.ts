// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A JOB RUNNER ON OUR OWN POSTGRES (workplan 0167, the pg-boss spike).
 *
 * What the managed edition asks of Trigger.dev, said once over pg-boss, so the
 * spike can show whether those asks survive the move:
 *
 *  - a QUEUE per task, whose runs are retried as a whole (three attempts,
 *    exponential, 5 s to 60 s), capped in time, and kept alive by a heartbeat
 *    so a worker that dies has its run picked up again;
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
 *    `AbortTaskRunError`): settled as pg-boss's `deadletter`, which fails the
 *    job terminally whatever attempts it had left;
 *  - WAITING FOR A CHILD (`enqueueAndWait`, Trigger.dev's `triggerAndWait`):
 *    pg-boss has no in-handler await, so the parent polls the child's row;
 *  - CANCEL, STATUS BY ID, CRON, and an OPERATOR'S VIEW of every queue.
 *
 * NOTHING CALLS THIS YET. The managed edition still enqueues through
 * `trigger-client.ts` and its tasks are still Trigger.dev tasks; this module is
 * reachable only through the `@openmig/scheduler/pg-boss` subpath, so neither
 * edition loads pg-boss unless something imports that path on purpose. The
 * appliance's `Scheduler` port (croner, in-process) is untouched.
 *
 * PAYLOADS STAY IDS-ONLY (ADR-0004): what a job row carries is what the caller
 * passes, and the callers pass tenant and mapping ids, never content.
 */

import { PgBoss } from 'pg-boss';
import type { Db, JobWithMetadata, QueueResult, SendOptions } from 'pg-boss';
import pg from 'pg';

/** Thrown by a handler to fail its run now, with no further attempts. */
export class RunNotRetried extends Error {
  override name = 'RunNotRetried';
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
  /** The run's time limit. Default 3600, Trigger.dev's `maxDuration` here. */
  readonly maxDurationSeconds?: number;
  /** A run whose worker stops beating for this long is failed and retried. Default 30, minimum 10. */
  readonly heartbeatSeconds?: number;
}

export interface RunContext {
  readonly runId: string;
  /** 1 on the first attempt. */
  readonly attempt: number;
  /** Aborted when the run is cancelled, or its claim is otherwise lost. */
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

export interface PgBossJobRunnerOptions {
  readonly connectionString: string;
  /** The schema pg-boss installs into. It must exist and belong to the connecting role. */
  readonly schema: string;
  /** How often an idle worker asks for work. Default 2. */
  readonly pollingIntervalSeconds?: number;
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
  readonly maxConnections?: number;
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

export class PgBossJobRunner {
  readonly #boss: PgBoss;
  readonly #pool: pg.Pool;
  readonly #specs = new Map<string, QueueSpec>();
  readonly #pollingIntervalSeconds: number;
  #started = false;

  constructor(opts: PgBossJobRunnerOptions) {
    this.#pollingIntervalSeconds = opts.pollingIntervalSeconds ?? 2;
    this.#boss = new PgBoss({
      connectionString: opts.connectionString,
      schema: opts.schema,
      max: opts.maxConnections ?? 5,
      // The schema is created by whoever provisions the role; pg-boss only migrates inside it.
      createSchema: false,
      migrate: true,
      monitorIntervalSeconds: opts.monitorIntervalSeconds ?? 15,
      superviseIntervalSeconds: opts.superviseIntervalSeconds ?? 15,
      cronWorkerIntervalSeconds: opts.cronWorkerIntervalSeconds ?? 5,
      // Polling only: LISTEN does not survive PgBouncer's transaction pooling.
      useListenNotify: false,
      application_name: 'ownpace-jobs',
    });
    // pg-boss reports trouble on an event; an unhandled 'error' event would kill
    // the process, and swallowing it would hide it (hard rule 9). It is logged
    // verbatim; the operation that failed rejects on its own.
    this.#boss.on('error', (err: unknown) => {
      console.error('[jobs] pg-boss error:', err);
    });
    this.#pool = new pg.Pool({ connectionString: opts.connectionString, max: 2, application_name: 'ownpace-jobs-enqueue' });
  }

  async start(queues: readonly QueueSpec[]): Promise<void> {
    await this.#boss.start();
    this.#started = true;
    for (const spec of queues) {
      const attempts = spec.attempts ?? 3;
      const options = {
        policy: spec.policy,
        retryLimit: attempts - 1,
        retryDelay: spec.retryDelaySeconds ?? 5,
        retryBackoff: true,
        retryDelayMax: spec.retryDelayMaxSeconds ?? 60,
        expireInSeconds: spec.maxDurationSeconds ?? 3600,
        heartbeatSeconds: spec.heartbeatSeconds ?? 30,
      };
      const existing = await this.#boss.getQueue(spec.name);
      if (existing === null) await this.#boss.createQueue(spec.name, options);
      else {
        const { policy: _policy, ...changeable } = options;
        await this.#boss.updateQueue(spec.name, changeable);
      }
      this.#specs.set(spec.name, spec);
    }
  }

  /** Stop polling; `graceful` waits for running handlers to settle first. */
  async stop(opts: { graceful?: boolean; timeoutMs?: number } = {}): Promise<void> {
    if (this.#started) {
      await this.#boss.stop({ graceful: opts.graceful ?? true, timeout: opts.timeoutMs ?? 30_000 });
      this.#started = false;
    }
    await this.#pool.end();
  }

  /** Work `queue` in this process, `concurrency` runs at a time. */
  async work<P, R>(queue: string, handler: RunHandler<P, R>, opts: { concurrency?: number } = {}): Promise<void> {
    this.#spec(queue);
    await this.#boss.work<JobData<P>>(
      queue,
      {
        batchSize: 1,
        localConcurrency: opts.concurrency ?? 1,
        pollingIntervalSeconds: this.#pollingIntervalSeconds,
        perJobResults: true,
      },
      async (jobs) => {
        const results = [];
        for (const job of jobs) {
          try {
            const output = await handler(job.data.payload, {
              runId: job.id,
              attempt: job.retryCount + 1,
              signal: job.signal,
            });
            results.push({ id: job.id, status: 'completed' as const, output: { value: output ?? null } });
          } catch (err) {
            const status = err instanceof RunNotRetried ? ('deadletter' as const) : ('failed' as const);
            results.push({ id: job.id, status, output: errorRecord(err) });
          }
        }
        return results;
      },
    );
  }

  /** Put a run on `queue`; see `EnqueueOptions`. */
  async enqueue<P>(queue: string, payload: P, opts: EnqueueOptions = {}): Promise<Enqueued> {
    this.#spec(queue);
    const data: JobData<P> = {
      payload,
      ...(opts.idempotency ? { idem: opts.idempotency.key } : {}),
      ...(opts.tags ? { tags: [...opts.tags] } : {}),
    };
    const send: SendOptions = opts.serializeBy !== undefined ? { singletonKey: opts.serializeBy } : {};
    if (!opts.idempotency) {
      const runId = await this.#boss.send(queue, data as object, send);
      if (runId === null && this.#spec(queue).policy !== 'stately') {
        throw new Error(`pg-boss refused a run on "${queue}" and gave no id.`);
      }
      return { runId, joined: false };
    }
    const { key, ttlSeconds } = opts.idempotency;
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      // Two requests with one key queue here, one after the other, until COMMIT.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ownpace-jobs:${queue}:${key}`]);
      const db: Db = { executeSql: (text, values) => client.query(text, values) };
      const { rows } = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
      const cutoff = rows[0]!.now.getTime() - ttlSeconds * 1000;
      const earlier = (await this.#boss.findJobs<JobData<P>>(queue, { data: { idem: key }, db }))
        .filter((j) => j.createdOn.getTime() >= cutoff)
        .sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime())[0];
      if (earlier) {
        await client.query('COMMIT');
        return { runId: earlier.id, joined: true };
      }
      const runId = await this.#boss.send(queue, data as object, { ...send, db });
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
      const status = await this.status(queue, runId);
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

  async status(queue: string, runId: string): Promise<RunStatus | null> {
    const job = await this.#boss.getJobById<JobData<unknown>>(queue, runId);
    return job === null ? null : toStatus(job);
  }

  /** Cancel a run; a running handler sees its `signal` abort at its next heartbeat. */
  async cancel(queue: string, runId: string): Promise<void> {
    await this.#boss.cancel(queue, runId);
  }

  /** Send `payload` to `queue` on a cron expression, in UTC. */
  async schedule<P>(queue: string, cron: string, payload: P): Promise<void> {
    this.#spec(queue);
    const data: JobData<P> = { payload };
    await this.#boss.schedule(queue, cron, data as object, { tz: 'UTC' });
  }

  async unschedule(queue: string): Promise<void> {
    await this.#boss.unschedule(queue);
  }

  /** Every queue this runner was started with: what waits, what runs, what failed. */
  async overview(): Promise<QueueOverview[]> {
    const queues: QueueResult[] = await this.#boss.getQueues([...this.#specs.keys()]);
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

  /** The most recent failed runs on `queue`, newest first, with their errors verbatim. */
  async recentFailures(queue: string, limit = 20): Promise<FailedRun[]> {
    const jobs = await this.#boss.findJobs<JobData<unknown>>(queue, { limit: 100_000 });
    return jobs
      .filter((j) => j.state === 'failed')
      .sort((a, b) => (b.completedOn?.getTime() ?? 0) - (a.completedOn?.getTime() ?? 0))
      .slice(0, limit)
      .map((j) => ({
        runId: j.id,
        queue,
        attempt: j.retryCount + 1,
        failedAt: j.completedOn,
        error: j.output,
        tags: j.data.tags ?? [],
      }));
  }

  #spec(queue: string): QueueSpec {
    const spec = this.#specs.get(queue);
    if (!spec) throw new Error(`Queue "${queue}" was not declared when this runner started.`);
    return spec;
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
