#!/usr/bin/env bash
# nextcloud-to-postgres.sh — the demo Nextcloud's database in the stack's
# Postgres: asked where it is (the default), moved there from SQLite, or its
# password made .env's (workplan 0150; the owner, 2026-09-29: "ok, we'll move
# to postgres", and of the script: "You take that aswell").
#
#   ./deploy/compose/nextcloud-to-postgres.sh [--check]           ask; change nothing
#   ./deploy/compose/nextcloud-to-postgres.sh --convert [--yes]
#   ./deploy/compose/nextcloud-to-postgres.sh --sync-password [--yes]
#
# WHY. The demo Nextcloud kept its database in SQLite, which takes one writer
# at a time, and the owner's migrations and the nightly gate write into the
# same Nextcloud: on 2026-09-29 the gate's writes were refused with "database
# is locked" (E2E (managed) #222, #223). The OTA stack was moved by hand that
# morning, and Nextcloud 34's converter stopped twice on the way. A fresh demo
# install starts on Postgres now (managed.yml, and the bring-up's `data` phase
# makes the role and the database); this moves an install that started on
# SQLite, with both of that morning's workarounds, and keeps the password in
# one place.
#
# --check (the default) changes nothing. It says which database this
# Nextcloud uses, whether the role and the database exist, whether .env's
# NEXTCLOUD_DB_PASSWORD opens the role and whether config.php holds it, and
# the one step that would make them agree.
#
# --convert moves an install still on SQLite, with Nextcloud STOPPED for all of
# it, so that no request writes to SQLite once the copy has begun:
#   1. the role and the database, made when missing, and the role given .env's
#      value: nothing uses it yet;
#   2. config.php copied to config.php.before-pgsql, beside it in the volume;
#   3. Nextcloud's own converter, in a one-off container of the service:
#      `occ db:convert-type -n --clear-schema pgsql nextcloud postgres
#      nextcloud`. WITHOUT --all-apps: with it the converter loads every app in
#      the apps folder, and on the OTA stack the disabled LDAP app could not
#      load and ended it before anything was copied. A disabled app's tables are
#      listed by the converter and stay in SQLite;
#   4. the copy checked: every table holds as many rows in Postgres as in
#      SQLite, but those the converter listed as left. Its last step fails on
#      Nextcloud 34 after the copy
#      and before it switches config.php (nextcloud-counters.sql says why), so
#      its exit code cannot tell a whole copy from half of one; the counts can;
#   5. every id counter set past the ids its column holds, by
#      nextcloud-counters.sql; a counter it could not set stops it here;
#   6. config.php's five database settings written in ONE write (occ
#      config:import), unless the converter got as far as that itself;
#   7. Nextcloud started and asked: installed, not in maintenance, on pgsql,
#      and its accounts listed through Postgres.
# Any failure before step 7 has passed puts config.php.before-pgsql back and
# starts Nextcloud as it was, on SQLite: nothing here writes SQLite, and no
# request reached Postgres. Nextcloud on Postgres already is not an error: it
# says so and exits 0.
#
# --sync-password makes .env's NEXTCLOUD_DB_PASSWORD the value Nextcloud uses,
# on an install on Postgres. CONFIG.PHP FIRST, then the role: occ needs the
# database to start, so it runs while the old value still opens the role. The
# reverse order left the OTA stack's Nextcloud with a password Postgres no
# longer took (500s, 2026-09-29) until the role was set back. With Nextcloud
# stopped, so no worker holds the old settings. A config.php whose value no
# longer opens the role either, the state that morning left, gets the role set
# back to config.php's value first, read in a one-off container and carried
# by name, then the two steps.
#
# BEFORE --convert OR --sync-password, pause the migrations that write into
# this Nextcloud, and let no gate run: Nextcloud is stopped for the minutes it
# takes, and a pass would record every write in that time as refused. The
# prompt says so, and waits for the project's name (--yes skips it).
#
# REFUSED, before anything changes: live (stack_may_be_live, which has no demo
# Nextcloud); xtrace, which prints values; CI (CI or GITHUB_ACTIONS), where
# nobody paused the migrations; an empty NEXTCLOUD_DB_PASSWORD; postgres not
# healthy; no installed Nextcloud in the volume; a database Nextcloud names
# that is not this stack's `nextcloud` (--sync-password); and a role
# `nextcloud` that is unfit (nextcloud-db.sh).
#
# HOW A VALUE TRAVELS. As db-roles.sh says: never as an argument. .env's value
# goes to psql and to the one-off containers in their environment, by name;
# inside the one-off container it goes to the converter as standard input
# from a file, and to config.php in a JSON file read by `occ config:import`,
# in the container's own /tmp, which goes when the container does. config.php's
# value is compared inside the container and only `same` or `differs` comes
# out, except in the one repair above. Nothing prints a value, and it refuses
# to run traced.
#
# Exit codes:
#   --check            0 nothing to do; 1 a step to take (it says which);
#                      2 something could not be asked.
#   --convert          0 on Postgres, or already was; 1 refused, or failed and
#                      put back on SQLite (it says which step).
#   --sync-password    0 one value, or already was; 1 refused or failed (it
#                      says which step, and what is left).
#   2 as well for a usage error.
case "$-" in *x*) NC_TRACED=1 ;; *) NC_TRACED='' ;; esac; set +x
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
REFUSE_EXIT=1
BACKUP_NAME='config.php.before-pgsql'
# How long Nextcloud may take to answer its health check after a start.
HEALTH_WAIT_S="${NC_HEALTH_WAIT_S:-300}"

