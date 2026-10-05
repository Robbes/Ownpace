// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One read from a Moneybird administration (workplan 0111, slice 1).
 *
 * What matters here: every failure is `unavailable` with a sentence that
 * names what to fix (the token, the administration, the pace), never an empty
 * answer; a 429 carries Moneybird's `Retry-After` in seconds; and the token
 * travels in the header and in no sentence.
 */

import { describe, it, expect } from 'vitest';
import { moneybirdRead } from './moneybird-http.ts';

const TOKEN = 'not-a-real-token-and-never-printed';
const ACCESS = { administrationId: '123456789012345678', apiToken: TOKEN };

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('moneybirdRead', () => {
  it('asks the administration, with the token in the header only, and hands back the JSON', async () => {
    const { impl, calls } = fakeFetch(() => json([{ id: '1' }]));
    expect(await moneybirdRead(ACCESS, 'workflows.json', impl)).toEqual({ kind: 'ok', body: [{ id: '1' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://moneybird.com/api/v2/123456789012345678/workflows.json');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.Accept).toBe('application/json');
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('names the key to fix: the token for 401 and 403, the administration for 404', async () => {
    for (const status of [401, 403]) {
      const outcome = await moneybirdRead(ACCESS, 'workflows.json', fakeFetch(() => json({}, status)).impl);
      expect(outcome.kind).toBe('unavailable');
      if (outcome.kind === 'unavailable') expect(outcome.reason).toContain('MONEYBIRD_API_TOKEN');
    }
    const missing = await moneybirdRead(ACCESS, 'workflows.json', fakeFetch(() => json({}, 404)).impl);
    expect(missing.kind).toBe('unavailable');
    if (missing.kind === 'unavailable') expect(missing.reason).toContain('MONEYBIRD_ADMINISTRATION_ID');
  });

  it('a 429 says to slow down and carries Retry-After in seconds, given as seconds or as a date', async () => {
    const seconds = await moneybirdRead(
      ACCESS,
      'workflows.json',
      fakeFetch(() => json({}, 429, { 'Retry-After': '30' })).impl,
    );
    expect(seconds).toMatchObject({ kind: 'unavailable', retryAfterSeconds: 30 });
    if (seconds.kind === 'unavailable') expect(seconds.reason).toContain('slow down');

    const at = new Date(Date.now() + 90_000).toUTCString();
    const dated = await moneybirdRead(ACCESS, 'workflows.json', fakeFetch(() => json({}, 429, { 'Retry-After': at })).impl);
    expect(dated.kind).toBe('unavailable');
    if (dated.kind === 'unavailable') {
      expect(dated.retryAfterSeconds).toBeGreaterThanOrEqual(85);
      expect(dated.retryAfterSeconds).toBeLessThanOrEqual(91);
    }

    const bare = await moneybirdRead(ACCESS, 'workflows.json', fakeFetch(() => json({}, 429)).impl);
    expect(bare.kind).toBe('unavailable');
    if (bare.kind === 'unavailable') expect(bare.retryAfterSeconds).toBeUndefined();
  });

  it('anything else is unavailable, never an empty answer, and no sentence carries the token', async () => {
    const outcomes = await Promise.all(
      [
        fakeFetch(() => json({}, 500)).impl,
        fakeFetch(() => new Response('<html>', { status: 200 })).impl,
        (async () => {
          throw new Error('getaddrinfo ENOTFOUND moneybird.com');
        }) as unknown as typeof fetch,
      ].map((impl) => moneybirdRead(ACCESS, 'tax_rates.json', impl)),
    );
    expect(outcomes.map((o) => o.kind)).toEqual(['unavailable', 'unavailable', 'unavailable']);
    for (const outcome of outcomes) {
      if (outcome.kind === 'unavailable') expect(outcome.reason).not.toContain(TOKEN);
    }
  });
});
