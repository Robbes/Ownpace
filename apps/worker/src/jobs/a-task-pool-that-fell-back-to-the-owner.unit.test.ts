// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TASK POOL THAT FELL BACK TO THE OWNER (workplan 0138 T1 parts 1 and 5).
 *
 * `openTaskPools` (`task-pools.ts`) is the one place a per-tenant task's pools
 * are built. It builds two:
 *
 *   - the tenant pool, on `APP_DATABASE_URL`, `app_user`, whom row security
 *     binds. Every read and write a pass makes about an organisation goes
 *     through it, inside that organisation's scope. It REFUSES to start when
 *     `APP_DATABASE_URL` is unset, and never falls back to `DATABASE_URL`. The
 *     API's `getDbPool` falls back, for the appliance's sake; a task that did
 *     would be quietly back on the owner, a superuser, and every scope in it
 *     would change nothing again, with nothing to say so.
 *   - the audit key's pool: ONE connection, on `DATABASE_URL`, the owner's,
 *     for the one read `app_user` may not make, `deployment_key` (ledger
 *     migration 0062). The audit export reads its pseudonym key there. On the
 *     tenant pool the read is refused, and the event is kept while its line is
 *     lost, every line, in silence but for a warning. It is the API's
 *     `auditKeyPool` (apps/api/src/index.ts), in a task.
 *
 * It also points the process's two sinks: the audit export at the key's pool,
 * and the operator's log page (app events, which `app_user` may insert) at the
 * tenant pool. It hands the job the tenant pool and a way to end it, and never
 * the key's pool: the owner's connection bypasses row security, and a job
 * that could reach it could read tenant data on it with every guard green
 * (0138 T1 step 2's review). So the key's pool is found here the way the sink
 * finds it, as the pool asked for a connection. Nothing here needs a database:
 * node-postgres builds a pool without connecting, and the sinks are told apart
 * by which pool is asked for a connection. Whether the tenant pool really is
 * `app_user` and the line really prints is asked of Postgres by
 * `a-pass-under-row-security` (integration). Whether each job takes its pools
 * from here, takes only the tenant pool, and whether this module does anything
 * at import, is `a-pass-that-opened-the-owners-pool`'s.
 *
 * The three jobs split in two (0138 T2: the digest, the drift detector and
 * group discovery) take their pools from it too, and ask their one question
 * across organisations through `activeOrganisations`: which organisations are
 * active, as ids. That list is read on the owner's URL, never on
 * `APP_DATABASE_URL`, where with no organisation set it would find none and
 * every such job would visit nobody and call it a quiet morning. So it
 * refuses without `DATABASE_URL`, asks first whether its connection sees every
 * organisation and refuses when it does not, and closes its one connection
 * before it answers. Here without a database: its pool's `query` answers.
 *
 * The addresses are invented; nothing here is contacted.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { exportAuditEvent, recordAppEvent, setAppEventSink, setAuditExportSink } from '@openmig/shared';
import { ACTIVE_ORGANISATIONS_SQL, activeOrganisations, openTaskPools, type TaskPools } from './task-pools.ts';

const APP = 'postgresql://app_user:not-a-password@pgbouncer.example.invalid:6432/ownpace';
const OWNER = 'postgresql://ownpace:not-a-password@pgbouncer.example.invalid:6432/ownpace';

/** node-postgres keeps what it was given; its types do not say so. */
const optionsOf = (pool: unknown) =>
  (pool as { options: { connectionString?: string; max?: number; idleTimeoutMillis?: number } }).options;

const opened: TaskPools[] = [];
const open = (env: Record<string, string | undefined>, write?: (line: string) => void): TaskPools => {
  const pools = openTaskPools(env, write ? { write } : {});
  opened.push(pools);
  return pools;
};

/**
 * Every pool asked for a connection, in order, none of them connecting: the
 * key's pool is the one that is not the tenant pool.
 */
const watchConnections = () => {
  const asked: Pool[] = [];
  vi.spyOn(Pool.prototype, 'connect').mockImplementation(function (this: Pool) {
    asked.push(this);
    return Promise.reject(new Error('nothing here connects'));
  } as never);
  return asked;
};

/** An audit event, as a rollback records one: its line needs the key. */
const anAuditEvent = () =>
  exportAuditEvent({
    id: '0138c000-e29b-41d4-a716-446655440001',
    at: '2026-09-28T12:00:00.000000Z',
    tenantId: '0138c000-e29b-41d4-a716-4466554400a1',
    actor: 'trigger-job',
    action: 'mapping.status_changed',
  });

afterEach(async () => {
  setAuditExportSink(undefined);
  setAppEventSink(undefined);
  vi.restoreAllMocks();
  // The key's pools connected to nothing, and close their own connection.
  for (const pools of opened.splice(0)) await pools.end();
});

describe('the tenant pool is the application role, or nothing', () => {
  it('refuses to start without APP_DATABASE_URL, although the owner is right there', () => {
    expect(() => openTaskPools({ DATABASE_URL: OWNER })).toThrow(/APP_DATABASE_URL/);
    expect(() => openTaskPools({ DATABASE_URL: OWNER })).toThrow(/never DATABASE_URL/);
    expect(() => openTaskPools({ APP_DATABASE_URL: '', DATABASE_URL: OWNER })).toThrow(/APP_DATABASE_URL/);
    expect(() => openTaskPools({ APP_DATABASE_URL: '   ', DATABASE_URL: OWNER })).toThrow(/APP_DATABASE_URL/);
  });

  it('builds it on APP_DATABASE_URL, and never on the owner\'s URL', () => {
    const pools = open({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER });

    expect(optionsOf(pools.tenant).connectionString).toBe(APP);
    expect(optionsOf(pools.tenant).connectionString).not.toBe(OWNER);
  });

  it('hands the job the tenant pool and its end, and no pool on the owner\'s URL', () => {
    // The key's pool is the owner, whom row security never binds. Handed back,
    // a job could take it for its tenant pool in one token, and every guard
    // stayed green (0138 T1 step 2's review, three such changes, 486 tests).
    const pools = open({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER });

    expect(Object.keys(pools).sort()).toEqual(['end', 'tenant']);
    for (const value of Object.values(pools)) {
      if (value instanceof Pool) expect(optionsOf(value).connectionString).toBe(APP);
    }
  });
});

describe('the audit key has a pool of its own, of one connection, on the owner\'s URL', () => {
  it('reads the key where app_user may not: one connection, the owner\'s, closed a second after', async () => {
    const asked = watchConnections();
    const pools = open({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER }, () => {});

    anAuditEvent();

    await vi.waitFor(() => expect(asked).toHaveLength(1));
    const [keyPool] = asked as [Pool];
    expect(keyPool).not.toBe(pools.tenant);
    expect(optionsOf(keyPool).connectionString).toBe(OWNER);
    expect(optionsOf(keyPool).max).toBe(1);
    expect(optionsOf(keyPool).idleTimeoutMillis).toBeLessThanOrEqual(1_000);
    // A dropped idle connection is a warning, not the end of the process.
    expect(keyPool.listenerCount('error')).toBeGreaterThanOrEqual(1);
  });

  it('refuses to start without DATABASE_URL, since every audit line would then be lost', () => {
    expect(() => openTaskPools({ APP_DATABASE_URL: APP })).toThrow(/DATABASE_URL/);
    expect(() => openTaskPools({ APP_DATABASE_URL: APP })).toThrow(/audit/);
  });
});

describe('the sinks it points: the key asked of its pool, the operator\'s events of the tenant pool', () => {
  it('asks the key\'s pool, never the tenant pool, for the key an audit line is made with', async () => {
    const asked = watchConnections();
    const pools = open({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER }, () => {});

    anAuditEvent();

    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).not.toBe(pools.tenant);
    expect(optionsOf(asked[0]).connectionString).toBe(OWNER);
  });

  it('records the operator\'s events on the tenant pool, which app_user may insert into', async () => {
    const asked = watchConnections();
    const pools = open({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER }, () => {});

    await recordAppEvent({ level: 'error', event: 'task.pool_check', reference: '0138c0de' });

    expect(asked).toEqual([pools.tenant]);
  });
});

