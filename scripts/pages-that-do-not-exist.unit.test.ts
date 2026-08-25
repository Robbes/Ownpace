// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * PAGES THAT DO NOT EXIST, AND THE PAGE THAT SAYS WHETHER ANYTHING IS DOWN.
 *
 * Reported from the live test host on 2026-08-25:
 *
 *   https://app.ota.ownpace.eu/blabla   →  a blank white page, HTTP 200
 *   https://www.ota.ownpace.eu/blabla   →  the landing page, HTTP 404
 *
 * TWO DIFFERENT LIES, and the app's is the worse one.
 *
 * The app's nginx does the SPA fallback — `try_files $uri $uri/ /index.html` —
 * which is correct and unavoidable for a single-page app: the server cannot
 * know which client-side paths exist without a copy of the route table, and two
 * files that must agree is the failure this repo spent a week removing. But
 * `AppRoutes.tsx` had no `path="*"`, so react-router matched nothing and drew
 * nothing. A 200 with an empty body is success as far as every crawler, uptime
 * monitor and browser-history heuristic is concerned.
 *
 * The site's `www-nginx.conf` said `error_page 404 /index.html;`, so a wrong
 * address served the HOME PAGE. The status stayed 404, which makes it worse
 * rather than better: a visitor sees a working site and concludes their link
 * was fine, while a crawler is told the page is missing. Two audiences, two
 * different wrong answers, from one line.
 *
 * AND WHILE FIXING IT, THE STATUS PAGE GOT A LINK. gatus had been running on
 * `STATUS_PORT` since #547 with nothing pointing at it — an operator could
 * reach it only by knowing the port. It is now in the site footer on every
 * page, which is where somebody asking "is it down" already is.
 *
 * The status host is DERIVED from `OWNPACE_APP_URL` (`app.` → `status.`) rather
 * than configured beside it, for the reason `PUBLIC_APP_URL` exists: two
 * settings that both name an environment drift silently, and a test site
 * linking to production's status page answers "is it down" about the wrong
 * machine. The derivation refuses rather than guesses when the host is not an
 * `app.` one.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(REPO_ROOT, 'site');
const OTA = 'https://app.ota.ownpace.eu';

type Page = { file: string; html: string; locale: string };

/**
 * The real build, in a child process, so this asserts on what ships rather than
 * on a re-implementation of it. Memoised because a build is not free and every
 * case below wants the same one — and run inside the test bodies rather than at
 * collection, so a broken build FAILS these tests instead of preventing the
 * file from loading at all (which reads as "no tests" and passes CI).
 */
let cached: Page[] | null = null;
function pages(appUrl = OTA): Page[] {
  if (cached) return cached;
  const env = { ...process.env, OWNPACE_APP_URL: appUrl };
  const out = execFileSync(
    'node',
    [
      '-e',
      `import('${join(SITE, 'build.mjs').replace(/\\/g, '/')}')
         .then((m) => process.stdout.write(JSON.stringify(
           m.rendered.map((p) => ({ file: p.file, html: p.html, locale: p.locale })))))
         .catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });`,
    ],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] as const },
  );
  cached = JSON.parse(out) as Page[];
  return cached;
}

describe('the site answers a wrong address with a page about it', () => {
  it('builds a 404 for every locale', () => {
    const files = pages().map((p) => p.file);
    expect(files).toContain('404.html');
    expect(files).toContain('nl/404.html');
  });

  it('says what happened, and says nothing of yours was lost', () => {
    // The reassurance is the point, not decoration. This is a product that
    // moves somebody's mail; the first thought on an unexpected page is "has
    // something of mine gone missing?"
    const en = pages().find((p) => p.file === '404.html')!;
    const nl = pages().find((p) => p.file === 'nl/404.html')!;
    expect(en.html).toMatch(/nothing of yours was lost/i);
    expect(nl.html).toMatch(/niets van u verloren/i);
    // And a way out, not a dead end.
    expect(en.html).toMatch(/href="\/"/);
    expect(nl.html).toMatch(/href="\/nl"/);
  });

  it('keeps the 404 out of the navigation', () => {
    // It has no place in the nav: it is not a destination, it is what an
    // address that is not a destination gets.
    for (const p of pages()) {
      expect(p.html, `${p.file} links to a 404 page from its nav`).not.toMatch(
        /<nav class="site">[^]*?href="[^"]*404\.html"/,
      );
    }
  });
});

