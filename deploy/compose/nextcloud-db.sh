#!/usr/bin/env bash
# nextcloud-db.sh — the demo Nextcloud's database in the stack's Postgres: its
# role and database made before its first start, what its config.php says, and
# the one password .env, the role and config.php are to agree on (workplan
# 0150; the owner, 2026-09-29: "ok, we'll move to postgres", and of the
# follow-up: "You take that aswell").
#
# Sourced, never run: by bootstrap-managed.sh's `data` phase (with
# --with-demo) and by nextcloud-to-postgres.sh. The caller sets SCRIPT_DIR and
# COMPOSE as db-roles.sh asks; this sources db-roles.sh for db_roles_init (the
# owner, the stack's database, the project), db_roles_masked and the client
# image a network question runs in.
#
#   nextcloud_db_init <env-file>
#       the project from the one reader (compose_project), db_roles_init, and
#       .env's NEXTCLOUD_DB_PASSWORD, with no default: managed.yml's is empty,
#       and an empty value is no password. 2 when the project cannot be read.
#   nextcloud_db_fit
#       asks the catalog, over the socket as the owner and changing nothing,
#       for the role `nextcloud` and the database `nextcloud`: NC_DB_HAS_ROLE
#       and NC_DB_HAS_DB (yes/no). 0 fit, or missing and so to be made; 1 what
#       exists is unfit (NC_DB_WHY names every reason); 2 could not ask.
#   nextcloud_db_ensure <password>
#       nextcloud_db_fit, then the role and the database it owns, each made
#       when it is missing, and the database closed to PUBLIC either way. A
#       role it makes gets <password> at once: nothing uses it yet. A role that
#       exists keeps its own (below). Nothing is made when what exists is
#       unfit. NC_DB_MADE names what it made. Returns as nextcloud_db_fit.
#   nextcloud_db_set <password>
#       ALTER ROLE nextcloud with it, over the socket as the owner, the way
#       db_roles_set sets the stack's two.
#   nextcloud_db_ask <password>
#       does it open the role, over the stack's network, where Nextcloud
#       connects from: 0 opens, 1 refused, 2 cannot tell.
#   nextcloud_db_tables
#       how many tables the `nextcloud` database holds, in NC_DB_TABLES.
#   nextcloud_config <running|stopped>
#       what config.php says, read with php in the running container, or in a
#       one-off one when Nextcloud is stopped: NC_CFG_INSTALLED (yes/no),
#       NC_CFG_TYPE, NC_CFG_USER, NC_CFG_HOST, NC_CFG_NAME, NC_CFG_PREFIX,
#       NC_CFG_DATADIR, and NC_CFG_PW, `same` when its database password is
#       .env's and `differs` when not. The two are compared in the container,
#       .env's passed there by name, and only the word comes out. 0 read, 2
#       could not read (NC_DB_WHY).
#
# A ROLE THAT EXISTS KEEPS ITS PASSWORD. An installed Nextcloud connects with
# the value in its own config.php, not with .env's: the OTA stack's role was
# made by hand on 2026-09-29 and its password changed the same morning. Setting
# .env's value on that role would leave Nextcloud with a password Postgres no
# longer takes, which is what changing the role before config.php did that
# morning (500s, until the role was set back to config.php's value). So the
# bring-up makes what is missing and says what differs, and
# nextcloud-to-postgres.sh --sync-password changes config.php first, while the
# old value still opens the role, and the role second.
#
# NO DOCKER CALL HERE READS THE CALLER'S STANDARD INPUT. Compose forwards it
# into an exec or a run whether the program there reads it or not, so a call
# with nothing to send is given /dev/null; otherwise it would swallow what a
# person types at nextcloud-to-postgres.sh's prompt, or a pipe into it.
#
# HOW A VALUE TRAVELS. As db-roles.sh says: in the environment of the one
# process that needs it, passed on by name, and read inside the container by
# psql's `\set` or by php's getenv; never an argument, never printed. The
# statements that carry one run with log_statement off and
# log_min_error_statement at panic.

# The names managed.yml gives Nextcloud at its first install (POSTGRES_USER,
# POSTGRES_DB), which are not .env's to choose.
NC_DB_ROLE='nextcloud'
NC_DB_NAME='nextcloud'

