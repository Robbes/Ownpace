// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REBUILD UPSTREAM HAS NOT MADE (workplan 0119, 2026-11-13, for alpha.8):
 * the pooler's image carried 79 high findings, every one fixed in Alpine,
 * because the image was built once and never again.
 *
 * managed.yml's pgbouncer ran `edoburu/pgbouncer:v1.26.1-p0` as pulled. The
 * image scan of main on 2026-11-13 (Security Scan run 43492635512) read it at
 * 0 critical and 79 high, all with a fix, in five packages of its Alpine
 * 3.24.2: libpq and postgresql18-client 18.6-r0 (PostgreSQL 18.7's fixes, 38
 * findings each), musl and musl-utils 1.2.6-r2 (CVE-2026-107891) and zlib
 * 1.3.2-r0 (CVE-2026-85091). The tag was upstream's newest, its package layer
 * was of 2026-09-30, and upstream pushes by hand, so no pin could clear them.
 * pgbouncer links none of libpq and zlib; psql, which the healthcheck runs,
 * links libpq, and asks only the container's own pooler.
 *
 * So `deploy/compose/pgbouncer/Dockerfile` builds upstream's image with those
 * five at the versions Alpine's 3.24 serves, until upstream's image carries
 * them. Its header says what was read, the risk taken and the way out. This
 * holds:
 *
 *  - THE DOCKERFILE IS UPSTREAM'S IMAGE AND TWO RUNS. One FROM,
 *    `edoburu/pgbouncer:v<x.y.z>-p<n>` by tag and index digest; `USER root`,
 *    the RUN that takes the packages, `USER postgres`, the RUN that starts
 *    the pooler and the client; and no other instruction: no parser
 *    directive, no COPY, ADD or `--mount` (the name hashes the instruction
 *    lines and nothing else, and the directory also holds the pooler's
 *    configuration), and no ENTRYPOINT, CMD or ENV, which would make the
 *    image's interface other than upstream's;
 *  - THE FIRST RUN TAKES EXACTLY THE VERSIONS IT NAMES. apk is asked for
 *    `add --no-cache name=version …` and `version -t` and nothing else: never
 *    a floor, an upgrade or another repository. The RUN is run here, on a
 *    stand-in package database and a stand-in apk: it takes the five and
 *    nothing else, refuses a base that already carries any one of them
 *    before it installs (upstream's image has that fix, and the build is on
 *    its way out), says what to do when apk cannot install them, and refuses
 *    an install that moved anything else;
 *  - THE SECOND RUN PROVES THE USER AND WHAT STARTS. Run here against
 *    stand-ins too: as anybody but postgres, uid 70, with a pooler that is
 *    not the FROM's release, or with a psql that is not the client the first
 *    RUN names, it fails;
 *  - managed.yml runs it as `localhost/pgbouncer:<builtTag>`, with `build:
 *    ./pgbouncer` and `pull_policy: never`, no `user:`, and a healthcheck
 *    that still runs psql; no other service runs the pooler's image, pulled
 *    or built. A name the Dockerfile moved past is one failure that prints
 *    the `sed` that moves it, and the `sed` is run here to show that it does.
 *    Nothing builds it while the machine has the name
 *    (`a-database-started-as-root` reads every service built here);
 *  - images.yml's `build (pgbouncer, <arch>)` builds this directory under that
 *    name on a pull request, on both platforms, holds the image's
 *    configuration to upstream's, starts it as managed.yml runs it and asks
 *    it with managed.yml's healthcheck, word for word. Its verdict is the
 *    checks': the step is run here against a stub docker that answers as the
 *    build should, and then wrongly in turn (another user, another command,
 *    another platform, a pooler that never answers, a package at its old
 *    version, process 1 as root or as a shell, no pool), and must fail each;
 *  - Dependabot reads the directory in an entry of its own, which leaves a
 *    major to the owner. Its pull request is where the way out shows.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCounter, parse as parseYaml, parseDocument } from 'yaml';
import { builtTag, dockerfileBase, parseRef, readImages } from './idp-pin-watch.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CONTEXT = 'deploy/compose/pgbouncer';
const DOCKERFILE = `${CONTEXT}/Dockerfile`;
const MANAGED = 'deploy/compose/managed.yml';
const IMAGES_WORKFLOW = '.github/workflows/images.yml';
const SERVICE = 'pgbouncer';
const UPSTREAM = 'edoburu/pgbouncer';
const NAME = 'localhost/pgbouncer';

/** What the first RUN installs, each at its exact version (the Dockerfile's header, WHAT IT IS). */
const PINS: Readonly<Record<string, string>> = {
  libpq: '18.7-r0',
  musl: '1.2.6-r3',
  'musl-utils': '1.2.6-r3',
  'postgresql18-client': '18.7-r0',
  zlib: '1.4-r0',
};
const NAMED = Object.entries(PINS).map(([name, version]) => `${name}=${version}`);

/**
 * The base's packages as the RUN reads them, from /lib/apk/db/installed: the
 * five it moves at the versions `488422e3…` carries, and four it must leave
 * alone, which the client or the pooler need (read from both platform images'
 * layers on 2026-11-13; 25 packages, the same on both).
 */
const BASE_PACKAGES: Readonly<Record<string, string>> = {
  libcrypto3: '3.5.8-r0',
  libevent: '2.1.13-r0',
  libpq: '18.6-r0',
  musl: '1.2.6-r2',
  'musl-utils': '1.2.6-r2',
  'postgresql-common': '1.3-r0',
  'postgresql18-client': '18.6-r0',
  readline: '8.3.3-r1',
  zlib: '1.3.2-r0',
};

