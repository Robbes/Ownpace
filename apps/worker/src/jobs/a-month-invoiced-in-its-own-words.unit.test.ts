// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MONTH INVOICED IN ITS OWN WORDS (workplan 0111, slice 4): the wiring half
 * of `managed-month-invoices`. The switch it reads first is
 * `whyNobodyIsInvoiced`'s (billing-from.unit.test.ts).
 *
 *  - one organisation's month, in its own scope, as the hourly run asks it
 *    (`monthOfOrganisation`): the line in the language its notification
 *    settings name, English where they name none, and a second run makes no
 *    second row.
 *
 * PGlite as `app_user`, both chains. The names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant, type LedgerDriver } from '@openmig/ledger';
import { PgDataAllowanceStore, runManagedMigrations } from '@openmig/managed';
import { monthOfOrganisation } from './managed-month-invoices.ts';

const OCT_1 = new Date('2026-10-01T00:23:00Z');

// UUID family 0111c000-…, unused elsewhere in the repo.
const IN_DUTCH = '0111c000-e29b-41d4-a716-446655440001';
const IN_ENGLISH = '0111c000-e29b-41d4-a716-446655440002';

describe("one organisation's month, in its own scope and language", () => {
  let driver: LedgerDriver;

  async function owner(statement: string, params: unknown[] = []): Promise<void> {
    const conn = await driver.acquire();
    try {
      await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  const linesOf = (tenantId: string) =>
    withTenant(driver, tenantId, async (db) =>
      ((await db.execute(sql`SELECT lines FROM invoice WHERE tenant_id = ${tenantId}`)) as unknown as {
        rows: { lines: unknown }[];
      }).rows.map((r) => r.lines),
    );

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(
      `INSERT INTO tenant (id, name, settings) VALUES
         ($1, 'In het Nederlands BV', '{"notifications": {"digest": "daily", "locale": "nl"}}'::jsonb),
         ($2, 'In English Ltd', '{}'::jsonb)`,
      [IN_DUTCH, IN_ENGLISH],
    );
    for (const tenantId of [IN_DUTCH, IN_ENGLISH]) {
      // Past Free's 150 GB, counted, with a yes to Small at €5.
      await owner(`INSERT INTO bytes_moved (tenant_id, bytes, alpha_bytes) VALUES ($1, $2, 0)`, [
        tenantId,
        String(200_000_000_000n),
      ]);
      await withTenant(driver, tenantId, (db) =>
        new PgDataAllowanceStore(db).record(
          tenantId as never,
          { kind: 'tier', tierId: 'small', bandGb: 500, priceEur: 5 },
          'someone@example.invalid',
        ),
      );
    }
    await owner(`UPDATE data_allowance SET consented_at = '2026-09-20T10:00:00Z'`);
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('says the line in the language its settings name', async () => {
    const outcome = await monthOfOrganisation(driver as unknown as Pool, IN_DUTCH, OCT_1);
    expect(outcome).toMatchObject({ kind: 'made', tier: 'small', cents: 500 });
    expect(await linesOf(IN_DUTCH)).toEqual([
      [{ description: 'Ownpace Small, oktober 2026: 200 GB gemigreerd in totaal', publishedCents: 500 }],
    ]);
  });

  it('says it in English where they name none', async () => {
    await monthOfOrganisation(driver as unknown as Pool, IN_ENGLISH, OCT_1);
    expect(await linesOf(IN_ENGLISH)).toEqual([
      [{ description: 'Ownpace Small, October 2026: 200 GB migrated in total', publishedCents: 500 }],
    ]);
  });

  it('makes no second row on the next hour', async () => {
    const outcome = await monthOfOrganisation(driver as unknown as Pool, IN_DUTCH, new Date('2026-10-01T01:23:00Z'));
    expect(outcome).toEqual({ kind: 'in_step' });
    expect(await linesOf(IN_DUTCH)).toHaveLength(1);
  });
});
