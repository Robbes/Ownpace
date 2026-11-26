// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The screens an operator gets, and the record of every one served
 * (workplan 0110 T4, over T1's log and T2's views).
 *
 * Three of them drill into a customer — every organisation, then one, then one
 * of its migrations. The fourth, `/retained-invoices`, is not about a customer
 * at all: it serves what an erasure deliberately KEPT, for tenants that no
 * longer exist. That is a different grain rather than a fourth level of
 * drill-down, and the "no fourth level" rule below is untouched by it.
 *
 * ## The middleware does not authorise anybody
 *
 * `authenticateSubject`, not `authenticate`: an operator acts across tenants,
 * so resolving one would refuse them at the door — the same reason
 * `access-requests.ts` gives, and the same doctrine. **What authorises is the
 * database.** Every view in managed migration 0009 carries
 * `EXISTS (SELECT 1 FROM platform_operator WHERE user_id = app.current_user)`,
 * so a non-operator reaching these routes gets empty lists and "not found",
 * because to the database that is exactly what the rows are.
 *
 * Nothing here re-checks "are you an operator" and then trusts the answer. A
 * route that did would invite somebody to later simplify away the real check,
 * one layer down, and never notice.
 *
 * ## Every read is recorded, in the same transaction
 *
 * The owner chose standing, disclosed support access over a consent switch on
 * 2026-08-27, and that removed the record a customer could have pointed at.
 * `support_read` is what replaces it: not *"did they allow it"* but *"what was
 * actually looked at, by whom, when"*.
 *
 * So `recordSupportRead` runs inside the SAME `withSubject` transaction as the
 * view query. A log that could fail independently of the read it logs would
 * have holes exactly where somebody would want them; here, if the row cannot
 * be written the read does not happen either. The helper carries its own
 * `WHERE EXISTS`, so a non-operator's request writes nothing — and is told
 * nothing, because there is no failure, only an absence.
 *
 * ## Metadata only, and the column list is why
 *
 * These routes select from the views and pass rows through. They cannot reach
 * `last_error`, a credential, a config, or anything about the ITEMS being
 * migrated, because the views do not select them — that is the boundary, and
 * it is the database's rather than this file's. What an operator sees of a
 * failure is `last_error_category` (0110 T3), which carries no address, no
 * folder name and no subject.
 *
 * One view is the exception, and it is named: `support_audit_export` (managed
 * migration 0026) selects the audit rows whole, because the audit export's
 * line is made from the whole row. `/audit-export` is its one reader, and
 * passes no row through: each leaves as that line, an address or a file name
 * as its pseudonym and an unclassified field left out.
 *
 * ## The writes, each its own record
 *
 * Five routes here change something rather than read it: the mark that money
 * was given back, an organisation's close and reopen (0139 T7 (b)), and the
 * marking of an organisation as a test and its clearing (0162 T1). Each is its
 * own record of who and when (`money_given_back`; the audit log's
 * `tenant.closed`, `tenant.reopened`, `tenant.test_marker_set` and
 * `tenant.test_marker_cleared`), so none writes a `support_read` row. The
 * close, the reopen and the two test doors are the one place this file asks
 * "is this an operator" itself, and why is said where they are.
 */

import { Router } from 'express';
import { idsThatAreNoUuid } from '../an-id-that-is-no-uuid.ts';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import {
  withSubject,
  holdsASlot,
  PATH_STATES,
  auditExportEventOf,
  auditExportPageQuery,
} from '@openmig/ledger';
import type { LedgerDriver, PathState } from '@openmig/ledger';
import {
  recordSupportRead,
  observedTier,
  listMoneyToGiveBack,
  markMoneyGivenBack,
  isCloseWindow,
  CLOSE_WINDOWS_DAYS,
  holdsMigrationsSaid,
} from '@openmig/managed';
import { cancelRun } from '../job-runner.ts';
import { auditPseudonymKey } from '../audit-key.ts';
import {
  NotAnAppointedOperator,
  REFERENCE_MAX,
  reopenAsOperator,
  runCloseCommand,
} from '../close-account.ts';
import { markAsTestAsOperator, unmarkTestAsOperator } from '../test-organisation.ts';
import {
  LOG_FILTERS,
  LOG_PAGE,
  auditCursorAfter,
  auditExportLine,
  parseAuditExportQuery,
  pseudonymizer,
  logEventPattern,
  parseLogFilters,
  readTestMarker,
  type LogFilters,
} from '@openmig/shared';
import { authenticateSubject, getDbPool } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import {
  CURSOR_TIME_FORMAT,
  SUPPORT_PAGE,
  parseRetainedCursor,
  parseTenantsCursor,
  retainedCursor,
  tenantsCursor,
  type InvoiceAfter,
  type NumbersAfter,
  type RetainedAfter,
} from '../support-page.ts';
import { readiness } from './ready.ts';
import { readStatusPage, type PlatformStatus } from './platform-status.ts';

const router = idsThatAreNoUuid(Router(), {
  // Each operator's route reads its id with `oneUuid` after its 401 and its
  // operator check, and answers 400 "must be one uuid" (support-routes and
  // an-organisation-the-operator-can-close hold it).
  checkedByItsRoutes: {
    tenantId: 'oneUuid after sign-in and the operator check, 400 (support-routes.unit.test.ts)',
    mappingId: 'oneUuid after sign-in and the operator check, 400 (support-routes.unit.test.ts)',
    creditNoteId: 'oneUuid after sign-in and the operator check, 400 (support-routes.unit.test.ts)',
  },
});

/**
 * `Pool | LedgerDriver` and not `Pool`, because that is what `withSubject`
 * takes and what this actually holds: a pool in every deployment, a PGlite
 * driver under `support-routes.unit.test.ts`. Narrowing it to `Pool` would
 * describe the call sites rather than the function, and make the one wiring
 * that exercises these routes against real row security a type lie.
 */
