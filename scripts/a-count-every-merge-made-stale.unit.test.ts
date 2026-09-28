// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COUNT EVERY MERGE MADE STALE: both generated indexes opened with a total
 * across every plan or guard, so every merge changed a line that every other
 * open pull request carried too (workplan 0147, 2026-09-28).
 *
 * `docs/workplans/README.md` opened its table with *"147 plans. Task rows by
 * the marker their Status cell starts with: ✅ 639 · 🟢 10 · …"*, and
 * `docs/LESSONS.md` with *"Assembled from the 186 cross-cutting guards"*. Of
 * the 39 commits that reached main in the night of 2026-09-27 to 28
 * (58f5f645 to cde67035), 27 changed one of those two lines. Each time, every
 * other open pull request that had regenerated either file held a copy of the
 * line that no longer matched, and needed a re-level and a new CI run.
 *
 * When two pull requests changed the line to the SAME text, it was worse: git
 * merged them without a conflict, and the total was wrong on main. #968 and
 * #969 each added a guard, so main said 133 guards over 134 files and CI run
 * #2654 went red. #1236 and #1246 did it again, so main said 167 over 168,
 * and `lessons.mjs --check` failed at 6e92210 and b8a754da. #1241 (0cbc77cf)
 * put the count right, because it regenerated the file when it was brought up
 * to date with main. #1250, opened to fix it, then merged as an empty commit.
 *
 * The owner, 2026-09-28: *"yes, drop the counts"*. Neither file now holds a
 * line that sums over plans or guards. What is left is one row per plan and
 * one entry per guard, and a change to one of them changes only its own lines.
 *
 * WHAT THIS HOLDS. Two pull requests are made from the same base, each
 * regenerates the index on its own tree, and the two generated files go
 * through a real three-way merge (`git merge-file`), in both orders. The merge
 * must have no conflict, and its text must be what the generator writes for
 * the tree with both changes, so the drift check passes on the merge with no
 * regeneration. The cases are the ones that happen: two plans numbered in
 * parallel and merged in any order (0147 T1 rule 8), a Status entry and a task
 * row in two different plans, a new plan at the end while another plan
 * changes, and two new guards.
 *
 * WHAT IT DOES NOT CLAIM. git refuses two changes on neighbouring lines, even
 * when neither is a total. So pull requests that change neighbouring plans
 * (0131 and 0132, say), or that both add a plan at the end of the table,
 * still conflict: 32 of the 296 pairs of commits of that night that changed
 * the rows of different plans would have. So do two new guards whose
 * LESSONS.md entries land next to each other, under a file both read or in
 * file-name order: 12 of the 153 pairs of that night's new guards. 0147 T1
 * said so when the index was built. The fix is the same as before:
 * regenerate on the merged tree, never merge by hand.
 *
 * Worse, and not covered here: two pull requests that change DIFFERENT task
 * rows of the SAME plan. Each writes that plan's Rows and Markers cells, and
 * the counts in them can come out the same on both sides (📋 to ✅ in one row
 * each gives ✅ 8 · 📋 4 twice, where the tree with both holds ✅ 9 · 📋 3).
 * The plan file merges cleanly, the index row merges cleanly, and `--check`
 * fails on main: the #968 and #969 failure, inside one row. 55 of that
 * night's 351 pairs changed a common plan. It had not reached main by
 * 2026-09-28; 0147 open question 6 asks the owner whether those cells go too.
 *
 * FIXTURES ONLY, like `workplan-index.unit.test.ts`: the real plans are never
 * read here, so a prose commit to a workplan does not run the suite.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKPLAN_INDEX = join(REPO_ROOT, 'scripts', 'workplan-index.mjs');
