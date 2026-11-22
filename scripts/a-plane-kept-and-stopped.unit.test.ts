// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PLANE KEPT INSTALLED AND STOPPED (workplan 0167 T7; ADR-0054).
 *
 * alpha.16 moves the managed edition's jobs from Trigger.dev to pg-boss, the
 * `worker` service, and keeps Trigger.dev's plane installed and stopped as the
 * way back (OWNPACE_JOB_RUNNER=trigger, then the bring-up). In
 * `deploy/compose/managed.yml` that is a profile: each of the plane's eleven
 * services is in profile `trigger`, so a plain `up` starts none of them, and
 * the bring-up in trigger mode names them (or `--profile trigger`).
 *
 * Two Compose facts make it easy to get wrong, and each would stop every
 * Compose call on the stack, a `ps` and an `exec postgres` among them:
 *
 *  - a service outside the profile that `depends_on` one inside it is refused
 *    unless that dependency says `required: false` (the api on trigger-api);
 *  - a profile does not stop interpolation, so the plane's `:?` keys are read
 *    in either mode (managed-env-contract keeps them generated).
 *
 * And three readers must name the same eleven: job-runner.sh's stop order
 * (with the two one-shots, which exit by themselves), the bring-up's list of
 * the plane it starts in trigger mode, and this file's profile. A twelfth
 * service of the plane outside the profile would run beside the worker in
 * pg-boss mode; one in the profile that a list leaves out would never be
 * started, or never be stopped.
 *
 * What this holds:
 *  1. exactly the eleven services of the plane are in profile `trigger`, and
 *     no other service is in it; the worker is in no profile;
 *  2. every `depends_on` from a service outside the profile to one inside it
 *     says `required: false`;
 *  3. the api and the worker give OWNPACE_JOB_RUNNER one default, `pg-boss`;
 *  4. the plane's networks and volumes are still declared;
 *  5. job-runner.sh's stop order and bootstrap-managed.sh's trigger-mode list
 *     name the profile's services.
 *
 * Each is broken once below, on a copy, and must fail.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED = 'deploy/compose/managed.yml';
const JOB_RUNNER = 'deploy/compose/job-runner.sh';
const BOOTSTRAP = 'deploy/compose/bootstrap-managed.sh';
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** Trigger.dev's plane, the eleven containers the plan counts. */
export const PLANE = [
  'trigger-db',
  'trigger-redis',
  'trigger-api',
  'clickhouse',
  'trigger-registry',
  'trigger-docker-proxy',
  'trigger-supervisor',
  'minio',
  'minio-init',
  'trigger-tls',
  'trigger-tls-init',
].sort();
/** The plane's one-shots: they exit by themselves, so the stop order leaves them out. */
const ONE_SHOTS = ['minio-init', 'trigger-tls-init'];
const PLANE_NETWORKS = ['trigger-event-store', 'trigger-docker-socket', 'trigger-task-images'];
const PLANE_VOLUMES = ['trigger_db_data', 'redis_data', 'trigger_shared', 'registry_data', 'minio_data_v2', 'trigger_tls_data', 'trigger_tls_config', 'clickhouse_data_v2', 'clickhouse_logs'];

type Dep = { condition?: string; required?: boolean };
type Service = { profiles?: string[]; depends_on?: string[] | Record<string, Dep>; environment?: Record<string, string> };
type Compose = { services: Record<string, Service>; networks?: Record<string, unknown>; volumes?: Record<string, unknown> };

const inTrigger = (s: Service): boolean => (s.profiles ?? []).includes('trigger');

/** What is wrong with managed.yml's plane, its profile and the switch; empty when nothing is. */
export function composeProblems(text: string): string[] {
  const compose = parseYaml(text, { merge: true, logLevel: 'error' }) as Compose;
  const problems: string[] = [];
  const profiled = Object.entries(compose.services)
    .filter(([, s]) => inTrigger(s))
    .map(([n]) => n)
    .sort();
  if (JSON.stringify(profiled) !== JSON.stringify(PLANE)) {
    problems.push(`profile trigger holds ${profiled.join(', ') || 'nothing'}, not the plane's eleven: ${PLANE.join(', ')}`);
  }
  for (const name of PLANE) {
    const s = compose.services[name];
    if (!s) problems.push(`the plane's ${name} is gone from ${MANAGED}: alpha.16 keeps it installed, stopped`);
    else if (JSON.stringify(s.profiles) !== '["trigger"]') problems.push(`${name}'s profiles are ${JSON.stringify(s.profiles)}, not ["trigger"]`);
  }
  if (compose.services['worker']?.profiles !== undefined) problems.push(`the worker is in profile ${JSON.stringify(compose.services['worker']?.profiles)}: since the switch is on it is in none`);
  for (const [name, s] of Object.entries(compose.services)) {
    if (inTrigger(s) || !s.depends_on) continue;
    const deps: Record<string, Dep> = Array.isArray(s.depends_on) ? Object.fromEntries(s.depends_on.map((d) => [d, {}])) : s.depends_on;
    for (const [dep, how] of Object.entries(deps)) {
      if (compose.services[dep] && inTrigger(compose.services[dep]!) && how.required !== false) {
        problems.push(`${name} depends on ${dep}, which is in profile trigger, without required: false: every Compose call without that profile refuses the file`);
      }
    }
  }
  const defaults = [...text.matchAll(/\$\{OWNPACE_JOB_RUNNER:-([^}]*)\}/g)].map((m) => m[1]);
  if (new Set(defaults).size !== 1 || defaults[0] !== 'pg-boss') problems.push(`OWNPACE_JOB_RUNNER's defaults are ${JSON.stringify(defaults)}, not pg-boss alone`);
  for (const name of ['api', 'worker']) {
    if (compose.services[name]?.environment?.['OWNPACE_JOB_RUNNER'] !== '${OWNPACE_JOB_RUNNER:-pg-boss}') problems.push(`the ${name} does not read the switch with pg-boss as its default`);
  }
  for (const n of PLANE_NETWORKS) if (!compose.networks || !(n in compose.networks)) problems.push(`the plane's network ${n} is no longer declared`);
  for (const v of PLANE_VOLUMES) if (!compose.volumes || !(v in compose.volumes)) problems.push(`the plane's volume ${v} is no longer declared: it is the way back`);
  return problems;
}

