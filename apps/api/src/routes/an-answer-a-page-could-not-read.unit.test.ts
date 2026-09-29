// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ANSWER A PAGE COULD NOT READ, KEPT WHERE A FAULT IS KEPT (workplan 0145;
 * the owner's "Log it", 2026-09-29).
 *
 * A page whose schema refused an answer shows its reader a reference and
 * sends it here. What must hold: the reference is the one the log page finds,
 * as `web.answer_unreadable` in the person's organisation; the output carries
 * one line with the detail and both builds; nothing the parse drops reaches
 * that line; and only a signed-in person, thirty times an hour, can write it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { log, setAppEventSink, type AppEvent } from '@openmig/shared';
import { createKnockLimiter } from '../knock-limit.ts';
import { unreadableAnswerRoutes, UNREADABLE_ANSWER_LIMIT } from './unreadable-answers.ts';

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    // Signed in as whoever the request says, or not at all.
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.header('x-signed-out')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      Object.assign(req, { tenantId: 'a-tenant', userId: req.header('x-member') ?? 'a-member' });
      next();
    },
  };
});

const SERVER_BUILD = { version: '0.3.2', commit: 'def5678abc1234def5678abc1234def5678abc12' };

function appWith(max: number = UNREADABLE_ANSWER_LIMIT.max): express.Express {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/unreadable-answers',
    unreadableAnswerRoutes({
      limiter: createKnockLimiter({ windowMs: UNREADABLE_ANSWER_LIMIT.windowMs, max }),
      build: () => SERVER_BUILD,
    }),
  );
  return app;
}

const BODY = {
  reference: '1a2b3c4d',
  code: 'invalid_value',
  path: '2.domains.2',
  page: '/mappings',
  build: { version: '0.3.1', commit: 'abc1234def5678abc1234def5678abc1234def56' },
};

let recorded: AppEvent[];
let lines: string[];

beforeEach(() => {
  recorded = [];
  lines = [];
  setAppEventSink({
    record: async (event) => {
      recorded.push(event);
    },
  });
  vi.spyOn(log, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  setAppEventSink(undefined);
  vi.restoreAllMocks();
});

/** `recordAppEvent` is not awaited by the route; let it land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('POST /api/unreadable-answers', () => {
  it('keeps the report under the reference the page showed, in the person’s organisation', async () => {
    const res = await request(appWith()).post('/api/unreadable-answers').send(BODY);
    await settle();

    expect(res.status).toBe(204);
    expect(recorded).toEqual([
      { level: 'error', event: 'web.answer_unreadable', reference: '1a2b3c4d', tenantId: 'a-tenant' },
    ]);
    expect(lines).toEqual([
      '[web] a page could not read an answer [ref 1a2b3c4d]: invalid_value at 2.domains.2, on /mappings; ' +
        'page build 0.3.1 abc1234, server build 0.3.2 def5678 (they differ)',
    ]);
  });

  it('writes nothing the parse dropped: an address in the path, a token in the page', async () => {
    const res = await request(appWith())
      .post('/api/unreadable-answers')
      .send({ ...BODY, path: 'people.0.anna@example.nl', page: '/view/Zk3pQ9xT2mLw' });
    await settle();

    expect(res.status).toBe(204);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('anna@example.nl');
    expect(lines[0]).not.toContain('Zk3pQ9xT2mLw');
    expect(recorded).toHaveLength(1);
  });

  it('refuses a report with no reference to keep it under, and keeps nothing', async () => {
    const res = await request(appWith())
      .post('/api/unreadable-answers')
      .send({ ...BODY, reference: 'nope' });
    await settle();

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_report');
    expect(recorded).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('is for somebody signed in only', async () => {
    const res = await request(appWith()).post('/api/unreadable-answers').set('x-signed-out', '1').send(BODY);
    await settle();

    expect(res.status).toBe(401);
    expect(recorded).toEqual([]);
  });

  it('keeps a person’s first reports in an hour and refuses the rest, per person', async () => {
    const app = appWith(2);
    const send = (member: string, reference: string) =>
      request(app).post('/api/unreadable-answers').set('x-member', member).send({ ...BODY, reference });

    expect((await send('anna', '00000001')).status).toBe(204);
    expect((await send('anna', '00000002')).status).toBe(204);
    const third = await send('anna', '00000003');
    expect(third.status).toBe(429);
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    // Somebody else's pages are not held back by Anna's.
    expect((await send('bert', '00000004')).status).toBe(204);
    await settle();

    expect(recorded.map((e) => e.reference)).toEqual(['00000001', '00000002', '00000004']);
  });
});