const isInstruction = (line: string) => !/^\s*(#|$)/.test(line);
const escapeForSed = (s: string) => s.replace(/[.[\]\\*^$#]/g, '\\$&');

/** The PgBouncer release a `v<x.y.z>-p<n>` tag names, `1.26.1`, or null. */
const releaseOf = (tag: string) => /^v(\d+\.\d+\.\d+)-p\d+$/.exec(tag)?.[1] ?? null;

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

const APK_COMMAND = /(?:^|[^\w.-])(?:\/[\w./-]*\/)?apk\s+(\S+)([^;&|)}]*)/g;

/**
 * What the Dockerfile asks of apk that the image's name would not say. Only
 * `apk add --no-cache name=1.2.3-r0 …` and `apk version -t` pass, so a message
 * a RUN prints must not say "apk" before a space.
 */
function apkProblems(instructions: readonly string[]): string[] {
  const problems: string[] = [];
  for (const instruction of instructions) {
    for (const m of instruction.matchAll(APK_COMMAND)) {
      const [subcommand, rest] = [m[1]!, m[2]!];
      if (subcommand === 'version') {
        if (!/^\s+(-t|--test)\s/.test(rest)) problems.push(`\`apk version${rest.trimEnd()}\`: apk compares versions here with \`-t\` and does nothing else`);
        continue;
      }
      if (subcommand !== 'add') {
        problems.push(`\`apk ${subcommand}\` changes what is installed by what Alpine's mirror holds that day, which the image's name does not say. Name each package at its exact version in an \`apk add --no-cache\``);
        continue;
      }
      const words = rest.trim().split(/\s+/).filter(Boolean);
      const options = words.filter((w) => w.startsWith('-'));
      const packages = words.filter((w) => !w.startsWith('-'));
      for (const option of options.filter((o) => o !== '--no-cache')) problems.push(`\`apk add ${option}\`: an option beyond --no-cache reaches past the versions the line names`);
      if (!options.includes('--no-cache')) problems.push('`apk add` without --no-cache');
      if (!packages.length) problems.push('`apk add` names no package on its line');
      for (const pkg of packages) {
        if (!/^[a-z0-9][a-z0-9._+-]*=\d[0-9a-z._]*-r\d+$/.test(pkg)) {
          problems.push(`\`apk add\` takes \`${pkg}\`, not one exact version (\`name=1.2.3-r0\`): a floor, or no version, builds whatever Alpine's mirror holds that day under the same name`);
        }
      }
    }
  }
  return problems;
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
    if (base.repo !== UPSTREAM) problems.push(`it builds on ${base.repo}, not ${UPSTREAM}`);
    if (!release) problems.push(`its base is ${base.tag}, not an exact release of upstream's image (\`v1.26.1-p0\`)`);
  }
  for (const line of text.split('\n')) {
    if (!/^\s*#\s*[a-z][a-z0-9]*\s*=/i.test(line)) break;
    problems.push(`\`${line}\` is a parser directive: it changes the build, and the image's name skips it as a comment. Remove it`);
  }
  const instructions = instructionsOf(text);
  const kinds = instructions.map((i) => /^\s*(\S+)/.exec(i)?.[1]?.toUpperCase() ?? '');
  if (JSON.stringify(kinds) !== JSON.stringify(['FROM', 'USER', 'RUN', 'USER', 'RUN'])) {
    return [...problems, `its instructions are ${JSON.stringify(kinds)}, not FROM, USER, RUN, USER, RUN: anything else reads files the name does not cover, or changes upstream's interface`];
  }
  const [, asRoot, packages, asUpstream, proof] = instructions as [string, string, string, string, string];
  if (asRoot !== 'USER root') problems.push(`\`${asRoot}\` before the packages' RUN, not USER root, which apk needs`);
  if (asUpstream !== 'USER postgres') problems.push(`the image's user is \`${asUpstream}\`, not USER postgres, which upstream's config names: the pooler would start as somebody else`);
  for (const i of instructions) if (/--mount\b/i.test(i)) problems.push(`\`${i.split('\n')[0]}\` mounts something the name does not cover`);
  problems.push(...apkProblems(instructions));
  // The packages' RUN names the five once, the same in each of its three lists.
  if (!/^RUN set -eu;/.test(packages)) problems.push('the packages\' RUN does not start with `set -eu;`: a check that fails could be passed by');
  const listed = /\bfor pin in ([^;]*); do\b/.exec(packages)?.[1]?.trim().split(/\s+/) ?? [];
  if (JSON.stringify(listed) !== JSON.stringify(NAMED)) problems.push(`the RUN checks ${JSON.stringify(listed)} against the base, not ${NAMED.join(' ')}`);
  if (!packages.includes(`apk add --no-cache ${NAMED.join(' ')} ||`)) problems.push(`the RUN's apk add does not take ${NAMED.join(' ')}, each at its exact version`);
  // The proof names the release the FROM does, and the client the first RUN installs.
  if (!/^RUN set -eu;/.test(proof)) problems.push('the last RUN does not start with `set -eu;`');
  if (!proof.includes('[ "$who" = postgres:70 ] ||')) problems.push('the last RUN does not hold its user to postgres:70');
  const pooler = /\[ "\$pooler" = 'PgBouncer ([\d.]+)' \] \|\|/.exec(proof)?.[1];
  if (!pooler) problems.push('the last RUN does not ask pgbouncer for one release');
  else if (release && pooler !== release) problems.push(`the last RUN asks pgbouncer for ${pooler}, and the FROM is PgBouncer ${release}: re-read the header, the new image's packages and its NEWS, and move the RUNs with it`);
  const client = /\[ "\$client" = 'psql \(PostgreSQL\) ([\d.]+)' \] \|\|/.exec(proof)?.[1];
  const installed = PINS['postgresql18-client']!.replace(/-r\d+$/, '');
  if (client !== installed) problems.push(`the last RUN asks psql for ${String(client)}, and the first installs the client of ${installed}`);
  return problems;
}

/**
 * A stand-in for apk in the RUN's shell: `version -t` compares as apk does
 * for the versions the tests give it, and `add` takes the named versions into
 * the package database, takes one package more besides (`more`), or fails as
 * apk fails when the mirror no longer serves a version (`unserved`).
 */
const APK_STUB = String.raw`const fs = require('node:fs');
const [command, ...args] = process.argv.slice(2);
fs.appendFileSync(process.env.APK_STUB_LOG, [command, ...args].join(' ') + '\n');
if (command === 'version' && args[0] === '-t') {
  const c = args[1].localeCompare(args[2], 'en', { numeric: true });
  process.stdout.write(c < 0 ? '<\n' : c > 0 ? '>\n' : '=\n');
  process.exit(0);
}
if (command === 'add') {
  if (process.env.APK_STUB_MODE === 'unserved') {
    process.stderr.write('ERROR: unable to select packages:\n  zlib-1.4-r1:\n    breaks: world[zlib=1.4-r0]\n');
    process.exit(1);
  }
  const pins = args.filter((a) => !a.startsWith('-'));
  if (process.env.APK_STUB_MODE === 'more') pins.push(process.env.APK_STUB_MORE);
  let db = fs.readFileSync(process.env.APK_STUB_DB, 'utf8');
  for (const pin of pins) {
    const [name, version] = pin.split('=');
    db = db.replace(new RegExp('^(P:' + name + '\\nV:).*$', 'm'), '$1' + version);
  }
  fs.writeFileSync(process.env.APK_STUB_DB, db);
  process.exit(0);
}
process.stderr.write('the stand-in apk has no ' + command + '\n');
process.exit(2);
`;

/** The Dockerfile's two RUNs as the builder hands them to /bin/sh. */
function runsOf(dockerfile: string): [string, string] {
  const runs = instructionsOf(dockerfile).filter((i) => /^RUN\s/.test(i)).map((i) => i.replace(/^RUN\s+/, ''));
  expect(runs, 'the Dockerfile has not two RUNs').toHaveLength(2);
  return runs as [string, string];
}

/**
 * Runs the packages' RUN on a package database of `base` and the stand-in apk
 * (which, in `more`, also moves `more`): what it exited with, what it said,
 * what it asked apk and what it left installed.
 */
function runPackages(dockerfile: string, mode: 'ok' | 'more' | 'unserved', base: Readonly<Record<string, string>> = BASE_PACKAGES, more = 'libcrypto3=3.5.9-r0') {
  const dir = mkdtempSync(join(tmpdir(), 'pooler-apk-'));
  try {
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'tmp'));
    writeFileSync(join(dir, 'bin/package.json'), '{"type":"commonjs"}\n');
    writeFileSync(join(dir, 'bin/apk'), `#!${process.execPath}\n${APK_STUB}`, { mode: 0o755 });
    writeFileSync(join(dir, 'installed'), Object.entries(base).map(([name, version]) => `P:${name}\nV:${version}\nA:x86_64\n`).join('\n'));
    const script = runsOf(dockerfile)[0].replaceAll('/tmp/', `${join(dir, 'tmp')}/`).replaceAll('/lib/apk/db/installed', join(dir, 'installed'));
    expect(script, 'the RUN reads a package database this test did not stand in for').not.toContain('/lib/apk/');
    writeFileSync(join(dir, 'log'), '');
    const ran = spawnSync('sh', ['-c', script], {
      encoding: 'utf8',
      env: { PATH: `${join(dir, 'bin')}:${process.env['PATH'] ?? ''}`, LC_ALL: 'C', APK_STUB_MODE: mode, APK_STUB_MORE: more, APK_STUB_DB: join(dir, 'installed'), APK_STUB_LOG: join(dir, 'log') },
    });
    const installed = Object.fromEntries([...readFileSync(join(dir, 'installed'), 'utf8').matchAll(/^P:(.+)\nV:(.+)$/gm)].map((m) => [m[1]!, m[2]!]));
    return { status: ran.status, stderr: ran.stderr, asked: readFileSync(join(dir, 'log'), 'utf8'), installed, left: readdirSync(join(dir, 'tmp')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the last RUN with stand-ins for `id`, `pgbouncer` and `psql` that answer as told. */
function runProof(dockerfile: string, answers: { user?: string; uid?: string; pooler?: string; client?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pooler-proof-'));
  try {
    mkdirSync(join(dir, 'bin'));
    const stub = (name: string, body: string) => writeFileSync(join(dir, 'bin', name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    stub('id', 'case "$1" in -un) echo "$STUB_USER" ;; -u) echo "$STUB_UID" ;; *) exit 2 ;; esac');
    stub('pgbouncer', '[ "$1" = --version ] || exit 2; printf \'%s\\nlibevent 2.1.13-stable\\nadns: evdns2\\ntls: OpenSSL 3.5.8\\n\' "$STUB_POOLER"');
    stub('psql', '[ "$1" = --version ] || exit 2; echo "$STUB_CLIENT"');
    const ran = spawnSync('sh', ['-c', runsOf(dockerfile)[1]], {
      encoding: 'utf8',
      env: {
        PATH: `${join(dir, 'bin')}:${process.env['PATH'] ?? ''}`,
        STUB_USER: answers.user ?? 'postgres',
        STUB_UID: answers.uid ?? '70',
        STUB_POOLER: answers.pooler ?? 'PgBouncer 1.26.1',
        STUB_CLIENT: answers.client ?? 'psql (PostgreSQL) 18.7',
      },
    });
    return { status: ran.status, out: `${ran.stdout}${ran.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Service {
  image?: string;
  build?: string | { context?: string };
  pull_policy?: string;
  user?: string | number;
  read_only?: boolean;
  tmpfs?: string[];
  security_opt?: string[];
  cap_drop?: string[];
  cap_add?: string[];
  healthcheck?: { test?: string | string[] };
  volumes?: string[];
}

const servicesOf = (text: string) => (parseYaml(text) as { services: Record<string, Service> }).services;

/** The shell command of the pooler's healthcheck, as the container runs it. */
function healthcheckOf(svc: Service): string | null {
  const test = svc.healthcheck?.test;
  return Array.isArray(test) && test[0] === 'CMD-SHELL' && typeof test[1] === 'string' ? test[1] : null;
}

/** What is wrong with managed.yml's pooler; empty when it holds. */
function composeProblems(managed: string, dockerfile: string): string[] {
  const problems: string[] = [];
  const want = `${NAME}:${builtTag(dockerfile)}`;
  const services = servicesOf(managed);
  const svc = services[SERVICE];
  if (!svc) return [`${MANAGED} has no ${SERVICE}`];
  for (const [name, other] of Object.entries(services)) {
    const repo = other.image ? parseRef(other.image).repo : '';
    if (repo === UPSTREAM) problems.push(`${MANAGED}:${name} runs ${String(other.image)}, upstream's image, on packages Alpine has fixed since: run ${want}, built from ./pgbouncer, or take the whole build out as the Dockerfile's header says (THE WAY OUT)`);
    else if (repo === NAME && name !== SERVICE) problems.push(`${MANAGED}:${name} runs the pooler's build too, which only ${SERVICE} may`);
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
    } else if (!(svc.image && parseRef(svc.image).repo === UPSTREAM)) {
      problems.push(`${SERVICE} runs ${String(svc.image)}, not ${want}, built from ./pgbouncer`);
    }
  }
  if (svc.build !== './pgbouncer') problems.push(`${SERVICE}'s build: is ${JSON.stringify(svc.build)}, not the bare \`./pgbouncer\`: args, a target or a Dockerfile of its own are inputs the name does not carry`);
  if (svc.pull_policy !== 'never') problems.push(`${SERVICE} has pull_policy ${String(svc.pull_policy)}, not never: no registry serves ${want}`);
  if (svc.user !== undefined) problems.push(`${SERVICE} sets user: ${String(svc.user)}; the image's own user is upstream's postgres, which the build keeps and proves`);
  if (!/\bpsql\b/.test(healthcheckOf(svc) ?? '')) problems.push(`${SERVICE}'s healthcheck no longer runs psql in a shell: the Dockerfile's header says psql is what loads libpq here, and images.yml's job asks with that command`);
  return problems;
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
  strategy?: { matrix?: { include?: Array<{ arch?: string; runner?: string }> } };
  steps: Step[];
}

const jobOf = (workflow: string) => (parseYaml(workflow) as { jobs: Record<string, Job> }).jobs['pgbouncer'];
/** The step that builds and asks the pooler. */
const stepOf = (workflow: string) => jobOf(workflow)?.steps.find((s) => s.run?.includes('docker build'))?.run ?? '';

/** What is wrong with images.yml's build of the pooler; empty when it holds. */
function workflowProblems(workflow: string, managed: string): string[] {
  const problems: string[] = [];
  const job = jobOf(workflow);
  if (!job) return ['images.yml has no pgbouncer job: nothing builds the pooler before E2E (managed), on either platform'];
  if (job.name !== 'build (pgbouncer, ${{ matrix.arch }})') problems.push(`its name is ${String(job.name)}, not build (pgbouncer, \${{ matrix.arch }}), which every-pr-check-is-classified names`);
  if (job.if !== "github.event_name == 'pull_request'") problems.push(`it runs ${String(job.if)}, not on a pull request only`);
  if (JSON.stringify(job.permissions) !== JSON.stringify({ contents: 'read' })) problems.push(`its permissions are ${JSON.stringify(job.permissions)}, not contents: read`);
  const legs = (job.strategy?.matrix?.include ?? []).map((l) => `${String(l.arch)} on ${String(l.runner)}`);
  if (JSON.stringify(legs) !== JSON.stringify(['amd64 on ubuntu-24.04', 'arm64 on ubuntu-24.04-arm'])) problems.push(`it builds ${JSON.stringify(legs)}, not amd64 and arm64, each natively: Alpine builds the packages per platform`);
  const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
  if (checkout?.with?.['persist-credentials'] !== false) problems.push('its checkout keeps a credential');
  const run = stepOf(workflow);
  if (!/^set -euo pipefail$/m.test(run)) problems.push('its script does not start with set -euo pipefail');
  if (!run.includes(`docker build --pull --progress=plain --tag "$ref" ${CONTEXT}\n`)) problems.push(`it does not build ${CONTEXT} under the name it read`);
  if (!run.includes(`\\(${NAME.replace('/', '\\/')}:[^[:space:]]*\\)`)) problems.push(`it does not read the name from managed.yml's ${NAME} line`);
  const svc = servicesOf(managed)[SERVICE];
  if (!svc) return [...problems, `${MANAGED} has no ${SERVICE}`];
  // managed.yml's healthcheck, word for word: compose writes `$$` for the shell's `$`.
  const asked = /^\s*healthcheck="(.*)"$/m.exec(run)?.[1]?.replaceAll('\\$', '$');
  const healthcheck = healthcheckOf(svc)?.replaceAll('$$', '$');
  if (!healthcheck || asked !== healthcheck) problems.push(`it asks the pooler with \`${String(asked)}\`, and ${SERVICE}'s healthcheck is \`${String(healthcheck)}\`: the two move together`);
  if (!run.includes('if docker exec pooler-built sh -c "$healthcheck"; then')) problems.push('it does not run that command in the container');
  // The container as managed.yml runs it.
  const start = /docker run -d --name pooler-built \\\n([\s\S]*?)"\$ref" >\/dev\/null\n/.exec(run)?.[1] ?? '';
  const flags = [
    [svc.read_only === true, '--read-only'],
    [JSON.stringify(svc.tmpfs) === '["/tmp"]', '--tmpfs /tmp'],
    [JSON.stringify(svc.security_opt) === '["no-new-privileges:true"]', '--security-opt no-new-privileges:true'],
    [JSON.stringify(svc.cap_drop) === '["ALL"]', '--cap-drop ALL'],
  ] as const;
  for (const [inCompose, flag] of flags) {
    if (inCompose !== start.includes(`${flag} `)) problems.push(`it starts the pooler ${start.includes(`${flag} `) ? 'with' : 'without'} ${flag}, and ${SERVICE} in managed.yml does the other: the two move together`);
  }
  if ((svc.cap_add ?? []).length === 0 && /--cap-add\b|--privileged\b|--user\b|\s-u\s/.test(start)) problems.push(`it starts the pooler with a capability or a user ${SERVICE} does not have`);
  const ini = (svc.volumes ?? []).find((v) => v.endsWith(':/etc/pgbouncer/pgbouncer.ini:ro'));
  if (!ini || !start.includes(`-v "$PWD/deploy/compose/${ini.replace(/^\.\//, '')}" `)) problems.push(`it does not mount ${SERVICE}'s pgbouncer.ini (${String(ini)}) as managed.yml does`);
  if (!start.includes(':/etc/pgbouncer/userlist.txt:ro" ')) problems.push('it mounts no userlist where the pooler reads it, read-only');
  const commands = run.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  for (const line of commands) {
    if (/(^|[\s;&|(])exit\b/.test(line) && !/(^|[\s;&|(])exit 1"?$/.test(line)) problems.push(`\`${line}\` exits, and not to fail`);
  }
  return problems;
}

/**
 * The stubs the step runs against, as shell functions ahead of it. `docker`:
 * every call is logged; the pull, the build and the run succeed; `image
 * inspect` answers upstream's configuration for the base, and for the build
 * too unless WRONG_FIELD names a field, and the platform PLATFORM names;
 * `exec` answers the healthcheck with HEALTH, the package database with
 * PACKAGES, process 1 with PID1_UID and PID1_COMM, and SHOW POOLS with POOLS.
 * `openssl` and `sleep` return.
 */
const STUBS = String.raw`docker() {
  printf '%s\n' "$*" >> "$DOCKER_LOG"
  case "$1" in
    pull|build) return 0 ;;
    run) echo 0123456789ab ;;
    image)
      case "$4" in
        '{{.Os}}/{{.Architecture}}') echo "$PLATFORM" ;;
        '{{.Id}}, user {{.Config.User}}') echo 'sha256:stub, user postgres' ;;
        '{{json .Config.'*'}}')
          field="$(printf '%s' "$4" | sed -e 's/^{{json \.Config\.//' -e 's/}}$//')"
          case "$5" in localhost/*) if [ "$field" = "$WRONG_FIELD" ]; then echo '"not upstream"'; return 0; fi ;; esac
          case "$field" in
            User) echo '"postgres"' ;;
            Entrypoint) echo '["/entrypoint.sh"]' ;;
            Cmd) echo '["/usr/bin/pgbouncer","/etc/pgbouncer/pgbouncer.ini"]' ;;
            WorkingDir) echo '"/"' ;;
            ExposedPorts) echo '{"5432/tcp":{}}' ;;
            Env) echo '["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"]' ;;
            *) echo "unexpected field: $field" >&2; return 3 ;;
          esac ;;
        *) echo "unexpected: docker $*" >&2; return 3 ;;
      esac ;;
    exec)
      shift 2
      case "$*" in
        'sh -c PGPASSWORD=$''{PGBOUNCER_AUTH_PASSWORD} psql -h 127.0.0.1 -p 6432 -U pgbouncer_auth -d pgbouncer -c '*' >/dev/null 2>&1 || exit 1') return "$HEALTH" ;;
        *'-tAc "SHOW POOLS"') printf '%s\n' "$POOLS" ;;
        awk*' /lib/apk/db/installed') printf '%s\n' "$PACKAGES" ;;
        awk*' /proc/1/status') echo "$PID1_UID" ;;
        'cat /proc/1/comm') echo "$PID1_COMM" ;;
        'psql --version') echo 'psql (PostgreSQL) 18.7' ;;
        *) echo "unexpected: docker exec $*" >&2; return 3 ;;
      esac ;;
    *) echo "unexpected: docker $*" >&2; return 3 ;;
  esac
}
openssl() { echo 0123456789abcdef0123456789abcdef; }
sleep() { :; }
`;

/** What the stub docker answers when the build is as it should be. */
const RIGHT: Readonly<Record<string, string>> = {
  WRONG_FIELD: '',
  PLATFORM: 'linux/amd64',
  HEALTH: '0',
  PACKAGES: [...Object.entries({ ...BASE_PACKAGES, ...PINS })].map(([name, version]) => `${name}=${version}`).join('\n'),
  PID1_UID: '70',
  PID1_COMM: 'pgbouncer',
  POOLS: 'pgbouncer|pgbouncer|1|0|0|0|0|0|0|0|0|0|0|statement|0',
};

/** Wrong answers, each given to the step in a run of its own: none may pass. */
const WRONG: ReadonlyArray<readonly [what: string, answers: Record<string, string>]> = [
  ['a build whose user is not upstream\'s', { WRONG_FIELD: 'User' }],
  ['a build whose command is not upstream\'s', { WRONG_FIELD: 'Cmd' }],
  ['a build whose entrypoint is not upstream\'s', { WRONG_FIELD: 'Entrypoint' }],
  ['a build for another platform', { PLATFORM: 'linux/arm64' }],
  ['a pooler that never passes the healthcheck', { HEALTH: '1' }],
  ['a package still at the base\'s version', { PACKAGES: RIGHT['PACKAGES']!.replace('zlib=1.4-r0', 'zlib=1.3.2-r0') }],
  ['an exec that reads no package database', { PACKAGES: '' }],
  ['process 1 as root', { PID1_UID: '0' }],
  ['process 1 a shell, not the pooler', { PID1_COMM: 'sh' }],
  ['no pool listed', { POOLS: '' }],
];

/** Runs the step as GitHub runs it (bash -eo pipefail), in this checkout, after the stubs. */
function runStep(run: string, answers: Record<string, string> = {}): { status: number; out: string; docker: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'pooler-step-'));
  try {
    const script = join(dir, 'step.sh');
    writeFileSync(script, `${STUBS}${run}`);
    const log = join(dir, 'docker.log');
    writeFileSync(log, '');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: dir, CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_TEMP: dir, ARCH: 'amd64', DOCKER_LOG: log, ...RIGHT, ...answers },
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, docker: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What is wrong with the job's verdict; empty when it holds. */
function verdictProblems(workflow: string, dockerfile: string): string[] {
  const run = stepOf(workflow);
  const want = `${NAME}:${builtTag(dockerfile)}`;
  const right = runStep(run);
  if (right.status !== 0 || /^::error::/m.test(right.out)) return [`with a build as it should be, the step exits ${right.status}:\n${right.out}`];
  if (!right.docker.includes(`build --pull --progress=plain --tag ${want} ${CONTEXT}`)) return [`the step does not build ${CONTEXT} as ${want}: ${JSON.stringify(right.docker)}`];
  if (!right.docker.includes(`pull --quiet ${dockerfileBase(dockerfile).ref}`)) return [`the step does not pull the Dockerfile's base to compare with: ${JSON.stringify(right.docker)}`];
  for (const [what, answers] of WRONG) {
    const r = runStep(run, answers);
    if (r.status === 0 || !/^::error::/m.test(r.out)) return [`with ${what}, the step exits ${r.status} without an error: its verdict is not the checks'\n${r.out}`];
  }
  return [];
}

describe("the pooler is upstream's image with five Alpine packages at exact versions, and nothing else changed", () => {
  const dockerfile = read(DOCKERFILE);
  const swap = (from: RegExp | string, to: string) => {
    const text = dockerfile.replace(from, to);
    expect(text, `${String(from)} matched nothing`).not.toBe(dockerfile);
    return text;
  };

  it("the Dockerfile is a FROM by tag and digest, the packages' RUN as root, and the proof as upstream's user", () => {
    expect(dockerfileProblems(dockerfile)).toEqual([]);
    expect(releaseOf(dockerfileBase(dockerfile).tag)).not.toBeNull();
  });

  it('refuses each way the Dockerfile could drift from its name, from upstream, or from what it names', () => {
    const problems = (from: RegExp | string, to: string) => dockerfileProblems(swap(from, to));
    const base = dockerfileBase(dockerfile);
    // Another image, a tag that is no exact release, a tag without its digest.
    expect(problems(/^FROM edoburu\/pgbouncer:/m, 'FROM bitnami/pgbouncer:')).toEqual([expect.stringContaining(`not ${UPSTREAM}`)]);
    expect(problems(/^FROM edoburu\/pgbouncer:v[\d.]+-p\d+@/m, 'FROM edoburu/pgbouncer:latest@')).toEqual([expect.stringContaining('not an exact release')]);
    expect(problems(base.ref, `${UPSTREAM}:${base.tag}`)).toEqual([expect.stringContaining('carries no tag and digest')]);
    // A newer PgBouncer in the FROM with the RUNs not read again: what Dependabot's pull request is until somebody does.
    expect(problems(/^FROM edoburu\/pgbouncer:v[\d.]+-p\d+@/m, 'FROM edoburu/pgbouncer:v1.99.0-p0@')).toEqual([expect.stringContaining('re-read the header')]);
    // What the builder reads that the name does not cover, and an interface that is no longer upstream's.
    expect(dockerfileProblems(`# syntax=docker/dockerfile:1\n${dockerfile}`)).toEqual([expect.stringContaining('is a parser directive')]);
    for (const line of ['COPY pgbouncer.ini /etc/pgbouncer/pgbouncer.ini', 'ADD https://example.org/x /tmp/', 'ENTRYPOINT ["/usr/bin/pgbouncer"]', 'CMD ["/usr/bin/pgbouncer", "-v"]', 'ENV PGSSLMODE=disable', 'USER root']) {
      expect(dockerfileProblems(`${dockerfile}${line}\n`), line).toEqual([expect.stringContaining('not FROM, USER, RUN, USER, RUN')]);
    }
    expect(problems(/^USER postgres$/m, 'USER root')).toEqual([expect.stringContaining('not USER postgres')]);
    expect(problems(/^USER postgres$/m, 'USER 70')).toEqual([expect.stringContaining('not USER postgres')]);
    expect(problems(/^USER root$/m, 'USER postgres')).toEqual([expect.stringContaining('not USER root')]);
    expect(problems(/^RUN set -eu; \\$/m, 'RUN --mount=type=bind,target=/src set -eu; \\')).toEqual(expect.arrayContaining([expect.stringContaining('mounts something')]));
    // apk asked for more than the versions the line names.
    expect(problems('apk add --no-cache libpq=', 'apk add --no-cache --upgrade libpq=')).toEqual(expect.arrayContaining([expect.stringContaining('an option beyond --no-cache')]));
    expect(problems(/(apk add --no-cache [^|]*)zlib=1\.4-r0 \|\|/, '$1zlib ||')).toEqual(expect.arrayContaining([expect.stringContaining('not one exact version')]));
    expect(problems(/(apk add --no-cache [^|]*)zlib=1\.4-r0 \|\|/, '$1"zlib>=1.4-r0" ||')).toEqual(expect.arrayContaining([expect.stringContaining('not one exact version')]));
    expect(problems('    installed > /tmp/apk-before; \\\n', '    apk upgrade --no-cache; \\\n    installed > /tmp/apk-before; \\\n')).toEqual([expect.stringContaining('`apk upgrade` changes what is installed')]);
    // A package dropped from one list and not the others, and a proof that asks for less.
    expect(problems(/\bfor pin in libpq=\S+ /, 'for pin in ')).toEqual([expect.stringContaining('against the base, not')]);
    expect(problems(/(apk add --no-cache libpq=\S+ )musl=\S+ /, '$1')).toEqual([expect.stringContaining("apk add does not take")]);
    expect(problems("[ \"$pooler\" = 'PgBouncer 1.26.1' ] ||", "[ -n \"$pooler\" ] ||")).toEqual([expect.stringContaining('does not ask pgbouncer for one release')]);
    expect(problems("'psql (PostgreSQL) 18.7' ] ||", "'psql (PostgreSQL) 18.6' ] ||")).toEqual([expect.stringContaining('asks psql for 18.6')]);
    expect(problems('[ "$who" = postgres:70 ] ||', '[ -n "$who" ] ||')).toEqual([expect.stringContaining('postgres:70')]);
  });

  it("the packages' RUN takes exactly the five versions, refuses a base that carries one, and says what to do when it cannot", () => {
    const ok = runPackages(dockerfile, 'ok');
    expect(ok.stderr).toBe('');
    expect(ok.status).toBe(0);
    expect(ok.asked).toContain(`add --no-cache ${NAMED.join(' ')}\n`);
    expect(ok.installed).toEqual({ ...BASE_PACKAGES, ...PINS });
    expect(ok.left, 'the RUN leaves files in /tmp').toEqual([]);
    // Alpine's mirror no longer serves a version, or cannot be reached: apk's error, then the build's own words.
    const unserved = runPackages(dockerfile, 'unserved');
    expect(unserved.status).toBe(1);
    const said = unserved.stderr.slice(unserved.stderr.indexOf('breaks: world'));
    for (const words of [
      "Alpine's libpq 18.7-r0, musl 1.2.6-r3, musl-utils 1.2.6-r3, postgresql18-client 18.7-r0 and zlib 1.4-r0 could not be installed",
      "cannot reach Alpine's mirror, dl-cdn.alpinelinux.org",
      'the mirror no longer serves those versions',
      'a machine that has the image keeps running it',
      `a pull request moves the versions ${DOCKERFILE} names`,
    ]) {
      expect(said, `the failure does not say "${words}"`).toContain(words);
    }
    expect(unserved.stderr).not.toContain('changed more than');
    // Anything else moved: a library the pooler links, or the client's own dependency.
    for (const extra of ['libcrypto3=3.5.9-r0', 'postgresql-common=1.3-r1']) {
      const more = runPackages(dockerfile, 'more', BASE_PACKAGES, extra);
      expect(more.status, extra).toBe(1);
      expect(more.stderr, extra).toContain('The install changed more than libpq, musl, musl-utils, postgresql18-client and zlib');
      expect(more.stderr, extra).toContain(` ${extra}`);
    }
    // The base carries a fix already, any of the five: refused before anything is installed, with the way out.
    for (const [name, version] of Object.entries(PINS)) {
      const fixed = runPackages(dockerfile, 'ok', { ...BASE_PACKAGES, [name]: version });
      expect(fixed.status, name).toBe(1);
      expect(fixed.stderr, name).toContain(`The base's ${name} is '${version}', not older than ${version}: upstream's image carries that fix. Take ${name} out of this RUN, and the whole build out once it names none`);
      expect(fixed.asked, `${name}: it installed before it refused`).not.toMatch(/^add /m);
    }
    // A check cut out lets what it was for through: the after-check, then the before-check.
    const unchecked = swap(/if \[ "\$added" != [^\n]*; then \\$/m, 'if false; then \\');
    expect(runPackages(unchecked, 'more').status, 'without its after-check the RUN takes an install that moved more').toBe(0);
    const unasked = swap(`!= '<' ]; then`, `= 'never' ]; then`);
    expect(runPackages(unasked, 'ok', { ...BASE_PACKAGES, zlib: PINS['zlib']! }).stderr, 'without its before-check the RUN installs on a base that has the fix').not.toContain('carries that fix');
  });

  it("the last RUN passes as upstream's user with the pooler and client it names, and fails each other way", () => {
    const ok = runProof(dockerfile);
    expect(ok.out).toContain('as postgres:70, PgBouncer 1.26.1 and psql (PostgreSQL) 18.7 start.');
    expect(ok.status).toBe(0);
    for (const [what, answers, says] of [
      ['root', { user: 'root', uid: '0' }, 'runs as root:0, not postgres:70'],
      ['another uid under the same name', { uid: '1000' }, 'runs as postgres:1000, not postgres:70'],
      ['another PgBouncer', { pooler: 'PgBouncer 1.26.0' }, "printed 'PgBouncer 1.26.0', not PgBouncer 1.26.1"],
      ['a pooler that printed nothing', { pooler: '' }, "printed '', not PgBouncer 1.26.1"],
      ["the base's client", { client: 'psql (PostgreSQL) 18.6' }, "printed 'psql (PostgreSQL) 18.6', not psql (PostgreSQL) 18.7"],
    ] as const) {
      const r = runProof(dockerfile, answers);
      expect(r.status, what).toBe(1);
      expect(r.out, what).toContain(says);
    }
  });
});

describe('managed.yml runs that build, by the name its instructions give it', () => {
  const dockerfile = read(DOCKERFILE);
  const managed = read(MANAGED);

  it('runs it as localhost/pgbouncer:<builtTag>, built here and never pulled', () => {
    expect(composeProblems(managed, dockerfile)).toEqual([]);
    const pooler = readImages(managed).filter((i) => i.repo === NAME);
    expect(pooler.map((i) => i.tag)).toEqual([builtTag(dockerfile)]);
    expect(readImages(managed).filter((i) => i.repo === UPSTREAM)).toEqual([]);
  });

  it('prints the sed that moves a name the Dockerfile moved past, and the sed moves it', () => {
    const edited = dockerfile.replace("echo \"$me: as $who, $pooler and $client start.\"", "echo \"$me: as $who, $pooler and $client both start.\"");
    expect(edited).not.toBe(dockerfile);
    const problems = composeProblems(managed, edited);
    expect(problems).toHaveLength(1);
    const sed = /^ {2}(sed -i -e '[^']+') deploy\/compose\/managed\.yml$/m.exec(problems[0]!)?.[1];
    expect(sed, problems[0]).toBeDefined();
    expect(problems[0]).toMatch(new RegExp(`deploy/compose/managed\\.yml:\\d+ \\(${SERVICE}\\)`));
    const dir = mkdtempSync(join(tmpdir(), 'pooler-name-'));
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

  it("refuses upstream's image beside the build, another build, a pull, a user, and a healthcheck without psql", () => {
    const problems = (from: RegExp, to: string) => {
      const text = managed.replace(from, to);
      expect(text, `${String(from)} matched nothing`).not.toBe(managed);
      return composeProblems(text, dockerfile);
    };
    const base = dockerfileBase(dockerfile);
    // The image line back to upstream's with the build left in: half of the way out.
    expect(problems(/^(\s*image:\s*)localhost\/pgbouncer:\S+$/m, `$1${base.ref}`)).toEqual([expect.stringContaining("upstream's image, on packages Alpine has fixed since")]);
    expect(problems(/^(\s*)build: \.\/pgbouncer$/m, '$1build:\n$1  context: ./pgbouncer')).toEqual([expect.stringContaining('not the bare `./pgbouncer`')]);
    expect(problems(/^(\s*build: \.\/pgbouncer\n)\s*pull_policy: never\n/m, '$1')).toEqual([expect.stringContaining('not never')]);
    expect(problems(/^(\s*build: \.\/pgbouncer\n)/m, '$1    user: "0"\n')).toEqual([expect.stringContaining('sets user: 0')]);
    expect(problems(/test: \["CMD-SHELL", "PGPASSWORD=[^\n]*psql[^\n]*\]/, 'test: ["CMD", "pg_isready", "-h", "127.0.0.1", "-p", "6432"]')).toEqual([expect.stringContaining('no longer runs psql')]);
    expect(problems(/^(\s*image: )localhost\/redis:\S+$/m, `$1${NAME}:${builtTag(dockerfile)}`)).toEqual(expect.arrayContaining([expect.stringContaining("runs the pooler's build too")]));
  });
});

describe('images.yml builds it on a pull request, on both platforms, and asks it as the healthcheck does', () => {
  const workflow = read(IMAGES_WORKFLOW);
  const managed = read(MANAGED);
  const dockerfile = read(DOCKERFILE);
  const swapped = (text: string, from: RegExp | string, to: string) => {
    const out = text.replace(from, to);
    expect(out, `${String(from)} matched nothing`).not.toBe(text);
    return out;
  };

  it("builds this directory under managed.yml's name and starts it as managed.yml runs the pooler", () => {
    expect(workflowProblems(workflow, managed)).toEqual([]);
  });

  it("the job's verdict is the checks'", () => {
    expect(verdictProblems(workflow, dockerfile)).toEqual([]);
  }, 120_000);

  it('refuses a job that drifted from managed.yml, or stopped asking', () => {
    const problems = (wf: string, m = managed) => workflowProblems(wf, m);
    expect(problems(workflow, swapped(managed, "-d pgbouncer -c 'SHOW POOLS' >/dev/null", "-d pgbouncer -c 'SHOW STATS' >/dev/null"))).toEqual([expect.stringContaining('the two move together')]);
    expect(problems(workflow, swapped(managed, /( {2}pgbouncer:\n(?:.*\n)*? {4}cap_add: \[\]\n) {4}read_only: true\n/, '$1'))).toEqual([expect.stringContaining('with --read-only')]);
    expect(problems(swapped(workflow, '            --read-only --tmpfs /tmp \\\n', '            --tmpfs /tmp \\\n'))).toEqual([expect.stringContaining('without --read-only')]);
    expect(problems(swapped(workflow, '--security-opt no-new-privileges:true --cap-drop ALL \\\n            -e PGBOUNCER_AUTH_PASSWORD', '--security-opt no-new-privileges:true --cap-drop ALL --cap-add NET_BIND_SERVICE \\\n            -e PGBOUNCER_AUTH_PASSWORD'))).toEqual([
      expect.stringContaining('a capability or a user'),
    ]);
    expect(problems(swapped(workflow, '/deploy/compose/pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro', '/deploy/compose/pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini'))).toEqual([expect.stringContaining("does not mount pgbouncer's pgbouncer.ini")]);
    expect(problems(swapped(workflow, `--tag "$ref" ${CONTEXT}\n`, '--tag "$ref" deploy/compose/redis\n'))).toHaveLength(1);
    expect(problems(swapped(workflow, 'name: build (pgbouncer, ${{ matrix.arch }})', 'name: build (pooler, ${{ matrix.arch }})'))).toEqual([expect.stringContaining('every-pr-check-is-classified')]);
    expect(problems(swapped(workflow, /( {2}pgbouncer:\n(?:.*\n)*? {10}- arch: amd64\n {12}runner: ubuntu-24\.04\n) {10}- arch: arm64\n {12}runner: ubuntu-24\.04-arm\n/, '$1'))).toEqual([expect.stringContaining('each natively')]);
    expect(problems(swapped(workflow, '          # The five packages, as the running image', '          exit 0\n          # The five packages, as the running image'))).toEqual([expect.stringContaining('`exit 0` exits, and not to fail')]);
  });

  it('refuses a step that passes a build it should not', () => {
    const verdict = (wf: string) => verdictProblems(wf, dockerfile);
    expect(verdict(swapped(workflow, 'for field in User Entrypoint Cmd WorkingDir ExposedPorts Env; do', 'for field in Entrypoint Cmd WorkingDir ExposedPorts Env; do'))).toEqual([
      expect.stringMatching(/^with a build whose user is not upstream's, the step exits 0/),
    ]);
    expect(verdict(swapped(workflow, 'if [ "$uid" != 70 ] || [ "$comm" != pgbouncer ]; then', 'if [ "$comm" != pgbouncer ]; then'))).toEqual([expect.stringMatching(/^with process 1 as root, the step exits 0/)]);
    expect(verdict(swapped(workflow, 'if ! grep -qxF "$pin" <<<"$have"; then', 'if false; then'))).toEqual([expect.stringMatching(/^with a package still at the base's version, the step exits 0/)]);
    expect(verdict(swapped(workflow, 'if [ "$healthy" != yes ]; then', 'if false; then'))).toEqual([expect.stringMatching(/^with a pooler that never passes the healthcheck, the step exits 0/)]);
  }, 120_000);
});

describe("Dependabot reads the Dockerfile's base, in a pull request of its own", () => {
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
    expect(entry!.ignore).toEqual([{ 'dependency-name': UPSTREAM, 'update-types': ['version-update:semver-major'] }]);
  });
});
