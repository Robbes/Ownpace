// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Pure resolution of a sync/cutover API request into the Trigger.dev task id +
 * id-only payload to enqueue. Kept free of the trigger client / router imports
 * so it is cheaply unit-testable. Payloads carry ids only — never message
 * content (§12/§17); the worker loads connections/credentials under RLS.
 */

/**
 * Resolve the sync task. There is ONE, and a full scan is an option on it.
 *
 * ## What the second task was, and what it cost
 *
 * `run-full-sync` existed because a full pass passes no cursor store. That
 * was its only real difference; everything else about it was `run-delta-sync`
 * as of a much earlier release — no per-domain `migration_status`, no pause
 * handling, no deadline, no failure category. And because it called
 * `runShadowPass` directly instead of looping the mapping's domains, **it
 * synced mail and nothing else.** A customer who pressed a full re-sync on a
 * mapping carrying calendars, contacts, files and tasks had their mail copied
 * and was told it succeeded.
 *
 * That is the defect `resolveDiscoveryJob` below records from 2026-09-07, one
 * layer down and with the same cause: the mail path taken for the whole
 * product. Deleting the task is the fix — two copies of a 592-line job is how
 * one of them silently stopped being the product.
 *
 * ## `forceFullScan` may name domains
 *
 * `true` rescans every domain the pass runs. A LIST rescans only those, which
 * is the question people actually ask — "the tasks came out wrong, do those
 * again" — and avoids re-reading a mailbox that was already right against a
 * source with a daily byte ceiling (workplan 0090).
 *
 * It does not reset the stored cursors (owner's decision, 2026-09-08). The
 * job withholds the cursor STORE for the chosen domains, so the pass reads no
 * saved position and writes none: the saved position survives, and the next
 * ordinary pass resumes from it.
 */
export function resolveSyncJob(
  tenantId: string,
  mappingId: string,
  opts: { type?: 'full' | 'delta'; forceFullScan?: boolean | readonly string[] },
): { taskId: 'run-delta-sync'; payload: Record<string, unknown> } {
  const domains = Array.isArray(opts.forceFullScan) ? [...opts.forceFullScan] : undefined;
  const everything = opts.type === 'full' || opts.forceFullScan === true;
  return {
    taskId: 'run-delta-sync',
    payload: {
      tenantId,
      mappingId,
      // Absent means absent — an explicit `false` would read as a choice
      // somebody made, and the job's schema marks the field optional.
      ...(domains ? { forceFullScan: domains } : everything ? { forceFullScan: true } : {}),
    },
  };
}

/**
 * Resolve the cutover task + payload from the request options.
 *
 * The task prepares and verifies a cutover and stops at READY_FOR_CUTOVER; it
 * does not execute one, so there is no grace period for it to carry.
 */
export function resolveCutoverJob(
  tenantId: string,
  mappingId: string,
  opts: { skipFinalSync?: boolean; skipVerification?: boolean },
): { taskId: 'run-cutover'; payload: Record<string, unknown> } {
  return {
    taskId: 'run-cutover',
    payload: {
      tenantId,
      mappingId,
      options: {
        skipFinalSync: opts.skipFinalSync === true,
        skipVerification: opts.skipVerification === true,
      },
    },
  };
}

/**
 * Resolve the preflight (discovery) task + payload.
 *
 * THE POINT OF THIS FUNCTION IS THE `domains` KEY IT DOES NOT WRITE.
 *
 * The route used to fill an omitted list in with every domain the product
 * carries. That default is wrong here for the reason `resolveSyncJob`'s
 * payload has never carried one: only `scope_selection` knows which domains
 * the owner ticked, and it is the job — the one thing that can read it — that
 * must decide. A copy of the list made at the API is a copy that can be
 * stale, and it silently overrode the owner's choice rather than deferring to
 * it.
 *
 * What that cost, live on 2026-09-07: a migration carrying calendars,
 * contacts, files and tasks — everything BUT mail — showed an Email row on
 * its preflight reading `Unsupported target type: undefined`, because the
 * mail arm went looking for a mail target this mapping was never given. Four
 * real rows and one that could only ever fail.
 *
 * A caller that names domains still gets exactly those, so a narrower
 * re-count stays possible; it just cannot happen by accident.
 */
export function resolveDiscoveryJob(
  tenantId: string,
  mappingId: string,
  opts: { domains?: readonly string[] },
): { taskId: 'run-discovery'; payload: Record<string, unknown> } {
  return {
    taskId: 'run-discovery',
    payload: {
      tenantId,
      mappingId,
      // Spread, not `domains: opts.domains` — an explicit `undefined` would
      // survive JSON.stringify as a missing key here but reads as a value
      // somebody chose, and the job's schema marks the field optional rather
      // than nullable. Absent means absent.
      ...(opts.domains ? { domains: [...opts.domains] } : {}),
    },
  };
}
