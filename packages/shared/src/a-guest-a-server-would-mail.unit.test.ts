// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * NOBODY INVITED, FOR A SERVER THAT MAILS GUESTS WHATEVER THE MARKER SAYS
 * (workplan 0160).
 *
 * On 2026-11-19 Cirrux mailed invitations for migrated events whose every
 * attendee carried `SCHEDULE-AGENT=CLIENT`. `withoutGuests` is what a writer
 * for such a target sends instead: no ATTENDEE, no ORGANIZER, and a COMMENT
 * where each stood, so the copy still says who was there.
 */

import { describe, it, expect } from 'vitest';
import {
  TARGETS_THAT_MAIL_GUESTS,
  TARGETS_UNTESTED_FOR_GUESTS,
  guestsUntestedAt,
  mailsGuestsItself,
  namesGuests,
  neutraliseScheduling,
  withoutGuests,
} from './calendar-scheduling.ts';
import { calendarContentHash } from './hash.ts';

const wrap = (lines: string[], component = 'VEVENT', eol = '\r\n'): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `BEGIN:${component}`,
    'UID:evt-1',
    'SUMMARY:Birthday',
    'DESCRIPTION:A day to remember',
    ...lines,
    `END:${component}`,
    'END:VCALENDAR',
  ].join(eol) + eol;

