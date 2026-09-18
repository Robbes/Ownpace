// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// Does the operating UI actually BOOT? (ADR-0026)
//
// Until this file, nothing anywhere loaded the UI. The server side of `/ui` is
// well tested — traversal, MIME, caching, SPA fallback, 17 unit tests — but all
// of that is about delivering bytes. A bundle that throws on evaluation, a
// hash-renamed asset the HTML still references, a router that cannot cope with
// being mounted under `/ui`, an edition flag baked wrong at build time: every
// one of those serves `200 text/html` with the right byte count, which is
// exactly what the existing assertions check. The screen the Start-menu
// shortcut opens (ADR-0027) had never been opened by anything.
//
// So: a real Chromium, pointed at the real appliance the e2e stack already
// brought up, loading the same bundle a user gets. This is a BOOT smoke, not a
// visual test — it asserts the app evaluates, renders, talks to the appliance,
// and honours two ADR-0026 behaviours that are invisible to HTTP-level tests
// (the prose contract, and Verify's you-must-click rule). Screenshots, pixel
// diffs and interaction flows are deliberately out of scope.
//
// ## Read-only, and placed BEFORE the sync gates
//
// Nothing here clicks anything that mutates: the failure mode this guards
// against is "the page is broken", and finding that out must not disturb the
// restart-resume/verification/apply gates that run after it. Running first also
// means a broken bundle fails the job in under a minute instead of after ten
// minutes of sync gates that were never going to matter.
//
// ## Tooling: playwright-core inside vitest, not @playwright/test
//
// One test runner in this repo, and it is vitest — every gate is a
// `*.e2e.test.ts` the workflow names in a `pnpm test:e2e` call. `@playwright/test`
// would add a second runner, a config file, and a postinstall that downloads
// browsers on every `pnpm install`. `playwright-core` is the same automation
// library with no runner and no postinstall; the workflow installs Chromium
// explicitly, once, where it is needed (cached on the self-hosted runner).
//
// Root-level e2e files import only vitest, node builtins and root
// devDependencies (see vitest.config.ts — workspace aliases do not resolve
// here), which is also why the prose assertions below compare against the
// appliance's own JSON rather than importing `@openmig/shared`: the JSON is the
// contract on the wire, and self-synchronising against it means a prose edit
// cannot strand this test.
//
// ## A PAGE READ BEFORE IT ANSWERED (E2E self-hosted #215 and #216, red)
//
// Two consecutive scheduled runs failed here, each on a DIFFERENT queue screen
// — #215 on `/ui/deletions`, #216 on `/ui/failures` — and both with the same
// received text: the nav, the title, and `Loading…`. No console error, no
// failed asset, no non-2xx: `expectClean` passed on both. The screen had simply
// not been answered yet when its text was read.
//
// The cause is the wait, and it was always wrong: `waitUntil: 'networkidle'`
// resolves after 500ms with no connections in flight, and a queue screen issues
// its fetch from a React effect — AFTER the bundle is parsed, evaluated and
// first-rendered. On a slow runner that gap exceeds 500ms, so `networkidle`
// fires in the silence BEFORE the request, not after it. Nothing was broken;
// the test was reading a page mid-load and calling it a contract violation.
//
// Reproduced with no appliance at all: a static page that issues its fetch from
// a timer after the document settles, opened through the same
// `waitUntil: 'networkidle'`. At a 900ms mount gap the one-shot read returns
// `Loading…` and a waited read returns the prose; at 100ms both pass. The test
// was green for two hundred runs because the runner was fast enough, and went
// red on two slow ones.
//
// So every assertion about what a screen SHOWS now waits for it. The properties
// are unchanged — the app must mount, the screen must render the wire prose —
// and the failure messages are the same sentences with the same received text,
// so a real regression reads exactly as it did. What is gone is the race. (The
// queue-screen wait itself landed separately, in #1000, while this was being
// written; what it left behind is corrected here — `expectClean` ran before the
// wait, which is the same mistake one level down.)
//
// The same race ran the other way on the Verify screen, which is worse:
// "loading the page fired no GET /verify" passes for free on a page that has
// not finished loading — green for the wrong reason, on the one test standing
// between opening a screen and minutes of target I/O. That one now waits for
// the screen's own read to appear before concluding anything about what it did
// not ask for.
//
// And the path it was watching had died under it: 0019 T6 removed the
// synchronous `GET /verify` from the appliance, so the absence being asserted
// was of a route the server no longer serves — a guard with nothing left to
// catch. It names `/verify/start` now, which is what starts a scan today.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';

