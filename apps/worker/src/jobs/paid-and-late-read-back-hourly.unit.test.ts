// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * PAID AND LATE, READ BACK EVERY HOUR (workplan 0111, slice 5f, its second
 * half): the wiring, as the hourly run asks it (`readBackFromTheBooks`), on a
 * database and a Moneybird of the test's own.
 *
 *  - one list of what the books changed in the last day, each change written
 *    in its own organisation's scope: a bank transfer seen as paid, a late
 *    invoice as overdue;
 *  - an invoice without one of our references is counted and left alone;
 *  - Moneybird unavailable reads nothing back, and the run goes on.
 *
 * PGlite as `app_user`. The names, numbers and token are invented, and
 * nothing is contacted: Moneybird here is a function.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { pgliteDriver, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations, type MoneybirdSettings } from '@openmig/managed';
import { log } from '@openmig/shared';
import { readBackFromTheBooks } from './managed-invoice-push.ts';

const ADMINISTRATION = '123456789012345678';
const SETTINGS: MoneybirdSettings = {
  apiToken: 'not-a-real-token',
  administrationId: ADMINISTRATION,
  workflowId: '702',
  taxRates: { domesticStandard: '611', reverseCharge: '622', outsideEu: null },
  delivery: 'manual',
  mollieAccountId: null,
};

// UUID family 01115f30-…, unused elsewhere in the repo.
const BY_BANK = '01115f30-e29b-41d4-a716-446655440001';
const LATE = '01115f30-e29b-41d4-a716-446655440002';
const NOW = new Date('2026-10-11T09:41:00Z');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('paid and late, read back as the hourly run reads them', () => {
  let driver: LedgerDriver;
  const pool = () => driver as unknown as Pool;

  async function owner(statement: string, params: unknown[] = []) {
    const conn = await driver.acquire();
    try {
      return await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  async function sent(tenant: string, moneybirdId: string) {
    await owner(
      `INSERT INTO invoice (tenant_id, period_start, period_end, status, subtotal, tax_rate, tax_amount, total, reference)
       VALUES ($1, '2026-10-01', '2026-10-31', 'draft', 992, 0.21, 208, 1200, $2)`,
      [tenant, `ownpace-${tenant}-m-2026-10-medium`],
    );
    await owner(
      `UPDATE invoice SET status = 'sent', invoice_number = $3, invoice_date = '2026-10-01', moneybird_id = $2,
              moneybird_administration_id = $4, sent_at = now() WHERE tenant_id = $1`,
      [tenant, moneybirdId, `2026-${moneybirdId}`, ADMINISTRATION],
    );
  }

  const statusOf = async (tenant: string) =>
    ((await owner(`SELECT status FROM invoice WHERE tenant_id = $1`, [tenant])).rows[0] as { status: string }).status;

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(`INSERT INTO tenant (id, name) VALUES ($1, 'Pays By Bank BV'), ($2, 'Pays Late BV')`, [BY_BANK, LATE]);
    await sent(BY_BANK, '901');
    await sent(LATE, '902');
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes each change in its own organisation’s scope, and leaves what is not ours alone', async () => {
    const asked: string[] = [];
    const impl = (async (url: unknown) => {
      asked.push(String(url));
      return json([
        { id: '901', reference: `ownpace-${BY_BANK}-m-2026-10-medium`, state: 'paid', paid_at: '2026-10-10' },
        { id: '902', reference: `ownpace-${LATE}-m-2026-10-medium`, state: 'late', paid_at: null },
        { id: '903', reference: 'ownpace-nightly-2026-10-10', state: 'paid', paid_at: '2026-10-10' },
      ]);
    }) as typeof fetch;

    const counts = await readBackFromTheBooks(pool(), SETTINGS, NOW, { fetchImpl: impl });
    expect(counts).toEqual({ read: true, overdue: 1, paid: 1, notOurs: 1, failed: 0 });
    expect(await statusOf(BY_BANK)).toBe('paid');
    expect(await statusOf(LATE)).toBe('overdue');
    // One question for every organisation, about the last day.
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0]!).searchParams.get('filter')).toContain('updated_after:2026-10-10T07:41:00.000Z');

    // The next hour, the same answer moves nothing.
    const again = await readBackFromTheBooks(pool(), SETTINGS, new Date(NOW.getTime() + 3_600_000), { fetchImpl: impl });
    expect(again).toEqual({ read: true, overdue: 0, paid: 0, notOurs: 1, failed: 0 });
  });

  it('reads nothing back while Moneybird is unavailable, and says so', async () => {
    const said = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const counts = await readBackFromTheBooks(pool(), SETTINGS, NOW, {
      fetchImpl: (async () => json({}, 503)) as typeof fetch,
    });
    expect(counts).toEqual({ read: false, overdue: 0, paid: 0, notOurs: 0, failed: 0 });
    expect(said.mock.calls.flat().join(' ')).toContain('paid and late not read back');
  });
});
