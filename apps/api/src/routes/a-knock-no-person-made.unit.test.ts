// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A KNOCK NO PERSON MADE (workplan 0093 T2d; the owner, 2026-10-04).
 *
 * `POST /api/access-requests` is the one route a stranger is invited to
 * write through. Each request is a row in the operator's queue and an
 * `access_requested` mail to the operator. Before this, the only thing in
 * front of it was the rate limit, and the public site's buttons lead here.
 *
 * The owner chose *"Honeypot now (Recommended)"*: one field a person never
 * sees or reaches. A request that fills it gets the same answer as an
 * accepted one, but nothing is stored, no mail is sent, and the log gets one
 * line with nothing of the request in it. Not chosen: a time check (the
 * browser supplies the timing, a bot can fake it, and a fast person with
 * autofill could be caught) and parking it behind the 60-an-hour limit.
 *
 * What this holds:
 *
 *  - a filled trap gets the same status and body as an accepted request,
 *    and the trap's value comes back nowhere. Not the same timing: it waits
 *    for no mail, and the code is public anyway;
 *  - a trap that is not a string (a number, a list from a repeated form
 *    field) is filled too, and gets the same answer: no type check refuses it
 *    with a 400 that names the field;
 *  - it writes no row and sends no mail. The channel is ON here, and a
 *    person's request in the same file sends one, so "no mail" is not the
 *    silence of a channel that was off;
 *  - it logs one marker line, without the trap's value or the address;
 *  - a trap that is empty, only spaces, `null` or absent is a person's
 *    request, as before;
 *  - the rate limit runs first, so a trapped request is counted, and one past
 *    the limit is refused like any other;
 *  - the trap does not change how the visible fields are judged: a request
 *    that would be refused is refused with the trap filled too.
 *
 * AGAINST PGLITE, with the connection shim of
 * `access-request-duplicates.unit.test.ts` and the captured transport of
 * `access-request-grant-alpha.unit.test.ts`. Nothing else is faked: the
 * route, the limiter, `tellOperator` and the rendering are the real ones.
 * Each test knocks under its own caller key, so the limit of two below is a
 * fresh bucket per test.
 *
 * UUID family: none. This route needs no tenant.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { log } from '@openmig/shared';

/** The field a bot fills and a person never sees. */
const TRAP = 'website';
/** What a bot puts in it. Distinctive, so a leak of it anywhere is findable. */
const BAIT = 'https://cheap-pills.example.test/buy-now';
/** The limit for this file: two, so the third knock from one caller is the interesting one. */
const LIMIT = 2;

let driver: LedgerDriver;

/** Every message the transport was handed. */
const SENT: Array<{ to: readonly string[]; subject: string; body: string }> = [];
vi.mock('@openmig/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/connectors')>();
  return {
    ...actual,
    smtpTransport: () => async (message: { to: readonly string[]; subject: string; body: string }) => {
      SENT.push(message);
    },
  };
});

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return { ...actual, getDbPool: () => driver };
});

const { default: accessRoutes } = await import('./access-requests.ts');
const { __setChannelForTests } = await import('../access-notify.ts');

/**
 * The caller key the limiter reads is `req.ip`. Each test names its own here,
 * so one test's knocks never spend another test's bucket.
 */
const app = express();
app.use((req, _res, next) => {
  Object.defineProperty(req, 'ip', { value: req.get('x-test-caller') ?? 'nobody', configurable: true });
  next();
});
app.use(express.json());
app.use('/api/access-requests', accessRoutes);

let callers = 0;
/** A caller key no other test has used. */
const freshCaller = (): string => `caller-${++callers}`;

const knock = (body: Record<string, unknown>, caller = freshCaller()) =>
  request(app).post('/api/access-requests').set('x-test-caller', caller).send(body);

async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}
const stored = () => rows('SELECT email FROM access_request ORDER BY created_at');

/** Every line the route logged during the test, at any level. */
let logged: string[] = [];

beforeAll(async () => {
  // Read on the first request, which is when the route builds its limiter.
  vi.stubEnv('ACCESS_REQUEST_MAX_PER_HOUR', String(LIMIT));
  driver = pgliteDriver({ role: 'app_user' });
  // The two calling conventions drizzle's node-postgres adapter uses, onto the
  // driver itself; see access-request-duplicates.unit.test.ts for why.
  (driver as unknown as { query: unknown }).query = async (
    textOrConfig: string | { text: string; values?: unknown[] },
    maybeValues?: unknown[],
  ): Promise<unknown> => {
    const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
    const values =
      maybeValues ?? (typeof textOrConfig === 'string' ? [] : (textOrConfig.values ?? []));
    const conn = await driver.acquire();
    try {
      return await conn.query(text, values);
    } finally {
      await conn.release();
    }
  };
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await driver?.end();
});

