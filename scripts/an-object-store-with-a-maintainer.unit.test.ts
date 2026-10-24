// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN OBJECT STORE WITH A MAINTAINER (workplan 0146 T7; the owner, 2026-10-23:
 * *"T7 no, fix already within the alpha"*).
 *
 * Trigger.dev keeps its large run payloads and outputs in the `minio` service
 * of `deploy/compose/managed.yml`. Until this change that service ran
 * `bitnamilegacy/minio:2025.5.24-debian-12-r5` by digest: frozen software from
 * a repository Docker Hub labels *"Legacy Bitnami images (no longer
 * updated)"*, which Security Scan #4726 read on 2026-10-23 as 26 critical and
 * 259 high findings, 206 of them fixed in a newer package, and which no newer
 * build would ever reach. MinIO's own image is gone from Docker Hub and its
 * repository has said *"THIS REPOSITORY IS NO LONGER MAINTAINED"* since
 * 2026-02-12 (0119 §3 item 5). The pin was honest about what it was, and the
 * owner did not accept it for the Alpha: replace it during the Alpha.
 *
 * What replaced it is Chainguard's build of the same server
 * (`chainguard/minio`, from the maintained fork `chainguard-forks/minio`),
 * which Trivy read 0 critical and 0 high on 2026-10-23. It is not a tag swap,
 * and each difference is a way to bring up a store that answers and then
 * fails every write:
 *
 *  - no `MINIO_DEFAULT_BUCKETS`. That was a Bitnami convenience; this image
 *    reads no such variable, so without a one-shot that makes `packets`
 *    MinIO comes up healthy and Trigger.dev's first offloaded payload fails.
 *    Trigger.dev v4.7.6 makes no bucket itself (0119 §3 item 5, *What
 *    Trigger.dev v4.7.6 asks of it*), so `trigger-api` waits for the one-shot;
 *  - its entrypoint is the bare `minio` binary, so the service names
 *    `server /data` itself, and its data directory is `/data`, not
 *    `/bitnami/minio/data`. A volume laid out by one vendor's image is not
 *    handed to another's at a new path: the store moves to a NEW volume and
 *    the old one is left alone (hard rule 2), as ClickHouse moved;
 *  - Chainguard's free tier publishes only `latest` and `latest-dev`, so the
 *    pin is `latest` by its index digest. A bare `latest` would be the lie
 *    `bitnamilegacy/minio:latest` told until 2026-08-24, a tag that quietly
 *    stopped moving and named nothing.
 *
 * And what must survive the move: the release check at start stays off
 * (`MINIO_UPDATE`, `MINIO_CALLHOME_ENABLE`; `a-service-that-phones-home`
 * holds the reading), and the store publishes no port, since anything that
 * reaches `minio:9000` can try an unauthenticated write the frozen image never
 * fixed.
 *
 * Read from the file with a YAML parser, as Compose reads it. The rules are
 * `objectStoreProblems`, and the cases at the bottom show each one refusing
 * the shape it exists for, `main`'s Bitnami service of 2026-10-23 first.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED = 'deploy/compose/managed.yml';
const managedYml = readFileSync(join(REPO_ROOT, MANAGED), 'utf8');

/** The service `OBJECT_STORE_BASE_URL` names (`http://minio:9000`), and the one-shot that makes its bucket. */
export const STORE = 'minio';
export const INIT = 'minio-init';
/** The bucket Trigger.dev writes every packet to: the first segment of the key (0119 §3 item 5). */
export const BUCKET = 'packets';
/** Where the image keeps its data, and where Bitnami's kept it. */
export const DATA_DIR = '/data';
const OLD_DATA_DIR = '/bitnami/minio/data';
/** The Bitnami-era volume, left on disk for the owner to remove by hand; never mounted again. */
export const OLD_VOLUME = 'minio_data';
/** The maintained build, by tag and index digest. */
const PIN = /^chainguard\/minio:latest@sha256:([0-9a-f]{64})$/;

type Dependency = { condition?: string };
type Service = {
  image?: string;
  command?: string | string[];
  entrypoint?: string | string[];
  environment?: Record<string, unknown> | string[];
  volumes?: Array<string | { source?: string; target?: string }>;
  ports?: unknown[];
  expose?: unknown[];
  healthcheck?: { test?: string | string[]; disable?: boolean };
  restart?: string;
  depends_on?: string[] | Record<string, Dependency>;
};
type Compose = { services?: Record<string, Service>; volumes?: Record<string, unknown> };

