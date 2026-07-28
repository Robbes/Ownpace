/**
 * Verification Engine
 * 
 * Verifies migration completeness and accuracy across all data types:
 * - Mail (JMAP/IMAP)
 * - Calendar (CalDAV)
 * - Contacts (CardDAV)
 * - Files (WebDAV)
 * 
 * Provides detailed reports for cutover decision-making.
 */

import type { TenantId, MappingId } from '@openmig/shared';
import { versionOf } from '@openmig/shared';

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

/** Verification configuration */
export interface VerificationConfig {
  // Sampling
  checksumSamplePercentage: number; // Default: 5%
  minSampleSize: number; // Default: 10
  maxSampleSize: number; // Default: 1000
  
  // Thresholds
  requiredMatchPercentage: number; // Default: 0.99 (99%)
  maxDiscrepancyPercentage: number; // Default: 0.01 (1%)
  
  // Data type specific
  verifyMail: boolean; // Default: true
  verifyCalendar: boolean; // Default: true
  verifyContacts: boolean; // Default: true
  verifyFiles: boolean; // Default: true
}

/** Verification dependencies */
export interface VerificationDeps {
  tenantId: TenantId;
  mappingId: MappingId;
  config: VerificationConfig;
  
  // Data access
  getSourceCount(dataType: 'mail' | 'calendar' | 'contacts' | 'files'): Promise<number>;
  getTargetCount(dataType: 'mail' | 'calendar' | 'contacts' | 'files'): Promise<number>;
  
  // Sample retrieval for checksum verification
  getSourceSamples(
    dataType: 'mail' | 'calendar' | 'contacts' | 'files',
    count: number
  ): Promise<Array<{ id: string; naturalKeyHash: string; content: Uint8Array | string }>>;
  
  /**
   * Target-side samples to compare against the source samples.
   *
   * `naturalKeyHashes` names the EXACT items wanted — the ones the source side
   * sampled. Honour it when supplied.
   *
   * Taking "the first `count` target items" instead is not equivalent, because
   * the two populations differ: the target legitimately holds items the ledger
   * never recorded (pre-existing data on the destination account). Any of those
   * that sorted into the target's first `count` displaced a real sample, and the
   * displaced item then looked absent — which the caller scored as a content
   * mismatch and used to FAIL the cutover gate on a healthy migration. Observed:
   * calendar and contacts each had 3 pre-existing items and each reported
   * exactly 1 spurious mismatch, while mail and files, with no extras, reported
   * none.
   */
  getTargetSamples(
    dataType: 'mail' | 'calendar' | 'contacts' | 'files',
    count: number,
    naturalKeyHashes?: ReadonlyArray<string>
  ): Promise<Array<{ id: string; naturalKeyHash: string; content: Uint8Array | string }>>;
  
  // Discrepancy detection
  findMissingOnTarget(
    dataType: 'mail' | 'calendar' | 'contacts' | 'files'
  ): Promise<Array<{ id: string; sourceRef: string }>>;
  
  findExtraOnTarget(
    dataType: 'mail' | 'calendar' | 'contacts' | 'files'
  ): Promise<Array<{ id: string; targetRef: string }>>;
  
  // Bytes tracking
  getTotalBytesSource(dataType: 'mail' | 'calendar' | 'contacts' | 'files'): Promise<number>;
  /**
   * Optional: total bytes as measured ON THE TARGET. Supply this only if the
   * target can genuinely report sizes. Omit it — or return null — rather than
   * substituting the source figure; a fabricated match is worse than an
   * admitted gap.
   *
   * Returning null is how an implementation says "I could not measure every
   * item". A partial sum would read as a shortfall against the source total,
   * i.e. as data loss.
   */
  getTotalBytesTarget?(dataType: 'mail' | 'calendar' | 'contacts' | 'files'): Promise<number | null>;

  /**
   * Can this domain's target actually be read? Return false when there is no
   * reindexer for it, so the domain is reported NOT_VERIFIABLE instead of being
   * measured against a target nobody can see. Omit to assume every enabled
   * domain is readable.
   */
  canVerifyTarget?(dataType: 'mail' | 'calendar' | 'contacts' | 'files'): boolean;
}

/** Which domains the config asks to verify. */
function isDataTypeEnabled(
  config: VerificationConfig,
  dataType: 'mail' | 'calendar' | 'contacts' | 'files',
): boolean {
  switch (dataType) {
    case 'mail':
      return config.verifyMail;
    case 'calendar':
      return config.verifyCalendar;
    case 'contacts':
      return config.verifyContacts;
    case 'files':
      return config.verifyFiles;
  }
}

