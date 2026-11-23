// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NETWORK THE TENANT CANNOT SEE (workplan 0136 T4's guard, built for its first
 * bullet, the socket proxy, on 2026-11-02): until then every container of the
 * stack, every task run included, could ask the Docker API to start a container.
 *
 * Until alpha.18 the Docker API was in the stack on purpose. Trigger.dev's
 * supervisor started each task run as a container of its own, through
 * `trigger-docker-proxy`, Tecnativa's socket proxy with `CONTAINERS`,
 * `IMAGES`, `NETWORKS`, `VOLUMES` and `POST` on and no authentication: enough
 * to start a container on any network of the machine, or one that mounts the
 * host's files. This guard held the proxy on an internal network of its own,
 * `trigger-docker-socket`, with the supervisor alone, and the task images'
 * registry, `trigger-registry`, which took pushes with no authentication, on
 * `trigger-task-images` with nobody (2026-11-14).
 *
 * alpha.18 removed the plane (workplan 0167 T9; ADR-0054): the jobs run in
 * the `worker` service, one process per run, forked by the worker itself. No
 * service of the stack needs the Docker API any more, and none may reach it.
 * So this holds, for every compose file under `deploy/`:
 *
 *  - no service mounts a Docker socket (`docker.sock`, as a volume in either
 *    of Compose's shapes);
 *  - no service names a Docker API endpoint in its environment (`DOCKER_HOST`,
 *    or any value naming `docker.sock` or a `tcp://…:2375`/`:2376`);
 *  - no service is `privileged`, has `network_mode: host`, or shares the host's
 *    PID namespace, each another way to the host the proxy guarded;
 *  - and managed.yml declares neither of the plane's two networks, nor a
 *    service by either of the two names, so a partial revert cannot put the
 *    proxy or the registry back without this file being read again.
 *
 * Each rule is broken on purpose below, on a copy of the file, and must fail.
 *
 * WHAT THIS DOES NOT HOLD. What runs on the host: `bootstrap-managed.sh`,
 * the smoke and `remove-trigger-plane.sh` call the host's `docker`, as the
 * operator does. And the other stack on the same machine (0132 §1).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED = 'deploy/compose/managed.yml';

/** The plane's two guarded networks, and the two services they guarded (alpha.17). */
export const GONE_NETWORKS: readonly string[] = ['trigger-docker-socket', 'trigger-task-images'];
export const GONE_SERVICES: readonly string[] = ['trigger-docker-proxy', 'trigger-registry', 'trigger-supervisor'];

type Mount = string | { source?: string; target?: string };
interface Service {
  volumes?: Mount[];
  environment?: Record<string, unknown> | string[];
  privileged?: boolean;
  network_mode?: string;
  pid?: string;
}
interface Compose {
  services?: Record<string, Service | null>;
  networks?: Record<string, unknown>;
}

const envValues = (svc: Service | null | undefined): string[] => {
  const env = svc?.environment;
  if (!env) return [];
  return Array.isArray(env) ? env : Object.entries(env).map(([k, v]) => `${k}=${String(v ?? '')}`);
};

const mountText = (m: Mount): string => (typeof m === 'string' ? m : `${m.source ?? ''}:${m.target ?? ''}`);

/** A value that points a Docker client somewhere: a socket, or the Docker API's ports. */
const NAMES_DOCKER_API = /docker\.sock|tcp:\/\/[^\s,]+:237[56]\b/;

/** What in a parsed compose file reaches the Docker API or the host; empty when nothing does. */
export function dockerApiProblems(file: string, compose: Compose): string[] {
  const problems: string[] = [];
  for (const [name, svc] of Object.entries(compose.services ?? {})) {
    for (const m of svc?.volumes ?? []) {
      if (/docker\.sock/.test(mountText(m))) problems.push(`${file}: ${name} mounts the Docker socket (${mountText(m)})`);
    }
    for (const v of envValues(svc)) {
      if (/^DOCKER_HOST=/.test(v) || NAMES_DOCKER_API.test(v)) problems.push(`${file}: ${name} names a Docker API endpoint (${v.split('=')[0]})`);
    }
    if (svc?.privileged) problems.push(`${file}: ${name} is privileged`);
    if (svc?.network_mode === 'host') problems.push(`${file}: ${name} has network_mode: host`);
    if (svc?.pid === 'host') problems.push(`${file}: ${name} shares the host's PID namespace`);
  }
  return problems;
}

/** What of the plane's guarded half a parsed managed.yml declares again; empty when nothing. */
export function planeProblems(compose: Compose): string[] {
  const problems: string[] = [];
  for (const n of GONE_NETWORKS) if (n in (compose.networks ?? {})) problems.push(`${MANAGED} declares ${n} again`);
  for (const s of GONE_SERVICES) if (s in (compose.services ?? {})) problems.push(`${MANAGED} defines ${s} again`);
  return problems;
}

/** Every compose file under `deploy/`: a YAML file whose top level has `services`. */
function composeFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const d of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${d.name}`;
      if (d.isDirectory()) walk(path);
      else if (/\.ya?ml$/.test(d.name)) {
        const doc = parseYaml(readFileSync(join(REPO_ROOT, path), 'utf8'), { logLevel: 'error', merge: true }) as Compose | null;
        if (doc && typeof doc === 'object' && doc.services) out.push(path);
      }
    }
  };
  walk('deploy');
  return out.sort();
}

const files = composeFiles();
const parsed = Object.fromEntries(
  files.map((f) => [f, parseYaml(readFileSync(join(REPO_ROOT, f), 'utf8'), { logLevel: 'error', merge: true }) as Compose]),
);

describe('no container of the stack reaches the Docker API or the host (0136 T4; 0167 T9)', () => {
  it('found the compose files and the managed services', () => {
    expect(files).toEqual(expect.arrayContaining([MANAGED, 'deploy/compose/www.yml', 'deploy/selfhost/compose.yml']));
    expect(Object.keys(parsed[MANAGED]!.services ?? {})).toEqual(expect.arrayContaining(['api', 'worker', 'postgres']));
  });

  it.each(files.map((f) => [f]))('%s: no socket, no Docker API endpoint, nothing privileged, no host namespace', (file) => {
    expect(dockerApiProblems(file, parsed[file]!)).toEqual([]);
  });

  it("managed.yml declares neither of the plane's guarded networks, nor the proxy, the registry or the supervisor", () => {
    expect(planeProblems(parsed[MANAGED]!)).toEqual([]);
  });
});

describe('each rule fails when it is broken', () => {
  const copy = (): Compose => structuredClone(parsed[MANAGED]!);
  const svc = (c: Compose, name: string): Service => c.services![name]!;
  const mutations: Array<[string, (c: Compose) => void, RegExp]> = [
    ['the socket mounted, short form', (c) => (svc(c, 'worker').volumes = ['/var/run/docker.sock:/var/run/docker.sock:ro']), /worker mounts the Docker socket/],
    ['the socket mounted, long form', (c) => (svc(c, 'api').volumes = [{ source: '/run/docker.sock', target: '/x' }]), /api mounts the Docker socket/],
    ['DOCKER_HOST set', (c) => (svc(c, 'worker').environment = { DOCKER_HOST: 'tcp://proxy:2375' }), /worker names a Docker API endpoint \(DOCKER_HOST\)/],
    ['an API port under another name', (c) => (svc(c, 'api').environment = ['RUNNER_API=tcp://proxy:2376']), /api names a Docker API endpoint \(RUNNER_API\)/],
    ['privileged', (c) => (svc(c, 'mailpit').privileged = true), /mailpit is privileged/],
    ['the host network', (c) => (svc(c, 'gatus').network_mode = 'host'), /gatus has network_mode: host/],
    ["the host's PIDs", (c) => (svc(c, 'web').pid = 'host'), /web shares the host's PID namespace/],
  ];

  it.each(mutations)('%s', (_label, mutate, why) => {
    const c = copy();
    mutate(c);
    expect(dockerApiProblems(MANAGED, c).join('\n')).toMatch(why);
  });

  it('the proxy, the registry or their networks put back', () => {
    const c = copy();
    c.networks = { ...(c.networks ?? {}), 'trigger-docker-socket': { internal: true } };
    c.services!['trigger-registry'] = {};
    expect(planeProblems(c)).toEqual([
      `${MANAGED} declares trigger-docker-socket again`,
      `${MANAGED} defines trigger-registry again`,
    ]);
  });
});