let _dbPool: Pool | LedgerDriver | null = null;
function pool(): Pool | LedgerDriver {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

/**
 * A path parameter that is exactly one uuid, in the one spelling the database
 * gives it (lower case), or null.
 *
 * Not for safety — every value below goes through a bound parameter — but so
 * that a malformed id is a 400 rather than a `22P02` surfacing as a 500. An
 * operator mistyping an id should be told they mistyped it. Lower case, because
 * an id is also a key outside the database: the organisation's migrations lock
 * is keyed on it (`holdTheOrganisationsMigrations`), and `ABC…` and `abc…`
 * name one organisation. Exported for its test.
 */
export function oneUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

type Row = Record<string, unknown>;

/**
 * The month's tier so far, from what `support_tenant_usage` serves (0109 T4
 * surfaced on the operator screen).
 *
 * Read-only on purpose. `currentTier` trues the month up — it WRITES the peak
 * it is about to read — because it runs at a moment that prices something. An
 * operator looking must not move a billing mark, so the view serves the
 * recorded peak and the live per-state counts side by side, and `observedTier`
 * derives from the higher of the two — the same answer the calculator would
 * give, with nothing written. The unit test pins that parity against
 * `currentTier` over a real database.
 *
 * Which states hold a slot is `holdsASlot`'s call, made here in code on the
 * raw counts rather than restated in the view's SQL — one authority. The view
 * keys a stopped path as its state with ` (stopped)` after it (managed 0029),
 * and the stop is asked of the same rule (0128 T4, D2 (c)). A key this build
 * does not know counts as holding nothing: the same
 * read-back-through-the-guard rule the failure-category rendering follows,
 * and the direction that cannot overstate what a customer would pay.
 */
function usageForScreen(row: Row | undefined) {
  const byState = (row?.paths_by_state ?? {}) as Record<string, unknown>;
  const pathsNow = Object.entries(byState).reduce((n, [key, count]) => {
    const [, state, stopped] = /^([a-z]+)( \(stopped\))?$/.exec(key) ?? [];
    const known = state !== undefined && (PATH_STATES as readonly string[]).includes(state);
    return known && holdsASlot(state as PathState, stopped !== undefined) ? n + Number(count) : n;
  }, 0);
  const recordedPeak = row?.peak_paths == null ? 0 : Number(row.peak_paths);
  const gbMoved = Number(row?.bytes_moved ?? 0) / 1e9;
  const { tier, decidedBy, evidence } = observedTier(recordedPeak, pathsNow, gbMoved);
  return {
    // Null past the table's end — the same deliberate "talk to us" the site
    // publishes and the calculator returns.
    tier: tier
      ? {
          id: tier.id,
          name: tier.name,
          paths: tier.paths,
          data_gb: tier.dataGb,
          monthly_cents: tier.monthlyCents,
          annual_cents: tier.annualCents,
        }
      : null,
    decided_by: decidedBy,
    // Exactly what an invoice would quote — the calculator's own evidence
    // shape, so the parity test can compare field by field.
    evidence: { peak_paths: evidence.peakPaths, gb_moved: evidence.gbMoved },
    // ...and the raw observations behind it, for the operator reading it.
    recorded_peak_paths: recordedPeak,
    recorded_peak_at: row?.peak_at ?? null,
    paths_now: pathsNow,
    paths_by_state: byState,
  };
}

/**
 * Level 1 — every organisation, a page at a time (workplan 0006 §P).
 *
 * Recorded as ONE read with a null tenant. A row per organisation would be a
 * lie about how many decisions were made: the operator made one, to look at
 * the list.
 *
 * ## Paging, and what a later page records
 *
 * By name, then id, `SUPPORT_PAGE` rows a page; `next` is the cursor that
 * continues after the last row served, `null` on the last page. Names are not
 * unique, so the id is what gives every row one place: without it two
 * organisations of the same name could straddle a page break and one of them
 * be skipped.
 *
 * Every page writes its own `support_read` row, the later ones too. *Show
 * more* is the operator deciding to look at organisations they had not seen,
 * and the log records what was actually looked at, so a second page is a
 * second read, as each page of `/log` is. One row for the first page alone
 * would let an operator read every organisation past the first hundred with
 * nothing to show for it. The row carries no query and no count: the database
 * refuses both for any view but `people`, `log` and `audit_export` (managed
 * migrations 0019, 0025, 0026), and this change does not widen that.
 */
router.get('/tenants', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return void res
        .status(401)
        .json({ error: 'Unauthorized', message: 'No subject on this request' });
    }
    const after = parseTenantsCursor(req.query.after);
    if (after === undefined) {
      return void res
        .status(400)
        .json({ error: 'Bad request', field: 'after', message: 'after is not a cursor this list gave' });
    }
    const page = await withSubject(pool(), userId, async (db) => {
      const result = await db.execute(
        sql`SELECT tenant_id, tenant_name, tenant_status, joined_at,
                   migration_count, failing_domain_count, pending_decision_count,
                   connection_count, member_count, last_pass_at, closed_at, purge_after
              FROM public.support_tenants
             WHERE ${after ? sql`(tenant_name, tenant_id) > (${after.name}, ${after.id}::uuid)` : sql`true`}
             ORDER BY tenant_name, tenant_id
             LIMIT ${SUPPORT_PAGE + 1}`,
      );
      const rows = result.rows as Row[];
      // Logged even when the list comes back empty: to a non-operator it is
      // empty, and `recordSupportRead` writes nothing for them, so an empty
      // list plus a log row is an operator on a platform with no customers,
      // while an empty list and no row is somebody who was never an operator.
      // Skipping the call on zero rows would erase that difference.
      await recordSupportRead(db, { operatorUserId: userId, tenantId: null, view: 'tenants' });
      return { served: rows.slice(0, SUPPORT_PAGE), more: rows.length > SUPPORT_PAGE };
    });
    const last = page.served[page.served.length - 1];
    res.json({
      tenants: page.served,
      next:
        page.more && last
          ? tenantsCursor({ name: String(last.tenant_name), id: String(last.tenant_id) })
          : null,
    });
  } catch (error) {
    serverFault(res, 'support_tenants_failed', 'reading the support tenant list', error);
  }
});

/**
 * Level 2 — one organisation: its connections, migrations and invoices.
 *
 * A tenant that does not exist and a tenant the caller may not see are the
 * SAME answer, deliberately: 404 either way. A non-operator must not be able
 * to tell whether an id exists — the same rule `access-requests.ts` applies to
 * its own ids, for the same reason.
 */
