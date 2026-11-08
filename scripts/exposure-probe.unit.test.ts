// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THE OUTSIDE PROBE PRINTS, AND WHEN IT PASSES (workplan 0132 T3 (c)).
 *
 * `scripts/exposure-probe.mjs` is what `.github/workflows/exposure-probe.yml`
 * runs on a GitHub-hosted runner. It resolves the production names
 * (`app.ownpace.eu`, `id.ownpace.eu`, `status.ownpace.eu`) and the OTA names
 * (`app.ota.ownpace.eu`, `id.ota.ownpace.eu`, `www.ota.ownpace.eu`), and tries
 * every port `scripts/exposure-probe-ports.mjs` derives, plus live's from the
 * repository variable, on each address they resolve to and on the machine's
 * own address when the secret `EXPOSURE_PROBE_HOST` holds it.
 *
 * `www.ownpace.eu`, the production site live serves once its `.env` switches
 * it on (0139 T10), is tried only on live's front, the addresses a production
 * name or the secret resolves to. Until the site is routed the name points at
 * another host (the apex's), and a port answering there is not the machine's:
 * such an address is never tried, and 443 is not asked for the name. The
 * dispatch input `site_name` says whether it must answer yet: `report`, the
 * default, records; `required` fails.
 *
 * IT PASSES WHEN, per 0132 T3: 443 on each production name answers over TLS;
 * the discovery document at `https://id.ownpace.eu` names `https://id.ownpace.eu`
 * as its issuer, so the production names reach live and not the OTA stack; the
 * app's page carries the headers the template at live's own commit states
 * (workplan 0158 T4); and nothing else answers. What the OTA names should do on
 * 443 is the dispatch input `ota_names`: open question 7 is answered, on the
 * mesh only (2026-11-08), and until the owner's step its default, `report`,
 * records what answered without failing on it.
 *
 * ITS LOG NEVER PRINTS AN ADDRESS. The run's log is public. Every address the
 * names resolve to, and the machine's own, is masked with `::add-mask::`
 * before anything else is printed, and nothing the probe prints names one:
 * a finding names the names that resolved to the address and the port, and the
 * machine's own address is called by the secret that holds it. The cases below
 * run the probe with a fake network whose answers are RFC 5737 addresses and
 * assert both halves: the masks come first, and no other line carries an
 * address. Node's own error messages carry the address they failed on, so the
 * probe prints only an error's code.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_TEMPLATE, expectedAppHeaders } from './app-headers.mjs';
import {
  APP_PAGE,
  APP_VERSION,
  ISSUER,
  ORG_REGISTRATION,
  OTA_NAMES,
  PRODUCTION_NAMES,
  SITE_NAME,
  SSL_REQUEST,
  probeConfig,
  realNetwork,
  runProbe,
  type HeadersAnswer,
  type PageAnswer,
  type PostgresAnswer,
  type ProbeIo,
  type ProbeConfig,
} from './exposure-probe.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The app's template as this checkout has it, and the commit the fake live web build names. */
const TEMPLATE = readFileSync(join(REPO_ROOT, APP_TEMPLATE), 'utf8');
const LIVE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** What the template states for the app's page with live's issuer, as `[name, value]` pairs. */
function stated(template = TEMPLATE): Array<[string, string]> {
  const { headers, errors } = expectedAppHeaders(template, ISSUER);
  if (errors.length) throw new Error(errors.join('; '));
  return headers.map((h): [string, string] => [h.name.toLowerCase(), h.value]);
}

const FRONT = '192.0.2.10';
const FRONT_2 = '192.0.2.11';
const OTA_FRONT = '198.51.100.20';
const MACHINE = '203.0.113.5';
/** Another host's address: where www.ownpace.eu points until the site is routed to live. */
const APEX = '198.51.100.30';
/** An IPv6 address, written as the IPv4-mapped form of a documentation address. */
const V6 = '::ffff:192.0.2.12';

type Answer = 'open' | 'closed' | 'silent' | { untried: string };

interface Fake {
  resolved?: Record<string, string[]>;
  unresolvable?: Record<string, string>;
  open?: Array<[string, number]>;
  untried?: string[];
  tls?: Record<string, { state: 'tls' | 'tcp-only' | 'none'; why?: string }>;
  issuer?: { issuer?: string; why?: string };
  /** What PostgreSQL's SSLRequest meets, by `address#port`; said nothing otherwise. */
  postgres?: Record<string, PostgresAnswer>;
  /** What a page answers, by URL; otherwise 404 for the form that founds an organisation, 200 for the rest. */
  pages?: Record<string, PageAnswer>;
  /** What live's version.json names (default: LIVE_COMMIT). */
  version?: { commit?: string; why?: string };
  /** The template by commit (default: this checkout's at LIVE_COMMIT, nothing at any other). */
  templates?: Record<string, string>;
  /** What the app's page answers (default: 200 with what the template states). */
  appPage?: HeadersAnswer;
}

/** What Zitadel answers at the form once disallowPublicOrgRegistration holds. */
const CLOSED: PageAnswer = { status: 404, netbird: false };

const ALL_RESOLVED: Record<string, string[]> = {
  'app.ownpace.eu': [FRONT, FRONT_2],
  'id.ownpace.eu': [FRONT],
  'status.ownpace.eu': [FRONT],
  'www.ownpace.eu': [FRONT],
  'app.ota.ownpace.eu': [OTA_FRONT, V6],
  'id.ota.ownpace.eu': [OTA_FRONT],
  'www.ota.ownpace.eu': [OTA_FRONT],
};

function fakeIo(fake: Fake): {
  io: ProbeIo;
  lines: string[];
  tried: string[];
  tlsAsked: string[];
  pgAsked: string[];
  pagesAsked: string[];
  templatesAsked: string[];
} {
  const lines: string[] = [];
  const tried: string[] = [];
  const tlsAsked: string[] = [];
  const pgAsked: string[] = [];
  const pagesAsked: string[] = [];
  const templatesAsked: string[] = [];
  const io: ProbeIo = {
    resolve: async (name) => {
      const error = fake.unresolvable?.[name];
      if (error) return { addresses: [], error };
      return { addresses: (fake.resolved ?? ALL_RESOLVED)[name] ?? [] };
    },
    connect: async (address, port): Promise<Answer> => {
      tried.push(`${address}#${port}`);
      if (fake.untried?.includes(address)) return { untried: 'ENETUNREACH' };
      return (fake.open ?? []).some(([a, p]) => a === address && p === port) ? 'open' : 'silent';
    },
    postgres: async (address, port) => {
      pgAsked.push(`${address}#${port}`);
      return fake.postgres?.[`${address}#${port}`] ?? { kind: 'silent' };
    },
    tls: async (name) => {
      tlsAsked.push(name);
      return (
        fake.tls?.[name] ??
        ([...PRODUCTION_NAMES, SITE_NAME].includes(name) ? { state: 'tls' } : { state: 'none', why: 'timeout' })
      );
    },
    issuer: async () => fake.issuer ?? { issuer: 'https://id.ownpace.eu' },
    // Each name answers itself, and the form that founds an organisation is
    // closed: what NetBird's sign-in does instead is
    // a-sign-in-in-front-of-the-front-door's.
    page: async (url) => {
      pagesAsked.push(url);
      return fake.pages?.[url] ?? (url === ORG_REGISTRATION ? CLOSED : { status: 200, netbird: false });
    },
    version: async () => fake.version ?? { commit: LIVE_COMMIT },
    template: async (commit) => {
      templatesAsked.push(commit);
      const text = (fake.templates ?? { [LIVE_COMMIT]: TEMPLATE })[commit];
      return text === undefined ? { why: 'git show failed (128)' } : { text };
    },
    headers: async () => fake.appPage ?? { status: 200, headers: stated() },
    print: (line) => lines.push(line),
  };
  return { io, lines, tried, tlsAsked, pgAsked, pagesAsked, templatesAsked };
}

const CONFIG: ProbeConfig = { ports: [3001, 3123, 5432], host: MACHINE, otaMode: 'report', siteMode: 'report' };

/** Every IPv4 and IPv6 literal the fake network handed out. */
const ADDRESSES = [FRONT, FRONT_2, OTA_FRONT, MACHINE, V6];

/** The masks come first, and nothing after them names an address. */
function expectNoAddress(lines: readonly string[]): void {
  const firstOther = lines.findIndex((l) => !l.startsWith('::add-mask::'));
  const lastMask = lines.map((l) => l.startsWith('::add-mask::')).lastIndexOf(true);
  expect(lastMask, 'a mask was printed after another line').toBeLessThan(firstOther === -1 ? Infinity : firstOther);
  const printed = lines.filter((l) => !l.startsWith('::add-mask::')).join('\n');
  for (const a of [...ADDRESSES, APEX]) expect(printed, `the log names ${a}`).not.toContain(a);
  expect(printed).not.toMatch(/(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/);
  expect(printed).not.toContain('::');
}

describe('the probe from outside', () => {
  it('passes when only 443 answers on the production names, and the issuer is live\'s', async () => {
    const { io, lines, tried, tlsAsked } = fakeIo({});
    const code = await runProbe(CONFIG, io);
    expect(code, lines.join('\n')).toBe(0);
    // Every port on every address, and on the machine's own.
    for (const a of [FRONT, FRONT_2, OTA_FRONT, V6, MACHINE]) {
      for (const p of CONFIG.ports) expect(tried, `${a}#${p}`).toContain(`${a}#${p}`);
    }
    for (const n of PRODUCTION_NAMES) expect(tlsAsked).toContain(n);
    expect(lines.join('\n')).toContain('3001 3123 5432');
    expectNoAddress(lines);
  });

  it('masks every address, and the machine\'s own, before it prints anything else', async () => {
    const { io, lines } = fakeIo({});
    await runProbe(CONFIG, io);
    const masks = lines.filter((l) => l.startsWith('::add-mask::')).map((l) => l.slice('::add-mask::'.length));
    for (const a of ADDRESSES) expect(masks).toContain(a);
    expect(lines[0]!.startsWith('::add-mask::')).toBe(true);
  });

  it('fails a port that answers on a name\'s address, naming the names and the port', async () => {
    const { io, lines } = fakeIo({ open: [[FRONT, 5432]] });
    expect(await runProbe(CONFIG, io)).toBe(1);
    const finding = lines.filter((l) => l.includes('5432') && /answers/.test(l));
    expect(finding).toHaveLength(1);
    for (const n of ['app.ownpace.eu', 'id.ownpace.eu', 'status.ownpace.eu', 'www.ownpace.eu']) expect(finding[0]).toContain(n);
    expectNoAddress(lines);
  });

  it('fails a port that answers on the machine\'s own address, calling it by its secret', async () => {
    const { io, lines } = fakeIo({ open: [[MACHINE, 3001]] });
    expect(await runProbe(CONFIG, io)).toBe(1);
    expect(lines.join('\n')).toMatch(/EXPOSURE_PROBE_HOST.*3001.*answers|3001.*EXPOSURE_PROBE_HOST/);
    expectNoAddress(lines);
  });

  it('resolves a machine named rather than addressed, and masks the name and what it resolves to', async () => {
    const { io, lines, tried } = fakeIo({
      resolved: { ...ALL_RESOLVED, 'spark.mesh.example': [MACHINE] },
    });
    expect(await runProbe({ ...CONFIG, host: 'spark.mesh.example' }, io)).toBe(0);
    expect(tried).toContain(`${MACHINE}#3001`);
    const masks = lines.filter((l) => l.startsWith('::add-mask::'));
    expect(masks).toContain('::add-mask::spark.mesh.example');
    expect(masks).toContain(`::add-mask::${MACHINE}`);
    expect(lines.filter((l) => !l.startsWith('::add-mask::')).join('\n')).not.toContain('spark.mesh.example');
  });

  it('says the machine\'s own address was not tried when the secret is empty', async () => {
    const { io, lines } = fakeIo({});
    expect(await runProbe({ ...CONFIG, host: '' }, io)).toBe(0);
    expect(lines.join('\n')).toMatch(/EXPOSURE_PROBE_HOST.*not (set|tried)/);
  });

  it('fails a production name that does not answer over TLS on 443', async () => {
    const { io, lines } = fakeIo({ tls: { 'status.ownpace.eu': { state: 'tcp-only', why: 'CERT_HAS_EXPIRED' } } });
    expect(await runProbe(CONFIG, io)).toBe(1);
    expect(lines.join('\n')).toMatch(/status\.ownpace\.eu.*443.*CERT_HAS_EXPIRED/);
    expectNoAddress(lines);
  });

  it('fails a production name that does not resolve', async () => {
    const { io, lines } = fakeIo({ unresolvable: { 'app.ownpace.eu': 'ENOTFOUND' } });
    expect(await runProbe(CONFIG, io)).toBe(1);
    expect(lines.join('\n')).toMatch(/app\.ownpace\.eu.*ENOTFOUND/);
  });

  it('fails when id.ownpace.eu names the OTA stack\'s issuer, and says whose', async () => {
    const { io, lines } = fakeIo({ issuer: { issuer: 'https://id.ota.ownpace.eu' } });
    expect(await runProbe(CONFIG, io)).toBe(1);
    expect(lines.join('\n')).toContain('https://id.ota.ownpace.eu');
  });

  it('does not repeat an issuer that is not an ownpace.eu name', async () => {
    const issuer = `http://${MACHINE}:3126`;
    const { io, lines } = fakeIo({ issuer: { issuer } });
    expect(await runProbe(CONFIG, io)).toBe(1);
    expect(lines.join('\n')).not.toContain(issuer);
    expectNoAddress(lines);
  });

  it('fails when the discovery document cannot be read, with the reason and no address', async () => {
    const { io, lines } = fakeIo({ issuer: { why: 'HTTP 502' } });
    expect(await runProbe(CONFIG, io)).toBe(1);
    expect(lines.join('\n')).toContain('HTTP 502');
  });

  it('says which addresses it could not try, rather than calling them closed', async () => {
    const { io, lines } = fakeIo({ untried: [V6] });
    expect(await runProbe(CONFIG, io)).toBe(0);
    expect(lines.join('\n')).toMatch(/app\.ota\.ownpace\.eu.*IPv6.*not tried.*ENETUNREACH/);
    expectNoAddress(lines);
  });
});

/**
 * NOBODY CAN FOUND AN ORGANISATION AT LIVE'S SIGN-IN SERVICE (workplan 0135
 * T1; the ask 0132 T3 records). The smoke asks the form on the OTA instance
 * every night and never runs on live, so the probe asks it there: a 404, and
 * only a 404, passes. A 2xx is the form; a redirect is not the refusal; no
 * answer fails as the discovery document's does. No setting makes it a note.
 */
describe('the form that founds an organisation (0135 T1)', () => {
  const formLine = (lines: readonly string[]) => lines.filter((l) => /^(pass|FAIL|note) {2}/.test(l) && l.includes(ORG_REGISTRATION));

  it('is the issuer\'s own page, asked once, and a 404 passes', async () => {
    expect(ISSUER).toBe('https://id.ownpace.eu');
    expect(ORG_REGISTRATION).toBe(`${ISSUER}/ui/login/register/org`);
    const { io, lines, pagesAsked } = fakeIo({});
    expect(await runProbe(CONFIG, io), lines.join('\n')).toBe(0);
    expect(pagesAsked.filter((u) => u === ORG_REGISTRATION)).toHaveLength(1);
    expect(formLine(lines)).toEqual([
      'pass  https://id.ownpace.eu/ui/login/register/org answers 404: the form that founds an organisation is not served (workplan 0135 T1)',
    ]);
    expectNoAddress(lines);
  });

  it.each([200, 204])('FAILS a %s: the form is served, and the line says what sets it', async (status) => {
    const { io, lines } = fakeIo({ pages: { [ORG_REGISTRATION]: { status, netbird: false } } });
    expect(await runProbe(CONFIG, io)).toBe(1);
    const said = formLine(lines);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(new RegExp(`^FAIL {2}.*answers ${status}, not 404: the form that founds an organisation is served`));
    expect(said[0]).toContain('disallowPublicOrgRegistration');
    expect(said[0]).toContain('workplan 0135 T1');
  });

  it.each([
    ['on the same name', '/ui/login/login?authRequestID=s3cr3t-q1', 'id.ownpace.eu'],
    ['to another host', 'https://login.netbird.example/oauth2/authorize?state=s3cr3t-q1', 'login.netbird.example'],
    ['to an address', 'https://192.0.2.44/authorize?state=s3cr3t-q1', 'an address (not printed)'],
  ])('FAILS a redirect %s, never followed, naming its host and nothing of its query', async (_where, location, host) => {
    for (const status of [301, 302, 303, 307, 308]) {
      const { io, lines } = fakeIo({ pages: { [ORG_REGISTRATION]: { status, location, netbird: false } } });
      expect(await runProbe(CONFIG, io)).toBe(1);
      const said = formLine(lines);
      expect(said).toHaveLength(1);
      expect(said[0]).toMatch(new RegExp(`^FAIL {2}.*answers ${status}, a redirect to ${host.replace(/[.()]/g, '\\$&')}, not 404`));
      const printed = lines.filter((l) => !l.startsWith('::add-mask::')).join('\n');
      expect(printed).not.toContain('s3cr3t-q1');
      expect(printed).not.toContain('192.0.2.44');
      expectNoAddress(lines);
    }
  });

  it('FAILS a redirect with no Location: it points nowhere, and is not the refusal', async () => {
    const { io, lines } = fakeIo({ pages: { [ORG_REGISTRATION]: { status: 302, netbird: false } } });
    expect(await runProbe(CONFIG, io)).toBe(1);
    expect(formLine(lines)[0]).toMatch(/^FAIL {2}.*answers 302 with no Location, not 404/);
  });

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'TimeoutError'])(
    'FAILS when nothing answers (%s), as the discovery document does: a page nobody could ask is not known to be closed',
    async (why) => {
      const { io, lines } = fakeIo({ pages: { [ORG_REGISTRATION]: { why } } });
      expect(await runProbe(CONFIG, io)).toBe(1);
      expect(formLine(lines)[0]).toMatch(new RegExp(`^FAIL {2}.*does not answer \\(${why}\\), so the form that founds an organisation is not known to be closed`));
    },
  );

  it.each([404, 200, 401])('FAILS NetBird\'s own page, even a %s: it is not the sign-in service\'s refusal', async (status) => {
    const { io, lines } = fakeIo({ pages: { [ORG_REGISTRATION]: { status, netbird: true } } });
    expect(await runProbe(CONFIG, io)).toBe(1);
    const said = formLine(lines)[0]!;
    expect(said).toMatch(new RegExp(`^FAIL {2}.*answers ${status}, NetBird's own page`));
    expect(said).toContain("not the sign-in service's 404");
  });

  it.each([401, 403, 409, 500, 502])('FAILS a %s: only a 404 is the refusal', async (status) => {
    const { io, lines } = fakeIo({ pages: { [ORG_REGISTRATION]: { status, netbird: false } } });
    expect(await runProbe(CONFIG, io)).toBe(1);
    expect(formLine(lines)[0]).toMatch(new RegExp(`^FAIL {2}.*answers ${status}, not 404`));
  });

  it('is a finding whatever the dispatch says: no list, mode or front port makes the form a note', async () => {
    const configs: ProbeConfig[] = [
      { ...CONFIG, frontPorts: [5432] },
      ...(['report', 'internet', 'mesh-only'] as const).map((otaMode) => ({ ...CONFIG, otaMode })),
      { ...CONFIG, siteMode: 'required' },
      { ...CONFIG, host: '' },
    ];
    for (const config of configs) {
      const { io, lines } = fakeIo({
        pages: { [ORG_REGISTRATION]: { status: 200, netbird: false } },
        tls: Object.fromEntries(OTA_NAMES.map((n) => [n, { state: config.otaMode === 'internet' ? 'tls' : 'none' } as const])),
      });
      expect(await runProbe(config, io), JSON.stringify(config)).toBe(1);
      expect(formLine(lines)[0]).toMatch(/^FAIL {2}/);
    }
  });

  it('the real network reads a 404 as a 404, and follows no redirect to get there', async () => {
    const server = createHttpServer((req, res) => {
      if (req.url === '/ui/login/register/org') {
        res.writeHead(404, { Connection: 'close' });
        res.end();
      } else {
        res.writeHead(302, { Location: '/ui/login/register/org', Connection: 'close' });
        res.end();
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const a = server.address();
      const base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
      const net = realNetwork({ fetchMs: 3000 });
      expect(await net.page(`${base}/ui/login/register/org`)).toEqual({ status: 404, netbird: false });
      expect(await net.page(`${base}/elsewhere`)).toEqual({ status: 302, location: '/ui/login/register/org', netbird: false });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

describe('www.ownpace.eu, tried only on live\'s front (0139 T10)', () => {
  const silent = { state: 'none' as const, why: 'timeout' };
  const report = CONFIG;
  const required: ProbeConfig = { ...CONFIG, siteMode: 'required' };
  const pointedAway = { ...ALL_RESOLVED, 'www.ownpace.eu': [APEX] };

  it('is its own name, not a production name, and reports by default', () => {
    expect(SITE_NAME).toBe('www.ownpace.eu');
    expect(PRODUCTION_NAMES).not.toContain(SITE_NAME);
  });

  it('on live\'s front: asked over TLS on 443, its address tried like the others\', and failed when it does not answer only if required', async () => {
    const answering = fakeIo({});
    expect(await runProbe(required, answering.io), answering.lines.join('\n')).toBe(0);
    expect(answering.tlsAsked).toContain(SITE_NAME);
    expect(answering.lines.join('\n')).toMatch(/pass {2}www\.ownpace\.eu: 443 answers over TLS, on live's front/);
    for (const p of CONFIG.ports) expect(answering.tried).toContain(`${FRONT}#${p}`);
    const quietRequired = fakeIo({ tls: { [SITE_NAME]: silent } });
    expect(await runProbe(required, quietRequired.io)).toBe(1);
    expect(quietRequired.lines.join('\n')).toMatch(/FAIL {2}www\.ownpace\.eu: 443 does not answer \(timeout\); site_name is required/);
    const quietReport = fakeIo({ tls: { [SITE_NAME]: silent } });
    expect(await runProbe(report, quietReport.io)).toBe(0);
    expect(quietReport.lines.join('\n')).toMatch(/note {2}www\.ownpace\.eu: 443 does not answer \(timeout\); recorded/);
    expectNoAddress(quietRequired.lines);
  });

  it('pointed at another host: that address is never tried on any port, 443 is not asked, and it fails only if required', async () => {
    for (const config of [report, required]) {
      const f = fakeIo({ resolved: pointedAway });
      const code = await runProbe(config, f.io);
      expect(code, f.lines.join('\n')).toBe(config.siteMode === 'required' ? 1 : 0);
      expect(f.tried.filter((t) => t.startsWith(`${APEX}#`)), 'an address that is not live\'s front was tried').toEqual([]);
      expect(f.tlsAsked).not.toContain(SITE_NAME);
      expect(f.lines.join('\n')).toMatch(/www\.ownpace\.eu: 1 of its 1 address\(es\) are not live's front/);
      // Masked all the same, and never printed.
      expect(f.lines).toContain(`::add-mask::${APEX}`);
      expectNoAddress(f.lines);
    }
    // And no finding names it, even when that host answers every port.
    const open = fakeIo({ resolved: pointedAway, open: CONFIG.ports.map((p) => [APEX, p] as [string, number]) });
    expect(await runProbe(report, open.io)).toBe(0);
    expect(open.lines.join('\n')).not.toMatch(/port \d+ answers/);
  });

  it('partly on live\'s front: only the front\'s address is tried, the other never, and 443 is not asked', async () => {
    const f = fakeIo({ resolved: { ...ALL_RESOLVED, 'www.ownpace.eu': [FRONT, APEX] } });
    expect(await runProbe(required, f.io)).toBe(1);
    expect(f.tried).toContain(`${FRONT}#5432`);
    expect(f.tried.filter((t) => t.startsWith(`${APEX}#`))).toEqual([]);
    expect(f.tlsAsked).not.toContain(SITE_NAME);
    expect(f.lines.join('\n')).toMatch(/FAIL {2}www\.ownpace\.eu: 1 of its 2 address\(es\) are not live's front/);
    expectNoAddress(f.lines);
  });

  it('on the machine\'s own address (EXPOSURE_PROBE_HOST) counts as live\'s front', async () => {
    const f = fakeIo({ resolved: { ...ALL_RESOLVED, 'www.ownpace.eu': [MACHINE] } });
    expect(await runProbe(required, f.io), f.lines.join('\n')).toBe(0);
    expect(f.tlsAsked).toContain(SITE_NAME);
    const without = fakeIo({ resolved: { ...ALL_RESOLVED, 'www.ownpace.eu': [MACHINE] } });
    expect(await runProbe({ ...required, host: '' }, without.io)).toBe(1);
    expect(without.tried.filter((t) => t.startsWith(`${MACHINE}#`))).toEqual([]);
  });

  it('not resolving: recorded by default, failed if required', async () => {
    const gone = { unresolvable: { [SITE_NAME]: 'ENOTFOUND' } };
    const r = fakeIo(gone);
    expect(await runProbe(report, r.io)).toBe(0);
    expect(r.lines.join('\n')).toMatch(/note {2}www\.ownpace\.eu does not resolve \(ENOTFOUND\)/);
    const q = fakeIo(gone);
    expect(await runProbe(required, q.io)).toBe(1);
    expect(q.lines.join('\n')).toMatch(/FAIL {2}www\.ownpace\.eu does not resolve \(ENOTFOUND\); site_name is required/);
  });
});

/**
 * WHAT A TESTER'S BROWSER GETS FROM THE APP (workplan 0158 T4). The probe asks
 * live's own version.json which commit its web app was built from, reads the
 * template at that commit, and holds the page's headers to what it states with
 * live's issuer: each once, with its value. Every step that cannot be made
 * fails, and no finding repeats a value that arrived.
 */
describe("the app's page, held to the template at live's own commit (0158 T4)", () => {
  const appLines = (lines: readonly string[]) =>
    lines.filter((l) => /^(pass|FAIL|note) {2}/.test(l) && (l.includes(APP_PAGE) || l.includes(APP_VERSION) || l.includes(APP_TEMPLATE)));
  const without = (name: string) => stated().filter(([n]) => n !== name);
  const swapped = (name: string, value: string) => stated().map(([n, v]): [string, string] => [n, n === name ? value : v]);
  /** A value nobody's template states, which must never reach the log. */
  const ODD = "default-src 'self' https://odd.example";

  it('passes when the page carries the five as the template at live\'s commit states them, and says which commit', async () => {
    const { io, lines, templatesAsked } = fakeIo({});
    expect(await runProbe(CONFIG, io), lines.join('\n')).toBe(0);
    expect(templatesAsked).toEqual([LIVE_COMMIT]);
    const line = appLines(lines);
    expect(line).toEqual([
      `pass  ${APP_PAGE} carries Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, each once, as ${APP_TEMPLATE} at ${LIVE_COMMIT.slice(0, 12)} states them with ${ISSUER} (workplan 0158 T4)`,
    ]);
    expectNoAddress(lines);
  });

  it.each([
    ['no policy', without('content-security-policy'), 'Content-Security-Policy: not sent'],
    ['a second policy beside it', [...stated(), ['content-security-policy', ODD]], 'Content-Security-Policy: sent 2 times, where the template states it once'],
    ['a policy that names the OTA stack\'s issuer', swapped('content-security-policy', stated().find(([n]) => n === 'content-security-policy')![1].replace(ISSUER, 'https://id.ota.ownpace.eu')), 'Content-Security-Policy: not the value the template states'],
    ['a policy nobody stated', swapped('content-security-policy', ODD), 'Content-Security-Policy: not the value the template states'],
    ['no HSTS', without('strict-transport-security'), 'Strict-Transport-Security: not sent'],
    ['HSTS without includeSubDomains', swapped('strict-transport-security', 'max-age=31536000'), 'Strict-Transport-Security: not the value the template states'],
    ['no nosniff', without('x-content-type-options'), 'X-Content-Type-Options: not sent'],
  ] as const)('fails the page with %s, naming the header and never what arrived', async (_label, headers, finding) => {
    const { io, lines } = fakeIo({ appPage: { status: 200, headers } });
    expect(await runProbe(CONFIG, io)).toBe(1);
    expect(appLines(lines)).toEqual([
      `FAIL  ${APP_PAGE} ${finding}, held to ${APP_TEMPLATE} at ${LIVE_COMMIT.slice(0, 12)} with ${ISSUER} (workplan 0158 T4)`,
    ]);
    expect(lines.join('\n')).not.toContain(ODD);
    expect(lines.join('\n')).not.toContain('id.ota.ownpace.eu;');
    expectNoAddress(lines);
  });

  it('a header name in any case is the header: HTTP/1.1 sends them capitalised', async () => {
    const capitalised = stated().map(([n, v]): [string, string] => [n.replace(/(^|-)([a-z])/g, (_m, d: string, c: string) => d + c.toUpperCase()), v]);
    expect(await runProbe(CONFIG, fakeIo({ appPage: { status: 200, headers: capitalised } }).io)).toBe(0);
  });

  it("reads the template at the commit live's version.json names, not this checkout's: a page held to the one live runs", async () => {
    const OLDER = 'fedcba9876543210fedcba9876543210fedcba98';
    const older = TEMPLATE.replaceAll('max-age=31536000; includeSubDomains', 'max-age=600; includeSubDomains');
    expect(older).not.toBe(TEMPLATE);
    const asOlder = fakeIo({
      version: { commit: OLDER },
      templates: { [OLDER]: older, [LIVE_COMMIT]: TEMPLATE },
      appPage: { status: 200, headers: stated(older) },
    });
    expect(await runProbe(CONFIG, asOlder.io), asOlder.lines.join('\n')).toBe(0);
    expect(asOlder.templatesAsked).toEqual([OLDER]);
    const asMain = fakeIo({
      version: { commit: OLDER },
      templates: { [OLDER]: older, [LIVE_COMMIT]: TEMPLATE },
      appPage: { status: 200, headers: stated() },
    });
    expect(await runProbe(CONFIG, asMain.io)).toBe(1);
    expect(appLines(asMain.lines)[0]).toContain('Strict-Transport-Security: not the value the template states');
  });

  it.each([
    ['version.json cannot be read', { version: { why: 'could not be read (ECONNRESET)' } }, `${APP_VERSION} could not be read (ECONNRESET): the commit live's web app was built from is not known`],
    ['version.json names no commit', { version: { why: 'names no commit in full' } }, `${APP_VERSION} names no commit in full: the commit live's web app was built from is not known`],
    ['the template at that commit cannot be read', { templates: {} }, `${APP_TEMPLATE} at ${LIVE_COMMIT.slice(0, 12)}, the commit ${APP_VERSION} names, could not be read (git show failed (128))`],
    ['the template states no policy for the page', { templates: { [LIVE_COMMIT]: TEMPLATE.replace(/^\s*add_header Content-Security-Policy .*\n/gm, '') } }, `${APP_TEMPLATE} at ${LIVE_COMMIT.slice(0, 12)} states no Content-Security-Policy for the app's page, so an answer without one would pass`],
    ['the page answers with NetBird\'s sign-in', { appPage: { status: 302, headers: [['location', 'https://login.netbird.example/']] } }, `${APP_PAGE} answers 302, not the app's page, so its headers were not held to`],
    ['the page does not answer', { appPage: { why: 'ETIMEDOUT' } }, `${APP_PAGE} does not answer (ETIMEDOUT), so its headers were not read`],
  ] as const)('fails when %s: a check nobody could make is not passed', async (_label, fake, words) => {
    const { io, lines } = fakeIo(fake as Fake);
    expect(await runProbe(CONFIG, io)).toBe(1);
    const line = appLines(lines);
    expect(line).toHaveLength(1);
    expect(line[0]).toMatch(/^FAIL {2}/);
    expect(line[0]).toContain(words);
    expect(line[0]).toContain('(workplan 0158 T4)');
    expectNoAddress(lines);
  });

  it('the real network lists a header sent twice twice, follows no redirect, and reads a version stamp', async () => {
    const server = createHttpServer((req, res) => {
      if (req.url === '/version.json') {
        res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ version: '0.2.0-alpha.7', commit: LIVE_COMMIT }));
      } else if (req.url === '/moved') {
        res.writeHead(302, { Location: '/', Connection: 'close' });
        res.end();
      } else {
        res.setHeader('Content-Security-Policy', ["default-src 'none'", "default-src 'self'"]);
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.writeHead(200, { Connection: 'close' });
        res.end('<!doctype html>');
      }
    });
    await new Promise<void>((done) => server.listen(0, 'localhost', done));
    try {
      const a = server.address();
      const base = `http://localhost:${typeof a === 'object' && a ? a.port : 0}`;
      const net = realNetwork({ fetchMs: 3000 });
      const page = await net.headers(`${base}/`);
      expect(page.status).toBe(200);
      expect(page.headers!.filter(([n]) => n.toLowerCase() === 'content-security-policy').map(([, v]) => v)).toEqual([
        "default-src 'none'",
        "default-src 'self'",
      ]);
      expect((await net.headers(`${base}/moved`)).status).toBe(302);
      expect(await net.version(`${base}/version.json`)).toEqual({ commit: LIVE_COMMIT });
      expect(await net.version(`${base}/`)).toEqual({ why: expect.stringMatching(/^could not be read/) });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("the real network reads the template at a commit from this checkout's git, and refuses what is not a commit id", async () => {
    const head = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const shown = spawnSync('git', ['-C', REPO_ROOT, 'show', `${head}:${APP_TEMPLATE}`], { encoding: 'utf8' }).stdout;
    const net = realNetwork({ gitMs: 20000 });
    expect(await net.template(head)).toEqual({ text: shown });
    expect(await net.template('HEAD')).toEqual({ why: 'not a commit id' });
    expect(await net.template(`${head};id`)).toEqual({ why: 'not a commit id' });
  });
});

describe('the OTA names, on the mesh only from the owner\'s step (open question 7, answered 2026-11-08)', () => {
  const answering = { state: 'tls' as const };
  const silent = { state: 'none' as const, why: 'timeout' };
  const otaTls = (s: { state: 'tls' | 'tcp-only' | 'none'; why?: string }) =>
    Object.fromEntries(OTA_NAMES.map((n) => [n, s]));

  it('report (the default) records what answered and fails on none of it', async () => {
    for (const s of [answering, silent]) {
      const { io, lines } = fakeIo({ tls: otaTls(s) });
      expect(await runProbe({ ...CONFIG, otaMode: 'report' }, io)).toBe(0);
      for (const n of OTA_NAMES) expect(lines.join('\n')).toContain(n);
    }
  });

  it('report says the answer, and what the dispatch takes once the owner\'s step is done', async () => {
    const { io, lines } = fakeIo({ tls: otaTls(answering) });
    expect(await runProbe({ ...CONFIG, otaMode: 'report' }, io)).toBe(0);
    const notes = lines.filter((l) => OTA_NAMES.some((n) => l.startsWith(`note  ${n}:`)));
    expect(notes).toHaveLength(OTA_NAMES.length);
    for (const l of notes) expect(l).toContain("on the mesh only from the owner's step (0132 open question 7), then ota_names is mesh-only");
    expect(lines.join('\n')).not.toContain('decides whether it should');
  });

  it('internet requires each OTA name to answer over TLS', async () => {
    expect(await runProbe({ ...CONFIG, otaMode: 'internet' }, fakeIo({ tls: otaTls(answering) }).io)).toBe(0);
    expect(await runProbe({ ...CONFIG, otaMode: 'internet' }, fakeIo({ tls: otaTls(silent) }).io)).toBe(1);
  });

  it('mesh-only requires no OTA name to answer on 443, TLS or not, and a name that does not resolve is fine', async () => {
    expect(await runProbe({ ...CONFIG, otaMode: 'mesh-only' }, fakeIo({ tls: otaTls(silent) }).io)).toBe(0);
    expect(await runProbe({ ...CONFIG, otaMode: 'mesh-only' }, fakeIo({ tls: otaTls(answering) }).io)).toBe(1);
    expect(
      await runProbe({ ...CONFIG, otaMode: 'mesh-only' }, fakeIo({ tls: otaTls({ state: 'tcp-only', why: 'ECONNRESET' }) }).io),
    ).toBe(1);
    const gone = fakeIo({
      tls: otaTls(silent),
      unresolvable: Object.fromEntries(OTA_NAMES.map((n) => [n, 'ENOTFOUND'])),
    });
    expect(await runProbe({ ...CONFIG, otaMode: 'mesh-only' }, gone.io)).toBe(0);
  });
});

/**
 * PORTS THE FRONT ANSWERS BY ITSELF (the owner, 2026-10-29). 5432 answered on
 * both of live's front IPv4 addresses, and a capture on the machine across a
 * probe run saw nothing arrive. `EXPOSURE_PROBE_FRONT_PORTS` lists such ports:
 * on a production name's address only, such a port answering is a note, and
 * the tripwire behind it, PostgreSQL's SSLRequest, fails on a PostgreSQL
 * answer. Everywhere else every answer still fails.
 */
describe('ports the front answers by itself (EXPOSURE_PROBE_FRONT_PORTS)', () => {
  const HELD: ProbeConfig = { ...CONFIG, frontPorts: [5432] };

  it('a listed port answering on the production names\' addresses is a note, after it does not answer as PostgreSQL', async () => {
    const { io, lines, pgAsked } = fakeIo({
      open: [
        [FRONT, 5432],
        [FRONT_2, 5432],
      ],
      postgres: { [`${FRONT}#5432`]: { kind: 'other', bytes: 7 } },
    });
    expect(await runProbe(HELD, io)).toBe(0);
    expect(pgAsked.sort()).toEqual([`${FRONT}#5432`, `${FRONT_2}#5432`].sort());
    expect(lines.filter((l) => l.startsWith('FAIL'))).toEqual([]);
    const held = lines.filter((l) => l.startsWith('note') && l.includes("port 5432 answers, the front's own"));
    expect(held).toHaveLength(2);
    expect(held.join('\n')).toContain("answered 7 byte(s) that are not PostgreSQL's");
    expect(held.join('\n')).toContain('said nothing');
    expect(lines).toContain('pass  no tried port answers on 5 address(es), beside 2 the front answers by itself');
    expectNoAddress(lines);
  });

  it('FAILS when the listed port answers as PostgreSQL: a database there is not the front', async () => {
    const { io, lines } = fakeIo({
      open: [[FRONT, 5432]],
      postgres: { [`${FRONT}#5432`]: { kind: 'postgres' } },
    });
    expect(await runProbe(HELD, io)).toBe(1);
    expect(lines.find((l) => l.startsWith('FAIL'))).toMatch(/port 5432 answers as PostgreSQL/);
    expect(lines.some((l) => l.startsWith('pass  no tried port'))).toBe(false);
    expectNoAddress(lines);
  });

  it('FAILS when the tripwire could not ask: a port nobody could ask is a port nobody knows', async () => {
    const { io, lines } = fakeIo({
      open: [[FRONT, 5432]],
      postgres: { [`${FRONT}#5432`]: { untried: 'EPERM' } },
    });
    expect(await runProbe(HELD, io)).toBe(1);
    expect(lines.find((l) => l.startsWith('FAIL'))).toMatch(/could not be asked in PostgreSQL's protocol \(EPERM\)/);
  });

  it('still FAILS on the machine\'s own address, and asks it nothing', async () => {
    const { io, lines, pgAsked } = fakeIo({ open: [[MACHINE, 5432]] });
    expect(await runProbe(HELD, io)).toBe(1);
    expect(lines).toContain("FAIL  the machine's own address (EXPOSURE_PROBE_HOST) (IPv4): port 5432 answers");
    expect(pgAsked).toEqual([]);
  });

  it('still FAILS on a production name\'s address that is the machine\'s own too', async () => {
    const { io, lines, pgAsked } = fakeIo({ open: [[FRONT, 5432]] });
    expect(await runProbe({ ...HELD, host: FRONT }, io)).toBe(1);
    expect(lines.filter((l) => l.startsWith('FAIL') && l.includes('port 5432 answers')).length).toBeGreaterThan(0);
    expect(pgAsked).toEqual([]);
  });

  it('still FAILS on an address only the OTA names resolve to', async () => {
    const { io, lines } = fakeIo({ open: [[OTA_FRONT, 5432]] });
    expect(await runProbe(HELD, io)).toBe(1);
    expect(lines.find((l) => l.startsWith('FAIL'))).toMatch(/app\.ota\.ownpace\.eu.*port 5432 answers$/);
  });

  it('still FAILS on a port the variable does not list, on the front too', async () => {
    const { io, lines } = fakeIo({ open: [[FRONT, 3001]] });
    expect(await runProbe(HELD, io)).toBe(1);
    expect(lines.find((l) => l.startsWith('FAIL'))).toMatch(/port 3001 answers$/);
  });

  it('a front address this runner could not try says nothing about the list: no "the entry can go"', async () => {
    const { io, lines } = fakeIo({
      resolved: { ...ALL_RESOLVED, 'app.ownpace.eu': [FRONT, V6], 'id.ownpace.eu': [FRONT], 'status.ownpace.eu': [FRONT] },
      untried: [V6],
    });
    expect(await runProbe(HELD, io)).toBe(0);
    expect(lines.some((l) => l.includes('the entry can go'))).toBe(false);
    expect(lines).toContain(
      'note  port 5432 is in EXPOSURE_PROBE_FRONT_PORTS, and no address of the production names this runner could try answers on it now (1 not tried)',
    );
    expectNoAddress(lines);
  });

  it('every front address untried: nothing said about the list at all', async () => {
    const { io, lines } = fakeIo({ untried: [FRONT, FRONT_2] });
    await runProbe(HELD, io);
    expect(lines.some((l) => l.includes('is in EXPOSURE_PROBE_FRONT_PORTS'))).toBe(false);
  });

  it('a tripwire whose own connection timed out FAILS, like any it could not ask', async () => {
    const { io, lines } = fakeIo({
      open: [[FRONT, 5432]],
      postgres: { [`${FRONT}#5432`]: { untried: 'timeout' } },
    });
    expect(await runProbe(HELD, io)).toBe(1);
    expect(lines.find((l) => l.startsWith('FAIL'))).toMatch(/could not be asked in PostgreSQL's protocol \(timeout\)/);
  });

  it('says a listed port that no longer answers, so the list can shrink', async () => {
    const { io, lines } = fakeIo({});
    expect(await runProbe(HELD, io)).toBe(0);
    expect(lines).toContain(
      'note  port 5432 is in EXPOSURE_PROBE_FRONT_PORTS, and no address of the production names answers on it now: the entry can go',
    );
    expect(lines).toContain('pass  no tried port answers on 5 address(es)');
  });

  it('without the variable, the front\'s 5432 fails as it always did', async () => {
    const { io, lines, pgAsked } = fakeIo({ open: [[FRONT, 5432]] });
    expect(await runProbe(CONFIG, io)).toBe(1);
    expect(lines.find((l) => l.startsWith('FAIL'))).toMatch(/port 5432 answers$/);
    expect(pgAsked).toEqual([]);
  });
});

describe('the configuration the workflow hands it', () => {
  const derived = [3001, 3123, 5432];

  it('adds live\'s ports to the derived ones, sorted and once each', () => {
    const r = probeConfig(
      { EXPOSURE_PROBE_LIVE_PORTS: '4123, 4126 5432', EXPOSURE_PROBE_HOST: MACHINE, EXPOSURE_PROBE_OTA_NAMES: 'report' },
      derived,
    );
    expect(r.errors).toEqual([]);
    expect(r.config?.ports).toEqual([3001, 3123, 4123, 4126, 5432]);
    expect(r.config?.otaMode).toBe('report');
  });

  it('refuses to run without live\'s ports: "nothing else answers" would not cover live', () => {
    const r = probeConfig({ EXPOSURE_PROBE_OTA_NAMES: 'report' }, derived);
    expect(r.config).toBeUndefined();
    expect(r.errors.join('\n')).toContain('EXPOSURE_PROBE_LIVE_PORTS');
  });

  it.each(['30a1', '0', '70000', '3001-3005'])('refuses a live port that is not one port number: %s', (v) => {
    const r = probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: v, EXPOSURE_PROBE_OTA_NAMES: 'report' }, derived);
    expect(r.config).toBeUndefined();
    expect(r.errors.join('\n')).toContain('EXPOSURE_PROBE_LIVE_PORTS');
  });

  it('refuses an OTA mode that is not one of the three, and defaults to report', () => {
    expect(probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: '4123', EXPOSURE_PROBE_OTA_NAMES: 'maybe' }, derived).config).toBeUndefined();
    expect(probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: '4123' }, derived).config?.otaMode).toBe('report');
  });

  it('refuses a site mode that is not report or required, and defaults to report', () => {
    const bad = probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: '4123', EXPOSURE_PROBE_SITE_NAME: 'maybe' }, derived);
    expect(bad.config).toBeUndefined();
    expect(bad.errors.join('\n')).toContain('EXPOSURE_PROBE_SITE_NAME');
    expect(probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: '4123' }, derived).config?.siteMode).toBe('report');
    expect(probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: '4123', EXPOSURE_PROBE_SITE_NAME: 'required' }, derived).config?.siteMode).toBe('required');
  });

  it('reads the ports the front answers by itself, and tries them everywhere too', () => {
    const r = probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: '4123', EXPOSURE_PROBE_FRONT_PORTS: '5432, 6000 5432' }, derived);
    expect(r.errors).toEqual([]);
    expect(r.config?.frontPorts).toEqual([5432, 6000]);
    expect(r.config?.ports).toEqual([3001, 3123, 4123, 5432, 6000]);
    expect(probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: '4123' }, derived).config?.frontPorts).toEqual([]);
  });

  it.each(['54x2', '0', '70000', '5432-5433'])('refuses a front port that is not one port number: %s', (v) => {
    const r = probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: '4123', EXPOSURE_PROBE_FRONT_PORTS: v }, derived);
    expect(r.config).toBeUndefined();
    expect(r.errors.join('\n')).toContain('EXPOSURE_PROBE_FRONT_PORTS');
  });

  it('refuses 443 as a port the front holds: it is the one the names must answer on, over TLS', () => {
    const r = probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: '4123', EXPOSURE_PROBE_FRONT_PORTS: '443' }, derived);
    expect(r.config).toBeUndefined();
    expect(r.errors.join('\n')).toMatch(/EXPOSURE_PROBE_FRONT_PORTS names 443/);
  });

  it('never repeats the secret in a refusal', () => {
    const r = probeConfig({ EXPOSURE_PROBE_LIVE_PORTS: 'x', EXPOSURE_PROBE_HOST: MACHINE }, derived);
    expect(r.errors.join('\n')).not.toContain(MACHINE);
  });
});

