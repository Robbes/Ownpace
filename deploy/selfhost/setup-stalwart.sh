#!/bin/bash
set -euo pipefail

# Stand up a real, working Stalwart v0.16.10 for local dev / e2e (workplan 0010 T5 and
# friends — the self-host restart-resume idempotency gate needs a real IMAP+JMAP source
# and target). This is the ONE canonical way to do that in this repo; do not re-invent a
# second path (see docs/stalwart-integration-fix.md, "DO NOT deviate").
#
# Two-phase startup is REQUIRED by Stalwart itself, not a convenience choice — provisioning
# (recovery mode) and serving (normal mode) cannot share one process: recovery mode exposes
# only the management API (mail listeners suspended), and normal mode auto-starts listeners
# for whatever accounts already exist in the datastore. This script does both phases against
# one named Docker volume, then leaves a normal-mode container running.
#
# Idempotent: safe to re-run against an already-provisioned volume — account provisioning
# uses upsert semantics, so re-running phase 1 just re-applies the same accounts.
#
# Uses ONLY the official image (no custom build — docs/stalwart-integration-fix.md's own
# "Verified Image" finding: a custom image provided no benefit over the official one).
#
# Requires: docker, curl, and stalwart-cli on PATH (or STALWART_CLI_PATH set). Install:
#   curl --proto '=https' --tlsv1.2 -LsSf \
#     https://github.com/stalwartlabs/cli/releases/latest/download/stalwart-cli-installer.sh | sh
#
# Also joins `openmig_dev-network` (the fixed-name network deploy/compose/dev.yml declares
# for postgres/nextcloud) under the network alias "stalwart", creating it first if it doesn't
# exist yet. This is what makes the confirmed Docker-outside-of-Docker fix work (see
# docs/stalwart-integration-fix.md, "Running from inside a sandboxed agent container"): a
# sandboxed agent joins that same network and reaches this container at `stalwart:8080` /
# `stalwart:993` directly, without published host ports or `host.docker.internal` at all.
#
# Env overrides (all optional):
#   STALWART_CONTAINER          container name (default openmig-dev-stalwart)
#   STALWART_VOLUME             data volume name (default openmig-dev-stalwart-data)
#   STALWART_CONFIG_VOLUME      config volume name (default openmig-dev-stalwart-config)
#   STALWART_NETWORK            shared network to join (default openmig_dev-network)
#   STALWART_JMAP_PORT          host port for JMAP/management (default 18080)
#   STALWART_IMAPS_PORT         host port for IMAPS (default 1993)
#   STALWART_RECOVERY_PASSWORD  recovery-mode admin password (default provision_password)
#   STALWART_CLI_URL            URL stalwart-cli itself connects to for provisioning
#                                (default http://127.0.0.1:$JMAP_PORT, i.e. the published
#                                port). Override to http://stalwart:8080 if the caller is a
#                                Docker-outside-of-Docker sandbox that has joined $NETWORK —
#                                see docs/stalwart-integration-fix.md's DooD section. Only
#                                affects stalwart-cli; the readiness check below always goes
#                                through `docker exec`, so it needs no such override.

IMAGE="stalwartlabs/stalwart:v0.16.10"
CONTAINER="${STALWART_CONTAINER:-openmig-dev-stalwart}"
VOLUME="${STALWART_VOLUME:-openmig-dev-stalwart-data}"
CONFIG_VOLUME="${STALWART_CONFIG_VOLUME:-openmig-dev-stalwart-config}"
NETWORK="${STALWART_NETWORK:-openmig_dev-network}"
JMAP_PORT="${STALWART_JMAP_PORT:-18080}"
IMAPS_PORT="${STALWART_IMAPS_PORT:-1993}"
RECOVERY_PASSWORD="${STALWART_RECOVERY_PASSWORD:-provision_password}"
CLI_URL="${STALWART_CLI_URL:-http://127.0.0.1:${JMAP_PORT}}"

STALWART_CLI="${STALWART_CLI_PATH:-stalwart-cli}"
command -v "$STALWART_CLI" >/dev/null 2>&1 || {
  echo "[setup-stalwart] $STALWART_CLI not found. Install it (see this script's header) or set STALWART_CLI_PATH." >&2
  exit 1
}

PLAN_FILE="$(mktemp)"
trap 'rm -f "$PLAN_FILE"' EXIT

