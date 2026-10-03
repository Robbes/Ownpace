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
 * marker lines all stand inside ONE fenced code block is a quotation and
 * passes. The fence is CommonMark's: three or more backticks or tildes,
 * indented at most three spaces, an info string allowed, closed by a run of
 * the same character at least as long with nothing after it. That is the rule
 * the workplan index already reads plans by. A conflict with one marker in a
 * fence and another outside it is not a quotation; it is a real conflict that
 * a fence line happened to fall into, and it fails. Everywhere else a marker
 * at column 0 is never a quotation: a comment indents it, as
 * `nothing-ever-parsed-the-bring-up` does, and a test builds it from
 * `'<'.repeat(7)`, as this file does, so that it never holds one itself.
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
 * WHAT IT CANNOT SEE, so its silence is not read as coverage.
 *
 *  - A real conflict whose marker lines all land inside one fenced block of a
 *    Markdown file looks exactly like a quotation, and passes. That is the
 *    price of letting documents quote one, and the reason a quotation belongs
 *    in a fence and nowhere else.
 *  - CI's `detect-changes` skips the unit suite on a docs-only change, and
 *    486 of the 567 were Markdown. A conflict that a docs-only pull request
 *    leaves in a workplan is caught by the next pull request that touches
 *    code: late, and on the wrong pull request. `docs-hygiene` runs on every
 *    change but installs nothing, so it cannot run a vitest file; closing this
 *    means moving the detector into a plain `.mjs` that job can call.
 *  - Markers are seven characters because git's `conflict-marker-size`
 *    attribute is unset. A test below asks git, so an attribute that changed
 *    it would turn this file red instead of blind.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, type Stats } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** This file, as git spells it. It is scanned like any other. */
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url));

/**
 * git's four marker runs. Built, never typed: a fixture below that wrote one
 * at the start of a line would be a conflict in this file, and the scan of
 * the real tree would be right to fail on it.
 */
const OURS = '<'.repeat(7);
const BASE = '|'.repeat(7);
const SPLIT = '='.repeat(7);
const THEIRS = '>'.repeat(7);

type Marker = 'ours' | 'base' | 'split' | 'theirs';

/** Which marker a line is, if any. git writes the run, then a space and a label, or nothing. */
function markerOf(line: string): Marker | undefined {
  if (/^<{7}(?:[ \t]|$)/.test(line)) return 'ours';
  if (/^\|{7}(?:[ \t]|$)/.test(line)) return 'base';
  if (/^={7}[ \t]*$/.test(line)) return 'split';
  if (/^>{7}(?:[ \t]|$)/.test(line)) return 'theirs';
  return undefined;
}

const MARKER_TEXT: Record<Marker, string> = { ours: OURS, base: BASE, split: SPLIT, theirs: THEIRS };

/** CommonMark's fence line: at most three spaces, a run of three or more, the rest. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface Fences {
  /** Per line (0-based): the line its fence opened on, or -1 outside every fence. */
  readonly within: ReadonlyArray<number>;
  /** Fences that open and never close (1-based), and so quote nothing. */
  readonly unclosed: ReadonlyArray<number>;
}

function fencesOf(lines: ReadonlyArray<string>): Fences {
  const within = lines.map(() => -1);
  const unclosed: number[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE.exec(lines[i]!);
    // A backtick fence's info string may not hold a backtick; such a line is inline code.
    if (!open || (open[1]!.startsWith('`') && open[2]!.includes('`'))) {
      i++;
      continue;
    }
    const run = open[1]!;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const c = FENCE.exec(lines[j]!);
      if (c && c[1]![0] === run[0] && c[1]!.length >= run.length && c[2]!.trim() === '') {
        close = j;
        break;
      }
    }
    if (close === -1) {
      // Not a fence. Read on from the next line as prose, so that whatever
      // follows is judged rather than hidden.
      unclosed.push(i + 1);
      i++;
      continue;
    }
    for (let k = i; k <= close; k++) within[k] = i;
    i = close + 1;
  }
  return { within, unclosed };
}

interface Finding {
  readonly line: number;
  readonly what: string;
}

interface Verdict {
  readonly findings: ReadonlyArray<Finding>;
  /** Conflicts and marker lines excused because they stand inside one fence. */
  readonly quoted: number;
}

const isMarkdown = (file: string): boolean => /\.(?:md|markdown|mdx)$/i.test(file);

