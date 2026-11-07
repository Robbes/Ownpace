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
 * On 2026-10-31 two more trees went from both images under that same risk,
 * because the scan of the images built here (run 41130684117) read twelve
 * fixable highs in them: npm 11.19.1, which Node 24.22.1 bundles and nothing
 * here runs (six), and the rest of node-gyp's tree, all of the kept copy's
 * dist/node_modules with dist/node-gyp-bin (six). Each copy's pnpm names three
 * packages of that tree, each in a try (node-gyp's bin, picomatch,
 * v8-compile-cache), and both builds refuse a copy that names any other.
 * So `deploy/compose/trigger.dev/Dockerfile` and
 * `deploy/compose/supervisor/Dockerfile` build on upstream's images by tag and
 * index digest, and their headers say why each file is safe to delete.
 *
 * Two lessons came out of reading it, and each is held here. A third came with
 * the one finding left that a release fixes (below, A COPY THE SCAN READS),
 * a fourth with the pnpm each service runs (A PNPM SWAPPED IS A PNPM
 * RENAMED), two more with the fixes of 2026-11-03 (A GO BINARY TRIVY
 * READS ONLY WHEN IT CAN RUN, and A PACKAGE PNPM INSTALLED IS NOT ITS
 * TARBALL), and one with effect's of 2026-11-06 (A PACKAGE OF THE WORKSPACE
 * LINKS FROM ITS OWN NODE_MODULES).
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
 *  - A PNPM SWAPPED IS A PNPM RENAMED (since 2026-11-02). Both builds run pnpm
 *    10.34.9 in place of upstream's 10.33.2, against which npm lists 18
 *    advisories, none reachable here: hygiene, not a security fix (SWAP
 *    below). Corepack picks the version from the root package.json's
 *    packageManager, and reuses a copy by its .corepack file alone, without
 *    its hash: 10.34.9's files under 10.33.2's path would run under the wrong
 *    name, and a copy already at 10.34.9's path would run unchecked. So each
 *    removing RUN refuses an upstream that moved packageManager and an image
 *    that has 10.34.9 already; installs 10.34.9 with `corepack install -g
 *    pnpm@10.34.9+sha512.<hex>`, the sha512 npm published, into the home of
 *    the user its service runs as, before anything is removed, and checks the
 *    copy (its version, the hash its .corepack records, node-gyp's tree and
 *    the three names); removes 10.33.2; rewrites packageManager and reads it
 *    back; checks that the kept copy's home holds 10.34.9 alone and the other
 *    user's no copy at all, so no copy of a version it was not read for is
 *    left; and proves 10.34.9 starts offline as that user. A build that left
 *    packageManager at 10.33.2 would start no pnpm at all: corepack, offline,
 *    looks for the copy the build removed, and refuses. Over the stand-in, a
 *    stand-in corepack installs from a stand-in registry and refuses a wrong
 *    hash as corepack 0.36.0 does ("Mismatch hashes", writing nothing).
 *  - A GO BINARY TRIVY READS ONLY WHEN IT CAN RUN (2026-11-03). Trivy 0.76.1
 *    reads the modules of a Go binary only when the file is executable. The
 *    first triage of the webapp's goose read 0 findings, from a copy taken
 *    out of the image without its mode; with the mode, 21. Since 2026-11-03
 *    the webapp's build replaces goose v3.27.1, which upstream builds and the
 *    entrypoint runs as root at every start, with goose v3.29.0's release
 *    binary (REPLACED, kind 'binary'): 21 fixable highs to 1. The RUN checks
 *    the old file is root's, 0755, with one name, and says v3.27.1; fetches
 *    the release's asset for the platform; refuses any other SHA-256 with
 *    nothing changed; gives the new file root's owner and 0755 before it
 *    moves it into place; and proves it says v3.29.0, and that nothing else
 *    changed. Over the stand-in, goose is a minimal executable made here for
 *    the machine that runs this, which prints its version as goose does.
 *  - A PACKAGE PNPM INSTALLED IS NOT ITS TARBALL (2026-11-03). Since then the
 *    webapp's build also swaps undici, follow-redirects, body-parser and
 *    systeminformation for the same major's release that fixes each, and the
 *    supervisor's systeminformation, from one table of rows (REPLACED, kind
 *    'package' with a `table`). Run over a tree pnpm 10.33.2 installed, the
 *    first draft failed on systeminformation: pnpm links a package's own bin
 *    into the package's directory, node_modules/.bin, a shim that names the
 *    absolute paths of the install, so the directory in an image is never the
 *    tarball file for file. The swap's trees leave pnpm's node_modules out,
 *    the RUN carries it over to the new release and proves it unchanged, and
 *    the stand-in's systeminformation has such a shim. The requirers are
 *    found by the links themselves, since pnpm's directory name for one
 *    carries its peers, and the supervisor's tree is resolved by `pnpm deploy
 *    --legacy`. The same build removes TypeScript 7's native compiler, the
 *    one ELF of @typescript/typescript-$plat 7.0.2, by its published SHA-256
 *    (REMOVED), and proves `typescript` still resolves 7.0.2.
 *  - A PACKAGE OF THE WORKSPACE LINKS FROM ITS OWN NODE_MODULES (2026-11-06).
 *    effect 3.17.1 joined the table as its fifth row: of effect's three
 *    copies in the scan, the one whose requirer's range takes the fix
 *    (@prisma/config pins the other two exactly, and body-parser 2.3.0 stays,
 *    since 2.4.0 needs an iconv-lite newer than the one pnpm linked for it).
 *    Its requirer is no package of the store but one of the workspace,
 *    packages/schema-to-json, whose link is in its own node_modules, and the
 *    table's `who` read the store alone: run over a workspace pnpm 10.33.2
 *    installed, with the real tarball, the row said "linked from: nothing".
 *    So `who` reads the workspace too, in both images: every directory under
 *    the one that holds node_modules/.pnpm, a node_modules aside, that links
 *    the package from its own node_modules, named by its package.json. The
 *    stand-in has schema-to-json's link, and the webapp's own effect 3.21.2
 *    linked beside it, which must not count. The same replica showed that a
 *    tree pnpm hard-linked from its store fails the swap's state proof, since
 *    removing a directory changes the ctime of every inode it shares; the
 *    image's install copies (the four's swap proved it on CI), and the
 *    stand-in has no hard link between packages either.
 *
 * What else is held:
 *  - the Dockerfiles' shape: one FROM, upstream's image by `vX.Y.Z` and index
 *    digest; `ARG TRIGGER_IMAGE_TAG` with no default; `USER root` for the
 *    removing RUN and `USER node` last, as upstream's; FROM, ARG, USER and RUN
 *    only (the name hashes the instruction lines, and the image's
 *    configuration stays upstream's); no `rm -f`, `rm -rf` or `|| true`;
 *    every path the removing RUN removes checked gone after it; and the
 *    proofs in the image (the two packages load without their binary; as the
 *    service's user pnpm 10.34.9 starts offline and, without node-gyp's tree,
 *    runs a command in the package the service's own pnpm runs; as the other
 *    user it does not start; corepack 0.36.0 is still there), and the checks
 *    before any removal: that no file of the kept copy outside its
 *    dist/node_modules names a package inside it but the three read, that
 *    npm is Node's 11.19.1 with no npmrc and only Node's two links into it,
 *    and that corepack is 0.36.0;
 *  - READ AT ONE RELEASE: each removing RUN names the release its reasons
 *    were read in (`read_at`), which must be the FROM's tag, and refuses an
 *    image of another version; and it pins the entrypoint read there by its
 *    SHA-256, since who runs pnpm is decided there. A path that did not move
 *    across releases (depot and esbuild did not, from 4.7.6 to 4.8.3) proves
 *    nothing about the code that reaches it, so a version move is red until
 *    someone reads the reasons again;
 *  - REMOVED below, each path with why nothing runs it, equals what the
 *    Dockerfiles remove: read from their text, and from running their RUN
 *    instructions over a stand-in of the image's tree on both platforms, which
 *    also shows that every check fails before anything is removed when a path
 *    upstream moves is not there;
 *  - REPLACED below equals what the webapp's replacing RUNs name: dompurify's
 *    own RUN, the swap table's rows in both builds (each package, both
 *    versions and trees, npm's integrity, its mark and what it loads, who
 *    requires it), and goose's RUN (both versions, each platform's asset and
 *    SHA-256), and each of those RUNs checks before it changes anything and
 *    proves after, in the order held here, run over the stand-in too. For
 *    dompurify's: (the package,
 *    both versions, the tarball's address and integrity, both trees), and
 *    that RUN checks everything it can before it changes anything and proves
 *    the rest after. Run over the stand-in, with a stand-in registry and the
 *    stand-in's hashes in place of the real ones, it swaps the package and
 *    nothing else; each way upstream or the registry could differ fails it
 *    with nothing changed, and each proof after the swap fails on the change
 *    it is there to see;
 *  - SWAP below equals what both removing RUNs name (the two versions, the
 *    sha512, which is npm's published integrity, and each root package.json),
 *    past its floor; the swap's order holds (checks of the image as upstream
 *    left it, the install, checks of the new copy, then the removals, the
 *    rewrite and its read-back, and the check that no other copy is left; in
 *    the supervisor, node's owner read before and given to its whole corepack
 *    home after the install); and run over the stand-in, each way it could
 *    slip fails (no rewrite, no read-back, a wrong hash, a copy already
 *    there, an upstream that moved, a package.json naming packageManager
 *    twice, an owner left behind, a copy of another version in either home);
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
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
/** The supervisor's tree, as `pnpm deploy --legacy --prod` puts it (apps/supervisor/Containerfile) and the scan reads it. */
const SUPERVISOR_PNPM = '/app/apps/supervisor/node_modules/.pnpm';
type Plat = (typeof PLATFORMS)[number];

/** TypeScript 7's native compiler in the webapp's image (REMOVED), and its SHA-256 on each platform, as npm published it. */
const TSC = {
  path: `${PNPM}/@typescript+typescript-$plat@7.0.2/node_modules/@typescript/typescript-$plat/lib/tsc`,
  sha256: {
    'linux-arm64': 'f86e8070c267b12d6c119bf567cb82d8b245e9d93da1864bc7c603cea10a8b2f',
    'linux-x64': '4f2de678286401759b3fb4475bafe35b8f32b4b3a07d92642bbf37eadc9b34a4',
  } as Readonly<Record<Plat, string>>,
  /** The package `typescript` 7.0.2, and prisma's, from whose directories it must still resolve. */
  typescript: `${PNPM}/typescript@7.0.2/node_modules/typescript`,
  prisma: `${PNPM}/prisma@6.14.0_magicast@0.3.5_typescript@7.0.2/node_modules/prisma`,
} as const;

interface Swap {
  /** The pnpm upstream's packageManager names, and the one both builds run in its place. */
  readonly from: string;
  readonly to: string;
  /** The integrity npm published for `to`, and its sha512 in hex, which the RUNs hand corepack. */
  readonly integrity: string;
  readonly sha512: string;
  /** When npm published `to` (the three-day floor, CONTRIBUTING.md). */
  readonly published: string;
  /** Why the swap is hygiene and changes nothing a script here goes through. */
  readonly why: string;
  readonly evidence: string;
}

/** THE PNPM SWAP, the same in both builds (since 2026-11-02). Must equal what each removing RUN names. */
const SWAP: Swap = {
  from: '10.33.2',
  to: '10.34.9',
  integrity: 'sha512-9JtajqD97bRLs8DB1ldQkqU8KVDZW3rRXfEfF5dId6LeOgHAfpNOmyjOcW5RwJqUlixzBtCb4uHksYqMh2L9Mg==',
  sha512: 'f49b5a8ea0fdedb44bb3c0c1d6575092a53c2950d95b7ad15df11f17974877a2de3a01c07e934e9b28ce716e51c09a94962c7306d09be2e1e4b18a8c8762fd32',
  published: '2026-10-25T17:54:00.645Z',
  why:
    "hygiene, not a security fix: npm lists 18 advisories against pnpm 10.33.2 (11 high, 7 moderate), all fixed by 10.34.5, and none is reachable here, since each needs an install, a patch command, a registry request or workspace files an attacker wrote, and these containers run package scripts from the workspace baked into the image; 10.34.9 is npm's latest-10, and npm lists no advisory against it",
  evidence:
    "npm's bulk advisories for pnpm 10.33.2 and 10.34.9, and its published integrity and time for 10.34.9 (2026-11-02); pnpm 10.33.2 and 10.34.9 as npm published them (the update check on install and add only; the version switch and the packageManager check skipped under corepack; the same layout, engines, bins and three names); upstream's package.json, pnpm-workspace.yaml and pnpm-lock.yaml at v4.8.3 (no configDependencies, proxy settings or nodeLinker, no .npmrc or pnpmfile, one document); corepack 0.36.0 installVersion; both builds' RUNs on Node 24.22.1 with corepack 0.36.0, offline, 2026-11-02",
};

/** The root package.json whose packageManager corepack reads, in each image. */
const ROOT_PKG: Readonly<Record<Name, string>> = { 'trigger.dev': '/triggerdotdev/package.json', supervisor: '/app/package.json' };
/** A copy of pnpm corepack keeps, by its user's home and its version. */
const COPY = (home: string, version: string) => `${home}/.cache/node/corepack/v1/pnpm/${version}`;
/** Corepack's home under a user's home, where its lastKnownGood.json is. */
const COREPACK_HOME = (home: string) => `${home}/.cache/node/corepack`;

/** What each Dockerfile removes, and why. Must equal what its RUN removes. */
const REMOVED: Readonly<Record<Name, readonly Removal[]>> = {
  'trigger.dev': [
    {
      path: `${PNPM}/@depot+cli-$plat@0.0.1-cli.2.80.0/node_modules/@depot/cli-$plat/bin/depot`,
      why: "depot's Go binary: the webapp runs it only for `depot push`, with DEPOT_TOKEN and DEPOT_ORG_ID set (DEPOT_REGION has a default), neither of which trigger-api has",
      evidence: 'finalizeDeploymentV2.server.ts and remoteImageBuilder.server.ts at v4.8.1 and v4.8.3; @depot/cli lib/main.js (depot, depotBinaryPath, generateBinPath)',
    },
    {
      path: `${PNPM}/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli/bin/depot`,
      why: "the same binary under its second name: @depot/cli's postinstall hard-links it over its JavaScript shim, and Trivy does not read hard links",
      evidence: '@depot/cli install.js (maybeOptimizePackage); trivy v0.76.1 pkg/fanal/walker/tar.go',
    },
    {
      path: `${PNPM}/@esbuild+$plat@0.23.0/node_modules/@esbuild/$plat/bin/esbuild`,
      why: "esbuild's Go binary, spawned only by a build, transform or context call; it is installed for the trigger.dev CLI, which nothing in the image runs",
      evidence: 'esbuild 0.23.0 lib/main.js (ensureServiceIsRunning); packages/cli-v3 and internal-packages/dashboard-agent package.json at v4.8.1 and v4.8.3',
    },
    {
      path: `${PNPM}/esbuild@0.23.0/node_modules/esbuild/bin/esbuild`,
      why: "the same binary under its second name: esbuild's postinstall hard-links it over its JavaScript shim, and Trivy does not read hard links",
      evidence: 'esbuild 0.23.0 install.js (maybeOptimizePackage); trivy v0.76.1 pkg/fanal/walker/tar.go',
    },
    {
      path: `${COPY('/root', SWAP.to)}/dist/node_modules`,
      why: "node-gyp 11.5.0 and the packages it brings, installed flat in the copy of pnpm trigger-api runs, 10.34.9's since 2026-11-02 (in 10.33.2's: tar 7.5.13 first, the owner, 2026-10-27, and since 2026-10-31 the rest, brace-expansion 2.1.0 and ip-address 10.1.0 among them, 6 fixable highs; in 10.34.9's npm lists two moderates and no high). pnpm resolves node-gyp's bin in a try, only to hand a package script its path, and the entrypoint's pnpm runs three migration scripts that call no node-gyp and install nothing",
      evidence: "pnpm 10.33.2 and 10.34.9 as npm published them: pnpm.cjs and worker.js bundle what pnpm runs, and outside dist/node_modules only pnpm.cjs's resolveFrom(__dirname, 'node-gyp/bin/node-gyp') and require.resolve('picomatch') (fdir's, for a glob() nothing calls) and bin/pnpm.cjs's require('v8-compile-cache') (only when module.enableCompileCache() answers nothing) name it, each in a try; pnpm run and exec of those files without it, 10.33.2's on Node 22.22.0 and 10.34.9's on Node 24.22.1 with corepack 0.36.0; docker/scripts/entrypoint.sh at v4.8.1 and v4.8.3; Trivy 0.76.1 over 10.33.2's copy",
    },
    {
      path: `${COPY('/root', SWAP.to)}/dist/node-gyp-bin`,
      why: "the shim pnpm puts on a package script's PATH so that a script can call node-gyp, which went with dist/node_modules; no script the entrypoint's pnpm runs calls node-gyp, and a PATH entry that is not there is passed over",
      evidence: "pnpm 10.33.2 and 10.34.9 pnpm.cjs (@pnpm/npm-lifecycle's extendPath with node-gyp-bin); the migration scripts at v4.8.1 and v4.8.3: prisma migrate deploy, node scripts/migrate.mjs deploy, node migrate.mjs; under 10.34.9 without it, a script that calls node-gyp says `node-gyp: not found`",
    },
    {
      path: COPY('/root', SWAP.from),
      why: "root's copy of pnpm 10.33.2, the one upstream ships for the user trigger-api runs as: the build installs 10.34.9 beside it and rewrites packageManager to pnpm@10.34.9 (SWAP), so corepack runs 10.34.9's copy and never looks at this one",
      evidence: "upstream's package.json (packageManager pnpm@10.33.2) and docker/Dockerfile at v4.8.3; corepack 0.36.0 (Node 24.22.1's) installVersion, which takes the version from packageManager; the RUN on Node 24.22.1 with corepack 0.36.0, offline, 2026-11-02",
    },
    {
      path: COPY('/home/node', SWAP.from),
      why: "node's copy of pnpm, with tar 7.5.13 in it: trigger-api runs as root (managed.yml), so every pnpm of the entrypoint runs root's copy",
      evidence: "docker/Dockerfile and docker/scripts/entrypoint.sh at v4.8.1 and v4.8.3; managed.yml `user: root`; corepack 0.36.0 (Node 24.22.1's) getCorepackHomeFolder and installVersion",
    },
    ...npmRemovals('trigger-api', 'the entrypoint runs pnpm (through corepack), goose and node, the migrations prisma and node, the healthcheck `node -e`, and the bring-up execs only `test` and `chown` into it'),
    {
      path: TSC.path,
      why: "TypeScript 7's native compiler (Go 1.26.4, golang.org/x/text v0.38.0: 15 fixable highs), the one ELF of typescript 7.0.2's platform package, there because typescript 7.0.2 is a resolved peer of prisma 6.14.0, @remix-run/* and class-variance-authority. `typescript` 7.0.2 exports \".\" as lib/version.cjs, which holds no compiler; the binary is reached only through bin/tsc or the unstable API's getExePath, and the image's one caller of the package, prisma's build/index.js, reads `(await import(\"typescript\")).default.version`",
      evidence: "typescript 7.0.2 and @typescript/typescript-linux-x64 and -arm64 7.0.2 as npm published them (package.json exports, lib/version.cjs, lib/getExePath.js, lib/tsc.js, dist/api/options.js; each lib/tsc's SHA-256, one name, no install script); upstream's pnpm-lock.yaml, docker/scripts/entrypoint.sh, apps/webapp and internal-packages at v4.8.3 (tsc only in @trigger.dev/database's build, dev and typecheck scripts); prisma 6.14.0 build/index.js; the RUN's lines over a tree pnpm 10.33.2 installed, on Node 24.22.1, 2026-11-03",
    },
  ],
  supervisor: [
    {
      path: COPY('/root', SWAP.from),
      why: "root's copy of pnpm, with tar 7.5.13 in it: trigger-supervisor runs as the image's node (no `user:`), whose copy its CMD runs",
      evidence: "apps/supervisor/Containerfile and entrypoint.sh at v4.8.1 and v4.8.3; managed.yml (no `user:`); corepack 0.36.0 (Node 24.22.1's) getCorepackHomeFolder and installVersion",
    },
    {
      path: COPY('/home/node', SWAP.from),
      why: "node's copy of pnpm 10.33.2, the one upstream ships for the user trigger-supervisor runs as: the build installs 10.34.9 beside it, as node's, and rewrites packageManager to pnpm@10.34.9 (SWAP), so the CMD's corepack runs 10.34.9's copy and never looks at this one",
      evidence: "apps/supervisor/Containerfile and the root package.json (packageManager pnpm@10.33.2) at v4.8.3; corepack 0.36.0 installVersion; the RUNs on Node 24.22.1 with corepack 0.36.0, offline, 2026-11-02",
    },
    {
      path: `${COPY('/home/node', SWAP.to)}/dist/node_modules`,
      why: "node-gyp 11.5.0 and the packages it brings, installed flat in the copy of pnpm the supervisor runs, 10.34.9's since 2026-11-02 (in 10.33.2's: tar 7.5.13 first, the owner, 2026-10-27, and since 2026-10-31 the rest, brace-expansion 2.1.0 and ip-address 10.1.0 among them, 6 fixable highs). The CMD's `pnpm run` runs `node dist/index.js`, which calls no node-gyp and installs nothing",
      evidence: "pnpm 10.33.2 and 10.34.9 as npm published them (the webapp's entry); apps/supervisor/package.json's start at v4.8.1 and v4.8.3; Trivy 0.76.1 over 10.33.2's copy",
    },
    {
      path: `${COPY('/home/node', SWAP.to)}/dist/node-gyp-bin`,
      why: "the shim pnpm puts on a package script's PATH so that a script can call node-gyp, which went with dist/node_modules; the supervisor's start script calls no node-gyp",
      evidence: "pnpm 10.33.2 and 10.34.9 pnpm.cjs (@pnpm/npm-lifecycle's extendPath with node-gyp-bin); apps/supervisor/package.json's start at v4.8.1 and v4.8.3",
    },
    ...npmRemovals('trigger-supervisor', 'the CMD runs pnpm (through corepack), the entrypoint dumb-init, the healthcheck `node -e`, nothing execs into it but the smoke, by `node -e` too (since 2026-11-02), and the supervisor spawns nothing'),
  ],
};

/** npm, which Node 24.22.1 bundles, and Node's two links to it: the same three removals in both images. */
function npmRemovals(service: string, runs: string): Removal[] {
  const why = (what: string) =>
    `${what}: no process of ${service} runs npm or npx (${runs}); pnpm looks for npm only to read its builtin npmrc, in a try, and Node's npm carries none. npm's bundled brace-expansion 5.0.9 and undici 6.28.0 were 6 fixable highs`;
  const evidence =
    'node:24.22.1-bookworm-slim and node:24.22.1-alpine by digest (Trivy 0.76.1) and Node 24.22.1\'s tarball (bin/npm, bin/npx); pnpm 10.33.2 pnpm.cjs (@pnpm/npm-conf: require.resolve("npm") from the global folder, failedToLoadBuiltInConfig read only by pnpm doctor)';
  return [
    { path: '/usr/local/lib/node_modules/npm', why: why('npm 11.19.1, which Node 24.22.1 bundles'), evidence },
    { path: '/usr/local/bin/npm', why: why("Node's link to npm's bin/npm-cli.js"), evidence },
    { path: '/usr/local/bin/npx', why: why("Node's link to npm's bin/npx-cli.js"), evidence },
  ];
}

/** A package's files replaced by the release of the same major that fixes it, in its directory. */
interface PackageReplacement {
  readonly kind: 'package';
  /** The package's directory in the image, under pnpm's name for the old version, which it keeps. */
  readonly path: string;
  readonly from: string;
  readonly to: string;
  /** The tarball, and the integrity npm published for it. */
  readonly url: string;
  readonly integrity: string;
  /** When npm published `to` (the three-day floor, CONTRIBUTING.md). */
  readonly published: string;
  /** When the row was taken, against which its floor is read: 2026-11-03 unless it says another day. */
  readonly taken?: string;
  /** Each published tarball's files: the SHA-256 of `sha256sum` over them, sorted by path (the RUN's `tree`). */
  readonly fromTree: string;
  readonly toTree: string;
  /**
   * The packages that require it: for dompurify's own RUN, each a directory
   * that links it; for a row of the swap table, each name@version, which the
   * RUN finds by the links (pnpm's directory name carries a requirer's peers).
   */
  readonly requirers: readonly string[];
  /** A row of the swap table (rows()): a string of the package's own code no bundle of the build may carry, and what each requirer loads. */
  readonly table?: { readonly mark: string; readonly loads: readonly string[] };
  /** Why the swap changes no code that runs, or what it changes. */
  readonly why: string;
  readonly evidence: string;
}

/** A binary replaced by another release's, fetched by its SHA-256 for each platform. */
interface BinaryReplacement {
  readonly kind: 'binary';
  readonly path: string;
  /** What `<path> -version` says before and after. */
  readonly from: string;
  readonly to: string;
  readonly said: string;
  /** Each platform's release asset: its name, address, size and SHA-256. */
  readonly assets: Readonly<Record<Plat, { readonly asset: string; readonly url: string; readonly bytes: number; readonly sha256: string }>>;
  /** When the release was published (the three-day floor, CONTRIBUTING.md). */
  readonly published: string;
  readonly why: string;
  readonly evidence: string;
}

type Replacement = PackageReplacement | BinaryReplacement;

/** A row of the swap table: one of the five packages, in the image named. */
function swapRow(
  s: string,
  name: string,
  [from, to]: readonly [string, string],
  [fromTree, toTree]: readonly [string, string],
  integrity: string,
  published: string,
  table: PackageReplacement['table'] & object,
  requirers: readonly string[],
  why: string,
  evidence: string,
): PackageReplacement {
  return { kind: 'package', path: `${s}/${name}@${from}/node_modules/${name}`, from, to, url: `https://registry.npmjs.org/${name}/-/${name}-${to}.tgz`, integrity, published, fromTree, toTree, requirers, table, why, evidence };
}

const SWAP_EVIDENCE =
  "npm's bulk advisories for both versions and its published integrity and time for the new one (2026-11-03); both tarballs (the same file names, no exports, module or type gained, the dependencies; tree() of each); upstream's pnpm-lock.yaml at v4.8.3 (who links each, and what pnpm linked for its dependencies), docker/Dockerfile, apps/webapp/package.json and vite.config.ts (esbuild without --bundle, SSR externals) and the one bundle's imports; Security Scan run 41586744506's report (each path); the RUN over a tree pnpm 10.33.2 installed, the real tarballs from the registry, on Node 24.22.1 (the supervisor's under BusyBox 1.37.0), 2026-11-03";
const SYSTEMINFORMATION_WHY =
  'GHSA-3f7j-7jwc-fxfj (high, a Windows command injection in services()) and two lesser ones in 5.31.7; 5.33.19 fixes them, sanitising what it hands its shell commands; @opentelemetry/host-metrics 0.38.3 loads systeminformation/lib/network only, and only once host metrics start';
const SYSTEMINFORMATION_TABLE = { mark: 'cat /sys/class/net/', loads: ['systeminformation', 'systeminformation/lib/network'] } as const;
const SYSTEMINFORMATION_TREES = ['77226a7b179b8ebd183348773c2f8505c10b1cc0825036541983037cda8be543', 'dc01111094ab84ace2da139f1c6e612a888c4d275cb993740f7a520b7851bb38'] as const;
const SYSTEMINFORMATION_INTEGRITY = 'sha512-Zm7wGeCG7PqfvzegMJIzrxICopWqYCeLATVmvxOOci1isLcNVKgY4Fr0hhYQzvc7cgtK3377jQVChTFAnznOiA==';

