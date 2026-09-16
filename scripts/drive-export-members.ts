// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH PART of an unstable export moved (workplan 0042 T0 Q3, T3).
 *
 * `drive-export-verdict.ts` answers whether several exports of one unchanged
 * document agree. When they do not, the next question is always the same and
 * until now nobody could answer it: WHAT changed? The owner measured
 * `export-office` on 2026-09-16 and got five different renderings at
 * **exactly 17644 bytes every time** — so something inside was overwritten in
 * place, and the guess written down at the time was `docProps/core.xml`
 * timestamps. A guess is not a measurement, and the difference decides a
 * product question: if the only moving parts are a known handful of fields, a
 * normalised hash is a small change and `export-office` becomes usable. If the
 * document body itself varies, no normalisation saves it.
 *
 * THE CHEAP INSTRUMENT. A `.docx` and a `.odt` are zip containers, and a zip
 * has already done this work for us. Its central directory carries, per member,
 * a CRC-32 of the UNCOMPRESSED bytes, the uncompressed size, and a DOS
 * modification stamp. So "which member changed" is a read of a few dozen bytes
 * of index — no inflation, no temporary files, no new dependency.
 *
 * IT KEEPS THE SCRIPT'S REDACTION STANCE, which is why it reads the index
 * rather than the members. What comes back is a member NAME
 * (`word/document.xml`, `docProps/core.xml` — structural, fixed by the OOXML
 * and ODF specifications, not the customer's words), a CRC-32, a length and a
 * timestamp. A CRC-32 is not reversible to the content that produced it. No
 * document bytes are written anywhere, printed, or kept once the index has been
 * read — the same bargain `drive-capture.ts` already makes.
 *
 * THE DISTINCTION IT EXISTS TO DRAW. Two failures look identical from outside
 * the container and are not the same problem at all:
 *
 *   - Every member's CRC is constant and only the DOS stamps move. Then NO
 *     member content changed; the container was rebuilt around identical
 *     parts. That is the cheapest case there is.
 *   - Some member's CRC moves. Then that member's bytes really differ, and its
 *     name says whether it is metadata (`docProps/core.xml`) or the document
 *     (`word/document.xml`). Only the first is normalisable.
 *
 * A PDF is not a zip and gets `null` from `readZipMembers`, which is not a
 * failure — it is the honest answer, and the caller says so rather than
 * pretending it looked.
 *
 * NOTHING HERE IS A `contentHash`, AND NOTHING HERE MAY BECOME ONE. The CRC-32
 * this reads is free because the zip index already stores it, and it is the
 * right instrument for "what moved" — a wrong answer there costs a re-run. A
 * `contentHash` answers "are these the same file" and decides whether a
 * customer's document is rewritten; CRC-32 is 32 bits and is not
 * collision-resistant, so deriving one from this would be a real defect
 * wearing the shape of an optimisation. That hash is
 * `packages/shared/src/container-hash.ts`, it inflates each member and takes a
 * sha256, and ADR-0046 rule (b) says so in one line. The distinction is
 * guarded by `a-content-hash-built-from-thirty-two-bits.unit.test.ts`, which
 * reads both files — because swapping sha256 for CRC-32 passes every
 * behavioural test there is, and that was measured rather than assumed.
 */

import { createHash } from 'node:crypto';

/** One member of a zip container, as its central directory describes it. */
export interface ZipMember {
  /** The path inside the container, e.g. `word/document.xml`. */
  readonly name: string;
  /** CRC-32 of the member's UNCOMPRESSED bytes, as the container stores it. */
  readonly crc32: number;
  /** Uncompressed length in bytes. */
  readonly size: number;
  /** The DOS date and time words, packed — only ever compared, never shown as a date. */
  readonly stamp: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** The fixed part of a central directory file header, before the name. */
const CENTRAL_HEADER_BYTES = 46;

/** The fixed part of an end-of-central-directory record, before the comment. */
const EOCD_BYTES = 22;

/**
 * The members of `bytes`, or `null` when it is not a zip at all.
 *
 * `null` rather than a throw, because "this export is a PDF" is an ordinary
 * answer on the path that calls this, not an error. A buffer that starts like a
 * zip and then contradicts itself DOES throw: a half-read index would produce a
 * confident, wrong list of what changed, which is worse than no list.
 */
export function readZipMembers(bytes: Uint8Array): readonly ZipMember[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) return null;

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();

  const members: ZipMember[] = [];
  for (let i = 0; i < count; i += 1) {
    if (at + CENTRAL_HEADER_BYTES > view.byteLength) {
      throw new Error(
        `zip central directory claims ${count} members but entry ${i + 1} runs past the end`,
      );
    }
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new Error(`zip central directory entry ${i + 1} has no header signature`);
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const nameAt = at + CENTRAL_HEADER_BYTES;
    if (nameAt + nameLength > view.byteLength) {
      throw new Error(`zip central directory entry ${i + 1} has a name running past the end`);
    }
    members.push({
      name: decoder.decode(bytes.subarray(nameAt, nameAt + nameLength)),
      crc32: view.getUint32(at + 16, true),
      size: view.getUint32(at + 24, true),
      // Date above time, so one number compares the way a date would.
      stamp: view.getUint16(at + 14, true) * 0x10000 + view.getUint16(at + 12, true),
    });
    at = nameAt + nameLength + extraLength + commentLength;
  }
  return members;
}

/**
 * Scan back for the end-of-central-directory signature.
 *
 * Backwards, because the record sits at the very end UNLESS the file carries a
 * trailing comment, and the comment's length is only readable from inside the
 * record you are trying to find. A zip comment is at most 0xffff bytes, so the
 * scan is bounded.
 */
function findEndOfCentralDirectory(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - EOCD_BYTES - 0xffff);
  for (let at = view.byteLength - EOCD_BYTES; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  return -1;
}

/** What varied across the draws, member by member. */
export interface MemberComparison {
  /** Members whose stored CRC-32 or size differed between draws — content really changed. */
  readonly changed: readonly string[];
  /**
   * Members whose content was identical every time but whose DOS stamp moved:
   * the container was rebuilt around unchanged parts.
   */
  readonly restamped: readonly string[];
  /** Members that were not present in every draw at all. */
  readonly absent: readonly string[];
  /** How many members held both content and stamp across every draw. */
  readonly unchanged: number;
  /** The sentence for the operator, saying which of the cases this is. */
  readonly note: string;
}

/**
 * Compare the member lists of several draws of the same document.
 *
 * Deliberately takes the LISTS and not the buffers: the caller reads each
 * export once, takes its index, and lets the bytes go. Nothing here can hold a
 * customer's document in memory.
 */
export function compareMembers(draws: readonly (readonly ZipMember[])[]): MemberComparison {
  if (draws.length < 2) {
    // The same refusal `stabilityVerdict` makes, for the same reason: one draw
    // cannot disagree with anything, and "nothing changed" from it would read
    // as evidence.
    throw new Error(`compareMembers needs at least 2 draws, got ${draws.length}`);
  }

  const everyName = [...new Set(draws.flatMap((draw) => draw.map((m) => m.name)))].sort();
  const changed: string[] = [];
  const restamped: string[] = [];
  const absent: string[] = [];
  let unchanged = 0;

  for (const name of everyName) {
    const seen = draws.map((draw) => draw.find((m) => m.name === name));
    if (seen.some((m) => m === undefined)) {
      absent.push(name);
      continue;
    }
    const members = seen as ZipMember[];
    if (new Set(members.map((m) => `${m.crc32}:${m.size}`)).size > 1) {
      changed.push(name);
      continue;
    }
    if (new Set(members.map((m) => m.stamp)).size > 1) {
      restamped.push(name);
      continue;
    }
    unchanged += 1;
  }

  return { changed, restamped, absent, unchanged, note: describe(changed, restamped, absent) };
}

function describe(
  changed: readonly string[],
  restamped: readonly string[],
  absent: readonly string[],
): string {
  if (absent.length > 0) {
    return (
      `The containers do not hold the same parts: ${absent.join(', ')} is missing from at least ` +
      'one draw. Nothing below the structure is worth reading until that is understood.'
    );
  }
  if (changed.length === 0 && restamped.length === 0) {
    // Worth a sentence rather than an empty list: the whole-file hashes
    // disagreed or this would not be running, so something DID move. If no
    // member did, it moved in the container — member order, padding, the
    // compressor's settings.
    return (
      'No member changed content and none was restamped, yet the files hash differently — so ' +
      'what varies is the CONTAINER: member order, padding, or compressor settings. The parts ' +
      'themselves are identical.'
    );
  }
  if (changed.length === 0) {
    return (
      "No member's content changed. Only zip modification stamps moved, on " +
      `${restamped.length} member(s). The document is byte-identical inside a rebuilt container.`
    );
  }
  return (
    `${changed.length} member(s) changed content: ${changed.join(', ')}. ` +
    (restamped.length > 0 ? `${restamped.length} more were only restamped. ` : '') +
    'Where a change sits decides what can be done about it, and this does not read inside them.'
  );
}

/**
 * A fingerprint of a member list — names and content digests, with the zip's
 * own modification stamps and member order deliberately left out.
 *
 * READ THE NAME NARROWLY. This normalises the CONTAINER and nothing else. It
 * answers exactly one question: would the draws agree if the zip's own
 * bookkeeping were ignored? When every member's content is identical and only
 * the stamps moved, yes — and that is a real, cheap case worth detecting.
 *
 * IT IS NOT the "normalised hash" route in 0042 T3, and an early draft of this
 * file said it was. That route means normalising CONTENT — stripping
 * `dcterms:modified` out of `docProps/core.xml` before hashing it — which is a
 * larger thing needing a parser per format and a decision about what may be
 * discarded. A timestamp written inside a member changes that member's CRC, so
 * this hash moves with it, exactly as a whole-file hash would. Claiming
 * otherwise would have told the owner a route was validated when nothing about
 * it had been measured, which is the failure mode this entire workplan exists
 * to prevent.
 */
export function containerNormalisedHash(members: readonly ZipMember[]): string {
  const hash = createHash('sha256');
  const byName = [...members].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const m of byName) {
    hash.update(`${m.name}\n${m.crc32}\n${m.size}\n`);
  }
  return hash.digest('hex');
}
