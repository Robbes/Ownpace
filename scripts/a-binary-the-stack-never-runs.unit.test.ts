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
 * LINKS FROM ITS OWN NODE_MODULES). The third, the sixth and the seventh came
 * with package swaps that went at Trigger.dev v4.8.5 (2026-11-13), whose
 * lockfile resolves each fixed release itself: they are kept below as what
 * happened, and nothing here holds them now.
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
 *  - A COPY THE SCAN READS IS NOT ALWAYS A COPY THAT RUNS (2026-10-30 to
 *    2026-11-13). After the removals the webapp kept one critical a release
 *    fixes: GHSA-cg2g-xh64-v4q7 in dompurify 3.4.13, fixed in 3.4.17. Trivy
 *    reads the package.json under node_modules, but DOMPurify sanitises in a
 *    browser, and a browser runs the copy the webapp's build bundled, which a
 *    package swapped in node_modules never reaches. So before the webapp's
 *    build replaced the package's files, it proved its own bundles carried no
 *    DOMPurify and imported neither dompurify nor mermaid, and that nothing
 *    linked the package but the two requirers read. Then the swap cleared the
 *    finding where it was, and changed no code that runs. The swap itself was
 *    proved too: the tarball by the sha512 npm published, the directory
 *    before and after file for file, no other path of the image added,
 *    removed or changed, and both requirers loading the new release by
 *    require and by import. Upstream's lockfile resolves 3.4.17 since v4.8.4,
 *    and the RUN went at v4.8.5.
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
 *  - A PACKAGE PNPM INSTALLED IS NOT ITS TARBALL (2026-11-03 to 2026-11-13).
 *    From 2026-11-03 the webapp's build also swapped undici,
 *    follow-redirects, body-parser and systeminformation for the same major's
 *    release that fixes each, and the supervisor's systeminformation, from
 *    one table of rows. Run over a tree pnpm 10.33.2 installed, the first
 *    draft failed on systeminformation: pnpm links a package's own bin into
 *    the package's directory, node_modules/.bin, a shim that names the
 *    absolute paths of the install, so the directory in an image is never the
 *    tarball file for file. The swap's trees left pnpm's node_modules out,
 *    the RUN carried it over to the new release and proved it unchanged, and
 *    the stand-in's systeminformation had such a shim. The requirers were
 *    found by the links themselves, since pnpm's directory name for one
 *    carries its peers, and the supervisor's tree was resolved by `pnpm
 *    deploy --legacy`. Upstream's lockfile resolves each fixed release since
 *    v4.8.4, and the table went at v4.8.5. Since 2026-11-03 the same build
 *    also removes TypeScript 7's native compiler, the one ELF of
 *    @typescript/typescript-$plat 7.0.2, by its published SHA-256 (REMOVED),
 *    and proves `typescript` still resolves 7.0.2.
 *  - A PACKAGE OF THE WORKSPACE LINKS FROM ITS OWN NODE_MODULES (2026-11-06 to
 *    2026-11-13). effect 3.17.1 joined the table as its fifth row: of
 *    effect's three copies in the scan, the one whose requirer's range took
 *    the fix (@prisma/config pinned the other two exactly, and body-parser
 *    2.3.0 stayed, since 2.4.0 needs an iconv-lite newer than the one pnpm
 *    linked for it). Its requirer was no package of the store but one of the
 *    workspace, packages/schema-to-json, whose link is in its own
 *    node_modules, and the table's `who` read the store alone: run over a
 *    workspace pnpm 10.33.2 installed, with the real tarball, the row said
 *    "linked from: nothing". So `who` read the workspace too, in both images.
 *    The same replica showed that a tree pnpm hard-linked from its store fails
 *    a swap's state proof, since removing a directory changes the ctime of
 *    every inode it shares; the image's install copies (the four's swap
 *    proved it on CI). Since v4.8.4 upstream's overrides fix all three copies
 *    of effect (3.21.2 alone at v4.8.5), and body-parser 2.3.0 with them.
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
 *    across releases (depot and esbuild did not, from 4.7.6 to 4.8.5) proves
 *    nothing about the code that reaches it, so a version move is red until
 *    someone reads the reasons again;
 *  - REMOVED below, each path with why nothing runs it, equals what the
 *    Dockerfiles remove: read from their text, and from running their RUN
 *    instructions over a stand-in of the image's tree on both platforms, which
 *    also shows that every check fails before anything is removed when a path
 *    upstream moves is not there;
 *  - REPLACED below equals what the webapp's goose RUN names (both versions,
 *    each platform's asset and SHA-256), and that RUN checks before it
 *    changes anything and proves after, in the order held here. Run over the
 *    stand-in, with a stand-in registry and the stand-in's hash in place of
 *    the real one, it moves goose and nothing else; each way upstream or the
 *    release could differ fails it with nothing changed, and each proof after
 *    the move fails on the change it is there to see. Until v4.8.5
 *    (2026-11-13) REPLACED held dompurify's own RUN and the swap table's rows
 *    in both builds the same way; they went with their RUNs;
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
 *    Trigger.dev moves by `trigger-version.sh pin` only;
 *  - THE PURGE RUNS OVER THE STAND-IN, with a stand-in dpkg that refuses as
 *    dpkg does: the webapp's last RUN as root (0119 §3 item 11, 2026-11-06),
 *    and since 2026-11-07 Trigger.dev's Redis's one RUN as root
 *    (deploy/compose/redis/Dockerfile), the webapp's eleven in the same shape,
 *    scanned with perl; `an-essential-nothing-runs` holds both RUNs' text.
 *    Since 2026-11-08 both purge libsystemd0 and libudev1 too, thirteen, and
 *    check after the purge that no file of a removed library is left and no
 *    ELF file needs one (DT_NEEDED), over stand-in ELF files a dynamic loader
 *    would read: 64- and 32-bit, either byte order;
 *  - GOOSE'S FETCH, MADE AGAIN (2026-11-09): GitHub's release download
 *    answered 504 to the one fetch goose's RUN made, and a pull request's
 *    `build (trigger, arm64)` failed on it (CI run 42572585094). The RUN now
 *    makes a fetch that did not answer, or answered with an error, again, up
 *    to five fetches, 5, 15, 45 and 135 seconds apart, as CI's stalwart-cli
 *    and Trivy steps do. It is run over the stand-in, whose sleep only logs
 *    what it was asked to wait and whose registry answers a host's first
 *    fetches as GitHub did: four failures in a row are waited out with exactly
 *    those waits and the fifth's file goes in, held to its SHA-256 as a first
 *    fetch's is; five stop it with nothing changed and the advice to run the
 *    same tag again; and a file of another SHA-256, or one that is gone, is
 *    never fetched again. One fetch, three or four, a give-up at the third, no
 *    wait, other waits, a sixth, a late file let through unhashed, and a wrong
 *    or gone file fetched again each fail it.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
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
    "npm's bulk advisories for pnpm 10.33.2 and 10.34.9, and its published integrity and time for 10.34.9 (2026-11-02); pnpm 10.33.2 and 10.34.9 as npm published them (the update check on install and add only; the version switch and the packageManager check skipped under corepack; the same layout, engines, bins and three names); upstream's package.json, pnpm-workspace.yaml and pnpm-lock.yaml at v4.8.3, and again at v4.8.5 (2026-11-13; packageManager pnpm@10.33.2, no configDependencies, proxy settings or nodeLinker, no .npmrc or pnpmfile, one document); corepack 0.36.0 installVersion; both builds' RUNs on Node 24.22.1 with corepack 0.36.0, offline, 2026-11-02",
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
      evidence: 'finalizeDeploymentV2.server.ts and remoteImageBuilder.server.ts at v4.8.1, v4.8.3 and v4.8.5; @depot/cli lib/main.js (depot, depotBinaryPath, generateBinPath)',
    },
    {
      path: `${PNPM}/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli/bin/depot`,
      why: "the same binary under its second name: @depot/cli's postinstall hard-links it over its JavaScript shim, and Trivy does not read hard links",
      evidence: '@depot/cli install.js (maybeOptimizePackage); trivy v0.76.1 pkg/fanal/walker/tar.go',
    },
    {
      path: `${PNPM}/@esbuild+$plat@0.23.0/node_modules/@esbuild/$plat/bin/esbuild`,
      why: "esbuild's Go binary, spawned only by a build, transform or context call; it is installed for the trigger.dev CLI, which nothing in the image runs",
      evidence: 'esbuild 0.23.0 lib/main.js (ensureServiceIsRunning); packages/cli-v3 and internal-packages/dashboard-agent package.json at v4.8.1, v4.8.3 and v4.8.5',
    },
    {
      path: `${PNPM}/esbuild@0.23.0/node_modules/esbuild/bin/esbuild`,
      why: "the same binary under its second name: esbuild's postinstall hard-links it over its JavaScript shim, and Trivy does not read hard links",
      evidence: 'esbuild 0.23.0 install.js (maybeOptimizePackage); trivy v0.76.1 pkg/fanal/walker/tar.go',
    },
    {
      path: `${COPY('/root', SWAP.to)}/dist/node_modules`,
      why: "node-gyp 11.5.0 and the packages it brings, installed flat in the copy of pnpm trigger-api runs, 10.34.9's since 2026-11-02 (in 10.33.2's: tar 7.5.13 first, the owner, 2026-10-27, and since 2026-10-31 the rest, brace-expansion 2.1.0 and ip-address 10.1.0 among them, 6 fixable highs; in 10.34.9's npm lists two moderates and no high). pnpm resolves node-gyp's bin in a try, only to hand a package script its path, and the entrypoint's pnpm runs three migration scripts that call no node-gyp and install nothing",
      evidence: "pnpm 10.33.2 and 10.34.9 as npm published them: pnpm.cjs and worker.js bundle what pnpm runs, and outside dist/node_modules only pnpm.cjs's resolveFrom(__dirname, 'node-gyp/bin/node-gyp') and require.resolve('picomatch') (fdir's, for a glob() nothing calls) and bin/pnpm.cjs's require('v8-compile-cache') (only when module.enableCompileCache() answers nothing) name it, each in a try; pnpm run and exec of those files without it, 10.33.2's on Node 22.22.0 and 10.34.9's on Node 24.22.1 with corepack 0.36.0; docker/scripts/entrypoint.sh at v4.8.1, v4.8.3 and v4.8.5; Trivy 0.76.1 over 10.33.2's copy",
    },
    {
      path: `${COPY('/root', SWAP.to)}/dist/node-gyp-bin`,
      why: "the shim pnpm puts on a package script's PATH so that a script can call node-gyp, which went with dist/node_modules; no script the entrypoint's pnpm runs calls node-gyp, and a PATH entry that is not there is passed over",
      evidence: "pnpm 10.33.2 and 10.34.9 pnpm.cjs (@pnpm/npm-lifecycle's extendPath with node-gyp-bin); the migration scripts at v4.8.1, v4.8.3 and v4.8.5: prisma migrate deploy, node scripts/migrate.mjs deploy, node migrate.mjs; under 10.34.9 without it, a script that calls node-gyp says `node-gyp: not found`",
    },
    {
      path: COPY('/root', SWAP.from),
      why: "root's copy of pnpm 10.33.2, the one upstream ships for the user trigger-api runs as: the build installs 10.34.9 beside it and rewrites packageManager to pnpm@10.34.9 (SWAP), so corepack runs 10.34.9's copy and never looks at this one",
      evidence: "upstream's package.json (packageManager pnpm@10.33.2) and docker/Dockerfile at v4.8.3 and v4.8.5; corepack 0.36.0 (Node 24.22.1's and 24.22.3's) installVersion, which takes the version from packageManager; the RUN on Node 24.22.1 with corepack 0.36.0, offline, 2026-11-02",
    },
    {
      path: COPY('/home/node', SWAP.from),
      why: "node's copy of pnpm, with tar 7.5.13 in it: trigger-api runs as root (managed.yml), so every pnpm of the entrypoint runs root's copy",
      evidence: "docker/Dockerfile and docker/scripts/entrypoint.sh at v4.8.1, v4.8.3 and v4.8.5; managed.yml `user: root`; corepack 0.36.0 (Node 24.22.1's and 24.22.3's) getCorepackHomeFolder and installVersion",
    },
    ...npmRemovals('trigger-api', 'the entrypoint runs pnpm (through corepack), goose and node, the migrations prisma and node, the healthcheck `node -e`, and the bring-up execs only `test` and `chown` into it'),
    {
      path: TSC.path,
      why: "TypeScript 7's native compiler (Go 1.26.4, golang.org/x/text v0.38.0: 15 fixable highs), the one ELF of typescript 7.0.2's platform package, there because typescript 7.0.2 is a resolved peer of prisma 6.14.0, @remix-run/* and class-variance-authority. `typescript` 7.0.2 exports \".\" as lib/version.cjs, which holds no compiler; the binary is reached only through bin/tsc or the unstable API's getExePath, and the image's one caller of the package, prisma's build/index.js, reads `(await import(\"typescript\")).default.version`",
      evidence: "typescript 7.0.2 and @typescript/typescript-linux-x64 and -arm64 7.0.2 as npm published them (package.json exports, lib/version.cjs, lib/getExePath.js, lib/tsc.js, dist/api/options.js; each lib/tsc's SHA-256, one name, no install script); upstream's pnpm-lock.yaml, docker/scripts/entrypoint.sh, apps/webapp and internal-packages at v4.8.3, and the files v4.8.5 changes there (tsc only in @trigger.dev/database's build, dev and typecheck scripts); prisma 6.14.0 build/index.js; the RUN's lines over a tree pnpm 10.33.2 installed, on Node 24.22.1, 2026-11-03",
    },
  ],
  supervisor: [
    {
      path: COPY('/root', SWAP.from),
      why: "root's copy of pnpm, with tar 7.5.13 in it: trigger-supervisor runs as the image's node (no `user:`), whose copy its CMD runs",
      evidence: "apps/supervisor/Containerfile and entrypoint.sh at v4.8.1, v4.8.3 and v4.8.5; managed.yml (no `user:`); corepack 0.36.0 (Node 24.22.1's and 24.22.3's) getCorepackHomeFolder and installVersion",
    },
    {
      path: COPY('/home/node', SWAP.from),
      why: "node's copy of pnpm 10.33.2, the one upstream ships for the user trigger-supervisor runs as: the build installs 10.34.9 beside it, as node's, and rewrites packageManager to pnpm@10.34.9 (SWAP), so the CMD's corepack runs 10.34.9's copy and never looks at this one",
      evidence: "apps/supervisor/Containerfile and the root package.json (packageManager pnpm@10.33.2) at v4.8.3 and v4.8.5; corepack 0.36.0 installVersion; the RUNs on Node 24.22.1 with corepack 0.36.0, offline, 2026-11-02",
    },
    {
      path: `${COPY('/home/node', SWAP.to)}/dist/node_modules`,
      why: "node-gyp 11.5.0 and the packages it brings, installed flat in the copy of pnpm the supervisor runs, 10.34.9's since 2026-11-02 (in 10.33.2's: tar 7.5.13 first, the owner, 2026-10-27, and since 2026-10-31 the rest, brace-expansion 2.1.0 and ip-address 10.1.0 among them, 6 fixable highs). The CMD's `pnpm run` runs `node dist/index.js`, which calls no node-gyp and installs nothing",
      evidence: "pnpm 10.33.2 and 10.34.9 as npm published them (the webapp's entry); apps/supervisor/package.json's start at v4.8.1, v4.8.3 and v4.8.5; Trivy 0.76.1 over 10.33.2's copy",
    },
    {
      path: `${COPY('/home/node', SWAP.to)}/dist/node-gyp-bin`,
      why: "the shim pnpm puts on a package script's PATH so that a script can call node-gyp, which went with dist/node_modules; the supervisor's start script calls no node-gyp",
      evidence: "pnpm 10.33.2 and 10.34.9 pnpm.cjs (@pnpm/npm-lifecycle's extendPath with node-gyp-bin); apps/supervisor/package.json's start at v4.8.1, v4.8.3 and v4.8.5",
    },
    ...npmRemovals('trigger-supervisor', 'the CMD runs pnpm (through corepack), the entrypoint dumb-init, the healthcheck `node -e`, nothing execs into it but the smoke, by `node -e` too (since 2026-11-02), and the supervisor spawns nothing'),
  ],
};

