// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The canonical fingerprint must survive everything a CalDAV/CardDAV server
 * does to what you store, and must still notice a real content change.
 *
 * Both halves matter equally. A fingerprint that changes when Nextcloud
 * refolds a line reports healthy events as corrupt and blocks cutover — the
 * reason byte hashing was withdrawn for these domains (#143). A fingerprint
 * that ignores too much passes a truncated copy, which is worse.
 *
 * The transformations below are the ones SabreDAV/Nextcloud actually perform.
 */

import { describe, it, expect } from 'vitest';
import {
  calendarFingerprint,
  contactFingerprint,
  sameFingerprintVersion,
  versionOf,
  CALENDAR_FINGERPRINT_VERSION,
  CONTACT_FINGERPRINT_VERSION,
} from './dav-canonical.ts';

const EVENT = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//OpenMig//E2ESeed//EN',
  'BEGIN:VEVENT',
  'UID:seed-event-1@dev.local',
  'DTSTAMP:20260101T000000Z',
  'DTSTART:20260110T100000Z',
  'DTEND:20260110T110000Z',
  'SUMMARY:Quarterly planning',
  'LOCATION:Room 3',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('calendarFingerprint — stable across a server round trip', () => {
  it('ignores property reordering', () => {
    const reordered = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpenMig//E2ESeed//EN',
      'BEGIN:VEVENT',
      'SUMMARY:Quarterly planning',
      'LOCATION:Room 3',
      'DTSTART:20260110T100000Z',
      'UID:seed-event-1@dev.local',
      'DTEND:20260110T110000Z',
      'DTSTAMP:20260101T000000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(calendarFingerprint(reordered)).toBe(calendarFingerprint(EVENT));
  });

  it("ignores the server's own PRODID, VERSION and X- properties", () => {
    const rewritten = EVENT.replace(
      'PRODID:-//OpenMig//E2ESeed//EN',
      'PRODID:-//SabreDAV//SabreDAV//EN\r\nX-WR-CALNAME:personal\r\nX-APPLE-CALENDAR-COLOR:#FF0000',
    );

    expect(calendarFingerprint(rewritten)).toBe(calendarFingerprint(EVENT));
  });

  it('ignores re-folding, at any width', () => {
    // RFC 5545 §3.1: a break plus one leading space is a continuation.
    const folded = EVENT.replace('SUMMARY:Quarterly planning', 'SUMMARY:Quarterly\r\n  planning');
    expect(calendarFingerprint(folded)).toBe(calendarFingerprint(EVENT));

    const foldedTight = EVENT.replace('SUMMARY:Quarterly planning', 'SUMMARY:Qua\r\n rterly\r\n  planning');
    expect(calendarFingerprint(foldedTight)).toBe(calendarFingerprint(EVENT));
  });

  it('ignores added or reordered parameters', () => {
    const parameterized = EVENT.replace('SUMMARY:Quarterly', 'SUMMARY;LANGUAGE=en-GB:Quarterly');
    expect(calendarFingerprint(parameterized)).toBe(calendarFingerprint(EVENT));
  });

  it('ignores line-ending style', () => {
    expect(calendarFingerprint(EVENT.replace(/\r\n/g, '\n'))).toBe(calendarFingerprint(EVENT));
  });

  it('ignores re-escaping of text values', () => {
    const escaped = calendarFingerprint(EVENT.replace('Room 3', 'Room 3\\; upstairs'));
    const unescaped = calendarFingerprint(EVENT.replace('Room 3', 'Room 3; upstairs'));
    expect(escaped).toBe(unescaped);
  });

  it('ignores timing properties, which servers legitimately rewrite', () => {
    // A server may store `DTSTART;TZID=Europe/Amsterdam:...10:00` as the
    // equivalent UTC instant. Same moment, different string. Comparing those
    // without a timezone database would report healthy events as corrupt, so
    // they are deliberately outside the fingerprint — see dav-canonical.ts.
    const shifted = EVENT.replace('DTSTART:20260110T100000Z', 'DTSTART;TZID=Europe/Amsterdam:20260110T110000');
    expect(calendarFingerprint(shifted)).toBe(calendarFingerprint(EVENT));
  });
});

describe('calendarFingerprint — still detects real change', () => {
  it('notices a changed summary', () => {
    expect(calendarFingerprint(EVENT.replace('Quarterly planning', 'Cancelled'))).not.toBe(
      calendarFingerprint(EVENT),
    );
  });

  it('notices a dropped property', () => {
    expect(calendarFingerprint(EVENT.replace('LOCATION:Room 3\r\n', ''))).not.toBe(
      calendarFingerprint(EVENT),
    );
  });

  it('notices a different event entirely', () => {
    expect(calendarFingerprint(EVENT.replace('seed-event-1@dev.local', 'seed-event-2@dev.local'))).not.toBe(
      calendarFingerprint(EVENT),
    );
  });

  it('notices truncation', () => {
    // The realistic corruption mode, and what a byte hash caught before it had
    // to be withdrawn.
    const truncated = EVENT.slice(0, EVENT.indexOf('SUMMARY'));
    expect(calendarFingerprint(truncated)).not.toBe(calendarFingerprint(EVENT));
  });

  it('notices an emptied body', () => {
    expect(calendarFingerprint('')).not.toBe(calendarFingerprint(EVENT));
  });
});

const CARD = [
  'BEGIN:VCARD',
  'VERSION:4.0',
  'UID:seed-contact-1@dev.local',
  'FN:Ada Lovelace',
  'EMAIL:ada@example.com',
  'TEL:+31201234567',
  'END:VCARD',
].join('\r\n');

describe('contactFingerprint', () => {
  it('ignores reordering, refolding and added parameters', () => {
    const rewritten = [
      'BEGIN:VCARD',
      'VERSION:4.0',
      'PRODID:-//SabreDAV//EN',
      'EMAIL;TYPE=INTERNET:ada@example.com',
      'FN:Ada\r\n  Lovelace',
      'TEL;TYPE=voice:+31201234567',
      'UID:seed-contact-1@dev.local',
      'REV:20260101T000000Z',
      'END:VCARD',
    ].join('\r\n');

    expect(contactFingerprint(rewritten)).toBe(contactFingerprint(CARD));
  });

  it('notices a changed name and a dropped email', () => {
    expect(contactFingerprint(CARD.replace('Ada Lovelace', 'Someone Else'))).not.toBe(
      contactFingerprint(CARD),
    );
    expect(contactFingerprint(CARD.replace('EMAIL:ada@example.com\r\n', ''))).not.toBe(
      contactFingerprint(CARD),
    );
  });
});

describe('fingerprint versioning', () => {
  it('tags every fingerprint', () => {
    expect(versionOf(calendarFingerprint(EVENT))).toBe(CALENDAR_FINGERPRINT_VERSION);
    expect(versionOf(contactFingerprint(CARD))).toBe(CONTACT_FINGERPRINT_VERSION);
  });

  it('an untagged legacy hash is not the same version as a tagged one', () => {
    // A ledger row written before this existed holds a bare sha256. Comparing
    // it against a fingerprint says nothing, and must be reported as unmeasured
    // rather than as corruption — otherwise upgrading mid-migration invents a
    // mismatch for every pre-upgrade item.
    const legacy = 'a'.repeat(64);
    expect(versionOf(legacy)).toBeUndefined();
    expect(sameFingerprintVersion(legacy, calendarFingerprint(EVENT))).toBe(false);
  });

  it('two fingerprints of the same generation are comparable', () => {
    expect(sameFingerprintVersion(calendarFingerprint(EVENT), calendarFingerprint(CARD))).toBe(true);
  });

  it('is deterministic', () => {
    expect(calendarFingerprint(EVENT)).toBe(calendarFingerprint(EVENT));
  });
});
