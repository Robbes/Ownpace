#!/bin/bash
set -euo pipefail

# Deploy the worker's Trigger.dev tasks to the managed stack's OWN instance
# (workplan 0018 T4). Idempotent — run it after every `git pull`.
#
# ONE-TIME prerequisites, in order (all against this host's stack). All of
# them EXCEPT creating the account/organisation/project are done for you by
# deploy/compose/bootstrap-managed.sh — see docs/managed-bring-up.md. They
# stay written out here because this script is also run on its own, long
# after a bring-up, and its refusals point back at them:
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
# the compose network, NOT in the worker container, so they inherit nothing:
#
#   DATABASE_URL           through the pooler, at the IN-NETWORK address
#   APP_DATABASE_URL       the RLS-enforcing app_user role, same address
#   DIRECT_DATABASE_URL    never the pooler (session-scoped advisory lock)
#   SECRET_ENCRYPTION_KEY  (same 32-byte key as api/worker)
#   OAUTH2_* / SMTP_* / NOTIFY_* (optional, as configured)
#
# Do NOT enter these in the dashboard by hand. Run:
#
#   ./deploy/compose/set-task-env.sh
#
# which uploads them from deploy/compose/.env with `override: true`, so the
# file is the source of truth and a stale dashboard value cannot silently win
# over a rotated one. (The dashboard's env form also misbehaved over the TLS
# front during the 2026-08-01 bring-up; the SDK path this wraps is what
# actually worked.) Run it BEFORE the deploy below: a task that lands before
# its environment exists runs once against no database and fails in a way that
# reads like a broken task.
#
# The CLI version is pinned to the SDK version in apps/worker/package.json by
# construction — one number, read from the one place it already lives.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=trigger-cli-lib.sh
. "${SCRIPT_DIR}/trigger-cli-lib.sh"

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

# The CLI version and the INSTALLED SDK must be the same, or the deploy stops
# and asks a question.
#
# CLI_VERSION above comes from apps/worker/package.json. The CLI compares
# itself against what is actually in node_modules, and on a mismatch it prints
# "Would you like to apply those updates?" and WAITS. Observed live on the
# Spark, 2026-08-18: package.json pinned 4.5.11, node_modules still held 4.5.9
# from before the bump, and a scripted deploy turned into an interactive one.
#
# That is the same class of failure as the `npx -y` lesson below — a prompt
# nobody is there to answer — and it is worse in CI, where there is no terminal
# to answer it from and the nightly would sit on it.
#
# Refused rather than suppressed: the condition is a stale install, and the fix
# is to install. Suppressing the prompt would deploy an image built against one
# SDK from a checkout pinning another, which is the drift 0018 T0 exists to
# prevent.
INSTALLED_SDK="$(node -p "require('${REPO_ROOT}/apps/worker/node_modules/@trigger.dev/sdk/package.json').version" 2>/dev/null || echo '')"
if [ -z "$INSTALLED_SDK" ]; then
  echo "[deploy-tasks] ERROR: @trigger.dev/sdk is not installed in apps/worker." >&2
  echo "               pnpm install --frozen-lockfile" >&2
  exit 1
fi
if [ "$INSTALLED_SDK" != "$CLI_VERSION" ]; then
  echo "[deploy-tasks] ERROR: apps/worker/package.json pins @trigger.dev/sdk ${CLI_VERSION}," >&2
  echo "               but node_modules holds ${INSTALLED_SDK}. The deploy CLI would stop and" >&2
  echo "               ask whether to update, which a script cannot answer. Install first:" >&2
  echo "                 pnpm install --frozen-lockfile" >&2
  exit 1
fi

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
# NOT an exit-code check — `whoami` exits 0 whether or not the token actually
# works (see trigger-cli-lib.sh). A stale profile from a wiped instance passes
# a naive check and fails later, inside `deploy`, with an error that looks
# like a broken deployment rather than a login nobody did.
if ! trigger_cli_logged_in "${CLI_VERSION}" "${PROFILE}"; then
  echo "[deploy-tasks] Not logged in under the profile '${PROFILE}'. Run this once," >&2
  echo "[deploy-tasks] then re-run this script:" >&2
  echo "               npx -y trigger.dev@${CLI_VERSION} login -a ${TRIGGER_URL} --profile ${PROFILE}" >&2
  # The same omission bootstrap-managed.sh's login phase had: naming the
  # profile without ever saying it is a SETTING leaves an operator who is
  # logged in under another name with nothing to act on (0099).
  present="$(trigger_cli_profiles_present)"
  if [ -n "$present" ]; then
    echo "[deploy-tasks] This machine IS logged in under:" >&2
    # shellcheck disable=SC2086
    printf '[deploy-tasks]   %s\n' $present >&2
  fi
  echo "[deploy-tasks] The name comes from TRIGGER_CLI_PROFILE in deploy/compose/.env" >&2
  echo "[deploy-tasks] (default '${PROFILE}'). To point it at one you already have:" >&2
  echo "[deploy-tasks]   ./deploy/compose/env-upsert.sh deploy/compose/.env TRIGGER_CLI_PROFILE=<name>" >&2
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