/** A result for a domain that was not measured, with the reason attached. */
function notMeasured(
  dataType: 'mail' | 'calendar' | 'contacts' | 'files',
  status: 'SKIPPED' | 'NOT_VERIFIABLE',
  message: string,
  /** What the ledger says was copied, when that is known. */
  sourceCount = 0,
): DataTypeVerification {
  return {
    dataType,
    status,
    sourceCount,
    targetCount: 0,
    matchedCount: 0,
    missingOnTarget: 0,
    extraOnTarget: 0,
    checksumSampleSize: 0,
    checksumMatches: 0,
    checksumMismatches: 0,
    checksumUnavailable: 0,
    totalBytesSource: 0,
    totalBytesTarget: null,
    issues: [
      {
        id: `${status}_${dataType}`,
        severity: status === 'NOT_VERIFIABLE' ? 'ERROR' : 'WARNING',
        message,
      },
    ],
  };
}

/**
 * Run verification for all data types
 */
export async function runVerification(
  deps: VerificationDeps
): Promise<VerificationResult> {
  const { tenantId, mappingId, config } = deps;

  /**
   * Verify one domain, or say honestly why it was not verified.
   *
   * The `config.verifyMail` / `verifyCalendar` / `verifyContacts` / `verifyFiles`
   * flags used to be accepted and then ignored — every domain was measured
   * regardless, and the config parameter was destructured as `_config` to keep
   * the linter quiet about it. Combined with a single target reindexer being
   * applied to all four domains, that meant a mail-only cutover measured the
   * ledger's calendar rows against the MAIL target's listing and reported every
   * one of them missing.
   */
  const verifyDomain = async (
    dataType: 'mail' | 'calendar' | 'contacts' | 'files',
  ): Promise<DataTypeVerification> => {
    if (!isDataTypeEnabled(config, dataType)) {
      return notMeasured(
        dataType,
        'SKIPPED',
        `${dataType} verification was disabled in the config — this domain was NOT checked.`,
      );
    }
    if (deps.canVerifyTarget && !deps.canVerifyTarget(dataType)) {
      // No way to read the target for this domain. That only matters if the
      // ledger says we actually copied something into it — a mail-only
      // migration has no calendar rows, so there is nothing to check and
      // nothing to block on.
      const recorded = await deps.getSourceCount(dataType);
      if (recorded === 0) {
        return notMeasured(
          dataType,
          'SKIPPED',
          `No ${dataType} items were recorded for this mapping, so there is nothing to verify.`,
        );
      }
      return notMeasured(
        dataType,
        'NOT_VERIFIABLE',
        `${recorded} ${dataType} item(s) were copied, but the target cannot be read for this ` +
          `domain (no reindexer). Cutover is blocked: their completeness is unknown.`,
        recorded,
      );
    }
    return verifyDataType({ ...deps, dataType });
  };

  const mail = await verifyDomain('mail');
  const calendar = await verifyDomain('calendar');
  const contacts = await verifyDomain('contacts');
  const files = await verifyDomain('files');

  // Calculate overall status
  const allVerifications = [mail, calendar, contacts, files];
  const overallStatus = calculateOverallStatus(allVerifications);
  const score = calculateVerificationScore(allVerifications);
  
  // Generate recommendations
  const recommendations = generateRecommendations(allVerifications, overallStatus);
  
  // Calculate totals
  const totalItemsSource = allVerifications.reduce((sum, v) => sum + v.sourceCount, 0);
  const totalItemsTarget = allVerifications.reduce((sum, v) => sum + v.targetCount, 0);
  const totalDiscrepancies = allVerifications.reduce(
    (sum, v) => sum + v.missingOnTarget + v.extraOnTarget,
    0
  );
  // Sum the SOURCE bytes: this is what we actually read and copied. Summing
  // totalBytesTarget would have meant summing nulls (or, before this was made
  // honest, re-reporting the source figure under a target-sounding name).
  const totalBytesTransferred = allVerifications.reduce(
    (sum, v) => sum + v.totalBytesSource,
    0
  );
  
  return {
    tenantId,
    mappingId,
    timestamp: new Date().toISOString(),
    overallStatus,
    score,
    mail,
    calendar,
    contacts,
    files,
    totalItemsSource,
    totalItemsTarget,
    totalDiscrepancies,
    totalBytesTransferred,
    canProceedToCutover: overallStatus === 'PASS' || (overallStatus === 'WARN' && score >= 0.95),
    recommendations,
  };
}

/**
 * Verify a single data type
 */
