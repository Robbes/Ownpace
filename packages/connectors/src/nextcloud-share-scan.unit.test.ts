// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The Nextcloud source-share scan (0104 T2). What these hold:
 *
 *  1. One GET, origin-rooted, with the OCS header — the same three lessons
 *     the share CREATE already paid for.
 *  2. A link becomes `viaLink` with NO grantee (the queue's manual lane); a
 *     user or mail share becomes a grantee `mapGrant` can judge.
 *  3. Role words match the queue's fixtures: write-ish bits say 'writer'.
 *  4. A server without OCS becomes an honest blind spot, never a crash —
 *     the inventory's own refusal shape.
 */

import { describe, it, expect } from 'vitest';
import type { HttpClient, HttpRequestOptions } from './dav-http.types.ts';
import { roleFromPermissionBits, scanNextcloudShares } from './nextcloud-share-scan.ts';

function fakeHttp(status: number, body: string) {
  const calls: HttpRequestOptions[] = [];
  const httpClient: HttpClient = {
    async request(options) {
      calls.push(options);
      return { status, body, headers: {} };
    },
  };
  return { httpClient, calls };
}

const OPTIONS = (httpClient: HttpClient) => ({
  webdavUrl: 'https://cloud.example.nl/remote.php/dav/files/anna/',
  username: 'anna',
  password: 'secret',
  httpClient,
});

function envelope(data: unknown) {
  return JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 200 }, data } });
}

describe('scanNextcloudShares', () => {
  it('GETs the ORIGIN-rooted shares endpoint with the OCS header', async () => {
    const { httpClient, calls } = fakeHttp(200, envelope([]));

    const listing = await scanNextcloudShares(OPTIONS(httpClient));

    expect(listing).toEqual({ kind: 'listed', grants: [] });
    expect(calls[0]!.url).toBe(
      'https://cloud.example.nl/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json',
    );
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.headers!['OCS-APIRequest']).toBe('true');
  });

  it('maps a mail share and a user share to grantees, a link to viaLink with none', async () => {
    const { httpClient } = fakeHttp(
      200,
      envelope([
        { share_type: 4, share_with: 'anna@example.nl', path: '/Projects/budget.xlsx', permissions: 19 },
        { share_type: 0, share_with: 'bram', path: '/Plans', permissions: 1 },
        { share_type: 3, path: '/Public.pdf', permissions: 1 },
      ]),
    );

    const listing = await scanNextcloudShares(OPTIONS(httpClient));
    if (listing.kind !== 'listed') throw new Error(listing.reason);

    expect(listing.grants).toHaveLength(3);
    expect(listing.grants[0]).toMatchObject({
      subject: 'drive_item',
      on: 'Projects/budget.xlsx',
      grantee: 'anna@example.nl',
      role: 'writer',
    });
    expect(listing.grants[1]).toMatchObject({ on: 'Plans', grantee: 'bram', role: 'reader' });
    expect(listing.grants[2]).toMatchObject({ on: 'Public.pdf', viaLink: true });
    expect(listing.grants[2]!.grantee).toBeUndefined();
  });

  it('a server without OCS is a blind spot with the body shown, never a crash', async () => {
    const { httpClient } = fakeHttp(404, '<html>plain WebDAV, no OCS here</html>');

    const listing = await scanNextcloudShares(OPTIONS(httpClient));

    expect(listing.kind).toBe('not_discoverable');
    if (listing.kind === 'not_discoverable') expect(listing.reason).toContain('no OCS here');
  });

  it("a refusal inside the envelope carries the server's own sentence", async () => {
    const { httpClient } = fakeHttp(
      401,
      JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 997, message: 'Current user is not logged in' } } }),
    );

    const listing = await scanNextcloudShares(OPTIONS(httpClient));

    expect(listing.kind).toBe('not_discoverable');
    if (listing.kind === 'not_discoverable')
      expect(listing.reason).toContain('Current user is not logged in');
  });
});

describe('roleFromPermissionBits', () => {
  it('write-ish bits say writer; bare read says reader — the words mapGrant judges', () => {
    expect(roleFromPermissionBits(1)).toBe('reader');
    expect(roleFromPermissionBits(17)).toBe('reader'); // read + share, still no writes
    expect(roleFromPermissionBits(15)).toBe('writer');
    expect(roleFromPermissionBits(3)).toBe('writer');
    expect(roleFromPermissionBits(undefined)).toBe('reader');
  });
});
