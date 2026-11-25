// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The apply-deletions flag over HTTP on the appliance (workplan 0019 T3).
 *
 * The value is CONFIG-FILE-OWNED here: `GET .../apply-deletions` reports it
 * with `source: 'config'` so the shared screen renders a read-only note, and
 * `PATCH` answers 405 naming the file — an honest refusal, not a 404 that
 * sends somebody hunting for a different URL. Same real-appliance-on-PGlite
 * harness as verify-async.unit.test.ts.
 *
 * SINCE ALPHA.21 IT CARRIES ONE FLAG, `autoApplyRelocations` (ADR-0031).
 * Deleting by hand has no switch (ADR-0024, 2026-11-25; workplan 0173): a file
 * that still says `allowApplyDeletions` loads, the answer no longer names it,
 * and a file that says `false` is told once, at start, that it turns nothing
 * off.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index.ts';

/**
 * Temp directories this file makes, and the removal that used to be missing.
 *
 * See the sweep in workplan 0099: `mkdtempSync` with no matching `rmSync`
 * leaks for the lifetime of the machine, a PGlite data directory is 41MB, and
 * the suite was measured leaking 322MB per run after quietly accumulating
 * 29GB and filling the disk of the box running it. `unit-tests` runs on the
 * SELF-HOSTED runner for pushes to main — the same machine the managed stack
 * needs ~15GB free on.
 *
 * Registered rather than removed at each call site, so a new test here cannot
 * forget.
 */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});


const MAPPING_ON = '22222222-2222-4222-8222-2222222222aa';
const MAPPING_OFF = '22222222-2222-4222-8222-2222222222bb';
const MAPPING_ABSENT = '22222222-2222-4222-8222-2222222222cc';

/** What the appliance warned at start, as printed. */
const warned: string[] = [];

let handle: SelfhostHandle;
let base: string;

function mappingJson(mappingId: string, allow?: boolean): string {
  // Each mapping its own mailbox. Two mappings copying ONE mailbox into ONE
  // account are the pair the ledger's `uk_mapping_source_target_prefix`
  // refuses — and since 2026-09-05 two mappings in a tenant are two rows, so
  // it can (config-dir.ts, `uuidFromString`).
  const user = `${mappingId}@invalid`;
  return JSON.stringify({
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    mappingId,
    schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
    ...(allow === undefined ? {} : { allowApplyDeletions: allow }),
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
    domains: {},
  });
}

beforeAll(async () => {
  delete process.env.OPENMIG_TEST_NOPE;
  const configDir = tempDir('ownpace-applyflag-cfg-');
  writeFileSync(join(configDir, 'mapping-on.json'), mappingJson(MAPPING_ON, true));
  // A file from before alpha.21 that turned deleting by hand off on purpose.
  writeFileSync(join(configDir, 'mapping-off.json'), mappingJson(MAPPING_OFF, false));
  writeFileSync(join(configDir, 'mapping-absent.json'), mappingJson(MAPPING_ABSENT));

  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warned.push(args.map(String).join(' '));
  });
  try {
    handle = await start({
      persistence: 'pglite',
      pgliteDataDir: tempDir('ownpace-applyflag-db-'),
      configDir,
      port: 0,
      host: '127.0.0.1',
    });
  } finally {
    spy.mockRestore();
  }
  base = `http://127.0.0.1:${handle.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.stop();
});

describe('a file that still says allowApplyDeletions (no switch since alpha.21)', () => {
  it('loads, and a file saying false is warned about exactly once, at start', () => {
    const aboutTheKey = warned.filter((w) => w.includes('allowApplyDeletions'));
    expect(aboutTheKey).toHaveLength(1);
    expect(aboutTheKey[0]).toMatch(/no longer turns deleting by hand off/);
    expect(aboutTheKey[0]).toContain(MAPPING_OFF);
  });
});

describe('GET /mappings/{id}/apply-deletions', () => {
  it('answers the automatic-removal flag only, whatever the file says about deleting by hand', async () => {
    for (const id of [MAPPING_ON, MAPPING_OFF, MAPPING_ABSENT]) {
      const res = await fetch(`${base}/mappings/${id}/apply-deletions`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ autoApplyRelocations: false, source: 'config' });
    }
  });

  it('404s an unknown mapping', async () => {
    const res = await fetch(`${base}/mappings/no-such/apply-deletions`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /mappings/{id}/apply-deletions', () => {
  it('answers 405 naming the config file — the appliance flag has no API mutation', async () => {
    const res = await fetch(`${base}/mappings/${MAPPING_ON}/apply-deletions`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoApplyRelocations: true }),
    });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe('config_owned');
    expect(body.reason).toMatch(/config file/);
    expect(body.reason).toMatch(/autoApplyRelocations/);

    // And nothing changed.
    const after = await fetch(`${base}/mappings/${MAPPING_ON}/apply-deletions`);
    expect(((await after.json()) as { autoApplyRelocations: boolean }).autoApplyRelocations).toBe(false);
  });
});
