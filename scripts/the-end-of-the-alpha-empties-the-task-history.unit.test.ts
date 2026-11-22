// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE END OF THE ALPHA EMPTIES THE TASK RUNNER'S HISTORY (docs/ending-the-alpha.md,
 * *The switch* and *Checks*; site/legal/privacy.md §9).
 *
 * Privacy §9, the 1.0 testers accept, keeps the records of the background tasks
 * "Until the end of the Alpha at the latest: then the background tasks start
 * with an empty history" (privacy-task-records (a)). Trigger.dev keeps a run's
 * row, its payload, output, error and log events with no limit of its own, and
 * the erasure never reaches them. Until 2026-10-21 the runbook the owner follows
 * on the day had no step for it, and privacy's own comment said the step was
 * "not written yet": the switch, run as written, broke a promise of the published
 * text and nothing said so.
 *
 * THE HISTORY IS IN EVERY STORE THE TASK RUNNER WRITES, NOT IN triggerdb ALONE.
 * The first version of this step reset triggerdb and proved the rest empty by
 * counting four ClickHouse tables, on the premise that runs reach ClickHouse
 * only with RUN_REPLICATION_ENABLED or the ClickHouse event store, which
 * managed.yml sets neither of. The review found it false at Trigger.dev v4.7.2:
 * every deployed task process exports its host and Node.js metrics every 10 s
 * (packages/cli-v3/src/entryPoints/managed-run-worker.ts, `hostMetrics: true`,
 * `nodejsRuntimeMetrics: true`), each row stamped with the run's id, task,
 * attempt, worker and Trigger.dev's organisation, project and environment ids
 * (core's TaskContextMetricExporter). The webapp writes them to ClickHouse's
 * `trigger_dev.metrics_v1` whatever the event store says (otlpExporter.server.ts,
 * #exportMetricRows, "clickhouse_v2"), on CLICKHOUSE_URL, and keeps them 60 days
 * (schema 019). Redis keeps the queues' concurrency sets, where a dead run's id
 * stays for good (plane-tokens.sh), and MinIO a payload of 512 KB or more and an
 * output of 128 KB or more. A list of tables is how the first version missed
 * one, so this holds no list of tables:
 *   - the stores are the services trigger-api's environment names as a host;
 *   - the step removes every named volume of each (triggerdb's through
 *     reset-trigger.sh, the others by name) and the bring-up starts them again;
 *   - the check reads each of those volumes' dates, and the oldest row of the
 *     two tables the history is known to be in (TaskRun, metrics_v1).
 * Point trigger-api at a new store and this fails until the step empties it.
 *
 * AND, ON PG-BOSS, IN THE JOBS' OWN SCHEMA (workplan 0167 T7, ADR-0054). Since
 * managed.yml's switch defaults to `pg-boss`, the jobs run in the `worker`
 * service and their history is in pg-boss's tables, in the ledger's database:
 * the store the worker's JOBS_DATABASE_URL names (its role, `ownpace_jobs`,
 * and its database), in the schema deploy/compose/jobs-role.sql gives that
 * role (`pgboss`). Trigger.dev's plane is then stopped with its volumes kept,
 * so its stores still hold the alpha's history, and reset-trigger.sh refuses
 * to run. So the step has a second block, for pg-boss mode: the worker
 * stopped, pg-boss's job tables emptied as their owner, and the same four
 * stores removed by name. The job tables are read from the pg-boss release
 * the scheduler resolves (its install plan, dist/plans.js), not listed from
 * memory: every table it creates is either emptied, a partition of one that
 * is, or kept on purpose with a reason here (KEPT), so a pg-boss that adds a
 * table fails this until it is one or the other. The role and the schema
 * stay, and the step says so.
 *
 * THE ORDER MATTERS. The reset comes after the drain, under the hold, once the
 * hold is DEPLOY_LIVE_QUIET_MINUTES old, as deploy-live.sh asks before it
 * replaces the task containers: a pass queued just before the hold is in no
 * count until it starts, and the reset would end it halfway. The stores' volumes
 * go after the reset, which has stopped trigger-api, and before
 * ensure-env-secrets.sh, which judges each store's password by whether its
 * volume exists. All of it comes BEFORE live's `.env` loses its stage: the
 * bring-up then uploads the stage to the new project, and the deploy's
 * `set-task-env.sh` deletes it and prints the line step 6 reads. Reset after the
 * `.env` change and the new project never held the stage, `envvars.del` finds
 * nothing, the line never comes, and the operator is sent to *If a check fails*
 * for a switch that took. And before the deploy, so a copy the deploy takes
 * holds the new, empty database.
 *
 * WHAT IT HOLDS:
 *   - the promise is still in privacy §9, in both languages, and the runbook
 *     quotes it (a promise dropped from the texts takes the step with it);
 *   - *The switch* runs reset-trigger.sh's own *Next*, line for line and in its
 *     order, then `--from account` and `--from login`, after the drain and the
 *     quiet minutes, before the stage change and the deploy, and says it is not
 *     stand-up-live.sh (which refuses once live's deploy log has a line);
 *   - between the reset and that *Next*, it removes every store's container and
 *     every named volume they mount, and the bring-up's trigger phase starts
 *     each store again; no other service names them but a store's own
 *     one-shot (minio-init, which makes MinIO's bucket since 0146 T7), which
 *     mounts nothing and which that phase runs again;
 *   - *Checks*, before the hold lifts, read every one of those volumes' dates,
 *     triggerdb's oldest run and ClickHouse's oldest metrics row, with the
 *     client taking the container's own credentials and no password on any
 *     command line;
 *   - in pg-boss mode, after the trigger-mode lines and before the stage
 *     change: the worker stopped, then one TRUNCATE, as the role the worker's
 *     JOBS_DATABASE_URL names and in its database, of exactly the tables that
 *     hold jobs, then every store's container and every store's volume
 *     triggerdb's included, the old project's ref and key cleared, and the
 *     bring-up; the step names pgboss.job_common, where every queue's rows
 *     are, and says the role and the schema stay; and *Checks* read pg-boss's
 *     oldest job.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY (AGENTS.md).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const RUNBOOK_PATH = 'docs/ending-the-alpha.md';
const RUNBOOK = read(RUNBOOK_PATH);
const RESET = read('deploy/compose/reset-trigger.sh');
const COMPOSE = read('deploy/compose/managed.yml');
const BOOTSTRAP = read('deploy/compose/bootstrap-managed.sh');

/**
 * pg-boss's install plan, from the release the scheduler resolves: the tables
 * it creates, read where it creates them.
 */
const PGBOSS_PLANS = readFileSync(
  join(dirname(createRequire(join(ROOT, 'packages/scheduler/package.json')).resolve('pg-boss/package.json')), 'dist/plans.js'),
  'utf8',
);
const JOBS_ROLE_SQL = read('deploy/compose/jobs-role.sql');

/** Live's compose project: the step and the checks name its volumes. */
const LIVE = 'ownpace-live';

/** A `## ` section of the runbook, up to the next one. */
function section(title: string): string {
  const start = RUNBOOK.indexOf(`\n## ${title}\n`);
  expect(start, `${RUNBOOK_PATH} has no "## ${title}" section`).toBeGreaterThan(-1);
  const end = RUNBOOK.indexOf('\n## ', start + 1);
  return RUNBOOK.slice(start, end === -1 ? undefined : end);
}

/** A service's block of managed.yml, up to the next top-level service. */
function service(name: string): string {
  const start = COMPOSE.indexOf(`\n  ${name}:\n`);
  expect(start, `managed.yml has no ${name} service`).toBeGreaterThan(-1);
  const next = COMPOSE.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:\n|\n[a-z]/);
  return COMPOSE.slice(start, next === -1 ? undefined : start + 1 + next);
}

/** The lines of code in a block, without its comments. */
const code = (block: string): string =>
  block
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

/** Every service managed.yml defines, in its order. */
const SERVICES = [
  ...COMPOSE.slice(COMPOSE.indexOf('\nservices:\n'), COMPOSE.search(/\n(?:networks|volumes):\n/)).matchAll(
    /\n {2}([a-z][a-z0-9-]*):\n/g,
  ),
].map((m) => m[1]!);

const API = code(service('trigger-api'));

/** The stores: the services trigger-api's environment reaches by host name. */
const STORES = SERVICES.filter((s) => new RegExp(`(?:@|//|_HOST: )${s}(?::\\d|\\s|$)`, 'm').test(API));

/**
 * A store's own one-shot, with the store it serves. It names that store because
 * it exists for it, mounts nothing, and runs again with the bring-up, so the
 * step that removes the store's volume leaves nothing of it behind. minio-init
 * makes minio's `packets` bucket (workplan 0146 T7).
 */
const STORE_HELPERS: Readonly<Record<string, string>> = { 'minio-init': 'minio' };

/** The named volumes a service mounts (bind mounts start with `.` or `/`). */
const volumesOf = (name: string): string[] =>
  [...code(service(name)).matchAll(/\n\s+- ([a-z][a-z0-9_]*):\//g)].map((m) => m[1]!);

/** What reset-trigger.sh removes itself, and what the step has to. */
const RESET_VOLUME = /VOLUME="\$\{COMPOSE_PROJECT\}_([a-z0-9_]+)"/.exec(RESET)?.[1];
const RESET_SERVICE = 'trigger-db';
const OTHERS = STORES.filter((s) => s !== RESET_SERVICE);
const OTHER_VOLUMES = OTHERS.flatMap(volumesOf);

/**
 * The one line of a text that starts with a command, and the words after it,
 * sorted: what it names, in whatever order it names them. A trailing comment
 * (`# …`) is not a word.
 */
function line(text: string, command: string): { at: number; words: string[] } {
  const quoted = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\n[ \\t]*(${quoted})([^\\n]*)`).exec(text);
  expect(match, `no line runs: ${command}`).not.toBeNull();
  const at = match!.index + match![0].indexOf(command);
  return { at, words: match![2]!.replace(/\s+#.*$/, '').trim().split(/\s+/).sort() };
}

const PROMISE = {
  'site/legal/privacy.md': 'then the background tasks start with an empty history',
  'site/legal/privacy.nl.md': 'dan beginnen de achtergrondtaken met een lege geschiedenis',
} as const;

describe('the promise the step keeps', () => {
  it('is in privacy §9 in both languages, and the runbook quotes it', () => {
    for (const [file, words] of Object.entries(PROMISE)) {
      expect(
        read(file),
        `${file} no longer promises an empty history: if the texts dropped it, the runbook's step goes with it`,
      ).toContain(words);
    }
    expect(section('The switch'), 'the step does not quote the promise it keeps').toContain(
      PROMISE['site/legal/privacy.md'],
    );
  });
});

