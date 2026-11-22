// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `operator.sh jobs`: THE OPERATOR'S VIEW OF THE JOBS, AND THEIR HAND ON THEM,
 * WHEN THEY RUN ON PG-BOSS (ADR-0054; workplan 0167 T6).
 *
 *   ./deploy/compose/operator.sh jobs
 *   ./deploy/compose/operator.sh jobs failures [<task>] [--limit <n>]
 *   ./deploy/compose/operator.sh jobs show <run-id>
 *   ./deploy/compose/operator.sh jobs cancel <run-id>
 *   ./deploy/compose/operator.sh jobs run <task> '<json>' [--despite-hold]
 *
 * On Trigger.dev the operator sees and steers the runs on its dashboard: the
 * Runs page, Test runs, and a `run-rollback` started there by hand, since
 * nothing in the repository enqueues one (docs/rollback-mechanisms.md). pg-boss
 * has no dashboard, so these are that page here:
 *
 * - `jobs`: per queue, the catalog's seventeen, the runs queued, active and
 *   failed, and the keys of the active singleton runs (a migration's id).
 *   One read of pg-boss's queue table (`overview`), whose counters the
 *   worker's monitor refreshes every 15 s; no job row is read.
 * - `jobs failures`: the most recent failed runs, newest first, on one queue
 *   or on all of them (`recentFailures`), each with its error's `name` and
 *   `message` and nothing else of it, the attempt, the tags and the time in
 *   UTC.
 * - `jobs show` and `jobs cancel`: one run, by its id alone, as
 *   `orchestrator_ref` holds it (`status`, `cancel`). A `run_…` ref is
 *   Trigger.dev's and is refused before pg-boss is asked.
 * - `jobs run`: put a run on a queue by hand, through the runner's
 *   producer-only client, which never migrates, supervises, schedules or
 *   makes a queue. The door for `run-rollback` and for "run the digest now".
 *
 * IN TRIGGER MODE (`OWNPACE_JOB_RUNNER` unset, empty or `trigger`) every one of
 * them says in one sentence that the jobs run on Trigger.dev, and exits 1:
 * nothing here may enqueue onto a pg-boss that no worker is working.
 *
 * AS `ownpace_jobs`, NEVER THE OWNER. pg-boss's schema belongs to that role
 * alone (deploy/compose/jobs-role.sql). `JOBS_DATABASE_URL` when it is set, as
 * in the `api` container; otherwise operator.sh's own connection with the
 * role and `JOBS_DB_PASSWORD` put in place of the owner and theirs, which is
 * how operator.sh runs every verb: at the machine, straight to Postgres's
 * published port, with `deploy/compose/.env` loaded. A URL for any other role
 * is refused. The owner's connection, which operator.ts holds anyway, is used
 * for one thing only: reading the operator's hold, as the API's doors read it.
 *
 * WHAT IT PRINTS. Ids, counts, states, tags (which are ids) and times. Never a
 * payload's values, and of an error only its name and message, which is all
 * the runner stores of one; the jobs' own wrapper (`leavesAReference`) keeps a
 * tester's words out of it before then. A run's output is not printed.
 *
 * `jobs run` CHECKS LITTLE, ON PURPOSE. Each job's zod schema lives in the
 * job's own module under `apps/worker/src/jobs`, and importing one opens its
 * database pools and points the process's sinks at them. So the payload is
 * checked for what can be known without that: that it is a JSON object; for a
 * schedule, that it is `{}`, as its strict empty schema demands; for a queue
 * that runs one at a time per migration, that it names the migration
 * (`mappingId`), since that is the key. The rest is the run's own schema's to
 * refuse: a `ZodError` settles the run as failed at once, never retried
 * (`settlementFor`), and `jobs failures` shows it.
 *
 * THE HOLD. While the operator's hold is open (`platform_pause`), `jobs run`
 * starts nothing, as every door of the API starts nothing
 * (`enqueue-unless-held.ts`), unless it is given `--despite-hold`: a rollback
 * may be exactly what a hold was opened for. Read with the same
 * `readOpenPause`; a hold that could not be read is not "no hold" (hard rule 9).
 */

import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readOpenPause, type PlatformPause } from '@openmig/managed';
import {
  JOB_CATALOG,
  PgBossProducer,
  type FailedRun,
  type JobCatalogEntry,
  type JobName,
  type QueueOverview,
  type RunStatus,
} from '@openmig/scheduler/pg-boss';

