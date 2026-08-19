// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * CutoverStore against a real Postgres.
 *
 * The cutover subsystem had never been executed — there is no test that drives
 * CutoverStore against a database, and the tests that exist cover the pure state
 * machine in @openmig/core. Three defects lived in that gap, each measured here:
 *
 *  1. `saveCutoverState` inserted `id: status.tenantId` while `cutover_state.id`
 *     is the PRIMARY KEY and the upsert arbiter is (tenant_id, mapping_id). The
 *     SECOND mapping in a tenant therefore died on "duplicate key value violates
 *     unique constraint cutover_state_pkey" — a tenant could hold exactly one
 *     cutover, ever.
 *  2. `initializeCutover` unconditionally upserted `state: PREPARING`, so asking
 *     to start a cutover on an APPROVED mapping silently revoked the approval,
 *     bypassing `transitionState`'s validation entirely (hard rule 2).
 *  3. `READY_FOR_CUTOVER → CUTOVER_IN_PROGRESS` is rejected by the state machine
 *     (the approval gate). run-cutover.ts performed exactly that transition, so
 *     the managed cutover job could never have completed.
 *
 * UUID Family: 7a110000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb } from './db.ts';
import { CutoverStore } from './cutover-store.ts';
import type { TenantId, MappingId } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const P = '7a110000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01` as TenantId;
const CONN = `${P}c1`;
const BOX_A = `${P}b1`;
const BOX_B = `${P}b2`;
const MAPPING_A = `${P}d1` as MappingId;
const MAPPING_B = `${P}d2` as MappingId;

describe('CutoverStore (integration)', () => {
  let db: ReturnType<typeof createPgDb>;
  let store: CutoverStore;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    store = new CutoverStore(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status) VALUES (${TENANT}, 'Cutover Store', 'active')
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
      VALUES (${MAPPING_A}, ${TENANT}, ${BOX_A}, ${BOX_B}, 'mirror', 'active'),
             (${MAPPING_B}, ${TENANT}, ${BOX_B}, ${BOX_A}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING`);
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM cutover_event WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM cutover_state WHERE tenant_id = ${TENANT}`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM cutover_event WHERE tenant_id = ${TENANT}`);
    await db.execute(sql`DELETE FROM cutover_state WHERE tenant_id = ${TENANT}`);
  });

  it('starts a cutover for a mapping', async () => {
    const status = await store.initializeCutover({
      tenantId: TENANT,
      mappingId: MAPPING_A,
      targetMailServer: 'mail.example.com',
      startedBy: 'test',
    });

    expect(status.currentState).toBe('PREPARING');
  });

  it('starts a cutover for a SECOND mapping in the same tenant', async () => {
    // The load-bearing assertion for defect 1. Against the pre-fix code this
    // threw: duplicate key value violates unique constraint "cutover_state_pkey".
    await store.initializeCutover({ tenantId: TENANT, mappingId: MAPPING_A, startedBy: 'test' });
    const second = await store.initializeCutover({
      tenantId: TENANT,
      mappingId: MAPPING_B,
      startedBy: 'test',
    });

    expect(second.currentState).toBe('PREPARING');
    expect(second.mappingId).toBe(MAPPING_B);

    // Both rows exist independently, with distinct primary keys.
    const rows = await db.execute(
      sql`SELECT id, mapping_id FROM cutover_state WHERE tenant_id = ${TENANT} ORDER BY mapping_id`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!.id).not.toBe(rows.rows[1]!.id);
  });

  it('does not reset an APPROVED cutover when initialize is called again', async () => {
    await store.initializeCutover({ tenantId: TENANT, mappingId: MAPPING_A, startedBy: 'test' });
    await store.transitionState(TENANT, MAPPING_A, 'READY_FOR_CUTOVER', { readyAt: 'now' });
    await store.transitionState(TENANT, MAPPING_A, 'APPROVED', { approvedBy: 'operator' });

    // Re-running the cutover job calls initializeCutover again. Against the
    // pre-fix code this wrote PREPARING straight over APPROVED — an approval
    // revoked by a side effect, with no validation and no matching event.
    const reinit = await store.initializeCutover({
      tenantId: TENANT,
      mappingId: MAPPING_A,
      startedBy: 'test',
    });
    expect(reinit.currentState).toBe('APPROVED');

    const after = await store.loadCutoverState(TENANT, MAPPING_A);
    expect(after?.currentState).toBe('APPROVED');
  });

  it('rejects READY_FOR_CUTOVER -> CUTOVER_IN_PROGRESS (the approval gate)', async () => {
    await store.initializeCutover({ tenantId: TENANT, mappingId: MAPPING_A, startedBy: 'test' });
    await store.transitionState(TENANT, MAPPING_A, 'READY_FOR_CUTOVER', { readyAt: 'now' });

    // This is precisely the transition the old run-cutover.ts performed, one
    // line after reaching READY_FOR_CUTOVER, under a comment reading "in real
    // implementation, this would be a manual step". It cannot succeed.
    await expect(
      store.transitionState(TENANT, MAPPING_A, 'CUTOVER_IN_PROGRESS', { startedAt: 'now' }),
    ).rejects.toThrow(/Invalid transition from READY_FOR_CUTOVER to CUTOVER_IN_PROGRESS/);

    const after = await store.loadCutoverState(TENANT, MAPPING_A);
    expect(after?.currentState).toBe('READY_FOR_CUTOVER');
  });

  it('allows CUTOVER_IN_PROGRESS once the cutover is APPROVED', async () => {
    await store.initializeCutover({ tenantId: TENANT, mappingId: MAPPING_A, startedBy: 'test' });
    await store.transitionState(TENANT, MAPPING_A, 'READY_FOR_CUTOVER', { readyAt: 'now' });
    await store.transitionState(TENANT, MAPPING_A, 'APPROVED', { approvedBy: 'operator' });

    const inProgress = await store.transitionState(TENANT, MAPPING_A, 'CUTOVER_IN_PROGRESS', {
      startedAt: 'now',
    });
    expect(inProgress.currentState).toBe('CUTOVER_IN_PROGRESS');
  });

  it('records every transition as an event', async () => {
    await store.initializeCutover({ tenantId: TENANT, mappingId: MAPPING_A, startedBy: 'test' });
    await store.transitionState(TENANT, MAPPING_A, 'READY_FOR_CUTOVER', { readyAt: 'now' });
    await store.transitionState(TENANT, MAPPING_A, 'APPROVED', { approvedBy: 'operator' });

    const events = await store.getEventHistory(TENANT, MAPPING_A, 10);
    const transitions = events.map((e) => `${e.fromState ?? '-'}->${e.toState}`);
    expect(transitions).toContain('PREPARING->READY_FOR_CUTOVER');
    expect(transitions).toContain('READY_FOR_CUTOVER->APPROVED');
  });
});
