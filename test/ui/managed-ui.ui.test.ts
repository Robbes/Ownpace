// Copyright 2026 The Ownpace authors (Apache-2.0)
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
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page, type Request } from 'playwright-core';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DIST = join(REPO, 'apps/web/dist');
const EXPLICIT_CHROMIUM = process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium';

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const MAPPING = 'a0000000-0000-4000-8000-0000000000d1';
const PERSON = 'a0000000-0000-4000-8000-0000000000e1';

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
  /**
   * ASKED ON EVERY SIGNED-IN SCREEN, because that is where the answer belongs.
   *
   * `PlatformPauseBanner` sits in the layout: an operator hold stops copying
   * for every migration a person has, so a notice on one of their pages would
   * be the same silence one click away. That makes this the second fixture,
   * after the build stamp, that every single page in this suite needs — and
   * without it the browser logs a 404 for a resource on every load, which is
   * exactly what `expectClean` is watching for.
   *
   * `held: false` is the shape the route answers when nothing is held. Not a
   * 404: "we asked and the answer is no" and "we could not ask" must not look
   * the same to the screen, and the banner renders nothing for either.
   */
  [`GET /api/platform-pause`]: { held: false },
  /**
   * WHETHER TO OFFER "REPORT A PROBLEM" (workplan 0130), asked by the layout on
   * every signed-in page, like the hold above: the link beside Sign out is
   * shown only when the deployment has somewhere to send a report to.
   *
   * `available: true` is the answer of a deployment with its Zammad or its
   * mail set up (the mail alone is enough since 0130 T5), so
   * the link renders on every page this suite opens, and the form it leads to
   * is opened below. Without this fixture every page logs a 404, which is how
   * this entry came to be written.
   */
  [`GET /api/problem-reports/available`]: { available: true },
  /**
   * WHAT A REPORT FROM THIS PAGE WOULD CARRY (workplan 0130 T6), asked by the
   * form once it knows the service takes reports: where it goes, and its
   * lines of facts, which the form shows verbatim in its fold. The lines are
   * the API's to write; two stand for them here.
   */
  [`GET /api/problem-reports/preview`]: {
    to: { kind: 'mail', addresses: ['support@example.invalid'] },
    lines: ['Page: /mappings', 'Role: owner'],
  },
  // The build stamp in the sidebar asks the server what IT is running
  // (services/build-identity.ts). Answered from the ROOT package.json rather
  // than a literal, for the same reason every other consumer reads it there:
  // a copy here would drift and this suite would go on asserting against the
  // wrong one. Commit left empty, which is what an unstamped build sends —
  // and what the bundle under test has, since nothing passes GIT_SHA here.
  [`GET /api/version`]: {
    version: (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version: string })
      .version,
    commit: '',
  },
  /**
   * WHAT THIS DEPLOYMENT ACCEPTS, asked before the page offers anything at all
   * (workplan 0102 T1).
   *
   * The bundle under test carries no `VITE_OIDC_ISSUER`, and the paste box used
   * to follow from that alone. It now follows from the API's answer, so without
   * this fixture the page renders its "checking" line forever and every case
   * below times out looking for a textarea — the same shape of failure the
   * missing `/api/me` fixture caused in #559, and the reason it is spelled out
   * here rather than left as one more line in a table.
   */
  [`GET /api/auth/mode`]: { mode: 'local', acceptsSeedToken: true },
  /**
   * WHO THE SIGN-IN SCREEN ASKS ABOUT, and the reason `open()` below can reach
   * a dashboard at all.
   *
   * The paste path used to log in on the strength of its own decode. It now
   * asks the API first, because a token this app can DECODE is not a token the
   * API will ACCEPT — on a stack with an issuer configured it never is, and the
   * old behaviour turned that into a dashboard flash and a silent bounce back
   * to the login screen.
   *
   * So this fixture is not scaffolding for the test: it is the call the product
   * makes, and its absence is why this suite timed out waiting to leave /login.
   * The identity is the API's to state (ADR-0042) and deliberately differs from
   * nothing in TOKEN — the claims agree here because a real `/api/me` resolving
   * this subject WOULD agree.
   */
  [`GET /api/me`]: {
    userId: 'ui-smoke',
    email: 'owner-a@demo.openmigrate.test',
    tenantId: TENANT,
    role: 'owner',
    tenants: [{ tenantId: TENANT, role: 'owner' }],
    operator: false,
    invitations: [],
  },
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
  /**
   * WHO EACH MIGRATION IS FOR (workplan 0153 T3, ADR-0050): the Migrations
   * page is one card per person, so it reads the people beside the
   * migrations. The shape is `packages/shared/src/people.ts`'s, which the
   * route answers on both editions.
   */
  [`GET /api/people`]: {
    people: [
      {
        id: PERSON,
        implicit: false,
        displayName: 'Anna',
        email: null,
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        migrations: [{ id: MAPPING, status: 'active' }],
        counts: { paused: 0, active: 1, cutover: 0, done: 0, continuous: 0 },
      },
    ],
    unassigned: [],
  },
  /**
   * THE PERSON'S ONE LINK (ADR-0035, amended 2026-09-29; 0153 T5 (b)): their
   * page lists it, as `person-link-routes.ts` answers, and none is made yet.
   */
  [`GET /api/people/${PERSON}/links`]: { links: [] },
  /**
   * WHAT WAITS FOR THEIR GRANT (start when granted, per person): their page
   * asks beside the links, and nothing of theirs waits.
   */
  [`GET /api/people/${PERSON}/awaiting-grant`]: { migrations: [] },
  /**
   * WHAT NEEDS EACH PERSON, counted on their card (0153 T3 (a)). `?all=true`
   * keeps the quiet migrations, so this one is here with nothing waiting.
   */
  [`GET /api/attention`]: {
    mappings: [
      {
        mappingId: MAPPING,
        name: 'Acme Families — mail',
        pendingDecisions: 0,
        deletionsWaiting: 0,
        movesWaiting: 0,
        failuresWaiting: 0,
        readyForCutover: false,
        autoApplied: 0,
        sharingOpen: 0,
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
/**
 * Forced refusals. A bare number is a status with a generic body; the object
 * form carries the BODY too, because one refusal in this product is keyed on
 * its sentence rather than its status — `api.ts` treats
 * `403 {message: 'No active membership for this tenant'}` as a dead session and
 * signs the caller out, and a generic 403 proves nothing about it.
 */
const failures = new Map<string, number | { status: number; body: unknown }>();
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
        const status = typeof forced === 'number' ? forced : forced.status;
        const body =
          typeof forced === 'number'
            ? { error: 'Internal server error', message: 'the database is unreachable' }
            : forced.body;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
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
  // THE SIGN-IN'S LANDING PAGE IS LET SETTLE before the goto below leaves it.
  // Leaving a page aborts whatever it still had in flight, and the landing page
  // starts its requests a moment after its address changes, which is all
  // waitForURL waits for: the goto then aborted them, in this test's own
  // navigation, in a third to a half of the runs once 0139 T3's gate moved the
  // timing. So the landing page gets what goto gives the page it loads, 500 ms
  // with nothing in flight (settled(), below), and an abort of what it asked
  // for is still let through, should one start in the last moment. An answer
  // of 400 or more, or any other failure, from the landing page still counts.
  const landing = new Set<Request>();
  let signingIn = opts.signedIn !== false;
  let inFlight = 0;
  let lastChange = Date.now();
  page.on('request', (r) => {
    if (signingIn) landing.add(r);
    inFlight += 1;
    lastChange = Date.now();
  });
  page.on('requestfinished', () => {
    inFlight -= 1;
    lastChange = Date.now();
  });
  page.on('requestfailed', (r) => {
    inFlight -= 1;
    lastChange = Date.now();
    const failure = r.failure()?.errorText;
    if (landing.has(r) && failure === 'net::ERR_ABORTED') return;
    badResponses.push(`${r.url()} (${failure})`);
  });
  const settled = async (): Promise<void> => {
    const until = Date.now() + 15_000;
    while ((inFlight > 0 || Date.now() - lastChange < 500) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 50));
    }
  };
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
    await settled();
  }

  signingIn = false;
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
    expect(await l.text()).toContain('Sign in to Ownpace'); // i18n key login.title
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
    await l.page.waitForSelector('[data-migration]', { timeout: 10_000 });

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
  it('renders the migrations the API returned, on the card of the person they are for', async () => {
    const l = await open('/mappings');
    await l.page.waitForSelector('[data-migration]');
    const text = await l.text();
    expect(text).toContain('Acme Families — mail');
    expect(await l.page.getByRole('heading', { name: 'Anna' }).count(), 'no card for the person').toBe(1);
    expect(text).not.toContain('No migrations yet'); // i18n key mappings.empty.title
    expectClean(l, '/mappings');
    await l.page.close();
  });

  it('OPENS THE MIGRATION WHEN THE ROW IS CLICKED — the dead-row defect', async () => {
    const l = await open('/mappings');
    await l.page.waitForSelector('[data-migration]');

    // Its last pass: inside the migration, outside every button and link,
    // which is where the owner clicked a row and nothing happened.
    await l.page.locator(`[data-migration="${MAPPING}"]`).getByText(/Last pass/).first().click(); // people.lastPass
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

  it('says the PEOPLE read failed rather than showing every migration as nobody’s (0153 T3 (d))', async () => {
    failures.set('GET /api/people', 500);
    try {
      const l = await open('/mappings');
      await l.page.locator('text=Could not load who each migration is for.').first().waitFor({ timeout: 30_000 }); // people.loadFailed
      const text = await l.text();
      expect(text).not.toContain('No migrations yet'); // mappings.empty.title
      expect(text).not.toContain('Not with a person yet'); // people.unassigned.title
      await l.page.close();
    } finally {
      failures.delete('GET /api/people');
    }
  });
});

