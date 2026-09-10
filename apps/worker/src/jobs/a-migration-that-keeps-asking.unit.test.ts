// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE TWO COLUMNS THE BACK-OFF DECIDES ON, ASKED OF A REAL DATABASE
 * (2026-09-08).
 *
 * `failing-backoff.ts` holds the ladder and is tested on its own — pure
 * arithmetic over a `FailingState`. What CANNOT be tested there is whether the
 * tick's SQL puts the right numbers into that state, and that half is where
 * the defect would be silent: a mapping wrongly read as failing is slowed for
 * no reason, and one wrongly read as healthy keeps the 96-passes-a-day
 * behaviour this feature exists to stop. Neither throws.
 *
 * Executed rather than read (unlike `a-run-row-that-outlived-its-pass`, which
 * reads two clauses it can check by eye) because these are aggregates over
 * history with a time bound, and the only honest way to know what
 * `count(*) … > COALESCE(max(…), '-infinity')` returns is to ask Postgres.
 * PGlite is real Postgres compiled to WASM, running the same migration chain —
 * no container, unit tier.
 *
 * ## The bound is the thing
 *
 * "Failures since the last success" without a time bound is a scan back to the
 * beginning of history for a mapping that has never succeeded — which is
 * precisely the mapping this feature is about. It would grow, once a minute,
 * for ever: the pathology migration 0023 was written to remove. So the count
 * is bounded by `FAILURE_WINDOW_MINUTES`, and the last case here proves the
 * bound holds rather than trusting the interval literal to be in the right
 * place.
 *
 * Importing the tick has side effects (a Pool at import), so DATABASE_URL is
 * set before a dynamic import — the same shape as the two tests beside it.
 */

import { readFile } from 'node:fs/promises';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, type LedgerDriver, type LedgerConnection } from '@openmig/ledger';
import { BILLABLE_RUN_KINDS } from '@openmig/managed';
import { PASS_RUNNING_STATES } from '@openmig/shared';
import {
  FAILURE_WINDOW_MINUTES,
  SELF_HEALING_CATEGORIES,
} from '@openmig/orchestration/failing-backoff';

// UUID family 5a8b0000-…15xx, unused elsewhere in the repo.
const TENANT = '5a8b0000-e29b-41d4-a716-446655441501';
const SOURCE_MAILBOX = '5a8b0000-e29b-41d4-a716-446655441511';
const TARGET_MAILBOX = '5a8b0000-e29b-41d4-a716-446655441512';
const CONNECTION = '5a8b0000-e29b-41d4-a716-446655441521';
const MAPPING = '5a8b0000-e29b-41d4-a716-446655441531';

interface Row {
  readonly consecutive_failures: string | number;
  readonly any_self_healing: boolean;
}

let driver: LedgerDriver;
let conn: LedgerConnection;
let ACTIVE_MAPPINGS_SQL: string;
let STALE_RUN_AFTER_MS: number;

