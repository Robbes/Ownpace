// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A command the docs told you to run, that wrote a migration nobody can apply.
 *
 * `package.json` carried `"db:generate": "drizzle-kit generate"` from the first
 * slice onward, and workplan 0001 T0's acceptance criteria still name
 * `pnpm db:migrate`. Neither has been how this repository authors or applies
 * migrations since `runMigrations` landed in 0010 T1 — but a script nobody runs
 * looks like a script that costs nothing, so both stayed.
 *
 * ## What running it did, measured 2026-09-09
 *
 * `drizzle.config.ts` pointed `out` at `packages/ledger/migrations` — the real
 * chain. Against a copy of that directory, `drizzle-kit generate` wrote
 * `0000_silly_iceman.sql` (30 KB of `CREATE TABLE`, a fresh random name each
 * run) plus `meta/`, and **exited 0**.
 *
 * `listMigrationVersions` sorts the directory, and `"0000_"` sorts BELOW
 * `"0001_baseline.sql"`. So the generated dump becomes the first migration in
 * the chain and the baseline then fails on tables that already exist. The error
 * names `0001_baseline.sql`, a file nobody touched, instead of the command.
 *
 * `drizzle-kit check` was not innocent either: it wrote an empty
 * `meta/_journal.json` into the chain directory, untracked and NOT gitignored —
 * one `git add -A` from being committed.
 *
 * ## What these tests hold, and how each can rot
 *
 *  1. **Nothing sorts below either baseline.** The durable property. It catches
 *     the artifact however it arrived — the pnpm script, a bare `npx
 *     drizzle-kit generate`, or a hand-numbered file someone started at 0000.
 *  2. **`out` does not name a migration chain.** Restoring it re-arms the trap
 *     for anyone invoking drizzle-kit directly, where no pnpm script can refuse.
 *  3. **The scripts refuse instead of invoking drizzle-kit**, and the refusal
 *     names the real workflow. A refusal that just says no sends the reader
 *     back to the stale doc that got them here.
 *  4. **The refusal exits non-zero.** The whole defect was a false green.
 *  5. **The chains hold nothing but numbered SQL**, and the debris is ignored,
 *     so the two ways it can arrive are both closed.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMigrationVersions } from '../packages/ledger/src/migrate.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8');

/** Both chains, and the file each one must begin with. ADR-0016 / ADR-0036. */
const CHAINS = [
  { dir: 'packages/ledger/migrations', baseline: '0001_baseline.sql' },
  { dir: 'packages/managed/migrations', baseline: '0001_the_managed_service.sql' },
] as const;

const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

describe('migrations are hand-written, and the tooling can no longer say otherwise', () => {
  it.each(CHAINS)('nothing in $dir sorts below its baseline', ({ dir, baseline }) => {
    // The mechanism, stated rather than implied: the runner applies files in
    // sorted order, and a generated "0000_" file wins that sort.
    expect(['0001_baseline.sql', '0000_silly_iceman.sql'].sort()[0]).toBe('0000_silly_iceman.sql');

    // listMigrationVersions is the real sorter runMigrations uses — not a
    // re-implementation of it here, which could agree with the code and both
    // be wrong.
    const versions = listMigrationVersions(join(repoRoot, dir));
    expect(
      versions[0],
      `${versions[0]} sorts below ${baseline}, so runMigrations would apply it FIRST and the ` +
        'baseline would then fail on tables that already exist. If drizzle-kit wrote it, ' +
        'delete it: see scripts/how-migrations-are-authored.mjs.',
    ).toBe(baseline);
    expect(versions.length).toBeGreaterThan(1);
  });

  it('drizzle.config.ts sends drizzle-kit output away from both chains', () => {
    const config = read('drizzle.config.ts');
    const out = /out:\s*'([^']+)'/.exec(config)?.[1];
    expect(out, 'drizzle.config.ts must declare an out path').toBeTruthy();
    for (const { dir } of CHAINS) {
      expect(out, `out points at the ${dir} chain — the trap this closed`).not.toContain(dir);
    }
    // `generate` is not the only writer: `check` drops a meta/_journal.json in
    // `out` too, so the path has to be genuinely disposable — which means git
    // ignores it. Checked by path rather than by name, so renaming the
    // directory is fine and forgetting to ignore it is not.
    const outPath = out!.replace(/^\.\//, '').replace(/\/$/, '');
    const escaped = outPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(
      read('.gitignore'),
      `drizzle-kit writes to ${outPath} and git does not ignore it`,
    ).toMatch(new RegExp(`^/?${escaped}/?$`, 'm'));
  });

  it('db:generate and db:migrate refuse rather than run drizzle-kit', () => {
    for (const name of ['db:generate', 'db:migrate']) {
      const script = pkg.scripts[name];
      expect(script, `${name} is gone; the stale docs that name it now say nothing`).toBeTruthy();
      expect(script, `${name} still invokes drizzle-kit`).not.toMatch(/drizzle-kit/);
      expect(script).toContain('scripts/how-migrations-are-authored.mjs');
    }
  });

  it('the refusal exits non-zero and names the workflow that replaced it', () => {
    // Exit code first: the defect was a documented command reporting success
    // while leaving the chain unapplicable.
    let status = 0;
    let stderr = '';
    try {
      execFileSync('node', ['scripts/how-migrations-are-authored.mjs', 'db:generate'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      status = e.status ?? 0;
      stderr = e.stderr ?? '';
    }
    expect(status, 'a refusal that exits 0 is the defect again').toBe(1);

    // A refusal that only says no sends the reader back to the stale doc.
    expect(stderr).toContain('runMigrations');
    expect(stderr).toContain('schema_migrations');
    expect(stderr).toContain('scripts/squash-migrations.sh');
    expect(stderr).toContain('packages/managed/migrations/');
  });

  it.each(CHAINS)('$dir holds nothing but numbered SQL', ({ dir }) => {
    const stray = readdirSync(join(repoRoot, dir)).filter((f) => !/^\d{4}_.+\.sql$/.test(f));
    expect(stray, `drizzle-kit debris in the chain: ${stray.join(', ')}`).toEqual([]);
  });

  it('the operative layer names the runner that actually applies migrations', () => {
    // This is where the trap was ARGUED, not just left lying around. ADR-0017's
    // bullet read "Drizzle Kit authors and applies migrations", ADR-0038
    // assembles operative bullets into OPERATIVE.md, and the result was a live
    // instruction — to humans and agents alike — pointing at the command that
    // damaged the chain.
    //
    // Asserted against the ASSEMBLED file rather than one ADR, because which
    // ADR carries the rule is allowed to change and did: the owner superseded
    // 0017 with 0045 on 2026-09-09 rather than amend its bullet, "since the
    // ADR's need to reflect our decisions and may change over time". What must
    // not change is what a reader of the operative layer is told.
    const operative = read('docs/adr/OPERATIVE.md');
    expect(operative).toContain('runMigrations');
    expect(operative).toMatch(/hand-written/i);
    expect(
      operative,
      'the operative layer claims drizzle-kit authors and applies migrations again',
    ).not.toMatch(/Drizzle Kit\*\* authors and applies/);
  });

  it('and if it is ever written into a chain again, git will not carry it', () => {
    // The belt beside the braces: `out` no longer reaches a chain, but a bare
    // `npx drizzle-kit ... --config` with someone's own config still can, and
    // an untracked meta/ next to the migrations is one `git add -A` from being
    // committed. That is how it was found.
    expect(read('.gitignore')).toContain('packages/*/migrations/meta/');
  });
});