async function verifyDataType(
  deps: VerificationDeps & { dataType: 'mail' | 'calendar' | 'contacts' | 'files' }
): Promise<DataTypeVerification> {
  const { dataType, config } = deps;
  
  // Get counts
  const sourceCount = await deps.getSourceCount(dataType);
  const targetCount = await deps.getTargetCount(dataType);
  
  // Find discrepancies
  const missingOnTarget = await deps.findMissingOnTarget(dataType);
  const extraOnTarget = await deps.findExtraOnTarget(dataType);
  
  // Calculate matched count: items that exist on both source and target
  // matchedCount = source items - items missing on target
  const matchedCount = sourceCount - missingOnTarget.length;
  
  // Sample-based checksum verification
  const sampleSize = calculateSampleSize(sourceCount, config);
  const sourceSamples = await deps.getSourceSamples(dataType, sampleSize);
  // Ask the target for THESE items, not for its own first `sampleSize`. See
  // getTargetSamples: the populations differ whenever the target holds anything
  // the ledger did not record, and taking each side's first N independently
  // pairs them up wrongly.
  const targetSamples = await deps.getTargetSamples(
    dataType,
    sampleSize,
    sourceSamples.map((s) => s.naturalKeyHash),
  );
  
  // Create a map of target samples by naturalKeyHash for efficient lookup
  const targetSamplesByHash = new Map<string, { id: string; content: Uint8Array | string }>();
  for (const sample of targetSamples) {
    targetSamplesByHash.set(sample.naturalKeyHash, { id: sample.id, content: sample.content });
  }
  
  let checksumMatches = 0;
  let checksumMismatches = 0;
  // Samples whose content could not be compared at all because the target does
  // not expose a content hash. NOT a mismatch — see below.
  let checksumUnavailable = 0;

  // Compare samples by matching naturalKeyHash
  for (const sourceSample of sourceSamples) {
    const targetSample = targetSamplesByHash.get(sourceSample.naturalKeyHash);

    if (targetSample) {
      // `TargetEntry.contentHash` is optional ("if cheaply available from the
      // listing") and BOTH real mail reindexers omit it — JMAP can't get it from
      // a headers-only fetch, and the IMAP one doesn't compute it. Treating an
      // absent hash as a mismatch made checksum sampling report 100% failure on
      // a perfectly healthy migration, which would FAIL the cutover gate. An
      // unmeasurable sample is skipped and surfaced, never silently passed and
      // never counted against the target (workplan 0009 T1: report SKIPPED
      // rather than inventing a verdict).
      if (isComparableContent(targetSample.content)) {
        if (!sameHashAlgorithm(sourceSample.content, targetSample.content)) {
          // The two sides were produced by different algorithm versions — a row
          // recorded before a fingerprint change, compared against a freshly
          // computed one. That comparison says nothing about the data, so it
          // must not be scored as corruption. Upgrading mid-migration would
          // otherwise turn every pre-upgrade item into a reported mismatch.
          checksumUnavailable++;
        } else if (compareContent(sourceSample.content, targetSample.content)) {
          checksumMatches++;
        } else {
          checksumMismatches++;
        }
      } else {
        checksumUnavailable++;
      }
    } else {
      // No target counterpart, so there is nothing to compare — unavailable,
      // not a mismatch.
      //
      // A mismatch is a claim about CONTENT: we read both sides and they
      // differed. Absence is a different finding, and it is already measured
      // properly by `findMissingOnTarget` over the full sets, which FAILs the
      // gate on its own. Scoring it here as well both double-counted it and
      // mislabelled it, and — because the two sample slices used to be drawn
      // from different populations — it fired on items that were not missing at
      // all. That produced an ERROR-severity "content mismatch" and a blocked
      // cutover on a migration with `missingOnTarget: 0`.
      checksumUnavailable++;
    }
  }
  
  // Get bytes
  const totalBytesSource = await deps.getTotalBytesSource(dataType);
  // null when the target cannot report sizes — see DataTypeVerification.
  const totalBytesTarget = deps.getTotalBytesTarget
    ? await deps.getTotalBytesTarget(dataType)
    : null;
  
  // Determine status
  const matchPercentage = sourceCount > 0 ? (matchedCount / sourceCount) : 1;
  // Unavailable samples are excluded from the denominator: a target that cannot
  // report content hashes yields no checksum evidence either way, so the ratio
  // is computed over what was actually comparable. With nothing comparable this
  // is 1 (no contrary evidence) — the counts/missing checks still gate, and
  // `checksumUnavailable` records that this leg was not exercised.
  const checksumComparable = checksumMatches + checksumMismatches;
  const checksumMatchPercentage = checksumComparable > 0 ? checksumMatches / checksumComparable : 1;
  
  const status = determineVerificationStatus(
    matchPercentage,
    checksumMatchPercentage,
    missingOnTarget.length,
    extraOnTarget.length,
    config,
    sourceCount
  );
  
  // Generate issues
  const issues: DataTypeVerification['issues'] = [];
  
  if (checksumUnavailable > 0) {
    // Surface, never silently pass (hard rule 9): the operator must know the
    // checksum half of the gate did not actually run for these items.
    issues.push({
      id: `CHECKSUM_UNAVAILABLE_${dataType}`,
      severity: 'WARNING',
      message:
        `${checksumUnavailable} of ${sourceSamples.length} sampled ${dataType} item(s) could not be ` +
        `content-verified: the target does not expose a content hash. Count parity still applies.`,
    });
  }

  if (missingOnTarget.length > 0) {
    issues.push({
      id: `MISSING_${dataType}`,
      severity: missingOnTarget.length > sourceCount * config.maxDiscrepancyPercentage ? 'ERROR' : 'WARNING',
      message: `${missingOnTarget.length} ${dataType} item(s) missing on target`,
    });
  }
  
  if (extraOnTarget.length > 0) {
    issues.push({
      id: `EXTRA_${dataType}`,
      severity: 'WARNING',
      message: `${extraOnTarget.length} ${dataType} item(s) exist on target but not source`,
    });
  }
  
  if (checksumMismatches > 0) {
    issues.push({
      id: `CHECKSUM_${dataType}`,
      severity: 'ERROR',
      message: `${checksumMismatches} ${dataType} item(s) have content mismatches`,
    });
  }
  
  return {
    dataType,
    status,
    sourceCount,
    targetCount,
    matchedCount,
    missingOnTarget: missingOnTarget.length,
    extraOnTarget: extraOnTarget.length,
    checksumSampleSize: sampleSize,
    checksumMatches,
    checksumMismatches,
    checksumUnavailable,
    totalBytesSource,
    totalBytesTarget,
    issues,
  };
}