/** The tick's own query, with the tick's own parameters. */
async function ask(): Promise<Row> {
  const { rows } = await conn.query<Row>(ACTIVE_MAPPINGS_SQL, [
    STALE_RUN_AFTER_MS,
    [...SELF_HEALING_CATEGORIES],
    FAILURE_WINDOW_MINUTES,
    [...BILLABLE_RUN_KINDS],
    // The lifecycles whose passes run — `$5` since 0117 T1 gave the product a
    // second one. Read from the shared list rather than written out here, for
    // the same reason as the four above it.
    [...PASS_RUNNING_STATES],
  ]);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** A finished pass that started `minutesAgo`. */
async function run(
  status: 'succeeded' | 'failed',
  minutesAgo: number,
  kind = 'incremental',
): Promise<void> {
  await conn.query(
    `INSERT INTO run (tenant_id, mapping_id, kind, status, started_at, finished_at, created_at)
     SELECT $1, $2, $5, $3, s, s, s
       FROM (SELECT now() - ($4::int * interval '1 minute') AS s) t`,
    [TENANT, MAPPING, status, minutesAgo, kind],
  );
}

async function clearRuns(): Promise<void> {
  await conn.query(`DELETE FROM run WHERE mapping_id = $1`, [MAPPING]);
}

/** What the mapping's one domain last failed for, or nothing. */
async function lastErrorCategory(category: string | null): Promise<void> {
  await conn.query(
    `UPDATE migration_status SET last_error_category = $2 WHERE mapping_id = $1`,
    [MAPPING, category],
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/none';
  const mod = await import('./managed-sync-tick.ts');
  ACTIVE_MAPPINGS_SQL = mod.ACTIVE_MAPPINGS_SQL;
  STALE_RUN_AFTER_MS = mod.STALE_RUN_AFTER_MS;

  driver = pgliteDriver({});
  await runMigrations({ driver, logger: () => {} });
  conn = await driver.acquire();

  await conn.query(`INSERT INTO tenant (id, name, status) VALUES ($1, 'backoff', 'active')`, [
    TENANT,
  ]);
  await conn.query(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
     VALUES ($1, $2, 'source', 'imap', 'fixture', 'connected', '{}'::jsonb)`,
    [CONNECTION, TENANT],
  );
  for (const [id, ext] of [
    [SOURCE_MAILBOX, 'src'],
    [TARGET_MAILBOX, 'dst'],
  ] as const) {
    await conn.query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
       VALUES ($1, $2, $3, $4, 'a@example.test')`,
      [id, TENANT, CONNECTION, ext],
    );
  }
  await conn.query(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, mode, pattern)
     VALUES ($1, $2, $3, $4, 'active', 'mirror', 'shared_s')`,
    [MAPPING, TENANT, SOURCE_MAILBOX, TARGET_MAILBOX],
  );
  await conn.query(
    `INSERT INTO migration_status (tenant_id, mapping_id, domain, state)
     VALUES ($1, $2, 'email', 'in_progress')`,
    [TENANT, MAPPING],
  );
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('how many passes have failed since the last one worked', () => {
  it('is zero for a mapping that has never run', async () => {
    await clearRuns();
    expect(Number((await ask()).consecutive_failures)).toBe(0);
  });

  it('counts the failures', async () => {
    await clearRuns();
    for (const minutesAgo of [45, 30, 15]) await run('failed', minutesAgo);
    expect(Number((await ask()).consecutive_failures)).toBe(3);
  });

  it('counts only the ones since the last success', async () => {
    // The reset that makes the whole shape self-healing: a credential fixed at
    // any point puts the mapping back on its own cadence at the next pass,
    // with nobody pressing anything.
    await clearRuns();
    for (const minutesAgo of [90, 75, 60]) await run('failed', minutesAgo);
    await run('succeeded', 45);
    for (const minutesAgo of [30, 15]) await run('failed', minutesAgo);
    expect(Number((await ask()).consecutive_failures)).toBe(2);
  });

  it('is zero when the last pass succeeded, however much came before it', async () => {
    await clearRuns();
    for (const minutesAgo of [90, 75, 60, 45, 30]) await run('failed', minutesAgo);
    await run('succeeded', 15);
    expect(Number((await ask()).consecutive_failures)).toBe(0);
  });

  it('ignores a pass that is still running', async () => {
    // An open row is neither a failure nor a success. Counting it either way
    // would move a mapping up or down a rung on the strength of a pass whose
    // outcome nobody knows yet.
    await clearRuns();
    for (const minutesAgo of [45, 30]) await run('failed', minutesAgo);
    await conn.query(
      `INSERT INTO run (tenant_id, mapping_id, kind, status, started_at)
       VALUES ($1, $2, 'incremental', 'running', now())`,
      [TENANT, MAPPING],
    );
    expect(Number((await ask()).consecutive_failures)).toBe(2);
    await clearRuns();
  });

  it('forgets failures older than the window, so the scan cannot grow with history', async () => {
    // THE BOUND. Without it this count reads every run a never-succeeding
    // mapping ever produced, once a minute, for ever — migration 0023's
    // pathology, reintroduced by the feature meant to stop the waste.
    await clearRuns();
    await run('failed', FAILURE_WINDOW_MINUTES + 60);
    await run('failed', FAILURE_WINDOW_MINUTES + 30);
    await run('failed', 30);
    expect(Number((await ask()).consecutive_failures)).toBe(1);
  });

  it('counts only the passes that move data, not every kind of run', async () => {
    // A failed discovery or verify is a real failure and belongs on the
    // customer's screen. It is not evidence that COPYING is broken, and
    // counting it would hold back the first sync of a mapping whose discovery
    // failed a dozen times before somebody fixed the credential.
    await clearRuns();
    for (const kind of ['discovery', 'verify', 'cutover', 'backup']) {
      for (const minutesAgo of [60, 45, 30]) await run('failed', minutesAgo, kind);
    }
    expect(Number((await ask()).consecutive_failures)).toBe(0);
    for (const kind of BILLABLE_RUN_KINDS) await run('failed', 15, kind);
    expect(Number((await ask()).consecutive_failures)).toBe(BILLABLE_RUN_KINDS.length);
  });

  it('is not reset by a success of a kind that proves nothing about copying', async () => {
    // The mirror of the case above. A verify that passed says the target
    // matches what was copied SO FAR; it does not say the next pass will get
    // further, so it must not put a stuck mapping back on full cadence.
    await clearRuns();
    for (const minutesAgo of [90, 75, 60]) await run('failed', minutesAgo);
    await run('succeeded', 45, 'verify');
    expect(Number((await ask()).consecutive_failures)).toBe(3);
  });

  it('reads a success older than the window as no success at all', async () => {
    // What the bound COSTS, stated rather than discovered: a mapping that last
    // worked over a week ago is failing, so the two answers agree wherever the
    // ladder can tell them apart.
    await clearRuns();
    await run('succeeded', FAILURE_WINDOW_MINUTES + 60);
    for (const minutesAgo of [45, 30, 15]) await run('failed', minutesAgo);
    expect(Number((await ask()).consecutive_failures)).toBe(3);
  });
});

describe('the tick actually applies it', () => {
  // Read rather than executed: running the tick needs the trigger platform,
  // and what can go wrong here is not an exception. Every assertion above
  // would still pass with `failing-backoff.ts` imported by nobody — a feature
  // that is fully tested and entirely dead.
  let source: string;

  beforeAll(async () => {
    source = await readFile(new URL('./managed-sync-tick.ts', import.meta.url), 'utf8');
  });

  it('asks the back-off before enqueueing', () => {
    expect(source).toContain('heldBackByFailures(');
  });

  it('asks it AFTER the schedule, and BEFORE the mapping joins the due list', () => {
    // Order is the whole of it. After `due.push` the call changes nothing, and
    // that is a defect no assertion on the ladder or the SQL can see.
    const notDue = source.indexOf('notDue++');
    const heldBack = source.indexOf('heldBackByFailures(');
    const push = source.indexOf('due.push(m)');
    expect(notDue).toBeGreaterThan(-1);
    expect(heldBack).toBeGreaterThan(notDue);
    expect(push).toBeGreaterThan(heldBack);
  });

  it('says so when it holds one back', () => {
    // A mapping quietly attempted less often is exactly the kind of thing
    // nobody finds later. The count and the gap are both in the line, so the
    // reader can tell a held-back mapping from a broken tick.
    expect(source).toMatch(/log\.info\(\s*`\[sync-tick\] mapping \$\{m\.id\}: due, but held back/);
    expect(source).toContain('minGapMinutes(failing)');
  });

  it('reports the count in the tick summary', () => {
    expect(source).toMatch(/^\s+heldBack,$/m);
  });
});

describe('whether the cause clears by itself', () => {
  it('is false when nothing has failed', async () => {
    await lastErrorCategory(null);
    expect((await ask()).any_self_healing).toBe(false);
  });

  it('is true for a cause that resumes on its own', async () => {
    for (const category of SELF_HEALING_CATEGORIES) {
      await lastErrorCategory(category);
      expect((await ask()).any_self_healing).toBe(true);
    }
  });

  it('is false for a cause that needs a person', async () => {
    // The one this feature is for: a rotated key makes every pass fail at the
    // credential, and nothing clears it but somebody reconnecting.
    for (const category of ['auth_expired', 'target_refused', 'unknown']) {
      await lastErrorCategory(category);
      expect((await ask()).any_self_healing).toBe(false);
    }
    await lastErrorCategory(null);
  });
});
