# Trigger.dev's supervisor as upstream publishes it, by tag and index digest,
# with root's copy of pnpm deleted, which never runs in this stack, and tar
# deleted from node's, which runs (workplan 0146 T16; the owner's decisions of
# 2026-10-26, "Both", and of 2026-10-27, tar out of the copy that runs). The
# header of deploy/compose/trigger.dev/Dockerfile says the rest, and all of it
# holds here: the name and its hash, the version argument, read_at, what may
# not be in this file, how it fails when upstream moves, and the way out.
#
# WHY. Trivy 0.76.1 read 2 critical findings in
# ghcr.io/triggerdotdev/supervisor:v4.8.1 (linux/arm64, 2026-10-26), both tar
# 7.5.13 (CVE-2026-59873) in corepack's pnpm 10.33.2: once in root's copy and
# once in node's. managed.yml's trigger-supervisor sets no `user:`, so it runs
# as the image's user, node, with HOME /home/node, and its CMD, `pnpm run
# --filter supervisor start`, runs node's copy. Root's copy, left by the base
# stage's `corepack prepare` (apps/supervisor/Containerfile), runs nowhere: the
# entrypoint only sets NODE_OPTIONS and execs dumb-init, the healthcheck is
# `node -e fetch`, and nothing execs into the container. Node's copy keeps
# running without its tar, as the webapp's header says of root's copy there:
# only pnpm's bundled node-gyp requires tar (lib/install.js, for Node's
# headers in a native build), and the CMD runs one script, `node
# dist/index.js`, and installs nothing. The one risk, accepted by the owner
# on 2026-10-27: a `pnpm install` inside this container that builds a native
# add-on would fail. So 2 become 0.
#
# THE USER COUPLING, the webapp's the other way round. No `user:` here, so this
# removes root's copy and proves node's starts offline. Upstream's own compose
# (hosting/docker/worker) runs the supervisor `user: root`, with pnpm in its
# command: a managed.yml that did the same would run root's copy, which is gone.
# managed.yml sets COREPACK_ENABLE_NETWORK: "0" on it, so that start stops
# instead of fetching pnpm, and the first RUN proves the refusal as root.
# scripts/a-binary-the-stack-never-runs.unit.test.ts holds the two together.
# Upstream decides the rest: the image's USER (node), its CMD (pnpm) and its
# entrypoint, which only sets NODE_OPTIONS and execs dumb-init. A release that
# ran the supervisor as root, or dropped users in its entrypoint, would run the
# copy that is gone. So the entrypoint read at read_at is pinned by its SHA-256
# below, and images.yml's `build (trigger, …)` checks the base's user, command
# and entrypoint are the ones read.
FROM ghcr.io/triggerdotdev/supervisor:v4.8.1@sha256:9907be3e369b678eec7c951088d218e8dc647f0a469932a23e9d999552ae6201

# Given by managed.yml from the .env, empty when the .env sets none. It only refuses.
ARG TRIGGER_IMAGE_TAG

USER root

