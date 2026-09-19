// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The setback, against a real ledger (ADR-0047, workplan 0101 T5).
 *
 * 0101 found rollback implemented twice, differently, with the reachable one
 * not resuming the sync — and no gate that could drive either, because no API
 * route reaches a cutover past READY_FOR_CUTOVER and the E2E gates never run
 * the operator CLI. This is the gate: `performRollback` over the real
 * `CutoverStore` and the real `mappingLifecyclePort`, the two things the CLI
 * and the job hand it. What it proves is the whole of the definition —
 *
 *   ledger ROLLED_BACK, mapping back to `active`, the audit row that says
 *   who and from what, and NOTHING when it refuses
 *
 * — plus the read-path fix beside it: `rollbackAvailable` is the machine's
 * answer, not a constant.
 *
 * Why a database and not a fake: the mapping half is two statements in one
 * transaction (the row and its `mapping.status` record), and whether they
 * really commit together is exactly what a fake cannot say.
 *
 * UUID family: 7a160000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, CutoverStore, mappingLifecyclePort, MAPPING_STATUS_ACTION } from '@openmig/ledger';
import { performRollback, RollbackRefused } from '@openmig/core';
import { asMappingId, asTenantId } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const P = '7a160000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const CONN = `${P}c1`;
const BOX_A = `${P}b1`;
const BOX_B = `${P}b2`;
const MAPPING = `${P}d1`;
const T = asTenantId(TENANT as never);
const M = asMappingId(MAPPING as never);

