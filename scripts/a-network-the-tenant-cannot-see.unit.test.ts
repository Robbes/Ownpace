// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NETWORK THE TENANT CANNOT SEE (workplan 0136 T4's guard, built for its first
 * bullet, the socket proxy, on 2026-11-02): until then every container of the
 * stack, every task run included, could ask the Docker API to start a container.
 *
 * `trigger-docker-proxy` in `deploy/compose/managed.yml` is Tecnativa's
 * docker-socket-proxy in front of the host's Docker socket, with `CONTAINERS`,
 * `IMAGES`, `NETWORKS`, `VOLUMES` and `POST` on and no authentication. That is
 * what the supervisor needs to start a task run, and it is also enough to start
 * a container on any network of the machine, or one that mounts the host's
 * files: control of the host. It was on `ownpace-network`, with the web app,
 * the API, the identity provider and the demo Nextcloud, which answer the
 * internet, and every task run, which the supervisor starts there
 * (`DOCKER_RUNNER_NETWORKS`). Workplan 0136 §1 (*What shares the network*)
 * said so, and CVE-2026-116366 made it the last route to a ClickHouse with an
 * unauthenticated code execution and no fix: #1774 took ClickHouse's name and
 * route away from everybody but `trigger-api`
 * (`a-store-every-container-could-reach`), and any container on
 * `ownpace-network` could still attach a container to ClickHouse's network
 * through the proxy (0119 §3 item 9).
 *
 * One service talks to the Docker API: `trigger-supervisor`, whose
 * `DOCKER_HOST` names the proxy. Its task runs get no `DOCKER_HOST` (Trigger.dev
 * v4.8.3's supervisor, and v4.8.5's, whose `docker.ts` is the same, hands a
 * run its own workload API and `trigger-api`'s
 * `/otel`), and `trigger-api` runs no Docker client. So the proxy is on one
 * network, `trigger-docker-socket`, `internal`, and the supervisor alone shares
 * it; the supervisor keeps `ownpace-network`, where the runners reach it. This
 * holds all of it:
 *
 *  - the network is declared, a bridge, `internal: true`, named by its
 *    project (no `name:`, not `external`), so Compose makes it at `up`;
 *  - the proxy is on it and on nothing else, publishes no port, and has no
 *    `network_mode`; every network the proxy is on is `internal`, and its
 *    members are the proxy and `CLIENTS` exactly. A service whose
 *    `network_mode` is `service:` a member counts as a member; one whose
 *    `network_mode` is `container:` or `host` fails outright, since Compose
 *    cannot say whose namespace that is. A service with neither `networks:`
 *    nor `network_mode` is on Compose's `default` network, and is read so;
 *  - every service that names the proxy as a host in its environment, or waits
 *    for it in `depends_on`, is in `CLIENTS`: a new client fails here until it
 *    is named, and a member that is not a client fails until it leaves;
 *  - the proxy shares no network with the tenant-facing services (`api`,
 *    `web`, `zitadel`, `nextcloud`, `gatus`, `mailpit`, each of which must be
 *    a service of the file, so a rename cannot leave the rule checking
 *    nothing) or with the networks `DOCKER_RUNNER_NETWORKS` puts every task
 *    run on, which is T4's own sentence, and `DOCKER_RUNNER_NETWORKS` never
 *    names the proxy's network;
 *  - nothing else joins it by name: no other compose file declares it or takes
 *    a member's namespace, and no script or workflow runs `docker run
 *    --net`/`--network` or `docker network connect` with it, or `--net`
 *    `container:` naming the proxy's or the supervisor's container.
 *
 * Each rule is also broken on purpose below, on a copy of the file, and must
 * fail. On `main` before this change (`733294a5`), with the proxy on
 * `ownpace-network`, the first test failed, as T6 asks of a guard.
 *
 * WHAT THIS DOES NOT HOLD. Code that already runs inside `trigger-supervisor`
 * can still ask the proxy anything its environment allows, and each stack's
 * proxy can still start a container on the other stack's networks (0132 §1;
 * accepted by 0136 D6). The rest of T4, Trigger.dev's plane on a network of
 * its own (`control`) and the host's firewall rule, is not built: when it is,
 * it extends this guard, whose name T4 gave it, rather than adding another.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED = 'deploy/compose/managed.yml';
const managedYml = readFileSync(join(REPO_ROOT, MANAGED), 'utf8');

/** The socket proxy's one network. */
export const NETWORK = 'trigger-docker-socket';
/** The service it protects the rest of the stack from. */
export const PROXY = 'trigger-docker-proxy';
/** The services that talk to the Docker API through the proxy, and so share its network. */
export const CLIENTS: readonly string[] = ['trigger-supervisor'];
/** The services that answer the internet or a tester: none may share a network with the proxy (T4). */
export const TENANT_FACING: readonly string[] = ['api', 'web', 'zitadel', 'nextcloud', 'gatus', 'mailpit'];

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

/**
 * The networks a service is on by `networks:`, and Compose's `default` when it
 * has neither that nor a `network_mode`. A service the file does not have is on
 * none, so a name that matches nothing never reads as a service on `default`.
 */
const netsOf = (svc: Service | null | undefined): string[] => {
  if (svc === undefined) return [];
  const n = svc?.networks;
  if (!n) return svc?.network_mode === undefined ? ['default'] : [];
  return Array.isArray(n) ? n : Object.keys(n);
};

const envValues = (svc: Service | null | undefined): string[] => {
  const env = svc?.environment;
  if (!env) return [];
  return Array.isArray(env) ? env : Object.entries(env).map(([k, v]) => `${k}=${String(v ?? '')}`);
};

/** A URL or address naming the proxy as its host: `tcp://trigger-docker-proxy:2375`, `trigger-docker-proxy:2375`. */
const NAMES_PROXY = /(?:\/\/|@)trigger-docker-proxy(?::\d+)?(?:[/?]|$)|(?:^|[=\s,])trigger-docker-proxy:\d+\b/;

