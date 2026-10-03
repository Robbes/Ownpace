// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HOW LONG, BEFORE START (workplan 0154 T3 (a)): a range from what the count
 * found and Gmail's one published ceiling, and for anything else no number
 * at all. Each case is one sentence of `time-before-start.ts`'s header.
 */
import { describe, it, expect } from 'vitest';
import { timeBeforeStart } from './time-before-start.ts';
import { GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY } from './rate-budget.ts';

const GB = 1_000_000_000;

describe('mail from Gmail that the count measured', () => {
  it('takes the days the ceiling takes, ending on the last of them', () => {
    // 10.4 GB is five days' worth of 2.5 GB: it ends on the fifth day, four after it starts.
    expect(timeBeforeStart({ source: 'gmail', domains: ['email'], mailBytes: 10.4 * GB })).toEqual({
      kind: 'gmailDays',
      low: 4,
      high: 5,
      filesToo: false,
    });
    expect(timeBeforeStart({ source: 'gmail', domains: ['email'], mailBytes: 10 * GB })).toMatchObject({
      low: 3,
      high: 4,
    });
  });

  it('is within a day for one day’s worth or less, an empty mailbox too', () => {
    expect(timeBeforeStart({ source: 'gmail', domains: ['email'], mailBytes: 1.2 * GB })).toEqual({
      kind: 'gmailWithinADay',
      mailBytes: 1.2 * GB,
      filesToo: false,
    });
    expect(timeBeforeStart({ source: 'gmail', domains: ['email'], mailBytes: GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY }).kind).toBe(
      'gmailWithinADay',
    );
    expect(timeBeforeStart({ source: 'gmail', domains: ['email'], mailBytes: 0 }).kind).toBe('gmailWithinADay');
  });

  /** A Google account's mail face IS the `gmail` card. */
  it('holds for a Google account’s mail, and says its files apart', () => {
    expect(
      timeBeforeStart({ source: 'google', domains: ['email', 'calendar', 'file'], mailBytes: 6 * GB }),
    ).toEqual({ kind: 'gmailDays', low: 2, high: 3, filesToo: true });
  });

  it('holds for a plain IMAP account pointed at Gmail, where the host is known', () => {
    expect(
      timeBeforeStart({ source: 'imap', sourceHost: 'IMAP.gmail.com ', domains: ['email'], mailBytes: 6 * GB }).kind,
    ).toBe('gmailDays');
    expect(timeBeforeStart({ source: 'imap', domains: ['email'], mailBytes: 6 * GB }).kind).toBe('notKnownYet');
  });
});

/** Hard rule 9: no provider's rate is invented, and nothing unmeasured is counted. */
describe('anything else', () => {
  it('is not known yet: a provider with no published ceiling', () => {
    expect(timeBeforeStart({ source: 'imap', sourceHost: 'mail.example.com', domains: ['email'], mailBytes: 30 * GB })).toEqual({
      kind: 'notKnownYet',
    });
    expect(timeBeforeStart({ source: 'o365', domains: ['email'], mailBytes: 30 * GB }).kind).toBe('notKnownYet');
  });

  it('is not known yet: Gmail’s mail the count did not measure', () => {
    expect(timeBeforeStart({ source: 'gmail', domains: ['email'], mailBytes: undefined }).kind).toBe('notKnownYet');
    expect(timeBeforeStart({ source: 'gmail', domains: ['email'], mailBytes: Number.NaN }).kind).toBe('notKnownYet');
  });

  it('is not known yet: a Google account that carries no mail', () => {
    expect(timeBeforeStart({ source: 'google', domains: ['calendar', 'contact'], mailBytes: undefined }).kind).toBe(
      'notKnownYet',
    );
    expect(timeBeforeStart({ source: 'google', domains: ['file'], mailBytes: 3 * GB }).kind).toBe('notKnownYet');
  });

  it('is not known yet: a source that could not be read', () => {
    expect(timeBeforeStart({ source: undefined, domains: ['email'], mailBytes: 3 * GB }).kind).toBe('notKnownYet');
  });
});
