// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Finding the things that have permissions (workplan 0029 T1).
 *
 * The drive scan is where the awkward trade-off lives — a tenant's drive can
 * hold a hundred thousand items — so most of these tests are about the two
 * narrowings that make it finishable, and about refusing to present the
 * result as complete when a cap was hit.
 */

import { describe, it, expect, vi } from 'vitest';
import { scanCalendarPermissions, scanDrivePermissions } from './graph-permission-scan';
import type { HttpClient } from './dav-http.types';

const token = async () => 'tok';
const APP = { applicationPermissions: true } as const;

/** Answers by URL substring, first match wins. */
function routed(routes: Array<[match: string, body: unknown, status?: number]>): HttpClient {
  return {
    request: vi.fn(async ({ url }: { url: string }) => {
      const hit = routes.find(([match]) => url.includes(match));
      if (!hit) throw new Error(`no route for ${url}`);
      return {
        status: hit[2] ?? 200,
        body: typeof hit[1] === 'string' ? hit[1] : JSON.stringify(hit[1]),
        headers: {},
      };
    }),
  } as unknown as HttpClient;
}

describe('scanning a mailbox’s calendars', () => {
  it('merges every calendar’s shares into one listing', async () => {
    const http = routed([
      ['/calendars?', { value: [{ id: 'c1', name: 'Calendar' }, { id: 'c2', name: 'Family' }] }],
      [
        '/calendars/c1/calendarPermissions',
        { value: [{ role: 'read', emailAddress: { address: 'anna@acme.nl' } }] },
      ],
      [
        '/calendars/c2/calendarPermissions',
        { value: [{ role: 'write', emailAddress: { address: 'jan@acme.nl' } }] },
      ],
    ]);
    const result = await scanCalendarPermissions('rob@acme.nl', token, http, APP);

    if (result.kind !== 'listed') throw new Error('expected a listing');
    // One section, not eight of which seven say nothing.
    expect(result.grants).toHaveLength(2);
    expect(result.grants[0]?.on).toBe('rob@acme.nl — Calendar');
    expect(result.grants[1]?.grantee).toBe('jan@acme.nl');
  });

  it('fails the WHOLE listing when one calendar cannot be read', async () => {
    const http = routed([
      ['/calendars?', { value: [{ id: 'c1', name: 'Calendar' }, { id: 'c2', name: 'Secret' }] }],
      ['/calendars/c1/calendarPermissions', { value: [] }],
      ['/calendars/c2/calendarPermissions', 'denied', 403],
    ]);
    const result = await scanCalendarPermissions('rob@acme.nl', token, http, APP);

    // "These are the shares on your calendars, except the ones we could not
    // read" is the half-truth this module exists to avoid.
    expect(result.kind).toBe('not_discoverable');
  });

  it('refuses a delegated connection without asking Graph', async () => {
    const http = routed([['/calendars', { value: [] }]]);
    const result = await scanCalendarPermissions('rob@acme.nl', token, http, {
      applicationPermissions: false,
    });

    expect(result.kind).toBe('not_discoverable');
    expect(http.request).not.toHaveBeenCalled();
  });
});

describe('scanning a drive', () => {
  it('asks only about items Graph marks as shared', async () => {
    const http = routed([
      [
        '/root/children',
        {
          value: [
            { id: 'i1', name: 'Budget.xlsx', shared: {} },
            { id: 'i2', name: 'Private.docx' },
          ],
        },
      ],
      ['/items/i1/permissions', { value: [{ roles: ['read'], grantedToV2: { user: { email: 'a@x.nl' } } }] }],
    ]);
    const result = await scanDrivePermissions('d1', token, http, APP);

    if (result.kind !== 'listed') throw new Error('expected a listing');
    // The unshared item is never asked about — that is the difference between
    // a handful of requests and a hundred thousand.
    expect(result.grants).toHaveLength(1);
    expect(result.grants[0]?.on).toBe('/Budget.xlsx');
  });

  it('descends into folders and keeps the path readable', async () => {
    const http = routed([
      ['/items/f1/children', { value: [{ id: 'i9', name: 'Deep.txt', shared: {} }] }],
      ['/root/children', { value: [{ id: 'f1', name: 'Team', folder: { childCount: 1 } }] }],
      ['/items/i9/permissions', { value: [{ roles: ['write'] }] }],
    ]);
    const result = await scanDrivePermissions('d1', token, http, APP);

    if (result.kind !== 'listed') throw new Error('expected a listing');
    // A file path an owner recognises, not an opaque item id.
    expect(result.grants[0]?.on).toBe('/Team/Deep.txt');
  });

  it('refuses to report a capped walk as the whole picture', async () => {
    // A folder that contains itself, forever — the shape a cap exists for.
    const http = routed([
      ['children', { value: [{ id: 'f1', name: 'Loop', folder: {} }] }],
    ]);
    const result = await scanDrivePermissions('d1', token, http, { ...APP, maxFolders: 3 });

    expect(result.kind).toBe('not_discoverable');
    if (result.kind !== 'not_discoverable') return;
    expect(result.reason).toContain('more than 3 folders');
    expect(result.reason).toContain('Nothing below that point was looked at');
  });

  it('refuses to report a capped item list as complete', async () => {
    const http = routed([
      [
        '/root/children',
        { value: [1, 2, 3].map((n) => ({ id: `i${n}`, name: `f${n}`, shared: {} })) },
      ],
      ['/permissions', { value: [] }],
    ]);
    const result = await scanDrivePermissions('d1', token, http, { ...APP, maxSharedItems: 2 });

    expect(result.kind).toBe('not_discoverable');
    if (result.kind !== 'not_discoverable') return;
    // A partial list read as complete is how a share nobody knew about
    // survives a cutover.
    expect(result.reason).toContain('more than 2 items');
  });

  it('does not turn a failed folder read into “nothing is shared”', async () => {
    const http = routed([['/root/children', 'gone', 500]]);
    const result = await scanDrivePermissions('d1', token, http, APP);

    expect(result.kind).toBe('not_discoverable');
    if (result.kind === 'not_discoverable') expect(result.reason).toContain('500');
  });

  it('fails the whole listing when one item’s permissions cannot be read', async () => {
    const http = routed([
      ['/root/children', { value: [{ id: 'i1', name: 'x', shared: {} }] }],
      ['/items/i1/permissions', 'denied', 403],
    ]);
    const result = await scanDrivePermissions('d1', token, http, APP);

    expect(result.kind).toBe('not_discoverable');
  });

  it('refuses a delegated connection without asking Graph', async () => {
    const http = routed([['/root/children', { value: [] }]]);
    const result = await scanDrivePermissions('d1', token, http, { applicationPermissions: false });

    expect(result.kind).toBe('not_discoverable');
    expect(http.request).not.toHaveBeenCalled();
  });
});
