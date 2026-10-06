// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MONTH INVOICED IN ADVANCE (workplan 0111, slice 4; decision 6):
 * `month-invoice.ts`.
 *
 *  - the rule: Free makes no row; the month's first step is the tier it starts
 *    on, at its price; a move up is the difference; a second run makes no
 *    second row; a voided step is never made again and asks nothing; a tier at
 *    or below the steps changes nothing;
 *  - the price: the latest yes or pick naming the tier, else the list's;
 *  - on a real database, as the task runs it, in the organisation's own
 *    transaction as `app_user`: an organisation on Free gets nothing; one that
 *    said yes to Small and moved past Free's data gets one draft, under its
 *    reference, with the evidence and the line in its language; a second run
 *    makes nothing; a move up to Medium makes the difference, and the two add
 *    up to Medium's price; the true-up records a fleet nobody pressed
 *    anything for, so the peak the line quotes is a mark on the record; a
 *    pick says the pick, at its price; and another organisation's month is
 *    neither read nor written.
 *
 * PGlite, both chains. The names and addresses are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { DISCOVERY_DOMAINS, type TenantId } from '@openmig/shared';
import { runManagedMigrations } from './migrate-managed.ts';
import { MANAGED_TIERS, type ManagedTier } from './tier-calculator.ts';
import { PgDataAllowanceStore } from './data-ceiling.ts';
import { PgTierPickStore } from './tier-pick.ts';
import {
  decideMonthStep,
  monthReference,
  openTheMonth,
  priceOfTier,
  type MonthStep,
} from './month-invoice.ts';

const tier = (id: ManagedTier['id']): ManagedTier => MANAGED_TIERS.find((t) => t.id === id)!;
const step = (tierId: ManagedTier['id'], cents: number, status: MonthStep['status'] = 'sent'): MonthStep => ({
  tierId,
  cents,
  status,
});

describe('the rule: one step for what the month bills above its invoices', () => {
  it('makes nothing for Free', () => {
    expect(decideMonthStep(tier('free'), 0, [])).toEqual({ kind: 'free' });
  });

  it("opens the month at the tier it starts on, for that tier's price", () => {
    expect(decideMonthStep(tier('small'), 500, [])).toEqual({
      kind: 'step',
      tier: tier('small'),
      cents: 500,
      beforeCents: 0,
      after: null,
    });
  });

  it('invoices a move up for the difference, so the two add up to the tier billed', () => {
    const decision = decideMonthStep(tier('medium'), 1200, [step('small', 500)]);
    expect(decision).toEqual({ kind: 'step', tier: tier('medium'), cents: 700, beforeCents: 500, after: tier('small') });
  });

  it('makes no second row for a tier the month has an invoice for, or a lower one', () => {
    expect(decideMonthStep(tier('medium'), 1200, [step('small', 500), step('medium', 700, 'draft')])).toEqual({
      kind: 'in_step',
    });
    expect(decideMonthStep(tier('small'), 500, [step('medium', 1200)])).toEqual({ kind: 'in_step' });
  });

  it('never makes a voided step again, and counts nothing it asked', () => {
    expect(decideMonthStep(tier('small'), 500, [step('small', 500, 'void')])).toEqual({ kind: 'in_step' });
    expect(decideMonthStep(tier('medium'), 1200, [step('small', 500, 'void')])).toMatchObject({
      kind: 'step',
      cents: 1200,
      beforeCents: 0,
    });
  });

  it('makes nothing where the price asks no more than the month already does', () => {
    expect(decideMonthStep(tier('medium'), 500, [step('small', 500)])).toEqual({ kind: 'nothing_to_add' });
  });
});

