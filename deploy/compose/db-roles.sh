#!/usr/bin/env bash
# db-roles.sh — the database roles' passwords: asked over the network, set
# over the socket, and never a value on a command line (workplan 0132 T2); and
# the system role the tasks across organisations connect as, asked what it may
# do before its password is set (workplan 0138 T3 step 2).
#
# A ROLE KEEPS THE PASSWORD IT WAS CREATED WITH, WHATEVER .env SAYS NOW.
# Postgres reads POSTGRES_PASSWORD once, when initdb creates the volume, and
# the first migration creates `app_user` with `app_password` when the role does
# not exist yet. After that, changing .env changes what the containers are
# told, never what the database holds. So a changed value has to be carried to
# the role with ALTER ROLE, and then proven the way the stack presents it.
#
# Sourced, never run. The functions here are the ones rotate-db-passwords.sh
# uses, and the ones the bring-up's `data` phase calls on every run
# (bootstrap-managed.sh, database_roles_match_env), so the two cannot drift
# apart. The caller sets SCRIPT_DIR (this directory, as every
# script here does) and COMPOSE (its Compose command as an array, for this
# checkout's managed.yml). This file sources env-read.sh and own-addresses.sh
# from SCRIPT_DIR itself, and db_roles_init asks the project reader before any
# Compose command here runs.
#
#   db_roles_init <env-file>
#       reads the owner, the application role, the database and the two
#       passwords from .env as Compose reads them: one pair of surrounding
#       double quotes removed (env_value keeps them, Compose and bash do not),
#       then compose's own default for a key that is empty
#       (managed.yml: ${POSTGRES_USER:-openmigrate},
#       ${POSTGRES_PASSWORD:-openmigrate_password}, ${POSTGRES_DB:-openmigrate},
#       ${APP_DB_USER:-app_user}, ${APP_DB_PASSWORD:-app_password}), and
#       COMPOSE_PROJECT from compose_project. Returns 2 when the project
#       cannot be read. Otherwise a role would be set to `"value"`, quotes and
#       all, which no container presents.
#   db_roles_list
#       the login roles, one `name|super|login` line each in DB_ROLES_LIST,
#       over the socket as the owner: names and flags, never a password.
#   db_roles_ask <network|pooler> <role> <password>
#       0 opens, 1 refused, 2 cannot tell (DB_ROLES_WHY says why).
#   db_roles_set <owner-password> <app-password>
#       both roles set in one transaction, over the socket as the owner. The
#       application role is CREATED with LOGIN when it does not exist yet, as
#       the bring-up's data phase needs before the first migration runs: 0001
#       creates app_user only when it is absent, and with a password this
#       repository publishes. --sync and --rotate refuse before this when the
#       role is missing, so for them it is always an ALTER.
#   db_roles_prove <owner-password> <app-password>
#       each role opens with its value over the network AND through the
#       pooler: 0, 1 (one refuses) or 2 (one could not be asked).
#
# THE SYSTEM ROLE (workplan 0138 T3 step 2). `ownpace_system`, by the name
# managed migration 0033 creates it under, which is not .env's to choose: the
# migration grants to it by name. The Trigger.dev jobs that span organisations
# (the sync tick, retention, the purge), the split jobs' list and every task's
# audit key connect as it through SYSTEM_DATABASE_URL, which set-task-env.sh
# uploads to every run. The migration made it with no password and nothing a
# superuser has but BYPASSRLS; what the database holds now is asked, not
# assumed, every time its URL is about to go up: by the bring-up's tasks phase
# before it sets the password, and by set-task-env.sh before every upload, the
# bring-up's or one run by hand.
#
#   db_roles_system_fit
#       asks the catalog, over the socket as the owner, for the role's
#       attributes, the roles it belongs to and the roles that belong to it:
#       0 fit (a login role that is no superuser, may create no role or
#       database, does not replicate, belongs to no role, has no role
#       belonging to it, and has BYPASSRLS), 1 unfit or missing (DB_ROLES_WHY
#       names every reason), 2 could not ask. Membership counts both ways: a
#       role it belongs to lends it that role's rights with SET ROLE, and a
#       role that belongs to it (`GRANT ownpace_system TO app_user`) takes its
#       BYPASSRLS and grants the same way.
#   db_roles_system_set <password>
#       ALTER ROLE with .env's SYSTEM_DB_PASSWORD, over the socket as the
#       owner, the value passed by name as db_roles_set passes its two; and,
#       in the same transaction, every setting on the role cleared, for every
#       database and for this one. An ordinary role may change its own
#       password and its own settings, and every run holds its URL: a run
#       taken over could leave `default_transaction_read_only = on` on it,
#       which stops every write the jobs make and survives a new password.
#   db_roles_system_prove <password>
#       the role opens with it over the network AND through the pooler,
#       where the tasks connect: 0, 1 (refused) or 2 (could not be asked).
#
# TRIGGER.DEV'S OWN DATABASE (workplan 0132 T2, step A). `trigger-db` is a
# Postgres of its own, and its one role, `trigger`, is the image's bootstrap
# superuser: managed.yml writes POSTGRES_USER and POSTGRES_DB there, not from
# .env, and they are named once below. Its one client is trigger-api
# (DATABASE_URL and DIRECT_URL), and no pooler stands in front of it.
#
#   db_roles_trigger_set <password>
#       ALTER ROLE trigger, over trigger-db's own socket as trigger, which the
#       image trusts there, the value passed by name and the statement kept
#       out of the log and the statistics, as db_roles_set does for its two.
#   db_roles_trigger_ask <password>
#       over the stack's network to trigger-db, as trigger-api asks it:
#       0 opens, 1 refused, 2 cannot tell (DB_ROLES_WHY says why).
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
# psql's `\set name `printf …``, so the SQL text a container is given carries
# a variable, not the value. The statement runs with log_statement off,
# log_min_error_statement at panic and pg_stat_statements.track_utility off,
# so a statement is not written to the database's log, failed or not, and not
# kept in the query statistics, even on a server configured otherwise
# (managed.yml turns track_utility off for the whole server too). Nothing here
# prints a value, and nothing that sources this may use `set -x`.
#
# WHY NOT A SESSION SETTING. Workplan 0132 §3 T2 proposed passing each value
# as a session setting, the way setup-auth.sql takes pgbouncer_auth's from
# PGOPTIONS. This file was built after that, and does what the setting was for
# with a psql variable read from the environment: the value is on no command
# line and in no SQL text a container is given. The rotation runs on it, and
# the owner ran that on the OTA stack on 2026-10-05; the bring-up calls the
# same function rather than a second mechanism.

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
# panic keep a statement out of the database's log, failed or not, and
# track_utility off keeps it out of pg_stat_statements. The application role
# is made, with LOGIN and nothing else (0001's own form), when the catalog has
# no role of that name; otherwise its password is set.
# scripts/a-password-the-repository-knows.unit.test.ts runs it against a stub
# that applies it; it was run against a real Postgres when it was written.
read -r -d '' DB_ROLES_SET_SQL <<'SQL' || true
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_error_statement = panic;
SET pg_stat_statements.track_utility = off;
BEGIN;
\set owner_pw `printf '%s' "$DB_ROLES_NEW_OWNER_PASSWORD"`
\set app_pw `printf '%s' "$DB_ROLES_NEW_APP_PASSWORD"`
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') AS app_role_missing \gset
\if :app_role_missing
CREATE ROLE :"app_role" LOGIN PASSWORD :'app_pw';
\else
ALTER ROLE :"app_role" PASSWORD :'app_pw';
\endif
ALTER ROLE :"owner_role" PASSWORD :'owner_pw';
COMMIT;
SQL

