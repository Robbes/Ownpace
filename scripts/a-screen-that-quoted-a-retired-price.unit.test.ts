// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The customer's usage screen quoted a price list nothing would bill them at,
 * in a unit its own file already knew was wrong (workplan 0121 T4).
 *
 * TWO DEFECTS, ONE SCREEN, AND NEITHER WAS A BROKEN CALCULATION.
 *
 * 1. **A retired model, itemised and totalled.** `GET /api/billing/usage`
 *    served `calculateCost` — base fee, per-GB storage and egress, per-hour
 *    compute, VAT, a total — and the screen laid it out as line items summing
 *    to a bold blue number. ADR-0014 replaced metered billing with five tiers
 *    on 2026-08-20, and on 2026-08-27 this same API started REFUSING to mint
 *    an invoice from the old model (`no-bill-we-do-not-sell.ts`, a 409). So
 *    the product would not put that arithmetic on a bill, and did put it on
 *    the customer's screen, where it read exactly like one.
 *
 * 2. **Decimal GB in one half of the file, binary in the other.** The route
 *    file defines `BYTES_PER_GB = 1_000_000_000` — "a price list is not
 *    binary" — and `/usage/history` uses it. `/usage`, three hundred lines
 *    up, divided by 1024³. Same screen, same tenant, same bytes: the current
 *    month rendered ~7% smaller than the months beside it, and smaller than
 *    the figure that decides which tier the tenant is on. Neither number was
 *    wrong on its own. That is why it survived review twice.
 *
 * WHAT REPLACED IT, AND THE RULE THAT SHAPES IT: the tier, with the evidence
 * that decided it. Derived through `observedTier` and never `currentTier` —
 * the latter performs T2's documented true-up, which WRITES the peak it is
 * about to read, because it runs at a moment that prices something. A
 * customer opening their own usage screen prices nothing. 0109 T4 made that
 * rule for the operator's screen; this holds the tenant's own to it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const BILLING_ROUTES = 'apps/api/src/routes/billing/index.ts';
const USAGE_HISTORY = 'apps/api/src/services/usage-history.ts';
const INVOICE_GEN = 'apps/api/src/services/invoice-generation.ts';
const WEB_SCHEMA = 'apps/web/src/services/billing-service.ts';
const WEB_SCREEN = 'apps/web/src/pages/Billing.tsx';

/**
 * The handler under test, sliced out so a match elsewhere cannot pass for it,
 * and stripped of COMMENTS.
 *
 * The stripping is not tidiness. Without it this guard failed on its own
 * subject: the handler carries a paragraph explaining why `currentCost` and
 * `calculateCost` were removed, and a guard that reads prose would forbid
 * naming the very defect it exists to prevent — so the only way to keep it
 * green would be to delete the explanation. Guards read code.
 */
function usageHandler(): string {
  const src = read(BILLING_ROUTES);
  const start = src.indexOf("router.get('/usage',");
  const end = src.indexOf("router.get('/usage/history'", start);
  expect(start, `${BILLING_ROUTES} no longer declares GET /usage`).toBeGreaterThan(-1);
  expect(end, `${BILLING_ROUTES} no longer declares GET /usage/history`).toBeGreaterThan(start);
  return src
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('a screen that quoted a retired price', () => {
  it('no billing surface converts bytes to GB in BINARY', () => {
    // 1024³ written any of the three ways a hurried edit reaches for.
    const binary = /1024\s*\*\s*1024\s*\*\s*1024|1024\s*\*\*\s*3|1073741824/;
    const offenders = [BILLING_ROUTES, USAGE_HISTORY, INVOICE_GEN].filter((f) =>
      binary.test(read(f)),
    );
    expect(
      offenders,
      'these files divide bytes by 1024³. A price list is not binary: ADR-0014 and the tier ' +
        'calculator publish decimal GB ("1 TB = 1000 GB, the site\'s convention"), so a binary ' +
        'divisor here shows the customer a number ~7% smaller than the one that prices them.',
    ).toEqual([]);
  });

  it('all three readers of these bytes agree on the divisor, to the digit', () => {
    const divisors = [BILLING_ROUTES, USAGE_HISTORY, INVOICE_GEN].map((f) => {
      const m = /BYTES_PER_GB\s*=\s*([0-9_]+)/.exec(read(f));
      expect(m, `${f} no longer declares BYTES_PER_GB`).not.toBeNull();
      return Number(m![1]!.replace(/_/g, ''));
    });
    expect(
      new Set(divisors).size,
      `the three copies disagree: ${divisors.join(', ')}. They read the SAME bytes for the ` +
        'same tenant and render them on the same screen.',
    ).toBe(1);
    expect(divisors[0], 'decimal GB, per ADR-0014').toBe(1_000_000_000);
  });

  it('the usage read derives the tier WITHOUT writing — observedTier, never currentTier', () => {
    const handler = usageHandler();
    expect(handler).toContain('observedTier');
    expect(
      handler,
      'currentTier performs the true-up: it WRITES this month\'s peak before reading it, ' +
        'because it runs at a moment that prices something. A customer opening their own ' +
        'usage screen prices nothing, and must not move a billing mark by looking.',
    ).not.toMatch(/currentTier|recordCurrentOccupancy/);
  });

  it('the usage read serves no metered money at all', () => {
    const handler = usageHandler();
    expect(
      handler,
      'GET /usage is serving a metered cost again. ADR-0014 retired that model on ' +
        '2026-08-20 and this API refuses to invoice from it (409, 0109 T0) — so putting it ' +
        'on the customer\'s screen quotes a euro figure nothing will ever charge them.',
    ).not.toMatch(/calculateCost|currentCost/);
    expect(handler, 'the tier is what replaced it, and it must actually be served').toContain(
      'tier:',
    );
  });

  it('the client parses the tier and no longer parses a cost breakdown', () => {
    const schema = read(WEB_SCHEMA);
    expect(schema).toContain('TierSchema');
    expect(
      schema,
      'the response schema still declares currentCost. A field the server no longer sends ' +
        'fails the parse and blanks the whole screen.',
    ).not.toMatch(/^\s*currentCost:/m);
  });

  it("the tier's whole EUROS are scaled before a formatter that takes CENTS", () => {
    const screen = read(WEB_SCREEN);
    for (const field of ['setup', 'monthly']) {
      expect(
        screen,
        `Billing.tsx passes tier.${field} to currency() unscaled. ADR-0014's table is in ` +
          'whole euros (Medium is `setup: 15`) and formatCurrency takes cents, so this ' +
          `prints a HUNDREDTH of the real price on the line a customer buys from.`,
      ).toMatch(new RegExp(`currency\\(\\s*usage\\.tier\\.${field}\\s*\\*\\s*100`));
    }
  });

  it('every string the tier block renders exists in BOTH languages', () => {
    const screen = read(WEB_SCREEN);
    const strings = read('apps/web/src/i18n/strings.ts');
    const keys = [...screen.matchAll(/t\('(billing\.(?:tier|yourTier)[A-Za-z]*)'\)/g)].map(
      (m) => m[1]!,
    );
    expect(keys.length, 'the tier block renders no translated strings at all').toBeGreaterThan(4);
    for (const key of new Set(keys)) {
      const declared = strings.split(`'${key}':`).length - 1;
      expect(
        declared,
        `${key} is declared ${declared} time(s); it needs one per language (en + nl). ` +
          'A missing Dutch entry renders the key itself to a Dutch-speaking customer.',
      ).toBe(2);
    }
  });
});
