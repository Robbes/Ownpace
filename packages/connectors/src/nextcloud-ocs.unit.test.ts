// Copyright 2026 The Ownpace authors (Apache-2.0)
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
import { shareLimitOf, shareRefusalSaid } from '@openmig/shared';
import type { HttpClient, HttpRequestOptions } from './dav-http.types.ts';
import {
  createNextcloudShare,
  createNextcloudUserShare,
  nextcloudPermissionsFor,
  ocsOriginFrom,
} from './nextcloud-ocs.ts';

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

describe('createNextcloudShare — the grantee the target does not know (0104 T0)', () => {
  // Most of the people a cutover owes an announcement have no account on the
  // target: the source knew them by ADDRESS. A user share cannot reach them;
  // share-by-mail can, and it MAILS the link — the platform's own
  // notification, at the moment the grant is applied.
  function sequencedHttp(responses: Array<{ status: number; body: string }>) {
    const calls: HttpRequestOptions[] = [];
    const httpClient: HttpClient = {
      async request(options) {
        calls.push(options);
        const r = responses[Math.min(calls.length - 1, responses.length - 1)]!;
        return { status: r.status, body: r.body, headers: {} };
      },
    };
    return { httpClient, calls };
  }

  // Deliberately DUTCH: the fallback must key on the locale-independent OCS
  // statuscode, never on the translated sentence.
  const NO_SUCH_ACCOUNT = JSON.stringify({
    ocs: { meta: { status: 'failure', statuscode: 404, message: 'Gebruiker bestaat niet' } },
  });

  it('a known account gets a user share: one call, shareType 0, via user', async () => {
    const { httpClient, calls } = sequencedHttp([{ status: 200, body: OK_ENVELOPE }]);

    const result = await createNextcloudShare(OPTIONS(httpClient), {
      path: 'a.txt',
      shareWith: 'bram',
      role: 'reader',
    });

    expect(result).toEqual({ ok: true, via: 'user' });
    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.body)).toContain('shareType=0');
  });

  it('an unknown account falls back to SHARE-BY-MAIL: shareType 4, same path and level', async () => {
    const { httpClient, calls } = sequencedHttp([
      { status: 404, body: NO_SUCH_ACCOUNT },
      { status: 200, body: OK_ENVELOPE },
    ]);

    const result = await createNextcloudShare(OPTIONS(httpClient), {
      path: 'Projects/budget.xlsx',
      shareWith: 'anna@example.nl',
      role: 'writer',
    });

    expect(result).toEqual({ ok: true, via: 'mail' });
    expect(calls).toHaveLength(2);
    const second = String(calls[1]!.body);
    expect(second).toContain('shareType=4');
    expect(second).toContain('shareWith=anna%40example.nl');
    expect(second).toContain('permissions=15');
  });

  it('the note rides the attempt — the owner’s context travels inside the platform’s mail', async () => {
    const { httpClient, calls } = sequencedHttp([
      { status: 404, body: NO_SUCH_ACCOUNT },
      { status: 200, body: OK_ENVELOPE },
    ]);

    await createNextcloudShare(OPTIONS(httpClient), {
      path: 'a.txt',
      shareWith: 'anna@example.nl',
      role: 'reader',
      note: 'This replaces the share on the old platform.',
    });

    const expected = new URLSearchParams({
      note: 'This replaces the share on the old platform.',
    }).toString();
    for (const call of calls) {
      expect(String(call.body)).toContain(expected);
    }
  });

  it('a non-404 refusal does NOT try a second door — a permissions problem is not an invitation', async () => {
    const { httpClient, calls } = sequencedHttp([
      {
        status: 403,
        body: JSON.stringify({
          ocs: { meta: { status: 'failure', statuscode: 403, message: 'Sharing is disabled' } },
        }),
      },
    ]);

    const result = await createNextcloudShare(OPTIONS(httpClient), {
      path: 'a.txt',
      shareWith: 'anna@example.nl',
      role: 'reader',
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).toContain('Sharing is disabled');
    expect(calls).toHaveLength(1);
  });

  it('when both doors refuse, the answer names both — nothing was created, twice, visibly', async () => {
    const { httpClient, calls } = sequencedHttp([
      { status: 404, body: NO_SUCH_ACCOUNT },
      {
        status: 404,
        body: JSON.stringify({
          ocs: { meta: { status: 'failure', statuscode: 404, message: 'Wrong path, file/folder does not exist' } },
        }),
      },
    ]);

    const result = await createNextcloudShare(OPTIONS(httpClient), {
      path: 'gone.txt',
      shareWith: 'anna@example.nl',
      role: 'reader',
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.reason).toContain('Gebruiker bestaat niet');
      expect(result.reason).toContain('Wrong path');
    }
    expect(calls).toHaveLength(2);
  });
});

/**
 * A SHARE REFUSED, IN PARTS (workplan 0136 T3, a share's refusal on apply).
 *
 * The managed API answers a refused share from these parts, never from the
 * reason, which keeps the server's words for the operator's log and for the
 * appliance's owner. So the parts hold what failed (the status, OCS's own
 * code, whether the body was an OCS answer at all, or what kind of failure
 * it was) and nothing the server wrote.
 */
