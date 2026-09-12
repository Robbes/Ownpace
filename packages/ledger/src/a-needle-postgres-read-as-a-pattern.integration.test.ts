// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NEEDLE POSTGRES READ AS A PATTERN.
 *
 * `resolveFailureGroup` matches an error substring with SQL `LIKE`, and `%`
 * and `_` are LIKE's own wildcards. An error message is ordinary text that may
 * contain both: `(50%).pdf` came out of a real filename, and `report_v2` out of
 * most of them. Unescaped, the needle `50%` matches "50" followed by ANYTHING
 * — which on a bulk retry is the difference between the group somebody chose
 * and most of their queue.
 *
 * This is the one property in this feature a fake cannot prove. `MemoryLedger`
 * matches with `String.includes`, which is literal by construction, so its
 * tests pass whether the SQL escapes or not
 * (`packages/core/src/a-fix-that-unparked-nothing.unit.test.ts` pins the rest
 * of the contract). Only Postgres can be asked what it does with the `%`.
 *
 * It runs against the real database for the same reason: an escaping bug is
 * invisible to `tsc` and to eslint — the string concatenation is valid either
 * way — and shows up only as too many rows changed.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, type PgDatabase } from './db.ts';
import { PgLedger } from './ledger.ts';
import { asTenantId, asMappingId, type LedgerRecord } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

// Namespace 5a1c for this file, per the convention the other ledger
// integration tests follow — fixtures that shared ids deleted each other's
// rows in `beforeEach` and failed in whichever order vitest happened to pick.
const TENANT = asTenantId('5a1c0000-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('5a1c0000-e29b-41d4-a716-446655440002' as never);

describe('PgLedger.resolveFailureGroup (integration)', () => {
  let db: PgDatabase;
  let ledger: PgLedger;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TENANT}, 'Group Decision Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceConnId = '5a1c0000-e29b-41d4-a716-446655440011';
    const targetConnId = '5a1c0000-e29b-41d4-a716-446655440012';
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
    const sourceMailboxId = '5a1c0000-e29b-41d4-a716-446655440021';
    const targetMailboxId = '5a1c0000-e29b-41d4-a716-446655440022';
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

  async function parked(naturalKeyHash: string, error: string, domain = 'file'): Promise<void> {
    const record = {
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: domain,
      naturalKeyHash,
      createdAt: new Date().toISOString(),
    } as LedgerRecord;
    await ledger.recordIfAbsent(record);
    await ledger.recordFailure(record, error, { park: true });
  }

  async function attempts(naturalKeyHash: string, domain = 'file'): Promise<number> {
    const row = await ledger.find(TENANT, MAPPING, domain as never, naturalKeyHash);
    return row?.attemptCount ?? -1;
  }

  it('treats % in the needle as a percent sign, not "anything"', async () => {
    await parked('literal', 'PUT refused for (50%).pdf');
    await parked('decoy', 'PUT refused for 500-page-report.pdf');
    await parked('decoy2', 'PUT refused for 50 Ways.docx');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', {
      errorContains: '50%',
    });

    // Unescaped, this is 3.
    expect(matched).toBe(1);
    expect(await attempts('literal')).toBe(0);
    expect(await attempts('decoy')).toBeGreaterThan(0);
    expect(await attempts('decoy2')).toBeGreaterThan(0);
  });

  it('treats _ in the needle as an underscore, not "any one character"', async () => {
    await parked('literal', 'could not place report_v2.xlsx');
    await parked('decoy', 'could not place reportXv2.xlsx');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', {
      errorContains: 'report_v2',
    });

    // Unescaped, this is 2.
    expect(matched).toBe(1);
    expect(await attempts('literal')).toBe(0);
    expect(await attempts('decoy')).toBeGreaterThan(0);
  });

  it('treats a backslash in the needle as a backslash', async () => {
    // The escape character itself. `ESCAPE '\\'` means a lone backslash in the
    // needle would be read as escaping whatever followed it — so the escaper
    // has to double its own escape character first, or a Windows path in an
    // error message matches nothing and the operator is told their group is
    // empty when it is not.
    // Written with escaped backslashes rather than `String.raw`, because a raw
    // template literal cannot END in a backslash — the closing backtick would
    // be the thing it escaped.
    await parked('literal', 'refused: C:\\Users\\rob\\notes.txt');
    await parked('decoy', 'refused: /home/rob/notes.txt');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', {
      errorContains: '\\rob\\',
    });

    expect(matched).toBe(1);
    expect(await attempts('literal')).toBe(0);
    expect(await attempts('decoy')).toBeGreaterThan(0);
  });

  it('retries a whole domain and leaves the other domains parked', async () => {
    // The live shape: 82 files behind one non-recursive MKCOL, with calendar
    // and contact failures of their own in the same queue.
    for (const n of [1, 2, 3]) await parked(`f${n}`, 'MKCOL 404 on the parent collection');
    await parked('c1', 'MKCOL 404 on the parent collection', 'calendar');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', { domain: 'file' });

    expect(matched).toBe(3);
    expect(await attempts('c1', 'calendar')).toBeGreaterThan(0);
  });

  it('accepts a group into left_behind, error intact', async () => {
    await parked('a', 'Google-native file has no bytes to copy');
    await parked('b', 'Google-native file has no bytes to copy');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'accept', {
      errorContains: 'Google-native',
    });

    expect(matched).toBe(2);
    const row = await ledger.find(TENANT, MAPPING, 'file', 'a');
    expect(row?.status).toBe('left_behind');
    expect(row?.lastError).toContain('Google-native');
  });

  it('will not reopen a row that already succeeded or was already accepted', async () => {
    await parked('recovered', 'MKCOL 404');
    await ledger.recordUpdate({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'file',
      naturalKeyHash: 'recovered',
      status: 'copied',
      targetId: 'target-1',
      attemptCount: 0,
      createdAt: new Date().toISOString(),
    } as LedgerRecord);

    await parked('accepted', 'MKCOL 404');
    await ledger.resolveFailure(TENANT, MAPPING, 'accepted', 'accept');

    const matched = await ledger.resolveFailureGroup(TENANT, MAPPING, 'retry', {
      errorContains: 'MKCOL',
    });

    expect(matched).toBe(0);
    expect((await ledger.find(TENANT, MAPPING, 'file', 'recovered'))?.status).toBe('copied');
    expect((await ledger.find(TENANT, MAPPING, 'file', 'accepted'))?.status).toBe('left_behind');
  });
});
