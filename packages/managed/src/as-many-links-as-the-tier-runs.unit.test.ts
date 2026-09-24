// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AS MANY LIVE GRANT LINKS AS THE TIER RUNS MIGRATIONS (workplan 0108 T8 (d);
 * the owner, 2026-09-24: "the Recommended"): `grant-link-allowance.ts` and
 * managed migration 0028.
 *
 *  - the number is the tier's migrations at the same time, Tiny 1 to Extra
 *    large 200, and past the table the largest tier's;
 *  - the operator's number replaces it while it stands, higher or lower, and
 *    an override past its day is no override;
 *  - the tier is read as the organisation's own usage screen reads it: this
 *    month's peak, the paths holding a slot now, and the meter, writing
 *    nothing;
 *  - the organisation reads its own override and nobody else's, and nothing
 *    on the request path can write one.
 *
 * PGlite as `app_user`, both chains. The names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import { MANAGED_TIERS } from './tier-calculator.ts';
import {
  LIVE_LINKS_PAST_THE_TABLE,
  lastDayOf,
  liveGrantLinkLimit,
  liveLinkLimit,
  readGrantLinkAllowance,
} from './grant-link-allowance.ts';

// UUID family 6b6c0000-…, unused elsewhere in the repo.
const QUIET = '6b6c0000-e29b-41d4-a716-446655441001';
const BUSY = '6b6c0000-e29b-41d4-a716-446655441002';
const BURST = '6b6c0000-e29b-41d4-a716-446655441003';
const HEAVY = '6b6c0000-e29b-41d4-a716-446655441004';

const NOW = new Date('2026-09-24T12:00:00Z');
const tier = (id: string) => MANAGED_TIERS.find((t) => t.id === id)!;

let driver: LedgerDriver;

async function owner(sql: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(sql, params);
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [id, name] of [
    [QUIET, 'Quiet BV'],
    [BUSY, 'Busy BV'],
    [BURST, 'Burst BV'],
    [HEAVY, 'Heavy BV'],
  ]) {
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [id, name]);
  }
  // Five migrations at the same time this month: Medium, whose number is 20.
  await owner(
    `INSERT INTO occupancy_peak (tenant_id, month, peak_paths, peak_at)
     VALUES ($1, date_trunc('month', now())::date, 5, now())`,
    [BUSY],
  );
  // Past the data axis of the table (15 TB): "talk to us".
  await owner(`INSERT INTO bytes_moved (tenant_id, bytes) VALUES ($1, 16000000000000)`, [HEAVY]);
  await owner(
    `INSERT INTO grant_link_allowance (tenant_id, live_links, until, set_by, note)
     VALUES ($1, 30, NULL, 'operator.sh fixture', 'an onboarding week')`,
    [BURST],
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the number, from the tier and the override', () => {
  it("is the tier's migrations at the same time, Tiny 1 to Extra large 200", () => {
    expect(MANAGED_TIERS.map((t) => [t.name, liveLinkLimit(t, undefined, NOW).limit])).toEqual([
      ['Tiny', 1],
      ['Small', 4],
      ['Medium', 20],
      ['Large', 50],
      ['Extra large', 200],
    ]);
  });

  it("is the largest tier's past the end of the table", () => {
    expect(liveLinkLimit(null, undefined, NOW)).toEqual({ limit: 200, from: { kind: 'past_the_table' } });
    expect(LIVE_LINKS_PAST_THE_TABLE).toBe(200);
  });

  it("is the operator's while it stands, higher or lower than the tier's", () => {
    const until = new Date('2026-10-02T00:00:00Z');
    expect(liveLinkLimit(tier('tiny'), { liveLinks: 30, until }, NOW)).toEqual({
      limit: 30,
      from: { kind: 'override', until },
    });
    expect(liveLinkLimit(tier('large'), { liveLinks: 2, until: null }, NOW).limit).toBe(2);
  });

  it("is the tier's again the moment the override's day has passed", () => {
    const until = new Date('2026-09-24T12:00:00Z');
    expect(liveLinkLimit(tier('small'), { liveLinks: 30, until }, NOW)).toEqual({
      limit: 4,
      from: { kind: 'tier', tier: tier('small') },
    });
  });

  it('names the last day an override applies, not the moment after it', () => {
    expect(lastDayOf(new Date('2026-10-02T00:00:00Z'))).toBe('2026-10-01');
  });
});

