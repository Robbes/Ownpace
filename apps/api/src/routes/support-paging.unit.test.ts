// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The two support lists, a page at a time (an outside, read-only check,
 * PERF-2; workplan 0006 §P), against a REAL database.
 *
 * Its own PGlite rather than `support-routes.unit.test.ts`'s, because paging is
 * only shown with more rows than a page, and those would change every count
 * that file asserts. The fixtures are built so each page break falls where a
 * wrong keyset would show: inside a run of organisations with the SAME name,
 * inside one erasure's invoices with the same period, between two purge times
 * one microsecond apart, and inside the rows with no purge time at all.
 *
 * PGlite as `app_user`, both migration chains, and only `authenticateSubject`
 * stubbed, as in `support-routes.unit.test.ts`.
 *
 * UUID family 5f5d0000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SUPPORT_PAGE, encodeCursor, tenantsCursor } from '../support-page.ts';

const OPERATOR = 'operator-subject-paging';
const NOT_OPERATOR = 'ordinary-subject-paging';

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

const { default: supportRoutes } = await import('./support.ts');

const app = express();
app.use(express.json());
app.use('/api/support', supportRoutes);

async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(sql, params);
    return r.rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const logRows = () => rows('SELECT operator_user_id, tenant_id, view_name FROM support_read ORDER BY at');

const get = (path: string) => request(app).get(path).set('Authorization', 'Bearer stub');

/** A uuid of this file's family, numbered. */
const id = (kind: number, n: number) =>
  `5f5d0000-0000-4000-8000-${kind.toString(16).padStart(4, '0')}${n.toString(16).padStart(8, '0')}`;
/** A tenant_ref of the right shape: 64 hex characters, numbered. */
const ref = (n: number) => n.toString(16).padStart(64, '0');

/** Every page of a list, following `next` until it is null. */
async function allPages(path: string): Promise<Array<Record<string, unknown>>> {
  const pages: Array<Record<string, unknown>> = [];
  let next: string | null = null;
  do {
    const res = await get(next ? `${path}?after=${next}` : path);
    expect(res.status).toBe(200);
    pages.push(res.body as Record<string, unknown>);
    next = (res.body as { next: string | null }).next;
  } while (next !== null && pages.length < 10);
  return pages;
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await rows(
    `INSERT INTO platform_operator (user_id, email, note)
     VALUES ($1, 'operator@example.invalid', 'workplan 0006 §P fixture')`,
    [OPERATOR],
  );
}, 30_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  caller = undefined;
  await rows('DELETE FROM support_read');
});

describe('an empty list is one page, with nothing after it', () => {
  it('serves no organisations and no next, and records the read', async () => {
    caller = OPERATOR;
    const res = await get('/api/support/tenants');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tenants: [], next: null });
    expect(await logRows()).toEqual([
      { operator_user_id: OPERATOR, tenant_id: null, view_name: 'tenants' },
    ]);
  });

  it('serves no kept invoices, no numbers and no next', async () => {
    caller = OPERATOR;
    const res = await get('/api/support/retained-invoices');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ invoices: [], numbers: [], next: null });
  });
});

describe('the organisations, a page at a time', () => {
  // 97 single names, five organisations all called "Org 097" (rows 97 to 101,
  // across the first page break), and a hundred after them: 202.
  const TOTAL = 202;
  beforeAll(async () => {
    const values: string[] = [];
    let n = 0;
    for (let i = 0; i < 97; i++) values.push(`('${id(1, n++)}', 'Org ${String(i).padStart(3, '0')}')`);
    for (let i = 0; i < 5; i++) values.push(`('${id(1, n++)}', 'Org 097')`);
    for (let i = 98; i < 198; i++) values.push(`('${id(1, n++)}', 'Org ${String(i).padStart(3, '0')}')`);
    await rows(`INSERT INTO tenant (id, name) VALUES ${values.join(',')}`);
    expect(n).toBe(TOTAL);
  });

  it('serves the first page as the first hundred, with a next', async () => {
    caller = OPERATOR;
    const res = await get('/api/support/tenants');
    expect(res.status).toBe(200);
    expect(res.body.tenants).toHaveLength(SUPPORT_PAGE);
    expect(typeof res.body.next).toBe('string');
    expect(res.body.tenants[0].tenant_name).toBe('Org 000');
  });

  it('continues on the next page after the last row, through a run of one name, and ends', async () => {
    caller = OPERATOR;
    const pages = await allPages('/api/support/tenants');
    expect(pages.map((p) => (p.tenants as unknown[]).length)).toEqual([100, 100, 2]);
    // The last page says there is nothing after it.
    expect(pages[2]?.next).toBeNull();
    const served = pages.flatMap((p) => p.tenants as Array<{ tenant_id: string }>).map((t) => t.tenant_id);
    // Every organisation once, none twice, in the order the database sorts them.
    const expected = (await rows('SELECT id FROM tenant ORDER BY name, id')).map((r) => r.id);
    expect(served).toEqual(expected);
    expect(new Set(served).size).toBe(TOTAL);
  });

  it('records each page as its own read, none naming an organisation', async () => {
    caller = OPERATOR;
    await allPages('/api/support/tenants');
    const log = await logRows();
    expect(log).toHaveLength(3);
    for (const row of log) {
      expect(row).toEqual({ operator_user_id: OPERATOR, tenant_id: null, view_name: 'tenants' });
    }
  });

  it('serves a non-operator nothing and no next, and records nothing', async () => {
    caller = NOT_OPERATOR;
    const res = await get('/api/support/tenants');
    expect(res.body).toEqual({ tenants: [], next: null });
    // A cursor an operator was given reads nothing for them either.
    caller = OPERATOR;
    const next = (await get('/api/support/tenants')).body.next as string;
    await rows('DELETE FROM support_read');
    caller = NOT_OPERATOR;
    expect((await get(`/api/support/tenants?after=${next}`)).body).toEqual({ tenants: [], next: null });
    expect(await logRows()).toEqual([]);
  });
});

