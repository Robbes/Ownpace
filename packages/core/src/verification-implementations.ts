// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Real Verification Implementations
 * 
 * Provides real verification dependencies that use the LedgerVerificationReader port
 * to query the ledger for verification data.
 * 
 * See docs/architecture/solution-architecture.md §20 (verification & rollback)
 */

import type {
  TenantId,
  MappingId,
  LedgerVerificationReader,
  TargetReindexer,
  TargetEntry,
} from '@openmig/shared';
import {
  naturalKeyHash,
  calendarNaturalKeyHash,
  contactNaturalKeyHash,
  fileNaturalKeyHash,
} from '@openmig/shared';
import type { VerificationDeps } from './verification';

/**
 * Verification dependencies backed by ledger reader and target
 */
export interface RealVerificationDeps {
  tenantId: TenantId;
  mappingId: MappingId;
  config: import('./verification').VerificationConfig;
  // No `ledger` here. It was a REQUIRED field that this module never read —
  // verification goes through `verificationReader` — and every call site
  // silenced it with `as never`. That cast disabled type checking on the whole
  // argument, which is how `verifyMapping` came to be written and shipped
  // without anyone able to see what it was actually passing.
  /**
   * The MAIL target's reindexer.
   *
   * This used to be applied to every domain. Callers pass the mail target here
   * (it is what `buildDepsFromMapping` returns as `deps.target`), so with all
   * four domains enabled the ledger's calendar/contact/file rows were compared
   * against a listing of MAILBOXES — hashed with the calendar/contact/file
   * prefix, so nothing could ever match and every item came back missing. Any
   * multi-domain migration therefore FAILed the gate no matter how complete it
   * was. Other domains go in `targetReindexers`.
   */
  targetReindexer?: TargetReindexer;
  /** Per-domain reindexers. Takes precedence over `targetReindexer` for mail. */
  targetReindexers?: Partial<Record<'mail' | 'calendar' | 'contacts' | 'files', TargetReindexer>>;
  verificationReader: LedgerVerificationReader;
}

/**
 * Create real verification dependencies from ledger and target
 */
export function createRealVerificationDeps(
  deps: RealVerificationDeps
): VerificationDeps {
  const { tenantId, mappingId, verificationReader } = deps;

  const reindexerFor = (
    dataType: 'mail' | 'calendar' | 'contacts' | 'files',
  ): TargetReindexer | undefined =>
    deps.targetReindexers?.[dataType] ?? (dataType === 'mail' ? deps.targetReindexer : undefined);

  return {
    tenantId,
    mappingId,
    config: deps.config,
    // A domain with no reindexer cannot be measured at all. Saying so lets
    // runVerification report NOT_VERIFIABLE instead of the old behaviour, where
    // getTargetCount quietly returned the LEDGER count (perfect parity, never
    // measured) while findMissingOnTarget declared every item missing.
    canVerifyTarget: (dataType) => reindexerFor(dataType) !== undefined,
    getSourceCount: (dataType) =>
      getSourceCountFromLedger(verificationReader, tenantId, mappingId, dataType),
    getTargetCount: (dataType) =>
      getTargetCountFromReindexer(reindexerFor(dataType), verificationReader, tenantId, mappingId, dataType),
    getSourceSamples: (dataType, count) =>
      getSourceSamplesFromLedger(verificationReader, tenantId, mappingId, dataType, count),
    getTargetSamples: (dataType, count, naturalKeyHashes) =>
      getTargetSamplesFromReindexer(reindexerFor(dataType), verificationReader, tenantId, mappingId, dataType, count, naturalKeyHashes),
    findMissingOnTarget: (dataType) =>
      findMissingOnTarget(verificationReader, tenantId, mappingId, dataType, reindexerFor(dataType)),
    findExtraOnTarget: (dataType) =>
      findExtraOnTarget(verificationReader, tenantId, mappingId, dataType, reindexerFor(dataType)),
    getTotalBytesSource: (dataType) =>
      getTotalBytesFromLedger(verificationReader, tenantId, mappingId, dataType),
    getTotalBytesTarget: (dataType) =>
      getTotalBytesFromReindexer(reindexerFor(dataType), verificationReader, tenantId, mappingId, dataType),
  };
}

/**
 * Get count of items from the ledger (source)
 */
