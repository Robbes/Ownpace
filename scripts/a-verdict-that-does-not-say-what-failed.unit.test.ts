// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A gate that knows what broke and will not say it.
 *
 * `smoke-managed.sh` had one hundred and forty-seven places that could fail the
 * run and one verdict line:
 *
 *     verify: done   apply: applied
 *     SMOKE FAIL — evidence in /tmp/openmig-smoke-managed-20260903T143750Z.txt
 *
 * That is what the owner got back from the Spark on 2026-09-03. Both halves he
 * could name had succeeded, so the cause was one of the other hundred and
 * forty-five — and the only way to find out was to read a several-hundred-line
 * log on a phone, or ask. The information existed at the moment of failure and
 * was thrown away one line later.
 *
 * The fix is that every site records where it fired, so the verdict can list
 * them. These tests hold the two halves of that: nothing sets the flag behind
 * the recorder's back, and the verdict actually prints what was recorded.
 *
 * They RUN the real lines, extracted from the real file, for the reason the
 * neighbouring `smoke-managed-verdict.unit.test.ts` gives: a test that restated
 * them would pass forever while the script drifted underneath it.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE = join(REPO_ROOT, 'deploy/compose/smoke-managed.sh');
const smoke = readFileSync(SMOKE, 'utf8');

/** Lines of real shell, with comments and blank lines dropped. */
function code(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
}

/** The `fail_at` definition, taken from the script rather than restated. */
function failAtDefinition(): string {
  const start = smoke.indexOf('fail_at() {');
  const end = smoke.indexOf('\n}\n', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return smoke.slice(start, end + 3);
}

describe('nothing fails the run without saying where it fired', () => {
  it('no assertion assigns fail=1 behind the recorder’s back', () => {
    // `fail_at` sets the flag; ONE assignment is allowed and it is that one.
    // Any other is a site whose failure would reach the verdict as a bare
    // `SMOKE FAIL` — the defect this file is named for, reintroduced.
    const assignments = code(smoke).filter((line) => /(^|[^_\w])fail=1\b/.test(line));
    expect(assignments).toHaveLength(1);
    expect(failAtDefinition()).toContain(assignments[0]!.trim());
  });

  it('the sites that used to assign now call fail_at — well over a hundred of them', () => {
    // Not an exact count on purpose: sites come and go with the gate's
    // coverage, and a test that pinned the number would be edited to match on
    // every real change until nobody read it. What must not happen is the
    // wholesale reversion, and that this many call it proves the convention is
    // the script's and not one block's.
    const calls = code(smoke).filter((line) => /(^|[^_\w])fail_at\b/.test(line));
    expect(calls.length).toBeGreaterThan(140);
  });

  it('records the section, the caller’s line, and a reason when given one', () => {
    const lines = [
      'fail=0',
      'FAIL_REASONS=""',
      'SECTION="startup"',
      failAtDefinition(),
      'note() { SECTION="$*"; }',
      'note "the task lane"',
      'fail_at "copied nothing"',
      'note "the balance"',
      'fail_at "took nothing back"',
      'printf "%s" "$FAIL_REASONS"',
    ];
    const script = lines.join('\n');
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });

    expect(out).toContain('the task lane');
    expect(out).toContain('copied nothing');
    expect(out).toContain('the balance');
    expect(out).toContain('took nothing back');

    // The line number is the CALLER's — `BASH_LINENO[0]` — not `fail_at`'s own.
    // Getting that backwards points every entry at the same line, and the list
    // still LOOKS right while being worthless. So the two calls are asserted to
    // record their own distinct, correct lines, computed rather than hardcoded.
    const bodyLines = script.split('\n');
    const first = bodyLines.findIndex((l) => l === 'fail_at "copied nothing"') + 1;
    const second = bodyLines.findIndex((l) => l === 'fail_at "took nothing back"') + 1;
    expect(second).toBeGreaterThan(first);
    expect(out).toContain(`(line ${first}): copied nothing`);
    expect(out).toContain(`(line ${second}): took nothing back`);
  });

  it('a bare call still names where it fired', () => {
    // Most sites echo their complaint on the line above, so the section and
    // line are the whole diagnosis and an argument would be a second copy.
    const out = execFileSync(
      'bash',
      [
        '-c',
        ['fail=0', 'FAIL_REASONS=""', 'SECTION="the balance"', failAtDefinition(), 'fail_at', 'printf "%s" "$FAIL_REASONS"'].join(
          '\n',
        ),
      ],
      { encoding: 'utf8' },
    );
    expect(out).toContain('the balance');
    expect(out).toContain('see this section in the log above');
  });

  it('sets the flag, not merely the record', () => {
    const out = execFileSync(
      'bash',
      [
        '-c',
        ['fail=0', 'FAIL_REASONS=""', 'SECTION=x', failAtDefinition(), 'fail_at', 'echo "FAIL=$fail"'].join('\n'),
      ],
      { encoding: 'utf8' },
    );
    expect(out.trim().split('\n').pop()).toBe('FAIL=1');
  });
});

describe('the verdict prints what was recorded', () => {
  /** The real verdict block, from `if [ "$fail" = "0" ]` to its `fi`. */
  const block = (() => {
    const start = smoke.indexOf('if [ "$fail" = "0" ]; then');
    const end = smoke.indexOf('\nfi\n', start);
    expect(start).toBeGreaterThan(-1);
    return smoke.slice(start, end + 4);
  })();

  function verdict(fail: string, reasons: string): string {
    return execFileSync(
      'bash',
      ['-c', [`fail=${fail}`, `FAIL_REASONS='${reasons}'`, 'OUT=/tmp/evidence.txt', block].join('\n')],
      { encoding: 'utf8' },
    );
  }

  it('lists every recorded reason under the FAIL line', () => {
    const out = verdict('1', '  - the task lane (line 1592): copied nothing\n  - mailpit (line 2177): not answering\n');
    expect(out).toContain('SMOKE FAIL');
    expect(out).toContain('what failed:');
    expect(out).toContain('the task lane (line 1592): copied nothing');
    expect(out).toContain('mailpit (line 2177): not answering');
  });

  it('the reasons come AFTER the verdict line, so they are the last thing read', () => {
    const out = verdict('1', '  - a section (line 1): a reason\n');
    expect(out.indexOf('SMOKE FAIL')).toBeLessThan(out.indexOf('a reason'));
  });

  it('a pass says nothing about reasons', () => {
    const out = verdict('0', '');
    expect(out).toContain('SMOKE PASS');
    expect(out).not.toContain('what failed:');
  });
});
