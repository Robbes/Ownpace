// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Tenant Management Routes
 * 
 * CRUD operations for tenants and their members.
 * All endpoints require authentication and enforce tenant isolation.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, getDbPool, withTenantDb } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../types/api';
import membersRoutes from './members';
import { serverFault } from '../../server-fault';
import {
  closeTenant,
  reopenTenant,
  isCloseWindow,
  CLOSE_WINDOWS_DAYS,
  type PgDatabase,
} from '@openmig/ledger';
import {
  standingGrantReminders,
  accessThatOutlivesErasure,
  backupRetentionDaysFromEnv,
  erasureTimeline,
  erasureTimelineText,
  erasureScopeText,
  erasureNeverTouches,
  log,
} from '@openmig/shared';
import { eq } from 'drizzle-orm';
import { getTriggerClient } from '@openmig/scheduler';
import * as schema from '@openmig/ledger';
import {
  readTenantNotificationPrefs,
  withTenantNotificationPrefs,
} from '@openmig/shared';

const router = Router();

// Global pool - created once and reused
// In production, this should be a singleton or dependency-injected
let _dbPool: ReturnType<typeof getDbPool> | null = null;
function getSharedPool() {
  if (!_dbPool) {
    _dbPool = getDbPool();
  }
  return _dbPool;
}

// Mount members routes
router.use('/:tenantId/members', membersRoutes);
// Schema validation
const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  settings: z.object({
    maxMappings: z.number().optional(),
    maxUsers: z.number().optional(),
  }).optional(),
});

/** The closed set the digest task understands — nothing else is storable. */
const NotificationPrefsSchema = z.object({
  digest: z.enum(['daily', 'weekly', 'off']),
  locale: z.enum(['en', 'nl']),
});

/**
 * GET /api/tenants
 * 
 * List all tenants for the authenticated user
 */
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }
    
    const pool = getSharedPool();
    
    // Use withTenant to enforce RLS - tenant context is set automatically
    const tenants = await withTenantDb(tenantId, pool, async (db) => {
      return await db.select().from(schema.tenant);
    });

    res.json({
      tenants: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: (t.settings as Record<string, unknown>)?.slug || t.name.toLowerCase().replace(/\s+/g, '-'),
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    serverFault(res, 'list_failed', 'listing your tenants', error);
  }
});

/**
 * POST /api/tenants
 *
 * Tenant creation is a cross-tenant BOOTSTRAP operation and cannot run through a
 * tenant-scoped request: RLS (`tenant_isolation_insert`, migration 0011) requires
 * the new row's id to equal `app.current_tenant`, which a freshly-created tenant
 * never satisfies. Rather than attempt a doomed insert and return an opaque 500,
 * be honest — tenants are provisioned via the onboarding/seed path, not here.
 */
router.post('/', authenticate, (_req: AuthenticatedRequest, res: Response) => {
  res.status(501).json({
    error: 'Not Implemented',
    message:
      'Tenant creation is not available through the tenant-scoped API. Provision ' +
      'tenants via the onboarding/seed flow (a privileged, non-tenant-scoped path).',
  });
});

/**
 * GET /api/tenants/:tenantId
 * 
 * Get tenant details
 */
router.get('/:tenantId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tenantId } = req.params;

    if (!tenantId || Array.isArray(tenantId)) {
      res.status(400).json({
        error: 'Bad request',
        message: 'Tenant ID is required',
      });
      return;
    }

    // Check that the authenticated user has a tenant context
    if (!req.tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }

    const pool = getSharedPool();

    // Use withTenant to enforce RLS - this proves tenant isolation end-to-end
    const tenants = await withTenantDb(req.tenantId, pool, async (db) => {
      return await db.select().from(schema.tenant).where(eq(schema.tenant.id, tenantId));
    });

    if (tenants.length === 0) {
      res.status(404).json({
        error: 'Not found',
        message: 'Tenant not found',
      });
      return;
    }

    const tenant = tenants[0];
    if (!tenant) {
      res.status(404).json({
        error: 'Not found',
        message: 'Tenant not found',
      });
      return;
    }
    
    res.json({
      id: tenant.id,
      name: tenant.name,
      slug: (tenant.settings as Record<string, unknown>)?.slug || tenant.name.toLowerCase().replace(/\s+/g, '-'),
      settings: tenant.settings,
      createdAt: tenant.createdAt,
    });
  } catch (error) {
    serverFault(res, 'read_failed', 'reading this tenant', error);
  }
});

/**
 * PUT /api/tenants/:tenantId
 * 
 * Update tenant settings
 */
