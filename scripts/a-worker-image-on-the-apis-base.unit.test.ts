// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A WORKER IMAGE ON ANOTHER BASE THAN THE API'S (workplan 0167 T7).
 *
 * The managed edition's job worker (ADR-0054) runs the same workspace
 * packages as the API, and `apps/worker/Dockerfile` builds it on
 * `apps/api/Dockerfile`'s two images: the Node line its install runs on and
 * the distroless runtime it runs on. The managed smoke holds the API's Node to
 * the FROM node line's version, and the release, the scan and Dependabot all
 * treat the two images as one pair of pins. A worker on a pin of its own would
 * be a second Node and a second Debian nobody checks, so this file holds:
 *
 * 1. the two Dockerfiles' FROM images are the same list, tag and digest, in
 *    the same order (the build's Node line, then the runtime's distroless);
 * 2. the worker's runtime stage is that distroless, has no RUN and no EXPOSE,
 *    runs as 65532:65532, starts `/nodejs/bin/node` by its path as
 *    ENTRYPOINT with `apps/worker/src/runner/main.ts` as CMD, and its
 *    HEALTHCHECK is Node by that path asking 127.0.0.1:3002/health, exec form;
 * 3. a new commit is a new image, as the API's is: the runtime stage takes
 *    `ARG GIT_SHA` into `ENV OPENMIG_COMMIT` as the API's does, and the
 *    service passes GIT_SHA as the api's does, so a release that changes the
 *    commit changes the image, and Compose replaces the worker's container,
 *    and its output with it, as it replaces the API's (privacy §9: server
 *    logs go at each update of the service);
 * 4. Dependabot moves `/apps/worker` in the API's docker group;
 * 5. managed.yml's `worker` service: built from that Dockerfile, named after
 *    its project, in no profile since the switch is on (profile `jobs` kept
 *    it out of every `up` until then), nothing depending on it, on
 *    `ownpace-network` alone, no
 *    port, its healthcheck the Dockerfile's, after postgres, the pooler and
 *    the api are healthy, with a stop grace period;
 * 6. its CPUs and memory follow the owner's rule from MAX_PASSES_IN_FLIGHT
 *    (3 when unset): the defaults are the rule at 3, and the example and the
 *    service's comment state the rule; and the memory holds the worst case at
 *    the worker's limit on runs at once, read from the worker and the catalog:
 *    every run at the 512 MB budget small-1x gives every queue alike, and the
 *    worker's own process (alpha.17's first rule held one run at 256 MB);
 * 7. the switch: the api and the worker both read `OWNPACE_JOB_RUNNER`,
 *    `pg-boss` by default since the switch is on (workplan 0167 T7), and the
 *    example names it.
 *
 * Each is broken once below, on a copy, and must fail.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { JOB_CATALOG } from '../packages/scheduler/src/pg-boss/catalog.ts';
import { runsAtOnceFor } from '../apps/worker/src/runner/worker.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const API = 'apps/api/Dockerfile';
const WORKER = 'apps/worker/Dockerfile';
const MANAGED = 'deploy/compose/managed.yml';
const EXAMPLE = 'deploy/compose/managed.env.example';
const NODE = '/nodejs/bin/node';
const HEALTH = "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))";

type Instruction = { op: string; args: string };
type Stage = { base: string; name: string; body: Instruction[] };

/** A Dockerfile's stages, comment lines dropped before continuations are joined, as Docker reads it. */
export function stagesOf(text: string): Stage[] {
  const logical = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const out: Stage[] = [];
  for (const line of logical) {
    const [, keyword = '', args = ''] = /^(\S+)\s*(.*)$/.exec(line) ?? [];
    const op = keyword.toUpperCase();
    if (op === 'FROM') {
      const words = args.split(/\s+/).filter((w) => !w.startsWith('--'));
      const as = words.findIndex((w) => w.toUpperCase() === 'AS');
      out.push({ base: words[0]!, name: as >= 0 ? words[as + 1]! : String(out.length), body: [] });
    } else {
      out.at(-1)?.body.push({ op, args });
    }
  }
  return out;
}