/** The role that owns pg-boss's schema, and the schema (deploy/compose/jobs-role.sql). */
export const JOBS_ROLE = 'ownpace_jobs';
export const JOBS_SCHEMA = 'pgboss';

/** How many failures `jobs failures` lists when not told; and the most it will. */
export const DEFAULT_FAILURES = 20;
export const MAX_FAILURES = 1000;

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const JOBS_USAGE = `Usage (pg-boss mode only):
  operator.sh jobs
  operator.sh jobs failures [<task>] [--limit <n>]
  operator.sh jobs show <run-id>
  operator.sh jobs cancel <run-id>
  operator.sh jobs run <task> '<json>' [--despite-hold]

<task> is a queue's name, its Trigger.dev task's id: ${JOB_CATALOG.map((j) => j.name).join(', ')}.`;

export type JobsCommand =
  | { readonly kind: 'overview' }
  | { readonly kind: 'failures'; readonly task: JobName | null; readonly limit: number }
  | { readonly kind: 'show'; readonly runId: string }
  | { readonly kind: 'cancel'; readonly runId: string }
  | {
      readonly kind: 'run';
      readonly task: JobName;
      readonly payload: Readonly<Record<string, unknown>>;
      readonly despiteHold: boolean;
    };

/** What a `jobs` command printed, and the exit code it asks for. */
export interface JobsReport {
  readonly lines: readonly string[];
  readonly exitCode: 0 | 1;
}

const refused = (sentence: string): JobsReport => ({ lines: [sentence], exitCode: 1 });

/**
 * Which runner the jobs run on (alpha.16's switch): `OWNPACE_JOB_RUNNER`, unset
 * or empty meaning `trigger`, and any other value refused in one sentence.
 */
export function jobRunnerOf(env: Readonly<Record<string, string | undefined>>):
  | { readonly runner: 'trigger' | 'pg-boss' }
  | { readonly error: string } {
  const value = env.OWNPACE_JOB_RUNNER;
  if (value === undefined || value === '' || value === 'trigger') return { runner: 'trigger' };
  if (value === 'pg-boss') return { runner: 'pg-boss' };
  return {
    error: `OWNPACE_JOB_RUNNER is "${value}", and the jobs run on trigger or pg-boss only (unset or empty means trigger).`,
  };
}

/** The one sentence every `jobs` command says in trigger mode. */
export const ON_TRIGGER_DEV =
  'The jobs on this stack run on Trigger.dev (OWNPACE_JOB_RUNNER is not pg-boss), so see them on its dashboard: these commands are for pg-boss mode only.';

function catalogEntry(task: string): JobCatalogEntry | undefined {
  return (JOB_CATALOG as readonly JobCatalogEntry[]).find((j) => j.name === task);
}

function unknownTask(task: string): string {
  return `"${task}" is not one of the jobs' queues: ${JOB_CATALOG.map((j) => j.name).join(', ')}.`;
}

function runIdRefusal(runId: string): string | null {
  if (runId.startsWith('run_')) {
    return `"${runId}" is a Trigger.dev run's ref, not a pg-boss run's id: look it up on Trigger.dev's dashboard.`;
  }
  if (!RUN_ID.test(runId)) return `"${runId}" is not a run's id: a pg-boss run's id is a UUID.`;
  return null;
}

