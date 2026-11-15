// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A RECONNECT THAT CARRIES ON (2026-11-15).
 *
 * The Accounts page promises that once Reconnect is pressed "the migration then
 * carries on from where it stopped". On the OTA stack a Google refresh token
 * expired, every pass failed `auth_expired`, the failing ladder
 * (`failing-backoff.ts`) widened the gap between attempts to four hours, and
 * the owner's Reconnect stored a working credential that nothing used: the
 * ladder counts failed passes since the last success, and a stored credential
 * is not one.
 *
 * A rotation that stores its credential now presses *Sync now* for each
 * migration standing against the connection (`carryOnAfterRotation`). What is
 * held here, through the real rotation door over a real (in-process) ledger as
 * `app_user`, with only the probe, the account qualifier and the Trigger.dev
 * client replaced:
 *
 *  - the migration whose sign-in expired is pressed once, however many of its
 *    data types failed, on its own partition, and the answer lists its run;
 *  - so is one the pass could not place on a side, and one still in its
 *    cutover's grace period, which the tick still runs;
 *  - nothing is pressed for a cause that heals itself, a finished migration,
 *    one past its grace period, one standing only on the other connection, or
 *    one on another connection altogether; a target's rotation presses what
 *    failed at the target;
 *  - a gate's refusal (a paused migration, the operator hold, Free's pace) is
 *    listed in the gate's own words, and the rotation still stands;
 *  - a press that fails is logged with a reference and listed, a read that
 *    fails leaves both lists out, and neither is a 500;
 *  - a probe that refuses the new account stores nothing and presses nothing.
 *
 * An IMAP source and a Nextcloud destination: past the store the door does not
 * look at the kind. Every address here is under `.invalid`, which names
 * nothing. UUID family 7a11c0de-…, unused elsewhere in the repo.
 */

process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SecretStore } from '@openmig/core/secret-store';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import { log } from '@openmig/shared';
import type { Answerable } from '../types/api.ts';

const TENANT = '7a11c0de-e29b-41d4-a716-446655440001';
/** The old mail account, whose sign-in expired: what is reconnected. */
const SRC = '7a11c0de-e29b-41d4-a716-446655440011';
/** The family cloud every migration here writes to. */
const TGT = '7a11c0de-e29b-41d4-a716-446655440012';
/** Another source, which nothing here reconnects. */
const ELSE = '7a11c0de-e29b-41d4-a716-446655440013';
const BOX_T = '7a11c0de-e29b-41d4-a716-446655440020';

// The migrations, named for what stands against them.
const EXPIRED = '7a11c0de-e29b-41d4-a716-446655440031';
const UNPLACED = '7a11c0de-e29b-41d4-a716-446655440032';
const IN_GRACE = '7a11c0de-e29b-41d4-a716-446655440033';
const PAUSED = '7a11c0de-e29b-41d4-a716-446655440034';
const HEALING = '7a11c0de-e29b-41d4-a716-446655440035';
const DONE = '7a11c0de-e29b-41d4-a716-446655440036';
const ENDED = '7a11c0de-e29b-41d4-a716-446655440037';
const AT_TARGET = '7a11c0de-e29b-41d4-a716-446655440038';
const ELSEWHERE = '7a11c0de-e29b-41d4-a716-446655440039';

/** A domain's failure: the data type, its category, and the side the pass named. */
type Failure = readonly [domain: string, category: string, side: 'source' | 'target' | null];

interface Migration {
  readonly id: string;
  readonly status: 'active' | 'paused' | 'cutover' | 'done';
  readonly failures: readonly Failure[];
  /** The connection it reads from; the old mail account unless said. */
  readonly source?: string;
  /** For a cutover: how many hours of its 72-hour grace period have passed. */
  readonly graceHoursIn?: number;
}

