// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PLANE REMOVED, AND WHAT IT LEFT REMOVED BY NAME (workplan 0167 T9;
 * ADR-0054). The owner, 2026-11-23: "i will remove trigger.dev, but the
 * machine runs OTA and managed, so both have to be move out of triggerdev."
 *
 * alpha.16 moved the managed edition's jobs to pg-boss and kept Trigger.dev's
 * plane installed and stopped, in profile `trigger`, as the way back. alpha.18
 * removes it. What this holds:
 *
 *  1. **managed.yml runs without it.** None of the plane's eleven services,
 *     its three networks or its volumes is declared, no profile `trigger` is
 *     left, and no `TRIGGER_*` key is handed to a container or written in
 *     `managed.env.example`. Compose never removes a volume a file stops
 *     declaring, so this alone removes nothing from a stack: that is 3.
 *  2. **The switch fails loudly on an old .env.** `OWNPACE_JOB_RUNNER=trigger`
 *     is refused, by the shell reader the scripts share and by the API's and
 *     the worker's own, in one sentence that says Trigger.dev was removed in
 *     alpha.18 (job-runner-mode.unit.test.ts, job-runner.unit.test.ts and
 *     worker.unit.test.ts run each reader; here, that the three say it).
 *  3. **The volumes go only by name, on the owner's word.**
 *     `deploy/compose/remove-trigger-plane.sh`, run against a Docker stand-in
 *     that keeps what a stack holds: it lists, says what `--yes` would remove
 *     and removes nothing without it; with `--yes` it removes exactly the
 *     plane's volumes and networks of this checkout's project, and nothing
 *     else of the project; a second run says there is nothing to remove. It
 *     refuses while a container of the plane is left, and on a switch that
 *     says `trigger`.
 *  4. **The names are alpha.17's.** The lists the script and the bring-up's
 *     plane phase remove are the services, volumes and networks alpha.17's
 *     managed.yml declared (frozen here; checked against the tag when this
 *     clone has it), plus the Bitnami-era object store alpha.17 no longer
 *     declared but a stack from before 0146 T7 still holds.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_DIR = join(REPO_ROOT, 'deploy', 'compose');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

/** What alpha.17's managed.yml declared for the plane (v0.2.0-alpha.17, frozen 2026-11-23). */
const ALPHA17_SERVICES = [
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
];
const ALPHA17_VOLUMES = [
  'trigger_db_data',
  'redis_data',
  'trigger_shared',
  'registry_data',
  'minio_data_v2',
  'trigger_tls_data',
  'trigger_tls_config',
  'clickhouse_data',
  'clickhouse_data_v2',
  'clickhouse_logs',
];
/** The Bitnami-era object store, undeclared since 0146 T7; a stack that ran before it still holds it. */
const BITNAMI_ERA_VOLUMES = ['minio_data'];
const ALPHA17_NETWORKS = ['trigger-event-store', 'trigger-docker-socket', 'trigger-task-images'];

type Compose = {
  services: Record<string, { profiles?: string[]; environment?: Record<string, string> | string[]; depends_on?: unknown }>;
  volumes?: Record<string, unknown>;
  networks?: Record<string, unknown>;
};

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

/** A bash array's words, as `NAME=(…)` assigns them in a script. */
function bashArray(text: string, name: string): string[] {
  const m = new RegExp(`^${name}=\\(([^)]*)\\)`, 'm').exec(text);
  if (!m) throw new Error(`no ${name}=( … ) in the script`);
  return m[1]!.split(/\s+/).filter(Boolean);
}

