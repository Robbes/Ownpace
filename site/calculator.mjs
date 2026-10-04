// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The pre-preflight's arithmetic (workplan 0088 T3) — every number the
 * calculator page shows is computed by a function in this file, nowhere else.
 *
 * TESTED ONCE, EMBEDDED VERBATIM. `site/calculator.unit.test.ts` imports this
 * module and pins the behaviour; `site/build.mjs` reads this file AS TEXT,
 * strips the `export ` keywords, and inlines it into the calculator page's
 * one script. So the code that runs in the visitor's browser is byte-for-byte
 * the code the tests exercised — the same guarded-copy discipline as
 * `prices.mjs`, applied to logic. Which is why this file must stay dependency-
 * free and browser-safe: no imports, no Node APIs, nothing above ES2020.
 *
 * The page's CSP allows exactly this script by hash (owner decision
 * 2026-08-26, shape (a) of the T3 fork): nothing external, nothing submitted,
 * and a change here that forgets to re-pin the hash turns a unit test red
 * rather than silently killing the calculator.
 */

/**
 * The tier the inputs land on — DERIVED, never picked (ADR-0014: the visitor
 * never chooses a tier; the page computes it and says so).
 *
 * Two axes, and you are on the higher of them: the smallest tier whose
 * migrations-at-the-same-time capacity fits `paths` AND whose data band fits
 * `gb`. One migration and 400 GB is Small, because size says so.
 *
 * `decidedBy` names the axis that forced the answer — the page highlights it,
 * because a page that shows only the migration count quotes the wrong tier
 * for every photo-heavy visitor (the single most likely way this calculator
 * could lie). 'both' when the axes agree on the same tier.
 *
 * Returns `{ tier: null }` past the end of the table: there the published
 * answer is "talk to us", deliberately — past the scale we look at the actual
 * case rather than quote.
 *
 * @param {Array<{id:string,name:string,paths:number,dataGb:number,monthly:number,annual:number}>} tiers
 * @param {number} paths
 * @param {number} gb
 * @returns {{ tier: (typeof tiers)[number] | null, decidedBy: 'paths' | 'data' | 'both' }}
 */
export function deriveTier(tiers, paths, gb) {
  const byPaths = tiers.findIndex((t) => t.paths >= paths);
  const byData = tiers.findIndex((t) => t.dataGb >= gb);
  if (byPaths === -1 || byData === -1) {
    return { tier: null, decidedBy: byPaths === -1 ? (byData === -1 ? 'both' : 'paths') : 'data' };
  }
  const i = Math.max(byPaths, byData);
  return {
    tier: tiers[i],
    decidedBy: byPaths === byData ? 'both' : byPaths > byData ? 'paths' : 'data',
  };
}

/**
 * The migrations a person's answers make (the owner, 2026-10-04: several
 * sources at once). The app makes one migration per data type per source
 * account (ADR-0014's unit, 0153 T4), so Google and Dropbox both with files
 * are two. `offers` says, per source, the migration each ticked type travels
 * in: usually itself, Files for photos a source keeps among its files, and
 * nothing for a type it does not keep or that cannot move (`build.mjs` reads
 * it off the Leaving pages' verdicts).
 *
 * Returns the sources that bring anything, in the order given, each with the
 * ticked types it brings and how many migrations they make; the migrations
 * per account; and the ticked types no source brings.
 *
 * @param {Record<string, Record<string, string>>} offers
 * @param {ReadonlyArray<string>} sources
 * @param {ReadonlyArray<string>} types
 * @returns {{ groups: Array<{ from: string, types: string[], migrations: number }>, perAccount: number, uncounted: string[] }}
 */
export function migrationsFrom(offers, sources, types) {
  const groups = [];
  for (const from of sources) {
    const carries = offers[from] ?? {};
    const brought = types.filter((t) => typeof carries[t] === 'string');
    const kinds = new Set(brought.map((t) => carries[t]));
    if (brought.length > 0) groups.push({ from, types: brought, migrations: kinds.size });
  }
  return {
    groups,
    perAccount: groups.reduce((n, g) => n + g.migrations, 0),
    uncounted: types.filter((t) => !groups.some((g) => g.types.includes(t))),
  };
}

/**
 * Rung 1 is a band, never a number (workplan 0088, the three rungs: this rung
 * answers at ±50%, and says so). Rounded outward — a band that excludes the
 * true value on the pessimistic side defeats its own honesty.
 *
 * @param {number} gb
 * @returns {{ low: number, high: number }}
 */
