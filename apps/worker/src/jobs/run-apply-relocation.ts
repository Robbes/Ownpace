// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Apply-Relocation Job (ADR-0030, managed edition)
 *
 * THE SECOND DESTRUCTIVE JOB, and the shape of `run-apply-deletion` on
 * purpose: the API route has already evaluated every ledger-side gate
 * synchronously (`evaluateApplyRelocation`) and refused on the request if any
 * said no. This job re-runs ALL the gates freshly — `applyRelocation` is its
 * own final authority — and performs the parts a request thread must not: it
 * asks the TARGET whether the relocated copy is really there (ADR-0030's own
 * gate; the ledger's word is a claim, not proof), and only then removes the
 * OLD copy, holding real credentials. A cutover executed since the press is
 * asked here too, at the removal: after it nothing is removed
 * (`after_cutover`, 2026-10-05).
 *
 * The outcome lands on the `apply_receipt` row the route created — the one
 * with `action = 'relocation'`, because the same item can have a deletion
 * receipt open at the same time and the two must never answer for each other.
 *
 * Trigger: manual (API-initiated), one item per invocation — §11.2's "one
 * item, one decision, one call" survives the queue hop.
 */

// The rule for a host a tenant gives us, on before this run connects anywhere (0136 T1).
import './refuse-internal-addresses.ts';
import { z } from 'zod';
import { leavesAReference } from './what-a-run-leaves.ts';
import type { RunContext } from './run-context.ts';
import { applyRelocation } from '@openmig/core';
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
  name: 'run-apply-relocation',
  apply: applyRelocation,
  removed: (item, kind) =>
    `removed the OLD copy of ${item} (${kind}) — the same bytes remain under the key the source moved it to.`,
};

/**
 * This task's run, as the pg-boss worker serves it (ADR-0054; workplan 0167
 * T6), with the context `run-context.ts` describes.
 */
export const runApplyRelocationRun = leavesAReference(
  'run-apply-relocation',
  async (payload: z.infer<typeof ApplyJobSchema>, _context: RunContext) => applyOneItem(JOB, pool, payload),
);
