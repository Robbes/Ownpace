// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The appliance starting on PGlite, with no Postgres server (workplan 0015/0016).
 *
 * This is the point of the whole PGlite thread, so it is worth asserting
 * directly rather than inferring from unit tests of the parts: **the appliance
 * comes up, migrates itself, serves HTTP, and answers its operating endpoints,
 * with no `DATABASE_URL`, no container, no port to collide with, and no
 * `initdb`.** That is what makes a native Windows installer possible — Postgres
 * was the last native dependency it had.
 *
 * No Docker is involved. PGlite is Postgres compiled to WASM running in this
 * process, which is exactly why this can be a unit test.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index';

let handle: SelfhostHandle | undefined;

afterAll(async () => {
  await handle?.stop();
});

describe('the appliance on PGlite', () => {
  it('starts with no DATABASE_URL at all', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'openmig-cfg-'));
    const dataDir = mkdtempSync(join(tmpdir(), 'openmig-pglite-'));

    // No connectionString anywhere. Before this, `start()` threw
    // "DATABASE_URL is required" before it did anything else.
    handle = await start({
      persistence: 'pglite',
      pgliteDataDir: dataDir,
      configDir,
      port: 0,
      host: '127.0.0.1',
    });

    expect(handle.port).toBeGreaterThan(0);
  }, 120_000);

  it('has migrated itself, and answers the operating surface', async () => {
    const base = `http://127.0.0.1:${handle!.port}`;

    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);

    // /status only answers once migrations have applied — the tables it reads
    // do not exist otherwise — so a 200 here is the migration chain having run
    // against PGlite through the seam.
    const status = await fetch(`${base}/status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ status: 'ok', mappings: [] });

    // The §11.2 queues, on the edition that has no server behind it.
    for (const path of ['/deletions', '/moves', '/failures']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type'), path).toContain('application/json');
    }
  }, 60_000);

  it('serves the confirm redirect, so the UI works the same way', async () => {
    const res = await fetch(`http://127.0.0.1:${handle!.port}/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/ui/confirm');
  });
});

describe('the postgres path is unchanged', () => {
  it('still demands a DATABASE_URL, and says how to opt out', async () => {
    // The container path must keep working exactly as it did (hard rule 5), and
    // an operator who simply forgot the URL should be told the alternative
    // rather than left to find it.
    await expect(
      start({ configDir: mkdtempSync(join(tmpdir(), 'openmig-cfg-')), port: 0 }),
    ).rejects.toThrow(/DATABASE_URL is required.*SELFHOST_PERSISTENCE=pglite/s);
  });
});
