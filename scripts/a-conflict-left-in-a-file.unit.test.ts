// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MERGE CONFLICT LEFT IN A FILE, AND ONE QUOTED ON PURPOSE.
 *
 * On 2026-10-03 a suggested task asked for "stray merge markers" to be removed
 * from `docs/workplans/0099-an-invitation-you-can-answer.md`, at lines 3071,
 * 3074 and 3077. They are not strays. They stand inside a fenced code block in
 * the lesson "Nothing ever parsed the bring-up", which QUOTES the conflict git
 * produced when #546 and #547 each added a helper to the managed bring-up
 * script, to show how git factors the closing brace both sides share out of the
 * conflict region. Deleting them would have deleted the thing the lesson is
 * about. `scripts/nothing-ever-parsed-the-bring-up.unit.test.ts` quotes the
 * same conflict in its own header, indented inside the comment.
 *
 * The suggestion read the file the way `grep '^<<<<<<<'` reads it, and grep
 * cannot tell a quotation from a leftover. Nothing in this repository could:
 * no guard looked for a real conflict left in a file at all, quoted or not.
 *
 * THE RECORD IS CLEAN, AND NOTHING KEPT IT CLEAN BUT CARE. Replayed with
 * `git merge-tree` on 2026-10-03, 354 of the 1,730 merge commits reachable
 * from this repository's remote branches conflicted, in 567 files between
 * them. Somebody resolved every one: an agent 333 times, the owner 14, and
 * GitHub's web conflict editor 7. Not one marker was committed. `git log -G`
 * over every branch finds exactly one commit that added or removed a
 * `<<<<<<<` or `>>>>>>>` line at column 0, and it is the commit that wrote
 * 0099's quotation.
 *
 * WHERE THEY LAND IS WHY THIS IS WORTH A GUARD. 486 of the 567 were Markdown:
 * 202 in the workplan index, 178 in workplans, 56 in `docs/LESSONS.md`, 50 in
 * guides, runbooks and legal texts. A conflict left in TypeScript already
 * fails `tsc` (TS1185, "Merge conflict marker encountered"), and one left in a
 * shell script fails `bash -n` in `nothing-ever-parsed-the-bring-up`. The two
 * generated indexes would fail their drift checks, saying "out of date" rather
 * than "conflict". A conflict left in a workplan body, a guide or a runbook
 * failed nothing at all.
 *
 * WHAT A CONFLICT IS. The lines git writes, at column 0 and in this order: a
 * `<<<<<<<` line (then a space and a label, or nothing), diff3's `|||||||`
 * base line if the style asks for one, a line that is exactly `=======`, and a
 * `>>>>>>>` line. That sequence fails, wherever it is. A lone `=======` does
 * not: it is a Markdown setext underline, and git's own `diff --check`, which
 * flags it, is wrong about every document that uses one. A `<<<<<<<` or
 * `>>>>>>>` line OUTSIDE a complete sequence DOES fail, as a stray: it is what
 * a hand resolution leaves when it deletes two marker lines and misses the
 * third, which is the likelier way for one to survive review, since a whole
 * conflict is conspicuous and one leftover line is not. No file here uses
 * either line for anything else.
 *
 * WHAT A QUOTATION IS. In Markdown, and only in Markdown, a conflict whose
 * marker lines all stand inside ONE fenced code block is a quotation, and it
 * passes when the file DECLARES it: `QUOTATIONS` in
 * `scripts/conflict-markers.mjs` names each file that quotes a conflict on
 * purpose and how many it quotes, and today that is 0099, once. The fence is
 * CommonMark's: three or more backticks or tildes, indented at most three
 * spaces, an info string allowed, closed by a run of the same character at
 * least as long with nothing after it. That is the rule the workplan index
 * already reads plans by. A conflict with one marker in a fence and another
 * outside it is not a quotation, whichever end the fence holds; it is a real
 * conflict that a fence line happened to fall into, and it fails. Everywhere
 * else a marker at column 0 is never a quotation: a comment indents it, as
 * `nothing-ever-parsed-the-bring-up` does, and a test builds it from
 * `'<'.repeat(7)`, as this file does, so that it never holds one itself.
 *
 * A FENCE IS NOT ENOUGH, AND THE REPLAY SAYS SO. The first version of this
 * guard passed any conflict inside a fence. Of the 852 conflicts git wrote in
 * the replayed merges, two landed whole inside an ```ini block of
 * `docs/managed-bring-up.md`, in the merges f2e028d0 and 57c94650: real ones,
 * labelled with the parents' commit IDs, and indistinguishable from a
 * quotation. Both files held other conflicts that would have failed, but a
 * resolution that fixed only the lines it was shown would have left the fenced
 * one behind in silence. A fence that a resolution breaks does the same to
 * prose. Keep a ```bash opener and lose its closer, and the next bare ``` below,
 * the closer of some other block, closes it instead: CommonMark and this guard
 * both read a conflict in the prose between as code. So a fence is necessary
 * and not sufficient. A file that holds a quoted conflict it does not declare
 * fails, and so does one that holds more or fewer than it declares. The count
 * and not the line, because a plan's Status block grows at the top.
 *
 * A FENCE THAT NEVER CLOSES QUOTES NOTHING. CommonMark runs an unclosed fence
 * to the end of the document, so a merge that broke a fence would turn every
 * conflict below it into "code". Here an opener that never closes is not a
 * fence: the lines after it are judged as prose, and a marker found there is
 * reported with the line of the fence that never closed, because that is what
 * the author has to fix. An unclosed fence with no marker after it is not
 * this guard's business.
 *
 * WHAT IS READ. Every file `git ls-files` lists, from the repository root,
 * untracked ones included (`--others --exclude-standard`, for the lessons
 * index's reason: the verdict must not depend on whether `git add` has run).
 * A file is skipped only where git itself never writes a marker: when its
 * first 8,000 bytes hold a NUL, which is git's own test for binary, and git
 * reports a binary conflict by keeping one side whole. Nothing else is
 * skipped, and "nobody would hand-merge that" is the reason NOT to skip a
 * file. The lockfile, the generated indexes and the fixtures are exactly the
 * files a resolution commits without reading them; three of the 567 were
 * `pnpm-lock.yaml`, whose diffs nobody reads. A path in the index that is
 * gone from the working tree has no content to hold a marker and is passed
 * over; a symlink or a submodule is not a file, and today there are none.
 *
 * WHERE IT RUNS, and why not only here. The detector is
 * `scripts/conflict-markers.mjs`, plain Node with nothing to install, and
 * `docs-hygiene` in `.github/workflows/ci.yml` runs
 * `node scripts/conflict-markers.mjs --check` on every change; this file
 * imports it, as `a-release-that-names-itself` imports its check. The first
 * version ran here only, in `unit-tests`, which `detect-changes` skips for a
 * change that touches only workplans, `docs/architecture/**` and a few root
 * files. Of the 567 conflicted files, 180 sat on those paths, 176 of them
 * workplan bodies, so a conflict a docs-only pull request left in one would
 * have merged green and turned the next, unrelated pull request red: #772's
 * shape, which that filter's comment and `a-doc-a-test-reads-that-ci-skipped`
 * exist to stop. That guard could not have seen it either, since this reads
 * through a `git ls-files` walk and names no file. A case below holds the step
 * in the job and the module to Node's own imports.
 *
 * WHAT IT CANNOT SEE, so its silence is not read as coverage.
 *
 *  - A real conflict that lands inside a fence of a file that declares a
 *    quotation, in the same change that removes a quotation that file
 *    declared, keeps the count and passes. 0099 is the only such file.
 *  - Markers are seven characters because git's `conflict-marker-size`
 *    attribute is unset. A test below asks git, so an attribute that changed
 *    it would turn this file red instead of blind.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OURS,
  BASE,
  SPLIT,
  THEIRS,
  QUOTATIONS,
  conflictsIn,
  isBinary,
  isMarkdown,
  quotationFindings,
  scanTree,
  verdictMessage,
} from './conflict-markers.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DETECTOR = join(REPO_ROOT, 'scripts', 'conflict-markers.mjs');

/** This file, as git spells it. It is scanned like any other. */
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url));

