// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The budget is shared, or it is not a budget (workplan 0082 T5).
 *
 * The defect this closes cannot be seen from inside one limiter: a per-process
 * bucket behaves perfectly on its own and is simply duplicated N times across
 * the service. So the central test here uses **two independent `PgRateBudget`
 * instances over one database** — which is exactly what two Trigger.dev task
 * runs are, minus the process boundary. If the state were instance-local, both
 * would happily spend a full bucket and the assertion would fail.
 *
 * Real Postgres via PGlite: `ON CONFLICT DO UPDATE … WHERE`, `clock_timestamp()`
 * and the row lock that makes concurrent acquires serialise are the whole
 * mechanism, and none of them exist in a mock.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { PgByteBudget, PgRateBudget } from './pg-rate-budget.ts';
import type { LedgerDriver, LedgerConnection } from './driver.ts';
import type { PgDatabase } from './db-types.ts';

// UUID family 5aab0000-…, unused elsewhere in the repo.
const TENANT = '5aab0000-e29b-41d4-a716-446655441701';
const OTHER_TENANT = '5aab0000-e29b-41d4-a716-446655441702';

let driver: LedgerDriver;
let conn: LedgerConnection;
let db: PgDatabase;

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  db = made.db;
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
  for (const id of [TENANT, OTHER_TENANT]) {
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, $2, 'active')`, [id, id]);
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  await conn.query('DELETE FROM rate_budget');
  await conn.query('DELETE FROM byte_budget');
});

async function tokensLeft(tenantId: string, provider: string): Promise<number | null> {
  const { rows } = await conn.query<{ tokens: string }>(
    `SELECT tokens::text AS tokens FROM rate_budget WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider],
  );
  return rows[0] ? Number(rows[0].tokens) : null;
}

