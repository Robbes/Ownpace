// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The log's vocabulary, held to the database that enforces it.
 *
 * `view_name` is a closed CHECK, and 0009 built it closed on purpose so the log
 * could be COUNTED rather than grepped. `SupportView` is the TypeScript half of
 * that same rule — and until this file, nothing held the two together. Drift in
 * either direction is silent until it is expensive:
 *
 *  - a value added to the union but not the CHECK: every write with it fails at
 *    runtime, on a route that appeared to work in review;
 *  - a value added to the CHECK but not the union: unreachable, so a screen
 *    somebody built the migration for cannot record what it shows.
 *
 * Both shapes have happened elsewhere in this repository under different names,
 * which is why the guard is a parse of the real migrations rather than a second
 * list to keep in step.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPPORT_VIEWS } from './support-read-log.ts';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * The vocabulary the database will actually accept: the LAST definition of
 * `support_read_view_name_check` across the chain, in file order, because the
 * constraint is dropped and re-added as it grows (0011's idiom, followed by
 * 0019).
 */
function vocabularyFromMigrations(): string[] {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let last: string[] | null = null;
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    // Every ADD of this constraint, so a file that redefines it twice is read
    // the way Postgres would read it: the last one wins.
    for (const m of sql.matchAll(
      /ADD\s+CONSTRAINT\s+support_read_view_name_check\s+CHECK\s*\(\s*view_name\s*=\s*ANY\s*\(\s*ARRAY\s*\[([\s\S]*?)\]/g,
    )) {
      last = [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    }
    // The original, which declares it inline in CREATE TABLE rather than adding it.
    const inline = /CONSTRAINT\s+support_read_view_name_check\s*\n?\s*CHECK\s*\(view_name\s*=\s*ANY\s*\(ARRAY\[([\s\S]*?)\]\)\)/.exec(sql);
    if (inline && last === null) {
      last = [...inline[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    }
  }
  return last ?? [];
}

describe('what the log may record', () => {
  const fromDb = vocabularyFromMigrations();

  it('found a vocabulary at all, so the comparison is not empty on both sides', () => {
    // A regex that stops matching would make every assertion below vacuously
    // true — the failure mode this repository has been bitten by more than
    // once. Two anchors: it parsed something, and it parsed the value that has
    // been in the CHECK since the table existed.
    expect(fromDb.length, 'no view_name CHECK was parsed out of the migrations').toBeGreaterThan(0);
    expect(fromDb, 'the parse no longer finds the original vocabulary').toContain('tenant');
  });

  it('agrees with the database, exactly and in both directions', () => {
    expect(
      [...SUPPORT_VIEWS].sort(),
      'SUPPORT_VIEWS and the support_read CHECK disagree.\n\n' +
        'A value in the union but not the CHECK fails every write at runtime, on\n' +
        'a route that looked fine in review. A value in the CHECK but not the\n' +
        'union is unreachable, so the screen its migration was written for\n' +
        'cannot record what it shows. Add it to both, or to neither.',
    ).toEqual([...fromDb].sort());
  });

  it('still carries the two the search added, and the four that came before', () => {
    // Named as well as derived: these are the ones whose absence has a
    // consequence somebody would have to debug rather than read.
    for (const v of ['tenants', 'tenant', 'migration', 'retained_invoices', 'people', 'person']) {
      expect(SUPPORT_VIEWS as readonly string[]).toContain(v);
    }
  });
});
