// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TASK BASE THE CLI BUILDS NOTHING INTO (workplan 0119 §3 item 13; the
 * owner's decision of 2026-11-03, for alpha.5: "CI builds it, signs it and
 * publishes it to GHCR like the other release images").
 *
 * The managed tasks run in the image `trigger.dev deploy` builds. Until
 * 2026-11-06 it built them on apps/api/Dockerfile's FROM image, Debian with a
 * layer of apt, trust edits and purges. A distroless base reads 0 critical and
 * 0 high and is about a third smaller, but it has no shell, and a
 * Containerfile that RUNs anything on it fails the deploy. So the base is
 * built once, by CI (`apps/worker/task-image/Dockerfile`, images.yml's
 * `task-base` leg), with everything the CLI's runtime stage needs already in
 * it; `apps/worker/trigger.config.ts` names it by its `sha-<commit>` tag and
 * index digest (`TASK_BASE_IMAGE`) and adds no layer; and the CLI must write
 * no RUN on it. Read at trigger.dev
 * 4.8.3 (`generateNodeContainerfile` and `parseGenerateOptions` in
 * `dist/esm/deploy/buildImage.js`):
 *
 * - The manifest's `image.base` is the first stage, `FROM <base> AS base`, and
 *   the runtime stage is `FROM base AS final`. With no layer instructions and
 *   no packages the base stage holds one ENV line: no apt install, no repair
 *   (`aptRepair` follows instructions only) and none of the CLI's trust edits
 *   (`trustStoreHardening` leaves a custom base alone).
 * - With `image.buildBase` named, the build stage is `FROM <buildBase> AS
 *   build`, so `npm i` and the indexer run there and never on the base.
 * - The runtime stage RUNs nothing: `USER node`, `WORKDIR /app`, ARG and ENV,
 *   three `COPY --chown=node:node`, and `ENTRYPOINT [ "dumb-init", "node",
 *   <controller> ]`, with no PATH or NODE_OPTIONS of its own.
 *
 * So the base must carry a `node` account, dumb-init and node on its PATH,
 * the CLI's trust edits in its CA bundle and `--use-openssl-ca`, and nothing
 * else needs a shell. This file holds:
 *
 * 1. THE CLI, RUN: the installed CLI's own generator, on a base and a build
 *    base with no layer, writes no RUN, ADD or SHELL in any stage that starts
 *    from the base, and the runtime stage names only what the base carries.
 *    A CLI that starts to add a step of its own fails here (item 13's
 *    revisit), and a vacuity case shows a layer's instruction is seen.
 * 2. THE DOCKERFILE: three stages; distroless at apps/api/Dockerfile's runtime
 *    digest and the build stage on its FROM image, so one Debian and one Node
 *    move them all; a runtime stage of COPY from the build stage, ENV, USER,
 *    WORKDIR and ENTRYPOINT only; the PATH with distroless's /nodejs/bin
 *    first; the `node` account at uid and gid 1000; and the CLI's trust edits,
 *    read from the installed CLI: its distrusted roots and its reject
 *    directory, with the eight intermediates byte for byte.
 * 3. THE WORKFLOW: images.yml builds the base in its build job, from its own
 *    directory, on a pull request and on main only (never on a tag: the tasks
 *    name the digest main published, so the OTA stack and live run the same
 *    bytes); runs it on a pull request as the CLI's entrypoint starts it, and
 *    that step, run here against a stand-in docker, fails on a shell, on a
 *    probe that fails, and on a start refused for another reason; and signs it
 *    with the same steps as the other three. Dependabot moves its two FROM
 *    lines in the same group as apps/api/Dockerfile's.
 * 4. THE CONFIG: its extension, run as a deploy runs it, sets the manifest's
 *    base to the pin (`taskBasePin`, the one reader the pin watch, the scan
 *    and Release's verify share) and its build base to the CLI's own build
 *    image for the runtime, and adds no layer; the installed CLI's generator,
 *    on that manifest, writes a Containerfile with nothing on the base but its
 *    one ENV line; and `trigger dev` gets nothing.
 * 5. THE PIN, CHECKED ON A PULL REQUEST: images.yml's `task-base-pin` job,
 *    with no login, run here against a stand-in docker, jq and cosign. It
 *    passes the pin when the index lists both platforms and both pull, its
 *    revision label is the commit its tag names and cosign verifies it with
 *    images.yml's identity on refs/heads/main; it fails on a platform
 *    missing, another revision, a signature refused three times and a config
 *    without the pin; and a Node other than apps/api/Dockerfile's is a warning,
 *    since the base built at a new Node is published only after the pull
 *    request that moves it merges.
 * 6. WHAT RAN, ASKED: the managed smoke asks the newest image its runners
 *    started from (the last deploy's: Trigger.dev keeps a run on the version
 *    it was triggered on, so an earlier deployment's runner can be on the
 *    network too, and its image is named, not asked) for its Node, which must
 *    be the one the preflights found the API running, and for each shell
 *    name, none of which may start. Run here against a stand-in docker: the
 *    API's Node and no shell pass; another Node, a Node that cannot be asked,
 *    a shell that starts, one refused for another reason than its absence, no
 *    image read and an image that cannot be dated fail. The watcher starts a
 *    runner's log first and reads its image on every pass until a read
 *    answers. Until 2026-11-06 the block asked dpkg about the Debian
 *    Essentials the config's layer purged, held by an-essential-nothing-runs.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { BuildContext, BuildExtension, BuildLayer } from '@trigger.dev/core/v3/build';
import { taskBasePin } from './idp-pin-watch.mjs';
import taskConfig from '../apps/worker/trigger.config.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const DOCKERFILE = 'apps/worker/task-image/Dockerfile';
const CONTEXT = 'apps/worker/task-image';
const REJECTED_DIR = 'apps/worker/task-image/emsign-block';
const API_DOCKERFILE = 'apps/api/Dockerfile';
const IMAGES_YML = '.github/workflows/images.yml';
const WORKER_DIR = join(ROOT, 'apps/worker');

/** The matrix leg's include, exactly: on a pull request and on main, never on a tag or another branch. */
const INCLUDE =
  "${{ fromJSON((github.event_name == 'pull_request' || github.ref == 'refs/heads/main') && '[{\"image\":\"task-base\"}]' || '[]') }}";

// ---------------------------------------------------------------- helpers ---

/** A Dockerfile's instructions: continuation lines joined, comments and blank lines dropped. */
function instructionsOf(text: string): string[] {
  const out: string[] = [];
  let open = '';
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!open && (/^\s*#/.test(line) || line.trim() === '')) continue;
    if (line.endsWith('\\')) {
      open += `${line.slice(0, -1)}\n`;
      continue;
    }
    out.push(`${open}${line}`.trim());
    open = '';
  }
  if (open) out.push(open.trim());
  return out;
}

interface Stage {
  from: string;
  name: string;
  body: string[];
}

/** The stages of a Dockerfile or Containerfile, each with what it starts from, its name and its instructions after FROM. */
function stagesOf(text: string): Stage[] {
  const stages: Stage[] = [];
  for (const instruction of instructionsOf(text)) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?$/i.exec(instruction);
    if (from) {
      stages.push({ from: from[1]!, name: from[2] ?? String(stages.length), body: [] });
      continue;
    }
    if (stages.length === 0) continue; // ARG before the first FROM, and parser directives
    stages.at(-1)!.body.push(instruction);
  }
  return stages;
}

