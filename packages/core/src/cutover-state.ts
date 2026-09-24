// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Cutover State Machine
 * 
 * Manages the migration cutover process from initial preparation through completion.
 * Follows a strict state machine to ensure safe, non-destructive transitions.
 * 
 * States:
 * - PREPARING: Initial setup, verification pending
 * - READY_FOR_CUTOVER: All verifications passed, ready to begin
 * - CUTOVER_IN_PROGRESS: DNS changes being made, final sync running
 * - GRACE_PERIOD: Both systems active, monitoring for discrepancies
 * - COMPLETED: Migration complete, only target system active
 * - ROLLED_BACK: Migration rolled back to source system — a setback; may be attempted again
 * - FAILED: Error occurred, requires manual intervention
 * 
 * All state transitions are logged and must be explicit.
 */

import type { TenantId, MappingId, CutoverWindow } from '@openmig/shared';

/** Cutover state values */
export type CutoverState = 
  | 'PREPARING'
  | 'READY_FOR_CUTOVER'
  | 'APPROVED'
  | 'CUTOVER_IN_PROGRESS'
  | 'GRACE_PERIOD'
  | 'COMPLETED'
  | 'ROLLED_BACK'
  | 'FAILED';

/** Cutover phase for better UX */
export type CutoverPhase = 
  | 'PREPARATION'
  | 'VERIFICATION'
  | 'CUTOVER'
  | 'GRACE'
  | 'COMPLETION'
  | 'ROLLBACK'
  | 'ERROR';

/** Cutover status record */
export interface CutoverStatus {
  tenantId: TenantId;
  mappingId: MappingId;
  state: CutoverState;
  phase: CutoverPhase;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  
  // Verification results
  verificationStatus: 'PENDING' | 'PASS' | 'WARN' | 'FAIL';
  verificationReport?: string;
  
  // Cutover details
  cutoverStartedAt?: string;
  cutoverCompletedAt?: string;
  gracePeriodStartedAt?: string;
  gracePeriodEndsAt?: string;
  /**
   * Whether the migration keeps being copied from execute until the grace
   * period ends (workplan 0128 T2): set by execute, true when the migration
   * was `active` then. `cutoverStillCopiesAt` in `@openmig/shared` reads it.
   */
  copiesThroughGrace?: boolean;
  /** How long the grace period lasts: the ledger row's `grace_period_hours`. */
  gracePeriodHours?: number;
  
  // Statistics
  totalItemsMigrated: number;
  itemsVerified: number;
  discrepanciesFound: number;
  
  // Error handling
  errorMessage?: string;
  errorDetails?: string;
  
  // Rollback support
  rollbackAvailable: boolean;
  rollbackReason?: string;
  
  // Extended properties for CLI and runbook
  currentState?: CutoverState; // Alias for state, for CLI compatibility
  targetMailServer?: string;
  startedBy?: string;
  rolledBackAt?: string;
  failedAt?: string;
  failureReason?: string;
  gracePeriodCompletedAt?: string;
  metadata?: Record<string, unknown>;
  
  // Rollback-specific properties
  dnsRecordsUpdated?: boolean;
  dnsVerifiedAt?: string;
  dnsRestored?: boolean;
  rollbackNotes?: string;
  itemsAddedDuringCutover?: number;
}

/** Cutover configuration */
export interface CutoverConfig {
  tenantId: TenantId;
  mappingId: MappingId;
  
  // Grace period settings
  gracePeriodDurationHours: number; // Default: 72 hours (3 days)
  autoCompleteAfterGrace: boolean; // Default: true
  
  // Verification thresholds
  requiredVerificationScore: number; // Default: 0.95 (95%)
  maxDiscrepancyPercentage: number; // Default: 0.01 (1%)
  
  // Notifications
  notifyOnStateChange: boolean; // Default: true
  notifyOnDiscrepancy: boolean; // Default: true
  
  // Safety
  requireManualApproval: boolean; // Default: true
  dryRun: boolean; // Default: false
}

