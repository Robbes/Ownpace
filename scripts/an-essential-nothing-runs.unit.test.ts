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
 *    there. So the base must be a `-slim` Node image, which ships no g++: on
 *    the full one both would be skipped without a word. It is the layer's last
 *    RUN, after every apt step of ours. After
 *    the layer the CLI writes its own repair, `apt-get --fix-broken install`,
 *    which installs only what a broken dependency needs (apt 3.0.3: only a
 *    dist-upgrade adds a missing Essential package), and the weekly scan
 *    builds that stage as the installed CLI writes it: run here through the
 *    CLI's own `generateContainerfile`, so the stage scanned is the stage a
 *    deploy builds, the repair included. Until 2026-11-03 the scan left the
 *    repair out, and would have read 7 if a deploy put util-linux back.
 * 5. WHAT RAN, ASKED: the managed smoke asks the newest image its runners
 *    started from (the last deploy's: Trigger.dev keeps a run on the version
 *    it was triggered on, so an earlier deployment's runner can be on the
 *    network too, and its image is named, not asked), and E2E (self-hosted)
 *    the appliance it started, about all ten, with dpkg's own query. Each
 *    block runs here against a stand-in docker: absent (or dpkg's record of a
 *    purged package, as `login` keeps one) passes; installed, config files
 *    left, a package not answered for, an answer it cannot read, and a probe
 *    that could not be asked fail; and the smoke fails when no image was read
 *    or one cannot be dated. The watcher starts a runner's log first and reads
 *    its image on every pass until a read answers.
 * 6. THE TRIGGER.DEV WEBAPP (2026-11-06, for alpha.5: item 11 extended under
 *    the owner's alpha.5 instruction, pending the owner's confirmation).
 *    `deploy/compose/trigger.dev/Dockerfile` builds on upstream's image, whose
 *    runner stage is Debian 12 (node:24.22.1-bookworm-slim), where Security
 *    Scan run 42143936608 read 24 highs with no fix in the eight packages
 *    util-linux builds there and CVE-2026-109518 in apt and libapt-pkg6.0.
 *    Its last RUN as root purges those ten, and e2fsprogs, which pre-depends
 *    on libblkid1 and libuuid1 and carries no finding of its own: dpkg refused
 *    the two while it stayed (WEBAPP_PURGE, a list of its own: Debian 12
 *    splits util-linux otherwise, and `login` there is shadow's),
 *    in the same shape: `dpkg-query -W` of the list first, then `dpkg --purge`
 *    with the two flags and no other. apt is on the list, so `apt-get check`
 *    cannot follow; `dpkg --audit` does, before and after, its output read
 *    (dpkg exits 0 when it lists problems), and the libraries the eleven ship
 *    (WEBAPP_LIBRARIES) are checked shipped before and named by no ELF file
 *    of the image after. Nothing after it installs a package, and its header
 *    carries every package and every reason (WEBAPP_REASONS). The RUN itself
 *    runs over a stand-in, with a stand-in dpkg, in
 *    `a-binary-the-stack-never-runs`.
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

  it("runs on a -slim Node image, which ships no C++ compiler, so the guard cannot skip it", async () => {
    // The purge and the package managers' removal both run only where `g++`
    // is not on the PATH. The full `node:<x.y.z>-<codename>` images ship g++
    // (buildpack-deps), so a base moved to one would skip both in silence and
    // the deploy would go on with util-linux and npm in the runtime.
    const { image } = await deploy();
    expect(
      image.base,
      `the tasks' base (the API's FROM line) is not a node:<x.y.z>-<codename>-slim image pinned by digest, and on an image with g++ the layer's purge and removal do nothing`,
    ).toMatch(/^node:\d+\.\d+\.\d+-[a-z]+-slim@sha256:[0-9a-f]{64}$/);
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

// -------------------------------------- the Trigger.dev webapp's image ----

const WEBAPP = 'deploy/compose/trigger.dev/Dockerfile';

/**
 * The eleven the webapp's image purges (2026-11-06, for alpha.5), in the order its
 * RUN writes them, each with why it may go. Debian 12.15 is upstream's runner
 * stage, and Security Scan run 42143936608 (Trivy 0.76.1, linux/arm64) read
 * the findings named.
 */
const WEBAPP_PURGE: ReadonlyArray<{ readonly name: string; readonly why: string }> = [
  { name: 'util-linux', why: 'Essential; 3 highs with no fix; nothing here runs its programs (su, getopt, more, mount helpers), and the entrypoint is dash' },
  { name: 'util-linux-extra', why: '3 highs with no fix; util-linux hard-depends on it in Debian 12 (2.38-1 made it pseudo-Essential), so it goes with it; nothing runs hwclock or lsfd' },
  { name: 'mount', why: '3 highs with no fix; nothing mounts anything in a container that runs node; it depends on util-linux' },
  { name: 'bsdutils', why: 'Essential; 3 highs with no fix; nothing runs logger, script, wall or renice' },
  { name: 'libblkid1', why: '3 highs with no fix; linked by the util-linux programs above and nothing else here (node, goose, the prisma engines and the native addons need none)' },
  { name: 'libmount1', why: '3 highs with no fix; linked by mount and util-linux, and nothing else here' },
  { name: 'libsmartcols1', why: '3 highs with no fix; linked by util-linux and util-linux-extra, and nothing else here' },
  { name: 'libuuid1', why: '3 highs with no fix; Node makes its UUIDs itself (crypto.randomUUID), and nothing here links libuuid' },
  { name: 'apt', why: 'CVE-2026-109518 (high, fixed in 2.6.2: an on-path attacker during an apt download); nothing in trigger-api runs apt, and nothing installs in it: a change is a rebuild' },
  { name: 'libapt-pkg6.0', why: 'CVE-2026-109518 as apt; apt is its one user here' },
  { name: 'e2fsprogs', why: 'no finding of its own; it pre-depends on libblkid1 and libuuid1, so dpkg refuses those two while it stays; nothing makes or checks a file system here, and nothing depends on it' },
];

/** The libraries those ship, which no ELF file of the image may name once they are gone. */
const WEBAPP_LIBRARIES = ['libuuid.so.1', 'libblkid.so.1', 'libmount.so.1', 'libsmartcols.so.1', 'libapt-pkg.so.6.0', 'libapt-private.so.0.0'];

/**
 * What the header's THE DEBIAN PACKAGES NOTHING RUNS says, word for word once
 * its comment lines are joined: the measurement, why nothing runs or loads the
 * eleven (each read at read_at, or in a published file by its hash), how dpkg's
 * refusal is kept, and why `dpkg --audit` stands where `apt-get check` does.
 */
const WEBAPP_REASONS: ReadonlyArray<readonly [string, string]> = [
  ['Security Scan run 42143936608 (Trivy 0.76.1, linux/arm64, 2026-11-06) read this image at 1 critical, 49 high and 16 with a fix', 'the scan it was read against'],
  ['apt 2.6.1 and libapt-pkg6.0 2.6.1: CVE-2026-109518 (high, fixed in 2.6.2; an on-path attacker during an apt download)', "apt's finding"],
  ['three highs with no fix in Debian in each of the eight packages', "util-linux's findings"],
  ['util-linux-extra goes with util-linux, which hard-depends on it in Debian 12', 'why util-linux-extra is on the list'],
  ['libapt-pkg6.0 with apt, its one user here', 'why libapt-pkg6.0 is on the list'],
  ['The last RUN as root purges those ten, and e2fsprogs 1.47.0-2+b2, which carries no finding of its own and pre-depends on libblkid1 and libuuid1: dpkg refused to purge those two while it stayed', 'why e2fsprogs is on the list'],
  ['has no other installed package that depends on one of the eleven, and none that depends on e2fsprogs', 'that nothing else depends on the eleven'],
  ['The entrypoint (docker/scripts/entrypoint.sh, pinned by entrypoint_sha256) is /bin/sh, dash, and runs pnpm', 'what the entrypoint runs'],
  ['scripts/wait-for-it.sh only with DATABASE_HOST, which managed.yml does not set', 'why wait-for-it.sh does not run'],
  ['the dashboard agent\'s repo tools run tar (with gzip, -z) and rg', 'what the server spawns'],
  ['the SDK\'s bash skill (agentSkillsRuntime.ts), which the webapp never calls', 'the one other spawner the webapp loads'],
  ['Nothing execs apt, apt-get, su, mount, getopt, logger, more, mke2fs, e2fsck or any other program of the eleven into the container', 'what nothing execs'],
  ["node 24.22.1 (nodejs.org's linux-arm64 and linux-x64 builds, which the Node image unpacks) needs libdl, libstdc++, libm, libgcc_s, libpthread and libc", "node's libraries"],
  ["goose v3.29.0's two release assets are static", "goose's"],
  ["prisma 6.14.0's engines (commit 717184b7", "prisma's engines"],
  ["sentry-cli 2.50.2 (static), bufferutil 4.0.9's linux-x64 prebuild (glibc alone) and rollup 4.60.1's linux-x64-gnu addon (libgcc_s and glibc)", 'the native addons'],
  ['No byte of any of those files names one of the six', 'that none names a purged library'],
  ['Without --force-depends, dpkg refuses to remove what an installed package still depends on, so a base where one does stops the build', 'why no other force'],
  ['So `dpkg --audit` takes its place, and its output is read, not its exit status', 'why dpkg --audit, and read by its output'],
  ['The half of apt-get check a purge could break, a dependency left unmet, is dpkg\'s own refusal in 3', "what of apt-get check's work stays"],
  ["images.yml's `build (trigger, amd64|arm64)` runs this RUN on the real image, where a wrong reading stops the build", 'where the reading is proved'],
];

/** A Dockerfile header's comment lines from the one that starts `# <from>` to the one that starts `# <to>`, joined into one line. */
function sectionOf(text: string, from: string, to: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`# ${from}`));
  const end = lines.findIndex((l, n) => n > start && l.startsWith(`# ${to}`));
  if (start < 0 || end < 0) return '';
  return lines
    .slice(start, end)
    .map((l) => l.replace(/^#\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
}

type Run = { args: string; user: string; at: number };

/** A Dockerfile's RUNs, each with the USER in force and its place among all instructions. */
function runsOf(text: string): { runs: Run[]; body: Instruction[] } {
  const body = stagesOf(text).flatMap((s) => s.body);
  let user = 'root';
  const runs: Run[] = [];
  body.forEach((i, at) => {
    if (i.op === 'USER') user = i.args.trim();
    if (i.op === 'RUN') runs.push({ args: i.args, user, at });
  });
  return { runs, body };
}

/** The webapp's purge, what is wrong with it, in words; empty when it holds. */
function webappProblems(text: string): string[] {
  const problems: string[] = [];
  const { runs, body } = runsOf(text);
  const purges = runs.filter((r) => /(^|[;\s])dpkg --purge\b/.test(r.args));
  if (purges.length !== 1) return [`${purges.length} RUNs run dpkg --purge, not one`];
  const run = purges[0]!;
  const args = run.args.replace(/\s+/g, ' ');
  if (run.user !== 'root') problems.push(`the purge runs as ${run.user}, not root, who owns dpkg's database`);
  const lastRoot = runs.filter((r) => r.user === 'root').at(-1);
  if (lastRoot !== run) problems.push('the purge is not the last RUN as root: every other change comes before it, and nothing after it may need what it purged');
  if (body[run.at + 1]?.op !== 'USER' || body[run.at + 1]?.args.trim() !== 'node') problems.push("the purge is not followed by upstream's USER node");
  for (const later of runs.filter((r) => r.at > run.at)) {
    if (INSTALLS.test(later.args)) problems.push(`a RUN after the purge installs a package: ${later.args.slice(0, 80)}`);
  }
  const value = (name: string) => new RegExp(`(?:^|[;\\s])${name}="([^"]*)";`).exec(args)?.[1]?.split(' ');
  const same = (a: readonly string[] | undefined, b: readonly string[]) => a !== undefined && a.length === b.length && a.every((x, n) => x === b[n]);
  if (!same(value('purge'), WEBAPP_PURGE.map((p) => p.name))) problems.push(`its purge= is ${JSON.stringify(value('purge'))}, not the eleven WEBAPP_PURGE names, in order`);
  if (!same(value('libraries'), WEBAPP_LIBRARIES)) problems.push(`its libraries= is ${JSON.stringify(value('libraries'))}, not WEBAPP_LIBRARIES`);
  const at = (re: RegExp) => args.search(re);
  const query = at(/(?:^|[;\s])dpkg-query -W \$purge \|\| fail /);
  const purge = /(?:^|[;\s])dpkg --purge ((?:--force-[a-z-]+ )+)\$purge \|\| fail /.exec(args);
  const firstDpkg = at(/(?:^|[;\s(])dpkg(?:-query)? /);
  if (query < 0) problems.push('no `dpkg-query -W $purge || fail`: a renamed or missing package would be a name dpkg skips with a warning');
  else if (query !== firstDpkg) problems.push('`dpkg-query -W $purge` is not the first thing it asks dpkg');
  if (!purge) problems.push('no `dpkg --purge <flags> $purge || fail`');
  else {
    const flags = purge[1]!.trim().split(' ');
    // `--force-depends` (or `--force-all`) would remove a package something installed still needs, and leave that package broken, instead of stopping.
    if (!same(flags, ['--force-remove-essential', '--force-remove-protected'])) problems.push(`its force flags are ${flags.join(' ')}, not --force-remove-essential --force-remove-protected alone`);
    if (query > purge.index) problems.push('dpkg-query -W comes after the purge, which checks nothing in time');
  }
  // What the RUN runs, its failure messages (which name --force-depends, to say why it is not there) left out.
  const code = args.replace(/fail "[^"]*"/g, 'fail ""');
  const forces = code.match(/--force-[a-z-]+/g) ?? [];
  if (forces.length !== 2) problems.push(`it names ${forces.length} --force flags (${forces.join(' ')}), not the purge's two`);
  // apt as a command (after `;`, `&&`, `||`, `(`, `do` or `then`), not the word in the list.
  if (/(?:^|;|&&|\|\||\(|\bdo|\bthen)\s*(?:apt-get|apt|aptitude)\s/.test(code)) problems.push('it runs apt, which it purges: `dpkg --audit` checks what is left');
  const purgeAt = purge?.index ?? -1;
  const audits = [...args.matchAll(/(?:^|[;\s])audit="\$\(dpkg --audit\)" \|\| fail "[^"]*"; \[ -z "\$audit" \] \|\| fail /g)].map((m) => m.index!);
  if (!audits.some((i) => i < purgeAt)) problems.push("no `dpkg --audit` read, its output empty, before the purge");
  if (!audits.some((i) => i > purgeAt)) problems.push("no `dpkg --audit` read, its output empty, after the purge");
  const shipped = at(/(?:^|[;\s])listed="\$\(dpkg-query -L \$purge\)" \|\| fail "[^"]*"; for l in \$libraries; do case "\$listed" in \*"\/\$l"\*\) ;; \*\) fail /);
  if (shipped < 0 || shipped > purgeAt) problems.push('no check, before the purge, that the eleven ship every library of $libraries');
  const gone = at(/(?:^|[;\s])for p in \$purge; do st="\$\(dpkg-query -W -f '\$\{db:Status-Status\}' "\$p" 2>\/dev\/null\)" && rc=0 \|\| rc=\$\?; case "\$rc:\$st" in 1:\|0:not-installed\) ;; \*\) fail /);
  if (gone < 0 || gone < purgeAt) problems.push('no check, after the purge, that dpkg reads each of the eleven as gone');
  const scan = at(/(?:^|[;\s])found="\$\(node -e "\$elves" "\$top" \$libraries\)" && st=0 \|\| st=\$\?; \[ "\$st" = 0 \] \|\| fail /);
  if (scan < 0 || scan < purgeAt) problems.push('no scan, after the purge, for an ELF file that names one of $libraries');
  if (!/(?:^|[;\s])top=\/;/.test(args)) problems.push('the scan does not start at /, the image whole');
  const elves = /(?:^|[;\s])elves="([^"]*)";/.exec(args)?.[1] ?? '';
  for (const [needle, what] of [
    // Directories only: on overlayfs a file's st_dev can be its layer's, and a file skipped is a file not read.
    ['if (s.isDirectory()) { if (s.dev === dev) walk(p); continue; }', "walks every directory of the image's own file system, and no other"],
    ['head.readUInt32BE(0) !== 0x7f454c46', "reads ELF's magic"],
    ['const b = fs.readFileSync(p); for (const n of names) if (b.includes(n))', 'reads each ELF whole for every name'],
    ['if (read === 0) process.exit(2);', 'fails when it read no ELF at all'],
    ['if (hits.length) {', 'fails on a file that names one'],
  ] as const) {
    if (!elves.includes(needle)) problems.push(`the scan no longer ${what}`);
  }
  for (const c of ['grep', 'cp', 'tar', 'gzip', 'dumb-init']) {
    if (!new RegExp(`for c in [^;]*\\b${c}\\b[^;]*; do "\\$c" --version >/dev/null 2>&1 \\|\\| fail `).test(args)) problems.push(`no proof, after the purge, that ${c} starts`);
  }
  if (!/(?:^|[;\s])\/usr\/local\/bin\/goose -version >\/dev\/null \|\| fail /.test(args)) problems.push('no proof, after the purge, that goose starts');
  if (!/(?:^|[;\s])node -e 0 \|\| fail /.test(args)) problems.push('no proof, after the purge, that node starts');
  return problems;
}

describe("the Trigger.dev webapp's image purges the eleven of Debian 12 nothing there runs, last of its root RUNs (2026-11-06)", () => {
  const webapp = read(WEBAPP);
  const reasons = sectionOf(webapp, 'THE DEBIAN PACKAGES NOTHING RUNS (since', 'TWO NAMES FOR EACH BINARY.');
  const how = sectionOf(webapp, 'HOW THEY ARE PURGED, AND PROVED.', 'TWO NAMES FOR EACH BINARY.');

  it('one RUN, the last as root, before USER node, purges WEBAPP_PURGE in the shape that fails loudly', () => {
    expect(webappProblems(webapp)).toEqual([]);
  });

  it('WEBAPP_PURGE says why each may go, and the header names each package and each library', () => {
    expect(WEBAPP_PURGE.map((p) => p.name)).toHaveLength(11);
    for (const p of WEBAPP_PURGE) {
      expect(p.why.length, `${p.name}: why`).toBeGreaterThan(40);
      expect(reasons, `the header's section names no ${p.name}`).toMatch(new RegExp(`(^|[\\s(,])${p.name.replace(/[.+]/g, '\\$&')}([\\s),.:;]|$)`));
    }
    for (const so of WEBAPP_LIBRARIES) expect(reasons, `the header's section names no ${so}`).toContain(so);
  });

  it("the header carries every reason, word for word, and says how it is proved", () => {
    expect(reasons.length, 'no section THE DEBIAN PACKAGES NOTHING RUNS').toBeGreaterThan(1000);
    for (const [needle, what] of WEBAPP_REASONS) expect(reasons, what).toContain(needle);
    expect(how, 'no section HOW THEY ARE PURGED, AND PROVED').toContain('`dpkg-query -W` of exactly the eleven, first');
    expect(how).toContain('--force-remove-essential --force-remove-protected`, the two flags of the owner\'s decision, and no other force');
  });

  it('refuses each way the purge could slip', () => {
    const swap = (from: string | RegExp, to: string) => {
      const next = webapp.replace(from, to);
      expect(next, `${String(from)} is not in ${WEBAPP}`).not.toBe(webapp);
      return webappProblems(next);
    };
    expect(swap('--force-remove-protected $purge', '--force-remove-protected --force-depends $purge')).toEqual([
      'its force flags are --force-remove-essential --force-remove-protected --force-depends, not --force-remove-essential --force-remove-protected alone',
      'it names 3 --force flags (--force-remove-essential --force-remove-protected --force-depends), not the purge\'s two',
    ]);
    expect(swap('--force-remove-essential --force-remove-protected $purge', '--force-all $purge')).toContain('its force flags are --force-all, not --force-remove-essential --force-remove-protected alone');
    expect(swap(' libuuid1 apt', ' apt')).toEqual(['its purge= is ["util-linux","util-linux-extra","mount","bsdutils","libblkid1","libmount1","libsmartcols1","apt","libapt-pkg6.0","e2fsprogs"], not the eleven WEBAPP_PURGE names, in order']);
    // e2fsprogs off the list: on this base dpkg refuses libblkid1 and libuuid1 for it, so the list is the decision, not a name to drop.
    expect(swap(' libapt-pkg6.0 e2fsprogs"', ' libapt-pkg6.0"')).toEqual(['its purge= is ["util-linux","util-linux-extra","mount","bsdutils","libblkid1","libmount1","libsmartcols1","libuuid1","apt","libapt-pkg6.0"], not the eleven WEBAPP_PURGE names, in order']);
    expect(swap('purge="util-linux util-linux-extra', 'purge="util-linux-extra util-linux')).toHaveLength(1);
    expect(swap(' libapt-private.so.0.0"', '"')).toEqual(['its libraries= is ["libuuid.so.1","libblkid.so.1","libmount.so.1","libsmartcols.so.1","libapt-pkg.so.6.0"], not WEBAPP_LIBRARIES']);
    expect(swap(/^ {4}dpkg-query -W \$purge \|\| fail [^\n]*\n/m, '')).toEqual(['no `dpkg-query -W $purge || fail`: a renamed or missing package would be a name dpkg skips with a warning']);
    // The query moved after the purge: still there, too late.
    const query = /^ {4}dpkg-query -W \$purge \|\| fail [^\n]*\n/m.exec(webapp)![0];
    const late = webapp.replace(query, '').replace(/^( {4}dpkg --purge [^\n]*\n)/m, `$1${query}`);
    expect(webappProblems(late)).toEqual(['`dpkg-query -W $purge` is not the first thing it asks dpkg', 'dpkg-query -W comes after the purge, which checks nothing in time']);
    expect(swap(/^ {4}\[ -z "\$audit" \] \|\| fail "dpkg --audit reads problems[^\n]*\n/m, '')).toEqual(['no `dpkg --audit` read, its output empty, before the purge']);
    expect(swap(/^ {4}\[ -z "\$audit" \] \|\| fail "after the purge[^\n]*\n/m, '')).toEqual(['no `dpkg --audit` read, its output empty, after the purge']);
    // apt-get check in dpkg --audit's place: apt is gone by then.
    expect(swap(/^( {4}audit="\$\(dpkg --audit\)" \|\| fail "dpkg --audit did not run after the purge\.";) \\\n {4}\[ -z "\$audit" \][^\n]*\n/m, '    apt-get check || fail "apt is not consistent"; \\\n')).toEqual([
      'it runs apt, which it purges: `dpkg --audit` checks what is left',
      'no `dpkg --audit` read, its output empty, after the purge',
    ]);
    expect(swap(/^ {4}listed="[^\n]*\n {4}for l in \$libraries[^\n]*\n/m, '')).toEqual(['no check, before the purge, that the eleven ship every library of $libraries']);
    expect(swap(/^ {4}for p in \$purge; do [^\n]*\n/m, '')).toEqual(['no check, after the purge, that dpkg reads each of the eleven as gone']);
    expect(swap(/^ {4}found="\$\(node -e "\$elves"[^\n]*\n {4}\[ "\$st" = 0 \][^\n]*\n/m, '')).toEqual(['no scan, after the purge, for an ELF file that names one of $libraries']);
    expect(swap('if (s.dev === dev) walk(p);', 'walk(p);')).toEqual(["the scan no longer walks every directory of the image's own file system, and no other"]);
    // A device check on files as well would pass over a file whose layer gives it another st_dev.
    expect(swap('if (s.isDirectory()) { if (s.dev === dev) walk(p); continue; }', 'if (s.dev !== dev) continue; if (s.isDirectory()) { walk(p); continue; }')).toEqual([
      "the scan no longer walks every directory of the image's own file system, and no other",
    ]);
    expect(swap('if (read === 0) process.exit(2); ', '')).toEqual(['the scan no longer fails when it read no ELF at all']);
    expect(swap('for c in grep cp tar gzip dumb-init;', 'for c in grep cp tar gzip;')).toEqual(['no proof, after the purge, that dumb-init starts']);
    expect(swap(/^ {4}\/usr\/local\/bin\/goose -version[^\n]*\n/m, '')).toEqual(['no proof, after the purge, that goose starts']);
    // Not the last RUN as root: a RUN after it, as root, could need what it purged.
    const purgeRun = /\n# Still as root, and the last of root's RUNs[\s\S]*?start\."\n/.exec(webapp)![0];
    const early = webapp.replace(purgeRun, '\n').replace(/\n# Still as root: goose v3\.27\.1 replaced/, `${purgeRun}\n# Still as root: goose v3.27.1 replaced`);
    expect(early).not.toBe(webapp);
    expect(webappProblems(early)).toEqual([
      'the purge is not the last RUN as root: every other change comes before it, and nothing after it may need what it purged',
      "the purge is not followed by upstream's USER node",
    ]);
    // As node, after upstream's USER.
    const asNode = webapp.replace(purgeRun, '\n').replace(/\n# As node, the copy is gone/, `${purgeRun}\n# As node, the copy is gone`);
    expect(webappProblems(asNode)).toContain("the purge runs as node, not root, who owns dpkg's database");
    // An install after it.
    expect(webappProblems(`${webapp}RUN apt-get install -y util-linux\n`)).toContain('a RUN after the purge installs a package: apt-get install -y util-linux');
    expect(swap(/^( {4})dpkg --purge /m, '$1dpkg --remove ')).toEqual(['0 RUNs run dpkg --purge, not one']);
    // A shell that runs apt, as a command: apt is gone by then, and the word in the list is no command.
    expect(swap(/^( {4}dpkg --purge [^\n]*\n)/m, '$1    apt-get autoremove -y || fail "apt"; \\\n')).toEqual(['it runs apt, which it purges: `dpkg --audit` checks what is left']);
  });
});

// ------------------------------------------------- what ran, asked ----

/** Bash, with a stand-in `docker` defined before `script`; stdout, stderr and the exit code. */
function bash(script: string, env: Record<string, string> = {}): { status: number | null; out: string } {
  const run = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

/**
 * A stand-in docker, recording its arguments: an image's build time from
 * `$CREATED` (`<id> <time>` lines; an id missing there cannot be dated), and a
 * dpkg-query answered as `$SAYS` with `$RC`, or, in the image `$KEEPER`, with
 * all ten installed.
 */
const STUB = `docker() {
  printf '%s\\n' "$*" >>"$CALLS"
  if [ "$1 $2" = "image inspect" ]; then
    awk -v id="$5" '$1 == id { print $2; found = 1 } END { exit !found }' <<<"$CREATED" || { echo "Error: No such image: $5" >&2; return 1; }
    return 0
  fi
  case "$*" in
    *" \${KEEPER:-no-image-keeps-them} "*) printf '%s\\n' ${ESSENTIALS.map((p) => `'${p} install ok installed'`).join(' ')}; return 0 ;;
  esac
  printf '%s\\n' "$SAYS" >&2
  return "$RC"
}`;

const notFound = (p: string) => `dpkg-query: no packages found matching ${p}`;

/** What dpkg-query says about the ten, each way it can. */
const ANSWERS = {
  absent: { RC: '1', SAYS: ESSENTIALS.map(notFound).join('\n') },
  // As the purged base answered on 2026-11-03: dpkg keeps a record of `login`, protected, as not-installed.
  purgedRecord: { RC: '1', SAYS: [...ESSENTIALS.filter((p) => p !== 'login').map(notFound), 'login unknown ok not-installed'].join('\n') },
  oneInstalled: { RC: '1', SAYS: [...ESSENTIALS.slice(0, 9).map(notFound), 'libsqlite3-0 install ok installed'].join('\n') },
  allInstalled: { RC: '0', SAYS: ESSENTIALS.map((p) => `${p} install ok installed`).join('\n') },
  configFiles: { RC: '1', SAYS: [...ESSENTIALS.slice(1).map(notFound), 'util-linux deinstall ok config-files'].join('\n') },
  oneUnanswered: { RC: '1', SAYS: ESSENTIALS.slice(1).map(notFound).join('\n') },
  oddLine: { RC: '2', SAYS: 'dpkg-query: error: cannot access archive' },
  // Every line readable, and an exit dpkg-query never gives with them: the command did not finish as it says.
  badExit: { RC: '137', SAYS: ESSENTIALS.map(notFound).join('\n') },
  notAsked: { RC: '125', SAYS: 'docker: Error response from daemon: No such image: sha256:0000' },
  noDpkg: { RC: '127', SAYS: 'exec: "dpkg-query": executable file not found in $PATH' },
};
const PASSING = [ANSWERS.absent, ANSWERS.purgedRecord];
const FAILING = [
  ANSWERS.oneInstalled,
  ANSWERS.allInstalled,
  ANSWERS.configFiles,
  ANSWERS.oneUnanswered,
  ANSWERS.oddLine,
  ANSWERS.badExit,
  ANSWERS.notAsked,
  ANSWERS.noDpkg,
];

/** The ten a block asks about, from its `essentials="…"`. */
const askedIn = (text: string) => /^\s*essentials="([^"]+)"$/m.exec(text)?.[1]?.split(' ');

/** The query, as the stand-in records it. */
const QUERY = `dpkg-query -W -f \${Package} \${Status}\\n ${ESSENTIALS.join(' ')}`;

describe('the managed smoke asks the image the last deploy built', () => {
  const smoke = read(SMOKE);
  const banner = "# ---------- the tasks' image carries none of the Debian Essentials it purges ----------";
  const start = smoke.indexOf(banner);
  const block = smoke.slice(start, smoke.indexOf('\n# ---------- ', start + banner.length));
  const failAt = (() => {
    const s = smoke.indexOf('fail_at() {');
    return smoke.slice(s, smoke.indexOf('\n}\n', s) + 3);
  })();
  // The watcher's pass over the runners it sees: its `for` loop, whole.
  const watcherAt = smoke.indexOf('    for c in $(docker ps --filter');
  const watcher = smoke.slice(watcherAt, smoke.indexOf('\n    done\n', watcherAt) + '\n    done\n'.length);

  const A = `sha256:${'a'.repeat(64)}`;
  const B = `sha256:${'b'.repeat(64)}`;
  const C = `sha256:${'c'.repeat(64)}`;
  const BUILT = `${A} 2026-11-02T21:00:00.5Z\n${B} 2026-11-03T07:00:00.123456789Z\n${C} 2026-11-03T06:59:59Z`;

  /** The block run with runner records holding `images`; the verdict, docker's calls and what it said. */
  function verdict(images: string[], answer: { RC: string; SAYS: string }, extra: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'essentials-smoke-'));
    try {
      images.forEach((id, n) => writeFileSync(join(dir, `runner-${n}.image`), `${id}\n`));
      writeFileSync(join(dir, 'calls'), '');
      const run = bash(
        ['set -uo pipefail', 'fail=0', 'SECTION=test', 'FAIL_REASONS=""', 'note() { SECTION="$*"; }', failAt, STUB, block, 'echo "FAIL=$fail"'].join('\n'),
        { RUNNER_LOG_DIR: dir, CALLS: join(dir, 'calls'), CREATED: BUILT, ...answer, ...extra },
      );
      expect(run.status, run.out).toBe(0);
      const calls = readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean);
      return { fail: /FAIL=(\d)\s*$/.exec(run.out)?.[1] ?? '?', runs: calls.filter((c) => c.startsWith('run ')), calls, out: run.out };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('is there, after the runner logs, and asks about the ten', () => {
    expect(start, `${SMOKE} has no section "${banner}"`).toBeGreaterThan(smoke.indexOf('# ---------- runner logs ----------'));
    expect(askedIn(block)).toEqual(ESSENTIALS);
    expect(block).toContain('fail_at');
  });

  it("the watcher starts a runner's log first, and reads its image on every pass until a read answers", () => {
    expect(watcherAt, 'no watcher loop over `docker ps`').toBeGreaterThan(0);
    // Before the read: a read that waits on the daemon must not hold the log back.
    expect(watcher.indexOf('docker logs -f')).toBeGreaterThan(0);
    expect(watcher.indexOf('docker logs -f')).toBeLessThan(watcher.indexOf('docker container inspect'));
    const dir = mkdtempSync(join(tmpdir(), 'essentials-watcher-'));
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
    // A runner of an earlier deployment (A, built the night before, still
    // carrying all ten) beside the deploy's (B): A is named, not asked.
    const run = verdict([A, B, A, C], ANSWERS.absent, { KEEPER: A });
    expect(run.fail, run.out).toBe('0');
    expect(run.runs).toEqual([`run --rm --pull never --network none --entrypoint dpkg-query ${B} -W -f \${Package} \${Status}\\n ${ESSENTIALS.join(' ')}`]);
    expect(run.out).toContain(`image ${'a'.repeat(12)}: built before the newest`);
    expect(run.out).toContain(`image ${'c'.repeat(12)}: built before the newest`);
    // And the newest is the one that must be clean.
    expect(verdict([A, B], ANSWERS.absent, { KEEPER: B }).fail).toBe('1');
  });

  it('passes what dpkg reads as absent, and fails anything else it says', () => {
    for (const answer of PASSING) expect(verdict([B], answer).fail, answer.SAYS).toBe('0');
    for (const answer of FAILING) {
      const run = verdict([B], answer);
      expect(run.fail, `${answer.RC}: ${answer.SAYS}\n${run.out}`).toBe('1');
    }
    expect(verdict([B], ANSWERS.oneInstalled).out).toContain('libsqlite3-0 (installed)');
  });

  it('fails when an image cannot be dated, and when no image was read, asking nothing', () => {
    const undated = verdict([B, `sha256:${'d'.repeat(64)}`], ANSWERS.absent);
    expect(undated.fail, undated.out).toBe('1');
    expect(undated.runs).toEqual([]);
    const none = verdict([], ANSWERS.absent);
    expect(none.fail, none.out).toBe('1');
    expect(none.calls).toEqual([]);
  });
});

describe('E2E (self-hosted) asks the appliance it started', () => {
  type Step = { name?: string; run?: string };
  const workflow = parseYaml(read(E2E)) as { jobs: Record<string, { steps?: Step[] }> };
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
  const name = 'The appliance carries none of the Debian Essentials it purges';
  const at = steps.findIndex((s) => s.name === name);
  const step = steps[at];

  it('right after it builds and starts the appliance, about the ten', () => {
    expect(step?.run, `${E2E} has no step "${name}"`).toBeDefined();
    expect(steps[at - 1]?.name).toBe('Build + start the self-host appliance');
    expect(askedIn(step!.run!)).toEqual(ESSENTIALS);
  });

  /** The step's script under `bash -e`, as the runner runs it; its exit code and docker's calls. */
  function outcome(answer: { RC: string; SAYS: string }): { status: number | null; calls: string; out: string } {
    const dir = mkdtempSync(join(tmpdir(), 'essentials-e2e-'));
    try {
      writeFileSync(join(dir, 'calls'), '');
      const run = bash(`set -e\n${STUB}\n${step!.run!}`, {
        SELFHOST_COMPOSE_FILES: '-f deploy/selfhost/compose.yml',
        CALLS: join(dir, 'calls'),
        CREATED: '',
        ...answer,
      });
      return { status: run.status, calls: readFileSync(join(dir, 'calls'), 'utf8'), out: run.out };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('passes what dpkg reads as absent, asking the app service', () => {
    for (const answer of PASSING) {
      const run = outcome(answer);
      expect(run.status, `${answer.SAYS}\n${run.out}`).toBe(0);
      expect(run.calls.trim()).toBe(`compose -f deploy/selfhost/compose.yml exec -T app ${QUERY}`);
    }
  });

  it('fails anything else it says, by name', () => {
    for (const answer of FAILING) {
      const run = outcome(answer);
      expect(run.status, `${answer.RC}: ${answer.SAYS}\n${run.out}`).toBe(1);
      expect(run.out).toContain('::error::');
    }
    expect(outcome(ANSWERS.oneInstalled).out).toContain('libsqlite3-0 (installed)');
  });
});