describe('withoutGuests', () => {
  it('replaces an attendee with a comment that names them', () => {
    const out = withoutGuests(wrap(['ATTENDEE;CN=Some One;PARTSTAT=ACCEPTED:mailto:one@example.org']));
    expect(out).not.toMatch(/^ATTENDEE/m);
    expect(out).toContain('COMMENT:Invited at the source: Some One <one@example.org>\r\n');
  });

  it('replaces the organiser too, which a server would mail a reply or a cancellation for', () => {
    const out = withoutGuests(wrap(['ORGANIZER;CN=The Boss:mailto:boss@example.org']));
    expect(out).not.toMatch(/^ORGANIZER/m);
    expect(out).toContain('COMMENT:Organised at the source by: The Boss <boss@example.org>\r\n');
  });

  it('replaces every attendee, not only the first', () => {
    const out = withoutGuests(
      wrap(['ATTENDEE:mailto:a@example.org', 'ATTENDEE:mailto:b@example.org', 'ATTENDEE:mailto:c@example.org']),
    );
    expect(out).not.toMatch(/ATTENDEE/);
    expect(out.match(/^COMMENT:Invited at the source: /gm)).toHaveLength(3);
  });

  it('takes a folded attendee whole, leaving no continuation behind', () => {
    const out = withoutGuests(wrap(['ATTENDEE;CN=A Very Long Name Indeed;PARTSTAT=NEEDS-ACT', ' ION:mailto:long@example.org']));
    expect(out).not.toMatch(/^ ION/m);
    expect(out).toContain('COMMENT:Invited at the source: A Very Long Name Indeed <long@example.org>\r\n');
  });

  it('reads a quoted name with a colon, comma and semicolon in it, and escapes it as text', () => {
    const out = withoutGuests(wrap(['ATTENDEE;CN="Doe, Jane; Dr: PhD":mailto:jane@example.org']));
    expect(out).toContain('COMMENT:Invited at the source: Doe\\, Jane\\; Dr: PhD <jane@example.org>\r\n');
  });

  it('names an attendee without a name by address, and one with neither as someone unnamed', () => {
    const out = withoutGuests(wrap(['ATTENDEE:mailto:bare@example.org', 'ATTENDEE;CN=']));
    expect(out).toContain('COMMENT:Invited at the source: bare@example.org\r\n');
    expect(out).toContain('COMMENT:Invited at the source: someone unnamed\r\n');
  });

  it('names a guest once when the source wrote the address as the name too', () => {
    const out = withoutGuests(wrap(['ATTENDEE;CN=one@example.org:mailto:one@example.org']));
    expect(out).toContain('COMMENT:Invited at the source: one@example.org\r\n');
  });

  it('takes the address from EMAIL when the value is not a mailto', () => {
    const out = withoutGuests(wrap(['ATTENDEE;CN=Sam;EMAIL=sam@example.org:urn:uuid:5f0c1d2e-0000-4000-8000-000000000001']));
    expect(out).toContain('COMMENT:Invited at the source: Sam <sam@example.org>\r\n');
  });

  it('leaves nobody to invite in the shape Cirrux mailed an invitation for on 2026-11-19', () => {
    // Shaped from the invitation's own attachment, with the people and the
    // place replaced: a meeting from 2019 that an outside organiser invited
    // the source account to, the account its only attendee, every line folded
    // as Outlook and Google fold them, and Outlook's own properties beside.
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:040000008200E00074C5B7101A82E0080000000090FC4EF6D05DD501000000000000000',
      ' 0100000001FD8818F7B952A44B4A2085E1EA897DE',
      'DTSTART;TZID=Europe/Amsterdam:20191118T090000',
      'DTEND;TZID=Europe/Amsterdam:20191118T170000',
      'SUMMARY:A course',
      'LOCATION:Somewhere 1\\, Sometown',
      'ORGANIZER;CN=An Outside Organiser | Their Firm;EMAIL=organiser@example.org:ma',
      ' ilto:organiser@example.org',
      'RRULE:FREQ=WEEKLY;COUNT=2;INTERVAL=1;BYDAY=MO;WKST=SU',
      'ATTENDEE;CN=me@example.net;EMAIL=me@example.net;PARTSTAT=ACCEPTED;RSVP=FALSE',
      ' ;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL:mailto:me@example.net',
      'X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    const out = withoutGuests(ics);
    expect(out).not.toMatch(/^(ATTENDEE|ORGANIZER)/m);
    expect(out).not.toMatch(/^ (ilto|;ROLE)/m);
    expect(out).toContain('COMMENT:Organised at the source by: An Outside Organiser | Their Firm <organiser@example.org>\r\n');
    expect(out).toContain('COMMENT:Invited at the source: me@example.net\r\n');
    // Everything else the event said arrives as it was.
    for (const line of ['RRULE:FREQ=WEEKLY;COUNT=2;INTERVAL=1;BYDAY=MO;WKST=SU', 'X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE', ' 0100000001FD8818F7B952A44B4A2085E1EA897DE']) {
      expect(out).toContain(`${line}\r\n`);
    }
    expect(calendarContentHash(out)).toBe(calendarContentHash(ics));
  });

  it("leaves an email alarm's attendee alone: it is who the alarm goes to, and the alarm needs it", () => {
    const alarm = ['BEGIN:VALARM', 'ACTION:EMAIL', 'ATTENDEE:mailto:me@example.org', 'END:VALARM'];
    const out = withoutGuests(wrap(['ATTENDEE:mailto:guest@example.org', ...alarm]));
    expect(out).toContain('BEGIN:VALARM\r\nACTION:EMAIL\r\nATTENDEE:mailto:me@example.org\r\nEND:VALARM\r\n');
    expect(out).toContain('COMMENT:Invited at the source: guest@example.org\r\n');
    expect(out).not.toContain('ATTENDEE:mailto:guest@example.org');
  });

  it('does the same in a task', () => {
    const out = withoutGuests(wrap(['ATTENDEE:mailto:helper@example.org'], 'VTODO'));
    expect(out).toContain('BEGIN:VTODO');
    expect(out).toContain('COMMENT:Invited at the source: helper@example.org\r\n');
    expect(out).not.toMatch(/^ATTENDEE/m);
  });

  it('keeps every other line byte for byte, and LF line ends as LF', () => {
    const ics = wrap(['ATTENDEE:mailto:a@example.org', 'LOCATION:Home'], 'VEVENT', '\n');
    const out = withoutGuests(ics);
    expect(out).toBe(ics.replace('ATTENDEE:mailto:a@example.org\n', 'COMMENT:Invited at the source: a@example.org\n'));
  });

  it('hands back an event without guests unchanged', () => {
    const ics = wrap(['LOCATION:Home']);
    expect(withoutGuests(ics)).toBe(ics);
  });

  it('leaves the fingerprint verification compares as it was', () => {
    const ics = wrap(['ORGANIZER:mailto:boss@example.org', 'ATTENDEE;CN=Some One:mailto:one@example.org']);
    expect(calendarContentHash(withoutGuests(ics))).toBe(calendarContentHash(ics));
  });

  it('leaves the marker nothing to mark', () => {
    const out = neutraliseScheduling(withoutGuests(wrap(['ATTENDEE:mailto:a@example.org'])));
    expect(out).not.toMatch(/SCHEDULE-AGENT/);
  });
});

