#!/bin/bash
set -euo pipefail

# Deploy the worker's Trigger.dev tasks to the managed stack's OWN instance
# (workplan 0018 T4). Idempotent — run it after every `git pull`.
#
# ONE-TIME prerequisites, in order (all against this host's stack):
#
#   1. The stack is up:  docker compose -f deploy/compose/managed.yml up -d
#   2. Create your account + org + project in the instance's dashboard
#      (http://<host>:${TRIGGER_PORT:-3090} — magic-link login; with no mail
#      server configured, the link is printed in `docker logs trigger-api`).
#   3. From the project's settings/API-keys pages, put into deploy/compose/.env:
#        TRIGGER_PROJECT_REF=proj_…      (project settings)
#        TRIGGER_SECRET_KEY=tr_prod_…    (the PROD environment's secret key —
#                                         this is what the API uses to enqueue)
#      Then restart the api so it picks the key up:
#        docker compose -f deploy/compose/managed.yml up -d api
#   4. CLI login, once per machine:
#        npx -y trigger.dev@<version> login -a http://localhost:${TRIGGER_PORT:-3090} --profile openmig
#      (this script prints the exact pinned command if you are not logged in)
#
# TASK RUNTIME ENV VARS — the deployed tasks run in their own containers on
# the compose network, NOT in the worker container, so they inherit nothing.
# Set these in the dashboard (project → environment → Environment Variables),
# with the same values the worker container has (`docker inspect
# open-migrate-worker` shows them):
#
#   DATABASE_URL           postgresql://<owner>@postgres:5432/openmigrate
#   APP_DATABASE_URL       postgresql://app_user@postgres:5432/openmigrate
#   SECRET_ENCRYPTION_KEY  (same 32-byte key as api/worker)
#   IMAP_TIMEOUT / JMAP_TIMEOUT (optional, as configured)
#
# The CLI version is pinned to the SDK version in apps/worker/package.json by
# construction — one number, read from the one place it already lives.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${SCRIPT_DIR}/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

CLI_VERSION="$(node -p "require('${REPO_ROOT}/apps/worker/package.json').dependencies['@trigger.dev/sdk']")"
TRIGGER_URL="http://localhost:${TRIGGER_PORT:-3090}"
PROFILE="${TRIGGER_CLI_PROFILE:-openmig}"

echo "[deploy-tasks] CLI/SDK version: ${CLI_VERSION}  instance: ${TRIGGER_URL}  profile: ${PROFILE}"

: "${TRIGGER_PROJECT_REF:?Set TRIGGER_PROJECT_REF in deploy/compose/.env — the proj_… ref from the dashboard project settings}"

if ! curl -fsS -o /dev/null "${TRIGGER_URL}"; then
  echo "[deploy-tasks] ERROR: ${TRIGGER_URL} is not reachable — is the stack up?" >&2
  echo "               docker compose -f deploy/compose/managed.yml up -d" >&2
  exit 1
fi

# `npx -y` everywhere: without it, the first run after a CLI version bump
# stops at npx's "Ok to proceed?" install prompt — which the `whoami` line
# below sends to /dev/null along with everything else, so the script just
# sits at the version banner looking hung (observed live, 2026-08-11, on the
# 4.5.7 -> 4.5.9 bump: 30+ minutes at the banner, twice).
if ! npx -y "trigger.dev@${CLI_VERSION}" whoami --profile "${PROFILE}" >/dev/null 2>&1; then
  echo "[deploy-tasks] Not logged in. Run this once, then re-run this script:" >&2
  echo "               npx -y trigger.dev@${CLI_VERSION} login -a ${TRIGGER_URL} --profile ${PROFILE}" >&2
  exit 1
fi

# The registry is loopback-bound and unauthenticated (see managed.yml's
# trigger-registry comment), so no `docker login` step exists here — the CLI
# pushes to localhost:${REGISTRY_PORT:-5000} directly.

# Platform preflight (0020 T7). The image platform is decided SERVER-side
# (managed.yml's DEPLOY_IMAGE_PLATFORM, default linux/amd64) and handed to the
# CLI — there is no CLI flag. A mismatch with the host running the supervisor's
# containers produces runners that die at exec ("exec format error") in under a
# second, with AutoRemove destroying the evidence — the failure that cost the
# 2026-08-01 bring-up a session. Refuse it here instead. The value must come
# from .env (the same file the webapp read at its start); export
# SKIP_PLATFORM_CHECK=1 only when deploying FOR a different host on purpose.
if [ "${SKIP_PLATFORM_CHECK:-0}" != "1" ]; then
  host_arch="$(uname -m)"
  case "$host_arch" in
    x86_64) host_platform="linux/amd64" ;;
    aarch64 | arm64) host_platform="linux/arm64" ;;
    *) host_platform="unknown" ;;
  esac
  env_file="${REPO_ROOT}/deploy/compose/.env"
  configured="$(grep -E '^DEPLOY_IMAGE_PLATFORM=' "$env_file" 2>/dev/null | tail -1 | cut -d= -f2-)"
  configured="${configured:-linux/amd64}" # managed.yml's default when .env is silent
  if [ "$host_platform" != "unknown" ] && [ "$configured" != "$host_platform" ]; then
    echo "[deploy-tasks] ERROR: DEPLOY_IMAGE_PLATFORM is '${configured}' but this host is" >&2
    echo "               ${host_arch} (${host_platform}). Runners built for the wrong" >&2
    echo "               platform die at exec with no logs. Set in deploy/compose/.env:" >&2
    echo "                 DEPLOY_IMAGE_PLATFORM=${host_platform}" >&2
    echo "               then recreate the webapp (the value is read server-side):" >&2
    echo "                 docker compose -f managed.yml up -d --force-recreate trigger-api" >&2
    echo "               (Deploying FOR another host on purpose: SKIP_PLATFORM_CHECK=1)" >&2
    exit 1
  fi
fi

echo "[deploy-tasks] deploying apps/worker tasks (project ${TRIGGER_PROJECT_REF})..."
cd "${REPO_ROOT}/apps/worker"
TRIGGER_PROJECT_REF="${TRIGGER_PROJECT_REF}" \
  npx -y "trigger.dev@${CLI_VERSION}" deploy --profile "${PROFILE}"

echo "[deploy-tasks] deploy command finished. The CLI's own output above is the"
echo "[deploy-tasks] registration evidence; the dashboard's Deployments page"
echo "[deploy-tasks] shows the task list. The REAL proof is the live smoke:"
echo "[deploy-tasks]   ./deploy/compose/smoke-managed.sh"
echo "[deploy-tasks] (verify start->poll->done AND apply->receipt terminal;"
echo "[deploy-tasks]  exits non-zero on failure — see its header for knobs)"
