// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CHAIN THAT ONLY GROWS: nothing said when pre-release ended, so nothing refused a squash, an edit or a deletion of a migration a release had shipped, and the squash script's own advice was to drop a database that would not start (workplan 0146 T3, ADR-0045).
 *
 * ## Why it matters
 *
 * The migrator records a migration's NAME and never reads that file again.
 * So an edit to a file a release applied reaches fresh installs only, and a
 * squash or a deletion leaves every database that recorded the old names
 * refused by the downgrade guard. Before any release that was a shrug: drop
 * the database and start again. From `v0.2.0-alpha.1` on, `ownpace-live` ran
 * a release, and a managed database holds organisations, stored credentials
 * and the audit log, none of which a target rebuilds.
 *
 * On 2026-09-24 the plan found three texts that still assumed nothing was
 * live: `squash-migrations.sh`, which said a refused database "must be
 * dropped and recreated" and refused nothing; ADR-0045's operative rule,
 * "Pre-release only, `scripts/squash-migrations.sh` folds the chain", with
 * nothing saying when that ended; and the runner's refusal, which named a
 * squash as a cause. And the managed chain had no byte-for-byte comparison
 * with any release at all: only its upgrade proof (0146 T4), which compares
 * SQL with the comments read away.
 *
 * ## What this holds
 *
 * - `squash-migrations.sh` refuses, exit 1, naming ADR-0045 and the tag
 *   `scripts/release-line.json` names as `preReleaseEndedAt`, before it
 *   reads `ADMIN_URL` or runs anything: with stub `psql`, `pg_dump`,
 *   `createdb` and `docker` first on `PATH`, none is called, and the copy of
 *   the chain beside it is untouched. It runs a copy of the script in a temp
 *   tree, never the one in place (the reason is at `runSquash`).
 * - ADR-0045's operative rules, and `OPERATIVE.md`, name that tag and no
 *   longer say "Pre-release only, … folds the chain".
 * - The runner's downgrade refusal names no squash and never "nothing
 *   irreplaceable" (its behaviour is read in `migrate-upgrade.unit.test.ts`).
 * - Both chains, against every release `release-line.json` lists from
 *   `preReleaseEndedAt` on: every file such a release shipped is still in the
 *   tree, byte for byte as the NEWEST of those releases shipped it. Against
 *   an older one it may differ only in its comments, and only because a
 *   later release already shipped the difference; the files it differs in
 *   are printed. That is history already made, not an allow-list: managed
 *   0006 and 0008 gained a note after alpha.1 (#1650), alpha.2 and alpha.3
 *   shipped it, and alpha.1's bytes cannot come back without breaking
 *   theirs. Going forward the newest release's bytes are the rule, so a note
 *   added to a shipped file today is refused like any other edit.
 *
 * Under `CI` every listed release from `preReleaseEndedAt` on must resolve
 * (the unit job checks out with `fetch-depth: 0`), apart from the last when
 * it is the version being prepared; locally a missing tag is a warning, as
 * in the upgrade gates. `v0.1.0-rc.1` is outside the rule: its baseline was
 * edited after it shipped (ADR-0036), and the shared upgrade gate carries
 * the allow-list for that.
 *
 * The comparison is a function of its own, `judgeChains`, held here to
 * synthetic releases too, so each way it can be wrong is shown without
 * editing a migration.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReleaseLine, releasedOnly, rootVersion } from '../packages/ledger/src/__tests__/release-line.ts';
import { sqlWithoutComments } from '../packages/managed/src/__tests__/upgrade-from-a-release.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const CHAIN_DIRS = ['packages/ledger/migrations', 'packages/managed/migrations'] as const;