say() { printf '[nextcloud-to-postgres] %s\n' "$@"; }
item() { printf '    %s\n' "$@"; }
refuse() {
  printf '[nextcloud-to-postgres] refused: %s\n' "$1" >&2
  shift
  [ "$#" -eq 0 ] || printf '  %s\n' "$@" >&2
  printf '[nextcloud-to-postgres] Nothing was changed.\n' >&2
  exit "$REFUSE_EXIT"
}
usage() {
  echo "usage: ./deploy/compose/nextcloud-to-postgres.sh [--check | --convert | --sync-password] [--yes]   (--help for more)" >&2
  exit 2
}

if [ -n "$NC_TRACED" ] || [ -n "${BASH_XTRACEFD+set}" ]; then
  refuse "this was started with xtrace (set -x, bash -x, SHELLOPTS or BASH_XTRACEFD). Tracing prints every value a command is given, and this handles a password." \
    "Run it again without tracing."
fi

MODE='' YES=''
for arg in "$@"; do
  case "$arg" in
    --check | --convert | --sync-password)
      [ -z "$MODE" ] || usage
      MODE="${arg#--}"
      ;;
    --yes) YES=1 ;;
    -h | --help)
      sed -n '2,/^case "\$-"/p' "${BASH_SOURCE[0]}" | sed '$d'
      exit 0
      ;;
    *) usage ;;
  esac
done
MODE="${MODE:-check}"
[ -z "$YES" ] || [ "$MODE" != check ] || usage
[ "$MODE" != check ] || REFUSE_EXIT=2

# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"

[ -f "$ENV_FILE" ] || refuse "${ENV_FILE} does not exist, or is a link to nothing. This asks about the stack that .env describes."
for arg in COMPOSE_ENV_FILES COMPOSE_FILE; do
  if [ -n "${!arg+set}" ]; then
    refuse "this shell has ${arg} set. Compose would follow it to another stack's files instead of this checkout's." \
      "Open a new shell (or: unset ${arg}) and run this again."
  fi
done
if stack_may_be_live "$ENV_FILE"; then
  refuse "${ENV_FILE} has a ${STACK_KIND_KEY} line: live's marker, or something that could be a slip of it. Its value is not printed." \
    "Live runs no demo Nextcloud (bootstrap-managed.sh refuses --with-demo there), so there is nothing here to ask or move."
fi
if [ "$MODE" != check ]; then
  for arg in GITHUB_ACTIONS CI; do
    if [ -n "${!arg:-}" ]; then
      refuse "${arg} is set: this is CI. Moving Nextcloud's database stops Nextcloud, and nobody here paused the migrations that write into it." \
        "Run it by hand on the stack, with the migrations paused."
    fi
  done
fi

COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || refuse "the checkout's project could not be read (above)."
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml" --env-file "${ENV_FILE}")
# shellcheck source=deploy/compose/nextcloud-db.sh
. "${SCRIPT_DIR}/nextcloud-db.sh"
nextcloud_db_init "$ENV_FILE" || refuse "the checkout's project could not be read (above)."

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

health_of() { # health_of <service> — healthy, unhealthy, starting, or empty
  "${COMPOSE[@]}" ps --format '{{.Health}}' "$1" 2>/dev/null | tail -1 || true
}

