// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Running the `new_mailbox` detector (workplan 0028 T2, the wiring half).
 *
 * `detectNewMailboxes` decides WHAT to raise; this decides what happens
 * around it — reading the directory, writing to the queue, and telling
 * somebody. Kept behind a deps seam because every one of those is a different
 * thing per edition, while the rules below must not be.
 *
 * FOUR RULES, each of them a way this could go wrong in production:
 *
 *  1. **Notify only on a decision that was actually CREATED.** The store's
 *     raise is idempotent — re-raising a pending subject returns the existing
 *     row with `created: false`. A detector on an hourly schedule would
 *     otherwise email the owner about the same mailbox twenty-four times a day
 *     until they answered it, which is how a channel gets filtered.
 *  2. **A blind spot is stated, loudly, every run.** No decisions plus no
 *     message reads as "all covered". The reason the directory could not be
 *     read is the most important output this function has when it happens.
 *  3. **One address failing does not stop the others.** A raise that throws is
 *     reported and the loop continues; a tenant with one problematic mailbox
 *     still gets told about the other four.
 *  4. **A failed notification never undoes a raised decision.** The decision
 *     is in the queue and the screen will show it; the email is the courtesy.
 *     Losing the courtesy must not lose the record.
 */

import type { RaiseDecisionInput, TenantId } from '@openmig/shared';
import { detectNewMailboxes, type DirectoryListing } from './detect-new-mailboxes.ts';

export interface DetectionDeps {
  readonly tenantId: TenantId;
  /** Ask the source for the tenant's mailboxes — or for the reason it cannot. */
  listDirectory(): Promise<DirectoryListing>;
  /** Every address a mapping in this tenant already covers. */
  coveredAddresses(): Promise<readonly string[]>;
  /** Subjects the owner has already closed; not asked again. */
  dismissedAddresses(): Promise<readonly string[]>;
  /**
   * Why coverage is incomplete, when it is. Returning a reason stops this run
   * from raising anything — see `DetectInput.coverageIncomplete`.
   */
  coverageIncomplete?(): Promise<string | undefined>;
  /** Write to the decision queue. `created` false means it was already pending. */
  raise(input: RaiseDecisionInput): Promise<{ readonly created: boolean; readonly id: string }>;
  /**
   * The tenant's standing answer for this category (workplan 0028 T5).
   *
   * `ask` — the default, and the default when no preference was ever
   * expressed — means the decision waits for a person. `auto` means the
   * detector answers its own decision: the row is still RAISED, so the
   * history shows the mailbox was noticed, and then closed as
   * `auto_resolved` recording that a standing rule closed it rather than a
   * human. Omit the dep entirely to always ask.
   */
  presetAction?(): Promise<'auto' | 'ask'>;
  /** Close a decision the preset answered. Never called when the preset is `ask`. */
  autoResolve?(decisionId: string, input: RaiseDecisionInput): Promise<void>;
  /**
   * Tell somebody about a decision that is NEW. Called once per created
   * decision, never for one that was already pending.
   */
  onRaised(input: RaiseDecisionInput): Promise<void>;
  warn(message: string): void;
  error(message: string, err: unknown): void;
}

export interface DetectionSummary {
  /** Decisions created by this run — the ones somebody was told about. */
  readonly raised: number;
  /** Decisions a standing preset answered, so nobody was interrupted. */
  readonly autoResolved: number;
  /** Subjects already pending; re-detected, deliberately not re-announced. */
  readonly alreadyPending: number;
  /** Raises that threw. Reported, never silent. */
  readonly failed: number;
  /** Present when the directory could not be read, in the source's own words. */
  readonly blindSpot?: string;
}

/** One detection pass. Never throws for one mailbox's sake. */
export async function runNewMailboxDetection(deps: DetectionDeps): Promise<DetectionSummary> {
  const listing = await deps.listDirectory();
  const [covered, dismissed] = await Promise.all([
    deps.coveredAddresses(),
    deps.dismissedAddresses(),
  ]);

  const incomplete = await deps.coverageIncomplete?.();
  const result = detectNewMailboxes({
    tenantId: deps.tenantId,
    listing,
    covered: covered.map((address) => ({ address })),
    dismissed,
    ...(incomplete ? { coverageIncomplete: incomplete } : {}),
  });

  if (result.blindSpot) {
    // Rule 2. Said every run, not once: an operator reading today's log must
    // be able to see that today's run could not look, without going back to
    // find the first time it happened.
    deps.warn(`[detect] ${deps.tenantId}: ${result.blindSpot}`);
    return {
      raised: 0,
      autoResolved: 0,
      alreadyPending: 0,
      failed: 0,
      blindSpot: result.blindSpot,
    };
  }

  let raised = 0;
  let autoResolved = 0;
  let alreadyPending = 0;
  let failed = 0;

  // Read ONCE per run, not per decision: a preset that changed mid-run would
  // otherwise answer some of a tenant's mailboxes and ask about the rest.
  const preset = (await deps.presetAction?.()) ?? 'ask';

  for (const decision of result.decisions) {
    let created: boolean;
    let id: string;
    try {
      ({ created, id } = await deps.raise(decision));
    } catch (err) {
      // Rule 3.
      deps.error(`[detect] ${deps.tenantId}: could not raise a decision about ${decision.subjectKey}`, err);
      failed++;
      continue;
    }

    if (!created) {
      // Rule 1: already pending, already announced. Counted so a run's output
      // shows the detector is working rather than looking idle.
      alreadyPending++;
      continue;
    }
    if (preset === 'auto') {
      // The row exists — the queue is the audit trail, and "we noticed this
      // mailbox and a standing rule closed it" is exactly what it should
      // record. Nobody is interrupted: being told about something already
      // answered is the noise presets exist to remove.
      autoResolved++;
      try {
        await deps.autoResolve?.(id, decision);
      } catch (err) {
        deps.error(
          `[detect] ${deps.tenantId}: could not auto-resolve the decision about ${decision.subjectKey}`,
          err,
        );
      }
      continue;
    }

    raised++;

    try {
      await deps.onRaised(decision);
    } catch (err) {
      // Rule 4. The decision is in the queue either way; the screen has it.
      deps.error(
        `[detect] ${deps.tenantId}: raised a decision about ${decision.subjectKey} but could not announce it`,
        err,
      );
    }
  }

  return { raised, autoResolved, alreadyPending, failed };
}