# The system role's name: managed migration 0033's, never .env's.
DB_ROLES_SYSTEM='ownpace_system'

# The question db_roles_system_fit asks: one line, `|`-separated, in this
# order: superuser, create role, create database, replication, BYPASSRLS,
# login, how many roles it is a member of, and how many roles are members of
# it. No line: no such role. The name goes by a psql variable, never into the
# text. a-system-role-that-is-not-the-owner (integration) asks it of a real
# database.
read -r -d '' DB_ROLES_SYSTEM_FIT_SQL <<'SQL' || true
SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls, r.rolcanlogin,
       (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid),
       (SELECT count(*) FROM pg_auth_members m WHERE m.roleid = r.oid)
  FROM pg_roles r
 WHERE r.rolname = :'system_role';
SQL

# The statements db_roles_system_set sends: the value by a psql variable, read
# inside the container from the environment Compose was told to pass on by
# name, and the statements kept out of the database's log, failed or not. With
# the password, in one transaction, every setting on the role: the ones for
# every database, and the ones for this one (DBNAME, psql's own variable for
# the database it is connected to), which RESET ALL without IN DATABASE leaves
# in place. a-system-role-that-is-not-the-owner (integration) runs the two
# RESET lines against a real database after the role has set both kinds.
read -r -d '' DB_ROLES_SYSTEM_SET_SQL <<'SQL' || true
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_error_statement = panic;
SET pg_stat_statements.track_utility = off;
BEGIN;
\set system_pw `printf '%s' "$DB_ROLES_NEW_SYSTEM_PASSWORD"`
ALTER ROLE :"system_role" PASSWORD :'system_pw';
ALTER ROLE :"system_role" RESET ALL;
ALTER ROLE :"system_role" IN DATABASE :"DBNAME" RESET ALL;
COMMIT;
SQL

