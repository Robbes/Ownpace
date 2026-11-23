// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE END OF THE ALPHA EMPTIES THE TASK RUNNER'S HISTORY (docs/ending-the-alpha.md,
 * *The switch* and *Checks*; site/legal/privacy.md §9).
 *
 * Privacy §9, the 1.0 testers accept, keeps the records of the background tasks
 * "Until the end of the Alpha at the latest: then the background tasks start
 * with an empty history" (privacy-task-records (a)). The erasure never reaches
 * them. Until 2026-10-21 the runbook the owner follows on the day had no step
 * for it: the switch, run as written, broke a promise of the published text and
 * nothing said so.
 *
 * WHERE THE HISTORY IS, SINCE ALPHA.18 (workplan 0167 T9, ADR-0054). The jobs
 * run in the `worker` service on pg-boss, and their history is in pg-boss's
 * tables, in the ledger's database: the store the worker's JOBS_DATABASE_URL
 * names (its role, `ownpace_jobs`, and its database), in the schema
 * deploy/compose/jobs-role.sql gives that role (`pgboss`). Until alpha.18 it was
 * also in Trigger.dev's four stores (its database `triggerdb`, Redis, ClickHouse,
 * MinIO), and alpha.16 and alpha.17 kept them, stopped, with the alpha's
 * history in their volumes. alpha.18 removed the plane from managed.yml; its
 * volumes stay until `remove-trigger-plane.sh --yes` removes them by name. So
 * the step is pg-boss's alone, plus that removal, which the step runs again
 * (it says "Nothing to remove" when the owner ran it at the deploy of alpha.18)
 * and *Checks* prove with `--list`, which prints nothing once every one of the
 * plane's volumes is gone. The job tables are read from the pg-boss release the
 * scheduler resolves (its install plan, dist/plans.js), not listed from memory:
 * every table it creates is either emptied, a partition of one that is, or
 * kept on purpose with a reason here (KEPT), so a pg-boss that adds a table
 * fails this until it is one or the other. The role and the schema stay, and
 * the step says so.
 *
 * THE ORDER MATTERS. The step comes after the drain, under the hold, once the
 * hold is DEPLOY_LIVE_QUIET_MINUTES old, as deploy-live.sh asks before it
 * replaces the worker: a pass queued just before the hold is in no count until
 * it starts, and emptying its row would end it halfway. And before live's
 * `.env` loses its stage and before the deploy, so the copy the deploy takes
 * holds the emptied tables.
 *
 * WHAT IT HOLDS:
 *   - the promise is still in privacy §9, in both languages, and the runbook
 *     quotes it (a promise dropped from the texts takes the step with it);
 *   - managed.yml has no store of the task runner but the ledger's database:
 *     no Trigger.dev service and none of the plane's volumes, and
 *     remove-trigger-plane.sh names every volume alpha.17's stores mounted;
 *   - *The switch*: the worker stopped, then one TRUNCATE, as the role the
 *     worker's JOBS_DATABASE_URL names and in its database, of exactly the
 *     tables that hold jobs, then `remove-trigger-plane.sh --yes`, then the
 *     worker started; after the drain and the quiet minutes, before the stage
 *     change and the deploy; live only, and not stand-up-live.sh; and nothing
 *     of Trigger.dev's way (no reset-trigger.sh, no dashboard step, no CLI
 *     login, no trigger profile);
 *   - the step names pgboss.job_common, where every queue's rows are, and says
 *     the role and the schema stay;
 *   - *Checks*, before the hold lifts, read pg-boss's oldest job and
 *     `remove-trigger-plane.sh --list`.
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
const COMPOSE = read('deploy/compose/managed.yml');
const REMOVE_PLANE = read('deploy/compose/remove-trigger-plane.sh');

/**
 * pg-boss's install plan, from the release the scheduler resolves: the tables
 * it creates, read where it creates them.
 */
const PGBOSS_PLANS = readFileSync(
  join(dirname(createRequire(join(ROOT, 'packages/scheduler/package.json')).resolve('pg-boss/package.json')), 'dist/plans.js'),
  'utf8',
);
const JOBS_ROLE_SQL = read('deploy/compose/jobs-role.sql');

/** Live's compose project: the step names its database's container. */
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

/**
 * The named volumes alpha.17's four stores of the task runner mounted
 * (trigger-db, trigger-redis, clickhouse, minio), and the two older ones a
 * stack may still have (ClickHouse's and MinIO's from before 0146 T7): every
 * volume the alpha's history of Trigger.dev's runs can be in.
 */