describe('importing it does nothing', () => {
  it('imports with no APP_DATABASE_URL set, and builds nothing until it is called', async () => {
    // A pool built at import would refuse here, in every file that imports a
    // job to test one of its helpers. The structural half, that no top-level
    // statement runs anything, is a-pass-that-opened-the-owners-pool's.
    const app = process.env.APP_DATABASE_URL;
    delete process.env.APP_DATABASE_URL;
    try {
      vi.resetModules();
      const fresh = await import('./task-pools.ts');
      expect(typeof fresh.openTaskPools).toBe('function');
    } finally {
      if (app !== undefined) process.env.APP_DATABASE_URL = app;
    }
  });
});

describe('the list a split job visits: the active organisations, on the owner\'s URL, closed before it answers', () => {
  /** Every statement the list's pool is asked, and the pool, answered without a database. */
  const answering = (seesEveryOrganisation: boolean) => {
    const asked: Array<{ pool: Pool; text: string }> = [];
    vi.spyOn(Pool.prototype, 'query').mockImplementation(function (this: Pool, text: unknown) {
      asked.push({ pool: this, text: String(text) });
      return Promise.resolve(
        /pg_roles/.test(String(text))
          ? { rows: [{ sees_every_organisation: seesEveryOrganisation }] }
          : { rows: [{ id: '0138d000-e29b-41d4-a716-4466554400a1' }, { id: '0138d000-e29b-41d4-a716-4466554400b1' }] },
      );
    } as never);
    return asked;
  };

  it('refuses without DATABASE_URL, and never reads the list on APP_DATABASE_URL in its place', async () => {
    const asked = answering(true);
    await expect(activeOrganisations({ APP_DATABASE_URL: APP })).rejects.toThrow(/DATABASE_URL is required/);
    await expect(activeOrganisations({ APP_DATABASE_URL: APP, DATABASE_URL: '  ' })).rejects.toThrow(/DATABASE_URL/);
    expect(asked).toEqual([]);
  });

  it('asks one connection on the owner\'s URL for the ids of the active organisations, and ends it', async () => {
    const asked = answering(true);
    const ids = await activeOrganisations({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER });

    expect(ids).toEqual(['0138d000-e29b-41d4-a716-4466554400a1', '0138d000-e29b-41d4-a716-4466554400b1']);
    expect(asked.map((a) => a.text)).toContain(ACTIVE_ORGANISATIONS_SQL);
    const [pool] = new Set(asked.map((a) => a.pool));
    expect(new Set(asked.map((a) => a.pool)).size).toBe(1);
    expect(optionsOf(pool).connectionString).toBe(OWNER);
    expect(optionsOf(pool).max).toBe(1);
    // Closed before it answered: the list holds nothing past its one read.
    expect(pool!.ended).toBe(true);
    // And the role question came first: an empty list must never be the answer
    // of a connection that could not see the organisations.
    expect(asked[0]!.text).toMatch(/pg_roles/);
  });

  it('refuses on a connection row security binds, where the list would be empty, and ends it anyway', async () => {
    // app_user, or an owner without the superuser bit on an operator's own
    // Postgres, where the FORCEd policies bind it: with no organisation set,
    // `tenant` answers no row, and every split job would visit nobody.
    const asked = answering(false);
    await expect(activeOrganisations({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER })).rejects.toThrow(
      /row security/,
    );
    expect(asked.map((a) => a.text)).not.toContain(ACTIVE_ORGANISATIONS_SQL);
    expect(asked[0]!.pool.ended).toBe(true);
  });
});