describe('the stores the history is in', () => {
  it('are the services trigger-api names as a host, and reset-trigger.sh empties triggerdb', () => {
    // Read, not listed, so a new store is one this guard sees. These four at
    // v4.7.2; the assertion names them so a parse that finds none fails here.
    expect(STORES).toEqual(expect.arrayContaining(['trigger-db', 'trigger-redis', 'clickhouse', 'minio']));
    expect(RESET_VOLUME, 'reset-trigger.sh no longer names the volume it removes').toBe('trigger_db_data');
    expect(volumesOf(RESET_SERVICE)).toEqual([RESET_VOLUME]);
    expect(RESET, 'reset-trigger.sh no longer stops what holds triggerdb').toMatch(
      /"\$\{COMPOSE\[@\]\}" rm -f trigger-supervisor trigger-api trigger-db\n/,
    );
  });

  it('are used by the task runner alone, so removing them touches nothing of the application', () => {
    for (const other of SERVICES.filter((s) => s !== 'trigger-api' && !STORES.includes(s) && !(s in STORE_HELPERS))) {
      const block = code(service(other));
      for (const store of STORES) {
        expect(
          block,
          `managed.yml's ${other} names ${store}: the end of the Alpha removes its volume (${RUNBOOK_PATH}, The switch, step 3)`,
        ).not.toMatch(new RegExp(`(?<![\\w-])${store}(?![\\w-])`));
      }
    }
  });

  it("have one-shots that serve them alone, keep nothing, and are run again by the trigger phase", () => {
    const start = BOOTSTRAP.indexOf('\nphase_trigger() {');
    const phase = BOOTSTRAP.slice(start, BOOTSTRAP.indexOf('\n}\n', start));
    for (const [helper, store] of Object.entries(STORE_HELPERS)) {
      expect(SERVICES, `${helper} is gone from managed.yml: take it out of STORE_HELPERS`).toContain(helper);
      expect(STORES).toContain(store);
      const block = code(service(helper));
      for (const other of STORES.filter((s) => s !== store)) {
        expect(block, `${helper} names ${other} too`).not.toMatch(new RegExp(`(?<![\\w-])${other}(?![\\w-])`));
      }
      expect(volumesOf(helper), `${helper} mounts a volume, so it keeps something the step does not remove`).toEqual([]);
      expect(block, `${helper} is not a one-shot`).toMatch(/\n\s+restart: "no"\n/);
      expect(phase, `bootstrap-managed.sh --from trigger does not run ${helper} again`).toMatch(
        new RegExp(`\\n\\s*up_wait [^\\n]*(?:\\\\\\n[^\\n]*)*\\b${helper}\\b`),
      );
    }
  });

  it("are started again by the bring-up's trigger phase", () => {
    const start = BOOTSTRAP.indexOf('\nphase_trigger() {');
    expect(start, 'bootstrap-managed.sh has no phase_trigger').toBeGreaterThan(-1);
    const phase = BOOTSTRAP.slice(start, BOOTSTRAP.indexOf('\n}\n', start));
    const started = [...phase.matchAll(/\n\s*up_wait ((?:[a-z][a-z0-9-]*[ \\\n]*)+)/g)]
      .flatMap((m) => m[1]!.split(/[\s\\]+/))
      .filter(Boolean);
    for (const store of STORES) {
      expect(started, `bootstrap-managed.sh --from trigger does not start ${store} again after its volume went`).toContain(store);
    }
  });
});

