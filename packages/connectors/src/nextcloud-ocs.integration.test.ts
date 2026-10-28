// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE SHARE VERB, against a real Nextcloud (workplan 0119, Status of
 * 2026-10-25; the verb is workplan 0052 T3 and 0104 T0).
 *
 * `createNextcloudShare` and `scanNextcloudShares` are held to recorded OCS
 * replies by their unit tests, and the managed gate's smoke presses shares on
 * the demo's Nextcloud, which is one major: the demo's. Nothing in the
 * integration tier spoke OCS at all, so the second-major leg
 * (`.github/workflows/nextcloud-second-major.yml`) had no share suite to run
 * against the major a customer's own server may already be on. This is that
 * suite. It runs in both places: the ordinary integration job, against the
 * default image, and the leg, against the other major.
 *
 * Each case is held to the server's own answer:
 *
 *  1. A folder shared with an account the target knows is a USER share, the
 *     door that notifies inside the account (`via: 'user'`).
 *  2. The share listing reads it back as the grant it was: the folder at the
 *     account root, the grantee, the editor bits (15, `writer`), the note.
 *  3. A grantee the target does not know, and who is no address, is refused
 *     twice, the user attempt with OCS 404 and share-by-mail with OCS 404, and
 *     comes back as `notAnAccount`; nothing is shared.
 *
 * Three create calls in all. Nextcloud 31 to 35 allow one account 20 in ten
 * minutes (`#[UserRateLimit(limit: 20, period: 600)]` on
 * `ShareAPIController::createShare`, read on `stable34` and `stable35`,
 * 2026-10-25), and nothing else in the tier creates a share.
 *
 * The grantee is an account this suite creates through OCS's provisioning API
 * as the test admin, and removes again, with the folder, at the end.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createNextcloudShare, type NextcloudShareOptions } from './nextcloud-ocs.ts';
import { ACCOUNT_ROOT, scanNextcloudShares } from './nextcloud-share-scan.ts';
import type { HttpClient } from './dav-http.types.ts';

const NEXTCLOUD_WEBDAV_URL = process.env.NEXTCLOUD_WEBDAV_URL;
const NEXTCLOUD_USERNAME = process.env.NEXTCLOUD_USERNAME || 'testadmin';
const NEXTCLOUD_PASSWORD = process.env.NEXTCLOUD_PASSWORD || 'testadmin_password';

