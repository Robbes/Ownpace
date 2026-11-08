// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A QUEUE DECISION DID, SAID IN DUTCH TOO, ON THE APPLIANCE (workplan
 * 0159 §6 item 18), on the real appliance over PGlite.
 *
 * The line where the buttons were on Deletions, Moves and Failures was the
 * server's `effect`, in English only, under a Dutch page. Each answer now
 * carries the Dutch beside it as `effectNl`, from the same shared words the
 * managed API answers with (`QUEUE_EFFECTS`, ADR-0026), and `effect` is
 * unchanged. Managed's own presses are `a-queue-decision-said-in-dutch`.
 *
 * PGlite has one connection, so the rows are written while the appliance is
 * stopped, and the presses made after it starts again, as
 * `a-data-type-ended-or-kept-on-the-appliance.unit.test.ts` does. The two
 * removals answer from the same words (`deletionRemovedEffect`,
 * `oldCopyRemovedEffect`), but need a new system that removes: the E2E apply
 * gate reads their answers against real servers.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDriver } from '@openmig/ledger';
import {
  MAX_ITEM_ATTEMPTS,
  QUEUE_EFFECTS,
  decisionEffectFields,
  failureEffect,
  failureGroupEffect,
} from '@openmig/shared';
import { start, type SelfhostHandle } from './index.ts';
import { mappingSeed, uuidFromString } from './config-dir.ts';

const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// UUID family 0159e181-…, unused elsewhere in the repo.
const TENANT = '0159e181-e29b-41d4-a716-446655440001';
const MAPPING = '0159e181-e29b-41d4-a716-446655440002';
const ROW = uuidFromString(mappingSeed(TENANT, MAPPING));

function configDir(): string {
  const dir = tempDir('ownpace-effects-cfg-');
  writeFileSync(
    join(dir, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: {
        type: 'imap-oauth2',
        host: 'localhost',
        port: 1,
        user: 'nobody@invalid',
        auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
      },
      target: {
        type: 'jmap',
        baseUrl: 'http://localhost:1',
        user: 'nobody@invalid',
        auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
      },
      domains: {},
    }),
  );
  return dir;
}

async function boot(cfg: string, dataDir: string): Promise<{ handle: SelfhostHandle; base: string }> {
  const handle = await start({ persistence: 'pglite', pgliteDataDir: dataDir, configDir: cfg, port: 0, host: 'localhost' });
  return { handle, base: `http://localhost:${handle.port}` };
}

async function asTheDatabase(dataDir: string, text: string, params: unknown[] = []): Promise<void> {
  const driver = pgliteDriver({ dataDir });
  const conn = await driver.acquire();
  try {
    await conn.query(text, params);
  } finally {
    conn.release();
    await driver.end();
  }
}

async function press(base: string, path: string, body?: object) {
  const res = await fetch(`${base}/mappings/${MAPPING}/${path}`, {
    method: 'POST',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('each queue decision on the appliance says what it did, in English as before and in Dutch beside it', () => {
  it('keeps, leaves, retries, accepts, and decides over a group', async () => {
    const cfg = configDir();
    const dataDir = tempDir('ownpace-effects-db-');
    // The first start writes the mapping's rows; the items go in beside them.
    await (await boot(cfg, dataDir)).handle.stop();
    const failed = (key: string, domain: string) => [TENANT, ROW, domain, key, MAX_ITEM_ATTEMPTS];
    await asTheDatabase(
      dataDir,
      `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status,
                         deletion_reported_at, moved_to_collection)
       VALUES ($1, $2, 'email', 'INBOX', 'deleted-there', 'deleted-there', 'copied', now(), NULL),
              ($1, $2, 'email', 'INBOX', 'moved-there', 'moved-there', 'copied', NULL, 'Archive')`,
      [TENANT, ROW],
    );
    for (const [key, domain] of [
      ['tried-again', 'email'],
      ['left-behind', 'email'],
      ['file-a', 'file'],
      ['file-b', 'file'],
      ['file-c', 'file'],
      ['the-one-event', 'calendar'],
    ] as const) {
      await asTheDatabase(
        dataDir,
        `INSERT INTO item (tenant_id, mapping_id, domain, collection, natural_key, natural_key_hash, status,
                           attempt_count, last_error)
         VALUES ($1, $2, $3, 'c', $4, $4, 'failed', $5, 'refused')`,
        failed(key, domain),
      );
    }

    const booted = await boot(cfg, dataDir);
    try {
      const kept = await press(booted.base, 'deletions/deleted-there/keep');
      expect(kept).toEqual({
        status: 200,
        body: {
          status: 'ok',
          action: 'keep',
          naturalKeyHash: 'deleted-there',
          effect: QUEUE_EFFECTS.deletionKept.en,
          effectNl: QUEUE_EFFECTS.deletionKept.nl,
        },
      });

      expect(await press(booted.base, 'moves/moved-there/keep')).toEqual({
        status: 200,
        body: { status: 'ok', action: 'keep', naturalKeyHash: 'moved-there', ...decisionEffectFields(QUEUE_EFFECTS.moveKept) },
      });

      expect(await press(booted.base, 'failures/tried-again/retry')).toEqual({
        status: 200,
        body: { status: 'ok', action: 'retry', naturalKeyHash: 'tried-again', ...decisionEffectFields(failureEffect('retry')) },
      });
      expect(await press(booted.base, 'failures/left-behind/accept')).toEqual({
        status: 200,
        body: { status: 'ok', action: 'accept', naturalKeyHash: 'left-behind', ...decisionEffectFields(failureEffect('accept')) },
      });

      // The group, with its count in both languages; retried rows are still
      // failed rows, so the same group is accepted next.
      expect(await press(booted.base, 'failures', { action: 'retry', domain: 'file' })).toEqual({
        status: 200,
        body: {
          status: 'ok',
          action: 'retry',
          matched: 3,
          match: { domain: 'file' },
          ...decisionEffectFields(failureGroupEffect('retry', 3)),
        },
      });
      expect((await press(booted.base, 'failures', { action: 'accept', domain: 'file' })).body).toMatchObject({
        matched: 3,
        ...decisionEffectFields(failureGroupEffect('accept', 3)),
      });
      // Nothing failed is left in the files: the press says it changed nothing.
      expect((await press(booted.base, 'failures', { action: 'retry', domain: 'file' })).body).toMatchObject({
        matched: 0,
        ...decisionEffectFields(QUEUE_EFFECTS.failuresMatchedNothing),
      });
      // A group of one has its own line, so the Dutch says one item.
      expect((await press(booted.base, 'failures', { action: 'accept', domain: 'calendar' })).body).toMatchObject({
        matched: 1,
        ...decisionEffectFields(QUEUE_EFFECTS.failuresAcceptedOne),
      });
    } finally {
      await booted.handle.stop();
    }
  }, 180_000);
});
