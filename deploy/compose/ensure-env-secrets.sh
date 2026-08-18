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

# ROTATING AN ENCRYPTION KEY IS NOT THE SAME AS FILLING IN A BLANK ONE.
#
# TRIGGER_ENCRYPTION_KEY encrypts the Trigger.dev secret store. Replacing it on
# an instance that already HAS secrets does not re-encrypt them — it strands
# them, and the failure is not at boot. It is
#
#   Error: Unsupported state or unable to authenticate data
#     at PrismaSecretStore.getSecrets
#     at AuthenticatedWorkerInstance.getEnvVars
#     at AuthenticatedWorkerInstance.startRunAttempt
#
# every time a run tries to start, surfacing to the operator as the supervisor
# looping on "Snapshot changed inside startRunAttempt" — a message about
# snapshots, with nothing in it about keys. It cost an afternoon on the
# reference box (2026-08-18), and a version rollback was blamed first.
#
# Re-running set-task-env.sh does NOT cure it: that re-encrypts the variables
# this repository owns, and the store holds more than those. The result is a
# MIXED store, where neither the old key nor the new one decrypts everything.
#
# So: this script fills in a MISSING key, which is safe, and refuses to replace
# an existing one, which is not. Rotating deliberately is a procedure, not a
# side effect — see docs/managed-bring-up.md.
needs_rotation_procedure() { # needs_rotation_procedure <name>
  [ "$1" = "TRIGGER_ENCRYPTION_KEY" ]
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

  if [ "$was_placeholder" -eq 1 ] && needs_rotation_procedure "$name"; then
    echo "[ensure-env-secrets] REFUSING to replace ${name}." >&2
    echo "[ensure-env-secrets] It holds a shipped placeholder, which is not a secret — and it is" >&2
    echo "[ensure-env-secrets] ALSO the key the Trigger.dev secret store is encrypted with. Replacing" >&2
    echo "[ensure-env-secrets] it here would strand every secret already written under it, and the" >&2
    echo "[ensure-env-secrets] symptom is runs that never start, reported as a snapshot error." >&2
    echo "[ensure-env-secrets]" >&2
    echo "[ensure-env-secrets] On a stack with no Trigger.dev data yet, rotate it and move on:" >&2
    echo "[ensure-env-secrets]   ./deploy/compose/env-upsert.sh ${ENV_FILE} ${name}=\$(openssl rand -hex ${bytes})" >&2
    echo "[ensure-env-secrets] On one that is running, follow the procedure in" >&2
    echo "[ensure-env-secrets] docs/managed-bring-up.md — 'Rotating TRIGGER_ENCRYPTION_KEY'." >&2
    REFUSED_ROTATION=1
    return 0
  fi

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
REFUSED_ROTATION=0

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

if [ "${REFUSED_ROTATION:-0}" -eq 1 ]; then
  echo "[ensure-env-secrets] done, EXCEPT the key named above — decide that one deliberately."
else
  echo "[ensure-env-secrets] done — secrets present in ${ENV_FILE}"
fi
