// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The public site gets guards, because it is the one surface where being wrong
 * is visible to a stranger before anybody here notices.
 *
 * Four things are pinned, each for a failure that has a precedent in this
 * repository rather than for tidiness:
 *
 *  1. **The prices agree with ADR-0014.** Workplan 0088 T4 asks for a drift
 *     guard between the page and the invoice, and it cannot be an import —
 *     `site/` depends on nothing, deliberately (0086 T7). So the copy is
 *     guarded against the ADR's own table instead. A page quoting a price the
 *     ADR no longer says is the exact failure this exists to stop, and unlike
 *     most drift it is actionable by a customer.
 *
 *  2. **Both locales carry the same keys.** ADR-0013 makes the end-user
 *     surface bilingual EN+NL. A half-translated page is worse than an
 *     untranslated one, because a reader cannot tell which half is missing.
 *
 *  3. **Nothing leaks through the renderer unrendered.** `site/build.mjs`
 *     carries its own small Markdown subset. When a document grows a construct
 *     the subset does not cover, the page still renders — with `**bold**` or a
 *     raw table row sitting in the prose. That is silent, which is what makes
 *     it worth a test.
 *
 *  4. **The palette is the logo's palette.** `scripts/make-logo.py` draws the
 *     mark in one teal; a site whose green is not that green looks like
 *     somebody else's site.
 *
 * NOT asserted: wording, layout, or that the pages look good. Those need a
 * person to look — which is how the unstyled-UI defect of 2026-08-06 was
 * eventually found, and no assertion here would have caught it either.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  cpSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// `prices.mjs` refuses to resolve APP_URL without being told which app it is
// building for, and `build.mjs` imports it at load. Set before any dynamic
// import below — a default here would put back the thing the refusal removes.
process.env.OWNPACE_APP_URL = 'https://app.ota.ownpace.eu';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');

/** One page the build renders, as `site/build.mjs` returns it. */
interface Page {
  readonly locale: string;
  readonly key: string;
  readonly file: string;
  readonly html: string;
}

/** What `site/build.mjs` renders at load, with the environment this file runs in. */
async function renderedPages(): Promise<Page[]> {
  const { rendered } = (await import('./build.mjs')) as unknown as { rendered: Page[] };
  return rendered;
}

/**
 * The pages a build renders when told it is for the alpha, or not, asked in
 * this process (workplan 0144 T1). The environment's own switch is held below,
 * in a child process, so these never depend on what the shell exported.
 */
async function buildFor(alpha: boolean): Promise<Page[]> {
  const m = (await import('./build.mjs')) as unknown as {
    build?: (opts: { alpha: boolean }) => { rendered: Page[] };
  };
  expect(typeof m.build, 'site/build.mjs does not export build({ alpha }), so an alpha build cannot be asked for').toBe(
    'function',
  );
  return m.build!({ alpha }).rendered;
}
const alphaBuild = (): Promise<Page[]> => buildFor(true);

/**
 * A price cell, in CENTS: `free`, or whole euros. Anything else is a broken
 * table and fails by name: a lenient parse read "free", "—" and a garbled cell
 * alike as zero, which is the one price that must never arrive by accident.
 */
function cents(cell: string, what: string): number {
  const value = cell === 'free' ? 0 : /^€\d+$/.test(cell) ? Number(cell.slice(1)) * 100 : Number.NaN;
  expect(Number.isNaN(value), `ADR-0014: ${what} reads "${cell}", which is neither "free" nor whole euros`).toBe(false);
  return value;
}

/** Parse ADR-0014's own tier table — the source this file is guarded against. */
function tiersFromAdr(): Map<string, { paths: number; data: string; monthly: number; annual: number }> {
  const adr = read('docs/adr/0014-cost-recovery-billing.md');
  // The table that holds NOW lives in the ADR's operative rules, amended in
  // place (ADR-0038); the narrative keeps the 2026-08-20 table as a record,
  // and a guard that read both would count ten rows.
  const start = adr.indexOf('\n## Operative rules');
  const operative = adr.slice(start, adr.indexOf('\n## ', start + 1));
  const rows = operative
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\|\s*\*\*(Free|Small|Medium|Large|Extra large)\*\*/.test(l));
  expect(rows.length, "ADR-0014's operative rules no longer have a five-row tier table").toBe(5);

  const out = new Map<string, { paths: number; data: string; monthly: number; annual: number }>();
  for (const row of rows) {
    const c = row
      .split('|')
      .slice(1, -1)
      .map((x) => x.trim());
    // | tier | paths at the same time | data moved | monthly | a year |
    const name = c[0]!.replace(/\*\*/g, '');
    out.set(name.toLowerCase(), {
      paths: Number(c[1]),
      data: c[2]!,
      monthly: cents(c[3]!, `${name}'s monthly`),
      annual: cents(c[4]!, `${name}'s year`),
    });
  }
  return out;
}

