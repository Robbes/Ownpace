#!/usr/bin/env bash
# operator.sh — appoint and list the people who may answer the door, with the
# configuration the script cannot find on its own.
#
# `pnpm --filter @openmig/api operator:list` is the command docs/managed-bring-up.md
# §8c named, and on its own it fails:
#
#   Error: DATABASE_URL (the DB owner connection) is required.
#
# THE DOCUMENTED REMEDY WAS ALSO WRONG, which is why this exists rather than a
# corrected sentence. §8c said to read the value out of the env file:
#
#   DATABASE_URL="$(grep '^DATABASE_URL=' deploy/compose/.env | cut -d= -f2-)"
#
# `deploy/compose/.env` has no such line and never has: managed.yml COMPOSES
# DATABASE_URL for the api service out of POSTGRES_USER, POSTGRES_PASSWORD,
# DB_HOST, DB_PORT and POSTGRES_DB (managed.yml:742). So that grep returns the
# empty string on every stack there has ever been, the assignment succeeds, and
# the script refuses for a reason the operator has just apparently satisfied.
# Found 2026-08-31, by the owner running it on the Spark.
#
# This is seed-managed.sh's problem exactly, and this is seed-managed.sh's
# answer: a wrapper that composes what the host cannot inherit. Read that file
# too — its header explains both of the things this gets right:
#
#   The PORT comes from compose, not from a guess. On the reference box an
#   unrelated service owns 5432 while this stack's Postgres is published on
#   55432, so `localhost:5432` is a different database that may well answer.
#
#   It connects DIRECT rather than through the pooler, which is not published
#   to the host anyway. This needs the OWNER connection: `app_user` is granted
#   SELECT on platform_operator and nothing else (migration 0005), which is the
#   whole point of appointing being an act performed at the machine.
#
# Usage — the sub-command and its arguments pass straight through:
#
#   ./deploy/compose/operator.sh list
#   ./deploy/compose/operator.sh add <subject> <email> [note]
#   ./deploy/compose/operator.sh remove <subject>
#
# `<subject>` is the OIDC `sub`, never an email: sign in once, call
# `GET /api/me`, and read `userId` back. operator.ts's header says why.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml")

if [ "$#" -eq 0 ]; then
  echo "FATAL: no sub-command. Try one of:" >&2
  echo "  ./deploy/compose/operator.sh list" >&2
  echo "  ./deploy/compose/operator.sh add <subject> <email> [note]" >&2
  echo "  ./deploy/compose/operator.sh remove <subject>" >&2
  exit 1
fi

[ -f "$ENV_FILE" ] || {
  echo "FATAL: $ENV_FILE not found — run ./deploy/compose/bootstrap-managed.sh --only env" >&2
  exit 1
}
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is not set in .env — the owner connection needs it}"

hostport="$("${COMPOSE[@]}" port postgres 5432 2>/dev/null | tail -1)"
if [ -z "$hostport" ]; then
  echo "FATAL: could not determine the published host port for postgres." >&2
  echo "       Is it up?  docker compose -f deploy/compose/managed.yml up -d --wait postgres" >&2
  exit 1
fi
# compose answers 0.0.0.0:55432, and 0.0.0.0 is not an address to connect TO.
PGPORT_HOST="${hostport##*:}"

echo "[operator] ${POSTGRES_DB:-openmigrate} via localhost:${PGPORT_HOST} (the port compose reports)"

DATABASE_URL="postgresql://${POSTGRES_USER:-openmigrate}:${POSTGRES_PASSWORD}@localhost:${PGPORT_HOST}/${POSTGRES_DB:-openmigrate}" \
  pnpm --dir "$REPO_ROOT" --filter @openmig/api "operator:$1" -- "${@:2}"
