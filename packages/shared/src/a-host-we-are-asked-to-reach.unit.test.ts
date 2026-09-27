// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A HOST WE ARE ASKED TO REACH (workplan 0136 T1).
 *
 * The managed edition connected to any host a tester typed, from inside the
 * stack's own network, and said what came back: `127.0.0.1`, `postgres` or
 * `169.254.169.254` reached the service's own database, a neighbour's
 * published port or a cloud machine's metadata. Nothing refused an internal
 * address, and redirects were followed silently.
 *
 * What this pins:
 *
 * - one address inside each refused range is refused, and the first address
 *   outside each prefix is not, so a range removed or widened turns this red;
 * - an IPv4-mapped IPv6 address is judged as the IPv4 inside it;
 * - a single-label name, and a host field that is not a host, are refused
 *   before any lookup;
 * - every address a name resolves to is checked, not only the first;
 * - the socket goes to the checked address while TLS keeps the typed name;
 * - through a real server: a redirect, and a hop to another name, meet the
 *   same check as the first request, and the refusal is said as ours;
 * - with the rule off, nothing changes (the appliance).
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import {
  REFUSED_RANGES,
  isRefusedAddress,
  refusedHostShape,
  reachableAddress,
  checkedConnector,
  refuseInternalAddresses,
  refusesInternalAddresses,
  tenantFetch,
  reachableHost,
  HostInsideOurNetwork,
  type ReachableHostRule,
  type ResolveAll,
} from './reachable-host.ts';

/**
 * One address inside each range the plan names (0136 §3, T1), keyed by the
 * range, written out here rather than read from `REFUSED_RANGES`, so a range
 * dropped from the module is missed here.
 */
const INSIDE: Record<string, string> = {
  '0.0.0.0/8': '0.1.2.3',
  '10.0.0.0/8': '10.20.30.40',
  // The address guard's placeholder, the one address in this range the
  // repository may print (`scripts/an-address-that-was-not-an-example`).
  '100.64.0.0/10': '100.64.0.1',
  '127.0.0.0/8': '127.0.0.53',
  '169.254.0.0/16': '169.254.169.254',
  '172.16.0.0/12': '172.20.0.1',
  '192.168.0.0/16': '192.168.1.10',
  '224.0.0.0/4': '239.255.255.250',
  '240.0.0.0/4': '255.255.255.255',
  '::/128': '::',
  '::1/128': '::1',
  'fc00::/7': 'fd12:3456::1',
  'fe80::/10': 'fe80::1',
  'ff00::/8': 'ff02::1',
};

/** The first address past each prefix: a range widened by a bit refuses one of these. */
const JUST_OUTSIDE = [
  '1.0.0.1',
  '11.0.0.1',
  '100.63.255.255',
  '100.128.0.1',
  '128.0.0.1',
  '169.255.0.1',
  '172.15.255.255',
  '172.32.0.1',
  '192.167.255.255',
  '192.169.0.1',
  '223.255.255.255',
  '::2',
  'fbff::1',
  'fe00::1',
  'fec0::1',
];

const PUBLIC = ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'];

describe('the refused ranges', () => {
  it('lists exactly the ranges the plan names', () => {
    expect(REFUSED_RANGES.map((r) => r.cidr).sort()).toEqual(Object.keys(INSIDE).sort());
  });

  it.each(Object.entries(INSIDE))('refuses an address inside %s (%s)', (_range, address) => {
    expect(isRefusedAddress(address)).toBe(true);
  });

  it.each(JUST_OUTSIDE)('does not refuse %s, just outside a range', (address) => {
    expect(isRefusedAddress(address)).toBe(false);
  });

  it.each(PUBLIC)('does not refuse a public address, %s', (address) => {
    expect(isRefusedAddress(address)).toBe(false);
  });

  it('judges an IPv4-mapped IPv6 address as the IPv4 address inside it', () => {
    expect(isRefusedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isRefusedAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isRefusedAddress('::ffff:7f00:1')).toBe(true);
    expect(isRefusedAddress('::ffff:1.1.1.1')).toBe(false);
  });

  it('refuses what is not an address at all', () => {
    expect(isRefusedAddress('')).toBe(true);
    expect(isRefusedAddress('dav.example.com')).toBe(true);
  });
});

describe('a host refused by its shape, before any lookup', () => {
  it.each(['postgres', 'localhost', 'trigger-docker-proxy', 'nextcloud.'])('refuses the single-label name %s', (host) => {
    expect(refusedHostShape(host)).toBe('a single-label name');
  });

  it.each(['a/b', 'user@example.com', 'example.com:5432', ' example.com', '', '.example.com', 'a..b', 'example.com/dav'])(
    'refuses %j, which is not a host name',
    (host) => {
      expect(refusedHostShape(host)).toBe('not a host name');
    },
  );

  it.each(['dav.example.com', 'cloud.example.org.', '1.1.1.1', '[::1]', '10.0.0.1'])(
    'passes %s on its shape (an address is judged by its range)',
    (host) => {
      expect(refusedHostShape(host)).toBeUndefined();
    },
  );
});

