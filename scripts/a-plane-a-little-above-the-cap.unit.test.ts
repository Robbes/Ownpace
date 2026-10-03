// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PLANE A LITTLE ABOVE THE CAP (workplan 0143 T1 step 3's plane half; open
 * question 9, answered 2026-09-29: "Yes").
 *
 * The tick holds each stack to `MAX_PASSES_IN_FLIGHT` passes (#1296), but a
 * self-hosted Trigger.dev plane runs up to 300 at once, and a run the plane
 * has not started yet is not in the tick's count. So the plane gets a limit
 * of its own: the tick's cap plus two, 5 on the OTA stack and 8 on live. One
 * slot is the tick's own run, and one is a cutover waiting on its pass: the
 * plane counts every run, and at exactly the cap a stack full of passes would
 * hold back the tick itself.
 *
 * The run queue reads the limit from Redis, which a deploy fills from
 * `"RuntimeEnvironment"."maximumConcurrencyLimit"` (Trigger.dev v4.5.16's
 * `updateEnvConcurrencyLimits`). So `plane-limit.sh` sets the column, and the
 * bring-up runs it before the task deploy.
 *
 * What this holds, with the real script and a stub psql that writes down
 * every statement it is handed:
 *
 *  1. the cap plus two is written to the deploying environment of the stack's
 *     own project, and read back: 5 for a blank cap, 8 for live's 6;
 *  2. `--check` only reads, and fails when the number is not the cap's;
 *  3. a cap that is not a whole number of at least 1, or a missing or odd
 *     project ref, stops it before a statement is sent;
 *  4. an update that finds no environment, or a schema without the column,
 *     fails it, naming why;
 *  5. the bring-up runs it after the task environment and before the deploy.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'deploy/compose/plane-limit.sh');

const SCHEMA = [
  'Project.externalRef',
  'Project.id',
  'Project.name',
  'RuntimeEnvironment.maximumConcurrencyLimit',
  'RuntimeEnvironment.projectId',
  'RuntimeEnvironment.slug',
];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plane-limit-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Stub {
  /** The columns the probe answers with. */
  schema?: string[];
  /** What the UPDATE answers: its RETURNING rows, then psql's tag. */
  update?: string;
  /** What the read-back answers. */
  readBack?: string;
}

/**
 * Run the script with a `.env` of `envLines` and a stub psql. Returns what it
 * said and every statement the stub was handed, in order.
 */
function run(envLines: string[], stub: Stub, args: string[] = []) {
  const envFile = join(dir, '.env');
  writeFileSync(envFile, envLines.join('\n') + '\n');
  const log = join(dir, 'sql.log');
  writeFileSync(log, '');
  const psql = join(dir, 'psql-stub');
  writeFileSync(join(dir, 'schema'), (stub.schema ?? SCHEMA).join('\n') + '\n');
  writeFileSync(join(dir, 'update'), stub.update ?? '');
  writeFileSync(join(dir, 'read-back'), stub.readBack ?? '');
  writeFileSync(
    psql,
    [
      '#!/usr/bin/env bash',
      'sql="$(cat)"',
      `printf '%s\\n---\\n' "$sql" >> '${log}'`,
      'case "$sql" in',
      `  *information_schema*) cat '${join(dir, 'schema')}' ;;`,
      `  UPDATE*) cat '${join(dir, 'update')}' ;;`,
      `  *) cat '${join(dir, 'read-back')}' ;;`,
      'esac',
    ].join('\n'),
  );
  chmodSync(psql, 0o755);
  const r = spawnSync(SCRIPT, args, {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      TRIGGER_DB_PSQL: psql,
      PLANE_LIMIT_ENV_FILE: envFile,
    },
  });
  const statements = readFileSync(log, 'utf8')
    .split('\n---\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', statements };
}

const updates = (statements: string[]) => statements.filter((s) => s.startsWith('UPDATE'));

describe('the plane runs a little above the tick', () => {
  it.each([
    ['a blank cap, the OTA stack', 'MAX_PASSES_IN_FLIGHT=', 5],
    ["live's cap", 'MAX_PASSES_IN_FLIGHT=6', 8],
  ])('%s: the cap plus two, written and read back', (_what, cap, limit) => {
    const r = run(['TRIGGER_PROJECT_REF=proj_invented1', cap], {
      update: `${limit}\nUPDATE 1\n`,
      readBack: `${limit}\n`,
    });

    expect(r.status, r.err).toBe(0);
    const [update] = updates(r.statements);
    expect(update).toContain(`SET "maximumConcurrencyLimit" = ${limit} `);
    expect(update).toContain(`p."externalRef" = 'proj_invented1'`);
    expect(update).toContain(`e.slug = 'prod'`);
    expect(update).toContain('RETURNING');
    expect(r.out).toContain(`runs at most ${limit} at once`);
    expect(r.out).toContain('(read back)');
  });

  it('writes the environment the tasks deploy to, as deploy-tasks.sh reads it', () => {
    const r = run(['TRIGGER_PROJECT_REF=proj_invented1', 'TRIGGER_ENV=staging'], {
      update: '5\nUPDATE 1\n',
      readBack: '5\n',
    });

    expect(r.status, r.err).toBe(0);
    expect(updates(r.statements)[0]).toContain(`e.slug = 'staging'`);
  });

  it('asks the schema first, and writes before it reads back', () => {
    const r = run(['TRIGGER_PROJECT_REF=proj_invented1'], { update: '5\nUPDATE 1\n', readBack: '5\n' });

    expect(r.status, r.err).toBe(0);
    expect(r.statements.map((s) => s.split(' ')[0])).toEqual(['SELECT', 'UPDATE', 'SELECT']);
    expect(r.statements[0]).toContain('information_schema');
  });
});

