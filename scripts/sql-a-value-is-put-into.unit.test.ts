// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * SQL A VALUE IS PUT INTO: SQL text is built from a value only at named places,
 * each with the check that comes first (workplan 0178 §5.1, G2; the owner's
 * D2 of 2026-11-26).
 *
 * WHY. The ledger writes its queries with drizzle's `sql` tag and `$n`
 * parameters, so a value is never part of the text. A few places cannot: a role
 * name in `SET LOCAL ROLE`, a table that is an identifier, a lock timeout, an
 * operator's printed statement. Each checks the value first: `assertRoleName`
 * in `packages/ledger/src/driver.ts`, the timeout's pattern in
 * `packages/ledger/src/migrate.ts`, `identifier()` in
 * `packages/scheduler/src/pg-boss/job-runner.ts`, the array patterns in
 * `packages/managed/src/offboarding.ts`. Nothing listed those places, so a new
 * one was caught by a reviewer or not at all.
 *
 * THE RULE. Every tracked `.ts`, `.tsx` and `.mjs` file under `apps/` and
 * `packages/` that is not a test, a test's fixture or a test helper is parsed
 * (`scripts/sast-guard-source.ts`). A spot is `sql.raw(`, `sql.identifier(`,
 * `.unsafe(`; a `.query(`, `.execute(` or `.executeSql(` whose text is a
 * template with a value in it, or built with `+`; and an untagged template with
 * a value in it whose text opens with SQL in capitals. Each file with spots is
 * in PLACES with their number and the check that makes them safe. One more,
 * one fewer, or a file not listed, fails. Never widen an entry without a
 * reason for the new spot.
 *
 * WHAT IT DOES NOT SEE. SQL text assembled from parts across statements, then
 * handed to a query by a name; a query a package outside this repository
 * builds. CodeQL's `js/sql-injection` (0178 §4.1) follows those.
 */

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTestSource, rawSqlSpots, readSource, trackedSources } from './sast-guard-source.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The files allowed SQL a value is put into, how many spots, and what checks the value first. */
const PLACES: Record<string, { spots: number; reason: string }> = {
  'apps/api/src/scripts/operator-housekeeping.ts': {
    spots: 7,
    reason:
      'The operator’s housekeeping command, run by hand, never loaded by the API. Its finding queries put constant fragments in (AGE_DAYS, notASubject, MADE_BY_A_GRANT); the statements it PRINTS for the operator to read put in ids it read from the database, which are uuids.',
  },
  'apps/api/src/scripts/operator.ts': {
    spots: 1,
    reason: 'A statement the operator command prints, with each value through sqlLit, which doubles every quote.',
  },
  'apps/worker/src/cli/measure-google-sync.ts': {
    spots: 1,
    reason: 'A measuring command run by hand; the one value is the constant AN_OPEN_ORGANISATION_WHERE.',
  },
  'apps/worker/src/jobs/managed-sync-tick.ts': {
    spots: 1,
    reason: 'ACTIVE_MAPPINGS_SQL puts in constant fragments only (FIRST_COPY_UNFINISHED, CUTOVER_STILL_COPIES_WHERE, A_PATH_KEPT_AFTER_A_CUTOVER_WHERE).',
  },
  'packages/ledger/src/cutover-grace.ts': {
    spots: 1,
    reason: 'sql.raw of the constant CUTOVER_STILL_COPIES_WHERE.',
  },
  'packages/ledger/src/db.ts': {
    spots: 4,
    reason: 'SET LOCAL ROLE, which takes no parameter; the role name goes through assertRoleName (driver.ts), a plain identifier or a throw.',
  },
  'packages/ledger/src/migrate.ts': {
    spots: 4,
    reason: 'The bookkeeping table, an identifier checked at the top of runMigrations, and the lock timeout, checked against a whole number of ms or s.',
  },
  'packages/managed/src/gift-store.ts': {
    spots: 1,
    reason: 'SET LOCAL ROLE, the role name through assertRoleName.',
  },
  'packages/managed/src/offboarding.ts': {
    spots: 3,
    reason: 'sql.identifier over the constant PURGED_TABLES, and two arrays built by pgUuidArray and pgTextArray, each value checked against its pattern first.',
  },
  'packages/scheduler/src/pg-boss/job-runner.ts': {
    spots: 5,
    reason: 'The queue’s schema and table, each through identifier(), a plain identifier or a throw.',
  },
};

function spotsOnTheTree(): Map<string, Array<{ line: number; text: string }>> {
  const found = new Map<string, Array<{ line: number; text: string }>>();
  for (const file of trackedSources(ROOT, ['apps', 'packages'], /\.(ts|tsx|mjs)$/)) {
    if (isTestSource(file)) continue;
    const spots = rawSqlSpots(file, readSource(ROOT, file));
    if (spots.length > 0) found.set(file, spots);
  }
  return found;
}

describe('SQL a value is put into (0178 G2)', () => {
  it('refuses a value put into SQL text, each way, and a parameter or a tag is no spot', () => {
    const bad = [
      'await conn.query(`SELECT * FROM mailbox WHERE id = ${id}`);',
      "await pool.query('SELECT * FROM mailbox WHERE id = ' + id);",
      'await db.execute(`DELETE FROM run WHERE id = ${id}`);',
      'const q = `UPDATE mailbox SET name = ${name}`;',
      'await db.execute(sql.raw(text));',
      'await client.unsafe(text);',
      'sql`DELETE FROM ${sql.identifier(table)}`;',
    ];
    for (const source of bad) expect(rawSqlSpots('fixture.ts', source), source).toHaveLength(1);
    const fine = [
      "await conn.query('SELECT * FROM mailbox WHERE id = $1', [id]);",
      'await db.execute(sql`SELECT * FROM mailbox WHERE id = ${id}`);',
      'const m = `DELETE ${url} was refused with 412`;',
      'const n = `Select ${count} rows`;',
      '// await conn.query(`SELECT ${id}`)',
      'const k = `SELECT 1`;',
    ];
    for (const source of fine) expect(rawSqlSpots('fixture.ts', source), source).toHaveLength(0);
  });

  it('counts a query and the template that is its text as one spot', () => {
    expect(rawSqlSpots('fixture.ts', 'await c.query(\n  `SELECT version FROM ${table}`,\n);')).toHaveLength(1);
  });

  it('finds SQL a value is put into only where PLACES says, as often as it says', () => {
    const found = spotsOnTheTree();
    const problems: string[] = [];
    for (const [file, spots] of found) {
      const place = PLACES[file];
      if (!place) problems.push(...spots.map((s) => `${file}:${s.line}: ${s.text} (not in PLACES: pass the value as a parameter or through the sql tag, or check it first and name the file with the check)`));
      else if (spots.length !== place.spots) problems.push(`${file}: ${spots.length} spots, PLACES says ${place.spots}: ${spots.map((s) => s.line).join(', ')}`);
    }
    for (const file of Object.keys(PLACES)) if (!found.has(file)) problems.push(`${file}: in PLACES, and has no spot any more: take it out`);
    expect(problems).toEqual([]);
  });

  it('names a check, or a constant, for every place', () => {
    for (const [file, { reason }] of Object.entries(PLACES)) expect(reason.length, file).toBeGreaterThan(40);
  });
});