# env_value and compose_project, the one reader of a compose .env; and the
# stack's two roles' functions, whose owner, database and network this uses.
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# shellcheck source=deploy/compose/db-roles.sh
. "${SCRIPT_DIR}/db-roles.sh"

# What nextcloud_db_fit asks: the role's attributes, and the database's owner,
# one `|`-separated line each as psql -At prints them (a boolean as t or f; the
# same value cast to text would read `true`). No line for one that does not
# exist. The names go by psql variables.
read -r -d '' NC_DB_FIT_SQL <<'SQL' || true
SELECT 'role', rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin
  FROM pg_roles WHERE rolname = :'nc_role';
SELECT 'owner', pg_get_userbyid(datdba) FROM pg_database WHERE datname = :'nc_db';
SQL

# What nextcloud_db_ensure sends, once what exists is fit. The role is made
# with its attributes spelled out: one that may create roles would make
# Nextcloud's installer create a role of its own (`oc_admin`, with CREATEDB)
# and use that instead (lib/private/Setup/PostgreSQL.php), and a superuser
# owns every database. CREATE DATABASE cannot run inside a transaction, so
# each statement stands alone.
read -r -d '' NC_DB_ENSURE_SQL <<'SQL' || true
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_error_statement = panic;
\set nc_pw `printf '%s' "$NEXTCLOUD_DB_NEW_PASSWORD"`
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'nc_role') AS nc_make_role \gset
\if :nc_make_role
CREATE ROLE :"nc_role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'nc_pw';
\echo made|role
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'nc_db') AS nc_make_db \gset
\if :nc_make_db
CREATE DATABASE :"nc_db" OWNER :"nc_role";
\echo made|database
\endif
REVOKE ALL ON DATABASE :"nc_db" FROM PUBLIC;
SQL

# What nextcloud_db_set sends: the value by a psql variable, kept out of the
# database's log, failed or not.
read -r -d '' NC_DB_SET_SQL <<'SQL' || true
SET log_statement = 'none';
SET log_min_duration_statement = -1;
SET log_min_error_statement = panic;
\set nc_pw `printf '%s' "$NEXTCLOUD_DB_NEW_PASSWORD"`
ALTER ROLE :"nc_role" PASSWORD :'nc_pw';
SQL

# What nextcloud_config runs, in php, inside a container of the nextcloud
# service as www-data (config.php is not readable by anyone else). One line,
# `cfg|…`, so the one-off container's own chatter cannot be read as it.
# shellcheck disable=SC2016  # php's variables, not the shell's
NC_CONFIG_PHP='
$f = "/var/www/html/config/config.php";
if (!is_file($f)) { echo "cfg|no\n"; exit(0); }
$CONFIG = [];
include $f;
$pw = (string)($CONFIG["dbpassword"] ?? "");
$env = (string)getenv("NEXTCLOUD_DB_ENV_PASSWORD");
echo implode("|", [
  "cfg",
  empty($CONFIG["installed"]) ? "no" : "yes",
  $CONFIG["dbtype"] ?? "",
  $CONFIG["dbuser"] ?? "",
  $CONFIG["dbhost"] ?? "",
  $CONFIG["dbname"] ?? "",
  $CONFIG["dbtableprefix"] ?? "oc_",
  $CONFIG["datadirectory"] ?? "/var/www/html/data",
  ($env !== "" && hash_equals($pw, $env)) ? "same" : "differs",
]), "\n";
'

nextcloud_db_init() { # nextcloud_db_init <env-file>
  # The project from the one reader, before any Compose command: it refuses a
  # shell that names the other stack (db_roles_init asks it again).
  COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || return 2
  db_roles_init "${1:-}" || return 2
  NC_DB_PASSWORD="$(env_value "$DB_ROLES_ENV_FILE" NEXTCLOUD_DB_PASSWORD)"
  NC_DB_VOLUME="${COMPOSE_PROJECT}_nextcloud_data"
  NC_DB_MADE=''
  NC_DB_WHY=''
  NC_DB_TABLES=''
  NC_DB_HAS_ROLE=''
  NC_DB_HAS_DB=''
  # What config.php says, empty until nextcloud_config has read it.
  NC_CFG_INSTALLED='' NC_CFG_TYPE='' NC_CFG_USER='' NC_CFG_HOST='' NC_CFG_NAME=''
  NC_CFG_PREFIX='' NC_CFG_DATADIR='' NC_CFG_PW=''
}

