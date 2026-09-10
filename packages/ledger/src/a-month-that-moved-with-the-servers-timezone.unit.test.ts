// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * FOUR PLACES DECIDED WHICH MONTH A MOMENT BELONGED TO, AND THREE OF THEM
 * ASKED THE SERVER WHERE IT WAS STANDING (found 2026-09-09).
 *
 * `occupancy_peak.month` is documented, in migration 0015, as *"First day of
 * the calendar month, UTC"*. `PgOccupancyPeakStore.forMonth` honours that: it
 * computes the month with `Date.UTC` and gets the same answer on every
 * machine. Three other sites computed the same month a different way, and each
 * of the three moved with whatever timezone the database session or the Node
 * process happened to have — which nothing in this codebase sets, so it is
 * whatever the appliance was installed with. Measured on PGlite:
 *
 *  - **The writer.** `date_trunc('month', <instant>::timestamptz)::date`
 *    truncates in the SESSION's timezone. In `Europe/Amsterdam` an activation
 *    at 2026-09-30T23:30Z was filed under `2026-10-01`. September's invoice
 *    then missed the peak that was its evidence, and October's quoted a date
 *    in September.
 *  - **The operator's view** (`support_tenant_usage`) joined on
 *    `date_trunc('month', now())::date`, so at that same instant the
 *    operator's screen and the customer's screen read different months — of
 *    the two screens showing one number, the one whose whole purpose is to
 *    catch a wrong number before a customer does.
 *  - **The history screen** grouped runs with `to_char(created_at, 'YYYY-MM')`,
 *    which renders a `timestamptz` in the session's timezone. That run was
 *    named `2026-10`, and `monthPeriod('2026-10')` asks for `[Oct 1, Nov 1)`
 *    in UTC — which it is not in. The month named it and the window excluded
 *    it, so a September with passes came back as zeroes or as no row at all.
 *
 * And in the Node process, `/api/billing/usage` built the last day of the
 * month from `getFullYear()`/`getMonth()` — the LOCAL clock — while
 * `/api/billing/usage/history`, a hundred lines below in the same file, built
 * it from `Date.UTC` under a comment stating the rule. East of Greenwich the
 * first named 29 September as September's last day, so `billingWindow` was
 * handed `[Sep 1, Sep 30)` and the whole of the 30th went uncounted:
 * reintroducing, one layer up, exactly the missing last day that function
 * exists to prevent.
 *
 * Not one of the four was wrong on its own reading. Every one of them is a
 * perfectly ordinary way to get a month. The defect lived only in the fact
 * that they disagreed, and only for the last hour or two of a month — which is
 * why nothing found it.
 *
 * ## What this pins, and why each part earns its place
 *
 *  - **The expressions are read out of the shipped files and EXECUTED**, at
 *    boundary instants, under four session timezones. Not matched as text: an
 *    assertion that the file contains a string cannot tell a correct
 *    expression from a widened one that still contains it.
 *  - **The pre-fix form of each is executed too, and must DIVERGE.** The
 *    mutation is derived mechanically from the shipped text — delete the
 *    `AT TIME ZONE 'UTC'` — so this is the "proved by breaking" step made
 *    permanent instead of something done once at a desk. If a future refactor
 *    makes the fixed and broken forms agree, the proof has gone hollow and
 *    this says so.
 *  - **The three-argument `date_trunc(field, ts, zone)` is shown to be a
 *    trap.** It looks like the obvious simplification and is measurably worse:
 *    it returns midnight UTC as a `timestamptz`, and casting THAT to `date`
 *    re-applies the session zone, so west of Greenwich it yields the last day
 *    of the PREVIOUS month — not even the first of a month.
 *  - **Nothing is allowed to pass vacuously.** Every extraction asserts it
 *    matched. A site renamed out of this file's reach fails here rather than
 *    quietly dropping out of the sweep.
 *
 * ## Why this file lives in `packages/ledger`
 *
 * It reads `packages/managed` and `apps/api`, so by subject it belongs in
 * neither. It is here because PGlite is a dependency of this package and of no
 * other, and the whole value of the test is that the SQL actually runs.
 * `migrate-upgrade.unit.test.ts` reaches across the same way and for the same
 * reason.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { monthPeriod } from '@openmig/managed';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/ledger/src -> repo root
