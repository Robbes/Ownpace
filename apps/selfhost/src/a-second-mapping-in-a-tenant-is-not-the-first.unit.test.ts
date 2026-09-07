// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A second mapping in a tenant is its own mapping — and an upgraded appliance
 * keeps the row it had.
 *
 * Found by the archive-import gate (workplan 0116 T10) on its first run,
 * 2026-09-05: the gate loaded a second mapping beside the E2E's main one and
 * read back 27 items for a five-file archive, then a 409 saying the mapping
 * was 'done' — the main mapping's count and the main mapping's finish. Both
 * mappings were ONE ROW. `uuidFromString` kept only the first sixteen bytes of
 * its seed, and every seed begins with the tenant id, so every id the
 * appliance derived for a tenant was the same value. Nobody saw it because
 * every appliance had exactly one mapping.
 *
 * Two things are pinned here, against the real appliance on PGlite:
 *
 *   1. two mappings in one tenant have two rows: starting one leaves the
 *      other paused, and the other refuses to run;
 *   2. an appliance whose row sits under the OLD id boots into that row —
 *      active, with its history — rather than into a fresh paused one, and
 *      a neighbour added later starts a row of its own. The quickstart
 *      promises an in-place upgrade; this is what makes the promise true
 *      for the id change.
 *
 * The connectors point at port 1, the honest failure the other appliance
 * tests build on: nothing here is about a pass succeeding.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pgliteDriver } from '@openmig/ledger';
import { start, type SelfhostHandle } from './index.ts';
import { legacyUuidFromString, mappingSeed, uuidFromString } from './config-dir.ts';

/** Temp directories this file makes, removed at the end (see workplan 0099's sweep). */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const TENANT = '00000000-0000-4000-8000-0000000000ab';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Two people on one appliance: each mapping copies its own mailbox. (Two
 * mappings copying ONE mailbox into ONE account are the pair the ledger's
 * `uk_mapping_source_target_prefix` exists to refuse, and it does.)
 */
function mappingJson(mappingId: string): string {
  const user = `${mappingId}@invalid`;
  return JSON.stringify({
    tenantId: TENANT,
    mappingId,
    schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
    source: {
      type: 'imap-oauth2',
      host: '127.0.0.1',
      port: 1,
      user,
      auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
    },
    target: {
      type: 'jmap',
      baseUrl: 'http://127.0.0.1:1',
      user,
      auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
    },
  });
}

/** A config dir holding the given mappings, in the order the appliance will load them. */
function configDirWith(...ids: string[]): string {
  const dir = tempDir('ownpace-two-mappings-cfg-');
  ids.forEach((id, i) => writeFileSync(join(dir, `${i}-${id.slice(0, 8)}.mapping.json`), mappingJson(id)));
  return dir;
}

