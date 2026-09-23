// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NAME THE DOCUMENT OUTGREW, against a real database (workplan 0042 T8 (b),
 * migration 0056).
 *
 * `packages/core/src/a-name-the-document-outgrew.unit.test.ts` proves the pass
 * asks the right question. This proves the store answers it: that the status
 * the CHECK constraint now admits is the one written, that only a `failed` row
 * is ever touched, that a recorded source handle is honoured, and that a row
 * superseded here drops out of the two readers that would otherwise count it:
 * the move detector's `placedItems` and verification's source counts.
 *
 * PGlite as `app_user`, through the real migrations, so the constraint, the
 * columns and their RLS are the product's rather than a fixture's.
 *
 * UUID family 0b8e0000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  pgliteDriver,
  runMigrations,
  withTenant,
  PgLedger,
  createLedgerVerificationReader,
} from './index.ts';
import type { LedgerDriver } from './index.ts';
import type { FormerName, LedgerRecord, MappingId, TenantId } from '@openmig/shared';

const TENANT = '0b8e0000-e29b-41d4-a716-446655443001' as TenantId;
const CONN = '0b8e0000-e29b-41d4-a716-446655443011';
const BOX = '0b8e0000-e29b-41d4-a716-446655443021';
const MAPPING = '0b8e0000-e29b-41d4-a716-446655443031' as MappingId;

let driver: LedgerDriver;

const ledger = <T>(run: (l: PgLedger) => Promise<T>) =>
  withTenant(driver, TENANT, async (db) => run(new PgLedger(db)));

const row = (naturalKeyHash: string, over: Partial<LedgerRecord> = {}): LedgerRecord => ({
  tenantId: TENANT,
  mappingId: MAPPING,
  itemType: 'file',
  naturalKeyHash,
  collection: 'Docs',
  contentHash: 'sha256:abc',
  targetId: '',
  createdAt: '2026-09-17T00:00:00Z',
  status: 'failed',
  ...over,
});

/** A failure as the pass records one, with or without the source handle. */
const failed = (naturalKeyHash: string, sourceRef?: string) =>
  ledger((l) =>
    l.recordFailure(
      row(naturalKeyHash, sourceRef !== undefined ? { sourceRef } : {}),
      'refused: the export is not byte-stable',
      { park: true },
    ),
  );

/** Every row's status, and what superseded it, read around the store. */
async function stored(): Promise<Record<string, { status: string; by: string | null; at: boolean }>> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      `SELECT natural_key_hash, status, superseded_by_natural_key_hash, superseded_at
         FROM item WHERE mapping_id = $1`,
      [MAPPING],
    );
    return Object.fromEntries(
      (
        r.rows as Array<{
          natural_key_hash: string;
          status: string;
          superseded_by_natural_key_hash: string | null;
          superseded_at: unknown;
        }>
      ).map((x) => [
        x.natural_key_hash,
        { status: x.status, by: x.superseded_by_natural_key_hash, at: x.superseded_at !== null },
      ]),
    );
  } finally {
    await conn.release();
  }
}

const name = (former: string, current: string, sourceRef?: string): FormerName => ({
  formerNaturalKeyHash: former,
  naturalKeyHash: current,
  ...(sourceRef !== undefined ? { sourceRef } : {}),
});

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'outgrown']);
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

describe('supersedeFormerNames', () => {
  it('supersedes a failure under a former name, and says which row took over', async () => {
    await failed('deck-pptx');

    const closed = await ledger((l) =>
      l.supersedeFormerNames(TENANT, MAPPING, 'file', [name('deck-pptx', 'deck-odp', 'deck-1')]),
    );

    expect(closed).toEqual([{ naturalKeyHash: 'deck-pptx', supersededBy: 'deck-odp' }]);
    expect((await stored())['deck-pptx']).toEqual({ status: 'superseded', by: 'deck-odp', at: true });
    // Off the Failures screen, which reads `failed` and nothing else.
    expect(await ledger((l) => l.listFailures(TENANT, MAPPING))).toEqual([]);
  });

  it('honours a recorded source handle: the same one supersedes, another does not', async () => {
    await failed('same', 'deck-1');
    await failed('other', 'another-deck');

    const closed = await ledger((l) =>
      l.supersedeFormerNames(TENANT, MAPPING, 'file', [
        name('same', 'deck-odp', 'deck-1'),
        name('other', 'deck-odp', 'deck-1'),
      ]),
    );

    expect(closed.map((c) => c.naturalKeyHash)).toEqual(['same']);
    expect((await stored()).other?.status).toBe('failed');
  });

  it('never touches a row that reached the target', async () => {
    await ledger((l) => l.recordIfAbsent(row('report-docx', { status: 'copied', targetId: 't/1' })));

    const closed = await ledger((l) =>
      l.supersedeFormerNames(TENANT, MAPPING, 'file', [name('report-docx', 'report-odt', 'doc-1')]),
    );

    expect(closed).toEqual([]);
    expect((await stored())['report-docx']?.status).toBe('copied');
  });

  it('never makes a document its own former name', async () => {
    await failed('deck-odp');
    const closed = await ledger((l) =>
      l.supersedeFormerNames(TENANT, MAPPING, 'file', [name('deck-odp', 'deck-odp')]),
    );
    expect(closed).toEqual([]);
  });

  it('finds a failure past the first chunk of former names', async () => {
    // A large Drive offers thousands of former names a pass; the one that
    // matters can be anywhere in them.
    await failed('needle');
    const haystack = Array.from({ length: 1500 }, (_, i) => name(`nothing-${i}`, `current-${i}`));
    haystack.push(name('needle', 'needle-now'));

    const closed = await ledger((l) => l.supersedeFormerNames(TENANT, MAPPING, 'file', haystack));

    expect(closed).toEqual([{ naturalKeyHash: 'needle', supersededBy: 'needle-now' }]);
  });
});

