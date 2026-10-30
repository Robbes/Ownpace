# Trigger.dev's webapp as upstream publishes it, by tag and index digest, with
# files deleted that no process of this stack ever runs (workplan 0146 T16; the
# owner's decisions of 2026-10-26, "Both": an issue upstream, and this build
# until upstream ships the fixes, and of 2026-10-27: tar out of the copy of
# pnpm that runs, too).
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
# Two stay: zlib1g (CVE-2023-45853, no fix in Debian) and dompurify 3.4.13
# (GHSA-cg2g-xh64-v4q7, which mermaid loads, and the dashboard may run). So 8
# become 2. The binaries are the same Go builds on amd64.
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
#     The build checks node-gyp's install.js is still the one file that
#     requires tar, and proves as root that pnpm runs a command in
#     @trigger.dev/database's package offline, as the migrations do.
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
# its packageManager is pnpm@10.33.2, and it runs on linux-arm64 or linux-x64.
# Each file is tested before a plain `rm`, never `rm -f`, and checked gone
# after. A Trigger.dev that moves @depot/cli, esbuild or pnpm, or drops one,
# fails here and names the path: re-read this header against it, and drop the
# removal upstream fixed. A pull request that touches deploy/ runs this on both
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
# THE WAY OUT. The issue that asks upstream for these fixes is filed by the
# owner (workplan 0146 T16); its address goes here once it exists. When a `pin`
# to a release that fixed one of these fails its check, delete that removal and
# its row in the guard's REMOVED table. When none is left, managed.yml runs
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
    kept_tar="$kept/dist/node_modules/tar"; \
    for f in "$depot_bin" "$depot_link" "$esbuild_bin" "$esbuild_link"; do \
      [ -f "$f" ] || fail "$f is not there."; \
      magic="$(head -c4 "$f" | od -An -tx1 | tr -d ' \n')"; \
      [ "$magic" = 7f454c46 ] || fail "$f is no ELF binary (it starts $magic): the postinstall did not link the binary there."; \
      stat -c '%h link(s), inode %i, %s bytes: %n' "$f"; \
    done; \
    [ -f "$unused/.corepack" ] || fail "$unused/.corepack is not there: node's copy of pnpm is not where it was."; \
    [ -d "$unused/dist/node_modules/tar" ] || fail "$unused/dist/node_modules/tar is not there: node's copy of pnpm no longer carries tar."; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack is not there: root's copy of pnpm, which trigger-api runs, is not where it was."; \
    [ -d "$kept_tar" ] || fail "$kept_tar is not there: root's copy of pnpm no longer carries tar where pnpm 10.33.2 did."; \
    users="$(find "$kept/dist" -path "$kept_tar" -prune -o -type f -exec sh -c 'for f; do ! grep -qE "(require\(|from ).tar[^a-z_-]" "$f" || echo "$f"; done' sh {} +)"; \
    [ "$users" = "$kept/dist/node_modules/node-gyp/lib/install.js" ] || fail "in $kept/dist, tar is required by: ${users:-nothing}, not by node-gyp's lib/install.js alone, which the removal of $kept_tar was read for."; \
    rm "$depot_bin" "$depot_link" "$esbuild_bin" "$esbuild_link"; \
    rm -r "$unused" "$kept_tar"; \
    left="$(find "$s" -type f \( -name depot -o -name esbuild \) -exec sh -c 'for f; do [ "$(head -c4 "$f" | od -An -tx1 | tr -d " \n")" != 7f454c46 ] || echo "$f"; done' sh {} +)"; \
    [ -z "$left" ] || fail "a depot or esbuild binary is still there: $left"; \
    [ ! -e "$unused" ] || fail "$unused is still there."; \
    [ ! -e "$kept_tar" ] || fail "$kept_tar is still there."; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack went with the removal."; \
    node -e "require('$s/@depot+cli@0.0.1-cli.2.80.0/node_modules/@depot/cli'); require('$s/esbuild@0.23.0/node_modules/esbuild')" || fail "@depot/cli or esbuild no longer loads without its binary."; \
    [ "$(cd /triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --version)" = 10.33.2 ] || fail "as root, the user trigger-api runs as, pnpm does not start offline."; \
    (cd /triggerdotdev && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter @trigger.dev/database exec node -e 0) || fail "as root, pnpm without tar does not run a command in @trigger.dev/database offline, as the entrypoint's migrations need."; \
    echo "$me: removed both names of depot and esbuild, node's copy of pnpm and tar from root's; as root, pnpm 10.33.2 starts and runs a workspace command offline."

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
