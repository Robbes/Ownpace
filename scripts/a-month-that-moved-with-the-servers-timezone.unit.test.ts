// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FOUR PLACES DECIDED WHICH MONTH A MOMENT BELONGED TO, AND THREE OF THEM
 * ASKED THE SERVER WHERE IT WAS STANDING (found 2026-09-09).
 *
 * `occupancy_peak.month` is documented in migration 0015 as *"First day of the
 * calendar month, UTC"*, and `PgOccupancyPeakStore.forMonth` honours that with
 * `Date.UTC`. Three other places computed the same month a different way, and
 * every one of them moved with a timezone nothing in this codebase sets — the
 * database session's, or the Node process's, so in practice whatever the
 * appliance was installed with. On the deployment this product actually ships
 * to, a Dutch appliance, all three were wrong for the last hour or two of every
 * month:
 *
 *  - the peak writer filed a 30 September activation under 1 October, so one
 *    invoice missed its evidence and the next quoted a date from the month
 *    before;
 *  - the operator's `support_tenant_usage` view read a different month from
 *    the customer's own screen — the two screens showing one number, one of
 *    which exists to catch the other being wrong;
 *  - the history screen grouped a run into a month whose UTC window then
 *    excluded it, so a month with passes in it came back empty.
 *
 * And in Node, `/api/billing/usage` built the last day of the month from the
 * LOCAL clock (`getFullYear`/`getMonth`), naming 29 September as September's
 * last day east of Greenwich — while `/api/billing/usage/history`, a hundred
 * lines below in the same file, did it in UTC under a comment stating the rule.
 *
 * Not one of the four was wrong on its own reading; each is an ordinary way to
 * get a month. The defect existed only between them, and only at a boundary,
 * which is why nothing found it.
 *
 * ## What this pins
 *
 * THE SWEEP, which is the half that catches a site nobody has written yet:
 * every month expression in the shipped SQL and TypeScript must pin the zone.
 * The two exceptions carry a reason, and each reason is CHECKED rather than
 * trusted — an exception whose justification stops being true fails here.
 *
 * The other half — that those expressions, executed at month boundaries under
 * four session timezones, actually agree — lives in
 * `packages/ledger/src/a-month-that-moved-with-the-servers-timezone.unit.test.ts`,
 * because running the SQL needs PGlite and PGlite is a dependency of that
 * package alone. Text can prove the pin is present; only execution proves it
 * works, and this defect is precisely the kind that reads correct.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Tracked files only — the same listing `lessons.mjs` builds on. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

/** Whole-line comments removed; see the ledger guard for why this matters. */
function source(rel: string): string {
  return read(rel)
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/^[ \t]*(--|\/\/).*$/gm, '');
}

/** The pin every month expression over an instant has to carry. */
const PIN = "AT TIME ZONE 'UTC'";

/**
 * A call to `fn(...)` mentioning `needle`, matched to its own closing bracket
 * through one level of nesting — enough for `now()` and for `(month)::date`,
 * which is every shape in the tree. A flat `[^)]*` stops at the first inner
 * bracket and captures half an expression, which then fails to match its own
 * entry in EXCEPTIONS for reasons that look nothing like the real cause.
 */
const NESTED_ONCE = (fn: string, needle: string): RegExp =>
  new RegExp(`${fn}\\((?:[^()]|\\([^()]*\\))*${needle}(?:[^()]|\\([^()]*\\))*\\)`, 'g');

/** An expression found by the sweep, with where it was found. */
interface Found {
  readonly file: string;
  readonly expression: string;
}

/**
 * Every expression in the tree that turns an instant into a month.
 *
 * `date_trunc('month', …)` and `to_char(…, 'YYYY-MM')` are the two ways this
 * codebase does it. Both render a `timestamptz` in the SESSION's timezone.
 */
function monthExpressions(): Found[] {
  const found: Found[] = [];
  for (const file of trackedFiles()) {
    const isSql = file.endsWith('.sql');
    const isSource =
      /^(packages|apps)\/[^/]+\/src\//.test(file) &&
      file.endsWith('.ts') &&
      !/\.(unit|integration|e2e|ui)\.test\.ts$/.test(file);
    if (!isSql && !isSource) continue;
    const text = source(file);
    for (const [expression] of text.matchAll(NESTED_ONCE('date_trunc', "'month'"))) {
      found.push({ file, expression });
    }
    for (const [expression] of text.matchAll(NESTED_ONCE('to_char', "'YYYY-MM'"))) {
      found.push({ file, expression });
    }
  }
  return found;
}