describe('createNextcloudShare: a refusal carries its parts', () => {
  const MARKER = 'an-internal-admin-page-7f3a';

  function sequence(responses: ReadonlyArray<{ status: number; body: string }>): HttpClient {
    let n = 0;
    return {
      async request() {
        const r = responses[Math.min(n++, responses.length - 1)]!;
        return { status: r.status, body: r.body, headers: {} };
      },
    };
  }
  const ocs = (statuscode: number, message: string) =>
    JSON.stringify({ ocs: { meta: { status: 'failure', statuscode, message } } });
  const REQUEST = { path: 'a.txt', shareWith: 'anna@example.nl', role: 'reader' };

  it('an OCS refusal: the status and OCS code, and not its message', async () => {
    const result = await createNextcloudShare(
      OPTIONS(sequence([{ status: 403, body: ocs(403, `Sharing is disabled ${MARKER}`) }])),
      REQUEST,
    );
    expect(result).toMatchObject({ ok: false, said: { kind: 'answered', status: 403, ocsStatus: 403, ocs: true } });
    expect(JSON.stringify(result.ok ? {} : result.said)).not.toContain(MARKER);
    // The reason keeps the server's words, for the log and the appliance.
    if (!result.ok) expect(result.reason).toContain(MARKER);
  });

  it('a body that is no OCS answer: the status, marked as not OCS, and none of the body', async () => {
    const result = await createNextcloudShare(
      OPTIONS(sequence([{ status: 404, body: `<html><title>${MARKER}</title></html>` }])),
      REQUEST,
    );
    expect(result).toMatchObject({ ok: false, said: { kind: 'answered', status: 404, ocs: false } });
    expect(JSON.stringify(result.ok ? {} : result.said)).not.toContain(MARKER);
  });

  it('no such account, and share-by-mail refused too: both parts, without either message', async () => {
    const result = await createNextcloudShare(
      OPTIONS(
        sequence([
          { status: 404, body: ocs(404, `User does not exist ${MARKER}`) },
          { status: 403, body: ocs(403, `Sharing by mail is off ${MARKER}`) },
        ]),
      ),
      REQUEST,
    );
    expect(result).toMatchObject({
      ok: false,
      said: { kind: 'notAnAccount', byMail: { status: 403, ocsStatus: 403, ocs: true } },
    });
    expect(JSON.stringify(result.ok ? {} : result.said)).not.toContain(MARKER);
  });

  it('a socket error is said by its kind, without the address it tried', async () => {
    const failing: HttpClient = {
      async request() {
        throw Object.assign(new Error(`connect ECONNREFUSED 10.0.0.7:443 ${MARKER}`), { code: 'ECONNREFUSED' });
      },
    };
    const result = await createNextcloudShare(OPTIONS(failing), REQUEST);
    expect(result).toMatchObject({ ok: false, said: { kind: 'unreachable' } });
    expect(JSON.stringify(result.ok ? {} : result.said)).not.toContain('10.0.0.7');
  });

  it('an address it cannot read is said as such', async () => {
    const result = await createNextcloudShare(
      { ...OPTIONS(sequence([])), webdavUrl: 'not a url' },
      REQUEST,
    );
    expect(result).toMatchObject({ ok: false, said: { kind: 'noOrigin' } });
  });

  it('an OCS code the server made up is not carried: only a three-digit one', async () => {
    const result = await createNextcloudShare(
      OPTIONS(sequence([{ status: 400, body: ocs(123456789, 'x') }])),
      REQUEST,
    );
    expect(result).toMatchObject({ ok: false, said: { kind: 'answered', status: 400, ocs: true } });
    expect(result.ok ? undefined : (result.said as { ocsStatus?: number }).ocsStatus).toBeUndefined();
  });
});

/**
 * THE TARGET'S LIMIT ON NEW SHARES (workplan 0104, Status of 2026-10-25).
 *
 * Nextcloud 31 to 35 put `#[UserRateLimit(limit: 20, period: 600)]` on
 * `ShareAPIController::createShare`: 20 calls per account in ten minutes,
 * failed ones included, and the 21st is answered 429 by
 * `RateLimitingMiddleware` with an empty OCS reply and no `Retry-After`. The
 * fake below answers as that does. What these pin: a 429 is carried as its
 * parts, with the wait the server asked for when it asked; a 429 on the user
 * attempt does not spend a second call on the mail attempt; and a grantee
 * that looks like an address still gets the user attempt first.
 */
