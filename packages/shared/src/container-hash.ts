// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A content hash for a rendering, taken over its PARTS rather than its bytes —
 * [ADR-0046](../../../docs/adr/0046-a-rendering-is-compared-by-its-parts.md),
 * accepted 2026-09-16, built as workplan 0042 T7.
 *
 * WHY. A Google Doc has no bytes; migrating one means asking Drive to EXPORT a
 * rendering. Measured on a real tenant across fifteen draws, a `.docx` from
 * `files.export` is byte-unstable ONLY in its zip container: every one of its
 * nine members came back byte-identical while the zip's own member timestamps
 * moved. Hash the whole file and `contentHash` sees a change on every pass, so
 * the migration rewrites every document nightly, forever, with every write
 * succeeding and nothing looking broken. That is why `nativeFilePolicy`
 * defaults to `refuse`, and this is what makes the refusal liftable.
 *
 * WHAT IT HASHES. Member names sorted, and for each, the sha256 of its
 * UNCOMPRESSED bytes. Excluded, because they describe the zip rather than the
 * document: member modification timestamps, member order, compression method
 * and level, extra fields, and the archive comment.
 *
 * SHA-256 OF INFLATED BYTES, NEVER THE STORED CRC-32. `drive-export-members.ts`
 * fingerprints members by the CRC-32 the index already carries, because that is
 * free and it is answering "what moved". This value answers "are these the same
 * file" and decides whether a customer's document is rewritten. CRC-32 is 32
 * bits and is not collision-resistant; deriving this from it would be a real
 * defect wearing the shape of an optimisation.
 *
 * IT IS NOT REACHED BY EVERY FILE, and that narrowness is the safety argument.
 * The caller applies it only to a rendering THIS PRODUCT asked Drive to
 * produce. A `.zip` a customer stored is compared by its bytes like anything
 * else, because for that file the container IS the content — its member order
 * and timestamps are data they own.
 *
 * `null` MEANS "CANNOT CANONICALISE", AND IS SAFE. Not a zip, a compression
 * method we do not implement, a zip64 container, a malformed index, or an
 * inflate that throws: all answer `null`, and the caller falls back to hashing
 * the whole file. That fallback is conservative — it can cause a rewrite, never
 * a missed change — and the version tag below keeps it legible rather than
 * silent.
 */

import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { CONTAINER_FINGERPRINT_VERSION } from './fingerprint-scheme.ts';

/**
 * The tag this hash stamps on its output, defined in `fingerprint-scheme.ts`
 * because `confirmed-list.ts` needs it too and is guarded as a pure module —
 * see that file. Re-exported here so a reader who arrives at the hash still
 * finds its version beside it.
 */
export { CONTAINER_FINGERPRINT_VERSION } from './fingerprint-scheme.ts';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const EOCD_BYTES = 22;

/** Stored, and deflate. The two an OOXML or ODF container actually uses. */
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** The marker a zip64 container leaves in a field too small to hold its value. */
const ZIP64_SENTINEL = 0xffffffff;

/**
 * The canonical fingerprint of a zip container, or `null` when this cannot be
 * computed for it.
 *
 * Never throws. Every structural surprise answers `null`, because the caller's
 * fallback — hash the whole file — is a correct comparison, just a stricter
 * one. Throwing would fail a migration over a file we merely could not read
 * cleverly.
 */
export function containerContentHash(bytes: Uint8Array): string | null {
  try {
    const members = readMembers(bytes);
    if (!members) return null;

    const digest = createHash('sha256');
    // The version goes INTO the hash as well as onto the front of it, so two
    // schemes cannot collide even if somebody compares the bare hex halves.
    digest.update(CONTAINER_FINGERPRINT_VERSION);
    // Sorted by the NAME BYTES, not by locale: `localeCompare` would order the
    // same archive differently on two machines and the hash with it.
    const sorted = [...members].sort((a, b) => compareBytes(a.nameBytes, b.nameBytes));
    for (const member of sorted) {
      // Both halves are fixed-width hex, so no separator is needed and no
      // member name can be crafted to straddle the boundary between two.
      digest.update(createHash('sha256').update(member.nameBytes).digest('hex'));
      digest.update(createHash('sha256').update(member.content).digest('hex'));
    }
    return `${CONTAINER_FINGERPRINT_VERSION}:${digest.digest('hex')}`;
  } catch {
    // An inflate that throws on a truncated member lands here, as does any
    // bounds error. Same answer, same reason: the caller has a correct
    // fallback and a failed migration is not an improvement on a strict hash.
    return null;
  }
}

interface Member {
  readonly nameBytes: Uint8Array;
  readonly content: Uint8Array;
}

/** Every member's name and inflated content, or `null` if that cannot be had. */
function readMembers(bytes: Uint8Array): Member[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) return null;

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  // A zip64 archive puts sentinels in the fields too narrow to hold its real
  // values. We do not implement its extended records, and guessing would be
  // worse than falling back.
  if (count === 0xffff || at === ZIP64_SENTINEL) return null;

  const members: Member[] = [];
  for (let i = 0; i < count; i += 1) {
    if (at + CENTRAL_HEADER_BYTES > view.byteLength) return null;
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) return null;

    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL) return null;
    if (localAt === ZIP64_SENTINEL) return null;
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) return null;

    const nameAt = at + CENTRAL_HEADER_BYTES;
    if (nameAt + nameLength > view.byteLength) return null;
    const nameBytes = bytes.subarray(nameAt, nameAt + nameLength);

    const content = readLocalContent(bytes, view, localAt, method, compressedSize);
    if (!content) return null;
    members.push({ nameBytes, content });

    at = nameAt + nameLength + extraLength + commentLength;
  }
  return members;
}

/**
 * The member's uncompressed bytes, read at its LOCAL header.
 *
 * The local header is read for its own name and extra lengths rather than the
 * central directory's: the two are allowed to differ, and an archive where they
 * do would otherwise be sliced at the wrong offset and hash as something else.
 *
 * The SIZE, though, comes from the central directory. A member written with a
 * data descriptor (general-purpose bit 3) carries zeroes in the local header's
 * size fields and the real values after the data — the central directory always
 * holds the truth, so reading it there costs nothing and handles that case
 * without a special branch.
 */
function readLocalContent(
  bytes: Uint8Array,
  view: DataView,
  localAt: number,
  method: number,
  compressedSize: number,
): Uint8Array | null {
  if (localAt + LOCAL_HEADER_BYTES > view.byteLength) return null;
  if (view.getUint32(localAt, true) !== LOCAL_SIGNATURE) return null;

  const nameLength = view.getUint16(localAt + 26, true);
  const extraLength = view.getUint16(localAt + 28, true);
  const dataAt = localAt + LOCAL_HEADER_BYTES + nameLength + extraLength;
  if (dataAt + compressedSize > view.byteLength) return null;

  const raw = bytes.subarray(dataAt, dataAt + compressedSize);
  return method === METHOD_STORED ? raw : new Uint8Array(inflateRawSync(raw));
}

/**
 * Scan back for the end-of-central-directory signature.
 *
 * Backwards, because the record sits at the very end UNLESS the archive carries
 * a trailing comment, and the comment's length is only readable from inside the
 * record being looked for. The comment is at most 0xffff bytes, so the scan is
 * bounded.
 */
function findEndOfCentralDirectory(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - EOCD_BYTES - 0xffff);
  for (let at = view.byteLength - EOCD_BYTES; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  return -1;
}

/** Byte-wise ordering, so the same archive sorts identically everywhere. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const left = a[i] as number;
    const right = b[i] as number;
    if (left !== right) return left - right;
  }
  return a.length - b.length;
}