nextcloud_db_fit() { # 0 fit or to be made, 1 unfit, 2 could not ask
  local out rc line super createrole createdb replication bypass login owner joined reason
  local -a unfit=()
  NC_DB_WHY=''
  NC_DB_HAS_ROLE=no
  NC_DB_HAS_DB=no
  out=$("${COMPOSE[@]}" exec -T postgres psql -X -q -At -F '|' -U "$DB_ROLES_OWNER" -d "$DB_ROLES_DB" \
    -v ON_ERROR_STOP=1 -v nc_role="$NC_DB_ROLE" -v nc_db="$NC_DB_NAME" 2>&1 <<<"$NC_DB_FIT_SQL") && rc=0 || rc=$?
  if [ "$rc" -ne 0 ]; then
    NC_DB_WHY="$(db_roles_masked "$out")"
    return 2
  fi
  while IFS= read -r line; do
    case "$line" in
      'role|'*)
        NC_DB_HAS_ROLE=yes
        IFS='|' read -r _ super createrole createdb replication bypass login <<<"$line"
        ;;
      'owner|'*)
        NC_DB_HAS_DB=yes
        owner="${line#owner|}"
        ;;
    esac
  done <<<"$out"
  if [ "$NC_DB_HAS_ROLE" = yes ]; then
    [ "$super" = f ] || unfit+=('it is a superuser')
    [ "$createrole" = f ] || unfit+=("it may create roles, and Nextcloud's installer would make a role of its own with that")
    [ "$createdb" = f ] || unfit+=('it may create databases')
    [ "$replication" = f ] || unfit+=('it may replicate the whole cluster')
    [ "$bypass" = f ] || unfit+=('it bypasses row security')
    [ "$login" = t ] || unfit+=('it cannot log in')
  fi
  if [ "$NC_DB_HAS_DB" = yes ] && [ "$owner" != "$NC_DB_ROLE" ]; then
    unfit+=("the database ${NC_DB_NAME} belongs to ${owner:-nobody it could name}, so Nextcloud could not make its tables there")
  fi
  [ "${#unfit[@]}" -eq 0 ] && return 0
  joined=''
  for reason in "${unfit[@]}"; do joined+="${joined:+; }${reason}"; done
  NC_DB_WHY="${NC_DB_ROLE}: ${joined}"
  return 1
}

nextcloud_db_ensure() { # nextcloud_db_ensure <password>; returns as nextcloud_db_fit
  local out rc line
  NC_DB_MADE=''
  if [ -z "${1:-}" ]; then
    # An empty value would make a role with no password: Postgres takes '' as none.
    NC_DB_WHY='NEXTCLOUD_DB_PASSWORD is empty in .env, and an empty password is none; ensure-env-secrets.sh makes it'
    return 1
  fi
  rc=0
  nextcloud_db_fit || rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  out=$(NEXTCLOUD_DB_NEW_PASSWORD="$1" \
    "${COMPOSE[@]}" exec -T -e NEXTCLOUD_DB_NEW_PASSWORD postgres \
    psql -X -q -At -U "$DB_ROLES_OWNER" -d "$DB_ROLES_DB" -v ON_ERROR_STOP=1 \
    -v nc_role="$NC_DB_ROLE" -v nc_db="$NC_DB_NAME" 2>&1 <<<"$NC_DB_ENSURE_SQL") && rc=0 || rc=$?
  if [ "$rc" -ne 0 ]; then
    NC_DB_WHY="$(db_roles_masked "$out")"
    return 2
  fi
  while IFS= read -r line; do
    case "$line" in
      'made|'*) NC_DB_MADE="${NC_DB_MADE:+${NC_DB_MADE} and }the ${line#made|}" ;;
    esac
  done <<<"$out"
  return 0
}