const PORT = process.env.SELFHOST_PORT || '8081';
const BIND = process.env.SELFHOST_BIND || '127.0.0.1';
const BASE = `http://${BIND}:${PORT}`;

/**
 * Where Chromium lives. The workflow installs it via playwright-core's own CLI
 * (`node node_modules/playwright-core/cli.js install chromium`), after which
 * `chromium.launch()` resolves it with no path at all. `E2E_CHROMIUM` exists
 * for environments that already have one somewhere specific — the dev sandbox
 * this was written in ships it at /opt/pw-browsers/chromium, for example.
 */
const EXPLICIT_CHROMIUM = process.env.E2E_CHROMIUM;

let browser: Browser;

/** Everything the page did wrong, collected per navigation. */
interface PageReport {
  readonly page: Page;
  readonly errors: string[];
  readonly failedAssets: string[];
  readonly requests: string[];
  text(): Promise<string>;
}

/**
 * Load a UI route and record what a user cannot see but a test must: uncaught
 * exceptions, console errors, and assets that failed to arrive.
 */
async function open(path: string): Promise<PageReport> {
  const page = await browser.newPage();
  const errors: string[] = [];
  const failedAssets: string[] = [];
  const requests: string[] = [];

  // An uncaught exception in the bundle is THE failure this file exists for.
  // It leaves a blank page and a 200 in the access log.
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('requestfailed', (req) => failedAssets.push(`${req.url()} (${req.failure()?.errorText})`));
  page.on('response', (res) => {
    if (res.status() >= 400) failedAssets.push(`${res.url()} -> ${res.status()}`);
  });
  page.on('request', (req) => requests.push(new URL(req.url()).pathname));

  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30_000 });
  expect(res?.status(), `${path} did not load`).toBe(200);

  return {
    page,
    errors,
    failedAssets,
    requests,
    text: async () => (await page.textContent('body')) ?? '',
  };
}

function expectClean(r: PageReport, path: string): void {
  expect(r.errors, `${path} raised errors in the browser`).toEqual([]);
  expect(r.failedAssets, `${path} failed to load assets`).toEqual([]);
}

