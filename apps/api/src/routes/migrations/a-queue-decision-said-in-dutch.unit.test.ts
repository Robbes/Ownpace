// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A QUEUE DECISION DID, SAID IN DUTCH TOO, ON THE MANAGED API (workplan
 * 0159 §6 item 18).
 *
 * The line where the buttons were on Deletions, Moves and Failures was the
 * server's `effect`, in English only, under a Dutch page. Each answer now
 * carries the Dutch beside it as `effectNl`, from the same shared words the
 * appliance answers with (`QUEUE_EFFECTS`, ADR-0026), and `effect` is
 * unchanged. Pressed here through the real routes over a real in-process
 * ledger (PGlite), as `a-data-type-ended-or-kept.unit.test.ts` does; the
 * appliance's own presses are `a-queue-decision-said-in-dutch-on-the-appliance`.
 *
 * Managed's apply answers with a receipt, not a sentence: the page says a
 * receipt's outcome in its own words, so it is not here.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import {
  MAX_ITEM_ATTEMPTS,
  QUEUE_EFFECTS,
  decisionEffectFields,
  failureEffect,
  failureGroupEffect,
} from '@openmig/shared';

// UUID family 0159e180-…, unused elsewhere in the repo.
const TENANT = '0159e180-e29b-41d4-a716-446655440001';
const CONN = '0159e180-e29b-41d4-a716-446655440011';
const BOX = '0159e180-e29b-41d4-a716-446655440021';
const MAPPING = '0159e180-e29b-41d4-a716-446655440031';

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

const { default: migrationRoutes } = await import('./index.ts');

const app = express();
app.use(express.json());
app.use('/api/migrations', migrationRoutes);

async function sql(text: string, params: unknown[] = []): Promise<void> {
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    await conn.release();
  }
}

/** One item of the mapping, in whatever state its queue needs. */
async function anItem(
  key: string,
  fields: { domain?: string; status?: string; attempts?: number; deletionReported?: boolean; movedTo?: string } = {},
): Promise<void> {
  await sql(
    `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status,
                       attempt_count, last_error, deletion_reported_at, moved_to_collection)
     VALUES ($1, $2, $3, 'c', $4, $4, $5, $6, $7, $8, $9)`,
    [
      TENANT,
      MAPPING,
      fields.domain ?? 'email',
      key,
      fields.status ?? 'copied',
      fields.attempts ?? 0,
      fields.status === 'failed' ? 'refused' : null,
      fields.deletionReported ? new Date().toISOString() : null,
      fields.movedTo ?? null,
    ],
  );
}

const press = (path: string, body?: object) =>
  request(app)
    .post(`/api/migrations/${MAPPING}/${path}`)
    .send(body ?? {});

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await sql('INSERT INTO tenant (id, name) VALUES ($1,$2)', [TENANT, 'effects']);
  await sql(
    `INSERT INTO connection (id, tenant_id, role, kind, display_name, config, status)
     VALUES ($1,$2,'source','imap','i','{}'::jsonb,'connected')`,
    [CONN, TENANT],
  );
  await sql(
    `INSERT INTO mailbox (id, tenant_id, connection_id, kind, primary_address)
     VALUES ($1,$2,$3,'user','m@example.invalid')`,
    [BOX, TENANT, CONN],
  );
  await sql(
    `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, status)
     VALUES ($1,$2,$3,'active')`,
    [MAPPING, TENANT, BOX],
  );
  await anItem('deleted-there', { deletionReported: true });
  await anItem('moved-there', { movedTo: 'Archive' });
  await anItem('tried-again', { status: 'failed', attempts: MAX_ITEM_ATTEMPTS });
  await anItem('left-behind', { status: 'failed', attempts: MAX_ITEM_ATTEMPTS });
  for (const key of ['file-a', 'file-b', 'file-c']) {
    await anItem(key, { domain: 'file', status: 'failed', attempts: MAX_ITEM_ATTEMPTS });
  }
  await anItem('the-one-event', { domain: 'calendar', status: 'failed', attempts: MAX_ITEM_ATTEMPTS });
}, 120_000);

afterAll(async () => {
  await driver.end?.();
});

describe('each queue decision says what it did, in English as before and in Dutch beside it', () => {
  it('keeping a deleted item’s copy', async () => {
    const res = await press('deletions/deleted-there/keep');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      action: 'keep',
      naturalKeyHash: 'deleted-there',
      effect: QUEUE_EFFECTS.deletionKept.en,
      effectNl: QUEUE_EFFECTS.deletionKept.nl,
    });
  });

  it('leaving a moved item where it is', async () => {
    const res = await press('moves/moved-there/keep');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      action: 'keep',
      naturalKeyHash: 'moved-there',
      ...decisionEffectFields(QUEUE_EFFECTS.moveKept),
    });
  });

  it('trying one failed item again, and migrating without another', async () => {
    const retried = await press('failures/tried-again/retry');
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({
      status: 'ok',
      action: 'retry',
      naturalKeyHash: 'tried-again',
      ...decisionEffectFields(failureEffect('retry')),
    });

    const accepted = await press('failures/left-behind/accept');
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({
      status: 'ok',
      action: 'accept',
      naturalKeyHash: 'left-behind',
      ...decisionEffectFields(failureEffect('accept')),
    });
  });

  it('a decision over a group, with its count in both languages, and the press that matched none', async () => {
    const retried = await press('failures', { action: 'retry', domain: 'file' });
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({
      status: 'ok',
      action: 'retry',
      matched: 3,
      match: { domain: 'file' },
      ...decisionEffectFields(failureGroupEffect('retry', 3)),
    });
    expect(retried.body.effect).toBe(
      'Attempts reset on 3 item(s) and cursors cleared; the next scheduled pass will try them again.',
    );

    // Retried rows are still failed rows: the same group is accepted next.
    const accepted = await press('failures', { action: 'accept', domain: 'file' });
    expect(accepted.body).toMatchObject({ matched: 3, ...decisionEffectFields(failureGroupEffect('accept', 3)) });

    // Nothing failed is left in the files, so a press there says it changed nothing.
    const none = await press('failures', { action: 'retry', domain: 'file' });
    expect(none.status).toBe(200);
    expect(none.body).toMatchObject({ matched: 0, ...decisionEffectFields(QUEUE_EFFECTS.failuresMatchedNothing) });

    // A group of one has its own line, so the Dutch says one item.
    const one = await press('failures', { action: 'accept', domain: 'calendar' });
    expect(one.body).toMatchObject({ matched: 1, ...decisionEffectFields(QUEUE_EFFECTS.failuresAcceptedOne) });
  });
});
