// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A rollback is a SETBACK, performed once (ADR-0047).
 *
 * The owner's definition, 2026-08-23, in full:
 *
 *   A rollback puts the migration back to syncing, with the original source
 *   live again, and that is all of it. It NEVER swaps source and target. It
 *   NEVER salvages from the target — mail delivered there while MX pointed at
 *   it stays there, because pulling it back means writing to a source this
 *   product only ever reads.
 *
 * That is two writes: the mapping back to `active` (when it was stopped for
 * the cutover), and the cutover ledger to ROLLED_BACK. For a month they lived
 * in two places — an operator CLI that did the second and a Trigger.dev job
 * nobody called that did both — so the reachable rollback delivered the label
 * and not the thing. This is the one implementation. The CLI and the job are
 * callers: they gate, they print, they notify; they decide nothing.
 *
 * ## Order
 *
 * The mapping FIRST, the ledger SECOND. ROLLED_BACK is terminal: a ledger
 * write that succeeds followed by a mapping write that fails recreates the
 * original defect with no way back through the state machine. The reverse —
 * an `active` mapping beside a cutover still in its grace window — is a state
 * a second run of this function finishes. And every refusal happens before
 * either write: half a rollback is the thing this file exists to end.
 *
 * ## What it does NOT do, on purpose
 *
 * - DNS. Verify-only (owner, 2026-07-16); the MX record is the operator's hand.
 * - Anything to the target's contents.
 * - Decide the mapping half. That is `rollbackTransition` in `@openmig/shared`,
 *   beside `startTransition` and `finishTransition`, so both editions answer
 *   it identically (hard rule 5).
 */

import type { MappingId, TenantId } from '@openmig/shared';
import { rollbackTransition } from '@openmig/shared';
import { isValidTransition, type CutoverState, type CutoverStatus } from './cutover-state.ts';

/** The two calls this needs from a cutover store — `CutoverStore` satisfies it. */
export interface RollbackCutoverStore {
  loadCutoverState(tenantId: TenantId, mappingId: MappingId): Promise<CutoverStatus | undefined>;
  transitionState(
    tenantId: TenantId,
    mappingId: MappingId,
    toState: CutoverState,
    metadata?: Record<string, unknown>,
  ): Promise<CutoverStatus>;
}

/**
 * The mapping's lifecycle, as this needs it. `mappingLifecyclePort` in
 * `@openmig/ledger` is the real one: the row, plus the `mapping.status` audit
 * record every other lifecycle write leaves (workplan 0109 T1).
 */
export interface MappingLifecyclePort {
  readStatus(): Promise<string>;
  setStatus(change: { readonly from: string; readonly to: 'active' }): Promise<void>;
}

export interface RollbackDeps {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly cutoverStore: RollbackCutoverStore;
  readonly mapping: MappingLifecyclePort;
  /** Who: `'cli'`, `'trigger-job'` — lands in the cutover event's metadata. */
  readonly rolledBackBy: string;
  readonly reason: string;
  /** Progress lines; the callers route them to their own output. */
  readonly log: (message: string) => void;
  /**
   * Runs AFTER the rollback succeeded, and its failure never undoes it: the
   * rollback IS complete, and a mail server being down must not report
   * otherwise. The outcome says whether it sent, so the caller can say so.
   */
  readonly notify?: () => Promise<void>;
}

export interface RollbackOutcome {
  readonly state: 'ROLLED_BACK';
  /** The cutover state this rolled back FROM. */
  readonly from: CutoverState;
  readonly mapping: {
    readonly from: string;
    readonly to: string;
    /** False when the mapping was left where it was — `note` says why. */
    readonly changed: boolean;
    readonly note?: string;
  };
  readonly notified: 'not_asked' | 'sent' | { readonly failed: string };
}

/**
 * A rollback that did not happen, and changed nothing. Callers tell it apart
 * from an error mid-write: a refusal is not a failed cutover and must not be
 * recorded as one.
 */
export class RollbackRefused extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'RollbackRefused';
    this.hint = hint;
  }
}

/** The one thing this file says out loud, so both callers say it identically. */
export const TARGET_MAIL_STAYS =
  'Mail delivered to the TARGET while MX pointed at it stays on the target. The resumed ' +
  'sync runs source -> target and will not bring it back. Recover it from the target by ' +
  'hand if you need it.';

export async function performRollback(deps: RollbackDeps): Promise<RollbackOutcome> {
  const { tenantId, mappingId } = deps;

  const state = await deps.cutoverStore.loadCutoverState(tenantId, mappingId);
  if (!state) {
    throw new RollbackRefused('No cutover state found — nothing to roll back.');
  }
  const from = state.currentState ?? state.state;
  if (!isValidTransition(from, 'ROLLED_BACK')) {
    throw new RollbackRefused(
      `A cutover in ${from} cannot be rolled back.`,
      from === 'COMPLETED'
        ? 'COMPLETED is terminal; reverting now means a manual MX change and a new migration.'
        : from === 'ROLLED_BACK'
          ? 'It already is.'
          : 'Nothing has been executed yet; there is nothing to set back.',
    );
  }

  // The mapping half is DECIDED before anything is written, so a refusal
  // leaves both halves exactly as they were.
  const mappingStatus = await deps.mapping.readStatus();
  const decision = rollbackTransition(mappingStatus);
  if ('refuse' in decision) {
    throw new RollbackRefused(decision.refuse, decision.hint);
  }

  deps.log(`Rolling back cutover from ${from} (${deps.reason})`);

  // Mapping first — see the header for why this order and not the other.
  let mapping: RollbackOutcome['mapping'];
  if (decision.reactivate) {
    deps.log(`Mapping ${decision.from} -> ${decision.to}: the sync resumes with the source authoritative.`);
    await deps.mapping.setStatus({ from: decision.from, to: decision.to });
    mapping = { from: decision.from, to: decision.to, changed: true };
  } else {
    deps.log(`Mapping left '${decision.from}': ${decision.reason}`);
    mapping = { from: decision.from, to: decision.from, changed: false, note: decision.reason };
  }

  await deps.cutoverStore.transitionState(tenantId, mappingId, 'ROLLED_BACK', {
    rolledBackAt: new Date().toISOString(),
    rolledBackBy: deps.rolledBackBy,
    rollbackReason: deps.reason,
    // The mapping half, in the cutover's own trail: "did the sync resume" is
    // the question a rollback's audit row exists to answer.
    resumedSync: mapping.changed,
    mappingStatus: mapping.to,
  });
  deps.log('Cutover marked ROLLED_BACK.');
  deps.log(TARGET_MAIL_STAYS);

  let notified: RollbackOutcome['notified'] = 'not_asked';
  if (deps.notify) {
    try {
      await deps.notify();
      notified = 'sent';
    } catch (err) {
      notified = { failed: err instanceof Error ? err.message : String(err) };
    }
  }

  return { state: 'ROLLED_BACK', from, mapping, notified };
}