beforeAll(async () => {
  browser = await chromium.launch({
    ...(EXPLICIT_CHROMIUM && existsSync(EXPLICIT_CHROMIUM)
      ? { executablePath: EXPLICIT_CHROMIUM }
      : {}),
    // The self-hosted runner has no display; the dev sandbox has no sandboxing.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

describe('the operating UI boots in a real browser', () => {
  it('GET / lands a browser on a working confirm screen, not a blank page', async () => {
    // The exact path a user takes: the root redirect, then the React app
    // evaluating, mounting, and rendering something. `#root` having children is
    // what separates "bundle served" from "bundle ran" — a throwing bundle
    // leaves it empty with a 200 in the log.
    const r = await open('/');
    expect(r.page.url()).toContain('/ui/confirm');
    await expect
      .poll(() => r.page.locator('#root > *').count(), { timeout: 30_000, interval: 250 })
      .toBeGreaterThan(0);
    expectClean(r, '/');
    await r.page.close();
  }, 60_000);

  it('the queue screens render the SAME prose the JSON carries (ADR-0026)', async () => {
    // The contract says the UI renders the wire prose rather than paraphrasing
    // it — the guidance strings ARE the operating semantics. Compare against
    // what this very appliance serves, so the assertion survives prose edits.
    for (const [screen, jsonPath] of [
      ['/ui/deletions', '/deletions'],
      ['/ui/moves', '/moves'],
      ['/ui/failures', '/failures'],
    ] as const) {
      const queues = (await (await fetch(`${BASE}${jsonPath}`)).json()) as Record<
        string,
        { whatThisMeans?: string; howToResolve?: Record<string, string> }
      >;
      const first = Object.values(queues)[0];
      const prose = first?.whatThisMeans ?? Object.values(first?.howToResolve ?? {})[0];
      expect(prose, `${jsonPath} served no guidance prose to compare against`).toBeTruthy();
      // The first sentence is enough to prove it is the same text and not a
      // summary; whole-string equality would fail on markup-driven whitespace.
      const sentence = prose!.split(/[.!]/)[0]!.trim();

      const r = await open(screen);
      // Waited for, not read once: see the header. The screen shows `Loading…`
      // until its own fetch resolves, and `networkidle` can fire before that
      // fetch has even been ISSUED — the silence is ahead of the first request,
      // not between a failed one and its retry: a request that failed would
      // have been recorded in `failedAssets`, and `expectClean` passed on both
      // red runs. A string function body, not a closure, so this file (which
      // compiles under Node lib, not DOM — see test/ui/tsconfig.json for why
      // that split exists) never has to name `document` where tsc can see it.
      await r.page
        .waitForFunction(
          `document.body.textContent && document.body.textContent.includes(${JSON.stringify(sentence)})`,
          undefined,
          { timeout: 15_000 },
        )
        .catch(() => {});
      // AFTER the wait, deliberately: the data fetch is part of the load, and a
      // console error or a non-2xx raised BY it is invisible to a check that
      // ran while the screen was still a spinner.
      expectClean(r, screen);
      // Unchanged, and still the one that speaks: a screen that genuinely never
      // renders the wire prose fails here with this sentence and the last text
      // it showed — the error panel's words when the read failed, `Loading…`
      // when the appliance never answered at all.
      expect(await r.text(), `${screen} does not render the wire prose`).toContain(sentence);
      await r.page.close();
    }
  }, 120_000);

  it('deep links survive the SPA fallback in a real browser', async () => {
    // The server-side fallback is unit-tested; this is the half it cannot see —
    // the router actually recovering the route from the URL under /ui.
    const r = await open('/ui/failures');
    expect(r.page.url()).toContain('/ui/failures');
    await expect
      .poll(() => r.page.locator('#root > *').count(), { timeout: 30_000, interval: 250 })
      .toBeGreaterThan(0);
    expectClean(r, '/ui/failures (direct)');
    await r.page.close();
  }, 60_000);

  it('opening the Verify screen does NOT start a verification', async () => {
    // Verify.tsx's header rule: a verification counts and samples the TARGET
    // for every domain, so navigating to the screen must never start one — it
    // is behind a button. Only a browser can prove this; every HTTP-level test
    // sees the endpoint, not the page's restraint. A regression here would put
    // minutes of target I/O behind opening a page.
    const r = await open('/ui/verify');
    // FIRST wait for the screen to have done its own reading. `/verify/report`
    // is the status read Verify.tsx fires on mount (it starts nothing, and its
    // own unit test pins that), so its arrival is the proof that the page got
    // far enough for "it started nothing" to mean anything. Without this the
    // assertion below passes on a page that has not run yet — the loudest way
    // to be green for the wrong reason, on the one test guarding minutes of
    // target I/O.
    await expect
      .poll(() => r.requests.filter((p) => p === '/verify/report').length, {
        timeout: 30_000,
        interval: 250,
      })
      .toBeGreaterThan(0);
    // `/verify/start` is what STARTS one today. `/verify` is the synchronous
    // GET this test was written against, and 0019 T6 removed it from the
    // appliance — so watching only that path has been guarding a route the
    // server no longer has, which is a guard that cannot fail. Both are named:
    // the live one because it is the live one, the dead one because its return
    // would be the same regression wearing the old name.
    expect(
      r.requests.filter((p) => p === '/verify/start' || p === '/verify'),
      'loading the Verify screen started a verification — the scan must be behind the button',
    ).toEqual([]);
    expectClean(r, '/ui/verify');
    await r.page.close();
  }, 60_000);

  it('the selfhost build shows no managed navigation (the baked edition flag)', async () => {
    // VITE_EDITION is baked at build time by `define`, which is why no unit
    // test can catch a wrongly-built bundle — vi.stubEnv cannot reach a
    // literal. This is the artefact-level check: the appliance's bundle must
    // not offer Tenants or Billing, which are managed-only concepts.
    const r = await open('/ui/confirm');
    const nav = (await r.page.locator('nav').textContent()) ?? '';
    expect(nav).not.toContain('Billing');
    expect(nav).not.toContain('Tenants');
    // And the selfhost nav is actually there — absence alone could mean the
    // nav failed to render at all.
    expect(nav).toContain('Deletions');
    expect(nav).toContain('Failures');
    await r.page.close();
  }, 60_000);
});