const MIGRATIONS: readonly Migration[] = [
  // The incident: two data types refused for the same expired sign-in, and a
  // network blip on a third, which does not make it a migration that heals.
  {
    id: EXPIRED,
    status: 'active',
    failures: [
      ['email', 'auth_expired', 'source'],
      ['calendar', 'auth_expired', 'source'],
      ['file', 'network', 'source'],
    ],
  },
  // The pass could not say which side failed, so it stands on both cards.
  { id: UNPLACED, status: 'active', failures: [['file', 'unknown', null]] },
  // Executed, and still copying through its grace period: the tick runs it.
  { id: IN_GRACE, status: 'cutover', graceHoursIn: 1, failures: [['contact', 'auth_expired', 'source']] },
  // Its owner paused it.
  { id: PAUSED, status: 'paused', failures: [['task', 'auth_expired', 'source']] },
  // Every cause here clears by itself, and it keeps its cadence anyway.
  {
    id: HEALING,
    status: 'active',
    failures: [
      ['email', 'rate_limited', 'source'],
      ['calendar', 'quota_exceeded', 'source'],
      ['file', 'network', 'source'],
    ],
  },
  // Over: a new credential fixes nothing for it.
  { id: DONE, status: 'done', failures: [['email', 'auth_expired', 'source']] },
  // Past its grace period, with nothing kept copying: the tick runs no pass.
  { id: ENDED, status: 'cutover', graceHoursIn: 73, failures: [['email', 'auth_expired', 'source']] },
  // The destination refused it: a failure on the other connection.
  { id: AT_TARGET, status: 'active', failures: [['file', 'target_refused', 'target']] },
  // A sign-in expired on another account altogether.
  { id: ELSEWHERE, status: 'active', source: ELSE, failures: [['email', 'auth_expired', 'source']] },
];

/** What a rotation sends: the account as it was, with a new password. */
const NEW_SOURCE = { host: 'imap.example.invalid', port: '993', username: 'the-owner', password: 'a-new-app-password' };
const NEW_TARGET = { url: 'https://cloud.example.invalid/remote.php/dav', username: 'the-owner', password: 'a-new-password' };

let driver: LedgerDriver;

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'the-owner', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

/** What the plane was asked to run; `down` stands in for a plane that cannot be reached. */
const { enqueued, plane } = vi.hoisted(() => ({
  enqueued: [] as Array<{ taskId: string; payload: Record<string, unknown>; options: Record<string, unknown> }>,
  plane: { down: false },
}));
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: {
        trigger: (taskId: string, payload: Record<string, unknown>, options: Record<string, unknown>) => {
          if (plane.down) return Promise.reject(new Error('connect ECONNREFUSED: the plane is not there'));
          enqueued.push({ taskId, payload, options });
          return Promise.resolve({ id: `run-of-${String(payload.mappingId)}` });
        },
      },
    }),
  };
});

// Nothing here reaches a provider: the probe answers at once.
const probe = vi.hoisted(() => ({ ok: true }));
vi.mock('@openmig/orchestration/probe-connection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/probe-connection')>();
  const answer = async () =>
    probe.ok
      ? { ok: true, detail: 'stubbed', outcome: { code: 'connectedSession' } }
      : { ok: false, reason: 'stubbed', outcome: { code: 'providerRefused' } };
  return { ...actual, probeSourceConnection: vi.fn(answer), probeTargetConnection: vi.fn(answer) };
});

// The re-qualification after a stored rotation would ask the server what the
// account carries; this file is about the migrations, not the measurement.
vi.mock('@openmig/orchestration/account-qualification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/orchestration/account-qualification')>();
  return { ...actual, qualifyAccount: vi.fn(async () => undefined) };
});

// The phases are read through the real reader; `unreadable` stands in for a
// database that could not be asked.
const { phases } = vi.hoisted(() => ({ phases: { unreadable: false } }));
vi.mock('@openmig/ledger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/ledger')>();
  return {
    ...actual,
    readPathPhases: (...args: Parameters<typeof actual.readPathPhases>) =>
      phases.unreadable
        ? Promise.reject(new Error('relation "path_lifecycle" could not be read'))
        : actual.readPathPhases(...args),
  };
});

// Sync now through its real gates; `silent` stands in for a gate that refused
// and wrote nothing, which no gate does today.
const { gate } = vi.hoisted(() => ({ gate: { silent: false } }));
vi.mock('./migrations/sync-now.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./migrations/sync-now.ts')>();
  return {
    ...actual,
    pressSyncNow: (...args: Parameters<typeof actual.pressSyncNow>) =>
      gate.silent ? Promise.resolve(null) : actual.pressSyncNow(...args),
  };
});

