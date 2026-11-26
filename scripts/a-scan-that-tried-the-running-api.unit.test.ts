// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SCAN THAT TRIED THE RUNNING API (workplan 0178 T7; the owner's decisions
 * D3 (a) and D4 (a) of 2026-11-26).
 *
 * Every door of the API is held to sign-in by the code that serves it and by
 * the guards that read that code. Nothing asked a RUNNING API whether an
 * operation the description secures really refuses a request without a
 * token, or whether input the description allows makes it answer 500.
 * `.github/workflows/schemathesis.yml` runs Schemathesis for that, through
 * `scripts/schemathesis-report.mjs`, against a stack the job composes on its
 * own runner. So this holds:
 *
 *  1. WHERE IT RUNS (D3 (a), 0178 §6.1, §6.5). Every job on a GitHub-hosted
 *     label and never the self-hosted runner; no repository secret and no
 *     `environment:`; no concurrency group shared with an E2E workflow;
 *     nightly on `main` and on dispatch, never on a pull request or a push
 *     (that is T8, after 14 quiet nights). Every container of the stack is in
 *     one network namespace with nothing but loopback: Postgres with
 *     `--network none` and the rest joined to it, no port published, no host
 *     network, and every address the scan or a probe asks is 127.0.0.1.
 *  2. THE PINS. Schemathesis by a release tag and its index digest, in one
 *     `SCHEMATHESIS_IMAGE`, the comment above it naming that digest and the
 *     day it was read; every action by a commit; Postgres and Node read from
 *     the Dockerfiles that pin them, which Dependabot moves.
 *  3. THE PROOF (0178 §8 step 3, §10). The known-bad fixture's two faults are
 *     real (its server answers without a token and answers 500), and the
 *     report is RED when Schemathesis does not flag either of them: take a
 *     fault out of what it flagged and the run did not finish. The proof runs
 *     before the API's scan, and a run whose proof does not hold never scans
 *     the API.
 *  4. REPORT ONLY (D4 (a)). The job fails only on a scan that did not finish:
 *     an image unpulled, a stack that did not come up, a report missing,
 *     stopped early, or with an operation untested, too few operations, or the
 *     proof. Anything found, of any of the four checks, fails nothing. It is
 *     in no required check and not in ci.yml, and docs/testing.md says it
 *     blocks nothing yet.
 *  5. WHAT THE SUMMARY NAMES. Each check is counted, and no operation of the
 *     API is named in the public summary under any check (the maintainer's
 *     answer of 2026-11-26: counts, no names); the fixture's are, since they
 *     are faults on purpose.
 *  6. THE FIXTURE IS A FIXTURE. It lives under `scripts/fixtures/`, its
 *     folder's name says what it is, and nothing in `apps/`, `packages/` or
 *     `site/` names it.
 *  7. EVERY VALUE THE RUN MAKES IS MASKED before it is used, the token among
 *     them, and the token reaches Schemathesis through its environment and a
 *     config file, never a command line.
 *  9. THE JOBS DATABASE (the maintainer's answer of 2026-11-26). The API gets
 *     a `JOBS_DATABASE_URL` on the stack's own Postgres, as the jobs role
 *     `deploy/compose/jobs-role.sql` makes, with a password of the run's own,
 *     and the worker's own runner installs pg-boss's schema and the catalog's
 *     queues before the API starts, so a sync or a cutover is enqueued for
 *     real rather than answered 500 for want of a queue. Either not made is a
 *     scan that did not finish.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import {
  API_DESCRIPTION,
  BLOCKS_LATER,
  CHECKS,
  CONFIG,
  CONTAINERS,
  FIXTURE,
  IMAGE,
  JOBS_ROLE_SQL,
  LOOPBACK,
  MIN_OPERATIONS,
  WITHHELD,
  flagged,
  fromOf,
  readReport,
  readRun,
  report,
  run,
  scanArgs,
  stackImages,
  unflagged,
  type Docker,
  type Reading,
} from './schemathesis-report.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/** Every temporary directory a test here makes, removed after it. */
const made: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const WORKFLOW = '.github/workflows/schemathesis.yml';
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const YML = read(WORKFLOW);

/** What the image was read as on 2026-11-26 (the workflow's comment). */
const SCHEMATHESIS = 'schemathesis/schemathesis:4.34.0@sha256:7aa27b2085e944c81f5225c52c29bf072778bb5d59e6b27e1876b4757e266a14';

/** A report in the shape Schemathesis 4.34.0 writes (`--report json`), as measured on 2026-11-26. */
function reportJson(over: Record<string, unknown> = {}, failures: Array<{ code: string; operations: string[] }> = []) {
  return {
    schemathesis_version: '4.34.0',
    seed: 1,
    stop_reason: 'completed',
    complete: true,
    operations: { total: 200, selected: 200, tested: 200, errored: 0, skipped: 0 },
    failures: failures.map((f) => ({ type: 'x', code: f.code, title: `title of ${f.code}`, severity: 'critical', count: f.operations.length, operations: f.operations })),
    errors: [],
    warnings: {},
    ...over,
  };
}

/** The fixture's report when both faults were flagged, as the measured run of 2026-11-26 was. */
const FIXTURE_FLAGGED = () =>
  reportJson({ operations: { total: 2, selected: 2, tested: 2, errored: 0, skipped: 0 } }, [
    { code: 'ST401', operations: ['GET /answers-without-a-token'] },
    { code: 'ST101', operations: ['GET /throws'] },
    { code: 'ST103', operations: ['GET /throws'] },
  ]);

const reading = (d: unknown) => {
  const r = readReport(d);
  if (r.stopped) throw new Error(r.stopped);
  return r as Reading;
};

describe('the workflow: where it runs, and when (1, 2)', () => {
  it('runs nightly on main and on dispatch, never on a pull request or a push', () => {
    const on = /^on:\n([\s\S]*?)^\S/m.exec(YML)![1];
    expect(on).toMatch(/^ {2}schedule:\n {4}- cron: '\d+ \d+ \* \* \*'$/m);
    expect(on).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(on).not.toMatch(/pull_request|push:|workflow_run|repository_dispatch/);
  });

  it('takes a GitHub-hosted runner for every job, reads no secret and no environment, and shares no group with an E2E', () => {
    const runsOn = [...YML.matchAll(/^\s*runs-on:\s*(.+)$/gm)].map((m) => m[1]!.trim());
    expect(runsOn).toEqual(['ubuntu-24.04']);
    const code = YML.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(code).not.toMatch(/self-hosted|secrets\.|^\s*environment:/m);
    const group = /^\s*group:\s*(.+)$/m.exec(YML)![1];
    expect(group).toBe('schemathesis-${{ github.ref }}');
    for (const e2e of readdirSync(join(ROOT, '.github/workflows')).filter((f) => f.startsWith('e2e'))) {
      const theirs = [...read(`.github/workflows/${e2e}`).matchAll(/^\s*group:\s*(.+)$/gm)].map((m) => m[1]!.trim());
      expect(theirs).not.toContain(group);
    }
  });

  it('pins every action by a commit, and Schemathesis by the tag and digest read on 2026-11-26, once', () => {
    for (const [, ref] of YML.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)) expect(ref).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    const pins = [...YML.matchAll(/^\s*SCHEMATHESIS_IMAGE:\s*(\S+)\s*$/gm)].map((m) => m[1]);
    expect(pins).toEqual([SCHEMATHESIS]);
    expect(SCHEMATHESIS).toMatch(IMAGE);
    const comment = /((?:^\s*#.*\n)+)\s*SCHEMATHESIS_IMAGE:/m.exec(YML)![1];
    expect(comment).toContain('`7aa27b2085e9…`');
    expect(comment).toContain('2026-11-26');
    expect(comment).toContain('4.34.0');
  });

  it('runs the report as its one scan step, with no continue-on-error and no if: to read a broken run as green', () => {
    expect(YML).toMatch(/^\s*run: node scripts\/schemathesis-report\.mjs$/m);
    expect(YML).not.toMatch(/continue-on-error|^\s*if:/m);
  });

  it('gates no merge: not in ci.yml, not among docs/testing.md\'s required checks, and docs/testing.md says it blocks nothing yet', () => {
    expect(read('.github/workflows/ci.yml')).not.toMatch(/schemathesis/i);
    const testing = read('docs/testing.md');
    const marker = '**Required status checks**';
    expect(testing).toContain(marker);
    expect(testing.slice(testing.indexOf(marker)).split('\n\n')[0]).not.toMatch(/schemathesis/i);
    expect(testing).toContain('- `schemathesis.yml` — **Schemathesis against the API, nightly on `main` and on dispatch, report\n  only; it blocks nothing yet**');
  });

  it('reads Postgres and Node from the Dockerfiles that pin them, by tag and digest', () => {
    const images = stackImages(read);
    expect(images.postgres).toBe(fromOf(read('deploy/compose/postgres/Dockerfile'), 'x'));
    expect(images.node).toMatch(/^node:\d+\.\d+\.\d+-[a-z]+-slim@sha256:[0-9a-f]{64}$/);
    expect(read('apps/api/Dockerfile')).toContain(`FROM ${images.node} AS base`);
    expect(() => fromOf('FROM node:26 AS base\n', 'f', 'base')).toThrow(/not an image by tag and digest/);
    expect(() => fromOf('FROM a:1@sha256:' + 'a'.repeat(64) + '\nFROM b:1@sha256:' + 'b'.repeat(64) + '\n', 'f')).toThrow(/2 FROM lines/);
  });
});

describe('the proof: the known-bad fixture (3, 6)', () => {
  it('names the two faults the plan names, one per check that will block', () => {
    expect(FIXTURE.faults.map((f) => f.check).sort()).toEqual([...BLOCKS_LATER].sort());
    expect(FIXTURE.dir).toBe('scripts/fixtures/schemathesis-known-bad');
    const description = read(`${FIXTURE.dir}/openapi.yaml`);
    for (const f of FIXTURE.faults) {
      const [method, path] = f.operation.split(' ') as [string, string];
      expect(description).toContain(`  ${path}:\n    ${method.toLowerCase()}:`);
    }
  });

  it('serves its faults for real: the secured operation answers without a token, and the other answers 500', async () => {
    const port = 39000 + Math.floor(Math.random() * 500);
    const child = spawn(process.execPath, [join(ROOT, FIXTURE.dir, 'server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      await once(child.stdout!, 'data');
      const open = await fetch(`http://${LOOPBACK}:${port}/answers-without-a-token`);
      expect(open.status).toBe(200);
      expect(await open.json()).toEqual({ ok: true });
      expect((await fetch(`http://${LOOPBACK}:${port}/throws`)).status).toBe(500);
    } finally {
      child.kill();
    }
  });

  it('holds when Schemathesis flagged both faults, and is RED when either is taken out of what it flagged', () => {
    const both = reading(FIXTURE_FLAGGED());
    expect(unflagged(both)).toEqual([]);
    for (const fault of FIXTURE.faults) {
      const d = FIXTURE_FLAGGED();
      d.failures = d.failures.map((f) => ({ ...f, operations: f.operations.filter((op) => !(f.code === (fault.check === 'ignored_auth' ? 'ST401' : 'ST101') && op === fault.operation)) }));
      const without = reading(d);
      expect(unflagged(without)).toEqual([fault]);
      const out = report({ image: SCHEMATHESIS, proof: without, scan: reading(reportJson()) });
      expect(out.code).toBe(1);
      expect(out.markdown).toContain('The scan did not finish');
      expect(out.markdown).toContain(`\`${fault.check}\` on the fixture's \`${fault.operation}\``);
    }
  });

  it('is red when a fault is flagged by another check than its own', () => {
    const swapped = reading(reportJson({}, [
      { code: 'ST101', operations: ['GET /answers-without-a-token'] },
      { code: 'ST401', operations: ['GET /throws'] },
    ]));
    expect(unflagged(swapped)).toEqual([...FIXTURE.faults]);
  });

  it('is named by nothing that ships', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
        const rel = join(dir, name);
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.(m?[jt]sx?|json|ya?ml)$/.test(name) && read(rel).includes('schemathesis-known-bad')) hits.push(rel);
      }
    };
    for (const top of ['apps', 'packages', 'site']) walk(top);
    expect(hits).toEqual([]);
  });
});

