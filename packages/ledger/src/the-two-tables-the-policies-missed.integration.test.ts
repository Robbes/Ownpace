// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The two tables the policies missed — `cutover_state` and `cutover_event`,
 * on a real Postgres, as `app_user`.
 *
 * Until migration 0055 the cutover's own ledger had a tenant_id, grants to
 * app_user, and no row security at all, while every other tenant table was
 * FORCEd. Nothing noticed because every reader was a superuser. This suite
 * is the property, asked the way `rls.integration.test.ts` asks it of the
 * other tables: with no tenant context an app_user session sees nothing
 * (fail-closed), with a context it sees its own tenant and not the other,
 * and a write for a foreign tenant is refused. And it is the proof of
 * `tenantCutoverStore`, the store the job, the rollback and the CLI now use:
 * every call inside `withTenant`, bound to one tenant, refusing another.
 *
 * UUID Family: 5c4b0000-e29b-41d4-a716-44665544xxxx
 * Runs against Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createPgDb } from './db.ts';
import { CutoverStore, tenantCutoverStore } from './cutover-store.ts';

const PG_URL = process.env.TEST_DATABASE_URL;
if (!PG_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};

const P = '5c4b0000-e29b-41d4-a716-4466554400';
const TENANT_A = `${P}01`;
const TENANT_B = `${P}02`;
const CONN_A = `${P}11`;
const CONN_B = `${P}12`;
const BOX_A = `${P}21`;
const BOX_B = `${P}22`;
const MAPPING_A = `${P}31`;
const MAPPING_B = `${P}32`;

