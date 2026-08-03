// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Turning queue rows into a digest line (workplan 0030 T3).
 *
 * The appliance does the reading — four ledger calls per mapping, each
 * separately guarded — and this file does the counting. Split that way for
 * one reason: **the digest must count exactly what the screens count.** A
 * summary that says four things are waiting and a queue that shows three
 * sends somebody hunting for an item that does not exist, and the next digest
 * they get goes unread. The filters below are the same expressions
 * `/api/deletions`, `/api/moves` and `/api/failures` apply, and keeping them
 * in a pure function means a test can hold them to that without a database.
 *
 * The other property worth pinning: a queue that could not be READ is a blind
 * spot, never a zero. `renderDigest` sends when blind spots exist even if
 * every count is zero, because "I found nothing" and "I could not look" must
 * not arrive as the same email (hard rule 9).
 */

import type { MappingAttention } from '@openmig/shared';

/** Just enough of a deletion row to count it — structural on purpose. */
export interface DeletionRow {
  readonly confirmed: boolean;
  readonly acknowledgedAt?: string | undefined;
}

/** Just enough of a move row. */
export interface MoveRow {
  readonly acknowledgedAt?: string | undefined;
}

/** Just enough of a failure row. */
export interface FailureRow {
  readonly needsDecision: boolean;
}

/** What one mapping's four reads came back with. */
export interface QueueReads {
  readonly deletions: readonly DeletionRow[];
  readonly moves: readonly MoveRow[];
  readonly failures: readonly FailureRow[];
  /** Tenant-level, counted once per tenant by the caller — zero elsewhere. */
  readonly pendingDecisions: number;
  /** The mapping's own status, or undefined when even that could not be read. */
  readonly status: string | undefined;
  /** Whatever could not be read, in the server's own words. */
  readonly blindSpots: readonly string[];
}

/**
 * Should this mapping appear in the digest at all?
 *
 * A finished migration keeps its history but stops nagging — the same rule
 * `reportingClosed` applies to the queue endpoints. Without it every appliance
 * that ever completed a migration would email its owner about it forever.
 */
export function reportsToDigest(status: string | undefined): boolean {
  return status !== 'done';
}

/** Count one mapping's queues the way the screens count them. */
export function summariseQueues(mappingId: string, reads: QueueReads): MappingAttention {
  return {
    mappingId,
    pendingDecisions: reads.pendingDecisions,
    // Confirmed but unacknowledged: a deletion still being watched has not
    // been established as real yet, so it is not waiting on anybody.
    deletionsWaiting: reads.deletions.filter((d) => d.confirmed && !d.acknowledgedAt).length,
    movesWaiting: reads.moves.filter((mv) => !mv.acknowledgedAt).length,
    // Only the ones that gave up retrying. A failure still inside its retry
    // budget is the machine's problem, not the owner's.
    failuresWaiting: reads.failures.filter((f) => f.needsDecision).length,
    readyForCutover: reads.status === 'cutover',
    ...(reads.blindSpots.length > 0 ? { blindSpots: reads.blindSpots } : {}),
  };
}
