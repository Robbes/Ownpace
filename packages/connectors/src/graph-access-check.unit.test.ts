// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Proving the consent runbook worked (workplan 0027 T0).
 *
 * The question behind every test: after a fifteen-minute setup with six places
 * to go wrong, does the output send somebody to the RIGHT one? A probe that
 * says "it doesn't work" costs an hour of re-doing steps that were already
 * right, so most of these are about telling failures apart rather than
 * detecting them.
 */

import { describe, it, expect, vi } from 'vitest';
import { checkGraphAccess, renderAccessCheck } from './graph-access-check.ts';
import type { HttpClient } from './dav-http.types.ts';

const token = async () => 'tok';

function answering(fn: (url: string) => { status: number; body: string }): HttpClient {
  return {
    request: vi.fn(async ({ url }: { url: string }) => ({ ...fn(url), headers: {} })),
  } as unknown as HttpClient;
}

const allGood = answering(() => ({ status: 200, body: '{"value":[]}' }));

describe('when everything is consented', () => {
  it('passes every capability and says what that means', async () => {
    const result = await checkGraphAccess(token, allGood, { mailbox: 'gedeeld@acme.nl' });

    expect(result.allOk).toBe(true);
    expect(result.probes).toHaveLength(4);
    expect(renderAccessCheck(result)).toContain('will produce real findings');
  });

  it('asks for ONE record per capability, not a listing', async () => {
    await checkGraphAccess(token, allGood, { mailbox: 'gedeeld@acme.nl' });

    // This answers "may I", not "what is there". A setup command that pulled a
    // tenant's whole directory to answer it would be a surprising thing to run.
    const calls = (allGood.request as unknown as { mock: { calls: Array<[{ url: string }]> } })
      .mock.calls;
    for (const [req] of calls) expect(req.url).toContain('$top=1');
  });

  it('never writes', async () => {
    const http = answering(() => ({ status: 200, body: '{"value":[]}' }));
    await checkGraphAccess(token, http, { mailbox: 'x@acme.nl' });

    const calls = (http.request as unknown as { mock: { calls: Array<[{ method: string }]> } }).mock
      .calls;
    for (const [req] of calls) expect(req.method).toBe('GET');
  });

  it('escapes the mailbox into the path', async () => {
    const http = answering(() => ({ status: 200, body: '{"value":[]}' }));
    await checkGraphAccess(token, http, { mailbox: 'a b/c@acme.nl' });

    const urls = (http.request as unknown as { mock: { calls: Array<[{ url: string }]> } }).mock
      .calls.map(([r]) => r.url);
    // A raw address with a slash would address a different endpoint entirely.
    expect(urls.some((u) => u.includes('a%20b%2Fc%40acme.nl'))).toBe(true);
  });
});

describe('telling the failures apart', () => {
  it('reports a bad secret as a TOKEN failure, not four permission failures', async () => {
    const result = await checkGraphAccess(
      async () => {
        throw new Error('AADSTS7000215: Invalid client secret provided');
      },
      allGood,
    );

    // The single most common way this goes wrong, and the one where a
    // per-permission report would be actively misleading: nothing was tested,
    // so nobody should be sent to the portal to re-check consent.
    expect(result.probes).toHaveLength(1);
    expect(result.probes[0]?.capability).toContain('application token');
    expect(result.probes[0]?.detail).toContain('AADSTS7000215');
    expect(result.probes[0]?.ambiguity).toContain('no permission was tested');
  });

  it('carries Graph’s own words on a 403 rather than a summary', async () => {
    const result = await checkGraphAccess(
      token,
      answering((url) =>
        url.includes('/users?')
          ? { status: 403, body: '{"error":{"code":"Authorization_RequestDenied"}}' }
          : { status: 200, body: '{"value":[]}' },
      ),
      { mailbox: 'x@acme.nl' },
    );

    const failed = result.probes.find((p) => !p.ok);
    // The error CODE is what an operator searches for; a friendlier sentence
    // that dropped it would carry nothing they can act on.
    expect(failed?.detail).toContain('Authorization_RequestDenied');
  });

  it('names both meanings of a 403 instead of guessing one', async () => {
    const result = await checkGraphAccess(
      token,
      answering((url) =>
        url.includes('/users?') ? { status: 403, body: 'denied' } : { status: 200, body: '{}' },
      ),
      { mailbox: 'x@acme.nl' },
    );

    const failed = result.probes.find((p) => !p.ok);
    // Guessing between "the access policy excludes this app" and "consented
    // never granted" is how somebody re-does the step that was already right.
    expect(failed?.ambiguity).toContain('Application Access Policy');
    expect(failed?.ambiguity).toContain('never consented');
  });

  it('does not report a transport failure as a permission problem', async () => {
    const http = {
      request: vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    } as unknown as HttpClient;
    const result = await checkGraphAccess(token, http, { mailbox: 'x@acme.nl' });

    expect(result.probes[0]?.detail).toContain('ECONNRESET');
    expect(result.probes[0]?.ambiguity).toContain('nothing was learned');
  });

  it('keeps probing after one capability fails', async () => {
    const result = await checkGraphAccess(
      token,
      answering((url) =>
        url.includes('/groups') ? { status: 403, body: 'no' } : { status: 200, body: '{}' },
      ),
      { mailbox: 'x@acme.nl' },
    );

    // The permissions are consented individually and fail individually. One
    // bad answer must not hide the state of the other three.
    expect(result.probes.filter((p) => p.ok)).toHaveLength(3);
    expect(result.allOk).toBe(false);
  });
});

describe('what happens without a mailbox', () => {
  it('counts an untested capability as NOT ok', async () => {
    const result = await checkGraphAccess(token, allGood);

    // The line where a "0 failures" summary would become a lie: two probes
    // need a mailbox, and skipping is not passing (rule 9).
    expect(result.allOk).toBe(false);
    const skipped = result.probes.filter((p) => p.detail.startsWith('not tested'));
    expect(skipped).toHaveLength(2);
    expect(skipped[0]?.detail).toContain('--mailbox');
  });

  it('still proves the two tenant-wide capabilities', async () => {
    const result = await checkGraphAccess(token, allGood);

    // Running it before you have a shared mailbox to point at is legitimate,
    // and it should still tell you whether consent landed at all.
    expect(result.probes.filter((p) => p.ok).map((p) => p.permission)).toEqual([
      'User.Read.All',
      'Group.Read.All',
    ]);
  });
});

describe('the rendering', () => {
  it('marks each line pass or fail and never buries a failure in a summary', async () => {
    const result = await checkGraphAccess(
      token,
      answering((url) =>
        url.includes('/groups') ? { status: 403, body: 'no' } : { status: 200, body: '{}' },
      ),
      { mailbox: 'x@acme.nl' },
    );
    const text = renderAccessCheck(result);

    expect(text).toContain('FAIL');
    expect(text).toContain('OK  ');
    expect(text).toContain('Group.Read.All');
    // The closing line must not say everything is fine when one line says FAIL.
    expect(text).toContain('did not answer');
    expect(text).not.toContain('Every consented capability answered');
  });

  it('points at the runbook when something is wrong', async () => {
    const result = await checkGraphAccess(token, answering(() => ({ status: 403, body: 'no' })), {
      mailbox: 'x@acme.nl',
    });

    expect(renderAccessCheck(result)).toContain('docs/o365-application-access.md');
  });
});
