// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GIFT THAT KEEPS NO RECIPIENT (workplan 0172 §4; the brief: "the
 * recipient's email address is never asked for or stored", and a personal
 * message "stays on the card in the browser and is never stored").
 *
 * Three ways it could stop being true, each held:
 *
 *  1. **A column.** The table's columns are read from the migrated database
 *     and must be exactly the ones the workplan names. A column for an
 *     address, a name or a message fails here before any route writes one.
 *  2. **A field the giver's route accepts.** `POST /api/gifts` takes the
 *     card's language and refuses anything else, so a client that sends a
 *     recipient's address, name or message is told no, and nothing is made.
 *  3. **A value the routes write.** A gift is made and redeemed with a
 *     recipient whose address, name and note are distinctive; afterwards no
 *     column of any gift row holds any of them. (The recipient's own address
 *     is in the access request they made, as every request's is: that is the
 *     request, not the gift.) Since workplan 0177 the door lets the person in
 *     at once and takes no note (§5): a note sent anyway is kept nowhere, and
 *     the request's note holds only the door's fixed line about Google.
 *
 * UUID family 01720000-…-4466554420xx.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const OURS = '01720000-e29b-41d4-a716-446655442001';
const ANNA = 'subject-anna-0172-guard';

let driver: LedgerDriver;
let caller: { userId: string; tenantId?: string } | undefined;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  const stand = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!caller) return void res.status(401).json({ error: 'Unauthorized' });
    Object.assign(req, caller);
    next();
  };
  return { ...actual, authenticate: stand, authenticateSubject: stand, getDbPool: () => driver };
});

const { default: giftRoutes } = await import('./gifts.ts');
const app = express();
app.use(express.json());
app.use('/api/gifts', giftRoutes);

async function rows(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

/** Every column `gift` may have: the workplan's §3.1, and nothing about a recipient. */
const GIFT_COLUMNS = [
  'code_hash',
  'created_at',
  'expires_at',
  'giver_user_id',
  'id',
  'locale',
  'redeemed_at',
  'redeemed_request_id',
  'request_declined_at',
  'revoked_at',
  'revoked_by',
  'tenant_id',
];

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await rows(`INSERT INTO tenant (id, name) VALUES ($1, 'De Vries')`, [OURS]);
  // A giver is a member, as the real middleware finds them (0177 §20.3: only
  // a member's session learns whether a new card has room).
  await rows(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status) VALUES ($1, $2, 'anna@example.com', 'owner', 'active')`,
    [OURS, ANNA],
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('a gift keeps nothing about the person it is for', () => {
  it('has no column for them', async () => {
    const columns = await rows(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'gift' ORDER BY column_name`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(GIFT_COLUMNS);
  });

  it('refuses a recipient’s address, name or message when a gift is made', async () => {
    caller = { userId: ANNA, tenantId: OURS };
    for (const extra of [
      { email: 'cato@example.com' },
      { recipientEmail: 'cato@example.com' },
      { recipientName: 'Cato' },
      { message: 'Fijne feestdagen!' },
    ]) {
      const res = await request(app).post('/api/gifts').send({ locale: 'nl', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await rows('SELECT 1 FROM gift')).toHaveLength(0);
  });

  it('writes none of what the recipient typed into the gift', async () => {
    caller = { userId: ANNA, tenantId: OURS };
    const made = await request(app).post('/api/gifts').send({ locale: 'en' });
    expect(made.status).toBe(201);
    caller = undefined;
    const typed = { email: 'cato.unique-0172@example.com', name: 'Catharina-0172', note: 'A note only-0172' };
    const used = await request(app)
      .post('/api/gifts/redeem')
      .send({ code: made.body.code, locale: 'en', google: true, ...typed });
    expect(used.status, JSON.stringify(used.body)).toBe(201);

    const stored = JSON.stringify(await rows('SELECT * FROM gift'));
    for (const value of [...Object.values(typed), made.body.code, made.body.code.replace(/-/g, '')]) {
      expect(stored, value).not.toContain(value);
    }
    // Where the recipient's words do live: their own request. The note they
    // could not type is nowhere, and the door's own line is all the note holds.
    expect(await rows('SELECT email, name, note FROM access_request')).toEqual([
      { email: typed.email, name: typed.name, note: 'Said at the door: this address is a Google account to move.' },
    ]);
    expect(JSON.stringify(await rows('SELECT * FROM access_request'))).not.toContain(typed.note);
  });
});
