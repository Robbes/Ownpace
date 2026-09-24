// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOWNLOAD THAT RESUMES (workplan 0129 T4; the owner's D4), where it reads
 * the audit log: `readAuditExport`.
 *
 *  - every settled event, oldest first, across the organisations a deployment
 *    serves, each read under its own policy;
 *  - from a cursor, never repeating one and never skipping one, a page at a
 *    time;
 *  - two events in the same microsecond in the same order every time;
 *  - an event too new to have settled is not served yet: a transaction that
 *    began earlier could still commit a row with an earlier time.
 *
 * PGlite as the appliance runs it. The addresses and names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations } from './migrate.ts';
import { createPgliteDb } from './pglite-driver.ts';
import { readAuditExport } from './audit-export-read.ts';
import type { LedgerDriver } from './driver.ts';

const A = '0e129100-e29b-41d4-a716-446655440001';
const B = '0e129100-e29b-41d4-a716-446655440002';
const id = (n: string) => `0e129100-e29b-41d4-a716-44665544${n}`;

/** The seeded events, in the order a download must serve them. */
const SETTLED = [
  { id: id('0a01'), tenant: A, at: '2026-09-01T10:00:00.000001Z' },
  { id: id('0b01'), tenant: B, at: '2026-09-01T10:00:00.000002Z' },
  // The same microsecond in two organisations: the id decides, and the
  // smaller id is B's, which is read after A's.
  { id: id('0a02'), tenant: B, at: '2026-09-02T08:00:00.500000Z' },
  { id: id('0a03'), tenant: A, at: '2026-09-02T08:00:00.500000Z' },
  { id: id('0b02'), tenant: B, at: '2026-09-03T00:00:00.000000Z' },
];
const RECENT = id('0a09');

let driver: LedgerDriver;

beforeAll(async () => {
  driver = (await createPgliteDb({ role: 'app_user' })).driver;
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'A BV', 'active'), ($2, 'B BV', 'active')`, [A, B]);
    // Written in the reverse order, so the order served is the rows' own.
    for (const e of [...SETTLED].reverse()) {
      await conn.query(
        `INSERT INTO audit_log (id, tenant_id, actor, action, detail, at) VALUES ($1, $2, $3, 'share.decided', $4, $5)`,
        [e.id, e.tenant, 'jan@example.invalid', JSON.stringify({ mappingId: e.tenant, on: 'Salaries 2026.xlsx' }), e.at],
      );
    }
    // Recorded now, and by nobody in particular: an older row may have no actor.
    await conn.query(
      `INSERT INTO audit_log (id, tenant_id, actor, action, at) VALUES ($1, $2, NULL, 'digest_sent_daily', now())`,
      [RECENT, A],
    );
  } finally {
    conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

const both = () => ({ driver, tenantIds: [A, B] });

describe('the download reads the audit log', () => {
  it('serves every settled event, oldest first, across the organisations', async () => {
    const events = await readAuditExport(both());

    expect(events.map((e) => e.id)).toEqual(SETTLED.map((e) => e.id));
    expect(events.map((e) => e.tenantId)).toEqual(SETTLED.map((e) => e.tenant));
  });

  it('keeps each row as it was recorded: the line is made from it, and pseudonymises it', async () => {
    const page = await readAuditExport(both(), { limit: 1 });
    const [first] = page;

    // One page is the size asked for, however many organisations answered.
    expect(page).toHaveLength(1);
    expect(first).toEqual({
      id: SETTLED[0]!.id,
      at: SETTLED[0]!.at,
      tenantId: A,
      actor: 'jan@example.invalid',
      action: 'share.decided',
      detail: { mappingId: A, on: 'Salaries 2026.xlsx' },
    });
  });

  it('resumes after a cursor, never repeating the event it names', async () => {
    const events = await readAuditExport(both(), { after: { at: SETTLED[2]!.at, id: SETTLED[2]!.id } });

    expect(events.map((e) => e.id)).toEqual([SETTLED[3]!.id, SETTLED[4]!.id]);
  });

  it('reaches every event exactly once, a page at a time', async () => {
    const seen: string[] = [];
    let after: { at: string; id: string } | undefined;
    for (let page = 0; page < 10; page++) {
      const events = await readAuditExport(both(), { ...(after ? { after } : {}), limit: 2 });
      seen.push(...events.map((e) => e.id));
      if (events.length < 2) break;
      const last = events.at(-1)!;
      after = { at: last.at, id: last.id };
    }

    expect(seen).toEqual(SETTLED.map((e) => e.id));
  });

  it('reads only the organisations it is given', async () => {
    const events = await readAuditExport({ driver, tenantIds: [B] });

    expect(events.map((e) => e.id)).toEqual(SETTLED.filter((e) => e.tenant === B).map((e) => e.id));
  });
});

describe('an event too new to have settled', () => {
  it('is not served yet', async () => {
    expect((await readAuditExport(both())).map((e) => e.id)).not.toContain(RECENT);
  });

  it('is served once it has, and names no actor it did not have', async () => {
    const events = await readAuditExport(both(), { settleSeconds: 0 });

    expect(events.at(-1)).toMatchObject({ id: RECENT, actor: '', action: 'digest_sent_daily' });
    expect(events.at(-1)).not.toHaveProperty('detail');
  });
});
