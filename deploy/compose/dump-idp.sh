#!/usr/bin/env bash
# dump-idp.sh — a way back, taken just before the identity provider is upgraded
# (workplan 0135 T7, *Before an upgrade*).
#
# WHY IT EXISTS. Zitadel moves its schema one way when a newer version starts
# on a stack (0119 §3 item 2), and during the alpha nothing backs the stack up
# (0134 D1). So the only way back from an upgrade that goes wrong is a dump
# taken by hand just before it. The nightly gate drills Trigger.dev's database,
# not the identity provider's. The first such dump, for v4.19.1 on 2026-09-28,
# was four commands pasted from a chat. The owner asked the same day: "Can you
# give script i can use more often? since i need it for each update".
#
# WHAT IT DOES, from the checkout of the stack it is run in (the project comes
# from `compose_project`, so live's checkout dumps live and the OTA stack's
# dumps the OTA stack):
#
#   1. `pg_dump --format=custom` of the identity provider's database
#      (`ZITADEL_DB_NAME`, default `zitadel`) inside the stack's Postgres
#      container, as the server's own user.
#   2. `pg_dumpall --roles-only`, since pg_dump leaves out the roles, which a
#      restore onto a NEW server needs first.
#   3. Reads the dump back with that container's own `pg_restore --list`, so a
#      dump only a newer pg_restore could read is caught too, and refuses one
#      that is empty or does not read.
#   4. Writes a note beside the two: which image was running, what managed.yml
#      pins, the sizes and the entry count, a fingerprint of the master key the
#      dump needs (never the key), and the commands that go back to it.
#
# WHERE. Into `~/ownpace-dumps/<project>/`, or the directory `--dir` names,
# created readable by you alone. Every file carries the project and the moment
# in its name, and none is ever overwritten. A dump holds the provider's
# accounts, and the roles file its password hashes: keep both off shared places.
#
# WHAT IT NEVER DOES. It stops, starts and changes nothing: the stack keeps
# serving while it runs, and pg_dump reads one consistent snapshot. It does not
# copy `.env`. The dump is readable only with the ZITADEL_MASTERKEY in that
# file, and the runbook keeps a copy of it off the machine, apart from the
# dumps (docs/operator-runbook.md, *Backup & restore*). It prints no secret.
#
# THE WAY BACK, rehearsed on a scratch Postgres 16 on 2026-09-28 against a
# simulated upgrade (a new column, a new table, a new row): `pg_restore --clean
# --if-exists --create` into `postgres` drops the database and recreates it as
# dumped, with its owner and grants, and all three were gone. On the same
# server the roles are still there, and restoring them would set the
# provider's database password back to the dumped one, so the note restores
# them only on a new server.
#
# Usage:  ./deploy/compose/dump-idp.sh [--dir DIR]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
ENV_FILE="${SCRIPT_DIR}/.env"

usage() {
  cat <<'EOF'
Usage: ./deploy/compose/dump-idp.sh [--dir DIR]

Dumps this stack's identity provider database, with the server's roles, before
an upgrade, reads the dump back, and writes a note on how to go back to it.
Files go into ~/ownpace-dumps/<project>/ unless --dir names another directory.
EOF
}

DIR=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:-}"; [ -n "$DIR" ] || { usage >&2; exit 2; }; shift 2 ;;
    --dir=*) DIR="${1#--dir=}"; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "dump-idp: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
done

# The stack comes from this checkout, never from the shell: see env-read.sh.
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || exit 1
DB_CONTAINER="${COMPOSE_PROJECT}-db"
IDP_CONTAINER="${COMPOSE_PROJECT}-idp"

DB_NAME="$(env_value "$ENV_FILE" ZITADEL_DB_NAME)"
DB_NAME="${DB_NAME:-zitadel}"
case "$DB_NAME" in
  '' | *[!A-Za-z0-9_]*)
    echo "dump-idp: ZITADEL_DB_NAME in ${ENV_FILE} is not a plain database name." >&2
    exit 1
    ;;
esac

DIR="${DIR:-${HOME}/ownpace-dumps/${COMPOSE_PROJECT}}"
umask 077
if [ ! -d "$DIR" ]; then
  mkdir -p "$DIR"
  chmod 700 "$DIR"
fi
case "$(stat -c '%a' "$DIR")" in
  700) ;;
  *) echo "dump-idp: note: ${DIR} can be read by others; the dump holds the provider's accounts." >&2 ;;
esac

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WHEN="${STAMP:0:4}-${STAMP:4:2}-${STAMP:6:2} ${STAMP:9:2}:${STAMP:11:2}:${STAMP:13:2} UTC"
DUMP="${DIR}/${DB_NAME}-${COMPOSE_PROJECT}-${STAMP}.dump"
ROLES="${DIR}/roles-${COMPOSE_PROJECT}-${STAMP}.sql"
NOTE="${DIR}/${DB_NAME}-${COMPOSE_PROJECT}-${STAMP}.txt"
for f in "$DUMP" "$ROLES" "$NOTE"; do
  if [ -e "$f" ]; then
    echo "dump-idp: ${f} exists already; nothing was written." >&2
    exit 1
  fi
done

# Written under a working name and renamed when it has read back, so a file
# with the final name is always a dump that reads. A failure removes its own
# working files, and nothing else.
PARTS=()
cleanup() { [ "${#PARTS[@]}" -eq 0 ] || rm -f -- "${PARTS[@]}"; }
trap cleanup EXIT

