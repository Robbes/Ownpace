// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The cutover job body, driven against a real ledger.
 *
 * `prepareCutover` is the extracted body of the `run-cutover` Trigger.dev task.
 * It was previously inlined in the task's `run`, which made it untestable — and
 * it showed: the job walked READY_FOR_CUTOVER -> CUTOVER_IN_PROGRESS ->
 * COMPLETED with no approval anywhere, under a comment reading "in real
 * implementation, this would be a manual step". That is an approval bypass
 * (hard rule 2, arch doc §11.2), and the state machine rejects the first step of
 * it, so the job could never have succeeded either.
 *
 * These tests pin the contract: the job prepares and verifies, and stops.
 *
 * UUID Family: 7a120000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, CutoverStore } from '@openmig/ledger';
import type { VerificationResult } from '@openmig/core';
import { prepareCutover } from './run-cutover.ts';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const P = '7a120000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const CONN = `${P}c1`;
const BOX_A = `${P}b1`;
const BOX_B = `${P}b2`;
const MAPPING = `${P}d1`;

/** A verification result shaped like the real one, with the verdict we want. */
function verdict(overallStatus: 'PASS' | 'WARNING' | 'FAIL'): VerificationResult {
  const canProceed = overallStatus !== 'FAIL';
  return {
    overallStatus,
    canProceedToCutover: canProceed,
    score: canProceed ? 1 : 0,
    totalItemsSource: 10,
    totalItemsTarget: canProceed ? 10 : 4,
    totalDiscrepancies: canProceed ? 0 : 6,
    recommendations: canProceed ? [] : ['6 items are missing on the target'],
  } as unknown as VerificationResult;
}

describe('prepareCutover (integration)', () => {
  let db: ReturnType<typeof createPgDb>;
  let cutoverStore: CutoverStore;
  const logs: string[] = [];

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    cutoverStore = new CutoverStore(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Cutover Prep', 'active')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${CONN}, ${TENANT}, 'source', 'o365', 'src', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, kind, external_id)
      VALUES (${BOX_A}, ${TENANT}, ${CONN}, 'user', 'a'),
             (${BOX_B}, ${TENANT}, ${CONN}, 'user', 'b')
      ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${MAPPING}, ${TENANT}, ${BOX_A}, ${BOX_B}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING`);
  });

  beforeEach(async () => {
    logs.length = 0;
    await db.execute(sql`DELETE FROM cutover_event WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM cutover_state WHERE tenant_id = ${TENANT}`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM cutover_event WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM cutover_state WHERE tenant_id = ${TENANT}`);
  });

  function deps(overrides: Partial<Parameters<typeof prepareCutover>[0]> = {}) {
    return {
      tenantId: TENANT,
      mappingId: MAPPING,
      cutoverStore,
      log: (m: string) => logs.push(m),
      runFinalSync: async () => ({ created: 3, skipped: 7 }),
      runGate: async () => verdict('PASS'),
      ...overrides,
    } as Parameters<typeof prepareCutover>[0];
  }

  it('stops at READY_FOR_CUTOVER on a passing gate — it never completes the cutover', async () => {
    const result = await prepareCutover(deps());

    expect(result.ready).toBe(true);
    expect(result.state).toBe('READY_FOR_CUTOVER');
    expect(result.verification?.overallStatus).toBe('PASS');

    // The load-bearing assertion. The old job went on to CUTOVER_IN_PROGRESS and
    // COMPLETED from here, with no approval in between.
    const persisted = await cutoverStore.loadCutoverState(TENANT as never, MAPPING as never);
    expect(persisted?.currentState).toBe('READY_FOR_CUTOVER');

    const events = await cutoverStore.getEventHistory(TENANT as never, MAPPING as never, 20);
    const states = events.map((e) => e.toState);
    expect(states).not.toContain('CUTOVER_IN_PROGRESS');
    expect(states).not.toContain('COMPLETED');
  });

  it('runs the final sync before the gate and reports both', async () => {
    const order: string[] = [];
    const result = await prepareCutover(
      deps({
        runFinalSync: async () => {
          order.push('sync');
          return { created: 3, skipped: 7 };
        },
        runGate: async () => {
          order.push('gate');
          return verdict('PASS');
        },
      }),
    );

    expect(order).toEqual(['sync', 'gate']);
    expect(result.finalSync).toEqual({ created: 3, skipped: 7 });
  });

  it('throws on a FAILing gate and does not reach READY_FOR_CUTOVER', async () => {
    await expect(
      prepareCutover(deps({ runGate: async () => verdict('FAIL') })),
    ).rejects.toThrow(/Cutover verification failed/);

    const persisted = await cutoverStore.loadCutoverState(TENANT as never, MAPPING as never);
    expect(persisted?.currentState).toBe('PREPARING');
  });

  it('blocks on canProceedToCutover=false even when the status is not FAIL', async () => {
    const warned = { ...verdict('WARNING'), canProceedToCutover: false } as VerificationResult;

    await expect(prepareCutover(deps({ runGate: async () => warned }))).rejects.toThrow(
      /Cutover verification failed/,
    );
  });

  it('says so out loud when verification is skipped, and never calls it verified', async () => {
    const result = await prepareCutover(deps({ runGate: undefined }));

    expect(result.verification).toBeUndefined();
    expect(logs.join('\n')).toMatch(/Verification SKIPPED[^\n]*has NOT been verified/);
  });

  it('re-running on an APPROVED cutover revokes the approval through the state machine', async () => {
    await prepareCutover(deps());
    await cutoverStore.transitionState(TENANT as never, MAPPING as never, 'APPROVED', {
      approvedBy: 'operator',
    });

    // Re-preparing re-syncs and re-verifies, so the earlier approval no longer
    // describes the data that was approved — dropping back to READY_FOR_CUTOVER
    // is right. What matters is that it happens as a validated, recorded
    // APPROVED -> READY_FOR_CUTOVER transition. The old code reached the same
    // place by upserting PREPARING straight over APPROVED inside
    // initializeCutover: no validation, and logged only as "cutover
    // initialized", so the audit trail never showed an approval being revoked.
    const again = await prepareCutover(deps());
    expect(again.state).toBe('READY_FOR_CUTOVER');

    const events = await cutoverStore.getEventHistory(TENANT as never, MAPPING as never, 20);
    const transitions = events.map((e) => `${e.fromState ?? '-'}->${e.toState}`);
    expect(transitions).toContain('APPROVED->READY_FOR_CUTOVER');
    // Never silently rewound to the start.
    expect(transitions).not.toContain('APPROVED->PREPARING');
  });
});
