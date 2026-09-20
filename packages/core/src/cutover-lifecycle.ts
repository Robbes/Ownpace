// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The two cutover steps that change the mapping's lifecycle, performed once
 * (ADR-0048): `enterCutover` (APPROVED → CUTOVER_IN_PROGRESS) and
 * `closeCutover` (GRACE_PERIOD → COMPLETED).
 *
 * The cutover ledger and `mailbox_mapping.status` are two records of one
 * event. The ledger is the operator's trail — who approved, when the MX
 * record moved, whether it propagated. The mapping's lifecycle is what the
 * product ACTS on: the appliance's tick and the managed poller schedule passes
 * by it (`runsPasses`), and every pass reads it to decide whether the source
 * is still the authority on what exists (`isAfterCutover`, 0117 D4). For a
 * month the CLI wrote the first and never the second, so an executed cutover
 * had a ledger saying "in progress" beside a mapping saying "syncing, source
 * authoritative" — and the passes believed the mapping.
 *
 * ## Order
 *
 * The mapping FIRST, the ledger SECOND — the same rule as `performRollback`,
 * for the same reason. A mapping write that lands beside a ledger still in
 * APPROVED is a state a second run of this function finishes (the mapping
 * row converges on `cutover`). The reverse — CUTOVER_IN_PROGRESS beside a
 * mapping still `active` — is precisely the defect, and `execute` refuses to
 * run again from that state, so there would be no way to finish it. COMPLETED
 * is terminal, which makes the same order load-bearing for `closeCutover`.
 * Every refusal happens before either write.
 *
 * ## What it does NOT do, on purpose
 *
 * - DNS. Verify-only (owner, 2026-07-16); the MX record is the operator's hand,
 *   and the wait for propagation stays in the CLI, between the two steps.
 * - Decide the mapping half. That is `cutoverTransition` in `@openmig/shared`,
 *   beside `rollbackTransition`, so both editions answer it identically.
 * - Finish the migration. COMPLETED closes the ledger; `done` is the end of
 *   the shadow sync, decided by `finishTransition` with its own rule about
 *   unresolved failures. A second door to `done` with fewer rules is the
 *   objection ADR-0047 raised against un-finishing on rollback, mirrored.
 */

import type { MappingId, TenantId } from '@openmig/shared';
import { cutoverTransition } from '@openmig/shared';
import { isValidTransition, type CutoverState, type CutoverStatus } from './cutover-state.ts';

/** The two calls these need from a cutover store — `CutoverStore` satisfies it. */
export interface CutoverLedgerPort {
  loadCutoverState(tenantId: TenantId, mappingId: MappingId): Promise<CutoverStatus | undefined>;
  transitionState(
    tenantId: TenantId,
    mappingId: MappingId,
    toState: CutoverState,
    metadata?: Record<string, unknown>,
  ): Promise<CutoverStatus>;
}

/**
 * The mapping's lifecycle, as a cutover step or a rollback needs it.
 * `mappingLifecyclePort` in `@openmig/ledger` is the real one: the row, plus
 * the `mapping.status` audit record every other lifecycle write leaves
 * (workplan 0109 T1). `via` names the door in that record's vocabulary.
 */
export interface MappingLifecyclePort {
  readStatus(): Promise<string>;
  setStatus(change: {
    readonly from: string;
    readonly to: 'active' | 'cutover';
    readonly via: 'rollback' | 'cutover';
  }): Promise<void>;
}

export interface CutoverStepDeps {
  readonly tenantId: TenantId;
  readonly mappingId: MappingId;
  readonly cutoverStore: CutoverLedgerPort;
  readonly mapping: MappingLifecyclePort;
  /** Who: `'cli'` — lands in the cutover event's metadata. */
  readonly by: string;
  /** Progress lines; the caller routes them to its own output. */
  readonly log: (message: string) => void;
}

