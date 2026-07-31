// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * What does PGlite's serialisation actually cost? (workplan 0016 P5)
 *
 *   node --experimental-strip-types scripts/bench-pglite-concurrency.mjs
 *   pnpm bench:pglite
 *
 * PGlite has ONE connection, so `withTenant` serialises on it (see
 * `packages/ledger/src/driver.ts` — that is a correctness requirement, not a
 * tuning choice). The sync path runs at concurrency 8. The open question this
 * answers: does serialising the ledger actually cost anything at that width?
 *
 * ## What it measures, and what it deliberately does not
 *
 * It runs the REAL ledger hot path — `find()` by natural key, then
 * `recordIfAbsent()` — inside the REAL `withTenant`, against the REAL schema.
 * That pair is what `runShadowPass` does per item, and it is the only database
 * work in the loop.
 *
 * It does **not** simulate the network. That is the point: the comparison worth
 * making is ledger-time against the per-item cost of actually fetching a
 * message, which is measured in tens to hundreds of milliseconds. The script
 * prints ledger-time per item so that comparison can be made honestly rather
 * than asserted.
 *
 * The T0 spike quoted ~1700 rows/s from 5,000 synthetic single-statement
 * inserts. This is a stricter measure: two statements per item, both through
 * drizzle, both inside a transaction that sets `app.current_tenant`.
 *
 * **Still not a real corpus.** A real mailbox has variable item sizes, cold
 * caches and a source that pushes back. This bounds the ledger's contribution;
 * it does not predict a migration.
 *
 * ## One methodological note, because it changed the answer
 *
 * Each width gets a FRESH database. The first version of this script reused
 * one, so every width queried a table the previous widths had grown — and it
 * reported concurrency costing +29% when most of that was simply a bigger
 * table. Isolating them costs ~4 s of migration per width and is the difference
 * between measuring what the flag says and measuring something else.
 */

import { randomUUID } from 'node:crypto';
import { pgliteDriver, runMigrations, withTenant, PgLedger } from '@openmig/ledger';

const ITEMS = Number(process.env.BENCH_ITEMS ?? 2000);
const WIDTHS = (process.env.BENCH_WIDTHS ?? '1,4,8,16').split(',').map(Number);

const TENANT = '00000000-0000-4000-8000-00000000bbbb';
const MAPPING = '11111111-1111-4111-8111-11111111bbbb';

/** Bounded-concurrency map, mirroring the sync path's own `mapWithConcurrency`. */
async function mapWithConcurrency(items, width, worker) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}

async function seed(driver) {
  const conn = await driver.acquire();
  try {
    // The FK chain the item table needs. Inserted as the owner, outside any
    // tenant context — RLS does not apply to a superuser, which is what makes
    // this setup possible at all.
    await conn.query(`INSERT INTO tenant (id, name) VALUES ($1, 'bench') ON CONFLICT DO NOTHING`, [
      TENANT,
    ]);
    const connId = randomUUID();
    const srcBox = randomUUID();
    const dstBox = randomUUID();
    await conn.query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','imap','bench','{}'::jsonb,'connected') ON CONFLICT DO NOTHING`,
      [connId, TENANT],
    );
    for (const [id, role] of [
      [srcBox, 'src'],
      [dstBox, 'dst'],
    ]) {
      await conn.query(
        `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name, status)
         VALUES ($1,$2,$3,$4,'user',$4,$4,'active') ON CONFLICT DO NOTHING`,
        [id, TENANT, connId, `${role}@bench.local`],
      );
    }
    await conn.query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status)
       VALUES ($1,$2,$3,$4,'mirror','active') ON CONFLICT DO NOTHING`,
      [MAPPING, TENANT, srcBox, dstBox],
    );
  } finally {
    conn.release();
  }
}

/** One item's worth of ledger work: the idempotency lookup, then the write. */
async function oneItem(driver, n, pass) {
  await withTenant(driver, TENANT, async (db) => {
    const ledger = new PgLedger(db);
    const hash = `bench-${pass}-${n}`.padEnd(64, '0');
    // The fast path: if the item is already recorded, the pass does nothing
    // more. On a re-run this is ALL that happens per item, which is why it is
    // measured separately below.
    const existing = await ledger.find(TENANT, MAPPING, 'email', hash);
    if (existing) return;
    await ledger.recordIfAbsent({
      tenantId: TENANT,
      mappingId: MAPPING,
      itemType: 'email',
      naturalKeyHash: hash,
      contentHash: `c${n}`,
      targetId: `t${n}`,
      createdAt: new Date(0).toISOString(),
      sizeBytes: 4096,
      collection: 'INBOX',
    });
  });
}

async function timed(label, fn) {
  const t0 = process.hrtime.bigint();
  await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { label, ms };
}

async function main() {
  console.log(`PGlite concurrency bench — ${ITEMS} items per width, widths ${WIDTHS.join(', ')}`);
  console.log('(fresh database per width, so the table size is identical each time)\n');

  const rows = [];
  for (const width of WIDTHS) {
    // Fresh per width. See the methodological note above — sharing one database
    // measured table growth as if it were concurrency cost.
    const driver = pgliteDriver(); // in-memory: measures the database, not the disk
    await runMigrations({ driver, logger: () => {} });
    await seed(driver);

    const idx = Array.from({ length: ITEMS }, (_, i) => i);

    const write = await timed(`w=${width} first pass`, () =>
      mapWithConcurrency(idx, width, (n) => oneItem(driver, n, `w${width}`)),
    );
    // The steady state: every item already recorded, so each is a lookup that
    // finds a row and returns. This is what a shadow sync does on every pass
    // after the first, and it is the number that matters for a long migration.
    const reread = await timed(`w=${width} re-run`, () =>
      mapWithConcurrency(idx, width, (n) => oneItem(driver, n, `w${width}`)),
    );

    rows.push({
      width,
      writeMs: write.ms,
      writePerItem: write.ms / ITEMS,
      writeRate: (ITEMS / write.ms) * 1000,
      rereadPerItem: reread.ms / ITEMS,
      rereadRate: (ITEMS / reread.ms) * 1000,
    });
    await driver.end();
  }

  console.log(
    ['width', 'first pass/item', 'items/s', 're-run/item', 'items/s'].map((h) => h.padEnd(16)).join(''),
  );
  for (const r of rows) {
    console.log(
      [
        String(r.width),
        `${r.writePerItem.toFixed(3)} ms`,
        r.writeRate.toFixed(0),
        `${r.rereadPerItem.toFixed(3)} ms`,
        r.rereadRate.toFixed(0),
      ]
        .map((c) => c.padEnd(16))
        .join(''),
    );
  }

  const one = rows.find((r) => r.width === 1);
  const eight = rows.find((r) => r.width === 8);
  if (one && eight) {
    // The question P5 actually asks. Serialised, extra concurrency cannot make
    // the database faster — so the honest test is whether it makes it WORSE.
    const delta = ((eight.writePerItem - one.writePerItem) / one.writePerItem) * 100;
    console.log(
      `\nConcurrency 8 vs 1: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% per-item ledger time.`,
    );
    console.log(
      `A 48k-message mailbox: ~${((eight.writePerItem * 48000) / 1000).toFixed(0)} s of ledger time,\n` +
        `against ~${((0.05 * 48000) / 60).toFixed(0)} min of network time at a conservative 50 ms/message fetch.`,
    );
  }

}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
