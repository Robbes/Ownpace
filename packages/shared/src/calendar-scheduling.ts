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

/**
 * THE TARGETS THAT MAIL GUESTS WHATEVER THE MARKER SAYS (workplan 0160).
 *
 * `neutraliseScheduling` rests on RFC 6638 §7.1: a server handed
 * `SCHEDULE-AGENT=CLIENT` stores the property and sends nothing. Cirrux's
 * CalDAV server does not honour it. On 2026-11-19 the first calendar pass
 * into a Cirrux test mailbox wrote events with every attendee and organiser
 * marked so, and Cirrux mailed invitations for them, past events included
 * (the owner's report that day). For a target kind named here, the writer
 * keeps no ATTENDEE and no ORGANIZER at all (`withoutGuests`): with nobody
 * invited, a server has nobody to mail.
 *
 * One kind is here: Cirrux, on the evidence of the invitations it sent. A
 * kind leaves this list on the evidence of a pass that sent none, or by a
 * decision dated in ADR-0043.
 *
 * Infomaniak is not here. It was, untested, from the day its kind arrived
 * (workplan 0161) to 2026-11-20, when ADR-0043's amendment of that day took
 * it off: its copies are written as Nextcloud's are, with their guests and
 * organiser, each marked `SCHEDULE-AGENT=CLIENT`. Its CalDAV server is
 * SabreDAV (`sync.infomaniak.com` answers with
 * `WWW-Authenticate: Basic realm="sabre/dav"`, read 2026-11-19), which in
 * Nextcloud was seen to honour the marker (workplan 0103); what Infomaniak's
 * does with it has not been seen, and an invitation it might send cannot be
 * taken back. Mail seen at Infomaniak (0161 T2) puts it back here, as a kind
 * seen mailing guests.
 */
export const TARGETS_THAT_MAIL_GUESTS: ReadonlySet<string> = new Set(['cirrux']);

/** Does a target of this kind send invitations itself, whatever SCHEDULE-AGENT says? */
export function mailsGuestsItself(kind: string | undefined): boolean {
  return kind !== undefined && TARGETS_THAT_MAIL_GUESTS.has(kind);
}

/**
 * The kinds on `TARGETS_THAT_MAIL_GUESTS` because nobody has tested them, not
 * because they were seen to mail guests (workplan 0161). The writer treats
 * the two alike; what a person reads does not. A connection test, an
 * assessment or an audit row about such a target says that it has not been
 * tested, and never that it emails guests, which nobody has seen it do. A
 * kind leaves this set when it leaves the list, or when a pass shows it mails
 * guests after all.
 *
 * Empty since 2026-11-20, when Infomaniak, the one kind it held, left both
 * (ADR-0043). Kept, with its reader, for the next kind that arrives untested.
 */
export const TARGETS_UNTESTED_FOR_GUESTS: ReadonlySet<string> = new Set<string>();

/** Is this kind kept without guests because it is untested, rather than because it mailed them? */
export function guestsUntestedAt(kind: string | undefined): boolean {
  return kind !== undefined && TARGETS_UNTESTED_FOR_GUESTS.has(kind);
}

/**
 * An iCalendar text with nobody invited, for a target in
 * `TARGETS_THAT_MAIL_GUESTS`.
 *
 * Every ATTENDEE and ORGANIZER of an event or a task is replaced, where it
 * stood, by a COMMENT that names the person ("Invited at the source: Name
 * <address>", "Organised at the source by: …"), so the copy still says who
 * was there and a server has no one to send anything to. COMMENT is allowed
 * in every component that may carry the two (RFC 5545 §3.8.1.4), and it is
 * not fingerprinted: `calendarContentHash` reads UID, SUMMARY, DESCRIPTION
 * and LOCATION only, so verification compares the copy with its source as
 * it always did. The description is left as the source wrote it for the
 * same reason.
 *
 * An ATTENDEE inside a VALARM is who an email alarm goes to, not a guest,
 * and is left alone: the alarm would be invalid without it.
 *
 * Lines this does not replace are kept byte for byte, folds and line ends
 * included. A replaced line is emitted unfolded, as `neutraliseScheduling`
 * emits a rewritten one.
 */