describe('the number for an organisation, as the database has it', () => {
  it('is Tiny for an organisation nothing has run for yet', async () => {
    const got = await withTenant(driver, QUIET, (db) => liveGrantLinkLimit(db, QUIET, NOW));

    expect(got).toEqual({ limit: 1, from: { kind: 'tier', tier: tier('tiny') } });
  });

  it("follows this month's peak, as the usage screen does", async () => {
    const got = await withTenant(driver, BUSY, (db) => liveGrantLinkLimit(db, BUSY, NOW));

    expect(got).toEqual({ limit: 20, from: { kind: 'tier', tier: tier('medium') } });
  });

  it('follows the meter past the end of the table', async () => {
    const got = await withTenant(driver, HEAVY, (db) => liveGrantLinkLimit(db, HEAVY, NOW));

    expect(got).toEqual({ limit: 200, from: { kind: 'past_the_table' } });
  });

  it("is the operator's where one is set", async () => {
    const got = await withTenant(driver, BURST, (db) => liveGrantLinkLimit(db, BURST, NOW));

    expect(got).toEqual({ limit: 30, from: { kind: 'override', until: null } });
  });

  it('writes nothing while it reads the tier', async () => {
    await withTenant(driver, BUSY, (db) => liveGrantLinkLimit(db, BUSY, NOW));

    const conn = await driver.acquire();
    try {
      const peaks = await conn.query(`SELECT peak_paths FROM occupancy_peak WHERE tenant_id = $1`, [BUSY]);
      expect(peaks.rows).toEqual([{ peak_paths: 5 }]);
      const quiet = await conn.query(`SELECT 1 FROM occupancy_peak WHERE tenant_id = $1`, [QUIET]);
      expect(quiet.rows).toEqual([]);
    } finally {
      await conn.release();
    }
  });
});

describe("the operator's number, which the request path reads and never writes", () => {
  it('is read by its own organisation, and by nobody else', async () => {
    const own = await withTenant(driver, BURST, (db) => readGrantLinkAllowance(db, BURST));
    const other = await withTenant(driver, QUIET, (db) => readGrantLinkAllowance(db, BURST));

    expect(own).toMatchObject({ liveLinks: 30, until: null, setBy: 'operator.sh fixture', note: 'an onboarding week' });
    expect(other).toBeUndefined();
  });

  it('cannot be written as app_user, even for its own organisation', async () => {
    for (const statement of [
      `INSERT INTO grant_link_allowance (tenant_id, live_links, set_by) VALUES ('${QUIET}', 500, 'me')`,
      `UPDATE grant_link_allowance SET live_links = 500`,
      `DELETE FROM grant_link_allowance`,
    ]) {
      const refused = await withTenant(driver, statement.includes(QUIET) ? QUIET : BURST, (db) =>
        db.execute(statement as never),
      ).then(
        () => null,
        (e: unknown) => e as Error & { cause?: Error },
      );
      expect(`${refused?.message} ${refused?.cause?.message ?? ''}`, statement).toMatch(/permission denied/);
    }
    const still = await withTenant(driver, BURST, (db) => readGrantLinkAllowance(db, BURST));
    expect(still?.liveLinks).toBe(30);
  });

  it('refuses a number out of range, and a note too long to be one', async () => {
    for (const [links, note] of [
      [0, null],
      [1001, null],
      [5, 'x'.repeat(201)],
    ] as const) {
      await expect(
        owner(`INSERT INTO grant_link_allowance (tenant_id, live_links, set_by, note) VALUES ($1, $2, 'o', $3)`, [
          HEAVY,
          links,
          note,
        ]),
        `${links}`,
      ).rejects.toThrow(/check constraint/i);
    }
  });
});
