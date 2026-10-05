// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ALPHA, SAID TO A VISITOR WHO WAS NOT INVITED (workplan 0152 T1 (a), open
 * question 5; the owner, 2026-10-05: *"Do suggestions for non alpha viewers"*).
 *
 * During the Alpha the app greets its people with the owner's welcome,
 * *"Welcome to the Alpha! Try Ownpace at your own pace, and help others move
 * to European alternatives more easily."* It is written for the people
 * invited, and stays theirs: the signed-in pages, `/invitations`, the
 * acceptance screen, `/login`, `/request-access` and the mails. Copied to the
 * public site as 0152 T1 (a) first proposed, every visitor would have read it,
 * invited or not. So a visitor reads a fact instead: *"Ownpace is in its
 * Alpha, by invitation. Nothing is charged during the Alpha."*, then *Request
 * access*. On every page of the site while it is built for the Alpha, and in
 * the app's guides for a visitor without a session.
 *
 * The site imports nothing (`site/build.mjs`'s header), so its words are a
 * copy, `alphaVisitor` in `site/copy.mjs`, of the app's `alpha.visitor.line`
 * and `alpha.nothingCharged` (`apps/web/src/i18n/strings.ts`), and its link
 * is named `ctaOrder`, which is the request page's own title, `access.title`.
 * This holds the copy to the app and the pages to the decision:
 *
 * 1. **The words are the app's,** in both languages, the link's name too.
 * 2. **An Alpha build says it on every page, once, under the header,** first
 *    in `<main>`, in the page's language, and links the request page in that
 *    language, as the site's other *Request access* links do.
 * 3. **A build without the setting says it nowhere,** so it leaves the site
 *    with the Alpha. The setting is the tester guide's, `OWNPACE_STAGE=alpha`.
 * 4. **No page of the site says the welcome,** with the setting or without.
 * 5. **The app's guides draw the line for a visitor, never the welcome:**
 *    `apps/web/src/pages/PublicDocs.tsx` renders `AlphaVisitorLine`, from
 *    `apps/web/src/components/AlphaNote.tsx`, and not the note.
 *
 * The app's half is behaviour, and lives beside its code:
 * `apps/web/src/pages/a-guide-you-can-read-before-you-sign-in.unit.test.tsx`
 * reads the line in the guides, and `an-alpha-said-out-loud.unit.test.tsx`
 * keeps it off the pages that say the welcome. `test/ui/site.ui.test.ts`
 * reads it in a browser, and on a phone.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STRINGS } from '../apps/web/src/i18n/strings.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

// `prices.mjs` refuses to load without being told which app the site is for,
// and `build.mjs` imports it: set before any site module is imported below.
process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';

/** A site module, by address: `site/` is plain JavaScript the root project does not type. */
const site = async <T>(file: string): Promise<T> =>
  (await import(pathToFileURL(join(REPO_ROOT, 'site', file)).href)) as T;

type Locale = 'en' | 'nl';
const LOCALES: readonly Locale[] = ['en', 'nl'];

interface Page {
  readonly locale: Locale;
  readonly key: string;
  readonly file: string;
  readonly html: string;
}
interface Copy {
  readonly ctaOrder: string;
  readonly alphaVisitor: { readonly line: string; readonly nothingCharged: string };
}

const copy = async () => (await site<{ COPY: Record<Locale, Copy> }>('copy.mjs')).COPY;

/** The pages a build renders, for the Alpha or not, asked in this process. */
async function buildFor(alpha: boolean): Promise<Page[]> {
  const { build } = await site<{ build: (o: { alpha: boolean }) => { rendered: Page[] } }>('build.mjs');
  return build({ alpha }).rendered;
}

/** Where the line sits: `<div class="visitor-line">`, which nothing else on the site uses. */
const LINE = /<div class="visitor-line">([\s\S]*?)<\/div>/g;

