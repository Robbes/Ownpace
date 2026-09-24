// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// ONE ISSUE AT A TIME PER ORGANISATION (workplan 0108 T8 (d)), on a real
// Postgres with two connections: PGlite has one, and cannot show a race.
//
// An organisation on Tiny may hold one live grant link. Here the first issue
// is held open, its link written and not yet committed, while a second
// arrives. The second must wait for the per-organisation lock, then count the
// first's link and be refused. Without the lock it would count only what was
// committed, find room, and both would be the last one allowed.
//
// UUID Family: 7c1a0000-e29b-41d4-a716-44665544xxxx

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { expiryFromDays, withTenant } from '@openmig/ledger';
import { issueWithinTheLimit } from './live-link-limit.ts';

const PG = process.env.TEST_DATABASE_URL;
if (!PG) throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');

const TENANT = '7c1a0000-e29b-41d4-a716-446655440001';
const CONN = '7c1a0000-e29b-41d4-a716-446655440011';
const BOX = '7c1a0000-e29b-41d4-a716-446655440021';
const MAPPING = '7c1a0000-e29b-41d4-a716-446655440031';

let pool: Pool;

async function clean(): Promise<void> {
  await pool.query('DELETE FROM mapping_link WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM mailbox_mapping WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM mailbox WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM connection WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM tenant WHERE id = $1', [TENANT]);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: PG, max: 4 });
  await clean();
  await pool.query(`INSERT INTO tenant (id, name) VALUES ($1, 'One at a time BV')`, [TENANT]);
  await pool.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1, $2, 'source', 'gmail', 'g', '{}'::jsonb, 'connected')`,
    [CONN, TENANT],
  );
  await pool.query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1, $2, $3, 'user', 'someone@example.invalid')`,
    [BOX, TENANT, CONN],
  );
  await pool.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'paused')`,
    [MAPPING, TENANT, BOX],
  );
});

afterAll(async () => {
  await clean();
  await pool.end();
});

describe('two issues at once, for an organisation that may hold one live grant link', () => {
  it('makes the second wait for the first, count its link, and be refused', async () => {
    const input = {
      tenantId: TENANT,
      mappingId: MAPPING,
      purpose: 'grant' as const,
      createdBy: 'one-at-a-time',
      expiresAt: expiryFromDays(7),
    };
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let written!: () => void;
    const firstHasWritten = new Promise<void>((resolve) => (written = resolve));

    const first = withTenant(pool, TENANT, async (db) => {
      const outcome = await issueWithinTheLimit(db, input);
      written();
      // Its link is written, and not yet committed.
      await held;
      return outcome;
    });
    await firstHasWritten;
    let secondAnswered = false;
    const second = withTenant(pool, TENANT, (db) => issueWithinTheLimit(db, input)).finally(() => {
      secondAnswered = true;
    });

    // Long enough for a second connection to count, insert and commit, had it
    // not been waiting on the first.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(secondAnswered, 'the second issue ran while the first was still open').toBe(false);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a.kind).toBe('issued');
    expect(b).toMatchObject({ kind: 'at_the_limit', live: 1, allowed: { limit: 1 } });
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM mapping_link WHERE tenant_id = $1 AND purpose = 'grant'`,
      [TENANT],
    );
    expect(rows).toEqual([{ n: 1 }]);
  });
});
