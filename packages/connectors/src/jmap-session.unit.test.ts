// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `loadJmapSession` (workplan 0031 T4 follow-up).
 *
 * There is exactly one thing worth testing here and it is not the happy path:
 * **does a failed request arrive as a failure?**
 *
 * `JamClient.loadSession` — the helper this replaces — is
 * `fetch(url, {headers}).then(r => r.json())`. It never checks `response.ok`,
 * so a 401 carrying a JSON body RESOLVES with the error document. Every caller
 * then reads a perfectly well-formed object that happens to have no accounts in
 * it, and reports whatever an empty session means to that caller: "the server
 * advertises nothing" in the capability probe, "could not resolve an account"
 * in the three writers. Neither is true. The server said "wrong password".
 *
 * So the transport is stubbed, never the library: mocking `jmap-jam` would
 * reinstate the very assumption that turned out to be false — that a rejected
 * credential arrives as a thrown error. Every test below drives a real
 * `Response` through the real function.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadJmapSession } from './jmap-session';

const URL_UNDER_TEST = 'http://jmap.test/.well-known/jmap';
const AUTH = 'Basic dGFyZ2V0OnB3';

/** Answer every request with this `Response`. */
function respondWith(response: Response | (() => Response)) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return typeof response === 'function' ? response() : response;
  });
  return calls;
}

