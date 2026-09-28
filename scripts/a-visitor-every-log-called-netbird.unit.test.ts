// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A VISITOR EVERY LOG CALLED NETBIRD (the owner, 2026-09-28, ops-trust-proxy
 * (b): *"Keep visitors' addresses in all our logs"*; privacy §4.5).
 *
 * `site/legal/README.md`, *To build or to do*: *"Visitors' IP addresses in our
 * own logs (privacy §4.5; ops-trust-proxy (b)): `TRUST_PROXY` in live's
 * `.env`, and both nginx configurations (`apps/web/nginx.conf.template`,
 * `deploy/compose/www-nginx.conf`) recording the address NetBird passes on."*
 * Privacy §4.5 says our server logs record *"your IP address, which NetBird
 * passes on to us"*.
 *
 * WHY NONE DID. NetBird's reverse proxy ends TLS and opens its own connection
 * to the machine, through the WireGuard tunnel, from its address on the mesh
 * (`netbirdio/docs` at `33d1b212`, `manage/reverse-proxy/service-configuration.mdx`).
 * So nginx's `$remote_addr` is NetBird's, for every visitor, in the app's log
 * (`ownpace_combined` recorded nothing else) and in the website's (no format of
 * its own: the image's default applied, which this repository never read).
 * The API, with `TRUST_PROXY` empty, took the web container for the caller.
 * What the visitor's address travels in is `X-Forwarded-For`: NetBird's proxy
 * drops whatever the visitor sent and sets it, and `X-Real-IP`, to the address
 * the visitor connected from (`netbirdio/netbird` at `002755c4`,
 * `proxy/internal/proxy/reverseproxy.go`, `setUntrustedForwardingHeaders`).
 *
 * WHAT THIS HOLDS.
 *  - Both nginx logs record `X-Forwarded-For` as a field of its own, last, after
 *    the fields of nginx's `combined`, which keep their places. Recorded, not
 *    believed: no `set_real_ip_from`, whose trusted range would be an address
 *    written in the repository (it belongs in the `.env`, if ever).
 *  - Each writes to `/var/log/nginx/access.log`, which the image links to the
 *    container's output: Docker's log, which privacy §9 says is kept until the
 *    part that wrote it is replaced (`a-journal-that-outlived-the-container`).
 *  - The value live's steps set (`docs/managed-bring-up.md`) is 2, the proxies
 *    in front of the API: NetBird's, and the web container's nginx, which
 *    appends NetBird's address. Run through Express itself, the API then names
 *    the visitor, and with 1 it names NetBird. `stand-up-live.sh` refuses live's
 *    `.env` without a count of at least 2 (`a-first-bring-up-of-live`).
 *  - `managed.env.example` says so beside the key.
 *
 * Whether NetBird's cluster puts another proxy in front of its own is not in
 * its source; 0132 T3 (d)'s request with a forged header, read back in one log
 * line of each on live, settles it there.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const APP = 'apps/web/nginx.conf.template';
const SITE = 'deploy/compose/www-nginx.conf';

/** Where the nginx image sends the access log: a link to the container's output. */
const DOCKER_LOG = '/var/log/nginx/access.log';

/** Comments out, so a sentence about a directive is not taken for one. */
const code = (conf: string): string =>
  conf
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');

