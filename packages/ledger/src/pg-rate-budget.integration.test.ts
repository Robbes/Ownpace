// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The rate budget under GENUINE contention (workplan 0083; 0082 T5 named this
 * as the gap).
 *
 * The unit test for `PgRateBudget` runs on PGlite, which is a single
 * connection. Twenty overlapping acquires there overlap only in the JavaScript
 * sense — they queue on one session and never contend inside Postgres. So what
 * that test pins is that the operation is ONE statement whose read and write
 * cannot be separated. It cannot pin the thing that makes that sufficient:
 * that `INSERT … ON CONFLICT DO UPDATE` takes a row lock, and that concurrent
 * sessions therefore serialise on it rather than each reading the same token
 * count and all deciding they may proceed.
 *
 * 0082 said in writing that this was "the property that would break first".
 * This is that test, and it needs a real server with real connections — which
 * is the whole reason it lives in the integration tier.
 *
 * The failure it guards against is not a crash. A lost update means the budget
 * quietly grants more than it should, in proportion to how much concurrency
 * there is — so it is invisible at one worker and worst exactly when the
 * service is busiest, which is the same shape as the defect 0082 T5 fixed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createPgDb } from './db.ts';
import { PgRateBudget } from './pg-rate-budget.ts';
import * as schemaPg from './schema-pg.ts';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const TENANT = '00000000-0000-0000-0000-0000000009b1';
const PROVIDER = 'graph';

/** More sessions than the burst, so somebody must be refused. */
const SESSIONS = 12;
const BURST = 8;

describe('PgRateBudget under real concurrency', () => {
  let db: ReturnType<typeof createPgDb>;

  beforeAll(async () => {
    // A pool big enough that the acquires below really are simultaneous — with
    // fewer connections than callers, node-postgres would queue them for us and
    // the test would prove nothing about Postgres's own locking.
    db = createPgDb(TEST_DB_URL, SESSIONS + 2);
    await db
      .insert(schemaPg.tenant)
      .values({ id: TENANT, name: 'rate budget contention', status: 'active', settings: {} })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(schemaPg.tenant).where(eq(schemaPg.tenant.id, TENANT));
    await db.close();
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM rate_budget WHERE tenant_id = ${TENANT}::uuid`);
  });

  async function tokensLeft(): Promise<number | null> {
    const rows = await db
      .select({ tokens: schemaPg.rateBudget.tokens })
      .from(schemaPg.rateBudget)
      .where(
        and(
          eq(schemaPg.rateBudget.tenantId, TENANT),
          eq(schemaPg.rateBudget.provider, PROVIDER),
        ),
      );
    return rows[0] ? Number(rows[0].tokens) : null;
  }

  it('never grants more than the burst, however many sessions ask at once', async () => {
    // ONE token per second, so the refill over the test's own duration is a
    // rounding error rather than the thing being measured — the mistake the
    // unit test made at 1000/s and had to be corrected for.
    const budgets = Array.from(
      { length: SESSIONS },
      () => new PgRateBudget(db, { requestsPerSecond: 1, burst: BURST }),
    );

    // Every session takes one token simultaneously. Eight are available; the
    // other four must WAIT rather than each read "8 left" and proceed.
    const granted: number[] = [];
    await Promise.all(
      budgets.map(async (budget, i) => {
        await budget.acquire(TENANT, PROVIDER);
        granted.push(i);
      }),
    );

    // All twelve eventually get through — the budget makes callers wait, it
    // does not refuse them.
    expect(granted).toHaveLength(SESSIONS);

    // The load-bearing assertion. Twelve tokens were spent from a bucket that
    // only ever held eight plus a second or two of refill at one per second.
    // Under lost updates several sessions would have decremented from the same
    // starting value and the balance would sit near BURST - 1.
    const left = await tokensLeft();
    expect(left).not.toBeNull();
    expect(left!).toBeLessThan(1);
  }, 60_000);

  it('holds one row per (tenant, provider), not one per session', async () => {
    const budgets = Array.from(
      { length: 4 },
      () => new PgRateBudget(db, { requestsPerSecond: 1, burst: 50 }),
    );
    await Promise.all(budgets.map((b) => b.acquire(TENANT, PROVIDER)));

    const rows = await db
      .select({ tenantId: schemaPg.rateBudget.tenantId })
      .from(schemaPg.rateBudget)
      .where(eq(schemaPg.rateBudget.tenantId, TENANT));
    // ON CONFLICT, not INSERT: four sessions racing to create the same bucket
    // must end with one row, not four and a unique violation.
    expect(rows).toHaveLength(1);
  }, 60_000);
});