const tree = scanTree();

/** How many quoted conflicts each file holds. */
const quotedCounts = (quoted: Readonly<Record<string, ReadonlyArray<number>>>): Record<string, number> =>
  Object.fromEntries(Object.entries(quoted).map(([file, lines]) => [file, lines.length]));

/** One file's text from its lines. */
const text = (...lines: string[]): string => `${lines.join('\n')}\n`;

/** A plain two-sided conflict, as git writes it. */
const CONFLICT = [`${OURS} HEAD`, 'ours', SPLIT, 'theirs', `${THEIRS} origin/main`];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('no file in the tree holds a merge conflict', () => {
  it('reads the whole tree, so an empty listing cannot pass', () => {
    // The way a repo-wide rule dies is by scanning nothing. Anchors in the
    // places that matter, and a floor under the rest: 2,367 text files on
    // 2026-10-03, out of 2,372 that git lists.
    expect(tree.scanned).toContain(SELF);
    expect(tree.scanned).toContain('pnpm-lock.yaml');
    expect(tree.scanned).toContain('docs/LESSONS.md');
    expect(tree.scanned).toContain('docs/workplans/README.md');
    expect(tree.scanned.filter(isMarkdown).length).toBeGreaterThan(250);
    expect(tree.scanned.length).toBeGreaterThan(2000);
    // And the binary test cannot quietly swallow text: five files on 2026-10-03.
    expect(tree.binary).toContain('site/brand/logo-512.png');
    expect(tree.binary.length).toBeLessThan(50);
  });

  it(`finds none (${tree.scanned.length} files read, ${tree.binary.length} binary passed over)`, () => {
    expect(tree.findings, verdictMessage(tree.findings)).toEqual([]);
  });

  it('finds a quotation in 0099 and nowhere else, once', () => {
    // Pinned here as well as declared in the module, so that a quotation is
    // added in two places on purpose and never in one by accident. Any other
    // conflict in a fence, a second one in 0099, or one that a broken fence
    // swallowed changes this object.
    expect(
      quotedCounts(tree.quoted),
      'a new quotation of a conflict is declared in QUOTATIONS in scripts/conflict-markers.mjs ' +
        'and here, on purpose; anything else in a fence is a conflict to resolve',
    ).toEqual({ 'docs/workplans/0099-an-invitation-you-can-answer.md': 1 });
    expect(QUOTATIONS).toEqual(quotedCounts(tree.quoted));
  });

  it('reads markers seven characters long, because nothing tells git to write longer ones', () => {
    // `conflict-marker-size` changes the run git writes. Ask git rather than
    // grep .gitattributes, so a pattern this file did not foresee still counts.
    const out = execFileSync('git', ['check-attr', '-z', '--stdin', 'conflict-marker-size'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      input: tree.scanned.join('\0'),
      maxBuffer: 64 * 1024 * 1024,
    }).split('\0');
    const set: string[] = [];
    for (let i = 0; i + 2 < out.length; i += 3) {
      if (out[i + 2] !== 'unspecified') set.push(`${out[i]} (${out[i + 2]})`);
    }
    expect(set, 'these files set conflict-marker-size; teach markerOf that length').toEqual([]);
  });
});