/**
 * The expressions that do NOT carry the pin, and why each is nonetheless
 * right. Both reasons are verified below — an allow-list nobody re-checks is
 * how a rule quietly stops being one.
 */
const EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  [
    "packages/managed/migrations/0017_the_tier_is_visible_before_the_invoice.sql::date_trunc('month', now())",
    'superseded: a later migration redefines this view WITH the pin, and an applied migration is a record of what ran, not something to edit',
  ],
  [
    "packages/managed/migrations/0015_the_month_remembers_its_peak.sql::date_trunc('month'::text, (month)::timestamp with time zone)",
    'the argument is the `month` DATE column, not an instant: date -> local midnight -> truncate -> date is the identity in any one session, so this CHECK means "the first of a month" wherever it runs',
  ],
]);

const key = (f: Found) => `${f.file}::${f.expression}`;

describe('every month expression pins the zone', () => {
  const all = monthExpressions();

  it('the sweep finds something to check', () => {
    // A sweep that matches nothing passes silently and guards nothing.
    expect(all.length).toBeGreaterThanOrEqual(5);
    expect(all.some((f) => f.file.startsWith('apps/api/'))).toBe(true);
    expect(all.some((f) => f.file.endsWith('.sql'))).toBe(true);
  });

  it('every one of them either carries the pin or is a checked exception', () => {
    const unpinned = all.filter((f) => !f.expression.includes(PIN));
    const unexplained = unpinned.filter((f) => !EXCEPTIONS.has(key(f)));
    expect(
      unexplained.map(key),
      `A month expression over a timestamptz renders in the session's timezone. ` +
        `Add ${PIN}, or an entry in EXCEPTIONS saying why this one is different.`,
    ).toEqual([]);
  });

  it('no exception is left standing after the expression it excuses is gone', () => {
    const present = new Set(all.map(key));
    // An exception for something no longer in the tree is a rule with a hole
    // waiting for a coincidence to fall into it.
    expect([...EXCEPTIONS.keys()].filter((k) => !present.has(k))).toEqual([]);
  });
});

describe('and each exception is true, not just written down', () => {
  it('0017 is superseded by a later definition that does carry the pin', () => {
    const VIEW = 'support_tenant_usage';
    const definitions = trackedFiles()
      .filter((f) => f.startsWith('packages/managed/migrations/') && f.endsWith('.sql'))
      .filter((f) => new RegExp(`CREATE OR REPLACE VIEW public\\.${VIEW}\\b`).test(read(f)))
      .sort();
    // Migrations apply in filename order, so the last one defining the view is
    // the definition the database actually ends up with.
    expect(definitions.length, `no migration defines ${VIEW}`).toBeGreaterThan(1);
    const current = definitions[definitions.length - 1]!;
    expect(current).not.toContain('0017_');
    const join = /AND p\.month = ([^\n]*)/.exec(source(current));
    expect(join, `${current} defines ${VIEW} but no longer joins on the month`).not.toBeNull();
    expect(join![1]).toContain(PIN);
  });

  it("0015's exception really is a date column and not an instant", () => {
    const table = source('packages/managed/migrations/0015_the_month_remembers_its_peak.sql');
    // The reason holds only because `month` is a DATE. Were it ever widened to
    // a timestamptz, the CHECK would start moving with the session zone and
    // this exception would be excusing a live defect.
    expect(table).toMatch(/\n\s*month date NOT NULL,/);
    expect(table).toContain("date_trunc('month'::text, (month)::timestamp with time zone)::date");
  });
});

describe('the Node side of the same rule', () => {
  /**
   * Where a billing period may be built. Deliberately not repo-wide: rendering
   * a date for a person to read SHOULD use their local clock, and a rule that
   * forbade `getMonth()` everywhere would be wrong about most of the tree.
   */
  const BILLING = [
    'apps/api/src/routes/billing/index.ts',
    'packages/managed/src/usage-metering.ts',
    'packages/managed/src/occupancy-peak.ts',
  ];

  it('no billing period is built from the local clock', () => {
    for (const file of BILLING) {
      expect(source(file), `${file} reads the server's local clock`).not.toMatch(
        /\.get(FullYear|Month|Date)\(\)/,
      );
    }
  });

  it('the two usage handlers ask monthPeriod rather than each computing one', () => {
    const billing = source('apps/api/src/routes/billing/index.ts');
    expect((billing.match(/monthPeriod\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The shape of the original defect: a second, independent derivation of
    // the same month living in the same file as the first.
    expect(billing).not.toMatch(/new Date\(Date\.UTC\([^)]*\)\)\.toISOString\(\)\.slice\(0, 10\)/);
  });
});
