// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The budget a confirmation shares with the migration (workplan 0117 T2,
 * slice 6 — decision D9).
 *
 * > *"(a) it shares the tenant's budget. The limit belongs to the PROVIDER, not
 * > to us, so splitting it into two budgets is pretending we have twice the
 * > allowance we do... That slowdown must be visible rather than avoided."*
 *
 * Two things are being proved, and they are different in kind.
 *
 * **That the bytes are counted at all.** Nothing that reads a TARGET has ever
 * been budgeted — `buildTargetWriterFromCredentials` takes neither a limiter
 * nor a meter — because until D7(a) nothing read one at the scale of a whole
 * account. So the reader spends, on the same meter instance a migration
 * against that provider spends.
 *
 * **That running out STOPS the pass.** This is the part worth a real database.
 * A confirmation that kept going on an exhausted budget would not merely be
 * slow: the reader's refusal becomes `unreachable`, so every remaining row
 * would be RECORDED as `unchecked` — *we asked and could not tell* about items
 * nobody asked about. Whether those rows keep their NULL answer is a fact about
 * the `item` table, so the table is real; the target is fake, which is the same
 * way round as slice 4's guard and for the same reason.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { createPgliteDb } from './pglite-driver.ts';
import { runMigrations } from './migrate.ts';
import { ConfirmationStore } from './confirmation-store.ts';
import { RunStore } from './run-store.ts';
import { readerOverTarget, runConfirmationPass } from '@openmig/core';
import type { LedgerDriver, LedgerConnection } from './driver.ts';
import type { PgDatabase } from './db-types.ts';
import {
  fileNaturalKeyHash,
  naturalKeyHash,
  type ByteBudgetState,
  type DownloadMeter,
  type MappingId,
  type RateBudget,
  type TargetEntry,
  type TargetReindexer,
  type TenantId,
} from '@openmig/shared';

// UUID family 0047…, unused elsewhere in the repo.
const TENANT = '00470000-e29b-41d4-a716-446655440001' as TenantId;
const MAPPING = '00470000-e29b-41d4-a716-446655440002' as MappingId;
const CONN = '00470000-e29b-41d4-a716-446655440003';
const SRC = '00470000-e29b-41d4-a716-446655440004';
const DST = '00470000-e29b-41d4-a716-446655440005';

const PROVIDER = 'gmail-imap';

let driver: LedgerDriver;
let conn: LedgerConnection;
let db: PgDatabase;
let store: ConfirmationStore;
let runs: RunStore;

/**
 * A meter that really counts, over a fixed ceiling — the in-memory twin of
 * `PgByteBudget`, kept local because the pg-backed one is pinned by its own
 * integration test and what is under test here is who spends and who stops.
 */
const meterOver = (
  ceilingBytes: number,
): DownloadMeter & { spent: () => number; stateReads: () => number } => {
  let spent = 0;
  let stateReads = 0;
  const describe_ = (): ByteBudgetState => ({
    spentBytes: spent,
    ceilingBytes,
    remainingBytes: Math.max(0, ceilingBytes - spent),
    windowResetsAt: new Date('2026-09-11T04:00:00.000Z'),
  });
  return {
    tenantId: TENANT,
    provider: PROVIDER,
    budget: {
      spend: async (_t, _p, bytes) => {
        spent += bytes;
        return describe_();
      },
      state: async () => {
        stateReads += 1;
        return describe_();
      },
    },
    spent: () => spent,
    stateReads: () => stateReads,
  };
};

/** A rate budget that records who asked for a token, and for what. */
const countingRate = (): RateBudget & { keys: string[] } => {
  const keys: string[] = [];
  return {
    keys,
    acquire: async (tenantId: string, provider: string) => {
      keys.push(`${tenantId}:${provider}`);
    },
  };
};

/**
 * The keys, hashed the way the reader hashes them — mail normalises a
 * Message-ID, a file takes a path, so a seed written with the wrong one
 * silently matches nothing and every row reads `missing`.
 */
const KEY_OF: Record<string, (k: string) => string> = {
  email: naturalKeyHash,
  file: fileNaturalKeyHash,
  calendar: naturalKeyHash,
};

/** Domain-prefixed, because `item`'s unique key is (tenant, mapping, type, hash). */
const rawKey = (domain: string, i: number): string => `${domain}-k-${String(i).padStart(4, '0')}`;

/**
 * A target holding `n` items, each `sizeBytes` big unless left unmeasured.
 *
 * `contentHashFor` answers a hash that never equals the ledger's, so every row
 * comes out `differs` — the state is not the point, the byte accounting is, and
 * the body read happens either way.
 */
const targetOf = (
  n: number,
  opts: { sizeBytes?: number; canHash?: boolean; domain?: string } = {},
): TargetReindexer => {
  const domain = opts.domain ?? 'email';
  const entries: TargetEntry[] = Array.from({ length: n }, (_, i) => ({
    naturalKey: rawKey(domain, i),
    targetId: `t-${i}`,
    mailboxId: 'INBOX',
    ...(opts.sizeBytes === undefined ? {} : { sizeBytes: opts.sizeBytes }),
  }));
  return {
    async *listEntries() {
      for (const e of entries) yield e;
    },
    ...(opts.canHash === false ? {} : { contentHashFor: async () => 'TARGET-HASH' }),
  };
};

