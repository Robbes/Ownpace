// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHERE A SHARED THING SITS HAS TO SURVIVE THE DATABASE, OR THE GROUPING IS A
 * RULE NOTHING EVER FEEDS (workplan 0123 T4, migration 0053).
 *
 * `groupShareGrants` is pure and guarded by its own unit tests. What those
 * cannot reach is the half that decides whether it ever sees anything: three
 * nullable columns, a driver that must carry `false` back as `false` rather
 * than as nothing, and an upsert that has to refresh a file's home on a rescan
 * WITHOUT touching a decision somebody already made.
 *
 * Integration rather than unit, because every one of those is the SQL and the
 * driver rather than our code, and a fake would carry back whatever its author
 * believed. The `false`/NULL distinction in particular has exactly one honest
 * test: ask a real Postgres.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createPgDb, type PgDatabase } from './db.ts';
import { PgLedger } from './ledger.ts';
import { asTenantId, asMappingId, groupShareGrants } from '@openmig/shared';

const PG_CONNECTION_STRING = process.env.TEST_DATABASE_URL;
if (!PG_CONNECTION_STRING) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests require Testcontainers to be running. ' +
      'Run: pnpm test:integration',
  );
}

// Namespace 7c52 for this file, per the convention the other ledger
// integration tests follow: fixtures that share ids delete each other's rows in
// `beforeEach` and fail in whichever order vitest happens to pick.
const TENANT = asTenantId('7c520000-e29b-41d4-a716-446655440001' as never);
const MAPPING = asMappingId('7c520000-e29b-41d4-a716-446655440002' as never);

/** One scanned grant, with only the fields a placement question needs. */
const row = (o: {
  hash: string;
  on: string;
  itemKey?: string;
  parentKey?: string;
  isContainer?: boolean;
  grantee?: string;
  role?: string;
}) => ({
  grantHash: o.hash,
  subject: 'drive_item',
  onLabel: o.on,
  ...(o.grantee ? { grantee: o.grantee } : {}),
  role: o.role ?? 'writer',
  viaLink: false,
  raw: '{}',
  verdict: 'manual' as const,
  verdictTarget: 'decide by hand',
  ...(o.itemKey !== undefined ? { itemKey: o.itemKey } : {}),
  ...(o.parentKey !== undefined ? { parentKey: o.parentKey } : {}),
  ...(o.isContainer !== undefined ? { isContainer: o.isContainer } : {}),
});