describe('--check only reads', () => {
  it('sends no update, and passes when the plane holds the cap plus two', () => {
    const r = run(['TRIGGER_PROJECT_REF=proj_invented1', 'MAX_PASSES_IN_FLIGHT=6'], { readBack: '8\n' }, [
      '--check',
    ]);

    expect(r.status, r.err).toBe(0);
    expect(updates(r.statements)).toEqual([]);
  });

  it('fails when the plane holds another number, naming both', () => {
    const r = run(['TRIGGER_PROJECT_REF=proj_invented1', 'MAX_PASSES_IN_FLIGHT=6'], { readBack: '300\n' }, [
      '--check',
    ]);

    expect(r.status).toBe(1);
    expect(updates(r.statements)).toEqual([]);
    expect(r.err).toContain('at most 300 at once');
    expect(r.err).toContain('asks for 8');
  });
});

describe('what it refuses before a statement is sent', () => {
  it.each(['0', 'two', '3.5', '-1'])('a cap of %s', (cap) => {
    const r = run(['TRIGGER_PROJECT_REF=proj_invented1', `MAX_PASSES_IN_FLIGHT=${cap}`], {});

    expect(r.status).toBe(1);
    expect(r.err).toContain('MAX_PASSES_IN_FLIGHT');
    expect(r.statements).toEqual([]);
  });

  it('no project ref', () => {
    const r = run(['TRIGGER_PROJECT_REF='], {});

    expect(r.status).toBe(1);
    expect(r.err).toContain('TRIGGER_PROJECT_REF is not set');
    expect(r.statements).toEqual([]);
  });

  it('a project ref that is not one, rather than quoting it into SQL', () => {
    const r = run(["TRIGGER_PROJECT_REF=proj_x' OR 'a'='a"], {});

    expect(r.status).toBe(1);
    expect(r.err).toContain('is not a project ref');
    expect(r.statements).toEqual([]);
  });
});

describe('what it fails on, saying why', () => {
  it('an update that finds no environment: another project, or not this stack', () => {
    const r = run(['TRIGGER_PROJECT_REF=proj_invented1'], { update: 'UPDATE 0\n', readBack: '' });

    expect(r.status).toBe(1);
    expect(r.err).toContain('the update changed 0');
  });

  it('a read-back that is not the number written', () => {
    const r = run(['TRIGGER_PROJECT_REF=proj_invented1'], { update: '5\nUPDATE 1\n', readBack: '300\n' });

    expect(r.status).toBe(1);
    expect(r.err).toContain('at most 300 at once');
  });

  it('a schema without the column, before anything is written', () => {
    const r = run(['TRIGGER_PROJECT_REF=proj_invented1'], {
      schema: SCHEMA.filter((c) => c !== 'RuntimeEnvironment.maximumConcurrencyLimit'),
      update: '5\nUPDATE 1\n',
      readBack: '5\n',
    });

    expect(r.status).toBe(1);
    expect(r.err).toContain('RuntimeEnvironment.maximumConcurrencyLimit');
    expect(updates(r.statements)).toEqual([]);
  });
});

describe('the bring-up sets it before the deploy carries it', () => {
  const bootstrap = readFileSync(join(ROOT, 'deploy/compose/bootstrap-managed.sh'), 'utf8');
  const phase = bootstrap.slice(bootstrap.indexOf('phase_tasks() {'));
  const body = phase.slice(0, phase.indexOf('\n}\n'));

  it('found the tasks phase', () => {
    expect(body).toContain('deploy-tasks.sh');
  });

  it('after the task environment, and before the deploy', () => {
    const env = body.indexOf('"${SCRIPT_DIR}/set-task-env.sh"');
    const limit = body.indexOf('"${SCRIPT_DIR}/plane-limit.sh"');
    const deploy = body.indexOf('"${SCRIPT_DIR}/deploy-tasks.sh"');
    expect(limit, 'plane-limit.sh is not in the tasks phase').toBeGreaterThan(-1);
    expect(env).toBeLessThan(limit);
    expect(limit).toBeLessThan(deploy);
  });
});
