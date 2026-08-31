// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A documented command must be runnable, and a wrapper must compose what a
 * host-run script cannot inherit.
 *
 * `docs/managed-bring-up.md` §8c told an operator to appoint themselves with:
 *
 *   DATABASE_URL="$(grep '^DATABASE_URL=' deploy/compose/.env | cut -d= -f2-)" \
 *     pnpm --filter @openmig/api operator:add …
 *
 * That could not work on ANY stack. `managed.yml` COMPOSES DATABASE_URL for the
 * api service out of POSTGRES_USER/POSTGRES_PASSWORD/DB_HOST/DB_PORT/POSTGRES_DB
 * (line 742), so `.env` has never carried such a line. The grep returned the
 * empty string, the assignment SUCCEEDED, and the script then refused for a
 * requirement the reader had just apparently satisfied — the worst shape a
 * refusal can have. Found 2026-08-31 by the owner, on the Spark, following the
 * document exactly.
 *
 * Two guards, because there are two ways for this to come back:
 *
 *   1. A doc recipe reads a key out of `.env` that `managed.env.example` does
 *      not ship. That is the general rule, and it is checked over every doc.
 *   2. `operator.sh` stops composing the connection the way `seed-managed.sh`
 *      does — from the parts, at the port compose REPORTS. That one is proved
 *      by running it against stubs rather than by reading it.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, copyFileSync, mkdirSync, chmodSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');
const envExample = readFileSync(join(COMPOSE_DIR, 'managed.env.example'), 'utf8');
const operatorSh = readFileSync(join(COMPOSE_DIR, 'operator.sh'), 'utf8');
const operatorTs = readFileSync(join(REPO_ROOT, 'apps/api/src/scripts/operator.ts'), 'utf8');

/** Every .md under docs/, recursively. */
function docs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return docs(p);
    return e.name.endsWith('.md') ? [p] : [];
  });
}

describe('no documented recipe reads a key the env file does not carry', () => {
  // `grep '^KEY='  …  .env`, in any of the quoting styles the docs use.
  const RECIPE = /grep\s+(?:-[A-Za-z]+\s+)*['"]\^([A-Z0-9_]+)=['"][^|\n]*\.env/g;

  const found = docs(join(REPO_ROOT, 'docs')).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(RECIPE)].map((m) => ({
      file: relative(REPO_ROOT, file),
      key: m[1]!,
      line: text.slice(0, m.index).split('\n').length,
    }));
  });

  it('found recipes to check', () => {
    // Vacuity guard: if the pattern stops matching, every case below passes on
    // an empty list and this test silently stops testing.
    expect(found.length, 'no `grep ^KEY= … .env` recipes found in docs/').toBeGreaterThan(0);
  });

  it.each(found.map((f) => [`${f.file}:${f.line}`, f.key] as const))(
    '%s reads %s, which managed.env.example ships',
    (_where, key) => {
      // A key compose COMPOSES (DATABASE_URL) or that nothing writes is not in
      // the file, so the recipe yields "" and whatever follows is built on it.
      expect(
        new RegExp(`^${key}=`, 'm').test(envExample),
        `managed.env.example ships no ${key}= line, so this recipe reads an empty string`,
      ).toBe(true);
    },
  );

  it('DATABASE_URL in particular is composed, not stored — the case that started this', () => {
    expect(/^DATABASE_URL=/m.test(envExample)).toBe(false);
    expect(readFileSync(join(COMPOSE_DIR, 'managed.yml'), 'utf8')).toMatch(
      /DATABASE_URL:\s*postgresql:\/\/\$\{POSTGRES_USER/,
    );
  });
});

