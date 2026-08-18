#!/usr/bin/env bash
# Generates any missing required secret into deploy/compose/.env (0020 T2).
#
# managed.yml deliberately ships NO defaults for these values — a fallback
# committed to a public repository is not a secret, and with the
# tenant-membership gate JWT_SECRET is the outer wall of the tenancy boundary.
# This script keeps first bring-up one command: run it once before
# `docker compose -f managed.yml up`, and every missing secret is generated
# per-install. Idempotent — values already set in .env are never touched, so
# re-running it never rotates anything.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
touch "$ENV_FILE"

# A PLACEHOLDER IS NOT A SECRET, AND `^NAME=.` CANNOT TELL THE DIFFERENCE.
#
# This function used to ask only whether the line had *a* value. Older versions
# of managed.env.example shipped `change-me-…` defaults, so an .env copied from
# one of those satisfied that test forever and the secret was never generated.
#
# Found on the Spark, 2026-08-18, where the live stack was running with
#   TRIGGER_ENCRYPTION_KEY=change-me-32-byte-encryption-key
#   TRIGGER_LOGIN_SECRET=change-me-login-secret
# — values published in this repository's git history. TRIGGER_ENCRYPTION_KEY
# is the one that matters: it encrypts the Trigger.dev environment-variable
# store, which holds DATABASE_URL, APP_DATABASE_URL and SECRET_ENCRYPTION_KEY —
# the key that decrypts every stored customer credential.
#
# So anything still wearing a shipped placeholder counts as ABSENT.
is_placeholder() { # is_placeholder <value>
  case "$1" in
    change-me* | changeme* | your-* | replace-me* | TODO*) return 0 ;;
    *) return 1 ;;
  esac
}

ensure() { # ensure <name> <bytes>
  local name="$1" bytes="$2"
  local current
  # `|| true` is load-bearing: this script runs under `set -o pipefail`, and
  # grep exits 1 when the key is absent — which is the ORDINARY case on a fresh
  # .env, and would otherwise abort the script before generating anything.
  current="$(grep -E "^${name}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"

  if [ -n "$current" ] && ! is_placeholder "$current"; then
    return 0
  fi

  local was_placeholder=0
  [ -n "$current" ] && was_placeholder=1

  # Drop the old line — empty, or a placeholder — then append the real value.
  sed -i "/^${name}=/d" "$ENV_FILE"
  echo "${name}=$(openssl rand -hex "$bytes")" >>"$ENV_FILE"
  if [ "$was_placeholder" -eq 1 ]; then
    echo "[ensure-env-secrets] REPLACED ${name} — it held a shipped placeholder, which is not a secret"
    PLACEHOLDERS_REPLACED=1
  else
    echo "[ensure-env-secrets] generated ${name}"
  fi
}

PLACEHOLDERS_REPLACED=0

ensure JWT_SECRET 32
ensure SECRET_ENCRYPTION_KEY 32
ensure TRIGGER_SESSION_SECRET 16
ensure TRIGGER_MAGIC_LINK_SECRET 16
ensure TRIGGER_ENCRYPTION_KEY 16
ensure TRIGGER_LOGIN_SECRET 16
ensure TRIGGER_MANAGED_WORKER_SECRET 16
ensure PGBOUNCER_AUTH_PASSWORD 24

# PgBouncer's own credential file (workplan 0082 T4).
#
# It holds ONE entry — the powerless lookup role. Every other credential is
# read from Postgres through auth_query, which is the point: adding a role does
# not mean keeping a second copy of its password here and remembering to
# redeploy it. Generated rather than committed, and gitignored, because a
# password in a public repository is not a password.
USERLIST="${SCRIPT_DIR}/pgbouncer/userlist.txt"
PGB_PW="$(grep -E '^PGBOUNCER_AUTH_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
if [ -n "$PGB_PW" ]; then
  mkdir -p "${SCRIPT_DIR}/pgbouncer"
  printf '"pgbouncer_auth" "%s"\n' "$PGB_PW" >"$USERLIST"
  # 0644, NOT 0600, and this is not an oversight.
  #
  # PgBouncer reads this file from inside its container, as a user that is not
  # the host user who wrote it. At 0600 it gets
  #
  #   ERROR could not open auth_file /etc/pgbouncer/userlist.txt: Permission denied
  #
  # and then, having no users at all, refuses every login with `no such user:
  # pgbouncer_auth` — which reads like a missing role rather than a mode bit.
  # (Spark, 2026-08-18. The startup line naming the real cause had already
  # scrolled out of the log window, so it cost three rounds of looking at the
  # wrong thing.)
  #
  # Matching the container's uid instead would mean discovering it per image
  # tag; world-readable is the portable answer. What it exposes is bounded on
  # purpose: this file holds ONE password, for a role whose entire power is
  # calling a SECURITY DEFINER function that returns one user's verifier
  # (pgbouncer/setup-auth.sql). The valuable secrets — POSTGRES_PASSWORD,
  # JWT_SECRET, SECRET_ENCRYPTION_KEY — are in .env next door, which stays 0600.
  chmod 644 "$USERLIST"
  echo "[ensure-env-secrets] wrote ${USERLIST}"
  echo "[ensure-env-secrets] NOTE: the matching Postgres role is created by"
  echo "[ensure-env-secrets]       pgbouncer/setup-auth.sql — run it once against"
  echo "[ensure-env-secrets]       DIRECT_DATABASE_URL before starting pgbouncer."
fi

if [ "${PLACEHOLDERS_REPLACED:-0}" -eq 1 ]; then
  cat <<'EOF'

[ensure-env-secrets] ONE OR MORE SECRETS WERE PLACEHOLDERS AND HAVE BEEN REPLACED.
[ensure-env-secrets] The services holding the old values must be recreated, and
[ensure-env-secrets] anything encrypted with them re-supplied:
[ensure-env-secrets]
[ensure-env-secrets]   docker compose -f deploy/compose/managed.yml \
[ensure-env-secrets]     up -d --force-recreate trigger-api trigger-supervisor api
[ensure-env-secrets]   ./deploy/compose/set-task-env.sh    # re-encrypts the task environment
[ensure-env-secrets]
[ensure-env-secrets] Rotating TRIGGER_ENCRYPTION_KEY strands the Trigger.dev env-var store,
[ensure-env-secrets] which is why set-task-env.sh is not optional here. Rotating
[ensure-env-secrets] TRIGGER_LOGIN_SECRET or TRIGGER_SESSION_SECRET only signs people out.
EOF
fi

echo "[ensure-env-secrets] done — secrets present in ${ENV_FILE}"