/**
 * Seed rows the pass will actually read bytes for.
 *
 * `content_hash` is NOT NULL on purpose: `answerFor` skips `hashOnTarget`
 * entirely when the ledger holds nothing to compare against — correctly, since
 * downloading a body to compare it with nothing would be the pure cost D7(a)
 * was weighed against. A NULL-hash seed therefore spends no bytes and would
 * make every assertion in this file vacuous.
 */
const seedItems = async (n: number, domain = 'email'): Promise<void> => {
  for (let i = 0; i < n; i += 1) {
    const key = rawKey(domain, i);
    await conn.query(
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, content_hash, status)
       VALUES ($1,$2,$3,'INBOX',$4,$5,'LEDGER-HASH','copied')`,
      [TENANT, MAPPING, domain, key, KEY_OF[domain]!(key)],
    );
  }
};

const runRow = async (
  runId: string,
): Promise<{ status: string; stats: Record<string, unknown> }> => {
  const r = await conn.query<{ status: string; stats: Record<string, unknown> }>(
    `SELECT status, stats FROM run WHERE id = $1`,
    [runId],
  );
  return r.rows[0]!;
};

const answeredCount = async (): Promise<number> => {
  const r = await conn.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM item WHERE mapping_id = $1 AND confirmed_answer IS NOT NULL`,
    [MAPPING],
  );
  return Number(r.rows[0]!.n);
};

