// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PACKAGE THE FRONT NEVER RUNS (workplan 0119, 2026-10-31): the dashboard's
 * TLS front carried curl, which nothing here runs, and curl carried the image's
 * one critical finding.
 *
 * managed.yml's trigger-tls, the Caddy in front of the Trigger.dev dashboard,
 * ran `caddy:2.11.7-alpine` by index digest. Read with Trivy on 2026-10-31 it
 * held 1 critical and 9 high findings, 9 of them fixable, on both platforms.
 * Three were in Alpine's packages, and all three came in with curl: libcurl's
 * and curl's own high (CVE-2026-92392), and the critical in brotli-libs
 * (CVE-2026-111497), which only libcurl needs. Upstream's Dockerfile adds curl
 * itself, and its newest release was the one pinned, so neither a newer tag
 * nor a newer digest could clear them. Caddy is one static Go binary, and
 * nothing here runs curl in that container: no healthcheck, no exec, and the
 * smoke asks the front from the host.
 *
 * So `deploy/compose/caddy/Dockerfile` builds the same image with curl
 * removed, and with it the libraries only curl pulled in. Its header says what
 * was read, what goes and why nothing needs it, and how it moves. This holds:
 *
 *  - THE DOCKERFILE IS A FROM AND A RUN. One FROM, the official
 *    `caddy:<x.y.z>-alpine` by tag and index digest, and one RUN, and no other
 *    instruction: no parser directive, no COPY, ADD or `--mount` (the name
 *    hashes the instruction lines and nothing else, so nothing else may change
 *    what is built), and no USER, ENV, CMD or anything else that would make the
 *    image's interface other than upstream's;
 *  - THE RUN REMOVES CURL, AND PROVES IT, AND STOPS WHEN THE BASE MOVED. It
 *    checks curl, and each other package it names, at an exact apk version
 *    before anything else; then `apk del --no-network curl`; then that every
 *    package it removes is gone (curl and libcurl among them, and each package
 *    it checked), that the packages it keeps are not, that no curl is on the
 *    PATH, and that `caddy version` prints the release the FROM's tag names.
 *    Each refusal says "re-read the header". So a newer Caddy, or another
 *    Alpine, fails the build until somebody reads the new image again;
 *  - managed.yml runs it as `localhost/caddy:<builtTag>`, with `build: ./caddy`
 *    and `pull_policy: never`, no `user:` and no healthcheck that names curl;
 *    no other service runs Caddy's image, pulled or built. A name the
 *    Dockerfile moved past is one failure that prints the `sed` that moves
 *    it, and the `sed` is run here to show that it does. Nothing builds it
 *    while the machine has the name: `a-database-started-as-root` reads every
 *    service whose image is built here from the compose files, trigger-tls
 *    among them, and refuses any command that would;
 *  - images.yml's `build (caddy)` builds this directory under that name on a
 *    pull request, starts it with managed.yml's Caddyfile, mount, port and
 *    TRIGGER_TLS_HOST default, and asks it by IP, as the smoke does, for TLS
 *    on that port. Its verdict is the probe's: the step is run here against a
 *    stub docker and curl, answered as Caddy answered the job's first run (its
 *    own empty 200: asked by IP, the request matches no site address, so it is
 *    never proxied) and as its reverse proxy would with nothing behind it
 *    (502), and must pass both; then wrongly in turn (nothing, no Server
 *    header, another server, no status), and must fail each;
 *  - Dependabot reads the directory in an entry of its own, which moves every
 *    Caddy 2 release and digest and leaves a major to the owner.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCounter, parse as parseYaml, parseDocument } from 'yaml';
import { builtTag, dockerfileBase, parseRef, readImages } from './idp-pin-watch.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CONTEXT = 'deploy/compose/caddy';
const DOCKERFILE = `${CONTEXT}/Dockerfile`;
const MANAGED = 'deploy/compose/managed.yml';
const IMAGES_WORKFLOW = '.github/workflows/images.yml';
const SERVICE = 'trigger-tls';
const NAME = 'localhost/caddy';
const CADDYFILE_TARGET = '/etc/caddy/Caddyfile';

