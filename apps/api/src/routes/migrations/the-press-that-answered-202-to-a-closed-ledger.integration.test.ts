// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The press that answered 202 to a closed ledger — through the real Express
 * app, on Postgres, with the Trigger.dev client mocked.
 *
 * `POST /api/migrations/:mappingId/cutover` used to enqueue the preparation
 * without reading the cutover ledger. A press on a cutover under way or on a
 * finished ledger got 202 and a promise ("on a PASSing verification the
 * mapping becomes READY_FOR_CUTOVER") that the job broke minutes later in a
 * run nobody was watching; a press on an APPROVED cutover revoked the
 * approval behind a 202 that said nothing about it.
 *
 * Now the door asks `prepareTransition` — the job's own rule — before it
 * enqueues. These cases pin every answer of that rule at the door: 409 with
 * the reason and nothing enqueued where the job would refuse; 202 that says
 * what the job will do everywhere else.
 *
 * UUID family: 5f4b0000-e29b-41d4-a716-4466554435xx (tenant ...3510).
 * Runs against Postgres (pnpm test:integration).
 */

process.env.JWT_SECRET = 'test-secret-for-integration-tests';
process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { createPgDb, CutoverStore } from '@openmig/ledger';
import type { CutoverState } from '@openmig/core';

// The real enqueue is the one thing this test must not do: capture it.
const { triggerMock } = vi.hoisted(() => ({
  triggerMock: vi.fn(async () => ({ id: 'run_mock_door' })),
}));
vi.mock('@openmig/scheduler', () => ({
  getTriggerClient: () => ({ tasks: { trigger: triggerMock } }),
}));

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const appUserUrl = (u: string): string => {
  const url = new URL(u);
  url.username = 'app_user';
  url.password = 'app_password';
  return url.toString();
};
process.env.APP_DATABASE_URL = appUserUrl(PG_CONNECTION_STRING);

import app from '../../index.ts';
import { seedMembership } from '../../__tests__/seed-membership.ts';

const TENANT = '5f4b0000-e29b-41d4-a716-446655443510';

function token(): string {
  return jwt.sign(
    { sub: `user-${TENANT}`, tenantId: TENANT, role: 'owner', email: `user@${TENANT}.test` },
    process.env.JWT_SECRET!,
  );
}

const createBody = {
  name: 'The cutover door',
  sourceType: 'imap' as const,
  targetType: 'jmap' as const,
  sourceConfig: { host: 'imap.src.test', port: 993, username: 'src@door.test', password: 'pw-1', useSsl: true },
  targetConfig: { host: 'jmap.tgt.test', port: 443, username: 'tgt@door.test', password: 'pw-2', useSsl: true },
  syncConfig: { domains: ['email'] as const, schedule: '*/15 * * * *' },
};

/** The machine's own edges from a fresh ledger to each state. */
const PATH_TO: Record<CutoverState, readonly CutoverState[]> = {
  PREPARING: [],
  READY_FOR_CUTOVER: ['READY_FOR_CUTOVER'],
  APPROVED: ['READY_FOR_CUTOVER', 'APPROVED'],
  CUTOVER_IN_PROGRESS: ['READY_FOR_CUTOVER', 'APPROVED', 'CUTOVER_IN_PROGRESS'],
  GRACE_PERIOD: ['READY_FOR_CUTOVER', 'APPROVED', 'CUTOVER_IN_PROGRESS', 'GRACE_PERIOD'],
  COMPLETED: ['READY_FOR_CUTOVER', 'APPROVED', 'CUTOVER_IN_PROGRESS', 'GRACE_PERIOD', 'COMPLETED'],
  ROLLED_BACK: ['READY_FOR_CUTOVER', 'APPROVED', 'CUTOVER_IN_PROGRESS', 'ROLLED_BACK'],
  FAILED: ['FAILED'],
};

describe('POST /api/migrations/:id/cutover asks the ledger before it enqueues', () => {
  let pool: Pool;
  let db: ReturnType<typeof createPgDb>;
  let cutoverStore: CutoverStore;
  let request: ReturnType<typeof supertest>;
  let mappingId: string;
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_CONNECTION_STRING });
    db = createPgDb(PG_CONNECTION_STRING);
    cutoverStore = new CutoverStore(db);
    await pool.query(
      `INSERT INTO tenant (id, name, status, settings) VALUES ($1,'Cutover door','active','{}') ON CONFLICT (id) DO NOTHING`,
      [TENANT],
    );
    await seedMembership(pool, TENANT, `user-${TENANT}`);
    request = supertest(app);

    const created = await request.post('/api/migrations').set(auth()).send(createBody);
    expect(created.status).toBe(201);
    mappingId = created.body.id;
  });

  beforeEach(async () => {
    triggerMock.mockClear();
    await pool.query(`DELETE FROM cutover_event WHERE tenant_id = $1`, [TENANT]);
    await pool.query(`DELETE FROM cutover_state WHERE tenant_id = $1`, [TENANT]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM cutover_event WHERE tenant_id = $1`, [TENANT]);
    await pool.query(`DELETE FROM cutover_state WHERE tenant_id = $1`, [TENANT]);
    await pool.query(`DELETE FROM tenant WHERE id = $1`, [TENANT]);
    await pool.end();
  });

  /** Walk the ledger to `target` through the machine's own edges. */
  async function driveTo(target: CutoverState): Promise<void> {
    await cutoverStore.initializeCutover({ tenantId: TENANT as never, mappingId: mappingId as never, startedBy: 'test' });
    for (const to of PATH_TO[target]) {
      await cutoverStore.transitionState(TENANT as never, mappingId as never, to, { by: 'test' });
    }
  }

  async function trail(): Promise<string[]> {
    const events = await cutoverStore.getEventHistory(TENANT as never, mappingId as never, 50);
    return events.map((e) => `${e.fromState ?? 'init'}->${e.toState}`);
  }

  const press = () => request.post(`/api/migrations/${mappingId}/cutover`).set(auth()).send({});

  it('with no ledger: 202, the job will create one, and the enqueue is the real cutover task', async () => {
    const res = await press();

    expect(res.status).toBe(202);
    expect(res.body.enqueued).toBe('cutover-preparation');
    expect(res.body.preparation).toEqual({ from: null, resetsToPreparing: false, revokesApproval: false });
    expect(triggerMock).toHaveBeenCalledWith(
      'run-cutover',
      expect.objectContaining({ tenantId: TENANT, mappingId }),
      expect.anything(),
    );
    // The door reads; it does not write. The ledger is the job's to create.
    expect(await trail()).toEqual([]);
  });

  it('on PREPARING: 202, prepared as it stands', async () => {
    await driveTo('PREPARING');

    const res = await press();

    expect(res.status).toBe(202);
    expect(res.body.preparation).toEqual({ from: 'PREPARING', resetsToPreparing: false, revokesApproval: false });
    expect(triggerMock).toHaveBeenCalledTimes(1);
  });

  it.each(['READY_FOR_CUTOVER', 'FAILED', 'ROLLED_BACK'] as const)(
    'on %s: 202, and the 202 says the job first records the way back to PREPARING',
    async (state) => {
      await driveTo(state);
      const before = await trail();

      const res = await press();

      expect(res.status).toBe(202);
      expect(res.body.preparation).toEqual({ from: state, resetsToPreparing: true, revokesApproval: false });
      expect(triggerMock).toHaveBeenCalledTimes(1);
      // Said, not done: the reset is the job's write, made when it runs.
      expect(await trail()).toEqual(before);
    },
  );

  it('on APPROVED: 202 that says the approval will be revoked — not a 202 that reads like a first preparation', async () => {
    await driveTo('APPROVED');

    const res = await press();

    expect(res.status).toBe(202);
    expect(res.body.preparation).toEqual({ from: 'APPROVED', resetsToPreparing: false, revokesApproval: true });
    expect(res.body.nextStep).toMatch(/approval is revoked/);
    expect(triggerMock).toHaveBeenCalledTimes(1);
  });

  it.each(['CUTOVER_IN_PROGRESS', 'GRACE_PERIOD'] as const)(
    'on %s: 409 under_way, nothing enqueued, the ledger untouched — the press used to be accepted and fail the cutover',
    async (state) => {
      await driveTo(state);
      const before = await trail();

      const res = await press();

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'cutover_refused', code: 'under_way', state });
      expect(res.body.message).toContain(`A cutover in ${state} is under way`);
      expect(res.body.hint).toContain('rollback --yes');
      expect(triggerMock).not.toHaveBeenCalled();
      const persisted = await cutoverStore.loadCutoverState(TENANT as never, mappingId as never);
      expect(persisted?.currentState).toBe(state);
      expect(await trail()).toEqual(before);
    },
  );

  it('on COMPLETED: 409 closed, nothing enqueued', async () => {
    await driveTo('COMPLETED');

    const res = await press();

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'cutover_refused', code: 'closed', state: 'COMPLETED' });
    expect(res.body.hint).toContain('finished');
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it('once a data type has a cutover of its own: 409, the whole migration is not prepared (0128 T5, slice 5b)', async () => {
    await cutoverStore.initializeCutover({
      tenantId: TENANT as never,
      mappingId: mappingId as never,
      startedBy: 'test',
      domain: 'email',
    });

    const res = await press();

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'cutover_refused', code: 'cut_over_by_data_type' });
    expect(res.body.message).toContain('email');
    expect(res.body.hint).toContain('--kind');
    expect(triggerMock).not.toHaveBeenCalled();
    expect(await cutoverStore.loadLedgers(TENANT as never, mappingId as never)).toEqual([
      { domain: 'email', state: 'PREPARING' },
    ]);
  });

  describe('one data type, prepared on its own (0128 T5, slice 5c)', () => {
    const pressFor = (domain: string) =>
      request.post(`/api/migrations/${mappingId}/cutover`).set(auth()).send({ domain });

    it('with no ledger: 202 that names it, and the job is asked for that data type alone', async () => {
      const res = await pressFor('email');

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ enqueued: 'cutover-preparation', domain: 'email' });
      expect(res.body.preparation).toEqual({ from: null, resetsToPreparing: false, revokesApproval: false });
      expect(triggerMock).toHaveBeenCalledWith(
        'run-cutover',
        expect.objectContaining({ tenantId: TENANT, mappingId, domain: 'email' }),
        expect.anything(),
      );
      expect(await trail()).toEqual([]);
    });

    it("beside the whole migration's that failed: 202, from the ledger it inherits, taken back to PREPARING first", async () => {
      await driveTo('FAILED');

      const res = await pressFor('email');

      expect(res.status).toBe(202);
      expect(res.body.preparation).toEqual({ from: 'FAILED', resetsToPreparing: true, revokesApproval: false });
      expect(triggerMock).toHaveBeenCalledTimes(1);
    });

    it("while the whole migration's cutover is under way: 409 whole_under_way, nothing enqueued", async () => {
      await driveTo('APPROVED');

      const res = await pressFor('email');

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'cutover_refused', code: 'whole_under_way' });
      expect(res.body.message).toContain('APPROVED');
      expect(triggerMock).not.toHaveBeenCalled();
      expect(await cutoverStore.loadLedgers(TENANT as never, mappingId as never)).toEqual([{ state: 'APPROVED' }]);
    });

    it('a data type the migration does not carry: 409 not_a_path, nothing enqueued', async () => {
      const res = await pressFor('calendar');

      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'cutover_refused', code: 'not_a_path' });
      expect(res.body.message).toBe('This migration does not carry calendar; it carries email.');
      expect(triggerMock).not.toHaveBeenCalled();
    });

    it('a word that is not a data type: 400, nothing enqueued', async () => {
      const res = await pressFor('mail');

      expect(res.status).toBe(400);
      expect(triggerMock).not.toHaveBeenCalled();
    });
  });

  it('a press on a mapping that is not the tenant\'s is 404 before the ledger is asked', async () => {
    const other = '5f4b0000-e29b-41d4-a716-446655443511';
    const res = await request.post(`/api/migrations/${other}/cutover`).set(auth()).send({});

    expect(res.status).toBe(404);
    expect(triggerMock).not.toHaveBeenCalled();
  });
});