/** What each Dockerfile replaces, and why. Must equal what its replacing RUN names. */
const REPLACED: Readonly<Record<Name, readonly Replacement[]>> = {
  'trigger.dev': [
    {
      kind: 'package',
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
        "npm's advisories for dompurify; the 3.4.13 and 3.4.17 tarballs (the same 24 file names, entry points and exports; package.json differs only in its version, scripts and devDependencies; the type declarations in one import's order, and the CJS ones drop `export { _default as default }`); upstream's pnpm-lock.yaml, app/hooks/usePostHog.ts and app/components/code/StreamdownRenderer.tsx at v4.8.1 and v4.8.3; posthog-js 1.407.3 dist/main.js, dist/module.js and lib/src/extensions/product-tours; streamdown 2.5.0 dist",
    },
    swapRow(
      PNPM,
      'undici',
      ['6.29.0', '6.29.1'],
      ['461a038ab5fca6268e250cf431688e279c51688d51f486769a9d9c7114ae5448', '5f8644a9bf69a2c6aac6cef3f750832a3ff2b7a1f0d6d55d105abc4456cba6fb'],
      'sha512-EvRlUt/QqAEvXdQeRMYUfwOQsfzpDztykrG2owGEE/rBOBoYv9uF39ZzsNDh4lTFHhTr2XOZjKkYgueD12ZmGA==',
      '2026-10-15T14:19:28.454Z',
      { mark: 'undici:request:create', loads: ['undici'] },
      ['@ai-sdk/provider-utils@4.0.56', '@remix-run/node@2.17.5'],
      "CVE-2026-87018, CVE-2026-109383 and CVE-2026-109869 (3 highs; npm lists 5 advisories against 6.29.0, 3 high, none against 6.29.1); 6.29.1 changes what its fixes say: its agent and clients keep the TLS options they dropped, and fetch, EventSource and WebSocket bound what they buffer. @remix-run/node and @ai-sdk/provider-utils load it from node_modules; undici 5.29.0, @connectrpc/connect-node's, stays (a major)",
      SWAP_EVIDENCE,
    ),
    swapRow(
      PNPM,
      'follow-redirects',
      ['1.16.0', '1.16.2'],
      ['374847280f34dd2d9f043d5e8b158655915ec22c8f24f58e35e790baa6c7ee41', 'a6296098bcf909250254ddc221f6350dbd95e88957d86b035b615de6ceb103e4'],
      'sha512-/kVP2U8z596Ia0gwFrwyIeo74ta5aVmSeU1FfAUMAmcEP5EP7zydmag3SLiN64NaRKef3lxsq7i/g7ltJQDGow==',
      '2026-10-25T21:32:25.963Z',
      { mark: 'ERR_FR_TOO_MANY_REDIRECTS', loads: ['follow-redirects'] },
      ['axios@1.20.0'],
      "CVE-2026-111755, CVE-2026-111756 and CVE-2026-116689 (3 highs, npm's GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c and GHSA-mrwp-f3q8-3g9p, the last fixed by 1.16.2 alone); 1.16.2 strips credentials for array-form headers and escapes sensitiveHeaders. axios 1.20.0, @slack/web-api's, loads it",
      SWAP_EVIDENCE,
    ),
    swapRow(
      PNPM,
      'body-parser',
      ['1.20.6', '1.20.9'],
      ['a4878aa94c0d147225571b3d8daa52abe187aa0843f82d39e650b68bb3e60b56', 'd44d0e9caa1723ff88fb3b05a305cc57efdb6d63a4cf05847f6172557af6b737'],
      'sha512-FISIQxV5u91Y9gvuFq3q/tA/qTqLJn3AhRcEvyozyhJTh5OBFFtv827AdHU7Rbyct4r+Ba1/99oFa1Y3yuFsdw==',
      '2026-10-22T11:38:27.889Z',
      { mark: 'entity.parse.failed', loads: ['body-parser'] },
      ['express@4.20.0'],
      'CVE-2026-111181 (GHSA-27r3-jxmh-p828, high: a denial of service through trailing bytes after a compressed body); 1.20.9 checks the charset before it decompresses and drains the rest. Its dependencies are the ranges 1.20.6 had but qs (~6.16.0), which the qs 6.16.1 pnpm linked for 1.20.6 meets. express 4.20.0, the webapp\'s server, loads it; body-parser 2.3.0, express 5\'s, stays',
      SWAP_EVIDENCE,
    ),
    swapRow(PNPM, 'systeminformation', ['5.31.7', '5.33.19'], SYSTEMINFORMATION_TREES, SYSTEMINFORMATION_INTEGRITY, '2026-10-30T05:08:10.331Z', SYSTEMINFORMATION_TABLE, ['@opentelemetry/host-metrics@0.38.3'], SYSTEMINFORMATION_WHY, SWAP_EVIDENCE),
    {
      ...swapRow(
        PNPM,
        'effect',
        ['3.17.1', '3.22.4'],
        ['3fdbdbcf4b43e82d5631ed580db16b9431d04677ada179ed34a27043d8a23ccd', 'b7d6b7cbae9262a2e258136292e231646ba675df4e965dd38136cd266d8ac9af'],
        'sha512-RNshu7AXVxxDh6aS4lothhJ+QoZ4xSykbWNaaVdvDN72RMyVwhCGdALkyl1TbEydgAmRIdD1eTyJqBUGwSBGDA==',
        '2026-10-22T20:49:57.301Z',
        { mark: 'effect_internal_function', loads: ['effect'] },
        ['@trigger.dev/schema-to-json@4.8.3'],
        "CVE-2026-32887 (high; npm's GHSA-38f7-945m-qr2g, below 3.20.0: Effect's AsyncLocalStorage context lost or mixed up in its fibers under concurrent load), and npm lists none against 3.20.0, 3.21.2 or 3.22.4. 3.22.4 is npm's newest 3.x and declares 3.17.1's ranges, which the @standard-schema/spec 1.0.0 and fast-check 3.23.2 pnpm linked for it meet. Its one requirer is the workspace's own @trigger.dev/schema-to-json (\"^3\"), which calls JSONSchema.make, kept in 3.22.4, and nothing here loads it: the package exports only dist/, which the image does not carry, and its one importer is the CLI's index workers. effect 3.16.12 and 3.18.4 stay, pinned exactly by @prisma/config 6.14.0 and 6.19.0, and so does the webapp's own 3.21.2, fixed already",
        "npm's bulk advisories for effect 3.16.12, 3.17.1, 3.18.4, 3.20.0, 3.21.2 and 3.22.4, and its published integrity and time for 3.22.4 (2026-11-06); both tarballs (the same main, module, types, sideEffects and dependencies, no type field; the exports gain ./Graph, ./HashRing and ./PartitionedSemaphore and keep the other 176; 31 files added and none removed; tree() of each); @prisma/config 6.14.0 and 6.19.0 as npm published them (effect pinned exactly); upstream's pnpm-lock.yaml at v4.8.3 (who links each copy, and what pnpm linked for 3.17.1), packages/schema-to-json's package.json and src/index.ts, packages/cli-v3's two index workers, apps/webapp's updateMetadata.server.ts and vite.config.ts, docker/Dockerfile and .dockerignore (no dist of schema-to-json in the image); Security Scan run 42213975717's report (each path); effect's row of the RUN over a workspace pnpm 10.33.2 installed by copying, with the real tarball from the registry, on Node 24.22.1, 2026-11-06",
      ),
      taken: '2026-11-06T00:00:00Z',
    },
    {
      kind: 'binary',
      path: '/usr/local/bin/goose',
      from: 'v3.27.1',
      to: 'v3.29.0',
      said: 'goose version: ',
      assets: {
        'linux-arm64': { asset: 'goose_linux_arm64', url: 'https://github.com/pressly/goose/releases/download/v3.29.0/goose_linux_arm64', bytes: 41287840, sha256: 'efdb8f97176df746cf3970ed40810816a51927da0600b152ac4359ae2b7c0e12' },
        'linux-x64': { asset: 'goose_linux_x86_64', url: 'https://github.com/pressly/goose/releases/download/v3.29.0/goose_linux_x86_64', bytes: 43634848, sha256: 'cc56e2f75532a4dd52f5ef2d31db0121e91079a9c2617bc0ad4e04e2d41c228b' },
      },
      published: '2026-10-11T17:48:17Z',
      why: "21 fixable highs in the goose v3.27.1 upstream builds (x/crypto v0.50.0, x/net v0.53.0, x/text v0.36.0, grpc v1.80.0, klauspost/compress v1.18.5), fifteen in packages it does not link, none reachable from `goose up` over plain HTTP to the stack's ClickHouse; v3.29.0's binary leaves Go's CVE-2026-111943, which needs TLS. `goose up` with upstream's GOOSE_DRIVER, GOOSE_DBSTRING and GOOSE_MIGRATION_DIR is unchanged; since v3.28.0 a goose_db_version table that does not exist yet is ordered by version_id, and every stack that ran trigger-api has the table",
      evidence:
        "goose's tags v3.27.1 and v3.29.0 (v3.29.0 at 8b457ba3; cmd/goose/main.go, internal/dialects/clickhouse.go, CHANGELOG.md, #1085); the v3.29.0 release's assets (uploaded 2026-10-11 17:48 UTC, their Last-Modified), downloaded and hashed 2026-11-03, and `-version` of the amd64 one; goose v3.27.1 built as upstream builds it (go install, Go 1.26.10), its `-version` and its symbol table; Trivy 0.76.1 over both, executable; upstream's docker/Dockerfile and docker/scripts/entrypoint.sh at v4.8.3; managed.yml's CLICKHOUSE_URL; the RUN over a stand-in root with that build and the real release asset, on Node 24.22.1, 2026-11-03",
    },
  ],
  supervisor: [swapRow(SUPERVISOR_PNPM, 'systeminformation', ['5.31.7', '5.33.19'], SYSTEMINFORMATION_TREES, SYSTEMINFORMATION_INTEGRITY, '2026-10-30T05:08:10.331Z', SYSTEMINFORMATION_TABLE, ['@opentelemetry/host-metrics@0.38.3'], `${SYSTEMINFORMATION_WHY}; the supervisor's own source does not import host-metrics, which comes with @trigger.dev/core; cross-spawn 5.1.0 stays (a major)`, SWAP_EVIDENCE)],
};

/** dompurify's own RUN, the swap table's rows and the binaries, in each image. */
const ownRunRows = (name: Name) => REPLACED[name].filter((r): r is PackageReplacement => r.kind === 'package' && !r.table);
const tableRows = (name: Name) => REPLACED[name].filter((r): r is PackageReplacement & { table: NonNullable<PackageReplacement['table']> } => r.kind === 'package' && r.table !== undefined);
const binaryRows = (name: Name) => REPLACED[name].filter((r): r is BinaryReplacement => r.kind === 'binary');

/** The image's own user, where corepack keeps the copy each service runs. */
const HOME_OF: Readonly<Record<string, string>> = { root: '/root', node: '/home/node' };
/** The script each image starts through, which decides who runs pnpm; pinned by hash in the removing RUN. */
const ENTRYPOINT: Readonly<Record<Name, string>> = { 'trigger.dev': '/triggerdotdev/scripts/entrypoint.sh', supervisor: '/app/entrypoint.sh' };

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

/**
 * The three packages of the kept copy's dist/node_modules that a file of the
 * copy outside it names, each in a try, as pnpm 10.33.2 was read: and the
 * removing RUN's check that they are all. One more, or one fewer, is a pnpm
 * read for something else.
 */
const NAMED_THREE = ['bin/pnpm.cjs:require(v8-compile-cache', 'dist/pnpm.cjs:require.resolve(picomatch', 'dist/pnpm.cjs:resolveFrom(__dirname, node-gyp/bin/node-gyp'] as const;
const NAMED_CHECK = new RegExp(`\\[ "\\$named" = "${NAMED_THREE.map((n) => `\\$kept/${n.replace(/[.()]/g, '\\$&')} `).join('')}" \\] \\|\\| fail `);
/** corepack 0.36.0, Node 24.22.1's, which runs every pnpm here: checked before the removals and proved after. */
const COREPACK_CHECK = /\[ "\$\(node -p "require\('\$corepack_dir\/package\.json'\)\.version"\)" = 0\.36\.0 \] \|\| fail /;

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
  /** As the service's user, pnpm starts offline, and is the version the swap installs. */
  const asUser = (body: string) => new RegExp(`COREPACK_ENABLE_NETWORK=0 pnpm --version\\)" = ${SWAP.to.replaceAll('.', '\\.')} \\]`).test(body);
  /** pnpm, without its tar, runs a command in the package the service's own pnpm runs, offline. */
  const runsWithoutTar = (body: string, filter: string) =>
    new RegExp(`\\(cd \\S+ && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter ${filter.replace(/[.@/]/g, '\\$&')} exec node -e 0\\) \\|\\|`).test(body);
  // What the removing RUN checks before its first `rm`: a check after it checks nothing in time.
  const firstRm = removingArgs.search(/(^|[;\s])rm\s/);
  const checkedBefore = (re: RegExp, what: string) => {
    const i = removingArgs.search(re);
    if (i < 0 || (firstRm >= 0 && i > firstRm)) problems.push(`no check, before anything is removed, ${what}`);
  };
  for (const re of [/named="\$\(find "\$kept" -path "\$kept_modules" -prune -o -type f -name '\*js' -exec grep -HoE /, NAMED_CHECK]) {
    checkedBefore(re, 'that no file of the kept copy outside its dist/node_modules names a package inside it but the three read');
  }
  checkedBefore(/\[ "\$\(node -p "require\('\$npm_dir\/package\.json'\)\.version"\)" = 11\.19\.1 \] \|\| fail /, "that npm is Node 24.22.1's 11.19.1");
  checkedBefore(/\[ ! -e "\$npm_dir\/npmrc" \] \|\| fail /, 'that npm carries no npmrc, which pnpm would read as its builtin configuration');
  for (const [link, cli] of [['npm_link', 'npm-cli'], ['npx_link', 'npx-cli']] as const) {
    checkedBefore(new RegExp(`\\[ "\\$\\(readlink "\\$${link}"\\)" = \\.\\./lib/node_modules/npm/bin/${cli}\\.js \\] \\|\\| fail `), `that $${link} is Node's link to npm's bin/${cli}.js`);
  }
  checkedBefore(/\[ "\$into" = "\$npm_link \$npx_link " \] \|\| fail /, "that Node's two links are the only ones into npm's directory");
  checkedBefore(COREPACK_CHECK, 'that corepack is 0.36.0, which runs every pnpm here');
  const refused = (body: string) => /if \(cd \S+ && COREPACK_ENABLE_NETWORK=0 pnpm --version\) >\/dev\/null 2>&1; then/.test(body);
  if (!COREPACK_CHECK.test(root)) problems.push('no proof, after the removal, that corepack 0.36.0 is still there');
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
  // Every path the removing RUN removes is checked gone after: by the loop, or (depot's and esbuild's) by the ELF search.
  const goneLoop = /for p in ((?:"\$[a-z_]+" ?)+); do \{ \[ ! -e "\$p" \] && \[ ! -L "\$p" \]; \} \|\| fail /.exec(removingArgs);
  const checkedGone = new Set([...(goneLoop?.[1] ?? '').matchAll(/"\$([a-z_]+)"/g)].map((m) => m[1]!));
  for (const m of removingArgs.matchAll(/(?:^|[;\s])rm(?:\s+-r)?((?:\s+"\$[a-z_][a-z0-9_]*")+)\s*;/g)) {
    for (const v of m[1]!.matchAll(/"\$([a-z_][a-z0-9_]*)"/g)) {
      if (!/^(depot|esbuild)_/.test(v[1]!) && !checkedGone.has(v[1]!)) problems.push(`the removing RUN removes $${v[1]} and never checks it gone`);
    }
  }
  problems.push(...swapProblems(name, removingArgs));
  if (name === 'trigger.dev') problems.push(...tscProblems(removingArgs));
  return problems;
}

/** The swap's install: corepack, handed the version and the sha512 npm published, under a HOME when one is given. */
const SWAP_INSTALL = /(?:^|[;\s])(?:HOME=(\S+) )?corepack install -g "pnpm@\$pnpm_to\+sha512\.\$pnpm_to_sha512" \|\| fail /;

/**
 * What is wrong with a removing RUN's pnpm swap (SWAP), in words; empty when
 * it holds. Its order: the checks of the image as upstream left it, then the
 * install, then the checks of the copy it made, then the first `rm`; the
 * rewrite of packageManager after the install, and its read-back after the
 * rewrite. In the supervisor, whose copy is node's, the owner of node's
 * 10.33.2 is read before anything is removed and given to node's whole
 * corepack home after the install.
 */
