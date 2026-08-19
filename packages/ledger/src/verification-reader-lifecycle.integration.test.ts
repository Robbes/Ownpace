// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `createLedgerVerificationReader` owns a connection pool, and nothing could
 * close it.
 *
 * The returned object had no disposer, so both callers — the cutover job and
 * the cutover CLI — leaked a pool on every verification run. In the long-lived
 * managed worker that is one leaked pool per cutover attempt, each holding open
 * connections against a server with a finite max_connections.
 *
 * This measures it against a real Postgres by counting backends, rather than
 * asserting that a close() method exists.
 *
 * UUID Family: 7a130000-e29b-41d4-a716-44665544xxxx
 *
 * Runs against a Testcontainers Postgres (pnpm test:integration).
 */

import { describe, it, expect, beforeAll } from 'vitest';
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

describe('LedgerVerificationReader pool lifecycle (integration)', () => {
  let observer: ReturnType<typeof createPgDb>;

  beforeAll(() => {
    observer = createPgDb(PG_CONNECTION_STRING);
  });

  /** Backends this database currently has open, excluding our own observer. */
  async function backendCount(): Promise<number> {
    const result = await observer.execute(
      sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`,
    );
    return Number((result.rows[0] as { n: number }).n);
  }

  it('releases its connections when closed', async () => {
    const before = await backendCount();

    const reader = createLedgerVerificationReader({ connectionString: PG_CONNECTION_STRING });
    // Force the pool to actually open a connection.
    await reader.countItems(TENANT, MAPPING, 'email');
    expect(await backendCount()).toBeGreaterThan(before);

    await reader.close();

    // The load-bearing assertion. Without close() this stayed elevated for the
    // life of the process, once per verification run.
    expect(await backendCount()).toBe(before);
  });

  it('does not accumulate connections across repeated verification runs', async () => {
    const before = await backendCount();

    for (let i = 0; i < 5; i++) {
      const reader = createLedgerVerificationReader({ connectionString: PG_CONNECTION_STRING });
      await reader.countItems(TENANT, MAPPING, 'email');
      await reader.close();
    }

    expect(await backendCount()).toBe(before);
  });
});
