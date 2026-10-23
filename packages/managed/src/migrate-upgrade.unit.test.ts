// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The managed chain's upgrade proof: a release's database, upgraded to this
 * build, on both chains (workplan 0146 T4, the alpha leg).
 *
 * `packages/ledger/src/migrate-upgrade.unit.test.ts` proves the SHARED chain
 * upgrades. Nothing proved the managed one did, and from `v0.2.0-alpha.1` on
 * that is the chain that moves: alpha.1 carries 46 managed migrations and
 * this build more, while the shared chain is byte for byte what alpha.1
 * shipped. So the shared gate, and the appliance's container drill, both
 * exercise no migration from alpha.1. `ownpace-live` is a managed stack, and
 * its first upgrade runs on testers' data.
 *
 * `two-chains.unit.test.ts` is NOT this. It builds a database from rc.1's
 * shared chain, which predates the managed chain, and proves the managed chain
 * ADOPTS it. Nothing in it starts from a database a managed release left
 * behind.
 *
 * WHAT IT DOES. Reads both chains out of the release (`git show <ref>:...`),
 * and the two migrators the release shipped (`migrate.ts`, `migrate-managed.ts`),
 * into a temp tree laid out like the repository. Applies them to an empty
 * database the way the API at that release did: the shared chain, then the
 * managed chain, each with its own bookkeeping table, by the release's own
 * code. Then applies this build's two chains with this build's migrators, and
 * asserts:
 *
 *   1. no file of either chain at the release is gone, and every new file
 *      sorts after the last one the release applied;
 *   2. exactly the files added since the release apply (names, count, order),
 *      and nothing the release applied is applied again or re-recorded;
 *   3. every file the release applied is still the SQL this build ships;
 *   4. the upgraded database is INDISTINGUISHABLE from a fresh install at this
 *      build: tables, columns (their order and collation too), indexes,
 *      constraints, row security and its policies, triggers, functions, views,
 *      grants, roles and comments;
 *   5. a further run of either chain applies nothing;
 *   6. the release's own migrators refuse the upgraded database wherever a
 *      chain moved on.
 *
 * **Assertion 3 is the migrator's documented behaviour, checked.** `migrate.ts`
 * records a file's NAME, never its content, and never reads a recorded file
 * again. An edit to the SQL of a file a release applied therefore reaches
 * every fresh install and no upgraded one. Assertion 4 sees that when the edit
 * changes the schema; an edit that changes data (a backfill, an UPDATE) shows
 * in no catalogue, so the files are compared as well. A change to COMMENTS is
 * harmless for the same reason the edit is dangerous (the file is never read
 * again), and there were two after alpha.1: managed 0006 and 0008 gained a
 * note pointing at 0059 (#1650). Files are compared with comments removed, and
 * a file whose comments alone changed is reported. That is looser than the
 * byte equality 0146 T3 plans for every file a release shipped; T3 decides
 * which rule holds, and this comparison follows it.
 *
 * **THERE IS NO ALLOW-LIST.** The shared gate carries one, for the tables a
 * pre-release break left behind on rc.1 (`MOVED_TO_MANAGED_CHAIN`). A release
 * after the alpha began has testers' data on it; a difference between its
 * upgrade and a fresh install is a defect, not an exception to declare
 * (0146 T4).
 *
 * WHY THE RELEASE'S OWN MIGRATORS. "Applied the way the release did" is the
 * claim, and a migrator that records versions differently (another table,
 * another lock, checksums) is precisely what would make an upgrade go wrong
 * while every file is unchanged. So the release's `migrate.ts` and
 * `migrate-managed.ts` run, not this build's. Their imports are pointed as
 * follows, and nothing else in them is touched:
 *
 * - a relative import of a file materialised here stays as it is;
 * - `@openmig/ledger` in the managed migrator becomes the release's
 *   `migrate.ts` beside it (all it imports from that package is
 *   `runMigrations`);
 * - any other relative import is this build's file at the same path. That is
 *   `db.ts`, for `pgDriver`, which a migrator uses only when it is given a
 *   connection string; every call here passes a driver;
 * - a bare third-party specifier (`pg`) resolves through the packages' own
 *   `node_modules`, linked into the temp tree, as it does in the repository;
 * - any other `@openmig/*` specifier does NOT reach the release: vitest's
 *   aliases (`vitest.aliases.ts`) catch it first and resolve it to THIS
 *   build's source. That is `@openmig/shared`, for `log`, which a migrator
 *   uses only when it is given no logger; every call here passes one.
 *
 * The temp tree's `node_modules` are symbolic links into the checkout, and
 * the removal below unlinks them without following them.
 *
 * ON PGLITE, as the shared gate runs, so it gates every pull request in the
 * unit project with nothing but git (`ci.yml` checks out with
 * `fetch-depth: 0`). The managed edition runs Postgres; 0146 T4's Postgres leg
 * is its own task.
 *
 * THE RELEASE IS `UPGRADE_FROM_REF`, or `v0.2.0-alpha.1`, the first release
 * with a managed chain. The release workflow's preflight runs this file and
 * the shared gate with the previous tag and refuses unless every
 * `skipIf(!HAVE_REF)` case executed. A ref that predates the managed chain
 * (rc.1) is refused by name: that upgrade is the adoption case above.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pgliteDriver,
  runMigrations,
  type LedgerDriver,
  type RunMigrationsResult,
} from '@openmig/ledger';
import { runManagedMigrations } from './migrate-managed.ts';