const { resetProbeTestLimit } = await import('../probe-limit.ts');
const { pressSyncNow } = await import('./migrations/sync-now.ts');
const { default: connectionRoutes } = await import('./connections.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);

async function sql(text: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(text, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const sealed = (creds: Record<string, string>) => JSON.stringify(SecretStore.encryptCredentials(creds).encrypted);

interface Answer {
  status: number;
  body: {
    rotated?: boolean;
    resumed?: Array<{ mappingId: string; runId: string }>;
    notResumed?: Array<{ mappingId: string; error: string; reason: string }>;
    [key: string]: unknown;
  };
}

/** Reconnect: replace a connection's credentials through the real door. */
async function reconnect(connectionId: string, values: Record<string, string>): Promise<Answer> {
  const res = await request(app).put(`/api/connections/${connectionId}/credentials`).send({ values });
  return { status: res.status, body: res.body as Answer['body'] };
}

/** Ids in one order, so the order the fold happens to give is not what is asserted. */
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

/** By migration, in that same order. */
const byMigration = <T extends { mappingId: string }>(list: readonly T[] | undefined): T[] =>
  [...(list ?? [])].sort((a, b) => (a.mappingId < b.mappingId ? -1 : a.mappingId > b.mappingId ? 1 : 0));

/** What the button itself says for this migration now, kept instead of sent. */
async function whatTheButtonSays(mappingId: string): Promise<{ error: string; message: string }> {
  let said: unknown;
  const kept: Answerable = {
    status: () => ({
      json: (body) => {
        said = body;
        return undefined;
      },
    }),
  };
  expect(await pressSyncNow(kept, TENANT, mappingId, {}, driver as never)).toBeNull();
  return said as { error: string; message: string };
}

/** Every line the route logged as an error, said instead of printed. */
let errors: string[] = [];
let errorSpy: MockInstance<typeof log.error> | undefined;

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // The managed chain too: every press asks the operator hold, and Free's pace
  // reads the tier, and both are managed tables.
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'a reconnect']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status, secret_ref)
     VALUES ($1, $4, 'source', 'imap', 'Old mail account', $5, 'error', $6),
            ($2, $4, 'target', 'nextcloud', 'Family cloud', $7, 'connected', $8),
            ($3, $4, 'source', 'imap', 'Another mail account', $5, 'error', $6)`,
    [
      SRC,
      TGT,
      ELSE,
      TENANT,
      JSON.stringify({ host: NEW_SOURCE.host, port: 993, username: NEW_SOURCE.username }),
      sealed({ ...NEW_SOURCE, password: 'the-expired-password' }),
      JSON.stringify({ url: NEW_TARGET.url, username: NEW_TARGET.username }),
      sealed({ username: NEW_TARGET.username, password: 'the-old-password' }),
    ],
  );
  await sql(`INSERT INTO mailbox (id, tenant_id, connection_id, kind) VALUES ($1, $2, $3, 'user')`, [
    BOX_T,
    TENANT,
    TGT,
  ]);
  for (const [n, m] of MIGRATIONS.entries()) {
    // One source mailbox each: a migration is one source and one destination.
    const box = `7a11c0de-e29b-41d4-a716-4466554401${String(n).padStart(2, '0')}`;
    await sql(`INSERT INTO mailbox (id, tenant_id, connection_id, kind) VALUES ($1, $2, $3, 'user')`, [
      box,
      TENANT,
      m.source ?? SRC,
    ]);
    await sql(
      `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, status, name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [m.id, TENANT, box, BOX_T, m.status, `migration ${n + 1}`],
    );
    for (const [domain, category, side] of m.failures) {
      await sql(
        `INSERT INTO migration_status
           (id, tenant_id, mapping_id, domain, state, last_error, last_error_category, failed_side, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'failed', 'the pass threw', $4, $5, now() - interval '20 hours')`,
        [TENANT, m.id, domain, category, side],
      );
    }
    if (m.graceHoursIn !== undefined) {
      await sql(
        `INSERT INTO cutover_state (tenant_id, mapping_id, state, grace_period_hours, copies_through_grace,
                                    grace_period_started_at, updated_at)
         SELECT $1, $2, 'GRACE_PERIOD', 72, true, s, s
           FROM (SELECT now() - ($3::int * interval '1 hour') AS s) t`,
        [TENANT, m.id, m.graceHoursIn],
      );
    }
  }
  // PGlite and both migration chains; see awaiting-grant.unit.test.ts for why
  // this is not vitest's default 10s.
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(() => {
  resetProbeTestLimit();
  enqueued.length = 0;
  probe.ok = true;
  plane.down = false;
  phases.unreadable = false;
  gate.silent = false;
  errors = [];
  errorSpy = vi.spyOn(log, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  });
});

