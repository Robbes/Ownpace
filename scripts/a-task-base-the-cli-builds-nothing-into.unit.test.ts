// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TASK BASE THE CLI BUILDS NOTHING INTO (workplan 0119 §3 item 13; the
 * owner's decision of 2026-11-03, for alpha.5: "CI builds it, signs it and
 * publishes it to GHCR like the other release images").
 *
 * The managed tasks run in the image `trigger.dev deploy` builds. Today it
 * builds them on apps/api/Dockerfile's FROM image, Debian with a layer of
 * apt, trust edits and purges (`apps/worker/trigger.config.ts`). A distroless
 * base would read 0 critical and 0 high and be about a third smaller, but it
 * has no shell, and a Containerfile that RUNs anything on it fails the deploy.
 * So the base is built here once, by CI (`apps/worker/task-image/Dockerfile`,
 * images.yml's `task-base` leg), with everything the CLI's runtime stage needs
 * already in it, and the CLI must write no RUN on it. Read at trigger.dev
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
 *
 * What is NOT held yet: that the tasks run it. trigger.config.ts still builds
 * them on the API image's base with its layer (an-essential-nothing-runs,
 * a-gate-on-a-version-nothing-ships); it names this image by digest once main
 * has published and signed one (workplan 0119, Status of 2026-11-06).
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
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
    // And trigger.config.ts, which builds the tasks until the switch, names the same four.
    expect(read('apps/worker/trigger.config.ts')).toContain(`const DISTRUSTED_ROOTS = [${roots!.map((r) => `'${r}'`).join(', ')}];`);
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
