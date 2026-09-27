// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The target's own version marker for an object we wrote — its ETag — and the
 * check that decides whether our copy is still ours to replace.
 *
 * Shared by all three DAV writers because the rule has to be identical in each:
 * a difference between them is a difference in when customer data may be
 * destroyed, which is not something to reimplement per protocol.
 *
 * Why an ETag and not a hash of the bytes: CalDAV and CardDAV servers may
 * normalise what they store, so reading back an object can differ from what we
 * PUT for reasons that have nothing to do with anybody editing it. Comparing
 * content would declare every rewrite a conflict and freeze the corpus. The
 * server mints the ETag after any normalisation, so it changes when — and only
 * when — the object does.
 */

/** Minimal shape shared by the three writers' HTTP responses. */
interface HeadersLike {
  readonly status: number;
  readonly headers: Record<string, string>;
}

/**
 * The ETag from a response, normalised for comparison.
 *
 * Case-insensitive lookup because header casing is the server's choice and only
 * the Fetch API guarantees lowercase — a writer constructed with a custom HTTP
 * client need not. Quotes and the weak validator prefix are stripped so the
 * same object compares equal whether the server sent `W/"abc"`, `"abc"` or
 * `abc`; a comparison that depended on that spelling would report a phantom
 * edit the first time a server changed its mind about the format.
 *
 * Undefined when there is none, which is a real answer: it means this item has
 * no overwrite protection, not that it has been tampered with.
 */
export function readEtag(response: HeadersLike): string | undefined {
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() !== 'etag') continue;
    const trimmed = value.trim().replace(/^W\//i, '').replace(/^"|"$/g, '');
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

/** The prefix a recorded version keeps when the server's ETag was weak. */
const WEAK = 'W/';

/**
 * The version to RECORD for what we just wrote: `readEtag`'s value, with `W/`
 * kept in front when the ETag was weak (workplan 0149 T3).
 *
 * `readEtag` throws the marker away, which is right for a comparison and wrong
 * for a record: the server checks `If-Match` with the strong comparison (RFC
 * 9110 §13.1.1), so a weak validator never matches. A version sent back as
 * `If-Match` without knowing it was weak would fail every time, and every
 * rewrite of that item would read as somebody's edit. So the record says which
 * kind it is, and `ifMatchFor` sends only the strong kind.
 */
export function readVersion(response: HeadersLike): string | undefined {
  const etag = readEtag(response);
  if (etag === undefined) return undefined;
  const raw = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'etag')?.[1] ?? '';
  return /^\s*W\//i.test(raw) ? `${WEAK}${etag}` : etag;
}

/** Was this recorded version a weak ETag? */
export function isWeakVersion(recorded: string): boolean {
  return recorded.startsWith(WEAK);
}

/**
 * The `If-Match` value for a recorded version, or `undefined` when there is
 * nothing the server could check: no version, or a weak one (workplan 0149 T3).
 *
 * Quoted, because an entity-tag is a quoted string (RFC 9110 §8.8.3) and every
 * recorded version had its quotes taken off by `readEtag`.
 */
export function ifMatchFor(recorded: string | undefined): string | undefined {
  if (recorded === undefined || isWeakVersion(recorded)) return undefined;
  return `"${recorded}"`;
}

/** What a pre-overwrite check concluded. */
export type OwnershipVerdict =
  /** The target still holds the version we wrote, or we cannot tell. Proceed. */
  | 'ours'
  /** The target reports a different version: somebody edited our copy. Stop. */
  | 'changed';

/**
 * Decide whether an object we are about to overwrite is still the one we wrote,
 * by a read and a comparison.
 *
 * THE CHECK A WEAK VERSION KEEPS (workplan 0149 T3, D4). A strong one is sent
 * as `If-Match` and the server decides in the write itself, with no gap between
 * reading and acting. A weak one cannot be matched that way, so a rewrite of it
 * reads the target first and compares, as every rewrite used to. A removal
 * never comes here: without a strong version it is refused outright.
 *
 * Both unknowns mean PROCEED, and that asymmetry is deliberate:
 *
 * - **We recorded no version.** Every row written before migration 0023 is in
 *   this state, as is anything written by a server that returns no ETag on PUT.
 *   Refusing would block every source change until each row had been rewritten
 *   once, which is a protection that presents as an outage (0149 D3).
 * - **The target reports no version now.** We have nothing to compare against.
 *   Treating silence as evidence of an edit would be inventing a fact.
 *
 * Only a version we recorded, differing from a version the target reports, is
 * evidence that someone has been in there — and that is the one case that stops
 * the write. A recorded version's `W/` is not part of the comparison: `current`
 * comes from `readEtag`, which drops it too.
 */
export function ownershipOf(
  expected: string | undefined,
  current: string | undefined,
): OwnershipVerdict {
  if (expected === undefined || current === undefined) return 'ours';
  const bare = isWeakVersion(expected) ? expected.slice(WEAK.length) : expected;
  return bare === current ? 'ours' : 'changed';
}
