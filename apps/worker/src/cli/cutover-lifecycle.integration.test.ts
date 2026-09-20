// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The gate for ADR-0048 — the mapping hears the cutover — over a real ledger.
 *
 * Workplan 0101 T6 found that the CLI's `execute` moved the cutover ledger
 * and never `mailbox_mapping.status`, so a CLI-driven cutover ran with the
 * mapping `active`: passes scheduled, deletion detectors present, a source
 * that had just stopped being the authority (0117 D4) still mirrored. The E2E
 * smoke cannot reach APPROVED or GRACE_PERIOD without real DNS, so this
 * drives `enterCutover` and `closeCutover` — the same functions the CLI
 * calls — against the real state machine, the real `CutoverStore` and the
 * real `mappingLifecyclePort`, and then the rollback over the result, on
 * Postgres. Not a fake, not a stub: the row, its audit record and the ledger
 * event, in the database.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, CutoverStore, mappingLifecyclePort, MAPPING_STATUS_ACTION } from '@openmig/ledger';
import { closeCutover, CutoverRefused, enterCutover, performRollback } from '@openmig/core';
import { asMappingId, asTenantId } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const P = '7a170000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01`;
const CONN = `${P}c1`;
const BOX_A = `${P}b1`;
const BOX_B = `${P}b2`;
const MAPPING = `${P}d1`;
const T = asTenantId(TENANT as never);
const M = asMappingId(MAPPING as never);

