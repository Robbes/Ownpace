// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * GET /api/shared-addresses — what discovery found (workplan 0027 T4).
 *
 * 0027 T1 writes `group_def` and, until this route existed, nothing read it:
 * a table filling up nightly with findings nobody could see. That is the
 * shape of dead surface the 2026-08-02 sweep spent a day deleting, and the
 * reason this lands in the same cycle as the writer rather than later.
 *
 * Any member may read it. A shared address is not a secret from the people
 * whose mail it carries, and the screen it feeds is Review & confirm — what
 * is about to be migrated, before anything is. Nothing here writes; the one
 * thing that CAN change a discovered address's pattern is answering its
 * decision (0028 T3), which goes through the decision routes and their
 * never-overwrite contract rather than a second door.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { authenticate, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { PgGroupDefStore } from '@openmig/ledger';
import { asTenantId } from '@openmig/shared';
import { renderGroupRunbook } from '@openmig/core';
import { serverFault } from '../server-fault.ts';

const router = Router();

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function getSharedPool() {
  if (!_dbPool) {
    _dbPool = getDbPool();
  }
  return _dbPool;
}

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

    const addresses = await withTenantDb(tenantId, getSharedPool(), async (db) =>
      new PgGroupDefStore(db).list(asTenantId(tenantId)),
    );

    res.json({ addresses });
  } catch (error) {
    // Never an empty list on failure: "we could not read them" and "there are
    // none" are opposite sentences, and the screen renders them differently
    // (hard rule 9).
    serverFault(res, 'list_failed', 'listing the shared addresses', error);
  }
});

/**
 * GET /api/shared-addresses/runbook — the Pattern D steps (workplan 0027 T2).
 *
 * Markdown rather than JSON, and that is the point: this is a document a
 * person follows, on a target platform this tool cannot reach. §14.2's
 * "guide" step, applied to §14.1 — no target we support exposes an interface
 * for creating a mail group, so the whole of Pattern D recreation is guided
 * and the document says so on its first line.
 *
 * Read-only and derived: nothing is stored, so re-reading after answering a
 * decision or re-running discovery gives the current picture rather than a
 * snapshot somebody has to remember to refresh.
 */
router.get('/runbook', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }

    const groups = await withTenantDb(tenantId, getSharedPool(), async (db) =>
      new PgGroupDefStore(db).list(asTenantId(tenantId)),
    );

    const markdown = renderGroupRunbook({
      groups,
      // The date is passed IN: `renderGroupRunbook` never reads a clock, so
      // it stays a pure function of its inputs and testable without one.
      generatedOn: new Date().toISOString().slice(0, 10),
    });

    res.type('text/markdown; charset=utf-8').send(markdown);
  } catch (error) {
    serverFault(res, 'runbook_failed', 'rendering the runbook', error);
  }
});

export default router;