describe('where it runs: on every change, docs-only ones included', () => {
  it("is a step of docs-hygiene, which nothing skips, and imports only Node's own modules", () => {
    // `unit-tests` does not run on a change to a workplan alone, and 176 of
    // the 567 conflicted files were workplan bodies.
    const ci = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const job = ci.slice(ci.indexOf('\n  docs-hygiene:'), ci.indexOf('\n  fixture-uuid-check:'));
    expect(job).toContain('node scripts/conflict-markers.mjs --check');
    expect(job, 'docs-hygiene runs on every change; a `needs` or `if` would let one skip it').not.toMatch(
      /^ {4}(?:needs|if):/m,
    );
    // That job installs nothing, so an import from a package would fail there
    // and only there.
    const imports = [...readFileSync(DETECTOR, 'utf8').matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map(
      (m) => m[1]!,
    );
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((s) => !s.startsWith('node:'))).toEqual([]);
  });

  it('exits 1 naming the file, from any directory and with nothing added, and 0 once it is resolved', () => {
    // The command docs-hygiene runs, on a repository of untracked files: the
    // detector, 0099's declared quotation, a plan with a conflict, and a guide
    // with one whole inside a fence that nothing declares.
    const root = mkdtempSync(join(tmpdir(), 'conflict-markers-'));
    dirs.push(root);
    const write = (path: string, body: string): void => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), body);
    };
    mkdirSync(join(root, 'scripts'));
    copyFileSync(DETECTOR, join(root, 'scripts', 'conflict-markers.mjs'));
    write('docs/workplans/0099-an-invitation-you-can-answer.md', text('A lesson:', '', '```', ...CONFLICT, '```'));
    write('docs/workplans/0200-x.md', text('# A plan', '', ...CONFLICT));
    write('docs/x.md', text('```ini', ...CONFLICT, '```'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    const check = () =>
      spawnSync(process.execPath, [join(root, 'scripts', 'conflict-markers.mjs'), '--check'], {
        cwd: tmpdir(),
        encoding: 'utf8',
      });

    const red = check();
    expect(red.status, red.stderr).toBe(1);
    expect(red.stderr).toContain(
      `docs/workplans/0200-x.md:3  an unresolved conflict (${OURS} at 3, ${SPLIT} at 5, ${THEIRS} at 7)`,
    );
    expect(red.stderr).toContain('docs/x.md:2  a conflict inside a fenced block, in a file that declares no quotation');
    expect(red.stderr).toContain('2 file(s)');
    expect(red.stderr).not.toContain('0099');

    write('docs/workplans/0200-x.md', text('# A plan', '', 'theirs'));
    write('docs/x.md', text('```ini', 'theirs', '```'));
    const green = check();
    expect(green.status, green.stderr).toBe(0);
    expect(green.stdout).toContain('1 declared quotation(s) of one, in docs/workplans/0099-an-invitation-you-can-answer.md');
  });
});

