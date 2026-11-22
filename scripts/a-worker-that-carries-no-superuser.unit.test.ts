// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WORKER THAT CARRIES THE OWNER'S CONNECTION STRING (workplan 0167 T7), the
 * twin of `a-run-that-carries-no-superuser` for the job worker.
 *
 * The managed edition's jobs move from Trigger.dev task runs to a worker
 * service in `deploy/compose/managed.yml` (ADR-0054). A task run receives what
 * `set-task-env.sh` uploads, and that guard holds the upload to no value
 * composed from the database owner's user or password, under any name. The
 * worker receives what its service's `environment:` composes instead, from the
 * same `.env`, and Compose writes whatever it is told: one line
 * `DATABASE_URL: postgresql://${POSTGRES_USER}…`, copied from the api service
 * a few lines up, would hand every job the owner, a superuser that row
 * security never binds and that may run programs on the database server, and
 * the tasks' guard would never see it.
 *
 * So this file holds the worker's service, read from the file as written, not
 * rendered (a rendering is only as good as the values it was given):
 *
 * 1. its environment names neither of the owner's names, `DATABASE_URL` and
 *    `DIRECT_DATABASE_URL`;
 * 2. no value in it refers to `POSTGRES_USER` or `POSTGRES_PASSWORD`, at any
 *    depth of a `${…:-…}` default, braced or not, and none carries the
 *    owner's default user or password as a literal;
 * 3. it has no `env_file` (which would hand it the whole `.env`, the owner's
 *    password with it), and its environment is a map of its own, not a merge
 *    of another service's;
 * 4. every database URL in it is one of the three it may carry, by the role
 *    each names and the password variable each reads, through the pooler:
 *    `JOBS_DATABASE_URL` as `ownpace_jobs` with `JOBS_DB_PASSWORD`,
 *    `SYSTEM_DATABASE_URL` as `ownpace_system` with `SYSTEM_DB_PASSWORD`, and
 *    `APP_DATABASE_URL` as `app_user`; and no other value is a database URL;
 * 5. the api's `JOBS_DATABASE_URL` is the worker's, character for character;
 * 6. and rules 1 and 2 hold for every line of the service that is not a
 *    comment, not only its environment: a `command:`, an `entrypoint:`, a
 *    build argument or a label that carried the owner's URL would hand it to
 *    the process all the same (the review of #2046).
 *
 * The last block breaks each rule on a copy of the file and expects it caught.
 *
 * WHAT IS NOT. Whether the roles are what their files make them: the bring-up
 * asks Postgres that (`db_roles_jobs_fit`, `db_roles_system_fit`). And what
 * `.env` holds under those names.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED = 'deploy/compose/managed.yml';
const managed = readFileSync(join(REPO_ROOT, MANAGED), 'utf8');

/** The names the owner's URL goes under in the api, which no job may read. */
const OWNER_NAMES = ['DATABASE_URL', 'DIRECT_DATABASE_URL'];
/** The owner's variables in `.env`, and managed.yml's defaults for them. */
const OWNER_VARIABLES = ['POSTGRES_USER', 'POSTGRES_PASSWORD'];
const OWNER_DEFAULTS = ['openmigrate_password', 'postgresql://openmigrate:', 'postgresql://${POSTGRES_USER'];

/** The pooler, as the stack's other role URLs reach it. */
const POOLER = '@${DB_HOST:-pgbouncer}:${DB_PORT:-6432}/${POSTGRES_DB:-openmigrate}';
/** The database URLs the worker may carry, each exactly. */
export const WORKER_URLS: Readonly<Record<string, string>> = {
  JOBS_DATABASE_URL: `postgresql://ownpace_jobs:\${JOBS_DB_PASSWORD:-}${POOLER}`,
  SYSTEM_DATABASE_URL: `postgresql://ownpace_system:\${SYSTEM_DB_PASSWORD:-}${POOLER}`,
  APP_DATABASE_URL: `postgresql://\${APP_DB_USER:-app_user}:\${APP_DB_PASSWORD:-app_password}${POOLER}`,
};

type Service = { environment?: unknown; env_file?: unknown; extends?: unknown };
type Compose = { services?: Record<string, Service | null> };

/** Every variable a Compose value refers to, defaults' own included (`${A:-${B}}`, `$C`). */
export function variablesIn(value: string): string[] {
  const names: string[] = [];
  const text = value.replace(/\$\$/g, '');
  for (const m of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)|\$([A-Za-z_][A-Za-z0-9_]*)/g)) names.push(m[1] ?? m[2]!);
  return names;
}

