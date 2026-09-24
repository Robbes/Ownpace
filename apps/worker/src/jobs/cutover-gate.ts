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
import { createLedgerVerificationReader } from '@openmig/ledger';
import { enabledDomains } from '@openmig/orchestration/enabled-domains';
import { buildTargetReindexers } from '@openmig/orchestration/build-reindexers';

/** What the cutover gate asks of a migration's data, whichever door it is run from. */
const CUTOVER_THRESHOLDS = {
  checksumSamplePercentage: 5,
  minSampleSize: 10,
  maxSampleSize: 1000,
  requiredMatchPercentage: 0.99,
  maxDiscrepancyPercentage: 0.01,
} as const;

/** The gate's configuration for a migration with this selection: its data types, and no others. */
export function verificationConfigFor(selected: ReadonlySet<DiscoveryDomain>): VerificationConfig {
  return {
    ...CUTOVER_THRESHOLDS,
    verifyMail: selected.has('email'),
    verifyCalendar: selected.has('calendar'),
    verifyContacts: selected.has('contact'),
    verifyFiles: selected.has('file'),
    verifyTasks: selected.has('task'),
  };
}

/** The §20 gate over one migration: each data type it has, against that data type's own target. */
export async function runCutoverGate(
  pool: Pool,
  connectionString: string,
  tenantId: string,
  mappingId: string,
): Promise<VerificationResult> {
  const selected = await enabledDomains(pool, tenantId, mappingId);
  const targets = await buildTargetReindexers(pool, tenantId, mappingId);
  // It opens a pool of its own, closed below.
  const verificationReader = createLedgerVerificationReader({ connectionString });
  try {
    return await runVerification(
      createRealVerificationDeps({
        tenantId: asTenantId(tenantId),
        mappingId: asMappingId(mappingId),
        config: verificationConfigFor(selected),
        verificationReader,
        // One reindexer per data type, each reading its own target. A data
        // type with none is reported NOT_VERIFIABLE rather than measured
        // against another's listing.
        targetReindexers: targets.reindexers,
      }),
    );
  } finally {
    await targets.close();
    await verificationReader.close();
  }
}
