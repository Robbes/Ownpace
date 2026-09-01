#!/usr/bin/env bash
# zitadel-db-password.sh — does the `zitadel` Postgres role accept what .env says?
#
#   ./deploy/compose/zitadel-db-password.sh            # check, change nothing
#   ./deploy/compose/zitadel-db-password.sh --sync     # set the ROLE to .env's value
#
# Exit codes, because bootstrap-managed.sh acts on them:
#   0  the role accepts it — or role and database do not exist yet (first run)
#   1  the role REFUSES it
#   2  nothing was established: the question could not be asked
#
# WHY EVERY QUERY HERE CARRIES `-h`, AND WHY THAT IS THE WHOLE POINT.
#
# `docker exec ownpace-db psql -U zitadel` connects over the UNIX SOCKET, and
# the official Postgres image's generated pg_hba.conf trusts the socket and
# 127.0.0.1 outright (`local all all trust`). PGPASSWORD is never sent and
# never checked: the query succeeds with ANY password, including a wrong one.
# Only a connection to the container's real network address matches the
# appended `host all all all scram-sha-256` line — which is the line Zitadel's
# own connection, arriving from another container, matches.
#
# The first version of this script asked over the socket. On 2026-08-24 it told
# an operator "the zitadel role accepts the password in .env — nothing to do",
# twice, and then Zitadel presented that same password over the network and was
# refused: `failed SASL auth: FATAL: password authentication failed for user
# "zitadel" (SQLSTATE 28P01)`, after the bring-up had spent the full 300-second
# readiness timeout looking like a slow boot. And because the vacuous pass
# short-circuits everything below it, `--sync` refused to perform the repair:
# the check said there was nothing to repair.
#
# managed.yml's own header has said this since 2026-07-25 — "a local-socket/
# 127.0.0.1 psql check ... never actually check the password ... only a
# connection from another container's real IP exercises the scram-sha-256 rule".
# It was written about the `openmigrate` role. Nobody carried it thirty lines
# down the same file to `zitadel`.
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
# Inside the container Postgres listens on 5432 whatever POSTGRES_PORT publishes
# on the host. This is a container-to-itself connection, so the published port
# is not involved.
DB_PORT=5432

say() { echo "[zitadel-db-password] $*"; }
die() { echo "[zitadel-db-password] FATAL: $*" >&2; exit 1; }
# Exit 2, not 1: "the role refuses the password" and "I could not ask" are
# different answers, and a caller that cannot tell them apart will send an
# operator to ALTER ROLE for a database that was merely still starting
# (hard rule 9).
cannot_tell() { echo "[zitadel-db-password] NOT ESTABLISHED: $*" >&2; exit 2; }

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
  v="$(grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
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

# --------------------------------------------------------- the real channel --

# The container's own address on the compose network — the only kind of
# address that gets the password looked at.
#
# Reads whatever the container can tell us about itself on stdin and prints the
# first routable address in it, or nothing. Loopback is DISCARDED rather than
# preferred-against: `-h 127.0.0.1` is answered by the same `trust` line as the
# socket, so accepting one would leave this check exactly as vacuous as the one
# it replaces.
first_routable_address() {
  tr -s ' \t' '\n\n' |
    grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$|^[0-9a-fA-F]*:[0-9a-fA-F:]+$' |
    grep -Ev '^(127\.|::1$|0\.0\.0\.0$)' |
    awk 'NR==1'
}

# A GLOBAL set by a function rather than a `$(...)` result, deliberately:
# `exit 2` inside a command substitution leaves only the subshell, and the
# caller would carry on with an empty address — which psql reads as "use the
# socket". The failure this script exists to stop would then be reintroduced by
# the code that detects it.
#
# Three sources because one command is one dependency: busybox and GNU
# `hostname -i` disagree about what they print, `getent` is absent from musl
# images, and /etc/hosts is always there. All three are asked, the answers are
# pooled, and the filter above decides.
resolve_db_addr() { # sets DB_ADDR
  local out
  out="$(docker exec "$CONTAINER" sh -c '
      hostname -i 2>/dev/null || true
      getent hosts "$(hostname)" 2>/dev/null || true
      grep -w "$(hostname)" /etc/hosts 2>/dev/null || true
    ' 2>&1)" ||
    cannot_tell "could not ask ${CONTAINER} for its own address:
    ${out}"

  DB_ADDR="$(printf '%s\n' "$out" | first_routable_address || true)"
  [ -n "$DB_ADDR" ] || cannot_tell "${CONTAINER} reports no routable address of its own (got: ${out}).
    Asking over the loopback instead is not an option: pg_hba.conf answers that
    with \`trust\`, so the check would pass without the password being looked
    at. Read this script's header."
}
resolve_db_addr

ask_pg() { # ask_pg <user> <password> <database> — prints psql's output, returns its status
  docker exec -e PGPASSWORD="$2" "$CONTAINER" \
    psql -h "$DB_ADDR" -p "$DB_PORT" -U "$1" -d "$3" -tAc 'SELECT 1' 2>&1
}

# --------------------------------------------------------------------- check --

# The SAME question the container asks at start-up, asked over the same kind of
# connection with the same credential. Anything else here would be a different
# test wearing this one's name.
if out="$(ask_pg "$ZITADEL_USER" "$ZITADEL_PASS" "$ZITADEL_DB")"; then
  say "the ${ZITADEL_USER} role accepts the password in .env — nothing to do"
  say "  (asked over ${DB_ADDR}:${DB_PORT}, the way Zitadel asks — not the socket)"
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
    cannot_tell "could not ask ${CONTAINER} at ${DB_ADDR}:${DB_PORT} at all, so nothing
    is established about the password:
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
#
# Doubled quotes because the value is a literal in SQL text and there is no
# parameter form of ALTER ROLE. A generated secret has no quote in it; a
# hand-set one might, and the failure mode of not doing this is an ALTER that
# sets a DIFFERENT password than the one in .env and then reports success.
say "setting the ${ZITADEL_USER} role's password to the value in .env"
docker exec -e PGPASSWORD="$ADMIN_PASS" -i "$CONTAINER" \
  psql -h "$DB_ADDR" -p "$DB_PORT" -U "$ADMIN_USER" -d postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
ALTER ROLE "${ZITADEL_USER//\"/\"\"}" WITH PASSWORD '${ZITADEL_PASS//\'/\'\'}';
SQL

# PROVE IT, rather than trusting that a command which exited 0 achieved the
# thing. The ALTER could succeed against a role nobody uses, or a pooler could
# be serving a cached authentication — and "it ran" is not "it works". Over the
# network for the same reason as the check: a proof the socket would have given
# for free proves nothing.
ask_pg "$ZITADEL_USER" "$ZITADEL_PASS" "$ZITADEL_DB" >/dev/null ||
  die "the ALTER ROLE succeeded and the role still refuses the password. Nothing
    else here can explain that; read ${CONTAINER}'s log."

say "done — the ${ZITADEL_USER} role now accepts it. Restart the provider:"
say "    docker compose -f ${SCRIPT_DIR}/managed.yml restart zitadel"
