// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SECRET THE IMAGE COPIED: the pooler's user list, which git ignores because
 * it holds a password, was in every image a stack built (the review of #2046,
 * 2026-11-22).
 *
 * `ensure-env-secrets.sh` writes `"pgbouncer_auth" "<password>"` in plain text
 * to `deploy/compose/pgbouncer/userlist.txt` in the checkout, mode 644. The
 * file is in `.gitignore`, so it is never committed, and it was not in
 * `.dockerignore`. The API's image, and now the worker's, build from the
 * repository root with `COPY . .`, so an image built on a stack carried it,
 * readable by the uid the service runs as. `pgbouncer_auth` may run the
 * SECURITY DEFINER lookup that returns any role's password verifier.
 *
 * So this file holds two lists against both ignore files:
 *
 * 1. Every path `.gitignore` names under `deploy/compose/` is a secret this
 *    file lists, or is named here with the reason it holds none. A new
 *    generated file there fails until somebody has decided which it is.
 * 2. Every secret the stack's scripts write into the checkout is excluded by
 *    `.dockerignore`, read as Docker reads it: patterns from the context's
 *    root, `*` within a name, `**` across directories, a matched directory
 *    excluding what is in it, and the last matching line deciding, `!`
 *    included.
 *
 * WHAT IT DOES NOT HOLD. A secret written outside the repository (the OTA
 * stack's persisted user list, `PGBOUNCER_USERLIST`), which `COPY . .` never
 * sees; and what an image does with a secret handed to it at run time.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** The secrets the managed stack's scripts write into the checkout, each with its writer. */
export const SECRETS_IN_THE_CHECKOUT: Readonly<Record<string, string>> = {
  'deploy/compose/.env': 'every password and key of the stack (ensure-env-secrets.sh, env-upsert.sh)',
  'deploy/compose/.env.managed': 'an older name of the same file, still in .gitignore',
  'deploy/compose/.env.bak-20261122T000000Z': "check-env-agreement.sh --fix's copy of .env, before it changes it",
  'deploy/compose/.env.fix.Ab12Cd': "check-env-agreement.sh --fix's temporary copy of .env",
  'deploy/compose/.env.upsert.Ab12Cd': "env-upsert.sh's temporary copy of .env",
  'deploy/compose/pgbouncer/userlist.txt': "pgbouncer_auth's password in plain text (ensure-env-secrets.sh)",
};

/** Paths .gitignore names under deploy/compose/ that hold no secret, each with the reason. */
export const NOT_SECRET: Readonly<Record<string, string>> = {};

/** .gitignore's lines that name a path under deploy/compose/. */
export function gitignoredUnderCompose(gitignore: string): string[] {
  return gitignore
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.replace(/^\//, ''))
    .filter((l) => l.startsWith('deploy/compose/'));
}

/** A `.dockerignore` pattern as a regular expression over a path from the context's root. */
function patternToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i += 1;
      if (pattern[i + 1] === '/') i += 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A matched directory excludes everything under it.
  return new RegExp(`^${re}(/.*)?$`);
}

/** Whether `.dockerignore` keeps `path` out of the build context: the last matching line decides. */
export function dockerignored(dockerignore: string, path: string): boolean {
  let excluded = false;
  for (const raw of dockerignore.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    const pattern = (negate ? line.slice(1) : line).replace(/^\//, '').replace(/\/$/, '');
    if (patternToRegExp(pattern).test(path)) excluded = !negate;
  }
  return excluded;
}

describe("no secret the checkout holds reaches an image's build context", () => {
  const gitignore = read('.gitignore');
  const dockerignore = read('.dockerignore');

  it('reads .dockerignore as Docker does (vacuity)', () => {
    expect(dockerignored('**/node_modules\n', 'apps/api/node_modules/x/index.js')).toBe(true);
    expect(dockerignored('**/.env.*\n!**/.env.example\n', 'deploy/compose/managed.env.example')).toBe(false);
    expect(dockerignored('**/.env.*\n!**/.env.example\n', 'deploy/compose/.env.example')).toBe(false);
    expect(dockerignored('**/.env.*\n', 'deploy/compose/.env.bak-1')).toBe(true);
    expect(dockerignored('deploy/compose/pgbouncer/userlist.txt\n', 'deploy/compose/pgbouncer/userlist.txt')).toBe(true);
    expect(dockerignored('deploy/compose/pgbouncer/userlist.txt\n', 'deploy/compose/pgbouncer/pgbouncer.ini')).toBe(false);
    expect(dockerignored('', 'deploy/compose/pgbouncer/userlist.txt')).toBe(false);
  });

  it('every path .gitignore names under deploy/compose/ is a listed secret, or says why it holds none', () => {
    const named = gitignoredUnderCompose(gitignore);
    expect(named.length, '.gitignore names nothing under deploy/compose/, so this would prove nothing').toBeGreaterThan(0);
    const unread = named.filter((p) => !(p in SECRETS_IN_THE_CHECKOUT) && !(p in NOT_SECRET));
    expect(unread, 'add each to SECRETS_IN_THE_CHECKOUT (and .dockerignore) or to NOT_SECRET with its reason').toEqual([]);
  });

  it.each(Object.entries(SECRETS_IN_THE_CHECKOUT))('.dockerignore keeps %s out of every image (%s)', (path) => {
    expect(dockerignored(dockerignore, path), `${path} holds a secret and COPY . . would put it in the image`).toBe(true);
  });

  it('refuses the shape the review found: the user list dropped from .dockerignore', () => {
    const before = dockerignore.split('\n').filter((l) => l.trim() === 'deploy/compose/pgbouncer/userlist.txt');
    expect(before, '.dockerignore no longer names the user list by its path').toHaveLength(1);
    const dropped = dockerignore.replace(/^deploy\/compose\/pgbouncer\/userlist\.txt\n?/m, '');
    expect(dockerignored(dropped, 'deploy/compose/pgbouncer/userlist.txt')).toBe(false);
  });
});
