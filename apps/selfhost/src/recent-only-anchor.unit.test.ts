// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A 90-day migration's anchor on the appliance (workplan 0170 §5.4): written
 * the first time the mapping is recorded, read back on every boot after so a
 * restart never moves the window, used as written when the file names one,
 * and taken off the row when the file is broadened.
 */

import { describe, it, expect } from 'vitest';
import { anchorRecentOnly } from './recent-only-anchor.ts';

const FIRST = new Date('2026-11-24T10:00:00.000Z');
const LATER = new Date('2026-12-30T08:00:00.000Z');

describe('anchorRecentOnly', () => {
  it('writes the anchor at the first record, beside what the override already holds', () => {
    const d = anchorRecentOnly({ days: 90 }, { userId: '42' }, FIRST);
    expect(d.setting).toEqual({ days: 90, anchor: FIRST.toISOString() });
    expect(d.write).toEqual({ userId: '42', recentOnly: { days: 90, anchor: FIRST.toISOString() } });
  });

  it('reads it back on a later boot, so a restart never moves the window, and writes nothing', () => {
    const stored = { recentOnly: { days: 90, anchor: FIRST.toISOString() } };
    const d = anchorRecentOnly({ days: 90 }, stored, LATER);
    expect(d.setting).toEqual({ days: 90, anchor: FIRST.toISOString() });
    expect(d.write).toBeUndefined();
  });

  it('uses an anchor the file names as written', () => {
    const d = anchorRecentOnly({ days: 90, anchor: '2026-10-01T00:00:00.000Z' }, null, LATER);
    expect(d.setting?.anchor).toBe('2026-10-01T00:00:00.000Z');
    expect(d.write).toEqual({ recentOnly: { days: 90, anchor: '2026-10-01T00:00:00.000Z' } });
  });

  it('takes the stored setting off the row once the file is broadened, and keeps the rest', () => {
    const stored = { userId: '42', recentOnly: { days: 90, anchor: FIRST.toISOString() } };
    expect(anchorRecentOnly(undefined, stored, LATER)).toEqual({ setting: undefined, write: { userId: '42' } });
    expect(anchorRecentOnly(undefined, { recentOnly: { days: 90, anchor: FIRST.toISOString() } }, LATER)).toEqual({
      setting: undefined,
      write: null,
    });
  });

  it('changes nothing for a migration of everything', () => {
    expect(anchorRecentOnly(undefined, null, LATER)).toEqual({ setting: undefined, write: undefined });
    expect(anchorRecentOnly(undefined, { userId: '42' }, LATER)).toEqual({ setting: undefined, write: undefined });
  });

  it('refuses a stored setting it cannot read, rather than moving the window', () => {
    expect(() => anchorRecentOnly({ days: 90 }, { recentOnly: { days: 90, anchor: 'soon' } }, LATER)).toThrow(
      /recentOnly\.anchor/,
    );
  });
});
