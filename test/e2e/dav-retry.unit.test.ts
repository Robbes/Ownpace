// Copyright 2026 The Ownpace authors (Apache-2.0)

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-expect-error -- the e2e helpers are plain .mjs with no type declarations.
import { davFetch, isRetryableStatus } from './dav-retry.mjs';

/**
 * The body Nextcloud actually returned in scheduled e2e run 31772487201, which is
 * what these tests exist to stop failing a run again.
 */
const LOCKED_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:error xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns">' +
  '<s:message>An exception occurred while executing a query: SQLSTATE[HY000]: ' +
  'General error: 5 database is locked</s:message></d:error>';

const servers: http.Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/**
 * A server that answers with `statuses` in order, repeating the last one forever,
 * and records what it was actually asked for.
 */
async function serverAnswering(statuses: number[]): Promise<{ url: string; seen: number[] }> {
  const seen: number[] = [];
  let index = 0;
  const server = http.createServer((_req, res) => {
    const status = statuses[Math.min(index, statuses.length - 1)]!;
    index += 1;
    seen.push(status);
    res.writeHead(status, { 'Content-Type': 'application/xml' });
    res.end(status >= 500 ? LOCKED_BODY : '');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/event.ics`, seen };
}

describe('davFetch', () => {
  it('retries the "database is locked" 500 that failed the scheduled e2e, and succeeds', async () => {
    const { url, seen } = await serverAnswering([500, 204]);

    const response = await davFetch(url, { method: 'DELETE' }, { attempts: 3 });

    expect(response.status).toBe(204);
    // The point of the fix: the server was asked TWICE. One request means no retry.
    expect(seen).toEqual([500, 204]);
  });

  it('keeps retrying while the lock persists', async () => {
    const { url, seen } = await serverAnswering([500, 500, 200]);

    const response = await davFetch(url, { method: 'PUT' }, { attempts: 4 });

    expect(response.status).toBe(200);
    expect(seen).toEqual([500, 500, 200]);
  });

  it('gives up after the attempt budget and returns the failure rather than hanging', async () => {
    const { url, seen } = await serverAnswering([500]);

    const response = await davFetch(url, { method: 'DELETE' }, { attempts: 3 });

    expect(response.status).toBe(500);
    expect(seen).toHaveLength(3);
    // The caller still gets the body, so the real error reaches the log.
    await expect(response.text()).resolves.toContain('database is locked');
  });

  // The other half of the contract, and the one a careless "just retry everything"
  // would break: a real error must come back at once, not several seconds later.
  it.each([
    ['404 not found', 404],
    ['401 unauthorized', 401],
    ['403 forbidden', 403],
    ['415 unsupported media type', 415],
  ])('does NOT retry %s', async (_label, status) => {
    const { url, seen } = await serverAnswering([status]);

    const response = await davFetch(url, { method: 'DELETE' }, { attempts: 3 });

    expect(response.status).toBe(status);
    expect(seen).toEqual([status]);
  });

  it.each([
    ['423 WebDAV Locked', 423],
    ['429 too many requests', 429],
  ])('retries %s — the server is saying come back', async (_label, status) => {
    const { url, seen } = await serverAnswering([status, 204]);

    const response = await davFetch(url, { method: 'MOVE' }, { attempts: 3 });

    expect(response.status).toBe(204);
    expect(seen).toEqual([status, 204]);
  });
});

describe('isRetryableStatus', () => {
  it('classifies exactly the transient statuses', () => {
    for (const status of [500, 502, 503, 504, 423, 429]) {
      expect(isRetryableStatus(status), `${status} should be retryable`).toBe(true);
    }
    for (const status of [200, 201, 204, 207, 400, 401, 403, 404, 409, 415]) {
      expect(isRetryableStatus(status), `${status} should NOT be retryable`).toBe(false);
    }
  });
});