describe('the report: what fails, and what it names (4, 5)', () => {
  const proof = () => reading(FIXTURE_FLAGGED());

  it('exits 0 whatever the API scan found, and counts each of the four checks', () => {
    const scan = reading(reportJson({}, [
      { code: 'ST401', operations: ['GET /api/a-door'] },
      { code: 'ST101', operations: ['GET /api/b', 'POST /api/c'] },
      { code: 'ST103', operations: ['GET /api/b'] },
      { code: 'ST108', operations: ['GET /api/d'] },
      { code: 'ST999', operations: ['GET /api/e'] },
    ]));
    const out = report({ image: SCHEMATHESIS, event: 'schedule', proof: proof(), scan });
    expect(out.code).toBe(0);
    for (const check of CHECKS) expect(out.markdown).toMatch(new RegExp(`\\| \`${check}\` \\| \\d+ \\|`));
    expect(out.markdown).toContain('| `not_a_server_error` | 2 | Not yet (T8) |');
    expect(out.markdown).toContain('| `status_code_conformance` | 1 | Never |');
    expect(out.markdown).toContain('| ST999 title of ST999 | 1 | Never |');
    // Counted, and no operation of the API named under any check.
    for (const op of ['/api/a-door', '/api/b', '/api/c', '/api/d', '/api/e']) expect(out.markdown).not.toContain(op);
    expect(out.markdown).toContain('seed `1`');
  });

  it('counts the operations every check flags on the API and never names one', () => {
    expect(WITHHELD).toEqual(CHECKS);
    const scan = reading(reportJson({}, [{ code: 'ST401', operations: ['GET /api/a-door', 'GET /api/another-door'] }]));
    const out = report({ image: SCHEMATHESIS, proof: proof(), scan });
    expect(out.code).toBe(0);
    expect(out.markdown).not.toContain('a-door');
    expect(out.lines.join('\n')).not.toContain('a-door');
    expect(out.markdown).toContain('| `ignored_auth` | 2 | Not yet (T8) |');
    expect(out.markdown).toContain('**No operation of the API is named here, under any check.**');
    // The fixture's are named: they are faults on purpose.
    expect(out.markdown).toContain('`ignored_auth` on `GET /answers-without-a-token`: flagged');
  });

  it('reads each way a run can end short as a scan that did not finish', () => {
    const cases: Array<[unknown, RegExp]> = [
      [reportJson({ complete: false, stop_reason: 'interrupted' }), /stopped before the end \(interrupted\)/],
      [reportJson({ stop_reason: 'failure_limit' }), /stopped before the end/],
      [reportJson({ operations: { total: 200, selected: 200, tested: 199, errored: 0, skipped: 1 } }), /tested 199 of the 200/],
      [reportJson({ operations: { total: 200, selected: 200, tested: 200, errored: 3, skipped: 0 } }), /could not test 3 operations/],
      [reportJson({ errors: [{ message: 'connection refused' }] }), /could not test 1 operation/],
      [{ nothing: true }, /shape it writes/],
      [reportJson({ failures: [{ title: 'no code' }] }), /without a code/],
    ];
    for (const [d, why] of cases) {
      const scan = readReport(d);
      expect(scan.stopped).toMatch(why);
      const out = report({ image: SCHEMATHESIS, proof: proof(), scan });
      expect(out.code).toBe(1);
    }
    const few = reading(reportJson({ operations: { total: 3, selected: 3, tested: 3, errored: 0, skipped: 0 } }));
    expect(report({ image: SCHEMATHESIS, proof: proof(), scan: few }).markdown).toContain(`fewer than the ${MIN_OPERATIONS}`);
    const dir = tempDir('st-');
    expect(readRun(join(dir, 'none.json')).stopped).toBe('Schemathesis wrote no report');
    writeFileSync(join(dir, 'bad.json'), '{');
    expect(readRun(join(dir, 'bad.json')).stopped).toMatch(/not JSON/);
    // The seed as Schemathesis wrote it, 128 bits, not as JSON.parse rounds it.
    writeFileSync(join(dir, 'seed.json'), JSON.stringify(reportJson()).replace('"seed":1', '"seed":314032974253563520000123456789012345678'));
    expect((readRun(join(dir, 'seed.json')) as Reading).seed).toBe('314032974253563520000123456789012345678');
    expect(report({ image: SCHEMATHESIS }).code).toBe(1);
  });

  it('knows each check by Schemathesis’s codes, and lists an operation once per check', () => {
    const r = reading(reportJson({}, [
      { code: 'ST101', operations: ['GET /b', 'GET /a'] },
      { code: 'ST102', operations: ['GET /a'] },
    ]));
    expect(flagged(r, 'not_a_server_error')).toEqual(['GET /a', 'GET /b']);
  });
});