/** Every unresolved conflict and stray marker in one file's text. */
function conflictsIn(file: string, text: string): Verdict {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const fences: Fences = isMarkdown(file)
    ? fencesOf(lines)
    : { within: lines.map(() => -1), unclosed: [] };

  // Marker lines, 0-based, grouped into complete conflicts and strays.
  const conflicts: number[][] = [];
  const strays: number[] = [];
  let open: { lines: number[]; base: boolean; split: boolean } | undefined;
  lines.forEach((line, i) => {
    const marker = markerOf(line);
    if (marker === 'ours') {
      if (open) strays.push(open.lines[0]!);
      open = { lines: [i], base: false, split: false };
    } else if (marker === 'base') {
      // Only between `ours` and the split; anywhere else it is not git's.
      if (open && !open.base && !open.split) {
        open.lines.push(i);
        open.base = true;
      }
    } else if (marker === 'split') {
      // A split with nothing open is a setext underline, and passes.
      if (open && !open.split) {
        open.lines.push(i);
        open.split = true;
      }
    } else if (marker === 'theirs') {
      if (open?.split) {
        conflicts.push([...open.lines, i]);
      } else {
        if (open) strays.push(open.lines[0]!);
        strays.push(i);
      }
      open = undefined;
    }
  });
  if (open) strays.push(open.lines[0]!);

  const fenceOf = (i: number): number => fences.within[i]!;
  const findings: Finding[] = [];
  let quoted = 0;

  for (const markers of conflicts) {
    const fence = fenceOf(markers[0]!);
    if (fence !== -1 && markers.every((i) => fenceOf(i) === fence)) {
      quoted++;
      continue;
    }
    const where = markers.map((i) => `${MARKER_TEXT[markerOf(lines[i]!)!]} at ${i + 1}`).join(', ');
    findings.push({ line: markers[0]! + 1, what: `an unresolved conflict (${where})` });
  }
  for (const i of strays) {
    if (fenceOf(i) !== -1) {
      quoted++;
      continue;
    }
    findings.push({
      line: i + 1,
      what: `a stray ${MARKER_TEXT[markerOf(lines[i]!)!]} line, left by a resolution that removed the rest of its conflict`,
    });
  }

  return {
    quoted,
    findings: findings
      .map((f) => {
        const fence = fences.unclosed.filter((n) => n < f.line).at(-1);
        return fence === undefined
          ? f
          : { ...f, what: `${f.what}; the fence opened at line ${fence} never closes, so it quotes nothing` };
      })
      .sort((a, b) => a.line - b.line),
  };
}

/** The failure message: every file and line, and what to do about each. */
function verdictMessage(found: ReadonlyArray<Finding & { readonly file: string }>): string {
  const files = new Set(found.map((f) => f.file)).size;
  return [
    `${files} file(s) hold a merge conflict nobody finished resolving:`,
    '',
    ...found.map((f) => `  ${f.file}:${f.line}  ${f.what}`),
    '',
    'Resolve each one: keep what the merge should have produced and delete every marker line.',
    'A generated file (docs/LESSONS.md, the index in docs/workplans/README.md, docs/adr/OPERATIVE.md,',
    'pnpm-lock.yaml) is resolved by regenerating it on the merged tree, never by hand.',
    'If a Markdown file QUOTES a conflict on purpose, put the whole quotation inside one fenced',
    'code block (``` or ~~~): that is the only place this guard accepts one.',
  ].join('\n');
}

interface Tree {
  readonly scanned: ReadonlyArray<string>;
  readonly binary: ReadonlyArray<string>;
  readonly findings: ReadonlyArray<Finding & { readonly file: string }>;
  readonly quoted: ReadonlyArray<string>;
}