function git(...args: string[]): Buffer {
  return execFileSync('git', args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
}

function isTagged(ref: string): boolean {
  try {
    git('rev-parse', '--verify', '-q', `refs/tags/${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/** A migration file as one release, or the tree, holds it. */
export interface Shipped {
  /** Repository path, e.g. `packages/managed/migrations/0006_….sql`. */
  path: string;
  /** Oldest first: each release that shipped the file, with its bytes there. */
  releases: Array<{ tag: string; bytes: Buffer }>;
  /** The working tree's bytes, or null when the file is gone. */
  head: Buffer | null;
}

export interface ChainVerdict {
  /** Files a release shipped that the tree no longer has. */
  gone: string[];
  /** Files whose bytes differ from the newest release that shipped them. */
  edited: Array<{ path: string; newest: string }>;
  /** Files an older release shipped with a different STATEMENT from the newest. */
  rewritten: Array<{ path: string; older: string; newest: string }>;
  /** Files an older release shipped with other comments; printed, not refused. */
  notesSince: Array<{ path: string; older: string; newest: string }>;
  compared: number;
}

/** The rule, over files as releases shipped them. */
export function judgeChains(files: readonly Shipped[]): ChainVerdict {
  const verdict: ChainVerdict = { gone: [], edited: [], rewritten: [], notesSince: [], compared: 0 };
  for (const file of files) {
    const newest = file.releases[file.releases.length - 1];
    if (!newest) continue;
    verdict.compared += 1;
    if (file.head === null) {
      verdict.gone.push(file.path);
      continue;
    }
    if (!file.head.equals(newest.bytes)) verdict.edited.push({ path: file.path, newest: newest.tag });
    for (const older of file.releases.slice(0, -1)) {
      if (older.bytes.equals(newest.bytes)) continue;
      const same = sqlWithoutComments(older.bytes.toString('utf8')) === sqlWithoutComments(newest.bytes.toString('utf8'));
      (same ? verdict.notesSince : verdict.rewritten).push({ path: file.path, older: older.tag, newest: newest.tag });
    }
  }
  return verdict;
}

describe('squash-migrations.sh refuses, before it reads or runs anything', () => {
  const line = readReleaseLine(ROOT);

  /**
   * Runs a COPY of the script, laid out like the repository in a temp tree
   * with a copy of the shared chain, with stubs first on PATH that record
   * every call and fail. Never the script in place: a script that stopped
   * refusing would squash the chain it finds beside it, and on 2026-10-31
   * the first mutation check of this guard, run against the script in
   * place, did exactly that to the working tree's shared chain: 64 files
   * deleted and `0001_baseline.sql` rewritten from an empty dump (the stubs
   * succeeded, and two empty dumps compare equal). Here it can only reach
   * the copy, and the stubs fail besides.
   */
  function runSquash(args: string[], env: Record<string, string>): {
    status: number | null;
    stderr: string;
    calls: string;
    chainChanged: boolean;
  } {
    const dir = mkdtempSync(join(tmpdir(), 'squash-refuses-'));
    try {
      const repo = join(dir, 'repo');
      const chain = join(repo, 'packages/ledger/migrations');
      mkdirSync(join(repo, 'scripts'), { recursive: true });
      mkdirSync(chain, { recursive: true });
      for (const file of ['scripts/squash-migrations.sh', 'scripts/release-line.json']) {
        copyFileSync(join(ROOT, file), join(repo, file));
      }
      const before = new Map<string, string>();
      for (const name of readdirSync(join(ROOT, 'packages/ledger/migrations'))) {
        const text = readFileSync(join(ROOT, 'packages/ledger/migrations', name), 'utf8');
        writeFileSync(join(chain, name), text);
        before.set(name, text);
      }
      const stubs = join(dir, 'bin');
      mkdirSync(stubs);
      const log = join(dir, 'calls.log');
      writeFileSync(log, '');
      for (const tool of ['psql', 'pg_dump', 'createdb', 'dropdb', 'docker']) {
        const stub = join(stubs, tool);
        writeFileSync(stub, `#!/usr/bin/env bash\necho "${tool} $*" >> "${log}"\nexit 1\n`);
        chmodSync(stub, 0o755);
      }
      const run = spawnSync('bash', [join(repo, 'scripts/squash-migrations.sh'), ...args], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, ...env, PATH: `${stubs}:${process.env.PATH ?? ''}` },
      });
      const after = readdirSync(chain);
      const chainChanged =
        after.length !== before.size || after.some((name) => readFileSync(join(chain, name), 'utf8') !== before.get(name));
      return { status: run.status, stderr: run.stderr, calls: readFileSync(log, 'utf8'), chainChanged };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    ['--apply, with ADMIN_URL', ['--apply'], { ADMIN_URL: 'postgres://postgres@127.0.0.1:1' }],
    ['a dry run, with ADMIN_URL', [], { ADMIN_URL: 'postgres://postgres@127.0.0.1:1' }],
    ['without ADMIN_URL', [], { ADMIN_URL: '' }],
  ] as const)('%s', (_name, args, env) => {
    const { status, stderr, calls, chainChanged } = runSquash([...args], { ...env });
    expect(calls, 'the script reached a database tool before it refused').toBe('');
    expect(chainChanged, 'the script changed the chain beside it').toBe(false);
    expect(status, 'a refusal that exits anything but 1 reads as another failure').toBe(1);
    expect(stderr).toContain('ADR-0045');
    expect(stderr).toContain(line.preReleaseEndedAt);
    expect(stderr).toMatch(/never a drop/);
  });
});