const ROOT = resolve(HERE, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The file with its whole-line comments taken out.
 *
 * Every extraction below runs on this, not on the raw text, because a guard
 * that reads source is competing with the prose explaining that source — and
 * the prose quotes the very expression the guard is looking for. The first run
 * of this file matched migration 0024's own comment, which quotes the BEFORE
 * form to explain the fix, and went red against the shipped view that was
 * perfectly correct. That is the third time in this repository a guard has
 * matched its own explanation, so it is written down here rather than
 * rediscovered a fourth time.
 *
 * Whole lines only — a line whose first non-blank characters are the comment
 * marker. A strip that ran to the end of any line carrying one would cut into
 * string literals that happen to contain it.
 */
function source(rel: string): string {
  return read(rel)
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/^[ \t]*(--|\/\/).*$/gm, '');
}

const VIEW_SQL = 'packages/managed/migrations/0024_one_month_on_both_screens.sql';
const WRITER_TS = 'packages/managed/src/occupancy-peak.ts';
const BILLING_TS = 'apps/api/src/routes/billing/index.ts';
const PEAK_TABLE_SQL = 'packages/managed/migrations/0015_the_month_remembers_its_peak.sql';

/**
 * Instants chosen so that at least one timezone below disagrees about the
 * month at each of them — the last minutes of a month in winter and in summer,
 * and the first minutes of one, so both directions of the shift are covered.
 */
const BOUNDARY_INSTANTS = [
  '2026-09-30T23:30:00Z',
  '2026-10-01T00:30:00Z',
  '2026-01-31T23:30:00Z',
  '2026-06-30T22:30:00Z',
  '2026-03-01T00:30:00Z',
  '2026-12-31T23:59:00Z',
] as const;

/** UTC, the deployment's own zone, one west of Greenwich, one far east. */
const ZONES = ['UTC', 'Europe/Amsterdam', 'America/New_York', 'Pacific/Auckland'] as const;

