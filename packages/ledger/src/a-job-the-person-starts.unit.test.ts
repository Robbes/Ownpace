// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The pass, run end to end against a real database (workplan 0117 T2, slice 4).
 *
 * D7(a) made this *"a job the person starts and we report on"*. Slices 2 and 3
 * built the deciding and the recording; #915 made the evidence cross between
 * them. This is the thing that runs, and it lives here rather than beside the
 * pass because two of its three rules are only true against a real ledger: the
 * items stream in pages, and what was recorded before a failure has to still be
 * there afterwards.
 *
 * The TARGET is fake and the DATABASE is real, which is the right way round.
 * A fake target is the only way to make it throw on the four-hundredth item; a
 * fake database would prove nothing about partial progress.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { ConfirmationStore } from './confirmation-store.ts';
import { RunStore } from './run-store.ts';
import { runConfirmationPass } from '@openmig/core';
import type { ConfirmationReader } from '@openmig/core';
import type { LedgerDriver, LedgerConnection } from './driver.ts';
import type { PgDatabase } from './db-types.ts';
import type { MappingId, TenantId } from '@openmig/shared';

// UUID family 0046…, unused elsewhere in the repo.
const TENANT = '00460000-e29b-41d4-a716-446655440001' as TenantId;
const MAPPING = '00460000-e29b-41d4-a716-446655440002' as MappingId;
const CONN = '00460000-e29b-41d4-a716-446655440003';
const SRC = '00460000-e29b-41d4-a716-446655440004';
const DST = '00460000-e29b-41d4-a716-446655440005';

let driver: LedgerDriver;
let conn: LedgerConnection;
let db: PgDatabase;
let store: ConfirmationStore;
let runs: RunStore;

/** A target that says yes to everything, unless told to fall over at N. */
const target = (failAt?: number): ConfirmationReader => {
  let seen = 0;
  return {
    isPresent: async () => {
      seen += 1;
      if (failAt !== undefined && seen > failAt) throw new Error('the target went away');
      return true;
    },
  };
};

const seedItems = async (n: number, status = 'copied', domain = 'email'): Promise<void> => {
  for (let i = 0; i < n; i += 1) {
    await conn.query(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, content_hash, status)
       VALUES ($1,$2,$3,'INBOX',$4,$4,NULL,$5)`,
      [TENANT, MAPPING, domain, `${domain}-k-${String(i).padStart(4, '0')}`, status],
    );
  }
};

const runRow = async (runId: string): Promise<{ status: string; stats: Record<string, unknown> }> => {
  const r = await conn.query<{ status: string; stats: Record<string, unknown> }>(
    `SELECT status, stats FROM run WHERE id = $1`,
    [runId],
  );
  return r.rows[0]!;
};

const confirmedCount = async (): Promise<number> => {
  const r = await conn.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM item WHERE mapping_id = $1 AND confirmed_answer IS NOT NULL`,
    [MAPPING],
  );
  return Number(r.rows[0]!.n);
};

const pass = (over: Partial<Parameters<typeof runConfirmationPass>[0]> = {}) =>
  runConfirmationPass({
    tenantId: TENANT,
    mappingId: MAPPING,
    domains: ['email'],
    readerFor: () => target(),
    ledger: store,
    runs,
    ...over,
  });

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  db = made.db;
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Job tests', 'active')`, [TENANT]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [id, addr] of [
    [SRC, 'src@job.local'],
    [DST, 'dst@job.local'],
  ]) {
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
       VALUES ($1,$2,$3,$4,'user',$4,$4,'active')`,
      [id, TENANT, CONN, addr],
    );
  }
  await conn.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
     VALUES ($1,$2,$3,$4,'mirror','active')`,
    [MAPPING, TENANT, SRC, DST],
  );
  store = new ConfirmationStore(db);
  runs = new RunStore(db);
}, 120_000);

afterAll(async () => {
  conn?.release();
  await driver?.end();
});

beforeEach(async () => {
  await conn.query('DELETE FROM item');
  await conn.query('DELETE FROM run_event');
  await conn.query('DELETE FROM run');
});

describe('a pass that finishes', () => {
  it('confirms every item and closes the run as succeeded', async () => {
    await seedItems(3);
    const result = await pass();
    expect(result.tally.total).toBe(3);
    expect(result.recorded).toBe(3);
    expect(await confirmedCount()).toBe(3);
    expect((await runRow(result.runId)).status).toBe('succeeded');
  });

  it('is a manual run by default, because a person started it', async () => {
    // D7(a) is a job somebody presses. A pass arriving on a schedule is a
    // different product decision and has to say so rather than inherit the word.
    await seedItems(1);
    const { runId } = await pass();
    const r = await conn.query<{ kind: string; trigger: string }>(
      `SELECT kind, trigger FROM run WHERE id = $1`,
      [runId],
    );
    expect(r.rows[0]).toMatchObject({ kind: 'confirm', trigger: 'manual' });
  });

  it('puts the tally on the run row, so the report is not recomputed', async () => {
    await seedItems(2);
    const { runId } = await pass();
    const stats = (await runRow(runId)).stats;
    expect(stats).toMatchObject({ itemsProcessed: 2, errors: 0, verified: 0, recorded: 2 });
  });
});