/** Text as a reader meets it. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('the Alpha, said to a visitor (0152 T1 (a))', () => {
  it("1. the site's words are the app's, in both languages, and the link is named as the request page is", async () => {
    const COPY = await copy();
    for (const locale of LOCALES) {
      const said = COPY[locale].alphaVisitor;
      // The vacuity check: an empty copy and an empty key would compare equal.
      expect(said.line, `${locale}: the line names no Alpha`).toMatch(/\bAlpha\b/);
      expect(said.line, `${locale}: site/copy.mjs and alpha.visitor.line say different things`).toBe(
        STRINGS[locale]['alpha.visitor.line'],
      );
      expect(said.nothingCharged, `${locale}: site/copy.mjs and alpha.nothingCharged say different things`).toBe(
        STRINGS[locale]['alpha.nothingCharged'],
      );
      expect(COPY[locale].ctaOrder, `${locale}: the link is not named as the request page is`).toBe(
        STRINGS[locale]['access.title'],
      );
    }
  });

  it('2. an Alpha build says it once on every page, first in <main>, in the page’s language, with its request link', async () => {
    const [pages, COPY, { REQUEST_ACCESS_URL }] = await Promise.all([
      buildFor(true),
      copy(),
      site<{ REQUEST_ACCESS_URL: string }>('prices.mjs'),
    ]);
    // Every page: both languages, the 404 pages and the tester guide among them.
    expect(pages.map((p) => p.file)).toEqual(
      expect.arrayContaining(['index.html', 'nl/index.html', '404.html', 'nl/404.html', 'alpha-guide.html']),
    );
    for (const page of pages) {
      const found = [...page.html.matchAll(LINE)];
      expect(found, `${page.file} does not say the line once`).toHaveLength(1);
      const at = found[0]!.index;
      // Under the header and before the page's own text: the first thing in <main>.
      expect(page.html.indexOf('<main id="main">') + '<main id="main">'.length, `${page.file}: not first in <main>`).toBe(at);
      expect(page.html.indexOf('</header>'), `${page.file}: the line is not under the header`).toBeLessThan(at);
      const c = COPY[page.locale];
      expect(text(found[0]![1]!), `${page.file}: the words`).toBe(
        `${c.alphaVisitor.line} ${c.alphaVisitor.nothingCharged} ${c.ctaOrder}`,
      );
      const links = [...found[0]![1]!.matchAll(/<a href="([^"]+)">/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
      expect(links, `${page.file}: the line's link is not the request page in its language`).toEqual([
        `${REQUEST_ACCESS_URL}?locale=${page.locale}`,
      ]);
    }
  });

  it('3. a build without the setting says it on no page', async () => {
    const COPY = await copy();
    const pages = await buildFor(false);
    expect(pages.length).toBeGreaterThan(20);
    for (const page of pages) {
      expect(page.html, `${page.file} says the line without the setting`).not.toContain('class="visitor-line"');
      expect(page.html).not.toContain(COPY[page.locale].alphaVisitor.line);
    }
  });

  it('3. the setting is the deployment’s, OWNPACE_STAGE=alpha, read as the tester guide reads it', () => {
    // In a child process, so the environment is the build's, as a deploy runs it.
    const homes = (stage: string | undefined): string[] => {
      const env: NodeJS.ProcessEnv = { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu' };
      delete env.OWNPACE_STAGE;
      if (stage !== undefined) env.OWNPACE_STAGE = stage;
      const build = pathToFileURL(join(REPO_ROOT, 'site/build.mjs')).href;
      const out = execFileSync(
        'node',
        [
          '-e',
          `import(${JSON.stringify(build)})
             .then((b) => process.stdout.write(JSON.stringify(b.rendered.filter((p) => p.key === 'home').map((p) => p.html))))
             .catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });`,
        ],
        { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      return JSON.parse(out) as string[];
    };
    const alpha = homes('alpha');
    expect(alpha.length, 'the home pages and the 404 pages, in both languages').toBe(4);
    for (const html of alpha) expect(html, 'OWNPACE_STAGE=alpha does not say the line').toContain('class="visitor-line"');
    for (const html of homes(undefined)) expect(html, 'no stage says the line').not.toContain('class="visitor-line"');
  });

  it('4. no page of the site says the welcome, with the setting or without: it is the members’', async () => {
    const welcome = LOCALES.flatMap((l) => [STRINGS[l]['alpha.note.lead'], STRINGS[l]['alpha.note.welcome']]);
    for (const alpha of [true, false]) {
      for (const page of await buildFor(alpha)) {
        for (const words of welcome) {
          expect(text(page.html), `${page.file} says the welcome to every visitor`).not.toContain(words);
        }
      }
    }
  });

  it("5. the app's guides draw the line for a visitor, and never the welcome", () => {
    const frame = read('apps/web/src/pages/PublicDocs.tsx');
    expect(frame, 'PublicDocs no longer draws the visitor’s line').toMatch(/<AlphaVisitorLine\b/);
    expect(frame, 'PublicDocs draws the welcome, which is the members’').not.toMatch(/<AlphaNote\b/);
    expect(read('apps/web/src/components/AlphaNote.tsx')).toMatch(/export const AlphaVisitorLine\b/);
  });
});