describe('the published prices agree with the decision that set them', () => {
  it('matches ADR-0014 tier for tier', async () => {
    const { TIERS, size } = await import('./prices.mjs');
    const adr = tiersFromAdr();

    expect(TIERS.length).toBe(adr.size);
    for (const t of TIERS) {
      const a = adr.get(t.name.toLowerCase());
      expect(a, `ADR-0014 has no row for "${t.name}"`).toBeDefined();
      const where = `${t.name}: site/prices.mjs disagrees with ADR-0014`;
      expect(t.paths, `${where} on paths at the same time`).toBe(a!.paths);
      expect(t.monthly, `${where} on the monthly`).toBe(a!.monthly);
      expect(t.annual, `${where} on the year`).toBe(a!.annual);
      expect(t, `${t.name}: a setup fee is back in site/prices.mjs (ADR-0014 dropped them)`).not.toHaveProperty('setup');
      // The ADR writes "750 GB" / "2 TB"; size() must produce the same string.
      expect(size(t.dataGb), `${where} on the data ceiling`).toBe(a!.data);
    }
  });

  it('prices a year at six months, in every tier (ADR-0014, 2026-10-03)', async () => {
    const { TIERS, total } = await import('./prices.mjs');
    for (const t of TIERS) {
      expect(t.annual, `${t.name}: a year is not six months' price`).toBe(t.monthly * 6);
      expect(total(t, 3)).toBe(t.monthly * 3);
      expect(Number.isInteger(t.monthly) && Number.isInteger(t.annual), `${t.name}: a price that is not whole cents`).toBe(true);
    }
  });

  it('says what each tier is in the page’s language, and as a fact, never as "most people" (0152 T1 (b))', async () => {
    const { TIERS } = await import('./prices.mjs');
    const { COPY } = (await import('./copy.mjs')) as unknown as {
      COPY: Record<'en' | 'nl', { tierText: Record<string, { who: string; note: string }> }>;
    };
    const pages = await renderedPages();
    const html = (file: string) => pages.find((p) => p.file === file)!.html;
    for (const [locale, other, file] of [
      ['en', 'nl', 'pricing.html'],
      ['nl', 'en', 'nl/prijzen.html'],
    ] as const) {
      for (const t of TIERS) {
        const own = COPY[locale].tierText[t.id];
        expect(own?.who && own?.note, `${locale}: ${t.name} has no subtitle or note`).toBeTruthy();
        expect(html(file), `${file}: ${t.name}'s subtitle is not its own language's`).toContain(own!.who);
        // The defect this replaces: the Dutch page printed English tier text.
        expect(html(file), `${file}: ${t.name}'s note is in ${other}`).not.toContain(COPY[other].tierText[t.id]!.note);
      }
    }
    // Nothing counts who picks what, so no page says what most people do.
    for (const page of pages) {
      expect(page.html, `${page.file} claims what most people choose`).not.toMatch(/most people|meeste mensen|meest gekozen/i);
    }
    expect(html('index.html')).toContain('<strong>Small</strong>, for one person moving everything at once: €5 a month');
    expect(html('nl/index.html')).toContain('<strong>Small</strong>, voor één persoon die alles tegelijk migreert: €5 per maand');
  });

  it('writes cents as a price, and refuses a price that is not whole cents', async () => {
    const { money } = await import('./prices.mjs');
    expect(money(500)).toBe('€5');
    expect(money(250)).toBe('€2.50');
    expect(money(48000)).toBe('€480');
    expect(money(605)).toBe('€6.05');
    expect(() => money(2.5)).toThrow(/whole cents/);
  });

  it('says "free" for the free tier, and never "€0", on every page (ADR-0014, 2026-09-24)', async () => {
    const { rendered } = (await import('./build.mjs')) as unknown as {
      rendered: Array<{ file: string; html: string }>;
    };
    // "€0" reads as a price that could be billed. A free tier is free.
    for (const page of rendered) {
      expect(page.html, `${page.file} shows a price of €0`).not.toMatch(/€0(?![\d.,])/);
    }
    const card = (file: string) => {
      const html = rendered.find((p) => p.file === file)!.html;
      const at = html.indexOf('<h3>Free</h3>');
      expect(at, `${file} has no Free card`).toBeGreaterThan(-1);
      return html.slice(at, html.indexOf('</div>\n', html.indexOf('<ul>', at)));
    };
    expect(card('pricing.html')).toContain('Free <span>');
    expect(card('pricing.html')).toContain('No invoice <span>');
    expect(card('pricing.html')).toContain('moves you to Small');
    expect(card('nl/prijzen.html')).toContain('Gratis <span>');
    expect(card('nl/prijzen.html')).toContain('Geen factuur <span>');
    // The landing page's line says what free covers, where it used to say
    // "From €6 for the first month".
    expect(rendered.find((p) => p.file === 'index.html')!.html).toContain('Free: one migration at a time, up to 250 GB.');
    expect(rendered.find((p) => p.file === 'nl/index.html')!.html).toContain('Free: één migratie tegelijk, tot 250 GB.');
    // And no page still names the tier Free replaced, or a setup fee.
    for (const page of rendered.filter((p) => !/^(nl\/)?(privacy|terms|voorwaarden|alpha)\.html$/.test(p.file))) {
      expect(page.html, `${page.file} still names Tiny`).not.toMatch(/\bTiny\b/);
      expect(page.html, `${page.file} still quotes a setup fee`).not.toMatch(/one-off setup|setup fee is|eenmalige inrichting/i);
    }
    // And no page still says there is nothing to gain by going one at a time.
    for (const page of rendered) {
      expect(page.html, `${page.file} still says rationing gains nothing`).not.toMatch(
        /nothing to gain by rationing|niets te winnen met zuinig/,
      );
    }
  });

  it('says out loud that prices include VAT, wherever a price is shown (0111 T8)', async () => {
    // Toward a consumer a displayed price IS the final price; the pages now
    // say so instead of leaving it implicit. Deliberately no rate in the
    // copy — which country's VAT sits inside the price is decided per
    // invoice by the treatment machinery, and a number here would drift the
    // day OSS activates or a rate changes.
    const { rendered } = (await import('./build.mjs')) as unknown as {
      rendered: Array<{ file: string; html: string }>;
    };
    const { COPY } = (await import('./copy.mjs')) as unknown as {
      COPY: Record<string, { vatIncluded: string }>;
    };

    // The three surfaces that show prices today, named so a regression fails
    // with a file, not a count.
    const MUST_LABEL = [
      'index.html',
      'pricing.html',
      'estimate.html',
      'nl/index.html',
      'nl/prijzen.html',
      'nl/schatting.html',
    ];
    for (const file of MUST_LABEL) {
      const page = rendered.find((p) => p.file === file);
      expect(page, `${file}: page missing from the build`).toBeDefined();
      const locale = file.startsWith('nl/') ? 'nl' : 'en';
      expect(
        page!.html,
        `${file}: shows prices without saying they include VAT`,
      ).toContain(COPY[locale]!.vatIncluded);
    }

    // And the structural rule, so a FUTURE page with a tier table cannot
    // ship unlabeled: anything rendering the tier cards or the calculator's
    // tier card carries the sentence in its own language.
    for (const page of rendered) {
      if (!/class="tiers"|id="tier-card"/.test(page.html)) continue;
      const locale = page.file.startsWith('nl/') ? 'nl' : 'en';
      expect(
        page.html,
        `${page.file}: renders tier prices without the VAT-included label`,
      ).toContain(COPY[locale]!.vatIncluded);
    }
  });

  it('never says both that prices include VAT and that VAT is added (0152 T6 (a))', async () => {
    // The pricing page said both: "All prices include VAT." in its label and
    // "VAT is added where it applies." in its last paragraph (#1317 took the
    // second out). A reader cannot know which one holds, and toward a consumer
    // only the first is allowed: the displayed price is the final price.
    const { rendered } = (await import('./build.mjs')) as unknown as {
      rendered: Array<{ file: string; html: string }>;
    };
    const ADDED = /VAT is added|plus VAT|excluding VAT|excl\.? VAT|btw komt erbij|exclusief btw|excl\.? btw/i;
    const both = rendered
      .filter((p) => /include VAT|inclusief btw/i.test(p.html) && ADDED.test(p.html))
      .map((p) => `${p.file}: ${p.html.match(ADDED)![0]}`);
    expect(both, 'these pages say prices include VAT and also that VAT is added').toEqual([]);
  });
});