export interface CutoverStepOutcome {
  readonly state: 'CUTOVER_IN_PROGRESS' | 'COMPLETED';
  /** The cutover state this stepped FROM. */
  readonly from: CutoverState;
  readonly mapping: {
    readonly from: string;
    readonly to: string;
    /** False when the mapping was left where it was — `note` says why. */
    readonly changed: boolean;
    readonly note?: string;
    /** Something the operator must hear even though nothing was changed. */
    readonly warning?: string;
  };
}

/**
 * A step that did not happen, and changed nothing. Callers tell it apart from
 * an error mid-write: a refusal is not a failed cutover and must not be
 * recorded as one.
 */
export class CutoverRefused extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'CutoverRefused';
    this.hint = hint;
  }
}

/** APPROVED → CUTOVER_IN_PROGRESS, and the mapping stops for the cutover. */
export function enterCutover(deps: CutoverStepDeps): Promise<CutoverStepOutcome> {
  return step(deps, 'CUTOVER_IN_PROGRESS', {
    startedAt: new Date().toISOString(),
    startedBy: deps.by,
  });
}

/** GRACE_PERIOD → COMPLETED, and a mapping still running is stopped on the way. */
export function closeCutover(deps: CutoverStepDeps): Promise<CutoverStepOutcome> {
  return step(deps, 'COMPLETED', {
    completedAt: new Date().toISOString(),
    completedBy: deps.by,
  });
}

async function step(
  deps: CutoverStepDeps,
  to: 'CUTOVER_IN_PROGRESS' | 'COMPLETED',
  metadata: Record<string, unknown>,
): Promise<CutoverStepOutcome> {
  const { tenantId, mappingId } = deps;

  const state = await deps.cutoverStore.loadCutoverState(tenantId, mappingId);
  if (!state) {
    throw new CutoverRefused('No cutover state found. Start cutover first.');
  }
  const from = state.currentState ?? state.state;
  if (!isValidTransition(from, to)) {
    // The machine, not a hand-typed list: only APPROVED admits
    // CUTOVER_IN_PROGRESS and only GRACE_PERIOD admits COMPLETED.
    throw new CutoverRefused(
      `A cutover in ${from} cannot move to ${to}.`,
      to === 'CUTOVER_IN_PROGRESS'
        ? 'Cutover must be in APPROVED state — verify, then approve, first.'
        : 'Cutover must be in GRACE_PERIOD state — COMPLETED is only reachable from there.',
    );
  }

  // The mapping half is DECIDED before anything is written, so a refusal
  // leaves both halves exactly as they were.
  const mappingStatus = await deps.mapping.readStatus();
  const decision = cutoverTransition(mappingStatus);
  if ('refuse' in decision) {
    throw new CutoverRefused(decision.refuse, decision.hint);
  }

  // Mapping first — see the header for why this order and not the other.
  let mapping: CutoverStepOutcome['mapping'];
  if (decision.stop) {
    deps.log(
      `Mapping ${decision.from} -> ${decision.to}: the shadow sync stops; the source is no ` +
        'longer the authority on what exists.',
    );
    await deps.mapping.setStatus({ from: decision.from, to: decision.to, via: 'cutover' });
    mapping = { from: decision.from, to: decision.to, changed: true };
  } else {
    deps.log(`Mapping left '${decision.from}': ${decision.reason}`);
    if (decision.warning) deps.log(decision.warning);
    mapping = {
      from: decision.from,
      to: decision.from,
      changed: false,
      note: decision.reason,
      ...(decision.warning ? { warning: decision.warning } : {}),
    };
  }

  await deps.cutoverStore.transitionState(tenantId, mappingId, to, {
    ...metadata,
    // The mapping half, in the cutover's own trail: "did the sync stop" is
    // the question this step's event exists to answer.
    stoppedSync: mapping.changed,
    mappingStatus: mapping.to,
  });
  deps.log(`Cutover marked ${to}.`);

  return { state: to, from, mapping };
}
