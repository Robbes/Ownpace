// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * START WHEN GRANTED, PER PERSON (ADR-0035's amendment; the owner,
 * 2026-10-03: *"Yes, but after the move was started in the first place. After
 * preflight the start needs to be given at least once, the grant may arrive
 * later."*, and *"Per person"*; and, asked whether the move must be running or
 * only have been started, *"was ever started"*).
 *
 * Anna's move runs: their IMAP mailbox was started. Three of their migrations
 * read a Google account: one never ran, one ran and was paused, and one runs.
 * Bram has one migration, never started, and nothing running; one migration
 * belongs to nobody. When a grant lands:
 *
 *  - Anna's draft starts: `active`, its path, the change recorded `via:
 *    'grant'` by the link, and its first pass enqueued;
 *  - nothing else moves, and nothing else is enqueued;
 *  - it starts though Anna's move is paused or finished since, and a migration
 *    Anna's owner paused after it ran stays paused;
 *  - an operator hold starts nothing;
 *  - *Start* on a draft that waits says it will start by itself, for Anna's
 *    and not for Bram's.
 *
 * PGlite as `app_user`, both chains. The task client is the one thing
 * stubbed; `authenticate` is stubbed for the route.
 */

process.env.SECRET_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { SecretStore } from '@openmig/core/secret-store';

// UUID family 0153d7e0-…, unused elsewhere in the repo.
const U = (n: string) => `0153d7e0-e29b-41d4-a716-4466554430${n}`;
const TENANT = U('01');
const GOOGLE = U('11');
const IMAP = U('12');
/** Anna's: their IMAP mailbox, running: their move was started. */
const RUNNING = U('31');
/** Anna's: a Google account, never started. The one a grant starts. */
const DRAFT = U('32');
/** Anna's: a Google account that ran, and that the owner paused. */
const PAUSED = U('33');
/** Anna's: a Google account that runs already. */
const ALSO_RUNNING = U('34');
/** Bram's one migration, never started; nothing of theirs was ever started. */
const BRAMS = U('35');
/** Nobody's. */
const NOBODYS = U('36');
const ANNA = U('41');
const BRAM = U('42');

let driver: LedgerDriver;
const enqueued: Array<{ taskId: string; payload: Record<string, unknown>; options: Record<string, unknown> }> = [];

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
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: {
        trigger: (taskId: string, payload: Record<string, unknown>, options: Record<string, unknown>) => {
          enqueued.push({ taskId, payload, options });
          return Promise.resolve({ id: `run-${enqueued.length}` });
        },
      },
    }),
  };
});

const { startWhenGranted } = await import('./start-when-granted.ts');
const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function q(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const statusOf = async (id: string) => (await q('SELECT status FROM mailbox_mapping WHERE id = $1', [id]))[0]?.status;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });

  const encrypted = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);
  await q('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Acme Legal']);
  // Room for everything this file runs at the same time: an agreed Extra
  // large (workplan 0109 T6). This file is not about the tier's paths, which
  // `a-start-past-the-tier.unit.test.ts` holds.
  await q(
    `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
     VALUES ($1, 'tier', 'xl', 15000, 0, 'room for the test')`,
    [TENANT],
  );
  // A Google source with the organisation's client and no token: what a
  // migration holds while it waits for its person to connect.
  await q(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1,$3,'source','gmail','g','{}'::jsonb,'connected',$4),
            ($2,$3,'source','imap','i','{}'::jsonb,'connected',$5)`,
    [
      GOOGLE,
      IMAP,
      TENANT,
      encrypted({ username: 'anna@gmail.com', clientId: 'cid', clientSecret: 'csec' }),
      encrypted({ username: 'anna@old.example', password: 'p' }),
    ],
  );
  const mappings: Array<[string, string]> = [
    [RUNNING, IMAP],
    [DRAFT, GOOGLE],
    [PAUSED, GOOGLE],
    [ALSO_RUNNING, GOOGLE],
    [BRAMS, GOOGLE],
    [NOBODYS, GOOGLE],
  ];
  for (const [id, connection] of mappings) {
    // A mailbox of its own each, so no two migrations share a pair.
    const box = id.replace(/30(\d\d)$/, '20$1');
    await q(
      `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address) VALUES ($1,$2,$3,'user','m@example.invalid')`,
      [box, TENANT, connection],
    );
    await q(`INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status) VALUES ($1,$2,$3,'paused')`, [
      id,
      TENANT,
      box,
    ]);
    await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,'email',true)`, [
      TENANT,
      id,
    ]);
  }
  await q(`INSERT INTO person (id, tenant_id, display_name) VALUES ($1,$3,'Anna'), ($2,$3,'Bram')`, [ANNA, BRAM, TENANT]);
  for (const [m, p] of [
    [RUNNING, ANNA],
    [DRAFT, ANNA],
    [PAUSED, ANNA],
    [ALSO_RUNNING, ANNA],
    [BRAMS, BRAM],
  ]) {
    await q('INSERT INTO person_migration (mapping_id, person_id, tenant_id) VALUES ($1,$2,$3)', [m, p, TENANT]);
  }
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

beforeEach(async () => {
  enqueued.length = 0;
  await q('DELETE FROM platform_pause');
  await q(`UPDATE mailbox_mapping SET status = 'paused' WHERE tenant_id = $1`, [TENANT]);
  await q(`UPDATE mailbox_mapping SET status = 'active' WHERE id IN ($1, $2)`, [RUNNING, ALSO_RUNNING]);
  await q('DELETE FROM path_lifecycle WHERE tenant_id = $1', [TENANT]);
  // The ones that ran have their paths; a draft has none.
  for (const [id, state] of [
    [RUNNING, 'active'],
    [ALSO_RUNNING, 'active'],
    [PAUSED, 'paused'],
  ]) {
    await q(
      `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, updated_at)
       VALUES ($1,$2,'email',$3,now(),now())`,
      [TENANT, id, state],
    );
  }
  await q('DELETE FROM audit_log WHERE tenant_id = $1', [TENANT]);
});

describe('a grant lands on a migration of a person whose move was started', () => {
  it('starts the one that never ran: active, its path, the change recorded by the grant, and its first pass', async () => {
    expect(await startWhenGranted(driver, { tenantId: TENANT, mappingIds: [DRAFT] })).toEqual([DRAFT]);

    expect(await statusOf(DRAFT)).toBe('active');
    expect(await q('SELECT state FROM path_lifecycle WHERE mapping_id = $1', [DRAFT])).toEqual([{ state: 'active' }]);
    const recorded = await q(`SELECT actor, detail FROM audit_log WHERE action = 'mapping.status'`);
    expect(recorded).toEqual([
      { actor: 'grant-link', detail: { mappingId: DRAFT, from: 'paused', to: 'active', via: 'grant' } },
    ]);
    expect(enqueued).toEqual([
      {
        taskId: 'run-delta-sync',
        payload: { tenantId: TENANT, mappingId: DRAFT },
        options: { tags: [`tenant:${TENANT}`, `mapping:${DRAFT}`], concurrencyKey: DRAFT },
      },
    ]);
  });

  it('leaves the rest as they are: one the owner paused after it ran, and one that runs', async () => {
    expect(await startWhenGranted(driver, { tenantId: TENANT, mappingIds: [PAUSED, ALSO_RUNNING] })).toEqual([]);
    expect(await statusOf(PAUSED)).toBe('paused');
    expect(await statusOf(ALSO_RUNNING)).toBe('active');
    expect(enqueued).toEqual([]);
    expect(await q(`SELECT 1 FROM audit_log WHERE action = 'mapping.status'`)).toEqual([]);
  });

  it('past the agreed tier, leaves it a draft and throws nothing: the owner is asked at Start (0109 T6)', async () => {
    // Without the room this file's setup agreed to, and with three more kinds
    // running in the Google migration of Anna's that runs, Anna's six slots
    // are as many as Free runs already, and the draft would add a seventh.
    await q('DELETE FROM data_allowance WHERE tenant_id = $1', [TENANT]);
    try {
      for (const domain of ['calendar', 'contact', 'file']) {
        await q(`INSERT INTO scope_selection (tenant_id, mapping_id, domain, included) VALUES ($1,$2,$3,true)`, [
          TENANT,
          ALSO_RUNNING,
          domain,
        ]);
        await q(
          `INSERT INTO path_lifecycle (tenant_id, mapping_id, domain, state, first_activated_at, updated_at)
           VALUES ($1,$2,$3,'active',now(),now())`,
          [TENANT, ALSO_RUNNING, domain],
        );
      }
      expect(await startWhenGranted(driver, { tenantId: TENANT, mappingIds: [DRAFT] })).toEqual([]);
      expect(await statusOf(DRAFT)).toBe('paused');
      expect(await q('SELECT state FROM path_lifecycle WHERE mapping_id = $1', [DRAFT])).toEqual([]);
      expect(enqueued).toEqual([]);
    } finally {
      await q(`DELETE FROM path_lifecycle WHERE mapping_id = $1 AND domain <> 'email'`, [ALSO_RUNNING]);
      await q(`DELETE FROM scope_selection WHERE mapping_id = $1 AND domain <> 'email'`, [ALSO_RUNNING]);
      await q(
        `INSERT INTO data_allowance (tenant_id, kind, tier_id, band_gb, price_eur, consented_by)
         VALUES ($1, 'tier', 'xl', 15000, 0, 'room for the test')`,
        [TENANT],
      );
    }
  });

  it('starts nothing while an operator hold is open', async () => {
    await q(`INSERT INTO platform_pause (message, started_by) VALUES ('Updating.', 'operator-sub')`);
    expect(await startWhenGranted(driver, { tenantId: TENANT, mappingIds: [DRAFT] })).toEqual([]);
    expect(await statusOf(DRAFT)).toBe('paused');
    expect(enqueued).toEqual([]);
  });
});

describe('a grant lands where no move was ever started', () => {
  it('starts nothing of a person nothing of whose was ever started, or of nobody', async () => {
    expect(await startWhenGranted(driver, { tenantId: TENANT, mappingIds: [BRAMS, NOBODYS] })).toEqual([]);

    for (const id of [BRAMS, NOBODYS]) expect(await statusOf(id)).toBe('paused');
    expect(enqueued).toEqual([]);
  });
});

describe('a grant lands on a move started before and paused or finished since (the owner: "was ever started")', () => {
  it('starts the draft though nothing of Anna’s runs now, and leaves the migration paused after it ran as it is', async () => {
    // Anna's move, paused since it was started: their paths stay, which is what says it was.
    await q(`UPDATE mailbox_mapping SET status = 'paused' WHERE id IN ($1, $2)`, [RUNNING, ALSO_RUNNING]);
    expect(await startWhenGranted(driver, { tenantId: TENANT, mappingIds: [DRAFT, PAUSED] })).toEqual([DRAFT]);

    expect(await statusOf(DRAFT)).toBe('active');
    // A migration's own pause stands.
    expect(await statusOf(PAUSED)).toBe('paused');
    expect(enqueued.map((e) => e.payload.mappingId)).toEqual([DRAFT]);
  });

  it('starts the draft once the rest of Anna’s move has finished', async () => {
    await q(`UPDATE mailbox_mapping SET status = 'done' WHERE id IN ($1, $2, $3)`, [RUNNING, ALSO_RUNNING, PAUSED]);
    expect(await startWhenGranted(driver, { tenantId: TENANT, mappingIds: [DRAFT] })).toEqual([DRAFT]);
    expect(await statusOf(DRAFT)).toBe('active');
  });
});

describe('Start on a migration that waits for its grant', () => {
  it('says it starts by itself once its person has connected, when their move was started, paused since or not', async () => {
    for (const status of ['active', 'paused']) {
      await q(`UPDATE mailbox_mapping SET status = $3 WHERE id IN ($1, $2)`, [RUNNING, ALSO_RUNNING, status]);
      const res = await request(app).post(`/api/migrations/${DRAFT}/start`).send({});
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'awaiting_grant', startsWhenGranted: true });
      expect(res.body.reason).toMatch(
        / It starts by itself once Anna has connected: another migration of theirs has been started\.$/,
      );
    }
    expect(await statusOf(DRAFT)).toBe('paused');
  });

  it('says only that it waits, when nothing of theirs was ever started', async () => {
    const res = await request(app).post(`/api/migrations/${BRAMS}/start`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('awaiting_grant');
    expect(res.body.startsWhenGranted).toBeUndefined();
    expect(res.body.reason).not.toMatch(/starts by itself/);
  });
});
