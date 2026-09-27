// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRACE PERIOD NOBODY CHOSE AT (workplan 0128 D7, T5 slice 7c), on PGlite
 * as `app_user`.
 *
 * When a grace period ends and nobody chose, copying stops, and the owner is
 * told on the Finish page and in the digest. Both read it here: when each
 * cutover ledger's grace period ended (`readGraceEnds`, a data type's own
 * ledger or the whole migration's where it has none), carried on each data
 * type still in its cutover (`readPathEndingChoices`), and named for the
 * digest (`readGraceEndedWithoutAChoice`). A data type that was ended or kept
 * made its choice, and is not named.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { withTenant } from './db.ts';
import type { LedgerDriver } from './driver.ts';
import { readGraceEnds } from './cutover-grace.ts';
import { readGraceEndedWithoutAChoice, readPathEndingChoices } from './an-ending-per-data-type.ts';

// UUID family 0128e400-…, unused elsewhere in the repo.
const TENANT = '0128e400-e29b-41d4-a716-446655440001';
const CONNECTION = '0128e400-e29b-41d4-a716-446655440002';
const MAILBOX = '0128e400-e29b-41d4-a716-446655440003';
const MAPPING = '0128e400-e29b-41d4-a716-446655440004';
const GONE = '0128e400-e29b-41d4-a716-446655440005';

let driver: LedgerDriver;

async function query(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    conn.release();
  }
}

/** A cutover ledger in its grace period, started `hoursAgo` ago, of `domain` or the whole migration. */
async function aGracePeriod(domain: string | null, hoursAgo: number, state = 'GRACE_PERIOD'): Promise<void> {
  await query(
    `INSERT INTO cutover_state (tenant_id, mapping_id, domain, state, grace_period_hours, copies_through_grace,
                                grace_period_started_at)
     VALUES ($1, $2, $3, $4, 72, true, now() - make_interval(hours => $5))`,
    [TENANT, MAPPING, domain, state, hoursAgo],
  );
}

/** The migration in `status`, calendars and files at `rows`, and no cutover ledger yet. */
async function place(status: string, rows: Record<string, string>) {
  await query(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, status]);
  await query(`DELETE FROM path_lifecycle WHERE mapping_id = $1`, [MAPPING]);
  await query(`DELETE FROM cutover_state WHERE mapping_id = $1`, [MAPPING]);
  for (const [domain, state] of Object.entries(rows)) {
    await query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at)
       VALUES ($1, $2, $3, $4, now())`,
      [TENANT, MAPPING, domain, state],
    );
  }
}

const inTenant = <T>(read: Parameters<typeof withTenant<T>>[2]) => withTenant(driver, TENANT, read);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'graces', 'active')`, [TENANT]);
  await query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
     VALUES ($1, $2, 'source', 'imap', 'fixture', 'connected', '{}'::jsonb)`,
    [CONNECTION, TENANT],
  );
  await query(
    `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
     VALUES ($1, $2, $3, 'src', 'a@example.test')`,
    [MAILBOX, TENANT, CONNECTION],
  );
  await query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1, $2, $3, 'cutover')`,
    [MAPPING, TENANT, MAILBOX],
  );
  for (const domain of ['calendar', 'file']) {
    await query(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1, $2, $3, true)`, [
      TENANT,
      MAPPING,
      domain,
    ]);
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await place('cutover', { calendar: 'cutover', file: 'cutover' });
});

describe('when each grace period ended', () => {
  it('reads a data type’s own ledger, and the whole migration’s where it has none', async () => {
    await aGracePeriod(null, 73); // the whole migration's: ended an hour ago
    await aGracePeriod('calendar', 1); // the calendars' own: 71 hours to go
    const ends = await inTenant((db) => readGraceEnds(db, TENANT, MAPPING));
    const anHourAgo = Date.now() - 3_600_000;
    expect(Math.abs(ends.of('file')!.getTime() - anHourAgo)).toBeLessThan(60_000);
    expect(Math.abs(ends.of()!.getTime() - anHourAgo)).toBeLessThan(60_000);
    // Its own ledger answers for it, ended or not: never the whole migration's.
    expect(ends.of('calendar')).toBeNull();
  });

  it('reads none where no grace period ended, or no ledger was ever begun', async () => {
    expect((await inTenant((db) => readGraceEnds(db, TENANT, MAPPING))).of('file')).toBeNull();
    await aGracePeriod(null, 2);
    expect((await inTenant((db) => readGraceEnds(db, TENANT, MAPPING))).of('file')).toBeNull();
  });
});

describe('what the Finish page and the digest are told', () => {
  it('carries the end on each data type still in its cutover, and names those for the digest', async () => {
    await aGracePeriod(null, 73);
    await aGracePeriod('calendar', 1);
    const choices = await inTenant((db) => readPathEndingChoices(db, TENANT, MAPPING));
    expect(choices.find((c) => c.domain === 'calendar')!.graceEndedAt).toBeUndefined();
    expect(choices.find((c) => c.domain === 'file')!.graceEndedAt).toEqual(expect.any(String));

    const named = await inTenant((db) => readGraceEndedWithoutAChoice(db, TENANT, MAPPING));
    expect(named.map((n) => n.domain)).toEqual(['file']);
    expect(named[0]!.endedAt).toBe(choices.find((c) => c.domain === 'file')!.graceEndedAt);
  });

  it('names none that made its choice: a data type ended or kept, past its cutover', async () => {
    await place('continuous', { calendar: 'done', file: 'continuous' });
    await aGracePeriod(null, 73);
    expect(await inTenant((db) => readGraceEndedWithoutAChoice(db, TENANT, MAPPING))).toEqual([]);
  });

  it('names one whose ledger was closed while it stays in its cutover, and none for a migration that is gone', async () => {
    await query(
      `INSERT INTO cutover_state (tenant_id, mapping_id, domain, state, grace_period_hours, copies_through_grace,
                                  grace_period_started_at, grace_period_completed_at)
       VALUES ($1, $2, 'file', 'COMPLETED', 72, true, now() - interval '10 hours', now() - interval '2 hours')`,
      [TENANT, MAPPING],
    );
    const named = await inTenant((db) => readGraceEndedWithoutAChoice(db, TENANT, MAPPING));
    expect(named.map((n) => n.domain)).toEqual(['file']);
    // Ended when it was closed, two hours ago: not when its hours would have run out.
    expect(Math.abs(new Date(named[0]!.endedAt).getTime() - (Date.now() - 2 * 3_600_000))).toBeLessThan(60_000);
    expect(await inTenant((db) => readGraceEndedWithoutAChoice(db, TENANT, GONE))).toEqual([]);
  });
});
