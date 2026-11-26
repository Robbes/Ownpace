// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TEXT WITH A NUL BYTE WAS A SERVER ERROR (workplan 0178, the owner's answer
 * A1 of 2026-11-26: "fix now").
 *
 * Postgres stores no NUL (U+0000) in a `text` column: it refuses the whole
 * statement (`invalid byte sequence for encoding "UTF8": 0x00`), and the API
 * answered 500 for what was the caller's text. JSON may carry one (`\u0000`),
 * and so may a form or a query (`%00`). Found by Schemathesis against a
 * running API (0178 T7).
 *
 * Now one place answers it: `readingTheBody` (`unreadable-body.ts`), which
 * every body parser of the API is mounted through, the problem report's
 * included. After a parser has read a body, a string in it, or a key, that
 * holds a NUL is the caller's 400, in the API's `Error` shape, before any
 * handler; a query string with one is answered the same. So this holds,
 * through the real app with no database (a handler that ran would answer
 * 500 here, which is what these answered before):
 *
 *  1. A JSON body with a NUL in a string, at any depth, in an array, or in a
 *     key, is 400 `{ error, message }`, on a signed-in door and a public one.
 *  2. A form body and a query string with one are 400 the same way.
 *  3. A body and a query without one reach their handler as before.
 *  4. Nothing of the text is echoed in the answer.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { A_TEXT_WITH_A_NUL } from './unreadable-body.ts';

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  const signedIn = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.userId = 'user-1';
    req.userEmail = 'someone@example.invalid';
    req.tenantId = '0e260000-e29b-41d4-a716-446655440001';
    req.userRole = 'owner';
    next();
  };
  return { ...actual, authenticate: signedIn, authenticateSubject: signedIn };
});

vi.stubEnv('DATABASE_URL', '');
vi.stubEnv('APP_DATABASE_URL', '');

const { app } = await import('./index.ts');

const NUL = '\u0000';
const SECRET = 'words-that-stay-out-of-the-answer';
const refused = (res: { status: number; body: unknown; text: string }) => {
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'Bad request', message: A_TEXT_WITH_A_NUL });
  expect(res.text).not.toContain(SECRET);
};

describe('a text with a NUL byte is the caller’s 400 (1, 2, 4)', () => {
  it('in a string of a JSON body, on a signed-in door (the operator’s pause, which answered 500)', async () => {
    refused(await request(app).post('/api/platform-pause').send({ reason: `${SECRET}${NUL}` }));
  });

  it('at any depth, in an array, and in a key', async () => {
    for (const body of [
      { a: { b: { c: `x${NUL}${SECRET}` } } },
      { list: ['fine', `bad${NUL}${SECRET}`] },
      { [`key${NUL}${SECRET}`]: 'value' },
      [`${NUL}${SECRET}`],
    ]) {
      refused(await request(app).put('/api/tenants/0e260000-e29b-41d4-a716-446655440001').send(body as object));
    }
  });

  it('on a public door', async () => {
    refused(await request(app).post('/api/access-requests').send({ email: 'someone@example.invalid', note: `${SECRET}${NUL}` }));
  });

  it('in a form body', async () => {
    refused(await request(app).post('/api/billing/webhooks/mollie').type('form').send(`id=${SECRET}%00`));
  });

  it('in a query string', async () => {
    refused(await request(app).get(`/api/migrations?filter=${SECRET}%00`));
  });
});

describe('a text without one goes on as before (3)', () => {
  it('reaches the handler with its body and its query', async () => {
    const body = await request(app).post('/api/platform-pause').send({ reason: 'An ordinary reason' });
    expect(body.body?.message).not.toBe(A_TEXT_WITH_A_NUL);
    const query = await request(app).get('/api/migrations?filter=ordinary');
    expect(query.body?.message).not.toBe(A_TEXT_WITH_A_NUL);
  });
});