/** The images a Dockerfile builds FROM, in order: another stage's name is not an image. */
export const fromImages = (text: string): string[] => {
  const stages = stagesOf(text);
  const names = new Set(stages.map((s) => s.name));
  return stages.map((s) => s.base).filter((b) => !names.has(b));
};

/** What is wrong with the worker's Dockerfile against the API's; empty when nothing is. */
export function dockerfileProblems(worker: string, api: string): string[] {
  const problems: string[] = [];
  const want = fromImages(api);
  const have = fromImages(worker);
  if (JSON.stringify(have) !== JSON.stringify(want)) {
    problems.push(`${WORKER} builds FROM ${have.join(', ')}, and ${API} FROM ${want.join(', ')}: the same images, tag and digest, in the same order`);
  }
  const runtime = stagesOf(worker).at(-1);
  if (!runtime) return [...problems, `${WORKER} has no stage`];
  if (runtime.base !== want.at(-1)) problems.push(`${WORKER}'s runtime stage is ${runtime.base}, not ${API}'s runtime image`);
  const ops = (op: string) => runtime.body.filter((i) => i.op === op).map((i) => i.args);
  if (ops('RUN').length > 0) problems.push(`${WORKER}'s runtime stage has a RUN, and its image has nothing to run one with`);
  if (ops('EXPOSE').length > 0) problems.push(`${WORKER}'s runtime stage EXPOSEs ${ops('EXPOSE').join(', ')}: its health answers on loopback only`);
  if (ops('USER').at(-1) !== '65532:65532') problems.push(`${WORKER}'s runtime stage runs as ${ops('USER').at(-1) ?? 'root'}, not 65532:65532`);
  if (ops('ENTRYPOINT').at(-1) !== JSON.stringify([NODE]).replace(',', ', ')) {
    problems.push(`${WORKER}'s ENTRYPOINT is ${ops('ENTRYPOINT').at(-1)}, not ["${NODE}"]`);
  }
  if (ops('CMD').at(-1) !== '["apps/worker/src/runner/main.ts"]') problems.push(`${WORKER}'s CMD is ${ops('CMD').at(-1)}, not ["apps/worker/src/runner/main.ts"]`);
  // A new commit is a new image: the API's two lines, as the API's runtime stage has them.
  const apiRuntime = stagesOf(api).at(-1)?.body ?? [];
  for (const [op, args] of [['ARG', 'GIT_SHA=unknown'], ['ENV', 'OPENMIG_COMMIT=$GIT_SHA']] as const) {
    const inApi = apiRuntime.some((i) => i.op === op && i.args === args);
    const inWorker = runtime.body.some((i) => i.op === op && i.args === args);
    if (inApi && !inWorker) problems.push(`${WORKER}'s runtime stage has no \`${op} ${args}\`, which the API's has: a new commit would not be a new image`);
  }
  if (!apiRuntime.some((i) => i.op === 'ENV' && i.args === 'OPENMIG_COMMIT=$GIT_SHA')) problems.push(`${API}'s runtime stage no longer takes GIT_SHA into OPENMIG_COMMIT: read this rule again`);
  const health = ops('HEALTHCHECK').at(-1) ?? '';
  const cmd = /\bCMD\s+(\[.*\])\s*$/.exec(health)?.[1];
  let argv: unknown;
  try {
    argv = cmd ? JSON.parse(cmd) : null;
  } catch {
    argv = null;
  }
  if (JSON.stringify(argv) !== JSON.stringify([NODE, '-e', HEALTH])) {
    problems.push(`${WORKER}'s HEALTHCHECK is ${health || 'missing'}, not ${NODE} -e asking 127.0.0.1:3002/health, exec form`);
  }
  return problems;
}

