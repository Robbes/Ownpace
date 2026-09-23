// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROBLEM REPORT THAT REACHES A PERSON (workplan 0130 T1, T2).
 *
 * A signed-in customer's report becomes a ticket on the owner's own Zammad,
 * with the page they were on (never a link secret), the error's category and
 * reference, and a screenshot if they add one; the owner's reply reaches them
 * by email. Driven through the real route with Zammad faked at `fetch`.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAppEventSink, type AppEvent } from '@openmig/shared';
import {
  MAX_SCREENSHOT_BYTES,
  imageTypeOf,
  isRefusal,
  parseProblemReport,
  ticketFor,
  type ProblemReport,
} from './problem-report.ts';
import { createZammadTicket, zammadConfigFrom, ZammadMisconfigured, ZammadRefused } from './services/zammad.ts';
import { createKnockLimiter } from './knock-limit.ts';

const TENANT = '0e260000-e29b-41d4-a716-446655440001';

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  return {
    ...actual,
    // Signed in as the header says, or with no address when it says none.
    authenticate: (req: Record<string, unknown> & { headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.userId = req.headers['x-test-user'] ?? 'user-1';
      const email = req.headers['x-test-email'];
      if (email !== 'none') req.userEmail = email ?? 'someone@example.invalid';
      req.tenantId = TENANT;
      next();
    },
  };
});

const { problemReportRoutes } = await import('./routes/problem-reports.ts');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const CONFIGURED = { ZAMMAD_URL: 'https://help.example.invalid/', ZAMMAD_TOKEN: 'test-token-not-real' };

function zammad(answer: { status?: number; number?: unknown } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const status = answer.status ?? 201;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ id: 7, number: answer.number ?? '31001' }),
    };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function app(deps: Parameters<typeof problemReportRoutes>[0]) {
  const a = express();
  a.use('/api/problem-reports', problemReportRoutes(deps));
  return a;
}

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

describe('what a report may carry', () => {
  const ok = (body: Record<string, unknown>) => {
    const parsed = parseProblemReport({ description: 'The Moves screen is empty', page: '/moves', ...body });
    if (isRefusal(parsed)) throw new Error(`refused: ${parsed.field}`);
    return parsed;
  };

  it('keeps what the person wrote, trimmed', () => {
    expect(ok({ description: '  It stopped.  ' }).description).toBe('It stopped.');
  });

  it('refuses an empty or overlong description', () => {
    expect(parseProblemReport({ description: '   ', page: '/' })).toMatchObject({ field: 'description' });
    expect(parseProblemReport({ description: 'x'.repeat(5001), page: '/' })).toMatchObject({ field: 'description' });
  });

  it('records the page without a link secret or a query, however the browser sent it', () => {
    expect(ok({ page: '/grant/abc.secretpart/google' }).page).toBe('/grant/:link/google');
    expect(ok({ page: '/mappings/1?code=4/0AbCd&state=x' }).page).toBe('/mappings/1?...');
  });

  it('refuses a page that is not a path on this site', () => {
    expect(parseProblemReport({ description: 'x', page: 'https://elsewhere.invalid/' })).toMatchObject({ field: 'page' });
  });

  it('takes a reference and a category only in their own shapes', () => {
    expect(ok({ reference: '0a1b2c3d', category: 'unknown' })).toMatchObject({ reference: '0a1b2c3d', category: 'unknown' });
    expect(parseProblemReport({ description: 'x', page: '/', reference: 'my ref' })).toMatchObject({ field: 'reference' });
    expect(parseProblemReport({ description: 'x', page: '/', category: 'it broke' })).toMatchObject({ field: 'category' });
  });

  it('takes a PNG or a JPEG screenshot, known by its first bytes', () => {
    expect(imageTypeOf(PNG)).toBe('image/png');
    expect(imageTypeOf(JPEG)).toBe('image/jpeg');
    expect(ok({ screenshot: { data: PNG.toString('base64') } }).screenshot?.type).toBe('image/png');
  });

  it('refuses a file that only claims to be a picture, and one over 5 MB', () => {
    const text = Buffer.from('not a picture at all').toString('base64');
    expect(parseProblemReport({ description: 'x', page: '/', screenshot: { data: text, type: 'image/png' } })).toMatchObject({
      field: 'screenshot',
      status: 400,
    });
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_SCREENSHOT_BYTES)]).toString('base64');
    expect(parseProblemReport({ description: 'x', page: '/', screenshot: { data: big } })).toMatchObject({
      field: 'screenshot',
      status: 413,
    });
  });
});

describe('the ticket it becomes', () => {
  const report: ProblemReport = {
    description: 'The Moves screen is empty\nafter the last pass',
    page: '/moves',
    reference: '0a1b2c3d',
    category: 'unknown',
    screenshot: { type: 'image/jpeg', data: JPEG.toString('base64') },
  };

  it("is the reporter's own, so the owner's reply reaches them by email", () => {
    const ticket = ticketFor(report, { email: 'someone@example.invalid', tenantId: TENANT }, 'Users');
    expect(ticket.customer_id).toBe('guess:someone@example.invalid');
    expect(ticket.group).toBe('Users');
  });

  it('is plain text, titled by the first line, with the facts under what the person wrote', () => {
    const ticket = ticketFor(report, { email: 'someone@example.invalid', tenantId: TENANT }, 'Users');
    expect(ticket.title).toBe('Ownpace: The Moves screen is empty');
    expect(ticket.article.content_type).toBe('text/plain');
    expect(ticket.article.body).toBe(
      'The Moves screen is empty\nafter the last pass\n\n---\n' +
        `Page: /moves\nReference: 0a1b2c3d\nCategory: unknown\nOrganisation: ${TENANT}`,
    );
  });

  it('carries the screenshot as an attachment of its own type', () => {
    const ticket = ticketFor(report, { email: 'someone@example.invalid' }, 'Users');
    expect(ticket.article.attachments).toEqual([
      { filename: 'screenshot.jpg', data: JPEG.toString('base64'), 'mime-type': 'image/jpeg' },
    ]);
  });
});

