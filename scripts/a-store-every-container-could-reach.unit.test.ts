// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A STORE EVERY CONTAINER COULD REACH (workplan 0119 §3 item 9; CVE-2026-116366,
 * 2026-11-01).
 *
 * Trigger.dev's ClickHouse, the `clickhouse` service of
 * `deploy/compose/managed.yml`, runs 26.2.19.43, the image Trigger.dev pins at
 * v4.8.3. ClickHouse's `SECURITY.md` lists 26.2 as unsupported, and
 * CVE-2026-116366 (GHSA-qhgw-ghp3-xh36, critical, CWE-190, published
 * 2026-10-30) lets "an unauthenticated user with network access" run code on
 * the server. It is fixed only in 26.3.62.3-lts, 26.8.36.3-lts, 26.9.27.3-stable
 * and 26.10.3.7-stable, so no fix will come to the line this stack runs. Moving
 * the version is the owner's decision (§3 item 9, whose revisit trigger this
 * fired).
 *
 * Who can reach the server is this repository's, and until 2026-11-01 it was
 * every container of the stack. ClickHouse was on `ownpace-network`, with the
 * web app, the API, the identity provider and the demo Nextcloud, which answer
 * the internet, and every task run, which the supervisor starts on that network
 * (`DOCKER_RUNNER_NETWORKS`). One client of all those talks to it over a
 * network: `trigger-api`, through `CLICKHOUSE_URL` and
 * `RUN_REPLICATION_CLICKHOUSE_URL`, and its entrypoint's goose migrations.
 * Everything else that asks ClickHouse anything runs `clickhouse-client` inside
 * its container (its health check, `docker compose exec` in
 * `deploy/compose/rotate-db-passwords.sh` and `docs/ending-the-alpha.md`).
 *
 * So ClickHouse is on one network, `trigger-event-store`, and only
 * `trigger-api` shares it. The network is `internal`, as `status-probe` is: no
 * route off the machine, which ClickHouse does not need (its crash reports are
 * off, `a-service-that-phones-home`), and `trigger-api` keeps its route and its
 * published port over `ownpace-network`. This holds all of it:
 *
 *  - the network is declared, a bridge, `internal: true`, named by its
 *    project (no `name:`, not `external`), so Compose makes it at `up`;
 *  - `clickhouse` is on it and on nothing else, publishes no port, and has no
 *    `network_mode`;
 *  - its members are `clickhouse` and `CLIENTS`, and every service that names
 *    ClickHouse as a host in its environment, or waits for it in `depends_on`,
 *    is in `CLIENTS`: a new client fails here until it is named, and a member
 *    that is not a client fails until it leaves;
 *  - the supervisor's task runs do not join it;
 *  - nothing else joins it by name: no other compose file declares it, and no
 *    script or workflow runs `docker run --network` or `docker network
 *    connect` with it.
 *
 * Each rule is also broken on purpose below, on a copy of the file, and must
 * fail.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED = 'deploy/compose/managed.yml';
const managedYml = readFileSync(join(REPO_ROOT, MANAGED), 'utf8');

/** ClickHouse's one network. */
export const NETWORK = 'trigger-event-store';
/** The service it protects. */
export const STORE = 'clickhouse';
/** The services that talk to ClickHouse over a network, and so share it. */
export const CLIENTS: readonly string[] = ['trigger-api'];

type Networks = string[] | Record<string, unknown> | undefined;
interface Service {
  networks?: Networks;
  network_mode?: string;
  ports?: unknown[];
  environment?: Record<string, unknown> | string[];
  depends_on?: string[] | Record<string, unknown>;
}
interface Compose {
  services?: Record<string, Service | null>;
  networks?: Record<string, { driver?: string; internal?: boolean; external?: unknown; name?: string } | null>;
}

const netsOf = (svc: Service | null | undefined): string[] => {
  const n = svc?.networks;
  if (!n) return [];
  return Array.isArray(n) ? n : Object.keys(n);
};

const envValues = (svc: Service | null | undefined): string[] => {
  const env = svc?.environment;
  if (!env) return [];
  return Array.isArray(env) ? env : Object.entries(env).map(([k, v]) => `${k}=${String(v ?? '')}`);
};

/** A URL or address naming the ClickHouse service as its host. */
const NAMES_STORE = /(?:\/\/|@)clickhouse(?::\d+)?(?:[/?]|$)|(?:^|[=\s])clickhouse:(?:8123|9000|9440|8443)\b/;