/**
 * Temp directories this file makes, and the removal that used to be missing.
 *
 * See the sweep in workplan 0099: `mkdtempSync` with no matching `rmSync`
 * leaks for the lifetime of the machine. `unit-tests` runs on the SELF-HOSTED
 * runner for pushes to main. Registered rather than removed at each call site,
 * so a new test here cannot forget. `rmSync` removes a symbolic link, never
 * what it points at, so the linked `node_modules` stay where they are.
 */
const tempDirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
}, 120_000);

// packages/managed/src -> repo root
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The release to upgrade FROM. The first one with a managed chain. */
const FROM_REF = process.env.UPGRADE_FROM_REF || 'v0.2.0-alpha.1';

/**
 * The two chains, in the order the API applies them: the shared one first,
 * because every managed table references `public.tenant` (ADR-0036).
 */
const CHAINS = ['shared', 'managed'] as const;
type Chain = (typeof CHAINS)[number];

const MIGRATIONS: Record<Chain, string> = {
  shared: 'packages/ledger/migrations',
  managed: 'packages/managed/migrations',
};

/** The migrators, as repository paths, and the packages whose dependencies they import. */
const SHARED_MIGRATOR = 'packages/ledger/src/migrate.ts';
const MANAGED_MIGRATOR = 'packages/managed/src/migrate-managed.ts';
const PACKAGES = ['packages/ledger', 'packages/managed'];

/** The shared chain's bookkeeping table: `migrate.ts`'s default, which it does not export. */
const SHARED_BOOKKEEPING = 'schema_migrations';

