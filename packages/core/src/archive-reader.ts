// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The archive reader seam (workplan 0116 T2).
 *
 * An export is not an account. Google hands a person a Takeout archive and Apple
 * hands them a Data & Privacy download, and in both cases the thing this product
 * is given is **a file with a date on it** rather than a service to ask. This
 * interface is where that difference is absorbed, so that everything downstream —
 * placement, idempotency, the manifest, the measure — is written once and works
 * for every export.
 *
 * **A third export is a new reader and nothing else.** Adding Meta, Dropbox or
 * Microsoft must not touch placement, idempotency, the measure or the wizard. If
 * it does, the seam is in the wrong place and this file is what should change.
 *
 * ## Three rules that live here and nowhere else
 *
 * **1. De-duplication is the READER's job.** Takeout ships one photo once per
 * album folder *and* once per year folder, so a caller that iterated the archive
 * naively would write the same image four times. `items()` yields one record per
 * DISTINCT item, with every folder it appeared in carried on that one record.
 * Pushing this to the caller would mean each of placement, the measure and the
 * ledger re-deriving it, and the first one to forget would be a silent
 * duplication nobody counted.
 *
 * **2. The hash is SHA-256 over the item's bytes, exactly as the file domain
 * computes it.** This is the rule most easily got wrong and the most expensive to
 * get wrong. A person may migrate their Drive live AND import a Takeout archive
 * of the same files; if the two routes disagree about an item's `contentHash`,
 * the archive import writes a second copy of every file the live route already
 * carried, and the ledger cannot tell they are the same bytes. Same bytes, same
 * hash, whichever door they came through.
 *
 * **3. What the provider knew is preserved verbatim.** `metadata` is an opaque
 * bag, copied rather than interpreted, because the reader cannot know which of
 * Takeout's sidecar fields a later task will need and a lossy read is not
 * recoverable — the archive's link expires.
 *
 * ## Opening can fail, and the failure is never a "no"
 *
 * A truncated download, a part that was never fetched, a password-protected zip:
 * these are the common case here, not the exception. They mean **"we could not
 * open this"** and must reach the surfaces as `unknown` with the reason, never as
 * a measured `no` (0106 T3a's three-state rule — an unknown never constrains a
 * tick, and telling somebody they have no photos because a download was cut
 * short would be the worst possible answer).
 *
 * `open()` throws `ArchiveUnreadable` for exactly that case, so the caller can
 * tell it apart from a bug.
 */

/** Where an archive is. The credential of an archive connection is a LOCATION. */
export interface ArchiveLocation {
  /** Which export this is, and therefore which reader opens it. */
  readonly provider: ArchiveProvider;
  /**
   * Where to read it from. A local path on the appliance, or a path inside a
   * file source we already read (a Drive, a Dropbox) — resolved by the caller
   * before it gets here, because the reader's job is the archive's INSIDE.
   */
  readonly path: string;
}

/**
 * The exports this product can read.
 *
 * A union rather than a string, because `provider` is not decoration: it selects
 * the reader and it decides which sentences the surfaces show. It is the field
 * that stops an Apple card promising Google's two-monthly schedule.
 */
export const ARCHIVE_PROVIDERS = ['google-takeout', 'apple-privacy'] as const;
export type ArchiveProvider = (typeof ARCHIVE_PROVIDERS)[number];

/** An opened archive. Opaque to the caller; the reader's own bookkeeping. */
export interface ArchiveHandle {
  readonly provider: ArchiveProvider;
  /** Released by the caller when done — a reader may hold file descriptors. */
  close(): Promise<void>;
}

/** One DISTINCT item in an archive. */
export interface ArchiveItem {
  /**
   * SHA-256 over the item's bytes, hex. Rule 2 above: the same value the file
   * domain computes for the same bytes, so a live migration and an archive
   * import of one file agree that it is one file.
   */
  readonly contentHash: string;
  /**
   * Where this item should land, relative to the import root — the natural key,
   * the same anchor the file domain uses.
   */
  readonly path: string;
  readonly sizeBytes: number;
  /**
   * EVERY folder the archive filed this item under, not the first one. Takeout
   * puts a photo in each of its albums and in its year; all of them are what the
   * person organised, and placement decides what to do with that.
   */
  readonly folders: ReadonlyArray<string>;
  /** When the provider says the item was created, if the archive says at all. */
  /** ISO 8601, matching `FileItem.createdAt`'s convention. */
  readonly createdAt?: string;
  /**
   * What the provider knew, verbatim and uninterpreted (rule 3). Read by
   * placement and the manifest; never by the sync's decisions.
   */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** What an archive holds, answered without reading every byte of it. */
export interface ArchiveSummary {
  readonly items: number;
  readonly bytes: number;
  readonly folders: number;
  /**
   * The span the archive covers, when it can be known. **An archive is a
   * snapshot with a date** and this is what lets a surface say so; absent when
   * the export carries no dates to derive it from, which is a legitimate answer
   * and not a zero.
   */
  readonly earliest?: string;
  readonly latest?: string;
}

/**
 * An archive that could not be opened, with the sentence to show.
 *
 * Distinct from a programming error on purpose: the caller renders this as
 * `unknown` with `reason` and must never turn it into a measured `no`.
 */
export class ArchiveUnreadable extends Error {
  /** Declared rather than a constructor parameter property: this repository
   *  compiles with `erasableSyntaxOnly`, which forbids syntax that emits. */
  readonly reason: string;

  constructor(reason: string, options?: { cause?: unknown }) {
    super(reason, options);
    this.name = 'ArchiveUnreadable';
    this.reason = reason;
  }
}

/** One implementation per export. See the three rules in this file's header. */
export interface ArchiveReader {
  /** Which export this reader is for — checked against the location. */
  readonly provider: ArchiveProvider;
  /** Throws {@link ArchiveUnreadable} when the archive cannot be opened. */
  open(location: ArchiveLocation): Promise<ArchiveHandle>;
  /** One record per DISTINCT item (rule 1). */
  items(handle: ArchiveHandle): AsyncIterable<ArchiveItem>;
  /** Counts and the date span, for the Measured line before anything moves. */
  summary(handle: ArchiveHandle): Promise<ArchiveSummary>;
}
