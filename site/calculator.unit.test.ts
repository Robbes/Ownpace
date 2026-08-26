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
  topUpAgainstStepUp,
} from './calculator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// The same guard-rail as site.unit.test.ts: prices.mjs refuses to resolve
// APP_URL without being told which app this build is for.
process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
const { rendered, CALC_SCRIPT } = await import('./build.mjs');
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
    expect(d.tier?.name).toBe('Tiny');
    expect(d.decidedBy).toBe('both');
  });

  it('answers "talk to us" past the end of the table, never a guessed tier', () => {
    expect(deriveTier(TIERS, 500, 100).tier).toBeNull();
    expect(deriveTier(TIERS, 1, 999_999).tier).toBeNull();
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
});

describe('the top-up against the step-up — break-even shown, nobody steered', () => {
  it("pins ADR-0014's Small example: €1 more up front, €4 a month saved, back in about a week", () => {
    const small = TIERS.find((t) => t.id === 'small')!;
    const medium = TIERS.find((t) => t.id === 'medium')!;
    const vs = topUpAgainstStepUp(small, medium)!;
    expect(vs.topUpOnce).toBe(8);
    expect(vs.stepUpNow).toBe(7);
    expect(vs.stepUpMonthlyMore).toBe(4);
    expect(vs.extraUpFront).toBe(1);
    expect(vs.paybackDays).toBe(8);
  });

  it('has no comparison to offer past the last tier', () => {
    expect(topUpAgainstStepUp(TIERS[TIERS.length - 1]!, undefined)).toBeNull();
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
    const conf = readFileSync(join(HERE, '..', 'deploy', 'compose', 'www-nginx.conf'), 'utf8');
    const locations = conf.split(/location[^{]+\{/).slice(1);
    for (const block of locations) {
      const body = block.slice(0, block.indexOf('}'));
      if (/add_header/.test(body)) {
        expect(body, 'a location sets headers but drops the Content-Security-Policy').toContain(
          'Content-Security-Policy',
        );
      }
    }
  });
});

describe('the words the page must and must not say (T5, grep-guarded)', () => {
  it('carries the honesty surface on both locales', () => {
    for (const p of calcPages as Array<{ file: string; html: string }>) {
      // Bands, never single numbers, with the rung's accuracy stated.
      expect(p.html).toContain('50%');
      // A visible version and date — a quoted estimate gets screenshotted.
      expect(p.html).toContain('v1, 2026-08-26');
      // The line about what it cannot know.
      expect(p.html).toMatch(/preflight verifies|voorcontrole verifieert/);
      // Bill-goes-down, and its floor, in the same breath.
      expect(p.html).toMatch(/sets a floor|legt een bodem/);
      // The ceiling sentence machinery (0090 T5) is in the shipped script.
      expect(p.html).toContain('gmailMailDays');
      // Editable assumptions: an input per object type.
      expect(p.html).toContain('id="gb-mail"');
      expect(p.html).toContain('id="gb-photos"');
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

describe('fill', () => {
  it('replaces positional placeholders and leaves unknown ones empty', () => {
    expect(fill('{0} of {1}', 3, 'four')).toBe('3 of four');
    expect(fill('{0} and {2}', 'a', 'b')).toBe('a and ');
  });
});
