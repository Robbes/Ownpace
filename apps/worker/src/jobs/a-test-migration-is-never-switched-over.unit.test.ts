// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEST MIGRATION IS NEVER SWITCHED OVER (workplan 0162 §2 (e), T3): the
 * cutover's preparation and its gate.
 *
 *  - `prepareCutover`, the `run-cutover` job's body, refuses a test migration
 *    before anything else: no ledger is made, no final sync runs, no gate is
 *    asked, and READY_FOR_CUTOVER is never reached. It is a refusal, not a
 *    failed cutover, so the task records nothing and does not retry. The same
 *    preparation without a marker reaches READY_FOR_CUTOVER.
 *  - The gate's configuration carries the marker, so its report never clears
 *    a test for its cutover (`canProceedToCutover`, core's own test).
 *  - The marker is read from the migration's row as every gate reads it
 *    (`testMarkerOf`, over `readPathPhases`), on PGlite here.
 *  - The task, the gate, the owner's Finish check and the operator's CLI each
 *    read it and hand it on. Their bodies are read as text where no runtime
 *    reaches them, as `a-final-sync-of-every-data-type` reads them.
 *
 * UUID family 01620005-…, unused elsewhere in the repository.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { CutoverRefused, type VerificationResult } from '@openmig/core';
import { createPgliteDb, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { A_TEST_IS_NOT_SWITCHED_OVER } from '@openmig/shared';
import { finalSyncReport } from './final-sync.ts';
import { testMarkerOf, verificationConfigFor } from './cutover-gate.ts';
import { prepareCutover, preparationFailurePolicy } from './run-cutover.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const TENANT = '01620005-e29b-41d4-a716-446655440001';
const MAPPING = '01620005-e29b-41d4-a716-446655440002';
const MARKER = '[Ownpace-test]';

/** A cutover ledger in memory: the calls the preparation makes, each counted. */
function memoryLedger(initial?: string) {
  let state: string | undefined = initial;
  const calls: string[] = [];
  const store = {
    loadLedgers: async () => {
      calls.push('loadLedgers');
      return state ? [{ state }] : [];
    },
    initializeCutover: async () => {
      calls.push('initializeCutover');
      state = 'PREPARING';
      return { state, currentState: state };
    },
    loadCutoverState: async () => {
      calls.push('loadCutoverState');
      return state ? { state, currentState: state } : null;
    },
    transitionState: async (_t: unknown, _m: unknown, to: string) => {
      calls.push(`transitionState:${to}`);
      state = to;
      return { state: to, currentState: to };
    },
    getEventHistory: async () => [],
  };
  return { store, state: () => state, calls };
}

const PASSING = {
  overallStatus: 'PASS',
  canProceedToCutover: true,
  score: 1,
  totalItemsSource: 3,
  totalItemsTarget: 3,
  totalDiscrepancies: 0,
  recommendations: [],
} as unknown as VerificationResult;

function prepare(testMarker?: string, initial?: string) {
  const ledger = memoryLedger(initial);
  const logs: string[] = [];
  const runFinalSync = vi.fn(async () => finalSyncReport({ asked: ['email'], domains: { email: { created: 1, updated: 0, adopted: 0, skipped: 9 } } }));
  const runGate = vi.fn(async () => PASSING);
  const done = prepareCutover({
    tenantId: TENANT,
    mappingId: MAPPING,
    ...(testMarker !== undefined ? { testMarker } : {}),
    cutoverStore: ledger.store as unknown as Parameters<typeof prepareCutover>[0]['cutoverStore'],
    log: (line) => logs.push(line),
    runFinalSync,
    runGate,
  });
  return { done, logs, runFinalSync, runGate, ledger };
}

/** Comments are prose about code, not code (see `a-domain-the-dispatchers-forgot`). */
function code(file: string): string {
  return readFileSync(join(HERE, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe("the run-cutover job's preparation", () => {
  it('refuses a test migration before anything is read or written, and names the reason', async () => {
    const { done, logs, runFinalSync, runGate, ledger } = prepare(MARKER);
    const failure = await done.catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(CutoverRefused);
    expect((failure as Error).message).toBe(A_TEST_IS_NOT_SWITCHED_OVER.en);
    expect(logs).toEqual([`${A_TEST_IS_NOT_SWITCHED_OVER.en} Nothing was changed.`]);
    expect(runFinalSync).not.toHaveBeenCalled();
    expect(runGate).not.toHaveBeenCalled();
    expect(ledger.calls).toEqual([]);
    expect(ledger.state()).toBeUndefined();
  });

  it('records no failure for it and does not retry it: a refusal, not a failed cutover', async () => {
    const failure = await prepare(MARKER).done.catch((err: unknown) => err);
    expect(preparationFailurePolicy(failure)).toEqual({ recordFailed: false, retry: false });
  });

  it('never moves a ledger a test migration already has to READY_FOR_CUTOVER', async () => {
    const { done, ledger } = prepare(MARKER, 'PREPARING');
    await expect(done).rejects.toBeInstanceOf(CutoverRefused);
    expect(ledger.state()).toBe('PREPARING');
    expect(ledger.calls).toEqual([]);
  });

  it('prepares the same migration without a marker to READY_FOR_CUTOVER', async () => {
    const { done, runFinalSync, runGate, ledger } = prepare();
    const result = await done;

    expect(result.ready).toBe(true);
    expect(ledger.state()).toBe('READY_FOR_CUTOVER');
    expect(runFinalSync).toHaveBeenCalledOnce();
    expect(runGate).toHaveBeenCalledOnce();
  });
});

describe("the gate's configuration", () => {
  it('carries a test migration’s marker, and none for any other', () => {
    expect(verificationConfigFor(new Set(['email']), new Set(), MARKER).testMarker).toBe(MARKER);
    expect(verificationConfigFor(new Set(['email']), new Set())).not.toHaveProperty('testMarker');
    expect(verificationConfigFor(new Set(['email']))).not.toHaveProperty('testMarker');
  });
});

describe("the marker, read from the migration's row", () => {
  let driver: LedgerDriver;
  const PLAIN = '01620005-e29b-41d4-a716-446655440003';
  const GONE = '01620005-e29b-41d4-a716-446655440004';

  beforeAll(async () => {
    driver = (await createPgliteDb({})).driver;
    await runMigrations({ driver, logger: () => {} });
    const conn = await driver.acquire();
    try {
      await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'a test organisation')`, [TENANT]);
      await conn.query(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name)
         VALUES ('01620005-e29b-41d4-a716-446655440011', $1, 'source', 'imap', 'source')`,
        [TENANT],
      );
      await conn.query(
        `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind)
         VALUES ('01620005-e29b-41d4-a716-446655440021', $1, '01620005-e29b-41d4-a716-446655440011', 'owner', 'user')`,
        [TENANT],
      );
      for (const [id, marker] of [
        [MAPPING, MARKER],
        [PLAIN, null],
      ] as const) {
        // A prefix of its own, so two migrations from one mailbox are allowed.
        await conn.query(
          `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_folder_prefix, test_marker)
           VALUES ($1, $2, '01620005-e29b-41d4-a716-446655440021', $3, $4)`,
          [id, TENANT, `prefix-${id}`, marker],
        );
      }
    } finally {
      conn.release();
    }
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('is the marker of a test migration, and nothing for any other or for one that is gone', async () => {
    const pool = driver as unknown as Pool;
    expect(await testMarkerOf(pool, TENANT, MAPPING)).toBe(MARKER);
    expect(await testMarkerOf(pool, TENANT, PLAIN)).toBeUndefined();
    expect(await testMarkerOf(pool, TENANT, GONE)).toBeUndefined();
  });
});

describe('the doors that read it, read as text', () => {
  it('the task reads the marker from the row and hands it to the preparation', () => {
    const cutover = code('run-cutover.ts');
    expect(cutover).toContain('const testMarker = await testMarkerOf(pool, tenantId, mappingId);');
    expect(cutover).toContain('...(testMarker !== undefined ? { testMarker } : {}),');
  });

  it('the gate and the owner’s Finish check hand it to the configuration', () => {
    const gate = code('cutover-gate.ts');
    expect(gate).toContain('const testMarker = await testMarkerOf(pool, tenantId, mappingId);');
    expect(gate).toContain('config: verificationConfigFor(selected, stopped, testMarker)');
    const check = code('run-verification.ts');
    expect(check).toContain('const testMarker = await testMarkerOf(pool, tenantId, mappingId);');
    expect(check).toContain('config: verificationConfigFor(enabled, stopped, testMarker)');
  });

  it("the operator's CLI reads it and hands it to approve, execute and complete", () => {
    const cli = code('../cli/index.ts');
    expect(cli).toContain('const testMarker = await testMarkerOf(pool, tenantId, mappingId);');
    expect(cli).toContain('...(testMarker !== undefined ? { testMarker } : {}),');
  });
});
