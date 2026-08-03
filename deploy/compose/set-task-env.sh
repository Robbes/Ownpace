#!/usr/bin/env bash
# set-task-env.sh — upload the task-runtime env vars to the trigger project
# (workplan 0020 T6), so the dashboard is never load-bearing.
#
# Task containers inherit NOTHING from compose: every run gets only what the
# trigger platform stores for the project's environment. Before this script,
# DATABASE_URL / APP_DATABASE_URL / SECRET_ENCRYPTION_KEY were hand-entered in
# the dashboard — whose env form misbehaved over the TLS front during the
# 2026-08-01 bring-up; the path that actually worked was the SDK's
# `envvars.upload`, which this script wraps. Rotation is now: change .env,
# run this, redeploy if needed.
#
# Reads deploy/compose/.env (the same file the stack runs on) and uploads:
#   DATABASE_URL       — owner role, at the IN-NETWORK address (postgres:5432;
#                        runners join the compose network, so `localhost` here
#                        would point a task at itself)
#   APP_DATABASE_URL   — the RLS-enforcing app_user role, same address
#   SECRET_ENCRYPTION_KEY — must equal the api/worker containers' value or
#                        stored connection credentials cannot be decrypted
#   SMTP_* / NOTIFY_*  — the notification channel (workplan 0030), OPTIONAL.
#                        Uploaded only when set, so a stack that does not want
#                        email keeps a clean env rather than a row of blanks.
#                        Without these the managed digest and the rollback
#                        notice are OFF — honestly, with the reason in the task
#                        log — because a task container inherits nothing from
#                        compose and would otherwise never see them.
#
# `override: true` on purpose: this file is the source of truth, and a stale
# dashboard value silently winning over a rotated .env is exactly the failure
# mode T6 exists to end.
#
# Requirements: .env populated (TRIGGER_PROJECT_REF + TRIGGER_SECRET_KEY come
# from the one-time dashboard setup — deploy-tasks.sh's header documents it),
# and `pnpm install` done (uses apps/worker's own @trigger.dev/sdk).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SET_TASK_ENV_FILE:-${SCRIPT_DIR}/.env}"
TRIGGER_ENV_SLUG="${TRIGGER_ENV_SLUG:-prod}"

[ -f "$ENV_FILE" ] || {
  echo "FATAL: $ENV_FILE not found — copy managed.env.example and fill it in" >&2
  exit 1
}
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${TRIGGER_PROJECT_REF:?set TRIGGER_PROJECT_REF in .env (dashboard project settings, proj_...)}"
: "${TRIGGER_SECRET_KEY:?set TRIGGER_SECRET_KEY in .env (the prod tr_prod_... key)}"
: "${SECRET_ENCRYPTION_KEY:?set SECRET_ENCRYPTION_KEY in .env}"

if [ ! -d "$REPO_ROOT/apps/worker/node_modules/@trigger.dev/sdk" ]; then
  echo "FATAL: apps/worker/node_modules/@trigger.dev/sdk missing — run: pnpm install" >&2
  exit 1
fi

# In-network addresses — runners run ON the compose network (see managed.yml's
# DOCKER_RUNNER_NETWORKS), so the DB is `postgres`, never localhost.
TASK_DATABASE_URL="postgresql://${POSTGRES_USER:-openmigrate}:${POSTGRES_PASSWORD:-openmigrate_password}@postgres:5432/${POSTGRES_DB:-openmigrate}"
TASK_APP_DATABASE_URL="postgresql://${APP_DB_USER:-app_user}:${APP_DB_PASSWORD:-app_password}@postgres:5432/${POSTGRES_DB:-openmigrate}"

echo "[set-task-env] uploading task env vars to project ${TRIGGER_PROJECT_REF} env '${TRIGGER_ENV_SLUG}'"

cd "$REPO_ROOT/apps/worker"
TRIGGER_API_URL="${TRIGGER_API_ORIGIN:-http://localhost:3090}" \
  TRIGGER_SECRET_KEY="$TRIGGER_SECRET_KEY" \
  TRIGGER_PROJECT_REF="$TRIGGER_PROJECT_REF" \
  TRIGGER_ENV_SLUG="$TRIGGER_ENV_SLUG" \
  TASK_DATABASE_URL="$TASK_DATABASE_URL" \
  TASK_APP_DATABASE_URL="$TASK_APP_DATABASE_URL" \
  SECRET_ENCRYPTION_KEY="$SECRET_ENCRYPTION_KEY" \
  SMTP_HOST="${SMTP_HOST:-}" \
  SMTP_PORT="${SMTP_PORT:-}" \
  SMTP_SECURE="${SMTP_SECURE:-}" \
  SMTP_USER="${SMTP_USER:-}" \
  SMTP_PASSWORD="${SMTP_PASSWORD:-}" \
  NOTIFY_FROM="${NOTIFY_FROM:-}" \
  NOTIFY_TO="${NOTIFY_TO:-}" \
  NOTIFY_LOCALE="${NOTIFY_LOCALE:-}" \
  node -e '
const { envvars } = require("@trigger.dev/sdk");
(async () => {
  const ref = process.env.TRIGGER_PROJECT_REF;
  const slug = process.env.TRIGGER_ENV_SLUG;
  const variables = {
    DATABASE_URL: process.env.TASK_DATABASE_URL,
    APP_DATABASE_URL: process.env.TASK_APP_DATABASE_URL,
    SECRET_ENCRYPTION_KEY: process.env.SECRET_ENCRYPTION_KEY,
  };
  // Notification settings are optional; only the ones actually set are
  // uploaded. Empty strings would make readNotifierConfig see a HALF
  // configured channel, which reports that somebody tried and names the
  // missing variables — noise for a stack that simply does not want email.
  for (const name of [
    "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD",
    "NOTIFY_FROM", "NOTIFY_TO", "NOTIFY_LOCALE",
  ]) {
    const value = process.env[name];
    if (value) variables[name] = value;
  }
  await envvars.upload(ref, slug, { variables, override: true });
  const list = await envvars.list(ref, slug);
  console.log(
    "[set-task-env] upload OK — env now holds:",
    list.map((v) => v.name).sort().join(", ")
  );
})().catch((e) => {
  console.error("[set-task-env] FAILED:", e && e.message ? e.message : e);
  process.exit(1);
});
'
echo "[set-task-env] done. Running tasks pick the values up on their NEXT run"
echo "[set-task-env] (task env is read at run start; no redeploy needed)."