const words = (v: string | string[] | undefined): string => (Array.isArray(v) ? v.join(' ') : (v ?? ''));
function environmentOf(svc: Service): Record<string, string> {
  const env = svc.environment;
  if (Array.isArray(env)) {
    return Object.fromEntries(env.map((e) => [e.split('=')[0]!, e.includes('=') ? e.slice(e.indexOf('=') + 1) : '']));
  }
  return Object.fromEntries(Object.entries(env ?? {}).map(([k, v]) => [k, v === null ? '' : String(v)]));
}
function mountsOf(svc: Service): Array<{ source: string; target: string }> {
  return (svc.volumes ?? []).map((v) => {
    if (typeof v !== 'string') return { source: v.source ?? '', target: v.target ?? '' };
    const [source = '', target = ''] = v.split(':');
    return { source, target };
  });
}
function dependsOn(svc: Service, name: string): Dependency | undefined {
  const deps = svc.depends_on;
  if (Array.isArray(deps)) return deps.includes(name) ? {} : undefined;
  return deps?.[name];
}

/**
 * Everything wrong with the object store in `yml`, as sentences; none when it
 * runs a maintained image the way that image needs to be run. `text` is the
 * same file unparsed, for the comment beside the pin.
 */
export function objectStoreProblems(yml: string): string[] {
  const doc = parseYaml(yml) as Compose;
  const services = doc.services ?? {};
  const problems: string[] = [];

  for (const [name, svc] of Object.entries(services)) {
    if ((svc.image ?? '').startsWith('bitnamilegacy/')) {
      problems.push(`${name} runs ${svc.image}: a Bitnami legacy image is frozen, and no fix will ever reach it (0146 T7)`);
    }
  }

  const store = services[STORE];
  if (!store) return [...problems, `there is no ${STORE} service, and OBJECT_STORE_BASE_URL names http://${STORE}:9000`];

  const pin = PIN.exec(store.image ?? '');
  if (!pin) problems.push(`${STORE} runs ${store.image ?? 'no image'}, not chainguard/minio:latest by its index digest`);

  if (!/^server\s+\/data(\s|$)/.test(words(store.command).trim())) {
    problems.push(`${STORE}'s command is "${words(store.command)}"; the image's entrypoint is the bare minio binary, so it needs server ${DATA_DIR}`);
  }
  const mounts = mountsOf(store);
  const data = mounts.find((m) => m.target === DATA_DIR);
  if (!data) problems.push(`${STORE} mounts no volume at ${DATA_DIR}, where the image keeps its data`);
  else {
    if (data.source === OLD_VOLUME) problems.push(`${STORE} mounts ${OLD_VOLUME}, Bitnami's layout, at ${DATA_DIR}: the store moves to a new volume`);
    if (data.source.startsWith('.') || data.source.startsWith('/')) problems.push(`${STORE}'s data at ${DATA_DIR} is a bind mount (${data.source}), not a named volume`);
    else if (!(data.source in (doc.volumes ?? {}))) problems.push(`${STORE}'s volume ${data.source} is not declared under volumes:`);
  }
  for (const m of mounts) {
    if (m.source === OLD_VOLUME || m.target === OLD_DATA_DIR) problems.push(`${STORE} still mounts ${m.source}:${m.target}, the Bitnami-era store`);
  }

  const env = environmentOf(store);
  for (const key of ['MINIO_UPDATE', 'MINIO_CALLHOME_ENABLE']) {
    if (env[key] !== 'off') problems.push(`${STORE}'s ${key} is ${env[key] === undefined ? 'not set' : `"${env[key]}"`}; it must be "off", written in the file`);
  }
  for (const key of ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD']) {
    if (!env[key]) problems.push(`${STORE} sets no ${key}, the pair trigger-api's OBJECT_STORE_* values present`);
  }
  if ('MINIO_DEFAULT_BUCKETS' in env) {
    problems.push(`${STORE} still sets MINIO_DEFAULT_BUCKETS, a Bitnami convenience this image never reads: ${INIT} makes the bucket`);
  }
  if ((store.ports ?? []).length > 0) problems.push(`${STORE} publishes a port; it is reached on the stack's network only`);
  const health = store.healthcheck;
  if (!health || health.disable === true || !/\bmc\b.*\bready\b/.test(words(health.test))) {
    problems.push(`${STORE} has no health check that asks mc ready, so nothing waits for it to answer before ${INIT} runs`);
  }

  const init = services[INIT];
  if (!init) {
    problems.push(`there is no ${INIT} service, so nothing makes the ${BUCKET} bucket and every packet write fails`);
  } else {
    if (pin && init.image !== store.image) {
      problems.push(`${INIT} runs ${init.image ?? 'no image'}, not ${STORE}'s pin, whose image carries mc`);
    }
    const script = `${words(init.entrypoint)} ${words(init.command)}`;
    const mb = new RegExp(`\\bmc\\b[^\\n]*\\bmb\\b[^\\n]*--ignore-existing[^\\n]*\\b\\S+/${BUCKET}\\b`);
    if (!mb.test(script)) {
      problems.push(`${INIT} does not run mc mb --ignore-existing <alias>/${BUCKET}, so the bucket is not made, or not made again harmlessly`);
    }
    if (!/@minio:9000\b/.test(script) && !Object.values(environmentOf(init)).some((v) => /@minio:9000\b/.test(v))) {
      problems.push(`${INIT} does not ask ${STORE} at minio:9000, the address trigger-api uses`);
    }
    if (init.restart !== 'no') problems.push(`${INIT}'s restart is ${init.restart ?? 'unset'}; a one-shot says "no"`);
    if (dependsOn(init, STORE)?.condition !== 'service_healthy') {
      problems.push(`${INIT} does not wait for ${STORE} to be healthy, so it can ask a server that is not listening yet`);
    }
    if ((init.ports ?? []).length > 0) problems.push(`${INIT} publishes a port`);
  }

  const api = services['trigger-api'];
  if (!api) problems.push('there is no trigger-api service to wait for the bucket');
  else if (dependsOn(api, INIT)?.condition !== 'service_completed_successfully') {
    problems.push(`trigger-api does not wait for ${INIT} to complete successfully, so it can start before ${BUCKET} exists`);
  }
  return problems;
}