const isInstruction = (line: string) => !/^\s*(#|$)/.test(line);
const escapeForSed = (s: string) => s.replace(/[.[\]\\*^$#]/g, '\\$&');

/** The release a `caddy:<x.y.z>-alpine` tag names, `v2.11.7`, or null. */
const releaseOf = (tag: string) => /^(\d+\.\d+\.\d+)-alpine$/.exec(tag)?.[1] ?? null;

/** The words of a RUN's `for <name> in …; do` list, or null when it has none. */
function forList(run: string, name: string): string[] | null {
  const m = new RegExp(`\\bfor ${name} in ([^;]*); do\\b`).exec(run);
  return m ? m[1]!.trim().split(/\s+/) : null;
}

/** The Dockerfile's instructions, each continued line joined to its first. */
function instructionsOf(text: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (!current && !isInstruction(line)) continue;
    current += `${current ? '\n' : ''}${line}`;
    if (!/\\\s*$/.test(line)) {
      out.push(current);
      current = '';
    }
  }
  if (current) out.push(current);
  return out;
}

/** What is wrong with the Dockerfile; empty when it holds. */
function dockerfileProblems(text: string): string[] {
  const problems: string[] = [];
  let base: ReturnType<typeof dockerfileBase> | null = null;
  try {
    base = dockerfileBase(text);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const release = base ? releaseOf(base.tag) : null;
  if (base) {
    if (base.repo !== 'caddy') problems.push(`it builds on ${base.repo}, not the official caddy image`);
    if (!release) problems.push(`its base is ${base.tag}, not an exact Caddy release on Alpine (\`2.11.7-alpine\`)`);
  }
  for (const line of text.split('\n')) {
    if (!/^\s*#\s*[a-z][a-z0-9]*\s*=/i.test(line)) break;
    problems.push(`\`${line}\` is a parser directive: it changes the build, and the image's name skips it as a comment. Remove it`);
  }
  const instructions = instructionsOf(text);
  const kinds = instructions.map((i) => /^\s*(\S+)/.exec(i)?.[1]?.toUpperCase() ?? '');
  if (JSON.stringify(kinds) !== JSON.stringify(['FROM', 'RUN'])) {
    problems.push(`its instructions are ${JSON.stringify(kinds)}, not one FROM and one RUN: anything else reads files the name does not cover, or changes upstream's interface`);
  }
  for (const i of instructions) if (/--mount\b/i.test(i)) problems.push(`\`${i.split('\n')[0]}\` mounts something the name does not cover`);
  const run = instructions.find((i) => /^RUN\s/i.test(i));
  if (!run) return [...problems, 'no RUN: curl is not removed'];
  problems.push(...runProblems(run, release ? `v${release}` : null));
  return problems;
}

/** What is wrong with the RUN that removes curl, given the release the FROM names; empty when it holds. */
function runProblems(run: string, release: string | null): string[] {
  const problems: string[] = [];
  if (!/^RUN set -eu;/.test(run)) problems.push('the RUN does not start with `set -eu;`: a check that fails could be passed by');
  const wants = forList(run, 'want');
  const del = run.indexOf('apk del --no-network curl;');
  if (del < 0) problems.push('the RUN does not run `apk del --no-network curl`');
  const checked = (wants ?? []).map((w) => /^([a-z0-9][a-z0-9._+-]*)=(\d[\w.]*-r\d+)$/.exec(w));
  if (!wants || checked.some((c) => !c)) problems.push(`the RUN checks ${JSON.stringify(wants)}, not packages at exact apk versions (\`curl=8.22.0-r0\`)`);
  const names = checked.flatMap((c) => (c ? [c[1]!] : []));
  if (!names.includes('curl')) problems.push('the RUN does not check curl at the version the header read');
  if (wants && del >= 0 && run.indexOf('for want in') > del) problems.push('the RUN checks the packages after it removes them');
  if (!/awk -v want="\$want" '\/\^P:\/ \{ p = substr\(\$0, 3\) \} \/\^V:\/ && \(p "=" substr\(\$0, 3\)\) == want \{ found = 1 \} END \{ exit !found \}' \/lib\/apk\/db\/installed \\\n\s*\|\| \{ echo "[^"]*re-read the header" >&2; exit 1; \};/.test(run)) {
    problems.push("the RUN does not hold each package to its version in apk's database, refusing with \"re-read the header\"");
  }
  const gone = forList(run, 'gone');
  if (!gone) problems.push('the RUN does not prove what it removed is gone');
  else {
    for (const must of new Set(['curl', 'libcurl', ...names])) if (!gone.includes(must)) problems.push(`the RUN does not prove ${must} is gone`);
    if (!/if grep -qx "P:\$gone" \/lib\/apk\/db\/installed; then echo "[^"]*re-read the header" >&2; exit 1; fi;/.test(run)) {
      problems.push("the RUN does not refuse a package still in apk's database after the removal, with \"re-read the header\"");
    }
    if (del >= 0 && run.indexOf('for gone in') < del) problems.push('the RUN proves the packages are gone before it removes them');
  }
  const kept = forList(run, 'kept');
  if (!kept || kept.length === 0) problems.push('the RUN does not prove the packages it keeps are still there');
  else {
    for (const k of kept) if (gone?.includes(k)) problems.push(`the RUN both keeps and removes ${k}`);
    if (!/grep -qx "P:\$kept" \/lib\/apk\/db\/installed \|\| \{ echo "[^"]*re-read the header" >&2; exit 1; \};/.test(run)) {
      problems.push('the RUN does not refuse a kept package that went, with "re-read the header"');
    }
  }
  if (!/if command -v curl; then echo "[^"]*re-read the header" >&2; exit 1; fi;/.test(run)) problems.push('the RUN does not refuse a curl left on the PATH');
  const asked = /version="\$\(caddy version\)"; \\\n\s*case "\$version" in (v[\d.]+)\|"(v[\d.]+) "\*\) ;; \*\) echo "[^"]*re-read the header" >&2; exit 1 ;; esac\s*$/.exec(run);
  if (!asked || asked[1] !== asked[2]) problems.push('the RUN does not end by asking `caddy version` for one release, refusing another with "re-read the header"');
  else if (release && asked[1] !== release) {
    problems.push(`the RUN asks \`caddy version\` for ${asked[1]}, and the FROM is Caddy ${release}: re-read the header, the image's packages and its scan, and move the RUN's versions with it`);
  }
  return problems;
}

