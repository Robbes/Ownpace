// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAGE ON ANOTHER SITE CANNOT PRESS THE APPLIANCE'S BUTTONS (`cross-site.ts`),
 * on the real appliance on PGlite.
 *
 * The appliance has no login, by design: the address it listens on is the
 * boundary. A browser on the owner's machine is inside it, and so is every page
 * that browser opens. A body-less POST is sent without asking the appliance
 * first, so a page on any site could start, finish or verify a migration here,
 * knowing no more than the example file's `mappingId`. The browser marks such a
 * request `Sec-Fetch-Site: cross-site`, and no page can forge that header.
 *
 * What these hold: a write marked cross-site is refused before any route runs
 * and changes nothing; the same request from the appliance's own screens, or
 * from a script that sends no mark, reaches its route; and reading is not
 * affected.
 *
 * The connectors point at port 1 and the schedule never fires.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index.ts';
import { isCrossSiteWrite } from './cross-site.ts';

const TENANT = '00000000-0000-4000-8000-000000000580';
const MAPPING = '58585858-5858-4585-8585-585858585858';

const tempDirs: string[] = [];
let handle: SelfhostHandle;
let base: string;

beforeAll(async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'ownpace-cross-site-cfg-'));
  const data = mkdtempSync(join(tmpdir(), 'ownpace-cross-site-db-'));
  tempDirs.push(cfg, data);
  const dav = {
    type: 'caldav',
    url: 'http://127.0.0.1:1/remote.php/dav',
    user: 'nobody',
    auth: { kind: 'login', passwordFromEnv: 'OPENMIG_TEST_NOPE' },
  };
  writeFileSync(
    join(cfg, 'mapping.json'),
    JSON.stringify({
      tenantId: TENANT,
      mappingId: MAPPING,
      schedule: { cron: '0 5 31 2 *' }, // 31 February: valid, never fires.
      source: dav,
      target: dav,
      domains: { calendar: { enabled: true, source: dav, target: dav } },
    }),
  );
  handle = await start({ persistence: 'pglite', pgliteDataDir: data, configDir: cfg, port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${handle.port}`;
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A POST as a browser sends it from a page, marked with where that page is. */
const post = (path: string, site?: 'cross-site' | 'same-site' | 'same-origin') =>
  fetch(`${base}${path}`, { method: 'POST', headers: site ? { 'sec-fetch-site': site } : {} });

describe('a write sent by a page on another site', () => {
  it('is refused before any route runs, and changes nothing', async () => {
    const refused = await post(`/mappings/${MAPPING}/start`, 'cross-site');

    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toMatch(/another website/);
    // The migration was never started: finishing it is still refused as one.
    const finish = await post(`/mappings/${MAPPING}/finish?force=true`, 'same-origin');
    expect(finish.status).toBe(409);
    expect(((await finish.json()) as { code: string }).code).toBe('paused');
  });

  it('is refused on the routes that need no id at all', async () => {
    for (const path of ['/verify/start', '/confirm']) {
      expect((await post(path, 'cross-site')).status, path).toBe(403);
    }
  });

  it("is refused for finishing too, the button that needs only the example file's id", async () => {
    expect((await post(`/mappings/${MAPPING}/finish?force=true`, 'cross-site')).status).toBe(403);
  });
});

describe('everything else reaches its route', () => {
  it("the appliance's own screens, a sibling address, and a script that sends no mark", async () => {
    for (const site of ['same-origin', 'same-site', undefined] as const) {
      const reached = await post(`/mappings/${MAPPING}/finish`, site);
      // The route's own answer, not the refusal.
      expect(reached.status, String(site)).toBe(409);
    }
  });

  it('reading, whoever asks', async () => {
    const status = await fetch(`${base}/status`, { headers: { 'sec-fetch-site': 'cross-site' } });

    expect(status.status).toBe(200);
  });
});

describe('which requests are writes from another site', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s marked cross-site is one', (method) => {
    expect(isCrossSiteWrite(method, 'cross-site')).toBe(true);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('%s is not, whoever asks', (method) => {
    expect(isCrossSiteWrite(method, 'cross-site')).toBe(false);
  });

  it.each(['same-origin', 'same-site', 'none', undefined])('a POST marked %s is not', (site) => {
    expect(isCrossSiteWrite('POST', site)).toBe(false);
  });
});
