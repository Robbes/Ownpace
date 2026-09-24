// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A LIMIT THE API WAS NEVER HANDED.
 *
 * The access-request limiter has two knobs, and its own header names them as
 * the remedy: `TRUST_PROXY` (read by `apps/api/src/index.ts`, so the bucket is
 * the caller rather than the ingress) and `ACCESS_REQUEST_MAX_PER_HOUR` (read
 * by `knockLimitFromEnv`). `deploy/compose/managed.yml` lists the `api`
 * service's environment key by key and named neither, so setting either in
 * `.env` did nothing: every knock shared one service-wide bucket of 60 an
 * hour, and an operator who raised the cap during a surge changed nothing.
 *
 * `the-mail-the-api-could-not-send` compares the mail keys the same way; this
 * is the same failure one function over. Both sides are read from the files:
 * the names from the code that reads them, the list from the compose file.
 *
 * EMPTY BY DEFAULT, because empty is today's behaviour. Workplan 0093 T2c says
 * when to set them, and trusting `X-Forwarded-For` while the api port is also
 * reachable directly lets any caller claim any address, so `managed.env.example`
 * has to say that beside the key.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

/** The variable `index.ts` hands Express as 'trust proxy'. */
function trustProxyName(): string {
  const m = /const trustProxy = process\.env\.([A-Z][A-Z0-9_]*)/.exec(read('apps/api/src/index.ts'));
  expect(m, "index.ts no longer reads 'trust proxy' from process.env the way this expects").toBeTruthy();
  return m![1]!;
}

/** The names `knockLimitFromEnv` reads, from its own body. */
function knockLimitNames(): string[] {
  const source = read('apps/api/src/knock-limit.ts');
  const start = source.indexOf('export function knockLimitFromEnv');
  expect(start, 'knockLimitFromEnv moved or was renamed').toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const next = rest.search(/\nexport (function|const|interface|type) /);
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

describe('the access-request limit can be set on a managed stack', () => {
  const names = [trustProxyName(), ...knockLimitNames()];
  const passed = apiEnvironment();
  const example = read('deploy/compose/managed.env.example');

  it('finds both knobs, so an empty comparison cannot pass', () => {
    expect(names).toContain('TRUST_PROXY');
    expect(names).toContain('ACCESS_REQUEST_MAX_PER_HOUR');
  });

  it.each(names.map((name) => [name] as const))('the api container is handed %s', (name) => {
    expect(
      Object.keys(passed),
      `the api reads ${name}, but managed.yml never passes it to the api service. Compose passes\n` +
        'nothing it has not been told to pass, so setting it in .env does nothing.',
    ).toContain(name);
    expect(
      passed[name],
      `${name} must default to empty: empty is today's behaviour (workplan 0093 T2c).`,
    ).toBe(`\${${name}:-}`);
  });

  it.each(names.map((name) => [name] as const))('managed.env.example names %s', (name) => {
    expect(example, `an operator cannot find ${name} in managed.env.example`).toMatch(
      new RegExp(`^${name}=`, 'm'),
    );
  });

  it('warns beside TRUST_PROXY that a directly reachable api lets callers pick their address', () => {
    const at = example.search(/^TRUST_PROXY=/m);
    expect(example.slice(Math.max(0, at - 800), at)).toMatch(/X-Forwarded-For/);
  });
});