/**
 * Calculate sample size for checksum verification
 */
function calculateSampleSize(totalCount: number, config: VerificationConfig): number {
  if (totalCount === 0) return 0;
  
  const calculated = Math.floor(totalCount * (config.checksumSamplePercentage / 100));
  return Math.max(
    config.minSampleSize,
    Math.min(calculated, config.maxSampleSize)
  );
}

/**
 * Compare two content pieces
 */
/**
 * Can this target-side sample content participate in a checksum comparison?
 *
 * `TargetEntry.contentHash` is optional, and the reindexers that omit it yield
 * an empty string here. Comparing a real source hash against '' is not a
 * mismatch — it is an absence of evidence, and must not be scored as failure.
 */
function isComparableContent(content: Uint8Array | string): boolean {
  return typeof content === 'string' ? content.length > 0 : content.byteLength > 0;
}

/**
 * Were these two hashes produced by the same algorithm?
 *
 * Canonical DAV fingerprints carry a version tag (`cal1:`, `card1:`); mail and
 * file hashes are bare sha256 hex and have none. Comparing across versions —
 * a ledger row written by an older build against a value computed now — is
 * meaningless, and reporting it as a mismatch would manufacture corruption out
 * of an upgrade. Bare-vs-bare and tagged-vs-same-tag are comparable; anything
 * else is not.
 */
function sameHashAlgorithm(a: Uint8Array | string, b: Uint8Array | string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return true;
  return versionOf(a) === versionOf(b);
}

function compareContent(
  a: Uint8Array | string,
  b: Uint8Array | string
): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b;
  }
  
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  
  return false;
}

/**
 * Determine verification status based on metrics
 */
