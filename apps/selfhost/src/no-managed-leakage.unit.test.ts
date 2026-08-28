// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Hard rule 5 guard (workplan 0010, T2/T3 "no managed leakage").
 *
 * The self-host appliance must never load managed-only code — no Trigger.dev,
 * no billing/Mollie, no RLS app-user path. This test walks the *actual*
 * transitive `@openmig`/relative import graph starting from the selfhost
 * entrypoint and fails if any reachable module imports a forbidden specifier.
 *
 * It is a real graph walk (not a grep of one file), so it catches transitive
 * regressions — e.g. importing `@openmig/scheduler` (the package index, which
 * re-exports the Trigger.dev client) instead of `@openmig/scheduler/in-process`.
 * It resolves only `@openmig/*` and relative imports (the code we own); bare
 * third-party specifiers are checked against the forbidden list but not walked.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/selfhost/src -> repo root
const ROOT = resolve(HERE, '..', '..', '..');
const ENTRY = join(ROOT, 'apps/selfhost/src/index.ts');

const PKG_DIRS: Record<string, string> = {
  '@openmig/shared': 'packages/shared/src',
  '@openmig/ledger': 'packages/ledger/src',
  '@openmig/core': 'packages/core/src',
  '@openmig/connectors': 'packages/connectors/src',
  '@openmig/engines': 'packages/engines/src',
  '@openmig/scheduler': 'packages/scheduler/src',
  '@openmig/orchestration': 'packages/orchestration/src',
};

/** A specifier that must never be reachable from the self-host graph. */
function forbiddenReason(spec: string): string | null {
  if (/^@trigger\.dev(\/|$)/.test(spec)) return 'Trigger.dev SDK (managed orchestration)';
  if (/^@mollie(\/|$)/.test(spec) || /mollie/i.test(spec)) return 'Mollie billing client';
  if (/(^|\/)billing(\/|$)/.test(spec)) return 'billing module';
  // The managed package itself. Listed by name because the rules below are
  // about what a module is CALLED, and this one is named after the edition —
  // which is the point: everything that exists because there is a customer on
  // the other side lives there, and none of it is reachable from here.
  if (/^@openmig\/managed(\/|$)/.test(spec)) return 'the managed edition package (ADR-0036)';
  // ADR-0036. `billing` alone was not enough: the modules that priced a tenant
  // and metered its usage were called `pricing`, `tenant-pricing` and
  // `usage-metering`, they were re-exported from `@openmig/shared` and
  // `@openmig/ledger` — which ARE the appliance — and this guard walked
  // straight past them for as long as they existed. A rule that only catches
  // the word "billing" catches whatever happens to be named after the invoice,
  // not what happens to be about money.
  if (/(^|\/)(pricing|tenant-pricing|usage-metering|invoice|invoice-generation)(\/|$)/.test(spec)) {
    return 'pricing/metering module (managed-only — an appliance has an owner, not customers)';
  }
  // The scheduler index re-exports the Trigger.dev client — self-host must use
  // the trigger-free `/in-process` subpath instead.
  if (spec === '@openmig/scheduler' || spec === '@openmig/scheduler/index') {
    return 'scheduler package index (use @openmig/scheduler/in-process)';
  }
  return null;
}

/** Resolve an `@openmig/*` or relative specifier to an on-disk .ts file, or null. */
function resolveToFile(spec: string, fromFile: string): string | null {
  if (spec === '@openmig/scheduler/in-process') {
    return join(ROOT, 'packages/scheduler/src/scheduler.ts');
  }
  let base: string | null = null;
  if (spec.startsWith('.')) {
    base = resolve(dirname(fromFile), spec);
  } else {
    const m = /^(@openmig\/[a-z]+)(?:\/(.+))?$/.exec(spec);
    if (m) {
      const dir = PKG_DIRS[m[1]!];
      if (!dir) return null;
      base = join(ROOT, dir, m[2] ?? 'index');
    }
  }
  if (!base) return null;

  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  return null;
}