/** The services a bash array assignment names, e.g. `JOB_RUNNER_PLANE_REST=(a b c)`. */
const arrayOf = (text: string, name: string): string[] =>
  (new RegExp(`^${name}=\\(([^)]*)\\)`, 'm').exec(text)?.[1] ?? '').split(/\s+/).filter(Boolean);

/** What the scripts name as the plane, against the profile; empty when they agree. */
export function scriptProblems(jobRunner: string, bootstrap: string): string[] {
  const problems: string[] = [];
  const stops = [...arrayOf(jobRunner, 'JOB_RUNNER_PLANE_FIRST'), ...arrayOf(jobRunner, 'JOB_RUNNER_PLANE_REST'), ...ONE_SHOTS].sort();
  if (JSON.stringify(stops) !== JSON.stringify(PLANE)) problems.push(`${JOB_RUNNER}'s stop order and the one-shots are ${stops.join(', ')}, not the profile's ${PLANE.join(', ')}`);
  const started = /services\+=\(((?:trigger-|clickhouse|minio)[^)]*)\)/.exec(bootstrap)?.[1]?.split(/\s+/).filter(Boolean).sort() ?? [];
  if (JSON.stringify(started) !== JSON.stringify(PLANE)) problems.push(`${BOOTSTRAP} starts ${started.join(', ') || 'no plane'} in trigger mode, not the profile's ${PLANE.join(', ')}`);
  return problems;
}

describe("Trigger.dev's plane is kept installed and stopped, in profile trigger (0167 T7)", () => {
  const managed = read(MANAGED);
  const jobRunner = read(JOB_RUNNER);
  const bootstrap = read(BOOTSTRAP);

  it(`${MANAGED}: the eleven in profile trigger, nothing else, the worker in none, the switch on`, () => {
    expect(composeProblems(managed)).toEqual([]);
  });

  it("the stop order and the bring-up's trigger-mode list name the profile's services", () => {
    expect(scriptProblems(jobRunner, bootstrap)).toEqual([]);
  });

  it('refuses each way off it, on a copy', () => {
    const at = (text: string, find: string, replace: string): string => {
      expect(text.includes(find), `no longer holds ${find}`).toBe(true);
      return text.replace(find, replace);
    };
    const cases: Array<[string, string, RegExp]> = [
      ['minio out of the profile', at(managed, '    container_name: ${COMPOSE_PROJECT_NAME}-trigger-minio\n    profiles: ["trigger"]\n', '    container_name: ${COMPOSE_PROJECT_NAME}-trigger-minio\n'), /minio's profiles are undefined/],
      ['the worker in it', at(managed, '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n', '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n    profiles: ["trigger"]\n'), /profile trigger holds .*worker/],
      ['the api requiring trigger-api', at(managed, '        condition: service_started\n        required: false\n', '        condition: service_started\n'), /api depends on trigger-api, which is in profile trigger, without required: false/],
      ['the api defaulting to trigger', at(managed, '      OWNPACE_JOB_RUNNER: ${OWNPACE_JOB_RUNNER:-pg-boss}\n      JOBS_DATABASE_URL', '      OWNPACE_JOB_RUNNER: ${OWNPACE_JOB_RUNNER:-trigger}\n      JOBS_DATABASE_URL'), /defaults are \["trigger","pg-boss"\]/],
      ['a plane volume dropped', at(managed, '\n  minio_data_v2:', '\n  minio_data_v2_gone:'), /volume minio_data_v2 is no longer declared/],
    ];
    for (const [what, text, expected] of cases) expect(composeProblems(text).join('\n'), what).toMatch(expected);
    expect(scriptProblems(at(jobRunner, ' minio trigger-redis', ' trigger-redis'), bootstrap).join('\n'), 'minio left out of the stop order').toMatch(/stop order/);
    expect(scriptProblems(jobRunner, at(bootstrap, 'trigger-tls-init trigger-tls trigger-supervisor)', 'trigger-tls-init trigger-tls)')).join('\n'), 'the supervisor left out of the bring-up').toMatch(/starts .* in trigger mode/);
  });
});