function determineVerificationStatus(
  matchPercentage: number,
  checksumMatchPercentage: number,
  missingCount: number,
  extraCount: number,
  config: VerificationConfig,
  sourceCount: number
): 'PASS' | 'WARN' | 'FAIL' {
  const totalDiscrepancies = missingCount + extraCount;
  // Only MISSING items count toward the failure threshold.
  //
  // This used to be `missingCount + extraCount`, which contradicted the
  // severities this same function's caller assigns: `MISSING_*` escalates to
  // ERROR past the threshold, `EXTRA_*` is unconditionally WARNING — and yet a
  // WARNING-severity finding was driving a FAIL status.
  //
  // The semantics differ, and only one of them is about the migration. A
  // missing item is data that did not arrive: that is what the gate exists to
  // catch. An extra item is data the DESTINATION already had, and it cannot
  // indicate that anything failed to copy. Counting it as failure made §20
  // unusable against any account that is not empty — including a stock
  // Nextcloud user, which ships a default calendar and address book with sample
  // content, and any customer migrating into a mailbox they already use.
  //
  // Extras still force WARN below, so they are never silently passed.
  const discrepancyPercentage = sourceCount > 0 ? missingCount / sourceCount : 0;

  // FAIL if any critical thresholds are not met
  if (
    matchPercentage < config.requiredMatchPercentage ||
    checksumMatchPercentage < config.requiredMatchPercentage ||
    discrepancyPercentage > config.maxDiscrepancyPercentage
  ) {
    return 'FAIL';
  }

  // WARN if there are any discrepancies (even within tolerance)
  if (totalDiscrepancies > 0) {
    return 'WARN';
  }
  
  // PASS only when no discrepancies and all thresholds met
  return 'PASS';
}

/**
 * Calculate overall verification status
 */
function calculateOverallStatus(
  verifications: DataTypeVerification[]
): 'PASS' | 'WARN' | 'FAIL' {
  // NOT_VERIFIABLE is a failure: the domain was asked for and could not be
  // checked, so the migration's completeness is unknown.
  //
  // SKIPPED is neutral. The operator turned that domain off deliberately — a
  // mail-only migration should not report WARN forever because it did not check
  // calendars. It is still never silent: the domain carries status SKIPPED, an
  // issue, and a line in `recommendations`.
  const hasFail = verifications.some(v => v.status === 'FAIL' || v.status === 'NOT_VERIFIABLE');
  const hasWarn = verifications.some(v => v.status === 'WARN');

  if (hasFail) return 'FAIL';
  if (hasWarn) return 'WARN';
  return 'PASS';
}

/**
 * Calculate overall verification score
 */
function calculateVerificationScore(verifications: DataTypeVerification[]): number {
  // Only domains that were actually measured contribute. A SKIPPED or
  // NOT_VERIFIABLE domain has all-zero counts, which would otherwise score a
  // perfect 1.0 and pull the average UP — three unread domains would drown out
  // one genuinely bad one.
  const measured = verifications.filter(
    (v) => v.status !== 'SKIPPED' && v.status !== 'NOT_VERIFIABLE',
  );
  if (measured.length === 0) return 1;

  const totalScore = measured.reduce((sum, v) => {
    const matchRatio = v.sourceCount > 0 ? v.matchedCount / v.sourceCount : 1;
    const checksumRatio = 
      (v.checksumMatches + v.checksumMismatches) > 0
        ? v.checksumMatches / (v.checksumMatches + v.checksumMismatches)
        : 1;
    return sum + (matchRatio * 0.7 + checksumRatio * 0.3);
  }, 0);
  
  return totalScore / measured.length;
}

/**
 * Generate recommendations based on verification results
 */
function generateRecommendations(
  verifications: DataTypeVerification[],
  overallStatus: 'PASS' | 'WARN' | 'FAIL'
): string[] {
  const recommendations: string[] = [];
  
  if (overallStatus === 'FAIL') {
    recommendations.push('Fix all errors before proceeding to cutover');
    recommendations.push('Review verification report for specific issues');
  }
  
  if (overallStatus === 'WARN') {
    recommendations.push('Review warnings and decide if cutover should proceed');
    recommendations.push('Consider additional verification for flagged items');
  }
  
  verifications.forEach(v => {
    if (v.status === 'NOT_VERIFIABLE') {
      recommendations.push(
        `Cannot verify ${v.dataType}: no way to read the target for this domain. ` +
          `Either supply a reindexer for it or turn ${v.dataType} verification off explicitly.`,
      );
    }

    if (v.status === 'SKIPPED') {
      recommendations.push(`${v.dataType} was not verified: ${v.issues[0]?.message ?? 'skipped'}`);
    }

    if (v.checksumUnavailable > 0) {
      recommendations.push(
        `${v.checksumUnavailable} sampled ${v.dataType} item(s) could not be content-verified ` +
          `(the target exposes no content hash); only count parity was checked for them.`,
      );
    }

    if (v.missingOnTarget > 0) {
      recommendations.push(
        `Re-sync ${v.missingOnTarget} missing ${v.dataType} item(s)`
      );
    }
    
    if (v.checksumMismatches > 0) {
      recommendations.push(
        `Investigate ${v.checksumMismatches} content mismatches in ${v.dataType}`
      );
    }
  });
  
  if (recommendations.length === 0) {
    recommendations.push('All verifications passed. Ready for cutover.');
  }
  
  return recommendations;
}