async function getSourceCountFromLedger(
  reader: LedgerVerificationReader,
  tenantId: TenantId,
  mappingId: MappingId,
  dataType: 'mail' | 'calendar' | 'contacts' | 'files'
): Promise<number> {
  const domain = mapDataTypeToDomain(dataType) as 'email' | 'calendar' | 'contact' | 'file';
  return reader.countItems(tenantId, mappingId, domain);
}

/**
 * Get count of items from the target via reindexer
 */
async function getTargetCountFromReindexer(
  targetReindexer: TargetReindexer | undefined,
  reader: LedgerVerificationReader,
  tenantId: TenantId,
  mappingId: MappingId,
  dataType: 'mail' | 'calendar' | 'contacts' | 'files'
): Promise<number> {
  if (!targetReindexer) {
    // Never fall back to the ledger count. That returned the SOURCE figure as
    // the target figure, so a domain nobody could read reported perfect parity.
    // `canVerifyTarget` short-circuits this case into a NOT_VERIFIABLE result
    // before we get here, so reaching it means the deps were built by hand and
    // wrongly.
    throw new Error(`No target reindexer for ${dataType}: the target count cannot be measured.`);
  }

  const domain = mapDataTypeToDomain(dataType) as 'email' | 'calendar' | 'contact' | 'file';
  // Get all natural key hashes from the ledger for this domain
  const ledgerHashes = new Set(await reader.getAllNaturalKeyHashes(tenantId, mappingId, domain));

  // Count only entries that exist in the ledger for this domain
  let count = 0;
  for await (const entry of targetReindexer.listEntries()) {
    if (ledgerHashes.has(hashTargetNaturalKey(dataType, entry.naturalKey))) {
      count++;
    }
  }
  
  return count;
}

/**
 * Get sample items from the ledger for checksum verification
 */
async function getSourceSamplesFromLedger(
  reader: LedgerVerificationReader,
  tenantId: TenantId,
  mappingId: MappingId,
  dataType: 'mail' | 'calendar' | 'contacts' | 'files',
  count: number
): Promise<Array<{ id: string; naturalKeyHash: string; content: Uint8Array | string }>> {
  const domain = mapDataTypeToDomain(dataType) as 'email' | 'calendar' | 'contact' | 'file';
  const samples = await reader.getSamples(tenantId, mappingId, domain, count);
  
  return samples.map((s) => ({
    id: s.id,
    naturalKeyHash: s.naturalKeyHash,
    content: s.contentHash ?? '',
  }));
}

/**
 * Get sample items from the target
 */
async function getTargetSamplesFromReindexer(
  targetReindexer: TargetReindexer | undefined,
  reader: LedgerVerificationReader,
  tenantId: TenantId,
  mappingId: MappingId,
  dataType: 'mail' | 'calendar' | 'contacts' | 'files',
  count: number,
  naturalKeyHashes?: ReadonlyArray<string>
): Promise<Array<{ id: string; naturalKeyHash: string; content: Uint8Array | string }>> {
  if (!targetReindexer) {
    // Returning the ledger's own samples as "target samples" compared the source
    // against itself — a guaranteed 100% checksum match, measured on nothing.
    throw new Error(`No target reindexer for ${dataType}: target samples cannot be read.`);
  }

  // Collect ALL entries from the reindexer
  const allEntries: Array<{
    id: string;
    naturalKeyHash: string;
    content: Uint8Array | string;
    entry: TargetEntry;
  }> = [];

  for await (const entry of targetReindexer.listEntries()) {
    allEntries.push({
      id: entry.targetId,
      naturalKeyHash: hashTargetNaturalKey(dataType, entry.naturalKey),
      content: entry.contentHash ?? '',
      entry,
    });
  }

  // Sort by naturalKeyHash for deterministic sampling (to match ledger ordering)
  allEntries.sort((a, b) => a.naturalKeyHash.localeCompare(b.naturalKeyHash));

  // Prefer the items the CALLER asked for. Slicing the target's own first
  // `count` only lines up with the source slice when the two sets are equal,
  // and they are not: the target also holds whatever was already on the
  // destination account. Every such extra that sorted into the first `count`
  // pushed a real sample out, and the pushed-out item then read as absent —
  // scored as a content mismatch, ERROR severity, cutover blocked, on a
  // migration whose `missingOnTarget` was 0.
  const wanted = naturalKeyHashes && naturalKeyHashes.length > 0 ? new Set(naturalKeyHashes) : undefined;
  const sampled = wanted
    ? allEntries.filter((e) => wanted.has(e.naturalKeyHash))
    : allEntries.slice(0, count);

  // Fetch a real content hash for the sampled items only — this is the whole
  // point of SAMPLING: the enumeration stays metadata-only, and just these few
  // items are read in full so the checksum leg has something to compare.
  //
  // Without it every sample carried '' and was counted as `checksumUnavailable`,
  // so §20's "checksum sampling" never actually ran. A reindexer that cannot
  // produce a comparable hash (CalDAV/CardDAV, where the server re-serializes
  // what it stored) still omits `contentHashFor`, and those samples stay
  // honestly unavailable rather than being scored as mismatches.
  if (targetReindexer.contentHashFor) {
    for (const sample of sampled) {
      if (isNonEmpty(sample.content)) continue; // the listing already had one
      const hash = await targetReindexer.contentHashFor(sample.entry);
      if (hash) sample.content = hash;
    }
  }

  return sampled.map(({ id, naturalKeyHash, content }) => ({ id, naturalKeyHash, content }));
}

