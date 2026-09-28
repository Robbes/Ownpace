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
 * IT PASSES WHEN, per 0132 T3: 443 on each production name answers over TLS;
 * the discovery document at `https://id.ownpace.eu` names `https://id.ownpace.eu`
 * as its issuer, so the production names reach live and not the OTA stack; and
 * nothing else answers. What the OTA names should do on 443 is open question 7,
 * unanswered: the dispatch input `ota_names` says it, and its default,
 * `report`, records what answered without failing on it.
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
import { createServer, type Server } from 'node:net';
import {
  OTA_NAMES,
  PRODUCTION_NAMES,
  probeConfig,
  realNetwork,
  runProbe,
  type ProbeIo,
  type ProbeConfig,
} from './exposure-probe.mjs';

const FRONT = '192.0.2.10';
const FRONT_2 = '192.0.2.11';
const OTA_FRONT = '198.51.100.20';
const MACHINE = '203.0.113.5';
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
}

const ALL_RESOLVED: Record<string, string[]> = {
  'app.ownpace.eu': [FRONT, FRONT_2],
  'id.ownpace.eu': [FRONT],
  'status.ownpace.eu': [FRONT],
  'app.ota.ownpace.eu': [OTA_FRONT, V6],
  'id.ota.ownpace.eu': [OTA_FRONT],
  'www.ota.ownpace.eu': [OTA_FRONT],
};

function fakeIo(fake: Fake): { io: ProbeIo; lines: string[]; tried: string[]; tlsAsked: string[] } {
  const lines: string[] = [];
  const tried: string[] = [];
  const tlsAsked: string[] = [];
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
    tls: async (name) => {
      tlsAsked.push(name);
      return fake.tls?.[name] ?? (PRODUCTION_NAMES.includes(name) ? { state: 'tls' } : { state: 'none', why: 'timeout' });
    },
    issuer: async () => fake.issuer ?? { issuer: 'https://id.ownpace.eu' },
    print: (line) => lines.push(line),
  };
  return { io, lines, tried, tlsAsked };
}

const CONFIG: ProbeConfig = { ports: [3001, 3123, 5432], host: MACHINE, otaMode: 'report' };

/** Every IPv4 and IPv6 literal the fake network handed out. */
const ADDRESSES = [FRONT, FRONT_2, OTA_FRONT, MACHINE, V6];

/** The masks come first, and nothing after them names an address. */
function expectNoAddress(lines: readonly string[]): void {
  const firstOther = lines.findIndex((l) => !l.startsWith('::add-mask::'));
  const lastMask = lines.map((l) => l.startsWith('::add-mask::')).lastIndexOf(true);
  expect(lastMask, 'a mask was printed after another line').toBeLessThan(firstOther === -1 ? Infinity : firstOther);
  const printed = lines.filter((l) => !l.startsWith('::add-mask::')).join('\n');
  for (const a of ADDRESSES) expect(printed, `the log names ${a}`).not.toContain(a);
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
    for (const n of ['app.ownpace.eu', 'id.ownpace.eu', 'status.ownpace.eu']) expect(finding[0]).toContain(n);
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

describe('the OTA names, as open question 7 will decide', () => {
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
});
