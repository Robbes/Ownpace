// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SIGN-IN IN FRONT OF THE FRONT DOOR (workplan 0139, item 8 of *Promised in
 * the drafts, not yet true on `main`*; privacy §7's NetBird row).
 *
 * NetBird's reverse proxy ends TLS for `app.`, `id.`, `status.` and
 * `www.ownpace.eu` and can put a sign-in of its own in front of each. The
 * owner, 2026-09-28, first *"No pin, but SSO on"*, then, asked which hosts sit
 * behind it and whether that changes before the first tester, chose *"Off
 * everywhere at launch"*: *"SSO goes off on every ownpace.eu host before the
 * first invitation, status. included."* `site/legal/README.md`, *To build or
 * to do*: *"To check: from outside the NetBird network, a request to each of
 * the four hosts is answered by the app, the sign-in service, the status page
 * or the website itself, not by NetBird's sign-in page."* With the sign-in on,
 * NetBird's log also keeps each tester's user ID, which privacy §7's row does
 * not name.
 *
 * WHAT A VISITOR GETS, from NetBird's own source (`netbirdio/netbird` at
 * `002755c4`, `proxy/internal/auth/middleware.go`, `authenticateWithSchemes`)
 * and its documentation (`netbirdio/docs` at `33d1b212`,
 * `manage/reverse-proxy/authentication.mdx`): with SSO the only method, a 302
 * to the identity provider's authorize URL, another host; with a password or
 * a PIN, or more than one method, NetBird's own page with 401, which loads
 * its assets from `/__netbird__/` (`proxy/web/web.go`, `PathPrefix`); a denial
 * is its page with 403. A request that arrives over the WireGuard tunnel from
 * a peer of the account may pass SSO without a sign-in page
 * (`forwardWithTunnelPeer`), so this is asked from OUTSIDE the NetBird network:
 * by `scripts/exposure-probe.mjs`, the dispatch-only workflow on a
 * GitHub-hosted runner (0132 T3 (c)).
 *
 * WHAT THIS HOLDS. The probe asks each of the four names for a page, as a
 * visitor would and without following a redirect: `/` of the app, the status
 * page and the website, and the sign-in service's discovery document. A name
 * that answers itself passes; a redirect to another host fails, as NetBird's
 * sign-in; NetBird's own page fails; a name that does not answer fails.
 * `www.ownpace.eu` is asked only on live's front, as the probe asks it
 * anything (0139 T10), and a silence there is failed only when `site_name`
 * is `required`; NetBird's sign-in in front of it fails either way. What a
 * redirect points at is named by its host only, and never when that host is
 * an address: the run's log is public.
 *
 * TWO EDGES, since 2026-09-29 (review). A redirect that stays on the name but
 * goes into NetBird's own pages (`/__netbird__/`) failed, and no case said so:
 * the check could be dropped and every case stayed green, and the log called
 * it a redirect "to another host". And a redirect with no `Location` was taken
 * for the service answering itself, as though it pointed at the page asked
 * for. The first fails as NetBird's own page, the second as not the service.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import {
  NETBIRD_ASSETS,
  PRODUCTION_NAMES,
  SIGN_IN_PAGES,
  SITE_NAME,
  realNetwork,
  runProbe,
  type PageAnswer,
  type ProbeConfig,
  type ProbeIo,
} from './exposure-probe.mjs';

const FRONT = '192.0.2.10';
const OTA_FRONT = '198.51.100.20';
/** Another host's address: where www.ownpace.eu points until the site is routed to live. */
const APEX = '198.51.100.30';

const RESOLVED: Record<string, string[]> = {
  'app.ownpace.eu': [FRONT],
  'id.ownpace.eu': [FRONT],
  'status.ownpace.eu': [FRONT],
  'www.ownpace.eu': [FRONT],
  'app.ota.ownpace.eu': [OTA_FRONT],
  'id.ota.ownpace.eu': [OTA_FRONT],
  'www.ota.ownpace.eu': [OTA_FRONT],
};