describe('the rows a failure writes and a write clears', () => {
  it('a failure now records the source handle, and repairs it on a row that had none', async () => {
    await failed('deck-pptx');
    expect((await ledger((l) => l.find(TENANT, MAPPING, 'file', 'deck-pptx')))?.sourceRef).toBeUndefined();

    await failed('deck-pptx', 'deck-1');

    expect((await ledger((l) => l.find(TENANT, MAPPING, 'file', 'deck-pptx')))?.sourceRef).toBe('deck-1');
  });

  it('a superseded name written again is a current name again', async () => {
    await failed('deck');
    await ledger((l) => l.supersedeFormerNames(TENANT, MAPPING, 'file', [name('deck', 'deck-odp')]));

    // The policy was switched back and the deck copied under this name.
    await ledger((l) => l.recordUpdate(row('deck', { status: 'copied', targetId: 't/deck' })));

    expect((await stored()).deck).toEqual({ status: 'copied', by: null, at: false });
  });

  it('and so is one that fails again', async () => {
    await failed('deck');
    await ledger((l) => l.supersedeFormerNames(TENANT, MAPPING, 'file', [name('deck', 'deck-odp')]));

    await failed('deck');

    expect((await stored()).deck).toEqual({ status: 'failed', by: null, at: false });
  });
});

describe('the readers that would otherwise count it', () => {
  it('the move detector does not see it as something placed and gone', async () => {
    await failed('deck-pptx');
    await ledger((l) => l.supersedeFormerNames(TENANT, MAPPING, 'file', [name('deck-pptx', 'deck-odp')]));

    expect(await ledger((l) => l.placedItems(TENANT, MAPPING, 'file'))).toEqual([]);
  });

  it('verification does not count it as a source item missing on the target', async () => {
    await ledger((l) =>
      l.recordFailure(row('deck-pptx', { sizeBytes: 100 }), 'refused', { park: true }),
    );
    await ledger((l) =>
      l.recordIfAbsent(row('deck-odp', { status: 'copied', targetId: 't/deck', sizeBytes: 40 })),
    );
    await ledger((l) => l.supersedeFormerNames(TENANT, MAPPING, 'file', [name('deck-pptx', 'deck-odp')]));

    // All four readers verification builds its source side from.
    const counted = await withTenant(driver, TENANT, async (db) => {
      const reader = createLedgerVerificationReader({ db });
      return {
        count: await reader.countItems(TENANT, MAPPING, 'file'),
        bytes: await reader.totalSizeBytes(TENANT, MAPPING, 'file'),
        samples: (await reader.getSamples(TENANT, MAPPING, 'file', 10)).map((x) => x.naturalKeyHash),
        keys: await reader.getAllNaturalKeyHashes(TENANT, MAPPING, 'file'),
      };
    });

    expect(counted).toEqual({ count: 1, bytes: 40, samples: ['deck-odp'], keys: ['deck-odp'] });
  });
});

/**
 * THE SECOND HALF, against the real store (0042 T8 (b); the owner, 2026-09-23:
 * *"An old copy in Nextcloud is never deleted for you. Deletions lists it as
 * 'an earlier export', not as 'deleted in Google'."*).
 */
