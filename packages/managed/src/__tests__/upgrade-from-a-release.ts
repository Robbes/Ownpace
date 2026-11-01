// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A managed database a release left behind, rebuilt from git: the machinery
 * of the managed chain's upgrade proof (workplan 0146 T4), shared by its two
 * legs.
 *
 * - `migrate-upgrade.unit.test.ts` runs it on PGlite, in the unit project, on
 *   every pull request, from each starting point `scripts/release-line.json`
 *   names; its header says what is proved and why each piece is as it is.
 * - `migrate-upgrade.integration.test.ts` runs the same proof on Postgres 18,
 *   the server the managed edition runs, from the same starting points (the
 *   managed chain's oldest supported release and the newest).
 *
 * Nothing here is imported by anything that ships, which is why it sits in
 * `__tests__`, beside `apps/api`'s helpers: the image guard
 * (`an-image-that-shipped-what-it-never-runs`) reads every other file under
 * `src` as runtime source, and this one imports the release's migrators by a
 * computed path. It reads git (`git show`,
 * `git ls-tree`) and writes the release's two chains and its two migrators
 * into a temp tree the caller makes and removes. Every function takes the
 * release it reads as `ref`.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LedgerDriver, RunMigrationsResult } from '@openmig/ledger';

// packages/managed/src/__tests__ -> repo root
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * The two chains, in the order the API applies them: the shared one first,
 * because every managed table references `public.tenant` (ADR-0036).
 */
export const CHAINS = ['shared', 'managed'] as const;
export type Chain = (typeof CHAINS)[number];

export const MIGRATIONS: Record<Chain, string> = {
  shared: 'packages/ledger/migrations',
  managed: 'packages/managed/migrations',
};

/** The migrators, as repository paths, and the packages whose dependencies they import. */
const SHARED_MIGRATOR = 'packages/ledger/src/migrate.ts';
const MANAGED_MIGRATOR = 'packages/managed/src/migrate-managed.ts';
const PACKAGES = ['packages/ledger', 'packages/managed'];

/** The shared chain's bookkeeping table: `migrate.ts`'s default, which it does not export. */
export const SHARED_BOOKKEEPING = 'schema_migrations';

export const quiet = (): void => {};