describe('nginx serves that page, rather than the home page', () => {
  const raw = readFileSync(join(REPO_ROOT, 'deploy/compose/www-nginx.conf'), 'utf8');

  /**
   * Directives only. The comment above `error_page` QUOTES the old broken line
   * as the record of what went wrong, and the first version of this rule
   * flagged it — the same self-inflicted false positive that has now caught
   * five other guards in this repo. A rule must not forbid the explanation of
   * the thing it forbids.
   */
  const conf = raw
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  it('points 404 at the 404 page', () => {
    expect(
      conf,
      'www-nginx.conf sends a wrong address to /index.html again. That serves the\n' +
        'LANDING PAGE with a 404 status: the visitor concludes their link was fine\n' +
        'and the crawler is told the page is missing.',
    ).not.toMatch(/error_page\s+404\s+\/index\.html/);
    expect(conf).toMatch(/error_page\s+404\s+\/404\.html/);
  });

  it('answers the Dutch tree in Dutch', () => {
    // Switching language at the exact moment somebody mistypes a path is the
    // least helpful moment to do it.
    expect(conf).toMatch(/location \/nl\/ \{[^}]*error_page\s+404\s+\/nl\/404\.html/s);
  });

  it('does not turn the 404 into a 200', () => {
    // `error_page 404 =200 /404.html` would render the page and lie about it.
    expect(conf).not.toMatch(/error_page\s+404\s*=\s*200/);
  });
});

describe('the app answers a wrong address too', () => {
  const routes = readFileSync(join(REPO_ROOT, 'apps/web/src/AppRoutes.tsx'), 'utf8');

  it('has a catch-all route, because nginx has already answered 200', () => {
    expect(
      /<Route\s+path="\*"/.test(routes),
      'AppRoutes.tsx has no path="*" route. nginx serves index.html with HTTP 200\n' +
        'for any path (the SPA fallback, which is correct), so without this the\n' +
        'router matches nothing and renders NOTHING — a blank white page that every\n' +
        'monitor reads as success. That is what /blabla did until 2026-08-25.',
    ).toBe(true);
  });

  it('keeps it last, or it swallows the routes below it', () => {
    // `path="*"` matches everything. Anything declared after it is unreachable.
    const star = routes.indexOf('path="*"');
    const after = routes.slice(star);
    expect(after).not.toMatch(/<Route\s+path="(?!\*)/);
  });

  it('reassures in both languages', () => {
    const strings = readFileSync(join(REPO_ROOT, 'apps/web/src/i18n/strings.ts'), 'utf8');
    for (const key of ['notFound.heading', 'notFound.lede', 'notFound.back']) {
      // Twice: `en` defines the key set and `nl` is typed against it, so a key
      // present once is a typecheck failure — but a rule that counted one would
      // pass on the day somebody deletes the Dutch half and the type error is
      // suppressed.
      const hits = strings.split(`'${key}'`).length - 1;
      expect(hits, `${key} appears ${hits} time(s); expected one per locale`).toBe(2);
    }
    expect(strings).toMatch(/your migrations are untouched/i);
    expect(strings).toMatch(/uw migraties zijn ongemoeid/i);
  });
});

describe('the status page is findable', () => {
  it('is linked from every built page', () => {
    // It had no link at all from #547 until now: reachable only by knowing the
    // port. "Is it down" is asked from wherever the visitor happens to be.
    for (const p of pages()) {
      expect(p.html, `${p.file} does not link the status page`).toMatch(
        /href="https:\/\/status\.[^"]+"/,
      );
    }
  });

  it('links the status page of the SAME environment as the app', () => {
    // A test site linking production's status page answers the question about
    // the wrong machine — the same class as the production links that reached
    // www.ota.ownpace.eu on 2026-08-24.
    for (const p of pages()) {
      expect(p.html).toContain('https://status.ota.ownpace.eu');
      expect(p.html, `${p.file} links production's status page`).not.toContain(
        'https://status.ownpace.eu"',
      );
    }
  });

  it('refuses to guess when the app host is not an `app.` one', () => {
    // Deriving `status.` from a host that is not `app.` is a guess, and a wrong
    // status link is worse than none.
    let message = '';
    try {
      execFileSync(
        'node',
        ['-e', `import('${join(SITE, 'prices.mjs').replace(/\\/g, '/')}').then(() => process.exit(0))`],
        {
          env: { ...process.env, OWNPACE_APP_URL: 'https://ownpace.example.test' },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'] as const,
        },
      );
    } catch (e) {
      message = String((e as { stderr?: string }).stderr ?? '');
    }
    expect(message).toMatch(/does not\s*\n?\s*start with "app\."/);
  });
});
