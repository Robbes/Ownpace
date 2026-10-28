// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BASE IMAGE THAT CARRIED WHAT NOTHING RUNS (workplan 0146 T12).
 *
 * The api, selfhost and web images built `FROM node:24.22.1-slim`. The bare
 * `-slim` tag is Debian 12 ("bookworm"), and on 2026-10-25 Trivy 0.76.1 read 1
 * critical and 61 high findings in it, on amd64 and arm64 alike. Two things in
 * that count were never chosen:
 *
 * - **Which Debian.** `node:24.22.1-trixie-slim`, Debian 13.7, read 0 and 48
 *   the same day, and its `/usr/local/bin/node` is the same file, byte for byte
 *   (sha256 `e32e2d16…` on amd64, `c8c57216…` on arm64, read out of both
 *   images' layers). A tag without a codename is whichever Debian the Node
 *   images make their default, so the release under every image could move, or
 *   stay behind, without a line in a diff.
 * - **npm and corepack in the runtime.** Five of the highs were npm's own
 *   bundled undici, brace-expansion and http-cache-semantics, under
 *   `/usr/local/lib/node_modules/npm`. Nothing in the api or selfhost container
 *   runs a package manager: CMD and the HEALTHCHECK are `node`, the smoke
 *   gate's `docker exec` probes were `printenv` and `node -e` (until 0146 T13,
 *   which reads the variables from Docker instead), and no script or
 *   doc execs npm, npx, pnpm, yarn or corepack into either. Removed, the base
 *   reads 0/43 (the trixie image with a layer of the same removals, scanned
 *   from an OCI layout, both architectures), and none of the 43 has a Debian
 *   fix.
 *
 * So this file holds:
 *
 * 1. Every `FROM node:` line in `apps/*\/Dockerfile` is one string, tag and
 *    digest. The managed tasks build on the API's line
 *    (`apps/worker/trigger.config.ts`), the Windows payload ships the version of
 *    the selfhost's (`scripts/package-appliance.mjs`), and the web bundle is
 *    built on the third. Two of the three said "the same node tag and digest"
 *    in a comment, and nothing compared them.
 * 2. That string names its Debian release (`-<codename>-slim`), and the release
 *    is not bookworm. Dependabot keeps the suffix when it moves the tag, so a
 *    new Debian is an edit somebody makes.
 * 3. The selfhost runtime stage removes every package manager the base
 *    image and the base stage's `corepack enable` put there, in one RUN before
 *    `USER` (as root, which owns them), and nothing after it puts one back.
 * 4. What runs in that container runs `node` and no package manager: the
 *    stage's CMD, HEALTHCHECK and ENTRYPOINT, and the `command`, `entrypoint`
 *    and `healthcheck` of every compose service built from its Dockerfile
 *    (`deploy/selfhost/compose.yml`'s `app`), in every compose file of its
 *    directory, overrides included. That is what makes 3 safe.
 *
 * The api's runtime stage did the same until 0146 T13 put it on distroless
 * (`gcr.io/distroless/nodejs24-debian13:nonroot`), which carries Node and no
 * package manager at all, nor a shell to run a RUN with; its build stage still
 * builds FROM the Node line held by 1 and 2, and
 * `scripts/an-api-image-with-nothing-to-exec.unit.test.ts` holds the rest.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * The images whose runtime stage runs on the Node image, and so must remove its
 * package managers. The api's runtime is distroless since 0146 T13, with none
 * to remove (scripts/an-api-image-with-nothing-to-exec.unit.test.ts).
 */
const NODE_RUNTIMES = ['apps/selfhost/Dockerfile'];

/**
 * What the base image and `corepack enable` install that runs a package manager.
 * Read out of `node:24.22.1-trixie-slim`'s layers on 2026-10-25: npm and corepack
 * under /usr/local/lib/node_modules, the npm, npx, corepack, yarn and yarnpkg
 * links in /usr/local/bin, and yarn 1 in /opt/yarn-v1.22.22. `corepack enable`
 * adds the pnpm and pnpx links and points yarn's at itself. `nodejs` is a link
 * to node, and stays.
 *
 * The global-modules directory is removed whole, not npm and corepack in it by
 * name. Named, a base stage that installs a package manager with
 * `npm install -g` (the way to get one once the Node image ships no corepack,
 * from Node 25) left its package there while every line here still held:
 * `RUN npm install -g pnpm@…` in place of `corepack enable` kept this file
 * green with `/usr/local/lib/node_modules/pnpm` in the runtime image.
 */
const PACKAGE_MANAGERS = [
  '/usr/local/lib/node_modules',
  '/usr/local/bin/npm',
  '/usr/local/bin/npx',
  '/usr/local/bin/corepack',
  '/usr/local/bin/pnpm',
  '/usr/local/bin/pnpx',
  '/usr/local/bin/yarn',
  '/usr/local/bin/yarnpkg',
  '/opt/yarn-v*',
];

/** A package manager named as a command. */
const RUNS_A_PACKAGE_MANAGER = /(?:^|[\s"'[,;&|(/])(?:npm|npx|pnpm|pnpx|yarn|yarnpkg|corepack)(?=$|[\s"',;&|)\]])/;

type Instruction = { op: string; args: string };
type Stage = { name: string; base: string; body: Instruction[] };

/**
 * A Dockerfile's stages, in order, each with its instructions. Comment lines go
 * first, as Docker drops them before it joins continued lines.
 */
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

/** Every `FROM node:…` image in every app's Dockerfile, found rather than listed. */
function nodeBases(): ReadonlyArray<{ dockerfile: string; image: string }> {
  return readdirSync(join(ROOT, 'apps'))
    .map((app) => `apps/${app}/Dockerfile`)
    .filter((p) => existsSync(join(ROOT, p)))
    .flatMap((dockerfile) =>
      stagesOf(read(dockerfile))
        .filter((s) => s.base.startsWith('node:'))
        .map((s) => ({ dockerfile, image: s.base })),
    );
}

/** The paths one RUN removes with `rm`, or none. */
function removedBy(run: string): string[] {
  return run
    .split(/&&|\|\||;/)
    .map((command) => command.trim().split(/\s+/))
    .filter((words) => words[0] === 'rm')
    .flatMap((words) => words.slice(1).filter((w) => !w.startsWith('-')));
}

/** The program an exec-form (`["node", …]`) or shell-form (`node …`) command starts. */
function programOf(command: string): string | undefined {
  const trimmed = command.trim();
  if (trimmed.startsWith('[')) return (JSON.parse(trimmed) as string[])[0];
  return trimmed.split(/\s+/)[0];
}

describe('one Node base, on a named Debian release', () => {
  const bases = nodeBases();

  it('the api, selfhost and web images all build FROM node (vacuity)', () => {
    expect(new Set(bases.map((b) => b.dockerfile))).toEqual(
      new Set(['apps/api/Dockerfile', 'apps/selfhost/Dockerfile', 'apps/web/Dockerfile']),
    );
  });

  it('every FROM node line is the same image, tag and digest', () => {
    // The tasks take the API's Node, the Windows zip the selfhost's version;
    // three lines that drift apart ship three Nodes on three Debians.
    expect(new Set(bases.map((b) => b.image)), JSON.stringify(bases, null, 2)).toHaveProperty('size', 1);
  });

  it('the tag names its Debian release, and it is not bookworm', () => {
    for (const { dockerfile, image } of bases) {
      const m = /^node:\d+\.\d+\.\d+-([a-z]+)-slim@sha256:[0-9a-f]{64}$/.exec(image);
      expect(m, `${dockerfile}: ${image} names no Debian release (node:<x.y.z>-<codename>-slim@sha256:<digest>)`).not.toBeNull();
      // Debian 12's `node:24.22.1-slim` read 1 critical and 61 high on
      // 2026-10-25, Debian 13's 0 and 48, with the same Node binary in both.
      expect(m![1], `${dockerfile}: ${image} is Debian 12`).not.toBe('bookworm');
    }
  });
});

describe.each(NODE_RUNTIMES)('%s carries no package manager at runtime', (dockerfile) => {
  const stages = stagesOf(read(dockerfile));
  const runtime = stages.at(-1)!;
  const at = runtime.body.findIndex((i) => i.op === 'RUN' && PACKAGE_MANAGERS.every((p) => removedBy(i.args).includes(p)));
  const user = runtime.body.findIndex((i) => i.op === 'USER');

  it('its last stage is the runtime, built on the Node base, and it sets a USER (vacuity)', () => {
    expect(runtime.name).toBe('runtime');
    const baseStage = stages.find((s) => s.name === runtime.base);
    expect(baseStage?.base ?? runtime.base).toMatch(/^node:/);
    expect(user, 'no USER in the runtime stage').toBeGreaterThanOrEqual(0);
  });

  it('one RUN removes every package manager, before USER', () => {
    const missing = PACKAGE_MANAGERS.filter(
      (p) => !runtime.body.some((i) => i.op === 'RUN' && removedBy(i.args).includes(p)),
    );
    expect(missing, 'not removed in the runtime stage').toEqual([]);
    expect(at, 'the removals are not one RUN').toBeGreaterThanOrEqual(0);
    // After USER the files are root's and the removal would fail the build;
    // before it, they are gone for the user the container runs as.
    expect(at, 'the removal comes after USER').toBeLessThan(user);
  });

  it('nothing after the removal puts one back', () => {
    for (const i of runtime.body.slice(at + 1)) {
      if (i.op === 'RUN') expect(i.args, `${i.op} ${i.args}`).not.toMatch(RUNS_A_PACKAGE_MANAGER);
      if (i.op === 'COPY' || i.op === 'ADD') {
        const target = i.args.split(/\s+/).at(-1)!;
        expect(target, `${i.op} ${i.args}`).not.toMatch(/^\/(?:usr\/local|opt)(?:\/|$)/);
      }
    }
  });

  it('CMD, HEALTHCHECK and ENTRYPOINT run node, and no package manager', () => {
    const cmd = runtime.body.filter((i) => i.op === 'CMD');
    expect(cmd, 'no CMD in the runtime stage').toHaveLength(1);
    expect(programOf(cmd[0]!.args)).toBe('node');
    for (const i of runtime.body.filter((x) => x.op === 'HEALTHCHECK')) {
      const command = /\bCMD\s+(.*)$/.exec(i.args)?.[1];
      expect(command, `HEALTHCHECK ${i.args}`).toBeDefined();
      expect(programOf(command!)).toBe('node');
    }
    for (const i of runtime.body.filter((x) => ['CMD', 'HEALTHCHECK', 'ENTRYPOINT'].includes(x.op))) {
      expect(i.args, `${i.op} ${i.args}`).not.toMatch(RUNS_A_PACKAGE_MANAGER);
    }
  });
});

describe('no compose service built from those images runs a package manager', () => {
  /** Every compose file under deploy/, found rather than listed. */
  const composeFiles = ['deploy/compose', 'deploy/selfhost'].flatMap((dir) =>
    readdirSync(join(ROOT, dir))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => `${dir}/${f}`),
  );
  type Service = { build?: { dockerfile?: string }; command?: unknown; entrypoint?: unknown; healthcheck?: { test?: unknown } };
  const services = composeFiles.flatMap((file) => {
    // As Compose reads it: merge keys applied, and its own `!reset` tag
    // (compose.pglite.yml) kept as a value rather than warned about.
    const doc = (parseYaml(read(file), { merge: true, logLevel: 'error' }) ?? {}) as { services?: Record<string, Service | null> };
    return Object.entries(doc.services ?? {}).map(([name, service]) => ({ file, name, service: service ?? {} }));
  });
  // A service built from one of the images, in its base file; an override file
  // names the same service in the same directory without a build.
  const built = services.filter((s) => NODE_RUNTIMES.includes(s.service.build?.dockerfile ?? ''));

  it('finds the selfhost service (vacuity)', () => {
    expect(built.map((s) => s.service.build!.dockerfile).sort()).toEqual([...NODE_RUNTIMES].sort());
  });

  it('their command, entrypoint and healthcheck, in every file that names them', () => {
    for (const b of built) {
      const dir = dirname(b.file);
      for (const s of services.filter((x) => x.name === b.name && dirname(x.file) === dir)) {
        for (const value of [s.service.command, s.service.entrypoint, s.service.healthcheck?.test]) {
          if (value === undefined) continue;
          expect(JSON.stringify(value), `${s.file}: ${s.name}`).not.toMatch(RUNS_A_PACKAGE_MANAGER);
        }
      }
    }
  });
});
