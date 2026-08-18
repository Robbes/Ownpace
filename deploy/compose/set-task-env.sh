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
#   OAUTH2_*           — the Entra app registration the Graph connectors and
#                        the drift detector authenticate with, OPTIONAL. A
#                        stack whose mappings are all IMAP needs none of it;
#                        one with a Graph source or 0028's detector needs
#                        CLIENT_ID plus either CLIENT_SECRET (application
#                        flow) or REFRESH_TOKEN (delegated). Without them the
#                        task container has no credentials at all — the same
#                        trap the SMTP values fell into.
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
# BUT `override: true` SKIPS A VALUE WHOSE PLAINTEXT HAS NOT CHANGED, and that
# is not a detail. After TRIGGER_ENCRYPTION_KEY is rotated, every stored secret
# has to be RE-ENCRYPTED — which means re-written — and a variable whose value
# happens to be identical is quietly left on the old key.
#
# On the reference box (2026-08-18) that was exactly one variable:
# SECRET_ENCRYPTION_KEY, whose plaintext had not changed while the three
# database URLs had. This script reported "upload OK" listing all four. The
# store then held three readable secrets and one unreadable one, and every run
# died inside `startRunAttempt` for the rest of the afternoon:
#
#   Error: Unsupported state or unable to authenticate data
#     at PrismaSecretStore.getSecrets
#
# surfacing to the operator as the supervisor looping on "Snapshot changed
# inside startRunAttempt". A message about snapshots, caused by one skipped
# write.
#
# Hence FORCE_REWRITE below: after a key rotation, run
#
#   SET_TASK_ENV_FORCE_REWRITE=1 ./deploy/compose/set-task-env.sh
#
# which DELETES each variable before writing it, so the write is a creation and
# cannot be skipped. Off by default — it discards the stored values, and is
# only correct when the encryption key beneath them has moved.
#
# Deleting rather than overwriting is not fastidiousness. `upload` READS the
# existing value to decide whether the write is a no-op, so on a variable it
# cannot decrypt, every repair through `upload` dies on the same error as the
# thing being repaired. Deletion needs no plaintext. (Confirmed the hard way:
# the first version of this flag wrote a throwaway value first, and failed
# identically.)
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
# Through the pooler by default (workplan 0082 T4). The worker is the reason it
# exists: every sync pass opens its own pg.Pool of DEFAULT_CONCURRENCY + 2, so
# without pooling the server-connection ceiling is concurrent-passes times six.
# DB_HOST=postgres DB_PORT=5432 in .env is the rollback, same as the API's.
TASK_DATABASE_URL="postgresql://${POSTGRES_USER:-openmigrate}:${POSTGRES_PASSWORD:-openmigrate_password}@${DB_HOST:-pgbouncer}:${DB_PORT:-6432}/${POSTGRES_DB:-openmigrate}"
TASK_APP_DATABASE_URL="postgresql://${APP_DB_USER:-app_user}:${APP_DB_PASSWORD:-app_password}@${DB_HOST:-pgbouncer}:${DB_PORT:-6432}/${POSTGRES_DB:-openmigrate}"
# Never the pooler: session-scoped advisory lock. See packages/ledger/src/direct-url.ts.
TASK_DIRECT_DATABASE_URL="postgresql://${POSTGRES_USER:-openmigrate}:${POSTGRES_PASSWORD:-openmigrate_password}@postgres:5432/${POSTGRES_DB:-openmigrate}"

# WAIT FOR THE WEBAPP BEFORE UPLOADING TO IT.
#
# The instruction this script follows a rotation with is "recreate trigger-api,
# then run set-task-env.sh" — and a freshly recreated webapp takes some seconds
# to accept requests. Run immediately after, the upload dies with a bare
#
#   [set-task-env] FAILED: Connection error.
#
# which says nothing about waiting and reads like a broken key or a wrong URL.
# Observed live on the Spark, 2026-08-18: the operator ran it twice and the
# second one worked, which is the correct fix expressed as a manual retry.
#
# `compose up --wait` covers this inside bootstrap-managed.sh, but this script
# is also run on its own, by hand, straight after a recreate — which is exactly
# when it is most likely to race.
TRIGGER_ORIGIN="${TRIGGER_API_ORIGIN:-http://localhost:3090}"
printf '[set-task-env] waiting for %s' "$TRIGGER_ORIGIN" >&2
for attempt in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 5 "$TRIGGER_ORIGIN"; then
    echo " — up" >&2
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo >&2
    echo "[set-task-env] FATAL: ${TRIGGER_ORIGIN} did not answer within 60s." >&2
    echo "[set-task-env] Is the webapp running?  docker compose -f deploy/compose/managed.yml ps trigger-api" >&2
    exit 1
  fi
  printf '.' >&2
  sleep 2