export function withoutGuests(icalendar: string): string {
  const out: string[] = [];
  for (const { span, logical, inAlarm } of propertiesOf(icalendar)) {
    if (!inAlarm && PROPERTY_START.test(logical)) {
      const last = span[span.length - 1]!;
      const eol = /\r\n$/.test(last) ? '\r\n' : /\n$/.test(last) ? '\n' : '';
      out.push(`COMMENT:${escapeText(guestNote(logical))}${eol}`);
    } else {
      out.push(...span);
    }
  }
  return out.join('');
}

/**
 * Does this copy still list a guest, for a target in `TARGETS_THAT_MAIL_GUESTS`
 * (workplan 0160, 2026-11-19)?
 *
 * True when any ATTENDEE stands outside a VALARM. The writer asks it of the
 * copy a target ALREADY HOLDS before it rewrites or deletes that copy, because
 * the change itself is what gets mailed. Cirrux mails a guest a cancellation
 * (`METHOD:CANCEL`) when they are taken off an event, and when the event is
 * deleted: a test of each on 2026-11-19 mailed one. A rewrite through
 * `withoutGuests` takes every guest off at once, so an event written before
 * the guests came out (#1947) would mail all of them. So such a copy is left
 * exactly as it is.
 *
 * An ORGANIZER alone is not a guest: with nobody invited there is nobody to
 * mail. A COMMENT naming one (what `withoutGuests` writes) is not either. An
 * ATTENDEE inside a VALARM is who an email alarm goes to, as above.
 */
export function namesGuests(icalendar: string): boolean {
  for (const { logical, inAlarm } of propertiesOf(icalendar)) {
    if (!inAlarm && /^ATTENDEE(?=[;:])/i.test(logical)) return true;
  }
  return false;
}

/**
 * Each property of an iCalendar text, in order: its physical lines as they
 * stand (`span`), the property unfolded (`logical`), and whether it is inside
 * a VALARM.
 */
function* propertiesOf(
  icalendar: string,
): Generator<{ readonly span: string[]; readonly logical: string; readonly inAlarm: boolean }> {
  const lines = icalendar.split(/(?<=\n)/);
  let alarms = 0;
  let i = 0;
  while (i < lines.length) {
    const span = [lines[i]!];
    let j = i + 1;
    while (j < lines.length && /^[ \t]/.test(lines[j]!)) {
      span.push(lines[j]!);
      j += 1;
    }
    const logical = span
      .map((l) => l.replace(/\r?\n$/, ''))
      .map((l, k) => (k === 0 ? l : l.slice(1)))
      .join('');
    if (/^BEGIN:VALARM\s*$/i.test(logical)) alarms += 1;
    else if (/^END:VALARM\s*$/i.test(logical)) alarms = Math.max(0, alarms - 1);
    yield { span, logical, inAlarm: alarms > 0 };
    i = j;
  }
}

/** "Invited at the source: Name <address>" for one unfolded ATTENDEE or ORGANIZER line. */
function guestNote(logical: string): string {
  const organiser = /^ORGANIZER/i.test(logical);
  // The value starts at the first colon outside a quoted parameter value.
  let quoted = false;
  let colon = -1;
  for (let k = 0; k < logical.length; k += 1) {
    const ch = logical[k];
    if (ch === '"') quoted = !quoted;
    else if (ch === ':' && !quoted) {
      colon = k;
      break;
    }
  }
  const head = colon === -1 ? logical : logical.slice(0, colon);
  const value = colon === -1 ? '' : logical.slice(colon + 1).trim();
  const param = (key: string): string =>
    (new RegExp(`;${key}=(?:"([^"]*)"|([^;:]*))`, 'i').exec(head)?.slice(1).find((v) => v !== undefined) ?? '').trim();
  const name = param('CN');
  // A mailto: value is the address. Any other value (a urn:uuid:, say) is
  // not one, and RFC 7986's EMAIL parameter, where the source gave it, is.
  const address = /^mailto:/i.test(value) ? value.slice('mailto:'.length).trim() : param('EMAIL') || value;
  // A source that wrote the address as the name too is named once.
  const who =
    name && address && name.toLowerCase() !== address.toLowerCase()
      ? `${name} <${address}>`
      : address || name || 'someone unnamed';
  return `${organiser ? 'Organised at the source by' : 'Invited at the source'}: ${who}`;
}

/** RFC 5545 §3.3.11 TEXT: backslash, semicolon, comma and newline escaped. */
function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