beforeAll(async () => {
  const made = await createPgliteDb({});
  driver = made.driver;
  db = made.db;
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();
  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'Budget tests', 'active')`, [
    TENANT,
  ]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','t','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  for (const [id, addr] of [
    [SRC, 'src@budget.local'],
    [DST, 'dst@budget.local'],
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

describe('what a confirmation spends', () => {
  it('charges the target’s bytes to the tenant’s own meter', async () => {
    await seedItems(4);
    const meter = meterOver(1_000_000);
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: targetOf(4, { sizeBytes: 2_048 }),
      budget: { meter },
    });

    await runConfirmationPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      domains: ['email'],
      readerFor: () => reader,
      ledger: store,
      runs,
      meter,
    });

    expect(meter.spent()).toBe(4 * 2_048);
  });

  it('counts an unmeasured item as zero rather than guessing at it', async () => {
    // `TargetEntry.sizeBytes` is *"what lets verification report
    // totalBytesTarget as a real measurement"*, and its own rule is to leave it
    // undefined rather than guess. A guess here would move a ceiling whose
    // penalty is a ~24-hour lockout of somebody's live account, so the meter
    // under-reads — erring toward finishing rather than toward stopping a
    // migration that had budget left.
    await seedItems(3);
    const meter = meterOver(1_000_000);
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: targetOf(3),
      budget: { meter },
    });

    await runConfirmationPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      domains: ['email'],
      readerFor: () => reader,
      ledger: store,
      runs,
      meter,
    });

    expect(meter.spent()).toBe(0);
    expect(await answeredCount()).toBe(3);
  });

  it('takes a rate token keyed by the tenant and the provider, not by a label of its own', async () => {
    // The defect this shape exists to avoid (0082 T5): `PgRateBudget.acquire`
    // took its tenant from the connector, and every connector passed a label —
    // `dav`, or Entra's `common` — so one tenant's budget was every tenant's.
    // The key travels with the meter here so nobody re-derives it.
    await seedItems(2);
    const meter = meterOver(1_000_000);
    const rate = countingRate();
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: targetOf(2, { sizeBytes: 10 }),
      budget: { meter, rate },
    });

    await runConfirmationPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      domains: ['email'],
      readerFor: () => reader,
      ledger: store,
      runs,
      meter,
    });

    // One for the listing, one per body read.
    expect(rate.keys).toEqual([
      `${TENANT}:${PROVIDER}`,
      `${TENANT}:${PROVIDER}`,
      `${TENANT}:${PROVIDER}`,
    ]);
  });

  it('invents no ceiling when none was wired', async () => {
    // A cap for a server that has none is 0090's own way of making a migration
    // mysteriously slow. No budget means the pass runs to the end.
    await seedItems(5);
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: targetOf(5, { sizeBytes: 10_000_000_000 }),
    });

    const result = await runConfirmationPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      domains: ['email'],
      readerFor: () => reader,
      ledger: store,
      runs,
    });

    expect(result.budgetPause).toBeUndefined();
    expect(await answeredCount()).toBe(5);
  });

  it('does not charge a round trip to a domain that cannot read bytes', async () => {
    // CalDAV and CardDAV implement no `contentHashFor` (§7d), so a calendar
    // pass spends nothing. Asking the meter per item to discover that would be
    // paying for a limit this domain cannot reach.
    await seedItems(4, 'calendar');
    const meter = meterOver(1_000_000);
    const reader = await readerOverTarget({
      domain: 'calendar',
      reindexer: targetOf(4, { canHash: false, domain: 'calendar' }),
      budget: { meter },
    });

    await runConfirmationPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      domains: ['calendar'],
      readerFor: () => reader,
      ledger: store,
      runs,
      meter,
    });

    expect(meter.stateReads()).toBe(0);
  });
});

describe('a confirmation that runs out of the day’s bytes', () => {
  /** Seven items, each a fifth of a ceiling that only fits four of them. */
  const runUntilEmpty = async (): ReturnType<typeof runConfirmationPass> => {
    await seedItems(7);
    const meter = meterOver(1_000);
    const reader = await readerOverTarget({
      domain: 'email',
      reindexer: targetOf(7, { sizeBytes: 250 }),
      budget: { meter },
    });
    return runConfirmationPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      domains: ['email'],
      readerFor: () => reader,
      ledger: store,
      runs,
      meter,
    });
  };

  it('stops, and leaves the rest UNASKED rather than recording them unchecked', async () => {
    // The rule this file exists for. Letting the loop run on would put a stored
    // answer on every remaining row — `unreachable`, which reads as `unchecked`
    // — about items the target was never asked about. A NULL answer is the
    // honest state for an item nobody looked at, and it is what the next pass
    // finds work to do in.
    const result = await runUntilEmpty();

    expect(result.budgetPause).toBeDefined();
    expect(await answeredCount()).toBe(4);
    expect(result.tally.total).toBe(4);
  });

  it('is not a failure: the run closes as succeeded', async () => {
    // 0090 T4's rule, unchanged: a scheduled stop is not an error. A red run on
    // the page of somebody whose account is fine and whose budget is merely
    // spent would be this slice's own way of lying about a healthy migration.
    const result = await runUntilEmpty();
    const row = await runRow(result.runId);
    expect(row.status).toBe('succeeded');
  });

  it('says so on the run row — the limit, what went, and when it resets', async () => {
    // D9's "visible". A person who pressed confirm and got half an account is
    // owed the reason next to the number, not a support conversation.
    const result = await runUntilEmpty();
    const row = await runRow(result.runId);
    const pause = row.stats.budgetPause as Record<string, unknown> | undefined;

    expect(pause).toMatchObject({
      provider: PROVIDER,
      ceilingBytes: 1_000,
      spentBytes: 1_000,
      windowResetsAt: '2026-09-11T04:00:00.000Z',
    });
  });

  it('stops taking new work in the domains after it, too', async () => {
    // The pause is set once and never cleared: a pass that moved on to the next
    // domain would spend a ceiling it has already been told is empty.
    await seedItems(4, 'email');
    await seedItems(4, 'file');
    const meter = meterOver(500);
    const readers = {
      email: await readerOverTarget({
        domain: 'email',
        reindexer: targetOf(4, { sizeBytes: 250 }),
        budget: { meter },
      }),
      file: await readerOverTarget({
        domain: 'file',
        reindexer: targetOf(4, { sizeBytes: 250, domain: 'file' }),
        budget: { meter },
      }),
    };

    const result = await runConfirmationPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      domains: ['email', 'file'],
      readerFor: (d) => (d === 'email' ? readers.email : readers.file),
      ledger: store,
      runs,
      meter,
    });

    expect(result.budgetPause).toBeDefined();
    // Two items of mail exhausted it; nothing in files was asked about.
    expect(meter.spent()).toBe(500);
    const files = await conn.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM item WHERE domain = 'file' AND confirmed_answer IS NOT NULL`,
    );
    expect(Number(files.rows[0]!.n)).toBe(0);
  });

  it('stops even a domain that would have cost nothing', async () => {
    // The decision this pins, because it could have gone the other way: a
    // calendar reads no bytes (§7d), so continuing it after the mail ran out
    // would be free. It still stops. "The pass stops taking new work" is one
    // rule, and a report that says PAUSED beside a domain that quietly finished
    // is a report somebody has to reason about — on the document they delete
    // their originals from. Everything after the pause is left for the next
    // pass, which is the promise the pause makes.
    await seedItems(2, 'email');
    await seedItems(3, 'calendar');
    const meter = meterOver(250);
    const readers = {
      email: await readerOverTarget({
        domain: 'email',
        reindexer: targetOf(2, { sizeBytes: 250 }),
        budget: { meter },
      }),
      calendar: await readerOverTarget({
        domain: 'calendar',
        reindexer: targetOf(3, { canHash: false, domain: 'calendar' }),
        budget: { meter },
      }),
    };

    const result = await runConfirmationPass({
      tenantId: TENANT,
      mappingId: MAPPING,
      domains: ['email', 'calendar'],
      readerFor: (d) => (d === 'email' ? readers.email : readers.calendar),
      ledger: store,
      runs,
      meter,
    });

    expect(result.budgetPause).toBeDefined();
    const cal = await conn.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM item WHERE domain = 'calendar' AND confirmed_answer IS NOT NULL`,
    );
    expect(Number(cal.rows[0]!.n)).toBe(0);
  });
});
