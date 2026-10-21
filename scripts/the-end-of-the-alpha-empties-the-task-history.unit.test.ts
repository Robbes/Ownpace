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
 * WHERE THE HISTORY IS: all of it in triggerdb, the volume
 * `reset-trigger.sh --yes` removes (`<project>_trigger_db_data`).
 *   - Runs are not copied to ClickHouse. RUN_REPLICATION_ENABLED defaults to "0"
 *     in the webapp (Trigger.dev v4.7.2, apps/webapp/app/env.server.ts) and
 *     managed.yml does not set it; the empty dashboard Runs page is the accepted
 *     cost (0020 T7, docs/operator-runbook.md).
 *   - A run's log events go to triggerdb's TaskEvent table:
 *     EVENT_REPOSITORY_DEFAULT_STORE defaults to "postgres", and managed.yml does
 *     not set it.
 *   - MinIO's `packets` bucket takes only a payload of 512 KB or more or an
 *     output of 128 KB or more (TASK_PAYLOAD_OFFLOAD_THRESHOLD; 0134), which
 *     these tasks do not make.
 * So the step is the reset and the bring-up's phases after it, and the proof
 * reads the two stores the reset does not touch. Set either key and the history
 * reaches ClickHouse, where the reset does not: this fails until the step also
 * empties `<project>_clickhouse_data_v2` (reset-trigger.sh `--with-stores`, the
 * finding's first proposal, then becomes the right build).
 *
 * THE ORDER MATTERS TWICE. The reset comes after the drain, under the hold, and
 * BEFORE live's `.env` loses its stage: `--from account` then uploads the stage
 * to the new project, and the deploy's `set-task-env.sh` deletes it and prints
 * the line step 6 reads. Reset after the `.env` change and the new project never
 * held the stage, `envvars.del` finds nothing, the line never comes, and the
 * operator is sent to *If a check fails* for a switch that took. And the reset
 * comes before the deploy, so a copy the deploy takes holds the new, empty
 * database.
 *
 * WHAT IT HOLDS:
 *   - the promise is still in privacy §9, in both languages, and the runbook
 *     quotes it (a promise dropped from the texts takes the step with it);
 *   - *The switch* runs reset-trigger.sh's own *Next*, line for line and in its
 *     order, then `--from account`, after the drain and before the stage change
 *     and the deploy, and says it is not stand-up-live.sh (which refuses once
 *     live's deploy log has a line);
 *   - *Checks*, before the hold lifts, read triggerdb's oldest run, the four
 *     ClickHouse tables the history would reach (runs, their payloads, events v1
 *     and v2, named as Trigger.dev's own schema names them), with the client
 *     taking the container's own credentials and no password on any command
 *     line, and the `packets` bucket on the path managed.yml mounts MinIO's
 *     volume at;
 *   - managed.yml sets neither key for trigger-api, and still gives the
 *     clickhouse service the credentials the check's client reads.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY (AGENTS.md).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const RUNBOOK_PATH = 'docs/ending-the-alpha.md';
const RUNBOOK = read(RUNBOOK_PATH);
const RESET = read('deploy/compose/reset-trigger.sh');
const COMPOSE = read('deploy/compose/managed.yml');

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

/** The lines of code in a service block, without its comments. */
const code = (block: string): string =>
  block
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

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

describe('the switch empties the history, under the hold', () => {
  const sw = section('The switch');

  it("runs reset-trigger.sh's own Next, in its order, and then --from account", () => {
    expect(sw, 'the switch does not reset the task runner').toContain('./deploy/compose/reset-trigger.sh --yes\n');
    const next = RESET.slice(RESET.indexOf('[reset-trigger] done. Next:'));
    const commands = [...next.matchAll(/^ {2}(\.\/deploy\/compose\/\S+(?: [^\n]+)?)$/gm)].map((m) => m[1]!.trim());
    expect(commands, 'reset-trigger.sh prints no commands after "done. Next:"').toEqual([
      './deploy/compose/ensure-env-secrets.sh',
      './deploy/compose/bootstrap-managed.sh --from trigger',
      './deploy/compose/bootstrap-managed.sh --from account',
    ]);
    let at = sw.indexOf('./deploy/compose/reset-trigger.sh --yes\n');
    for (const command of commands) {
      const found = sw.indexOf(`${command}\n`, at);
      expect(found, `the switch does not run "${command}" after the reset, as reset-trigger.sh says`).toBeGreaterThan(at);
      at = found;
    }
  });

  it('after the drain, before the stage leaves .env, and before the deploy', () => {
    const reset = sw.indexOf('./deploy/compose/reset-trigger.sh --yes\n');
    const drain = sw.indexOf('0 pass(es) still in flight');
    const stage = sw.indexOf('.env OWNPACE_STAGE=\n');
    const deploy = sw.indexOf('./deploy/compose/deploy-live.sh <tag>\n');
    for (const [what, i] of [['the drain', drain], ['the stage change', stage], ['the deploy', deploy]] as const) {
      expect(i, `the switch no longer has ${what}: this guard reads it`).toBeGreaterThan(-1);
    }
    expect(reset, 'the reset runs before the drain is done').toBeGreaterThan(drain);
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

  it("reads triggerdb's oldest run", () => {
    expect(before).toContain(
      `docker compose -f deploy/compose/managed.yml exec -T trigger-db psql -X -At -U trigger -d triggerdb -c 'SELECT min("createdAt") FROM "TaskRun"'`,
    );
  });

  it('counts the four ClickHouse tables the history would reach, with the container\'s own credentials', () => {
    const at = before.indexOf('exec -T clickhouse clickhouse-client');
    expect(at, 'no ClickHouse count before the hold lifts').toBeGreaterThan(-1);
    const query = before.slice(at, before.indexOf('```', at));
    for (const table of ['task_runs_v2', 'raw_task_runs_payload_v1', 'task_events_v1', 'task_events_v2']) {
      expect(query, `the ClickHouse check does not count trigger_dev.${table}`).toContain(`FROM trigger_dev.${table}`);
    }
    // clickhouse-client reads CLICKHOUSE_USER and CLICKHOUSE_PASSWORD from its
    // environment (programs/client/Client.cpp at the pinned 26.2), and the
    // container has both. A password on a command line is one in `ps`.
    expect(query, 'the ClickHouse check puts a password on a command line').not.toMatch(/--password|--user/);
    const ch = code(service('clickhouse'));
    expect(ch).toMatch(/\n\s+CLICKHOUSE_USER: /);
    expect(ch).toMatch(/\n\s+CLICKHOUSE_PASSWORD: /);
  });

  it("lists the packets bucket where managed.yml mounts MinIO's volume", () => {
    const minio = code(service('minio'));
    const mount = /\n\s+- minio_data:(\/\S+)/.exec(minio)?.[1];
    expect(mount, "managed.yml's minio service mounts no minio_data volume").toBeTruthy();
    expect(minio).toMatch(/MINIO_DEFAULT_BUCKETS: packets\b/);
    expect(before).toContain(`docker compose -f deploy/compose/managed.yml exec -T minio ls -A ${mount}/packets`);
  });
});

describe('the premise: the history is in triggerdb alone', () => {
  it("managed.yml sets neither key that would send it to ClickHouse", () => {
    const api = code(service('trigger-api'));
    for (const key of ['RUN_REPLICATION_ENABLED', 'EVENT_REPOSITORY_DEFAULT_STORE']) {
      expect(
        api,
        `trigger-api sets ${key}: the history then reaches ClickHouse, which reset-trigger.sh leaves alone. ` +
          `The end of the Alpha must empty <project>_clickhouse_data_v2 too (${RUNBOOK_PATH}, The switch)`,
      ).not.toMatch(new RegExp(`\\b${key}\\b`));
    }
  });

  it('reset-trigger.sh removes the volume trigger-db keeps triggerdb in', () => {
    expect(RESET).toMatch(/VOLUME="\$\{COMPOSE_PROJECT\}_trigger_db_data"/);
    expect(code(service('trigger-db'))).toMatch(/\n\s+- trigger_db_data:\/var\/lib\/postgresql\n/);
  });
});
