// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The three screens an operator gets, and the record of every one served
 * (workplan 0110 T4, over T1's log and T2's views).
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
import { withSubject } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { recordSupportRead } from '@openmig/managed';
import { authenticateSubject, getDbPool } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';

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
                   migration_count, failing_domain_count
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
                     migration_count, failing_domain_count
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
          sql`SELECT mapping_id, name, lifecycle, mode, pattern, schedule, created_at, updated_at
                FROM public.support_tenant_migrations
               WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at`,
        );
        const invoices = await db.execute(
          sql`SELECT invoice_id, period_start, period_end, status, total, currency, paid_at
                FROM public.support_tenant_invoices
               WHERE tenant_id = ${tenantId}::uuid ORDER BY period_start DESC`,
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
                     created_at, updated_at
                FROM public.support_tenant_migrations WHERE mapping_id = ${mappingId}::uuid`,
        );
        const migrationRows = head.rows as Row[];
        if (migrationRows.length === 0) return null;
        const migration = migrationRows[0] as Row & { tenant_id: string };

        const domains = await db.execute(
          sql`SELECT domain, state, started_at, updated_at, completed_at,
                     last_error_category, last_pass_metrics
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

export default router;
