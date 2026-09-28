#!/usr/bin/env bash
# db-roles.sh — the two database roles' passwords: asked over the network, set
# over the socket, and never a value on a command line (workplan 0132 T2).
#
# A ROLE KEEPS THE PASSWORD IT WAS CREATED WITH, WHATEVER .env SAYS NOW.
# Postgres reads POSTGRES_PASSWORD once, when initdb creates the volume, and
# the first migration creates `app_user` with `app_password` when the role does
# not exist yet. After that, changing .env changes what the containers are
# told, never what the database holds. So a changed value has to be carried to
# the role with ALTER ROLE, and then proven the way the stack presents it.
#
# Sourced, never run. The functions here are the ones rotate-db-passwords.sh
# uses, and the ones T2 (b)'s bring-up is to call in its `data` phase, so the
# two cannot drift apart. The caller sets SCRIPT_DIR (this directory, as every
# script here does) and COMPOSE (its Compose command as an array, for this
# checkout's managed.yml). This file sources env-read.sh and own-addresses.sh
# from SCRIPT_DIR itself, and db_roles_init asks the project reader before any
# Compose command here runs.
#
#   db_roles_init <env-file>
#       reads the owner, the application role, the database and the two
#       passwords from .env, with compose's own defaults for an empty key
#       (managed.yml: ${POSTGRES_USER:-openmigrate},
#       ${POSTGRES_PASSWORD:-openmigrate_password}, ${POSTGRES_DB:-openmigrate},
#       ${APP_DB_USER:-app_user}, ${APP_DB_PASSWORD:-app_password}), and
#       COMPOSE_PROJECT from compose_project. Returns 2 when the project
#       cannot be read.
#   db_roles_list
#       the login roles, one `name|super|login` line each in DB_ROLES_LIST,
#       over the socket as the owner: names and flags, never a password.
#   db_roles_ask <network|pooler> <role> <password>
#       0 opens, 1 refused, 2 cannot tell (DB_ROLES_WHY says why).
#   db_roles_set <owner-password> <app-password>
#       ALTER ROLE on both roles in one transaction, over the socket as the
#       owner.
#   db_roles_prove <owner-password> <app-password>
#       each role opens with its value over the network AND through the
#       pooler: 0, 1 (one refuses) or 2 (one could not be asked).
#
# HOW A PASSWORD IS ASKED. Inside the database container the socket and
# 127.0.0.1 are trusted (the image's pg_hba.conf), so a password asked there
# opens whatever it is: scripts/the-check-postgres-never-made.unit.test.ts. A
# question about a password goes where the stack's own connections go: over
# the stack's network to `postgres`, from a throwaway client container on that
# network, or to PgBouncer's port inside its own container, where PgBouncer
# asks every connection for scram, loopback included, and looks the verifier up
# in Postgres (auth_query), so it answers with what the role holds now.
#
# HOW A VALUE TRAVELS. Never as an argument: an argument is on a command line,
# which `ps` shows every user on the machine. Each value is set in the
# environment of the one `docker` process that needs it and passed on BY NAME
# (`-e PGPASSWORD`, no `=`), and the ALTER reads it inside the container with
# psql's `\set name `printf …``, so the SQL text carries a variable, not the
# value. The ALTER runs with log_statement off and log_min_error_statement at
# panic, so a failing statement is not written to the database's log with the
# value in it. Nothing here prints a value, and nothing that sources this may
# use `set -x`.

# The client for a network question: the image the stack's postgres runs, so
# asking pulls nothing. scripts/rotate-db-passwords.unit.test.ts holds it to
# managed.yml.
DB_ROLES_CLIENT_IMAGE='postgres:18-alpine'

# env_value and compose_project, and own_address_redact for db_roles_masked.
# SCRIPT_DIR is the caller's, which is this directory.
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# shellcheck source=deploy/compose/own-addresses.sh
. "${SCRIPT_DIR}/own-addresses.sh"

# The statements db_roles_set sends. They name each value by a psql variable,
# and psql reads the value inside the container from the environment Compose
# was told to pass on by name. log_statement off and log_min_error_statement at
# panic keep a statement out of the database's log, failed or not.
read -r -d '' DB_ROLES_SET_SQL <<'SQL' || true
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_error_statement = panic;
BEGIN;
\set owner_pw `printf '%s' "$DB_ROLES_NEW_OWNER_PASSWORD"`
\set app_pw `printf '%s' "$DB_ROLES_NEW_APP_PASSWORD"`
ALTER ROLE :"app_role" PASSWORD :'app_pw';
ALTER ROLE :"owner_role" PASSWORD :'owner_pw';
COMMIT;
SQL

db_roles_init() { # db_roles_init <env-file>
  DB_ROLES_ENV_FILE="${1:-}"
  COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || return 2
  DB_ROLES_OWNER="$(env_value "$DB_ROLES_ENV_FILE" POSTGRES_USER openmigrate)"
  DB_ROLES_OWNER_PASSWORD="$(env_value "$DB_ROLES_ENV_FILE" POSTGRES_PASSWORD openmigrate_password)"
  DB_ROLES_DB="$(env_value "$DB_ROLES_ENV_FILE" POSTGRES_DB openmigrate)"
  DB_ROLES_APP="$(env_value "$DB_ROLES_ENV_FILE" APP_DB_USER app_user)"
  DB_ROLES_APP_PASSWORD="$(env_value "$DB_ROLES_ENV_FILE" APP_DB_PASSWORD app_password)"
  DB_ROLES_NETWORK="${COMPOSE_PROJECT}_ownpace-network"
  DB_ROLES_LIST=''
  DB_ROLES_WHY=''
}

