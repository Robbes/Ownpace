# Trigger.dev's webapp as upstream publishes it, by tag and index digest, with
# files deleted that no process of this stack ever runs (workplan 0146 T16; the
# owner's decisions of 2026-10-26, "Both": an issue upstream, and this build
# until upstream ships the fixes, and of 2026-10-27: tar out of the copy of
# pnpm that runs, too). Since 2026-10-31, npm and the rest of node-gyp's tree
# in that copy go as well, under the one risk the owner accepted for tar (THE
# HIGHS NOTHING RUNS, below). Since 2026-11-02 the copy of pnpm that runs is
# 10.34.9, npm's latest-10, in place of upstream's 10.33.2: hygiene, not a
# security fix (WHAT IS REPLACED: PNPM, below). Since 2026-11-03 (the owner's
# mandate: the time before alpha.4's fold goes to the findings a release
# fixes), TypeScript 7's native compiler binary goes too (WHAT GOES), and goose
# is a release binary in place of the v3.27.1 upstream builds: v3.29.0's until
# 2026-11-13, v3.30.1's since, for alpha.8 (WHAT IS REPLACED: GOOSE). From
# 2026-10-30, and with four more packages from
# 2026-11-03, this build also replaced packages' files by the release that
# fixes each; since v4.8.5 (2026-11-13, for alpha.8) upstream ships those
# releases itself, and the two RUNs that swapped them are gone (WHAT UPSTREAM
# NOW SHIPS FIXED). With the swaps, about 89 high findings became 46, and 57
# with a fix became 14 (WHAT STAYS says what is left, and why). Since
# 2026-11-06 (for alpha.6, workplan 0119 §3 item 11, confirmed by the owner on
# 2026-11-07), the last RUN as root purges eleven Debian packages nothing here
# runs or loads (thirteen since 2026-11-08, below): apt, libapt-pkg6.0, the
# eight util-linux builds and e2fsprogs, which pre-depends on two of them (THE
# DEBIAN PACKAGES NOTHING RUNS): 49 high findings become about 23, and 16
# with a fix about 14. The branch's scan of that image read 1 critical, 24
# high and 14 with a fix (Security Scan run 42213975717). The same day effect
# 3.17.1 joined the swaps (24 became 23, and 14 became 13: Security Scan run
# 42263361900). Since 2026-11-08 (for alpha.7) the purge takes libsystemd0 and
# libudev1 too, systemd's two libraries, which nothing left needs once apt and
# util-linux are gone: the scan of the alpha.6 tag read 1, 24 and 14 (Security
# Scan run 42368077845, one more in goose v3.29.0's golang.org/x/net), and the
# two take 2 highs off it (THE DEBIAN PACKAGES NOTHING RUNS): 1, 22 and 14 on
# the branch that took them (Security Scan run 42440765278). At v4.8.5 about 1,
# 19 and 11 are expected (WHAT STAYS), on upstream's Node 24.22.3 base, Node's
# November security release; the scan of main on 2026-11-13 read 1, 19 and 11
# (Security Scan run 43492635512). With goose v3.30.1 about 1, 17 and 9 were
# expected, goose's two going (WHAT IS REPLACED: GOOSE), and the scan of
# alpha.8's tag commit read that (Security Scan run 43577138736). From
# 2026-11-14 (for alpha.9) cross-spawn 5.1.0 went too, with spawndamnit's link
# to it: about 1, 16 and 8 were expected. Since 2026-11-20
# connect-node's undici is the store's 6.29.1 in place of 5.29.0, and undici
# 5.29.0 and its @fastify/busboy 2.1.1 go (WHAT IS RELINKED: UNDICI): the scan
# of main on 2026-11-19 read 1, 19 and 8 (Security Scan run 44637576014), and
# the branch's read 1, 13 and 2 (Security Scan run 44651070464). Since v4.8.8
# (2026-11-21, for alpha.14) upstream's own override takes cross-spawn 7.0.6
# in 5.1.0's place, so that removal went (WHAT UPSTREAM NOW SHIPS FIXED), and
# the esbuild binary that goes is 0.28.2's, the CLI's since v4.8.6 (WHAT GOES).
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
#   - the same tar in root's copy of pnpm 10.33.2, the one every pnpm of the
#     entrypoint ran here (below), which stayed without it until 2026-11-02;
#     since then that copy goes whole, and root runs pnpm 10.34.9 (WHAT IS
#     REPLACED: PNPM).
# Two were left after those: zlib1g (CVE-2023-45853, no fix in Debian), which
# stays, and dompurify 3.4.13 (GHSA-cg2g-xh64-v4q7, fixed in 3.4.17), whose
# files this build replaced with 3.4.17's from 2026-10-30, and which upstream
# resolves as 3.4.17 itself since v4.8.4 (WHAT UPSTREAM NOW SHIPS FIXED). So 8
# become 1. The binaries are the same Go builds on amd64.
#
# THE HIGHS NOTHING RUNS. The image scan of the image built here at v4.8.3,
# Security Scan run 41159641513 (Trivy 0.76.1, linux/arm64, 2026-10-31), read 1
# critical and 136 high findings, 80 of them with a fix (1, 137 and 81 at
# v4.8.1, run 41130684117). Twelve of the 80 are in two trees no process of
# this stack runs, and they go too (WHAT GOES, the last two):
#   - npm 11.19.1, which Node 24.22.1 bundles, under
#     /usr/local/lib/node_modules/npm: brace-expansion 5.0.9 (CVE-2026-102276,
#     CVE-2026-102278) and undici 6.28.0 (CVE-2026-19534, CVE-2026-109383,
#     CVE-2026-109869, CVE-2026-87018). The same six are in
#     node:24.22.1-bookworm-slim, the FROM of upstream's runner stage, and in
#     node:24.22.1-alpine, the supervisor's, by the same digests at v4.8.1 and
#     v4.8.3. At v4.8.5 the FROMs are node:24.22.3-bookworm-slim and
#     node:24.22.3-alpine, and Node 24.22.3 bundles the same npm 11.19.1, with
#     the same brace-expansion 5.0.9 and undici 6.28.0 (read 2026-11-13 in
#     both images' layers by digest, on both platforms).
#   - node-gyp's tree in root's copy of pnpm,
#     /root/.cache/node/corepack/v1/pnpm/10.33.2/dist/node_modules:
#     brace-expansion 2.1.0 (CVE-2026-102276, CVE-2026-102278, CVE-2026-13149,
#     CVE-2026-14257, CVE-2026-69152) and ip-address 10.1.0 (CVE-2026-69192).
# Each was read in its own part with the same Trivy (the two Node images by
# digest, and pnpm 10.33.2 as npm published it, tar taken out). So 136 become
# about 124, and 80 about 68. What stayed is code that runs: pnpm 10.33.2 itself
# (11 highs), goose, the webapp's node_modules and the OS packages. Since
# 2026-11-02 pnpm 10.33.2 goes whole for 10.34.9, against which npm lists no
# advisory (WHAT IS REPLACED: PNPM), and the tree that goes is the one in
# 10.34.9's copy, /root/.cache/node/corepack/v1/pnpm/10.34.9/dist/node_modules
# (the same node-gyp 11.5.0, with tar 7.5.22, brace-expansion 2.1.7 and
# ip-address 10.7.4, and content-type besides; npm lists two moderates in it,
# glob's and minimatch's, and no high). The scan of 2026-11-02 (Security Scan
# run 41465604476) read 1 critical, 100 high and 68 with a fix (most likely a
# newer database: the build of 2026-10-31 read 124 high); without pnpm
# 10.33.2's 11 that is about 1, 89 and 57 (arithmetic, not measured), and the
# branch's own scan read exactly that (Security Scan run 41527113857).
#
# WHAT GOES, AND WHY NOTHING RUNS IT. Read in upstream's source at v4.8.1, again
# at v4.8.3, at v4.8.5 and at v4.8.8, and in the published packages, whose
# sha512 is the one pnpm-lock.yaml names:
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
#   - esbuild's binary: 0.23.0's until v4.8.5, and 0.28.2's since v4.8.8,
#     since packages/cli-v3 asks for esbuild ^0.28.2 from v4.8.6 (upstream's
#     lockfile at v4.8.8 resolves 0.28.2 for it, and 0.23.0 for tsx 4.17.0
#     alone, a devDependency). Its binaries are built with Go 1.26.5 (the
#     release string in both platforms' binaries, read as bytes, never run),
#     where 0.23.0's were Go 1.22.4. Loading esbuild starts nothing; the binary
#     is found and spawned at the first build, transform or context call
#     (ensureServiceIsRunning() in lib/main.js, the same at 0.28.2), and its
#     postinstall still hard-links it over bin/esbuild (install.js,
#     maybeOptimizePackage). Nothing in the image makes one. It is installed
#     only because packages/cli-v3, the `trigger.dev` CLI, depends on it, and
#     cli-v3 enters the webapp's pruned workspace through
#     internal-packages/dashboard-agent's devDependency
#     `"trigger.dev": "workspace:*"`; `pnpm install --prod` over that workspace
#     installs the CLI's dependencies. By upstream's lockfile at v4.8.8, that
#     install holds esbuild 0.28.2 alone. server.js imports neither the CLI nor
#     esbuild, and the entrypoint runs prisma, node scripts, goose and
#     build/server.js. (tsdown and tsx are not in the production install.)
#   - node's copy of pnpm, /home/node/.cache/node/corepack/v1/pnpm/10.33.2.
#     managed.yml runs trigger-api as root (`user: root`, for its chown of the
#     shared volume) and sets no HOME, so HOME is /root, and corepack runs
#     root's copy, of the version packageManager names, for every pnpm in
#     docker/scripts/entrypoint.sh: the migrations of @trigger.dev/database,
#     the run-ops databases and the dashboard agent. Nothing execs into
#     trigger-api as node. Corepack 0.36.0 (Node 24.22.1's, and 24.22.3's, the
#     same corepack.cjs byte for byte) finds the copy
#     under $HOME/.cache/node/corepack (getCorepackHomeFolder) and reuses it by
#     its .corepack file alone (installVersion), never fetching it again while
#     that file is there.
#   - since 2026-11-02, root's copy of pnpm 10.33.2,
#     /root/.cache/node/corepack/v1/pnpm/10.33.2, the one upstream ships for
#     the user trigger-api runs as: this build installs 10.34.9 beside it and
#     rewrites packageManager to pnpm@10.34.9, so corepack runs 10.34.9's copy
#     and never looks at 10.33.2's (WHAT IS REPLACED: PNPM).
#   - tar inside root's copy, the one that runs:
#     /root/.cache/node/corepack/v1/pnpm/10.33.2/dist/node_modules/tar until
#     2026-11-02, and /root/.cache/node/corepack/v1/pnpm/10.34.9's (7.5.22)
#     since. Asked with the risk stated, the owner chose on 2026-10-27 to
#     remove it too. In pnpm 10.33.2's dist, and in 10.34.9's, the one
#     require('tar') is the bundled node-gyp's lib/install.js, which downloads
#     and unpacks Node's headers for a native build; pnpm.cjs and worker.js
#     name no tar (they bundle tar-stream).
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
#     /root/.cache/node/corepack/v1/pnpm/10.34.9/dist/node_modules (10.33.2's
#     until 2026-11-02, the same layout), which is node-gyp 11.5.0 and the
#     packages it brings, installed flat (tar was one), and
#     dist/node-gyp-bin, the shim that runs it. pnpm.cjs and worker.js
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
#     with both directories removed, and 10.34.9's on 2026-11-02, whose files
#     name the same three (its tree adds content-type, which none names):
#     `pnpm run` and `pnpm exec` work, and a script that calls node-gyp says
#     `node-gyp: not found`. That is tar's risk again, and the only one: a
#     script that calls node-gyp, or an install that builds a native add-on.
#     The entrypoint's pnpm runs three migration scripts that call neither.
#     The build checks that those three are all any file of the copy outside
#     dist/node_modules names of it, before it removes anything.
#   - npm 11.19.1, which Node 24.22.1 bundles, and 24.22.3 at v4.8.5 and v4.8.8:
#     /usr/local/lib/node_modules/npm,
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
#   - since 2026-11-03, TypeScript 7's native compiler, lib/tsc of
#     @typescript/typescript-$plat 7.0.2 (Go 1.26.4 with golang.org/x/text
#     v0.38.0: 15 fixable highs in the scan's arm64 image). It
#     is there because typescript 7.0.2 is a resolved peer of prisma 6.14.0,
#     @prisma/client, @remix-run/* 2.17.5 and class-variance-authority, and
#     the platform package is its optional dependency, with no install
#     script, so the file has one name. Nothing runs it: the package
#     `typescript` 7.0.2 exports "." as lib/version.cjs, which reads
#     package.json and holds no compiler; the binary is reached only through
#     bin/tsc (lib/tsc.js) or the unstable API's getExePath
#     (dist/api/options.js), and in the image the one caller of the package
#     is prisma's build/index.js, `(await import("typescript")).default
#     .version`, for its version report. The webapp's source and the
#     entrypoint name neither; `tsc` is in @trigger.dev/database's build,
#     dev and typecheck scripts, which nothing here runs. Before it goes,
#     the build checks it is the published binary for the platform (its
#     SHA-256), an ELF with one name (a second one would keep it, and
#     Trivy reads no hard link); after, that no ELF named tsc or tsgo is
#     left under node_modules/.pnpm, and that from typescript's own
#     directory and from prisma's, require and import of `typescript`
#     still give 7.0.2 from typescript 7.0.2's lib/version.cjs. The rest of
#     the platform package (its lib.*.d.ts) stays.
#   - from 2026-11-14 (for alpha.9) to 2026-11-21, cross-spawn 5.1.0
#     (CVE-2024-21538, high, fixed in 6.0.6 and 7.0.5), with spawndamnit
#     2.0.0's link to it: its one requirer, under the root's @changesets/cli,
#     release tooling nothing here runs (upstream's pnpm-lock.yaml at v4.8.5).
#     Since v4.8.8 upstream's root package.json overrides `cross-spawn@<6.0.6`
#     to ^7.0.6, its lockfile resolves 7.0.6 alone, and spawndamnit links
#     7.0.6, so the image holds no 5.1.0 and the removal went (WHAT UPSTREAM
#     NOW SHIPS FIXED), its check, its walk and its proof with it.
#     The build proves as root, after every removal, that pnpm 10.34.9 starts
#     offline and runs a command in @trigger.dev/database's package, as the
#     migrations do. That command is a `pnpm exec`, which does not pass through
#     pnpm's lifecycle code; the migrations are package scripts, which do, and
#     E2E (managed) runs them.
#
# WHAT IS REPLACED: PNPM 10.33.2 BY 10.34.9 (since 2026-11-02). Every pnpm the
# entrypoint runs is corepack's copy of the version the root package.json's
# packageManager names, pnpm@10.33.2 upstream. npm lists 18 advisories against
# pnpm 10.33.2, all fixed by 10.34.5: 11 high (GHSA-5wx6-mg75-v57r,
# GHSA-72r4-9c5j-mj57, GHSA-c59q-g84q-2gj5, GHSA-fr4h-3cph-29xv,
# GHSA-gj8w-mvpf-x27x, GHSA-hwx4-2j3j-g496, GHSA-qrv3-253h-g69c,
# GHSA-rxhj-4m44-96r4, GHSA-vq4v-j7r6-jq4m, GHSA-vx52-2968-3vc6,
# GHSA-w466-c33r-3gjp) and 7 moderate (GHSA-3qhv-2rgh-x77r,
# GHSA-4gxm-v5v7-fqc4, GHSA-54hh-g5mx-jqcp, GHSA-cjhr-43r9-cfmw,
# GHSA-hg3w-7f8c-63hp, GHSA-p4xf-rf54-rj3x, GHSA-q6j5-fjx5-2mc3). None is
# reachable here. Each needs an install, a patch command, a registry request
# or workspace files an attacker wrote, and this container installs nothing:
# its pnpm runs the migrations' package scripts from the workspace baked into
# the image (two here: @trigger.dev/database's and the dashboard agent's;
# run-ops' only with a RUN_OPS_* variable, which managed.yml sets none of).
# Under corepack (COREPACK_ROOT set) pnpm skips its own version switch and its
# packageManager check. And upstream's workspace has no configDependencies, no
# proxy settings, no nodeLinker, no root .npmrc and no pnpmfile, and its
# lockfile is one document. So this is hygiene, not a security fix: the copy
# that runs, and the one the scan reads, become a release npm lists no
# advisory against. 10.34.9 is npm's latest-10, published 2026-10-25 17:54
# UTC, past its three-day floor since 2026-10-28. Its layout, engines (node
# >=18.12) and bins are 10.33.2's; its update check still runs on `install`
# and `add` only (scripts/a-service-that-phones-home.unit.test.ts); and from
# 10.33.3 to 10.34.9 its changelog changes nothing a positive `pnpm --filter`
# run of a package script does with upstream's settings (the rest is installs,
# patches, self-update, version switching, negative filters and repository
# configuration that upstream does not set).
#
# HOW PNPM IS REPLACED. Corepack picks the version from packageManager and
# reuses a copy by its .corepack file alone, without its hash, so 10.34.9's
# files under 10.33.2's path would run under the wrong name: packageManager
# has to say 10.34.9. Before it removes anything, the first RUN refuses an
# image whose packageManager is not pnpm@10.33.2 (upstream moved: THE WAY OUT)
# or that has a copy of 10.34.9 already, and runs `corepack install -g
# pnpm@10.34.9+sha512.<the sha512 npm published>` as root: corepack fetches
# the tarball from the npm registry and refuses
# other bytes ("Mismatch hashes", writing nothing); with a hash it checks no
# signature, so the build does not depend on corepack's built-in npm keys. It
# writes the copy and lastKnownGood.json, nothing else. The RUN then checks
# the copy: its version, the hash its .corepack records, and node-gyp's tree
# and the three names, as above. After the removals it rewrites packageManager
# in /triggerdotdev/package.json with node, which refuses a file that does not
# name it exactly once, as pnpm@10.33.2; writing the file in place keeps its
# owner, node, where `sed -i` would leave it root's. It reads the field back,
# checks that root's corepack keeps pnpm 10.34.9 alone and node's keeps none
# (a copy of any other version would be one this file was not read for), and
# proves pnpm 10.34.9 starts offline as root. Nothing in the webapp's source
# or its migrations reads packageManager or npm_*; what a script sees change
# is npm_config_user_agent (pnpm/10.34.9), and npm_execpath and PATH's
# node-gyp-bin entry, which name 10.34.9's directory (build/server.js, a
# bundle, was not read for them).
#
# WHAT UPSTREAM NOW SHIPS FIXED (since 2026-11-13, Trigger.dev v4.8.5). From
# 2026-10-30 to 2026-11-13 this build also replaced six packages' files with
# the release of the same major that fixes each, fetched from the npm registry
# by the sha512 npm published: dompurify 3.4.13 by 3.4.17 (GHSA-cg2g-xh64-v4q7,
# critical, and GHSA-mrv2-3pqr-j5jr), and undici 6.29.0, follow-redirects
# 1.16.0, body-parser 1.20.6, systeminformation 5.31.7 and effect 3.17.1 by
# 6.29.1, 1.16.2, 1.20.9, 5.33.19 and 3.22.4. Since v4.8.4 upstream's root
# package.json overrides each of them (dompurify ^3.4.17, undici ^6.29.1,
# follow-redirects ^1.16.2, express 4's body-parser ^1.20.9, systeminformation
# ^5.33.16, effect ^3.20.0, and body-parser 2's ^2.4.0). Its lockfile at v4.8.5
# resolves dompurify 3.4.17, undici 6.29.1, follow-redirects 1.16.2,
# body-parser 1.20.9 and 2.4.0, systeminformation 5.33.19 and effect 3.21.2
# alone. So both RUNs that swapped them went, with their rows in the guard,
# as THE WAY OUT said: each refuses a tree without the version it replaces.
# The supervisor's systeminformation RUN went the same way. The overrides also
# fix three copies this build could not swap: effect 3.16.12 and 3.18.4, which
# @prisma/config pinned exactly, and body-parser 2.3.0. This is the npm half of
# what triggerdotdev/trigger.dev#5084 asked for. From v4.8.5 to 2026-11-21
# nothing in this build fetched from the npm registry but pnpm 10.34.9, which
# corepack installs (WHAT IS REPLACED: PNPM); since 2026-11-21 effect 3.22.4's
# tarball is fetched too (WHAT IS REPLACED: EFFECT). The undici relink fetches
# nothing, and gives connect-node the store's 6.29.1 (WHAT IS RELINKED:
# UNDICI).
# Since v4.8.8 (2026-11-21) upstream's root package.json also overrides
# `cross-spawn@<6.0.6` to ^7.0.6, and its lockfile resolves cross-spawn 7.0.6
# alone: spawndamnit 2.0.0, its one requirer under the root's @changesets/cli,
# links 7.0.6, and 5.1.0 and the six packages that came with it (lru-cache
# 4.1.5, pseudomap, shebang-command 1.2.0, shebang-regex 1.0.0, which 1.3.1,
# yallist 2.1.2) are gone. So the removal of 5.1.0 went from both builds, with
# its rows and the guard's CROSS_SPAWN, as THE WAY OUT said: its check stops
# the build where it is not there.
#
# WHAT IS REPLACED: GOOSE v3.27.1 BY v3.30.1 (by v3.29.0 from 2026-11-03; by
# v3.30.1 since 2026-11-13, for alpha.8). Upstream's
# Dockerfile builds /usr/local/bin/goose with `go install
# github.com/pressly/goose/v3/cmd/goose@v3.27.1` on golang:1.26.10-alpine, and
# the entrypoint runs it as root at every start of trigger-api: `goose up`
# with GOOSE_DRIVER=clickhouse, GOOSE_DBSTRING from CLICKHOUSE_URL
# (managed.yml's is http://…@clickhouse:8123?secure=false) and
# GOOSE_MIGRATION_DIR, the ClickHouse migrations. Trivy 0.76.1 reads 21 fixable
# highs in it: golang.org/x/crypto v0.50.0 (10), x/net v0.53.0 (5), x/text
# v0.36.0 (2), grpc v1.80.0 (3) and klauspost/compress v1.18.5 (1). Fifteen
# are in packages the binary does not link (of x/crypto its symbol table has
# md4 alone, and none of x/net's html or dns/dnsmessage, nor compress's s2),
# and none of the 21 is reachable from `goose up` over plain HTTP to the
# stack's own ClickHouse. v3.29.0 was goose's latest release on 2026-11-03
# (2026-10-11, revision 8b457ba3; its build info: Go 1.27.2, CGO off, x/crypto
# v0.58.0, x/net v0.61.0, x/text v0.43.0, clickhouse-go v2.49.0,
# klauspost/compress v1.20.1), and Trivy read one high in its release binary,
# Go's own CVE-2026-111943 (crypto/x509, fixed in Go 1.27.3), which needs TLS,
# and goose here speaks plain HTTP. So 21 became 1, and 2 from the scan of
# 2026-11-07, which read one more in its golang.org/x/net v0.61.0, fixed in
# v0.62.0 (Security Scan run 42368077845; the scan of main on 2026-11-13, run
# 43492635512, names it CVE-2026-78661).
# v3.30.1 (tag at ded3331f, committed 2026-11-12 at 13:48:17 UTC; its two
# assets uploaded at 14:02:52 and 14:02:55 UTC, their Last-Modified) is built
# past both fixes. Its build info, read from both assets with `go version -m`
# on 2026-11-13, neither of them run: Go 1.27.4, CGO off, x/crypto v0.58.0,
# x/net v0.62.0, x/text v0.44.0, clickhouse-go v2.51.0, klauspost/compress
# v1.20.4. So 2 are expected to become 0. No scanner read v3.30.1's binary
# where this was written: the image scan of the branch measures it.
# v3.30.1 IS TAKEN BEFORE ITS THREE-DAY FLOOR (CONTRIBUTING.md), which ends on
# 2026-11-15 at 14:02:55 UTC, on the owner's waiver of 2026-11-13: "Waive all
# waiting time." The guard holds that waiver to v3.30.1 by name: a later goose
# inside its own floor fails it, until that release is past its floor or a
# waiver of the owner's is quoted for it.
# What `goose up` does with
# upstream's settings is unchanged from v3.27.1 to v3.29.0: GOOSE_DRIVER,
# GOOSE_DBSTRING, GOOSE_MIGRATION_DIR and `up` read as before
# (cmd/goose/main.go), and the ClickHouse dialect's queries are the same but
# one: since v3.28.0, a goose_db_version table that does not exist yet is
# created with `ORDER BY (version_id)` in place of `ORDER BY (date)`
# (internal/dialects/clickhouse.go, CreateTable, `CREATE TABLE IF NOT
# EXISTS`; the changelog's #1085). Every stack that has run trigger-api has
# the table already, the OTA stack's and live's among them, and goose never
# alters it; only an empty volume gets the new order, and every query goose
# runs on the table reads it by version_id either way. The rest of the
# changes are other drivers' (a new one, another's credentials, a third's
# locker and timestamp column), `goose create` and `env`, and dependency
# upgrades.
# From v3.29.0 to v3.30.1 (13 commits, read at both tags on 2026-11-13),
# cmd/goose, the ClickHouse dialect and every file `goose up` runs through
# (goose.go, up.go, migrate.go, migration.go, migration_sql.go, db.go,
# dialect.go, database/) are the same byte for byte. One file beneath them
# changed, the parser a migration file is read with when it is applied
# (internal/sqlparser/parser.go): its line buffer starts small and grows to
# the same 4 MiB limit, where it was 4 MiB from a pool; the last word of a
# line is found with strings.FieldsSeq in place of a word scanner, over the
# same white space; and a migration that says `+goose ENVSUB ON` is expanded
# by interpolate v0.2.0, which keeps a `$` that starts no variable name where
# v0.0.2 refused it (goose's changelog). None of the 55 ClickHouse
# migrations upstream ships at v4.8.5 says ENVSUB, their longest line is 180
# bytes, and a migration that is already applied is not parsed at all
# (migration.go, run). The rest is
# the Provider's, which the command does not use (SQL-only sources sorted by
# version, a locker that stopped waiting), `goose validate`, a container
# image upstream now publishes, and dependency upgrades; no module joins or
# leaves go.mod. clickhouse-go moves v2.49.0 to v2.51.0, read at both tags:
# its HTTP connection, Exec and Query are unchanged, and what changed is batch
# inserts under WithAsync and IPv4 appends, neither of which goose calls; a
# NULL scanned into a destination that cannot hold one, now an error, where
# goose_db_version has no Nullable column; the error of a DSN that does not
# parse, which no longer carries its password; and the version in the
# User-Agent it sends ClickHouse.
#
# HOW GOOSE IS REPLACED, AND PROVED. goose's RUN, the second as root (the
# fourth until v4.8.5), reads the old file
# first: a file, an ELF, one name (a second would keep it, and Trivy reads no
# hard link), root's and 0755 as upstream's builder stage leaves it, and
# `goose -version` saying v3.27.1 (anything else: upstream moved goose, THE
# WAY OUT). It fetches the release's asset for the platform from GitHub with
# node's fetch, which follows the redirect to GitHub's release-assets host,
# and refuses it, with nothing changed, unless its SHA-256 is the one pinned
# here, read from the release on 2026-11-13 and equal to its checksums.txt
# (goose_linux_arm64, 41,287,840 bytes, as v3.29.0's was; goose_linux_x86_64,
# 43,774,112 bytes). It makes the new
# file root's and 0755 before it moves it into place: Trivy 0.76.1 skips a Go
# binary that is not executable (THE MODE, below), and the entrypoint runs it.
# After the move it proves the path is that file, root's and 0755 with one
# name, that it says v3.30.1, and that no other path of the image was added,
# removed or changed. The image build needs github.com reachable as well as
# the npm registry, wherever it builds: CI, the OTA stack's runner and the
# live host. A fetch that fails is no move upstream, and goose's RUN does not
# say it is (nor did the two RUNs that went at v4.8.5): a host that does not
# answer, or answers with an error, stops the build with nothing changed and
# the advice to run the same tag again once it answers; a file that is gone
# (404, 410) says so. GitHub lets a release's owner delete an asset, where npm
# keeps a version others depend on: if goose's is gone, a machine that holds
# this image's name keeps it, and a pull request moves the replacement to a
# release whose assets are there, or drops it (docs/managed-bring-up.md,
# Upgrading Trigger.dev). goose's RUN asks a host that does not answer five
# times before it stops (FIVE FETCHES, below).
#
# FIVE FETCHES, 5, 15, 45 AND 135 SECONDS APART (since 2026-11-09). goose's
# RUN made one fetch, and on 2026-11-09 at 06:23:53 UTC GitHub's release
# download answered it 504: a pull request's `build (trigger, arm64)` failed
# on it (CI run 42572585094, job 129013098616). Now a fetch that did not
# answer, or answered with an error (node's exit 3), is made again, up to five
# fetches with 5, 15, 45 and 135 seconds between them, as CI's stalwart-cli
# and Trivy downloads are (#1850, #1862), and each one that fails says which
# of the five it was. Nothing else is fetched again: a file that is gone
# (exit 4) and any other failure stop the build at once, as before. What the
# fetch brings is hashed once the loop is done, the fifth's as the first's,
# and a wrong SHA-256 stops the build at once with nothing changed: it is
# never fetched again. The waits add up to 200 seconds, so a refusal about
# that long is ridden out; a longer one still stops the build, with nothing
# changed and the advice to run the same tag again. The wait is multiplied by
# three after each one, since the RUN's shell is dash, which has no `**`.
#
# THE MODE. Trivy 0.76.1 reads the modules of a Go binary only when the file
# is executable. The triage of 2026-11-03 first read 0 findings in goose,
# from a copy taken out of the image without its mode; with the mode, 21.
# So the build checks the mode of the old file and gives it to the new one,
# and a scan of a binary taken out of an image is no proof unless the copy
# kept it (chmod +x first).
#
# WHAT IS RELINKED: UNDICI 5.29.0 BY THE STORE'S 6.29.1, FOR CONNECT-NODE
# (since 2026-11-20; workplan 0119's reading of 2026-11-19 proposed it, and the
# owner approved it). Security Scan run 44637576014 (main, 2026-11-19) reads
# undici 5.29.0 at node_modules/.pnpm/undici@5.29.0/node_modules/undici, 5
# highs that only undici 6 fixes (CVE-2026-1526, CVE-2026-2229,
# CVE-2026-12151, CVE-2026-87018 and one more, all fixed by 6.29.1), and its
# one dependency, @fastify/busboy 2.1.1, at
# node_modules/.pnpm/@fastify+busboy@2.1.1 (CVE-2026-19481, high, fixed in
# 3.2.1). Read in upstream's pnpm-lock.yaml at read_at (d412e08a) on
# 2026-11-19: undici 5.29.0's one requirer is @connectrpc/connect-node 1.4.0,
# which asks for "undici": "^5.28.3", and connect-node's one is
# @depot/sdk-node 1.0.0, an apps/webapp dependency; busboy 2.1.1's one is
# undici 5.29.0; and undici 6.29.1 is in the same store, installed for
# @remix-run/node 2.17.5, another apps/webapp dependency, and
# @ai-sdk/provider-utils 4.0.56, by upstream's override `undici@>=6 <6.29.1:
# ^6.29.1`, which reaches no undici 5. So nothing is fetched: connect-node's
# link, node_modules/undici in pnpm's directory for it, points at the store's
# 6.29.1, and pnpm's directories for undici 5.29.0 and busboy 2.1.1 go, with
# pnpm's hoisted link to busboy, its one version in the store. pnpm's records
# (pnpm-lock.yaml, node_modules/.pnpm/lock.yaml) keep 5.29.0: nothing here
# installs, Node checks no range, and Trivy reads package.json.
# Why 6.29.1 serves connect-node, read in the published packages, each by the
# sha512 the lockfile names (connect-node 1.4.0, @depot/sdk-node 1.0.0, undici
# 5.29.0 and 6.29.1, busboy 2.1.1), on 2026-11-19, none of them run:
# connect-node's dist names undici in two files, each build's
# node-headers-polyfill.js, which that build's index loads: `require("undici")`
# in dist/cjs, and `import { Headers as HeadersPolyfill } from "undici"` in
# dist/esm. Each puts undici's Headers on globalThis only when Node's major is
# below 18 and there is none, and trigger-api runs Node 24.22.3: on it,
# connect-node needs only that undici loads, and in dist/esm that Headers can be
# imported by name. undici 6.29.1 is CommonJS (main index.js, no exports, no
# type), asks for Node >=18.17, declares no dependency, requires nothing but
# Node's own modules, and exports Headers as 5.29.0 does, by
# `module.exports.Headers =`, the fetch Headers class, a name Node's ESM loader
# reads from CommonJS. Loading either does one more thing, in the same way in
# both (each one's lib/global.js): it sets the process's global dispatcher,
# Symbol.for('undici.globalDispatcher.1'), which Node's own fetch uses too, to
# an Agent of its own when none is set. connect-node's transports are its own
# http and http2 code, not undici's, and @depot/sdk-node makes one when it
# loads, which connects only for a request; the webapp makes one only with
# DEPOT_TOKEN and DEPOT_ORG_ID (WHAT GOES). The webapp loads it at every start:
# app/entry.server.tsx imports remoteBuildsEnabled from
# app/v3/remoteImageBuilder.server.ts, which imports @depot/sdk-node. It loads
# it from node_modules: Vite's SSR build keeps both packages external (neither
# is in its noExternal), and @depot/sdk-node 1.0.0, which has no exports and no
# type, is its CommonJS dist/index.js, which requires connect-node, whose
# "require" export is dist/cjs. So what changes at a start is that one require:
# it gives the module @remix-run/node and @ai-sdk/provider-utils link, one
# module by its real path, where it gave 5.29.0; and if it is the first undici
# to load, the global dispatcher is a 6.29.1 Agent where it was a 5.29.0 one.
# Which load comes first was not read: E2E (managed) runs the webapp.
#
# HOW UNDICI IS RELINKED, AND PROVED. The third RUN as root, after goose's.
# Before it changes anything it checks: connect-node, @depot/sdk-node, both
# undici and busboy are the releases read (each package.json's name and
# version), and @depot/sdk-node's link to connect-node is that directory;
# connect-node declares undici ^5.28.3 alone, and no file of it names undici
# but the two read; its link is pnpm's, ../../undici@5.29.0/node_modules/undici;
# pnpm's directory for undici 5.29.0 holds the package and a link to busboy,
# and busboy's the package alone; undici 6.29.1 declares no dependency, its
# directory holds the package alone, files and directories only, and it is the
# published 6.29.1 file for file (new_tree, the tree of npm's tarball, as the
# swap of 2026-11-03 to 2026-11-13 pinned it); walking the whole image, as
# cross-spawn's walk does, with a scoped package's directory named as pnpm
# names it, a plus for its slash, undici 5.29.0 is one copy with one link into
# it, connect-node's, and busboy 2.1.1 one copy linked by undici 5.29.0 and by
# pnpm's hoist where that is there; and no file of the webapp's own build
# (apps/webapp/build and public) carries undici:request:create, a string of
# undici's own code in both releases, so the copy relinked is the one the
# server loads. Then it points the link at
# ../../undici@6.29.1/node_modules/undici, with the old link's owner, and
# removes pnpm's two directories and the hoist where it is there. After: the
# link is the new one and resolves to undici 6.29.1; by the same walks nothing
# of undici 5.29.0 or busboy 2.1.1 is left; no other path of the image was
# added, removed or changed (owner, mode, size and times, as goose's RUN
# proves); from connect-node, require and import of undici give 6.29.1 and its
# Headers; from @depot/sdk-node, require and import of connect-node load; and
# from the webapp, @depot/sdk-node loads, with its createBuild, and the undici
# it loaded is 6.29.1's index.js. scripts/a-binary-the-stack-never-runs.unit.test.ts
# holds the RUN's shape and runs it over its stand-in.
#
# WHAT IS REPLACED: EFFECT 3.21.2 BY 3.22.4 (since 2026-11-21, for alpha.14;
# workplan 0166 T5, the owner's D2 that day: "yes"). Security Scan run
# 44878860013 (Trivy 0.76.2, linux/arm64) read CVE-2026-121707 (high, a ReDoS
# in Schema.TemplateLiteral, fixed in 3.22.1) in effect 3.21.2, the one copy
# of effect upstream's lockfile resolves at v4.8.8 (its override
# `effect@>=3 <3.20.0` to ^3.20.0, as at v4.8.5). Who requires it, at v4.8.8
# (pnpm-lock.yaml, and each requirer's package.json): the webapp itself
# (apps/webapp, "effect": "^3.21.2"), @trigger.dev/schema-to-json 4.8.8
# (packages/schema-to-json, "^3"), and @prisma/config 6.14.0 and 6.19.0,
# through the override. 3.22.4 is in every range the override and the two
# workspace packages give. It is not npm's newest 3.x: 3.22.5 was published
# on 2026-11-19 at 21:22 UTC, inside its three-day floor (CONTRIBUTING.md) on
# 2026-11-21. 3.22.4 was published on 2026-10-22 at 20:49 UTC, and this build
# swapped it in for effect 3.17.1 from 2026-11-06 until v4.8.5. Between the
# two tarballs, read 2026-11-21 by the integrity npm published for each: the
# same main, module, types and sideEffects, no type field, the same two
# dependencies (@standard-schema/spec ^1.0.0 and fast-check ^3.23.1, which
# the 1.1.0 and 3.23.2 pnpm linked for 3.21.2 meet), the same 179 exports,
# and 7 files more (internal/stackTraceLimit in cjs, esm, dts and src, with
# their maps) and none fewer. The server loads it: app/services/metadata/
# updateMetadata.server.ts imports it, and Vite's SSR build keeps
# node_modules external, so the code that runs is the new release's. Its mark
# is effect_internal_function, which effect's Utils carries in both releases
# and the RUN looks for in the webapp's own build, where a bundled copy would
# show.
#
# HOW IT IS SWAPPED, AND PROVED. The RUN after the undici relink is the swap
# table this build held until v4.8.5 (rows(), then five rows), with one row:
# the name, both versions, both trees (the SHA-256 of `sha256sum` over each
# release's files, sorted by path), the integrity npm published for 3.22.4,
# the mark, what to load, and who requires it (name@version). Before it
# fetches anything it checks the row: the directory is the published 3.21.2,
# file for file (pnpm's own node_modules in it aside); the packages that link
# it are the four above, found by the links themselves, in the store and in
# the workspace; no other package.json of effect 3.21.2 is in the image; and
# the webapp's build carries no effect_internal_function. It then fetches the
# tarball from the npm registry, refuses it unless its sha512 is npm's,
# unpacks it apart and checks it is the published 3.22.4, file for file, and
# only then swaps the directory. After, it proves the directory is 3.22.4,
# that no other path was added or removed and no other file changed (a stat
# of every entry outside it, before and after: owner, mode, size and times),
# that both dependencies load from it, and that from every requirer's own
# directory require.resolve lands in it and require loads it, on the image's
# Node. pnpm's records keep 3.21.2, as they kept the old versions before.
# A fetch that does not answer stops the build with nothing changed, as
# goose's does. THE WAY OUT: when upstream's lockfile resolves effect past
# 3.21.2, the first check stops the build by name ("is not there", or "is not
# 3.21.2"); then this RUN, this section and the guard's row go, and the scan
# reads what upstream ships.
#
# WHAT STAYS, and why (2026-11-03; read again at v4.8.5 on 2026-11-13, and at
# v4.8.8 on 2026-11-21, whose lockfile resolves turbo-stream 2.4.1 and
# deepmerge-ts 7.1.5 as v4.8.5's did;
# triggerdotdev/trigger.dev#5084 asks upstream for all of it). Expected at
# v4.8.5, by arithmetic from the scan of the image built for alpha.7 (Security
# Scan run 42440765278: 1 critical, 22 high, 14 with a fix): 1 critical, about
# 19 high and about 11 with a fix, the three that go being effect 3.16.12's and
# 3.18.4's and body-parser 2.3.0's (WHAT UPSTREAM NOW SHIPS FIXED). The
# branch's image scan measures it.
#   - zlib1g's critical (CVE-2023-45853) and 8 highs of Debian 12's packages,
#     none with a fix, which come with upstream's base: two more of zlib1g's,
#     and one each in gzip, libacl1, libtinfo6, ncurses-base, ncurses-bin and
#     perl-base (since 2026-11-08: THE DEBIAN PACKAGES NOTHING RUNS).
#   - goose's two, until 2026-11-13: Go's CVE-2026-111943 and CVE-2026-78661
#     in its golang.org/x/net. goose v3.30.1 is built past both (WHAT IS
#     REPLACED: GOOSE), so about 17 high and about 9 with a fix are expected
#     with it, which the branch's image scan measures.
#   - in the webapp's dependencies, where only a new major fixes them, or a
#     requirer pins the version exactly: turbo-stream 2.4.1 (fixed in 3; an
#     exact pin of @remix-run/react and server-runtime 2.17.5); and
#     deepmerge-ts 7.1.5 (fixed in 8; @prisma/config's).
# Until v4.8.5 effect 3.16.12 and 3.18.4 (CVE-2026-32887, exact pins of
# @prisma/config 6.14.0 and 6.19.0) and body-parser 2.3.0 (2.4.0 needs
# iconv-lite ^0.7.3, and pnpm linked 0.7.2 for it) stayed too. Until
# 2026-11-14 cross-spawn 5.1.0 (fixed in 6.0.6; spawndamnit's, under the
# root's @changesets/cli) stayed as well: this build removed it from then
# until v4.8.8, whose override takes 7.0.6 in its place (WHAT UPSTREAM NOW
# SHIPS FIXED). Until 2026-11-20 undici 5.29.0 (5 highs,
# @connectrpc/connect-node's; fixed in 6) and its @fastify/busboy 2.1.1 (1,
# fixed in 3) stayed too. The scan of main on 2026-11-19 read 1 critical, 19
# high and 8 with a fix (Security Scan run 44637576014; its 11 highs with no
# fix are Debian 12's: one more of zlib1g's, one each in gzip, libacl1,
# libtinfo6, ncurses-base, ncurses-bin and perl-base, and four in libpam's
# packages). Since connect-node runs the store's 6.29.1, both go (WHAT IS
# RELINKED: UNDICI): the branch's image scan read 1 critical, 13 high and 2
# with a fix, turbo-stream's and deepmerge-ts' (Security Scan run
# 44651070464).
#
# THE DEBIAN PACKAGES NOTHING RUNS (since 2026-11-06, for alpha.6; workplan
# 0119 §3 item 11, the owner's decision of 2026-11-03 for the appliance and the
# tasks' base, extended here under the owner's alpha.5 instruction of
# 2026-11-06, "put in most of what you can, like for hardening", and confirmed
# by the owner on 2026-11-07; libsystemd0 and libudev1 since 2026-11-08, for
# alpha.7, on the owner's answer that day, "Build the recommended for alpha
# 7.", where the recommendation for these two was yes). Upstream's runner
# stage is node:24.22.3-bookworm-slim since v4.8.5 (node:24.22.1-bookworm-slim
# before; both Debian 12.15) with openssl,
# netcat-openbsd and ca-certificates from apt. Security Scan run 42143936608
# (Trivy 0.76.1, linux/arm64, 2026-11-06) read this image at 1 critical, 49
# high and 16 with a fix. Of those:
#   - apt 2.6.1 and libapt-pkg6.0 2.6.1: CVE-2026-109518 (high, fixed in
#     2.6.2; an on-path attacker during an apt download), two of the 16;
#   - three highs with no fix in Debian in each of the eight packages
#     built from util-linux's source that this image has: util-linux,
#     util-linux-extra, mount, bsdutils, libblkid1, libmount1, libsmartcols1
#     and libuuid1 (24);
#   - one high with no fix in Debian in each of libsystemd0 and libudev1
#     252.39-1~deb12u2, systemd's two libraries (since 2026-11-08).
# The last RUN as root purges the first ten, and e2fsprogs 1.47.0-2+b2, which
# carries no finding of its own and pre-depends on libblkid1 and libuuid1:
# dpkg refused to purge those two while it stayed (images.yml's `build
# (trigger, amd64|arm64)`, 2026-11-06). So 1, 49 and 16 become about 1, 23
# and 14 (arithmetic from the report, which the branch's image scan measures).
# Since 2026-11-08 it purges libsystemd0 and libudev1 too: only apt,
# libapt-pkg6.0, util-linux and bsdutils depend on them in this base, all four
# on the list, so the thirteen go together and dpkg needs no other force; and
# 24 high become 22 (from the alpha.6 tag's 1, 24 and 14, above; measured by
# Security Scan run 42440765278).
# util-linux-extra goes with util-linux, which hard-depends on it in Debian 12
# (util-linux 2.38-1 made it "pseudo-Essential"; 2.39.1-2, after Debian 12,
# dropped the dependency), and libapt-pkg6.0 with apt, its one user here. Not
# on the list, though the appliance's has them: login, which in Debian 12 is
# shadow's, not util-linux's, and carries no finding, and libsqlite3-0, which
# Debian 13 brings for lastlog2 and the scan does not read here. e2fsprogs
# goes alone: its libraries (libext2fs2, libss2, libcom-err2) and logsave
# stay, and need only libc6 and libcom-err2. What libsystemd0 and libudev1
# depend on stays (libc6, libcap2, libgcrypt20, liblz4-1, liblzma5 and
# libzstd1): dpkg purges only what it is given. Debian 12.15's dpkg status
# (node:24.22.1-bookworm-slim, linux/arm64, read 2026-11-06, and on both
# platforms on 2026-11-08 by its layers' digests; node:24.22.3-bookworm-slim's,
# whose five layers are this image's first five at v4.8.5, read the same way
# on both platforms on 2026-11-13) has 88 packages installed, no other
# installed package that depends on one of the thirteen, and none that depends
# on e2fsprogs. At 24.22.3 the
# 88 are 24.22.1's, but for apt and libapt-pkg6.0 at 2.6.2 (2.6.1 before) and
# tzdata at 2026f (2026c before). libsystemd0 and
# libudev1 are Priority optional, neither Essential nor protected, and run no
# maintainer script, only ldconfig's trigger. The runner stage's own layer
# (openssl, netcat-openbsd, ca-certificates and their libraries, and `apt-get
# upgrade`) could not be read here, as below: dpkg's refusal reads it.
#
# WHY NOTHING RUNS THEM, read at read_at (below):
#   - What starts in trigger-api: managed.yml's `sh -c "chown -R node:node
#     /home/node/shared && exec ./scripts/entrypoint.sh"`. The entrypoint
#     (docker/scripts/entrypoint.sh, pinned by entrypoint_sha256) is /bin/sh,
#     dash, and runs pnpm (corepack's shim, on node), node, grep, goose, cp
#     and dumb-init; scripts/wait-for-it.sh only with DATABASE_HOST, which
#     managed.yml does not set (and it runs nc, cut and sleep); and run-ops'
#     migrations only with a RUN_OPS_* variable, which it sets none of. The
#     migrations are `prisma migrate deploy` (prisma's schema engine) and
#     `node migrate.mjs` (drizzle, in process). The healthcheck is `node -e`
#     fetch, and the bring-up execs `test` and `chown` into it.
#   - What the server spawns: in apps/webapp and the internal packages it
#     loads, the dashboard agent's repo tools run tar (with gzip, -z) and rg,
#     which neither the runner stage nor the lockfile installs
#     (internal-packages/dashboard-agent/src/repo-tools.ts). The other files
#     that import child_process, execa or tinyexec are tests, the CLI,
#     testcontainers, harnesses, dev scripts, run-ops' migrate.mjs (prisma),
#     core's v3/apps exec (the supervisor's) and the SDK's bash skill
#     (agentSkillsRuntime.ts), which the webapp never calls.
#   - None of those programs is apt's, util-linux's or e2fsprogs': dash,
#     coreutils (chown, test, cp, cut, sleep), grep, tar, gzip, netcat-openbsd,
#     dumb-init, node, goose. Nothing execs apt, apt-get, su, mount, getopt,
#     logger, more, mke2fs, e2fsck or any other program of the thirteen into
#     the container (nothing makes or checks a file system in it), and nothing
#     installs a package in it: a change is a rebuild. libsystemd0 and libudev1
#     have no program: they are libraries alone.
#   - What links libsystemd.so.0 and libudev.so.1, read 2026-11-08: in the
#     Node image's layers on both platforms (`readelf -d` of every ELF file,
#     694 on linux/arm64 and 695 on linux/amd64), only util-linux's findmnt,
#     lsblk and lslogins, bsdutils' logger, apt's http method and
#     libapt-pkg.so.6.0.0 need either, all six purged with their packages, and
#     no other ELF file but the two libraries themselves names either; node
#     24.22.1 there needs libdl, libstdc++, libm, libgcc_s, libpthread, libc
#     and ld-linux. The same holds in node:24.22.3-bookworm-slim, v4.8.5's
#     base, read by each ELF file's dynamic section on 2026-11-13 (694 and 695
#     ELF files again; on each platform 58 need one of the eight libraries
#     below, each a file of one of the thirteen; node 24.22.3 needs what
#     24.22.1 does). In the published files the next bullet reads, fetched
#     again by their publishers' hashes (goose's two assets, prisma's five
#     engines by the sha256 binaries.prisma.sh publishes, and sentry-cli's two
#     builds, bufferutil's linux-x64 prebuild and rollup's linux-x64-gnu and
#     linux-arm64-gnu addons by npm's sha512), none needs or names either.
#   - What links their libraries (libuuid.so.1, libblkid.so.1, libmount.so.1,
#     libsmartcols.so.1, libapt-pkg.so.6.0, libapt-private.so.0.0), read
#     2026-11-06 in the published files the image runs or carries, each by its
#     publisher's hash: node 24.22.1 (nodejs.org's linux-arm64 and linux-x64
#     builds, which the Node image unpacks) needs libdl, libstdc++, libm,
#     libgcc_s, libpthread and libc; goose v3.29.0's two release assets are
#     static, and v3.30.1's two, read on 2026-11-13, are too (no interpreter,
#     no dynamic section, and no byte that names one of the eight libraries);
#     prisma 6.14.0's engines (commit 717184b7, the query engine and
#     the schema engine for linux-arm64-openssl-3.0.x and debian-openssl-3.0.x,
#     and for debian-openssl-1.1.x, the schema's binaryTargets) need libgcc_s
#     and glibc, and the 3.0.x ones OpenSSL 3. The native code in the
#     production install, by upstream's pnpm-lock.yaml (every workspace
#     importer's dependencies and optional dependencies): sentry-cli 2.50.2
#     (static), bufferutil 4.0.9's linux-x64 prebuild (glibc alone) and rollup
#     4.60.1's linux-x64-gnu addon (libgcc_s and glibc), and depot's,
#     esbuild's and TypeScript 7's binaries, which go (WHAT GOES).
#     pnpm builds only what onlyBuiltDependencies names, and of that
#     cpu-features and ssh2 compile with node-gyp, for which the production
#     install has no compiler. No byte of any of those files names one of the
#     six. The build reads the image itself after the purge (below).
#
# HOW THEY ARE PURGED, AND PROVED. The last RUN as root, after every other
# change, as the appliance's purge (apps/selfhost/Dockerfile) and the tasks'
# (apps/worker/trigger.config.ts) do:
#   1. `dpkg-query -W` of exactly the thirteen, first: a package renamed or
#      gone stops the build before anything is purged (a list to read again,
#      not a name to skip).
#   2. `dpkg --audit` reads nothing in the image as upstream left it, and the
#      thirteen ship the eight libraries (`dpkg-query -L`), so the checks in 5
#      and 6 do not look for names nothing had.
#   3. `dpkg --purge --force-remove-essential --force-remove-protected`, the
#      two flags of the owner's decision, and no other force. Debian marks
#      util-linux and bsdutils Essential. Without --force-depends, dpkg refuses
#      to remove what an installed package still depends on, so a base where
#      one does stops the build. That is how e2fsprogs joined the list: this
#      base has it, and dpkg refused libblkid1 and libuuid1 for it. A package
#      that joins the base and depends on one of the thirteen stops the build
#      here the same way: no dependency is left dangling.
#   4. `dpkg --audit` reads nothing after, and dpkg reads each of the thirteen
#      as gone (no record, or not-installed).
#   5. No file of the eight is left under / (the image's own file system,
#      walked whole) by its name, the library or a link to it, wherever it is.
#      And no ELF file needs one: its DT_NEEDED entries, read from its program
#      headers and its dynamic section as the dynamic loader reads them, 32- or
#      64-bit, either byte order. An ELF file whose dynamic section cannot be
#      read counts as needing a library when it names it, since what an ELF
#      file needs is a string in it; and the check fails when it read no ELF
#      file that needs a library at all.
#   6. No ELF file under / names one of the eight, so nothing left links them
#      or opens them by name. 5 and 6 run in this RUN, as root, who can read
#      every directory, and nothing after it installs a package.
#   7. The programs this stack runs here start: grep, cp, tar, gzip and
#      dumb-init (--version), goose (-version) and node; pnpm and the
#      migrations are JavaScript on that node.
# The appliance's purge ends with `apt-get check`, which needs apt, and apt is
# on this list. So `dpkg --audit` takes its place, and its output is read,
# not its exit status: dpkg 1.22.6 exits 0 when it lists problems (2026-11-06,
# on a database made for it). The half of apt-get check a purge could break,
# a dependency left unmet, is dpkg's own refusal in 3.
# The risk accepted, as for the appliance: Debian does not test a system
# without its Essential packages; this one runs node. And trigger-api has no
# apt: nothing installs in it, and a fix is a rebuild.
# What is not shown here: the image's own files. They were not read for this
# (ghcr's layers could not be fetched), so the reading above is of upstream's
# source, lockfile and published binaries; images.yml's `build (trigger,
# amd64|arm64)` runs this RUN on the real image, where a wrong reading stops
# the build (dpkg's refusal, or a check above), and E2E (managed) runs what it
# built.
# scripts/an-essential-nothing-runs.unit.test.ts holds the list, the shape and
# these reasons; scripts/a-binary-the-stack-never-runs.unit.test.ts runs the
# RUN over its stand-in, with a stand-in dpkg.
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
# trigger-api. It is root, so this installs 10.34.9 in root's home, removes
# node's copy, and proves root's starts offline. A trigger-api without `user:
# root` would run node's copy, which is gone; managed.yml sets
# COREPACK_ENABLE_NETWORK: "0" on it, so corepack then refuses to start pnpm
# rather than fetch it, and an unscanned tar with it, from the npm registry at
# every start. The last RUN proves that refusal as node.
# scripts/a-binary-the-stack-never-runs.unit.test.ts fails when the
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
# and the copies of pnpm. A release that keeps @depot/cli 0.0.1-cli.2.80.0 at
# the same path (4.7.6 to 4.8.8 all do; esbuild 0.23.0 stayed from 4.7.6 to
# 4.8.5) would pass every path check here while code this stack reaches started
# to run one of them. So the build refuses any other version than read_at, and
# `trigger-version.sh pin` leaves read_at where it is: a version move's pull
# request is red (here, in `build (trigger, …)` and in E2E (managed)) until
# someone reads the reasons again at the new release and moves read_at, and
# entrypoint_sha256 with it when the entrypoint changed.
#
# IT FAILS LOUDLY WHEN UPSTREAM MOVES. Every path names a version. The build
# refuses unless the image's @trigger.dev/core is the TRIGGER_IMAGE_TAG it is
# given (when the .env sets one) and read_at, its entrypoint is the one read,
# its packageManager is pnpm@10.33.2 (the one the swap replaces, WHAT IS
# REPLACED: PNPM), and it runs on linux-arm64 or linux-x64; npm's and
# corepack's directories name no version, so their package.json must say
# 11.19.1 and 0.36.0, Node 24.22.3's at v4.8.5 and v4.8.8 as they were
# 24.22.1's. Each file is tested before a plain `rm`, never `rm -f`, and
# checked gone after. A Trigger.dev that moves @depot/cli, esbuild, TypeScript
# 7, pnpm or Node, or drops
# one, fails here and names the path: re-read this header against it, and
# drop the removal upstream fixed. The replacement names the version it replaces the same
# way (goose v3.27.1), and fails by name when upstream moves it: drop it
# (THE WAY OUT). The relink names connect-node 1.4.0, both undici releases
# and busboy 2.1.1 the same way, by path and by package.json, and stops the
# build on a tree that holds another of them (WHAT IS RELINKED: UNDICI). The
# purge names its thirteen packages and eight
# libraries the same way: `dpkg-query -W` stops the build on a base that
# renames or drops one, and `dpkg-query -L` on one that no longer ships a
# library (THE DEBIAN PACKAGES NOTHING RUNS). A pull request that touches
# deploy/ runs this on both platforms (images.yml, `build (trigger,
# amd64|arm64)`); the weekly image scan builds it on arm64 and counts what is
# left.
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
# triggerdotdev/trigger.dev#5084 (workplan 0146 T16). Its npm half shipped in
# v4.8.4: the overrides in upstream's root package.json fix dompurify and the
# five packages this build swapped, and at v4.8.5 their two RUNs went (WHAT
# UPSTREAM NOW SHIPS FIXED). When a `pin` to a release that fixed one of the
# rest fails its check, delete that removal and its row in the guard's
# REMOVED table. TypeScript 7's tsc goes
# out with its REMOVED row when upstream's lockfile no longer resolves
# typescript 7.0.2 (or drops the peer that brings it). cross-spawn 5.1.0 went
# out at v4.8.8, in both Dockerfiles, with its REMOVED rows and the guard's
# CROSS_SPAWN, when upstream's lockfile stopped resolving it (its override
# takes 7.0.6 for spawndamnit). The undici relink goes, its RUN
# with the guard's RELINK, when upstream's lockfile no longer resolves undici
# 5.29.0 for connect-node (a connect-node on undici 6 or later, or a
# @depot/sdk-node that takes none): its checks stop the build where
# connect-node, its link or either undici is not as read. To go back to
# 5.29.0 before that, revert the change that brought the RUN, and managed.yml's
# name with it (THE BASE AND THE NAME). When upstream's
# Dockerfile moves goose past v3.27.1, goose's RUN fails ("upstream moved
# goose: drop the replacement"): delete that RUN and goose's REPLACED row,
# and read the new goose's findings in the scan.
# When upstream's
# packageManager moves past pnpm@10.33.2, the first RUN fails, "upstream moved
# pnpm: drop the swap": delete the swap in both Dockerfiles (pm_upstream,
# pnpm_to and its sha512, `replaced`, the refusal of a copy already there, the
# install and the checks of the new copy's version and .corepack hash, in the
# supervisor node_corepack, the owner read, the chown and its check, and the
# rewrite and its read-back), point `kept` at the copy upstream then ships,
# read again for the three names, let the checks that no other copy is left
# name its version, and put the proofs back at upstream's version; and delete
# the guard's SWAP, with the tests and the stand-in corepack built on it. The
# purge goes when upstream's runner stage leaves Debian 12's apt and
# util-linux behind (a Debian release, or a base without them): its last RUN
# as root fails on the name it no longer finds, and that RUN goes with the
# guard's WEBAPP_PURGE (an-essential-nothing-runs), or its list is read again
# at the new base (0119 §3 item 11's revisit). When none is left, managed.yml
# runs ghcr's image again and this directory goes
# (docs/managed-bring-up.md, "Upgrading Trigger.dev"). This file is never
# `pin`ned backwards: its checks hold for read_at only, so going back to an
# older release means running the checkout that pinned it (a revert of the
# move, or the older release's tag), whose own Dockerfile and name come with it.
FROM ghcr.io/triggerdotdev/trigger.dev:v4.8.8@sha256:09b183fb83c006e24d8693b60c433459b053d9b607e694c0fd5d80a8b0e5dc69

