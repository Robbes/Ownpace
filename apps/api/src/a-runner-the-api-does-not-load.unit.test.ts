// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ON TRIGGER.DEV THE API LOADS NO PG-BOSS (workplan 0167 T6).
 *
 * Until the switch is turned on, `OWNPACE_JOB_RUNNER` is unset and every job
 * goes to Trigger.dev, as before. In that mode nothing in the API may load
 * `pg-boss` or `@openmig/scheduler/pg-boss`: the API's tests mock
 * `@openmig/scheduler`, several with a bare factory, and a door that reached
 * pg-boss in trigger mode would walk round every one of them, and round
 * Trigger.dev itself.
 *
 * Two halves:
 *
 *  1. **Loaded.** A child Node process loads the API as its image does (`node`
 *     on `apps/api/src/index.ts`, types erased, workspace packages through
 *     `node_modules`), and the operator's script, with a resolve hook that
 *     records every module URL resolved, in this repository or out of it, and
 *     asks the scheduler's readiness. None is pg-boss's package or the runner's
 *     module. A control process, on `pg-boss`, asks for the producer, and both
 *     show up: the hook does see them.
 *  2. **Written.** No shipped file under `apps/api/src` imports `pg-boss`, and
 *     none imports `@openmig/scheduler/pg-boss` but for its types, which Node
 *     erases; the one dynamic import of it is `job-runner.ts`'s, on the
 *     pg-boss branch. That is what keeps half 1 true of a route no test here
 *     reaches.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { code, sourceFiles } from './__tests__/doors-that-start-work.ts';

const SRC = import.meta.dirname;
const REPO = join(SRC, '..', '..', '..');

/** pg-boss's package, wherever pnpm put it, and the runner's module in this repository. */
const PG_BOSS_PACKAGE = /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?pg-boss\//;
const RUNNER_MODULE = /\/packages\/scheduler\/src\/pg-boss\//;

/**
 * Run `body` (an ES module's text, which may `await`) in a child Node process
 * whose every resolved module URL is recorded; returns those URLs and what the
 * body put in `said`.
 */
function loadInAChild(body: string, env: Record<string, string>): { urls: string[]; said: string } {
  const program = `
    import { registerHooks } from 'node:module';
    const seen = new Set();
    registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context); seen.add(r.url); return r; } });
    const at = (rel) => new URL(rel, ${JSON.stringify(pathToFileURL(`${REPO}/`).href)}).href;
    let said = '';
    ${body}
    // To a file: a pipe may still be draining when the process exits.
    (await import('node:fs')).writeFileSync(process.env.LOADED_TO, JSON.stringify({ urls: [...seen], said }));
    process.exit(0);
  `;
  const keep = ['PATH', 'HOME', 'TMPDIR'].flatMap((k) => (process.env[k] ? [[k, process.env[k]!] as const] : []));
  const out = join(mkdtempSync(join(tmpdir(), 'api-loads-')), 'loaded.json');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    cwd: REPO,
    env: { ...Object.fromEntries(keep), NODE_ENV: 'test', ...env, LOADED_TO: out },
    encoding: 'utf8',
    timeout: 120_000,
  });
  expect(child.status, `the child said:\n${child.stderr}`).toBe(0);
  try {
    return JSON.parse(readFileSync(out, 'utf8')) as { urls: string[]; said: string };
  } finally {
    rmSync(dirname(out), { recursive: true, force: true });
  }
}

describe('1. loaded: the API as its image runs it, in trigger mode', () => {
  it('index.ts (every router) and the operator’s script resolve no pg-boss module, and readiness is off', () => {
    const { urls, said } = loadInAChild(
      `
      await import(at('apps/api/src/index.ts'));
      await import(at('apps/api/src/scripts/operator.ts'));
      const { schedulerReadiness } = await import(at('apps/api/src/routes/ready.ts'));
      const { jobRunner } = await import(at('apps/api/src/job-runner.ts'));
      said = jobRunner() + ' ' + JSON.stringify(await schedulerReadiness());
      `,
      {},
    );
    expect(said).toBe('trigger {"scheduler":"off"}');
    // It loaded the API, through the packages, and the SDK it does use.
    expect(urls.length).toBeGreaterThan(500);
    expect(urls.some((u) => u.endsWith('/apps/api/src/routes/migrations/index.ts'))).toBe(true);
    expect(urls.some((u) => /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?@trigger\.dev\/sdk\//.test(u))).toBe(true);
    expect(urls.filter((u) => PG_BOSS_PACKAGE.test(u) || RUNNER_MODULE.test(u))).toEqual([]);
  });

  it('the control: on pg-boss, asking for the producer resolves both, so the hook would have seen them', () => {
    const { urls, said } = loadInAChild(
      `
      const { pgBossProducer } = await import(at('apps/api/src/job-runner.ts'));
      // Nothing listens on port 1: the start fails, after the modules are loaded.
      said = await pgBossProducer().then(() => 'started', (e) => e.code ?? e.message);
      `,
      { OWNPACE_JOB_RUNNER: 'pg-boss', JOBS_DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none' },
    );
    expect(said).not.toBe('started');
    expect(urls.some((u) => PG_BOSS_PACKAGE.test(u))).toBe(true);
    expect(urls.some((u) => RUNNER_MODULE.test(u))).toBe(true);
  });
});

describe('2. written: who may import the runner', () => {
  const files = () => sourceFiles(SRC).map((f) => [relative(SRC, f), code(f)] as const);

  it('no shipped file imports pg-boss itself', () => {
    const offenders = files()
      .filter(([, text]) => /(?:from\s+|import\s*\(\s*)['"]pg-boss['"]/.test(text))
      .map(([rel]) => rel);
    expect(offenders).toEqual([]);
  });

  it('@openmig/scheduler/pg-boss is imported for its types only, and loaded only by job-runner.ts', () => {
    const valueImports: string[] = [];
    const dynamicImports: string[] = [];
    for (const [rel, text] of files()) {
      for (const m of text.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+['"]@openmig\/scheduler\/pg-boss['"]/gm)) {
        if (!m[1]) valueImports.push(rel);
      }
      if (/\bexport\s[^;]*from\s+['"]@openmig\/scheduler\/pg-boss['"]/.test(text)) valueImports.push(`${rel} (re-export)`);
      if (/import\s*\(\s*['"]@openmig\/scheduler\/pg-boss['"]\s*\)/.test(text)) dynamicImports.push(rel);
    }
    // The operator's own producer (workplan 0167 T7): scripts/operator-jobs.ts
    // value-imports the runner, and is itself loaded only by a dynamic import,
    // from operator.ts for `jobs` and from operator-close.ts for the close's
    // cancel on pg-boss; the second half above runs operator.ts whole and sees
    // no pg-boss module. a-hold-that-holds-every-door holds the rest.
    const OPERATOR_FILE = 'scripts/operator-jobs.ts';
    expect(valueImports).toEqual([OPERATOR_FILE]);
    for (const [rel, text] of files()) {
      if (rel === OPERATOR_FILE) continue;
      expect(text, `${rel} imports operator-jobs.ts statically`).not.toMatch(/^\s*import\s[^;]*from\s+['"]\.\/operator-jobs(\.ts)?['"]/m);
    }
    expect(dynamicImports).toEqual(['job-runner.ts']);
  });
});