const quiet = (): void => {};

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** A file as the release holds it, byte for byte. */
function atRef(path: string): Buffer {
  return execFileSync('git', ['show', `${FROM_REF}:${path}`], {
    cwd: REPO_ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Is the reference reachable? A shallow clone or a missing tag is not a bug. */
function refExists(ref: string): boolean {
  try {
    git('rev-parse', '--verify', `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/** A chain's migration filenames at the release, in the order the migrator sorts them. */
function refFilenames(chain: Chain): string[] {
  const dir = MIGRATIONS[chain];
  return git('ls-tree', '--name-only', FROM_REF, `${dir}/`)
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.endsWith('.sql'))
    .map((p) => p.slice(`${dir}/`.length))
    .sort();
}

/** A chain's migration filenames in this build. */
function headFilenames(chain: Chain): string[] {
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
 */
function materialiseRelease(): string {
  if (refFilenames('managed').length === 0) {
    throw new Error(
      `${FROM_REF} has no managed chain (${MIGRATIONS.managed} is empty or absent there), so ` +
        'there is no managed database to upgrade from. A release that predates the chain ' +
        "split (ADR-0036) is the adoption case, which is two-chains.unit.test.ts's; set " +
        'UPGRADE_FROM_REF to a release from v0.2.0-alpha.1 on.',
    );
  }
  const tree = tempDir('ownpace-managed-upgrade-');
  for (const chain of CHAINS) {
    const dir = join(tree, MIGRATIONS[chain]);
    mkdirSync(dir, { recursive: true });
    for (const name of refFilenames(chain)) {
      writeFileSync(join(dir, name), atRef(`${MIGRATIONS[chain]}/${name}`));
    }
  }
  const materialised = new Set([SHARED_MIGRATOR, MANAGED_MIGRATOR]);
  for (const path of materialised) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(
      join(tree, path),
      pointImports(path, atRef(path).toString('utf8'), tree, materialised),
    );
  }
  for (const pkg of PACKAGES) {
    symlinkSync(join(REPO_ROOT, pkg, 'node_modules'), join(tree, pkg, 'node_modules'), 'dir');
  }
  return tree;
}

interface ReleaseMigrators {
  runShared(driver: LedgerDriver): Promise<RunMigrationsResult>;
  runManaged(driver: LedgerDriver): Promise<RunMigrationsResult>;
  /** The managed chain's bookkeeping table, as the release named it. */
  managedBookkeeping: string;
}

/** The release's two migrators, loaded from the temp tree, called as the API at the release called them. */
async function loadReleaseMigrators(tree: string): Promise<ReleaseMigrators> {
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
      `${FROM_REF}'s migrators do not export runMigrations, runManagedMigrations and ` +
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
function sqlWithoutComments(sql: string): string {
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

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

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
const CATALOGUE: Readonly<Record<string, string>> = {
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

async function catalogue(driver: LedgerDriver): Promise<Record<string, string[]>> {
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
async function bookkeeping(driver: LedgerDriver, table: string): Promise<string[]> {
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

const versionsOf = (rows: readonly string[]): string[] => rows.map((r) => r.split(' @ ')[0]!);

const HAVE_REF = refExists(FROM_REF);

let release: ReleaseMigrators;
let upgraded: LedgerDriver;
let fresh: LedgerDriver;
const fromRef = {} as Record<Chain, string[]>;
const added = {} as Record<Chain, string[]>;
/** The release's bookkeeping rows, read back right after the release applied its chains. */
const recordedByRelease = {} as Record<Chain, string[]>;

beforeAll(async () => {
  if (!HAVE_REF) return;
  for (const chain of CHAINS) {
    fromRef[chain] = refFilenames(chain);
    added[chain] = headFilenames(chain).filter((f) => !fromRef[chain].includes(f));
  }
  release = await loadReleaseMigrators(materialiseRelease());
  upgraded = pgliteDriver();
  fresh = pgliteDriver();
}, 180_000);

afterAll(async () => {
  await upgraded?.end();
  await fresh?.end();
});

describe(`upgrading a managed database from ${FROM_REF}, both chains (0146 T4)`, () => {
  it('can actually reach the release it upgrades from', () => {
    // The skip below is this gate's vacuous-pass hole, and this is the plug,
    // as in the shared gate. A depth-1 checkout has no tags; locally that is
    // ordinary and gets a warning, and in CI it is a broken gate.
    if (!HAVE_REF && process.env.CI) {
      throw new Error(
        `${FROM_REF} is not reachable, so the managed upgrade gate cannot run. CI must ` +
          `check out with tags (fetch-depth: 0). Set UPGRADE_FROM_REF to override.`,
      );
    }
    if (!HAVE_REF) {
      console.warn(`[managed-upgrade] ${FROM_REF} not reachable locally — gate skipped.`);
    }
    expect(true).toBe(true);
  });

  it.skipIf(!HAVE_REF)('knows what each chain added since the release, and lost nothing', () => {
    expect(fromRef.shared.length).toBeGreaterThan(0);
    expect(fromRef.managed.length).toBeGreaterThan(0);
    for (const chain of CHAINS) {
      const head = headFilenames(chain);
      // Migrations are append-only: a database the release built has run
      // every one of these, and without the file its schema cannot be rebuilt.
      expect(
        fromRef[chain].filter((f) => !head.includes(f)),
        `the ${chain} chain lost files ${FROM_REF} applied`,
      ).toEqual([]);
      // A new file that sorts below the release's last one applies AFTER it on
      // an upgraded database and BEFORE it on a fresh one: two orders, two
      // possible schemas, and a number that says nothing about when it ran.
      const last = fromRef[chain][fromRef[chain].length - 1]!;
      expect(
        added[chain].filter((f) => f < last),
        `new ${chain} migrations sort before ${last}, the last one ${FROM_REF} applied`,
      ).toEqual([]);
    }
    const total = added.shared.length + added.managed.length;
    console.info(
      `[managed-upgrade] ${FROM_REF} -> this build: shared chain ${fromRef.shared.length} -> ` +
        `${fromRef.shared.length + added.shared.length} (${added.shared.length} added), managed ` +
        `chain ${fromRef.managed.length} -> ${fromRef.managed.length + added.managed.length} ` +
        `(${added.managed.length} added).`,
    );
    if (total === 0) {
      console.warn(
        `[managed-upgrade] ${FROM_REF} and this build carry the SAME migrations on both chains. ` +
          'This run proves the mechanics and exercises NO migration.',
      );
    }
  });

  it.skipIf(!HAVE_REF)(
    "applies the release's two chains with the release's own migrators, shared first",
    { timeout: 120_000 },
    async () => {
      const shared = await release.runShared(upgraded);
      expect(shared.applied).toEqual(fromRef.shared);
      const managed = await release.runManaged(upgraded);
      expect(managed.applied).toEqual(fromRef.managed);

      recordedByRelease.shared = await bookkeeping(upgraded, SHARED_BOOKKEEPING);
      recordedByRelease.managed = await bookkeeping(upgraded, release.managedBookkeeping);
      expect(versionsOf(recordedByRelease.shared)).toEqual(fromRef.shared);
      expect(versionsOf(recordedByRelease.managed)).toEqual(fromRef.managed);
    },
  );

  it.skipIf(!HAVE_REF)(
    "applies only the files added since, with this build's migrators, and re-applies nothing",
    { timeout: 120_000 },
    async () => {
      const shared = await runMigrations({ driver: upgraded, logger: quiet });
      const managed = await runManagedMigrations({ driver: upgraded, logger: quiet });
      const ran: Record<Chain, RunMigrationsResult> = { shared, managed };

      for (const chain of CHAINS) {
        // Names, count and order: exactly the new files, in the order the
        // migrator sorts them, and none of the release's.
        expect(ran[chain].applied, `the ${chain} chain applied something other than its new files`).toEqual(
          added[chain],
        );
        expect(
          [...ran[chain].alreadyApplied].sort(),
          `this build's ${chain} migrator does not read what ${FROM_REF} recorded as applied`,
        ).toEqual(fromRef[chain]);
      }

      // And the release's own rows are as the release wrote them: nothing
      // re-recorded, nothing re-dated, nothing dropped.
      const table: Record<Chain, string> = {
        shared: SHARED_BOOKKEEPING,
        managed: release.managedBookkeeping,
      };
      for (const chain of CHAINS) {
        const now = await bookkeeping(upgraded, table[chain]);
        expect(
          now.filter((row) => fromRef[chain].includes(versionsOf([row])[0]!)),
          `the ${chain} chain's bookkeeping rows from ${FROM_REF} changed`,
        ).toEqual(recordedByRelease[chain]);
        expect(versionsOf(now)).toEqual([...fromRef[chain], ...added[chain]]);
      }
    },
  );

  it.skipIf(!HAVE_REF)("keeps every file the release applied the SQL it applied", () => {
    // The migrator records a name and never reads that file again, so this is
    // the only place a change to an applied file can be seen at all.
    const changed: string[] = [];
    const notesOnly: string[] = [];
    for (const chain of CHAINS) {
      for (const name of fromRef[chain]) {
        const path = `${MIGRATIONS[chain]}/${name}`;
        // A file that is gone is the first case's failure, said there.
        if (!existsSync(join(REPO_ROOT, path))) continue;
        const then = atRef(path);
        const now = readFileSync(join(REPO_ROOT, path));
        if (sha256(then) === sha256(now)) continue;
        if (sqlWithoutComments(then.toString('utf8')) === sqlWithoutComments(now.toString('utf8'))) {
          notesOnly.push(path);
        } else {
          changed.push(path);
        }
      }
    }
    if (notesOnly.length > 0) {
      console.info(
        `[managed-upgrade] comments changed since ${FROM_REF}, SQL unchanged: ${notesOnly.join(', ')}`,
      );
    }
    expect(
      changed,
      `the SQL of a migration ${FROM_REF} applied has changed. An upgraded database recorded ` +
        'that file as applied and will never run it again, so the change reaches fresh ' +
        'installs only. Put the file back as it was and write the change as a new migration.\n' +
        changed.map((p) => `  - ${p}`).join('\n'),
    ).toEqual([]);
  });

  it.skipIf(!HAVE_REF)(
    'lands on the schema a fresh install of this build has',
    { timeout: 120_000 },
    async () => {
      await runMigrations({ driver: fresh, logger: quiet });
      await runManagedMigrations({ driver: fresh, logger: quiet });

      const up = await catalogue(upgraded);
      const at = await catalogue(fresh);
      expect(at.relations!.length, 'the fresh install has no tables: the catalogue read nothing').toBeGreaterThan(40);
      expect(at.policies!.length, 'the fresh install has no policies: the catalogue read nothing').toBeGreaterThan(40);
      expect(at.comments!.length, 'the fresh install has no comments: the catalogue read nothing').toBeGreaterThan(50);
      console.info(
        `[managed-upgrade] compared with a fresh install: ` +
          Object.keys(CATALOGUE)
            .map((kind) => `${at[kind]!.length} ${kind}`)
            .join(', ') +
          '.',
      );

      for (const kind of Object.keys(CATALOGUE)) {
        const upSet = new Set(up[kind]);
        const atSet = new Set(at[kind]);
        const missing = at[kind]!.filter((line) => !upSet.has(line));
        const extra = up[kind]!.filter((line) => !atSet.has(line));
        expect(
          { missing, extra },
          `${kind}: an upgraded database differs from a fresh install of this build. ` +
            '"missing" is in the fresh install and not the upgraded one (the usual cause: an ' +
            'applied migration edited instead of a new one written); "extra" is the reverse ' +
            '(a new migration that undoes or skips something only for upgraded databases).',
        ).toEqual({ missing: [], extra: [] });
      }

      // The same versions recorded, on both routes, in both ledgers.
      for (const table of [SHARED_BOOKKEEPING, release.managedBookkeeping]) {
        expect(versionsOf(await bookkeeping(upgraded, table))).toEqual(
          versionsOf(await bookkeeping(fresh, table)),
        );
      }
    },
  );

  it.skipIf(!HAVE_REF)('applies nothing on a further run of either chain', { timeout: 60_000 }, async () => {
    // Every API start re-runs both chains.
    expect((await runMigrations({ driver: upgraded, logger: quiet })).applied).toEqual([]);
    expect((await runManagedMigrations({ driver: upgraded, logger: quiet })).applied).toEqual([]);
  });

  it.skipIf(!HAVE_REF)(
    "the release's own migrators refuse the upgraded database wherever a chain moved on",
    { timeout: 60_000 },
    async () => {
      // §22.1: a build refuses a schema newer than it understands. Rolling the
      // API back to the release is what an operator reaches for when an upgrade
      // goes wrong, and it is the release's code that has to say no.
      const run = { shared: release.runShared, managed: release.runManaged };
      for (const chain of CHAINS) {
        if (added[chain].length > 0) {
          await expect(run[chain](upgraded), `${FROM_REF}'s ${chain} migrator`).rejects.toThrow(
            /newer than this build understands/,
          );
        } else {
          // Nothing new on this chain, so the release is not behind on it:
          // it must accept the database and apply nothing.
          expect((await run[chain](upgraded)).applied).toEqual([]);
        }
      }
    },
  );
});

describe('the comparison of an applied file reads past comments and nothing else', () => {
  it('drops line and nested block comments, and collapses whitespace', () => {
    expect(sqlWithoutComments('-- a note\nCREATE  TABLE t (\n  a int -- why\n);\n')).toBe(
      'CREATE TABLE t ( a int );',
    );
    expect(sqlWithoutComments('SELECT /* outer /* inner */ still */ 1;')).toBe('SELECT 1;');
    expect(sqlWithoutComments('-- only a note\n')).toBe('');
  });

  it('keeps strings, quoted names and dollar-quoted bodies exactly, comments in them included', () => {
    expect(sqlWithoutComments("SELECT '--  kept', 'it''s -- kept';")).toBe(
      "SELECT '--  kept', 'it''s -- kept';",
    );
    expect(sqlWithoutComments("SELECT E'\\' -- kept';")).toBe("SELECT E'\\' -- kept';");
    expect(sqlWithoutComments('SELECT 1 AS "a -- b";')).toBe('SELECT 1 AS "a -- b";');
    const body = 'CREATE FUNCTION f() RETURNS int AS $fn$\n  -- in the body\n  SELECT 1;\n$fn$ LANGUAGE sql;';
    expect(sqlWithoutComments(body)).toBe(
      'CREATE FUNCTION f() RETURNS int AS $fn$\n  -- in the body\n  SELECT 1;\n$fn$ LANGUAGE sql;',
    );
    expect(sqlWithoutComments('SELECT $$ /* kept */ $$, $1;')).toBe('SELECT $$ /* kept */ $$, $1;');
  });

  it('tells a changed statement from a changed note', () => {
    const was = '-- v1\nALTER TABLE t ADD COLUMN a int;\n';
    expect(sqlWithoutComments('-- v2, longer\n\nALTER TABLE t ADD COLUMN a int; -- see 0059\n')).toBe(
      sqlWithoutComments(was),
    );
    expect(sqlWithoutComments('-- v1\nALTER TABLE t ADD COLUMN a bigint;\n')).not.toBe(
      sqlWithoutComments(was),
    );
    expect(sqlWithoutComments("UPDATE t SET a = 'x';")).not.toBe(sqlWithoutComments("UPDATE t SET a = 'x ';"));
  });

  it('refuses SQL it cannot read to the end, rather than guessing', () => {
    expect(() => sqlWithoutComments("SELECT 'open")).toThrow(/unterminated/);
    expect(() => sqlWithoutComments('SELECT /* open')).toThrow(/unterminated/);
    expect(() => sqlWithoutComments('SELECT $x$ open')).toThrow(/unterminated/);
  });
});
