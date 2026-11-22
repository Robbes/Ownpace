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
 *  1. **Loaded.** The whole app (`index.ts`, every router) and the operator's
 *     script are imported in trigger mode, with both specifiers mocked to say
 *     so when anything loads them; a close's cancel and the scheduler's
 *     readiness are then asked. Neither is loaded.
 *  2. **Written.** No shipped file under `apps/api/src` imports `pg-boss`, and
 *     none imports `@openmig/scheduler/pg-boss` but for its types, which Node
 *     erases; the one dynamic import of it is `job-runner.ts`'s, on the
 *     pg-boss branch. That is what keeps half 1 true of a route no test here
 *     reaches.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { relative } from 'node:path';
import { code, sourceFiles } from './__tests__/doors-that-start-work.ts';

const { loaded, sdk } = vi.hoisted(() => ({
  loaded: [] as string[],
  sdk: { cancel: vi.fn(async (..._args: unknown[]) => ({})) },
}));

vi.mock('pg-boss', () => {
  loaded.push('pg-boss');
  return {};
});
vi.mock('@openmig/scheduler/pg-boss', () => {
  loaded.push('@openmig/scheduler/pg-boss');
  return {};
});
// A bare factory, as `an-organisation-the-operator-can-close` writes it.
vi.mock('@openmig/scheduler', () => ({
  getTriggerClient: () => ({ runs: { cancel: sdk.cancel }, tasks: { trigger: vi.fn() } }),
}));

const SRC = import.meta.dirname;
let saved: { runner?: string; key?: string };

beforeAll(() => {
  saved = { runner: process.env.OWNPACE_JOB_RUNNER, key: process.env.TRIGGER_SECRET_KEY };
  delete process.env.OWNPACE_JOB_RUNNER;
  delete process.env.TRIGGER_SECRET_KEY;
});

afterAll(() => {
  if (saved.runner === undefined) delete process.env.OWNPACE_JOB_RUNNER;
  else process.env.OWNPACE_JOB_RUNNER = saved.runner;
  if (saved.key === undefined) delete process.env.TRIGGER_SECRET_KEY;
  else process.env.TRIGGER_SECRET_KEY = saved.key;
});

describe('1. loaded: the app in trigger mode', () => {
  it('imports every router and the operator’s script, and neither pg-boss module is loaded', async () => {
    const { app } = await import('./index.ts');
    expect(typeof app).toBe('function');
    await import('./scripts/operator.ts');
    expect(loaded).toEqual([]);
  });

  it('a close’s cancel goes to Trigger.dev, and the readiness reads no runner, still loading neither', async () => {
    const { cancelRun, jobRunner } = await import('./job-runner.ts');
    const { schedulerReadiness } = await import('./routes/ready.ts');
    expect(jobRunner()).toBe('trigger');
    await cancelRun('run_cmabc123def456');
    expect(sdk.cancel).toHaveBeenCalledWith('run_cmabc123def456');
    expect(await schedulerReadiness()).toEqual({ scheduler: 'off' });
    expect(loaded).toEqual([]);
  });

  it('the mocks above do hear a load: the pg-boss branch loads its module', async () => {
    // Without this, a mock that never fires would pass the two tests above.
    process.env.OWNPACE_JOB_RUNNER = 'pg-boss';
    process.env.JOBS_DATABASE_URL = 'postgres://nobody@pgbouncer:6432/none';
    try {
      const { pgBossProducer } = await import('./job-runner.ts');
      // The mocked module has no producer, so the make fails, after the load.
      await expect(pgBossProducer()).rejects.toThrow();
      expect(loaded).toEqual(['@openmig/scheduler/pg-boss']);
    } finally {
      delete process.env.OWNPACE_JOB_RUNNER;
      delete process.env.JOBS_DATABASE_URL;
      loaded.length = 0;
    }
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
    expect(valueImports).toEqual([]);
    expect(dynamicImports).toEqual(['job-runner.ts']);
  });
});