describe('performRollback (integration)', () => {
  let db: ReturnType<typeof createPgDb>;
  let store: CutoverStore;
  const logs: string[] = [];

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    store = new CutoverStore(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Rollback', 'active')
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
      VALUES (${MAPPING}, ${TENANT}, ${BOX_A}, ${BOX_B}, 'mirror', 'cutover')
      ON CONFLICT (id) DO NOTHING`);
  });

  beforeEach(async () => {
    logs.length = 0;
    await db.execute(sql`DELETE FROM cutover_event WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM cutover_state WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM audit_log WHERE tenant_id = ${TENANT}`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM cutover_event WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM cutover_state WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM audit_log WHERE tenant_id = ${TENANT}`);
    await db.close();
  });

  async function setMapping(status: string) {
    await db.execute(sql`UPDATE mailbox_mapping SET status = ${status} WHERE id = ${MAPPING}`);
  }

  async function mappingStatus(): Promise<string> {
    const rows = await db.execute(sql`SELECT status FROM mailbox_mapping WHERE id = ${MAPPING}`);
    return (rows.rows[0] as { status: string }).status;
  }

  async function auditRows(): Promise<Array<Record<string, unknown>>> {
    const rows = await db.execute(
      sql`SELECT actor, detail FROM audit_log WHERE tenant_id = ${TENANT} AND action = ${MAPPING_STATUS_ACTION}`,
    );
    return rows.rows as Array<Record<string, unknown>>;
  }

  /** Walk the real state machine to `to` — no shortcut writes. */
  async function driveTo(to: 'GRACE_PERIOD' | 'READY_FOR_CUTOVER' | 'FAILED') {
    await store.initializeCutover({ tenantId: T, mappingId: M, startedBy: 'test' });
    await store.transitionState(T, M, 'READY_FOR_CUTOVER', { readyAt: new Date().toISOString() });
    if (to === 'READY_FOR_CUTOVER') return;
    await store.transitionState(T, M, 'APPROVED', { approvedBy: 'test' });
    await store.transitionState(T, M, 'CUTOVER_IN_PROGRESS', { startedAt: new Date().toISOString() });
    if (to === 'FAILED') {
      await store.transitionState(T, M, 'FAILED', { failureReason: 'DNS propagation timeout' });
      return;
    }
    await store.transitionState(T, M, 'GRACE_PERIOD', { gracePeriodStartedAt: new Date().toISOString() });
  }

  function deps(actor = 'cli', reason = 'mail bouncing') {
    return {
      tenantId: T,
      mappingId: M,
      cutoverStore: store,
      mapping: mappingLifecyclePort(db.$pool, TENANT, MAPPING, actor),
      rolledBackBy: actor,
      reason,
      log: (m: string) => logs.push(m),
    };
  }

  it('from GRACE_PERIOD: the mapping is active again, the ledger says ROLLED_BACK, and the audit row says who', async () => {
    await setMapping('cutover');
    await driveTo('GRACE_PERIOD');

    const outcome = await performRollback(deps('cli', 'mail bouncing'));

    expect(outcome).toMatchObject({
      state: 'ROLLED_BACK',
      from: 'GRACE_PERIOD',
      mapping: { from: 'cutover', to: 'active', changed: true },
    });
    // The thing the reachable rollback never did.
    expect(await mappingStatus()).toBe('active');

    // The row carries the state; the reason lives in the append-only event
    // below. `cutover_state` has no reason column and never had one — the
    // event trail is the record, and that is where the docs send you.
    const persisted = await store.loadCutoverState(T, M);
    expect(persisted?.currentState).toBe('ROLLED_BACK');

    // The record every other lifecycle write leaves (0109 T1), now this one too.
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: 'cli',
      detail: { mappingId: MAPPING, from: 'cutover', to: 'active', via: 'rollback' },
    });

    // And the cutover's own trail carries the mapping half.
    const events = await store.getEventHistory(T, M, 20);
    const rb = events.find((e) => e.toState === 'ROLLED_BACK');
    expect(rb?.fromState).toBe('GRACE_PERIOD');
    expect(rb?.reason).toBe('mail bouncing');
    expect(rb?.metadata).toMatchObject({ resumedSync: true, mappingStatus: 'active', rolledBackBy: 'cli' });
  });

  it('rollbackAvailable is read from the machine: true in GRACE_PERIOD, false once rolled back', async () => {
    // It was hardcoded `false` on every read (0101 T5's third finding).
    await setMapping('cutover');
    await driveTo('GRACE_PERIOD');
    expect((await store.loadCutoverState(T, M))?.rollbackAvailable).toBe(true);

    await performRollback(deps());

    expect((await store.loadCutoverState(T, M))?.rollbackAvailable).toBe(false);
  });

  it('from FAILED — where a propagation timeout lands — it rolls back too', async () => {
    await setMapping('cutover');
    await driveTo('FAILED');

    const outcome = await performRollback(deps());

    expect(outcome.from).toBe('FAILED');
    expect(await mappingStatus()).toBe('active');
    expect((await store.loadCutoverState(T, M))?.currentState).toBe('ROLLED_BACK');
  });

  it("a 'done' mapping is refused and NOTHING is written — not the ledger, not an audit row", async () => {
    await setMapping('done');
    await driveTo('GRACE_PERIOD');

    await expect(performRollback(deps())).rejects.toBeInstanceOf(RollbackRefused);

    expect(await mappingStatus()).toBe('done');
    expect((await store.loadCutoverState(T, M))?.currentState).toBe('GRACE_PERIOD');
    expect(await auditRows()).toEqual([]);
  });

  it('a cutover that cannot roll back is refused before the mapping is touched', async () => {
    await setMapping('cutover');
    await driveTo('READY_FOR_CUTOVER');

    await expect(performRollback(deps())).rejects.toThrow(/READY_FOR_CUTOVER cannot be rolled back/);

    expect(await mappingStatus()).toBe('cutover');
    expect(await auditRows()).toEqual([]);
  });

  it("an 'active' mapping is left alone with no audit row, and the ledger still rolls back", async () => {
    // The CLI-driven cutover never changes the mapping, so this is the common
    // case there. `from === to` is a request, not a transition: no row.
    await setMapping('active');
    await driveTo('GRACE_PERIOD');

    const outcome = await performRollback(deps());

    expect(outcome.mapping).toMatchObject({ from: 'active', to: 'active', changed: false });
    expect(await mappingStatus()).toBe('active');
    expect((await store.loadCutoverState(T, M))?.currentState).toBe('ROLLED_BACK');
    expect(await auditRows()).toEqual([]);
  });

  it("ends the continuous lane: 'continuous' comes back as 'active', recorded", async () => {
    await setMapping('continuous');
    await driveTo('GRACE_PERIOD');

    await performRollback(deps('trigger-job'));

    expect(await mappingStatus()).toBe('active');
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'trigger-job', detail: { from: 'continuous', to: 'active' } });
  });

  it('the job and the CLI hand it the same port: the row and its record commit together', async () => {
    // The port opens one transaction for the two statements. If the record
    // were written outside it, a mapping could be active with no row saying
    // who did it — the state 0109 T1 was written to end.
    await setMapping('cutover');
    await driveTo('GRACE_PERIOD');

    await performRollback(deps('cli'));

    const [row] = await auditRows();
    expect(row?.actor).toBe('cli');
    expect(await mappingStatus()).toBe('active');
  });
});