/** Is there anything here to compare? Mirrors verification.ts's own check. */
function isNonEmpty(content: Uint8Array | string): boolean {
  return typeof content === 'string' ? content.length > 0 : content.byteLength > 0;
}

/**
 * Find items that exist in the ledger but are missing on the target
 */
async function findMissingOnTarget(
  reader: LedgerVerificationReader,
  tenantId: TenantId,
  mappingId: MappingId,
  dataType: 'mail' | 'calendar' | 'contacts' | 'files',
  targetReindexer?: TargetReindexer
): Promise<Array<{ id: string; sourceRef: string }>> {
  const domain = mapDataTypeToDomain(dataType) as 'email' | 'calendar' | 'contact' | 'file';
  
  // "Cannot read the target" is not the same as "the target is empty". Reporting
  // every ledger row as missing produced a FAIL that looked like catastrophic
  // data loss; the domain is simply unverifiable, which runVerification reports
  // as NOT_VERIFIABLE before reaching here.
  if (!targetReindexer) {
    throw new Error(`No target reindexer for ${dataType}: missing items cannot be determined.`);
  }

  // Get all natural key hashes from the ledger
  const ledgerHashes = await reader.getAllNaturalKeyHashes(tenantId, mappingId, domain);

  // Get all natural keys from the target
  const targetKeys = new Set<string>();
  for await (const entry of targetReindexer.listEntries()) {
    targetKeys.add(hashTargetNaturalKey(dataType, entry.naturalKey));
  }
  
  // Find ledger items that are missing on target
  const missing: Array<{ id: string; sourceRef: string }> = [];
  for (const hash of ledgerHashes) {
    if (!targetKeys.has(hash)) {
      missing.push({ id: hash, sourceRef: hash });
    }
  }
  
  return missing;
}

/**
 * Find items that exist on the target but not in the ledger
 */
async function findExtraOnTarget(
  reader: LedgerVerificationReader,
  tenantId: TenantId,
  mappingId: MappingId,
  dataType: 'mail' | 'calendar' | 'contacts' | 'files',
  targetReindexer?: TargetReindexer
): Promise<Array<{ id: string; targetRef: string }>> {
  if (!targetReindexer) {
    throw new Error(`No target reindexer for ${dataType}: extra items cannot be determined.`);
  }

  const domain = mapDataTypeToDomain(dataType) as 'email' | 'calendar' | 'contact' | 'file';

  // Get all natural key hashes from the ledger for this domain
  const ledgerHashes = new Set(await reader.getAllNaturalKeyHashes(tenantId, mappingId, domain));

  // If ledger has no entries for this domain, there should be no extra items
  // (the target should also have no entries for this domain)
  if (ledgerHashes.size === 0) {
    return [];
  }
  
  // Get all natural keys from the target and find extras
  const extra: Array<{ id: string; targetRef: string }> = [];
  for await (const entry of targetReindexer.listEntries()) {
    if (!ledgerHashes.has(hashTargetNaturalKey(dataType, entry.naturalKey))) {
      extra.push({ id: entry.targetId, targetRef: entry.naturalKey });
    }
  }
  
  return extra;
}

