// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE LAST 90 DAYS FIRST, AS BOTH DISPATCHERS RUN IT (workplan 0170 §3.1,
 * §3.3): which window a data type's pass owes, the record that says so, phase
 * B after a phase A that is in and not after one that is not, and a 90-day
 * migration's window every time.
 */

import { describe, it, expect } from 'vitest';
import {
  asMappingId,
  asTenantId,
  formatWindowRecord,
  parseWindowRecord,
  windowRecordKey,
  type CursorStore,
  type PassWindow,
  type SyncCursor,
} from '@openmig/shared';
import { discoveryWindowFor, mergePhases, planWindow, runWithWindow } from './recent-window-pass.ts';

const TENANT = asTenantId('01700000-e29b-41d4-a716-4466554402c1');
const MAPPING = asMappingId('01700000-e29b-41d4-a716-4466554402c2');
const NOW = new Date('2026-11-24T10:00:00Z');

function memoryCursors(): CursorStore & { readonly rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    get: async (_t, _m, key): Promise<SyncCursor | undefined> => {
      const value = rows.get(key);
      return value === undefined ? undefined : { value };
    },
    set: async (_t, _m, key, cursor) => {
      rows.set(key, cursor.value);
    },
    clear: async () => rows.clear(),
  };
}

const plan = (cursors: CursorStore | undefined, extra: Partial<Parameters<typeof planWindow>[0]> = {}) =>
  planWindow({
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'email',
    cursors,
    copiedOnce: async () => false,
    now: () => NOW,
    ...extra,
  });

describe('planWindow', () => {
  it('owes a new data type phase A, anchored now (D7)', async () => {
    expect(await plan(memoryCursors())).toEqual({ since: new Date('2026-08-26T00:00:00Z'), only: false });
  });

  it('owes contacts and tasks no window, ever', async () => {
    for (const domain of ['contact', 'task'] as const) {
      expect(await plan(memoryCursors(), { domain })).toBeUndefined();
      expect(await plan(memoryCursors(), { domain, recentOnly: { days: 90, anchor: NOW.toISOString() } })).toBeUndefined();
    }
  });

  it('owes none once the window is in, and the same since while it is still copying', async () => {
    const cursors = memoryCursors();
    await cursors.set(TENANT, MAPPING, windowRecordKey('email'), {
      value: formatWindowRecord({ since: '2026-07-01T00:00:00.000Z', state: 'copying' }),
    });
    expect(await plan(cursors)).toEqual({ since: new Date('2026-07-01T00:00:00Z'), only: false });
    await cursors.set(TENANT, MAPPING, windowRecordKey('email'), {
      value: formatWindowRecord({ since: '2026-07-01T00:00:00.000Z', state: 'in' }),
    });
    expect(await plan(cursors)).toBeUndefined();
  });

  it('owes none to a data type whose first copy finished before, a migration made before this among them', async () => {
    expect(await plan(memoryCursors(), { copiedOnce: async () => true })).toBeUndefined();
  });

  it('owes a 90-day migration its window every pass, from its own anchor', async () => {
    const recentOnly = { days: 90, anchor: '2026-10-01T15:00:00.000Z' };
    expect(await plan(memoryCursors(), { recentOnly, copiedOnce: async () => true })).toEqual({
      since: new Date('2026-07-03T00:00:00Z'),
      only: true,
    });
  });

  it('refuses a 90-day migration with no anchor, rather than a window that moves', async () => {
    await expect(plan(memoryCursors(), { recentOnly: { days: 90 } })).rejects.toThrow(/no anchor/);
  });
});

describe('runWithWindow', () => {
  const run = (cursors: CursorStore, window: PassWindow | undefined, complete: boolean) => {
    const passes: Array<PassWindow | undefined> = [];
    const done = runWithWindow({
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'email',
      cursors,
      plan: window,
      run: async (w) => {
        passes.push(w);
        return w ? { created: 2, scanned: 2, windowComplete: complete } : { created: 5, scanned: 7 };
      },
    });
    return { passes, done };
  };
  const A: PassWindow = { since: new Date('2026-08-26T00:00:00Z'), only: false };

  it('runs phase B after a phase A that is in, records it in, and reports the two as one', async () => {
    const cursors = memoryCursors();
    const { passes, done } = run(cursors, A, true);
    const out = await done;
    expect(passes).toEqual([A, undefined]);
    expect(out).toEqual({ result: { created: 7, scanned: 7 }, firstCopyOwed: false });
    expect(parseWindowRecord(cursors.rows.get(windowRecordKey('email')))).toEqual({
      since: '2026-08-26T00:00:00.000Z',
      state: 'in',
    });
  });

  it('does not run phase B after a phase A that stopped short, which stays copying', async () => {
    const cursors = memoryCursors();
    const { passes, done } = run(cursors, A, false);
    const out = await done;
    expect(passes).toEqual([A]);
    expect(out.firstCopyOwed).toBe(true);
    expect(parseWindowRecord(cursors.rows.get(windowRecordKey('email')))?.state).toBe('copying');
  });

  it('runs a 90-day migration window alone, never phase B, and owes no first copy', async () => {
    const only: PassWindow = { ...A, only: true };
    const { passes, done } = run(memoryCursors(), only, true);
    expect((await done).firstCopyOwed).toBe(false);
    expect(passes).toEqual([only]);
  });

  it('runs the ordinary pass alone when no window is owed', async () => {
    const cursors = memoryCursors();
    const { passes, done } = run(cursors, undefined, true);
    expect((await done).result).toEqual({ created: 5, scanned: 7 });
    expect(passes).toEqual([undefined]);
    expect(cursors.rows.size).toBe(0);
  });
});

describe('mergePhases', () => {
  it('adds the work each phase did, and takes the rest from phase B', () => {
    const merged = mergePhases(
      { created: 2, updated: 1, scanned: 2, skipped: 0, moves: ['a'], windowComplete: true, failed: 1 },
      { created: 5, updated: 0, scanned: 9, skipped: 2, moves: ['b'], failed: 0 },
    );
    expect(merged).toEqual({ created: 7, updated: 1, scanned: 9, skipped: 2, moves: ['a', 'b'], failed: 0 });
  });
});

describe('discoveryWindowFor', () => {
  it('counts a 90-day migration window, and nothing for a migration of everything or a contact', () => {
    const recentOnly = { days: 90, anchor: '2026-11-24T10:00:00.000Z' };
    const mail = discoveryWindowFor('email', recentOnly);
    expect(mail?.since.toISOString()).toBe('2026-08-26T00:00:00.000Z');
    expect(mail?.holds({ receivedAt: '2026-11-01T00:00:00Z' })).toBe(true);
    expect(mail?.holds({ receivedAt: '2025-11-01T00:00:00Z' })).toBe(false);
    expect(discoveryWindowFor('file', recentOnly)?.holds({ item: { isDirectory: false, modifiedAt: '2020-01-01' } })).toBe(false);
    expect(discoveryWindowFor('email', undefined)).toBeUndefined();
    expect(discoveryWindowFor('contact', recentOnly)).toBeUndefined();
  });
});
