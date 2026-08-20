// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The two dates a closing customer is owed (workplan 0085 T5).
 *
 * The load-bearing claim here is not arithmetic, it is honesty: the sentence
 * shown to a customer must not say "deleted" on a day when we could still
 * restore their data from a backup. So the tests below care most about the
 * things that would make it a lie — a backup window measured from the wrong
 * moment, a zero-retention deployment claiming a second date it does not have,
 * and a misconfigured window silently defaulting instead of refusing.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BACKUP_RETENTION_DAYS,
  backupRetentionDaysFromEnv,
  erasureTimeline,
  erasureTimelineText,
} from './erasure-timeline.ts';

const CLOSED_AT = new Date('2026-08-18T09:30:00.000Z');

describe('backupRetentionDaysFromEnv', () => {
  it('defaults to the reference deployment’s window when unset', () => {
    expect(backupRetentionDaysFromEnv(undefined)).toBe(DEFAULT_BACKUP_RETENTION_DAYS);
    expect(backupRetentionDaysFromEnv('')).toBe(DEFAULT_BACKUP_RETENTION_DAYS);
    expect(DEFAULT_BACKUP_RETENTION_DAYS).toBe(7);
  });

  it('accepts zero, because "we keep no backups" is a real answer', () => {
    expect(backupRetentionDaysFromEnv('0')).toBe(0);
  });

  it.each(['seven', '7.5', '-1', 'NaN', '1e3.5'])('refuses %s by name', (raw) => {
    expect(() => backupRetentionDaysFromEnv(raw)).toThrow(/BACKUP_RETENTION_DAYS/);
  });

  it('names the default in the refusal, so the fix is in the message', () => {
    expect(() => backupRetentionDaysFromEnv('later')).toThrow(/default of 7 days/);
  });
});

describe('erasureTimeline', () => {
  it('measures the backup window from the PURGE, not from the close', () => {
    // The one that matters. A backup taken the hour before the purge is the
    // last one that can contain anything, and it has the full retention window
    // still to run — so dating expiry from the close would promise a date
    // that arrives while the data is still restorable.
    const t = erasureTimeline({ closedAt: CLOSED_AT, windowDays: 30, backupRetentionDays: 7 });

    expect(t.purgeAfter.toISOString()).toBe('2026-09-17T09:30:00.000Z');
    expect(t.backupsExpireAt.toISOString()).toBe('2026-09-24T09:30:00.000Z');
    // Not 2026-08-25 — which is what closedAt + 7 would give.
    expect(t.backupsExpireAt.getTime() - t.purgeAfter.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('immediate close still has a backup tail', () => {
    // Window 0 is the case somebody would most expect to mean "gone now", and
    // it is precisely the case where the gap between the two dates is the
    // entire promise.
    const t = erasureTimeline({ closedAt: CLOSED_AT, windowDays: 0, backupRetentionDays: 7 });

    expect(t.purgeAfter.getTime()).toBe(CLOSED_AT.getTime());
    expect(t.backupsExpireAt.toISOString()).toBe('2026-08-25T09:30:00.000Z');
  });

  it('collapses to one date only when there genuinely are no backups', () => {
    const t = erasureTimeline({ closedAt: CLOSED_AT, windowDays: 7, backupRetentionDays: 0 });
    expect(t.backupsExpireAt.getTime()).toBe(t.purgeAfter.getTime());
  });

  it.each([
    ['a fractional window', { windowDays: 7.5, backupRetentionDays: 7 }],
    ['a negative window', { windowDays: -7, backupRetentionDays: 7 }],
    ['a fractional retention', { windowDays: 7, backupRetentionDays: 0.5 }],
    ['a negative retention', { windowDays: 7, backupRetentionDays: -1 }],
  ])('refuses %s rather than producing a date from it', (_label, args) => {
    expect(() => erasureTimeline({ closedAt: CLOSED_AT, ...args })).toThrow(/whole number of days/);
  });

  it('is pure — the same inputs give the same dates, years later', () => {
    const once = erasureTimeline({ closedAt: CLOSED_AT, windowDays: 90, backupRetentionDays: 7 });
    const again = erasureTimeline({ closedAt: CLOSED_AT, windowDays: 90, backupRetentionDays: 7 });
    expect(again).toEqual(once);
  });
});

describe('erasureTimelineText', () => {
  const t = erasureTimeline({ closedAt: CLOSED_AT, windowDays: 30, backupRetentionDays: 7 });

  it('states both dates, and does not call the first one "erased"', () => {
    const en = erasureTimelineText(t, 'en');

    expect(en).toContain('2026-09-17');
    expect(en).toContain('2026-09-24');
    expect(en).toMatch(/live service/);
    expect(en).toMatch(/backups/i);
    // The claim we must never make: that a backup is edited or scrubbed.
    expect(en).not.toMatch(/scrub|purge the backup|delete.*from.*backups?\b/i);
    expect(en).toMatch(/expire/i);
  });

  it('says the same dates in Dutch, untranslated', () => {
    // Prose boundary: translate the frame, never the finding. A date is a
    // finding — and an ISO date is also the one format that cannot be read as
    // a different day in another country, which matters when the sentence is
    // a commitment.
    const nl = erasureTimelineText(t, 'nl');

    expect(nl).toContain('2026-09-17');
    expect(nl).toContain('2026-09-24');
    expect(nl).toMatch(/back-ups/);
  });

  it('the Dutch is a translation, not the English with a date in it', () => {
    const en = erasureTimelineText(t, 'en');
    const nl = erasureTimelineText(t, 'nl');
    const stripDates = (s: string) => s.replace(/\d{4}-\d{2}-\d{2}/g, '').replace(/\s+/g, ' ');

    expect(stripDates(nl)).not.toBe(stripDates(en));
    expect(nl).not.toBe(en);
  });

  it('a zero-backup deployment gets its own sentence, not the same date twice', () => {
    // "…and from our backups by the same day" reads as an evasion even when it
    // is true, so the no-backups case says what is actually the case.
    const none = erasureTimeline({ closedAt: CLOSED_AT, windowDays: 7, backupRetentionDays: 0 });

    const en = erasureTimelineText(none, 'en');
    expect(en).toMatch(/keeps no backups/);
    expect(en.match(/2026-08-25/g) ?? []).toHaveLength(1);

    expect(erasureTimelineText(none, 'nl')).toMatch(/geen back-ups/);
  });

  it('names the number of days, so the promise can be checked against the schedule', () => {
    expect(erasureTimelineText(t, 'en')).toContain('7 days');
    expect(erasureTimelineText(t, 'nl')).toContain('7 dagen');
  });
});
