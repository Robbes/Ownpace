// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The ten decision categories are written out THREE times, and this holds the
 * copies to each other.
 *
 *  1. `DECISION_CATEGORIES` in `@openmig/shared` — the source `DecisionCategory`
 *     is derived from, and what every detector and route is typed against.
 *  2. The Drizzle column enum in `schema-pg.ts`.
 *  3. The `decision_category_check` CHECK constraint in the baseline migration.
 *
 * They cannot be collapsed into one: TypeScript cannot generate a Postgres
 * CHECK, migrations are append-only text by design (a migration that read a
 * constant would change meaning when the constant changed), and Drizzle's
 * enum is what gives the query builder its literal type. So three copies is
 * the right shape — and three copies that nothing compares is how the next
 * category gets added to two of them.
 *
 * The failure that shape produces is nasty and late: a detector raises a
 * category the type system accepts, the ledger's CHECK rejects the insert, and
 * the first evidence is a constraint violation from a scheduled job at 07:00
 * against a tenant's live database. This test is a second of CI instead.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISION_CATEGORIES } from '@openmig/shared';
import * as schemaPg from './schema-pg.ts';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * The categories the DATABASE will accept, read out of the migrations rather
 * than restated here — restating them would just add a fourth copy.
 *
 * The LAST migration that defines the constraint wins, the same way Postgres
 * sees it: a later migration may drop and recreate it with more categories,
 * and this must follow that rather than pin the baseline forever.
 */
function categoriesFromMigrations(): readonly string[] {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let found: string[] | undefined;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    // `decision_category_check CHECK ((category = ANY (ARRAY['a'::text, …])))`
    const match = /decision_category_check[\s\S]*?ARRAY\[([^\]]+)\]/.exec(sql);
    if (match) {
      found = [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    }
  }
  if (!found) throw new Error('no decision_category_check found in any migration');
  return found;
}

describe('the decision categories agree across all three definitions', () => {
  it('finds the constraint at all', () => {
    // A regex that silently stopped matching would make this suite pass
    // forever while comparing nothing.
    expect(categoriesFromMigrations().length).toBeGreaterThan(0);
  });

  it('the DATABASE accepts exactly what the type allows', () => {
    // Either direction is a real bug. A category in the type but not the CHECK
    // is a runtime constraint violation from a scheduled detector; one in the
    // CHECK but not the type is a row nothing can be written or read as.
    expect([...categoriesFromMigrations()].sort()).toEqual([...DECISION_CATEGORIES].sort());
  });

  it('the Drizzle enum matches the type', () => {
    // Drizzle's enum is what gives `decision.category` its literal type in the
    // query builder; if it drifts, the builder rejects a category the rest of
    // the codebase treats as legal.
    const drizzle = (
      schemaPg.decision.category as unknown as { enumValues: readonly string[] }
    ).enumValues;
    expect([...drizzle].sort()).toEqual([...DECISION_CATEGORIES].sort());
  });

  it('nobody has quietly reordered them into a different set', () => {
    // Order does not matter to Postgres or to TypeScript, so this asserts the
    // SET rather than the sequence — but the count is worth pinning too, since
    // a duplicate entry would pass a set comparison.
    expect(new Set(DECISION_CATEGORIES).size).toBe(DECISION_CATEGORIES.length);
    expect(new Set(categoriesFromMigrations()).size).toBe(categoriesFromMigrations().length);
  });
});