nextcloud_running() {
  [ -n "$("${COMPOSE[@]}" ps -q nextcloud 2>/dev/null || true)" ]
}

# occ, or another program, in a one-off container of the nextcloud service:
# the same image, volume, network and settings, with Nextcloud itself stopped.
# Its own chatter (Creating, Created) goes to standard error.
oneoff() { # oneoff <entrypoint> [args...]
  local entry="$1"
  shift
  "${COMPOSE[@]}" run --rm --no-deps -T --user www-data -e NEXTCLOUD_DB_NEW_PASSWORD \
    --entrypoint "$entry" nextcloud "$@" </dev/null
}

wait_healthy() { # wait_healthy — 0 healthy within HEALTH_WAIT_S, 1 not
  local waited=0 health
  while [ "$waited" -lt "$HEALTH_WAIT_S" ]; do
    health="$(health_of nextcloud)"
    [ "$health" = healthy ] && return 0
    sleep 5
    waited=$((waited + 5))
  done
  return 1
}

# The rows in each table, from both sides, as `table|rows` lines sorted by
# table: SQLite's read with php in a one-off container, Postgres's over the
# socket as the owner. The table names are Nextcloud's own.
# shellcheck disable=SC2016  # php's variables, not the shell's
SQLITE_ROWS_PHP='
$db = new PDO("sqlite:" . getenv("NC_SQLITE_FILE"));
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$prefix = getenv("NC_PREFIX");
$list = $db->prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name");
$list->execute(["table"]);
$names = $list->fetchAll(PDO::FETCH_COLUMN);
foreach ($names as $t) {
  if (strncmp($t, $prefix, strlen($prefix)) !== 0) continue;
  echo "rows|", $t, "|", $db->query("SELECT count(*) FROM \"" . str_replace("\"", "\"\"", $t) . "\"")->fetchColumn(), "\n";
}
'
read -r -d '' PG_ROWS_SQL <<'SQL' || true
SELECT 'rows|' || c.relname || '|'
       || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND n.nspname = 'public' AND left(c.relname, length(:'prefix')) = :'prefix'
 ORDER BY c.relname;
SQL

# Compares the two sides, table by table, except the migrations table, which
# the converter fills by running the migrations rather than by copying. A table
# Postgres lacks is one the converter listed as not converted (a disabled
# app's), or the copy is not whole. Sets ROWS_TABLES, ROWS_TOTAL and
# ROWS_DIFFER (the tables that differ, by name); 0 the same, 1 not, 2 could not
# count.
compare_rows() { # compare_rows <the tables the converter left, space-separated>
  local left=" ${1:-} "
  local sqlite_out pg_out rc
  ROWS_TABLES=0 ROWS_TOTAL=0 ROWS_DIFFER=''
  sqlite_out=$(NC_SQLITE_FILE="${NC_CFG_DATADIR}/${NC_CFG_NAME}.db" NC_PREFIX="$NC_CFG_PREFIX" \
    "${COMPOSE[@]}" run --rm --no-deps -T --user www-data -e NC_SQLITE_FILE -e NC_PREFIX \
    --entrypoint php nextcloud -r "$SQLITE_ROWS_PHP" 2>/dev/null </dev/null) && rc=0 || rc=$?
  [ "$rc" -eq 0 ] || return 2
  pg_out=$("${COMPOSE[@]}" exec -T postgres psql -X -q -At -U "$DB_ROLES_OWNER" -d "$NC_DB_NAME" \
    -v ON_ERROR_STOP=1 -v prefix="$NC_CFG_PREFIX" 2>/dev/null <<<"$PG_ROWS_SQL") && rc=0 || rc=$?
  [ "$rc" -eq 0 ] || return 2
  local tag table rows theirs differ=0
  declare -A in_pg=()
  while IFS='|' read -r tag table rows; do
    [ "$tag" = rows ] || continue
    in_pg["$table"]="$rows"
  done <<<"$pg_out"
  while IFS='|' read -r tag table rows; do
    [ "$tag" = rows ] || continue
    [ "$table" != "${NC_CFG_PREFIX}migrations" ] || continue
    if [ -z "${in_pg[$table]+set}" ]; then
      [[ "$left" == *" ${table} "* ]] && continue
      theirs='none, the table is not there'
    else
      theirs="${in_pg[$table]}"
    fi
    ROWS_TABLES=$((ROWS_TABLES + 1))
    ROWS_TOTAL=$((ROWS_TOTAL + rows))
    [ "$theirs" != "$rows" ] || continue
    differ=$((differ + 1))
    # The first five by name; the rest counted.
    [ "$differ" -gt 5 ] || ROWS_DIFFER="${ROWS_DIFFER:+${ROWS_DIFFER}, }${table} (${rows} in SQLite, ${theirs} in Postgres)"
  done <<<"$sqlite_out"
  [ "$differ" -le 5 ] || ROWS_DIFFER="${ROWS_DIFFER}, and $((differ - 5)) more"
  [ "$ROWS_TABLES" -gt 0 ] || return 2
  [ -z "$ROWS_DIFFER" ] && return 0
  return 1
}

