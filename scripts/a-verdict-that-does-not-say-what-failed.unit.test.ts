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

/**
 * WHAT THE GATE COULD NOT PROVE, said beside the verdict (workplan 0136 T5).
 *
 * The same lesson from the other side. When the managed API stopped reading a
 * path on its own disk, the archive section lost the one live proof that the
 * archive reader reached the deployed image, and 0136 T5 asks that the output
 * SAY so rather than skip the step in silence, without failing the run. A
 * line in the middle of a log several thousand lines long says it to nobody:
 * a green night ends on `SMOKE PASS` and the gap shows only to whoever
 * searches for it — the `skipped-no-item` and `SMOKE PASS` of run #6 again.
 * So a gap is recorded like a failure is, and printed next to the verdict on a
 * pass and on a fail, while the flag stays where it was.
 */
describe('what the gate could not prove is printed beside the verdict', () => {
  /** The `not_proven` definition, taken from the script rather than restated. */
  function notProvenDefinition(): string {
    const start = smoke.indexOf('not_proven() {');
    const end = smoke.indexOf('\n}\n', start);
    expect(start, 'smoke-managed.sh defines no not_proven()').toBeGreaterThan(-1);
    return smoke.slice(start, end + 3);
  }

  /** From the verify/apply line to the exit: everything the verdict prints. */
  function verdictTail(): string {
    const start = smoke.indexOf('echo "verify: $VERIFY_RESULT');
    const end = smoke.indexOf('exit "$fail"', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return smoke.slice(start, end);
  }

  function run(fail: string): string {
    return execFileSync(
      'bash',
      [
        '-c',
        [
          'set -u',
          `fail=${fail}`,
          'FAIL_REASONS=""',
          'NOT_PROVEN=""',
          'VERIFY_RESULT=done',
          'APPLY_RESULT=applied',
          'OUT=/tmp/evidence.txt',
          'SECTION="the export archive"',
          failAtDefinition(),
          notProvenDefinition(),
          'not_proven "the archive reader in the deployed image (0148 T9)"',
          `[ "$fail" = "${fail}" ] || echo "NOT_PROVEN MOVED THE FLAG"`,
          fail === '1' ? 'fail_at "a reason"' : ':',
          verdictTail(),
        ].join('\n'),
      ],
      { encoding: 'utf8' },
    );
  }

  it('a pass names the gap next to SMOKE PASS, and stays a pass', () => {
    const out = run('0');
    expect(out).not.toContain('NOT_PROVEN MOVED THE FLAG');
    expect(out).toContain('SMOKE PASS');
    const verdictAt = out.indexOf('verify: done');
    const gapAt = out.lastIndexOf('the archive reader in the deployed image (0148 T9)');
    expect(gapAt, 'the gap is not printed with the verdict').toBeGreaterThan(verdictAt);
    expect(gapAt).toBeLessThan(out.indexOf('SMOKE PASS'));
    // And it names the section it came from, as a failure's entry does.
    expect(out).toContain('- the export archive: the archive reader in the deployed image (0148 T9)');
  });

  it('a fail still ends on what failed, with the gap above it', () => {
    const out = run('1');
    const gapAt = out.lastIndexOf('the archive reader in the deployed image (0148 T9)');
    expect(gapAt).toBeGreaterThan(out.indexOf('verify: done'));
    expect(gapAt).toBeLessThan(out.indexOf('SMOKE FAIL'));
    expect(out.indexOf('what failed:')).toBeGreaterThan(gapAt);
  });

  // REWRITTEN ON PURPOSE by 0148 T9. This asked that the archive section
  // record its gap through `not_proven`; T9 closed the gap, so the section now
  // proves the reader again instead — and a `not_proven` left there would be a
  // gap reported beside a proof that was made.
  it('the archive section no longer records a gap: it reads the export from the destination', () => {
    const section = smoke.slice(smoke.indexOf('note "the export archive"'));
    const next = section.indexOf('\nreport_json ');
    const lines = code(section.slice(0, next));
    expect(lines.some((l) => /^\s*not_proven\s+"/.test(l)), 'a gap is still recorded').toBe(false);
    expect(lines.some((l) => l.includes('where:"target"')), 'no archive posted with where "target"').toBe(true);
    // And a gap closed is a failure again when it breaks, never a skip.
    expect(lines.some((l) => /fail_at "the archive's preflight/.test(l))).toBe(true);
  });

  // THIS RUN'S ROWS, found through THIS RUN'S MIGRATION (0148 T9 review; the
  // lesson of a-person-opened-in-the-wrong-organisation). A display name is
  // shared by every run that left its row behind, so a lookup by it reads, or
  // deletes, whichever row Postgres returns first. From the in-destination
  // half on: the half before it COUNTS rows by name before and after a
  // refusal, and a row left by another run is in both counts.
  it('the archive section finds its source connection through its own migration, never by name', () => {
    const start = smoke.indexOf('ARCHIVE_TAG="');
    expect(start, 'the in-destination half of the archive section is gone').toBeGreaterThan(
      smoke.indexOf('note "the export archive"'),
    );
    const section = smoke.slice(start);
    const lines = code(section.slice(0, section.indexOf('\nreport_json ')));
    expect(
      lines.filter((l) => /display_name\s*=/.test(l)),
      'a row of this section is looked up by its display name',
    ).toEqual([]);
    expect(
      lines.some((l) => l.includes('source_mailbox_id') && l.includes('$archive_mapping_id')),
      'the source connection is not read through the migration just created',
    ).toBe(true);
  });
});
