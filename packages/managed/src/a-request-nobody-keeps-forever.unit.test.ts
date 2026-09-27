// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REQUEST NOBODY KEEPS FOREVER (workplan 0139 T6, open question 2 (a)).
 *
 * A declined access request held a person's name, address, organisation and
 * note with no end date: no retention job named the table. The owner decided
 * on 2026-09-27 that it is deleted 30 days after the decision. Against PGlite
 * with both chains, over the owner connection as the retention job runs it:
 *
 * - a request declined more than 30 days ago is gone; one declined since stays,
 *   and so does one declined exactly 30 days ago;
 * - an open request stays however old it is, because the owner answers every
 *   one; a granted one stays, because it goes with its organisation;
 * - and, as `app_user`, nobody can delete a request: 0093's rule, that a
 *   person cannot make a decision disappear, still holds.
 *
 * The plan names this guard as an integration test. It is a PGlite unit test
 * here, like the other managed guards that need both migration chains.
 *
 * It fails today: `pruneDeclinedAccessRequests` does not exist.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withSubject } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';
import {
  pruneDeclinedAccessRequests,
  DECLINED_REQUEST_RETENTION_DAYS,
} from './access-request-retention.ts';

const NOW = new Date('2026-09-27T03:17:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const TENANT = '0139a6e1-5c2d-4f7a-9b31-6e0d2c8f4a17';

let driver: LedgerDriver;
/** The same database over the owner connection, as the retention job reaches it. */
let asOwner: LedgerDriver;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  asOwner = { ...driver, role: undefined };
  await sql(asOwner, 'INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Granted Household']);
  // Two chains of migrations on one PGlite: well over the default ten seconds.
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await sql(asOwner, 'DELETE FROM access_request');
});

/** One statement, in its own transaction, as the driver's role. */
async function sql(source: LedgerDriver, text: string, params: unknown[] = []): Promise<unknown[]> {
  const conn = await source.acquire();
  try {
    await conn.query('BEGIN');
    if (source.role) await conn.query(`SET LOCAL ROLE ${source.role}`);
    const result = await conn.query(text, params);
    await conn.query('COMMIT');
    return result.rows;
  } catch (error) {
    await conn.query('ROLLBACK');
    throw error;
  } finally {
    conn.release();
  }
}

const declined = (email: string, decidedAt: string) =>
  sql(
    asOwner,
    `INSERT INTO access_request (email, state, decided_by, decided_at, created_at)
     VALUES ($1, 'declined', 'operator-subject', $2::timestamptz, $2::timestamptz - interval '1 day')`,
    [email, decidedAt],
  );

const prune = () =>
  withSubject(asOwner, 'system:retention', (db) => pruneDeclinedAccessRequests(db, NOW));

async function emailsLeft(): Promise<string[]> {
  const rows = (await sql(asOwner, 'SELECT email FROM access_request ORDER BY email')) as Array<{
    email: string;
  }>;
  return rows.map((row) => row.email);
}

describe('a declined request', () => {
  it('is deleted 30 days after the decision, and one declined since stays', async () => {
    await declined('old@example.test', daysAgo(31));
    await declined('recent@example.test', daysAgo(29));

    const result = await prune();

    expect(result.deleted).toBe(1);
    expect(result.cutoff.toISOString()).toBe(daysAgo(DECLINED_REQUEST_RETENTION_DAYS));
    expect(await emailsLeft()).toEqual(['recent@example.test']);
  });

  it('stays on the thirtieth day itself', async () => {
    await declined('boundary@example.test', daysAgo(30));

    expect((await prune()).deleted).toBe(0);
    expect(await emailsLeft()).toEqual(['boundary@example.test']);
  });

  it('is the only kind that ages out', async () => {
    // Open: the owner answers every request, so an open one waits for that.
    await sql(
      asOwner,
      `INSERT INTO access_request (email, created_at) VALUES ($1, $2::timestamptz)`,
      ['open@example.test', daysAgo(90)],
    );
    // Granted: it goes with its organisation, when offboarding purges it.
    await sql(
      asOwner,
      `INSERT INTO access_request (email, state, tenant_id, decided_by, decided_at, created_at)
       VALUES ($1, 'granted', $2, 'operator-subject', $3::timestamptz, $3::timestamptz)`,
      ['granted@example.test', TENANT, daysAgo(90)],
    );

    expect((await prune()).deleted).toBe(0);
    expect(await emailsLeft()).toEqual(['granted@example.test', 'open@example.test']);
  });
});

describe('nobody deletes a decision by hand', () => {
  it('app_user has no DELETE on the table, operator or not', async () => {
    await declined('kept@example.test', daysAgo(1));

    await expect(sql(driver, 'DELETE FROM access_request')).rejects.toThrow(/permission denied/);
    expect(await emailsLeft()).toEqual(['kept@example.test']);
  });
});