/** Cutover result */
export interface CutoverResult {
  success: boolean;
  state: CutoverState;
  message: string;
  details?: Record<string, unknown>;
}

/** Cutover event for logging/auditing */
export interface CutoverEvent {
  tenantId: TenantId;
  mappingId: MappingId;
  timestamp: string;
  fromState: CutoverState | null; // null for initialization events
  toState: CutoverState;
  triggeredBy: string; // 'system' or user ID
  reason?: string;
  metadata?: Record<string, unknown>;
  
  // Extended properties for CLI compatibility
  eventType?: 'CUTOVER_INITIALIZED' | 'STATE_TRANSITION'; // Type of event
  description?: string; // Human-readable description
}

/** Cutover manager interface */
export interface CutoverManager {
  // State management
  getState(tenantId: TenantId, mappingId: MappingId): Promise<CutoverStatus | undefined>;
  transitionTo(
    tenantId: TenantId,
    mappingId: MappingId,
    toState: CutoverState,
    reason: string
  ): Promise<CutoverResult>;
  
  // Cutover lifecycle
  startCutover(tenantId: TenantId, mappingId: MappingId): Promise<CutoverResult>;
  verifyCutover(tenantId: TenantId, mappingId: MappingId): Promise<CutoverResult>;
  approveCutover(tenantId: TenantId, mappingId: MappingId): Promise<CutoverResult>;
  executeCutover(tenantId: TenantId, mappingId: MappingId): Promise<CutoverResult>;
  startGracePeriod(tenantId: TenantId, mappingId: MappingId): Promise<CutoverResult>;
  completeCutover(tenantId: TenantId, mappingId: MappingId): Promise<CutoverResult>;
  rollbackCutover(tenantId: TenantId, mappingId: MappingId, reason: string): Promise<CutoverResult>;
  
  // Monitoring
  checkGracePeriodStatus(tenantId: TenantId, mappingId: MappingId): Promise<CutoverResult>;
  getDiscrepancies(tenantId: TenantId, mappingId: MappingId): Promise<Array<Record<string, unknown>>>;
  
  // Events
  getEventHistory(tenantId: TenantId, mappingId: MappingId): Promise<CutoverEvent[]>;
}

/** Valid state transitions */
const VALID_TRANSITIONS: Record<CutoverState, CutoverState[]> = {
  PREPARING: ['READY_FOR_CUTOVER', 'FAILED'],
  READY_FOR_CUTOVER: ['APPROVED', 'PREPARING', 'FAILED'],
  APPROVED: ['CUTOVER_IN_PROGRESS', 'READY_FOR_CUTOVER', 'FAILED', 'ROLLED_BACK'],
  CUTOVER_IN_PROGRESS: ['GRACE_PERIOD', 'FAILED', 'ROLLED_BACK'],
  GRACE_PERIOD: ['COMPLETED', 'ROLLED_BACK', 'FAILED'],
  COMPLETED: [], // Terminal state - no transitions allowed after completion
  // A setback, not the end (ADR-0047): a second attempt re-enters PREPARING, as
  // a FAILED one always could. Owner's decision 2026-09-20 (workplan 0009 T8).
  // Never a second ROLLED_BACK: there is nothing to roll back from here.
  ROLLED_BACK: ['PREPARING'],
  FAILED: ['PREPARING', 'ROLLED_BACK'], // Can retry or rollback
};

/** State to phase mapping */
const STATE_TO_PHASE: Record<CutoverState, CutoverPhase> = {
  PREPARING: 'PREPARATION',
  READY_FOR_CUTOVER: 'VERIFICATION',
  APPROVED: 'VERIFICATION',
  CUTOVER_IN_PROGRESS: 'CUTOVER',
  GRACE_PERIOD: 'GRACE',
  COMPLETED: 'COMPLETION',
  ROLLED_BACK: 'ROLLBACK',
  FAILED: 'ERROR',
};

/**
 * Validate if a state transition is allowed
 */
