// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The neutraliser that keeps a migration from organising old meetings
 * (workplan 0103 T1, ADR-0043). Each rule here was proved by breaking the
 * transform; the last one is the invariant that makes the whole approach
 * safe against change detection, pinned so widening the fingerprint set has
 * a named consequence.
 */

import { describe, it, expect } from 'vitest';
import { neutraliseScheduling } from './calendar-scheduling.ts';
import { calendarContentHash } from './hash.ts';

const wrap = (lines: string[]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:evt-1', ...lines, 'END:VEVENT', 'END:VCALENDAR'].join(
    '\r\n',
  ) + '\r\n';

describe('neutraliseScheduling', () => {
  it('sets SCHEDULE-AGENT=CLIENT on a bare ATTENDEE, right after the name', () => {
    const out = neutraliseScheduling(wrap(['ATTENDEE;CN=Someone:mailto:a@example.com']));
    expect(out).toContain('ATTENDEE;SCHEDULE-AGENT=CLIENT;CN=Someone:mailto:a@example.com');
  });

  it('neutralises ORGANIZER too — the property that makes DELETE send CANCEL', () => {
    const out = neutraliseScheduling(wrap(['ORGANIZER:mailto:boss@example.com']));
    expect(out).toContain('ORGANIZER;SCHEDULE-AGENT=CLIENT:mailto:boss@example.com');
  });

  it('touches every attendee, not just the first', () => {
    const out = neutraliseScheduling(
      wrap(['ATTENDEE:mailto:a@example.com', 'ATTENDEE:mailto:b@example.com', 'ATTENDEE:mailto:c@example.com']),
    );
    expect(out.match(/SCHEDULE-AGENT=CLIENT/g)).toHaveLength(3);
  });

  it('rewrites an explicit SERVER — true where the event lived, a re-invite here', () => {
    const out = neutraliseScheduling(wrap(['ATTENDEE;SCHEDULE-AGENT=SERVER:mailto:a@example.com']));
    expect(out).toContain('SCHEDULE-AGENT=CLIENT');
    expect(out).not.toMatch(/SCHEDULE-AGENT=SERVER/);
  });

  it('leaves an explicit CLIENT byte-for-byte alone', () => {
    const ics = wrap(['ATTENDEE;SCHEDULE-AGENT=CLIENT:mailto:a@example.com']);
    expect(neutraliseScheduling(ics)).toBe(ics);
  });

  it('leaves an explicit NONE alone — the source forbade scheduling outright', () => {
    const ics = wrap(['ATTENDEE;SCHEDULE-AGENT=NONE:mailto:a@example.com']);
    expect(neutraliseScheduling(ics)).toBe(ics);
  });

  it('sees a parameter hidden on a folded continuation — no double injection', () => {
    const ics = wrap(['ATTENDEE;CN=A Very Long Name Indeed;', ' SCHEDULE-AGENT=CLIENT:mailto:a@example.com']);
    expect(neutraliseScheduling(ics)).toBe(ics);
  });

  it('finds a SERVER token split across the fold, and unfolds to rewrite it', () => {
    const out = neutraliseScheduling(wrap(['ATTENDEE;SCHEDULE-AG', ' ENT=SERVER:mailto:a@example.com']));
    expect(out).toContain('ATTENDEE;SCHEDULE-AGENT=CLIENT:mailto:a@example.com');
  });

  it('handles lowercase property names — the spec is case-insensitive', () => {
    const out = neutraliseScheduling(wrap(['attendee:mailto:a@example.com']));
    expect(out).toContain('attendee;SCHEDULE-AGENT=CLIENT:mailto:a@example.com');
  });

  it('does not mistake a DESCRIPTION mentioning ATTENDEE for the property', () => {
    const ics = wrap(['DESCRIPTION:Mail the ATTENDEE list first', 'SUMMARY:planning']);
    expect(neutraliseScheduling(ics)).toBe(ics);
  });

  it('is idempotent — the writer may run over its own output', () => {
    const once = neutraliseScheduling(wrap(['ATTENDEE:mailto:a@example.com', 'ORGANIZER:mailto:o@example.com']));
    expect(neutraliseScheduling(once)).toBe(once);
  });

  it('preserves CRLF endings and everything it did not touch', () => {
    const ics = wrap(['DTSTART:20270101T100000Z', 'ATTENDEE:mailto:a@example.com', 'SUMMARY:x']);
    const out = neutraliseScheduling(ics);
    expect(out).toContain('DTSTART:20270101T100000Z\r\n');
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  /**
   * THE INVARIANT THE WHOLE APPROACH RESTS ON. calendarContentHash is a
   * canonical fingerprint over UID/SUMMARY/DESCRIPTION/LOCATION — attendees
   * and their parameters are not in it, so neutralising cannot make an
   * unchanged event look changed (ledger) or a healthy copy look corrupt
   * (verification). If this test ever fails, somebody widened the
   * fingerprint set: the transform must then be applied on the source side
   * of every comparison before this ships.
   */
  it('never changes the content fingerprint', () => {
    const ics = wrap([
      'SUMMARY:Quarterly planning',
      'DESCRIPTION:Bring the numbers',
      'LOCATION:Room 4',
      'ORGANIZER:mailto:boss@example.com',
      'ATTENDEE;SCHEDULE-AGENT=SERVER:mailto:a@example.com',
      'ATTENDEE:mailto:b@example.com',
    ]);
    expect(calendarContentHash(neutraliseScheduling(ics))).toBe(calendarContentHash(ics));
  });
});