export function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** A file as the release holds it, byte for byte. */
export function atRef(ref: string, path: string): Buffer {
  return execFileSync('git', ['show', `${ref}:${path}`], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Is the reference reachable? A shallow clone or a missing tag is not a bug. */
export function refExists(ref: string): boolean {
  try {
    git('rev-parse', '--verify', `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/** A chain's migration filenames at the release, in the order the migrator sorts them. */
export function refFilenames(ref: string, chain: Chain): string[] {
  const dir = MIGRATIONS[chain];
  return git('ls-tree', '--name-only', ref, `${dir}/`)
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.endsWith('.sql'))
    .map((p) => p.slice(`${dir}/`.length))
    .sort();
}

/** A chain's migration filenames in this build. */
export function headFilenames(chain: Chain): string[] {
  return readdirSync(join(REPO_ROOT, MIGRATIONS[chain]))
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * The release's migrator source, with its imports pointed as the header says.
 *
 * `path` is the file's repository path; `tree` the temp tree it is written
 * into; `materialised` the repository paths written there.
 */
function pointImports(
  path: string,
  source: string,
  tree: string,
  materialised: ReadonlySet<string>,
): string {
  const from = dirname(join(tree, path));
  return source.replace(
    /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g,
    (whole, lead: string, quote: string, specifier: string) => {
      let target: string;
      if (specifier === '@openmig/ledger' && path === MANAGED_MIGRATOR) target = SHARED_MIGRATOR;
      else if (specifier.startsWith('.')) target = posix.join(posix.dirname(path), specifier);
      else return whole;
      const file = materialised.has(target) ? join(tree, target) : join(REPO_ROOT, target);
      let rel = relative(from, file).split(sep).join('/');
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${lead}${quote}${rel}${quote}`;
    },
  );
}

/**
 * The release, laid out like the repository in a temp tree: both chains'
 * migrations, both migrators, and each package's `node_modules` linked in.
 * `tempDir` makes the tree's directory; whoever passes it removes it.
 */
export function materialiseRelease(ref: string, tempDir: (prefix: string) => string): string {
  if (refFilenames(ref, 'managed').length === 0) {
    throw new Error(
      `${ref} has no managed chain (${MIGRATIONS.managed} is empty or absent there), so ` +
        'there is no managed database to upgrade from. A release that predates the chain ' +
        "split (ADR-0036) is the adoption case, which is two-chains.unit.test.ts's; set " +
        'UPGRADE_FROM_REF to a release from v0.2.0-alpha.1 on.',
    );
  }
  const tree = tempDir('ownpace-managed-upgrade-');
  for (const chain of CHAINS) {
    const dir = join(tree, MIGRATIONS[chain]);
    mkdirSync(dir, { recursive: true });
    for (const name of refFilenames(ref, chain)) {
      writeFileSync(join(dir, name), atRef(ref, `${MIGRATIONS[chain]}/${name}`));
    }
  }
  const materialised = new Set([SHARED_MIGRATOR, MANAGED_MIGRATOR]);
  for (const path of materialised) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(
      join(tree, path),
      pointImports(path, atRef(ref, path).toString('utf8'), tree, materialised),
    );
  }
  for (const pkg of PACKAGES) {
    symlinkSync(join(REPO_ROOT, pkg, 'node_modules'), join(tree, pkg, 'node_modules'), 'dir');
  }
  return tree;
}

export interface ReleaseMigrators {
  runShared(driver: LedgerDriver): Promise<RunMigrationsResult>;
  runManaged(driver: LedgerDriver): Promise<RunMigrationsResult>;
  /** The managed chain's bookkeeping table, as the release named it. */
  managedBookkeeping: string;
}

/** The release's two migrators, loaded from the temp tree, called as the API at the release called them. */
export async function loadReleaseMigrators(ref: string, tree: string): Promise<ReleaseMigrators> {
  const shared = (await import(join(tree, SHARED_MIGRATOR))) as Record<string, unknown>;
  const managed = (await import(join(tree, MANAGED_MIGRATOR))) as Record<string, unknown>;
  const runShared = shared.runMigrations;
  const runManaged = managed.runManagedMigrations;
  const managedBookkeeping = managed.MANAGED_BOOKKEEPING_TABLE;
  if (
    typeof runShared !== 'function' ||
    typeof runManaged !== 'function' ||
    typeof managedBookkeeping !== 'string'
  ) {
    throw new Error(
      `${ref}'s migrators do not export runMigrations, runManagedMigrations and ` +
        'MANAGED_BOOKKEEPING_TABLE, which is how its API applied the two chains. Read how ' +
        'that release migrated and teach this test the difference; do not fall back to ' +
        "this build's migrators, which would prove nothing about that release.",
    );
  }
  type Run = (options: { driver: LedgerDriver; logger: () => void }) => Promise<RunMigrationsResult>;
  return {
    runShared: (driver) => (runShared as Run)({ driver, logger: quiet }),
    runManaged: (driver) => (runManaged as Run)({ driver, logger: quiet }),
    managedBookkeeping,
  };
}

/**
 * A migration's SQL with its comments removed and its whitespace collapsed.
 *
 * What a database sees of a file, so that a note added to an applied
 * migration (#1650 added two) compares equal while any change to a statement
 * does not. String literals, quoted identifiers and dollar-quoted bodies are
 * kept byte for byte, comments inside them included: a function body is
 * stored as written, so a comment changed there is a change to the function.
 * Postgres nests block comments, and so does this.
 */
export function sqlWithoutComments(sql: string): string {
  let out = '';
  let space = false;
  const emit = (text: string): void => {
    if (space && out !== '') out += ' ';
    space = false;
    out += text;
  };
  /** Does the output end in an identifier character with nothing between? */
  const glued = (pattern: RegExp): boolean => !space && pattern.test(out);
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      space = true;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (depth > 0) throw new Error('an unterminated block comment');
      space = true;
      continue;
    }
    if (/\s/.test(c)) {
      space = true;
      i += 1;
      continue;
    }
    if (c === "'") {
      // E'...' takes backslash escapes; a plain literal does not.
      const escapes = glued(/(?:^|[^A-Za-z0-9_$])[Ee]$/);
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new Error('an unterminated string literal');
        if (escapes && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      emit(sql.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new Error('an unterminated quoted identifier');
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      emit(sql.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    if (c === '$' && !glued(/[A-Za-z0-9_$]$/)) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const close = sql.indexOf(tag, i + tag.length);
        if (close === -1) throw new Error(`an unterminated ${tag} quote`);
        emit(sql.slice(i, close + tag.length));
        i = close + tag.length;
        continue;
      }
    }
    emit(c);
    i += 1;
  }
  return out;
}

export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * The catalogue, as comparable lines per kind of object.
 *
 * Every line names its object, so a difference reads as one. Restricted to
 * `public` and to objects no extension owns, so PGlite's internals and an
 * extension's own functions stay out of it (extensions are compared by name
 * and version). Lists inside a line (grants, roles) are sorted, so two routes
 * that granted the same things in another order compare equal. OIDs are left
 * out: they record the route, not the schema.
 *
 * Column ORDER is in, as one line per table, so a difference reads as the
 * table it is in rather than as every column after it. It is the order
 * `SELECT *` and an `INSERT` without a column list see, and both routes apply
 * the same files in the same order within a chain, so they must agree. Where
 * they could part is across the chains: a shared file added after the release
 * runs after the release's managed files on an upgrade and before them on a
 * fresh install, so a column it adds to a table the managed chain also
 * extended would sit elsewhere. That is a real difference between the two
 * databases, and this is where it shows. Positions are counted over the live
 * columns only: a dropped column's gap in `attnum` is invisible to SQL.
 *
 * Comments (`COMMENT ON`) are in too, as a digest per object: the migrations
 * carry over a hundred, and an operator reads them in `\d+`.
 */
