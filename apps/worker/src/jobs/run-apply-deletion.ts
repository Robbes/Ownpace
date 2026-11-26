// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Apply-Deletion Job (workplan 0017 T4, managed edition)
 *
 * THE ONE DESTRUCTIVE JOB. The API route has already evaluated every
 * ledger-side gate synchronously and refused on the request if any said no —
 * an enqueue means "permitted, as of a moment ago". This job re-runs ALL the
 * gates freshly (`applyDeletion` is its own final authority; the route's
 * verdict was a prediction, and gate 7's conditional UPDATE stays the last
 * word under concurrency) and performs the one thing a request thread must
 * not: the removal, against the real target, holding real credentials.
 *
 * The outcome lands on the `apply_receipt` row the route created:
 *   - applied, with how final that was (`binned` targets may still hold a copy);
 *   - refused, with the gate that fired — from here that is usually one of the
 *     two only the target could answer (capability; the owner edited our copy),
 *     but a fresh ledger refusal is possible and lands the same way, and so is
 *     a cutover executed since the press (`after_cutover`, 2026-10-05: the
 *     data type's phase is asked again here, at the removal);
 *   - failed, with the reason, if the job itself crashed. Never left `queued`
 *     forever, and never silently dropped (hard rule 9).
 *
 * Trigger: manual (API-initiated), one item per invocation — §11.2's "one
 * item, one decision, one call" survives the queue hop.
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { z } from 'zod';
import { leavesAReference } from './what-a-run-leaves.ts';
import type { RunContext } from './run-context.ts';
import { applyDeletion } from '@openmig/core';
import { openTaskPools } from './task-pools.ts';
import { applyOneItem, type ApplyJob } from './apply-one-item.ts';

export const ApplyJobSchema = z.object({
  tenantId: z.string().uuid(),
  mappingId: z.string().uuid(),
  naturalKeyHash: z.string().min(1),
  /** The `apply_receipt` row the API created; this job owns its outcome. */
  receiptId: z.string().uuid(),
});

// Its pools, from the one module that builds a per-tenant task's (0138 T1):
// the tenant pool on APP_DATABASE_URL, app_user, under row security, and the
// audit key's pool of one on the owner's URL. It points this process's sinks
// too: the operator's log page (0129 T1) at the tenant pool, the audit lines
// (0129 T4) at the key's pool, the one read app_user may not make.
const { tenant: pool } = openTaskPools();

/** Its core call and its words; the run itself is `applyOneItem`'s, shared with the other apply job. */
const JOB: ApplyJob = {
  name: 'run-apply-deletion',
  apply: applyDeletion,
  removed: (item, kind) => `removed ${item} (${kind})`,
};

/**
 * This task's run, as the pg-boss worker serves it (ADR-0054; workplan 0167
 * T6), with the context `run-context.ts` describes.
 */
export const runApplyDeletionRun = leavesAReference(
  'run-apply-deletion',
  async (payload: z.infer<typeof ApplyJobSchema>, _context: RunContext) => applyOneItem(JOB, pool, payload),
);
