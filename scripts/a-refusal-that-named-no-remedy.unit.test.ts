// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUSAL THAT NAMED NO REMEDY.
 *
 * An operator on the live test host ran the command this repo had printed for
 * months — the one the seed script's own header taught — and got back:
 *
 *     Seed failed: DATABASE_URL (DB owner connection) is required to seed
 *
 * Every word true. It is also the answer to "what is missing" handed to
 * somebody who needs the answer to "what do I run", and the difference between
 * those two questions is the whole of this file.
 *
 * `deploy/compose/seed-managed.sh` supplies all three settings and had existed
 * for three days. Its header opens by quoting that exact failure. The refusal
 * itself never mentioned it, `docs/managed-bring-up.md` carried the remedy in a
 * TROUBLESHOOTING TABLE — findable only by somebody who already suspects the
 * cause — and the seed's own Usage block still taught the hand-typed form. So
 * the failure went into a chat window instead of a shell.
 *
 * THE MESSAGE IS THE ONLY SURFACE THAT REACHES THE PERSON WHO HIT IT. A
 * document reaches whoever thinks to look; a refusal reaches whoever is stuck.
 * When one of them has to carry the remedy, it is the refusal.
 *
 * THREE THINGS PINNED HERE, and the third is the one that keeps this honest:
 *
 *   1. The refusal names the wrapper.
 *   2. It reports all three missing settings at once. They go missing together
 *      — one cause, one remedy — and naming the first and exiting turns one
 *      fix into three round trips through a failing command.
 *   3. A setting that is PRESENT AND WRONG does NOT get sent to the wrapper.
 *      That is a real configuration error, and the wrapper would hand the
 *      person the same broken value back. A remedy pointed at the wrong
 *      failure is the same unhelpfulness facing the other way.
 *
 * RUN, NOT ASSERTED. Every case below executes the real script and reads what
 * it actually printed. A rule that only greps the source would pass on the day
 * somebody writes a beautiful message behind a condition that cannot be
 * reached — which is precisely how `|| echo 3127` survived review twice.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(REPO_ROOT, 'apps/api/src/scripts/seed-managed.ts');
const WRAPPER = 'deploy/compose/seed-managed.sh';

/** The settings the seed reads from the host, and nothing else supplies. */
const HOST_SETTINGS = ['DATABASE_URL', 'JWT_SECRET', 'SECRET_ENCRYPTION_KEY'] as const;

/**
 * Run the real seed and return everything it said.
 *
 * `overrides` is applied on top of an environment scrubbed of all four host
 * settings — SEED_DATABASE_URL included, because it is a second spelling of
 * DATABASE_URL and a machine that happens to have it set would otherwise skip
 * the case this file exists for.
 */
function runSeed(overrides: Record<string, string> = {}): string {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const key of [...HOST_SETTINGS, 'SEED_DATABASE_URL']) delete env[key];
  Object.assign(env, overrides);
  try {
    return execFileSync('node', [SEED], {
      cwd: join(REPO_ROOT, 'apps/api'),
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'] as const,
      timeout: 60_000,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
}

describe('the seed refuses with the command that fixes it', () => {
  it('names the wrapper when it has nothing to seed with', () => {
    const said = runSeed();
    expect(
      said,
      'The seed refused without naming ' +
        `${WRAPPER}. That is what sent an operator to a chat window on\n` +
        '2026-08-25: a true statement of what was missing, and no way to supply it.',
    ).toContain(WRAPPER);
  });

  it('reports all three at once, not one refusal per run', () => {
    const said = runSeed();
    for (const key of HOST_SETTINGS) {
      expect(
        said,
        `${key} is not in the refusal. All three go missing together, for one\n` +
          'reason; naming the first and exiting makes one fix into three round\n' +
          'trips through a failing command.',
      ).toContain(key);
    }
  });

  it('says why they are missing, so the remedy is not a magic word', () => {
    // "Run this script" without "because the seed runs on the host and loads no
    // .env" is an instruction to obey rather than something understood — and
    // the next person to hit it in a new place is stuck again.
    expect(runSeed()).toMatch(/runs on the host/i);
  });

  it('still refuses when only one is missing, and still says what to run', () => {
    // The likelier state than all three: somebody exported two by hand.
    const said = runSeed({ JWT_SECRET: 'x', SECRET_ENCRYPTION_KEY: 'y' });
    expect(said).toContain('DATABASE_URL');
    expect(said).toContain(WRAPPER);
    expect(said, 'a single missing setting must not be reported as plural').toMatch(
      /DATABASE_URL is not set/,
    );
  });

  it('does NOT send a present-but-malformed key to the wrapper', () => {
    // The refusal must belong to the thing that happened. This key is set; the
    // wrapper would hand back the same bad value, so pointing there wastes the
    // one message that reaches this person.
    const said = runSeed({
      DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db',
      JWT_SECRET: 'x',
      SECRET_ENCRYPTION_KEY: 'this-is-not-32-bytes',
    });
    expect(said).toMatch(/SECRET_ENCRYPTION_KEY must be 32 bytes/);
    expect(
      said,
      'A key that is set but wrong was told to run the wrapper, which would\n' +
        'supply the same wrong value. Presence and shape are different failures.',
    ).not.toContain(WRAPPER);
  });
});

describe('and the header teaches the command that works', () => {
  const header = readFileSync(SEED, 'utf8').slice(0, 4000);

  it('names the wrapper in the usage block', () => {
    expect(
      header,
      "The seed's own header is where the operator who hit this got the command\n" +
        'they ran. If it teaches the hand-typed form, the refusal is repairing\n' +
        'damage the file caused a screen earlier.',
    ).toContain('./deploy/compose/seed-managed.sh');
  });

  it('does not teach a DATABASE_URL on port 5432', () => {
    // 5432 is somebody else's database on any host running more than one thing:
    // on the reference box an unrelated service owns it while this stack's
    // Postgres is published on 55432. Directives only — the prose below the
    // usage block quotes the old line as the record of what went wrong, and a
    // rule that forbids its own explanation is the false positive this repo has
    // now hit six times.
    const taught = header
      .split('\n')
      .filter((l) => /^\s*\*?\s{2,}DATABASE_URL=/.test(l))
      .join('\n');
    expect(
      taught,
      'The usage block hands out a hand-typed DATABASE_URL again. The port in it\n' +
        'is a guess, and a wrong guess writes demo tenants into a stranger\'s database.',
    ).toBe('');
  });
});

describe('the file it guards', () => {
  it('is where this thinks it is, so an empty scan cannot pass', () => {
    expect(relative(REPO_ROOT, SEED)).toBe('apps/api/src/scripts/seed-managed.ts');
    expect(readFileSync(SEED, 'utf8').length).toBeGreaterThan(1000);
    expect(readFileSync(join(REPO_ROOT, WRAPPER), 'utf8').length).toBeGreaterThan(500);
  });
});