/** Read `jobs …`'s arguments (those after `jobs`), or say why not. */
export function parseJobsCommand(args: readonly string[]): JobsCommand | { readonly error: string } {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
      return { kind: 'overview' };
    case 'failures': {
      let task: JobName | null = null;
      let limit = DEFAULT_FAILURES;
      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i]!;
        if (arg === '--limit') {
          const n = rest[++i];
          if (n === undefined || !/^[0-9]+$/.test(n) || Number(n) < 1 || Number(n) > MAX_FAILURES) {
            return { error: `--limit takes a whole number from 1 to ${MAX_FAILURES}.` };
          }
          limit = Number(n);
        } else if (task === null && !arg.startsWith('--')) {
          const entry = catalogEntry(arg);
          if (!entry) return { error: unknownTask(arg) };
          task = entry.name as JobName;
        } else {
          return { error: `jobs failures does not take "${arg}".\n\n${JOBS_USAGE}` };
        }
      }
      return { kind: 'failures', task, limit };
    }
    case 'show':
    case 'cancel': {
      const [runId, extra] = rest;
      if (runId === undefined || extra !== undefined) return { error: `jobs ${sub} takes one run's id.\n\n${JOBS_USAGE}` };
      const why = runIdRefusal(runId);
      if (why) return { error: why };
      return { kind: sub, runId: runId.toLowerCase() };
    }
    case 'run': {
      const despiteHold = rest.includes('--despite-hold');
      const positional = rest.filter((a) => a !== '--despite-hold');
      const [task, json, extra] = positional;
      if (task === undefined || json === undefined || extra !== undefined) {
        return { error: `jobs run takes a task and its payload as one JSON object.\n\n${JOBS_USAGE}` };
      }
      const entry = catalogEntry(task);
      if (!entry) return { error: unknownTask(task) };
      let payload: unknown;
      try {
        payload = JSON.parse(json);
      } catch {
        // The parser's own words may quote the text, and the text is a payload.
        return { error: `The payload for ${task} is not JSON. Give it as one JSON object, in single quotes.` };
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return { error: `The payload for ${task} must be a JSON object.` };
      }
      const object = payload as Record<string, unknown>;
      if (entry.kind === 'schedule' && Object.keys(object).length > 0) {
        return { error: `${task} is a schedule, and a schedule's run takes {} and nothing else.` };
      }
      if (entry.kind === 'on-demand' && entry.serializedBy !== undefined && typeof object.mappingId !== 'string') {
        return {
          error: `${task} runs one at a time per migration, so its payload must name the migration as "mappingId".`,
        };
      }
      return { kind: 'run', task: entry.name as JobName, payload: object, despiteHold };
    }
    default:
      return { error: `jobs does not know "${sub}".\n\n${JOBS_USAGE}` };
  }
}

/**
 * The jobs role's connection: `JOBS_DATABASE_URL`, or operator.sh's own with
 * the jobs role and `JOBS_DB_PASSWORD` in place of the owner. Refused for any
 * role but the jobs role. No refusal quotes a URL, which holds a password.
 */
export function jobsConnectionString(env: Readonly<Record<string, string | undefined>>):
  | { readonly url: string }
  | { readonly error: string } {
  const given = env.JOBS_DATABASE_URL;
  if (given !== undefined && given !== '') {
    let user: string;
    try {
      user = decodeURIComponent(new URL(given).username);
    } catch {
      return { error: 'JOBS_DATABASE_URL is not a URL.' };
    }
    if (user !== JOBS_ROLE) {
      return { error: `JOBS_DATABASE_URL connects as "${user}", and the jobs are read and steered as ${JOBS_ROLE} only.` };
    }
    return { url: given };
  }
  const password = env.JOBS_DB_PASSWORD;
  if (password === undefined || password === '') {
    return {
      error:
        `Neither JOBS_DATABASE_URL nor JOBS_DB_PASSWORD is set, so there is no way to connect as ${JOBS_ROLE}: ` +
        'run this through ./deploy/compose/operator.sh, which loads deploy/compose/.env.',
    };
  }
  const base = env.DATABASE_URL;
  if (base === undefined || base === '') {
    return { error: 'DATABASE_URL is not set: run this through ./deploy/compose/operator.sh, which composes it.' };
  }
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return { error: 'DATABASE_URL is not a URL.' };
  }
  url.username = JOBS_ROLE;
  url.password = password;
  return { url: url.toString() };
}

