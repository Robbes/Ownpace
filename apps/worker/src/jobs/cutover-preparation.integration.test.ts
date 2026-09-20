// Copyright 2026 The Ownpace authors (Apache-2.0)

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
 * And that it CONVERGES. It used to call `initializeCutover` (which returns
 * the existing row) and then write READY_FOR_CUTOVER unconditionally — an
 * edge the machine does not have out of READY_FOR_CUTOVER — so the second
 * press of "prepare" on a ready cutover threw, the task marked it FAILED, and
 * every Trigger.dev retry then found FAILED, where the same write is invalid
 * too. Now it reads first and follows `prepareTransition`: a ready cutover is
 * re-verified and ready again, a failed attempt is retried, a cutover under
 * way or a closed ledger is refused with nothing written.
 *
 * UUID Family: 7a120000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, CutoverStore } from '@openmig/ledger';
import { CutoverRefused, type CutoverState, type VerificationResult } from '@openmig/core';
import { CutoverGateFailed, prepareCutover, preparationFailurePolicy } from './run-cutover.ts';

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
    expect(result.from).toBeUndefined(); // it created the ledger
    expect(result.attempt).toBe(1);

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

  it('a FAILing gate is a CutoverGateFailed — a verdict the task records once and does not retry', async () => {
    await expect(
      prepareCutover(deps({ runGate: async () => verdict('FAIL') })),
    ).rejects.toBeInstanceOf(CutoverGateFailed);
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

  /** The trail as `from->to` strings, oldest first; the initialisation reads `init->PREPARING`. */
  async function transitions(): Promise<string[]> {
    const events = await cutoverStore.getEventHistory(TENANT as never, MAPPING as never, 50);
    return events.map((e) => `${e.fromState ?? 'init'}->${e.toState}`);
  }

  /** The machine's own edges from a fresh ledger to each state. */
  const PATH_TO: Record<CutoverState, readonly CutoverState[]> = {
    PREPARING: [],
    READY_FOR_CUTOVER: ['READY_FOR_CUTOVER'],
    APPROVED: ['READY_FOR_CUTOVER', 'APPROVED'],
    CUTOVER_IN_PROGRESS: ['READY_FOR_CUTOVER', 'APPROVED', 'CUTOVER_IN_PROGRESS'],
    GRACE_PERIOD: ['READY_FOR_CUTOVER', 'APPROVED', 'CUTOVER_IN_PROGRESS', 'GRACE_PERIOD'],
    COMPLETED: ['READY_FOR_CUTOVER', 'APPROVED', 'CUTOVER_IN_PROGRESS', 'GRACE_PERIOD', 'COMPLETED'],
    ROLLED_BACK: ['READY_FOR_CUTOVER', 'APPROVED', 'CUTOVER_IN_PROGRESS', 'ROLLED_BACK'],
    FAILED: ['FAILED'],
  };

  /** Walk the ledger to `target` through the machine's own edges. */
  async function driveTo(target: CutoverState): Promise<void> {
    await cutoverStore.initializeCutover({ tenantId: TENANT as never, mappingId: MAPPING as never, startedBy: 'test' });
    for (const to of PATH_TO[target]) {
      await cutoverStore.transitionState(TENANT as never, MAPPING as never, to, { by: 'test' });
    }
  }

  describe('a second press', () => {
    it('on a READY_FOR_CUTOVER cutover re-syncs, re-verifies and lands READY again — it does not fail it', async () => {
      await prepareCutover(deps());

      // Before: initializeCutover returned the READY row untouched, the job
      // wrote READY_FOR_CUTOVER -> READY_FOR_CUTOVER (no such edge), threw, and
      // the task marked the cutover FAILED.
      const again = await prepareCutover(deps());

      expect(again.ready).toBe(true);
      expect(again.state).toBe('READY_FOR_CUTOVER');
      expect(again.from).toBe('READY_FOR_CUTOVER');
      expect(again.attempt).toBe(2);
      expect(again.finalSync).toEqual({ created: 3, skipped: 7 }); // it really re-synced
      expect(again.verification?.overallStatus).toBe('PASS'); // and really re-verified

      const persisted = await cutoverStore.loadCutoverState(TENANT as never, MAPPING as never);
      expect(persisted?.currentState).toBe('READY_FOR_CUTOVER');

      // The way back is RECORDED, then the second verification: the trail
      // shows two attempts, and no failure.
      expect(await transitions()).toEqual([
        'init->PREPARING',
        'PREPARING->READY_FOR_CUTOVER',
        'READY_FOR_CUTOVER->PREPARING',
        'PREPARING->READY_FOR_CUTOVER',
      ]);

      const events = await cutoverStore.getEventHistory(TENANT as never, MAPPING as never, 50);
      const reset = events.find((e) => e.fromState === 'READY_FOR_CUTOVER' && e.toState === 'PREPARING');
      expect(reset?.metadata).toMatchObject({ retriedBy: 'trigger-job', attempt: 2 });
      expect(reset?.reason).toMatch(/no longer describes the data/);
      const ready = events.at(-1);
      expect(ready?.metadata).toMatchObject({ verifiedBy: 'trigger-job', attempt: 2 });
    });

    it('on a READY_FOR_CUTOVER cutover whose data no longer passes lands FAILED — the second verdict is the truth', async () => {
      await prepareCutover(deps());

      await expect(
        prepareCutover(deps({ runGate: async () => verdict('FAIL') })),
      ).rejects.toBeInstanceOf(CutoverGateFailed);

      // The body leaves PREPARING; the task's catch is what writes FAILED
      // (READY_FOR_CUTOVER has been reset, so PREPARING -> FAILED is the edge).
      const persisted = await cutoverStore.loadCutoverState(TENANT as never, MAPPING as never);
      expect(persisted?.currentState).toBe('PREPARING');
      expect(await transitions()).toEqual([
        'init->PREPARING',
        'PREPARING->READY_FOR_CUTOVER',
        'READY_FOR_CUTOVER->PREPARING',
      ]);
    });

    it('retries a FAILED cutover from PREPARING, keeping the failed attempt in the trail', async () => {
      await driveTo('FAILED'); // what the task's catch leaves behind

      // Before: from FAILED the unconditional READY write was invalid too, so
      // every retry died with "Could not mark cutover FAILED" and the ledger
      // stayed FAILED for good.
      const result = await prepareCutover(deps());

      expect(result.state).toBe('READY_FOR_CUTOVER');
      expect(result.from).toBe('FAILED');
      expect(result.attempt).toBe(2);
      expect(await transitions()).toEqual([
        'init->PREPARING',
        'PREPARING->FAILED',
        'FAILED->PREPARING',
        'PREPARING->READY_FOR_CUTOVER',
      ]);
      const events = await cutoverStore.getEventHistory(TENANT as never, MAPPING as never, 50);
      const retry = events.find((e) => e.fromState === 'FAILED');
      expect(retry?.reason).toMatch(/after a failed attempt \(attempt 2\)/);
    });

    it('on a PREPARING ledger (a run that died before the catch could mark it) simply prepares', async () => {
      await driveTo('PREPARING');

      const result = await prepareCutover(deps());

      expect(result.state).toBe('READY_FOR_CUTOVER');
      expect(result.from).toBe('PREPARING');
      expect(result.attempt).toBe(1);
      expect(await transitions()).toEqual(['init->PREPARING', 'PREPARING->READY_FOR_CUTOVER']);
    });

    for (const state of ['CUTOVER_IN_PROGRESS', 'GRACE_PERIOD'] as const) {
      it(`refuses a cutover under way (${state}) — neither syncs nor verifies, and writes nothing`, async () => {
        await driveTo(state);
        const before = await transitions();
        const runFinalSync = vi.fn(async () => ({ created: 0, skipped: 0 }));
        const runGate = vi.fn(async () => verdict('PASS'));

        const failure = await prepareCutover(deps({ runFinalSync, runGate })).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(CutoverRefused);
        expect((failure as Error).message).toContain(`A cutover in ${state} is under way`);
        expect((failure as CutoverRefused).hint).toContain('rollback --yes');
        expect(runFinalSync).not.toHaveBeenCalled();
        expect(runGate).not.toHaveBeenCalled();

        const persisted = await cutoverStore.loadCutoverState(TENANT as never, MAPPING as never);
        expect(persisted?.currentState).toBe(state);
        expect(await transitions()).toEqual(before);
        expect(logs.join('\n')).toContain('Nothing was changed');
      });
    }

    it('refuses a ROLLED_BACK ledger, names the owner\'s call (0009 T8), and writes nothing', async () => {
      await driveTo('ROLLED_BACK');
      const before = await transitions();

      const failure = await prepareCutover(deps()).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(CutoverRefused);
      expect((failure as Error).message).toContain('ROLLED_BACK');
      expect((failure as CutoverRefused).hint).toContain('0009 T8');
      const persisted = await cutoverStore.loadCutoverState(TENANT as never, MAPPING as never);
      expect(persisted?.currentState).toBe('ROLLED_BACK');
      expect(await transitions()).toEqual(before);
    });

    it('refuses a COMPLETED ledger — one cutover ledger per mapping, and this one is finished', async () => {
      await driveTo('COMPLETED');
      const before = await transitions();

      const failure = await prepareCutover(deps()).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(CutoverRefused);
      expect((failure as Error).message).toContain('COMPLETED');
      expect(await transitions()).toEqual(before);
    });
  });

  describe('what the task does with each failure (preparationFailurePolicy)', () => {
    it('a refusal is neither recorded as FAILED nor retried — nothing was prepared and nothing was written', () => {
      expect(preparationFailurePolicy(new CutoverRefused('no', 'hint'))).toEqual({ recordFailed: false, retry: false });
    });

    it('a gate verdict is recorded as FAILED, once — three attempts would be told the same thing three times', () => {
      expect(preparationFailurePolicy(new CutoverGateFailed('status=FAIL'))).toEqual({ recordFailed: true, retry: false });
    });

    it('anything else is recorded as FAILED and retried — and the retry converges, since FAILED prepares again', () => {
      expect(preparationFailurePolicy(new Error('ECONNRESET'))).toEqual({ recordFailed: true, retry: true });
      expect(preparationFailurePolicy('not even an Error')).toEqual({ recordFailed: true, retry: true });
    });
  });
});
