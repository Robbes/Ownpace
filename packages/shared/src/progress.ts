// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHERE EACH DATA TYPE OF A PERSON'S MIGRATIONS IS, IN ONE READ (workplan 0154
 * T1 (b) to (d)).
 *
 * A person's card on Migrations and their own page show one line per data
 * type: its stage in words, and one sentence under it, *"18,234 of ~19,000 ·
 * last pass 2 minutes ago"*. The cards read the list of migrations, which
 * carries a lifecycle word and a last sync and nothing per data type, so
 * every line on a card said the migration's stage, and none could say *Ready
 * to switch*: the list does not carry the check.
 *
 * This is what a line reads, and nothing more:
 *
 * - each data type's pass state, phase and stop, the facts `stageOf` reads;
 * - its counts and what discovery found (0154 T2), for the sentence;
 * - the migration's check, as a person reads it: not run, running, could not
 *   run, passed or not passed, and when.
 *
 * Managed serves it from `GET /api/migrations/progress`. The appliance has no
 * list (ADR-0034), and its `/status` already carries every one of these
 * facts but the check: `progressFromStatus` reads them there, and its last
 * report is the check. One shape, so the two editions' lines cannot say
 * different things about the same migration.
 */

import type { DiscoveryDomain } from './discovery.ts';
import type { DomainStatusReport, StatusReport, VerificationRunReport } from './operating-contract.ts';
import type { DomainState } from './ports.ts';

/** One data type's progress, as its line reads it. */
export interface DomainProgress {
  readonly domain: DiscoveryDomain;
  /** Its pass state (`DomainStatusReport.state`). */
  readonly state: DomainState;
  /** Its phase: `PathPhase.phase`, or the migration's status where it has none of its own. */
  readonly phase: string;
  /** Its owner stopped it (0128 T4). Absent while it runs. */
  readonly stopped?: true;
  readonly itemsSynced: number;
  /** What discovery found (0154 T2); absent when it could not count. */
  readonly itemsFound?: number;
  /** Left as they were (0124 T2); absent when nobody counted. */
  readonly itemsAdopted?: number;
  readonly bytesTransferred: number;
  readonly bytesFound?: number;
  /** When a pass over it last completed. */
  readonly lastSyncedAt?: string;
  /** When a pass last touched it. */
  readonly lastActiveAt?: string;
}

/**
 * A migration's check, in the five things a person can be told. `not_passed`
 * is a check that ran and did not open the way to switching; `could_not_run`
 * is a check that never finished, which is not the same claim (hard rule 9).
 */
export type CheckFacts =
  | { readonly state: 'not_run' }
  | { readonly state: 'running'; readonly since: string }
  | { readonly state: 'could_not_run'; readonly at: string }
  | { readonly state: 'passed'; readonly at: string }
  | { readonly state: 'not_passed'; readonly at: string };

/** One migration's progress. */
export interface MigrationProgressReport {
  readonly mappingId: string;
  readonly domains: readonly DomainProgress[];
  readonly check: CheckFacts;
}

/** What `GET /api/migrations/progress` answers. */
export interface ProgressReport {
  readonly mappings: readonly MigrationProgressReport[];
}

/** A data type's phase and stop, from its own path where it has one. */
export interface PhaseFacts {
  readonly phase: string;
  readonly stopped?: boolean;
}

/** One data type's line facts, from its status row and its phase. */
export function domainProgressOf(row: DomainStatusReport, path: PhaseFacts): DomainProgress {
  return {
    domain: row.domain,
    state: row.state,
    phase: path.phase,
    ...(path.stopped === true || row.stoppedByOwner === true ? { stopped: true as const } : {}),
    itemsSynced: row.itemsSynced,
    ...(row.itemsFound !== undefined ? { itemsFound: row.itemsFound } : {}),
    ...(row.itemsAdopted !== undefined ? { itemsAdopted: row.itemsAdopted } : {}),
    bytesTransferred: row.bytesTransferred,
    ...(row.bytesFound !== undefined ? { bytesFound: row.bytesFound } : {}),
    ...(row.lastSyncedAt !== undefined ? { lastSyncedAt: row.lastSyncedAt } : {}),
    ...(row.lastActiveAt !== undefined ? { lastActiveAt: row.lastActiveAt } : {}),
  };
}

/**
 * The check a person is told about, from a verification run's report.
 *
 * Passed means what the Finish page means by it: the report for this migration
 * says it can proceed to its cutover (`canProceedToCutover`). A finished run
 * with no result for this migration has not checked it, so it is `not_run`
 * rather than a pass or a failure nobody saw.
 */
export function checkFactsOf(run: VerificationRunReport, mappingId: string): CheckFacts {
  switch (run.state) {
    case 'never-run':
      return { state: 'not_run' };
    case 'running':
      return { state: 'running', since: run.startedAt };
    case 'failed':
      return { state: 'could_not_run', at: run.startedAt };
    case 'done': {
      const result = run.report[mappingId];
      if (result === undefined) return { state: 'not_run' };
      return result.canProceedToCutover
        ? { state: 'passed', at: run.finishedAt }
        : { state: 'not_passed', at: run.finishedAt };
    }
  }
}

/**
 * The appliance's progress, from what its `/status` serves: each data type's
 * phase from the Finish page's choices, which carry it, its stop from the stop
 * choices, and the migration's lifecycle where a data type has neither. The
 * check is its last report (`GET /verify/report`), or not run when there is
 * none, which a restart honestly forgets.
 */
export function progressFromStatus(
  report: StatusReport,
  verify: VerificationRunReport = { state: 'never-run' },
): MigrationProgressReport[] {
  return report.mappings.map((m) => {
    const endings = new Map((m.endings ?? []).map((e) => [e.domain, e]));
    const stops = new Map((m.stops ?? []).map((s) => [s.domain, s]));
    return {
      mappingId: m.mappingId,
      domains: m.domains.map((row) =>
        domainProgressOf(row, {
          phase: endings.get(row.domain)?.phase ?? m.migrationStatus,
          stopped: stops.get(row.domain)?.stopped === true || endings.get(row.domain)?.stopped === true,
        }),
      ),
      check: checkFactsOf(verify, m.mappingId),
    };
  });
}