type Service = {
  build?: { context?: string; dockerfile?: string; args?: Record<string, string> };
  container_name?: string;
  profiles?: string[];
  networks?: unknown;
  ports?: unknown;
  expose?: unknown;
  healthcheck?: { test?: unknown };
  depends_on?: Record<string, { condition?: string }> | string[];
  stop_grace_period?: string;
  cpus?: unknown;
  mem_limit?: unknown;
  environment?: Record<string, unknown>;
};
type Compose = { services: Record<string, Service> };

/**
 * The owner's rule, from the cap on passes in flight. The worker runs at most
 * that cap + 2 runs at once (alpha.17, workplan 0167), so both are per run:
 * half a CPU and 512 MB each, and 256 MB more of memory for the worker's own
 * process and the room beside it. Before the limit (alpha.16) the memory was
 * (cap + 1) x 512 MB + 2,816 MB, for every queue at its own concurrency.
 */
export const workerCpus = (passes: number): number => 0.5 * (passes + 2);
export const workerMemoryMb = (passes: number): number => (passes + 2) * 512 + 256;
/** alpha.16's rule, which the service must no longer state. */
const workerMemoryMbBeforeTheLimit = (passes: number): number => (passes + 1) * 512 + 2816;

/**
 * A run's budget: `small-1x`'s 512 MB, of which V8 gets 410, the catalog's
 * `maxOldSpaceMb` (`apps/worker/src/jobs/a-machine-every-task-names`). Every
 * queue has that heap, so every run counts at 512 MB, a pass or not; a queue
 * given more heap than small-1x's share is a run this rule was not sized for,
 * and is refused here rather than counted at 512.
 */
const SMALL_1X = { memoryMb: 512, heapMb: 410 } as const;
/** The worker's own process, measured (workplan 0167): 120 MB. */
const PARENT_MB = 120;

function runBudgetMb(queue: string, maxOldSpaceMb: number): number {
  if (maxOldSpaceMb > SMALL_1X.heapMb) {
    throw new Error(
      `${queue}'s heap of ${maxOldSpaceMb} MB is above small-1x's ${SMALL_1X.heapMb}: its run's budget is not ` +
        `${SMALL_1X.memoryMb} MB, and the worker's memory rule must be worked out again`,
    );
  }
  return SMALL_1X.memoryMb;
}

/**
 * The most the worker holds at its limit: as many runs as it runs at once
 * (`runsAtOnceFor`), each at the largest budget a queue of the catalog has,
 * and its own process.
 */
const worstCaseMb = (passes: number): number =>
  runsAtOnceFor(passes) * Math.max(...JOB_CATALOG.map((job) => runBudgetMb(job.name, job.maxOldSpaceMb))) + PARENT_MB;