interface Service {
  image?: string;
  build?: string | { context?: string };
  pull_policy?: string;
  user?: string | number;
  healthcheck?: { test?: string | string[] };
  environment?: Record<string, string | number | boolean | null> | string[];
  ports?: string[];
  volumes?: string[];
}

const servicesOf = (text: string) => (parseYaml(text) as { services: Record<string, Service> }).services;

/** What is wrong with managed.yml's TLS front; empty when it holds. */
function composeProblems(managed: string, dockerfile: string): string[] {
  const problems: string[] = [];
  const want = `${NAME}:${builtTag(dockerfile)}`;
  const services = servicesOf(managed);
  const svc = services[SERVICE];
  if (!svc) return [`${MANAGED} has no ${SERVICE}`];
  for (const [name, other] of Object.entries(services)) {
    const repo = other.image ? parseRef(other.image).repo : '';
    if (repo === 'caddy') problems.push(`${MANAGED}:${name} runs ${other.image}, upstream's image with curl and the critical it carries: run ${want}, built from ./caddy`);
    else if (repo === NAME && name !== SERVICE) problems.push(`${MANAGED}:${name} runs the TLS front's build too, which only ${SERVICE} may`);
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
      problems.push(`${SERVICE} runs ${String(svc.image)}, not ${want}, built from ./caddy`);
    }
  }
  if (svc.build !== './caddy') problems.push(`${SERVICE}'s build: is ${JSON.stringify(svc.build)}, not the bare \`./caddy\`: args, a target or a Dockerfile of its own are inputs the name does not carry`);
  if (svc.pull_policy !== 'never') problems.push(`${SERVICE} has pull_policy ${String(svc.pull_policy)}, not never: no registry serves ${want}`);
  if (svc.user !== undefined) problems.push(`${SERVICE} sets user: ${String(svc.user)}; upstream's image runs as root, as it did before the build`);
  if (svc.healthcheck && /\bcurl\b/.test(JSON.stringify(svc.healthcheck.test ?? ''))) {
    problems.push(`${SERVICE}'s healthcheck runs curl, which this image does not have: under \`up --wait\` it fails the bring-up. Ask from the host, as the smoke does`);
  }
  if (!caddyfileMount(svc)) problems.push(`${SERVICE} mounts no Caddyfile at ${CADDYFILE_TARGET}, read-only`);
  return problems;
}