nextcloud_db_set() { # nextcloud_db_set <password>
  local out rc
  NC_DB_WHY=''
  if [ -z "${1:-}" ]; then
    # An empty value would CLEAR the password: Postgres takes '' as none.
    NC_DB_WHY='an empty password was given; nothing was set'
    return 1
  fi
  out=$(NEXTCLOUD_DB_NEW_PASSWORD="$1" \
    "${COMPOSE[@]}" exec -T -e NEXTCLOUD_DB_NEW_PASSWORD postgres \
    psql -X -q -U "$DB_ROLES_OWNER" -d "$DB_ROLES_DB" -v ON_ERROR_STOP=1 \
    -v nc_role="$NC_DB_ROLE" 2>&1 <<<"$NC_DB_SET_SQL") && rc=0 || rc=$?
  [ "$rc" -eq 0 ] && return 0
  NC_DB_WHY="$(db_roles_masked "$out")"
  return 1
}

# Over the stack's network, from a throwaway client on it, to the nextcloud
# database: where Nextcloud connects, and never the container's own socket,
# which trusts any password (db-roles.sh, "HOW A PASSWORD IS ASKED").
nextcloud_db_ask() { # nextcloud_db_ask <password>; 0 opens, 1 refused, 2 cannot tell
  local out rc
  NC_DB_WHY=''
  out=$(PGPASSWORD="${1:-}" docker run --rm -e PGPASSWORD --network "$DB_ROLES_NETWORK" \
    "$DB_ROLES_CLIENT_IMAGE" psql -X -h postgres -p 5432 -U "$NC_DB_ROLE" -d "$NC_DB_NAME" -tAc 'SELECT 1' 2>&1 </dev/null) && rc=0 || rc=$?
  [ "$rc" -eq 0 ] && return 0
  case "$out" in
    *"password authentication failed"*)
      NC_DB_WHY='password authentication failed'
      return 1
      ;;
  esac
  NC_DB_WHY="$(db_roles_masked "$out")"
  return 2
}

nextcloud_db_tables() { # sets NC_DB_TABLES; 0 counted, 2 could not ask
  local out rc
  NC_DB_TABLES=''
  out=$("${COMPOSE[@]}" exec -T postgres psql -X -q -At -U "$DB_ROLES_OWNER" -d "$NC_DB_NAME" \
    -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" 2>&1 </dev/null) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ] && [[ "$out" =~ ^[0-9]+$ ]]; then
    NC_DB_TABLES="$out"
    return 0
  fi
  NC_DB_WHY="$(db_roles_masked "$out")"
  return 2
}

nextcloud_config() { # nextcloud_config <running|stopped>; 0 read, 2 could not read
  local out rc line
  NC_CFG_INSTALLED='' NC_CFG_TYPE='' NC_CFG_USER='' NC_CFG_HOST='' NC_CFG_NAME=''
  NC_CFG_PREFIX='' NC_CFG_DATADIR='' NC_CFG_PW=''
  NC_DB_WHY=''
  case "${1:-running}" in
    running)
      out=$(NEXTCLOUD_DB_ENV_PASSWORD="$NC_DB_PASSWORD" \
        "${COMPOSE[@]}" exec -T -u www-data -e NEXTCLOUD_DB_ENV_PASSWORD nextcloud \
        php -r "$NC_CONFIG_PHP" 2>&1 </dev/null) && rc=0 || rc=$?
      ;;
    stopped)
      out=$(NEXTCLOUD_DB_ENV_PASSWORD="$NC_DB_PASSWORD" \
        "${COMPOSE[@]}" run --rm --no-deps -T --user www-data -e NEXTCLOUD_DB_ENV_PASSWORD \
        --entrypoint php nextcloud -r "$NC_CONFIG_PHP" 2>&1 </dev/null) && rc=0 || rc=$?
      ;;
    *)
      NC_DB_WHY="no way '${1}'"
      return 2
      ;;
  esac
  line="$(grep -m1 '^cfg|' <<<"$out" || true)"
  if [ "$rc" -ne 0 ] || [ -z "$line" ]; then
    NC_DB_WHY="$(db_roles_masked "$out")"
    return 2
  fi
  IFS='|' read -r _ NC_CFG_INSTALLED NC_CFG_TYPE NC_CFG_USER NC_CFG_HOST NC_CFG_NAME \
    NC_CFG_PREFIX NC_CFG_DATADIR NC_CFG_PW <<<"$line"
  return 0
}
