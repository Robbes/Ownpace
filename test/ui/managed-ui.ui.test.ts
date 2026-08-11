// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Does the MANAGED UI work in a browser? (the 2026-08-11 lesson)
//
// On 2026-08-11 the owner spent an afternoon clicking through the running
// managed app and found eight defects. The unit suite was green before and
// after: 2202 tests, none of which had ever opened a page. Three of the eight
// were only findable this way, and all three had shipped:
//
//   * THE STYLESHEET NEVER COMPILED. Both editions served raw unstyled HTML
//     for weeks. Every existing check passed — the packaging test asserts
//     `/ui/confirm` returns `<!doctype html>`, the e2e UI smoke asserts the
//     screens boot, and both are true of a completely unstyled page.
//   * THE BUNDLE CALLED THE WRONG ORIGIN. A stale `VITE_API_URL` baked an
//     absolute `http://localhost:3123/api` into the shipped JavaScript, so
//     every screen showed "Network Error" from any machine that was not the
//     server. Nothing in the repo asserts where the app sends its requests.
//   * THE LIST ROWS WERE DEAD. They had a hover state and no click handler.
//
// This file is the gate those three would have failed. It is a SMOKE, not a
// visual or functional test suite: it asks whether the shipped bundle
// evaluates, renders, is styled, talks to its own origin, and tells the truth
// when a read fails. Pixel diffs, wizard flows and money paths are out of
// scope and belong to the component tests that already cover them.
//
// ## No API, no database, no Docker — and that is deliberate
//
// The three defects above are all in the BUNDLE and its relationship to the
// origin serving it. None of them needs a real API to reproduce, and requiring
// one would have pushed this suite into the nightly e2e job, where it would
// have caught them a release too late. Instead a ~40-line fixture server plays
// the part nginx plays in production: it serves `apps/web/dist` and answers
// `/api/*` at the SAME ORIGIN.
//
// That is what makes the origin assertion honest. A bundle carrying a baked
// absolute URL does not reach this server at all, so the screens render their
// error state and the test fails — the real failure, reproduced, rather than
// mocked away by intercepting whatever URL the app happened to ask for.
//
// The build runs with VITE_API_URL explicitly REMOVED from the environment,
// because the shipped default (`/api`, same-origin) is the thing under test.
// A machine that happens to export it — the exact accident that caused the
// live outage — must not be able to make this suite pass.
//
// ## What this suite cannot see
//
// Server-side truth. The same afternoon turned up a mapping list reporting
// "last sync: 9 days ago" for a mapping syncing every 15 minutes, and 24.3
// billable compute hours for seconds of work. Both were real, both were
// invisible here: the UI rendered exactly what the API told it. Those are
// caught by the ledger and worker tests, and by looking at a live deployment.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DIST = join(REPO, 'apps/web/dist');
const EXPLICIT_CHROMIUM = process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium';

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const MAPPING = 'a0000000-0000-4000-8000-0000000000d1';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * NOT A CREDENTIAL, and it does not need to be: nothing here verifies a
 * signature. The client decodes the payload for the claims it needs and the
 * API — absent in this suite — is what checks the signature on every call. The
 * claims are the ones `decodeTokenClaims` requires; omitting any of them makes
 * the sign-in screen refuse the paste, which is itself the product working.
 */
const TOKEN = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    sub: 'ui-smoke',
    email: 'owner-a@demo.openmigrate.test',
    tenantId: TENANT,
    role: 'owner',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
  'ui-smoke-not-a-signature',
].join('.');

/**
 * What the API would answer. Keyed `METHOD /path`.
 *
 * Shapes come from the OpenAPI document and the live smoke output, not from
 * imagination — a fixture that does not look like the server teaches this
 * suite to accept a UI that could never work against the real one.
 */
const FIXTURES: Record<string, unknown> = {
  [`GET /api/migrations`]: {
    mappings: [
      {
        id: MAPPING,
        tenantId: TENANT,
        name: 'Acme Families — mail',
        sourceType: 'imap',
        targetType: 'jmap',
        status: 'active',
        mode: 'mirror',
        pattern: null,
        domains: ['email'],
        lastSyncAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  },
  [`GET /api/migrations/${MAPPING}`]: {
    id: MAPPING,
    tenantId: TENANT,
    name: 'Acme Families — mail',
    status: 'active',
    mode: 'mirror',
    domains: ['email'],
    domainStatus: [
      { domain: 'email', state: 'completed', itemsSynced: 3, itemsFailed: 0, startedAt: new Date().toISOString() },
    ],
    sourceConfig: { type: 'imap-oauth2', host: 'stalwart', port: 993, username: 'source@dev.local', password: '********' },
    targetConfig: { type: 'jmap', baseUrl: 'http://stalwart:8080', username: 'target@dev.local', password: '********' },
  },
  [`GET /api/migrations/${MAPPING}/runs`]: {
    runs: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'succeeded',
        kind: 'incremental',
        trigger: 'schedule',
        startedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
        finishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        itemsProcessed: 3,
        errors: 0,
        events: [],
      },
    ],
  },
};