/** Services that use the proxy: they name it as a host, or wait for it. */
export function clientsOf(compose: Compose): string[] {
  const out: string[] = [];
  for (const [name, svc] of Object.entries(compose.services ?? {})) {
    if (name === PROXY) continue;
    const deps = svc?.depends_on;
    const waits = Array.isArray(deps) ? deps.includes(PROXY) : deps ? PROXY in deps : false;
    if (waits || envValues(svc).some((v) => NAMES_PROXY.test(v))) out.push(name);
  }
  return out.sort();
}

/**
 * The compose networks `DOCKER_RUNNER_NETWORKS` puts every task run on. Each
 * entry is a real network name, `${COMPOSE_PROJECT_NAME}_<key>` (0132 T1), so
 * it is read back to the key it was built from.
 */
export function runnerNetworks(compose: Compose): { entries: string[]; keys: string[] } {
  const entries = Object.values(compose.services ?? {})
    .flatMap((svc) => envValues(svc))
    .filter((v) => v.startsWith('DOCKER_RUNNER_NETWORKS='))
    .flatMap((v) => v.slice('DOCKER_RUNNER_NETWORKS='.length).split(','))
    .map((e) => e.trim())
    .filter(Boolean);
  const declared = Object.keys(compose.networks ?? {});
  const keys = declared.filter((k) => entries.some((e) => e === k || e.endsWith(`_${k}`)));
  return { entries, keys };
}

