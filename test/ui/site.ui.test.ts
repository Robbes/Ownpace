// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The public site, in a real browser.
 *
 * WHY THIS EXISTS AND WHY IT IS HERE. `site/site.unit.test.ts` checks the
 * generator's OUTPUT as text — prices against ADR-0014, locale parity, nothing
 * unrendered. None of that would have caught the defect this suite's sibling
 * exists for: `managed-ui.ui.test.ts` was written after a UI shipped completely
 * unstyled in BOTH editions, past a packaging test asserting `<!doctype html>`
 * and an e2e smoke asserting the screens boot — both true of a blank page.
 *
 * The public site is the surface where that failure would be worst, because
 * the reader is a stranger who does not know it is supposed to look like
 * anything. So the same discipline: load it in Chromium and check the things a
 * person would notice.
 *
 * NOT COVERED, and named rather than implied: whether the pages read well,
 * whether the Dutch is good Dutch, and whether the design is any good. Those
 * need a person, and the record of a person looking is in workplan 0091 T2.
 *
 * NOTE ON SCOPE: this serves `site/dist` from a throwaway HTTP server rather
 * than through nginx, because the pages use absolute asset paths (`/brand/…`)
 * which `file://` cannot resolve. It therefore proves the HTML and the CSS —
 * NOT `deploy/compose/www-nginx.conf`, whose headers and caching are still
 * unverified by anything.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(REPO, 'site', 'dist');

/** Same convention as `managed-ui.ui.test.ts`: the image's browser, or the one on PATH. */
const EXPLICIT_CHROMIUM = process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

let browser: Browser;
let server: Server;
let base: string;

