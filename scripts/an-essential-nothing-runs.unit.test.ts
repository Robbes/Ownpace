// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ESSENTIAL PACKAGE NOTHING RUNS, AND 37 OF 44 HIGH FINDINGS IN IT (workplan
 * 0119; the owner's decision of 2026-11-03, for alpha.4).
 *
 * Two images run our code on the Node image's Debian: the appliance
 * (`apps/selfhost/Dockerfile`'s runtime stage) and the managed tasks (the
 * runtime base `apps/worker/trigger.config.ts` builds them on, the API's Node
 * image with one layer). With npm gone, Trivy 0.76.1 read 0 critical and 44
 * high in both on 2026-11-03, none with a Debian fix. 36 were four util-linux
 * CVEs in each of the nine binary packages its source builds (util-linux,
 * mount, login, bsdutils, libblkid1, libmount1, libsmartcols1, libuuid1,
 * liblastlog2-2), and one was libsqlite3-0's. Nothing in either image runs any
 * of them: they start `node`, which links none of those libraries, the
 * appliance's payload and the tasks' externals hold no native module, and
 * nothing execs su, login, mount or getopt into either. So both purge the ten,
 * which Debian marks Essential (and `login` protected), and read 0 and 7; the 7
 * left are libacl1, libsystemd0, libudev1, libtinfo6, ncurses-base, ncurses-bin
 * and perl-base.
 *
 * An Essential package is one Debian assumes is there, so the purge is held
 * to the shape that fails loudly, and this file holds it:
 *
 * 1. ONE LIST, the same ten in the same order in both files, and exactly the
 *    ten this file names: a package added or dropped is a decision, read
 *    against a scan, not an edit.
 * 2. ONE SHAPE: `dpkg-query -W <list>` first, which stops the build when the
 *    base no longer has one of them (a renamed library is a list to read
 *    again, not a name dpkg skips with a warning); then `dpkg --purge` with
 *    `--force-remove-essential --force-remove-protected` and no other force,
 *    so dpkg still refuses to remove what something installed depends on and
 *    the build stops (`--force-depends` would leave that package broken); then
 *    `apt-get check`.
 * 3. THE APPLIANCE: one RUN in the runtime stage, as root (before USER), and
 *    nothing after it in that stage installs a package. That Dockerfile is the
 *    whole image, so this is its check; E2E (self-hosted) asks the appliance
 *    it built as well (5).
 * 4. THE TASKS: the layer's purge runs where there is no C++ compiler, as its
 *    package-manager removal does: the CLI replays the layer on its `-build`
 *    image, whose Python links libuuid and libsqlite3, and dpkg would refuse
 *    there. It is the layer's last RUN, after every apt step of ours. After
 *    the layer the CLI writes its own repair, `apt-get --fix-broken install`,
 *    which installs only what a broken dependency needs (apt 3.0.3: only a
 *    dist-upgrade adds a missing Essential package), and the weekly scan
 *    builds that stage as the installed CLI writes it: run here through the
 *    CLI's own `generateContainerfile`, so the stage scanned is the stage a
 *    deploy builds, the repair included. Until 2026-11-03 the scan left the
 *    repair out, and would have read 7 if a deploy put util-linux back.
 * 5. WHAT RAN, ASKED: the managed smoke asks the image every runner of its run
 *    started from, and E2E (self-hosted) the appliance it started, with dpkg's
 *    own query. Each block runs here against a stand-in docker: absent passes,
 *    installed fails, a probe that could not be asked fails, and (the smoke)
 *    no image read fails.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { BuildContext, BuildExtension, BuildLayer } from '@trigger.dev/core/v3/build';
import { taskBaseStage } from './image-scan.mjs';
import taskConfig from '../apps/worker/trigger.config.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** The ten, as the owner's decision of 2026-11-03 took them, in the order both files write them. */
const ESSENTIALS = [
  'util-linux',
  'mount',
  'login',
  'bsdutils',
  'libblkid1',
  'libmount1',
  'libsmartcols1',
  'libuuid1',
  'liblastlog2-2',
  'libsqlite3-0',
];

const APPLIANCE = 'apps/selfhost/Dockerfile';
const SMOKE = 'deploy/compose/smoke-managed.sh';
const E2E = '.github/workflows/e2e.yml';
const WORKER_DIR = join(ROOT, 'apps/worker');

