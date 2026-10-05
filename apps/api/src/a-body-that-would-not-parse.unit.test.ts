// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BODY THAT WOULD NOT PARSE (workplan 0093; found by #1490's review,
 * 2026-10-04, on a real local Postgres).
 *
 * `express.json()` refuses a body that is not JSON, and hands the refusal on
 * as an error. That error reached the API's last handler, which answers every
 * error 500 "a fault on our side" and logs the error object. For a body that
 * would not parse, that object carries the raw text as `body`, and its message
 * can quote part of it. So on `POST /api/access-requests`, the one route a
 * stranger is invited to write through, the asker's address, their note and
 * the spam trap's value reached the log. That route keeps the name and the
 * note out of the log (§17). The same held for a body too large, a charset or
 * an encoding the parser does not read, and the form parser.
 *
 * What this holds, on the real app, with the real middleware in its real
 * order (`index.ts`, imported; nothing listens):
 *
 *  - a body that is not JSON is answered 400, too large 413, and in a charset
 *    or encoding the parser does not read 415, as `{ error, message }`, with
 *    nothing of the body in it;
 *  - a compressed body that does not decompress (gzip, deflate or br bytes
 *    that are not that format, or a gzip stream cut short) is 400 too. Its
 *    error from zlib carries no `type`, so it is known by the parser that
 *    handed it on. Found by the review of this fix;
 *  - nothing of the body reaches the log at any level, even where the
 *    parser's own message quotes it;
 *  - the log gets one line: the parser's type, the method and the path, with
 *    a link in the path as the access log writes it, and no query;
 *  - none of it is a fault of ours: no reference, and no `api.unhandled`
 *    event on the operator's log page;
 *  - the report route, whose parser is its own and runs first, answers its
 *    parser's refusals the same way;
 *  - and `serverFault` never prints an error's `body`, wherever an error that
 *    carries one comes from (in `server-fault.unit.test.ts`).
 *
 * Signed in for the report route only: `authenticate` is replaced by one that
 * takes the request as signed in, the way `a-report-that-reaches-a-person`
 * does. Every other route here refuses the body before it asks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { inspect } from 'node:util';
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import type { NextFunction, Request, Response } from 'express';
import { log, setAppEventSink, type AppEvent } from '@openmig/shared';

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.userId = 'user-1';
      req.userEmail = 'someone@example.invalid';
      req.tenantId = '0e260000-e29b-41d4-a716-446655440001';
      next();
    },
  };
});

const { app } = await import('./index.ts');

/** Everything the log printed during a case, at any level, as the console would print it. */
let printed: string[] = [];
/** Every event recorded for the operator's log page during a case. */
let events: AppEvent[] = [];

const shown = (args: unknown[]): string =>
  args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: Infinity, showHidden: true }))).join(' ');

beforeEach(() => {
  printed = [];
  events = [];
  for (const level of ['error', 'warn', 'info', 'debug'] as const) {
    vi.spyOn(log, level).mockImplementation((...args: unknown[]) => {
      printed.push(`log.${level}: ${shown(args)}`);
    });
  }
  // Anything that goes around the log module.
  for (const level of ['error', 'warn', 'log', 'info', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      printed.push(`console.${level}: ${shown(args)}`);
    });
  }
  setAppEventSink({
    record: async (event: AppEvent) => {
      events.push(event);
    },
  });
});

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** What a case reads of an answer: supertest's, or the one `sentRaw` returns. */
interface Answer {
  readonly status: number;
  readonly text: string;
  readonly body: unknown;
}

/** No line of the log, and not the answer, carries any of `values`. */
function heardNowhere(res: Answer, values: readonly string[]): void {
  for (const value of values) {
    expect(res.text, `the answer echoed ${value}`).not.toContain(value);
    expect(
      printed.filter((line) => line.includes(value)),
      `the log printed ${value}, from the body`,
    ).toEqual([]);
  }
}

/** Answered as the caller's refusal, not as a fault of ours. */
function refusedAsTheCallers(res: Answer, status: number, error: string, words: RegExp): void {
  expect(res.status, res.text).toBe(status);
  expect(res.body).toEqual({ error, message: expect.stringMatching(words) });
  expect(res.text).not.toContain('fault on our side');
  expect(res.text).not.toMatch(/Reference [0-9a-f]{8}/);
  expect(events, 'recorded on the operator log page as a fault of ours').toEqual([]);
  const errors = printed.filter((line) => /^(log|console)\.error:/.test(line));
  expect(errors, 'logged at error level, as a fault of ours').toEqual([]);
}

/** The one line the refusal logs: the parser's type, the method and the path. */
function loggedOnce(type: string, methodAndPath: string): string {
  const lines = printed.filter((line) => line.includes(type));
  expect(lines, `expected one line naming ${type}; the log printed:\n${printed.join('\n')}`).toHaveLength(1);
  expect(lines[0]).toContain(methodAndPath);
  return lines[0]!;
}

const json = (path: string, body: string, contentType = 'application/json') =>
  request(app).post(path).set('content-type', contentType).send(body);

