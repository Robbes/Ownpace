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
 * @param {Array<{id:string,name:string,paths:number,dataGb:number,setup:number,monthly:number}>} tiers
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
 * break-even; taking no profit means having no reason to steer).
 *
 * Topping up buys another whole data band on the SAME tier for that tier's
 * setup fee. Stepping up to the next tier costs the DIFFERENCE in setup now
 * and the difference in monthly from then on (step-ups charge only the
 * difference). `extraUpFront` is what the top-up costs beyond the step-up's
 * up-front difference; divided by the monthly saving it pays back in
 * `paybackDays`. Negative `extraUpFront` means the top-up is cheaper from the
 * first euro — no break-even to wait for.
 *
 * @param {{setup:number,monthly:number}} tier
 * @param {{setup:number,monthly:number}=} next absent past the last tier
 * @returns {{ topUpOnce: number, stepUpNow: number, stepUpMonthlyMore: number, extraUpFront: number, paybackDays: number | null } | null}
 */
export function topUpAgainstStepUp(tier, next) {
  if (!next) return null;
  const stepUpNow = next.setup - tier.setup;
  const stepUpMonthlyMore = next.monthly - tier.monthly;
  const extraUpFront = tier.setup - stepUpNow;
  const paybackDays =
    extraUpFront > 0 && stepUpMonthlyMore > 0
      ? Math.ceil((extraUpFront / stepUpMonthlyMore) * 30)
      : extraUpFront <= 0
        ? 0
        : null;
  return { topUpOnce: tier.setup, stepUpNow, stepUpMonthlyMore, extraUpFront, paybackDays };
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
