// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE LEAVING… PAGES SAY WHAT THE APP SAYS (workplan 0152 T5).
 *
 * Six pages, one per provider a person leaves, tell a stranger what moves,
 * what stays behind, what they will do and what it costs. Each of those is a
 * promise the app has to keep, and the app keeps its answers in tables the site
 * cannot import (`site/build.mjs`'s header). So `site/sources.mjs` is a copy,
 * and this holds the copy to the app:
 *
 * 1. **Every card a page names is a source card the app has**, and every row
 *    that moves names a card of its page that carries its data type.
 * 2. **A row is tagged experimental exactly when the app tags that face**
 *    (`sourceFaceIsExperimental`, 0131 T2), in the app's own words.
 * 3. **A row that does not move has no card on its page that carries it.**
 * 4. **Each step is its card's own:** a button where the card's credential has
 *    a consent, a password where it has a password and no consent, an app of
 *    your own where it has a client id and secret and no consent, and an
 *    export for the archive. A step the wizard does not have is never written.
 * 5. **What stays behind is the scope manifest's *Does not migrate* list** for
 *    the page's family, row for row, less a row the page moves another way,
 *    and each is said in both languages.
 * 6. **Photos from an export go only where the app reads one from**
 *    (`ARCHIVE_READABLE_TARGETS`), and **each tile is the app's letter** for
 *    the page's first card (`TILE_LETTERS`).
 * 7. **Each limit links a guide section that exists**, in both languages, and
 *    opens it in the language of the page that links it.
 * 8. **The typical cost is the calculator's own answer**, and the estimate it
 *    links opens on the same case, which Request access carries to the form;
 *    Gmail's ceiling is the calculator's number, on the page and in the guide
 *    section it links.
 * 9. **Every page is built in both languages and reachable:** the header's
 *    list, the phone's menu and the home page's hero link all six, each link
 *    named by its page's title, each tile hidden from a screen reader. The
 *    title is the link's own words, the ones before the name for a screen
 *    reader only, never an `aria-label` over the name it shows: a label that
 *    does not hold the visible name is one voice control cannot find (axe's
 *    label-content-name-mismatch, the UX sweep's follow-ups).
 * 10. **Where the stack asks once, the Google page says once** (the owner,
 *    2026-10-18). A stack that declares Google's restricted scopes
 *    (`GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`, ADR-0041) reads mail and files
 *    through the Google account, so *Start a migration* asks for one sign-in
 *    (`carrierOf` and `connectionsFor` in `apps/web/src/services/start-plan.ts`),
 *    and a site built for it wrote three until then. Points 1 to 4 hold both
 *    builds of the page; each row moves by the card the app's own plan picks,
 *    and no page asks for a sign-in the plan does not. The build reads the
 *    stack's own setting, by the app's rule (`providerAccountDomains`), and
 *    never infers it from `OWNPACE_STAGE`. `deploy-live.sh` hands live's value
 *    to every site build (`a-deploy-from-a-named-tag`), and the OTA site's
 *    documented build hands its stack's (`a-policy-link-that-answers`).
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connectableTypes, credentialFieldsFor } from '../packages/shared/src/credential-fields.ts';
import { sourceTypeDomains, type WizardSourceType } from '../packages/shared/src/target-domains.ts';
import { providerAccountDomains, type ProviderAccountEnv } from '../packages/shared/src/provider-accounts.ts';
import { sourceFaceIsExperimental } from '../packages/shared/src/front-door.ts';
import {
  TYPE_ORDER,
  carrierOf,
  connectionsFor,
  type ServedFacts,
  type StartProvider,
} from '../apps/web/src/services/start-plan.ts';
import { SCOPE_MANIFEST, scopeFamilyOf } from '../packages/shared/src/scope-manifest.ts';
import { ARCHIVE_READABLE_TARGETS } from '../packages/shared/src/archive-in-target.ts';
import type { DiscoveryDomain } from '../packages/shared/src/discovery.ts';
import { STRINGS } from '../apps/web/src/i18n/strings.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

/** A site module, by address: `site/` is plain JavaScript the root project does not type. */
const site = async <T>(file: string): Promise<T> =>
  (await import(pathToFileURL(join(REPO_ROOT, 'site', file)).href)) as T;

interface Row {
  type: string;
  verdict: 'moves' | 'limit' | 'no';
  by?: string;
  limit?: string;
  experimental?: boolean;
}
interface Page {
  id: string;
  tile: string;
  cards: string[];
  rows: Row[];
  staysBehind: { family: string; items: string[]; except: string[] } | null;
  limits: Array<{ id: string; guide: string }>;
  steps: Array<{ card: string; kind: 'button' | 'password' | 'app' | 'export'; words?: string }>;
  typical: string[];
  from: string;
}
interface Leaving {
  menu: string;
  names: Record<string, string>;
  title: Record<string, string>;
  titleOf: (name: string) => string;
  photos: string;
  experimental: string;
  experimentalWhy: string;
  staysBehindItems: Record<string, string>;
  limits: Record<string, string | ((gb: string) => string)>;
  steps: Record<string, string>;
  costPaid: (what: string, tier: string, price: string) => string;
  costFree: (what: string, tier: string) => string;
  costOneAtATime: (tier: string) => string;
  and: string;
}
type Copy = Record<
  'en' | 'nl',
  { htmlLang: string; files: Record<string, string>; dataTypes: Record<string, string>; leaving: Leaving }
>;

const sources = () =>
  site<{
    LEAVING: Page[];
    LEAVING_TYPES: string[];
    DOMAIN_OF: Record<string, DiscoveryDomain>;
    EXPORT_TARGETS: string[];
    leavingPages: (opts: { googleRestricted: boolean }) => Page[];
  }>('sources.mjs');
const copy = async () => (await site<{ COPY: Copy }>('copy.mjs')).COPY;
type Rendered = Array<{ file: string; locale: string; key: string; html: string }>;
const rendered = async () => {
  process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
  return (await site<{ rendered: Rendered }>('build.mjs')).rendered;
};
/** Every page, as a build for a stack that declared Google's restricted scopes, or not, renders it. */
const builtFor = async (googleRestricted: boolean): Promise<Rendered> => {
  process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
  const m = await site<{ build: (opts: { googleRestricted: boolean }) => { rendered: Rendered } }>('build.mjs');
  return m.build({ googleRestricted }).rendered;
};

/**
 * THE TWO BUILDS A PAGE IS HELD IN (point 10): the default, and a stack whose
 * `.env` declares Google's restricted scopes. `served` is what that stack's
 * API answers for the Google account, by the app's own rule, and so what
 * *Start a migration* plans with.
 */
const VARIANTS: ReadonlyArray<{ name: string; googleRestricted: boolean; env: ProviderAccountEnv }> = [
  { name: 'the default build', googleRestricted: false, env: {} },
  { name: 'a build for a stack that declared the restricted scopes', googleRestricted: true, env: { GOOGLE_ACCOUNT_SCOPE_CLASS: 'restricted' } },
];
const servedFor = (env: ProviderAccountEnv): ServedFacts => ({ google: providerAccountDomains('google', env) });
const pagesFor = async (v: (typeof VARIANTS)[number]): Promise<Page[]> =>
  (await sources()).leavingPages({ googleRestricted: v.googleRestricted });

/** The provider *Start a migration* names for a page: its own id, and IMAP for another mail provider. */
const providerOf = (page: Page): StartProvider => (page.id === 'mail' ? 'imap' : page.id) as StartProvider;

/**
 * The cards with no row in `SOURCE_TYPE_DOMAINS`, because what they read is the
 * protocol's, not a table's: one mailbox's mail. `docs/guides/en/imap.md`
 * (*"As a source this card reads mail"*) and `microsoft.md` (*"Both cards read
 * one mailbox's mail"*) say so. A new card the table does not speak for fails
 * the first test below rather than being read as carrying nothing.
 */
const MAIL_ONLY = ['imap', 'graph', 'oauth2'];

/** What a source card carries, as the app decides it on a stack that serves `served`. */
const carries = (card: string, served: ServedFacts = {}): ReadonlyArray<string> =>
  sourceTypeDomains(card as WizardSourceType, served.google) ?? (MAIL_ONLY.includes(card) ? ['email'] : []);

describe('the Leaving… pages say what the app says (0152 T5)', () => {
  it('names only cards the app has, and every card it can read from has an answer', async () => {
    const { LEAVING } = await sources();
    const appCards = connectableTypes('source');
    expect(LEAVING.map((p) => p.id), 'the six pages').toEqual(['google', 'microsoft', 'apple', 'dropbox', 'box', 'mail']);
    for (const card of appCards) {
      expect(carries(card).length, `${card}: the guard does not know what this card reads`).toBeGreaterThan(0);
    }
    for (const page of LEAVING) {
      for (const card of page.cards) expect(appCards, `${page.id}: ${card} is not a source card`).toContain(card);
    }
  });

  it.each(VARIANTS)('moves a data type only by a card of its page that carries it, and refuses one no card of it carries ($name)', async (v) => {
    const { LEAVING_TYPES, DOMAIN_OF } = await sources();
    const served = servedFor(v.env);
    for (const page of await pagesFor(v)) {
      expect(new Set(page.rows.map((r) => r.type)).size, `${page.id}: a data type has two rows`).toBe(page.rows.length);
      for (const row of page.rows) {
        expect(LEAVING_TYPES, `${page.id}: ${row.type} is not a data type a page lists`).toContain(row.type);
        const domain = DOMAIN_OF[row.type]!;
        if (row.verdict === 'no') {
          // Nothing on the page could carry it: a no that one card answers yes is a page that undersells.
          for (const card of page.cards) {
            expect(carries(card, served), `${page.id}: ${row.type} is "does not move", and ${card} carries it`).not.toContain(domain);
          }
          expect(row.by, `${page.id}: ${row.type} does not move, by nothing`).toBeUndefined();
          continue;
        }
        expect(page.cards, `${page.id}: ${row.type} moves by ${row.by}, which is not this page's`).toContain(row.by);
        expect(carries(row.by!, served), `${page.id}: ${row.by} does not carry ${domain}`).toContain(domain);
      }
    }
  });

  it.each(VARIANTS)('moves each row by the card Start a migration plans it with, and asks for no sign-in the plan does not ($name)', async (v) => {
    const { DOMAIN_OF } = await sources();
    const served = servedFor(v.env);
    for (const page of await pagesFor(v)) {
      const provider = providerOf(page);
      // Photos come by an export, which the plan keeps under its own tick box (`exportOf`).
      for (const row of page.rows.filter((r) => r.verdict !== 'no' && r.by !== 'archive')) {
        expect(row.by, `${page.id}: ${row.type} moves by ${row.by}, and the app plans it by another card`).toBe(
          carrierOf(provider, DOMAIN_OF[row.type]!, served),
        );
      }
      // A button is a sign-in the person makes: one the plan never asks for is
      // a page promising more sign-ins than the app has (three, where it asks once).
      const signIns = connectionsFor(provider, TYPE_ORDER, served).map((c) => c.card);
      for (const step of page.steps.filter((s) => s.kind === 'button')) {
        expect(signIns, `${page.id}: a sign-in with ${step.card}, which Start a migration does not ask for here`).toContain(
          step.card,
        );
      }
    }
  });

  it.each(VARIANTS)('tags a row experimental exactly when the app tags that face, in the app’s words ($name)', async (v) => {
    const { DOMAIN_OF } = await sources();
    for (const page of await pagesFor(v)) {
      for (const row of page.rows.filter((r) => r.verdict !== 'no')) {
        expect(row.experimental, `${page.id}: ${row.type} by ${row.by} is tagged unlike the app`).toBe(
          sourceFaceIsExperimental(row.by!, DOMAIN_OF[row.type]!),
        );
      }
    }
    const COPY = await copy();
    for (const locale of ['en', 'nl'] as const) {
      const app = STRINGS[locale] as Record<string, string>;
      expect(COPY[locale].leaving.experimental).toBe(app['frontDoor.experimental']);
      expect(COPY[locale].leaving.experimentalWhy).toBe(app['frontDoor.experimental.why']);
    }
  });

  it.each(VARIANTS)('writes a step only as the card’s own credential asks it, in both languages ($name)', async (v) => {
    const COPY = await copy();
    const kindOf = (card: string) => {
      const fields = credentialFieldsFor('source', card);
      const has = (key: string) => fields.some((f) => f.key === key);
      if (card === 'archive') return 'export';
      if (fields.some((f) => f.consent !== undefined)) return 'button';
      if (fields.some((f) => f.key === 'password' && f.secret)) return 'password';
      if (has('clientId') && fields.some((f) => f.key === 'clientSecret' && f.secret)) return 'app';
      return undefined;
    };
    for (const page of await pagesFor(v)) {
      expect(page.steps.length, `${page.id} says nothing of what the person does`).toBeGreaterThan(0);
      for (const step of page.steps) {
        expect(page.cards, `${page.id}: a step for ${step.card}, which is not this page's`).toContain(step.card);
        expect(step.kind, `${page.id}: ${step.card}'s step is not what its credential asks`).toBe(kindOf(step.card));
        for (const locale of ['en', 'nl'] as const) {
          const words = step.words ?? step.card;
          expect(COPY[locale].leaving.steps[words], `${locale}: no words for ${step.card}'s step (${words})`).toBeTruthy();
        }
      }
      // Every card that moves a row says how it is connected.
      for (const by of new Set(page.rows.flatMap((r) => (r.by ? [r.by] : [])))) {
        expect(page.steps.map((s) => s.card), `${page.id}: ${by} moves a row and has no step`).toContain(by);
      }
    }
  });

  it('says what stays behind as the scope manifest does, row for row, in both languages', async () => {
    const { LEAVING } = await sources();
    const COPY = await copy();
    for (const page of LEAVING) {
      const family = scopeFamilyOf(page.cards[0]!);
      const except = page.staysBehind?.except ?? [];
      const manifest = SCOPE_MANIFEST.doesNotMigrate
        .filter((r) => family !== undefined && (r.appliesTo ?? []).includes(family))
        .map((r) => r.item)
        .filter((item) => !except.includes(item));
      expect(page.staysBehind?.items ?? [], `${page.id}: what stays behind is not the manifest's`).toEqual(manifest);
      if (page.staysBehind) expect(page.staysBehind.family).toBe(family);
      for (const item of manifest) {
        for (const locale of ['en', 'nl'] as const) {
          expect(COPY[locale].leaving.staysBehindItems[item], `${locale}: no words for ${item}`).toBeTruthy();
        }
      }
      // A row the page moves another way is one the manifest names: Google Photos, by Takeout.
      for (const item of except) {
        expect(SCOPE_MANIFEST.doesNotMigrate.map((r) => r.item), `${page.id}: ${item} is no manifest row`).toContain(item);
      }
    }
  });

  it('sends photos from an export only where the app reads one, and draws the app’s letter on each tile', async () => {
    const { LEAVING, EXPORT_TARGETS } = await sources();
    expect([...EXPORT_TARGETS].sort()).toEqual([...ARCHIVE_READABLE_TARGETS].sort());
    const source = /source:\s*\{([\s\S]*?)\}/.exec(read('apps/web/src/components/ProviderTile.tsx'))?.[1];
    expect(source, 'ProviderTile.tsx has no source letters').toBeDefined();
    const letters = Object.fromEntries([...source!.matchAll(/'?([a-z0-9-]+)'?:\s*'(.)'/g)].map((m) => [m[1]!, m[2]!]));
    for (const page of LEAVING) {
      expect(page.tile, `${page.id}: its tile is not the app's letter`).toBe(letters[page.cards[0]!]);
    }
    // The drawing names the same six, under the same letters.
    const drawn = read('docs/design/0152-0154/tiles.svg');
    const COPY = await copy();
    for (const page of LEAVING) {
      expect(drawn, `tiles.svg does not draw ${page.id}'s tile`).toMatch(
        new RegExp(`>${page.tile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</text>\\s*<text[^>]*>${COPY.en.leaving.names[page.id]}<`),
      );
    }
  });

  it('links each limit to a guide section that exists in both languages, in the page’s own', async () => {
    const { LEAVING } = await sources();
    const COPY = await copy();
    const pages = await rendered();
    const { APP_URL } = await site<{ APP_URL: string }>('prices.mjs');
    for (const page of LEAVING) {
      for (const row of page.rows.filter((r) => r.verdict !== 'moves')) {
        expect(page.limits.map((l) => l.id), `${page.id}: ${row.type} points at a limit the page does not explain`).toContain(
          row.limit,
        );
      }
      for (const limit of page.limits) {
        const [slug, section] = limit.guide.split('#');
        for (const locale of ['en', 'nl'] as const) {
          expect(read(`docs/guides/${locale}/${slug}.md`), `${locale}: ${limit.guide} is no guide section`).toContain(
            `{#${section}}`,
          );
          expect(COPY[locale].leaving.limits[limit.id], `${locale}: no words for ${limit.id}`).toBeTruthy();
          // The guide opens in the language of the page that links it
          // (`PublicDocs` takes `?locale=` once, as the request page does).
          const html = pages.find((p) => p.key === `leaving-${page.id}` && p.locale === locale)!.html;
          expect(html, `${locale}/${page.id}: ${limit.guide} is not linked in the page's language`).toContain(
            `href="${APP_URL}/docs/${slug}?locale=${locale}#${section}"`,
          );
        }
      }
    }
  });

  it('prices the typical case as the calculator does, and opens the estimate on it', async () => {
    const { LEAVING } = await sources();
    const COPY = await copy();
    const pages = await rendered();
    const { deriveTier, freeTier, money, GMAIL_IMAP_GB_PER_DAY } = await site<{
      deriveTier: (t: unknown[], paths: number, gb: number) => { tier: { name: string; monthly: number } | null };
      freeTier: (t: unknown) => boolean;
      money: (cents: number, locale?: string) => string;
      GMAIL_IMAP_GB_PER_DAY: number;
    }>('calculator.mjs');
    const { TIERS, REQUEST_ACCESS_URL } = await site<{ TIERS: unknown[]; REQUEST_ACCESS_URL: string }>('prices.mjs');
    const { INDICATIVE_PROFILES, OBJECT_TYPES } = await site<{
      INDICATIVE_PROFILES: { individual: Record<string, { gb: number }> };
      OBJECT_TYPES: string[];
    }>('profiles.mjs');
    const calcFrom = /from: \{([^}]*)\}/.exec(read('site/copy.mjs'))![1]!;
    const objectOf: Record<string, string> = { email: 'mail', calendar: 'calendar', contact: 'contacts', file: 'files', photos: 'photos' };
    for (const page of LEAVING) {
      expect(calcFrom, `${page.id}: the calculator has no answer "${page.from}"`).toContain(`${page.from}:`);
      const objects = page.typical.map((t) => objectOf[t]!);
      for (const o of objects) expect(OBJECT_TYPES, `${page.id}: the calculator cannot price ${o}`).toContain(o);
      const gb = Math.round(objects.reduce((sum, o) => sum + INDICATIVE_PROFILES.individual[o]!.gb, 0) * 10) / 10;
      const atOnce = deriveTier(TIERS, objects.length, gb).tier!;
      const oneByOne = deriveTier(TIERS, 1, gb).tier!;
      for (const locale of ['en', 'nl'] as const) {
        const L = COPY[locale].leaving;
        const html = pages.find((p) => p.key === `leaving-${page.id}` && p.locale === locale)!.html;
        const typeName = (t: string) => (t === 'photos' ? L.photos : COPY[locale].dataTypes[t]!).toLowerCase();
        const names = page.typical.map(typeName);
        const what = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${L.and} ${names.at(-1)}`;
        const expected = freeTier(atOnce)
          ? L.costFree(what, atOnce.name)
          : L.costPaid(what, atOnce.name, money(atOnce.monthly, locale)) +
            (freeTier(oneByOne) ? ` ${L.costOneAtATime(oneByOne.name)}` : '');
        expect(html, `${locale}/${page.id}: the typical cost is not the calculator's`).toContain(`<p>${expected}</p>`);
        const estimate = `?from=${page.from}&amp;what=${objects.join(',')}"`;
        expect(html, `${locale}/${page.id}: the estimate does not open on this page's case`).toContain(estimate);
        // Request access carries the same case to the form (0152 T7 (a)).
        const order = `${REQUEST_ACCESS_URL}?locale=${locale}&amp;from=${page.from}&amp;what=${objects.join(',')}"`;
        expect(html, `${locale}/${page.id}: Request access does not carry this page's case`).toContain(order);
        if (page.limits.some((l) => l.id === 'gmailDaily')) {
          const said = (L.limits.gmailDaily as (gb: string) => string)(GMAIL_IMAP_GB_PER_DAY.toLocaleString(COPY[locale].htmlLang));
          expect(html, `${locale}: Gmail's ceiling is not the calculator's`).toContain(said);
          // And the guide section the limit links gives the same number (UX
          // sweep 2026-10-17): the link landed on the scope and XOAUTH2, and
          // no guide said the ceiling at all.
          const [slug, section] = page.limits.find((l) => l.id === 'gmailDaily')!.guide.split('#') as [string, string];
          const guide = read(`docs/guides/${locale}/${slug}.md`);
          const start = guide.indexOf(`{#${section}}`);
          const end = guide.indexOf('\n#', start);
          const gb = `${GMAIL_IMAP_GB_PER_DAY.toLocaleString(COPY[locale].htmlLang)} GB`;
          expect(
            guide.slice(start, end === -1 ? undefined : end),
            `${locale}: the guide's ${section} section does not give the calculator's ${gb}`,
          ).toContain(gb);
        }
      }
    }
  });

  it('builds all six in both languages, and links them from the header, the phone’s menu and the hero', async () => {
    const { LEAVING } = await sources();
    const COPY = await copy();
    const pages = await rendered();
    for (const locale of ['en', 'nl'] as const) {
      const L = COPY[locale].leaving;
      const titleOf = (p: Page) => L.title[p.id] ?? L.titleOf(L.names[p.id]!);
      const links = LEAVING.map((p) => {
        const name = L.names[p.id]!;
        const title = titleOf(p);
        expect(title.toLowerCase().endsWith(name.toLowerCase()), `${locale}: the title ${title} does not end in ${name}`).toBe(true);
        return {
          href: `${locale === 'nl' ? '/nl' : ''}/${COPY[locale].files[`leaving-${p.id}`]}`,
          // The title's words before the name, which the link says to a screen reader only.
          before: title.slice(0, title.length - name.length).trim(),
          title,
          name,
        };
      });
      for (const l of links) {
        // What a screen reader reads is the page's title, the visible name inside it.
        expect(`${l.before} ${l.name}`.toLowerCase(), `${locale}: ${l.name}'s link does not read its title`).toBe(l.title.toLowerCase());
      }
      for (const page of LEAVING) {
        const built = pages.find((p) => p.key === `leaving-${page.id}` && p.locale === locale);
        expect(built, `${locale}: no page for ${page.id}`).toBeDefined();
        expect(built!.html, `${locale}/${page.id}: its heading is not its title`).toContain(`<span>${titleOf(page)}</span></h1>`);
      }
      for (const p of pages.filter((p) => p.locale === locale)) {
        for (const which of ['site', 'menu']) {
          const nav = new RegExp(`<nav class="${which}"[^>]*>([\\s\\S]*?)</nav>`).exec(p.html)?.[1] ?? '';
          expect(nav, `${p.file}: the ${which} nav has no ${L.menu}`).toContain(`<summary>${L.menu}</summary>`);
          for (const l of links) {
            expect(nav, `${p.file}: the ${which} nav does not link ${l.name}`).toMatch(
              new RegExp(
                `<a href="${l.href}"(?: aria-current="page")?><span class="tile" aria-hidden="true">[^<]</span>` +
                  `<span class="sr-only">${l.before} </span><span>${l.name}</span></a>`,
              ),
            );
          }
          expect(nav, `${p.file}: a Leaving… link in the ${which} nav is named over its words`).not.toMatch(
            /<a href="[^"]*(?:leaving|weg-bij)[^"]*"[^>]*aria-label=/,
          );
        }
      }
      const home = pages.find((p) => p.locale === locale && p.key === 'home' && !p.file.endsWith('404.html'))!.html;
      const hero = home.slice(home.indexOf('<section class="hero">'), home.indexOf('</section>'));
      for (const l of links) {
        expect(hero, `${locale}: the hero does not name ${l.name}`).toMatch(
          new RegExp(
            `<a href="${l.href}"><span class="tile t28" aria-hidden="true">[^<]</span>` +
              `<span class="sr-only">${l.before} </span><span>${l.name}</span></a>`,
          ),
        );
      }
      // The words a screen reader reads are in the page and never drawn.
      expect(home, `${locale}: the site has no sr-only rule for the Leaving… links' words`).toMatch(
        /\.sr-only \{[^}]*position: absolute;[^}]*overflow: hidden; clip-path: inset\(50%\);/,
      );
    }
  });
});