describe('the real network, against a port on this machine', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  it('tells a port that answers from one that does not', async () => {
    server = createServer((s) => s.end());
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const net = realNetwork({ connectMs: 2000 });
    expect(await net.connect('127.0.0.1', port)).toBe('open');
    await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
    expect(await net.connect('127.0.0.1', port)).toBe('closed');
  });

  /** A server on loopback that answers what it is given, and records what it got. */
  async function serve(answer: (got: Buffer) => Buffer | null, after: 'end' | 'stay' = 'stay') {
    const got: Buffer[] = [];
    server = createServer((s) => {
      s.on('data', (chunk: Buffer) => {
        got.push(chunk);
        const reply = answer(Buffer.concat(got));
        if (reply) s.write(reply);
        if (after === 'end') s.end();
      });
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    const address = server.address();
    return { port: typeof address === 'object' && address ? address.port : 0, got };
  }

  it('sends PostgreSQL\'s SSLRequest and nothing else, and knows its answer', async () => {
    const { port, got } = await serve(() => Buffer.from('N'));
    const answer = await realNetwork({ connectMs: 2000 }).postgres('127.0.0.1', port);
    expect(answer).toEqual({ kind: 'postgres' });
    expect(Buffer.concat(got)).toEqual(SSL_REQUEST);
    expect([...SSL_REQUEST]).toEqual([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
  });

  it('counts S, PostgreSQL\'s other answer, the same way', async () => {
    const { port } = await serve(() => Buffer.from('S'));
    expect(await realNetwork({ connectMs: 2000 }).postgres('127.0.0.1', port)).toEqual({ kind: 'postgres' });
  });

  it('calls other bytes other, by how many, and never what they were', async () => {
    const { port } = await serve(() => Buffer.from('HTTP/1.1 400 Bad Request\r\n\r\n'), 'end');
    const answer = await realNetwork({ connectMs: 2000 }).postgres('127.0.0.1', port);
    expect(answer).toMatchObject({ kind: 'other' });
    expect(JSON.stringify(answer)).not.toContain('HTTP');
  });

  it('a connection that never forms is untried, never an answer: the request was not sent', async () => {
    const { port } = await serve(() => null);
    await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
    expect(await realNetwork({ connectMs: 2000 }).postgres('127.0.0.1', port)).toEqual({ untried: 'ECONNREFUSED' });
  });

  it('tells a port that says nothing from one that closes without a word', async () => {
    const silent = await serve(() => null);
    expect(await realNetwork({ connectMs: 500 }).postgres('127.0.0.1', silent.port)).toEqual({ kind: 'silent' });
    await new Promise<void>((done) => server!.close(() => done()));
    const closing = await serve(() => null, 'end');
    expect(await realNetwork({ connectMs: 2000 }).postgres('127.0.0.1', closing.port)).toEqual({ kind: 'closed' });
  });
});
