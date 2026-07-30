// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Pure formatter for the self-host `/status` payload (workplan 0010 T2). Turns
 * per-mapping migration_status rows into a JSON-serializable report. Errors are
 * surfaced verbatim (SAD §11.2 — never mask). Kept pure so it is unit-testable
 * without a database.
 *
 * The report SHAPES moved to `@openmig/shared` under ADR-0026 so the UI and the
 * managed edition compile against the same contract; this file keeps the
 * builder, which is self-host's own. Re-exported below so existing importers
 * (and the managed edition, when it implements `/status`) need not care where
 * the types live.
 */

import type { ItemFailure, MigrationStatus } from '@openmig/shared';
import type { DomainStatusReport, StatusReport } from '@openmig/shared';

export type { DomainStatusReport, StatusReport };

export interface MappingStatusInput {
  readonly mappingId: string;
  readonly statuses: readonly MigrationStatus[];
  /** Unresolved item failures for this mapping, from the ledger. */
  readonly failures?: readonly ItemFailure[];
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