# trigger-db's role and database: managed.yml's, never .env's.
# scripts/rotate-db-passwords.unit.test.ts holds them to managed.yml.
DB_ROLES_TRIGGER_ROLE='trigger'
DB_ROLES_TRIGGER_DB='triggerdb'

# The statements db_roles_trigger_set sends, kept out of the log as the two
# above are. trigger-db runs the image's defaults: log_statement none,
# log_min_error_statement error (a failed statement is logged with its text),
# and no pg_stat_statements. Its role is a superuser, so the four SETs are
# allowed, and with no module loaded the last one only makes a placeholder;
# it is there so that a trigger-db configured otherwise one day still keeps
# the statement out. Run against a Postgres 16 with log_statement = all, both
# with the module preloaded and without it, when it was written.
read -r -d '' DB_ROLES_TRIGGER_SET_SQL <<'SQL' || true
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_error_statement = panic;
SET pg_stat_statements.track_utility = off;
BEGIN;
\set trigger_pw `printf '%s' "$DB_ROLES_NEW_TRIGGER_PASSWORD"`
ALTER ROLE :"trigger_role" PASSWORD :'trigger_pw';
COMMIT;
SQL

# db_roles_env <key> <default> — a value of .env as Compose reads it: without
# one pair of surrounding double quotes, and the default when that leaves
# nothing, as `${KEY:-default}` gives the containers. The same reading as
# shipped-passwords.sh's shipped_password_bare, with which the bring-up judges
# the same lines; this file does not source that one, so that the scripts
# and tests that copy this one need nothing more.
db_roles_env() {
  local value
  value="$(env_value "$DB_ROLES_ENV_FILE" "$1")"
  if [ "${#value}" -ge 2 ] && [ "${value:0:1}" = '"' ] && [ "${value: -1}" = '"' ]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "${value:-$2}"
}

db_roles_init() { # db_roles_init <env-file>
  DB_ROLES_ENV_FILE="${1:-}"
  COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || return 2
  DB_ROLES_OWNER="$(db_roles_env POSTGRES_USER openmigrate)"
  DB_ROLES_OWNER_PASSWORD="$(db_roles_env POSTGRES_PASSWORD openmigrate_password)"
  DB_ROLES_DB="$(db_roles_env POSTGRES_DB openmigrate)"
  DB_ROLES_APP="$(db_roles_env APP_DB_USER app_user)"
  DB_ROLES_APP_PASSWORD="$(db_roles_env APP_DB_PASSWORD app_password)"
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
  db_roles_answer "$rc" "$out"
}

# What a password question's psql answered: 0 opens, 1 refused, 2 cannot tell,
# with DB_ROLES_WHY saying why. Postgres answers "password authentication
# failed" for a role that does not exist too, so a caller asks only a role it
# knows exists.
db_roles_answer() { # db_roles_answer <psql's exit> <its output>
  if [ "${1:-1}" -eq 0 ]; then
    return 0
  fi
  case "${2:-}" in
    *"password authentication failed"*)
      DB_ROLES_WHY='password authentication failed'
      return 1
      ;;
  esac
  DB_ROLES_WHY="$(db_roles_masked "${2:-}")"
  return 2
}

# Both roles in one transaction: either both take their new value or neither
# does. Over the socket, as the owner, which the image trusts there: that is
# what lets this repair a role whose password nobody has any more, and make
# the application role before anything has migrated.
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

# The system role, asked of the catalog before its password is set and its URL
# uploaded: every reason it is unfit, at once, in DB_ROLES_WHY.
db_roles_system_fit() { # 0 fit, 1 unfit or missing, 2 could not ask
  local out rc super createrole createdb replication bypass login members held joined reason
  local -a unfit=()
  DB_ROLES_WHY=''
  out=$("${COMPOSE[@]}" exec -T postgres psql -X -q -At -F '|' -U "$DB_ROLES_OWNER" -d "$DB_ROLES_DB" \
    -v ON_ERROR_STOP=1 -v system_role="$DB_ROLES_SYSTEM" 2>&1 <<<"$DB_ROLES_SYSTEM_FIT_SQL") && rc=0 || rc=$?
  if [ "$rc" -ne 0 ]; then
    DB_ROLES_WHY="$(db_roles_masked "$out")"
    return 2
  fi
  if [ -z "$out" ]; then
    DB_ROLES_WHY="${DB_ROLES_SYSTEM} is not a role in this database: managed migration 0033 creates it, and the api applies the migrations when it starts (the app phase)"
    return 1
  fi
  IFS='|' read -r super createrole createdb replication bypass login members held <<<"$out"
  [ "$super" = f ] || unfit+=('it is a superuser, whom row security never binds and who may run programs on the database server')
  [ "$createrole" = f ] || unfit+=('it may create roles, and so change its own')
  [ "$createdb" = f ] || unfit+=('it may create databases')
  [ "$replication" = f ] || unfit+=('it may replicate the whole cluster')
  [ "$members" = 0 ] || unfit+=("it belongs to ${members} role(s), whose rights it takes with SET ROLE")
  [ "$held" = 0 ] || unfit+=("${held:-an unknown number of} role(s) belong to it, and take its BYPASSRLS and grants with SET ROLE: every organisation's rows")
  [ "$bypass" = t ] || unfit+=('it lacks BYPASSRLS, so the jobs across organisations would find no organisation and call it a quiet night')
  [ "$login" = t ] || unfit+=('it cannot log in')
  [ "${#unfit[@]}" -eq 0 ] && return 0
  joined=''
  for reason in "${unfit[@]}"; do joined+="${joined:+; }${reason}"; done
  DB_ROLES_WHY="${DB_ROLES_SYSTEM}: ${joined}"
  return 1
}