describe("the owner's Zammad", () => {
  it('is not set up without an address and a token', () => {
    expect(zammadConfigFrom({})).toBeUndefined();
    expect(zammadConfigFrom({ ZAMMAD_URL: 'https://help.example.invalid' })).toBeUndefined();
  });

  it('is reached over https only, or http on localhost', () => {
    expect(zammadConfigFrom(CONFIGURED)).toEqual({
      url: 'https://help.example.invalid',
      token: 'test-token-not-real',
      group: 'Users',
    });
    expect(() => zammadConfigFrom({ ...CONFIGURED, ZAMMAD_URL: 'http://help.example.invalid' })).toThrow(
      ZammadMisconfigured,
    );
    expect(zammadConfigFrom({ ...CONFIGURED, ZAMMAD_URL: 'http://localhost:8080', ZAMMAD_GROUP: 'Support' })).toMatchObject({
      url: 'http://localhost:8080',
      group: 'Support',
    });
  });

  it('is sent the ticket with the token, and answers its number', async () => {
    const { calls, fetchImpl } = zammad({ number: 31002 });
    const config = zammadConfigFrom(CONFIGURED)!;

    expect(await createZammadTicket(config, { title: 't' }, fetchImpl)).toBe('31002');
    expect(calls[0]!.url).toBe('https://help.example.invalid/api/v1/tickets');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Token token=test-token-not-real');
  });

  it('refuses a ticket Zammad did not make', async () => {
    const { fetchImpl } = zammad({ status: 422 });
    await expect(createZammadTicket(zammadConfigFrom(CONFIGURED)!, {}, fetchImpl)).rejects.toThrow(ZammadRefused);
  });
});

describe('the route', () => {
  let events: AppEvent[];
  beforeEach(() => {
    events = [];
    setAppEventSink({ record: async (e) => void events.push(e) });
  });

  it('offers the form only when Zammad is set up', async () => {
    expect((await request(app({ env: {} })).get('/api/problem-reports/available')).body).toEqual({ available: false });
    expect((await request(app({ env: CONFIGURED })).get('/api/problem-reports/available')).body).toEqual({
      available: true,
    });
  });

  it('refuses to send when it is not', async () => {
    const res = await request(app({ env: {} })).post('/api/problem-reports').send({ description: 'x', page: '/' });
    expect(res.status).toBe(503);
  });

  it('delivers a report as a ticket, and answers its number and nothing else', async () => {
    const { calls, fetchImpl } = zammad();
    const res = await request(app({ env: CONFIGURED, fetchImpl }))
      .post('/api/problem-reports')
      .send({ description: 'It stopped', page: '/grant/abc.secret', screenshot: { data: PNG.toString('base64') } });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ticket: '31001' });
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent.customer_id).toBe('guess:someone@example.invalid');
    expect(sent.article.body).toContain('Page: /grant/:link');
    expect(JSON.stringify(sent)).not.toContain('abc.secret');
    expect(JSON.stringify(res.body)).not.toContain('test-token-not-real');
  });

  it('takes a screenshot of several megabytes, which the global parser would refuse', async () => {
    const { fetchImpl } = zammad();
    const three = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]).toString('base64');
    const res = await request(app({ env: CONFIGURED, fetchImpl }))
      .post('/api/problem-reports')
      .send({ description: 'x', page: '/', screenshot: { data: three } });
    expect(res.status).toBe(201);
  });

  it('says which field is wrong', async () => {
    const res = await request(app({ env: CONFIGURED, fetchImpl: zammad().fetchImpl }))
      .post('/api/problem-reports')
      .send({ description: '', page: '/' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_report', field: 'description' });
  });

  it('refuses a sign-in with no address, since a reply could not reach it', async () => {
    const res = await request(app({ env: CONFIGURED, fetchImpl: zammad().fetchImpl }))
      .post('/api/problem-reports')
      .set('x-test-email', 'none')
      .send({ description: 'x', page: '/' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_reply_address');
  });

  it('allows five reports an hour per person, and says when to try again', async () => {
    const limiter = createKnockLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
    const a = app({ env: CONFIGURED, fetchImpl: zammad().fetchImpl, limiter });
    for (let i = 0; i < 5; i += 1) {
      expect((await request(a).post('/api/problem-reports').send({ description: 'x', page: '/' })).status).toBe(201);
    }
    const sixth = await request(a).post('/api/problem-reports').send({ description: 'x', page: '/' });
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    // Somebody else is not held up by it.
    const other = await request(a).post('/api/problem-reports').set('x-test-user', 'user-2').send({ description: 'x', page: '/' });
    expect(other.status).toBe(201);
  });

  it('says a report was not delivered, with a reference the log page finds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app({ env: CONFIGURED, fetchImpl: zammad({ status: 500 }).fetchImpl }))
      .post('/api/problem-reports')
      .send({ description: 'x', page: '/' });

    expect(res.status).toBe(502);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: 'error', event: 'report.not-delivered', tenantId: TENANT });
    expect(res.body.reason).toContain(`Reference ${events[0]!.reference}`);
  });
});

describe('the API', () => {
  it('mounts the report route before its global JSON parser, whose limit a screenshot exceeds', () => {
    const index = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');
    const route = index.indexOf("app.use('/api/problem-reports'");
    const parser = index.indexOf('app.use(express.json())');
    expect(route).toBeGreaterThan(-1);
    expect(parser).toBeGreaterThan(-1);
    expect(route).toBeLessThan(parser);
  });
});