/** A package name, as dpkg spells one. */
const NAMES = '[a-z0-9][a-z0-9.+-]+(?: [a-z0-9][a-z0-9.+-]+)*';
/** The purge, whole: the names checked, the force flags, the names purged, then apt's check. */
const PURGE = new RegExp(`^dpkg-query -W (${NAMES}) >/dev/null && dpkg --purge ((?:--force-[a-z-]+ )+)(${NAMES}) && apt-get check$`);
/** The task layer's: the same, where there is no C++ compiler. */
const TASK_PURGE = /^RUN if ! command -v g\+\+ >\/dev\/null; then (.+); fi$/;

type Purge = { checked: string[]; forced: string[]; purged: string[] };

/** A purge's parts, or null when it is not that shape. */
function purgeOf(command: string): Purge | null {
  const m = PURGE.exec(command.replace(/\s+/g, ' ').trim());
  if (!m) return null;
  return { checked: m[1]!.split(' '), forced: m[2]!.trim().split(' '), purged: m[3]!.split(' ') };
}

/** Whether a command is the purge: the ten checked and purged, with the two force flags and no other. */
function fits(command: string): boolean {
  const purge = purgeOf(command);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, n) => x === b[n]);
  return (
    purge !== null &&
    same(purge.checked, ESSENTIALS) &&
    same(purge.purged, ESSENTIALS) &&
    same(purge.forced, ['--force-remove-essential', '--force-remove-protected'])
  );
}

/** What every purge must be: the ten checked and purged, with the two force flags and no other. */
function expectTheShape(where: string, purge: Purge | null): void {
  expect(purge, `${where}: not dpkg-query -W <list> >/dev/null && dpkg --purge <flags> <list> && apt-get check`).not.toBeNull();
  expect(purge!.checked, `${where}: the names dpkg-query checks`).toEqual(ESSENTIALS);
  expect(purge!.purged, `${where}: the names dpkg purges`).toEqual(ESSENTIALS);
  // `--force-depends` (or `--force-all`) would remove a package something
  // installed still needs, and leave that package broken, instead of stopping.
  expect(purge!.forced, `${where}: the force flags`).toEqual(['--force-remove-essential', '--force-remove-protected']);
}

type Instruction = { op: string; args: string };
type Stage = { name: string; body: Instruction[] };

/** A Dockerfile's stages and instructions: comments dropped, continued lines joined, as Docker reads them. */
function stagesOf(text: string): Stage[] {
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
      out.push({ name: as >= 0 ? words[as + 1]! : String(out.length), body: [] });
      continue;
    }
    out.at(-1)?.body.push({ op, args });
  }
  return out;
}

/** A command that installs a package, with apt or dpkg. */
const INSTALLS = /\b(?:apt-get|apt|aptitude)\s+(?:-\S+\s+)*(?:install|reinstall|upgrade|dist-upgrade|full-upgrade)\b|\bdpkg\s+(?:-\S+\s+)*(?:-i|--install|--unpack)\b/;

describe('the appliance purges the ten in its runtime stage, and nothing puts one back', () => {
  const stages = stagesOf(read(APPLIANCE));
  const runtime = stages.at(-1)!;
  const purges = runtime.body.filter((i) => i.op === 'RUN' && /\bdpkg --purge\b/.test(i.args));
  const at = runtime.body.findIndex((i) => i.op === 'RUN' && /\bdpkg --purge\b/.test(i.args));
  const user = runtime.body.findIndex((i) => i.op === 'USER');

  it('one RUN of the runtime stage purges, in that shape, before USER', () => {
    expect(runtime.name).toBe('runtime');
    expect(purges.map((i) => i.args), 'RUNs in the runtime stage that purge').toHaveLength(1);
    expectTheShape(APPLIANCE, purgeOf(purges[0]!.args));
    // As root, who owns dpkg's database; and before the user the app runs as.
    expect(user, 'no USER in the runtime stage').toBeGreaterThan(at);
  });

  it('no instruction after it installs a package', () => {
    for (const i of runtime.body.slice(at + 1)) {
      if (i.op === 'RUN') expect(i.args, `${i.op} ${i.args}`).not.toMatch(INSTALLS);
    }
  });

  it('refuses the shapes that slip', () => {
    const list = ESSENTIALS.join(' ');
    const good = `dpkg-query -W ${list} >/dev/null && dpkg --purge --force-remove-essential --force-remove-protected ${list} && apt-get check`;
    expect(fits(good)).toBe(true);
    for (const bad of [
      good.replace('--force-remove-protected', '--force-remove-protected --force-depends'),
      good.replace('--force-remove-essential --force-remove-protected', '--force-all'),
      good.replace('--force-remove-essential ', ''),
      good.replace(` && apt-get check`, ''),
      good.replace(`dpkg-query -W ${list} >/dev/null && `, ''),
      good.replace('dpkg --purge', 'dpkg --remove'),
      good.replaceAll(' libsqlite3-0', ''),
      good.replace(`--force-remove-protected ${list}`, `--force-remove-protected ${list.replace(' libsqlite3-0', '')}`),
      good.replace('util-linux mount', 'mount util-linux'),
    ]) {
      expect(fits(bad), bad).toBe(false);
    }
    expect('RUN apt-get install -y util-linux').toMatch(INSTALLS);
    expect('RUN apt-get -y --no-install-recommends install login').toMatch(INSTALLS);
    expect('RUN dpkg -i /tmp/util-linux.deb').toMatch(INSTALLS);
    expect('RUN apt-get check').not.toMatch(INSTALLS);
  });
});

