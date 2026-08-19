// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

import { describe, it, expect } from 'vitest';
import { isSyncDue, DEFAULT_SYNC_SCHEDULE } from './sync-due.ts';

const T = (iso: string) => new Date(iso);

describe('isSyncDue (0022 T1)', () => {
  it('a mapping that has never run is due immediately', () => {
    expect(isSyncDue('*/15 * * * *', null, T('2026-08-01T12:00:00Z'))).toBe(true);
    expect(isSyncDue(null, null, T('2026-08-01T12:00:00Z'))).toBe(true);
  });

  it('not due before the next cron firing after the last start', () => {
    // Last started 12:00, every 15 min → next firing 12:15; at 12:10 not due.
    expect(
      isSyncDue('*/15 * * * *', T('2026-08-01T12:00:00Z'), T('2026-08-01T12:10:00Z'))
    ).toBe(false);
  });

  it('due once the next firing is in the past', () => {
    expect(
      isSyncDue('*/15 * * * *', T('2026-08-01T12:00:00Z'), T('2026-08-01T12:15:00Z'))
    ).toBe(true);
    // Long overdue is still just "due" — the tick triggers ONE run, not a backlog.
    expect(
      isSyncDue('*/15 * * * *', T('2026-08-01T09:00:00Z'), T('2026-08-01T12:16:00Z'))
    ).toBe(true);
  });

  it('a null schedule uses the default (every 15 minutes)', () => {
    expect(isSyncDue(null, T('2026-08-01T12:00:00Z'), T('2026-08-01T12:10:00Z'))).toBe(false);
    expect(isSyncDue(null, T('2026-08-01T12:00:00Z'), T('2026-08-01T12:15:00Z'))).toBe(true);
    expect(DEFAULT_SYNC_SCHEDULE).toBe('*/15 * * * *');
  });

  it('due-ness anchors on the last START — a slow pass never pulls the next one earlier', () => {
    // Started 12:14, every 15 min → next firing 12:15 regardless of how long
    // the pass ran; at 12:15 it is due (the per-mapping queue, not this
    // function, is what prevents overlap with a still-running pass).
    expect(
      isSyncDue('*/15 * * * *', T('2026-08-01T12:14:00Z'), T('2026-08-01T12:15:00Z'))
    ).toBe(true);
  });

  it('an every-minute schedule is due each minute boundary', () => {
    expect(
      isSyncDue('* * * * *', T('2026-08-01T12:00:30Z'), T('2026-08-01T12:00:59Z'))
    ).toBe(false);
    expect(
      isSyncDue('* * * * *', T('2026-08-01T12:00:30Z'), T('2026-08-01T12:01:00Z'))
    ).toBe(true);
  });

  it('throws on an invalid cron expression — the caller owns the fallback', () => {
    expect(() =>
      isSyncDue('not a cron', T('2026-08-01T12:00:00Z'), T('2026-08-01T12:15:00Z'))
    ).toThrow();
  });
});
