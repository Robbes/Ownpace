// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CUTOVER GATE VERIFIES WHAT THE MIGRATION HAS (workplan 0128 T1).
 *
 * One gate for both doors, the preparation task (`run-cutover`) and the
 * operator's `verify` command, which carried the same thirty lines each.
 *
 * Both built the mail source and target first (`buildDepsFromMapping`) and
 * never used them: the verification reads the ledger and each data type's own
 * target, and the mail deps were only ever closed again. Building them was not
 * free, though. On a migration without mail the builder refuses, so the gate
 * failed before it measured anything, with a sentence about email nobody had
 * selected. They are gone.
 *
 * And both asked for all five data types. A data type the migration does not
 * have then came back SKIPPED only because nothing was recorded for it, which
 * reads as "nothing copied" rather than "not part of this migration". The gate
 * now verifies the data types the migration has, the same selection its passes
 * run (`enabledDomains`). A selected data type whose target cannot be read
 * still blocks as NOT_VERIFIABLE: switching off only what the migration does
 * not carry cannot turn a gate green.
 */

import type { Pool } from 'pg';
import { asMappingId, asTenantId, type DiscoveryDomain } from '@openmig/shared';
import {
  createRealVerificationDeps,
  runVerification,
  type VerificationConfig,
  type VerificationResult,
} from '@openmig/core';
import {
  createLedgerVerificationReader,
  organisationStillOpen,
  readPathPhases,
  tenantScopedDb,
  withTenant,
  type DisposableLedgerVerificationReader,
} from '@openmig/ledger';
import { enabledDomains, stoppedDomains } from '@openmig/orchestration/enabled-domains';
import { GATE_NAME } from '@openmig/orchestration/target-fan-out';
import { buildTargetReindexers } from '@openmig/orchestration/build-reindexers';

/** What the cutover gate asks of a migration's data, whichever door it is run from. */
const CUTOVER_THRESHOLDS = {
  checksumSamplePercentage: 5,
  minSampleSize: 10,
  maxSampleSize: 1000,
  requiredMatchPercentage: 0.99,
  maxDiscrepancyPercentage: 0.01,
} as const;

/**
 * The gate's configuration for a migration with this selection: its data
 * types, and no others. Those its owner stopped are skipped, *stopped by you*
 * (0128 T4, D6): they no longer follow the source. A test migration's marker
 * goes with it (workplan 0162 T3): measured as any other, and never cleared
 * for its cutover.
 */
export function verificationConfigFor(
  selected: ReadonlySet<DiscoveryDomain>,
  stopped: ReadonlySet<DiscoveryDomain> = new Set(),
  testMarker?: string,
): VerificationConfig {
  return {
    ...CUTOVER_THRESHOLDS,
    verifyMail: selected.has('email'),
    verifyCalendar: selected.has('calendar'),
    verifyContacts: selected.has('contact'),
    verifyFiles: selected.has('file'),
    verifyTasks: selected.has('task'),
    stoppedByOwner: [...stopped].map((domain) => GATE_NAME[domain]),
    ...(testMarker !== undefined ? { testMarker } : {}),
  };
}

/**
 * The migration's test marker (workplan 0162), when it is a test; undefined
 * for every other migration, and for one that is gone. Read as every gate
 * reads the migration (`readPathPhases`), in the tenant's scope, on the pool
 * the caller was handed. The cutover's doors refuse a test (T3): the gate
 * holds it, the preparation does not begin, and approve, execute and
 * complete refuse it.
 */
export async function testMarkerOf(pool: Pool, tenantId: string, mappingId: string): Promise<string | undefined> {
  return (await withTenant(pool, tenantId, (db) => readPathPhases(db, tenantId, mappingId)))?.testMarker;
}

/**
 * The data types the gate verifies: every one the migration carries, or, for
 * the cutover of one data type, that one alone (0128 T5, slice 5b), and only
 * if the migration carries it.
 */
export function gateScope(carried: ReadonlySet<DiscoveryDomain>, only?: DiscoveryDomain): Set<DiscoveryDomain> {
  return new Set([...carried].filter((d) => only === undefined || d === only));
}

/**
 * The ledger reader a verification of one migration counts through, this gate's
 * and `run-verification`'s: on the caller's pool, each read in the tenant's
 * scope (0138 T1 parts 2 and 3), so that on `app_user` it counts the
 * migration's items rather than none. `close()` leaves the pool open.
 */
export function ledgerReaderFor(pool: Pool, tenantId: string): DisposableLedgerVerificationReader {
  return createLedgerVerificationReader({ db: tenantScopedDb(pool, tenantId) });
}

/** The §20 gate over one migration: each data type it has, against that data type's own target. */
export async function runCutoverGate(
  pool: Pool,
  tenantId: string,
  mappingId: string,
  // The cutover of one data type verifies that data type alone (0128 T5, slice 5b).
  only?: DiscoveryDomain,
): Promise<VerificationResult> {
  const selected = gateScope(await enabledDomains(pool, tenantId, mappingId), only);
  const stopped = await stoppedDomains(pool, tenantId, mappingId);
  const testMarker = await testMarkerOf(pool, tenantId, mappingId);
  const targets = await buildTargetReindexers(pool, tenantId, mappingId);
  // On the pool this gate was handed (0138 T1). It used to open a pool of its
  // own from a connection string.
  const verificationReader = ledgerReaderFor(pool, tenantId);
  try {
    return await runVerification(
      createRealVerificationDeps({
        tenantId: asTenantId(tenantId),
        mappingId: asMappingId(mappingId),
        config: verificationConfigFor(selected, stopped, testMarker),
        verificationReader,
        // One reindexer per data type, each reading its own target. A data
        // type with none is reported NOT_VERIFIABLE rather than measured
        // against another's listing.
        targetReindexers: targets.reindexers,
        // Gmail's own count, where the source has one (the owner,
        // 2026-11-24): a message it holds and no pass copied fails the gate.
        sourceSideCounts: targets.sourceSideCounts,
        // Asked before each read of a target (0139 T7): a close while the gate
        // runs stops it with the close's refusal, and no verdict is recorded.
        organisationIsOpen: organisationStillOpen(pool, tenantId),
      }),
    );
  } finally {
    await targets.close();
    await verificationReader.close();
  }
}
