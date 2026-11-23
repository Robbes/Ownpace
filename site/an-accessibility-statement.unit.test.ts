// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN ACCESSIBILITY STATEMENT THAT IS THERE, SAYS WHAT IT AIMS FOR, NAMES A
 * PERSON TO WRITE TO, AND IS NOT OLD (workplan 0145 T9 (b)).
 *
 * An outside, read-only check of this repository found no accessibility
 * statement. A statement counts only if a reader can find it, says which
 * standard and level it aims for, says where to report a barrier, and has been
 * reviewed within a year. So this holds, on the site the build really writes:
 *
 * - the statement is rendered in every language the site is built in, and the
 *   two pages are each other's language switch;
 * - every page's footer links the statement in the page's own language;
 * - each names a WCAG version and a level (*WCAG 2.2*, level *AA*);
 * - each names the support address the site publishes (`SUPPORT_EMAIL`,
 *   `site/prices.mjs`) as a link, in the page itself and not only the footer;
 * - each says when it was last reviewed, both languages say the same day, and
 *   that day is at most twelve months before the day the tests run. The last
 *   rule goes red on its own a year after the date: that is the point. The
 *   fix is to review the statement again, and move the date in both texts.
 */

import { describe, it, expect } from 'vitest';
// The build asks which app its buttons reach; the OTA's, as `site.unit.test.ts` sets it.
// Set before `prices.mjs` loads, which reads it at load: so that import is dynamic.
process.env.OWNPACE_APP_URL ??= 'https://app.ota.ownpace.eu';
const { SUPPORT_EMAIL } = (await import('./prices.mjs')) as unknown as { SUPPORT_EMAIL: string };

interface Page {
  readonly locale: string;
  readonly key: string;
  readonly file: string;
  readonly html: string;
}

const KEY = 'accessibility';

/**
 * The line a statement says its review date on, per language, as the legal
 * pages write *Last updated* / *Laatst bijgewerkt*: an ISO date.
 */
const REVIEWED: Record<string, string> = { en: 'Last reviewed:', nl: 'Laatst nagekeken:' };

async function rendered(): Promise<Page[]> {
  const { rendered } = (await import('./build.mjs')) as unknown as { rendered: Page[] };
  expect(rendered.length, 'the build rendered no pages').toBeGreaterThan(0);
  return rendered;
}

/** The languages the site is built in, from the build itself (every one has a home page). */
async function locales(): Promise<string[]> {
  return [...new Set((await rendered()).filter((p) => p.key === 'home').map((p) => p.locale))].sort();
}

/** The statement in one language, or a failure that says which is missing. */
async function statement(locale: string): Promise<Page> {
  const page = (await rendered()).find((p) => p.locale === locale && p.key === KEY);
  expect(page, `the site build renders no accessibility statement in "${locale}" (page key "${KEY}")`).toBeDefined();
  return page!;
}

/** What is between <main> and </main>: the statement's own words, without the footer. */
const mainOf = (html: string): string => html.slice(html.indexOf('<main'), html.indexOf('</main>'));

/** The address a page is served at, as an href on the site: `/x.html`, `/nl/x.html`. */
const hrefOf = (file: string): string => `/${file}`;

/** The day a statement says it was last reviewed, read from its text without tags. */
function reviewedOn(page: Page): Date {
  const label = REVIEWED[page.locale];
  expect(label, `no review-date line known for "${page.locale}"; add it to REVIEWED`).toBeDefined();
  const text = mainOf(page.html).replace(/<[^>]+>/g, '');
  const m = new RegExp(`${label}\\s*(\\d{4})-(\\d{2})-(\\d{2})\\b`).exec(text);
  expect(m, `${page.file} says no "${label} YYYY-MM-DD" line`).not.toBeNull();
  const [, year, month, day] = m!;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  expect(date.toISOString().slice(0, 10), `${page.file}: "${m![0]}" is not a real day`).toBe(`${year}-${month}-${day}`);
  return date;
}

describe('the accessibility statement (0145 T9 (b))', () => {
  it('is rendered in every language the site is built in', async () => {
    const langs = await locales();
    expect(langs.length, 'the build rendered no home page, so it is not known which languages to hold').toBeGreaterThan(1);
    for (const locale of langs) await statement(locale);
  });

  it("each language's statement is the other's language switch", async () => {
    const langs = await locales();
    for (const locale of langs) {
      const page = await statement(locale);
      for (const other of langs.filter((l) => l !== locale)) {
        const there = await statement(other);
        expect(page.html, `${page.file} does not switch to ${there.file}`).toContain(
          `class="lang" href="${hrefOf(there.file)}"`,
        );
      }
    }
  });

  it("every page's footer links the statement in its own language", async () => {
    const pages = await rendered();
    for (const page of pages) {
      const target = await statement(page.locale);
      const footer = page.html.slice(page.html.lastIndexOf('<footer'));
      expect(footer, `${page.file}: no footer`).toMatch(/^<footer/);
      expect(footer, `${page.file}: the footer does not link ${target.file}`).toContain(`href="${hrefOf(target.file)}"`);
    }
  });

  it('names the WCAG version and the level it aims for', async () => {
    for (const locale of await locales()) {
      const main = mainOf((await statement(locale)).html);
      expect(main, `${locale}: no WCAG version (WCAG 2.x)`).toMatch(/WCAG 2\.\d/);
      expect(main, `${locale}: no conformance level (A, AA or AAA)`).toMatch(/(?:level|niveau) A{1,3}\b/i);
    }
  });

  it('names the published support address, as a link, in the statement itself', async () => {
    expect(SUPPORT_EMAIL).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/);
    for (const locale of await locales()) {
      const main = mainOf((await statement(locale)).html);
      expect(main, `${locale}: the statement does not link mailto:${SUPPORT_EMAIL}`).toContain(`href="mailto:${SUPPORT_EMAIL}"`);
    }
  });

  it('was reviewed within the last twelve months, on the same day in every language', async () => {
    const today = new Date();
    const yearAgo = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));
    const days = new Set<string>();
    for (const locale of await locales()) {
      const page = await statement(locale);
      const day = reviewedOn(page);
      days.add(day.toISOString().slice(0, 10));
      expect(day.getTime(), `${page.file}: the review date is in the future`).toBeLessThanOrEqual(today.getTime());
      expect(
        day.getTime(),
        `${page.file} was last reviewed on ${day.toISOString().slice(0, 10)}, more than twelve months ago. ` +
          'Review the statement against the open rows of workplans 0145 and 0159, and move the date in both languages.',
      ).toBeGreaterThanOrEqual(yearAgo.getTime());
    }
    expect([...days], 'the languages give different review dates').toHaveLength(1);
  });
});
