// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PARKED ROW IS NOT A TALL COUNT.
 *
 * The SQL half of the same contract `packages/core/src/a-park-that-counted-as-five-attempts.unit.test.ts`
 * pins over `MemoryLedger`. It runs against a real database because the thing
 * that was wrong lived in two SQL expressions and nowhere else:
 *
 *   insert   attempt_count = MAX_ITEM_ATTEMPTS
 *   update   attempt_count = GREATEST(attempt_count + 1, MAX_ITEM_ATTEMPTS)
 *
 * Both are valid TypeScript and valid SQL; neither `tsc` nor eslint has an
 * opinion about them. What they produced was "5 tries" on an owner's screen for
 * a Google Doc asked for once, and 6 and 7 on rows parked twice (2026-09-14).
 * A fake cannot prove `GREATEST` is gone, because a fake does not run it.
 *
 * The `coalesce` on `parked_at` is the other Postgres-only claim here: re-parking
 * an already-parked row must keep the FIRST park time, which is what "waiting
 * since" means to the person reading it.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, type PgDatabase } from './db.ts';
import { PgLedger } from './ledger.ts';
import { asTenantId, asMappingId, MAX_ITEM_ATTEMPTS, type LedgerRecord } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

// Namespace 9a2c for this file, per the convention the other ledger
// integration tests follow: fixtures that share ids delete each other's rows
// in `beforeEach` and fail in whichever order vitest happens to pick.
const TENANT = asTenantId('9a2c0000-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('9a2c0000-e29b-41d4-a716-446655440002' as never);

const POLICY_REFUSAL =
  '"Factsheet alumni.xlsx" is a Google spreadsheet and has no file to copy.';

describe('PgLedger parks without inflating the count (integration)', () => {
  let db: PgDatabase;
  let ledger: PgLedger;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TENANT}, 'Parked Count Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceConnId = '9a2c0000-e29b-41d4-a716-446655440011';
    const targetConnId = '9a2c0000-e29b-41d4-a716-446655440012';
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${sourceConnId}, ${TENANT}, 'source', 'o365', 'Source', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
      VALUES (${targetConnId}, ${TENANT}, 'target', 'imap', 'Target', '{}', 'connected')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceMailboxId = '9a2c0000-e29b-41d4-a716-446655440021';
    const targetMailboxId = '9a2c0000-e29b-41d4-a716-446655440022';
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${sourceMailboxId}, ${TENANT}, ${sourceConnId}, 'src@dev.local', 'user', 'Src', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, display_name, status)
      VALUES (${targetMailboxId}, ${TENANT}, ${targetConnId}, 'dst@dev.local', 'user', 'Dst', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
      VALUES (${MAPPING}, ${TENANT}, ${sourceMailboxId}, ${targetMailboxId}, 'mirror', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM item WHERE tenant_id = ${TENANT}`);
  });

  function record(naturalKeyHash: string): LedgerRecord {
    return {
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'file',
      naturalKeyHash,
      contentHash: `c-${naturalKeyHash}`,
      targetId: '',
      createdAt: new Date().toISOString(),
      sizeBytes: 0,
      status: 'failed',
    } as LedgerRecord;
  }

  it('writes ONE attempt on a first park, not the ceiling (the INSERT path)', async () => {
    const row = await ledger.recordFailure(record('insert1'), POLICY_REFUSAL, { park: true });
    expect(row.attemptCount).toBe(1);
    expect(row.parkedAt).toBeDefined();
  });

  it('increments by one on a later park, never GREATEST (the UPDATE path)', async () => {
    // The expression that produced 6 and 7 on the owner's screen. Reached only
    // by failing an item that already has a row, which is why the insert test
    // above cannot catch it.
    await ledger.recordIfAbsent(record('update1'));
    await ledger.recordFailure(record('update1'), POLICY_REFUSAL, { park: true });
    const second = await ledger.recordFailure(record('update1'), POLICY_REFUSAL, { park: true });

    expect(second.attemptCount).toBe(2);
    expect(second.attemptCount).toBeLessThan(MAX_ITEM_ATTEMPTS);
  });

  it('keeps the first park time across a re-park (the coalesce)', async () => {
    await ledger.recordIfAbsent(record('coal1'));
    const first = await ledger.recordFailure(record('coal1'), POLICY_REFUSAL, { park: true });
    await new Promise((r) => setTimeout(r, 25));
    const again = await ledger.recordFailure(record('coal1'), POLICY_REFUSAL, { park: true });

    expect(again.parkedAt).toBe(first.parkedAt);
  });

  it('waits on a person at one attempt, and says it is parked', async () => {
    await ledger.recordFailure(record('waits1'), POLICY_REFUSAL, { park: true });

    const [failure] = await ledger.listFailures(TENANT, MAPPING);
    expect(failure?.attempts).toBe(1);
    expect(failure?.needsDecision).toBe(true);
    expect(failure?.parkedAt).toBeDefined();
  });

  it('leaves an ordinary failure counting, and unparked', async () => {
    await ledger.recordIfAbsent(record('ord1'));
    await ledger.recordFailure(record('ord1'), 'ECONNRESET');
    const second = await ledger.recordFailure(record('ord1'), 'ECONNRESET');

    expect(second.attemptCount).toBe(2);
    expect(second.parkedAt).toBeUndefined();

    const [failure] = await ledger.listFailures(TENANT, MAPPING);
    expect(failure?.needsDecision).toBe(false);
    expect(failure?.parkedAt).toBeUndefined();
  });

  it('clears the park on a retry, so the next pass fetches the item again', async () => {
    await ledger.recordFailure(record('retry1'), POLICY_REFUSAL, { park: true });
    expect(await ledger.resolveFailure(TENANT, MAPPING, 'retry1', 'retry')).toBe(true);

    const [failure] = await ledger.listFailures(TENANT, MAPPING);
    expect(failure?.attempts).toBe(0);
    expect(failure?.needsDecision).toBe(false);
    expect(failure?.parkedAt).toBeUndefined();
  });

  it('clears the park on a GROUP retry too', async () => {
    await ledger.recordFailure(record('grp1'), POLICY_REFUSAL, { park: true });
    await ledger.recordFailure(record('grp2'), POLICY_REFUSAL, { park: true });

    expect(
      await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', { errorContains: 'Google' }),
    ).toBe(2);

    for (const f of await ledger.listFailures(TENANT, MAPPING)) {
      expect(f.needsDecision).toBe(false);
      expect(f.parkedAt).toBeUndefined();
    }
  });
});
