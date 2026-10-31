# Trigger.dev's webapp as upstream publishes it, by tag and index digest, with
# files deleted that no process of this stack ever runs, and one package's
# files replaced by the release that fixes it (workplan 0146 T16; the owner's
# decisions of 2026-10-26, "Both": an issue upstream, and this build until
# upstream ships the fixes, and of 2026-10-27: tar out of the copy of pnpm that
# runs, too). Since 2026-10-31, npm and the rest of node-gyp's tree in that
# copy go as well, under the one risk the owner accepted for tar (THE HIGHS
# NOTHING RUNS, below).
#
# WHY. Trivy 0.76.1 read 8 critical findings in
# ghcr.io/triggerdotdev/trigger.dev:v4.8.1 (linux/arm64, 2026-10-26). Six are
# in files nothing here runs:
#   - @depot/cli 0.0.1-cli.2.80.0's Go binary, `depot`: CVE-2024-41110 (docker
#     v24.0.9), CVE-2026-33186 (grpc v1.59.0) and CVE-2025-68121 (Go 1.21.13's
#     standard library);
#   - esbuild 0.23.0's Go binary: CVE-2025-68121 (Go 1.22.4);
#   - tar 7.5.13 (CVE-2026-59873) in the copy of pnpm 10.33.2 that corepack
#     keeps for the user node, which goes whole;
#   - the same tar in root's copy of pnpm, the one every pnpm of the
#     entrypoint runs here (below), which stays without it.
# Two were left after those: zlib1g (CVE-2023-45853, no fix in Debian), which
# stays, and dompurify 3.4.13 (GHSA-cg2g-xh64-v4q7, fixed in 3.4.17), whose
# files the last RUN as root replaces with 3.4.17's (WHAT IS REPLACED, below).
# So 8 become 1. The binaries are the same Go builds on amd64.
#
# THE HIGHS NOTHING RUNS. The image scan of the image built here, run
# 41130684117 (Trivy 0.76.1, linux/arm64, 2026-10-30), read 1 critical and 137
# high findings, 81 of them with a fix. Twelve of the 81 are in two trees no
# process of this stack runs, and they go too (WHAT GOES, the last two):
#   - npm 11.19.1, which Node 24.22.1 bundles, under
#     /usr/local/lib/node_modules/npm: brace-expansion 5.0.9 (CVE-2026-102276,
#     CVE-2026-102278) and undici 6.28.0 (CVE-2026-19534, CVE-2026-109383,
#     CVE-2026-109869, CVE-2026-87018). The same six are in
#     node:24.22.1-bookworm-slim, the FROM of upstream's runner stage, and in
#     node:24.22.1-alpine, the supervisor's.
#   - node-gyp's tree in root's copy of pnpm,
#     /root/.cache/node/corepack/v1/pnpm/10.33.2/dist/node_modules:
#     brace-expansion 2.1.0 (CVE-2026-102276, CVE-2026-102278, CVE-2026-13149,
#     CVE-2026-14257, CVE-2026-69152) and ip-address 10.1.0 (CVE-2026-69192).
# Each was read in its own part with the same Trivy (the two Node images by
# digest, and pnpm 10.33.2 as npm published it, tar taken out). So 137 become
# about 125, and 81 about 69. What stays is code that runs: pnpm 10.33.2 itself
# (11 highs), goose, the webapp's node_modules and the OS packages.
#
# WHAT GOES, AND WHY NOTHING RUNS IT. Read in upstream's source at v4.8.1 and in
# the published packages, whose sha512 is the one pnpm-lock.yaml names:
#   - @depot/cli's binary. Loading @depot/cli (lib/main.js) defines functions
#     and reads DEPOT_BINARY_PATH as a string; the binary is looked up only
#     inside depot(...), through depotBinaryPath() and generateBinPath(). The
#     webapp loads the package when it starts: the two finalize routes import
#     app/v3/services/finalizeDeploymentV2.server.ts, which imports it. Its one
#     call is a `depot push`, reached only when DEPOT_TOKEN and DEPOT_ORG_ID
#     are set (remoteBuildsEnabled() in remoteImageBuilder.server.ts;
#     DEPOT_REGION defaults to us-east-1). trigger-api sets neither, and
#     scripts/a-service-that-phones-home.unit.test.ts refuses DEPOT_TOKEN.
#     Called anyway, it would throw a JavaScript error into that one request
#     and start nothing.
#   - esbuild 0.23.0's binary. Loading esbuild starts nothing; the binary is
#     found and spawned at the first build, transform or context call
#     (ensureServiceIsRunning() in lib/main.js). Nothing in the image makes
#     one. It is installed only because packages/cli-v3, the `trigger.dev`
#     CLI, depends on it, and cli-v3 enters the webapp's pruned workspace
#     through internal-packages/dashboard-agent's devDependency
#     `"trigger.dev": "workspace:*"`; `pnpm install --prod` over that workspace
#     installs the CLI's dependencies. server.js imports neither the CLI nor
#     esbuild, and the entrypoint runs prisma, node scripts, goose and
#     build/server.js. (tsdown and tsx are not in the production install.)
#   - node's copy of pnpm, /home/node/.cache/node/corepack/v1/pnpm/10.33.2.
#     managed.yml runs trigger-api as root (`user: root`, for its chown of the
#     shared volume) and sets no HOME, so HOME is /root, and corepack runs
#     root's copy for every pnpm in docker/scripts/entrypoint.sh: the
#     migrations of @trigger.dev/database, the run-ops databases and the
#     dashboard agent. Nothing execs into trigger-api as node. Corepack 0.36.0
#     (Node 24.22.1's) finds the copy under $HOME/.cache/node/corepack
#     (getCorepackHomeFolder) and reuses it by its .corepack file alone
#     (installVersion), never fetching it again while that file is there.
#   - tar inside root's copy, the one that runs:
#     /root/.cache/node/corepack/v1/pnpm/10.33.2/dist/node_modules/tar. Asked
#     with the risk stated, the owner chose on 2026-10-27 to remove it too.
#     In pnpm 10.33.2's dist the one require('tar') is the bundled node-gyp's
#     lib/install.js, which downloads and unpacks Node's headers for a native
#     build; pnpm.cjs and worker.js name no tar (they bundle tar-stream).
#     node-gyp runs only when a package script calls it (pnpm puts
#     dist/node-gyp-bin on a script's PATH, and resolves node-gyp's path in a
#     try) or an install builds a native add-on. The entrypoint's pnpm runs
#     three migration scripts (`prisma migrate deploy`, `node
#     scripts/migrate.mjs deploy`, `node migrate.mjs`) and installs nothing.
#     Corepack checks no file of the copy but .corepack, so it runs the copy
#     as it is, never fetching it again. The one risk, accepted: a `pnpm
#     install` inside this container that builds a native add-on would fail.
#     Since 2026-10-31 tar goes with the rest of dist/node_modules (next).
#   - node-gyp's tree inside root's copy: all of
#     /root/.cache/node/corepack/v1/pnpm/10.33.2/dist/node_modules, which is
#     node-gyp 11.5.0 and the packages it brings, installed flat (tar was one),
#     and dist/node-gyp-bin, the shim that runs it. pnpm.cjs and worker.js
#     bundle every package pnpm itself runs. What a file of the copy outside
#     dist/node_modules names of it is three things, each in a try: pnpm.cjs
#     resolves node-gyp/bin/node-gyp when it loads, only to hand a package
#     script that path as npm_config_node_gyp; the fdir it bundles resolves
#     picomatch, used only by a glob() that nothing in pnpm calls (tinyglobby
#     crawls with filters); and bin/pnpm.cjs requires v8-compile-cache only
#     when module.enableCompileCache() answers nothing, which Node 24's never
#     does, and from bin/, where no node_modules is. Without them a package
#     script runs as before, with no npm_config_node_gyp and a node-gyp-bin on
#     its PATH that is not there. Read by running pnpm 10.33.2's own files
#     with both directories removed: `pnpm run` and `pnpm exec` work, and a
#     script that calls node-gyp says `node-gyp: not found`. That is tar's
#     risk again, and the only one: a script that calls node-gyp, or an
#     install that builds a native add-on. The entrypoint's pnpm runs three
#     migration scripts that call neither. The build checks that those three
#     are all any file of the copy outside dist/node_modules names of it,
#     before it removes anything.
#   - npm 11.19.1, which Node 24.22.1 bundles: /usr/local/lib/node_modules/npm,
#     and Node's two links to it, /usr/local/bin/npm and /usr/local/bin/npx. No
#     process of this stack runs either. The entrypoint runs pnpm, goose, node
#     and its own scripts; the migrations are `prisma migrate deploy` and `node
#     scripts/migrate.mjs` (which spawns prisma) and `node migrate.mjs`
#     (drizzle, in process); the healthcheck is `node -e` fetch; the bring-up
#     execs `test` and `chown` into trigger-api, nothing else does; and in the
#     source the webapp runs, only the dashboard agent's repo tools spawn
#     anything (tar and rg). pnpm looks for npm once: @pnpm/npm-conf resolves it, in a try,
#     from Node's global folder, to read npm's builtin npmrc, which Node's npm
#     does not carry (the build checks); without npm it reads none, as before,
#     and only `pnpm doctor` says so. Corepack 0.36.0, whose shim runs every
#     pnpm here, is its own directory beside npm's and stays. The build checks
#     that the two links are Node's and the only ones into npm's directory,
#     and proves corepack and pnpm after.
#     The build proves as root, after every removal, that pnpm 10.33.2 starts
#     offline and runs a command in @trigger.dev/database's package, as the
#     migrations do. That command is a `pnpm exec`, which does not pass through
#     pnpm's lifecycle code; the migrations are package scripts, which do, and
#     E2E (managed) runs them.
#
# WHAT IS REPLACED: DOMPURIFY 3.4.13'S FILES BY 3.4.17'S. Trivy 0.76.1 reads
# GHSA-cg2g-xh64-v4q7 (critical: with SAFE_FOR_TEMPLATES, template expressions
# split across nodes survive in an attached shadow root's content, in the DOM
# output modes) and GHSA-mrv2-3pqr-j5jr (high) in
# node_modules/.pnpm/dompurify@3.4.13/node_modules/dompurify. 3.4.17 fixes
# both; npm published it 2026-10-12 12:41 UTC and lists no advisory against
# it. Two packages require dompurify (upstream's pnpm-lock.yaml at read_at):
#   - posthog-js 1.407.3, which the webapp imports (app/hooks/usePostHog.ts).
#     Its entry points, dist/main.js and dist/module.js, carry no DOMPurify. Its
#     one require('dompurify') is in lib/src/extensions/product-tours, which no
#     entry point loads: the browser takes product tours from PostHog's own
#     host, and only once PostHog starts, which managed.yml's
#     POSTHOG_PROJECT_KEY: "" stops (a-service-that-phones-home holds it). Its
#     dist/product-tours.js bundles DOMPurify 3.3.2 into its own file, which
#     Trivy does not read and nothing here serves.
#   - mermaid 11.16.1, through streamdown 2.5.0 (the dashboard's markdown).
#     streamdown 2.5.0 imports no mermaid: it draws a diagram only through the
#     @streamdown/mermaid plugin, which the webapp neither installs nor passes.
# So no process of this stack loads dompurify, and the replacement changes no
# code that runs. It makes the one copy the scan reads, and any later load,
# the release that fixes it. The build checks the half it can see: no file
# under apps/webapp/build or apps/webapp/public carries DOMPurify (its
# trusted-types attribute, data-tt-policy-suffix, which every copy carries) or
# imports dompurify or mermaid by name. Between the two published tarballs,
# 3.4.13 to 3.4.17 changes no API either caller uses. The 24 file names are
# the same. The entry points and exports are unchanged (main, module, browser,
# types and exports), and require() of either CJS build gives the same keys.
# package.json differs only in the version, its scripts and its
# devDependencies (rollup became rolldown). The type declarations differ in the
# order of one import, and the CJS ones drop `export { _default as default }`
# and keep `export = _default`. The code changes are in src/purify.ts's
# sanitising internals (the fixes), the helpers src/utils.ts adds for them, and
# src/attrs.ts, which allows two more SVG attributes, pointer-events and
# vector-effect.
#
# HOW IT IS REPLACED, AND PROVED. The last RUN as root fetches
# dompurify-3.4.17.tgz from the npm registry, as the API image's build fetches
# its packages, and refuses it unless its sha512 is the integrity npm
# published. Before it changes anything it checks: the directory is the
# published 3.4.13, file for file (from_tree: the SHA-256 of the sorted list
# of each file's SHA-256 and path); the only links to it are posthog-js's,
# mermaid's and pnpm's hoisted one; no other dompurify/package.json is in the
# image; and the webapp's build, as above. It unpacks the tarball apart, checks
# it is the published 3.4.17 (to_tree), gives it the old directory's owner,
# and puts it in the old one's place. Then it proves the directory is to_tree;
# that no other path in the image was added or removed, and no other file
# changed, since a marker it made before the fetch; and that from posthog-js's
# and mermaid's own directories, require('dompurify') and import('dompurify')
# both load 3.4.17 from it. The directory keeps pnpm's name, dompurify@3.4.13,
# and pnpm's records (pnpm-lock.yaml, node_modules/.pnpm/lock.yaml) keep
# 3.4.13: nothing here installs, and Trivy reads package.json in an image.
#
# TWO NAMES FOR EACH BINARY. The postinstall of each package (install.js,
# maybeOptimizePackage) hard-links its platform package's binary over its own
# bin/ shim, so the one file has a second name:
# @depot+cli@…/node_modules/@depot/cli/bin/depot and
# esbuild@…/node_modules/esbuild/bin/esbuild. The image's layer stores the
# second name as a tar hard link, which Trivy 0.76.1 skips
# (pkg/fanal/walker/tar.go), so it reports one path for each. A scan that reads
# 0 for them is therefore no proof that the binary is gone. Both names go, each
# must start with ELF's magic before it is removed, and the link count of each
# is printed in the build's log.
#
# THE USER COUPLING. Which copy of pnpm runs follows managed.yml's `user:` for
# trigger-api. It is root, so this removes node's copy and proves root's starts
# offline. A trigger-api without `user: root` would run node's copy, which is
# gone; managed.yml sets COREPACK_ENABLE_NETWORK: "0" on it, so corepack then
# refuses to start pnpm rather than fetch it, and an unscanned tar with it,
# from the npm registry at every start. The last RUN proves that refusal as
# node. scripts/a-binary-the-stack-never-runs.unit.test.ts fails when the
# `user:` and this file disagree, and says to move the removal. Upstream
# decides the rest of it: the entrypoint runs every pnpm as the container's
# user, and an entrypoint that dropped to node would run the copy that is gone.
# So the entrypoint read at read_at is pinned by its SHA-256 below, and
# images.yml's `build (trigger, …)` checks the base's user, command and
# entrypoint are the ones read (node, ./scripts/entrypoint.sh, Node's
# docker-entrypoint.sh, which drops no user).
#
# READ AT ONE RELEASE. Why each removal is safe was read in upstream's source at
# read_at (below): the depot gate, what build/server.js imports, the entrypoint
# and the copies of pnpm. A release that keeps @depot/cli 0.0.1-cli.2.80.0 and
# esbuild 0.23.0 at the same paths (4.7.6, 4.8.0 and 4.8.1 all do) would pass
# every path check here while code this stack reaches started to run one of
# them. So the build refuses any other version than read_at, and
# `trigger-version.sh pin` leaves read_at where it is: a version move's pull
# request is red (here, in `build (trigger, …)` and in E2E (managed)) until
# someone reads the reasons again at the new release and moves read_at, and
# entrypoint_sha256 with it when the entrypoint changed.
#
# IT FAILS LOUDLY WHEN UPSTREAM MOVES. Every path names a version. The build
# refuses unless the image's @trigger.dev/core is the TRIGGER_IMAGE_TAG it is
# given (when the .env sets one) and read_at, its entrypoint is the one read,
# its packageManager is pnpm@10.33.2, and it runs on linux-arm64 or linux-x64;
# npm's and corepack's directories name no version, so their package.json must
# say 11.19.1 and 0.36.0, Node 24.22.1's. Each file is tested before a plain
# `rm`, never `rm -f`, and checked gone after. A Trigger.dev that moves
# @depot/cli, esbuild, pnpm or Node, or drops one, fails here and names the
# path: re-read this header against it, and drop the removal upstream fixed. A pull request that touches deploy/ runs this on both
# platforms (images.yml, `build (trigger, amd64|arm64)`); the weekly image scan
# builds it on arm64 and counts what is left.
#
# THE BASE AND THE NAME. The FROM is the pin, by tag and index digest, as in
# deploy/compose/postgres/Dockerfile. managed.yml builds this as
# `localhost/trigger.dev:${TRIGGER_IMAGE_TAG:-<pin>}-<12 hex>`: the version the
# .env names (or the pin), and the SHA-256 of this file's instruction lines,
# comments and blank lines left out,
#   grep -Ev '^[[:space:]]*(#|$)' deploy/compose/trigger.dev/Dockerfile | sha256sum | cut -c1-12
# so a changed instruction is a name the machine does not have yet, and compose
# builds it. TRIGGER_IMAGE_TAG reaches the build as an argument only to refuse a
# .env that names another version than this file builds; it changes nothing that
# is built. The .env names the version, and it must be this checkout's: to run
# another, run the checkout that pins it. `trigger-version.sh pin` moves the
# FROM, its digest and the name with the version (and leaves read_at, above).
# Nothing builds it again while the machine has the name (managed.yml's header).
# No parser directive, COPY, ADD, --mount, ENV, CMD, ENTRYPOINT, WORKDIR or
# LABEL: the hash covers all that is built, and the image's configuration stays
# upstream's.
#
# THE WAY OUT. The owner filed the issue that asks upstream for these fixes,
# triggerdotdev/trigger.dev#5084 (workplan 0146 T16). Upstream's fix for
# dompurify is the override in its root package.json, `"dompurify@>=3 <3.4.13":
# "^3.4.13"` at v4.8.1, raised to 3.4.17 with its lockfile. When a `pin`
# to a release that fixed one of these fails its check, delete that removal and
# its row in the guard's REMOVED table; a release that moves dompurify past
# 3.4.13 fails the replacement on its path, and the replacement and its
# REPLACED row go the same way. When none is left, managed.yml runs
# ghcr's image again and this directory goes (docs/managed-bring-up.md,
# "Upgrading Trigger.dev"). This file is never `pin`ned backwards: its checks
# hold for read_at only, so going back to an older release means running the
# checkout that pinned it (a revert of the move, or the older release's tag),
# whose own Dockerfile and name come with it.
FROM ghcr.io/triggerdotdev/trigger.dev:v4.8.1@sha256:bcce9e8f5affee747fe0ce208cdf7dcd8815fe84fb44b31f446638fffcb64ebe

