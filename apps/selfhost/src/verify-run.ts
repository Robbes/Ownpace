// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The verification run's state machine (workplan 0017 T2), apart from its scan.
 *
 * Split from the entrypoint so the lifecycle — one run at a time, joining
 * rather than stacking, terminal states that say what happened — is testable
 * against a scan the test CONTROLS. The first version of that test tried to
 * hold a real run open with a TCP server that never answered, and lost a
 * round to connector retry backoff; the state machine was never the thing in
 * doubt, and now it does not need a network to be proved.
 *
 * The report is swapped whole, never mutated: a poller sees the old state or
 * the new one, not a half-written hybrid.
 */

import { log } from '@openmig/shared';
import type { VerificationRunReport, VerifyResponse, VerifyStartResponse } from '@openmig/shared';

export interface VerifyRunner {
  /** Begin a run unless one is under way; either way, report where things are. */
  start(): VerifyStartResponse;
  /** The current report. Reading it never starts anything. */
  current(): VerificationRunReport;
}

export function createVerifyRunner(scan: () => Promise<VerifyResponse>): VerifyRunner {
  // In memory on purpose: the appliance is single-tenant and single-process,
  // so "the last report" is a field — and after a restart `never-run` is the
  // truthful answer, since re-running costs minutes against a migration that
  // costs days. Managed persists a row instead; the contract documents the
  // asymmetry rather than hiding it.
  let run: VerificationRunReport = { state: 'never-run' };

  return {
    current: () => run,

    start(): VerifyStartResponse {
      // Joining, not stacking: verification reads every enabled domain's
      // TARGET, and two concurrent scans would double that load to answer a
      // question once. Same idempotent-action shape as POST .../start's
      // `activated: false`.
      if (run.state === 'running') return { started: false, report: run };

      const startedAt = new Date().toISOString();
      run = { state: 'running', startedAt };
      void scan().then(
        (report) => {
          run = { state: 'done', startedAt, finishedAt: new Date().toISOString(), report };
        },
        (err: unknown) => {
          // The RUN failed — the scan crashed, which is a different statement
          // from "a domain could not be read" (that is NOT_VERIFIABLE inside a
          // done report). Carried with its reason, never reset to never-run: a
          // verification that could not run must not read as one that found
          // nothing wrong (hard rule 9).
          log.error('[selfhost] verification run failed:', err);
          run = {
            state: 'failed',
            startedAt,
            error: err instanceof Error ? err.message : String(err),
          };
        },
      );
      return { started: true, report: run };
    },
  };
}
