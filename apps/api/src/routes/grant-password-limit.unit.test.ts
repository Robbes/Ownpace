// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CALLER'S LIMIT ON PASSWORD TESTS (workplan 0174 §7.4, T3): thirty an
 * hour per `req.ip` unless a deployment says otherwise, a 429 with
 * `Retry-After` past it, and a value nobody could have meant refused.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createKnockLimiter } from '../knock-limit.ts';
import { PASSWORD_TESTS_PER_HOUR, passwordLimit, passwordLimiter } from './grant-password.ts';

describe('passwordLimit', () => {
  it('refuses past the limit with a Retry-After, before anything else runs', async () => {
    let reached = 0;
    const app = express();
    app.put('/x', passwordLimit(createKnockLimiter({ windowMs: 60_000, max: 2 })), (_req, res) => {
      reached += 1;
      res.json({ ok: true });
    });
    expect((await request(app).put('/x')).status).toBe(200);
    expect((await request(app).put('/x')).status).toBe(200);
    const third = await request(app).put('/x');
    expect(third.status).toBe(429);
    expect(third.body).toEqual({ error: 'too_many_tests' });
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
    expect(reached).toBe(2);
  });

  it('is thirty an hour unless set, and refuses a value nobody could have meant', () => {
    expect(PASSWORD_TESTS_PER_HOUR).toBe(30);
    const limiter = passwordLimiter({});
    for (let i = 0; i < 30; i++) expect(limiter.take('k')).toBe(true);
    expect(limiter.take('k')).toBe(false);
    expect(passwordLimiter({ GRANT_PASSWORD_TESTS_PER_HOUR: '3' }).take('k')).toBe(true);
    expect(() => passwordLimiter({ GRANT_PASSWORD_TESTS_PER_HOUR: 'many' })).toThrow(/positive integer/);
    expect(() => passwordLimiter({ GRANT_PASSWORD_TESTS_PER_HOUR: '0' })).toThrow(/positive integer/);
  });
});