describe('the price a step asks', () => {
  const at = (iso: string) => new Date(iso);

  it("is the list's for a tier never said yes to", () => {
    expect(priceOfTier(tier('medium'), [])).toEqual({ cents: 1200, from: 'list' });
    expect(priceOfTier(tier('medium'), [{ tierId: 'large', priceEur: 40, at: at('2026-09-01T00:00:00Z') }])).toEqual({
      cents: 1200,
      from: 'list',
    });
  });

  it('is the latest yes or pick naming the tier, whatever order they came in', () => {
    const agreed = [
      { tierId: 'medium', priceEur: 14, at: at('2026-10-02T00:00:00Z') },
      { tierId: 'medium', priceEur: 12, at: at('2026-09-01T00:00:00Z') },
    ];
    expect(priceOfTier(tier('medium'), agreed)).toEqual({ cents: 1400, from: 'agreed' });
  });
});

describe('the reference', () => {
  it('names the organisation, the month in UTC and the tier', () => {
    expect(monthReference('0111b000-e29b-41d4-a716-446655440001', new Date('2026-10-31T23:30:00-02:00'), 'medium')).toBe(
      'ownpace-0111b000-e29b-41d4-a716-446655440001-m-2026-11-medium',
    );
  });
});

// UUID family 0111b000-…, unused elsewhere in the repo.
const ON_FREE = '0111b000-e29b-41d4-a716-446655440001' as TenantId;
const MOVES_UP = '0111b000-e29b-41d4-a716-446655440002' as TenantId;
const STANDING_FLEET = '0111b000-e29b-41d4-a716-446655440003' as TenantId;
const PICKED_SMALL = '0111b000-e29b-41d4-a716-446655440004' as TenantId;

/** Decimal GB as the meter counts bytes. */
const GB = 1_000_000_000n;

