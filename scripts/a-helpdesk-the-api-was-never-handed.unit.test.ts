// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A HELPDESK THE API WAS NEVER HANDED.
 *
 * "Report a problem" (workplan 0130) is offered only when the API can read
 * `ZAMMAD_URL` and `ZAMMAD_TOKEN`; `ZAMMAD_GROUP` picks the group a ticket
 * lands in. `deploy/compose/managed.env.example` carries all three and step 8f
 * of `docs/managed-bring-up.md` says to set them there — but
 * `deploy/compose/managed.yml` lists the `api` service's environment key by
 * key and named none of them, so setting them in `.env` did nothing and the
 * form could not appear on any managed stack. Found by the 2026-09-24
 * readiness review's plan pass, one day after the form shipped.
 *
 * The third of its kind: `the-mail-the-api-could-not-send` compares the mail
 * keys and `a-limit-the-api-was-never-handed` the access-request limit's. The
 * names come from the code that reads them (`zammadConfigFrom` in
 * `apps/api/src/services/zammad.ts`), the list from the compose file.
 *
 * EMPTY BY DEFAULT, because empty is "no form", which is today's behaviour and
 * the right one for a stack whose owner runs no helpdesk.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

/** The names `zammadConfigFrom` reads, from its own body. */
function helpdeskNames(): string[] {
  const source = read('apps/api/src/services/zammad.ts');
  const start = source.indexOf('export function zammadConfigFrom');
  expect(start, 'zammadConfigFrom moved or was renamed').toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport (async function|function|const|interface|type|class) /);
  const body = next === -1 ? rest : rest.slice(0, next);
  return [...new Set([...body.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)].map((m) => m[1]!))];
}

function apiEnvironment(): Record<string, unknown> {
  const doc = parseYaml(read('deploy/compose/managed.yml')) as {
    services: Record<string, { environment?: Record<string, unknown> }>;
  };
  const env = doc.services?.api?.environment;
  expect(env, 'managed.yml has no api service with an environment mapping').toBeTruthy();
  return env!;
}

describe('problem reports can be switched on for a managed stack', () => {
  const names = helpdeskNames();
  const passed = apiEnvironment();
  const example = read('deploy/compose/managed.env.example');

  it('finds the three settings, so an empty comparison cannot pass', () => {
    expect(names).toEqual(expect.arrayContaining(['ZAMMAD_URL', 'ZAMMAD_TOKEN', 'ZAMMAD_GROUP']));
  });

  it.each(names.map((name) => [name] as const))('the api container is handed %s', (name) => {
    expect(
      Object.keys(passed),
      `the api reads ${name}, but managed.yml never passes it to the api service. Compose passes\n` +
        'nothing it has not been told to pass, so setting it in .env does nothing.',
    ).toContain(name);
    expect(passed[name], `${name} must default to empty: empty means no form is offered.`).toBe(
      `\${${name}:-}`,
    );
  });

  it.each(names.map((name) => [name] as const))('managed.env.example names %s', (name) => {
    expect(example, `an operator cannot find ${name} in managed.env.example`).toMatch(
      new RegExp(`^${name}=`, 'm'),
    );
  });
});
