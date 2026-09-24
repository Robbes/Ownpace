// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN AUDIT LINE A COLLECTOR CAN READ (workplan 0129 T4), where it meets the
 * database: `recordAuditEvent` writes the row and its line, and the key the
 * pseudonyms are made with is this deployment's own (ledger migration 0062).
 *
 *  - one line per recorded event, carrying the row's id and its time to the
 *    microsecond, so a line and the row it came from are one event;
 *  - the write never waits for the line: inside a tenant's transaction, on
 *    PGlite's one connection, waiting for the key would wait forever;
 *  - the line waits for the transaction instead: an event that was rolled back
 *    prints nothing, and none prints before its commit;
 *  - the key outlives a restart, so the same person is the same pseudonym;
 *  - the request path cannot read the key, so a sink built on its role writes
 *    nothing (the managed API's request path is that role, and reads the key
 *    as the owner instead);
 *  - a line that cannot be written costs the line, never the event.
 *
 * PGlite as the appliance runs it. The address is invented.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { setAuditExportSink } from '@openmig/shared';
import type { TenantId } from '@openmig/shared';
import { runMigrations } from './migrate.ts';
import { createPgliteDb } from './pglite-driver.ts';
import { withTenant } from './db.ts';
import { PgLedger } from './ledger.ts';
import { auditExportOn, deploymentKeyFor } from './audit-export-sink.ts';
import { afterCommit, holdUntilCommit } from './after-commit.ts';
import type { LedgerDriver } from './driver.ts';

const TENANT = '0e340000-e29b-41d4-a716-446655440001' as TenantId;
const ADDRESS = 'jan@example.invalid';
const RESOURCE = { 'service.name': 'ownpace-test' };

let driver: LedgerDriver;