describe('both locales are complete', () => {
  it('has the same keys in every locale', async () => {
    const { COPY, LOCALES } = await import('./copy.mjs');
    const keysOf = (o: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? keysOf(v as Record<string, unknown>, `${prefix}${k}.`)
          : [`${prefix}${k}`],
      );

    const [first, ...rest] = LOCALES as string[];
    const base = keysOf(COPY[first as keyof typeof COPY]).sort();
    for (const l of rest) {
      const other = keysOf(COPY[l as keyof typeof COPY]).sort();
      const missing = base.filter((k) => !other.includes(k));
      const extra = other.filter((k) => !base.includes(k));
      expect(missing, `locale "${l}" is missing keys present in "${first}"`).toEqual([]);
      expect(extra, `locale "${l}" has keys "${first}" does not`).toEqual([]);
    }
  });

  it('ships a Dutch translation of each legal document', () => {
    // `alpha` is drafted before the build renders it (workplan 0139 T2, T10),
    // Dutch first; the pair is held to the same shape from the first draft.
    for (const f of ['privacy', 'terms', 'alpha']) {
      const en = read(`site/legal/${f}.md`);
      const nl = read(`site/legal/${f}.nl.md`);
      // Section numbering is kept identical on purpose, so the two can be
      // diffed when either changes. Compare the count of `## N.` headings.
      const count = (s: string) => (s.match(/^## \d+\./gm) ?? []).length;
      expect(count(nl), `${f}.nl.md has a different number of numbered sections`).toBe(count(en));
    }
  });

  /**
   * DUTCH SAYS *MIGRATIE*, NEVER *VERHUIZING* (workplan 0152 D6; the owner,
   * 2026-09-28: "dutch know 'één migratie en 4 migraties'. So we use 'migratie'
   * in instead of 'verhuizing'"). Every form: *verhuizing*, *verhuist*,
   * *verhuisd*, *verhuizen*.
   *
   * Asked of the built pages, so a page title from `build.mjs` counts as much as
   * a sentence in `copy.mjs` or `pages/nl/`. The legal texts are asked too: they
   * were excused by name until they followed D6 (the owner, 2026-09-29), and
   * nothing is excused now.
   */
  it('says no form of verhuizen on any Dutch page the site writes (0152 D6)', async () => {
    // Both builds: the pages only an alpha build writes (the tester guide,
    // 0144 T1) are Dutch the product speaks too.
    const dutch = [...(await renderedPages()), ...(await alphaBuild())].filter((p) =>
      p.file.startsWith('nl/'),
    );
    // Vacuity: the home page, how it works, pricing, the estimate, the
    // three legal texts that said it longest, and the tester guide.
    expect(dutch.map((p) => p.file)).toEqual(
      expect.arrayContaining([
        'nl/index.html',
        'nl/hoe-het-werkt.html',
        'nl/prijzen.html',
        'nl/schatting.html',
        'nl/privacy.html',
        'nl/voorwaarden.html',
        'nl/alpha.html',
        'nl/alpha-handleiding.html',
      ]),
    );
    for (const page of dutch) {
      expect(page.html.match(/\S*verhui[sz]\S*/gi) ?? [], `${page.file} says a form of verhuizen`).toEqual([]);
    }
  });
});

describe('the renderer covers what the documents actually use', () => {
  it('leaves no Markdown unrendered in any built page', async () => {
    // The alpha build too, whose guide is the one page with explicit heading
    // ids and a build-time address (0144 T1).
    const pages = [...(await renderedPages()), ...(await alphaBuild())];
    expect(pages.map((p) => p.file)).toContain('nl/alpha-handleiding.html');
    for (const page of pages) {
      const body = page.html.split('<main')[1] ?? '';
      // An explicit heading id, `## Hulp {#hulp}`, is an attribute, never text,
      // and a `[[TOKEN]]` the build fills in is never left for a reader.
      expect(body, `${page.file}: an explicit heading id was left in the text`).not.toMatch(/\{#[a-z0-9-]*\}/);
      expect(body, `${page.file}: a [[TOKEN]] was left unfilled`).not.toMatch(/\[\[[A-Z_]+\]\]/);
      // Each of these means a construct reached the output as source text.
      expect(body, `${page.file}: unrendered bold`).not.toMatch(/\*\*\S/);
      expect(body, `${page.file}: unrendered table row`).not.toMatch(/\n\|.*\|/);
      expect(body, `${page.file}: unrendered heading`).not.toMatch(/\n#{1,4} /);
      expect(body, `${page.file}: unrendered link`).not.toMatch(/\]\(\S+\)/);
      // The code-span parking marker must never survive into a page, and its
      // index must never be resolved against a number that came from prose.
      expect(body, `${page.file}: parking marker leaked`).not.toContain(String.fromCharCode(0));
      expect(body, `${page.file}: a placeholder resolved to nothing`).not.toContain('undefined');
    }
  });
});

/**
 * THE TESTER GUIDE IS THE ALPHA'S, AND ONLY THE ALPHA'S (workplan 0144 T1).
 *
 * The owner, 2026-10-03: *"Agreed, write the Dutch version on the site"*. One
 * page, Dutch first, `nl/alpha-handleiding.html`, with its translation at
 * `alpha-guide.html`, outside the nav as the Alpha conditions are.
 *
 * Unlike the conditions, it is rendered ONLY when the site is built for the
 * alpha: `OWNPACE_STAGE=alpha`, the one setting the API and the web build read
 * for it (0131 T1). The conditions are rendered in every build because the
 * acceptance screen links them; the guide is a how-to for people taking part,
 * and a build without the setting leaves it out, so it leaves the site when
 * the alpha ends (0144 §3 T1). These cases hold what §3 asks of it: both
 * files with the setting and neither without it, the six section ids, every
 * link resolving, nothing in the nav, and the conditions linked as what binds.
 */
describe('the tester guide is rendered for the alpha only (workplan 0144 T1)', () => {
  const GUIDE = { en: 'alpha-guide.html', nl: 'nl/alpha-handleiding.html' } as const;
  /** The six sections, in order, by their stable ids: §3's points 1 to 6. */
  const SECTIONS = {
    nl: ['wat-de-alpha-is', 'voordat-u-begint', 'zo-begint-u', 'wat-experimenteel-is', 'hulp', 'stoppen'],
    en: ['what-the-alpha-is', 'before-you-start', 'how-to-start', 'what-is-experimental', 'help', 'stopping'],
  } as const;
  /** The words that say the guide binds nobody, and the conditions do. */
  const NOT_A_CONTRACT = { nl: /geen contract/, en: /not a contract/ } as const;

  const page = (pages: Page[], file: string): Page => {
    const found = pages.find((p) => p.file === file);
    expect(found, `${file} is not among the pages: ${pages.map((p) => p.file).join(', ')}`).toBeDefined();
    return found!;
  };
  const body = (p: Page): string => p.html.split('<main')[1]?.split('</main>')[0] ?? '';

  it('an alpha build writes it in both languages, under the key "guide"', async () => {
    const pages = await alphaBuild();
    for (const [locale, file] of Object.entries(GUIDE)) {
      const p = page(pages, file);
      expect(p.locale).toBe(locale);
      expect(p.key).toBe('guide');
    }
  });

  it('a build that is not for the alpha writes neither, and still writes the conditions', async () => {
    const pages = await buildFor(false);
    expect(pages.map((p) => p.file)).toEqual(expect.arrayContaining(['alpha.html', 'nl/alpha.html']));
    for (const file of Object.values(GUIDE)) {
      expect(pages.map((p) => p.file), `${file} is written without the alpha setting`).not.toContain(file);
    }
  });

  it('carries the six sections, in order, each a heading with its stable id', async () => {
    const pages = await alphaBuild();
    for (const [locale, ids] of Object.entries(SECTIONS)) {
      const html = body(page(pages, GUIDE[locale as keyof typeof GUIDE]));
      const found = [...html.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]);
      expect(found, `the ${locale} guide's sections`).toEqual([...ids]);
    }
  });

  it('links the Alpha conditions in its own language, and says it is not a contract', async () => {
    const pages = await alphaBuild();
    for (const [locale, file] of Object.entries(GUIDE)) {
      const html = body(page(pages, file));
      // `./alpha.html` beside the guide is the conditions in the same language:
      // `alpha.html` in English at the root, `nl/alpha.html` in Dutch.
      expect(html, `the ${locale} guide does not link the conditions`).toContain('href="./alpha.html"');
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      expect(text, `the ${locale} guide does not say it is not a contract`).toMatch(
        NOT_A_CONTRACT[locale as keyof typeof NOT_A_CONTRACT],
      );
    }
  });

  it('links nothing that does not answer: a page the alpha build writes, an app route, or the support address', async () => {
    const pages = await alphaBuild();
    const { APP_URL, SUPPORT_EMAIL } = (await import('./prices.mjs')) as unknown as {
      APP_URL: string;
      SUPPORT_EMAIL: string;
    };
    // The app's top-level routes, read from the route table as text.
    const routes = new Set(
      [...read('apps/web/src/AppRoutes.tsx').matchAll(/\bpath="(\/[^"]*)"/g)].map((m) => m[1]!),
    );
    expect(routes, 'AppRoutes.tsx no longer has the routes this reads').toContain('/request-access');
    const files = new Set(pages.map((p) => p.file));

    for (const file of Object.values(GUIDE)) {
      const html = body(page(pages, file));
      const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));
      const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
      expect(hrefs.length, `${file} links nothing, so this case would pass over nothing`).toBeGreaterThan(1);
      for (const href of hrefs) {
        const why = `${file} links ${href}`;
        if (href.startsWith('#')) {
          expect(ids.has(href.slice(1)), `${why}, an id the page does not have`).toBe(true);
        } else if (href.startsWith('mailto:')) {
          expect(href, `${why}, which is not the support address`).toBe(`mailto:${SUPPORT_EMAIL}`);
        } else if (href.startsWith(`${APP_URL}/`)) {
          const path = new URL(href).pathname;
          expect(routes.has(path), `${why}, and the app has no route ${path}`).toBe(true);
        } else if (/^[a-z]+:/i.test(href)) {
          throw new Error(`${why}: an address outside the site, the app and the support mailbox`);
        } else {
          // Relative to the page, as the site's nginx resolves it.
          const target = new URL(href, `https://site.invalid/${file}`).pathname.slice(1).replace(/#.*$/, '');
          expect(files.has(target), `${why}, a file the alpha build does not write`).toBe(true);
        }
      }
    }
  });

  it('is left out of the nav of every page, its own included', async () => {
    const pages = await alphaBuild();
    // The nav's links are root-relative: `/alpha-guide.html`, `/nl/alpha-handleiding.html`.
    const guideHrefs = Object.values(GUIDE).map((file) => `/${file}`);
    for (const p of pages) {
      // The header's nav and the phone's menu (0152 T2). The language switch
      // sits beside them, and is the one header link a page has to its own
      // other language, so the guide links the other guide there.
      const nav = [...p.html.matchAll(/<nav class="(?:site|menu)"[^>]*>([\s\S]*?)<\/nav>/g)].map((m) => m[1]!).join('');
      expect(nav, `${p.file} has no nav`).not.toBe('');
      const links = [...nav.matchAll(/<a (?![^>]*class="lang")[^>]*href="([^"]+)"/g)].map((m) => m[1]!);
      for (const href of guideHrefs) {
        expect(links, `${p.file} has the guide in its nav`).not.toContain(href);
      }
    }
  });

  it('the setting is the one the API and the web build read, and only "alpha" turns it on', () => {
    // In a child process, so the environment is the build's, as a deploy runs
    // it. --check renders to memory and lists every page it would write.
    const listed = (stage: string | undefined): string => {
      const env: NodeJS.ProcessEnv = { ...process.env, OWNPACE_APP_URL: 'https://app.ota.ownpace.eu' };
      delete env.OWNPACE_STAGE;
      if (stage !== undefined) env.OWNPACE_STAGE = stage;
      const r = spawnSync('node', [join(HERE, 'build.mjs'), '--check'], { env, encoding: 'utf8' });
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      return r.stdout;
    };
    for (const stage of ['alpha', ' Alpha ', 'ALPHA']) {
      const out = listed(stage);
      for (const file of Object.values(GUIDE)) {
        expect(out, `OWNPACE_STAGE=${JSON.stringify(stage)} does not render ${file}`).toContain(`  ${file} `);
      }
    }
    for (const stage of [undefined, '', 'beta', 'alpha2']) {
      const out = listed(stage);
      expect(out, `the vacuity check: ${JSON.stringify(stage)} renders the conditions`).toContain('  nl/alpha.html ');
      for (const file of Object.values(GUIDE)) {
        expect(out, `OWNPACE_STAGE=${JSON.stringify(stage)} renders ${file}`).not.toContain(`  ${file} `);
      }
    }
  });
});

describe('the call to action leads somewhere the service can answer', () => {
  /**
   * Until 2026-08-22 every "Request access" button on this site was a
   * `mailto:`, so the first step of becoming a customer was composing an email
   * in whatever client the visitor's browser opened, and the first record of
   * them was somebody's inbox. It now points at the app's request-access page
   * (workplan 0093).
   *
   * The form is on the APP and must stay there: this site is served with
   * `default-src 'none'; … form-action 'none'`, which is what makes it a
   * document rather than an application. A `<form>` appearing in these pages
   * would be broken by that CSP, silently — the browser refuses the submission
   * and nothing is logged anywhere the owner reads.
   */
  it('sends "request access" to the app, not to an inbox', async () => {
    const { rendered } = (await import('./build.mjs')) as unknown as {
      rendered: Array<{ file: string; html: string }>;
    };
    const { REQUEST_ACCESS_URL, SUPPORT_EMAIL } = (await import('./prices.mjs')) as unknown as {
      REQUEST_ACCESS_URL: string;
      SUPPORT_EMAIL: string;
    };

    const landings = rendered.filter((p) => /(^|\/)index\.html$/.test(p.file));
    expect(landings.length, 'no landing page was rendered').toBeGreaterThan(0);

    for (const page of landings) {
      expect(page.html, `${page.file}: the call to action no longer reaches the app`).toContain(
        REQUEST_ACCESS_URL,
      );
      // The footer's support address is a support address and stays. What must
      // not come back is a `mailto:` wearing a button.
      const buttons = [...page.html.matchAll(/<a class="btn[^"]*" href="([^"]+)"/g)].map(
        (m) => m[1]!,
      );
      expect(
        buttons.filter((href) => href.startsWith('mailto:')),
        `${page.file}: a call-to-action button is a mailto: again`,
      ).toEqual([]);
      expect(page.html, `${page.file}: the support address should still be in the footer`).toContain(
        SUPPORT_EMAIL,
      );
    }
  });

  it('has no form of its own, which its CSP would silently refuse to submit', async () => {
    const { rendered } = (await import('./build.mjs')) as unknown as {
      rendered: Array<{ file: string; html: string }>;
    };
    const nginx = read('deploy/compose/www-nginx.conf');
    expect(nginx, 'the site CSP no longer forbids form submission — check why').toContain(
      "form-action 'none'",
    );
    for (const page of rendered) {
      expect(page.html, `${page.file}: a <form> under form-action 'none' cannot submit`).not.toMatch(
        /<form[\s>]/,
      );
    }
  });
});

describe('the header is short, and no page is left without a link to it (workplan 0152 T2, T6 (c))', () => {
  /** The links of a page's header nav (`site`, on a wide screen) or its phone menu (`menu`). */
  const navLinks = (html: string, which: 'site' | 'menu') => {
    const nav = new RegExp(`<nav class="${which}"[^>]*>([\\s\\S]*?)</nav>`).exec(html)?.[1];
    expect(nav, `no <nav class="${which}">`).toBeDefined();
    return [...nav!.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => ({ href: m[1]!, text: m[2]! }));
  };

  it('lists Home, How it works, Pricing and Sign in, in both, on every page', async () => {
    const { SIGN_IN_URL, APP_URL } = (await import('./prices.mjs')) as unknown as {
      SIGN_IN_URL: string;
      APP_URL: string;
    };
    expect(SIGN_IN_URL, 'Sign in is built from the app this build is for').toBe(`${APP_URL}/login`);
    const expected: Record<string, string[]> = {
      en: ['Home', 'How it works', 'Pricing', 'Sign in'],
      nl: ['Home', 'Hoe het werkt', 'Prijzen', 'Aanmelden'],
    };
    for (const page of await renderedPages()) {
      const wide = navLinks(page.html, 'site');
      expect(wide.map((l) => l.text), `${page.file}: the header's pages`).toEqual(expected[page.locale]);
      expect(wide.at(-1)!.href, `${page.file}: Sign in goes to the app's sign-in`).toBe(SIGN_IN_URL);
      // The phone's menu is the same list, so neither can drift from the other.
      expect(navLinks(page.html, 'menu'), `${page.file}: the phone's menu differs from the header`).toEqual(wide);
      // The language switch stays in the header, outside the folded menu.
      expect(page.html, `${page.file}: no language switch in the header`).toMatch(
        /<\/nav>\s*<a class="lang" href="[^"]+" lang="(en|nl)">/,
      );
    }
  });

  it('keeps every page one link away: the estimate from pricing and home, Privacy and Terms from the footer', async () => {
    const pages = await renderedPages();
    const { COPY, localeRoot } = (await import('./copy.mjs')) as unknown as {
      COPY: Record<string, { files: Record<string, string> }>;
      localeRoot: (l: string) => string;
    };
    const href = (locale: string, key: string) => {
      const file = COPY[locale]!.files[key]!;
      return `${localeRoot(locale)}/${file === 'index.html' ? '' : file}`;
    };
    for (const locale of ['en', 'nl']) {
      const own = pages.filter((p) => p.locale === locale);
      const linksOn = (key: string) => {
        const html = own.find((p) => p.key === key)!.html;
        // Outside the header: a link a page carries in its body or its footer.
        const body = html.slice(html.indexOf('</header>'));
        return [...body.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]!);
      };
      expect(linksOn('pricing'), `${locale}: pricing has no button to the estimate`).toContain(href(locale, 'calculator'));
      expect(linksOn('home'), `${locale}: the home page's What it costs has no button to the estimate`).toContain(
        href(locale, 'calculator'),
      );
      for (const key of ['privacy', 'terms']) {
        expect(linksOn('home'), `${locale}: the footer lost ${key}`).toContain(href(locale, key));
      }
    }
  });
});

describe('the site is drawn in the logo’s colours', () => {
  it('uses the palette scripts/make-logo.py draws the mark in', () => {
    const build = read('site/build.mjs');
    const logo = read('scripts/make-logo.py');
    const teal = /const TEAL = '(#[0-9A-Fa-f]{6})'/.exec(build)?.[1];
    const mint = /const MINT = '(#[0-9A-Fa-f]{6})'/.exec(build)?.[1];
    expect(teal, 'site/build.mjs no longer declares TEAL').toBeDefined();
    expect(mint, 'site/build.mjs no longer declares MINT').toBeDefined();

    const asPy = (hex: string) =>
      `(0x${hex.slice(1, 3)}, 0x${hex.slice(3, 5)}, 0x${hex.slice(5, 7)})`.toUpperCase();
    expect(logo.toUpperCase(), 'the site teal is not the logo teal').toContain(asPy(teal!));
    expect(logo.toUpperCase(), 'the site mint is not the logo mint').toContain(asPy(mint!));
  });
});

/**
 * A LEGAL PAGE THAT SAYS IT IS A DRAFT IS NOT PUBLISHED (workplan 0139 T2).
 *
 * `--public` already refuses a page with an unfilled placeholder. It did not
 * refuse one with every placeholder filled whose *Version* line still read
 * "draft for legal review — not yet published": an indexable page saying of
 * itself that it is not published. The build now refuses that too, naming the
 * file, and reads the version line only, outside HTML comments.
 *
 * `--public --check` refuses it as well. A check before a deploy runs
 * `--public --check` and reads its placeholder count; when that check passed a
 * site the build then refused, the deploy learnt it only after the app had
 * moved (the review of 0139 T2).
 *
 * Run against a COPY of `site/` with fixture legal files, in a child process:
 * the refusal lives where the build is run directly, and the real texts carry
 * placeholders (which refuse first) and draft version lines on purpose until
 * the owner's final-text PR. A copy also keeps these builds out of the real
 * `site/dist`.
 */
describe('a public build refuses a legal page whose version line says draft', () => {
  const SITE = HERE;
  let copy = '';
  const LEGAL_DOCS = [
    ['privacy.md', 'Privacy policy', 'Version'],
    ['privacy.nl.md', 'Privacyverklaring', 'Versie'],
    ['terms.md', 'Terms of service', 'Version'],
    ['terms.nl.md', 'Servicevoorwaarden', 'Versie'],
  ] as const;

  /** A legal page with every placeholder filled, and the given version line. */
  const page = (title: string, versionLine: string, body = 'Contact: support@ownpace.eu.') =>
    `<!-- a fixture -->\n\n# ${title}\n\n${versionLine}\n**Last updated:** 2026-09-28\n\n## 1. Who\n\n${body}\n`;

  /** Writes all four legal files final, except the overrides. */
  function legal(overrides: Partial<Record<(typeof LEGAL_DOCS)[number][0], string>> = {}) {
    for (const [file, title, label] of LEGAL_DOCS) {
      writeFileSync(join(copy, 'legal', file), overrides[file] ?? page(title, `**${label}:** 2.0`));
    }
  }

  function build(opts: { public: boolean; check?: boolean }) {
    rmSync(join(copy, 'dist'), { recursive: true, force: true });
    const args = [...(opts.public ? ['--public'] : []), ...(opts.check ? ['--check'] : [])];
    const r = spawnSync('node', [join(copy, 'build.mjs'), ...args], {
      cwd: copy,
      env: {
        ...process.env,
        OWNPACE_APP_URL: opts.public ? 'https://app.ownpace.eu' : 'https://app.ota.ownpace.eu',
      },
      encoding: 'utf8',
    });
    return {
      status: r.status,
      out: `${r.stdout}\n${r.stderr}`,
      wrote: existsSync(join(copy, 'dist', 'index.html')),
    };
  }

  /** The two counts `--check` prints, read as a caller before a deploy reads them. */
  const counts = (out: string) => ({
    placeholders: /^\[site\] \d+ pages across \d+ locales, (\d+) unfilled placeholder\(s\)$/m.exec(out)?.[1],
    draftLines: /^\[site\] (\d+) legal page\(s\) marked draft on their version line/m.exec(out)?.[1],
  });

  beforeAll(() => {
    copy = realpathSync(mkdtempSync(join(tmpdir(), 'site-public-')));
    cpSync(SITE, copy, {
      recursive: true,
      filter: (src) => !src.split(sep).includes('dist') && !src.split(sep).includes('node_modules'),
    });
  });
  afterAll(() => {
    if (copy) rmSync(copy, { recursive: true, force: true });
  });

  it('builds --public when every version line is final, so the refusal is a check and not a ban', () => {
    legal();
    const r = build({ public: true });
    expect(r.status, r.out).toBe(0);
    expect(r.wrote).toBe(true);
    expect(readFileSync(join(copy, 'dist', 'robots.txt'), 'utf8')).toContain('Allow: /');
  });

  it('refuses --public for a draft version line, naming that file and writing nothing', () => {
    legal({ 'terms.nl.md': page('Servicevoorwaarden', '**Versie:** 2.0 (concept)') });
    const r = build({ public: true });
    expect(r.status, 'the build published a page that says it is a draft').not.toBe(0);
    expect(r.wrote, 'the refused build still wrote dist/').toBe(false);
    expect(r.out).toContain('site/legal/terms.nl.md');
    expect(r.out).toContain('**Versie:** 2.0 (concept)');
    for (const other of ['privacy.md', 'privacy.nl.md', 'site/legal/terms.md:']) {
      expect(r.out, `the refusal names ${other}, whose version line is final`).not.toContain(
        other.includes('/') ? other : `site/legal/${other}`,
      );
    }
  });

  it.each([
    ['draft', 'privacy.md', 'Privacy policy', '**Version:** 2.0 (Draft for legal review)'],
    ['concept', 'privacy.md', 'Privacy policy', '**Version:** 2.0 CONCEPT'],
    ['not yet published', 'privacy.md', 'Privacy policy', '**Version:** 2.0 (not yet published)'],
    ['nog niet gepubliceerd', 'privacy.nl.md', 'Privacyverklaring', '**Versie:** 2.0 (Nog niet gepubliceerd)'],
    ['ontwerp', 'privacy.nl.md', 'Privacyverklaring', '**Versie:** 2.0 (Ontwerpversie)'],
    ['voorlopig', 'privacy.nl.md', 'Privacyverklaring', '**Versie:** 2.0, voorlopig'],
  ] as const)('refuses --public when the version line says "%s", in any case', (_word, file, title, line) => {
    legal({ [file]: page(title, line) });
    const r = build({ public: true });
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain(`site/legal/${file}`);
  });

  it('reads the version line only: the word elsewhere on the page is not a draft', () => {
    legal({
      'privacy.md': page('Privacy policy', '**Version:** 2.0', 'This is not a draft, and no concept.'),
    });
    const r = build({ public: true });
    expect(r.status, r.out).toBe(0);
  });

  it("reads it outside HTML comments: a briefing's old draft line above the final one is not the page's", () => {
    // The lawyer's briefing is an HTML comment at the top of each document, and
    // may quote an earlier version line. The build must read the page's own.
    const briefing = '<!--\n  History, for the lawyer:\n  **Version:** 9 (draft for legal review)\n-->\n\n';
    legal({ 'privacy.md': briefing + page('Privacy policy', '**Version:** 2.0') });
    const r = build({ public: true });
    expect(r.status, `the build read a version line inside a comment\n${r.out}`).toBe(0);
    expect(r.wrote).toBe(true);
  });

  it('and a final-looking line in a comment does not hide a draft version line above it', () => {
    const below = '\n<!--\n**Version:** 2.0\n-->\n';
    legal({ 'privacy.md': page('Privacy policy', '**Version:** 2.0 (draft)') + below });
    const r = build({ public: true });
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain('site/legal/privacy.md: **Version:** 2.0 (draft)');
  });

  it('refuses --public for a legal page with no version line, since it cannot be told from a draft', () => {
    legal({ 'terms.md': page('Terms of service', '**Applies to:** the service') });
    const r = build({ public: true });
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain('site/legal/terms.md');
  });

  it('refuses a legal page in SOURCE that is not in the nav, as the conditions may be (0139 T10)', () => {
    // The build renders pages outside PAGE_KEYS (the 404 page). A legal
    // document added to SOURCE and rendered that way is still refused: the
    // refusal reads SOURCE's legal/ entries, not the nav's.
    const file = join(copy, 'build.mjs');
    const original = readFileSync(file, 'utf8');
    const patched = original.replace(
      /export const SOURCE = \{\n {2}en: \{/,
      "export const SOURCE = {\n  en: { alpha: 'legal/alpha.md',",
    );
    expect(patched, 'the fixture no longer finds SOURCE in site/build.mjs').not.toBe(original);
    const alpha = join(copy, 'legal', 'alpha.md');
    const alphaOriginal = readFileSync(alpha, 'utf8');
    try {
      writeFileSync(file, patched);
      writeFileSync(alpha, page('Alpha conditions', '**Version:** 0.2 (draft for legal review)'));
      legal();
      const r = build({ public: true });
      expect(r.status, r.out).not.toBe(0);
      expect(r.out).toContain('site/legal/alpha.md: **Version:** 0.2 (draft for legal review)');
    } finally {
      writeFileSync(file, original);
      writeFileSync(alpha, alphaOriginal);
    }
  });

  it('still builds a test site from drafts, since that is what a test host is for', () => {
    legal({
      'privacy.md': page('Privacy policy', '**Version:** 2.0 (draft)'),
      'terms.nl.md': page('Servicevoorwaarden', '**Versie:** 2.0 (concept)'),
    });
    const r = build({ public: false });
    expect(r.status, r.out).toBe(0);
    expect(r.wrote).toBe(true);
    expect(readFileSync(join(copy, 'dist', 'robots.txt'), 'utf8')).toContain('Disallow: /');
  });

  it('--public --check refuses what --public refuses: it counts the draft lines and exits non-zero', () => {
    legal({ 'terms.md': page('Terms of service', '**Version:** 2.0 (draft for legal review)') });
    const r = build({ public: true, check: true });
    expect(r.status, `--public --check passed a site --public refuses\n${r.out}`).not.toBe(0);
    expect(r.wrote, '--check wrote dist/').toBe(false);
    // The placeholder count is still printed, in the shape a caller reads.
    expect(counts(r.out), r.out).toEqual({ placeholders: '0', draftLines: '1' });
    expect(r.out).toContain('site/legal/terms.md: **Version:** 2.0 (draft for legal review)');
  });

  it('--public --check passes with every version line final, and says 0', () => {
    legal();
    const r = build({ public: true, check: true });
    expect(r.status, r.out).toBe(0);
    expect(counts(r.out), r.out).toEqual({ placeholders: '0', draftLines: '0' });
    // The placeholder count stays the last line, where a caller is told to look.
    expect(r.out.trim().split('\n').at(-1)).toMatch(/unfilled placeholder\(s\)$/);
  });

  it('--check without --public counts the draft lines and passes, as a test build does', () => {
    legal({ 'privacy.nl.md': page('Privacyverklaring', '**Versie:** 2.0 (concept)') });
    const r = build({ public: false, check: true });
    expect(r.status, r.out).toBe(0);
    expect(counts(r.out).draftLines, r.out).toBe('1');
    expect(r.out).toContain('site/legal/privacy.nl.md');
  });

  it("refuses today's real texts on their version lines, once their placeholders are filled", () => {
    // The owner's final-text PR removes the words. Until then --public refuses
    // every one of the four, which is intended: they say "not yet published".
    for (const [file] of LEGAL_DOCS) {
      const real = read(`site/legal/${file}`).replace(/«[A-Z_]+»/g, 'filled');
      writeFileSync(join(copy, 'legal', file), real);
    }
    const r = build({ public: true });
    expect(r.status, r.out).not.toBe(0);
    for (const [file] of LEGAL_DOCS) expect(r.out).toContain(`site/legal/${file}`);
    // And --public --check says so before a deploy, where it used to report
    // `0 unfilled placeholder(s)` and pass.
    const check = build({ public: true, check: true });
    expect(check.status, check.out).not.toBe(0);
    expect(counts(check.out), check.out).toEqual({ placeholders: '0', draftLines: '4' });
  });
});
