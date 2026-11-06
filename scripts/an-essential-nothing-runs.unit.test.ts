// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ESSENTIAL PACKAGE NOTHING RUNS, AND 37 OF 44 HIGH FINDINGS IN IT (workplan
 * 0119; the owner's decision of 2026-11-03, for alpha.4).
 *
 * Two images ran our code on the Node image's Debian: the appliance
 * (`apps/selfhost/Dockerfile`'s runtime stage) and the managed tasks (until
 * 2026-11-06, the runtime base `apps/worker/trigger.config.ts` built them on,
 * the API's Node image with one layer). With npm gone, Trivy 0.76.1 read 0 critical and 44
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
 * Since 2026-11-06 the tasks run on the prebuilt base
 * (`apps/worker/task-image/Dockerfile`, published to GHCR and pinned in
 * trigger.config.ts; workplan 0119 §3 item 13): distroless, with none of the
 * ten and no dpkg to purge them with, and nothing the CLI builds into it. The
 * config's layer and its purge went with the switch, and
 * `a-task-base-the-cli-builds-nothing-into` holds the base, the config and
 * the managed smoke's question to the image the last deploy built.
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
 * 3. THE APPLIANCE: one RUN in the runtime stage, as root (before USER), and
 *    nothing after it in that stage installs a package. That Dockerfile is the
 *    whole image, so this is its check; E2E (self-hosted) asks the appliance
 *    it built as well (4).
 * 4. WHAT RAN, ASKED: E2E (self-hosted) asks the appliance it started about
 *    all ten, with dpkg's own query. The step runs here against a stand-in
 *    docker: absent (or dpkg's record of a purged package, as `login` keeps
 *    one) passes; installed, config files left, a package not answered for,
 *    an answer it cannot read, and a probe that could not be asked fail.
 *
 * Until 2026-11-06 the tasks' half stood here too: the layer's purge where
 * there was no C++ compiler, on a `-slim` base, last of the layer; the weekly
 * scan's stage, the CLI's apt repair after the purge included; and the
 * managed smoke's dpkg query of the image the last deploy built.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** The ten, as the owner's decision of 2026-11-03 took them, in the order the appliance writes them. */
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
const E2E = '.github/workflows/e2e.yml';

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
