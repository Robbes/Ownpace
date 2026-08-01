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

echo "[ensure-env-secrets] done — secrets present in ${ENV_FILE}"
