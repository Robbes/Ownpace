// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The path rows move WITH the mapping, proved at the routes against a real
 * database (workplan 0109 T1b, the wiring half).
 *
 * WHY THE ROUTES AND NOT THE HELPER — the same reason as
 * `mapping-status-audit.unit.test.ts`, whose harness this mirrors:
 * `movePathsWithMapping` would be green whether or not a single route called
 * it, and a decision computed correctly then dropped between the function and
 * the request is the bug this repository keeps being bitten by. So this
 * presses start, update, finish and create, then reads `path_lifecycle`
 * directly, outside any route, to see what really landed.
 *
 * The rules under test are ADR-0014's, pinned here at the grain an invoice is
 * reconstructed from:
 *  - absent means `ready` — a draft has no rows, and no press except into
 *    `active` may conjure one;
 *  - `paused` STILL HOLDS A SLOT — `ended_at` stays NULL;
 *  - `first_activated_at` is stamped once — a resume keeps the original date;
 *  - only `included` domains are paths at all.
 *
 * UUID family 5f660000-…, unused elsewhere in the repo.
 */

process.env.SECRET_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { applyMappingStatusChange, pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';

const TENANT = '5f660000-e29b-41d4-a716-446655441901';
const CONN = '5f660000-e29b-41d4-a716-446655441911';
const BOX = '5f660000-e29b-41d4-a716-446655441921';
const MAPPING = '5f660000-e29b-41d4-a716-446655441931';

let driver: LedgerDriver;

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'pat', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});
// The start route enqueues a first pass; answering keeps this file about the
// lifecycle rows rather than exercising the enqueue-failure path by accident.
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: { trigger: () => Promise.resolve({ id: 'run-1' }) },
    }),
  };
});

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

interface PathRow {
  domain: string;
  state: string;
  first_activated_at: string | null;
  ended_at: string | null;
}

