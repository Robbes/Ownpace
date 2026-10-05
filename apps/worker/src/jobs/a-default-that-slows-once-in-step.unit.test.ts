// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DEFAULT THAT SLOWS ONCE IN STEP, in the tick (workplan 0157 T7; the owner,
 * 2026-10-05: *"sync slow down once a migration is in step: yes"*).
 *
 * A migration with no schedule of its own runs the automatic cadence
 * (`automaticScheduleFor`, `sync-due.ts`, where its steps are tested): every
 * hour for 14 days from the later of its first copy and its last visit, then
 * every 6 hours, then daily from 30 days. Here, what the tick feeds it:
 *
 *  - the last visits are read only where they can change the step, so the
 *    tick asks for none while every migration is inside its first 14 days;
 *  - they are read by organisation and migration both (`VISITS_SQL`), on the
 *    managed table (managed 0042), apart from the tick's statement, which
 *    keeps to the core tables the tests above it run on;
 *  - a schedule somebody chose is used as written: only the absent one is
 *    automatic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPgliteDb, runMigrations, type LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

const HERE = dirname(fileURLToPath(import.meta.url));

// UUID family 0157d000-…, unused elsewhere in the repo.
const P = '0157d000-e29b-41d4-a716-4466554400';
const ORG_A = `${P}01`;
const ORG_B = `${P}02`;
const MAPPING_A = `${P}11`;
const MAPPING_B = `${P}12`;

const NOW = new Date('2026-10-05T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60_000);

type Tick = typeof import('./managed-sync-tick.ts');
let tick: Tick;
let driver: LedgerDriver;

async function query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const conn = await driver.acquire();
  try {
    return (await conn.query<R>(text, params)).rows;
  } finally {
    await conn.release();
  }
}

/** A row as the tick's statement returns it, with what this file varies. */
const row = (over: Partial<Parameters<Tick['visitsThatCount']>[0][number]>) => ({
  id: MAPPING_A,
  tenant_id: ORG_A,
  schedule: null,
  consecutive_failures: 0,
  any_self_healing: false,
  last_started: daysAgo(1),
  running: false,
  stale_since: null,
  first_copy_unfinished: false,
  first_copy_done_at: daysAgo(20),
  ...over,
});

beforeAll(async () => {
  // Importing the tick opens a Pool at import; it is never used here.
  process.env.SYSTEM_DATABASE_URL ??= 'postgres://unused:unused@localhost:5432/none';
  process.env.APP_DATABASE_URL ??= 'postgres://unused:unused@tick.test.invalid/none';
  tick = await import('./managed-sync-tick.ts');

  driver = (await createPgliteDb({})).driver;
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  for (const [org, mapping, n] of [
    [ORG_A, MAPPING_A, '1'],
    [ORG_B, MAPPING_B, '2'],
  ] as const) {
    await query(`INSERT INTO tenant (id, name) VALUES ($1, $2)`, [org, `visits ${n}`]);
    await query(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, status, config)
       VALUES ($1, $2, 'source', 'imap', 'fixture', 'connected', '{}'::jsonb)`,
      [`${P}2${n}`, org],
    );
    await query(
      `INSERT INTO mailbox (id, tenant_id, connection_id, external_id, primary_address)
       VALUES ($1, $2, $3, 'src', 'a@example.test')`,
      [`${P}3${n}`, org, `${P}2${n}`],
    );
    await query(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, mode, pattern)
       VALUES ($1, $2, $3, 'active', 'mirror', 'shared_s')`,
      [mapping, org, `${P}3${n}`],
    );
  }
  await query(`INSERT INTO migration_visit (mapping_id, tenant_id, visited_at) VALUES ($1, $2, $3)`, [
    MAPPING_A,
    ORG_A,
    daysAgo(2),
  ]);
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

describe('whose last visit the tick reads', () => {
  it('a migration on the automatic cadence, in step 14 days or more, or never finished a first copy', () => {
    expect(tick.visitsThatCount([row({})], NOW)).toHaveLength(1);
    expect(tick.visitsThatCount([row({ first_copy_done_at: daysAgo(14) })], NOW)).toHaveLength(1);
    expect(tick.visitsThatCount([row({ first_copy_done_at: null })], NOW)).toHaveLength(1);
  });

  it('none inside the first 14 days, when it looks every hour whatever the visits', () => {
    expect(tick.visitsThatCount([row({ first_copy_done_at: daysAgo(13) })], NOW)).toEqual([]);
  });

  it('none for a schedule somebody chose, a first copy still running, or a pass running now', () => {
    expect(tick.visitsThatCount([row({ schedule: '0 2 * * *' })], NOW)).toEqual([]);
    expect(tick.visitsThatCount([row({ first_copy_unfinished: true })], NOW)).toEqual([]);
    expect(tick.visitsThatCount([row({ running: true })], NOW)).toEqual([]);
  });
});

describe('the visits, read by organisation and migration both', () => {
  it('reads the visit of a migration asked for with its own organisation', async () => {
    const rows = await query<{ mapping_id: string; visited_at: Date }>(tick.VISITS_SQL, [[ORG_A], [MAPPING_A]]);
    expect(rows.map((r) => r.mapping_id)).toEqual([MAPPING_A]);
    expect(new Date(rows[0]!.visited_at).toISOString()).toBe(daysAgo(2).toISOString());
  });

  it('nothing for a migration asked for under another organisation, nor one never visited', async () => {
    expect(await query(tick.VISITS_SQL, [[ORG_B], [MAPPING_A]])).toEqual([]);
    expect(await query(tick.VISITS_SQL, [[ORG_B], [MAPPING_B]])).toEqual([]);
  });
});

describe('the cadence the tick runs', () => {
  const whole = readFileSync(join(HERE, 'managed-sync-tick.ts'), 'utf8');

  it('runs a chosen schedule as written, and the automatic cadence only where there is none', () => {
    expect(whole).toContain('const schedule =\n        m.schedule ??\n        automaticScheduleFor(');
    expect(whole).toContain(
      'automaticSince(m.first_copy_unfinished, m.first_copy_done_at, visitedAt.get(m.id) ?? null)',
    );
  });

  it("keeps the visits out of the tick's statement, which runs on the core tables alone", () => {
    expect(tick.ACTIVE_MAPPINGS_SQL).not.toContain('migration_visit');
  });
});