RUNNING="$(docker inspect --format '{{.Config.Image}}' "$IDP_CONTAINER" 2>/dev/null || true)"
PINNED="$(sed -n '/^[[:space:]]*image:[[:space:]]*ghcr\.io\/zitadel\/zitadel:/{s/^[[:space:]]*image:[[:space:]]*\([^[:space:]#]*\).*/\1/p;q;}' "${SCRIPT_DIR}/managed.yml")"
echo "dump-idp: stack '${COMPOSE_PROJECT}', identity provider running ${RUNNING:-nothing (no ${IDP_CONTAINER} container)}"

echo "dump-idp: dumping database '${DB_NAME}' from ${DB_CONTAINER}"
PARTS+=("${DUMP}.partial")
if ! docker exec "$DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom' sh "$DB_NAME" >"${DUMP}.partial"; then
  echo "dump-idp: pg_dump failed in ${DB_CONTAINER}; is the stack's database running?" >&2
  exit 1
fi
PARTS+=("${ROLES}.partial")
if ! docker exec "$DB_CONTAINER" sh -c 'pg_dumpall -U "$POSTGRES_USER" --roles-only' >"${ROLES}.partial"; then
  echo "dump-idp: pg_dumpall --roles-only failed in ${DB_CONTAINER}." >&2
  exit 1
fi
if [ ! -s "${DUMP}.partial" ] || [ ! -s "${ROLES}.partial" ]; then
  echo "dump-idp: the dump or the roles came out empty; nothing was kept." >&2
  exit 1
fi

# Read back by the server's own pg_restore: the one a restore would use.
if ! LISTING="$(docker exec -i "$DB_CONTAINER" pg_restore --list <"${DUMP}.partial")"; then
  echo "dump-idp: the dump does not read back (pg_restore --list failed); nothing was kept." >&2
  exit 1
fi
ENTRIES="$(sed -n '/^;[[:space:]]*TOC Entries:/{s/^;[[:space:]]*TOC Entries:[[:space:]]*\([0-9]*\).*/\1/p;q;}' <<<"$LISTING")"
if [ -z "$ENTRIES" ] || [ "$ENTRIES" -eq 0 ]; then
  echo "dump-idp: the dump reads back with no entries; nothing was kept." >&2
  exit 1
fi

KEY="$(env_value "$ENV_FILE" ZITADEL_MASTERKEY)"
if [ -n "$KEY" ]; then
  FINGERPRINT="sha256:$(printf '%s' "$KEY" | sha256sum | cut -c1-12)"
else
  FINGERPRINT="unknown: ${ENV_FILE} has no ZITADEL_MASTERKEY"
fi
unset KEY
DUMP_BYTES="$(wc -c <"${DUMP}.partial" | tr -d ' ')"
ROLES_BYTES="$(wc -c <"${ROLES}.partial" | tr -d ' ')"
DUMP_NAME="$(basename "$DUMP")"
ROLES_NAME="$(basename "$ROLES")"

PARTS+=("${NOTE}.partial")
cat >"${NOTE}.partial" <<EOF
The identity provider's database of the stack '${COMPOSE_PROJECT}', dumped ${WHEN}
by deploy/compose/dump-idp.sh, before an upgrade.

  Running:     ${RUNNING:-unknown: no ${IDP_CONTAINER} container}
  Pinned:      ${PINNED:-unknown} (managed.yml in the checkout, when dumped)
  Database:    ${DB_NAME}, ${DUMP_NAME}, ${DUMP_BYTES} bytes, ${ENTRIES} entries read back
  Roles:       ${ROLES_NAME}, ${ROLES_BYTES} bytes
  Master key:  ${FINGERPRINT}
               The dump is readable only with the ZITADEL_MASTERKEY of this stack's
               deploy/compose/.env. This is a fingerprint of it, never the key.

TO GO BACK TO THIS DUMP, in the stack's checkout, with the dump's directory as
the current one for step 3:

  1. Put the provider back to the image under "Running": revert the upgrade's
     pull request. On the OTA stack, main must carry the revert too, since the
     nightly gate applies main.
  2. Stop the identity provider:
       docker compose -f deploy/compose/managed.yml stop zitadel
  3. Replace its database with the dump. It drops the database and creates it
     again as dumped, with its owner and grants:
       docker exec -i ${DB_CONTAINER} sh -c 'pg_restore -U "\$POSTGRES_USER" -d postgres --clean --if-exists --create' < ${DUMP_NAME}
     Only on a NEW server, where the roles are missing, first:
       docker exec -i ${DB_CONTAINER} sh -c 'psql -U "\$POSTGRES_USER" -d postgres' < ${ROLES_NAME}
     On the same server the roles are still there; restoring them would set the
     provider's database password back to the dumped one.
  4. Start it again, with the deploy/compose/.env whose master key matches the
     fingerprint above:
       docker compose -f deploy/compose/managed.yml up -d zitadel
  5. Sign in to the web app once.
EOF

mv -- "${DUMP}.partial" "$DUMP"
mv -- "${ROLES}.partial" "$ROLES"
mv -- "${NOTE}.partial" "$NOTE"
PARTS=()

cat <<EOF
dump-idp: dump done, ${ENTRIES} entries read back. In ${DIR}:
  ${DUMP_NAME}   ${DUMP_BYTES} bytes
  ${ROLES_NAME}   ${ROLES_BYTES} bytes
  $(basename "$NOTE")   what it is, and the way back
dump-idp: it is readable only with this stack's ZITADEL_MASTERKEY (${FINGERPRINT}).
dump-idp: keep a copy of deploy/compose/.env off this machine, apart from the dump.
EOF
