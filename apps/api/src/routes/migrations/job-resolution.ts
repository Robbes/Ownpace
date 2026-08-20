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
