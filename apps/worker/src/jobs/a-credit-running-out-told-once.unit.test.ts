// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CREDIT RUNNING OUT, TOLD ONCE (workplan 0111 T11, slice Y3): the wiring
 * half of the notice in `managed-month-invoices`, as the hourly run asks it
 * after an organisation's month (`creditNoticeOfOrganisation`). When and what
 * is claimed is `claimCreditNotice`'s (packages/managed,
 * a-credit-running-out.unit.test.ts).
 *
 *  - told to the organisation's active owners and admins, in the language its
 *    notification settings name, and not again the next hour;
 *  - with no channel configured, claimed all the same, so a channel switched
 *    on later tells nobody about it;
 *  - with nobody to tell, claimed, and said so.
 *
 * PGlite as `app_user`, both chains. The names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { pgliteDriver, runMigrations, withTenant, type LedgerDriver } from '@openmig/ledger';
import { MANAGED_TIERS, PgDataAllowanceStore, PgTierPickStore, recordYear, runManagedMigrations } from '@openmig/managed';
import type { NotificationLocale, NotificationMessage, TenantId } from '@openmig/shared';
import { creditNoticeOfOrganisation } from './managed-month-invoices.ts';

// UUID family 0111a100-…, unused elsewhere in the repo.
const IN_DUTCH = '0111a100-e29b-41d4-a716-446655440011';
const NO_CHANNEL = '0111a100-e29b-41d4-a716-446655440012';
const NOBODY = '0111a100-e29b-41d4-a716-446655440013';

/** The first hour of the twelfth month of a year bought on 1 October 2026, once it has drawn. */
const SEP_1 = new Date('2027-09-01T00:23:00Z');

describe("a year's credit running out, told once", () => {
  let driver: LedgerDriver;
  const sent: { to: readonly string[]; locale: NotificationLocale; message: NotificationMessage }[] = [];
  const send = async (to: readonly string[], locale: NotificationLocale, message: NotificationMessage) => {
    sent.push({ to, locale, message });
  };

  async function owner(statement: string, params: unknown[] = []): Promise<void> {
    const conn = await driver.acquire();
    try {
      await conn.query(statement, params);
    } finally {
      await conn.release();
    }
  }

  /** A Medium year from October 2026, its twelve months drawn: nothing left for October 2027. */
  async function aYearSpent(tenantId: string): Promise<void> {
    const medium = MANAGED_TIERS.find((t) => t.id === 'medium')!;
    await withTenant(driver, tenantId, async (db) => {
      await new PgTierPickStore(db).record(tenantId as TenantId, { tierId: 'medium', priceEur: 12 }, 'someone@example.invalid', new Date('2026-10-01T00:05:00Z'));
      await new PgDataAllowanceStore(db).record(
        tenantId as TenantId,
        { kind: 'tier', tierId: 'medium', bandGb: medium.dataGb, priceEur: 12 },
        'someone@example.invalid',
        'pick',
      );
      await recordYear(db, tenantId as TenantId, { tier: medium, cents: 7200, priceFrom: 'list' }, new Date('2026-10-01T00:10:00Z'), 'en');
    });
    await owner(`UPDATE data_allowance SET consented_at = '2026-10-01T00:05:00Z' WHERE tenant_id = $1`, [tenantId]);
    // Twelve months at half of Medium's €12.00, as the month task draws them.
    await owner(
      `INSERT INTO credit_draw (tenant_id, month, tier_id, cents, rate, evidence, drawn_at)
       SELECT $1, (date '2026-10-01' + make_interval(months => n))::date, 'medium', 600, 'half', '{}'::jsonb,
              timestamptz '2026-10-01 00:23:00+00' + make_interval(months => n)
         FROM generate_series(0, 11) AS n`,
      [tenantId],
    );
  }

  beforeAll(async () => {
    driver = pgliteDriver({ role: 'app_user' });
    await runMigrations({ driver, logger: () => {} });
    await runManagedMigrations({ driver, logger: () => {} });
    await owner(
      `INSERT INTO tenant (id, name, settings) VALUES
         ($1, 'In het Nederlands BV', '{"notifications": {"digest": "daily", "locale": "nl"}}'::jsonb),
         ($2, 'No Channel Ltd', '{}'::jsonb),
         ($3, 'Nobody Ltd', '{}'::jsonb)`,
      [IN_DUTCH, NO_CHANNEL, NOBODY],
    );
    for (const tenantId of [IN_DUTCH, NO_CHANNEL]) {
      await owner(
        `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES
           ($1, 'u-owner', 'owner@example.invalid', 'owner', 'active'),
           ($1, 'u-admin', 'admin@example.invalid', 'admin', 'active'),
           ($1, 'u-member', 'member@example.invalid', 'member', 'active'),
           ($1, 'u-gone', 'gone@example.invalid', 'owner', 'removed')`,
        [tenantId],
      );
    }
    for (const tenantId of [IN_DUTCH, NO_CHANNEL, NOBODY]) await aYearSpent(tenantId);
  }, 120_000);

  afterAll(async () => {
    await driver?.end();
  });

  it("tells the active owners and admins, in the organisation's language, and not again the next hour", async () => {
    expect(await creditNoticeOfOrganisation(driver as unknown as Pool, IN_DUTCH, SEP_1, send)).toBe('sent');
    expect(sent).toHaveLength(1);
    expect([...sent[0]!.to].sort()).toEqual(['admin@example.invalid', 'owner@example.invalid']);
    expect(sent[0]!.locale).toBe('nl');
    expect(sent[0]!.message.subject).toBe('Ownpace — uw tegoed raakt op');
    expect(sent[0]!.message.body).toContain('Organisatie: In het Nederlands BV');
    expect(sent[0]!.message.body).toContain('Uw tegoed is niet genoeg voor heel oktober 2027:');
    expect(sent[0]!.message.body).toContain('  - Tegoed over: € 0,00');
    expect(sent[0]!.message.body).toContain('  - Ownpace Medium, oktober 2027: € 12,00');

    expect(await creditNoticeOfOrganisation(driver as unknown as Pool, IN_DUTCH, new Date('2027-09-01T01:23:00Z'), send)).toBe('said_before');
    expect(sent).toHaveLength(1);
  });

  it('claims it with no channel configured, so a channel switched on later tells nobody about it', async () => {
    expect(await creditNoticeOfOrganisation(driver as unknown as Pool, NO_CHANNEL, SEP_1, undefined)).toBe('no_channel');
    expect(await creditNoticeOfOrganisation(driver as unknown as Pool, NO_CHANNEL, new Date('2027-09-01T01:23:00Z'), send)).toBe(
      'said_before',
    );
    expect(sent).toHaveLength(1);
  });

  it('says there was nobody to tell, and claims it all the same', async () => {
    expect(await creditNoticeOfOrganisation(driver as unknown as Pool, NOBODY, SEP_1, send)).toBe('no_recipients');
    expect(await creditNoticeOfOrganisation(driver as unknown as Pool, NOBODY, new Date('2027-09-01T01:23:00Z'), send)).toBe('said_before');
    expect(sent).toHaveLength(1);
  });
});
