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
 * ## And a third column: whether its first copy is finished (workplan 0156 T5)
 *
 * The owner, 2026-10-03: a daily schedule is right *"after all sync was done
 * ... but not for the initial bulk"*. So a migration whose first copy is
 * unfinished runs at the floor whatever its schedule, and the tick reads that
 * fact here (`first_copy_unfinished`). It is the same kind of column as the two
 * above: wrong, it throws nothing. Read as unfinished when it is not, a
 * migration with nothing left but failed items runs four passes an hour for
 * ever; read as finished when it is not, a first copy waits a day between
 * 50-minute passes, which is what the owner asked to end. So it is asked of
 * real rows too, in the last block below: the cases the rule names, and the
 * ones it must not catch.
 *
 * Importing the tick has side effects (a Pool at import), so SYSTEM_DATABASE_URL is
 * set before a dynamic import — the same shape as the two tests beside it.
 */

import { readFile } from 'node:fs/promises';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pgliteDriver, runMigrations, type LedgerDriver, type LedgerConnection } from '@openmig/ledger';
import { BILLABLE_RUN_KINDS } from '@openmig/managed';
import { PASS_RUNNING_STATES, UNREAD_NOTE_PREFIX } from '@openmig/shared';
import {
  FAILURE_WINDOW_MINUTES,
  SELF_HEALING_CATEGORIES,
  heldBackByFailures,
} from '@openmig/orchestration/failing-backoff';
import { isSyncDue } from '@openmig/orchestration/sync-due';

// UUID family 5a8b0000-…15xx, unused elsewhere in the repo.
const TENANT = '5a8b0000-e29b-41d4-a716-446655441501';
const SOURCE_MAILBOX = '5a8b0000-e29b-41d4-a716-446655441511';
const TARGET_MAILBOX = '5a8b0000-e29b-41d4-a716-446655441512';
const CONNECTION = '5a8b0000-e29b-41d4-a716-446655441521';
const MAPPING = '5a8b0000-e29b-41d4-a716-446655441531';

interface Row {
  readonly consecutive_failures: string | number;
  readonly any_self_healing: boolean;
  readonly last_started: Date | null;
  readonly first_copy_unfinished: boolean;
}

let driver: LedgerDriver;
let conn: LedgerConnection;
let ACTIVE_MAPPINGS_SQL: string;
let STALE_RUN_AFTER_MS: number;

/** The tick's own parameters. */
const tickParameters = () => [
  STALE_RUN_AFTER_MS,
  [...SELF_HEALING_CATEGORIES],
  FAILURE_WINDOW_MINUTES,
  [...BILLABLE_RUN_KINDS],
  // The lifecycles whose passes run — `$5` since 0117 T1 gave the product a
  // second one. Read from the shared list rather than written out here, for
  // the same reason as the four above it.
  [...PASS_RUNNING_STATES],
  // How a note about a collection the source would not list begins: `$6`
  // since 0156 T5, which reads it to tell that wait from a first copy.
  UNREAD_NOTE_PREFIX,
];