/** Per-test failures: `METHOD /path` -> status. Cleared between tests. */
const failures = new Map<string, number>();
/** Every `/api` path the browser asked for, and the ones no fixture knew. */
const apiHits: string[] = [];
const apiMisses: string[] = [];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * nginx's job, in one function: static files from the build, `/api` at the
 * same origin, and an index.html fallback so client-side routes reload.
 */
function startServer(): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const key = `${req.method} ${url.pathname}`;

    if (url.pathname.startsWith('/api')) {
      apiHits.push(url.pathname);
      const forced = failures.get(key);
      if (forced) {
        res.writeHead(forced, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error', message: 'the database is unreachable' }));
        return;
      }
      const body = FIXTURES[key];
      if (body === undefined) {
        apiMisses.push(key);
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found', message: `no fixture for ${key}` }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    // Static, with traversal refused the boring way.
    const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, rel);
    if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
      file = join(DIST, 'index.html');
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });

  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      ok({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

let browser: Browser;
let server: Server;
let BASE: string;

interface Loaded {
  readonly page: Page;
  readonly errors: string[];
  readonly badResponses: string[];
  readonly origins: Set<string>;
  text(): Promise<string>;
}

/** Load a route as a signed-in operator, recording what a user cannot see. */
async function open(
  path: string,
  opts: { locale?: 'en' | 'nl'; signedIn?: boolean } = {},
): Promise<Loaded> {
  const page = await browser.newPage({
    locale: opts.locale === 'nl' ? 'nl-NL' : 'en-GB',
  });
  const errors: string[] = [];
  const badResponses: string[] = [];
  const origins = new Set<string>();

  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('requestfailed', (r) => badResponses.push(`${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.url()} -> ${r.status()}`);
  });
  page.on('request', (r) => origins.add(new URL(r.url()).origin));

  await page.addInitScript(
    (locale) => window.localStorage.setItem('openmig.locale', locale as string),
    opts.locale ?? 'en',
  );

  if (opts.signedIn !== false) {
    // Through the product's own front door, rather than by writing its auth
    // store's persisted shape into localStorage. A test that seeds internals
    // keeps passing after sign-in breaks, and the sign-in screen is the first
    // thing every operator meets.
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.fill('#token', TOKEN);
    await page.click('form button[type=submit]');
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15_000 });
  }

  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30_000 });
  return { page, errors, badResponses, origins, text: async () => (await page.textContent('body')) ?? '' };
}

function expectClean(l: Loaded, what: string): void {
  expect(l.errors, `${what} raised errors in the browser`).toEqual([]);
  expect(l.badResponses, `${what} had failed requests`).toEqual([]);
}