describe('PgRateBudget', () => {
  it('spends ONE budget across two independent instances', async () => {
    // The whole point. These two are what two task-run processes are.
    //
    // ONE token per second, not a hundred: the refill has to be negligible
    // against however long the test itself takes, or the assertion measures the
    // machine. At 100/s this passed alone and failed in the full suite, which
    // is the shape of a test that would later be called flaky and retried
    // rather than read.
    const a = new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: 1, burst: 10 });
    const b = new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: 1, burst: 10 });

    for (let i = 0; i < 5; i++) await a.acquire('common', 'graph');
    for (let i = 0; i < 5; i++) await b.acquire('common', 'graph');

    // Ten taken from a bucket of ten. If the two instances kept separate
    // counts, each would have spent five of its own ten and this would be
    // nearer five than zero.
    const left = await tokensLeft(TENANT, 'graph');
    expect(left).not.toBeNull();
    expect(left!).toBeLessThan(1);
  });

  it('keeps one tenant out of another tenant s budget', async () => {
    // The property is unchanged and the mechanism is not (2026-09-08). This
    // used to pass TWO tenants to one instance, which is what the interface
    // suggested and what nothing in production ever did: every connector hands
    // `acquire` a label of its own — `dav`, or Entra's `common` — so the second
    // tenant here was reachable only from a test. Separation now comes from the
    // tenant each budget is BUILT with, which is what the callers actually have.
    const mine = new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: 1, burst: 5 });
    const theirs = new PgRateBudget(db, { tenantId: OTHER_TENANT, requestsPerSecond: 1, burst: 5 });

    for (let i = 0; i < 5; i++) await mine.acquire('common', 'graph');
    // A separate row, untouched — a noisy tenant must not throttle a quiet one.
    expect(await tokensLeft(OTHER_TENANT, 'graph')).toBeNull();
    await theirs.acquire('common', 'graph');
    expect(await tokensLeft(OTHER_TENANT, 'graph')).toBeCloseTo(4, 0);
  });

  /**
   * THE ARGUMENT THAT LOOKED LIKE A TENANT AND NEVER WAS.
   *
   * Every Graph source calls `acquire(this.config.tenantId, …)` and every DAV
   * source `acquire('dav', …)`. Neither is this deployment's tenant, and
   * `common` is the SAME string for every customer of one multi-tenant Entra
   * app — so honouring it would put every tenant in one bucket while the
   * `::uuid` cast, mercifully, crashed instead.
   *
   * Both labels must now land on one row: one tenant, one provider, one quota.
   */
  it('spends one bucket whatever the connector calls its tenant', async () => {
    const budget = new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: 1, burst: 10 });

    for (let i = 0; i < 5; i++) await budget.acquire('common', 'graph.microsoft.com');
    for (let i = 0; i < 5; i++) await budget.acquire('dav', 'graph.microsoft.com');

    const left = await tokensLeft(TENANT, 'graph.microsoft.com');
    expect(left, 'a connector label must not fragment one tenant s real quota').not.toBeNull();
    expect(left!).toBeLessThan(1);
  });

  it('refuses a tenant that is not one, at construction', () => {
    // The values production actually passed. Refused where a person can fix
    // the wiring, rather than as a Postgres cast error per domain mid-pass.
    for (const notATenant of ['common', 'dav', '', 'contoso.onmicrosoft.com']) {
      expect(
        () => new PgRateBudget(db, { tenantId: notATenant, requestsPerSecond: 1 }),
        `${notATenant} is not this deployment's tenant`,
      ).toThrow(/tenant id/i);
    }
    expect(() => new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: 1 })).not.toThrow();
  });

  it('keeps one provider out of another provider s budget', async () => {
    const budget = new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: 1, burst: 5 });
    for (let i = 0; i < 5; i++) await budget.acquire('common', 'graph');
    await budget.acquire('common', 'jmap');
    expect(await tokensLeft(TENANT, 'jmap')).toBeCloseTo(4, 0);
  });

  it('actually makes a caller WAIT once the bucket is empty', async () => {
    // Two per second, burst of two: the third acquire cannot be served for
    // roughly half a second. Measured loosely — the assertion is that it
    // waited at all, not how precisely.
    const budget = new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: 2, burst: 2 });
    await budget.acquire('common', 'slow');
    await budget.acquire('common', 'slow');
    const started = Date.now();
    await budget.acquire('common', 'slow');
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  }, 20_000);

  it('does not lose updates when twenty acquires overlap', async () => {
    // A DELIBERATELY SLOW refill rate. The first version of this test used
    // 1000/s and passed nothing useful: twenty acquires take tens of
    // milliseconds, which at that rate refills the entire bucket while the test
    // runs, so the final count says nothing about whether any update was lost.
    // It ended at 12 of 20 and would have read as a failure of the code rather
    // than of the fixture. At 1/s the refill over the same window is under a
    // twentieth of a token, so the ending count is the arithmetic alone.
    //
    // Honest about what this does NOT prove: PGlite is a single connection, so
    // these overlap in the JavaScript sense and never contend inside Postgres.
    // What it pins is that the operation is one statement whose read and write
    // cannot be separated — which is what makes the row lock sufficient on a
    // real server. Genuine multi-connection contention needs the integration
    // tier, and the property that would break first is this one.
    const budget = new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: 1, burst: 20 });
    await Promise.all(
      Array.from({ length: 20 }, () => budget.acquire('common', 'race')),
    );
    const left = await tokensLeft(TENANT, 'race');
    // Twenty taken from twenty. A read-then-write split would leave several
    // unspent, because concurrent readers would all see the same starting
    // count.
    expect(left!).toBeLessThan(1);
  }, 30_000);

  it('refills over elapsed time, not on a timer', async () => {
    // There is no process holding a timer, so refill has to be a function of
    // the row's own refilled_at. Rewind it and the tokens must come back.
    // Again slow, so draining the bucket is not racing its own refill.
    const budget = new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: 1, burst: 10 });
    for (let i = 0; i < 10; i++) await budget.acquire('common', 'graph');
    expect((await tokensLeft(TENANT, 'graph'))!).toBeLessThan(1);

    await conn.query(
      `UPDATE rate_budget SET refilled_at = clock_timestamp() - interval '60 seconds'
        WHERE tenant_id = $1 AND provider = 'graph'`,
      [TENANT],
    );
    // Sixty seconds at one per second is sixty tokens' worth, capped at the
    // burst of ten; one is then spent.
    await budget.acquire('common', 'graph');
    expect((await tokensLeft(TENANT, 'graph'))!).toBeCloseTo(9, 0);
  });

  it('refuses a rate that would never grant anything', async () => {
    expect(() => new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: 0 })).toThrow(/positive/);
    expect(() => new PgRateBudget(db, { tenantId: TENANT, requestsPerSecond: -1 })).toThrow(/positive/);
  });
});