router.get(
  '/tenants/:tenantId',
  authenticateSubject,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return void res
          .status(401)
          .json({ error: 'Unauthorized', message: 'No subject on this request' });
      }
      const tenantId = oneUuid(req.params.tenantId);
      if (!tenantId) {
        return void res
          .status(400)
          .json({ error: 'Bad request', message: 'tenantId must be one uuid' });
      }

      const found = await withSubject(pool(), userId, async (db) => {
        const head = await db.execute(
          sql`SELECT tenant_id, tenant_name, tenant_status, joined_at,
                     migration_count, failing_domain_count, pending_decision_count,
                     connection_count, member_count, last_pass_at, closed_at, purge_after,
                     test_marker
                FROM public.support_tenants WHERE tenant_id = ${tenantId}::uuid`,
        );
        const tenantRows = head.rows as Row[];
        if (tenantRows.length === 0) return null;

        const connections = await db.execute(
          sql`SELECT connection_id, role, kind, display_name, status, created_at, updated_at
                FROM public.support_tenant_connections
               WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at`,
        );
        const migrations = await db.execute(
          sql`SELECT mapping_id, name, lifecycle, mode, pattern, schedule,
                     created_at, updated_at, pending_decision_count, test_marker
                FROM public.support_tenant_migrations
               WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at`,
        );
        const invoices = await db.execute(
          sql`SELECT invoice_id, period_start, period_end, status, total, currency, paid_at,
                     invoice_number, kind
                FROM public.support_tenant_invoices
               WHERE tenant_id = ${tenantId}::uuid ORDER BY period_start DESC`,
        );
        const usage = await db.execute(
          sql`SELECT peak_paths, peak_at, bytes_moved, paths_by_state
                FROM public.support_tenant_usage
               WHERE tenant_id = ${tenantId}::uuid`,
        );
        // WHO MAY ACT ON THIS ORGANISATION (migration 0018). Ordered so the
        // people who can decide things come first — a support conversation
        // almost always starts with "who is the owner" — and by address after
        // that, so the list does not reshuffle between reads.
        const members = await db.execute(
          sql`SELECT user_id, email, role, status, invited_at, joined_at
                FROM public.support_tenant_members
               WHERE tenant_id = ${tenantId}::uuid
               ORDER BY CASE role
                          WHEN 'owner'  THEN 0
                          WHEN 'admin'  THEN 1
                          WHEN 'member' THEN 2
                          ELSE 3
                        END, email`,
        );

        // The organisation's address changes, COUNTED (workplan 0168 D7): how
        // many rows and how many confirmed. The view has no address column, so
        // this read cannot serve one.
        const addressChanges = await db.execute(
          sql`SELECT row_count, confirmed_count
                FROM public.support_tenant_address_changes
               WHERE tenant_id = ${tenantId}::uuid`,
        );

        // Recorded only once the tenant was actually found and served: a 404 is
        // not a read of anybody's data, and logging one would put organisations
        // in the record that the operator never saw.
        await recordSupportRead(db, { operatorUserId: userId, tenantId, view: 'tenant' });

        return {
          tenant: tenantRows[0] as Row,
          connections: connections.rows as Row[],
          migrations: migrations.rows as Row[],
          invoices: invoices.rows as Row[],
          members: members.rows as Row[],
          usage: usageForScreen(usage.rows[0] as Row | undefined),
          addressChanges: addressChangeCounts(addressChanges.rows[0] as Row | undefined),
        };
      });

      if (!found) {
        return void res.status(404).json({ error: 'Not found', message: 'No such organisation' });
      }
      res.json(found);
    } catch (error) {
      serverFault(res, 'support_tenant_failed', 'reading one organisation', error);
    }
  },
);

/**
 * The address-change counts as the screen reads them (workplan 0168 D7). The
 * view answers one row for every organisation it serves, so a missing row is
 * an organisation the view did not serve, and is said as none rather than
 * guessed.
 */
function addressChangeCounts(row: Row | undefined): { rows: number; confirmed: number } {
  return { rows: Number(row?.row_count ?? 0), confirmed: Number(row?.confirmed_count ?? 0) };
}

/**
 * The reference an operator's close or reopen keeps on its audit row: the
 * tester's request, or why. Trimmed, required, at most `REFERENCE_MAX`
 * characters, the rule `operator.sh close` applies to `--reference`.
 */
function referenceOf(value: unknown): string | { error: string } {
  const reference = typeof value === 'string' ? value.trim() : '';
  if (reference === '') {
    return { error: 'reference names the request you act on: a ticket, or the date of their mail' };
  }
  if (reference.length > REFERENCE_MAX) {
    return { error: `reference is at most ${REFERENCE_MAX} characters` };
  }
  return reference;
}

/**
 * An organisation's status, as the signed-in subject's `support_tenants` serves
 * it, or null: for an id that names no organisation and for a subject who is no
 * operator alike, because to that subject the view holds no such row.
 */
async function statusAsServed(subject: string, tenantId: string): Promise<string | null> {
  return withSubject(pool(), subject, async (db) => {
    const found = await db.execute(
      sql`SELECT tenant_status FROM public.support_tenants WHERE tenant_id = ${tenantId}::uuid`,
    );
    const row = found.rows[0] as Row | undefined;
    return row ? String(row.tenant_status) : null;
  });
}

/**
 * THE OPERATOR CLOSES AN ORGANISATION (workplan 0139 T7 (b)): the support
 * page's Close, for a tester who asked (terms §11) and cannot press their own,
 * or an organisation nobody uses.
 *
 * It is the close `operator.sh close` makes, through the same function
 * (`runCloseCommand`, over `closeAccount`): the same dates, the same sentences
 * in both languages, the same passes asked to stop, and the same audit row,
 * `tenant.closed` with the operator as its actor and the reference beside
 * `via: operator`.
 *
 * ## Here the database does not decide alone
 *
 * Every read on this surface is authorised by the views. A close is a write in
 * the organisation's own context, where row security lets the organisation's
 * rows through to anybody, so the subject is asked about twice before it: the
 * organisation must be on the subject's `support_tenants`, which is an
 * operator's view and holds only organisations that exist, and
 * `runCloseCommand` asks `platform_operator` itself, as it does at the
 * machine. A subject who is not an operator gets the 404 every route here
 * gives, and nothing is closed.
 *
 * ## What it answers
 *
 * 400 for a window outside `CLOSE_WINDOWS_DAYS` or a missing reference, before
 * anything is read. 409 for an organisation that is not open: one closed
 * already keeps its window, which a reopen undoes, and one being erased cannot
 * be closed. 200 with the close's own answer, which the page shows: both dates,
 * and what to tell them, in English and in Dutch.
 */
router.post(
  '/tenants/:tenantId/close',
  authenticateSubject,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const operator = req.userId;
      if (!operator) {
        return void res
          .status(401)
          .json({ error: 'Unauthorized', message: 'No subject on this request' });
      }
      const tenantId = oneUuid(req.params.tenantId);
      if (!tenantId) {
        return void res.status(400).json({ error: 'Bad request', message: 'tenantId must be one uuid' });
      }
      const body = (req.body ?? {}) as { windowDays?: unknown; reference?: unknown };
      const windowDays = body.windowDays;
      if (!isCloseWindow(windowDays)) {
        return void res.status(400).json({
          error: 'bad_window',
          message:
            `windowDays must be one of ${CLOSE_WINDOWS_DAYS.join(', ')}: the days before the erasure. ` +
            '0 erases at the next purge, and cannot be undone.',
          allowed: CLOSE_WINDOWS_DAYS,
        });
      }
      const reference = referenceOf(body.reference);
      if (typeof reference !== 'string') {
        return void res.status(400).json({ error: 'bad_reference', message: reference.error });
      }

      const status = await statusAsServed(operator, tenantId);
      if (status === null) {
        return void res.status(404).json({ error: 'Not found', message: 'No such organisation' });
      }
      if (status !== 'active') {
        return void res.status(409).json({
          error: 'not_open',
          message:
            status === 'closed'
              ? 'It is closed already: its window stands until a reopen undoes it'
              : 'Its erasure has begun, so there is nothing to close',
        });
      }

      const closed = await runCloseCommand(
        pool(),
        { tenantId, windowDays, by: operator, reference },
        // Built only when a pass in flight has to be asked to stop.
        { cancelRun },
      );
      res.json(closed);
    } catch (error) {
      if (error instanceof NotAnAppointedOperator) {
        return void res.status(404).json({ error: 'Not found', message: 'No such organisation' });
      }
      // The purge took it between the read above and the close: a refusal,
      // said as one, not a fault.
      const message = error instanceof Error ? error.message : String(error);
      if (/purge has already started/.test(message)) {
        return void res.status(409).json({
          error: 'not_open',
          message: 'Its erasure has begun, so there is nothing to close',
        });
      }
      serverFault(res, 'support_close_failed', 'closing an organisation', error);
    }
  },
);