describe('the run, against a stubbed docker (1, 3, 4, 7)', () => {
  function stub(fixture: unknown, api: unknown) {
    const calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv; input?: string }> = [];
    const docker: Docker = (args, opts = {}) => {
      calls.push({ args, env: opts.env, input: opts.input });
      const i = args.indexOf('--report-json-path');
      if (i >= 0) {
        const out = args.find((a) => a.endsWith(':/out'))!.slice(0, -':/out'.length);
        const name = args[i + 1]!.replace('/out/', '');
        const body = name === 'fixture.json' ? fixture : api;
        if (body) writeFileSync(join(out, name), JSON.stringify(body));
      }
      return { status: 0, stdout: '', stderr: '', error: undefined, signal: null };
    };
    return { calls, docker };
  }

  const go = (docker: Docker, env: NodeJS.ProcessEnv = {}) => {
    const masked: string[] = [];
    const out = tempDir('st-run-');
    return run({ root: ROOT, docker, env: { SCHEMATHESIS_IMAGE: SCHEMATHESIS, GITHUB_EVENT_NAME: 'schedule', ...env }, wait: async () => {}, mask: (v) => masked.push(v), out }).then((v) => ({ v, masked, out }));
  };

  it('composes the stack in one namespace with loopback only, runs the proof, then the API, and removes it all', async () => {
    const { calls, docker } = stub(FIXTURE_FLAGGED(), reportJson());
    const { v, masked, out } = await go(docker);
    expect(v.code).toBe(0);
    const runs = calls.filter((c) => c.args[0] === 'run');
    // Postgres alone has a network of its own, and it is none; everything else joins it.
    const networks = runs.map((c) => c.args[c.args.indexOf('--network') + 1]);
    expect(networks[0]).toBe('none');
    expect(new Set(networks.slice(1))).toEqual(new Set([`container:${CONTAINERS.db}`]));
    for (const c of calls) {
      expect(c.args).not.toContain('--publish');
      expect(c.args).not.toContain('-p');
      expect(c.args.join(' ')).not.toMatch(/--network[= ]host/);
      for (const url of c.args.join(' ').match(/https?:\/\/[^\s'`)]+/g) ?? []) expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    }
    // Postgres runs as its own user, as the integration tests start it.
    const db = runs[0]!.args;
    expect(db.slice(db.indexOf('--user'), db.indexOf('--user') + 2)).toEqual(['--user', '70:70']);
    // The proof's scan comes before the API's.
    const scans = runs.filter((c) => c.args.includes(SCHEMATHESIS)).map((c) => c.args[c.args.indexOf('run', c.args.indexOf(SCHEMATHESIS)) + 1]);
    expect(scans).toEqual([`/src/${FIXTURE.dir}/openapi.yaml`, `/src/${API_DESCRIPTION}`]);
    // Every value made here is masked, and the token reaches Schemathesis by its environment only.
    expect(masked).toHaveLength(6);
    const token = masked[5];
    for (const c of calls) expect(c.args.join(' ')).not.toContain(token);
    for (const c of calls) for (const s of masked.slice(0, 5)) expect(c.args.join(' ')).not.toContain(s);
    for (const c of runs.filter((r) => r.args.includes(SCHEMATHESIS))) expect(c.env?.DAST_TOKEN).toBe(token);
    expect(readFileSync(join(out, 'schemathesis.toml'), 'utf8')).toBe(CONFIG);
    // app_user's password goes through stdin.
    expect(calls.find((c) => c.input)?.input).toContain(`ALTER ROLE app_user PASSWORD '${masked[1]}'`);
    // Removed at the start and at the end.
    const removed = calls.filter((c) => c.args[0] === 'rm');
    expect(removed).toHaveLength(2);
    expect(calls.at(-1)!.args).toEqual(['rm', '-f', ...Object.values(CONTAINERS)]);
  });

  it('gives the API its jobs database: the bring-up\'s jobs role, a password of the run\'s own, the worker\'s queues, before the API starts (9)', async () => {
    const { calls, docker } = stub(FIXTURE_FLAGGED(), reportJson());
    const { v, masked } = await go(docker);
    expect(v.code).toBe(0);
    const at = (pred: (c: (typeof calls)[number]) => boolean) => calls.findIndex(pred);
    // The bring-up's own file, as it is, through stdin.
    const role = at((c) => c.input === read(JOBS_ROLE_SQL));
    expect(role).toBeGreaterThan(-1);
    // Its password, the run's own and masked, through stdin too.
    const jobsPassword = masked[4]!;
    const password = at((c) => c.input === `ALTER ROLE ownpace_jobs PASSWORD '${jobsPassword}';\n`);
    expect(password).toBeGreaterThan(role);
    // The worker's runner installs the schema and the catalog's queues, as the jobs role, on loopback.
    const install = at((c) => c.args.some((a) => a.includes('PgBossJobRunner')));
    expect(install).toBeGreaterThan(password);
    expect(calls[install]!.env?.JOBS_DATABASE_URL).toBe(`postgresql://ownpace_jobs:${jobsPassword}@127.0.0.1:5432/ownpace`);
    expect(calls[install]!.args.join(' ')).not.toContain(jobsPassword);
    // And the API starts after, with the same URL by its environment only.
    const api = at((c) => c.args[0] === 'run' && c.args.includes(CONTAINERS.api));
    expect(api).toBeGreaterThan(install);
    expect(calls[api]!.args).toEqual(expect.arrayContaining(['--env', 'JOBS_DATABASE_URL']));
    expect(calls[api]!.env?.JOBS_DATABASE_URL).toBe(calls[install]!.env?.JOBS_DATABASE_URL);
  });

  it('stops, as a scan that did not finish, when the jobs role or its queues are not made', async () => {
    for (const failing of [(c: { input?: string }) => c.input === read(JOBS_ROLE_SQL), (c: { args: string[] }) => c.args.some((a) => a.includes('PgBossJobRunner'))]) {
      const base = stub(FIXTURE_FLAGGED(), reportJson());
      const docker: Docker = (args, opts) => (failing({ args, input: opts?.input }) ? { status: 1, stdout: '', stderr: 'no', error: undefined, signal: null } : base.docker(args, opts));
      const { v } = await go(docker);
      expect(v.code).toBe(1);
      expect(v.markdown).toMatch(/The scan did not finish:.*jobs/);
      expect(base.calls.some((c) => c.args[0] === 'run' && c.args.includes(CONTAINERS.api))).toBe(false);
    }
  });

  it('never scans the API when the proof does not hold', async () => {
    const d = FIXTURE_FLAGGED();
    d.failures = d.failures.filter((f) => f.code !== 'ST401');
    const { calls, docker } = stub(d, reportJson());
    const { v } = await go(docker);
    expect(v.code).toBe(1);
    expect(calls.some((c) => c.args.includes(`/src/${API_DESCRIPTION}`))).toBe(false);
  });

  it('fails, running nothing, when SCHEMATHESIS_IMAGE is not the image by a tag and its digest', async () => {
    for (const image of ['', 'schemathesis/schemathesis:stable', 'schemathesis/schemathesis:4.34.0', `other/schemathesis:4.34.0@sha256:${'a'.repeat(64)}`]) {
      const { calls, docker } = stub(null, null);
      const { v } = await go(docker, { SCHEMATHESIS_IMAGE: image });
      expect(v.code).toBe(1);
      expect(calls).toEqual([]);
    }
  });

  it('fails when an image cannot be pulled, or a piece of the stack does not come up', async () => {
    for (const failing of ['pull', 'pg_isready', 'seed-managed.ts', 'src/index.ts']) {
      const base = stub(FIXTURE_FLAGGED(), reportJson());
      const docker: Docker = (args, opts) => (args.some((a) => a === failing || a.endsWith(`/${failing}`)) ? { status: 1, stdout: '', stderr: 'no', error: undefined, signal: null } : base.docker(args, opts));
      const { v } = await go(docker);
      expect(v.code).toBe(1);
      expect(v.markdown).toContain('The scan did not finish');
      expect(base.calls.at(-1)!.args[0]).toBe('rm');
    }
  });

  it('passes a dispatch’s seed to the API’s scan when it is digits, and no other', async () => {
    for (const [seed, passed] of [['12345', true], ['1; rm -rf /', false], ['', false]] as const) {
      const { calls, docker } = stub(FIXTURE_FLAGGED(), reportJson());
      await go(docker, { SCHEMATHESIS_SEED: seed });
      const api = calls.find((c) => c.args.includes(`/src/${API_DESCRIPTION}`))!;
      expect(api.args.includes('--seed')).toBe(passed);
    }
  });

  it('reads no report an earlier run left behind', async () => {
    const { docker } = stub(null, null);
    const out = tempDir('st-old-');
    writeFileSync(join(out, 'fixture.json'), JSON.stringify(FIXTURE_FLAGGED()));
    writeFileSync(join(out, 'api.json'), JSON.stringify(reportJson()));
    const v = await run({ root: ROOT, docker, env: { SCHEMATHESIS_IMAGE: SCHEMATHESIS }, wait: async () => {}, mask: () => {}, out });
    expect(v.code).toBe(1);
    expect(existsSync(join(out, 'api.json'))).toBe(false);
  });

  it('runs every scan of Schemathesis sandboxed, in the reports’ directory, over the checkout read-only', () => {
    const args = scanArgs(SCHEMATHESIS, { root: '/r', out: '/o', description: 'x.yaml', port: 1, report: 'r.json' });
    expect(args).toEqual(expect.arrayContaining(['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '/r:/src:ro', '/o:/out', '--generation-database', 'none']));
    expect(args[args.indexOf('--workdir') + 1]).toBe('/out');
    expect(args[args.indexOf('--checks') + 1]).toBe(CHECKS.join(','));
  });
});
