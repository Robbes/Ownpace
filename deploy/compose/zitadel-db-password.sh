#!/usr/bin/env bash
# zitadel-db-password.sh — does the `zitadel` Postgres role accept what .env says?
#
#   ./deploy/compose/zitadel-db-password.sh            # check, change nothing
#   ./deploy/compose/zitadel-db-password.sh --sync     # set the ROLE to .env's value
#
# WHY THIS IS A SCRIPT AND NOT A PASTED COMMAND.
#
# The repair is one ALTER ROLE, and the obvious way to hand it over is to print
# it. But it needs POSTGRES_USER and POSTGRES_PASSWORD, which exist inside
# `ownpace-db` and NOT in the operator's shell — the exact shape
# `scripts/pasteable-hints.unit.test.ts` was written to refuse, twice over,
# after operators pasted such a hint and got `role "root" does not exist`. A
# printed `set -a; . .env; set +a` first would make it work, and would also
# make a one-line remedy into a four-line ritual that has to be transcribed
# exactly while something is already broken.
#
# So the remedy is a thing you run, and the values never leave this process.
#
# WHAT GOES WRONG WITHOUT IT. Zitadel finds an existing role, logs
# `user already exists, skipping creation`, and does NOT reset its password. So
# a `.env` whose ZITADEL_DB_PASSWORD no longer matches the role produces a
# container that crash-loops on every restart — indistinguishable from a slow
# boot until the readiness timeout expires several minutes later, and then
# reported as an authentication failure for a password nobody changed.
#
# BEFORE YOU --sync: if a second `.env` exists on this box (the nightly gate
# keeps one under ~/.persistent/ownpace-managed/), the role may be matching
# THAT one, and pointing it at this file breaks the other consumer instead.
# bootstrap-managed.sh lists any divergence at the top of every phase. The
# durable fix is one file — see docs/managed-bring-up.md, "One box, one stack,
# one .env".
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
CONTAINER="${OWNPACE_DB_CONTAINER:-ownpace-db}"

say() { echo "[zitadel-db-password] $*"; }
die() { echo "[zitadel-db-password] FATAL: $*" >&2; exit 1; }

SYNC=0
case "${1:-}" in
  --sync) SYNC=1 ;;
  ''|--check) ;;
  *) die "unknown argument '${1}'. Usage: $(basename "$0") [--check|--sync]" ;;
esac

[ -f "$ENV_FILE" ] || die "${ENV_FILE} does not exist — run bootstrap-managed.sh --only env first."

# Read rather than source: this file is sourced by plenty already, and a script
# whose whole job is credentials should not also import every other one.
read_env() { # read_env <key> [default]
  local v
  # `|| true` because a missing key is a normal answer, and `set -o pipefail`
  # would otherwise make grep's empty result fail the script.
  v="$(grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  [ -n "$v" ] && printf '%s' "$v" || printf '%s' "${2:-}"
}

ZITADEL_USER="$(read_env ZITADEL_DB_USER zitadel)"
ZITADEL_DB="$(read_env ZITADEL_DB_NAME zitadel)"
ZITADEL_PASS="$(read_env ZITADEL_DB_PASSWORD)"
ADMIN_USER="$(read_env POSTGRES_USER openmigrate)"
ADMIN_PASS="$(read_env POSTGRES_PASSWORD openmigrate_password)"

[ -n "$ZITADEL_PASS" ] ||
  die "ZITADEL_DB_PASSWORD is empty in ${ENV_FILE}. Run ./deploy/compose/ensure-env-secrets.sh"

docker inspect "$CONTAINER" >/dev/null 2>&1 ||
  die "no ${CONTAINER} container — bring the database up first:
    docker compose -f ${SCRIPT_DIR}/managed.yml up -d --wait postgres"

# --------------------------------------------------------------------- check --

# The SAME question the container asks at start-up, asked with the same
# credential. Anything else here would be a different test wearing its name.
if out="$(docker exec -e PGPASSWORD="$ZITADEL_PASS" "$CONTAINER" \
    psql -U "$ZITADEL_USER" -d "$ZITADEL_DB" -tAc 'SELECT 1' 2>&1)"; then
  say "the ${ZITADEL_USER} role accepts the password in .env — nothing to do"
  exit 0
fi

case "$out" in
  *"does not exist"*)
    say "no ${ZITADEL_USER} role or ${ZITADEL_DB} database yet."
    say "Zitadel creates both on first start, using the POSTGRES_* admin credentials."
    exit 0 ;;
  *"password authentication failed"*) : ;;
  *)
    # Not "assume it is the password": an unreachable database, a wrong
    # container, a Postgres still starting up all land here, and calling any of
    # them an authentication failure would send the operator to ALTER ROLE for
    # a problem that is not one (hard rule 9).
    die "could not ask ${CONTAINER} at all, so nothing is established about the password:
    ${out}" ;;
esac

say "the ${ZITADEL_USER} role does NOT accept the password in .env."

if [ "$SYNC" != "1" ]; then
  say "Zitadel will present this and be refused, then crash-loop."
  say "To point the ROLE at this .env (leaves all Zitadel data intact):"
  say "    ./deploy/compose/zitadel-db-password.sh --sync"
  say "Read this script's header first if a second .env exists on this box."
  exit 1
fi

# ---------------------------------------------------------------------- sync --

# Over stdin, never as an argument: a password in argv is visible in `ps` to
# every user on the box and lands in the operator's shell history.
say "setting the ${ZITADEL_USER} role's password to the value in .env"
docker exec -e PGPASSWORD="$ADMIN_PASS" -i "$CONTAINER" \
  psql -U "$ADMIN_USER" -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
ALTER ROLE ${ZITADEL_USER} WITH PASSWORD '${ZITADEL_PASS}';
SQL

# PROVE IT, rather than trusting that a command which exited 0 achieved the
# thing. The ALTER could succeed against a role nobody uses, or a pooler could
# be serving a cached authentication — and "it ran" is not "it works".
docker exec -e PGPASSWORD="$ZITADEL_PASS" "$CONTAINER" \
  psql -U "$ZITADEL_USER" -d "$ZITADEL_DB" -tAc 'SELECT 1' >/dev/null 2>&1 ||
  die "the ALTER ROLE succeeded and the role still refuses the password. Nothing
    else here can explain that; read ${CONTAINER}'s log."

say "done — the ${ZITADEL_USER} role now accepts it. Restart the provider:"
say "    docker compose -f ${SCRIPT_DIR}/managed.yml restart zitadel"