function swapProblems(name: Name, args: string): string[] {
  const problems: string[] = [];
  const vars = assignments(args);
  const want: ReadonlyArray<[string, string]> = [
    ['root_pkg', ROOT_PKG[name]],
    ['pm_upstream', `pnpm@${SWAP.from}`],
    ['pnpm_to', SWAP.to],
    ['pnpm_to_sha512', SWAP.sha512],
  ];
  for (const [k, v] of want) {
    if (vars.get(k) !== v) problems.push(`the removing RUN's ${k}= is ${vars.get(k) ?? 'not there'}, not ${v} (SWAP)`);
  }
  const at = (re: RegExp) => args.search(re);
  const firstRm = at(/(^|[;\s])rm\s/);
  const lastRm = Math.max(-1, ...[...args.matchAll(/(^|[;\s])rm\s/g)].map((m) => m.index!));
  const install = SWAP_INSTALL.exec(args);
  if (!install) {
    problems.push('the removing RUN does not install pnpm $pnpm_to by the sha512 npm published (corepack install -g "pnpm@$pnpm_to+sha512.$pnpm_to_sha512" || fail)');
  } else {
    const i = install.index;
    if (firstRm >= 0 && i > firstRm) problems.push('the removing RUN installs pnpm $pnpm_to only after it has removed something');
    // The install goes into the home of the copy the RUN keeps; the RUN runs as root, whose HOME is /root.
    const tail = `/.cache/node/corepack/v1/pnpm/${SWAP.to}`;
    const kept = resolvedAssignments(args).get('kept') ?? '';
    const keptHome = kept.endsWith(tail) ? kept.slice(0, -tail.length) : kept;
    if ((install[1] ?? '/root') !== keptHome) problems.push(`the removing RUN installs pnpm $pnpm_to under ${install[1] ?? '/root'}, and keeps ${kept || 'nothing'}`);
    const before: ReadonlyArray<[RegExp, string]> = [
      [/\[ "\$pm" = "\$pm_upstream" \] \|\| fail [^\n]*upstream moved pnpm: drop the swap/, "that upstream's packageManager is still $pm_upstream (upstream moved pnpm: drop the swap)"],
      [/\[ -f "\$replaced\/\.corepack" \] \|\| fail /, 'that the copy it replaces is where it was'],
      [/\[ ! -e "\$kept" \] \|\| fail /, 'that no copy of pnpm $pnpm_to is there already, which corepack would reuse unchecked'],
    ];
    for (const [re, what] of before) {
      const j = at(re);
      if (j < 0 || j > i) problems.push(`no check, before the install, ${what}`);
    }
    // corepack 0.36.0's own check, which REMOVED's checks require before the first `rm`, comes before the install too: the hash check is 0.36.0's.
    const corepack = at(COREPACK_CHECK);
    if (corepack > i) problems.push('the removing RUN checks corepack is 0.36.0, whose hash check it relies on, only after the install');
    const after: ReadonlyArray<[RegExp, string]> = [
      [/\[ "\$\(node -p "require\('\$kept\/package\.json'\)\.version"\)" = "\$pnpm_to" \] \|\| fail /, "the new copy's version"],
      [/\[ "\$\(node -p "JSON\.parse\(require\('fs'\)\.readFileSync\(process\.argv\[1\], 'utf8'\)\)\.hash" "\$kept\/\.corepack"\)" = "sha512\.\$pnpm_to_sha512" \] \|\| fail /, 'the sha512 the new copy\'s .corepack records'],
      [/\[ -f "\$kept_modules\/node-gyp\/bin\/node-gyp\.js" \] \|\| fail /, "node-gyp's tree in the new copy, where the three names were read"],
    ];
    for (const [re, what] of after) {
      const j = at(re);
      if (j < 0 || j < i || (firstRm >= 0 && j > firstRm)) problems.push(`no check of ${what}, after the install and before anything is removed`);
    }
    // The three names (checked before the first `rm` with REMOVED's checks) are the new copy's only after the install.
    const named = at(NAMED_CHECK);
    if (named >= 0 && named < i) problems.push('the removing RUN reads the three names before the install, in a copy not there yet');
    if (name === 'supervisor') {
      if (vars.get('node_corepack') !== COREPACK_HOME('/home/node')) problems.push(`the removing RUN's node_corepack= is ${vars.get('node_corepack') ?? 'not there'}, not ${COREPACK_HOME('/home/node')}`);
      const owner = at(/(?:^|[;\s])owner="\$\(stat -c %u:%g "\$replaced\/\.corepack"\)";/);
      const chown = at(/(?:^|[;\s])chown -R "\$owner" "\$node_corepack";/);
      const owners = at(/\[ "\$owners" = "\$owner " \] \|\| fail /);
      if (owner < 0 || owner > i) problems.push("no read, before the install, of the owner of node's copy it replaces");
      if (chown < 0 || chown < i || (firstRm >= 0 && chown > firstRm)) problems.push("node's corepack home, the new copy and lastKnownGood.json with it, is not given that owner (chown -R \"$owner\" \"$node_corepack\") after the install and before anything is removed");
      if (owners < 0 || owners < chown || (firstRm >= 0 && owners > firstRm)) problems.push("no check, after the chown and before anything is removed, that node's corepack home has that one owner");
    }
  }
  // After the removals, no copy is left that the RUN was not read for: the kept home holds pnpm $pnpm_to alone, the other user's none.
  const leftovers: ReadonlyArray<[RegExp, string]> = [
    [/(?:^|[;\s])pnpm_copies="\$\(find "\$\{kept%\/\*\}" -mindepth 1 -maxdepth 1 -exec basename \{\} \\; \| LC_ALL=C sort \| tr '\\n' ' '\)";\s*\[ "\$pnpm_copies" = "\$pnpm_to " \] \|\| fail [^\n]*a copy this file was not read for/, 'that the kept copy\'s home holds pnpm $pnpm_to alone'],
    [/(?:^|[;\s])pnpm_copies="\$\(find "\$\{unused%\/\*\}" -mindepth 1 -maxdepth 1 -exec basename \{\} \\; \| LC_ALL=C sort \| tr '\\n' ' '\)";\s*\[ -z "\$pnpm_copies" \] \|\| fail [^\n]*a copy this file was not read for/, "that the other user's home holds no copy of pnpm"],
  ];
  for (const [re, what] of leftovers) {
    const j = at(re);
    if (j < 0 || j < lastRm) problems.push(`no check, after the removals, ${what}: a copy of another version would be one this file was not read for`);
  }
  const rewrite = at(/(?:^|[;\s])node -e "[^\n]*packageManager[^\n]*" "\$root_pkg" "\$pm_upstream" "pnpm@\$pnpm_to" \|\| fail /);
  if (rewrite < 0) {
    problems.push("the removing RUN does not rewrite $root_pkg's packageManager to pnpm@$pnpm_to: corepack, offline, would look for the copy it removed");
  } else {
    if (install && rewrite < install.index) problems.push('the removing RUN rewrites packageManager before it has installed pnpm $pnpm_to');
    const readBack = at(/(?:^|[;\s])pm="\$\(node -p "require\('\$root_pkg'\)\.packageManager"\)";\s*\[ "\$pm" = "pnpm@\$pnpm_to" \] \|\| fail /);
    if (readBack < rewrite) problems.push('the removing RUN does not read packageManager back after the rewrite: a rewrite that wrote nothing would go on to the proofs');
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
  problems.push(...fetchProblems(args, '$tmp/dompurify.tgz', 'the replacing RUN'));
  return problems;
}

/** A RUN's assignments, each with every variable but `$plat` resolved (the platform is the build's). */
function resolvedKeepingPlat(run: string): Map<string, string> {
  const vars = assignments(run);
  const resolve = (value: string): string =>
    value.replace(/\$\{?([a-z_][a-z0-9_]*)\}?/g, (all, name: string) => (name === 'plat' ? '$plat' : vars.has(name) ? resolve(vars.get(name)!) : all));
  return new Map([...vars].map(([k, v]) => [k, resolve(v)]));
}

/**
 * What is wrong with the webapp's removal of TypeScript 7's tsc (REMOVED, TSC), in
 * words; empty when it holds: the binary is the published one for the platform, an
 * ELF with one name, checked before anything is removed, and after the removal no
 * ELF named tsc or tsgo is left and `typescript` still resolves 7.0.2 from its own
 * directory and from prisma's, by require and by import.
 */
function tscProblems(args: string): string[] {
  const problems: string[] = [];
  const vars = resolvedKeepingPlat(args);
  for (const [k, v] of [['tsc_bin', TSC.path], ['typescript', TSC.typescript], ['prisma', TSC.prisma]] as const) {
    if (vars.get(k) !== v) problems.push(`the removing RUN's ${k}= is ${vars.get(k) ?? 'not there'}, not ${v}`);
  }
  const shas = /(?:^|[;\s])case "\$plat" in linux-arm64\) tsc_sha256=([0-9a-f]{64});; linux-x64\) tsc_sha256=([0-9a-f]{64});; esac;/.exec(args);
  if (!shas || shas[1] !== TSC.sha256['linux-arm64'] || shas[2] !== TSC.sha256['linux-x64']) {
    problems.push(`the removing RUN does not pin tsc's SHA-256 on each platform as npm published it (${TSC.sha256['linux-arm64']} on linux-arm64, ${TSC.sha256['linux-x64']} on linux-x64)`);
  }
  const firstRm = args.search(/(^|[;\s])rm\s/);
  const lastRm = Math.max(-1, ...[...args.matchAll(/(^|[;\s])rm\s/g)].map((m) => m.index!));
  const before: ReadonlyArray<[RegExp, string]> = [
    [/\[ -f "\$tsc_bin" \] \|\| fail /, 'that tsc is there'],
    [/magic="\$\(head -c4 "\$tsc_bin" \| od -An -tx1 \| tr -d ' \\n'\)"; \s*\[ "\$magic" = 7f454c46 \] \|\| fail /, 'that tsc is an ELF'],
    [/\[ "\$\(stat -c %h "\$tsc_bin"\)" = 1 \] \|\| fail /, 'that tsc has one name, which Trivy would not see a second of'],
    [/\[ "\$\(sha256sum "\$tsc_bin" \| cut -d' ' -f1\)" = "\$tsc_sha256" \] \|\| fail /, "that tsc is TypeScript 7.0.2's, by its SHA-256"],
    [/for d in "\$typescript" "\$prisma"; do \[ -f "\$d\/package\.json" \] \|\| fail /, 'that typescript 7.0.2 and prisma are where they were read'],
  ];
  for (const [re, what] of before) {
    const i = args.search(re);
    if (i < 0 || (firstRm >= 0 && i > firstRm)) problems.push(`no check, before anything is removed, ${what}`);
  }
  const after: ReadonlyArray<[RegExp, string]> = [
    [/left="\$\(find "\$s" -type f \\\( -name depot -o -name esbuild -o -name tsc -o -name tsgo \\\) -exec /, 'that no ELF named tsc or tsgo is left'],
    [/for d in "\$typescript" "\$prisma"; do \s*\(cd "\$d" && node -e "[^"\n]*require\.resolve\('typescript'\)[^"\n]*v !== '7\.0\.2'[^"\n]*" "\$typescript"\) \|\| fail /, "that require('typescript') gives 7.0.2 from its lib/version.cjs, from typescript's directory and prisma's"],
    [/\(cd "\$d" && node --input-type=module -e "[^"\n]*import\.meta\.resolve\('typescript'\)[^"\n]*v !== '7\.0\.2'[^"\n]*" "\$typescript"\) \|\| fail /, "that import('typescript') gives 7.0.2 from its lib/version.cjs, from typescript's directory and prisma's"],
  ];
  for (const [re, what] of after) {
    const i = args.search(re);
    if (i < 0 || i < lastRm) problems.push(`no proof, after the removal, ${what}`);
  }
  return problems;
}

/**
 * What is wrong with how a RUN's fetch fails, in words; empty when it holds. A
 * host that does not answer, or answers with an error, is no move upstream: the
 * fetch exits 3 and the RUN says to run the same tag again once it answers; a
 * tarball or asset that is gone (404, 410) exits 4 and the RUN says so; neither
 * prints fail()'s advice to drop the replacement, which on live's tag checkout
 * would send the operator to edit a file. Only another exit is fail()'s.
 */
function fetchProblems(args: string, file: string, who: string): string[] {
  const problems: string[] = [];
  const target = file.replace(/[$.]/g, '\\$&');
  if (!new RegExp(`node -e "fetch\\(process\\.argv\\[1\\]\\)\\.then\\(async \\(r\\) => \\{ if \\(!r\\.ok\\) \\{ [^"\\n]*process\\.exit\\(r\\.status === 404 \\|\\| r\\.status === 410 \\? 4 : 3\\); \\}[^"\\n]*\\}, \\(e\\) => \\{ [^"\\n]*process\\.exit\\(3\\); \\}\\)" "\\$url" "${target}" && st=0 \\|\\| st=\\$\\?; \\s*case "\\$st" in 0\\) ;; 3\\) unreachable "\\$url" ;; 4\\) gone "\\$url" ;; \\*\\) fail `).test(args)) {
    problems.push(`${who} does not tell a host that did not answer (exit 3, unreachable) or a file that is gone (exit 4, gone) from a move upstream`);
  }
  if (!/(?:^|[;\s])unreachable\(\) \{ echo "\$me: \$1 did not answer, or answered with an error \(above\); nothing was changed, and upstream did not move\. Run the bring-up, or deploy-live\.sh, with the same tag again once it answers[^"\n]*" >&2; exit 1; \}/.test(args)) {
    problems.push(`${who}'s unreachable() does not say to run the same tag again, on its own, without fail()'s advice`);
  }
  if (!/(?:^|[;\s])gone\(\) \{ echo "\$me: \$1 is gone \(above\)[^"\n]*upstream did not move\. [^"\n]*docs\/managed-bring-up\.md[^"\n]*" >&2; exit 1; \}/.test(args)) {
    problems.push(`${who}'s gone() does not say the file is gone and where the way on is, on its own, without fail()'s advice`);
  }
  return problems;
}

/** The RUN that swaps packages by its table, rows(). */
const tableRuns = (text: string) => runs(text).filter((r) => /(^|[;\s])rows\(\) \{/.test(r.args));

interface TableRow {
  readonly name: string;
  readonly from: string;
  readonly fromTree: string;
  readonly to: string;
  readonly toTree: string;
  readonly integrity: string;
  readonly mark: string;
  readonly loads: readonly string[];
  readonly requirers: readonly string[];
}

/** One row of rows(), as its RUN joins it: `"$@" name from from_tree to to_tree integrity 'mark' loads requirer…; `. */
const TABLE_ROW = /^ {6}"\$@" ([a-z0-9.-]+) (\d+\.\d+\.\d+) ([0-9a-f]{64}) (\d+\.\d+\.\d+) ([0-9a-f]{64}) (sha512-[A-Za-z0-9+/]{86}==) '([^'\n]+)' ([^\s;']+)((?: [^\s;']+)+); $/gm;

function rowsOf(args: string): TableRow[] {
  return [...args.matchAll(TABLE_ROW)].map((m) => ({
    name: m[1]!,
    from: m[2]!,
    fromTree: m[3]!,
    to: m[4]!,
    toTree: m[5]!,
    integrity: m[6]!,
    mark: m[7]!,
    loads: m[8]!.split(','),
    requirers: m[9]!.trim().split(' '),
  }));
}

/** Where each image's swap table works, and the build output it reads for a bundled copy. */
const TABLE_HOME: Readonly<Record<Name, { s: string; bundles: string }>> = {
  'trigger.dev': { s: PNPM, bundles: '/triggerdotdev/apps/webapp/build /triggerdotdev/apps/webapp/public' },
  supervisor: { s: SUPERVISOR_PNPM, bundles: '/app/apps/supervisor/dist' },
};

/**
 * What is wrong with an image's swap table and the RUN around it, in words;
 * empty when it holds. Its rows are REPLACED's table rows. Every row is checked
 * before anything is fetched, every tarball is fetched and checked before any
 * directory is swapped, and the proofs come after the swap: each directory the
 * new release, pnpm's own node_modules in it unchanged, nothing else of the
 * image changed, and each dependency and each requirer's require loading it.
 */
function tableProblems(name: Name, text: string): string[] {
  const want = tableRows(name);
  const found = tableRuns(text);
  if (found.length !== (want.length > 0 ? 1 : 0)) return [`${found.length} RUNs hold a swap table, not ${want.length > 0 ? 1 : 0}`];
  if (want.length === 0) return [];
  const problems: string[] = [];
  const ins = instructions(text);
  const all = runs(text);
  const run = found[0]!;
  const args = run.args;
  if (run.user !== 'root') problems.push(`the swap table's RUN runs as ${run.user}, not root`);
  const removing = all.findIndex((r) => /(^|[;\s])rm\s/.test(r.args));
  if (all.findIndex((r) => r.args === args) <= removing) problems.push("the swap table's RUN comes before the removing RUN");
  if (!ins.slice(ins.findIndex((i) => i.keyword === 'RUN' && i.args === args) + 1).some((i) => i.keyword === 'USER' && i.args === 'node')) problems.push("the swap table's RUN is not followed by upstream's USER node");
  const vars = assignments(args);
  const home = TABLE_HOME[name];
  if (vars.get('s') !== home.s) problems.push(`the swap table's s= is ${vars.get('s') ?? 'not there'}, not ${home.s}`);
  if (vars.get('bundles') !== home.bundles) problems.push(`the swap table's bundles= is ${vars.get('bundles') ?? 'not there'}, not ${home.bundles}`);
  if (vars.get('top') !== '/') problems.push(`the swap table's top= is ${vars.get('top') ?? 'not there'}, not /: it reads the whole image for other copies and other changes`);
  // The rows are REPLACED's, field for field.
  const show = (r: TableRow) => [r.name, r.from, r.fromTree, r.to, r.toTree, r.integrity, r.mark, r.loads.join(','), [...r.requirers].sort().join(' ')].join(' | ');
  const rows = rowsOf(args);
  const expected = want.map((r) => show({ name: r.path.split('/').at(-1)!, from: r.from, fromTree: r.fromTree, to: r.to, toTree: r.toTree, integrity: r.integrity, mark: r.table.mark, loads: r.table.loads, requirers: r.requirers }));
  const got = rows.map(show);
  for (const row of got.filter((g) => !expected.includes(g))) problems.push(`the swap table has a row REPLACED does not: ${row}`);
  for (const row of expected.filter((e) => !got.includes(e))) problems.push(`the swap table has no row for REPLACED's ${row}`);
  for (const r of want) if (r.path !== `${home.s}/${r.path.split('/').at(-1)}@${r.from}/node_modules/${r.path.split('/').at(-1)}`) problems.push(`REPLACED's ${r.path} is not where the swap table works (${home.s})`);
  /** The body of a function of the RUN, from `name() {` to its closing line. */
  const body = (fn: string) => new RegExp(`(?:^|[;\\s])${fn}\\(\\) \\{([\\s\\S]*?)\\n {4}\\}; `).exec(args)?.[1] ?? '';
  const needs: ReadonlyArray<[string, RegExp, string]> = [
    ['check', /\[ "\$\(version "\$pkg"\)" = "\$from" \] \|\| fail /, "the old directory's version"],
    ['check', /\[ -z "\$\(find "\$pkg" -path "\$pkg\/node_modules" -prune -o ! -type f ! -type d -print\)" \] \|\| fail /, 'that the old directory holds files and directories only'],
    ['check', /\[ "\$\(tree "\$pkg"\)" = "\$from_tree" \] \|\| /, 'the old directory, file for file (from_tree)'],
    ['check', /found="\$\(node -e "\$who" "\$s" "\$pkg" "\$name"\)" \|\| fail [^\n]*\n {6}\[ "\$\(printf '%s\\n' "\$found" \| cut -d' ' -f1 \| LC_ALL=C sort -u \| tr '\\n' ' '\)" = "\$\(printf '%s\\n' "\$@" \| LC_ALL=C sort -u \| tr '\\n' ' '\)" \] \|\| fail /, 'which packages link it, against the row'],
    ['check', /copies="\$\(find "\$top" -xdev -type f -path "\*\/\$name\/package\.json" -exec node -e "\$same" "\$name" "\$from" \{\} \+\)" \|\| fail [^\n]*\n {6}\[ "\$copies" = "\$pkg\/package\.json" \] \|\| fail /, 'that no other package.json of that name and version is in the image'],
    ['check', /found="\$\(grep -rlF -e "\$mark" \$bundles\)" && st=0 \|\| st=\$\?; \s*\[ "\$st" = 1 \] \|\| fail /, "that the image's own build carries no copy of it (its mark; grep's 1, not 2)"],
    ['fetched', /\[ "\$got" = "\$want" \] \|\| fail /, "the tarball's sha512, against the integrity npm published"],
    ['fetched', /\[ "\$\(version "\$new"\)" = "\$to" \] \|\| fail /, "the new directory's version"],
    ['fetched', /\[ ! -e "\$new\/node_modules" \] \|\| fail /, 'that the tarball brings no node_modules'],
    ['fetched', /\[ "\$\(tree "\$new"\)" = "\$to_tree" \]/, 'the new directory, file for file (to_tree)'],
    ['fetched', /chown -R "\$\(stat -c %u:%g "\$pkg\/package\.json"\)" "\$new"; /, "the old package.json's owner, given to the new files"],
    ['fetched', /own "\$pkg" > "\$tmp\/\$name\.own"; /, "pnpm's own node_modules, read before the swap"],
    ['proven', /\{ \[ "\$\(version "\$pkg"\)" = "\$to" \] && \[ "\$\(tree "\$pkg"\)" = "\$to_tree" \]; \} \|\| fail /, 'that the directory is the new release, file for file'],
    ['proven', /\[ "\$\(own "\$pkg"\)" = "\$\(cat "\$tmp\/\$name\.own"\)" \] \|\| fail /, "that pnpm's own node_modules is what it was"],
    ['loaded', /node -e "\$deps" "\$pkg" \|\| fail /, 'that every dependency the new release declares loads from its directory'],
    ['loaded', /\[ -n "\$found" \] \|\| fail /, 'that something links it after the swap'],
    ['loaded', /\(cd "\$r" && node -e "\$load" "\$pkg" "\$name" "\$to" "\$specs"\) \|\| fail /, "that from each requirer's own directory require loads the new release from it"],
  ];
  for (const [fn, re, what] of needs) if (!re.test(body(fn))) problems.push(`the swap table's ${fn}() does not check ${what}`);
  const whole: ReadonlyArray<[RegExp, string]> = [
    [/files\(\) \{ \(cd "\$1" && find \. -path \.\/node_modules -prune -o -type f -print0 \| LC_ALL=C sort -z \| xargs -0 sha256sum\); \}/, "tree() leaves pnpm's own node_modules out: pnpm links a package's bin there, a shim naming the install's paths"],
    [/state\(\) \{ \{ find "\$top" -xdev \\\( \$prune \\\) -prune -o -type d -exec stat -c '%n %u:%g %a' \{\} \+ ; find "\$top" -xdev \\\( \$prune \\\) -prune -o ! -type d -exec stat -c '%n %u:%g %a %s %Y %Z' \{\} \+ ; \}/, "state() reads every entry outside the swapped directories: each directory's owner and mode, and each other entry's owner, mode, size and times"],
    [/swapped\(\) \{ if \[ -e "\$s\/\$1@\$2\/node_modules\/\$1\/node_modules" \]; then mv "\$s\/\$1@\$2\/node_modules\/\$1\/node_modules" "\$tmp\/\$1\/package\/node_modules" \|\| fail "[^"\n]+"; fi; rm -r "\$s\/\$1@\$2\/node_modules\/\$1" \|\| fail "[^"\n]+"; mv "\$tmp\/\$1\/package" "\$s\/\$1@\$2\/node_modules\/\$1" \|\| fail "[^"\n]+"; \}/, "swapped() carries pnpm's own node_modules over, then puts the new release in the old one's place, each step failing by name"],
    [/load="[^"\n]*if \(pj !== path\.join\(real, 'package\.json'\) \|\| v !== to\)[^"\n]*if \(!p\.startsWith\(real \+ path\.sep\)\)[^"\n]*"/, 'load checks where each require resolves, not only what it says'],
    [/who="[^"\n]*!st\.isSymbolicLink\(\) \|\| fs\.realpathSync\(path\.join\(nm, name\)\) !== real[^"\n]*"/, 'who finds the requirers by the links that lead to the directory'],
    [
      /who="[^"\n]*const walk = \(d\) => \{ const l = path\.join\(d, 'node_modules', name\);[^"\n]*if \(st && st\.isSymbolicLink\(\) && fs\.realpathSync\(l\) === real\) \{ const j = JSON\.parse\(fs\.readFileSync\(path\.join\(d, 'package\.json'\), 'utf8'\)\); out\.push\(j\.name \+ '@' \+ j\.version \+ ' ' \+ d\); \} for \(const e of fs\.readdirSync\(d, \{ withFileTypes: true \}\)\) if \(e\.isDirectory\(\) && e\.name !== 'node_modules'\) walk\(path\.join\(d, e\.name\)\); \}; walk\(path\.dirname\(path\.dirname\(s\)\)\);[^"\n]*"/,
      "who also finds the workspace's packages that link it from their own node_modules (every directory under the one that holds node_modules/.pnpm, a node_modules aside), each named by its package.json",
    ],
    [/same="[^"\n]*j\.name === n && j\.version === v[^"\n]*"/, 'same matches a copy by its name and version, so other versions stay'],
  ];
  for (const [re, what] of whole) if (!re.test(args)) problems.push(`the swap table's RUN: ${what}, and does not`);
  problems.push(...fetchProblems(body('fetched'), '$tmp/$name.tgz', "the swap table's fetched()").filter((p) => !/unreachable\(\)|gone\(\)/.test(p)));
  problems.push(...fetchProblems(args, '$tmp/$name.tgz', "the swap table's RUN").filter((p) => /unreachable\(\)|gone\(\)/.test(p)));
  // The order: every row checked, the image read, every tarball fetched and checked, then the swaps, then the proofs.
  const order: ReadonlyArray<[RegExp, string]> = [
    [/^ {4}for d in \$bundles; do \[ -d "\$d" \] \|\| fail /m, 'the build output is checked there'],
    [/^ {4}rows check; $/m, 'every row is checked'],
    [/^ {4}tmp="\$\(mktemp -d\)"; $/m, 'the staging directory is made'],
    [/^ {4}prune="-path \$tmp"; $/m, 'the swapped directories are named'],
    [/^ {4}rows pruned; $/m, 'the swapped directories are named'],
    [/^ {4}before="\$\(state\)"; $/m, 'the image is read'],
    [/^ {4}rows fetched; $/m, 'every tarball is fetched and checked'],
    [/^ {4}rows swapped; $/m, 'the directories are swapped'],
    [/^ {4}rows proven; $/m, 'each directory is proved the new release'],
    [/^ {4}\[ "\$\(state\)" = "\$before" \] \|\| fail /m, 'nothing else changed'],
    [/^ {4}rm -r "\$tmp"; $/m, 'the staging directory goes'],
    [/^ {4}rows loaded; $/m, 'each requirer loads it'],
  ];
  let last = -1;
  for (const [re, what] of order) {
    const i = args.search(re);
    if (i < 0) problems.push(`the swap table's RUN does not run its steps in order: missing where ${what}`);
    else if (i < last) problems.push(`the swap table's RUN does not run its steps in order: ${what} too early`);
    else last = i;
  }
  return problems;
}

/** The RUN that replaces goose: the one that names it. */
const gooseRuns = (text: string) => runs(text).filter((r) => /(^|[;\s])goose=\/usr\/local\/bin\/goose;/.test(r.args));

/**
 * What is wrong with the webapp's goose RUN (REPLACED, kind 'binary'), in words;
 * empty when it holds. The old file is checked before anything is fetched, the
 * fetched one before it is moved into place, and the proofs come after the move.
 */
function gooseProblems(name: Name, text: string): string[] {
  const want = binaryRows(name);
  const found = gooseRuns(text);
  if (found.length !== want.length) return [`${found.length} RUNs replace goose, not ${want.length}`];
  if (want.length === 0) return [];
  const g = want[0]!;
  const problems: string[] = [];
  const ins = instructions(text);
  const all = runs(text);
  const run = found[0]!;
  const args = run.args;
  if (run.user !== 'root') problems.push(`goose's RUN runs as ${run.user}, not root`);
  if (all.findIndex((r) => r.args === args) <= all.findIndex((r) => /(^|[;\s])rm\s/.test(r.args))) problems.push("goose's RUN comes before the removing RUN");
  if (!ins.slice(ins.findIndex((i) => i.keyword === 'RUN' && i.args === args) + 1).some((i) => i.keyword === 'USER' && i.args === 'node')) problems.push("goose's RUN is not followed by upstream's USER node");
  const vars = assignments(args);
  for (const [k, v] of [['goose', g.path], ['goose_from', g.from], ['goose_to', g.to], ['url', 'https://github.com/pressly/goose/releases/download/$goose_to/$asset']] as const) {
    if (vars.get(k) !== v) problems.push(`goose's RUN's ${k}= is ${vars.get(k) ?? 'not there'}, not ${v}`);
  }
  for (const plat of PLATFORMS) {
    const a = g.assets[plat];
    const m = new RegExp(`(?:^|\\s)${plat}\\) asset=([a-z0-9_]+); goose_sha256=([0-9a-f]{64});;`).exec(args);
    if (!m || m[1] !== a.asset || m[2] !== a.sha256) problems.push(`goose's RUN does not pin ${plat}'s ${a.asset} by ${a.sha256}`);
    if (a.url !== `https://github.com/pressly/goose/releases/download/${g.to}/${a.asset}`) problems.push(`REPLACED's goose asset for ${plat} is not v${g.to}'s ${a.asset}`);
  }
  if (!/(?:^|\s)\*\) fail "this is \$plat; /.test(args)) problems.push("goose's RUN does not refuse a platform it pins no asset for");
  const at = (re: RegExp) => args.search(re);
  const lastAt = (re: RegExp) => Math.max(-1, ...[...args.matchAll(new RegExp(re.source, 'g'))].map((m) => m.index!));
  const fetch = at(/node -e "fetch\(process\.argv\[1\]\)[^\n]*" "\$url" "\$tmp\/goose" && st=0 \|\| st=\$\?; /);
  const moved = at(/(?:^|[;\s])mv "\$tmp\/goose" "\$goose"; /);
  if (fetch < 0) problems.push("goose's RUN does not fetch the release's asset with node's fetch");
  if (moved < 0) problems.push("goose's RUN does not move the fetched file into place with `mv \"$tmp/goose\" \"$goose\"`");
  const stat = /\[ "\$\(stat -c '%h %u:%g %a' "\$goose"\)" = '1 0:0 755' \] \|\| fail /;
  const before: ReadonlyArray<[number, string]> = [
    [at(/\{ \[ -f "\$goose" \] && \[ ! -L "\$goose" \]; \} \|\| fail /), 'that goose is a file'],
    [at(/magic="\$\(head -c4 "\$goose" \| od -An -tx1 \| tr -d ' \\n'\)"; \s*\[ "\$magic" = 7f454c46 \] \|\| fail /), 'that goose is an ELF'],
    [at(stat), "that goose has one name, root's, 0755"],
    [at(/said="\$\("\$goose" -version\)" \|\| fail [^\n]*\n {4}\[ "\$said" = "goose version: \$goose_from" \] \|\| fail "[^"\n]*upstream moved goose: drop the replacement\."/), 'that goose says the version the replacement was read for (upstream moved goose: drop the replacement)'],
    [at(/(?:^|[;\s])before="\$\(state\)"; /), 'the image, read'],
  ];
  for (const [i, what] of before) if (i < 0 || (fetch >= 0 && i > fetch)) problems.push(`goose's RUN does not check, before it fetches, ${what}`);
  const between: ReadonlyArray<[number, string]> = [
    [at(/got="\$\(sha256sum "\$tmp\/goose" \| cut -d' ' -f1\)"; \s*\[ "\$got" = "\$goose_sha256" \] \|\| fail /), "the fetched file's SHA-256"],
    [at(/(?:^|[;\s])chown 0:0 "\$tmp\/goose"; /), "root's owner, given to it"],
    [at(/(?:^|[;\s])chmod 0755 "\$tmp\/goose"; /), 'mode 0755, given to it (Trivy reads no Go binary that is not executable)'],
    [at(/said="\$\("\$tmp\/goose" -version\)" \|\| fail [^\n]*\n {4}\[ "\$said" = "goose version: \$goose_to" \] \|\| fail /), 'that it says the new version'],
  ];
  for (const [i, what] of between) if (i < 0 || i < fetch || (moved >= 0 && i > moved)) problems.push(`goose's RUN does not check, after the fetch and before the move, ${what}`);
  const after: ReadonlyArray<[number, string]> = [
    [at(/\[ "\$\(sha256sum "\$goose" \| cut -d' ' -f1\)" = "\$goose_sha256" \] \|\| fail /), 'that goose is the fetched file'],
    [lastAt(stat), "that goose has one name, root's, 0755"],
    [at(/\[ "\$\("\$goose" -version\)" = "goose version: \$goose_to" \] \|\| fail /), 'that goose says the new version'],
    [at(/\[ "\$\(state\)" = "\$before" \] \|\| fail /), 'that nothing else changed'],
  ];
  for (const [i, what] of after) if (i < 0 || i < moved) problems.push(`goose's RUN does not prove, after the move, ${what}`);
  if (!/state\(\) \{ \{ find "\$top" -xdev \\\( -path "\$tmp" -o -path "\$goose" \\\) -prune -o -type d -exec stat -c '%n %u:%g %a' \{\} \+ ; find "\$top" -xdev \\\( -path "\$tmp" -o -path "\$goose" \\\) -prune -o ! -type d -exec stat -c '%n %u:%g %a %s %Y %Z' \{\} \+ ; \}/.test(args)) {
    problems.push("goose's RUN's state() does not read every other entry of the image (owner and mode, and the size and times of each entry that is not a directory)");
  }
  if (vars.get('top') !== '/') problems.push(`goose's RUN's top= is ${vars.get('top') ?? 'not there'}, not /`);
  problems.push(...fetchProblems(args, '$tmp/goose', "goose's RUN"));
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
  /** A host of the stand-in registry that does not answer ('unreachable'), or answers every request with this HTTP status. */
  readonly answers?: Readonly<Record<string, 'unreachable' | number>>;
  /**
   * The stand-in's own trees, integrity and hashes, which take the real ones' place in the RUNs (`build`):
   * dompurify's, each swap table row's by package name, and goose's new release.
   */
  readonly standIn?: StandIn;
  /** Files the stand-in runs, by path in the image (mode 0755): goose. */
  readonly executables?: Readonly<Record<string, Buffer>>;
  /** Commands that stand in for the system's, by name, as shell scripts (`stub`). */
  readonly tools?: Readonly<Record<string, string>>;
  /** The pnpm the stand-in registry publishes, which the stand-in corepack installs: its version, the sha512 it hashes to, and its files. */
  readonly pnpm?: Published;
  /** The Debian packages the stand-in's dpkg and dpkg-query answer for; without it, none is installed. */
  readonly dpkg?: DpkgDb;
}

/** One package of the stand-in's dpkg database, as far as the webapp's purge asks. */
interface DpkgPackage {
  readonly version: string;
  /** `not-installed` is the record dpkg keeps of some packages it purged (the appliance's `login`). */
  readonly status: 'installed' | 'not-installed' | 'config-files';
  readonly essential?: boolean;
  readonly protected?: boolean;
  /** What it depends on, by name (Depends and Pre-Depends together). */
  readonly depends?: readonly string[];
  /** Its files, by path in the image; a purge removes those the stand-in's tree has. */
  readonly files?: readonly string[];
  /** The record dpkg keeps of it after a purge, if any: not-installed (as of `login`), or one a purge should not leave. */
  readonly afterPurge?: 'not-installed' | 'config-files';
}

interface DpkgDb {
  readonly packages: Readonly<Record<string, DpkgPackage>>;
  /** What `dpkg --audit` prints before a purge, and after one when `auditAfter` is given. */
  readonly audit?: string;
  readonly auditAfter?: string;
}

interface StandIn {
  readonly fromTree?: string;
  readonly toTree?: string;
  readonly integrity?: string;
  readonly table?: Readonly<Record<string, { readonly fromTree: string; readonly toTree: string; readonly integrity: string }>>;
  readonly goose?: string;
}

interface Published {
  readonly version: string;
  readonly sha512: string;
  readonly files: Readonly<Record<string, string>>;
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

const DOMPURIFY = ownRunRows('trigger.dev')[0]!;

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

/** The stand-in's tsc: an ELF by its magic, the same on both platforms; `build` puts its SHA-256 in the RUN unless told to keep the pinned ones. */
const STAND_IN_TSC = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from('stand-in tsc\n')]);

/** typescript 7.0.2 as its package.json exports it ("." is lib/version.cjs, no compiler), and prisma, which links it. */
function typescriptTree(): Pick<Tree, 'files' | 'links'> {
  return {
    files: {
      [`${TSC.typescript}/package.json`]: `${JSON.stringify({ name: 'typescript', version: '7.0.2', type: 'module', exports: { [`./${'package'}.json`]: `./${'package'}.json`, '.': './lib/version.cjs' } })}\n`,
      [`${TSC.typescript}/lib/version.cjs`]: 'const { version } = require("../package.json");\nexports.version = version;\nexports.versionMajorMinor = "7.0";\n',
      [`${TSC.typescript}/bin/tsc`]: '#!/usr/bin/env node\nimport "../lib/tsc.js";\n',
      [`${TSC.prisma}/package.json`]: '{"name":"prisma","version":"6.14.0"}\n',
    },
    links: [{ path: `${dirname(TSC.prisma)}/typescript`, target: '../../typescript@7.0.2/node_modules/typescript' }],
  };
}

/**
 * A minimal static Linux executable for the machine that runs this (x86-64 or
 * aarch64): it writes `text` to stdout and exits 0, whatever its arguments, as
 * `goose -version` prints its version. One load segment: the ELF header, its
 * program header, the code, then `text`.
 */
function standInExecutable(text: string, arch: string = process.arch): Buffer {
  const msg = Buffer.from(text);
  let machine: number;
  let code: Buffer;
  if (arch === 'x64') {
    machine = 0x3e;
    // mov eax,1; mov edi,1; lea rsi,[rip+16]; mov edx,len; syscall; mov eax,60; xor edi,edi; syscall
    const len = Buffer.alloc(4);
    len.writeUInt32LE(msg.length);
    code = Buffer.concat([Buffer.from([0xb8, 1, 0, 0, 0, 0xbf, 1, 0, 0, 0, 0x48, 0x8d, 0x35, 16, 0, 0, 0, 0xba]), len, Buffer.from([0x0f, 0x05, 0xb8, 0x3c, 0, 0, 0, 0x31, 0xff, 0x0f, 0x05])]);
  } else if (arch === 'arm64') {
    machine = 0xb7;
    // mov x0,#1; adr x1,msg (+28); mov x2,#len; mov x8,#64; svc #0; mov x0,#0; mov x8,#93; svc #0
    const words = [0xd2800020, 0x100000e1, 0xd2800002 | (msg.length << 5), 0xd2800808, 0xd4000001, 0xd2800000, 0xd2800ba8, 0xd4000001];
    code = Buffer.alloc(32);
    words.forEach((w, i) => code.writeUInt32LE(w >>> 0, i * 4));
  } else {
    throw new Error(`no stand-in executable for ${arch}: this guard runs on x64 and arm64`);
  }
  const size = BigInt(120 + code.length + msg.length);
  const h = Buffer.alloc(120);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(h, 0);
  h.writeUInt16LE(2, 16); // ET_EXEC
  h.writeUInt16LE(machine, 18);
  h.writeUInt32LE(1, 20);
  h.writeBigUInt64LE(0x400000n + 120n, 24); // the entry: the code, after both headers
  h.writeBigUInt64LE(64n, 32); // the program header, after the ELF header
  h.writeUInt16LE(64, 52);
  h.writeUInt16LE(56, 54);
  h.writeUInt16LE(1, 56);
  h.writeUInt16LE(64, 58);
  h.writeUInt32LE(1, 64); // PT_LOAD
  h.writeUInt32LE(5, 68); // R and X
  h.writeBigUInt64LE(0x400000n, 80);
  h.writeBigUInt64LE(0x400000n, 88);
  h.writeBigUInt64LE(size, 96);
  h.writeBigUInt64LE(size, 104);
  h.writeBigUInt64LE(0x1000n, 112);
  return Buffer.concat([h, code, msg]);
}

const GOOSE = binaryRows('trigger.dev')[0]!;
/** goose as upstream builds it and as the release publishes it, each saying its version as goose does. */
const STAND_IN_GOOSE_OLD = standInExecutable(`${GOOSE.said}${GOOSE.from}\n`);
const STAND_IN_GOOSE_NEW = standInExecutable(`${GOOSE.said}${GOOSE.to}\n`);

/**
 * The stand-in's stat and chown, for goose's owner: the stand-in's files are
 * the user's who runs this, so stat answers `owner` for `stat -c '%h %u:%g %a'`
 * of one path (its links and mode stay the file's own), and `chown 0:0` is
 * recorded and answered without changing anything. All else is the system's.
 */
function gooseTools(owner = '0:0'): Readonly<Record<string, string>> {
  const realStat = systemCommand('stat');
  return {
    stat: [
      '#!/bin/sh',
      `if [ "$#" = 3 ] && [ "$1" = -c ] && [ "$2" = '%h %u:%g %a' ]; then r="$('${realStat}' -c '%h %a' "$3")" || exit 1; echo "\${r% *} ${owner} \${r#* }"; exit 0; fi`,
      `exec '${realStat}' "$@"`,
      '',
    ].join('\n'),
    chown: ['#!/bin/sh', `printf '%s %s\\n' chown "$*" >> "$TOOL_LOG"`, 'case "$1" in 0:0) exit 0 ;; esac', `exec '${systemCommand('chown')}' "$@"`, ''].join('\n'),
  };
}

/** pnpm's directory, at read_at, of each package of the store that requires one of the five (the stand-in's links are made from it). */
const REQUIRER_DIRS: Readonly<Record<string, string>> = {
  '@ai-sdk/provider-utils@4.0.56': '@ai-sdk+provider-utils@4.0.56_zod@4.5.4',
  '@remix-run/node@2.17.5': '@remix-run+node@2.17.5_typescript@7.0.2',
  'axios@1.20.0': 'axios@1.20.0',
  'express@4.20.0': 'express@4.20.0',
  '@opentelemetry/host-metrics@0.38.3': '@opentelemetry+host-metrics@0.38.3_@opentelemetry+api@1.9.1',
};
/**
 * Each package of the workspace, at read_at, that requires one of the five,
 * by its directory in the image: pnpm links a workspace package's
 * dependencies from its own node_modules, not from the store's.
 */
const WORKSPACE_REQUIRERS: Readonly<Record<string, string>> = {
  '@trigger.dev/schema-to-json@4.8.3': '/triggerdotdev/packages/schema-to-json',
};
const nameOfRow = (r: PackageReplacement) => r.path.split('/').at(-1)!;
const splitAt = (spec: string) => [spec.slice(0, spec.lastIndexOf('@')), spec.slice(spec.lastIndexOf('@') + 1)] as const;
/** A requirer's own directory in the image, the one its require resolves from: its package under the store, or the workspace's package. */
const requirerDir = (s: string, req: string) => WORKSPACE_REQUIRERS[req] ?? `${s}/${REQUIRER_DIRS[req]}/node_modules/${splitAt(req)[0]}`;

/**
 * What a stand-in release declares, and the one dependency it requires when
 * it loads, as the real ones do: body-parser's bytes, and effect's fast-check
 * (its FastCheck module; @standard-schema/spec is types alone).
 */
const STAND_IN_DEPENDS: Readonly<Record<string, { readonly dependencies: Readonly<Record<string, string>>; readonly requires: string }>> = {
  'body-parser': { dependencies: { bytes: '~3.1.2' }, requires: 'bytes' },
  effect: { dependencies: { '@standard-schema/spec': '^1.0.0', 'fast-check': '^3.23.1' }, requires: 'fast-check' },
};

/**
 * A stand-in of one of the five packages at a version, by path inside its
 * directory: its entry says its version and carries the package's mark, so a
 * check that read node_modules for it, rather than the build, would fail;
 * systeminformation has lib/network.js, which host-metrics loads, and
 * body-parser and effect require a dependency when they load.
 */
function standInSwapped(name: string, version: string): Record<string, string> {
  const row = tableRows('trigger.dev').find((r) => nameOfRow(r) === name)!;
  const main = name === 'systeminformation' ? 'lib/index.js' : 'index.js';
  const depends = STAND_IN_DEPENDS[name];
  const deps = depends ? { dependencies: depends.dependencies } : {};
  const files: Record<string, string> = {
    'package.json': `${JSON.stringify({ name, version, main, ...deps })}\n`,
    [main]: `${depends ? `require('${depends.requires}');\n` : ''}// ${row.table.mark}\nmodule.exports = { version: '${version}' };\n`,
  };
  if (name === 'systeminformation') files['lib/network.js'] = `// ${row.table.mark}\nexports.networkStats = async () => [];\n`;
  return files;
}

/**
 * The copies of effect the table leaves, at read_at, and who links each: @prisma/config, which pins it exactly, by
 * pnpm's directory for it, or the workspace's apps/webapp (its own, "^3.21.2"), by its directory in the image.
 */
const EFFECTS_THAT_STAY: ReadonlyArray<{ readonly version: string; readonly by: string; readonly store?: string; readonly workspace?: string }> = [
  { version: '3.16.12', by: '@prisma/config@6.14.0', store: '@prisma+config@6.14.0_magicast@0.3.5' },
  { version: '3.18.4', by: '@prisma/config@6.19.0', store: '@prisma+config@6.19.0_magicast@0.3.5' },
  { version: '3.21.2', by: 'webapp@1.0.0', workspace: '/triggerdotdev/apps/webapp' },
];

/** The stand-in registry's tarball of each package's new release, made once, so their integrity holds across builds. */
const STAND_IN_SWAP_TARBALLS: Readonly<Record<string, Buffer>> = Object.fromEntries(tableRows('trigger.dev').map((r) => [nameOfRow(r), tarball(standInSwapped(nameOfRow(r), r.to))]));

/** The swap table's part of an image's stand-in tree: each old release where pnpm put it, who links it, and the registry's new ones. */
function swapTree(name: Name): Required<Pick<Tree, 'files' | 'links' | 'registry'>> & { table: NonNullable<StandIn['table']> } {
  const s = TABLE_HOME[name].s;
  const files: Record<string, string> = {};
  const links: Array<{ path: string; target: string }> = [];
  const registry: Record<string, Buffer> = {};
  const table: Record<string, { fromTree: string; toTree: string; integrity: string }> = {};
  for (const r of tableRows(name)) {
    const n = nameOfRow(r);
    for (const [p, text] of Object.entries(standInSwapped(n, r.from))) files[`${r.path}/${p}`] = text;
    for (const req of r.requirers) {
      const [reqName, reqVersion] = splitAt(req);
      const ws = WORKSPACE_REQUIRERS[req];
      if (ws) {
        // A package of the workspace: its package.json, and its own node_modules' link into the store.
        files[`${ws}/package.json`] = `${JSON.stringify({ name: reqName, version: reqVersion })}\n`;
        links.push({ path: `${ws}/node_modules/${n}`, target: relative(`${ws}/node_modules`, r.path) });
        continue;
      }
      const dir = `${s}/${REQUIRER_DIRS[req]}/node_modules`;
      files[`${dir}/${reqName}/package.json`] = `${JSON.stringify({ name: reqName, version: reqVersion })}\n`;
      links.push({ path: `${dir}/${n}`, target: `../../${n}@${r.from}/node_modules/${n}` });
    }
    registry[r.url] = STAND_IN_SWAP_TARBALLS[n]!;
    table[n] = { fromTree: treeHash(standInSwapped(n, r.from)), toTree: treeHash(standInSwapped(n, r.to)), integrity: integrityOf(STAND_IN_SWAP_TARBALLS[n]!) };
  }
  // pnpm's own: systeminformation's bin linked into its directory, a shim naming the install's paths, outside the tree.
  const si = tableRows(name).find((r) => nameOfRow(r) === 'systeminformation');
  if (si) files[`${si.path}/node_modules/.bin/systeminformation`] = `#!/bin/sh\nexport NODE_PATH="${si.path}/node_modules"\nexec node "$basedir/../../lib/cli.js" "$@"\n`;
  // body-parser's dependency, as pnpm linked it beside it.
  const bp = tableRows(name).find((r) => nameOfRow(r) === 'body-parser');
  if (bp) {
    files[`${s}/bytes@3.1.2/node_modules/bytes/package.json`] = '{"name":"bytes","version":"3.1.2","main":"index.js"}\n';
    files[`${s}/bytes@3.1.2/node_modules/bytes/index.js`] = 'module.exports = (n) => n;\n';
    links.push({ path: `${dirname(bp.path)}/bytes`, target: '../../bytes@3.1.2/node_modules/bytes' });
  }
  // pnpm's hoisted link to one of them, and the versions of the same names that stay.
  const undici = tableRows(name).find((r) => nameOfRow(r) === 'undici');
  if (undici) {
    links.push({ path: `${s}/node_modules/undici`, target: `../undici@${undici.from}/node_modules/undici` });
    files[`${s}/undici@5.29.0/node_modules/undici/package.json`] = '{"name":"undici","version":"5.29.0"}\n';
    files[`${s}/body-parser@2.3.0_supports-color@10.0.0/node_modules/body-parser/package.json`] = '{"name":"body-parser","version":"2.3.0"}\n';
  }
  // effect's two dependencies, as pnpm linked them for 3.17.1, and the copies of effect that stay, each linked
  // from its requirer: @prisma/config's two, pinned exactly, and the webapp's own 3.21.2, a workspace package's
  // link to another version, which no requirer of 3.17.1 may count.
  const effect = tableRows(name).find((r) => nameOfRow(r) === 'effect');
  if (effect) {
    for (const [dep, version] of [['@standard-schema/spec', '1.0.0'], ['fast-check', '3.23.2']] as const) {
      const dir = `${s}/${dep.replace('/', '+')}@${version}/node_modules/${dep}`;
      files[`${dir}/package.json`] = `${JSON.stringify({ name: dep, version, main: 'index.js' })}\n`;
      files[`${dir}/index.js`] = 'module.exports = {};\n';
      const at = `${dirname(effect.path)}/${dep}`;
      links.push({ path: at, target: relative(dirname(at), dir) });
    }
    for (const { version, by, store, workspace } of EFFECTS_THAT_STAY) {
      const copy = `${s}/effect@${version}/node_modules/effect`;
      files[`${copy}/package.json`] = `${JSON.stringify({ name: 'effect', version })}\n`;
      const [byName, byVersion] = splitAt(by);
      const nm = workspace ? `${workspace}/node_modules` : `${s}/${store}/node_modules`;
      files[workspace ? `${workspace}/package.json` : `${nm}/${byName}/package.json`] = `${JSON.stringify({ name: byName, version: byVersion })}\n`;
      links.push({ path: `${nm}/effect`, target: relative(nm, copy) });
    }
    // The webapp's server imports its own effect by name, which is no mark.
    files['/triggerdotdev/apps/webapp/build/server/index.js'] = 'import { Cause, Effect, Either, Option, Schedule, Duration, Fiber } from "effect";\n';
  }
  // The build each image's table reads for a bundled copy; the webapp's has a string of upstream's own code, which is no mark.
  if (name === 'supervisor') files['/app/apps/supervisor/dist/index.js'] = 'export const start = () => 0;\n';
  else files['/triggerdotdev/apps/webapp/build/server.js'] = 'if (error.code === "UND_ERR_CONNECT_TIMEOUT") retry();\n';
  return { files, links, registry, table };
}

/** Where Node 24.22.1 puts npm and corepack, and its links to them. */
const NPM_DIR = '/usr/local/lib/node_modules/npm';
const COREPACK_DIR = '/usr/local/lib/node_modules/corepack';
const NODE_LINKS: ReadonlyArray<{ path: string; target: string }> = [
  { path: '/usr/local/bin/npm', target: '../lib/node_modules/npm/bin/npm-cli.js' },
  { path: '/usr/local/bin/npx', target: '../lib/node_modules/npm/bin/npx-cli.js' },
  { path: '/usr/local/bin/corepack', target: '../lib/node_modules/corepack/dist/corepack.js' },
  // `corepack enable` in upstream's runner stage.
  { path: '/usr/local/bin/pnpm', target: '../lib/node_modules/corepack/dist/pnpm.js' },
];

/** Node 24.22.1's npm and corepack, as its image carries them, with one of npm's bundled packages. */
const NODE_GLOBALS: Readonly<Record<string, string>> = {
  [`${NPM_DIR}/package.json`]: '{"name":"npm","version":"11.19.1"}\n',
  [`${NPM_DIR}/bin/npm-cli.js`]: "#!/usr/bin/env node\nrequire('../lib/cli.js')(process)\n",
  [`${NPM_DIR}/bin/npx-cli.js`]: "#!/usr/bin/env node\nrequire('../lib/cli.js')(process)\n",
  [`${NPM_DIR}/node_modules/undici/package.json`]: '{"name":"undici","version":"6.28.0"}\n',
  [`${COREPACK_DIR}/package.json`]: '{"name":"corepack","version":"0.36.0"}\n',
  [`${COREPACK_DIR}/dist/corepack.js`]: "#!/usr/bin/env node\nrequire('./lib/corepack.cjs').runMain(process.argv.slice(2));\n",
  [`${COREPACK_DIR}/dist/pnpm.js`]: "#!/usr/bin/env node\nrequire('./lib/corepack.cjs').runMain(['pnpm', ...process.argv.slice(2)]);\n",
};

/**
 * A stand-in of pnpm as npm publishes it, by path inside its copy: node-gyp's
 * tree, flat, as pnpm ships it (tar among it, and a scoped package; 10.34.9's
 * adds content-type), and what pnpm's own files name of that tree, each in a
 * try, with its bundle's tar-stream, which is no tar.
 */
function standInPnpm(version: string): Record<string, string> {
  const newer = version === SWAP.to;
  return {
    'package.json': `${JSON.stringify({ name: 'pnpm', version, bin: { pnpm: 'bin/pnpm.cjs', pnpx: 'bin/pnpx.cjs' }, engines: { node: '>=18.12' } })}\n`,
    'dist/node_modules/tar/package.json': `{"name":"tar","version":"${newer ? '7.5.22' : '7.5.13'}"}\n`,
    'dist/node_modules/tar/index.js': "module.exports = require('tar/lib');\n",
    'dist/node_modules/node-gyp/lib/install.js': "'use strict'\n\nconst fs = require('graceful-fs')\nconst tar = require('tar')\n",
    'dist/node_modules/node-gyp/bin/node-gyp.js': "#!/usr/bin/env node\nrequire('../lib/node-gyp.js')\n",
    'dist/node_modules/brace-expansion/package.json': `{"name":"brace-expansion","version":"${newer ? '2.1.7' : '2.1.0'}"}\n`,
    'dist/node_modules/picomatch/package.json': `{"name":"picomatch","version":"${newer ? '4.0.7' : '4.0.4'}"}\n`,
    'dist/node_modules/v8-compile-cache/package.json': '{"name":"v8-compile-cache","version":"2.4.0"}\n',
    'dist/node_modules/@npmcli/agent/package.json': '{"name":"@npmcli/agent","version":"3.0.0"}\n',
    ...(newer ? { 'dist/node_modules/content-type/package.json': '{"name":"content-type","version":"2.1.0"}\n' } : {}),
    'dist/node-gyp-bin/node-gyp': '#!/bin/sh\nexec node "$npm_config_node_gyp" "$@"\n',
    'bin/pnpm.cjs': "try {\n  if(!require('module')?.enableCompileCache?.())\n    require('v8-compile-cache');\n} catch {}\nrequire('../dist/pnpm.cjs')\n",
    'dist/pnpm.cjs': [
      'var extract = require("tar-stream").extract;',
      'try { require.resolve("picomatch"); pm = require_picomatch4(); } catch {}',
      'try { DEFAULT_NODE_GYP_PATH = resolveFrom(__dirname, "node-gyp/bin/node-gyp"); } catch (err) {}',
      'env[PATH] = extendPath(wd, env[PATH], path2.join(__dirname, "node-gyp-bin"), opts);',
      '',
    ].join('\n'),
    'dist/worker.js': 'var reflink = require("@reflink/reflink-linux-x64-gnu");\n',
  };
}

/** A copy of pnpm as corepack keeps it under a home: the published files, and corepack's .corepack beside them. */
function pnpmCopy(home: string, version: string): Record<string, string> {
  return {
    [`${COPY(home, version)}/.corepack`]: `{"locator":{"name":"pnpm","reference":"${version}"}}\n`,
    ...Object.fromEntries(Object.entries(standInPnpm(version)).map(([p, t]) => [`${COPY(home, version)}/${p}`, t])),
  };
}

/** What the stand-in registry publishes for SWAP.to: the stand-in's files, under the sha512 npm published for the real ones. */
const PUBLISHED: Published = { version: SWAP.to, sha512: SWAP.sha512, files: standInPnpm(SWAP.to) };

/** The RUN that purges Debian packages: the one that runs `dpkg --purge` (the webapp's last as root, since 2026-11-06). */
const purgeRuns = (text: string) => runs(text).filter((r) => /(^|[;\s])dpkg --purge /.test(r.args));
/** How many each Dockerfile has: the supervisor's base is Alpine, and has no dpkg. */
const PURGES: Readonly<Record<Name, number>> = { 'trigger.dev': 1, supervisor: 0 };

/** The purge's two lists as its RUN names them (`purge=`, `libraries=`): what it purges, and the libraries those ship. */
function purgeLists(text: string): { packages: string[]; libraries: string[] } {
  const vars = assignments(purgeRuns(text)[0]?.args ?? '');
  const list = (k: string) => (vars.get(k) ?? '').split(' ').filter(Boolean);
  return { packages: list('purge'), libraries: list('libraries') };
}

/** Debian's directory for a platform's libraries. */
const TRIPLET: Readonly<Record<string, string>> = { 'linux-arm64': 'aarch64-linux-gnu', 'linux-x64': 'x86_64-linux-gnu' };

/** Which package of the purge ships each library it names, in Debian 12 (apt carries its private one). */
const SHIPPED_BY: Readonly<Record<string, string>> = {
  'libuuid.so.1': 'libuuid1',
  'libblkid.so.1': 'libblkid1',
  'libmount.so.1': 'libmount1',
  'libsmartcols.so.1': 'libsmartcols1',
  'libapt-pkg.so.6.0': 'libapt-pkg6.0',
  'libapt-private.so.0.0': 'apt',
};

/**
 * The stand-in's Debian 12, as far as the webapp's purge reads it: every
 * package the RUN names installed, util-linux and bsdutils Essential, each
 * library under its platform's directory (not in the stand-in's tree, so a
 * purge removes nothing there unless a test puts one in), the dependencies
 * among them that Debian 12 has (util-linux on its libraries and on
 * util-linux-extra, mount on util-linux, apt on libapt-pkg6.0, e2fsprogs on
 * libblkid1 and libuuid1 and on its own libraries, which stay), and packages
 * that stay and depend on none of them.
 */
function debian12(plat: string): DpkgDb {
  const lib = (so: string) => [`/usr/lib/${TRIPLET[plat] ?? plat}/${so}`];
  const { packages, libraries } = purgeLists(dockerfiles['trigger.dev']);
  const ships = (name: string) => libraries.filter((so) => SHIPPED_BY[so] === name).flatMap(lib);
  const depends: Readonly<Record<string, readonly string[]>> = {
    'util-linux': ['libblkid1', 'libmount1', 'libsmartcols1', 'libuuid1', 'util-linux-extra', 'libacl1'],
    'util-linux-extra': ['libblkid1', 'libsmartcols1', 'libuuid1'],
    mount: ['util-linux', 'libblkid1', 'libmount1', 'libsmartcols1'],
    libmount1: ['libblkid1'],
    apt: ['libapt-pkg6.0', 'zlib1g'],
    'libapt-pkg6.0': ['zlib1g'],
    e2fsprogs: ['libblkid1', 'libcom-err2', 'libext2fs2', 'libss2', 'libuuid1', 'logsave'],
  };
  const out: Record<string, DpkgPackage> = {
    coreutils: { version: '9.1-1', status: 'installed', essential: true, depends: ['libacl1'] },
    tar: { version: '1.34+dfsg-1.2+deb12u1', status: 'installed', essential: true, depends: ['libacl1'] },
    dpkg: { version: '1.21.22', status: 'installed', essential: true, depends: ['tar', 'zlib1g'] },
    libacl1: { version: '2.3.1-3', status: 'installed' },
    zlib1g: { version: '1:1.2.13.dfsg-1', status: 'installed' },
    // e2fsprogs' own libraries and logsave stay: in Debian 12 they need libc6 and libcom-err2 alone.
    libext2fs2: { version: '1.47.0-2+b2', status: 'installed' },
    libss2: { version: '1.47.0-2+b2', status: 'installed', depends: ['libcom-err2'] },
    'libcom-err2': { version: '1.47.0-2+b2', status: 'installed' },
    logsave: { version: '1.47.0-2+b2', status: 'installed' },
  };
  for (const name of packages) {
    out[name] = {
      version: '1',
      status: 'installed',
      essential: name === 'util-linux' || name === 'bsdutils',
      depends: depends[name] ?? [],
      files: [`/usr/share/doc/${name}/copyright`, ...ships(name)],
    };
  }
  return { packages: out, audit: '' };
}

/** The stand-in's dpkg database after a build, and the dpkg calls it logged, in order. */
function dpkgOf(box: Sandbox): { db: DpkgDb; calls: string[] } {
  const db = JSON.parse(readFileSync(join(box.root, 'dpkg.json'), 'utf8')) as DpkgDb;
  // No tool log is no tool called.
  const log = existsSync(join(box.root, 'tools.log')) ? readFileSync(join(box.root, 'tools.log'), 'utf8') : '';
  return { db, calls: log.split('\n').filter((l) => /^dpkg(-query)? /.test(l)) };
}

function treeOf(name: Name, plat: string): Tree {
  const supSwap = swapTree('supervisor');
  if (name === 'supervisor') {
    return {
      files: {
        [ROOT_PKG.supervisor]: `{"packageManager":"pnpm@${SWAP.from}"}\n`,
        '/app/packages/core/package.json': '{"version":"4.8.3"}\n',
        [ENTRYPOINT.supervisor]: STAND_IN_ENTRYPOINT,
        ...pnpmCopy('/root', SWAP.from),
        ...pnpmCopy('/home/node', SWAP.from),
        ...NODE_GLOBALS,
        ...supSwap.files,
      },
      binaries: [],
      links: [...NODE_LINKS, ...supSwap.links],
      pnpm: PUBLISHED,
      registry: supSwap.registry,
      standIn: { table: supSwap.table },
    };
  }
  const pkg = (dir: string): Record<string, string> => ({ [`${dir}/package.json`]: '{"main":"lib/main.js"}\n', [`${dir}/lib/main.js`]: 'module.exports = {};\n' });
  const dompurify = dompurifyTree();
  const dpkg = debian12(plat);
  const ts = typescriptTree();
  const swap = swapTree('trigger.dev');
  const goose = GOOSE.assets[plat as Plat];
  return {
    ...dompurify,
    links: [...(dompurify.links ?? []), ...NODE_LINKS, ...ts.links!, ...swap.links],
    pnpm: PUBLISHED,
    registry: { ...dompurify.registry, ...swap.registry, ...(goose ? { [goose.url]: STAND_IN_GOOSE_NEW } : {}) },
    standIn: { ...dompurify.standIn, table: swap.table, goose: sha256(STAND_IN_GOOSE_NEW) },
    executables: { [GOOSE.path]: STAND_IN_GOOSE_OLD },
    tools: gooseTools(),
    dpkg,
    files: {
      [ROOT_PKG['trigger.dev']]: `{"packageManager":"pnpm@${SWAP.from}"}\n`,
      '/triggerdotdev/packages/core/package.json': '{"version":"4.8.3"}\n',
      [ENTRYPOINT['trigger.dev']]: STAND_IN_ENTRYPOINT,
      ...pkg(`${PNPM}/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli`),
      ...pkg(`${PNPM}/esbuild@0.23.0/node_modules/esbuild`),
      // pnpm's own shims are scripts, and stay.
      [`${PNPM}/node_modules/.bin/esbuild`]: '#!/bin/sh\nexec node "$@"\n',
      ...pnpmCopy('/root', SWAP.from),
      ...pnpmCopy('/home/node', SWAP.from),
      ...NODE_GLOBALS,
      ...dompurify.files,
      ...ts.files,
      ...swap.files,
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
      // TypeScript 7's compiler: one name, no postinstall.
      { path: expand(TSC.path, plat) },
    ],
  };
}

/**
 * What corepack's pnpm shim does here, as far as these RUNs ask: the version
 * the nearest package.json's packageManager names, from its copy under HOME,
 * which it trusts by its .corepack file alone; or, without that copy, a
 * refusal offline. Every start is logged: HOME, COREPACK_ENABLE_NETWORK and
 * the arguments.
 */
const PNPM_SHIM = `
const fs = require('fs');
const path = require('path');
const home = process.env.HOME || '';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PNPM_LOG, home + '|' + (process.env.COREPACK_ENABLE_NETWORK || '') + '|' + args.join(' ') + '\\n');
let version = null;
for (let dir = process.cwd(); version === null; dir = path.dirname(dir)) {
  const file = path.join(dir, 'package.json');
  const pm = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).packageManager : undefined;
  if (pm !== undefined) {
    const m = /^pnpm@(\\d+\\.\\d+\\.\\d+)(\\+\\S+)?$/.exec(pm);
    if (!m) { console.error('Usage Error: ' + pm + ' names no pnpm'); process.exit(1); }
    version = m[1];
  } else if (path.dirname(dir) === dir) {
    console.error('Usage Error: no packageManager above ' + process.cwd());
    process.exit(1);
  }
}
if (fs.existsSync(path.join(home, '.cache/node/corepack/v1/pnpm', version, '.corepack'))) {
  if (args[0] === '--version') console.log(version);
  process.exit(0);
}
if (process.env.COREPACK_ENABLE_NETWORK === '0') {
  console.error("Usage Error: Network access disabled by the environment; can't reach npm repository https://registry.npmjs.org");
  process.exit(1);
}
console.error('corepack would download pnpm ' + version + ' here');
process.exit(2);
`;

/**
 * What `corepack install -g pnpm@<version>[+sha512.<hex>]` does, as corepack
 * 0.36.0 does it (installVersion, InstallGlobalCommand): a copy already under
 * HOME is reused by its .corepack file alone, unchecked; otherwise the
 * stand-in registry's pnpm is refused when its sha512 is not the one handed
 * ("Mismatch hashes", writing nothing), or written with a .corepack that
 * records its sha512; and either way lastKnownGood.json names what was asked.
 * Every call is logged: HOME and the arguments.
 */
const COREPACK_STAND_IN = `
const fs = require('fs');
const path = require('path');
const home = process.env.HOME || '';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.COREPACK_LOG, home + '|' + args.join(' ') + '\\n');
const m = args.length === 3 && args[0] === 'install' && args[1] === '-g' ? /^pnpm@(\\d+\\.\\d+\\.\\d+)(?:\\+sha512\\.([0-9a-f]+))?$/.exec(args[2]) : null;
if (!m) { console.error('the stand-in corepack answers install -g pnpm@<version>[+sha512.<hex>] only, not: ' + args.join(' ')); process.exit(3); }
const [, version, hash] = m;
const reference = args[2].slice('pnpm@'.length);
const corepackHome = path.join(home, '.cache/node/corepack');
const target = path.join(corepackHome, 'v1/pnpm', version);
console.log('Installing pnpm@' + reference + '...');
if (!fs.existsSync(path.join(target, '.corepack'))) {
  const published = path.join(process.env.FAKE_REGISTRY, 'pnpm', version + '.json');
  if (!fs.existsSync(published)) { console.error('Internal Error: Server answered with HTTP 404 when performing the request to https://registry.npmjs.org/pnpm/-/pnpm-' + version + '.tgz'); process.exit(1); }
  const { sha512, files } = JSON.parse(fs.readFileSync(published, 'utf8'));
  if (hash !== undefined && hash !== sha512) { console.error('Internal Error: Mismatch hashes. Expected ' + hash + ', got ' + sha512); process.exit(1); }
  for (const [p, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(target, p)), { recursive: true });
    fs.writeFileSync(path.join(target, p), text);
  }
  fs.writeFileSync(path.join(target, '.corepack'), JSON.stringify({ locator: { name: 'pnpm', reference }, bin: { pnpm: 'bin/pnpm.cjs', pnpx: 'bin/pnpx.cjs' }, hash: 'sha512.' + sha512 }));
}
fs.mkdirSync(corepackHome, { recursive: true });
fs.writeFileSync(path.join(corepackHome, 'lastKnownGood.json'), JSON.stringify({ pnpm: reference }, null, 2) + '\\n');
`;

/**
 * What dpkg and dpkg-query do here, as far as the webapp's purge asks, from the
 * stand-in's database (FAKE_DPKG) and never from this machine's: `dpkg-query -W
 * [-f <format>] <names>` and `-L <names>`, and `dpkg --audit` and `--purge
 * [--force-…] <names>`. A purge refuses as dpkg 1.21 does: an Essential
 * package without --force-remove-essential, a protected one without
 * --force-remove-protected, and one that an installed package it does not
 * remove depends on without --force-depends ("dependency problems - not
 * removing"); it goes on with the others and exits 1. What it removes, it
 * removes from the stand-in's tree (FAKE_ROOT) and its database. Anything
 * else is refused, with exit 3. Every call is logged to the tool log.
 */
const DPKG_STAND_IN = `
const fs = require('fs');
const path = require('path');
const [tool, ...args] = process.argv.slice(2);
fs.appendFileSync(process.env.TOOL_LOG, tool + ' ' + args.join(' ') + '\\n');
const file = process.env.FAKE_DPKG;
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const pkgs = db.packages;
const say = (text) => process.stderr.write(text + '\\n');
const refuse = (text) => { say(text); process.exit(3); };
if (tool === 'dpkg-query') {
  let rc = 0;
  let out = '';
  if (args[0] === '-W' && args[1] === '-f' && args.length > 3) {
    for (const n of args.slice(3)) {
      const p = pkgs[n];
      if (!p) { say('dpkg-query: no packages found matching ' + n); rc = 1; continue; }
      const status = (p.status === 'installed' ? 'install ok ' : 'unknown ok ') + p.status;
      out += args[2].split('\${Package}').join(n).split('\${Version}').join(p.version).split('\${db:Status-Status}').join(p.status).split('\${Status}').join(status).split('\\\\n').join('\\n');
    }
  } else if (args[0] === '-W' && args.length > 1 && !args[1].startsWith('-')) {
    for (const n of args.slice(1)) {
      const p = pkgs[n];
      if (!p) { say('dpkg-query: no packages found matching ' + n); rc = 1; continue; }
      out += n + '\\t' + p.version + '\\n';
    }
  } else if (args[0] === '-L' && args.length > 1) {
    const lists = [];
    for (const n of args.slice(1)) {
      const p = pkgs[n];
      if (!p || p.status !== 'installed') { say("dpkg-query: package '" + n + "' is not installed"); rc = 1; continue; }
      lists.push((p.files || []).join('\\n'));
    }
    out = lists.join('\\n\\n') + (lists.length ? '\\n' : '');
  } else refuse('the stand-in dpkg-query answers -W [-f <format>] <names> and -L <names> only, not: ' + args.join(' '));
  process.stdout.write(out);
  process.exit(rc);
}
if (tool === 'dpkg') {
  if (args.length === 1 && args[0] === '--audit') { process.stdout.write(db.audit || ''); process.exit(0); }
  if (args[0] !== '--purge') refuse('the stand-in dpkg answers --audit and --purge only, not: ' + args.join(' '));
  const flags = args.slice(1).filter((a) => a.startsWith('-'));
  const names = args.slice(1).filter((a) => !a.startsWith('-'));
  const known = ['--force-remove-essential', '--force-remove-protected', '--force-depends', '--force-all'];
  for (const f of flags) if (!known.includes(f)) refuse('the stand-in dpkg knows no ' + f);
  const forced = (what) => flags.includes('--force-' + what) || flags.includes('--force-all');
  let rc = 0;
  const going = [];
  for (const n of names) {
    const p = pkgs[n];
    if (!p || p.status !== 'installed') { say('dpkg: warning: ignoring request to remove ' + n + ' which isn' + "'" + 't installed'); continue; }
    if (p.essential && !forced('remove-essential')) { say('dpkg: error processing package ' + n + ' (--purge):\\n this is an essential package; it should not be removed'); rc = 1; continue; }
    if (p.protected && !forced('remove-protected')) { say('dpkg: error processing package ' + n + ' (--purge):\\n this is a protected package; it should not be removed'); rc = 1; continue; }
    const by = Object.keys(pkgs).filter((m) => pkgs[m].status === 'installed' && !names.includes(m) && (pkgs[m].depends || []).includes(n));
    if (by.length && !forced('depends')) {
      say('dpkg: dependency problems prevent removal of ' + n + ':\\n' + by.map((m) => ' ' + m + ' depends on ' + n + '.').join('\\n') + '\\n\\ndpkg: error processing package ' + n + ' (--purge):\\n dependency problems - not removing');
      rc = 1;
      continue;
    }
    going.push(n);
  }
  for (const n of going) {
    for (const f of pkgs[n].files || []) fs.rmSync(path.join(process.env.FAKE_ROOT, f), { force: true });
    console.log('Purging configuration files for ' + n + ' (' + pkgs[n].version + ') ...');
    if (pkgs[n].afterPurge) pkgs[n] = { version: '', status: pkgs[n].afterPurge };
    else delete pkgs[n];
  }
  if (db.auditAfter !== undefined) db.audit = db.auditAfter;
  fs.writeFileSync(file, JSON.stringify(db));
  if (rc) say('Errors were encountered while processing.');
  process.exit(rc);
}
refuse('the stand-in answers dpkg and dpkg-query only, not ' + tool);
`;

/** dumb-init, as far as the purge's proof asks it: its version, as dumb-init 1.2.5 says it (on stderr, exit 0). */
const DUMB_INIT_STAND_IN = ['#!/bin/sh', `printf '%s %s\\n' dumb-init "$*" >> "$TOOL_LOG"`, 'case "$*" in --version) echo "dumb-init v1.2.5" >&2; exit 0 ;; esac', 'exit 3', ''].join('\n');

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
    put(b.path, b.path.endsWith('/lib/tsc') ? STAND_IN_TSC : Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from(`stand-in ${i}\n`)]), 0o755);
    if (b.link) {
      mkdirSync(dirname(join(fs, b.link)), { recursive: true });
      linkSync(join(fs, b.path), join(fs, b.link));
    }
  }
  for (const l of tree.links ?? []) {
    mkdirSync(dirname(join(fs, l.path)), { recursive: true });
    symlinkSync(l.target, join(fs, l.path));
  }
  for (const [path, bytes] of Object.entries(tree.executables ?? {})) put(path, bytes, 0o755);
  for (const [url, bytes] of Object.entries(tree.registry ?? {})) {
    const u = new URL(url);
    mkdirSync(dirname(join(root, 'registry', u.hostname, u.pathname)), { recursive: true });
    writeFileSync(join(root, 'registry', u.hostname, u.pathname), bytes);
  }
  for (const [host, answer] of Object.entries(tree.answers ?? {})) {
    mkdirSync(join(root, 'registry', host), { recursive: true });
    writeFileSync(join(root, 'registry', host, '.answer'), String(answer));
  }
  // mktemp's directory, inside the sandbox, so a RUN that fails leaves nothing behind.
  mkdirSync(join(root, 'tmp'));
  for (const home of ['/root', '/home/node']) mkdirSync(join(fs, home), { recursive: true });
  // corepack's pnpm shim and corepack itself, each a script of this Node's.
  for (const [cmd, script] of [['pnpm', PNPM_SHIM], ['corepack', COREPACK_STAND_IN]] as const) {
    writeFileSync(join(root, `${cmd}.cjs`), script);
    writeFileSync(join(bin, cmd), `#!/bin/sh\nexec '${process.execPath}' '${join(root, `${cmd}.cjs`)}' "$@"\n`, { mode: 0o755 });
  }
  if (tree.pnpm) {
    mkdirSync(join(root, 'registry', 'pnpm'), { recursive: true });
    writeFileSync(join(root, 'registry', 'pnpm', `${tree.pnpm.version}.json`), JSON.stringify({ sha512: tree.pnpm.sha512, files: tree.pnpm.files }));
  }
  // dpkg and dpkg-query are ALWAYS the stand-in's, answering from its own
  // database: a RUN that purges must never reach this machine's dpkg (the
  // guard can run as root), whatever the tree says.
  writeFileSync(join(root, 'dpkg.json'), JSON.stringify(tree.dpkg ?? { packages: {} }));
  writeFileSync(join(root, 'dpkg.cjs'), DPKG_STAND_IN);
  for (const cmd of ['dpkg', 'dpkg-query']) {
    writeFileSync(join(bin, cmd), `#!/bin/sh\nexec '${process.execPath}' '${join(root, 'dpkg.cjs')}' ${cmd} "$@"\n`, { mode: 0o755 });
  }
  writeFileSync(join(bin, 'dumb-init'), DUMB_INIT_STAND_IN, { mode: 0o755 });
  // And no apt at all: the webapp's purge removes it, so a RUN that calls it fails, here as in the image.
  for (const cmd of ['apt', 'apt-get']) {
    writeFileSync(join(bin, cmd), `#!/bin/sh\nprintf '%s %s\\n' ${cmd} "$*" >> "$TOOL_LOG"\necho "${cmd}: the stand-in has no apt, and the image has none after its purge" >&2\nexit 3\n`, { mode: 0o755 });
  }
  for (const [name, script] of Object.entries(tree.tools ?? {})) writeFileSync(join(bin, name), script, { mode: 0o755 });
  // Node itself, told the platform it is asked about, and with no network: a
  // fetch is answered from the stand-in registry, or with a 404.
  writeFileSync(
    join(bin, 'preload.cjs'),
    [
      "for (const k of ['platform', 'arch']) { const v = process.env['FAKE_' + k.toUpperCase()]; if (v) Object.defineProperty(process, k, { value: v }); }",
      "globalThis.fetch = async (url) => { const fs = require('fs'); const path = require('path'); const u = new URL(String(url)); const reg = process.env.FAKE_REGISTRY || '/nonexistent'; const a = path.join(reg, u.hostname, '.answer'); if (fs.existsSync(a)) { const answer = fs.readFileSync(a, 'utf8'); if (answer === 'unreachable') throw Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND ' + u.hostname) }); return new Response('stand-in', { status: Number(answer) }); } const f = path.join(reg, u.hostname, u.pathname); return fs.existsSync(f) ? new Response(fs.readFileSync(f)) : new Response('not in the stand-in registry', { status: 404 }); };",
      '',
    ].join('\n'),
  );
  writeFileSync(join(bin, 'node'), `#!/bin/sh\nexec '${process.execPath}' --require '${join(bin, 'preload.cjs')}' "$@"\n`, { mode: 0o755 });
  return { root, fs, before: walk(fs, fs), standIn: tree.standIn };
}

/** A RUN's script with the image's absolute paths moved under the stand-in's root. */
const rooted = (script: string, fs: string) =>
  script.replace(/(?<=[\s'"=(])\/(triggerdotdev|root|home\/node|app|usr\/local)(?=[/\s'")]|$)/g, `${fs}/$1`);

interface Options {
  readonly plat?: string;
  readonly tag?: string;
  /** Only the RUNs of this user. */
  readonly only?: 'root' | 'node';
  /** Keep the entrypoint hash the Dockerfile pins, which the stand-in's entrypoint is not. */
  readonly pinnedEntrypoint?: boolean;
  /** Keep the trees and integrity the replacing RUNs pin (dompurify's and the swap table's), which the stand-in's are not. */
  readonly pinnedReplacement?: boolean;
  /** Keep tsc's SHA-256 the removing RUN pins, which the stand-in's tsc is not. */
  readonly pinnedTsc?: boolean;
  /** Keep goose's SHA-256 the goose RUN pins, which the stand-in's new goose is not. */
  readonly pinnedGoose?: boolean;
  /** Only the RUNs this picks. */
  readonly pick?: (run: Instruction) => boolean;
}

/** Runs a Dockerfile's RUN instructions in order, each as its USER, and stops at the first that fails. */
function build(text: string, box: Sandbox, { plat = 'linux-arm64', tag = '', only, pinnedEntrypoint = false, pinnedReplacement = false, pinnedTsc = false, pinnedGoose = false, pick }: Options = {}): Run {
  const [platform, arch] = plat.split('-') as [string, string];
  let out = '';
  for (const run of runs(text)) {
    if (only && run.user !== only) continue;
    if (pick && !pick(run)) continue;
    let script = pinnedEntrypoint ? run.args : run.args.replace(/(?<=(^|[;\s])entrypoint_sha256=)[0-9a-f]{64}/, sha256(STAND_IN_ENTRYPOINT));
    const standIn = box.standIn ?? {};
    if (!pinnedReplacement && standIn.fromTree && standIn.toTree && standIn.integrity) {
      script = script
        .replace(/(?<=(^|[;\s])from_tree=)[0-9a-f]{64}/, standIn.fromTree)
        .replace(/(?<=(^|[;\s])to_tree=)[0-9a-f]{64}/, standIn.toTree)
        .replace(/(?<=(^|[;\s])integrity=)sha512-[A-Za-z0-9+/=]+/, standIn.integrity);
    }
    if (!pinnedReplacement && standIn.table) {
      const table = standIn.table;
      script = script.replace(TABLE_ROW, (row: string, name: string, from: string, fromTree: string, to: string, toTree: string, integrity: string) => {
        const s = table[name];
        return s ? row.replace(` ${fromTree} `, ` ${s.fromTree} `).replace(` ${toTree} `, ` ${s.toTree} `).replace(` ${integrity} `, ` ${s.integrity} `) : row;
      });
    }
    if (!pinnedTsc) script = script.replace(/(?<=(^|[;\s])tsc_sha256=)[0-9a-f]{64}/g, sha256(STAND_IN_TSC));
    if (!pinnedGoose && standIn.goose) script = script.replace(/(?<=(^|[;\s])goose_sha256=)[0-9a-f]{64}/g, standIn.goose);
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
        COREPACK_LOG: join(box.root, 'corepack.log'),
        TOOL_LOG: join(box.root, 'tools.log'),
        FAKE_DPKG: join(box.root, 'dpkg.json'),
        FAKE_ROOT: box.fs,
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

/** Every corepack the RUNs ran: the home it ran under (an image path) and its arguments. */
function corepackCalls(box: Sandbox): Array<{ home: string; args: string }> {
  let log: string;
  try {
    log = readFileSync(join(box.root, 'corepack.log'), 'utf8');
  } catch {
    return [];
  }
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [home = '', ...args] = line.split('|');
      return { home: home.slice(box.fs.length), args: args.join('|') };
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
    expect(swap(/^ARG TRIGGER_IMAGE_TAG$/m, 'ARG TRIGGER_IMAGE_TAG=v4.8.3')).toEqual([expect.stringContaining('not one `ARG TRIGGER_IMAGE_TAG` with no default')]);
    expect(swap(/^USER root$/m, 'USER node')).toContainEqual(expect.stringContaining('the removing RUN runs as node, not root'));
    expect(swap(/\n# Upstream's own user, which this image keeps\.\nUSER node\n/, '\n')).toEqual([
      expect.stringContaining('its last USER is root'),
      // Without it the negative proof runs as root, and is no proof.
      'no proof that as node pnpm refuses to start offline',
    ]);
    expect(swap(/rm -r "\$unused"/, 'rm -rf "$unused"')).toEqual([expect.stringContaining('`rm -f` or `rm -rf`')]);
    expect(swap(/rm -r "\$unused" "\$replaced" "\$kept_modules" "\$kept_gyp_bin" "\$npm_dir";/, 'rm -r "$unused" "$replaced" "$kept_modules" "$kept_gyp_bin" "$npm_dir" || true;')).toEqual([expect.stringContaining('`|| true`')]);
    expect(swap(/\s+node -e "require[^\n]*\n/, '\n')).toEqual(['no proof that @depot/cli and esbuild still load without their binary']);
    for (const line of ['ENV COREPACK_HOME=/tmp/corepack', 'COPY pnpm /usr/local/bin/', 'WORKDIR /tmp', 'LABEL x=y', 'CMD ["sh"]']) {
      const text = real.replace(/^(USER root)$/m, `${line}\n$1`);
      expect(shapeProblems('trigger.dev', text), line).toEqual([expect.stringContaining('only FROM, ARG, USER and RUN')]);
    }
    expect(shapeProblems('trigger.dev', `# syntax=docker/dockerfile:1\n${real}`)).toEqual([expect.stringContaining('is a parser directive')]);
    // Read at one release, the FROM's, and refused before anything is removed at any other.
    expect(swap(/^ {4}read_at=v[\d.]+; \\\n/m, '')).toEqual(['the removing RUN names no read_at, the release its reasons were read in']);
    expect(swap(/^( {4}read_at=)v[\d.]+;/m, '$1v4.8.0;')).toEqual([expect.stringContaining('read_at is v4.8.0, and the FROM is v4.8.3')]);
    // What `trigger-version.sh pin` does: the FROM moves, read_at stays, and this says to read again.
    expect(swap(/^(FROM \S+:)v[\d.]+@/m, '$1v4.9.0@')).toEqual([expect.stringContaining('read_at is v4.8.3, and the FROM is v4.9.0: read the header')]);
    expect(swap(/^ {4}\[ "\$core" = "\$read_at" \] \|\| fail [^\n]*\n/m, '')).toEqual([
      'the removing RUN does not refuse an image of another version than read_at before it removes anything',
    ]);
    expect(swap(/^ {4}entrypoint_sha256=[0-9a-f]{64}; \\\n/m, '')).toEqual([expect.stringContaining('does not pin /triggerdotdev/scripts/entrypoint.sh by its SHA-256')]);
    expect(swap(/^ {4}\[ "\$\(sha256sum [^\n]*\n/m, '')).toEqual(['the removing RUN names the entrypoint and its hash, and never compares them']);
    // node-gyp's tree out of the copy that runs, and npm: each check before the first `rm`, and the proofs after the last.
    const named = 'no check, before anything is removed, that no file of the kept copy outside its dist/node_modules names a package inside it but the three read';
    expect(swap(/^ {4}\[ "\$named" = [^\n]*\n/m, '')).toEqual([named]);
    expect(swap(/^ {4}named="\$\(find [^\n]*\n/m, '')).toEqual([named]);
    expect(swap(/^ {4}\[ "\$\(node -p "require\('\$npm_dir\/package\.json'\)\.version"\)" = 11\.19\.1 \][^\n]*\n/m, '')).toEqual(["no check, before anything is removed, that npm is Node 24.22.1's 11.19.1"]);
    expect(swap(/^ {4}\[ ! -e "\$npm_dir\/npmrc" \][^\n]*\n/m, '')).toEqual(['no check, before anything is removed, that npm carries no npmrc, which pnpm would read as its builtin configuration']);
    expect(swap(/^ {4}\[ "\$\(readlink "\$npx_link"\)"[^\n]*\n/m, '')).toEqual(["no check, before anything is removed, that $npx_link is Node's link to npm's bin/npx-cli.js"]);
    expect(swap(/^ {4}\[ "\$into" = [^\n]*\n/m, '')).toEqual(["no check, before anything is removed, that Node's two links are the only ones into npm's directory"]);
    const corepack = /^ {4}\[ "\$\(node -p "require\('\$corepack_dir\/package\.json'\)\.version"\)" = 0\.36\.0 \] \|\| fail [^\n]*\n/m;
    expect(swap(corepack, '')).toEqual([
      'no check, before anything is removed, that corepack is 0.36.0, which runs every pnpm here',
      // The one left is the proof after the removal, which comes after the install too.
      'the removing RUN checks corepack is 0.36.0, whose hash check it relies on, only after the install',
    ]);
    const afterRm = real.replace(/(^ {4}\[ "\$\(node -p "require\('\$corepack_dir\/package\.json'\)\.version"\)" = 0\.36\.0 \] \|\| fail "corepack 0\.36\.0 went with npm\."; \\\n)/m, '');
    expect(afterRm).not.toBe(real);
    expect(shapeProblems('trigger.dev', afterRm)).toEqual(['no proof, after the removal, that corepack 0.36.0 is still there']);
    // A check moved after the first `rm` checks nothing in time.
    const npmrc = /^ {4}\[ ! -e "\$npm_dir\/npmrc" \][^\n]*\n/m;
    const late = real.replace(npmrc, '').replace(/^( {4}rm -r "\$unused" [^\n]*\n)/m, `$1${npmrc.exec(real)![0]}`);
    expect(late).not.toBe(real);
    expect(shapeProblems('trigger.dev', late)).toEqual(['no check, before anything is removed, that npm carries no npmrc, which pnpm would read as its builtin configuration']);
    const proof = /^ {4}\(cd \/triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter @trigger\.dev\/database exec node -e 0\) \|\| fail [^\n]*\n/m;
    const noProof = ['no proof that, without its tar, pnpm runs a command in @trigger.dev/database offline as root, the user trigger-api runs as'];
    expect(swap(proof, '')).toEqual(noProof);
    // The same proof run as node, which has no copy: no proof of the user that runs.
    const line = proof.exec(real)![0];
    const asNode = real.replace(proof, '').replace(/(me=deploy\/compose\/trigger\.dev\/Dockerfile; \\\n)( {4}if \(cd \/triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --version\))/, `$1${line}$2`);
    expect(runs(asNode).filter((r) => r.user === 'node').map((r) => r.args).join('\n')).toContain('--filter @trigger.dev/database exec');
    expect(shapeProblems('trigger.dev', asNode)).toEqual(noProof);
    // A proof moved above the removal, in the same RUN, proves nothing.
    const proofs = /^ {4}\[ "\$\(cd \/triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --version\)" = 10\.34\.9 \] [^\n]*\n {4}\(cd \/triggerdotdev [^\n]*\n/m;
    const both = proofs.exec(real)![0];
    const early = real.replace(proofs, '').replace(/^( {4}rm -r "\$unused" "\$replaced" "\$kept_modules" "\$kept_gyp_bin" "\$npm_dir"; \\\n)/m, `${both}$1`);
    expect(early).not.toBe(real);
    expect(shapeProblems('trigger.dev', early)).toEqual([
      'no proof that pnpm starts offline as root, the user trigger-api runs as',
      ...noProof,
    ]);
    // A proof of the version the image had, not the one the swap installs.
    expect(swap(/(COREPACK_ENABLE_NETWORK=0 pnpm --version\)" = )10\.34\.9/, '$110.33.2')).toEqual(['no proof that pnpm starts offline as root, the user trigger-api runs as']);
    // The supervisor's proofs go the other way round.
    const sup = dockerfiles.supervisor;
    expect(shapeProblems('supervisor', sup.replace(/\n {4}if \(cd \/app && COREPACK_ENABLE_NETWORK=0[\s\S]*?fi; \\/, ''))).toEqual(['no proof that as root pnpm refuses to start offline']);
    const supProof = /^ {4}\(cd \/app && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter supervisor exec node -e 0\) \|\| [^\n]*\n/m;
    expect(sup.replace(supProof, '')).not.toBe(sup);
    expect(shapeProblems('supervisor', sup.replace(supProof, ''))).toEqual([
      'no proof that, without its tar, pnpm runs a command in the supervisor offline as node, the user trigger-supervisor runs as',
    ]);
  });

  it('refuses each way the pnpm swap could slip, in both builds', () => {
    for (const name of NAMES) {
      const real = dockerfiles[name];
      const swap = (from: RegExp, to: string) => {
        const text = real.replace(from, to);
        expect(text, `${name}: ${String(from)} matched nothing`).not.toBe(real);
        return shapeProblems(name, text);
      };
      /** The text with the line `re` names moved to just after the line `to` names. */
      const move = (re: RegExp, to: RegExp) => {
        const line = re.exec(real)?.[0];
        expect(line, `${name}: ${String(re)} matched nothing`).toBeDefined();
        const rest = real.replace(re, '');
        const moved = rest.replace(to, (all) => `${all}${line!}`);
        expect(moved, `${name}: ${String(to)} matched nothing`).not.toBe(rest);
        return shapeProblems(name, moved);
      };
      const rewrite = /^ {4}node -e "const fs = require\('fs'\); const \[file, from, to\][^\n]*\n/m;
      const readBack = /^ {4}\[ "\$pm" = "pnpm@\$pnpm_to" \] \|\| fail [^\n]*\n/m;
      const install = /^ {4}(?:HOME=\/home\/node )?corepack install -g [^\n]*\n/m;
      const removal = /^ {4}rm -r "\$unused" "\$replaced" [^\n]*\n/m;
      // A build that skips the rewrite: corepack, offline, looks for the copy it removed.
      expect(swap(rewrite, '')).toEqual([expect.stringContaining("does not rewrite $root_pkg's packageManager")]);
      // A build that does not read packageManager back.
      expect(swap(readBack, '')).toEqual([expect.stringContaining('does not read packageManager back after the rewrite')]);
      expect(move(readBack, install)).toEqual([expect.stringContaining('does not read packageManager back after the rewrite')]);
      // A build that installs without the hash, or with another, or another version.
      expect(swap(/\+sha512\.\$pnpm_to_sha512" \|\| fail/, '" || fail')).toEqual([expect.stringContaining('does not install pnpm $pnpm_to by the sha512 npm published')]);
      expect(swap(/(?<=pnpm_to_sha512=)[0-9a-f]{128}/, '0'.repeat(128))).toEqual([expect.stringContaining(`pnpm_to_sha512= is ${'0'.repeat(128)}, not ${SWAP.sha512}`)]);
      expect(swap(/(?<=pnpm_to=)10\.34\.9;/, '10.34.8;')).toEqual([expect.stringContaining('pnpm_to= is 10.34.8, not 10.34.9'), expect.stringContaining('installs pnpm $pnpm_to under')]);
      // A build that removes before it installs.
      expect(move(install, removal)).toEqual(expect.arrayContaining(['the removing RUN installs pnpm $pnpm_to only after it has removed something']));
      // A build that rewrites packageManager before it has the copy it names.
      expect(move(rewrite, /^ {4}\[ "\$pm" = "\$pm_upstream" \][^\n]*\n/m)).toEqual(['the removing RUN rewrites packageManager before it has installed pnpm $pnpm_to']);
      // A build that checks nothing of what it installed, or checks it before the install.
      expect(swap(/^ {4}\[ "\$\(node -p "JSON\.parse[^\n]*\n/m, '')).toEqual([expect.stringContaining("no check of the sha512 the new copy's .corepack records")]);
      expect(swap(/^ {4}\[ "\$\(node -p "require\('\$kept\/package\.json'\)\.version"\)"[^\n]*\n/m, '')).toEqual([expect.stringContaining("no check of the new copy's version")]);
      expect(move(/^ {4}\[ "\$named" = [^\n]*\n/m, /^ {4}\[ ! -e "\$kept" \][^\n]*\n/m)).toEqual(['the removing RUN reads the three names before the install, in a copy not there yet']);
      // A build that installs over a copy already there, unchecked, or does not ask whether upstream moved.
      expect(swap(/^ {4}\[ ! -e "\$kept" \][^\n]*\n/m, '')).toEqual([expect.stringContaining('that no copy of pnpm $pnpm_to is there already')]);
      expect(swap(/(?<=\[ "\$pm" = "\$pm_upstream" \] \|\| fail "[^"\n]*)upstream moved pnpm: drop the swap/, 'the image moved')).toEqual([expect.stringContaining('upstream moved pnpm: drop the swap')]);
      // An install into the other user's home.
      if (name === 'supervisor') {
        expect(swap(/(?<=\n {4})HOME=\/home\/node corepack install/, 'corepack install')).toEqual([expect.stringContaining('installs pnpm $pnpm_to under /root, and keeps /home/node/')]);
        expect(swap(/^ {4}chown -R "\$owner" "\$node_corepack"; \\\n/m, '')).toEqual([expect.stringContaining('is not given that owner')]);
        expect(swap(/^ {4}\[ "\$owners" = "\$owner " \][^\n]*\n/m, '')).toEqual([expect.stringContaining('has that one owner')]);
        expect(swap(/^ {4}owner="\$\(stat [^\n]*\n/m, '')).toEqual([expect.stringContaining("no read, before the install, of the owner of node's copy")]);
        expect(move(/^ {4}chown -R "\$owner" "\$node_corepack"; \\\n/m, removal)).toEqual(expect.arrayContaining([expect.stringContaining('is not given that owner')]));
      } else {
        expect(swap(/(?<=\n {4})corepack install/, 'HOME=/home/node corepack install')).toEqual([expect.stringContaining('installs pnpm $pnpm_to under /home/node, and keeps /root/')]);
      }
      // A build that removes 10.33.2 and never checks it gone.
      expect(swap(/(for p in "\$unused") "\$replaced"/, '$1')).toEqual(['the removing RUN removes $replaced and never checks it gone']);
      // A build that does not look, after the removals, for a copy of another version in either home.
      const keptAlone = /^ {4}\[ "\$pnpm_copies" = "\$pnpm_to " \][^\n]*\n/m;
      const otherNone = /^ {4}\[ -z "\$pnpm_copies" \][^\n]*\n/m;
      expect(swap(keptAlone, '')).toEqual([expect.stringContaining("no check, after the removals, that the kept copy's home holds pnpm $pnpm_to alone")]);
      expect(swap(otherNone, '')).toEqual([expect.stringContaining("no check, after the removals, that the other user's home holds no copy of pnpm")]);
      expect(move(keptAlone, install)).toEqual([expect.stringContaining("no check, after the removals, that the kept copy's home holds pnpm $pnpm_to alone")]);
      // A build that leaves 10.33.2 behind: the RUN removes other paths than REMOVED (the REMOVED test fails).
      const left = real.replace(/(rm -r "\$unused") "\$replaced"/, '$1');
      expect(left).not.toBe(real);
      expect(rmTargets(removingRun(left)!.args)).not.toContain(COPY(name === 'trigger.dev' ? '/root' : '/home/node', SWAP.from));
      expect(rmTargets(removingRun(left)!.args).sort()).not.toEqual(REMOVED[name].map((r) => r.path).sort());
    }
  });

  it('SWAP is what both removing RUNs name: npm\'s integrity, as hex, past its floor', () => {
    expect(Buffer.from(SWAP.integrity.slice('sha512-'.length), 'base64').toString('hex')).toBe(SWAP.sha512);
    expect(SWAP.why.length).toBeGreaterThan(60);
    expect(SWAP.evidence.length).toBeGreaterThan(30);
    // Three days old when it was taken, 2026-11-02 (CONTRIBUTING.md).
    expect(Date.parse('2026-11-02T00:00:00Z') - Date.parse(SWAP.published)).toBeGreaterThan(3 * 24 * 3600 * 1000);
    for (const name of NAMES) {
      const vars = resolvedAssignments(removingRun(dockerfiles[name])!.args);
      expect([vars.get('pm_upstream'), vars.get('pnpm_to'), vars.get('pnpm_to_sha512'), vars.get('root_pkg')], name).toEqual([`pnpm@${SWAP.from}`, SWAP.to, SWAP.sha512, ROOT_PKG[name]]);
      // And each header says it, with the way out.
      expect(dockerfiles[name], name).toContain('WHAT IS REPLACED: PNPM');
    }
    expect(dockerfiles['trigger.dev']).toContain('upstream moved pnpm: drop the swap');
    expect(dockerfiles['trigger.dev']).toContain('triggerdotdev/trigger.dev#5084');
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
          const run = build(dockerfiles[name], box, { plat, tag: 'v4.8.3' });
          expect(run.status, run.out).toBe(0);
          const home = name === 'trigger.dev' ? '/root' : '/home/node';
          const kept = COPY(home, SWAP.to);
          // What the image had is gone; what the install brought and the RUN removed, the new copy's node-gyp tree, is not left either.
          const installed = (path: string) => path.startsWith(`${kept}/`);
          expect(removedBy(box, run)).toEqual(REMOVED[name].map((r) => expand(r.path, plat)).filter((path) => !installed(path)).sort());
          for (const r of REMOVED[name].filter((r) => installed(r.path))) {
            expect(Object.keys(PUBLISHED.files).some((f) => `${kept}/${f}`.startsWith(`${r.path}/`)), `${r.path} is no path the install brings`).toBe(true);
            expect(run.left.filter((path) => path === r.path || path.startsWith(`${r.path}/`)), r.path).toEqual([]);
          }
          expect(run.left).toContain(`${kept}/.corepack`);
          // The swap: installed under the service's user's home by the sha512 npm published, 10.33.2 gone from both homes, packageManager rewritten.
          expect(corepackCalls(box)).toEqual([{ home, args: `install -g pnpm@${SWAP.to}+sha512.${SWAP.sha512}` }]);
          expect(JSON.parse(readFileSync(join(box.fs, kept, '.corepack'), 'utf8')).hash).toBe(`sha512.${SWAP.sha512}`);
          expect(JSON.parse(readFileSync(join(box.fs, COREPACK_HOME(home), 'lastKnownGood.json'), 'utf8'))).toEqual({ pnpm: `${SWAP.to}+sha512.${SWAP.sha512}` });
          expect(run.left.filter((p) => p.includes(`/v1/pnpm/${SWAP.from}`))).toEqual([]);
          expect(JSON.parse(readFileSync(join(box.fs, ROOT_PKG[name]), 'utf8'))).toEqual({ packageManager: `pnpm@${SWAP.to}` });
          expect(run.pnpm).toContainEqual({ home, network: '0', args: '--version' });
          // The copy that runs keeps what pnpm runs, without node-gyp's tree, and ran a command offline as the service's user.
          expect(run.left).toEqual(expect.arrayContaining([`${kept}/bin/pnpm.cjs`, `${kept}/dist/pnpm.cjs`, `${kept}/dist/worker.js`]));
          expect(run.left.filter((p) => p.startsWith(`${kept}/dist/node_modules`) || p.startsWith(`${kept}/dist/node-gyp-bin`))).toEqual([]);
          // npm and its links are gone; corepack and its shims stay.
          expect(run.left.filter((p) => p.startsWith(NPM_DIR) || p === '/usr/local/bin/npm' || p === '/usr/local/bin/npx')).toEqual([]);
          expect(run.left).toEqual(expect.arrayContaining([`${COREPACK_DIR}/package.json`, `${COREPACK_DIR}/dist/pnpm.js`, '/usr/local/bin/corepack', '/usr/local/bin/pnpm']));
          expect(run.out).toContain('corepack 0.36.0 stays');
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
        const run = build(dockerfiles[name], box, { plat: 'linux-x64', tag: 'v4.9.0' });
        expect(run.status).not.toBe(0);
        expect(run.out).toContain('the .env names TRIGGER_IMAGE_TAG=v4.9.0, and this checkout builds Trigger.dev v4.8.3');
        expect(removedBy(box, run), name).toEqual([]);
      });
    }
  });

  it('an image of another release than read_at, or another entrypoint than the one read, refuses before anything is removed', () => {
    for (const name of NAMES) {
      const tree = treeOf(name, 'linux-x64');
      const core = name === 'trigger.dev' ? '/triggerdotdev/packages/core/package.json' : '/app/packages/core/package.json';
      // The .env agrees with the image (or names nothing): the release still is not the one read.
      for (const tag of ['', 'v4.9.0']) {
        withSandbox({ ...tree, files: { ...tree.files, [core]: '{"version":"4.9.0"}\n' } }, (box) => {
          const run = build(dockerfiles[name], box, { plat: 'linux-x64', tag });
          expect(run.status, `${name}, TRIGGER_IMAGE_TAG=${tag}`).not.toBe(0);
          expect(run.out).toContain(`was read in Trigger.dev v4.8.3's source, and this image is v4.9.0`);
          expect(run.out).toContain('then move read_at');
          expect(removedBy(box, run), name).toEqual([]);
        });
      }
      // The pinned hash, which the stand-in's entrypoint is not: a changed entrypoint.
      withSandbox(tree, (box) => {
        const run = build(dockerfiles[name], box, { plat: 'linux-x64', pinnedEntrypoint: true });
        expect(run.status, name).not.toBe(0);
        expect(run.out).toContain(`${box.fs}${ENTRYPOINT[name]} is not the one read at v4.8.3`);
        expect(removedBy(box, run), name).toEqual([]);
      });
    }
  });

  it('every path it removes or keeps that is not there fails the build by name, before anything is removed', () => {
    const plat = 'linux-arm64';
    /** What the build reads of npm and of corepack, and what each failure names. */
    const npmAndCorepack: Array<[string, string]> = [
      [`${NPM_DIR}/package.json`, `${NPM_DIR} is not there`],
      ['/usr/local/bin/npm', "/usr/local/bin/npm is not Node's link"],
      ['/usr/local/bin/npx', "/usr/local/bin/npx is not Node's link"],
      [`${COREPACK_DIR}/package.json`, `${COREPACK_DIR} is not corepack 0.36.0`],
    ];
    /** Each file of the stand-in the build reads, and what its failure names. */
    const NEEDED: Readonly<Record<Name, ReadonlyArray<[string, string]>>> = {
      'trigger.dev': [
        ...treeOf('trigger.dev', plat).binaries.flatMap((b) => (b.link ? [b.path, b.link] : [b.path])).map((p): [string, string] => [p, p]),
        [`${TSC.typescript}/package.json`, TSC.typescript],
        [`${TSC.prisma}/package.json`, TSC.prisma],
        ['/triggerdotdev/package.json', '/triggerdotdev/package.json'],
        ['/triggerdotdev/packages/core/package.json', '/triggerdotdev/packages/core/package.json'],
        [ENTRYPOINT['trigger.dev'], ENTRYPOINT['trigger.dev']],
        [`${COPY('/home/node', SWAP.from)}/.corepack`, `${COPY('/home/node', SWAP.from)}/.corepack`],
        [`${COPY('/home/node', SWAP.from)}/dist/node_modules/tar`, `${COPY('/home/node', SWAP.from)}/dist/node_modules/tar`],
        [`${COPY('/root', SWAP.from)}/.corepack`, `${COPY('/root', SWAP.from)}/.corepack`],
        ...npmAndCorepack,
      ],
      supervisor: [
        ['/app/package.json', '/app/package.json'],
        ['/app/packages/core/package.json', '/app/packages/core/package.json'],
        [ENTRYPOINT.supervisor, ENTRYPOINT.supervisor],
        [`${COPY('/root', SWAP.from)}/.corepack`, `${COPY('/root', SWAP.from)}/.corepack`],
        [`${COPY('/root', SWAP.from)}/dist/node_modules/tar`, `${COPY('/root', SWAP.from)}/dist/node_modules/tar`],
        [`${COPY('/home/node', SWAP.from)}/.corepack`, `${COPY('/home/node', SWAP.from)}/.corepack`],
        ...npmAndCorepack,
      ],
    };
    for (const name of NAMES) {
      const tree = treeOf(name, plat);
      for (const [path, named] of NEEDED[name]) {
        const without: Tree = {
          ...tree,
          // A file, or a directory with all that is in it, or a link.
          files: Object.fromEntries(Object.entries(tree.files).filter(([p]) => p !== path && !p.startsWith(`${path}/`))),
          binaries: tree.binaries.filter((b) => b.path !== path).map((b) => (b.link === path ? { path: b.path } : b)),
          links: (tree.links ?? []).filter((l) => l.path !== path),
        };
        expect(JSON.stringify(without), `${path} is not in the stand-in`).not.toBe(JSON.stringify(tree));
        withSandbox(without, (box) => {
          const run = build(dockerfiles[name], box, { plat, tag: 'v4.8.3' });
          expect(run.status, `${name} built without ${path}`).not.toBe(0);
          expect(run.out, `${name} without ${path} did not say which`).toContain(`${box.fs}${named}`);
          expect(removedBy(box, run), `${name} removed something before it failed without ${path}`).toEqual([]);
          // Every one of these is checked before the install, too.
          expect(corepackCalls(box), `${name} installed pnpm before it failed without ${path}`).toEqual([]);
        });
      }
    }
  });

  it('a copy of pnpm the install did not make as read, or did not make at all, fails it, before anything is removed', () => {
    for (const name of NAMES) {
      const tree = treeOf(name, 'linux-arm64');
      const home = name === 'trigger.dev' ? '/root' : '/home/node';
      const kept = COPY(home, SWAP.to);
      const published = (files: Record<string, string>, sha512 = SWAP.sha512): Tree => ({ ...tree, pnpm: { version: SWAP.to, sha512, files } });
      const dropping = (prefix: string) => published(Object.fromEntries(Object.entries(PUBLISHED.files).filter(([p]) => p !== prefix && !p.startsWith(`${prefix}/`))));
      const cases: ReadonlyArray<[string, Tree, (fs: string) => string]> = [
        ["a pnpm without node-gyp's bin where it was read", dropping('dist/node_modules/node-gyp/bin/node-gyp.js'), (fs) => `${fs}${kept}/dist/node_modules/node-gyp/bin/node-gyp.js is not there`],
        ["a pnpm without node-gyp's shim", dropping('dist/node-gyp-bin'), (fs) => `${fs}${kept}/dist/node-gyp-bin is not there`],
        ['a pnpm that names another version', published({ ...PUBLISHED.files, 'package.json': '{"name":"pnpm","version":"10.34.8"}\n' }), (fs) => `${fs}${kept} is not pnpm ${SWAP.to}.`],
        // The registry serves other bytes: corepack refuses them and writes nothing.
        ['a registry that serves other bytes', published(PUBLISHED.files, 'e'.repeat(128)), () => `Mismatch hashes. Expected ${SWAP.sha512}, got ${'e'.repeat(128)}`],
        ['a registry without the release', { ...tree, pnpm: undefined }, () => `corepack did not install pnpm ${SWAP.to} by the sha512 npm published for it; nothing is removed yet.`],
        // A copy of 10.34.9 already there would be reused unchecked: refused before the install.
        ['a copy of 10.34.9 already in the home', { ...tree, files: { ...tree.files, ...pnpmCopy(home, SWAP.to) } }, (fs) => `${fs}${kept} is there already: corepack would reuse it by its .corepack file alone, unchecked`],
        // What pnpm's own files name of the tree: one more, or one fewer, is a pnpm read for something else.
        ['a pnpm whose worker.js requires tar', published({ ...PUBLISHED.files, 'dist/worker.js': 'const tar = require("tar");\n' }), (fs) => `${fs}${kept}/dist/worker.js:require(tar `],
      ];
      for (const [what, changed, said] of cases) {
        withSandbox(changed, (box) => {
          const run = build(dockerfiles[name], box, { plat: 'linux-arm64', tag: 'v4.8.3' });
          expect(run.status, `${name}, ${what}: ${run.out}`).not.toBe(0);
          expect(run.out, `${name}, ${what}`).toContain(said(box.fs));
          expect(removedBy(box, run), `${name}, ${what}`).toEqual([]);
          expect(readFileSync(join(box.fs, ROOT_PKG[name]), 'utf8'), `${name}, ${what}`).toContain(`pnpm@${SWAP.from}`);
          if (what.startsWith('a registry')) expect(run.left.filter((p) => p.startsWith(kept)), `${name}, ${what}: corepack wrote a copy`).toEqual([]);
        });
      }
    }
  });

  it('a copy of pnpm of another version in either home, which the build was not read for, fails it after the removals', () => {
    for (const name of NAMES) {
      const tree = treeOf(name, 'linux-arm64');
      const home = name === 'trigger.dev' ? '/root' : '/home/node';
      const other = name === 'trigger.dev' ? '/home/node' : '/root';
      // The service's user's home with a copy beside 10.34.9, and the other user's with any copy at all (10.34.9's too, which the proof as that user would catch only later).
      const cases: ReadonlyArray<[string, string, string]> = [
        [home, '10.30.0', 'holds'],
        [home, '9.15.9', 'holds'],
        [other, '10.30.0', 'still holds'],
        [other, SWAP.to, 'still holds'],
      ];
      for (const [where, version, says] of cases) {
        withSandbox({ ...tree, files: { ...tree.files, ...pnpmCopy(where, version) } }, (box) => {
          const run = build(dockerfiles[name], box, { tag: 'v4.8.3' });
          const what = `${name}, a copy of ${version} under ${where}`;
          expect(run.status, `${what}: ${run.out}`).not.toBe(0);
          const dir = `${box.fs}${where}/.cache/node/corepack/v1/pnpm`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          expect(run.out, what).toMatch(new RegExp(`${dir} ${says} [^\\n]*${version.replaceAll('.', '\\.')}[^\\n]*: a copy this file was not read for\\.`));
          expect(run.left, what).toContain(`${COPY(where, version)}/.corepack`);
        });
      }
    }
  });

  it('a build that skips the rewrite, or its read-back, or a package.json that names packageManager twice, starts no pnpm', () => {
    for (const name of NAMES) {
      const real = dockerfiles[name];
      const rewrite = /^ {4}node -e "const fs = require\('fs'\); const \[file, from, to\][^\n]*\n/m;
      const readBack = /^ {4}pm="\$\(node -p "require\('\$root_pkg'\)\.packageManager"\)"; \\\n {4}\[ "\$pm" = "pnpm@\$pnpm_to" \] \|\| fail [^\n]*\n/m;
      expect(readBack.test(real), name).toBe(true);
      // Without the rewrite, the read-back stops the build.
      withSandbox(treeOf(name, 'linux-arm64'), (box) => {
        const run = build(real.replace(rewrite, ''), box, { tag: 'v4.8.3' });
        expect(run.status, name).not.toBe(0);
        expect(run.out).toContain(`${box.fs}${ROOT_PKG[name]} names pnpm@${SWAP.from} after the rewrite, not pnpm@${SWAP.to}`);
      });
      // Without both, the proof as the service's user does: corepack, offline, looks for the copy the build removed.
      withSandbox(treeOf(name, 'linux-arm64'), (box) => {
        const run = build(real.replace(rewrite, '').replace(readBack, ''), box, { tag: 'v4.8.3' });
        expect(run.status, name).not.toBe(0);
        expect(run.out).toContain('Network access disabled by the environment');
        expect(run.out).toContain(name === 'trigger.dev' ? 'as root, the user trigger-api runs as, pnpm 10.34.9 does not start offline' : 'as node, the user trigger-supervisor runs as, pnpm 10.34.9 does not start offline');
      });
      // A package.json that names it twice: the rewrite refuses to choose.
      const tree = treeOf(name, 'linux-arm64');
      const twice = `{"packageManager": "pnpm@${SWAP.from}", "devEngines": {"packageManager": "pnpm@${SWAP.from}"}}\n`;
      withSandbox({ ...tree, files: { ...tree.files, [ROOT_PKG[name]]: twice } }, (box) => {
        const run = build(real, box, { tag: 'v4.8.3' });
        expect(run.status, name).not.toBe(0);
        expect(run.out).toContain(`names packageManager as: pnpm@${SWAP.from}, pnpm@${SWAP.from}`);
        expect(run.out).toContain(`${box.fs}${ROOT_PKG[name]}'s packageManager was not rewritten to pnpm@${SWAP.to}`);
        expect(readFileSync(join(box.fs, ROOT_PKG[name]), 'utf8')).toBe(twice);
      });
      // The file's own spacing is kept: one field moves, and nothing else of the file.
      const spaced = `{\n  "name": "triggerdotdev",\n  "packageManager": "pnpm@${SWAP.from}",\n  "private": true\n}\n`;
      withSandbox({ ...tree, files: { ...tree.files, [ROOT_PKG[name]]: spaced } }, (box) => {
        const run = build(real, box, { tag: 'v4.8.3' });
        expect(run.status, run.out).toBe(0);
        expect(readFileSync(join(box.fs, ROOT_PKG[name]), 'utf8')).toBe(spaced.replace(`pnpm@${SWAP.from}`, `pnpm@${SWAP.to}`));
      });
    }
  });

  it("the supervisor gives node's owner to node's whole corepack home after the install, and checks no other owner is left", () => {
    // The stand-in's files all belong to the user running this, so the owner
    // they end with proves nothing: stat answers another owner for node's
    // 10.33.2 and for whatever chown was handed, and chown is recorded and
    // answered without changing any.
    const realStat = systemCommand('stat');
    // Given to the new copy alone, lastKnownGood.json keeps root's owner: refused, before anything is removed.
    const narrow = dockerfiles.supervisor.replace('chown -R "$owner" "$node_corepack";', 'chown -R "$owner" "$kept";');
    const tools = {
      chown: ['#!/bin/sh', `printf '%s %s\\n' chown "$*" >> "$TOOL_LOG"`, `printf '%s\\n' "$3" >> "$TOOL_LOG.chowned"`, 'exit 0', ''].join('\n'),
      stat: [
        '#!/bin/sh',
        'case "$1 $2" in "-c %u:%g") ;; *) exec ' + `'${realStat}'` + ' "$@" ;; esac',
        'shift 2',
        'for f; do',
        '  case "$f" in */' + SWAP.from + '/.corepack) echo 4242:4343; continue ;; esac',
        '  c=; while read -r d; do case "$f" in "$d"|"$d"/*) c=1 ;; esac; done 2>/dev/null < "$TOOL_LOG.chowned"',
        `  if [ -n "$c" ]; then echo 4242:4343; else '${realStat}' -c %u:%g "$f"; fi`,
        'done',
        '',
      ].join('\n'),
    };
    // The removing RUN alone: the swap table's RUN after it gives the new systeminformation the old one's owner, with a chown of its own.
    const removingOnly = { pick: (run: Instruction) => run.args.includes('corepack install -g') };
    withSandbox({ ...treeOf('supervisor', 'linux-arm64'), tools }, (box) => {
      const run = build(dockerfiles.supervisor, box, { only: 'root', tag: 'v4.8.3', ...removingOnly });
      expect(run.status, run.out).toBe(0);
      const chowns = readFileSync(join(box.root, 'tools.log'), 'utf8').split('\n').filter((l) => l.startsWith('chown '));
      expect(chowns).toEqual([`chown -R 4242:4343 ${box.fs}${COREPACK_HOME('/home/node')}`]);
    });
    expect(narrow).not.toBe(dockerfiles.supervisor);
    withSandbox({ ...treeOf('supervisor', 'linux-arm64'), tools }, (box) => {
      const run = build(narrow, box, { only: 'root', tag: 'v4.8.3', ...removingOnly });
      expect(run.status).not.toBe(0);
      // Two owners: the new copy's, given, and root's on what the chown passed over (lastKnownGood.json, v1, v1/pnpm).
      expect(run.out).toMatch(/\/home\/node\/\.cache\/node\/corepack the owners are (?:\S+ ){2}, not 4242:4343 alone/);
      expect(removedBy(box, run)).toEqual([]);
    });
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
      // Upstream moved pnpm, past 10.33.2 or to the very version the swap installs: drop the swap.
      for (const moved of ['10.34.8', SWAP.to]) {
        withSandbox({ ...tree, files: { ...tree.files, [at]: `{"packageManager":"pnpm@${moved}"}\n` } }, (box) => {
          const run = build(dockerfiles[name], box, { plat });
          expect(run.status).not.toBe(0);
          expect(run.out).toContain(`the image names pnpm@${moved}, not pnpm@${SWAP.from}`);
          expect(run.out).toContain('upstream moved pnpm: drop the swap');
          expect(run.out).toContain("re-read this file's header against the new tag, or drop the removal upstream fixed");
          expect(removedBy(box, run)).toEqual([]);
          expect(corepackCalls(box)).toEqual([]);
        });
      }
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
      expect(run.out).toContain(`a depot, esbuild or tsc binary is still there: ${box.fs}${other}`);
    });
  });

  it("a file of the copy that runs, outside its dist/node_modules, naming another package of it, or not the three read, fails it, before anything is removed", () => {
    for (const name of NAMES) {
      const tree = treeOf(name, 'linux-arm64');
      // The copy that runs is the one the swap installs: its files are the published pnpm's.
      const copy = COPY(name === 'trigger.dev' ? '/root' : '/home/node', SWAP.to);
      const pnpmCjs = PUBLISHED.files['dist/pnpm.cjs']!;
      /** Each change to the published pnpm's own files, and what the failure names of it (after the stand-in's root). */
      const cases: ReadonlyArray<[string, Record<string, string>, string]> = [
        ['worker.js requires tar', { 'dist/worker.js': 'const tar = require("tar");\n' }, `${copy}/dist/worker.js:require(tar `],
        ['pnpm.cjs imports a file of a scoped package', { 'dist/pnpm.cjs': `${pnpmCjs}import('@npmcli/agent/lib/index.js');\n` }, `${copy}/dist/pnpm.cjs:import(@npmcli/agent/lib/index.js `],
        ['bin/pnpx.cjs resolves brace-expansion', { 'bin/pnpx.cjs': "require.resolve('brace-expansion')\n" }, `${copy}/bin/pnpx.cjs:require.resolve(brace-expansion `],
        ['pnpm.cjs resolves picomatch no more', { 'dist/pnpm.cjs': pnpmCjs.replace(/^try \{ require\.resolve\("picomatch"\);[^\n]*\n/m, '') }, `${copy}/dist/pnpm.cjs:resolveFrom(__dirname, node-gyp/bin/node-gyp ; this file was read for three`],
        // 10.34.9's tree has content-type, which no file of it names; naming it is a pnpm read for something else.
        ['pnpm.cjs requires content-type', { 'dist/pnpm.cjs': `${pnpmCjs}require("content-type");\n` }, `${copy}/dist/pnpm.cjs:require(content-type `],
      ];
      for (const [what, files, named] of cases) {
        expect(JSON.stringify({ ...PUBLISHED.files, ...files }), what).not.toBe(JSON.stringify(PUBLISHED.files));
        withSandbox({ ...tree, pnpm: { ...PUBLISHED, files: { ...PUBLISHED.files, ...files } } }, (box) => {
          const run = build(dockerfiles[name], box, { tag: 'v4.8.3' });
          expect(run.status, `${name}, ${what}`).not.toBe(0);
          expect(run.out, `${name}, ${what}`).toContain(`these name a package inside it: ${box.fs}${copy}/bin/pnpm.cjs:require(v8-compile-cache `);
          expect(run.out, `${name}, ${what}`).toContain(`${box.fs}${named}`);
          expect(removedBy(box, run), `${name}, ${what}`).toEqual([]);
        });
      }
      // A name that only begins like a package of the tree is no package of it: the stand-in's tar-stream builds.
      expect(pnpmCjs).toContain('require("tar-stream")');
    }
  });

  it("npm that is not Node's 11.19.1, an npmrc in it, a link that is not Node's, a third link into it, or another corepack fails it, before anything is removed", () => {
    for (const name of NAMES) {
      const tree = treeOf(name, 'linux-x64');
      const relink = (path: string, target: string): Tree => ({ ...tree, links: tree.links!.map((l) => (l.path === path ? { path, target } : l)) });
      const cases: ReadonlyArray<[string, Tree, (fs: string) => string]> = [
        ['another npm', { ...tree, files: { ...tree.files, [`${NPM_DIR}/package.json`]: '{"name":"npm","version":"11.20.0"}\n' } }, (fs) => `${fs}${NPM_DIR} is not npm 11.19.1`],
        ['an npmrc in npm', { ...tree, files: { ...tree.files, [`${NPM_DIR}/npmrc`]: 'update-notifier=false\n' } }, (fs) => `${fs}${NPM_DIR}/npmrc is there: pnpm reads it`],
        ["npm's link made by corepack", relink('/usr/local/bin/npm', '../lib/node_modules/corepack/dist/npm.js'), (fs) => `${fs}/usr/local/bin/npm is not Node's link to npm's bin/npm-cli.js.`],
        ["npx's link to npm's cli", relink('/usr/local/bin/npx', '../lib/node_modules/npm/bin/npm-cli.js'), (fs) => `${fs}/usr/local/bin/npx is not Node's link to npm's bin/npx-cli.js.`],
        [
          'a third link into npm',
          { ...tree, links: [...tree.links!, { path: '/usr/local/bin/node-gyp', target: '../lib/node_modules/npm/bin/npm-cli.js' }] },
          (fs) => `these link into ${fs}${NPM_DIR}: ${fs}/usr/local/bin/node-gyp ${fs}/usr/local/bin/npm ${fs}/usr/local/bin/npx , not npm and npx alone.`,
        ],
        ['another corepack', { ...tree, files: { ...tree.files, [`${COREPACK_DIR}/package.json`]: '{"name":"corepack","version":"0.34.0"}\n' } }, (fs) => `${fs}${COREPACK_DIR} is not corepack 0.36.0`],
      ];
      for (const [what, changed, said] of cases) {
        withSandbox(changed, (box) => {
          const run = build(dockerfiles[name], box, { plat: 'linux-x64', tag: 'v4.8.3' });
          expect(run.status, `${name}, ${what}`).not.toBe(0);
          expect(run.out, `${name}, ${what}`).toContain(said(box.fs));
          expect(removedBy(box, run), `${name}, ${what}`).toEqual([]);
        });
      }
    }
  });

  it("the proof as the other user fails while that user's copy is there: a start as it would reach for the registry", () => {
    // The webapp's node RUN, on an image whose root RUN removed nothing.
    withSandbox(treeOf('trigger.dev', 'linux-arm64'), (box) => {
      const run = build(dockerfiles['trigger.dev'], box, { only: 'node' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('as node, pnpm still starts offline');
    });
    // The supervisor's node RUN, on an image whose packageManager names 10.34.9 and whose node has no copy of it.
    const tree = treeOf('supervisor', 'linux-arm64');
    const rewritten = { ...tree.files, [ROOT_PKG.supervisor]: `{"packageManager":"pnpm@${SWAP.to}"}\n` };
    const files = Object.fromEntries(Object.entries(rewritten).filter(([p]) => !p.startsWith(COPY('/home/node', SWAP.from))));
    withSandbox({ ...tree, files }, (box) => {
      const run = build(dockerfiles.supervisor, box, { only: 'node' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('as node, the user trigger-supervisor runs as, pnpm 10.34.9 does not start offline');
      expect(run.out).toContain('Network access disabled by the environment');
    });
    // And on one whose packageManager still names 10.33.2, node's copy of it there: a pnpm starts, but not the one the swap installs.
    withSandbox(tree, (box) => {
      const run = build(dockerfiles.supervisor, box, { only: 'node' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('as node, the user trigger-supervisor runs as, pnpm 10.34.9 does not start offline');
      expect(run.pnpm).toContainEqual({ home: '/home/node', network: '0', args: '--version' });
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
      expect(found.length, name).toBe(ownRunRows(name).length);
      for (const [i, r] of ownRunRows(name).entries()) {
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
      ['a registry that has no such tarball', { ...base, registry: {} }, () => `${DOMPURIFY.url} is gone (above): its publisher no longer serves it; nothing was changed, and upstream did not move.`],
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
// Since 2026-11-03: TypeScript 7's tsc goes, four packages are swapped by one table (five since 2026-11-06), and goose is the release's binary.

/** The text with the first line `re` matches taken out. */
function dropLine(text: string, re: RegExp): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => re.test(l));
  expect(i, `${String(re)} matched no line`).toBeGreaterThanOrEqual(0);
  return [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n');
}

/** The text with the first line `re` matches moved to just after the first line `to` matches. */
function moveLine(text: string, re: RegExp, to: RegExp): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => re.test(l));
  expect(i, `${String(re)} matched no line`).toBeGreaterThanOrEqual(0);
  const line = lines[i]!;
  const rest = [...lines.slice(0, i), ...lines.slice(i + 1)];
  const j = rest.findIndex((l) => to.test(l));
  expect(j, `${String(to)} matched no line`).toBeGreaterThanOrEqual(0);
  return [...rest.slice(0, j + 1), line, ...rest.slice(j + 1)].join('\n');
}

/** The text with a line put in right after the first line `re` matches. */
function insertAfter(text: string, re: RegExp, line: string): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => re.test(l));
  expect(i, `${String(re)} matched no line`).toBeGreaterThanOrEqual(0);
  return [...lines.slice(0, i + 1), `    ${line} \\`, ...lines.slice(i + 1)].join('\n');
}

const tableOnly = { pick: (run: Instruction) => /(^|[;\s])rows\(\) \{/.test(run.args) };
const gooseOnly = { pick: (run: Instruction) => /(^|[;\s])goose=\/usr\/local\/bin\/goose;/.test(run.args) };
const removingOnlyRun = { pick: (run: Instruction) => run.args.includes('corepack install -g') };

describe("the webapp's build removes TypeScript 7's native compiler by its published hash, and typescript still resolves", () => {
  const webapp = dockerfiles['trigger.dev'];

  it('checks tsc before the removal and proves typescript after it', () => {
    expect(tscProblems(removingRun(webapp)!.args)).toEqual([]);
    expect(REMOVED['trigger.dev'].map((r) => r.path)).toContain(TSC.path);
    for (const plat of PLATFORMS) expect(TSC.sha256[plat], plat).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses each way the removal of tsc could slip', () => {
    const problems = (text: string) => shapeProblems('trigger.dev', text);
    expect(problems(dropLine(webapp, /\[ "\$\(sha256sum "\$tsc_bin"/))).toEqual(["no check, before anything is removed, that tsc is TypeScript 7.0.2's, by its SHA-256"]);
    expect(problems(dropLine(webapp, /\[ "\$\(stat -c %h "\$tsc_bin"\)" = 1 \]/))).toEqual(['no check, before anything is removed, that tsc has one name, which Trivy would not see a second of']);
    expect(problems(dropLine(webapp, /^ {4}\[ "\$magic" = 7f454c46 \] \|\| fail "\$tsc_bin/))).toEqual(['no check, before anything is removed, that tsc is an ELF']);
    expect(problems(moveLine(webapp, /\[ "\$\(sha256sum "\$tsc_bin"/, /^ {4}rm "\$depot_bin"/))).toEqual(["no check, before anything is removed, that tsc is TypeScript 7.0.2's, by its SHA-256"]);
    expect(problems(webapp.replace(TSC.sha256['linux-arm64'], '0'.repeat(64)))).toEqual([expect.stringContaining("does not pin tsc's SHA-256 on each platform")]);
    expect(problems(dropLine(webapp, /require\.resolve\('typescript'\)/))).toEqual([expect.stringContaining("no proof, after the removal, that require('typescript') gives 7.0.2")]);
    expect(problems(dropLine(webapp, /import\.meta\.resolve\('typescript'\)/))).toEqual([expect.stringContaining("no proof, after the removal, that import('typescript') gives 7.0.2")]);
    expect(problems(webapp.replace(' -o -name tsc -o -name tsgo', ''))).toEqual(['no proof, after the removal, that no ELF named tsc or tsgo is left']);
    expect(problems(webapp.replace('typescript="$s/typescript@7.0.2/', 'typescript="$s/typescript@7.0.1/'))).toEqual([expect.stringContaining("the removing RUN's typescript= is")]);
  });

  it('a tsc that is not the published one, or has a second name, fails it before anything is removed; typescript that no longer resolves, or a tsc left elsewhere, fails it after', () => {
    const plat = 'linux-arm64';
    const tree = treeOf('trigger.dev', plat);
    // The pinned hash, which the stand-in's tsc is not.
    withSandbox(tree, (box) => {
      const run = build(webapp, box, { ...removingOnlyRun, plat, tag: 'v4.8.3', pinnedTsc: true });
      expect(run.status, run.out).not.toBe(0);
      expect(run.out).toContain(`${box.fs}${expand(TSC.path, plat)} is not TypeScript 7.0.2's tsc for ${plat} as npm published it (SHA-256 ${TSC.sha256[plat]})`);
      expect(removedBy(box, run)).toEqual([]);
      expect(corepackCalls(box)).toEqual([]);
    });
    // A second name: the scan would read 0 while the same ELF stayed.
    const second = `${PNPM}/@typescript+typescript-${plat}@7.0.2/node_modules/@typescript/typescript-${plat}/bin/tsc-native`;
    withSandbox({ ...tree, binaries: tree.binaries.map((b) => (b.path.endsWith('/lib/tsc') ? { ...b, link: second } : b)) }, (box) => {
      const run = build(webapp, box, { ...removingOnlyRun, plat, tag: 'v4.8.3' });
      expect(run.status, run.out).not.toBe(0);
      expect(run.out).toContain(`${box.fs}${expand(TSC.path, plat)} has 2 names: a second name would keep the binary`);
      expect(removedBy(box, run)).toEqual([]);
    });
    // prisma without its link to typescript 7.0.2: the proof after the removal fails.
    withSandbox({ ...tree, links: tree.links!.filter((l) => l.path !== `${dirname(TSC.prisma)}/typescript`) }, (box) => {
      const run = build(webapp, box, { ...removingOnlyRun, plat, tag: 'v4.8.3' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`from ${box.fs}${TSC.prisma}, require('typescript') does not give 7.0.2 from ${box.fs}${TSC.typescript} without its binary.`);
    });
    // A typescript whose "." is no longer lib/version.cjs, though it says 7.0.2.
    const moved = { ...tree.files, [`${TSC.typescript}/package.json`]: `${JSON.stringify({ name: 'typescript', version: '7.0.2', type: 'module', exports: { [`./${'package'}.json`]: `./${'package'}.json`, '.': './lib/api.cjs' } })}\n`, [`${TSC.typescript}/lib/api.cjs`]: 'exports.version = "7.0.2";\n' };
    withSandbox({ ...tree, files: moved }, (box) => {
      const run = build(webapp, box, { ...removingOnlyRun, plat, tag: 'v4.8.3' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`require(typescript): ${box.fs}${TSC.typescript}/lib/api.cjs 7.0.2`);
    });
    // Another TypeScript's native binary, which REMOVED does not name: the build stops rather than ship it.
    const other = `${PNPM}/@typescript+native-preview-${plat}@7.1.0/node_modules/@typescript/native-preview-${plat}/lib/tsgo`;
    withSandbox({ ...tree, binaries: [...tree.binaries, { path: other }] }, (box) => {
      const run = build(webapp, box, { ...removingOnlyRun, plat, tag: 'v4.8.3' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`a depot, esbuild or tsc binary is still there: ${box.fs}${other}`);
    });
  });
});

describe('the swap table replaces five packages in the webapp and one in the supervisor by the release of the same major that fixes each, and nothing else', () => {
  it("REPLACED's table rows are what each image's table names, each past its floor", () => {
    for (const name of NAMES) {
      expect(tableProblems(name, dockerfiles[name]), name).toEqual([]);
      for (const r of tableRows(name)) {
        const n = nameOfRow(r);
        expect(r.url).toBe(`https://registry.npmjs.org/${n}/-/${n}-${r.to}.tgz`);
        expect(r.integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
        // The same major, past its three-day floor when taken: 2026-11-03, effect's 2026-11-06 (CONTRIBUTING.md).
        expect(r.to.split('.')[0], n).toBe(r.from.split('.')[0]);
        expect(Date.parse(r.taken ?? '2026-11-03T00:00:00Z') - Date.parse(r.published), n).toBeGreaterThan(3 * 24 * 3600 * 1000);
        for (const req of r.requirers) expect(REQUIRER_DIRS[req] ?? WORKSPACE_REQUIRERS[req], `${n}: ${req} has no pnpm directory or workspace directory here`).toBeDefined();
        expect(r.why.length).toBeGreaterThan(60);
        expect(r.evidence.length).toBeGreaterThan(30);
      }
    }
    // Both images swap systeminformation to the same release, the same way.
    const [web, sup] = [tableRows('trigger.dev'), tableRows('supervisor')].map((rows) => rows.find((r) => nameOfRow(r) === 'systeminformation')!);
    expect([sup!.from, sup!.to, sup!.fromTree, sup!.toTree, sup!.integrity]).toEqual([web!.from, web!.to, web!.fromTree, web!.toTree, web!.integrity]);
    expect(sup!.path).toBe(`${SUPERVISOR_PNPM}/systeminformation@5.31.7/node_modules/systeminformation`);
    // The two RUNs are one, but for what names the image.
    const body = (name: Name) => tableRuns(dockerfiles[name])[0]!.args.replace(/^ {4}(me|s|bundles)=[^\n]*\n/gm, '').replace(/^ {4}fail\(\) [^\n]*\n/m, '').replace(new RegExp(`${TABLE_ROW.source}\\n`, 'gm'), '').replace(/^ {4}echo [^\n]*$/m, '').replace(/the webapp's own build|the supervisor's own build/, 'the build');
    expect(body('supervisor')).toBe(body('trigger.dev'));
  });

  it('refuses each way the swap table could slip', () => {
    const webapp = dockerfiles['trigger.dev'];
    const problems = (text: string) => tableProblems('trigger.dev', text);
    expect(problems(dropLine(webapp, /^ {6}\[ "\$got" = "\$want" \]/))).toEqual(["the swap table's fetched() does not check the tarball's sha512, against the integrity npm published"]);
    expect(problems(dropLine(webapp, /^ {6}\[ "\$copies" = "\$pkg\/package\.json" \]/))).toEqual(["the swap table's check() does not check that no other package.json of that name and version is in the image"]);
    expect(problems(dropLine(webapp, /^ {6}\[ "\$st" = 1 \]/))).toEqual([expect.stringContaining("check() does not check that the image's own build carries no copy of it")]);
    expect(problems(dropLine(webapp, /^ {6}\[ "\$\(tree "\$pkg"\)" = "\$from_tree" \]/))).toEqual(["the swap table's check() does not check the old directory, file for file (from_tree)"]);
    expect(problems(dropLine(webapp, /^ {6}\[ "\$\(printf '%s\\n' "\$found"/))).toEqual(["the swap table's check() does not check which packages link it, against the row"]);
    expect(problems(dropLine(webapp, /^ {6}\[ ! -e "\$new\/node_modules" \]/))).toEqual(["the swap table's fetched() does not check that the tarball brings no node_modules"]);
    expect(problems(dropLine(webapp, /^ {6}\[ "\$\(own "\$pkg"\)" = /))).toEqual(["the swap table's proven() does not check that pnpm's own node_modules is what it was"]);
    expect(problems(dropLine(webapp, /^ {6}node -e "\$deps" "\$pkg"/))).toEqual(["the swap table's loaded() does not check that every dependency the new release declares loads from its directory"]);
    expect(problems(webapp.replace('find . -path ./node_modules -prune -o -type f -print0', 'find . -type f -print0'))).toEqual([expect.stringContaining("tree() leaves pnpm's own node_modules out")]);
    expect(problems(webapp.replace(/if \[ -e "\$s\/\$1@\$2\/node_modules\/\$1\/node_modules" \]; then [^;]*; fi; /, ''))).toEqual([expect.stringContaining("swapped() carries pnpm's own node_modules over")]);
    expect(problems(webapp.replace("j.name === n && j.version === v", 'j.name === n'))).toEqual([expect.stringContaining('same matches a copy by its name and version')]);
    // who without the workspace: effect's requirer, a package of the workspace, would read as nothing (A PACKAGE OF THE WORKSPACE).
    expect(problems(webapp.replace(' walk(path.dirname(path.dirname(s)));', ''))).toEqual([expect.stringContaining("who also finds the workspace's packages that link it from their own node_modules")]);
    expect(problems(webapp.replace("if (e.isDirectory() && e.name !== 'node_modules') walk(", 'if (e.isDirectory()) walk('))).toEqual([expect.stringContaining("who also finds the workspace's packages that link it")]);
    expect(tableProblems('supervisor', dockerfiles.supervisor.replace(' walk(path.dirname(path.dirname(s)));', ''))).toEqual([expect.stringContaining("who also finds the workspace's packages that link it")]);
    expect(problems(webapp.replace("if (!p.startsWith(real + path.sep))", 'if (false)'))).toEqual([expect.stringContaining('load checks where each require resolves')]);
    expect(problems(webapp.replace(" %s %Y %Z' {} + ; } | LC_ALL=C sort", "' {} + ; } | LC_ALL=C sort"))).toEqual([expect.stringContaining('state() reads every entry outside the swapped directories')]);
    // The order: a swap before every fetch is checked, or the image read after a fetch, or no load proof.
    expect(problems(moveLine(webapp, /^ {4}rows swapped; \\$/, /^ {4}before="\$\(state\)"; \\$/))).toEqual(["the swap table's RUN does not run its steps in order: the directories are swapped too early"]);
    expect(problems(moveLine(webapp, /^ {4}before="\$\(state\)"; \\$/, /^ {4}rows fetched; \\$/))).toEqual(["the swap table's RUN does not run its steps in order: every tarball is fetched and checked too early"]);
    expect(problems(dropLine(webapp, /^ {4}rows loaded; \\$/))).toEqual(["the swap table's RUN does not run its steps in order: missing where each requirer loads it"]);
    expect(problems(dropLine(webapp, /^ {4}rows check; \\$/))).toEqual(["the swap table's RUN does not run its steps in order: missing where every row is checked"]);
    // A row that is not REPLACED's, or none for one of REPLACED's.
    const moved = problems(webapp.replace(' 6.29.1 5f8644a9', ' 6.29.2 5f8644a9'));
    expect(moved).toEqual([expect.stringContaining('has a row REPLACED does not: undici | 6.29.0 |'), expect.stringContaining("has no row for REPLACED's undici | 6.29.0 |")]);
    expect(problems(dropLine(webapp, /^ {6}"\$@" follow-redirects /))).toEqual([expect.stringContaining("has no row for REPLACED's follow-redirects")]);
    expect(problems(webapp.replace(' axios@1.20.0;', ' axios@1.20.0 express@4.20.0;'))).toEqual([expect.stringContaining('has a row REPLACED does not: follow-redirects'), expect.stringContaining("has no row for REPLACED's follow-redirects")]);
    // Where it runs.
    expect(problems(webapp.replace(/\n(# Still as root: undici)/, '\nUSER node\n$1'))).toEqual(["the swap table's RUN runs as node, not root"]);
    expect(problems(webapp.replace('bundles="/triggerdotdev/apps/webapp/build /triggerdotdev/apps/webapp/public"', 'bundles=/triggerdotdev/apps/webapp/public'))).toEqual([expect.stringContaining("bundles= is /triggerdotdev/apps/webapp/public")]);
    const sup = dockerfiles.supervisor;
    expect(tableProblems('supervisor', sup.replace('s=/app/apps/supervisor/node_modules/.pnpm;', 's=/app/node_modules/.pnpm;'))).toEqual([expect.stringContaining("the swap table's s= is /app/node_modules/.pnpm")]);
    expect(tableProblems('supervisor', sup.replace(/\n# Still as root: systeminformation[\s\S]*?\n\n/, '\n\n'))).toEqual(['0 RUNs hold a swap table, not 1']);
  });

  for (const [name, plat] of [['trigger.dev', 'linux-x64'], ['supervisor', 'linux-arm64']] as const) {
    it(`${name}: run over the stand-in, it swaps each row for the published release, keeps pnpm's own node_modules, changes nothing else, and every requirer loads it`, () => {
      withSandbox(treeOf(name, plat), (box) => {
        const before = snapshot(box);
        const run = build(dockerfiles[name], box, { ...tableOnly, plat });
        expect(run.status, run.out).toBe(0);
        const after = snapshot(box);
        const outside = (snap: Map<string, string>) => tableRows(name).reduce((m, r) => without(m, r.path), snap);
        expect(outside(after)).toEqual(outside(before));
        for (const r of tableRows(name)) {
          const n = nameOfRow(r);
          const files = [...after].filter(([p, v]) => p.startsWith(`${r.path}/`) && v !== 'directory' && !p.startsWith(`${r.path}/node_modules/`)).map(([p, v]) => [p.slice(r.path.length + 1), v]).sort();
          expect(files, n).toEqual(Object.entries(standInSwapped(n, r.to)).map(([p, t]) => [p, sha256(t)]).sort());
          // pnpm's own, carried over.
          expect([...after].filter(([p]) => p.startsWith(`${r.path}/node_modules/`)), n).toEqual([...before].filter(([p]) => p.startsWith(`${r.path}/node_modules/`)));
          for (const req of r.requirers) {
            const dir = requirerDir(TABLE_HOME[name].s, req);
            for (const spec of r.table.loads) expect(run.out, `${n} from ${req}`).toContain(`require(${spec}): ${box.fs}${r.path}/`);
            expect(run.out).not.toContain(`from ${box.fs}${dir},`);
          }
        }
        expect(run.out).toContain(name === 'trigger.dev' ? 'nothing else in the image changed; from every requirer, require loads the new release.' : 'nothing else in the image changed; from @opentelemetry/host-metrics, require loads it.');
        if (name === 'trigger.dev') expect(run.out).toContain(`pnpm hoists undici 6.29.0 too: ${box.fs}${PNPM}/node_modules/undici`);
        // undici 5.29.0, body-parser 2.3.0 and the three other copies of effect stay, as they were, and so do the links to them.
        if (name === 'trigger.dev') {
          const stay = [`${PNPM}/undici@5.29.0/node_modules/undici/package.json`, `${PNPM}/body-parser@2.3.0_supports-color@10.0.0/node_modules/body-parser/package.json`, ...EFFECTS_THAT_STAY.map((e) => `${PNPM}/effect@${e.version}/node_modules/effect/package.json`)];
          for (const p of stay) expect(after.get(p), p).toBe(before.get(p));
          for (const e of EFFECTS_THAT_STAY) {
            const link = `${e.workspace ?? `${PNPM}/${e.store}`}/node_modules/effect`;
            expect(after.get(link), link).toBe(`-> ${relative(dirname(link), `${PNPM}/effect@${e.version}/node_modules/effect`)}`);
          }
          // The workspace's requirer loads it through its own link, which the swap leaves as it was.
          expect(after.get('/triggerdotdev/packages/schema-to-json/node_modules/effect')).toBe('-> ../../../node_modules/.pnpm/effect@3.17.1/node_modules/effect');
          expect(run.out).toContain(`require(effect): ${box.fs}${PNPM}/effect@3.17.1/node_modules/effect/index.js 3.22.4`);
        }
        expect(readdirSync(join(box.root, 'tmp')), 'the RUN left its staging directory').toEqual([]);
      });
    });
  }

  it('each way upstream or the registry could differ fails it, with nothing changed', () => {
    const base = treeOf('trigger.dev', 'linux-arm64');
    const rowOf = (n: string) => tableRows('trigger.dev').find((r) => nameOfRow(r) === n)!;
    const [undici, follow, bodyParser, effect] = ['undici', 'follow-redirects', 'body-parser', 'effect'].map(rowOf) as [PackageReplacement, PackageReplacement, PackageReplacement, PackageReplacement];
    const files = (add: Record<string, string>, drop: (p: string) => boolean = () => false): Tree => ({ ...base, files: { ...Object.fromEntries(Object.entries(base.files).filter(([p]) => !drop(p))), ...add } });
    const at = (dir: string) => (p: string) => p === dir || p.startsWith(`${dir}/`);
    /** The registry serving these bytes for a row, by their own integrity and tree when asked. */
    const served = (r: PackageReplacement, bytes: Buffer | undefined, own?: Record<string, string>): Tree => {
      const n = nameOfRow(r);
      const registry = { ...base.registry };
      if (bytes) registry[r.url] = bytes;
      else delete registry[r.url];
      const table = { ...base.standIn!.table! };
      if (bytes && own) table[n] = { ...table[n]!, integrity: integrityOf(bytes), toTree: treeHash(own) };
      return { ...base, registry, standIn: { ...base.standIn, table } };
    };
    const linkTo = (r: PackageReplacement, from: string) => ({ path: `${PNPM}/${from}/node_modules/${nameOfRow(r)}`, target: `../../${nameOfRow(r)}@${r.from}/node_modules/${nameOfRow(r)}` });
    const unreadable: Tree = { ...base, tools: { ...base.tools, grep: stub('grep', '-rlF*', "echo 'grep: stand-in: Permission denied' >&2; exit 2") } };
    const older = standInSwapped('body-parser', '1.20.8');
    const extra = { ...standInSwapped('body-parser', '1.20.9'), 'lib/extra.js': 'module.exports = 1;\n' };
    const extraTgz = tarball(extra);
    const ownModules = { ...standInSwapped('body-parser', '1.20.9'), 'node_modules/x/index.js': 'module.exports = 1;\n' };
    const webapp = '/triggerdotdev/apps/webapp';
    const schemaToJson = WORKSPACE_REQUIRERS['@trigger.dev/schema-to-json@4.8.3']!;
    /** The stand-in with one link pointed elsewhere, as pnpm would make it. */
    const relinked = (path: string, to: string): Tree => ({ ...base, links: base.links!.map((l) => (l.path === path ? { path, target: relative(dirname(path), to) } : l)) });
    const cases: ReadonlyArray<[string, Tree, (fs: string) => string, Options?]> = [
      ['a package not where it was', { ...files({}, at(undici.path)), links: base.links!.filter((l) => !l.target.includes('undici@6.29.0')) }, (fs) => `${fs}${undici.path} is not there.`],
      ['another version at its path', files({ [`${follow.path}/package.json`]: standInSwapped('follow-redirects', '1.16.1')['package.json']! }), () => 'is follow-redirects 1.16.1, not 1.16.0.'],
      ['a file of it that is not the published one', files({ [`${bodyParser.path}/index.js`]: 'module.exports = {};\n' }), (fs) => `${fs}${bodyParser.path} is not the published body-parser 1.20.6, file for file`],
      ['a link inside it, outside pnpm\'s node_modules', { ...base, links: [...base.links!, { path: `${undici.path}/lib-link.js`, target: 'index.js' }] }, (fs) => `${fs}${undici.path} holds more than files and directories`],
      ['a third package that links it', { ...base, links: [...base.links!, linkTo(undici, 'other@1.0.0')], files: { ...base.files, [`${PNPM}/other@1.0.0/node_modules/other/package.json`]: '{"name":"other","version":"1.0.0"}\n' } }, () => 'undici 6.29.0 is linked from: @ai-sdk/provider-utils@4.0.56 '],
      ['a requirer that no longer links it', { ...base, links: base.links!.filter((l) => l.path !== `${PNPM}/axios@1.20.0/node_modules/follow-redirects`) }, () => 'follow-redirects 1.16.0 is linked from: nothing; this file was read for axios@1.20.0.'],
      ['a requirer of another version', files({ [`${PNPM}/express@4.20.0/node_modules/express/package.json`]: '{"name":"express","version":"4.21.0"}\n' }), () => 'body-parser 1.20.6 is linked from: express@4.21.0 '],
      ['another copy of the same version elsewhere', files({ [`${webapp}/node_modules/undici/package.json`]: standInSwapped('undici', '6.29.0')['package.json']! }), (fs) => `undici 6.29.0's package.json is at: ${fs}`],
      ['a browser bundle that carries one of them', files({ [`${webapp}/build/client/assets/axios-stand-in.js`]: 'const e="ERR_FR_TOO_MANY_REDIRECTS";\n' }), (fs) => `the webapp's own build carries follow-redirects's ERR_FR_TOO_MANY_REDIRECTS (grep exits 0): ${fs}${webapp}/build/client/assets/axios-stand-in.js`],
      ['a build the search for the marks cannot read', unreadable, () => "the webapp's own build carries undici's undici:request:create (grep exits 2)"],
      ['a webapp built elsewhere', files({}, at(`${webapp}/public`)), (fs) => `${fs}${webapp}/public is not there: the build is not where it was read.`],
      // The last row's tarball missing: the first four were fetched and checked, and none of the five is swapped.
      ['a registry without the last row\'s tarball', served(effect, undefined), () => `${effect.url} is gone (above): its publisher no longer serves it; nothing was changed, and upstream did not move.`],
      // A requirer that is a package of the workspace, whose link is in its own node_modules (A PACKAGE OF THE WORKSPACE).
      ['a package of the workspace that no longer links it', { ...base, links: base.links!.filter((l) => l.path !== `${schemaToJson}/node_modules/effect`) }, () => 'effect 3.17.1 is linked from: nothing; this file was read for @trigger.dev/schema-to-json@4.8.3.'],
      ['a package of the workspace at another version', files({ [`${schemaToJson}/package.json`]: '{"name":"@trigger.dev/schema-to-json","version":"4.8.4"}\n' }), (fs) => `effect 3.17.1 is linked from: @trigger.dev/schema-to-json@4.8.4 ${fs}${schemaToJson}; this file was read for @trigger.dev/schema-to-json@4.8.3.`],
      ['a second package of the workspace that links it', relinked(`${webapp}/node_modules/effect`, effect.path), (fs) => `effect 3.17.1 is linked from: @trigger.dev/schema-to-json@4.8.3 ${fs}${schemaToJson}\nwebapp@1.0.0 ${fs}${webapp}; this file was read for @trigger.dev/schema-to-json@4.8.3.`],
      ['a package of the store that links it beside the workspace\'s', relinked(`${PNPM}/@prisma+config@6.14.0_magicast@0.3.5/node_modules/effect`, effect.path), (fs) => `effect 3.17.1 is linked from: @prisma/config@6.14.0 ${fs}${PNPM}/@prisma+config@6.14.0_magicast@0.3.5/node_modules/@prisma/config\n@trigger.dev/schema-to-json@4.8.3 ${fs}${schemaToJson}; this file was read`],
      ['a package of the workspace with no package.json', files({}, (p) => p === `${schemaToJson}/package.json`), (fs) => `the packages that link ${fs}${effect.path} could not be read.`],
      ['a browser bundle that carries effect', files({ [`${webapp}/build/client/assets/effect-stand-in.js`]: 'const t=()=>new Error().stack?.includes("effect_internal_function");\n' }), (fs) => `the webapp's own build carries effect's effect_internal_function (grep exits 0): ${fs}${webapp}/build/client/assets/effect-stand-in.js`],
      ['a registry that serves other bytes', served(bodyParser, extraTgz), () => `${bodyParser.url} is ${integrityOf(extraTgz)}, not`],
      ['a tarball of another release, by its own integrity', served(bodyParser, tarball(older), older), () => `${bodyParser.url} unpacks to body-parser 1.20.8, not 1.20.9; nothing was changed.`],
      ['a tarball with other files, by its own integrity', served(bodyParser, extraTgz, standInSwapped('body-parser', '1.20.9')), () => `${bodyParser.url} unpacks to other files than the published body-parser 1.20.9 (above); nothing was changed.`],
      ['a tarball with a node_modules of its own, by its own integrity and tree', served(bodyParser, tarball(ownModules), standInSwapped('body-parser', '1.20.9')), () => `${bodyParser.url} unpacks a node_modules of its own; nothing was changed.`],
      ['the pinned trees, against the stand-in', base, (fs) => `${fs}${undici.path} is not the published undici 6.29.0, file for file`, { pinnedReplacement: true }],
    ];
    for (const [what, tree, said, options] of cases) {
      withSandbox(tree, (box) => {
        const before = snapshot(box);
        const run = build(dockerfiles['trigger.dev'], box, { ...tableOnly, ...options });
        expect(run.status, `${what}: ${run.out}`).not.toBe(0);
        expect(run.out, what).toContain(said(box.fs));
        expect(snapshot(box), `${what}: something changed before it failed`).toEqual(before);
      });
    }
    // The supervisor's, whose requirer is found by its links too.
    const sup = treeOf('supervisor', 'linux-arm64');
    withSandbox({ ...sup, links: sup.links!.filter((l) => !l.path.endsWith('/node_modules/systeminformation')) }, (box) => {
      const before = snapshot(box);
      const run = build(dockerfiles.supervisor, box, tableOnly);
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('systeminformation 5.31.7 is linked from: nothing; this file was read for @opentelemetry/host-metrics@0.38.3.');
      expect(snapshot(box)).toEqual(before);
    });
  });

  it('each proof after the swap fails on the change it is there to see', () => {
    const webapp = dockerfiles['trigger.dev'];
    const base = treeOf('trigger.dev', 'linux-arm64');
    const afterSwap = (line: string) => insertAfter(webapp, /^ {4}rows swapped; \\$/, line);
    for (const [line, what] of [
      ['echo changed >> /triggerdotdev/package.json;', 'a file outside, written'],
      [': > /triggerdotdev/stray;', 'a path outside, added'],
      ['chmod 0600 /triggerdotdev/package.json;', "a file outside, its mode changed"],
    ] as const) {
      withSandbox(base, (box) => {
        const run = build(afterSwap(line), box, tableOnly);
        expect(run.status, what).not.toBe(0);
        expect(run.out, what).toContain('outside the swapped directories, a path was added or removed, or an entry\'s owner, mode, size or times changed, while they were replaced.');
      });
    }
    // pnpm's own node_modules left behind: the shim is gone from the new release's directory.
    withSandbox(base, (box) => {
      const run = build(webapp.replace(/if \[ -e "\$s\/\$1@\$2\/node_modules\/\$1\/node_modules" \]; then [^;]*; fi; /, ''), box, tableOnly);
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`${box.fs}${PNPM}/systeminformation@5.31.7/node_modules/systeminformation/node_modules, pnpm's own (a bin shim), is not what it was before the swap.`);
    });
    /** The stand-in, with the registry serving these files as a row's new release, by their own integrity and tree. */
    const serving = (n: string, own: Record<string, string>): Tree => {
      const bytes = tarball(own);
      const r = tableRows('trigger.dev').find((x) => nameOfRow(x) === n)!;
      return { ...base, registry: { ...base.registry, [r.url]: bytes }, standIn: { ...base.standIn, table: { ...base.standIn!.table!, [n]: { ...base.standIn!.table![n]!, integrity: integrityOf(bytes), toTree: treeHash(own) } } } };
    };
    const cases: ReadonlyArray<[string, Tree, (fs: string) => string]> = [
      // A dependency the new release declares that pnpm did not link for the old one.
      ['a release that needs a dependency not linked', serving('body-parser', { ...standInSwapped('body-parser', '1.20.9'), 'package.json': `${JSON.stringify({ name: 'body-parser', version: '1.20.9', main: 'index.js', dependencies: { bytes: '~3.1.2', qs: '~6.17.0' } })}\n` }), (fs) => `a dependency body-parser 1.20.9 declares does not load from ${fs}${PNPM}/body-parser@1.20.6/node_modules/body-parser.`],
      // From the workspace's requirer, which resolves it through its own node_modules: the entry it loads, gone.
      [
        "a release without the entry the workspace's requirer loads",
        serving('effect', Object.fromEntries(Object.entries(standInSwapped('effect', '3.22.4')).filter(([p]) => p !== 'index.js'))),
        (fs) => `from ${fs}/triggerdotdev/packages/schema-to-json, effect does not load 3.22.4 from ${fs}${PNPM}/effect@3.17.1/node_modules/effect.`,
      ],
      // A dependency effect declares, gone from where pnpm linked it for 3.17.1.
      [
        'a release whose dependency is not linked',
        { ...base, links: base.links!.filter((l) => l.path !== `${PNPM}/effect@3.17.1/node_modules/fast-check`) },
        (fs) => `a dependency effect 3.22.4 declares does not load from ${fs}${PNPM}/effect@3.17.1/node_modules/effect.`,
      ],
      // The subpath a requirer loads, gone.
      ['a release without lib/network.js', serving('systeminformation', Object.fromEntries(Object.entries(standInSwapped('systeminformation', '5.33.19')).filter(([p]) => p !== 'lib/network.js'))), (fs) => `from ${fs}${PNPM}/${REQUIRER_DIRS['@opentelemetry/host-metrics@0.38.3']}/node_modules/@opentelemetry/host-metrics, systeminformation does not load 5.33.19`],
      // A requirer that resolves a copy of its own, which no link check sees: only the load proof does.
      [
        'a requirer with a copy of its own',
        { ...base, files: { ...base.files, ...Object.fromEntries(Object.entries(standInSwapped('follow-redirects', '1.16.2')).map(([p, t]) => [`${PNPM}/axios@1.20.0/node_modules/axios/node_modules/follow-redirects/${p}`, t])) } },
        (fs) => `from ${fs}${PNPM}/axios@1.20.0/node_modules/axios, follow-redirects does not load 1.16.2 from ${fs}${PNPM}/follow-redirects@1.16.0/node_modules/follow-redirects.`,
      ],
    ];
    for (const [what, tree, said] of cases) {
      withSandbox(tree, (box) => {
        const run = build(webapp, box, tableOnly);
        expect(run.status, `${what}: ${run.out}`).not.toBe(0);
        expect(run.out, what).toContain(said(box.fs));
      });
    }
  });
});

describe("goose is v3.29.0's release binary in place of the v3.27.1 upstream builds, root's and executable", () => {
  const webapp = dockerfiles['trigger.dev'];

  it("REPLACED's goose is what its RUN names, past its floor", () => {
    expect(gooseProblems('trigger.dev', webapp)).toEqual([]);
    expect(gooseProblems('supervisor', dockerfiles.supervisor)).toEqual([]);
    expect(Date.parse('2026-11-03T00:00:00Z') - Date.parse(GOOSE.published)).toBeGreaterThan(3 * 24 * 3600 * 1000);
    for (const plat of PLATFORMS) {
      expect(GOOSE.assets[plat].sha256, plat).toMatch(/^[0-9a-f]{64}$/);
      expect(GOOSE.assets[plat].bytes, plat).toBeGreaterThan(30_000_000);
    }
    expect(GOOSE.why.length).toBeGreaterThan(60);
    expect(GOOSE.evidence.length).toBeGreaterThan(30);
    // The header says why, the ClickHouse table's order, the mode, and the way out.
    for (const s of ['WHAT IS REPLACED: GOOSE', 'ORDER BY (version_id)', 'THE MODE', 'upstream moved goose: drop the replacement', 'CVE-2026-111943']) expect(webapp).toContain(s);
  });

  it('refuses each way the goose RUN could slip', () => {
    const problems = (text: string) => gooseProblems('trigger.dev', text);
    expect(problems(dropLine(webapp, /^ {4}chmod 0755 "\$tmp\/goose"; \\$/))).toEqual(["goose's RUN does not check, after the fetch and before the move, mode 0755, given to it (Trivy reads no Go binary that is not executable)"]);
    expect(problems(moveLine(webapp, /^ {4}chmod 0755 "\$tmp\/goose"; \\$/, /^ {4}mv "\$tmp\/goose" "\$goose"; \\$/))).toEqual(["goose's RUN does not check, after the fetch and before the move, mode 0755, given to it (Trivy reads no Go binary that is not executable)"]);
    expect(problems(dropLine(webapp, /^ {4}chown 0:0 "\$tmp\/goose"; \\$/))).toEqual(["goose's RUN does not check, after the fetch and before the move, root's owner, given to it"]);
    expect(problems(dropLine(webapp, /^ {4}\[ "\$got" = "\$goose_sha256" \]/))).toEqual(["goose's RUN does not check, after the fetch and before the move, the fetched file's SHA-256"]);
    expect(problems(dropLine(webapp, /^ {4}\[ "\$said" = "goose version: \$goose_from" \]/))).toEqual([expect.stringContaining('upstream moved goose: drop the replacement')]);
    expect(problems(dropLine(webapp, /^ {4}\[ "\$\(stat -c '%h %u:%g %a' "\$goose"\)" = '1 0:0 755' \] \|\| fail "\$goose has [^\n]*as upstream's builder stage leaves it/))).toEqual(["goose's RUN does not check, before it fetches, that goose has one name, root's, 0755"]);
    expect(problems(dropLine(webapp, /after the move, not one name, root's, 0755/))).toEqual(["goose's RUN does not prove, after the move, that goose has one name, root's, 0755"]);
    expect(problems(dropLine(webapp, /^ {4}\[ "\$\(state\)" = "\$before" \] \|\| fail "outside \$goose/))).toEqual(["goose's RUN does not prove, after the move, that nothing else changed"]);
    expect(problems(dropLine(webapp, /^ {4}\[ "\$\("\$goose" -version\)" = "goose version: \$goose_to" \]/))).toEqual(["goose's RUN does not prove, after the move, that goose says the new version"]);
    // goose's own `before=`, which reads like the swap table's.
    const at = webapp.indexOf('\n# Still as root: goose');
    expect(problems(webapp.slice(0, at) + moveLine(webapp.slice(at), /^ {4}before="\$\(state\)"; \\$/, /^ {4}chmod 0755 "\$tmp\/goose"; \\$/))).toEqual(["goose's RUN does not check, before it fetches, the image, read"]);
    expect(problems(webapp.replace(GOOSE.assets['linux-arm64'].sha256, '0'.repeat(64)))).toEqual(["goose's RUN does not pin linux-arm64's goose_linux_arm64 by efdb8f97176df746cf3970ed40810816a51927da0600b152ac4359ae2b7c0e12"]);
    expect(problems(dropLine(webapp, /^ {6}\*\) fail "this is \$plat; goose/))).toEqual(["goose's RUN does not refuse a platform it pins no asset for"]);
    expect(problems(webapp.replace('goose_from=v3.27.1;', 'goose_from=v3.27.3;'))).toEqual(["goose's RUN's goose_from= is v3.27.3, not v3.27.1"]);
    expect(problems(webapp.replace(/\n(# Still as root: goose)/, '\nUSER node\n$1'))).toEqual(["goose's RUN runs as node, not root"]);
  });

  for (const plat of PLATFORMS) {
    it(`on ${plat}, run over the stand-in, it puts the release's asset in place, root's and 0755, and changes nothing else`, () => {
      withSandbox(treeOf('trigger.dev', plat), (box) => {
        const before = snapshot(box);
        const run = build(webapp, box, { ...gooseOnly, plat });
        expect(run.status, run.out).toBe(0);
        expect(readFileSync(join(box.fs, GOOSE.path)).equals(STAND_IN_GOOSE_NEW)).toBe(true);
        expect(statSync(join(box.fs, GOOSE.path)).mode & 0o777).toBe(0o755);
        expect(without(snapshot(box), GOOSE.path)).toEqual(without(before, GOOSE.path));
        // Root's owner, given to the fetched file before it moved into place.
        const chowns = readFileSync(join(box.root, 'tools.log'), 'utf8').split('\n').filter((l) => l.startsWith('chown '));
        expect(chowns).toEqual([expect.stringMatching(new RegExp(`^chown 0:0 ${join(box.root, 'tmp').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\S+/goose$`))]);
        expect(run.out).toContain(`goose v3.27.1 at ${box.fs}${GOOSE.path} is goose v3.29.0's ${GOOSE.assets[plat].asset}`);
        expect(readdirSync(join(box.root, 'tmp'))).toEqual([]);
      });
    });
  }

  it('each way upstream or the release could differ fails it, with nothing changed', () => {
    const plat = 'linux-x64';
    const base = treeOf('trigger.dev', plat);
    const url = GOOSE.assets[plat].url;
    const old = (bytes: Buffer): Tree => ({ ...base, executables: { [GOOSE.path]: bytes } });
    const asset = (bytes: Buffer | undefined, own = false): Tree => {
      const registry = { ...base.registry };
      if (bytes) registry[url] = bytes;
      else delete registry[url];
      return { ...base, registry, standIn: { ...base.standIn, goose: own && bytes ? sha256(bytes) : base.standIn!.goose } };
    };
    const later = standInExecutable(`${GOOSE.said}v3.28.0\n`);
    const cases: ReadonlyArray<[string, Tree, (fs: string) => string, Options?]> = [
      ['an old goose that is no ELF', old(Buffer.from('#!/bin/sh\necho "goose version: v3.27.1"\n')), (fs) => `${fs}${GOOSE.path} is no ELF binary (it starts 23212f62)`],
      ['an old goose of another release: upstream moved goose', old(later), (fs) => `${fs}${GOOSE.path} says 'goose version: v3.28.0', not goose v3.27.1: upstream moved goose: drop the replacement.`],
      ['an old goose of another owner', { ...base, tools: gooseTools('1000:1000') }, (fs) => `${fs}${GOOSE.path} has 1 name(s), owner `],
      ['a release without the asset', asset(undefined), () => `${url} is gone (above): its publisher no longer serves it; nothing was changed, and upstream did not move.`],
      ['a release asset of other bytes', asset(later), () => `${url} is ${sha256(later)}, not ${sha256(STAND_IN_GOOSE_NEW)}, goose v3.29.0's goose_linux_x86_64 as its release published it; nothing was changed.`],
      ['a release asset that says another version, by its own hash', asset(later, true), () => "goose v3.29.0's goose_linux_x86_64 says 'goose version: v3.28.0'; nothing was changed."],
      ['the pinned hash, against the stand-in', base, () => `${url} is ${sha256(STAND_IN_GOOSE_NEW)}, not ${GOOSE.assets[plat].sha256}`, { pinnedGoose: true }],
    ];
    for (const [what, tree, said, options] of cases) {
      withSandbox(tree, (box) => {
        const before = snapshot(box);
        const run = build(webapp, box, { ...gooseOnly, plat, ...options });
        expect(run.status, `${what}: ${run.out}`).not.toBe(0);
        expect(run.out, what).toContain(said(box.fs));
        expect(snapshot(box), `${what}: something changed before it failed`).toEqual(before);
      });
    }
    // Its mode, and a second name, read from the file itself.
    withSandbox(base, (box) => {
      chmodSync(join(box.fs, GOOSE.path), 0o644);
      const run = build(webapp, box, { ...gooseOnly, plat });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`${box.fs}${GOOSE.path} has 1 name(s), owner `);
      expect(run.out).toContain('mode 644, not one name, root\'s, 0755');
    });
    withSandbox(base, (box) => {
      linkSync(join(box.fs, GOOSE.path), join(box.fs, '/usr/local/goose-second'));
      const before = snapshot(box);
      const run = build(webapp, box, { ...gooseOnly, plat });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`${box.fs}${GOOSE.path} has 2 name(s)`);
      expect(snapshot(box)).toEqual(before);
    });
    withSandbox(treeOf('trigger.dev', 'linux-riscv64'), (box) => {
      const run = build(webapp, box, { ...gooseOnly, plat: 'linux-riscv64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain("this is linux-riscv64; goose v3.29.0's release binaries are pinned for linux-arm64 and linux-x64.");
    });
  });

  it('each proof after the move fails on the change it is there to see', () => {
    const base = treeOf('trigger.dev', 'linux-arm64');
    const afterMove = (line: string) => insertAfter(webapp, /^ {4}mv "\$tmp\/goose" "\$goose"; \\$/, line);
    withSandbox(base, (box) => {
      const run = build(afterMove('echo changed >> /triggerdotdev/package.json;'), box, gooseOnly);
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`outside ${box.fs}${GOOSE.path}, a path was added or removed, or an entry's owner, mode, size or times changed, while it was replaced.`);
    });
    withSandbox(base, (box) => {
      const run = build(afterMove('chmod 0644 /usr/local/bin/goose;'), box, gooseOnly);
      expect(run.status).not.toBe(0);
      expect(run.out).toContain("after the move, not one name, root's, 0755: the entrypoint runs it, and Trivy reads no Go binary that is not executable.");
    });
    withSandbox(base, (box) => {
      const run = build(afterMove('printf x >> /usr/local/bin/goose;'), box, gooseOnly);
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`${box.fs}${GOOSE.path} is not goose v3.29.0's goose_linux_arm64 after the move.`);
    });
  });
});

describe("the webapp's last RUN as root purges the Debian packages nothing here runs, and dpkg's own refusals stop it (0119 §3 item 11, 2026-11-06)", () => {
  const webapp = dockerfiles['trigger.dev'];
  const { packages, libraries } = purgeLists(webapp);
  const list = packages.join(' ');
  /** A stand-in ELF that carries `text`, as a binary carries the name of a library it links or opens. */
  const elf = (text: string) => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.from(`stand-in\0${text}\0`)]);
  /** The webapp's tree on a platform, its database changed. */
  const changed = (plat: string, change: (db: DpkgDb) => DpkgDb, more: Partial<Tree> = {}): Tree => {
    const tree = treeOf('trigger.dev', plat);
    return { ...tree, ...more, dpkg: change(tree.dpkg!) };
  };
  const without = (db: DpkgDb, name: string): DpkgDb => ({ ...db, packages: Object.fromEntries(Object.entries(db.packages).filter(([n]) => n !== name)) });
  const purged = (box: Sandbox) => dpkgOf(box).calls.filter((c) => c.startsWith('dpkg --purge'));

  it('reads its two lists from the RUN, and the stand-in has each library under a package of the list (vacuity)', () => {
    expect(packages.length).toBeGreaterThan(5);
    expect(libraries.length).toBeGreaterThan(3);
    for (const so of libraries) expect(packages, so).toContain(SHIPPED_BY[so]);
  });

  it("never reaches this machine's dpkg or apt: the stand-in's dpkg, dpkg-query, apt, apt-get and dumb-init come first on the PATH every RUN gets", () => {
    const cmds = ['dpkg', 'dpkg-query', 'apt', 'apt-get', 'dumb-init'];
    withSandbox(treeOf('trigger.dev', 'linux-arm64'), (box) => {
      const r = spawnSync('sh', ['-c', `for c in ${cmds.join(' ')}; do command -v "$c"; done`], { encoding: 'utf8', env: { PATH: `${join(box.root, 'bin')}:${process.env.PATH ?? '/usr/bin:/bin'}` } });
      expect(r.stdout.trim().split('\n')).toEqual(cmds.map((c) => join(box.root, 'bin', c)));
    });
  });

  for (const plat of PLATFORMS) {
    it(`on ${plat}: dpkg-query of the list first, then the audit, the libraries, the purge with the two flags and no other, the audit again and each package read gone`, () => {
      withSandbox(treeOf('trigger.dev', plat), (box) => {
        const run = build(webapp, box, { plat, tag: 'v4.8.3' });
        expect(run.status, run.out).toBe(0);
        const { db, calls } = dpkgOf(box);
        expect(calls).toEqual([
          `dpkg-query -W ${list}`,
          'dpkg --audit',
          `dpkg-query -L ${list}`,
          `dpkg --purge --force-remove-essential --force-remove-protected ${list}`,
          'dpkg --audit',
          ...packages.map((p) => `dpkg-query -W -f \${db:Status-Status} ${p}`),
        ]);
        for (const p of packages) expect(db.packages[p], p).toBeUndefined();
        // What stays, stays: nothing it keeps depended on what it purged.
        for (const p of ['coreutils', 'tar', 'dpkg', 'libacl1', 'zlib1g', 'libext2fs2', 'libss2', 'libcom-err2', 'logsave']) expect(db.packages[p]?.status, p).toBe('installed');
        expect(run.out).toMatch(/^[1-9]\d* ELF files read under /m);
        expect(run.out).toContain(`purged ${list}; dpkg's audit reads nothing, no ELF file names ${libraries.join(' ')}`);
        expect(readFileSync(join(box.root, 'tools.log'), 'utf8')).toContain('dumb-init --version\n');
      });
    });
  }

  it('a package the base does not have stops it before anything is purged: a list to read again, not a name to skip', () => {
    withSandbox(changed('linux-arm64', (db) => without(db, 'libuuid1')), (box) => {
      const run = build(webapp, box, { plat: 'linux-arm64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('dpkg-query: no packages found matching libuuid1');
      expect(run.out).toContain('a list to read again, not a name to skip; nothing was purged');
      expect(purged(box)).toEqual([]);
    });
  });

  it('a package an installed one still depends on stops it: no flag forces past the dependency, so dpkg refuses', () => {
    // fdisk links libblkid, libmount, libsmartcols and libuuid: a base that brings it stops here, at dpkg's own
    // refusal, as this base did for e2fsprogs until it joined the list (2026-11-06).
    const fdisk: DpkgPackage = { version: '2.38.1-5+deb12u3', status: 'installed', depends: ['libblkid1', 'libmount1', 'libsmartcols1', 'libuuid1'] };
    withSandbox(changed('linux-arm64', (db) => ({ ...db, packages: { ...db.packages, fdisk } })), (box) => {
      const run = build(webapp, box, { plat: 'linux-arm64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('fdisk depends on libuuid1.');
      expect(run.out).toContain('dependency problems - not removing');
      expect(run.out).toContain('Without --force-depends it refuses to remove what an installed package depends on');
      const { db } = dpkgOf(box);
      for (const p of ['fdisk', 'libuuid1', 'libblkid1']) expect(db.packages[p]?.status, p).toBe('installed');
    });
  });

  it('e2fsprogs off the list stops it as it stopped the first build on the real base: dpkg refuses libblkid1 and libuuid1 for it', () => {
    const without = webapp.replace(' libapt-pkg6.0 e2fsprogs"', ' libapt-pkg6.0"');
    expect(without).not.toBe(webapp);
    withSandbox(changed('linux-arm64', (db) => db), (box) => {
      const run = build(without, box, { plat: 'linux-arm64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('e2fsprogs depends on libuuid1.');
      expect(run.out).toContain('dependency problems - not removing');
      const { db } = dpkgOf(box);
      for (const p of ['e2fsprogs', 'libuuid1', 'libblkid1']) expect(db.packages[p]?.status, p).toBe('installed');
    });
  });

  it("dpkg's audit with anything to say stops it: before the purge with nothing purged, and after it", () => {
    const mess = 'The following packages are in a mess due to serious problems during\ninstallation.  They must be reinstalled for them (and any packages\nthat depend on them) to function properly:\n beta                 test\n';
    withSandbox(changed('linux-x64', (db) => ({ ...db, audit: mess })), (box) => {
      const run = build(webapp, box, { plat: 'linux-x64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('dpkg --audit reads problems in the image as upstream left it, before anything was purged');
      expect(purged(box)).toEqual([]);
    });
    withSandbox(changed('linux-x64', (db) => ({ ...db, auditAfter: mess })), (box) => {
      const run = build(webapp, box, { plat: 'linux-x64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('after the purge, dpkg --audit reads: The following packages are in a mess');
    });
  });

  it('a library no package of the list ships stops it before anything is purged, so the scan is never a search for a name nothing had', () => {
    withSandbox(changed('linux-arm64', (db) => ({ ...db, packages: { ...db.packages, 'libapt-pkg6.0': { ...db.packages['libapt-pkg6.0']!, files: ['/usr/share/doc/libapt-pkg6.0/copyright'] } } })), (box) => {
      const run = build(webapp, box, { plat: 'linux-arm64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`none of ${list} ships libapt-pkg.so.6.0`);
      expect(purged(box)).toEqual([]);
    });
  });

  it("a record dpkg keeps as not-installed is gone; one it reads as anything else after the purge stops it", () => {
    withSandbox(changed('linux-arm64', (db) => ({ ...db, packages: { ...db.packages, apt: { ...db.packages.apt!, afterPurge: 'not-installed' } } })), (box) => {
      const run = build(webapp, box, { plat: 'linux-arm64' });
      expect(run.status, run.out).toBe(0);
      expect(dpkgOf(box).db.packages.apt?.status).toBe('not-installed');
    });
    withSandbox(changed('linux-arm64', (db) => ({ ...db, packages: { ...db.packages, 'util-linux': { ...db.packages['util-linux']!, afterPurge: 'config-files' } } })), (box) => {
      const run = build(webapp, box, { plat: 'linux-arm64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain("after the purge, dpkg reads util-linux as 'config-files' (dpkg-query exits 0), not gone.");
    });
  });

  it("an ELF file left after the purge that names one of its libraries stops it, by path; the packages' own go with them, and a text file is no ELF", () => {
    const plat = 'linux-arm64';
    const tree = treeOf('trigger.dev', plat);
    const own = `/usr/lib/${TRIPLET[plat]}/${libraries[0]}`;
    const reader = `${PNPM}/a-reader@1.0.0/node_modules/a-reader/index.js`;
    // The library's own file goes with its package; a script that names it is not something that links it.
    withSandbox({ ...tree, executables: { ...tree.executables, [own]: elf(libraries[0]!) }, files: { ...tree.files, [reader]: `// dlopen('${libraries[0]}') is not this file's\n` } }, (box) => {
      const run = build(webapp, box, { plat });
      expect(run.status, run.out).toBe(0);
      expect(run.left).not.toContain(own);
      expect(run.left).toContain(reader);
    });
    // An addon, or any ELF of no purged package, that names any of them.
    const addons = Object.fromEntries(libraries.map((so, i) => [`${PNPM}/addon-${i}@1.0.0/node_modules/addon-${i}/build/Release/addon.node`, elf(so)]));
    withSandbox({ ...tree, executables: { ...tree.executables, ...addons } }, (box) => {
      const run = build(webapp, box, { plat });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('after the purge, an ELF file names a library it removed');
      libraries.forEach((so, i) => expect(run.out).toContain(`${box.fs}${PNPM}/addon-${i}@1.0.0/node_modules/addon-${i}/build/Release/addon.node: ${so}`));
      // It stopped after the purge: what it found is left for whoever reads the log.
      expect(purged(box)).toHaveLength(1);
    });
  });

  it('a program this stack runs here that does not start after the purge stops it, by name', () => {
    const broken = '#!/bin/sh\necho "dumb-init: error while loading shared libraries: libuuid.so.1: cannot open shared object file" >&2\nexit 127\n';
    const tree = treeOf('trigger.dev', 'linux-x64');
    withSandbox({ ...tree, tools: { ...tree.tools, 'dumb-init': broken } }, (box) => {
      const run = build(webapp, box, { plat: 'linux-x64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('dumb-init, which this stack runs here, does not start after the purge.');
    });
  });
});

describe('a fetch that fails tells a host that did not answer from a move upstream, in every replacing RUN', () => {
  const webapp = dockerfiles['trigger.dev'];
  const fetching: ReadonlyArray<[string, Name, { pick: (run: Instruction) => boolean }, string, (plat: Plat) => string]> = [
    ["dompurify's RUN", 'trigger.dev', replacingOnly, 'registry.npmjs.org', () => DOMPURIFY.url],
    ["the webapp's swap table", 'trigger.dev', tableOnly, 'registry.npmjs.org', () => tableRows('trigger.dev')[0]!.url],
    ["the supervisor's swap table", 'supervisor', tableOnly, 'registry.npmjs.org', () => tableRows('supervisor')[0]!.url],
    ["goose's RUN", 'trigger.dev', gooseOnly, 'github.com', (plat) => GOOSE.assets[plat].url],
  ];

  it('each routes a host that does not answer, or answers with an error, to "run the same tag again", and a file that is gone to its own message', () => {
    expect(replacementProblems(webapp)).toEqual([]);
    for (const name of NAMES) {
      expect(tableProblems(name, dockerfiles[name]), name).toEqual([]);
      expect(gooseProblems(name, dockerfiles[name]), name).toEqual([]);
    }
    const outcome = /^ {4,6}case "\$st" in 0\) ;; 3\) unreachable "\$url" ;; 4\) gone "\$url" ;; \*\) fail [^\n]*$/;
    // A RUN whose fetch fails into fail(), with its advice to drop the replacement.
    const dompurifyAt = webapp.indexOf('\n# Still as root: dompurify');
    const tableAt = webapp.indexOf('\n# Still as root: undici');
    const gooseAt = webapp.indexOf('\n# Still as root: goose');
    const inPart = (from: number, to: number, fn: (part: string) => string) => webapp.slice(0, from) + fn(webapp.slice(from, to)) + webapp.slice(to);
    expect(replacementProblems(inPart(dompurifyAt, tableAt, (part) => part.replace(/ && st=0 \|\| st=\$\?; \\\n {4}case "\$st" in [^\n]*\n/, ' || fail "$url could not be fetched; nothing was changed."; \\\n')))).toEqual([
      'the replacing RUN does not tell a host that did not answer (exit 3, unreachable) or a file that is gone (exit 4, gone) from a move upstream',
    ]);
    expect(tableProblems('trigger.dev', inPart(tableAt, gooseAt, (part) => dropLine(part, outcome)))).toEqual([
      "the swap table's fetched() does not tell a host that did not answer (exit 3, unreachable) or a file that is gone (exit 4, gone) from a move upstream",
    ]);
    expect(gooseProblems('trigger.dev', inPart(gooseAt, webapp.length, (part) => part.replace('3) unreachable "$url" ;; 4) gone "$url" ;; ', '')))).toEqual([
      "goose's RUN does not tell a host that did not answer (exit 3, unreachable) or a file that is gone (exit 4, gone) from a move upstream",
    ]);
    // An unreachable() that gives fail()'s advice, or none of its own.
    expect(gooseProblems('trigger.dev', inPart(gooseAt, webapp.length, (part) => part.replace('Run the bring-up, or deploy-live.sh, with the same tag again once it answers', 'Drop the replacement')))).toEqual([
      "goose's RUN's unreachable() does not say to run the same tag again, on its own, without fail()'s advice",
    ]);
    expect(tableProblems('supervisor', dropLine(dockerfiles.supervisor, /^ {4}gone\(\) \{/))).toEqual([
      "the swap table's RUN's gone() does not say the file is gone and where the way on is, on its own, without fail()'s advice",
    ]);
    // The swap's three steps each fail by name.
    expect(tableProblems('trigger.dev', webapp.replace(/(rm -r "\$s\/\$1@\$2\/node_modules\/\$1") \|\| fail "[^"\n]+";/, '$1;'))).toEqual([expect.stringContaining('each step failing by name')]);
  });

  for (const [what, name, only, host, url] of fetching) {
    it(`${what}: a host that does not answer, or answers 503, stops it with nothing changed and says to run the same tag again, not to drop anything`, () => {
      const plat = 'linux-x64';
      for (const answer of ['unreachable', 503] as const) {
        const tree = treeOf(name, plat);
        withSandbox({ ...tree, answers: { [host]: answer } }, (box) => {
          const before = snapshot(box);
          const run = build(dockerfiles[name], box, { ...only, plat });
          expect(run.status, `${what}, ${answer}: ${run.out}`).not.toBe(0);
          expect(run.out).toContain(answer === 'unreachable' ? `${url(plat)}: getaddrinfo ENOTFOUND ${host}` : `${url(plat)} answered HTTP 503`);
          expect(run.out).toContain(`${url(plat)} did not answer, or answered with an error (above); nothing was changed, and upstream did not move. Run the bring-up, or deploy-live.sh, with the same tag again once it answers`);
          expect(run.out).not.toMatch(/re-read|drop the/);
          expect(snapshot(box)).toEqual(before);
        });
      }
    });
  }
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

/** The copy a Dockerfile removes, the one it replaces and the one it keeps, from its removing RUN. */
function copiesOf(text: string): { unused?: string; replaced?: string; kept?: string } {
  const vars = resolvedAssignments(removingRun(text)?.args ?? '');
  return { unused: vars.get('unused'), replaced: vars.get('replaced'), kept: vars.get('kept') };
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
    const { unused, replaced, kept } = copiesOf(files[name]);
    if (!home) {
      problems.push(`${SERVICE[name]} runs as ${user}, whose copy of pnpm neither Dockerfile knows`);
      continue;
    }
    const other = home === HOME_OF['root'] ? HOME_OF['node']! : HOME_OF['root']!;
    if (kept !== COPY(home, SWAP.to) || replaced !== COPY(home, SWAP.from) || unused !== COPY(other, SWAP.from)) {
      problems.push(
        `${SERVICE[name]} runs as ${user} (${svc.user === undefined ? "no `user:`, so the image's node" : '`user:`'}), so its entrypoint's pnpm is ${COPY(home, SWAP.to)}, and ` +
          `${dockerfileOf(name)} keeps ${kept ?? 'nothing'} (in place of ${replaced ?? 'nothing'}) and removes ${unused ?? 'nothing'}. Move the removal to the other copy, and the install and the proofs with it, or the start fails ` +
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
    const fromMoved = dockerfiles.supervisor.replace(/^FROM (\S+):v[\d.]+@/m, 'FROM $1:v4.9.0@');
    expect(composeProblems(managedText, { ...dockerfiles, supervisor: fromMoved }, workerManifest)).toContainEqual(
      expect.stringContaining('deploy/compose/supervisor/Dockerfile builds on v4.9.0, and deploy/compose/managed.yml pins v4.8.3'),
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
      expect.stringContaining('trigger-supervisor runs ghcr.io/triggerdotdev/supervisor:${TRIGGER_IMAGE_TAG:-v4.8.3}, not localhost/supervisor:'),
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
      expect.stringMatching(/^trigger-api runs as node \(no `user:`.*keeps \/root\/\.cache\/node\/corepack\/v1\/pnpm\/10\.34\.9 \(in place of \/root\/\S+\/10\.33\.2\) and removes \/home\/node\/.*Move the removal/),
    ]);
    const supAsRoot = managedText.replace(/^( {4}container_name: \$\{COMPOSE_PROJECT_NAME\}-trigger-supervisor\n)/m, '$1    user: root\n');
    expect(supAsRoot).not.toBe(managedText);
    expect(couplingProblems(supAsRoot, dockerfiles)).toEqual([expect.stringMatching(/^trigger-supervisor runs as root \(`user:`\).*Move the removal/)]);
    const odd = managedText.replace(/^ {4}user: root$/m, '    user: "1000:1000"');
    expect(couplingProblems(odd, dockerfiles)).toEqual([expect.stringContaining('trigger-api runs as 1000:1000, whose copy of pnpm neither Dockerfile knows')]);
    // And the Dockerfile moved instead: the same failure, from the other side.
    const swapped = dockerfiles['trigger.dev'].replace('unused=/home/node/', 'unused=/root/').replace('replaced=/root/', 'replaced=/home/node/').replace('kept="/root/', 'kept="/home/node/');
    expect(swapped.match(/(?:unused=|replaced=|kept=")\/home\/node\//g), 'the three copies did not all move').toHaveLength(2);
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
      // The removing RUN and the node RUN, dompurify's RUN, the swap table's and goose's, and the webapp's purge.
      expect(runs(dockerfiles[name]).length, name).toBe(2 + ownRunRows(name).length + (tableRows(name).length > 0 ? 1 : 0) + binaryRows(name).length + PURGES[name]);
      expect(purgeRuns(dockerfiles[name]).length, name).toBe(PURGES[name]);
      expect(replacingRuns(dockerfiles[name]).length, name).toBe(ownRunRows(name).length);
      expect(tableRuns(dockerfiles[name]).length, name).toBe(tableRows(name).length > 0 ? 1 : 0);
      expect(gooseRuns(dockerfiles[name]).length, name).toBe(binaryRows(name).length);
      expect(parseRef(dockerfileBase(dockerfiles[name]).ref).digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});