confirm() { # confirm <what it does>...
  say "$@"
  say "Pause the migrations that write into this Nextcloud first, and let no gate run: Nextcloud is stopped while this runs."
  if [ -n "$YES" ]; then
    say "--yes: going on."
    return 0
  fi
  local typed=''
  printf '[nextcloud-to-postgres] Type the project name (%s) to go on: ' "$COMPOSE_PROJECT"
  IFS= read -r typed || true
  printf '\n'
  [ "$typed" = "$COMPOSE_PROJECT" ] || refuse "what was typed is not the project name."
}

# ---------------------------------------------------------------------------
# Where it stands
# ---------------------------------------------------------------------------

# Reads everything --check reports, changing nothing. Sets STATE_* and
# NEXT_STEP (convert, sync, install, none, unknown).
STATE_INSTALLED='' STATE_OPENS='' NEXT_STEP=''
read_state() {
  local rc how
  NEXT_STEP=unknown
  STATE_INSTALLED=unknown
  if ! docker volume inspect "$NC_DB_VOLUME" >/dev/null 2>&1; then
    STATE_INSTALLED=no-volume
    NEXT_STEP=install
    return 0
  fi
  how=stopped
  nextcloud_running && how=running
  rc=0
  nextcloud_config "$how" || rc=$?
  if [ "$rc" -ne 0 ]; then
    STATE_INSTALLED=unknown
    return 0
  fi
  STATE_INSTALLED="$NC_CFG_INSTALLED"
  if [ "$NC_CFG_INSTALLED" != yes ]; then
    NEXT_STEP=install
    return 0
  fi
  case "$NC_CFG_TYPE" in
    sqlite | sqlite3) NEXT_STEP=convert ;;
    pgsql)
      if [ "$NC_CFG_USER" != "$NC_DB_ROLE" ] || [ "$NC_CFG_NAME" != "$NC_DB_NAME" ] || [ "${NC_CFG_HOST%%:*}" != postgres ]; then
        NEXT_STEP=foreign
        return 0
      fi
      rc=0
      nextcloud_db_ask "$NC_DB_PASSWORD" || rc=$?
      case "$rc" in
        0) STATE_OPENS=yes ;;
        1) STATE_OPENS=no ;;
        *) STATE_OPENS=unknown ;;
      esac
      if [ "$NC_CFG_PW" = same ] && [ "$STATE_OPENS" = yes ]; then
        NEXT_STEP=none
      elif [ "$STATE_OPENS" = unknown ]; then
        NEXT_STEP=unknown
      else
        NEXT_STEP=sync
      fi
      ;;
    *) NEXT_STEP=foreign ;;
  esac
}