/** Services that use ClickHouse: they name it as a host, or wait for it. */
export function clientsOf(compose: Compose): string[] {
  const out: string[] = [];
  for (const [name, svc] of Object.entries(compose.services ?? {})) {
    if (name === STORE) continue;
    const deps = svc?.depends_on;
    const waits = Array.isArray(deps) ? deps.includes(STORE) : deps ? STORE in deps : false;
    if (waits || envValues(svc).some((v) => NAMES_STORE.test(v))) out.push(name);
  }
  return out.sort();
}

/** What is wrong with ClickHouse's network in a parsed managed.yml; empty when nothing is. */
export function storeNetworkProblems(compose: Compose): string[] {
  const problems: string[] = [];
  const services = compose.services ?? {};
  const net = compose.networks?.[NETWORK];

  if (!compose.networks || !(NETWORK in compose.networks)) {
    problems.push(`the network ${NETWORK} is not declared, so ClickHouse has no network of its own`);
  } else {
    if (net?.internal !== true) {
      problems.push(`${NETWORK} is not internal: true, so ClickHouse has a route off the machine it does not need`);
    }
    if ((net?.driver ?? 'bridge') !== 'bridge') problems.push(`${NETWORK} is not a bridge network (driver: ${String(net?.driver)})`);
    if (net?.external) problems.push(`${NETWORK} is external, so Compose does not make it and anything may have joined it`);
    if (net?.name !== undefined) problems.push(`${NETWORK} has a name: of its own, so two stacks on one machine would share it`);
  }

  const store = services[STORE];
  if (!store) {
    problems.push(`there is no ${STORE} service`);
  } else {
    const nets = netsOf(store);
    if (nets.length !== 1 || nets[0] !== NETWORK) {
      problems.push(
        `${STORE} is on ${nets.length ? nets.join(', ') : 'no network'}; it must be on ${NETWORK} alone, ` +
          'or every container on the other network can reach it (CVE-2026-116366)',
      );
    }
    if (store.network_mode !== undefined) problems.push(`${STORE} has network_mode: ${store.network_mode}`);
    if (store.ports?.length) problems.push(`${STORE} publishes a port, so the host and whoever reaches it can ask the server`);
  }

  const members = Object.entries(services)
    .filter(([, svc]) => netsOf(svc).includes(NETWORK))
    .map(([name]) => name)
    .sort();
  const expected = [STORE, ...CLIENTS].sort();
  for (const m of members) {
    if (!expected.includes(m)) {
      problems.push(`${m} is on ${NETWORK}, and is not one of ClickHouse's clients (${CLIENTS.join(', ')}): take it off`);
    }
  }
  for (const c of CLIENTS) {
    if (!members.includes(c)) problems.push(`${c} is not on ${NETWORK}, so it cannot reach ClickHouse and will not start`);
  }
  for (const c of clientsOf(compose)) {
    if (!CLIENTS.includes(c)) {
      problems.push(
        `${c} names ClickHouse as a host or waits for it, and is not in CLIENTS: decide whether it needs ClickHouse, ` +
          `and if it does, put it on ${NETWORK} and name it in CLIENTS`,
      );
    }
  }

  for (const [name, svc] of Object.entries(services)) {
    const runners = envValues(svc).find((v) => v.startsWith('DOCKER_RUNNER_NETWORKS='));
    if (runners?.includes(NETWORK)) problems.push(`${name}'s DOCKER_RUNNER_NETWORKS names ${NETWORK}, so every task run joins it`);
  }
  return problems;
}

/** The files a script or workflow could join a network from. */
function joinableFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(REPO_ROOT, dir))) {
      if (name === 'node_modules' || name.startsWith('.git')) continue;
      const rel = join(dir, name);
      if (statSync(join(REPO_ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(sh|ya?ml|mjs|ps1)$/.test(name)) out.push(rel);
    }
  };
  walk('deploy');
  walk('.github/workflows');
  for (const name of readdirSync(join(REPO_ROOT, 'scripts'))) {
    if (/\.(sh|mjs)$/.test(name)) out.push(join('scripts', name));
  }
  return out.sort();
}