# Given by managed.yml from the .env, empty when the .env sets none. It only refuses.
ARG TRIGGER_IMAGE_TAG

USER root

RUN set -eu; \
    me=deploy/compose/trigger.dev/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read this file's header against the new tag, or drop the removal upstream fixed." >&2; exit 1; }; \
    read_at=v4.8.8; \
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
    root_pkg=/triggerdotdev/package.json; \
    pm_upstream=pnpm@10.33.2; \
    pnpm_to=10.34.9; \
    pnpm_to_sha512=f49b5a8ea0fdedb44bb3c0c1d6575092a53c2950d95b7ad15df11f17974877a2de3a01c07e934e9b28ce716e51c09a94962c7306d09be2e1e4b18a8c8762fd32; \
    pm="$(node -p "require('$root_pkg').packageManager")"; \
    [ "$pm" = "$pm_upstream" ] || fail "the image names $pm, not $pm_upstream, so corepack keeps pnpm at other paths: upstream moved pnpm: drop the swap to pnpm $pnpm_to (THE WAY OUT)."; \
    plat="$(node -p 'process.platform + "-" + process.arch')"; \
    case "$plat" in linux-arm64|linux-x64) ;; *) fail "this is $plat; the paths below are known for linux-arm64 and linux-x64.";; esac; \
    s=/triggerdotdev/node_modules/.pnpm; \
    depot_bin="$s/@depot+cli-$plat@0.0.1-cli.2.80.0/node_modules/@depot/cli-$plat/bin/depot"; \
    depot_link="$s/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli/bin/depot"; \
    esbuild_bin="$s/@esbuild+$plat@0.28.2/node_modules/@esbuild/$plat/bin/esbuild"; \
    esbuild_link="$s/esbuild@0.28.2/node_modules/esbuild/bin/esbuild"; \
    tsc_bin="$s/@typescript+typescript-$plat@7.0.2/node_modules/@typescript/typescript-$plat/lib/tsc"; \
    case "$plat" in linux-arm64) tsc_sha256=f86e8070c267b12d6c119bf567cb82d8b245e9d93da1864bc7c603cea10a8b2f;; linux-x64) tsc_sha256=4f2de678286401759b3fb4475bafe35b8f32b4b3a07d92642bbf37eadc9b34a4;; esac; \
    typescript="$s/typescript@7.0.2/node_modules/typescript"; \
    prisma="$s/prisma@6.14.0_magicast@0.3.5_typescript@7.0.2/node_modules/prisma"; \
    unused=/home/node/.cache/node/corepack/v1/pnpm/10.33.2; \
    replaced=/root/.cache/node/corepack/v1/pnpm/10.33.2; \
    kept="/root/.cache/node/corepack/v1/pnpm/$pnpm_to"; \
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
    [ -f "$tsc_bin" ] || fail "$tsc_bin is not there."; \
    magic="$(head -c4 "$tsc_bin" | od -An -tx1 | tr -d ' \n')"; \
    [ "$magic" = 7f454c46 ] || fail "$tsc_bin is no ELF binary (it starts $magic)."; \
    stat -c '%h link(s), inode %i, %s bytes: %n' "$tsc_bin"; \
    [ "$(stat -c %h "$tsc_bin")" = 1 ] || fail "$tsc_bin has $(stat -c %h "$tsc_bin") names: a second name would keep the binary, and Trivy reads no hard link."; \
    [ "$(sha256sum "$tsc_bin" | cut -d' ' -f1)" = "$tsc_sha256" ] || fail "$tsc_bin is not TypeScript 7.0.2's tsc for $plat as npm published it (SHA-256 $tsc_sha256)."; \
    for d in "$typescript" "$prisma"; do [ -f "$d/package.json" ] || fail "$d is not there: typescript 7.0.2, or prisma 6.14.0 that requires it, is not where it was read."; done; \
    [ -f "$unused/.corepack" ] || fail "$unused/.corepack is not there: node's copy of pnpm is not where it was."; \
    [ -d "$unused/dist/node_modules/tar" ] || fail "$unused/dist/node_modules/tar is not there: node's copy of pnpm no longer carries tar."; \
    [ -f "$replaced/.corepack" ] || fail "$replaced/.corepack is not there: root's copy of pnpm $pm_upstream, which this file replaces with $pnpm_to, is not where it was."; \
    [ ! -e "$kept" ] || fail "$kept is there already: corepack would reuse it by its .corepack file alone, unchecked, so this file installs pnpm $pnpm_to only where no copy is."; \
    [ -f "$npm_dir/package.json" ] || fail "$npm_dir is not there: Node's npm is not where Node 24.22.3 puts it."; \
    [ "$(node -p "require('$npm_dir/package.json').version")" = 11.19.1 ] || fail "$npm_dir is not npm 11.19.1, Node 24.22.3's, which this file was read for."; \
    [ ! -e "$npm_dir/npmrc" ] || fail "$npm_dir/npmrc is there: pnpm reads it as its builtin configuration (@pnpm/npm-conf), so without npm pnpm would be configured otherwise."; \
    [ "$(readlink "$npm_link")" = ../lib/node_modules/npm/bin/npm-cli.js ] || fail "$npm_link is not Node's link to npm's bin/npm-cli.js."; \
    [ "$(readlink "$npx_link")" = ../lib/node_modules/npm/bin/npx-cli.js ] || fail "$npx_link is not Node's link to npm's bin/npx-cli.js."; \
    into="$(find /usr/local/bin -type l -exec sh -c 'for link; do case "$(readlink -f "$link")" in "$0"/*) echo "$link" ;; esac; done' "$(readlink -f "$npm_dir")" {} + | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$into" = "$npm_link $npx_link " ] || fail "these link into $npm_dir: ${into:-nothing}, not npm and npx alone."; \
    [ "$(node -p "require('$corepack_dir/package.json').version")" = 0.36.0 ] || fail "$corepack_dir is not corepack 0.36.0, Node 24.22.3's, which runs every pnpm here."; \
    corepack install -g "pnpm@$pnpm_to+sha512.$pnpm_to_sha512" || fail "corepack did not install pnpm $pnpm_to by the sha512 npm published for it; nothing is removed yet."; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack is not there after the install: corepack put pnpm $pnpm_to elsewhere."; \
    [ "$(node -p "require('$kept/package.json').version")" = "$pnpm_to" ] || fail "$kept is not pnpm $pnpm_to."; \
    [ "$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).hash" "$kept/.corepack")" = "sha512.$pnpm_to_sha512" ] || fail "$kept/.corepack does not record the sha512 npm published for pnpm $pnpm_to."; \
    [ -f "$kept_modules/node-gyp/bin/node-gyp.js" ] || fail "$kept_modules/node-gyp/bin/node-gyp.js is not there: root's copy of pnpm does not carry node-gyp where pnpm $pnpm_to did."; \
    [ -d "$kept_gyp_bin" ] || fail "$kept_gyp_bin is not there: root's copy of pnpm does not carry node-gyp's shim where pnpm $pnpm_to did."; \
    names="$(cd "$kept_modules" && for d in *; do case "$d" in @*) for p in "$d"/*; do printf '%s|' "$p"; done ;; *) printf '%s|' "$d" ;; esac; done | sed 's/[.]/\\./g')"; \
    named="$(find "$kept" -path "$kept_modules" -prune -o -type f -name '*js' -exec grep -HoE "(require(\.resolve)?\(|import\(|resolveFrom\([^,()]*, *)[\"'](${names%|})(/[^\"']*)?[\"']" {} + | tr -d "\"'" | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$named" = "$kept/bin/pnpm.cjs:require(v8-compile-cache $kept/dist/pnpm.cjs:require.resolve(picomatch $kept/dist/pnpm.cjs:resolveFrom(__dirname, node-gyp/bin/node-gyp " ] || fail "in $kept, outside $kept_modules, these name a package inside it: ${named:-none}; this file was read for three, each in a try: bin/pnpm.cjs's v8-compile-cache, and dist/pnpm.cjs's picomatch and node-gyp/bin/node-gyp."; \
    rm "$depot_bin" "$depot_link" "$esbuild_bin" "$esbuild_link" "$tsc_bin" "$npm_link" "$npx_link"; \
    rm -r "$unused" "$replaced" "$kept_modules" "$kept_gyp_bin" "$npm_dir"; \
    node -e "const fs = require('fs'); const [file, from, to] = process.argv.slice(1); const text = fs.readFileSync(file, 'utf8'); const field = /(\"packageManager\"[ \t]*:[ \t]*\")([^\"]*)(\")/g; const found = [...text.matchAll(field)].map((m) => m[2]); if (found.length !== 1 || found[0] !== from) { console.error(file + ' names packageManager as: ' + (found.join(', ') || 'nothing')); process.exit(1); } fs.writeFileSync(file, text.replace(field, (all, key, value, end) => key + to + end));" "$root_pkg" "$pm_upstream" "pnpm@$pnpm_to" || fail "$root_pkg's packageManager was not rewritten to pnpm@$pnpm_to: the file does not name it once, as $pm_upstream."; \
    pm="$(node -p "require('$root_pkg').packageManager")"; \
    [ "$pm" = "pnpm@$pnpm_to" ] || fail "$root_pkg names $pm after the rewrite, not pnpm@$pnpm_to: corepack would look for a copy this file removed."; \
    left="$(find "$s" -type f \( -name depot -o -name esbuild -o -name tsc -o -name tsgo \) -exec sh -c 'for f; do [ "$(head -c4 "$f" | od -An -tx1 | tr -d " \n")" != 7f454c46 ] || echo "$f"; done' sh {} +)"; \
    [ -z "$left" ] || fail "a depot, esbuild or tsc binary is still there: $left"; \
    for p in "$unused" "$replaced" "$kept_modules" "$kept_gyp_bin" "$npm_dir" "$npm_link" "$npx_link" "$tsc_bin"; do { [ ! -e "$p" ] && [ ! -L "$p" ]; } || fail "$p is still there."; done; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack went with the removal."; \
    pnpm_copies="$(find "${kept%/*}" -mindepth 1 -maxdepth 1 -exec basename {} \; | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$pnpm_copies" = "$pnpm_to " ] || fail "${kept%/*} holds ${pnpm_copies}and not pnpm $pnpm_to alone: a copy this file was not read for."; \
    pnpm_copies="$(find "${unused%/*}" -mindepth 1 -maxdepth 1 -exec basename {} \; | LC_ALL=C sort | tr '\n' ' ')"; \
    [ -z "$pnpm_copies" ] || fail "${unused%/*} still holds ${pnpm_copies}after the removals: a copy this file was not read for."; \
    [ "$(node -p "require('$corepack_dir/package.json').version")" = 0.36.0 ] || fail "corepack 0.36.0 went with npm."; \
    node -e "require('$s/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli'); require('$s/esbuild@0.28.2/node_modules/esbuild')" || fail "@depot/cli or esbuild no longer loads without its binary."; \
    for d in "$typescript" "$prisma"; do \
      (cd "$d" && node -e "const fs = require('fs'); const p = fs.realpathSync(require.resolve('typescript')); const v = require('typescript').version; console.log('require(typescript): ' + p + ' ' + v); if (p !== fs.realpathSync(process.argv[1] + '/lib/version.cjs') || v !== '7.0.2') process.exit(1);" "$typescript") || fail "from $d, require('typescript') does not give 7.0.2 from $typescript without its binary."; \
      (cd "$d" && node --input-type=module -e "import { realpathSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; const p = realpathSync(fileURLToPath(import.meta.resolve('typescript'))); const v = (await import('typescript')).default.version; console.log('import(typescript): ' + p + ' ' + v); if (p !== realpathSync(process.argv[1] + '/lib/version.cjs') || v !== '7.0.2') process.exit(1);" "$typescript") || fail "from $d, import('typescript') does not give 7.0.2 from $typescript without its binary."; \
    done; \
    [ "$(cd /triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --version)" = 10.34.9 ] || fail "as root, the user trigger-api runs as, pnpm 10.34.9 does not start offline."; \
    (cd /triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter @trigger.dev/database exec node -e 0) || fail "as root, pnpm without node-gyp's tree does not run a command in @trigger.dev/database offline, as the entrypoint's migrations need."; \
    echo "$me: removed both names of depot and esbuild, TypeScript 7.0.2's tsc, node's copy of pnpm, root's $pm_upstream for pnpm $pnpm_to (by the sha512 npm published, packageManager rewritten), node-gyp's tree from root's and npm; corepack 0.36.0 stays, and as root pnpm $pnpm_to starts and runs a workspace command offline."

# Still as root: goose v3.27.1 replaced by goose v3.30.1's release binary
# (WHAT IS REPLACED: GOOSE and HOW GOOSE IS REPLACED, above).
RUN set -eu; \
    me=deploy/compose/trigger.dev/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read the header's WHAT IS REPLACED: GOOSE against this image, or drop the replacement if upstream moved goose (THE WAY OUT)." >&2; exit 1; }; \
    unreachable() { echo "$me: $1 did not answer, or answered with an error (above); nothing was changed, and upstream did not move. Run the bring-up, or deploy-live.sh, with the same tag again once it answers: nothing here needs editing (docs/managed-bring-up.md, Upgrading Trigger.dev)." >&2; exit 1; }; \
    gone() { echo "$me: $1 is gone (above): its publisher no longer serves it; nothing was changed, and upstream did not move. This tag cannot be built again as pinned: docs/managed-bring-up.md, Upgrading Trigger.dev, says what to do." >&2; exit 1; }; \
    goose=/usr/local/bin/goose; \
    goose_from=v3.27.1; \
    goose_to=v3.30.1; \
    plat="$(node -p 'process.platform + "-" + process.arch')"; \
    case "$plat" in \
      linux-arm64) asset=goose_linux_arm64; goose_sha256=a34264b912b6da50b383ab9199cc78dba124d4f85ca1ae657eaa29a15d8bdc40;; \
      linux-x64) asset=goose_linux_x86_64; goose_sha256=18e32a18f6b49c45c2ea9ce75445c4d34a0a5f110d1a58e05e464d62a03b15e6;; \
      *) fail "this is $plat; goose $goose_to's release binaries are pinned for linux-arm64 and linux-x64.";; \
    esac; \
    url="https://github.com/pressly/goose/releases/download/$goose_to/$asset"; \
    top=/; \
    { [ -f "$goose" ] && [ ! -L "$goose" ]; } || fail "$goose is not a file."; \
    magic="$(head -c4 "$goose" | od -An -tx1 | tr -d ' \n')"; \
    [ "$magic" = 7f454c46 ] || fail "$goose is no ELF binary (it starts $magic)."; \
    [ "$(stat -c '%h %u:%g %a' "$goose")" = '1 0:0 755' ] || fail "$goose has $(stat -c '%h name(s), owner %u:%g, mode %a' "$goose"), not one name, root's, 0755, as upstream's builder stage leaves it."; \
    said="$("$goose" -version)" || fail "$goose -version does not run."; \
    [ "$said" = "goose version: $goose_from" ] || fail "$goose says '$said', not goose $goose_from: upstream moved goose: drop the replacement."; \
    tmp="$(mktemp -d)"; \
    state() { { find "$top" -xdev \( -path "$tmp" -o -path "$goose" \) -prune -o -type d -exec stat -c '%n %u:%g %a' {} + ; find "$top" -xdev \( -path "$tmp" -o -path "$goose" \) -prune -o ! -type d -exec stat -c '%n %u:%g %a %s %Y %Z' {} + ; } | LC_ALL=C sort | sha256sum | cut -d' ' -f1; }; \
    before="$(state)"; \
    delay=5; \
    for attempt in 1 2 3 4 5; do \
      node -e "fetch(process.argv[1]).then(async (r) => { if (!r.ok) { console.error(process.argv[1] + ' answered HTTP ' + r.status); process.exit(r.status === 404 || r.status === 410 ? 4 : 3); } require('fs').writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer())); }, (e) => { console.error(process.argv[1] + ': ' + (e.cause ? e.cause.message : e.message)); process.exit(3); })" "$url" "$tmp/goose" && st=0 || st=$?; \
      if [ "$st" != 3 ] || [ "$attempt" = 5 ]; then break; fi; \
      echo "$me: $url did not answer, or answered with an error (above), at fetch $attempt of 5; nothing was changed, and it is fetched again in $delay seconds." >&2; \
      sleep "$delay"; \
      delay=$((delay * 3)); \
    done; \
    case "$st" in 0) ;; 3) unreachable "$url" ;; 4) gone "$url" ;; *) fail "$url could not be fetched (node exits $st); nothing was changed." ;; esac; \
    got="$(sha256sum "$tmp/goose" | cut -d' ' -f1)"; \
    [ "$got" = "$goose_sha256" ] || fail "$url is $got, not $goose_sha256, goose $goose_to's $asset as its release published it; nothing was changed."; \
    chown 0:0 "$tmp/goose"; \
    chmod 0755 "$tmp/goose"; \
    said="$("$tmp/goose" -version)" || fail "goose $goose_to's $asset does not run here; nothing was changed."; \
    [ "$said" = "goose version: $goose_to" ] || fail "goose $goose_to's $asset says '$said'; nothing was changed."; \
    mv "$tmp/goose" "$goose"; \
    [ "$(sha256sum "$goose" | cut -d' ' -f1)" = "$goose_sha256" ] || fail "$goose is not goose $goose_to's $asset after the move."; \
    [ "$(stat -c '%h %u:%g %a' "$goose")" = '1 0:0 755' ] || fail "$goose has $(stat -c '%h name(s), owner %u:%g, mode %a' "$goose") after the move, not one name, root's, 0755: the entrypoint runs it, and Trivy reads no Go binary that is not executable."; \
    [ "$("$goose" -version)" = "goose version: $goose_to" ] || fail "$goose does not say goose $goose_to after the move."; \
    [ "$(state)" = "$before" ] || fail "outside $goose, a path was added or removed, or an entry's owner, mode, size or times changed, while it was replaced."; \
    rm -r "$tmp"; \
    echo "$me: goose $goose_from at $goose is goose $goose_to's $asset, by its SHA-256 ($goose_sha256), root's and 0755; nothing else in the image changed."

# Still as root, after goose's: connect-node's undici 5.29.0 relinked to the
# store's 6.29.1, and undici 5.29.0 and @fastify/busboy 2.1.1 removed with
# every link into them (WHAT IS RELINKED: UNDICI, and HOW UNDICI IS RELINKED,
# above).
RUN set -eu; \
    me=deploy/compose/trigger.dev/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read the header's WHAT IS RELINKED: UNDICI against this image, or drop the relink if upstream moved connect-node or undici (THE WAY OUT)." >&2; exit 1; }; \
    s=/triggerdotdev/node_modules/.pnpm; \
    connect_store="$s/@connectrpc+connect-node@1.4.0_@bufbuild+protobuf@1.10.0_@connectrpc+connect@1.4.0_@bufbuild+protobuf@1.10.0_"; \
    connect="$connect_store/node_modules/@connectrpc/connect-node"; \
    undici_link="$connect_store/node_modules/undici"; \
    undici_from=../../undici@5.29.0/node_modules/undici; \
    undici_to=../../undici@6.29.1/node_modules/undici; \
    old_store="$s/undici@5.29.0"; \
    old="$old_store/node_modules/undici"; \
    busboy_store="$s/@fastify+busboy@2.1.1"; \
    busboy="$busboy_store/node_modules/@fastify/busboy"; \
    busboy_link="$old_store/node_modules/@fastify/busboy"; \
    busboy_hoist="$s/node_modules/@fastify/busboy"; \
    new_store="$s/undici@6.29.1"; \
    new="$new_store/node_modules/undici"; \
    new_tree=5f8644a9bf69a2c6aac6cef3f750832a3ff2b7a1f0d6d55d105abc4456cba6fb; \
    sdk_store="$s/@depot+sdk-node@1.0.0"; \
    sdk="$sdk_store/node_modules/@depot/sdk-node"; \
    sdk_link="$sdk_store/node_modules/@connectrpc/connect-node"; \
    webapp=/triggerdotdev/apps/webapp; \
    top=/; \
    said() { node -p "const j = require(process.argv[1] + '/package.json'); j.name + '@' + j.version" "$1"; }; \
    declared() { node -p "JSON.stringify(require(process.argv[1] + '/package.json').dependencies || {})" "$1"; }; \
    files() { (cd "$1" && find . -path ./node_modules -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum); }; \
    tree() { files "$1" | sha256sum | cut -d' ' -f1; }; \
    state() { { find "$top" -xdev \( -path "$undici_link" -o -path "$old_store" -o -path "$busboy_store" -o -path "$busboy_hoist" \) -prune -o -type d -exec stat -c '%n %u:%g %a' {} + ; find "$top" -xdev \( -path "$undici_link" -o -path "$old_store" -o -path "$busboy_store" -o -path "$busboy_hoist" \) -prune -o ! -type d -exec stat -c '%n %u:%g %a %s %Y %Z' {} + ; } | LC_ALL=C sort | sha256sum | cut -d' ' -f1; }; \
    where="const fs = require('fs'); const path = require('path'); const [top, gone, name, version] = process.argv.slice(1); const dev = fs.statSync(top).dev; const real = fs.existsSync(gone) ? fs.realpathSync(gone) : gone; const into = (t) => [gone, real].some((g) => t === g || t.startsWith(g + '/')); const dir = name.replace('/', '+') + '@' + version; const quoted = JSON.stringify(name); let read = 0; const hits = []; const walk = (d) => { for (const e of fs.readdirSync(d)) { const p = path.join(d, e); const s = fs.lstatSync(p); if (s.isSymbolicLink()) { if (!into(p) && (into(path.resolve(d, fs.readlinkSync(p))) || (fs.existsSync(p) && into(fs.realpathSync(p))))) hits.push('link ' + p); continue; } if (s.isDirectory()) { if (e === dir || e.startsWith(dir + '_')) hits.push('directory ' + p); if (s.dev === dev) walk(p); continue; } if (e !== 'package.json' || !s.isFile()) continue; read++; const text = fs.readFileSync(p, 'utf8'); if (!text.includes(quoted)) continue; let j = null; try { j = JSON.parse(text); } catch { if (text.includes(JSON.stringify(version))) hits.push('unreadable ' + p); continue; } if (j !== null && typeof j === 'object' && j.name === name && j.version === version) hits.push('package ' + p); } }; walk(top); console.error(read + ' package.json files read under ' + top); if (read < 1) process.exit(2); console.log(hits.sort().map((h) => h + ' ').join(''));"; \
    for d in "$connect" "$sdk" "$old" "$busboy" "$new"; do [ -f "$d/package.json" ] || fail "$d is not there."; done; \
    [ "$(said "$connect")" = @connectrpc/connect-node@1.4.0 ] || fail "$connect is $(said "$connect"), not @connectrpc/connect-node@1.4.0, the release this file was read for."; \
    [ "$(said "$sdk")" = @depot/sdk-node@1.0.0 ] || fail "$sdk is $(said "$sdk"), not @depot/sdk-node@1.0.0, connect-node's one requirer as read."; \
    [ "$(said "$old")" = undici@5.29.0 ] || fail "$old is $(said "$old"), not undici@5.29.0, the release this file removes."; \
    [ "$(said "$busboy")" = @fastify/busboy@2.1.1 ] || fail "$busboy is $(said "$busboy"), not @fastify/busboy@2.1.1, the release this file removes."; \
    [ "$(said "$new")" = undici@6.29.1 ] || fail "$new is $(said "$new"), not undici@6.29.1, the release this file gives connect-node."; \
    { [ -L "$sdk_link" ] && [ "$(readlink -f "$sdk_link")" = "$(readlink -f "$connect")" ]; } || fail "$sdk_link is not pnpm's link to $connect: connect-node is not where its one requirer was read to find it."; \
    [ "$(declared "$connect")" = '{"undici":"^5.28.3"}' ] || fail "$connect declares $(declared "$connect"), not undici ^5.28.3 alone, as read."; \
    named="$(cd "$connect" && grep -rHoE --include='*.js' --include='*.cjs' --include='*.mjs' "(require\(|from |import\()[[:space:]]*[\"']undici(/[^\"']*)?[\"']" . | tr -d "\"'" | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$named" = "./dist/cjs/node-headers-polyfill.js:require(undici ./dist/esm/node-headers-polyfill.js:from undici " ] || fail "in $connect, these name undici: ${named:-none}; this file was read for two, each build's node-headers-polyfill.js, which uses undici's Headers only on Node before 18."; \
    { [ -L "$undici_link" ] && [ "$(readlink "$undici_link")" = "$undici_from" ]; } || fail "$undici_link is not pnpm's link to $undici_from: connect-node's undici is not where it was read."; \
    [ "$(readlink -f "$undici_link")" = "$(readlink -f "$old")" ] || fail "$undici_link does not resolve to $old."; \
    [ "$(cd "${undici_link%/*}" && readlink -f "$undici_to")" = "$(readlink -f "$new")" ] || fail "$undici_to, from ${undici_link%/*}, is not $new."; \
    [ "$(ls -A "$old_store")" = node_modules ] || fail "$old_store holds more than pnpm's node_modules: $(ls -A "$old_store" | tr '\n' ' ')"; \
    held="$(cd "$old_store/node_modules" && find . -mindepth 1 -maxdepth 2 ! -path './undici/*' | LC_ALL=C sort | tr '\n' ' ')"; \
    [ "$held" = "./@fastify ./@fastify/busboy ./undici " ] || fail "$old_store/node_modules holds: ${held:-nothing}; this file was read for undici 5.29.0 and pnpm's link to its one dependency, @fastify/busboy."; \
    [ "$(declared "$old")" = '{"@fastify/busboy":"^2.0.0"}' ] || fail "$old declares $(declared "$old"), not @fastify/busboy ^2.0.0 alone, as read."; \
    { [ ! -L "$old" ] && [ -L "$busboy_link" ] && [ "$(readlink -f "$busboy_link")" = "$(readlink -f "$busboy")" ]; } || fail "in $old_store, undici 5.29.0 is a link, or $busboy_link is not pnpm's link to $busboy."; \
    [ "$(ls -A "$busboy_store")" = node_modules ] || fail "$busboy_store holds more than pnpm's node_modules: $(ls -A "$busboy_store" | tr '\n' ' ')"; \
    held="$(cd "$busboy_store/node_modules" && find . -mindepth 1 -maxdepth 2 ! -path './@fastify/busboy/*' | LC_ALL=C sort | tr '\n' ' ')"; \
    { [ "$held" = "./@fastify ./@fastify/busboy " ] && [ ! -L "$busboy" ]; } || fail "$busboy_store/node_modules holds: ${held:-nothing}; this file was read for @fastify/busboy 2.1.1 alone, which has no dependency."; \
    [ "$(declared "$new")" = '{}' ] || fail "$new declares $(declared "$new"); undici 6.29.1 as npm published it declares none, and nothing is linked for it."; \
    held="$(cd "$new_store" && find . -mindepth 1 -maxdepth 2 ! -path './node_modules/undici/*' | LC_ALL=C sort | tr '\n' ' ')"; \
    { [ "$held" = "./node_modules ./node_modules/undici " ] && [ ! -L "$new" ]; } || fail "$new_store holds: ${held:-nothing}; this file was read for undici 6.29.1 alone, the package, in pnpm's node_modules."; \
    [ -z "$(find "$new" -path "$new/node_modules" -prune -o ! -type f ! -type d -print)" ] || fail "$new holds more than files and directories."; \
    [ "$(tree "$new")" = "$new_tree" ] || { files "$new" >&2; fail "$new is not the published undici 6.29.1, file for file (above)."; }; \
    want="directory $old_store link $undici_link package $old/package.json "; \
    found="$(node -e "$where" "$top" "$old_store" undici 5.29.0)" || fail "$top could not be read for undici 5.29.0 (above); nothing is changed yet."; \
    [ "$found" = "$want" ] || fail "under $top, undici 5.29.0 is: ${found:-nothing}; this file was read for one copy, $old, in $old_store, and one link into it, connect-node's, $undici_link (pnpm hoists undici 6.29.1 here)."; \
    want_hoist=""; if [ -L "$busboy_hoist" ]; then want_hoist="link $busboy_hoist "; fi; \
    want="directory $busboy_store ${want_hoist}link $busboy_link package $busboy/package.json "; \
    found="$(node -e "$where" "$top" "$busboy_store" @fastify/busboy 2.1.1)" || fail "$top could not be read for @fastify/busboy 2.1.1 (above); nothing is changed yet."; \
    [ "$found" = "$want" ] || fail "under $top, @fastify/busboy 2.1.1 is: ${found:-nothing}; this file was read for one copy, $busboy, in $busboy_store, linked by undici 5.29.0, $busboy_link, and by pnpm's hoist, $busboy_hoist, where it is there."; \
    for d in "$webapp/build" "$webapp/public"; do [ -d "$d" ] || fail "$d is not there: the webapp's build is not where it was read."; done; \
    found="$(grep -rlF -e undici:request:create "$webapp/build" "$webapp/public")" && st=0 || st=$?; \
    [ "$st" = 1 ] || fail "the webapp's own build carries undici's undici:request:create (grep exits $st): ${found:-}. A copy of undici bundled there is one this relink does not reach."; \
    before="$(state)"; \
    owner="$(stat -c %u:%g "$undici_link")"; \
    rm "$undici_link"; \
    ln -s "$undici_to" "$undici_link"; \
    chown -h "$owner" "$undici_link"; \
    rm -r "$old_store" "$busboy_store"; \
    if [ -L "$busboy_hoist" ]; then rm "$busboy_hoist"; fi; \
    { [ -L "$undici_link" ] && [ "$(readlink "$undici_link")" = "$undici_to" ]; } || fail "$undici_link is not a link to $undici_to after the relink."; \
    [ "$(readlink -f "$undici_link")" = "$(readlink -f "$new")" ] || fail "$undici_link does not resolve to $new after the relink."; \
    [ "$(stat -c %u:%g "$undici_link")" = "$owner" ] || fail "$undici_link is $(stat -c %u:%g "$undici_link")'s after the relink, not $owner's, as pnpm's link was."; \
    for p in "$old_store" "$busboy_store" "$busboy_hoist"; do { [ ! -e "$p" ] && [ ! -L "$p" ]; } || fail "$p is still there."; done; \
    found="$(node -e "$where" "$top" "$old_store" undici 5.29.0)" || fail "$top could not be read for undici 5.29.0 after the removal (above)."; \
    [ -z "$found" ] || fail "after the removal, undici 5.29.0 is still under $top: $found"; \
    found="$(node -e "$where" "$top" "$busboy_store" @fastify/busboy 2.1.1)" || fail "$top could not be read for @fastify/busboy 2.1.1 after the removal (above)."; \
    [ -z "$found" ] || fail "after the removal, @fastify/busboy 2.1.1 is still under $top: $found"; \
    [ "$(state)" = "$before" ] || fail "outside connect-node's undici link and what went with undici 5.29.0, a path was added or removed, or an entry's owner, mode, size or times changed, while it was relinked."; \
    (cd "$connect" && node -e "const fs = require('fs'); const p = fs.realpathSync(require.resolve('undici')); const v = require('undici/package.json').version; const h = typeof require('undici').Headers; console.log('require(undici): ' + p + ' ' + v + ', Headers ' + h); if (p !== fs.realpathSync(process.argv[1] + '/index.js') || v !== '6.29.1' || h !== 'function') process.exit(1);" "$new") || fail "from $connect, require('undici') does not load undici 6.29.1 and its Headers from $new."; \
    (cd "$connect" && node --input-type=module -e "import { realpathSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; const p = realpathSync(fileURLToPath(import.meta.resolve('undici'))); const { Headers } = await import('undici'); console.log('import(undici): ' + p + ', Headers ' + typeof Headers); if (p !== realpathSync(process.argv[1] + '/index.js') || typeof Headers !== 'function') process.exit(1);" "$new") || fail "from $connect, import('undici') does not give undici 6.29.1's Headers by name from $new."; \
    (cd "$sdk" && node -e "if (typeof require('@connectrpc/connect-node').createConnectTransport !== 'function') process.exit(1);") || fail "from $sdk, require('@connectrpc/connect-node') does not load with undici 6.29.1."; \
    (cd "$sdk" && node --input-type=module -e "if (typeof (await import('@connectrpc/connect-node')).createConnectTransport !== 'function') process.exit(1);") || fail "from $sdk, import('@connectrpc/connect-node') does not load with undici 6.29.1: its dist/esm imports Headers from undici by name."; \
    (cd "$webapp" && node -e "const fs = require('fs'); const [sdk, nu] = process.argv.slice(1); const at = fs.realpathSync(require.resolve('@depot/sdk-node')); const { depot } = require('@depot/sdk-node'); const undici = fs.realpathSync(nu + '/index.js'); console.log('require(@depot/sdk-node): ' + at + '; undici: ' + (require.cache[undici] ? undici : 'not ' + undici)); if (!at.startsWith(fs.realpathSync(sdk) + '/') || typeof depot.build.v1.BuildService.createBuild !== 'function' || !require.cache[undici]) process.exit(1);" "$sdk" "$new") || fail "from $webapp, @depot/sdk-node does not load connect-node with undici 6.29.1 from $new."; \
    echo "$me: connect-node 1.4.0 links undici 6.29.1, the store's, as npm published it ($new_tree); undici 5.29.0 and @fastify/busboy 2.1.1 went with every link into them; nothing else in the image changed; from the webapp, @depot/sdk-node loads connect-node with undici 6.29.1."

# Still as root, after the relink: effect 3.21.2 replaced by 3.22.4, the release
# of the same major that fixes CVE-2026-121707, as npm published it (WHAT IS
# REPLACED: EFFECT and HOW IT IS SWAPPED, AND PROVED, above).
RUN set -eu; \
    me=deploy/compose/trigger.dev/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read the header's WHAT IS REPLACED: EFFECT against this image, or drop the row of a package upstream moved (THE WAY OUT)." >&2; exit 1; }; \
    unreachable() { echo "$me: $1 did not answer, or answered with an error (above); nothing was changed, and upstream did not move. Run the bring-up, or deploy-live.sh, with the same tag again once it answers: nothing here needs editing (docs/managed-bring-up.md, Upgrading Trigger.dev)." >&2; exit 1; }; \
    gone() { echo "$me: $1 is gone (above): its publisher no longer serves it; nothing was changed, and upstream did not move. This tag cannot be built again as pinned: docs/managed-bring-up.md, Upgrading Trigger.dev, says what to do." >&2; exit 1; }; \
    s=/triggerdotdev/node_modules/.pnpm; \
    bundles="/triggerdotdev/apps/webapp/build /triggerdotdev/apps/webapp/public"; \
    top=/; \
    rows() { \
      "$@" effect 3.21.2 da670361dc0dcb2c7b3841982c4adce69b152d3a33abb9325f3243cc89f2c954 3.22.4 b7d6b7cbae9262a2e258136292e231646ba675df4e965dd38136cd266d8ac9af sha512-RNshu7AXVxxDh6aS4lothhJ+QoZ4xSykbWNaaVdvDN72RMyVwhCGdALkyl1TbEydgAmRIdD1eTyJqBUGwSBGDA== 'effect_internal_function' effect @prisma/config@6.14.0 @prisma/config@6.19.0 @trigger.dev/schema-to-json@4.8.8 webapp@1.0.0; \
    }; \
    version() { node -p "require(process.argv[1] + '/package.json').version" "$1"; }; \
    files() { (cd "$1" && find . -path ./node_modules -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum); }; \
    own() { if [ -d "$1/node_modules" ]; then (cd "$1/node_modules" && find . ! -type d -exec sha256sum {} + | LC_ALL=C sort); fi; }; \
    tree() { files "$1" | sha256sum | cut -d' ' -f1; }; \
    state() { { find "$top" -xdev \( $prune \) -prune -o -type d -exec stat -c '%n %u:%g %a' {} + ; find "$top" -xdev \( $prune \) -prune -o ! -type d -exec stat -c '%n %u:%g %a %s %Y %Z' {} + ; } | LC_ALL=C sort | sha256sum | cut -d' ' -f1; }; \
    who="const fs = require('fs'); const path = require('path'); const [s, pkg, name] = process.argv.slice(1); const real = fs.realpathSync(pkg); const out = []; for (const d of fs.readdirSync(s)) { if (d === 'node_modules') continue; const nm = path.join(s, d, 'node_modules'); let st; try { st = fs.lstatSync(path.join(nm, name)); } catch { continue; } if (!st.isSymbolicLink() || fs.realpathSync(path.join(nm, name)) !== real) continue; const own = []; for (const e of fs.readdirSync(nm)) { for (const x of e.startsWith('@') ? fs.readdirSync(path.join(nm, e)).map((y) => e + '/' + y) : [e]) { const p = path.join(nm, x); if (!fs.lstatSync(p).isSymbolicLink() && fs.existsSync(path.join(p, 'package.json'))) own.push(p); } } if (own.length !== 1) { out.push('unknown ' + nm); continue; } const j = JSON.parse(fs.readFileSync(path.join(own[0], 'package.json'), 'utf8')); out.push(j.name + '@' + j.version + ' ' + own[0]); } const walk = (d) => { const l = path.join(d, 'node_modules', name); let st; try { st = fs.lstatSync(l); } catch { st = null; } if (st && st.isSymbolicLink() && fs.realpathSync(l) === real) { const j = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')); out.push(j.name + '@' + j.version + ' ' + d); } for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && e.name !== 'node_modules') walk(path.join(d, e.name)); }; walk(path.dirname(path.dirname(s))); if (out.length) console.log(out.sort().join('\n'));"; \
    same="const fs = require('fs'); const [n, v, ...files] = process.argv.slice(1); for (const f of files) { let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { console.log('unreadable:' + f); continue; } if (j.name === n && j.version === v) console.log(f); }"; \
    deps="const fs = require('fs'); const path = require('path'); const real = fs.realpathSync(process.argv[1]); const j = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8')); for (const d of Object.keys(j.dependencies || {})) { const p = fs.realpathSync(require.resolve(d, { paths: [real] })); require(p); console.log('dependency ' + d + ': ' + p); }"; \
    load="const fs = require('fs'); const path = require('path'); const [pkg, name, to, list] = process.argv.slice(1); const specs = list.split(','); const real = fs.realpathSync(pkg); const pj = fs.realpathSync(require.resolve(name + '/package.json')); const v = require(name + '/package.json').version; if (pj !== path.join(real, 'package.json') || v !== to) { console.error('require(' + name + '/package.json) is ' + pj + ' ' + v); process.exit(1); } for (const sp of specs) { const p = fs.realpathSync(require.resolve(sp)); if (!p.startsWith(real + path.sep)) { console.error('require(' + sp + ') resolves ' + p); process.exit(1); } const m = require(sp); for (const k of Object.keys(m)) void m[k]; console.log('require(' + sp + '): ' + p + ' ' + v); }"; \
    check() { \
      name=$1; from=$2; from_tree=$3; mark=$7; shift 8; pkg="$s/$name@$from/node_modules/$name"; \
      [ -f "$pkg/package.json" ] || fail "$pkg is not there."; \
      [ "$(version "$pkg")" = "$from" ] || fail "$pkg is $name $(version "$pkg"), not $from."; \
      [ -z "$(find "$pkg" -path "$pkg/node_modules" -prune -o ! -type f ! -type d -print)" ] || fail "$pkg holds more than files and directories (pnpm's own node_modules in it aside)."; \
      [ "$(tree "$pkg")" = "$from_tree" ] || { files "$pkg" >&2; fail "$pkg is not the published $name $from, file for file (above)."; }; \
      found="$(node -e "$who" "$s" "$pkg" "$name")" || fail "the packages that link $pkg could not be read."; \
      [ "$(printf '%s\n' "$found" | cut -d' ' -f1 | LC_ALL=C sort -u | tr '\n' ' ')" = "$(printf '%s\n' "$@" | LC_ALL=C sort -u | tr '\n' ' ')" ] || fail "$name $from is linked from: ${found:-nothing}; this file was read for $*."; \
      if [ -L "$s/node_modules/$name" ] && [ "$(readlink -f "$s/node_modules/$name")" = "$(readlink -f "$pkg")" ]; then echo "$me: pnpm hoists $name $from too: $s/node_modules/$name"; fi; \
      copies="$(find "$top" -xdev -type f -path "*/$name/package.json" -exec node -e "$same" "$name" "$from" {} +)" || fail "the copies of $name could not be read."; \
      [ "$copies" = "$pkg/package.json" ] || fail "$name $from's package.json is at: ${copies:-nowhere}; this file replaces $pkg alone (other versions of $name stay)."; \
      found="$(grep -rlF -e "$mark" $bundles)" && st=0 || st=$?; \
      [ "$st" = 1 ] || fail "the webapp's own build carries $name's $mark (grep exits $st): ${found:-}. A copy bundled there is not the package this replaces."; \
    }; \
    pruned() { prune="$prune -o -path $s/$1@$2/node_modules/$1"; }; \
    fetched() { \
      name=$1; from=$2; to=$4; to_tree=$5; want=$6; pkg="$s/$name@$from/node_modules/$name"; url="https://registry.npmjs.org/$name/-/$name-$to.tgz"; \
      node -e "fetch(process.argv[1]).then(async (r) => { if (!r.ok) { console.error(process.argv[1] + ' answered HTTP ' + r.status); process.exit(r.status === 404 || r.status === 410 ? 4 : 3); } require('fs').writeFileSync(process.argv[2], Buffer.from(await r.arrayBuffer())); }, (e) => { console.error(process.argv[1] + ': ' + (e.cause ? e.cause.message : e.message)); process.exit(3); })" "$url" "$tmp/$name.tgz" && st=0 || st=$?; \
      case "$st" in 0) ;; 3) unreachable "$url" ;; 4) gone "$url" ;; *) fail "$url could not be fetched (node exits $st); nothing was changed." ;; esac; \
      got="$(node -p "'sha512-' + require('crypto').createHash('sha512').update(require('fs').readFileSync(process.argv[1])).digest('base64')" "$tmp/$name.tgz")"; \
      [ "$got" = "$want" ] || fail "$url is $got, not $want, the integrity npm published for $name $to; nothing was changed."; \
      mkdir "$tmp/$name"; \
      tar -xzf "$tmp/$name.tgz" -C "$tmp/$name" --no-same-owner || fail "$url does not unpack; nothing was changed."; \
      new="$tmp/$name/package"; \
      [ "$(version "$new")" = "$to" ] || fail "$url unpacks to $name $(version "$new"), not $to; nothing was changed."; \
      [ ! -e "$new/node_modules" ] || fail "$url unpacks a node_modules of its own; nothing was changed."; \
      { [ -z "$(find "$new" ! -type f ! -type d)" ] && [ "$(tree "$new")" = "$to_tree" ]; } || { files "$new" >&2; fail "$url unpacks to other files than the published $name $to (above); nothing was changed."; }; \
      chown -R "$(stat -c %u:%g "$pkg/package.json")" "$new"; \
      own "$pkg" > "$tmp/$name.own"; \
    }; \
    swapped() { if [ -e "$s/$1@$2/node_modules/$1/node_modules" ]; then mv "$s/$1@$2/node_modules/$1/node_modules" "$tmp/$1/package/node_modules" || fail "pnpm's node_modules in $s/$1@$2/node_modules/$1 could not be moved to the new release."; fi; rm -r "$s/$1@$2/node_modules/$1" || fail "$s/$1@$2/node_modules/$1 could not be removed."; mv "$tmp/$1/package" "$s/$1@$2/node_modules/$1" || fail "the new $1 could not be moved to $s/$1@$2/node_modules/$1."; }; \
    proven() { \
      name=$1; from=$2; to=$4; to_tree=$5; pkg="$s/$name@$from/node_modules/$name"; \
      { [ "$(version "$pkg")" = "$to" ] && [ "$(tree "$pkg")" = "$to_tree" ]; } || fail "$pkg is not the published $name $to after the swap."; \
      [ "$(own "$pkg")" = "$(cat "$tmp/$name.own")" ] || fail "$pkg/node_modules, pnpm's own (a bin shim), is not what it was before the swap."; \
    }; \
    loaded() { \
      name=$1; from=$2; to=$4; specs=$8; pkg="$s/$name@$from/node_modules/$name"; \
      node -e "$deps" "$pkg" || fail "a dependency $name $to declares does not load from $pkg."; \
      found="$(node -e "$who" "$s" "$pkg" "$name")" || fail "the packages that link $pkg could not be read."; \
      [ -n "$found" ] || fail "nothing links $pkg after the swap."; \
      for r in $(printf '%s\n' "$found" | cut -d' ' -f2); do \
        (cd "$r" && node -e "$load" "$pkg" "$name" "$to" "$specs") || fail "from $r, $name does not load $to from $pkg."; \
      done; \
    }; \
    for d in $bundles; do [ -d "$d" ] || fail "$d is not there: the build is not where it was read."; done; \
    rows check; \
    tmp="$(mktemp -d)"; \
    prune="-path $tmp"; \
    rows pruned; \
    before="$(state)"; \
    rows fetched; \
    rows swapped; \
    rows proven; \
    [ "$(state)" = "$before" ] || fail "outside the swapped directories, a path was added or removed, or an entry's owner, mode, size or times changed, while they were replaced."; \
    rm -r "$tmp"; \
    rows loaded; \
    echo "$me: effect 3.21.2 is 3.22.4, as npm published it; nothing else in the image changed; from every requirer, require loads 3.22.4."

# Still as root, and the last of root's RUNs: the Debian packages nothing here
# runs or loads, purged (THE DEBIAN PACKAGES NOTHING RUNS, above).
RUN set -eu; \
    me=deploy/compose/trigger.dev/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read the header's THE DEBIAN PACKAGES NOTHING RUNS against this image; a package leaves the list, or joins it, only with its reason." >&2; exit 1; }; \
    purge="util-linux util-linux-extra mount bsdutils libblkid1 libmount1 libsmartcols1 libuuid1 apt libapt-pkg6.0 e2fsprogs libsystemd0 libudev1"; \
    libraries="libuuid.so.1 libblkid.so.1 libmount.so.1 libsmartcols.so.1 libapt-pkg.so.6.0 libapt-private.so.0.0 libsystemd.so.0 libudev.so.1"; \
    top=/; \
    needs="const fs = require('fs'); const path = require('path'); const [top, ...names] = process.argv.slice(1); const dev = fs.statSync(top).dev; const head = Buffer.alloc(4); let read = 0, dyn = 0, unread = 0; const hits = []; const needed = (b) => { const c = b[4], o = b[5]; if ((c !== 1 && c !== 2) || (o !== 1 && o !== 2)) throw new Error('class'); const w = c === 2 ? 8 : 4, le = o === 1; const u16 = (at) => (le ? b.readUInt16LE(at) : b.readUInt16BE(at)); const u32 = (at) => (le ? b.readUInt32LE(at) : b.readUInt32BE(at)); const word = (at) => (w === 8 ? Number(le ? b.readBigUInt64LE(at) : b.readBigUInt64BE(at)) : u32(at)); const phoff = word(w === 8 ? 32 : 28), phsz = u16(w === 8 ? 54 : 42), phnum = u16(w === 8 ? 56 : 44); const load = []; let dynamic = null; for (let k = 0; k < phnum; k++) { const p = phoff + k * phsz, t = u32(p); const f = w === 8 ? [word(p + 8), word(p + 16), word(p + 32)] : [word(p + 4), word(p + 8), word(p + 16)]; if (t === 1) load.push(f); if (t === 2) dynamic = f; } if (!dynamic) return []; let str = null; const need = []; for (let p = dynamic[0]; p + 2 * w <= dynamic[0] + dynamic[2]; p += 2 * w) { const t = word(p), v = word(p + w); if (t === 0) break; if (t === 1) need.push(v); if (t === 5) str = v; } if (!need.length) return []; const seg = str === null ? undefined : load.find((s) => str >= s[1] && str < s[1] + s[2]); if (!seg) throw new Error('strtab'); const at = str - seg[1] + seg[0]; return need.map((v) => { const s = at + v, e = s < b.length ? b.indexOf(0, s) : -1; if (e < 0) throw new Error('name'); return b.toString('latin1', s, e); }); }; const walk = (d) => { for (const e of fs.readdirSync(d)) { const p = path.join(d, e); const s = fs.lstatSync(p); if (s.isDirectory()) { if (s.dev === dev) walk(p); continue; } for (const n of names) if (e === n || e.startsWith(n + '.')) hits.push(p + ': a file of ' + n + ' is left'); if (!s.isFile() || s.size < 4) continue; const fd = fs.openSync(p, 'r'); try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); } if (head.readUInt32BE(0) !== 0x7f454c46) continue; read++; const b = fs.readFileSync(p); let need; try { need = needed(b); } catch { unread++; for (const n of names) if (b.includes(n)) hits.push(p + ': names ' + n + ', and its dynamic section cannot be read'); continue; } if (need.length) dyn++; for (const n of names) if (need.includes(n)) hits.push(p + ': needs ' + n); } }; walk(top); console.error(read + ' ELF files read under ' + top + ', ' + dyn + ' of them needing a library, ' + unread + ' whose dynamic section could not be read'); if (dyn === 0) process.exit(2); if (hits.length) { console.log(hits.join(' ')); process.exit(1); }"; \
    elves="const fs = require('fs'); const path = require('path'); const [top, ...names] = process.argv.slice(1); const dev = fs.statSync(top).dev; const head = Buffer.alloc(4); let read = 0; const hits = []; const walk = (d) => { for (const e of fs.readdirSync(d)) { const p = path.join(d, e); const s = fs.lstatSync(p); if (s.isDirectory()) { if (s.dev === dev) walk(p); continue; } if (!s.isFile() || s.size < 4) continue; const fd = fs.openSync(p, 'r'); try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); } if (head.readUInt32BE(0) !== 0x7f454c46) continue; read++; const b = fs.readFileSync(p); for (const n of names) if (b.includes(n)) hits.push(p + ': ' + n); } }; walk(top); console.error(read + ' ELF files read under ' + top); if (read === 0) process.exit(2); if (hits.length) { console.log(hits.join(' ')); process.exit(1); }"; \
    dpkg-query -W $purge || fail "dpkg-query does not find every one of: $purge (above). A package renamed or gone is a list to read again, not a name to skip; nothing was purged."; \
    audit="$(dpkg --audit)" || fail "dpkg --audit did not run; nothing was purged."; \
    [ -z "$audit" ] || fail "dpkg --audit reads problems in the image as upstream left it, before anything was purged: $audit"; \
    listed="$(dpkg-query -L $purge)" || fail "dpkg-query -L does not list the files of: $purge; nothing was purged."; \
    for l in $libraries; do case "$listed" in *"/$l"*) ;; *) fail "none of $purge ships $l, which this file was read for, so the scan after the purge would look for a name nothing had; nothing was purged." ;; esac; done; \
    dpkg --purge --force-remove-essential --force-remove-protected $purge || fail "dpkg did not purge every one of: $purge (above). Without --force-depends it refuses to remove what an installed package depends on: read the package it names, then take the one it would break off the list or put the one that depends on it on it, each with its reason; this image was not built."; \
    audit="$(dpkg --audit)" || fail "dpkg --audit did not run after the purge."; \
    [ -z "$audit" ] || fail "after the purge, dpkg --audit reads: $audit"; \
    for p in $purge; do st="$(dpkg-query -W -f '${db:Status-Status}' "$p" 2>/dev/null)" && rc=0 || rc=$?; case "$rc:$st" in 1:|0:not-installed) ;; *) fail "after the purge, dpkg reads $p as '$st' (dpkg-query exits $rc), not gone." ;; esac; done; \
    left="$(node -e "$needs" "$top" $libraries)" && st=0 || st=$?; \
    [ "$st" = 0 ] || fail "after the purge, a file of a library it removed is left, or an ELF file needs one (DT_NEEDED), or the check read no ELF file that needs a library at all (node exits $st): ${left:-none named}"; \
    found="$(node -e "$elves" "$top" $libraries)" && st=0 || st=$?; \
    [ "$st" = 0 ] || fail "after the purge, an ELF file names a library it removed, or the scan read none (node exits $st): ${found:-none named}"; \
    for c in grep cp tar gzip dumb-init; do "$c" --version >/dev/null 2>&1 || fail "$c, which this stack runs here, does not start after the purge."; done; \
    /usr/local/bin/goose -version >/dev/null || fail "goose does not start after the purge, and the entrypoint runs it at every start."; \
    node -e 0 || fail "node does not start after the purge, and every pnpm, migration and the server run on it."; \
    echo "$me: purged $purge; dpkg's audit reads nothing, no file of $libraries is left and no ELF file needs or names one, and grep, cp, tar, gzip, dumb-init, goose and node start."

# Upstream's own user, which this image keeps.
USER node

# As node, the copy is gone, and corepack refuses rather than fetching pnpm.
RUN set -eu; \
    me=deploy/compose/trigger.dev/Dockerfile; \
    if (cd /triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --version) >/dev/null 2>&1; then \
      echo "$me: as node, pnpm still starts offline, so a copy of pnpm 10.34.9 is in node's home, or corepack reads another home. Re-read the user coupling in this file's header against managed.yml." >&2; \
      exit 1; \
    fi; \
    echo "$me: as node, pnpm does not start offline, as it should not: trigger-api runs as root."
