// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE AUDIT EXPORT'S DOWNLOAD, FOR THE OPERATOR (workplan 0129 T4, the managed
 * half; the owner, 2026-09-24: "an operator-only route using your own
 * session").
 *
 * `GET /api/support/audit-export`, against a real database: PGlite as
 * `app_user`, both migration chains, the operator predicate on
 * `support_audit_export` (managed migration 0026) and the `support_read`
 * constraints all doing their own work. Only the pseudonym key is given: it is
 * read on the owner's connection in production (`audit-key.ts`), and here it is
 * a fixed one, so a pseudonym can be checked rather than merely seen to differ.
 *
 *  - an operator gets every settled line, oldest first, across every
 *    organisation, naming nobody, with the appliance's headers;
 *  - pages resume where the last stopped, until caught up;
 *  - every page served is recorded as one read of every customer, with where
 *    it started and how many lines it served;
 *  - a non-operator gets nothing, and nothing is recorded;
 *  - a cursor or a page size that is not one is refused by name, recording
 *    nothing; a key that cannot be read, or a read that cannot be recorded,
 *    sends nothing;
 *  - the view is read and nothing else: not even an operator writes through
 *    it to the audit log.
 *
 * The names and addresses are invented.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { pseudonymizer } from '@openmig/shared';

// UUID family 6a6d0000-…, unused elsewhere in the repo.
const TENANT_A = '6a6d0000-e29b-41d4-a716-446655443101';
const TENANT_B = '6a6d0000-e29b-41d4-a716-446655443102';
const id = (n: string) => `6a6d0000-e29b-41d4-a716-4466554431${n}`;
/** The settled events, in the order the download must serve them. */
const SETTLED = [
  { id: id('a1'), tenant: TENANT_A, at: '2026-09-01T10:00:00.000001Z', actor: 'jan@example.invalid' },
  { id: id('b1'), tenant: TENANT_B, at: '2026-09-02T10:00:00.000002Z', actor: 'mapping-scheduler' },
  { id: id('a2'), tenant: TENANT_A, at: '2026-09-03T10:00:00.000003Z', actor: 'jan@example.invalid' },
];
const RECENT = id('a9');

const OPERATOR = 'operator-subject-0129';
const NOT_OPERATOR = 'ordinary-subject-0129';
const KEY = new Uint8Array(32).fill(7);

let driver: LedgerDriver;
let caller: string | undefined;
const keyMock = vi.fn(async () => KEY);

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
vi.mock('../audit-key.ts', () => ({ auditPseudonymKey: () => keyMock() }));

const { default: supportRoutes } = await import('./support.ts');

const app = express();
app.use(express.json());
app.use('/api/support', supportRoutes);

async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const reads = () =>
  rows(
    `SELECT operator_user_id, tenant_id, query, result_count FROM support_read
      WHERE view_name = 'audit_export' ORDER BY query`,
  );

type Line = { Timestamp: string; Body: string; Attributes: Record<string, unknown>; Resource: Record<string, unknown> };

async function download(query = '') {
  const res = await request(app).get(`/api/support/audit-export${query}`);
  const text = res.text ?? '';
  return {
    status: res.status,
    type: res.headers['content-type'] as string | undefined,
    next: res.headers['ownpace-next-after'] as string | undefined,
    caughtUp: res.headers['ownpace-caught-up'] as string | undefined,
    text,
    lines: res.status === 200 ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) : [],
    body: res.body as { field?: string },
  };
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await rows(`INSERT INTO tenant (id, name) VALUES ($1, 'Example Care BV'), ($2, 'Example Works BV')`, [
    TENANT_A,
    TENANT_B,
  ]);
  // Written in the reverse order, so the order served is the rows' own.
  for (const e of [...SETTLED].reverse()) {
    await rows(
      `INSERT INTO audit_log (id, tenant_id, actor, action, entity, detail, at)
       VALUES ($1, $2, $3, 'share.decided', 'share_grant', $4, $5)`,
      [e.id, e.tenant, e.actor, JSON.stringify({ mappingId: e.tenant, on: 'Salaries 2026.xlsx' }), e.at],
    );
  }
  // Recorded now: too new to have settled.
  await rows(
    `INSERT INTO audit_log (id, tenant_id, actor, action, at) VALUES ($1, $2, 'jan@example.invalid', 'share.decided', now())`,
    [RECENT, TENANT_A],
  );
  await rows(
    `INSERT INTO platform_operator (user_id, email, note) VALUES ($1, 'operator@example.invalid', 'workplan 0129 T4 fixture')`,
    [OPERATOR],
  );
}, 120_000);

beforeEach(async () => {
  caller = OPERATOR;
  keyMock.mockReset();
  keyMock.mockImplementation(async () => KEY);
  await rows(`DELETE FROM support_read`);
});

