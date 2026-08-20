// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Canonical content fingerprints for iCalendar and vCard.
 *
 * §20's checksum leg needs a value that means the same thing computed on the
 * source and computed back off the target. A byte hash does not: CalDAV and
 * CardDAV servers **re-serialize** what you give them. Nextcloud/SabreDAV
 * rewrites line folding, reorders properties, normalizes parameters, and adds
 * its own `PRODID`, `VERSION` and `X-` properties. Every item would look
 * corrupt, so `contentHashFor` was withdrawn for both domains (#143) and the
 * content leg of the gate simply stopped running for them — 9 of 10 samples
 * came back `checksumUnavailable` on a real run, and mail's came back 10 of 10.
 *
 * So fingerprint what survives a round trip: a fixed set of semantically
 * load-bearing properties, unfolded, unescaped, trimmed and sorted.
 *
 * ## What this does and does not claim
 *
 * This is a **semantic subset check, not byte fidelity.** A match says the
 * event or contact carries the same identity and human-meaningful content it
 * had on the source. It does not say the octets are identical — for these two
 * domains no honest check can, because the server chose the octets.
 *
 * The property set is deliberately conservative. It holds only **opaque text**
 * values that servers pass through verbatim. Timing properties (`DTSTART`,
 * `DTEND`, `RRULE`, `EXDATE`) are *excluded on purpose*: a server may
 * legitimately rewrite `DTSTART;TZID=Europe/Amsterdam:20260110T100000` as
 * `DTSTART:20260110T090000Z`, which is the same instant and a different string.
 * Comparing those without a full timezone database and RFC 5545 recurrence
 * normalization would report healthy events as corrupt — the exact failure this
 * module exists to avoid, and the reason a naive version of it would be worse
 * than the honest gap it replaces.
 *
 * What it therefore catches: truncation, a wrong or empty body, a dropped
 * summary/description/location, an item overwritten by a different one. What it
 * does not catch: a timezone rewritten wrongly, or a change confined to
 * properties outside the set. Count parity and total size cover different
 * ground, and all three run together.
 *
 * ## Versioning
 *
 * Fingerprints carry a `cal1:`/`card1:` prefix. The ledger holds whatever
 * version was current when the item was recorded, and verification treats a
 * cross-version comparison as *unavailable* rather than as a mismatch — so
 * upgrading mid-migration cannot turn old rows into fabricated corruption
 * reports. Bump the prefix whenever the property set or normalization changes.
 */

import { createHash } from 'node:crypto';

/** Version tag for calendar fingerprints. Bump when the algorithm changes. */
export const CALENDAR_FINGERPRINT_VERSION = 'cal1';
/** Version tag for contact fingerprints. Bump when the algorithm changes. */
export const CONTACT_FINGERPRINT_VERSION = 'card1';

/**
 * iCalendar properties compared. Opaque text only — see the note above on why
 * timing properties are excluded.
 */
const CALENDAR_PROPERTIES = ['UID', 'SUMMARY', 'DESCRIPTION', 'LOCATION'] as const;

/** vCard properties compared. Likewise opaque text. */
const CONTACT_PROPERTIES = ['UID', 'FN', 'N', 'EMAIL', 'TEL', 'ORG', 'TITLE', 'NOTE'] as const;

/** A versioned fingerprint of an iCalendar object. */
export function calendarFingerprint(icalendar: string): string {
  return `${CALENDAR_FINGERPRINT_VERSION}:${digest(canonicalLines(icalendar, CALENDAR_PROPERTIES))}`;
}

/** A versioned fingerprint of a vCard. */
export function contactFingerprint(vcard: string): string {
  return `${CONTACT_FINGERPRINT_VERSION}:${digest(canonicalLines(vcard, CONTACT_PROPERTIES))}`;
}

/**
 * Do these two fingerprints use the same algorithm version?
 *
 * A ledger row written before an algorithm change holds an older tag. Comparing
 * across versions says nothing about the data, so the caller must report it as
 * unmeasured rather than as a mismatch.
 */
export function sameFingerprintVersion(a: string, b: string): boolean {
  return versionOf(a) === versionOf(b);
}

/** The version tag of a fingerprint, or undefined for an unversioned value. */
export function versionOf(fingerprint: string): string | undefined {
  const match = /^([a-z0-9]+):/i.exec(fingerprint);
  return match?.[1];
}

/**
 * The canonical line set: allow-listed properties, unfolded, unescaped,
 * trimmed, sorted.
 *
 * Sorting is what makes property reordering — which servers do freely — a
 * non-event. Parameters are dropped: a server may add `VALUE=`, reorder or
 * requote them without changing what the property says.
 */
function canonicalLines(
  source: string,
  properties: ReadonlyArray<string>,
): string {
  const allowed = new Set(properties);
  const out: string[] = [];

  for (const line of unfold(source)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;

    // `SUMMARY;LANGUAGE=en:Hi` -> name `SUMMARY`, parameters discarded.
    const name = line.slice(0, colon).split(';')[0]!.trim().toUpperCase();
    if (!allowed.has(name)) continue;

    const value = unescapeText(line.slice(colon + 1)).trim();
    // An empty value carries no evidence either way and servers vary on whether
    // they keep the property at all; including it would make presence-vs-absence
    // of an empty field look like a content change.
    if (value.length === 0) continue;

    out.push(`${name}:${value}`);
  }

  return out.sort().join('\n');
}

/**
 * Undo RFC 5545 §3.1 / RFC 6350 §3.2 line folding.
 *
 * A continuation line begins with a space or tab, and the break plus that one
 * whitespace character are removed. Servers refold at their own width, so a
 * fingerprint that did not unfold first would change with the line length.
 */
function unfold(source: string): string[] {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

/**
 * Undo the text escapes both formats share: `\n`, `\,`, `\;`, `\\`.
 *
 * Servers re-escape as they see fit — `\;` may come back as `;` where the
 * grammar no longer requires it — so comparing escaped forms would flag
 * unchanged text.
 */
function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_m, ch: string) =>
    ch === 'n' || ch === 'N' ? '\n' : ch,
  );
}

function digest(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