/** What is wrong with the worker's service in `text`; empty when nothing is. */
export function workerProblems(text: string): string[] {
  // The raw file first: a merge key or an alias would bring another service's map in.
  const block = /^ {2}worker:\n([\s\S]*?)(?=^ {2}[a-z][a-z0-9-]*:\n|^[a-z])/m.exec(text)?.[1];
  if (block === undefined) return [`${MANAGED} has no worker service`];
  const problems: string[] = [];
  // Every line that is not a comment, whatever key it is under.
  for (const [n, raw] of block.split('\n').entries()) {
    const line = raw.replace(/^\s*#.*$/, '').replace(/\s+#\s.*$/, '');
    if (!line.trim()) continue;
    const owner = variablesIn(line).filter((v) => OWNER_VARIABLES.includes(v));
    if (owner.length > 0) problems.push(`line ${n + 1} of the worker service refers to ${[...new Set(owner)].join(' and ')}, the database owner's: ${line.trim()}`);
    for (const literal of OWNER_DEFAULTS) {
      if (line.includes(literal) && owner.length === 0) problems.push(`line ${n + 1} of the worker service carries the owner's default (${literal}): ${line.trim()}`);
    }
    for (const name of OWNER_NAMES) {
      if (new RegExp(`(^|[^A-Z_])${name}([^A-Z_]|$)`).test(line)) problems.push(`line ${n + 1} of the worker service names ${name}, the database owner's: ${line.trim()}`);
    }
  }
  if (/^\s+<<:/m.test(block) || /:\s+\*[A-Za-z]/.test(block.replace(/logging: \*logging/, ''))) {
    problems.push('the worker service merges or aliases a map from elsewhere in the file: write its environment out in full');
  }
  let compose: Compose;
  try {
    compose = parseYaml(text, { merge: true, logLevel: 'error' }) as Compose;
  } catch (e) {
    return [...problems, `${MANAGED} does not parse: ${String((e as Error).message).split('\n')[0]}`];
  }
  const worker = compose.services?.['worker'];
  if (!worker) return [...problems, `${MANAGED} has no worker service`];
  if (worker.env_file !== undefined) problems.push('the worker service has an env_file, which hands it every key of .env, the owner\'s password among them');
  if (worker.extends !== undefined) problems.push('the worker service extends another service, whose environment it would carry');
  const env = worker.environment;
  if (!env || typeof env !== 'object' || Array.isArray(env)) return [...problems, 'the worker service has no environment map to read'];
  for (const [name, raw] of Object.entries(env as Record<string, unknown>)) {
    const value = raw === null || raw === undefined ? '' : String(raw);
    if (OWNER_NAMES.includes(name)) problems.push(`the worker's environment names ${name}, the database owner's`);
    const owner = variablesIn(value).filter((v) => OWNER_VARIABLES.includes(v));
    if (owner.length > 0) problems.push(`the worker's ${name} is composed from ${[...new Set(owner)].join(' and ')}, the database owner's`);
    for (const literal of OWNER_DEFAULTS) {
      if (value.includes(literal) && owner.length === 0) problems.push(`the worker's ${name} carries the owner's default (${literal})`);
    }
    if (raw === null && OWNER_VARIABLES.includes(name)) problems.push(`the worker's environment passes ${name} through from .env`);
    const url = /^postgres(?:ql)?:\/\//.test(value);
    if (url && !(name in WORKER_URLS)) problems.push(`the worker's ${name} is a database URL, and the worker carries only ${Object.keys(WORKER_URLS).join(', ')}`);
    if (name in WORKER_URLS && value !== WORKER_URLS[name]) {
      problems.push(`the worker's ${name} is ${value}, not ${WORKER_URLS[name]}`);
    }
  }
  for (const name of Object.keys(WORKER_URLS)) {
    if (!(name in (env as Record<string, unknown>))) problems.push(`the worker's environment has no ${name}`);
  }
  const api = compose.services?.['api']?.environment as Record<string, unknown> | undefined;
  if (api?.['JOBS_DATABASE_URL'] !== (env as Record<string, unknown>)['JOBS_DATABASE_URL']) {
    problems.push(`the api's JOBS_DATABASE_URL is ${String(api?.['JOBS_DATABASE_URL'])}, and the worker's another`);
  }
  return problems;
}

describe("the job worker's environment carries no database owner (workplan 0167 T7)", () => {
  it('finds the worker and reads its environment (vacuity)', () => {
    const env = (parseYaml(managed, { merge: true }) as Compose).services?.['worker']?.environment as Record<string, unknown>;
    expect(Object.keys(env ?? {}).length).toBeGreaterThan(20);
    expect(variablesIn('postgresql://${A:-a}:${B:-${C}}@$D/$$E')).toEqual(['A', 'B', 'C', 'D']);
  });

  it(`${MANAGED}'s worker: no owner name, no owner variable, no env_file, and only its three role URLs, through the pooler`, () => {
    expect(workerProblems(managed)).toEqual([]);
  });

  it("refuses each way back to the owner, on a copy of the file", () => {
    const at = (find: string, replace: string): string => {
      expect(managed.includes(find), `${MANAGED} no longer holds ${find}, so this case would prove nothing`).toBe(true);
      return managed.replace(find, replace);
    };
    const workerEnv = '      OWNPACE_JOB_RUNNER: ${OWNPACE_JOB_RUNNER:-trigger}\n      NODE_ENV: production\n';
    const cases: Array<[string, string, RegExp]> = [
      [
        'the api\'s DATABASE_URL copied in',
        at(workerEnv, `${workerEnv}      DATABASE_URL: postgresql://\${POSTGRES_USER:-openmigrate}:\${POSTGRES_PASSWORD:-openmigrate_password}@pgbouncer:6432/openmigrate\n`),
        /names DATABASE_URL, the database owner's[\s\S]*composed from POSTGRES_USER and POSTGRES_PASSWORD/,
      ],
      [
        'the direct URL under another name',
        at(workerEnv, `${workerEnv}      MIGRATIONS_URL: postgresql://\${POSTGRES_USER}:\${POSTGRES_PASSWORD}@postgres:5432/openmigrate\n`),
        /MIGRATIONS_URL is composed from POSTGRES_USER and POSTGRES_PASSWORD/,
      ],
      [
        "the owner's password inside a default",
        at('${SYSTEM_DB_PASSWORD:-}', '${SYSTEM_DB_PASSWORD:-${POSTGRES_PASSWORD}}'),
        /SYSTEM_DATABASE_URL is composed from POSTGRES_PASSWORD/,
      ],
      ['the password passed through bare', at(workerEnv, `${workerEnv}      POSTGRES_PASSWORD:\n`), /passes POSTGRES_PASSWORD through from \.env/],
      [
        "the owner's default as a literal",
        at(workerEnv, `${workerEnv}      LEDGER_URL: postgresql://openmigrate:openmigrate_password@pgbouncer:6432/openmigrate\n`),
        /LEDGER_URL carries the owner's default[\s\S]*LEDGER_URL is a database URL/,
      ],
      ['an env_file', at('    container_name: ${COMPOSE_PROJECT_NAME}-worker\n', '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n    env_file: .env\n'), /has an env_file/],
      [
        'the jobs role swapped for the owner',
        at('JOBS_DATABASE_URL: postgresql://ownpace_jobs:${JOBS_DB_PASSWORD:-}@${DB_HOST:-pgbouncer}:${DB_PORT:-6432}/${POSTGRES_DB:-openmigrate}\n      # WHAT', 'JOBS_DATABASE_URL: postgresql://ownpace_jobs:${JOBS_DB_PASSWORD:-}@postgres:5432/${POSTGRES_DB:-openmigrate}\n      # WHAT'),
        /JOBS_DATABASE_URL is postgresql:\/\/ownpace_jobs:\$\{JOBS_DB_PASSWORD:-\}@postgres:5432[\s\S]*the api's JOBS_DATABASE_URL/,
      ],
    ];
    for (const [what, text, expected] of cases) {
      expect(workerProblems(text).join('\n'), what).toMatch(expected);
    }
    // Outside the environment: a command, an entrypoint, a build argument, a label.
    const outside: Array<[string, string, string]> = [
      ['a command', '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n', '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n    command: ["apps/worker/src/runner/main.ts", "--db", "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/openmigrate"]\n'],
      ['an entrypoint', '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n', '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n    entrypoint: ["/nodejs/bin/node", "--env-file-if-exists=$POSTGRES_PASSWORD"]\n'],
      ['a build argument', '        GIT_SHA: ${GIT_SHA:-unknown}\n    container_name: ${COMPOSE_PROJECT_NAME}-worker', '        GIT_SHA: ${GIT_SHA:-unknown}\n        OWNER: ${POSTGRES_PASSWORD:-openmigrate_password}\n    container_name: ${COMPOSE_PROJECT_NAME}-worker'],
      ['a label', '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n', '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n    labels:\n      db: postgresql://openmigrate:openmigrate_password@pgbouncer:6432/openmigrate\n'],
    ];
    for (const [what, find, replace] of outside) {
      const text = at(find, replace);
      expect(workerProblems(text).join('\n'), what).toMatch(/line \d+ of the worker service (refers to POSTGRES|carries the owner's default)/);
    }
    // A comment that names the owner is prose, and stays allowed.
    expect(workerProblems(at('    container_name: ${COMPOSE_PROJECT_NAME}-worker\n', '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n    # never ${POSTGRES_PASSWORD} here\n'))).toEqual([]);
    // And a merge of the api's map, which a reading of the parsed map alone would credit to the worker.
    const merged = at('    environment:\n      # THE SWITCH, read by the api, this worker', '    environment:\n      <<: *api-env\n      # THE SWITCH, read by the api, this worker');
    expect(workerProblems(merged).join('\n')).toMatch(/merges or aliases a map/);
  });
});
