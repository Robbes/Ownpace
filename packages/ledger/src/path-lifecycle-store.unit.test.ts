// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A lifecycle per PATH, against a real database (workplan 0109 T1).
 *
 * What is worth pinning here is not that rows can be written — it is the three
 * rules an invoice will be reconstructed from months later, each of which is
 * easy to get subtly wrong and impossible to notice afterwards:
 *
 *  1. **Absent means `ready`.** A path that has never run has no row, and every
 *     read has to answer for it. Reading absence as anything else would
 *     over-bill somebody for a path they configured and left alone.
 *  2. **`paused` holds a slot.** ADR-0014 is explicit and counter-intuitive:
 *     pausing does not reduce a bill, finishing does. A calculator that
 *     "helpfully" freed the slot would undercharge silently.
 *  3. **`first_activated_at` is stamped once.** A path paused and resumed has
 *     not started again, and an invoice needs the original date.
 *
 * PGlite as `app_user`, through the real migrations, so RLS and the CHECKs are
 * the product's rather than a fixture's.
 *
 * UUID family 5f5d0000-…, unused elsewhere in the repo.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgliteDriver, runMigrations, withTenant } from './index.ts';
import type { LedgerDriver } from './index.ts';
import {
  PATH_STATES,
  PgPathLifecycleStore,
  SLOTLESS_STATES,
  SLOT_HOLDING_STATES,
  holdsASlot,
} from './path-lifecycle-store.ts';
import type { MappingId, TenantId } from '@openmig/shared';

const TENANT = '5f5d0000-e29b-41d4-a716-446655442201' as TenantId;
const CONN = '5f5d0000-e29b-41d4-a716-446655442211';
const BOX = '5f5d0000-e29b-41d4-a716-446655442221';
const MAPPING = '5f5d0000-e29b-41d4-a716-446655442231' as MappingId;

let driver: LedgerDriver;

const store = (db: ConstructorParameters<typeof PgPathLifecycleStore>[0]) =>
  new PgPathLifecycleStore(db);

const lifecycles = () =>
  withTenant(driver, TENANT, (db) => store(db).forMapping(TENANT, MAPPING));

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'paths']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
       VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected')`,
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
    // Three paths the owner selected, and one they deselected.
    for (const [domain, included] of [
      ['email', true],
      ['calendar', true],
      ['contact', true],
      ['file', false],
    ] as const) {
      await q(
        `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
         VALUES ($1,$2,$3,$4)`,
        [TENANT, MAPPING, domain, included],
      );
    }
  } finally {
    await conn.release();
  }
});

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    await conn.query('DELETE FROM path_lifecycle WHERE mapping_id = $1', [MAPPING]);
  } finally {
    await conn.release();
  }
});

describe('absent means ready', () => {
  it('answers for paths that have never run, with no rows at all', async () => {
    const rows = await lifecycles();
    expect(rows.map((r) => r.domain).sort()).toEqual(['calendar', 'contact', 'email']);
    expect(rows.every((r) => r.state === 'ready')).toBe(true);
    // Never run: nothing to say about when it started or ended.
    expect(rows.every((r) => r.firstActivatedAt === undefined)).toBe(true);
  });

  it('a DESELECTED domain is not a path at all', async () => {
    // `file` is `included = false`. It is not a path the owner chose, so it is
    // not a path that could hold a slot, and listing it as `ready` would put a
    // row on a screen for something nobody asked to migrate.
    expect((await lifecycles()).find((r) => r.domain === 'file')).toBeUndefined();
  });

  it('holds no slot, so an absent row can never over-bill', async () => {
    await withTenant(driver, TENANT, async (db) => {
      expect(await store(db).slotsHeld(TENANT)).toBe(0);
    });
  });
});

describe('what holds a slot', () => {
  it('active and paused do; ready, cutover and done do not', () => {
    // ADR-0014's rule, and `paused` is the one that surprises people: pausing
    // does not reduce a bill, finishing does. A calculator that "helpfully"
    // freed a paused slot would undercharge silently, forever.
    expect(holdsASlot('active')).toBe(true);
    expect(holdsASlot('paused')).toBe(true);
    expect(holdsASlot('ready')).toBe(false);
    expect(holdsASlot('cutover')).toBe(false);
    expect(holdsASlot('done')).toBe(false);
  });

  it('the slotless list is derived, so the two cannot disagree', () => {
    expect([...SLOTLESS_STATES]).toEqual(PATH_STATES.filter((s) => !holdsASlot(s)));
    expect([...SLOT_HOLDING_STATES]).toEqual(PATH_STATES.filter(holdsASlot));
    // Exhaustive and disjoint: every state is on exactly one side, so a sixth
    // cannot be silently slotless.
    expect([...SLOT_HOLDING_STATES, ...SLOTLESS_STATES].sort()).toEqual([...PATH_STATES].sort());
  });

  it('the COUNT follows holdsASlot rather than restating it', async () => {
    // Found by breaking `holdsASlot` and watching the count NOT follow: the
    // query had 'active','paused' written out in SQL, so the function and the
    // query could disagree about `paused` and only one would be read at
    // invoice time. This asserts the query counts exactly the derived set.
    await withTenant(driver, TENANT, async (db) => {
      const s = store(db);
      for (const domain of ['email', 'calendar', 'contact'] as const) {
        await s.activate(TENANT, MAPPING, domain);
      }
      await s.moveTo(TENANT, MAPPING, 'calendar', 'paused');
      await s.moveTo(TENANT, MAPPING, 'contact', 'cutover');
      const held = (await s.forMapping(TENANT, MAPPING)).filter((p) =>
        SLOT_HOLDING_STATES.includes(p.state),
      ).length;
      expect(await s.slotsHeld(TENANT)).toBe(held);
    });
  });

  it('counts what a tier is read off — paused included', async () => {
    await withTenant(driver, TENANT, async (db) => {
      const s = store(db);
      await s.activate(TENANT, MAPPING, 'email');
      await s.activate(TENANT, MAPPING, 'calendar');
      await s.moveTo(TENANT, MAPPING, 'calendar', 'paused');
      expect(await s.slotsHeld(TENANT)).toBe(2);
      await s.moveTo(TENANT, MAPPING, 'email', 'done');
      // One ended, one still reserved.
      expect(await s.slotsHeld(TENANT)).toBe(1);
    });
  });
});

