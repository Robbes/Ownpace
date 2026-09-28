// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROJECT FOR ONE ORGANISATION (workplan 0135 T2).
 *
 * The Ownpace project at the identity provider was created with `{name}` and
 * nothing else, so it accepted users from every organisation on the instance,
 * one that a stranger founded included (0135 §1, and T1 beside this).
 * `hasProjectCheck` makes the provider refuse a user whose organisation holds
 * no grant on the project. Everybody let in registers in, or arrives through a
 * provider into, the project's own organisation, and passes. Run, not read,
 * where it can be:
 *
 * - a new project is created with the check;
 * - an existing one without it is updated, with the project's other three
 *   settings copied from what it answers, because the update takes all of them
 *   from the body; then it is read back, and the script stops, naming the
 *   setting, when it did not take;
 * - a project that already has it is not written;
 * - it runs on every bring-up, once the project is known and before the app is
 *   configured.
 *
 * It fails today: the create body is `{name:$n}`, and nothing updates an
 * existing project.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const setup = readFileSync(join(REPO_ROOT, 'deploy/compose/setup-zitadel.sh'), 'utf8');

/** Shell source with comment-only lines removed: a rule must not be satisfied by its own explanation. */
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

const PROJECT = '/management/v1/projects/310000000000000001';

/**
 * The lifted functions against a stand-in `api`. A GET answers the project as
 * the file holds it; a PUT replaces the project's settings with its body when
 * `takes`, as the provider's update does, and is answered either way.
 */
function run(project: Record<string, unknown>, takes = true): Run {
  const home = mkdtempSync(join(tmpdir(), 'projectcheck-'));
  try {
    const state = join(home, 'project.json');
    const calls = join(home, 'calls');
    writeFileSync(state, JSON.stringify({ project: { id: '310000000000000001', state: 'PROJECT_STATE_ACTIVE', ...project } }));
    writeFileSync(calls, '');
    const apply = takes
      ? `jq -c --argjson b "$3" '.project |= ({id, state} + $b)' "${state}" > "${state}.new" && mv "${state}.new" "${state}"`
      : ':';
    const program = [
      'set -euo pipefail',
      'ISSUER=https://id.example.test',
      'PROJECT_ID=310000000000000001',
      'PROJECT_NAME=Ownpace',
      'say() { echo "[setup-zitadel] $*"; }',
      'die() { echo "[setup-zitadel] FATAL: $*" >&2; exit 1; }',
      'api() {',
      `  printf '%s %s%s\\n' "$1" "$2" "\${3:+ $3}" >> "${calls}"`,
      '  case "$1 $2" in',
      `    "GET ${PROJECT}") cat "${state}" ;;`,
      `    "PUT ${PROJECT}") ${apply}; echo '{"details":{}}' ;;`,
      '    *) echo "unexpected call: $1 $2" >&2; exit 1 ;;',
      '  esac',
      '}',
      fn('project_check_on'),
      fn('admit_own_organisation_only'),
      'admit_own_organisation_only',
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

/** The body of the one PUT a run made. */
function written(calls: string[]): Record<string, unknown> {
  const puts = calls.filter((call) => call.startsWith(`PUT ${PROJECT} `));
  expect(puts, calls.join('\n')).toHaveLength(1);
  return JSON.parse(puts[0]!.slice(`PUT ${PROJECT} `.length)) as Record<string, unknown>;
}

describe('a new project', () => {
  it('is created with the check', () => {
    const create = directives(setup).match(/api POST \/management\/v1\/projects "[^\n]*/)?.[0] ?? '';
    expect(create, 'nothing creates the project').not.toBe('');
    expect(create).toMatch(/\{name:\$n, hasProjectCheck:true\}/);
  });
});

describe('an existing project', () => {
  it('without the check is updated, its other settings copied, and read back', () => {
    // protojson leaves out a field that holds its default: this project asserts
    // roles, and its check and labelling setting are at their defaults.
    const { code, said, calls } = run({ name: 'Ownpace', projectRoleAssertion: true });
    expect(code, said).toBe(0);
    expect(written(calls)).toEqual({
      name: 'Ownpace',
      projectRoleAssertion: true,
      projectRoleCheck: false,
      privateLabelingSetting: 'PRIVATE_LABELING_SETTING_UNSPECIFIED',
      hasProjectCheck: true,
    });
    expect(calls.at(-1), 'nothing read the setting back after the write').toBe(`GET ${PROJECT}`);
    expect(said).toContain('it now admits its own organisation only');
  });

  it('keeps a labelling setting it already had', () => {
    const setting = 'PRIVATE_LABELING_SETTING_ENFORCE_PROJECT_RESOURCE_OWNER_POLICY';
    const { code, calls } = run({ name: 'Ownpace', privateLabelingSetting: setting, projectRoleCheck: true });
    expect(code).toBe(0);
    expect(written(calls)).toMatchObject({ privateLabelingSetting: setting, projectRoleCheck: true, hasProjectCheck: true });
  });

  it('with the check is not written', () => {
    const { code, calls } = run({ name: 'Ownpace', hasProjectCheck: true });
    expect(code).toBe(0);
    expect(calls).toEqual([`GET ${PROJECT}`]);
  });

  it('stops, naming the setting, when the update does not take', () => {
    const { code, said } = run({ name: 'Ownpace' }, false);
    expect(code).not.toBe(0);
    expect(said).toContain("FATAL: could not make the 'Ownpace' project admit its own organisation only");
    expect(said).toContain('hasProjectCheck: false');
  });
});

describe('the bring-up', () => {
  it('checks the project every time, once it is known and before the app is configured', () => {
    const code = directives(setup);
    const called = code.search(/^admit_own_organisation_only$/m);
    expect(called, 'admit_own_organisation_only is defined and never called').toBeGreaterThan(0);
    expect(called).toBeGreaterThan(code.indexOf('say "project ${PROJECT_ID}"'));
    expect(called).toBeLessThan(code.indexOf(`say "looking for an existing '\${APP_NAME}' application"`));
  });
});