/** What is wrong with managed.yml's worker service; empty when nothing is. */
export function serviceProblems(text: string): string[] {
  const compose = parseYaml(text, { merge: true, logLevel: 'error' }) as Compose;
  const w = compose.services['worker'];
  if (!w) return [`${MANAGED} has no worker service`];
  const problems: string[] = [];
  if (w.build?.dockerfile !== WORKER || w.build?.context !== '../..') problems.push(`the worker is not built from ${WORKER} with the repository as its context`);
  if (w.build?.args?.['GIT_SHA'] !== '${GIT_SHA:-unknown}') problems.push('the worker build does not pass GIT_SHA as the api build does');
  if (w.container_name !== '${COMPOSE_PROJECT_NAME}-worker') problems.push(`the worker's container_name is ${w.container_name}, not \${COMPOSE_PROJECT_NAME}-worker`);
  if (w.profiles !== undefined) problems.push(`the worker's profiles are ${JSON.stringify(w.profiles)}: since the switch is on it has none, so every \`up\` starts it`);
  for (const [name, s] of Object.entries(compose.services)) {
    const deps = Array.isArray(s.depends_on) ? s.depends_on : Object.keys(s.depends_on ?? {});
    if (deps.includes('worker')) problems.push(`${name} depends on the worker, so every Compose call without profile jobs fails`);
  }
  if (JSON.stringify(w.networks) !== '["ownpace-network"]') problems.push(`the worker's networks are ${JSON.stringify(w.networks)}, not ["ownpace-network"] alone`);
  if (w.ports !== undefined || w.expose !== undefined) problems.push('the worker publishes or exposes a port: its health answers on loopback inside its container');
  if (JSON.stringify(w.healthcheck?.test) !== JSON.stringify(['CMD', NODE, '-e', HEALTH])) problems.push("the worker's healthcheck is not its image's: Node by its path asking 127.0.0.1:3002/health, exec form");
  const deps = (Array.isArray(w.depends_on) ? {} : w.depends_on ?? {}) as Record<string, { condition?: string }>;
  for (const dep of ['postgres', 'pgbouncer', 'api']) {
    if (deps[dep]?.condition !== 'service_healthy') problems.push(`the worker does not wait for ${dep} to be healthy`);
  }
  if (!w.stop_grace_period) problems.push('the worker has no stop_grace_period: a stop would kill its runs after Docker\'s 10 seconds');
  const ota = 3;
  if (w.cpus !== `\${WORKER_CPUS:-${workerCpus(ota)}}`) problems.push(`the worker's cpus is ${String(w.cpus)}, not \${WORKER_CPUS:-${workerCpus(ota)}}, the rule at ${ota}`);
  if (w.mem_limit !== `\${WORKER_MEMORY:-${workerMemoryMb(ota)}m}`) {
    problems.push(`the worker's mem_limit is ${String(w.mem_limit)}, not \${WORKER_MEMORY:-${workerMemoryMb(ota)}m}, the rule at ${ota}`);
  }
  for (const name of ['worker', 'api']) {
    if (compose.services[name]?.environment?.['OWNPACE_JOB_RUNNER'] !== '${OWNPACE_JOB_RUNNER:-pg-boss}') {
      problems.push(`the ${name}'s OWNPACE_JOB_RUNNER is not \${OWNPACE_JOB_RUNNER:-pg-boss}`);
    }
  }
  if (w.environment?.['NODE_ENV'] !== 'production') problems.push("the worker's NODE_ENV is not production");
  return problems;
}

