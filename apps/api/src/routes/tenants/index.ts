// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Tenant Management Routes
 * 
 * CRUD operations for tenants and their members.
 * All endpoints require authentication and enforce tenant isolation.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, getDbPool, withTenantDb } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import membersRoutes from './members.ts';
import { serverFault } from '../../server-fault.ts';
import { closeAccount } from '../../close-account.ts';
import type { PgDatabase } from '@openmig/ledger';
import { reopenTenant, isCloseWindow, CLOSE_WINDOWS_DAYS } from '@openmig/managed';
import { backupRetentionDaysFromEnv, erasureScopeText } from '@openmig/shared';
import { eq } from 'drizzle-orm';
import { getTriggerClient } from '@openmig/scheduler';
import * as schema from '@openmig/ledger/schema-pg';
import {
  readTenantNotificationPrefs,
  withTenantNotificationPrefs,
  contactPhoneFrom,
  readTenantContactPhone,
  withTenantContactPhone,
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
/**
 * What the generic update may change: the name, and nothing else.
 *
 * It also took `settings.maxMappings` and `settings.maxUsers`, and nothing
 * anywhere read either, so an owner could store a limit that limited nothing
 * (workplan 0143 T2a). The cap on migrations is the deployment's now
 * (`MAX_MIGRATIONS_PER_ORGANISATION`, `migration-cap.ts`), and a cap on members
 * belongs with 0131's open question 6 and 0137. Values already stored stay
 * inert, because nothing reads them. Every other key in `settings` has its own
 * door (`/contact`, `/notifications`), and zod dropped the rest anyway.
 */
const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

/** The closed set the digest task understands — nothing else is storable. */
const NotificationPrefsSchema = z.object({
  digest: z.enum(['daily', 'weekly', 'off']),
  locale: z.enum(['en', 'nl']),
});

/**
 * What `PUT …/contact` may carry: a phone number, or null (or empty) to show
 * none. The SHAPE of the number is `contactPhoneFrom`'s to judge, not zod's,
 * so the refusal is one sentence a person can act on rather than a schema
 * error. The length cap here only keeps an absurd body out of that check.
 */
const ContactSchema = z.object({
  phone: z.string().max(200).nullable(),
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
 * Rename the organisation. Its settings each have their own door.
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
        const updateData: Partial<typeof schema.tenant.$inferInsert> = {};
        if (body.name) {
          updateData.name = body.name;
        }
        // Nothing to write is an answer, not an UPDATE with an empty SET.
        if (Object.keys(updateData).length === 0) return existing;

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
 * PUT /api/tenants/:tenantId/contact
 *
 * The organisation's phone number, shown on the grant page to the people it
 * asks (workplan 0108 T8a). The owner, 2026-09-23: *"If there is no phone
 * number, then add it, but leave optional: we show it at grant-migration-page,
 * but it's not required to have in the tenant profile."*
 *
 * A route of its own, like the notification preferences below, for their
 * reasons and one more: the generic settings PUT keeps only its two keys, so
 * this is the only door, and its check (`contactPhoneFrom`) is therefore the
 * only check. Only a phone number's characters get through, because the grant
 * page is the one screen a stranger could dress up. MERGED into `settings`,
 * never replacing it. Empty or null clears the number.
 *
 * Owner/admin only, like every other change on the Tenants screen.
 */
router.put(
  '/:tenantId/contact',
  authenticate,
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = ContactSchema.safeParse(req.body);
      if (!parsed.success) {
        const reason = 'Send { phone }: a phone number, or null to show none.';
        res.status(400).json({ error: 'invalid_body', message: reason, reason });
        return;
      }
      const verdict = contactPhoneFrom(parsed.data.phone);
      if (!verdict.ok) {
        // Both shapes this API answers in, so every screen shows the sentence.
        res.status(400).json({
          error: 'not_a_phone_number',
          message: verdict.reason,
          reason: verdict.reason,
        });
        return;
      }

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
          .set({ settings: withTenantContactPhone(current.settings, verdict.phone) })
          .where(eq(schema.tenant.id, tenantId))
          .returning();
      });

      if (!updated) {
        res.status(404).json({ error: 'Not found', message: 'Tenant not found' });
        return;
      }
      // What was STORED, read back through the reader the grant page uses.
      res.json({ contact: { phone: readTenantContactPhone(updated.settings) } });
    } catch (error) {
      serverFault(res, 'update_failed', 'saving the phone number', error);
    }
  },
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

      // One function, which `operator.sh close` calls too (0139 T7 (a)): the
      // same close, the same answer, and the passes in flight read in this
      // organisation's own context.
      const answer = await closeAccount(
        getSharedPool(),
        {
          tenantId: req.tenantId,
          windowDays,
          closedBy: req.userId ?? 'unknown',
          via: 'screen',
          closedAt: new Date(),
          backupRetentionDays: backupRetentionDaysFromEnv(process.env.BACKUP_RETENTION_DAYS),
        },
        { cancelRun: async (ref) => void (await getTriggerClient().runs.cancel(ref)) },
      );
      res.json(answer);
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