/** Every stage that starts from `root`, itself or through another stage. */
function descendants(stages: Stage[], root: string): Stage[] {
  const names = new Set([root]);
  const out: Stage[] = [];
  for (const stage of stages) {
    if (names.has(stage.from)) {
      names.add(stage.name);
      out.push(stage);
    }
  }
  return out;
}

const keyword = (instruction: string) => instruction.split(/\s/, 1)[0]!.toUpperCase();

/** The installed Trigger.dev CLI's Containerfile writer and constants, the ones `deploy-tasks.sh` deploys with. */
async function installedCli(): Promise<{
  version: string;
  generateContainerfile: (options: unknown) => Promise<string>;
  BUILD_IMAGE: Record<string, string>;
  EMSIGN_COMPROMISE_DISTRUSTED_ROOTS: string[];
  EMSIGN_REJECT_DIR: string;
  EMSIGN_COMPROMISE_REJECTED_INTERMEDIATES: Array<{ file: string; pemLines: string[] }>;
}> {
  const dir = join(WORKER_DIR, 'node_modules/trigger.dev');
  expect(existsSync(dir), `${dir} is missing: install the workspace (pnpm install)`).toBe(true);
  const version = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }).version;
  const pinned = (JSON.parse(read('apps/worker/package.json')) as { devDependencies?: Record<string, string> }).devDependencies?.['trigger.dev'];
  expect(version, 'the installed CLI is the one apps/worker pins').toBe(pinned);
  const at = (file: string) => pathToFileURL(realpathSync(join(dir, 'dist/esm/deploy', file))).href;
  const build = await import(at('buildImage.js'));
  const rejected = await import(at('emsignRejectedIntermediates.js'));
  return { version, ...build, EMSIGN_COMPROMISE_REJECTED_INTERMEDIATES: rejected.EMSIGN_COMPROMISE_REJECTED_INTERMEDIATES };
}

/** What `trigger deploy` writes for a base and a build base, with the layer instructions and packages given. */
async function containerfileFor(base: string, buildBase: string | undefined, extra: { instructions?: string[]; pkgs?: string[] } = {}) {
  const cli = await installedCli();
  // `writeContainerfile` in the CLI's build/buildWorker.js passes exactly these.
  return cli.generateContainerfile({
    runtime: taskConfig.runtime,
    entrypoint: 'managed-run-controller.js',
    indexScript: 'managed-index-controller.js',
    build: { env: {}, commands: [] },
    image: { base, ...(buildBase ? { buildBase } : {}), ...extra },
  });
}

/** What a Containerfile asks of the base it is built on; an empty list when nothing shell-bound reaches it. */
function shellOnTheBase(containerfile: string): string[] {
  const stages = stagesOf(containerfile);
  const base = stages.find((s) => s.name === 'base');
  if (!base) return ['no stage is named base'];
  const problems: string[] = [];
  for (const stage of [base, ...descendants(stages, 'base')]) {
    for (const instruction of stage.body) {
      if (['RUN', 'ADD', 'SHELL'].includes(keyword(instruction))) problems.push(`${stage.name}: ${instruction.split('\n')[0]}`);
      if (/^ONBUILD\s/i.test(instruction)) problems.push(`${stage.name}: ${instruction.split('\n')[0]}`);
    }
  }
  return problems;
}

const A_BASE = `ghcr.io/robbes/ownpace-task-base:sha-0000000@sha256:${'0'.repeat(64)}`;

// ------------------------------------------------------------- 1. the CLI ---

describe("the installed CLI writes no step of its own on a base with no layer", () => {
  it('no RUN, ADD or SHELL in the base stage or any stage built from it, and the build stage on the build base', async () => {
    const cli = await installedCli();
    const buildBase = cli.BUILD_IMAGE[String(taskConfig.runtime)];
    expect(buildBase, `trigger.dev ${cli.version} names a build image for ${String(taskConfig.runtime)}`).toMatch(/@sha256:[0-9a-f]{64}$/);
    const written = await containerfileFor(A_BASE, buildBase);
    expect(shellOnTheBase(written), `trigger.dev ${cli.version} writes a step a shell-less base cannot run`).toEqual([]);
    const stages = stagesOf(written);
    const base = stages.find((s) => s.name === 'base')!;
    expect(base.from).toBe(A_BASE);
    expect(base.body, 'the base stage holds one ENV line and nothing else').toEqual(['ENV DEBIAN_FRONTEND=noninteractive']);
    // `npm i` and the indexer run in the build stage, which starts from the build base, not from ours.
    const build = stages.find((s) => s.name === 'build')!;
    expect(build.from).toBe(buildBase);
    expect(build.body.some((i) => /^RUN npm i\b/.test(i)), 'npm i runs in the build stage').toBe(true);
    expect(descendants(stages, 'base').map((s) => s.name), 'the only stage built on the base is the runtime stage').toEqual(['final']);
  });

  it("the runtime stage names only what the base carries: the node account, dumb-init and node on the PATH, and no PATH or NODE_OPTIONS of its own", async () => {
    const cli = await installedCli();
    const final = stagesOf(await containerfileFor(A_BASE, cli.BUILD_IMAGE[String(taskConfig.runtime)])).find((s) => s.name === 'final')!;
    expect(final.from).toBe('base');
    expect(final.body).toContain('USER node');
    const copies = final.body.filter((i) => keyword(i) === 'COPY');
    expect(copies.length, 'the runtime stage copies the code, its node_modules and its index').toBe(3);
    for (const copy of copies) expect(copy, 'each COPY resolves the node account in the base').toMatch(/^COPY --from=\S+ --chown=node:node /);
    const entrypoint = final.body.find((i) => keyword(i) === 'ENTRYPOINT');
    expect(entrypoint).toBe('ENTRYPOINT [ "dumb-init", "node", "managed-run-controller.js" ]');
    const env = final.body.filter((i) => keyword(i) === 'ENV').join(' ');
    expect(env, 'the base PATH reaches the entrypoint').not.toMatch(/\bPATH=/);
    expect(env, "the base's --use-openssl-ca reaches the tasks").not.toMatch(/\bNODE_OPTIONS=/);
    expect(env).not.toMatch(/\bSSL_CERT_FILE=/);
  });

  it('sees a step when there is one: a layer instruction, a package, and no build base each put a RUN on the base (vacuity)', async () => {
    const cli = await installedCli();
    const buildBase = cli.BUILD_IMAGE[String(taskConfig.runtime)];
    const withLayer = shellOnTheBase(await containerfileFor(A_BASE, buildBase, { instructions: ['ENV ANYTHING=1'] }));
    expect(withLayer.join('\n'), "the CLI's repair after a layer").toMatch(/^base: RUN apt-get update/m);
    expect(shellOnTheBase(await containerfileFor(A_BASE, buildBase, { pkgs: ['curl'] })).join('\n')).toMatch(/apt-get update/);
    expect(shellOnTheBase(await containerfileFor(A_BASE, buildBase, { instructions: ['RUN true'] }))).toContain('base: RUN true');
    // Without a build base and with a layer, the build stage is `FROM base` and installs the toolchain with apt there.
    expect(shellOnTheBase(await containerfileFor(A_BASE, undefined, { instructions: ['ENV ANYTHING=1'] })).join('\n')).toMatch(/^build: RUN apt-get/m);
    // And a shape this reader would miss is not there: no stage starts from the base by its image name.
    expect(stagesOf(await containerfileFor(A_BASE, buildBase)).filter((s) => s.from === A_BASE).map((s) => s.name)).toEqual(['base']);
  });
});

