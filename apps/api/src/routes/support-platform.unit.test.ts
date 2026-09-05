// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PLATFORM STATUS THE CUSTOMER SEES, on the operator's screen (workplan
 * 0110 T5, the last half) — proved against a status page that is a real HTTP
 * server, with everything the public page does NOT show planted in its answer.
 *
 * What is asked:
 *
 *  - does the route answer the four fields per endpoint and nothing else —
 *    no probed hostname, no condition text, no error string?
 *  - does the NEWEST result decide, whichever end of the list it sits at?
 *  - is an endpoint with no result yet `unchecked`, not `down`?
 *  - is "no `STATUS_URL`" `off`, and "set but not answering" `unreachable`,
 *    with readiness served either way?
 *  - does the deadline actually reach the fetch?
 *  - does the route write no `support_read` row and touch no pool?
 *
 * `readiness` is stubbed: it is 0094's and has its own file. `authenticateSubject`
 * is stubbed the way every support test stubs it.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { foldStatusPage, readStatusPage, STATUS_PAGE_ENDPOINTS_PATH } from './platform-status.ts';

const readinessMock = vi.hoisted(() => vi.fn());
const recordSupportRead = vi.hoisted(() => vi.fn());
const poolMock = vi.hoisted(() => vi.fn(() => ({})));

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticateSubject: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      Object.assign(req, { userId: 'anybody-signed-in' });
      next();
    },
    getDbPool: poolMock,
  };
});
vi.mock('./ready.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ready.ts')>();
  return { ...actual, readiness: readinessMock };
});
vi.mock('@openmig/managed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/managed')>();
  return { ...actual, recordSupportRead };
});

const { default: supportRoutes } = await import('./support.ts');

const app = express();
app.use('/api/support', supportRoutes);

/** What the page must never let out: an internal name, a condition, an error. */
const INTERNAL_HOST = 'ownpace-idp';
const CONDITION = '[STATUS] == 200';
const ERROR_TEXT = 'dial tcp: lookup accounts.google.example: no such host';

/**
 * Gatus's `/api/v1/endpoints/statuses`, as it really answers — with the
 * newest result LAST for one endpoint and FIRST for another, so the fold's
 * order-independence is what is proved rather than assumed.
 */
const GATUS = [
  {
    name: 'Google Workspace',
    group: 'Sources',
    key: 'sources_google-workspace',
    results: [
      {
        status: 200,
        hostname: 'accounts.google.example',
        duration: 1,
        conditionResults: [{ condition: CONDITION, success: true }],
        success: true,
        timestamp: '2026-09-05T13:00:00Z',
      },
      {
        status: 503,
        hostname: 'accounts.google.example',
        duration: 1,
        conditionResults: [{ condition: CONDITION, success: false }],
        success: false,
        timestamp: '2026-09-05T13:05:00Z',
        errors: [ERROR_TEXT],
      },
    ],
  },
  {
    name: 'Identity provider',
    group: 'Ownpace',
    key: 'ownpace_identity-provider',
    results: [
      { status: 200, hostname: INTERNAL_HOST, success: true, timestamp: '2026-09-05T13:05:00Z' },
      { status: 200, hostname: INTERNAL_HOST, success: false, timestamp: '2026-09-05T13:00:00Z' },
    ],
  },
  { name: 'Website', group: 'Ownpace', key: 'ownpace_website', results: [] },
];

const READY = { status: 'ok', database: 'up', signIn: 'up' } as const;

let page: Server;
let pageUrl: string;

beforeAll(async () => {
  page = createServer((req, res) => {
    if (req.url === STATUS_PAGE_ENDPOINTS_PATH) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(GATUS));
      return;
    }
    res.statusCode = 404;
    res.end('not here');
  });
  await new Promise<void>((resolve) => page.listen(0, '127.0.0.1', resolve));
  const address = page.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  pageUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => page.close(() => resolve()));
});

beforeEach(() => {
  readinessMock.mockReset().mockResolvedValue(READY);
  recordSupportRead.mockReset();
  process.env.STATUS_URL = pageUrl;
});

describe('GET /api/support/platform', () => {
  it('answers the four fields per endpoint, the newest result deciding, and lets nothing else out', async () => {
    const res = await request(app).get('/api/support/platform');
    expect(res.status).toBe(200);
    expect(res.body.ready).toEqual(READY);
    expect(res.body.statusPage).toEqual({
      state: 'up',
      endpoints: [
        // Newest is LAST in the list, and it failed.
        { group: 'Sources', name: 'Google Workspace', state: 'down', checkedAt: '2026-09-05T13:05:00Z' },
        // Newest is FIRST in the list, and it passed.
        { group: 'Ownpace', name: 'Identity provider', state: 'up', checkedAt: '2026-09-05T13:05:00Z' },
        // No result yet: not an outage.
        { group: 'Ownpace', name: 'Website', state: 'unchecked', checkedAt: null },
      ],
    });
    // The public page shows none of these, so neither does this.
    expect(res.text).not.toContain(INTERNAL_HOST);
    expect(res.text).not.toContain('accounts.google.example');
    expect(res.text).not.toContain(CONDITION);
    expect(res.text).not.toContain(ERROR_TEXT);
    expect(res.text).not.toContain('hostname');
    expect(res.text).not.toContain('conditionResults');
  });

  it('says off when this deployment has no status page, and still serves readiness', async () => {
    delete process.env.STATUS_URL;
    const res = await request(app).get('/api/support/platform');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: READY, statusPage: { state: 'off' } });
  });

  it('says unreachable when the page does not answer, or answers with something else', async () => {
    // A port nothing listens on.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    process.env.STATUS_URL = `http://127.0.0.1:${address.port}`;
    const closed = await request(app).get('/api/support/platform');
    expect(closed.status).toBe(200);
    expect(closed.body).toEqual({ ready: READY, statusPage: { state: 'unreachable' } });

    // A server that is there but is not a status page.
    process.env.STATUS_URL = `${pageUrl}/somewhere-else`;
    const wrong = await request(app).get('/api/support/platform');
    expect(wrong.body.statusPage).toEqual({ state: 'unreachable' });
  });

  it('writes no support-read row and touches no pool — it is a read of nobody', async () => {
    const poolCalls = poolMock.mock.calls.length;
    const res = await request(app).get('/api/support/platform');
    expect(res.status).toBe(200);
    expect(recordSupportRead).not.toHaveBeenCalled();
    expect(poolMock.mock.calls.length).toBe(poolCalls);
  });
});

describe('readStatusPage', () => {
  it('hands the deadline to the fetch, so a page that never answers cannot hold the screen', async () => {
    const hangs: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error('no signal reached the fetch');
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    const started = Date.now();
    await expect(readStatusPage('http://status.invalid', hangs, 20)).resolves.toEqual({
      state: 'unreachable',
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('treats an answer that is not a list as unreachable rather than as an empty page', async () => {
    const notAList: typeof fetch = async () =>
      new Response(JSON.stringify({ message: 'hello' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    await expect(readStatusPage('http://status.invalid', notAList)).resolves.toEqual({
      state: 'unreachable',
    });
    expect(() => foldStatusPage({ message: 'hello' })).toThrow(/list of endpoints/);
  });

  it('strips a trailing slash so the path is joined once', async () => {
    const seen: string[] = [];
    const record: typeof fetch = async (url) => {
      seen.push(String(url));
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await readStatusPage('http://status.invalid///', record);
    expect(seen).toEqual([`http://status.invalid${STATUS_PAGE_ENDPOINTS_PATH}`]);
  });
});