describe('operator.sh composes what the host cannot inherit', () => {
  it('is executable, or nobody can run the command the docs print', () => {
    expect(statSync(join(COMPOSE_DIR, 'operator.sh')).mode & 0o111).toBeGreaterThan(0);
  });

  it('never reads DATABASE_URL out of the env file — the bug it exists to end', () => {
    // COMMENT LINES ARE EXEMPT, and deliberately: this script's header quotes
    // the broken recipe verbatim to explain why the wrapper exists, which is
    // documentation rather than a read. Only executable lines are checked.
    const code = operatorSh
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/grep[^|\n]*DATABASE_URL[^|\n]*\.env/);
    // ...and the exemption is not a hole: the header really does still carry
    // the explanation, so a future edit cannot quietly drop the reasoning.
    expect(operatorSh).toContain("grep '^DATABASE_URL='");
  });

  it("the script's own REFUSAL names the wrapper, not just the variable", () => {
    // Scoped to `connectionString`, where the throw is. Asserting the path
    // appears anywhere in the file would pass on a refusal that had lost it
    // while the header still mentioned it — which is exactly what a break test
    // showed, so the first version of this guard could not fail properly.
    const fn = operatorTs.slice(
      operatorTs.indexOf('function connectionString'),
      operatorTs.indexOf('interface OperatorRow'),
    );
    expect(fn.length, 'connectionString not found — this guard would be vacuous').toBeGreaterThan(100);
    // "set DATABASE_URL" sends somebody to a file that does not contain it.
    expect(fn).toContain('./deploy/compose/operator.sh');
  });

  /**
   * Run it for real against stubs. Copied to a temp dir so SCRIPT_DIR points
   * there: this must NEVER read or write the real deploy/compose/.env, which on
   * a developer's machine is the live configuration.
   */
  const made: string[] = [];
  afterAll(() => {
    // A PGlite data directory is 41MB and these run on the self-hosted runner,
    // which also has to keep ~15GB free for the managed stack. Cheap here —
    // these dirs hold four small files — but the rule is the rule, and
    // `tests-clean-up-after-themselves` caught this one the first time it ran.
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  function runWrapper(portLine: string, args: string[]): { out: string; code: number } {
    const dir = mkdtempSync(join(tmpdir(), 'operator-sh-'));
    made.push(dir);
    copyFileSync(join(COMPOSE_DIR, 'operator.sh'), join(dir, 'operator.sh'));
    writeFileSync(join(dir, 'managed.yml'), '# stub, read by the stub docker only\n');
    writeFileSync(
      join(dir, '.env'),
      'POSTGRES_USER=owneruser\nPOSTGRES_PASSWORD=ownerpw\nPOSTGRES_DB=ownerdb\n',
    );
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    // compose answers `0.0.0.0:<port>`; the wrapper must take the port and NOT
    // the 0.0.0.0, which is not an address to connect to.
    writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash\necho '${portLine}'\n`);
    // Stands in for the real runner: reports what it was handed.
    writeFileSync(
      join(bin, 'pnpm'),
      '#!/usr/bin/env bash\necho "URL=$DATABASE_URL"\necho "ARGV=$*"\n',
    );
    chmodSync(join(bin, 'docker'), 0o755);
    chmodSync(join(bin, 'pnpm'), 0o755);
    const r = spawnSync('bash', [join(dir, 'operator.sh'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status ?? -1 };
  }

  it('builds the owner connection at the port compose REPORTS, not 5432', () => {
    // The reference box publishes this stack's Postgres on 55432 while an
    // unrelated service owns 5432 — so a guessed port is a different database
    // that may well answer.
    const { out, code } = runWrapper('0.0.0.0:55432', ['list']);
    expect(code).toBe(0);
    expect(out).toContain('URL=postgresql://owneruser:ownerpw@localhost:55432/ownerdb');
    expect(out).not.toContain('0.0.0.0:55432/');
  });

  it('passes the sub-command and its arguments straight through, IN ORDER', () => {
    /**
     * THE POSITION IS THE WHOLE POINT, and the first version of this test did
     * not check it. It asserted that `operator:add` appeared and that the
     * arguments appeared, with `.*` between them — which stayed green while
     * the wrapper sent
     *
     *     pnpm … operator:add -- sub-abc me@example.invalid a note
     *
     * because pnpm FORWARDS `--` instead of consuming it. Every argument
     * shifted one place: `user_id` became the literal `--`, the subject went
     * into the email column and the email into the note. The appointment
     * matched nobody, `/api/me` answered `operator: false`, the nav correctly
     * hid the operator screens, and the script printed "may now read the
     * access queue" both times it happened (2026-08-31).
     *
     * A loose assertion is how a guard watches the right file and proves the
     * wrong thing. This one pins the exact line.
     */
    const { out } = runWrapper('0.0.0.0:55432', ['add', 'sub-abc', 'me@example.invalid', 'a', 'note']);
    const argv = out.split('\n').find((l) => l.startsWith('ARGV='));
    expect(argv, 'the pnpm stub reported no ARGV line').toBeDefined();
    // The stub echoes `$*`, so pnpm's OWN flags (--dir, --filter) lead the line
    // and the repo root varies with the temp dir. What is pinned is the tail:
    // the sub-command immediately followed by the arguments, nothing between.
    expect(argv).toMatch(/operator:add sub-abc me@example\.invalid a note$/);
    // Said separately, because this is the failure and it deserves its own
    // sentence when it comes back.
    expect(
      argv,
      'the wrapper passes `--` before the arguments again. pnpm forwards it, so\n' +
        'every value shifts one place and the appointment goes to nobody.',
    ).not.toContain(' -- ');
  });

  it('refuses with the three sub-commands when given none', () => {
    const { out, code } = runWrapper('0.0.0.0:55432', []);
    expect(code).toBe(1);
    for (const verb of ['list', 'add', 'remove']) expect(out).toContain(`operator.sh ${verb}`);
  });

  it('refuses, rather than guessing a port, when compose reports nothing', () => {
    const { out, code } = runWrapper('', ['list']);
    expect(code).toBe(1);
    expect(out).toContain('could not determine the published host port');
  });
});
