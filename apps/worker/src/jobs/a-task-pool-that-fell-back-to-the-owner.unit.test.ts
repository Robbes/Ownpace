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
 * tenant pool. Nothing here needs a database: node-postgres builds a pool
 * without connecting, and the sinks are told apart by which pool is asked for
 * a connection. Whether the tenant pool really is `app_user` and the line
 * really prints is asked of Postgres by `a-pass-under-row-security`
 * (integration). Whether each job takes its pools from here, and whether this
 * module does anything at import, is `a-pass-that-opened-the-owners-pool`'s.
 *
 * The addresses are invented; nothing here is contacted.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { exportAuditEvent, recordAppEvent, setAppEventSink, setAuditExportSink } from '@openmig/shared';
import { openTaskPools, type TaskPools } from './task-pools.ts';

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

afterEach(async () => {
  setAuditExportSink(undefined);
  setAppEventSink(undefined);
  vi.restoreAllMocks();
  for (const pools of opened.splice(0)) {
    await pools.end();
    await pools.auditKey.end();
  }
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
});

describe('the audit key has a pool of its own, of one connection, on the owner\'s URL', () => {
  it('reads the key where app_user may not: one connection, the owner\'s, closed a second after', () => {
    const pools = open({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER });

    expect(pools.auditKey).not.toBe(pools.tenant);
    expect(optionsOf(pools.auditKey).connectionString).toBe(OWNER);
    expect(optionsOf(pools.auditKey).max).toBe(1);
    expect(optionsOf(pools.auditKey).idleTimeoutMillis).toBeLessThanOrEqual(1_000);
    // A dropped idle connection is a warning, not the end of the process.
    expect(pools.auditKey.listenerCount('error')).toBeGreaterThanOrEqual(1);
  });

  it('refuses to start without DATABASE_URL, since every audit line would then be lost', () => {
    expect(() => openTaskPools({ APP_DATABASE_URL: APP })).toThrow(/DATABASE_URL/);
    expect(() => openTaskPools({ APP_DATABASE_URL: APP })).toThrow(/audit/);
  });
});

describe('the sinks it points: the key asked of its pool, the operator\'s events of the tenant pool', () => {
  it('asks the key\'s pool, never the tenant pool, for the key an audit line is made with', async () => {
    const pools = open({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER }, () => {});
    const key = vi.spyOn(pools.auditKey, 'connect').mockRejectedValue(new Error('the key pool was asked'));
    const tenant = vi.spyOn(pools.tenant, 'connect').mockRejectedValue(new Error('the tenant pool was asked'));

    exportAuditEvent({
      id: '0138c000-e29b-41d4-a716-446655440001',
      at: '2026-09-28T12:00:00.000000Z',
      tenantId: '0138c000-e29b-41d4-a716-4466554400a1',
      actor: 'trigger-job',
      action: 'mapping.status_changed',
    });

    await vi.waitFor(() => expect(key).toHaveBeenCalled());
    expect(tenant).not.toHaveBeenCalled();
  });

  it('records the operator\'s events on the tenant pool, which app_user may insert into', async () => {
    const pools = open({ APP_DATABASE_URL: APP, DATABASE_URL: OWNER }, () => {});
    const key = vi.spyOn(pools.auditKey, 'connect').mockRejectedValue(new Error('the key pool was asked'));
    const tenant = vi.spyOn(pools.tenant, 'connect').mockRejectedValue(new Error('the tenant pool was asked'));

    await recordAppEvent({ level: 'error', event: 'task.pool_check', reference: '0138c0de' });

    expect(tenant).toHaveBeenCalledTimes(1);
    expect(key).not.toHaveBeenCalled();
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
