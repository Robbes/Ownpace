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