describe('the texts say pre-release ended, and at which tag', () => {
  const line = readReleaseLine(ROOT);

  it('release-line.json names a listed release as the end of pre-release', () => {
    expect(line.releases).toContain(line.preReleaseEndedAt);
  });

  it("ADR-0045's operative rules, and OPERATIVE.md, name the tag and no longer allow a squash", () => {
    const adr = read('docs/adr/0045-migrations-are-hand-written-sql.md');
    const operative = /## Operative rules\n([\s\S]*?)\n## /.exec(adr)?.[1] ?? '';
    expect(operative, "ADR-0045 has no operative section this can read").not.toBe('');
    for (const [where, text] of [
      ['ADR-0045', operative],
      ['OPERATIVE.md', read('docs/adr/OPERATIVE.md')],
    ] as const) {
      expect(text, `${where} does not name the tag pre-release ended with`).toContain(
        `Pre-release ended with \`${line.preReleaseEndedAt}\``,
      );
      expect(text, `${where} still allows a squash`).not.toMatch(/Pre-release only,[^\n]*folds the chain/);
    }
  });

  it("the runner's downgrade refusal names no squash and never 'nothing irreplaceable'", () => {
    const source = read('packages/ledger/src/migrate.ts');
    const at = source.indexOf('is newer than this build understands');
    expect(at, 'the downgrade refusal is not where this reads it').toBeGreaterThan(0);
    const message = source.slice(at, source.indexOf(');', at));
    expect(message).not.toMatch(/squash/i);
    expect(message).not.toMatch(/nothing irreplaceable/i);
    expect(message).toMatch(/restored from a backup, never dropped/);
  });

  it('the db:generate refusal and the README say it too', () => {
    expect(read('scripts/how-migrations-are-authored.mjs')).toContain(
      `Pre-release ended with ${line.preReleaseEndedAt}`,
    );
    expect(read('README.md')).toContain(`In alpha since \`${line.preReleaseEndedAt}\``);
    expect(read('docs/release.md')).toContain(`Pre-release ended with \`${line.preReleaseEndedAt}\``);
  });
});

