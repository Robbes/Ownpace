// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SLOWER CADENCE, SAID ONCE (workplan 0157 T7; the owner, 2026-10-05: "sync
 * slow down once a migration is in step: yes", each step said in the app and
 * by email), against a real database.
 *
 * One organisation's migrations on *Automatic*, each in a different place:
 *
 *  - Anna's mail, in step for 20 days and never visited: every 6 hours;
 *  - the family's mail and calendars, in step for 35 days: once a day;
 *  - Bram's mail, in step for 20 days, its contacts stopped by its owner:
 *    every 6 hours, since a stopped data type copies nothing to wait for;
 *  - one visited two days ago, one with a schedule somebody chose, one whose
 *    files have not finished their first copy, one whose grant was taken back
 *    and one paused: none of them says anything;
 *  - and another organisation's, in step for 20 days, which this one's
 *    morning never reads.
 *
 * Asked as the morning job asks (`claimSlowerSteps`, `cadenceOfOrganisation`):
 *
 *  - the three are claimed and said in one mail, to the organisation's active
 *    owners and admins and nobody else, in its language;
 *  - never a second time, until the step moves on to once a day, or a visit
 *    starts its days again;
 *  - a visit that brings the hour back clears the row;
 *  - on Free, outside the alpha, nothing is said and every row is cleared;
 *  - claimed with no channel too, as the first-copy email's are.
 *
 * PGlite as `app_user`, under row security, with the managed tables.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Pool } from 'pg';
