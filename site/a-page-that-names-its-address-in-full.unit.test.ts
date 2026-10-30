// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PAGE THAT NAMES ITS ADDRESS IN FULL, AND ITS OTHER LANGUAGE'S (workplan 0152
 * T5 (c); ADR-0029).
 *
 * Until 2026-10-30 a page's hreflang links were relative (`/nl/prijzen.html`)
 * and no page named a canonical address. A search engine resolves a relative
 * link against whichever host served the page, and an assistant handed the
 * page's source has no host to resolve it against. `llms.txt`, which
 * ADR-0029's operative rules say the site ships, did not exist.
 *
 * Held here, for every page the build renders, with the Alpha's pages and
 * without:
 *
 *  - a page with an address names exactly one canonical address, absolute, on
 *    the production site (`PUBLIC_SITE_URL`), and it is the address nginx
 *    serves its file at; the 404 page, served at whatever address was wrong,
 *    names none, and no other language's;
 *  - its hreflang links are absolute, one per language, reciprocal, and cover
 *    every language the page is rendered in; `x-default` is the default
 *    locale's page;
 *  - `llms.txt` lists every page with an address, in its own language's
 *    section, by its own title and description, and no address that is not a
 *    page; the build writes it at the site's root;
 *  - a test build carries the same links and the same `llms.txt` as a
 *    `--public` one, and keeps its `noindex`;
 *  - the site's own address is written once, in `security-txt.mjs`.
 *
 * NOT held: that a search engine or an assistant does anything with them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// The build asks which app its buttons reach; the OTA's, as `site.unit.test.ts` sets it.
process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';

interface Page {
  readonly locale: string;
  readonly key: string;
  readonly file: string;
  readonly html: string;
}

interface Built {
  readonly rendered: Page[];
  readonly llms: string;
}

/** The pages and `llms.txt` of a build for the Alpha, or not, asked in this process. */
async function built(alpha: boolean): Promise<Built> {
  const m = (await import('./build.mjs')) as unknown as { build: (o: { alpha: boolean }) => Built };
  return m.build({ alpha });
}

/** The site's own address, from the one place it is written. */
async function site(): Promise<string> {
  const m = (await import('./security-txt.mjs')) as unknown as { PUBLIC_SITE_URL: string };
  return m.PUBLIC_SITE_URL;
}

/** The locales, the default one, and each one's own name, from `copy.mjs`. */
async function locales(): Promise<{ all: string[]; fallback: string; name: (l: string) => string }> {
  const m = (await import('./copy.mjs')) as unknown as {
    LOCALES: string[];
    DEFAULT_LOCALE: string;
    COPY: Record<string, { langName: string }>;
  };
  return { all: m.LOCALES, fallback: m.DEFAULT_LOCALE, name: (l) => m.COPY[l]!.langName };
}

/** Where nginx serves a file the build wrote: `index index.html` (`deploy/compose/www-nginx.conf`). */
const servedAt = (file: string) => `/${file.replace(/(^|\/)index\.html$/, '$1')}`;

/** The 404 pages, which nginx serves at an address that is not a page. */
const notFound = (p: { file: string }) => /(^|\/)404\.html$/.test(p.file);

/** Text as the build escapes it into HTML (`esc` in `build.mjs`), back to text. */
const text = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Every `<link>` in the document, as its attributes, and whether it sits in <head>. */
function links(html: string): { attrs: Record<string, string>; inHead: boolean }[] {
  const end = html.indexOf('</head>');
  expect(end, 'a page with no </head>').toBeGreaterThan(0);
  return [...html.matchAll(/<link\b[^>]*>/g)].map((m) => ({
    attrs: Object.fromEntries([...m[0].matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!])),
    inHead: m.index < end,
  }));
}

/** Whether an address stands on its own: a URL that parses with no base, and is written as it parses. */
function absolute(href: string | undefined): boolean {
  try {
    return href !== undefined && new URL(href).href === href;
  } catch {
    return false;
  }
}

const canonicals = (html: string) => links(html).filter((l) => l.attrs.rel === 'canonical');
const alternates = (html: string) => links(html).filter((l) => l.attrs.rel === 'alternate' && 'hreflang' in l.attrs);

/** Every page of both builds, by file, the Alpha's first. */
async function everyPage(): Promise<Page[]> {
  const out = new Map<string, Page>();
  for (const alpha of [true, false]) for (const p of (await built(alpha)).rendered) out.set(`${alpha}:${p.file}`, p);
  return [...out.values()];
}