/** The tick's own query, with the tick's own parameters. */
async function ask(): Promise<Row> {
  const { rows } = await conn.query<Row>(ACTIVE_MAPPINGS_SQL, tickParameters());
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
  process.env.SYSTEM_DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/none';
  // And the pass it triggers, run-delta-sync, opens its pools at import through
  // openTaskPools, which refuses without APP_DATABASE_URL (0138 T1).
  process.env.APP_DATABASE_URL ??= 'postgres://unused:unused@tick.test.invalid/none';
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

describe('a grant the person took back (0108 T8 (c))', () => {
  it('is not picked up for a pass, and is again once somebody grants', async () => {
    const picked = async () =>
      (await conn.query<{ id: string }>(ACTIVE_MAPPINGS_SQL, tickParameters())).rows.map((r) => r.id);
    await conn.query(`UPDATE mailbox_mapping SET grant_withdrawn_at = now() WHERE id = $1`, [MAPPING]);
    try {
      // Still 'active': the lifecycle is the owner's, and the withdrawal is
      // not a status. Nothing reads the account all the same.
      expect(await picked()).toEqual([]);
    } finally {
      await conn.query(`UPDATE mailbox_mapping SET grant_withdrawn_at = NULL WHERE id = $1`, [MAPPING]);
    }
    expect(await picked()).toEqual([MAPPING]);
  });
});

describe('whether its first copy is finished (0156 T5)', () => {
  /** The schedule a migration gets when nobody picks one: the wizard's daily 02:00. */
  const DAILY = '0 2 * * *';

  /** Each case starts from mail only: selected, in progress, never completed, no pass running. */
  async function reset(): Promise<void> {
    await clearRuns();
    await conn.query(`DELETE FROM item WHERE mapping_id = $1`, [MAPPING]);
    await conn.query(`DELETE FROM path_lifecycle WHERE mapping_id = $1`, [MAPPING]);
    await conn.query(`DELETE FROM scope_selection WHERE mapping_id = $1`, [MAPPING]);
    await conn.query(`DELETE FROM migration_status WHERE mapping_id = $1 AND domain <> 'email'`, [MAPPING]);
    await conn.query(
      `UPDATE migration_status
          SET state = 'in_progress', completed_at = NULL, paused_reason = NULL,
              last_error = NULL, last_error_category = NULL
        WHERE mapping_id = $1`,
      [MAPPING],
    );
    await conn.query(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [MAPPING]);
    await selected('email');
  }

  async function selected(domain: string, included = true): Promise<void> {
    await conn.query(
      `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mapping_id, domain) DO UPDATE SET included = EXCLUDED.included`,
      [TENANT, MAPPING, domain, included],
    );
  }

  /** What `markCompleted` writes: the one writer of `completed_at`. */
  async function completed(domain = 'email'): Promise<void> {
    await conn.query(
      `UPDATE migration_status SET state = 'completed', completed_at = now()
        WHERE mapping_id = $1 AND domain = $2`,
      [MAPPING, domain],
    );
  }

  /** A data type's own path row, as the doors write it. */
  async function path(domain: string, state: string, stopped = false): Promise<void> {
    await conn.query(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, stopped_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() END)`,
      [TENANT, MAPPING, domain, state, stopped],
    );
  }

  async function unfinished(): Promise<boolean> {
    return (await ask()).first_copy_unfinished;
  }

  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await conn.query(`DELETE FROM scope_selection WHERE mapping_id = $1`, [MAPPING]);
  });

  it('is unfinished for a first copy its deadline stopped, and the tick runs it at the floor on a daily schedule', async () => {
    // What `run-delta-sync.ts` leaves after a pass that stopped at its 50
    // minutes: the row back at `in_progress`, no `completed_at`, no pause
    // reason (a deadline is not a ceiling), and the run closed as succeeded.
    await run('succeeded', 52);
    const row = await ask();
    expect(row.first_copy_unfinished).toBe(true);
    // The decision on that answer, at the tick's now: daily at 02:00 would
    // wait for tomorrow; a first copy goes again now that a quarter of an hour
    // has passed since its last pass started.
    const now = new Date();
    const facts = { firstCopyUnfinished: row.first_copy_unfinished };
    expect(isSyncDue(DAILY, row.last_started, now, facts)).toBe(true);
    // ...and not inside the floor.
    await clearRuns();
    await run('succeeded', 10);
    const soon = await ask();
    expect(isSyncDue(DAILY, soon.last_started, now, { firstCopyUnfinished: soon.first_copy_unfinished })).toBe(false);
  });

  it('is unfinished for a data type no pass has reached yet, with no status row at all', async () => {
    await conn.query(`DELETE FROM migration_status WHERE mapping_id = $1`, [MAPPING]);
    try {
      expect(await unfinished()).toBe(true);
    } finally {
      await conn.query(
        `INSERT INTO migration_status (tenant_id, mapping_id, domain, state)
         VALUES ($1, $2, 'email', 'in_progress')`,
        [TENANT, MAPPING],
      );
    }
  });

  it('is finished once every data type has completed a pass, and stays so through a later pass the deadline stops', async () => {
    await completed();
    expect(await unfinished()).toBe(false);
    // A later pass begins (`markInProgress`) and stops at its deadline: the
    // state goes back, the completion does not. The schedule decides again.
    await conn.query(`UPDATE migration_status SET state = 'in_progress' WHERE mapping_id = $1`, [MAPPING]);
    expect(await unfinished()).toBe(false);
    await run('succeeded', 52);
    const row = await ask();
    expect(isSyncDue(DAILY, row.last_started, new Date(), { firstCopyUnfinished: row.first_copy_unfinished })).toBe(
      // Due only if 02:00 fell inside the last 52 minutes; never by the floor.
      isSyncDue(DAILY, row.last_started, new Date()),
    );
  });

  it('is finished with only failed items left: they are parked, and the pass that parked them completed', async () => {
    // The owner's condition: a migration whose only open work is items that
    // will not copy must not run four passes an hour for ever.
    for (const n of [1, 2, 3]) {
      await conn.query(
        `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status, attempt_count, last_error)
         VALUES ($1, $2, 'email', 'INBOX', $3, $4, 'failed', 5, 'the target refused it')`,
        [TENANT, MAPPING, `parked-${n}`, `parked-hash-${n}`],
      );
    }
    await completed();
    expect(await unfinished()).toBe(false);
  });

  it('is unfinished again for a data type added to a finished migration, until it has been copied once', async () => {
    await completed();
    await selected('calendar');
    // Added a moment ago: no pass has written its status row yet.
    expect(await unfinished()).toBe(true);
    await conn.query(
      `INSERT INTO migration_status (tenant_id, mapping_id, domain, state)
       VALUES ($1, $2, 'calendar', 'in_progress')`,
      [TENANT, MAPPING],
    );
    expect(await unfinished()).toBe(true);
    await completed('calendar');
    expect(await unfinished()).toBe(false);
  });

  it('is never asked of a paused migration: it is not enumerated at all, and its pause holds', async () => {
    const picked = async () =>
      (await conn.query<{ id: string }>(ACTIVE_MAPPINGS_SQL, tickParameters())).rows.map((r) => r.id);
    await conn.query(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [MAPPING]);
    expect(await picked()).toEqual([]);
    await conn.query(`UPDATE mailbox_mapping SET status = 'active' WHERE id = $1`, [MAPPING]);
    expect(await picked()).toEqual([MAPPING]);
  });

  it('counts only the data types its pass copies', async () => {
    // Mail is finished; a second data type decides each answer below.
    await completed();
    // Not selected, or switched off: not this migration's copy.
    await selected('calendar', false);
    expect(await unfinished()).toBe(false);
    await selected('calendar');
    expect(await unfinished()).toBe(true);
    // Stopped by its owner (0128 T4): its pass is passed over, so no pass
    // a quarter hour later would copy it either.
    await path('calendar', 'active', true);
    expect(await unfinished()).toBe(false);
    await conn.query(`DELETE FROM path_lifecycle WHERE mapping_id = $1 AND domain = 'calendar'`, [MAPPING]);
    // Waiting to be started (a `ready` row, photos waiting for a Takeout
    // export): the stages' *Not started*, which no pass copies yet.
    await path('calendar', 'ready');
    expect(await unfinished()).toBe(false);
    await conn.query(`UPDATE path_lifecycle SET state = 'active' WHERE mapping_id = $1 AND domain = 'calendar'`, [
      MAPPING,
    ]);
    expect(await unfinished()).toBe(true);
    // In its cutover: the grace period copies on the schedule, as before.
    await conn.query(`UPDATE path_lifecycle SET state = 'cutover' WHERE mapping_id = $1 AND domain = 'calendar'`, [
      MAPPING,
    ]);
    expect(await unfinished()).toBe(false);
  });

  it("waits out a provider's daily ceiling until its window resets, and not a minute longer", async () => {
    const ceiling = async (windowResetsAt: string | null) =>
      conn.query(
        `UPDATE migration_status SET paused_reason = $2::jsonb WHERE mapping_id = $1 AND domain = 'email'`,
        [MAPPING, JSON.stringify({ kind: 'daily-download-ceiling', provider: 'imap.gmail.com', windowResetsAt })],
      );
    await ceiling(new Date(Date.now() + 3 * 60 * 60_000).toISOString());
    expect(await unfinished()).toBe(false);
    await ceiling(new Date(Date.now() - 60_000).toISOString());
    expect(await unfinished()).toBe(true);
    // A window the meter could not read waits for the schedule's next pass,
    // rather than have a time invented for it.
    await ceiling(null);
    expect(await unfinished()).toBe(false);
    // A value some other build wrote is a wait, not a cast that fails the
    // tick for every organisation.
    await ceiling('later today');
    expect(await unfinished()).toBe(false);
  });

  it('does not run at the floor for a collection the source would not list, which no pass sooner would read', async () => {
    await conn.query(
      `UPDATE migration_status SET last_error = $2, last_error_category = 'source_refused'
        WHERE mapping_id = $1 AND domain = 'email'`,
      [MAPPING, `${UNREAD_NOTE_PREFIX}1 folder. The source answered: 403 Forbidden.`],
    );
    expect(await unfinished()).toBe(false);
    // A real failure's line left on the row by an earlier pass is not that
    // note: a first copy the deadline stopped after it is still unfinished.
    await conn.query(
      `UPDATE migration_status SET last_error = 'ECONNRESET', last_error_category = 'network'
        WHERE mapping_id = $1 AND domain = 'email'`,
      [MAPPING],
    );
    expect(await unfinished()).toBe(true);
  });

  it('still counts a data type whose pass failed, and the back-off still holds it after the floor says due', async () => {
    // A pass that threw fails the run, so the ladder spaces the next tries
    // (`failing-backoff.ts`); the floor does not undo that.
    await conn.query(
      `UPDATE migration_status SET state = 'failed', last_error = 'invalid credentials', last_error_category = 'auth_expired'
        WHERE mapping_id = $1 AND domain = 'email'`,
      [MAPPING],
    );
    for (const minutesAgo of [80, 60, 40]) await run('failed', minutesAgo);
    const row = await ask();
    expect(row.first_copy_unfinished).toBe(true);
    const now = new Date();
    expect(isSyncDue(DAILY, row.last_started, now, { firstCopyUnfinished: row.first_copy_unfinished })).toBe(true);
    expect(
      heldBackByFailures(
        {
          consecutiveFailures: Number(row.consecutive_failures),
          anySelfHealing: row.any_self_healing,
          lastStartedAt: row.last_started,
        },
        now,
      ),
    ).toBe(true);
  });
});
