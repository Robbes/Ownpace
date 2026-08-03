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
import { eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import {
  log,
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

const _InviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

const _UpdateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
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
    log.error('Error listing tenants:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to list tenants',
    });
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
    log.error('Error getting tenant:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to get tenant',
    });
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
        log.error('Error updating tenant:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to update tenant',
        });
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
        log.error('Error updating tenant notification preferences:', error);
        res.status(500).json({
          error: 'Internal server error',
          message: 'Failed to update notification preferences',
        });
      }
    }
  },
);

/**
 * DELETE /api/tenants/:tenantId
 *
 * Delete a tenant (owner only)
 */
router.delete(
  '/:tenantId',
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

      const tenantId = req.tenantId;
      const pool = getSharedPool();

      // Delete tenant from database with RLS enforcement via withTenantDb
      const [deleted] = await withTenantDb(tenantId, pool, async (db) => {
        return await db
          .delete(schema.tenant)
          .where(eq(schema.tenant.id, tenantId))
          .returning();
      });

      if (!deleted) {
        res.status(404).json({
          error: 'Not found',
          message: 'Tenant not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Tenant deleted successfully',
      });
    } catch (error) {
      log.error('Error deleting tenant:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to delete tenant',
      });
    }
  }
);

export default router;
