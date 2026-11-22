// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DELETION THE OWNER KEPT IS NEVER APPLIED (2026-11-22; ADR-0024), on PGlite.
 *
 * The SQL half of `packages/core/src/a-deletion-the-owner-kept.unit.test.ts`.
 * Core's `applyDeletion` over this ledger refuses a kept row before anything
 * is sent to the target. A keep that lands while a removal is already under
 * way cannot stop it, and `PgLedger.applyDeletion` records the removal as
 * what it was: tombstoned and applied, with the keep's own time kept
 * (`COALESCE`). A fake does not run the UPDATE; this runs it on the
 * appliance's in-process backend, as `app_user` under row security, through
 * the real migrations. Its Postgres twin
 * (`a-deletion-the-owner-kept.integration.test.ts`) runs the same cases in
 * CI's integration job, as the superuser that job connects as.
 *
 * Each ledger call is its own tenant transaction, as a press's ledger reads
 * and writes are, so a keep can land between core's read and the write.
 *
 * UUID family ad24ce01-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { applyDeletion, evaluateApplyDeletion } from '@openmig/core';
import type { Ledger, LedgerRecord, MappingId, RemovalResult, TenantId } from '@openmig/shared';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from './index.ts';
import type { LedgerDriver } from './index.ts';

const TENANT = 'ad24ce01-e29b-41d4-a716-446655440001' as TenantId;
const CONN = 'ad24ce01-e29b-41d4-a716-446655440011';
const BOX = 'ad24ce01-e29b-41d4-a716-446655440021';
const MAPPING = 'ad24ce01-e29b-41d4-a716-446655440031' as MappingId;

let driver: LedgerDriver;

const ledger = <T>(run: (l: PgLedger) => Promise<T>) =>
  withTenant(driver, TENANT, async (db) => run(new PgLedger(db)));

/** The ledger a press holds: every call its own transaction, on the real SQL. */
const perCall = new Proxy({} as Ledger, {
  get:
    (_target, method: string) =>
    (...args: unknown[]) =>
      ledger((l) => (l as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...args)),
});

function copied(naturalKeyHash: string): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: 'calendar',
    naturalKeyHash,
    contentHash: `bytes-${naturalKeyHash}`,
    targetId: `t-${naturalKeyHash}`,
    targetVersion: `"v-${naturalKeyHash}"`,
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Personal',
  };
}

/** An event the old system reported deleted. */
async function reported(key: string): Promise<void> {
  await ledger((l) => l.recordIfAbsent(copied(key)));
  await ledger((l) => l.recordReportedDeletion(TENANT, MAPPING, 'calendar', key));
}

const keep = (key: string) => ledger((l) => l.resolveDeletion(TENANT, MAPPING, key, 'keep'));
const record = (key: string) => ledger((l) => l.applyDeletion(TENANT, MAPPING, 'calendar', key));
const deletionOf = async (key: string) =>
  (await ledger((l) => l.listDeletions(TENANT, MAPPING))).find((d) => d.naturalKeyHash === key);
const rowOf = (key: string) => ledger((l) => l.find(TENANT, MAPPING, 'calendar', key));

/** A target that removes; `during` runs inside the removal, as a concurrent change would. */
function remover(during?: () => Promise<void>) {
  return {
    removeItem: vi.fn(async (): Promise<RemovalResult> => {
      await during?.();
      return { kind: 'deleted' };
    }),
  };
}