describe('the landing page (0153 T3 (b), the owner\'s D7)', () => {
  it('signs a member in to Migrations, with the menu the drawing shows', async () => {
    // Through the front door, as `open` does, but without its second goto:
    // where the sign-in itself lands is the thing under test.
    const page = await browser.newPage({ locale: 'en-GB' });
    await page.addInitScript(() => window.localStorage.setItem('openmig.locale', 'en'));
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.fill('#token', TOKEN);
    await page.click('form button[type=submit]');
    await page.waitForURL((u) => u.pathname === '/mappings', { timeout: 15_000 });
    await page.waitForSelector('[data-migration]');

    const links = await page.$$eval('nav a', (as) => as.map((a) => (a.textContent ?? '').trim()));
    expect(links.slice(0, 5)).toEqual(['Migrations', 'Needs you', 'Accounts', 'Help', 'Team']);
    expect(links, 'the Dashboard went (D7)').not.toContain('Dashboard');
    await page.close();
  });

  it('counts beside Needs you what waits, in the menu (0153 T3 (c))', async () => {
    const saved = FIXTURES['GET /api/attention'] as { mappings: Record<string, unknown>[] };
    FIXTURES['GET /api/attention'] = {
      mappings: [{ ...saved.mappings[0], failuresWaiting: 2, pendingDecisions: 1 }],
    };
    try {
      const l = await open('/mappings');
      await l.page.waitForSelector('#nav-needs-you-count');
      expect(await l.page.textContent('#nav-needs-you-count')).toContain('3 waiting on you');
      const described = await l.page.getAttribute('nav a[href="/decisions"]', 'aria-describedby');
      expect(described, 'the count is not the link\'s description').toBe('nav-needs-you-count');
      expectClean(l, 'the menu with a count');
      await l.page.close();
    } finally {
      FIXTURES['GET /api/attention'] = saved;
    }
  });

  it("opens a person's page from their card, with their steps before they switch (0153 T5)", async () => {
    // Their one migration ran, and waits for them to connect again.
    const waits = `GET /api/people/${PERSON}/awaiting-grant`;
    const saved = FIXTURES[waits];
    FIXTURES[waits] = { migrations: [{ mappingId: MAPPING, then: 'ran_before' }] };
    try {
      const l = await open('/mappings');
      await l.page.getByRole('link', { name: 'Anna', exact: true }).click();
      await l.page.waitForURL(`**/people/${PERSON}`, { timeout: 10_000 });
      await l.page.getByRole('heading', { name: 'Before you switch' }).waitFor({ timeout: 10_000 });
      expect(await l.page.getByRole('heading', { level: 1, name: 'Anna' }).count()).toBe(1);
      expect(await l.page.locator('[data-step]').count()).toBe(7);
      // Their one grant link (0153 T5 (b)): none made yet, read from its own door.
      await l.page.getByRole('heading', { name: 'For Anna' }).waitFor({ timeout: 10_000 });
      await l.page.getByText('No link yet for this person.').waitFor({ timeout: 10_000 });
      expect(apiHits).toContain(`/api/people/${PERSON}/links`);
      // What their grant does, beside the migration it waits on.
      await l.page.getByText('Waits for Anna to connect again.').waitFor({ timeout: 10_000 });
      expect(await l.page.locator(`[data-migration="${MAPPING}"] [data-awaiting-grant="ran_before"]`).count()).toBe(1);
      expect(apiHits).toContain(`/api/people/${PERSON}/awaiting-grant`);
      expectClean(l, "a person's page");
      await l.page.close();
    } finally {
      FIXTURES[waits] = saved;
    }
  });

  it('starts a migration for Anna from their card, through six screens and one Start, to their page (0153 T4)', async () => {
    // What the flow asks for, answered as the API would: Anna's saved mail
    // account and a saved Soverin, what this deployment serves, and the
    // create, the count and the start of one migration. Restored after, so no
    // other case sees them.
    const NEW = 'a0000000-0000-4000-8000-0000000000d9';
    const at = new Date(Date.now() + 60_000).toISOString();
    const detail = {
      id: NEW,
      tenantId: TENANT,
      name: 'Anna — example.nl to Soverin',
      sourceType: 'imap',
      targetType: 'soverin',
      status: 'paused',
      mode: 'mirror',
      syncConfig: { domains: ['email'], schedule: '0 2 * * *' },
      sourceConfig: {},
      targetConfig: {},
      domainStatus: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const added: Record<string, unknown> = {
      'GET /api/connections': {
        connections: [
          { id: 'c0000000-0000-4000-8000-000000000001', role: 'source', kind: 'imap', displayName: 'Anna mail', status: 'connected', createdAt: at, usedByMigrations: 0, knownValues: { host: 'imap.example.nl', port: '993', username: 'anna@example.nl' } },
          { id: 'c0000000-0000-4000-8000-000000000002', role: 'target', kind: 'soverin', displayName: 'Anna Soverin', status: 'connected', createdAt: at, usedByMigrations: 0, knownValues: { username: 'anna@soverin.net' } },
        ],
      },
      'GET /api/provider-accounts': {
        google: { domains: ['calendar', 'contact', 'task'], client: 'deployment' },
        microsoft: { domains: ['email', 'calendar', 'contact', 'file', 'task'] },
      },
      'GET /api/provider-clients': { google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' },
      'POST /api/migrations': detail,
      [`POST /api/people/${PERSON}/migrations`]: (FIXTURES['GET /api/people'] as { people: unknown[] }).people[0],
      [`POST /api/migrations/${NEW}/discover`]: {},
      [`GET /api/migrations/${NEW}`]: detail,
      [`GET /api/migrations/${NEW}/discovery`]: {
        mappingId: NEW,
        discovered: true,
        domains: [{ domain: 'email', collections: 12, items: 18734, bytes: 3_400_000_000, discoveredAt: at }],
      },
      'GET /api/scope-manifest': {
        version: 'ui-smoke',
        migrates: [{ item: 'Email', detail: 'Folders, flags and timestamps.' }],
        partial: [],
        doesNotMigrate: [],
      },
      [`POST /api/migrations/${NEW}/start`]: { id: NEW, status: 'active' },
    };
    Object.assign(FIXTURES, added);
    const missesBefore = apiMisses.length;
    try {
      const l = await open('/mappings');
      const next = () => l.page.getByRole('button', { name: 'Next' }).click();
      await l.page.getByRole('link', { name: 'Add a migration' }).click();
      await l.page.waitForURL(`**/start?person=${PERSON}`, { timeout: 10_000 });
      expect(await l.page.getByRole('radio', { name: 'Anna' }).isChecked()).toBe(true);
      await next();
      await l.page.getByRole('checkbox', { name: 'Another mail provider' }).check();
      await next();
      await l.page.getByRole('heading', { level: 2, name: 'What moves?' }).waitFor({ timeout: 10_000 });
      await next();
      // The one saved account is the default: nothing to type.
      await l.page.getByText('Connected as anna@example.nl').waitFor({ timeout: 10_000 });
      await next();
      await l.page.getByRole('heading', { level: 2, name: 'Where does it go?' }).waitFor({ timeout: 10_000 });
      await next();
      await l.page.getByRole('heading', { level: 2, name: 'Check, then start' }).waitFor({ timeout: 15_000 });
      const start = l.page.getByRole('button', { name: 'Start', exact: true });
      await expect.poll(() => start.isEnabled(), { timeout: 15_000 }).toBe(true);
      await start.click();
      await l.page.waitForURL(`**/people/${PERSON}`, { timeout: 15_000 });
      expect(apiHits).toContain(`/api/migrations/${NEW}/start`);
      expect(apiMisses.slice(missesBefore), 'the flow called endpoints with no fixture').toEqual([]);
      expectClean(l, 'Start a migration');
      await l.page.close();
    } finally {
      for (const key of Object.keys(added)) delete FIXTURES[key];
    }
  });

  it('sends an old /dashboard link to Migrations, so a bookmark still lands', async () => {
    const l = await open('/dashboard');
    await l.page.waitForURL((u) => u.pathname === '/mappings', { timeout: 10_000 });
    await l.page.waitForSelector('[data-migration]');
    expectClean(l, 'an old /dashboard link');
    await l.page.close();
  });
});

describe("the wizard's progress row (0153 T7 (f))", () => {
  // The line between two steps was drawn absolutely from 4rem to the step's
  // right edge, so it ran through every label longer than a word. Only a
  // layout engine can see that: jsdom has no boxes. Measured at a laptop's
  // width in both languages, where the labels show, and down to a phone's,
  // where four of them do not fit and the row must still not push the page.
  const cases = [
    { locale: 'en', width: 1280 },
    { locale: 'nl', width: 1280 },
    { locale: 'nl', width: 768 },
    { locale: 'nl', width: 640 },
    { locale: 'nl', width: 360 },
  ] as const;
  // What the wizard's first step reads on opening, answered as an account
  // with nothing saved yet. Removed after, so no other case sees them.
  const wizardReads: Record<string, unknown> = {
    'GET /api/connections': { connections: [] },
    'GET /api/provider-accounts': { google: { domains: ['calendar', 'contact', 'task'], client: 'deployment' } },
    'GET /api/provider-clients': { google: 'deployment' },
  };
  for (const { locale, width } of cases) {
    it(`draws the line between the labels, never through them (${locale}, ${width}px)`, async () => {
      Object.assign(FIXTURES, wizardReads);
      try {
        const l = await open('/mappings/new', { locale });
        await l.page.setViewportSize({ width, height: 800 });
        await l.page.waitForSelector('[data-step-label]');

        const boxes = async (selector: string) =>
          l.page.$$eval(selector, (els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return { text: (el.textContent ?? '').trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            }),
          );
        const labels = await boxes('[data-step-label]');
        const lines = await boxes('[data-step-line]');
        expect(labels).toHaveLength(4);
        expect(lines, 'one line between each two steps').toHaveLength(3);
        // Every step is still named to a screen reader where its label is not
        // shown (wizard.step.*).
        expect(labels.map((b) => b.text)).toEqual(
          locale === 'nl' ? ['Bron', 'Doel', 'Migratie', 'Controleren'] : ['Source', 'Target', 'Migration', 'Review'],
        );

        for (const line of lines) {
          expect(line.right - line.left, 'the line is drawn at all').toBeGreaterThan(0);
          for (const label of labels) {
            const crosses =
              line.left < label.right && line.right > label.left && line.top < label.bottom && line.bottom > label.top;
            expect(crosses, `the line crosses "${label.text}"`).toBe(false);
          }
        }
        const overflow = await l.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'the row pushes the page sideways').toBeLessThanOrEqual(0);
        expectClean(l, `the wizard (${locale}, ${width}px)`);
        await l.page.close();
      } finally {
        for (const key of Object.keys(wizardReads)) delete FIXTURES[key];
      }
    });
  }
});

describe('the build stamp', () => {
  it('shows the version the server reports, in a real browser', async () => {
    // The one thing the unit tests structurally cannot check: that the element
    // is mounted, the fetch resolves against a server, and the result reaches
    // the DOM. describeBuild() is pure and covered; this is the wiring.
    const l = await open('/mappings');
    const version = (
      JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version: string }
    ).version;

    // Rendered by an effect after the fetch settles, so wait for the text
    // rather than reading whatever the first paint happened to contain.
    await l.page.waitForFunction(
      (v: string) => document.body.innerText.includes(`v${v}`),
      version,
      { timeout: 10_000 },
    );

    expect(await l.text()).toContain(`v${version}`);
    // The bundle and the fixture agree here, so it must say it ONCE — the
    // `UI … · API …` form is reserved for a genuine mismatch, and showing it
    // always would train the reader to stop looking at it.
    expect(await l.text(), 'the stamp claimed a mismatch where there is none').not.toContain('UI v');
    expectClean(l, 'the build stamp');
    await l.page.close();
  });
});