function scanTree(): Tree {
  const listing = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  // A path mid-merge is listed once per stage; once is enough.
  const files = [...new Set(listing.split('\0').filter(Boolean))].sort();

  const scanned: string[] = [];
  const binary: string[] = [];
  const findings: Array<Finding & { file: string }> = [];
  const quoted: string[] = [];
  for (const file of files) {
    const path = join(REPO_ROOT, file);
    let stat: Stats;
    try {
      stat = lstatSync(path);
    } catch (error) {
      // In the index, gone from the working tree: no content, no marker. Any
      // other failure to read is a failure, not a pass.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile()) continue;
    const bytes = readFileSync(path);
    if (bytes.subarray(0, 8000).includes(0)) {
      binary.push(file);
      continue;
    }
    scanned.push(file);
    const verdict = conflictsIn(file, bytes.toString('utf8'));
    for (const f of verdict.findings) findings.push({ file, ...f });
    if (verdict.quoted > 0) quoted.push(file);
  }
  return { scanned, binary, findings, quoted };
}

const tree = scanTree();

/** One file's text from its lines. */
const text = (...lines: string[]): string => `${lines.join('\n')}\n`;

/** A plain two-sided conflict, as git writes it. */
const CONFLICT = [`${OURS} HEAD`, 'ours', SPLIT, 'theirs', `${THEIRS} origin/main`];

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

  it(`finds none (${tree.scanned.length} files read, ${tree.binary.length} binary passed over, ${tree.quoted.length} holding a fenced quotation)`, () => {
    expect(tree.findings, verdictMessage(tree.findings)).toEqual([]);
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

describe('what counts as a conflict, and what is a quotation of one', () => {
  it('fails a conflict in Markdown prose', () => {
    const v = conflictsIn('docs/x.md', text('# A plan', '', ...CONFLICT, '', 'More prose.'));
    expect(v.findings).toEqual([
      { line: 3, what: `an unresolved conflict (${OURS} at 3, ${SPLIT} at 5, ${THEIRS} at 7)` },
    ]);
  });

  it('passes the same conflict inside a fenced block, which is a quotation', () => {
    for (const [open, close] of [
      ['```', '```'],
      ['```text', '```'],
      ['~~~ diff', '~~~'],
      ['````', '````'],
      ['   ```', '```'],
    ] as const) {
      const v = conflictsIn('docs/x.md', text('Prose.', open, ...CONFLICT, close, 'Prose.'));
      expect(v, `${open} … ${close}`).toEqual({ findings: [], quoted: 1 });
    }
  });

  it("passes 0099's lesson, in its shape: the shared brace after the closing marker", () => {
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
    expect(v).toEqual({ findings: [], quoted: 1 });
  });

  it('fails a diff3 conflict, base section and all', () => {
    const v = conflictsIn(
      'docs/x.md',
      text(`${OURS} HEAD`, 'ours', `${BASE} merged common ancestors`, 'base', SPLIT, 'theirs', `${THEIRS} topic`),
    );
    expect(v.findings).toEqual([
      { line: 1, what: `an unresolved conflict (${OURS} at 1, ${BASE} at 3, ${SPLIT} at 5, ${THEIRS} at 7)` },
    ]);
  });

  it('passes a lone ======= , which in Markdown underlines a heading', () => {
    expect(conflictsIn('docs/x.md', text('A heading', SPLIT, '', 'Prose.'))).toEqual({ findings: [], quoted: 0 });
  });

  it('passes markers indented inside a comment, as the bring-up guard quotes them', () => {
    const v = conflictsIn(
      'scripts/x.unit.test.ts',
      text('/**', ` *     ${OURS} HEAD`, ' *     a', ` *     ${SPLIT}`, ' *     b', ` *     ${THEIRS} topic`, ' */'),
    );
    expect(v).toEqual({ findings: [], quoted: 0 });
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

  it('fails a conflict that straddles a fence, which is a real one a fence line fell into', () => {
    // "ours" opened a code block and "theirs" did not: the marker before the
    // fence is prose, so this is not a quotation however the rest reads.
    const v = conflictsIn(
      'docs/x.md',
      text(`${OURS} HEAD`, '```bash', 'echo ours', SPLIT, 'echo theirs', `${THEIRS} topic`, '```'),
    );
    expect(v.findings).toHaveLength(1);
    expect(v.quoted).toBe(0);
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
    expect(conflictsIn('docs/x.md', text('Prose.', '```', 'code'))).toEqual({ findings: [], quoted: 0 });
  });

  it('closes a fence only with a run of its own character, at least as long', () => {
    // ```` is closed by ```` and not by ```, so the conflict is still quoted.
    const inner = conflictsIn('docs/x.md', text('````', '```', ...CONFLICT, '```', '````'));
    expect(inner).toEqual({ findings: [], quoted: 1 });
    // A backtick in the info string makes the line inline code, not a fence.
    const inline = conflictsIn('docs/x.md', text('```not `a` fence', ...CONFLICT, '```'));
    expect(inline.findings).toHaveLength(1);
  });

  it('reads CRLF files as git writes into them', () => {
    const v = conflictsIn('docs/x.md', CONFLICT.join('\r\n') + '\r\n');
    expect(v.findings).toHaveLength(1);
  });

  it('names every file and line, and says what to do', () => {
    const message = verdictMessage([
      { file: 'docs/a.md', line: 12, what: 'an unresolved conflict' },
      { file: 'docs/a.md', line: 40, what: 'a stray line' },
      { file: 'pnpm-lock.yaml', line: 3, what: 'an unresolved conflict' },
    ]);
    expect(message).toContain('2 file(s)');
    expect(message).toContain('docs/a.md:12');
    expect(message).toContain('docs/a.md:40');
    expect(message).toContain('pnpm-lock.yaml:3');
    expect(message).toMatch(/delete every marker line/);
    expect(message).toMatch(/regenerating it/);
    expect(message).toMatch(/inside one fenced/);
  });
});