/** trigger-tls's Caddyfile mount, its source relative to the repository root. */
function caddyfileMount(svc: Service): string | null {
  const mount = (svc.volumes ?? []).map((v) => v.split(':')).find((p) => p[1] === CADDYFILE_TARGET && p[2] === 'ro');
  return mount ? `deploy/compose/${mount[0]!.replace(/^\.\//, '')}` : null;
}

/** trigger-tls's TRIGGER_TLS_HOST as compose resolves it with `.env` silent: its default. */
function hostDefault(svc: Service): string | null {
  const env = svc.environment;
  const value = Array.isArray(env) ? env.find((e) => e.startsWith('TRIGGER_TLS_HOST='))?.slice('TRIGGER_TLS_HOST='.length) : env?.TRIGGER_TLS_HOST;
  if (typeof value !== 'string') return null;
  return /^\$\{TRIGGER_TLS_HOST:-([^}]*)\}$/.exec(value)?.[1] ?? value;
}

/** The container port every publish of trigger-tls lands on, when they agree. */
function containerPort(svc: Service): string | null {
  const ports = [...new Set((svc.ports ?? []).map((p) => p.split(':').at(-1)!))];
  return ports.length === 1 ? ports[0]! : null;
}

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  if?: string;
  permissions?: Record<string, string>;
  steps: Step[];
}

/** The step that builds and asks the front. */
const stepOf = (workflow: string) => (parseYaml(workflow) as { jobs: Record<string, Job> }).jobs['caddy']?.steps.find((s) => s.run?.includes('docker build'))?.run ?? '';