# WHICH ENVIRONMENT THE TASKS LAND IN, and the mismatch that hides.
#
# `trigger.dev deploy` targets ONE environment and defaults to prod, which is
# why this script deployed to prod for its whole life without ever saying so.
# A Trigger project has several (the dashboard shows staging and production),
# and one instance can serve a test stack and a production stack side by side —
# separate keys, separate deployed versions, separate runs.
#
# The failure that makes this worth a guard rather than a flag: the API
# enqueues with TRIGGER_SECRET_KEY, whose environment is baked into the key,
# while the deploy targets whatever --env says. Point them at DIFFERENT
# environments and nothing errors — the deploy succeeds, the enqueue succeeds,
# and the runs simply never meet a deployed task. You get a queue that grows
# and a dashboard that looks idle, in two places neither of which is wrong.
#
# So: refuse the two combinations that are unambiguously that mistake. The
# prod key prefix (tr_prod_) is the one this repository has actually seen, so
# it is the only one asserted; a non-prod environment whose key prefix we do
# not recognise is left alone rather than guessed at.
TRIGGER_ENV="${TRIGGER_ENV:-prod}"

case "${TRIGGER_ENV}:${TRIGGER_SECRET_KEY}" in
  prod:tr_prod_*) ;;
  prod:*)
    echo "[deploy-tasks] ERROR: TRIGGER_ENV=prod but TRIGGER_SECRET_KEY is not a tr_prod_… key." >&2
    echo "               The deploy would land in prod while the API enqueues elsewhere, and" >&2
    echo "               nothing would error — the runs would just never meet a task." >&2
    echo "               Set TRIGGER_ENV to the environment that key belongs to, or set the" >&2
    echo "               key to that environment's own (dashboard → API keys)." >&2
    exit 1
    ;;
  *:tr_prod_*)
    echo "[deploy-tasks] ERROR: TRIGGER_ENV=${TRIGGER_ENV} but TRIGGER_SECRET_KEY is a PROD key." >&2
    echo "               The tasks would deploy to ${TRIGGER_ENV} while the API enqueues into" >&2
    echo "               prod. Nothing errors; the runs never meet a deployed task." >&2
    echo "               Put the ${TRIGGER_ENV} environment's key in deploy/compose/.env and" >&2
    echo "               restart the api:  docker compose -f managed.yml up -d api" >&2
    exit 1
    ;;
esac

echo "[deploy-tasks] deploying apps/worker tasks (project ${TRIGGER_PROJECT_REF}, env ${TRIGGER_ENV})..."
cd "${REPO_ROOT}/apps/worker"
TRIGGER_PROJECT_REF="${TRIGGER_PROJECT_REF}" \
  npx -y "trigger.dev@${CLI_VERSION}" deploy --profile "${PROFILE}" --env "${TRIGGER_ENV}"

# THE DEPLOY EDITS apps/worker/package.json AND DOES NOT SAY SO.
#
# Observed on the Spark, 2026-08-18: the only change was the trailing newline
# being stripped. Harmless in itself, and worth naming anyway — a working tree
# that is dirty for no reason anybody remembers is one that blocks the next
# `git pull` at the least convenient moment, and trains people to `git checkout
# --` things without reading them first.
#
# Reported, not reverted: the CLI is also capable of legitimately bumping the
# SDK version here, and silently undoing that would be worse than a dirty file.
if command -v git >/dev/null 2>&1 && ! git -C "$REPO_ROOT" diff --quiet -- apps/worker/package.json 2>/dev/null; then
  echo "[deploy-tasks] NOTE: the deploy modified apps/worker/package.json:"
  git -C "$REPO_ROOT" diff --stat -- apps/worker/package.json | sed 's/^/[deploy-tasks]   /'
  echo "[deploy-tasks] Usually just a stripped trailing newline. Check it, then either"
  echo "[deploy-tasks] commit a real SDK bump or discard it:"
  echo "[deploy-tasks]   git diff apps/worker/package.json"
  echo "[deploy-tasks]   git checkout -- apps/worker/package.json"
fi

echo "[deploy-tasks] deploy command finished. The CLI's own output above is the"
echo "[deploy-tasks] registration evidence; the dashboard's Deployments page"
echo "[deploy-tasks] shows the task list. The REAL proof is the live smoke:"
echo "[deploy-tasks]   ./deploy/compose/smoke-managed.sh"
echo "[deploy-tasks] (verify start->poll->done AND apply->receipt terminal;"
echo "[deploy-tasks]  exits non-zero on failure — see its header for knobs)"