describe('GET /api/support/audit-export, for an operator', () => {
  it('serves every settled line, oldest first, across every organisation, naming nobody', async () => {
    const got = await download();

    expect(got.status).toBe(200);
    expect(got.type).toMatch(/^application\/x-ndjson/);
    expect(got.lines.map((l) => l.Attributes['ownpace.audit.id'])).toEqual(SETTLED.map((e) => e.id));
    expect(got.lines.map((l) => l.Attributes['ownpace.tenant.id'])).toEqual(SETTLED.map((e) => e.tenant));
    // The deployment's own key: the same person is the same pseudonym as in
    // the line the stream printed. An identifier stays as it is.
    const jan = pseudonymizer(KEY)('jan@example.invalid');
    expect(got.lines.map((l) => l.Attributes['ownpace.audit.actor'])).toEqual([jan, 'mapping-scheduler', jan]);
    expect(got.text).not.toContain('jan@example.invalid');
    expect(got.text).not.toContain('Salaries');
    for (const line of got.lines) {
      expect(line.Body).toBe('share.decided');
      expect(line.Resource).toEqual({ 'service.name': 'ownpace-api' });
    }
    const last = got.lines.at(-1)!;
    expect(got.next).toBe(`${last.Timestamp}-${last.Attributes['ownpace.audit.id'] as string}`);
    expect(got.caughtUp).toBe('true');
  });

  it('resumes where it stopped, a page at a time, until it has caught up', async () => {
    const seen: unknown[] = [];
    let cursor = '';
    let last: Awaited<ReturnType<typeof download>> | undefined;
    for (let n = 0; n < 10; n++) {
      last = await download(`?limit=1${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
      seen.push(...last.lines.map((l) => l.Attributes['ownpace.audit.id']));
      if (last.caughtUp === 'true') break;
      cursor = last.next ?? '';
    }

    expect(seen).toEqual(SETTLED.map((e) => e.id));
    expect(last?.lines).toEqual([]);
    expect(last?.next).toBe(cursor);
  });

  it('records every page it serves as one read of every customer: where it started, and how many lines', async () => {
    const first = await download('?limit=2');
    await download(`?limit=2&after=${first.next!}`);

    expect(await reads()).toEqual([
      { operator_user_id: OPERATOR, tenant_id: null, query: `after=${first.next!} limit=2`, result_count: 1 },
      { operator_user_id: OPERATOR, tenant_id: null, query: 'from=start limit=2', result_count: 2 },
    ]);
  });
});

describe('the view it reads, which nothing writes through', () => {
  /** A statement as an operator's transaction runs it: `app_user`, the operator's subject. */
  async function asOperator(statement: string): Promise<void> {
    const conn = await driver.acquire();
    try {
      await conn.query('BEGIN');
      await conn.query('SET LOCAL ROLE app_user');
      await conn.query(`SELECT set_config('app.current_user', $1, true)`, [OPERATOR]);
      await conn.query(statement);
    } finally {
      await conn.query('ROLLBACK');
      await conn.release();
    }
  }

  it('refuses an operator an insert, an update and a delete, and the audit log stays as it was', async () => {
    // A view over one table is one Postgres writes through, past the table's
    // row security: every customer's log, rewritten or erased from here.
    const before = await rows(`SELECT id, tenant_id, action FROM audit_log ORDER BY id`);

    for (const statement of [
      `INSERT INTO public.support_audit_export (id, tenant_id, actor, action)
       VALUES ('${id('f1')}', '${TENANT_B}', 'mapping-scheduler', 'share.decided')`,
      `UPDATE public.support_audit_export SET action = 'audit.rewritten'`,
      `DELETE FROM public.support_audit_export`,
    ]) {
      await expect(asOperator(statement), statement).rejects.toThrow(/permission denied/);
    }
    expect(await rows(`SELECT id, tenant_id, action FROM audit_log ORDER BY id`)).toEqual(before);
  });
});

describe('the headers the operator\'s page reads', () => {
  it('are shown to a page on another origin, when the web is deployed on one', () => {
    // Same-origin by default (`VITE_API_URL=/api`); with an absolute address,
    // a browser hides every response header CORS does not name, and the page
    // could not tell where the next page starts.
    const api = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');

    expect(api).toContain("exposedHeaders: ['Ownpace-Next-After', 'Ownpace-Caught-Up']");
  });
});

describe('what it serves nothing to, and records nothing for', () => {
  it('a signed-in person who is not an operator', async () => {
    caller = NOT_OPERATOR;

    const got = await download();

    expect(got.status).toBe(200);
    expect(got.lines).toEqual([]);
    expect(await reads()).toEqual([]);
  });

  it('a cursor or a page size that is not one, refused by name', async () => {
    for (const [query, field] of [
      ['?after=yesterday', 'after'],
      ['?limit=0', 'limit'],
      ['?limit=10001', 'limit'],
    ] as const) {
      const got = await download(query);
      expect(got.status, query).toBe(400);
      expect(got.body.field, query).toBe(field);
    }
    expect(await reads()).toEqual([]);
  });

  it('a read that cannot be recorded: nothing is sent', async () => {
    // The support doctrine: if the row cannot be written, the read does not
    // happen either. Here the database refuses the row.
    await rows(`REVOKE INSERT ON support_read FROM app_user`);
    let got: Awaited<ReturnType<typeof download>>;
    try {
      got = await download();
    } finally {
      await rows(`GRANT INSERT ON support_read TO app_user`);
    }

    expect(got.status).toBe(500);
    expect(got.text).not.toContain('share.decided');
    expect(await reads()).toEqual([]);
  });

  it('a key that cannot be read: nothing is sent, and nothing recorded as sent', async () => {
    keyMock.mockImplementation(async () => {
      throw new Error('the audit key could not be read');
    });

    const got = await download();

    expect(got.status).toBe(500);
    expect(got.text).not.toContain('share.decided');
    expect(await reads()).toEqual([]);
  });
});
