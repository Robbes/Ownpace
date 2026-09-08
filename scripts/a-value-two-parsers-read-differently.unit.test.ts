// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One file, two parsers, and nothing checked that they agreed.
 *
 * `deploy/compose/.env` is read by Docker Compose's own Go dotenv
 * implementation (through `env_file:` in managed.yml) and by bash `source`
 * (`set -a` in `set-task-env.sh`, carrying the same values into the Trigger.dev
 * task environment). For `LOG_LEVEL=info` they agree, which is why this was
 * never anybody's problem. They stop agreeing the moment a value holds a dollar
 * sign, a backslash, a quote, whitespace or a newline.
 *
 * When they disagree the api container holds one value and the task containers
 * hold another, for the same key, each correct-looking on its own. For
 * `SECRET_ENCRYPTION_KEY` that is not a configuration problem but data loss:
 * the api encrypts a credential under one and a task cannot decrypt it under
 * the other, surfacing much later, inside a pass, as *"encrypted with different
 * key"* — naming nothing.
 *
 * The owner's first instinct when that error appeared on 2026-09-08 was *"I did
 * have some issues with multiline in .env yesterday, so we might need to
 * check."* He was right that the mechanism exists. That particular incident
 * turned out to be an old key rather than a parser disagreement — but nothing
 * refused an ambiguous value, so nothing could have told him either way.
 *
 * ## What these tests hold
 *
 * They run the REAL script against real files, because a checker asserted about
 * rather than executed is a checker nobody has run. Specifically:
 *
 *  1. the file this repository actually ships PASSES — a guard that refuses the
 *     project's own example is a guard somebody deletes on its first morning;
 *  2. every ambiguous shape is REFUSED, one file per shape;
 *  3. the refusal names the KEY and the fix, because an operator holding a
 *     rejected file needs to know which line and what to type;
 *  4. it never sources the file — proved by handing it one whose value would
 *     leave a mark if executed;
 *  5. `set-task-env.sh` calls it BEFORE its own `source`, since sourcing is
 *     the very thing that would run a command substitution.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(REPO_ROOT, 'deploy/compose/check-env-agreement.sh');

interface Verdict {
  readonly ok: boolean;
  readonly output: string;
}

/** Run the real script over a .env whose body is `content`. */
function check(content: string): Verdict {
  const dir = mkdtempSync(join(tmpdir(), 'envcheck-'));
  const file = join(dir, '.env');
  writeFileSync(file, content);
  try {
    execFileSync('bash', [CHECKER, file], { encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, output: '' };
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string };
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the file this repository ships is accepted', () => {
  it('passes managed.env.example unchanged', () => {
    const example = readFileSync(join(REPO_ROOT, 'deploy/compose/managed.env.example'), 'utf8');
    const verdict = check(example);
    expect(
      verdict.ok,
      'The project\'s own example must pass. A guard that refuses it is a guard\n' +
        'somebody switches off on its first morning, and then it protects nothing.\n' +
        `Output was:\n${verdict.output}`,
    ).toBe(true);
  });

  it('accepts the shapes our own tooling writes', () => {
    // `env-upsert.sh` writes `KEY=value` unquoted and `ensure-env-secrets.sh`
    // generates hex, so the ordinary file is bare and boring. If this ever
    // fails, the checker has become stricter than the writer — which would
    // refuse a file the project produced itself.
    const verdict = check(
      [
        '# a comment',
        'LOG_LEVEL=info',
        'SECRET_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'WEB_URL=https://app.ota.ownpace.eu',
        'DATABASE_URL=postgresql://user@postgres:5432/openmigrate',
        'NOTIFY_LOCALE=en    # nl | en',
        'EMPTY=',
        'export EXPORTED=fine',
        "QUOTED='a $dollar and a space'",
        '',
      ].join('\n'),
    );
    expect(verdict.ok, verdict.output).toBe(true);
  });
});