// ------------------------------------------------------- 2. the Dockerfile ---

const dockerfile = read(DOCKERFILE);
const stages = stagesOf(dockerfile);
const apiStages = stagesOf(read(API_DOCKERFILE));

describe("the base: distroless at the API's digest, and what the runtime stage needs", () => {
  it("has three stages: distroless at apps/api/Dockerfile's runtime digest, the build on its FROM image, and the base on distroless", () => {
    expect(stages.map((s) => s.name)).toEqual(['distroless', 'build', 'task-base']);
    const apiRuntime = apiStages.at(-1)!.from;
    const apiBuild = apiStages[0]!.from;
    expect(apiRuntime, `${API_DOCKERFILE}'s runtime stage`).toMatch(/^gcr\.io\/distroless\/nodejs\d+-debian\d+:nonroot@sha256:[0-9a-f]{64}$/);
    expect(apiBuild, `${API_DOCKERFILE}'s first FROM`).toMatch(/^node:\d+\.\d+\.\d+-\S+@sha256:[0-9a-f]{64}$/);
    expect(stages[0]!.from, `${DOCKERFILE}'s distroless is the API's`).toBe(apiRuntime);
    expect(stages[1]!.from, `${DOCKERFILE}'s build stage is on the API's FROM image`).toBe(apiBuild);
    expect(stages[2]!.from).toBe('distroless');
    // distroless keeps node at /nodejs/bin/node, off its PATH: the API names it there.
    expect(apiStages.at(-1)!.body).toContain('ENTRYPOINT ["/nodejs/bin/node"]');
  });

  it('runs nothing in the base: COPY from the build stage, ENV, USER, WORKDIR and ENTRYPOINT only', () => {
    const base = stages[2]!;
    for (const instruction of base.body) expect(['COPY', 'ENV', 'USER', 'WORKDIR', 'ENTRYPOINT', 'LABEL'], instruction).toContain(keyword(instruction));
    for (const copy of base.body.filter((i) => keyword(i) === 'COPY')) expect(copy).toMatch(/^COPY --from=build /);
  });

  it('puts the node account, dumb-init, the bundle and an empty home in it, and node and dumb-init on its PATH', () => {
    const base = stages[2]!.body;
    expect(base).toContain('COPY --from=build /out/etc/passwd /out/etc/group /etc/');
    expect(base).toContain('COPY --from=build /out/etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt');
    expect(base).toContain('COPY --from=build /out/usr/bin/dumb-init /usr/bin/dumb-init');
    expect(base).toContain('COPY --from=build --chown=1000:1000 /out/home/node /home/node');
    expect(base).toContain('USER node');
    expect(base.at(-1)).toBe('ENTRYPOINT ["dumb-init", "node"]');
    const env = base.find((i) => keyword(i) === 'ENV')!;
    const path = /\bPATH=(\S+)/.exec(env)?.[1]?.split(':') ?? [];
    expect(path[0], "distroless's node directory first").toBe('/nodejs/bin');
    expect(path, 'dumb-init is in /usr/bin').toContain('/usr/bin');
    expect(env).toMatch(/\bNODE_OPTIONS=--use-openssl-ca(?:\s|$)/);
    expect(env).toMatch(/\bSSL_CERT_FILE=\/etc\/ssl\/certs\/ca-certificates\.crt(?:\s|$)/);
    // The account: the Node image's node, at 1000:1000, refused otherwise, appended to distroless's own files.
    const accounts = stages[1]!.body.find((i) => i.includes('/out/etc/passwd') && keyword(i) === 'RUN')!;
    expect(accounts).toContain('echo "node:x:${uid}:${gid}:node:/home/node:/sbin/nologin" >> /out/etc/passwd');
    expect(accounts).toContain('echo "node:x:${gid}:" >> /out/etc/group');
    expect(accounts).toContain('if [ "$uid:$gid" != 1000:1000 ]');
    expect(stages[1]!.body).toContain('COPY --from=distroless /etc/passwd /etc/group /out/etc/');
  });

  it("installs ca-certificates and dumb-init, and nothing else, in the build stage", () => {
    const apt = stages[1]!.body.filter((i) => /\bapt-get install\b/.test(i));
    expect(apt).toHaveLength(1);
    expect(/apt-get install -y --no-install-recommends ([a-z0-9 .+-]+?)\s*\n/.exec(apt[0]!)?.[1]?.trim().split(/\s+/).sort()).toEqual(['ca-certificates', 'dumb-init']);
  });

  it("makes the CLI's trust edits, read from the installed CLI: its four roots, its reject directory and its eight intermediates byte for byte", async () => {
    const cli = await installedCli();
    const edit = stages[1]!.body.find((i) => /update-ca-certificates --fresh/.test(i))!;
    const roots = /roots='([^']+)'/.exec(edit)?.[1]?.split(' ');
    expect(roots, `the roots trigger.dev ${cli.version} distrusts`).toEqual(cli.EMSIGN_COMPROMISE_DISTRUSTED_ROOTS);
    expect(edit).toContain('/etc/ca-certificates.conf');
    expect(edit.indexOf('sed -i -E')).toBeLessThan(edit.indexOf('update-ca-certificates --fresh'));
    expect(stages[1]!.body).toContain(`COPY emsign-block/ ${cli.EMSIGN_REJECT_DIR}/`);
    const files = readdirSync(join(ROOT, REJECTED_DIR)).sort();
    expect(files).toEqual(cli.EMSIGN_COMPROMISE_REJECTED_INTERMEDIATES.map((c) => c.file).sort());
    for (const { file, pemLines } of cli.EMSIGN_COMPROMISE_REJECTED_INTERMEDIATES) {
      expect(read(join(REJECTED_DIR, file)), file).toBe(`${pemLines.join('\n')}\n`);
    }
    // The build counts them in the bundle: as many as the CLI rejects.
    expect(edit).toContain(`[ "$rejected" != ${cli.EMSIGN_COMPROMISE_REJECTED_INTERMEDIATES.length} ]`);
    // trigger.config.ts made the same edits in a layer of its own until the
    // tasks moved onto this base (2026-11-06); it keeps no copy of them now.
    expect(read('apps/worker/trigger.config.ts')).not.toMatch(/DISTRUSTED_ROOTS|emsign-block|ca-certificates/);
  });
});

