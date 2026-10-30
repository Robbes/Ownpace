// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A BINARY THE STACK NEVER RUNS (workplan 0146 T16): Trivy skips a hard link,
 * so a scan that reads 0 is no proof a binary is gone, and which copy of pnpm
 * runs follows compose's `user:`, not the image's.
 *
 * The weekly image scan of 2026-10-26 (Trivy 0.76.1, linux/arm64) read 8
 * critical findings in `ghcr.io/triggerdotdev/trigger.dev:v4.8.1` and 2 in its
 * supervisor. Five of the webapp's and one of the supervisor's are in files no
 * process of this stack runs: @depot/cli's Go binary (`depot push`, reached
 * only with a depot token, which this stack refuses), esbuild 0.23.0's Go
 * binary (the trigger.dev CLI's, which nothing in the image calls), and tar
 * 7.5.13 inside a copy of pnpm 10.33.2 that corepack keeps for a user the
 * service does not run as. The owner chose "Both" on 2026-10-26: an issue
 * upstream, and until it ships, a build here that deletes only those files.
 * On 2026-10-27, asked with the risk stated, the owner chose to delete tar
 * from the copy each service does run too (one more in each): in pnpm
 * 10.33.2 only the bundled node-gyp requires it, to unpack Node's headers for
 * a native build, and these containers run scripts and install nothing. The
 * one risk is a `pnpm install` there that builds a native add-on.
 * So `deploy/compose/trigger.dev/Dockerfile` and
 * `deploy/compose/supervisor/Dockerfile` build on upstream's images by tag and
 * index digest, and their headers say why each file is safe to delete.
 *
 * Two lessons came out of reading it, and each is held here. A third came with
 * the one finding left that a release fixes (below, A COPY THE SCAN READS).
 *
 *  - TRIVY DOES NOT SEE A HARD-LINKED SECOND NAME. The postinstall of
 *    @depot/cli and of esbuild hard-links the platform package's binary over
 *    its own bin/ shim (install.js, maybeOptimizePackage). BuildKit's COPY
 *    keeps the link, the layer stores the second name as a tar TypeLink, and
 *    Trivy's walker skips TypeLink entries (pkg/fanal/walker/tar.go at
 *    v0.76.1). Deleting the one path the scan reported would make the scan
 *    read 0 while the same ELF stayed under @depot/cli/bin/depot and
 *    esbuild/bin/esbuild. So both names are removed, each must start with
 *    ELF's magic before it is, the build fails if any file named depot or
 *    esbuild under node_modules/.pnpm is still an ELF, and the pull request's
 *    `build (trigger, amd64|arm64)` (images.yml) runs that, not Trivy.
 *  - WHICH COPY OF PNPM RUNS FOLLOWS `user:`. Both images end in `USER node`,
 *    and the brief was to delete root's copy as the unused one. But
 *    managed.yml runs trigger-api `user: root` (for its chown of the shared
 *    volume), so HOME is /root, and every pnpm of the webapp's entrypoint runs
 *    root's copy; node's is the unused one there. trigger-supervisor has no
 *    `user:`, so the supervisor is the other way round. Delete the wrong copy
 *    and corepack downloads pnpm, and an unscanned tar with it, from the npm
 *    registry at every start, or the start fails without egress. So each
 *    Dockerfile's removed and kept copies are held to its service's `user:`,
 *    and both services set COREPACK_ENABLE_NETWORK: "0", which makes corepack
 *    refuse to fetch: a mismatch stops the start instead of reaching out.
 *  - A COPY THE SCAN READS IS NOT ALWAYS A COPY THAT RUNS. After the removals
 *    the webapp kept one critical a release fixes: GHSA-cg2g-xh64-v4q7 in
 *    dompurify 3.4.13, fixed in 3.4.17. Trivy reads the package.json under
 *    node_modules, but DOMPurify sanitises in a browser, and a browser runs
 *    the copy the webapp's build bundled, which a package swapped in
 *    node_modules never reaches. So before the webapp's build replaces the
 *    package's files (REPLACED below), it proves its own bundles carry no
 *    DOMPurify and import neither dompurify nor mermaid, and that nothing
 *    links the package but the two requirers read. Then the swap clears the
 *    finding where it is, and changes no code that runs. The swap itself is
 *    proved too: the tarball by the sha512 npm published, the directory before
 *    and after file for file, no other path of the image added, removed or
 *    changed, and both requirers loading the new release by require and by
 *    import.
 *
 * What else is held:
 *  - the Dockerfiles' shape: one FROM, upstream's image by `vX.Y.Z` and index
 *    digest; `ARG TRIGGER_IMAGE_TAG` with no default; `USER root` for the
 *    removing RUN and `USER node` last, as upstream's; FROM, ARG, USER and RUN
 *    only (the name hashes the instruction lines, and the image's
 *    configuration stays upstream's); no `rm -f`, `rm -rf` or `|| true`; and
 *    the proofs in the image (the two packages load without their binary; as
 *    the service's user pnpm starts offline and, without its tar, runs a
 *    command in the package the service's own pnpm runs; as the other user
 *    it does not start), and the check that node-gyp's lib/install.js is the
 *    one file of the copy that requires tar;
 *  - READ AT ONE RELEASE: each removing RUN names the release its reasons
 *    were read in (`read_at`), which must be the FROM's tag, and refuses an
 *    image of another version; and it pins the entrypoint read there by its
 *    SHA-256, since who runs pnpm is decided there. A path that did not move
 *    across releases (depot and esbuild did not, from 4.7.6 to 4.8.1) proves
 *    nothing about the code that reaches it, so a version move is red until
 *    someone reads the reasons again;
 *  - REMOVED below, each path with why nothing runs it, equals what the
 *    Dockerfiles remove: read from their text, and from running their RUN
 *    instructions over a stand-in of the image's tree on both platforms, which
 *    also shows that every check fails before anything is removed when a path
 *    upstream moves is not there;
 *  - REPLACED below equals what the webapp's replacing RUN names (the package,
 *    both versions, the tarball's address and integrity, both trees), and
 *    that RUN checks everything it can before it changes anything and proves
 *    the rest after. Run over the stand-in, with a stand-in registry and the
 *    stand-in's hashes in place of the real ones, it swaps the package and
 *    nothing else; each way upstream or the registry could differ fails it
 *    with nothing changed, and each proof after the swap fails on the change
 *    it is there to see;
 *  - managed.yml: each service is `localhost/<name>:${TRIGGER_IMAGE_TAG:-<pin>}-<hash>`
 *    (the hash as #1717's), built from `./<name>` with the version as its one
 *    argument, never pulled, with COREPACK_ENABLE_NETWORK "0" and no HOME,
 *    COREPACK_HOME or XDG_CACHE_HOME to move corepack's home; and the FROM tag
 *    is the defaults' and the SDK's;
 *  - why each removal is safe stays true: DEPOT_TOKEN stays a third party the
 *    webapp's guard refuses, trigger-api sets no DEPOT_* or ESBUILD_* key, and
 *    its command is the chown and the entrypoint;
 *  - images.yml builds both on both platforms on a pull request, after
 *    checking the base's user, command and entrypoint are the ones the
 *    headers read; its step is run here with a stub docker, and each of its
 *    refusals is seen to stop it. Dependabot reads neither directory:
 *    Trigger.dev moves by `trigger-version.sh pin` only.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { builtTag, dockerfileBase, parseRef, readTriggerPin } from './idp-pin-watch.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const MANAGED = 'deploy/compose/managed.yml';
type Name = 'trigger.dev' | 'supervisor';
const NAMES: readonly Name[] = ['trigger.dev', 'supervisor'];
const SERVICE: Readonly<Record<Name, string>> = { 'trigger.dev': 'trigger-api', supervisor: 'trigger-supervisor' };
const dockerfileOf = (name: Name) => `deploy/compose/${name}/Dockerfile`;
/** The platforms the box (arm64) and GitHub's runners (amd64) build, as Node names them. */
const PLATFORMS = ['linux-arm64', 'linux-x64'] as const;

interface Removal {
  /** The path in the image; `$plat` is `linux-arm64` or `linux-x64`. */
  readonly path: string;
  /** Why no process of this stack ever runs it. */
  readonly why: string;
  /** Where that was read. */
  readonly evidence: string;
}

const PNPM = '/triggerdotdev/node_modules/.pnpm';

/** What each Dockerfile removes, and why. Must equal what its RUN removes. */
const REMOVED: Readonly<Record<Name, readonly Removal[]>> = {
  'trigger.dev': [
    {
      path: `${PNPM}/@depot+cli-$plat@0.0.1-cli.2.80.0/node_modules/@depot/cli-$plat/bin/depot`,
      why: "depot's Go binary: the webapp runs it only for `depot push`, with DEPOT_TOKEN and DEPOT_ORG_ID set (DEPOT_REGION has a default), neither of which trigger-api has",
      evidence: 'finalizeDeploymentV2.server.ts and remoteImageBuilder.server.ts at v4.8.1; @depot/cli lib/main.js (depot, depotBinaryPath, generateBinPath)',
    },
    {
      path: `${PNPM}/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli/bin/depot`,
      why: "the same binary under its second name: @depot/cli's postinstall hard-links it over its JavaScript shim, and Trivy does not read hard links",
      evidence: '@depot/cli install.js (maybeOptimizePackage); trivy v0.76.1 pkg/fanal/walker/tar.go',
    },
    {
      path: `${PNPM}/@esbuild+$plat@0.23.0/node_modules/@esbuild/$plat/bin/esbuild`,
      why: "esbuild's Go binary, spawned only by a build, transform or context call; it is installed for the trigger.dev CLI, which nothing in the image runs",
      evidence: 'esbuild 0.23.0 lib/main.js (ensureServiceIsRunning); packages/cli-v3 and internal-packages/dashboard-agent package.json at v4.8.1',
    },
    {
      path: `${PNPM}/esbuild@0.23.0/node_modules/esbuild/bin/esbuild`,
      why: "the same binary under its second name: esbuild's postinstall hard-links it over its JavaScript shim, and Trivy does not read hard links",
      evidence: 'esbuild 0.23.0 install.js (maybeOptimizePackage); trivy v0.76.1 pkg/fanal/walker/tar.go',
    },
    {
      path: '/root/.cache/node/corepack/v1/pnpm/10.33.2/dist/node_modules/tar',
      why: "tar 7.5.13 in the copy of pnpm trigger-api runs: only pnpm's bundled node-gyp requires it (to unpack Node's headers for a native build), and the entrypoint's pnpm runs three migration scripts and installs nothing (the owner, 2026-10-27)",
      evidence: 'pnpm 10.33.2 dist: require(\'tar\') only in node_modules/node-gyp/lib/install.js, none in pnpm.cjs or worker.js; docker/scripts/entrypoint.sh at v4.8.1; corepack 0.36.0 installVersion reads .corepack only',
    },
    {
      path: '/home/node/.cache/node/corepack/v1/pnpm/10.33.2',
      why: "node's copy of pnpm, with tar 7.5.13 in it: trigger-api runs as root (managed.yml), so every pnpm of the entrypoint runs root's copy",
      evidence: "docker/Dockerfile and docker/scripts/entrypoint.sh at v4.8.1; managed.yml `user: root`; corepack 0.36.0 (Node 24.22.1's) getCorepackHomeFolder and installVersion",
    },
  ],
  supervisor: [
    {
      path: '/root/.cache/node/corepack/v1/pnpm/10.33.2',
      why: "root's copy of pnpm, with tar 7.5.13 in it: trigger-supervisor runs as the image's node (no `user:`), whose copy its CMD runs",
      evidence: "apps/supervisor/Containerfile and entrypoint.sh at v4.8.1; managed.yml (no `user:`); corepack 0.36.0 (Node 24.22.1's) getCorepackHomeFolder and installVersion",
    },
    {
      path: '/home/node/.cache/node/corepack/v1/pnpm/10.33.2/dist/node_modules/tar',
      why: "tar 7.5.13 in the copy of pnpm the supervisor runs: only pnpm's bundled node-gyp requires it (to unpack Node's headers for a native build), and the CMD runs `node dist/index.js` through pnpm and installs nothing (the owner, 2026-10-27)",
      evidence: "pnpm 10.33.2 dist: require('tar') only in node_modules/node-gyp/lib/install.js, none in pnpm.cjs or worker.js; apps/supervisor/package.json's start at v4.8.1; corepack 0.36.0 installVersion reads .corepack only",
    },
  ],
};

interface Replacement {
  /** The package's directory in the image, under pnpm's name for the old version, which it keeps. */
  readonly path: string;
  readonly from: string;
  readonly to: string;
  /** The tarball, and the integrity npm published for it. */
  readonly url: string;
  readonly integrity: string;
  /** When npm published `to` (the three-day floor, CONTRIBUTING.md). */
  readonly published: string;
  /** Each published tarball's files: the SHA-256 of `sha256sum` over them, sorted by path (the RUN's `tree`). */
  readonly fromTree: string;
  readonly toTree: string;
  /** The packages that require it, each a directory that links it. */
  readonly requirers: readonly string[];
  /** Why the swap changes no code that runs. */
  readonly why: string;
  readonly evidence: string;
}

/** What each Dockerfile replaces, and why. Must equal what its replacing RUN names. */
const REPLACED: Readonly<Record<Name, readonly Replacement[]>> = {
  'trigger.dev': [
    {
      path: `${PNPM}/dompurify@3.4.13/node_modules/dompurify`,
      from: '3.4.13',
      to: '3.4.17',
      url: 'https://registry.npmjs.org/dompurify/-/dompurify-3.4.17.tgz',
      integrity: 'sha512-B/pSlYVHQ58kqISD/yDjuJ1yfzI34m1gF4lAod2bwSRhiN4K5Cl3H8Af7hqB2PmTL911tdEudnnXn5FnhRoz0w==',
      published: '2026-10-12T12:41:28.880Z',
      fromTree: 'e9c42f84de69a3769f574e05d9a17d919029a5b1bace0609737e9a9b7e9539d5',
      toTree: '595c3084456d2b111dbb14e16bf1462ecff273316170067b0a95a1cc5f0ff809',
      requirers: [`${PNPM}/posthog-js@1.407.3/node_modules/posthog-js`, `${PNPM}/mermaid@11.16.1/node_modules/mermaid`],
      why:
        "GHSA-cg2g-xh64-v4q7 (critical) and GHSA-mrv2-3pqr-j5jr (high) in 3.4.13, both fixed in 3.4.17; nothing here loads it: posthog-js's entry points carry no DOMPurify, and streamdown 2.5.0 imports no mermaid without the @streamdown/mermaid plugin, which the webapp does not install",
      evidence:
        "npm's advisories for dompurify; the 3.4.13 and 3.4.17 tarballs (the same 24 file names, entry points and exports; package.json differs only in its version, scripts and devDependencies; the type declarations in one import's order, and the CJS ones drop `export { _default as default }`); upstream's pnpm-lock.yaml, app/hooks/usePostHog.ts and app/components/code/StreamdownRenderer.tsx at v4.8.1; posthog-js 1.407.3 dist/main.js, dist/module.js and lib/src/extensions/product-tours; streamdown 2.5.0 dist",
    },
  ],
  supervisor: [],
};

/** The image's own user, where corepack keeps the copy each service runs. */
const HOME_OF: Readonly<Record<string, string>> = { root: '/root', node: '/home/node' };
/** The script each image starts through, which decides who runs pnpm; pinned by hash in the removing RUN. */
const ENTRYPOINT: Readonly<Record<Name, string>> = { 'trigger.dev': '/triggerdotdev/scripts/entrypoint.sh', supervisor: '/app/entrypoint.sh' };
const COPY = (home: string) => `${home}/.cache/node/corepack/v1/pnpm/10.33.2`;

// ---------------------------------------------------------------------------
// The Dockerfiles, read as the builder reads them.

interface Instruction {
  readonly keyword: string;
  readonly args: string;
  /** The USER in force when it runs. */
  readonly user: string;
}

/** Instructions in order, continuation lines joined and comment lines inside them dropped, as Docker does. */
function instructions(text: string): Instruction[] {
  const out: Instruction[] = [];
  let user = 'root';
  let current: string | null = null;
  const push = (line: string) => {
    const m = /^\s*([A-Za-z]+)\s+([\s\S]*)$/.exec(line);
    if (!m) return;
    const keyword = m[1]!.toUpperCase();
    out.push({ keyword, args: m[2]!.trim(), user });
    if (keyword === 'USER') user = m[2]!.trim();
  };
  for (const line of text.split('\n')) {
    if (current !== null) {
      if (/^\s*#/.test(line)) continue;
      if (line.endsWith('\\')) current += `${line.slice(0, -1)}\n`;
      else {
        push(current + line);
        current = null;
      }
      continue;
    }
    if (/^\s*(#|$)/.test(line)) continue;
    if (line.endsWith('\\')) current = `${line.slice(0, -1)}\n`;
    else push(line);
  }
  return out;
}

const runs = (text: string) => instructions(text).filter((i) => i.keyword === 'RUN');
/** The RUN that removes: the one that runs `rm`. */
const removingRun = (text: string) => runs(text).find((r) => /(^|[;\s])rm\s/.test(r.args));

/** `name=value` assignments of a RUN, quotes taken off. */
function assignments(run: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const m of run.matchAll(/(?:^|[;\s])([a-z_][a-z0-9_]*)=("([^"]*)"|[^\s;]+)/g)) vars.set(m[1]!, m[3] ?? m[2]!);
  return vars;
}

/** What a RUN's `rm` and `rm -r` name, with `$s` and every other variable but `$plat` resolved. */
function rmTargets(run: string): string[] {
  const vars = assignments(run);
  const resolve = (value: string): string =>
    value.replace(/\$\{?([a-z_][a-z0-9_]*)\}?/g, (all, name: string) => (name === 'plat' ? '$plat' : vars.has(name) ? resolve(vars.get(name)!) : all));
  const targets: string[] = [];
  for (const m of run.matchAll(/(?:^|[;\s])rm(?:\s+-r)?((?:\s+"\$[a-z_][a-z0-9_]*")+)\s*;/g)) {
    for (const v of m[1]!.matchAll(/"\$([a-z_][a-z0-9_]*)"/g)) targets.push(resolve(`$${v[1]}`));
  }
  return targets;
}

/** What is wrong with a Dockerfile's shape, in words; empty when it holds. */
function shapeProblems(name: Name, text: string): string[] {
  const problems: string[] = [];
  try {
    const base = dockerfileBase(text);
    if (base.repo !== `ghcr.io/triggerdotdev/${name}`) problems.push(`it builds on ${base.repo}, not ghcr.io/triggerdotdev/${name}`);
    if (!/^v\d+\.\d+\.\d+$/.test(base.tag)) problems.push(`its FROM tag is ${base.tag}, not a release (vX.Y.Z)`);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  for (const line of text.split('\n')) {
    if (!/^\s*#\s*[a-z][a-z0-9]*\s*=/i.test(line)) break;
    problems.push(`\`${line}\` is a parser directive: it changes the build, and the name hashes it as a comment`);
  }
  const all = instructions(text);
  for (const i of all) {
    if (!['FROM', 'ARG', 'USER', 'RUN'].includes(i.keyword)) {
      problems.push(`${i.keyword} ${i.args.split('\n')[0]}: only FROM, ARG, USER and RUN, so the name hashes all that is built and the configuration stays upstream's`);
    }
    if (/--mount\b/.test(i.args)) problems.push(`${i.keyword} uses --mount, which reads what the name does not hash`);
  }
  const args = all.filter((i) => i.keyword === 'ARG').map((i) => i.args);
  if (args.length !== 1 || args[0] !== 'TRIGGER_IMAGE_TAG') problems.push(`its ARGs are ${JSON.stringify(args)}, not one \`ARG TRIGGER_IMAGE_TAG\` with no default`);
  const users = all.filter((i) => i.keyword === 'USER').map((i) => i.args);
  if (users.at(-1) !== 'node') problems.push(`its last USER is ${users.at(-1) ?? 'none'}, not upstream's node`);
  const removing = removingRun(text);
  if (!removing) problems.push('no RUN removes anything');
  else if (removing.user !== 'root') problems.push(`the removing RUN runs as ${removing.user}, not root`);
  // Read at one release: the FROM's, and the build refuses any other.
  const vars = assignments(removing?.args ?? '');
  const readAt = vars.get('read_at');
  let fromTag: string | null = null;
  try {
    fromTag = dockerfileBase(text).tag;
  } catch {
    // Said above.
  }
  if (!readAt) problems.push('the removing RUN names no read_at, the release its reasons were read in');
  else if (fromTag !== null && readAt !== fromTag) {
    problems.push(`read_at is ${readAt}, and the FROM is ${fromTag}: read the header's reasons again at ${fromTag}, then move read_at (trigger-version.sh pin leaves it)`);
  }
  const removingArgs = removing?.args ?? '';
  if (!/\[ "\$core" = "\$read_at" \] \|\| fail /.test(removingArgs) || removingArgs.indexOf('"$read_at" ]') > removingArgs.search(/(^|[;\s])rm\s/)) {
    problems.push('the removing RUN does not refuse an image of another version than read_at before it removes anything');
  }
  if (vars.get('entrypoint') !== ENTRYPOINT[name] || !/^[0-9a-f]{64}$/.test(vars.get('entrypoint_sha256') ?? '')) {
    problems.push(`the removing RUN does not pin ${ENTRYPOINT[name]} by its SHA-256 (entrypoint=, entrypoint_sha256=): who runs pnpm is decided there`);
  } else if (!/\[ "\$\(sha256sum "\$entrypoint" \| cut -d' ' -f1\)" = "\$entrypoint_sha256" \] \|\| fail /.test(removingArgs)) {
    problems.push('the removing RUN names the entrypoint and its hash, and never compares them');
  }
  for (const run of runs(text)) {
    if (!/^set -eu;/.test(run.args)) problems.push('a RUN does not start with `set -eu;`');
    if (/\brm\s+-\w*f/.test(run.args)) problems.push('a RUN removes with `rm -f` or `rm -rf`, which passes over a path that is not there');
    if (/\|\|\s*true\b/.test(run.args)) problems.push('a RUN has `|| true`, which turns a failure into nothing');
  }
  // The proofs in the image count only after the removal: one run while tar is
  // still there proves nothing (the review of 2026-10-27). So each user's text
  // is the removing RUN from its last `rm` on, and every RUN after it.
  const all_ = runs(text);
  const at = all_.findIndex((r) => /(^|[;\s])rm\s/.test(r.args));
  /** Where the RUN's last `rm` starts: the proofs come after every removal. */
  const lastRm = (args: string) => Math.max(0, ...[...args.matchAll(/(^|[;\s])rm\s/g)].map((m) => m.index!));
  const after = at < 0 ? [] : all_.slice(at).map((r, i) => ({ user: r.user, args: i === 0 ? r.args.slice(lastRm(r.args)) : r.args }));
  const root = after.filter((r) => r.user === 'root').map((r) => r.args).join('\n');
  const node = after.filter((r) => r.user === 'node').map((r) => r.args).join('\n');
  /** All of root's RUNs: the ELF check belongs before the removal. */
  const rootAll = all_.filter((r) => r.user === 'root').map((r) => r.args).join('\n');
  const asUser = (body: string) => /COREPACK_ENABLE_NETWORK=0 pnpm --version\)" = 10\.33\.2 \]/.test(body);
  /** pnpm, without its tar, runs a command in the package the service's own pnpm runs, offline. */
  const runsWithoutTar = (body: string, filter: string) =>
    new RegExp(`\\(cd \\S+ && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter ${filter.replace(/[.@/]/g, '\\$&')} exec node -e 0\\) \\|\\|`).test(body);
  if (!/users="\$\(find "\$kept\/dist" -path "\$kept_tar" -prune/.test(removing?.args ?? '') || !/\[ "\$users" = "\$kept\/dist\/node_modules\/node-gyp\/lib\/install\.js" \] \|\| fail /.test(removing?.args ?? '')) {
    problems.push("no check that node-gyp's lib/install.js is the one file of the kept copy that requires tar");
  }
  const refused = (body: string) => /if \(cd \S+ && COREPACK_ENABLE_NETWORK=0 pnpm --version\) >\/dev\/null 2>&1; then/.test(body);
  if (name === 'trigger.dev') {
    if (!asUser(root)) problems.push('no proof that pnpm starts offline as root, the user trigger-api runs as');
    if (!runsWithoutTar(root, '@trigger.dev/database')) problems.push('no proof that, without its tar, pnpm runs a command in @trigger.dev/database offline as root, the user trigger-api runs as');
    if (!refused(node)) problems.push('no proof that as node pnpm refuses to start offline');
    if (!/node -e "require\('\$s\/@depot\+cli@[^']+\/node_modules\/@depot\/cli'\); require\('\$s\/esbuild@[^']+\/node_modules\/esbuild'\)"/.test(root)) {
      problems.push('no proof that @depot/cli and esbuild still load without their binary');
    }
    if (!/7f454c46/.test(rootAll) || !/stat -c/.test(rootAll)) problems.push('no check that each name is an ELF binary, and no link count in the log');
  } else {
    if (!asUser(node)) problems.push('no proof that pnpm starts offline as node, the user trigger-supervisor runs as');
    if (!runsWithoutTar(node, 'supervisor')) problems.push('no proof that, without its tar, pnpm runs a command in the supervisor offline as node, the user trigger-supervisor runs as');
    if (!refused(root)) problems.push('no proof that as root pnpm refuses to start offline');
  }
  return problems;
}

/** The RUN that replaces a package: the one that names a tarball's `integrity=`. */
const replacingRuns = (text: string) => runs(text).filter((r) => /(^|[;\s])integrity=/.test(r.args));

/**
 * What is wrong with a replacing RUN, in words; empty when it holds. Every
 * check that can come before the swap does, and the proofs come after it.
 */
function replacementProblems(text: string): string[] {
  const problems: string[] = [];
  const ins = instructions(text);
  const all = ins.filter((i) => i.keyword === 'RUN');
  const replacing = all.filter((r) => /(^|[;\s])integrity=/.test(r.args));
  if (replacing.length !== 1) return [`${replacing.length} RUNs name a tarball's integrity, not one`];
  const run = replacing[0]!;
  const args = run.args;
  if (run.user !== 'root') problems.push(`the replacing RUN runs as ${run.user}, not root`);
  const removing = all.findIndex((r) => /(^|[;\s])rm\s/.test(r.args));
  if (removing >= 0 && all.indexOf(run) <= removing) problems.push('the replacing RUN comes before the removing RUN');
  if (!ins.slice(ins.indexOf(run) + 1).some((i) => i.keyword === 'USER' && i.args === 'node')) {
    problems.push("the replacing RUN is not followed by upstream's USER node");
  }
  const vars = assignments(args);
  for (const [k, re] of [
    ['from', /^\d+\.\d+\.\d+$/],
    ['to', /^\d+\.\d+\.\d+$/],
    ['from_tree', /^[0-9a-f]{64}$/],
    ['to_tree', /^[0-9a-f]{64}$/],
    ['integrity', /^sha512-[A-Za-z0-9+/]{86}==$/],
    ['url', /^https:\/\/registry\.npmjs\.org\/[a-z0-9.-]+\/-\/[a-z0-9.-]+-\d+\.\d+\.\d+\.tgz$/],
  ] as const) {
    if (!re.test(vars.get(k) ?? '')) problems.push(`the replacing RUN's ${k}= is ${vars.get(k) ?? 'not there'}, not a ${String(re)}`);
  }
  /** Where a check stands in the RUN, or -1. */
  const at = (re: RegExp) => args.search(re);
  const swap = at(/(^|[;\s])rm -r "\$pkg";/);
  const moved = at(/(^|[;\s])mv "\$new" "\$pkg";/);
  if (swap < 0 || moved < swap) problems.push('the replacing RUN does not swap the directory with `rm -r "$pkg"` and then `mv "$new" "$pkg"`');
  const before: ReadonlyArray<[RegExp, string]> = [
    [/\[ "\$\(version "\$pkg"\)" = "\$from" \] \|\| fail /, "the old directory's version"],
    [/\[ "\$\(tree "\$pkg"\)" = "\$from_tree" \] \|\| /, 'the old directory, file for file (from_tree)'],
    [/\[ "\$links" = "[^"]+" \] \|\| fail /, 'which packages link it'],
    [/\[ "\$\(readlink -f "\$l"\)" = "\$\(readlink -f "\$pkg"\)" \]/, 'that each link leads to it'],
    [/\[ "\$copies" = "\$pkg\/package\.json" \] \|\| fail /, 'that no other copy of its package.json is in the image'],
    [/grep -rlF data-tt-policy-suffix "\$webapp\/build" "\$webapp\/public"/, "that the webapp's own build carries no DOMPurify"],
    [/grep -rlE "\(from\|import\\\(\|require\\\(\)[^\n]*\(dompurify\|mermaid\)[^\n]*"\$webapp\/build"/, "that the webapp's own build imports neither dompurify nor mermaid"],
    [/before="\$\(paths\)"/, 'the paths of the image before'],
    [/\[ "\$got" = "\$integrity" \] \|\| fail /, "the tarball's sha512, against the integrity npm published"],
    [/\[ "\$\(version "\$new"\)" = "\$to" \] \|\| fail /, "the new directory's version"],
    [/\[ "\$\(tree "\$new"\)" = "\$to_tree" \]/, 'the new directory, file for file (to_tree)'],
  ];
  for (const [re, what] of before) {
    const i = at(re);
    if (i < 0) problems.push(`the replacing RUN does not check ${what}`);
    else if (swap >= 0 && i > swap) problems.push(`the replacing RUN checks ${what} only after it has removed the old directory`);
  }
  const fetched = at(/node -e "fetch\(/);
  const marked = at(/: > "\$marker";/);
  if (marked < 0 || at(/before="\$\(paths\)"/) < marked || fetched < at(/before="\$\(paths\)"/)) {
    problems.push('the replacing RUN does not set its marker and read the paths of the image before it fetches');
  }
  const after: ReadonlyArray<[RegExp, string]> = [
    [/\[ "\$\(version "\$pkg"\)" = "\$to" \] && \[ "\$\(tree "\$pkg"\)" = "\$to_tree" \]/, 'that the directory is the new release, file for file'],
    [/\[ "\$\(paths\)" = "\$before" \] \|\| fail /, 'that no other path was added or removed'],
    [/-cnewer "\$marker" -print\)"; \\?\s*\[ -z "\$changed" \] \|\| fail /, 'that no other file changed since the marker'],
    [/require\.resolve\('dompurify'\)[^\n]*\|\| fail /, "that each requirer's require loads the new release from it"],
    [/import\.meta\.resolve\('dompurify'\)[^\n]*\|\| fail /, "that each requirer's import loads the new release from it"],
  ];
  for (const [re, what] of after) {
    const i = at(re);
    if (i < 0) problems.push(`the replacing RUN does not prove ${what}`);
    else if (i < moved) problems.push(`the replacing RUN proves ${what} before the swap, which proves nothing`);
  }
  if (!/for d in "\$posthog" "\$mermaid"; do \\?\s*\(cd "\$d" && node /.test(args)) problems.push("the replacing RUN does not run its load proofs from each requirer's own directory");
  return problems;
}

// ---------------------------------------------------------------------------
// The RUN instructions, run over a stand-in of the image's tree.

/** One file or directory of the stand-in, by its path in the image. */
interface Tree {
  readonly files: Record<string, string>;
  /** ELF stand-ins: path, and a second name hard-linked to it. */
  readonly binaries: Array<{ path: string; link?: string }>;
  /** Symbolic links, as pnpm makes them: path, and its relative target. */
  readonly links?: ReadonlyArray<{ path: string; target: string }>;
  /** What the stand-in registry serves, by URL; nothing else answers a fetch. */
  readonly registry?: Readonly<Record<string, Buffer>>;
  /** The stand-in's own trees and integrity, which take the real ones' place in the RUN (`build`). */
  readonly standIn?: { readonly fromTree: string; readonly toTree: string; readonly integrity: string };
  /** Commands that stand in for the system's, by name, as shell scripts (`stub`). */
  readonly tools?: Readonly<Record<string, string>>;
}

/** Where a command is on this machine, for a stand-in that hands it what it does not answer itself. */
function systemCommand(name: string): string {
  const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  const path = r.stdout.trim();
  if (r.status !== 0 || !path.startsWith('/')) throw new Error(`${name} is not on this machine's PATH`);
  return path;
}

/**
 * A stand-in for a system command: it writes its arguments to the run's tool
 * log, then answers `when` (a shell `case` pattern over its arguments) with
 * `answer`, and hands anything else to the real command.
 */
const stub = (name: string, when: string, answer: string) =>
  ['#!/bin/sh', `printf '%s %s\\n' ${name} "$*" >> "$TOOL_LOG"`, `case "$*" in ${when}) ${answer} ;; esac`, `exec '${systemCommand(name)}' "$@"`, ''].join('\n');

/**
 * The stand-in's entrypoint. The build compares the real one with the hash the
 * Dockerfile pins, which only the real image carries, so the stand-in's hash
 * takes its place in the RUN (`build`, unless told to keep the pinned one).
 */
const STAND_IN_ENTRYPOINT = '#!/bin/sh\nexec "$@"\n';
const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

const DOMPURIFY = REPLACED['trigger.dev'][0]!;

/**
 * A stand-in of a published dompurify, by path under the tarball's `package/`:
 * the same exports as the real one, each build saying its version. Its CJS
 * build carries DOMPurify's mark, so a check that read node_modules for it
 * rather than the webapp's own build would fail.
 */
function standInDompurify(version: string, es = version, cjs = version): Record<string, string> {
  return {
    'package.json': `${JSON.stringify({
      name: 'dompurify',
      version,
      main: './dist/purify.cjs.js',
      module: './dist/purify.es.mjs',
      exports: { '.': { import: './dist/purify.es.mjs', default: './dist/purify.cjs.js' } },
    })}\n`,
    'dist/purify.cjs.js': `// data-tt-policy-suffix\nmodule.exports = { version: '${cjs}', isSupported: false };\n`,
    'dist/purify.es.mjs': `export default { version: '${es}', isSupported: false };\n`,
  };
}

/**
 * A stand-in of the new release whose package.json sends `require` or
 * `import` to another file of its own, which says the right version: the load
 * proofs must check where it loaded from, not only what it says.
 */
function standInWithEntry(kind: 'require' | 'import'): Record<string, string> {
  const files = standInDompurify(DOMPURIFY.to);
  const pkg = JSON.parse(files['package.json']!) as { main: string; exports: { '.': { import: string; default: string } } };
  if (kind === 'require') {
    pkg.main = './dist/purify.js';
    pkg.exports['.'].default = './dist/purify.js';
    return { ...files, 'package.json': `${JSON.stringify(pkg)}\n`, 'dist/purify.js': `module.exports = { version: '${DOMPURIFY.to}', isSupported: false };\n` };
  }
  pkg.exports['.'].import = './dist/purify.mjs';
  return { ...files, 'package.json': `${JSON.stringify(pkg)}\n`, 'dist/purify.mjs': `export default { version: '${DOMPURIFY.to}', isSupported: false };\n` };
}

/** The RUN's `tree`: `sha256sum` over a package's files, sorted by path, hashed. */
function treeHash(files: Readonly<Record<string, string>>): string {
  const paths = Object.keys(files).map((p) => `./${p}`).sort();
  return sha256(paths.map((p) => `${sha256(files[p.slice(2)]!)}  ${p}\n`).join(''));
}

/** A package's files as npm packs them: a gzipped tar under `package/`, with any symbolic links asked for (path, target). */
function tarball(files: Readonly<Record<string, string>>, links: Readonly<Record<string, string>> = {}): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'stand-in-tarball-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, 'package', path)), { recursive: true });
      writeFileSync(join(dir, 'package', path), text);
    }
    for (const [path, target] of Object.entries(links)) {
      mkdirSync(dirname(join(dir, 'package', path)), { recursive: true });
      symlinkSync(target, join(dir, 'package', path));
    }
    const r = spawnSync('tar', ['-czf', join(dir, 'out.tgz'), '-C', dir, 'package'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`tar could not pack the stand-in: ${r.stderr}`);
    return readFileSync(join(dir, 'out.tgz'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const integrityOf = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
/** The stand-in registry's tarball of the new release, made once, so its integrity holds across builds. */
const STAND_IN_TARBALL = tarball(standInDompurify(DOMPURIFY.to));

/** The replacement's part of the webapp's stand-in tree. */
function dompurifyTree(): Pick<Tree, 'files' | 'links' | 'registry' | 'standIn'> {
  const linkTo = (requirerParent: string) => ({ path: `${requirerParent}/dompurify`, target: `${'../'.repeat(requirerParent === `${PNPM}/node_modules` ? 1 : 2)}dompurify@${DOMPURIFY.from}/node_modules/dompurify` });
  return {
    files: {
      ...Object.fromEntries(Object.entries(standInDompurify(DOMPURIFY.from)).map(([p, t]) => [`${DOMPURIFY.path}/${p}`, t])),
      [`${DOMPURIFY.requirers[0]}/package.json`]: '{"name":"posthog-js","version":"1.407.3","main":"dist/main.js"}\n',
      [`${DOMPURIFY.requirers[1]}/package.json`]: '{"name":"mermaid","version":"11.16.1"}\n',
      // The webapp's build: a browser bundle and the server's, neither with DOMPurify in it.
      '/triggerdotdev/apps/webapp/build/client/assets/entry.client-stand-in.js': 'import { r } from "./root-stand-in.js";\nr();\n',
      '/triggerdotdev/apps/webapp/build/server/index.mjs': 'import posthog from "posthog-js";\nexport const lazy = () => import("streamdown");\nexport default posthog;\n',
      '/triggerdotdev/apps/webapp/public/favicon.ico': 'stand-in\n',
    },
    links: [...DOMPURIFY.requirers.map((r) => linkTo(dirname(r))), linkTo(`${PNPM}/node_modules`)],
    registry: { [DOMPURIFY.url]: STAND_IN_TARBALL },
    standIn: { fromTree: treeHash(standInDompurify(DOMPURIFY.from)), toTree: treeHash(standInDompurify(DOMPURIFY.to)), integrity: integrityOf(STAND_IN_TARBALL) },
  };
}

function treeOf(name: Name, plat: string): Tree {
  const corepack = (home: string): Record<string, string> => ({
    [`${COPY(home)}/.corepack`]: '{"locator":{"name":"pnpm","reference":"10.33.2"}}\n',
    [`${COPY(home)}/dist/node_modules/tar/package.json`]: '{"name":"tar","version":"7.5.13"}\n',
    [`${COPY(home)}/dist/node_modules/tar/index.js`]: "module.exports = require('tar/lib');\n",
    // pnpm 10.33.2's one require('tar'), and its bundle, which names tar-stream and no tar.
    [`${COPY(home)}/dist/node_modules/node-gyp/lib/install.js`]: "'use strict'\n\nconst fs = require('graceful-fs')\nconst tar = require('tar')\n",
    [`${COPY(home)}/dist/pnpm.cjs`]: 'var extract = require("tar-stream").extract;\n',
  });
  if (name === 'supervisor') {
    return {
      files: {
        '/app/package.json': '{"packageManager":"pnpm@10.33.2"}\n',
        '/app/packages/core/package.json': '{"version":"4.8.1"}\n',
        [ENTRYPOINT.supervisor]: STAND_IN_ENTRYPOINT,
        ...corepack('/root'),
        ...corepack('/home/node'),
      },
      binaries: [],
    };
  }
  const pkg = (dir: string): Record<string, string> => ({ [`${dir}/package.json`]: '{"main":"lib/main.js"}\n', [`${dir}/lib/main.js`]: 'module.exports = {};\n' });
  const dompurify = dompurifyTree();
  return {
    ...dompurify,
    files: {
      '/triggerdotdev/package.json': '{"packageManager":"pnpm@10.33.2"}\n',
      '/triggerdotdev/packages/core/package.json': '{"version":"4.8.1"}\n',
      [ENTRYPOINT['trigger.dev']]: STAND_IN_ENTRYPOINT,
      ...pkg(`${PNPM}/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli`),
      ...pkg(`${PNPM}/esbuild@0.23.0/node_modules/esbuild`),
      // pnpm's own shims are scripts, and stay.
      [`${PNPM}/node_modules/.bin/esbuild`]: '#!/bin/sh\nexec node "$@"\n',
      ...corepack('/root'),
      ...corepack('/home/node'),
      ...dompurify.files,
    },
    binaries: [
      {
        path: `${PNPM}/@depot+cli-${plat}@0.0.1-cli.2.80.0/node_modules/@depot/cli-${plat}/bin/depot`,
        link: `${PNPM}/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli/bin/depot`,
      },
      {
        path: `${PNPM}/@esbuild+${plat}@0.23.0/node_modules/@esbuild/${plat}/bin/esbuild`,
        link: `${PNPM}/esbuild@0.23.0/node_modules/esbuild/bin/esbuild`,
      },
    ],
  };
}

/** What corepack does here, as far as these RUNs ask: its copy under HOME, or a refusal offline. */
const PNPM_STUB = [
  '#!/bin/sh',
  'printf \'%s|%s|%s\\n\' "$HOME" "${COREPACK_ENABLE_NETWORK:-}" "$*" >> "$PNPM_LOG"',
  'if [ -f "$HOME/.cache/node/corepack/v1/pnpm/10.33.2/.corepack" ]; then',
  '  case "$1" in --version) echo 10.33.2 ;; esac',
  '  exit 0',
  'fi',
  'if [ "${COREPACK_ENABLE_NETWORK:-1}" = 0 ]; then echo "Usage Error: Network access disabled by the environment" >&2; exit 1; fi',
  'echo "corepack would download pnpm here" >&2',
  'exit 2',
  '',
].join('\n');

interface Run {
  readonly status: number;
  readonly out: string;
  /** Every path left under the stand-in's root, as image paths. */
  readonly left: string[];
  /** Every pnpm the RUNs started: the home it ran under (an image path), COREPACK_ENABLE_NETWORK, and its arguments. */
  readonly pnpm: Array<{ home: string; network: string; args: string }>;
}

interface Sandbox {
  readonly root: string;
  readonly fs: string;
  readonly before: string[];
  readonly standIn?: Tree['standIn'];
}

function walk(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    out.push(full.slice(base.length));
    if (entry.isDirectory()) out.push(...walk(full, base));
  }
  return out.sort();
}

function sandbox(tree: Tree): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'binary-never-runs-'));
  const fs = join(root, 'fs');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const put = (path: string, text: string | Buffer, mode?: number) => {
    mkdirSync(dirname(join(fs, path)), { recursive: true });
    writeFileSync(join(fs, path), text, mode === undefined ? undefined : { mode });
  };
  for (const [path, text] of Object.entries(tree.files)) put(path, text);
  for (const [i, b] of tree.binaries.entries()) {
    put(b.path, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from(`stand-in ${i}\n`)]), 0o755);
    if (b.link) {
      mkdirSync(dirname(join(fs, b.link)), { recursive: true });
      linkSync(join(fs, b.path), join(fs, b.link));
    }
  }
  for (const l of tree.links ?? []) {
    mkdirSync(dirname(join(fs, l.path)), { recursive: true });
    symlinkSync(l.target, join(fs, l.path));
  }
  for (const [url, bytes] of Object.entries(tree.registry ?? {})) {
    const u = new URL(url);
    mkdirSync(dirname(join(root, 'registry', u.hostname, u.pathname)), { recursive: true });
    writeFileSync(join(root, 'registry', u.hostname, u.pathname), bytes);
  }
  // mktemp's directory, inside the sandbox, so a RUN that fails leaves nothing behind.
  mkdirSync(join(root, 'tmp'));
  for (const home of ['/root', '/home/node']) mkdirSync(join(fs, home), { recursive: true });
  writeFileSync(join(bin, 'pnpm'), PNPM_STUB, { mode: 0o755 });
  for (const [name, script] of Object.entries(tree.tools ?? {})) writeFileSync(join(bin, name), script, { mode: 0o755 });
  // Node itself, told the platform it is asked about, and with no network: a
  // fetch is answered from the stand-in registry, or with a 404.
  writeFileSync(
    join(bin, 'preload.cjs'),
    [
      "for (const k of ['platform', 'arch']) { const v = process.env['FAKE_' + k.toUpperCase()]; if (v) Object.defineProperty(process, k, { value: v }); }",
      "globalThis.fetch = async (url) => { const u = new URL(String(url)); const f = require('path').join(process.env.FAKE_REGISTRY || '/nonexistent', u.hostname, u.pathname); return require('fs').existsSync(f) ? new Response(require('fs').readFileSync(f)) : new Response('not in the stand-in registry', { status: 404 }); };",
      '',
    ].join('\n'),
  );
  writeFileSync(join(bin, 'node'), `#!/bin/sh\nexec '${process.execPath}' --require '${join(bin, 'preload.cjs')}' "$@"\n`, { mode: 0o755 });
  return { root, fs, before: walk(fs, fs), standIn: tree.standIn };
}

/** A RUN's script with the image's absolute paths moved under the stand-in's root. */
const rooted = (script: string, fs: string) =>
  script.replace(/(?<=[\s'"=(])\/(triggerdotdev|root|home\/node|app)(?=[/\s'")]|$)/g, `${fs}/$1`);

interface Options {
  readonly plat?: string;
  readonly tag?: string;
  /** Only the RUNs of this user. */
  readonly only?: 'root' | 'node';
  /** Keep the entrypoint hash the Dockerfile pins, which the stand-in's entrypoint is not. */
  readonly pinnedEntrypoint?: boolean;
  /** Keep the trees and integrity the replacing RUN pins, which the stand-in's are not. */
  readonly pinnedReplacement?: boolean;
  /** Only the RUNs this picks. */
  readonly pick?: (run: Instruction) => boolean;
}

/** Runs a Dockerfile's RUN instructions in order, each as its USER, and stops at the first that fails. */
function build(text: string, box: Sandbox, { plat = 'linux-arm64', tag = '', only, pinnedEntrypoint = false, pinnedReplacement = false, pick }: Options = {}): Run {
  const [platform, arch] = plat.split('-') as [string, string];
  let out = '';
  for (const run of runs(text)) {
    if (only && run.user !== only) continue;
    if (pick && !pick(run)) continue;
    let script = pinnedEntrypoint ? run.args : run.args.replace(/(?<=(^|[;\s])entrypoint_sha256=)[0-9a-f]{64}/, sha256(STAND_IN_ENTRYPOINT));
    if (!pinnedReplacement && box.standIn) {
      script = script
        .replace(/(?<=(^|[;\s])from_tree=)[0-9a-f]{64}/, box.standIn.fromTree)
        .replace(/(?<=(^|[;\s])to_tree=)[0-9a-f]{64}/, box.standIn.toTree)
        .replace(/(?<=(^|[;\s])integrity=)sha512-[A-Za-z0-9+/=]+/, box.standIn.integrity);
    }
    // The whole file system the replacement walks is the stand-in's root.
    script = rooted(script, box.fs).replace(/(?<=(^|[;\s])top=)\/;/, `${box.fs};`);
    const r = spawnSync('sh', ['-c', script], {
      encoding: 'utf8',
      env: {
        PATH: `${join(box.root, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        HOME: join(box.fs, HOME_OF[run.user] ?? '/nonexistent'),
        TRIGGER_IMAGE_TAG: tag,
        FAKE_PLATFORM: platform,
        FAKE_ARCH: arch,
        FAKE_REGISTRY: join(box.root, 'registry'),
        TMPDIR: join(box.root, 'tmp'),
        PNPM_LOG: join(box.root, 'pnpm.log'),
        TOOL_LOG: join(box.root, 'tools.log'),
        LANG: 'C',
      },
    });
    out += `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (r.status !== 0) return { status: r.status ?? -1, out, left: walk(box.fs, box.fs), pnpm: pnpmCalls(box) };
  }
  return { status: 0, out, left: walk(box.fs, box.fs), pnpm: pnpmCalls(box) };
}

function pnpmCalls(box: Sandbox): Run['pnpm'] {
  let log: string;
  try {
    log = readFileSync(join(box.root, 'pnpm.log'), 'utf8');
  } catch {
    return [];
  }
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [home = '', network = '', ...args] = line.split('|');
      return { home: home.slice(box.fs.length), network, args: args.join('|') };
    });
}

/** What a run removed: the topmost paths that were there before and are not now. */
function removedBy(box: Sandbox, run: Run): string[] {
  const left = new Set(run.left);
  const gone = box.before.filter((p) => !left.has(p));
  const goneSet = new Set(gone);
  return gone.filter((p) => !goneSet.has(dirname(p))).sort();
}

function withSandbox<T>(tree: Tree, fn: (box: Sandbox) => T): T {
  const box = sandbox(tree);
  try {
    return fn(box);
  } finally {
    rmSync(box.root, { recursive: true, force: true });
  }
}

const expand = (path: string, plat: string) => path.replaceAll('$plat', plat);
const dockerfiles = Object.fromEntries(NAMES.map((n) => [n, read(dockerfileOf(n))])) as Record<Name, string>;

describe('the Dockerfiles delete only what never runs, and fail loudly when upstream moves', () => {
  it('each is upstream image by tag and digest, FROM ARG USER RUN only, root for the removal, node last, with its proofs', () => {
    for (const name of NAMES) expect(shapeProblems(name, dockerfiles[name]), dockerfileOf(name)).toEqual([]);
  });

  it('refuses each way the shape could slip', () => {
    const real = dockerfiles['trigger.dev'];
    const swap = (from: RegExp, to: string) => {
      const text = real.replace(from, to);
      expect(text, `${String(from)} matched nothing`).not.toBe(real);
      return shapeProblems('trigger.dev', text);
    };
    expect(swap(/^(FROM \S+)@sha256:[0-9a-f]{64}$/m, '$1')).toEqual([expect.stringContaining('carries no tag and digest')]);
    expect(swap(/^FROM ghcr\.io\/triggerdotdev\/trigger\.dev:/m, 'FROM ghcr.io/someone/trigger.dev:')).toEqual([expect.stringContaining('not ghcr.io/triggerdotdev/trigger.dev')]);
    expect(swap(/^ARG TRIGGER_IMAGE_TAG$/m, 'ARG TRIGGER_IMAGE_TAG=v4.8.1')).toEqual([expect.stringContaining('not one `ARG TRIGGER_IMAGE_TAG` with no default')]);
    expect(swap(/^USER root$/m, 'USER node')).toContainEqual(expect.stringContaining('the removing RUN runs as node, not root'));
    expect(swap(/\n# Upstream's own user, which this image keeps\.\nUSER node\n/, '\n')).toEqual([
      expect.stringContaining('its last USER is root'),
      // Without it the negative proof runs as root, and is no proof.
      'no proof that as node pnpm refuses to start offline',
    ]);
    expect(swap(/rm -r "\$unused"/, 'rm -rf "$unused"')).toEqual([expect.stringContaining('`rm -f` or `rm -rf`')]);
    expect(swap(/rm -r "\$unused" "\$kept_tar";/, 'rm -r "$unused" "$kept_tar" || true;')).toEqual([expect.stringContaining('`|| true`')]);
    expect(swap(/\s+node -e "require[^\n]*\n/, '\n')).toEqual(['no proof that @depot/cli and esbuild still load without their binary']);
    for (const line of ['ENV COREPACK_HOME=/tmp/corepack', 'COPY pnpm /usr/local/bin/', 'WORKDIR /tmp', 'LABEL x=y', 'CMD ["sh"]']) {
      const text = real.replace(/^(USER root)$/m, `${line}\n$1`);
      expect(shapeProblems('trigger.dev', text), line).toEqual([expect.stringContaining('only FROM, ARG, USER and RUN')]);
    }
    expect(shapeProblems('trigger.dev', `# syntax=docker/dockerfile:1\n${real}`)).toEqual([expect.stringContaining('is a parser directive')]);
    // Read at one release, the FROM's, and refused before anything is removed at any other.
    expect(swap(/^ {4}read_at=v[\d.]+; \\\n/m, '')).toEqual(['the removing RUN names no read_at, the release its reasons were read in']);
    expect(swap(/^( {4}read_at=)v[\d.]+;/m, '$1v4.8.0;')).toEqual([expect.stringContaining('read_at is v4.8.0, and the FROM is v4.8.1')]);
    // What `trigger-version.sh pin` does: the FROM moves, read_at stays, and this says to read again.
    expect(swap(/^(FROM \S+:)v[\d.]+@/m, '$1v4.9.0@')).toEqual([expect.stringContaining('read_at is v4.8.1, and the FROM is v4.9.0: read the header')]);
    expect(swap(/^ {4}\[ "\$core" = "\$read_at" \] \|\| fail [^\n]*\n/m, '')).toEqual([
      'the removing RUN does not refuse an image of another version than read_at before it removes anything',
    ]);
    expect(swap(/^ {4}entrypoint_sha256=[0-9a-f]{64}; \\\n/m, '')).toEqual([expect.stringContaining('does not pin /triggerdotdev/scripts/entrypoint.sh by its SHA-256')]);
    expect(swap(/^ {4}\[ "\$\(sha256sum [^\n]*\n/m, '')).toEqual(['the removing RUN names the entrypoint and its hash, and never compares them']);
    // Tar out of the copy that runs: the check of who requires it, and the proof as root.
    expect(swap(/^ {4}\[ "\$users" = [^\n]*\n/m, '')).toEqual(["no check that node-gyp's lib/install.js is the one file of the kept copy that requires tar"]);
    const proof = /^ {4}\(cd \/triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter @trigger\.dev\/database exec node -e 0\) \|\| fail [^\n]*\n/m;
    const noProof = ['no proof that, without its tar, pnpm runs a command in @trigger.dev/database offline as root, the user trigger-api runs as'];
    expect(swap(proof, '')).toEqual(noProof);
    // The same proof run as node, which has no copy: no proof of the user that runs.
    const line = proof.exec(real)![0];
    const asNode = real.replace(proof, '').replace(/(me=deploy\/compose\/trigger\.dev\/Dockerfile; \\\n)( {4}if \(cd \/triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --version\))/, `$1${line}$2`);
    expect(runs(asNode).filter((r) => r.user === 'node').map((r) => r.args).join('\n')).toContain('--filter @trigger.dev/database exec');
    expect(shapeProblems('trigger.dev', asNode)).toEqual(noProof);
    // A proof moved above the removal, in the same RUN, proves nothing.
    const proofs = /^ {4}\[ "\$\(cd \/triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --version\)" = 10\.33\.2 \] [^\n]*\n {4}\(cd \/triggerdotdev [^\n]*\n/m;
    const both = proofs.exec(real)![0];
    const early = real.replace(proofs, '').replace(/^( {4}rm -r "\$unused" "\$kept_tar"; \\\n)/m, `${both}$1`);
    expect(early).not.toBe(real);
    expect(shapeProblems('trigger.dev', early)).toEqual([
      'no proof that pnpm starts offline as root, the user trigger-api runs as',
      ...noProof,
    ]);
    // The supervisor's proofs go the other way round.
    const sup = dockerfiles.supervisor;
    expect(shapeProblems('supervisor', sup.replace(/\n {4}if \(cd \/app && COREPACK_ENABLE_NETWORK=0[\s\S]*?fi; \\/, ''))).toEqual(['no proof that as root pnpm refuses to start offline']);
    const supProof = /^ {4}\(cd \/app && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter supervisor exec node -e 0\) \|\| [^\n]*\n/m;
    expect(sup.replace(supProof, '')).not.toBe(sup);
    expect(shapeProblems('supervisor', sup.replace(supProof, ''))).toEqual([
      'no proof that, without its tar, pnpm runs a command in the supervisor offline as node, the user trigger-supervisor runs as',
    ]);
  });

  it('REMOVED says why each path never runs, and is exactly what the RUNs name', () => {
    for (const name of NAMES) {
      for (const r of REMOVED[name]) {
        expect(r.why.length, `${r.path}: why`).toBeGreaterThan(60);
        expect(r.evidence.length, `${r.path}: evidence`).toBeGreaterThan(30);
      }
      const run = removingRun(dockerfiles[name]);
      expect(run, `${name} has no removing RUN`).toBeDefined();
      expect(rmTargets(run!.args).sort(), `${dockerfileOf(name)} removes other paths than REMOVED lists`).toEqual(REMOVED[name].map((r) => r.path).sort());
    }
  });

  for (const name of NAMES) {
    for (const plat of name === 'trigger.dev' ? PLATFORMS : (['linux-arm64'] as const)) {
      it(`${name} on ${plat}: removes REMOVED and nothing else, keeps the copy its service runs, and proves both users`, () => {
        withSandbox(treeOf(name, plat), (box) => {
          const run = build(dockerfiles[name], box, { plat, tag: 'v4.8.1' });
          expect(run.status, run.out).toBe(0);
          expect(removedBy(box, run)).toEqual(REMOVED[name].map((r) => expand(r.path, plat)).sort());
          const home = name === 'trigger.dev' ? '/root' : '/home/node';
          const kept = COPY(home);
          expect(run.left).toContain(`${kept}/.corepack`);
          // The copy that runs, without its tar, ran a command offline as the service's user.
          expect(run.left).toContain(`${kept}/dist/node_modules/node-gyp/lib/install.js`);
          const filter = name === 'trigger.dev' ? '@trigger.dev/database' : 'supervisor';
          expect(run.pnpm).toContainEqual({ home, network: '0', args: `--fail-if-no-match --filter ${filter} exec node -e 0` });
          if (name === 'trigger.dev') {
            // Both names of each binary were found linked, and the log says so.
            expect(run.out.match(/^2 link\(s\), inode \d+, \d+ bytes: /gm), run.out).toHaveLength(4);
            expect(run.left).toContain(`${PNPM}/node_modules/.bin/esbuild`);
            // And dompurify's files are the new release's, loaded by both requirers.
            expect(JSON.parse(readFileSync(join(box.fs, DOMPURIFY.path, 'package.json'), 'utf8')).version).toBe(DOMPURIFY.to);
            expect(run.out.match(/^(require|import)\(dompurify\): \S+ 3\.4\.17$/gm), run.out).toHaveLength(4);
          }
        });
      });
    }
  }

  it('an empty TRIGGER_IMAGE_TAG builds; one that is not the image version refuses before anything is removed', () => {
    for (const name of NAMES) {
      withSandbox(treeOf(name, 'linux-x64'), (box) => {
        expect(build(dockerfiles[name], box, { plat: 'linux-x64', tag: '' }).status).toBe(0);
      });
      withSandbox(treeOf(name, 'linux-x64'), (box) => {
        const run = build(dockerfiles[name], box, { plat: 'linux-x64', tag: 'v4.8.2' });
        expect(run.status).not.toBe(0);
        expect(run.out).toContain('the .env names TRIGGER_IMAGE_TAG=v4.8.2, and this checkout builds Trigger.dev v4.8.1');
        expect(removedBy(box, run), name).toEqual([]);
      });
    }
  });

  it('an image of another release than read_at, or another entrypoint than the one read, refuses before anything is removed', () => {
    for (const name of NAMES) {
      const tree = treeOf(name, 'linux-x64');
      const core = name === 'trigger.dev' ? '/triggerdotdev/packages/core/package.json' : '/app/packages/core/package.json';
      // The .env agrees with the image (or names nothing): the release still is not the one read.
      for (const tag of ['', 'v4.8.2']) {
        withSandbox({ ...tree, files: { ...tree.files, [core]: '{"version":"4.8.2"}\n' } }, (box) => {
          const run = build(dockerfiles[name], box, { plat: 'linux-x64', tag });
          expect(run.status, `${name}, TRIGGER_IMAGE_TAG=${tag}`).not.toBe(0);
          expect(run.out).toContain(`was read in Trigger.dev v4.8.1's source, and this image is v4.8.2`);
          expect(run.out).toContain('then move read_at');
          expect(removedBy(box, run), name).toEqual([]);
        });
      }
      // The pinned hash, which the stand-in's entrypoint is not: a changed entrypoint.
      withSandbox(tree, (box) => {
        const run = build(dockerfiles[name], box, { plat: 'linux-x64', pinnedEntrypoint: true });
        expect(run.status, name).not.toBe(0);
        expect(run.out).toContain(`${box.fs}${ENTRYPOINT[name]} is not the one read at v4.8.1`);
        expect(removedBy(box, run), name).toEqual([]);
      });
    }
  });

  it('every path it removes or keeps that is not there fails the build by name, before anything is removed', () => {
    const plat = 'linux-arm64';
    /** Each file of the stand-in the build reads, and what its failure names. */
    const NEEDED: Readonly<Record<Name, ReadonlyArray<[string, string]>>> = {
      'trigger.dev': [
        ...treeOf('trigger.dev', plat).binaries.flatMap((b) => [b.path, b.link!]).map((p): [string, string] => [p, p]),
        ['/triggerdotdev/package.json', '/triggerdotdev/package.json'],
        ['/triggerdotdev/packages/core/package.json', '/triggerdotdev/packages/core/package.json'],
        [ENTRYPOINT['trigger.dev'], ENTRYPOINT['trigger.dev']],
        [`${COPY('/home/node')}/.corepack`, `${COPY('/home/node')}/.corepack`],
        [`${COPY('/home/node')}/dist/node_modules/tar`, `${COPY('/home/node')}/dist/node_modules/tar`],
        [`${COPY('/root')}/.corepack`, `${COPY('/root')}/.corepack`],
        [`${COPY('/root')}/dist/node_modules/tar`, `${COPY('/root')}/dist/node_modules/tar`],
        [`${COPY('/root')}/dist/node_modules/node-gyp/lib/install.js`, `${COPY('/root')}/dist, tar is required by: nothing`],
      ],
      supervisor: [
        ['/app/package.json', '/app/package.json'],
        ['/app/packages/core/package.json', '/app/packages/core/package.json'],
        [ENTRYPOINT.supervisor, ENTRYPOINT.supervisor],
        [`${COPY('/root')}/.corepack`, `${COPY('/root')}/.corepack`],
        [`${COPY('/root')}/dist/node_modules/tar`, `${COPY('/root')}/dist/node_modules/tar`],
        [`${COPY('/home/node')}/.corepack`, `${COPY('/home/node')}/.corepack`],
        [`${COPY('/home/node')}/dist/node_modules/tar`, `${COPY('/home/node')}/dist/node_modules/tar`],
        [`${COPY('/home/node')}/dist/node_modules/node-gyp/lib/install.js`, `${COPY('/home/node')}/dist, tar is required by: nothing`],
      ],
    };
    for (const name of NAMES) {
      const tree = treeOf(name, plat);
      for (const [path, named] of NEEDED[name]) {
        const without: Tree = {
          // A file, or a directory with all that is in it.
          files: Object.fromEntries(Object.entries(tree.files).filter(([p]) => p !== path && !p.startsWith(`${path}/`))),
          binaries: tree.binaries.filter((b) => b.path !== path).map((b) => (b.link === path ? { path: b.path } : b)),
        };
        expect(JSON.stringify(without), `${path} is not in the stand-in`).not.toBe(JSON.stringify(tree));
        withSandbox(without, (box) => {
          const run = build(dockerfiles[name], box, { plat, tag: 'v4.8.1' });
          expect(run.status, `${name} built without ${path}`).not.toBe(0);
          expect(run.out, `${name} without ${path} did not say which`).toContain(`${box.fs}${named}`);
          expect(removedBy(box, run), `${name} removed something before it failed without ${path}`).toEqual([]);
        });
      }
    }
  });

  it('a second name that is no ELF binary, another pnpm, an unknown platform or a binary left elsewhere fails it', () => {
    const plat = 'linux-x64';
    const base = treeOf('trigger.dev', plat);
    // The postinstall did not link: the shim is still JavaScript.
    const shim: Tree = {
      files: { ...base.files, [base.binaries[1]!.link!]: '#!/usr/bin/env node\nrequire("../lib/main.js");\n' },
      binaries: [base.binaries[0]!, { path: base.binaries[1]!.path }],
    };
    withSandbox(shim, (box) => {
      const run = build(dockerfiles['trigger.dev'], box, { plat });
      expect(run.status).not.toBe(0);
      expect(run.out).toMatch(/esbuild is no ELF binary \(it starts 23212f75\)/);
      expect(removedBy(box, run)).toEqual([]);
    });
    for (const name of NAMES) {
      const at = name === 'trigger.dev' ? '/triggerdotdev/package.json' : '/app/package.json';
      const tree = treeOf(name, plat);
      withSandbox({ ...tree, files: { ...tree.files, [at]: '{"packageManager":"pnpm@10.34.8"}\n' } }, (box) => {
        const run = build(dockerfiles[name], box, { plat });
        expect(run.status).not.toBe(0);
        expect(run.out).toContain('the image names pnpm@10.34.8, not pnpm@10.33.2');
        expect(run.out).toContain("re-read this file's header against the new tag, or drop the removal upstream fixed");
        expect(removedBy(box, run)).toEqual([]);
      });
    }
    withSandbox(treeOf('trigger.dev', 'linux-riscv64'), (box) => {
      const run = build(dockerfiles['trigger.dev'], box, { plat: 'linux-riscv64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('this is linux-riscv64; the paths below are known for linux-arm64 and linux-x64');
    });
    // Another esbuild's binary, which REMOVED does not name: the build stops rather than ship it.
    const other = `${PNPM}/esbuild@0.25.12/node_modules/esbuild/bin/esbuild`;
    withSandbox({ ...base, binaries: [...base.binaries, { path: other }] }, (box) => {
      const run = build(dockerfiles['trigger.dev'], box, { plat });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`a depot or esbuild binary is still there: ${box.fs}${other}`);
    });
  });

  it("tar required by another file of the copy that runs than node-gyp's install.js fails it, before anything is removed", () => {
    for (const name of NAMES) {
      const tree = treeOf(name, 'linux-arm64');
      const worker = `${COPY(name === 'trigger.dev' ? '/root' : '/home/node')}/dist/worker.js`;
      withSandbox({ ...tree, files: { ...tree.files, [worker]: 'const tar = require("tar");\n' } }, (box) => {
        const run = build(dockerfiles[name], box, { tag: 'v4.8.1' });
        expect(run.status, name).not.toBe(0);
        expect(run.out).toContain(`${box.fs}${worker}`);
        expect(run.out).toContain("not by node-gyp's lib/install.js alone");
        expect(removedBy(box, run), name).toEqual([]);
      });
    }
  });

  it("the proof as the other user fails while that user's copy is there: a start as it would reach for the registry", () => {
    // The webapp's node RUN, on an image whose root RUN removed nothing.
    withSandbox(treeOf('trigger.dev', 'linux-arm64'), (box) => {
      const run = build(dockerfiles['trigger.dev'], box, { only: 'node' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('as node, pnpm still starts offline');
    });
    // The supervisor's node RUN, on an image without node's copy.
    const tree = treeOf('supervisor', 'linux-arm64');
    const files = Object.fromEntries(Object.entries(tree.files).filter(([p]) => !p.startsWith(COPY('/home/node'))));
    withSandbox({ files, binaries: [] }, (box) => {
      const run = build(dockerfiles.supervisor, box, { only: 'node' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('as node, the user trigger-supervisor runs as, pnpm 10.33.2 does not start offline');
    });
  });
});

// ---------------------------------------------------------------------------
// The webapp's replacement: dompurify 3.4.13's files by 3.4.17's.

/** A RUN's assignments, each with every variable it names resolved. */
function resolvedAssignments(run: string): Map<string, string> {
  const vars = assignments(run);
  const resolve = (value: string): string => value.replace(/\$\{?([a-z_][a-z0-9_]*)\}?/g, (all, name: string) => (vars.has(name) ? resolve(vars.get(name)!) : all));
  return new Map([...vars].map(([k, v]) => [k, resolve(v)]));
}

/** Every entry under the stand-in's root: a file's SHA-256, a link's target, or a directory. */
function snapshot(box: Sandbox): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const path = full.slice(box.fs.length);
      if (entry.isSymbolicLink()) out.set(path, `-> ${readlinkSync(full)}`);
      else if (entry.isDirectory()) {
        out.set(path, 'directory');
        visit(full);
      } else out.set(path, sha256(readFileSync(full)));
    }
  };
  visit(box.fs);
  return out;
}

/** A snapshot without one directory and what is in it. */
const without = (snap: Map<string, string>, dir: string) => new Map([...snap].filter(([p]) => p !== dir && !p.startsWith(`${dir}/`)));
const replacingOnly = { pick: (run: Instruction) => /(^|[;\s])integrity=/.test(run.args) };

describe("the webapp's build replaces dompurify's files with the release that fixes it, and nothing else", () => {
  const webapp = dockerfiles['trigger.dev'];

  it('REPLACED is exactly what the replacing RUN names, and each one is past its floor', () => {
    for (const name of NAMES) {
      const found = replacingRuns(dockerfiles[name]);
      expect(found.length, name).toBe(REPLACED[name].length);
      for (const [i, r] of REPLACED[name].entries()) {
        const vars = resolvedAssignments(found[i]!.args);
        const pkgName = r.path.split('/').at(-1)!;
        expect(vars.get('pkg'), name).toBe(r.path);
        expect(r.path.endsWith(`/${pkgName}@${r.from}/node_modules/${pkgName}`), r.path).toBe(true);
        expect([vars.get('from'), vars.get('to')]).toEqual([r.from, r.to]);
        expect(vars.get('url')).toBe(`https://registry.npmjs.org/${pkgName}/-/${pkgName}-${r.to}.tgz`);
        expect(r.url).toBe(vars.get('url'));
        expect(vars.get('integrity')).toBe(r.integrity);
        expect([vars.get('from_tree'), vars.get('to_tree')]).toEqual([r.fromTree, r.toTree]);
        expect([vars.get('posthog'), vars.get('mermaid')]).toEqual(r.requirers);
        expect(r.why.length).toBeGreaterThan(60);
        expect(r.evidence.length).toBeGreaterThan(30);
        // Three days old when it was taken, 2026-10-30 (CONTRIBUTING.md).
        expect(Date.parse('2026-10-30T00:00:00Z') - Date.parse(r.published)).toBeGreaterThan(3 * 24 * 3600 * 1000);
      }
    }
  });

  it('checks all it can before the swap and proves the rest after it, as root, before upstream’s USER node', () => {
    expect(replacementProblems(webapp)).toEqual([]);
    expect(shapeProblems('trigger.dev', webapp)).toEqual([]);
  });

  it('refuses each way the replacing RUN could slip', () => {
    /** The text with the one line `re` names taken out. */
    const drop = (re: RegExp) => {
      const lines = webapp.split('\n');
      const i = lines.findIndex((l) => re.test(l));
      expect(i, `${String(re)} matched no line`).toBeGreaterThanOrEqual(0);
      return replacementProblems([...lines.slice(0, i), ...lines.slice(i + 1)].join('\n'));
    };
    /** The text with the line `re` names moved to just after the line `to` names. */
    const move = (re: RegExp, to: RegExp) => {
      const lines = webapp.split('\n');
      const i = lines.findIndex((l) => re.test(l));
      expect(i, `${String(re)} matched no line`).toBeGreaterThanOrEqual(0);
      const line = lines[i]!;
      const rest = [...lines.slice(0, i), ...lines.slice(i + 1)];
      const j = rest.findIndex((l) => to.test(l));
      expect(j, `${String(to)} matched no line`).toBeGreaterThanOrEqual(0);
      return replacementProblems([...rest.slice(0, j + 1), line, ...rest.slice(j + 1)].join('\n'));
    };
    expect(drop(/\[ "\$got" = "\$integrity" \]/)).toEqual(["the replacing RUN does not check the tarball's sha512, against the integrity npm published"]);
    expect(drop(/\[ "\$\(tree "\$pkg"\)" = "\$from_tree" \]/)).toEqual(['the replacing RUN does not check the old directory, file for file (from_tree)']);
    expect(drop(/\[ "\$links" = /)).toEqual(['the replacing RUN does not check which packages link it']);
    expect(drop(/readlink -f "\$l"/)).toEqual(['the replacing RUN does not check that each link leads to it']);
    expect(drop(/\[ "\$copies" = /)).toEqual(['the replacing RUN does not check that no other copy of its package.json is in the image']);
    expect(drop(/grep -rlF data-tt-policy-suffix/)).toEqual(["the replacing RUN does not check that the webapp's own build carries no DOMPurify"]);
    expect(drop(/grep -rlE /)).toEqual(["the replacing RUN does not check that the webapp's own build imports neither dompurify nor mermaid"]);
    expect(drop(/\[ "\$\(version "\$new"\)" = "\$to" \]/)).toEqual(["the replacing RUN does not check the new directory's version"]);
    expect(drop(/\[ "\$\(tree "\$new"\)" = "\$to_tree" \]/)).toEqual(['the replacing RUN does not check the new directory, file for file (to_tree)']);
    expect(drop(/\[ "\$\(paths\)" = "\$before" \]/)).toEqual(['the replacing RUN does not prove that no other path was added or removed']);
    expect(drop(/\[ -z "\$changed" \]/)).toEqual(['the replacing RUN does not prove that no other file changed since the marker']);
    expect(drop(/require\.resolve\('dompurify'\)/)).toEqual(["the replacing RUN does not prove that each requirer's require loads the new release from it"]);
    expect(drop(/import\.meta\.resolve\('dompurify'\)/)).toEqual(["the replacing RUN does not prove that each requirer's import loads the new release from it"]);
    expect(drop(/^ {4}: > "\$marker"; \\$/)).toEqual(['the replacing RUN does not set its marker and read the paths of the image before it fetches']);
    expect(drop(/^ {4}mv "\$new" "\$pkg"; \\$/)).toContainEqual(expect.stringContaining('does not swap the directory'));
    // A check moved after the swap checks nothing in time; a proof moved before it proves nothing.
    expect(move(/\[ "\$got" = "\$integrity" \]/, /^ {4}mv "\$new" "\$pkg"; \\$/)).toEqual([
      "the replacing RUN checks the tarball's sha512, against the integrity npm published only after it has removed the old directory",
    ]);
    expect(move(/grep -rlF data-tt-policy-suffix/, /^ {4}mv "\$new" "\$pkg"; \\$/)).toEqual([
      "the replacing RUN checks that the webapp's own build carries no DOMPurify only after it has removed the old directory",
    ]);
    expect(move(/\[ "\$\(paths\)" = "\$before" \]/, /\[ "\$\(tree "\$new"\)" = "\$to_tree" \]/)).toEqual([
      'the replacing RUN proves that no other path was added or removed before the swap, which proves nothing',
    ]);
    // As node, after node's USER, or twice.
    expect(replacementProblems(webapp.replace(/\n(# Still as root: dompurify)/, '\nUSER node\n$1'))).toEqual(['the replacing RUN runs as node, not root']);
    const run = /\n# Still as root: dompurify[\s\S]*?\n\n/.exec(webapp)![0];
    expect(replacementProblems(webapp.replace(run, '\n\n') + run)).toEqual(['the replacing RUN runs as node, not root', "the replacing RUN is not followed by upstream's USER node"]);
    expect(replacementProblems(webapp.replace(run, `${run}${run.slice(1)}`))).toEqual(["2 RUNs name a tarball's integrity, not one"]);
    // Another source than npm's registry, or an integrity that is no sha512.
    expect(replacementProblems(webapp.replace(/(?<=url=)https:\/\/registry\.npmjs\.org\//, 'https://example.org/'))).toEqual([expect.stringContaining("the replacing RUN's url= is https://example.org/")]);
    expect(replacementProblems(webapp.replace(/(?<=integrity=)sha512-/, 'sha1-'))).toEqual([expect.stringContaining("the replacing RUN's integrity= is sha1-")]);
  });

  it('run over the stand-in, it swaps the package for the published release and changes nothing else; both requirers load it', () => {
    withSandbox(treeOf('trigger.dev', 'linux-x64'), (box) => {
      const before = snapshot(box);
      const run = build(webapp, box, replacingOnly);
      expect(run.status, run.out).toBe(0);
      const after = snapshot(box);
      expect(without(after, DOMPURIFY.path)).toEqual(without(before, DOMPURIFY.path));
      const files = standInDompurify(DOMPURIFY.to);
      expect([...after].filter(([p, v]) => p.startsWith(`${DOMPURIFY.path}/`) && v !== 'directory').map(([p, v]) => [p.slice(DOMPURIFY.path.length + 1), v]).sort()).toEqual(
        Object.entries(files).map(([p, t]) => [p, sha256(t)]).sort(),
      );
      // Once from each requirer, by require and by import, from the swapped directory.
      expect(run.out.split(`require(dompurify): ${join(box.fs, DOMPURIFY.path)}/dist/purify.cjs.js 3.4.17\n`)).toHaveLength(DOMPURIFY.requirers.length + 1);
      expect(run.out.split(`import(dompurify): ${join(box.fs, DOMPURIFY.path)}/dist/purify.es.mjs 3.4.17\n`)).toHaveLength(DOMPURIFY.requirers.length + 1);
      expect(run.out).toContain("nothing else in the image changed; from posthog-js and mermaid, require and import load 3.4.17.");
      expect(readdirSync(join(box.root, 'tmp')), 'the RUN left its staging directory').toEqual([]);
    });
  });

  it("gives the new release's files the owner of the old package.json, before the swap", () => {
    // The stand-in's files all belong to the user running this, so the owner
    // they end with proves nothing: stat answers another owner for the old
    // package.json, and chown is recorded and answered without changing any.
    const tree: Tree = {
      ...treeOf('trigger.dev', 'linux-arm64'),
      tools: {
        stat: stub('stat', `"-c %u:%g "*/node_modules/.pnpm/dompurify@${DOMPURIFY.from}/node_modules/dompurify/package.json`, 'echo 4242:4343; exit 0'),
        chown: stub('chown', '*', 'exit 0'),
      },
    };
    withSandbox(tree, (box) => {
      const run = build(webapp, box, replacingOnly);
      expect(run.status, run.out).toBe(0);
      const chowns = readFileSync(join(box.root, 'tools.log'), 'utf8').split('\n').filter((l) => l.startsWith('chown '));
      expect(chowns).toHaveLength(1);
      // mktemp's directory, then the tarball's package/, before it is moved into place.
      expect(chowns[0]!.startsWith(`chown -R 4242:4343 ${join(box.root, 'tmp')}/`), chowns[0]).toBe(true);
      expect(chowns[0]!.endsWith('/unpacked/package'), chowns[0]).toBe(true);
    });
  });

  it('each way upstream or the registry could differ fails it, with nothing changed', () => {
    const base = treeOf('trigger.dev', 'linux-arm64');
    const files = (add: Record<string, string>, drop: (p: string) => boolean = () => false): Tree => ({
      ...base,
      files: { ...Object.fromEntries(Object.entries(base.files).filter(([p]) => !drop(p))), ...add },
    });
    const at = (dir: string) => (p: string) => p === dir || p.startsWith(`${dir}/`);
    const served = (bytes: Buffer, standIn: Partial<NonNullable<Tree['standIn']>> = {}): Tree => ({ ...base, registry: { [DOMPURIFY.url]: bytes }, standIn: { ...base.standIn!, ...standIn } });
    const extra = tarball({ ...standInDompurify(DOMPURIFY.to), 'dist/extra.js': 'module.exports = 1;\n' });
    const older = tarball(standInDompurify('3.4.16'));
    // The published files, and a link besides, which the tree (files only) does not see.
    const linked = tarball(standInDompurify(DOMPURIFY.to), { 'dist/purify.link.js': 'purify.cjs.js' });
    /** A grep that cannot read what it is given, for the search whose flags `flags` names. */
    const unreadable = (flags: string): Tree => ({ ...base, tools: { grep: stub('grep', `${flags}*`, "echo 'grep: stand-in: Permission denied' >&2; exit 2") } });
    const webappDir = '/triggerdotdev/apps/webapp';
    const cases: ReadonlyArray<[string, Tree, (fs: string) => string, Options?]> = [
      ['the package is not where it was', { ...files({}, at(DOMPURIFY.path)), links: [] }, (fs) => `${fs}${DOMPURIFY.path} is not there.`],
      ['another version at its path', files({ [`${DOMPURIFY.path}/package.json`]: standInDompurify('3.4.12')['package.json']! }), () => 'is dompurify 3.4.12, not 3.4.13'],
      ['a file of it that is not the published one', files({ [`${DOMPURIFY.path}/dist/purify.cjs.js`]: 'module.exports = { version: "3.4.13" };\n' }), (fs) => `${fs}${DOMPURIFY.path} is not the published dompurify 3.4.13, file for file`],
      // A link inside it: the tree, which hashes files only, reads the published 3.4.13.
      ['a link inside it', { ...base, links: [...base.links!, { path: `${DOMPURIFY.path}/dist/purify.link.js`, target: 'purify.cjs.js' }] }, (fs) => `${fs}${DOMPURIFY.path} holds more than files and directories.`],
      ['a requirer that is not there', files({}, at(DOMPURIFY.requirers[0]!)), (fs) => `${fs}${DOMPURIFY.requirers[0]} is not there.`],
      [
        'a third package that links it',
        { ...base, links: [...base.links!, { path: `${PNPM}/other@1.0.0/node_modules/dompurify`, target: '../../dompurify@3.4.13/node_modules/dompurify' }] },
        (fs) => `dompurify is linked from: ${fs}${PNPM}/mermaid@11.16.1/node_modules/dompurify ${fs}${PNPM}/node_modules/dompurify ${fs}${PNPM}/other@1.0.0/`,
      ],
      [
        'a requirer with a copy of its own, not the link',
        {
          ...files(Object.fromEntries(Object.entries(standInDompurify(DOMPURIFY.from)).map(([p, t]) => [`${dirname(DOMPURIFY.requirers[0]!)}/dompurify/${p}`, t]))),
          links: base.links!.filter((l) => !l.path.startsWith(dirname(DOMPURIFY.requirers[0]!))),
        },
        (fs) => `${fs}${dirname(DOMPURIFY.requirers[0]!)}/dompurify is not a link to`,
      ],
      ['another copy of it elsewhere in the image', files({ [`${webappDir}/node_modules/dompurify/package.json`]: standInDompurify('3.4.13')['package.json']! }), () => "dompurify's package.json is at: "],
      ['a browser bundle that carries DOMPurify', files({ [`${webappDir}/build/client/assets/purify.es-stand-in.js`]: 'const n="data-tt-policy-suffix";export{n};\n' }), (fs) => `the webapp's own build carries DOMPurify (grep exits 0): ${fs}${webappDir}/build/client/assets/purify.es-stand-in.js`],
      ['a server bundle that imports mermaid', files({ [`${webappDir}/build/server/index.mjs`]: 'export const m = () => import("mermaid");\n' }), () => "the webapp's own build imports dompurify or mermaid (grep exits 0)"],
      ['a webapp built elsewhere', files({}, at(`${webappDir}/build/client`)), (fs) => `${fs}${webappDir}/build/client is not there`],
      // grep says 1 for "none found" and 2 for "could not read": only 1 is a no.
      ['a build the search for DOMPurify cannot read', unreadable('-rlF'), () => "the webapp's own build carries DOMPurify (grep exits 2)"],
      ['a build the search for imports cannot read', unreadable('-rlE'), () => "the webapp's own build imports dompurify or mermaid (grep exits 2)"],
      ['a registry that has no such tarball', { ...base, registry: {} }, () => `${DOMPURIFY.url} could not be fetched; nothing was changed.`],
      ['a registry that serves other bytes', served(extra), () => `${DOMPURIFY.url} is ${integrityOf(extra)}, not ${base.standIn!.integrity}, the integrity npm published for dompurify 3.4.17; nothing was changed.`],
      ['a tarball of another release, by its own integrity', served(older, { integrity: integrityOf(older) }), () => `${DOMPURIFY.url} unpacks to dompurify 3.4.16, not 3.4.17; nothing was changed.`],
      ['a tarball with other files, by its own integrity', served(extra, { integrity: integrityOf(extra) }), () => `${DOMPURIFY.url} unpacks to other files than the published dompurify 3.4.17 (above); nothing was changed.`],
      ['a tarball with a link besides the published files, by its own integrity', served(linked, { integrity: integrityOf(linked) }), () => `${DOMPURIFY.url} unpacks to other files than the published dompurify 3.4.17 (above); nothing was changed.`],
      // The real trees and integrity, which no stand-in is: the build refuses it.
      ['the pinned trees, against the stand-in', base, (fs) => `${fs}${DOMPURIFY.path} is not the published dompurify 3.4.13, file for file`, { pinnedReplacement: true }],
    ];
    for (const [what, tree, said, options] of cases) {
      withSandbox(tree, (box) => {
        const before = snapshot(box);
        const run = build(webapp, box, { ...replacingOnly, ...options });
        expect(run.status, `${what}: ${run.out}`).not.toBe(0);
        expect(run.out, what).toContain(said(box.fs));
        expect(snapshot(box), `${what}: something changed before it failed`).toEqual(before);
      });
    }
  });

  it('each proof after the swap fails on the change it is there to see', () => {
    const base = treeOf('trigger.dev', 'linux-arm64');
    /** The replacing RUN with a line put in right after the swap. */
    const afterSwap = (line: string) => {
      const text = webapp.replace(/(\n {4}mv "\$new" "\$pkg"; \\\n)/, `$1    ${line} \\\n`);
      expect(text).not.toBe(webapp);
      return text;
    };
    withSandbox(base, (box) => {
      const run = build(afterSwap('echo changed >> /triggerdotdev/package.json;'), box, replacingOnly);
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`outside ${box.fs}${DOMPURIFY.path}, these changed while it was replaced: ${box.fs}/triggerdotdev/package.json`);
    });
    withSandbox(base, (box) => {
      const run = build(afterSwap(': > /triggerdotdev/stray;'), box, replacingOnly);
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`a path outside ${box.fs}${DOMPURIFY.path} was added or removed while it was replaced.`);
    });
    // A link outside the package made again: the same paths, and a change the files alone would not show.
    withSandbox(base, (box) => {
      const run = build(afterSwap(`ln -sfn ../dompurify@${DOMPURIFY.from}/node_modules/dompurify ${PNPM}/node_modules/dompurify;`), box, replacingOnly);
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`outside ${box.fs}${DOMPURIFY.path}, these changed while it was replaced: ${box.fs}${PNPM}/node_modules/dompurify`);
    });
    /** The stand-in, with the registry serving these files as the new release, by their own integrity and tree. */
    const serving = (files: Record<string, string>): Tree => {
      const bytes = tarball(files);
      return { ...base, registry: { [DOMPURIFY.url]: bytes }, standIn: { ...base.standIn!, integrity: integrityOf(bytes), toTree: treeHash(files) } };
    };
    const pkg = (fs: string) => join(fs, DOMPURIFY.path);
    const from = (fs: string, how: 'require' | 'import') => `from ${fs}${DOMPURIFY.requirers[0]}, ${how}('dompurify') does not load 3.4.17`;
    const cases: ReadonlyArray<[string, Tree, (fs: string) => string[]]> = [
      // Each build says its version: a package.json that says 3.4.17 is not enough.
      ['a release whose ES build says another version', serving(standInDompurify(DOMPURIFY.to, '3.4.16')), (fs) => [`require(dompurify): ${pkg(fs)}/dist/purify.cjs.js 3.4.17`, `import(dompurify): ${pkg(fs)}/dist/purify.es.mjs 3.4.16`, from(fs, 'import')]],
      ['a release whose CJS build says another version', serving(standInDompurify(DOMPURIFY.to, DOMPURIFY.to, '3.4.16')), (fs) => [`require(dompurify): ${pkg(fs)}/dist/purify.cjs.js 3.4.16`, from(fs, 'require')]],
      // Each loads the file read: one that says 3.4.17 from elsewhere is not enough.
      ['a release whose require entry is another file', serving(standInWithEntry('require')), (fs) => [`require(dompurify): ${pkg(fs)}/dist/purify.js 3.4.17`, from(fs, 'require')]],
      ['a release whose import entry is another file', serving(standInWithEntry('import')), (fs) => [`require(dompurify): ${pkg(fs)}/dist/purify.cjs.js 3.4.17`, `import(dompurify): ${pkg(fs)}/dist/purify.mjs 3.4.17`, from(fs, 'import')]],
      // A copy of 3.4.17 a requirer resolves first, through a link deeper than the link check reads and
      // to a directory the search for dompurify/package.json does not match: only the load proof sees it.
      [
        'a requirer that resolves a copy of its own',
        {
          ...base,
          files: { ...base.files, ...Object.fromEntries(Object.entries(standInDompurify(DOMPURIFY.to)).map(([p, t]) => [`/triggerdotdev/vendor/purify-copy/${p}`, t])) },
          links: [...base.links!, { path: `${DOMPURIFY.requirers[0]}/node_modules/dompurify`, target: relative(`${DOMPURIFY.requirers[0]}/node_modules`, '/triggerdotdev/vendor/purify-copy') }],
        },
        (fs) => [`require(dompurify): ${fs}/triggerdotdev/vendor/purify-copy/dist/purify.cjs.js 3.4.17`, from(fs, 'require')],
      ],
    ];
    for (const [what, tree, said] of cases) {
      withSandbox(tree, (box) => {
        const run = build(webapp, box, replacingOnly);
        expect(run.status, `${what}: ${run.out}`).not.toBe(0);
        for (const line of said(box.fs)) expect(run.out, what).toContain(line);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// managed.yml: the builds, by the names their content gives them, and the coupling.

interface Service {
  image?: string;
  build?: unknown;
  pull_policy?: string;
  user?: string | number;
  command?: string | string[];
  environment?: Record<string, string | number | null> | string[];
}

function servicesOf(text: string): Record<string, Service> {
  return ((parseYaml(text) as { services?: Record<string, Service | null> }).services ?? {}) as Record<string, Service>;
}

function environmentOf(svc: Service): Record<string, string> {
  const env = svc.environment ?? {};
  if (Array.isArray(env)) return Object.fromEntries(env.map((e) => [e.split('=')[0]!, e.slice(e.indexOf('=') + 1)]));
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === null ? '' : String(v)]));
}

const escapeForSed = (s: string) => s.replace(/[.[\]\\*^$#]/g, '\\$&');

/** What is wrong with the two Trigger.dev services of managed.yml; empty when they hold. */
function composeProblems(text: string, files: Readonly<Record<Name, string>>, worker: string): string[] {
  const problems: string[] = [];
  const all = servicesOf(text);
  let pin: string | null = null;
  try {
    pin = readTriggerPin(text, worker);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  for (const name of NAMES) {
    const key = SERVICE[name];
    const svc = all[key];
    if (!svc) {
      problems.push(`${MANAGED} has no ${key}`);
      continue;
    }
    const tag = dockerfileBase(files[name]).tag;
    if (pin !== null && tag !== pin) problems.push(`${dockerfileOf(name)} builds on ${tag}, and ${MANAGED} pins ${pin}: trigger-version.sh pin moves both`);
    const hex = builtTag(files[name]).slice(tag.length + 1);
    const want = `localhost/${name}:\${TRIGGER_IMAGE_TAG:-${pin ?? tag}}-${hex}`;
    if (svc.image !== want) {
      const stale = /^localhost\/[^:]+:\$\{TRIGGER_IMAGE_TAG:-v[\d.]+\}-[0-9a-f]{12}$/.test(svc.image ?? '');
      problems.push(
        stale
          ? [
              `${key} runs ${svc.image}, and ${dockerfileOf(name)}'s instructions name it ${want} now. Compose builds an image only where its name is`,
              'missing, so under the old name the old build keeps running. From the repository root:',
              `  sed -i 's#${escapeForSed(svc.image!)}#${want}#' ${MANAGED}`,
            ].join('\n')
          : `${key} runs ${svc.image ?? 'nothing'}, not ${want}: the Trigger.dev version as before, then the hash of ${dockerfileOf(name)}'s instructions`,
      );
    }
    const wantBuild = { context: `./${name}`, args: { TRIGGER_IMAGE_TAG: '${TRIGGER_IMAGE_TAG:-}' } };
    if (JSON.stringify(svc.build) !== JSON.stringify(wantBuild)) {
      problems.push(`${key}'s build: is ${JSON.stringify(svc.build)}, not ${JSON.stringify(wantBuild)}: anything more is an input its name does not carry`);
    }
    if (svc.pull_policy !== 'never') problems.push(`${key} has pull_policy ${String(svc.pull_policy)}, not never: no registry serves ${want}`);
    const env = environmentOf(svc);
    if (env['COREPACK_ENABLE_NETWORK'] !== '0') {
      problems.push(`${key} sets COREPACK_ENABLE_NETWORK to ${env['COREPACK_ENABLE_NETWORK'] ?? 'nothing'}, not "0": without the copy its user runs, corepack would fetch pnpm from the npm registry at every start`);
    }
    for (const k of ['HOME', 'COREPACK_HOME', 'XDG_CACHE_HOME']) {
      if (k in env) problems.push(`${key} sets ${k}, which moves the copy of pnpm corepack runs away from the one its Dockerfile keeps`);
    }
  }
  return problems;
}

/** The copy a Dockerfile removes and the one it keeps, from its removing RUN. */
function copiesOf(text: string): { unused?: string; kept?: string } {
  const vars = assignments(removingRun(text)?.args ?? '');
  return { unused: vars.get('unused'), kept: vars.get('kept') };
}

/**
 * THE COUPLING: the copy each Dockerfile keeps is the one its service's user
 * runs, and the one it removes is the other's.
 */
function couplingProblems(text: string, files: Readonly<Record<Name, string>>): string[] {
  const problems: string[] = [];
  const all = servicesOf(text);
  for (const name of NAMES) {
    const svc = all[SERVICE[name]] ?? {};
    const user = svc.user === undefined ? 'node' : String(svc.user);
    const home = HOME_OF[user];
    const { unused, kept } = copiesOf(files[name]);
    if (!home) {
      problems.push(`${SERVICE[name]} runs as ${user}, whose copy of pnpm neither Dockerfile knows`);
      continue;
    }
    if (kept !== COPY(home) || unused === COPY(home)) {
      problems.push(
        `${SERVICE[name]} runs as ${user} (${svc.user === undefined ? "no `user:`, so the image's node" : '`user:`'}), so its entrypoint's pnpm is ${COPY(home)}, and ` +
          `${dockerfileOf(name)} keeps ${kept ?? 'nothing'} and removes ${unused ?? 'nothing'}. Move the removal to the other copy, and the proofs with it, or the start fails ` +
          '(COREPACK_ENABLE_NETWORK "0") where it would have fetched pnpm',
      );
    }
  }
  return problems;
}

const managedText = read(MANAGED);
const workerManifest = read('apps/worker/package.json');

describe('managed.yml runs the two builds by the names their content gives them', () => {
  it('each image is the version as before and the hash of its Dockerfile, built from its directory, never pulled, never fetching pnpm', () => {
    expect(composeProblems(managedText, dockerfiles, workerManifest)).toEqual([]);
    // Two version defaults, as the bring-up, trigger-version.sh and the runbook read them.
    expect([...managedText.matchAll(/\$\{TRIGGER_IMAGE_TAG:-(v[^}]+)\}/g)].map((m) => m[1])).toEqual([dockerfileBase(dockerfiles['trigger.dev']).tag, dockerfileBase(dockerfiles['trigger.dev']).tag]);
  });

  it('a Dockerfile moved past its name fails with the sed that moves the name, and the sed does', () => {
    const edited = dockerfiles['trigger.dev'].replace(/^(USER root)$/m, 'RUN set -eu; true\n$1');
    const [problem, ...more] = composeProblems(managedText, { ...dockerfiles, 'trigger.dev': edited }, workerManifest);
    expect(more).toEqual([]);
    const sed = /^ {2}(sed -i .*)$/m.exec(problem ?? '')?.[1];
    expect(sed, problem).toBeTruthy();
    const scratch = mkdtempSync(join(tmpdir(), 'trigger-name-'));
    try {
      mkdirSync(join(scratch, 'deploy/compose'), { recursive: true });
      writeFileSync(join(scratch, MANAGED), managedText);
      const ran = spawnSync('sh', ['-c', sed!], { cwd: scratch, encoding: 'utf8' });
      expect(ran.status, ran.stderr).toBe(0);
      const moved = readFileSync(join(scratch, MANAGED), 'utf8');
      expect(composeProblems(moved, { ...dockerfiles, 'trigger.dev': edited }, workerManifest)).toEqual([]);
      const changed = managedText.split('\n').filter((line, i) => moved.split('\n')[i] !== line);
      expect(changed).toEqual([expect.stringMatching(/^\s+image: localhost\/trigger\.dev:/)]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('refuses a FROM at another version than the defaults, a wider build, a pull, a fetch of pnpm and a moved home', () => {
    const fromMoved = dockerfiles.supervisor.replace(/^FROM (\S+):v[\d.]+@/m, 'FROM $1:v4.8.2@');
    expect(composeProblems(managedText, { ...dockerfiles, supervisor: fromMoved }, workerManifest)).toContainEqual(
      expect.stringContaining('deploy/compose/supervisor/Dockerfile builds on v4.8.2, and deploy/compose/managed.yml pins v4.8.1'),
    );
    const swap = (from: string | RegExp, to: string) => {
      const text = managedText.replace(from, to);
      expect(text, `${String(from)} matched nothing`).not.toBe(managedText);
      return composeProblems(text, dockerfiles, workerManifest);
    };
    expect(swap(/(\n {6}context: \.\/trigger\.dev\n)/, '$1      dockerfile: Other.Dockerfile\n')).toEqual([expect.stringContaining("trigger-api's build: is")]);
    expect(swap(/( {8}TRIGGER_IMAGE_TAG: \$\{TRIGGER_IMAGE_TAG:-\}\n)( {4}pull_policy: never\n {4}container_name: \$\{COMPOSE_PROJECT_NAME\}-trigger-supervisor)/, '$1        EXTRA: "1"\n$2')).toEqual([
      expect.stringContaining("trigger-supervisor's build: is"),
    ]);
    expect(swap(/( {4}pull_policy: never\n {4}container_name: \$\{COMPOSE_PROJECT_NAME\}-trigger-api)/, '    pull_policy: missing\n    container_name: ${COMPOSE_PROJECT_NAME}-trigger-api')).toEqual([
      expect.stringContaining('trigger-api has pull_policy missing, not never'),
    ]);
    expect(swap(/ {6}COREPACK_ENABLE_NETWORK: "0"\n {4}ports:/, '    ports:')).toEqual([expect.stringContaining('trigger-api sets COREPACK_ENABLE_NETWORK to nothing')]);
    expect(swap(/( {6}COREPACK_ENABLE_NETWORK: )"0"(\n {4}volumes:)/, '$1"1"$2')).toEqual([expect.stringContaining('trigger-supervisor sets COREPACK_ENABLE_NETWORK to 1')]);
    for (const k of ['HOME', 'COREPACK_HOME', 'XDG_CACHE_HOME']) {
      expect(swap(/( {6}COREPACK_ENABLE_NETWORK: "0"\n)( {4}ports:)/, `$1      ${k}: /tmp\n$2`), k).toEqual([expect.stringContaining(`trigger-api sets ${k}`)]);
    }
    // The pulled image back, with nothing else: refused, with what to run instead.
    expect(swap(/image: localhost\/supervisor:(\$\{TRIGGER_IMAGE_TAG:-v[\d.]+\})-[0-9a-f]{12}/, 'image: ghcr.io/triggerdotdev/supervisor:$1')).toEqual([
      expect.stringContaining('trigger-supervisor runs ghcr.io/triggerdotdev/supervisor:${TRIGGER_IMAGE_TAG:-v4.8.1}, not localhost/supervisor:'),
    ]);
  });
});

describe('each removal stays safe while the stack is as it is', () => {
  const api = servicesOf(managedText)['trigger-api']!;

  it("the copy each Dockerfile keeps is the one its service's user runs", () => {
    expect(api.user).toBe('root');
    expect(servicesOf(managedText)['trigger-supervisor']!.user).toBeUndefined();
    expect(couplingProblems(managedText, dockerfiles)).toEqual([]);
  });

  it('a `user:` flipped on either service fails, and says to move the removal', () => {
    const apiAsNode = managedText.replace(/^ {4}user: root\n/m, '');
    expect(apiAsNode).not.toBe(managedText);
    expect(couplingProblems(apiAsNode, dockerfiles)).toEqual([
      expect.stringMatching(/^trigger-api runs as node \(no `user:`.*keeps \/root\/\.cache\/node\/corepack\/v1\/pnpm\/10\.33\.2 and removes \/home\/node\/.*Move the removal/),
    ]);
    const supAsRoot = managedText.replace(/^( {4}container_name: \$\{COMPOSE_PROJECT_NAME\}-trigger-supervisor\n)/m, '$1    user: root\n');
    expect(supAsRoot).not.toBe(managedText);
    expect(couplingProblems(supAsRoot, dockerfiles)).toEqual([expect.stringMatching(/^trigger-supervisor runs as root \(`user:`\).*Move the removal/)]);
    const odd = managedText.replace(/^ {4}user: root$/m, '    user: "1000:1000"');
    expect(couplingProblems(odd, dockerfiles)).toEqual([expect.stringContaining('trigger-api runs as 1000:1000, whose copy of pnpm neither Dockerfile knows')]);
    // And the Dockerfile moved instead: the same failure, from the other side.
    const swapped = dockerfiles['trigger.dev'].replace('unused=/home/node/', 'unused=/root/').replace('kept=/root/', 'kept=/home/node/');
    expect(couplingProblems(managedText, { ...dockerfiles, 'trigger.dev': swapped })).toEqual([expect.stringContaining('Move the removal')]);
  });

  it("trigger-api's command is the chown and upstream's entrypoint, and it sets no key that would run depot or esbuild", () => {
    expect(api.command).toBe('sh -c "chown -R node:node /home/node/shared && exec ./scripts/entrypoint.sh"');
    const keys = Object.keys(environmentOf(api));
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((k) => /^(DEPOT_|ESBUILD_)/.test(k))).toEqual([]);
  });

  it("DEPOT_TOKEN stays a third party the webapp's guard refuses: depot runs only with it", () => {
    const guard = read('scripts/a-service-that-phones-home.unit.test.ts');
    const list = /export const WEBAPP_THIRD_PARTIES = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(guard)?.[1] ?? '';
    expect(list, 'WEBAPP_THIRD_PARTIES is gone from a-service-that-phones-home').not.toBe('');
    expect(list).toContain("'DEPOT_TOKEN'");
    expect(guard).toMatch(/COREPACK_ENABLE_NETWORK:\s*\n?\s*"/);
  });
});

interface Workflow {
  on: { pull_request?: { paths?: string[] } };
  jobs: Record<string, { name?: string; if?: string; 'runs-on'?: string; permissions?: unknown; strategy?: { matrix?: { include?: Array<Record<string, string>> } }; steps?: Array<{ name?: string; run?: string; uses?: string; with?: Record<string, unknown> }> }>;
}

/**
 * What `docker` answers in the build step below: upstream's configuration as
 * the Dockerfiles' headers read it, for the base and the build alike, and a
 * log of every call. `FAKE_*` changes one answer, as a release or a broken
 * build would.
 */
const DOCKER_STUB = [
  '#!/usr/bin/env bash',
  'printf \'%s\\n\' "$*" >> "$DOCKER_LOG"',
  'case "$1" in pull|build) exit 0 ;; image) ;; *) echo "unexpected: docker $*" >&2; exit 3 ;; esac',
  'fmt="$4"; ref="$5"',
  'case "$ref" in localhost/*) side=built ;; *) side=base ;; esac',
  'user=\'"node"\'',
  'case "$ref" in',
  '  *supervisor*) cmd=\'["pnpm","run","--filter","supervisor","start"]\'; ep=\'["/app/entrypoint.sh"]\'; wd=\'"/app"\' ;;',
  '  *) cmd=\'["./scripts/entrypoint.sh"]\'; ep=\'["docker-entrypoint.sh"]\'; wd=\'"/triggerdotdev"\' ;;',
  'esac',
  'if [ -n "${FAKE_BASE_USER:-}" ] && [ "$side" = base ] && [[ "$ref" == *supervisor* ]]; then user="$FAKE_BASE_USER"; fi',
  'if [ -n "${FAKE_BUILT_USER:-}" ] && [ "$side" = built ]; then user="$FAKE_BUILT_USER"; fi',
  'case "$fmt" in',
  '  "{{json .Config.User}} {{json .Config.Cmd}} {{json .Config.Entrypoint}}") echo "$user $cmd $ep" ;;',
  '  "{{json .Config.User}}") echo "$user" ;;',
  '  "{{json .Config.Cmd}}") echo "$cmd" ;;',
  '  "{{json .Config.Entrypoint}}") echo "$ep" ;;',
  '  "{{json .Config.WorkingDir}}") echo "$wd" ;;',
  '  "{{.Os}}/{{.Architecture}}") echo "${FAKE_PLATFORM:-linux/$ARCH}" ;;',
  '  *) echo "sha256:stub, user $user" ;;',
  'esac',
  '',
].join('\n');

interface StepRun {
  readonly status: number;
  readonly out: string;
  /** Every docker call, one per line. */
  readonly docker: string[];
}

/** Runs images.yml's build step as GitHub runs it (bash -eo pipefail), in this checkout, with docker stubbed. */
function runBuildStep(step: string, env: Record<string, string>): StepRun {
  const dir = mkdtempSync(join(tmpdir(), 'trigger-build-step-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'docker'), DOCKER_STUB, { mode: 0o755 });
    // Node itself, unless told what the pin watch's reader would have printed.
    writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\nif [ -n "\${FAKE_BUILDS+x}" ]; then printf '%s\\n' "$FAKE_BUILDS"; exit 0; fi\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    const script = join(dir, 'step.sh');
    writeFileSync(script, step);
    const log = join(dir, 'docker.log');
    writeFileSync(log, '');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: dir, DOCKER_LOG: log, ...env },
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, docker: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const imagesWorkflow = () => parseYaml(read('.github/workflows/images.yml')) as Workflow;
const buildStep = (wf: Workflow) => (wf.jobs['trigger']?.steps ?? []).find((s) => s.name?.startsWith('Build both Trigger.dev images'))?.run ?? '';

describe('a pull request builds both on both platforms, and Dependabot leaves them to trigger-version.sh', () => {
  it("images.yml's `build (trigger, …)` builds each directory with the version argument, natively on amd64 and arm64", () => {
    const images = imagesWorkflow();
    expect(images.on.pull_request?.paths).toContain('deploy/**');
    const job = images.jobs['trigger'];
    expect(job, 'images.yml has no `trigger` job').toBeDefined();
    expect(job!.name).toBe('build (trigger, ${{ matrix.arch }})');
    expect(job!.if).toBe("github.event_name == 'pull_request'");
    expect(job!.permissions).toEqual({ contents: 'read' });
    expect(job!.strategy?.matrix?.include).toEqual([
      { arch: 'amd64', runner: 'ubuntu-24.04' },
      { arch: 'arm64', runner: 'ubuntu-24.04-arm' },
    ]);
    expect(job!['runs-on']).toBe('${{ matrix.runner }}');
    expect(job!.steps?.find((s) => s.uses?.startsWith('actions/checkout@'))?.with?.['persist-credentials']).toBe(false);
    const run = (job!.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(run).toMatch(/docker build --pull --build-arg "TRIGGER_IMAGE_TAG=\$\{pin\}" --tag "\$ref" "\$context"/);
    expect(run, 'it does not read the builds with the pin watch').toContain('builtImage(repo, COMPOSE, line)');
    for (const field of ['User', 'Cmd', 'Entrypoint', 'WorkingDir']) expect(run).toContain(field);
    expect(run).toContain('linux/${ARCH}');
  });

  it('the step, run with a stub docker, builds both with the pin as the version argument, after checking the base is the one read', () => {
    const step = buildStep(imagesWorkflow());
    expect(step, 'images.yml has no step "Build both Trigger.dev images…"').not.toBe('');
    const pin = readTriggerPin(managedText, workerManifest);
    for (const arch of ['amd64', 'arm64']) {
      const ok = runBuildStep(step, { ARCH: arch });
      expect(ok.status, ok.out).toBe(0);
      const builds = ok.docker.filter((c) => c.startsWith('build '));
      expect(builds).toEqual([
        expect.stringMatching(new RegExp(`^build --pull --build-arg TRIGGER_IMAGE_TAG=${pin.replaceAll('.', '\\.')} --tag localhost/trigger\\.dev:${pin.replaceAll('.', '\\.')}-[0-9a-f]{12} deploy/compose/trigger\\.dev$`)),
        expect.stringMatching(new RegExp(`^build --pull --build-arg TRIGGER_IMAGE_TAG=${pin.replaceAll('.', '\\.')} --tag localhost/supervisor:${pin.replaceAll('.', '\\.')}-[0-9a-f]{12} deploy/compose/supervisor$`)),
      ]);
      // Each base's configuration is read before its build.
      const firstBuild = ok.docker.findIndex((c) => c.startsWith('build '));
      expect(ok.docker.findIndex((c) => c.includes('{{json .Config.User}} {{json .Config.Cmd}} {{json .Config.Entrypoint}}'))).toBeLessThan(firstBuild);
    }
  });

  it('each refusal of the step stops it: a base run another way, a build that changed the user, another platform, a third build', () => {
    const step = buildStep(imagesWorkflow());
    // A release that runs the supervisor as root: refused before anything is built.
    const asRoot = runBuildStep(step, { ARCH: 'amd64', FAKE_BASE_USER: '"root"' });
    expect(asRoot.status).not.toBe(0);
    expect(asRoot.out).toMatch(/::error::ghcr\.io\/triggerdotdev\/supervisor:\S+ runs "root" \["pnpm"/);
    expect(asRoot.docker.filter((c) => c.startsWith('build ') && c.includes('supervisor'))).toEqual([]);
    // A build that changed the configuration.
    const changed = runBuildStep(step, { ARCH: 'amd64', FAKE_BUILT_USER: '"root"' });
    expect(changed.status).not.toBe(0);
    expect(changed.out).toMatch(/::error::localhost\/trigger\.dev:\S+'s User is "root", and upstream's is "node"/);
    // A leg that built another platform's paths.
    const other = runBuildStep(step, { ARCH: 'amd64', FAKE_PLATFORM: 'linux/arm64' });
    expect(other.status).not.toBe(0);
    expect(other.out).toContain('is linux/arm64, not linux/amd64');
    // Not the two builds this job knows.
    const one = runBuildStep(step, { ARCH: 'amd64', FAKE_BUILDS: 'localhost/trigger.dev:v4.8.1-000000000000 deploy/compose/trigger.dev ghcr.io/triggerdotdev/trigger.dev:v4.8.1' });
    expect(one.status).not.toBe(0);
    expect(one.out).toContain('names 1 Trigger.dev builds, not the two');
    expect(one.docker).toEqual([]);
  });

  it('no Dependabot entry reads either directory', () => {
    type Update = { 'package-ecosystem': string; directory?: string; directories?: string[] };
    const updates = (parseYaml(read('.github/dependabot.yml')) as { updates: Update[] }).updates;
    const dirs = updates.flatMap((u) => [...(u.directories ?? []), ...(u.directory ? [u.directory] : [])]);
    expect(dirs.length).toBeGreaterThan(3);
    for (const name of NAMES) expect(dirs.filter((d) => d.replace(/\/$/, '') === `/deploy/compose/${name}`), name).toEqual([]);
  });
});

describe('the reading is not vacuous', () => {
  it('found the Dockerfiles and their removing RUNs', () => {
    for (const name of NAMES) {
      expect(statSync(join(REPO_ROOT, dockerfileOf(name))).isFile()).toBe(true);
      // The removing RUN and the node RUN, and the webapp's replacing RUN.
      expect(runs(dockerfiles[name]).length, name).toBe(2 + REPLACED[name].length);
      expect(replacingRuns(dockerfiles[name]).length, name).toBe(REPLACED[name].length);
      expect(parseRef(dockerfileBase(dockerfiles[name]).ref).digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});