describe('every page with an address names it in full (0152 T5 (c))', () => {
  it('has exactly one canonical link, in <head>, absolute, and it is where its file is served', async () => {
    const origin = await site();
    const pages = (await everyPage()).filter((p) => !notFound(p));
    expect(pages.length, 'the build rendered no page with an address').toBeGreaterThan(20);
    for (const p of pages) {
      const found = canonicals(p.html);
      expect(found.length, `${p.file}: canonical links`).toBe(1);
      const { attrs, inHead } = found[0]!;
      expect(inHead, `${p.file}: the canonical link is outside <head>`).toBe(true);
      expect(absolute(attrs.href), `${p.file}: the canonical address ${attrs.href} is not absolute`).toBe(true);
      expect(attrs.href, `${p.file}: the canonical address`).toBe(`${origin}${servedAt(p.file)}`);
    }
  });

  it('the 404 page names no address and no other language, since it has none', async () => {
    const pages = (await everyPage()).filter(notFound);
    expect(pages.map((p) => p.file).sort()).toEqual(['404.html', '404.html', 'nl/404.html', 'nl/404.html']);
    for (const p of pages) {
      expect(canonicals(p.html), `${p.file}: a canonical link`).toEqual([]);
      expect(alternates(p.html), `${p.file}: hreflang links`).toEqual([]);
    }
  });
});

describe("every page names itself in each language it exists in (0152 T5 (c))", () => {
  for (const alpha of [true, false]) {
    it(`absolute, one per language, reciprocal and complete, in a build ${alpha ? 'for' : 'not for'} the Alpha`, async () => {
      const origin = await site();
      const { all, fallback } = await locales();
      const pages = (await built(alpha)).rendered.filter((p) => !notFound(p));
      /** A page's canonical address, which the case above holds to its file. */
      const own = (p: Page) => `${origin}${servedAt(p.file)}`;
      const byAddress = new Map(pages.map((p) => [own(p), p]));

      for (const p of pages) {
        const found = alternates(p.html);
        for (const { attrs, inHead } of found) {
          expect(inHead, `${p.file}: an hreflang link outside <head>`).toBe(true);
          expect(absolute(attrs.href), `${p.file}: hreflang="${attrs.hreflang}" ${attrs.href} is not absolute`).toBe(true);
        }
        const langs = found.map((l) => l.attrs.hreflang!);
        // One link per language, never a relative one beside an absolute one.
        expect(langs.slice().sort(), `${p.file}: hreflang values`).toEqual([...new Set(langs)].sort());

        // Every language the page is rendered in, and no other.
        const versions = pages.filter((q) => q.key === p.key);
        expect(versions.length, `${p.file}: no other page has its key`).toBeGreaterThan(0);
        expect(
          langs.filter((l) => l !== 'x-default').sort(),
          `${p.file}: the languages it names are not the ones it is rendered in`,
        ).toEqual(versions.map((q) => q.locale).sort());

        for (const { attrs } of found.filter((l) => l.attrs.hreflang !== 'x-default')) {
          const there = byAddress.get(attrs.href!);
          expect(there, `${p.file}: hreflang="${attrs.hreflang}" names ${attrs.href}, which is no page`).toBeDefined();
          expect(there!.key, `${p.file}: hreflang="${attrs.hreflang}" names another page`).toBe(p.key);
          expect(there!.locale, `${p.file}: hreflang="${attrs.hreflang}" names a page in ${there!.locale}`).toBe(
            attrs.hreflang,
          );
          // Reciprocal: the page it names names this one back, in this one's language.
          const back = alternates(there!.html).find((l) => l.attrs.hreflang === p.locale);
          expect(back?.attrs.href, `${there!.file} does not name ${p.file} back`).toBe(own(p));
        }

        // x-default is the default locale's page: the root serves it, and nothing negotiates.
        const xDefault = found.filter((l) => l.attrs.hreflang === 'x-default');
        expect(xDefault.length, `${p.file}: x-default links`).toBe(1);
        const fallbackPage = versions.find((q) => q.locale === fallback);
        expect(fallbackPage, `${p.key} is not rendered in ${fallback}`).toBeDefined();
        expect(xDefault[0]!.attrs.href, `${p.file}: x-default`).toBe(own(fallbackPage!));
      }
      expect(all.length, 'copy.mjs has fewer than two locales').toBeGreaterThan(1);
    });
  }
});

/**
 * `llms.txt`, read as llmstxt.org reads it: a `#` title, a `>` summary, and
 * `##` sections of `- [title](url): description`. Any other line fails, so
 * nothing can be written into it that the pages do not say.
 */
