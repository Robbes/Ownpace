// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Migrations never go through the transaction-mode pooler (workplan 0082 T4).
 *
 * The failure this prevents is the quiet kind. `migrate.ts` takes
 * `pg_advisory_lock` — session-scoped — and holds it across every migration's
 * own transaction. Through PgBouncer in transaction mode the lock is taken on
 * one server connection and the migrations applied on others, so the mutual
 * exclusion that lets two API replicas boot simultaneously stops working.
 *
 * Nothing errors when that happens. Both replicas take "the lock", both read
 * an empty `schema_migrations`, and both start applying 0001. It only shows up
 * as a constraint violation on whichever loses, on a fresh database, under
 * concurrency — which is to say: on the first real deploy, and never in a test
 * that boots one process.
 */

import { describe, it, expect } from 'vitest';
import { migrationConnectionString, poolerInFront } from './direct-url.ts';

const POOLED = 'postgresql://owner:pw@pgbouncer:6432/openmigrate';
const DIRECT = 'postgresql://owner:pw@postgres:5432/openmigrate';

describe('migrationConnectionString', () => {
  it('prefers the direct URL whenever one is configured', () => {
    expect(migrationConnectionString({ DATABASE_URL: POOLED, DIRECT_DATABASE_URL: DIRECT })).toBe(
      DIRECT,
    );
  });

  it('falls back to DATABASE_URL when no pooler is in the way', () => {
    // Self-host, and managed before a pooler is deployed. The absence of
    // DIRECT_DATABASE_URL must not be an error — it is the normal case.
    expect(migrationConnectionString({ DATABASE_URL: DIRECT })).toBe(DIRECT);
    expect(migrationConnectionString({ DATABASE_URL: DIRECT, DIRECT_DATABASE_URL: '' })).toBe(
      DIRECT,
    );
    expect(migrationConnectionString({ DATABASE_URL: DIRECT, DIRECT_DATABASE_URL: '   ' })).toBe(
      DIRECT,
    );
  });

  it('refuses when neither is set, and says what a pooler needs', () => {
    expect(() => migrationConnectionString({})).toThrow(/DIRECT_DATABASE_URL/);
  });

  it('never silently returns the pooled URL when a direct one was asked for', () => {
    // The regression that would matter: a whitespace-only or oddly-cased env
    // var quietly degrading to the pooler is exactly the invisible failure the
    // module header describes.
    const chosen = migrationConnectionString({
      DATABASE_URL: POOLED,
      DIRECT_DATABASE_URL: `  ${DIRECT}  `,
    });
    expect(chosen).toBe(DIRECT);
    expect(chosen).not.toContain('pgbouncer');
  });
});

describe('poolerInFront', () => {
  it('is true only when the two URLs actually differ', () => {
    expect(poolerInFront({ DATABASE_URL: POOLED, DIRECT_DATABASE_URL: DIRECT })).toBe(true);
    // Both set to the same value is a real misconfiguration that looks fine in
    // a compose file — an operator debugging a migration hanging on a lock
    // needs to know the pooler they configured is not actually in front.
    expect(poolerInFront({ DATABASE_URL: DIRECT, DIRECT_DATABASE_URL: DIRECT })).toBe(false);
    expect(poolerInFront({ DATABASE_URL: DIRECT })).toBe(false);
    expect(poolerInFront({})).toBe(false);
  });
});