describe('PgLedger carries where a shared thing sits (integration)', () => {
  let db: PgDatabase;
  let ledger: PgLedger;

  beforeAll(async () => {
    db = createPgDb(PG_CONNECTION_STRING);
    ledger = new PgLedger(db);

    await db.execute(sql`
      INSERT INTO tenant (id, name, status)
      VALUES (${TENANT}, 'Share Placement Tenant', 'active')
      ON CONFLICT (id) DO NOTHING
    `);
    const sourceConnId = '7c520000-e29b-41d4-a716-446655440011';
    const targetConnId = '7c520000-e29b-41d4-a716-446655440012';
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
    // `mailbox_mapping` joins two `mailbox` ROWS, not two connections, and both
    // ids are uuids — found by running this against a real Postgres rather than
    // by reading, which is the whole reason this file is an integration test.
    const sourceMailboxId = '7c520000-e29b-41d4-a716-446655440021';
    const targetMailboxId = '7c520000-e29b-41d4-a716-446655440022';
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
    await db.execute(sql`DELETE FROM share_grant WHERE tenant_id = ${TENANT}`);
  });

  /**
   * THE ONE THAT NEEDS A REAL DATABASE. `false` is a source saying "not a
   * folder"; NULL is a source saying nothing. Migration 0053 left the column
   * nullable precisely so those stay apart, and a read that mapped the column
   * with truthiness would collapse them — silently, and only for folders.
   */
  it('brings `false` back as false and an unset column back as absent', async () => {
    await ledger.upsertShareGrants(TENANT, MAPPING, [
      row({ hash: 'h-folder', on: 'Foto shoot Emma', itemKey: 'F', parentKey: 'root', isContainer: true }),
      row({ hash: 'h-file', on: 'IMG_1.jpg', itemKey: 'c1', parentKey: 'F', isContainer: false }),
      row({ hash: 'h-silent', on: 'Older.pdf' }),
    ]);

    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    const folder = rows.find((r) => r.grantHash === 'h-folder')!;
    const file = rows.find((r) => r.grantHash === 'h-file')!;
    const silent = rows.find((r) => r.grantHash === 'h-silent')!;

    expect(folder.isContainer).toBe(true);
    expect(folder.itemKey).toBe('F');
    expect(folder.parentKey).toBe('root');

    // Not `toBeFalsy()`: the point is that it came back at all.
    expect(file.isContainer).toBe(false);
    expect('isContainer' in file).toBe(true);

    expect('isContainer' in silent).toBe(false);
    expect('itemKey' in silent).toBe(false);
    expect('parentKey' in silent).toBe(false);
  });

  /** The rule and the SQL agree — the end the unit tests cannot reach. */
  it('rows read back from Postgres fold into one folder row', async () => {
    await ledger.upsertShareGrants(TENANT, MAPPING, [
      row({
        hash: 'g-folder',
        on: 'Foto shoot Emma',
        itemKey: 'F',
        parentKey: 'root',
        isContainer: true,
        grantee: 'anna@example.test',
      }),
      ...Array.from({ length: 6 }, (_, i) =>
        row({
          hash: `g-c${i}`,
          on: `IMG_${i}.jpg`,
          itemKey: `c${i}`,
          parentKey: 'F',
          isContainer: false,
          grantee: 'anna@example.test',
        }),
      ),
      // The one that must NOT fold: an extra grantee nobody else has.
      row({
        hash: 'g-odd',
        on: 'Contract.pdf',
        itemKey: 'c9',
        parentKey: 'F',
        isContainer: false,
        grantee: 'stranger@example.test',
      }),
    ]);

    const { groups, standalone } = groupShareGrants(await ledger.listShareGrants(TENANT, MAPPING));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Foto shoot Emma');
    expect(groups[0]!.items).toBe(7); // the folder and its six agreeing files
    expect(standalone.map((s) => s.label)).toEqual(['Contract.pdf']);
    expect(standalone[0]!.extra).toEqual(['stranger@example.test:writer']);
  });

  /**
   * A FILE THAT MOVED. Where something sits is a fact about the source, and it
   * changes when somebody drags the file elsewhere — so a rescan refreshes it.
   * A DECISION is not a fact about the source, and ADR-0032 says a rescan must
   * never reopen one. Both halves in one test, because getting the first right
   * by clobbering the second is exactly the mistake worth catching.
   */
  it('a rescan moves the file and leaves the decision alone', async () => {
    await ledger.upsertShareGrants(TENANT, MAPPING, [
      row({ hash: 'm-1', on: 'Moved.jpg', itemKey: 'c1', parentKey: 'OLD', isContainer: false }),
    ]);
    const [before] = await ledger.listShareGrants(TENANT, MAPPING);
    await ledger.decideShareGrant(TENANT, MAPPING, before!.id, {
      state: 'done_manual',
      decidedBy: 'rob@example.test',
    });

    await ledger.upsertShareGrants(TENANT, MAPPING, [
      row({ hash: 'm-1', on: 'Moved.jpg', itemKey: 'c1', parentKey: 'NEW', isContainer: false }),
    ]);

    const [after] = await ledger.listShareGrants(TENANT, MAPPING);
    expect(after!.parentKey).toBe('NEW');
    expect(after!.state).toBe('done_manual');
    expect(after!.decidedBy).toBe('rob@example.test');
    expect(after!.id).toBe(before!.id);
  });

  /**
   * A SOURCE THAT STOPPED SAYING. If a later scan cannot place a row the
   * earlier one could, the stale placement must go rather than linger: a queue
   * grouping a file under a folder the current scan never reported is claiming
   * a hierarchy nobody read.
   */
  it('a rescan that cannot place the row clears the old placement', async () => {
    await ledger.upsertShareGrants(TENANT, MAPPING, [
      row({ hash: 'f-1', on: 'Forgotten.jpg', itemKey: 'c1', parentKey: 'F', isContainer: false }),
    ]);
    await ledger.upsertShareGrants(TENANT, MAPPING, [row({ hash: 'f-1', on: 'Forgotten.jpg' })]);

    const [after] = await ledger.listShareGrants(TENANT, MAPPING);
    expect('parentKey' in after!).toBe(false);
    expect('itemKey' in after!).toBe(false);
    expect('isContainer' in after!).toBe(false);
  });
});