/** What is wrong with the socket proxy's network in a parsed managed.yml; empty when nothing is. */
export function proxyNetworkProblems(compose: Compose): string[] {
  const problems: string[] = [];
  const services = compose.services ?? {};
  const declared = compose.networks ?? {};

  if (!(NETWORK in declared)) {
    problems.push(`the network ${NETWORK} is not declared, so the socket proxy has no network of its own`);
  }

  const proxy = services[PROXY];
  if (!proxy) {
    problems.push(`there is no ${PROXY} service`);
    return problems;
  }
  const proxyNets = netsOf(proxy);
  if (proxyNets.length !== 1 || proxyNets[0] !== NETWORK) {
    problems.push(
      `${PROXY} is on ${proxyNets.length ? proxyNets.join(', ') : 'no network'}; it must be on ${NETWORK} alone, ` +
        'or every container on the other network can ask the Docker API to start a container (0136 T4)',
    );
  }
  if (proxy.network_mode !== undefined) problems.push(`${PROXY} has network_mode: ${proxy.network_mode}`);
  if (proxy.ports?.length) {
    problems.push(`${PROXY} publishes a port, so the host and whoever reaches it can ask the Docker API, with no authentication`);
  }

  // Every network the proxy is on, whatever it is called: declared as Compose
  // makes it, with no way off the machine.
  for (const net of proxyNets) {
    if (!(net in declared)) {
      if (net !== NETWORK) problems.push(`${PROXY} is on ${net}, which this file does not declare`);
      continue;
    }
    const n = declared[net];
    if (n?.internal !== true) {
      problems.push(`${net} is not internal: true, so the socket proxy has a route off the machine it does not need`);
    }
    if ((n?.driver ?? 'bridge') !== 'bridge') problems.push(`${net} is not a bridge network (driver: ${String(n?.driver)})`);
    if (n?.external) problems.push(`${net} is external, so Compose does not make it and anything may have joined it`);
    if (n?.name !== undefined) problems.push(`${net} has a name: of its own, so two stacks on one machine would share it`);
  }

  // A member is on a network by `networks:`, or by sharing a member's network
  // namespace (`network_mode: service:<member>`), to any depth.
  for (const [name, svc] of Object.entries(services)) {
    const mode = svc?.network_mode;
    if (name !== PROXY && mode !== undefined && (mode === 'host' || mode.startsWith('container:'))) {
      problems.push(
        `${name} has network_mode: ${mode}, a namespace Compose cannot name, so nothing here can say it is not ` +
          `the socket proxy's or the supervisor's: give it networks: instead`,
      );
    }
  }
  const expected = [PROXY, ...CLIENTS].sort();
  for (const net of proxyNets) {
    const how = new Map<string, string>();
    for (const [name, svc] of Object.entries(services)) {
      if (netsOf(svc).includes(net)) how.set(name, `is on ${net}`);
    }
    for (let grew = true; grew; ) {
      grew = false;
      for (const [name, svc] of Object.entries(services)) {
        const shared = /^service:(.+)$/.exec(svc?.network_mode ?? '')?.[1];
        if (shared && how.has(shared) && !how.has(name)) {
          how.set(name, `shares ${shared}'s network namespace (network_mode: service:${shared}), so it is on ${net}`);
          grew = true;
        }
      }
    }
    const members = [...how.keys()].sort();
    for (const m of members) {
      if (!expected.includes(m)) {
        problems.push(`${m} ${how.get(m)}, and is not one of the socket proxy's clients (${CLIENTS.join(', ')}): take it off`);
      }
    }
    for (const c of CLIENTS) {
      if (!members.includes(c)) problems.push(`${c} is not on ${net}, so its DOCKER_HOST does not resolve and no task run starts`);
    }
  }
  for (const c of clientsOf(compose)) {
    if (!CLIENTS.includes(c)) {
      problems.push(
        `${c} names the socket proxy as a host or waits for it, and is not in CLIENTS: decide whether it needs the ` +
          `Docker API, and if it does, put it on ${NETWORK} and name it in CLIENTS`,
      );
    }
  }

  // T4's sentence: the proxy is on no network that the tenant-facing services
  // or the task runs join.
  for (const t of TENANT_FACING) {
    if (!(t in services)) {
      problems.push(`${t} is not a service of this file, so nothing here can say it shares no network with ${PROXY}: TENANT_FACING names it`);
      continue;
    }
    const shared = netsOf(services[t]).filter((n) => proxyNets.includes(n));
    if (shared.length) problems.push(`${t}, which a tester or the internet reaches, shares ${shared.join(', ')} with ${PROXY}`);
  }
  const runners = runnerNetworks(compose);
  if (!runners.keys.length) {
    problems.push(
      `DOCKER_RUNNER_NETWORKS (${runners.entries.join(',') || 'not set'}) names no network this file declares, so nothing ` +
        "here can say the task runs are not on the proxy's",
    );
  }
  for (const k of runners.keys) {
    if (proxyNets.includes(k)) problems.push(`DOCKER_RUNNER_NETWORKS names ${k}, a network ${PROXY} is on, so every task run can ask the Docker API`);
  }
  if (runners.entries.some((e) => e === NETWORK || e.endsWith(`_${NETWORK}`))) {
    problems.push(`DOCKER_RUNNER_NETWORKS names ${NETWORK}, so every task run joins it`);
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
  const joins = [
    // `docker run --net`/`--network`, with `=` or a space, and the network's name.
    new RegExp(String.raw`--net(?:work)?[= ]\S*${NETWORK}`),
    // `docker network connect`, whatever options come before the name.
    new RegExp(String.raw`\bnetwork\s+connect\b.*${NETWORK}`),
    // A member's own namespace: `--net container:<project>-trigger-supervisor`,
    // or a compose file's `network_mode: service:trigger-docker-proxy`.
    new RegExp(String.raw`(?:--net(?:work)?[= ]|network_mode:\s*)["']?(?:container:\S*|service:)(?:${[PROXY, ...CLIENTS].join('|')})\b`),
  ];
  return bare
    .split('\n')
    .filter((l) => joins.some((re) => re.test(l)))
    .map((l) => `${path}: ${l.trim()}`);
}

const managed = parseYaml(managedYml, { merge: true, logLevel: 'error' }) as Compose;

describe('the socket proxy is on a network only its one client shares (0136 T4)', () => {
  it('managed.yml holds every rule', () => {
    expect(proxyNetworkProblems(managed)).toEqual([]);
  });

  it('the clients are what the file says they are: trigger-supervisor alone', () => {
    // Read, not restated: if this changes, the header and CLIENTS change with it.
    expect(clientsOf(managed)).toEqual([...CLIENTS].sort());
  });

  it('every tenant-facing service it names is a service of the file, on a network', () => {
    // So a renamed service cannot make the tenant-facing rule pass by naming nothing.
    for (const t of TENANT_FACING) {
      expect(managed.services?.[t], `${t} is not a service of managed.yml`).toBeDefined();
      expect(netsOf(managed.services?.[t]), t).not.toEqual([]);
    }
  });

  it("the task runs' network is read from the file: ownpace-network", () => {
    expect(runnerNetworks(managed).keys).toEqual(['ownpace-network']);
  });

  it('nothing outside managed.yml joins the network by name', () => {
    const found = joinableFiles().flatMap((f) => joinsByName(f, readFileSync(join(REPO_ROOT, f), 'utf8')));
    expect(found, 'a container joined to the network by hand is a member Compose does not list').toEqual([]);
  });
});

describe('each rule fails when it is broken', () => {
  const copy = (): Compose => structuredClone(managed);
  const env = (c: Compose, svc: string): Record<string, unknown> => c.services![svc]!.environment as Record<string, unknown>;
  const mutations: Array<[string, (c: Compose) => void, RegExp]> = [
    [
      'the proxy back on ownpace-network',
      (c) => {
        c.services![PROXY]!.networks = ['ownpace-network', NETWORK];
      },
      /trigger-docker-proxy is on ownpace-network, trigger-docker-socket;[\s\S]*ownpace-network is not internal: true[\s\S]*api is on ownpace-network, and is not one of the socket proxy's clients/,
    ],
    [
      'the proxy on ownpace-network alone, as before 2026-11-02',
      (c) => {
        c.services![PROXY]!.networks = ['ownpace-network'];
      },
      /trigger-docker-proxy is on ownpace-network;[\s\S]*api, which a tester or the internet reaches, shares ownpace-network[\s\S]*DOCKER_RUNNER_NETWORKS names ownpace-network/,
    ],
    [
      'the proxy with no networks: at all, so on Compose\'s default',
      (c) => {
        delete c.services![PROXY]!.networks;
      },
      /trigger-docker-proxy is on default;[\s\S]*is on default, which this file does not declare[\s\S]*trigger-supervisor is not on default/,
    ],
    [
      'the proxy on the host\'s network',
      (c) => {
        delete c.services![PROXY]!.networks;
        c.services![PROXY]!.network_mode = 'host';
      },
      /trigger-docker-proxy is on no network;[\s\S]*has network_mode: host/,
    ],
    [
      'api on the network',
      (c) => {
        c.services!['api']!.networks = ['ownpace-network', NETWORK];
      },
      /api is on trigger-docker-socket, and is not one of the socket proxy's clients[\s\S]*api, which a tester or the internet reaches, shares trigger-docker-socket/,
    ],
    [
      'a second network of the proxy\'s, internal, that api shares',
      (c) => {
        c.networks!['side'] = { driver: 'bridge', internal: true };
        c.services![PROXY]!.networks = [NETWORK, 'side'];
        c.services!['api']!.networks = ['ownpace-network', 'side'];
      },
      /api is on side, and is not one of the socket proxy's clients[\s\S]*trigger-supervisor is not on side[\s\S]*api, which a tester or the internet reaches, shares side/,
    ],
    [
      'internal: true dropped',
      (c) => {
        delete c.networks![NETWORK]!.internal;
      },
      /trigger-docker-socket is not internal: true/,
    ],
    [
      'internal: false',
      (c) => {
        c.networks![NETWORK]!.internal = false;
      },
      /trigger-docker-socket is not internal: true/,
    ],
    [
      'the network not declared',
      (c) => {
        delete c.networks![NETWORK];
      },
      /the network trigger-docker-socket is not declared/,
    ],
    [
      'the network made external',
      (c) => {
        c.networks![NETWORK] = { external: true, internal: true };
      },
      /trigger-docker-socket is external/,
    ],
    [
      'the network given a name: of its own',
      (c) => {
        c.networks![NETWORK] = { driver: 'bridge', internal: true, name: 'docker-socket' };
      },
      /trigger-docker-socket has a name: of its own/,
    ],
    [
      'the network another driver',
      (c) => {
        c.networks![NETWORK] = { driver: 'overlay', internal: true };
      },
      /trigger-docker-socket is not a bridge network/,
    ],
    [
      'the supervisor off the network',
      (c) => {
        c.services!['trigger-supervisor']!.networks = ['ownpace-network'];
      },
      /trigger-supervisor is not on trigger-docker-socket/,
    ],
    [
      'a new client that names the proxy in its environment',
      (c) => {
        c.services!['web']!.environment = { DOCKER_HOST: 'tcp://trigger-docker-proxy:2375' };
      },
      /web names the socket proxy as a host/,
    ],
    [
      'a new client that waits for the proxy',
      (c) => {
        c.services!['trigger-api']!.depends_on = { [PROXY]: { condition: 'service_started' } };
      },
      /trigger-api names the socket proxy as a host or waits for it, and is not in CLIENTS/,
    ],
    [
      'a port published',
      (c) => {
        c.services![PROXY]!.ports = ['2375:2375'];
      },
      /trigger-docker-proxy publishes a port/,
    ],
    [
      "a service in the supervisor's network namespace",
      (c) => {
        c.services!['probe'] = { network_mode: 'service:trigger-supervisor' };
      },
      /probe shares trigger-supervisor's network namespace \(network_mode: service:trigger-supervisor\), so it is on trigger-docker-socket, and is not one of the socket proxy's clients/,
    ],
    [
      "a service in the proxy's network namespace",
      (c) => {
        c.services!['sidecar'] = { network_mode: 'service:trigger-docker-proxy' };
      },
      /sidecar shares trigger-docker-proxy's network namespace/,
    ],
    [
      "a service in the namespace of one that is in a member's",
      (c) => {
        c.services!['probe'] = { network_mode: 'service:trigger-supervisor' };
        c.services!['probe2'] = { network_mode: 'service:probe' };
      },
      /probe2 shares probe's network namespace/,
    ],
    [
      "a service in a container's namespace",
      (c) => {
        c.services!['probe'] = { network_mode: 'container:ownpace-managed-trigger-supervisor' };
      },
      /probe has network_mode: container:ownpace-managed-trigger-supervisor/,
    ],
    [
      "a service on the host's network",
      (c) => {
        c.services!['probe'] = { network_mode: 'host' };
      },
      /probe has network_mode: host/,
    ],
    [
      'a service with no networks: at all, beside a proxy on default',
      (c) => {
        delete c.services![PROXY]!.networks;
        c.services!['probe'] = {};
      },
      /probe is on default, and is not one of the socket proxy's clients/,
    ],
    [
      'a tenant-facing service renamed, so the list names a service the file does not have',
      (c) => {
        c.services!['mailpit-renamed'] = c.services!['mailpit']!;
        delete c.services!['mailpit'];
      },
      /mailpit is not a service of this file/,
    ],
    [
      'task runs joined to it',
      (c) => {
        env(c, 'trigger-supervisor').DOCKER_RUNNER_NETWORKS =
          '${COMPOSE_PROJECT_NAME}_ownpace-network,${COMPOSE_PROJECT_NAME}_trigger-docker-socket';
      },
      /DOCKER_RUNNER_NETWORKS names trigger-docker-socket, a network trigger-docker-proxy is on/,
    ],
    [
      'task runs on a network this file does not declare',
      (c) => {
        env(c, 'trigger-supervisor').DOCKER_RUNNER_NETWORKS = 'somewhere-else';
      },
      /DOCKER_RUNNER_NETWORKS \(somewhere-else\) names no network this file declares/,
    ],
  ];

  it.each(mutations)('%s', (_label, mutate, why) => {
    const c = copy();
    mutate(c);
    const problems = proxyNetworkProblems(c);
    expect(problems.join('\n')).toMatch(why);
  });

  it.each(TENANT_FACING.map((t) => [t]))('%s, a tenant-facing service, put on the network', (t) => {
    const c = copy();
    expect(c.services?.[t], `${t} is not a service of managed.yml`).toBeDefined();
    c.services![t]!.networks = [...netsOf(c.services![t]), NETWORK];
    expect(proxyNetworkProblems(c).join('\n')).toMatch(new RegExp(`${t}, which a tester or the internet reaches, shares trigger-docker-socket`));
  });

  it('a script that joins it by hand is found, and a check that only lists it or asks a member is not', () => {
    expect(joinsByName('deploy/compose/x.sh', 'docker run --rm --network "${P}_trigger-docker-socket" img')).toHaveLength(1);
    expect(joinsByName('deploy/compose/x.sh', 'docker network connect "${P}_trigger-docker-socket" c')).toHaveLength(1);
    expect(joinsByName('deploy/compose/x.sh', 'docker run --rm --net "${P}_trigger-docker-socket" img')).toHaveLength(1);
    expect(joinsByName('deploy/compose/x.sh', 'docker run --rm --net=${P}_trigger-docker-socket img')).toHaveLength(1);
    expect(joinsByName('deploy/compose/x.sh', 'docker network connect --alias x "${P}_trigger-docker-socket" c')).toHaveLength(1);
    expect(joinsByName('deploy/compose/x.sh', 'docker run --network=container:${P}-trigger-supervisor img')).toHaveLength(1);
    expect(joinsByName('deploy/compose/x.sh', 'docker run --net container:"${P}-trigger-docker-proxy" img')).toHaveLength(1);
    expect(joinsByName('.github/workflows/x.yml', '        run: docker run --rm --network "${P}_trigger-docker-socket" img')).toHaveLength(1);
    expect(joinsByName('deploy/compose/x.yml', 'services:\n  probe:\n    network_mode: "service:trigger-supervisor"')).toHaveLength(1);
    expect(joinsByName('deploy/compose/www.yml', 'networks:\n  trigger-docker-socket:\n    external: true')).toHaveLength(1);
    expect(joinsByName('deploy/compose/x.sh', 'docker run --network=container:${P}-gatus img')).toEqual([]);
    expect(joinsByName('deploy/compose/x.sh', 'for n in ownpace-network status-probe trigger-event-store trigger-docker-socket; do')).toEqual([]);
    expect(joinsByName('deploy/compose/x.sh', 'if docker exec "$SUPERVISOR_CONTAINER" node -e \\')).toEqual([]);
    expect(joinsByName('deploy/compose/x.sh', '# docker network connect "${P}_trigger-docker-socket" c, never')).toEqual([]);
    expect(joinsByName(MANAGED, managedYml)).toEqual([]);
  });
});