report_state() {
  say "stack ${COMPOSE_PROJECT}: the demo Nextcloud's database"
  case "$STATE_INSTALLED" in
    no-volume) item "no Nextcloud volume (${NC_DB_VOLUME}): a bring-up with --with-demo installs one, on Postgres" ;;
    no) item "Nextcloud is not installed in ${NC_DB_VOLUME} yet: its first start installs it, on Postgres" ;;
    unknown) item "config.php could not be read: ${NC_DB_WHY}" ;;
    yes)
      case "$NC_CFG_TYPE" in
        sqlite | sqlite3) item "on SQLite (${NC_CFG_DATADIR}/${NC_CFG_NAME}.db), one writer at a time" ;;
        pgsql) item "on Postgres: ${NC_CFG_USER}@${NC_CFG_HOST}/${NC_CFG_NAME}" ;;
        *) item "on ${NC_CFG_TYPE:-a database config.php does not name}" ;;
      esac
      ;;
  esac
  if [ "$NC_CFG_TYPE" = pgsql ] && [ "$NEXT_STEP" != foreign ]; then
    case "$STATE_OPENS" in
      yes) item ".env's NEXTCLOUD_DB_PASSWORD opens the role ${NC_DB_ROLE}, over the stack's network" ;;
      no) item ".env's NEXTCLOUD_DB_PASSWORD does NOT open the role ${NC_DB_ROLE}" ;;
      *) item "whether .env's NEXTCLOUD_DB_PASSWORD opens the role could not be asked: ${NC_DB_WHY}" ;;
    esac
    if [ "$NC_CFG_PW" = same ]; then
      item "config.php holds .env's NEXTCLOUD_DB_PASSWORD"
    else
      item "config.php holds another value than .env's NEXTCLOUD_DB_PASSWORD"
    fi
  fi
  case "$NEXT_STEP" in
    none) say "nothing to do: .env, the role and config.php hold one value." ;;
    convert) say "next: ./deploy/compose/nextcloud-to-postgres.sh --convert, with the migrations paused" ;;
    sync) say "next: ./deploy/compose/nextcloud-to-postgres.sh --sync-password, with the migrations paused" ;;
    install) say "nothing to move: the next bring-up with --with-demo makes the role and the database, and installs Nextcloud on Postgres." ;;
    foreign) say "this Nextcloud's database is not the stack's ${NC_DB_NAME} for ${NC_DB_ROLE} on postgres; this script leaves it alone." ;;
    *) say "not established: something could not be asked (above)." ;;
  esac
}

# ---------------------------------------------------------------------------
# --check
# ---------------------------------------------------------------------------

do_check() {
  read_state
  report_state
  case "$NEXT_STEP" in
    none | install | foreign) exit 0 ;;
    convert | sync) exit 1 ;;
    *) exit 2 ;;
  esac
}

# ---------------------------------------------------------------------------
# What --convert and --sync-password share
# ---------------------------------------------------------------------------

STOPPED_BY_US=''
SWITCH_STARTED=''
FINISHED=''

# The way back, on any exit before the end: config.php as it was (when this
# may have changed it), and Nextcloud started again.
put_back() {
  local rc=$?
  trap - EXIT
  trap '' INT TERM HUP
  if [ -z "$FINISHED" ] && [ -n "$STOPPED_BY_US" ]; then
    if [ -n "$SWITCH_STARTED" ]; then
      say "putting config.php back from ${BACKUP_NAME}"
      if oneoff cp -p "config/${BACKUP_NAME}" config/config.php 2>/dev/null; then
        item "config.php is as it was before this ran"
      else
        item "COULD NOT put config.php back. By hand, before anything else:"
        item "  docker compose -f deploy/compose/managed.yml run --rm --no-deps --user www-data --entrypoint cp nextcloud -p config/${BACKUP_NAME} config/config.php"
      fi
    fi
    say "starting Nextcloud again"
    "${COMPOSE[@]}" up -d --no-deps nextcloud >/dev/null 2>&1 || item "it did not start; docker compose -f deploy/compose/managed.yml up -d nextcloud"
  fi
  exit "$rc"
}

fail() { # fail <step> <what happened>...
  printf '[nextcloud-to-postgres] FAILED at %s: %s\n' "$1" "$2" >&2
  shift 2
  [ "$#" -eq 0 ] || printf '  %s\n' "$@" >&2
  exit 1
}

require_stack() {
  local health
  health="$(health_of postgres)"
  [ "$health" = healthy ] || refuse "postgres is not healthy (${health:-not running}). Nothing can be made or asked."
  [ -n "$NC_DB_PASSWORD" ] || refuse "NEXTCLOUD_DB_PASSWORD is empty in ${ENV_FILE}, and an empty password is none." \
    "./deploy/compose/ensure-env-secrets.sh makes it (it fills in missing secrets only), then run this again."
}

stop_nextcloud() {
  trap put_back EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  if nextcloud_running; then
    say "stopping Nextcloud"
    "${COMPOSE[@]}" stop nextcloud >/dev/null 2>&1 || fail 'the stop' 'docker compose could not stop nextcloud'
  fi
  STOPPED_BY_US=1
}

