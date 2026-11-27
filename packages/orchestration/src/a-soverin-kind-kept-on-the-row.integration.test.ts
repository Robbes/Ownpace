// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SOVERIN ROW'S KIND, KEPT ON THE ROW BY ITS NEXT PASS (workplan 0175 D6 (a), T8).
 *
 * The SQL that keeps the measured kind beside the faces a Test measured, run
 * against a real Postgres under row security: written once onto a record that
 * has no kind, never over one that has, never onto a row never tested, and
 * never onto another organisation's row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import type { SoverinRecord } from '@openmig/shared';
import { rememberSoverinKind } from './soverin-pass.ts';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

// UUID family 01750db0-…, unused elsewhere in the repo.
const TENANT = '01750db0-e29b-41d4-a716-446655440001';
const OTHER_TENANT = '01750db0-e29b-41d4-a716-446655440002';
const TESTED = '01750db0-e29b-41d4-a716-446655440011';
const UNTESTED = '01750db0-e29b-41d4-a716-446655440012';
const THEIRS = '01750db0-e29b-41d4-a716-446655440013';

const FACES = { domains: { calendar: { answer: 'yes', detail: '1 calendar visible.' } } };
const PERSONAL: SoverinRecord = {
  kind: 'personal',
  davRoot: 'https://caldav.soverin.net:443/',
  principal: '/principals/mailbox/',
  measuredAt: '2026-11-27T10:00:00.000Z',
};

describe("a Soverin row's kind, kept on the row", () => {
  let pool: Pool;
  const qualificationOf = async (id: string) =>
    (await pool.query('SELECT qualification FROM connection WHERE id = $1', [id])).rows[0]?.qualification as unknown;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    for (const [id, name] of [
      [TENANT, 'soverin-kind'],
      [OTHER_TENANT, 'soverin-kind-other'],
    ]) {
      await pool.query('INSERT INTO tenant (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [id, name]);
    }
    const row = (id: string, tenant: string, qualification: unknown) =>
      pool.query(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, qualification)
         VALUES ($1, $2, 'target', 'soverin', 'Soverin', '{"host":"caldav.soverin.net"}'::jsonb, 'connected', $3)
         ON CONFLICT (id) DO UPDATE SET qualification = EXCLUDED.qualification`,
        [id, tenant, qualification === null ? null : JSON.stringify(qualification)],
      );
    await row(TESTED, TENANT, FACES);
    await row(UNTESTED, TENANT, null);
    await row(THEIRS, OTHER_TENANT, FACES);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM connection WHERE id IN ($1, $2, $3)', [TESTED, UNTESTED, THEIRS]);
    await pool.query('DELETE FROM tenant WHERE id IN ($1, $2)', [TENANT, OTHER_TENANT]);
    await pool.end();
  });

  it('is written once beside the faces a Test measured, and never over a kind already kept', async () => {
    await rememberSoverinKind(pool, TENANT, TESTED, PERSONAL);
    expect(await qualificationOf(TESTED)).toEqual({ ...FACES, soverin: PERSONAL });

    const later: SoverinRecord = { kind: 'unknown', reason: 'x', measuredAt: '2026-11-28T10:00:00.000Z' };
    await rememberSoverinKind(pool, TENANT, TESTED, later);
    expect(await qualificationOf(TESTED)).toEqual({ ...FACES, soverin: PERSONAL });
  });

  it('is not written onto a row never tested, which has nothing for it to sit beside', async () => {
    await rememberSoverinKind(pool, TENANT, UNTESTED, PERSONAL);
    expect(await qualificationOf(UNTESTED)).toBeNull();
  });

  it("is not written onto another organisation's row", async () => {
    await rememberSoverinKind(pool, TENANT, THEIRS, PERSONAL);
    expect(await qualificationOf(THEIRS)).toEqual(FACES);
  });
});
