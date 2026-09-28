#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE PROBE FROM OUTSIDE (workplan 0132 T3 (c)).
 *
 * 0132 D2 says the reference machine's ports cannot be reached from outside
 * the private network and the mesh; D4 puts testers on the internet, so live's
 * production names, and the site's, must answer there, and nothing else may.
 * The exposure check (`deploy/compose/exposure-check.sh`) reads what Docker
 * publishes, on the machine. This asks from where a stranger stands: a
 * GitHub-hosted runner, on the internet and on neither the mesh nor the
 * private network. `.github/workflows/exposure-probe.yml` runs it, by dispatch
 * only (0132 open question 6).
 *
 * WHAT IT TRIES. It resolves the production names (`app.ownpace.eu`,
 * `id.ownpace.eu`, `status.ownpace.eu`) and the OTA names
 * (`app.ota.ownpace.eu`, `id.ota.ownpace.eu`, `www.ota.ownpace.eu`), and tries
 * every port either stack publishes, the site's and the demo's two, on every
 * address those names resolve to, and on the machine's own address when the
 * repository secret `EXPOSURE_PROBE_HOST` holds it. The list is derived from
 * the files (`exposure-probe-ports.mjs`), plus live's own `*_PORT` values from
 * the repository variable `EXPOSURE_PROBE_LIVE_PORTS`, which it will not run
 * without.
 *
 * WHEN IT PASSES. 443 on each production name answers over TLS, with a
 * certificate for the name. The discovery document at
 * `https://id.ownpace.eu/.well-known/openid-configuration` names
 * `https://id.ownpace.eu` as its issuer, so the production names reach live and
 * not the OTA stack. And no tried port answers (a TCP connection is accepted)
 * on any of those addresses. What the OTA names should do on 443 is open
 * question 7, which nobody has answered: `EXPOSURE_PROBE_OTA_NAMES` (the
 * dispatch input `ota_names`) is `report` by default, which records what
 * answered without failing on it; `internet` requires each to answer over TLS;
 * `mesh-only` requires none to answer at all. An address this runner cannot
 * reach (a GitHub-hosted runner has no IPv6 route) is said to be NOT TRIED,
 * never counted as closed.
 *
 * THE PRODUCTION SITE, `www.ownpace.eu` (workplan 0139 T10), is live's only
 * once live's `.env` says `WWW_LIVE=true` and the name is routed to live's
 * front, which waits on the legal texts. Until then the name points
 * elsewhere (the apex's host, today), and that host is not the machine's. So
 * the probe tries no port on an address of it that is not live's front: an
 * address a production name, or `EXPOSURE_PROBE_HOST`, resolves to. It does
 * not ask 443 for the name unless every address of it is live's front, since
 * that would test the other host too. `EXPOSURE_PROBE_SITE_NAME` (the
 * dispatch input `site_name`) is `report` by default, which records what it
 * found without failing on it; `required`, once the site is switched on and
 * routed, requires the name to resolve to live's front alone and 443 to
 * answer over TLS.
 *
 * ITS LOG NEVER NAMES AN ADDRESS. The run's log is public. Every address, and
 * the secret, is masked with `::add-mask::` before anything else is printed,
 * and nothing printed carries one: an address is named by the names that
 * resolve to it, the machine's own by the secret that holds it, and a failure
 * by its error CODE, never Node's message, which names the address it failed
 * on. `scripts/exposure-probe.unit.test.ts` holds both halves.
 *
 * NO NETBIRD SIGN-IN IN FRONT OF THE FOUR NAMES (workplan 0139, item 8; the
 * owner, 2026-09-28, *"Off everywhere at launch"*). NetBird's reverse proxy can
 * put a sign-in of its own in front of a name it serves: SSO, a password, a
 * PIN. The owner switches it off on `app.`, `id.`, `status.` and
 * `www.ownpace.eu` before the first invitation. So the probe asks each for the
 * page a visitor asks for first (`SIGN_IN_PAGES`), without following a
 * redirect, and passes a name only when it answers itself: a 2xx, or a
 * redirect that stays on the name. A redirect to another host is NetBird's
 * sign-in (SSO sends a visitor to its identity provider), a page that loads
 * NetBird's own assets (`/__netbird__/`) is NetBird's (its password and PIN
 * page answers 401), and anything else that is not the service fails too:
 * netbirdio/netbird at 002755c4, proxy/internal/auth/middleware.go,
 * `authenticateWithSchemes`. It is asked from here, off the mesh, because a
 * request that arrives over the tunnel from a peer of the account can pass
 * NetBird's SSO without a sign-in page (`forwardWithTunnelPeer`), so the
 * owner's own laptop on the mesh, or the machine, would not see it. A
 * redirect is named by its host, never its query (it carries a state and a
 * client), and never when the host is an address. `www.ownpace.eu` is asked
 * only on live's front, as above; not answering there fails only when
 * `site_name` is `required`, NetBird's sign-in fails either way.
 *
 * Not yet: 0135's check that the identity provider's organisation
 * registration page answers 404 (0135 T1), and the forged `X-Forwarded-For`
 * request (0132 T3 (d)), which needs live standing.
 *
 * Usage:  EXPOSURE_PROBE_LIVE_PORTS='4123 4126' node scripts/exposure-probe.mjs
 * Exit: 0 pass; 1 a finding; 2 the configuration, or the port list, is wrong.
 */

import { promises as dns } from 'node:dns';
import { appendFileSync } from 'node:fs';
import { connect as netConnect, isIP } from 'node:net';
import { resolve as resolvePath } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { readPorts } from './exposure-probe-ports.mjs';

export const PRODUCTION_NAMES = ['app.ownpace.eu', 'id.ownpace.eu', 'status.ownpace.eu'];
export const OTA_NAMES = ['app.ota.ownpace.eu', 'id.ota.ownpace.eu', 'www.ota.ownpace.eu'];
/** The production site (0139 T10): live's once switched on and routed, and only then. */
export const SITE_NAME = 'www.ownpace.eu';
export const SITE_MODES = ['report', 'required'];
export const ISSUER = 'https://id.ownpace.eu';
export const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
export const OTA_MODES = ['report', 'internet', 'mesh-only'];
export const TLS_PORT = 443;
/**
 * The page each of the four names answers a visitor first, and what answers
 * it when nothing stands in front (workplan 0139, item 8). The sign-in
 * service's is its discovery document, which the app's sign-in reads before
 * anything else.
 */
export const SIGN_IN_PAGES = [
  { name: 'app.ownpace.eu', path: '/', what: 'the app' },
  { name: 'id.ownpace.eu', path: '/.well-known/openid-configuration', what: 'the sign-in service' },
  { name: 'status.ownpace.eu', path: '/', what: 'the status page' },
  { name: SITE_NAME, path: '/', what: 'the website' },
];
/** Where NetBird's proxy serves the assets of its own pages (proxy/web/web.go, PathPrefix). */
export const NETBIRD_ASSETS = '/__netbird__/';

/** How the machine's own address is named in the log: by the secret that holds it. */
const HOST_LABEL = "the machine's own address (EXPOSURE_PROBE_HOST)";

/**
 * The probe's configuration from the environment the workflow hands it, or
 * the reasons it cannot run. No value from the environment is repeated.
 */
export function probeConfig(env, derivedPorts) {
  const errors = [];
  const live = (env.EXPOSURE_PROBE_LIVE_PORTS ?? '').trim();
  const livePorts = [];
  if (live === '') {
    errors.push(
      "EXPOSURE_PROBE_LIVE_PORTS is not set, so live's own ports (the *_PORT values in its .env, 0132 T1b) " +
        "would not be tried, and 'nothing else answers' would not cover live. Set the repository variable " +
        '(Settings, Secrets and variables, Actions, Variables) to those port numbers, separated by spaces or commas.',
    );
  } else {
    live
      .split(/[\s,]+/)
      .filter(Boolean)
      .forEach((token, i) => {
        const port = /^\d+$/.test(token) ? Number(token) : NaN;
        if (port >= 1 && port <= 65535) livePorts.push(port);
        else errors.push(`EXPOSURE_PROBE_LIVE_PORTS, entry ${i + 1}, is not one port number (1 to 65535).`);
      });
  }
  const otaMode = (env.EXPOSURE_PROBE_OTA_NAMES ?? '').trim() || 'report';
  if (!OTA_MODES.includes(otaMode)) {
    errors.push(`EXPOSURE_PROBE_OTA_NAMES must be one of ${OTA_MODES.join(', ')}.`);
  }
  const siteMode = (env.EXPOSURE_PROBE_SITE_NAME ?? '').trim() || 'report';
  if (!SITE_MODES.includes(siteMode)) {
    errors.push(`EXPOSURE_PROBE_SITE_NAME must be one of ${SITE_MODES.join(', ')}.`);
  }
  if (errors.length) return { errors };
  const ports = [...new Set([...derivedPorts, ...livePorts])].sort((a, b) => a - b);
  return { config: { ports, host: (env.EXPOSURE_PROBE_HOST ?? '').trim(), otaMode, siteMode }, errors: [] };
}

/** Run `fn` over `items`, at most `limit` at a time, keeping the order. */
async function inPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** A name, or several, and which of their addresses this is, never the address. */
function labelAddresses(groups) {
  const out = [];
  for (const { label, addresses } of groups) {
    addresses.forEach((address, i) => {
      const family = isIP(address) === 6 ? 'IPv6' : 'IPv4';
      const which = addresses.length > 1 ? `${family}, ${i + 1} of ${addresses.length}` : family;
      out.push({ address, label: `${label} (${which})` });
    });
  }
  return out;
}

/** An issuer to print: only a name under ownpace.eu, which cannot be an address. */
function shownIssuer(issuer) {
  return /^https:\/\/(?:[a-z0-9-]+\.)+ownpace\.eu$/.test(issuer) ? issuer : 'an issuer that is not an ownpace.eu name (not printed)';
}

/** A redirect's host to print: a name, never an address, and never the rest of the URL. */
function shownHost(host) {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return 'an address (not printed)';
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(host) ? host : 'a host (not printed)';
}

/**
 * What one of the four names answered, as a verdict: `itself`, `signin`
 * (NetBird's sign-in, or its page), `silent` (no answer at all) or `other`,
 * with the words for the log. `page` is `SIGN_IN_PAGES`'s entry.
 */
export function signInVerdict(page, answer) {
  const why = answer.why;
  if (answer.status === undefined) return { kind: 'silent', words: `does not answer (${why ?? 'no reason'})` };
  const status = answer.status;
  const own = `workplan 0139, item 8: switch NetBird's sign-in off for ${page.name}`;
  if (answer.netbird) {
    return {
      kind: 'signin',
      words: `${status}, NetBird's own page (it loads ${NETBIRD_ASSETS}), not ${page.what}: its sign-in (a password or a PIN), or its error page (${own})`,
    };
  }
  if (status >= 300 && status < 400) {
    let target;
    try {
      target = new URL(answer.location ?? '', `https://${page.name}${page.path}`);
    } catch {
      target = undefined;
    }
    if (target && target.hostname === page.name && !target.pathname.startsWith(NETBIRD_ASSETS)) {
      return { kind: 'itself', words: `${page.what} answers itself (${status} on the same name)` };
    }
    const where = target ? shownHost(target.hostname) : 'a Location that is not a URL';
    return {
      kind: 'signin',
      words: `${status} to another host, ${where}, not ${page.what}: NetBird's sign-in (SSO) sends a visitor to its identity provider this way (${own})`,
    };
  }
  if (status >= 200 && status < 300) return { kind: 'itself', words: `${page.what} answers itself (${status})` };
  if (status === 401 || status === 403) {
    return { kind: 'other', words: `${status}, a sign-in or access page, not ${page.what}` };
  }
  return { kind: 'other', words: `${status}, not ${page.what}` };
}

/**
 * The probe. `io` is the network and the log: `resolve`, `connect`, `tls`,
 * `issuer`, `page` and `print`. Returns the exit code.
 */
export async function runProbe(config, io) {
  const masked = new Set();
  const mask = (value) => {
    if (value && !masked.has(value)) {
      masked.add(value);
      io.print(`::add-mask::${value}`);
    }
  };

  // ---- Everything that could name the machine is masked first ------------
  let hostAddresses = [];
  let hostError;
  if (config.host) {
    mask(config.host);
    if (isIP(config.host)) {
      hostAddresses = [config.host];
    } else {
      const r = await io.resolve(config.host);
      r.addresses.forEach(mask);
      hostAddresses = r.addresses;
      if (!r.addresses.length) hostError = r.error ?? 'no address';
    }
  }
  const resolved = new Map();
  for (const name of [...PRODUCTION_NAMES, ...OTA_NAMES]) {
    const r = await io.resolve(name);
    r.addresses.forEach(mask);
    resolved.set(name, r);
  }
  const site = await io.resolve(SITE_NAME);
  site.addresses.forEach(mask);

  // ---- From here on, names and ports only ---------------------------------
  const findings = [];
  const say = (line) => io.print(line);
  const pass = (line) => say(`pass  ${line}`);
  const fail = (line) => {
    findings.push(line);
    say(`FAIL  ${line}`);
  };
  const note = (line) => say(`note  ${line}`);

  say(`exposure-probe: from outside, workplan 0132 T3. Ports tried on every address: ${config.ports.join(' ')}`);
  say(`exposure-probe: OTA names: ${config.otaMode} (open question 7)`);
  say(`exposure-probe: ${SITE_NAME}: ${config.siteMode} (workplan 0139 T10)`);

  // Live's front: what a production name, or the machine's own secret,
  // resolves to. The site's name is tried only there (above).
  const front = new Set([...PRODUCTION_NAMES.flatMap((n) => resolved.get(n).addresses), ...hostAddresses]);
  const siteOnFront = site.addresses.filter((a) => front.has(a));
  const siteElsewhere = site.addresses.length - siteOnFront.length;

  // Each address once, named by every name that resolves to it.
  const namesOf = new Map();
  for (const [name, r] of resolved) {
    for (const a of r.addresses) namesOf.set(a, [...(namesOf.get(a) ?? []), name]);
  }
  for (const a of siteOnFront) namesOf.set(a, [...(namesOf.get(a) ?? []), SITE_NAME]);
  const groups = new Map();
  for (const [address, names] of namesOf) {
    const label = names.join(', ');
    groups.set(label, [...(groups.get(label) ?? []), address]);
  }
  const targets = labelAddresses([...groups].map(([label, addresses]) => ({ label, addresses })));
  if (config.host && !hostError) targets.push(...labelAddresses([{ label: HOST_LABEL, addresses: hostAddresses }]));

  for (const [name, r] of [...resolved, [SITE_NAME, site]]) {
    if (r.addresses.length && r.error) note(`${name}: part of the lookup failed (${r.error}); tried what it did return`);
  }
  if (!config.host) note("EXPOSURE_PROBE_HOST is not set: the machine's own address was not tried");
  else if (hostError) fail(`EXPOSURE_PROBE_HOST does not resolve (${hostError}), so the machine's own address was not tried`);

  // ---- Nothing else answers -------------------------------------------------
  const tries = targets.flatMap((t) => config.ports.map((port) => ({ ...t, port })));
  const answers = await inPool(tries, 32, ({ address, port }) => io.connect(address, port));
  const untried = new Map();
  let open = 0;
  tries.forEach(({ label, port }, i) => {
    const answer = answers[i];
    if (answer === 'open') {
      open++;
      fail(`${label}: port ${port} answers`);
    } else if (typeof answer === 'object' && answer !== null) {
      const key = `${label}\u0000${answer.untried}`;
      untried.set(key, [...(untried.get(key) ?? []), port]);
    }
  });
  for (const [key, ports] of untried) {
    const [label, why] = key.split('\u0000');
    const which = ports.length === config.ports.length ? `any of the ${ports.length} ports` : `ports ${ports.join(' ')}`;
    note(`${label}: not tried from this runner (${why}), on ${which}; nothing is known about it`);
  }
  if (!open) pass(`no tried port answers on ${targets.length} address(es)`);

  // ---- 443 on the production names, over TLS -------------------------------
  for (const name of PRODUCTION_NAMES) {
    const r = resolved.get(name);
    if (!r.addresses.length) {
      fail(`${name} does not resolve (${r.error ?? 'no address'})`);
      continue;
    }
    const t = await io.tls(name);
    if (t.state === 'tls') pass(`${name}: ${TLS_PORT} answers over TLS`);
    else if (t.state === 'tcp-only') fail(`${name}: ${TLS_PORT} answers, but not over TLS for the name (${t.why ?? 'no reason'})`);
    else fail(`${name}: ${TLS_PORT} does not answer (${t.why ?? 'no reason'})`);
  }

  // ---- The production site, as live's .env and its route will decide ----------
  const siteSays = config.siteMode === 'required' ? fail : note;
  const siteWhy = config.siteMode === 'required' ? 'site_name is required' : 'recorded; site_name is report';
  const frontIs = `an address of ${PRODUCTION_NAMES.join(', ')} or EXPOSURE_PROBE_HOST`;
  if (!site.addresses.length) {
    siteSays(`${SITE_NAME} does not resolve (${site.error ?? 'no address'}); ${siteWhy}`);
  } else if (siteElsewhere) {
    siteSays(
      `${SITE_NAME}: ${siteElsewhere} of its ${site.addresses.length} address(es) are not live's front (${frontIs}), ` +
        `so no port was tried there and ${TLS_PORT} was not asked; ${siteWhy}`,
    );
  } else {
    const t = await io.tls(SITE_NAME);
    if (t.state === 'tls') pass(`${SITE_NAME}: ${TLS_PORT} answers over TLS, on live's front`);
    else if (t.state === 'tcp-only') siteSays(`${SITE_NAME}: ${TLS_PORT} answers, but not over TLS for the name (${t.why ?? 'no reason'}); ${siteWhy}`);
    else siteSays(`${SITE_NAME}: ${TLS_PORT} does not answer (${t.why ?? 'no reason'}); ${siteWhy}`);
  }

  // ---- The production names reach live --------------------------------------
  const doc = await io.issuer(DISCOVERY);
  if (doc.issuer === ISSUER) pass(`${DISCOVERY} names ${ISSUER} as its issuer`);
  else if (doc.issuer !== undefined) fail(`${DISCOVERY} names ${shownIssuer(doc.issuer)} as its issuer, not ${ISSUER}`);
  else fail(`${DISCOVERY} could not be read (${doc.why ?? 'no reason'})`);

  // ---- No NetBird sign-in in front of the four names (0139, item 8) ----------
  say(`exposure-probe: NetBird's sign-in off on ${SIGN_IN_PAGES.map((p) => p.name).join(', ')} (workplan 0139, item 8)`);
  const siteAsked = site.addresses.length > 0 && siteElsewhere === 0;
  for (const page of SIGN_IN_PAGES) {
    const isSite = page.name === SITE_NAME;
    if (isSite && !siteAsked) {
      note(`${SITE_NAME}: not asked for NetBird's sign-in, since it is not on live's front (${frontIs}) or does not resolve`);
      continue;
    }
    const label = `${page.name}${page.path}`;
    const verdict = signInVerdict(page, await io.page(`https://${label}`));
    if (verdict.kind === 'itself') pass(`${label}: ${verdict.words}, no NetBird sign-in in front`);
    else if (isSite && verdict.kind === 'silent') siteSays(`${label}: ${verdict.words}; ${siteWhy}`);
    else fail(`${label}: ${verdict.words}`);
  }

  // ---- The OTA names, as open question 7 will decide --------------------------
  for (const name of OTA_NAMES) {
    const r = resolved.get(name);
    const t = r.addresses.length ? await io.tls(name) : { state: 'none', why: r.error ?? 'no address' };
    const what =
      t.state === 'tls'
        ? `${TLS_PORT} answers over TLS`
        : t.state === 'tcp-only'
          ? `${TLS_PORT} answers, not over TLS for the name (${t.why ?? 'no reason'})`
          : `${TLS_PORT} does not answer (${t.why ?? 'no reason'})`;
    if (config.otaMode === 'report') note(`${name}: ${what}; recorded, open question 7 decides whether it should`);
    else if (config.otaMode === 'internet') (t.state === 'tls' ? pass : fail)(`${name}: ${what}; ota_names is internet`);
    else (t.state === 'none' ? pass : fail)(`${name}: ${what}; ota_names is mesh-only`);
  }

  if (findings.length) {
    say(`exposure-probe: FAIL, ${findings.length} finding(s)`);
    return 1;
  }
  say('exposure-probe: pass');
  return 0;
}

/** Error codes that say the runner could not try, not that the port is closed. */
const CANNOT_TRY = new Set(['ENETUNREACH', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EPERM', 'EACCES']);

/** The real network, with its timeouts. Nothing here reads an error's message. */
export function realNetwork({ connectMs = 5000, tlsMs = 10000, fetchMs = 15000 } = {}) {
  return {
    async resolve(name) {
      const [v4, v6] = await Promise.allSettled([dns.resolve4(name), dns.resolve6(name)]);
      const addresses = [
        ...(v4.status === 'fulfilled' ? v4.value : []),
        ...(v6.status === 'fulfilled' ? v6.value : []),
      ];
      const benign = new Set(['ENODATA', 'ENOTFOUND']);
      const codes = [v4, v6].filter((r) => r.status === 'rejected').map((r) => r.reason?.code ?? 'error');
      const hard = codes.find((c) => !benign.has(c));
      if (hard) return { addresses, error: hard };
      return addresses.length ? { addresses } : { addresses, error: codes[0] ?? 'no address' };
    },

    connect(address, port) {
      return new Promise((done) => {
        const socket = netConnect({ host: address, port });
        const finish = (answer) => {
          socket.destroy();
          done(answer);
        };
        socket.setTimeout(connectMs, () => finish('silent'));
        socket.once('connect', () => finish('open'));
        socket.once('error', (e) => {
          const code = e?.code ?? 'error';
          finish(CANNOT_TRY.has(code) ? { untried: code } : 'closed');
        });
      });
    },

    tls(name) {
      return new Promise((done) => {
        let tcp = false;
        const socket = tlsConnect({ host: name, port: TLS_PORT, servername: name });
        const finish = (answer) => {
          socket.destroy();
          done(answer);
        };
        socket.setTimeout(tlsMs, () => finish({ state: tcp ? 'tcp-only' : 'none', why: 'timeout' }));
        socket.once('connect', () => {
          tcp = true;
        });
        socket.once('secureConnect', () => finish({ state: 'tls' }));
        socket.once('error', (e) => finish({ state: tcp ? 'tcp-only' : 'none', why: e?.code ?? 'error' }));
      });
    },

    /**
     * One page as a visitor's first request gets it: no redirect followed, the
     * status, a redirect's Location, and whether the body loads NetBird's own
     * assets. Nothing of the body is kept, and a failure is its code alone.
     */
    async page(url) {
      try {
        const res = await fetch(url, { redirect: 'manual', signal: globalThis.AbortSignal.timeout(fetchMs) });
        const body = await res.text();
        const location = res.headers.get('location');
        return {
          status: res.status,
          ...(location === null ? {} : { location }),
          netbird: body.includes(NETBIRD_ASSETS),
        };
      } catch (e) {
        return { why: e?.cause?.code ?? e?.name ?? 'error' };
      }
    },

    async issuer(url) {
      try {
        const res = await fetch(url, { redirect: 'manual', signal: globalThis.AbortSignal.timeout(fetchMs) });
        if (res.status !== 200) return { why: `HTTP ${res.status}` };
        const body = await res.json();
        return typeof body?.issuer === 'string' ? { issuer: body.issuer } : { why: 'no issuer in the document' };
      } catch (e) {
        return { why: e?.cause?.code ?? e?.name ?? 'error' };
      }
    },
  };
}

async function main() {
  // The secret first, before anything could print it.
  const host = (process.env.EXPOSURE_PROBE_HOST ?? '').trim();
  if (host) console.log(`::add-mask::${host}`);

  const derived = readPorts();
  if (derived.problems.length) {
    for (const p of derived.problems) console.log(`exposure-probe: cannot read ${p}`);
    console.log('exposure-probe: the port list is incomplete, so nothing was tried (scripts/exposure-probe-ports.mjs)');
    return 2;
  }
  const { config, errors } = probeConfig(
    process.env,
    derived.ports.map((p) => p.port),
  );
  if (!config) {
    for (const e of errors) console.log(`exposure-probe: ${e}`);
    return 2;
  }
  const report = [];
  const code = await runProbe(config, {
    ...realNetwork(),
    print: (line) => {
      console.log(line);
      if (!line.startsWith('::')) report.push(line);
    },
  });
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `## Exposure probe\n\n\`\`\`\n${report.join('\n')}\n\`\`\`\n`);
  return code;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      // The code only: a message may name the address it failed on.
      console.log(`exposure-probe: stopped (${e?.code ?? e?.name ?? 'error'})`);
      process.exitCode = 2;
    },
  );
}