describe('paths end one at a time — the behaviour the tier model needs', () => {
  it('mail can be done while calendar keeps running', async () => {
    // The thing that is impossible today, and the whole reason for this table:
    // `mailbox_mapping.status` is one value for all four domains.
    await withTenant(driver, TENANT, async (db) => {
      const s = store(db);
      await s.activate(TENANT, MAPPING, 'email');
      await s.activate(TENANT, MAPPING, 'calendar');
      await s.moveTo(TENANT, MAPPING, 'email', 'done');
    });
    const byDomain = new Map((await lifecycles()).map((r) => [r.domain, r]));
    expect(byDomain.get('email')?.state).toBe('done');
    expect(byDomain.get('calendar')?.state).toBe('active');
    expect(byDomain.get('contact')?.state).toBe('ready');
  });
});

describe('the stamps an invoice is reconstructed from', () => {
  it('first_activated_at survives a pause and a resume', async () => {
    await withTenant(driver, TENANT, async (db) => {
      await store(db).activate(TENANT, MAPPING, 'email');
    });
    const first = (await lifecycles()).find((r) => r.domain === 'email')?.firstActivatedAt;
    expect(first).toBeTruthy();

    await withTenant(driver, TENANT, async (db) => {
      const s = store(db);
      await s.moveTo(TENANT, MAPPING, 'email', 'paused');
      await s.activate(TENANT, MAPPING, 'email');
    });
    // A path paused and resumed has not STARTED again. An invoice
    // reconstructed months later needs the original date.
    expect((await lifecycles()).find((r) => r.domain === 'email')?.firstActivatedAt).toBe(first);
  });

  it('ended_at is stamped when a slot is released and cleared when it is taken back', async () => {
    await withTenant(driver, TENANT, async (db) => {
      const s = store(db);
      await s.activate(TENANT, MAPPING, 'email');
      await s.moveTo(TENANT, MAPPING, 'email', 'done');
    });
    expect((await lifecycles()).find((r) => r.domain === 'email')?.endedAt).toBeTruthy();

    await withTenant(driver, TENANT, async (db) => {
      await store(db).activate(TENANT, MAPPING, 'email');
    });
    // A path that is running has not ended. A stale ended_at would answer
    // "when did this stop costing anything" with a date in the past while it
    // was still costing something.
    expect((await lifecycles()).find((r) => r.domain === 'email')?.endedAt).toBeUndefined();
  });

  it('pausing does NOT stamp ended_at — it still holds a slot', async () => {
    await withTenant(driver, TENANT, async (db) => {
      const s = store(db);
      await s.activate(TENANT, MAPPING, 'email');
      await s.moveTo(TENANT, MAPPING, 'email', 'paused');
    });
    expect((await lifecycles()).find((r) => r.domain === 'email')?.endedAt).toBeUndefined();
  });
});

describe('the database refuses what the vocabulary does not allow', () => {
  it('a sixth state is refused — these five are a pricing decision', async () => {
    await expect(
      withTenant(driver, TENANT, (db) =>
        db.execute(
          sql.raw(
            `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state)
             VALUES ('${TENANT}','${MAPPING}','email','archived')`,
          ),
        ),
      ),
    ).rejects.toThrow();
  });

  it('a domain outside the four is refused', async () => {
    await expect(
      withTenant(driver, TENANT, (db) =>
        db.execute(
          sql.raw(
            `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state)
             VALUES ('${TENANT}','${MAPPING}','chat','ready')`,
          ),
        ),
      ),
    ).rejects.toThrow();
  });

  it('one lifecycle per path — a second row for the same face is refused', async () => {
    await expect(
      withTenant(driver, TENANT, async (db) => {
        await store(db).activate(TENANT, MAPPING, 'email');
        await db.execute(
          sql.raw(
            `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state)
             VALUES ('${TENANT}','${MAPPING}','email','ready')`,
          ),
        );
      }),
    ).rejects.toThrow();
  });
});