describe('namesGuests: does the copy a target holds still list a guest?', () => {
  // Asked before a rewrite or a delete at a target that mails guests: Cirrux
  // mailed a cancellation when a guest was taken off, and when the event was
  // deleted (a test of each on 2026-11-19).
  it('says yes for an attendee, in the shape Cirrux keeps one', () => {
    expect(namesGuests(wrap(['ORGANIZER;CN=Someone:mailto:owner@example.org', 'ATTENDEE:mailto:guest@example.org']))).toBe(true);
  });

  it('says yes for an attendee whose line is folded, and in any letter case', () => {
    expect(namesGuests(wrap(['ATTENDEE;CN=A Very Long Name Indeed;PARTSTAT=NEEDS-ACT', ' ION:mailto:long@example.org']))).toBe(true);
    expect(namesGuests(wrap(['attendee;cn=Lower:mailto:lower@example.org']))).toBe(true);
  });

  it('says yes in a task, and with LF line ends', () => {
    expect(namesGuests(wrap(['ATTENDEE:mailto:helper@example.org'], 'VTODO'))).toBe(true);
    expect(namesGuests(wrap(['ATTENDEE:mailto:a@example.org'], 'VEVENT', '\n'))).toBe(true);
  });

  it('says no for what withoutGuests wrote: nobody is left to mail', () => {
    const written = withoutGuests(wrap(['ORGANIZER:mailto:boss@example.org', 'ATTENDEE;CN=Some One:mailto:one@example.org']));
    expect(namesGuests(written)).toBe(false);
    expect(namesGuests(neutraliseScheduling(written))).toBe(false);
  });

  it("says no for an organiser alone, and for an email alarm's attendee, which is who the alarm goes to", () => {
    expect(namesGuests(wrap(['ORGANIZER;CN=The Boss:mailto:boss@example.org']))).toBe(false);
    const alarm = ['BEGIN:VALARM', 'ACTION:EMAIL', 'ATTENDEE:mailto:me@example.org', 'END:VALARM'];
    expect(namesGuests(wrap(alarm))).toBe(false);
    // Out of the alarm again, a guest is a guest.
    expect(namesGuests(wrap([...alarm, 'ATTENDEE:mailto:guest@example.org']))).toBe(true);
  });

  it('says no for a property that only begins with the word, or text that mentions it', () => {
    expect(namesGuests(wrap(['X-ATTENDEE-COUNT:3', 'ATTENDEES-NOTE:none', 'COMMENT:Invited at the source: ATTENDEE:mailto:x@example.org']))).toBe(false);
    // A folded continuation is part of the line before it, never a property.
    expect(namesGuests(wrap(['DESCRIPTION:See the list', ' ATTENDEE:mailto:x@example.org']))).toBe(false);
  });

  it('says no for an event without guests', () => {
    expect(namesGuests(wrap(['LOCATION:Home']))).toBe(false);
  });
});

describe('mailsGuestsItself', () => {
  it('names Cirrux, which mailed guests, and no target it has no evidence against but Infomaniak', () => {
    expect(mailsGuestsItself('cirrux')).toBe(true);
    for (const kind of ['nextcloud', 'caldav', 'soverin', undefined]) {
      expect(mailsGuestsItself(kind), String(kind)).toBe(false);
    }
  });

  it('names Infomaniak from the day its kind arrives, because no pass has shown it sends nothing (0161)', () => {
    // Not on evidence of an invitation, as Cirrux was: on the absence of a
    // test. Its SabreDAV may honour SCHEDULE-AGENT=CLIENT, as Nextcloud's
    // does; nobody has seen it, and an invitation sent cannot be taken back.
    // 0161 T2's pass is what may take it off the list.
    expect(mailsGuestsItself('infomaniak')).toBe(true);
    // On the list as untested, and said to be so: never said to mail guests.
    expect(guestsUntestedAt('infomaniak')).toBe(true);
    expect(guestsUntestedAt('cirrux')).toBe(false);
  });

  it('every kind kept guestless as untested is on the list the writers read', () => {
    // The untested set only changes what a person reads; the writers read the
    // list. A kind in the first and not the second would be said to be kept
    // without guests while its guests were written.
    for (const kind of TARGETS_UNTESTED_FOR_GUESTS) {
      expect(TARGETS_THAT_MAIL_GUESTS.has(kind), kind).toBe(true);
    }
  });
});