describe('a pass that never asked', () => {
  it('leaves a waived status unrecorded, so its answer stays NULL', async () => {
    // The column means "what the target said". A pass that never asks must not
    // put a word in it — that is #915's rule, and this is its first real caller.
    await seedItems(3, 'skipped');
    const result = await pass();
    expect(result.tally.total).toBe(3);
    expect(result.recorded).toBe(0);
    expect(await confirmedCount()).toBe(0);
    const rows = await store.rowsFor({ tenantId: TENANT, mappingId: MAPPING });
    expect(rows.map((r) => r.state)).toEqual(['never-placed', 'never-placed', 'never-placed']);
  });

  it('skips a domain with no reader rather than reporting it confirmed', async () => {
    // A domain nobody can re-read is honestly `unchecked`. Counting it as
    // confirmed would be a pass claiming an answer it never sought.
    await seedItems(2);
    const result = await pass({ readerFor: () => undefined });
    expect(result.tally.total).toBe(0);
    expect(await confirmedCount()).toBe(0);
    const rows = await store.rowsFor({ tenantId: TENANT, mappingId: MAPPING });
    expect(rows.every((r) => r.state === 'unchecked')).toBe(true);
  });
});

/**
 * A target that falls over is NOT a pass that falls over.
 *
 * `answerFor` catches everything the reader throws and calls it `unreachable`
 * — slice 2's first rule, and the reason `unchecked` exists. So a flaky target
 * does not fail the job; it produces rows that honestly say nobody could tell.
 *
 * This is worth asserting rather than assuming: the obvious reading of "the run
 * always closes" is that a throwing target fails the run, and a later change
 * that made it do so would turn one bad afternoon at a provider into a job a
 * person has to start again from nothing.
 */
describe('a target that falls over', () => {
  it('does not fail the run — it produces unchecked rows', async () => {
    await seedItems(5);
    const result = await pass({ readerFor: () => target(2) });
    expect((await runRow(result.runId)).status).toBe('succeeded');
    expect(result.tally.byState.unchecked).toBe(3);
  });

  it('still records the unreachable answer, because that is evidence too', async () => {
    // `unreachable` is a thing the target did, not an absence of information.
    // Recording it is what lets a later pass see which rows are worth retrying.
    await seedItems(5);
    await pass({ readerFor: () => target(2) });
    expect(await confirmedCount()).toBe(5);
  });
});

/**
 * The LEDGER going away is what actually kills a pass, and 0120's rule applies:
 * the run row always closes. "Still going" three days later is not an answer to
 * somebody who pressed a button.
 */
describe('a pass that dies', () => {
  /** A recorder that writes through to the real store, then stops. */
  const failingLedger = (after: number) => {
    let writes = 0;
    return {
      itemsToConfirm: store.itemsToConfirm.bind(store),
      record: async (args: Parameters<ConfirmationStore['record']>[0]) => {
        writes += 1;
        if (writes > after) throw new Error('the ledger went away');
        await store.record(args);
      },
    };
  };

  it('closes the run as failed rather than leaving it running', async () => {
    await seedItems(5);
    await expect(pass({ ledger: failingLedger(2) })).rejects.toThrow(/ledger went away/);
    const id = (await conn.query<{ id: string }>(`SELECT id FROM run`)).rows[0]!.id;
    expect((await runRow(id)).status).toBe('failed');
  });

  it('keeps what it had already confirmed', async () => {
    // Evidence is not all-or-nothing: the items read and written before the
    // database dropped are real answers, and discarding them makes the next
    // pass buy them again.
    await seedItems(5);
    await expect(pass({ ledger: failingLedger(2) })).rejects.toThrow();
    expect(await confirmedCount()).toBe(2);
  });

  it('says how far it got, on the row', async () => {
    await seedItems(5);
    await expect(pass({ ledger: failingLedger(2) })).rejects.toThrow();
    const id = (await conn.query<{ id: string }>(`SELECT id FROM run`)).rows[0]!.id;
    expect((await runRow(id)).stats).toMatchObject({ recorded: 2, errors: 1 });
  });
});

describe('the items stream rather than arrive all at once', () => {
  it('reads past one page, in a stable order, with nothing dropped or repeated', async () => {
    // D7(a) authorised confirming EVERY item of a family file account. A page
    // boundary that loses or repeats a row is the defect that would not show up
    // until the account it exists for.
    await seedItems(25);
    const seen: string[] = [];
    for await (const row of store.itemsToConfirm({
      tenantId: TENANT,
      mappingId: MAPPING,
      domain: 'email',
      batch: 4,
    })) {
      seen.push(row.naturalKeyHash);
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('confirms every item of a multi-page account', async () => {
    await seedItems(25);
    const result = await pass();
    expect(result.recorded).toBe(25);
    expect(await confirmedCount()).toBe(25);
  });

  it('reads only the domain it was asked for', async () => {
    await seedItems(3, 'copied', 'email');
    await seedItems(4, 'copied', 'file');
    const result = await pass({ domains: ['file'] });
    expect(result.tally.total).toBe(4);
  });
});
