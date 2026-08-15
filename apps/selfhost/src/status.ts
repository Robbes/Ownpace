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

import type { ItemFailure, MigrationStatus, MappingLifecycle } from '@openmig/shared';
import type { DomainStatusReport, StatusReport, NotificationChannelReport } from '@openmig/shared';
import { buildDomainStatusReports } from '@openmig/shared';

export type { DomainStatusReport, StatusReport, NotificationChannelReport };

export interface MappingStatusInput {
  readonly mappingId: string;
  /** Where the mapping is in its life — see `StatusReport`. */
  readonly migrationStatus: MappingLifecycle;
  readonly statuses: readonly MigrationStatus[];
  /** Unresolved item failures for this mapping, from the ledger. */
  readonly failures?: readonly ItemFailure[];
}

/**
 * Build the payload, optionally reporting the notification channel's state.
 *
 * The channel is passed IN rather than read from the environment here, for the
 * same reason this file takes ledger rows rather than a database: it stays pure
 * and testable without booting an appliance. The caller already holds the
 * channel it built at startup.
 *
 * Omitting `notifications` is meaningful and not a default — see
 * `NotificationChannelReport`. A caller with no channel says nothing rather
 * than reporting `enabled: false`, which would send an owner hunting for a
 * setting nobody had asked about.
 */
export function buildStatusReport(
  inputs: readonly MappingStatusInput[],
  notifications?: NotificationChannelReport,
): StatusReport {
  return {
    status: 'ok',
    ...(notifications ? { notifications } : {}),
    mappings: inputs.map(({ mappingId, migrationStatus, statuses, failures = [] }) => ({
      mappingId,
      migrationStatus,
      // The row derivation moved to @openmig/shared (0033 T5) so the managed
      // GET /migrations/{id} serves the SAME shape — before that, its raw
      // MigrationStatus rows lacked itemsRetrying/itemsNeedingDecision and a
      // UI reading them saw undefined where this edition served numbers.
      domains: buildDomainStatusReports(statuses, failures),
    })),
  };
}
