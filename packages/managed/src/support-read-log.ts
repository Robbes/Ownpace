// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Recording what an operator looked at (workplan 0110 T1).
 *
 * ## Why this exists at all
 *
 * The owner chose standing, disclosed support access over a consent switch on
 * 2026-08-27. That is a defensible choice and it removes something: a customer
 * could have pointed at a consent row and said when they allowed this. They
 * cannot now, so the accountability moves to the other end — not *"did they
 * allow it"* but ***"what was actually looked at, by whom, when"***.
 *
 * Which is weaker in one way and stronger in another. A consent row says an
 * operator MIGHT have looked. This says whether they DID.
 *
 * ## Written in the caller's transaction, with the read
 *
 * `recordSupportRead` takes the same `db` handle the view is queried through,
 * so the row and the read commit together. That is not tidiness: a log that
 * can fail independently of the thing it logs is a log with holes exactly
 * where somebody would want them. If the insert fails, the read fails, and the
 * operator sees an error rather than data nobody recorded them seeing.
 *
 * The same shape `mapping-status-audit.ts` uses for lifecycle transitions, and
 * for the same reason — it removes the question of what to do when only half
 * succeeds.
 *
 * ## What it does NOT record
 *
 * The rows returned. A log that captured what was on the screen would hold a
 * copy of every customer's metadata, growing forever, under weaker rules than
 * the tables it copied. Who, whose, which screen, when — enough to answer
 * "were you looking at my migration on Tuesday", which is the question.
 */

import { sql } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger';

/** The three screens 0110 T4 serves. A fourth is a design change. */
export const SUPPORT_VIEWS = ['tenants', 'tenant', 'migration'] as const;
export type SupportView = (typeof SUPPORT_VIEWS)[number];

/**
 * Record that an operator was served one view.
 *
 * `tenantId` is null for the tenant LIST, which is a read of everybody: one
 * row saying "the list" is the honest record, where one row per organisation
 * would be a lie about how many decisions were made.
 *
 * Must be called with the SAME `db` the view was read through — see the module
 * comment. Taking the handle as a parameter rather than opening a connection
 * is what makes that hard to get wrong.
 */
export async function recordSupportRead(
  db: PgDatabase,
  read: {
    readonly operatorUserId: string;
    readonly tenantId: string | null;
    readonly view: SupportView;
  },
): Promise<void> {
  if (!read.operatorUserId) {
    // An empty subject is the decayed-GUC case migration 0004 exists for. A
    // row attributing a read to nobody is worse than no row, because it makes
    // the log look complete while an unattributable read passed through.
    throw new Error(
      'refusing to record a support read with no operator subject — an unattributable ' +
        'entry makes the log look complete while hiding exactly what it exists to show',
    );
  }
  // Written only when the caller IS an operator, decided by the SAME predicate
  // the views use rather than by an application check.
  //
  // Found while building the routes that call this: the middleware in front of
  // them is `authenticateSubject`, which asks only for a valid token, and the
  // views themselves return zero rows to a non-operator. So without this, any
  // signed-in person could hit a support route, see nothing — correctly — and
  // still write a row into the log. That is pollution of the one record
  // standing in for the consent the owner dropped, by exactly the people it is
  // not about.
  //
  // `INSERT … SELECT … WHERE EXISTS` rather than a check in TypeScript, for the
  // reason `access-requests.ts` gives about its own routes: an application
  // check that is then trusted invites somebody to "simplify" the real one
  // away later. A non-operator writes nothing and is told nothing — no error,
  // because there is no failure here, only an absence.
  await db.execute(
    sql`INSERT INTO support_read (operator_user_id, tenant_id, view_name)
        SELECT ${read.operatorUserId}, ${read.tenantId}::uuid, ${read.view}
        WHERE EXISTS (
          SELECT 1 FROM public.platform_operator
           WHERE user_id = current_setting('app.current_user', true)
        )`,
  );
}