/** Read `path_lifecycle` directly — the witness no route can fake. */
async function pathRows(mappingId: string = MAPPING): Promise<PathRow[]> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(
      `SELECT domain, state, first_activated_at, ended_at
       FROM path_lifecycle WHERE mapping_id = $1 ORDER BY domain`,
      [mappingId],
    );
    return r.rows as unknown as PathRow[];
  } finally {
    await conn.release();
  }
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: the activation path writes `occupancy_peak`
  // (0109 T2), a managed-only table — these routes are the managed API's.
  await runManagedMigrations({ driver, logger: () => {} });

  const conn = await driver.acquire();
  try {
    const q = (sql: string, p: unknown[] = []) => conn.query(sql, p);
    await q('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'pathed']);
    await q(
      `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
       VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected',$3)`,
      [
        CONN,
        TENANT,
        JSON.stringify(
          SecretStore.encryptCredentials({ username: 'a@example.invalid', password: 'p' })
            .encrypted,
        ),
      ],
    );
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
       VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [BOX, TENANT, CONN],
    );
    await q(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
       VALUES ($1,$2,$3,'paused')`,
      [MAPPING, TENANT, BOX],
    );
    // Two paths, and one domain that is NOT one: `contact` sits in the scope
    // table with included=false, so any press that moves it proves the helper
    // lost its filter.
    await q(
      `INSERT INTO scope_selection (tenant_id, mapping_id, domain, included)
       VALUES ($1,$2,'email',true), ($1,$2,'calendar',true), ($1,$2,'contact',false)`,
      [TENANT, MAPPING],
    );
  } finally {
    await conn.release();
  }
  // PGlite's WASM warm-up on a cold runner exceeds vitest's 10s default —
  // the same allowance the billing PGlite suites carry.
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  const conn = await driver.acquire();
  try {
    // Mappings the creation tests made — removing them cascades their scope
    // and lifecycle rows, so every test starts from the one fixture mapping.
    await conn.query('DELETE FROM mailbox_mapping WHERE id <> $1', [MAPPING]);
    await conn.query(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [MAPPING]);
    await conn.query('DELETE FROM path_lifecycle');
    await conn.query('DELETE FROM occupancy_peak');
  } finally {
    await conn.release();
  }
});

describe('absent means ready', () => {
  it('a draft mapping has no rows at all', async () => {
    expect(await pathRows()).toEqual([]);
  });

  it('a PATCH restating the status it already has conjures nothing', async () => {
    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'paused' });
    expect(res.status).toBe(200);
    expect(await pathRows()).toEqual([]);
  });

  it('a real transition on a never-started mapping conjures nothing either', async () => {
    // paused → cutover is a genuine transition, but no path ever activated:
    // creating rows here would fabricate a history for paths that never ran.
    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'cutover' });
    expect(res.status).toBe(200);
    expect(await pathRows()).toEqual([]);
  });
});

describe('start takes the slots', () => {
  it('activates every included path, and only those', async () => {
    const res = await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    expect(res.status).toBe(200);

    const rows = await pathRows();
    // calendar + email, ordered by domain; `contact` (included=false) is not
    // a path and must not appear.
    expect(rows.map((r) => [r.domain, r.state])).toEqual([
      ['calendar', 'active'],
      ['email', 'active'],
    ]);
    for (const r of rows) {
      expect(r.first_activated_at).not.toBeNull();
      expect(r.ended_at).toBeNull();
    }
  });

  it('a second start is not a second activation', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const before = await pathRows();
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    expect(await pathRows()).toEqual(before);
  });
});

describe('paused holds a slot — the counter-intuitive rule, pinned at the route', () => {
  it('pausing moves the state and leaves ended_at NULL', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const started = await pathRows();

    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'paused' });
    expect(res.status).toBe(200);

    const rows = await pathRows();
    expect(rows.map((r) => r.state)).toEqual(['paused', 'paused']);
    for (const [i, r] of rows.entries()) {
      // Still holding a slot: a paused path has not ended.
      expect(r.ended_at).toBeNull();
      expect(r.first_activated_at).toEqual(started[i]?.first_activated_at);
    }
  });

  it('a resume keeps the original first_activated_at', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const original = (await pathRows()).map((r) => r.first_activated_at);

    await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'paused' });
    const resumed = await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    expect(resumed.status).toBe(200);

    const rows = await pathRows();
    expect(rows.map((r) => r.state)).toEqual(['active', 'active']);
    // A path that resumed has not started again — the invoice needs the
    // original date, months later.
    expect(rows.map((r) => r.first_activated_at)).toEqual(original);
  });
});

describe('ending releases the slot, with the date on the row', () => {
  it('cutover stamps ended_at', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'cutover' });
    expect(res.status).toBe(200);

    const rows = await pathRows();
    expect(rows.map((r) => r.state)).toEqual(['cutover', 'cutover']);
    for (const r of rows) expect(r.ended_at).not.toBeNull();
  });

  it('finish moves every path to done', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const res = await request(app).post(`/api/migrations/${MAPPING}/finish`).send({});
    expect(res.status).toBe(200);

    const rows = await pathRows();
    expect(rows.map((r) => r.state)).toEqual(['done', 'done']);
    for (const r of rows) expect(r.ended_at).not.toBeNull();
  });
});

describe("the cutover CLI's own write moves the paths too (it wrote the mapping alone)", () => {
  // `execute`, `complete` and a rollback reach the mapping through the
  // ledger's `applyMappingStatusChange`, not through a route. It moved no
  // path, so a cutover executed from the CLI kept every path `active`, and
  // its slots, after the cutover had released them.
  it('execute releases the slots, and a rollback takes them back with the first date kept', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const started = await pathRows();
    expect(started.map((r) => r.state)).toEqual(['active', 'active']);

    await applyMappingStatusChange(driver, TENANT, {
      mappingId: MAPPING,
      from: 'active',
      to: 'cutover',
      actor: 'cli',
      via: 'cutover',
    });
    const cut = await pathRows();
    expect(cut.map((r) => r.state)).toEqual(['cutover', 'cutover']);
    for (const r of cut) expect(r.ended_at).not.toBeNull();

    await applyMappingStatusChange(driver, TENANT, {
      mappingId: MAPPING,
      from: 'cutover',
      to: 'active',
      actor: 'cli',
      via: 'rollback',
    });
    const back = await pathRows();
    expect(back.map((r) => r.state)).toEqual(['active', 'active']);
    for (const [i, r] of back.entries()) {
      expect(r.ended_at).toBeNull();
      // A path that was cut over and rolled back has not started again.
      expect(r.first_activated_at).toEqual(started[i]!.first_activated_at);
    }
  });

  it('moves no path that is not one, and conjures none for a mapping that never ran', async () => {
    // The fixture's `contact` is in the scope table with included=false.
    await applyMappingStatusChange(driver, TENANT, {
      mappingId: MAPPING,
      from: 'paused',
      to: 'cutover',
      actor: 'cli',
      via: 'cutover',
    });
    expect(await pathRows()).toEqual([]);
  });
});

describe('the month remembers its peak (0109 T2)', () => {
  interface PeakRow {
    month: string;
    peak_paths: number;
    peak_at: string | null;
  }
  async function peakRows(): Promise<PeakRow[]> {
    const conn = await driver.acquire();
    try {
      const r = await conn.query(
        `SELECT month, peak_paths, peak_at FROM occupancy_peak WHERE tenant_id = $1 ORDER BY month`,
        [TENANT],
      );
      return r.rows as unknown as PeakRow[];
    } finally {
      await conn.release();
    }
  }

  it('starting writes the current month high-water in the same press', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const rows = await peakRows();
    expect(rows).toHaveLength(1);
    // Two included paths took slots; the mark is 2, dated now, this month.
    expect(rows[0]?.peak_paths).toBe(2);
    expect(rows[0]?.peak_at).not.toBeNull();
    // The driver hands `date` back as a JS Date; first-of-month in UTC.
    expect(new Date(rows[0]?.month ?? 0).getUTCDate()).toBe(1);
  });

  it('a tie does not move the mark — pause, resume, same peak, same date', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const [set] = await peakRows();
    // Guard the guard: an absent row would make the comparison below pass
    // vacuously (undefined equals undefined), hiding a recorder that never ran.
    expect(set?.peak_paths).toBe(2);
    await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'paused' });
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const [after] = await peakRows();
    // paused held the slots, so the resume re-reached 2 — re-reaching a level
    // is not setting it: the evidence date stays the moment it was SET.
    expect(after).toEqual(set);
  });

  it('entering the continuous lane takes the slots back, and the peak rises with them (0117 D6)', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    expect((await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'cutover' })).status).toBe(200);
    // A new month: nothing recorded yet, and the cutover holds no slot.
    const conn = await driver.acquire();
    try {
      await conn.query('DELETE FROM occupancy_peak');
    } finally {
      await conn.release();
    }

    const res = await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'continuous' });
    expect(res.status).toBe(200);
    expect((await pathRows()).map((r) => r.state)).toEqual(['continuous', 'continuous']);
    const rows = await peakRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.peak_paths).toBe(2);
  });

  it('finishing releases slots but the month keeps its mark', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const [set] = await peakRows();
    await request(app).post(`/api/migrations/${MAPPING}/finish`).send({});
    expect(await peakRows()).toEqual([set]);
  });

  it('a second active mapping raises the mark', async () => {
    await request(app).post(`/api/migrations/${MAPPING}/start`).send({});
    const res = await request(app)
      .post('/api/migrations')
      .send({
        name: 'the fourth and fifth path',
        sourceType: 'imap',
        targetType: 'jmap',
        sourceConfig: { host: 'src2.example.invalid', port: 993, username: 'c@example.invalid', password: 'p' },
        targetConfig: { host: 'dst2.example.invalid', port: 443, username: 'c@example.invalid', password: 'p' },
        syncConfig: { domains: ['email', 'contact'] },
        status: 'active',
      });
    expect(res.status).toBe(201);
    const rows = await peakRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.peak_paths).toBe(4);
  });
});

describe('a mapping created directly as active', () => {
  it('has its paths from birth — creation never passes the start route', async () => {
    const res = await request(app)
      .post('/api/migrations')
      .send({
        name: 'born running',
        sourceType: 'imap',
        targetType: 'jmap',
        sourceConfig: { host: 'src.example.invalid', port: 993, username: 'b@example.invalid', password: 'p' },
        targetConfig: { host: 'dst.example.invalid', port: 443, username: 'b@example.invalid', password: 'p' },
        syncConfig: { domains: ['email', 'contact'] },
        status: 'active',
      });
    expect(res.status).toBe(201);

    const rows = await pathRows(res.body.id);
    expect(rows.map((r) => [r.domain, r.state])).toEqual([
      ['contact', 'active'],
      ['email', 'active'],
    ]);
    for (const r of rows) expect(r.first_activated_at).not.toBeNull();
  });
});

describe('a migration begins paused or active, and nothing later', () => {
  // Creation asked `updateTransition` nothing, so a migration posted as
  // `continuous` was scheduled with no slot and no lane telling, and one posted
  // as `cutover` or `done` had a cutover nobody ran. No screen sends them.
  const create = (status?: string) =>
    request(app)
      .post('/api/migrations')
      .send({
        name: 'born late',
        sourceType: 'imap',
        targetType: 'jmap',
        sourceConfig: { host: 'src.example.invalid', port: 993, username: 'c@example.invalid', password: 'p' },
        targetConfig: { host: 'dst.example.invalid', port: 443, username: 'c@example.invalid', password: 'p' },
        syncConfig: { domains: ['email'] },
        ...(status === undefined ? {} : { status }),
      });

  /** How many migrations exist, read outside any route. */
  async function migrations(): Promise<number> {
    const conn = await driver.acquire();
    try {
      const r = await conn.query('SELECT count(*)::int AS n FROM mailbox_mapping');
      return (r.rows[0] as { n: number }).n;
    } finally {
      await conn.release();
    }
  }

  it.each(['cutover', 'done', 'continuous'])("refuses one created as '%s', and writes nothing", async (status) => {
    const before = await migrations();
    const res = await create(status);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(`not '${status}'`);
    expect(res.body.message).toContain('Keep copying');
    expect(res.body.details.map((d: { path: string[] }) => d.path)).toEqual([['status']]);
    expect(await migrations()).toBe(before);
  });

  it('begins as a draft when nothing is said, with no path rows', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('paused');
    expect(await pathRows(res.body.id)).toEqual([]);
  });

  it('begins paused or active when asked', async () => {
    expect((await create('paused')).body.status).toBe('paused');
    const running = await create('active');
    expect(running.status).toBe(201);
    expect(running.body.status).toBe('active');
    expect((await pathRows(running.body.id)).map((r) => r.state)).toEqual(['active']);
  });
});

describe('a press on the whole migration moves only the paths in the phase it leaves (0128 T5, slice 5a)', () => {
  /**
   * The migration's status and each path's own phase, placed by hand as slice
   * 5b's cutover of one data type will leave them: mail cut over on its own
   * while calendars still copy, and the status their roll-up.
   */
  async function place(status: string, phases: Record<'email' | 'calendar', string>): Promise<void> {
    const conn = await driver.acquire();
    try {
      await conn.query(`UPDATE mailbox_mapping SET status = $2 WHERE id = $1`, [MAPPING, status]);
      for (const [domain, state] of Object.entries(phases)) {
        const ended = ['cutover', 'done'].includes(state);
        await conn.query(
          `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, ended_at)
           VALUES ($1, $2, $3, $4, now() - interval '1 day', ${ended ? `now() - interval '1 hour'` : 'NULL'})`,
          [TENANT, MAPPING, domain, state],
        );
      }
    } finally {
      await conn.release();
    }
  }

  /** Each path's phase, and whether it still says when it ended. */
  const phases = async () => (await pathRows()).map((r) => [r.domain, r.state, r.ended_at !== null]);

  it('pausing and resuming leave mail, cut over on its own, where it is', async () => {
    await place('active', { email: 'cutover', calendar: 'active' });
    const cut = (await pathRows()).find((r) => r.domain === 'email')!;

    expect((await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'paused' })).status).toBe(200);
    expect(await phases()).toEqual([
      ['calendar', 'paused', false],
      ['email', 'cutover', true],
    ]);
    expect((await request(app).post(`/api/migrations/${MAPPING}/start`).send({})).status).toBe(200);
    expect(await phases()).toEqual([
      ['calendar', 'active', false],
      ['email', 'cutover', true],
    ]);
    // Untouched: its cutover's end is still the one it had.
    expect((await pathRows()).find((r) => r.domain === 'email')!.ended_at).toEqual(cut.ended_at);
  });

  it('finishing ends every path, whatever its phase', async () => {
    await place('active', { email: 'cutover', calendar: 'active' });
    expect((await request(app).post(`/api/migrations/${MAPPING}/finish`).send({})).status).toBe(200);
    expect(await phases()).toEqual([
      ['calendar', 'done', true],
      ['email', 'done', true],
    ]);
  });

  it('finishing the lane leaves a path that already ended with the date it ended', async () => {
    await place('continuous', { email: 'continuous', calendar: 'done' });
    const ended = (await pathRows()).find((r) => r.domain === 'calendar')!.ended_at;
    expect((await request(app).post(`/api/migrations/${MAPPING}/finish`).send({})).status).toBe(200);
    expect(await phases()).toEqual([
      ['calendar', 'done', true],
      ['email', 'done', true],
    ]);
    expect((await pathRows()).find((r) => r.domain === 'calendar')!.ended_at).toEqual(ended);
  });

  it('keeping it copying takes the paths in its cutover, and leaves one that ended', async () => {
    await place('cutover', { email: 'done', calendar: 'cutover' });
    expect((await request(app).put(`/api/migrations/${MAPPING}`).send({ status: 'continuous' })).status).toBe(200);
    expect(await phases()).toEqual([
      ['calendar', 'continuous', false],
      ['email', 'done', true],
    ]);
  });

  it("the cutover CLI's own door moves only the paths in the phase the mapping leaves", async () => {
    await place('active', { email: 'cutover', calendar: 'active' });
    const cut = (await pathRows()).find((r) => r.domain === 'email')!;
    await applyMappingStatusChange(driver, TENANT, {
      mappingId: MAPPING,
      from: 'active',
      to: 'cutover',
      actor: 'cli',
      via: 'cutover',
    });
    expect(await phases()).toEqual([
      ['calendar', 'cutover', true],
      ['email', 'cutover', true],
    ]);
    // Mail was not cut over again: its cutover's end is still the one it had.
    expect((await pathRows()).find((r) => r.domain === 'email')!.ended_at).toEqual(cut.ended_at);
  });

  it('rows that do not add up to the status: every path moves, as before', async () => {
    // Finished, then set back by hand: the rows still say `done`, and the
    // status is every path's phase, as the reader believes it.
    await place('paused', { email: 'done', calendar: 'done' });
    expect((await request(app).post(`/api/migrations/${MAPPING}/start`).send({})).status).toBe(200);
    expect(await phases()).toEqual([
      ['calendar', 'active', false],
      ['email', 'active', false],
    ]);
  });
});