const IMPORT_RE = /(?:from|import)\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiersOf(source: string): string[] {
  const specs = new Set<string>();
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.add(m[1]!);
  }
  return [...specs];
}

interface Violation {
  file: string;
  spec: string;
  reason: string;
}

function walk(entry: string): { visited: Set<string>; violations: Violation[] } {
  const visited = new Set<string>();
  const violations: Violation[] = [];
  const queue: string[] = [entry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, 'utf-8');
    for (const spec of specifiersOf(source)) {
      const reason = forbiddenReason(spec);
      if (reason) {
        violations.push({ file: file.slice(ROOT.length + 1), spec, reason });
      }
      const next = resolveToFile(spec, file);
      if (next && !visited.has(next)) queue.push(next);
    }
  }
  return { visited, violations };
}

describe('self-host has no managed-only leakage (hard rule 5)', () => {
  const { visited, violations } = walk(ENTRY);

  it('walks a non-trivial module graph (guards against a broken resolver)', () => {
    // The entrypoint reaches shared/ledger/scheduler/worker-orchestration and
    // their local deps — if this collapses to a couple of files the walk is
    // broken and the leakage check below would pass vacuously.
    expect(visited.size).toBeGreaterThan(8);
  });

  it('maps every package to a directory that exists', () => {
    // `visited.size > 8` above is far too loose to catch the realistic failure.
    // A one-character typo in ONE PKG_DIRS value — `src` -> `srcs` — makes that
    // package unresolvable, so the walk silently skips it AND everything only
    // reachable through it: measured at 19 files dropped, 137 -> 118. Still
    // comfortably over 8, so the guard above passes and the leakage check runs
    // against a graph with a whole package missing from it.
    //
    // Found on 2026-08-14 by mutating this file and watching it stay green.
    const missing = Object.entries(PKG_DIRS)
      .filter(([, dir]) => !existsSync(join(ROOT, dir)))
      .map(([pkg, dir]) => `${pkg} -> ${dir}`);

    expect(
      missing,
      'these PKG_DIRS entries point at directories that do not exist, so those ' +
        'packages resolve to nothing and drop out of the leakage walk silently:\n' +
        missing.map((m) => `  - ${m}`).join('\n'),
    ).toEqual([]);
  });

  it('actually reaches the packages the appliance is built from', () => {
    // The complement to the check above: a directory can exist and still go
    // unwalked if the resolver or an import path changes. `@openmig/orchestration`
    // is named explicitly because `build-deps.ts` — the SELF-HOST dependency
    // builder — lives there. If the appliance's own builder is not in the graph,
    // this test is not checking the thing its name claims to check.
    const reachedPackages = new Set(
      [...visited]
        .map((f) => /packages\/([a-z]+)\/src\//.exec(f)?.[1])
        .filter((p): p is string => Boolean(p)),
    );

    for (const pkg of ['shared', 'ledger', 'core', 'orchestration']) {
      expect(
        reachedPackages.has(pkg),
        `no file from packages/${pkg}/src is reachable from the self-host ` +
          'entrypoint, so nothing in it is covered by the leakage check below',
      ).toBe(true);
    }
  });

  it('imports no Trigger.dev / billing / Mollie anywhere in its reachable graph', () => {
    expect(violations).toEqual([]);
  });

  // ======================= the schema half (ADR-0036) =======================
  //
  // The checks above prove the appliance loads no managed CODE. They said
  // nothing about the TABLES it can name, and for as long as `invoice`,
  // `payment_method` and `usage_metric` were declared in `schema-pg.ts` —
  // which the appliance imports — a `db.select().from(schema.invoice)` written
  // in shared code compiled on both editions and typechecked clean. The rule
  // was real; only the code half of it was enforced.

  /**
   * Tables and views that only exist because there is a customer on the other
   * side — DERIVED from the managed chain's own SQL, not listed here.
   *
   * ## Why it stopped being a list
   *
   * It was eleven names, hand-kept, and it had fallen four behind: the managed
   * chain creates `access_request`, `platform_operator`, `tenant_pricing` and
   * `tenant_closure`, and none of them was on it. Two of those are named in
   * the comment below this one as tables that MOVED into the managed chain —
   * so the file knew about them and the list still did not.
   *
   * That is the exact failure this guard exists to prevent, happening to the
   * guard. A hand-kept list of what must not leak is a list that goes stale
   * quietly: nothing turns red when a managed table is added, because adding
   * it to the chain is not adding it here.
   *
   * The managed chain IS the definition. A table created in
   * `packages/managed/migrations` exists on no appliance, by construction — a
   * self-host database never runs that chain (ADR-0036) — so every object it
   * creates is managed-only without anybody deciding so. Derived, the list
   * cannot fall behind: the next managed table is on it the moment its
   * migration is written, and the guard is waiting before anybody reaches for
   * `schema-pg.ts`.
   *
   * This is the same move `MOUNTS` (0096), the gate's route families (0100)
   * and the front door's lanes (0107) each made after the same lesson.
   *
   * ## What each of them is, since the derivation no longer says
   *
   * Billing (`invoice`, `payment_method`, `usage_metric`, `tenant_pricing`):
   * there is nobody to bill. Accounts (`tenant_member`, `access_request`,
   * `platform_operator`): the appliance is single-user and its HTTP surface
   * has no login, so it has an owner rather than members, nobody to let in and
   * no operators at all. Lifecycle (`erasure_record`, `tenant_closure`): the
   * receipt WE produce as somebody's processor, which proves nothing to an
   * operator who IS the customer. Support (`support_read` and the five
   * `support_*` views, 0110): nobody for a read to be recorded against, and
   * nobody whose migrations another party would be looking at.
   */
  const MANAGED_ONLY_TABLES: ReadonlyArray<string> = (() => {
    const dir = join(ROOT, 'packages/managed/migrations');
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(dir, f), 'utf-8'))
      .join('\n');
    const names = [
      ...[...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z_]+)/gi)],
      ...[...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.([a-z_]+)/gi)],
    ].map((m) => m[1]!);
    return [...new Set(names)].sort();
  })();

  /**
   * Managed-only COLUMNS on tables the appliance legitimately owns.
   *
   * EMPTY, and that is the finding. It held one entry — `tenant.pricing` —
   * which I argued had to stay because splitting one nullable jsonb column into
   * a second declaration of `tenant` would leave the drift guard with two rows
   * of that name. The owner's question was the better one: don't keep the
   * column. `tenant_pricing` and `tenant_closure` are rows in the managed chain
   * now, where a MISSING ROW says "nothing agreed" and "not closed" without a
   * NULL that has to be documented as not meaning zero.
   *
   * Kept as a list rather than deleted, because the next managed-only column
   * will be proposed as an exception and this is where the reason has to be
   * written down.
   */
  const MANAGED_ONLY_COLUMNS: Readonly<Record<string, string>> = {};

  it('derived a real list, and one that cannot quietly shrink', () => {
    // Two ways a derivation fails silently, and both make every check below
    // vacuous: a regex that matches nothing, and a regex that stops matching
    // one shape (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE VIEW`) after
    // somebody reformats a migration.
    expect(
      MANAGED_ONLY_TABLES.length,
      'no managed-chain objects derived — the guard below is asserting nothing',
    ).toBeGreaterThan(12);

    // The names the list carried by hand until 2026-08-27. Not the source of
    // truth any more, but a floor: the derivation must still find every one of
    // them, or it has lost a shape it used to cover.
    for (const known of [
      'invoice',
      'payment_method',
      'usage_metric',
      'tenant_member',
      'erasure_record',
      'support_read',
      'support_tenants',
      'support_tenant_connections',
      'support_tenant_migrations',
      'support_tenant_invoices',
      'support_migration_domains',
    ]) {
      expect(MANAGED_ONLY_TABLES, `the derivation lost '${known}'`).toContain(known);
    }

    // ...and the four it had fallen behind on, which is why it is derived now.
    for (const missed of [
      'access_request',
      'platform_operator',
      'tenant_pricing',
      'tenant_closure',
    ]) {
      expect(MANAGED_ONLY_TABLES, `the derivation missed '${missed}'`).toContain(missed);
    }
  });

  it('declares no managed-only table anywhere in its reachable graph', () => {
    const found: string[] = [];
    for (const file of visited) {
      const source = readFileSync(file, 'utf-8');
      for (const table of MANAGED_ONLY_TABLES) {
        // `pgTable(` and its name argument are usually on separate lines.
        if (new RegExp(`pgTable\\(\\s*'${table}'`).test(source)) {
          found.push(`${file.slice(ROOT.length + 1)} declares '${table}'`);
        }
      }
    }
    expect(
      found,
      'the appliance reaches a schema module that declares a managed-only table, ' +
        'so shared code can name it and typecheck clean on both editions:\n' +
        found.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);
  });

  it('every managed-only name really is declared ONLY in the managed chain', () => {
    // The complement to the check above, and the reason an entry that catches
    // nothing today is still worth having. A name on this list must not appear
    // in the LEDGER chain's migrations either: the guard reads TypeScript, so a
    // table that arrived in the shared chain's SQL would be invisible to it
    // while every appliance created the table on boot.
    const ledgerDir = join(ROOT, 'packages/ledger/migrations');
    const ledgerSql = readdirSync(ledgerDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(ledgerDir, f), 'utf-8'))
      .join('\n');

    const leaked = MANAGED_ONLY_TABLES.filter((t) =>
      new RegExp(`(CREATE\\s+TABLE[^;]*|CREATE\\s+(OR\\s+REPLACE\\s+)?VIEW\\s+)(public\\.)?${t}\\b`, 'i').test(
        ledgerSql,
      ),
    );
    expect(
      leaked,
      'a managed-only table or view is created by the SHARED migration chain, so ' +
        'every appliance builds it on boot — move it to packages/managed/migrations',
    ).toEqual([]);
  });

  it('carries no managed-only column on a table the appliance owns', () => {
    const schemaFile = join(ROOT, 'packages/ledger/src/schema-pg.ts');
    expect(visited.has(schemaFile), 'the appliance no longer loads schema-pg.ts — ' +
      'this check is looking at a file that is not in the graph').toBe(true);

    const source = readFileSync(schemaFile, 'utf-8');
    // The `tenant` table body: from its declaration to the closing `});`.
    const tenantBody = /export const tenant = pgTable\('tenant', \{([\s\S]*?)\n\}\);/.exec(source)?.[1];
    expect(tenantBody, 'could not find the tenant table body to read its columns from').toBeTruthy();

    const columns = [...tenantBody!.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]!);
    expect(columns.length, 'no columns parsed out of the tenant table — the ' +
      'check below would pass against an empty list').toBeGreaterThan(3);

    const MONEY = /^(pricing|price|billing|invoice|payment|vat|tax|currency|fee|rate|closed|purge)/i;
    const managed = columns.filter((c) => MONEY.test(c)).map((c) => `tenant.${c}`);
    expect(
      managed.filter((c) => !(c in MANAGED_ONLY_COLUMNS)),
      'a managed-only column arrived on a table the appliance loads. Either it ' +
        'belongs in @openmig/managed as a row of its own, or add it to ' +
        'MANAGED_ONLY_COLUMNS with the reason it has to live here (ADR-0036).',
    ).toEqual([]);

    for (const key of Object.keys(MANAGED_ONLY_COLUMNS)) {
      expect(managed, `${key}: allow-listed but no longer declared — remove the entry`).toContain(key);
    }
  });
});