const press = (key: string, target: unknown) =>
  applyDeletion(
    {
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'calendar',
      ledger: perCall,
      target,
      allowApplyDeletions: true,
      stillTheAuthority: async () => true,
    },
    key,
  );

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'kept']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','google','g','{}'::jsonb,'connected')`,
      [CONN, TENANT],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [BOX, TENANT, CONN],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'active')`,
      [MAPPING, TENANT, BOX],
    );
  } finally {
    await conn.release();
  }
  // 120s: this fixture initialises a PGlite cluster and runs the full
  // migration chain, which a loaded runner has taken past 10s.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM item WHERE mapping_id = $1', [MAPPING]);
  } finally {
    await conn.release();
  }
});

/** A keep, its time as written, and a pause, so a later write is measurably later. */
async function keepNow(key: string): Promise<string | undefined> {
  expect(await keep(key)).toBe(true);
  const keptAt = (await rowOf(key))?.deletionAcknowledgedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  return keptAt;
}

describe('a deletion the owner kept is never applied (PgLedger on PGlite)', () => {
  it('a removal recorded after a keep says removed, and keeps the keep’s time', async () => {
    await reported('kept');
    const keptAt = await keepNow('kept');

    // What a removal already under way writes once its copy is gone.
    expect(await record('kept')).toBe(true);

    expect(await deletionOf('kept')).toMatchObject({ decided: 'applied' });
    const row = await rowOf('kept');
    expect(row?.status).toBe('tombstoned');
    expect(row?.deletionAppliedAt).toBeDefined();
    expect(keptAt).toBeDefined();
    expect(row?.deletionAcknowledgedAt).toBe(keptAt);
  });

  it('an open entry is still recorded once, and a second write on it records nothing', async () => {
    await reported('open');
    expect(await record('open')).toBe(true);
    expect(await record('open')).toBe(false);
    expect(await deletionOf('open')).toMatchObject({ decided: 'applied' });
  });

  it("core's press over this ledger refuses a kept row, and asks nothing of the target", async () => {
    await reported('pressed');
    expect(await keep('pressed')).toBe(true);
    const target = remover();

    expect(
      await evaluateApplyDeletion(
        {
          tenantId: TENANT,
          mappingId: MAPPING,
          domain: 'calendar',
          ledger: perCall,
          allowApplyDeletions: true,
          stillTheAuthority: async () => true,
        },
        'pressed',
      ),
    ).toMatchObject({ ok: false, code: 'already_kept' });
    expect(await press('pressed', target)).toMatchObject({ ok: false, code: 'already_kept' });

    expect(target.removeItem).not.toHaveBeenCalled();
    expect(await deletionOf('pressed')).toMatchObject({ decided: 'kept' });
  });

  it('a keep that lands while the removal is under way cannot stop it: the press answers deleted, and the row says removed', async () => {
    await reported('raced');
    let keptAt: string | undefined;
    const target = remover(async () => {
      keptAt = await keepNow('raced');
    });

    expect(await press('raced', target)).toEqual({ ok: true, kind: 'deleted' });

    // The copy was removed first, and the row says what happened.
    expect(target.removeItem).toHaveBeenCalledTimes(1);
    expect(await deletionOf('raced')).toMatchObject({ decided: 'applied' });
    const row = await rowOf('raced');
    expect(row?.status).toBe('tombstoned');
    expect(keptAt).toBeDefined();
    expect(row?.deletionAcknowledgedAt).toBe(keptAt);
  });
});

describe('a keep given to an earlier export ends when the copy is current again (workplan 0164, on PGlite)', () => {
  const file = (key: string): LedgerRecord => ({ ...copied(key), itemType: 'file', collection: 'Docs' });
  const fileDeps = (target: unknown) => ({
    tenantId: TENANT,
    mappingId: MAPPING,
    domain: 'file' as const,
    ledger: perCall,
    target,
    allowApplyDeletions: true,
    stillTheAuthority: async () => true,
  });

  it('a later deletion of it is offered, and a press removes it', async () => {
    await ledger((l) => l.recordIfAbsent(file('report-docx')));
    await ledger((l) =>
      l.markEarlierExports(TENANT, MAPPING, 'file', [
        { formerNaturalKeyHash: 'report-docx', naturalKeyHash: 'report-odt' },
      ]),
    );
    expect(await keep('report-docx'), 'kept as an earlier export').toBe(true);

    // The format is switched back: its name is a current name again.
    await ledger((l) => l.clearEarlierExport(TENANT, MAPPING, 'file', 'report-docx'));
    expect((await ledger((l) => l.find(TENANT, MAPPING, 'file', 'report-docx')))?.deletionAcknowledgedAt).toBeUndefined();

    // Then deleted at the old system.
    await ledger((l) => l.recordReportedDeletion(TENANT, MAPPING, 'file', 'report-docx'));
    const row = await deletionOf('report-docx');
    expect(row).toMatchObject({ evidence: 'reported' });
    expect(row?.acknowledgedAt).toBeUndefined();
    const target = remover();
    expect(await applyDeletion(fileDeps(target), 'report-docx')).toEqual({ ok: true, kind: 'deleted' });
    expect(target.removeItem).toHaveBeenCalledTimes(1);
  });

  it('a keep on a row that is not an earlier export stays', async () => {
    await ledger((l) => l.recordIfAbsent(file('kept-docx')));
    await ledger((l) => l.recordReportedDeletion(TENANT, MAPPING, 'file', 'kept-docx'));
    expect(await keep('kept-docx')).toBe(true);

    await ledger((l) => l.clearEarlierExport(TENANT, MAPPING, 'file', 'kept-docx'));

    expect(await deletionOf('kept-docx')).toMatchObject({ decided: 'kept' });
  });
});
