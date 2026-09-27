// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ACCOUNT A TESTER COULD NOT END (workplan 0139 T7 (a)).
 *
 * Terms §11 lets a tester end their account, and the only way to end one was
 * the Close button, which needs the organisation's own owner signed in. A
 * tester who asked the operator to close theirs could not be closed by the
 * operator at all. `operator.sh close` does it at the machine, through the
 * function the button calls, so the two cannot drift.
 *
 * Against PGlite, both migration chains applied, with the orchestrator
 * stubbed: the button as `app_user`, as the API serves it, and the command over
 * the owner connection, as `operator.sh` reaches the database.
 *
 * - for the same organisation, window and moment, the command answers what
 *   the button answers: the dates, the sentences in both languages, the
 *   grants only the tester can withdraw;
 * - the command refuses a window outside the list, and a subject that is not
 *   an appointed operator's, and writes nothing;
 * - the audit row names the operator and the tester's request, and the
 *   button's names the owner;
 * - both ask the orchestrator to stop that organisation's passes in flight,
 *   and nobody else's. The button's close used to read them with no
 *   organisation set, and `run` is under FORCE ROW LEVEL SECURITY, so as
 *   `app_user` it saw none and stopped nothing;
 * - an orchestrator that does not answer never fails the close.
 *
 * It fails today: `operator.sh close` does not exist. The names are invented.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { ACCOUNT_CLOSED_ACTION } from '../close-account.ts';
import { describeClosed, parseCloseCommand, runCloseCommand, type CloseCommand } from './operator-close.ts';

// UUID family 0139c700-…, unused elsewhere in the repo.
const BY_BUTTON = '0139c700-e29b-41d4-a716-446655440001';
const BY_OPERATOR = '0139c700-e29b-41d4-a716-446655440002';
const BYSTANDER = '0139c700-e29b-41d4-a716-446655440003';
const NOBODY = '0139c700-e29b-41d4-a716-446655440004';
const NOW = new Date('2026-09-27T12:00:00.000Z');
const OPERATOR = 'op-subject-0139c7';
const OWNER = 'owner-subject-0139c7';
/** The orchestrator reference of an organisation's pass, by its status. */
const refOf = (tenantId: string, status: string) => `run_${tenantId.slice(-4)}_${status}`;
/** The passes of an organisation that are in flight, which a close asks to stop. */
const inFlight = (tenantId: string) => [refOf(tenantId, 'queued'), refOf(tenantId, 'running')];

let driver: LedgerDriver;
/**
 * The same database over the owner connection, as `operator.sh` reaches it:
 * no drop to `app_user`, so row security does not narrow what it reads, and
 * the command's own SQL has to.
 */
let asOwner: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: BY_BUTTON, userId: OWNER, userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

/** The orchestrator the button asks, as the route reaches it. */
const buttonCancels: string[] = [];
vi.mock('@openmig/scheduler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmig/scheduler')>()),
  getTriggerClient: () => ({ runs: { cancel: async (ref: string) => void buttonCancels.push(ref) } }),
}));

const { default: tenantRoutes } = await import('../routes/tenants/index.ts');
const app = express();
app.use(express.json());
app.use('/api/tenants', tenantRoutes);

async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<Record<string, unknown>>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

const statusOf = async (tenantId: string) =>
  String((await sql('SELECT status FROM tenant WHERE id = $1', [tenantId]))[0]?.status);

const auditOf = async (tenantId: string) =>
  sql('SELECT actor, action, entity, detail FROM audit_log WHERE tenant_id = $1 AND action = $2', [
    tenantId,
    ACCOUNT_CLOSED_ACTION,
  ]);