/** The four names, and what each should be when it answers itself. */
const FOUR = [
  ['app.ownpace.eu', '/', 'the app'],
  ['id.ownpace.eu', '/.well-known/openid-configuration', 'the sign-in service'],
  ['status.ownpace.eu', '/', 'the status page'],
  ['www.ownpace.eu', '/', 'the website'],
] as const;

const urlOf = (name: string) => {
  const entry = FOUR.find(([n]) => n === name)!;
  return `https://${entry[0]}${entry[1]}`;
};

/** How NetBird's SSO answers a visitor: a 302 to its identity provider. */
const TO_NETBIRD: PageAnswer = {
  status: 302,
  location: 'https://login.netbird.example/oauth2/authorize?client_id=c9&redirect_uri=https%3A%2F%2Fproxy.example%2Fcb&state=s3cr3t-q1',
};
/** NetBird's own page, for a password or a PIN: 401, its assets under /__netbird__/. */
const NETBIRD_PAGE: PageAnswer = { status: 401, netbird: true };
const ITSELF: PageAnswer = { status: 200, netbird: false };

interface Fake {
  pages?: Record<string, PageAnswer>;
  resolved?: Record<string, string[]>;
}

function fakeIo(fake: Fake = {}): { io: ProbeIo; lines: string[]; asked: string[] } {
  const lines: string[] = [];
  const asked: string[] = [];
  const io: ProbeIo = {
    resolve: async (name) => ({ addresses: (fake.resolved ?? RESOLVED)[name] ?? [] }),
    connect: async () => 'silent',
    tls: async (name) => ([...PRODUCTION_NAMES, SITE_NAME].includes(name) ? { state: 'tls' } : { state: 'none', why: 'timeout' }),
    issuer: async () => ({ issuer: 'https://id.ownpace.eu' }),
    page: async (url) => {
      asked.push(url);
      return fake.pages?.[url] ?? ITSELF;
    },
    print: (line) => lines.push(line),
  };
  return { io, lines, asked };
}

const REPORT: ProbeConfig = { ports: [3001, 3123], host: '', otaMode: 'report', siteMode: 'report' };
const REQUIRED: ProbeConfig = { ...REPORT, siteMode: 'required' };

