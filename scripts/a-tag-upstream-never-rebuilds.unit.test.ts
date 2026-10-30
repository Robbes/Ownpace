// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TAG UPSTREAM NEVER REBUILDS (workplan 0119, 2026-10-30): the Docker
 * socket proxy ran an image as old as its release, and nothing could move it.
 *
 * managed.yml's trigger-docker-proxy, the HAProxy between the Trigger.dev
 * supervisor and the host's Docker socket, ran
 * `tecnativa/docker-socket-proxy:v0.5.0`. Docker Hub pushed that tag on
 * 2026-07-27 and never again: upstream builds a release once, from
 * `haproxy:3.4.2-alpine` as it was that day, and publishes no newer release:
 * besides `latest`, which is v0.5.0 itself, only `master`, `nightly` and
 * builds of upstream's pull requests. The image scan of 2026-10-29
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
 *    allows and refuses. What it asks is read from upstream's own rules
 *    (haproxy.cfg's allow lines, the ENV's defaults, managed.yml's values):
 *    a request Docker must answer for every switch managed.yml turns on, and
 *    one the proxy must refuse for every switch left off that no switch
 *    turned on covers. And the job's verdict is the probes': its step is run
 *    here against a stub docker and curl, every probe answered as it should
 *    and then each answered wrongly in turn (the proxy's own 403 or 503
 *    where Docker must answer, Docker's answer where the proxy must refuse,
 *    nothing at all), and it must pass the first and fail each of the rest,
 *    naming the probe. Docker's answer is told from HAProxy's by the
 *    Api-Version header Docker sets on every response;
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
const HAPROXY_CFG = `${CONTEXT}/haproxy.cfg`;
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
function workflowProblems(workflow: string, managed: string, dockerfile: string, cfg: string): string[] {
  const problems: string[] = [];
  const job = (parseYaml(workflow) as { jobs: Record<string, Job> }).jobs['socket-proxy'];
  if (!job) return ['images.yml has no socket-proxy job: nothing builds the proxy before E2E (managed)'];
  if (job.name !== 'build (docker-socket-proxy)') problems.push(`its name is ${String(job.name)}, not build (docker-socket-proxy), which every-pr-check-is-classified names`);
  if (job.if !== "github.event_name == 'pull_request'") problems.push(`it runs ${String(job.if)}, not on a pull request only`);
  if (JSON.stringify(job.permissions) !== JSON.stringify({ contents: 'read' })) problems.push(`its permissions are ${JSON.stringify(job.permissions)}, not contents: read`);
  const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
  if (checkout?.with?.['persist-credentials'] !== false) problems.push('its checkout keeps a credential');
  const run = stepOf(workflow);
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
  // The verdict is the probes': the step ends in it, and nothing before it exits but to fail.
  const commands = run.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (commands.at(-1) !== 'exit "$failed"') problems.push(`its last command is \`${String(commands.at(-1))}\`, not \`exit "$failed"\`: the job's verdict would not be the probes'`);
  for (const line of commands.slice(0, -1)) {
    if (/(^|[\s;&|(])exit\b/.test(line) && !/(^|[\s;&|(])exit 1$/.test(line)) problems.push(`\`${line}\` exits before the probes' verdict, and not to fail`);
  }
  // What it asks, read from upstream's own rules under managed.yml's environment.
  const { allowed, refused } = probesOf(run);
  if (!svc) return problems;
  const rules = switchesOf(cfg);
  const allowLines = cfg.split('\n').filter((line) => /^\s*http-request allow\b/.test(line)).length;
  if (!rules.length || rules.length !== allowLines) problems.push(`read ${rules.length} of ${HAPROXY_CFG}'s ${allowLines} allow rules: the rest are written another way, and what the proxy allows cannot be read from them`);
  const set = new Map(environment(svc).map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]));
  const defaults = defaultsOf(dockerfile);
  const value = (key: string) => set.get(key) ?? defaults.get(key) ?? '0';
  for (const key of new Set([...rules.map((r) => r.key), 'POST'])) {
    if (!['0', '1'].includes(value(key))) problems.push(`${SERVICE}'s ${key} is ${value(key)}, and a switch here is 0 or 1`);
  }
  const on = rules.filter((r) => value(r.key) === '1');
  const passes = (probe: string) => {
    const [method, path] = probe.split(' ') as [string, string];
    return (method === 'GET' || value('POST') === '1') && on.some((r) => r.pattern.test(path));
  };
  for (const rule of rules.filter((r) => set.get(r.key) === '1')) {
    if (!allowed.some((p) => rule.pattern.test(p.split(' ')[1]!))) problems.push(`no probe Docker must answer for ${rule.key}, which ${SERVICE} sets to 1 (${rule.source})`);
  }
  if (value('POST') === '1' && !allowed.some((p) => p.startsWith('POST '))) problems.push(`no POST among the probes Docker must answer, and ${SERVICE} sets POST=1`);
  for (const probe of allowed.filter((p) => !passes(p))) problems.push(`${probe} is among the probes Docker must answer, and under ${SERVICE}'s environment upstream's rules refuse it`);
  // A switch left off is refused unless one turned on opens its paths too (the ALLOW_* actions under /containers).
  const covered = (rule: Switch) => on.some((r) => rule.source.startsWith(r.source));
  for (const rule of rules.filter((r) => value(r.key) !== '1' && !covered(r))) {
    if (!refused.some((p) => rule.pattern.test(p.split(' ')[1]!) && !passes(p))) {
      problems.push(`no probe the proxy must refuse for ${rule.key}, which upstream's ENV leaves at ${defaults.get(rule.key) ?? '(unset)'} and ${SERVICE} does not turn on (${rule.source})`);
    }
  }
  for (const probe of refused.filter(passes)) problems.push(`${probe} is among the probes the proxy must refuse, and under ${SERVICE}'s environment upstream's rules allow it`);
  return problems;
}

/** The step that builds and asks the proxy. */
const stepOf = (workflow: string) => (parseYaml(workflow) as { jobs: Record<string, Job> }).jobs['socket-proxy']?.steps.find((s) => s.run?.includes('docker build'))?.run ?? '';

/** The step's two lists of probes, `METHOD /path` each: those Docker must answer, then those the proxy must refuse. */
function probesOf(run: string): { allowed: string[]; refused: string[] } {
  const probes = (from: number, to: number) => (from < 0 ? [] : [...run.slice(from, to).matchAll(/"(GET|POST) (\/[^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`));
  const allowedAt = run.indexOf('for probe in');
  const refusedAt = allowedAt < 0 ? -1 : run.indexOf('for probe in', allowedAt + 1);
  return { allowed: probes(allowedAt, refusedAt < 0 ? run.length : refusedAt), refused: probes(refusedAt, run.length) };
}

interface Switch {
  key: string;
  /** The path expression of its allow rule, as haproxy.cfg writes it. */
  source: string;
  pattern: RegExp;
}

/** upstream's haproxy.cfg: each endpoint switch, and the paths its allow rule opens when the switch is on. */
function switchesOf(cfg: string): Switch[] {
  return [...cfg.matchAll(/^\s*http-request allow if \{ path,url_dec -m reg -i (\S+) \} \{ env\(([A-Z_][A-Z0-9_]*)\) -m bool \}\s*$/gm)].map((m) => ({
    key: m[2]!,
    source: m[1]!,
    pattern: new RegExp(m[1]!, 'i'),
  }));
}

/** The value upstream's ENV gives each name it declares. */
function defaultsOf(dockerfile: string): Map<string, string> {
  const env = /^ENV\s+((?:.*\\\n)*.*)$/m.exec(dockerfile)?.[1] ?? '';
  return new Map([...env.matchAll(/([A-Z_][A-Z0-9_]*)=(\S*)/g)].map((m) => [m[1]!, m[2]!]));
}

/**
 * The stubs the step runs against, as shell functions ahead of it, so that a
 * run forks and never starts another program for them. `docker`: the build
 * and the run succeed, the image runs `$CONFIG` (user, entrypoint, command),
 * and every call is logged. `curl`: the readiness check (`-f`) succeeds, and
 * a probe's `-w` is written with the status and Api-Version that `$ANSWERS`
 * gives its `METHOD /path` (a tab, then `<status> <version>`, the version
 * empty where HAProxy answered itself); a request it has no answer for
 * answers nothing, as curl does when nothing listens. `sleep` returns.
 */
const STUBS = `docker() {
  printf '%s\\n' "$*" >> "$DOCKER_LOG"
  case "$1" in
    build) return 0 ;;
    run) echo 0123456789ab ;;
    image) case "\${4:-}" in *.Config.User*) printf '%s\\n' "$CONFIG" ;; *) echo "linux/amd64 sha256:stub" ;; esac ;;
    *) echo "unexpected: docker $*" >&2; return 3 ;;
  esac
}
curl() {
  local method=GET format= fail=0 url= path answer key value code version out
  while [ $# -gt 0 ]; do
    case "$1" in
      -X|--request) method="$2"; shift 2 ;;
      -w|--write-out) format="$2"; shift 2 ;;
      -o|--output|-m|--max-time|-H|--header|-D|--dump-header) shift 2 ;;
      --*) shift ;;
      -*) case "$1" in *f*) fail=1 ;; esac; shift ;;
      *) url="$1"; shift ;;
    esac
  done
  if [ "$fail" = 1 ]; then return 0; fi
  path="\${url#http://127.0.0.1:2375}"
  answer="000 "
  while IFS=$'\\t' read -r key value; do
    if [ "$key" = "$method $path" ]; then answer="$value"; fi
  done < "$ANSWERS"
  code="\${answer%% *}"; version="\${answer#* }"
  out="\${format//'%{http_code}'/$code}"
  out="\${out//'%header{api-version}'/$version}"
  printf '%s' "$out"
  if [ "$code" = 000 ]; then echo "curl: (7) Failed to connect to 127.0.0.1 port 2375" >&2; return 7; fi
}
sleep() { :; }
`;

interface StepRun {
  readonly status: number;
  readonly out: string;
  /** Every docker call, one per line. */
  readonly docker: string[];
}

/** Runs the step as GitHub runs it (bash -eo pipefail, CI and GITHUB_ACTIONS set), in this checkout, after the stubs, with the given answers. */
function runProbeStep(run: string, answers: ReadonlyMap<string, string>, config: string): StepRun {
  const dir = mkdtempSync(join(tmpdir(), 'socket-proxy-step-'));
  try {
    const script = join(dir, 'step.sh');
    writeFileSync(script, `${STUBS}${run}`);
    const table = join(dir, 'answers.tsv');
    writeFileSync(table, [...answers].map(([probe, answer]) => `${probe}\t${answer}\n`).join(''));
    const log = join(dir, 'docker.log');
    writeFileSync(log, '');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, CI: 'true', GITHUB_ACTIONS: 'true', DOCKER_LOG: log, ANSWERS: table, CONFIG: config },
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, docker: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Docker's answer carries its API version; HAProxy's carries none. */
const DOCKER_ANSWERS = '200 1.47';
const PROXY_REFUSES = '403 ';
/** Wrong answers to a probe Docker must answer, each given to every such probe in a run of its own. */
const NOT_DOCKERS = ["403 |the proxy's own 403", "503 |HAProxy's own 503, the socket not answering", "400 |HAProxy's own 400", '000 |nothing'];
/** Wrong answers to a probe the proxy must refuse, each given to every such probe in a run of its own. */
const NOT_REFUSED = ["200 1.47|Docker's 200", "403 1.47|Docker's own 403", "404 1.47|Docker's 404", "503 |HAProxy's own 503", '000 |nothing'];

/**
 * What is wrong with the job's verdict; empty when it holds. Its step runs
 * against the stubs with every probe answered as it should, which must pass;
 * then, for each wrong answer above, once with every probe of its kind
 * answered that way, which must fail and name each of them. The first wrong
 * verdict ends the reading.
 */
function verdictProblems(workflow: string, dockerfile: string): string[] {
  const run = stepOf(workflow);
  const { allowed, refused } = probesOf(run);
  const user = [...dockerfile.matchAll(/^USER\s+(\S+)\s*$/gm)].map((m) => m[1]).at(-1);
  const cmd = /^CMD\s+(\[.*\])\s*$/m.exec(dockerfile)?.[1];
  const config = `"${String(user)}" ["docker-entrypoint.sh"] ${cmd ? JSON.stringify(JSON.parse(cmd)) : 'none'}`;
  const right = new Map<string, string>([...allowed.map((p) => [p, DOCKER_ANSWERS] as const), ...refused.map((p) => [p, PROXY_REFUSES] as const)]);
  const base = runProbeStep(run, right, config);
  if (base.status !== 0 || /^::error::/m.test(base.out)) return [`with every probe answered as it should, the step exits ${base.status}:\n${base.out}`];
  const want = `${NAME}:${builtTag(dockerfile)}`;
  if (!base.docker.includes(`build --pull --progress=plain --tag ${want} ${CONTEXT}`)) return [`the step does not build ${CONTEXT} as ${want}: ${JSON.stringify(base.docker)}`];
  const runs = [
    ...NOT_DOCKERS.map((wrong) => ({ probes: allowed, wrong, kind: 'Docker must answer' })),
    ...NOT_REFUSED.map((wrong) => ({ probes: refused, wrong, kind: 'the proxy must refuse' })),
  ];
  for (const { probes, wrong, kind } of runs) {
    const [answer, what] = wrong.split('|') as [string, string];
    const r = runProbeStep(run, new Map([...right, ...probes.map((p) => [p, answer] as const)]), config);
    const lines = r.out.split('\n');
    const unnamed = probes.filter((p) => !lines.some((line) => line.startsWith(`::error::${p}:`)));
    if (r.status === 0 || unnamed.length) {
      return [
        `with every probe ${kind} answered ${what} ("${answer}"), the step exits ${r.status}` +
          `${unnamed.length ? ` and names no error for ${unnamed.join(', ')}` : ''}: its verdict is not the probes'\n${r.out}`,
      ];
    }
  }
  return [];
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
  const cfg = read(HAPROXY_CFG);
  const swapped = (text: string, from: RegExp | string, to: string) => {
    const out = text.replace(from, to);
    expect(out, `${String(from)} matched nothing`).not.toBe(text);
    return out;
  };

  it("builds this directory under managed.yml's name and starts it with managed.yml's environment and socket", () => {
    expect(workflowProblems(workflow, managed, dockerfile, cfg)).toEqual([]);
  });

  // A verdictProblems call runs the step up to ten times, about a tenth of a second each alone and slower beside the rest of the unit project, so the tests that call it have a minute.
  it("asks for every switch upstream's rules leave off, and the job's verdict is the probes'", () => {
    // Read from upstream's rules, not written here: these sixteen, and the ALLOW_* actions under /containers, which CONTAINERS=1 opens anyway.
    const rules = switchesOf(cfg);
    expect(rules.map((r) => r.key)).toContain('ALLOW_STOP');
    const { refused } = probesOf(stepOf(workflow));
    const asked = rules.filter((r) => refused.some((p) => r.pattern.test(p.split(' ')[1]!))).map((r) => r.key);
    expect(asked).toEqual(['AUTH', 'BUILD', 'COMMIT', 'CONFIGS', 'DISTRIBUTION', 'EXEC', 'GRPC', 'INFO', 'NODES', 'PLUGINS', 'SECRETS', 'SERVICES', 'SESSION', 'SWARM', 'SYSTEM', 'TASKS']);
    expect(verdictProblems(workflow, dockerfile)).toEqual([]);
  }, 60_000);

  it('refuses a job that drifted from managed.yml, or stopped asking', () => {
    const problems = (wf: string, m = managed) => workflowProblems(wf, m, dockerfile, cfg);
    // managed.yml switches exec on and the job does not follow: it no longer asks what the stack's proxy allows.
    expect(problems(workflow, swapped(managed, /^(\s*)POST: 1$/m, '$1POST: 1\n$1EXEC: 1'))).toEqual([
      expect.stringContaining('the two move together'),
      expect.stringContaining('no probe Docker must answer for EXEC'),
      expect.stringMatching(/^GET \/exec\/\S+ is among the probes the proxy must refuse, and .* allow it$/),
      expect.stringMatching(/^POST \/exec\/\S+ is among the probes the proxy must refuse, and .* allow it$/),
    ]);
    expect(problems(swapped(workflow, ' -e VOLUMES=1', ''))).toEqual([expect.stringContaining('the two move together')]);
    expect(problems(swapped(workflow, ' "GET /volumes" \\', ' \\'))).toEqual([expect.stringContaining('no probe Docker must answer for VOLUMES')]);
    expect(problems(swapped(workflow, /"POST \/containers\/socket-proxy-probe-none\/stop" "POST \/networks\/socket-proxy-probe-none\/connect"/, '"GET /_ping"'))).toEqual([
      expect.stringContaining('no POST among the probes'),
    ]);
    expect(problems(swapped(workflow, '"GET /volumes" \\', '"GET /info" \\'))).toEqual([
      expect.stringContaining('no probe Docker must answer for VOLUMES'),
      expect.stringContaining("GET /info is among the probes Docker must answer, and under trigger-docker-proxy's environment upstream's rules refuse it"),
    ]);
    expect(problems(swapped(workflow, '/var/run/docker.sock:/var/run/docker.sock:ro \\', '/var/run/docker.sock:/var/run/docker.sock \\'))).toEqual([expect.stringContaining('it mounts')]);
    expect(problems(swapped(workflow, `--tag "$ref" ${CONTEXT}\n`, '--tag "$ref" deploy/compose/postgres\n'))).toEqual([expect.stringContaining(`does not build ${CONTEXT}`)]);
    expect(problems(swapped(workflow, "want='\"root\"", "want='\"haproxy\""))).toEqual([expect.stringContaining('does not check the built image runs')]);
    expect(problems(swapped(workflow, 'name: build (docker-socket-proxy)', 'name: build (proxy)'))).toEqual([expect.stringContaining('every-pr-check-is-classified')]);
    // A refusal no longer asked for, each by the switch upstream's rules name.
    expect(problems(swapped(workflow, '"GET /exec/socket-proxy-probe-none/json" "POST /exec/socket-proxy-probe-none/start" \\', '\\'))).toEqual([
      expect.stringContaining('no probe the proxy must refuse for EXEC'),
    ]);
    expect(problems(swapped(workflow, '"POST /commit" ', ''))).toEqual([expect.stringContaining('no probe the proxy must refuse for COMMIT')]);
    expect(problems(swapped(swapped(workflow, '"GET /plugins" ', ''), '"POST /auth" ', ''))).toEqual([
      expect.stringContaining('no probe the proxy must refuse for AUTH'),
      expect.stringContaining('no probe the proxy must refuse for PLUGINS'),
    ]);
    expect(problems(swapped(workflow, '"GET /tasks"', '"GET /tasks" "GET /images/json"'))).toEqual([
      expect.stringContaining('GET /images/json is among the probes the proxy must refuse, and under trigger-docker-proxy\'s environment upstream\'s rules allow it'),
    ]);
    // An allow rule written another way is one the guard cannot read, so it says so.
    const rewritten = swapped(cfg, '/tasks } { env(TASKS) -m bool }', '/tasks } { env(TASKS) -m int gt 0 }');
    expect(workflowProblems(workflow, managed, dockerfile, rewritten)).toEqual([expect.stringContaining('read 27 of deploy/compose/docker-socket-proxy/haproxy.cfg\'s 28 allow rules')]);
    // The verdict, by its text: the step ends in it.
    expect(problems(swapped(workflow, 'exit "$failed"', 'exit 0'))).toEqual([expect.stringContaining('its last command is `exit 0`')]);
    expect(problems(swapped(workflow, '          failed=0\n', '          failed=0\n          [ -n "${SKIP_PROBES:-}" ] && exit 0\n'))).toEqual([expect.stringContaining('exits before the probes\' verdict, and not to fail')]);
  });

  it("refuses a step whose verdict is not every probe's", () => {
    const verdict = (wf: string) => verdictProblems(wf, dockerfile);
    const allowedBranch = 'if [ -z "$version" ]; then';
    const refusedBranch = 'if [ "$code" != 403 ] || [ -n "$version" ]; then';
    // Green whatever the probes answer.
    expect(verdict(swapped(workflow, 'exit "$failed"', 'exit 0'))).toEqual([
      expect.stringMatching(/^with every probe Docker must answer answered the proxy's own 403 \("403 "\), the step exits 0:/),
    ]);
    // The proxy's own 403, or its 503, taken for Docker's answer.
    expect(verdict(swapped(workflow, allowedBranch, 'if [ -z "$version" ] && [ "$code" != 403 ]; then'))).toEqual([
      expect.stringMatching(/^with every probe Docker must answer answered the proxy's own 403 \("403 "\), the step exits 0 and names no error for GET \/_ping, GET \/version, /),
    ]);
    expect(verdict(swapped(workflow, allowedBranch, 'if [ "$code" = 403 ] || [ "$code" = 000 ]; then'))).toEqual([
      expect.stringMatching(/^with every probe Docker must answer answered HAProxy's own 503, the socket not answering \("503 "\), the step exits 0/),
    ]);
    // Docker's own 403, or a 503 HAProxy wrote, taken for the proxy's refusal.
    expect(verdict(swapped(workflow, refusedBranch, 'if [ "$code" != 403 ]; then'))).toEqual([
      expect.stringMatching(/^with every probe the proxy must refuse answered Docker's own 403 \("403 1\.47"\), the step exits 0/),
    ]);
    expect(verdict(swapped(workflow, refusedBranch, 'if [ "$code" = 000 ] || [ -n "$version" ]; then'))).toEqual([
      expect.stringMatching(/^with every probe the proxy must refuse answered HAProxy's own 503 \("503 "\), the step exits 0/),
    ]);
    // A refusal that fails out loud and passes anyway.
    const quiet = workflow.replace(/(refuses it with the proxy's own 403 under managed\.yml's environment"\n\s*)failed=1/, '$1true');
    expect(quiet).not.toBe(workflow);
    expect(verdict(quiet)).toEqual([expect.stringMatching(/^with every probe the proxy must refuse answered Docker's 200 \("200 1\.47"\), the step exits 0:/)]);
    // One probe skipped by name: the step stays red, and says nothing about it.
    const skipped = swapped(workflow, '"GET /tasks"; do\n', '"GET /tasks"; do\n            [ "$probe" = \'GET /tasks\' ] && continue\n');
    expect(verdict(skipped)).toEqual([expect.stringMatching(/^with every probe the proxy must refuse answered Docker's 200 \("200 1\.47"\), the step exits 1 and names no error for GET \/tasks:/)]);
    // Docker's answer no longer read: every probe Docker must answer fails, so the step is red when nothing is wrong.
    expect(verdict(swapped(workflow, " %header{api-version}'", "'"))).toEqual([expect.stringMatching(/^with every probe answered as it should, the step exits 1:/)]);
  }, 60_000);
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
