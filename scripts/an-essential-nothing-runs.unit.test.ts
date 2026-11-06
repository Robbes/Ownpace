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
 * 4. THE TRIGGER.DEV WEBAPP (2026-11-06, for alpha.5: item 11 extended under
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
 *
 * Until 2026-11-06 the tasks' half stood here too: the layer's purge where
 * there was no C++ compiler, on a `-slim` base, last of the layer; the weekly
 * scan's stage, the CLI's apt repair after the purge included; and the
 * managed smoke's dpkg query of the image the last deploy built.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** A command that installs a package, with apt or dpkg: none may follow the purge. */
const INSTALLS = /\b(?:apt-get|apt|aptitude)\s+(?:-\S+\s+)*(?:install|reinstall|upgrade|dist-upgrade|full-upgrade)\b|\bdpkg\s+(?:-\S+\s+)*(?:-i|--install|--unpack)\b/;

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