describe('both chains: every file a release shipped from the end of pre-release on is still as shipped', () => {
  const line = readReleaseLine(ROOT);
  const from = line.releases.indexOf(line.preReleaseEndedAt);
  const listed = releasedOnly(line, { version: rootVersion(ROOT), isTagged }).slice(from);
  const reachable = listed.filter(isTagged);
  const missing = listed.filter((tag) => !isTagged(tag));

  it('can reach every release it compares with', () => {
    if (missing.length > 0 && process.env.CI) {
      throw new Error(
        `${missing.join(', ')} not reachable, so the chains cannot be compared with them. CI must ` +
          'check out with tags (fetch-depth: 0).',
      );
    }
    if (missing.length > 0) console.warn(`[a-chain-that-only-grows] not reachable locally, skipped: ${missing.join(', ')}`);
    expect(listed.length).toBeGreaterThan(0);
  });

  it.skipIf(reachable.length === 0)('lost nothing, edited nothing, and rewrote no statement', () => {
    const files = new Map<string, Shipped>();
    for (const tag of reachable) {
      for (const dir of CHAIN_DIRS) {
        const names = git('ls-tree', '--name-only', tag, `${dir}/`)
          .toString('utf8')
          .split('\n')
          .filter((p) => p.endsWith('.sql'));
        for (const path of names) {
          let file = files.get(path);
          if (!file) {
            file = { path, releases: [], head: existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path)) : null };
            files.set(path, file);
          }
          file.releases.push({ tag, bytes: git('show', `${tag}:${path}`) });
        }
      }
    }
    const verdict = judgeChains([...files.values()]);
    for (const n of verdict.notesSince) {
      console.info(`[a-chain-that-only-grows] ${n.path}: comments differ between ${n.older} and ${n.newest}, statements the same`);
    }
    console.info(
      `[a-chain-that-only-grows] compared ${verdict.compared} files of ${CHAIN_DIRS.length} chains ` +
        `with ${reachable.join(', ')}.`,
    );
    // Both chains, every release: the shared chain alone has 65 files.
    expect(verdict.compared, 'the comparison read no files').toBeGreaterThan(100);
    expect(
      { gone: verdict.gone, edited: verdict.edited, rewritten: verdict.rewritten },
      'a migration a release shipped was deleted, edited or rewritten. A database that applied ' +
        'it recorded its name and will never read it again: put the file back as the newest ' +
        'release shipped it, and write the change as the next numbered file (ADR-0045).',
    ).toEqual({ gone: [], edited: [], rewritten: [] });
  });

  it('every chain directory holds only numbered SQL, so nothing hides beside the files compared', () => {
    for (const dir of CHAIN_DIRS) {
      expect(readdirSync(join(ROOT, dir)).filter((f) => !/^\d{4}_.+\.sql$/.test(f))).toEqual([]);
    }
  });
});

describe('judgeChains, on releases made up for it', () => {
  const b = (text: string): Buffer => Buffer.from(text);
  const file = (path: string, releases: Array<[string, string]>, head: string | null): Shipped => ({
    path,
    releases: releases.map(([tag, text]) => ({ tag, bytes: b(text) })),
    head: head === null ? null : b(head),
  });

  it('passes a file the tree holds as every release shipped it', () => {
    const v = judgeChains([file('a.sql', [['v1', 'CREATE TABLE t (a int);\n'], ['v2', 'CREATE TABLE t (a int);\n']], 'CREATE TABLE t (a int);\n')]);
    expect(v).toEqual({ gone: [], edited: [], rewritten: [], notesSince: [], compared: 1 });
  });

  it('refuses a note added today to a file the newest release shipped', () => {
    const v = judgeChains([file('a.sql', [['v1', 'CREATE TABLE t (a int);\n']], '-- see 0059\nCREATE TABLE t (a int);\n')]);
    expect(v.edited).toEqual([{ path: 'a.sql', newest: 'v1' }]);
  });

  it('refuses a deleted file, and a statement edited in place', () => {
    const v = judgeChains([
      file('gone.sql', [['v1', 'SELECT 1;\n']], null),
      file('edited.sql', [['v1', 'ALTER TABLE t ADD COLUMN a int;\n']], 'ALTER TABLE t ADD COLUMN a bigint;\n'),
    ]);
    expect(v.gone).toEqual(['gone.sql']);
    expect(v.edited).toEqual([{ path: 'edited.sql', newest: 'v1' }]);
  });

  it('prints a note a later release already shipped, and refuses a statement one rewrote', () => {
    const v = judgeChains([
      file('noted.sql', [['v1', 'SELECT 1;\n'], ['v2', '-- superseded by 0059\nSELECT 1;\n']], '-- superseded by 0059\nSELECT 1;\n'),
      file('rewritten.sql', [['v1', 'SELECT 1;\n'], ['v2', 'SELECT 2;\n']], 'SELECT 2;\n'),
    ]);
    expect(v.notesSince).toEqual([{ path: 'noted.sql', older: 'v1', newest: 'v2' }]);
    expect(v.rewritten).toEqual([{ path: 'rewritten.sql', older: 'v1', newest: 'v2' }]);
    expect(v.edited).toEqual([]);
  });
});