RUN set -eu; \
    me=deploy/compose/supervisor/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read this file's header against the new tag, or drop the removal upstream fixed." >&2; exit 1; }; \
    read_at=v4.8.1; \
    core="v$(node -p "require('/app/packages/core/package.json').version")"; \
    if [ -n "${TRIGGER_IMAGE_TAG:-}" ] && [ "$TRIGGER_IMAGE_TAG" != "$core" ]; then \
      echo "$me: the .env names TRIGGER_IMAGE_TAG=$TRIGGER_IMAGE_TAG, and this checkout builds Trigger.dev $core. Either set TRIGGER_IMAGE_TAG=$core in the .env, or run a checkout that pins $TRIGGER_IMAGE_TAG: the release that ran it, or a move to it (trigger-version.sh pin $TRIGGER_IMAGE_TAG, docs/managed-bring-up.md, Upgrading Trigger.dev)." >&2; \
      exit 1; \
    fi; \
    [ "$core" = "$read_at" ] || fail "why the removal is safe was read in Trigger.dev $read_at's source, and this image is $core. Read the header's reasons again at $core (apps/supervisor/Containerfile, apps/supervisor/entrypoint.sh, the image's user and command), then move read_at, and entrypoint_sha256 if the entrypoint changed."; \
    entrypoint=/app/entrypoint.sh; \
    entrypoint_sha256=e3297568d24019a6b4fb597c7914a6510faacdf504a3c3394c73ad30ed6e01b7; \
    [ -f "$entrypoint" ] || fail "$entrypoint is not there."; \
    [ "$(sha256sum "$entrypoint" | cut -d' ' -f1)" = "$entrypoint_sha256" ] || fail "$entrypoint is not the one read at $read_at. Which user runs pnpm decides which copy this file may delete (THE USER COUPLING): read it, then move entrypoint_sha256."; \
    pm="$(node -p "require('/app/package.json').packageManager")"; \
    [ "$pm" = pnpm@10.33.2 ] || fail "the image names $pm, not pnpm@10.33.2, so corepack keeps pnpm at other paths."; \
    unused=/root/.cache/node/corepack/v1/pnpm/10.33.2; \
    kept=/home/node/.cache/node/corepack/v1/pnpm/10.33.2; \
    kept_tar="$kept/dist/node_modules/tar"; \
    [ -f "$unused/.corepack" ] || fail "$unused/.corepack is not there: root's copy of pnpm is not where it was."; \
    [ -d "$unused/dist/node_modules/tar" ] || fail "$unused/dist/node_modules/tar is not there: root's copy of pnpm no longer carries tar."; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack is not there: node's copy of pnpm, which the supervisor runs, is not where it was."; \
    [ -d "$kept_tar" ] || fail "$kept_tar is not there: node's copy of pnpm no longer carries tar where pnpm 10.33.2 did."; \
    users="$(find "$kept/dist" -path "$kept_tar" -prune -o -type f -exec sh -c 'for f; do ! grep -qE "(require\(|from ).tar[^a-z_-]" "$f" || echo "$f"; done' sh {} +)"; \
    [ "$users" = "$kept/dist/node_modules/node-gyp/lib/install.js" ] || fail "in $kept/dist, tar is required by: ${users:-nothing}, not by node-gyp's lib/install.js alone, which the removal of $kept_tar was read for."; \
    rm -r "$unused" "$kept_tar"; \
    [ ! -e "$unused" ] || fail "$unused is still there."; \
    [ ! -e "$kept_tar" ] || fail "$kept_tar is still there."; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack went with the removal."; \
    if (cd /app && COREPACK_ENABLE_NETWORK=0 pnpm --version) >/dev/null 2>&1; then \
      fail "as root, pnpm still starts offline, so a copy is left that this file removes, or corepack reads another home."; \
    fi; \
    echo "$me: removed root's copy of pnpm and tar from node's; as root, pnpm does not start offline, as it should not: the supervisor runs as node."

# Upstream's own user, which this image keeps.
USER node

# As node, the user the supervisor runs as, the kept copy starts offline and,
# without its tar, runs a command in the supervisor's package as the CMD does.
RUN set -eu; \
    me=deploy/compose/supervisor/Dockerfile; \
    [ "$(cd /app && COREPACK_ENABLE_NETWORK=0 pnpm --version)" = 10.33.2 ] || { echo "$me: as node, the user trigger-supervisor runs as, pnpm 10.33.2 does not start offline." >&2; exit 1; }; \
    (cd /app && COREPACK_ENABLE_NETWORK=0 pnpm --fail-if-no-match --filter supervisor exec node -e 0) || { echo "$me: as node, pnpm without tar does not run a command in the supervisor's package offline, as its CMD needs." >&2; exit 1; }; \
    echo "$me: as node, pnpm 10.33.2 starts and runs a workspace command offline."
