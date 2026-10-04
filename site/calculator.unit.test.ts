// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The pre-preflight calculator, guarded (workplan 0088 T3+T5, 0090 T5).
 *
 * Three layers, cheapest first:
 *
 *  1. **The arithmetic** — `calculator.mjs` is imported directly, so the code
 *     tested here is byte-for-byte the code `build.mjs` inlines into the
 *     page. The load-bearing case is ADR-0014's own: one migration and
 *     400 GB is Small, because size says so — the single most likely way
 *     this calculator could lie is showing only the migration count.
 *  2. **The hash** — the page's CSP allows exactly one inline script, pinned
 *     by sha256 in `deploy/compose/www-nginx.conf` (owner decision
 *     2026-08-26, shape (a)). A drifted hash does not error; it serves a
 *     perfectly rendered, perfectly dead calculator. So the drift is a red
 *     test naming the file to fix.
 *  3. **The words** — the honesty surface (T5) and the vocabulary rules are
 *     grep-guarded on the RENDERED pages, so a later edit cannot quietly
 *     drop the band, the version, the cannot-know line, or write
 *     "concurrent" on a customer surface.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  GMAIL_IMAP_GB_PER_DAY,
  band,
  deriveTier,
  fill,
  gmailMailDays,
  money,
  topUpAgainstStepUp,
  freeTier,
  migrationsFrom,
  sizeOf,
} from './calculator.mjs';
import { OBJECT_TYPES, PROFILES_VERSION, SIZE_ASKED, pathsFor } from './profiles.mjs';
import { GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY } from '../packages/shared/src/rate-budget.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

// The same guard-rail as site.unit.test.ts: prices.mjs refuses to resolve
// APP_URL without being told which app this build is for.
process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
const { rendered, CALC_SCRIPT, calcOffers } = await import('./build.mjs');
const { TIERS } = await import('./prices.mjs');

const calcPages = rendered.filter((p: { file: string }) =>
  ['estimate.html', 'nl/schatting.html'].includes(p.file),
);

describe('the tier derivation — two axes, higher wins', () => {
  it("pins ADR-0014's own worked example: one migration and 400 GB is Small", () => {
    const d = deriveTier(TIERS, 1, 400);
    expect(d.tier?.name).toBe('Small');
    expect(d.decidedBy).toBe('data');
  });

  it('lets the migration axis decide when it is the higher one', () => {
    const d = deriveTier(TIERS, 16, 40);
    expect(d.tier?.name).toBe('Medium');
    expect(d.decidedBy).toBe('paths');
  });

  it('says both when the axes agree', () => {
    const d = deriveTier(TIERS, 1, 100);
    expect(d.tier?.name).toBe('Free');
    expect(d.decidedBy).toBe('both');
  });

  it('answers "talk to us" past the end of the table, never a guessed tier', () => {
    expect(deriveTier(TIERS, 500, 100).tier).toBeNull();
    expect(deriveTier(TIERS, 1, 999_999).tier).toBeNull();
  });
});

