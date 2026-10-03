// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A HOLD THAT HOLDS EVERY DOOR (workplan 0132 T6 (b); 0131 §6 R7 step 4).
 *
 * The operator hold (managed migration 0023) is how a deploy drains: start
 * nothing new, wait until the tick's log says no pass is still in flight,
 * deploy, lift the hold. Only the sync tick read it. The eight places in this
 * API that enqueue a task on a person's request did not, so a tester who
 * pressed *Sync now* during a deploy started a pass after the operator had
 * watched the in-flight count reach 0, on tasks about to be replaced.
 *
 * Every enqueue now goes through one function, `enqueueUnlessHeld`, which
 * reads the open hold first and, while one is open, answers 409 with the
 * hold's sentence and enqueues nothing. This file holds that in three ways:
 *
 *  1. **The sweep.** Every source file under `apps/api/src` is read, and the
 *     only call that enqueues a Trigger.dev task is the one inside that
 *     function. A new door that calls `getTriggerClient().tasks.trigger(`
 *     itself fails here, by file, before anybody presses it during a deploy.
 *     The number of doors that call the function is counted too, so a ninth
 *     door gets a row in the table (`enqueueDoors`, in
 *     `__tests__/doors-that-start-work.ts`, which the closed organisation's
 *     guard presses too) rather than going untested.
 *  2. **The doors.** Each of the eight, pressed over a real (in-process)
 *     ledger with both migration chains, with a hold open: 409, the
 *     operator's sentence word for word, no enqueue, and for the four doors
 *     that write before they enqueue, nothing written. The same presses with
 *     no hold open each enqueue once, which is what makes the first half
 *     mean something: a door this harness could not reach would pass it.
 *     A hold with no sentence still says one, and a hold that could not be
 *     read fails the press rather than letting it through (hard rule 9).
 *  3. **The spec.** Each door's entry in `apps/api/docs/openapi.yaml`
 *     names `PlatformHeld`, so a client knows `platform_held` exists, and the
 *     body the held door actually sends is valid against that entry. Naming
 *     it was not enough: `/start` and `/sync` first documented the 409 as
 *     `oneOf: [Error, PlatformHeld]`, and a held body is an `Error` too
 *     (`Error` pins no value of `error`), so it matched both branches and
 *     `oneOf`, which wants exactly one, refused the answer the door gives.
 *  4. **The joins.** A press the route itself answers by joining work
 *     already under way enqueues nothing, and is answered as before while a
 *     hold is open: *Start* on an active migration, a running verification, a
 *     queued receipt, a running confirmation. Discovery's join is not the
 *     route's but Trigger.dev's (an idempotency key, applied inside the
 *     enqueue), so a discovery press is refused even when it would only have
 *     joined a count begun earlier.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { join, relative } from 'node:path';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';
import {
  M,
  code,
  enqueueDoors,
  sourceFiles as shippedFiles,
  specChecker,
  type Door,
} from './__tests__/doors-that-start-work.ts';

const SRC = import.meta.dirname;
/** The one module allowed to enqueue, relative to `apps/api/src`. */
const THE_FUNCTION_FILE = 'enqueue-unless-held.ts';

// ─── 1. The sweep ────────────────────────────────────────────────────────────

/** Every shipped source file under apps/api/src (`__tests__/doors-that-start-work.ts`). */
const sourceFiles = (): string[] => shippedFiles(SRC);

/**
 * Every way the SDK enqueues: `tasks.trigger`, `tasks.batchTrigger`,
 * `batch.trigger`, `batch.triggerByTask`, and the `…AndWait` forms a task can
 * call.
 */
const ENQUEUE_CALL = /\.\s*(trigger|batchTrigger|triggerAndWait|batchTriggerAndWait|triggerByTask)\s*\(/g;

/** The files that enqueue, and how many times each. */
function enqueueCalls(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of sourceFiles()) {
    const count = code(file).match(ENQUEUE_CALL)?.length ?? 0;
    if (count > 0) found.set(relative(SRC, file), count);
  }
  return found;
}

/**
 * The doors that call the function, by file. Eight on 2026-09-27: four in
 * each of the two migration routers. A door added later is one more here and
 * one more row in `enqueueDoors` (`__tests__/doors-that-start-work.ts`).
 */
const DOORS_BY_FILE: Readonly<Record<string, number>> = {
  'routes/migrations/index.ts': 4,
  'routes/migrations/operating-routes.ts': 4,
};