describe('cutover_state and cutover_event carry the tenant policies (migration 0055)', () => {
  let superuser: Pool;
  let appPool: Pool;
  let seeded: CutoverStore; // the superuser's store, to put rows for two tenants in place

  beforeAll(async () => {
    superuser = new Pool({ connectionString: PG_URL });
    appPool = new Pool({ connectionString: appUserUrl(PG_URL) });
    seeded = new CutoverStore(createPgDb(PG_URL));

    for (const [tenant, conn, box, mapping, name] of [
      [TENANT_A, CONN_A, BOX_A, MAPPING_A, 'A'],
      [TENANT_B, CONN_B, BOX_B, MAPPING_B, 'B'],
    ] as const) {
      await superuser.query(
        `INSERT INTO tenant (id, name, status) VALUES ($1, $2, 'active') ON CONFLICT (id) DO NOTHING`,
        [tenant, `Policies ${name}`],
      );
      await superuser.query(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
         VALUES ($1, $2, 'source', 'o365', $3, '{}', 'connected') ON CONFLICT (id) DO NOTHING`,
        [conn, tenant, `src ${name}`],
      );
      await superuser.query(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, external_id)
         VALUES ($1, $2, $3, 'user', $4) ON CONFLICT (id) DO NOTHING`,
        [box, tenant, conn, `box-${name}`],
      );
      await superuser.query(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
         VALUES ($1, $2, $3, $3, 'mirror', 'active') ON CONFLICT (id) DO NOTHING`,
        [mapping, tenant, box],
      );
      // One cutover ledger per tenant, written by the superuser: the rows
      // whose visibility the policies decide.
      await seeded.initializeCutover({ tenantId: tenant as never, mappingId: mapping as never, startedBy: 'seed' });
    }
  });

  afterAll(async () => {
    for (const tenant of [TENANT_A, TENANT_B]) {
      await superuser.query(`DELETE FROM cutover_event WHERE tenant_id = $1`, [tenant]);
      await superuser.query(`DELETE FROM cutover_state WHERE tenant_id = $1`, [tenant]);
      await superuser.query(`DELETE FROM tenant WHERE id = $1`, [tenant]);
    }
    await appPool.end();
    await superuser.end();
  });

  it('are row-secured and FORCEd, asked of the catalogs', async () => {
    const { rows } = await superuser.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname IN ('cutover_state', 'cutover_event') ORDER BY relname`,
    );
    expect(rows).toEqual([
      { relname: 'cutover_event', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'cutover_state', relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const policies = await superuser.query<{ tablename: string; policyname: string }>(
      `SELECT tablename, policyname FROM pg_policies
        WHERE tablename IN ('cutover_state', 'cutover_event') ORDER BY tablename, policyname`,
    );
    expect(policies.rows.map((r) => `${r.tablename}.${r.policyname}`)).toEqual([
      'cutover_event.cutover_event_tenant_delete',
      'cutover_event.cutover_event_tenant_insert',
      'cutover_event.cutover_event_tenant_select',
      'cutover_event.cutover_event_tenant_update',
      'cutover_state.cutover_state_tenant_delete',
      'cutover_state.cutover_state_tenant_insert',
      'cutover_state.cutover_state_tenant_select',
      'cutover_state.cutover_state_tenant_update',
    ]);
  });

  it('show app_user NOTHING without a tenant context — fail-closed, where they used to show every tenant', async () => {
    // Two ledgers exist (seeded above). Before 0055 this counted 2.
    const states = await appPool.query(`SELECT count(*)::int AS n FROM cutover_state WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    const events = await appPool.query(`SELECT count(*)::int AS n FROM cutover_event WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    expect(states.rows[0].n).toBe(0);
    expect(events.rows[0].n).toBe(0);
  });

  it('show app_user its own tenant, and not the other, through tenantCutoverStore', async () => {
    const storeA = tenantCutoverStore(appPool, TENANT_A as never);
    const storeB = tenantCutoverStore(appPool, TENANT_B as never);

    expect((await storeA.loadCutoverState(TENANT_A as never, MAPPING_A as never))?.currentState).toBe('PREPARING');
    expect((await storeB.loadCutoverState(TENANT_B as never, MAPPING_B as never))?.currentState).toBe('PREPARING');
    expect((await storeA.getEventHistory(TENANT_A as never, MAPPING_A as never)).map((e) => e.toState)).toEqual(['PREPARING']);

    // The other tenant's mapping id, asked under A's context: nothing, not
    // an error — the policy filters, it does not raise.
    expect(await storeA.loadCutoverState(TENANT_A as never, MAPPING_B as never)).toBeUndefined();
    expect(await storeA.getEventHistory(TENANT_A as never, MAPPING_B as never)).toEqual([]);
  });

  it('write through the policy: a transition under the tenant context lands, in one transaction', async () => {
    const storeA = tenantCutoverStore(appPool, TENANT_A as never);

    const ready = await storeA.transitionState(TENANT_A as never, MAPPING_A as never, 'READY_FOR_CUTOVER', { by: 'app_user' });

    expect(ready.currentState).toBe('READY_FOR_CUTOVER');
    // Both halves of the write — the event and the row — are visible to the
    // superuser, i.e. really committed under app_user's context.
    const events = await seeded.getEventHistory(TENANT_A as never, MAPPING_A as never);
    expect(events.map((e) => e.toState)).toEqual(['PREPARING', 'READY_FOR_CUTOVER']);
    expect((await seeded.loadCutoverState(TENANT_A as never, MAPPING_A as never))?.currentState).toBe('READY_FOR_CUTOVER');
  });

  it("refuses a write for a foreign tenant: the store is bound before any query, and the policy's WITH CHECK is behind it", async () => {
    const storeA = tenantCutoverStore(appPool, TENANT_A as never);

    // The store's own refusal — no query is made.
    await expect(
      storeA.initializeCutover({ tenantId: TENANT_B as never, mappingId: MAPPING_B as never, startedBy: 'A' }),
    ).rejects.toThrow(/bound to tenant/);

    // And the policy's, for a caller that bypasses the store: an INSERT for
    // tenant B under A's context is refused by WITH CHECK.
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT_A]);
      await expect(
        client.query(
          `INSERT INTO cutover_event (id, tenant_id, mapping_id, timestamp, from_state, to_state, triggered_by, event_type)
           VALUES (gen_random_uuid(), $1, $2, now(), NULL, 'PREPARING', 'intruder', 'CUTOVER_INITIALIZED')`,
          [TENANT_B, MAPPING_B],
        ),
      ).rejects.toThrow(/row-level security policy/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    // Nothing landed for B.
    expect((await seeded.getEventHistory(TENANT_B as never, MAPPING_B as never)).map((e) => e.triggeredBy)).toEqual(['seed']);
  });

  it('the superuser store still sees both — which is why nothing ever noticed', async () => {
    expect((await seeded.loadCutoverState(TENANT_A as never, MAPPING_A as never))?.tenantId).toBe(TENANT_A);
    expect((await seeded.loadCutoverState(TENANT_B as never, MAPPING_B as never))?.tenantId).toBe(TENANT_B);
  });
});