describe('what an erasure kept, a page at a time', () => {
  // Invoices: erasure 0 keeps 40 with the same period (a break inside them
  // needs the id); erasures 1 to 59 keep one each, purged at two times one
  // microsecond apart; erasure 60 has no purge time and keeps 5, which sort
  // last, and the first page ends inside them. 104 invoices: 100, then 4.
  // Numbers: erasures 0 to 60 and 189 more with numbers only: 250, so the
  // numbers list runs a page past the invoices.
  const P1 = '2026-07-01T00:00:00.000001Z';
  const P2 = '2026-07-01T00:00:00.000002Z';
  const INVOICES = 104;
  const NUMBERS = 250;
  beforeAll(async () => {
    let inv = 0;
    const invoiceValues: string[] = [];
    const erasureValues: string[] = [];
    const keep = (count: number, day: (k: number) => string) => {
      const ids: string[] = [];
      for (let k = 0; k < count; k++) {
        const invoiceId = id(2, inv++);
        ids.push(invoiceId);
        invoiceValues.push(
          `('${invoiceId}', NULL, 'Kept ${inv}', DATE '${day(k)}', DATE '${day(k)}', 'paid', 10, 'EUR')`,
        );
      }
      return `ARRAY[${ids.map((i) => `'${i}'::uuid`).join(',')}]::uuid[]`;
    };
    const erasure = (n: number, purged: string | null, kept: string) =>
      erasureValues.push(
        `('${ref(n)}', TIMESTAMPTZ '2026-06-01T00:00:00Z', 30, ` +
          `${purged ? `TIMESTAMPTZ '${purged}'` : 'NULL'}, ${kept}, ARRAY['N-${n}'])`,
      );
    erasure(0, P1, keep(40, () => '2026-05-01'));
    for (let n = 1; n < 60; n++) erasure(n, n % 2 ? P2 : P1, keep(1, () => `2026-04-${String((n % 28) + 1).padStart(2, '0')}`));
    erasure(60, null, keep(5, (k) => `2026-03-0${k + 1}`));
    for (let n = 61; n < NUMBERS; n++) erasure(n, P1, `'{}'::uuid[]`);
    expect(inv).toBe(INVOICES);
    await rows(
      `INSERT INTO invoice (id, tenant_id, billed_to_name, period_start, period_end, status, total, currency)
       VALUES ${invoiceValues.join(',')}`,
    );
    await rows(
      `INSERT INTO erasure_record
         (tenant_ref, requested_at, window_days, purged_at, retained_invoice_ids, invoice_numbers)
       VALUES ${erasureValues.join(',')}`,
    );
  });

  it('serves the first page as a hundred of each, with a next', async () => {
    caller = OPERATOR;
    const res = await get('/api/support/retained-invoices');
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(SUPPORT_PAGE);
    expect(res.body.numbers).toHaveLength(SUPPORT_PAGE);
    expect(typeof res.body.next).toBe('string');
    // The cursor's own columns stay out of the rows.
    expect(Object.keys(res.body.invoices[0] as object)).not.toContain('page_purged_at');
    expect(Object.keys(res.body.numbers[0] as object)).not.toContain('page_purged_at');
  });

  it('continues each list where it stopped, reads on only the one with more, and ends', async () => {
    caller = OPERATOR;
    const pages = await allPages('/api/support/retained-invoices');
    expect(pages.map((p) => [(p.invoices as unknown[]).length, (p.numbers as unknown[]).length])).toEqual([
      [100, 100],
      [4, 100],
      [0, 50],
    ]);
    expect(pages[2]?.next).toBeNull();

    const invoices = pages.flatMap((p) => p.invoices as Array<{ invoice_id: string }>).map((i) => i.invoice_id);
    const expectedInvoices = (
      await rows(
        `SELECT i.id FROM erasure_record e
           CROSS JOIN LATERAL unnest(e.retained_invoice_ids) AS r(invoice_id)
           JOIN invoice i ON i.id = r.invoice_id
          ORDER BY e.purged_at DESC NULLS LAST, i.period_start DESC, i.id DESC`,
      )
    ).map((r) => r.id);
    expect(invoices).toEqual(expectedInvoices);
    expect(new Set(invoices).size).toBe(INVOICES);

    const numbers = pages.flatMap((p) => p.numbers as Array<{ tenant_ref: string }>).map((n) => n.tenant_ref);
    const expectedNumbers = (
      await rows(
        `SELECT tenant_ref FROM erasure_record WHERE cardinality(invoice_numbers) > 0
          ORDER BY purged_at DESC NULLS LAST, tenant_ref DESC`,
      )
    ).map((r) => r.tenant_ref);
    expect(numbers).toEqual(expectedNumbers);
    expect(new Set(numbers).size).toBe(NUMBERS);
  });

  it('records each page as its own read', async () => {
    caller = OPERATOR;
    await allPages('/api/support/retained-invoices');
    expect(await logRows()).toEqual(
      [1, 2, 3].map(() => ({ operator_user_id: OPERATOR, tenant_id: null, view_name: 'retained_invoices' })),
    );
  });
});

