// Copyright 2026 The Ownpace authors (Apache-2.0)

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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index.ts';

/**
 * Temp directories this file makes, and the removal that used to be missing.
 *
 * `mkdtempSync` with no matching `rmSync` leaks for the lifetime of the
 * machine. A PGlite data directory is 41MB, and the unit suite as a whole was
 * measured on 2026-08-24 leaking 24 directories — 322MB — PER RUN, having
 * quietly accumulated 29GB and filled the disk of the box it was running on.
 *
 * That matters beyond a developer's laptop: `unit-tests` runs on the
 * SELF-HOSTED runner for pushes to main, which is the same Spark the managed
 * stack needs ~15GB free on. Nothing was watching, because a test that leaks
 * still passes.
 *
 * Registered rather than removed at each call site: every directory this file
 * creates goes through here, so a new test cannot forget.
 */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  // `force` so a directory a test already removed is not an error, and
  // `recursive` because these hold whole databases.
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});


/**
 * A minimal mapping config. The connectors point nowhere on purpose: discovery
 * is kicked off asynchronously at startup and is allowed to fail (it logs), and
 * nothing this test does needs a source or a target. What it needs is a mapping
 * that EXISTS and is `paused`, so the confirm-and-start path has something to
 * act on.
 */
function writeMapping(configDir: string, mappingId: string): void {
  writeFileSync(
    join(configDir, 'mapping.json'),
    JSON.stringify({
      tenantId: '00000000-0000-4000-8000-0000000000aa',
      mappingId,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid cron, never fires.
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
    }),
  );
}

const MAPPING_ID = '11111111-1111-4111-8111-1111111111aa';

let handle: SelfhostHandle | undefined;

afterAll(async () => {
  await handle?.stop();
});

describe('the appliance on PGlite', () => {
  it('starts with no DATABASE_URL at all', async () => {
    const configDir = tempDir('ownpace-cfg-');
    const dataDir = tempDir('ownpace-pglite-');
    writeMapping(configDir, MAPPING_ID);

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
    expect(await status.json()).toMatchObject({ status: 'ok' });

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

/**
 * The appliance's ENTRY POINT, which had no automated coverage at all.
 *
 * `GET /` and `POST /mappings/{id}/start` are the first two things a user
 * touches, and the e2e suite never calls either — it uses `/status`, the three
 * queues, `/verify` and `/mappings/{id}/run`, and its fixtures arrive already
 * active. That gap is how two behaviour changes shipped green: `/` went from
 * rendering HTML to redirecting, and `start` went from `303 See Other` to JSON.
 *
 * Both were deliberate (ADR-0026), and neither broke anything — but nothing was
 * WATCHING, which is the part worth fixing. Covered here rather than in e2e
 * because it needs no source, no target and no container: PGlite makes a real
 * appliance cheap enough to start in a unit test.
 */
describe('the green light', () => {
  it('a mapping starts out paused, so nothing copies before somebody says so', async () => {
    const res = await fetch(`http://127.0.0.1:${handle!.port}/status`);
    const body = (await res.json()) as {
      mappings: Array<{ mappingId: string; migrationStatus: string }>;
    };
    const mine = body.mappings.find((m) => m.mappingId === MAPPING_ID);
    expect(mine?.migrationStatus).toBe('paused');
  });

  it('answers JSON, not the 303 redirect the deleted HTML form needed', async () => {
    // The old confirm page was a form, so this was Post/Redirect/Get. The React
    // screen calls it with fetch, which FOLLOWS a redirect silently — the
    // button would have "worked" while navigating somewhere nobody asked for.
    const res = await fetch(
      `http://127.0.0.1:${handle!.port}/mappings/${encodeURIComponent(MAPPING_ID)}/start`,
      { method: 'POST', redirect: 'manual' },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({
      status: 'ok',
      action: 'start',
      mappingId: MAPPING_ID,
      activated: true,
    });
  });

  it('is idempotent, and says so rather than pretending it did work', async () => {
    const res = await fetch(
      `http://127.0.0.1:${handle!.port}/mappings/${encodeURIComponent(MAPPING_ID)}/start`,
      { method: 'POST' },
    );
    expect(res.status).toBe(200);
    // `activated: false` is the whole point: a second click changed nothing.
    expect(await res.json()).toMatchObject({ status: 'ok', activated: false });
  });

  it('actually activated the mapping, rather than just answering as if it had', async () => {
    const res = await fetch(`http://127.0.0.1:${handle!.port}/status`);
    const body = (await res.json()) as {
      mappings: Array<{ mappingId: string; migrationStatus: string }>;
    };
    expect(body.mappings.find((m) => m.mappingId === MAPPING_ID)?.migrationStatus).toBe('active');
  });

  it('404s an unknown mapping instead of inventing one', async () => {
    const res = await fetch(`http://127.0.0.1:${handle!.port}/mappings/nope/start`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });
});

describe('the postgres path is unchanged', () => {
  it('still demands a DATABASE_URL, and says how to opt out', async () => {
    // The container path must keep working exactly as it did (hard rule 5), and
    // an operator who simply forgot the URL should be told the alternative
    // rather than left to find it.
    await expect(
      start({ configDir: tempDir('ownpace-cfg-'), port: 0 }),
    ).rejects.toThrow(/DATABASE_URL is required.*SELFHOST_PERSISTENCE=pglite/s);
  });
});
