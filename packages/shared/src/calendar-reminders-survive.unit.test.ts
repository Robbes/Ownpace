// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A migrated event keeps its reminders.
 *
 * Asked 2026-09-03: does a VALARM survive the copy? Nothing in the repository
 * mentioned the component, so the answer had to be traced rather than looked
 * up — and it is YES, by construction rather than by intent:
 *
 *   runCalendarSync  fetchRaw  -> { item, icalendar }   the source's own bytes
 *   caldav-target-writer       -> body: neutraliseScheduling(raw.icalendar)
 *
 * The writer PUTs the SOURCE TEXT. It never reserialises from the parsed
 * `CalendarEvent`, and `neutraliseScheduling` is a line-level transform whose
 * only trigger is `/^(ATTENDEE|ORGANIZER)(?=[;:])/i` — every other line,
 * including the whole BEGIN:VALARM…END:VALARM block, is pushed through
 * byte-faithfully.
 *
 * ## Why this needs a test if it already works
 *
 * Because the correctness is INCIDENTAL and the failure would be silent.
 * `CalendarEvent.reminders` exists and is far thinner than a real VALARM —
 * `{ action, triggerSeconds, description }`, with no REPEAT, no DURATION, no
 * ATTACH, no ACTION:EMAIL recipients, and no way to hold two alarms that
 * differ in anything else. Anyone "tidying" the writer to build its body from
 * the model instead of the source text would drop every one of those from
 * every migrated event, and no existing test would notice: the natural key is
 * the UID, and `calendarContentHash` fingerprints UID/SUMMARY/DESCRIPTION/
 * LOCATION only — so a reminder-stripped copy hashes identical to the
 * original and verifies clean.
 *
 * That is the same shape as workplan 0113's seventh fan-out: not an omission
 * that shows, but a wrong answer that reports success.
 */

import { describe, it, expect } from 'vitest';
import { neutraliseScheduling } from './calendar-scheduling.ts';

/** One event, one display reminder fifteen minutes before it. */
const EVENT_WITH_ALARM = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:reminder-1@example.org',
  'DTSTART:20260910T090000Z',
  'SUMMARY:Dentist',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'DESCRIPTION:Dentist in 15 minutes',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

describe('a VALARM survives the copy', () => {
  it('passes through byte-for-byte when the event has no attendees', () => {
    // The strongest statement available: the transform is the ONLY thing
    // between the source bytes and the PUT body, so identity here IS fidelity.
    expect(neutraliseScheduling(EVENT_WITH_ALARM)).toBe(EVENT_WITH_ALARM);
  });

  it('keeps every line of the alarm block', () => {
    const out = neutraliseScheduling(EVENT_WITH_ALARM);
    for (const line of ['BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'END:VALARM']) {
      expect(out).toContain(line);
    }
  });

  it('keeps the alarm when the EVENT has attendees the transform does rewrite', () => {
    // The realistic case: a meeting with attendees AND a reminder. The
    // attendee line is neutered (0103 T1 / ADR-0043, so the target does not
    // email everyone), and the alarm beside it must be untouched.
    const meeting = EVENT_WITH_ALARM.replace(
      'SUMMARY:Dentist',
      'SUMMARY:Standup\r\nATTENDEE;CN=Rob:mailto:rob@example.org',
    );
    const out = neutraliseScheduling(meeting);
    expect(out).toContain('ATTENDEE;SCHEDULE-AGENT=CLIENT;CN=Rob:mailto:rob@example.org');
    expect(out).toContain('BEGIN:VALARM');
    expect(out).toContain('TRIGGER:-PT15M');
  });

  it('keeps SEVERAL alarms, which the CalendarEvent model cannot represent', () => {
    // Two alarms differing in more than the model's three fields. A body built
    // from `CalendarEvent.reminders` could not reproduce this; the raw copy
    // does it without knowing what an alarm is.
    const two = EVENT_WITH_ALARM.replace(
      'END:VEVENT',
      [
        'BEGIN:VALARM',
        'ACTION:AUDIO',
        'TRIGGER;RELATED=END:PT0S',
        'REPEAT:3',
        'DURATION:PT5M',
        'ATTACH;FMTTYPE=audio/basic:ftp://example.org/ring.au',
        'END:VALARM',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const out = neutraliseScheduling(two);
    expect(out.match(/BEGIN:VALARM/g)).toHaveLength(2);
    for (const line of ['REPEAT:3', 'DURATION:PT5M', 'TRIGGER;RELATED=END:PT0S']) {
      expect(out).toContain(line);
    }
    expect(out).toContain('ATTACH;FMTTYPE=audio/basic:ftp://example.org/ring.au');
  });

  it("keeps a TASK's reminder too — a VTODO may carry a VALARM (RFC 5545 §3.6.2)", () => {
    // Newly load-bearing since workplan 0113: `runTaskSync` writes through the
    // same CalDAV writer and the same transform, so a to-do's due-date
    // reminder travels by the same route as an event's.
    const todo = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VTODO',
      'UID:task-with-alarm@example.org',
      'DUE:20260912T170000Z',
      'SUMMARY:File the VAT return',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'TRIGGER;RELATED=START:-P1D',
      'DESCRIPTION:VAT return due tomorrow',
      'END:VALARM',
      'END:VTODO',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    expect(neutraliseScheduling(todo)).toBe(todo);
  });

  it('an ACTION:EMAIL alarm keeps its recipients, and they are neutered too', () => {
    // KNOWN AND DELIBERATE, pinned so it is a decision rather than a surprise.
    //
    // A VALARM with ACTION:EMAIL carries its OWN ATTENDEE lines — the people
    // to mail — and the transform matches on the property name wherever it
    // appears, so those get SCHEDULE-AGENT=CLIENT as well. RFC 6638 defines
    // that parameter for an event's attendees rather than an alarm's, so this
    // is one byte-string the source did not have.
    //
    // Kept rather than special-cased, for two reasons. It points the same way
    // as ADR-0043 — a migration must not make a server send mail to real
    // people about copied data — and an unrecognised parameter is exactly what
    // RFC 5545 §3.2 tells a parser to ignore. The recipient address itself,
    // which is the part that matters, is preserved intact.
    const emailAlarm = EVENT_WITH_ALARM.replace(
      'DESCRIPTION:Dentist in 15 minutes',
      'DESCRIPTION:Dentist in 15 minutes\r\nATTENDEE:mailto:rob@example.org',
    ).replace('ACTION:DISPLAY', 'ACTION:EMAIL');

    const out = neutraliseScheduling(emailAlarm);
    expect(out).toContain('ACTION:EMAIL');
    expect(out).toContain('mailto:rob@example.org');
    expect(out).toContain('ATTENDEE;SCHEDULE-AGENT=CLIENT:mailto:rob@example.org');
  });
});