/** The comment above the pin: the digest's date, and the two architectures its index carries. */
export function pinCommentProblems(yml: string): string[] {
  const start = yml.indexOf(`\n  ${STORE}:\n`);
  const image = /\n\s+image:\s*chainguard\/minio:latest@sha256:([0-9a-f]{64})/.exec(yml.slice(start));
  if (start < 0 || !image) return [`no ${STORE} service pinned to chainguard/minio:latest@sha256:… to read the comment of`];
  // The block comment above the service, and the service's own lines up to the image.
  const before = yml.slice(0, start).split('\n').reverse();
  const above: string[] = [];
  for (const line of before) {
    if (!/^\s*#/.test(line)) break;
    above.push(line);
  }
  const comment = [...above.reverse(), yml.slice(start, start + image.index)].join('\n');
  const problems: string[] = [];
  const digest = image[1]!;
  if (!comment.includes(digest.slice(0, 12))) {
    problems.push(`the comment beside the pin does not name its digest (${digest.slice(0, 12)}…), so the date beside it says nothing`);
  }
  if (!/\b20\d\d-\d\d-\d\d\b/.test(comment)) problems.push("the comment beside the pin gives no date for the digest");
  for (const arch of ['linux/amd64', 'linux/arm64']) {
    if (!comment.includes(arch)) problems.push(`the comment beside the pin does not say its index carries ${arch}`);
  }
  return problems;
}

describe(`${MANAGED} runs an object store somebody still maintains`, () => {
  it('found the store and its one-shot, rather than passing on nothing', () => {
    const services = (parseYaml(managedYml) as Compose).services ?? {};
    expect(Object.keys(services).length).toBeGreaterThan(10);
    expect(services).toHaveProperty(STORE);
    expect(managedYml).toContain(`OBJECT_STORE_BASE_URL: http://${STORE}:9000`);
  });

  it('has nothing wrong with it', () => {
    expect(objectStoreProblems(managedYml)).toEqual([]);
  });

  it('says beside the pin which digest it is, when it was read, and that both architectures are in it', () => {
    expect(pinCommentProblems(managedYml)).toEqual([]);
  });

  it('never mounts the Bitnami-era volume again, and says how it goes', () => {
    const doc = parseYaml(managedYml) as Compose;
    for (const [name, svc] of Object.entries(doc.services ?? {})) {
      for (const m of mountsOf(svc)) expect(m.source, `${name} mounts ${OLD_VOLUME}`).not.toBe(OLD_VOLUME);
    }
    expect(Object.keys(doc.volumes ?? {}), `${OLD_VOLUME} is still declared, and nothing mounts it`).not.toContain(OLD_VOLUME);
    expect(managedYml, 'the comment that says how the old volume is removed is gone').toMatch(
      new RegExp(`docker volume rm <project>_${OLD_VOLUME}\\b`),
    );
  });
});

// ------------------------------------------------------------------------
// The rules, each refusing the shape it exists for.

/** `main`'s service on 2026-10-23, as it ran: the frozen image, Bitnami's path, Bitnami's bucket switch. */
const BITNAMI = `
services:
  trigger-api:
    image: ghcr.io/triggerdotdev/trigger.dev:v4.7.2
    environment:
      OBJECT_STORE_BASE_URL: http://minio:9000
  minio:
    image: bitnamilegacy/minio:2025.5.24-debian-12-r5@sha256:${'4'.repeat(64)}
    environment:
      MINIO_ROOT_USER: \${MINIO_ROOT_USER:-admin}
      MINIO_ROOT_PASSWORD: \${MINIO_ROOT_PASSWORD:-very-safe-password}
      MINIO_DEFAULT_BUCKETS: packets
      MINIO_UPDATE: "off"
      MINIO_CALLHOME_ENABLE: "off"
    volumes:
      - minio_data:/bitnami/minio/data
volumes:
  minio_data:
`;

const DIGEST = 'c'.repeat(64);
/** The shape this guard asks for, small. */
const GOOD = `
services:
  trigger-api:
    image: ghcr.io/triggerdotdev/trigger.dev:v4.7.2
    depends_on:
      minio-init:
        condition: service_completed_successfully
  # The index digest, ${DIGEST.slice(0, 12)}…, read on 2026-10-24: linux/amd64 and linux/arm64.
  minio:
    image: chainguard/minio:latest@sha256:${DIGEST}
    command: ["server", "/data"]
    environment:
      MINIO_ROOT_USER: \${MINIO_ROOT_USER:-admin}
      MINIO_ROOT_PASSWORD: \${MINIO_ROOT_PASSWORD:-very-safe-password}
      MINIO_UPDATE: "off"
      MINIO_CALLHOME_ENABLE: "off"
      MC_HOST_local: http://127.0.0.1:9000
    volumes:
      - minio_data_v2:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
  minio-init:
    image: chainguard/minio:latest@sha256:${DIGEST}
    restart: "no"
    entrypoint: ["/bin/sh", "-c"]
    command:
      - 'MC_HOST_store="http://$\${MINIO_ROOT_USER}:$\${MINIO_ROOT_PASSWORD}@minio:9000" exec mc --config-dir /tmp/mc mb --ignore-existing store/packets'
    depends_on:
      minio:
        condition: service_healthy
volumes:
  minio_data_v2:
`;

describe('the rules', () => {
  it("refuse main's Bitnami service of 2026-10-23, for each thing it lacks", () => {
    const problems = objectStoreProblems(BITNAMI);
    const said = (re: RegExp) => expect(problems.some((p) => re.test(p)), `${re} in:\n${problems.join('\n')}`).toBe(true);
    said(/minio runs bitnamilegacy\/minio:.*frozen/);
    said(/not chainguard\/minio:latest by its index digest/);
    said(/needs server \/data/);
    said(/mounts no volume at \/data/);
    said(/still mounts minio_data:\/bitnami\/minio\/data/);
    said(/MINIO_DEFAULT_BUCKETS/);
    said(/no health check/);
    said(/no minio-init service/);
    said(/trigger-api does not wait for minio-init/);
  });

  it('accept the shape they ask for', () => {
    expect(objectStoreProblems(GOOD)).toEqual([]);
    expect(pinCommentProblems(GOOD)).toEqual([]);
  });

  it('refuse any Bitnami legacy image, in any service', () => {
    const other = GOOD.replace('\n  minio-init:\n', '\n  clickhouse:\n    image: bitnamilegacy/clickhouse:25.7.5\n  minio-init:\n');
    expect(objectStoreProblems(other)).toEqual([expect.stringMatching(/^clickhouse runs bitnamilegacy\/clickhouse/)]);
  });

  it('refuse a bare latest, a tag without its digest, and another repository', () => {
    for (const image of ['chainguard/minio:latest', 'chainguard/minio:latest-dev@sha256:' + DIGEST, 'minio/minio:RELEASE.2025-10-15T17-29-55Z']) {
      const problems = objectStoreProblems(GOOD.replace(`image: chainguard/minio:latest@sha256:${DIGEST}\n    command`, `image: ${image}\n    command`));
      expect(problems, image).toContainEqual(expect.stringMatching(/not chainguard\/minio:latest by its index digest/));
    }
  });

  it('refuse the old volume at the new path, and a volume nobody declared', () => {
    expect(objectStoreProblems(GOOD.replace('- minio_data_v2:/data', '- minio_data:/data').replace('minio_data_v2:\n', 'minio_data:\n'))).toContainEqual(
      expect.stringMatching(/mounts minio_data, Bitnami's layout/),
    );
    expect(objectStoreProblems(GOOD.replace('volumes:\n  minio_data_v2:\n', ''))).toContainEqual(
      expect.stringMatching(/minio_data_v2 is not declared/),
    );
  });

  it('refuse a release check switched back on, or left to the .env', () => {
    expect(objectStoreProblems(GOOD.replace('MINIO_UPDATE: "off"', 'MINIO_UPDATE: ${MINIO_UPDATE:-off}'))).toContainEqual(
      expect.stringMatching(/MINIO_UPDATE is "\$\{MINIO_UPDATE:-off\}"/),
    );
    expect(objectStoreProblems(GOOD.replace('      MINIO_CALLHOME_ENABLE: "off"\n', ''))).toContainEqual(
      expect.stringMatching(/MINIO_CALLHOME_ENABLE is not set/),
    );
  });

  it('refuse a published port', () => {
    const published = GOOD.replace('    command: ["server", "/data"]', '    command: ["server", "/data"]\n    ports:\n      - "127.0.0.1:9000:9000"');
    expect(objectStoreProblems(published)).toEqual(['minio publishes a port; it is reached on the stack\'s network only']);
  });

  it('refuse a one-shot that makes another bucket, or not harmlessly a second time', () => {
    expect(objectStoreProblems(GOOD.replace('store/packets', 'store/payloads'))).toContainEqual(expect.stringMatching(/does not run mc mb --ignore-existing/));
    expect(objectStoreProblems(GOOD.replace('mb --ignore-existing', 'mb'))).toContainEqual(expect.stringMatching(/does not run mc mb --ignore-existing/));
  });

  it('refuse a one-shot that restarts, starts before the store is healthy, or runs another image', () => {
    expect(objectStoreProblems(GOOD.replace('restart: "no"', 'restart: unless-stopped'))).toContainEqual(expect.stringMatching(/a one-shot says "no"/));
    expect(objectStoreProblems(GOOD.replace('condition: service_healthy', 'condition: service_started'))).toContainEqual(
      expect.stringMatching(/does not wait for minio to be healthy/),
    );
    const client = GOOD.replace(/(minio-init:\n\s+image: )\S+/, `$1chainguard/minio-client:latest@sha256:${'d'.repeat(64)}`);
    expect(objectStoreProblems(client)).toContainEqual(expect.stringMatching(/minio-init runs chainguard\/minio-client/));
  });

  it('refuse a trigger-api that starts before the bucket is made', () => {
    expect(objectStoreProblems(GOOD.replace('condition: service_completed_successfully', 'condition: service_started'))).toContainEqual(
      expect.stringMatching(/trigger-api does not wait for minio-init to complete successfully/),
    );
  });

  it('refuse a pin whose comment names no digest, no date, or one architecture', () => {
    expect(pinCommentProblems(GOOD.replace(`${DIGEST.slice(0, 12)}…, `, ''))).toContainEqual(expect.stringMatching(/does not name its digest/));
    expect(pinCommentProblems(GOOD.replace('read on 2026-10-24', 'read today'))).toContainEqual(expect.stringMatching(/gives no date/));
    expect(pinCommentProblems(GOOD.replace('linux/amd64 and ', ''))).toEqual([
      'the comment beside the pin does not say its index carries linux/amd64',
    ]);
  });
});