describe('the sweep: nothing in apps/api/src enqueues except through the one function', () => {
  it('the one enqueue call is inside enqueueUnlessHeld, and there is no other', () => {
    const found = enqueueCalls();
    const elsewhere = [...found].filter(([file]) => file !== THE_FUNCTION_FILE);
    expect(
      elsewhere,
      'these files enqueue a Trigger.dev task without asking the platform hold; route the\n' +
        'call through enqueueUnlessHeld (apps/api/src/enqueue-unless-held.ts), which answers 409\n' +
        'with the hold’s sentence while one is open (workplan 0132 T6 (b))',
    ).toEqual([]);
    expect(found.get(THE_FUNCTION_FILE)).toBe(1);
  });

  it('no file reaches the client’s enqueueing halves another way', () => {
    // `const { tasks } = getTriggerClient()` and a direct SDK import both walk
    // round the sweep above. `runs` is allowed: the close route cancels runs,
    // which starts nothing.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const rel = relative(SRC, file);
      if (rel === THE_FUNCTION_FILE) continue;
      const text = code(file);
      if (/from\s+['"]@trigger\.dev\//.test(text)) offenders.push(`${rel}: imports the SDK`);
      if (text.includes('getTriggerClient') && /\.\s*(tasks|batch)\b|\{[^}]*\b(tasks|batch)\b[^}]*\}\s*=/.test(text)) {
        offenders.push(`${rel}: reaches getTriggerClient().tasks or .batch`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the function reads the hold before it hands back the enqueue', () => {
    const text = code(join(SRC, THE_FUNCTION_FILE));
    const readAt = text.indexOf('readOpenPause(');
    const refuseAt = text.indexOf('status(409)');
    const enqueueAt = text.search(ENQUEUE_CALL);
    expect(readAt).toBeGreaterThan(-1);
    expect(refuseAt).toBeGreaterThan(readAt);
    expect(enqueueAt).toBeGreaterThan(refuseAt);
  });

  it('every door that enqueues calls the function, and each has a row below', () => {
    const calls: Record<string, number> = {};
    for (const file of sourceFiles()) {
      const rel = relative(SRC, file);
      if (rel === THE_FUNCTION_FILE) continue;
      const count = code(file).match(/\benqueueUnlessHeld\s*\(/g)?.length ?? 0;
      if (count > 0) calls[rel] = count;
    }
    expect(calls).toEqual(DOORS_BY_FILE);
    expect(DOORS.length).toBe(Object.values(DOORS_BY_FILE).reduce((a, b) => a + b, 0));
  });

  it('the one start nobody pressed asks the same two questions, from its one file', () => {
    // A migration that starts by itself when its person's grant lands (ADR-0035's
    // amendment, start when granted): `enqueueIfFree` asks the close and the hold
    // as `enqueueUnlessHeld` does, with nobody to answer. Its cases, held
    // included, are `start-when-granted.unit.test.ts`'s.
    const calls: Record<string, number> = {};
    for (const file of sourceFiles()) {
      const rel = relative(SRC, file);
      if (rel === THE_FUNCTION_FILE) continue;
      const count = code(file).match(/\benqueueIfFree\s*\(/g)?.length ?? 0;
      if (count > 0) calls[rel] = count;
    }
    expect(calls).toEqual({ 'routes/migrations/start-when-granted.ts': 1 });
  });
});

// ─── 2. The doors ────────────────────────────────────────────────────────────

// UUID family 0132b6d0-…, unused elsewhere in the repo.
const TENANT = '0132b6d0-e29b-41d4-a716-446655440001';
const CONN = '0132b6d0-e29b-41d4-a716-446655440011';
const BOX = '0132b6d0-e29b-41d4-a716-446655440021';
const ACTIVE = '0132b6d0-e29b-41d4-a716-446655440031';
const DRAFT = '0132b6d0-e29b-41d4-a716-446655440032';
const HASH = 'f'.repeat(64);

/** What the operator typed. Dutch, as the alpha's operator writes it (0132 D6, T6 step 2). */
const SENTENCE = 'We werken het platform bij. Rond 15:00 kopiëren we weer.';

let driver: LedgerDriver;

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: TENANT, userId: 'tester', userRole: 'owner' });
      next();
    },
    getDbPool: () => driver,
  };
});

const { enqueued } = vi.hoisted(() => ({ enqueued: [] as string[] }));
vi.mock('@openmig/scheduler', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTriggerClient: () => ({
      tasks: {
        trigger: (taskId: string) => {
          enqueued.push(taskId);
          return Promise.resolve({ id: `run-${enqueued.length}` });
        },
      },
    }),
  };
});

// The ledger's apply gates are not this file's subject; every one of them
// answers "permitted", so the two apply doors reach the point where they
// would write a receipt and enqueue. `apply-routes.integration.test.ts` holds
// the gates themselves.
vi.mock('@openmig/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const permitted = async (deps: { domain: string }) => ({ ok: true, domain: deps.domain });
  return { ...actual, evaluateApplyDeletion: permitted, evaluateApplyRelocation: permitted };
});