/** npm, which Node 24.22.3 bundles as 24.22.1 did, and Node's two links to it: the same three removals in both images. */
function npmRemovals(service: string, runs: string): Removal[] {
  const why = (what: string) =>
    `${what}: no process of ${service} runs npm or npx (${runs}); pnpm looks for npm only to read its builtin npmrc, in a try, and Node's npm carries none. npm's bundled brace-expansion 5.0.9 and undici 6.28.0 were 6 fixable highs`;
  const evidence =
    'node:24.22.1-bookworm-slim and node:24.22.1-alpine by digest (Trivy 0.76.1) and Node 24.22.1\'s tarball (bin/npm, bin/npx); node:24.22.3-bookworm-slim and node:24.22.3-alpine, v4.8.5\'s bases, their layers read by digest on 2026-11-13 (npm 11.19.1 with brace-expansion 5.0.9 and undici 6.28.0, no npmrc, the same two links); pnpm 10.33.2 pnpm.cjs (@pnpm/npm-conf: require.resolve("npm") from the global folder, failedToLoadBuiltInConfig read only by pnpm doctor)';
  return [
    { path: '/usr/local/lib/node_modules/npm', why: why('npm 11.19.1, which Node 24.22.3 bundles, as 24.22.1 did'), evidence },
    { path: '/usr/local/bin/npm', why: why("Node's link to npm's bin/npm-cli.js"), evidence },
    { path: '/usr/local/bin/npx', why: why("Node's link to npm's bin/npx-cli.js"), evidence },
  ];
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

/** What each Dockerfile replaces, and why. Must equal what its replacing RUN names. */
const REPLACED: Readonly<Record<Name, readonly BinaryReplacement[]>> = {
  'trigger.dev': [
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
        "goose's tags v3.27.1 and v3.29.0 (v3.29.0 at 8b457ba3; cmd/goose/main.go, internal/dialects/clickhouse.go, CHANGELOG.md, #1085); the v3.29.0 release's assets (uploaded 2026-10-11 17:48 UTC, their Last-Modified), downloaded and hashed 2026-11-03, and `-version` of the amd64 one; goose v3.27.1 built as upstream builds it (go install, Go 1.26.10), its `-version` and its symbol table; Trivy 0.76.1 over both, executable; upstream's docker/Dockerfile and docker/scripts/entrypoint.sh at v4.8.3 and v4.8.5; managed.yml's CLICKHOUSE_URL; the RUN over a stand-in root with that build and the real release asset, on Node 24.22.1, 2026-11-03",
    },
  ],
  supervisor: [],
};