describe('markEarlierExports', () => {
  /** Our copy of a document under the name an earlier export policy gave it. */
  const copy = (naturalKeyHash: string, over: Partial<LedgerRecord> = {}) =>
    ledger((l) =>
      l.recordIfAbsent(row(naturalKeyHash, { status: 'copied', targetId: `t/${naturalKeyHash}`, ...over })),
    );

  it('marks our copy under a former name as an earlier export, and changes nothing else', async () => {
    await copy('report-docx', { sourceRef: 'doc-1' });

    const marked = await ledger((l) =>
      l.markEarlierExports(TENANT, MAPPING, 'file', [name('report-docx', 'report-odt', 'doc-1')]),
    );

    expect(marked).toEqual([{ naturalKeyHash: 'report-docx', exportedAs: 'report-odt' }]);
    // Still ours, still on the target: nothing is closed and nothing removed.
    expect((await stored())['report-docx']).toEqual({ status: 'copied', by: 'report-odt', at: true });
  });

  it('resets its absence count: it was renamed by the policy, not missed', async () => {
    await copy('report-docx', { sourceRef: 'doc-1' });
    await ledger((l) => l.recordAbsent(TENANT, MAPPING, 'file', 'report-docx'));

    await ledger((l) =>
      l.markEarlierExports(TENANT, MAPPING, 'file', [name('report-docx', 'report-odt', 'doc-1')]),
    );

    expect((await ledger((l) => l.find(TENANT, MAPPING, 'file', 'report-docx')))?.absentPasses ?? 0).toBe(0);
  });

  it('marks once: a later pass finds it marked and keeps the first date', async () => {
    await copy('report-docx', { sourceRef: 'doc-1' });
    const pair = [name('report-docx', 'report-odt', 'doc-1')];
    await ledger((l) => l.markEarlierExports(TENANT, MAPPING, 'file', pair));
    const first = await supersededAt('report-docx');

    const again = await ledger((l) => l.markEarlierExports(TENANT, MAPPING, 'file', pair));

    expect(again).toEqual([]);
    expect(await supersededAt('report-docx')).toBe(first);
  });

  it('leaves alone a failure, a file that was there before us, a removed copy and another document’s copy', async () => {
    await failed('failed-docx', 'doc-1');
    await copy('adopted-docx', { status: 'adopted', sourceRef: 'doc-2' });
    await copy('removed-docx', { sourceRef: 'doc-3' });
    await ledger(async (l) => {
      // The ledger's own conditional apply needs positive evidence; a report is one.
      await l.recordReportedDeletion(TENANT, MAPPING, 'file', 'removed-docx');
      await l.applyDeletion(TENANT, MAPPING, 'file', 'removed-docx');
    });
    await copy('theirs-docx', { sourceRef: 'an-uploaded-file' });

    const marked = await ledger((l) =>
      l.markEarlierExports(TENANT, MAPPING, 'file', [
        name('failed-docx', 'failed-odt', 'doc-1'),
        name('adopted-docx', 'adopted-odt', 'doc-2'),
        name('removed-docx', 'removed-odt', 'doc-3'),
        name('theirs-docx', 'theirs-odt', 'doc-4'),
      ]),
    );

    expect(marked).toEqual([]);
    const now = await stored();
    for (const key of ['failed-docx', 'adopted-docx', 'removed-docx', 'theirs-docx']) {
      expect(now[key]?.by, key).toBeNull();
    }
  });

  it('finds a copy past the first chunk of former names', async () => {
    await copy('needle', { sourceRef: 'doc-1' });
    const haystack = Array.from({ length: 1500 }, (_, i) => name(`nothing-${i}`, `current-${i}`));
    haystack.push(name('needle', 'needle-now', 'doc-1'));

    const marked = await ledger((l) => l.markEarlierExports(TENANT, MAPPING, 'file', haystack));

    expect(marked).toEqual([{ naturalKeyHash: 'needle', exportedAs: 'needle-now' }]);
  });

  it('is carried by placedItems, so the detector can leave it alone', async () => {
    await copy('report-docx', { sourceRef: 'doc-1' });
    await ledger((l) =>
      l.markEarlierExports(TENANT, MAPPING, 'file', [name('report-docx', 'report-odt', 'doc-1')]),
    );

    const placed = await ledger((l) => l.placedItems(TENANT, MAPPING, 'file'));

    expect(placed).toEqual([
      expect.objectContaining({ naturalKeyHash: 'report-docx', supersededByNaturalKeyHash: 'report-odt' }),
    ]);
  });

  it('is cleared when the name is given again, on a copy only', async () => {
    await copy('report-docx', { sourceRef: 'doc-1' });
    await failed('deck', 'deck-1');
    await ledger(async (l) => {
      await l.markEarlierExports(TENANT, MAPPING, 'file', [name('report-docx', 'report-odt', 'doc-1')]);
      await l.supersedeFormerNames(TENANT, MAPPING, 'file', [name('deck', 'deck-odp', 'deck-1')]);
    });

    await ledger(async (l) => {
      await l.clearEarlierExport(TENANT, MAPPING, 'file', 'report-docx');
      await l.clearEarlierExport(TENANT, MAPPING, 'file', 'deck');
    });

    const now = await stored();
    expect(now['report-docx']).toEqual({ status: 'copied', by: null, at: false });
    // A closed failure keeps its link to the row that took over.
    expect(now.deck).toEqual({ status: 'superseded', by: 'deck-odp', at: true });
  });
});

