// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FIRST-COPY EMAIL, ONCE PER PERSON (workplan 0154 T7; the owner,
 * 2026-09-28: "One per person"), against a real database.
 *
 * Anna has two migrations, mail and calendars, and the calendars' migration
 * also carries contacts its owner stopped; Bram has one, still copying, whose
 * files wait for an export to start; one more migration belongs to nobody.
 * Neither the stopped contacts nor the waiting files hold the mail back. Asked as a pass that just finished a
 * first copy asks (`announceFirstCopy`):
 *
 *  - nothing for Anna while one of theirs has not arrived, and the claim
 *    stays open;
 *  - one mail once both have, to the organisation's active owners and admins
 *    and nobody else, in its language, naming Anna and each data type;
 *  - never a second, asked again or asked twice at once;
 *  - nothing for Bram, still copying, nor for the migration nobody has;
 *  - claimed with no channel too, so a channel switched on later does not
 *    tell anyone then about today.
 *
 * PGlite as `app_user`, under row security, with the managed tables.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { pgliteDriver, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import type { NotificationLocale, NotificationMessage } from '@openmig/shared';
import { announceFirstCopy } from './the-first-copy-email.ts';

// UUID family 0154e700-…, unused elsewhere in the repo.
const U = (n: string) => `0154e700-e29b-41d4-a716-4466554407${n}`;
const TENANT = U('01');
const CONN = U('11');
const BOX = U('21');
const ANNA_MAIL = U('31');
const ANNA_CAL = U('32');
const BRAM_MAIL = U('33');
const LOOSE = U('34');
const CARL_MAIL = U('35');
const ANNA = U('41');
const BRAM = U('42');
const CARL = U('43');

let driver: LedgerDriver;

async function q(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** Every message the channel was handed, with whom and in which language. */
let sent: Array<{ to: readonly string[]; locale: NotificationLocale; message: NotificationMessage }> = [];
const channel = {
  send: async (to: readonly string[], locale: NotificationLocale, message: NotificationMessage) => {
    sent.push({ to, locale, message });
  },
};

const arrived = (mappingId: string, domain: string) =>
  q(
    `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, completed_at)
     VALUES ($1,$2,$3,'completed', now())
     ON CONFLICT (tenant_id, mapping_id, domain) DO UPDATE SET completed_at = now(), state = 'completed'`,
    [TENANT, mappingId, domain],
  );

const claimedAt = async (personId: string) =>
  (await q('SELECT first_copy_announced_at FROM person WHERE id = $1', [personId]))[0]?.first_copy_announced_at;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  await q(`INSERT INTO tenant (id, name, settings) VALUES ($1,$2,$3::jsonb)`, [
    TENANT,
    'Familie Jansen',
    JSON.stringify({ notifications: { digest: 'daily', locale: 'nl' } }),
  ]);
  await q(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES
       ($1,'u-owner','owner@example.invalid','owner','active'),
       ($1,'u-admin','admin@example.invalid','admin','active'),
       ($1,'u-member','member@example.invalid','member','active'),
       ($1,'u-gone','gone@example.invalid','owner','removed')`,
    [TENANT],
  );
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','gmail','family','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  await q(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1,$2,$3,'user','family@example.invalid')`,
    [BOX, TENANT, CONN],
  );
  for (const [id, domain] of [
    [ANNA_MAIL, 'email'],
    [ANNA_CAL, 'calendar'],
    [BRAM_MAIL, 'email'],
    [LOOSE, 'email'],
    [CARL_MAIL, 'email'],
  ] as const) {
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name) VALUES ($1,$2,$3,'active',$4)`,
      [id, TENANT, BOX, `migration ${id.slice(-2)}`],
    );
    await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)`, [
      TENANT,
      id,
      domain,
    ]);
  }
  // A data type its owner stopped, and one waiting to start: neither counts.
  for (const [mapping, domain, state, stopped] of [
    [ANNA_CAL, 'contact', 'active', true],
    [BRAM_MAIL, 'file', 'ready', false],
  ] as const) {
    await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)`, [
      TENANT,
      mapping,
      domain,
    ]);
    await q(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, stopped_at) VALUES ($1,$2,$3,$4,$5)`,
      [TENANT, mapping, domain, state, stopped ? new Date().toISOString() : null],
    );
  }
  await q(
    `INSERT INTO person (id, tenant_id, display_name)
     VALUES ($1,$2,'Anna Jansen'), ($3,$2,'Bram de Vries'), ($4,$2,'Carl Smit')`,
    [ANNA, TENANT, BRAM, CARL],
  );
  for (const [mapping, who] of [
    [ANNA_MAIL, ANNA],
    [ANNA_CAL, ANNA],
    [BRAM_MAIL, BRAM],
    [CARL_MAIL, CARL],
  ] as const) {
    await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [mapping, who, TENANT]);
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(() => {
  sent = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the first-copy email, once per person (0154 T7)', () => {
  it('says nothing while one of the person’s migrations has not arrived, and leaves the claim open', async () => {
    await arrived(ANNA_MAIL, 'email');
    expect(await announceFirstCopy(driver, TENANT, ANNA_MAIL, channel)).toBe('not_yet');
    expect(sent).toEqual([]);
    expect(await claimedAt(ANNA)).toBeNull();
  });

  it('sends one mail once everything has arrived: to the owners and admins, in the organisation’s language', async () => {
    await arrived(ANNA_CAL, 'calendar');
    expect(await announceFirstCopy(driver, TENANT, ANNA_CAL, channel)).toBe('sent');
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect([...mail!.to].sort()).toEqual(['admin@example.invalid', 'owner@example.invalid']);
    expect(mail!.locale).toBe('nl');
    expect(mail!.message.subject).toBe('Ownpace — alles is aangekomen');
    expect(mail!.message.body).toContain('Persoon: Anna Jansen');
    expect(mail!.message.body).toContain('Alles is aangekomen: e-mail en agenda.');
    // On Free, outside the alpha, what keeping in step means (0157 T5).
    expect(mail!.message.body).toContain('Op Free is dat één ronde per dag.');
    expect(await claimedAt(ANNA)).not.toBeNull();
  });

  it('never sends a second, asked again by either migration or by two at once', async () => {
    expect(await announceFirstCopy(driver, TENANT, ANNA_MAIL, channel)).toBe('already');
    const both = await Promise.all([
      announceFirstCopy(driver, TENANT, ANNA_MAIL, channel),
      announceFirstCopy(driver, TENANT, ANNA_CAL, channel),
    ]);
    expect(both).toEqual(['already', 'already']);
    expect(sent).toEqual([]);
  });

  it('says nothing for a migration nobody has, nor for a person still copying', async () => {
    await arrived(LOOSE, 'email');
    expect(await announceFirstCopy(driver, TENANT, LOOSE, channel)).toBe('nobody');
    expect(await announceFirstCopy(driver, TENANT, BRAM_MAIL, channel)).toBe('not_yet');
    expect(sent).toEqual([]);
  });

  it('claims it with no channel too, so a channel switched on later says nothing about today', async () => {
    await arrived(BRAM_MAIL, 'email');
    expect(await announceFirstCopy(driver, TENANT, BRAM_MAIL, {})).toBe('no_channel');
    expect(await claimedAt(BRAM)).not.toBeNull();
    expect(await announceFirstCopy(driver, TENANT, BRAM_MAIL, channel)).toBe('already');
    expect(sent).toEqual([]);
  });
});

describe("the first-copy email at Free's pace (0157 T5)", () => {
  it('says nothing of a pace during the alpha, when every tier runs at a paid tier’s pace', async () => {
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    await arrived(CARL_MAIL, 'email');
    expect(await announceFirstCopy(driver, TENANT, CARL_MAIL, channel)).toBe('sent');
    expect(sent[0]!.message.body).toContain('Alles is aangekomen: e-mail.');
    expect(sent[0]!.message.body).not.toContain('Op Free');
  });
});
