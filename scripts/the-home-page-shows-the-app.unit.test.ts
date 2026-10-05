// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE HOME PAGE SHOWS THE APP (workplan 0152 T3: "drawing now, app screen
 * later").
 *
 * After How it works, the home page shows a person's page of the app: real
 * pictures of it, taken by `scripts/shoot-the-app-screen.mjs` into
 * `site/app-screen/`, with `screen.json` beside them recording each picture's
 * size and the words in them. The UI smoke (`test/ui/managed-ui.ui.test.ts`,
 * *the home page's app screen*) holds those words to the app's. This holds the
 * page to the pictures:
 *
 * 1. **Every picture is there, at twice the size the page gives it,** as WebP:
 *    a wide one and a phone's, in each language, and the words of each
 *    language.
 * 2. **Each home page shows it once, after How it works and before Where to,**
 *    its own language's pictures, each `<img>` and `<source>` at the size
 *    `screen.json` records, so the page keeps the picture's room before it
 *    arrives, and the phone's picture below 48rem.
 * 3. **What it says to somebody who cannot see it names only what it shows:**
 *    every name in the `alt` is in the picture's words.
 * 4. **The build ships the pictures,** and not the words, which only the smoke
 *    reads.
 */

import { describe, it, expect } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCREEN = 'site/app-screen';

type Locale = 'en' | 'nl';
interface Screen {
  moment: string;
  pictures: Record<string, { width: number; height: number }>;
  words: Record<Locale, string>;
}
const screen = JSON.parse(readFileSync(join(REPO_ROOT, SCREEN, 'screen.json'), 'utf8')) as Screen;

/** A site module, by address: `site/` is plain JavaScript the root project does not type. */
const site = async <T>(file: string): Promise<T> =>
  (await import(pathToFileURL(join(REPO_ROOT, 'site', file)).href)) as T;

type AppScreenWords = { title: string; lede: string; alt: string; caption: string };

/** A WebP's size in pixels, from its first chunk: lossy, lossless or extended. */
function webpSize(file: string): { width: number; height: number } {
  const b = readFileSync(join(REPO_ROOT, SCREEN, file));
  expect(`${b.toString('ascii', 0, 4)} ${b.toString('ascii', 8, 12)}`, `${file} is not a WebP`).toBe('RIFF WEBP');
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  throw new Error(`${file} starts with a chunk no WebP has: ${chunk}`);
}

const PICTURES = ['en', 'nl'].flatMap((l) => [`person.${l}.webp`, `person-phone.${l}.webp`]);

describe('the home page shows the app (0152 T3)', () => {
  it('has every picture, at twice the size the page gives it, and the words of each language', () => {
    expect(Object.keys(screen.pictures).sort()).toEqual([...PICTURES].sort());
    expect(readdirSync(join(REPO_ROOT, SCREEN)).sort()).toEqual([...PICTURES, 'screen.json'].sort());
    for (const file of PICTURES) {
      const { width, height } = screen.pictures[file]!;
      expect(webpSize(file), `${file} is not twice the size screen.json gives it`).toEqual({
        width: 2 * width,
        height: 2 * height,
      });
    }
    for (const locale of ['en', 'nl'] as const) expect(screen.words[locale].length).toBeGreaterThan(100);
    expect(screen.words.nl).not.toBe(screen.words.en);
  });

  it('shows it once on each home page, after How it works and before Where to, at the recorded sizes', async () => {
    process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
    const { rendered } = await site<{ rendered: Array<{ file: string; html: string }> }>('build.mjs');
    const { COPY } = await site<{
      COPY: Record<Locale, { appScreen: AppScreenWords; strip: { more: string }; whereTitle: string }>;
    }>('copy.mjs');
    for (const [locale, file] of [
      ['en', 'index.html'],
      ['nl', 'nl/index.html'],
    ] as const) {
      const c = COPY[locale];
      const html = rendered.find((p) => p.file === file)!.html;
      expect(html.match(/<figure class="app-screen">/g)?.length, `${file}: the app is not shown once`).toBe(1);
      const at = html.indexOf('<figure class="app-screen">');
      const figure = html.slice(at, html.indexOf('</figure>', at));
      expect(html.indexOf(`${c.strip.more} `), `${file}: the app comes before How it works ends`).toBeLessThan(at);
      expect(html.indexOf(`<h2>${c.whereTitle}</h2>`), `${file}: the app comes after Where to`).toBeGreaterThan(at);
      expect(html.slice(0, at), `${file}: the app has no heading of its own`).toMatch(
        new RegExp(`<h2>${c.appScreen.title}</h2>\\s*<p>${c.appScreen.lede}</p>\\s*$`),
      );
      const size = (f: string) => `width="${screen.pictures[f]!.width}" height="${screen.pictures[f]!.height}"`;
      expect(figure).toContain(
        `<source media="(max-width: 48rem)" srcset="/app-screen/person-phone.${locale}.webp" ${size(`person-phone.${locale}.webp`)}>`,
      );
      expect(figure).toContain(`<img src="/app-screen/person.${locale}.webp" ${size(`person.${locale}.webp`)} alt="`);
      expect(figure).toContain('loading="lazy"');
      expect(figure).toContain(`<figcaption>${c.appScreen.caption}</figcaption>`);
    }
    expect(COPY.nl.appScreen.alt).not.toBe(COPY.en.appScreen.alt);
  });

  it('names, to somebody who cannot see it, only what the picture shows', async () => {
    const { COPY } = await site<{ COPY: Record<Locale, { appScreen: AppScreenWords }> }>('copy.mjs');
    for (const locale of ['en', 'nl'] as const) {
      const { alt } = COPY[locale].appScreen;
      // A name is a capital inside a sentence: the person, and each provider.
      const names = alt.match(/(?<=[\p{Ll},:;] )\p{Lu}[\p{L}-]*/gu) ?? [];
      expect(names.length, `${locale}: the alt names nobody and nothing`).toBeGreaterThan(3);
      for (const name of names) {
        expect(screen.words[locale], `${locale}: the alt names "${name}", which the picture does not show`).toContain(name);
      }
    }
  });

  it('is shipped by the build, without the words only the smoke reads', () => {
    const copy = realpathSync(mkdtempSync(join(tmpdir(), 'site-app-screen-')));
    try {
      cpSync(join(REPO_ROOT, 'site'), copy, {
        recursive: true,
        filter: (src) => !src.split(sep).includes('dist') && !src.split(sep).includes('node_modules'),
      });
      const r = spawnSync('node', [join(copy, 'build.mjs')], {
        cwd: copy,
        env: { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu' },
        encoding: 'utf8',
      });
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      for (const file of PICTURES) {
        const shipped = join(copy, 'dist/app-screen', file);
        expect(existsSync(shipped), `the build did not ship ${file}`).toBe(true);
        expect(readFileSync(shipped).equals(readFileSync(join(REPO_ROOT, SCREEN, file))), `${file} changed on its way`).toBe(true);
      }
      expect(existsSync(join(copy, 'dist/app-screen/screen.json'))).toBe(false);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
