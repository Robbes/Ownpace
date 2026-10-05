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
 *
 * AND IN ANY CASE (2026-10-05, found by the review of #1495). The patterns
 * knew only `grant`, `view` and `api` in lower case. The access log wrote the
 * link of every request it did not match, so `POST /API/GRANT/<link>/x` was
 * written in full. Express routes without regard to case, its default:
 * `GET /API/GRANT/<link>` reaches the grant route's link check. The web app's
 * router matches without regard to case too, so `/GRANT/<link>` opens the
 * grant page, and its calls carry that address as their Referer. So the route
 * words are now read in any case, and the rest of the line is kept as it was.
 *
 * AND IN ANY SPELLING (found by the review of that change). The web app's
 * router decodes a percent escape before it matches, so `/%67rant/<link>`
 * opens the grant page too, and its calls carry that Referer. Each letter of a
 * route word may be its escape. Three more lines kept a link, and are held
 * here through the real app: the line for a body the parser could not read
 * (`unreadable-body.ts`), the router's refusal of a link it could not decode
 * (`undecodable-path.ts`), and a request sent with an absolute target
 * (`GET http://host/api/grant/<link>`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { connect, type AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import express from 'express';
import request from 'supertest';
import { log } from '@openmig/shared';
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

  // A marker, not a link: nothing here was ever a credential.
  it.each([
    ['/API/GRANT/Zq9-CASE-MARK/x', '/API/GRANT/:link/x'],
    ['/Api/View/Zq9-CASE-MARK', '/Api/View/:link'],
    ['/GRANT/Zq9-CASE-MARK', '/GRANT/:link'],
    ['/View/Zq9-CASE-MARK/x?y=1', `/View/:link/x${QUERY_MARK}`],
    ['/api/Grant/Zq9-CASE-MARK/google/authorize', '/api/Grant/:link/google/authorize'],
  ])('keeps the route of %s in its own case, and not its link', (url, kept) => {
    expect(loggableUrl(url)).toBe(kept);
  });

  it('leaves a route that only begins like a link route as it was, in any case', () => {
    expect(loggableUrl('/API/GRANTS/abc')).toBe('/API/GRANTS/abc');
    expect(loggableUrl('/Api/Viewer/abc')).toBe('/Api/Viewer/abc');
  });

  // The web app's router decodes the path before it matches: each of these
  // opens the grant or the view page. Every letter's escape is here once, in
  // lower case and in upper case.
  it.each([
    ['/%67rant/Zq9-ENC-MARK', '/%67rant/:link'],
    ['/gr%61nt/Zq9-ENC-MARK/x', '/gr%61nt/:link/x'],
    ['/%47RANT/Zq9-ENC-MARK?y=1', `/%47RANT/:link${QUERY_MARK}`],
    ['/%76iew/Zq9-ENC-MARK', '/%76iew/:link'],
    ['/api/%67rant/Zq9-ENC-MARK', '/api/%67rant/:link'],
    ['/%61%70%69/%67%72%61%6e%74/Zq9-ENC-MARK', '/%61%70%69/%67%72%61%6e%74/:link'],
    ['/%41%50%49/%47%52%41%4E%54/Zq9-ENC-MARK', '/%41%50%49/%47%52%41%4E%54/:link'],
    ['/%76%69%65%77/Zq9-ENC-MARK', '/%76%69%65%77/:link'],
    ['/%56%49%45%57/Zq9-ENC-MARK', '/%56%49%45%57/:link'],
  ])('keeps the route of %s as it was written, and not its link', (url, kept) => {
    expect(loggableUrl(url)).toBe(kept);
  });

  it('leaves an escape that is not a route word as it was', () => {
    // Encoded twice: the router decodes once, reads `%67rant`, and opens no link page.
    expect(loggableUrl('/%2567rant/abc')).toBe('/%2567rant/abc');
    expect(loggableUrl('/%67rants/abc')).toBe('/%67rants/abc');
    expect(loggableUrl('/%68rant/abc')).toBe('/%68rant/abc');
  });

  // A request may name its target in absolute form, and Express routes it by
  // its path. Only a direct connection to the API sends one: nginx passes the
  // path alone.
  it('keeps the origin and the route of an absolute target, and not its link', () => {
    expect(loggableUrl('http://app.example.test/api/grant/Zq9-ABS-MARK/x?code=1')).toBe(
      `http://app.example.test/api/grant/:link/x${QUERY_MARK}`,
    );
    expect(loggableUrl('HTTP://app.example.test/API/GRANT/Zq9-ABS-MARK')).toBe(
      'HTTP://app.example.test/API/GRANT/:link',
    );
    expect(loggableUrl('http://app.example.test/api/grants/abc')).toBe('http://app.example.test/api/grants/abc');
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

  it('keeps the route in its own case, and not the link', () => {
    expect(loggableReferrer('https://app.example.test/Grant/Zq9-CASE-MARK')).toBe(
      'https://app.example.test/Grant/:link',
    );
    expect(loggableReferrer('https://app.example.test/API/VIEW/Zq9-CASE-MARK?y=1')).toBe(
      `https://app.example.test/API/VIEW/:link${QUERY_MARK}`,
    );
  });

  it('keeps the route of a page whose route word is an escape, and not the link', () => {
    expect(loggableReferrer('https://app.example.test/%67rant/Zq9-ENC-MARK')).toBe(
      'https://app.example.test/%67rant/:link',
    );
    expect(loggableReferrer('https://app.example.test/%56IEW/Zq9-ENC-MARK?y=1')).toBe(
      `https://app.example.test/%56IEW/:link${QUERY_MARK}`,
    );
  });

  it('reads the scheme and the host as before', () => {
    // The host in any case, as it always was.
    expect(loggableReferrer('https://APP.example.test/grant/Zq9-CASE-MARK')).toBe(
      'https://APP.example.test/grant/:link',
    );
    // A scheme not in lower case was never taken for a URL, and still is not.
    expect(loggableReferrer('HTTPS://app.example.test/Grant/Zq9-CASE-MARK')).toBe('-');
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

describe('through a real request, in capitals', () => {
  it('writes no link, whatever the case of the route', async () => {
    const lines: string[] = [];
    const server = express();
    server.use(accessLog({ write: (line) => void lines.push(line) }));
    server.all('*splat', (_req, res) => void res.status(200).json({ ok: true }));
    await request(server)
      .post('/API/GRANT/SECRET-LINK-CAPS/x')
      .set('Referer', 'https://app.example.test/Grant/SECRET-LINK-CAPS');
    await request(server).get('/Api/View/SECRET-VIEW-CAPS');
    for (let i = 0; i < 50 && lines.length < 2; i++) await new Promise((r) => setImmediate(r));

    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).not.toMatch(/SECRET/);
    expect(lines[0]).toContain('"POST /API/GRANT/:link/x HTTP/1.1" 200');
    expect(lines[0]).toContain('"https://app.example.test/Grant/:link"');
    expect(lines[1]).toContain('"GET /Api/View/:link HTTP/1.1" 200');
  });
});

/**
 * THROUGH THE API ITSELF. The app `index.ts` builds, with its own access log
 * on stdout, its own routes and its own error handlers. Every line anything
 * writes is caught: the access log, `log` at any level, and the console. No
 * database is set, so a request that reaches a link route is answered by its
 * fault, which is written too.
 */
describe('through the API itself', () => {
  const MARK = 'Zq9-CASE-MARK-API';
  let lines: string[] = [];

  beforeEach(() => {
    lines = [];
    const keep = (chunk: unknown) => void lines.push(String(chunk));
    /** A line as the console prints it: an error with its message and stack. */
    const said = (...args: unknown[]) => keep(args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' '));
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (keep(chunk), true));
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (keep(chunk), true));
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation(said);
    // Whatever LOG_LEVEL the run has: every line `log` is asked to write.
    for (const level of ['error', 'warn', 'info', 'debug'] as const) vi.spyOn(log, level).mockImplementation(said);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The access log's lines, once `count` of them are written. */
  async function accessLines(count: number): Promise<string[]> {
    const access = () => lines.filter((l) => l.includes(' HTTP/1.1"'));
    for (let i = 0; i < 50 && access().length < count; i++) await new Promise((r) => setImmediate(r));
    return access();
  }

  it('writes no link for a route in capitals, in any line', async () => {
    const { default: app } = await import('./index.ts');
    // No route takes POST here: a 404, and the access log writes every request.
    await request(app)
      .post(`/API/GRANT/${MARK}/x`)
      .set('Referer', `https://app.example.test/Grant/${MARK}`);
    // Express routes without regard to case: this reaches the grant route's
    // link check, and is not a 404.
    const reached = await request(app).get(`/API/GRANT/${MARK}`);
    expect(reached.status).not.toBe(404);
    await request(app)
      .get(`/Api/View/${MARK}`)
      .set('Referrer', `https://app.example.test/View/${MARK}`);

    const access = await accessLines(3);
    expect(access).toHaveLength(3);
    expect(access[0]).toContain('"POST /API/GRANT/:link/x HTTP/1.1" 404');
    expect(access[0]).toContain('"https://app.example.test/Grant/:link"');
    expect(access[1]).toContain('"GET /API/GRANT/:link HTTP/1.1"');
    expect(access[2]).toContain('"GET /Api/View/:link HTTP/1.1"');
    expect(access[2]).toContain('"https://app.example.test/View/:link"');
    for (const line of lines) expect(line).not.toContain(MARK);
  }, 60_000);

  it('writes no link for a page whose route word is an escape, in any line', async () => {
    const { default: app } = await import('./index.ts');
    // The grant page at `/%67rant/<link>` makes its calls with this Referer.
    await request(app).get('/api/connections').set('Referer', `https://app.example.test/%67rant/${MARK}`);
    // Express does not route an escape (a 404); the line still drops the link.
    const notRouted = await request(app).get(`/api/%67rant/${MARK}`);
    expect(notRouted.status).toBe(404);

    const access = await accessLines(2);
    expect(access).toHaveLength(2);
    expect(access[0]).toContain('"https://app.example.test/%67rant/:link"');
    expect(access[1]).toContain('"GET /api/%67rant/:link HTTP/1.1" 404');
    for (const line of lines) expect(line).not.toContain(MARK);
  }, 60_000);

  it('writes no link for a body the parser could not read, in any case (#1495)', async () => {
    const { default: app } = await import('./index.ts');
    const res = await request(app)
      .post(`/API/GRANT/${MARK}/x`)
      .set('Content-Type', 'application/json')
      .send('{"x":');
    expect(res.status).toBe(400);

    await accessLines(1);
    expect(lines.filter((l) => l.includes('a body the parser could not read'))).toEqual([
      '[api] POST /API/GRANT/:link/x: a body the parser could not read (entity.parse.failed), answered 400',
    ]);
    for (const line of lines) expect(line).not.toContain(MARK);
  }, 60_000);

  it('answers a link it cannot decode as the caller\'s 400, and writes no link', async () => {
    const { default: app } = await import('./index.ts');
    const broken = await request(app).get(`/api/grant/${MARK}%ZZ`);
    const cut = await request(app).get(`/api/view/${MARK}%E0%A4%A`);
    for (const res of [broken, cut]) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'path_unreadable', message: 'The request path could not be read.' });
    }

    const access = await accessLines(2);
    expect(access[0]).toContain('"GET /api/grant/:link HTTP/1.1" 400');
    expect(access[1]).toContain('"GET /api/view/:link HTTP/1.1" 400');
    expect(lines.filter((l) => l.includes('could not decode'))).toEqual([
      '[api] GET /api/grant/:link: a path the router could not decode, answered 400',
      '[api] GET /api/view/:link: a path the router could not decode, answered 400',
    ]);
    // Not a fault of ours: no reference.
    expect(lines.filter((l) => l.includes('[ref '))).toEqual([]);
    for (const line of lines) expect(line).not.toContain(MARK);
  }, 60_000);

  it('writes no link for a request with an absolute target, in any case', async () => {
    const { default: app } = await import('./index.ts');
    const server = app.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    /** One request as written, on a socket of its own: supertest sends the path alone. */
    const sentRaw = (target: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = connect({ port }, () =>
          socket.write(`GET ${target} HTTP/1.1\r\nHost: app.example.test\r\nConnection: close\r\n\r\n`),
        );
        let answer = '';
        socket.on('data', (data) => (answer += String(data)));
        socket.on('end', () => resolve(answer.split('\r\n')[0] ?? ''));
        socket.on('error', reject);
      });
    try {
      // Express routes these by their path: each reaches the grant route.
      expect(await sentRaw(`http://app.example.test/api/grant/${MARK}`)).not.toContain('404');
      expect(await sentRaw(`HTTP://app.example.test/API/GRANT/${MARK}`)).not.toContain('404');
    } finally {
      server.close();
    }

    const access = await accessLines(2);
    expect(access[0]).toContain('"GET http://app.example.test/api/grant/:link HTTP/1.1"');
    expect(access[1]).toContain('"GET HTTP://app.example.test/API/GRANT/:link HTTP/1.1"');
    for (const line of lines) expect(line).not.toContain(MARK);
  }, 60_000);
});

describe('the API', () => {
  it('writes its access log through the loggable format, not `combined`', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/app\.use\(accessLog\(\)\)/);
    expect(source).not.toMatch(/morgan\(/);
  });
});
