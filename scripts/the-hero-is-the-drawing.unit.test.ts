// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE HERO IS THE DRAWING (workplan 0152 T3).
 *
 * The home page's hero shows the move as a picture: the old account, Ownpace
 * copying and keeping in step, the new home. It was drawn once, in
 * `docs/design/0152-0154/hero-move.svg`, and the site cannot read the design
 * folder (it builds on its own), so `site/hero.mjs` is a copy. This holds the
 * copy to the drawing and the page to the plan:
 *
 * 1. **The shapes are the drawing's, line for line.** With the words taken out,
 *    `heroMove` is the drawing, less its own `<symbol>`s (the page's sprite
 *    draws them), with its title and description under ids of their own and
 *    no fixed size. Nothing else may differ.
 * 2. **The sprite draws what the drawing drew:** the drawing's symbols are
 *    `icons.svg`'s, which `site/icons.mjs` is held to by
 *    `where-to-is-the-apps-own-list`.
 * 3. **The words are the page's language,** every one filled in both: each
 *    data type as the app names it, and the picture is an image named by its
 *    own title and description.
 * 4. **The home page shows it once, after its buttons,** so on a phone the
 *    buttons come first; the three facts follow, then How it works in three
 *    steps, linking the whole page. How it works ends with the hero's two
 *    buttons (T3 (c)).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DISCOVERY_DOMAINS } from '../packages/shared/src/discovery.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

/** A site module, by address: `site/` is plain JavaScript the root project does not type. */
const site = async <T>(file: string): Promise<T> =>
  (await import(pathToFileURL(join(REPO_ROOT, 'site', file)).href)) as T;

interface HeroWords {
  title: string;
  desc: string;
  old: string;
  new: string;
  copies: string;
  keeps: [string, string];
}
type Copy = Record<
  'en' | 'nl',
  {
    hero: HeroWords;
    /** A fact that is a claim links its proof: its words are a function of the links (0152 T8). */
    facts: Array<[string | ((links: Record<string, string>) => string), string]>;
    strip: { steps: Array<[string, string]>; more: string };
    dataTypes: Record<string, string>;
    leaving: { photos: string };
    files: Record<string, string>;
    ctaOrder: string;
    ctaPricing: string;
  }
>;

const DRAWING = 'docs/design/0152-0154/hero-move.svg';

/** The words taken out: every text, title and description, so only the shapes are left. */
const shapesOf = (svg: string) =>
  svg
    .replace(/(<text\b[^>]*>)[^<]*(<\/text>)/g, '$1…$2')
    .replace(/(<title\b[^>]*>)[^<]*(<\/title>)/g, '$1…$2')
    .replace(/(<desc\b[^>]*>)[^<]*(<\/desc>)/g, '$1…$2');

/** The drawing as the page draws it: the three differences hero.mjs's header names, and no others. */
const asThePageDrawsIt = (drawing: string) =>
  drawing
    .trimEnd()
    // its symbols come from the page's sprite
    .replace(/<defs>\n(?:<symbol[\s\S]*?<\/symbol>\n)+<\/defs>\n/, '')
    // it scales with its column, its title and description under ids of their own
    .replace(' width="560" height="310"', '')
    .replace('<svg xmlns=', '<svg class="hero-move" xmlns=')
    .replace('aria-labelledby="t d"', 'aria-labelledby="hero-move-t hero-move-d"')
    .replace('<title id="t">', '<title id="hero-move-t">')
    .replace('<desc id="d">', '<desc id="hero-move-d">');