/**
 * The support page's Reopen, while the window is open (0139 T7 (b)): a close
 * made by mistake, or a tester who changed their mind before the erasure.
 * `reopenAccount`, the function the owner's Reopen calls, recorded as
 * `tenant.reopened` under the operator with the reference.
 *
 * Asked about twice, as the close is. 409 for an organisation that is not
 * closed, and for one whose window has run out, which a window of 0 has from
 * the moment it closed.
 */
router.post(
  '/tenants/:tenantId/reopen',
  authenticateSubject,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const operator = req.userId;
      if (!operator) {
        return void res
          .status(401)
          .json({ error: 'Unauthorized', message: 'No subject on this request' });
      }
      const tenantId = oneUuid(req.params.tenantId);
      if (!tenantId) {
        return void res.status(400).json({ error: 'Bad request', message: 'tenantId must be one uuid' });
      }
      const reference = referenceOf((req.body as { reference?: unknown } | undefined)?.reference);
      if (typeof reference !== 'string') {
        return void res.status(400).json({ error: 'bad_reference', message: reference.error });
      }

      const status = await statusAsServed(operator, tenantId);
      if (status === null) {
        return void res.status(404).json({ error: 'Not found', message: 'No such organisation' });
      }
      if (status !== 'closed') {
        return void res.status(409).json({
          error: 'cannot_reopen',
          message: status === 'active' ? 'It is open' : 'Its erasure has begun',
        });
      }

      await reopenAsOperator(pool(), { tenantId, by: operator, reference });
      res.json({ status: 'active' });
    } catch (error) {
      if (error instanceof NotAnAppointedOperator) {
        return void res.status(404).json({ error: 'Not found', message: 'No such organisation' });
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/window has already passed|not closed/.test(message)) {
        return void res.status(409).json({
          error: 'cannot_reopen',
          message: 'Its window has run out: the erasure is due, and a reopen can no longer happen',
        });
      }
      serverFault(res, 'support_reopen_failed', 'reopening an organisation', error);
    }
  },
);

/**
 * THE OPERATOR MARKS AN ORGANISATION AS A TEST (workplan 0162 T1, §3; the
 * owner's §2 (b); ADR-0053): `POST` with `{ marker }` sets its marker, or
 * replaces it, and `DELETE` clears it. Every migration made in a test
 * organisation copies the marker onto its own row when it is created, and
 * then copies only the items whose own title contains it (§2 (a), (c)).
 *
 * Asked about twice, as the close is: the organisation must be on the
 * subject's `support_tenants`, and `platform_operator` must hold the subject
 * (`markAsTestAsOperator`, `unmarkTestAsOperator`). Anybody else gets the 404
 * every route here gives, and nothing is written.
 *
 * ## What it answers
 *
 * 400 for a marker that is not 3 to 64 printable characters once trimmed,
 * before anything is read (`readTestMarker`): the API requires one, and
 * `[Ownpace-test]` is what the screen offers, never what is assumed. 409
 * `not_open` for an organisation that is not open, as the close and the
 * reopen ask: one closed, or being erased, is neither marked nor unmarked.
 * The door asks it in its own transaction, and holds the answer there until
 * it commits, so a close cannot commit between the answer and the mark
 * (0162 T1's re-review); the view's answer, read before, only decides the
 * 404. 409 `holds_a_migration` while the organisation holds any migration,
 * whatever its status (§2 (b)), with the sentence the screen shows. 200 with
 * the marker set, or cleared; for the marker it already had, 200 with
 * `unchanged`, and nothing written or recorded.
 */
/** The refusal for an organisation that is not open, said for either door. */
function notOpenForATest(status: string): { error: 'not_open'; message: string } {
  const only = 'an organisation is marked as a test, or no longer, only while it is open';
  return {
    error: 'not_open',
    message:
      status === 'closed'
        ? `It is closed: ${only}`
        : status === 'deleting'
          ? 'Its erasure has begun, so it is neither marked as a test nor unmarked'
          : `It is ${status}: ${only}`,
  };
}

/**
 * A door's own transaction found the organisation not open: 409 `not_open`;
 * or, for one no longer there, the 404 every route here gives for an id that
 * names nobody.
 */
function refusedAsNotOpen(res: Response, status: string | null): void {
  if (status === null) {
    res.status(404).json({ error: 'Not found', message: 'No such organisation' });
    return;
  }
  res.status(409).json(notOpenForATest(status));
}

router.post(
  '/tenants/:tenantId/test',
  authenticateSubject,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const operator = req.userId;
      if (!operator) {
        return void res
          .status(401)
          .json({ error: 'Unauthorized', message: 'No subject on this request' });
      }
      const tenantId = oneUuid(req.params.tenantId);
      if (!tenantId) {
        return void res.status(400).json({ error: 'Bad request', message: 'tenantId must be one uuid' });
      }
      const read = readTestMarker((req.body as { marker?: unknown } | undefined)?.marker);
      if ('refused' in read) {
        return void res.status(400).json({ error: 'bad_marker', message: read.refused });
      }

      // The operator's view says whether this subject may see the
      // organisation at all. Whether it is open is the door's own question,
      // asked and held in its transaction.
      if ((await statusAsServed(operator, tenantId)) === null) {
        return void res.status(404).json({ error: 'Not found', message: 'No such organisation' });
      }
      const marked = await markAsTestAsOperator(pool(), { tenantId, by: operator, marker: read.marker });
      if ('notOpen' in marked) return void refusedAsNotOpen(res, marked.notOpen);
      if ('held' in marked) {
        return void res.status(409).json({
          error: 'holds_a_migration',
          held: marked.held,
          message: holdsMigrationsSaid(marked.held, 'mark'),
        });
      }
      if ('unchanged' in marked) return void res.json({ testMarker: marked.marker, unchanged: true });
      res.json({ testMarker: marked.marker, ...(marked.replaced !== undefined ? { replaced: marked.replaced } : {}) });
    } catch (error) {
      if (error instanceof NotAnAppointedOperator) {
        return void res.status(404).json({ error: 'Not found', message: 'No such organisation' });
      }
      serverFault(res, 'support_test_mark_failed', 'marking an organisation as a test', error);
    }
  },
);