describe('a month invoiced on a real database, as the task runs it', () => {
  let driver: LedgerDriver;
  const OCT_1 = new Date('2026-10-01T00:23:00Z');
  const OCT_3 = new Date('2026-10-03T00:23:00Z');
  const OCT_4 = new Date('2026-10-04T00:23:00Z');

  async function owner(statement: string, params: unknown[] = []): Promise<void> {
    const conn = await driver.acquire();
    try {
      await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  /** The organisation's invoices, read in its own scope. */
  const invoicesOf = (tenantId: TenantId) =>
    withTenant(driver, tenantId, async (db) => {
      const result = await db.execute(
        sql`SELECT reference, status, total::text AS total, period_start::text AS period_start,
                   period_end::text AS period_end, evidence, lines, invoice_number
              FROM invoice WHERE tenant_id = ${tenantId} ORDER BY created_at, reference`,
      );
      return (result as unknown as { rows: Record<string, unknown>[] }).rows;
    });

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(
      `INSERT INTO tenant (id, name) VALUES ($1, 'Stays Free BV'), ($2, 'Moves Up BV'), ($3, 'Standing Fleet BV'),
                                            ($4, 'Picked Small BV')`,
      [ON_FREE, MOVES_UP, STANDING_FLEET, PICKED_SMALL],
    );
    // Moves Up: past Free's 150 GB, counted (none of it the alpha's), with a yes to Small at €5.
    await owner(`INSERT INTO bytes_moved (tenant_id, bytes, alpha_bytes) VALUES ($1, $2, 0)`, [
      MOVES_UP,
      String(320n * GB),
    ]);
    await withTenant(driver, MOVES_UP, (db) =>
      new PgDataAllowanceStore(db).record(
        MOVES_UP,
        { kind: 'tier', tierId: 'small', bandGb: tier('small').dataGb, priceEur: 5 },
        'someone@example.invalid',
      ),
    );
    await owner(`UPDATE data_allowance SET consented_at = '2026-09-20T10:00:00Z' WHERE tenant_id = $1`, [MOVES_UP]);
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it('makes nothing for an organisation the month bills as Free', async () => {
    const outcome = await withTenant(driver, ON_FREE, (db) => openTheMonth(db, ON_FREE, OCT_1, 'nl'));
    expect(outcome).toEqual({ kind: 'free' });
    expect(await invoicesOf(ON_FREE)).toEqual([]);
  });

  it("opens the month with one draft for the tier it starts on, at the agreed price, in the organisation's language", async () => {
    const outcome = await withTenant(driver, MOVES_UP, (db) => openTheMonth(db, MOVES_UP, OCT_1, 'nl'));
    const reference = `ownpace-${MOVES_UP}-m-2026-10-small`;
    expect(outcome).toEqual({ kind: 'made', reference, tier: 'small', cents: 500 });
    const [row] = await invoicesOf(MOVES_UP);
    expect(row).toMatchObject({
      reference,
      status: 'draft',
      total: '5.00',
      period_start: '2026-10-01',
      period_end: '2026-10-31',
      invoice_number: null,
      lines: [{ description: 'Ownpace Small, oktober 2026: 320 GB gemigreerd in totaal', publishedCents: 500 }],
    });
    expect(row!.evidence).toMatchObject({
      month: '2026-10',
      tier: 'small',
      by: 'data',
      gbCounted: 320,
      agreedTier: 'small',
      priceCents: 500,
      priceFrom: 'agreed',
      beforeCents: 0,
      cents: 500,
      at: OCT_1.toISOString(),
    });
  });

  it('makes no second row on a second run', async () => {
    const outcome = await withTenant(driver, MOVES_UP, (db) => openTheMonth(db, MOVES_UP, OCT_3, 'nl'));
    expect(outcome).toEqual({ kind: 'in_step' });
    expect(await invoicesOf(MOVES_UP)).toHaveLength(1);
  });

  it('invoices a move up for the difference, and the two add up to what the month bills', async () => {
    await owner(`UPDATE bytes_moved SET bytes = $2 WHERE tenant_id = $1`, [MOVES_UP, String(640n * GB)]);
    await withTenant(driver, MOVES_UP, async (db) => {
      await new PgDataAllowanceStore(db).record(
        MOVES_UP,
        { kind: 'tier', tierId: 'medium', bandGb: tier('medium').dataGb, priceEur: 12 },
        'someone@example.invalid',
      );
    });
    const outcome = await withTenant(driver, MOVES_UP, (db) => openTheMonth(db, MOVES_UP, OCT_4, 'en'));
    expect(outcome).toEqual({ kind: 'made', reference: `ownpace-${MOVES_UP}-m-2026-10-medium`, tier: 'medium', cents: 700 });
    const rows = await invoicesOf(MOVES_UP);
    expect(rows.map((r) => r.total)).toEqual(['5.00', '7.00']);
    expect(rows[1]!.lines).toEqual([
      { description: 'Ownpace Medium, October 2026: 640 GB migrated in total, less Small already invoiced', publishedCents: 700 },
    ]);
    expect(rows[1]!.evidence).toMatchObject({ tier: 'medium', priceCents: 1200, beforeCents: 500, cents: 700 });
    // And the month after opens on Medium, whole.
    const november = await withTenant(driver, MOVES_UP, (db) =>
      openTheMonth(db, MOVES_UP, new Date('2026-11-01T00:23:00Z'), 'en'),
    );
    expect(november).toMatchObject({ kind: 'made', tier: 'medium', cents: 1200 });
  });

  it("trues up a standing fleet's peak before it prices, and quotes the mark with its day", async () => {
    // Seven of the organisation's migrations held slots all month and nobody
    // pressed anything: no peak was ever recorded for October.
    await owner(`INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by, axis, consented_at)
                 VALUES ($1, 'tier', 'medium', 1500, 12, 'someone@example.invalid', 'paths', '2026-09-01T00:00:00Z')`, [
      STANDING_FLEET,
    ]);
    await seedHeldSlots(STANDING_FLEET, 7);
    const before = await withTenant(driver, STANDING_FLEET, (db) =>
      db.execute(sql`SELECT count(*)::int AS n FROM occupancy_peak WHERE tenant_id = ${STANDING_FLEET}`),
    );
    expect((before as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(0);

    const outcome = await withTenant(driver, STANDING_FLEET, (db) => openTheMonth(db, STANDING_FLEET, OCT_3, 'nl'));
    expect(outcome).toMatchObject({ kind: 'made', tier: 'medium', cents: 1200 });
    const [row] = await invoicesOf(STANDING_FLEET);
    expect(row!.lines).toEqual([
      { description: 'Ownpace Medium, oktober 2026: 7 migraties tegelijk op 3 oktober', publishedCents: 1200 },
    ]);
    expect(row!.evidence).toMatchObject({ by: 'paths', peakPaths: 7, peakAt: OCT_3.toISOString() });
  });

  it('says the pick when the pick decides, at the price the pick showed', async () => {
    // Nothing moved, nothing running: Free by what was used, Small by the pick
    // (0157 T6), which carries its yes.
    await withTenant(driver, PICKED_SMALL, async (db) => {
      await new PgTierPickStore(db).record(PICKED_SMALL, { tierId: 'small', priceEur: 5 }, 'someone@example.invalid', OCT_1);
      await new PgDataAllowanceStore(db).record(
        PICKED_SMALL,
        { kind: 'tier', tierId: 'small', bandGb: tier('small').dataGb, priceEur: 5 },
        'someone@example.invalid',
        'pick',
      );
    });
    const outcome = await withTenant(driver, PICKED_SMALL, (db) => openTheMonth(db, PICKED_SMALL, OCT_3, 'nl'));
    expect(outcome).toMatchObject({ kind: 'made', tier: 'small', cents: 500 });
    const [row] = await invoicesOf(PICKED_SMALL);
    expect(row!.lines).toEqual([{ description: 'Ownpace Small, oktober 2026: het pakket dat u koos', publishedCents: 500 }]);
    expect(row!.evidence).toMatchObject({ by: 'picked', priceFrom: 'agreed', agreedTier: 'small' });
  });

  it("reads and writes only in the organisation's own scope", async () => {
    // Run in Stays Free's scope, naming Moves Up: row security leaves none of
    // Moves Up's yeses, meter or invoices to read, so the month it finds is
    // Free's, and nothing is written for anybody.
    const before = await invoicesOf(MOVES_UP);
    const crossed = await withTenant(driver, ON_FREE, (db) =>
      openTheMonth(db, MOVES_UP, new Date('2026-12-01T00:23:00Z'), 'en'),
    );
    expect(crossed).toEqual({ kind: 'free' });
    expect(await invoicesOf(MOVES_UP)).toEqual(before);
    expect(await invoicesOf(ON_FREE)).toEqual([]);
  });

  /**
   * `count` paths holding slots, as the doors leave them: a source, its
   * mailboxes and their mappings, each data type a mapping carries in scope
   * (only a path holds a slot, 0128 T4), and the paths active. As the owner,
   * as a fixture.
   */
  async function seedHeldSlots(tenantId: TenantId, count: number): Promise<void> {
    const connection = '0111b000-e29b-41d4-a716-446655440051';
    await owner(`INSERT INTO connection (id, tenant_id, role, kind, display_name) VALUES ($1, $2, 'source', 'imap', 'i')`, [
      connection,
      tenantId,
    ]);
    for (let left = count, m = 0; left > 0; m++) {
      const box = `0111b000-e29b-41d4-a716-44665544007${m}`;
      const mapping = `0111b000-e29b-41d4-a716-44665544010${m}`;
      await owner(`INSERT INTO mailbox (id, tenant_id, connection_id, external_id) VALUES ($1, $2, $3, $4)`, [
        box,
        tenantId,
        connection,
        `box-${m}`,
      ]);
      await owner(`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'active')`, [
        mapping,
        tenantId,
        box,
      ]);
      for (const domain of DISCOVERY_DOMAINS.slice(0, Math.min(left, DISCOVERY_DOMAINS.length))) {
        await owner(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
          tenantId,
          mapping,
          domain,
        ]);
        await owner(
          `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
           VALUES ($1, $2, $3, 'active', '2026-09-15T08:00:00Z')`,
          [tenantId, mapping, domain],
        );
        left -= 1;
      }
    }
  }
});
