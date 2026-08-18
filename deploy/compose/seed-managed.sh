#!/usr/bin/env bash
# seed-managed.sh — run the demo seed with the configuration it cannot find on
# its own.
#
# `pnpm --filter @openmig/api seed:managed` is the command every document has
# named for months, and on its own it fails:
#
#   Seed failed: DATABASE_URL (DB owner connection) is required to seed
#
# The seed runs on the HOST. It is not a container, it inherits nothing from
# compose, and nothing in `apps/api` loads a dotenv file — so it reads
# DATABASE_URL, JWT_SECRET and SECRET_ENCRYPTION_KEY from whatever environment
# the caller happened to have. Every document that printed the bare command was
# assuming an environment nobody sets up.
#
# TWO THINGS THIS GETS RIGHT THAT A HAND-TYPED COMMAND USUALLY DOES NOT:
#
#   The PORT comes from compose, not from a guess. `localhost:5432` is the
#   obvious thing to type and it is somebody else's database on any host
#   running more than one thing — on the reference box an unrelated service
#   owns 5432 while this stack's Postgres is published on 55432. A wrong
#   password makes that a loud failure rather than a silent write to a
#   stranger's database, but a loud failure naming the wrong cause still costs
#   an evening.
#
#   It connects DIRECT, never through the pooler. The seed runs the migrations,
#   which hold a session-scoped advisory lock (see packages/ledger/direct-url.ts).
#   The pooler is not published to the host anyway, which is a hint rather than
#   a guarantee.
#
# The tokens it prints expire in SEVEN DAYS. Re-running is the way to mint fresh
# ones; the seed is idempotent and re-running costs nothing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml")

[ -f "$ENV_FILE" ] || {
  echo "FATAL: $ENV_FILE not found — run ./deploy/compose/bootstrap-managed.sh --only env" >&2
  exit 1
}
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${JWT_SECRET:?JWT_SECRET is not set in .env — the seed signs demo tokens with it, and the API must share the value}"
: "${SECRET_ENCRYPTION_KEY:?SECRET_ENCRYPTION_KEY is not set in .env — the seed encrypts the demo connection credentials with it}"

hostport="$("${COMPOSE[@]}" port postgres 5432 2>/dev/null | tail -1)"
if [ -z "$hostport" ]; then
  echo "FATAL: could not determine the published host port for postgres." >&2
  echo "       Is it up?  docker compose -f deploy/compose/managed.yml up -d --wait postgres" >&2
  exit 1
fi
# compose answers 0.0.0.0:55432, and 0.0.0.0 is not an address to connect TO.
PGPORT_HOST="${hostport##*:}"

DIRECT="postgresql://${POSTGRES_USER:-openmigrate}:${POSTGRES_PASSWORD}@localhost:${PGPORT_HOST}/${POSTGRES_DB:-openmigrate}"

echo "[seed-managed] seeding ${POSTGRES_DB:-openmigrate} via localhost:${PGPORT_HOST} (the port compose reports)"

DATABASE_URL="$DIRECT" \
  DIRECT_DATABASE_URL="$DIRECT" \
  JWT_SECRET="$JWT_SECRET" \
  SECRET_ENCRYPTION_KEY="$SECRET_ENCRYPTION_KEY" \
  pnpm --dir "$REPO_ROOT" --filter @openmig/api seed:managed

echo "[seed-managed] done. The tokens above expire in 7 days — re-run this to mint fresh ones."