/** Every `log_format name '…' '…';`, its quoted parts joined as nginx joins them. */
function logFormats(conf: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of code(conf).matchAll(/\blog_format\s+(\w+)\s+((?:'[^']*'\s*)+);/g)) {
    out.set(m[1]!, [...m[2]!.matchAll(/'([^']*)'/g)].map((p) => p[1]).join(''));
  }
  return out;
}

/** Every `access_log <path> <format>;`. */
function accessLogs(conf: string): Array<{ path: string; format?: string }> {
  return [...code(conf).matchAll(/\baccess_log\s+(\S+?)(?:\s+(\w+))?\s*;/g)].map((m) => ({
    path: m[1]!,
    format: m[2],
  }));
}

/** nginx's own `combined`, field for field, so a reader of that format still reads these. */
const COMBINED_FIELDS = [
  '$remote_addr',
  '$remote_user',
  '[$time_local]',
  '$status',
  '$body_bytes_sent',
  '$http_user_agent',
];

describe.each([
  ["the app's nginx", APP],
  ["the website's nginx", SITE],
])('%s', (_what, path) => {
  const conf = read(path);

  it('writes its access log to the container\'s output, in a format this repository names', () => {
    const logs = accessLogs(conf);
    expect(logs, `${path} names no access_log, so the image's default format applies`).toHaveLength(1);
    expect(logs[0]!.path).toBe(DOCKER_LOG);
    expect(logs[0]!.format, `${path}'s access_log names no format of its own`).toBeTruthy();
    expect(logFormats(conf).has(logs[0]!.format!), `${path} uses a log_format it does not define`).toBe(true);
  });

  it('records the address NetBird passes on, as a field of its own, after combined\'s fields', () => {
    const format = logFormats(conf).get(accessLogs(conf)[0]?.format ?? '') ?? '';
    expect(format.startsWith('$remote_addr - $remote_user [$time_local] '), format).toBe(true);
    for (const field of COMBINED_FIELDS) expect(format).toContain(field);
    expect(format, `${path}'s log names NetBird for every visitor`).toMatch(/ "\$http_x_forwarded_for"$/);
  });

  it('believes no range written in the file: the header is recorded, not trusted', () => {
    expect(code(conf)).not.toMatch(/\bset_real_ip_from\b|\breal_ip_header\b/);
  });
});

describe("the value live's steps give TRUST_PROXY", () => {
  const guide = read('docs/managed-bring-up.md');
  const steps = guide.slice(guide.indexOf("### Before the script: the owner's steps"), guide.indexOf('### The script'));
  const value = /\bTRUST_PROXY=(\S+)/.exec(steps)?.[1];

  it('is in the owner\'s steps for live, among live\'s settings', () => {
    expect(steps.length, "the bring-up's owner's steps for live moved").toBeGreaterThan(0);
    expect(value, "live's settings in docs/managed-bring-up.md set no TRUST_PROXY").toBe('2');
  });

  it("is said beside the key in managed.env.example, with NetBird's part in it", () => {
    const example = read('deploy/compose/managed.env.example');
    const at = example.search(/^TRUST_PROXY=/m);
    const before = example.slice(Math.max(0, at - 1400), at);
    expect(before).toMatch(/NetBird/);
    expect(before).toMatch(/[Ll]ive sets 2\b/);
  });

  // Express as the API loads it, from the API's own dependencies.
  const express = createRequire(join(ROOT, 'apps/api/package.json'))('express') as (() => {
    set(key: string, value: unknown): void;
    get(path: string, handler: (req: { ip?: string }, res: { send(body: string): void }) => void): void;
    listen(port: number, host: string, done: () => void): Server;
  });
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  /** What the API takes for the caller, with TRUST_PROXY set as index.ts sets it. */
  async function ipSeen(trustProxy: string, forwardedFor: string): Promise<string> {
    const app = express();
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
    app.get('/', (req, res) => res.send(req.ip ?? ''));
    await new Promise<void>((done) => {
      server = app.listen(0, '127.0.0.1', done);
    });
    const a = server!.address();
    const port = typeof a === 'object' && a ? a.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { 'X-Forwarded-For': forwardedFor } });
    const ip = await res.text();
    await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
    return ip;
  }

  // What reaches the API from the web container: NetBird's header (the
  // visitor, 198.51.100.7), with the web nginx's $proxy_add_x_forwarded_for
  // after it (NetBird's own address on the mesh, the placeholder 100.64.0.1).
  const THROUGH_BOTH = '198.51.100.7, 100.64.0.1';

  it('makes the API name the visitor, run through Express itself', async () => {
    expect(value, "live's steps give TRUST_PROXY no count of proxies").toMatch(/^\d+$/);
    expect(await ipSeen(value!, THROUGH_BOTH)).toBe('198.51.100.7');
  });

  it('where one proxy would name NetBird, and none the web container, for every visitor', async () => {
    expect(await ipSeen('1', THROUGH_BOTH)).toBe('100.64.0.1');
    expect(await ipSeen('0', THROUGH_BOTH)).toBe('127.0.0.1');
  });

  it('and a header the visitor forged, had NetBird passed it on, is not believed', async () => {
    expect(value, "live's steps give TRUST_PROXY no count of proxies").toMatch(/^\d+$/);
    expect(await ipSeen(value!, `192.0.2.1, ${THROUGH_BOTH}`)).toBe('198.51.100.7');
  });
});
