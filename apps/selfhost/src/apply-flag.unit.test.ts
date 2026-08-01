// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The apply-deletions flag over HTTP on the appliance (workplan 0019 T3).
 *
 * The value is CONFIG-FILE-OWNED here: `GET .../apply-deletions` reports it
 * with `source: 'config'` so the shared screen renders a read-only note, and
 * `PATCH` answers 405 naming the file — an honest refusal, not a 404 that
 * sends somebody hunting for a different URL. Same real-appliance-on-PGlite
 * harness as verify-async.unit.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index';

const MAPPING_ON = '22222222-2222-4222-8222-2222222222aa';
const MAPPING_OFF = '22222222-2222-4222-8222-2222222222bb';

let handle: SelfhostHandle;
let base: string;

function mappingJson(mappingId: string, allow?: boolean): string {
  return JSON.stringify({
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    mappingId,
    schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
    ...(allow === undefined ? {} : { allowApplyDeletions: allow }),
    source: {
      type: 'imap-oauth2',
      host: '127.0.0.1',
      port: 1,
      user: 'nobody@invalid',
      auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
    },
    target: {
      type: 'jmap',
      baseUrl: 'http://127.0.0.1:1',
      user: 'nobody@invalid',
      auth: { kind: 'basic', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
    },
    domains: {},
  });
}

beforeAll(async () => {
  delete process.env.OPENMIG_TEST_NOPE;
  const configDir = mkdtempSync(join(tmpdir(), 'openmig-applyflag-cfg-'));
  writeFileSync(join(configDir, 'mapping-on.json'), mappingJson(MAPPING_ON, true));
  // The OFF mapping omits the field entirely: absent must read as off — a
  // capability that destroys data is opted INTO, never defaulted on.
  writeFileSync(join(configDir, 'mapping-off.json'), mappingJson(MAPPING_OFF));

  handle = await start({
    persistence: 'pglite',
    pgliteDataDir: mkdtempSync(join(tmpdir(), 'openmig-applyflag-db-')),
    configDir,
    port: 0,
    host: '127.0.0.1',
  });
  base = `http://127.0.0.1:${handle.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.stop();
});

describe('GET /mappings/{id}/apply-deletions', () => {
  it('reports an opted-in mapping as on, config-owned', async () => {
    const res = await fetch(`${base}/mappings/${MAPPING_ON}/apply-deletions`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowApplyDeletions: true, source: 'config' });
  });

  it('reports an absent flag as OFF — the default is the safe direction', async () => {
    const res = await fetch(`${base}/mappings/${MAPPING_OFF}/apply-deletions`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowApplyDeletions: false, source: 'config' });
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
      body: JSON.stringify({ allowApplyDeletions: false }),
    });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe('config_owned');
    expect(body.reason).toMatch(/config file/);
    expect(body.reason).toMatch(/allowApplyDeletions/);

    // And nothing changed.
    const after = await fetch(`${base}/mappings/${MAPPING_ON}/apply-deletions`);
    expect(((await after.json()) as { allowApplyDeletions: boolean }).allowApplyDeletions).toBe(
      true,
    );
  });
});