describe('the switch empties the history, under the hold', () => {
  const sw = section('The switch');
  const reset = sw.indexOf('./deploy/compose/reset-trigger.sh --yes\n');

  it("runs reset-trigger.sh's own Next, in its order, and then --from account and --from login", () => {
    expect(reset, 'the switch does not reset the task runner').toBeGreaterThan(-1);
    const next = RESET.slice(RESET.indexOf('[reset-trigger] done. Next:'));
    const commands = [...next.matchAll(/^ {2}(\.\/deploy\/compose\/\S+(?: [^\n]+)?)$/gm)].map((m) => m[1]!.trim());
    expect(commands, 'reset-trigger.sh prints no commands after "done. Next:"').toEqual([
      './deploy/compose/ensure-env-secrets.sh',
      './deploy/compose/bootstrap-managed.sh --from trigger',
      './deploy/compose/bootstrap-managed.sh --from account',
    ]);
    // The login phase stops (exit 2) when the CLI is not logged in, which it is
    // not after a reset, and says to carry on from itself.
    const phases = /^PHASES=\(([^)]*)\)/m.exec(BOOTSTRAP)?.[1]?.split(/\s+/) ?? [];
    expect(phases.indexOf('login'), 'the bring-up has no login phase after account').toBe(phases.indexOf('account') + 1);
    const login = BOOTSTRAP.slice(BOOTSTRAP.indexOf('\nphase_login() {'));
    expect(login.slice(0, login.indexOf('\n}\n')), 'phase_login no longer stops for the login').toMatch(/\n {2}your_turn login$/);
    let at = reset;
    for (const command of [...commands, './deploy/compose/bootstrap-managed.sh --from login']) {
      const found = sw.indexOf(`${command}\n`, at);
      expect(found, `the switch does not run "${command}" after the reset, as the scripts say`).toBeGreaterThan(at);
      at = found;
    }
    expect(sw, 'the step does not say to run the login line the bring-up prints').toMatch(/`pnpm -C apps\/worker exec trigger login … --profile …`/);
    // And the phase prints that same command, the lockfile's CLI, not npx's.
    expect(login.slice(0, login.indexOf('\n}\n'))).toContain('${TRIGGER_CLI_SHOWN} login -a');
  });

  it("removes every other store's container and volume, after the reset and before its Next", () => {
    expect(OTHER_VOLUMES, 'the stores mount no named volume: this guard reads them').not.toHaveLength(0);
    const containers = line(sw, 'docker compose -f deploy/compose/managed.yml rm -s -f ');
    const volumes = line(sw, 'docker volume rm ');
    expect(containers.words, 'the step does not remove the containers of every store but triggerdb').toEqual(
      [...OTHERS].sort(),
    );
    expect(volumes.words, 'the step does not remove every named volume those stores mount').toEqual(
      OTHER_VOLUMES.map((v) => `${LIVE}_${v}`).sort(),
    );
    expect(containers.at, 'the stores are removed before the reset has stopped trigger-api').toBeGreaterThan(reset);
    expect(volumes.at).toBeGreaterThan(containers.at);
    expect(volumes.at, 'the stores go after ensure-env-secrets.sh, which judges their passwords by their volumes').toBeLessThan(
      sw.indexOf('./deploy/compose/ensure-env-secrets.sh\n'),
    );
    expect(sw, 'the step does not say metrics_v1 holds the runs').toMatch(/metrics_v1/);
  });

  it('after the drain and the quiet minutes, before the stage leaves .env, and before the deploy', () => {
    const drain = sw.indexOf('0 pass(es) still in flight');
    const quiet = sw.indexOf('DEPLOY_LIVE_QUIET_MINUTES');
    const stage = sw.indexOf('.env OWNPACE_STAGE=\n');
    const deploy = sw.indexOf('./deploy/compose/deploy-live.sh <tag>\n');
    for (const [what, i] of [['the drain', drain], ['the stage change', stage], ['the deploy', deploy]] as const) {
      expect(i, `the switch no longer has ${what}: this guard reads it`).toBeGreaterThan(-1);
    }
    expect(reset, 'the reset runs before the drain is done').toBeGreaterThan(drain);
    expect(quiet, 'the step does not wait for the hold to be DEPLOY_LIVE_QUIET_MINUTES old').toBeGreaterThan(drain);
    expect(quiet).toBeLessThan(reset);
    expect(sw.slice(quiet, reset)).toContain('the hold is on and nothing is in flight');
    // deploy-live.sh's own words and setting, or the sentence is a reason that went.
    const live = read('deploy/compose/deploy-live.sh');
    expect(live).toMatch(/QUIET_MINUTES="\$\{DEPLOY_LIVE_QUIET_MINUTES:-5\}"/);
    expect(live).toContain('say "the hold is on and nothing is in flight"');
    expect(reset, 'the reset runs after the stage left .env: the deploy then prints no deleted OWNPACE_STAGE line').toBeLessThan(stage);
    expect(reset, 'the reset runs after the deploy').toBeLessThan(deploy);
  });

  it('says it is live only, and not stand-up-live.sh', () => {
    expect(sw).toMatch(/live only/);
    expect(sw, 'the step does not say why stand-up-live.sh is not the way').toMatch(
      /not `stand-up-live\.sh --resume`: it refuses once live's\s+deploy log has a line/i,
    );
    // And the script still refuses so, or the sentence is a reason that went.
    expect(read('deploy/compose/stand-up-live.sh')).toMatch(/already has a line: live has been stood up/);
  });
});