describe('Report a problem (workplan 0130)', () => {
  it('opens the form from the link beside Sign out, carrying the page it came from', async () => {
    const l = await open('/mappings');
    await l.page.getByRole('link', { name: 'Report a problem' }).click(); // nav.reportProblem
    await l.page.waitForURL((u) => u.pathname === '/report', { timeout: 10_000 });

    expect(new URL(l.page.url()).searchParams.get('from')).toBe('/mappings');
    // Said before anything is sent: where it goes, and, in the fold, every
    // line that goes with it, the page first.
    await l.page
      .locator('text=Goes to the Ownpace support team, by email to support@example.invalid.') // report.goesTo.mail
      .waitFor({ timeout: 10_000 });
    await l.page.locator('summary', { hasText: 'What we send with this' }).click(); // report.facts
    await l.page.locator('li', { hasText: 'Page: /mappings' }).waitFor({ state: 'visible', timeout: 10_000 });
    expectClean(l, 'the report form');
    await l.page.close();
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
    // The document says which language it is in, or a screen reader reads the
    // Dutch with an English voice (WCAG 3.1.1). Asked before the page closes.
    expect(await nl.page.getAttribute('html', 'lang')).toBe('nl');
    await nl.page.close();

    expect(nlText).toContain('Aanmelden bij Ownpace'); // login.title, nl
    expect(nlText).not.toBe(enText);
  });
});