/** What the commands ask of the runner: `PgBossProducer`'s calls, and no other. */
export type JobsPort = Pick<PgBossProducer, 'overview' | 'recentFailures' | 'status' | 'cancel' | 'enqueue'>;

export interface JobsDeps {
  /** The producer, started. */
  readonly jobs: JobsPort;
  /** The operator's open hold, or null; throws when it could not be read. */
  readonly readHold: () => Promise<PlatformPause | null>;
}

/** A time in UTC, to the second. */
export function utc(at: Date | null): string {
  return at === null ? '-' : at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * An error as stored, reduced to its name and message: the runner stores
 * `{ name, message }`; pg-boss's own (a run that expired) has a message alone.
 * On one line, and cut at 300 characters.
 */
export function errorLine(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '(no error recorded)';
  const { name, message } = error as { name?: unknown; message?: unknown };
  const said = [typeof name === 'string' ? name : null, typeof message === 'string' ? message : null]
    .filter((s): s is string => s !== null && s !== '')
    .join(': ')
    .replace(/\s+/g, ' ')
    .trim();
  if (said === '') return '(no error recorded)';
  return said.length > 300 ? `${said.slice(0, 299)}…` : said;
}

function overviewLines(found: readonly QueueOverview[]): string[] {
  const byName = new Map(found.map((q) => [q.queue, q]));
  const width = Math.max(...JOB_CATALOG.map((j) => j.name.length));
  const lines = [
    `${'queue'.padEnd(width)}  ${'queued'.padStart(6)}  ${'active'.padStart(6)}  ${'failed'.padStart(6)}  active keys`,
  ];
  let missing = 0;
  for (const job of JOB_CATALOG) {
    const q = byName.get(job.name);
    if (!q) {
      missing += 1;
      lines.push(`${job.name.padEnd(width)}  not made yet`);
      continue;
    }
    lines.push(
      `${job.name.padEnd(width)}  ${String(q.queued).padStart(6)}  ${String(q.active).padStart(6)}  ` +
        `${String(q.failed).padStart(6)}  ${q.activeKeys.length === 0 ? '-' : q.activeKeys.join(', ')}`,
    );
  }
  lines.push('');
  lines.push(
    missing === 0
      ? "Counts are the worker's monitor's, refreshed every 15 s; failed counts the runs pg-boss still keeps."
      : `${missing} queue(s) not made yet: the worker makes every queue when it starts, so it has not started on this schema.`,
  );
  return lines;
}

function failureLines(failures: readonly FailedRun[], task: JobName | null, limit: number): string[] {
  const where = task ?? 'any queue';
  if (failures.length === 0) return [`No failed runs on ${where} that pg-boss still keeps.`];
  const lines = [`The ${failures.length} most recent failed run(s) on ${where}, newest first (at most ${limit}):`];
  for (const f of failures) {
    lines.push(
      `${utc(f.failedAt)}  ${f.queue}  ${f.runId}  attempt ${f.attempt}` +
        `${f.tags.length === 0 ? '' : `  ${f.tags.join(' ')}`}`,
    );
    lines.push(`    ${errorLine(f.error)}`);
  }
  return lines;
}

function statusLines(s: RunStatus): string[] {
  const lines = [
    `${s.runId} on ${s.queue}: ${s.state}, attempt ${s.attempt}`,
    `  created ${utc(s.createdAt)}, started ${utc(s.startedAt)}, settled ${utc(s.completedAt)}`,
    `  tags: ${s.tags.length === 0 ? '-' : s.tags.join(' ')}`,
  ];
  if (s.state === 'failed' || s.state === 'retrying') lines.push(`  error: ${errorLine(s.output)}`);
  return lines;
}

/** `tenant:<id>` and `mapping:<id>` from a payload's ids, when they are ids; and that the operator started it. */
function tagsOf(payload: Readonly<Record<string, unknown>>): string[] {
  const tags = ['operator'];
  for (const [field, tag] of [
    ['tenantId', 'tenant'],
    ['mappingId', 'mapping'],
  ] as const) {
    const id = payload[field];
    if (typeof id === 'string' && RUN_ID.test(id)) tags.push(`${tag}:${id}`);
  }
  return tags;
}

/** Run one parsed `jobs` command against the runner. */
export async function runJobsCommand(command: JobsCommand, deps: JobsDeps): Promise<JobsReport> {
  const { jobs } = deps;
  switch (command.kind) {
    case 'overview':
      return { lines: overviewLines(await jobs.overview()), exitCode: 0 };

    case 'failures': {
      const queues = command.task === null ? JOB_CATALOG.map((j) => j.name) : [command.task];
      const all: FailedRun[] = [];
      for (const queue of queues) all.push(...(await jobs.recentFailures(queue, command.limit)));
      const newest = all
        .sort((a, b) => (b.failedAt?.getTime() ?? 0) - (a.failedAt?.getTime() ?? 0))
        .slice(0, command.limit);
      return { lines: failureLines(newest, command.task, command.limit), exitCode: 0 };
    }

    case 'show': {
      const status = await jobs.status(command.runId);
      if (status === null) {
        return refused(
          `No queue holds a run ${command.runId}: it never was one, or it settled and pg-boss has since deleted it.`,
        );
      }
      return { lines: statusLines(status), exitCode: 0 };
    }

    case 'cancel': {
      const cancelled = await jobs.cancel(command.runId);
      if (!cancelled) {
        return refused(`Nothing was cancelled: no run ${command.runId} is waiting or running. See \`jobs show\`.`);
      }
      return {
        lines: [`Run ${command.runId} is cancelled. A run already going stops at its next heartbeat, within 30 s.`],
        exitCode: 0,
      };
    }

    case 'run': {
      const hold = await deps.readHold();
      if (hold && !command.despiteHold) {
        return refused(
          `The operator's hold is open since ${utc(new Date(hold.startedAt))}, so nothing was started: ` +
            'lift the hold, or give --despite-hold to start this run anyway.',
        );
      }
      const entry = catalogEntry(command.task)!;
      const serializeBy =
        entry.kind === 'on-demand' && entry.serializedBy !== undefined
          ? entry.serializedBy.replace('<mappingId>', command.payload.mappingId as string)
          : undefined;
      const { runId } = await jobs.enqueue(command.task, command.payload, {
        ...(serializeBy !== undefined ? { serializeBy } : {}),
        tags: tagsOf(command.payload),
      });
      const lines: string[] = [];
      if (hold) lines.push('The operator\'s hold is open; started anyway, as --despite-hold asked.');
      if (runId === null) {
        lines.push(`${command.task} already has a run waiting, so no other was queued: it runs next.`);
        return { lines, exitCode: 0 };
      }
      lines.push(`Queued ${command.task} as run ${runId}. Follow it with \`jobs show ${runId}\`.`);
      return { lines, exitCode: 0 };
    }
  }
}

/**
 * `operator.sh jobs …`, whole: the switch, the arguments, the connection, then
 * the command. `ownerPool` is operator.ts's own, used only to read the hold.
 */
export async function runJobsVerb(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  ownerPool: Pool,
): Promise<JobsReport> {
  const mode = jobRunnerOf(env);
  if ('error' in mode) return refused(mode.error);
  if (mode.runner === 'trigger') return refused(ON_TRIGGER_DEV);
  const command = parseJobsCommand(args);
  if ('error' in command) return refused(command.error);
  const connection = jobsConnectionString(env);
  if ('error' in connection) return refused(connection.error);

  const producer = new PgBossProducer(
    { connectionString: connection.url, schema: JOBS_SCHEMA, maxConnections: 2 },
    JOB_CATALOG,
  );
  try {
    await producer.start();
    return await runJobsCommand(command, {
      jobs: producer,
      readHold: () => readOpenPause(drizzle(ownerPool)),
    });
  } finally {
    await producer.stop({ graceful: false });
  }
}