// --------------------------------------------------------- 3. the workflow ---

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string | boolean>;
}
interface Job {
  if?: string;
  'runs-on'?: string;
  permissions?: Record<string, string>;
  strategy?: { matrix?: { image?: string[]; include?: unknown } };
  steps: Step[];
}

const workflow = parseYaml(read(IMAGES_YML)) as { on: { pull_request: { paths: string[] } }; jobs: Record<string, Job> };
const buildJob = workflow.jobs['build']!;
const PROBE_STEP = "The tasks' base starts as the CLI's runtime stage starts it, and has no shell";

describe('images.yml builds, runs and signs the base, from main and on a pull request only', () => {
  it('is a leg of the build job, added on a pull request and on main and never on a tag, beside the three the scan and the release read', () => {
    expect(buildJob.strategy?.matrix?.image).toEqual(['api', 'web', 'selfhost']);
    expect(buildJob.strategy?.matrix?.include).toBe(INCLUDE);
    expect(workflow.on.pull_request.paths).toContain('apps/worker/task-image/**');
  });

  it('builds it from its own directory, on both platforms on main and for amd64, loaded, on a pull request, in both attempts alike', () => {
    const attempts = buildJob.steps.filter((s) => s.uses?.startsWith('docker/build-push-action@'));
    expect(attempts.map((s) => s.id)).toEqual(['build_attempt', 'build_retry']);
    for (const step of attempts) {
      expect(step.with?.context).toBe(`\${{ matrix.image == 'task-base' && '${CONTEXT}' || '.' }}`);
      expect(step.with?.file).toBe(`\${{ matrix.image == 'task-base' && '${DOCKERFILE}' || format('apps/{0}/Dockerfile', matrix.image) }}`);
      expect(step.with?.load).toBe("${{ github.event_name == 'pull_request' && matrix.image == 'task-base' }}");
      expect(step.with?.push).toBe("${{ github.event_name != 'pull_request' }}");
    }
    expect(attempts[0]!.with).toEqual(attempts[1]!.with);
  });

  it('logs in, tags, signs and fails loud for it with the steps the three use: no step but the probe names it', () => {
    const naming = buildJob.steps.filter((s) => `${s.if ?? ''}${JSON.stringify(s.with ?? {})}${JSON.stringify(s.env ?? {})}`.includes('task-base'));
    expect(naming.map((s) => s.id ?? s.name)).toEqual(['build_attempt', 'build_retry', PROBE_STEP]);
    const sign = buildJob.steps.find((s) => s.name === 'Sign the published image (keyless, by digest)')!;
    expect(sign.run).toContain('ref="ghcr.io/robbes/ownpace-${{ matrix.image }}@${digest}"');
    expect(sign.if).toBe("github.event_name != 'pull_request'");
  });

  it('runs it on a pull request, as the build loaded it, after the build and before cosign', () => {
    const at = buildJob.steps.findIndex((s) => s.name === PROBE_STEP);
    expect(at).toBeGreaterThan(buildJob.steps.findIndex((s) => s.name === 'Fail if the build did not succeed'));
    expect(at).toBeLessThan(buildJob.steps.findIndex((s) => s.name === 'Install cosign'));
    const step = buildJob.steps[at]!;
    expect(step.if).toBe("matrix.image == 'task-base' && github.event_name == 'pull_request'");
    expect(step.env).toEqual({ IMAGE: '${{ steps.build_attempt.outputs.imageid }}' });
  });
});

/**
 * The probe step's `run:`, run as the runner runs it (bash -eo pipefail), in
 * this checkout, with a stand-in `docker` first on the PATH: `docker run` of
 * the probe exits $PROBE, and `docker run --entrypoint <shell>` answers $SHELL_SAYS
 * and exits $SHELL_RC.
 */