describe("a sign-in's example (the owner, 2026-09-29)", () => {
  // The owner: stick with "Username" / "Gebruikersnaam" and fill in "a grey
  // example hint of the formatting/syntax that goes away when clicked, like
  // 'someone@example.com'". Whether a placeholder shows is the browser's to
  // decide, so it is asked of one: its colour before and after focus.
  it('shows someone@example.com in grey, and takes it away when the box is clicked', async () => {
    const wizardReads: Record<string, unknown> = {
      'GET /api/connections': { connections: [] },
      'GET /api/provider-accounts': { google: { domains: ['calendar', 'contact', 'task'], client: 'deployment' } },
      'GET /api/provider-clients': { google: 'deployment' },
    };
    Object.assign(FIXTURES, wizardReads);
    try {
      const l = await open('/mappings/new');
      await l.page.getByRole('button', { name: /^Google account/ }).click();
      const box = l.page.getByRole('textbox', { name: /^Username/ });
      expect(await box.getAttribute('placeholder')).toBe('someone@example.com');

      const exampleColour = () => box.evaluate((el) => getComputedStyle(el, '::placeholder').color);
      const before = await exampleColour();
      expect(before, 'the example is drawn before the box is clicked').not.toBe('rgba(0, 0, 0, 0)');
      await box.click();
      expect(await exampleColour(), 'the example goes once the box is clicked').toBe('rgba(0, 0, 0, 0)');
      await box.blur();
      expect(await exampleColour(), 'and comes back when it is left empty').toBe(before);
      expectClean(l, "the wizard's Google sign-in");
      await l.page.close();
    } finally {
      for (const key of Object.keys(wizardReads)) delete FIXTURES[key];
    }
  });
});

