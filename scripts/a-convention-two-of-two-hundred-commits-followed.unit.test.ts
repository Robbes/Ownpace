// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CONVENTION NOTHING ENFORCED.
 *
 * `CONTRIBUTING.md` requires Conventional Commits. The pull-request template
 * repeats it, in bold, on the last line above the signature. Measured on
 * 2026-09-21 over the last two hundred subjects on `main`: **two** follow it,
 * and both were written by dependabot. Ninety-five are merge commits. The rest
 * are prose, written by people and agents who had read both documents and
 * agreed with both.
 *
 * That is not a discipline problem, it is a missing control — the same shape as
 * `a-gate-that-was-never-switched-on`, as the seven-day rule nobody could
 * apply, and as the branch protection that required `ci-complete` alone. A rule
 * everyone agrees with and nothing depends on decays to a sentence in a file.
 *
 * So the rule now has a reader. What this file pins is the rule's SHAPE — what
 * it accepts, what it refuses, and the two things it must never judge:
 *
 *  1. **A merge commit**, by parent count and not by subject text. Merging the
 *     base branch into a branch is how this repository resolves a conflict
 *     without rewriting somebody's checkout, and it produces a subject no
 *     convention covers. A gate that failed on that would penalise the correct
 *     move, and would be switched off within a week.
 *  2. **History.** The gate reads `base..head` and nothing else, so the
 *     hundred-odd prose subjects already on `main` are never re-judged and no
 *     branch has to be rewritten to go green.
 *
 * And it pins the drift that would otherwise bite quietly: a type somebody adds
 * to CONTRIBUTING.md that the gate would then refuse.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Typed through `commit-convention.d.mts`, which sits beside the `.mjs` — the
// same arrangement `an-advisory-nobody-listed.unit.test.ts` reads its script
// through. So this is an ordinary typed import, not an escape hatch.
import { TYPES, judge, exemption, report, type CommitSubject } from './commit-convention.mjs';

const CONTRIBUTING = fileURLToPath(new URL('../CONTRIBUTING.md', import.meta.url));

const at = (subject: string, parents = 1): CommitSubject => ({ sha: 'abcdef1234', parents, subject });

describe('what the convention accepts', () => {
  it('takes a bare type, a scope, and a breaking-change marker', () => {
    for (const subject of [
      'feat: say how much of the content leg ran',
      'fix(connectors): tell an album from a year folder',
      'chore(deps): bump vitest to 5.0.0',
      'feat!: the archive source replaces the folder one',
      'refactor(core)!: verification returns a second axis',
      // dependabot's own, verbatim from `main`.
      'ci(actions): bump the actions group with 4 updates',
    ]) {
      expect(judge(at(subject)), subject).toEqual({ ok: true });
    }
  });

  it('accepts every type CONTRIBUTING.md names — or this is a contributor being refused for reading the docs', () => {
    // The drift that bites quietly: somebody documents a type, somebody else's
    // branch is refused for using it, and neither of them is wrong. Read the
    // doc's list rather than restating it, so adding one there and not here
    // fails HERE.
    const doc = readFileSync(CONTRIBUTING, 'utf8');
    const line = doc.split('\n').find((l) => l.includes('Conventional Commits'));
    expect(line, 'CONTRIBUTING.md no longer mentions Conventional Commits').toBeTruthy();
    const documented = [...line!.matchAll(/`([a-z]+):`/g)].map((m) => m[1]!);
    expect(documented.length, `no types found in: ${line}`).toBeGreaterThan(0);
    for (const type of documented) {
      expect(TYPES, `CONTRIBUTING.md names "${type}:" and the gate refuses it`).toContain(type);
    }
  });
});

describe('what it refuses, and what it says about it', () => {
  it('refuses a prose subject — the hundred on main that started this', () => {
    // Verbatim from `main`, 2026-09-21.
    const v = judge(at('A door that asked nobody: the mapping update route consults the lifecycle'));
    expect(v.ok).toBe(false);
    // NOT "does not follow Conventional Commits", which tells somebody staring
    // at their own subject line nothing. It names what is missing.
    if (!v.ok) expect(v.reason).toContain('no "type: " prefix');
  });

  it('names the wrong thing in each case rather than restating the rule', () => {
    const cases: Array<[string, string]> = [
      ['Feat: capitalised', 'lower-case'],
      ['wip: not a type', 'is not one of'],
      ['feat:no space', 'space is required'],
      ['feat: ', 'summary after the colon is empty'],
      ['feat(): empty scope', 'empty scope'],
    ];
    for (const [subject, expected] of cases) {
      const v = judge(at(subject));
      expect(v.ok, subject).toBe(false);
      if (!v.ok) expect(v.reason, subject).toContain(expected);
    }
  });

  it('is not fooled by a colon somewhere in a prose subject', () => {
    // The near miss that would make this gate worthless: most of the prose
    // subjects on `main` DO contain ": ". None of them carry a type.
    const v = judge(at('The store the pass picks: `where` on an archive source'));
    expect(v.ok).toBe(false);
  });
});

describe('the two things it must never judge', () => {
  it('leaves a merge commit alone, by PARENT COUNT and not by its words', () => {
    // Merging the base branch in is how a conflict is resolved here without
    // rewriting somebody's checkout. If this ever fails, the gate is punishing
    // the correct move and somebody will switch it off.
    const merge = at("Merge branch 'main' into claude/a-branch", 2);
    expect(exemption(merge)).toBe('a merge commit');
    expect(judge(merge)).toEqual({ ok: true, exempt: 'a merge commit' });

    expect(judge(at('Merge pull request #1049 from Robbes/a-branch', 2)).ok).toBe(true);
  });

  it('judges an ORDINARY commit that merely says "Merge"', () => {
    // The reason the check above is structural. A subject is editable; a parent
    // count is not. "Merge our two code paths into one" is ordinary work.
    const v = judge(at('Merge our two code paths into one', 1));
    expect(v.ok, 'a one-parent commit escaped by wording alone').toBe(false);
  });

  it('leaves a generated revert alone — neither git nor GitHub takes a format argument', () => {
    expect(judge(at('Revert "feat: a thing that had to come back out"')).ok).toBe(true);
  });

  it('says nothing about length, mood or a full stop', () => {
    // Style opinions this project has not stated. A gate that enforces unstated
    // opinions is how a convention gets resented rather than followed — and the
    // repo's own subjects are long on purpose.
    const long = `feat(core): ${'a'.repeat(200)}.`;
    expect(judge(at(long))).toEqual({ ok: true });
  });
});

describe('what the report says', () => {
  it('marks each commit, and returns only the failing ones as work', () => {
    const { lines, bad } = report([
      at('feat: a good one'),
      at('a prose one'),
      at("Merge branch 'main' into x", 2),
    ]);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.subject).toBe('a prose one');
    const text = lines.join('\n');
    expect(text).toContain('✓ abcdef12  feat: a good one');
    expect(text).toContain('✗ abcdef12  a prose one');
    expect(text).toContain('not judged');
  });

  it('is green on an empty range, rather than failing a branch with nothing on it', () => {
    expect(report([]).bad).toHaveLength(0);
  });
});