function runProbe(env: Record<string, string>): { status: number; out: string; calls: string[] } {
  const step = buildJob.steps.find((s) => s.name === PROBE_STEP)!;
  const dir = mkdtempSync(join(tmpdir(), 'task-base-probe-'));
  try {
    mkdirSync(join(dir, 'bin'));
    const log = join(dir, 'docker.log');
    writeFileSync(log, '');
    writeFileSync(
      join(dir, 'bin', 'docker'),
      [
        '#!/bin/bash',
        // One line per call: the probe's newlines as spaces.
        'line="$*"',
        `printf "%s\\n" "\${line//$'\\n'/ }" >> "$DOCKER_LOG"`,
        'case " $* " in',
        '  *" --entrypoint "*) printf "%s\\n" "$SHELL_SAYS" >&2; exit "$SHELL_RC" ;;',
        '  *" -e WANT_NODE="*) printf "%s\\n" "${PROBE_SAYS:-}"; exit "$PROBE" ;;',
        'esac',
        'echo "unexpected docker call: $*" >&2; exit 99',
        '',
      ].join('\n'),
    );
    chmodSync(join(dir, 'bin', 'docker'), 0o755);
    const script = join(dir, 'step.sh');
    writeFileSync(script, step.run!);
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: `${join(dir, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: dir, DOCKER_LOG: log, IMAGE: 'sha256:built', ...env },
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ABSENT = 'docker: Error response from daemon: failed to create task for container: exec: "sh": executable file not found in $PATH: unknown';

describe("the probe step's verdict, run against a stand-in docker", () => {
  it("passes a base whose probe passes and where no shell starts, and asks for apps/api/Dockerfile's Node", () => {
    const r = runProbe({ PROBE: '0', SHELL_SAYS: ABSENT, SHELL_RC: '127' });
    expect(r.out).not.toContain('::error::');
    expect(r.status, r.out).toBe(0);
    const node = /^FROM node:(\d+\.\d+\.\d+)-/m.exec(read(API_DOCKERFILE))?.[1] ?? '';
    expect(node, `${API_DOCKERFILE} names a Node x.y.z`).toMatch(/^\d+\.\d+\.\d+$/);
    expect(r.calls[0]).toMatch(new RegExp(`^run --rm -e WANT_NODE=v${node.replaceAll('.', '\\.')} sha256:built -e const fs = require\\('node:fs'\\);`));
    expect(r.calls.slice(1).map((c) => c.split(' ')[3])).toEqual(['sh', '/bin/sh', 'bash', '/bin/bash', '/busybox/sh']);
  });

  it('fails when the probe fails, when a shell starts, when one is refused for another reason, and when nothing was loaded', () => {
    expect(runProbe({ PROBE: '1', SHELL_SAYS: ABSENT, SHELL_RC: '127' }).status).not.toBe(0);
    const shell = runProbe({ PROBE: '0', SHELL_SAYS: '', SHELL_RC: '0' });
    expect(shell.status).not.toBe(0);
    expect(shell.out).toContain('::error::sh started in the tasks\' base');
    const other = runProbe({ PROBE: '0', SHELL_SAYS: 'docker: Error response from daemon: No such image: sha256:built', SHELL_RC: '125' });
    expect(other.status).not.toBe(0);
    expect(other.out).toContain('did not start, for another reason than its absence');
    const none = runProbe({ PROBE: '0', SHELL_SAYS: ABSENT, SHELL_RC: '127', IMAGE: '' });
    expect(none.status).not.toBe(0);
    expect(none.out).toContain('::error::the build loaded no image to run');
  });

  it("the probe itself checks what the CLI's entrypoint needs", () => {
    const run = buildJob.steps.find((s) => s.name === PROBE_STEP)!.run!;
    for (const check of [
      "facts.node !== process.env.WANT_NODE",
      "facts.user !== '1000:1000'",
      "facts.pid1 !== 'dumb-init'",
      "includes('--use-openssl-ca')",
      'facts.rejected !== 8',
      'process.exit(wrong.length === 0 ? 0 : 1)',
    ]) {
      expect(run, check).toContain(check);
    }
  });
});

describe('Dependabot moves its FROM lines with the API image', () => {
  it("lists its directory in apps/api's docker entry", () => {
    const updates = (parseYaml(read('.github/dependabot.yml')) as { updates: Array<{ 'package-ecosystem': string; directories?: string[] }> }).updates;
    const entry = updates.find((u) => u['package-ecosystem'] === 'docker' && u.directories?.includes('/apps/api'));
    expect(entry?.directories).toContain(`/${CONTEXT}`);
  });
});

// --------------------------------------------------------- 4. the config ---

const CONFIG = 'apps/worker/trigger.config.ts';
type Manifest = Parameters<NonNullable<BuildExtension['onBuildComplete']>>[1];

/** The config's extensions run as the CLI runs them for a target: start, then complete; the layers they add and the manifest they leave. */
async function configBuild(target: BuildContext['target']): Promise<{ layers: BuildLayer[]; manifest: Manifest }> {
  const layers: BuildLayer[] = [];
  const context = { target, workingDir: WORKER_DIR, addLayer: (layer: BuildLayer) => layers.push(layer) } as unknown as BuildContext;
  const manifest = { image: { pkgs: [], instructions: [] } } as unknown as Manifest;
  const extensions = taskConfig.build?.extensions ?? [];
  for (const extension of extensions) await extension.onBuildStart?.(context);
  for (const extension of extensions) await extension.onBuildComplete?.(context, manifest);
  return { layers, manifest };
}

describe('the config names the published base and adds no layer to it', () => {
  it("sets the manifest's base to the pin, its build base to the CLI's build image for the runtime, and adds no layer", async () => {
    const cli = await installedCli();
    const pin = taskBasePin(read(CONFIG));
    expect(pin.repo, 'the base images.yml publishes').toBe('ghcr.io/robbes/ownpace-task-base');
    const { layers, manifest } = await configBuild('deploy');
    expect(layers, 'a layer, even one ENV line, makes the CLI write its apt repair on a base with no shell').toEqual([]);
    expect(manifest.image?.base).toBe(pin.ref);
    expect(manifest.image?.buildBase, `trigger.dev ${cli.version}'s build image for ${String(taskConfig.runtime)}`).toBe(
      cli.BUILD_IMAGE[String(taskConfig.runtime)],
    );
    expect(manifest.image?.pkgs).toEqual([]);
    expect(manifest.image?.instructions).toEqual([]);
  });

  it('the Containerfile the installed CLI writes for it: the base stage FROM the pin with one ENV line, the build stage on the build image, and no RUN on the base or after it', async () => {
    const { layers, manifest } = await configBuild('deploy');
    const instructions = layers.flatMap((layer) => layer.image?.instructions ?? []);
    const written = await containerfileFor(manifest.image!.base!, manifest.image?.buildBase, { instructions });
    expect(shellOnTheBase(written)).toEqual([]);
    const stages = stagesOf(written);
    expect(stages.find((s) => s.name === 'base')).toEqual({ from: taskBasePin(read(CONFIG)).ref, name: 'base', body: ['ENV DEBIAN_FRONTEND=noninteractive'] });
    expect(stages.find((s) => s.name === 'build')?.from).toBe(manifest.image?.buildBase);
    expect(descendants(stages, 'base').map((s) => s.name)).toEqual(['final']);
    expect(stages.find((s) => s.name === 'final')!.body.map(keyword)).not.toContain('RUN');
  });

  it('`trigger dev` builds no image, and gets nothing', async () => {
    const { layers, manifest } = await configBuild('dev');
    expect(layers).toEqual([]);
    expect(manifest).toEqual({ image: { pkgs: [], instructions: [] } });
  });
});

// ------------------------------------------------- 5. the pin, checked ---