beforeEach(async () => {
  SENT.length = 0;
  logged = [];
  for (const level of ['error', 'warn', 'info', 'debug'] as const) {
    vi.spyOn(log, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
  await rows('DELETE FROM access_request');
  // A channel that is on, so a person's request really mails the operator.
  __setChannelForTests({
    notifier: { notify: async () => {} },
    locale: 'en',
    announcement: '',
    config: {
      enabled: true,
      smtp: { host: 'localhost', port: 587, secure: false, user: 'u', pass: 'p' },
      settings: { from: 'ownpace@example.test', to: ['ops@example.test'] },
    },
  } as unknown as Parameters<typeof __setChannelForTests>[0]);
});

afterEach(() => {
  __setChannelForTests(null);
  vi.restoreAllMocks();
});

describe('a request that fills the trap', () => {
  it('is answered with the same status and body as an accepted request', async () => {
    const person = await knock({ email: 'person@example.test', locale: 'en' });
    const bot = await knock({ email: 'bot@example.test', locale: 'en', [TRAP]: BAIT });

    expect(person.status).toBe(201);
    expect(bot.status).toBe(person.status);
    expect(bot.body).toEqual(person.body);
    expect(bot.headers['content-type']).toBe(person.headers['content-type']);
    // The trap's value is not echoed back.
    expect(JSON.stringify(bot.body)).not.toContain(BAIT);
  });

  it('writes no row', async () => {
    const res = await knock({ email: 'bot@example.test', name: 'Bot', note: 'buy now', [TRAP]: BAIT });
    expect(res.status).toBe(201);
    expect(await stored(), 'a request that filled the trap was written to the queue').toEqual([]);
  });

  it('sends no mail, while a person’s request on the same channel does', async () => {
    await knock({ email: 'bot@example.test', [TRAP]: BAIT });
    expect(SENT, 'a request that filled the trap mailed the operator').toHaveLength(0);

    // The control: the channel is on, so the silence above is the trap's.
    await knock({ email: 'person@example.test' });
    expect(SENT).toHaveLength(1);
    expect(SENT[0]!.to).toEqual(['ops@example.test']);
  });

  it('logs one marker line, with nothing of the request in it', async () => {
    await knock({
      email: 'bot@example.test',
      name: 'Bot Name',
      organisation: 'Bot Org',
      note: 'a note from a bot',
      [TRAP]: BAIT,
    });

    const marker = logged.filter((line) => line.includes('[access-request]') && /\btrap\b/.test(line));
    expect(marker, `expected one marker line, logged:\n${logged.join('\n')}`).toHaveLength(1);
    for (const secret of [BAIT, 'bot@example.test', 'Bot Name', 'Bot Org', 'a note from a bot']) {
      expect(logged.join('\n'), `the log carries ${secret}`).not.toContain(secret);
    }
  });

  it.each([
    ['a number', 123],
    ['true', true],
    ['a list, as a repeated form field arrives', ['a', 'b']],
    ['an object', { a: 'b' }],
  ])('that is %s is filled too: the same 201, no row, no mail', async (_label, value) => {
    const res = await knock({ email: 'bot@example.test', [TRAP]: value });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({
      received: true,
      message: 'Thank you — we have your request. You will hear back by email.',
    });
    expect(await stored()).toEqual([]);
    expect(SENT).toHaveLength(0);
  });

  it('is judged on its visible fields like any other: an invalid one is still a 400', async () => {
    // The answer depends on what a person could have typed, never on the trap.
    const res = await knock({ email: 'not-an-address', [TRAP]: BAIT });
    expect(res.status).toBe(400);
    expect(await stored()).toEqual([]);
  });
});

describe('a trap left empty is a person’s request, as before', () => {
  it.each([
    ['absent', {}],
    ['empty', { [TRAP]: '' }],
    ['only spaces', { [TRAP]: '   ' }],
    ['null', { [TRAP]: null }],
  ])('%s: stored, the operator mailed, and the same answer', async (_label, trap) => {
    const res = await knock({ email: 'person@example.test', note: 'two mailboxes', ...trap });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      received: true,
      message: 'Thank you — we have your request. You will hear back by email.',
    });
    expect(await stored()).toEqual([{ email: 'person@example.test' }]);
    expect(SENT).toHaveLength(1);
    expect(logged.some((line) => /\btrap\b/.test(line))).toBe(false);
  });
});

describe('the rate limit runs before the trap', () => {
  it('counts a trapped request, and refuses one past the limit', async () => {
    const caller = freshCaller();
    for (let i = 1; i <= LIMIT; i++) {
      expect((await knock({ email: `bot-${i}@example.test`, [TRAP]: BAIT }, caller)).status).toBe(201);
    }
    // The bucket is spent by knocks that stored nothing: a bot hammering the
    // trap is throttled like anybody else.
    const person = await knock({ email: 'person@example.test' }, caller);
    expect(person.status).toBe(429);
    const bot = await knock({ email: 'bot-3@example.test', [TRAP]: BAIT }, caller);
    expect(bot.status, 'a trapped request past the limit was answered as received').toBe(429);
    expect(Number(bot.headers['retry-after'])).toBeGreaterThan(0);

    expect(await stored()).toEqual([]);
    expect(SENT).toHaveLength(0);
  });
});