interface Llms {
  title: string;
  summary: string[];
  sections: { name: string; entries: { title: string; url: string; description: string }[] }[];
  stray: string[];
}
function parseLlms(txt: string): Llms {
  const out: Llms = { title: '', summary: [], sections: [], stray: [] };
  const lines = txt.split('\n');
  out.title = /^# (.+)$/.exec(lines[0] ?? '')?.[1] ?? '';
  for (const line of lines.slice(1)) {
    if (line === '') continue;
    const quote = /^> (.+)$/.exec(line);
    const heading = /^## (.+)$/.exec(line);
    const entry = /^- \[([^\]]+)\]\((\S+)\): (.+)$/.exec(line);
    if (quote && out.sections.length === 0) out.summary.push(quote[1]!);
    else if (heading) out.sections.push({ name: heading[1]!, entries: [] });
    else if (entry && out.sections.length > 0)
      out.sections.at(-1)!.entries.push({ title: entry[1]!, url: entry[2]!, description: entry[3]! });
    else out.stray.push(line);
  }
  return out;
}

describe('llms.txt lists every page with an address, by its own words (ADR-0029; 0152 T5 (c))', () => {
  for (const alpha of [true, false]) {
    it(`every page in its own language's section, and nothing else, in a build ${alpha ? 'for' : 'not for'} the Alpha`, async () => {
      const origin = await site();
      const { all, fallback, name } = await locales();
      const { rendered, llms } = await built(alpha);
      const pages = rendered.filter((p) => !notFound(p));
      const own = (p: Page) => `${origin}${servedAt(p.file)}`;
      const titleOf = (p: Page) => text(/<title>([^<]*)<\/title>/.exec(p.html)?.[1] ?? '');
      const descriptionOf = (p: Page) => text(/<meta name="description" content="([^"]*)"/.exec(p.html)?.[1] ?? '');

      const parsed = parseLlms(llms);
      expect(parsed.stray, 'lines llms.txt has that are no title, summary, section or page').toEqual([]);

      const home = pages.find((p) => p.key === 'home' && p.locale === fallback)!;
      const brand = /<a class="brand"[^>]*>(?:<img[^>]*>)?\s*([^<]+)<\/a>/.exec(home.html)?.[1]?.trim();
      expect(brand, 'the header names no brand').toBeTruthy();
      expect(parsed.title, "llms.txt's title is not the name the header shows").toBe(brand);
      expect(parsed.summary, "llms.txt's summary is not the home page's description").toEqual([descriptionOf(home)]);

      expect(parsed.sections.map((s) => s.name), 'a section per language, by its own name').toEqual(all.map(name));
      const listed: string[] = [];
      for (const [i, section] of parsed.sections.entries()) {
        const locale = all[i]!;
        for (const entry of section.entries) {
          const page = pages.find((p) => own(p) === entry.url);
          expect(page, `llms.txt lists ${entry.url}, which is no page of this build`).toBeDefined();
          expect(page!.locale, `${entry.url} is listed under ${section.name}`).toBe(locale);
          expect(entry.title, `${entry.url}: the title llms.txt gives it`).toBe(titleOf(page!));
          expect(entry.description, `${entry.url}: the description llms.txt gives it`).toBe(descriptionOf(page!));
          listed.push(entry.url);
        }
      }
      expect(listed.length, 'llms.txt lists a page twice').toBe(new Set(listed).size);
      expect(listed.slice().sort(), 'llms.txt does not list exactly the pages with an address').toEqual(
        pages.map(own).sort(),
      );
    });
  }
});

/**
 * The build as it is run (`node site/build.mjs`), on a COPY of `site/`, so its
 * `dist` is not the real one: that it writes `llms.txt` at the root, and that
 * every address in it is a file it wrote. A test build, so the legal texts'
 * finality, which `--public` refuses on, is not this file's question.
 */