const PIN_STEP = "The tasks' base pin pulls anonymously on both platforms, and images.yml on main signed it";
const MAIN_IDENTITY = 'https://github.com/Robbes/Ownpace/.github/workflows/images.yml@refs/heads/main';
const pinJob = workflow.jobs['task-base-pin']!;

describe("images.yml's task-base-pin job pulls the pin as a deploy does and verifies its signature, on a pull request", () => {
  it('runs on a pull request that touches the config, on a hosted runner, reading the repository only, and logs in nowhere', () => {
    expect(pinJob.if).toBe("github.event_name == 'pull_request'");
    expect(pinJob['runs-on']).toBe('ubuntu-24.04');
    expect(pinJob.permissions).toEqual({ contents: 'read' });
    expect(workflow.on.pull_request.paths).toContain(CONFIG);
    expect(JSON.stringify(pinJob), 'a pull of the pin that needs a login is not the pull a deploy makes').not.toMatch(/login|GITHUB_TOKEN|secrets\./);
  });

  it('installs the cosign the build job signs with', () => {
    const installs = (job: Job) => job.steps.filter((s) => s.uses?.startsWith('sigstore/cosign-installer@')).map((s) => ({ uses: s.uses, with: s.with }));
    expect(installs(pinJob)).toHaveLength(1);
    expect(installs(pinJob)).toEqual(installs(buildJob));
  });
});

/**
 * The pin step's `run:` as the runner runs it (bash -eo pipefail), in a
 * directory holding `config` as trigger.config.ts and this checkout's
 * apps/api/Dockerfile, with a stand-in docker, jq, cosign and sleep first on
 * the PATH: the index lists `PLATFORMS`, the image's revision label is
 * `REVISION`, it answers `NODE`, and cosign refuses the first `COSIGN_FAILS`.
 */
function runPin(env: Record<string, string>, config = read(CONFIG)): { status: number; out: string; docker: string[]; cosign: string[]; slept: string[] } {
  const step = pinJob.steps.find((s) => s.name === PIN_STEP)!;
  const dir = mkdtempSync(join(tmpdir(), 'task-base-pin-'));
  try {
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'apps/worker'), { recursive: true });
    mkdirSync(join(dir, 'apps/api'), { recursive: true });
    writeFileSync(join(dir, 'apps/worker/trigger.config.ts'), config);
    writeFileSync(join(dir, 'apps/api/Dockerfile'), read(API_DOCKERFILE));
    for (const log of ['docker.log', 'cosign.log', 'sleep.log']) writeFileSync(join(dir, log), '');
    const tool = (name: string, body: string[]) => {
      writeFileSync(join(dir, 'bin', name), ['#!/bin/bash', ...body, ''].join('\n'));
      chmodSync(join(dir, 'bin', name), 0o755);
    };
    tool('docker', [
      'printf "%s\\n" "$*" >> "$LOGS/docker.log"',
      'case "$1 $2" in',
      '  "buildx imagetools") echo "{}"; exit 0 ;;',
      '  "image inspect") printf "%s\\n" "$REVISION"; exit 0 ;;',
      'esac',
      'case "$1" in',
      '  pull) exit 0 ;;',
      '  run) printf "%s\\n" "$NODE"; exit 0 ;;',
      'esac',
      'echo "unexpected docker call: $*" >&2; exit 99',
    ]);
    tool('jq', ['cat > /dev/null', 'printf "%s\\n" "$PLATFORMS"']);
    tool('cosign', [
      'printf "%s\\n" "$*" >> "$LOGS/cosign.log"',
      'n="$(wc -l < "$LOGS/cosign.log")"',
      '[ "$n" -gt "${COSIGN_FAILS:-0}" ] || { echo "Error: no matching signatures" >&2; exit 1; }',
    ]);
    tool('sleep', ['printf "%s\\n" "$1" >> "$LOGS/sleep.log"']);
    const script = join(dir, 'step.sh');
    writeFileSync(script, step.run!);
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: `${join(dir, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: dir, LOGS: dir, ...env },
    });
    const lines = (file: string) => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean);
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, docker: lines('docker.log'), cosign: lines('cosign.log'), slept: lines('sleep.log') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the pin step's verdict, run against a stand-in docker, jq and cosign", () => {
  const pin = taskBasePin(read(CONFIG));
  const byDigest = `ghcr.io/robbes/ownpace-task-base@${pin.digest}`;
  const want = `v${/^FROM node:(\d+\.\d+\.\d+)-/m.exec(read(API_DOCKERFILE))![1]}`;
  const good = { PLATFORMS: 'amd64 arm64', REVISION: `${pin.commit}${'a'.repeat(33)}`, NODE: want, COSIGN_FAILS: '0' };

  it('passes the pin: both platforms listed and pulled by the pin as a deploy pulls it, the revision its tag names, the API\'s Node, and the signature images.yml made on main', () => {
    const r = runPin(good);
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toMatch(/::(error|warning)::/);
    expect(r.docker).toEqual([
      `buildx imagetools inspect --raw ${byDigest}`,
      `pull --quiet --platform linux/arm64 ${pin.ref}`,
      `pull --quiet --platform linux/amd64 ${pin.ref}`,
      `image inspect --format {{index .Config.Labels "org.opencontainers.image.revision"}} ${byDigest}`,
      `run --rm --platform linux/amd64 --network none ${byDigest} -p process.version`,
    ]);
    expect(r.cosign).toEqual([`verify ${byDigest} --certificate-identity ${MAIN_IDENTITY} --certificate-oidc-issuer https://token.actions.githubusercontent.com`]);
  });

  it("only warns on a Node other than apps/api/Dockerfile's, since that base is published after the pull request that moves the Node merges", () => {
    const r = runPin({ ...good, NODE: 'v1.2.3' });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`::warning::the tasks' base runs Node v1.2.3, and apps/api/Dockerfile names ${want}`);
  });

  it('fails on a platform missing, another revision, a config with no pin of that shape, and a signature refused three times', () => {
    const arm = runPin({ ...good, PLATFORMS: 'amd64' });
    expect(arm.status).not.toBe(0);
    expect(arm.out).toContain('has no linux/arm64 image');
    const other = runPin({ ...good, REVISION: 'f'.repeat(40) });
    expect(other.status).not.toBe(0);
    expect(other.out).toContain(`not the commit its tag sha-${pin.commit} names`);
    const config = read(CONFIG);
    for (const bad of [config.replace(`:${pin.tag}@`, ':edge@'), config.replace(`@${pin.digest}`, ''), config.replace('const TASK_BASE_IMAGE =', 'const TASK_BASE =')]) {
      expect(bad).not.toBe(config);
      const r = runPin(good, bad);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain('::error::apps/worker/trigger.config.ts names no TASK_BASE_IMAGE');
      expect(r.docker, 'nothing is pulled for a line it cannot read').toEqual([]);
    }
    const blip = runPin({ ...good, COSIGN_FAILS: '2' });
    expect(blip.status, blip.out).toBe(0);
    expect(blip.out).toContain('(attempt 3)');
    expect(blip.slept).toEqual(['30', '60']);
    const refused = runPin({ ...good, COSIGN_FAILS: '3' });
    expect(refused.status).not.toBe(0);
    expect(refused.cosign).toHaveLength(3);
    expect(refused.out).toContain('::error::cosign verify refused');
  });
});

