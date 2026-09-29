// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DROPBOX THAT SAID 500 ONCE (2026-09-28; workplan 0055 T3 (e)).
 *
 * On the owner's migration, one `files/list_folder` answered 500, *"unexpected
 * error occurred"*: Dropbox's own trouble, which a second request would most
 * likely not have met. Nothing asked twice. The listing threw, and the files
 * ended for that whole pass. And the connector never waited out a 429 either,
 * against hard rule 4: its transport was a plain `fetch`, beside a shared
 * helper that does exactly that.
 *
 * What these hold, through the real transport with `fetch` stubbed:
 *
 *  1. Dropbox's own 500, 502 or 504 is asked again, and the answer that
 *     follows is the one handed on;
 *  2. after `DROPBOX_TROUBLE_ATTEMPTS` the last answer is handed back as it
 *     came, so the error the caller writes still quotes Dropbox;
 *  3. a 429 is waited out, by the shared helper;
 *  4. a refusal is never asked again;
 *  5. through the source, a folder whose listing met one 500 is listed;
 *  6. every request, a rate limit's second ask too, reaches Dropbox with
 *     Node's own `fetch`, never through `tenantFetch`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenProvider } from '@openmig/shared';
import { tenantFetch } from '@openmig/shared/reachable-host';
import { DROPBOX_TROUBLE_ATTEMPTS, DropboxFileSource, dropboxTransport } from './dropbox-file-source.ts';

/**
 * DROPBOX'S HOST IS A FIXED ONE (2026-09-29). The transport reaches it with
 * Node's own `fetch`, which the fetch guard lists for this connector
 * (`scripts/a-client-that-reaches-a-tenant-host`), and not through
 * `tenantFetch`, the client for a host a tester typed. So here `tenantFetch`
 * answers nothing: every case in this file fails if the transport asks it.
 */
vi.mock('@openmig/shared/reachable-host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmig/shared/reachable-host')>()),
  tenantFetch: vi.fn(async () => {
    throw new Error("tenantFetch was asked for Dropbox's fixed host");
  }),
}));

const tokens = { getToken: async () => ({ accessToken: 'a-token' }) } as unknown as TokenProvider;
const noPause = { pauseMs: () => 0 };
const LIST = 'https://api.dropboxapi.com/2/files/list_folder';

/** Answers `fetch` with `answers` in order, and writes down what it was asked. */
function answering(answers: Array<() => Response>): Array<{ url: string; init: RequestInit }> {
  const asked: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    asked.push({ url, init });
    const next = answers[Math.min(asked.length - 1, answers.length - 1)]!;
    return next();
  });
  return asked;
}

const trouble = (status: number) => () =>
  new Response(JSON.stringify({ error_summary: 'other/', error: 'unexpected error occurred' }), { status });
const listing = () =>
  new Response(
    JSON.stringify({
      entries: [{ '.tag': 'file', name: 'Report.pdf', path_display: '/Work/Report.pdf', id: 'id:1', size: 3, content_hash: 'h', server_modified: '2026-09-28T19:00:00Z' }],
      cursor: 'c',
      has_more: false,
    }),
    { status: 200 },
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Dropbox's own trouble", () => {
  for (const status of [500, 502, 504]) {
    it(`asks again after a ${status}, and hands on the answer that came next`, async () => {
      const asked = answering([trouble(status), listing]);
      const body = JSON.stringify({ path: '/Work' });

      const response = await dropboxTransport(tokens, noPause)(LIST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      expect(response.status).toBe(200);
      expect(asked).toHaveLength(2);
      for (const { init } of asked) {
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer a-token');
        expect(init.body).toBe(body);
      }
    });
  }

  it(`hands the last answer back as it came, after asking ${DROPBOX_TROUBLE_ATTEMPTS} times`, async () => {
    const asked = answering([trouble(500)]);

    const response = await dropboxTransport(tokens, noPause)(LIST, { method: 'POST', headers: {} });

    expect(asked).toHaveLength(DROPBOX_TROUBLE_ATTEMPTS);
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('unexpected error occurred');
  });
});

describe('a rate limit', () => {
  it('is waited out, as hard rule 4 asks', async () => {
    const asked = answering([
      () => new Response('{"error_summary":"too_many_requests/"}', { status: 429, headers: { 'Retry-After': '0' } }),
      listing,
    ]);

    const response = await dropboxTransport(tokens, noPause)(LIST, { method: 'POST', headers: {} });

    expect(response.status).toBe(200);
    expect(asked).toHaveLength(2);
  });
});

describe('a refusal', () => {
  it('is never asked again', async () => {
    const asked = answering([
      () => new Response('{"error_summary":"path/not_found/"}', { status: 409 }),
      listing,
    ]);

    const response = await dropboxTransport(tokens, noPause)(LIST, { method: 'POST', headers: {} });

    expect(response.status).toBe(409);
    expect(asked).toHaveLength(1);
  });
});

describe('through the source', () => {
  it('lists a folder whose listing met one 500', async () => {
    answering([trouble(500), listing]);
    const source = new DropboxFileSource(dropboxTransport(tokens, noPause), { rootPath: '/Work' });

    const { items } = await source.listSince({ path: '' });

    expect(items.map((i) => i.item.path)).toEqual(['Report.pdf']);
  });
});

describe("Dropbox's fixed host", () => {
  it("is reached with Node's own fetch, a rate limit's second ask too, and never through tenantFetch", async () => {
    const asked = answering([
      () => new Response('{"error_summary":"too_many_requests/"}', { status: 429, headers: { 'Retry-After': '0' } }),
      listing,
    ]);

    const response = await dropboxTransport(tokens, noPause)(LIST, { method: 'POST', headers: {} });

    expect(response.status).toBe(200);
    expect(asked.map((a) => a.url)).toEqual([LIST, LIST]);
    expect(vi.mocked(tenantFetch)).not.toHaveBeenCalled();
  });
});