describe('several sources at once (the owner, 2026-10-04)', () => {
  const offers = calcOffers() as Record<string, Record<string, string>>;

  it('counts one migration per type per source, as the app makes them: Google and Dropbox both with files are two', () => {
    const made = migrationsFrom(offers, ['google', 'dropbox'], ['mail', 'contacts', 'calendar', 'files']);
    expect(made.groups).toEqual([
      { from: 'google', types: ['mail', 'contacts', 'calendar', 'files'], migrations: 4 },
      { from: 'dropbox', types: ['files'], migrations: 1 },
    ]);
    expect(made.perAccount).toBe(5);
    expect(made.uncounted).toEqual([]);
  });

  it('moves photos a source keeps among its files with Files, and Google Photos as its own (Takeout)', () => {
    expect(migrationsFrom(offers, ['dropbox'], ['files', 'photos'])).toMatchObject({ perAccount: 1, uncounted: [] });
    expect(migrationsFrom(offers, ['microsoft'], ['photos'])).toMatchObject({ perAccount: 1, uncounted: [] });
    expect(migrationsFrom(offers, ['google'], ['files', 'photos'])).toMatchObject({ perAccount: 2, uncounted: [] });
    // A whole Google move is six: four kinds, files, and the Takeout's photos.
    expect(migrationsFrom(offers, ['google'], [...OBJECT_TYPES]).perAccount).toBe(6);
  });

  it('counts nothing a source does not let go of, and says which type that left out', () => {
    // iCloud Drive and iCloud Photos do not move (the Leaving page says why).
    const apple = migrationsFrom(offers, ['apple'], ['mail', 'files', 'photos']);
    expect(apple).toMatchObject({ perAccount: 1, uncounted: ['files', 'photos'] });
    // Dropbox keeps no mail, so mail from Dropbox alone is no migration at all.
    expect(migrationsFrom(offers, ['dropbox'], ['mail'])).toEqual({ groups: [], perAccount: 0, uncounted: ['mail'] });
    // No source ticked is no migration, and nothing to blame on a source.
    expect(migrationsFrom(offers, [], ['mail'])).toEqual({ groups: [], perAccount: 0, uncounted: ['mail'] });
  });

  it('reads what each source brings off the Leaving pages, and takes anything from somewhere else', () => {
    const brings = (from: string) => Object.keys(offers[from]!).sort();
    expect(brings('google')).toEqual(['calendar', 'contacts', 'files', 'mail', 'photos', 'tasks']);
    expect(brings('microsoft')).toEqual(['calendar', 'contacts', 'files', 'mail', 'photos', 'tasks']);
    expect(offers.microsoft!.photos).toBe('files');
    expect(brings('apple')).toEqual(['calendar', 'contacts', 'mail', 'tasks']);
    expect(brings('dropbox')).toEqual(['files', 'photos']);
    expect(brings('box')).toEqual(['files', 'photos']);
    expect(brings('other')).toEqual([...OBJECT_TYPES].sort());
  });

  it("agrees with profiles.mjs's pathsFor where one source keeps every type", () => {
    for (const [who, accounts] of [['individual', 1], ['family', 4], ['sme', 10]] as const) {
      const types = ['mail', 'contacts', 'calendar', 'tasks', 'files'];
      expect(accounts * migrationsFrom(offers, ['other'], types).perAccount).toBe(pathsFor(who, types));
    }
  });

  it('offers every source the Leaving pages send here, Box included (0152 T7 (d))', () => {
    for (const page of calcPages) {
      const boxes = [...page.html.matchAll(/<input type="checkbox" name="from" value="([a-z]+)"/g)].map((m) => m[1]);
      expect(boxes, page.file).toEqual(['google', 'microsoft', 'apple', 'dropbox', 'box', 'other']);
      expect(Object.keys(offers).sort()).toEqual([...boxes].sort());
    }
  });
});

describe('the band and the ceiling', () => {
  it('is ±50%, rounded outward — a band that excludes the truth defeats itself', () => {
    expect(band(100)).toEqual({ low: 50, high: 150 });
    expect(band(38.1)).toEqual({ low: 19, high: 58 });
  });

  it("derives Gmail's minimum days from the verified 2.5 GB/day ceiling (0090 T5)", () => {
    expect(GMAIL_IMAP_GB_PER_DAY).toBe(2.5);
    expect(gmailMailDays(8)).toBe(4);
    expect(gmailMailDays(160)).toBe(64);
    expect(gmailMailDays(0.5)).toBe(1);
    expect(gmailMailDays(0)).toBe(0);
  });

  /**
   * ONE CEILING, SAID TWICE (workplan 0154 T3 (a)). The page's script cannot
   * import the workspace, so it states Gmail's ceiling itself; the app's time
   * before start reads `packages/shared`'s. A day the two differ, the site and
   * the review screen promise a mailbox different numbers of days.
   */
  it('is the ceiling the app reads, in the same decimal gigabytes', () => {
    expect(GMAIL_IMAP_GB_PER_DAY * 1_000_000_000).toBe(GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY);
  });
});

describe('the top-up against the step-up — break-even shown, nobody steered', () => {
  it("prices Small's top-up at its monthly, once, against Medium's €7 a month more: even after about 22 days", () => {
    // The owner's answer (b), 2026-10-03: a top-up costs the tier's monthly
    // price, once. There is no setup fee left to pay again on a step up.
    const small = TIERS.find((t) => t.id === 'small')!;
    const medium = TIERS.find((t) => t.id === 'medium')!;
    const vs = topUpAgainstStepUp(small, medium)!;
    expect(vs.topUpOnce).toBe(500);
    expect(vs.stepUpMonthlyMore).toBe(700);
    expect(vs.breakEvenDays).toBe(22);
    expect(money(vs.topUpOnce)).toBe('€5');
  });

  it('has no comparison to offer past the last tier', () => {
    expect(topUpAgainstStepUp(TIERS[TIERS.length - 1]!, undefined)).toBeNull();
  });

  it('offers a free tier no top-up: it would cost nothing and make the data axis mean nothing (ADR-0014, 2026-09-24)', () => {
    const free = TIERS.find((t) => t.id === 'free')!;
    const small = TIERS.find((t) => t.id === 'small')!;
    expect(freeTier(free)).toBe(true);
    expect(freeTier(small)).toBe(false);
    // Without this, the page would say: "On Free: free once buys another
    // 250 GB …", a top-up that makes the data axis mean nothing.
    expect(topUpAgainstStepUp(free, small)).toBeNull();
    // Every paid tier keeps its comparison.
    for (const [i, t] of TIERS.slice(0, -1).entries()) {
      if (!freeTier(t)) expect(topUpAgainstStepUp(t, TIERS[i + 1])).not.toBeNull();
    }
  });
});