start_and_prove() { # start_and_prove <step>
  say "starting Nextcloud"
  "${COMPOSE[@]}" up -d --no-deps nextcloud >/dev/null 2>&1 || fail "$1" 'docker compose could not start nextcloud'
  wait_healthy || fail "$1" "Nextcloud did not answer its health check within ${HEALTH_WAIT_S}s" \
    "Its log: docker compose -f deploy/compose/managed.yml logs --tail 50 nextcloud"
  local status users rc=0
  status="$("${COMPOSE[@]}" exec -T -u www-data nextcloud php occ status --output=json 2>/dev/null </dev/null)" || rc=$?
  [ "$rc" -eq 0 ] && [[ "$status" == *'"installed":true'* ]] && [[ "$status" == *'"maintenance":false'* ]] ||
    fail "$1" 'occ status does not say installed and out of maintenance'
  rc=0
  nextcloud_config running || rc=$?
  [ "$rc" -eq 0 ] && [ "$NC_CFG_TYPE" = pgsql ] || fail "$1" "config.php says ${NC_CFG_TYPE:-nothing it could read}, not pgsql"
  rc=0
  users="$("${COMPOSE[@]}" exec -T -u www-data nextcloud php occ user:list --output=json 2>/dev/null </dev/null)" || rc=$?
  [ "$rc" -eq 0 ] && [[ "$users" == '{'* ]] || fail "$1" 'occ user:list could not read the accounts through Postgres'
  item "Nextcloud answers on Postgres: installed, out of maintenance, $(grep -o '":' <<<"$users" | wc -l | tr -d ' ') account(s) listed"
}

# ---------------------------------------------------------------------------
# --convert
# ---------------------------------------------------------------------------

