// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A QUEUE ROW THAT NAMES ITS ITEM (the owner, 2026-11-19), on PGlite.
 *
 * Testing a Google to Nextcloud migration, the owner was shown one row on
 * *Moved on the old system*: *Files / renamed*, beside `68524b1d65c5`. *"I find
 * it a bit weird it just mentions '/'. As I use it I need more info, like a
 * name, to be able to understand what I need to decide on."* The decision on
 * that row is whether to remove the old copy on the new system, and nothing on
 * it said which file.
 *
 * The name was already held. Every row records the item's own identifier
 * beside its hash (`natural_key`: for a file, the root-relative path it was
 * copied from) and, for a message, an event, a task or a contact, the name the
 * pass read from it (`display_name`). A relocation's new name is on the row its
 * new key names: the copy already made there. So `listMoves` reads both rows,
 * `listDeletions` and `listEarlierExports` read the row they list, and nothing
 * new is stored. This file holds that, on the SQL the appliance runs:
 *
 *  - a renamed file is named by its old row and by its new one, also at the top
 *    of a drive, where the folder is `/`;
 *  - a moved file is named in both folders;
 *  - a message and an event are named by what the pass stored;
 *  - a row from before names were recorded says what it always said;
 *  - a deleted file, a deleted contact and an earlier export are named;
 *  - and ANOTHER ORGANISATION'S ROW IS NEVER READ, nor another migration's:
 *    under row security, as the managed API reads the queue, and outside it, as
 *    the appliance's ledger runs, where the statement's own filters are all
 *    there is (`docs/rls-guide.md`, *Where row security holds today*).
 *
 * Every file, folder, event, message and person here is invented. UUID family
 * 1119a0e5-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from './index.ts';
import type { LedgerDriver } from './index.ts';
import type { LedgerRecord, MappingId, TenantId } from '@openmig/shared';

const A = '1119a0e5-e29b-41d4-a716-446655440001' as TenantId;
const B = '1119a0e5-e29b-41d4-a716-446655440002' as TenantId;
const CONN_A = '1119a0e5-e29b-41d4-a716-446655440011';
const CONN_B = '1119a0e5-e29b-41d4-a716-446655440012';
const BOX_A = '1119a0e5-e29b-41d4-a716-446655440021';
const BOX_A2 = '1119a0e5-e29b-41d4-a716-446655440022';
const BOX_B = '1119a0e5-e29b-41d4-a716-446655440023';
/** A's migration, whose queues are read. */
const MAP_A = '1119a0e5-e29b-41d4-a716-446655440031' as MappingId;
/** A's other migration. */
const MAP_A2 = '1119a0e5-e29b-41d4-a716-446655440032' as MappingId;
const MAP_B = '1119a0e5-e29b-41d4-a716-446655440033' as MappingId;

let driver: LedgerDriver;

/** A row we copied, for one organisation's migration. */
function copied(
  tenantId: TenantId,
  mappingId: MappingId,
  over: Partial<LedgerRecord> & Pick<LedgerRecord, 'naturalKeyHash'>,
): LedgerRecord {
  return {
    tenantId,
    mappingId,
    itemType: 'file',
    contentHash: `bytes-${over.naturalKeyHash}`,
    targetId: `t-${over.naturalKeyHash}`,
    createdAt: new Date().toISOString(),
    sizeBytes: 10,
    status: 'copied',
    collection: 'Docs',
    ...over,
  };
}

/** The ledger as the managed API reads a queue: as `app_user`, in one organisation's scope. */
const inScopeOf = <T>(tenant: TenantId, run: (l: PgLedger) => Promise<T>) =>
  withTenant(driver, tenant, async (db) => run(new PgLedger(db)));
const asA = <T>(run: (l: PgLedger) => Promise<T>) => inScopeOf(A, run);

/**
 * The ledger as the appliance runs it: on the owner's connection, outside
 * `withTenant`, where no policy applies (PGlite connects as its superuser).
 */
async function outsideRowSecurity<T>(run: (l: PgLedger, see: (sql: string, p: unknown[]) => Promise<number>) => Promise<T>): Promise<T> {
  const conn = await driver.acquire();
  try {
    const see = async (sql: string, p: unknown[]) =>
      Number((await conn.query<{ n: number | string }>(sql, p)).rows[0]?.n ?? 0);
    return await run(new PgLedger(conn.db), see);
  } finally {
    conn.release();
  }
}