describe('the worker image is built on the API image\'s two pins', () => {
  it('reads two FROM images from each (vacuity)', () => {
    expect(fromImages(read(API))).toHaveLength(2);
    expect(fromImages(read(WORKER))).toHaveLength(2);
    expect(fromImages(read(API))[1]).toMatch(/^gcr\.io\/distroless\/nodejs\d+-debian\d+:nonroot@sha256:[0-9a-f]{64}$/);
  });

  it(`${WORKER}: the API's FROM lines, and a runtime stage with nothing to exec`, () => {
    expect(dockerfileProblems(read(WORKER), read(API))).toEqual([]);
  });

  it('Dependabot moves /apps/worker with /apps/api', () => {
    const updates = (parseYaml(read('.github/dependabot.yml')) as { updates: Array<{ 'package-ecosystem': string; directories?: string[] }> }).updates;
    const entry = updates.find((u) => u['package-ecosystem'] === 'docker' && u.directories?.includes('/apps/api'));
    expect(entry?.directories).toContain('/apps/worker');
  });

  it('refuses each way off it, on a copy', () => {
    const worker = read(WORKER);
    const api = read(API);
    const [node, distroless] = fromImages(api) as [string, string];
    const cases: Array<[string, string, RegExp]> = [
      ['a digest of its own', worker.replace(node, node.replace(/@sha256:[0-9a-f]{64}/, `@sha256:${'0'.repeat(64)}`)), /the same images, tag and digest/],
      ['the API moving alone', worker, /the same images/],
      ['a RUN in the runtime', worker.replace('USER 65532:65532', 'RUN true\nUSER 65532:65532'), /has a RUN/],
      ['root', worker.replace('USER 65532:65532', 'USER 0'), /runs as 0, not 65532:65532/],
      ['a shell form entrypoint', worker.replace(`ENTRYPOINT ["${NODE}"]`, 'ENTRYPOINT node'), /ENTRYPOINT is node/],
      ['another CMD', worker.replace('apps/worker/src/runner/main.ts', 'apps/worker/src/index.ts'), /CMD is/],
      ['a published port', worker.replace('USER 65532:65532', 'EXPOSE 3002\nUSER 65532:65532'), /EXPOSEs 3002/],
      ['a health over a shell', worker.replace(/HEALTHCHECK[\s\S]*?\n(?=#|ENTRYPOINT)/, 'HEALTHCHECK CMD wget -q -O- http://127.0.0.1:3002/health\n'), /HEALTHCHECK is/],
      ['no commit in the image', worker.replace('ENV OPENMIG_COMMIT=$GIT_SHA\n', ''), /no `ENV OPENMIG_COMMIT=\$GIT_SHA`/],
      ['the runtime on the Node image', worker.replace(`FROM ${distroless} AS runtime`, `FROM ${node} AS runtime`), /runtime stage is node:/],
    ];
    for (const [what, text, expected] of cases) {
      expect(text, `${what}: the copy is the file, so this case would prove nothing`).not.toBe(what === 'the API moving alone' ? '' : worker);
      const against = what === 'the API moving alone' ? api.replace(node, node.replace(/@sha256:[0-9a-f]{64}/, `@sha256:${'1'.repeat(64)}`)) : api;
      expect(dockerfileProblems(text, against).join('\n'), what).toMatch(expected);
    }
  });
});

describe("managed.yml's worker service: defined, not started, sized by the owner's rule", () => {
  const managed = read(MANAGED);

  it('the service as the plan sets it', () => {
    expect(serviceProblems(managed)).toEqual([]);
  });

  it('the rule, at 3 (the OTA stack) and at 6', () => {
    expect([workerCpus(3), workerMemoryMb(3)]).toEqual([2.5, 2816]);
    expect([workerCpus(6), workerMemoryMb(6)]).toEqual([4, 4352]);
    expect([workerMemoryMbBeforeTheLimit(3), workerMemoryMbBeforeTheLimit(6)]).toEqual([4864, 6400]);
  });

  it('holds the worst case at the limit: every run at the budget the catalog gives every queue alike, and the worker itself', () => {
    // Read, not assumed: one heap for every queue (small-1x's share), and the worker's own limit.
    expect(new Set(JOB_CATALOG.map((job) => job.maxOldSpaceMb))).toEqual(new Set([SMALL_1X.heapMb]));
    for (const cap of [1, 3, 6, 12]) {
      expect(runsAtOnceFor(cap), `at ${cap}`).toBe(cap + 2);
      expect(worstCaseMb(cap), `at ${cap}`).toBe((cap + 2) * SMALL_1X.memoryMb + PARENT_MB);
      expect(workerMemoryMb(cap) - worstCaseMb(cap), `at ${cap}: the rule leaves this over the worst case`).toBeGreaterThanOrEqual(0);
      // The room the comments and the docs state: 136 MB.
      expect(workerMemoryMb(cap) - worstCaseMb(cap), `at ${cap}`).toBe(136);
    }
    // managed.yml's own default holds it at 3, whatever the rule above says.
    const memoryDefault = /\$\{WORKER_MEMORY:-(\d+)m\}/.exec(managed);
    expect(memoryDefault, `${MANAGED} has no \${WORKER_MEMORY:-<n>m}`).not.toBeNull();
    expect(Number(memoryDefault![1])).toBeGreaterThanOrEqual(worstCaseMb(3));
    // A queue whose heap outgrew small-1x's share is not counted at 512 MB: it stops this rule.
    expect(() => runBudgetMb('a-bigger-run', SMALL_1X.heapMb + 1)).toThrow(/must be worked out again/);
  });

  it('the example and the service state the rule and name the knobs', () => {
    const example = read(EXAMPLE);
    for (const key of ['OWNPACE_JOB_RUNNER', 'WORKER_CPUS', 'WORKER_MEMORY']) expect(example, key).toMatch(new RegExp(`^${key}=$`, 'm'));
    // Read as prose: comment marks and line breaks folded into single spaces.
    for (const [file, raw] of [[EXAMPLE, example], [MANAGED, managed]] as const) {
      const text = raw.replace(/\n\s*#\s*/g, ' ').replace(/\s+/g, ' ');
      expect(text, file).toMatch(/0\.5 x \(MAX_PASSES_IN_FLIGHT \+ 2\)/);
      expect(text, file).toMatch(/\(MAX_PASSES_IN_FLIGHT \+ 2\) x 512 MB \+ 256 MB/);
      // Every statement of it says the 256 MB: without it the rule holds the runs and not the worker.
      expect(text, file).not.toMatch(/\(MAX_PASSES_IN_FLIGHT \+ 2\) x 512 MB(?! \+ 256 MB)/);
      expect(text, file).not.toMatch(/\(MAX_PASSES_IN_FLIGHT \+ 1\) x 512 MB \+ 2,816 MB/);
      expect(text, file).toMatch(/MAX_PASSES_IN_FLIGHT \+ 2 runs at once/);
      expect(text, file).toMatch(/never more than (the host's|this machine's) CPU count/);
    }
  });

  it('refuses each way off it, on a copy', () => {
    const at = (find: string, replace: string): string => {
      expect(managed.includes(find), `${MANAGED} no longer holds ${find}`).toBe(true);
      return managed.replace(find, replace);
    };
    const cases: Array<[string, string, RegExp]> = [
      ['the profile put back', at('    container_name: ${COMPOSE_PROJECT_NAME}-worker\n', '    container_name: ${COMPOSE_PROJECT_NAME}-worker\n    profiles: ["jobs"]\n'), /profiles are \["jobs"\]/],
      ['the web waiting for it', at('    depends_on:\n      - api\n', '    depends_on:\n      - api\n      - worker\n'), /web depends on the worker/],
      ['a second network', at('      api:\n        condition: service_healthy\n    networks:\n      - ownpace-network\n', '      api:\n        condition: service_healthy\n    networks:\n      - ownpace-network\n      - trigger-event-store\n'), /networks are/],
      ['a port', at('    stop_grace_period: 60s\n', '    stop_grace_period: 60s\n    ports:\n      - "127.0.0.1:3002:3002"\n'), /publishes or exposes a port/],
      ['before the migrations', at('      api:\n        condition: service_healthy\n    networks:', '      api:\n        condition: service_started\n    networks:'), /does not wait for api/],
      ['the cpus off the rule', at('${WORKER_CPUS:-2.5}', '${WORKER_CPUS:-0.5}'), /cpus is \$\{WORKER_CPUS:-0.5\}/],
      ['the memory off the rule', at('${WORKER_MEMORY:-2816m}', '${WORKER_MEMORY:-3328m}'), /mem_limit is/],
      ["alpha.16's memory, before the limit", at('${WORKER_MEMORY:-2816m}', `\${WORKER_MEMORY:-${workerMemoryMbBeforeTheLimit(3)}m}`), /mem_limit is \$\{WORKER_MEMORY:-4864m\}/],
      ['the runs held and not the worker', at('${WORKER_MEMORY:-2816m}', '${WORKER_MEMORY:-2560m}'), /mem_limit is \$\{WORKER_MEMORY:-2560m\}/],
      ['the switch off by default', at('      OWNPACE_JOB_RUNNER: ${OWNPACE_JOB_RUNNER:-pg-boss}\n      NODE_ENV: production\n', '      OWNPACE_JOB_RUNNER: ${OWNPACE_JOB_RUNNER:-trigger}\n      NODE_ENV: production\n'), /the worker's OWNPACE_JOB_RUNNER/],
      ['no grace', at('    stop_grace_period: 60s\n', ''), /no stop_grace_period/],
    ];
    for (const [what, text, expected] of cases) expect(serviceProblems(text).join('\n'), what).toMatch(expected);
  });
});