if (!NEXTCLOUD_WEBDAV_URL) {
  console.warn('[nextcloud-ocs] Skipping: needs the integration Nextcloud (NEXTCLOUD_WEBDAV_URL).');
  describe.skip('the share verb (real Nextcloud)', () => {
    it('skipped - Nextcloud not configured', () => {
      expect(true).toBe(true);
    });
  });
} else {
  const AUTH = `Basic ${Buffer.from(`${NEXTCLOUD_USERNAME}:${NEXTCLOUD_PASSWORD}`).toString('base64')}`;
  const ORIGIN = new URL(NEXTCLOUD_WEBDAV_URL).origin;
  const FILES_URL = `${NEXTCLOUD_WEBDAV_URL.replace(/\/$/, '')}/files/${NEXTCLOUD_USERNAME}`;
  const FOLDER = `openmig-share-${randomUUID().slice(0, 8)}`;
  const SHAREE = `sharee-${randomUUID().slice(0, 8)}`;
  /** Long and mixed, for the password policy app Nextcloud ships enabled. */
  const SHAREE_PASSWORD = `${randomBytes(18).toString('base64url')}-Aa1`;
  const NOTE = 'This replaces the share on the old platform.';

  /** The API's own transport, minus the host rule: `fetch`, the body as text. */
  const httpClient: HttpClient = {
    request: async ({ url, method, headers, body }) => {
      const r = await fetch(url, { method, ...(headers ? { headers } : {}), ...(typeof body === 'string' ? { body } : {}) });
      return { status: r.status, body: await r.text(), headers: {} };
    },
  };

  const options: NextcloudShareOptions = {
    webdavUrl: FILES_URL,
    username: NEXTCLOUD_USERNAME,
    password: NEXTCLOUD_PASSWORD,
    httpClient,
  };

  /** One OCS call as the test admin, its reply whole. */
  const ocs = async (method: string, path: string, form?: Record<string, string>) => {
    const r = await fetch(`${ORIGIN}${path}${path.includes('?') ? '&' : '?'}format=json`, {
      method,
      headers: {
        Authorization: AUTH,
        'OCS-APIRequest': 'true',
        Accept: 'application/json',
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
    });
    return { status: r.status, body: await r.text() };
  };

  /** A WebDAV call as the test admin, its status. */
  const dav = async (method: string, url: string, body?: string): Promise<number> => {
    const r = await fetch(url, { method, headers: { Authorization: AUTH }, ...(body === undefined ? {} : { body }) });
    await r.arrayBuffer();
    return r.status;
  };

  describe('the share verb (real Nextcloud)', () => {
    beforeAll(async () => {
      const created = await ocs('POST', '/ocs/v2.php/cloud/users', { userid: SHAREE, password: SHAREE_PASSWORD });
      if (created.status !== 200 || !created.body.includes('"status":"ok"')) {
        throw new Error(`Could not create the grantee ${SHAREE}: ${created.status} ${created.body.slice(0, 300)}`);
      }
      expect(await dav('MKCOL', `${FILES_URL}/${FOLDER}`)).toBe(201);
      expect(await dav('PUT', `${FILES_URL}/${FOLDER}/budget.txt`, 'the budget, shared with one person\n')).toBe(201);
    });

    afterAll(async () => {
      // The folder takes its shares with it; the account goes after.
      expect(await dav('DELETE', `${FILES_URL}/${FOLDER}`)).toBe(204);
      const removed = await ocs('DELETE', `/ocs/v2.php/cloud/users/${SHAREE}`);
      expect(removed.status, `removing ${SHAREE}: ${removed.body.slice(0, 300)}`).toBe(200);
    });

    it('a folder shared with an account the target knows is a user share', async () => {
      const outcome = await createNextcloudShare(options, { path: FOLDER, shareWith: SHAREE, role: 'writer', note: NOTE });
      expect(outcome).toEqual({ ok: true, via: 'user' });
    });

    it('the share listing reads it back as the grant it was', async () => {
      const listing = await scanNextcloudShares(options);
      expect(listing.kind, listing.kind === 'not_discoverable' ? listing.reason : '').toBe('listed');
      if (listing.kind !== 'listed') return;

      const grants = listing.grants.filter((g) => g.on === FOLDER);
      expect(grants).toHaveLength(1);
      const grant = grants[0]!;
      expect(grant).toMatchObject({
        subject: 'drive_item',
        on: FOLDER,
        grantee: SHAREE,
        role: 'writer',
        itemKey: FOLDER,
        parentKey: ACCOUNT_ROOT,
        isContainer: true,
      });
      expect(grant.viaLink).toBeUndefined();
      // The server's own record of it: a user share, the editor bits, the note.
      const raw = JSON.parse(grant.raw) as { share_type?: number; permissions?: number; note?: string };
      expect(raw).toMatchObject({ share_type: 0, permissions: 15, note: NOTE });
    });

    it('a grantee the target does not know, and who is no address, is refused, and nothing is shared', async () => {
      const nobody = `nobody-${randomUUID().slice(0, 8)}`;
      const outcome = await createNextcloudShare(options, { path: FOLDER, shareWith: nobody, role: 'reader' });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      // The user attempt's 404 (no such account) sends it to share-by-mail,
      // whose 404 (no valid address) is the answer kept.
      expect(outcome.said).toEqual({ kind: 'notAnAccount', byMail: { status: 404, ocs: true, ocsStatus: 404 } });

      const listing = await scanNextcloudShares(options);
      expect(listing.kind).toBe('listed');
      if (listing.kind !== 'listed') return;
      expect(listing.grants.filter((g) => g.grantee === nobody)).toEqual([]);
    });
  });
}
