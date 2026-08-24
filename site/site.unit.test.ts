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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// `prices.mjs` refuses to resolve APP_URL without being told which app it is
// building for, and `build.mjs` imports it at load. Set before any dynamic
// import below — a default here would put back the thing the refusal removes.
process.env.OWNPACE_APP_URL = 'https://app.ota.ownpace.eu';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');

/** Parse ADR-0014's own tier table — the source this file is guarded against. */
function tiersFromAdr(): Map<string, { paths: number; data: string; setup: number; monthly: number }> {
  const adr = read('docs/adr/0014-cost-recovery-billing.md');
  const rows = adr
    .split('\n')
    .filter((l) => /^\|\s*\*\*(Tiny|Small|Medium|Large|Extra large)\*\*/.test(l));
  expect(rows.length, 'ADR-0014 no longer has a five-row tier table').toBe(5);

  const out = new Map<string, { paths: number; data: string; setup: number; monthly: number }>();
  for (const row of rows) {
    const c = row
      .split('|')
      .slice(1, -1)
      .map((x) => x.trim());
    // | tier | who | paths | data | setup | monthly | first month | typical |
    const name = c[0]!.replace(/\*\*/g, '');
    out.set(name.toLowerCase(), {
      paths: Number(c[2]),
      data: c[3]!,
      setup: Number(c[4]!.replace(/[^0-9]/g, '')),
      monthly: Number(c[5]!.replace(/[^0-9]/g, '')),
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
      expect(t.setup, `${where} on the setup fee`).toBe(a!.setup);
      expect(t.monthly, `${where} on the monthly`).toBe(a!.monthly);
      // The ADR writes "750 GB" / "2 TB"; size() must produce the same string.
      expect(size(t.dataGb), `${where} on the data ceiling`).toBe(a!.data);
    }
  });

  it('derives the first month rather than restating it', async () => {
    const { TIERS, firstMonth, total } = await import('./prices.mjs');
    for (const t of TIERS) {
      expect(firstMonth(t)).toBe(t.setup + t.monthly);
      expect(total(t, 3)).toBe(t.setup + t.monthly * 3);
    }
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
    for (const f of ['privacy', 'terms']) {
      const en = read(`site/legal/${f}.md`);
      const nl = read(`site/legal/${f}.nl.md`);
      // Section numbering is kept identical on purpose, so the two can be
      // diffed when either changes. Compare the count of `## N.` headings.
      const count = (s: string) => (s.match(/^## \d+\./gm) ?? []).length;
      expect(count(nl), `${f}.nl.md has a different number of numbered sections`).toBe(count(en));
    }
  });
});

describe('the renderer covers what the documents actually use', () => {
  it('leaves no Markdown unrendered in any built page', async () => {
    const { rendered } = (await import('./build.mjs')) as unknown as {
      rendered: Array<{ file: string; html: string }>;
    };
    for (const page of rendered) {
      const body = page.html.split('<main')[1] ?? '';
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