export function band(gb) {
  return { low: Math.floor(gb * 0.5), high: Math.ceil(gb * 1.5) };
}

/**
 * Gmail's IMAP download ceiling in GB per day — the number workplan 0090 is
 * named after, verified from Google's own bandwidth-limits page (0090 T1,
 * 2026-08-26): 2 500 MB of IMAP download per account per day, equal across
 * app passwords and XOAUTH2. Decimal megabytes, the smaller reading — being
 * wrong about Google's arithmetic must err toward quoting MORE days, never
 * fewer.
 */
export const GMAIL_IMAP_GB_PER_DAY = 2.5;

/**
 * The fewest days Gmail's ceiling allows for this much mail (0090 T5): a
 * duration derived from the provider's PUBLISHED CEILING, not from bandwidth
 * — and the page says which, because each rung replaces a guess with a
 * measurement and says which it is.
 *
 * @param {number} mailGb
 * @returns {number} whole days, at least 1 for any mail at all
 */
export function gmailMailDays(mailGb) {
  if (!(mailGb > 0)) return 0;
  return Math.max(1, Math.ceil(mailGb / GMAIL_IMAP_GB_PER_DAY));
}

/**
 * The one decision on the page a visitor could get wrong, priced honestly
 * (ADR-0014: at the data ceiling, offer BOTH ways out and show the
 * break-even; we do not steer).
 *
 * Topping up buys another whole data band on the SAME tier for that tier's
 * monthly price, once (the owner's answer (b), 2026-10-03). Stepping up to the
 * next tier costs the difference in monthly from then on; there is no setup
 * fee to pay again. So the top-up is the cheaper way out for anyone who will
 * keep going longer than `breakEvenDays`, and stepping up is cheaper for
 * anyone who will stop sooner.
 *
 * Prices are integer cents, as `prices.mjs` keeps them.
 *
 * @param {{monthly:number,annual:number}} tier
 * @param {{monthly:number,annual:number}=} next absent past the last tier
 * @returns {{ topUpOnce: number, stepUpMonthlyMore: number, breakEvenDays: number } | null}
 */
export function topUpAgainstStepUp(tier, next) {
  // A free tier has no top-up: it would cost its monthly, nothing, and make
  // the data axis meaningless. Past its band it is the next tier (ADR-0014).
  if (!next || freeTier(tier)) return null;
  const stepUpMonthlyMore = next.monthly - tier.monthly;
  return {
    topUpOnce: tier.monthly,
    stepUpMonthlyMore,
    breakEvenDays: Math.ceil((tier.monthly / stepUpMonthlyMore) * 30),
  };
}

/**
 * A tier that costs nothing (Free, since 2026-09-24): nothing a month, nothing
 * a year, and no invoice. Every page says "free" for it and never a zero
 * amount, which reads as a price that could be billed.
 *
 * @param {{monthly:number,annual:number}} tier
 */
export function freeTier(tier) {
  return tier.monthly === 0 && tier.annual === 0;
}

/**
 * Integer cents as the site writes a price: whole euros bare (`€5`), anything
 * else with its two decimals (`€2.50`). Never a float in, never a rounding
 * out: a price that is not whole cents is a broken price, and says so.
 *
 * @param {number} cents
 */
export function money(cents) {
  if (!Number.isInteger(cents)) throw new Error('a price must be whole cents, not ' + cents);
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return '\u20ac' + euros + (rest === 0 ? '' : '.' + (rest < 10 ? '0' : '') + rest);
}

/**
 * A size as the page writes it: GB below 1 TB, and TB to one decimal from 1 TB
 * up (workplan 0152 T7 (c)). The page sums its fields to a tenth of a GB, so
 * 1,234.5 GB read "1.2345 TB". Sizes are decimal, as the site publishes them
 * (1 TB = 1,000 GB).
 *
 * @param {number} gb
 */
export function sizeOf(gb) {
  return gb >= 1000 ? Math.round(gb / 100) / 10 + ' TB' : gb + ' GB';
}

/**
 * Fill a copy template: `{n}` placeholders by position, text only. The page
 * writes every computed string with `textContent`, so nothing here needs —
 * or gets — an escaping pass; a template that carried markup would be the
 * first step toward one.
 *
 * @param {string} template @param {...(string|number)} values
 */
export function fill(template, ...values) {
  return template.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? ''));
}