describe('the one script, the one hash', () => {
  it('renders on both locale pages, byte-identical — one hash for one conf line', () => {
    expect(calcPages).toHaveLength(2);
    for (const p of calcPages) {
      expect((p as { html: string }).html).toContain(`<script>${CALC_SCRIPT}</script>`);
    }
  });

  it("matches the sha256 pinned in www-nginx.conf — drift kills the calculator silently, so it fails loudly here", () => {
    const conf = readFileSync(join(HERE, '..', 'deploy', 'compose', 'www-nginx.conf'), 'utf8');
    const pinned = /script-src 'sha256-([A-Za-z0-9+/=]+)'/.exec(conf);
    expect(pinned, 'www-nginx.conf pins no script hash at all').not.toBeNull();
    const actual = createHash('sha256').update(CALC_SCRIPT).digest('base64');
    expect(
      pinned![1],
      'The inline script changed: re-pin $csp_calc in deploy/compose/www-nginx.conf to the new hash',
    ).toBe(actual);
  });

  it('pins the hash for exactly the two calculator locations, and form-action stays none everywhere', () => {
    const conf = readFileSync(join(HERE, '..', 'deploy', 'compose', 'www-nginx.conf'), 'utf8');
    expect(conf).toContain('location = /estimate.html');
    expect(conf).toContain('location = /nl/schatting.html');
    // Every CSP variant this file serves keeps submissions off.
    for (const m of conf.matchAll(/set \$csp_\w+ "([^"]+)"/g)) {
      expect(m[1]).toContain("form-action 'none'");
      expect(m[1]).toContain("default-src 'none'");
    }
    // script-src appears in the calculator policy and nowhere else.
    expect(conf.match(/script-src/g)).toHaveLength(1);
  });

  it('every location that sets its own headers restates the CSP — the inheritance trap, pinned', () => {
    // nginx add_header inheritance: a location that adds ANY header inherits
    // NONE. Until 2026-08-26 the CSP sat only at server level while every
    // location set Cache-Control — so no served page carried it at all.
    //
    // This read `conf.split(/location[^{]+\{/)` and took each body as far as
    // its first `}`, and both halves of that were wrong in the same direction:
    // quietly, by examining LESS.
    //
    //   - `location[^{]+\{` matched the word "location" in this file's own
    //     header comment — the paragraph describing the trap — and ran to the
    //     next `{`, so the server block arrived as a phantom sixth location.
    //   - `indexOf('}')` ends a body at the first closing brace, which is the
    //     NESTED one in a location holding a `limit_except` or an `if`. Put
    //     such a block above the headers and the body ends before any
    //     `add_header` is seen, the test's own filter skips the location, and
    //     a location serving three headers and NO Content-Security-Policy is
    //     green. Proved by mutation before this was changed.
    //
    // So the blocks are brace-matched, and an opener has to be the first word
    // on its line and carry its brace on that same line. The two assertions
    // above the loop are the rest of it: this test SKIPS a block that sets no
    // header, so a list that came back empty or short would assert nothing
    // while reading exactly like a thorough check. The count is what catches
    // the phantom — restoring the old regex fails it, 6 against 5.
    const conf = readFileSync(join(HERE, '..', 'deploy', 'compose', 'www-nginx.conf'), 'utf8');
    const blocks = locationBlocks(conf);
    const directiveLines = conf.split('\n').filter((l) => /^[ \t]*location\b/.test(l)).length;

    expect(
      blocks.length,
      'the location parse and the file disagree about how many locations there are, so at ' +
        'least one block is not being examined at all',
    ).toBe(directiveLines);
    const setting = blocks.filter(({ body }) => /add_header/.test(body));
    expect(
      setting.length,
      'not one location sets a header, which is not what this file looks like — the parse is ' +
        'returning bodies that are empty or truncated, and the loop below would assert nothing',
    ).toBeGreaterThan(0);

    for (const { directive, body } of setting) {
      expect(body, `${directive} sets headers but drops the Content-Security-Policy`).toContain(
        'Content-Security-Policy',
      );
    }
  });
});