describe('what counts as a conflict, and what is a quotation of one', () => {
  it('fails a conflict in Markdown prose', () => {
    const v = conflictsIn('docs/x.md', text('# A plan', '', ...CONFLICT, '', 'More prose.'));
    expect(v.findings).toEqual([
      { line: 3, what: `an unresolved conflict (${OURS} at 3, ${SPLIT} at 5, ${THEIRS} at 7)` },
    ]);
  });

  it('quotes the same conflict inside a fenced block', () => {
    for (const [open, close] of [
      ['```', '```'],
      ['```text', '```'],
      ['~~~ diff', '~~~'],
      ['````', '````'],
      ['   ```', '```'],
    ] as const) {
      const v = conflictsIn('docs/x.md', text('Prose.', open, ...CONFLICT, close, 'Prose.'));
      expect(v, `${open} … ${close}`).toEqual({ findings: [], quoted: [3] });
    }
  });

  it("quotes 0099's lesson, in its shape: the shared brace after the closing marker", () => {
    const v = conflictsIn(
      'docs/workplans/0099-x.md',
      text(
        'two sides **share** out of the conflict, so each side appears to end',
        'without one:',
        '',
        '```',
        `${OURS} HEAD`,
        'note_mail_goes_nowhere_real() {',
        '  ...',
        SPLIT,
        'note_status_page_probes_itself() {',
        '  ...',
        `${THEIRS} origin/a-status-page-nobody-started`,
        '}',
        '```',
        '',
        'Delete the three markers and keep both sides',
      ),
    );
    expect(v).toEqual({ findings: [], quoted: [5] });
  });

  it('passes a quotation only where one is declared, and as many as are declared', () => {
    // The replay's fenced conflicts, in their shape: git's own, labelled with
    // commit IDs, whole inside an ```ini block of a document that quotes nothing.
    const ini = conflictsIn(
      'docs/managed-bring-up.md',
      text('```ini', '[Service]', `${OURS} e4806ea7`, 'ExecStart=a', SPLIT, 'ExecStart=b', `${THEIRS} b65da810`, '```'),
    );
    expect(ini).toEqual({ findings: [], quoted: [3] });
    const declared = { 'docs/workplans/0099-x.md': 1 };
    expect(quotationFindings({ 'docs/managed-bring-up.md': ini.quoted, 'docs/workplans/0099-x.md': [5] }, declared)).toEqual([
      {
        file: 'docs/managed-bring-up.md',
        line: 3,
        what: expect.stringMatching(/^a conflict inside a fenced block, in a file that declares no quotation/),
      },
    ]);
    // A second one in the declared file names both, since nothing says which is the quotation.
    expect(quotationFindings({ 'docs/workplans/0099-x.md': [5, 40] }, declared).map((f) => f.line)).toEqual([5, 40]);
    // And one declared and gone is a declaration that would excuse the next conflict there.
    expect(quotationFindings({}, declared)).toEqual([
      { file: 'docs/workplans/0099-x.md', line: 0, what: expect.stringMatching(/declares 1 quoted conflict\(s\) .* holds 0/) },
    ]);
    expect(quotationFindings({ 'docs/workplans/0099-x.md': [5] }, declared)).toEqual([]);
  });

  it('cannot tell a conflict that a broken fence swallowed from a quotation, so the declaration does', () => {
    // A resolution kept the ```bash opener and lost its closer. The next bare
    // ``` closes it, as CommonMark would, and the prose conflict reads as code.
    const v = conflictsIn(
      'docs/x.md',
      text('```bash', 'echo a', '', 'Prose.', ...CONFLICT, 'More prose.', '', '```ts', 'const a = 1;', '```'),
    );
    expect(v).toEqual({ findings: [], quoted: [5] });
    expect(quotationFindings({ 'docs/x.md': v.quoted }, {})).toHaveLength(1);
  });

  it('fails a diff3 conflict, base section and all, and takes a base line only before the split', () => {
    const v = conflictsIn(
      'docs/x.md',
      text(`${OURS} HEAD`, 'ours', `${BASE} merged common ancestors`, 'base', SPLIT, 'theirs', `${THEIRS} topic`),
    );
    expect(v.findings).toEqual([
      { line: 1, what: `an unresolved conflict (${OURS} at 1, ${BASE} at 3, ${SPLIT} at 5, ${THEIRS} at 7)` },
    ]);
    // After the split it is a line of "theirs", and with nothing open it is not git's.
    const late = conflictsIn('docs/x.md', text(`${OURS} HEAD`, 'ours', SPLIT, `${BASE} x`, `${THEIRS} topic`));
    expect(late.findings).toEqual([
      { line: 1, what: `an unresolved conflict (${OURS} at 1, ${SPLIT} at 3, ${THEIRS} at 5)` },
    ]);
    expect(conflictsIn('docs/x.md', text('a', BASE, 'b'))).toEqual({ findings: [], quoted: [] });
  });

  it('passes a lone ======= , which in Markdown underlines a heading', () => {
    expect(conflictsIn('docs/x.md', text('A heading', SPLIT, '', 'Prose.'))).toEqual({ findings: [], quoted: [] });
  });

  it('passes markers indented inside a comment, as the bring-up guard quotes them', () => {
    const v = conflictsIn(
      'scripts/x.unit.test.ts',
      text('/**', ` *     ${OURS} HEAD`, ' *     a', ` *     ${SPLIT}`, ' *     b', ` *     ${THEIRS} topic`, ' */'),
    );
    expect(v).toEqual({ findings: [], quoted: [] });
  });

  it('fails a conflict in TypeScript and in shell, where a fence quotes nothing', () => {
    expect(conflictsIn('apps/x.ts', text('export const a = 1;', ...CONFLICT)).findings).toHaveLength(1);
    expect(conflictsIn('deploy/x.sh', text('#!/usr/bin/env bash', ...CONFLICT)).findings).toHaveLength(1);
    // A template literal holding a fence is not Markdown, and excuses nothing.
    const ts = conflictsIn('apps/x.ts', text('const doc = `', '```', ...CONFLICT, '```', '`;'));
    expect(ts.findings).toHaveLength(1);
  });

  it('fails a stray marker that a hand resolution left behind', () => {
    // Kept "ours", deleted the split and "theirs", missed the first line.
    expect(conflictsIn('docs/x.md', text(`${OURS} HEAD`, 'kept')).findings).toEqual([
      { line: 1, what: `a stray ${OURS} line, left by a resolution that removed the rest of its conflict` },
    ]);
    // Kept "theirs", deleted from the top through the split, missed the last line.
    expect(conflictsIn('docs/x.md', text('kept', `${THEIRS} origin/main`)).findings).toEqual([
      { line: 2, what: `a stray ${THEIRS} line, left by a resolution that removed the rest of its conflict` },
    ]);
    // Deleted the split and "theirs" but kept both outer markers.
    expect(conflictsIn('docs/x.md', text(`${OURS} HEAD`, 'kept', `${THEIRS} topic`)).findings).toHaveLength(2);
  });

  it('fails a stray opening marker above a fenced quotation, and still quotes the quotation', () => {
    // 0099's shape with a leftover above it: the next opening marker, inside
    // the fence, must not quietly adopt the stray as part of the quotation.
    const v = conflictsIn('docs/x.md', text(`${OURS} HEAD`, 'kept', '', '```', ...CONFLICT, '```'));
    expect(v).toEqual({
      findings: [{ line: 1, what: `a stray ${OURS} line, left by a resolution that removed the rest of its conflict` }],
      quoted: [5],
    });
  });

  it('fails a conflict that straddles a fence, whichever end of it the fence holds', () => {
    // "ours" opened a code block and "theirs" did not: the marker before the
    // fence is prose, so this is not a quotation however the rest reads.
    const before = conflictsIn(
      'docs/x.md',
      text(`${OURS} HEAD`, '```bash', 'echo ours', SPLIT, 'echo theirs', `${THEIRS} topic`, '```'),
    );
    expect(before.findings).toHaveLength(1);
    expect(before.quoted).toEqual([]);
    // And the other way round: it opens inside a fence and splits outside it.
    const after = conflictsIn(
      'docs/x.md',
      text('```bash', 'echo a', `${OURS} HEAD`, 'echo ours', '```', 'Prose.', SPLIT, 'echo theirs', `${THEIRS} topic`),
    );
    expect(after).toEqual({
      findings: [{ line: 3, what: `an unresolved conflict (${OURS} at 3, ${SPLIT} at 7, ${THEIRS} at 9)` }],
      quoted: [],
    });
  });

  it('does not let an unclosed fence hide what follows it, and names that fence', () => {
    const v = conflictsIn('docs/x.md', text('Prose.', '```', 'code that never ends', '', ...CONFLICT));
    expect(v.findings).toEqual([
      {
        line: 5,
        what:
          `an unresolved conflict (${OURS} at 5, ${SPLIT} at 7, ${THEIRS} at 9); ` +
          'the fence opened at line 2 never closes, so it quotes nothing',
      },
    ]);
    // An unclosed fence with nothing after it is somebody else's business.
    expect(conflictsIn('docs/x.md', text('Prose.', '```', 'code'))).toEqual({ findings: [], quoted: [] });
  });

  it('closes a fence only with a bare run of its own character, at least as long', () => {
    // ```` is closed by ```` and not by ```, so the conflict is still quoted.
    const inner = conflictsIn('docs/x.md', text('````', '```', ...CONFLICT, '```', '````'));
    expect(inner).toEqual({ findings: [], quoted: [3] });
    // ```bash inside an open fence is a line of code, not its closer: a closing
    // fence carries no info string, so the quotation runs on to the bare ```.
    const info = conflictsIn('docs/x.md', text('```', 'code', '```bash', ...CONFLICT, '```'));
    expect(info).toEqual({ findings: [], quoted: [4] });
    // A backtick in the info string makes the line inline code, not a fence.
    const inline = conflictsIn('docs/x.md', text('```not `a` fence', ...CONFLICT, '```'));
    expect(inline.findings).toHaveLength(1);
  });

  it('reads CRLF files as git writes into them', () => {
    const v = conflictsIn('docs/x.md', CONFLICT.join('\r\n') + '\r\n');
    expect(v.findings).toHaveLength(1);
  });

  it("passes over a file as binary only as git does, by a NUL in its first 8,000 bytes", () => {
    const at = (n: number): Buffer => {
      const bytes = Buffer.alloc(9000, 'a');
      bytes[n] = 0;
      return bytes;
    };
    expect(isBinary(at(0))).toBe(true);
    expect(isBinary(at(7999))).toBe(true);
    // Past git's window the file is text to git, so git writes markers into it.
    expect(isBinary(at(8000))).toBe(false);
    expect(isBinary(Buffer.from(text(...CONFLICT)))).toBe(false);
  });

  it('names every file and line, and says what to do', () => {
    const message = verdictMessage([
      { file: 'docs/a.md', line: 12, what: 'an unresolved conflict' },
      { file: 'docs/a.md', line: 40, what: 'a stray line' },
      { file: 'docs/b.md', line: 0, what: 'a declared quotation that is gone' },
      { file: 'pnpm-lock.yaml', line: 3, what: 'an unresolved conflict' },
    ]);
    expect(message).toContain('3 file(s)');
    expect(message).toContain('docs/a.md:12');
    expect(message).toContain('docs/a.md:40');
    expect(message).toContain('  docs/b.md  a declared quotation');
    expect(message).toContain('pnpm-lock.yaml:3');
    expect(message).toMatch(/delete every marker line/);
    expect(message).toMatch(/regenerating it/);
    expect(message).toMatch(/inside one fenced/);
    expect(message).toMatch(/declare it in QUOTATIONS/);
  });
});