/**
 * POST these exact bytes with node:http. Not supertest: it re-encodes a
 * Buffer it is handed as JSON, so a valid gzip body reached the parser as
 * something else (the review's probe).
 */
async function sentRaw(path: string, bytes: Buffer, headers: Record<string, string>): Promise<Answer> {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const { port } = server.address() as AddressInfo;
    return await new Promise<Answer>((resolve, reject) => {
      const req = http.request(
        { port, path, method: 'POST', agent: false, headers: { ...headers, 'content-length': String(bytes.length) } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let body: unknown;
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
            resolve({ status: res.statusCode ?? 0, text, body });
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end(bytes);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('a body that is not JSON', () => {
  it('on the public request route: 400, and the address, the note and the trap stay out of the log', async () => {
    const res = await json(
      '/api/access-requests',
      '{"email":"leak-a1@example.test","website":"BAIT-A1","note":"NOTE-A1",',
    );
    heardNowhere(res, ['leak-a1', 'BAIT-A1', 'NOTE-A1']);
    refusedAsTheCallers(res, 400, 'body_not_json', /could not be read as JSON/);
    loggedOnce('entity.parse.failed', 'POST /api/access-requests');
  });

  it("where the parser's own message quotes the body, the message stays out of the log too", async () => {
    // V8 quotes the text around an unexpected token: `Unexpected token 'Q',
    // ..."{"email": QUOTED-B2"... is not valid JSON`.
    const res = await json('/api/access-requests', '{"email": QUOTED-B2}');
    heardNowhere(res, ['QUOTED-B2']);
    refusedAsTheCallers(res, 400, 'body_not_json', /could not be read as JSON/);
    loggedOnce('entity.parse.failed', 'POST /api/access-requests');
  });

  it('on a signed-in route: 400, and the password stays out of the log', async () => {
    const res = await json('/api/connections', '{"name":"CONN-C3","password":"PASS-C3",');
    heardNowhere(res, ['CONN-C3', 'PASS-C3']);
    refusedAsTheCallers(res, 400, 'body_not_json', /could not be read as JSON/);
    loggedOnce('entity.parse.failed', 'POST /api/connections');
  });

  it('on a link route: the link and the query stay out of the line, as the access log keeps them out', async () => {
    const res = await json('/api/grant/LINK-G7/google/authorize?code=CODE-G7', '{"x":"BODY-G7",');
    heardNowhere(res, ['LINK-G7', 'CODE-G7', 'BODY-G7']);
    refusedAsTheCallers(res, 400, 'body_not_json', /could not be read as JSON/);
    const line = loggedOnce('entity.parse.failed', 'POST /api/grant/:link/google/authorize');
    expect(line).not.toContain('?');
  });
});

describe('a body too large', () => {
  it('on the public request route: 413, with nothing of the body echoed or logged', async () => {
    const note = 'NOTE-D4 '.repeat(20_000);
    const res = await json('/api/access-requests', JSON.stringify({ email: 'big-d4@example.test', note }));
    heardNowhere(res, ['big-d4', 'NOTE-D4']);
    refusedAsTheCallers(res, 413, 'body_too_large', /too large/);
    loggedOnce('entity.too.large', 'POST /api/access-requests');
  });

  it('through the form parser: too many fields is 413 too', async () => {
    const form = Array.from({ length: 1_001 }, (_, i) => `f${i}=FORM-F6`).join('&');
    const res = await json('/api/billing/webhooks/mollie', form, 'application/x-www-form-urlencoded');
    heardNowhere(res, ['FORM-F6']);
    refusedAsTheCallers(res, 413, 'body_too_large', /too large/);
    loggedOnce('parameters.too.many', 'POST /api/billing/webhooks/mollie');
  });
});

describe('a body in a charset or an encoding the parser does not read', () => {
  it('a charset: 415', async () => {
    const res = await json('/api/connections', '{"name":"CHARSET-E5"}', 'application/json; charset=latin1');
    heardNowhere(res, ['CHARSET-E5']);
    refusedAsTheCallers(res, 415, 'body_encoding_unsupported', /charset or a content encoding/);
    loggedOnce('charset.unsupported', 'POST /api/connections');
  });

  it('a Content-Encoding: 415', async () => {
    const res = await request(app)
      .post('/api/access-requests')
      .set('content-type', 'application/json')
      .set('content-encoding', 'compress')
      .send('{"email":"enc-e6@example.test"}');
    heardNowhere(res, ['enc-e6']);
    refusedAsTheCallers(res, 415, 'body_encoding_unsupported', /charset or a content encoding/);
    loggedOnce('encoding.unsupported', 'POST /api/access-requests');
  });
});

describe('a compressed body that does not decompress', () => {
  // body-parser decompresses gzip, deflate and br. When the bytes are not
  // that format, zlib's error comes back wrapped as a 400 with no `type`.
  // Until the review of this fix it went on to `serverFault`: 500 "a fault
  // on our side", logged at error level and recorded as `api.unhandled`.
  const notThatFormat = Buffer.from('{"email":"zip-z1@example.test","note":"ZIP-Z1"}');

  for (const encoding of ['gzip', 'deflate', 'br'] as const) {
    it(`${encoding} bytes that are not ${encoding}: 400 on the public request route, as the caller's`, async () => {
      const res = await sentRaw('/api/access-requests', notThatFormat, {
        'content-type': 'application/json',
        'content-encoding': encoding,
      });
      heardNowhere(res, ['zip-z1', 'ZIP-Z1']);
      refusedAsTheCallers(res, 400, 'body_unreadable', /could not be read/);
      loggedOnce('content.decode.failed', 'POST /api/access-requests');
    });
  }

  it('a gzip stream cut short: 400 too', async () => {
    const whole = gzipSync(JSON.stringify({ email: 'cut-z2@example.test', note: 'CUT-Z2' }));
    const res = await sentRaw('/api/access-requests', whole.subarray(0, whole.length - 12), {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    });
    heardNowhere(res, ['cut-z2', 'CUT-Z2']);
    refusedAsTheCallers(res, 400, 'body_unreadable', /could not be read/);
    loggedOnce('content.decode.failed', 'POST /api/access-requests');
  });

  it('through the form parser: 400', async () => {
    const res = await sentRaw('/api/billing/webhooks/mollie', Buffer.from('id=FORM-Z3'), {
      'content-type': 'application/x-www-form-urlencoded',
      'content-encoding': 'gzip',
    });
    heardNowhere(res, ['FORM-Z3']);
    refusedAsTheCallers(res, 400, 'body_unreadable', /could not be read/);
    loggedOnce('content.decode.failed', 'POST /api/billing/webhooks/mollie');
  });

  it('one that decompresses is read as before: bad JSON inside is 400 body_not_json', async () => {
    // The control: the sender above sends what it is handed, and the parser
    // decompresses a body that is in the format it names.
    for (const [encoding, pack] of [
      ['gzip', gzipSync],
      ['deflate', deflateSync],
      ['br', brotliCompressSync],
    ] as const) {
      printed = [];
      const res = await sentRaw('/api/access-requests', pack('{"email":"in-z4@example.test","note":"IN-Z4",'), {
        'content-type': 'application/json',
        'content-encoding': encoding,
      });
      heardNowhere(res, ['in-z4', 'IN-Z4']);
      refusedAsTheCallers(res, 400, 'body_not_json', /could not be read as JSON/);
    }
  });
});

describe('the report route, whose parser is its own and runs first', () => {
  it('answers a body that is not JSON 400 itself, and logs nothing of it', async () => {
    // A helpdesk, so the route reaches its parser; nothing is ever sent to it.
    vi.stubEnv('ZAMMAD_URL', 'https://help.example.invalid/');
    vi.stubEnv('ZAMMAD_TOKEN', 'test-token-not-real');
    const res = await json('/api/problem-reports', '{"description":"REPORT-H8","page":"/",');
    expect(res.status, res.text).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_report' });
    expect(res.text).not.toContain('fault on our side');
    expect(events).toEqual([]);
    heardNowhere(res, ['REPORT-H8']);
  });

  it('answers a compressed body that does not decompress 400 itself, not as a fault of ours', async () => {
    vi.stubEnv('ZAMMAD_URL', 'https://help.example.invalid/');
    vi.stubEnv('ZAMMAD_TOKEN', 'test-token-not-real');
    const res = await sentRaw('/api/problem-reports', Buffer.from('{"description":"REPORT-Z5","page":"/"}'), {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    });
    expect(res.status, res.text).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_report' });
    expect(res.text).not.toContain('fault on our side');
    expect(events).toEqual([]);
    expect(printed.filter((line) => /^(log|console)\.error:/.test(line))).toEqual([]);
    heardNowhere(res, ['REPORT-Z5']);
  });
});

describe('what is not a body the caller sent goes on to serverFault', () => {
  /** Just enough Express to see whether the refusal answered or passed the error on. */
  async function handled(err: unknown): Promise<{ passedOn: unknown[]; status?: number }> {
    const { unreadableBody } = await import('./unreadable-body.ts');
    const passedOn: unknown[] = [];
    const sent: { status?: number } = {};
    const res = {
      status(code: number) {
        sent.status = code;
        return this;
      },
      json() {
        return this;
      },
    } as unknown as Response;
    const req = { method: 'POST', baseUrl: '', path: '/api/x', originalUrl: '/api/x' } as unknown as Request;
    unreadableBody(err, req, res, ((e: unknown) => passedOn.push(e)) as NextFunction);
    return { passedOn, ...sent };
  }

  it("a parser's 5xx (a stream it could not read) is a fault of ours", async () => {
    const err = Object.assign(new Error('stream is not readable'), {
      status: 500,
      statusCode: 500,
      expose: false,
      type: 'stream.not.readable',
    });
    const { passedOn, status } = await handled(err);
    expect(passedOn).toEqual([err]);
    expect(status).toBeUndefined();
  });

  it('an error that is not the parser’s', async () => {
    const err = new Error('boom');
    const { passedOn, status } = await handled(err);
    expect(passedOn).toEqual([err]);
    expect(status).toBeUndefined();
  });
});
