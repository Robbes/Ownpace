// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The §20 verification report, as a wire shape (ADR-0026).
 *
 * These types describe the ANSWER the verification gate produces, not the
 * engine that produces it — the engine, its sampling config and its
 * dependencies stay in `@openmig/core`. They live here because the report is
 * something a UI renders and both editions serve, and a browser bundle should
 * not have to reach into the reconcile package to know the shape of a JSON
 * document it was handed.
 *
 * `@openmig/core` re-exports them, so every existing
 * `import type { VerificationResult } from '@openmig/core'` keeps working and
 * there is still exactly one declaration.
 */

import type { TenantId, MappingId } from './ids';

/**
 * Verification status for a single data type.
 *
 * `SKIPPED` and `NOT_VERIFIABLE` are deliberately distinct from PASS. A domain
 * nobody looked at has not passed:
 *  - SKIPPED — the operator turned this domain off in the config. Their call, so
 *    it does not block cutover, but it is reported rather than dressed as a pass.
 *  - NOT_VERIFIABLE — the domain IS enabled but there is no way to read the
 *    target for it (no reindexer). This blocks cutover. It used to produce
 *    nonsense instead: `getTargetCount` fell back to the LEDGER count (perfect
 *    fabricated parity) while `findMissingOnTarget` reported every item missing.
 */
export type DataTypeVerificationStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED' | 'NOT_VERIFIABLE';

/** Verification status for a single data type */
export interface DataTypeVerification {
  dataType: 'mail' | 'calendar' | 'contacts' | 'files';
  status: DataTypeVerificationStatus;

  // Statistics
  sourceCount: number;
  targetCount: number;
  matchedCount: number;
  missingOnTarget: number;
  extraOnTarget: number;
  
  // Content verification
  /**
   * How many items were actually EXAMINED, not how many were asked for.
   *
   * `checksumMatches + checksumMismatches + checksumUnavailable` always equals
   * this. It used to carry the requested figure instead, which is a ceiling
   * rather than a count: `minSampleSize` is a floor on the percentage and not a
   * promise that many items exist, so a domain holding 8 items with a floor of
   * 10 reported `checksumSampleSize: 10` over 8 examined rows. A coverage
   * number that can exceed what was examined can only ever overstate.
   */
  checksumSampleSize: number;
  checksumMatches: number;
  checksumMismatches: number;
  /**
   * Sampled items whose content could NOT be compared, because the target did
   * not expose a content hash for them. Not a mismatch and not a match — the
   * checksum leg simply had no evidence for these. Non-zero here means the
   * "checksum sampling" half of the §20 gate did not really run.
   */
  checksumUnavailable: number;
  
  // Bytes.
  //
  // `totalBytesSource` is the sum of the per-item sizes the ledger recorded when
  // each item was copied — i.e. what we read from the source.
  //
  // `totalBytesTarget` is `null` when the target could not be measured, which is
  // currently the case for every target: `TargetEntry` (the shape `listEntries`
  // yields) carries no size, so there is nothing to sum. It used to be filled
  // with the SOURCE figure, which made every report show perfect byte parity —
  // a number that looked verified and never was. `null` says "not measured";
  // only set it from a real target-side measurement.
  totalBytesSource: number;
  totalBytesTarget: number | null;
  
  // Issues
  issues: Array<{
    id: string;
    severity: 'ERROR' | 'WARNING';
    message: string;
    sourceRef?: string;
    targetRef?: string;
  }>;
}

/** Overall verification result */
export interface VerificationResult {
  tenantId: TenantId;
  mappingId: MappingId;
  timestamp: string;
  overallStatus: 'PASS' | 'WARN' | 'FAIL';
  score: number; // 0.0 to 1.0
  
  // Per-data-type results
  mail: DataTypeVerification;
  calendar: DataTypeVerification;
  contacts: DataTypeVerification;
  files: DataTypeVerification;
  
  // Summary
  totalItemsSource: number;
  totalItemsTarget: number;
  totalDiscrepancies: number;
  /**
   * Bytes we copied, summed from the ledger's per-item source sizes. This is a
   * statement about what was read and sent — NOT a target-side measurement, and
   * not evidence of byte-level parity. Per-domain target bytes live in
   * `DataTypeVerification.totalBytesTarget` and are `null` while unmeasured.
   */
  totalBytesTransferred: number;
  
  // Recommendations
  canProceedToCutover: boolean;
  recommendations: string[];
}
