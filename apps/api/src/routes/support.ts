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
 */

import { Router } from 'express';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { withSubject, holdsASlot, PATH_STATES } from '@openmig/ledger';
import type { LedgerDriver, PathState } from '@openmig/ledger';
import { recordSupportRead, observedTier } from '@openmig/managed';
import { authenticateSubject, getDbPool } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import { readiness } from './ready.ts';
import { readStatusPage, type PlatformStatus } from './platform-status.ts';

const router = Router();

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
 * A path parameter that is exactly one uuid, or null.
 *
 * Not for safety — every value below goes through a bound parameter — but so
 * that a malformed id is a 400 rather than a `22P02` surfacing as a 500. An
 * operator mistyping an id should be told they mistyped it.
 */
function oneUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
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
 * raw counts rather than restated in the view's SQL — one authority. A state
 * this build does not know counts as holding nothing: the same
 * read-back-through-the-guard rule the failure-category rendering follows,
 * and the direction that cannot overstate what a customer would pay.
 */
function usageForScreen(row: Row | undefined) {
  const byState = (row?.paths_by_state ?? {}) as Record<string, unknown>;
  const pathsNow = Object.entries(byState).reduce((n, [state, count]) => {
    const known = (PATH_STATES as readonly string[]).includes(state);
    return known && holdsASlot(state as PathState) ? n + Number(count) : n;
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
          setup: tier.setup,
          monthly: tier.monthly,
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
 * Level 1 — every organisation.
 *
 * Recorded as ONE read with a null tenant. A row per organisation would be a
 * lie about how many decisions were made: the operator made one, to look at
 * the list.
 */
router.get('/tenants', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return void res
        .status(401)
        .json({ error: 'Unauthorized', message: 'No subject on this request' });
    }
    const tenants = await withSubject(pool(), userId, async (db) => {
      const result = await db.execute(
        sql`SELECT tenant_id, tenant_name, tenant_status, joined_at,
                   migration_count, failing_domain_count, pending_decision_count
              FROM public.support_tenants
             ORDER BY tenant_name`,
      );
      const rows = result.rows as Row[];
      // Logged even when the list comes back empty: to a non-operator it is
      // empty, and `recordSupportRead` writes nothing for them, so an empty
      // list plus a log row is an operator on a platform with no customers,
      // while an empty list and no row is somebody who was never an operator.
      // Skipping the call on zero rows would erase that difference.
      await recordSupportRead(db, { operatorUserId: userId, tenantId: null, view: 'tenants' });
      return rows;
    });
    res.json({ tenants });
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
                     migration_count, failing_domain_count, pending_decision_count
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
                     created_at, updated_at, pending_decision_count
                FROM public.support_tenant_migrations
               WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at`,
        );
        const invoices = await db.execute(
          sql`SELECT invoice_id, period_start, period_end, status, total, currency, paid_at
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
                     created_at, updated_at, pending_decision_count
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
 * Recorded with a NULL tenant, like the tenant LIST and for a stronger version
 * of the same reason: there is no tenant to name, and no tenant left to name
 * it about.
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
      const invoices = await withSubject(pool(), userId, async (db) => {
        const result = await db.execute(
          sql`SELECT tenant_ref, erasure_requested_at, purged_at, invoice_id,
                     billed_to_name, period_start, period_end, status, total,
                     currency, paid_at
                FROM public.support_retained_invoices
               ORDER BY purged_at DESC NULLS LAST, period_start DESC`,
        );
        const rows = result.rows as Row[];
        // Logged even when empty, for the reason `/tenants` gives: an operator
        // on a platform that has erased nobody and a non-operator who may see
        // nothing produce the same empty list, and only the log row tells them
        // apart.
        await recordSupportRead(db, {
          operatorUserId: userId,
          tenantId: null,
          view: 'retained_invoices',
        });
        return rows;
      });
      res.json({ invoices });
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
