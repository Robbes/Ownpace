// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// `operator.sh links`, RUN (workplan 0108 T8 (d)): against a real Postgres
// with both chains applied, over a connection that is not `app_user`, as the
// operator's owner connection is.
//
// What it must do, and what "reported success" would not prove:
//   - set the organisation's number, and write an audit row saying so in the
//     same transaction;
//   - set it again over the old one, and clear it, each written down too;
//   - clear nothing, and write nothing, when nothing was set;
//   - refuse an id that names no organisation, writing nothing at all.
//
// UUID Family: 7c1c0000-e29b-41d4-a716-44665544xxxx

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import {
  ALLOWANCE_CLEARED_ACTION,
  ALLOWANCE_SET_ACTION,
  runLinksCommand,
} from './operator-links.ts';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const TENANT = '7c1c0000-e29b-41d4-a716-446655440001';
const NOBODY = '7c1c0000-e29b-41d4-a716-446655440099';
const BY = 'operator.sh it@test';
const NOW = new Date();

let pool: Pool;

async function clean(): Promise<void> {
  await pool.query('DELETE FROM grant_link_allowance WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
}

const audit = async () =>
  (
    await pool.query(
      `SELECT actor, action, entity, detail FROM audit_log WHERE tenant_id = $1 ORDER BY at, action`,
      [TENANT],
    )
  ).rows;

beforeAll(async () => {
  pool = new Pool({ connectionString: PG, max: 2 });
  await clean();
  await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, 'Example Works BV')`, [TENANT]);
});

afterAll(async () => {
  await clean();
  await pool.end();
});

describe('operator.sh links, on a real database', () => {
  it('shows an organisation that has run nothing on Tiny, and writes nothing', async () => {
    const got = await runLinksCommand(pool, { kind: 'show', tenantId: TENANT }, BY, NOW);

    expect(got).toMatchObject({ name: 'Example Works BV', live: 0, limit: { limit: 1, from: { kind: 'tier' } } });
    expect(await audit()).toEqual([]);
  });

  it('sets a number through a day, and writes it down in the same transaction', async () => {
    const until = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);

    const got = await runLinksCommand(
      pool,
      { kind: 'set', tenantId: TENANT, liveLinks: 30, until, note: 'an onboarding week' },
      BY,
      NOW,
    );

    expect(got.limit).toEqual({ limit: 30, from: { kind: 'override', until } });
    expect(got.tierLimit.limit).toBe(1);
    expect(got.allowance).toMatchObject({ liveLinks: 30, setBy: BY, note: 'an onboarding week' });
    expect(await audit()).toEqual([
      {
        actor: 'operator',
        action: ALLOWANCE_SET_ACTION,
        entity: 'tenant',
        detail: { liveLinks: 30, until: until.toISOString() },
      },
    ]);
  });

  it('sets it again over the old one, and clears it, each written down', async () => {
    await runLinksCommand(pool, { kind: 'set', tenantId: TENANT, liveLinks: 5, until: null, note: null }, BY, NOW);
    const cleared = await runLinksCommand(pool, { kind: 'clear', tenantId: TENANT }, BY, NOW);

    expect(cleared.allowance).toBeUndefined();
    expect(cleared.limit.limit).toBe(1);
    const actions = (await audit()).map((r) => [r.action, r.detail]);
    expect(actions.slice(-2)).toEqual([
      [ALLOWANCE_SET_ACTION, { liveLinks: 5, until: null }],
      [ALLOWANCE_CLEARED_ACTION, { liveLinks: 5 }],
    ]);
  });

  it('clears nothing, and writes nothing, when nothing was set', async () => {
    const before = (await audit()).length;

    await runLinksCommand(pool, { kind: 'clear', tenantId: TENANT }, BY, NOW);

    expect(await audit()).toHaveLength(before);
  });

  it('refuses an id that names no organisation, writing nothing at all', async () => {
    await expect(
      runLinksCommand(pool, { kind: 'set', tenantId: NOBODY, liveLinks: 9, until: null, note: null }, BY, NOW),
    ).rejects.toThrow(/No organisation 7c1c0000-e29b-41d4-a716-446655440099/);

    const { rows } = await pool.query('SELECT 1 FROM grant_link_allowance WHERE tenant_id = $1', [NOBODY]);
    expect(rows).toEqual([]);
  });
});
