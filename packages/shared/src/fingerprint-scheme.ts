// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH SCHEME MADE A STORED HASH, and the rule that two schemes are never
 * compared — [ADR-0046](../../../docs/adr/0046-a-rendering-is-compared-by-its-parts.md)
 * rule (d), workplan 0042 T7.
 *
 * A content hash in this ledger carries its own scheme, on its front. There is
 * no column beside it and none is needed: the tag travels inside the string the
 * row already holds, which is what makes the rule cheap and what makes
 * forgetting it silent.
 *
 * ## Why this is its own module, with nothing imported
 *
 * The tags used to live beside the functions that compute them — `cal1:` and
 * `card1:` in `dav-canonical.ts`, `zip1:` in `container-hash.ts` — and that was
 * fine while only those files asked the question. It stopped being fine when
 * `confirmed-list.ts` had to ask it: that module is guarded as PURE, so that
 * every assertion over the claim vocabulary can be exhaustive rather than
 * sampled, and importing a hashing module into it would have ended that for the
 * sake of one string constant.
 *
 * The alternative was to copy the tag, which is the drift this scheme exists to
 * prevent, one level up. So the tags moved here instead. **This file imports
 * nothing, and must not start**: a scheme tag is a name, and naming needs no
 * crypto, no zlib and no I/O.
 *
 * ## The rule, in one sentence
 *
 * Two values with different tags say NOTHING about each other. Not "they
 * differ" — nothing. A caller that finds them incomparable reports the
 * comparison as unmeasured and never as a change; `verification.ts`,
 * `confirmation-pass.ts` and `apply-deletion.ts` each do exactly that, and
 * `a-hash-compared-against-a-different-scheme.unit.test.ts` is what joins them.
 */

/**
 * Version tag for canonical iCalendar fingerprints. Bump when the algorithm
 * changes.
 */
export const CALENDAR_FINGERPRINT_VERSION = 'cal1';

/** Version tag for canonical vCard fingerprints. Bump when the algorithm changes. */
export const CONTACT_FINGERPRINT_VERSION = 'card1';

/**
 * Version tag for container fingerprints — a rendering compared by its parts.
 *
 * Same shape and the same reason as the two above: a ledger row written by an
 * older build carries an older tag, comparing across versions says nothing
 * about the data, and the caller must report that as unmeasured rather than as
 * a change. Without this, adopting the scheme would re-label every
 * already-migrated native file and rewrite the lot exactly once — the disease
 * arriving through the cure.
 */
export const CONTAINER_FINGERPRINT_VERSION = 'zip1';

/**
 * Do these two fingerprints use the same algorithm version?
 *
 * A ledger row written before an algorithm change holds an older tag. Comparing
 * across versions says nothing about the data, so the caller must report it as
 * unmeasured rather than as a mismatch.
 *
 * Untagged-against-untagged is TRUE, and that is not an oversight: a plain
 * sha256 over whole bytes is a scheme too, and the commonest one — mail and
 * files, both sides, today. If this answered false for them the confirmed list
 * would report nothing at all.
 */
export function sameFingerprintVersion(a: string, b: string): boolean {
  return versionOf(a) === versionOf(b);
}

/**
 * The version tag of a fingerprint, or undefined for an unversioned value.
 *
 * THE COLON IS REQUIRED, and that is the whole of the parsing. A bare sha256 is
 * 64 characters of `[a-f0-9]`, which the character class alone would match
 * happily — every whole-file hash would then look tagged, with its first
 * characters as the scheme, and no two would ever be comparable.
 */
export function versionOf(fingerprint: string): string | undefined {
  const match = /^([a-z0-9]+):/i.exec(fingerprint);
  return match?.[1];
}
