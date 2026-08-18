// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Which connection string must NOT go through a connection pooler
 * (workplan 0082 T4).
 *
 * Managed puts PgBouncer in **transaction mode** in front of Postgres, which
 * hands a different server connection to each transaction. That is what makes
 * it worth having — a hundred client connections share a handful of server
 * ones — and it is also what breaks anything that keeps state on a session
 * across transactions.
 *
 * This repo was audited for that before the pooler was introduced, and the
 * result is narrow enough to state completely:
 *
 *  - **`withTenant` is safe.** It opens a transaction, sets the role with
 *    `SET LOCAL` and the tenant with `set_config(..., true)` — both
 *    transaction-scoped — and commits. Nothing survives the transaction, so
 *    nothing can leak into the next borrower of that server connection. This
 *    is the one that would have mattered: `app.current_tenant` IS the RLS
 *    boundary, and a session-scoped version of it under transaction pooling
 *    would be a cross-tenant read.
 *  - **Nothing uses LISTEN/NOTIFY, temp tables, session `SET`, or named
 *    prepared statements** on the Postgres path.
 *  - **Migrations are the exception, and the only one.** `migrate.ts` takes
 *    `pg_advisory_lock`, which is SESSION-scoped by definition, and holds it
 *    across every migration's own transaction. Through a transaction pooler
 *    the lock would be taken on one server connection and the migrations
 *    applied on others — so the mutual exclusion that lets two API replicas
 *    boot at once would silently stop working, which is precisely the
 *    situation it exists for.
 *
 * Hence this: migrations connect direct, everything else goes through the
 * pooler. `DIRECT_DATABASE_URL` is optional — unset, everything uses
 * `DATABASE_URL`, which is the self-host arrangement and the managed one
 * before a pooler is deployed.
 */

/**
 * The URL to run migrations over: direct if one is configured, else the normal one.
 *
 * Deliberately a pure function of its inputs rather than a reader of
 * `process.env`, so the choice can be tested and so a caller that already has
 * its configuration does not have to reach for the environment again.
 */
export function migrationConnectionString(env: {
  readonly DATABASE_URL?: string | undefined;
  readonly DIRECT_DATABASE_URL?: string | undefined;
}): string {
  const direct = env.DIRECT_DATABASE_URL?.trim();
  if (direct) return direct;
  const pooled = env.DATABASE_URL?.trim();
  if (pooled) return pooled;
  throw new Error(
    'No database URL: set DATABASE_URL (and DIRECT_DATABASE_URL when a transaction-mode ' +
      'pooler such as PgBouncer sits in front of Postgres, so migrations can hold their ' +
      'session advisory lock on one connection).',
  );
}

/**
 * Whether a pooler is configured — i.e. whether the two URLs actually differ.
 *
 * Used only to log which arrangement is in force at boot. An operator
 * debugging a migration that hangs on a lock needs to know whether the thing
 * they configured is the thing that is running, and the two URLs being set to
 * the same value is a real misconfiguration that looks fine in a compose file.
 */
export function poolerInFront(env: {
  readonly DATABASE_URL?: string | undefined;
  readonly DIRECT_DATABASE_URL?: string | undefined;
}): boolean {
  const direct = env.DIRECT_DATABASE_URL?.trim();
  const pooled = env.DATABASE_URL?.trim();
  return Boolean(direct && pooled && direct !== pooled);
}
