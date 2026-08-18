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

ensure() { # ensure <name> <bytes>
  local name="$1" bytes="$2"
  if ! grep -qE "^${name}=." "$ENV_FILE"; then
    # Drop an empty `NAME=` line left over from copying managed.env.example,
    # then append the generated value.
    sed -i "/^${name}=$/d" "$ENV_FILE"
    echo "${name}=$(openssl rand -hex "$bytes")" >>"$ENV_FILE"
    echo "[ensure-env-secrets] generated ${name}"
  fi
}

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

echo "[ensure-env-secrets] done — secrets present in ${ENV_FILE}"
