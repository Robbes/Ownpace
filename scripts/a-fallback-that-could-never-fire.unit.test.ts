// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FALLBACK THAT COULD NEVER FIRE.
 *
 * An operator ran the bring-up on 2026-08-25 and was told:
 *
 *     Read what it caught:  http://localhost:
 *
 * The advice survived. The address it was about did not.
 *
 *     note "  Read what it caught:  http://localhost:$(env_get MAILPIT_PORT || echo 3127)"
 *
 * `env_get` ends in `|| true` — deliberately, and the comment above it says why:
 * "this key is not set" is a normal answer, not an error, and under
 * `set -o pipefail` a grep that finds nothing would otherwise fail the whole
 * pipeline. So it **always exits 0**, and `|| echo 3127` is unreachable code.
 * The command substitution returns the empty string, and the port vanishes.
 *
 * It reads perfectly. `X || default` is the most ordinary idiom in shell, and
 * it is wrong here for a reason that lives in another function twenty lines
 * away. Both instances of the shape were written the same night, by the same
 * hand, in the two notes added by #546 and #547 — which is what a plausible
 * idiom does: it gets used twice before anybody runs it once.
 *
 * A DEFAULT MUST TEST THE VALUE when the command cannot fail. `env_or NAME
 * DEFAULT` does, and covers the empty case too — a key present with no value
 * (`MAILPIT_PORT=`) is exactly as portless as one that is absent, and is the
 * more likely state, because `.env` is copied from an example that lists the
 * key with nothing after the `=`.
 *
 * THE RULE IS ABOUT THIS HELPER, NOT ABOUT `||`. `cmd || fallback` is correct
 * wherever `cmd` can actually fail, and the bring-up is full of places it does.
 * Widening this to "no `||` after a command substitution" would flag dozens of
 * correct lines and get switched off. It names the one function whose contract
 * makes the idiom a lie.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = join(REPO_ROOT, 'deploy/compose');
const BOOTSTRAP = join(COMPOSE, 'bootstrap-managed.sh');

/** Shell source with comment-only lines removed — the header above quotes the
 *  broken line as the record, and a rule that forbids its own explanation is
 *  the false positive this repo has now hit six times. */
function directives(path: string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

describe('a fallback that could never fire', () => {
  it('nothing puts a `||` default on env_get, which cannot fail', () => {
    const src = directives(BOOTSTRAP);
    const offenders = [...src.matchAll(/\$\(\s*env_get\s+([A-Z_]+)\s*\|\|[^)]*\)/g)].map(
      (m) => m[0],
    );
    expect(
      offenders,
      'env_get ends in `|| true` so it ALWAYS exits 0 — the `||` branch is\n' +
        'unreachable and the substitution yields "". That is how an operator was\n' +
        'told to read the mail at "http://localhost:" with no port.\n' +
        'Use `env_or NAME DEFAULT`, which tests the value.',
    ).toEqual([]);
  });

  it('provides env_or, and it tests the value rather than the exit code', () => {
    const src = directives(BOOTSTRAP);
    expect(src).toMatch(/^env_or\(\) \{/m);
    // `${value:-...}` covers unset AND empty. `${value-...}` would cover only
    // unset, and a key copied from managed.env.example is present-but-empty —
    // the likelier of the two states.
    expect(src, 'env_or must fall back on an EMPTY value too').toMatch(/\$\{value:-\$2\}/);
  });

  it('every note that prints a port actually prints one', () => {
    // The point of the notes is that an operator can act on them. A port-less
    // URL is advice about nothing.
    const src = directives(BOOTSTRAP);
    for (const m of src.matchAll(/http:\/\/localhost:\$\((env_get|env_or)[^)]*\)/g)) {
      expect(m[1], `${m[0]} uses env_get, whose default cannot fire`).toBe('env_or');
    }
  });

  describe('the behaviour itself, run rather than asserted', () => {
    /** The two helpers, lifted verbatim from the bring-up, over a real .env. */
    function ask(envBody: string, script: string): string {
      const dir = mkdtempSync(join(tmpdir(), 'env-or-'));
      try {
        const env = join(dir, '.env');
        writeFileSync(env, envBody);
        const src = readFileSync(BOOTSTRAP, 'utf8');
        const getFn = src.match(/^env_get\(\) \{[^]*?\n\}/m)?.[0];
        const orFn = src.match(/^env_or\(\) \{[^]*?\n\}/m)?.[0];
        expect(getFn, 'env_get moved or was renamed').toBeTruthy();
        expect(orFn, 'env_or moved or was renamed').toBeTruthy();
        const runner = join(dir, 'run.sh');
        writeFileSync(
          runner,
          `set -euo pipefail\nENV_FILE="${env}"\n${getFn}\n${orFn}\n${script}\n`,
        );
        return execFileSync('bash', [runner], { encoding: 'utf8' }).trim();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it('falls back when the key is absent', () => {
      expect(ask('OTHER=1\n', 'env_or MAILPIT_PORT 3127')).toBe('3127');
    });

    it('falls back when the key is present but empty — the likelier case', () => {
      // managed.env.example ships keys with nothing after the `=`, and a fresh
      // .env is a copy of it.
      expect(ask('MAILPIT_PORT=\n', 'env_or MAILPIT_PORT 3127')).toBe('3127');
    });

    it('uses the value when there is one', () => {
      expect(ask('MAILPIT_PORT=9999\n', 'env_or MAILPIT_PORT 3127')).toBe('9999');
    });

    it('and the OLD shape really does yield nothing, which is why this exists', () => {
      // Executed, not claimed. The whole file rests on env_get exiting 0 when
      // the key is missing; asserting that from memory is how the socket
      // credential check got written.
      expect(ask('OTHER=1\n', 'env_get MAILPIT_PORT || echo 3127')).toBe('');
    });
  });

  it('names the file it guards, so an empty scan cannot pass', () => {
    expect(relative(REPO_ROOT, BOOTSTRAP)).toBe('deploy/compose/bootstrap-managed.sh');
    expect(readFileSync(BOOTSTRAP, 'utf8').length).toBeGreaterThan(1000);
  });
});