beforeAll(async () => {
  driver = (await createPgliteDb({ role: 'app_user' })).driver;
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Audit BV', 'active')`, [TENANT]);
  } finally {
    conn.release();
  }
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

afterEach(() => setAuditExportSink(undefined));

/** Record one event as the request path does, inside the tenant's transaction. */
const record = (detail: Record<string, unknown> = { mappingId: TENANT }) =>
  withTenant(driver, TENANT, (db) =>
    new PgLedger(db).recordAuditEvent(TENANT, { actor: ADDRESS, action: 'share.decided', detail }),
  );

/** A sink that keeps its lines. */
function collecting() {
  const lines: Record<string, any>[] = [];
  setAuditExportSink(auditExportOn(driver, RESOURCE, (line) => lines.push(JSON.parse(line))));
  return lines;
}

describe('one line per recorded event', () => {
  it("carries the row's id and its time to the microsecond", async () => {
    const lines = collecting();

    await record();
    await vi.waitFor(() => expect(lines).toHaveLength(1));

    const conn = await driver.acquire();
    const { rows } = await conn.query<{ id: string; at: string }>(
      `SELECT id::text AS id, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
         FROM audit_log WHERE tenant_id = $1 ORDER BY at DESC LIMIT 1`,
      [TENANT],
    );
    conn.release();
    const [row] = rows;
    const [line] = lines;
    expect(line!.Attributes['ownpace.audit.id']).toBe(row!.id);
    const micros = row!.at.slice(20, 26);
    expect(line!.Timestamp.endsWith(`${micros}000`)).toBe(true);
    expect(line!.Resource).toEqual(RESOURCE);
    expect(JSON.stringify(line)).not.toContain(ADDRESS);
  });

  it('never waits for the line inside the transaction, where on PGlite it would wait forever', async () => {
    collecting();
    // Fresh key, so the sink has to ask the database for it while the
    // transaction below still holds PGlite's one connection.
    const done = record().then(() => 'written');
    const late = new Promise((resolve) => setTimeout(() => resolve('still waiting'), 5_000));

    expect(await Promise.race([done, late])).toBe('written');
  });
});

describe('a line waits for its transaction', () => {
  /** A sink that has read its key, so a line it is handed is written at once. */
  async function warm() {
    const lines = collecting();
    await record();
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    return lines;
  }

  const event = { actor: ADDRESS, action: 'share.decided', detail: { mappingId: TENANT } };

  it('prints nothing for an event its transaction rolled back', async () => {
    const lines = await warm();

    const undone = await withTenant(driver, TENANT, async (db) => {
      await new PgLedger(db).recordAuditEvent(TENANT, event);
      throw new Error('the work after it failed');
    }).catch((err: Error) => err.message);

    expect(undone).toBe('the work after it failed');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(lines).toHaveLength(1);
  });

  it('prints an event only once its transaction has committed', async () => {
    const lines = await warm();
    let beforeCommit = -1;

    await withTenant(driver, TENANT, async (db) => {
      await new PgLedger(db).recordAuditEvent(TENANT, event);
      await new Promise((resolve) => setTimeout(resolve, 200));
      beforeCommit = lines.length;
    });

    expect(beforeCommit).toBe(1);
    await vi.waitFor(() => expect(lines).toHaveLength(2));
  });

  it('holds work until the commit, drops it on a rollback, and runs it at once outside a transaction', async () => {
    const ran: string[] = [];

    afterCommit(() => ran.push('outside'));
    expect(ran).toEqual(['outside']);

    const kept = holdUntilCommit();
    await kept.during(async () => afterCommit(() => ran.push('kept')));
    expect(ran).toEqual(['outside']);
    kept.end(true);
    expect(ran).toEqual(['outside', 'kept']);

    const undone = holdUntilCommit();
    await undone.during(async () => afterCommit(() => ran.push('undone')));
    undone.end(false);
    expect(ran).toEqual(['outside', 'kept']);
  });

  it('runs at once what is handed over after its transaction has ended', async () => {
    const held = holdUntilCommit();
    const ran: string[] = [];
    let later: Promise<void> | undefined;
    await held.during(async () => {
      later = new Promise((resolve) => setTimeout(resolve, 50)).then(() => {
        afterCommit(() => ran.push('late'));
      });
    });
    held.end(true);

    await later;
    expect(ran).toEqual(['late']);
  });

  it('never throws into a caller whose transaction has already committed', async () => {
    const held = holdUntilCommit();
    const ran: string[] = [];
    await held.during(async () => {
      afterCommit(() => {
        throw new Error('stdout is closed');
      });
      afterCommit(() => ran.push('the next one'));
    });

    expect(() => held.end(true)).not.toThrow();
    expect(ran).toEqual(['the next one']);
  });
});

describe("the deployment's key", () => {
  it('outlives a restart: the same person is the same pseudonym', async () => {
    const before = collecting();
    await record();
    await vi.waitFor(() => expect(before).toHaveLength(1));

    // A second sink is a restarted process: it reads the key again.
    const after = collecting();
    await record();
    await vi.waitFor(() => expect(after).toHaveLength(1));

    expect(after[0]!.Attributes['ownpace.audit.actor']).toBe(before[0]!.Attributes['ownpace.audit.actor']);
    expect(await deploymentKeyFor(driver, 'audit-pseudonym')).toEqual(
      await deploymentKeyFor(driver, 'audit-pseudonym'),
    );
  });

  it('is asked for again after a read that failed, rather than failing every later line', async () => {
    let failures = 1;
    const restarting: LedgerDriver = {
      role: driver.role,
      acquire: () => (failures-- > 0 ? Promise.reject(new Error('the database is restarting')) : driver.acquire()),
      end: () => driver.end(),
    };
    const lines: string[] = [];
    setAuditExportSink(auditExportOn(restarting, RESOURCE, (line) => lines.push(line)));

    await record();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(lines).toHaveLength(0);
    await record();

    await vi.waitFor(() => expect(lines).toHaveLength(1));
  });

  it("is out of the request path's reach", async () => {
    await deploymentKeyFor(driver, 'audit-pseudonym');

    const failure = await withTenant(driver, TENANT, (db) => db.execute(sql`SELECT key FROM deployment_key`)).then(
      () => undefined,
      (err: unknown) => err as { cause?: unknown },
    );

    // drizzle wraps the database's refusal; the refusal itself is the cause.
    expect(String(failure?.cause ?? failure)).toMatch(/permission denied/);
  });
});

describe("a sink on the request path's own role", () => {
  it("writes no line, because the key is the owner's alone: the managed API reads it as the owner", async () => {
    // The managed API's request path connects as `app_user` itself
    // (`APP_DATABASE_URL`), rather than dropping to it inside a transaction.
    const asAppUser: LedgerDriver = {
      role: driver.role,
      async acquire() {
        const conn = await driver.acquire();
        await conn.query('SET ROLE app_user');
        return {
          ...conn,
          release: (err?: Error) => {
            void conn.query('RESET ROLE').finally(() => conn.release(err));
          },
        };
      },
      end: () => driver.end(),
    };
    const lines: string[] = [];
    setAuditExportSink(auditExportOn(asAppUser, RESOURCE, (line) => lines.push(line)));

    await record();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(lines).toHaveLength(0);
    await expect(deploymentKeyFor(asAppUser, 'audit-pseudonym')).rejects.toThrow(/permission denied/);
  });
});

describe('a line that cannot be written', () => {
  it('costs the line, never the event', async () => {
    setAuditExportSink(
      auditExportOn(driver, RESOURCE, () => {
        throw new Error('stdout is closed');
      }),
    );
    const conn = await driver.acquire();
    const before = (await conn.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_log')).rows[0]!.n;
    conn.release();

    await expect(record()).resolves.toBeUndefined();

    const again = await driver.acquire();
    const after = (await again.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_log')).rows[0]!.n;
    again.release();
    expect(after).toBe(before + 1);
  });
});