// The hold is read through the real function; `failNextRead` stands in for a
// database that could not be asked.
const { failNextRead } = vi.hoisted(() => ({ failNextRead: { on: false } }));
vi.mock('@openmig/managed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openmig/managed')>();
  return {
    ...actual,
    readOpenPause: (db: Parameters<typeof actual.readOpenPause>[0]) => {
      if (failNextRead.on) {
        failNextRead.on = false;
        return Promise.reject(new Error('relation "platform_pause" could not be read'));
      }
      return actual.readOpenPause(db);
    },
  };
});

const { default: migrationRoutes } = await import('./routes/migrations/index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function count(sqlText: string, params: unknown[]): Promise<number> {
  const conn = await driver.acquire();
  try {
    const r = await conn.query(sqlText, params);
    return Number((r.rows[0] as { n: string | number }).n);
  } finally {
    await conn.release();
  }
}

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    await conn.release();
  }
}

/** The eight doors, over this file's rows (`__tests__/doors-that-start-work.ts`). */
const DOORS: readonly Door[] = enqueueDoors({ active: ACTIVE, draft: DRAFT, hash: HASH, tenant: TENANT, count });

async function openHold(message: string | null): Promise<void> {
  await sql(`INSERT INTO platform_pause (message, started_by) VALUES ($1, 'operator-sub')`, [message]);
}

async function liftHold(): Promise<void> {
  await sql(`UPDATE platform_pause SET ended_at = now(), ended_by = 'operator-sub' WHERE ended_at IS NULL`);
}

const press = (door: Door) => request(app).post(door.path).send(door.body ?? {});

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  // `platform_pause` is the managed chain's (0023); these doors are the
  // managed API's, and activation writes a managed table too.
  await runManagedMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'held']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1,$2,$3,'user','held@example.invalid')`,
    [BOX, TENANT, CONN],
  );
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status, allow_apply_deletions)
     VALUES ($1,$3,$4,'active',true), ($2,$3,$4,'paused',false)`,
    [ACTIVE, DRAFT, TENANT, BOX],
  );
  // PGlite and both migration chains; see awaiting-grant.unit.test.ts for why
  // this is not vitest's default 10s.
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(() => {
  enqueued.length = 0;
});

describe('while a hold is open, every door answers 409 with the hold’s sentence and enqueues nothing', () => {
  beforeAll(() => openHold(SENTENCE));
  afterAll(() => liftHold());

  it.each(DOORS.map((d) => [d.name, d] as const))('%s', async (_name, door) => {
    const before = door.wrote ? await door.wrote() : 0;

    const res = await press(door);

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe('platform_held');
    // Word for word: the operator wrote it for the people reading it.
    expect(res.body.message).toBe(SENTENCE);
    expect(res.body.reason).toBe(SENTENCE);
    expect(typeof res.body.since).toBe('string');
    expect(enqueued, 'a held door enqueued a task').toEqual([]);
    if (door.wrote) {
      expect(await door.wrote(), 'a held door wrote before it was refused').toBe(before);
    }
  });
});

describe('a hold with no sentence', () => {
  beforeAll(() => openHold(null));
  afterAll(() => liftHold());

  it('still refuses, with the door’s own default sentence, never an empty one', async () => {
    const res = await press(DOORS[0]!);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('platform_held');
    expect(res.body.message).toMatch(/paused copying/);
    expect(res.body.message).toMatch(/Nothing was started/);
    expect(res.body.reason).toBe(res.body.message);
    expect(enqueued).toEqual([]);
  });
});

describe('a hold that could not be read', () => {
  it('is not taken for no hold: the door fails, and nothing is enqueued (hard rule 9)', async () => {
    failNextRead.on = true;
    const res = await press(DOORS[0]!);
    expect(res.status).toBe(500);
    expect(enqueued).toEqual([]);
  });
});

// ─── 3. The spec ─────────────────────────────────────────────────────────────

const { satisfies, responseSchema } = specChecker(join(SRC, '..', 'docs', 'openapi.yaml'));

/** The body schema a door's 409 documents, through a shared response when it names one. */
const refusalSchema = (door: Door) => responseSchema(door, '409');

