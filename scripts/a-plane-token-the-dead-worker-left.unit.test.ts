// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PLANE'S TOKENS (workplan 0143 T1 step 3's plane half, the half
 * plane-limit.sh cannot fix).
 *
 * The run queue counts a run against the environment's limit by keeping its
 * id in a Redis set, and the id leaves only when the engine takes the run to
 * a terminal status. A worker that dies mid-run never runs that code, so its
 * token stays forever. When the leaks equal the limit, nothing dequeues, on
 * any queue in that environment. E2E (managed) #247 and #248: the tick's beat
 * froze the second the deploy that lowered the plane from 300 to 5 registered
 * its worker, because five runs from September 17 still held slots.
 *
 * `plane-tokens.sh` releases a token when its run is terminal, gone from the
 * database, or locked past its own ceiling (floored at an hour). It touches
 * no run row.
 *
 * What this holds, with the real script and stub psql/redis-cli that write
 * down every statement and command they are handed:
 *
 *  1. a terminal run's token is released, and said;
 *  2. a PENDING run locked past its ceiling (floored at 3600s) is released,
 *     and a run locked inside its ceiling is left alone;
 *  3. a run row that is gone is released;
 *  4. a set of live runs releases nothing, and `--check` says so;
 *  5. `--check` reports a leak and exits non-zero without writing;
 *  6. a schema without the columns it names stops it before anything runs;
 *  7. the bring-up runs it after the plane's limit and before the deploy.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'deploy/compose/plane-tokens.sh');

const SCHEMA = [
  'Project.externalRef',
  'Project.id',
  'RuntimeEnvironment.slug',
  'TaskRun.id',
  'TaskRun.status',
  'TaskRun.lockedAt',
  'TaskRun.maxDurationInSeconds',
];

const ENV_KEY = 'engine:runqueue:{org:org1}:proj:proj1:env:env1:queue:task/managed-sync-tick';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plane-tokens-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Stub {
  /** The columns the probe answers with. */
  schema?: string[];
  /** The ids the concurrency set holds, one per line. */
  members?: string[];
  /** The TaskRun rows: `id|status|lockAgeSeconds|maxDurationSeconds`, one per line. */
  rows?: string[];
  /** The environment ids the join answers with. */
  envIds?: string[];
}

/**
 * Run the script with a `.env` naming this stack, and stub psql/redis-cli.
 * Returns what it said, its exit status, and every SQL statement and Redis
 * command they were handed, in order.
 */
function run(stub: Stub, args: string[] = []) {
  const envFile = join(dir, '.env');
  writeFileSync(
    envFile,
    ['COMPOSE_PROJECT_NAME=ownpace-test', 'TRIGGER_PROJECT_REF=proj_invented1', 'TRIGGER_ENV=prod'].join('\n') + '\n',
  );
  const sqlLog = join(dir, 'sql.log');
  const redisLog = join(dir, 'redis.log');
  writeFileSync(sqlLog, '');
  writeFileSync(redisLog, '');
  writeFileSync(join(dir, 'schema'), (stub.schema ?? SCHEMA).join('\n') + '\n');
  writeFileSync(join(dir, 'members'), (stub.members ?? []).join('\n') + '\n');
  writeFileSync(join(dir, 'rows'), (stub.rows ?? []).join('\n') + '\n');
  writeFileSync(join(dir, 'env-ids'), (stub.envIds ?? ['env1']).join('\n') + '\n');

  const psql = join(dir, 'psql-stub');
  writeFileSync(
    psql,
    [
      '#!/usr/bin/env bash',
      'sql="$(cat)"',
      `printf '%s\\n---\\n' "$sql" >> '${sqlLog}'`,
      'case "$sql" in',
      `  *information_schema*) cat '${join(dir, 'schema')}' ;;`,
      `  *"e.id FROM"*) cat '${join(dir, 'env-ids')}' ;;`,
      `  *"FROM"*TaskRun*) cat '${join(dir, 'rows')}' ;;`,
      '  *) printf \'\\n\' ;;',
      'esac',
    ].join('\n'),
  );
  chmodSync(psql, 0o755);

  const redis = join(dir, 'redis-stub');
  writeFileSync(
    redis,
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n---\\n' "$*" >> '${redisLog}'`,
      'case "$*" in',
      `  *--scan*) printf '%s\\n' '${ENV_KEY}' ;;`,
      `  *SMEMBERS*) cat '${join(dir, 'members')}' ;;`,
      '  *) printf \'1\\n\' ;;',
      'esac',
    ].join('\n'),
  );
  chmodSync(redis, 0o755);

  const r = spawnSync(SCRIPT, args, {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      TRIGGER_DB_PSQL: psql,
      TRIGGER_REDIS_CLI: redis,
      PLANE_LIMIT_ENV_FILE: envFile,
    },
  });
  const statements = readFileSync(sqlLog, 'utf8')
    .split('\n---\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const commands = readFileSync(redisLog, 'utf8')
    .split('\n---\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', statements, commands };
}