docker volume inspect "$VOLUME" >/dev/null 2>&1 || docker volume create "$VOLUME" >/dev/null
docker volume inspect "$CONFIG_VOLUME" >/dev/null 2>&1 || docker volume create "$CONFIG_VOLUME" >/dev/null
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

# The ENTIRE config.json, both phases, nothing else (docs/stalwart-integration-fix.md).
# Accounts/domains/listeners NEVER go in this file — they're provisioned via stalwart-cli
# below, into the datastore, not declared statically.
#
# Delivered via a named volume, seeded by a throwaway --rm container that writes the file
# directly with shell redirection (foreground, not detached — a detached container's stdin
# is never attached, so piping into `docker run -d` silently lands an empty config, see
# docs/stalwart-integration-fix.md's "Note on bind-mount vs copy for config delivery").
# NOT a bind mount: a host path bind-mounted from inside a Docker-outside-of-Docker sandbox
# (an agent that only reaches Docker via a mounted docker.sock) resolves against the HOST's
# filesystem, not the sandbox's — the path doesn't exist there, so Docker silently creates an
# empty DIRECTORY at the mount point instead of mounting the file, and Stalwart fails with
# "Is a directory (os error 21)". A named volume has no such host-path ambiguity and works
# identically on a bare runner and inside a sandbox, so it replaces the bind mount everywhere
# rather than being a DinD-only special case.
docker run --rm --entrypoint /bin/sh --user root \
  -v "$CONFIG_VOLUME:/etc/stalwart" \
  "$IMAGE" \
  -c 'echo "{\"@type\":\"RocksDb\",\"path\":\"/opt/stalwart/data\"}" > /etc/stalwart/config.json && chmod 644 /etc/stalwart/config.json' >/dev/null

# Checks readiness via `docker exec` into the target container itself, curling its own
# localhost — NOT `curl http://127.0.0.1:${JMAP_PORT}` from this script's own caller. That
# used to be the check, and it produced a false "never came up" here: in a
# Docker-outside-of-Docker sandbox (this script's caller only reaches Docker via a mounted
# docker.sock), `127.0.0.1` in the CALLER's shell is a different network namespace from
# where the published port actually lands — the container was genuinely listening and
# responding (confirmed via `docker exec $CONTAINER curl ...` returning a real HTTP status)
# the whole time. `docker exec` always runs inside the target container's own namespace, so
# this check is correct in both a bare-host and a sandboxed context — see
# docs/stalwart-integration-fix.md's "Open, NOT YET RESOLVED" section for the investigation
# that found this (now resolved).
wait_for_jmap() {
  local label="$1"
  for i in $(seq 1 60); do
    docker exec "$CONTAINER" curl -sf -o /dev/null "http://127.0.0.1:8080/.well-known/jmap" 2>/dev/null && return 0
    if [ "$i" -eq 60 ]; then
      echo "[setup-stalwart] $label never came up after 60s" >&2
      docker logs "$CONTAINER" 2>&1 | tail -100 >&2
      return 1
    fi
    sleep 1
  done
}

# wait_for_jmap only proves the container's OWN loopback is serving — it says nothing about
# whether the *published* port (what stalwart-cli, a host binary, actually connects to via
# $CLI_URL) is wired up yet. Those are two different paths (internal bind vs. Docker's
# port-publish/NAT), and the latter can lag the former by a moment even on a bare host with no
# DooD involved: confirmed live on the Spark box (2026-07-25) — wait_for_jmap passed, the very
# next line's stalwart-cli call failed with "error sending request for url
# (.../api/schema)", yet a manual curl against the same published port succeeded moments later.
# Poll the actual CLI_URL here so stalwart-cli never races that gap.
wait_for_cli_url() {
  for i in $(seq 1 30); do
    curl -sf -o /dev/null "${CLI_URL}/.well-known/jmap" 2>/dev/null && return 0
    if [ "$i" -eq 30 ]; then
      echo "[setup-stalwart] stalwart-cli's target ($CLI_URL) never became reachable after 30s" >&2
      return 1
    fi
    sleep 1
  done
}