describe('the words the page must and must not say (T5, grep-guarded)', () => {
  it('carries the honesty surface on both locales', () => {
    for (const p of calcPages as Array<{ file: string; html: string }>) {
      // Bands, never single numbers, with the rung's accuracy stated.
      expect(p.html).toContain('50%');
      // A visible version and date — a quoted estimate gets screenshotted.
      expect(p.html).toContain(`v${PROFILES_VERSION.version}, ${PROFILES_VERSION.date}`);
      // The line about what it cannot know.
      expect(p.html).toMatch(/preflight verifies|voorcontrole verifieert/);
      // Bill-goes-down, and its floor, in the same breath.
      expect(p.html).toMatch(/sets a floor|legt een bodem/);
      // The ceiling sentence machinery (0090 T5) is in the shipped script.
      expect(p.html).toContain('gmailMailDays');
      // Editable assumptions: an input per size a person can read off a
      // storage page, and none for the ones nobody can (the owner, 2026-10-04).
      for (const t of SIZE_ASKED) expect(p.html).toContain(`id="gb-${t}"`);
      for (const t of OBJECT_TYPES.filter((o) => !(SIZE_ASKED as readonly string[]).includes(o))) {
        expect(p.html, `a size field for ${t}, which nobody can read off a storage page`).not.toContain(`id="gb-${t}"`);
      }
      expect(p.html).toContain('id="small-line"');
    }
  });

  it('never writes "concurrent" and never publishes a per-migration-per-month figure', () => {
    for (const p of calcPages as Array<{ file: string; html: string }>) {
      expect(p.html.toLowerCase()).not.toContain('concurrent');
      expect(p.html.toLowerCase()).not.toContain('per path per month');
      expect(p.html.toLowerCase()).not.toContain('gelijktijdig');
    }
  });

  it('is a calculator, not a plan selector: no tier is offered as a choice', () => {
    for (const p of calcPages as Array<{ file: string; html: string }>) {
      // The tier card exists once, empty, filled by derivation — the page has
      // no per-tier buttons or radio group naming tiers.
      expect(p.html).not.toMatch(/name="tier"/);
      expect(p.html).toMatch(/never picked|nooit gekozen/);
    }
  });
});

describe('sizeOf (0152 T7 (c))', () => {
  it('writes GB below 1 TB, as the fields summed it', () => {
    expect(sizeOf(38.3)).toBe('38.3 GB');
    expect(sizeOf(999.9)).toBe('999.9 GB');
  });

  it('writes TB to one decimal from 1 TB up, where it used to print every digit', () => {
    expect(sizeOf(1000)).toBe('1 TB');
    expect(sizeOf(1234.5)).toBe('1.2 TB');
    expect(sizeOf(7500)).toBe('7.5 TB');
    expect(sizeOf(15050)).toBe('15.1 TB');
  });
});

describe('fill', () => {
  it('replaces positional placeholders and leaves unknown ones empty', () => {
    expect(fill('{0} of {1}', 3, 'four')).toBe('3 of four');
    expect(fill('{0} and {2}', 'a', 'b')).toBe('a and ');
  });
});

/**
 * The `location` blocks of an nginx config, brace-matched.
 *
 * Two rules, and each replaces a way the previous regex examined less than it
 * appeared to:
 *
 *   - **The opener is one line, and it is the start of one.** `location[^{]+\{`
 *     matched the word "location" in this file's own header comment — the
 *     paragraph explaining the trap — and ran across four more lines to
 *     `server {`, handing the test the server block as a phantom sixth
 *     location: six matches against five directives, measured. Two things stop
 *     that here and EITHER WOULD DO ON ITS OWN, also measured: `^[ \t]*`, since
 *     an nginx comment is `#` to end of line so a directive is the first word
 *     or it is prose, and `[^{\n]*`, since a directive and its brace are on one
 *     line. The anchor states what a directive IS; the newline bar keeps the
 *     match local. A rule worth two sentences is worth stating twice.
 *   - **The body runs to the MATCHING brace**, not the first one. A location
 *     holding a `limit_except` or an `if` has a nested `}` inside it, and
 *     ending there drops every directive that follows — silently, because a
 *     shorter body simply fails fewer tests.
 *
 * Unbalanced braces throw. A config this cannot parse is a config nothing has
 * checked, and that must be loud rather than empty.
 */
function locationBlocks(conf: string): ReadonlyArray<{ readonly directive: string; readonly body: string }> {
  const blocks: Array<{ directive: string; body: string }> = [];
  for (const opener of conf.matchAll(/^[ \t]*(location\b[^{\n]*)\{/gm)) {
    const from = opener.index + opener[0].length;
    let i = from;
    let depth = 1;
    while (i < conf.length && depth > 0) {
      const c = conf[i++]!;
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth !== 0) {
      throw new Error(
        `www-nginx.conf: no closing brace for \`${opener[1]!.trim()}\`. The file does not parse, ` +
          'so nothing below has been checked — fix the config rather than this test.',
      );
    }
    blocks.push({ directive: opener[1]!.trim(), body: conf.slice(from, i - 1) });
  }
  return blocks;
}