const srem = (commands: string[]) => commands.filter((c) => c.startsWith('SREM'));

describe('the plane releases the tokens a dead worker left', () => {
  it('a terminal run: its token is released, and said', () => {
    const r = run({
      members: ['run_dead1', 'run_live1'],
      rows: ['run_dead1|COMPLETED_SUCCESSFULLY|-|-', 'run_live1|EXECUTING|10|3600'],
    });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('released run_dead1: the run is COMPLETED_SUCCESSFULLY');
    expect(srem(r.commands)).toEqual([`SREM ${ENV_KEY} run_dead1`]);
    expect(r.out).toContain('released 1 leaked token(s) of 2 held');
  });

  it.each([
    ['locked past its ceiling', 'PENDING', 7200, 3600, true],
    ['locked inside its ceiling', 'PENDING', 10, 3600, false],
    ['locked past a ceiling below the floor', 'DEQUEUED', 3700, 60, true],
  ])('a %s run: %s', (_what, status, age, ceiling, released) => {
    const r = run({
      members: ['run_x1'],
      rows: [`run_x1|${status}|${age}|${ceiling}`],
    });
    if (released) {
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('released run_x1');
      expect(srem(r.commands)).toEqual([`SREM ${ENV_KEY} run_x1`]);
    } else {
      expect(r.status, r.err).toBe(0);
      expect(r.out).toContain('every one of them is a live run');
      expect(srem(r.commands)).toEqual([]);
    }
  });

  it('a run row that is gone: its token is released', () => {
    const r = run({ members: ['run_gone1'], rows: [] });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('released run_gone1: the run row is gone from the database');
    expect(srem(r.commands)).toEqual([`SREM ${ENV_KEY} run_gone1`]);
  });

  it('a set of live runs releases nothing', () => {
    const r = run({
      members: ['run_a1', 'run_b1'],
      rows: ['run_a1|EXECUTING|10|3600', 'run_b1|PENDING|5|3600'],
    });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('the plane holds 2 token(s) and every one of them is a live run');
    expect(srem(r.commands)).toEqual([]);
  });

  it('--check reports a leak and writes nothing', () => {
    const r = run({ members: ['run_dead1'], rows: ['run_dead1|CANCELED|-|-'] }, ['--check']);
    expect(r.status).toBe(1);
    expect(r.out).toContain('1 leaked token(s) of 1 held');
    expect(srem(r.commands)).toEqual([]);
  });

  it('an empty plane says so and stops', () => {
    const r = run({ members: [], rows: [] });
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('concurrency sets are empty');
    expect(srem(r.commands)).toEqual([]);
  });

  it('a schema without the columns it names stops it, naming them', () => {
    const r = run({ schema: ['Project.externalRef', 'Project.id'] });
    expect(r.status).toBe(1);
    expect(r.err).toContain('TaskRun.status');
    expect(r.err).toContain('Nothing was touched');
  });

  it('names the environment of this stack, not of every stack', () => {
    const r = run({ members: ['run_dead1'], rows: ['run_dead1|CRASHED|-|-'] });
    expect(r.status, r.err).toBe(0);
    const envQuery = r.statements.find((s) => s.includes('e.id FROM'));
    expect(envQuery).toContain(`p."externalRef" = 'proj_invented1'`);
    expect(envQuery).toContain(`e.slug = 'prod'`);
  });
});

describe('the bring-up releases the tokens before the deploy', () => {
  const bootstrap = readFileSync(join(ROOT, 'deploy/compose/bootstrap-managed.sh'), 'utf8');
  const phase = bootstrap.slice(bootstrap.indexOf('phase_tasks() {'));
  const body = phase.slice(0, phase.indexOf('\n}\n'));

  it('found the tasks phase', () => {
    expect(body).toContain('deploy-tasks.sh');
  });

  it('after the plane limit, and before the deploy', () => {
    const limit = body.indexOf('"${SCRIPT_DIR}/plane-limit.sh"');
    const tokens = body.indexOf('"${SCRIPT_DIR}/plane-tokens.sh"');
    const deploy = body.indexOf('"${SCRIPT_DIR}/deploy-tasks.sh"');
    expect(tokens, 'plane-tokens.sh is not in the tasks phase').toBeGreaterThan(-1);
    expect(limit).toBeLessThan(tokens);
    expect(tokens).toBeLessThan(deploy);
  });
});
