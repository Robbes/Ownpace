// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The drift decision queue's routes (SAD §11.1/§11.2, workplan 0028 T1).
 *
 * The mapping-level lifecycle queue above the item-level ones: list what the
 * detectors raised, answer or dismiss. Reading is any member's; ANSWERING is
 * owner/admin — a decision changes what the migration does next, the same
 * altitude as the member and flag surfaces. The store's contracts do the
 * heavy lifting: raising is detector-side (no POST here creates decisions),
 * and an already-answered decision comes back 409, never overwritten.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, getDbPool, withTenantDb } from '../middleware/auth';
import type { AuthenticatedRequest } from '../types/api';
import { PgDecisionStore, PgPolicyPresetStore } from '@openmig/ledger';
import { asTenantId, asMappingId, log, type DecisionStatus } from '@openmig/shared';

const router = Router();

/** The two things a preset can say. Anything else is a 400, not a stored word. */
const PresetSchema = z.object({ action: z.enum(['auto', 'ask']) });

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function getSharedPool() {
  if (!_dbPool) {
    _dbPool = getDbPool();
  }
  return _dbPool;
}

const ListQuerySchema = z.object({
  status: z.enum(['pending', 'resolved', 'auto_resolved', 'dismissed']).optional(),
  mappingId: z.string().uuid().optional(),
});

const ResolveSchema = z.object({
  // The answer is category-shaped and the server does not second-guess it
  // here — the detector that raised the decision documents what it accepts.
  resolution: z.record(z.string(), z.unknown()),
});

/**
 * GET /api/decisions — the queue, newest first.
 * Optional ?status= and ?mappingId= filters (the screen's reads).
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
    const query = ListQuerySchema.parse(req.query);

    const decisions = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      const store = new PgDecisionStore(db);
      return store.list(asTenantId(tenantId), {
        ...(query.status ? { status: query.status as DecisionStatus } : {}),
        ...(query.mappingId ? { mappingId: asMappingId(query.mappingId) } : {}),
      });
    });

    res.json({ decisions });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.issues });
      return;
    }
    log.error('Error listing decisions:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to list decisions',
    });
  }
});

/**
 * POST /api/decisions/:decisionId/resolve — record the owner's answer.
 * 409 when the decision is unknown or already answered: an answer must never
 * silently overwrite an earlier one, and the caller must learn which case
 * they are in by re-reading the queue.
 */
router.post(
  '/:decisionId/resolve',
  authenticate,
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId;
      const { decisionId } = req.params;
      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }
      if (!decisionId || Array.isArray(decisionId)) {
        res.status(400).json({ error: 'Bad Request', message: 'Decision ID required' });
        return;
      }
      const body = ResolveSchema.parse(req.body);

      const resolved = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        const store = new PgDecisionStore(db);
        return store.resolve(
          asTenantId(tenantId),
          decisionId,
          body.resolution,
          req.userId ?? 'unknown',
        );
      });

      if (!resolved) {
        res.status(409).json({
          error: 'Conflict',
          message: 'This decision does not exist or has already been answered.',
        });
        return;
      }
      res.json(resolved);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: error.issues });
        return;
      }
      log.error('Error resolving decision:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to resolve decision',
      });
    }
  },
);

/**
 * POST /api/decisions/:decisionId/dismiss — close without acting.
 * Same 409 contract as resolve.
 */
router.post(
  '/:decisionId/dismiss',
  authenticate,
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId;
      const { decisionId } = req.params;
      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }
      if (!decisionId || Array.isArray(decisionId)) {
        res.status(400).json({ error: 'Bad Request', message: 'Decision ID required' });
        return;
      }

      const dismissed = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        const store = new PgDecisionStore(db);
        return store.dismiss(asTenantId(tenantId), decisionId, req.userId ?? 'unknown');
      });

      if (!dismissed) {
        res.status(409).json({
          error: 'Conflict',
          message: 'This decision does not exist or has already been answered.',
        });
        return;
      }
      res.json(dismissed);
    } catch (error) {
      log.error('Error dismissing decision:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to dismiss decision',
      });
    }
  },
);

/**
 * GET /api/decisions/presets — the tenant's standing answers (0028 T5).
 *
 * Any member may READ them: knowing which categories answer themselves is
 * part of understanding what the queue is showing, and a queue whose silence
 * is unexplained is the thing this whole feature exists to avoid. Only
 * owner/admin may change them, below.
 */
router.get('/presets', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }
    const presets = await withTenantDb(tenantId, getSharedPool(), async (db) =>
      new PgPolicyPresetStore(db).list(asTenantId(tenantId)),
    );
    // Categories absent from this list are `ask` — said here rather than
    // left for the client to infer, because inferring it the other way round
    // would show a tenant as auto-answering things it actually asks about.
    res.json({ presets, defaultAction: 'ask' });
  } catch (error) {
    log.error('Error listing policy presets:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to list policy presets',
    });
  }
});

/**
 * PUT /api/decisions/presets/:category — set a standing answer.
 *
 * Owner/admin only, like answering a decision: choosing that a whole
 * CATEGORY answers itself is a larger version of the same act.
 */
router.put(
  '/presets/:category',
  authenticate,
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = req.tenantId;
      const { category } = req.params;
      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }
      if (!category || Array.isArray(category)) {
        res.status(400).json({ error: 'Bad Request', message: 'Category required' });
        return;
      }
      const { action } = PresetSchema.parse(req.body);

      await withTenantDb(tenantId, getSharedPool(), async (db) =>
        new PgPolicyPresetStore(db).set(asTenantId(tenantId), category, action),
      );
      res.json({ category, action });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: error.issues });
        return;
      }
      log.error('Error setting a policy preset:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to set the policy preset',
      });
    }
  },
);

export default router;