router.delete(
  '/tenants/:tenantId/test',
  authenticateSubject,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const operator = req.userId;
      if (!operator) {
        return void res
          .status(401)
          .json({ error: 'Unauthorized', message: 'No subject on this request' });
      }
      const tenantId = oneUuid(req.params.tenantId);
      if (!tenantId) {
        return void res.status(400).json({ error: 'Bad request', message: 'tenantId must be one uuid' });
      }

      // As the mark: the view decides the 404, the door whether it is open.
      if ((await statusAsServed(operator, tenantId)) === null) {
        return void res.status(404).json({ error: 'Not found', message: 'No such organisation' });
      }
      const unmarked = await unmarkTestAsOperator(pool(), { tenantId, by: operator });
      if ('notOpen' in unmarked) return void refusedAsNotOpen(res, unmarked.notOpen);
      if ('held' in unmarked) {
        return void res.status(409).json({
          error: 'holds_a_migration',
          held: unmarked.held,
          message: holdsMigrationsSaid(unmarked.held, 'unmark'),
        });
      }
      // Null for an organisation that was not a test: nothing changed, and
      // nothing was recorded.
      res.json({ testMarker: null, cleared: unmarked.cleared ?? null });
    } catch (error) {
      if (error instanceof NotAnAppointedOperator) {
        return void res.status(404).json({ error: 'Not found', message: 'No such organisation' });
      }
      serverFault(res, 'support_test_unmark_failed', "clearing an organisation's test marker", error);
    }
  },
);

/**
 * Level 3 — one migration, per domain.
 *
 * There is deliberately no fourth level. A screen that lists items is a screen
 * that shows subject lines, and the metadata boundary stops before the thing
 * being migrated.
 */
router.get(
  '/migrations/:mappingId',
  authenticateSubject,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return void res
          .status(401)
          .json({ error: 'Unauthorized', message: 'No subject on this request' });
      }
      const mappingId = oneUuid(req.params.mappingId);
      if (!mappingId) {
        return void res
          .status(400)
          .json({ error: 'Bad request', message: 'mappingId must be one uuid' });
      }

      const found = await withSubject(pool(), userId, async (db) => {
        const head = await db.execute(
          sql`SELECT tenant_id, mapping_id, name, lifecycle, mode, pattern, schedule,
                     created_at, updated_at, pending_decision_count, test_marker
                FROM public.support_tenant_migrations WHERE mapping_id = ${mappingId}::uuid`,
        );
        const migrationRows = head.rows as Row[];
        if (migrationRows.length === 0) return null;
        const migration = migrationRows[0] as Row & { tenant_id: string };

        const domains = await db.execute(
          sql`SELECT domain, state, started_at, updated_at, completed_at,
                     last_error_category, failed_side, last_pass_metrics
                FROM public.support_migration_domains
               WHERE mapping_id = ${mappingId}::uuid ORDER BY domain`,
        );

        // The tenant recorded is the migration's OWN, read back from the view
        // rather than taken from the request. There is no path here for an
        // operator to name the organisation a read gets attributed to.
        await recordSupportRead(db, {
          operatorUserId: userId,
          tenantId: migration.tenant_id,
          view: 'migration',
        });

        return { migration, domains: domains.rows as Row[] };
      });

      if (!found) {
        return void res.status(404).json({ error: 'Not found', message: 'No such migration' });
      }
      res.json(found);
    } catch (error) {
      serverFault(res, 'support_migration_failed', 'reading one migration', error);
    }
  },
);

/**
 * Finding a person, across every organisation (owner request 2026-08-31).
 *
 * ## Why this exists beside the per-organisation list
 *
 * Migration 0018 put an organisation's people on its own screen, which answers
 * "who is in THIS organisation" and only that. The question an operator
 * actually starts from is the other way round — somebody made contact, who are
 * they and what are they on — and answering it from the per-organisation list
 * means guessing which organisation to open. That is a memory test, not a
 * surface, and it stops working at about the fifth customer.
 *
 * ## No new view, deliberately
 *
 * `support_tenant_members` carries the people and `support_tenants` carries the
 * organisation's name, both behind the same `platform_operator` predicate. This
 * JOINS them rather than declaring a third view, so neither fact gets a second
 * authority to drift from — and the guard is unchanged, because it is the same
 * guard, twice.
 *
 * ## The search is a read, and it is recorded as one
 *
 * This is the widest read the support surface can perform: not one customer,
 * all of them. So it is logged with WHAT was searched for and HOW MANY came
 * back (0019) — "an operator ran a search" cannot tell somebody answering one
 * email from somebody enumerating the customer base, and those two facts can.
 * The log is readable only by the operator who wrote it (0009's policy), which
 * is what makes storing the query safe rather than a second exposure.
 *
 * ## Two refusals rather than a helpful default
 *
 * A blank or one-character query would match everybody, and "the operator
 * pressed enter in an empty box" is not a reason to serve every customer's
 * people in one screen. It refuses instead, and the ceiling is a cap rather
 * than a page: a support answer is one person, and a hundred rows means the
 * question was wrong.
 */
const PEOPLE_QUERY_MIN = 2;
const PEOPLE_LIMIT = 50;

router.get('/people', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return void res
        .status(401)
        .json({ error: 'Unauthorized', message: 'No subject on this request' });
    }
    const raw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (raw.length < PEOPLE_QUERY_MIN) {
      return void res.status(400).json({
        error: 'Bad request',
        message: `Search for at least ${PEOPLE_QUERY_MIN} characters — a shorter one matches everybody, and every customer's people is not an answer to a blank box.`,
      });
    }

    // ESCAPED, because the operator's own typing reaches a LIKE pattern. A `%`
    // in the box would otherwise widen the match rather than look for a percent
    // sign, which is a small surprise on a screen where the difference is
    // "one person" versus "all of them".
    const pattern = `%${raw.replace(/([\\%_])/g, '\\$1')}%`;

    const people = await withSubject(pool(), userId, async (db) => {
      const found = await db.execute(
        sql`SELECT m.tenant_id, t.tenant_name, m.user_id, m.email, m.role, m.status, m.joined_at
              FROM public.support_tenant_members m
              JOIN public.support_tenants t ON t.tenant_id = m.tenant_id
             WHERE m.email ILIKE ${pattern} ESCAPE '\\'
             ORDER BY m.email
             LIMIT ${PEOPLE_LIMIT}`,
      );
      const rows = found.rows as Row[];
      // Recorded with what came back, not with what was asked for alone — and
      // AFTER the read, so a search that failed does not claim one happened.
      await recordSupportRead(db, {
        operatorUserId: userId,
        tenantId: null,
        view: 'people',
        query: raw,
        resultCount: rows.length,
      });
      return rows;
    });

    res.json({ people, limit: PEOPLE_LIMIT });
  } catch (error) {
    serverFault(res, 'support_people_failed', 'searching for a person', error);
  }
});

/**
 * An operator followed a result through to that account at the provider.
 *
 * The click leaves Ownpace — the account-level work is the issuer's and never
 * ours (ADR-0042) — so this is the last thing we can honestly record about it.
 * The owner asked for both halves: the search, and the opening of a result.
 *
 * IT VERIFIES THE PAIR BEFORE WRITING. Not to authorise anything — the log's
 * INSERT is already gated on being an operator — but because a row naming a
 * tenant and a subject that were never related to each other is a false entry
 * in the one record standing in for the consent the owner dropped. A log that
 * can be written with anything is a log nobody can rely on.
 *
 * Answers 204: there is nothing to return, and the screen must not wait on it.
 */
