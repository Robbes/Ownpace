// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ACCESS REQUEST IS LOGGED BY ITS ID, NEVER BY THE ADDRESS IT GIVES
 * (workplan 0168; an outside, read-only check found the address in the lines).
 *
 * Every line the access requests wrote named the person: `<address> asked for
 * access`, `granted <address>`, `declined <address>`. Each now names the
 * request by its id, the one the queue lists it under (`GET
 * /api/access-requests`), so the operator still finds it. A second knock while
 * one is open names nobody: this door cannot read the queue to find its id.
 *
 * Through the real router on PGlite as `app_user`, as
 * `access-request-duplicates` runs it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { formatWithOptions } from 'node:util';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { log } from '@openmig/shared';

const OPERATOR = 'operator-subject-0168';
const ADDRESS = 'someone-s1@example.com';
const OTHER = 'someone-s2@example.com';

let driver: LedgerDriver;
let caller: string | undefined;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticateSubject: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (caller === undefined) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, { userId: caller });
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: accessRoutes } = await import('./access-requests.ts');

const app = express();
app.use(express.json());
app.use('/api/access-requests', accessRoutes);

async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const knock = (email: string) => request(app).post('/api/access-requests').send({ email, locale: 'en' });

/** Every line the log wrote while `act` ran, printed in full. */
async function linesDuring(act: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => void lines.push(formatWithOptions({ depth: Infinity }, ...args));
  const spies = (['info', 'warn', 'error'] as const).map((level) => vi.spyOn(log, level).mockImplementation(capture));
  try {
    await act();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return lines.join('\n');
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  // The anonymous knock hands `drizzle` a pool; the operator routes hand the
  // same object to `withSubject` as a driver (see `access-request-duplicates`).
  (driver as unknown as { query: unknown }).query = async (
    textOrConfig: string | { text: string; values?: unknown[] },
    maybeValues?: unknown[],
  ): Promise<unknown> => {
    const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
    const values = maybeValues ?? (typeof textOrConfig === 'string' ? [] : (textOrConfig.values ?? []));
    const conn = await driver.acquire();
    try {
      return await conn.query(text, values);
    } finally {
      await conn.release();
    }
  };
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await rows(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'op@test.invalid')`, [OPERATOR]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('the access requests’ log lines', () => {
  it('name each request by its id, and never the address it gives', async () => {
    caller = undefined;
    const knocked = await linesDuring(() => knock(ADDRESS));
    const [first] = await rows('SELECT id::text AS id FROM access_request WHERE email = $1', [ADDRESS]);
    const again = await linesDuring(() => knock(ADDRESS));

    caller = OPERATOR;
    const granted = await linesDuring(() => request(app).post(`/api/access-requests/${String(first!.id)}/grant`).send({}));
    caller = undefined;
    await knock(OTHER);
    const [second] = await rows('SELECT id::text AS id FROM access_request WHERE email = $1', [OTHER]);
    caller = OPERATOR;
    const declined = await linesDuring(() =>
      request(app).post(`/api/access-requests/${String(second!.id)}/decline`).send({ notify: false }),
    );

    expect(knocked).toContain(`[access-request] request ${String(first!.id)} asked for access (en)`);
    expect(again).toContain('[access-request] an address with a request still open asked again');
    expect(granted).toContain(`[access-request] granted request ${String(first!.id)}: tenant `);
    expect(declined).toContain(`[access-request] declined request ${String(second!.id)}`);
    expect(declined).toContain(`declined request ${String(second!.id)} without telling them`);
    for (const [step, line] of Object.entries({ knocked, again, granted, declined })) {
      expect(line, `the ${step} lines named the address`).not.toMatch(/someone-s[12]/);
    }
  });
});