/** Lines in other files that put a container on the network by name. */
export function joinsByName(path: string, text: string): string[] {
  if (path === MANAGED) return [];
  const bare = text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  if (/\.ya?ml$/.test(path) && !path.startsWith('.github/') && bare.includes(NETWORK)) {
    return [`${path} names ${NETWORK}: a compose file that declares it joins it`];
  }
  const re = new RegExp(String.raw`(--network[= ]\S*|network\s+connect\s+\S*)${NETWORK}`);
  return bare
    .split('\n')
    .filter((l) => re.test(l))
    .map((l) => `${path}: ${l.trim()}`);
}

const managed = parseYaml(managedYml, { merge: true, logLevel: 'error' }) as Compose;

describe('ClickHouse is on a network only its one client shares (CVE-2026-116366)', () => {
  it('managed.yml holds every rule', () => {
    expect(storeNetworkProblems(managed)).toEqual([]);
  });

  it('the clients are what the file says they are: trigger-api alone', () => {
    // Read, not restated: if this changes, the header and CLIENTS change with it.
    expect(clientsOf(managed)).toEqual([...CLIENTS].sort());
  });

  it('nothing outside managed.yml joins the network by name', () => {
    const found = joinableFiles().flatMap((f) => joinsByName(f, readFileSync(join(REPO_ROOT, f), 'utf8')));
    expect(found, 'a container joined to the network by hand is a member Compose does not list').toEqual([]);
  });
});

describe('each rule fails when it is broken', () => {
  const copy = (): Compose => structuredClone(managed);
  const mutations: Array<[string, (c: Compose) => void, RegExp]> = [
    [
      'ClickHouse back on ownpace-network',
      (c) => {
        c.services![STORE]!.networks = ['ownpace-network', NETWORK];
      },
      /clickhouse is on ownpace-network, trigger-event-store/,
    ],
    [
      'ClickHouse on ownpace-network alone',
      (c) => {
        c.services![STORE]!.networks = ['ownpace-network'];
      },
      /clickhouse is on ownpace-network;/,
    ],
    [
      'another service on the network',
      (c) => {
        c.services!['api']!.networks = ['ownpace-network', NETWORK];
      },
      /api is on trigger-event-store, and is not one of ClickHouse's clients/,
    ],
    [
      'internal: true dropped',
      (c) => {
        delete c.networks![NETWORK]!.internal;
      },
      /is not internal: true/,
    ],
    [
      'the network not declared',
      (c) => {
        delete c.networks![NETWORK];
      },
      /is not declared/,
    ],
    [
      'the network made external',
      (c) => {
        c.networks![NETWORK] = { external: true, internal: true };
      },
      /is external/,
    ],
    [
      'trigger-api off the network',
      (c) => {
        c.services!['trigger-api']!.networks = ['ownpace-network'];
      },
      /trigger-api is not on trigger-event-store/,
    ],
    [
      'a new client that names ClickHouse in its environment',
      (c) => {
        c.services!['web']!.environment = { STATS_URL: 'http://default:x@clickhouse:8123' };
      },
      /web names ClickHouse as a host/,
    ],
    [
      'a port published',
      (c) => {
        c.services![STORE]!.ports = ['127.0.0.1:8123:8123'];
      },
      /publishes a port/,
    ],
    [
      'task runs joined to it',
      (c) => {
        c.services!['trigger-supervisor']!.environment = {
          ...(c.services!['trigger-supervisor']!.environment as Record<string, unknown>),
          DOCKER_RUNNER_NETWORKS: '${COMPOSE_PROJECT_NAME}_ownpace-network,${COMPOSE_PROJECT_NAME}_trigger-event-store',
        };
      },
      /DOCKER_RUNNER_NETWORKS names trigger-event-store/,
    ],
  ];

  it.each(mutations)('%s', (_label, mutate, why) => {
    const c = copy();
    mutate(c);
    const problems = storeNetworkProblems(c);
    expect(problems.join('\n')).toMatch(why);
  });

  it('a script that joins it by hand is found, and a check that only lists it is not', () => {
    expect(joinsByName('deploy/compose/x.sh', 'docker run --rm --network "${P}_trigger-event-store" img')).toHaveLength(1);
    expect(joinsByName('deploy/compose/x.sh', 'docker network connect "${P}_trigger-event-store" c')).toHaveLength(1);
    expect(joinsByName('deploy/compose/x.sh', 'for n in ownpace-network status-probe trigger-event-store; do')).toEqual([]);
    expect(joinsByName('deploy/compose/www.yml', 'networks:\n  trigger-event-store:\n    external: true')).toHaveLength(1);
    expect(joinsByName(MANAGED, managedYml)).toEqual([]);
  });
});