router.post(
  '/people/:tenantId/:userId/opened',
  authenticateSubject,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const operator = req.userId;
      if (!operator) {
        return void res
          .status(401)
          .json({ error: 'Unauthorized', message: 'No subject on this request' });
      }
      const tenantId = oneUuid(req.params.tenantId);
      const subject = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
      if (!tenantId || !subject) {
        return void res.status(400).json({
          error: 'Bad request',
          message: 'tenantId must be one uuid, and userId must be a subject',
        });
      }

      const known = await withSubject(pool(), operator, async (db) => {
        const found = await db.execute(
          sql`SELECT 1 FROM public.support_tenant_members
               WHERE tenant_id = ${tenantId}::uuid AND user_id = ${subject}
               LIMIT 1`,
        );
        if (found.rows.length === 0) return false;
        await recordSupportRead(db, { operatorUserId: operator, tenantId, view: 'person' });
        return true;
      });

      if (!known) {
        // The same answer for "no such membership" and "not yours to see", for
        // the reason every route here gives: telling them apart undoes what the
        // views refuse to say.
        return void res.status(404).json({ error: 'Not found', message: 'No such person' });
      }
      res.status(204).end();
    } catch (error) {
      serverFault(res, 'support_person_opened_failed', 'recording that an account was opened', error);
    }
  },
);

/**
 * The invoices an erasure kept — the one screen that is not about a customer.
 *
 * Every other route here hangs off a tenant. This one cannot: the tenants it
 * concerns have been deleted, and what remains is `erasure_record.tenant_ref`,
 * a sha256 of an id nobody kept. So the grain is the erasure, not the
 * organisation, and the most it will say about who an invoice was for is
 * `billed_to_name`, stamped at issue time by the purge itself.
 *
 * That asymmetry is deliberate rather than a limitation to be fixed later. An
 * operator can answer "what are we obliged to keep, and what does each one
 * say", which is the administrative question this exists for. They cannot walk
 * it back to a person, which is the question the erasure closed.
 *
 * Since 0111 T10 the books keep the invoices: an erasure deletes our copy of
 * each invoice the books hold and keeps its Moneybird number. So the answer
 * is mostly `numbers`, per erasure, to look up in Moneybird; `invoices` holds
 * only an issued invoice the books do not hold, kept detached here.
 *
 * Recorded with a NULL tenant, like the tenant LIST and for a stronger version
 * of the same reason: there is no tenant to name, and no tenant left to name
 * it about.
 *
 * ## Paging (workplan 0006 §P)
 *
 * Both lists, `SUPPORT_PAGE` rows each a page, in the order they always had,
 * each with a last column that makes a row's place unique: the invoice's id
 * after its period, and the erasure's `tenant_ref` after its purge. Only a
 * purge writes `retained_invoice_ids` and `invoice_numbers`, and a tenant is
 * purged once, so one `tenant_ref` is one row of the numbers list. A NULL
 * `purged_at` sorts last and is paged like any other value, though a row
 * reaches either view only once purged.
 *
 * One cursor carries where each list continues, or that it has ended; `next`
 * is `null` once both have. A later page reads only the list that has more,
 * and serves the other empty, so *Show more* adds rows to whichever list they
 * belong to and never repeats one.
 *
 * Each page writes its own `support_read` row, for the reason `/tenants`
 * gives: a later page is rows the operator had not seen, looked at by choice.
 */
router.get(
  '/retained-invoices',
  authenticateSubject,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return void res
          .status(401)
          .json({ error: 'Unauthorized', message: 'No subject on this request' });
      }
      const after = parseRetainedCursor(req.query.after);
      if (after === undefined) {
        return void res
          .status(400)
          .json({ error: 'Bad request', field: 'after', message: 'after is not a cursor this list gave' });
      }
      // On the first page both lists start; on a later one, only a list the
      // cursor says has more is read at all.
      const readInvoices = after === null || after.invoices !== null;
      const readNumbers = after === null || after.numbers !== null;
      const page = await withSubject(pool(), userId, async (db) => {
        const invoices = readInvoices
          ? ((
              await db.execute(
                sql`SELECT tenant_ref, erasure_requested_at, purged_at, invoice_id,
                           billed_to_name, period_start, period_end, status, total,
                           currency, paid_at,
                           to_char(purged_at AT TIME ZONE 'UTC', ${CURSOR_TIME_FORMAT}) AS page_purged_at,
                           period_start::text AS page_period_start
                      FROM public.support_retained_invoices
                     WHERE ${after?.invoices ? invoicesAfter(after.invoices) : sql`true`}
                     ORDER BY purged_at DESC NULLS LAST, period_start DESC, invoice_id DESC
                     LIMIT ${SUPPORT_PAGE + 1}`,
              )
            ).rows as Row[])
          : [];
        // The numbers of the copies an erasure deleted (0111 T10): what the
        // books hold, found there by number. One screen, so one read below.
        const numbers = readNumbers
          ? ((
              await db.execute(
                sql`SELECT tenant_ref, erasure_requested_at, purged_at, invoice_numbers,
                           to_char(purged_at AT TIME ZONE 'UTC', ${CURSOR_TIME_FORMAT}) AS page_purged_at
                      FROM public.support_erased_invoice_numbers
                     WHERE ${after?.numbers ? numbersAfter(after.numbers) : sql`true`}
                     ORDER BY purged_at DESC NULLS LAST, tenant_ref DESC
                     LIMIT ${SUPPORT_PAGE + 1}`,
              )
            ).rows as Row[])
          : [];
        // Logged even when empty, for the reason `/tenants` gives: an operator
        // on a platform that has erased nobody and a non-operator who may see
        // nothing produce the same empty list, and only the log row tells them
        // apart.
        await recordSupportRead(db, {
          operatorUserId: userId,
          tenantId: null,
          view: 'retained_invoices',
        });
        return { invoices, numbers };
      });

      const invoices = page.invoices.slice(0, SUPPORT_PAGE);
      const numbers = page.numbers.slice(0, SUPPORT_PAGE);
      const lastInvoice = page.invoices.length > SUPPORT_PAGE ? invoices[invoices.length - 1] : undefined;
      const lastNumbers = page.numbers.length > SUPPORT_PAGE ? numbers[numbers.length - 1] : undefined;
      const next: RetainedAfter = {
        invoices: lastInvoice
          ? {
              purgedAt: (lastInvoice.page_purged_at as string | null) ?? null,
              periodStart: String(lastInvoice.page_period_start),
              invoiceId: String(lastInvoice.invoice_id),
            }
          : null,
        numbers: lastNumbers
          ? {
              purgedAt: (lastNumbers.page_purged_at as string | null) ?? null,
              tenantRef: String(lastNumbers.tenant_ref),
            }
          : null,
      };
      res.json({
        invoices: invoices.map(withoutPageKeys),
        numbers: numbers.map(withoutPageKeys),
        next: next.invoices || next.numbers ? retainedCursor(next) : null,
      });
    } catch (error) {
      serverFault(
        res,
        'support_retained_invoices_failed',
        'reading the invoices kept after erasure',
        error,
      );
    }
  },
);