const LESSONS = join(REPO_ROOT, 'scripts', 'lessons.mjs');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function tree(prefix: string, files: Record<string, string>): string {
  const dir = temp(prefix);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/** Run an ES module snippet against the real generators; its stdout. */
function node(script: string): string {
  return execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
}

/**
 * A real three-way merge of one file, as git does it: `ours` and `theirs`
 * each changed `base`. `conflicts` is git's count of conflicting hunks.
 */
function merge3(ours: string, base: string, theirs: string): { conflicts: number; text: string } {
  const d = temp('merge3-');
  writeFileSync(join(d, 'ours'), ours);
  writeFileSync(join(d, 'base'), base);
  writeFileSync(join(d, 'theirs'), theirs);
  const r = spawnSync('git', ['merge-file', '-p', join(d, 'ours'), join(d, 'base'), join(d, 'theirs')], {
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  if (r.status === null || r.status > 127) throw new Error(`git merge-file failed: ${r.stderr}`);
  return { conflicts: r.status, text: r.stdout };
}

/** Merge the two sides in both orders, and say what each order gives. */
function bothOrders(base: string, a: string, b: string) {
  return [
    { order: 'A merged first, then B', ...merge3(a, base, b) },
    { order: 'B merged first, then A', ...merge3(b, base, a) },
  ];
}

// ── the workplan index ────────────────────────────────────────────────────

const README =
  '# Workplans\n\nWords by hand.\n\n## Index\n\n' +
  '<!-- BEGIN GENERATED by scripts/workplan-index.mjs — DO NOT EDIT BY HAND. -->\n' +
  '<!-- END GENERATED by scripts/workplan-index.mjs -->\n\n## Numbering\n\nMore words by hand.\n';

const plan = (n: string, date: string, rows: string[]) =>
  [
    `# Workplan ${n} — Plan ${n}`,
    '',
    `> **In one line:** What plan ${n} is about, in one sentence.`,
    '',
    `## Status — ${date} (update this block at the end of every session)`,
    '',
    '| Task | Status | Notes |',
    '|---|---|---|',
    ...rows.map((r, i) => `| T${i + 1} Task ${i + 1} | ${r} | x |`),
    '',
    '## 1. What there is today',
    '',
    'Words.',
    '',
  ].join('\n');

/** A directory of plans with its README regenerated by the real `--write`. */
function indexed(plans: Record<string, string>): { dir: string; readme: string } {
  const dir = tree('wpmerge-', { ...plans, 'README.md': README });
  node(`import { write } from ${JSON.stringify(WORKPLAN_INDEX)}; write(${JSON.stringify(dir)});`);
  return { dir, readme: readFileSync(join(dir, 'README.md'), 'utf8') };
}

function checkIndex(dir: string): { ok: boolean; messages: string[] } {
  return JSON.parse(
    node(`import { check } from ${JSON.stringify(WORKPLAN_INDEX)}; console.log(JSON.stringify(check(${JSON.stringify(dir)})));`),
  );
}

/** The lines of `after` that `before` does not hold, and the other way round. */
function changedLines(before: string, after: string): string[] {
  const b = before.split('\n');
  const a = after.split('\n');
  return [...a.filter((l) => !b.includes(l)), ...b.filter((l) => !a.includes(l))];
}

/**
 * The whole property for the workplan index: A and B each regenerate on the
 * same base, every line either changes belongs to a plan it changed, both
 * merge orders are clean, and the merge is what the generator writes for the
 * tree with both, so `--check` passes on it.
 */
function expectIndexMerges(
  base: Record<string, string>,
  a: Record<string, string>,
  b: Record<string, string>,
  touched: { a: string[]; b: string[] },
) {
  const o = indexed(base);
  const ia = indexed({ ...base, ...a });
  const ib = indexed({ ...base, ...b });
  const both = indexed({ ...base, ...a, ...b });

  for (const [side, readme, numbers] of [
    ['A', ia.readme, touched.a],
    ['B', ib.readme, touched.b],
  ] as const) {
    expect(readme, `side ${side} regenerated nothing`).not.toBe(o.readme);
    for (const line of changedLines(o.readme, readme)) {
      expect(
        numbers.some((n) => line.includes(`[${n}](./`) || line.startsWith(`| ${n} |`)),
        `side ${side} changed a line that belongs to no plan it changed — every other open pull request carries it too:\n${line}`,
      ).toBe(true);
    }
  }

  for (const m of bothOrders(o.readme, ia.readme, ib.readme)) {
    expect(m.conflicts, `${m.order}: git reports a conflict\n${m.text}`).toBe(0);
    expect(m.text, `${m.order}: the merge is not what --write gives for both changes`).toBe(both.readme);
    writeFileSync(join(both.dir, 'README.md'), m.text);
    expect(checkIndex(both.dir), `${m.order}: --check fails on the merge`).toEqual({ ok: true, messages: [] });
  }
}

describe('the workplan index: two pull requests, one merge, no regeneration', () => {
  it('two plans numbered in parallel, each merged in any order into its own gap', () => {
    // 0147 T1 rule 8: plans are numbered when their file is created and merged
    // in any order, and a number below the highest with no file is a row,
    // "no file on this branch", until its plan lands.
    const base = {
      '0101-a.md': plan('0101', '2026-09-20', ['✅ Done', '📋 **Proposed**']),
      '0103-c.md': plan('0103', '2026-09-21', ['✅ Done']),
      '0105-e.md': plan('0105', '2026-09-22', ['🟡 Partly', '⏳ Owner']),
    };
    expectIndexMerges(
      base,
      { '0102-b.md': plan('0102', '2026-09-28', ['📋 **Proposed**', '📋 **Proposed**']) },
      { '0104-d.md': plan('0104', '2026-09-28', ['✅ Done', '🔨 Built']) },
      { a: ['0102'], b: ['0104'] },
    );
  });

  it('a Status entry and a task row, each in a different plan', () => {
    // The night of 2026-09-27: nearly every pull request changed one plan's
    // Status block and regenerated.
    const base = {
      '0101-a.md': plan('0101', '2026-09-20', ['✅ Done']),
      '0102-b.md': plan('0102', '2026-09-20', ['✅ Done', '📋 **Proposed**']),
      '0103-c.md': plan('0103', '2026-09-21', ['✅ Done']),
      '0104-d.md': plan('0104', '2026-09-21', ['⏳ Owner']),
      '0105-e.md': plan('0105', '2026-09-22', ['🟡 Partly', '📋 **Proposed**']),
      '0106-f.md': plan('0106', '2026-09-22', ['✅ Done']),
    };
    expectIndexMerges(
      base,
      { '0102-b.md': plan('0102', '2026-09-28', ['✅ Done', '✅ Done', '🔨 Built']) },
      { '0105-e.md': plan('0105', '2026-09-27', ['🟡 Partly', '📋 **Proposed**', '⏳ Owner']) },
      { a: ['0102'], b: ['0105'] },
    );
  });

  it('a new plan at the end, while another pull request changes an earlier plan', () => {
    const base = {
      '0101-a.md': plan('0101', '2026-09-20', ['✅ Done']),
      '0102-b.md': plan('0102', '2026-09-20', ['📋 **Proposed**']),
      '0103-c.md': plan('0103', '2026-09-21', ['✅ Done']),
      '0104-d.md': plan('0104', '2026-09-21', ['⏳ Owner']),
    };
    expectIndexMerges(
      base,
      { '0105-e.md': plan('0105', '2026-09-28', ['📋 **Proposed**', '📋 **Proposed**']) },
      { '0102-b.md': plan('0102', '2026-09-28', ['✅ Done', '⛔ Blocked']) },
      { a: ['0105'], b: ['0102'] },
    );
  });
});

// ── the lessons index ─────────────────────────────────────────────────────

const guard = (title: string, reads: string[]) =>
  [
    '// Copyright 2026 The Ownpace authors (Apache-2.0)',
    '',
    '/**',
    ` * ${title}: a defect that happened once, and the property that now holds.`,
    ' */',
    '',
    "import { readFileSync } from 'node:fs';",
    ...reads.map((p) => `readFileSync('${p}', 'utf8');`),
    '',
  ].join('\n');

/**
 * A repository with guards in `scripts/`, and LESSONS.md as the real generator
 * assembles it for that repository (`git ls-files` included).
 */
function lessons(files: Record<string, string>): string {
  const root = tree('lessonsmerge-', files);
  execFileSync('git', ['init', '-q'], { cwd: root });
  return node(
    `import { assemble, repoIndex } from ${JSON.stringify(LESSONS)};
     process.stdout.write(assemble(${JSON.stringify(join(root, 'scripts'))}, repoIndex(${JSON.stringify(root)})));`,
  );
}

describe('the lessons index: two new guards, one merge, no regeneration', () => {
  it('two pull requests that each add a guard merge cleanly, in either order, into what --write gives', () => {
    // #968 and #969, and again #1236 and #1246: each added a guard and
    // regenerated on its own base, git merged them without a conflict, and
    // main said one guard fewer than it had.
    const base = {
      'docs/x.md': 'x\n',
      'docs/y.md': 'y\n',
      'docs/z.md': 'z\n',
      'scripts/b-guard-that-reads-x.unit.test.ts': guard('THE B GUARD', ['docs/x.md']),
      'scripts/m-guard-that-reads-x-and-y.unit.test.ts': guard('THE M GUARD', ['docs/x.md', 'docs/y.md']),
      'scripts/t-guard-that-reads-y.unit.test.ts': guard('THE T GUARD', ['docs/y.md']),
    };
    const a = { 'scripts/a-new-guard-that-reads-x.unit.test.ts': guard('THE NEW A GUARD', ['docs/x.md']) };
    const b = { 'scripts/p-new-guard-that-reads-y-and-z.unit.test.ts': guard('THE NEW P GUARD', ['docs/y.md', 'docs/z.md']) };

    const o = lessons(base);
    const la = lessons({ ...base, ...a });
    const lb = lessons({ ...base, ...b });
    const both = lessons({ ...base, ...a, ...b });

    // Not vacuous: each side's guard is in its index, and both are in the fresh one.
    expect(la).toContain('../scripts/a-new-guard-that-reads-x.unit.test.ts');
    expect(lb).toContain('../scripts/p-new-guard-that-reads-y-and-z.unit.test.ts');
    expect(lb).toContain('### `docs/z.md`');
    expect(both).toContain('THE NEW A GUARD');
    expect(both).toContain('THE NEW P GUARD');

    for (const m of bothOrders(o, la, lb)) {
      expect(m.conflicts, `${m.order}: git reports a conflict\n${m.text}`).toBe(0);
      expect(m.text, `${m.order}: the merge is not what --write gives for both guards`).toBe(both);
    }
  });
});