/** A file renamed or moved on the old system: its old row, its new row, and the move. */
async function relocated(
  from: { key: string; path: string; folder: string },
  to: { key: string; path: string; folder: string },
): Promise<void> {
  await asA((l) => l.recordIfAbsent(copied(A, MAP_A, { naturalKeyHash: from.key, naturalKey: from.path, collection: from.folder })));
  // The same bytes, under the new key: what made it a relocation.
  await asA((l) =>
    l.recordIfAbsent(
      copied(A, MAP_A, { naturalKeyHash: to.key, naturalKey: to.path, collection: to.folder, contentHash: `bytes-${from.key}` }),
    ),
  );
  await asA((l) => l.recordMove(A, MAP_A, 'file', from.key, to.folder, to.key));
}

const movesOfA = () => asA((l) => l.listMoves(A, MAP_A));
const moveOf = async (key: string) => (await movesOfA()).find((m) => m.naturalKeyHash === key);

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    for (const [tenant, name, connection, kind] of [
      [A, 'names', CONN_A, 'google'],
      [B, 'another organisation', CONN_B, 'google'],
    ] as const) {
      await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [tenant, name]);
      await q(
        `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
         VALUES ($1,$2,'source',$3,'g','{}'::jsonb,'connected')`,
        [connection, tenant, kind],
      );
    }
    for (const [box, tenant, connection, address] of [
      [BOX_A, A, CONN_A, 'a@example.com'],
      [BOX_A2, A, CONN_A, 'a2@example.com'],
      [BOX_B, B, CONN_B, 'b@example.com'],
    ] as const) {
      await q(
        `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
         VALUES ($1,$2,$3,'user',$4)`,
        [box, tenant, connection, address],
      );
    }
    for (const [mapping, tenant, box] of [
      [MAP_A, A, BOX_A],
      [MAP_A2, A, BOX_A2],
      [MAP_B, B, BOX_B],
    ] as const) {
      await q(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
         VALUES ($1,$2,$3,'active')`,
        [mapping, tenant, box],
      );
    }
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
    await conn.query('DELETE FROM item WHERE tenant_id = $1 OR tenant_id = $2', [A, B]);
  } finally {
    await conn.release();
  }
});

describe('Moves names the item, from the rows the ledger already holds', () => {
  it('a renamed file, by its old name and by the name on its new copy', async () => {
    await relocated(
      { key: 'h-report', path: 'Docs/report.pdf', folder: 'Docs' },
      { key: 'h-report-final', path: 'Docs/report-final.pdf', folder: 'Docs' },
    );

    const moves = await movesOfA();
    // One row: the new copy is not a move of its own.
    expect(moves.map((m) => m.naturalKeyHash)).toEqual(['h-report']);
    expect(moves[0]).toMatchObject({
      domain: 'file',
      displayName: 'report.pdf',
      from: 'Docs',
      to: 'Docs',
      // Still the handle Remove the old copy takes, and still a hash.
      toNaturalKeyHash: 'h-report-final',
      toDisplayName: 'report-final.pdf',
    });
  });

  it("a file renamed at the top of a drive, whose folder is '/'", async () => {
    // The owner's row: `from` and `to` were both `/`, and that was all it said.
    await relocated(
      { key: 'h-top', path: 'notes.txt', folder: '/' },
      { key: 'h-top-new', path: 'notes-2026.txt', folder: '/' },
    );

    expect(await moveOf('h-top')).toMatchObject({
      from: '/',
      to: '/',
      displayName: 'notes.txt',
      toDisplayName: 'notes-2026.txt',
    });
  });

  it('a moved file, by its name in both folders', async () => {
    await relocated(
      { key: 'h-plan', path: 'Docs/plan.pdf', folder: 'Docs' },
      { key: 'h-plan-archived', path: 'Archive/2026/plan.pdf', folder: 'Archive/2026' },
    );

    expect(await moveOf('h-plan')).toMatchObject({
      displayName: 'plan.pdf',
      from: 'Docs',
      to: 'Archive/2026',
      toDisplayName: 'plan.pdf',
    });
  });

  it('a message and an event, by the names the pass stored for them', async () => {
    await asA((l) =>
      l.recordIfAbsent(
        copied(A, MAP_A, {
          itemType: 'email',
          naturalKeyHash: 'h-message',
          naturalKey: 'invented-1@example.com',
          displayName: 'Quarterly figures',
          collection: 'INBOX/Projects',
        }),
      ),
    );
    await asA((l) =>
      l.recordIfAbsent(
        copied(A, MAP_A, {
          itemType: 'calendar',
          naturalKeyHash: 'h-event',
          naturalKey: 'invented-uid-1',
          displayName: 'Dentist',
          collection: 'Personal',
        }),
      ),
    );
    // Both keep their key when they move: no new copy, so no new name either.
    await asA((l) => l.recordMove(A, MAP_A, 'email', 'h-message', 'Archive/2026'));
    await asA((l) => l.recordMove(A, MAP_A, 'calendar', 'h-event', 'Work'));

    const message = await moveOf('h-message');
    expect(message).toMatchObject({ displayName: 'Quarterly figures', from: 'INBOX/Projects', to: 'Archive/2026' });
    expect(message).not.toHaveProperty('toDisplayName');
    const event = await moveOf('h-event');
    expect(event).toMatchObject({ displayName: 'Dentist', from: 'Personal', to: 'Work' });
    expect(event).not.toHaveProperty('toNaturalKeyHash');
  });

  it('a row from before names were recorded says what it always said: its folders', async () => {
    // `natural_key` is `''` on every row written before 2026-09-12, for the
    // old copy and for the new one alike; and a contact's key is a UID, which
    // is not a name.
    await relocated(
      { key: 'h-old', path: '', folder: 'Docs' },
      { key: 'h-old-new', path: '', folder: 'Docs' },
    );
    await asA((l) =>
      l.recordIfAbsent(
        copied(A, MAP_A, { itemType: 'contact', naturalKeyHash: 'h-card', naturalKey: 'invented-card-uid', collection: 'Family' }),
      ),
    );
    await asA((l) => l.recordMove(A, MAP_A, 'contact', 'h-card', 'Work'));

    const file = await moveOf('h-old');
    expect(file).toMatchObject({ from: 'Docs', to: 'Docs', toNaturalKeyHash: 'h-old-new' });
    expect(file).not.toHaveProperty('displayName');
    expect(file).not.toHaveProperty('toDisplayName');
    expect(await moveOf('h-card')).not.toHaveProperty('displayName');
  });
});

describe('Deletions names the item, from the row it is about', () => {
  it('a deleted file and a deleted contact, and a file whose path was never recorded', async () => {
    for (const record of [
      copied(A, MAP_A, { naturalKeyHash: 'h-tax', naturalKey: 'Docs/tax-2025.pdf' }),
      copied(A, MAP_A, { itemType: 'contact', naturalKeyHash: 'h-jan', naturalKey: 'invented-uid-2', displayName: 'Jan Jansen', collection: 'Family' }),
      copied(A, MAP_A, { naturalKeyHash: 'h-unrecorded', naturalKey: '' }),
    ]) {
      await asA((l) => l.recordIfAbsent(record));
      await asA((l) => l.recordReportedDeletion(A, MAP_A, record.itemType, record.naturalKeyHash));
    }

    const deletions = await asA((l) => l.listDeletions(A, MAP_A));
    const of = (key: string) => deletions.find((d) => d.naturalKeyHash === key);
    expect(of('h-tax')).toMatchObject({ displayName: 'tax-2025.pdf', collection: 'Docs' });
    expect(of('h-jan')).toMatchObject({ displayName: 'Jan Jansen', collection: 'Family' });
    expect(of('h-unrecorded')).toMatchObject({ collection: 'Docs' });
    expect(of('h-unrecorded')).not.toHaveProperty('displayName');
  });

  it('an earlier export, by its own name', async () => {
    await asA((l) => l.recordIfAbsent(copied(A, MAP_A, { naturalKeyHash: 'h-plan-odt', naturalKey: 'Docs/Plan.odt' })));
    await asA((l) =>
      l.markEarlierExports(A, MAP_A, 'file', [{ formerNaturalKeyHash: 'h-plan-odt', naturalKeyHash: 'h-plan-docx' }]),
    );

    const [earlier, ...more] = await asA((l) => l.listEarlierExports(A, MAP_A));
    expect(more).toEqual([]);
    expect(earlier).toMatchObject({ naturalKeyHash: 'h-plan-odt', displayName: 'Plan.odt', collection: 'Docs' });
  });
});

/**
 * Nothing ties a row's migration to its organisation but the statement: the
 * foreign keys check each id on its own. So the rows below are what a query
 * missing a filter would read, and the names they carry are the ones that must
 * never reach A's screen.
 */
describe("another organisation's rows, and another migration's, are never read", () => {
  async function seed(): Promise<void> {
    // A's rename, whose new key A holds no row for.
    await asA((l) => l.recordIfAbsent(copied(A, MAP_A, { naturalKeyHash: 'h-mine', naturalKey: 'Docs/mine.pdf' })));
    await asA((l) => l.recordMove(A, MAP_A, 'file', 'h-mine', 'Docs', 'h-elsewhere'));
    // Rows under that very key: in A's other migration, in B's own, and one of
    // B's that claims A's migration id.
    await asA((l) =>
      l.recordIfAbsent(copied(A, MAP_A2, { naturalKeyHash: 'h-elsewhere', naturalKey: 'Docs/another-migration.pdf' })),
    );
    await inScopeOf(B, (l) =>
      l.recordIfAbsent(copied(B, MAP_B, { naturalKeyHash: 'h-elsewhere', naturalKey: 'Docs/another-organisation.pdf' })),
    );
    await inScopeOf(B, (l) =>
      l.recordIfAbsent(copied(B, MAP_A, { naturalKeyHash: 'h-elsewhere', naturalKey: 'Docs/another-organisation-claiming-it.pdf' })),
    );
    // And B rows claiming A's migration that are a move and a deletion of their own.
    await inScopeOf(B, (l) =>
      l.recordIfAbsent(copied(B, MAP_A, { naturalKeyHash: 'h-b-moved', naturalKey: 'Private/another-organisation-moved.pdf' })),
    );
    await inScopeOf(B, (l) => l.recordMove(B, MAP_A, 'file', 'h-b-moved', 'Private/Elsewhere', 'h-elsewhere'));
    await inScopeOf(B, (l) =>
      l.recordIfAbsent(copied(B, MAP_A, { naturalKeyHash: 'h-b-deleted', naturalKey: 'Private/another-organisation-deleted.pdf' })),
    );
    await inScopeOf(B, (l) => l.recordReportedDeletion(B, MAP_A, 'file', 'h-b-deleted'));
  }

  function expectOnlyA(
    moves: Awaited<ReturnType<PgLedger['listMoves']>>,
    deletions: Awaited<ReturnType<PgLedger['listDeletions']>>,
  ): void {
    expect(moves.map((m) => m.naturalKeyHash)).toEqual(['h-mine']);
    expect(moves[0]).toMatchObject({ displayName: 'mine.pdf', toNaturalKeyHash: 'h-elsewhere' });
    // No row of A's migration holds the new key, so there is no new name.
    expect(moves[0]).not.toHaveProperty('toDisplayName');
    expect(deletions).toEqual([]);
    const said = JSON.stringify({ moves, deletions });
    expect(said).not.toContain('another-organisation');
    expect(said).not.toContain('another-migration');
  }

  it('under row security, as the managed API reads a queue', async () => {
    await seed();

    expectOnlyA(
      await asA((l) => l.listMoves(A, MAP_A)),
      await asA((l) => l.listDeletions(A, MAP_A)),
    );
  });

  it("outside it, as the appliance's ledger runs, by the statement's own filters", async () => {
    await seed();

    await outsideRowSecurity(async (l, see) => {
      // This connection DOES see the other organisation's rows in A's
      // migration; without that, the assertions below would prove nothing.
      expect(await see('SELECT count(*) AS n FROM item WHERE tenant_id = $1 AND mapping_id = $2', [B, MAP_A])).toBe(3);
      expectOnlyA(await l.listMoves(A, MAP_A), await l.listDeletions(A, MAP_A));
    });
  });
});