afterEach(() => {
  errorSpy?.mockRestore();
});

describe('a reconnect that stores its credential carries on what was failing on it', () => {
  it('presses Sync now for the migration whose sign-in expired, once, on its own partition, and lists its run', async () => {
    const { status, body } = await reconnect(SRC, NEW_SOURCE);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.rotated).toBe(true);

    // The expired sign-in, the failure nobody could place, and the cutover
    // still copying through its grace period.
    expect(byMigration(body.resumed)).toEqual(
      byMigration([EXPIRED, UNPLACED, IN_GRACE].map((mappingId) => ({ mappingId, runId: `run-of-${mappingId}` }))),
    );

    // One press each: two data types refused the expired sign-in, and a third
    // blipped, and that is still one migration to carry on.
    expect(sorted(enqueued.map((e) => String(e.payload.mappingId)))).toEqual(sorted([EXPIRED, IN_GRACE, UNPLACED]));
    for (const { taskId, payload, options } of enqueued) {
      expect(taskId).toBe('run-delta-sync');
      expect(payload).toEqual({ tenantId: TENANT, mappingId: payload.mappingId });
      expect(
        options.concurrencyKey,
        'a pass pressed without the migration’s own partition runs beside its scheduled pass',
      ).toBe(payload.mappingId);
      expect(options.tags).toEqual([`tenant:${TENANT}`, `mapping:${String(payload.mappingId)}`]);
    }
    expect(errors).toEqual([]);
  });

  it('lists a paused migration in the words its button says, and starts nothing for it', async () => {
    const { body } = await reconnect(SRC, NEW_SOURCE);
    const button = await whatTheButtonSays(PAUSED);
    expect(body.notResumed).toEqual([{ mappingId: PAUSED, error: button.error, reason: button.message }]);
    expect(button.message).toMatch(/paused/);
    expect(enqueued.map((e) => e.payload.mappingId)).not.toContain(PAUSED);
  });

  it('presses nothing for a cause that heals itself, a finished migration, one past its grace period, or another connection’s', async () => {
    const { body } = await reconnect(SRC, NEW_SOURCE);
    const pressed = [...(body.resumed ?? []), ...(body.notResumed ?? [])].map((r) => r.mappingId);
    const asked = enqueued.map((e) => e.payload.mappingId);
    for (const [name, id] of [
      ['only a rate limit, a spent daily allowance and a network blip', HEALING],
      ['a finished migration', DONE],
      ['a cutover past its grace period, nothing kept copying', ENDED],
      ['a failure the pass placed on the destination', AT_TARGET],
      ['a sign-in that expired on another account', ELSEWHERE],
    ] as const) {
      expect(pressed, name).not.toContain(id);
      expect(asked, name).not.toContain(id);
    }
  });

  it('a destination’s reconnect carries on what failed at the destination, and what the pass could not place', async () => {
    const { status, body } = await reconnect(TGT, NEW_TARGET);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.rotated).toBe(true);
    expect(byMigration(body.resumed)).toEqual(
      byMigration([AT_TARGET, UNPLACED].map((mappingId) => ({ mappingId, runId: `run-of-${mappingId}` }))),
    );
    expect(body.notResumed).toEqual([]);
  });
});