// ------------------------------------------------------ 6. what ran, asked ---

const SMOKE = 'deploy/compose/smoke-managed.sh';

/** Bash, with a stand-in `docker` defined before `script`; stdout, stderr and the exit code. */
function bash(script: string, env: Record<string, string> = {}): { status: number | null; out: string } {
  const run = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

/**
 * A stand-in docker, recording its arguments: an image's build time from
 * `$CREATED` (`<id> <time>` lines; an id missing there cannot be dated);
 * `--entrypoint node` answered as `$NODE_SAYS` with `$NODE_RC`; a shell
 * starting when it is in `$STARTS`, else refused as `$SHELL_SAYS` (its SHELL
 * the shell's name) with `$SHELL_RC`; and the image `$OLD` a Debian one, with
 * an older Node and every shell.
 */
const STUB = `docker() {
  printf '%s\\n' "$*" >>"$CALLS"
  if [ "$1 $2" = "image inspect" ]; then
    awk -v id="$5" '$1 == id { print $2; found = 1 } END { exit !found }' <<<"$CREATED" || { echo "Error: No such image: $5" >&2; return 1; }
    return 0
  fi
  case "$*" in
    *" \${OLD:-no-image-is-old} "*" --version") echo v20.0.0; return 0 ;;
    *" \${OLD:-no-image-is-old} "*) return 0 ;;
    *" --entrypoint node "*) printf '%s\\n' "$NODE_SAYS"; return "$NODE_RC" ;;
    *" --entrypoint "*)
      shell="$(awk '{ for (i = 1; i < NF; i++) if ($i == "--entrypoint") print $(i + 1) }' <<<"$*")"
      case " \${STARTS:-} " in *" $shell "*) return 0 ;; esac
      printf '%s\\n' "\${SHELL_SAYS//SHELL/$shell}" >&2
      return "$SHELL_RC" ;;
  esac
  echo "unexpected docker call: $*" >&2
  return 99
}`;

const SHELLS = ['sh', '/bin/sh', 'bash', '/bin/bash', '/busybox/sh'];
const ABSENT_SHELL = 'docker: Error response from daemon: failed to create task for container: exec: "SHELL": executable file not found in $PATH: unknown';

describe('the managed smoke asks the image the last deploy built for its Node and its shells', () => {
  const smoke = read(SMOKE);
  const banner = "# ---------- the tasks' image is the prebuilt base's: the API's Node, and no shell ----------";
  const start = smoke.indexOf(banner);
  const block = smoke.slice(start, smoke.indexOf('\n# ---------- ', start + banner.length));
  const failAt = (() => {
    const s = smoke.indexOf('fail_at() {');
    return smoke.slice(s, smoke.indexOf('\n}\n', s) + 3);
  })();
  // The watcher's pass over the runners it sees: its `for` loop, whole.
  const watcherAt = smoke.indexOf('    for c in $(docker ps --filter');
  const watcher = smoke.slice(watcherAt, smoke.indexOf('\n    done\n', watcherAt) + '\n    done\n'.length);
  const want = `v${/^FROM node:(\d+\.\d+\.\d+)-/m.exec(read(API_DOCKERFILE))![1]}`;

  const A = `sha256:${'a'.repeat(64)}`;
  const B = `sha256:${'b'.repeat(64)}`;
  const C = `sha256:${'c'.repeat(64)}`;
  const BUILT = `${A} 2026-11-02T21:00:00.5Z\n${B} 2026-11-06T07:00:00.123456789Z\n${C} 2026-11-06T06:59:59Z`;
  const BASE = { NODE_SAYS: want, NODE_RC: '0', SHELL_SAYS: ABSENT_SHELL, SHELL_RC: '127' };

  /** The block run with runner records holding `images`; the verdict, docker's calls and what it said. */
  function verdict(images: string[], extra: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'task-image-smoke-'));
    try {
      images.forEach((id, n) => writeFileSync(join(dir, `runner-${n}.image`), `${id}\n`));
      writeFileSync(join(dir, 'calls'), '');
      const run = bash(
        ['set -uo pipefail', 'fail=0', 'SECTION=test', 'FAIL_REASONS=""', 'note() { SECTION="$*"; }', failAt, STUB, block, 'echo "FAIL=$fail"'].join('\n'),
        { RUNNER_LOG_DIR: dir, CALLS: join(dir, 'calls'), CREATED: BUILT, WANT_NODE: want, API_NODE_VERSION: want, ...BASE, ...extra },
      );
      expect(run.status, run.out).toBe(0);
      const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean);
      return { fail: /FAIL=(\d)\s*$/.exec(run.out)?.[1] ?? '?', runs: calls.filter((c) => c.startsWith('run ')), calls, out: run.out };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("is there, after the runner logs, and asks the image's node and the five shells", () => {
    expect(start, `${SMOKE} has no section "${banner}"`).toBeGreaterThan(smoke.indexOf('# ---------- runner logs ----------'));
    expect(block).toContain('--entrypoint node "$newest" --version');
    expect(block).toContain(`for shell in ${SHELLS.join(' ')}; do`);
    expect(block).toContain('fail_at');
    expect(smoke, 'the purge it asked dpkg about until 2026-11-06 is gone').not.toContain('--entrypoint dpkg-query');
  });

  it("the watcher starts a runner's log first, and reads its image on every pass until a read answers", () => {
    expect(watcherAt, 'no watcher loop over `docker ps`').toBeGreaterThan(0);
    // Before the read: a read that waits on the daemon must not hold the log back.
    expect(watcher.indexOf('docker logs -f')).toBeGreaterThan(0);
    expect(watcher.indexOf('docker logs -f')).toBeLessThan(watcher.indexOf('docker container inspect'));
    const dir = mkdtempSync(join(tmpdir(), 'task-image-watcher-'));
    try {
      const stub = `docker() {
        printf '%s\\n' "$1 $2" >>"$CALLS"
        case "$1 $2" in
          "ps --filter") echo runner-a; echo trigger-api ;;
          "logs -f") echo "a line" ;;
          "container inspect")
            n=$(($(cat "$TRIES" 2>/dev/null || echo 0) + 1)); echo "$n" >"$TRIES"
            [ "$n" -ge 2 ] || { echo "Error response from daemon: a blip" >&2; return 1; }
            echo "${A}" ;;
        esac
      }`;
      const pass = (n: number) =>
        bash(['set -uo pipefail', 'COMPOSE_PROJECT=ownpace', stub, ...Array.from({ length: n }, () => `${watcher}\nwait`), 'echo done'].join('\n'), {
          RUNNER_LOG_DIR: dir,
          CALLS: join(dir, 'calls'),
          TRIES: join(dir, 'tries'),
        });
      // The first read fails: nothing is recorded, and nothing pretends it was.
      expect(pass(1).out).toContain('done');
      expect(existsSync(join(dir, 'runner-a.image'))).toBe(false);
      // The next pass reads it; the one after asks no more.
      expect(pass(2).out).toContain('done');
      expect(readFileSync(join(dir, 'runner-a.image'), 'utf8').trim()).toBe(A);
      const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');
      expect(calls.filter((c) => c === 'logs -f'), 'one log stream per runner').toHaveLength(1);
      expect(calls.filter((c) => c === 'container inspect'), 'a read on the first pass and the second, none on the third').toHaveLength(2);
      expect(existsSync(join(dir, 'trigger-api.log')), 'only runner-* containers').toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('asks only the newest image, by ID, with no network and no pull, and names the older ones', () => {
    // A runner of an earlier deployment (A, built the night before on the
    // Debian base, with an older Node and a shell) beside the deploy's (B):
    // A is named, not asked.
    const run = verdict([A, B, A, C], { OLD: A });
    expect(run.fail, run.out).toBe('0');
    expect(run.runs).toEqual([
      `run --rm --pull never --network none --entrypoint node ${B} --version`,
      ...SHELLS.map((shell) => `run --rm --pull never --network none --entrypoint ${shell} ${B} -c true`),
    ]);
    expect(run.out).toContain(`image ${'a'.repeat(12)}: built before the newest`);
    expect(run.out).toContain(`image ${'c'.repeat(12)}: built before the newest`);
    expect(run.out).toContain(`image ${'b'.repeat(12)}: Node ${want}, the API's`);
    // And the newest is the one that must be the base's.
    expect(verdict([A, B], { OLD: B }).fail).toBe('1');
  });

  it("passes the API's Node and no shell, and fails another Node, a Node it cannot ask, a shell that starts, and one refused for another reason", () => {
    expect(verdict([B]).fail).toBe('0');
    const older = verdict([B], { NODE_SAYS: 'v26.0.0' });
    expect(older.fail, older.out).toBe('1');
    expect(older.out).toContain(`the tasks run Node v26.0.0, and the API runs ${want}`);
    for (const node of [{ NODE_SAYS: 'docker: Error response from daemon: No such image', NODE_RC: '125' }, { NODE_SAYS: 'hello', NODE_RC: '0' }]) {
      const r = verdict([B], node);
      expect(r.fail, r.out).toBe('1');
      expect(r.out).toContain('its node could not be asked');
    }
    for (const shell of SHELLS) {
      const r = verdict([B], { STARTS: shell });
      expect(r.fail, `${shell}\n${r.out}`).toBe('1');
      expect(r.out).toContain(`${shell} started`);
    }
    const other = verdict([B], { SHELL_SAYS: 'docker: Error response from daemon: a blip', SHELL_RC: '125' });
    expect(other.fail, other.out).toBe('1');
    expect(other.out).toContain('did not start, for another reason than its absence');
    // A shell refused as missing, either way docker says it, is no shell.
    expect(verdict([B], { SHELL_SAYS: 'exec: "SHELL": stat SHELL: no such file or directory', SHELL_RC: '127' }).fail).toBe('0');
  });

  it('fails when an image cannot be dated, and when no image was read, asking nothing', () => {
    const undated = verdict([B, `sha256:${'d'.repeat(64)}`]);
    expect(undated.fail, undated.out).toBe('1');
    expect(undated.runs).toEqual([]);
    const none = verdict([]);
    expect(none.fail, none.out).toBe('1');
    expect(none.calls).toEqual([]);
  });
});

// ------------------------------------------------------------ mutations ----

describe('each hold fails on the change it is there for (mutations)', () => {
  const mutate = (text: string, from: string, to: string) => {
    expect(text.includes(from), from).toBe(true);
    return text.replace(from, to);
  };

  it('a RUN in the base, or a stage that is not the build stage it copies from, is read as one', () => {
    const withRun = stagesOf(mutate(dockerfile, 'USER node\n', 'USER node\nRUN ["/usr/bin/dumb-init", "--version"]\n'));
    expect(withRun[2]!.body.map(keyword)).toContain('RUN');
    const fromElsewhere = stagesOf(mutate(dockerfile, 'COPY --from=build /out/usr/bin/dumb-init', 'COPY --from=distroless /out/usr/bin/dumb-init'));
    expect(fromElsewhere[2]!.body.filter((i) => keyword(i) === 'COPY').every((c) => c.startsWith('COPY --from=build '))).toBe(false);
  });

  it("a distroless or build digest that is not the API's is told apart", () => {
    const moved = stagesOf(mutate(dockerfile, stages[0]!.from, stages[0]!.from.replace(/[0-9a-f]{64}$/, '1'.repeat(64))));
    expect(moved[0]!.from).not.toBe(apiStages.at(-1)!.from);
  });

  it('a CLI that writes a RUN after the base stage, or into the runtime stage, is caught', async () => {
    const cli = await installedCli();
    const written = await containerfileFor(A_BASE, cli.BUILD_IMAGE[String(taskConfig.runtime)]);
    expect(shellOnTheBase(mutate(written, 'ENV DEBIAN_FRONTEND=noninteractive\n', 'ENV DEBIAN_FRONTEND=noninteractive\nRUN apt-get update\n'))).toEqual(['base: RUN apt-get update']);
    expect(shellOnTheBase(mutate(written, 'FROM base AS final\n', 'FROM base AS final\nRUN chown node /app\n'))).toEqual(['final: RUN chown node /app']);
    expect(shellOnTheBase(written.replace('FROM base AS final', 'FROM base AS middle\nRUN true\nFROM middle AS final'))).toEqual(['middle: RUN true']);
  });
});
