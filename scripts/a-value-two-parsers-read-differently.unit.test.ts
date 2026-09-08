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
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  rmSync,
} from 'node:fs';
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

describe('--fix quotes the value without retyping it', () => {
  /**
   * Four of the five values the first real deployment refused were secrets: an
   * admin password, two OAuth client secrets, and a console URL. Hand-editing a
   * line holding a secret to add two characters is a chance to MISTYPE the
   * secret — and a mistyped SECRET_ENCRYPTION_KEY is the exact failure this
   * script exists to prevent, reached through the remedy instead of the bug.
   *
   * So the bytes must survive untouched, the file must be backed up before it
   * is replaced, and nothing may be printed. These run the real script.
   */
  const fixture = (content: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'envfix-'));
    const file = join(dir, '.env');
    writeFileSync(file, content, { mode: 0o600 });
    return { dir, file };
  };

  // spawnSync rather than execFileSync: everything this script says goes to
  // STDERR, and execFileSync hands back stdout only — so on a successful fix
  // the output would come back empty and a test asserting on it would pass
  // without reading anything. (It did, on the first run of this block.)
  const fix = (file: string) => {
    const res = spawnSync('bash', [CHECKER, '--fix', file], { encoding: 'utf8' });
    return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
  };

  it('quotes what it can and leaves the rest of the file alone', () => {
    const { dir, file } = fixture('LOG_LEVEL=info\nSPACED=two words\nHEXY=abc123\n');
    try {
      fix(file);
      expect(readFileSync(file, 'utf8')).toBe(
        "LOG_LEVEL=info\nSPACED='two words'\nHEXY=abc123\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not retype the value — the bytes inside the quotes are the old bytes', () => {
    // The whole point. A secret that comes out one character different is the
    // failure this script is about, arrived at by fixing it.
    const secret = 'aB3~x?y&z.q_-Qw+/=';
    const { dir, file } = fixture(`MICROSOFT_OAUTH_CLIENT_SECRET=${secret}\n`);
    try {
      fix(file);
      expect(readFileSync(file, 'utf8')).toBe(
        `MICROSOFT_OAUTH_CLIENT_SECRET='${secret}'\n`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('turns double quotes into single ones, keeping the body', () => {
    const { dir, file } = fixture('TRUSTED="localhost nextcloud"\n');
    try {
      fix(file);
      expect(readFileSync(file, 'utf8')).toBe("TRUSTED='localhost nextcloud'\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a trailing comment where it was', () => {
    const { dir, file } = fixture('K=a b   # a note\n');
    try {
      fix(file);
      expect(readFileSync(file, 'utf8')).toBe("K='a b'   # a note\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to decide a $ for you', () => {
    // Quoting `$HOME` freezes it to the literal. Only the operator knows
    // whether that was meant to expand, and guessing is silent either way.
    const { dir, file } = fixture('D=$HOME/x\n');
    try {
      const verdict = fix(file);
      expect(verdict.ok).toBe(false);
      expect(verdict.output).toContain('decision is yours');
      expect(readFileSync(file, 'utf8')).toBe('D=$HOME/x\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names the single quote, because that one cannot be quoted at all", () => {
    const { dir, file } = fixture("APOS=it's\n");
    try {
      const verdict = fix(file);
      expect(verdict.ok).toBe(false);
      expect(verdict.output).toContain('SINGLE QUOTE');
      expect(
        verdict.output,
        'Telling an operator to wrap this in single quotes is advice that cannot be\n' +
          'followed. The value itself has to change, and the refusal must say so.',
      ).toContain('the VALUE has to change');
      expect(readFileSync(file, 'utf8')).toBe("APOS=it's\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backs the file up first, byte for byte and mode for mode', () => {
    const before = 'SPACED=two words\n';
    const { dir, file } = fixture(before);
    try {
      fix(file);
      const backups = readdirSync(dir).filter((n) => n.includes('.bak-'));
      expect(backups, 'no backup was written').toHaveLength(1);
      const backup = join(dir, backups[0]!);
      expect(readFileSync(backup, 'utf8')).toBe(before);
      expect(statSync(backup).mode & 0o777).toBe(0o600);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never prints the value it is quoting', () => {
    // This runs in CI on the managed gate. A refusal that quotes the offending
    // value puts a secret in a log in order to complain about it.
    const secret = 'sw0rdf1sh&hunter2';
    const { dir, file } = fixture(`ZITADEL_ADMIN_PASSWORD=${secret}\n`);
    try {
      const verdict = fix(file);
      expect(verdict.output).toContain('ZITADEL_ADMIN_PASSWORD');
      expect(verdict.output).not.toContain(secret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('touches nothing when there is nothing to fix', () => {
    const before = "LOG_LEVEL=info\nQUOTED='a b'\n";
    const { dir, file } = fixture(before);
    try {
      expect(fix(file).ok).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(
        readdirSync(dir).filter((n) => n.includes('.bak-')),
        'a run that changed nothing must not leave a backup behind',
      ).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves no working copy behind', () => {
    const { dir, file } = fixture('SPACED=two words\n');
    try {
      fix(file);
      expect(readdirSync(dir).filter((n) => n.includes('.fix.'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a refusal always says why', () => {
  it('explains a character that matches none of the named cases', () => {
    // Rob\'s deployment, 2026-09-08: three of five refusals matched no branch of
    // the reason `case` and printed the verdict with no explanation under it. A
    // refusal an operator cannot act on is a refusal they switch off.
    const verdict = check('AMPY=a&b\n');
    expect(verdict.ok).toBe(false);
    const lines = verdict.output.split('\n');
    const at = lines.findIndex((l) => l.includes('AMPY'));
    expect(at).toBeGreaterThan(-1);
    expect(
      lines[at + 1] ?? '',
      'The line under the verdict must be a reason, not the next verdict or the fix.',
    ).toContain('outside the set both parsers read the same way');
  });

  it('does not print the value while explaining it', () => {
    const verdict = check('SECRETY=a&b-not-in-a-log\n');
    expect(verdict.output).not.toContain('a&b-not-in-a-log');
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