router.put(
  '/:tenantId',
  authenticate,
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const body = UpdateTenantSchema.parse(req.body);
      
      if (!req.tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }

      const tenantId = req.tenantId;
      const pool = getSharedPool();

      // Update tenant in database with RLS enforcement via withTenantDb
      const [updatedTenant] = await withTenantDb(tenantId, pool, async (db) => {
        const existing = await db
          .select()
          .from(schema.tenant)
          .where(eq(schema.tenant.id, tenantId));
        const current = existing[0];
        const updateData: Partial<typeof schema.tenant.$inferInsert> = {};
        if (body.name) {
          updateData.name = body.name;
        }
        if (body.settings) {
          // MERGED, not replaced. `settings` is shared with everything else
          // that lives there (the slug, the notification preferences), and a
          // partial update that replaced the object would silently drop them.
          updateData.settings = { ...(current?.settings as object ?? {}), ...body.settings };
        }
        
        return await db
          .update(schema.tenant)
          .set(updateData)
          .where(eq(schema.tenant.id, tenantId))
          .returning();
      });

      if (!updatedTenant) {
        res.status(404).json({
          error: 'Not found',
          message: 'Tenant not found',
        });
        return;
      }

      res.json({
        id: updatedTenant.id,
        name: updatedTenant.name,
        slug: (updatedTenant.settings as Record<string, unknown>)?.slug || updatedTenant.name.toLowerCase().replace(/\s+/g, '-'),
        settings: updatedTenant.settings,
        updatedAt: updatedTenant.createdAt, // Note: schema doesn't have updatedAt yet
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        serverFault(res, 'update_failed', 'updating this tenant', error);
      }
    }
  }
);

/**
 * PUT /api/tenants/:tenantId/notifications
 *
 * How often this tenant wants the "what needs attention" summary, and in
 * which language (workplan 0030 T4). Read every morning by the
 * `managed-digest` task, which is the only thing that acts on it.
 *
 * A dedicated route rather than the generic settings PUT, for two reasons:
 * the values are a closed set and belong in a schema, and this one MERGES —
 * `withTenantNotificationPrefs` keeps every other key in `settings` intact,
 * so saving a cadence cannot quietly drop a neighbour.
 *
 * Owner/admin only, like every other change on the Tenants screen: choosing
 * who the organisation hears from is not a viewer's call.
 */
router.put(
  '/:tenantId/notifications',
  authenticate,
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const prefs = NotificationPrefsSchema.parse(req.body);

      if (!req.tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }
      const tenantId = req.tenantId;
      const pool = getSharedPool();

      const [updated] = await withTenantDb(tenantId, pool, async (db) => {
        const rows = await db
          .select()
          .from(schema.tenant)
          .where(eq(schema.tenant.id, tenantId));
        const current = rows[0];
        if (!current) return [];
        return await db
          .update(schema.tenant)
          .set({ settings: withTenantNotificationPrefs(current.settings, prefs) })
          .where(eq(schema.tenant.id, tenantId))
          .returning();
      });

      if (!updated) {
        res.status(404).json({ error: 'Not found', message: 'Tenant not found' });
        return;
      }

      // Answer with what was STORED, read back through the same reader the
      // digest task uses — so the screen shows the value that will actually
      // be acted on, not the one that was posted.
      res.json({
        id: updated.id,
        notifications: readTenantNotificationPrefs(updated.settings),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: error.issues });
      } else {
        serverFault(res, 'notifications_failed', 'updating your notification preferences', error);
      }
    }
  },
);

/**
 * DELETE /api/tenants/:tenantId — retired (workplan 0085 T1).
 *
 * This did a hard `DELETE FROM tenant`, which cascaded twenty-five tables —
 * `invoice` and `audit_log` among them — behind one call, with no
 * confirmation, no grace period, and nothing recording that it happened.
 *
 * Two things were wrong and only one was about safety. **A customer's billing
 * history is not ours to destroy on request**: Dutch tax law wants invoices
 * kept for years, so a literal "delete everything" swapped a GDPR obligation
 * for a tax one. And a purge with no window has nothing in which to catch a
 * mistaken click, or a bug in the purge itself.
 *
 * It refuses rather than being removed outright, so anything still calling it
 * gets an answer saying where to go (rule 9) instead of a 404 that reads as a
 * routing bug.
 */
/**
 * The 410 body, as a pure value so it can be tested without a database.
 *
 * Exported for the same reason `missingFieldsRefusal` is: the interesting part
 * of a refusal is what it tells somebody to do next, and that is worth pinning
 * without standing up Postgres to read one JSON object.
 */