const HISTORY_VOLUMES = [
  'trigger_db_data',
  'redis_data',
  'clickhouse_data_v2',
  'clickhouse_logs',
  'clickhouse_data',
  'minio_data_v2',
  'minio_data',
];

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
  return { at, words: match![2]!.replace(/\s+#.*$/, '').trim().split(/\s+/).filter(Boolean).sort() };
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

describe('the stores the history is in, since alpha.18', () => {
  it("managed.yml runs no store of Trigger.dev's: no service of its plane, and none of its volumes", () => {
    expect(SERVICES, 'managed.yml no longer reads as this guard reads it').toEqual(expect.arrayContaining(['postgres', 'worker']));
    expect(SERVICES.filter((s) => /^trigger-|^clickhouse$|^minio/.test(s))).toEqual([]);
    for (const v of HISTORY_VOLUMES) {
      expect(code(COMPOSE), `managed.yml mounts ${v} again: the end of the Alpha would have a store to empty`).not.toMatch(
        new RegExp(`(?<![\\w-])${v}:`),
      );
    }
  });

  it('remove-trigger-plane.sh removes every volume that history can be in, by name', () => {
    const named = /^PLANE_VOLUMES=\(([^)]*)\)/m.exec(REMOVE_PLANE)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
    expect(named, 'remove-trigger-plane.sh no longer lists PLANE_VOLUMES as this guard reads it').not.toHaveLength(0);
    for (const v of HISTORY_VOLUMES) expect(named, `remove-trigger-plane.sh does not remove ${v}`).toContain(v);
    // --list prints each one still there and nothing else: Checks reads it as "all gone" when empty.
    expect(REMOVE_PLANE).toMatch(/if \[ "\$MODE" = list \]; then\n\s+\[ "\$\{#VOLUMES_HERE\[@\]\}" -eq 0 \] \|\| printf '%s\\n' "\$\{VOLUMES_HERE\[@\]\}"\n\s+exit 0\n/);
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

describe('the switch empties the history, under the hold', () => {
  const sw = section('The switch');
  const at = sw.indexOf('\n   docker compose -f deploy/compose/managed.yml stop worker\n');
  const block = sw.slice(at, sw.indexOf('\n   ```\n', at) + 1);

  it("the jobs are in the store the worker's JOBS_DATABASE_URL names, in the schema jobs-role.sql gives its role", () => {
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
    expect(at, 'the switch has no block that stops the worker').toBeGreaterThan(-1);
    expect(block).toContain(
      `docker exec -i ${LIVE}-db sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${JOBS_DB}' <<'SQL'\n   SET ROLE ${JOBS_ROLE};\n`,
    );
    const truncate = line(block, 'TRUNCATE ');
    expect(truncate.words.map((w) => w.replace(/[,;]$/, '')), 'the TRUNCATE does not name exactly the job tables').toEqual(
      EMPTIED.map((t) => `${JOBS_SCHEMA}.${t}`).sort(),
    );
    expect(truncate.at).toBeGreaterThan(block.indexOf(`SET ROLE ${JOBS_ROLE};`));
  });

  it("then removes what Trigger.dev's plane left, by name, and starts the worker again", () => {
    const remove = line(block, './deploy/compose/remove-trigger-plane.sh');
    expect(remove.words, 'the step does not run remove-trigger-plane.sh --yes').toEqual(['--yes']);
    expect(remove.at).toBeGreaterThan(line(block, 'TRUNCATE ').at);
    const start = line(block, 'docker compose -f deploy/compose/managed.yml start worker');
    expect(start.at, 'the worker is not started again after the step').toBeGreaterThan(remove.at);
  });

  it("asks nothing of Trigger.dev's way: no reset, no dashboard, no CLI login, no plane", () => {
    expect(sw).not.toMatch(/reset-trigger\.sh|--from (?:trigger|account|login)\b|--profile trigger|trigger login|TRIGGER_PROJECT_REF|TRIGGER_SECRET_KEY/);
    expect(code(sw)).not.toMatch(/docker volume rm /);
  });

  it('names where the rows are, and says the role and the schema stay', () => {
    const folded = sw.replace(/\s+/g, ' ');
    expect(folded, 'step 3 does not name the partition every queue shares').toContain(`\`${JOBS_SCHEMA}.${COMMON}\``);
    for (const t of EMPTIED) expect(folded, `step 3 does not name ${JOBS_SCHEMA}.${t}`).toContain(`\`${JOBS_SCHEMA}.${t}\``);
    expect(folded, 'step 3 does not say the role and the schema stay').toMatch(
      new RegExp(`the role \`${JOBS_ROLE}\`, the schema \`${JOBS_SCHEMA}\`,[^.]*\\bstay\\b`),
    );
  });

  it('after the drain and the quiet minutes, before the stage leaves .env, and before the deploy', () => {
    const drain = sw.indexOf('0 pass(es) still in flight');
    const quiet = sw.indexOf('DEPLOY_LIVE_QUIET_MINUTES');
    const stage = sw.indexOf('.env OWNPACE_STAGE=\n');
    const deploy = sw.indexOf('./deploy/compose/deploy-live.sh <tag>\n');
    for (const [what, i] of [['the drain', drain], ['the stage change', stage], ['the deploy', deploy]] as const) {
      expect(i, `the switch no longer has ${what}: this guard reads it`).toBeGreaterThan(-1);
    }
    expect(at, 'the step runs before the drain is done').toBeGreaterThan(drain);
    expect(quiet, 'the step does not wait for the hold to be DEPLOY_LIVE_QUIET_MINUTES old').toBeGreaterThan(drain);
    expect(quiet).toBeLessThan(at);
    expect(sw.slice(quiet, at)).toContain('the hold is on and nothing is in flight');
    // deploy-live.sh's own words and setting, or the sentence is a reason that went.
    const live = read('deploy/compose/deploy-live.sh');
    expect(live).toMatch(/QUIET_MINUTES="\$\{DEPLOY_LIVE_QUIET_MINUTES:-5\}"/);
    expect(live).toContain('say "the hold is on and nothing is in flight"');
    expect(at, 'the step runs after the stage left .env').toBeLessThan(stage);
    expect(at, 'the step runs after the deploy').toBeLessThan(deploy);
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

  it("reads pg-boss's oldest job", () => {
    expect(before).toContain(`SELECT count(*), min(created_on) FROM ${JOBS_SCHEMA}.job;`);
  });

  it("reads that none of Trigger.dev's volumes is left, and no longer reads its stores", () => {
    expect(line(before, './deploy/compose/remove-trigger-plane.sh').words.filter((w) => !w.startsWith('#'))).toEqual(['--list']);
    expect(before).not.toMatch(/TaskRun|metrics_v1|clickhouse-client|exec -T trigger-db/);
  });
});