describe('the checks prove it, before the hold lifts', () => {
  const checks = section('Checks');
  const before = checks.slice(0, checks.indexOf('After lifting the hold'));

  it("reads every store's volume date", () => {
    const all = [RESET_VOLUME!, ...OTHER_VOLUMES].map((v) => `${LIVE}_${v}`).sort();
    expect(line(before, `docker volume inspect -f '{{.Name}} {{.CreatedAt}}' `).words).toEqual(all);
  });

  it("reads triggerdb's oldest run", () => {
    expect(before).toContain(
      `docker compose -f deploy/compose/managed.yml exec -T trigger-db psql -X -At -U trigger -d triggerdb -c 'SELECT min("createdAt") FROM "TaskRun"'`,
    );
  });

  it("reads ClickHouse's oldest metrics row, with the container's own credentials", () => {
    const query = `docker compose -f deploy/compose/managed.yml exec -T clickhouse clickhouse-client --query "SELECT count(), min(bucket_start) FROM trigger_dev.metrics_v1"`;
    expect(before).toContain(query);
    // clickhouse-client reads CLICKHOUSE_USER and CLICKHOUSE_PASSWORD from its
    // environment (programs/client/Client.cpp at 26.2, and unchanged at
    // v26.8.34.13-lts, read for 26.8.36.3 when it had no tag; the same blob at
    // v26.8.36.3-lts and at v26.8.37.168-lts, the pinned release), and the
    // container has both. A password on a command line is one in `ps`.
    const line = before.slice(before.indexOf('clickhouse-client'), before.indexOf('\n', before.indexOf('clickhouse-client')));
    expect(line, 'the ClickHouse check puts a password on a command line').not.toMatch(/--password|--user/);
    const ch = code(service('clickhouse'));
    expect(ch).toMatch(/\n\s+CLICKHOUSE_USER: /);
    expect(ch).toMatch(/\n\s+CLICKHOUSE_PASSWORD: /);
  });
});