/** Nothing printed names an address, and no redirect's query reaches the log. */
function expectNothingLeaked(lines: readonly string[]): void {
  const printed = lines.filter((l) => !l.startsWith('::add-mask::')).join('\n');
  expect(printed).not.toMatch(/(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/);
  expect(printed).not.toContain('::');
  expect(printed).not.toContain('s3cr3t-q1');
  expect(printed).not.toContain('client_id');
}

/** The verdict on one name's page: the line that starts with the name and its path. */
const lineFor = (lines: readonly string[], name: string) =>
  lines.filter((l) => /^(pass|FAIL|note) {2}/.test(l) && l.slice(6).startsWith(`${name}/`));

describe('the four names the owner switched NetBird\'s sign-in off for', () => {
  it('are the probe\'s, each with the page a visitor asks for first', () => {
    expect(SIGN_IN_PAGES.map((p) => [p.name, p.path, p.what])).toEqual(FOUR.map((f) => [...f]));
    expect(NETBIRD_ASSETS).toBe('/__netbird__/');
  });
});

describe('a name that answers itself', () => {
  it('passes, each of the four asked once, and says what answered', async () => {
    const { io, lines, asked } = fakeIo();
    expect(await runProbe(REQUIRED, io), lines.join('\n')).toBe(0);
    expect([...asked].sort()).toEqual(FOUR.map(([n]) => urlOf(n)).sort());
    for (const [name, , what] of FOUR) {
      const said = lineFor(lines, name);
      expect(said, name).toHaveLength(1);
      expect(said[0]).toMatch(new RegExp(`^pass {2}${name.replace(/\./g, '\\.')}/.*${what}.*itself.*200`));
    }
    expectNothingLeaked(lines);
  });

  it('passes a redirect that stays on the same name: the service\'s own', async () => {
    const { io, lines } = fakeIo({
      pages: { [urlOf('status.ownpace.eu')]: { status: 302, location: '/dashboard' } },
    });
    expect(await runProbe(REPORT, io), lines.join('\n')).toBe(0);
    expect(lineFor(lines, 'status.ownpace.eu')[0]).toMatch(/^pass {2}.*the status page.*itself.*302.*same name/);
  });
});

describe('NetBird\'s sign-in in front of a name', () => {
  it.each(FOUR.map(([n, , w]) => [n, w] as const))(
    '%s: a redirect to its identity provider fails, naming the host and nothing of the query',
    async (name, what) => {
      for (const config of [REPORT, REQUIRED]) {
        const { io, lines } = fakeIo({ pages: { [urlOf(name)]: TO_NETBIRD } });
        expect(await runProbe(config, io), lines.join('\n')).toBe(1);
        const said = lineFor(lines, name);
        expect(said).toHaveLength(1);
        expect(said[0]).toMatch(/^FAIL {2}/);
        expect(said[0]).toContain("NetBird's sign-in");
        expect(said[0]).toContain('login.netbird.example');
        expect(said[0]).toContain(`not ${what}`);
        expect(said[0]).toMatch(/0139/);
        expectNothingLeaked(lines);
      }
    },
  );

  it.each(FOUR.map(([n, , w]) => [n, w] as const))(
    '%s: NetBird\'s own page (a password or a PIN) fails',
    async (name, what) => {
      for (const config of [REPORT, REQUIRED]) {
        const { io, lines } = fakeIo({ pages: { [urlOf(name)]: NETBIRD_PAGE } });
        expect(await runProbe(config, io)).toBe(1);
        const said = lineFor(lines, name)[0]!;
        expect(said).toMatch(/^FAIL {2}.*401/);
        expect(said).toContain("NetBird's own page");
        expect(said).toContain(`not ${what}`);
      }
    },
  );

  it('fails NetBird\'s page even when it answers 200', async () => {
    const { io, lines } = fakeIo({ pages: { [urlOf('app.ownpace.eu')]: { status: 200, netbird: true } } });
    expect(await runProbe(REPORT, io)).toBe(1);
    expect(lineFor(lines, 'app.ownpace.eu')[0]).toMatch(/^FAIL {2}.*NetBird's own page/);
  });

  it.each([
    ['absolute', 'https://app.ownpace.eu/__netbird__/login?state=s3cr3t-q1'],
    ['relative', '/__netbird__/login?state=s3cr3t-q1'],
  ])(
    'fails a redirect on the same name into NetBird\'s own pages (%s), and says it is NetBird\'s, not another host',
    async (_how, location) => {
      const { io, lines } = fakeIo({ pages: { [urlOf('app.ownpace.eu')]: { status: 302, location } } });
      expect(await runProbe(REPORT, io)).toBe(1);
      const said = lineFor(lines, 'app.ownpace.eu')[0]!;
      expect(said).toMatch(/^FAIL {2}.*302/);
      expect(said).toContain("NetBird's own page");
      expect(said).toContain('not the app');
      expect(said).not.toContain('another host');
      expect(said).toMatch(/0139/);
      expectNothingLeaked(lines);
    },
  );

  it('never prints the address a redirect points at', async () => {
    const { io, lines } = fakeIo({
      pages: { [urlOf('id.ownpace.eu')]: { status: 302, location: 'https://192.0.2.44/authorize?state=s3cr3t-q1' } },
    });
    expect(await runProbe(REPORT, io)).toBe(1);
    expect(lineFor(lines, 'id.ownpace.eu')[0]).toMatch(/^FAIL {2}.*an address \(not printed\)/);
    expectNothingLeaked(lines);
  });
});

describe('a name that does not answer itself for another reason', () => {
  it.each(FOUR.slice(0, 3).map(([n, , w]) => [n, w] as const))(
    '%s: no answer at all fails, with the error\'s code',
    async (name) => {
      const { io, lines } = fakeIo({ pages: { [urlOf(name)]: { why: 'ECONNREFUSED' } } });
      expect(await runProbe(REPORT, io)).toBe(1);
      expect(lineFor(lines, name)[0]).toMatch(/^FAIL {2}.*does not answer \(ECONNREFUSED\)/);
    },
  );

  it('www.ownpace.eu: no answer fails when site_name is required, and is recorded otherwise', async () => {
    const quiet = { pages: { [urlOf(SITE_NAME)]: { why: 'timeout' } } };
    const required = fakeIo(quiet);
    expect(await runProbe(REQUIRED, required.io)).toBe(1);
    expect(lineFor(required.lines, SITE_NAME)[0]).toMatch(/^FAIL {2}.*does not answer \(timeout\).*site_name is required/);
    const report = fakeIo(quiet);
    expect(await runProbe(REPORT, report.io)).toBe(0);
    expect(lineFor(report.lines, SITE_NAME)[0]).toMatch(/^note {2}.*does not answer \(timeout\).*site_name is report/);
  });

  it('a redirect that says nowhere, with no Location, fails: it is not the service answering', async () => {
    for (const status of [301, 302, 307]) {
      const { io, lines } = fakeIo({ pages: { [urlOf('status.ownpace.eu')]: { status, netbird: false } } });
      expect(await runProbe(REPORT, io)).toBe(1);
      const said = lineFor(lines, 'status.ownpace.eu')[0]!;
      expect(said).toMatch(new RegExp(`^FAIL {2}.*${status}`));
      expect(said).toContain('no Location');
      expect(said).toContain('not the status page');
    }
  });

  it.each([
    [401, 'a sign-in or access page'],
    [403, 'a sign-in or access page'],
    [502, 'not the app'],
    [404, 'not the app'],
  ] as const)('%s from the app fails: %s', async (status, words) => {
    const { io, lines } = fakeIo({ pages: { [urlOf('app.ownpace.eu')]: { status, netbird: false } } });
    expect(await runProbe(REPORT, io)).toBe(1);
    const said = lineFor(lines, 'app.ownpace.eu')[0]!;
    expect(said).toMatch(new RegExp(`^FAIL {2}.*${status}`));
    expect(said).toContain(words);
  });
});

describe('www.ownpace.eu, asked only on live\'s front (0139 T10)', () => {
  it('pointed at another host, it is not asked, and a note says why', async () => {
    const { io, lines, asked } = fakeIo({ resolved: { ...RESOLVED, 'www.ownpace.eu': [APEX] } });
    await runProbe(REPORT, io);
    expect(asked).not.toContain(urlOf(SITE_NAME));
    expect(lineFor(lines, SITE_NAME)).toEqual([]);
    expect(lines.join('\n')).toMatch(/note {2}www\.ownpace\.eu: not asked for NetBird's sign-in/);
    expectNothingLeaked(lines);
  });
});

describe('the real network, against a web server on this machine', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  const listen = async (s: Server): Promise<number> => {
    await new Promise<void>((done) => s.listen(0, '127.0.0.1', done));
    const a = s.address();
    return typeof a === 'object' && a ? a.port : 0;
  };

  it('reads the status, a redirect\'s Location without following it, and NetBird\'s asset path', async () => {
    server = createServer((req, res) => {
      if (req.url === '/away') {
        res.writeHead(302, { Location: TO_NETBIRD.location, Connection: 'close' });
        res.end();
      } else if (req.url === '/netbird') {
        res.writeHead(401, { 'Content-Type': 'text/html', Connection: 'close' });
        res.end(`<link rel="stylesheet" href="${NETBIRD_ASSETS}assets/login.css">`);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
        res.end('<div id="root"></div>');
      }
    });
    const port = await listen(server);
    const net = realNetwork({ fetchMs: 3000 });
    expect(await net.page(`http://127.0.0.1:${port}/`)).toEqual({ status: 200, netbird: false });
    expect(await net.page(`http://127.0.0.1:${port}/away`)).toEqual({ status: 302, location: TO_NETBIRD.location, netbird: false });
    expect(await net.page(`http://127.0.0.1:${port}/netbird`)).toEqual({ status: 401, netbird: true });
  });

  it('gives only an error\'s code when nothing answers', async () => {
    const closed = createServer();
    const port = await listen(closed);
    await new Promise<void>((done) => closed.close(() => done()));
    const answer = await realNetwork({ fetchMs: 3000 }).page(`http://127.0.0.1:${port}/`);
    expect(answer).toEqual({ why: 'ECONNREFUSED' });
  });
});
