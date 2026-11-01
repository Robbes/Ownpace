// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `createLedgerVerificationReader` owns a connection pool, and nothing could
 * close it.
 *
 * The returned object had no disposer, so both callers — the cutover job and
 * the cutover CLI — leaked a pool on every verification run. In the long-lived
 * managed worker that is one leaked pool per cutover attempt, each holding open
 * connections against a server with a finite max_connections.
 *
 * This measures it against a real Postgres by counting the reader's own
 * backends, rather than asserting that a close() method exists.
 *
 * UUID Family: 7a130000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb } from './db.ts';
import { createLedgerVerificationReader } from './verification-queries.ts';
import type { TenantId, MappingId } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const P = '7a130000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01` as TenantId;
const MAPPING = `${P}d1` as MappingId;

/**
 * The test database's URL with an `application_name` nothing else uses, and
 * that name. Every connection a pool opens from the URL carries the name, so
 * `pg_stat_activity` can say which backends are the reader's.
 *
 * It counts by name, and not every backend the database has, because the
 * database is not the reader's alone. On 2026-11-01 (run 41307075837, amd64)
 * the second test read 2 before the loop; after it, no read within
 * `SETTLE_MS` came back to 2, and the read at the deadline was 1. A backend
 * that was not the reader's was there when `before` was read and left inside
 * the window, so the count could get back to `before` only if some other
 * backend happened to arrive. An autovacuum worker is one — Postgres lists it
 * under the database it is vacuuming — and so is any session of anything else
 * connected to the same database. Only a backend already there at `before`
 * could do it: one that arrived later held the count above `before` until it
 * left, and the settle loop waited it out, which is why the old count failed
 * so seldom. Run against `./scripts/local-pg.sh`, a worker present at
 * `before` failed the old count the same way ("expected 2 to be 3", with one
 * idle session of our own beside it), and a second session that closed just
 * after `before` was read failed it as it failed in CI, "expected 1 to be 2"
 * after 5 s. A pool the reader leaks still holds backends under this name,
 * and nothing else can add one or take one away.
 *
 * Under 64 bytes, because Postgres cuts `application_name` there and a cut
 * name would match nothing. Each test's first assertion is that the name
 * reaches the server, so a count of 0 can never be an empty filter.
 */
const taggedUrl = (): { readonly url: string; readonly name: string } => {
  const name = `reader-lifecycle-${randomUUID()}`;
  const url = new URL(PG_CONNECTION_STRING);
  url.searchParams.set('application_name', name);
  return { url: url.toString(), name };
};

describe('LedgerVerificationReader pool lifecycle (integration)', () => {
  let observer: ReturnType<typeof createPgDb>;

  beforeAll(() => {
    observer = createPgDb(PG_CONNECTION_STRING);
  });

  afterAll(async () => {
    await observer.close();
  });

  /** Backends open under `name`, on any database. The observer's are not. */
  async function readerBackends(name: string): Promise<number> {
    const result = await observer.execute(
      sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = ${name}`,
    );
    return Number((result.rows[0] as { n: number }).n);
  }

  /**
   * The count under `name` once the server has caught up with `close()`, or
   * whatever it still reads when it has not caught up within `SETTLE_MS`.
   *
   * `pool.end()` resolves when the Terminate has been handed to every idle
   * client, not when the server has acted on it: pg-pool 3.14 flips `ended`
   * as soon as `_clients` is empty, and `client.end()` has by then only been
   * *called* (`_pulseQueue` → `_remove`). The backend leaves
   * `pg_stat_activity` a few milliseconds later, on the server's schedule,
   * and a count taken over the observer's own connection can land before it
   * does — CI's arm lane read 2 for 1 on 2026-09-06, and under CPU
   * contention this test failed 1 run in 25 locally, settling in up to
   * 66 ms. So the assertion is "the count returns to 0", read until it does.
   * A leaked pool never returns, and the deadline turns that into the same
   * failure as before.
   */
  const SETTLE_MS = 5_000;
  async function readerBackendsSettledToZero(name: string): Promise<number> {
    const deadline = Date.now() + SETTLE_MS;
    let n = await readerBackends(name);
    while (n !== 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      n = await readerBackends(name);
    }
    return n;
  }

  it('releases its connections when closed', async () => {
    const { url, name } = taggedUrl();

    const reader = createLedgerVerificationReader({ connectionString: url });
    // Force the pool to actually open a connection — and see it, under the
    // name, which is what makes the 0 below mean something.
    await reader.countItems(TENANT, MAPPING, 'email');
    expect(await readerBackends(name)).toBeGreaterThan(0);

    await reader.close();

    // The load-bearing assertion. Without close() this stayed elevated for the
    // life of the process, once per verification run.
    expect(await readerBackendsSettledToZero(name)).toBe(0);
  });

  it('does not accumulate connections across repeated verification runs', async () => {
    const { url, name } = taggedUrl();

    for (let i = 0; i < 5; i++) {
      const reader = createLedgerVerificationReader({ connectionString: url });
      await reader.countItems(TENANT, MAPPING, 'email');
      expect(await readerBackends(name)).toBeGreaterThan(0);
      await reader.close();
    }

    expect(await readerBackendsSettledToZero(name)).toBe(0);
  });
});