beforeAll(async () => {
  // The bundle as it SHIPS. VITE_API_URL is deleted rather than merely unset:
  // an exported value in the developer's shell is the exact accident that put
  // an absolute origin into a production build (2026-08-11), and it must not
  // be able to make this suite pass.
  const env = { ...process.env };
  delete env.VITE_API_URL;
  execFileSync('pnpm', ['--filter', '@openmig/web', 'build'], { cwd: REPO, env, stdio: 'pipe' });
  expect(existsSync(join(DIST, 'index.html')), 'the web build produced no index.html').toBe(true);

  ({ server, base: BASE } = await startServer());
  browser = await chromium.launch({
    ...(existsSync(EXPLICIT_CHROMIUM) ? { executablePath: EXPLICIT_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

describe('the managed UI boots and is styled', () => {
  it('renders the sign-in screen instead of a blank page', async () => {
    const l = await open('/login', { signedIn: false });
    expect(await l.page.locator('#root > *').count(), 'the bundle served but never mounted').toBeGreaterThan(0);
    expect(await l.text()).toContain('Sign in to Open Migrate'); // i18n key login.title
    expectClean(l, '/login');
    await l.page.close();
  });

  it('SHIPS A COMPILED STYLESHEET — the defect that reached production', async () => {
    const l = await open('/login', { signedIn: false });

    // An uncompiled index.css still loads and still parses — what it does not
    // have is SIZE. The broken build shipped 3.08 KB of `:root` variables
    // against 35.63 KB of real utilities, so the served bytes separate "a
    // stylesheet arrived" from "the stylesheet was built".
    //
    // Counting `cssRules` was the first attempt and it was wrong: Tailwind v4
    // emits its utilities inside `@layer`, which is ONE top-level rule, so a
    // perfectly good stylesheet counted 55. A metric that fails on working
    // code teaches people to delete the test.
    const cssBytes = await l.page.evaluate(async () => {
      const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')];
      const sizes = await Promise.all(
        links.map(async (link) => (await (await fetch(link.href)).text()).length),
      );
      return sizes.reduce((a, b) => a + b, 0);
    });
    expect(cssBytes, 'the served stylesheet is tiny — Tailwind did not compile').toBeGreaterThan(20_000);

    // And the rules reach the page: a utility-classed button must not be
    // rendering with the browser's default chrome.
    const bg = await l.page.evaluate(() => {
      const el = document.querySelector('form button[type=submit]') ?? document.querySelector('button');
      return el ? getComputedStyle(el).backgroundColor : '';
    });
    expect(bg, 'the submit button has no background — styles are not applied').not.toMatch(
      /rgba\(0, 0, 0, 0\)|transparent|^$/,
    );
    await l.page.close();
  });
});

describe('the managed UI talks to its own origin', () => {
  it('SENDS API REQUESTS SAME-ORIGIN — the defect that broke the live deployment', async () => {
    const l = await open('/mappings');
    await l.page.waitForSelector('tbody tr', { timeout: 10_000 });

    // Every request, including the API ones, went to the origin that served
    // the page. A bundle with a baked absolute URL fails here by never
    // reaching the fixture server at all.
    expect([...l.origins], 'the app called an origin other than the one serving it').toEqual([BASE]);
    expect(apiHits.some((p) => p.startsWith('/api/')), 'the app made no API call at all').toBe(true);
    expectClean(l, '/mappings');
    await l.page.close();
  });

  it('asks only for endpoints the API actually serves', async () => {
    // apiMisses is filled by the fixture server whenever the UI asks for a
    // path no fixture knows. Every entry is either a route this suite has not
    // modelled or one the API does not serve — both worth seeing, neither
    // worth guessing about.
    expect(apiMisses, 'the UI called endpoints with no fixture').toEqual([]);
  });
});

describe('the migrations list', () => {
  it('renders the migrations the API returned', async () => {
    const l = await open('/mappings');
    await l.page.waitForSelector('tbody tr');
    const text = await l.text();
    expect(text).toContain('Acme Families — mail');
    expect(text).not.toContain('No migrations yet'); // i18n key mappings.empty.title
    expectClean(l, '/mappings');
    await l.page.close();
  });

  it('OPENS THE MIGRATION WHEN THE ROW IS CLICKED — the dead-row defect', async () => {
    const l = await open('/mappings');
    await l.page.waitForSelector('tbody tr');

    // The status cell: inside the row, outside every button and link, which is
    // exactly where the owner clicked and nothing happened.
    await l.page.locator('tbody tr:first-child td').nth(2).click();
    await l.page.waitForURL(`**/mappings/${MAPPING}`, { timeout: 10_000 });

    expect(l.page.url()).toContain(`/mappings/${MAPPING}`);
    expect(await l.page.locator('#root > *').count()).toBeGreaterThan(0);
    expectClean(l, 'the migration detail reached by clicking a row');
    await l.page.close();
  });

  it('says a read FAILED rather than showing an empty list (hard rule 9)', async () => {
    failures.set('GET /api/migrations', 500);
    try {
      const l = await open('/mappings');
      // Waited for, not sampled: the client retries a failed read with backoff,
      // so the honest error arrives seconds after the screen first paints.
      // Sampling early reads the spinner and calls it a pass.
      await l.page.locator('text=Could not load the migrations list.').first().waitFor({ timeout: 30_000 });

      // The distinction the product exists to make: "I could not look" must
      // never render as "there is nothing".
      expect(await l.text()).not.toContain('No migrations yet'); // mappings.empty.title
      await l.page.close();
    } finally {
      failures.delete('GET /api/migrations');
    }
  });
});

describe('bilingual rendering', () => {
  it('renders Dutch for a Dutch browser, from the same bundle', async () => {
    const en = await open('/login', { signedIn: false, locale: 'en' });
    const enText = await en.text();
    await en.page.close();

    const nl = await open('/login', { signedIn: false, locale: 'nl' });
    const nlText = await nl.text();
    expectClean(nl, '/login (nl)');
    await nl.page.close();

    expect(nlText).toContain('Aanmelden bij Open Migrate'); // login.title, nl
    expect(nlText).not.toBe(enText);
  });
});