/** The binaries each image replaces: goose, in the webapp's. */
const binaryRows = (name: Name) => REPLACED[name].filter((r) => r.kind === 'binary');

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
/** corepack 0.36.0, Node 24.22.1's and 24.22.3's, which runs every pnpm here: checked before the removals and proved after. */
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
  checkedBefore(/\[ "\$\(node -p "require\('\$npm_dir\/package\.json'\)\.version"\)" = 11\.19\.1 \] \|\| fail /, "that npm is Node 24.22.3's 11.19.1");
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
 * `between`, a pattern, is what stands between the fetch's exit and the `case`
 * that routes it: nothing, or the rest of the loop that fetches again
 * (goose's since 2026-11-09, GOOSE_LOOP_TAIL).
 */
function fetchProblems(args: string, file: string, who: string, between = ''): string[] {
  const problems: string[] = [];
  const target = file.replace(/[$.]/g, '\\$&');
  if (!new RegExp(`node -e "fetch\\(process\\.argv\\[1\\]\\)\\.then\\(async \\(r\\) => \\{ if \\(!r\\.ok\\) \\{ [^"\\n]*process\\.exit\\(r\\.status === 404 \\|\\| r\\.status === 410 \\? 4 : 3\\); \\}[^"\\n]*\\}, \\(e\\) => \\{ [^"\\n]*process\\.exit\\(3\\); \\}\\)" "\\$url" "${target}" && st=0 \\|\\| st=\\$\\?; ${between}\\s*case "\\$st" in 0\\) ;; 3\\) unreachable "\\$url" ;; 4\\) gone "\\$url" ;; \\*\\) fail `).test(args)) {
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

/** The RUN that replaces goose: the one that names it. */
const gooseRuns = (text: string) => runs(text).filter((r) => /(^|[;\s])goose=\/usr\/local\/bin\/goose;/.test(r.args));

/**
 * goose's fetch, made again (2026-11-09: GitHub's release download answered
 * 504 to the one fetch the RUN made, and a pull request's build failed on it,
 * CI run 42572585094): the rest of the loop the fetch is made in, from its
 * exit to the `case` that routes it. A fetch that exited 3 (no answer, or an
 * error) is made again until the fifth, after a wait that starts at 5 seconds
 * and is multiplied by 3 each time (the RUN's dash has no `**`); any other
 * exit, and the fifth's, leave the loop for the `case`, and what was fetched
 * is hashed after it. That the waits are 5, 15, 45 and 135 seconds, and the
 * rest, is proved by running the RUN (`gooseRetryFaults`); this is the shape
 * that run reads.
 */
const GOOSE_LOOP_TAIL = String.raw`\s*if \[ "\$st" != 3 \] \|\| \[ "\$attempt" = 5 \]; then break; fi; \s*echo "\$me: \$url did not answer, or answered with an error \(above\), at fetch \$attempt of 5;[^"\n]*" >&2; \s*sleep "\$delay"; \s*delay=\$\(\(delay \* 3\)\); \s*done;`;
/** The loop's head and the fetch it makes, then GOOSE_LOOP_TAIL. */
const GOOSE_LOOP = new RegExp(String.raw`(?:^|[;\s])delay=5; \s*for attempt in 1 2 3 4 5; do \s*node -e "fetch\(process\.argv\[1\]\)[^\n]*" "\$url" "\$tmp/goose" && st=0 \|\| st=\$\?; ` + GOOSE_LOOP_TAIL);

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
  const loop = GOOSE_LOOP.test(args);
  if (!loop) {
    problems.push(
      "goose's RUN does not make a fetch that did not answer, or answered with an error, again: up to five fetches, 5, 15, 45 and 135 seconds apart, and every other exit out of the loop to the case that routes it",
    );
  }
  problems.push(...fetchProblems(args, '$tmp/goose', "goose's RUN", loop ? GOOSE_LOOP_TAIL : ''));
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
   * A host's first answers, one per fetch and in order, before it answers as `answers` and the
   * registry say: each 'unreachable' (no answer) or an HTTP status. A release download that
   * answers 504 for a while, then serves the file (2026-11-09).
   */
  readonly firstAnswers?: Readonly<Record<string, ReadonlyArray<'unreachable' | number>>>;
  /** The stand-in's own hash of goose's new release, which takes the real one's place in its RUN (`build`). */
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
 * The stand-in's entrypoint. The build compares the real one with the hash the
 * Dockerfile pins, which only the real image carries, so the stand-in's hash
 * takes its place in the RUN (`build`, unless told to keep the pinned one).
 */
const STAND_IN_ENTRYPOINT = '#!/bin/sh\nexec "$@"\n';
const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

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

/** Where Node 24.22.3 puts npm and corepack, and its links to them, as 24.22.1 did. */
const NPM_DIR = '/usr/local/lib/node_modules/npm';
const COREPACK_DIR = '/usr/local/lib/node_modules/corepack';
const NODE_LINKS: ReadonlyArray<{ path: string; target: string }> = [
  { path: '/usr/local/bin/npm', target: '../lib/node_modules/npm/bin/npm-cli.js' },
  { path: '/usr/local/bin/npx', target: '../lib/node_modules/npm/bin/npx-cli.js' },
  { path: '/usr/local/bin/corepack', target: '../lib/node_modules/corepack/dist/corepack.js' },
  // `corepack enable` in upstream's runner stage.
  { path: '/usr/local/bin/pnpm', target: '../lib/node_modules/corepack/dist/pnpm.js' },
];

/** Node 24.22.3's npm and corepack, as its image carries them (24.22.1's the same), with one of npm's bundled packages. */
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
  'libsystemd.so.0': 'libsystemd0',
  'libudev.so.1': 'libudev1',
};

/** What stays after the purge, in the stand-in's Debian 12: nothing it keeps depends on what it purged. */
const STAYS = ['coreutils', 'tar', 'dpkg', 'libacl1', 'zlib1g', 'libext2fs2', 'libss2', 'libcom-err2', 'logsave', 'libcap2', 'libgcrypt20', 'liblz4-1', 'liblzma5', 'libzstd1'];

/**
 * The stand-in's Debian 12, as far as the webapp's purge reads it: every
 * package the RUN names installed, util-linux and bsdutils Essential, each
 * library under its platform's directory (not in the stand-in's tree, so a
 * purge removes nothing there unless a test puts one in), the dependencies
 * among them that Debian 12 has (util-linux on its libraries, on
 * util-linux-extra and on libsystemd0 and libudev1, mount on util-linux, apt
 * on libapt-pkg6.0 and libsystemd0, libapt-pkg6.0 on libsystemd0 and
 * libudev1, bsdutils on libsystemd0, e2fsprogs on libblkid1 and libuuid1 and
 * on its own libraries, which stay, and libsystemd0 on its own, which stay
 * too: read 2026-11-08 in the Redis and Node images' dpkg status), and
 * packages that stay and depend on none of them.
 */
function debian12(plat: string, text: string = dockerfiles['trigger.dev']): DpkgDb {
  const lib = (so: string) => [`/usr/lib/${TRIPLET[plat] ?? plat}/${so}`];
  const { packages, libraries } = purgeLists(text);
  const ships = (name: string) => libraries.filter((so) => SHIPPED_BY[so] === name).flatMap(lib);
  const depends: Readonly<Record<string, readonly string[]>> = {
    'util-linux': ['libblkid1', 'libmount1', 'libsmartcols1', 'libuuid1', 'util-linux-extra', 'libacl1', 'libsystemd0', 'libudev1'],
    'util-linux-extra': ['libblkid1', 'libsmartcols1', 'libuuid1'],
    mount: ['util-linux', 'libblkid1', 'libmount1', 'libsmartcols1'],
    bsdutils: ['libsystemd0'],
    libmount1: ['libblkid1'],
    apt: ['libapt-pkg6.0', 'zlib1g', 'libsystemd0'],
    'libapt-pkg6.0': ['zlib1g', 'libsystemd0', 'libudev1'],
    e2fsprogs: ['libblkid1', 'libcom-err2', 'libext2fs2', 'libss2', 'libuuid1', 'logsave'],
    libsystemd0: ['libcap2', 'libgcrypt20', 'liblz4-1', 'liblzma5', 'libzstd1'],
  };
  const out: Record<string, DpkgPackage> = {
    coreutils: { version: '9.1-1', status: 'installed', essential: true, depends: ['libacl1'] },
    tar: { version: '1.34+dfsg-1.2+deb12u1', status: 'installed', essential: true, depends: ['libacl1'] },
    dpkg: { version: '1.21.22', status: 'installed', essential: true, depends: ['tar', 'zlib1g', 'liblzma5', 'libzstd1'] },
    libacl1: { version: '2.3.1-3', status: 'installed' },
    zlib1g: { version: '1:1.2.13.dfsg-1', status: 'installed' },
    // e2fsprogs' own libraries and logsave stay: in Debian 12 they need libc6 and libcom-err2 alone.
    libext2fs2: { version: '1.47.0-2+b2', status: 'installed' },
    libss2: { version: '1.47.0-2+b2', status: 'installed', depends: ['libcom-err2'] },
    'libcom-err2': { version: '1.47.0-2+b2', status: 'installed' },
    logsave: { version: '1.47.0-2+b2', status: 'installed' },
    // What libsystemd0 needs stays: dpkg purges what it is given, never what that needed.
    libcap2: { version: '1:2.66-4+deb12u3+b1', status: 'installed' },
    libgcrypt20: { version: '1.10.1-3+deb12u1', status: 'installed' },
    'liblz4-1': { version: '1.9.4-1', status: 'installed' },
    liblzma5: { version: '5.4.1-1+deb12u2', status: 'installed' },
    libzstd1: { version: '1.5.4+dfsg2-5', status: 'installed' },
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

/**
 * A dynamically linked ELF file as the dynamic loader reads one, and no more:
 * the ELF header, a PT_LOAD over the whole file at 0x400000 and a PT_DYNAMIC,
 * a dynamic section with one DT_NEEDED for each of `needed`, then DT_STRTAB,
 * DT_STRSZ and DT_NULL, and the string table, which also carries `text` where
 * no DT_NEEDED points (a name a program opens with dlopen, say). 64-bit and
 * little-endian, as both platforms are, unless asked for 32-bit or big-endian,
 * so the purge's check is proved on every class and byte order it reads.
 * Data only: nothing runs it.
 */
function dynamicElf(needed: readonly string[], { bits = 64, endian = 'le', text = '' }: { bits?: 32 | 64; endian?: 'le' | 'be'; text?: string } = {}): Buffer {
  const w = bits === 64 ? 8 : 4;
  const ehsize = bits === 64 ? 64 : 52;
  const phentsize = bits === 64 ? 56 : 32;
  const base = 0x400000;
  const offsets: number[] = [];
  let strtab = Buffer.from([0]);
  for (const name of [...needed, ...(text ? [text] : [])]) {
    offsets.push(strtab.length);
    strtab = Buffer.concat([strtab, Buffer.from(`${name}\0`)]);
  }
  const dynoff = ehsize + 2 * phentsize;
  const entries: Array<[number, number]> = needed.map((_, i) => [1, offsets[i]!]);
  const dynsz = (entries.length + 3) * 2 * w;
  const stroff = dynoff + dynsz;
  entries.push([5, base + stroff], [10, strtab.length], [0, 0]);
  const size = stroff + strtab.length;
  const b = Buffer.alloc(size);
  const le = endian === 'le';
  const u16 = (v: number, at: number) => (le ? b.writeUInt16LE(v, at) : b.writeUInt16BE(v, at));
  const u32 = (v: number, at: number) => (le ? b.writeUInt32LE(v, at) : b.writeUInt32BE(v, at));
  const word = (v: number, at: number) => (w === 8 ? (le ? b.writeBigUInt64LE(BigInt(v), at) : b.writeBigUInt64BE(BigInt(v), at)) : u32(v, at));
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, bits === 64 ? 2 : 1, le ? 1 : 2, 1]).copy(b, 0);
  u16(3, 16); // ET_DYN
  u16(bits === 64 ? 183 : 20, 18); // AArch64, or 32-bit PowerPC: the check reads neither
  u32(1, 20);
  if (bits === 64) {
    word(ehsize, 32); // e_phoff
    u16(ehsize, 52);
    u16(phentsize, 54);
    u16(2, 56); // e_phnum
  } else {
    word(ehsize, 28);
    u16(ehsize, 40);
    u16(phentsize, 42);
    u16(2, 44);
  }
  const header = (i: number, type: number, offset: number, filesz: number) => {
    const p = ehsize + i * phentsize;
    u32(type, p);
    if (bits === 64) {
      u32(4, p + 4); // p_flags: R
      word(offset, p + 8);
      word(base + offset, p + 16); // p_vaddr
      word(base + offset, p + 24);
      word(filesz, p + 32);
      word(filesz, p + 40);
      word(0x1000, p + 48);
    } else {
      word(offset, p + 4);
      word(base + offset, p + 8);
      word(base + offset, p + 12);
      word(filesz, p + 16);
      word(filesz, p + 20);
      u32(4, p + 24);
      word(0x1000, p + 28);
    }
  };
  header(0, 1, 0, size); // PT_LOAD
  header(1, 2, dynoff, dynsz); // PT_DYNAMIC
  entries.forEach(([tag, value], i) => {
    word(tag, dynoff + i * 2 * w);
    word(value, dynoff + i * 2 * w + w);
  });
  strtab.copy(b, stroff);
  return b;
}

/** The stand-in's dpkg database after a build, and the dpkg calls it logged, in order. */
function dpkgOf(box: Sandbox): { db: DpkgDb; calls: string[] } {
  const db = JSON.parse(readFileSync(join(box.root, 'dpkg.json'), 'utf8')) as DpkgDb;
  // No tool log is no tool called.
  const log = existsSync(join(box.root, 'tools.log')) ? readFileSync(join(box.root, 'tools.log'), 'utf8') : '';
  return { db, calls: log.split('\n').filter((l) => /^dpkg(-query)? /.test(l)) };
}

function treeOf(name: Name, plat: string): Tree {
  if (name === 'supervisor') {
    return {
      files: {
        [ROOT_PKG.supervisor]: `{"packageManager":"pnpm@${SWAP.from}"}\n`,
        '/app/packages/core/package.json': '{"version":"4.8.5"}\n',
        [ENTRYPOINT.supervisor]: STAND_IN_ENTRYPOINT,
        ...pnpmCopy('/root', SWAP.from),
        ...pnpmCopy('/home/node', SWAP.from),
        ...NODE_GLOBALS,
      },
      binaries: [],
      links: [...NODE_LINKS],
      pnpm: PUBLISHED,
    };
  }
  const pkg = (dir: string): Record<string, string> => ({ [`${dir}/package.json`]: '{"main":"lib/main.js"}\n', [`${dir}/lib/main.js`]: 'module.exports = {};\n' });
  const dpkg = debian12(plat);
  const ts = typescriptTree();
  const goose = GOOSE.assets[plat as Plat];
  return {
    links: [...NODE_LINKS, ...ts.links!],
    pnpm: PUBLISHED,
    registry: goose ? { [goose.url]: STAND_IN_GOOSE_NEW } : {},
    standIn: { goose: sha256(STAND_IN_GOOSE_NEW) },
    // goose is static; openssl, which upstream's runner stage installs, needs what the purge keeps.
    executables: { [GOOSE.path]: STAND_IN_GOOSE_OLD, '/usr/bin/openssl': dynamicElf(['libssl.so.3', 'libcrypto.so.3', 'libc.so.6']) },
    tools: gooseTools(),
    dpkg,
    files: {
      [ROOT_PKG['trigger.dev']]: `{"packageManager":"pnpm@${SWAP.from}"}\n`,
      '/triggerdotdev/packages/core/package.json': '{"version":"4.8.5"}\n',
      [ENTRYPOINT['trigger.dev']]: STAND_IN_ENTRYPOINT,
      ...pkg(`${PNPM}/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli`),
      ...pkg(`${PNPM}/esbuild@0.23.0/node_modules/esbuild`),
      // pnpm's own shims are scripts, and stay.
      [`${PNPM}/node_modules/.bin/esbuild`]: '#!/bin/sh\nexec node "$@"\n',
      ...pnpmCopy('/root', SWAP.from),
      ...pnpmCopy('/home/node', SWAP.from),
      ...NODE_GLOBALS,
      ...ts.files,
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
  for (const [host, answers] of Object.entries(tree.firstAnswers ?? {})) {
    mkdirSync(join(root, 'registry', host), { recursive: true });
    writeFileSync(join(root, 'registry', host, '.first'), answers.map((a) => `${a}\n`).join(''));
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
  // And sleep is ALWAYS the stand-in's: it logs the seconds it was asked to
  // wait and returns at once, so a RUN's waits are read here, never waited
  // (goose's fetch waits up to 200 seconds in all, 2026-11-09).
  writeFileSync(join(bin, 'sleep'), `#!/bin/sh\nprintf '%s %s\\n' sleep "$*" >> "$TOOL_LOG"\n`, { mode: 0o755 });
  // And no apt at all: the webapp's purge removes it, so a RUN that calls it fails, here as in the image.
  for (const cmd of ['apt', 'apt-get']) {
    writeFileSync(join(bin, cmd), `#!/bin/sh\nprintf '%s %s\\n' ${cmd} "$*" >> "$TOOL_LOG"\necho "${cmd}: the stand-in has no apt, and the image has none after its purge" >&2\nexit 3\n`, { mode: 0o755 });
  }
  for (const [name, script] of Object.entries(tree.tools ?? {})) writeFileSync(join(bin, name), script, { mode: 0o755 });
  // Node itself, told the platform it is asked about, and with no network: a
  // fetch is logged, then answered by the host's next first answer, if one is
  // left, by its constant answer, or from the stand-in registry, or with a 404.
  writeFileSync(
    join(bin, 'preload.cjs'),
    [
      "for (const k of ['platform', 'arch']) { const v = process.env['FAKE_' + k.toUpperCase()]; if (v) Object.defineProperty(process, k, { value: v }); }",
      "globalThis.fetch = async (url) => { const fs = require('fs'); const path = require('path'); const u = new URL(String(url)); const reg = process.env.FAKE_REGISTRY || '/nonexistent'; if (process.env.FETCH_LOG) fs.appendFileSync(process.env.FETCH_LOG, String(url) + '\\n'); let answer = null; const first = path.join(reg, u.hostname, '.first'); if (fs.existsSync(first)) { const left = fs.readFileSync(first, 'utf8').split('\\n').filter(Boolean); if (left.length > 0) { answer = left[0]; fs.writeFileSync(first, left.slice(1).map((l) => l + '\\n').join('')); } } const a = path.join(reg, u.hostname, '.answer'); if (answer === null && fs.existsSync(a)) answer = fs.readFileSync(a, 'utf8'); if (answer !== null) { if (answer === 'unreachable') throw Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND ' + u.hostname) }); return new Response('stand-in', { status: Number(answer) }); } const f = path.join(reg, u.hostname, u.pathname); return fs.existsSync(f) ? new Response(fs.readFileSync(f)) : new Response('not in the stand-in registry', { status: 404 }); };",
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
  /** Keep tsc's SHA-256 the removing RUN pins, which the stand-in's tsc is not. */
  readonly pinnedTsc?: boolean;
  /** Keep goose's SHA-256 the goose RUN pins, which the stand-in's new goose is not. */
  readonly pinnedGoose?: boolean;
  /** Only the RUNs this picks. */
  readonly pick?: (run: Instruction) => boolean;
}

/** Runs a Dockerfile's RUN instructions in order, each as its USER, and stops at the first that fails. */
function build(text: string, box: Sandbox, { plat = 'linux-arm64', tag = '', only, pinnedEntrypoint = false, pinnedTsc = false, pinnedGoose = false, pick }: Options = {}): Run {
  const [platform, arch] = plat.split('-') as [string, string];
  let out = '';
  for (const run of runs(text)) {
    if (only && run.user !== only) continue;
    if (pick && !pick(run)) continue;
    let script = pinnedEntrypoint ? run.args : run.args.replace(/(?<=(^|[;\s])entrypoint_sha256=)[0-9a-f]{64}/, sha256(STAND_IN_ENTRYPOINT));
    const standIn = box.standIn ?? {};
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
        FETCH_LOG: join(box.root, 'fetches.log'),
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

/** Every URL the RUNs' node fetched, in order, whatever it was answered. */
function fetchesOf(box: Sandbox): string[] {
  const file = join(box.root, 'fetches.log');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}

/** Every wait the RUNs asked the stand-in's sleep for, as they asked it, in order. */
function waitsOf(box: Sandbox): string[] {
  const file = join(box.root, 'tools.log');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('sleep ')).map((l) => l.slice('sleep '.length)) : [];
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
    expect(swap(/^ARG TRIGGER_IMAGE_TAG$/m, 'ARG TRIGGER_IMAGE_TAG=v4.8.5')).toEqual([expect.stringContaining('not one `ARG TRIGGER_IMAGE_TAG` with no default')]);
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
    expect(swap(/^( {4}read_at=)v[\d.]+;/m, '$1v4.8.0;')).toEqual([expect.stringContaining('read_at is v4.8.0, and the FROM is v4.8.5')]);
    // What `trigger-version.sh pin` does: the FROM moves, read_at stays, and this says to read again.
    expect(swap(/^(FROM \S+:)v[\d.]+@/m, '$1v4.9.0@')).toEqual([expect.stringContaining('read_at is v4.8.5, and the FROM is v4.9.0: read the header')]);
    expect(swap(/^ {4}\[ "\$core" = "\$read_at" \] \|\| fail [^\n]*\n/m, '')).toEqual([
      'the removing RUN does not refuse an image of another version than read_at before it removes anything',
    ]);
    expect(swap(/^ {4}entrypoint_sha256=[0-9a-f]{64}; \\\n/m, '')).toEqual([expect.stringContaining('does not pin /triggerdotdev/scripts/entrypoint.sh by its SHA-256')]);
    expect(swap(/^ {4}\[ "\$\(sha256sum [^\n]*\n/m, '')).toEqual(['the removing RUN names the entrypoint and its hash, and never compares them']);
    // node-gyp's tree out of the copy that runs, and npm: each check before the first `rm`, and the proofs after the last.
    const named = 'no check, before anything is removed, that no file of the kept copy outside its dist/node_modules names a package inside it but the three read';
    expect(swap(/^ {4}\[ "\$named" = [^\n]*\n/m, '')).toEqual([named]);
    expect(swap(/^ {4}named="\$\(find [^\n]*\n/m, '')).toEqual([named]);
    expect(swap(/^ {4}\[ "\$\(node -p "require\('\$npm_dir\/package\.json'\)\.version"\)" = 11\.19\.1 \][^\n]*\n/m, '')).toEqual(["no check, before anything is removed, that npm is Node 24.22.3's 11.19.1"]);
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
          const run = build(dockerfiles[name], box, { plat, tag: 'v4.8.5' });
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
        expect(run.out).toContain('the .env names TRIGGER_IMAGE_TAG=v4.9.0, and this checkout builds Trigger.dev v4.8.5');
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
          expect(run.out).toContain(`was read in Trigger.dev v4.8.5's source, and this image is v4.9.0`);
          expect(run.out).toContain('then move read_at');
          expect(removedBy(box, run), name).toEqual([]);
        });
      }
      // The pinned hash, which the stand-in's entrypoint is not: a changed entrypoint.
      withSandbox(tree, (box) => {
        const run = build(dockerfiles[name], box, { plat: 'linux-x64', pinnedEntrypoint: true });
        expect(run.status, name).not.toBe(0);
        expect(run.out).toContain(`${box.fs}${ENTRYPOINT[name]} is not the one read at v4.8.5`);
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
          const run = build(dockerfiles[name], box, { plat, tag: 'v4.8.5' });
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
          const run = build(dockerfiles[name], box, { plat: 'linux-arm64', tag: 'v4.8.5' });
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
          const run = build(dockerfiles[name], box, { tag: 'v4.8.5' });
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
        const run = build(real.replace(rewrite, ''), box, { tag: 'v4.8.5' });
        expect(run.status, name).not.toBe(0);
        expect(run.out).toContain(`${box.fs}${ROOT_PKG[name]} names pnpm@${SWAP.from} after the rewrite, not pnpm@${SWAP.to}`);
      });
      // Without both, the proof as the service's user does: corepack, offline, looks for the copy the build removed.
      withSandbox(treeOf(name, 'linux-arm64'), (box) => {
        const run = build(real.replace(rewrite, '').replace(readBack, ''), box, { tag: 'v4.8.5' });
        expect(run.status, name).not.toBe(0);
        expect(run.out).toContain('Network access disabled by the environment');
        expect(run.out).toContain(name === 'trigger.dev' ? 'as root, the user trigger-api runs as, pnpm 10.34.9 does not start offline' : 'as node, the user trigger-supervisor runs as, pnpm 10.34.9 does not start offline');
      });
      // A package.json that names it twice: the rewrite refuses to choose.
      const tree = treeOf(name, 'linux-arm64');
      const twice = `{"packageManager": "pnpm@${SWAP.from}", "devEngines": {"packageManager": "pnpm@${SWAP.from}"}}\n`;
      withSandbox({ ...tree, files: { ...tree.files, [ROOT_PKG[name]]: twice } }, (box) => {
        const run = build(real, box, { tag: 'v4.8.5' });
        expect(run.status, name).not.toBe(0);
        expect(run.out).toContain(`names packageManager as: pnpm@${SWAP.from}, pnpm@${SWAP.from}`);
        expect(run.out).toContain(`${box.fs}${ROOT_PKG[name]}'s packageManager was not rewritten to pnpm@${SWAP.to}`);
        expect(readFileSync(join(box.fs, ROOT_PKG[name]), 'utf8')).toBe(twice);
      });
      // The file's own spacing is kept: one field moves, and nothing else of the file.
      const spaced = `{\n  "name": "triggerdotdev",\n  "packageManager": "pnpm@${SWAP.from}",\n  "private": true\n}\n`;
      withSandbox({ ...tree, files: { ...tree.files, [ROOT_PKG[name]]: spaced } }, (box) => {
        const run = build(real, box, { tag: 'v4.8.5' });
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
    // Root's one RUN, the removing RUN (until v4.8.5 the swap table's RUN came after it, with a chown of its own).
    withSandbox({ ...treeOf('supervisor', 'linux-arm64'), tools }, (box) => {
      const run = build(dockerfiles.supervisor, box, { only: 'root', tag: 'v4.8.5' });
      expect(run.status, run.out).toBe(0);
      const chowns = readFileSync(join(box.root, 'tools.log'), 'utf8').split('\n').filter((l) => l.startsWith('chown '));
      expect(chowns).toEqual([`chown -R 4242:4343 ${box.fs}${COREPACK_HOME('/home/node')}`]);
    });
    expect(narrow).not.toBe(dockerfiles.supervisor);
    withSandbox({ ...treeOf('supervisor', 'linux-arm64'), tools }, (box) => {
      const run = build(narrow, box, { only: 'root', tag: 'v4.8.5' });
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
          const run = build(dockerfiles[name], box, { tag: 'v4.8.5' });
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
          const run = build(dockerfiles[name], box, { plat: 'linux-x64', tag: 'v4.8.5' });
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
// What the tests of the RUNs that change the image share.

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

// ---------------------------------------------------------------------------
// Since 2026-11-03: TypeScript 7's tsc goes and goose is the release's binary (and until 2026-11-13 a table swapped
// four packages, five from 2026-11-06).

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
      const run = build(webapp, box, { ...removingOnlyRun, plat, tag: 'v4.8.5', pinnedTsc: true });
      expect(run.status, run.out).not.toBe(0);
      expect(run.out).toContain(`${box.fs}${expand(TSC.path, plat)} is not TypeScript 7.0.2's tsc for ${plat} as npm published it (SHA-256 ${TSC.sha256[plat]})`);
      expect(removedBy(box, run)).toEqual([]);
      expect(corepackCalls(box)).toEqual([]);
    });
    // A second name: the scan would read 0 while the same ELF stayed.
    const second = `${PNPM}/@typescript+typescript-${plat}@7.0.2/node_modules/@typescript/typescript-${plat}/bin/tsc-native`;
    withSandbox({ ...tree, binaries: tree.binaries.map((b) => (b.path.endsWith('/lib/tsc') ? { ...b, link: second } : b)) }, (box) => {
      const run = build(webapp, box, { ...removingOnlyRun, plat, tag: 'v4.8.5' });
      expect(run.status, run.out).not.toBe(0);
      expect(run.out).toContain(`${box.fs}${expand(TSC.path, plat)} has 2 names: a second name would keep the binary`);
      expect(removedBy(box, run)).toEqual([]);
    });
    // prisma without its link to typescript 7.0.2: the proof after the removal fails.
    withSandbox({ ...tree, links: tree.links!.filter((l) => l.path !== `${dirname(TSC.prisma)}/typescript`) }, (box) => {
      const run = build(webapp, box, { ...removingOnlyRun, plat, tag: 'v4.8.5' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`from ${box.fs}${TSC.prisma}, require('typescript') does not give 7.0.2 from ${box.fs}${TSC.typescript} without its binary.`);
    });
    // A typescript whose "." is no longer lib/version.cjs, though it says 7.0.2.
    const moved = { ...tree.files, [`${TSC.typescript}/package.json`]: `${JSON.stringify({ name: 'typescript', version: '7.0.2', type: 'module', exports: { [`./${'package'}.json`]: `./${'package'}.json`, '.': './lib/api.cjs' } })}\n`, [`${TSC.typescript}/lib/api.cjs`]: 'exports.version = "7.0.2";\n' };
    withSandbox({ ...tree, files: moved }, (box) => {
      const run = build(webapp, box, { ...removingOnlyRun, plat, tag: 'v4.8.5' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`require(typescript): ${box.fs}${TSC.typescript}/lib/api.cjs 7.0.2`);
    });
    // Another TypeScript's native binary, which REMOVED does not name: the build stops rather than ship it.
    const other = `${PNPM}/@typescript+native-preview-${plat}@7.1.0/node_modules/@typescript/native-preview-${plat}/lib/tsgo`;
    withSandbox({ ...tree, binaries: [...tree.binaries, { path: other }] }, (box) => {
      const run = build(webapp, box, { ...removingOnlyRun, plat, tag: 'v4.8.5' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`a depot, esbuild or tsc binary is still there: ${box.fs}${other}`);
    });
  });
});

/** goose's RUN as it was until 2026-11-09: its loop taken out, the one fetch in its place. */
const oneGooseFetch = (text: string) => {
  const once = text.replace(/ {4}delay=5; \\\n {4}for attempt in 1 2 3 4 5; do \\\n {6}(node -e [^\n]*) \\\n(?: {6}[^\n]*\n)*? {4}done; \\\n/, '    $1 \\\n');
  expect(once, "goose's RUN has no loop to take out").not.toBe(text);
  return once;
};

/**
 * What is wrong with how goose's RUN rides out GitHub's release download not
 * answering, run over the stand-in on linux-x64; empty when it holds. On
 * 2026-11-09 the download answered 504 to the one fetch the RUN made, and a
 * pull request's `build (trigger, arm64)` failed on it (CI run 42572585094).
 * Four fetches in a row that do not answer, or answer with an error, are made
 * again 5, 15, 45 and 135 seconds later, each saying which of the five it was,
 * and the fifth's file goes in; what the fifth brings is held to its SHA-256
 * as a first fetch's is; a fifth that fails stops it with nothing changed and
 * the advice to run the same tag again; and nothing else is fetched again:
 * not a file of another SHA-256, not one that is gone.
 */
function gooseRetryFaults(text: string): string[] {
  const plat = 'linux-x64';
  const base = treeOf('trigger.dev', plat);
  const { url, asset } = GOOSE.assets[plat];
  const host = new URL(url).hostname;
  const pinned = sha256(STAND_IN_GOOSE_NEW);
  // Other bytes that say the same version: only the SHA-256 can refuse them.
  const other = standInExecutable(`${GOOSE.said}${GOOSE.to}\n\n`);
  /** The same entries, in whatever order the directories were read. */
  const same = (a: Map<string, string>, b: Map<string, string>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
  const run = (first: ReadonlyArray<'unreachable' | number>, served: Buffer | null = STAND_IN_GOOSE_NEW) => {
    const registry = { ...base.registry };
    if (served) registry[url] = served;
    else delete registry[url];
    return withSandbox({ ...base, registry, firstAnswers: { [host]: first } }, (box) => {
      const before = snapshot(box);
      const r = build(text, box, { ...gooseOnly, plat });
      const after = snapshot(box);
      const fetched = fetchesOf(box).filter((u) => u === url).length;
      const slept = waitsOf(box).join(' ');
      return {
        ...r,
        fetched,
        slept,
        says: `exit ${r.status}, ${fetched === 1 ? '1 fetch' : `${fetched} fetches`}, slept ${slept || 'never'}`,
        unchanged: same(after, before),
        onlyGoose: same(without(after, GOOSE.path), without(before, GOOSE.path)),
        installed: readFileSync(join(box.fs, GOOSE.path)).equals(STAND_IN_GOOSE_NEW),
      };
    });
  };
  const faults: string[] = [];
  // Four in a row, of both kinds, waited out; the fifth's file goes in, and nothing else changes.
  const blip = run(['unreachable', 504, 503, 'unreachable']);
  if (!(blip.status === 0 && blip.installed && blip.onlyGoose && blip.fetched === 5 && blip.slept === '5 15 45 135')) {
    faults.push(`does not ride out four fetches that failed: ${blip.says}\n${blip.out}`);
  } else {
    for (const [n, wait] of [[1, 5], [2, 15], [3, 45], [4, 135]] as const) {
      if (!blip.out.includes(`${url} did not answer, or answered with an error (above), at fetch ${n} of 5; nothing was changed, and it is fetched again in ${wait} seconds.`)) {
        faults.push(`does not say that fetch ${n} of 5 failed, and how long it waits for the next\n${blip.out}`);
      }
    }
  }
  // A file of another SHA-256 after four that failed: refused as a first fetch's is, and never fetched again.
  const late = run([504, 504, 504, 504], other);
  if (late.status === 0 || late.installed || !late.unchanged) {
    faults.push(`goes on past a file of another SHA-256 that came after four fetches that failed: ${late.says}, the image ${late.unchanged ? 'unchanged' : 'changed'}\n${late.out}`);
  } else if (late.fetched > 5) {
    faults.push(`fetches a file of another SHA-256 again, after four fetches that failed: ${late.says}\n${late.out}`);
  } else if (late.fetched < 5) {
    faults.push(`stops before the fifth fetch, which brings a file of another SHA-256: ${late.says}\n${late.out}`);
  } else if (!late.out.includes(`${url} is ${sha256(other)}, not ${pinned}, goose ${GOOSE.to}'s ${asset} as its release published it; nothing was changed.`)) {
    faults.push(`does not refuse, by its SHA-256, a file that came after four fetches that failed: ${late.says}\n${late.out}`);
  }
  // Five in a row: stopped at the fifth, nothing changed, and the advice to run the same tag again, only that.
  const outage = run([504, 'unreachable', 504, 'unreachable', 504]);
  if (outage.status === 0 || outage.installed || !outage.unchanged) {
    faults.push(`goes on after five fetches that failed: ${outage.says}\n${outage.out}`);
  } else if (outage.fetched !== 5 || outage.slept !== '5 15 45 135') {
    faults.push(`does not stop at the fifth fetch that failed, 5, 15, 45 and 135 seconds after the others: ${outage.says}\n${outage.out}`);
  } else if (
    !outage.out.includes(`${url} did not answer, or answered with an error (above); nothing was changed, and upstream did not move. Run the bring-up, or deploy-live.sh, with the same tag again once it answers`) ||
    /re-read|drop the/.test(outage.out)
  ) {
    faults.push(`does not say, after the fifth fetch that failed, to run the same tag again, and only that\n${outage.out}`);
  }
  // Nothing else is fetched again: a file of another SHA-256 at the first fetch, a file that is gone.
  const wrong = run([], other);
  if (wrong.status === 0 || wrong.installed || !wrong.unchanged || wrong.fetched !== 1 || wrong.slept !== '') faults.push(`fetches a file of another SHA-256 again: ${wrong.says}\n${wrong.out}`);
  const gone = run([], null);
  if (gone.status === 0 || !gone.unchanged || gone.fetched !== 1 || gone.slept !== '' || !gone.out.includes(`${url} is gone (above)`)) faults.push(`fetches a file that is gone again: ${gone.says}\n${gone.out}`);
  return faults;
}

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
    // goose's own `before=` (until v4.8.5 the swap table's RUN had one that read the same).
    const at = webapp.indexOf('\n# Still as root: goose');
    expect(problems(webapp.slice(0, at) + moveLine(webapp.slice(at), /^ {4}before="\$\(state\)"; \\$/, /^ {4}chmod 0755 "\$tmp\/goose"; \\$/))).toEqual(["goose's RUN does not check, before it fetches, the image, read"]);
    expect(problems(webapp.replace(GOOSE.assets['linux-arm64'].sha256, '0'.repeat(64)))).toEqual(["goose's RUN does not pin linux-arm64's goose_linux_arm64 by efdb8f97176df746cf3970ed40810816a51927da0600b152ac4359ae2b7c0e12"]);
    expect(problems(dropLine(webapp, /^ {6}\*\) fail "this is \$plat; goose/))).toEqual(["goose's RUN does not refuse a platform it pins no asset for"]);
    expect(problems(webapp.replace('goose_from=v3.27.1;', 'goose_from=v3.27.3;'))).toEqual(["goose's RUN's goose_from= is v3.27.3, not v3.27.1"]);
    expect(problems(webapp.replace(/\n(# Still as root: goose)/, '\nUSER node\n$1'))).toEqual(["goose's RUN runs as node, not root"]);
    // The one fetch it made until 2026-11-09, and a loop that never waits (gooseRetryFaults runs the loop).
    const noRetry =
      "goose's RUN does not make a fetch that did not answer, or answered with an error, again: up to five fetches, 5, 15, 45 and 135 seconds apart, and every other exit out of the loop to the case that routes it";
    expect(problems(oneGooseFetch(webapp))).toEqual([noRetry]);
    expect(problems(dropLine(webapp, /^ {6}sleep "\$delay"; \\$/))).toEqual([noRetry, "goose's RUN does not tell a host that did not answer (exit 3, unreachable) or a file that is gone (exit 4, gone) from a move upstream"]);
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

  it('rides out four fetches GitHub does not answer, or answers with an error, 5, 15, 45 and 135 seconds apart, and fetches nothing else again (2026-11-09)', () => {
    expect(gooseRetryFaults(webapp)).toEqual([]);
  });

  /** The webapp's text with `from` (in goose's RUN alone, as each of these is) put as `to`. */
  const swapped = (from: string | RegExp, to: string) => (text: string) => {
    const out = typeof from === 'string' ? text.replace(from, () => to) : text.replace(from, to);
    expect(out, `${String(from)} matched nothing`).not.toBe(text);
    return out;
  };
  const slips: ReadonlyArray<[string, (text: string) => string, RegExp]> = [
    // The one fetch it made until 2026-11-09, and a loop of one.
    ['the one fetch it made until 2026-11-09', oneGooseFetch, /does not ride out four fetches that failed: exit 1, 1 fetch, slept never\n/],
    ['a loop of one fetch', swapped('for attempt in 1 2 3 4 5; do', 'for attempt in 1; do'), /does not ride out four fetches that failed: exit 1, 1 fetch, slept 5\n/],
    // The three the stalwart-cli and Trivy steps made until 2026-11-08 and 2026-11-09, four, and a give-up at the third.
    ['three fetches', swapped('for attempt in 1 2 3 4 5; do', 'for attempt in 1 2 3; do'), /does not ride out four fetches that failed: exit 1, 3 fetches, slept 5 15 45\n/],
    ['four fetches', swapped('for attempt in 1 2 3 4 5; do', 'for attempt in 1 2 3 4; do'), /does not ride out four fetches that failed: exit 1, 4 fetches, slept 5 15 45 135\n/],
    ['a give-up at the third', swapped('[ "$attempt" = 5 ]; then break; fi;', '[ "$attempt" = 3 ]; then break; fi;'), /does not ride out four fetches that failed: exit 1, 3 fetches, slept 5 15\n/],
    // No wait between fetches, and waits that grow by ten seconds, not three times.
    ['no wait between fetches', swapped(/\n {6}sleep "\$delay"; \\\n/, '\n'), /does not ride out four fetches that failed: exit 0, 5 fetches, slept never\n/],
    ['waits of 5, 15, 25 and 35 seconds', swapped('delay=$((delay * 3));', 'delay=$((delay + 10));'), /does not ride out four fetches that failed: exit 0, 5 fetches, slept 5 15 25 35\n/],
    ['a sixth fetch', swapped(/for attempt in 1 2 3 4 5; do([\s\S]*?)"\$attempt" = 5 \]/, 'for attempt in 1 2 3 4 5 6; do$1"$attempt" = 6 ]'), /goes on after five fetches that failed: exit 0, 6 fetches/],
    // A file that came after a fetch that failed, let through unhashed: the image changes before anything refuses it.
    [
      'a file that came after a failed fetch let through unhashed',
      swapped('[ "$got" = "$goose_sha256" ] || fail', '{ [ "$attempt" != 1 ] || [ "$got" = "$goose_sha256" ]; } || fail'),
      /goes on past a file of another SHA-256 that came after four fetches that failed: exit 1, 5 fetches, slept 5 15 45 135, the image changed\n/,
    ],
    // A file of another SHA-256, and one that is gone, fetched again as though the host had not answered.
    [
      'a file of another SHA-256 fetched again',
      swapped('if [ "$st" != 3 ] ||', `if [ "$st" = 0 ] && [ "$(sha256sum "$tmp/goose" | cut -d' ' -f1)" != "$goose_sha256" ]; then st=3; fi; if [ "$st" != 3 ] ||`),
      /fetches a file of another SHA-256 again: exit 1, 5 fetches, slept 5 15 45 135\n/,
    ],
    ['a file that is gone fetched again', swapped('if [ "$st" != 3 ] ||', 'if { [ "$st" != 3 ] && [ "$st" != 4 ]; } ||'), /fetches a file that is gone again: exit 1, 5 fetches, slept 5 15 45 135\n/],
  ];
  for (const [what, mutate, fault] of slips) {
    it(`fails, run over the stand-in, with ${what}`, () => {
      expect(gooseRetryFaults(mutate(webapp)).join('\n')).toMatch(fault);
    });
  }
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
        const run = build(webapp, box, { plat, tag: 'v4.8.5' });
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
        for (const p of STAYS) expect(db.packages[p]?.status, p).toBe('installed');
        expect(run.out).toMatch(/^[1-9]\d* ELF files read under /m);
        // The check of what is left read a dynamic section, and every one it met.
        expect(run.out).toMatch(/^[1-9]\d* ELF files read under \S+, [1-9]\d* of them needing a library, 0 whose dynamic section could not be read$/m);
        expect(run.out).toContain(`purged ${list}; dpkg's audit reads nothing, no file of ${libraries.join(' ')} is left and no ELF file needs or names one`);
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
    const without = webapp.replace(' libapt-pkg6.0 e2fsprogs libsystemd0 ', ' libapt-pkg6.0 libsystemd0 ');
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
    const own = libraries.map((so) => `/usr/lib/${TRIPLET[plat]}/${so}`);
    const reader = `${PNPM}/a-reader@1.0.0/node_modules/a-reader/index.js`;
    // Each library's own file goes with its package; a script that names one is not something that links it.
    withSandbox({ ...tree, executables: { ...tree.executables, ...Object.fromEntries(own.map((p, i) => [p, elf(libraries[i]!)])) }, files: { ...tree.files, [reader]: `// dlopen('${libraries.at(-1)}') is not this file's\n` } }, (box) => {
      const run = build(webapp, box, { plat });
      expect(run.status, run.out).toBe(0);
      for (const p of own) expect(run.left).not.toContain(p);
      expect(run.left).toContain(reader);
    });
    // An addon, or any ELF of no purged package, that needs only libc and names one of them where a dlopen would.
    const addons = Object.fromEntries(libraries.map((so, i) => [`${PNPM}/addon-${i}@1.0.0/node_modules/addon-${i}/build/Release/addon.node`, dynamicElf(['libc.so.6'], { text: so })]));
    withSandbox({ ...tree, executables: { ...tree.executables, ...addons } }, (box) => {
      const run = build(webapp, box, { plat });
      expect(run.status).not.toBe(0);
      // None needs one, so the check of what is left passes them, and the scan of what names one stops it.
      expect(run.out).not.toContain('a file of a library it removed is left');
      expect(run.out).toContain('after the purge, an ELF file names a library it removed');
      libraries.forEach((so, i) => expect(run.out).toContain(`${box.fs}${PNPM}/addon-${i}@1.0.0/node_modules/addon-${i}/build/Release/addon.node: ${so}`));
      // It stopped after the purge: what it found is left for whoever reads the log.
      expect(purged(box)).toHaveLength(1);
    });
  });

  it('an ELF file that needs a library the purge removed stops it, by path, whatever its class and byte order', () => {
    const plat = 'linux-x64';
    const tree = treeOf('trigger.dev', plat);
    const needing = {
      [`${PNPM}/usb@2.14.0/node_modules/usb/prebuilds/linux-x64/node.napi.node`]: dynamicElf(['libc.so.6', 'libudev.so.1']),
      '/opt/vendor/bin/agent': dynamicElf(['libsystemd.so.0', 'libc.so.6'], { bits: 32, endian: 'be' }),
      '/opt/vendor/lib/libprobe.so': dynamicElf(['libuuid.so.1'], { bits: 32 }),
      '/opt/vendor/lib/libprobe64be.so': dynamicElf(['libudev.so.1'], { endian: 'be' }),
    };
    withSandbox({ ...tree, executables: { ...tree.executables, ...needing } }, (box) => {
      const run = build(webapp, box, { plat });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('after the purge, a file of a library it removed is left, or an ELF file needs one (DT_NEEDED), or the check read no ELF file that needs a library at all (node exits 1)');
      expect(run.out).toContain(`${box.fs}${PNPM}/usb@2.14.0/node_modules/usb/prebuilds/linux-x64/node.napi.node: needs libudev.so.1`);
      expect(run.out).toContain(`${box.fs}/opt/vendor/bin/agent: needs libsystemd.so.0`);
      expect(run.out).toContain(`${box.fs}/opt/vendor/lib/libprobe.so: needs libuuid.so.1`);
      expect(run.out).toContain(`${box.fs}/opt/vendor/lib/libprobe64be.so: needs libudev.so.1`);
      // What it needs and nothing else: libc is no library the purge removed.
      expect(run.out).not.toContain('needs libc.so.6');
      // It stopped there, before the scan of what names one.
      expect(run.out).not.toContain('an ELF file names a library it removed');
      expect(purged(box)).toHaveLength(1);
    });
  });

  it('a file of a removed library left where no package of the list had it stops it: a copy, or a link by its name', () => {
    const plat = 'linux-arm64';
    const tree = treeOf('trigger.dev', plat);
    withSandbox(
      {
        ...tree,
        files: { ...tree.files, '/opt/vendor/lib/libudev.so.1.7.5': 'a copy, whatever its bytes\n' },
        links: [...(tree.links ?? []), { path: '/usr/local/lib/libsystemd.so.0', target: 'libsystemd.so.0.35.0' }],
      },
      (box) => {
        const run = build(webapp, box, { plat });
        expect(run.status).not.toBe(0);
        expect(run.out).toContain(`${box.fs}/opt/vendor/lib/libudev.so.1.7.5: a file of libudev.so.1 is left`);
        expect(run.out).toContain(`${box.fs}/usr/local/lib/libsystemd.so.0: a file of libsystemd.so.0 is left`);
        expect(run.left).toContain('/usr/local/lib/libsystemd.so.0');
      },
    );
  });

  it('an ELF file whose dynamic section cannot be read counts as needing a library it names, and one that names none passes', () => {
    const plat = 'linux-arm64';
    const tree = treeOf('trigger.dev', plat);
    // The stand-in binaries the earlier RUNs remove are ELF by their magic alone; one left that names no removed library passes.
    withSandbox({ ...tree, executables: { ...tree.executables, '/opt/vendor/bin/stub': elf('libssl.so.3') } }, (box) => {
      const run = build(webapp, box, { plat });
      expect(run.status, run.out).toBe(0);
      expect(run.out).toMatch(/^[1-9]\d* ELF files read under \S+, [1-9]\d* of them needing a library, 1 whose dynamic section could not be read$/m);
    });
    withSandbox({ ...tree, executables: { ...tree.executables, '/opt/vendor/bin/stub': elf('libudev.so.1') } }, (box) => {
      const run = build(webapp, box, { plat });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`${box.fs}/opt/vendor/bin/stub: names libudev.so.1, and its dynamic section cannot be read`);
    });
  });

  it('a check that met no ELF file needing a library stops it: a reader that reads nothing is no proof', () => {
    const plat = 'linux-x64';
    const tree = treeOf('trigger.dev', plat);
    const staticOnly = Object.fromEntries(Object.entries(tree.executables ?? {}).filter(([path]) => path !== '/usr/bin/openssl'));
    withSandbox({ ...tree, executables: staticOnly }, (box) => {
      const run = build(webapp, box, { plat });
      expect(run.status).not.toBe(0);
      expect(run.out).toMatch(/^[1-9]\d* ELF files read under \S+, 0 of them needing a library, 0 whose dynamic section could not be read$/m);
      expect(run.out).toContain('or the check read no ELF file that needs a library at all (node exits 2)');
    });
  });

  it('a package that stays and depends on libsystemd0 stops it at dpkg\'s refusal: no flag leaves that dependency dangling', () => {
    // A package that needs libsystemd0, as procps does on Ubuntu 24.04: a base that brings one stops here.
    const procps: DpkgPackage = { version: '1', status: 'installed', depends: ['libsystemd0'] };
    withSandbox(changed('linux-arm64', (db) => ({ ...db, packages: { ...db.packages, procps } })), (box) => {
      const run = build(webapp, box, { plat: 'linux-arm64' });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('procps depends on libsystemd0.');
      expect(run.out).toContain('dependency problems - not removing');
      expect(run.out).toContain('Without --force-depends it refuses to remove what an installed package depends on');
      const { db } = dpkgOf(box);
      for (const p of ['procps', 'libsystemd0']) expect(db.packages[p]?.status, p).toBe('installed');
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

/**
 * Trigger.dev's Redis (deploy/compose/redis/Dockerfile, 2026-11-07, for
 * alpha.6): its one RUN as root purges the webapp's eleven in the same shape,
 * thirteen since 2026-11-08, and checks with perl, since that image has no
 * node. Its tree here is the stand-in's Debian 12 read from its own RUN,
 * Redis's two binaries as ELF stand-ins that need what Redis's binaries need
 * (libm, libssl, libcrypto and libc, read with `readelf -d` on 2026-11-08),
 * and redis-server and redis-cli as scripts that answer --version, which the
 * RUN starts after the purge. The RUN after USER 999:999 is the image's
 * user's, which this machine is not: E2E (managed) and images.yml run it.
 */
const REDIS_DOCKERFILE = 'deploy/compose/redis/Dockerfile';
const redisDockerfile = read(REDIS_DOCKERFILE);
const asRoot = (run: Instruction) => run.user === 'root';
/** A stand-in ELF that carries `text`, as a binary carries the name of a library it links or opens. */
const elfWith = (text: string) => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.from(`stand-in\0${text}\0`)]);
/** A program that answers --version, and logs that it was asked. */
const versioned = (name: string) => `#!/bin/sh\nprintf '%s %s\\n' ${name} "$*" >> "$TOOL_LOG"\necho "${name} stand-in"\n`;

/** What Redis's three binaries need (`readelf -d`, both platforms, 2026-11-08). */
const REDIS_NEEDS = ['libm.so.6', 'libssl.so.3', 'libcrypto.so.3', 'libc.so.6'];
function redisTree(plat: string): Tree {
  return {
    files: {},
    binaries: [],
    executables: { '/usr/local/bin/redis-server': dynamicElf(REDIS_NEEDS), '/usr/local/bin/redis-cli': dynamicElf(REDIS_NEEDS) },
    tools: { 'redis-server': versioned('redis-server'), 'redis-cli': versioned('redis-cli') },
    dpkg: debian12(plat, redisDockerfile),
  };
}

describe("Redis's RUN as root purges the webapp's thirteen over the stand-in, and dpkg's own refusals stop it (0119 §3 item 11, 2026-11-07; thirteen since 2026-11-08)", () => {
  const { packages, libraries } = purgeLists(redisDockerfile);
  const list = packages.join(' ');
  const purged = (box: Sandbox) => dpkgOf(box).calls.filter((c) => c.startsWith('dpkg --purge'));

  it("reads the webapp's two lists from its RUN (vacuity)", () => {
    expect(purgeRuns(redisDockerfile)).toHaveLength(1);
    expect(purgeLists(redisDockerfile)).toEqual(purgeLists(dockerfiles['trigger.dev']));
  });

  for (const plat of PLATFORMS) {
    it(`on ${plat}: dpkg-query of the list first, then the audit, the libraries, the purge with the two flags and no other, the audit again, each package read gone, the scan and the starts`, () => {
      withSandbox(redisTree(plat), (box) => {
        const run = build(redisDockerfile, box, { plat, pick: asRoot });
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
        for (const p of STAYS) expect(db.packages[p]?.status, p).toBe('installed');
        expect(run.out).toMatch(/^2 ELF files read under \S+, 2 of them needing a library, 0 whose dynamic section could not be read$/m);
        expect(run.out).toMatch(/^2 ELF files read under \S+$/m);
        expect(run.out).toContain(`purged ${list}; dpkg's audit reads nothing, no file of ${libraries.join(' ')} is left and no ELF file needs or names one, and sh, id, find, redis-server and redis-cli start.`);
        const tools = readFileSync(join(box.root, 'tools.log'), 'utf8');
        expect(tools).toContain('redis-server --version\n');
        expect(tools).toContain('redis-cli --version\n');
      });
    });
  }

  it('e2fsprogs off the list stops it, as it stopped the webapp\'s first build on the real base: dpkg refuses libblkid1 and libuuid1 for it', () => {
    const without = redisDockerfile.replace(' libapt-pkg6.0 e2fsprogs libsystemd0 ', ' libapt-pkg6.0 libsystemd0 ');
    expect(without).not.toBe(redisDockerfile);
    withSandbox(redisTree('linux-arm64'), (box) => {
      const run = build(without, box, { plat: 'linux-arm64', pick: asRoot });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('e2fsprogs depends on libuuid1.');
      expect(run.out).toContain('dependency problems - not removing');
      for (const p of ['e2fsprogs', 'libuuid1', 'libblkid1']) expect(dpkgOf(box).db.packages[p]?.status, p).toBe('installed');
    });
  });

  it('a package the base does not have stops it before anything is purged', () => {
    const tree = redisTree('linux-x64');
    const db = { ...tree.dpkg!, packages: Object.fromEntries(Object.entries(tree.dpkg!.packages).filter(([n]) => n !== 'libuuid1')) };
    withSandbox({ ...tree, dpkg: db }, (box) => {
      const run = build(redisDockerfile, box, { plat: 'linux-x64', pick: asRoot });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('a list to read again, not a name to skip; nothing was purged');
      expect(purged(box)).toEqual([]);
    });
  });

  it('an ELF file left after the purge that names one of its libraries stops it, by path, and a check that reads no ELF at all stops it too', () => {
    const tree = redisTree('linux-arm64');
    // A module that needs libc alone and opens one by its name.
    withSandbox({ ...tree, executables: { ...tree.executables, '/usr/local/lib/redis/modules/probe.so': dynamicElf(['libc.so.6'], { text: libraries[0]! }) } }, (box) => {
      const run = build(redisDockerfile, box, { plat: 'linux-arm64', pick: asRoot });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('after the purge, an ELF file names a library it removed');
      expect(run.out).toContain(`${box.fs}/usr/local/lib/redis/modules/probe.so: ${libraries[0]}`);
      expect(purged(box)).toHaveLength(1);
    });
    withSandbox({ ...tree, executables: {} }, (box) => {
      const run = build(redisDockerfile, box, { plat: 'linux-arm64', pick: asRoot });
      expect(run.status).not.toBe(0);
      expect(run.out).toMatch(/^0 ELF files read under \S+, 0 of them needing a library, 0 whose dynamic section could not be read$/m);
      expect(run.out).toContain('or the check read no ELF file that needs a library at all (perl exits 2)');
    });
  });

  it('an ELF file that needs libsystemd.so.0 or libudev.so.1, or a file of either left, stops it, by path, whatever the class and byte order', () => {
    const tree = redisTree('linux-x64');
    const needing = {
      '/usr/local/lib/redis/modules/sd.so': dynamicElf(['libsystemd.so.0', 'libc.so.6']),
      '/usr/local/lib/redis/modules/udev32be.so': dynamicElf(['libudev.so.1'], { bits: 32, endian: 'be' }),
    };
    withSandbox({ ...tree, executables: { ...tree.executables, ...needing }, links: [{ path: '/usr/local/lib/libudev.so.1', target: 'libudev.so.1.7.5' }] }, (box) => {
      const run = build(redisDockerfile, box, { plat: 'linux-x64', pick: asRoot });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('after the purge, a file of a library it removed is left, or an ELF file needs one (DT_NEEDED), or the check read no ELF file that needs a library at all (perl exits 1)');
      expect(run.out).toContain(`${box.fs}/usr/local/lib/redis/modules/sd.so: needs libsystemd.so.0`);
      expect(run.out).toContain(`${box.fs}/usr/local/lib/redis/modules/udev32be.so: needs libudev.so.1`);
      // A link dpkg did not list, by the name of a library the purge removed.
      expect(run.out).toContain(`${box.fs}/usr/local/lib/libudev.so.1: a file of libudev.so.1 is left`);
      expect(run.out).not.toContain('an ELF file names a library it removed');
    });
    // The two libraries' own files, where libsystemd0 and libudev1 have them, go with their packages.
    const own = ['libsystemd.so.0', 'libudev.so.1'].map((so) => `/usr/lib/x86_64-linux-gnu/${so}`);
    withSandbox({ ...tree, executables: { ...tree.executables, ...Object.fromEntries(own.map((p) => [p, elfWith(p)])) } }, (box) => {
      const run = build(redisDockerfile, box, { plat: 'linux-x64', pick: asRoot });
      expect(run.status, run.out).toBe(0);
      for (const p of own) expect(run.left).not.toContain(p);
    });
  });

  it('a package that stays and depends on libudev1 stops it at dpkg\'s refusal, and the check reads an ELF file it cannot parse by its bytes', () => {
    const tree = redisTree('linux-arm64');
    const keeper: DpkgPackage = { version: '1', status: 'installed', depends: ['libudev1'] };
    withSandbox({ ...tree, dpkg: { ...tree.dpkg!, packages: { ...tree.dpkg!.packages, 'a-udev-user': keeper } } }, (box) => {
      const run = build(redisDockerfile, box, { plat: 'linux-arm64', pick: asRoot });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('a-udev-user depends on libudev1.');
      expect(run.out).toContain('dependency problems - not removing');
      for (const p of ['a-udev-user', 'libudev1']) expect(dpkgOf(box).db.packages[p]?.status, p).toBe('installed');
    });
    withSandbox({ ...tree, executables: { ...tree.executables, '/usr/local/lib/redis/modules/stub.so': elfWith('libsystemd.so.0') } }, (box) => {
      const run = build(redisDockerfile, box, { plat: 'linux-arm64', pick: asRoot });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain(`${box.fs}/usr/local/lib/redis/modules/stub.so: names libsystemd.so.0, and its dynamic section cannot be read`);
    });
  });

  it('a program this stack runs here that does not start after the purge stops it, by name', () => {
    const broken = '#!/bin/sh\necho "redis-server: error while loading shared libraries: libuuid.so.1: cannot open shared object file" >&2\nexit 127\n';
    const tree = redisTree('linux-x64');
    withSandbox({ ...tree, tools: { ...tree.tools, 'redis-server': broken } }, (box) => {
      const run = build(redisDockerfile, box, { plat: 'linux-x64', pick: asRoot });
      expect(run.status).not.toBe(0);
      expect(run.out).toContain('redis-server, which this stack runs here, does not start after the purge.');
    });
  });
});

describe("a fetch that fails tells a host that did not answer from a move upstream, in goose's RUN, since v4.8.5 the one replacing RUN", () => {
  const webapp = dockerfiles['trigger.dev'];
  const fetching: ReadonlyArray<[string, Name, { pick: (run: Instruction) => boolean }, string, (plat: Plat) => string]> = [
    ["goose's RUN", 'trigger.dev', gooseOnly, 'github.com', (plat) => GOOSE.assets[plat].url],
  ];

  it('each routes a host that does not answer, or answers with an error, to "run the same tag again", and a file that is gone to its own message', () => {
    for (const name of NAMES) expect(gooseProblems(name, dockerfiles[name]), name).toEqual([]);
    // A RUN whose fetch fails into fail(), with its advice to drop the replacement.
    const gooseAt = webapp.indexOf('\n# Still as root: goose');
    expect(gooseAt).toBeGreaterThan(0);
    const inPart = (from: number, to: number, fn: (part: string) => string) => webapp.slice(0, from) + fn(webapp.slice(from, to)) + webapp.slice(to);
    expect(gooseProblems('trigger.dev', inPart(gooseAt, webapp.length, (part) => part.replace('3) unreachable "$url" ;; 4) gone "$url" ;; ', '')))).toEqual([
      "goose's RUN does not tell a host that did not answer (exit 3, unreachable) or a file that is gone (exit 4, gone) from a move upstream",
    ]);
    // An unreachable() that gives fail()'s advice, or none of its own.
    expect(gooseProblems('trigger.dev', inPart(gooseAt, webapp.length, (part) => part.replace('Run the bring-up, or deploy-live.sh, with the same tag again once it answers', 'Drop the replacement')))).toEqual([
      "goose's RUN's unreachable() does not say to run the same tag again, on its own, without fail()'s advice",
    ]);
    // A gone() that gives fail()'s advice, or none of its own.
    expect(gooseProblems('trigger.dev', dropLine(webapp, /^ {4}gone\(\) \{/))).toEqual([
      "goose's RUN's gone() does not say the file is gone and where the way on is, on its own, without fail()'s advice",
    ]);
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
      expect.stringContaining('deploy/compose/supervisor/Dockerfile builds on v4.9.0, and deploy/compose/managed.yml pins v4.8.5'),
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
      expect.stringContaining('trigger-supervisor runs ghcr.io/triggerdotdev/supervisor:${TRIGGER_IMAGE_TAG:-v4.8.5}, not localhost/supervisor:'),
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
      // The removing RUN and the node RUN, goose's, and the webapp's purge (until v4.8.5 also dompurify's RUN and a swap table's).
      expect(runs(dockerfiles[name]).length, name).toBe(2 + binaryRows(name).length + PURGES[name]);
      expect(purgeRuns(dockerfiles[name]).length, name).toBe(PURGES[name]);
      expect(gooseRuns(dockerfiles[name]).length, name).toBe(binaryRows(name).length);
      // No RUN swaps a package any more: none names a tarball's integrity, and none holds a table of rows.
      expect(runs(dockerfiles[name]).filter((r) => /(^|[;\s])(integrity=|rows\(\) \{)/.test(r.args)), name).toEqual([]);
      expect(parseRef(dockerfileBase(dockerfiles[name]).ref).digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});