describe('what the owner is shown, and what they can do', () => {
  const copy = (naturalKeyHash: string, over: Partial<LedgerRecord> = {}) =>
    ledger((l) =>
      l.recordIfAbsent(row(naturalKeyHash, { status: 'copied', targetId: `t/${naturalKeyHash}`, ...over })),
    );
  const mark = (former: string, current: string, ref: string) =>
    ledger((l) => l.markEarlierExports(TENANT, MAPPING, 'file', [name(former, current, ref)]));

  it('lists an earlier export as one, and NOT as a deletion', async () => {
    await copy('report-docx', { sourceRef: 'doc-1', collection: 'Reports' });
    await mark('report-docx', 'report-odt', 'doc-1');

    const earlier = await ledger((l) => l.listEarlierExports(TENANT, MAPPING));
    expect(earlier).toEqual([
      expect.objectContaining({
        domain: 'file',
        naturalKeyHash: 'report-docx',
        collection: 'Reports',
        exportedAs: 'report-odt',
        markedAt: expect.any(String),
      }),
    ]);
    expect(earlier[0]?.acknowledgedAt).toBeUndefined();
    // The breaker, the digests, the report and Finish all read this list, and
    // a format switch must not tell any of them a document was deleted.
    expect(await ledger((l) => l.listDeletions(TENANT, MAPPING))).toEqual([]);
  });

  it('lists neither a closed failure nor a removed copy', async () => {
    await failed('deck', 'deck-1');
    await ledger((l) => l.supersedeFormerNames(TENANT, MAPPING, 'file', [name('deck', 'deck-odp', 'deck-1')]));

    expect(await ledger((l) => l.listEarlierExports(TENANT, MAPPING))).toEqual([]);
  });

  it('lets the owner keep one, which moves it to what was decided', async () => {
    await copy('report-docx', { sourceRef: 'doc-1' });
    await mark('report-docx', 'report-odt', 'doc-1');

    expect(await ledger((l) => l.resolveDeletion(TENANT, MAPPING, 'report-docx', 'keep'))).toBe(true);

    const [kept] = await ledger((l) => l.listEarlierExports(TENANT, MAPPING));
    expect(kept?.acknowledgedAt).toEqual(expect.any(String));
    // Still ours, still on the target: keeping changes nothing else.
    expect((await stored())['report-docx']).toEqual({ status: 'copied', by: 'report-odt', at: true });
  });

  it('keeps nothing that is not a confirmed deletion or an earlier export', async () => {
    await copy('plain-copy', { sourceRef: 'doc-9' });
    expect(await ledger((l) => l.resolveDeletion(TENANT, MAPPING, 'plain-copy', 'keep'))).toBe(false);
  });

  it('puts the open ones first, the longest waiting first among them', async () => {
    await copy('b-docx', { sourceRef: 'doc-b' });
    await copy('a-docx', { sourceRef: 'doc-a' });
    await copy('kept-docx', { sourceRef: 'doc-k' });
    await mark('b-docx', 'b-odt', 'doc-b');
    await mark('kept-docx', 'kept-odt', 'doc-k');
    await ledger((l) => l.resolveDeletion(TENANT, MAPPING, 'kept-docx', 'keep'));
    await mark('a-docx', 'a-odt', 'doc-a');

    const order = (await ledger((l) => l.listEarlierExports(TENANT, MAPPING))).map((e) => e.naturalKeyHash);

    expect(order).toEqual(['b-docx', 'a-docx', 'kept-docx']);
  });
});

/** When a row was marked, as the database holds it. */
async function supersededAt(naturalKeyHash: string): Promise<string | null> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      'SELECT superseded_at::text AS at FROM item WHERE mapping_id = $1 AND natural_key_hash = $2',
      [MAPPING, naturalKeyHash],
    );
    return (r.rows[0] as { at: string | null } | undefined)?.at ?? null;
  } finally {
    await conn.release();
  }
}
