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
import {
  ACCOUNT_ROOT,
  roleFromPermissionBits,
  scanNextcloudShares,
} from './nextcloud-share-scan.ts';
import { groupShareGrants } from '@openmig/shared';

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

/**
 * WHERE THE THING SITS — the two fields this scan was already being handed
 * and was throwing away (2026-09-19).
 *
 * The fold (workplan 0123 T4) turns a shared folder and its contents into one
 * row. It was built for Google Drive and had never worked on a Nextcloud
 * source at all: every row came back unplaced, so every row was listed on its
 * own and a folder press had no folder to press. OCS answers `path` and
 * `item_type` in the response the scan already makes.
 *
 * The last test here is the one that matters: it runs the REAL grouping rule
 * over what this scan produces, because "the fields are populated" and "a
 * folder folds" are different claims, and only the second is the feature.
 */
describe('where a shared thing sits', () => {
  const folderShare = {
    share_type: 4,
    share_with: 'anna@example.test',
    path: '/Photos',
    item_type: 'folder',
    permissions: 1,
  };
  const childShare = {
    share_type: 4,
    share_with: 'anna@example.test',
    path: '/Photos/IMG_1.jpg',
    item_type: 'file',
    permissions: 1,
  };

  it('reads the container out of the path, and the root for a top-level share', async () => {
    const { httpClient } = fakeHttp(200, envelope([folderShare, childShare]));
    const listing = await scanNextcloudShares(OPTIONS(httpClient));

    expect(listing.kind).toBe('listed');
    if (listing.kind !== 'listed') return;
    expect(listing.grants[0]).toMatchObject({
      itemKey: 'Photos',
      parentKey: ACCOUNT_ROOT,
      isContainer: true,
    });
    expect(listing.grants[1]).toMatchObject({
      itemKey: 'Photos/IMG_1.jpg',
      parentKey: 'Photos',
      isContainer: false,
    });
  });

  it('says NOTHING about a share whose item_type OCS did not give', async () => {
    // `false` is the claim "this is not a folder", and the fold treats a
    // container differently from a thing inside one. Hard rule 9: an OCS that
    // did not say must not be read as one that said no.
    const { httpClient } = fakeHttp(
      200,
      envelope([{ share_type: 0, share_with: 'bram', path: '/Notes.txt', permissions: 1 }]),
    );
    const listing = await scanNextcloudShares(OPTIONS(httpClient));

    expect(listing.kind).toBe('listed');
    if (listing.kind !== 'listed') return;
    expect(listing.grants[0]).toMatchObject({ itemKey: 'Notes.txt', parentKey: ACCOUNT_ROOT });
    expect(listing.grants[0]).not.toHaveProperty('isContainer');
  });

  it('places a share with no path NOWHERE, rather than at the root', async () => {
    // The root is a real answer. "OCS gave us no path" is a different one, and
    // a row placed at the root on the strength of a missing field would fold
    // in beside shares it may have nothing to do with.
    const { httpClient } = fakeHttp(200, envelope([{ share_type: 3, permissions: 1 }]));
    const listing = await scanNextcloudShares(OPTIONS(httpClient));

    expect(listing.kind).toBe('listed');
    if (listing.kind !== 'listed') return;
    expect(listing.grants[0]).not.toHaveProperty('itemKey');
    expect(listing.grants[0]).not.toHaveProperty('parentKey');
  });

  it('FOLDS: the real grouping rule turns the folder and its child into one group', async () => {
    // The claim the whole change exists for, checked against the rule itself
    // rather than against the shape of the fields. Before this, both rows came
    // back unplaced and `groups` was empty — which is what a folder press
    // answers `no_such_folder` to.
    const { httpClient } = fakeHttp(200, envelope([folderShare, childShare]));
    const listing = await scanNextcloudShares(OPTIONS(httpClient));
    if (listing.kind !== 'listed') throw new Error('the scan did not list');

    const grouped = groupShareGrants(
      listing.grants.map((g, i) => ({
        id: `row-${i}`,
        onLabel: g.on,
        role: g.role,
        ...(g.grantee ? { grantee: g.grantee } : {}),
        ...(g.itemKey ? { itemKey: g.itemKey } : {}),
        ...(g.parentKey ? { parentKey: g.parentKey } : {}),
        ...(g.isContainer !== undefined ? { isContainer: g.isContainer } : {}),
      })),
    );

    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]).toMatchObject({
      parentKey: 'Photos',
      label: 'Photos',
      items: 2,
      containerShared: true,
    });
    expect(grouped.standalone).toEqual([]);
  });
});
