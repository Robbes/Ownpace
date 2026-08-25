// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MAIL A MIGRATION MUST NOT SEND (workplan 0103 T1, ADR-0043).
 *
 * RFC 6638 makes a scheduling-enabled CalDAV server act on every `ATTENDEE`
 * of a calendar object it is handed: the `SCHEDULE-AGENT` parameter decides
 * who delivers the scheduling messages, and its default is `SERVER`. So a
 * migration that PUTs a mailbox's history verbatim is, from the server's
 * point of view, ORGANISING years of meetings — every attendee of every
 * event can be re-invited, and deleting an organiser's copy later (take-back,
 * gated apply-deletion) fans out CANCEL by the same rule.
 *
 * This transform sets `SCHEDULE-AGENT=CLIENT` on every `ATTENDEE` and
 * `ORGANIZER` property, which RFC 6638 §7.1 defines as "the client is the
 * scheduling agent" — the server stores the property and sends nothing.
 * An explicit `SCHEDULE-AGENT=SERVER` in the source is rewritten to `CLIENT`
 * too: it was true on the system the event lived on, and carrying it into
 * the target would re-fire invitations years after the fact. Explicit
 * `CLIENT` and `NONE` are left byte-for-byte alone.
 *
 * WHY THIS CANNOT DISTURB CHANGE DETECTION: `calendarContentHash` is a
 * canonical fingerprint over `['UID','SUMMARY','DESCRIPTION','LOCATION']`
 * (dav-canonical.ts) — attendees are not fingerprinted at all, let alone
 * their parameters. The invariant is pinned by a test beside this file, so
 * the day somebody widens the fingerprint set the consequence has a name.
 *
 * FOLDING. iCalendar lines may be folded (CRLF + space/tab continuation),
 * and a parameter token can legally be split across the fold. Detection
 * therefore looks at the UNFOLDED logical property; injection happens on the
 * first physical line, immediately after the property name, which a fold
 * cannot have split in any output seen in the wild (a name split by folding
 * is passed through untouched rather than guessed at — the 0103 T2 gate is
 * what would catch that pathology's consequence).
 */

const PROPERTY_START = /^(ATTENDEE|ORGANIZER)(?=[;:])/i;

/** Set SCHEDULE-AGENT=CLIENT on every ATTENDEE/ORGANIZER of an iCalendar text. */
export function neutraliseScheduling(icalendar: string): string {
  // Split KEEPING each line's own terminator, so the join is byte-faithful
  // for everything this function does not deliberately touch.
  const lines = icalendar.split(/(?<=\n)/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!PROPERTY_START.test(line)) {
      out.push(line);
      i += 1;
      continue;
    }
    // The logical property: this line plus its folded continuations.
    const span = [line];
    let j = i + 1;
    while (j < lines.length && /^[ \t]/.test(lines[j]!)) {
      span.push(lines[j]!);
      j += 1;
    }
    const logical = span
      .map((l) => l.replace(/\r?\n$/, ''))
      .map((l, k) => (k === 0 ? l : l.slice(1)))
      .join('');

    if (/SCHEDULE-AGENT=SERVER/i.test(logical)) {
      // Rewritten, and emitted UNFOLDED: the token may sit across a fold, and
      // re-folding would be guesswork. A long line is legal iCalendar (75
      // octets is a SHOULD); servers re-fold on storage anyway.
      const last = span[span.length - 1]!;
      const eol = /\r\n$/.test(last) ? '\r\n' : /\n$/.test(last) ? '\n' : '';
      out.push(logical.replace(/SCHEDULE-AGENT=SERVER/i, 'SCHEDULE-AGENT=CLIENT') + eol);
    } else if (/SCHEDULE-AGENT=/i.test(logical)) {
      // Explicit CLIENT or NONE: the source already said, byte-for-byte kept.
      out.push(...span);
    } else {
      out.push(span[0]!.replace(PROPERTY_START, (m) => `${m};SCHEDULE-AGENT=CLIENT`), ...span.slice(1));
    }
    i = j;
  }
  return out.join('');
}