/**
 * Get total bytes from the ledger
 */
async function getTotalBytesFromLedger(
  reader: LedgerVerificationReader,
  tenantId: TenantId,
  mappingId: MappingId,
  dataType: 'mail' | 'calendar' | 'contacts' | 'files'
): Promise<number> {
  const domain = mapDataTypeToDomain(dataType) as 'email' | 'calendar' | 'contact' | 'file';
  return reader.totalSizeBytes(tenantId, mappingId, domain);
}

/**
 * Sum the target's own reported sizes for the items this mapping copied.
 *
 * Returns null unless EVERY matched entry carries a size. A partial sum reads
 * as a shortfall against the source total — i.e. as data loss — which is
 * exactly the kind of confidently-wrong number this field was made null to
 * avoid in the first place.
 */
async function getTotalBytesFromReindexer(
  targetReindexer: TargetReindexer | undefined,
  reader: LedgerVerificationReader,
  tenantId: TenantId,
  mappingId: MappingId,
  dataType: 'mail' | 'calendar' | 'contacts' | 'files',
): Promise<number | null> {
  if (!targetReindexer) return null;

  const domain = mapDataTypeToDomain(dataType) as 'email' | 'calendar' | 'contact' | 'file';
  const ledgerHashes = new Set(await reader.getAllNaturalKeyHashes(tenantId, mappingId, domain));

  let total = 0;
  let measured = 0;
  let matched = 0;
  for await (const entry of targetReindexer.listEntries()) {
    if (!ledgerHashes.has(hashTargetNaturalKey(dataType, entry.naturalKey))) continue;
    matched++;
    if (typeof entry.sizeBytes === 'number') {
      total += entry.sizeBytes;
      measured++;
    }
  }

  if (matched === 0) return 0;
  return measured === matched ? total : null;
}

/*
 * A note on where target bytes come from.
 *
 * There used to be a getTotalBytesFromTarget() here that returned
 * getTotalBytesFromLedger(...) — the SOURCE total — so every verification
 * report showed source and target bytes as equal. That reads as "byte-level
 * parity verified" when nothing on the target was ever measured, exactly the
 * fabricated evidence the gate exists to prevent (hard rule 9).
 *
 * getTotalBytesFromReindexer above measures it for real, from the size each
 * target reports in its own listing (JMAP `size`, IMAP RFC822.SIZE, DAV
 * getcontentlength). It returns null unless every matched item carried one,
 * because a partial sum would look like a shortfall — i.e. like data loss —
 * rather than like a gap in measurement.
 */

/**
 * Hash a natural key the way the ledger stored it.
 *
 * The ledger's `item.natural_key_hash` is a sha256 of a domain-prefixed key
 * (`mid:` / `cal:` / `card:` / `file:`) — see @openmig/shared's hash.ts, which is
 * what the sync path writes. The target reindexers, by contrast, yield the RAW
 * key in `TargetEntry.naturalKey` (a Message-ID, a UID, a path).
 *
 * Comparing those two directly — which this file used to do — means comparing a
 * 64-char hex digest against a Message-ID. The sets can never intersect, so every
 * ledger row came back "missing on target", every target entry came back "extra",
 * and the mandatory pre-cutover gate would FAIL on first real use. Anything that
 * compares a target key against a ledger hash must go through here first.
 */
function hashTargetNaturalKey(
  dataType: 'mail' | 'calendar' | 'contacts' | 'files',
  rawKey: string,
): string {
  switch (dataType) {
    case 'mail':
      return naturalKeyHash(rawKey);
    case 'calendar':
      return calendarNaturalKeyHash(rawKey);
    case 'contacts':
      return contactNaturalKeyHash(rawKey);
    case 'files':
      return fileNaturalKeyHash(rawKey);
  }
}

/**
 * Map data type to domain string used in the ledger
 */
function mapDataTypeToDomain(
  dataType: 'mail' | 'calendar' | 'contacts' | 'files'
): string {
  switch (dataType) {
    case 'mail':
      return 'email';
    case 'calendar':
      return 'calendar';
    case 'contacts':
      return 'contact';
    case 'files':
      return 'file';
    default:
      throw new Error(`Unknown data type: ${dataType}`);
  }
}