/** The columns read only to build the cursor, which the response does not carry. */
function withoutPageKeys(row: Row): Row {
  const { page_purged_at: _purgedAt, page_period_start: _periodStart, ...served } = row;
  return served;
}

/**
 * After a kept invoice, in `purged_at DESC NULLS LAST, period_start DESC,
 * invoice_id DESC`. A row comparison cannot say NULLS LAST, so the first
 * column is spelled out: a later purge time, the same one and a later rest, or
 * no purge time at all (those sort after every time).
 */
function invoicesAfter(at: InvoiceAfter) {
  const rest = sql`(period_start, invoice_id) < (${at.periodStart}::date, ${at.invoiceId}::uuid)`;
  if (at.purgedAt === null) return sql`(purged_at IS NULL AND ${rest})`;
  const t = sql`${at.purgedAt}::timestamptz`;
  return sql`(purged_at < ${t} OR (purged_at = ${t} AND ${rest}) OR purged_at IS NULL)`;
}

/** After an erasure's numbers, in `purged_at DESC NULLS LAST, tenant_ref DESC`. */
function numbersAfter(at: NumbersAfter) {
  const rest = sql`tenant_ref < ${at.tenantRef}`;
  if (at.purgedAt === null) return sql`(purged_at IS NULL AND ${rest})`;
  const t = sql`${at.purgedAt}::timestamptz`;
  return sql`(purged_at < ${t} OR (purged_at = ${t} AND ${rest}) OR purged_at IS NULL)`;
}

/**
 * MONEY TO GIVE BACK (workplan 0111; the owner, 2026-10-11): the credit notes
 * whose money the operator gives back by hand, or watches. The hourly push says
 * each once and mails it to `NOTIFY_TO`; this is where it stays until done.
 *
 * Read through `support_money_to_give_back` (managed migration 0055), with the
 * predicate every support view carries, and recorded as one read with a null
 * tenant, like the list of organisations: it is a list of everybody's.
 */
router.get(
  '/money-to-give-back',
  authenticateSubject,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return void res
          .status(401)
          .json({ error: 'Unauthorized', message: 'No subject on this request' });
      }
      const items = await withSubject(pool(), userId, async (db) => {
        const listed = await listMoneyToGiveBack(db);
        // Logged even when empty, for the reason `/tenants` gives.
        await recordSupportRead(db, { operatorUserId: userId, tenantId: null, view: 'money_to_give_back' });
        return listed;
      });
      res.json({ items });
    } catch (error) {
      serverFault(res, 'support_money_to_give_back_failed', 'reading the money to give back', error);
    }
  },
);

/**
 * The operator's mark that one was paid back by hand: by transfer, and for a
 * failed refund booked in the books, its payment taken off the credit note.
 * Once, in their own name, never changed (`money_given_back`). The mark is its
 * own record of who and when, as a hold is (0023), so no read is logged.
 *
 * 204 when marked; 409 when it was marked before, or is a late refund, which
 * leaves the list by itself when Mollie ends it; 404 for a credit note not on
 * the list, or a subject who is not an operator (the same answer, as ever).
 */
router.post(
  '/money-to-give-back/:creditNoteId/given-back',
  authenticateSubject,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const operator = req.userId;
      if (!operator) {
        return void res
          .status(401)
          .json({ error: 'Unauthorized', message: 'No subject on this request' });
      }
      const creditNoteId = oneUuid(req.params.creditNoteId);
      if (!creditNoteId) {
        return void res.status(400).json({ error: 'Bad request', message: 'creditNoteId must be one uuid' });
      }
      const outcome = await withSubject(pool(), operator, (db) =>
        markMoneyGivenBack(db, creditNoteId, operator, new Date()),
      );
      if (outcome === 'marked') return void res.status(204).end();
      if (outcome === 'already') {
        return void res.status(409).json({ error: 'Conflict', message: 'It was marked given back before' });
      }
      if (outcome === 'watched') {
        return void res.status(409).json({
          error: 'Conflict',
          message: 'A late refund takes no mark: it leaves the list when Mollie ends it',
        });
      }
      res.status(404).json({ error: 'Not found', message: 'No such credit note to give back' });
    } catch (error) {
      serverFault(res, 'support_money_given_back_failed', 'marking money given back', error);
    }
  },
);

/**
 * THE LOG (workplan 0129 T2): the audit log and the application's errors and
 * warnings, one timeline, newest first, a page at a time.
 *
 * ## The view is the boundary
 *
 * Read through `support_log` and nothing else. The view is where "metadata
 * only" is held (managed migration 0025): it has no column for
 * `audit_log.detail`, it shows a member's address in place of their subject,
 * and it serves an action or an actor that is not a name from code as nothing
 * readable. This route adds no column, and could not.
 *
 * ## A search, recorded as one
 *
 * Like `/people`, every page served is a `support_read` row carrying the
 * filters asked for and how many rows came back (0019's reason: "an operator
 * read the log" cannot tell a look at one failure from a survey of every
 * customer, and the filters can). A page filtered to one customer, or to one
 * of its migrations, is recorded under that customer, so "who looked at this
 * customer" finds it too; the customer's id is then in `tenant_id`, and not
 * repeated in the query.
 *
 * ## Every filter has a shape
 *
 * Each is checked before it reaches the query, and a value of the wrong shape
 * is a 400 naming the field, not an empty page: an operator who mistyped a
 * reference should be told so, rather than shown that nothing matches. The
 * rules are `parseLogFilters` in `@openmig/shared`, which the appliance's own
 * log page uses too (0129 D5), so a filter means the same on both.
 *
 * ## Paging
 *
 * Newest first by (at, id), a hundred rows a page. The cursor is the last
 * row's time to the microsecond, as text, and its id. A JavaScript date keeps
 * milliseconds, and a cursor cut to those would skip every row written later
 * in the same millisecond.
 */

/** What was searched for, as `support_read.query` records it: every filter but the customer's. */
function logQuery(filters: LogFilters): string {
  return LOG_FILTERS.map(([field]) => field)
    .filter((field) => field !== 'tenantId' && filters[field] !== undefined)
    .map((field) => `${field}=${filters[field]}`)
    .join(' ');
}