/** The month a moment belongs to, the way `forMonth` computes it. */
function utcFirstOfMonth(instant: string): string {
  const d = new Date(instant);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/**
 * One month expression as it is actually shipped, with its JS interpolation
 * replaced by a bindable instant.
 */
interface Site {
  readonly what: string;
  readonly file: string;
  /** Must capture exactly the SQL expression, and nothing around it. */
  readonly find: RegExp;
  /** The `${...}` the shipped text carries, and what to put in its place. */
  readonly bind?: readonly [string, string];
  /** What the expression is supposed to answer for a given instant. */
  readonly expected: (instant: string) => string;
}

const SITES: readonly Site[] = [
  {
    what: "the operator's view joins on this month",
    file: VIEW_SQL,
    find: /AND p\.month = (date_trunc\([^\n]*?\)::date)\n/,
    expected: utcFirstOfMonth,
  },
  {
    what: 'the peak writer files the row under this month',
    file: WRITER_TS,
    find: /\n\s*(date_trunc\('month', \$\{at\.toISOString\(\)\}[^\n]*?\)::date),\n/,
    bind: ['${at.toISOString()}', "'@'"],
    expected: utcFirstOfMonth,
  },
  {
    what: 'the history screen groups runs into this month',
    file: BILLING_TS,
    find: /\.select\(\{ month: sql<string>`(to_char\([^`]*?\))` \}\)/,
    bind: ['${runTable.createdAt}', "'@'::timestamptz"],
    expected: (instant) => utcFirstOfMonth(instant).slice(0, 7),
  },
];

/** The shipped expression, with `@` left where the instant goes. */
function extract(site: Site): string {
  const match = site.find.exec(source(site.file));
  // A site that stops matching would otherwise drop silently out of the sweep,
  // which is the one way a guard like this fails without going red.
  expect(match, `${site.what}: no expression matched in ${site.file}`).not.toBeNull();
  const expression = match![1]!.trim();
  expect(expression.length, `${site.what}: matched nothing worth executing`).toBeGreaterThan(10);
  if (!site.bind) return expression;
  const [placeholder, replacement] = site.bind;
  expect(
    expression.includes(placeholder),
    `${site.what}: expected the interpolation ${placeholder} in ${expression}`,
  ).toBe(true);
  return expression.split(placeholder).join(replacement);
}

let db: PGlite;
beforeAll(async () => {
  db = await new PGlite();
});
afterAll(async () => {
  await db?.close();
});

/** Evaluate one expression at one instant, in one session timezone. */
async function evaluate(expression: string, instant: string, zone: string): Promise<string> {
  await db.query(`SET TIME ZONE '${zone}'`);
  const sql = expression.split('@').join(instant).split('now()').join(`'${instant}'::timestamptz`);
  const rows = (await db.query<{ answer: unknown }>(`SELECT ${sql} AS answer`)).rows;
  const answer = rows[0]!.answer;
  return answer instanceof Date ? answer.toISOString().slice(0, 10) : String(answer);
}

describe('every month expression that ships answers in UTC', () => {
  for (const site of SITES) {
    it(`${site.what} — same answer in every timezone`, async () => {
      const expression = extract(site);
      for (const instant of BOUNDARY_INSTANTS) {
        for (const zone of ZONES) {
          expect(
            await evaluate(expression, instant, zone),
            `${site.what} at ${instant} with TimeZone=${zone}`,
          ).toBe(site.expected(instant));
        }
      }
    });

    it(`${site.what} — and would NOT, without the UTC pin`, async () => {
      const asShipped = extract(site);
      // The mutation a future edit would make, derived from the shipped text
      // rather than copied: delete the pin and see the answer move.
      const mutated = asShipped.split(" AT TIME ZONE 'UTC'").join('');
      expect(mutated, `${site.what}: nothing to remove — is the pin still there?`).not.toBe(
        asShipped,
      );

      const answers = new Set<string>();
      for (const instant of BOUNDARY_INSTANTS) {
        for (const zone of ZONES) answers.add(await evaluate(mutated, instant, zone));
      }
      const pinned = new Set<string>();
      for (const instant of BOUNDARY_INSTANTS) pinned.add(site.expected(instant));
      // Strictly more distinct answers than there are months: at least one
      // (instant, zone) pair landed in a month the UTC rule does not name.
      expect(
        answers.size,
        `${site.what}: removing the pin changed nothing, so the pin proves nothing`,
      ).toBeGreaterThan(pinned.size);
    });
  }

  it('the three-argument date_trunc is a trap, not a simplification', async () => {
    // Named here because it is the obvious "tidy-up" of the shipped form and
    // is measurably worse: `date_trunc(f, ts, zone)` returns a timestamptz at
    // midnight UTC, and `::date` on that re-applies the session zone.
    await db.query(`SET TIME ZONE 'America/New_York'`);
    const trap = await db.query<{ answer: Date }>(
      `SELECT date_trunc('month', '2026-09-30T23:30:00Z'::timestamptz, 'UTC')::date AS answer`,
    );
    expect(trap.rows[0]!.answer.toISOString().slice(0, 10)).toBe('2026-08-31');

    const shipped = await db.query<{ answer: Date }>(
      `SELECT date_trunc('month', '2026-09-30T23:30:00Z'::timestamptz AT TIME ZONE 'UTC')::date AS answer`,
    );
    expect(shipped.rows[0]!.answer.toISOString().slice(0, 10)).toBe('2026-09-01');
  });
});

describe('the Node side names the same month', () => {
  it('monthPeriod gives one answer whatever the server thinks the time is', () => {
    const wasTZ = process.env.TZ;
    try {
      const answers = new Map<string, string>();
      for (const zone of ZONES) {
        process.env.TZ = zone;
        // Proof the zone actually took effect, so this cannot pass by not
        // having changed anything.
        const localMidnight = new Date(2026, 8, 30).toISOString();
        answers.set(zone, JSON.stringify({ ...monthPeriod('2026-09'), localMidnight }));
      }
      const periods = new Set(
        [...answers.values()].map((v) => {
          const { localMidnight: _ignored, ...rest } = JSON.parse(v);
          return JSON.stringify(rest);
        }),
      );
      expect(periods.size, `monthPeriod moved: ${[...answers]}`).toBe(1);
      expect(
        new Set([...answers.values()].map((v) => JSON.parse(v).localMidnight)).size,
        'no timezone actually took effect, so this test proved nothing',
      ).toBeGreaterThan(1);
    } finally {
      if (wasTZ === undefined) delete process.env.TZ;
      else process.env.TZ = wasTZ;
    }
  });

  it('monthPeriod names the real last day, February and December included', () => {
    expect(monthPeriod('2026-09')).toEqual({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(monthPeriod('2026-02').periodEnd).toBe('2026-02-28');
    expect(monthPeriod('2028-02').periodEnd).toBe('2028-02-29');
    expect(monthPeriod('2026-12')).toEqual({
      periodStart: '2026-12-01',
      periodEnd: '2026-12-31',
    });
  });

  it('monthPeriod refuses anything that is not a calendar month', () => {
    // Left to produce NaN dates, a malformed month meters a window of nothing,
    // which reads on screen exactly like a quiet month.
    for (const bad of ['2026-13', '2026-00', '2026-9', 'september', '2026-09-01', '']) {
      expect(() => monthPeriod(bad), `${bad} should not be a month`).toThrow(/calendar month/);
    }
  });
});

describe('the contract the other three were made to match', () => {
  it('occupancy_peak.month is still documented as UTC', () => {
    const table = read(PEAK_TABLE_SQL);
    const declaration = /--([^]*?)\n\s*month date NOT NULL,/.exec(table);
    expect(declaration, 'the month column moved — this whole file follows it').not.toBeNull();
    expect(declaration![1]).toMatch(/UTC/);
  });

  it('forMonth reads that column in UTC', () => {
    // Up to the closing brace at the class's own indent, so the whole method
    // body is compared and not a substring of it.
    const body = /async forMonth\([^]*?\n {2}\}/.exec(source(WRITER_TS));
    expect(body, 'forMonth moved or was renamed').not.toBeNull();
    expect(body![0]).toContain('Date.UTC(');
    // `getFullYear`/`getMonth` read the local clock; their UTC twins do not.
    expect(body![0]).not.toMatch(/\.get(FullYear|Month|Date)\(\)/);
  });
});

describe('the billing route asks one place for a month', () => {
  const code = () => source(BILLING_TS);

  it('neither handler builds a period from the local clock', () => {
    // Whole expressions, not a substring search: the defect was a call to
    // `getFullYear()` inside a `new Date(...)`, and a test that merely looked
    // for the words would also match the comment explaining them.
    expect(code()).not.toMatch(/\.get(FullYear|Month|Date)\(\)/);
  });

  it('both handlers get their period from monthPeriod, and build none of their own', () => {
    const calls = code().match(/monthPeriod\(/g) ?? [];
    // `/usage` and `/usage/history`. A third caller is fine; fewer is not.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(code()).toContain('monthPeriod,'); // imported from @openmig/managed
  });

  it('no month is rendered out of a timestamptz without pinning the zone', () => {
    for (const [expression] of code().matchAll(/to_char\([^`]*?'YYYY-MM'\)/g)) {
      expect(expression, 'to_char renders a timestamptz in the session timezone').toContain(
        "AT TIME ZONE 'UTC'",
      );
    }
  });
});