export const CATALOGUE: Readonly<Record<string, string>> = {
  relations: `
    SELECT c.relname || ':' || c.relkind::text || ':rls=' || c.relrowsecurity || ':force=' ||
           c.relforcerowsecurity || ':acl=' ||
           coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(c.relacl) a), '-')
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')`,
  columns: `
    SELECT table_name || '.' || column_name || ':' || data_type || ':' || udt_name || ':' ||
           is_nullable || ':' || coalesce(column_default, '-') || ':' ||
           coalesce(character_maximum_length::text, '-') || ':' ||
           coalesce(numeric_precision::text, '-') || ',' || coalesce(numeric_scale::text, '-') ||
           ':' || is_identity || ':' || is_generated || ':' || coalesce(generation_expression, '-') ||
           ':collate=' || coalesce(collation_name, '-')
      FROM information_schema.columns WHERE table_schema = 'public'`,
  'column order': `
    SELECT table_name || ':' || string_agg(column_name, ',' ORDER BY ordinal_position)
      FROM information_schema.columns WHERE table_schema = 'public'
     GROUP BY table_name`,
  'column grants': `
    SELECT a.attrelid::regclass::text || '.' || a.attname || ':' ||
           (SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(a.attacl) x)
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND NOT a.attisdropped`,
  indexes: `
    SELECT tablename || '.' || indexname || ':' || indexdef
      FROM pg_indexes WHERE schemaname = 'public'`,
  constraints: `
    SELECT CASE WHEN conrelid = 0 THEN contypid::regtype::text ELSE conrelid::regclass::text END ||
           '.' || conname || ':' || contype::text || ':' || pg_get_constraintdef(oid)
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace`,
  policies: `
    SELECT tablename || '.' || policyname || ':' || permissive || ':' ||
           (SELECT string_agg(r::text, ',' ORDER BY r::text) FROM unnest(roles) r) || ':' ||
           cmd || ':using=' || coalesce(qual, '-') || ':check=' || coalesce(with_check, '-')
      FROM pg_policies WHERE schemaname = 'public'`,
  triggers: `
    SELECT t.tgrelid::regclass::text || '.' || t.tgname || ':' || t.tgenabled::text || ':' ||
           pg_get_triggerdef(t.oid)
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal`,
  functions: `
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' ||
           md5(pg_get_functiondef(p.oid)) || ':acl=' ||
           coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a), '-')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
  views: `
    SELECT viewname || ':' || md5(definition) FROM pg_views WHERE schemaname = 'public'`,
  types: `
    SELECT t.typname || ':' || t.typtype::text || ':' ||
           coalesce((SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
                       FROM pg_enum e WHERE e.enumtypid = t.oid), '-')
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd')`,
  'default privileges': `
    SELECT pg_get_userbyid(defaclrole) || ':' || coalesce(defaclnamespace::regnamespace::text, '-') ||
           ':' || defaclobjtype::text || ':' ||
           (SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(defaclacl) a)
      FROM pg_default_acl`,
  roles: `
    SELECT rolname || ':super=' || rolsuper || ':bypassrls=' || rolbypassrls || ':login=' ||
           rolcanlogin || ':inherit=' || rolinherit || ':createrole=' || rolcreaterole ||
           ':in=' || coalesce((SELECT string_agg(g.rolname, ',' ORDER BY g.rolname)
                                 FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                                WHERE m.member = r.oid), '-')
      FROM pg_roles r WHERE rolname NOT LIKE 'pg\\_%'`,
  extensions: `SELECT extname || ':' || extversion FROM pg_extension`,
  comments: `
    SELECT o.type || ' ' || o.identity || ':' || md5(d.description)
      FROM pg_description d
      CROSS JOIN LATERAL pg_identify_object(d.classoid, d.objoid, d.objsubid) o
     WHERE o.schema = 'public' OR d.classoid = 'pg_extension'::regclass`,
};

export async function catalogue(driver: LedgerDriver): Promise<Record<string, string[]>> {
  const client = await driver.acquire();
  try {
    const out: Record<string, string[]> = {};
    for (const [kind, sql] of Object.entries(CATALOGUE)) {
      const { rows } = await client.query<{ line: string }>(`SELECT line FROM (${sql}) AS x(line)`);
      out[kind] = rows.map((r) => r.line).sort();
    }
    return out;
  } finally {
    client.release();
  }
}

/** A bookkeeping table's rows, as `version @ applied_at`, in version order. */
export async function bookkeeping(driver: LedgerDriver, table: string): Promise<string[]> {
  if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`Not a bookkeeping table name: ${table}`);
  const client = await driver.acquire();
  try {
    const { rows } = await client.query<{ line: string }>(
      `SELECT version || ' @ ' || applied_at::text AS line FROM ${table} ORDER BY version`,
    );
    return rows.map((r) => r.line);
  } finally {
    client.release();
  }
}

export const versionsOf = (rows: readonly string[]): string[] => rows.map((r) => r.split(' @ ')[0]!);
