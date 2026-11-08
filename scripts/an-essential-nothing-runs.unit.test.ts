// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ESSENTIAL PACKAGE NOTHING RUNS, AND 37 OF 44 HIGH FINDINGS IN IT (workplan
 * 0119; the owner's decision of 2026-11-03, for alpha.4).
 *
 * Two images ran our code on the Node image's Debian: the appliance
 * (`apps/selfhost/Dockerfile`'s runtime stage) and the managed tasks (the
 * runtime base `apps/worker/trigger.config.ts` built them on, the API's Node
 * image with one layer), each until 2026-11-06. With npm gone, Trivy 0.76.1 read 0
 * critical and 44 high in both on 2026-11-03, none with a Debian fix. 36 were four util-linux
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
 * Since 2026-11-06 neither purges: the appliance's runtime is distroless
 * (0119 §3 item 12), and the tasks run on the prebuilt base
 * (`apps/worker/task-image/Dockerfile`, published to GHCR and pinned in
 * trigger.config.ts; item 13), distroless too, with nothing the CLI builds
 * into it. Each has none of the ten and no dpkg to purge them with.
 * `an-appliance-with-nothing-to-exec` holds the appliance (and runs the E2E
 * step that asks it), and `a-task-base-the-cli-builds-nothing-into` the
 * tasks' base, the config and the managed smoke's question to the image the
 * last deploy built. A move back to a Debian base would take the purge back,
 * in the shape below.
 *
 * An Essential package is one Debian assumes is there, so the purge is held
 * to the shape that fails loudly, and this file holds it:
 *
 * 1. ONE LIST, exactly the ten this file names, in this order: a package
 *    added or dropped is a decision, read against a scan, not an edit.
 * 2. ONE SHAPE: `dpkg-query -W <list>` first, which stops the build when the
 *    base no longer has one of them (a renamed library is a list to read
 *    again, not a name dpkg skips with a warning); then `dpkg --purge` with
 *    `--force-remove-essential --force-remove-protected` and no other force,
 *    so dpkg still refuses to remove what something installed depends on and
 *    the build stops (`--force-depends` would leave that package broken); then
 *    `apt-get check`.
 * 3. THE APPLIANCE purges nothing: its runtime stage is distroless, with no
 *    dpkg and none of the ten (until 2026-11-06, one RUN in its runtime stage,
 *    as root, in the shape above).
 * 4. THE TRIGGER.DEV WEBAPP (2026-11-06, for alpha.6: item 11 extended under
 *    the owner's alpha.5 instruction, confirmed by the owner on 2026-11-07).
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
 *    `a-binary-the-stack-never-runs`. Since 2026-11-08 (for alpha.7, on the
 *    owner's answer that day, "Build the recommended for alpha 7.") the list
 *    is thirteen: libsystemd0 and libudev1, one high each, which only apt,
 *    libapt-pkg6.0, util-linux and bsdutils depended on there. And before the
 *    scan for a name, a check that no file of the eight libraries is left by
 *    its name and that no ELF file needs one: its DT_NEEDED entries, read
 *    from its program headers and dynamic section (the RUN's `needs`).
 * 5. TRIGGER.DEV'S REDIS (2026-11-07, for alpha.6: item 11 extended to it by
 *    the owner, "Redis purge in 6"). `deploy/compose/redis/Dockerfile` builds
 *    on Redis's official `redis:7.4.12-bookworm`, Debian 12.15 as the webapp's
 *    runner stage is, where Security Scan run 42330688192 read 24 of its 34
 *    highs in the eight util-linux packages. Its one RUN as root purges the
 *    webapp's eleven (REDIS_PURGE, the same names, each with its reason here;
 *    thirteen since 2026-11-08, as the webapp's) in the same shape, and checks
 *    and scans with perl-base, which the image keeps, since it has no node. That purge takes util-linux's setpriv, which upstream's
 *    entrypoint uses to drop from root to redis, so the image runs as
 *    `USER 999:999` from its first process, and a last RUN as that user starts
 *    redis-server through the entrypoint and asks it for the FROM's release.
 *    Held here: the Dockerfile's shape (a FROM by tag and digest, the RUN, the
 *    USER and the RUN, nothing the name does not cover), the purge, the
 *    header's reasons; managed.yml running it as `localhost/redis:<builtTag>`,
 *    built and never pulled, with no capability and no user of its own, and
 *    the `sed` that moves a name the Dockerfile moved past; images.yml's `build
 *    (redis, amd64|arm64)`, which builds it, starts upstream's image on a new
 *    volume as managed.yml ran it before, then the build on that volume as
 *    managed.yml runs it now, and asks it for uid 999, PONG and the key, run
 *    here against a stub docker that answers each check wrongly in turn; and
 *    Dependabot's entry for the directory, never a major.
 *
 * Until 2026-11-06 the tasks' half stood here too: the layer's purge where
 * there was no C++ compiler, on a `-slim` base, last of the layer; the weekly
 * scan's stage, the CLI's apt repair after the purge included; and the
 * managed smoke's dpkg query of the image the last deploy built.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCounter, parse as parseYaml, parseDocument } from 'yaml';
import { builtTag, dockerfileBase, parseRef, readImages } from './idp-pin-watch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** The ten, as the owner's decision of 2026-11-03 took them, in the order both files wrote them. */
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

/** A package name, as dpkg spells one. */
const NAMES = '[a-z0-9][a-z0-9.+-]+(?: [a-z0-9][a-z0-9.+-]+)*';
/** The purge, whole: the names checked, the force flags, the names purged, then apt's check. */
const PURGE = new RegExp(`^dpkg-query -W (${NAMES}) >/dev/null && dpkg --purge ((?:--force-[a-z-]+ )+)(${NAMES}) && apt-get check$`);

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

type Instruction = { op: string; args: string };
type Stage = { name: string; base: string; body: Instruction[] };

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
      out.push({ name: as >= 0 ? words[as + 1]! : String(out.length), base: words[0]!, body: [] });
      continue;
    }
    out.at(-1)?.body.push({ op, args });
  }
  return out;
}

/** The distroless Node image, at its `nonroot` tag by digest (apps/api/Dockerfile's runtime). */
const DISTROLESS = /^gcr\.io\/distroless\/nodejs\d+-debian\d+:nonroot@sha256:[0-9a-f]{64}$/;

describe('the appliance purges nothing: its runtime is distroless, with no dpkg and none of the ten', () => {
  const stages = stagesOf(read(APPLIANCE));
  const runtime = stages.at(-1)!;

  it("its runtime stage is distroless, and no stage of it purges (an-appliance-with-nothing-to-exec holds the rest)", () => {
    // Until 2026-11-06 the runtime stage ran on the Node image and purged the
    // ten in one RUN, in the shape below, as the tasks' layer did until the
    // same day. On distroless there is nothing to purge and no dpkg to do it with.
    expect(runtime.name).toBe('runtime');
    expect(runtime.base, `${APPLIANCE}: the runtime stage builds FROM ${runtime.base}`).toMatch(DISTROLESS);
    for (const stage of stages) {
      for (const i of stage.body.filter((x) => x.op === 'RUN')) expect(i.args, `${stage.name}: RUN ${i.args}`).not.toMatch(/\bdpkg --purge\b/);
    }
  });
});

describe('the purge has one shape', () => {
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
  // Since 2026-11-08, for alpha.7: the owner's answer that day, "Build the recommended for alpha 7.", with these two recommended.
  { name: 'libsystemd0', why: 'one high with no fix; only apt, libapt-pkg6.0, util-linux and bsdutils depend on it in this base, all four above; no ELF file left needs or names libsystemd.so.0 (node, goose, the prisma engines and the native addons need none), and it has no program' },
  { name: 'libudev1', why: 'one high with no fix; only libapt-pkg6.0 and util-linux depend on it in this base, both above; no ELF file left needs or names libudev.so.1, and it has no program' },
];

/** The libraries those ship: none may be left by its name, and no ELF file of the image may need or name one, once they are gone. */
const WEBAPP_LIBRARIES = ['libuuid.so.1', 'libblkid.so.1', 'libmount.so.1', 'libsmartcols.so.1', 'libapt-pkg.so.6.0', 'libapt-private.so.0.0', 'libsystemd.so.0', 'libudev.so.1'];

/** The eleven before 2026-11-08, as a message lists them: the list without libsystemd0 and libudev1. */
const ELEVEN = '"util-linux","util-linux-extra","mount","bsdutils","libblkid1","libmount1","libsmartcols1","libuuid1","apt","libapt-pkg6.0","e2fsprogs"';

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
  ['The last RUN as root purges the first ten, and e2fsprogs 1.47.0-2+b2, which carries no finding of its own and pre-depends on libblkid1 and libuuid1: dpkg refused to purge those two while it stayed', 'why e2fsprogs is on the list'],
  ['one high with no fix in Debian in each of libsystemd0 and libudev1 252.39-1~deb12u2, systemd\'s two libraries (since 2026-11-08)', "systemd's findings"],
  ['only apt, libapt-pkg6.0, util-linux and bsdutils depend on them in this base, all four on the list, so the thirteen go together and dpkg needs no other force', 'why libsystemd0 and libudev1 may go, and with no other force'],
  ['has 88 packages installed, no other installed package that depends on one of the thirteen, and none that depends on e2fsprogs', 'that nothing else depends on the thirteen'],
  ['libsystemd0 and libudev1 are Priority optional, neither Essential nor protected, and run no maintainer script', 'that the two need no other flag'],
  ["The runner stage's own layer (openssl, netcat-openbsd, ca-certificates and their libraries, and `apt-get upgrade`) could not be read here", 'what was not read, and what reads it'],
  ['The entrypoint (docker/scripts/entrypoint.sh, pinned by entrypoint_sha256) is /bin/sh, dash, and runs pnpm', 'what the entrypoint runs'],
  ['scripts/wait-for-it.sh only with DATABASE_HOST, which managed.yml does not set', 'why wait-for-it.sh does not run'],
  ['the dashboard agent\'s repo tools run tar (with gzip, -z) and rg', 'what the server spawns'],
  ['the SDK\'s bash skill (agentSkillsRuntime.ts), which the webapp never calls', 'the one other spawner the webapp loads'],
  ['Nothing execs apt, apt-get, su, mount, getopt, logger, more, mke2fs, e2fsck or any other program of the thirteen into the container', 'what nothing execs'],
  ['libsystemd0 and libudev1 have no program: they are libraries alone', 'that the two run nothing'],
  ["only util-linux's findmnt, lsblk and lslogins, bsdutils' logger, apt's http method and libapt-pkg.so.6.0.0 need either, all six purged with their packages, and no other ELF file but the two libraries themselves names either", 'what links libsystemd.so.0 and libudev.so.1'],
  ['none needs or names either', 'that the published files need neither'],
  ["node 24.22.1 (nodejs.org's linux-arm64 and linux-x64 builds, which the Node image unpacks) needs libdl, libstdc++, libm, libgcc_s, libpthread and libc", "node's libraries"],
  ["goose v3.29.0's two release assets are static", "goose's"],
  ["prisma 6.14.0's engines (commit 717184b7", "prisma's engines"],
  ["sentry-cli 2.50.2 (static), bufferutil 4.0.9's linux-x64 prebuild (glibc alone) and rollup 4.60.1's linux-x64-gnu addon (libgcc_s and glibc)", 'the native addons'],
  ['No byte of any of those files names one of the six', 'that none names a purged library'],
  ['No file of the eight is left under / (the image\'s own file system, walked whole) by its name, the library or a link to it, wherever it is. And no ELF file needs one: its DT_NEEDED entries', 'the check of what is left and what needs one'],
  ['An ELF file whose dynamic section cannot be read counts as needing a library when it names it', 'why an ELF file it cannot parse is no hole'],
  ['Without --force-depends, dpkg refuses to remove what an installed package still depends on, so a base where one does stops the build', 'why no other force'],
  ['So `dpkg --audit` takes its place, and its output is read, not its exit status', 'why dpkg --audit, and read by its output'],
  ['The half of apt-get check a purge could break, a dependency left unmet, is dpkg\'s own refusal in 3', "what of apt-get check's work stays"],
  ["images.yml's `build (trigger, amd64|arm64)` runs this RUN on the real image, where a wrong reading stops the build", 'where the reading is proved'],
];

/** `text` with `from` swapped for `to` inside the purge RUN's `<name>=` program only, whichever quote it is in. */
function within(text: string, name: 'elves' | 'needs', from: string, to: string): string {
  return text.replace(new RegExp(`^( {4}${name}=)(['"])(.*)\\2; \\\\$`, 'm'), (_line, head: string, quote: string, body: string) => `${head}${quote}${body.replace(from, to)}${quote}; \\`);
}

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

/** A command that installs a package, with apt or dpkg: none may follow the purge. */
const INSTALLS = /\b(?:apt-get|apt|aptitude)\s+(?:-\S+\s+)*(?:install|reinstall|upgrade|dist-upgrade|full-upgrade)\b|\bdpkg\s+(?:-\S+\s+)*(?:-i|--install|--unpack)\b/;

/** A purge's two lists, and the names this file gives them in its messages. */
interface PurgeLists {
  readonly names: readonly string[];
  readonly namesLabel: string;
  readonly libraries: readonly string[];
  readonly librariesLabel: string;
}

const WEBAPP_LISTS: PurgeLists = {
  names: WEBAPP_PURGE.map((p) => p.name),
  namesLabel: 'WEBAPP_PURGE',
  libraries: WEBAPP_LIBRARIES,
  librariesLabel: 'WEBAPP_LIBRARIES',
};

/**
 * Where the purge stands among a Dockerfile's RUNs, in words: as root, the
 * last RUN as root, followed by the image's own USER, and no install after it.
 */
function placeProblems(run: Run, runs: Run[], body: Instruction[], user: string, userWhat: string): string[] {
  const problems: string[] = [];
  if (run.user !== 'root') problems.push(`the purge runs as ${run.user}, not root, who owns dpkg's database`);
  const lastRoot = runs.filter((r) => r.user === 'root').at(-1);
  if (lastRoot !== run) problems.push('the purge is not the last RUN as root: every other change comes before it, and nothing after it may need what it purged');
  if (body[run.at + 1]?.op !== 'USER' || body[run.at + 1]?.args.trim() !== user) problems.push(`the purge is not followed by ${userWhat}`);
  for (const later of runs.filter((r) => r.at > run.at)) {
    if (INSTALLS.test(later.args)) problems.push(`a RUN after the purge installs a package: ${later.args.slice(0, 80)}`);
  }
  return problems;
}

/**
 * The checks every purge of this shape answers to, in words, whatever image
 * it is in: its two lists; `dpkg-query -W` of the list, first; `dpkg --purge`
 * with the two flags and no other; no apt as a command; `dpkg --audit` read
 * empty before and after; the libraries shipped before; each package gone
 * after. Where the purge is, for the checks that come after it.
 */
function purgeShapeProblems(args: string, lists: PurgeLists): { problems: string[]; purgeAt: number } {
  const problems: string[] = [];
  const value = (name: string) => new RegExp(`(?:^|[;\\s])${name}="([^"]*)";`).exec(args)?.[1]?.split(' ');
  const same = (a: readonly string[] | undefined, b: readonly string[]) => a !== undefined && a.length === b.length && a.every((x, n) => x === b[n]);
  if (!same(value('purge'), lists.names)) problems.push(`its purge= is ${JSON.stringify(value('purge'))}, not the thirteen ${lists.namesLabel} names, in order`);
  if (!same(value('libraries'), lists.libraries)) problems.push(`its libraries= is ${JSON.stringify(value('libraries'))}, not ${lists.librariesLabel}`);
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
  if (shipped < 0 || shipped > purgeAt) problems.push('no check, before the purge, that the thirteen ship every library of $libraries');
  const gone = at(/(?:^|[;\s])for p in \$purge; do st="\$\(dpkg-query -W -f '\$\{db:Status-Status\}' "\$p" 2>\/dev\/null\)" && rc=0 \|\| rc=\$\?; case "\$rc:\$st" in 1:\|0:not-installed\) ;; \*\) fail /);
  if (gone < 0 || gone < purgeAt) problems.push('no check, after the purge, that dpkg reads each of the thirteen as gone');
  return { problems, purgeAt };
}