/** A resolver that answers from a table, and records what it was asked. */
function resolver(table: Record<string, string[]>): ResolveAll & { asked: string[] } {
  const asked: string[] = [];
  const resolve = async (host: string) => {
    asked.push(host);
    const answers = table[host];
    if (!answers) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
    return answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return Object.assign(resolve, { asked });
}

function rule(table: Record<string, string[]>, allow: string[] = []): ReachableHostRule & { resolve: ReturnType<typeof resolver> } {
  return { allow: new Set(allow), resolve: resolver(table) };
}

describe('the address to connect to', () => {
  it('is the address a name resolves to, when it is outside every range', async () => {
    await expect(reachableAddress('dav.example.com', rule({ 'dav.example.com': ['203.0.113.7'] }))).resolves.toEqual({
      address: '203.0.113.7',
      family: 4,
    });
  });

  it('is refused when the name resolves inward, and the refusal names the host as typed, never the address', async () => {
    const attempt = reachableAddress('Inward.Example.com', rule({ 'inward.example.com': ['10.0.0.5'] }));
    await expect(attempt).rejects.toBeInstanceOf(HostInsideOurNetwork);
    const error = (await attempt.catch((e: unknown) => e)) as HostInsideOurNetwork;
    expect(error.host).toBe('Inward.Example.com');
    expect(error.code).toBe('host_inside_our_network');
    expect(error.message).toMatch(/^Inward\.Example\.com is an address inside this service's own network/);
    expect(error.message).not.toContain('10.0.0.5');
  });

  it('checks EVERY address a name resolves to, not only the first', async () => {
    const mixed = rule({ 'mixed.example.com': ['203.0.113.7', '192.168.1.10'] });
    await expect(reachableAddress('mixed.example.com', mixed)).rejects.toBeInstanceOf(HostInsideOurNetwork);
  });

  it('refuses a single-label name without asking the resolver', async () => {
    const r = rule({ postgres: ['203.0.113.7'] });
    await expect(reachableAddress('postgres', r)).rejects.toBeInstanceOf(HostInsideOurNetwork);
    expect(r.resolve.asked).toEqual([]);
  });

  it('admits a name on the allowed list although it resolves inward, and only by its exact name', async () => {
    const r = rule({ nextcloud: ['172.18.0.5'], 'nextcloud.example.com': ['172.18.0.5'] }, ['nextcloud']);
    await expect(reachableAddress('nextcloud', r)).resolves.toEqual({ address: '172.18.0.5', family: 4 });
    await expect(reachableAddress('nextcloud.example.com', r)).rejects.toBeInstanceOf(HostInsideOurNetwork);
  });

  it('never admits an address literal, whatever the list says', async () => {
    await expect(reachableAddress('127.0.0.1', rule({}, ['127.0.0.1']))).rejects.toBeInstanceOf(HostInsideOurNetwork);
    await expect(reachableAddress('[::1]', rule({}))).rejects.toBeInstanceOf(HostInsideOurNetwork);
  });

  it('connects to a public address literal as it is, without a lookup', async () => {
    const r = rule({});
    await expect(reachableAddress('8.8.8.8', r)).resolves.toEqual({ address: '8.8.8.8', family: 4 });
    await expect(reachableAddress('[2606:4700:4700::1111]', r)).resolves.toEqual({
      address: '2606:4700:4700::1111',
      family: 6,
    });
    expect(r.resolve.asked).toEqual([]);
  });
});

describe('the connector', () => {
  const options = { hostname: 'dav.example.com', host: 'dav.example.com:443', protocol: 'https:', port: '443' };

  it('opens the socket to the checked address and passes the typed host on, which TLS names and verifies', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const connect = checkedConnector(rule({ 'dav.example.com': ['203.0.113.7'] }), ((opts: Record<string, unknown>, cb: (e: null) => void) => {
      seen.push(opts);
      cb(null);
    }) as never);
    await new Promise<void>((done) => connect(options as never, (() => done()) as never));
    // undici takes the TLS server name from `host` (`getServerName`), so SNI and
    // the certificate check stay on the typed name.
    expect(seen).toEqual([{ ...options, hostname: '203.0.113.7' }]);
  });

  it('never opens a socket for a refused host, and answers with the refusal', async () => {
    let opened = false;
    const connect = checkedConnector(rule({ 'dav.example.com': ['127.0.0.1'] }), (() => {
      opened = true;
    }) as never);
    const error = await new Promise<unknown>((done) => connect(options as never, ((e: unknown) => done(e)) as never));
    expect(error).toBeInstanceOf(HostInsideOurNetwork);
    expect(opened).toBe(false);
  });
});

describe('a request to a host a tenant gave us', () => {
  let release: (() => void) | undefined;
  let server: http.Server | undefined;

  afterEach(async () => {
    release?.();
    release = undefined;
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = undefined;
  });

  /** A server on 127.0.0.1 that answers, redirects on request, and counts what reached it. */
  async function stub() {
    const reached: string[] = [];
    const answer = async (req: http.IncomingMessage, res: http.ServerResponse) => {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      reached.push(`${req.method} ${req.url} ${req.headers.host}`);
      const port = (server!.address() as { port: number }).port;
      if (req.url === '/to-loopback') {
        res.writeHead(302, { location: `http://127.0.0.1:${port}/secret` });
        return res.end();
      }
      if (req.url === '/to-other') {
        res.writeHead(302, { location: `http://other.test:${port}/secret` });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`${req.method} ${req.url} ${body}`);
    };
    server = http.createServer((req, res) => {
      void answer(req, res);
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    return { port: (server.address() as { port: number }).port, reached };
  }

  /** The rule, with the stub admitted by name: the way the gate's stack admits its demo targets. */
  function switchOn() {
    release = refuseInternalAddresses({
      allow: ['stub.test'],
      resolve: resolver({ 'stub.test': ['127.0.0.1'], 'other.test': ['127.0.0.1'] }),
    });
  }

  it('is the global fetch, unchanged, while the rule is off (the appliance)', async () => {
    const { port } = await stub();
    expect(refusesInternalAddresses()).toBe(false);
    const response = await tenantFetch(`http://127.0.0.1:${port}/ok`);
    expect(response.status).toBe(200);
  });

  it('reaches an admitted host, with the typed name as its Host', async () => {
    const { port, reached } = await stub();
    switchOn();
    const response = await tenantFetch(`http://stub.test:${port}/ok`);
    expect(await response.text()).toBe('GET /ok ');
    expect(reached).toEqual([`GET /ok stub.test:${port}`]);
  });

  it('refuses an address inside the network, said as ours rather than as "fetch failed"', async () => {
    const { port, reached } = await stub();
    switchOn();
    await expect(tenantFetch(`http://127.0.0.1:${port}/ok`)).rejects.toBeInstanceOf(HostInsideOurNetwork);
    expect(reached).toEqual([]);
  });

  it('checks a redirect as it checks the first request', async () => {
    const { port, reached } = await stub();
    switchOn();
    await expect(tenantFetch(`http://stub.test:${port}/to-loopback`)).rejects.toBeInstanceOf(HostInsideOurNetwork);
    expect(reached, 'the redirect was followed to the loopback address').toEqual([`GET /to-loopback stub.test:${port}`]);
  });

  it('checks a hop to another name that resolves inward', async () => {
    const { port, reached } = await stub();
    switchOn();
    await expect(tenantFetch(`http://stub.test:${port}/to-other`)).rejects.toBeInstanceOf(HostInsideOurNetwork);
    expect(reached).toEqual([`GET /to-other stub.test:${port}`]);
  });

  it('carries a streamed body through the rule', async () => {
    const { port } = await stub();
    switchOn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('streamed'));
        controller.close();
      },
    });
    const response = await tenantFetch(`http://stub.test:${port}/put`, { method: 'PUT', body, duplex: 'half' } as RequestInit);
    expect(await response.text()).toBe('PUT /put streamed');
  });

  it('goes back to the global fetch once the rule is released', async () => {
    const { port } = await stub();
    switchOn();
    release!();
    release = undefined;
    expect(refusesInternalAddresses()).toBe(false);
    expect((await tenantFetch(`http://127.0.0.1:${port}/ok`)).status).toBe(200);
  });
});

