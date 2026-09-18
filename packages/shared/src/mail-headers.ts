// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * READING ONE HEADER OUT OF AN RFC 5322 MESSAGE.
 *
 * Extracted from `generated-message-id.ts`, which had all of this private and
 * was for a year the only thing in this codebase that needed it. A second
 * caller arrived (the Subject a person recognises their mail by), and two
 * copies of a header parser is two answers to one question — the family of
 * defect this repository keeps meeting. So the parser moved here and the
 * Message-ID reader now asks it, rather than the two drifting on folding,
 * case, or where the header block ends.
 *
 * ## The three things that are easy to get wrong
 *
 * **Folding.** A long value is split across lines with the continuation
 * indented (§2.2.3). Reading only the first physical line truncates a
 * Message-ID and beheads a Subject, so the section is unfolded before the
 * match rather than after.
 *
 * **Where the headers stop.** A body can contain anything, including a line
 * that reads `Subject: …`. The scan is bounded at the blank line, and a
 * message with no blank line at all is all headers — which is what a
 * truncated fetch looks like, and reading its remains is better than reading
 * nothing.
 *
 * **Bytes, not text.** The section is decoded as latin1: headers are ASCII by
 * spec, every byte maps to exactly one character, and a UTF-8 body therefore
 * cannot corrupt the scan or shift an offset. Anything non-ASCII in a header
 * is RFC 2047 encoded-words, which `mail-subject.ts` decodes afterwards from
 * the ASCII this returns.
 */

/**
 * The header section as one latin1 string, bounded at the blank line.
 *
 * Exported because a caller reading several headers should decode once.
 */
export function headerSection(rfc822: Uint8Array): string {
  return Buffer.from(rfc822.subarray(0, findHeaderEnd(rfc822))).toString('latin1');
}

/**
 * One header's value, unfolded and trimmed, or undefined when absent or empty.
 *
 * The FIRST occurrence wins. A message with two Subject lines is malformed and
 * every mail client shows the first; agreeing with them beats inventing a rule.
 *
 * `name` is matched case-insensitively (§3.6.8 field names are
 * case-insensitive) and is taken as a literal, so a caller cannot pass a
 * pattern that turns this into a different search.
 */
export function headerValue(rfc822: Uint8Array, name: string): string | undefined {
  return headerValueIn(headerSection(rfc822), name);
}

/** The same read, over a section already decoded. */
export function headerValueIn(section: string, name: string): string | undefined {
  const unfolded = section.replace(/\r?\n[ \t]+/g, ' ');
  const pattern = new RegExp(`^${escapeForPattern(name)}[ \\t]*:(.*)$`, 'im');
  const value = pattern.exec(unfolded)?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** A field name as a literal — a caller's string is never a pattern. */
function escapeForPattern(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Offset of the blank line separating headers from body, or the whole length.
 *
 * Moved verbatim from `generated-message-id.ts`, including its tolerance of
 * reading one or two bytes past the end: `rfc822[i + 3]` on a short message is
 * `undefined`, which fails the comparison, which is the answer wanted.
 */
function findHeaderEnd(rfc822: Uint8Array): number {
  for (let i = 0; i + 1 < rfc822.length; i++) {
    // CRLFCRLF
    if (
      rfc822[i] === 0x0d &&
      rfc822[i + 1] === 0x0a &&
      rfc822[i + 2] === 0x0d &&
      rfc822[i + 3] === 0x0a
    ) {
      return i;
    }
    // LFLF (bare-LF messages, which real servers do produce)
    if (rfc822[i] === 0x0a && rfc822[i + 1] === 0x0a) return i;
  }
  return rfc822.length;
}