describe('enterCutover / closeCutover (integration)', () => {
  let db: ReturnType<typeof createPgDb>;
  let store: CutoverStore;
  const logs: string[] = [];

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    store = new CutoverStore(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Cutover lifecycle', 'active')
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
      sql`SELECT actor, detail FROM audit_log WHERE tenant_id = ${TENANT} AND action = ${MAPPING_STATUS_ACTION} ORDER BY at`,
    );
    return rows.rows as Array<Record<string, unknown>>;
  }

  /** Walk the real state machine to `to` — no shortcut writes. */
  async function driveTo(to: 'READY_FOR_CUTOVER' | 'APPROVED' | 'GRACE_PERIOD') {
    await store.initializeCutover({ tenantId: T, mappingId: M, startedBy: 'test' });
    await store.transitionState(T, M, 'READY_FOR_CUTOVER', { readyAt: new Date().toISOString() });
    if (to === 'READY_FOR_CUTOVER') return;
    await store.transitionState(T, M, 'APPROVED', { approvedBy: 'test' });
    if (to === 'APPROVED') return;
    // A ledger driven past APPROVED WITHOUT `enterCutover` — the shape every
    // cutover executed before ADR-0048 left behind.
    await store.transitionState(T, M, 'CUTOVER_IN_PROGRESS', { startedAt: new Date().toISOString() });
    await store.transitionState(T, M, 'GRACE_PERIOD', { gracePeriodStartedAt: new Date().toISOString() });
  }

  function deps(actor = 'cli') {
    return {
      tenantId: T,
      mappingId: M,
      cutoverStore: store,
      mapping: mappingLifecyclePort(db.$pool, TENANT, MAPPING, actor),
      by: actor,
      log: (m: string) => logs.push(m),
    };
  }

  it("from APPROVED: the mapping is 'cutover', the ledger is CUTOVER_IN_PROGRESS, and the audit row names the door", async () => {
    await setMapping('active');
    await driveTo('APPROVED');

    const outcome = await enterCutover(deps());

    expect(outcome).toMatchObject({
      state: 'CUTOVER_IN_PROGRESS',
      from: 'APPROVED',
      mapping: { from: 'active', to: 'cutover', changed: true },
    });
    // The thing execute never did.
    expect(await mappingStatus()).toBe('cutover');
    expect((await store.loadCutoverState(T, M))?.currentState).toBe('CUTOVER_IN_PROGRESS');

    // The record every other lifecycle write leaves (0109 T1) — the row and
    // its record commit together through `withTenant`, so both are here or
    // neither is.
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: 'cli',
      detail: { mappingId: MAPPING, from: 'active', to: 'cutover', via: 'cutover' },
    });

    // And the cutover's own trail carries the mapping half.
    const events = await store.getEventHistory(T, M, 20);
    const entered = events.find((e) => e.toState === 'CUTOVER_IN_PROGRESS');
    expect(entered?.fromState).toBe('APPROVED');
    expect(entered?.metadata).toMatchObject({ stoppedSync: true, mappingStatus: 'cutover', startedBy: 'cli' });
  });

  it("stops a 'paused' mapping too, recorded from 'paused'", async () => {
    await setMapping('paused');
    await driveTo('APPROVED');

    await enterCutover(deps());

    expect(await mappingStatus()).toBe('cutover');
    expect(await auditRows()).toMatchObject([{ detail: { from: 'paused', to: 'cutover', via: 'cutover' } }]);
  });

  it("leaves 'continuous' alone with no audit row, and the ledger still enters the cutover", async () => {
    await setMapping('continuous');
    await driveTo('APPROVED');

    const outcome = await enterCutover(deps());

    expect(outcome.mapping.changed).toBe(false);
    expect(await mappingStatus()).toBe('continuous');
    expect(await auditRows()).toHaveLength(0);
    expect((await store.loadCutoverState(T, M))?.currentState).toBe('CUTOVER_IN_PROGRESS');
  });

  it('a cutover the machine does not enter from is refused before the mapping is touched', async () => {
    await setMapping('active');
    await driveTo('READY_FOR_CUTOVER');

    await expect(enterCutover(deps())).rejects.toBeInstanceOf(CutoverRefused);

    expect(await mappingStatus()).toBe('active');
    expect((await store.loadCutoverState(T, M))?.currentState).toBe('READY_FOR_CUTOVER');
    expect(await auditRows()).toHaveLength(0);
  });

  it("closing the grace window stops a mapping left 'active' by a cutover executed before ADR-0048", async () => {
    await setMapping('active');
    await driveTo('GRACE_PERIOD');

    const outcome = await closeCutover(deps());

    expect(outcome).toMatchObject({ state: 'COMPLETED', mapping: { from: 'active', to: 'cutover', changed: true } });
    expect(await mappingStatus()).toBe('cutover');
    expect((await store.loadCutoverState(T, M))?.currentState).toBe('COMPLETED');
    expect(await auditRows()).toMatchObject([{ actor: 'cli', detail: { from: 'active', to: 'cutover', via: 'cutover' } }]);
  });

  it("closing over a mapping already 'cutover' writes no audit row — a non-event is not recorded", async () => {
    await setMapping('cutover');
    await driveTo('GRACE_PERIOD');

    await closeCutover(deps());

    expect(await mappingStatus()).toBe('cutover');
    expect(await auditRows()).toHaveLength(0);
    expect((await store.loadCutoverState(T, M))?.currentState).toBe('COMPLETED');
  });

  it('the round trip that never existed: what the cutover stops, the rollback resumes — both recorded', async () => {
    await setMapping('active');
    await driveTo('APPROVED');

    await enterCutover(deps());
    expect(await mappingStatus()).toBe('cutover');
    // The operator's MX change propagated; the CLI moves the ledger on.
    await store.transitionState(T, M, 'GRACE_PERIOD', { gracePeriodStartedAt: new Date().toISOString() });

    const back = await performRollback({
      tenantId: T,
      mappingId: M,
      cutoverStore: store,
      mapping: mappingLifecyclePort(db.$pool, TENANT, MAPPING, 'cli'),
      rolledBackBy: 'cli',
      reason: 'mail bouncing',
      log: (m: string) => logs.push(m),
    });

    expect(back.mapping).toEqual({ from: 'cutover', to: 'active', changed: true });
    expect(await mappingStatus()).toBe('active');
    expect((await store.loadCutoverState(T, M))?.currentState).toBe('ROLLED_BACK');
    // Two doors, two rows, in order: who stopped it, and who put it back.
    expect(await auditRows()).toMatchObject([
      { detail: { from: 'active', to: 'cutover', via: 'cutover' } },
      { detail: { from: 'cutover', to: 'active', via: 'rollback' } },
    ]);
  });
});