export function deleteTenantRefusal(): {
  error: string;
  reason: string;
  neverTouched: string;
} {
  return {
    error: 'use_close',
    reason:
      'Deleting a tenant outright is no longer available: it destroyed invoices that must be ' +
      'kept for tax purposes, and left no window in which to undo a mistake. Close the ' +
      'account instead — POST /api/tenants/:tenantId/close with windowDays of 0, 7, 30 or 90. ' +
      'Closing stops syncs and billing immediately; the erasure runs when the window is up, ' +
      'and can be undone until then.',
    // The other half of the answer, and the half nobody thinks to ask for
    // (0085 T6). Somebody calling DELETE is trying to end the relationship, and
    // the refusal above tells them how — but not what it will do to the two
    // mailboxes they care about. Left unsaid, "erasure" is a word they have to
    // guess the scope of, and the frightening guess is the plausible one.
    neverTouched: erasureScopeText('en'),
  };
}

router.delete(
  '/:tenantId',
  authenticate,
  requireRole('owner'),
  (_req: AuthenticatedRequest, res: Response) => {
    res.status(410).json(deleteTenantRefusal());
  },
);

/**
 * Ask the orchestrator to stop every pass this tenant still has in flight
 * (workplan 0085 T8).
 *
 * Closing already stops the scheduler STARTING passes — the mapping is no
 * longer `active`. What it did not do is stop the ones already running, and
 * "waited out rather than stopped" is how a pass that never ends holds a
 * promised erasure open for ever.
 *
 * Two things this deliberately does NOT do.
 *
 * It does not mark the run rows cancelled. A cancellation is a REQUEST; the
 * pass may still be mid-write when it is acknowledged. Landing the row here
 * would tell the purge nothing is in flight while something still is, which is
 * precisely the state that duplicates a leaving customer's mail into their own
 * target. The row is landed by whoever actually finishes it — the worker, or
 * the purge's quiesce once the orchestrator confirms it stopped.
 *
 * And it never fails the close. Somebody ending their relationship with us must
 * not be blocked because our orchestrator is unreachable; the purge-time
 * quiesce is the backstop, and it is the one that enforces the safety rule.
 */
async function stopPassesInFlight(tenantId: string): Promise<number> {
  let asked = 0;
  try {
    const live = await getSharedPool().query<{ id: string; orchestrator_ref: string | null }>(
      `SELECT id, orchestrator_ref FROM run
        WHERE tenant_id = $1 AND status IN ('running', 'queued')`,
      [tenantId],
    );
    const client = getTriggerClient();
    for (const row of live.rows) {
      if (!row.orchestrator_ref) continue;
      try {
        await client.runs.cancel(row.orchestrator_ref);
        asked++;
      } catch (error) {
        log.warn(
          `[close] could not ask the orchestrator to cancel run ${row.id} ` +
            `(${row.orchestrator_ref}): ${error instanceof Error ? error.message : String(error)}. ` +
            'The erasure quiesce will deal with it before any purge runs.',
        );
      }
    }
  } catch (error) {
    log.warn(
      `[close] could not stop passes in flight for ${tenantId}: ` +
        `${error instanceof Error ? error.message : String(error)}. The close stands; the purge ` +
        'will not proceed until they are quiesced.',
    );
  }
  return asked;
}

/**
 * POST /api/tenants/:tenantId/close — end the service (workplan 0085 T2).
 *
 * Stops syncs and billing now; schedules the erasure for the window the
 * customer chose. Owner only, because it is the one action that ends the
 * relationship.
 */