/** What is wrong with images.yml's build of the front; empty when it holds. */
function workflowProblems(workflow: string, managed: string): string[] {
  const problems: string[] = [];
  const job = (parseYaml(workflow) as { jobs: Record<string, Job> }).jobs['caddy'];
  if (!job) return ['images.yml has no caddy job: nothing builds the TLS front before E2E (managed)'];
  if (job.name !== 'build (caddy)') problems.push(`its name is ${String(job.name)}, not build (caddy), which every-pr-check-is-classified names`);
  if (job.if !== "github.event_name == 'pull_request'") problems.push(`it runs ${String(job.if)}, not on a pull request only`);
  if (JSON.stringify(job.permissions) !== JSON.stringify({ contents: 'read' })) problems.push(`its permissions are ${JSON.stringify(job.permissions)}, not contents: read`);
  const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
  if (checkout?.with?.['persist-credentials'] !== false) problems.push('its checkout keeps a credential');
  const run = stepOf(workflow);
  if (!/^set -euo pipefail$/m.test(run)) problems.push('its script does not start with set -euo pipefail');
  if (!run.includes(`docker build --pull --progress=plain --tag "$ref" ${CONTEXT}\n`)) problems.push(`it does not build ${CONTEXT} under the name it read`);
  if (!run.includes(`\\(${NAME.replace('/', '\\/')}:[^[:space:]]*\\)`)) problems.push(`it does not read the name from managed.yml's ${NAME} line`);
  const svc = servicesOf(managed)[SERVICE];
  if (!svc) return [...problems, `${MANAGED} has no ${SERVICE}`];
  // managed.yml's Caddyfile, host default and container port, as compose runs them.
  const mounts = [...run.matchAll(/-v "?(\S+?)"? \\/g)].map((m) => m[1]!);
  const source = caddyfileMount(svc);
  if (JSON.stringify(mounts) !== JSON.stringify([`$PWD/${source}:${CADDYFILE_TARGET}:ro`])) {
    problems.push(`it mounts ${JSON.stringify(mounts)}, and ${SERVICE} mounts ${String(source)} at ${CADDYFILE_TARGET}, read-only: the two move together`);
  }
  const envs = [...run.matchAll(/-e ([A-Z_][A-Z0-9_]*=\S*)/g)].map((m) => m[1]!);
  if (JSON.stringify(envs) !== JSON.stringify([`TRIGGER_TLS_HOST=${String(hostDefault(svc))}`])) {
    problems.push(`it starts the front with ${JSON.stringify(envs)}, and ${SERVICE}'s TRIGGER_TLS_HOST defaults to ${String(hostDefault(svc))}`);
  }
  const publish = /-p 127\.0\.0\.1:(\d+):(\d+) "\$ref"/.exec(run);
  if (!publish || publish[2] !== containerPort(svc)) problems.push(`it publishes ${publish ? publish[2] : 'nothing'}, and ${SERVICE} listens on ${String(containerPort(svc))}`);
  else if (!new RegExp(`^\\s*answer="\\$\\(curl -sk [^\\n]* https://127\\.0\\.0\\.1:${publish[1]}/ \\|\\| true\\)"$`, 'm').test(run)) {
    problems.push(`it does not ask the front by IP on the port it published, ${publish[1]}`);
  }
  if (!run.includes("-w '%{http_code} %header{server}'")) problems.push("it does not read the answer's status and Server header");
  const commands = run.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  for (const line of commands) {
    if (/(^|[\s;&|(])exit\b/.test(line) && !/(^|[\s;&|(])exit 1$/.test(line)) problems.push(`\`${line}\` exits, and not to fail`);
  }
  return problems;
}

/**
 * The stubs the step runs against, as shell functions ahead of it. `docker`:
 * every call is logged, the build and the run succeed. `curl`: writes
 * `$ANSWER` (`<status> <Server header>`) as the step's `-w` would, and fails
 * as curl does when nothing answered. `sleep` returns.
 */
const STUBS = `docker() {
  printf '%s\\n' "$*" >> "$DOCKER_LOG"
  case "$1" in
    build) return 0 ;;
    run) echo 0123456789ab ;;
    image) echo "linux/amd64 sha256:stub" ;;
    *) echo "unexpected: docker $*" >&2; return 3 ;;
  esac
}
curl() {
  printf '%s' "$ANSWER"
  case "$ANSWER" in 000*) echo "curl: (7) Failed to connect to 127.0.0.1 port 3443" >&2; return 7 ;; esac
}
sleep() { :; }
`;

/** Runs the step as GitHub runs it (bash -eo pipefail), in this checkout, after the stubs. */
function runStep(run: string, answer: string): { status: number; out: string; docker: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'caddy-step-'));
  try {
    const script = join(dir, 'step.sh');
    writeFileSync(script, `${STUBS}${run}`);
    const log = join(dir, 'docker.log');
    writeFileSync(log, '');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, CI: 'true', GITHUB_ACTIONS: 'true', DOCKER_LOG: log, ANSWER: answer },
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, docker: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Caddy's answers, each given to the probe in a run of its own: every one must
 * pass. The first is what the job's first run got (2026-10-31, "by Caddy (HTTP
 * 200)"): asked by IP, the request's Host matches no site address, so Caddy
 * answers it itself, an empty 200, and never proxies. The second is the
 * reverse proxy's, were a request to reach the site with trigger-api absent:
 * any status passes once TLS has terminated and Caddy answered.
 */
const RIGHT = ["200 Caddy|Caddy's own answer to a request no site matches", "502 Caddy|the reverse proxy's answer with nothing behind it"];

/** Wrong answers, each given to the probe in a run of its own: none may pass. */
const WRONG = ['000 |nothing answered', '502 |an answer without a Server header', '200 nginx|another server', '000 Caddy|no status'];

