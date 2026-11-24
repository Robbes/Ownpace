// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// WHAT GMAIL'S OWN COUNT IS HELD TO, read from a real database (the owner,
// 2026-11-24). The Check counts only what Gmail held before the last
// completed pass started, so `sourceCountWindow` reads that start from the
// data type's `migration_status` row, and whether the data type is past its
// switch from the path phases. The arithmetic is unit-tested in
// `the-last-completed-pass-start.unit.test.ts`; this pins the columns it reads
// and the status rows the passes really write (`PgMigrationStatusStore`).
//
// UUID family: 5cc00000-e29b-41d4-a716-4466554400xx
//
// Runs against a Testcontainers Postgres (pnpm test:integration), or one from
// `./scripts/local-pg.sh`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPgDb } from './db.ts';
import { createLedgerVerificationReader } from './verification-queries.ts';
import { PgMigrationStatusStore } from './migration-status-store.ts';
import * as schemaPg from './schema-pg.ts';
import type { TenantId, MappingId } from '@openmig/shared';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL is not set. Run: pnpm test:integration');
}

const P = '5cc00000-e29b-41d4-a716-4466554400';
const TENANT = `${P}01` as TenantId;
const MAPPING = `${P}11` as MappingId;

describe('sourceCountWindow (0044, 2026-11-24)', () => {
  let db: ReturnType<typeof createPgDb>;

  beforeAll(async () => {
    db = createPgDb(TEST_DB_URL);
    await db.insert(schemaPg.tenant).values({ id: TENANT, name: 'T-window', status: 'active', settings: {} }).onConflictDoNothing();
    await db.insert(schemaPg.connection).values({ id: `${P}21`, tenantId: TENANT, role: 'source', kind: 'imap', displayName: 'src', config: {}, status: 'connected' }).onConflictDoNothing();
    await db.insert(schemaPg.mailbox).values({ id: `${P}31`, tenantId: TENANT, connectionId: `${P}21`, kind: 'user', status: 'active' }).onConflictDoNothing();
    await db.insert(schemaPg.mailbox).values({ id: `${P}32`, tenantId: TENANT, connectionId: `${P}21`, kind: 'user', status: 'active' }).onConflictDoNothing();
    await db.insert(schemaPg.mailboxMapping).values({ id: MAPPING, tenantId: TENANT, sourceMailboxId: `${P}31`, targetMailboxId: `${P}32`, mode: 'mirror', status: 'active' }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(schemaPg.tenant).where(eq(schemaPg.tenant.id, TENANT));
    await db.close();
  });

  const startedAtOfRow = async (): Promise<Date> => {
    const [row] = await db
      .select({ startedAt: schemaPg.migrationStatus.startedAt })
      .from(schemaPg.migrationStatus)
      .where(eq(schemaPg.migrationStatus.mappingId, MAPPING));
    return row!.startedAt;
  };

  it('no pass yet: no start, and not past the switch', async () => {
    const reader = createLedgerVerificationReader({ db });
    expect(await reader.sourceCountWindow(TENANT, MAPPING, 'email')).toEqual({ pastTheSwitch: false });
  });

  it('a completed pass: its own start; a later pass under way: still that start', async () => {
    const status = new PgMigrationStatusStore(db);
    const reader = createLedgerVerificationReader({ db });
    await status.initDomainStatus(TENANT, MAPPING, 'email');
    await status.markInProgress(TENANT, MAPPING, 'email');
    const started = await startedAtOfRow();
    // A pass measured as taking two seconds, ended now.
    await new Promise((r) => setTimeout(r, 20));
    await status.markCompleted(TENANT, MAPPING, 'email', {
      items: 1,
      wallMs: 0,
      sourceFetchMs: 0,
      targetWriteMs: 0,
      ledgerMs: 0,
      hashMs: 0,
      overlap: 0,
    });

    const completed = await reader.sourceCountWindow(TENANT, MAPPING, 'email');
    expect(completed.lastCompletedPassStartedAt).toBe(started.toISOString());
    expect(completed.pastTheSwitch).toBe(false);

    // The next pass begins and overwrites started_at with its own start.
    await status.markInProgress(TENANT, MAPPING, 'email');
    expect((await startedAtOfRow()).getTime()).toBeGreaterThan(started.getTime());
    const during = await reader.sourceCountWindow(TENANT, MAPPING, 'email');
    // completed_at less the measured wall time (0 ms here): the completed
    // pass's end, which is not later than the new pass's start.
    expect(during.lastCompletedPassStartedAt).toBeDefined();
    expect(Date.parse(during.lastCompletedPassStartedAt!)).toBeLessThanOrEqual((await startedAtOfRow()).getTime());
    expect(Date.parse(during.lastCompletedPassStartedAt!)).toBeGreaterThanOrEqual(started.getTime());
  });

  it('another data type has no window of its own', async () => {
    const reader = createLedgerVerificationReader({ db });
    const window = await reader.sourceCountWindow(TENANT, MAPPING, 'calendar');
    expect(window.lastCompletedPassStartedAt).toBeUndefined();
  });
});