echo "[setup-stalwart] Phase 1: recovery mode (provisioning)..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
# --user root: named Docker volumes are created root-owned, but the Stalwart image runs as a
# non-root user, so without this it can't write to /opt/stalwart/data ("Permission denied ...
# /opt/stalwart/data/LOG"). This mirrors packages/testing/src/testcontainers-setup.ts, which
# runs its Stalwart containers with .withUser('root') for exactly the same reason.
docker run -d \
  --name "$CONTAINER" \
  --user root \
  --network "$NETWORK" \
  --network-alias stalwart \
  -v "$VOLUME:/opt/stalwart/data" \
  -v "$CONFIG_VOLUME:/etc/stalwart:ro" \
  -e STALWART_HOSTNAME=0.0.0.0 \
  -e STALWART_RECOVERY_MODE=1 \
  -e STALWART_RECOVERY_ADMIN="admin:${RECOVERY_PASSWORD}" \
  -p "${JMAP_PORT}:8080" \
  "$IMAGE" --config /etc/stalwart/config.json >/dev/null

wait_for_jmap "Recovery listener"
wait_for_cli_url

echo "[setup-stalwart] Provisioning accounts..."
cat > "$PLAN_FILE" <<'PLAN'
{"@type":"upsert","object":"Domain","matchOn":["name"],"value":{"dom-a":{"name":"dev.local"}}}
{"@type":"upsert","object":"Account","matchOn":["name"],"value":{"source":{"@type":"User","name":"source","domainId":"#dom-a","credentials":{"0":{"@type":"Password","secret":"source_password"}},"roles":{"@type":"User"},"permissions":{"@type":"Inherit"},"encryptionAtRest":{"@type":"Disabled"}}}}
{"@type":"upsert","object":"Account","matchOn":["name"],"value":{"target":{"@type":"User","name":"target","domainId":"#dom-a","credentials":{"0":{"@type":"Password","secret":"target_password"}},"roles":{"@type":"User"},"permissions":{"@type":"Inherit"},"encryptionAtRest":{"@type":"Disabled"}}}}
{"@type":"upsert","object":"Account","matchOn":["name"],"value":{"shared":{"@type":"User","name":"shared","domainId":"#dom-a","credentials":{"0":{"@type":"Password","secret":"shared_password"}},"roles":{"@type":"User"},"permissions":{"@type":"Inherit"},"encryptionAtRest":{"@type":"Disabled"}}}}
{"@type":"upsert","object":"Account","matchOn":["name"],"value":{"target-shared":{"@type":"User","name":"target-shared","domainId":"#dom-a","credentials":{"0":{"@type":"Password","secret":"target-shared_password"}},"roles":{"@type":"User"},"permissions":{"@type":"Inherit"},"encryptionAtRest":{"@type":"Disabled"}}}}
PLAN

# Unlike wait_for_jmap above, this genuinely can't go through `docker exec` — stalwart-cli
# isn't installed in the target image, it's a host binary. If the caller can't reach
# 127.0.0.1:$JMAP_PORT (e.g. a Docker-outside-of-Docker sandbox), set STALWART_CLI_URL to
# http://stalwart:8080 after joining the caller to $NETWORK — see this script's header.
"$STALWART_CLI" --url "$CLI_URL" --user admin --password "${RECOVERY_PASSWORD}" apply --file "$PLAN_FILE"

echo "[setup-stalwart] Stopping recovery container..."
docker stop "$CONTAINER" >/dev/null
docker rm "$CONTAINER" >/dev/null
# The RocksDB lock can outlive `docker stop` returning — give it a moment before phase 2
# (docs/stalwart-integration-fix.md, "RocksDB Lock Collision Prevention").
sleep 2

echo "[setup-stalwart] Phase 2: normal mode (serving)..."
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --user root \
  --network "$NETWORK" \
  --network-alias stalwart \
  -v "$VOLUME:/opt/stalwart/data" \
  -v "$CONFIG_VOLUME:/etc/stalwart:ro" \
  -e STALWART_HOSTNAME=0.0.0.0 \
  -p "${JMAP_PORT}:8080" \
  -p "${IMAPS_PORT}:993" \
  "$IMAGE" --config /etc/stalwart/config.json >/dev/null

wait_for_jmap "Normal-mode server"

echo "[setup-stalwart] Ready."
echo "[setup-stalwart]   JMAP:  http://127.0.0.1:${JMAP_PORT}/.well-known/jmap  (or http://stalwart:8080 from ${NETWORK})"
echo "[setup-stalwart]   IMAPS: 127.0.0.1:${IMAPS_PORT} (TLS, self-signed cert; or stalwart:993 from ${NETWORK})"
echo "[setup-stalwart]   Accounts: source@dev.local/source_password, target@dev.local/target_password,"
echo "[setup-stalwart]             shared@dev.local/shared_password, target-shared@dev.local/target-shared_password"