/** What is wrong with the job's verdict; empty when it holds. */
function verdictProblems(workflow: string, dockerfile: string): string[] {
  const run = stepOf(workflow);
  const want = `${NAME}:${builtTag(dockerfile)}`;
  for (const right of RIGHT) {
    const [answer, what] = right.split('|') as [string, string];
    const r = runStep(run, answer);
    if (r.status !== 0 || /^::error::/m.test(r.out)) return [`with ${what} ("${answer}"), the step exits ${r.status}:\n${r.out}`];
    if (!r.docker.includes(`build --pull --progress=plain --tag ${want} ${CONTEXT}`)) return [`the step does not build ${CONTEXT} as ${want}: ${JSON.stringify(r.docker)}`];
  }
  for (const wrong of WRONG) {
    const [answer, what] = wrong.split('|') as [string, string];
    const r = runStep(run, answer);
    if (r.status === 0 || !/^::error::/m.test(r.out)) return [`with ${what} ("${answer}"), the step exits ${r.status} without an error: its verdict is not the probe's\n${r.out}`];
  }
  return [];
}

describe("the TLS front is Caddy's image with curl removed, and nothing else changed", () => {
  const dockerfile = read(DOCKERFILE);

  it('the Dockerfile is a FROM by tag and digest and the RUN that removes curl, and the directory holds nothing else', () => {
    expect(dockerfileProblems(dockerfile)).toEqual([]);
    expect(readdirSync(join(REPO_ROOT, CONTEXT))).toEqual(['Dockerfile']);
  });

  it('removes curl and libcurl, and checks every package it removes for its version first', () => {
    const run = instructionsOf(dockerfile).find((i) => /^RUN\s/.test(i))!;
    const gone = forList(run, 'gone')!;
    expect(gone).toEqual(expect.arrayContaining(['curl', 'libcurl', 'brotli-libs']));
    expect(forList(run, 'kept')).toEqual(['ca-certificates', 'libcap', 'mailcap']);
  });

  it('refuses each way the Dockerfile could drift from its name, from upstream, or from what it proves', () => {
    const swap = (from: RegExp | string, to: string) => {
      const text = dockerfile.replace(from, to);
      expect(text, `${String(from)} matched nothing`).not.toBe(dockerfile);
      return dockerfileProblems(text);
    };
    const from = dockerfileBase(dockerfile);
    // Another image, a tag that is no exact release, a tag without its digest.
    expect(swap(/^FROM caddy:/m, 'FROM nginx:')).toEqual([expect.stringContaining('not the official caddy image')]);
    expect(swap(/^FROM caddy:(\d+\.\d+)\.\d+-alpine@/m, 'FROM caddy:$1-alpine@')).toEqual([expect.stringContaining('not an exact Caddy release on Alpine')]);
    expect(swap(from.ref, `caddy:${from.tag}`)).toEqual([expect.stringContaining('carries no tag and digest')]);
    // A newer Caddy in the FROM with the RUN not read again: what Dependabot's pull request is until somebody does.
    expect(swap(/^FROM caddy:2\.\d+\.\d+-alpine@/m, 'FROM caddy:2.99.0-alpine@')).toEqual([expect.stringContaining('re-read the header')]);
    // What the builder reads that the name does not cover, and an interface that is no longer upstream's.
    expect(dockerfileProblems(`# syntax=docker/dockerfile:1\n${dockerfile}`)).toEqual([expect.stringContaining('is a parser directive')]);
    for (const line of ['COPY Caddyfile /etc/caddy/Caddyfile', 'ADD https://example.org/x /tmp/', 'USER caddy', 'ENV CADDY_ADMIN=0.0.0.0:2019', 'HEALTHCHECK CMD curl -f https://localhost:3443/']) {
      expect(dockerfileProblems(`${dockerfile}${line}\n`), line).toEqual([expect.stringContaining('not one FROM and one RUN')]);
    }
    expect(swap(/^RUN set -eu;/m, 'RUN --mount=type=bind,target=/src set -eu;')).toEqual(expect.arrayContaining([expect.stringContaining('mounts something')]));
    // The removal gone, or what it proves cut short.
    expect(swap('    apk del --no-network curl; \\\n', '')).toEqual([expect.stringContaining('apk del --no-network curl')]);
    expect(swap(/\bfor gone in curl libcurl /, 'for gone in curl ')).toEqual([expect.stringContaining('does not prove libcurl is gone')]);
    expect(swap(/ brotli-libs c-ares /, ' c-ares ')).toEqual([expect.stringContaining('does not prove brotli-libs is gone')]);
    expect(swap(/\bfor want in curl=\S+ /, 'for want in ')).toEqual([expect.stringContaining('does not check curl')]);
    expect(swap(/\bfor want in curl=[\d.]+-r\d+/, 'for want in curl')).toEqual([
      expect.stringContaining('not packages at exact apk versions'),
      expect.stringContaining('does not check curl'),
    ]);
    expect(swap(/\bfor kept in ca-certificates /, 'for kept in curl ca-certificates ')).toEqual([expect.stringContaining('both keeps and removes curl')]);
    expect(swap(/ {4}if command -v curl;[^\n]*\n/, '')).toEqual([expect.stringContaining('a curl left on the PATH')]);
    expect(swap(/\|\| \{ echo "this base[^"]*" >&2; exit 1; \};/, '|| true;')).toEqual([expect.stringContaining("to its version in apk's database")]);
    expect(swap(/case "\$version" in v[\d.]+\|"v[\d.]+ "\*\)/, 'case "$version" in *)')).toEqual([expect.stringContaining('`caddy version`')]);
    expect(swap(/^RUN set -eu; \\$/m, 'RUN set -u; \\')).toEqual([expect.stringContaining('set -eu')]);
  });
});

describe("managed.yml runs that build, by the name its instructions give it", () => {
  const dockerfile = read(DOCKERFILE);
  const managed = read(MANAGED);

  it('runs it as localhost/caddy:<builtTag>, built here and never pulled', () => {
    expect(composeProblems(managed, dockerfile)).toEqual([]);
    const front = readImages(managed).filter((i) => i.repo === NAME);
    expect(front.map((i) => i.tag)).toEqual([builtTag(dockerfile)]);
    expect(readImages(managed).filter((i) => i.repo === 'caddy')).toEqual([]);
  });

  it('prints the sed that moves a name the Dockerfile moved past, and the sed moves it', () => {
    const edited = dockerfile.replace(/^(\s*)apk del --no-network curl; \\$/m, '$1apk del --no-network --quiet curl; \\');
    expect(edited).not.toBe(dockerfile);
    const problems = composeProblems(managed, edited);
    expect(problems).toHaveLength(1);
    const sed = /^ {2}(sed -i -e '[^']+') deploy\/compose\/managed\.yml$/m.exec(problems[0]!)?.[1];
    expect(sed, problems[0]).toBeDefined();
    expect(problems[0]).toMatch(new RegExp(`deploy/compose/managed\\.yml:\\d+ \\(${SERVICE}\\)`));
    const dir = mkdtempSync(join(tmpdir(), 'caddy-name-'));
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

  it("refuses upstream's image back, another build, a pull, a user, and a healthcheck that runs curl", () => {
    const swap = (from: RegExp, to: string) => {
      const text = managed.replace(from, to);
      expect(text, `${String(from)} matched nothing`).not.toBe(managed);
      return composeProblems(text, dockerfile);
    };
    const image = /^(\s*image:\s*)localhost\/caddy:\S+$/m;
    expect(swap(image, '$1caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f')).toEqual([
      expect.stringContaining("upstream's image with curl"),
      expect.stringContaining('not localhost/caddy:'),
    ]);
    expect(swap(/^(\s*)build: \.\/caddy$/m, '$1build:\n$1  context: ./caddy')).toEqual([expect.stringContaining('not the bare `./caddy`')]);
    expect(swap(/^(\s*build: \.\/caddy\n)\s*pull_policy: never\n/m, '$1')).toEqual([expect.stringContaining('not never')]);
    expect(swap(/^(\s*build: \.\/caddy\n)/m, '$1    user: "1000"\n')).toEqual([expect.stringContaining('sets user: 1000')]);
    expect(swap(/^(\s*build: \.\/caddy\n)/m, '$1    healthcheck:\n      test: ["CMD", "curl", "-fsk", "https://127.0.0.1:3443/"]\n')).toEqual([
      expect.stringContaining('healthcheck runs curl'),
    ]);
    expect(swap(/\.\/trigger-tls\.Caddyfile:\/etc\/caddy\/Caddyfile:ro/, './trigger-tls.Caddyfile:/etc/caddy/Caddyfile')).toEqual([expect.stringContaining('mounts no Caddyfile')]);
  });
});

describe('images.yml builds it on a pull request and asks it for TLS as the smoke does', () => {
  const workflow = read(IMAGES_WORKFLOW);
  const managed = read(MANAGED);
  const dockerfile = read(DOCKERFILE);
  const swapped = (text: string, from: RegExp | string, to: string) => {
    const out = text.replace(from, to);
    expect(out, `${String(from)} matched nothing`).not.toBe(text);
    return out;
  };

  it("builds this directory under managed.yml's name and starts it with managed.yml's Caddyfile, host and port", () => {
    expect(workflowProblems(workflow, managed)).toEqual([]);
  });

  it("the job's verdict is the probe's", () => {
    expect(verdictProblems(workflow, dockerfile)).toEqual([]);
  }, 60_000);

  it('refuses a job that drifted from managed.yml, or stopped asking', () => {
    const problems = (wf: string, m = managed) => workflowProblems(wf, m);
    expect(problems(workflow, swapped(managed, 'TRIGGER_TLS_HOST: ${TRIGGER_TLS_HOST:-localhost}', 'TRIGGER_TLS_HOST: ${TRIGGER_TLS_HOST:-127.0.0.1}'))).toEqual([
      expect.stringContaining('defaults to 127.0.0.1'),
    ]);
    expect(problems(workflow, swapped(managed, /:3443"\n/g, ':8443"\n'))).toEqual([expect.stringContaining('listens on 8443')]);
    expect(problems(swapped(workflow, '/deploy/compose/trigger-tls.Caddyfile:', '/deploy/compose/www-nginx.conf:'))).toEqual([expect.stringContaining('the two move together')]);
    expect(problems(swapped(workflow, `--tag "$ref" ${CONTEXT}\n`, '--tag "$ref" deploy/compose/postgres\n'))).toEqual([expect.stringContaining(`does not build ${CONTEXT}`)]);
    expect(problems(swapped(workflow, 'name: build (caddy)', 'name: build (tls)'))).toEqual([expect.stringContaining('every-pr-check-is-classified')]);
    expect(problems(swapped(workflow, "-w '%{http_code} %header{server}'", "-w '%{http_code}'"))).toEqual([expect.stringContaining('Server header')]);
    expect(problems(swapped(workflow, 'https://127.0.0.1:3443/ ||', 'https://localhost:3443/ ||'))).toEqual([expect.stringContaining('by IP')]);
    expect(problems(swapped(workflow, '          echo "trigger-tls: TLS terminated', '          exit 0\n          echo "trigger-tls: TLS terminated'))).toEqual([
      expect.stringContaining('`exit 0` exits, and not to fail'),
    ]);
  });

  it('refuses a step that passes when the front did not answer as Caddy', () => {
    const verdict = (wf: string) => verdictProblems(wf, dockerfile);
    expect(verdict(swapped(workflow, 'if [ "${code:-000}" = 000 ] || [ "${server:-}" != Caddy ]; then', 'if [ "${code:-000}" = 000 ]; then'))).toEqual([
      expect.stringMatching(/^with an answer without a Server header \("502 "\), the step exits 0/),
    ]);
    expect(verdict(swapped(workflow, 'if [ "${code:-000}" = 000 ] || [ "${server:-}" != Caddy ]; then', 'if [ "${server:-}" != Caddy ]; then'))).toEqual([
      expect.stringMatching(/^with no status \("000 Caddy"\), the step exits 0/),
    ]);
    // A step that waits for the reverse proxy's 502 fails the answer Caddy gave the first run.
    expect(verdict(swapped(workflow, 'if [ "${code:-000}" = 000 ] || [ "${server:-}" != Caddy ]; then', 'if [ "${code:-000}" != 502 ] || [ "${server:-}" != Caddy ]; then'))).toEqual([
      expect.stringMatching(/^with Caddy's own answer to a request no site matches \("200 Caddy"\), the step exits 1/),
    ]);
  }, 60_000);
});

describe('Dependabot moves its base within Caddy 2, in a pull request of its own', () => {
  it('reads the directory alone, and leaves a major to the owner', () => {
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
    expect(entry!.ignore).toEqual([{ 'dependency-name': 'caddy', 'update-types': ['version-update:semver-major'] }]);
  });
});
