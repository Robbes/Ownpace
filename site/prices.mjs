// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The published price list — ONE copy, and this is it.
 *
 * WHY IT LIVES HERE AND NOT IN `packages/managed`. Workplan 0088 T4 asks for a
 * drift guard between the page and the invoice, and it cannot be an import:
 * `site/` deliberately depends on nothing in the workspace, which is what lets
 * the public pages be split out later without a migration (workplan 0086 T7).
 * So the numbers are copied and the COPY IS GUARDED — `site/prices.unit.test.ts`
 * reads ADR-0014's own table and fails if this file disagrees with it.
 *
 * That direction is deliberate. ADR-0014 is where the decision was taken and
 * amended eight times in one day; a page that quietly quotes a price the ADR no
 * longer says is the exact failure the guard exists to stop, and it is visible
 * to a customer rather than to us.
 *
 * Money is in whole euro because every published price is. If a price ever
 * needs cents, change this to integer cents and fix the formatter — do not
 * introduce a float.
 */

/** @typedef {{ id: string, name: string, who: string, paths: number, dataGb: number, setup: number, monthly: number, note: string }} Tier */

/** Bytes are quoted in whole GB up to 1 TB and in TB above it. */
export const GB_PER_TB = 1000;

/** @type {Tier[]} */
export const TIERS = [
  {
    id: 'tiny',
    name: 'Tiny',
    who: 'One person, one thing at a time',
    paths: 1,
    dataGb: 250,
    setup: 4,
    monthly: 2,
    note: 'Move your mail, then your contacts, then your calendar, then your files — one after another. The patient option, and the cheapest.',
  },
  {
    id: 'small',
    name: 'Small',
    who: 'One person, everything at once',
    paths: 4,
    dataGb: 750,
    setup: 8,
    monthly: 4,
    note: 'Everything you own, moving at the same time. Most people who are leaving one provider for another want this one.',
  },
  {
    id: 'medium',
    name: 'Medium',
    who: 'A household, a team, or a small business',
    paths: 20,
    dataGb: 2 * GB_PER_TB,
    setup: 15,
    monthly: 8,
    note: 'Five people with everything, or four with room to spare. Self-service, with a manual and somewhere to ask questions.',
  },
  {
    id: 'large',
    name: 'Large',
    who: 'An SME',
    paths: 50,
    dataGb: 7.5 * GB_PER_TB,
    setup: 50,
    monthly: 39,
    note: 'Where a real person gets involved: planning, the cutover, and someone to call when a provider does something strange.',
  },
  {
    id: 'xl',
    name: 'Extra large',
    who: 'An organisation, or an MSP',
    paths: 200,
    dataGb: 15 * GB_PER_TB,
    setup: 150,
    monthly: 99,
    note: 'Many accounts, one migration, one relationship.',
  },
];

/** Past the published scale we look at the actual case before quoting. */
export const BEYOND = {
  paths: 200,
  dataGb: 15 * GB_PER_TB,
  what: 'Talk to us',
};

export const SUPPORT_EMAIL = 'support@ownpace.eu';

/**
 * Where the site's call to action sends somebody (workplan 0093 T4).
 *
 * The FIRST environment-dependent value in the site build, which until now
 * needed none: every page is a self-contained document and every link is
 * relative. The environment is a domain LEVEL (workplan 0091), so the test
 * site must point at the test app or a visitor to `www.ota.ownpace.eu` is
 * handed production — which is precisely the boundary 0091 T4 exists to make
 * real. Set `OWNPACE_APP_URL=https://app.ota.ownpace.eu` when building that
 * site; production is the default because a forgotten variable should land on
 * the safe side of that boundary rather than the surprising one.
 *
 * Trailing slashes are stripped so the joined path cannot come out doubled.
 */
export const APP_URL = (process.env.OWNPACE_APP_URL || 'https://app.ownpace.eu').replace(/\/+$/, '');

/** The page a visitor asks for an account on. Invite-only: asking is not signing up. */
export const REQUEST_ACCESS_URL = `${APP_URL}/request-access`;

/** @param {number} euro */
export const money = (euro) => `€${euro}`;

/** @param {number} gb */
export const size = (gb) => (gb >= GB_PER_TB ? `${gb / GB_PER_TB} TB` : `${gb} GB`);

/**
 * The first month is setup + one month, and every later month is the monthly.
 * Published totals are derived here rather than typed, so they cannot drift
 * from the two columns beside them — which is the defect ADR-0014 found in its
 * own table on the day it was written.
 * @param {Tier} tier @param {number} months
 */
export const total = (tier, months) => tier.setup + tier.monthly * months;

/** @param {Tier} tier */
export const firstMonth = (tier) => tier.setup + tier.monthly;