export function isValidTransition(from: CutoverState, to: CutoverState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get the phase for a given state
 */
export function getStatePhase(state: CutoverState): CutoverPhase {
  return STATE_TO_PHASE[state];
}

/**
 * Can the cutover be rolled back from this state?
 *
 * DERIVED from the state machine, not a second list (ADR-0047). It was
 * `CUTOVER_IN_PROGRESS || GRACE_PERIOD`, while `VALID_TRANSITIONS` above also
 * admits ROLLED_BACK from APPROVED and from FAILED — and FAILED is precisely
 * where `execute` lands on a propagation timeout, printing "Consider
 * rollback." So the predicate said no where the machine said yes and the CLI
 * said please, and `rollbackAvailable` on a read (which the store computes
 * from this) told anyone asking that the one thing they were being invited to
 * do was unavailable. One rule; this is a view of it.
 */
export function canRollback(state: CutoverState): boolean {
  return isValidTransition(state, 'ROLLED_BACK');
}

/**
 * Is this the end of the road — a state the machine admits nothing out of?
 *
 * COMPLETED only. It used to name ROLLED_BACK and FAILED too, while the
 * machine admitted FAILED → PREPARING all along and, since 0009 T8, admits
 * ROLLED_BACK → PREPARING: both are setbacks a second attempt recovers from.
 * Derived from the table, so it cannot say "terminal" of a state with a way out.
 */
export function isTerminalState(state: CutoverState): boolean {
  return VALID_TRANSITIONS[state].length === 0;
}

/**
 * How a PREPARATION enters the machine from a given state — a view of
 * `VALID_TRANSITIONS`, like `canRollback`, not a second list.
 *
 * A preparation is the managed `run-cutover` job: final delta sync, the §20
 * gate, land in READY_FOR_CUTOVER. It used to call `initializeCutover` — which
 * returns the existing row untouched — and then write READY_FOR_CUTOVER
 * unconditionally. The machine has no such edge out of READY_FOR_CUTOVER, so
 * the second press of "prepare" on a cutover that was ready threw, the job's
 * catch marked it FAILED (that edge exists), and Trigger.dev's default three
 * attempts found FAILED, where the same unconditional write is invalid too:
 * a ready cutover, prepared twice, was a failed one, and could not be retried.
 *
 * Three answers, read off the machine in this order:
 *
 * - `initialize` — there is no ledger. The one answer that is not a state.
 * - `prepare` — run the preparation. `resetFirst` is set where the state does
 *   not admit READY_FOR_CUTOVER directly but does admit PREPARING: a ready
 *   verdict about to be replaced by a fresh sync and a fresh verification
 *   (READY_FOR_CUTOVER), a failed attempt being retried (FAILED), or a
 *   rolled-back one being attempted again (ROLLED_BACK, 0009 T8). The
 *   caller records that edge before it starts, so the trail shows the second
 *   attempt as one. From APPROVED the END of the run revokes the approval,
 *   as the recorded APPROVED → READY_FOR_CUTOVER the machine admits; from
 *   PREPARING there is nothing to record first.
 * - `refuse` — nothing to prepare, and nothing to write. Either a cutover is
 *   under way (`under_way`: the machine admits a rollback from it and no
 *   preparation), or the ledger is closed (`closed`: COMPLETED, the one state
 *   the machine admits nothing out of). A refusal is not a failed cutover;
 *   callers must not record it as one.
 */
export type PrepareTransition =
  | { readonly initialize: true }
  | { readonly prepare: true; readonly from: CutoverState; readonly resetFirst: boolean }
  | {
      readonly refuse: string;
      readonly hint: string;
      readonly from: CutoverState;
      readonly code: 'under_way' | 'closed';
    };

export function prepareTransition(state: CutoverState | undefined): PrepareTransition {
  if (state === undefined) return { initialize: true };
  if (isValidTransition(state, 'READY_FOR_CUTOVER')) {
    return { prepare: true, from: state, resetFirst: false };
  }
  if (isValidTransition(state, 'PREPARING')) {
    return { prepare: true, from: state, resetFirst: true };
  }
  if (canRollback(state)) {
    return {
      refuse: `A cutover in ${state} is under way; there is nothing to prepare.`,
      hint:
        'Let it finish ("complete --yes" from GRACE_PERIOD), or take it back with ' +
        '"rollback --yes". Nothing was changed.',
      from: state,
      code: 'under_way',
    };
  }
  return {
    refuse: `The cutover ledger for this mapping is ${state} — closed; there is nothing to prepare.`,
    hint:
      'There is one cutover ledger per mapping, and this one is finished. ' +
      '"status" shows the trail. Nothing was changed.',
    from: state,
    code: 'closed',
  };
}

/**
 * Create initial cutover status
 */
export function createInitialCutoverStatus(
  tenantId: TenantId,
  mappingId: MappingId,
  config: Partial<CutoverConfig> = {}
): CutoverStatus {
  const now = new Date().toISOString();
  return {
    tenantId,
    mappingId,
    state: 'PREPARING',
    currentState: 'PREPARING', // Alias for state
    phase: 'PREPARATION',
    startedAt: now,
    updatedAt: now,
    verificationStatus: 'PENDING',
    totalItemsMigrated: 0,
    itemsVerified: 0,
    discrepanciesFound: 0,
    rollbackAvailable: false,
    ...config,
  };
}

/**
 * Update cutover status with state transition
 */
export function updateCutoverStatus(
  status: CutoverStatus,
  newState: CutoverState,
  reason?: string
): CutoverStatus {
  if (!isValidTransition(status.state, newState)) {
    throw new Error(
      `Invalid state transition from ${status.state} to ${newState}`
    );
  }

  const baseUpdate: Partial<CutoverStatus> = {
    state: newState,
    currentState: newState, // Alias for state, for CLI compatibility
    phase: getStatePhase(newState),
    updatedAt: new Date().toISOString(),
    rollbackAvailable: canRollback(newState),
    ...(newState === 'COMPLETED' ? { completedAt: new Date().toISOString() } : {}),
    ...(reason ? { errorMessage: undefined, errorDetails: undefined } : {}),
  };

  // Handle FAILED state - preserve failure info
  if (newState === 'FAILED') {
    baseUpdate.failedAt = new Date().toISOString();
    baseUpdate.failureReason = reason;
  }

  // Handle ROLLED_BACK state - preserve rollback info
  if (newState === 'ROLLED_BACK') {
    baseUpdate.rolledBackAt = new Date().toISOString();
    baseUpdate.rollbackReason = reason;
  }

  return {
    ...status,
    ...baseUpdate,
  };
}

/**
 * The cutover's timing, as `cutoverStillCopiesAt` in `@openmig/shared` reads
 * it (workplan 0128 T2), from a status the store loaded: its `updatedAt` is
 * when the row last changed state, which in CUTOVER_IN_PROGRESS is execute's
 * start. A status without `gracePeriodHours` gets the column's default, 72.
 */
export function cutoverWindowOf(status: CutoverStatus): CutoverWindow {
  return {
    state: status.currentState ?? status.state,
    copiesThroughGrace: status.copiesThroughGrace === true,
    enteredAt: new Date(status.updatedAt),
    graceStartedAt: status.gracePeriodStartedAt ? new Date(status.gracePeriodStartedAt) : null,
    graceHours: status.gracePeriodHours ?? 72,
  };
}

/**
 * Create a cutover event
 */
export function createCutoverEvent(
  tenantId: TenantId,
  mappingId: MappingId,
  fromState: CutoverState | null,
  toState: CutoverState,
  triggeredBy: string,
  reason?: string,
  metadata?: Record<string, unknown>,
  eventType?: 'CUTOVER_INITIALIZED' | 'STATE_TRANSITION',
  description?: string
): CutoverEvent {
  return {
    tenantId,
    mappingId,
    timestamp: new Date().toISOString(),
    fromState,
    toState,
    triggeredBy,
    reason,
    metadata,
    eventType: eventType ?? 'STATE_TRANSITION',
    description: description ?? (fromState ? `Transitioned from ${fromState} to ${toState}` : `Cutover initialized to ${toState}`),
  };
}