async function boot(configDir: string, dataDir: string): Promise<{ handle: SelfhostHandle; base: string }> {
  const handle = await start({
    persistence: 'pglite',
    pgliteDataDir: dataDir,
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
  return { handle, base: `http://127.0.0.1:${handle.port}` };
}

async function statusOf(base: string, mappingId: string): Promise<string | undefined> {
  const body = (await (await fetch(`${base}/status`)).json()) as {
    mappings: Array<{ mappingId: string; migrationStatus: string }>;
  };
  return body.mappings.find((m) => m.mappingId === mappingId)?.migrationStatus;
}

/** Wait until the mapping's first pass has settled, so `stop()` never tears the ledger out from under it. */
async function waitForASettledRun(base: string, mappingId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = (await (await fetch(`${base}/mappings/${mappingId}/runs`)).json()) as {
      runs: Array<{ status: string }>;
    };
    if (body.runs.length > 0 && body.runs[0]!.status !== 'running') return;
    if (Date.now() > deadline) throw new Error(`no settled run for ${mappingId} after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Run SQL against a stopped appliance's PGlite as the database's own user — RLS does not apply, which is the point. */
async function asTheDatabase<T>(
  dataDir: string,
  fn: (query: (text: string, params?: unknown[]) => Promise<unknown[]>) => Promise<T>,
): Promise<T> {
  const driver = pgliteDriver({ dataDir });
  const conn = await driver.acquire();
  try {
    return await fn(async (text, params) => (await conn.query(text, params)).rows);
  } finally {
    conn.release();
    await driver.end();
  }
}

describe('two mappings in one tenant', () => {
  it('starting one leaves the other paused, and the other refuses to run', async () => {
    const { handle, base } = await boot(configDirWith(A, B), tempDir('ownpace-two-mappings-db-'));
    try {
      const res = await fetch(`${base}/mappings/${A}/start`, { method: 'POST' });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { activated: boolean }).activated).toBe(true);

      // With one row for both, B read 'active' here — the main mapping's
      // green light was the archive mapping's too.
      expect(await statusOf(base, A)).toBe('active');
      expect(await statusOf(base, B)).toBe('paused');

      const run = await fetch(`${base}/mappings/${B}/run`, { method: 'POST' });
      expect(run.status).toBe(409);
      expect(await run.text()).toContain("'paused'");

      await waitForASettledRun(base, A, 45_000);
    } finally {
      await handle.stop();
    }
  }, 120_000);

  it('an appliance upgraded from the old derivation keeps its row, and a neighbour added later starts its own', async () => {
    const dataDir = tempDir('ownpace-upgraded-db-');
    const freshA = uuidFromString(mappingSeed(TENANT, A));
    const legacy = legacyUuidFromString(mappingSeed(TENANT, A));
    const freshB = uuidFromString(mappingSeed(TENANT, B));

    // Boot 1: A alone, on a fresh database — its row lands under the new id.
    let booted = await boot(configDirWith(A), dataDir);
    await booted.handle.stop();

    // What an appliance from before 2026-09-05 actually has: A's row under
    // the legacy id, mid-migration, with no name — the old code never wrote
    // one. Moved by hand because the old code is gone.
    await asTheDatabase(dataDir, async (query) => {
      const [row] = (await query(
        `SELECT tenant_id, source_mailbox_id, target_mailbox_id, mode, pattern FROM mailbox_mapping WHERE id = $1`,
        [freshA],
      )) as Array<Record<string, unknown>>;
      expect(row, 'boot 1 left no row for A').toBeTruthy();
      // The fresh row goes first: the old row is the SAME mailbox pair, and
      // uk_mapping_source_target_prefix would refuse the pair twice.
      await query(`DELETE FROM mailbox_mapping WHERE id = $1`, [freshA]);
      await query(
        `INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status, pattern, name)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, NULL)`,
        [legacy, row!.tenant_id, row!.source_mailbox_id, row!.target_mailbox_id, row!.mode, row!.pattern],
      );
    });

    // Boot 2, upgraded, with B added: A comes back ACTIVE — the legacy row,
    // claimed — not as a fresh paused row with an empty ledger; B is paused
    // on a row of its own.
    booted = await boot(configDirWith(A, B), dataDir);
    try {
      expect(await statusOf(booted.base, A)).toBe('active');
      expect(await statusOf(booted.base, B)).toBe('paused');
    } finally {
      await booted.handle.stop();
    }
    const rows = await asTheDatabase(dataDir, (query) =>
      query(`SELECT id, name FROM mailbox_mapping WHERE tenant_id = $1 ORDER BY name`, [TENANT]),
    );
    expect(rows).toEqual([
      { id: legacy, name: A },
      { id: freshB, name: B },
    ]);

    // Boot 3: the claim is recorded on the row, so it holds without any luck
    // of file order — and a routine boot adds no row.
    booted = await boot(configDirWith(A, B), dataDir);
    try {
      expect(await statusOf(booted.base, A)).toBe('active');
      expect(await statusOf(booted.base, B)).toBe('paused');
    } finally {
      await booted.handle.stop();
    }
    const count = await asTheDatabase(dataDir, (query) =>
      query(`SELECT count(*)::int AS n FROM mailbox_mapping WHERE tenant_id = $1`, [TENANT]),
    );
    expect(count).toEqual([{ n: 2 }]);
  }, 300_000);
});
