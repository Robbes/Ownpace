// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A HOST WE ARE ASKED TO REACH, AT THE TEST BUTTON (workplan 0136 T1).
 *
 * The rule in `@openmig/shared/reachable-host` refuses a host that resolves
 * inside our own network, on every connection a request opens. A tester meets
 * it first at the Test button, which is `probeTargetConnection`. These drive
 * the probe for each kind of target a tester types a host for, with the rule
 * on, against a stub on this machine:
 *
 * - The stub is admitted by name (`dav.test`, on the allowed list, the way the
 *   gate's demo targets are to be, 0136 T2), and answers every request with a
 *   redirect to itself at `127.0.0.1`. A client that follows the redirect
 *   arrives by that loopback address, and the stub sees it. So "nothing
 *   arrived by the loopback address" means "the redirect was not followed".
 *   And because only the rule knows that `dav.test` is this machine, a
 *   request that arrived at all went through it.
 * - An IMAP host typed as `127.0.0.1` is refused before a socket opens, and
 *   the stub listening there sees no connection.
 *
 * With the rule off, as on the appliance, the same probes typed as
 * `127.0.0.1` do reach the stub and do follow its redirect. That is the
 * control: it shows the stub can be reached and its redirect followed, so the
 * zero above is the rule's doing.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { refuseInternalAddresses, type ResolveAll } from '@openmig/shared/reachable-host';
import { probeTargetConnection } from './probe-connection.ts';

/** Where the stub's redirect sends a client: itself, by the loopback address. */
const INSIDE = '/inside';

interface Arrival {
  readonly host: string;
  readonly path: string;
}

let arrivals: Arrival[] = [];
let imapConnections = 0;
let server: http.Server;
let imapStub: net.Server;
let port = 0;
let imapPort = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url ?? '/';
    arrivals.push({ host: req.headers.host ?? '', path });
    req.resume();
    if (path.startsWith(INSIDE)) {
      // Reached only by a client that followed the redirect.
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('followed');
      return;
    }
    res.writeHead(301, { location: `http://127.0.0.1:${port}${INSIDE}${path}` });
    res.end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;

  imapStub = net.createServer((socket) => {
    imapConnections++;
    socket.end('* BYE not a mail server\r\n');
  });
  await new Promise<void>((done) => imapStub.listen(0, '127.0.0.1', done));
  imapPort = (imapStub.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await new Promise<void>((done) => imapStub.close(() => done()));
});

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
  arrivals = [];
  imapConnections = 0;
});

/** `dav.test` is this machine; every other name resolves nowhere. */
const resolve: ResolveAll = async (host) => (host === 'dav.test' ? [{ address: '127.0.0.1', family: 4 }] : []);

const CREDS = { username: 'u', password: 'p' };

/** Each kind of HTTP target a tester types a host for, with its config. */
const HTTP_TARGETS = [
  { kind: 'caldav', config: (origin: string) => ({ url: `${origin}/dav/` }) },
  { kind: 'carddav', config: (origin: string) => ({ url: `${origin}/dav/` }) },
  { kind: 'webdav', config: (origin: string) => ({ url: `${origin}/dav/` }) },
  { kind: 'jmap', config: (origin: string) => ({ type: 'jmap', baseUrl: origin }) },
] as const;

describe('the Test button, with the rule on', () => {
  it.each(HTTP_TARGETS)('a $kind target: reached by its admitted name, and its redirect inward not followed', async ({ kind, config }) => {
    release = refuseInternalAddresses({ allow: ['dav.test'], resolve });

    const result = await probeTargetConnection(kind, config(`http://dav.test:${port}`), CREDS);

    expect(result.ok).toBe(false);
    expect(
      arrivals.filter((a) => a.host === `dav.test:${port}`).length,
      'nothing arrived by the admitted name, so the probe did not go through the rule',
    ).toBeGreaterThan(0);
    expect(
      arrivals.filter((a) => a.path.startsWith(INSIDE)),
      'a request followed the redirect to the loopback address',
    ).toEqual([]);
  });

  it('an IMAP host typed as 127.0.0.1: refused before a socket opens, in our words', async () => {
    release = refuseInternalAddresses({ resolve });

    const result = await probeTargetConnection(
      'imap',
      { host: '127.0.0.1', port: imapPort, useSsl: false, user: 'u' },
      CREDS,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/^127\.0\.0\.1 is an address inside this service's own network/);
    expect(imapConnections).toBe(0);
  });
});

describe('the control: the same probes with the rule off, as on the appliance', () => {
  it.each(HTTP_TARGETS)('a $kind target at 127.0.0.1 is reached, and its redirect followed', async ({ kind, config }) => {
    await probeTargetConnection(kind, config(`http://127.0.0.1:${port}`), CREDS);

    expect(arrivals.filter((a) => a.path.startsWith(INSIDE)).length).toBeGreaterThan(0);
  });

  it('an IMAP host at 127.0.0.1 is connected to', async () => {
    await probeTargetConnection('imap', { host: '127.0.0.1', port: imapPort, useSsl: false, user: 'u' }, CREDS);

    expect(imapConnections).toBeGreaterThan(0);
  });
});
