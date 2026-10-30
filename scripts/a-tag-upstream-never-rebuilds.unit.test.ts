// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TAG UPSTREAM NEVER REBUILDS (workplan 0119, 2026-10-30): the Docker
 * socket proxy ran an image as old as its release, and nothing could move it.
 *
 * managed.yml's trigger-docker-proxy, the HAProxy between the Trigger.dev
 * supervisor and the host's Docker socket, ran
 * `tecnativa/docker-socket-proxy:v0.5.0`. Docker Hub pushed that tag on
 * 2026-07-27 and never again: upstream builds a release once, from
 * `haproxy:3.4.2-alpine` as it was that day, and publishes nothing newer but
 * `master` and `nightly`, which are no release. The image scan of 2026-10-29
 * read 0 critical and 6 high findings in it, all 6 fixed in a newer Alpine
 * package, and the pin watch called it current, because by tag it was. A
 * digest move could not help, and a newer release did not exist.
 *
 * So `deploy/compose/docker-socket-proxy/` builds the same thing here:
 * upstream's Dockerfile at v0.5.0, with haproxy.cfg and docker-entrypoint.sh
 * beside it byte for byte, on the newest HAProxy of the line that release
 * chose (3.4), by tag and index digest. Its header says what changed (the
 * base, and one RUN that checks the two files by SHA-256) and how it moves.
 * This holds:
 *
 *  - THE DOCKERFILE IS UPSTREAM'S BUT FOR ITS BASE. One FROM, the official
 *    `haproxy:<x.y.z>-alpine` by index digest, on upstream's line; the release
 *    it was read at named above it (`# docker-socket-proxy v0.5.0`, which the
 *    pin watch compares with upstream's git tags); every other instruction
 *    line but the check upstream's, in upstream's order, by the SHA-256 of
 *    upstream's at the release; no parser directive, no ADD, no `--mount`,
 *    and no COPY but upstream's two;
 *  - THE NAME COVERS THE FILES. The image's name hashes the Dockerfile's
 *    instruction lines and nothing else (`builtTag`, as for the databases), and
 *    COPY reads files that hash never sees. So the check RUN names each copied
 *    file's SHA-256, which must be the file's in the directory: a file that
 *    changes fails here and in the build until the check moves, and the name
 *    with it. The directory holds the Dockerfile and those two files, and
 *    nothing else the builder could read; each is upstream's at the release,
 *    by its git blob id, and the entrypoint keeps its executable bit;
 *  - managed.yml runs it as `localhost/docker-socket-proxy:<builtTag>`, with
 *    `build: ./docker-socket-proxy` and `pull_policy: never`, no `user:`, the
 *    socket read-only, and an environment whose every key upstream's ENV
 *    declares: the interface is upstream's, unchanged. A name the Dockerfile
 *    moved past is one failure that prints the `sed` that moves it, and the
 *    `sed` is run here to show that it does;
 *  - images.yml's `build (docker-socket-proxy)` builds this directory under
 *    that name on a pull request, checks upstream's user, entrypoint and
 *    command, and starts it with managed.yml's environment and socket,
 *    word for word, so what it allows and refuses is what the stack's proxy
 *    allows and refuses;
 *  - Dependabot reads the directory in an entry of its own, which moves
 *    HAProxy's patches and digests and leaves its line alone: another line is
 *    the owner's call, taken with a release of docker-socket-proxy.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCounter, parse as parseYaml, parseDocument } from 'yaml';
import { builtTag, dockerfileBase, parseRef, readImages } from './idp-pin-watch.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CONTEXT = 'deploy/compose/docker-socket-proxy';
const DOCKERFILE = `${CONTEXT}/Dockerfile`;
const MANAGED = 'deploy/compose/managed.yml';
const IMAGES_WORKFLOW = '.github/workflows/images.yml';
const SERVICE = 'trigger-docker-proxy';
const NAME = 'localhost/docker-socket-proxy';

/**
 * Upstream at the release this is built from: github.com/Tecnativa/docker-socket-proxy
 * at the tag v0.5.0, read on 2026-10-30. A move to another release moves this
 * record with the files, after reading them.
 */
const UPSTREAM = {
  release: 'v0.5.0',
  commit: '2e118a0c0c66e1831f68b7afd6d49ad3e2f96b5d',
  /** Its Dockerfile's FROM, by tag alone: the HAProxy line it chose. */
  from: 'haproxy:3.4.2-alpine',
  /** The SHA-256 of its Dockerfile's instruction lines but the FROM, each with its newline, comments and blank lines left out. */
  instructions: '75f93565d799f3df0dc9abe546a99df2ba2e72c9f322ed62d8f0a8a43d6ddc4b',
  /** The files it copies, by their git blob ids at the tag (`git ls-tree v0.5.0`), where they go, and their mode there. */
  files: {
    'docker-entrypoint.sh': { blob: '2303cee20c41b4d2993a2bbc7f783ebaf65e37e4', target: '/usr/local/bin/docker-entrypoint.sh', executable: true },
    'haproxy.cfg': { blob: 'd61b1d4dd91d822a074f6dc5e6944ea5681ae0ae', target: '/usr/local/etc/haproxy/haproxy.cfg.template', executable: false },
  },
} as const;
type FileName = keyof typeof UPSTREAM.files;
const FILES = Object.keys(UPSTREAM.files) as FileName[];

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
/** git's id for a file's content: `git hash-object`. */
const gitBlob = (data: Buffer) => createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
const isInstruction = (line: string) => !/^\s*(#|$)/.test(line);

/** The HAProxy line of a tag (`3.4` of `3.4.2-alpine`), or null. */
const lineOf = (tag: string) => /^(\d+\.\d+)\.\d+-alpine$/.exec(tag)?.[1] ?? null;

/**
 * The check RUN: its physical lines, and the files it names with their
 * SHA-256s. The one RUN that pipes into `sha256sum -c -`.
 */
function checkRun(text: string): { lines: string[]; named: Array<{ hash: string; path: string }>; executable: boolean } | null {
  const lines = text.split('\n');
  const starts = lines.flatMap((line, i) => (/^RUN\s/.test(line) ? [i] : []));
  for (const start of starts) {
    let end = start;
    while (end < lines.length - 1 && /\\\s*$/.test(lines[end]!)) end += 1;
    const block = lines.slice(start, end + 1);
    const joined = block.join('\n');
    if (!/\|\s*sha256sum -c -/.test(joined)) continue;
    const named = [...joined.matchAll(/\b([0-9a-f]{64})\s+(\/\S+)/g)].map((m) => ({ hash: m[1]!, path: m[2]! }));
    return { lines: block, named, executable: /&&\s*test -x \/usr\/local\/bin\/docker-entrypoint\.sh\s*$/.test(joined) };
  }
  return null;
}

/** What is wrong with the Dockerfile, given the files beside it; empty when it holds. */
function dockerfileProblems(text: string, files: Readonly<Record<string, Buffer>>): string[] {
  const problems: string[] = [];
  let base: ReturnType<typeof dockerfileBase> | null = null;
  try {
    base = dockerfileBase(text);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const upstreamLine = lineOf(parseRef(UPSTREAM.from).tag);
  if (base) {
    if (base.repo !== 'haproxy') problems.push(`it builds on ${base.repo}, not the official haproxy image upstream builds on`);
    const line = lineOf(base.tag);
    if (!line) problems.push(`its base is ${base.tag}, not an exact HAProxy release on Alpine (\`3.4.7-alpine\`), as upstream's is`);
    else if (line !== upstreamLine) {
      problems.push(`its base is HAProxy ${line}, and ${UPSTREAM.release} chose ${upstreamLine}: another line is the owner's call, taken with a release of docker-socket-proxy`);
    }
  }
  const releases = [...text.matchAll(/^# docker-socket-proxy (\S+)$/gm)].map((m) => m[1]);
  if (releases.length !== 1 || releases[0] !== UPSTREAM.release) {
    problems.push(`it names ${JSON.stringify(releases)} as its docker-socket-proxy release, not "# docker-socket-proxy ${UPSTREAM.release}" once: the pin watch reads that line`);
  } else if (text.indexOf(`# docker-socket-proxy ${UPSTREAM.release}`) > text.search(/^FROM\s/m)) {
    problems.push('its release line comes after the FROM');
  }
  // The name hashes the instruction lines and nothing else (builtTag): what else the builder reads must not change the build.
  for (const line of text.split('\n')) {
    if (!/^\s*#\s*[a-z][a-z0-9]*\s*=/i.test(line)) break;
    problems.push(`\`${line}\` is a parser directive: it changes the build, and the image's name skips it as a comment. Remove it`);
  }
  const instructions = text.split('\n').filter(isInstruction);
  const upstreamCopies = FILES.map((f) => `COPY ${f} ${dirname(UPSTREAM.files[f].target)}${f === 'docker-entrypoint.sh' ? '/' : `/${UPSTREAM.files[f].target.split('/').at(-1)}`}`);
  for (const line of instructions) {
    if ((/^(COPY|ADD)\s/i.test(line) && !upstreamCopies.includes(line)) || /--mount\b/i.test(line)) {
      problems.push(`\`${line}\` reads files or an image that neither the image's name nor the check covers. Upstream's two COPY lines are the only ones`);
    }
  }
  // The check: each copied file by the SHA-256 it has here, and the entrypoint executable.
  const check = checkRun(text);
  if (!check) {
    problems.push('no RUN that checks the copied files with `sha256sum -c -`: the name would not change when they do');
  } else {
    const want = FILES.map((f) => ({ hash: files[f] ? sha256(files[f]) : '(missing)', path: UPSTREAM.files[f].target }));
    if (JSON.stringify(check.named) !== JSON.stringify(want)) {
      problems.push(
        `the check names ${check.named.map((n) => `${n.path} ${n.hash}`).join(', ') || 'nothing'}, and the files here are ${want.map((n) => `${n.path} ${n.hash}`).join(', ')}: ` +
          'move the check with the files, and the name moves with it',
      );
    }
    if (!check.executable) problems.push('the check does not end in `&& test -x /usr/local/bin/docker-entrypoint.sh`: an entrypoint without its executable bit would build');
  }
  // Every other instruction line is upstream's, in its order.
  const checkLines = new Set(check?.lines ?? []);
  const rest = instructions.filter((line) => !/^FROM\s/i.test(line) && !checkLines.has(line));
  const restHash = sha256(rest.map((line) => `${line}\n`).join(''));
  if (restHash !== UPSTREAM.instructions) {
    problems.push(
      `its instructions but the FROM and the check are not upstream's at ${UPSTREAM.release} (SHA-256 ${restHash}, upstream's ${UPSTREAM.instructions}): ` +
        "the header says the base is all that changed. Write upstream's lines back, or move to a release by its header's route",
    );
  }
  return problems;
}

/** What is wrong with the directory's files; empty when it holds. */
function contextProblems(names: readonly string[], files: Readonly<Record<string, Buffer>>, executable: (name: string) => boolean): string[] {
  const problems: string[] = [];
  const want = ['Dockerfile', ...FILES].sort();
  if (JSON.stringify([...names].sort()) !== JSON.stringify(want)) {
    problems.push(`${CONTEXT} holds ${JSON.stringify([...names].sort())}, not ${JSON.stringify(want)}: the builder could read a file the name does not cover`);
  }
  for (const f of FILES) {
    const data = files[f];
    if (!data) continue;
    const blob = gitBlob(data);
    if (blob !== UPSTREAM.files[f].blob) {
      problems.push(`${CONTEXT}/${f} is git blob ${blob}, and upstream's at ${UPSTREAM.release} is ${UPSTREAM.files[f].blob}: it is upstream's file byte for byte, or a release move`);
    }
    if (executable(f) !== UPSTREAM.files[f].executable) {
      problems.push(`${CONTEXT}/${f} is ${executable(f) ? '' : 'not '}executable, and upstream's is ${UPSTREAM.files[f].executable ? '' : 'not '}(COPY keeps the mode)`);
    }
  }
  return problems;
}

interface Service {
  image?: string;
  build?: string | { context?: string };
  pull_policy?: string;
  user?: string | number;
  environment?: Record<string, string | number | boolean | null> | string[];
  volumes?: string[];
}

const servicesOf = (text: string) => (parseYaml(text) as { services: Record<string, Service> }).services;

/** A service's environment as KEY=VALUE strings, sorted. */
function environment(svc: Service): string[] {
  const env = svc.environment ?? {};
  const pairs = Array.isArray(env) ? env : Object.entries(env).map(([k, v]) => `${k}=${String(v)}`);
  return [...pairs].sort();
}

/** The names upstream's ENV declares: the interface. */
function declared(dockerfile: string): Set<string> {
  const env = /^ENV\s+((?:.*\\\n)*.*)$/m.exec(dockerfile)?.[1] ?? '';
  return new Set([...env.matchAll(/([A-Z_][A-Z0-9_]*)=/g)].map((m) => m[1]!));
}

const escapeForSed = (s: string) => s.replace(/[.[\]\\*^$#]/g, '\\$&');

/** What is wrong with managed.yml's proxy; empty when it holds. */
function composeProblems(managed: string, dockerfile: string): string[] {
  const problems: string[] = [];
  const want = `${NAME}:${builtTag(dockerfile)}`;
  const services = servicesOf(managed);
  const svc = services[SERVICE];
  if (!svc) return [`${MANAGED} has no ${SERVICE}`];
  for (const [name, other] of Object.entries(services)) {
    const repo = other.image ? parseRef(other.image).repo : '';
    if (repo === 'tecnativa/docker-socket-proxy') problems.push(`${MANAGED}:${name} runs ${other.image}, upstream's image as it was built in July: run ${want}, built from ./docker-socket-proxy`);
    else if (repo === NAME && name !== SERVICE) problems.push(`${MANAGED}:${name} runs the proxy's build too, which only ${SERVICE} may`);
  }
  if (svc.image !== want) {
    if (svc.image && parseRef(svc.image).repo === NAME) {
      const lineCounter = new LineCounter();
      const node = parseDocument(managed, { lineCounter }).getIn(['services', SERVICE, 'image'], true) as { range?: [number, number, number] } | undefined;
      const line = node?.range ? lineCounter.linePos(node.range[0]).line : 0;
      problems.push(
        [
          `${DOCKERFILE}'s instructions changed, so the image it builds is named ${want} now, and ${MANAGED}:${line} (${SERVICE}) still gives ${svc.image}.`,
          'Compose builds an image only where its name is missing, so under the old name every stack that has it keeps running the old build. Move the line, from the repository root:',
          `  sed -i -e 's#${escapeForSed(svc.image)}#${want}#' ${MANAGED}`,
          'Nothing else names it: the image scan, the pin watch and images.yml read managed.yml and the Dockerfile.',
          "The twelve hex digits are the SHA-256 of the Dockerfile's instruction lines, comments and blank lines left out:",
          `  grep -Ev '^[[:space:]]*(#|$)' ${DOCKERFILE} | sha256sum | cut -c1-12`,
        ].join('\n'),
      );
    } else {
      problems.push(`${SERVICE} runs ${String(svc.image)}, not ${want}, built from ./docker-socket-proxy`);
    }
  }
  if (svc.build !== './docker-socket-proxy') {
    problems.push(`${SERVICE}'s build: is ${JSON.stringify(svc.build)}, not the bare \`./docker-socket-proxy\`: args, a target or a Dockerfile of its own are inputs the name does not carry`);
  }
  if (svc.pull_policy !== 'never') problems.push(`${SERVICE} has pull_policy ${String(svc.pull_policy)}, not never: no registry serves ${want}`);
  if (svc.user !== undefined) problems.push(`${SERVICE} sets user: ${String(svc.user)}; upstream's image runs as root, and its entrypoint writes /tmp/haproxy.cfg as that user`);
  const names = declared(dockerfile);
  for (const pair of environment(svc)) {
    const key = pair.split('=')[0]!;
    if (!names.has(key)) problems.push(`${SERVICE} sets ${key}, which upstream's ENV does not declare: the interface is upstream's, unchanged`);
  }
  if (JSON.stringify(svc.volumes ?? []) !== JSON.stringify(['/var/run/docker.sock:/var/run/docker.sock:ro'])) {
    problems.push(`${SERVICE}'s volumes are ${JSON.stringify(svc.volumes ?? [])}, not the socket alone, read-only`);
  }
  return problems;
}

interface Step {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  if?: string;
  permissions?: Record<string, string>;
  steps: Step[];
}

/** What is wrong with images.yml's build of the proxy; empty when it holds. */
function workflowProblems(workflow: string, managed: string, dockerfile: string): string[] {
  const problems: string[] = [];
  const job = (parseYaml(workflow) as { jobs: Record<string, Job> }).jobs['socket-proxy'];
  if (!job) return ['images.yml has no socket-proxy job: nothing builds the proxy before E2E (managed)'];
  if (job.name !== 'build (docker-socket-proxy)') problems.push(`its name is ${String(job.name)}, not build (docker-socket-proxy), which every-pr-check-is-classified names`);
  if (job.if !== "github.event_name == 'pull_request'") problems.push(`it runs ${String(job.if)}, not on a pull request only`);
  if (JSON.stringify(job.permissions) !== JSON.stringify({ contents: 'read' })) problems.push(`its permissions are ${JSON.stringify(job.permissions)}, not contents: read`);
  const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
  if (checkout?.with?.['persist-credentials'] !== false) problems.push('its checkout keeps a credential');
  const run = job.steps.find((s) => s.run?.includes('docker build'))?.run ?? '';
  if (!/^set -euo pipefail$/m.test(run)) problems.push('its script does not start with set -euo pipefail');
  if (!run.includes(`docker build --pull --progress=plain --tag "$ref" ${CONTEXT}\n`)) problems.push(`it does not build ${CONTEXT} under the name it read`);
  if (!run.includes(`\\(${NAME.replace('/', '\\/')}:[^[:space:]]*\\)`)) problems.push(`it does not read the name from managed.yml's ${NAME} line`);
  // managed.yml's environment and socket, word for word.
  const svc = servicesOf(managed)[SERVICE];
  const flags = [...run.matchAll(/-e ([A-Z_][A-Z0-9_]*=\S+)/g)].map((m) => m[1]!).sort();
  if (svc && JSON.stringify(flags) !== JSON.stringify(environment(svc))) {
    problems.push(`it starts the proxy with ${JSON.stringify(flags)}, and ${MANAGED} gives ${SERVICE} ${JSON.stringify(environment(svc))}: the two move together`);
  }
  const mounts = [...run.matchAll(/-v (\S+)/g)].map((m) => m[1]!);
  if (svc && JSON.stringify(mounts) !== JSON.stringify(svc.volumes ?? [])) problems.push(`it mounts ${JSON.stringify(mounts)}, and ${SERVICE} mounts ${JSON.stringify(svc.volumes ?? [])}`);
  // Upstream's user, entrypoint and command, as the Dockerfile writes the two it sets.
  const user = [...dockerfile.matchAll(/^USER\s+(\S+)\s*$/gm)].map((m) => m[1]).at(-1);
  const cmd = /^CMD\s+(\[.*\])\s*$/m.exec(dockerfile)?.[1];
  const want = `"${String(user)}" ["docker-entrypoint.sh"] ${cmd ? JSON.stringify(JSON.parse(cmd)) : 'none'}`;
  if (!run.includes(`want='${want}'`)) problems.push(`it does not check the built image runs ${want} (user, entrypoint, command)`);
  // A probe for every part of the API managed.yml switches on, and the refusals the header names.
  const probes = (from: number, to: number) => [...run.slice(from, to).matchAll(/"(GET|POST) (\/[^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`);
  const allowedAt = run.indexOf('for probe in');
  const refusedAt = run.indexOf('for probe in', allowedAt + 1);
  const allowed = probes(allowedAt, refusedAt);
  const refused = probes(refusedAt, run.length);
  for (const [key, path] of [['CONTAINERS', '/containers/'], ['IMAGES', '/images/'], ['NETWORKS', '/networks'], ['VOLUMES', '/volumes']] as const) {
    if (svc && environment(svc).includes(`${key}=1`) && !allowed.some((p) => p.startsWith(`GET ${path}`))) problems.push(`no GET of ${path} among the probes Docker must answer, and ${SERVICE} sets ${key}=1`);
  }
  if (svc && environment(svc).includes('POST=1') && !allowed.some((p) => p.startsWith('POST '))) problems.push(`no POST among the probes Docker must answer, and ${SERVICE} sets POST=1`);
  for (const path of ['/exec/', '/build', '/info', '/swarm', '/secrets', '/system/']) {
    if (!refused.some((p) => p.split(' ')[1]!.startsWith(path))) problems.push(`no probe of ${path} among those the proxy must refuse`);
  }
  if (!run.includes('[ "$code" != 403 ]') || !run.includes('[ "$code" = 403 ] || [ "$code" = 000 ]')) problems.push('it does not hold the refusals to 403 and the rest to an answer from Docker');
  return problems;
}

const contextNames = () => readdirSync(join(REPO_ROOT, CONTEXT));
const contextFiles = (): Record<string, Buffer> => Object.fromEntries(FILES.map((f) => [f, readFileSync(join(REPO_ROOT, CONTEXT, f))]));
const executable = (f: string) => (statSync(join(REPO_ROOT, CONTEXT, f)).mode & 0o111) !== 0;

describe('the Docker socket proxy is upstream\'s release, built here on a current HAProxy of its line', () => {
  const dockerfile = read(DOCKERFILE);

  it("the Dockerfile is upstream's v0.5.0 but for its base and the check", () => {
    expect(dockerfileProblems(dockerfile, contextFiles())).toEqual([]);
  });

  it("the directory holds upstream's two files byte for byte, and nothing else", () => {
    expect(contextProblems(contextNames(), contextFiles(), executable)).toEqual([]);
  });

  it('refuses each way the Dockerfile could drift from upstream or from its name', () => {
    const files = contextFiles();
    const swap = (from: RegExp | string, to: string) => {
      const text = dockerfile.replace(from, to);
      expect(text, `${String(from)} matched nothing`).not.toBe(dockerfile);
      return dockerfileProblems(text, files);
    };
    const from = dockerfileBase(dockerfile);
    // Another line, another image, a tag without a digest.
    expect(swap(/^FROM haproxy:\d+\.\d+\./m, 'FROM haproxy:3.2.')).toEqual([expect.stringContaining("another line is the owner's call")]);
    expect(swap(/^FROM haproxy:/m, 'FROM nginx:')).toEqual([expect.stringContaining('not the official haproxy image')]);
    expect(swap(/^FROM haproxy:(\S+)-alpine@/m, 'FROM haproxy:$1@')).toEqual([expect.stringContaining('not an exact HAProxy release on Alpine')]);
    expect(swap(from.ref, `haproxy:${from.tag}`)).toEqual([expect.stringContaining('carries no tag and digest')]);
    // The release line, gone or another.
    expect(swap(/^# docker-socket-proxy v[\d.]+\n/m, '')).toEqual([expect.stringContaining('as its docker-socket-proxy release')]);
    expect(swap(/^# docker-socket-proxy v[\d.]+$/m, '# docker-socket-proxy v0.4.2')).toEqual([expect.stringContaining('as its docker-socket-proxy release')]);
    // An upstream instruction changed: a default switched on, the user dropped.
    expect(swap(/^ {4}EXEC=0 \\$/m, '    EXEC=1 \\')).toEqual([expect.stringContaining("not upstream's at v0.5.0")]);
    expect(swap(/^USER root\n/m, '')).toEqual([expect.stringContaining("not upstream's at v0.5.0")]);
    // What the builder reads that neither the name nor the check covers.
    expect(dockerfileProblems(`# syntax=docker/dockerfile:1\n${dockerfile}`, files)).toEqual([expect.stringContaining('is a parser directive')]);
    for (const line of ['COPY extra.cfg /usr/local/etc/haproxy/', 'ADD https://example.org/x.cfg /tmp/', 'RUN --mount=type=bind,target=/src true']) {
      expect(dockerfileProblems(dockerfile.replace(/^(USER root)$/m, `${line}\n$1`), files), line).toEqual([
        expect.stringContaining(`\`${line}\` reads files or an image`),
        expect.stringContaining("not upstream's at v0.5.0"),
      ]);
    }
    // A copied file changed without the check: the name would not move.
    const edited = { ...files, 'haproxy.cfg': Buffer.concat([files['haproxy.cfg']!, Buffer.from('# one more line\n')]) };
    expect(dockerfileProblems(dockerfile, edited)).toEqual([expect.stringContaining('move the check with the files')]);
    // The check gone, or without the executable bit's test.
    const check = checkRun(dockerfile)!;
    expect(check.named.map((n) => n.path)).toEqual(FILES.map((f) => UPSTREAM.files[f].target));
    expect(swap(check.lines.join('\n') + '\n', '')).toEqual([expect.stringContaining('no RUN that checks the copied files')]);
    expect(swap(/ \\\n\s*&& test -x \/usr\/local\/bin\/docker-entrypoint\.sh$/m, '')).toEqual([expect.stringContaining('test -x')]);
  });

  it("refuses a file that is not upstream's, a lost executable bit, and anything else in the directory", () => {
    const files = contextFiles();
    const changed = { ...files, 'docker-entrypoint.sh': Buffer.from(files['docker-entrypoint.sh']!.toString().replace('set -e', 'set -eu')) };
    expect(contextProblems(contextNames(), changed, executable)).toEqual([expect.stringContaining('docker-entrypoint.sh is git blob')]);
    expect(contextProblems(contextNames(), files, () => false)).toEqual([expect.stringContaining('docker-entrypoint.sh is not executable')]);
    expect(contextProblems([...contextNames(), '.dockerignore'], files, executable)).toEqual([expect.stringContaining('the builder could read a file')]);
  });
});

describe("managed.yml runs that build, by the name its instructions give it, with upstream's interface", () => {
  const dockerfile = read(DOCKERFILE);
  const managed = read(MANAGED);

  it('runs it as localhost/docker-socket-proxy:<builtTag>, built here and never pulled', () => {
    expect(composeProblems(managed, dockerfile)).toEqual([]);
    const proxy = readImages(managed).filter((i) => i.repo === NAME);
    expect(proxy.map((i) => i.tag)).toEqual([builtTag(dockerfile)]);
  });

  it('prints the sed that moves a name the Dockerfile moved past, and the sed moves it', () => {
    const edited = dockerfile.replace(/^RUN touch \/var\/lib\/haproxy\/server-state$/m, 'RUN touch /var/lib/haproxy/server-state && true');
    expect(edited).not.toBe(dockerfile);
    const problems = composeProblems(managed, edited);
    expect(problems).toHaveLength(1);
    const sed = /^ {2}(sed -i -e '[^']+') deploy\/compose\/managed\.yml$/m.exec(problems[0]!)?.[1];
    expect(sed, problems[0]).toBeDefined();
    expect(problems[0]).toMatch(new RegExp(`deploy/compose/managed\\.yml:\\d+ \\(${SERVICE}\\)`));
    const dir = mkdtempSync(join(tmpdir(), 'socket-proxy-name-'));
    try {
      const file = join(dir, 'managed.yml');
      writeFileSync(file, managed);
      const args = sed!.replace(/^sed -i -e '/, '').replace(/'$/, '');
      const ran = spawnSync('sed', ['-i', '-e', args, file], { encoding: 'utf8' });
      expect(ran.status, ran.stderr).toBe(0);
      const moved = readFileSync(file, 'utf8');
      expect(composeProblems(moved, edited)).toEqual([]);
      const changed = moved.split('\n').filter((line, i) => line !== managed.split('\n')[i]);
      expect(changed).toEqual([`    image: ${NAME}:${builtTag(edited)}`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses upstream's July image back, another build, a pull, a user, a key upstream does not declare, and more than the socket", () => {
    const swap = (from: RegExp, to: string) => {
      const text = managed.replace(from, to);
      expect(text, `${String(from)} matched nothing`).not.toBe(managed);
      return composeProblems(text, dockerfile);
    };
    const image = /^(\s*image:\s*)localhost\/docker-socket-proxy:\S+$/m;
    expect(swap(image, '$1tecnativa/docker-socket-proxy:v0.5.0')).toEqual([
      expect.stringContaining("upstream's image as it was built in July"),
      expect.stringContaining('not localhost/docker-socket-proxy:'),
    ]);
    expect(swap(/^(\s*)build: \.\/docker-socket-proxy$/m, '$1build:\n$1  context: ./docker-socket-proxy')).toEqual([expect.stringContaining('not the bare `./docker-socket-proxy`')]);
    expect(swap(/^(\s*build: \.\/docker-socket-proxy\n)\s*pull_policy: never\n/m, '$1')).toEqual([expect.stringContaining('not never')]);
    expect(swap(/^(\s*build: \.\/docker-socket-proxy\n)/m, '$1    user: "1000"\n')).toEqual([expect.stringContaining('sets user: 1000')]);
    expect(swap(/^(\s*)POST: 1$/m, '$1POST: 1\n$1BIND_ADDRESS: "0.0.0.0"')).toEqual([expect.stringContaining('sets BIND_ADDRESS, which upstream')]);
    expect(swap(/\/var\/run\/docker\.sock:\/var\/run\/docker\.sock:ro/, '/var/run/docker.sock:/var/run/docker.sock')).toEqual([expect.stringContaining('not the socket alone, read-only')]);
  });
});

describe("images.yml builds it on a pull request and asks it what the stack's proxy allows and refuses", () => {
  const workflow = read(IMAGES_WORKFLOW);
  const managed = read(MANAGED);
  const dockerfile = read(DOCKERFILE);

  it("builds this directory under managed.yml's name and starts it with managed.yml's environment and socket", () => {
    expect(workflowProblems(workflow, managed, dockerfile)).toEqual([]);
  });

  it('refuses a job that drifted from managed.yml, or stopped asking', () => {
    const swapped = (text: string, from: RegExp | string, to: string) => {
      const out = text.replace(from, to);
      expect(out, `${String(from)} matched nothing`).not.toBe(text);
      return out;
    };
    // managed.yml switches exec on and the job does not follow.
    expect(workflowProblems(workflow, swapped(managed, /^(\s*)POST: 1$/m, '$1POST: 1\n$1EXEC: 1'), dockerfile)).toEqual([expect.stringContaining('the two move together')]);
    expect(workflowProblems(swapped(workflow, ' -e VOLUMES=1', ''), managed, dockerfile)).toEqual([expect.stringContaining('the two move together')]);
    expect(workflowProblems(swapped(workflow, ' "GET /volumes" \\', ' \\'), managed, dockerfile)).toEqual([expect.stringContaining('no GET of /volumes')]);
    expect(workflowProblems(swapped(workflow, /"POST \/containers\/socket-proxy-probe-none\/stop" "POST \/networks\/socket-proxy-probe-none\/connect"/, '"GET /_ping"'), managed, dockerfile)).toEqual([
      expect.stringContaining('no POST among the probes'),
    ]);
    expect(workflowProblems(swapped(workflow, '/var/run/docker.sock:/var/run/docker.sock:ro \\', '/var/run/docker.sock:/var/run/docker.sock \\'), managed, dockerfile)).toEqual([
      expect.stringContaining('it mounts'),
    ]);
    expect(workflowProblems(swapped(workflow, `--tag "$ref" ${CONTEXT}\n`, '--tag "$ref" deploy/compose/postgres\n'), managed, dockerfile)).toEqual([
      expect.stringContaining(`does not build ${CONTEXT}`),
    ]);
    expect(workflowProblems(swapped(workflow, '"GET /exec/socket-proxy-probe-none/json" "POST /exec/socket-proxy-probe-none/start" \\', '\\'), managed, dockerfile)).toEqual([
      expect.stringContaining('no probe of /exec/'),
    ]);
    expect(workflowProblems(swapped(workflow, '[ "$code" != 403 ]', '[ "$code" = 000 ]'), managed, dockerfile)).toEqual([expect.stringContaining('hold the refusals to 403')]);
    expect(workflowProblems(swapped(workflow, "want='\"root\"", "want='\"haproxy\""), managed, dockerfile)).toEqual([expect.stringContaining('does not check the built image runs')]);
    expect(workflowProblems(swapped(workflow, 'name: build (docker-socket-proxy)', 'name: build (proxy)'), managed, dockerfile)).toEqual([expect.stringContaining('every-pr-check-is-classified')]);
  });
});

describe('Dependabot moves its base within its line, in a pull request of its own', () => {
  it('reads the directory alone, and leaves a new HAProxy line to the owner', () => {
    type Update = {
      'package-ecosystem': string;
      directory?: string;
      directories?: string[];
      ignore?: Array<{ 'dependency-name': string; 'update-types'?: string[] }>;
    };
    const updates = (parseYaml(read('.github/dependabot.yml')) as { updates: Update[] }).updates;
    const entries = updates.filter((u) => [...(u.directories ?? []), ...(u.directory ? [u.directory] : [])].includes(`/${CONTEXT}`));
    expect(entries, 'one Dependabot entry reads the directory').toHaveLength(1);
    const [entry] = entries;
    expect(entry!['package-ecosystem']).toBe('docker');
    expect(entry!.directories, 'an entry of its own: a shared one groups the apps, whose checks never build this').toBeUndefined();
    expect(entry!.ignore).toEqual([{ 'dependency-name': 'haproxy', 'update-types': ['version-update:semver-major', 'version-update:semver-minor'] }]);
  });
});
