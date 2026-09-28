// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ORGANISATION A STRANGER COULD FOUND (workplan 0135 T1).
 *
 * Zitadel serves `/ui/login/register/org` to anybody who can load the sign-in
 * page, unless the instance restriction `disallowPublicOrgRegistration` is set,
 * and nothing here set it. The founder owns the new organisation, and an
 * organisation's owner can make an account whose address the provider calls
 * verified, with no mail sent at all. Ownpace binds a grant and an invitation to
 * a verified address, so that account could take the place of somebody let in,
 * before they first signed in (0135 §1). Run, not read, where it can be:
 *
 * - a fresh instance never serves the form: `managed.yml` sets the restriction
 *   for its first init;
 * - `setup-zitadel.sh` sets it on an existing instance with a body of that one
 *   field, so the allowed languages stay as they are, reads it back, and stops,
 *   naming it, when it did not take. An instance already closed is not written;
 * - the gate asks the page itself, as a stranger would, and fails unless it
 *   answers 404.
 *
 * It fails today: nothing sets the restriction, and nothing asks the page.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy/compose');
const read = (name: string) => readFileSync(join(COMPOSE_DIR, name), 'utf8');
const setup = read('setup-zitadel.sh');

/** Shell or YAML with comment-only lines removed: a rule must not be satisfied by its own explanation. */
const directives = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

/**
 * A function of the real script, lifted whole, so the text under test is the
 * text that ships. A one-line function ends on its own line.
 */
function fn(name: string): string {
  const at = setup.indexOf(`\n${name}() {`);
  if (at < 0) return '';
  const first = setup.slice(at + 1, setup.indexOf('\n', at + 1));
  if (first.trimEnd().endsWith('}')) return `${first}\n`;
  return setup.slice(at + 1, setup.indexOf('\n}\n', at) + 3);
}

interface Run {
  code: number;
  said: string;
  calls: string[];
}

/**
 * The lifted functions against a stand-in `api`. A GET answers the restriction
 * as the file holds it; a PUT merges its body into the file when `takes`, and
 * is answered either way, as a write the provider accepted and did not apply.
 */
function run(restriction: Record<string, unknown>, takes = true): Run {
  const home = mkdtempSync(join(tmpdir(), 'orgform-'));
  try {
    const state = join(home, 'restrictions.json');
    const calls = join(home, 'calls');
    writeFileSync(state, JSON.stringify(restriction));
    writeFileSync(calls, '');
    const apply = takes ? `jq -c --argjson b "$3" '. + $b' "${state}" > "${state}.new" && mv "${state}.new" "${state}"` : ':';
    const program = [
      'set -euo pipefail',
      'ISSUER=https://id.example.test',
      'say() { echo "[setup-zitadel] $*"; }',
      'die() { echo "[setup-zitadel] FATAL: $*" >&2; exit 1; }',
      'api() {',
      `  printf '%s %s%s\\n' "$1" "$2" "\${3:+ $3}" >> "${calls}"`,
      '  case "$1 $2" in',
      `    "GET /admin/v1/restrictions") cat "${state}" ;;`,
      `    "PUT /admin/v1/restrictions") ${apply}; echo '{"details":{}}' ;;`,
      '    *) echo "unexpected call: $1 $2" >&2; exit 1 ;;',
      '  esac',
      '}',
      fn('org_registration_closed'),
      fn('close_public_org_registration'),
      'close_public_org_registration',
    ].join('\n');
    const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
    return {
      code: r.status ?? -1,
      said: `${r.stdout ?? ''}${r.stderr ?? ''}`,
      calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean),
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe('a fresh instance', () => {
  it('never serves the form: managed.yml sets the restriction for its first init', () => {
    const yml = directives(read('managed.yml'));
    const zitadel = yml.slice(yml.indexOf('\n  zitadel:\n'), yml.indexOf('\n  zitadel-machinekey:'));
    expect(zitadel, 'the zitadel service is no longer recognisable').toContain('ZITADEL_FIRSTINSTANCE_ORG_HUMAN_USERNAME');
    expect(zitadel).toMatch(/^\s+ZITADEL_DEFAULTINSTANCE_RESTRICTIONS_DISALLOWPUBLICORGREGISTRATION: "true"$/m);
  });
});

describe('an instance that already exists', () => {
  it('is closed with a body of that one field, and read back', () => {
    // protojson leaves a false out, so an open instance answers without the field.
    const { code, said, calls } = run({ details: { sequence: '7' } });
    expect(code, said).toBe(0);
    expect(calls).toEqual([
      'GET /admin/v1/restrictions',
      'PUT /admin/v1/restrictions {"disallowPublicOrgRegistration":true}',
      'GET /admin/v1/restrictions',
    ]);
    expect(said).toContain('closed: the form that founds one now answers 404');
  });

  it('is not written when it is already closed', () => {
    const { code, calls } = run({ disallowPublicOrgRegistration: true, allowedLanguages: ['nl', 'en'] });
    expect(code).toBe(0);
    expect(calls).toEqual(['GET /admin/v1/restrictions']);
  });

  it('stops, naming the setting, when the write does not take', () => {
    const { code, said } = run({ disallowPublicOrgRegistration: false }, false);
    expect(code).not.toBe(0);
    expect(said).toContain('FATAL: could not close public organisation registration');
    expect(said).toContain('disallowPublicOrgRegistration still reads false');
    expect(said, 'the refusal gives no way to set it by hand').toContain('-X PUT https://id.example.test/admin/v1/restrictions');
  });

  it('runs on every bring-up, before the configuration is written', () => {
    const code = directives(setup);
    const called = code.search(/^close_public_org_registration$/m);
    expect(called, 'close_public_org_registration is defined and never called').toBeGreaterThan(0);
    expect(called).toBeLessThan(code.indexOf('say "writing the configuration into .env"'));
  });
});

describe('the gate', () => {
  it('asks the page itself, and fails unless it answers 404', () => {
    const smoke = directives(read('smoke-managed.sh'));
    const at = smoke.indexOf('/ui/login/register/org"');
    expect(at, 'the smoke never asks for the form').toBeGreaterThan(0);
    const check = smoke.slice(at, smoke.indexOf('\n  fi\n', at));
    expect(check).toMatch(/if \[ "\$org_form_code" = "404" \]; then/);
    expect(check.slice(check.indexOf('else'))).toContain('fail_at');
  });
});