describe('the build writes llms.txt at the root, and every address in it is a file it wrote', () => {
  let copy = '';
  beforeAll(() => {
    copy = realpathSync(mkdtempSync(join(tmpdir(), 'site-search-')));
    cpSync(HERE, copy, {
      recursive: true,
      filter: (src) => !src.split(sep).includes('dist') && !src.split(sep).includes('node_modules'),
    });
  });
  afterAll(() => {
    if (copy) rmSync(copy, { recursive: true, force: true });
  });

  it('writes it, the same file the module renders, listing each HTML file but the 404s', async () => {
    const origin = await site();
    const r = spawnSync(process.execPath, [join(copy, 'build.mjs')], {
      cwd: copy,
      env: { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu', OWNPACE_STAGE: 'alpha' },
      encoding: 'utf8',
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const dist = join(copy, 'dist');
    expect(existsSync(join(dist, 'llms.txt')), 'the build wrote no llms.txt at the root').toBe(true);
    const written = readFileSync(join(dist, 'llms.txt'), 'utf8');
    expect(written, 'the llms.txt written is not the one the module renders').toBe((await built(true)).llms);

    const urls = parseLlms(written).sections.flatMap((s) => s.entries.map((e) => e.url));
    for (const url of urls) {
      expect(url.startsWith(`${origin}/`), `${url} is not on ${origin}`).toBe(true);
      const path = url.slice(origin.length);
      const file = path.endsWith('/') ? `${path}index.html` : path;
      expect(existsSync(join(dist, file)), `llms.txt lists ${url}, and the build wrote no ${file}`).toBe(true);
    }
    const html: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.html')) html.push(relative(dist, full).split(sep).join('/'));
      }
    };
    walk(dist);
    expect(
      urls.map((u) => u.slice(origin.length)).sort(),
      'llms.txt does not list every HTML file the build wrote but the 404s',
    ).toEqual(html.filter((f) => !notFound({ file: f })).map(servedAt).sort());
  });
});

/**
 * `--public` changes whether the site may be indexed, and nothing about the
 * addresses it names: a test host's pages carry production's addresses too
 * (`addressOf` in `build.mjs` says why), keep their `noindex`, and robots.txt
 * keeps disallowing everything there (held in `site.unit.test.ts`).
 */
describe('a test build names the same addresses as a public one, and keeps its noindex', () => {
  /** The `--public` render, in a child: `PUBLIC` is read from argv at load. */
  function publicBuild(): { pages: { file: string; html: string }[]; llms: string } {
    const build = pathToFileURL(join(HERE, 'build.mjs')).href;
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `import(${JSON.stringify(build)})
           .then((m) => process.stdout.write(JSON.stringify({ pages: m.rendered.map((p) => ({ file: p.file, html: p.html })), llms: m.llms })))
           .catch((e) => { process.stderr.write(String(e && e.message)); process.exit(1); });`,
        // `--` first, or node claims `--public` as an option of its own.
        '--',
        '--public',
      ],
      {
        env: { ...process.env, OWNPACE_APP_URL: 'https://app.ownpace.eu', OWNPACE_STAGE: 'alpha' },
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'] as const,
      },
    );
    return JSON.parse(out) as { pages: { file: string; html: string }[]; llms: string };
  }

  const search = (html: string) =>
    links(html)
      .filter((l) => l.attrs.rel === 'canonical' || 'hreflang' in l.attrs)
      .map((l) => JSON.stringify(l.attrs));
  const NOINDEX = '<meta name="robots" content="noindex, nofollow" />';

  it('the same canonical and hreflang links on every page, and the same llms.txt', async () => {
    const pub = publicBuild();
    const test = await built(true);
    expect(pub.pages.map((p) => p.file).sort()).toEqual(test.rendered.map((p) => p.file).sort());
    for (const p of test.rendered) {
      const twin = pub.pages.find((q) => q.file === p.file)!;
      expect(search(twin.html), `${p.file}: the public build names other addresses`).toEqual(search(p.html));
    }
    expect(pub.llms, 'the public build lists other pages').toBe(test.llms);
  });

  it('a test page asks not to be indexed, once, and a public one does not ask', async () => {
    const pub = publicBuild();
    for (const p of (await built(true)).rendered) {
      expect(p.html.split(NOINDEX).length - 1, `${p.file}: the test build's noindex`).toBe(1);
    }
    for (const p of pub.pages) expect(p.html, `${p.file}: the public build says noindex`).not.toContain('noindex');
  });
});

describe("the site's own address is written once", () => {
  it('in security-txt.mjs, and in no other module of the site', async () => {
    const origin = await site();
    expect(new URL(origin).origin, 'PUBLIC_SITE_URL is not an origin alone').toBe(origin);
    expect(new URL(origin).protocol).toBe('https:');
    const where = readdirSync(HERE)
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => [f, readFileSync(join(HERE, f), 'utf8').split(origin).length - 1] as const)
      .filter(([, n]) => n > 0);
    expect(where, `${origin} written in the site's modules`).toEqual([['security-txt.mjs', 1]]);
  });
});