/** The worker's store: the role and the database its JOBS_DATABASE_URL names. */
const JOBS_URL = /\n\s+JOBS_DATABASE_URL: postgresql:\/\/([a-z_]+):\$\{JOBS_DB_PASSWORD:-\}@[^/\s]+\/\$\{POSTGRES_DB:-([a-z_]+)\}\n/.exec(
  code(service('worker')),
);
const JOBS_ROLE = JOBS_URL?.[1];
const JOBS_DB = JOBS_URL?.[2];
/** The schema jobs-role.sql makes for that role. */
const JOBS_SCHEMA = new RegExp(`\\nCREATE SCHEMA IF NOT EXISTS ([a-z_]+) AUTHORIZATION ${JOBS_ROLE};\\n`).exec(JOBS_ROLE_SQL)?.[1];

/** The tables pg-boss creates under a name of its own. */
const COMMON = /export const COMMON_JOB_TABLE = '([a-z_]+)';/.exec(PGBOSS_PLANS)?.[1];
const PGBOSS_TABLES = [
  ...new Set(
    [...PGBOSS_PLANS.matchAll(/CREATE TABLE \$\{schema\}\.([a-z_]+|\$\{COMMON_JOB_TABLE\})[\s(]/g)].map((m) =>
      m[1] === '${COMMON_JOB_TABLE}' ? COMMON! : m[1]!,
    ),
  ),
].sort();

/** The tables that hold the jobs' history: each job, its links, the queues' counts over time, the warnings. */
const EMPTIED = ['job', 'job_dependency', 'queue_stats', 'warning'];

/**
 * The tables the step keeps, and why each holds no run: the worker starts on
 * them as it left them.
 */
const KEPT: Readonly<Record<string, string>> = {
  version: "the schema's version, one row",
  queue: 'each queue as the worker declares it, with counts the monitor rewrites',
  schedule: 'the cron schedules the worker declares',
  subscription: 'pub/sub events, which nothing here uses',
  bam: "pg-boss's own migration commands",
  instance: 'the worker instances and their heartbeats',
};

describe('the jobs on pg-boss: their history is emptied too, in pg-boss mode', () => {
  const sw = section('The switch');
  const at = sw.indexOf('\n   docker compose -f deploy/compose/managed.yml stop worker\n');
  const block = sw.slice(at, sw.indexOf('\n   ```\n', at) + 1);

  it("are in the store the worker's JOBS_DATABASE_URL names, in the schema jobs-role.sql gives its role", () => {
    expect(JOBS_ROLE, "managed.yml's worker no longer has a JOBS_DATABASE_URL this guard reads").toBe('ownpace_jobs');
    expect(JOBS_DB).toBe('openmigrate');
    expect(JOBS_SCHEMA, 'jobs-role.sql no longer makes the schema for the role').toBe('pgboss');
    expect(read('apps/worker/src/runner/pg-boss-context.ts')).toContain(`export const JOBS_SCHEMA = '${JOBS_SCHEMA}';`);
    expect(code(service('postgres')), "the ledger's container is no longer <project>-db").toMatch(
      /\n\s+container_name: \$\{COMPOSE_PROJECT_NAME\}-db\n/,
    );
  });

  it('every table pg-boss creates is emptied, a partition of one that is, or kept with a reason', () => {
    expect(PGBOSS_TABLES, "pg-boss's install plan no longer reads as this guard reads it").toEqual(
      expect.arrayContaining(['job', 'queue', 'version']),
    );
    expect(COMMON).toBe('job_common');
    for (const table of PGBOSS_TABLES) {
      const emptied = EMPTIED.includes(table) || table === COMMON;
      expect(emptied || table in KEPT, `pg-boss creates ${JOBS_SCHEMA}.${table}: empty it in step 3, or say in KEPT why it holds no run`).toBe(true);
    }
    for (const table of [...EMPTIED, ...Object.keys(KEPT)]) {
      expect(PGBOSS_TABLES, `pg-boss no longer creates ${table}`).toContain(table);
    }
    // job_common, and any table made under a name it is given, is a partition
    // of a table the step empties, so the TRUNCATE of its parent empties it.
    expect(PGBOSS_PLANS).toContain('ALTER TABLE ${schema}.job ATTACH PARTITION ${schema}.${COMMON_JOB_TABLE} DEFAULT;');
    const named = PGBOSS_PLANS.match(/CREATE TABLE \$\{schema\}\.%I/g) ?? [];
    const parents = [
      ...PGBOSS_PLANS.matchAll(/ALTER TABLE \$\{schema\}\.([a-z_]+) ATTACH PARTITION \$\{schema\}\.%I/g),
      ...PGBOSS_PLANS.matchAll(/CREATE TABLE \$\{schema\}\.%I PARTITION OF \$\{schema\}\.([a-z_]+)/g),
    ].map((m) => m[1]!);
    expect(parents, 'a table pg-boss makes under a given name is not a partition').toHaveLength(named.length);
    for (const parent of parents) expect(EMPTIED).toContain(parent);
  });

  it('stops the worker, then empties exactly those tables as their owner, in the ledger database', () => {
    expect(at, 'the switch has no pg-boss block that stops the worker').toBeGreaterThan(-1);
    expect(at, 'the pg-boss block does not come after the trigger-mode lines').toBeGreaterThan(
      sw.indexOf('./deploy/compose/bootstrap-managed.sh --from login\n'),
    );
    expect(at, 'the pg-boss block does not come before the stage leaves .env').toBeLessThan(sw.indexOf('.env OWNPACE_STAGE=\n'));
    expect(block).toContain(
      `docker exec -i ${LIVE}-db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${JOBS_DB}' <<'SQL'\n   SET ROLE ${JOBS_ROLE};\n`,
    );
    const truncate = line(block, 'TRUNCATE ');
    expect(truncate.words.map((w) => w.replace(/[,;]$/, '')), 'the TRUNCATE does not name exactly the job tables').toEqual(
      EMPTIED.map((t) => `${JOBS_SCHEMA}.${t}`).sort(),
    );
    expect(truncate.at).toBeGreaterThan(block.indexOf(`SET ROLE ${JOBS_ROLE};`));
  });

  it("removes every store's container and volume, triggerdb's too, clears the old project, and runs the bring-up", () => {
    const containers = line(block, 'docker compose -f deploy/compose/managed.yml --profile trigger rm -s -f ');
    const volumes = line(block, 'docker volume rm ');
    expect(containers.words).toEqual([...STORES].sort());
    expect(volumes.words).toEqual([RESET_VOLUME!, ...OTHER_VOLUMES].map((v) => `${LIVE}_${v}`).sort());
    expect(containers.at).toBeGreaterThan(line(block, 'TRUNCATE ').at);
    expect(volumes.at).toBeGreaterThan(containers.at);
    // What reset-trigger.sh clears in trigger mode, so the way back asks for a new project.
    expect(RESET).toContain('"$ENV_FILE" TRIGGER_PROJECT_REF= TRIGGER_SECRET_KEY=');
    const clear = block.indexOf('/.env TRIGGER_PROJECT_REF= TRIGGER_SECRET_KEY=\n');
    const secrets = block.indexOf('./deploy/compose/ensure-env-secrets.sh\n');
    const bringUp = block.indexOf('./deploy/compose/bootstrap-managed.sh --from trigger\n');
    expect(clear, 'the pg-boss block does not clear the old project from .env').toBeGreaterThan(volumes.at);
    expect(secrets).toBeGreaterThan(clear);
    expect(bringUp).toBeGreaterThan(secrets);
  });

  it('names where the rows are, and says the role and the schema stay', () => {
    const folded = section('The switch').replace(/\s+/g, ' ');
    expect(folded, 'step 3 does not name the partition every queue shares').toContain(`\`${JOBS_SCHEMA}.${COMMON}\``);
    for (const t of EMPTIED) expect(folded, `step 3 does not name ${JOBS_SCHEMA}.${t}`).toContain(`\`${JOBS_SCHEMA}.${t}\``);
    expect(folded, 'step 3 does not say the role and the schema stay').toMatch(
      new RegExp(`the role \`${JOBS_ROLE}\`, the schema \`${JOBS_SCHEMA}\`,[^.]*\\bstay\\b`),
    );
  });

  it("is proved by the checks, before the hold lifts: pg-boss's oldest job", () => {
    const checks = section('Checks');
    const before = checks.slice(0, checks.indexOf('After lifting the hold'));
    expect(before).toContain(`SELECT count(*), min(created_on) FROM ${JOBS_SCHEMA}.job;`);
  });
});
