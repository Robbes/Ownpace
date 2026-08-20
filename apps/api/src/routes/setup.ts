// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The provider setup checklist (workplan 0061).
 *
 * `GET  /api/setup/:side/:provider` — the steps and where they have got to.
 * `PUT  /api/setup/:side/:provider/:stepKey` — record what a person decided.
 *
 * The STEPS come from `@openmig/shared` and the STATE from the ledger, merged
 * here. A step nobody has touched has no row at all and reads as `open`, so a
 * step added in a later release is open for every tenant the moment it ships,
 * with no backfill — see `provider-setup.ts` for why that split exists.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import {
  setupStepsFor,
  summariseSetup,
  type SetupSide,
  type SetupStepStatus,
} from '@openmig/shared';
import { PgLedger } from '@openmig/ledger';
import type { TenantId } from '@openmig/shared';
import { authenticate, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';

const router = Router();

let _pool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_pool) _pool = getDbPool();
  return _pool;
}

const SIDES: ReadonlyArray<SetupSide> = ['source', 'target'];

/** One path segment, or undefined — Express types these as possibly repeated. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sideOf(value: string | string[] | undefined): SetupSide | undefined {
  const v = one(value);
  return SIDES.find((s) => s === v);
}

const DecisionSchema = z.object({
  state: z.enum(['open', 'done', 'skipped']),
});

/** Steps (from code) merged with state (from the ledger), plus the summary. */
async function readChecklist(tenantId: string, side: SetupSide, provider: string) {
  const steps = setupStepsFor(side, provider);
  const rows = await withTenantDb(tenantId, pool(), (db) =>
    new PgLedger(db).listSetupSteps(tenantId as TenantId, side, provider),
  );
  const byKey = new Map(rows.map((r) => [r.stepKey, r]));
  const statuses: SetupStepStatus[] = steps.map((step) => {
    const row = byKey.get(step.key);
    return {
      step,
      // No row means nobody has answered this step yet.
      state: row?.state ?? 'open',
      ...(row?.decidedBy ? { decidedBy: row.decidedBy } : {}),
      ...(row?.decidedAt ? { decidedAt: row.decidedAt } : {}),
    };
  });
  return { side, provider, steps: statuses, progress: summariseSetup(statuses) };
}

router.get('/:side/:provider', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const side = sideOf(req.params.side);
    const provider = one(req.params.provider);
    if (!side || !provider) {
      return void res.status(400).json({
        error: 'invalid_path',
        reason: "The path is /api/setup/{source|target}/{provider}.",
      });
    }
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    res.json(await readChecklist(req.tenantId, side, provider));
  } catch (error) {
    serverFault(res, 'read_failed', 'reading the setup checklist', error);
  }
});

router.put(
  '/:side/:provider/:stepKey',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const side = sideOf(req.params.side);
      const provider = one(req.params.provider);
      const stepKey = one(req.params.stepKey);
      if (!side || !provider || !stepKey) {
        return void res.status(400).json({
          error: 'invalid_path',
          reason: 'The path is /api/setup/{source|target}/{provider}/{stepKey}.',
        });
      }
      if (!req.tenantId) {
        return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
      }
      const parsed = DecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json({
          error: 'invalid_body',
          reason: "Send { state } — one of 'open', 'done' or 'skipped'.",
        });
      }
      // Refuse a step this provider does not have, rather than storing a row
      // nothing will ever read back: a typo'd key would otherwise look saved.
      const known = setupStepsFor(side, provider).some((s) => s.key === stepKey);
      if (!known) {
        return void res.status(404).json({
          error: 'unknown_step',
          reason: `'${stepKey}' is not a setup step for the ${side} '${provider}'.`,
        });
      }
      await withTenantDb(req.tenantId, pool(), (db) =>
        new PgLedger(db).setSetupStepState(req.tenantId as TenantId, side, provider, stepKey, {
          state: parsed.data.state,
          decidedBy: req.userId ?? 'unknown',
        }),
      );
      res.json(await readChecklist(req.tenantId, side, provider));
    } catch (error) {
      serverFault(res, 'write_failed', 'recording that setup step', error);
    }
  },
);

export default router;