describe('the hero is the drawing (0152 T3)', () => {
  it('draws the drawing’s shapes, line for line, with only the page’s words in them', async () => {
    const { heroMove } = await site<{ heroMove: (w: unknown) => string }>('hero.mjs');
    const COPY = (await site<{ COPY: Copy }>('copy.mjs')).COPY;
    const drawing = read(DRAWING);
    expect(drawing, 'the drawing lost its symbols').toMatch(/<defs>\n<symbol id="i-mail"/);
    for (const locale of ['en', 'nl'] as const) {
      const c = COPY[locale];
      const drawn = heroMove({ ...c.hero, types: { ...c.dataTypes, photos: c.leaving.photos } });
      expect(shapesOf(drawn), `${locale}: hero.mjs is not hero-move.svg`).toBe(shapesOf(asThePageDrawsIt(drawing)));
      // Every word is the page's own: none is left empty, none is the drawing's English in Dutch.
      expect(drawn).not.toMatch(/<text\b[^>]*><\/text>|undefined/);
      // The drawing carries the app's data types but tasks, which it does not draw.
      for (const t of DISCOVERY_DOMAINS.filter((d) => d !== 'task')) {
        expect(drawn.split(`>${c.dataTypes[t]}</text>`).length - 1, `${locale}: ${t} is not on both sides`).toBe(2);
      }
      expect(drawn.split(`>${c.leaving.photos}</text>`).length - 1).toBe(2);
      expect(drawn).toContain(`<title id="hero-move-t">${c.hero.title}</title>`);
      expect(drawn).toContain(`<desc id="hero-move-d">${c.hero.desc}</desc>`);
      expect(drawn).toContain('role="img" aria-labelledby="hero-move-t hero-move-d"');
    }
    expect(COPY.nl.hero.title).not.toBe(COPY.en.hero.title);
  });

  it('draws with the symbols the icons drawing drew, which the page’s sprite carries', () => {
    const symbolsOf = (s: string) => s.match(/<symbol id="i-[a-z]+"[^>]*>[\s\S]*?<\/symbol>/g) ?? [];
    expect(symbolsOf(read(DRAWING)).length).toBe(6);
    expect(symbolsOf(read(DRAWING))).toEqual(symbolsOf(read('docs/design/0152-0154/icons.svg')));
  });

  it('shows it once on each home page, after the buttons, with the three facts and How it works in three steps', async () => {
    process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
    const { rendered } = await site<{ rendered: Array<{ file: string; locale: string; key: string; html: string }> }>(
      'build.mjs',
    );
    const COPY = (await site<{ COPY: Copy }>('copy.mjs')).COPY;
    const { PROOF_LINKS } = await site<{ PROOF_LINKS: Record<string, string> }>('proof.mjs');
    for (const [locale, file] of [
      ['en', 'index.html'],
      ['nl', 'nl/index.html'],
    ] as const) {
      const c = COPY[locale];
      const html = rendered.find((p) => p.file === file)!.html;
      expect(html.match(/<svg class="hero-move"/g)?.length, `${file}: the picture is not there once`).toBe(1);
      const hero = html.slice(html.indexOf('<section class="hero">'), html.indexOf('</section>'));
      const buttons = hero.indexOf('<div class="cta">');
      expect(buttons, `${file}: the hero has no buttons`).toBeGreaterThan(-1);
      expect(hero.indexOf('<svg class="hero-move"'), `${file}: the picture comes before the buttons`).toBeGreaterThan(buttons);
      // Each icon the picture uses is in the page's one sprite.
      for (const [, name] of hero.matchAll(/<use href="#i-([a-z]+)"/g)) {
        expect(html, `${file}: the sprite has no ${name}`).toContain(`<symbol id="i-${name}"`);
      }
      expect(html.match(/<svg class="sprite"/g)?.length, `${file}: the sprite is not there once`).toBe(1);

      const after = html.slice(html.indexOf('</section>'));
      let at = 0;
      for (const [words, p] of c.facts) {
        const h = typeof words === 'function' ? words(PROOF_LINKS) : words;
        const found = after.indexOf(`<h3>${h}</h3><p>${p}</p>`, at);
        expect(found, `${file}: the fact "${h}" is missing or out of order`).toBeGreaterThan(at - 1);
        at = found;
      }
      const strip = after.slice(after.indexOf('<ol class="strip">'), after.indexOf('</ol>', after.indexOf('<ol class="strip">')));
      expect(strip.match(/<li>/g)?.length, `${file}: How it works is not three steps`).toBe(3);
      for (const [h, p] of c.strip.steps) expect(strip).toContain(`<h3>${h}</h3><p>${p}</p>`);
      const how = `${locale === 'nl' ? '/nl' : ''}/${c.files.how}`;
      expect(after, `${file}: the three steps do not link How it works`).toContain(`<a href="${how}">${c.strip.more} `);
    }
    for (const [locale, file] of [
      ['en', 'how-it-works.html'],
      ['nl', 'nl/hoe-het-werkt.html'],
    ] as const) {
      const c = COPY[locale];
      const html = rendered.find((p) => p.file === file)!.html;
      const end = html.slice(html.lastIndexOf('<h2'), html.indexOf('</main>'));
      expect(end, `${file} does not end with Request access`).toContain(`>${c.ctaOrder}</a>`);
      expect(end, `${file} does not end with what it costs`).toContain(`>${c.ctaPricing}</a>`);
    }
  });
});