import { pgliteDriver, runMigrations, withTenant, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import type { NotificationLocale, NotificationMessage } from '@openmig/shared';
import { claimSlowerSteps, whomToTell } from './the-slower-cadence-email.ts';
import { cadenceOfOrganisation } from './managed-cadence-email.ts';

// UUID family 0157c7e0-…, unused elsewhere in the repo.
const U = (n: string) => `0157c7e0-e29b-41d4-a716-4466554407${n}`;
const TENANT = U('01');
const OTHER = U('02');
const CONN = U('11');
const BOX = U('21');
const OTHER_CONN = U('12');
const OTHER_BOX = U('22');
const ANNA_MAIL = U('31');
const FAMILY = U('32');
const BRAM_MAIL = U('33');
const VISITED = U('34');
const CHOSEN = U('35');
const FILES_COPYING = U('36');
const TAKEN_BACK = U('37');
const PAUSED = U('38');
const OTHERS = U('39');
const ANNA = U('41');
const BRAM = U('42');

const DAY = 24 * 60 * 60_000;
const NOW = new Date('2026-11-20T07:30:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

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
const send = async (to: readonly string[], locale: NotificationLocale, message: NotificationMessage) => {
  sent.push({ to, locale, message });
};

const claim = (stage: string | undefined = 'alpha', at: Date = NOW) =>
  withTenant(driver, TENANT, (db) => claimSlowerSteps(db, TENANT, at, stage));

const saidRows = async (tenantId = TENANT) =>
  (
    await q('SELECT mapping_id, step, counted_from FROM migration_cadence_said WHERE tenant_id = $1 ORDER BY mapping_id', [
      tenantId,
    ])
  ).map((r) => ({
    mappingId: r.mapping_id as string,
    step: r.step as string,
    countedFrom: new Date(r.counted_from as string | Date).toISOString(),
  }));

/** A migration with these data types, each finished on the day given, or still copying (null). */
async function migration(
  tenantId: string,
  box: string,
  id: string,
  name: string,
  types: ReadonlyArray<readonly [string, Date | null]>,
  extra: { status?: string; schedule?: string; grantWithdrawn?: boolean } = {},
) {
  await q(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, name, schedule, grant_withdrawn_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, tenantId, box, extra.status ?? 'active', name, extra.schedule ?? null, extra.grantWithdrawn ? daysAgo(1) : null],
  );
  for (const [domain, completedAt] of types) {
    await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)`, [
      tenantId,
      id,
      domain,
    ]);
    await q(
      `INSERT INTO migration_status (tenant_id, mapping_id, domain, state, completed_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, id, domain, completedAt ? 'completed' : 'in_progress', completedAt],
    );
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  for (const [id, name, conn, box] of [
    [TENANT, 'Familie Jansen', CONN, BOX],
    [OTHER, 'Elders', OTHER_CONN, OTHER_BOX],
  ] as const) {
    await q(`INSERT INTO tenant (id, name, settings) VALUES ($1,$2,$3::jsonb)`, [
      id,
      name,
      JSON.stringify({ notifications: { digest: 'daily', locale: 'nl' } }),
    ]);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','gmail','family','{}'::jsonb,'connected')`,
      [conn, id],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','family@example.invalid')`,
      [box, id, conn],
    );
  }
  await q(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES
       ($1,'u-owner','owner@example.invalid','owner','active'),
       ($1,'u-admin','admin@example.invalid','admin','active'),
       ($1,'u-member','member@example.invalid','member','active'),
       ($1,'u-gone','gone@example.invalid','owner','removed'),
       ($2,'u-elsewhere','elsewhere@example.invalid','owner','active')`,
    [TENANT, OTHER],
  );

  await migration(TENANT, BOX, ANNA_MAIL, 'Anna mail', [['email', daysAgo(20)]]);
  await migration(TENANT, BOX, FAMILY, 'Family mail and calendars', [
    ['email', daysAgo(35)],
    ['calendar', daysAgo(40)],
  ]);
  await migration(TENANT, BOX, BRAM_MAIL, 'Bram mail', [
    ['email', daysAgo(20)],
    ['contact', null],
  ]);
  // Bram's contacts were stopped by their owner: nothing there to wait for.
  await q(
    `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, stopped_at) VALUES ($1,$2,'contact','active',$3)`,
    [TENANT, BRAM_MAIL, daysAgo(25)],
  );
  await migration(TENANT, BOX, VISITED, 'Visited', [['email', daysAgo(20)]]);
  await q('INSERT INTO migration_visit (mapping_id, tenant_id, visited_at) VALUES ($1,$2,$3)', [
    VISITED,
    TENANT,
    daysAgo(2),
  ]);
  await migration(TENANT, BOX, CHOSEN, 'Chosen', [['email', daysAgo(20)]], { schedule: '0 * * * *' });
  await migration(TENANT, BOX, FILES_COPYING, 'Files copying', [
    ['email', daysAgo(20)],
    ['file', null],
  ]);
  await migration(TENANT, BOX, TAKEN_BACK, 'Taken back', [['email', daysAgo(20)]], { grantWithdrawn: true });
  await migration(TENANT, BOX, PAUSED, 'Paused', [['email', daysAgo(20)]], { status: 'paused' });
  await migration(OTHER, OTHER_BOX, OTHERS, 'Elsewhere', [['email', daysAgo(20)]]);

  await q(
    `INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$2,'Anna Jansen'), ($3,$2,'Bram de Vries')`,
    [ANNA, TENANT, BRAM],
  );
  for (const [mapping, who] of [
    [ANNA_MAIL, ANNA],
    [BRAM_MAIL, BRAM],
  ] as const) {
    await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [mapping, who, TENANT]);
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  sent = [];
  await q('DELETE FROM migration_cadence_said');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a slower cadence, said once (0157 T7)', () => {
  it('claims each migration on Automatic whose step went down, and only those', async () => {
    const answer = await claim();
    expect(answer.kind).toBe('claimed');
    if (answer.kind !== 'claimed') return;
    // By person, then by name.
    expect(answer.migrations).toEqual([
      { mapping: { id: ANNA_MAIL, name: 'Anna mail' }, person: 'Anna Jansen', step: 'six-hourly' },
      { mapping: { id: BRAM_MAIL, name: 'Bram mail' }, person: 'Bram de Vries', step: 'six-hourly' },
      { mapping: { id: FAMILY, name: 'Family mail and calendars' }, step: 'daily' },
    ]);
    // What each step counts from: the newest first pass of what it copies.
    expect(await saidRows()).toEqual([
      { mappingId: ANNA_MAIL, step: 'six-hourly', countedFrom: daysAgo(20).toISOString() },
      { mappingId: FAMILY, step: 'daily', countedFrom: daysAgo(35).toISOString() },
      { mappingId: BRAM_MAIL, step: 'six-hourly', countedFrom: daysAgo(20).toISOString() },
    ]);
  });

  it('says it once: asked again, nothing is claimed', async () => {
    await claim();
    expect(await claim()).toEqual({ kind: 'none', cleared: 0 });
  });

  it('says the next step when it comes, and only that one', async () => {
    await claim();
    const later = await claim('alpha', new Date(NOW.getTime() + 11 * DAY));
    expect(later.kind).toBe('claimed');
    if (later.kind !== 'claimed') return;
    // Anna's and Bram's reach day 30; the family's was already once a day.
    expect(later.migrations.map((m) => [m.mapping.id, m.step])).toEqual([
      [ANNA_MAIL, 'daily'],
      [BRAM_MAIL, 'daily'],
    ]);
  });

  it('a visit that brings the hour back clears the step, and a later step down is news again', async () => {
    await claim();
    await q('INSERT INTO migration_visit (mapping_id, tenant_id, visited_at) VALUES ($1,$2,$3)', [
      ANNA_MAIL,
      TENANT,
      daysAgo(1),
    ]);
    // Anna's is hourly again: its row goes, and nothing is said.
    expect(await claim()).toEqual({ kind: 'none', cleared: 1 });
    expect((await saidRows()).map((r) => r.mappingId)).toEqual([FAMILY, BRAM_MAIL]);
    // Fourteen days after that visit it steps down again, counted from it.
    const later = await claim('alpha', new Date(NOW.getTime() + 13 * DAY + 60_000));
    expect(later.kind).toBe('claimed');
    if (later.kind !== 'claimed') return;
    expect(later.migrations.map((m) => [m.mapping.id, m.step])).toContainEqual([ANNA_MAIL, 'six-hourly']);
    expect((await saidRows()).find((r) => r.mappingId === ANNA_MAIL)?.countedFrom).toBe(daysAgo(1).toISOString());
    await q('DELETE FROM migration_visit WHERE mapping_id = $1', [ANNA_MAIL]);
  });

  it('on Free, outside the alpha, says nothing and clears every step said', async () => {
    // The other organisation: one migration, so Free by what it uses. This
    // one runs nine at once, which no longer fits Free.
    const other = (stage: string) => withTenant(driver, OTHER, (db) => claimSlowerSteps(db, OTHER, NOW, stage));
    expect((await other('alpha')).kind).toBe('claimed');
    expect(await other('')).toEqual({ kind: 'free_pace', cleared: 1 });
    expect(await saidRows(OTHER)).toEqual([]);
  });

  it("never reads or writes another organisation's migrations", async () => {
    await claim();
    expect(await saidRows(OTHER)).toEqual([]);
  });
});

describe('the morning mail, one per organisation (0157 T7)', () => {
  it('goes to the active owners and admins, in the organisation’s language, naming each migration', async () => {
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    expect(await cadenceOfOrganisation(driver as unknown as Pool, TENANT, NOW, send)).toBe('sent');
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect([...mail!.to].sort()).toEqual(['admin@example.invalid', 'owner@example.invalid']);
    expect(mail!.locale).toBe('nl');
    expect(mail!.message.subject).toBe('Ownpace — alles is bijgewerkt, dus we kijken minder vaak');
    expect(mail!.message.body).toContain('Migratie: Anna mail\n  - Persoon: Anna Jansen\n  - Nu elke 6 uur');
    expect(mail!.message.body).toContain('Migratie: Family mail and calendars\n  - Nu eens per dag');
    expect(mail!.message.body).not.toContain('Visited');
    // And never twice.
    expect(await cadenceOfOrganisation(driver as unknown as Pool, TENANT, NOW, send)).toBe('none');
    expect(sent).toHaveLength(1);
  });

  it('claims with no channel too, so a channel switched on later says nothing of today', async () => {
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    expect(await cadenceOfOrganisation(driver as unknown as Pool, TENANT, NOW, undefined)).toBe('no_channel');
    expect(await cadenceOfOrganisation(driver as unknown as Pool, TENANT, NOW, send)).toBe('none');
    expect(sent).toEqual([]);
  });

  it('says to whom: nobody, where the organisation has no active owner or admin', async () => {
    expect(await withTenant(driver, OTHER, (db) => whomToTell(db, OTHER))).toEqual({
      to: ['elsewhere@example.invalid'],
      locale: 'nl',
    });
    await q(`UPDATE tenant_member SET status = 'removed' WHERE tenant_id = $1`, [OTHER]);
    vi.stubEnv('OWNPACE_STAGE', 'alpha');
    expect(await cadenceOfOrganisation(driver as unknown as Pool, OTHER, NOW, send)).toBe('no_recipients');
    expect(sent).toEqual([]);
    await q(`UPDATE tenant_member SET status = 'active' WHERE tenant_id = $1`, [OTHER]);
  });
});
