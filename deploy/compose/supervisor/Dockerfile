# Trigger.dev's supervisor as upstream publishes it, by tag and index digest,
# with root's copy of pnpm deleted, which never runs in this stack (workplan
# 0146 T16; the owner's decision of 2026-10-26, "Both"). The header of
# deploy/compose/trigger.dev/Dockerfile says the rest, and all of it holds
# here: the name and its hash, the version argument, what may not be in this
# file, how it fails when upstream moves, and the way out.
#
# WHY. Trivy 0.76.1 read 2 critical findings in
# ghcr.io/triggerdotdev/supervisor:v4.8.1 (linux/arm64, 2026-10-26), both tar
# 7.5.13 (CVE-2026-59873) in corepack's pnpm 10.33.2: once in root's copy and
# once in node's. managed.yml's trigger-supervisor sets no `user:`, so it runs
# as the image's user, node, with HOME /home/node, and its CMD, `pnpm run
# --filter supervisor start`, runs node's copy. Root's copy, left by the base
# stage's `corepack prepare` (apps/supervisor/Containerfile), runs nowhere: the
# entrypoint only sets NODE_OPTIONS and execs dumb-init, the healthcheck is
# `node -e fetch`, and nothing execs into the container. So 2 become 1.
#
# THE USER COUPLING, the webapp's the other way round. No `user:` here, so this
# removes root's copy and proves node's starts offline. Upstream's own compose
# (hosting/docker/worker) runs the supervisor `user: root`, with pnpm in its
# command: a managed.yml that did the same would run root's copy, which is gone.
# managed.yml sets COREPACK_ENABLE_NETWORK: "0" on it, so that start stops
# instead of fetching pnpm, and the first RUN proves the refusal as root.
# scripts/a-binary-the-stack-never-runs.unit.test.ts holds the two together.
FROM ghcr.io/triggerdotdev/supervisor:v4.8.1@sha256:9907be3e369b678eec7c951088d218e8dc647f0a469932a23e9d999552ae6201

# Given by managed.yml from the .env, empty when the .env sets none. It only refuses.
ARG TRIGGER_IMAGE_TAG

USER root

RUN set -eu; \
    me=deploy/compose/supervisor/Dockerfile; \
    fail() { echo "$me: $*" >&2; echo "$me: re-read this file's header against the new tag, or drop the removal upstream fixed." >&2; exit 1; }; \
    core="v$(node -p "require('/app/packages/core/package.json').version")"; \
    if [ -n "${TRIGGER_IMAGE_TAG:-}" ] && [ "$TRIGGER_IMAGE_TAG" != "$core" ]; then \
      echo "$me: the .env names TRIGGER_IMAGE_TAG=$TRIGGER_IMAGE_TAG, and this checkout builds Trigger.dev $core. The bring-up's drift check (0018 T0) says which way to reconcile them." >&2; \
      exit 1; \
    fi; \
    pm="$(node -p "require('/app/package.json').packageManager")"; \
    [ "$pm" = pnpm@10.33.2 ] || fail "the image names $pm, not pnpm@10.33.2, so corepack keeps pnpm at other paths."; \
    unused=/root/.cache/node/corepack/v1/pnpm/10.33.2; \
    kept=/home/node/.cache/node/corepack/v1/pnpm/10.33.2; \
    [ -f "$unused/.corepack" ] || fail "$unused/.corepack is not there: root's copy of pnpm is not where it was."; \
    [ -d "$unused/dist/node_modules/tar" ] || fail "$unused/dist/node_modules/tar is not there: root's copy of pnpm no longer carries tar."; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack is not there: node's copy of pnpm, which the supervisor runs, is not where it was."; \
    rm -r "$unused"; \
    [ ! -e "$unused" ] || fail "$unused is still there."; \
    [ -f "$kept/.corepack" ] || fail "$kept/.corepack went with the removal."; \
    if (cd /app && COREPACK_ENABLE_NETWORK=0 pnpm --version) >/dev/null 2>&1; then \
      fail "as root, pnpm still starts offline, so a copy is left that this file removes, or corepack reads another home."; \
    fi; \
    echo "$me: removed root's copy of pnpm; as root, pnpm does not start offline, as it should not: the supervisor runs as node."

# Upstream's own user, which this image keeps.
USER node

# As node, the user the supervisor runs as, the kept copy starts offline.
RUN set -eu; \
    me=deploy/compose/supervisor/Dockerfile; \
    [ "$(cd /app && COREPACK_ENABLE_NETWORK=0 pnpm --version)" = 10.33.2 ] || { echo "$me: as node, the user trigger-supervisor runs as, pnpm 10.33.2 does not start offline." >&2; exit 1; }; \
    echo "$me: as node, pnpm 10.33.2 starts offline."