/** The config's extensions run as the CLI runs them for a deploy: its layers, and the manifest it reads back. */
async function deploy(): Promise<{ instructions: string[]; image: Record<string, unknown> }> {
  const layers: BuildLayer[] = [];
  const context = { target: 'deploy', workingDir: WORKER_DIR, addLayer: (layer: BuildLayer) => layers.push(layer) } as unknown as BuildContext;
  type Manifest = Parameters<NonNullable<BuildExtension['onBuildComplete']>>[1];
  const manifest = { image: { pkgs: [], instructions: [] } } as unknown as Manifest;
  const extensions = taskConfig.build?.extensions ?? [];
  for (const extension of extensions) await extension.onBuildStart?.(context);
  for (const extension of extensions) await extension.onBuildComplete?.(context, manifest);
  // As the CLI applies a layer to the manifest (`applyLayerToManifest`): its instructions appended.
  const instructions = layers.flatMap((layer) => layer.image?.instructions ?? []);
  expect(layers.flatMap((layer) => layer.image?.pkgs ?? []), 'the layer asks the CLI to install nothing').toEqual([]);
  return { instructions, image: { ...(manifest.image as Record<string, unknown>), instructions, pkgs: [] } };
}

describe("the tasks' runtime base purges the same ten, last of the layer, where there is no C++ compiler", () => {
  it("one instruction of the deploy's layer purges, in that shape, behind the package-manager removal's guard", async () => {
    const { instructions } = await deploy();
    const purges = instructions.filter((i) => /\bdpkg --purge\b/.test(i));
    expect(purges, 'instructions of the layer that purge').toHaveLength(1);
    const guarded = TASK_PURGE.exec(purges[0]!);
    expect(guarded, `${purges[0]}: not RUN if ! command -v g++ >/dev/null; then <purge>; fi`).not.toBeNull();
    expectTheShape('apps/worker/trigger.config.ts', purgeOf(guarded![1]!));
    // The guard the package managers' removal runs under, word for word: the
    // runtime base has no g++, every `-build` image the CLI replays it on has.
    const removal = instructions.find((i) => /\/usr\/local\/lib\/node_modules/.test(i));
    expect(removal, 'the package managers are no longer removed under a g++ guard').toMatch(/^RUN if ! command -v g\+\+ >\/dev\/null; then /);
  });

  it('comes after every apt step of the layer, and is its last RUN', async () => {
    const { instructions } = await deploy();
    const runs = instructions.filter((i) => i.startsWith('RUN '));
    const purge = runs.findIndex((i) => /\bdpkg --purge\b/.test(i));
    const apt = runs.map((i, n) => (/\bapt-get\b/.test(i) && n !== purge ? n : -1)).filter((n) => n >= 0);
    expect(apt.length, 'the layer installs nothing with apt any more (vacuity)').toBeGreaterThan(0);
    for (const n of apt) expect(n, runs[n]).toBeLessThan(purge);
    expect(purge, 'a RUN of the layer comes after the purge').toBe(runs.length - 1);
  });
});

