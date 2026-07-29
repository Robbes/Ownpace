// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Pure formatter for the self-host `/status` payload (workplan 0010 T2). Turns
 * per-mapping migration_status rows into a JSON-serializable report. Errors are
 * surfaced verbatim (SAD §11.2 — never mask). Kept pure so it is unit-testable
 * without a database.
 */

import type { ItemFailure, MigrationStatus, PassMetrics } from '@openmig/shared';

export interface MappingStatusInput {
  readonly mappingId: string;
  readonly statuses: readonly MigrationStatus[];
  /** Unresolved item failures for this mapping, from the ledger. */
  readonly failures?: readonly ItemFailure[];
}

export interface DomainStatusReport {
  readonly domain: MigrationStatus['domain'];
  readonly state: MigrationStatus['state'];
  readonly itemsSynced: number;
  readonly itemsFailed: number;
  readonly bytesTransferred: number;
  readonly lastSyncedAt?: string;
  readonly lastError?: string;
  /**
   * Where the last completed pass spent its time — §19's "throughput" column.
   *
   * `/status` carried counts only, so it could say WHAT had moved but never
   * HOW FAST, which is the question an operator watching a long migration
   * actually has. Absent until a pass completes; never invented as zeros,
   * because zero durations read as "instant" rather than "unknown".
   */
  readonly lastPass?: PassMetrics;
  /**
   * Items still being retried automatically. No action required — they are
   * attempted again on every pass.
   */
  readonly itemsRetrying: number;
  /**
   * Items that have run out of retries and are waiting on an owner decision.
   *
   * Non-zero means a cutover now would leave data behind, so it is on the
   * status payload rather than only on `/failures`: this is the number someone
   * polling a migration has to see without being told to look elsewhere.
   */
  readonly itemsNeedingDecision: number;
}

export interface StatusReport {
  readonly status: 'ok';
  readonly mappings: ReadonlyArray<{
    readonly mappingId: string;
    readonly domains: readonly DomainStatusReport[];
  }>;
}

export function buildStatusReport(inputs: readonly MappingStatusInput[]): StatusReport {
  return {
    status: 'ok',
    mappings: inputs.map(({ mappingId, statuses, failures = [] }) => ({
      mappingId,
      domains: statuses.map((s) => {
        const mine = failures.filter((f) => f.domain === s.domain);
        return {
          domain: s.domain,
          state: s.state,
          itemsSynced: s.itemsSynced,
          itemsFailed: s.itemsFailed,
          bytesTransferred: s.bytesTransferred,
          itemsRetrying: mine.filter((f) => !f.needsDecision).length,
          itemsNeedingDecision: mine.filter((f) => f.needsDecision).length,
          ...(s.completedAt ? { lastSyncedAt: s.completedAt } : {}),
          ...(s.lastError ? { lastError: s.lastError } : {}),
          ...(s.lastPassMetrics ? { lastPass: s.lastPassMetrics } : {}),
        };
      }),
    })),
  };
}