done

echo "[set-task-env] uploading task env vars to project ${TRIGGER_PROJECT_REF} env '${TRIGGER_ENV_SLUG}'"

cd "$REPO_ROOT/apps/worker"
TRIGGER_API_URL="${TRIGGER_API_ORIGIN:-http://localhost:3090}" \
  TRIGGER_SECRET_KEY="$TRIGGER_SECRET_KEY" \
  TRIGGER_PROJECT_REF="$TRIGGER_PROJECT_REF" \
  TRIGGER_ENV_SLUG="$TRIGGER_ENV_SLUG" \
  TASK_DATABASE_URL="$TASK_DATABASE_URL" \
  TASK_APP_DATABASE_URL="$TASK_APP_DATABASE_URL" \
  TASK_DIRECT_DATABASE_URL="$TASK_DIRECT_DATABASE_URL" \
  SECRET_ENCRYPTION_KEY="$SECRET_ENCRYPTION_KEY" \
  OAUTH2_CLIENT_ID="${OAUTH2_CLIENT_ID:-}" \
  OAUTH2_CLIENT_SECRET="${OAUTH2_CLIENT_SECRET:-}" \
  OAUTH2_REFRESH_TOKEN="${OAUTH2_REFRESH_TOKEN:-}" \
  OAUTH2_TENANT_ID="${OAUTH2_TENANT_ID:-}" \
  SMTP_HOST="${SMTP_HOST:-}" \
  SMTP_PORT="${SMTP_PORT:-}" \
  SMTP_SECURE="${SMTP_SECURE:-}" \
  SMTP_USER="${SMTP_USER:-}" \
  SMTP_PASSWORD="${SMTP_PASSWORD:-}" \
  NOTIFY_FROM="${NOTIFY_FROM:-}" \
  NOTIFY_TO="${NOTIFY_TO:-}" \
  NOTIFY_LOCALE="${NOTIFY_LOCALE:-}" \
  FORCE_REWRITE="${SET_TASK_ENV_FORCE_REWRITE:-0}" \
  node -e '
const { envvars } = require("@trigger.dev/sdk");
(async () => {
  const ref = process.env.TRIGGER_PROJECT_REF;
  const slug = process.env.TRIGGER_ENV_SLUG;
  const variables = {
    DATABASE_URL: process.env.TASK_DATABASE_URL,
    APP_DATABASE_URL: process.env.TASK_APP_DATABASE_URL,
    DIRECT_DATABASE_URL: process.env.TASK_DIRECT_DATABASE_URL,
    SECRET_ENCRYPTION_KEY: process.env.SECRET_ENCRYPTION_KEY,
  };
  // Graph credentials and notification settings are optional; only the ones
  // actually set are
  // uploaded. Empty strings would make readNotifierConfig see a HALF
  // configured channel, which reports that somebody tried and names the
  // missing variables — noise for a stack that simply does not want email.
  for (const name of [
    "OAUTH2_CLIENT_ID", "OAUTH2_CLIENT_SECRET", "OAUTH2_REFRESH_TOKEN", "OAUTH2_TENANT_ID",
    "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD",
    "NOTIFY_FROM", "NOTIFY_TO", "NOTIFY_LOCALE",
  ]) {
    const value = process.env[name];
    if (value) variables[name] = value;
  }
  // See FORCE_REWRITE in the header of this file.
  //
  // DELETE, not overwrite. `upload` READS the existing value to decide whether
  // the write is a no-op — so on a variable it cannot decrypt, the repair path
  // dies on the same error as everything else:
  //
  //   FAILED: Unsupported state or unable to authenticate data
  //
  // A first attempt at this wrote a throwaway value first, which fails for
  // exactly that reason: it is still an upload, and upload still reads.
  // Deleting needs no plaintext, so it is the only way back.
  if (process.env.FORCE_REWRITE === "1") {
    for (const name of Object.keys(variables)) {
      try {
        await envvars.del(ref, slug, name);
        console.log("[set-task-env] deleted", name, "so it is rewritten under the current key");
      } catch (e) {
        // Absent is the desired state; anything else is worth seeing but not
        // worth stopping for, since the upload below is the actual repair.
        console.log("[set-task-env] could not delete", name + ":", e && e.message ? e.message : e);
      }
    }
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