/** The installed Trigger.dev CLI's Containerfile writer, the one `deploy-tasks.sh` deploys with. */
async function installedCli(): Promise<{ version: string; generateContainerfile: (options: unknown) => Promise<string> }> {
  const dir = join(WORKER_DIR, 'node_modules/trigger.dev');
  expect(existsSync(dir), `${dir} is missing: install the workspace (pnpm install)`).toBe(true);
  const version = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }).version;
  const pinned = (JSON.parse(read('apps/worker/package.json')) as { devDependencies?: Record<string, string> }).devDependencies?.['trigger.dev'];
  expect(version, 'the installed CLI is the one apps/worker pins').toBe(pinned);
  const module = (await import(pathToFileURL(realpathSync(join(dir, 'dist/esm/deploy/buildImage.js'))).href)) as {
    generateContainerfile: (options: unknown) => Promise<string>;
  };
  return { version, generateContainerfile: module.generateContainerfile };
}

/** One stage of a Containerfile, from its FROM line to the next, trailing blank lines dropped. */
function stageFrom(containerfile: string, from: string): string {
  const lines = containerfile.split('\n');
  const start = lines.indexOf(from);
  expect(start, `no line ${from}`).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((line, n) => n > start && /^FROM /.test(line));
  return lines
    .slice(start, next < 0 ? undefined : next)
    .join('\n')
    .replace(/\s+$/, '');
}

describe('the scan builds the stage a deploy builds, the CLI\'s repair after the purge included', () => {
  it("image-scan.mjs's stage is the base stage the installed CLI writes for this config", async () => {
    const cli = await installedCli();
    const { image } = await deploy();
    const base = image.base as string;
    expect(base, 'the config names the API image as the tasks\' base').toMatch(/^node:\S+@sha256:[0-9a-f]{64}$/);
    // What `trigger deploy` writes (`writeContainerfile` in its build/buildWorker.js).
    const written = await cli.generateContainerfile({
      runtime: taskConfig.runtime,
      entrypoint: 'managed-run-controller.js',
      indexScript: 'managed-index-controller.js',
      build: { env: {}, commands: [] },
      image,
    });
    const deployed = stageFrom(written, `FROM ${base} AS base`);
    const scanned = stageFrom(await taskBaseStage(taskConfig, { base, workingDir: WORKER_DIR }), `FROM ${base} AS base`);
    expect(scanned, `the scan's stage differs from trigger.dev ${cli.version}'s base stage`).toBe(deployed);
    // Vacuity: the CLI wrote a repair after the layer, and it follows the purge.
    const repair = deployed.indexOf('apt-get --fix-broken install');
    expect(repair, `trigger.dev ${cli.version} writes no apt repair after the layer`).toBeGreaterThan(0);
    expect(deployed.indexOf('dpkg --purge')).toBeGreaterThan(0);
    expect(deployed.indexOf('dpkg --purge')).toBeLessThan(repair);
  });
});

// ------------------------------------------------- what ran, asked ----

