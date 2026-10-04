// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHERE TO IS THE APP'S OWN LIST (workplan 0152 T4).
 *
 * The home page names where a person's data can go: Soverin, Nextcloud, a JMAP
 * server, and any provider that speaks IMAP, CalDAV, CardDAV or WebDAV, each
 * with the data types it takes. A stranger reads that as a promise. The app
 * keeps it in one table, `TARGET_TYPE_DOMAINS`
 * (`packages/shared/src/target-domains.ts`), which the create door enforces.
 * The site imports nothing (`site/build.mjs`'s header), so its list is a copy,
 * `site/destinations.mjs`, and this holds the copy to the table:
 *
 * 1. **Every target type the app has is on the site, once,** and the site
 *    names none the app lacks.
 * 2. **Each card shows exactly what its types carry:** no data type the app
 *    cannot write there, and none it can left out. Where one card is four
 *    protocols, each data type names the protocol that carries it, and that
 *    protocol carries it.
 * 3. **The words are the app's:** each data type as the app names it
 *    (`domain.*` in `apps/web/src/i18n/strings.ts`), in both languages, and
 *    each protocol as `targetTypeName` writes it.
 * 4. **The icons are the drawing's:** `site/icons.mjs` holds the symbols of
 *    `docs/design/0152-0154/icons.svg` character for character, the same
 *    drawing the app's `an-icon-drawn-twice` holds its components to.
 * 5. **The home page draws it,** in both languages, with its sprite once, and
 *    every icon it uses is in that sprite. It names no price (0152 T4 (c)).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TARGET_TYPE_DOMAINS, targetTypeName, type WizardTargetType } from '../packages/shared/src/target-domains.ts';
import { STRINGS } from '../apps/web/src/i18n/strings.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

interface Destination {
  id: string;
  types: string[];
  takes: Record<string, string>;
}

/** A site module, by address: `site/` is plain JavaScript the root project does not type. */
const site = async <T>(file: string): Promise<T> =>
  (await import(pathToFileURL(join(REPO_ROOT, 'site', file)).href)) as T;

const destinations = () =>
  site<{ DATA_TYPES: string[]; DESTINATIONS: Destination[]; PROTOCOL_NAMES: Record<string, string> }>('destinations.mjs');

const APP_TYPES = Object.keys(TARGET_TYPE_DOMAINS) as WizardTargetType[];

describe('the site names where data can go as the app does (0152 T4)', () => {
  it('has every target type the app has, each on one card, and none it lacks', async () => {
    const { DESTINATIONS } = await destinations();
    const named = DESTINATIONS.flatMap((d) => d.types);
    // The vacuity check: an empty list on either side would compare as equal.
    expect(APP_TYPES.length).toBeGreaterThan(4);
    expect([...named].sort(), 'site/destinations.mjs and TARGET_TYPE_DOMAINS name different targets').toEqual(
      [...APP_TYPES].sort(),
    );
    expect(new Set(named).size, 'a target type is on two cards').toBe(named.length);
  });

  it('shows on each card exactly the data types its targets can take, each by the target that carries it', async () => {
    const { DESTINATIONS, DATA_TYPES } = await destinations();
    for (const d of DESTINATIONS) {
      const carried = new Set(d.types.flatMap((t) => TARGET_TYPE_DOMAINS[t as WizardTargetType]));
      expect(Object.keys(d.takes).sort(), `${d.id}: the card's data types are not what its targets take`).toEqual(
        [...carried].sort(),
      );
      for (const [domain, by] of Object.entries(d.takes)) {
        expect(d.types, `${d.id}: ${domain} is said to go by ${by}, which is not this card's`).toContain(by);
        expect(
          TARGET_TYPE_DOMAINS[by as WizardTargetType],
          `${d.id}: the site says ${by} takes ${domain}, and the app's table says it does not`,
        ).toContain(domain);
      }
    }
    // And the site can write every data type a target takes.
    for (const t of APP_TYPES) {
      for (const domain of TARGET_TYPE_DOMAINS[t]) expect(DATA_TYPES, `the site has no words for ${domain}`).toContain(domain);
    }
  });

  it('names each data type as the app does, in both languages, and each protocol as targetTypeName does', async () => {
    const { DATA_TYPES, PROTOCOL_NAMES } = await destinations();
    const { COPY } = await site<{ COPY: Record<'en' | 'nl', { dataTypes: Record<string, string> }> }>('copy.mjs');
    for (const locale of ['en', 'nl'] as const) {
      for (const domain of DATA_TYPES) {
        const app = (STRINGS[locale] as Record<string, string>)[`domain.${domain}`];
        expect(app, `the app has no ${locale} name for ${domain}`).toBeDefined();
        expect(COPY[locale].dataTypes[domain], `${locale}: the site and the app name ${domain} differently`).toBe(app);
      }
    }
    for (const [type, name] of Object.entries(PROTOCOL_NAMES)) {
      expect(name).toBe(targetTypeName(type as WizardTargetType));
    }
  });

  it('draws the icons the design drew, character for character', async () => {
    const symbolsOf = (s: string) => s.match(/<symbol id="i-[a-z]+"[^>]*>[\s\S]*?<\/symbol>/g) ?? [];
    const drawn = symbolsOf(read('docs/design/0152-0154/icons.svg'));
    expect(drawn.length, 'icons.svg lost its symbols').toBe(6);
    const { SYMBOLS } = await site<{ SYMBOLS: string }>('icons.mjs');
    expect(symbolsOf(SYMBOLS), 'site/icons.mjs is not the drawing').toEqual(drawn);
  });

  it('is on the home page in both languages, with its sprite once, and names no price', async () => {
    process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
    const { rendered } = await site<{ rendered: Array<{ file: string; html: string }> }>('build.mjs');
    const { COPY } = await site<{
      COPY: Record<'en' | 'nl', { whereTitle: string; destinations: Record<string, { name: string }> }>;
    }>('copy.mjs');
    for (const [locale, file] of [
      ['en', 'index.html'],
      ['nl', 'nl/index.html'],
    ] as const) {
      const html = rendered.find((p) => p.file === file)!.html;
      const at = html.indexOf(`<h2>${COPY[locale].whereTitle}</h2>`);
      expect(at, `${file} has no Where to`).toBeGreaterThan(-1);
      const section = html.slice(at, html.indexOf('<h2>', at + 1));
      for (const { name } of Object.values(COPY[locale].destinations)) {
        expect(section, `${file}: Where to does not name ${name}`).toContain(`<h3>${name}</h3>`);
      }
      expect(html.match(/<svg class="sprite"/g)?.length, `${file}: the sprite is not there exactly once`).toBe(1);
      const used = [...section.matchAll(/<use href="#i-([a-z]+)"/g)].map((m) => m[1]!);
      expect(used.length).toBeGreaterThan(0);
      for (const name of used) expect(html, `${file}: icon ${name} is not in the sprite`).toContain(`<symbol id="i-${name}"`);
      expect(section, `${file}: Where to names a price`).not.toMatch(/€/);
    }
  });
});