/**
 * THE PERSON THE GATE HAD NEVER SIGNED IN AS.
 *
 * A platform operator belongs to no organisation by design (0093 T6/T7). Every
 * fixture in this file says `operator: false` with one membership, so the suite
 * has only ever walked an ordinary owner's product — and the operator's shipped
 * with six nav entries that each answered
 *
 *     403 { message: 'No active membership for this tenant' }
 *
 * which `api.ts` reads as a dead session and signs them out. Reported from the
 * OTA instance on 2026-08-31: "I see the full menu, and if I click on any menu
 * items, I switch back to login." Unit tests cover both halves now; this is the
 * one that walks it in a real browser, which is where the report came from.
 */
describe('signed in as a platform operator', () => {
  const ME = FIXTURES['GET /api/me'];

  /** Swap the whole deployment's answer for an operator's, and give it back. */
  function asOperator(): () => void {
    FIXTURES['GET /api/me'] = {
      userId: 'op-smoke',
      email: 'operator@demo.openmigrate.test',
      role: 'member',
      // The two facts that make this person an operator and not a customer.
      tenants: [],
      operator: true,
      invitations: [],
    };
    // Every screen they CAN open needs an answer, or `apiMisses` catches it in
    // the sweep below and the failure reads as a missing fixture rather than as
    // what it is.
    FIXTURES['GET /api/access-requests'] = { requests: [] };
    FIXTURES['GET /api/support/tenants'] = { tenants: [] };
    return () => {
      FIXTURES['GET /api/me'] = ME;
    };
  }

  /** The nav's links, by their visible text. */
  async function navLinks(l: Loaded): Promise<string[]> {
    return l.page.$$eval('nav a', (as) => as.map((a) => (a.textContent ?? '').trim()));
  }

  it('is offered only the screens it can open', async () => {
    const restore = asOperator();
    try {
      const l = await open('/access-requests');
      const links = await navLinks(l);

      // Theirs: the queue they came for, the support surface, and the guides —
      // which call no API at all.
      for (const kept of ['Access requests', 'Support', 'Setup guides']) {
        expect(links, `the nav no longer offers ${kept}`).toContain(kept);
      }
      // And not one of the six that would refuse them. Exact strings: "Setup
      // checklist" and "Setup guides" differ by one word, and a substring
      // match cannot tell them apart. The member's words since 0153 T3 (c).
      for (const hidden of [
        'Migrations',
        'Needs you',
        'Accounts',
        'Help',
        'Setup checklist',
        'Team',
      ]) {
        expect(
          links,
          `the nav offers ${hidden} to somebody with no organisation. Its first\n` +
            'request answers 403 "No active membership for this tenant", which\n' +
            'api.ts reads as a dead session — so the entry is not merely a dead\n' +
            'end, it signs the operator out.',
        ).not.toContain(hidden);
      }
      expectClean(l, 'the access queue as an operator');
      await l.page.close();
    } finally {
      restore();
    }
  });

  it('keeps its session when a typed URL reaches a screen that is not its own', async () => {
    // The nav no longer offers those screens, so reaching one now takes a typed
    // URL — and the session must survive it. This is the half that cannot be
    // proved from the nav: the refusal has to actually happen, and the browser
    // has to still be signed in afterwards.
    const restore = asOperator();
    failures.set('GET /api/migrations', {
      status: 403,
      body: { error: 'Forbidden', message: 'No active membership for this tenant' },
    });
    try {
      const l = await open('/mappings');
      // Give the interceptor every chance to redirect before asserting it did
      // not: `onUnauthorized` sets `location.href` synchronously on the
      // response, so if it fires at all it fires within this settle.
      await l.page.waitForTimeout(1000);
      expect(
        new URL(l.page.url()).pathname,
        'a platform operator was signed out by opening a tenant-scoped screen.\n\n' +
          'They belong to no organisation BY DESIGN, so that 403 is what every\n' +
          'such route answers them — it means "that screen is not yours", never\n' +
          '"your session died".',
      ).not.toContain('/login');
      await l.page.close();
    } finally {
      failures.delete('GET /api/migrations');
      restore();
    }
  });
});