router.get('/log', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return void res
        .status(401)
        .json({ error: 'Unauthorized', message: 'No subject on this request' });
    }
    const filters = parseLogFilters(req.query as Record<string, unknown>);
    if ('field' in filters) {
      return void res
        .status(400)
        .json({ error: 'Bad request', field: filters.field, message: filters.message });
    }

    const where = [
      sql`true`,
      ...(filters.level ? [sql`level = ${filters.level}`] : []),
      ...(filters.tenantId ? [sql`tenant_id = ${filters.tenantId}::uuid`] : []),
      ...(filters.mappingId ? [sql`mapping_id = ${filters.mappingId}::uuid`] : []),
      // The start of a name, `_` escaped (see `logEventPattern`).
      ...(filters.event ? [sql`event LIKE ${logEventPattern(filters.event)} ESCAPE '\\'`] : []),
      ...(filters.category ? [sql`category = ${filters.category}`] : []),
      ...(filters.reference ? [sql`reference = ${filters.reference}`] : []),
      ...(filters.since ? [sql`at >= ${filters.since}::timestamptz`] : []),
      ...(filters.before
        ? [
            filters.beforeId
              ? sql`(at, id) < (${filters.before}::timestamptz, ${filters.beforeId}::uuid)`
              : sql`at < ${filters.before}::timestamptz`,
          ]
        : []),
    ];

    const page = await withSubject(pool(), userId, async (db) => {
      const result = await db.execute(
        sql`SELECT id,
                   to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
                   source, level, tenant_id, tenant_name, mapping_id, migration_name,
                   event, category, reference, actor
              FROM public.support_log
             WHERE ${sql.join(where, sql` AND `)}
             ORDER BY support_log.at DESC, support_log.id DESC
             LIMIT ${LOG_PAGE + 1}`,
      );
      const rows = result.rows as Row[];
      // The customer a migration belongs to, when the page was filtered to the
      // migration alone: read back through the view, as `/migrations/:id` does.
      let tenantId: string | null = filters.tenantId ?? null;
      if (!tenantId && filters.mappingId) {
        const owner = await db.execute(
          sql`SELECT tenant_id FROM public.support_tenant_migrations
               WHERE mapping_id = ${filters.mappingId}::uuid`,
        );
        tenantId = ((owner.rows[0] as Row | undefined)?.tenant_id as string | undefined) ?? null;
      }
      const served = rows.slice(0, LOG_PAGE);
      await recordSupportRead(db, {
        operatorUserId: userId,
        tenantId,
        view: 'log',
        query: logQuery(filters),
        resultCount: served.length,
      });
      return { served, more: rows.length > LOG_PAGE };
    });

    const last = page.served[page.served.length - 1];
    res.json({
      entries: page.served,
      next: page.more && last ? { before: last.at, beforeId: last.id } : null,
      limit: LOG_PAGE,
    });
  } catch (error) {
    serverFault(res, 'support_log_failed', 'reading the log', error);
  }
});

/**
 * THE AUDIT EXPORT'S DOWNLOAD, FOR THE OPERATOR (workplan 0129 T4, its managed
 * half; the owner, 2026-09-24: "an operator-only route using your own
 * session").
 *
 * The appliance's `GET /audit-export`, on managed: the lines this deployment's
 * processes print as each audit event commits, read back from the audit log
 * after a cursor, oldest first, with the same pseudonyms under the same key,
 * for a log store to backfill what it missed. `Ownpace-Next-After` is where the
 * next page starts and `Ownpace-Caught-Up` says when there is no more. `after`
 * and `limit` are read by the appliance's rules (`parseAuditExportQuery`), and
 * the page by its query (`auditExportPageQuery`): only settled events, in the
 * order the cursor continues in.
 *
 * ## Through a view, and recorded in the same transaction
 *
 * Like every screen here: the rows come from `support_audit_export` (managed
 * migration 0026), whose operator predicate decides who reads them, so a
 * signed-in person who is not an operator downloads nothing and writes
 * nothing to the log. The page served is recorded as one read of every
 * customer (`audit_export`), with where it started and how many lines it
 * served, in the transaction that read it.
 *
 * ## The one route that reads more than metadata
 *
 * The view serves the audit rows whole, `detail` included, because the line is
 * made from the whole row (0129 D4). Nothing leaves as it was read: every row
 * becomes `auditExportLine`'s line, where an address or a file name is its
 * pseudonym and a detail field nobody classified is left out.
 * `every-audit-field-is-classified.unit.test.ts` fails on any other reader of
 * the view.
 * The key is read first, on the owner's connection the API's own stream uses
 * (`audit-key.ts`; the request path is `app_user` and may not read it), so a
 * page whose lines cannot be made is neither read nor recorded.
 */
router.get('/audit-export', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return void res
        .status(401)
        .json({ error: 'Unauthorized', message: 'No subject on this request' });
    }
    const one = (v: unknown) => (typeof v === 'string' ? v : null);
    const asked = parseAuditExportQuery({ after: one(req.query.after), limit: one(req.query.limit) });
    if ('field' in asked) {
      return void res
        .status(400)
        .json({ error: 'Bad request', field: asked.field, message: asked.message });
    }
    const { after, afterText, limit } = asked;

    const pseudonym = pseudonymizer(await auditPseudonymKey());
    const events = await withSubject(pool(), userId, async (db) => {
      const found = await db.execute(
        auditExportPageQuery(sql`public.support_audit_export`, { ...(after ? { after } : {}), limit }),
      );
      const page = (found.rows as Row[]).map(auditExportEventOf);
      await recordSupportRead(db, {
        operatorUserId: userId,
        tenantId: null,
        view: 'audit_export',
        query: `${afterText ? `after=${afterText}` : 'from=start'} limit=${limit}`,
        resultCount: page.length,
      });
      return page;
    });

    const last = events.at(-1);
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'ownpace-next-after': last ? auditCursorAfter(last) : (afterText ?? ''),
      'ownpace-caught-up': String(events.length < limit),
    });
    res.end(
      events
        .map((e) => `${JSON.stringify(auditExportLine(e, { pseudonym, resource: DOWNLOAD_RESOURCE }))}\n`)
        .join(''),
    );
  } catch (error) {
    serverFault(res, 'support_audit_export_failed', 'reading the audit export', error);
  }
});

/** The process that serves the download, as its lines name it: the API's own stream's resource. */
const DOWNLOAD_RESOURCE = { 'service.name': 'ownpace-api' } as const;

/**
 * THE PLATFORM STATUS THE CUSTOMER SEES (workplan 0110 T5, the last half).
 *
 * The one route here that is not a read of a customer, and the two rules in
 * this file's header bend for it — each for a reason said here rather than
 * assumed, so that nobody later "fixes" the omission:
 *
 *  - **No view and no operator predicate**, because what it serves is public
 *    already: `/api/ready` answers unauthenticated, and the status page IS the
 *    public page. This shapes those for the screen and strips the internal
 *    names Gatus's JSON carries (`platform-status.ts`). There is nothing here
 *    an operator may see and a customer may not, so a predicate would guard
 *    nothing. Signed in all the same: it is the support surface's door.
 *  - **No `support_read` row**, because the log records what was looked at,
 *    of whom. A platform status is of nobody, and a row naming no
 *    organisation for every visit to a tenant screen would dilute the record
 *    it exists to be.
 *
 * Readiness is CALLED rather than fetched: same process, same pool, and a
 * fetch of our own address would only prove the container reaches itself.
 */
router.get('/platform', authenticateSubject, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [ready, statusPage] = await Promise.all([
      readiness(),
      readStatusPage(process.env.STATUS_URL),
    ]);
    res.json({ ready, statusPage } satisfies PlatformStatus);
  } catch (error) {
    serverFault(res, 'platform_failed', 'reading the platform status', error);
  }
});

export default router;

export { LOG_PAGE };
