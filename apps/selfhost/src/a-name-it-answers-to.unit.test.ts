// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE NAMES THIS APPLIANCE ANSWERS TO (`host-allowlist.ts`; DNS rebinding; the
 * owner, 2026-09-24: "add a Host allowlist").
 *
 * A page on a name its author controls can point that name at this machine and
 * so become the appliance's own site: it may then read what the appliance
 * answers, and its writes carry no cross-site mark. Every such request names
 * that page's name in its `Host` header. So the appliance answers only to its
 * IP addresses, localhost and the names its owner listed, before any route
 * runs, reads included.
 *
 * First the rule on its own, then on the real appliance on PGlite, with
 * requests sent under the names a browser would send. The connectors point at
 * port 1 and the schedule never fires; the names are invented.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, type SelfhostHandle } from './index.ts';
import { answersTo, describeAllowlist, hostAllowlistFrom, hostOf, namedHost } from './host-allowlist.ts';

const NONE = hostAllowlistFrom(undefined);

describe('the rule', () => {
  it('answers to an IP address, with or without its port', () => {
    for (const host of ['127.0.0.1', '127.0.0.1:8081', '192.168.1.20:8081', '[::1]:8081', '[::1]', '::1']) {
      expect(answersTo(host, NONE), host).toBe(true);
    }
  });

  it('answers to localhost, however it is written', () => {
    for (const host of ['localhost', 'localhost:8081', 'LOCALHOST', 'localhost.', 'localhost.:8081']) {
      expect(answersTo(host, NONE), host).toBe(true);
    }
  });

  it('does not answer to a name nobody listed, however close to one it looks', () => {
    for (const host of [
      'rebind.example:8081',
      'localhost.rebind.example',
      '127.0.0.1.nip.io',
      'app.localhost',
      'ownpace.lan',
    ]) {
      expect(answersTo(host, NONE), host).toBe(false);
    }
  });

  it('answers to the names its owner listed, in any case and on any port', () => {
    const listed = hostAllowlistFrom(' ownpace.lan, NAS.local:8081 ');

    expect(answersTo('ownpace.lan:8081', listed)).toBe(true);
    expect(answersTo('OWNPACE.LAN', listed)).toBe(true);
    expect(answersTo('nas.local', listed)).toBe(true);
    expect(answersTo('rebind.example', listed)).toBe(false);
  });

  it('answers to any name only when that was chosen out loud', () => {
    expect(answersTo('rebind.example', hostAllowlistFrom('*'))).toBe(true);
    expect(answersTo('rebind.example', hostAllowlistFrom('ownpace.lan *'))).toBe(true);
  });

  it('answers a request that names no host, which no browser sends', () => {
    expect(answersTo(undefined, NONE)).toBe(true);
    expect(answersTo('', NONE)).toBe(true);
  });

  it('reads a name without its port, brackets or trailing dot, and repeats only what a name holds', () => {
    expect(hostOf('Ownpace.LAN.:8081')).toBe('ownpace.lan');
    expect(hostOf('[fe80::1]:8081')).toBe('fe80::1');
    expect(namedHost('evil"}\n{.example')).toBe('evil????.example');
    expect(namedHost(`${'a'.repeat(200)}.example`)).toHaveLength(80);
  });

  it('says at start-up what it answers to', () => {
    expect(describeAllowlist(NONE)).toMatch(/IP addresses and localhost only.*SELFHOST_ALLOWED_HOSTS/);
    expect(describeAllowlist(hostAllowlistFrom('nas.local,ownpace.lan'))).toBe(
      'its IP addresses, localhost and nas.local, ownpace.lan',
    );
    expect(describeAllowlist(hostAllowlistFrom('*'))).toMatch(/any name/);
  });
});

const TENANT = '00000000-0000-4000-8000-000000000600';
const MAPPING = '60606060-6060-4606-8606-606060606060';

const tempDirs: string[] = [];
let handle: SelfhostHandle;

beforeAll(async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'ownpace-host-cfg-'));
  const data = mkdtempSync(join(tmpdir(), 'ownpace-host-db-'));
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
  handle = await start({
    persistence: 'pglite',
    pgliteDataDir: data,
    configDir: cfg,
    port: 0,
    host: '127.0.0.1',
    allowedHosts: 'ownpace.lan',
  });
}, 120_000);

afterAll(async () => {
  await handle?.stop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A request to the appliance under the name a browser would put in `Host`. */
function ask(method: string, path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: handle.port, method, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('the appliance', () => {
  it('refuses a read under a name nobody listed, before any route, and says what to do', async () => {
    const res = await ask('GET', '/status', 'rebind.example:8081');

    expect(res.status).toBe(421);
    const body = JSON.parse(res.body) as { error: string; hint: string };
    expect(body.error).toBe('Refused: this appliance does not answer to the name "rebind.example".');
    expect(body.hint).toMatch(/SELFHOST_ALLOWED_HOSTS/);
  });

  it('refuses a write the same way, before the cross-site check could let it through', async () => {
    // A rebinding page is the appliance's own site to the browser, so its
    // POST carries no cross-site mark. The name is what gives it away.
    const res = await ask('POST', `/mappings/${MAPPING}/start`, 'rebind.example');

    expect(res.status).toBe(421);
    // Nothing started: finishing it is still refused as a paused migration.
    const finish = await ask('POST', `/mappings/${MAPPING}/finish?force=true`, `127.0.0.1:${handle.port}`);
    expect(finish.status).toBe(409);
  });

  it('answers under its IP address, localhost and a name its owner listed', async () => {
    for (const host of [`127.0.0.1:${handle.port}`, `localhost:${handle.port}`, 'ownpace.lan']) {
      expect((await ask('GET', '/healthz', host)).status, host).toBe(200);
    }
  });
});