# The system role's password, set the way db_roles_set sets the other two,
# and every setting on the role cleared with it.
db_roles_system_set() { # db_roles_system_set <password>
  local out rc
  DB_ROLES_WHY=''
  if [ -z "${1:-}" ]; then
    # An empty value would CLEAR the password: Postgres takes '' as none.
    DB_ROLES_WHY='an empty password was given; nothing was set'
    return 1
  fi
  out=$(DB_ROLES_NEW_SYSTEM_PASSWORD="$1" \
    "${COMPOSE[@]}" exec -T -e DB_ROLES_NEW_SYSTEM_PASSWORD postgres \
    psql -X -q -U "$DB_ROLES_OWNER" -d "$DB_ROLES_DB" -v ON_ERROR_STOP=1 \
    -v system_role="$DB_ROLES_SYSTEM" 2>&1 <<<"$DB_ROLES_SYSTEM_SET_SQL") && rc=0 || rc=$?
  [ "$rc" -eq 0 ] && return 0
  DB_ROLES_WHY="$(db_roles_masked "$out")"
  return 1
}

# The system role with its value, over the network and through the pooler:
# the two ways a task reaches Postgres (DB_HOST=postgres is the pooler's
# rollback).
db_roles_system_prove() { # db_roles_system_prove <password>
  local refused=0 unasked=0 rc channel
  DB_ROLES_PROOF=''
  for channel in network pooler; do
    rc=0
    db_roles_ask "$channel" "$DB_ROLES_SYSTEM" "${1:-}" || rc=$?
    DB_ROLES_PROOF+="${DB_ROLES_SYSTEM}|${channel}|${rc}|${DB_ROLES_WHY}"$'\n'
    [ "$rc" -ne 1 ] || refused=1
    [ "$rc" -ne 2 ] || unasked=1
  done
  [ "$refused" -eq 0 ] || return 1
  [ "$unasked" -eq 0 ] || return 2
  return 0
}

# trigger-db's role, set the way db_roles_set sets the other two, over
# trigger-db's own socket as that role.
db_roles_trigger_set() { # db_roles_trigger_set <password>
  local out rc
  DB_ROLES_WHY=''
  if [ -z "${1:-}" ]; then
    # An empty value would CLEAR the password: Postgres takes '' as none.
    DB_ROLES_WHY='an empty password was given; nothing was set'
    return 1
  fi
  out=$(DB_ROLES_NEW_TRIGGER_PASSWORD="$1" \
    "${COMPOSE[@]}" exec -T -e DB_ROLES_NEW_TRIGGER_PASSWORD trigger-db \
    psql -X -q -U "$DB_ROLES_TRIGGER_ROLE" -d "$DB_ROLES_TRIGGER_DB" -v ON_ERROR_STOP=1 \
    -v trigger_role="$DB_ROLES_TRIGGER_ROLE" 2>&1 <<<"$DB_ROLES_TRIGGER_SET_SQL") && rc=0 || rc=$?
  [ "$rc" -eq 0 ] && return 0
  DB_ROLES_WHY="$(db_roles_masked "$out")"
  return 1
}

# trigger-db's role with a value, over the stack's network: the one way
# trigger-api connects.
db_roles_trigger_ask() { # db_roles_trigger_ask <password>
  local out rc
  DB_ROLES_WHY=''
  out=$(PGPASSWORD="${1:-}" docker run --rm -e PGPASSWORD --network "$DB_ROLES_NETWORK" \
    "$DB_ROLES_CLIENT_IMAGE" psql -h trigger-db -p 5432 -U "$DB_ROLES_TRIGGER_ROLE" -d "$DB_ROLES_TRIGGER_DB" \
    -tAc 'SELECT 1' 2>&1) && rc=0 || rc=$?
  db_roles_answer "$rc" "$out"
}