const command = (over: Partial<CloseCommand> = {}): CloseCommand => ({
  tenantId: BY_OPERATOR,
  windowDays: 30,
  by: OPERATOR,
  reference: 'ticket 4821, their mail of 2026-09-26',
  ...over,
});

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  asOwner = { ...driver, role: undefined };
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  buttonCancels.length = 0;
  // Seeded outside a tenant's context, so as the owner, the way the
  // organisations came to exist.
  await sql('DELETE FROM run');
  await sql('DELETE FROM audit_log');
  await sql('DELETE FROM connection');
  await sql('DELETE FROM tenant_closure');
  await sql('DELETE FROM erasure_record');
  await sql('DELETE FROM platform_operator');
  await sql('DELETE FROM tenant');
  await sql(`INSERT INTO platform_operator (user_id, email) VALUES ($1, 'op@example.invalid')`, [OPERATOR]);
  for (const tenantId of [BY_BUTTON, BY_OPERATOR, BYSTANDER]) {
    await sql(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Example Care', 'active')`, [tenantId]);
    // The same two kinds everywhere, so the grants each close names are comparable.
    for (const kind of ['google', 'imap']) {
      await sql(
        `INSERT INTO connection (tenant_id, role, kind, display_name, config, status)
         VALUES ($1, 'source', $2, $2, '{}'::jsonb, 'connected')`,
        [tenantId, kind],
      );
    }
    // Passes in flight, running and queued, with their orchestrator references;
    // one queued before the orchestrator took it, with none; and one finished.
    for (const status of ['running', 'queued', 'succeeded']) {
      await sql(`INSERT INTO run (tenant_id, kind, status, orchestrator_ref) VALUES ($1, 'incremental', $2, $3)`, [
        tenantId,
        status,
        refOf(tenantId, status),
      ]);
    }
    await sql(`INSERT INTO run (tenant_id, kind, status) VALUES ($1, 'incremental', 'queued')`, [tenantId]);
  }
});

afterEach(() => {
  vi.useRealTimers();
});

describe('operator.sh close answers what the Close button answers', () => {
  it('for the same organisation, window and moment: the dates, the sentences, the grants', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const button = await request(app).post(`/api/tenants/${BY_BUTTON}/close`).send({ windowDays: 30 });
    vi.useRealTimers();
    expect(button.status).toBe(200);

    const operatorCancels: string[] = [];
    const closed = await runCloseCommand(
      asOwner,
      command(),
      { cancelRun: async (ref) => void operatorCancels.push(ref) },
      NOW,
      { BACKUP_RETENTION_DAYS: process.env.BACKUP_RETENTION_DAYS },
    );

    expect(closed).toEqual(button.body);
    expect(closed.windowDays).toBe(30);
    expect(closed.erasureCompletesText.nl).not.toBe(closed.erasureCompletesText.en);
    expect(closed.outlivingAccess.en.length).toBeGreaterThan(0);
    expect(await statusOf(BY_BUTTON)).toBe('closed');
    expect(await statusOf(BY_OPERATOR)).toBe('closed');
    // Each asked the orchestrator to stop its own passes in flight, and only those:
    // not a finished one, not one the orchestrator never took, not another's.
    expect(buttonCancels.sort()).toEqual(inFlight(BY_BUTTON));
    expect(operatorCancels.sort()).toEqual(inFlight(BY_OPERATOR));
    expect(await statusOf(BYSTANDER)).toBe('active');
  });

  it('prints what to tell the tester, in both languages', async () => {
    const closed = await runCloseCommand(asOwner, command(), { cancelRun: async () => {} }, NOW);
    const printed = describeClosed(command(), closed).join('\n');
    expect(printed).toContain(`recorded under ${OPERATOR}`);
    expect(printed).toContain(closed.erasureCompletesText.en);
    expect(printed).toContain(closed.erasureCompletesText.nl);
    expect(printed).toContain(closed.purgeAfter);
    expect(printed).toContain(closed.backupsExpireAt);
  });
});

describe('the audit row says who closed it, how, and because of what', () => {
  it('the operator, and the tester’s request, on the row and on the closure', async () => {
    await runCloseCommand(asOwner, command(), { cancelRun: async () => {} }, NOW);
    expect(await auditOf(BY_OPERATOR)).toEqual([
      {
        actor: OPERATOR,
        action: ACCOUNT_CLOSED_ACTION,
        entity: 'tenant',
        detail: { windowDays: 30, via: 'operator', reference: 'ticket 4821, their mail of 2026-09-26' },
      },
    ]);
    const closure = await sql('SELECT closed_by FROM tenant_closure WHERE tenant_id = $1', [BY_OPERATOR]);
    expect(closure[0]?.closed_by).toBe(OPERATOR);
  });

  it('the button’s names the owner who pressed it', async () => {
    const res = await request(app).post(`/api/tenants/${BY_BUTTON}/close`).send({ windowDays: 7 });
    expect(res.status).toBe(200);
    expect(await auditOf(BY_BUTTON)).toEqual([
      { actor: OWNER, action: ACCOUNT_CLOSED_ACTION, entity: 'tenant', detail: { windowDays: 7, via: 'screen' } },
    ]);
  });
});