router.post(
  '/:tenantId/close',
  authenticate,
  requireRole('owner'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }
      const windowDays = (req.body as { windowDays?: unknown } | undefined)?.windowDays;
      if (!isCloseWindow(windowDays)) {
        res.status(400).json({
          error: 'bad_window',
          reason:
            `windowDays must be one of ${CLOSE_WINDOWS_DAYS.join(', ')} — days before erasure. ` +
            '0 erases as soon as the purge next runs, and cannot be undone.',
          allowed: CLOSE_WINDOWS_DAYS,
        });
        return;
      }

      const pool = getSharedPool();

      // The grants only THEY can remove (0085 T4b) — read BEFORE closing, from
      // the kinds this tenant actually connected, so the answer names their
      // providers rather than every provider we support.
      const kinds = await withTenantDb(req.tenantId, pool, async (tdb) =>
        (await tdb.select({ kind: schema.connection.kind }).from(schema.connection)).map(
          (r) => r.kind,
        ),
      );

      // INSIDE withTenantDb, and the first version was not — which is how
      // this was found, as a 500 in the integration tier. `tenant` is FORCE
      // ROW LEVEL SECURITY with an UPDATE policy on `app.current_tenant`, and
      // the API connects as `app_user`, so without the tenant context the
      // UPDATE matches zero rows and close reports a tenant that does not
      // exist.
      //
      // The reasoning that put it outside sounded right and was backwards:
      // `erasure_record` must outlive the tenant, so it felt like it had to be
      // written outside the tenant's transaction. But it has no RLS policies
      // at all — outliving the tenant is about the absence of a foreign key,
      // not about the transaction — so writing it here is unrestricted, while
      // the tenant UPDATE genuinely REQUIRES the context.
      const closedAt = new Date();
      const backupRetentionDays = backupRetentionDaysFromEnv(process.env.BACKUP_RETENTION_DAYS);
      const result = await withTenantDb(req.tenantId, pool, (tdb) =>
        closeTenant(
          tdb as unknown as PgDatabase,
          req.tenantId!,
          windowDays,
          req.userId ?? 'unknown',
          closedAt,
          backupRetentionDays,
        ),
      );

      // Stop what is already running. Best effort, and never a reason to fail
      // the close — see the helper.
      const passesStopped = await stopPassesInFlight(req.tenantId);

      // Both dates, and the sentence that explains them. `purgeAfter` alone
      // would be a true statement that reads as a false one: the live database
      // stops holding it that day, and the backups do not (0085 T5).
      const timeline = erasureTimeline({ closedAt, windowDays, backupRetentionDays });
      res.json({
        status: 'closed',
        purgeAfter: result.purgeAfter.toISOString(),
        windowDays: result.windowDays,
        backupsExpireAt: result.backupsExpireAt.toISOString(),
        backupRetentionDays: result.backupRetentionDays,
        erasureCompletesText: {
          en: erasureTimelineText(timeline, 'en'),
          nl: erasureTimelineText(timeline, 'nl'),
        },
        canReopenUntil: result.windowDays > 0 ? result.purgeAfter.toISOString() : null,
        // How many in-flight passes we asked to stop. Not how many stopped —
        // that is the orchestrator's to confirm, and the purge checks it.
        passesStopped,
        // Kept for callers that already read it. `outlivingAccess` supersedes
        // it and is what new callers should render.
        standingGrants: standingGrantReminders(kinds, 'en'),
        // Everything that keeps working after we have forgotten them: the
        // consents in their providers' consoles AND the app passwords sitting
        // in their own accounts (owner, 2026-08-18 — "not leave credentials
        // wandering around"). Credentials first: a consent is a permission
        // sitting unused, a live app password is a working way in.
        outlivingAccess: {
          en: accessThatOutlivesErasure(kinds, 'en'),
          nl: accessThatOutlivesErasure(kinds, 'nl'),
        },
        // What erasure will NOT do (0085 T6). Sent at close rather than only in
        // the completion report, because this is the moment the customer is
        // deciding — and "delete my data" is the one phrase they could
        // reasonably read as meaning we take the migrated mail back out of
        // their new mailbox. Answering that after the purge would be answering
        // it too late to be reassurance.
        neverTouched: {
          en: erasureScopeText('en'),
          nl: erasureScopeText('nl'),
          boundaries: erasureNeverTouches('en'),
        },
      });
    } catch (error) {
      serverFault(res, 'close_failed', 'closing this account', error);
    }
  },
);

/**
 * POST /api/tenants/:tenantId/reopen — undo a close while the window is open.
 *
 * The reason the staged flow exists: a mistaken click, a resolved dispute, or
 * a bug in the purge spotted before it ran.
 */
router.post(
  '/:tenantId/reopen',
  authenticate,
  requireRole('owner'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }
      // Same reason as close: the tenant UPDATE needs `app.current_tenant`.
      await withTenantDb(req.tenantId, getSharedPool(), (tdb) =>
        reopenTenant(tdb as unknown as PgDatabase, req.tenantId!, new Date()),
      );
      res.json({ status: 'active' });
    } catch (error) {
      // A closed window is a REFUSAL, not a fault: the caller asked for
      // something no longer possible and needs to be told which.
      const message = error instanceof Error ? error.message : String(error);
      if (/window has already passed|not closed/.test(message)) {
        res.status(409).json({ error: 'cannot_reopen', reason: message });
        return;
      }
      serverFault(res, 'reopen_failed', 'reopening this account', error);
    }
  },
);

export default router;
