// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * ONE ORGANISATION, COUNTED (workplan 0135 T3).
 *
 * T1 and T2 keep a stranger from founding a second organisation at the identity
 * provider from now on. Nothing said whether anybody had, before they were in
 * place: on the OTA instance the form was open until E2E (managed) #203 closed
 * it. An organisation somebody founded could hold an account whose address the
 * provider calls verified, and a grant could be bound to it. So every run of
 * `setup-zitadel.sh` counts them:
 *
 * - it asks `POST /admin/v1/orgs/_search` and reads `details.totalResult`,
 *   which proto3 JSON writes as a string;
 * - one is said plainly, and the closing summary carries the number;
 * - more than one is a loud warning that says to stop granting and where the
 *   steps are, and the run goes on: whoever runs the instance may create a
 *   second organisation on purpose;
 * - it gives the number only, never a name, because the gate's log is public.
 *
 * Run, not read: the script's own functions against a stand-in provider.
 *
 * It fails today: nothing counts the organisations.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

/** Two organisations with names nobody may print, in the shape the admin API answers. */
const TWO = {
  details: { totalResult: '2' },
  result: [
    { id: '310000000000000001', name: 'ZITADEL', primaryDomain: 'zitadel.example.test' },
    { id: '310000000000000002', name: 'Acme Stranger BV', primaryDomain: 'acme-stranger-bv.example.test' },
  ],
};
const ONE = { details: { totalResult: '1' }, result: [TWO.result[0]] };

/** Count against a stand-in provider that answers the search with `answer`; what was said, and how it ended. */
function count(answer: unknown) {
  const program = [
    'set -euo pipefail',
    'say() { echo "[setup-zitadel] $*"; }',
    'die() { echo "[setup-zitadel] FATAL: $*" >&2; exit 1; }',
    'api() {',
    '  [ "$1 $2" = "POST /admin/v1/orgs/_search" ] || { echo "unexpected call: $1 $2" >&2; exit 1; }',
    `  printf '%s' '${JSON.stringify(answer)}'`,
    '}',
    fn('count_organisations'),
    fn('say_organisation_count'),
    'ORG_COUNT="$(count_organisations)"',
    'say_organisation_count "$ORG_COUNT"',
    'echo "counted: $ORG_COUNT"',
  ].join('\n');
  const r = spawnSync('bash', ['-c', program], { encoding: 'utf8' });
  return { code: r.status ?? -1, said: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('the count', () => {
  it('reads the number the provider answers, as a string', () => {
    expect(count(ONE).said).toContain('counted: 1');
    expect(count(TWO).said).toContain('counted: 2');
  });

  it('says one plainly', () => {
    const { code, said } = count(ONE);
    expect(code).toBe(0);
    expect(said).toContain('organisations on this instance: 1, as it should be');
    expect(said).not.toContain('WARNING');
  });

  it('warns loudly above one, says to stop granting and where the steps are, and goes on', () => {
    const { code, said } = count(TWO);
    expect(code, 'a second organisation stopped the run').toBe(0);
    expect(said).toContain('WARNING: THIS INSTANCE HOLDS 2 ORGANISATIONS, AND IT SHOULD HOLD ONE.');
    expect(said).toContain('Stop granting access until it is checked');
    expect(said).toContain('workplan 0135, T3');
  });

  it('warns on an answer with no count, rather than passing it as one', () => {
    // proto3 JSON leaves a zero out, so an empty search answers without the field.
    const { code, said } = count({ details: {} });
    expect(code).toBe(0);
    expect(said).toContain('counted: 0');
    expect(said).toContain('WARNING: THIS INSTANCE HOLDS 0 ORGANISATIONS');
  });

  it('gives the number only, never a name or a domain, because the gate’s log is public', () => {
    const { said } = count(TWO);
    for (const org of TWO.result) {
      expect(said).not.toContain(org.name);
      expect(said).not.toContain(org.primaryDomain);
    }
  });
});

describe('the bring-up', () => {
  it('counts on every run, after the organisation form is closed, and prints the number in its summary', () => {
    const code = directives(setup);
    const closed = code.search(/^close_public_org_registration$/m);
    const counted = code.search(/^ORG_COUNT="\$\(count_organisations\)"$/m);
    expect(counted, 'nothing counts the organisations').toBeGreaterThan(0);
    expect(counted).toBeGreaterThan(closed);
    expect(code).toMatch(/^say_organisation_count "\$ORG_COUNT"$/m);
    const summary = code.slice(code.lastIndexOf('cat <<EOF'));
    expect(summary).toMatch(/^ {2}organisations \$\{ORG_COUNT\}/m);
  });
});