describe('1. managed.yml runs without the plane', () => {
  const compose = parseYaml(read('deploy/compose/managed.yml')) as Compose;
  const text = read('deploy/compose/managed.yml');

  it('declares none of its services, volumes or networks, and no profile trigger', () => {
    const services = Object.keys(compose.services);
    expect(services.filter((s) => ALPHA17_SERVICES.includes(s))).toEqual([]);
    expect(Object.keys(compose.volumes ?? {}).filter((v) => [...ALPHA17_VOLUMES, ...BITNAMI_ERA_VOLUMES].includes(v))).toEqual([]);
    expect(Object.keys(compose.networks ?? {}).filter((n) => ALPHA17_NETWORKS.includes(n))).toEqual([]);
    expect(Object.entries(compose.services).filter(([, s]) => (s.profiles ?? []).includes('trigger'))).toEqual([]);
  });

  it('runs the jobs in the worker, and still hands every service the switch with pg-boss as its default', () => {
    expect(Object.keys(compose.services)).toContain('worker');
    const defaults = [...text.matchAll(/\$\{OWNPACE_JOB_RUNNER:-([^}]*)\}/g)].map((m) => m[1]);
    expect(defaults.length).toBeGreaterThan(0);
    expect(new Set(defaults)).toEqual(new Set(['pg-boss']));
  });

  it('hands no container a TRIGGER_ key, and the example .env names none', () => {
    const uncommented = (t: string) =>
      t
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join('\n');
    expect(uncommented(text)).not.toMatch(/TRIGGER_[A-Z_]+/);
    expect(uncommented(read('deploy/compose/managed.env.example'))).not.toMatch(/^TRIGGER_[A-Z_]+=/m);
  });
});

describe('2. an old .env that says trigger fails loudly, the same way in every reader', () => {
  it('the shell reader, the API and the worker each say Trigger.dev was removed in alpha.18', () => {
    expect(read('deploy/compose/job-runner.sh')).toMatch(/but Trigger\.dev was removed in alpha\.18, so remove the key/);
    for (const file of ['apps/api/src/job-runner.ts', 'apps/worker/src/runner/worker.ts']) {
      expect(read(file), file).toMatch(
        /OWNPACE_JOB_RUNNER is "trigger", but Trigger\.dev was removed in alpha\.18, so remove the key from the \.env or set it to "pg-boss"\./,
      );
    }
  });
});

/**
 * A Docker that keeps what a stack holds in a directory: one file per volume,
 * per network, and per container (its project and service in the name), and
 * a log of every call. Only what remove-trigger-plane.sh asks is answered.
 */
function aDocker(root: string): { bin: string; state: string; log: string } {
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  const log = join(root, 'calls');
  for (const d of [bin, join(state, 'volumes'), join(state, 'networks'), join(state, 'containers')]) mkdirSync(d, { recursive: true });
  writeFileSync(log, '');
  writeFileSync(
    join(bin, 'docker'),
    `#!/usr/bin/env bash
S='${state}'
printf '%s\\n' "$*" >>'${log}'
last="\${!#}"
case "$1 $2" in
  'volume inspect') [ -e "$S/volumes/$last" ] && { echo "$last"; exit 0; }; echo "Error response from daemon: get $last: no such volume" >&2; exit 1 ;;
  'network inspect') [ -e "$S/networks/$last" ] && { echo "$last"; exit 0; }; echo "Error response from daemon: network $last not found" >&2; exit 1 ;;
  'volume rm') rm "$S/volumes/$last" && echo "$last"; exit $? ;;
  'network rm') rm "$S/networks/$last" && echo "$last"; exit $? ;;
esac
if [ "$1" = ps ]; then
  project='' service=''
  for a in "$@"; do
    case "$a" in
      label=com.docker.compose.project=*) project="\${a#label=com.docker.compose.project=}" ;;
      label=com.docker.compose.service=*) service="\${a#label=com.docker.compose.service=}" ;;
    esac
  done
  for c in "$S/containers/$project--$service--"*; do [ -e "$c" ] && basename "$c" | sed 's/.*--//'; done
  exit 0
fi
echo "the stand-in does not know: docker $*" >&2
exit 3
`,
  );
  chmodSync(join(bin, 'docker'), 0o755);
  return { bin, state, log };
}

/** A checkout's deploy/compose with the script, its readers, managed.yml and a .env. */
function aCheckout(env: string, managed = read('deploy/compose/managed.yml')): string {
  const root = mkdtempSync(join(tmpdir(), 'plane-removed-'));
  tempDirs.push(root);
  const dir = join(root, 'deploy', 'compose');
  mkdirSync(dir, { recursive: true });
  for (const f of ['remove-trigger-plane.sh', 'env-read.sh', 'job-runner.sh', 'stack-kind.sh']) copyFileSync(join(COMPOSE_DIR, f), join(dir, f));
  chmodSync(join(dir, 'remove-trigger-plane.sh'), 0o755);
  writeFileSync(join(dir, 'managed.yml'), managed);
  writeFileSync(join(dir, '.env'), env);
  return root;
}