/**
 * The check after the purge, before the scan for a name, in words, whatever
 * its language: that it runs after the purge and before the scan, as
 * `left="$(<interpreter> -e "$needs" "$top" $libraries)"`, its exit read; and
 * that the program in `needs=` does what the header says, by `needles`: every
 * entry's name read, a link's as well, before only files are opened; DT_NEEDED
 * and DT_STRTAB read from the dynamic section the program headers name, the
 * string table found through a PT_LOAD; an ELF file it cannot parse counted
 * as needing a library it names; a hit fails it, and so does a walk that met
 * no ELF file needing any library.
 */
function needsProblems(args: string, interpreter: 'node' | 'perl', purgeAt: number, scanAt: number, needles: ReadonlyArray<readonly [readonly string[], string]>): string[] {
  const problems: string[] = [];
  const at = args.search(new RegExp(`(?:^|[;\\s])left="\\$\\(${interpreter} -e "\\$needs" "\\$top" \\$libraries\\)" && st=0 \\|\\| st=\\$\\?; \\[ "\\$st" = 0 \\] \\|\\| fail `));
  if (at < 0 || at < purgeAt) problems.push('no check, after the purge, that no file of $libraries is left and that no ELF file needs one');
  else if (scanAt >= 0 && at > scanAt) problems.push('the check of what needs a library comes after the scan for what names one, which stops the build first, so no DT_NEEDED would ever be read');
  const quote = interpreter === 'node' ? '"' : "'";
  const program = new RegExp(`(?:^|[;\\s])needs=${quote}([^${quote}]*)${quote};`).exec(args)?.[1] ?? '';
  for (const [parts, what] of needles) {
    if (!parts.every((n) => program.includes(n))) problems.push(`the check of what is left no longer ${what}`);
  }
  return problems;
}

/** What the node check must still do (the webapp's). */
const NODE_NEEDS: ReadonlyArray<readonly [readonly string[], string]> = [
  [['if (s.isDirectory()) { if (s.dev === dev) walk(p); continue; }'], "walks every directory of the image's own file system, and no other"],
  [["for (const n of names) if (e === n || e.startsWith(n + '.')) hits.push(p + ': a file of ' + n + ' is left'); if (!s.isFile() || s.size < 4) continue;"], 'reads every name, a link\'s too, before it opens only files'],
  [['if (t === 1) load.push(f); if (t === 2) dynamic = f;'], 'reads the program headers'],
  [['if (t === 0) break; if (t === 1) need.push(v); if (t === 5) str = v;'], 'reads DT_NEEDED and DT_STRTAB'],
  [['load.find((s) => str >= s[1] && str < s[1] + s[2])', 'const at = str - seg[1] + seg[0];'], 'finds the string table where a PT_LOAD maps it'],
  [["catch { unread++; for (const n of names) if (b.includes(n)) hits.push(p + ': names ' + n + ', and its dynamic section cannot be read');"], 'counts an ELF file it cannot parse as needing a library it names'],
  [["for (const n of names) if (need.includes(n)) hits.push(p + ': needs ' + n);"], 'fails on an ELF file that needs one'],
  [['if (dyn === 0) process.exit(2);'], 'fails when it met no ELF file that needs a library'],
  [['if (hits.length) {'], 'fails on what it found'],
];

/** What the perl check must still do (Redis's). */
const PERL_NEEDS: ReadonlyArray<readonly [readonly string[], string]> = [
  [['if (-d _) { walk($p) if $s[0] == $dev; next; }'], "walks every directory of the image's own file system, and no other"],
  [['my @s = lstat $p or die'], 'reads each entry as it is, a link as a link'],
  [['for my $n (@names) { push @hits, "$p: a file of $n is left" if $e eq $n || index($e, "$n.") == 0; } next if !-f _ || $s[7] < 4;'], 'reads every name, a link\'s too, before it opens only files'],
  [['push @load, \\@f if $t == 1; @dyn = @f if $t == 2;'], 'reads the program headers'],
  [['last if $t == 0; push @need, $v if $t == 1; $str = $v if $t == 5;'], 'reads DT_NEEDED and DT_STRTAB'],
  [['grep { $str >= $_->[1] && $str < $_->[1] + $_->[2] } @load'], 'finds the string table where a PT_LOAD maps it'],
  [['if (!$need) { $unread++; for my $n (@names) { push @hits, "$p: names $n, and its dynamic section cannot be read" if index($b, $n) >= 0; } next; }'], 'counts an ELF file it cannot parse as needing a library it names'],
  [['push @hits, "$p: needs $n" if grep { $_ eq $n } @$need;'], 'fails on an ELF file that needs one'],
  [['exit 2 if $dyn == 0;'], 'fails when it met no ELF file that needs a library'],
  [['if (@hits) {'], 'fails on what it found'],
];

