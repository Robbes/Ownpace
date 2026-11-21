// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEST ORGANISATION'S MARKER, AS THE OPERATOR TYPES IT (workplan 0162 T1,
 * §3; ADR-0053).
 *
 * An appointed operator marks an organisation as a test from Support, with a
 * marker (`POST /api/support/tenants/{tenantId}/test`). Every migration made
 * in it afterwards copies the marker onto its own row
 * (`mailbox_mapping.test_marker`, ledger migration 0070), and then copies only
 * the items whose own title contains it, ignoring case (`MarkedOnly`,
 * packages/orchestration). This is the rule the API reads the typed marker by,
 * in one place, so the Support screen and the door say the same thing.
 *
 * ## Its form
 *
 * Trimmed first, as everything an operator types is. Then 3 to 64 characters,
 * counted as Postgres counts them (`char_length`, code points), and every one
 * printable: no control character (C0, DEL, C1), which is the floor the
 * column's CHECK holds, and none of the characters that print nothing, which
 * a person could not type into a title or see in one: a format character
 * (U+200B and the like, a byte order mark, a bidirectional control), a line or
 * paragraph separator, a lone surrogate or a private-use character. A marker
 * shorter than three would match almost every title; one nobody can see would
 * match none.
 *
 * ## Offered, not assumed
 *
 * `DEFAULT_TEST_MARKER` is what the Support screen fills in for the operator
 * to keep or change (§2 (a)). The API requires a marker and supplies none: an
 * organisation marked without one would copy by a marker nobody chose.
 */

/** The marker the Support screen offers (§2 (a)). Never filled in by the API. */
export const DEFAULT_TEST_MARKER = '[Ownpace-test]';

/** The fewest characters a marker may have, once trimmed. */
export const TEST_MARKER_MIN = 3;

/** The most characters a marker may have, as the column's CHECK allows. */
export const TEST_MARKER_MAX = 64;

/**
 * Characters that print nothing: control (`Cc`), format (`Cf`), line and
 * paragraph separators (`Zl`, `Zp`), surrogates (`Cs`) and private use (`Co`).
 * Unassigned code points are not named, because which are assigned follows the
 * Unicode version of the runtime, and a marker must read the same everywhere.
 */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}]/u;

/** A typed marker, read: the marker to store, or why it is refused (said for the operator). */
export type TestMarkerReading = { readonly marker: string } | { readonly refused: string };

/**
 * Read the marker an operator typed. Trimmed; then refused when it is not
 * 3 to 64 printable characters. Nothing is filled in for an absent one.
 */
export function readTestMarker(typed: unknown): TestMarkerReading {
  if (typeof typed !== 'string') {
    return {
      refused:
        "marker is the text an item's own title must contain to be copied, " +
        `${TEST_MARKER_MIN} to ${TEST_MARKER_MAX} characters, such as ${DEFAULT_TEST_MARKER}`,
    };
  }
  const marker = typed.trim();
  if (UNPRINTABLE.test(marker)) {
    return {
      refused:
        'marker holds a character that prints nothing, such as a control or formatting character: ' +
        'nobody could type it into a title',
    };
  }
  const length = [...marker].length;
  if (length < TEST_MARKER_MIN) {
    return {
      refused: `marker is at least ${TEST_MARKER_MIN} characters once trimmed: a shorter one would match almost every title`,
    };
  }
  if (length > TEST_MARKER_MAX) {
    return { refused: `marker is at most ${TEST_MARKER_MAX} characters` };
  }
  return { marker };
}