const PROJECT = 'ownpace-drill';
const ENV = `COMPOSE_PROJECT_NAME=${PROJECT}\n`;
const ALL_VOLUMES = [...ALPHA17_VOLUMES, ...BITNAMI_ERA_VOLUMES];

function aStack(opts: { env?: string; managed?: string; containers?: string[]; others?: string[] } = {}) {
  const root = aCheckout(opts.env ?? ENV, opts.managed);
  const docker = aDocker(root);
  for (const v of ALL_VOLUMES) writeFileSync(join(docker.state, 'volumes', `${PROJECT}_${v}`), '');
  for (const n of ALPHA17_NETWORKS) writeFileSync(join(docker.state, 'networks', `${PROJECT}_${n}`), '');
  // What is the project's and not the plane's, and another stack's plane: never touched.
  for (const v of opts.others ?? ['postgres_data', 'zitadel_data']) writeFileSync(join(docker.state, 'volumes', `${PROJECT}_${v}`), '');
  writeFileSync(join(docker.state, 'volumes', 'ownpace-live_trigger_db_data'), '');
  for (const c of opts.containers ?? []) writeFileSync(join(docker.state, 'containers', `${PROJECT}--${c}--${PROJECT}-${c}-1`), '');
  const run = (...args: string[]) =>
    spawnSync(join(root, 'deploy/compose/remove-trigger-plane.sh'), args, {
      env: { PATH: `${docker.bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: root },
      encoding: 'utf8',
      timeout: 30_000,
    });
  const volumes = () => execFileSync('ls', [join(docker.state, 'volumes')], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const networks = () => execFileSync('ls', [join(docker.state, 'networks')], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const calls = () => readFileSync(docker.log, 'utf8').split('\n').filter(Boolean);
  return { run, volumes, networks, calls, state: docker.state };
}

describe('3. remove-trigger-plane.sh, against a Docker stand-in', () => {
  it('--list names the plane’s volumes this project still holds, one a line, and removes nothing', () => {
    const st = aStack();
    const r = st.run('--list');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.split('\n').filter(Boolean).sort()).toEqual(ALL_VOLUMES.map((v) => `${PROJECT}_${v}`).sort());
    expect(st.calls().filter((c) => / rm /.test(` ${c} `))).toEqual([]);
  });

  it('without --yes it says what it would remove, one way, and removes nothing', () => {
    const st = aStack();
    const r = st.run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/with --yes, this removes, one way:/);
    for (const v of ALL_VOLUMES) expect(r.stdout).toContain(`volume  ${PROJECT}_${v}`);
    for (const n of ALPHA17_NETWORKS) expect(r.stdout).toContain(`network ${PROJECT}_${n}`);
    expect(r.stdout).toMatch(/Nothing was removed\./);
    expect(st.calls().filter((c) => /^(volume|network) rm /.test(c))).toEqual([]);
  });

  it('--yes removes exactly the plane’s volumes and networks of this project, and a second run removes nothing', () => {
    const st = aStack();
    const r = st.run('--yes');
    expect(r.status, r.stderr).toBe(0);
    expect(st.volumes().sort()).toEqual([`${PROJECT}_postgres_data`, `${PROJECT}_zitadel_data`, 'ownpace-live_trigger_db_data'].sort());
    expect(st.networks()).toEqual([]);
    expect(r.stdout).toMatch(new RegExp(`plane is gone from ${PROJECT}: ${ALL_VOLUMES.length} volume\\(s\\) and ${ALPHA17_NETWORKS.length} network\\(s\\) removed`));
    // By name, one at a time: never a prune, never `down -v`, never another stack's.
    const removals = st.calls().filter((c) => / rm | prune|down/.test(` ${c} `));
    expect(removals.every((c) => /^(volume|network) rm ownpace-drill_/.test(c)), removals.join('\n')).toBe(true);
    expect(removals).toHaveLength(ALL_VOLUMES.length + ALPHA17_NETWORKS.length);

    const again = st.run('--yes');
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/Nothing to remove\./);
  });

  it('a stack that never had the Bitnami-era object store: the rest go, and it is passed by', () => {
    const st = aStack();
    execFileSync('rm', [join(st.state, 'volumes', `${PROJECT}_minio_data`)]);
    const r = st.run('--yes');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`${ALL_VOLUMES.length - 1} volume\\(s\\)`));
    expect(st.run('--list').stdout).toBe('');
  });

  it('refuses while a container of the plane is left, running or stopped, and names the phase that removes it', () => {
    const st = aStack({ containers: ['trigger-db', 'minio'] });
    const r = st.run('--yes');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refused: containers of the plane are still on ownpace-drill: .*trigger-db-1.*minio-1|refused: containers of the plane are still on ownpace-drill: .*minio-1.*trigger-db-1/);
    expect(r.stderr).toMatch(/bootstrap-managed\.sh --only plane/);
    expect(r.stderr).toMatch(/Nothing was removed\./);
    expect(st.volumes()).toHaveLength(ALL_VOLUMES.length + 3);
  });

  it('refuses an old .env that still says trigger, before it removes anything', () => {
    const st = aStack({ env: `${ENV}OWNPACE_JOB_RUNNER=trigger\n` });
    const r = st.run('--yes');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Trigger\.dev was removed in alpha\.18/);
    expect(st.calls().filter((c) => /^(volume|network) rm /.test(c))).toEqual([]);
  });

  it('refuses a checkout whose managed.yml still defines the plane (before alpha.18), before it removes anything', () => {
    const managed = read('deploy/compose/managed.yml').replace(/\nservices:\n/, '\nservices:\n  trigger-db:\n    image: example\n');
    const st = aStack({ managed });
    const r = st.run('--yes');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/still defines trigger-db: this checkout is from before alpha\.18/);
    expect(st.calls().filter((c) => /^(volume|network) rm /.test(c))).toEqual([]);
  });

  it('refuses any argument it does not know', () => {
    const st = aStack();
    expect(st.run('--force').status).toBe(2);
    expect(st.run('--yes', '--list').status).toBe(2);
    expect(st.calls().filter((c) => /^(volume|network) rm /.test(c))).toEqual([]);
  });
});

describe('4. the names removed are the ones alpha.17 declared', () => {
  const script = read('deploy/compose/remove-trigger-plane.sh');
  const bootstrap = read('deploy/compose/bootstrap-managed.sh');

  it('the script removes alpha.17’s volumes and networks and the Bitnami-era object store, and no other', () => {
    expect(bashArray(script, 'PLANE_VOLUMES').sort()).toEqual([...ALL_VOLUMES].sort());
    expect(bashArray(script, 'PLANE_NETWORKS').sort()).toEqual([...ALPHA17_NETWORKS].sort());
  });

  it('the script and the bring-up’s plane phase know the same eleven services', () => {
    expect(bashArray(script, 'PLANE_SERVICES').sort()).toEqual([...ALPHA17_SERVICES].sort());
    expect(bashArray(bootstrap, 'PLANE_SERVICES').sort()).toEqual([...ALPHA17_SERVICES].sort());
  });

  it('the bring-up’s plane phase removes containers and never a volume', () => {
    const phase = bootstrap.slice(bootstrap.indexOf('plane_containers_removed() {'), bootstrap.indexOf('phase_plane() {'));
    expect(phase).toMatch(/docker rm\b/);
    expect(phase).not.toMatch(/docker volume rm|volume prune|down -v|--volumes/);
  });

  const tagged = spawnSync('git', ['-C', REPO_ROOT, 'show', 'v0.2.0-alpha.17:deploy/compose/managed.yml'], { encoding: 'utf8' });
  it.skipIf(tagged.status !== 0)('the frozen lists are what v0.2.0-alpha.17’s managed.yml declared, when this clone has the tag', () => {
    const old = parseYaml(tagged.stdout) as Compose;
    expect(Object.entries(old.services).filter(([, s]) => (s.profiles ?? []).includes('trigger')).map(([n]) => n).sort()).toEqual(
      [...ALPHA17_SERVICES].sort(),
    );
    const planeVolumes = Object.keys(old.volumes ?? {}).filter((v) => !Object.keys(parseYaml(read('deploy/compose/managed.yml')).volumes ?? {}).includes(v));
    expect(planeVolumes.sort()).toEqual([...ALPHA17_VOLUMES].sort());
    expect(Object.keys(old.networks ?? {}).filter((n) => n.startsWith('trigger-')).sort()).toEqual([...ALPHA17_NETWORKS].sort());
  });
});