/** Bash, with a stand-in `docker` defined before `script`; stdout, stderr and the exit code. */
function bash(script: string, env: Record<string, string> = {}): { status: number | null; out: string } {
  const run = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

/** A stand-in docker: records its arguments, and answers a dpkg-query as told. */
const STUB = `docker() { printf '%s\\n' "$*" >>"$CALLS"; printf '%s' "$SAYS" >&2; return "$RC"; }`;

/** What dpkg-query says, each way it can. */
const ANSWERS = {
  absent: { RC: '1', SAYS: 'dpkg-query: no packages found matching util-linux' },
  purgedRecord: { RC: '0', SAYS: 'purge ok not-installed' },
  installed: { RC: '0', SAYS: 'install ok installed' },
  configFiles: { RC: '0', SAYS: 'deinstall ok config-files' },
  notAsked: { RC: '125', SAYS: 'docker: Error response from daemon: No such image: sha256:0000' },
  noDpkg: { RC: '127', SAYS: 'exec: "dpkg-query": executable file not found in $PATH' },
};

describe("the managed smoke asks the image the runners ran", () => {
  const smoke = read(SMOKE);
  const banner = "# ---------- the tasks' image carries no util-linux ----------";
  const start = smoke.indexOf(banner);
  const block = smoke.slice(start, smoke.indexOf('\n# ---------- ', start + banner.length));
  const failAt = (() => {
    const s = smoke.indexOf('fail_at() {');
    return smoke.slice(s, smoke.indexOf('\n}\n', s) + 3);
  })();

  /** The block run with a runner-log directory holding `images` as `.image` files; the verdict and docker's calls. */
  function verdict(images: string[], answer: { RC: string; SAYS: string }): { fail: string; calls: string; out: string } {
    const dir = mkdtempSync(join(tmpdir(), 'essentials-smoke-'));
    try {
      images.forEach((id, n) => writeFileSync(join(dir, `runner-${n}.image`), `${id}\n`));
      writeFileSync(join(dir, 'calls'), '');
      const run = bash(
        ['set -uo pipefail', 'fail=0', 'SECTION=test', 'FAIL_REASONS=""', 'note() { SECTION="$*"; }', failAt, STUB, block, 'echo "FAIL=$fail"'].join('\n'),
        { RUNNER_LOG_DIR: dir, CALLS: join(dir, 'calls'), ...answer },
      );
      expect(run.status, run.out).toBe(0);
      return { fail: /FAIL=(\d)\s*$/.exec(run.out)?.[1] ?? '?', calls: readFileSync(join(dir, 'calls'), 'utf8'), out: run.out };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const A = `sha256:${'a'.repeat(64)}`;
  const B = `sha256:${'b'.repeat(64)}`;

  it('is there, after the runner logs, and the watcher reads each runner\'s image while it exists', () => {
    expect(start, `${SMOKE} has no section "${banner}"`).toBeGreaterThan(smoke.indexOf('# ---------- runner logs ----------'));
    expect(smoke).toContain(`docker container inspect --format '{{.Image}}' "$c" >"$RUNNER_LOG_DIR/$c.image"`);
    expect(block).toContain('fail_at');
  });

  it('passes an image dpkg knows no util-linux in, asking each image once, by ID, with no network and no pull', () => {
    const run = verdict([A, A, B], ANSWERS.absent);
    expect(run.fail, run.out).toBe('0');
    expect(run.calls.trim().split('\n')).toEqual([
      `run --rm --pull never --network none --entrypoint dpkg-query ${A} -W -f \${Status} util-linux`,
      `run --rm --pull never --network none --entrypoint dpkg-query ${B} -W -f \${Status} util-linux`,
    ]);
    expect(verdict([A], ANSWERS.purgedRecord).fail).toBe('0');
  });

  it('fails an image that has it, one that could not be asked, and a run that read no image', () => {
    for (const answer of [ANSWERS.installed, ANSWERS.configFiles, ANSWERS.notAsked, ANSWERS.noDpkg]) {
      const run = verdict([A], answer);
      expect(run.fail, `${answer.RC}: ${answer.SAYS}\n${run.out}`).toBe('1');
    }
    const none = verdict([], ANSWERS.absent);
    expect(none.fail, none.out).toBe('1');
    expect(none.calls).toBe('');
  });
});

describe('E2E (self-hosted) asks the appliance it started', () => {
  type Step = { name?: string; run?: string };
  const workflow = parseYaml(read(E2E)) as { jobs: Record<string, { steps?: Step[] }> };
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
  const at = steps.findIndex((s) => s.name === 'The appliance carries no util-linux');
  const step = steps[at];

  it('right after it builds and starts the appliance', () => {
    expect(step?.run, `${E2E} has no step "The appliance carries no util-linux"`).toBeDefined();
    expect(steps[at - 1]?.name).toBe('Build + start the self-host appliance');
  });

  /** The step's script under `bash -e`, as the runner runs it; its exit code and docker's calls. */
  function outcome(answer: { RC: string; SAYS: string }): { status: number | null; calls: string; out: string } {
    const dir = mkdtempSync(join(tmpdir(), 'essentials-e2e-'));
    try {
      writeFileSync(join(dir, 'calls'), '');
      const run = bash(`set -e\n${STUB}\n${step!.run!}`, {
        SELFHOST_COMPOSE_FILES: '-f deploy/selfhost/compose.yml',
        CALLS: join(dir, 'calls'),
        ...answer,
      });
      return { status: run.status, calls: readFileSync(join(dir, 'calls'), 'utf8'), out: run.out };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('passes an appliance with no util-linux, asking the app service with dpkg-query', () => {
    const run = outcome(ANSWERS.absent);
    expect(run.status, run.out).toBe(0);
    expect(run.calls.trim()).toBe('compose -f deploy/selfhost/compose.yml exec -T app dpkg-query -W -f ${Status} util-linux');
    expect(outcome(ANSWERS.purgedRecord).status).toBe(0);
  });

  it('fails one that has it, and one that could not be asked', () => {
    for (const answer of [ANSWERS.installed, ANSWERS.configFiles, ANSWERS.notAsked, ANSWERS.noDpkg]) {
      const run = outcome(answer);
      expect(run.status, `${answer.RC}: ${answer.SAYS}\n${run.out}`).toBe(1);
      expect(run.out).toContain('::error::');
    }
  });
});