# Given by managed.yml from the .env, empty when the .env sets none. It only refuses.
ARG TRIGGER_IMAGE_TAG

USER root

RUN set -eu; \
    me=deploy/compose/trigger.dev/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read this file's header against the new tag, or drop the removal upstream fixed." >&2; exit 1; }; \
    read_at=v4.8.1; \
    core="v$(node -p "require('/triggerdotdev/packages/core/package.json').version")"; \
    if [ -n "${TRIGGER_IMAGE_TAG:-}" ] && [ "$TRIGGER_IMAGE_TAG" != "$core" ]; then \
      echo "$me: the .env names TRIGGER_IMAGE_TAG=$TRIGGER_IMAGE_TAG, and this checkout builds Trigger.dev $core. Either set TRIGGER_IMAGE_TAG=$core in the .env, or run a checkout that pins $TRIGGER_IMAGE_TAG: the release that ran it, or a move to it (trigger-version.sh pin $TRIGGER_IMAGE_TAG, docs/managed-bring-up.md, Upgrading Trigger.dev)." >&2; \
      exit 1; \
    fi; \
    [ "$core" = "$read_at" ] || fail "why each removal is safe was read in Trigger.dev $read_at's source, and this image is $core. Read the header's reasons again at $core (remoteBuildsEnabled and finalizeDeploymentV2, what build/server.js imports, docker/scripts/entrypoint.sh), then move read_at, and entrypoint_sha256 if the entrypoint changed."; \
    entrypoint=/triggerdotdev/scripts/entrypoint.sh; \
    entrypoint_sha256=2c6a49862da08b5d31309cdf908d2fb10f0ef89cb0ee7d54e0ef91e231b3620d; \
    [ -f "$entrypoint" ] || fail "$entrypoint is not there."; \
    [ "$(sha256sum "$entrypoint" | cut -d' ' -f1)" = "$entrypoint_sha256" ] || fail "$entrypoint is not the one read at $read_at. Which user runs its pnpm decides which copy this file may delete (THE USER COUPLING): read it, then move entrypoint_sha256."; \
    pm="$(node -p "require('/triggerdotdev/package.json').packageManager")"; \
    [ "$pm" = pnpm@10.33.2 ] || fail "the image names $pm, not pnpm@10.33.2, so corepack keeps pnpm at other paths."; \
    plat="$(node -p 'process.platform + "-" + process.arch')"; \
    case "$plat" in linux-arm64|linux-x64) ;; *) fail "this is $plat; the paths below are known for linux-arm64 and linux-x64.";; esac; \
    s=/triggerdotdev/node_modules/.pnpm; \
    depot_bin="$s/@depot+cli-$plat@0.0.1-cli.2.80.0/node_modules/@depot/cli-$plat/bin/depot"; \
    depot_link="$s/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli/bin/depot"; \
    esbuild_bin="$s/@esbuild+$plat@0.23.0/node_modules/@esbuild/$plat/bin/esbuild"; \
    esbuild_link="$s/esbuild@0.23.0/node_modules/esbuild/bin/esbuild"; \
    unused=/home/node/.cache/node/corepack/v1/pnpm/10.33.2; \
    kept=/root/.cache/node/corepack/v1/pnpm/10.33.2; \
    kept_modules="$kept/dist/node_modules"; \
    kept_gyp_bin="$kept/dist/node-gyp-bin"; \
    npm_dir=/usr/local/lib/node_modules/npm; \
    npm_link=/usr/local/bin/npm; \
    npx_link=/usr/local/bin/npx; \
    corepack_dir=/usr/local/lib/node_modules/corepack; \
    for f in "$depot_bin" "$depot_link" "$esbuild_bin" "$esbuild_link"; do \
      [ -f "$f" ] || fail "$f is not there."; \
      magic="$(head -c4 "$f" | od -An -tx1 | tr -d ' \n')"; \
      [ "$magic" = 7f454c46 ] || fail "$f is no ELF binary (it starts $magic): the postinstall did not link the binary there."; \
      stat -c '%h link(s), inode %i, %s bytes: %n' "$f"; \
    done; \
    [ -f "$unused/.corepack" ] || fail "$unused/.corepack is not there: node's copy of pnpm is not where it was."; \
    [ -d "$unused/dist/node_modules/tar" ] || fail "$unused/dist/node_modules/tar is not there: node's copy of pnpm no longer carries tar."; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack is not there: root's copy of pnpm, which trigger-api runs, is not where it was."; \
    [ -f "$kept_modules/node-gyp/bin/node-gyp.js" ] || fail "$kept_modules/node-gyp/bin/node-gyp.js is not there: root's copy of pnpm no longer carries node-gyp where pnpm 10.33.2 did."; \
    [ -d "$kept_gyp_bin" ] || fail "$kept_gyp_bin is not there: root's copy of pnpm no longer carries node-gyp's shim where pnpm 10.33.2 did."; \
    names="$(cd "$kept_modules" && for d in *; do case "$d" in @*) for p in "$d"/*; do printf '%s|' "$p"; done ;; *) printf '%s|' "$d" ;; esac; done | sed 's/[.]/\\./g')"; \
    named="$(find "$kept" -path "$kept_modules" -prune -o -type f -name '*js' -exec grep -HoE "(require(\.resolve)?\(|import\(|resolveFrom\([^,()]*, *)[\"'](${names%|})(/[^\"']*)?[\"']" {} + | tr -d "\"'" | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$named" = "$kept/bin/pnpm.cjs:require(v8-compile-cache $kept/dist/pnpm.cjs:require.resolve(picomatch $kept/dist/pnpm.cjs:resolveFrom(__dirname, node-gyp/bin/node-gyp " ] || fail "in $kept, outside $kept_modules, these name a package inside it: ${named:-none}; this file was read for three, each in a try: bin/pnpm.cjs's v8-compile-cache, and dist/pnpm.cjs's picomatch and node-gyp/bin/node-gyp."; \
    [ -f "$npm_dir/package.json" ] || fail "$npm_dir is not there: Node's npm is not where Node 24.22.1 puts it."; \
    [ "$(node -p "require('$npm_dir/package.json').version")" = 11.19.1 ] || fail "$npm_dir is not npm 11.19.1, Node 24.22.1's, which this file was read for."; \
    [ ! -e "$npm_dir/npmrc" ] || fail "$npm_dir/npmrc is there: pnpm reads it as its builtin configuration (@pnpm/npm-conf), so without npm pnpm would be configured otherwise."; \
    [ "$(readlink "$npm_link")" = ../lib/node_modules/npm/bin/npm-cli.js ] || fail "$npm_link is not Node's link to npm's bin/npm-cli.js."; \
    [ "$(readlink "$npx_link")" = ../lib/node_modules/npm/bin/npx-cli.js ] || fail "$npx_link is not Node's link to npm's bin/npx-cli.js."; \
    into="$(find /usr/local/bin -type l -exec sh -c 'for link; do case "$(readlink -f "$link")" in "$0"/*) echo "$link" ;; esac; done' "$(readlink -f "$npm_dir")" {} + | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$into" = "$npm_link $npx_link " ] || fail "these link into $npm_dir: ${into:-nothing}, not npm and npx alone."; \
    [ "$(node -p "require('$corepack_dir/package.json').version")" = 0.36.0 ] || fail "$corepack_dir is not corepack 0.36.0, Node 24.22.1's, which runs every pnpm here."; \
    rm "$depot_bin" "$depot_link" "$esbuild_bin" "$esbuild_link" "$npm_link" "$npx_link"; \
    rm -r "$unused" "$kept_modules" "$kept_gyp_bin" "$npm_dir"; \
    left="$(find "$s" -type f \( -name depot -o -name esbuild \) -exec sh -c 'for f; do [ "$(head -c4 "$f" | od -An -tx1 | tr -d " \n")" != 7f454c46 ] || echo "$f"; done' sh {} +)"; \
    [ -z "$left" ] || fail "a depot or esbuild binary is still there: $left"; \
    for p in "$unused" "$kept_modules" "$kept_gyp_bin" "$npm_dir" "$npm_link" "$npx_link"; do { [ ! -e "$p" ] && [ ! -L "$p" ]; } || fail "$p is still there."; done; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack went with the removal."; \
    [ "$(node -p "require('$corepack_dir/package.json').version")" = 0.36.0 ] || fail "corepack 0.36.0 went with npm."; \
    node -e "require('$s/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli'); require('$s/esbuild@0.23.0/node_modules/esbuild')" || fail "@depot/cli or esbuild no longer loads without its binary."; \
    [ "$(cd /triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --version)" = 10.33.2 ] || fail "as root, the user trigger-api runs as, pnpm does not start offline."; \
    (cd /triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter @trigger.dev/database exec node -e 0) || fail "as root, pnpm without node-gyp's tree does not run a command in @trigger.dev/database offline, as the entrypoint's migrations need."; \
    echo "$me: removed both names of depot and esbuild, node's copy of pnpm, node-gyp's tree from root's and npm; corepack 0.36.0 stays, and as root pnpm 10.33.2 starts and runs a workspace command offline."

# Still as root: dompurify 3.4.13's files replaced by 3.4.17's, as npm published
# them (WHAT IS REPLACED and HOW IT IS REPLACED, above).
RUN set -eu; \
    me=deploy/compose/trigger.dev/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read the header's WHAT IS REPLACED against this image, or drop the replacement if upstream moved dompurify." >&2; exit 1; }; \
    s=/triggerdotdev/node_modules/.pnpm; \
    pkg="$s/dompurify@3.4.13/node_modules/dompurify"; \
    from=3.4.13; \
    from_tree=e9c42f84de69a3769f574e05d9a17d919029a5b1bace0609737e9a9b7e9539d5; \
    to=3.4.17; \
    to_tree=595c3084456d2b111dbb14e16bf1462ecff273316170067b0a95a1cc5f0ff809; \
    url=https://registry.npmjs.org/dompurify/-/dompurify-3.4.17.tgz; \
    integrity=sha512-B/pSlYVHQ58kqISD/yDjuJ1yfzI34m1gF4lAod2bwSRhiN4K5Cl3H8Af7hqB2PmTL911tdEudnnXn5FnhRoz0w==; \
    posthog="$s/posthog-js@1.407.3/node_modules/posthog-js"; \
    mermaid="$s/mermaid@11.16.1/node_modules/mermaid"; \
    webapp=/triggerdotdev/apps/webapp; \
    top=/; \
    version() { node -p "require(process.argv[1] + '/package.json').version" "$1"; }; \
    files() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum); }; \
    tree() { files "$1" | sha256sum | cut -d' ' -f1; }; \
    [ -f "$pkg/package.json" ] || fail "$pkg is not there."; \
    [ "$(version "$pkg")" = "$from" ] || fail "$pkg is dompurify $(version "$pkg"), not $from."; \
    [ -z "$(find "$pkg" ! -type f ! -type d)" ] || fail "$pkg holds more than files and directories."; \
    [ "$(tree "$pkg")" = "$from_tree" ] || { files "$pkg" >&2; fail "$pkg is not the published dompurify $from, file for file (above)."; }; \
    for d in "$posthog" "$mermaid"; do [ -f "$d/package.json" ] || fail "$d is not there."; done; \
    links="$(find "$s" -maxdepth 3 -name dompurify ! -path "$pkg" | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$links" = "$s/mermaid@11.16.1/node_modules/dompurify $s/node_modules/dompurify $s/posthog-js@1.407.3/node_modules/dompurify " ] || fail "dompurify is linked from: $links; this file was read for posthog-js 1.407.3's, mermaid 11.16.1's and pnpm's hoisted link."; \
    for l in $links; do { [ -L "$l" ] && [ "$(readlink -f "$l")" = "$(readlink -f "$pkg")" ]; } || fail "$l is not a link to $pkg."; done; \
    copies="$(find "$top" -xdev -path '*/dompurify/package.json' -type f)"; \
    [ "$copies" = "$pkg/package.json" ] || fail "dompurify's package.json is at: $copies; this file replaces $pkg alone."; \
    for d in "$webapp/build/client" "$webapp/build/server" "$webapp/public"; do [ -d "$d" ] || fail "$d is not there: the webapp's build is not where it was read."; done; \
    found="$(grep -rlF data-tt-policy-suffix "$webapp/build" "$webapp/public")" && st=0 || st=$?; \
    [ "$st" = 1 ] || fail "the webapp's own build carries DOMPurify (grep exits $st): ${found:-}. A copy bundled there is not the package this replaces."; \
    found="$(grep -rlE "(from|import\(|require\()[[:space:]]*[\"'](dompurify|mermaid)[\"']" "$webapp/build")" && st=0 || st=$?; \
    [ "$st" = 1 ] || fail "the webapp's own build imports dompurify or mermaid (grep exits $st): ${found:-}. This file was read for a webapp that loads neither."; \
    tmp="$(mktemp -d)"; \
    marker="$tmp/marker"; \
    : > "$marker"; \
    paths() { find "$top" -xdev \( -path "$tmp" -o -path "$pkg" \) -prune -o -print | LC_ALL=C sort | sha256sum; }; \
    before="$(paths)"; \
    node -e "fetch(process.argv[1]).then(async (r) => { if (!r.ok) throw new Error(process.argv[1] + ' answered ' + r.status); require('fs').writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer())); })" "$url" "$tmp/dompurify.tgz" || fail "$url could not be fetched; nothing was changed."; \
    got="$(node -p "'sha512-' + require('crypto').createHash('sha512').update(require('fs').readFileSync(process.argv[1])).digest('base64')" "$tmp/dompurify.tgz")"; \
    [ "$got" = "$integrity" ] || fail "$url is $got, not $integrity, the integrity npm published for dompurify $to; nothing was changed."; \
    mkdir "$tmp/unpacked"; \
    tar -xzf "$tmp/dompurify.tgz" -C "$tmp/unpacked" --no-same-owner; \
    new="$tmp/unpacked/package"; \
    [ "$(version "$new")" = "$to" ] || fail "$url unpacks to dompurify $(version "$new"), not $to; nothing was changed."; \
    { [ -z "$(find "$new" ! -type f ! -type d)" ] && [ "$(tree "$new")" = "$to_tree" ]; } || { files "$new" >&2; fail "$url unpacks to other files than the published dompurify $to (above); nothing was changed."; }; \
    chown -R "$(stat -c %u:%g "$pkg/package.json")" "$new"; \
    rm -r "$pkg"; \
    mv "$new" "$pkg"; \
    { [ "$(version "$pkg")" = "$to" ] && [ "$(tree "$pkg")" = "$to_tree" ]; } || fail "$pkg is not the published dompurify $to after the swap."; \
    [ "$(paths)" = "$before" ] || fail "a path outside $pkg was added or removed while it was replaced."; \
    changed="$(find "$top" -xdev \( -path "$tmp" -o -path "$pkg" \) -prune -o ! -type d -cnewer "$marker" -print)"; \
    [ -z "$changed" ] || fail "outside $pkg, these changed while it was replaced: $changed"; \
    rm -r "$tmp"; \
    for d in "$posthog" "$mermaid"; do \
      (cd "$d" && node -e "const fs = require('fs'); const p = fs.realpathSync(require.resolve('dompurify')); const v = require('dompurify').version; console.log('require(dompurify): ' + p + ' ' + v); if (p !== fs.realpathSync(process.argv[1] + '/dist/purify.cjs.js') || v !== process.argv[2]) process.exit(1);" "$pkg" "$to") || fail "from $d, require('dompurify') does not load $to from $pkg."; \
      (cd "$d" && node --input-type=module -e "import { realpathSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; const p = realpathSync(fileURLToPath(import.meta.resolve('dompurify'))); const v = (await import('dompurify')).default.version; console.log('import(dompurify): ' + p + ' ' + v); if (p !== realpathSync(process.argv[1] + '/dist/purify.es.mjs') || v !== process.argv[2]) process.exit(1);" "$pkg" "$to") || fail "from $d, import('dompurify') does not load $to from $pkg."; \
    done; \
    echo "$me: dompurify $from's files at $pkg are $to's, as npm published them ($integrity); nothing else in the image changed; from posthog-js and mermaid, require and import load $to."

# Upstream's own user, which this image keeps.
USER node

# As node, the copy is gone, and corepack refuses rather than fetching pnpm.
RUN set -eu; \
    me=deploy/compose/trigger.dev/Dockerfile; \
    if (cd /triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --version) >/dev/null 2>&1; then \
      echo "$me: as node, pnpm still starts offline, so a copy is left that this file removes, or corepack reads another home. Re-read the user coupling in this file's header against managed.yml." >&2; \
      exit 1; \
    fi; \
    echo "$me: as node, pnpm does not start offline, as it should not: trigger-api runs as root."