describe('a host a client opens its own socket to (IMAP)', () => {
  let release: (() => void) | undefined;
  afterEach(() => {
    release?.();
    release = undefined;
  });

  it('is the host as typed while the rule is off', async () => {
    await expect(reachableHost('imap.example.com')).resolves.toEqual({ host: 'imap.example.com' });
  });

  it('is the checked address with the typed name kept for TLS, once the rule is on', async () => {
    release = refuseInternalAddresses({ resolve: resolver({ 'imap.example.com': ['203.0.113.9'] }) });
    await expect(reachableHost('imap.example.com')).resolves.toEqual({
      host: '203.0.113.9',
      servername: 'imap.example.com',
    });
    await expect(reachableHost('8.8.8.8')).resolves.toEqual({ host: '8.8.8.8' });
  });

  it('is refused for a host inside the network', async () => {
    release = refuseInternalAddresses({ resolve: resolver({ 'imap.example.com': ['192.168.0.2'] }) });
    await expect(reachableHost('imap.example.com')).rejects.toBeInstanceOf(HostInsideOurNetwork);
    await expect(reachableHost('stalwart')).rejects.toBeInstanceOf(HostInsideOurNetwork);
  });
});

describe('where Node code finds it', () => {
  it('is not in the package index, which the browser bundle loads', () => {
    // The web app imports `@openmig/shared` from its index. This module builds a
    // BlockList and loads undici as it is imported, and a browser has neither:
    // through the index, the web app's own build type-checked it and failed.
    const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(index).not.toMatch(/from '\.\/reachable-host(\.ts)?'/);
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(manifest.exports['./reachable-host']).toBe('./src/reachable-host.ts');
  });
});