do_convert() {
  require_stack
  read_state
  case "$NEXT_STEP" in
    convert) ;;
    none | sync)
      say "this Nextcloud is on Postgres already (${NC_CFG_USER}@${NC_CFG_HOST}/${NC_CFG_NAME}); nothing to convert."
      [ "$NEXT_STEP" = none ] || say "its password is not .env's yet: --sync-password, with the migrations paused."
      exit 0
      ;;
    install) refuse "there is no installed Nextcloud in ${NC_DB_VOLUME} to convert. A bring-up with --with-demo installs one on Postgres." ;;
    foreign) refuse "config.php names a database this script does not move (${NC_CFG_TYPE:-none})." ;;
    *) refuse "config.php could not be read: ${NC_DB_WHY}" ;;
  esac

  local rc=0
  nextcloud_db_fit || rc=$?
  case "$rc" in
    0) ;;
    1) refuse "the role ${NC_DB_ROLE} is not one Nextcloud should use: ${NC_DB_WHY}" ;;
    *) refuse "the role and the database could not be asked about: ${NC_DB_WHY}" ;;
  esac

  confirm "This moves the demo Nextcloud of ${COMPOSE_PROJECT} from SQLite to the stack's Postgres (database ${NC_DB_NAME}, role ${NC_DB_ROLE})." \
    "SQLite is not written to, and config.php is kept as ${BACKUP_NAME}; until a pass writes to Nextcloud on Postgres, putting that back is the whole way back."

  # 1. The role and the database, and the role takes .env's value: Nextcloud
  # is on SQLite, so nothing uses it.
  rc=0
  nextcloud_db_ensure "$NC_DB_PASSWORD" || rc=$?
  [ "$rc" -eq 0 ] || fail 'the role and the database' "${NC_DB_WHY}"
  [ -z "$NC_DB_MADE" ] || say "made ${NC_DB_MADE} ${NC_DB_NAME}, in the stack's Postgres"
  nextcloud_db_set "$NC_DB_PASSWORD" || fail 'the role' "its password could not be set: ${NC_DB_WHY}"
  rc=0
  nextcloud_db_ask "$NC_DB_PASSWORD" || rc=$?
  [ "$rc" -eq 0 ] || fail 'the role' "it does not open with .env's value over the stack's network: ${NC_DB_WHY}"
  say "the role ${NC_DB_ROLE} opens with .env's NEXTCLOUD_DB_PASSWORD, over the stack's network"

  stop_nextcloud
  export NEXTCLOUD_DB_NEW_PASSWORD="$NC_DB_PASSWORD"

  # 2. The way back.
  oneoff cp -p config/config.php "config/${BACKUP_NAME}" 2>/dev/null ||
    fail 'the copy of config.php' "config.php could not be copied to ${BACKUP_NAME}"
  say "config.php kept as ${BACKUP_NAME}"

  # 3. Nextcloud's own converter. From here config.php may change.
  SWITCH_STARTED=1
  say "copying every table (Nextcloud's converter; this takes minutes on a large install)"
  local out
  # The password is read from standard input, here a file in the one-off
  # container: the converter reads standard input without waiting, so a pipe
  # could still be empty when it looks.
  # shellcheck disable=SC2016  # expanded by the container's shell
  out=$(oneoff sh -c 'umask 077 && printf "%s" "$NEXTCLOUD_DB_NEW_PASSWORD" >/tmp/.nextcloud-db && exec php occ db:convert-type -n --clear-schema pgsql nextcloud postgres nextcloud </tmp/.nextcloud-db' 2>&1) && rc=0 || rc=$?
  local skipped
  skipped="$(tr '\r' '\n' <<<"$out" | awk '/following tables will not be converted/ { on = 1; next } /Please note|Continue with the conversion|^ - / { on = 0 } on && NF { print $1 }' | paste -sd ' ' - || true)"
  [ -z "$skipped" ] || item "left in SQLite, the tables of disabled apps: ${skipped}"
  if [ "$rc" -eq 0 ]; then
    item "the converter finished, and switched config.php itself"
  else
    # Its message sits in a box wrapped at the terminal's width: the first one,
    # its lines joined.
    item "the converter stopped (exit ${rc}): $(tr '\r' '\n' <<<"$out" |
      awk '/SQLSTATE|Exception:|Error:/ { on = 1 } on { if (NF == 0) exit; printf "%s ", $0 }' |
      tr -s ' ' | cut -c1-240 | db_roles_masked_one)"
  fi

  # 4. Is the copy whole?
  nextcloud_config stopped || fail 'the copy check' "config.php could not be read: ${NC_DB_WHY}"
  local converted="$NC_CFG_TYPE"
  rc=0
  compare_rows "$skipped" || rc=$?
  case "$rc" in
    0) item "the copy is whole: ${ROWS_TABLES} tables, ${ROWS_TOTAL} rows, the same counts in SQLite and Postgres" ;;
    1) fail 'the copy check' "the copy is not whole: ${ROWS_DIFFER}" \
      "Postgres holds part of a copy, which the next --convert clears first (--clear-schema). The converter's own line above says where it stopped." ;;
    *) fail 'the copy check' 'the rows could not be counted on both sides' ;;
  esac

  # 5. The counters.
  local counted set notset
  counted=$("${COMPOSE[@]}" exec -T -e PGOPTIONS="-c ownpace.nextcloud_prefix=${NC_CFG_PREFIX}" postgres \
    psql -X -q -At -U "$DB_ROLES_OWNER" -d "$NC_DB_NAME" -v ON_ERROR_STOP=1 \
    -f - <"${SCRIPT_DIR}/nextcloud-counters.sql" 2>&1) && rc=0 || rc=$?
  IFS='|' read -r set notset <<<"$(tail -1 <<<"$counted")"
  if [ "$rc" -ne 0 ] || ! [[ "${set:-}" =~ ^[0-9]+$ ]] || ! [[ "${notset:-}" =~ ^[0-9]+$ ]]; then
    fail 'the counters' 'nextcloud-counters.sql did not run' "$(db_roles_masked "$counted")"
  fi
  if [ "$notset" -ne 0 ]; then
    fail 'the counters' "${notset} counter(s) could not be set" \
      "$(awk '/not set: / && shown < 5 { sub(/.*not set: /, "not set: "); print; shown++ }' <<<"$counted")"
  fi
  item "${set} id counters set past the ids their columns hold"

  # 6. config.php, in one write, unless the converter wrote it.
  if [ "$converted" != pgsql ]; then
    # shellcheck disable=SC2016  # expanded by the container's shell
    oneoff sh -c 'umask 077 && php -r '\''echo json_encode(["system" => ["dbhost" => "postgres", "dbname" => "nextcloud", "dbuser" => "nextcloud", "dbpassword" => getenv("NEXTCLOUD_DB_NEW_PASSWORD"), "dbtype" => "pgsql"]]);'\'' >/tmp/.nextcloud-config.json && exec php occ config:import /tmp/.nextcloud-config.json' >/dev/null 2>&1 ||
      fail 'the switch' 'occ config:import could not write the database settings into config.php'
    item "config.php points at Postgres: host postgres, database ${NC_DB_NAME}, role ${NC_DB_ROLE}"
  fi

  # 7. Nextcloud on Postgres, asked.
  start_and_prove 'the start on Postgres'
  FINISHED=1
  trap - EXIT
  say "done: the demo Nextcloud of ${COMPOSE_PROJECT} is on Postgres."
  item "SQLite's file (${NC_CFG_DATADIR}/${NC_CFG_NAME}.db) and ${BACKUP_NAME} are kept. Once a pass has written to Nextcloud, they are out of date: going back would lose what was written since."
  item "Resume the migrations."
}

