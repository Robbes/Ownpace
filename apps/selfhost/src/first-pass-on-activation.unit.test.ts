// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Pressing start runs the first pass — it does not merely arm the cron.
 *
 * The owner's report, 2026-08-22: "I selected 15 minutes frequency, and first
 * had to wait for the first run. why not set the frequency, and do a first run
 * after the activation of the run?" That is exactly what the appliance did.
 * `scheduleMapping` handed the cron to croner, whose FIRST firing is the next
 * one the expression names, and the route answered "The migration is running"
 * on top of it. The cadence is how often a sync REPEATS; it was never how long
 * the first one is postponed.
 *
 * The proof is the schedule: `0 5 31 2 *` is a valid cron expression for the
 * 31st of February, so it never fires — anywhere. A run row after POST /start
 * therefore cannot have come from the scheduler. It can only have come from
 * the activation itself.
 *
 * The pass FAILS (the connectors point at port 1, the same honest failure
 * `runs-route.unit.test.ts` builds on) and that is fine: this file is about
 * WHEN a pass happens, not whether it succeeds.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index.ts';
import type { RunsResponse } from '@openmig/shared';

/**
 * Temp directories this file makes, and the removal that used to be missing.
 *
 * See the sweep in workplan 0099: `mkdtempSync` with no matching `rmSync`
 * leaks for the lifetime of the machine, a PGlite data directory is 41MB, and
 * the suite was measured leaking 322MB per run after quietly accumulating
 * 29GB and filling the disk of the box running it. `unit-tests` runs on the
 * SELF-HOSTED runner for pushes to main — the same Spark the managed stack
 * needs ~15GB free on.
 *
 * Registered rather than removed at each call site, so a new test here cannot
 * forget.
 */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});


const MAPPING = '11111111-1111-4111-8111-1111111111fa';

let handle: SelfhostHandle;
let base: string;

beforeAll(async () => {
  const configDir = tempDir('openmig-firstpass-cfg-');
  writeFileSync(
    join(configDir, 'mapping.json'),
    JSON.stringify({
      tenantId: '00000000-0000-4000-8000-0000000000fa',
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: {
        type: 'imap-oauth2',
        host: '127.0.0.1',
        port: 1,
        user: 'nobody@invalid',
        auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
      },
      target: {
        type: 'jmap',
        baseUrl: 'http://127.0.0.1:1',
        user: 'nobody@invalid',
        auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
      },
    }),
  );

  handle = await start({
    persistence: 'pglite',
    pgliteDataDir: tempDir('openmig-firstpass-db-'),
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
  base = `http://127.0.0.1:${handle.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.stop();
});

/**
 * Poll the run history until a pass has both STARTED and finished, or give up.
 *
 * The route deliberately does not await the kick — a pass is minutes, an HTTP
 * request is not — so the row appears asynchronously. Waiting for it to reach a
 * terminal status rather than merely to exist is also what keeps `afterAll`
 * honest: `shutdown()` stops the schedules and closes the database without
 * awaiting an in-flight pass, so a test that returns the moment the row is
 * opened would be tearing the ledger out from under a pass still writing to it.
 */
async function waitForASettledRun(timeoutMs: number): Promise<RunsResponse['runs']> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = (await (await fetch(`${base}/mappings/${MAPPING}/runs`)).json()) as RunsResponse;
    if (body.runs.length > 0 && body.runs[0]!.status !== 'running') return body.runs;
    if (Date.now() > deadline) {
      throw new Error(
        `no settled run after ${timeoutMs}ms — runs: ${JSON.stringify(body.runs)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('POST /mappings/{id}/start', () => {
  it('has not run anything before the operator presses start', async () => {
    const body = (await (await fetch(`${base}/mappings/${MAPPING}/runs`)).json()) as RunsResponse;
    expect(body.runs).toEqual([]);
  });

  it('runs the first pass at activation, on a schedule that never fires', async () => {
    const res = await fetch(`${base}/mappings/${MAPPING}/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { activated: boolean; effect: string };
    expect(body.activated).toBe(true);
    // The sentence the owner reads must be the one that is true.
    expect(body.effect).toContain('the first pass has started');

    const runs = await waitForASettledRun(45_000);
    expect(runs.length).toBe(1);
    expect(runs[0]!.startedAt).toBeTruthy();
    // It FAILED — the connectors point at port 1, the same honest failure
    // `runs-route.unit.test.ts` builds on. This file is about WHEN a pass
    // happens, and a pass that failed is still a pass that happened.
    expect(runs[0]!.status).toBe('failed');
  }, 60_000);

  it('does not start a second pass when start is pressed again', async () => {
    // The route is idempotent by contract, and a second click is not a second
    // migration. `activated: false` is what says so.
    const res = await fetch(`${base}/mappings/${MAPPING}/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { activated: boolean }).activated).toBe(false);

    await new Promise((r) => setTimeout(r, 500));
    const body = (await (await fetch(`${base}/mappings/${MAPPING}/runs`)).json()) as RunsResponse;
    expect(body.runs.length).toBe(1);
  }, 30_000);
});