describe('leaving Google, where the stack asks once (point 10; the owner, 2026-10-18)', () => {
  /** The steps of a built Google page, as the words of each item, in order. */
  const stepsOf = (html: string): string[] =>
    [...(/<ul class="steps">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '').matchAll(/<li><span class="kind">[^<]*<\/span>([\s\S]*?)<\/li>/g)].map(
      (m) => m[1]!,
    );
  const googlePage = (pages: Rendered, locale: 'en' | 'nl') =>
    pages.find((p) => p.key === 'leaving-google' && p.locale === locale)!.html;

  it('says one sign-in and the export on a build for that stack, and the three sign-ins of today on the default', async () => {
    const COPY = await copy();
    const once = await builtFor(true);
    const today = await builtFor(false);
    for (const locale of ['en', 'nl'] as const) {
      const L = COPY[locale].leaving;
      expect(stepsOf(googlePage(once, locale)), `${locale}: the restricted build's steps`).toEqual([
        L.steps.googleAll,
        L.steps.archive,
      ]);
      expect(stepsOf(googlePage(today, locale)), `${locale}: the default build's steps changed`).toEqual([
        L.steps.google,
        L.steps.gmail,
        L.steps['google-drive'],
        L.steps.archive,
      ]);
      // Mail through the account is not yet proven (`SOURCE_PROOFS`), so its row
      // wears the tag there and not where the Gmail card carries it.
      const mailRow = (html: string) => /<li class="move" data-type="email"[^>]*>/.exec(html)?.[0] ?? '';
      expect(mailRow(googlePage(once, locale)), `${locale}: mail through the account is not tagged`).toContain(
        'data-experimental',
      );
      expect(mailRow(googlePage(today, locale)), `${locale}: mail through Gmail is tagged`).not.toContain('data-experimental');
      // Only the Google page differs between the two builds.
      for (const page of today.filter((p) => p.locale === locale && p.key !== 'leaving-google')) {
        expect(once.find((p) => p.file === page.file)?.html, `${page.file} differs between the two builds`).toBe(page.html);
      }
    }
  });

  it('reads the stack’s own GOOGLE_ACCOUNT_SCOPE_CLASS by the app’s rule, and never infers it from OWNPACE_STAGE', async () => {
    const COPY = await copy();
    /** The Google page, by locale, as `node site/build.mjs` renders it with only these settings. */
    const builtWith = (settings: Record<string, string | undefined>): Record<'en' | 'nl', string> => {
      const env: NodeJS.ProcessEnv = { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu' };
      delete env.GOOGLE_ACCOUNT_SCOPE_CLASS;
      delete env.OWNPACE_STAGE;
      for (const [key, value] of Object.entries(settings)) if (value !== undefined) env[key] = value;
      const build = pathToFileURL(join(REPO_ROOT, 'site', 'build.mjs')).href;
      const script =
        `const { rendered } = await import(${JSON.stringify(build)});\n` +
        "process.stdout.write(JSON.stringify(rendered.filter((p) => p.key === 'leaving-google').map((p) => [p.locale, p.html])));";
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      return Object.fromEntries(JSON.parse(r.stdout) as Array<[string, string]>) as Record<'en' | 'nl', string>;
    };
    const asksOnce = (pages: Record<'en' | 'nl', string>, locale: 'en' | 'nl') =>
      stepsOf(pages[locale]).includes(COPY[locale].leaving.steps.googleAll!);

    let on = 0;
    for (const value of [undefined, '', 'sensitive', 'restricted', '  restricted  ', 'RESTRICTED', 'restrictd']) {
      const pages = builtWith({ GOOGLE_ACCOUNT_SCOPE_CLASS: value });
      // The app's rule: one consent covers mail exactly where the API serves it through the account.
      const app = providerAccountDomains('google', { GOOGLE_ACCOUNT_SCOPE_CLASS: value }).includes('email');
      if (app) on++;
      for (const locale of ['en', 'nl'] as const) {
        expect(asksOnce(pages, locale), `${locale}: GOOGLE_ACCOUNT_SCOPE_CLASS=${JSON.stringify(value)} says other than the app`).toBe(app);
      }
    }
    // The vacuity check: the loop above turned it on at least once.
    expect(on).toBeGreaterThan(0);
    // The alpha's setting decides the alpha, never which consent a stack's Google application holds.
    for (const stage of ['alpha', '']) {
      for (const [value, once] of [[undefined, false], ['restricted', true]] as const) {
        const pages = builtWith({ OWNPACE_STAGE: stage, GOOGLE_ACCOUNT_SCOPE_CLASS: value });
        for (const locale of ['en', 'nl'] as const) {
          expect(asksOnce(pages, locale), `${locale}: OWNPACE_STAGE=${stage} with GOOGLE_ACCOUNT_SCOPE_CLASS=${value}`).toBe(once);
        }
      }
    }
  });
});
