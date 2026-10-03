// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TABLE THE PURGE COULD NOT EMPTY (workplan 0138 T3 step 2).
 *
 * Since #1358 the purge of closed organisations runs as the tasks' system
 * role, `ownpace_system`, which has no default privileges, on purpose: a table
 * is the role's only once a migration grants it (managed migration 0033, "What
 * it may do, and nothing more"). So every table in `PURGED_TABLES` needs a
 * migration that grants the role DELETE on it, or the purge sends a DELETE
 * Postgres refuses, the erasure rolls back whole, and it fails the same way
 * every hour after.
 *
 * That happened once already. #1390 made `person_link` (managed 0034), put it
 * in `PURGED_TABLES` and granted it to `app_user` alone; #1358 merged after it
 * on a green that predated it; git merged the two without a conflict, and
 * `main` could erase no organisation until managed 0035 granted the role the
 * table (#1403). The integration test `a-system-role-that-is-not-the-owner`
 * catches it, on a real Postgres, but only in the integration job and only on
 * a machine that can start one. This reads the migrations as text, in the unit
 * tier, on every machine: the next table added to `PURGED_TABLES` without its
 * grant fails here first, named.
 *
 * It asks for DELETE only, the privilege every purged table needs. Which
 * columns the role may read beside it is the integration test's to hold
 * (`EXPECTED`), against what Postgres actually granted.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PURGED_TABLES } from './offboarding.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CHAINS = ['packages/ledger/migrations', 'packages/managed/migrations'];
const ROLE = 'ownpace_system';

/** SQL with its comments taken out, so a GRANT in a comment grants nothing. */
const sqlCode = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

/** Split on the commas outside parentheses: `SELECT (a, b), DELETE` is two privileges. */
const topLevel = (list: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

const unquote = (name: string): string => name.replace(/"/g, '').toLowerCase();

/** Every table the given SQL grants DELETE on to the system role, by name. */
function deletableBySystemRole(sql: string): Set<string> {
  const tables = new Set<string>();
  for (const raw of sqlCode(sql).split(';')) {
    const s = raw.replace(/\s+/g, ' ').trim();
    const m = /^GRANT (.+?) ON (?:TABLE )?(.+?) TO (.+?)(?: WITH GRANT OPTION)?(?: GRANTED BY \S+)?$/i.exec(s);
    if (!m) continue;
    const [, privileges, on, grantees] = m;
    if (!topLevel(grantees!).some((g) => unquote(g) === ROLE)) continue;
    const privs = topLevel(privileges!).map((p) => p.replace(/\s+/g, ' ').toUpperCase());
    if (!privs.some((p) => p === 'DELETE' || p === 'ALL' || p === 'ALL PRIVILEGES')) continue;
    for (const t of topLevel(on!)) tables.add(unquote(t).replace(/^public\./, ''));
  }
  return tables;
}

function migrationsOf(chain: string): { file: string; sql: string }[] {
  const dir = join(ROOT, chain);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: `${chain}/${f}`, sql: readFileSync(join(dir, f), 'utf8') }));
}

describe('every table the purge empties, the system role may delete from', () => {
  const all = CHAINS.flatMap(migrationsOf);
  const granted = new Set(all.flatMap(({ sql }) => [...deletableBySystemRole(sql)]));

  it('finds the grants it is looking for at all', () => {
    // Without this, a reader that parsed nothing would pass every table below
    // as missing and say so, but a reader broken the other way would not.
    expect(granted.has('run')).toBe(true);
    expect(granted.has('tenant')).toBe(true);
  });

  it.each([...PURGED_TABLES])('%s is granted DELETE to ownpace_system by a migration', (table) => {
    expect(
      granted.has(table),
      `${table} is in PURGED_TABLES (packages/managed/src/offboarding.ts), and no migration in ` +
        `${CHAINS.join(' or ')} grants ${ROLE} DELETE on it. The purge runs as that role ` +
        `(workplan 0138 T3 step 2) and would be refused on this table, rolling the whole erasure ` +
        `back. Add a managed migration after the one that made the table: ` +
        `GRANT SELECT (tenant_id), DELETE ON TABLE public.${table} TO ${ROLE}; ` +
        `(managed 0035 is the model), and a line for it in EXPECTED in ` +
        `apps/worker/src/jobs/a-system-role-that-is-not-the-owner.integration.test.ts.`,
    ).toBe(true);
  });

  it('reads a grant the way Postgres does, not the way a comment says it', () => {
    expect(deletableBySystemRole('GRANT SELECT (tenant_id), DELETE ON TABLE public.x TO ownpace_system;')).toEqual(
      new Set(['x']),
    );
    expect(deletableBySystemRole('GRANT SELECT (tenant_id, id) ON TABLE public.x TO ownpace_system;').size).toBe(0);
    expect(deletableBySystemRole('GRANT DELETE ON TABLE public.x TO app_user;').size).toBe(0);
    expect(deletableBySystemRole('-- GRANT DELETE ON TABLE public.x TO ownpace_system;').size).toBe(0);
    expect(deletableBySystemRole('GRANT DELETE ON TABLE public.a, public."b" TO app_user, ownpace_system;')).toEqual(
      new Set(['a', 'b']),
    );
  });
});
