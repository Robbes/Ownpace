// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * The OCS share call (ADR-0032, workplan 0052 T3). What these pin:
 *
 *  1. The endpoint comes from the ORIGIN — a DAV path concatenation would
 *     build /remote.php/dav/files/user/ocs/… , which cannot exist (the same
 *     lesson wellKnownUrl already paid for).
 *  2. The `OCS-APIRequest` header is present — without it OCS answers 401 to
 *     everything, and that 401 would read as wrong credentials.
 *  3. A refusal carries the server's own sentence; success requires BOTH a
 *     2xx and OCS's meta saying ok (v2 can wrap a failure in a 200-shaped
 *     envelope on some proxies — trust the envelope, not just the status).
 */

import { describe, it, expect } from 'vitest';
import type { HttpClient, HttpRequestOptions } from './dav-http.types';
import {
  createNextcloudUserShare,
  nextcloudPermissionsFor,
  ocsOriginFrom,
} from './nextcloud-ocs';

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

const OK_ENVELOPE = JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 200 } } });

const OPTIONS = (httpClient: HttpClient) => ({
  webdavUrl: 'https://cloud.example.nl/remote.php/dav/files/anna/',
  username: 'admin',
  password: 'secret',
  httpClient,
});

describe('nextcloudPermissionsFor', () => {
  it('write-ish roles become editor (15, no re-share); everything else reads (1)', () => {
    expect(nextcloudPermissionsFor('writer')).toBe(15);
    expect(nextcloudPermissionsFor('write')).toBe(15);
    expect(nextcloudPermissionsFor('reader')).toBe(1);
    expect(nextcloudPermissionsFor('commenter')).toBe(1);
  });
});

describe('createNextcloudUserShare', () => {
  it('POSTs to the ORIGIN-rooted OCS endpoint with the api header and the form fields', async () => {
    const { httpClient, calls } = fakeHttp(200, OK_ENVELOPE);

    const result = await createNextcloudUserShare(OPTIONS(httpClient), {
      path: 'Projects/budget.xlsx',
      shareWith: 'bram',
      role: 'writer',
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(
      'https://cloud.example.nl/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json',
    );
    expect(call.headers!['OCS-APIRequest']).toBe('true');
    const body = String(call.body);
    expect(body).toContain('path=%2FProjects%2Fbudget.xlsx');
    expect(body).toContain('shareType=0');
    expect(body).toContain('shareWith=bram');
    expect(body).toContain('permissions=15');
  });

  it("a refusal carries OCS's own sentence, status included", async () => {
    const { httpClient } = fakeHttp(
      404,
      JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 404, message: 'User bram does not exist' } } }),
    );

    const result = await createNextcloudUserShare(OPTIONS(httpClient), {
      path: 'a.txt',
      shareWith: 'bram',
      role: 'reader',
    });

    expect(result).toEqual({ ok: false, reason: 'OCS answered 404: User bram does not exist' });
  });

  it('a 200 whose envelope does not say ok is still a refusal — trust the envelope', async () => {
    const { httpClient } = fakeHttp(
      200,
      JSON.stringify({ ocs: { meta: { status: 'failure', message: 'Path already shared with this user' } } }),
    );

    const result = await createNextcloudUserShare(OPTIONS(httpClient), {
      path: 'a.txt',
      shareWith: 'bram',
      role: 'reader',
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain('Path already shared with this user');
  });

  it('a server that is not Nextcloud answers with whatever it answers — shown, truncated, unchanged', async () => {
    const { httpClient } = fakeHttp(404, '<html>plain WebDAV server, no OCS here</html>');

    const result = await createNextcloudUserShare(OPTIONS(httpClient), {
      path: 'a.txt',
      shareWith: 'bram',
      role: 'reader',
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain('no OCS here');
  });
});

describe('ocsOriginFrom', () => {
  it('derives the origin from any DAV path and refuses garbage', () => {
    expect(ocsOriginFrom('https://cloud.example.nl/remote.php/dav/files/anna/')).toBe(
      'https://cloud.example.nl',
    );
    expect(ocsOriginFrom('not a url')).toBeUndefined();
  });
});