describe('a cursor this route did not give is a 400, and reads nothing', () => {
  const retainedShape = encodeCursor({
    invoices: { purgedAt: null, periodStart: '2026-05-01', invoiceId: id(2, 0) },
    numbers: null,
  });
  const cases: Array<[string, string]> = [
    ['not base64url', 'not a cursor!'],
    ['not JSON', Buffer.from('{name:', 'utf8').toString('base64url')],
    ['JSON of the wrong shape', encodeCursor({ name: 'Org 001' })],
    ['an extra field', encodeCursor({ name: 'Org 001', id: id(1, 0), offset: 5 })],
    ['an id that is not a uuid', encodeCursor({ name: 'Org 001', id: 'drop table' })],
    ['the other list’s cursor', retainedShape],
  ];

  for (const [what, after] of cases) {
    it(`refuses ${what} on the organisations`, async () => {
      caller = OPERATOR;
      const res = await get(`/api/support/tenants?after=${encodeURIComponent(after)}`);
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('after');
      expect(await logRows()).toEqual([]);
    });
  }

  const retainedCases: Array<[string, string]> = [
    ['not base64url', 'not a cursor!'],
    ['not JSON', Buffer.from('[', 'utf8').toString('base64url')],
    ['the organisations’ cursor', tenantsCursor({ name: 'Org 001', id: id(1, 0) })],
    ['both lists ended', encodeCursor({ invoices: null, numbers: null })],
    [
      'a day that does not exist',
      encodeCursor({ invoices: { purgedAt: null, periodStart: '2026-02-30', invoiceId: id(2, 0) }, numbers: null }),
    ],
    [
      'a time cut to milliseconds',
      encodeCursor({ invoices: null, numbers: { purgedAt: '2026-07-01T00:00:00.000Z', tenantRef: ref(1) } }),
    ],
    ['a hash of the wrong shape', encodeCursor({ invoices: null, numbers: { purgedAt: null, tenantRef: 'abc' } })],
  ];

  for (const [what, after] of retainedCases) {
    it(`refuses ${what} on what an erasure kept`, async () => {
      caller = OPERATOR;
      const res = await get(`/api/support/retained-invoices?after=${encodeURIComponent(after)}`);
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('after');
      expect(await logRows()).toEqual([]);
    });
  }

  it('refuses the cursor given twice', async () => {
    caller = OPERATOR;
    const good = tenantsCursor({ name: 'Org 001', id: id(1, 0) });
    const res = await get(`/api/support/tenants?after=${good}&after=${good}`);
    expect(res.status).toBe(400);
    expect(await logRows()).toEqual([]);
  });

  it('still answers 401 before it reads the cursor', async () => {
    caller = undefined;
    expect((await get('/api/support/tenants?after=garbage')).status).toBe(401);
  });
});
