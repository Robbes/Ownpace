// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * *Sync now*'s gates and its one enqueue, shared by `POST /:mappingId/sync`
 * and the machine's press for live's pass check (`scripts/live-pass.ts`;
 * workplan 0132 T9).
 *
 * Moved unchanged from the route, so a pass the machine starts is started
 * exactly as the button starts one: the migration read under row security, a
 * closed organisation, a paused migration, a withdrawn grant, Free's pace, then
 * the close and the hold again in `enqueueUnlessHeld`, right before the one
 * enqueue, on the migration's own partition.
 *
 * The visit is not here. A visit is a person checking (`visits.ts`): the route
 * records one after the press, and the machine's press records none.
 */

import type { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { grantWithdrawnRefusal } from '@openmig/shared';
import { withTenantDb } from '../../middleware/auth.ts';
import { refusedAsClosed } from '../../closed-organisation.ts';
import { enqueueUnlessHeld, type Enqueue } from '../../enqueue-unless-held.ts';
import { freePaceRefusal } from './free-pace.ts';
import { resolveSyncJob } from './job-resolution.ts';
import type { Answerable } from '../../types/api.ts';

/** What a press may ask of the pass, as the route's schema reads it. */
export interface SyncNowBody {
  readonly type?: 'full' | 'delta';
  /** The final pass before the switch, which Free's pace does not hold back. */
  readonly final?: boolean;
  readonly forceFullScan?: boolean | readonly string[];
}

/**
 * Press *Sync now*: the run enqueued and its task, or null once a refusal has
 * been written to `res`.
 */
export async function pressSyncNow(
  res: Answerable,
  tenantId: string,
  mappingId: string,
  body: SyncNowBody,
  pool: Pool,
): Promise<{ readonly run: Awaited<ReturnType<Enqueue>>; readonly taskId: 'run-delta-sync' } | null> {
  // Verify mapping exists and belongs to tenant (RLS enforced via withTenantDb)
  const mappings = await withTenantDb(tenantId, pool, async (db) => {
    return await db
      .select()
      .from(schema.mailboxMapping)
      .where(
        and(
          eq(schema.mailboxMapping.id, mappingId),
          eq(schema.mailboxMapping.tenantId, tenantId)
        )
      );
  });

  if (mappings.length === 0) {
    res.status(404).json({
      error: 'Not found',
      message: 'Mapping not found',
    });
    return null;
  }

  // A closed organisation first (0085 T2): the paused and withdrawn
  // sentences below would send the owner to a press that is refused too.
  // `enqueueUnlessHeld` reads the close again; the other doors that
  // enqueue rely on that read alone.
  if (await refusedAsClosed(res, tenantId, pool)) return null;

  // 0013 T5: a paused (draft) mapping must not sync until the owner green-lights it
  // via POST …/start. Refuse rather than silently kicking off a pass.
  if (mappings[0]?.status === 'paused') {
    res.status(409).json({
      error: 'Conflict',
      message: 'Mapping is paused — review the discovery counts and start it first (POST /start).',
    });
    return null;
  }
  // A grant the person took back (0108 T8 (c)): nothing reads their account
  // until they grant it again, so a pass enqueued now would only be refused
  // by the builder. Said here, where the owner pressed the button.
  const withdrawnAt = mappings[0]?.grantWithdrawnAt;
  if (withdrawnAt) {
    const withdrawn = grantWithdrawnRefusal(withdrawnAt).en;
    res.status(409).json({ error: 'grant_withdrawn', message: withdrawn, reason: withdrawn });
    return null;
  }

  // Free's pace holds for a press too (workplan 0157 T2): one pass a day,
  // so a press inside the day is refused with the time of the next one.
  // Never the final pass before the switch, nor in the alpha (`free-pace.ts`).
  if (!body.final) {
    const pace = await freePaceRefusal(tenantId, mappingId, pool);
    if (pace) {
      res.status(409).json(pace);
      return null;
    }
  }

  // An operator hold stops this press as it stops the tick (0132 T6 (b)).
  const enqueue = await enqueueUnlessHeld(res, tenantId, pool);
  if (!enqueue) return null;

  // Enqueue the real Trigger.dev task with an id-only, tenant-scoped payload
  // (the mapping was just verified to belong to this tenant above).
  const { taskId, payload } = resolveSyncJob(tenantId, mappingId, body);
  const run = await enqueue(taskId, payload, {
    // One running pass per mapping: the partition run-delta-sync's queue
    // relies on, and the one the sync tick and /start set. Without it this
    // run lands on the base `delta-sync` queue (limit 1, shared by every
    // tenant) and does not wait for the mapping's scheduled pass.
    concurrencyKey: mappingId,
    tags: [`tenant:${tenantId}`, `mapping:${mappingId}`],
  });

  return { run, taskId };
}