/** Fail the request the way DNS/TLS/connection-refused fails it. */
function failWith(err: Error) {
  vi.stubGlobal('fetch', async () => {
    throw err;
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a session that loads', () => {
  it('returns the parsed document', async () => {
    respondWith(
      json({
        accounts: { a1: { id: 'a1', name: 'Target', email: 'target@dev.local' } },
        primaryAccounts: { 'urn:ietf:params:jmap:mail': 'a1' },
        downloadUrl: 'http://jmap.test/blob/{accountId}/{blobId}',
      }),
    );

    const session = await loadJmapSession(URL_UNDER_TEST, AUTH);
    expect(session.primaryAccounts?.['urn:ietf:params:jmap:mail']).toBe('a1');
    expect(session.accounts?.a1?.email).toBe('target@dev.local');
    expect(session.downloadUrl).toBe('http://jmap.test/blob/{accountId}/{blobId}');
  });

  it('sends the credential it was given, to the URL it was given', async () => {
    const calls = respondWith(json({}));
    await loadJmapSession(URL_UNDER_TEST, AUTH);

    // Worth asserting because a loader that quietly dropped the Authorization
    // header would still pass every other test in this file against a server
    // that allows anonymous session reads, and then fail only in production.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(URL_UNDER_TEST);
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(AUTH);
  });

  it('passes through an EMPTY session unchanged, because that is a real answer', async () => {
    // A 200 with no accounts is the server saying "you have none". It is not
    // this function's business to second-guess that — the distinction it exists
    // to draw is between an ANSWER and a FAILURE, and this is an answer.
    respondWith(json({}));
    await expect(loadJmapSession(URL_UNDER_TEST, AUTH)).resolves.toEqual({});
  });
});

describe('a rejected credential is a rejected credential', () => {
  it('THROWS on 401 — the regression this whole file exists for', async () => {
    // The body is a real JMAP problem-details document: valid JSON, which is
    // precisely why `JamClient.loadSession` resolved with it.
    respondWith(json({ type: 'about:blank', status: 401, detail: 'Unauthorized' }, 401));

    await expect(loadJmapSession(URL_UNDER_TEST, AUTH)).rejects.toThrow(/HTTP 401/);
  });

  it('leads with WHAT TO GO AND FIX on 401, before the status number', async () => {
    respondWith(new Response('nope', { status: 401 }));
    // "Authentication was REFUSED (check the username and password)" is the
    // difference between an operator checking a password and an operator
    // checking account provisioning on a server that was never the problem.
    await expect(loadJmapSession(URL_UNDER_TEST, AUTH)).rejects.toThrow(
      /Authentication was REFUSED \(check the username and password\)/,
    );
  });

  it('distinguishes 403 from 401 — a valid credential that is not permitted', async () => {
    respondWith(new Response('forbidden', { status: 403 }));
    const err = await loadJmapSession(URL_UNDER_TEST, AUTH).catch((e: Error) => e);
    // These send an operator to two different places. Checking the password
    // again is wasted effort when the password was accepted.
    expect(err).toMatchObject({ message: expect.stringMatching(/Access was FORBIDDEN/) });
    expect((err as Error).message).not.toMatch(/check the username and password/);
  });

  it('suggests the path or the product on 404, not the credential', async () => {
    respondWith(new Response('Not Found', { status: 404 }));
    await expect(loadJmapSession(URL_UNDER_TEST, AUTH)).rejects.toThrow(
      /No JMAP session document was found \(is this a JMAP server, and is the path right\?\)/,
    );
  });

  it('invents no interpretation for a status it does not recognise', async () => {
    respondWith(new Response('Service Unavailable', { status: 503 }));
    const err = await loadJmapSession(URL_UNDER_TEST, AUTH).catch((e: Error) => e as Error);
    // 503 is reported as itself. Guessing at a cause here would be the same
    // class of mistake as the bug above, only in the other direction.
    expect((err as Error).message).toMatch(/returned HTTP 503/);
    expect((err as Error).message).not.toMatch(/REFUSED|FORBIDDEN|was found/);
  });
});

describe('what the failure message carries', () => {
  it('names the URL it actually asked, so the reader can check it', async () => {
    respondWith(new Response('nope', { status: 401 }));
    await expect(loadJmapSession(URL_UNDER_TEST, AUTH)).rejects.toThrow(
      /http:\/\/jmap\.test\/\.well-known\/jmap/,
    );
  });

  it('quotes the response body, which is where the server says why', async () => {
    respondWith(new Response('account is locked out until 14:20', { status: 403 }));
    await expect(loadJmapSession(URL_UNDER_TEST, AUTH)).rejects.toThrow(/locked out until 14:20/);
  });

  it('truncates a huge body instead of pasting a whole error page into a log', async () => {
    respondWith(new Response('x'.repeat(5000), { status: 500 }));
    const err = (await loadJmapSession(URL_UNDER_TEST, AUTH).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/x{300}/);
    expect(err.message).not.toMatch(/x{301}/);
  });

  it('still reports the STATUS when the body cannot be read at all', async () => {
    // A body that throws mid-read is what a connection dropped after the
    // headers looks like. The status is the useful half and it is already in
    // hand — losing it to a body-read failure would be hard rule 9 exactly.
    const unreadable = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('socket hang up'));
        },
      }),
      { status: 502 },
    );
    respondWith(unreadable);
    await expect(loadJmapSession(URL_UNDER_TEST, AUTH)).rejects.toThrow(/returned HTTP 502/);
  });
});

describe('a request that never reached a server', () => {
  it('THROWS, saying it could not reach the server rather than blaming the answer', async () => {
    failWith(new Error('connect ECONNREFUSED 127.0.0.1:18080'));
    const err = (await loadJmapSession(URL_UNDER_TEST, AUTH).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/Could not reach the JMAP server/);
    expect(err.message).toMatch(/ECONNREFUSED 127\.0\.0\.1:18080/);
  });

  it('attaches the original error as `cause`, so the stack is not thrown away', async () => {
    const original = new Error('unable to verify the first certificate');
    failWith(original);
    const err = (await loadJmapSession(URL_UNDER_TEST, AUTH).catch((e: Error) => e)) as Error;
    expect(err.cause).toBe(original);
  });
});

describe('a 200 that is not a session', () => {
  it('THROWS rather than handing back a half-parsed object', async () => {
    // A captive portal or an SSO login page answers 200 with HTML. Returning
    // `{}` here would look exactly like "you have no accounts".
    respondWith(new Response('<html><body>Sign in</body></html>', { status: 200 }));
    const err = (await loadJmapSession(URL_UNDER_TEST, AUTH).catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/returned HTTP 200 but the body was not JSON/);
    expect(err.cause).toBeInstanceOf(Error);
  });
});
