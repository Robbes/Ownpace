#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// shoot-the-app-screen.mjs — the pictures of the app the site's home page
// shows (workplan 0152 T3), and the words in them.
//
//   node scripts/shoot-the-app-screen.mjs
//
// WHEN TO RUN IT: when the UI smoke says the screen's words changed
// (`test/ui/managed-ui.ui.test.ts`, *the home page's app screen*), or when the
// person's page looks different and the site should show it so. The owner,
// 2026-10-05: the screen *"will have to move along with changes in text in the
// future"*. The smoke is what makes it: it opens the same page and fails while
// the words it reads are not the words this script recorded.
//
// WHAT IT DOES:
//   1. builds the web app as it ships: `VITE_API_URL` removed, as the smoke
//      builds it, and no stage, so no Alpha note is in the picture;
//   2. serves it with the answers in `test/ui/app-screen.ts`, at that file's
//      fixed moment, and signs in through the sign-in screen;
//   3. opens the person's page in English and in Dutch, 1280 pixels wide and
//      390, and photographs its head and the card of their migrations
//      (`data-app-screen` in `Person.tsx`) at twice the pixels, as WebP;
//   4. writes `site/app-screen/{person,person-phone}.{en,nl}.webp` and
//      `site/app-screen/screen.json`: each picture's size in CSS pixels, which
//      the site's `<img>` carries, and the words, which the smoke compares.
//
// It refuses to write anything when the page asked for an answer the fixture
// does not have: a picture of a failed read would ship a broken app.

// The functions handed to the page (`addInitScript`, `evaluate`) run in the
// browser, where these are.
/* global window, document, Image */

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import {
  APP_SCREEN_NOW,
  APP_SCREEN_PARTS,
  APP_SCREEN_PERSON,
  APP_SCREEN_READY,
  appScreenAnswers,
  appScreenText,
} from '../test/ui/app-screen.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(REPO, 'apps/web/dist');
const OUT = join(REPO, 'site/app-screen');
const CHROMIUM = process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium';

/** The two widths: the page as a desk sees it, and as a phone does. */
const VARIANTS = [
  { name: 'person', width: 1280, height: 900 },
  { name: 'person-phone', width: 390, height: 844 },
];
const LOCALES = ['en', 'nl'];
/** Paper around the parts, in CSS pixels. */
const MARGIN = 16;

// 1. The app as it ships.
const env = { ...process.env };
delete env.VITE_API_URL;
delete env.VITE_OWNPACE_STAGE;
console.log('building the web app…');
execFileSync('pnpm', ['--filter', '@openmig/web', 'build'], { cwd: REPO, env, stdio: 'inherit' });

// 2. Served with the screen's answers, and the layout's.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TENANT = 'a0000000-0000-4000-8000-000000000001';
// Not a credential: nothing here checks a signature. Valid an hour past the
// fixed moment, the clock the page reads.
const TOKEN = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    sub: 'app-screen',
    email: 'owner@example.org',
    tenantId: TENANT,
    role: 'owner',
    exp: Math.floor(APP_SCREEN_NOW.getTime() / 1000) + 3600,
  }),
  'app-screen-not-a-signature',
].join('.');
const LAYOUT = {
  'GET /api/version': { version: JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version, commit: '' },
  'GET /api/platform-pause': { held: false },
  'GET /api/problem-reports/available': { available: false },
  'GET /api/auth/mode': { mode: 'local', acceptsSeedToken: true },
  'GET /api/me': {
    userId: 'app-screen',
    email: 'owner@example.org',
    tenantId: TENANT,
    role: 'owner',
    tenants: [{ tenantId: TENANT, role: 'owner' }],
    operator: false,
    invitations: [],
  },
};
/** The answers for the language being photographed: its names are in it. */
let answers = {};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const misses = new Set();
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api')) {
    const key = `${req.method} ${url.pathname}`;
    const known = { ...LAYOUT, ...answers };
    if (!(key in known)) {
      misses.add(key);
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(known[key]));
    return;
  }
  const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, rel);
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

// 3. Each language at each width.
const browser = await chromium.launch({
  ...(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const pictures = {};
const words = {};
try {
  for (const locale of LOCALES) {
    answers = appScreenAnswers(locale);
    for (const variant of VARIANTS) {
      const context = await browser.newContext({
        viewport: { width: variant.width, height: variant.height },
        deviceScaleFactor: 2,
        locale: locale === 'nl' ? 'nl-NL' : 'en-GB',
        timezoneId: 'UTC',
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(APP_SCREEN_NOW);
      await page.addInitScript((l) => window.localStorage.setItem('openmig.locale', l), locale);
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      await page.fill('#token', TOKEN);
      await page.click('form button[type=submit]');
      await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15_000 });
      await page.goto(`${BASE}/people/${APP_SCREEN_PERSON}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(APP_SCREEN_READY, { timeout: 15_000 });
      await page.waitForTimeout(300);
      if (misses.size > 0) throw new Error(`the page asked for answers the fixture does not have: ${[...misses].join(', ')}`);

      const clip = await page.evaluate(
        ({ selector, margin }) => {
          const parts = [...document.querySelectorAll(selector)];
          const boxes = parts.map((el) => el.getBoundingClientRect());
          const main = document.querySelector('main').getBoundingClientRect();
          // Paper above the head, but none of what sits above it (the way
          // back to Migrations): the picture is the person, not the page.
          const above = parts[0].previousElementSibling?.getBoundingClientRect().bottom ?? -Infinity;
          const top = Math.max(Math.min(...boxes.map((b) => b.top)) - margin, above + 2) + window.scrollY;
          const bottom = Math.max(...boxes.map((b) => b.bottom)) + margin + window.scrollY;
          const left = Math.max(main.left, Math.min(...boxes.map((b) => b.left)) - margin);
          const right = Math.min(main.right, Math.max(...boxes.map((b) => b.right)) + margin);
          return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
        },
        { selector: APP_SCREEN_PARTS, margin: MARGIN },
      );
      const png = await page.screenshot({ clip, fullPage: true, type: 'png' });
      // WebP by the browser's own encoder: no dependency for one conversion.
      const webp = await page.evaluate(async (dataUrl) => {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        return canvas.toDataURL('image/webp', 0.9);
      }, `data:image/png;base64,${png.toString('base64')}`);
      const file = `${variant.name}.${locale}.webp`;
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, file), Buffer.from(webp.slice(webp.indexOf(',') + 1), 'base64'));
      pictures[file] = { width: clip.width, height: clip.height };

      const text = await appScreenText(page);
      if (words[locale] !== undefined && words[locale] !== text) {
        throw new Error(`the ${locale} words differ between the widths:\n${words[locale]}\n${text}`);
      }
      words[locale] = text;
      console.log(`${file}: ${clip.width}×${clip.height} CSS pixels`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

// 4. What the site and the smoke read.
const screen = { moment: APP_SCREEN_NOW.toISOString(), pictures, words };
writeFileSync(join(OUT, 'screen.json'), `${JSON.stringify(screen, null, 2)}\n`);
console.log(`wrote ${Object.keys(pictures).length} pictures and site/app-screen/screen.json`);