# What went wrong, in one line, with no address in it: psql names the server's
# address, and a message may carry this machine's own (own-addresses.sh).
db_roles_masked() { # db_roles_masked <text>
  printf '%s\n' "${1:-}" |
    awk 'NF && shown < 2 { print; shown++ }' |
    own_address_redact "${DB_ROLES_ENV_FILE:-/dev/null}" |
    sed -E 's/[0-9]{1,3}(\.[0-9]{1,3}){3}/<address>/g; s/\(([0-9A-Fa-f]*:){2,}[0-9A-Fa-f]*\)/(<address>)/g' |
    tr '\n' ' ' | sed 's/[[:space:]]*$//'
}

db_roles_list() { # sets DB_ROLES_LIST; 0 listed, 2 could not ask
  local out
  if out=$("${COMPOSE[@]}" exec -T postgres psql -X -q -At -F '|' -U "$DB_ROLES_OWNER" -d "$DB_ROLES_DB" \
    -c 'SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolcanlogin ORDER BY 1' 2>&1); then
    DB_ROLES_LIST="$out"
    return 0
  fi
  DB_ROLES_LIST=''
  case "$out" in
    *"role \"${DB_ROLES_OWNER}\" does not exist"*)
      DB_ROLES_WHY="the owner POSTGRES_USER names in .env is not a role in this database. POSTGRES_USER applies at first initialisation only, so the name was changed after the volume was created; put back the name the database was created with."
      ;;
    *) DB_ROLES_WHY="$(db_roles_masked "$out")" ;;
  esac
  return 2
}

# True when DB_ROLES_LIST has <role> as a login role; with `super`, a login
# superuser.
db_roles_has() { # db_roles_has <role> [super]
  local name super login
  while IFS='|' read -r name super login; do
    [ "$name" = "${1:-}" ] || continue
    [ "$login" = t ] || return 1
    [ "${2:-}" != super ] || [ "$super" = t ] || return 1
    return 0
  done <<<"$DB_ROLES_LIST"
  return 1
}

db_roles_ask() { # db_roles_ask <network|pooler> <role> <password>
  local channel="${1:-}" role="${2:-}" out rc
  DB_ROLES_WHY=''
  case "$channel" in
    network)
      out=$(PGPASSWORD="${3:-}" docker run --rm -e PGPASSWORD --network "$DB_ROLES_NETWORK" \
        "$DB_ROLES_CLIENT_IMAGE" psql -h postgres -p 5432 -U "$role" -d "$DB_ROLES_DB" -tAc 'SELECT 1' 2>&1) && rc=0 || rc=$?
      ;;
    pooler)
      out=$(PGPASSWORD="${3:-}" "${COMPOSE[@]}" exec -T -e PGPASSWORD pgbouncer \
        psql -h 127.0.0.1 -p 6432 -U "$role" -d "$DB_ROLES_DB" -tAc 'SELECT 1' 2>&1) && rc=0 || rc=$?
      ;;
    *)
      DB_ROLES_WHY="no channel '${channel}'"
      return 2
      ;;
  esac
  if [ "$rc" -eq 0 ]; then
    return 0
  fi
  case "$out" in
    *"password authentication failed"*)
      DB_ROLES_WHY='password authentication failed'
      return 1
      ;;
  esac
  DB_ROLES_WHY="$(db_roles_masked "$out")"
  return 2
}

# Both roles in one transaction: either both take their new value or neither
# does. Over the socket, as the owner, which the image trusts there: that is
# what lets this repair a role whose password nobody has any more.
db_roles_set() { # db_roles_set <owner-password> <app-password>
  local out rc
  DB_ROLES_WHY=''
  if [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
    # An empty value would CLEAR the password: Postgres takes '' as none.
    DB_ROLES_WHY='an empty password was given; nothing was set'
    return 1
  fi
  out=$(DB_ROLES_NEW_OWNER_PASSWORD="$1" DB_ROLES_NEW_APP_PASSWORD="$2" \
    "${COMPOSE[@]}" exec -T -e DB_ROLES_NEW_OWNER_PASSWORD -e DB_ROLES_NEW_APP_PASSWORD postgres \
    psql -X -q -U "$DB_ROLES_OWNER" -d "$DB_ROLES_DB" -v ON_ERROR_STOP=1 \
    -v owner_role="$DB_ROLES_OWNER" -v app_role="$DB_ROLES_APP" 2>&1 <<<"$DB_ROLES_SET_SQL") && rc=0 || rc=$?
  [ "$rc" -eq 0 ] && return 0
  DB_ROLES_WHY="$(db_roles_masked "$out")"
  return 1
}

# Each role with its value, over the network and through the pooler: the two
# ways the stack's containers connect.
db_roles_prove() { # db_roles_prove <owner-password> <app-password>
  local refused=0 unasked=0 rc channel i
  local -a names=("$DB_ROLES_OWNER" "$DB_ROLES_APP") values=("${1:-}" "${2:-}")
  DB_ROLES_PROOF=''
  for i in 0 1; do
    for channel in network pooler; do
      rc=0
      db_roles_ask "$channel" "${names[$i]}" "${values[$i]}" || rc=$?
      DB_ROLES_PROOF+="${names[$i]}|${channel}|${rc}|${DB_ROLES_WHY}"$'\n'
      [ "$rc" -ne 1 ] || refused=1
      [ "$rc" -ne 2 ] || unasked=1
    done
  done
  # A refusal is an answer; a question that could not be asked is not.
  [ "$refused" -eq 0 ] || return 1
  [ "$unasked" -eq 0 ] || return 2
  return 0
}
