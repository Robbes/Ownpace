// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The operator hold — reading it, starting it, ending it (migration 0023).
 *
 * A hold is the one reason a migration can stop that a customer cannot derive
 * from anything on their own screen and cannot wait out predictably. The pass
 * deadline corrects itself within a pass; the daily download ceiling names its
 * own reset time. This is a decision somebody made, and without a sentence
 * from us it looks exactly like a migration that has died.
 *
 * ## Who may do what, and where that is decided
 *
 * In the database, twice. The policies on `platform_pause` let anyone signed
 * in read the OPEN hold and only an operator read the history or write at all;
 * the writes below carry `WHERE EXISTS (platform_operator …)` as well, so a
 * non-operator's request changes nothing and is told nothing rather than
 * handed a policy error to read meaning into. That is the `recordSupportRead`
 * doctrine (0110 T1): an application check that is then trusted invites
 * somebody to simplify the real one away later.
 *
 * ## What a hold does and does not stop
 *
 * `managed-sync-tick` starts nothing while one is open. Passes ALREADY
 * running are left alone and finish normally — that is what makes this a
 * drain rather than a kill, and it is why the tick's log line says how many
 * are still in flight. Nothing here cancels work, and nothing here touches a
 * cursor.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger';

/** The open hold, as anything reading it needs it. */
export interface PlatformPause {
  readonly id: string;
  /** ISO. */
  readonly startedAt: string;
  /**
   * The operator's own words, or undefined when they typed none. A caller
   * showing this to a customer renders it VERBATIM and supplies its own
   * default when it is absent — a hold is never wordless.
   */
  readonly message?: string;
}

/** One hold as an operator reads its history — with who, and when it ended. */
export interface PlatformPauseRecord extends PlatformPause {
  readonly endedAt?: string;
  readonly startedBy: string;
  readonly endedBy?: string;
}

const asIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);

/**
 * Rows out of a raw result, whichever shape the driver hands back.
 *
 * The twin of `offboarding.ts`'s helper, and it exists for the same reason:
 * node-postgres answers `{ rows }` and PGlite's drizzle adapter can answer a
 * bare array, so code that reaches for one of them works in production and
 * returns nothing under the unit tier — or the reverse, which is worse.
 */
function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

interface PauseRow {
  readonly id: string;
  readonly started_at: unknown;
  readonly ended_at?: unknown;
  readonly message: string | null;
  readonly started_by?: string;
  readonly ended_by?: string | null;
}

const asPause = (row: PauseRow): PlatformPause => ({
  id: row.id,
  startedAt: asIso(row.started_at),
  ...(row.message ? { message: row.message } : {}),
});

/**
 * The hold that is on right now, or null.
 *
 * Safe to call as anybody: the SELECT policy admits open rows to every signed-
 * in reader, and a closed one to operators only. It is also called by the tick
 * through the owner connection, which bypasses RLS — deliberately, and the
 * same trust boundary the tick's mapping enumeration documents.
 *
 * `LIMIT 1` is belt over the migration's partial unique index, not instead of
 * it: the database is what guarantees there is only one.
 */
export async function readOpenPause(db: PgDatabase): Promise<PlatformPause | null> {
  const result = await db.execute(
    sql`SELECT id, started_at, message
          FROM platform_pause
         WHERE ended_at IS NULL
         ORDER BY started_at DESC
         LIMIT 1`,
  );
  const row = resultRows<PauseRow>(result)[0];
  return row ? asPause(row) : null;
}

/**
 * Start a hold, as this operator.
 *
 * Answers the hold it created, or null when the caller is not an operator —
 * an absence, not an error, for the reason in the module comment.
 *
 * A second hold while one is open is refused by the database's partial unique
 * index, and that refusal is left to propagate: two open holds would leave
 * every screen choosing which sentence is real, and quietly returning the
 * existing one would hide that the operator's new message was never stored.
 */
export async function startPlatformPause(
  db: PgDatabase,
  input: { readonly operatorUserId: string; readonly message?: string },
): Promise<PlatformPause | null> {
  if (!input.operatorUserId) {
    // The decayed-GUC case (managed migration 0004). A hold attributed to
    // nobody is a hold nobody can be asked about.
    throw new Error(
      'refusing to start a platform hold with no operator subject — a hold nobody is ' +
        'named for is one nobody can be asked about afterwards',
    );
  }
  // Trimmed here rather than at the door: the sentence is shown on a customer
  // screen, and a message long enough to be a page is one nobody reads.
  const message = input.message?.trim() ? input.message.trim().slice(0, 500) : null;
  const result = await db.execute(
    sql`INSERT INTO platform_pause (message, started_by)
        SELECT ${message}, ${input.operatorUserId}
         WHERE EXISTS (SELECT 1 FROM platform_operator
                        WHERE user_id = current_setting('app.current_user', true))
     RETURNING id, started_at, message`,
  );
  const row = resultRows<PauseRow>(result)[0];
  return row ? asPause(row) : null;
}

/**
 * End the open hold, as this operator. Answers whether one was ended.
 *
 * False covers both "there was no hold" and "you are not an operator", and
 * that conflation is on purpose: to a non-operator the table has no rows, so
 * "nothing to end" IS what the database sees.
 */
export async function endPlatformPause(
  db: PgDatabase,
  input: { readonly operatorUserId: string },
): Promise<boolean> {
  const result = await db.execute(
    sql`UPDATE platform_pause
           SET ended_at = now(), ended_by = ${input.operatorUserId}
         WHERE ended_at IS NULL
           AND EXISTS (SELECT 1 FROM platform_operator
                        WHERE user_id = current_setting('app.current_user', true))
     RETURNING id`,
  );
  return resultRows<{ id: string }>(result).length > 0;
}

/**
 * Every hold, newest first — the operator's own view.
 *
 * A non-operator gets the open one and nothing else, because that is what the
 * policies admit. No second check here: the database is the authorisation.
 */
export async function listPlatformPauses(
  db: PgDatabase,
  limit = 50,
): Promise<PlatformPauseRecord[]> {
  const result = await db.execute(
    sql`SELECT id, started_at, ended_at, message, started_by, ended_by
          FROM platform_pause
         ORDER BY started_at DESC
         LIMIT ${limit}`,
  );
  return resultRows<PauseRow>(result).map((row) => ({
    ...asPause(row),
    ...(row.ended_at ? { endedAt: asIso(row.ended_at) } : {}),
    startedBy: row.started_by ?? '',
    ...(row.ended_by ? { endedBy: row.ended_by } : {}),
  }));
}