beforeAll(async () => {
  // Build first: a stale dist would let this suite pass against a site nobody
  // is shipping, which is the same class of lie it exists to prevent.
  // OWNPACE_APP_URL has no default and the build refuses without it, so that
  // a site cannot be produced without saying which app its call to action
  // points at. A test build says so explicitly rather than inheriting whatever
  // the runner happens to have exported.
  execFileSync('node', [join(REPO, 'site', 'build.mjs')], {
    stdio: 'pipe',
    env: { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu' },
  });
  expect(existsSync(join(DIST, 'index.html')), 'site/build.mjs produced no index.html').toBe(true);

  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    const file = join(DIST, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(DIST) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  browser = await chromium.launch({
    ...(existsSync(EXPLICIT_CHROMIUM) ? { executablePath: EXPLICIT_CHROMIUM } : {}),
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

async function open(path: string, width = 1200): Promise<{ page: Page; failed: string[] }> {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const failed: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  return { page, failed };
}

describe('the public site renders', () => {
  it('IS STYLED — the defect that reached production, on the page a stranger sees', async () => {
    const { page } = await open('/');
    // Not "a stylesheet exists" but "the layout actually happened": an
    // unstyled page has no constrained content column and no button padding.
    const measured = await page.evaluate(() => {
      const wrap = document.querySelector('.wrap') as HTMLElement | null;
      const btn = document.querySelector('.btn-primary') as HTMLElement | null;
      const cs = btn ? getComputedStyle(btn) : null;
      return {
        wrapWidth: wrap?.getBoundingClientRect().width ?? 0,
        btnPadding: cs ? parseFloat(cs.paddingLeft) : 0,
        btnRadius: cs ? parseFloat(cs.borderTopLeftRadius) : 0,
      };
    });
    expect(measured.wrapWidth, 'the content column is unconstrained — CSS did not apply').toBeLessThan(1200);
    expect(measured.btnPadding, 'the call to action has no padding — CSS did not apply').toBeGreaterThan(8);
    expect(measured.btnRadius, 'the call to action has square corners — CSS did not apply').toBeGreaterThan(2);
    await page.close();
  }, 60_000);

  it('loads every asset it asks for, on every page', async () => {
    for (const path of ['/', '/pricing.html', '/privacy.html', '/nl/', '/nl/prijzen.html']) {
      const { page, failed } = await open(path);
      const brokenImages = await page.evaluate(() =>
        [...document.images].filter((i) => !i.naturalWidth).map((i) => i.src),
      );
      expect(failed, `${path} requested something that 4xx'd`).toEqual([]);
      expect(brokenImages, `${path} has a broken image`).toEqual([]);
      await page.close();
    }
  }, 90_000);

  it('does not scroll sideways on a phone', async () => {
    for (const path of ['/', '/pricing.html', '/privacy.html']) {
      const { page } = await open(path, 390);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflows, `${path} scrolls horizontally at 390px`).toBe(false);
      await page.close();
    }
  }, 90_000);

  it('lines the tier prices up, which is the one page where it shows', async () => {
    const { page } = await open('/pricing.html');
    const layout = await page.evaluate(() => {
      const tops = [...document.querySelectorAll('.tier .price')]
        .filter((_, i) => i % 2 === 0)
        .map((e) => Math.round(e.getBoundingClientRect().top));
      return { cards: document.querySelectorAll('.tier').length, baselines: new Set(tops).size };
    });
    expect(layout.cards, 'the pricing page lost a tier').toBe(5);
    expect(layout.baselines, 'the tier prices sit at different heights').toBe(1);
    await page.close();
  }, 60_000);

  it('lands one migration on Free and says free, with no top-up; a second one lands on Small (ADR-0014, 2026-09-24)', async () => {
    // The estimator's words come from the page's own script, so only a
    // browser sees them: one person, contacts only, is one migration and a
    // fraction of a GB.
    const { page } = await open('/estimate.html');
    await page.check('input[name="who"][value="individual"]');
    for (const t of ['mail', 'contacts', 'calendar', 'files', 'photos']) {
      if (t === 'contacts') await page.check(`#what-${t}`);
      else await page.uncheck(`#what-${t}`);
    }
    const read = () =>
      page.evaluate(() => {
        const text = (id: string) => document.getElementById(id)!.textContent ?? '';
        const shown = (id: string) => !(document.getElementById(id) as HTMLElement).hidden;
        return {
          name: text('tier-name'),
          monthly: text('tier-monthly'),
          year: text('tier-year'),
          three: shown('tier-three'),
          topUp: text('topup-line'),
        };
      });

    const free = await read();
    expect(free.name).toContain('Free');
    expect(free.monthly).toBe('Free: nothing a month, and no invoice.');
    expect(free.year).toContain('moves you to Small');
    expect(free.three, 'a free tier has no three-month total to show').toBe(false);
    expect(free.topUp, 'a free tier offers no top-up').toBe('');
    expect(JSON.stringify(free)).not.toMatch(/€0(?![\d.,])/);

    await page.check('#what-mail');
    const small = await read();
    expect(small.name).toContain('Small');
    expect(small.monthly).toBe('€5 a month');
    expect(small.year).toContain('€30 for a year');
    expect(small.three).toBe(true);
    expect(small.topUp).not.toBe('');
    await page.close();
  }, 60_000);

  it('fits a phone: one row under 64 pixels, and its menu opens from the keyboard (0152 T2)', async () => {
    const { page } = await open('/', 390);
    // checkVisibility, not a box: a closed <details> keeps its content laid
    // out and skips painting it (content-visibility), so a box proves nothing.
    const shown = (selector: string) =>
      page.evaluate((s) => document.querySelector(s)?.checkVisibility({ visibilityProperty: true }) ?? false, selector);
    const height = await page.evaluate(() => document.querySelector('header.site')!.getBoundingClientRect().height);
    expect(height, 'the header is taller than one row on a phone').toBeLessThan(64);
    expect(await shown('nav.site'), 'the wide header shows on a phone').toBe(false);
    expect(await shown('header.site a.lang'), 'the language switch is hidden on a phone').toBe(true);
    expect(await shown('nav.menu'), 'the menu is open before anybody opens it').toBe(false);

    // From the top of the page, by Tab alone: the skip link, the name, the
    // language switch, then the menu.
    let onMenu = false;
    for (let i = 0; i < 6 && !onMenu; i++) {
      await page.keyboard.press('Tab');
      onMenu = await page.evaluate(() => document.activeElement?.matches('details.menu > summary') ?? false);
    }
    expect(onMenu, 'Tab never reaches the menu').toBe(true);
    await page.keyboard.press('Enter');
    expect(await shown('nav.menu'), 'Enter does not open the menu').toBe(true);
    const links = await page.$$eval('nav.menu a', (as) =>
      as.map((a) => ({ text: a.textContent, href: a.getAttribute('href'), right: a.getBoundingClientRect().right })),
    );
    expect(links.map((l) => l.text)).toEqual(['Home', 'How it works', 'Pricing', 'Sign in']);
    expect(links.at(-1)!.href).toBe('https://app.ota.ownpace.eu/login');
    for (const l of links) expect(l.right, `${l.text} runs off a 390 pixel screen`).toBeLessThanOrEqual(390);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Home');
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflows, 'the open menu scrolls sideways').toBe(false);
    await page.close();

    // On a wide screen the same pages sit in the header, and there is no menu.
    const wide = await open('/', 1200);
    expect(await wide.page.isVisible('nav.site'), 'the header lost its pages on a wide screen').toBe(true);
    expect(await wide.page.isVisible('details.menu > summary'), 'a wide screen shows the phone menu').toBe(false);
    await wide.page.close();
  }, 60_000);

  it('lays the estimate out without overlap at 1280 and 390 pixels, and says its result politely (0152 T7 (c))', async () => {
    for (const width of [1280, 390]) {
      const { page } = await open('/estimate.html', width);
      // Each field's parts stay in its own cell: the item count wraps under
      // the box rather than running into the next field.
      const spills = await page.$$eval('.calc .amount', (cells) =>
        cells.flatMap((cell) => {
          const box = cell.getBoundingClientRect();
          return [...cell.children]
            .filter((part) => {
              const r = part.getBoundingClientRect();
              return r.right > box.right + 1 || r.left < box.left - 1;
            })
            .map((part) => `${cell.id}: "${part.textContent?.trim()}"`);
        }),
      );
      expect(spills, `${width}px: a field's parts run out of its cell`).toEqual([]);
      const overlaps = await page.$$eval('.calc .amount', (cells) => {
        const r = cells.map((c) => c.getBoundingClientRect());
        const out: string[] = [];
        for (let i = 0; i < r.length; i++)
          for (let j = i + 1; j < r.length; j++)
            if (r[i]!.left < r[j]!.right - 1 && r[j]!.left < r[i]!.right - 1 && r[i]!.top < r[j]!.bottom - 1 && r[j]!.top < r[i]!.bottom - 1)
              out.push(`${cells[i]!.id} and ${cells[j]!.id}`);
        return out;
      });
      expect(overlaps, `${width}px: two fields overlap`).toEqual([]);
      // The badge sits above its card's heading, never on it.
      const covered = await page.$$eval('.axis[data-decides]', (axes) =>
        axes
          .filter((axis) => {
            const badge = axis.querySelector('.decides')!.getBoundingClientRect();
            const heading = axis.querySelector('.decides + div')!.getBoundingClientRect();
            return badge.bottom > heading.top + 1 && badge.right > heading.left && badge.left < heading.right;
          })
          .map((axis) => axis.id),
      );
      expect(await page.$$eval('.axis[data-decides]', (a) => a.length), 'no card says it decides').toBeGreaterThan(0);
      expect(covered, `${width}px: the badge covers its heading`).toEqual([]);
      await page.close();
    }
    // One polite region holds the result, so a screen reader hears the new tier.
    const { page } = await open('/estimate.html');
    const region = await page.$eval('#result', (e) => ({
      live: e.getAttribute('aria-live'),
      holds: ['paths-line', 'axis-paths', 'axis-data', 'tier-card'].every((id) => !!e.querySelector(`#${id}`)),
    }));
    expect(region).toEqual({ live: 'polite', holds: true });
    await page.close();
  }, 90_000);

  it('reaches the other language, and comes back', async () => {
    const { page } = await open('/');
    await page.click('header.site a.lang');
    await page.waitForLoadState('networkidle');
    expect(await page.getAttribute('html', 'lang')).toBe('nl');
    await page.click('header.site a.lang');
    await page.waitForLoadState('networkidle');
    expect(await page.getAttribute('html', 'lang')).toBe('en');
    await page.close();
  }, 60_000);

  it('refuses indexing unless the build was told it is public', async () => {
    // The default build is for a test host carrying unfilled placeholders.
    // Fail-safe: a build that does not say it is public must not be indexable.
    const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
    expect(robots, 'a non-public build must disallow crawling').toContain('Disallow: /');
    const { page } = await open('/');
    const meta = await page.getAttribute('meta[name="robots"]', 'content');
    expect(meta, 'a non-public build must carry a noindex meta tag').toContain('noindex');
    await page.close();
  }, 60_000);
});
