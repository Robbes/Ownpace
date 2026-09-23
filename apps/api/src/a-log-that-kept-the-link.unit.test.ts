// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LOG THAT KEPT THE LINK.
 *
 * The API's access log was `morgan('combined')`: every request's full URL, and
 * its Referer. A grant link is a credential in the path (`/api/grant/<link>`),
 * the grant page sends its own URL, link and all, as the Referer of every call
 * it makes, and an OAuth callback carries a spendable `code` in its query. All
 * of it went to stdout, and from there to whatever collects the logs, for as
 * long as they are kept.
 *
 * These tests hold `access-log.ts` to the rule it states, first as functions
 * and then through a real request, and hold the API to using it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { accessLog, loggableReferrer, loggableUrl, QUERY_MARK } from './access-log.ts';

describe('what the log may keep of a URL', () => {
  it.each([
    ['/api/grant/q7Rk-link_credential', '/api/grant/:link'],
    ['/api/grant/q7Rk-link_credential/google/authorize', '/api/grant/:link/google/authorize'],
    ['/api/view/v13w-link', '/api/view/:link'],
    ['/grant/q7Rk-link_credential', '/grant/:link'],
    ['/view/v13w-link', '/view/:link'],
  ])('keeps the route of %s and not its link', (url, kept) => {
    expect(loggableUrl(url)).toBe(kept);
  });

  it('keeps that there was a query, and nothing it said', () => {
    expect(loggableUrl('/api/migrations/google/callback?code=4/0Ab-code&state=s1gned')).toBe(
      `/api/migrations/google/callback${QUERY_MARK}`,
    );
    expect(loggableUrl('/api/grant/q7Rk-link?x=1')).toBe(`/api/grant/:link${QUERY_MARK}`);
  });

  it('leaves a route with nothing secret in it as it was', () => {
    expect(loggableUrl('/api/connections')).toBe('/api/connections');
    // Names that merely begin like a link route are not one.
    expect(loggableUrl('/api/grants/abc')).toBe('/api/grants/abc');
    expect(loggableUrl('/api/grant/')).toBe('/api/grant/');
  });

  it('says nothing for no URL', () => {
    expect(loggableUrl(undefined)).toBe('-');
    expect(loggableUrl('')).toBe('-');
  });
});

describe('what the log may keep of a Referer', () => {
  it('keeps the origin and the route, not the link or the query', () => {
    expect(loggableReferrer('https://app.example.test/grant/q7Rk-link?from=mail')).toBe(
      `https://app.example.test/grant/:link${QUERY_MARK}`,
    );
    expect(loggableReferrer('https://app.example.test/migrations')).toBe(
      'https://app.example.test/migrations',
    );
  });

  it('does not echo a value that is not a URL', () => {
    expect(loggableReferrer('not a url q7Rk-link')).toBe('-');
    expect(loggableReferrer(undefined)).toBe('-');
  });
});

describe('through a real request', () => {
  function app() {
    const lines: string[] = [];
    const server = express();
    server.use(accessLog({ write: (line) => void lines.push(line) }));
    server.all('*splat', (_req, res) => void res.status(200).json({ ok: true }));
    /** Morgan writes when the response has finished, which can be a tick after. */
    const written = async (count: number) => {
      for (let i = 0; i < 50 && lines.length < count; i++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      return lines;
    };
    return { server, written };
  }

  it('writes no link, code or state, and keeps the method, route and status', async () => {
    const { server, written } = app();
    await request(server)
      .get('/api/grant/SECRET-LINK-ONE')
      .set('Referer', 'https://app.example.test/grant/SECRET-LINK-ONE?from=SECRET-MAIL');
    await request(server).post('/api/grant/SECRET-LINK-TWO/google/authorize');
    await request(server).get('/api/view/SECRET-VIEW');
    await request(server).get(
      '/api/migrations/google/callback?code=SECRET-CODE&state=SECRET-STATE',
    );
    // The spelling some clients send, which morgan's own token also reads.
    await request(server)
      .get('/api/view/SECRET-VIEW-TWO')
      .set('Referrer', 'https://app.example.test/view/SECRET-VIEW-TWO');

    const lines = await written(5);
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line).not.toMatch(/SECRET/);

    expect(lines[0]).toContain('"GET /api/grant/:link HTTP/1.1" 200');
    expect(lines[0]).toContain(`"https://app.example.test/grant/:link${QUERY_MARK}"`);
    expect(lines[1]).toContain('"POST /api/grant/:link/google/authorize HTTP/1.1" 200');
    expect(lines[2]).toContain('"GET /api/view/:link HTTP/1.1" 200');
    expect(lines[3]).toContain(`"GET /api/migrations/google/callback${QUERY_MARK} HTTP/1.1" 200`);
    expect(lines[4]).toContain('"https://app.example.test/view/:link"');
  });
});

describe('the API', () => {
  it('writes its access log through the loggable format, not `combined`', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/app\.use\(accessLog\(\)\)/);
    expect(source).not.toMatch(/morgan\(/);
  });
});