describe('what the command refuses, before anything is written', () => {
  it.each<[string, string[], RegExp]>([
    ['a window outside the list', [BY_OPERATOR, '14', '--by', OPERATOR, '--reference', 'r'], /must be one of 0, 7, 30, 90 days, not 14/],
    ['a window that is not a number', [BY_OPERATOR, '30d', '--by', OPERATOR, '--reference', 'r'], /must be one of/],
    ['no subject', [BY_OPERATOR, '30', '--reference', 'r'], /--by names you/],
    ['no reference', [BY_OPERATOR, '30', '--by', OPERATOR], /--reference names the tester's request/],
    ['a flag without its value', [BY_OPERATOR, '30', '--by', '--reference', 'r'], /--by needs a value/],
    ['something that is not a tenant id', ['acme', '30', '--by', OPERATOR, '--reference', 'r'], /not a tenant id/],
    ['an option it does not have', [BY_OPERATOR, '30', '--by', OPERATOR, '--reference', 'r', '--force'], /not an option/],
  ])('%s', (_what, args, refusal) => {
    const parsed = parseCloseCommand(args);
    expect('error' in parsed ? parsed.error : '').toMatch(refusal);
  });

  it('reads a well-formed command', () => {
    expect(parseCloseCommand([BY_OPERATOR, '0', '--reference', 'ticket 9', '--by', OPERATOR])).toEqual({
      tenantId: BY_OPERATOR,
      windowDays: 0,
      by: OPERATOR,
      reference: 'ticket 9',
    });
  });

  it('a subject that is not an appointed operator’s closes nothing', async () => {
    await expect(
      runCloseCommand(asOwner, command({ by: 'somebody-else' }), { cancelRun: async () => {} }, NOW),
    ).rejects.toThrow(/somebody-else is not an appointed operator/);
    expect(await statusOf(BY_OPERATOR)).toBe('active');
    expect(await sql('SELECT 1 FROM tenant_closure WHERE tenant_id = $1', [BY_OPERATOR])).toEqual([]);
    expect(await auditOf(BY_OPERATOR)).toEqual([]);
  });

  it('an organisation that is not there closes nothing, and says so', async () => {
    await expect(
      runCloseCommand(asOwner, command({ tenantId: NOBODY }), { cancelRun: async () => {} }, NOW),
    ).rejects.toThrow(/does not exist/);
  });
});

describe('the passes in flight', () => {
  it('as the API’s role with no organisation set, a read of `run` finds no pass: why the old close stopped none', async () => {
    // The route read the passes in flight on the API's pool, as `app_user`,
    // with no organisation set. `run` is under FORCE ROW LEVEL SECURITY, so
    // that read either saw no rows or failed on the unset setting, and the
    // close asked the orchestrator to stop nothing.
    const conn = await driver.acquire();
    try {
      await conn.query('BEGIN');
      await conn.query('SET LOCAL ROLE app_user');
      const seen = await conn
        .query(`SELECT id FROM run WHERE tenant_id = $1 AND status IN ('running', 'queued')`, [BY_OPERATOR])
        .then((r) => r.rows.length, () => 0);
      expect(seen).toBe(0);
    } finally {
      await conn.query('ROLLBACK');
      await conn.release();
    }
    // The same passes, read the way the close now reads them, in the
    // organisation's own context: both are there.
    const stopped: string[] = [];
    await runCloseCommand(asOwner, command(), { cancelRun: async (ref) => void stopped.push(ref) }, NOW);
    expect(stopped.sort()).toEqual(inFlight(BY_OPERATOR));
  });

  it('an orchestrator that does not answer never fails the close', async () => {
    const closed = await runCloseCommand(
      asOwner,
      command(),
      {
        cancelRun: async () => {
          throw new Error('connect ECONNREFUSED');
        },
      },
      NOW,
    );
    expect(closed.passesStopped).toBe(0);
    expect(await statusOf(BY_OPERATOR)).toBe('closed');
  });
});