/** The webapp's purge, what is wrong with it, in words; empty when it holds. */
function webappProblems(text: string): string[] {
  const { runs, body } = runsOf(text);
  const purges = runs.filter((r) => /(^|[;\s])dpkg --purge\b/.test(r.args));
  if (purges.length !== 1) return [`${purges.length} RUNs run dpkg --purge, not one`];
  const run = purges[0]!;
  const args = run.args.replace(/\s+/g, ' ');
  const problems = placeProblems(run, runs, body, 'node', "upstream's USER node");
  const shape = purgeShapeProblems(args, WEBAPP_LISTS);
  problems.push(...shape.problems);
  const at = (re: RegExp) => args.search(re);
  const scan = at(/(?:^|[;\s])found="\$\(node -e "\$elves" "\$top" \$libraries\)" && st=0 \|\| st=\$\?; \[ "\$st" = 0 \] \|\| fail /);
  if (scan < 0 || scan < shape.purgeAt) problems.push('no scan, after the purge, for an ELF file that names one of $libraries');
  if (!/(?:^|[;\s])top=\/;/.test(args)) problems.push('the scan does not start at /, the image whole');
  problems.push(...needsProblems(args, 'node', shape.purgeAt, scan, NODE_NEEDS));
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

describe("the Trigger.dev webapp's image purges the thirteen of Debian 12 nothing there runs, last of its root RUNs (2026-11-06; thirteen since 2026-11-08)", () => {
  const webapp = read(WEBAPP);
  const reasons = sectionOf(webapp, 'THE DEBIAN PACKAGES NOTHING RUNS (since', 'TWO NAMES FOR EACH BINARY.');
  const how = sectionOf(webapp, 'HOW THEY ARE PURGED, AND PROVED.', 'TWO NAMES FOR EACH BINARY.');

  it('one RUN, the last as root, before USER node, purges WEBAPP_PURGE in the shape that fails loudly', () => {
    expect(webappProblems(webapp)).toEqual([]);
  });

  it('WEBAPP_PURGE says why each may go, and the header names each package and each library', () => {
    expect(WEBAPP_PURGE.map((p) => p.name)).toHaveLength(13);
    for (const p of WEBAPP_PURGE) {
      expect(p.why.length, `${p.name}: why`).toBeGreaterThan(40);
      expect(reasons, `the header's section names no ${p.name}`).toMatch(new RegExp(`(^|[\\s(,])${p.name.replace(/[.+]/g, '\\$&')}([\\s),.:;]|$)`));
    }
    for (const so of WEBAPP_LIBRARIES) expect(reasons, `the header's section names no ${so}`).toContain(so);
  });

  it("the header carries every reason, word for word, and says how it is proved", () => {
    expect(reasons.length, 'no section THE DEBIAN PACKAGES NOTHING RUNS').toBeGreaterThan(1000);
    for (const [needle, what] of WEBAPP_REASONS) expect(reasons, what).toContain(needle);
    expect(how, 'no section HOW THEY ARE PURGED, AND PROVED').toContain('`dpkg-query -W` of exactly the thirteen, first');
    expect(how).toContain('--force-remove-essential --force-remove-protected`, the two flags of the owner\'s decision, and no other force');
  });

  it('refuses each way the purge could slip', () => {
    const swap = (from: string | RegExp, to: string) => {
      const next = webapp.replace(from, to);
      expect(next, `${String(from)} is not in ${WEBAPP}`).not.toBe(webapp);
      return webappProblems(next);
    };
    // Inside one program of the RUN: the scan (`elves`) and the check (`needs`) walk alike.
    const swapIn = (name: 'elves' | 'needs', from: string, to: string) => {
      const next = within(webapp, name, from, to);
      expect(next, `${from} is not in ${WEBAPP}'s ${name}`).not.toBe(webapp);
      return webappProblems(next);
    };
    expect(swap('--force-remove-protected $purge', '--force-remove-protected --force-depends $purge')).toEqual([
      'its force flags are --force-remove-essential --force-remove-protected --force-depends, not --force-remove-essential --force-remove-protected alone',
      'it names 3 --force flags (--force-remove-essential --force-remove-protected --force-depends), not the purge\'s two',
    ]);
    expect(swap('--force-remove-essential --force-remove-protected $purge', '--force-all $purge')).toContain('its force flags are --force-all, not --force-remove-essential --force-remove-protected alone');
    expect(swap(' libuuid1 apt', ' apt')).toEqual(['its purge= is ["util-linux","util-linux-extra","mount","bsdutils","libblkid1","libmount1","libsmartcols1","apt","libapt-pkg6.0","e2fsprogs","libsystemd0","libudev1"], not the thirteen WEBAPP_PURGE names, in order']);
    // e2fsprogs off the list: on this base dpkg refuses libblkid1 and libuuid1 for it, so the list is the decision, not a name to drop.
    expect(swap(' libapt-pkg6.0 e2fsprogs libsystemd0 ', ' libapt-pkg6.0 libsystemd0 ')).toEqual(['its purge= is ["util-linux","util-linux-extra","mount","bsdutils","libblkid1","libmount1","libsmartcols1","libuuid1","apt","libapt-pkg6.0","libsystemd0","libudev1"], not the thirteen WEBAPP_PURGE names, in order']);
    // libsystemd0 and libudev1 off it: the list as it was before 2026-11-08, which the owner's answer of that day moved.
    expect(swap(' e2fsprogs libsystemd0 libudev1"', ' e2fsprogs"')).toEqual([`its purge= is [${ELEVEN}], not the thirteen WEBAPP_PURGE names, in order`]);
    expect(swap('purge="util-linux util-linux-extra', 'purge="util-linux-extra util-linux')).toHaveLength(1);
    expect(swap(' libapt-private.so.0.0 libsystemd.so.0', ' libsystemd.so.0')).toEqual(['its libraries= is ["libuuid.so.1","libblkid.so.1","libmount.so.1","libsmartcols.so.1","libapt-pkg.so.6.0","libsystemd.so.0","libudev.so.1"], not WEBAPP_LIBRARIES']);
    expect(swap(' libsystemd.so.0 libudev.so.1"', '"')).toEqual(['its libraries= is ["libuuid.so.1","libblkid.so.1","libmount.so.1","libsmartcols.so.1","libapt-pkg.so.6.0","libapt-private.so.0.0"], not WEBAPP_LIBRARIES']);
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
    expect(swap(/^ {4}listed="[^\n]*\n {4}for l in \$libraries[^\n]*\n/m, '')).toEqual(['no check, before the purge, that the thirteen ship every library of $libraries']);
    expect(swap(/^ {4}for p in \$purge; do [^\n]*\n/m, '')).toEqual(['no check, after the purge, that dpkg reads each of the thirteen as gone']);
    expect(swap(/^ {4}found="\$\(node -e "\$elves"[^\n]*\n {4}\[ "\$st" = 0 \][^\n]*\n/m, '')).toEqual(['no scan, after the purge, for an ELF file that names one of $libraries']);
    // The check of what is left and what needs a library: gone, after the scan that stops first, or doing less.
    const needsRun = /^ {4}left="\$\(node -e "\$needs"[^\n]*\n {4}\[ "\$st" = 0 \][^\n]*\n/m;
    expect(swap(needsRun, '')).toEqual(['no check, after the purge, that no file of $libraries is left and that no ELF file needs one']);
    const needsLines = needsRun.exec(webapp)![0];
    const afterScan = webapp.replace(needsLines, '').replace(/^( {4}found="\$\(node -e "\$elves"[^\n]*\n {4}\[ "\$st" = 0 \][^\n]*\n)/m, `$1${needsLines}`);
    expect(webappProblems(afterScan)).toEqual(['the check of what needs a library comes after the scan for what names one, which stops the build first, so no DT_NEEDED would ever be read']);
    expect(swap('if (t === 0) break; if (t === 1) need.push(v); ', 'if (t === 0) break; ')).toEqual(['the check of what is left no longer reads DT_NEEDED and DT_STRTAB']);
    expect(swap('const at = str - seg[1] + seg[0];', 'const at = str;')).toEqual(['the check of what is left no longer finds the string table where a PT_LOAD maps it']);
    expect(swap("hits.push(p + ': a file of ' + n + ' is left'); if (!s.isFile() || s.size < 4) continue;", "hits.push(p + ': a file of ' + n + ' is left');")).toEqual([
      "the check of what is left no longer reads every name, a link's too, before it opens only files",
    ]);
    expect(swap("catch { unread++; for (const n of names) if (b.includes(n)) hits.push(p + ': names ' + n + ', and its dynamic section cannot be read'); continue; }", 'catch { unread++; continue; }')).toEqual([
      'the check of what is left no longer counts an ELF file it cannot parse as needing a library it names',
    ]);
    expect(swap('if (dyn === 0) process.exit(2); ', '')).toEqual(['the check of what is left no longer fails when it met no ELF file that needs a library']);
    expect(swap("for (const n of names) if (need.includes(n)) hits.push(p + ': needs ' + n);", '')).toEqual(['the check of what is left no longer fails on an ELF file that needs one']);
    expect(swapIn('elves', 'if (s.dev === dev) walk(p);', 'walk(p);')).toEqual(["the scan no longer walks every directory of the image's own file system, and no other"]);
    expect(swapIn('needs', 'if (s.dev === dev) walk(p);', 'walk(p);')).toEqual(["the check of what is left no longer walks every directory of the image's own file system, and no other"]);
    // A device check on files as well would pass over a file whose layer gives it another st_dev.
    expect(swapIn('elves', 'if (s.isDirectory()) { if (s.dev === dev) walk(p); continue; }', 'if (s.dev !== dev) continue; if (s.isDirectory()) { walk(p); continue; }')).toEqual([
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


// ------------------------------------------------------ Trigger.dev's Redis ----

const REDIS = 'deploy/compose/redis/Dockerfile';
const REDIS_CONTEXT = 'deploy/compose/redis';
const REDIS_NAME = 'localhost/redis';
const REDIS_SERVICE = 'trigger-redis';
const MANAGED = 'deploy/compose/managed.yml';
const IMAGES_WORKFLOW = '.github/workflows/images.yml';

/**
 * The eleven Redis's image purges (2026-11-07, for alpha.6: "Redis purge in
 * 6"), in the order its RUN writes them, each with why it may go there. They
 * are the webapp's eleven, read again against this image: Debian 12.15, as
 * upstream's runner stage is, and Security Scan run 42330688192 (Trivy 0.76.1,
 * linux/arm64) read the findings named.
 */
const REDIS_PURGE: ReadonlyArray<{ readonly name: string; readonly why: string }> = [
  { name: 'util-linux', why: 'Essential; 3 highs with no fix; nothing here runs its programs (su, setpriv, getopt, more), and upstream\'s entrypoint, run as 999, never reaches its setpriv' },
  { name: 'util-linux-extra', why: '3 highs with no fix; util-linux hard-depends on it in Debian 12, so it goes with it; nothing runs hwclock or lsfd' },
  { name: 'mount', why: '3 highs with no fix; nothing mounts anything in a container that runs redis-server; it depends on util-linux' },
  { name: 'bsdutils', why: 'Essential; 3 highs with no fix; nothing runs logger, script, wall or renice' },
  { name: 'libblkid1', why: '3 highs with no fix; linked by the util-linux programs above and by e2fsprogs, and nothing else here (Redis needs libm, libssl, libcrypto and libc)' },
  { name: 'libmount1', why: '3 highs with no fix; linked by mount and util-linux, and nothing else here' },
  { name: 'libsmartcols1', why: '3 highs with no fix; linked by util-linux and util-linux-extra, and nothing else here' },
  { name: 'libuuid1', why: '3 highs with no fix; Redis makes its own run ids from the kernel\'s random bytes, and nothing here links libuuid' },
  { name: 'apt', why: 'no finding at 2.6.2, the release that fixed CVE-2026-109518; nothing in trigger-redis runs apt, and nothing installs in it: a change is a rebuild' },
  { name: 'libapt-pkg6.0', why: 'no finding at 2.6.2, as apt; apt is its one user here, so it goes with it' },
  { name: 'e2fsprogs', why: 'no finding of its own; it pre-depends on libblkid1 and libuuid1, so dpkg refuses those two while it stays; nothing makes or checks a file system here, and nothing depends on it' },
  // Since 2026-11-08, for alpha.7, as the webapp's.
  { name: 'libsystemd0', why: 'one high with no fix; only apt, libapt-pkg6.0, util-linux and bsdutils depend on it here, all four above; Redis is built without it and needs libm, libssl, libcrypto and libc, and no ELF file left needs or names libsystemd.so.0' },
  { name: 'libudev1', why: 'one high with no fix; only libapt-pkg6.0 and util-linux depend on it here, both above; no ELF file left needs or names libudev.so.1, and it has no program' },
];

const REDIS_LISTS: PurgeLists = {
  names: REDIS_PURGE.map((p) => p.name),
  namesLabel: 'REDIS_PURGE',
  libraries: WEBAPP_LIBRARIES,
  librariesLabel: 'WEBAPP_LIBRARIES',
};

/**
 * What the header says, word for word once its comment lines are joined, from
 * WHY to the end of HOW THEY ARE PURGED: the measurement, the list and each
 * reason, why nothing runs or loads the eleven, how dpkg's refusal is kept,
 * why the scan is perl's, and where the reading is proved.
 */
const REDIS_REASONS: ReadonlyArray<readonly [string, string]> = [
  ['Security Scan run 42330688192 (Trivy 0.76.1, linux/arm64, 2026-11-07) read it at 1 critical, 34 high and 0 with a fix', 'the scan it was read against'],
  ['the eight packages built from util-linux\'s source: util-linux, util-linux-extra, mount, bsdutils, libblkid1, libmount1, libsmartcols1 and libuuid1, three highs with no fix in Debian in each (24)', "util-linux's findings"],
  ['apt 2.6.2 and libapt-pkg6.0 2.6.2, which carry no finding here', 'why apt goes without a finding'],
  ['e2fsprogs 1.47.0-2+b2, which carries no finding of its own and pre-depends on libblkid1 and libuuid1, so dpkg refuses to purge those two while it stays', 'why e2fsprogs is on the list'],
  ['So 1, 34 and 0 became 1, 10 and 0 with the first eleven', 'what the first eleven left'],
  ["libsystemd0 and libudev1 252.39-1~deb12u2, systemd's two libraries, one high each with no fix in Debian, which only apt, libapt-pkg6.0, util-linux and bsdutils depend on here, all four on this list", 'why libsystemd0 and libudev1 may go'],
  ['the two take it to 1, 8 and 0', 'what the thirteen leave'],
  ['libsystemd0 and libudev1 are Priority optional, neither Essential nor protected, and run no maintainer script', 'that the two need no other flag'],
  ['util-linux-extra goes with util-linux, which hard-depends on it in Debian 12', 'why util-linux-extra is on the list'],
  ['libapt-pkg6.0 with apt, its one user here', 'why libapt-pkg6.0 is on the list'],
  ['has 89 packages installed, and no other installed package depends on one of the thirteen, and none on e2fsprogs', 'that nothing else depends on the thirteen'],
  ['As uid 999 (THE USER, below) the entrypoint is /bin/sh, dash, and runs `id -u` and redis-server, and nothing else', 'what the entrypoint runs'],
  ['Redis forks itself to save and rewrite its files, and execs nothing', 'what Redis spawns'],
  ['Nothing execs apt, apt-get, su, mount, setpriv, getopt, logger, more, mke2fs, e2fsck or any other program of the thirteen into the container', 'what nothing execs'],
  ["Redis's three binaries need libm, libssl, libcrypto and libc (`readelf -d`)", "Redis's libraries"],
  ['No ELF file of the layer they are in names one of the first six', 'that none names a purged library'],
  ["only util-linux's findmnt, lsblk and lslogins, bsdutils' logger, apt's http method and libapt-pkg.so.6.0.0 need libsystemd.so.0 or libudev.so.1, all six purged with their packages, and no other ELF file but the two libraries themselves names either", 'what links libsystemd.so.0 and libudev.so.1'],
  ['redis-server names libsystemd only in a message, that it was built without it', "that Redis's mention is no use"],
  ["No file of the eight is left under / (the image's own file system, walked whole) by its name, the library or a link to it, wherever it is. And no ELF file needs one: its DT_NEEDED entries", 'the check of what is left and what needs one'],
  ['Without --force-depends, dpkg refuses to remove what an installed package still depends on, so a base where one does stops the build', 'why no other force'],
  ["The checks are perl's, perl-base's, which Debian marks Essential and this image keeps", 'why the checks are perl'],
  ['So `dpkg --audit` takes its place, and its output is read, not its exit status', 'why dpkg --audit, and read by its output'],
  ["The half of apt-get check a purge could break, a dependency left unmet, is dpkg's own refusal in 3", "what of apt-get check's work stays"],
  ["images.yml's `build (redis, amd64|arm64)` runs this RUN on the real image on both platforms, where a wrong reading stops the build", 'where the reading is proved'],
];

/** Redis's purge, what is wrong with it, in words; empty when it holds. */
function redisProblems(text: string): string[] {
  const { runs, body } = runsOf(text);
  const purges = runs.filter((r) => /(^|[;\s])dpkg --purge\b/.test(r.args));
  if (purges.length !== 1) return [`${purges.length} RUNs run dpkg --purge, not one`];
  const run = purges[0]!;
  const args = run.args.replace(/\s+/g, ' ');
  const problems = placeProblems(run, runs, body, '999:999', "USER 999:999, Redis's own user and group");
  const shape = purgeShapeProblems(args, REDIS_LISTS);
  problems.push(...shape.problems);
  const scan = args.search(/(?:^|[;\s])found="\$\(perl -e "\$elves" "\$top" \$libraries\)" && st=0 \|\| st=\$\?; \[ "\$st" = 0 \] \|\| fail /);
  if (scan < 0 || scan < shape.purgeAt) problems.push('no scan, after the purge, for an ELF file that names one of $libraries');
  if (!/(?:^|[;\s])top=\/;/.test(args)) problems.push('the scan does not start at /, the image whole');
  problems.push(...needsProblems(args, 'perl', shape.purgeAt, scan, PERL_NEEDS));
  const elves = /(?:^|[;\s])elves='([^']*)';/.exec(args)?.[1] ?? '';
  for (const [needles, what] of [
    // Directories only: on overlayfs a file's st_dev can be its layer's, and a file skipped is a file not read.
    [['if (-d _) { walk($p) if $s[0] == $dev; next; }'], "walks every directory of the image's own file system, and no other"],
    [['my @s = lstat $p or die'], 'reads each entry as it is, a link as a link'],
    [['if ($m ne "\\x7fELF") { close $f; next; }'], "reads ELF's magic"],
    [['my $b = do { local $/; <$f> };', 'for my $n (@names) { push @hits, "$p: $n" if index($b, $n) >= 0; }'], 'reads each ELF whole for every name'],
    [['exit 2 if $read == 0;'], 'fails when it read no ELF at all'],
    [['if (@hits) {'], 'fails on a file that names one'],
  ] as const) {
    if (!needles.every((n) => elves.includes(n))) problems.push(`the scan no longer ${what}`);
  }
  if (!/(?:^|[;\s])sh -c : \|\| fail /.test(args)) problems.push('no proof, after the purge, that sh starts');
  for (const c of ['id', 'find', 'redis-server', 'redis-cli']) {
    if (!new RegExp(`for c in [^;]*(?<![\\w-])${c}(?![\\w-])[^;]*; do "\\$c" --version >/dev/null 2>&1 \\|\\| fail `).test(args)) problems.push(`no proof, after the purge, that ${c} starts`);
  }
  return problems;
}

/** The last RUN, as the image's user, what is wrong with it, given the release the FROM names; empty when it holds. */
function asUserProblems(text: string, release: string | null): string[] {
  const problems: string[] = [];
  const last = runsOf(text).runs.at(-1);
  if (!last || last.user !== '999:999') return ['the last RUN does not run as 999:999, so nothing proves the image starts as its own user'];
  const args = last.args.replace(/\s+/g, ' ');
  if (!/^set -eu;/.test(args)) problems.push('the last RUN does not start with `set -eu;`: a check that fails could be passed by');
  if (!args.includes('who="$(id -u):$(id -g)"; [ "$who" = 999:999 ] || {')) problems.push('the last RUN does not stop when it runs as another user than 999:999');
  if (!/(?:^|[;\s])said="\$\(docker-entrypoint\.sh redis-server --version\)" \|\| \{/.test(args)) problems.push("the last RUN does not start redis-server through upstream's entrypoint");
  const asked = /(?:^|[;\s])case "\$said" in "Redis server v=(\d+\.\d+\.\d+) "\*\) ;; \*\) echo /.exec(args)?.[1];
  if (!asked) problems.push('the last RUN does not ask redis-server for an exact release');
  else if (release !== null && asked !== release) problems.push(`the last RUN asks redis-server for ${asked}, and the FROM names ${release}: re-read the header, then move the release it asks for`);
  return problems;
}

/** The Dockerfile's instructions, each continued line joined to its first, comments and blank lines left out. */
function instructionsOf(text: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (!current && /^\s*(#|$)/.test(line)) continue;
    current += `${current ? '\n' : ''}${line}`;
    if (!/\\\s*$/.test(line)) {
      out.push(current);
      current = '';
    }
  }
  if (current) out.push(current);
  return out;
}

/** What is wrong with Redis's Dockerfile as a whole; empty when it holds. */
function redisDockerfileProblems(text: string): string[] {
  const problems: string[] = [];
  let base: ReturnType<typeof dockerfileBase> | null = null;
  try {
    base = dockerfileBase(text);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const release = base ? (/^(\d+\.\d+\.\d+)-bookworm$/.exec(base.tag)?.[1] ?? null) : null;
  if (base) {
    if (base.repo !== 'redis') problems.push(`it builds on ${base.repo}, not the official redis image`);
    if (release === null) problems.push(`its base is ${base.tag}, not an exact Redis release on Debian 12 (\`7.4.12-bookworm\`), the base the list was read on`);
  }
  for (const line of text.split('\n')) {
    if (!/^\s*#\s*[a-z][a-z0-9]*\s*=/i.test(line)) break;
    problems.push(`\`${line}\` is a parser directive: it changes the build, and the image's name skips it as a comment. Remove it`);
  }
  const instructions = instructionsOf(text);
  const kinds = instructions.map((i) => /^\s*(\S+)/.exec(i)?.[1]?.toUpperCase() ?? '');
  if (JSON.stringify(kinds) !== JSON.stringify(['FROM', 'RUN', 'USER', 'RUN'])) {
    problems.push(`its instructions are ${JSON.stringify(kinds)}, not FROM, RUN, USER and RUN: anything else reads files the name does not cover, or changes upstream's interface`);
  }
  for (const i of instructions) if (/--mount\b/i.test(i)) problems.push(`\`${i.split('\n')[0]}\` mounts something the name does not cover`);
  const users = instructions.filter((i) => /^USER\s/i.test(i)).map((i) => i.replace(/^USER\s+/i, '').trim());
  if (users.length !== 1 || users[0] !== '999:999') problems.push(`its USER lines are ${JSON.stringify(users)}, not one USER 999:999: upstream's entrypoint takes its root branch as root, and its setpriv is purged`);
  problems.push(...redisProblems(text), ...asUserProblems(text, release));
  return problems;
}

interface Service {
  image?: string;
  build?: string | { context?: string };
  pull_policy?: string;
  user?: string | number;
  command?: string | string[];
  cap_add?: string[];
  cap_drop?: string[];
  security_opt?: string[];
  healthcheck?: { test?: string | string[] };
  volumes?: string[];
}

const servicesOf = (text: string) => (parseYaml(text) as { services: Record<string, Service> }).services;
const escapeForSed = (s: string) => s.replace(/[.[\]\\*^$#]/g, '\\$&');

/** What is wrong with managed.yml's trigger-redis; empty when it holds. */
function redisComposeProblems(managed: string, dockerfile: string): string[] {
  const problems: string[] = [];
  const want = `${REDIS_NAME}:${builtTag(dockerfile)}`;
  const services = servicesOf(managed);
  const svc = services[REDIS_SERVICE];
  if (!svc) return [`${MANAGED} has no ${REDIS_SERVICE}`];
  for (const [name, other] of Object.entries(services)) {
    const repo = other.image ? parseRef(other.image).repo : '';
    if (repo === 'redis') problems.push(`${MANAGED}:${name} runs ${other.image}, upstream's image with the eleven: run ${want}, built from ./redis`);
    else if (repo === REDIS_NAME && name !== REDIS_SERVICE) problems.push(`${MANAGED}:${name} runs Redis's build too, which only ${REDIS_SERVICE} may`);
  }
  if (svc.image !== want) {
    if (svc.image && parseRef(svc.image).repo === REDIS_NAME) {
      const lineCounter = new LineCounter();
      const node = parseDocument(managed, { lineCounter }).getIn(['services', REDIS_SERVICE, 'image'], true) as { range?: [number, number, number] } | undefined;
      const line = node?.range ? lineCounter.linePos(node.range[0]).line : 0;
      problems.push(
        [
          `${REDIS}'s instructions changed, so the image it builds is named ${want} now, and ${MANAGED}:${line} (${REDIS_SERVICE}) still gives ${svc.image}.`,
          'Compose builds an image only where its name is missing, so under the old name every stack that has it keeps running the old build. Move the line, from the repository root:',
          `  sed -i -e 's#${escapeForSed(svc.image)}#${want}#' ${MANAGED}`,
          'Nothing else names it: the image scan, the pin watch and images.yml read managed.yml and the Dockerfile.',
          "The twelve hex digits are the SHA-256 of the Dockerfile's instruction lines, comments and blank lines left out:",
          `  grep -Ev '^[[:space:]]*(#|$)' ${REDIS} | sha256sum | cut -c1-12`,
        ].join('\n'),
      );
    } else {
      problems.push(`${REDIS_SERVICE} runs ${String(svc.image)}, not ${want}, built from ./redis`);
    }
  }
  if (svc.build !== './redis') problems.push(`${REDIS_SERVICE}'s build: is ${JSON.stringify(svc.build)}, not the bare \`./redis\`: args, a target or a Dockerfile of its own are inputs the name does not carry`);
  if (svc.pull_policy !== 'never') problems.push(`${REDIS_SERVICE} has pull_policy ${String(svc.pull_policy)}, not never: no registry serves ${want}`);
  if (svc.user !== undefined) problems.push(`${REDIS_SERVICE} sets user: ${String(svc.user)}; the image's own 999:999 is the user its build proves`);
  if ((svc.cap_add ?? []).length > 0) {
    problems.push(`${REDIS_SERVICE} adds ${svc.cap_add!.join(', ')}: as 999 from its first process Redis needs no capability, and the four it added were upstream's root branch's`);
  }
  if (JSON.stringify(svc.cap_drop) !== JSON.stringify(['ALL'])) problems.push(`${REDIS_SERVICE} drops ${JSON.stringify(svc.cap_drop)}, not ALL`);
  if (!(svc.security_opt ?? []).includes('no-new-privileges:true')) problems.push(`${REDIS_SERVICE} does not set no-new-privileges:true`);
  if (svc.command !== 'redis-server --appendonly yes') problems.push(`${REDIS_SERVICE}'s command is ${JSON.stringify(svc.command)}, not redis-server --appendonly yes, the append-only file redis_data carries`);
  if (!(svc.volumes ?? []).includes('redis_data:/data')) problems.push(`${REDIS_SERVICE} does not mount redis_data at /data, the volume upstream's image wrote`);
  if (JSON.stringify(svc.healthcheck?.test) !== JSON.stringify(['CMD', 'redis-cli', 'ping'])) {
    problems.push(`${REDIS_SERVICE}'s healthcheck is ${JSON.stringify(svc.healthcheck?.test)}, not redis-cli ping, a program the build proves starts`);
  }
  return problems;
}

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  if?: string;
  'runs-on'?: string;
  permissions?: Record<string, string>;
  strategy?: { 'fail-fast'?: boolean; matrix?: { include?: Array<Record<string, string>> } };
  steps: Step[];
}

const redisJob = (workflow: string) => (parseYaml(workflow) as { jobs: Record<string, Job> }).jobs['redis'];
/** The step that builds Redis and starts it on a volume upstream's image wrote. */
const redisStep = (workflow: string) => redisJob(workflow)?.steps.find((s) => s.run?.includes('docker build'));

/** A step's `docker run -d --name <name> …` command, its continued lines joined. */
function dockerRun(run: string, name: string): string | null {
  const joined = run.replace(/\\\n\s*/g, '');
  return new RegExp(`^\\s*(docker run -d --name ${name} .*)$`, 'm').exec(joined)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}

/** What is wrong with images.yml's build of Redis; empty when it holds. */
function redisWorkflowProblems(workflow: string, managed: string): string[] {
  const problems: string[] = [];
  const job = redisJob(workflow);
  if (!job) return ['images.yml has no redis job: nothing builds Redis before E2E (managed)'];
  if (job.name !== 'build (redis, ${{ matrix.arch }})') problems.push(`its name is ${String(job.name)}, not build (redis, \${{ matrix.arch }}), which every-pr-check-is-classified names`);
  if (job.if !== "github.event_name == 'pull_request'") problems.push(`it runs ${String(job.if)}, not on a pull request only`);
  if (JSON.stringify(job.permissions) !== JSON.stringify({ contents: 'read' })) problems.push(`its permissions are ${JSON.stringify(job.permissions)}, not contents: read`);
  const legs = job.strategy?.matrix?.include ?? [];
  if (job['runs-on'] !== '${{ matrix.runner }}' || JSON.stringify(legs) !== JSON.stringify([{ arch: 'amd64', runner: 'ubuntu-24.04' }, { arch: 'arm64', runner: 'ubuntu-24.04-arm' }])) {
    problems.push(`its legs are ${JSON.stringify(legs)} on ${String(job['runs-on'])}, not amd64 and arm64, each on its own platform: the purge reads each platform's packages and files`);
  }
  if (job.strategy?.['fail-fast'] !== false) problems.push('a leg that fails stops the other: fail-fast must be false, so each platform says what it found');
  const checkout = job.steps.find((s) => s.uses?.startsWith('actions/checkout@'));
  if (checkout?.with?.['persist-credentials'] !== false) problems.push('its checkout keeps a credential');
  const step = redisStep(workflow);
  const run = step?.run ?? '';
  if (step?.env?.['ARCH'] !== '${{ matrix.arch }}') problems.push("its step's ARCH is not the leg's");
  if (!/^set -euo pipefail$/m.test(run)) problems.push('its script does not start with set -euo pipefail');
  if (!run.includes('\\(localhost\\/redis:[^[:space:]]*\\)')) problems.push(`it does not read the name from managed.yml's ${REDIS_NAME} line`);
  if (!run.includes(`docker build --pull --progress=plain --tag "$ref" ${REDIS_CONTEXT}\n`)) problems.push(`it does not build ${REDIS_CONTEXT} under the name it read`);
  if (!run.includes(`\\(redis:[^[:space:]]*\\)[[:space:]]*$/\\1/p' ${REDIS}`)) problems.push("it does not read upstream's image from the Dockerfile's FROM");
  const svc = servicesOf(managed)[REDIS_SERVICE];
  if (!svc) return [...problems, `${MANAGED} has no ${REDIS_SERVICE}`];
  // The build as managed.yml runs it: its command, its volume's target, every capability dropped and none added.
  const command = typeof svc.command === 'string' ? svc.command : '';
  const target = (svc.volumes ?? []).find((v) => v.startsWith('redis_data:'))?.split(':')[1] ?? '';
  const built = dockerRun(run, 'redis-built');
  const wantBuilt = `docker run -d --name redis-built --security-opt no-new-privileges:true --cap-drop ALL -v redis-carry-over:${target} "$ref" ${command} >/dev/null`;
  if (built !== wantBuilt) problems.push(`it starts the build as \`${String(built)}\`, and managed.yml runs ${REDIS_SERVICE} as \`${wantBuilt}\` would: every capability dropped, none added, its command and its volume`);
  // Upstream's image as managed.yml ran it until the build: as root, with the four capabilities its entrypoint's root branch took.
  const upstream = dockerRun(run, 'redis-upstream');
  const wantUpstream = `docker run -d --name redis-upstream --security-opt no-new-privileges:true --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH --cap-add SETGID --cap-add SETUID -v redis-carry-over:${target} "$base" ${command} >/dev/null`;
  if (upstream !== wantUpstream) problems.push(`it starts upstream's image as \`${String(upstream)}\`, not as managed.yml ran it before the build: \`${wantUpstream}\``);
  const order = ['pong redis-upstream', 'docker exec redis-upstream redis-cli set carried', 'docker stop redis-upstream', 'docker run -d --name redis-built', 'prove redis-built "on the volume', 'docker restart redis-built', 'prove redis-built "after a restart'].map((s) => run.indexOf(s));
  if (order.some((i) => i < 0) || order.some((i, n) => n > 0 && i < order[n - 1]!)) {
    problems.push("it does not write the key with upstream's image, stop it, start the build on the volume, prove it, restart it and prove it again, in that order");
  }
  const commands = run.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  for (const line of commands) {
    if (/(^|[\s;&|(])exit\b/.test(line) && !/(^|[\s;&|(])exit 1$/.test(line)) problems.push(`\`${line}\` exits, and not to fail`);
  }
  return problems;
}

/**
 * The stubs the step runs against, as shell functions ahead of it. `docker`:
 * every call is logged; the pull, the build, the volume, a stop and a restart
 * succeed; `run` prints an id; `image inspect` answers the user, the platform
 * and the configuration from the environment (DRIFT makes the build's
 * entrypoint another than upstream's); `exec` answers redis-cli's ping, its
 * set and its get (from what set wrote, or CARRIED when it is set), the
 * server's /proc/1/status (SERVER_UID, SERVER_GID) and an exec's `id -u`
 * (EXEC_UID). `sleep` returns.
 */
const REDIS_STUBS = `docker() {
  printf '%s\\n' "$*" >> "$DOCKER_LOG"
  case "$1" in
    pull|build|volume|stop|restart) return 0 ;;
    run) echo 0123456789ab ;;
    image)
      case "$4" in
        '{{json .Config.User}}') printf '%s\\n' "$IMAGE_USER" ;;
        '{{.Os}}/{{.Architecture}}') printf '%s\\n' "$PLATFORM" ;;
        '{{json .Config.Entrypoint}}') if [ -n "$DRIFT" ] && [ "$5" != "$BASE" ]; then echo '["sh"]'; else echo '["docker-entrypoint.sh"]'; fi ;;
        '{{json .Config.'*) echo '"upstream"' ;;
        *) echo 'sha256:stub, user 999:999' ;;
      esac ;;
    exec)
      shift; shift
      case "$*" in
        'redis-cli ping') printf '%s\\n' "$PONG" ;;
        'redis-cli set carried '*) printf '%s' "$4" > "$STORE"; echo OK ;;
        'redis-cli get carried') if [ -n "\${CARRIED+x}" ]; then printf '%s\\n' "$CARRIED"; else cat "$STORE"; echo; fi ;;
        'cat /proc/1/status') printf 'Name:\\tredis-server\\nUid:\\t%s\\t%s\\t%s\\t%s\\nGid:\\t%s\\t%s\\t%s\\t%s\\n' "$SERVER_UID" "$SERVER_UID" "$SERVER_UID" "$SERVER_UID" "$SERVER_GID" "$SERVER_GID" "$SERVER_GID" "$SERVER_GID" ;;
        'id -u') printf '%s\\n' "$EXEC_UID" ;;
        *) echo "unexpected: docker exec $*" >&2; return 3 ;;
      esac ;;
    *) echo "unexpected: docker $*" >&2; return 3 ;;
  esac
}
sleep() { :; }
`;

/** What a right run of the step answers: Redis's build as it ran on 2026-11-07, on amd64. */
const RIGHT_ANSWERS: Readonly<Record<string, string>> = {
  IMAGE_USER: '"999:999"',
  PLATFORM: 'linux/amd64',
  ARCH: 'amd64',
  PONG: 'PONG',
  SERVER_UID: '999',
  SERVER_GID: '999',
  EXEC_UID: '999',
  DRIFT: '',
};

/** Runs the step as GitHub runs it (bash -eo pipefail), in this checkout, after the stubs, with `answers` over the right ones. */
function runRedisStep(run: string, answers: Readonly<Record<string, string>> = {}): { status: number; out: string; docker: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'redis-step-'));
  try {
    const script = join(dir, 'step.sh');
    writeFileSync(script, `${REDIS_STUBS}${run}`);
    const log = join(dir, 'docker.log');
    writeFileSync(log, '');
    const base = dockerfileBase(read(REDIS)).ref;
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, CI: 'true', GITHUB_ACTIONS: 'true', DOCKER_LOG: log, STORE: join(dir, 'store'), BASE: base, ...RIGHT_ANSWERS, ...answers },
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, docker: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Wrong answers, each given to the step in a run of its own: none may pass. */
const WRONG_ANSWERS: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ['an image that runs as root', { IMAGE_USER: '"root"' }],
  ['an image with no USER', { IMAGE_USER: '""' }],
  ["a build whose entrypoint is not upstream's", { DRIFT: '1' }],
  ["a build of another platform's image", { PLATFORM: 'linux/arm64' }],
  ['a server that never answers PONG', { PONG: '' }],
  ['a server that runs as root', { SERVER_UID: '0' }],
  ["a server in root's group", { SERVER_GID: '0' }],
  ['an exec that runs as root', { EXEC_UID: '0' }],
  ["a key upstream's image wrote that is not there", { CARRIED: '' }],
];

/** What is wrong with the step's verdict; empty when it holds. */
function redisVerdictProblems(workflow: string, dockerfile: string): string[] {
  const run = redisStep(workflow)?.run ?? '';
  const want = `${REDIS_NAME}:${builtTag(dockerfile)}`;
  const right = runRedisStep(run);
  if (right.status !== 0 || /^::error::/m.test(right.out)) return [`with Redis answering as its build did, the step exits ${right.status}:\n${right.out}`];
  for (const call of [
    `build --pull --progress=plain --tag ${want} ${REDIS_CONTEXT}`,
    `run -d --name redis-built --security-opt no-new-privileges:true --cap-drop ALL -v redis-carry-over:/data ${want} redis-server --appendonly yes`,
    'restart redis-built',
  ]) {
    if (!right.docker.includes(call)) return [`the step does not run \`docker ${call}\`: ${JSON.stringify(right.docker)}`];
  }
  if (!/^after a restart on its own volume: the server runs as 999:999, answers PONG, and reads the key upstream's image wrote$/m.test(right.out)) {
    return [`the step does not say what it proved after the restart:\n${right.out}`];
  }
  for (const [what, answers] of WRONG_ANSWERS) {
    const r = runRedisStep(run, answers);
    if (r.status === 0 || !/^::error::/m.test(r.out)) return [`with ${what}, the step exits ${r.status} without an error: its verdict is not every check's\n${r.out}`];
  }
  return [];
}

type Update = {
  'package-ecosystem': string;
  directory?: string;
  directories?: string[];
  ignore?: Array<{ 'dependency-name': string; 'update-types'?: string[] }>;
};

describe("Trigger.dev's Redis is built here: the webapp's thirteen purged, and redis's own user from the first process (2026-11-07, for alpha.6; thirteen since 2026-11-08)", () => {
  const redis = read(REDIS);
  const managed = read(MANAGED);
  const workflow = read(IMAGES_WORKFLOW);
  const reasons = sectionOf(redis, 'WHY. ', 'THE USER.');
  const how = sectionOf(redis, 'HOW THEY ARE PURGED, AND PROVED.', 'THE USER.');
  const user = sectionOf(redis, 'THE USER.', 'THE NAME.');
  const swap = (from: string | RegExp, to: string) => {
    const next = redis.replace(from, to);
    expect(next, `${String(from)} is not in ${REDIS}`).not.toBe(redis);
    return redisDockerfileProblems(next);
  };
  // Inside one program of the RUN: the scan (`elves`) and the check (`needs`) walk alike.
  const swapIn = (name: 'elves' | 'needs', from: string, to: string) => {
    const next = within(redis, name, from, to);
    expect(next, `${from} is not in ${REDIS}'s ${name}`).not.toBe(redis);
    return redisDockerfileProblems(next);
  };

  it('a FROM by tag and digest, the one RUN as root that purges REDIS_PURGE in the shape that fails loudly, USER 999:999 and a RUN as that user, and nothing else in the directory', () => {
    expect(redisDockerfileProblems(redis)).toEqual([]);
    expect(readdirSync(join(ROOT, REDIS_CONTEXT))).toEqual(['Dockerfile']);
  });

  it("is the webapp's list, on the owner's word that it is the webapp's purge, and says why each may go here", () => {
    expect(REDIS_PURGE.map((p) => p.name)).toEqual(WEBAPP_PURGE.map((p) => p.name));
    for (const p of REDIS_PURGE) {
      expect(p.why.length, `${p.name}: why`).toBeGreaterThan(40);
      expect(reasons, `the header names no ${p.name}`).toMatch(new RegExp(`(^|[\\s(,])${p.name.replace(/[.+]/g, '\\$&')}([\\s),.:;]|$)`));
    }
    for (const so of WEBAPP_LIBRARIES) expect(reasons, `the header names no ${so}`).toContain(so);
  });

  it('the header carries every reason, word for word, says how it is proved, and why the image runs as 999', () => {
    expect(reasons.length, 'no sections WHY to HOW THEY ARE PURGED').toBeGreaterThan(3000);
    for (const [needle, what] of REDIS_REASONS) expect(reasons, what).toContain(needle);
    expect(how).toContain('`dpkg-query -W` of exactly the thirteen, first');
    expect(how).toContain("--force-remove-essential --force-remove-protected`, the two flags of the owner's decision, and no other force");
    for (const needle of [
      'setpriv goes with util-linux, so this image runs as 999:999 from its first process',
      "managed.yml's trigger-redis adds no capability",
      'THE VOLUME CARRIES OVER.',
      '(`find /data ! -user 999`, which prints nothing)',
      'The way back is a tag before this, which runs upstream\'s image as root again',
    ]) {
      expect(user, needle).toContain(needle);
    }
  });

  it('refuses each way the purge could slip', () => {
    expect(swap('--force-remove-protected $purge', '--force-remove-protected --force-depends $purge')).toEqual([
      'its force flags are --force-remove-essential --force-remove-protected --force-depends, not --force-remove-essential --force-remove-protected alone',
      "it names 3 --force flags (--force-remove-essential --force-remove-protected --force-depends), not the purge's two",
    ]);
    expect(swap(' libuuid1 apt', ' apt')).toEqual(['its purge= is ["util-linux","util-linux-extra","mount","bsdutils","libblkid1","libmount1","libsmartcols1","apt","libapt-pkg6.0","e2fsprogs","libsystemd0","libudev1"], not the thirteen REDIS_PURGE names, in order']);
    expect(swap(' libapt-pkg6.0 e2fsprogs libsystemd0 ', ' libapt-pkg6.0 libsystemd0 ')).toHaveLength(1);
    expect(swap(' e2fsprogs libsystemd0 libudev1"', ' e2fsprogs"')).toEqual([`its purge= is [${ELEVEN}], not the thirteen REDIS_PURGE names, in order`]);
    expect(swap(' libapt-private.so.0.0 libsystemd.so.0', ' libsystemd.so.0')).toEqual(['its libraries= is ["libuuid.so.1","libblkid.so.1","libmount.so.1","libsmartcols.so.1","libapt-pkg.so.6.0","libsystemd.so.0","libudev.so.1"], not WEBAPP_LIBRARIES']);
    expect(swap(/^ {4}dpkg-query -W \$purge \|\| fail [^\n]*\n/m, '')).toEqual(['no `dpkg-query -W $purge || fail`: a renamed or missing package would be a name dpkg skips with a warning']);
    const query = /^ {4}dpkg-query -W \$purge \|\| fail [^\n]*\n/m.exec(redis)![0];
    const late = redis.replace(query, '').replace(/^( {4}dpkg --purge [^\n]*\n)/m, `$1${query}`);
    expect(redisDockerfileProblems(late)).toEqual(['`dpkg-query -W $purge` is not the first thing it asks dpkg', 'dpkg-query -W comes after the purge, which checks nothing in time']);
    expect(swap(/^ {4}\[ -z "\$audit" \] \|\| fail "dpkg --audit reads problems[^\n]*\n/m, '')).toEqual(['no `dpkg --audit` read, its output empty, before the purge']);
    expect(swap(/^ {4}\[ -z "\$audit" \] \|\| fail "after the purge[^\n]*\n/m, '')).toEqual(['no `dpkg --audit` read, its output empty, after the purge']);
    expect(swap(/^ {4}listed="[^\n]*\n {4}for l in \$libraries[^\n]*\n/m, '')).toEqual(['no check, before the purge, that the thirteen ship every library of $libraries']);
    expect(swap(/^ {4}for p in \$purge; do [^\n]*\n/m, '')).toEqual(['no check, after the purge, that dpkg reads each of the thirteen as gone']);
    expect(swap(/^ {4}found="\$\(perl -e "\$elves"[^\n]*\n {4}\[ "\$st" = 0 \][^\n]*\n/m, '')).toEqual(['no scan, after the purge, for an ELF file that names one of $libraries']);
    const needsRun = /^ {4}left="\$\(perl -e "\$needs"[^\n]*\n {4}\[ "\$st" = 0 \][^\n]*\n/m;
    expect(swap(needsRun, '')).toEqual(['no check, after the purge, that no file of $libraries is left and that no ELF file needs one']);
    const needsLines = needsRun.exec(redis)![0];
    const afterScan = redis.replace(needsLines, '').replace(/^( {4}found="\$\(perl -e "\$elves"[^\n]*\n {4}\[ "\$st" = 0 \][^\n]*\n)/m, `$1${needsLines}`);
    expect(redisDockerfileProblems(afterScan)).toEqual(['the check of what needs a library comes after the scan for what names one, which stops the build first, so no DT_NEEDED would ever be read']);
    expect(swap('last if $t == 0; push @need, $v if $t == 1; ', 'last if $t == 0; ')).toEqual(['the check of what is left no longer reads DT_NEEDED and DT_STRTAB']);
    expect(swap('exit 2 if $dyn == 0; ', '')).toEqual(['the check of what is left no longer fails when it met no ELF file that needs a library']);
    expect(swap('push @hits, "$p: needs $n" if grep { $_ eq $n } @$need;', '')).toEqual(['the check of what is left no longer fails on an ELF file that needs one']);
    expect(swap('top=/;', 'top=/usr;')).toEqual(['the scan does not start at /, the image whole']);
    expect(swapIn('elves', 'if (-d _) { walk($p) if $s[0] == $dev; next; }', 'if (-d _) { walk($p); next; }')).toEqual(["the scan no longer walks every directory of the image's own file system, and no other"]);
    expect(swapIn('needs', 'if (-d _) { walk($p) if $s[0] == $dev; next; }', 'if (-d _) { walk($p); next; }')).toEqual(["the check of what is left no longer walks every directory of the image's own file system, and no other"]);
    // A device check on files as well would pass over a file whose layer gives it another st_dev.
    expect(swapIn('elves', 'if (-d _) { walk($p) if $s[0] == $dev; next; }', 'next if $s[0] != $dev; if (-d _) { walk($p); next; }')).toEqual(["the scan no longer walks every directory of the image's own file system, and no other"]);
    expect(swapIn('elves', 'my @s = lstat $p or die', 'my @s = stat $p or die')).toEqual(['the scan no longer reads each entry as it is, a link as a link']);
    expect(swapIn('needs', 'my @s = lstat $p or die', 'my @s = stat $p or die')).toEqual(['the check of what is left no longer reads each entry as it is, a link as a link']);
    expect(swap('exit 2 if $read == 0; ', '')).toEqual(['the scan no longer fails when it read no ELF at all']);
    expect(swapIn('elves', 'if (@hits) {', 'if (0) {')).toEqual(['the scan no longer fails on a file that names one']);
    expect(swapIn('needs', 'if (@hits) {', 'if (0) {')).toEqual(['the check of what is left no longer fails on what it found']);
    expect(swap('for c in id find redis-server redis-cli;', 'for c in id find redis-cli;')).toEqual(['no proof, after the purge, that redis-server starts']);
    expect(swap(/^ {4}sh -c : \|\| fail [^\n]*\n/m, '')).toEqual(['no proof, after the purge, that sh starts']);
    // apt-get check in dpkg --audit's place: apt is gone by then.
    expect(swap(/^( {4}audit="\$\(dpkg --audit\)" \|\| fail "dpkg --audit did not run after the purge\.";) \\\n {4}\[ -z "\$audit" \][^\n]*\n/m, '    apt-get check || fail "apt is not consistent"; \\\n')).toEqual([
      'it runs apt, which it purges: `dpkg --audit` checks what is left',
      'no `dpkg --audit` read, its output empty, after the purge',
    ]);
    expect(swap(/^( {4})dpkg --purge /m, '$1dpkg --remove ')).toEqual(['0 RUNs run dpkg --purge, not one']);
  });

  it("refuses an image that would start as root, a last RUN that proves less, another base, and what the name does not cover", () => {
    // The USER gone: the purge is the last RUN, as root, and upstream's entrypoint would take its root branch into a setpriv that is not there.
    expect(swap(/^USER 999:999\n/m, '')).toEqual([
      'its instructions are ["FROM","RUN","RUN"], not FROM, RUN, USER and RUN: anything else reads files the name does not cover, or changes upstream\'s interface',
      "its USER lines are [], not one USER 999:999: upstream's entrypoint takes its root branch as root, and its setpriv is purged",
      'the purge is not the last RUN as root: every other change comes before it, and nothing after it may need what it purged',
      "the purge is not followed by USER 999:999, Redis's own user and group",
      'the last RUN does not run as 999:999, so nothing proves the image starts as its own user',
    ]);
    expect(swap(/^USER 999:999$/m, 'USER redis')).toEqual(expect.arrayContaining([expect.stringContaining('not one USER 999:999'), expect.stringContaining('the purge is not followed by USER 999:999')]));
    // The last RUN cut short, or asking for another release than the FROM's.
    expect(swap('[ "$who" = 999:999 ] || {', '[ -n "$who" ] || {')).toEqual(['the last RUN does not stop when it runs as another user than 999:999']);
    expect(swap('said="$(docker-entrypoint.sh redis-server --version)"', 'said="$(redis-server --version)"')).toEqual(["the last RUN does not start redis-server through upstream's entrypoint"]);
    expect(swap(/^FROM redis:7\.4\.\d+-bookworm@/m, 'FROM redis:7.4.99-bookworm@')).toEqual([expect.stringMatching(/^the last RUN asks redis-server for 7\.4\.\d+, and the FROM names 7\.4\.99: re-read the header/)]);
    expect(swap(/^FROM redis:/m, 'FROM valkey/valkey:')).toEqual([expect.stringContaining('not the official redis image')]);
    expect(swap(/^FROM redis:(7\.4\.\d+)-bookworm@/m, 'FROM redis:$1-trixie@')).toEqual([expect.stringContaining('not an exact Redis release on Debian 12')]);
    const from = dockerfileBase(redis);
    expect(swap(from.ref, `redis:${from.tag}`)).toEqual([expect.stringContaining('carries no tag and digest')]);
    expect(redisDockerfileProblems(`# syntax=docker/dockerfile:1\n${redis}`)).toEqual([expect.stringContaining('is a parser directive')]);
    for (const line of ['COPY redis.conf /usr/local/etc/redis/redis.conf', 'ADD https://example.org/x /tmp/', 'ENV REDIS_ARGS=--protected-mode', 'HEALTHCHECK CMD redis-cli ping']) {
      expect(redisDockerfileProblems(`${redis}${line}\n`), line).toEqual([expect.stringContaining('not FROM, RUN, USER and RUN')]);
    }
    expect(swap(/^RUN set -eu; \\\n {4}me=deploy\/compose\/redis\/Dockerfile; \\\n {4}fail\(\)/m, 'RUN --mount=type=bind,target=/src set -eu; \\\n    me=deploy/compose/redis/Dockerfile; \\\n    fail()')).toEqual([expect.stringContaining('mounts something')]);
    // An install after the purge, as 999 or as root.
    expect(redisDockerfileProblems(`${redis}RUN apt-get install -y util-linux\n`)).toEqual(expect.arrayContaining(['a RUN after the purge installs a package: apt-get install -y util-linux']));
  });

  it('managed.yml runs that build as localhost/redis:<builtTag>, never pulled, with no capability and no user of its own', () => {
    expect(redisComposeProblems(managed, redis)).toEqual([]);
    expect(readImages(managed).filter((i) => i.repo === REDIS_NAME).map((i) => i.tag)).toEqual([builtTag(redis)]);
    expect(readImages(managed).filter((i) => i.repo === 'redis')).toEqual([]);
  });

  it('prints the sed that moves a name the Dockerfile moved past, and the sed moves it', () => {
    const edited = redis.replace('    sh -c : || fail', '    sh -c true || fail');
    expect(edited).not.toBe(redis);
    const problems = redisComposeProblems(managed, edited);
    expect(problems).toHaveLength(1);
    const sed = /^ {2}(sed -i -e '[^']+') deploy\/compose\/managed\.yml$/m.exec(problems[0]!)?.[1];
    expect(sed, problems[0]).toBeDefined();
    expect(problems[0]).toMatch(new RegExp(`deploy/compose/managed\\.yml:\\d+ \\(${REDIS_SERVICE}\\)`));
    const dir = mkdtempSync(join(tmpdir(), 'redis-name-'));
    try {
      const file = join(dir, 'managed.yml');
      writeFileSync(file, managed);
      const ran = spawnSync('sed', ['-i', '-e', sed!.replace(/^sed -i -e '/, '').replace(/'$/, ''), file], { encoding: 'utf8' });
      expect(ran.status, ran.stderr).toBe(0);
      const moved = readFileSync(file, 'utf8');
      expect(redisComposeProblems(moved, edited)).toEqual([]);
      expect(moved.split('\n').filter((line, i) => line !== managed.split('\n')[i])).toEqual([`    image: ${REDIS_NAME}:${builtTag(edited)}`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses upstream's image back, another build, a pull, a user, a capability, and a healthcheck the build does not prove", () => {
    const swapped = (from: RegExp, to: string) => {
      const text = managed.replace(from, to);
      expect(text, `${String(from)} matched nothing`).not.toBe(managed);
      return redisComposeProblems(text, redis);
    };
    expect(swapped(/^(\s*image:\s*)localhost\/redis:\S+$/m, `$1${dockerfileBase(redis).ref}`)).toEqual([expect.stringContaining("upstream's image with the eleven"), expect.stringContaining('not localhost/redis:')]);
    expect(swapped(/^(\s*)build: \.\/redis$/m, '$1build:\n$1  context: ./redis')).toEqual([expect.stringContaining('not the bare `./redis`')]);
    expect(swapped(/^(\s*build: \.\/redis\n)\s*pull_policy: never\n/m, '$1')).toEqual([expect.stringContaining('not never')]);
    expect(swapped(/^(\s*build: \.\/redis\n)/m, '$1    user: "0"\n')).toEqual([expect.stringContaining('sets user: 0')]);
    expect(swapped(/^(\s*cap_drop: \[ALL\]\n)(\s*command: redis-server --appendonly yes)$/m, '$1    cap_add: [CHOWN, DAC_READ_SEARCH, SETGID, SETUID]\n$2')).toEqual([
      expect.stringContaining('adds CHOWN, DAC_READ_SEARCH, SETGID, SETUID'),
    ]);
    expect(swapped(/(\s*test: )\["CMD", "redis-cli", "ping"\]/, '$1["CMD-SHELL", "redis-cli ping | grep PONG"]')).toEqual([expect.stringContaining('not redis-cli ping')]);
    expect(swapped(/^(\s*)command: redis-server --appendonly yes$/m, '$1command: redis-server')).toEqual([expect.stringContaining('the append-only file redis_data carries')]);
  });

  it('images.yml builds it on both platforms on a pull request, and starts it as 999 on a volume upstream\'s image wrote, as managed.yml runs it', () => {
    expect(redisWorkflowProblems(workflow, managed)).toEqual([]);
  });

  it("the job's verdict is every check's", () => {
    expect(redisVerdictProblems(workflow, redis)).toEqual([]);
  }, 60_000);

  it('refuses a job that drifted from managed.yml, or stopped asking', () => {
    const swapped = (text: string, from: RegExp | string, to: string) => {
      const out = text.replace(from, to);
      expect(out, `${String(from)} matched nothing`).not.toBe(text);
      return out;
    };
    const problems = (wf: string, m = managed) => redisWorkflowProblems(wf, m);
    expect(problems(swapped(workflow, 'name: build (redis, ${{ matrix.arch }})', 'name: build (redis)'))).toEqual([expect.stringContaining('every-pr-check-is-classified')]);
    expect(problems(swapped(workflow, /\n {10}- arch: arm64\n {12}runner: ubuntu-24\.04-arm\n(?= {4}steps:\n {6}- uses: actions\/checkout@[0-9a-f]+ # v[\d.]+\n {8}with:\n {10}persist-credentials: false\n\n {6}- name: Build Redis)/, '\n'))).toEqual([
      expect.stringContaining('not amd64 and arm64'),
    ]);
    expect(problems(swapped(workflow, '            --security-opt no-new-privileges:true --cap-drop ALL \\\n            -v redis-carry-over:/data "$ref"', '            --security-opt no-new-privileges:true --cap-drop ALL --cap-add CHOWN \\\n            -v redis-carry-over:/data "$ref"'))).toEqual([
      expect.stringContaining('it starts the build as'),
    ]);
    expect(problems(workflow, swapped(managed, /^(\s*)command: redis-server --appendonly yes$/m, '$1command: redis-server --appendonly no'))).toEqual([
      expect.stringContaining('it starts the build as'),
      expect.stringContaining("it starts upstream's image as"),
    ]);
    expect(problems(swapped(workflow, '          docker restart redis-built >/dev/null\n', ''))).toEqual([expect.stringContaining('in that order')]);
    expect(problems(swapped(workflow, `--tag "$ref" ${REDIS_CONTEXT}\n`, '--tag "$ref" deploy/compose/caddy\n'))).toEqual([expect.stringContaining(`does not build ${REDIS_CONTEXT}`)]);
    expect(problems(swapped(workflow, '\n          echo "${ref}: ${platform}, $(docker image inspect', '\n          exit 0\n          echo "${ref}: ${platform}, $(docker image inspect'))).toEqual([
      expect.stringContaining('`exit 0` exits, and not to fail'),
    ]);
  });

  it('refuses a step that passes when Redis did not come up as 999 with the key', () => {
    const verdict = (wf: string) => redisVerdictProblems(wf, redis);
    const swapped = (from: string, to: string) => {
      const out = workflow.replace(from, to);
      expect(out, `${from} matched nothing`).not.toBe(workflow);
      return out;
    };
    expect(verdict(swapped('if [ "$uid:$gid" != 999:999 ]; then', 'if [ "$gid" != 999 ]; then'))).toEqual([expect.stringMatching(/^with a server that runs as root, the step exits 0/)]);
    expect(verdict(swapped('if [ "$carried" != "written by ${base}" ]; then', 'if [ -z "${base}" ]; then'))).toEqual([expect.stringMatching(/^with a key upstream's image wrote that is not there, the step exits 0/)]);
    expect(verdict(swapped('if [ "$user" != \'"999:999"\' ]; then', 'if [ "$user" = \'"nobody"\' ]; then'))).toEqual([expect.stringMatching(/^with an image that runs as root, the step exits 0/)]);
    expect(verdict(swapped('if [ "$exec_uid" != 999 ]; then', 'if [ -z "$exec_uid" ]; then'))).toEqual([expect.stringMatching(/^with an exec that runs as root, the step exits 0/)]);
  }, 60_000);

  it('Dependabot moves its base within Redis 7, in a pull request of its own', () => {
    const updates = (parseYaml(read('.github/dependabot.yml')) as { updates: Update[] }).updates;
    const entries = updates.filter((u) => [...(u.directories ?? []), ...(u.directory ? [u.directory] : [])].includes(`/${REDIS_CONTEXT}`));
    expect(entries, 'one Dependabot entry reads the directory').toHaveLength(1);
    const [entry] = entries;
    expect(entry!['package-ecosystem']).toBe('docker');
    expect(entry!.directories, 'an entry of its own: a shared one groups the apps, whose checks never build this').toBeUndefined();
    expect(entry!.ignore).toEqual([{ 'dependency-name': 'redis', 'update-types': ['version-update:semver-major'] }]);
  });
});