describe("createNextcloudShare: the target's limit on new shares", () => {
  type Reply = { status: number; body: string; headers?: Record<string, string> };
  function nextcloud(replies: ReadonlyArray<Reply>) {
    const calls: HttpRequestOptions[] = [];
    const httpClient: HttpClient = {
      async request(options) {
        calls.push(options);
        const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
        return { status: r.status, body: r.body, headers: r.headers ?? {} };
      },
    };
    return { httpClient, calls };
  }
  /** What `RateLimitingMiddleware` answers through OCS v2: status 429, no words. */
  const LIMITED = JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 429, message: '' }, data: [] } });
  const NO_SUCH_ACCOUNT = JSON.stringify({
    ocs: { meta: { status: 'failure', statuscode: 404, message: 'Please specify a valid account to share with' } },
  });
  const REQUEST = { path: 'a.txt', shareWith: 'anna@example.nl', role: 'reader' };

  it('a 429 on the user attempt is the limit: one call, no second door, nothing it asked for', async () => {
    const { httpClient, calls } = nextcloud([{ status: 429, body: LIMITED }]);
    const result = await createNextcloudShare(OPTIONS(httpClient), REQUEST);
    expect(result).toMatchObject({ ok: false, said: { kind: 'answered', status: 429, ocsStatus: 429, ocs: true } });
    expect(result.ok ? undefined : shareLimitOf(result.said)).toEqual({});
    // The share by mail would only spend the same limit again.
    expect(calls).toHaveLength(1);
  });

  it('a 429 on the share by mail, after no such account, is the limit, with the wait it asked for', async () => {
    const { httpClient, calls } = nextcloud([
      { status: 404, body: NO_SUCH_ACCOUNT },
      { status: 429, body: LIMITED, headers: { 'Retry-After': '90' } },
    ]);
    const result = await createNextcloudShare(OPTIONS(httpClient), REQUEST);
    expect(result).toMatchObject({
      ok: false,
      said: { kind: 'notAnAccount', byMail: { status: 429, ocsStatus: 429, ocs: true, retryAfterSeconds: 90 } },
    });
    expect(result.ok ? undefined : shareLimitOf(result.said)).toEqual({ retryAfterSeconds: 90 });
    expect(calls).toHaveLength(2);
  });

  it('reads a Retry-After whatever case the client kept, and an HTTP date', async () => {
    const at = new Date(Date.now() + 5 * 60_000).toUTCString();
    const { httpClient } = nextcloud([{ status: 429, body: LIMITED, headers: { 'retry-after': at } }]);
    const result = await createNextcloudShare(OPTIONS(httpClient), REQUEST);
    const seconds = result.ok ? undefined : shareLimitOf(result.said)?.retryAfterSeconds;
    expect(seconds).toBeGreaterThan(290);
    expect(seconds).toBeLessThanOrEqual(300);
  });

  it('a Retry-After it does not believe is carried as asked-for, not as no header at all', async () => {
    for (const header of ['May 5', '86401']) {
      const { httpClient } = nextcloud([{ status: 429, body: LIMITED, headers: { 'Retry-After': header } }]);
      const result = await createNextcloudShare(OPTIONS(httpClient), REQUEST);
      expect(result, header).toMatchObject({ ok: false, said: { kind: 'answered', status: 429, retryAfterNotBelieved: true } });
      expect(result.ok ? undefined : (result.said as { retryAfterSeconds?: number }).retryAfterSeconds).toBeUndefined();
      expect(result.ok ? undefined : shareRefusalSaid(result.said).en, header).toContain('apply again later, as the new system asked');
    }
    // No header, or an empty one, is no wait asked for: Nextcloud's own ten minutes.
    for (const headers of [{}, { 'Retry-After': '  ' }] as Array<Record<string, string>>) {
      const { httpClient } = nextcloud([{ status: 429, body: LIMITED, headers }]);
      const result = await createNextcloudShare(OPTIONS(httpClient), REQUEST);
      expect(result.ok ? undefined : result.said).not.toHaveProperty('retryAfterNotBelieved');
      expect(result.ok ? undefined : shareRefusalSaid(result.said).en).toContain('apply again in ten minutes');
    }
  });

  it('a refusal of another kind carries no wait, even with a Retry-After beside it', async () => {
    const { httpClient } = nextcloud([
      {
        status: 403,
        body: JSON.stringify({ ocs: { meta: { status: 'failure', statuscode: 403, message: 'no' } } }),
        headers: { 'Retry-After': '30' },
      },
    ]);
    const result = await createNextcloudShare(OPTIONS(httpClient), REQUEST);
    expect(result.ok ? undefined : shareLimitOf(result.said)).toBeUndefined();
  });

  it('an address-shaped grantee still gets the user attempt first: a Nextcloud login may be an address', async () => {
    // Not saved, on purpose (workplan 0104, Status of 2026-10-25): a login may
    // hold `@` and `.`, the user share looks `shareWith` up as a user id, and
    // an install behind LDAP or user_oidc can name its accounts by address.
    // Going to the share by mail first would hand such a person a link
    // outside the account they have.
    const { httpClient, calls } = nextcloud([{ status: 200, body: OK_ENVELOPE }]);
    const result = await createNextcloudShare(OPTIONS(httpClient), REQUEST);
    expect(result).toEqual({ ok: true, via: 'user' });
    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.body)).toContain('shareType=0');
    expect(String(calls[0]!.body)).toContain('shareWith=anna%40example.nl');
  });
});