/**
 * THE TEXTS, BROUGHT UP BY A DOOR'S REFUSAL (workplan 0139 T3), in a real
 * browser.
 *
 * While the deployment asks (`OWNPACE_STAGE=alpha` on the API, and no text
 * still a draft), every door that stores somebody's access answers 409
 * `conditions_not_accepted` until they accept the texts. The bundle under test
 * is built as CI and the OTA stack build it, without `VITE_OWNPACE_STAGE`, so
 * it asks nothing on load and waits for nothing (review of 2026-09-29): its
 * pages render as before. What it does do is follow the API: the app's own
 * client reports the refusal, and the acceptance screen comes up at once. The
 * bundle built for the Alpha also asks on load; the web guard holds that
 * (`an-acceptance-before-the-first-connection.unit.test.tsx`).
 *
 * The migrations list's own read stands in for a door here, answering the
 * refusal: the client keys on the answer, not the method, and it is the one
 * request every page of this suite already makes. Once the texts are
 * accepted the screen gives way to the page it was in front of.
 */
describe('signed in by somebody who has not accepted the texts yet', () => {
  const ME = FIXTURES['GET /api/me'];
  const VERSIONS = { alpha: '1.0', privacy: '1.2', terms: '1.3' } as const;
  const documents = (accepted: boolean) =>
    (['alpha', 'privacy', 'terms'] as const).map((document) => ({
      document,
      version: VERSIONS[document],
      accepted,
    }));
  const REFUSAL = 'Nothing was stored: accept the Alpha conditions, the privacy policy and the terms first.';

  it('meets the texts at a refusal, linked in their language, and the page after accepting', async () => {
    FIXTURES['GET /api/me'] = { ...(ME as object), acceptance: { due: true, documents: documents(false) } };
    FIXTURES['POST /api/me/acceptance'] = { written: 3, acceptance: { due: false, documents: documents(true) } };
    failures.set('GET /api/migrations', {
      status: 409,
      body: {
        error: 'conditions_not_accepted',
        message: REFUSAL,
        messageNl: REFUSAL,
        reason: REFUSAL,
        reasonNl: REFUSAL,
        documents: documents(false).map(({ document, version }) => ({ document, version })),
      },
    });
    try {
      const l = await open('/mappings');
      await l.page.getByRole('heading', { level: 1, name: 'Before you start' }).waitFor({ timeout: 15_000 });

      const links = await l.page.$$eval('ul[aria-label="The texts to accept"] a', (as) =>
        as.map((a) => (a as HTMLAnchorElement).href),
      );
      expect(links).toEqual([
        'https://www.ownpace.eu/alpha.html',
        'https://www.ownpace.eu/privacy.html',
        'https://www.ownpace.eu/terms.html',
      ]);
      expect(await l.page.getByRole('main').count(), 'the screen is not the page\'s main landmark').toBe(1);
      expect(await l.page.getByRole('link', { name: 'Migrations' }).count(), 'the page shows beside the screen').toBe(
        0,
      );

      failures.delete('GET /api/migrations');
      await l.page.getByRole('button', { name: 'Accept all three' }).click();
      await l.page.getByRole('heading', { level: 1, name: 'Before you start' }).waitFor({
        state: 'detached',
        timeout: 15_000,
      });
      await l.page.getByRole('link', { name: 'Migrations' }).first().waitFor({ timeout: 15_000 });
      // The refusals themselves are the one thing the browser may log.
      expect(
        l.errors.filter((e) => !/status of 409/.test(e)),
        'the acceptance screen raised errors in the browser',
      ).toEqual([]);
      await l.page.close();
    } finally {
      failures.delete('GET /api/migrations');
      FIXTURES['GET /api/me'] = ME;
      delete FIXTURES['POST /api/me/acceptance'];
    }
  });
});
