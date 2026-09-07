// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Pure resolution of a sync/cutover API request into the Trigger.dev task id +
 * id-only payload to enqueue. Kept free of the trigger client / router imports
 * so it is cheaply unit-testable. Payloads carry ids only — never message
 * content (§12/§17); the worker loads connections/credentials under RLS.
 */

/** Resolve the sync task: full-sync when requested, else the incremental delta. */
export function resolveSyncJob(
  tenantId: string,
  mappingId: string,
  opts: { type?: 'full' | 'delta'; forceFullScan?: boolean },
): { taskId: 'run-full-sync' | 'run-delta-sync'; payload: Record<string, unknown> } {
  const wantsFull = opts.type === 'full' || opts.forceFullScan === true;
  return wantsFull
    ? { taskId: 'run-full-sync', payload: { tenantId, mappingId, options: { forceFullScan: true } } }
    : { taskId: 'run-delta-sync', payload: { tenantId, mappingId } };
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