/**
 * The daily byte meter's pg twin (workplan 0090 T2). The semantics are pinned
 * on `InProcessByteBudget` where they are cheap; what THIS tier proves is the
 * shared-and-durable half — two instances over one database read one meter,
 * and the accumulate-or-reset is one statement whose read and write cannot be
 * separated. Same honesty note as the rate tests above: PGlite is a single
 * connection, so genuine multi-connection contention lives in the integration
 * tier.
 */
describe('PgByteBudget', () => {
  it('meters ONE budget across two independent instances', async () => {
    // Two instances are what two Trigger.dev task runs are. Instance-local
    // state would leave each seeing only its own half.
    const a = new PgByteBudget(db, { bytesPerDay: 1000 });
    const b = new PgByteBudget(db, { bytesPerDay: 1000 });
    await a.spend(TENANT, 'gmail-imap', 400);
    const seen = await b.spend(TENANT, 'gmail-imap', 300);
    expect(seen.spentBytes).toBe(700);
    expect(seen.remainingBytes).toBe(300);
  });

  it('records past the ceiling rather than refusing, with remaining floored at zero', async () => {
    const budget = new PgByteBudget(db, { bytesPerDay: 1000 });
    const state = await budget.spend(TENANT, 'gmail-imap', 1500);
    expect(state.spentBytes).toBe(1500);
    expect(state.remainingBytes).toBe(0);
  });

  it('starts a fresh window once 24 hours have passed, anchored at the next byte', async () => {
    const budget = new PgByteBudget(db, { bytesPerDay: 1000 });
    await budget.spend(TENANT, 'gmail-imap', 900);
    // Rewind the window past its edge — the pg equivalent of advancing the
    // clock, same trick as the refill test above.
    await conn.query(
      `UPDATE byte_budget SET window_started_at = clock_timestamp() - interval '25 hours'
        WHERE tenant_id = $1 AND provider = 'gmail-imap'`,
      [TENANT],
    );
    // Before any new byte, the expired window reads as untouched…
    const idle = await budget.state(TENANT, 'gmail-imap');
    expect(idle.spentBytes).toBe(0);
    expect(idle.windowResetsAt).toBeNull();
    // …and the next spend resets rather than accumulates.
    const fresh = await budget.spend(TENANT, 'gmail-imap', 100);
    expect(fresh.spentBytes).toBe(100);
    expect(fresh.remainingBytes).toBe(900);
  });

  it('keeps tenants and providers on separate meters', async () => {
    const budget = new PgByteBudget(db, { bytesPerDay: 1000 });
    await budget.spend(TENANT, 'gmail-imap', 800);
    expect((await budget.state(OTHER_TENANT, 'gmail-imap')).spentBytes).toBe(0);
    expect((await budget.state(TENANT, 'other-provider')).spentBytes).toBe(0);
  });

  it('does not lose bytes when twenty spends overlap', async () => {
    // Same caveat as the rate twin: PGlite serialises these in the JavaScript
    // sense. What this pins is that accumulate-or-reset is ONE statement, so
    // the row lock is sufficient on a real server.
    const budget = new PgByteBudget(db, { bytesPerDay: 100_000 });
    await Promise.all(
      Array.from({ length: 20 }, () => budget.spend(TENANT, 'race', 10)),
    );
    expect((await budget.state(TENANT, 'race')).spentBytes).toBe(200);
  }, 30_000);

  it('counts garbage as nothing', async () => {
    const budget = new PgByteBudget(db, { bytesPerDay: 1000 });
    await budget.spend(TENANT, 'gmail-imap', 400);
    expect((await budget.spend(TENANT, 'gmail-imap', Number.NaN)).spentBytes).toBe(400);
    expect((await budget.spend(TENANT, 'gmail-imap', -50)).spentBytes).toBe(400);
  });

  it('reads state without spending, and an unmetered pair as a full budget', async () => {
    const budget = new PgByteBudget(db, { bytesPerDay: 1000 });
    const untouched = await budget.state(TENANT, 'never-used');
    expect(untouched.remainingBytes).toBe(1000);
    expect(untouched.windowResetsAt).toBeNull();
    await budget.spend(TENANT, 'gmail-imap', 250);
    await budget.state(TENANT, 'gmail-imap');
    expect((await budget.state(TENANT, 'gmail-imap')).spentBytes).toBe(250);
  });

  it('refuses a ceiling that would never grant anything', async () => {
    expect(() => new PgByteBudget(db, { bytesPerDay: 0 })).toThrow(/positive/);
  });
});
