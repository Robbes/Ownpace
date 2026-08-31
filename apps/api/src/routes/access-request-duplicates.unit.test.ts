// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One open knock per address, and the second organisation nobody meant to make
 * (owner decision 2026-08-31).
 *
 * Migration 0002 deliberately left `email` non-unique and gave the reason:
 * "somebody who asked a year ago may ask again, and a second request from the
 * same address is information rather than an error." True of requests made in
 * SEQUENCE, and silent about several being open at once — which is what the
 * owner found in his own queue, his own address among them.
 *
 * Several open at once is not information. It is noise in the queue, and
 * granting two of them creates TWO ORGANISATIONS with that person as owner of
 * both, after which `/api/me` returns two tenants and `resolveTenant` refuses
 * to choose. So: one OPEN request per address (0020's partial index), and a
 * grant that refuses to make a second organisation unless somebody says they
 * mean it.
 *
 * AGAINST PGLITE, not a container, so it can be run by whoever is changing it —
 * the three existing access-request suites are integration-only and need a real
 * Postgres, which is why the rules below had no test at all until now.
 *
 * UUID family 01970000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const OPERATOR = 'operator-subject-0020';
const OWNED_TENANT = '01970000-e29b-41d4-a716-446655440001';

let driver: LedgerDriver;
let caller: string | undefined;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticateSubject: (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
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

const knock = (email: string) =>
  request(app).post('/api/access-requests').send({ email, locale: 'en' });

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  /**
   * ONE OBJECT, TWO SHAPES, because this router uses both.
   *
   * The operator routes hand the pool to `withSubject`, which is the ledger's
   * own and takes a driver. The anonymous knock does `drizzle(getSharedPool())`
   * directly, and drizzle's node-postgres adapter wants a Pool — something with
   * `.query(text, values)` answering `{ rows }`. A driver has neither.
   *
   * The method is added TO the driver rather than onto a copy: cloning it broke
   * its internals and starved the connection pool, which showed up as tests
   * timing out in `beforeEach` rather than as anything to do with the mock.
   * Nothing is faked — every statement still runs against the real migrated
   * PGlite, which is the whole reason for testing here instead of a container.
   */
  (driver as unknown as { query: unknown }).query = async (
    textOrConfig: string | { text: string; values?: unknown[] },
    maybeValues?: unknown[],
  ): Promise<unknown> => {
    // BOTH CALLING CONVENTIONS. drizzle's adapter uses `query(text, values)` in
    // some paths and `query({ text, values })` in others; a shim that handles
    // only the first fails with "src must be of type string" from deep inside
    // pg, which says nothing about what is actually wrong.
    const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
    // Positional values WIN when present: drizzle passes a config object for the
    // text and the parameters separately, so reading them off the object alone
    // binds nothing and Postgres answers "bind message supplies 0 parameters".
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
  await rows(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'op@test.invalid')`, [
    OPERATOR,
  ]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  caller = undefined;
  await rows('DELETE FROM access_request');
  await rows('DELETE FROM tenant_member');
  await rows('DELETE FROM tenant');
});

describe('a second knock while the first is unanswered', () => {
  it('is not recorded twice', async () => {
    expect((await knock('jan@example.test')).status).toBe(201);
    expect((await knock('jan@example.test')).status).toBe(201);
    expect(await rows("SELECT id FROM access_request WHERE state = 'open'")).toHaveLength(1);
  });

  it('is told exactly what the first one was told', async () => {
    // A different answer for an address that has already asked is a way to find
    // out which addresses have. The sentence stays true either way: we do have
    // their request.
    const first = await knock('jan@example.test');
    const second = await knock('jan@example.test');
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
  });

  it('counts a differently-typed address as the same person', async () => {
    // The rule the rest of the system already uses to decide two addresses are
    // one person (auth.ts trims and lowercases), not a second one invented for
    // the index.
    await knock('jan@example.test');
    expect((await knock('  JAN@Example.Test ')).status).toBe(201);
    expect(await rows("SELECT id FROM access_request WHERE state = 'open'")).toHaveLength(1);
  });

  it('still lets somebody ask again once the first was answered', async () => {
    // 0002's actual intent, and it must survive: asking a year later is
    // information. Only SEVERAL AT ONCE is noise.
    await knock('jan@example.test');
    await rows(
      `UPDATE access_request SET state = 'declined', decided_by = 'op', decided_at = now()`,
    );
    expect((await knock('jan@example.test')).status).toBe(201);
    expect(await rows('SELECT id FROM access_request')).toHaveLength(2);
  });

  it('does not stop a different address asking', async () => {
    await knock('jan@example.test');
    expect((await knock('ana@example.test')).status).toBe(201);
    expect(await rows("SELECT id FROM access_request WHERE state = 'open'")).toHaveLength(2);
  });
});

describe('granting somebody who already owns an organisation', () => {
  /** An open request from an address that already owns `OWNED_TENANT`. */
  async function requestFromAnOwner(): Promise<string> {
    await rows(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Acme Families', 'active')`, [
      OWNED_TENANT,
    ]);
    await rows(
      `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
       VALUES ($1, 'sub-jan', 'jan@example.test', 'owner', 'active', now())`,
      [OWNED_TENANT],
    );
    await knock('jan@example.test');
    const [row] = await rows("SELECT id FROM access_request WHERE state = 'open'");
    return row!.id as string;
  }

  const grant = (id: string, body: Record<string, unknown> = {}) =>
    request(app).post(`/api/access-requests/${id}/grant`).set('Authorization', 'Bearer x').send(body);

  it('refuses, and names what they already own', async () => {
    // A bare "already owns one" sends the operator away to go and look. The
    // decision is "is this a double press or a real second company", and the
    // names are what answers it.
    caller = OPERATOR;
    const res = await grant(await requestFromAnOwner());
    expect(res.status).toBe(409);
    expect(res.body.organisations).toEqual(['Acme Families']);
    expect(res.body.message).toContain('Acme Families');
    expect(res.body.confirmWith).toBe('alsoCreateSecondOrganisation');
  });

  it('writes nothing at all when it refuses', async () => {
    // Refused BEFORE the insert, so nothing half-happens and the request is
    // still there to decide on.
    caller = OPERATOR;
    const id = await requestFromAnOwner();
    await grant(id);
    expect(await rows('SELECT id FROM tenant')).toHaveLength(1);
    expect(await rows("SELECT id FROM access_request WHERE state = 'open'")).toHaveLength(1);
  });

  it('goes ahead when somebody says they mean it', async () => {
    // Occasionally correct — a second company, a family beside a business — and
    // never what a double press means.
    caller = OPERATOR;
    const res = await grant(await requestFromAnOwner(), { alsoCreateSecondOrganisation: true });
    expect(res.status).toBe(201);
    expect(await rows('SELECT id FROM tenant')).toHaveLength(2);
  });

  it('does not refuse somebody who was REMOVED from an organisation', async () => {
    // They do not own it any more, and refusing on their behalf would strand a
    // real grant.
    caller = OPERATOR;
    const id = await requestFromAnOwner();
    await rows("UPDATE tenant_member SET status = 'removed'");
    expect((await grant(id)).status).toBe(201);
  });

  it('grants an address that owns nothing, as it always did', async () => {
    caller = OPERATOR;
    await knock('new@example.test');
    const [row] = await rows("SELECT id FROM access_request WHERE state = 'open'");
    expect((await grant(row!.id as string)).status).toBe(201);
  });
});
