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

# THE PASSWORD THE VOLUME NEVER HEARD OF.
#
# Postgres reads POSTGRES_PASSWORD once, when initdb creates the cluster.
# Change it afterwards and compose keeps handing the container a value the
# volume has never heard of: the role keeps the password it was created with,
# and nothing anywhere announces the divergence. This seed is usually the first
# thing to find out, and what it said was
#
#   Seed failed: password authentication failed for user "openmigrate"
#
# which reads like a typo in .env rather than two halves that have drifted
# apart, and says nothing about which of them to move. E2E (managed) #120 died
# exactly there (2026-09-01), after the same shape had already cost #117 and
# #118 on the demo Nextcloud's admin account.
#
# THE CHECK IS THE SEED'S OWN CONNECTION, not a probe beside it — and that is a
# correction, not a shortcut. A probe would have to reach Postgres the way this
# seed does, from the host through the published port, because the tempting
# `docker exec ownpace-db psql -h 127.0.0.1` is answered by pg_hba's `trust`
# line and succeeds with ANY password, wrong ones included. That vacuous check
# has been shipped here once already; the first draft of this block wrote it
# again, and scripts/the-check-postgres-never-made.unit.test.ts refused it.
# Reading the real attempt's own answer cannot be vacuous, because the attempt
# is the thing whose success we are reporting on (hard rule 10).
PGUSER_NAME="${POSTGRES_USER:-openmigrate}"

echo "[seed-managed] seeding ${POSTGRES_DB:-openmigrate} via localhost:${PGPORT_HOST} (the port compose reports)"

# Captured rather than streamed, so the failure can be read and named. The
# whole output is printed either way, unchanged and in order — nothing is
# swallowed, it just arrives at the end.
set +e
seed_out="$(DATABASE_URL="$DIRECT" \
  DIRECT_DATABASE_URL="$DIRECT" \
  JWT_SECRET="$JWT_SECRET" \
  SECRET_ENCRYPTION_KEY="$SECRET_ENCRYPTION_KEY" \
  pnpm --dir "$REPO_ROOT" --filter @openmig/api seed:managed 2>&1)"
seed_rc=$?
set -e
printf '%s\n' "$seed_out"

if [ "$seed_rc" -ne 0 ]; then
  case "$seed_out" in
  *"password authentication failed"*)
    {
      echo "FATAL: POSTGRES_PASSWORD in ${ENV_FILE} is not the password the role"
      echo "       '${PGUSER_NAME}' has inside the postgres volume."
      echo
      echo "       Postgres reads that variable once, when the volume is first created."
      echo "       Changing it afterwards changes what the container is TOLD, never what"
      echo "       the volume HOLDS."
      echo
      echo "       .env is the declaration everything else reads — the API, the pooler's"
      echo "       auth_query, Zitadel's admin connection — so move the database to it."
      echo "       From ${SCRIPT_DIR}:"
      echo
      cat <<'REMEDY'
export NEWPG="$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | head -1)"
docker exec -i -e NEWPG ownpace-db psql -U openmigrate -d openmigrate <<'SQL'
\set pw `printf '%s' "$NEWPG"`
ALTER ROLE openmigrate PASSWORD :'pw';
SQL
unset NEWPG
REMEDY
      echo
      echo "       The local socket inside the container is trusted, which is why that"
      echo "       works without the password you no longer have. Nothing else needs"
      echo "       changing: pgbouncer/userlist.txt holds only the powerless lookup role"
      echo "       and reads every other verifier from Postgres through auth_query."
    } >&2
    ;;
  esac
  exit "$seed_rc"
fi

echo "[seed-managed] done. The tokens above expire in 7 days — re-run this to mint fresh ones."