describe('the checker the spec cases use', () => {
  // Its own proof, so a checker that answers "valid" to everything cannot
  // pass the cases below.
  const held = { error: 'platform_held', message: SENTENCE, reason: SENTENCE, since: '2026-09-27T09:00:00Z' };
  it('keeps oneOf to exactly one branch, which the first spec at /start and /sync broke', () => {
    const both = { oneOf: [{ $ref: '#/components/schemas/Error' }, { $ref: '#/components/schemas/PlatformHeld' }] };
    expect(satisfies(both, held)).toBe(false);
    expect(satisfies({ anyOf: both.oneOf }, held)).toBe(true);
  });
  it('refuses a body PlatformHeld does not describe', () => {
    const platformHeld = { $ref: '#/components/schemas/PlatformHeld' };
    expect(satisfies(platformHeld, held)).toBe(true);
    expect(satisfies(platformHeld, { ...held, error: 'Conflict' })).toBe(false);
    const withoutSince: Record<string, unknown> = { ...held };
    delete withoutSince.since;
    expect(satisfies(platformHeld, withoutSince)).toBe(false);
  });
});

describe('the spec describes the answer every held door gives', () => {
  beforeAll(() => openHold(SENTENCE));
  afterAll(() => liftHold());

  it.each(DOORS.map((d) => [d.name, d] as const))('%s', async (_name, door) => {
    const { raw, schema } = refusalSchema(door);
    expect(JSON.stringify(raw)).toContain('PlatformHeld');

    const res = await press(door);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(
      satisfies(schema, res.body),
      `${door.spec}: the held body ${JSON.stringify(res.body)} is not valid against the 409 the spec documents, ` +
        `${JSON.stringify(schema)}. A oneOf whose branches overlap refuses a body both describe; use anyOf, ` +
        'or a branch that pins `error`.',
    ).toBe(true);
  });
});

// ─── 4. The joins ────────────────────────────────────────────────────────────

describe('while a hold is open, a press the route joins to work under way is answered as before', () => {
  beforeAll(async () => {
    await openHold(SENTENCE);
    await sql(`INSERT INTO verification_run (tenant_id, mapping_id, state) VALUES ($1, $2, 'running')`, [TENANT, ACTIVE]);
    await sql(
      `INSERT INTO apply_receipt (tenant_id, mapping_id, natural_key_hash, action, state)
       VALUES ($1, $2, $3, 'deletion', 'queued'), ($1, $2, $3, 'relocation', 'queued')`,
      [TENANT, ACTIVE, HASH],
    );
    await sql(
      `INSERT INTO run (tenant_id, mapping_id, kind, trigger, status, started_at)
       VALUES ($1, $2, 'confirm', 'manual', 'running', now())`,
      [TENANT, ACTIVE],
    );
  });
  afterAll(async () => {
    await sql('DELETE FROM verification_run WHERE tenant_id = $1', [TENANT]);
    await sql('DELETE FROM apply_receipt WHERE tenant_id = $1', [TENANT]);
    await sql(`DELETE FROM run WHERE tenant_id = $1 AND kind = 'confirm'`, [TENANT]);
    await liftHold();
  });

  /** A door by its entry in the spec. */
  const door = (spec: string): Door => {
    const found = DOORS.find((d) => d.spec === `${M}${spec}`);
    if (!found) throw new Error(`no door at ${spec}`);
    return found;
  };

  it.each([
    ['Start on a migration already active', { ...door('/start'), path: `/api/migrations/${ACTIVE}/start` }, { activated: false }],
    ['a verification already running', door('/verify/start'), { started: false }],
    ['a deletion whose receipt is still queued', door('/deletions/{hash}/apply'), { queued: false }],
    ['a relocation whose receipt is still queued', door('/moves/{hash}/apply'), { queued: false }],
    ['a confirmation already running', door('/confirm'), { [ACTIVE]: { started: false } }],
  ] as const)('%s', async (_name, joiner, joined) => {
    const res = await press(joiner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject(joined);
    expect(enqueued).toEqual([]);
  });

  it('a discovery count is refused, because its join is decided inside the enqueue', async () => {
    const res = await press(door('/discover'));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(SENTENCE);
    expect(enqueued).toEqual([]);
  });
});

describe('with no hold open, the same presses each enqueue once', () => {
  // Each press from the same starting state, whatever the phases above left:
  // a receipt or a running verification would be JOINED rather than enqueued
  // again, and an active migration's Start enqueues nothing.
  beforeEach(async () => {
    await sql('DELETE FROM apply_receipt WHERE tenant_id = $1', [TENANT]);
    await sql('DELETE FROM verification_run WHERE tenant_id = $1', [TENANT]);
    await sql(`UPDATE mailbox_mapping SET status = 'paused' WHERE id = $1`, [DRAFT]);
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s', async (_name, door) => {
    const res = await press(door);
    expect(res.status, JSON.stringify(res.body)).toBe(door.accepted);
    expect(enqueued).toEqual([door.task]);
  });
});
