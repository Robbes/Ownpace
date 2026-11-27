// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE LIMIT FOR THE WHOLE API (workplan 0178 T6; the maintainer's decision of
 * 2026-11-27).
 *
 * The signed-in routes had no request limit of their own, and only the public
 * doors had one (`knock-limit.ts` and the limits built on it). Now one limiter,
 * `express-rate-limit`, is mounted once on `/api`, before every `/api` route.
 * It is keyed by the caller's address (`req.ip`, under `TRUST_PROXY`) and
 * generous, with `API_MAX_REQUESTS_PER_MINUTE` to change it.
 *
 * What this holds:
 *
 *  - in `index.ts`, the limiter comes before every `/api` route and router, so
 *    a router added above it later turns this red, and the check is shown
 *    refusing one before it is trusted on the real file;
 *  - a burst over the limit is answered 429, with `Retry-After` and the same
 *    `{ error, message, reason, reasonNl }` the gift door answers its 429 with;
 *  - `/api/ready` is never limited, so a status page that polls it is never
 *    told the service is down because it asked too often;
 *  - two addresses do not share a budget;
 *  - the variable sets the limit, on the real app imported from `index.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  API_TOO_MANY_REQUESTS,
  DEFAULT_API_RATE_LIMIT,
  apiRateLimit,
  apiRateLimitFromEnv,
} from './api-rate-limit.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A registration in `index.ts`: `app.use(...)`, `app.get(...)` and so on, with its path. */
interface Registration {
  readonly line: number;
  readonly method: string;
  readonly path: string;
  /** The text of the arguments after the path, for finding the limiter. */
  readonly rest: string;
}

const REGISTERING = new Set(['use', 'get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);

/** Every `app.<method>('<path>', …)` in a source text, in order. */
function registrations(text: string): Registration[] {
  const sf = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Registration[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'app' &&
      REGISTERING.has(n.expression.name.text)
    ) {
      const first = n.arguments[0];
      if (first && ts.isStringLiteral(first)) {
        out.push({
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          method: n.expression.name.text,
          path: first.text,
          rest: n.arguments.slice(1).map((a) => a.getText(sf)).join(', '),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The `/api` routes registered before the limiter, or `null` when there is no limiter at all. */
function apiRoutesAboveTheLimit(text: string): Registration[] | null {
  const all = registrations(text);
  const at = all.findIndex((r) => r.method === 'use' && r.path === '/api' && /\bapiRateLimit\(/.test(r.rest));
  if (at === -1) return null;
  return all.slice(0, at).filter((r) => r.path === '/api' || r.path.startsWith('/api/'));
}

describe('in index.ts, the limiter comes before every /api route', () => {
  it('the check refuses a router mounted above the limiter, and one with no limiter at all', () => {
    const above = [
      "app.use('/api/early', earlyRoutes);",
      "app.use('/api', apiRateLimit(apiRateLimitFromEnv()));",
      "app.use('/api/later', laterRoutes);",
    ].join('\n');
    expect(apiRoutesAboveTheLimit(above)?.map((r) => r.path)).toEqual(['/api/early']);
    expect(apiRoutesAboveTheLimit("app.use('/api/later', laterRoutes);")).toBeNull();
    // A comment or a string that only names the limiter is not a mount.
    expect(apiRoutesAboveTheLimit("// app.use('/api', apiRateLimit(x));\nconst s = \"app.use('/api', apiRateLimit(x))\";")).toBeNull();
  });

  it('holds on the real file, which registers many /api routes after it', () => {
    const text = readFileSync(join(HERE, 'index.ts'), 'utf8');
    const above = apiRoutesAboveTheLimit(text);
    expect(above, 'index.ts mounts no apiRateLimit on /api').not.toBeNull();
    expect(
      above!.map((r) => `line ${r.line}: app.${r.method}('${r.path}')`),
      'these /api routes are registered before the limiter, so nothing limits them',
    ).toEqual([]);
    // Something real comes after it: the problem reports, the routers, /api/ready.
    const after = registrations(text).filter((r) => r.path.startsWith('/api/'));
    expect(after.map((r) => r.path)).toEqual(expect.arrayContaining(['/api/problem-reports', '/api/tenants', '/api/ready']));
  });
});

/** A small app, mounted the way `index.ts` mounts it. */
function appWith(max: number, trustProxy?: number) {
  const app = express();
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  app.use('/api', apiRateLimit({ windowMs: 60_000, max }));
  app.get('/api/thing', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/ready', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return app;
}

describe('a burst over the limit', () => {
  it('is answered 429 with Retry-After, in the doors\' own shape and in both languages', async () => {
    const app = appWith(3);
    for (let i = 0; i < 3; i++) expect((await request(app).get('/api/thing')).status).toBe(200);
    const refused = await request(app).get('/api/thing');
    expect(refused.status).toBe(429);
    const wait = Number(refused.headers['retry-after']);
    expect(Number.isInteger(wait)).toBe(true);
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
    expect(refused.body).toEqual({
      error: 'Too many requests',
      message: API_TOO_MANY_REQUESTS.en,
      reason: API_TOO_MANY_REQUESTS.en,
      reasonNl: API_TOO_MANY_REQUESTS.nl,
    });
  });
});

describe('/api/ready', () => {
  it('is never limited, even once the address has spent its budget', async () => {
    const app = appWith(2);
    for (let i = 0; i < 2; i++) await request(app).get('/api/thing');
    expect((await request(app).get('/api/thing')).status).toBe(429);
    for (let i = 0; i < 10; i++) expect((await request(app).get('/api/ready')).status).toBe(200);
  });
});

describe('two addresses', () => {
  it('do not share a budget', async () => {
    // One proxy in front, as on a stack that sets TRUST_PROXY: req.ip is the address it passes on.
    const app = appWith(2, 1);
    const from = (address: string) => request(app).get('/api/thing').set('X-Forwarded-For', address);
    expect((await from('192.0.2.10')).status).toBe(200);
    expect((await from('192.0.2.10')).status).toBe(200);
    expect((await from('192.0.2.10')).status).toBe(429);
    expect((await from('198.51.100.20')).status).toBe(200);
    expect((await from('198.51.100.20')).status).toBe(200);
    expect((await from('198.51.100.20')).status).toBe(429);
  });
});

describe('API_MAX_REQUESTS_PER_MINUTE', () => {
  it('sets the limit, and empty is the default', () => {
    expect(apiRateLimitFromEnv({ API_MAX_REQUESTS_PER_MINUTE: '7' })).toEqual({ windowMs: 60_000, max: 7 });
    expect(apiRateLimitFromEnv({})).toEqual(DEFAULT_API_RATE_LIMIT);
    expect(apiRateLimitFromEnv({ API_MAX_REQUESTS_PER_MINUTE: ' ' })).toEqual(DEFAULT_API_RATE_LIMIT);
  });

  it('refuses a value somebody meant to set and that is no positive whole number', () => {
    for (const raw of ['x', '0', '-5', '2.5', '1e3x']) {
      expect(() => apiRateLimitFromEnv({ API_MAX_REQUESTS_PER_MINUTE: raw }), raw).toThrow(/API_MAX_REQUESTS_PER_MINUTE/);
    }
  });

  it('defaults to a minute and a number with a wide margin over the smokes\' heaviest minute', () => {
    // smoke-managed.sh calls the API from 142 lines, one after another, and
    // polls every 2 s: about 175 in a minute if it all fell in one. A shared
    // budget on a stack without TRUST_PROXY must never bite there.
    expect(DEFAULT_API_RATE_LIMIT.windowMs).toBe(60_000);
    expect(DEFAULT_API_RATE_LIMIT.max).toBeGreaterThanOrEqual(175 * 5);
  });

  it('is what the real app reads', { timeout: 60_000 }, async () => {
    vi.stubEnv('API_MAX_REQUESTS_PER_MINUTE', '4');
    vi.resetModules();
    const { app } = await import('./index.ts');
    for (let i = 0; i < 4; i++) expect((await request(app).get('/api/health')).status).toBe(200);
    const refused = await request(app).get('/api/health');
    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBeDefined();
    // Outside /api nothing is limited: /health is what the compose healthcheck asks.
    expect((await request(app).get('/health')).status).toBe(200);
    vi.unstubAllEnvs();
  });
});