describe('a value two parsers would read differently is refused', () => {
  const ambiguous: ReadonlyArray<readonly [string, string, string]> = [
    ['a dollar sign', 'DOLLAR=pa$$word', 'dollar sign'],
    ['a command substitution', 'SUBST=$(id)', 'command substitution'],
    ['a backtick', 'BACKTICK=`id`', 'command substitution'],
    ['whitespace', 'SPACED=two words', 'whitespace'],
    ['double quotes', 'DQUOTE="a\\nb"', 'DOUBLE-quoted'],
    ['an unclosed quote', "UNCLOSED='oops", 'never closes it'],
    ['a bare hash', 'HASHY=a#b', "contains a '#'"],
  ];

  for (const [what, line, because] of ambiguous) {
    it(`refuses ${what}, and says why`, () => {
      const verdict = check(`${line}\n`);
      expect(verdict.ok, `${line} should be refused`).toBe(false);
      expect(
        verdict.output,
        `The refusal must explain ${what} specifically. An operator holding a rejected\n` +
          'file needs the reason, not just the verdict.',
      ).toContain(because);
    });

    it(`names the key when refusing ${what}`, () => {
      const key = line.split('=')[0]!;
      expect(check(`${line}\n`).output).toContain(key);
    });
  }

  it('offers the fix, and the fix is single quotes', () => {
    const verdict = check('SPACED=two words\n');
    expect(verdict.output).toContain('SINGLE quotes');
    expect(
      verdict.output,
      'Single quotes are the one form neither parser expands, so they are the remedy\n' +
        'that is right regardless of which parser the reader was worried about.',
    ).toContain("SPACED='...'");
  });

  it('counts every offending line rather than stopping at the first', () => {
    // An operator fixing them one run at a time is an operator running this
    // five times. Say all of it at once.
    const verdict = check('A=one two\nB=$dollar\nC=ok\n');
    expect(verdict.output).toContain('A ');
    expect(verdict.output).toContain('B ');
    expect(verdict.output).toContain('2 value(s)');
  });
});

describe('it scans the file, it never sources it', () => {
  it('does not execute a command substitution while finding one', () => {
    // The whole reason this runs BEFORE set-task-env.sh's `source`: sourcing a
    // .env containing `$(...)` runs it. The canary is a file the command would
    // create — if it exists afterwards, the checker executed the thing it is
    // supposed to be protecting against.
    const dir = mkdtempSync(join(tmpdir(), 'envcheck-canary-'));
    const canary = join(dir, 'executed');
    const file = join(dir, '.env');
    writeFileSync(file, `EVIL=$(touch ${canary})\n`);
    try {
      let refused = false;
      try {
        execFileSync('bash', [CHECKER, file], { encoding: 'utf8', stdio: 'pipe' });
      } catch {
        refused = true;
      }
      expect(refused, 'a command substitution must be refused').toBe(true);
      expect(
        existsSync(canary),
        'THE CHECKER EXECUTED THE FILE. It must read the text and assign nothing —\n' +
          'a check that runs the hazard in order to report it has already lost.',
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('set-task-env.sh consults it before it sources anything', () => {
  const setTaskEnv = readFileSync(join(REPO_ROOT, 'deploy/compose/set-task-env.sh'), 'utf8');

  it('calls the checker', () => {
    expect(
      setTaskEnv,
      'set-task-env.sh is the seam where a parser disagreement becomes damage: it\n' +
        'carries these values into the task containers, which is the half of the\n' +
        'deployment that would then hold the other value.',
    ).toContain('check-env-agreement.sh');
  });

  it('calls it BEFORE the source, not after', () => {
    const checkAt = setTaskEnv.indexOf('check-env-agreement.sh');
    const sourceAt = setTaskEnv.indexOf('. "$ENV_FILE"');
    expect(checkAt).toBeGreaterThan(-1);
    expect(sourceAt).toBeGreaterThan(-1);
    expect(
      checkAt,
      'A check that runs after the source reports the hazard having already suffered\n' +
        'it — `source` on a file with $(...) executes it.',
    ).toBeLessThan(sourceAt);
  });

  it('treats the refusal as fatal rather than advisory', () => {
    const window = setTaskEnv.slice(
      setTaskEnv.indexOf('check-env-agreement.sh'),
      setTaskEnv.indexOf('. "$ENV_FILE"'),
    );
    expect(
      window,
      'Uploading half-understood values is the damage. A warning here would let the\n' +
        'upload proceed, which is the thing being prevented.',
    ).toMatch(/exit 1/);
  });
});
