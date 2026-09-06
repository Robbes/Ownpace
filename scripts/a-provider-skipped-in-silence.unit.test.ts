// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROVIDER SKIPPED IN SILENCE IS A BUTTON SOMEBODY LOOKS FOR.
 *
 * `setup-zitadel.sh` offers a sign-in provider when its `IDP_<NAME>_CLIENT_ID`
 * pair is set and not otherwise, which is right. Until 2026-09-06 it said
 * nothing in the "otherwise" — and the owner, having set
 * `MICROSOFT_OAUTH_CLIENT_ID` (the registration the MIGRATION CONSENT runs
 * against, read by the API and the worker and never by this script), re-ran
 * the bring-up and looked for a Microsoft button on the sign-in screen. Two
 * variables with the same company's name on them, one of which makes a
 * button; a script that stays quiet about the one it did not read cannot be
 * told apart from a script that failed.
 *
 * Two things are pinned. As TEXT: every provider the script reads a pair for
 * has a spoken skip beside its `if`, and the providers whose name also
 * appears on a migration pair in `managed.env.example` name that look-alike
 * in the call. By RUNNING the helper: what it says for an empty pair, for a
 * look-alike that is set, and for half a pair — because the sentence is the
 * subject, and a static assertion that a function is called proves nothing
 * about the string that comes out (the precedent `idp-wiring` set).
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = readFileSync(join(REPO, 'deploy/compose/setup-zitadel.sh'), 'utf8');
const EXAMPLE = readFileSync(join(REPO, 'deploy/compose/managed.env.example'), 'utf8');

/** The providers the script reads a sign-in pair for, by the NAME in the variable. */
function providersRead(): string[] {
  return [...new Set([...SCRIPT.matchAll(/read_env IDP_([A-Z]+)_CLIENT_ID\)/g)].map((m) => m[1]!))];
}

/** The skip call for a provider, as the script spells it. */
function skipCallFor(name: string): string | undefined {
  return SCRIPT.match(new RegExp(`skip_idp "[^"]+" IDP_${name}_CLIENT_ID [^\\n]*`))?.[0];
}

describe('every sign-in provider the script can skip is skipped aloud', () => {
  it('reads several providers, so the pairing below is not vacuous', () => {
    expect(providersRead().length).toBeGreaterThanOrEqual(4);
  });

  it.each(providersRead())('%s: the `if` that offers it has a spoken skip beside it', (name) => {
    expect(
      skipCallFor(name),
      `setup-zitadel.sh reads IDP_${name}_CLIENT_ID and has no \`skip_idp\` call for it — a ` +
        'provider without its pair is not offered AND nothing says so, which is how an operator ' +
        'looks for a button the script never told them it skipped (2026-09-06).',
    ).toBeDefined();
  });

  it('names the migration pair that looks like it, for every provider that has one', () => {
    // Derived from the example env rather than listed here: a provider that
    // gains a migration pair later must gain the sentence with it.
    const migrationPairs = [...EXAMPLE.matchAll(/^([A-Z]+)_OAUTH_CLIENT_ID=/gm)].map((m) => m[1]!);
    const withBoth = migrationPairs.filter((name) => EXAMPLE.includes(`\nIDP_${name}_CLIENT_ID=`));
    expect(withBoth.length, 'no provider has both a sign-in and a migration pair — the rule proves nothing').toBeGreaterThan(1);
    for (const name of withBoth) {
      expect(
        skipCallFor(name),
        `${name} has both IDP_${name}_CLIENT_ID and ${name}_OAUTH_CLIENT_ID, and the skip line ` +
          'does not name the migration pair — the one an operator sets and then looks for a button',
      ).toContain(`${name}_OAUTH_CLIENT_ID`);
    }
  });
});

/** Run the script's own `skip_idp` with the given environment standing in for .env. */
function runSkip(env: Record<string, string>, call: string): { out: string; status: number | null } {
  const start = SCRIPT.indexOf('skip_idp() {');
  expect(start, 'skip_idp is no longer recognisable in the script').toBeGreaterThan(-1);
  const end = SCRIPT.indexOf('\n}\n', start);
  const fn = SCRIPT.slice(start, end + 3);
  const snippet = [
    'set -u',
    'say() { echo "[setup-zitadel] $*"; }',
    'read_env() { printenv "$1" 2>/dev/null || true; }',
    'ENV_FILE=/stack/.env',
    fn,
    call,
  ].join('\n');
  const r = spawnSync('bash', ['-c', snippet], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
  return { out: r.stdout + r.stderr, status: r.status };
}

const MICROSOFT = 'skip_idp "Microsoft" IDP_MICROSOFT_CLIENT_ID IDP_MICROSOFT_CLIENT_SECRET MICROSOFT_OAUTH_CLIENT_ID';

describe('what the skip says, by running it', () => {
  it('an empty pair: not offered, both variable names, the file — and nothing about a look-alike that is not set', () => {
    const { out, status } = runSkip({}, MICROSOFT);
    expect(status).toBe(0);
    expect(out).toContain('Microsoft: not offered on the sign-in screen');
    expect(out).toContain('IDP_MICROSOFT_CLIENT_ID and IDP_MICROSOFT_CLIENT_SECRET are empty in /stack/.env');
    expect(out).not.toContain('MICROSOFT_OAUTH_CLIENT_ID');
  });

  it("the owner's case: the migration pair set and the sign-in pair empty names the one that makes no button", () => {
    const { out, status } = runSkip({ MICROSOFT_OAUTH_CLIENT_ID: 'entra-app-id' }, MICROSOFT);
    expect(status).toBe(0);
    expect(out).toContain('MICROSOFT_OAUTH_CLIENT_ID is set, and it is a different registration');
    expect(out).toMatch(/migration consent/);
    expect(out).toContain('Only the IDP_MICROSOFT_CLIENT_ID pair makes a sign-in button');
  });

  it('half a pair: says which half is empty, and still does not offer — never a silent skip, never a death', () => {
    const lone = runSkip({ IDP_MICROSOFT_CLIENT_ID: 'entra-app-id' }, MICROSOFT);
    expect(lone.status).toBe(0);
    expect(lone.out).toContain('IDP_MICROSOFT_CLIENT_ID is set but IDP_MICROSOFT_CLIENT_SECRET is empty');
    const other = runSkip({ IDP_MICROSOFT_CLIENT_SECRET: 's' }, MICROSOFT);
    expect(other.status).toBe(0);
    expect(other.out).toContain('IDP_MICROSOFT_CLIENT_SECRET is set but IDP_MICROSOFT_CLIENT_ID is empty');
  });

  it('a provider with no look-alike is skipped in one line', () => {
    const { out, status } = runSkip({}, 'skip_idp "GitHub" IDP_GITHUB_CLIENT_ID IDP_GITHUB_CLIENT_SECRET');
    expect(status).toBe(0);
    expect(out.trim().split('\n')).toHaveLength(1);
    expect(out).toContain('GitHub: not offered on the sign-in screen');
  });
});