describe('a gate that refuses is data beside the rotation, never its answer', () => {
  it('while the operator hold is open, each press is refused in the hold’s words, and the account is stored', async () => {
    const SENTENCE = 'Copying is paused while the platform is updated.';
    await sql(`INSERT INTO platform_pause (message, started_by) VALUES ($1, 'operator-sub')`, [SENTENCE]);
    try {
      const { status, body } = await reconnect(SRC, NEW_SOURCE);
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body.rotated).toBe(true);
      expect(body.resumed).toEqual([]);
      expect(byMigration(body.notResumed)).toEqual(
        byMigration([
          ...[EXPIRED, UNPLACED, IN_GRACE].map((mappingId) => ({ mappingId, error: 'platform_held', reason: SENTENCE })),
          // The paused gate comes before the hold, as it does for the button.
          { mappingId: PAUSED, error: 'Conflict', reason: (await whatTheButtonSays(PAUSED)).message },
        ]),
      );
      expect(enqueued, 'a held press enqueued a pass').toEqual([]);

      const [row] = await sql('SELECT secret_ref, status FROM connection WHERE id = $1', [SRC]);
      expect(row?.status).toBe('connected');
      expect(SecretStore.decryptCredentials(String(row?.secret_ref)).password).toBe(NEW_SOURCE.password);
    } finally {
      await sql(`UPDATE platform_pause SET ended_at = now(), ended_by = 'operator-sub' WHERE ended_at IS NULL`);
    }
  });

  it('on Free, a migration whose last pass started within the day waits for its pace, and says when', async () => {
    await sql(
      `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at, finished_at)
       VALUES ($1, $2, 'incremental', 'schedule', 'failed', now() - interval '1 hour', now() - interval '1 hour')`,
      [TENANT, EXPIRED],
    );
    try {
      const { body } = await reconnect(SRC, NEW_SOURCE);
      expect(body.rotated).toBe(true);
      const paced = body.notResumed?.find((r) => r.mappingId === EXPIRED);
      expect(paced).toEqual({ mappingId: EXPIRED, error: 'free_pace', reason: (await whatTheButtonSays(EXPIRED)).message });
      expect(paced?.reason).toMatch(/one pass a day/);
      expect(byMigration(body.resumed).map((r) => r.mappingId)).toEqual(sorted([UNPLACED, IN_GRACE]));
    } finally {
      await sql('DELETE FROM run WHERE tenant_id = $1', [TENANT]);
    }
  });

  it('a press that fails is logged with a reference and listed, and the rotation still answers rotated', async () => {
    plane.down = true;
    const { status, body } = await reconnect(SRC, NEW_SOURCE);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.rotated).toBe(true);
    expect(body.resumed).toEqual([]);

    const failed = byMigration(body.notResumed).filter((r) => r.error === 'press_failed');
    expect(failed.map((r) => r.mappingId)).toEqual(sorted([EXPIRED, UNPLACED, IN_GRACE]));
    for (const { mappingId, reason } of failed) {
      const reference = /Reference ([0-9a-f]{8})/.exec(reason)?.[1];
      expect(reference, reason).toBeDefined();
      // The same reference on the line the operator reads, and never the
      // error's own text in the answer.
      expect(errors.some((line) => line.includes(`[ref ${reference}]`) && line.includes(mappingId))).toBe(true);
      expect(reason).not.toContain('ECONNREFUSED');
    }
  });

  it('a gate that refused and wrote nothing is a fault, not a refusal without words', async () => {
    gate.silent = true;
    const { status, body } = await reconnect(SRC, NEW_SOURCE);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.rotated).toBe(true);
    expect(body.notResumed?.length).toBeGreaterThan(0);
    for (const { error, reason } of body.notResumed ?? []) {
      expect(error).toBe('press_failed');
      expect(reason).toMatch(/Reference [0-9a-f]{8}/);
    }
  });

  it('a read that fails before any press leaves both lists out rather than answering empty ones', async () => {
    phases.unreadable = true;
    const { status, body } = await reconnect(SRC, NEW_SOURCE);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.rotated).toBe(true);
    expect(body).not.toHaveProperty('resumed');
    expect(body).not.toHaveProperty('notResumed');
    expect(enqueued).toEqual([]);
    expect(errors.some((line) => /could not be read, so none was pressed \[ref [0-9a-f]{8}\]/.test(line))).toBe(true);
  });
});

describe('a rotation that stored nothing presses nothing', () => {
  it('a probe that refuses the new account keeps the old one, and carries nothing on', async () => {
    probe.ok = false;
    const { status, body } = await reconnect(SRC, NEW_SOURCE);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.rotated).toBe(false);
    expect(body).not.toHaveProperty('resumed');
    expect(body).not.toHaveProperty('notResumed');
    expect(enqueued).toEqual([]);
  });
});