# ---------------------------------------------------------------------------
# --sync-password
# ---------------------------------------------------------------------------

do_sync() {
  require_stack
  read_state
  case "$NEXT_STEP" in
    sync) ;;
    none)
      say "nothing to do: .env's NEXTCLOUD_DB_PASSWORD opens the role ${NC_DB_ROLE}, and config.php holds it."
      exit 0
      ;;
    convert) refuse "this Nextcloud is still on SQLite: --convert first, which gives it .env's value." ;;
    install) refuse "there is no installed Nextcloud in ${NC_DB_VOLUME}." ;;
    foreign) refuse "config.php names ${NC_CFG_USER:-nobody}@${NC_CFG_HOST:-nowhere}/${NC_CFG_NAME:-nothing}, not the stack's ${NC_DB_NAME} for ${NC_DB_ROLE} on postgres; this script leaves that alone." ;;
    *) refuse "it could not be established where this Nextcloud's password stands (above): ${NC_DB_WHY}" ;;
  esac
  local rc=0
  nextcloud_db_fit || rc=$?
  case "$rc" in
    0) ;;
    1) refuse "the role ${NC_DB_ROLE} is not one Nextcloud should use: ${NC_DB_WHY}" ;;
    *) refuse "the role could not be asked about: ${NC_DB_WHY}" ;;
  esac

  confirm "This makes .env's NEXTCLOUD_DB_PASSWORD the value the demo Nextcloud of ${COMPOSE_PROJECT} connects with: config.php first, then the role ${NC_DB_ROLE}."

  stop_nextcloud
  export NEXTCLOUD_DB_NEW_PASSWORD="$NC_DB_PASSWORD"
  if [ "$NC_CFG_PW" != same ]; then
    # occ needs the database to start. If config.php's own value no longer
    # opens the role, the role is set back to it first: read inside a one-off
    # container, carried here by name, never printed.
    local current
    # shellcheck disable=SC2016  # php's variables
    current="$(oneoff php -r '$CONFIG = []; include "/var/www/html/config/config.php"; echo $CONFIG["dbpassword"] ?? "";' 2>/dev/null)" ||
      fail "the read of config.php" "config.php's value could not be read"
    rc=0
    nextcloud_db_ask "$current" || rc=$?
    if [ "$rc" -eq 1 ]; then
      nextcloud_db_set "$current" || fail 'the repair' "the role could not be set back to config.php's value: ${NC_DB_WHY}"
      item "the role was set back to config.php's value first, which it no longer took"
    elif [ "$rc" -ne 0 ]; then
      fail "the read of config.php" "whether config.php's value opens the role could not be asked: ${NC_DB_WHY}"
    fi
    current=''
    # shellcheck disable=SC2016  # expanded by the container's shell
    oneoff sh -c 'umask 077 && php -r '\''echo json_encode(["system" => ["dbpassword" => getenv("NEXTCLOUD_DB_NEW_PASSWORD")]]);'\'' >/tmp/.nextcloud-config.json && exec php occ config:import /tmp/.nextcloud-config.json' >/dev/null 2>&1 ||
      fail 'config.php' "occ config:import could not write .env's value into config.php; config.php and the role are as they were"
    item "config.php holds .env's value"
  fi
  nextcloud_db_set "$NC_DB_PASSWORD" ||
    fail 'the role' "the role could not be given .env's value: ${NC_DB_WHY}" \
      "config.php holds .env's value already; run --sync-password again, which sets only the role."
  rc=0
  nextcloud_db_ask "$NC_DB_PASSWORD" || rc=$?
  [ "$rc" -eq 0 ] || fail 'the role' "the role does not open with .env's value over the stack's network: ${NC_DB_WHY}"
  item "the role ${NC_DB_ROLE} opens with .env's value"
  start_and_prove 'the start'
  FINISHED=1
  trap - EXIT
  say "done: .env, the role ${NC_DB_ROLE} and config.php hold one value. Resume the migrations."
}

db_roles_masked_one() { # the first line of standard input, masked
  db_roles_masked "$(head -1)"
}

case "$MODE" in
  check) do_check ;;
  convert) do_convert ;;
  sync-password) do_sync ;;
esac
