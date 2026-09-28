#!/usr/bin/env bash
# rotate-db-passwords.sh — the stack's database passwords: which shipped value
# still opens a role, the roles set to what .env says, and new values made on
# this machine without ever being printed (workplan 0132 T0 step 2, T2).
#
#   ./deploy/compose/rotate-db-passwords.sh [--check]    ask; change nothing
#   ./deploy/compose/rotate-db-passwords.sh --sync       set the roles to .env
#   ./deploy/compose/rotate-db-passwords.sh --rotate [--with-trigger-stores]
#
# WHY. The OTA stack's two database roles were created with values this
# public repository contains: `app_user` with `app_password` (the first
# migration), the owner with compose's default `openmigrate_password` or the
# example's `change-me-openmigrate`. Changing .env does nothing to them:
# Postgres keeps the password a role was created with, and only ALTER ROLE
# changes it. So the change is three things at once, and doing them by hand
# was ten steps (0132 T2): new values into .env, the roles told, and every
# container that logs in recreated from the new .env. The last is the nightly
# gate's job, dispatched once by hand; this does the first two, and checks.
#
# --check (the default) changes nothing. It
#   1. lists the login roles, over the socket as the owner: names and flags;
#   2. asks the controls: .env's POSTGRES_PASSWORD for the owner and
#      APP_DB_PASSWORD for the application role, with compose's own default
#      when a key is empty, over the stack's network and through PgBouncer;
#   3. tries the three shipped Postgres values against every login role among
#      the owner (by its REAL name: the names were changed, 0132 D2), app_user,
#      openmigrate and APP_DB_USER. A name that is not a login role is not
#      asked, because Postgres answers "password authentication failed" for a
#      missing role too, and it would read as refused;
#   4. tries ClickHouse's two shipped values with clickhouse-client, and
#      MinIO's two with mc, inside their own containers, after a control each
#      (ClickHouse healthy, since its health check logs in with its own
#      password; MinIO answering its own pair);
#   5. asks trigger-db's value, written into managed.yml itself, and does not
#      count it: no .env reaches it until T2's code makes it
#      TRIGGER_DB_PASSWORD, and that is another change.
#   One line per pair: the account, where the value comes from, opens or
#   refused. Never the value. A role that opens and is neither the owner nor
#   APP_DB_USER (the owner's old name, left with LOGIN after a rename) is one
#   --rotate does not change: for it, the advice is 0132 T2 step 5 by hand,
#   `ALTER ROLE <name> NOLOGIN`, never DROP, and not --rotate.
#
# --sync sets the owner's and app_user's passwords to what .env holds, in one
# transaction, over the socket as the owner (which the image trusts there, so
# it repairs a role whose password nobody has any more), then proves both over
# the network and through the pooler. It is idempotent. This is also what T2
# (b)'s bring-up is to do on every run, with the same functions (db-roles.sh).
#
# --rotate refuses, before anything changes:
#   xtrace (set -x, bash -x, SHELLOPTS, BASH_XTRACEFD): tracing prints values;
#   live (stack_may_be_live, stack-kind.sh): live's values are generated fresh
#       when it is stood up (0132 T1b, stand-up-live.sh, another change), and
#       are its own (D8); --sync is refused there too, --check is not;
#   CI (CI or GITHUB_ACTIONS set): the gate never makes a password. A run that
#       died halfway would leave .env and the roles disagreeing, and its log is
#       public. The gate may --check, and may --sync what .env already says;
#   a deploy/compose/.env that is not the persisted file
#       (${MANAGED_ENV_PERSIST_DIR:-~/.persistent/<project>}/.env): the gate
#       restores that file on every run, so a value written anywhere else is
#       overwritten by the next run. It names both paths, and the keys whose
#       values differ, never a value;
#   a CI job running on this machine (a Runner.Worker process), or an
#       E2E (managed) run queued or in progress when gh is signed in: a run
#       that overlaps copies its old .env back over the persisted one;
#   no env-upsert.sh or no openssl; postgres not healthy;
#   a control that does not open: .env and the database already disagree,
#       and --sync is the step for that;
#   a POSTGRES_USER that is not a login superuser in the database, and an
#       APP_DB_USER other than app_user (renames stay by hand, 0132 T2 step 5);
#   a login role it does not change that a shipped value still opens (the
#       owner's old name): its own check at the end tries that role too, so
#       the rotation could only fail and be put back. It names the role and
#       0132 T2 step 5, `ALTER ROLE <name> NOLOGIN`, never DROP;
#   and anything but the project name typed back.
# Then it keeps a copy of .env (<persisted dir>/.env.before-rotation-<UTC>,
# mode 0600), generates `openssl rand -hex 24` for APP_DB_PASSWORD and
# POSTGRES_PASSWORD (and CLICKHOUSE_PASSWORD and MINIO_ROOT_PASSWORD with
# --with-trigger-stores; those need no ALTER, the containers take them when
# they are recreated), writes them with env-upsert.sh --from-env, sets the
# roles (--sync), proves them, and checks that no shipped value opens either.
# On any failure after the write, and on an interrupt, it copies the kept
# .env's content back into the file (so a link stays a link), sets the roles
# back to it, proves that, and exits 1 naming the step. While it puts things
# back it ignores INT, TERM and HUP: a second Ctrl-C there would leave both
# roles on values stored nowhere. If the putting back does not complete, it
# keeps the copy and says what to run. On success it deletes
# the copy, and says what changed, that this stack's app cannot open new
# database connections until its containers are recreated, the one next step
# (dispatch E2E (managed) on main; it does that itself when gh is signed in),
# and the line for 0132 T0's record.
#
# HOW A VALUE TRAVELS. Never as an argument, anywhere: docker, psql and
# env-upsert.sh are given each value in their environment, by name, and the
# ALTER reads it inside the container (db-roles.sh says how). No
# `docker exec -e NAME=value`, and no Compose bring-up from this checkout. It
# prints no value and no address, and it refuses to run traced.
#
# Exit codes:
#   --check   0 both controls open and no shipped value opens anything asked;
#             1 a shipped value opens (the lines above say which);
#             2 nothing established: a control did not open, or a question
#               could not be asked (zitadel-db-password.sh's convention).
#   --sync    0 set and proven; 1 refused, the set failed, or a role refuses
#             the value it was just given; 2 set, or not, and not proven.
#   --rotate  0 changed and checked; 1 refused before anything changed, or
#             failed and put back (it says which, and if the putting back did
#             not complete, what to do).
#   2 as well for a usage error.
#
# Env overrides:
#   MANAGED_ENV_PERSIST_DIR   the persisted .env's directory (default
#                             ~/.persistent/<project>), as the gate reads it
case "$-" in *x*) ROTATE_TRACED=1 ;; *) ROTATE_TRACED='' ;; esac; set +x
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

# A refusal in --check is "nothing established" (2); in the others, "refused,
# nothing changed" (1). Set once the mode is known.
REFUSE_EXIT=1

say() { printf '[rotate-db-passwords] %s\n' "$@"; }
item() { printf '    %s\n' "$@"; }
refuse() {
  printf '[rotate-db-passwords] refused: %s\n' "$1" >&2
  shift
  [ "$#" -eq 0 ] || printf '  %s\n' "$@" >&2
  printf '[rotate-db-passwords] Nothing was changed.\n' >&2
  exit "$REFUSE_EXIT"
}
usage() {
  echo "usage: ./deploy/compose/rotate-db-passwords.sh [--check | --sync | --rotate [--with-trigger-stores]]   (--help for more)" >&2
  exit 2
}

if [ -n "$ROTATE_TRACED" ] || [ -n "${BASH_XTRACEFD+set}" ]; then
  refuse "this was started with xtrace (set -x, bash -x, SHELLOPTS or BASH_XTRACEFD). Tracing prints every value a command is given, and this handles passwords." \
    "Run it again without tracing."
fi

MODE='' WITH_STORES=''
for arg in "$@"; do
  case "$arg" in
    --check | --sync | --rotate)
      [ -z "$MODE" ] || usage
      MODE="${arg#--}"
      ;;
    --with-trigger-stores) WITH_STORES=1 ;;
    -h | --help)
      sed -n '2,/^case "\$-"/p' "${BASH_SOURCE[0]}" | sed '$d'
      exit 0
      ;;
    *) usage ;;
  esac
done
MODE="${MODE:-check}"
[ -z "$WITH_STORES" ] || [ "$MODE" = rotate ] || usage
[ "$MODE" != check ] || REFUSE_EXIT=2

# env_value and compose_project, the one reader of a compose .env.
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# Live's marker, named once.
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"

[ -f "$ENV_FILE" ] || refuse "${ENV_FILE} does not exist, or is a link to nothing. This asks about the stack that .env describes."
for arg in COMPOSE_ENV_FILES COMPOSE_FILE; do
  if [ -n "${!arg+set}" ]; then
    refuse "this shell has ${arg} set. Compose would follow it to another stack's files instead of this checkout's." \
      "Open a new shell (or: unset ${arg}) and run this again."
  fi
done
if [ "$MODE" != check ] && stack_may_be_live "$ENV_FILE"; then
  refuse "${ENV_FILE} has a ${STACK_KIND_KEY} line: live's marker, or something that could be a slip of it. Its value is not printed." \
    "Live's database passwords are made fresh when live is stood up (workplan 0132 T1b) and are its own (D8); changing them waits for live's hold (T6)." \
    "--check may be run there; --sync and --rotate may not."
fi

# The project this checkout drives, from the one reader, before any Compose
# command: it refuses a shell that names the other stack.
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || refuse "the checkout's project could not be read (above)."
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml" --env-file "${ENV_FILE}")
# The two roles' functions, shared with T2 (b)'s bring-up.
# shellcheck source=deploy/compose/db-roles.sh
. "${SCRIPT_DIR}/db-roles.sh"
db_roles_init "$ENV_FILE" || refuse "the checkout's project could not be read (above)."

# ---------------------------------------------------------------------------
# What was shipped, and what the output calls it
# ---------------------------------------------------------------------------

# Postgres. app_password: the first migration creates app_user with it
# (0001_baseline.sql), and APP_DB_PASSWORD's default is the same.
# openmigrate_password: POSTGRES_PASSWORD's default in managed.yml.
# change-me-openmigrate: POSTGRES_PASSWORD in managed.env.example.
PG_SHIPPED=(app_password openmigrate_password change-me-openmigrate)
PG_SHIPPED_FROM=("the migration's default" "compose's default" "the example's value")
# ClickHouse. CLICKHOUSE_PASSWORD's default in managed.yml, password, and the
# example's, change-me-clickhouse.
CH_SHIPPED=(password change-me-clickhouse)
CH_SHIPPED_FROM=("compose's default" "the example's value")
# MinIO. MINIO_ROOT_PASSWORD's default in managed.yml, very-safe-password, and
# the example's, change-me-minio.
MINIO_SHIPPED=(very-safe-password change-me-minio)
MINIO_SHIPPED_FROM=("compose's default" "the example's value")
# Trigger.dev's own database: written into managed.yml, for the role trigger.
TRIGGER_DB_SHIPPED='trigger_password'

# A shipped value is public, so it may be an argument (clickhouse-client takes
# its password no other way); the values in .env and the generated ones never
# are.

# What a control is given, and where it came from.
from_env() { # from_env <key> — ".env's KEY", or compose's default when it is empty
  if [ -n "$(env_value "$ENV_FILE" "$1")" ]; then
    printf "%s from .env" "$1"
  else
    printf "compose's default (%s is empty in .env)" "$1"
  fi
}

# ---------------------------------------------------------------------------
# --check, in parts
# ---------------------------------------------------------------------------

OPENED=0
UNASKED=0
CONTROLS_OPEN=1
# Of OPENED, those on a Postgres role --rotate does not change, and their names.
OPENED_OTHER=0
OTHER_ROLES=''

# The Postgres roles that could hold a shipped value, each once, in PG_TRY:
# the owner by its real name, app_user, the default owner's name, APP_DB_USER.
pg_roles_to_try() {
  local role
  PG_TRY=()
  for role in "$DB_ROLES_OWNER" app_user openmigrate "$DB_ROLES_APP"; do
    [[ " ${PG_TRY[*]:-} " == *" ${role} "* ]] || PG_TRY+=("$role")
  done
}

# The command a human pastes to take a role's login away (0132 T2 step 5).
# $POSTGRES_USER and $POSTGRES_DB stay literal: the container expands them.
nologin_hint() { # nologin_hint <role>
  printf '%s' "docker compose -f deploy/compose/managed.yml exec -T postgres sh -c 'psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"ALTER ROLE ${1} NOLOGIN\"'"
}

# The roles, and the controls. Returns nothing; sets the three above.
check_controls() {
  local i rc channel
  local -a names=("$DB_ROLES_OWNER" "$DB_ROLES_APP")
  local -a values=("$DB_ROLES_OWNER_PASSWORD" "$DB_ROLES_APP_PASSWORD")
  local -a keys=(POSTGRES_PASSWORD APP_DB_PASSWORD)
  say "stack ${COMPOSE_PROJECT}, database ${DB_ROLES_DB}"
  if ! db_roles_list; then
    say "the login roles could not be listed (over the socket, as ${DB_ROLES_OWNER}): ${DB_ROLES_WHY}"
    UNASKED=1
    CONTROLS_OPEN=''
    return 0
  fi
  say "login roles, over the socket (names and flags, no password):"
  local name super login
  while IFS='|' read -r name super login; do
    [ -n "$name" ] || continue
    if [ "$super" = t ]; then item "${name} (superuser)"; else item "$name"; fi
  done <<<"$DB_ROLES_LIST"

  say "controls: .env's own values, asked the way the stack's containers ask:"
  for i in 0 1; do
    if ! db_roles_has "${names[$i]}"; then
      item "${names[$i]}: not a login role in this database, so its control cannot open"
      CONTROLS_OPEN=''
      continue
    fi
    for channel in network pooler; do
      rc=0
      db_roles_ask "$channel" "${names[$i]}" "${values[$i]}" || rc=$?
      local where='over the network'
      [ "$channel" = network ] || where='through the pooler'
      case "$rc" in
        0) item "${names[$i]}, $(from_env "${keys[$i]}"), ${where}: opens" ;;
        1)
          item "${names[$i]}, $(from_env "${keys[$i]}"), ${where}: REFUSED"
          CONTROLS_OPEN=''
          ;;
        *)
          item "${names[$i]}, $(from_env "${keys[$i]}"), ${where}: could not be asked (${DB_ROLES_WHY})"
          CONTROLS_OPEN=''
          UNASKED=1
          ;;
      esac
    done
  done
}

# The shipped Postgres values, over the network, against each role given that
# is a login role. Counts into OPENED, and a role that opens and is neither the
# owner nor APP_DB_USER into OPENED_OTHER and OTHER_ROLES; returns nothing.
check_pg_shipped() { # check_pg_shipped <role>...
  local role k rc
  say "shipped values, over the network:"
  for role in "$@"; do
    if ! db_roles_has "$role"; then
      item "${role}: not a login role in this database, not asked"
      continue
    fi
    for k in "${!PG_SHIPPED[@]}"; do
      rc=0
      db_roles_ask network "$role" "${PG_SHIPPED[$k]}" || rc=$?
      case "$rc" in
        0)
          item "${role}, ${PG_SHIPPED_FROM[$k]}: OPENS"
          OPENED=$((OPENED + 1))
          if [ "$role" != "$DB_ROLES_OWNER" ] && [ "$role" != "$DB_ROLES_APP" ]; then
            OPENED_OTHER=$((OPENED_OTHER + 1))
            [[ " ${OTHER_ROLES} " == *" ${role} "* ]] || OTHER_ROLES="${OTHER_ROLES:+${OTHER_ROLES} }${role}"
          fi
          ;;
        1) item "${role}, ${PG_SHIPPED_FROM[$k]}: refused" ;;
        *)
          item "${role}, ${PG_SHIPPED_FROM[$k]}: could not be asked (${DB_ROLES_WHY})"
          UNASKED=1
          ;;
      esac
    done
  done
}

# ClickHouse and MinIO, inside their own containers, and trigger-db over the
# network. Counts into OPENED (trigger-db excepted); returns nothing.
check_stores() {
  local k out rc health user
  say "Trigger.dev's stores:"

  user="$(env_value "$ENV_FILE" CLICKHOUSE_USER default)"
  health="$("${COMPOSE[@]}" ps --format '{{.Health}}' clickhouse 2>/dev/null)" || health=''
  if [ "$health" != healthy ]; then
    item "ClickHouse ${user}: control: the container is not healthy (${health:-not running}), so nothing was asked"
    UNASKED=1
  else
    item "ClickHouse ${user}: control: the container is healthy, and its health check logs in with its own password"
    for k in "${!CH_SHIPPED[@]}"; do
      out=$("${COMPOSE[@]}" exec -T clickhouse clickhouse-client --user "$user" --password "${CH_SHIPPED[$k]}" \
        --query 'SELECT 1' 2>&1) && rc=0 || rc=$?
      if [ "$rc" -eq 0 ]; then
        item "ClickHouse ${user}, ${CH_SHIPPED_FROM[$k]}: OPENS"
        OPENED=$((OPENED + 1))
      elif [[ "$out" == *AUTHENTICATION_FAILED* || "$out" == *"Authentication failed"* ]]; then
        item "ClickHouse ${user}, ${CH_SHIPPED_FROM[$k]}: refused"
      else
        item "ClickHouse ${user}, ${CH_SHIPPED_FROM[$k]}: could not be asked ($(db_roles_masked "$out"))"
        UNASKED=1
      fi
    done
  fi

  # MinIO has no health check. Its control is its own pair, asked inside the
  # container, where the values stay in that container's environment. mc takes
  # an alias from MC_HOST_<alias>, so a value is never an argument there either.
  user="$(env_value "$ENV_FILE" MINIO_ROOT_USER admin)"
  out=$("${COMPOSE[@]}" exec -T minio sh -c \
    'MC_HOST_probe="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:9000" mc --config-dir /tmp/rotate-db-passwords-mc ls probe' \
    2>&1) && rc=0 || rc=$?
  if [ "$rc" -ne 0 ]; then
    case "$out" in
      *"not found"* | *"executable file not found"*)
        item "MinIO ${user}: control: this MinIO image carries no mc client, so nothing was asked" ;;
      *) item "MinIO ${user}: control: its own pair did not open ($(db_roles_masked "$out")), so nothing was asked" ;;
    esac
    UNASKED=1
  else
    item "MinIO ${user}: control: its own pair opens"
    for k in "${!MINIO_SHIPPED[@]}"; do
      out=$(MC_HOST_probe="http://${user}:${MINIO_SHIPPED[$k]}@127.0.0.1:9000" \
        "${COMPOSE[@]}" exec -T -e MC_HOST_probe minio mc --config-dir /tmp/rotate-db-passwords-mc ls probe 2>&1) && rc=0 || rc=$?
      if [ "$rc" -eq 0 ]; then
        item "MinIO ${user}, ${MINIO_SHIPPED_FROM[$k]}: OPENS"
        OPENED=$((OPENED + 1))
      elif [[ "$out" == *"signature we calculated does not match"* || "$out" == *"Access Key Id you provided does not exist"* || "$out" == *SignatureDoesNotMatch* || "$out" == *InvalidAccessKeyId* ]]; then
        item "MinIO ${user}, ${MINIO_SHIPPED_FROM[$k]}: refused"
      else
        item "MinIO ${user}, ${MINIO_SHIPPED_FROM[$k]}: could not be asked ($(db_roles_masked "$out"))"
        UNASKED=1
      fi
    done
  fi

  # trigger-db: over the stack's network, like every other password question.
  local label="the value written into managed.yml"
  grep -q "$TRIGGER_DB_SHIPPED" "${SCRIPT_DIR}/managed.yml" || label="the value managed.yml carried"
  out=$(PGPASSWORD="$TRIGGER_DB_SHIPPED" docker run --rm -e PGPASSWORD --network "$DB_ROLES_NETWORK" \
    "$DB_ROLES_CLIENT_IMAGE" psql -h trigger-db -p 5432 -U trigger -d triggerdb -tAc 'SELECT 1' 2>&1) && rc=0 || rc=$?
  if [ "$rc" -eq 0 ]; then
    item "trigger-db trigger, ${label}: OPENS (not counted: waits for T2's code, which makes it TRIGGER_DB_PASSWORD)"
  elif [[ "$out" == *"password authentication failed"* ]]; then
    item "trigger-db trigger, ${label}: refused (not counted: waits for T2's code)"
  else
    item "trigger-db trigger, ${label}: could not be asked ($(db_roles_masked "$out")) (not counted: waits for T2's code)"
  fi
}

do_check() {
  local role
  check_controls
  if [ -n "$DB_ROLES_LIST" ]; then
    pg_roles_to_try
    check_pg_shipped "${PG_TRY[@]}"
  fi
  check_stores
  if [ "$OPENED" -gt 0 ]; then
    say "RESULT: ${OPENED} shipped value(s) open (above)."
    # A role --rotate does not change: by hand, first, or --rotate refuses.
    for role in $OTHER_ROLES; do
      if [ "$role" = app_user ]; then
        say "  app_user opens, and APP_DB_USER names ${DB_ROLES_APP}: the rotation changes app_user only, and refuses another name."
        say "  Workplan 0132 T2, step 5, by hand: set APP_DB_USER back to app_user, and give ${DB_ROLES_APP} NOLOGIN (never DROP it)."
      else
        say "  ${role} is a login role the rotation does not change, and the rotation refuses to start while a shipped value opens it."
        say "  Workplan 0132 T2, step 5, by hand: take its login away, and never DROP it (the owner's old name owns the schema):"
        say "    $(nologin_hint "$role")"
      fi
    done
    if [ "$OPENED" -gt "$OPENED_OTHER" ]; then
      if [ -n "$OTHER_ROLES" ]; then
        say "  Then, on the OTA stack, change the rest with --rotate --with-trigger-stores at a quiet time: docs/managed-bring-up.md, \"Changing the database passwords\"."
      else
        say "  On the OTA stack, change them with --rotate --with-trigger-stores at a quiet time: docs/managed-bring-up.md, \"Changing the database passwords\"."
      fi
      say "  On live, they are its own .env's, set before its first bring-up (workplan 0132 D8)."
    fi
    exit 1
  fi
  if [ -z "$CONTROLS_OPEN" ]; then
    say "RESULT: NOT ESTABLISHED. A control did not open, so a refused shipped value proves nothing."
    say "  If .env and the database disagree, set the roles to .env's values: ./deploy/compose/rotate-db-passwords.sh --sync"
    say "  (read zitadel-db-password.sh's header first if a second .env exists on this machine)."
    exit 2
  fi
  if [ "$UNASKED" -ne 0 ]; then
    say "RESULT: NOT ESTABLISHED. A question above could not be asked; nothing opened among those that were."
    exit 2
  fi
  say "RESULT: both controls open, and no shipped value opens anything asked."
  exit 0
}

# ---------------------------------------------------------------------------
# --sync
# ---------------------------------------------------------------------------

# Prints what db_roles_prove found, one line per question.
show_proof() {
  local name channel rc why where
  while IFS='|' read -r name channel rc why; do
    [ -n "$name" ] || continue
    where='over the network'
    [ "$channel" = network ] || where='through the pooler'
    case "$rc" in
      0) item "${name}, ${where}: opens" ;;
      1) item "${name}, ${where}: REFUSED" ;;
      *) item "${name}, ${where}: could not be asked (${why})" ;;
    esac
  done <<<"$DB_ROLES_PROOF"
}

# The roles as they must be before either writing mode sets them.
require_roles() {
  db_roles_list || refuse "the login roles could not be listed (over the socket, as ${DB_ROLES_OWNER}): ${DB_ROLES_WHY}"
  db_roles_has "$DB_ROLES_OWNER" super ||
    refuse "POSTGRES_USER in .env names ${DB_ROLES_OWNER}, which is not a login superuser in this database." \
      "The ALTER runs as the owner and keeps itself out of the database's log, which only a superuser may do."
  db_roles_has "$DB_ROLES_APP" ||
    refuse "${DB_ROLES_APP} (APP_DB_USER) is not a login role in this database yet. The first migration creates app_user; bring the stack up first."
}

do_sync() {
  local rc=0
  require_roles
  say "setting ${DB_ROLES_APP} and ${DB_ROLES_OWNER} to the values in .env: one transaction, over the socket as ${DB_ROLES_OWNER}"
  if ! db_roles_set "$DB_ROLES_OWNER_PASSWORD" "$DB_ROLES_APP_PASSWORD"; then
    say "FAILED: the roles were not changed: ${DB_ROLES_WHY}" >&2
    exit 1
  fi
  db_roles_prove "$DB_ROLES_OWNER_PASSWORD" "$DB_ROLES_APP_PASSWORD" || rc=$?
  say "asked the way the stack's containers ask:"
  show_proof
  case "$rc" in
    0)
      say "done: both roles accept .env's values. A container created from this .env presents them already;"
      say "one created from another .env presents that one's, and has to be recreated from this."
      exit 0
      ;;
    1)
      say "FAILED: the ALTER took and a role still refuses the value it was just given. Nothing here can explain that; read the database's and the pooler's logs." >&2
      exit 1
      ;;
    *)
      say "NOT ESTABLISHED: the roles were set, and a question above could not be asked, so it is not proven." >&2
      exit 2
      ;;
  esac
}

# ---------------------------------------------------------------------------
# --rotate
# ---------------------------------------------------------------------------

ROTATE_STAGE=''   # '' | kept (the copy exists) | written (.env may have changed)
ROTATE_STEP=''
ROTATE_WHY=''
ROTATE_BACKUP=''
ROTATE_RESTORE_WHY=''
ENV_RESOLVED=''

# The key names whose values differ between two .env files. Names only.
differing_keys() { # differing_keys <file> <file>
  local key
  local -a out=()
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    [ "$(env_value "$1" "$key")" = "$(env_value "$2" "$key")" ] || out+=("$key")
  done <<<"$(sed -n 's/^\(export[[:space:]][[:space:]]*\)\{0,1\}\([A-Za-z_][A-Za-z0-9_]*\)=.*/\2/p' "$1" "$2" | sort -u)"
  printf '%s' "${out[*]:-}"
}

fail() { # fail <why> — the EXIT trap puts things back
  ROTATE_WHY="${1:-}"
  exit 1
}

# The kept .env's content back into the file (a link stays a link), the roles
# set back to it, and that proven. 0 when both roles accept the old values.
rotate_restore() {
  local rc=0
  ROTATE_RESTORE_WHY=''
  if ! cp -- "$ROTATE_BACKUP" "$ENV_RESOLVED" || ! cmp -s -- "$ROTATE_BACKUP" "$ENV_RESOLVED"; then
    ROTATE_RESTORE_WHY="the kept copy could not be written back into ${ENV_RESOLVED}"
    return 1
  fi
  db_roles_init "$ENV_FILE" || {
    ROTATE_RESTORE_WHY="the project could not be read again"
    return 1
  }
  if ! db_roles_set "$DB_ROLES_OWNER_PASSWORD" "$DB_ROLES_APP_PASSWORD"; then
    # A failed ALTER changed nothing, so the roles may hold the old values
    # already. The proof below is what decides.
    say "  setting the roles back did not run (${DB_ROLES_WHY}); asking whether they hold the old values anyway" >&2
  fi
  db_roles_prove "$DB_ROLES_OWNER_PASSWORD" "$DB_ROLES_APP_PASSWORD" || rc=$?
  if [ "$rc" -ne 0 ]; then
    ROTATE_RESTORE_WHY="a role does not accept its old value again: $(printf '%s' "$DB_ROLES_PROOF" | awk -F'|' '$3 != 0 { printf "%s %s (%s) ", $1, $2, ($3 == 1 ? "refused" : $4) }')"
    return 1
  fi
  return 0
}

rotate_on_exit() {
  local rc=$?
  set +e
  # Spent, and from here on an interrupt is ignored, not the default: a second
  # Ctrl-C (or TERM or HUP) while the old values go back would end this with
  # .env restored, both roles on generated values stored nowhere, and nothing
  # said. A child that dies of it fails its step, and that is reported below.
  trap - EXIT
  trap '' INT TERM HUP
  case "$ROTATE_STAGE" in
    written)
      printf '[rotate-db-passwords] FAILED while %s%s.\n' "$ROTATE_STEP" "${ROTATE_WHY:+: ${ROTATE_WHY}}" >&2
      printf '[rotate-db-passwords] Putting the old values back; interrupts are ignored until that is done. The old .env is kept at %s until then.\n' "$ROTATE_BACKUP" >&2
      if rotate_restore; then
        rm -f -- "$ROTATE_BACKUP"
        printf '[rotate-db-passwords] restored: .env holds its old values again, and both roles accept them over the network and through the pooler. Nothing has changed.\n' >&2
      else
        printf '[rotate-db-passwords] THE PUTTING BACK DID NOT COMPLETE: %s.\n' "$ROTATE_RESTORE_WHY" >&2
        printf '  The old .env is kept at %s (mode 0600). No value is printed.\n' "$ROTATE_BACKUP" >&2
        printf '  1. cp %s %s\n' "$ROTATE_BACKUP" "$ENV_RESOLVED" >&2
        printf '  2. ./deploy/compose/rotate-db-passwords.sh --sync     (sets both roles to that .env)\n' >&2
        printf '  3. ./deploy/compose/rotate-db-passwords.sh --check    (then delete the kept copy)\n' >&2
      fi
      exit 1
      ;;
    kept)
      rm -f -- "$ROTATE_BACKUP"
      ;;
  esac
  exit "$rc"
}

do_rotate() {
  local v key rc typed active=''
  local gh_ready=''

  # ---- Refusals that ask nothing of the stack --------------------------------
  for v in GITHUB_ACTIONS CI; do
    if [ -n "${!v:-}" ]; then
      refuse "${v} is set: this is CI, and CI never makes a password." \
        "A run that died halfway would leave .env and the roles disagreeing, and a CI log is public. The gate may run --check, and --sync of what .env already says."
    fi
  done
  if [ "$DB_ROLES_APP" != app_user ]; then
    refuse "APP_DB_USER in .env names ${DB_ROLES_APP}, not app_user. The migrations grant to app_user by name." \
      "A renamed application role stays a step by hand (workplan 0132 T2, step 5); set it back to app_user first."
  fi

  local persist_dir persisted
  persist_dir="${MANAGED_ENV_PERSIST_DIR:-$HOME/.persistent/${COMPOSE_PROJECT}}"
  persisted="${persist_dir}/.env"
  ENV_RESOLVED="$(readlink -f "$ENV_FILE")"
  if ! [ "$ENV_FILE" -ef "$persisted" ]; then
    if [ -f "$persisted" ]; then
      local differ
      differ="$(differing_keys "$ENV_FILE" "$persisted")"
      refuse "this checkout's .env is ${ENV_RESOLVED}, not the persisted ${persisted}. The gate restores that file on every run, so a value written anywhere else is overwritten by the next run." \
        "Keys whose values differ between the two: ${differ:-none (the two hold the same values)}. No value is printed." \
        "Make them one file (docs/managed-bring-up.md, \"One stack, one .env\"), then run this again."
    fi
    refuse "there is no persisted .env at ${persisted}, and this checkout's is ${ENV_RESOLVED}. The gate restores its .env from there on every run." \
      "Make them one file (docs/managed-bring-up.md, \"One stack, one .env\"), or set MANAGED_ENV_PERSIST_DIR to where it is."
  fi
  [ -x "${SCRIPT_DIR}/env-upsert.sh" ] || refuse "${SCRIPT_DIR}/env-upsert.sh is missing or not executable: it is the one writer of .env."
  command -v openssl >/dev/null 2>&1 || refuse "openssl is not installed: it makes the new values."

  # A CI job on this machine: the gate's run restores and copies back .env.
  command -v pgrep >/dev/null 2>&1 || refuse "pgrep is not installed, so a CI job running on this machine cannot be ruled out."
  rc=0
  pgrep -f Runner.Worker >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) refuse "a GitHub Actions job is running on this machine (a Runner.Worker process). A gate run that overlaps copies its old .env back over the persisted one." \
      "Wait until it has finished (pgrep -c -f Runner.Worker prints 0), and run this again." ;;
    1) ;;
    *) refuse "pgrep could not be asked whether a CI job is running here (exit ${rc})." ;;
  esac
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    active="$(cd "$REPO_ROOT" && gh run list --workflow e2e-managed.yml --limit 20 --json status \
      --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null)" ||
      refuse "gh is signed in, and could not list E2E (managed)'s runs, so a queued run cannot be ruled out." \
        "Look at Actions, E2E (managed) on GitHub, and run this again when nothing is queued or in progress."
    [[ "$active" =~ ^[0-9]+$ ]] || refuse "gh answered something that is not a count when asked for E2E (managed)'s runs."
    [ "$active" -eq 0 ] ||
      refuse "E2E (managed) has ${active} run(s) queued or in progress. A run that overlaps copies its old .env back over the persisted one." \
        "Run this again after it has finished."
    gh_ready=1
  else
    say "gh is not signed in here, so GitHub was not asked whether E2E (managed) is queued."
    say "  Look at Actions, E2E (managed), before you type the name below: nothing may be queued or in progress."
  fi

  # ---- Refusals that ask the stack -------------------------------------------
  local health
  health="$("${COMPOSE[@]}" ps --format '{{.Health}}' postgres 2>/dev/null)" || health=''
  [ "$health" = healthy ] || refuse "postgres is not healthy (${health:-not running}). Nothing can be set or proven."
  require_roles
  rc=0
  db_roles_prove "$DB_ROLES_OWNER_PASSWORD" "$DB_ROLES_APP_PASSWORD" || rc=$?
  say "controls: .env's own values, asked the way the stack's containers ask:"
  show_proof
  case "$rc" in
    0) ;;
    1) refuse ".env and the database already disagree (above), so a new value would be set over an unknown one." \
      "Set the roles to .env's values first: ./deploy/compose/rotate-db-passwords.sh --sync, then --check." ;;
    *) refuse "a control could not be asked (above), so nothing about the roles is established." ;;
  esac

  # ---- A login role this does not change, on a shipped value --------------------
  # The check at the end tries every role that could hold a shipped value. One
  # this does not change (the owner's old name, left with LOGIN after a rename)
  # would fail it every time, after .env and both roles had changed, and all
  # of it would be put back. So it is asked now.
  local role
  local -a others=()
  pg_roles_to_try
  for role in "${PG_TRY[@]}"; do
    [ "$role" = "$DB_ROLES_OWNER" ] || [ "$role" = "$DB_ROLES_APP" ] || others+=("$role")
  done
  if [ "${#others[@]}" -gt 0 ]; then
    OPENED=0 UNASKED=0 OPENED_OTHER=0 OTHER_ROLES=''
    check_pg_shipped "${others[@]}"
    if [ "$OPENED" -gt 0 ]; then
      local -a hints=()
      for role in $OTHER_ROLES; do hints+=("  $(nologin_hint "$role")"); done
      refuse "a shipped value opens ${OTHER_ROLES} (above), a login role this does not change. Its check at the end would fail, and everything would be put back." \
        "Workplan 0132 T2, step 5, by hand: take its login away, and never DROP it (the owner's old name owns the schema):" \
        "${hints[@]}" \
        "Then ./deploy/compose/rotate-db-passwords.sh --check, and this again."
    fi
    [ "$UNASKED" -eq 0 ] ||
      refuse "a shipped value could not be asked of ${others[*]} (above), so the check at the end could not pass."
  fi

  # ---- The owner says yes ------------------------------------------------------
  local -a keys=(APP_DB_PASSWORD POSTGRES_PASSWORD)
  [ -z "$WITH_STORES" ] || keys+=(CLICKHOUSE_PASSWORD MINIO_ROOT_PASSWORD)
  say "This makes new values for ${keys[*]}, writes them to ${ENV_RESOLVED},"
  say "and sets the roles ${DB_ROLES_APP} and ${DB_ROLES_OWNER} to them. No value is printed."
  say "From then until the containers are recreated, this stack's app cannot open new database connections."
  printf '[rotate-db-passwords] Type the project name (%s) to go on: ' "$COMPOSE_PROJECT"
  typed=''
  IFS= read -r typed || true
  printf '\n'
  [ "$typed" = "$COMPOSE_PROJECT" ] || refuse "what was typed is not the project name."

  # ---- The new values, in this shell only ---------------------------------------
  declare -A new=()
  for key in "${keys[@]}"; do
    v="$(openssl rand -hex 24)" || refuse "openssl rand failed."
    [[ "$v" =~ ^[0-9a-f]{48}$ ]] || refuse "openssl rand gave something that is not 48 hex digits."
    new[$key]="$v"
  done

  # ---- Kept, written, set, proven ---------------------------------------------------
  ROTATE_BACKUP="${persist_dir}/.env.before-rotation-$(date -u +%Y%m%dT%H%M%SZ)"
  trap rotate_on_exit EXIT
  trap 'ROTATE_WHY="interrupted"; exit 1' INT TERM HUP
  (umask 077 && cp -- "$ENV_RESOLVED" "$ROTATE_BACKUP") || refuse "could not keep a copy of .env at ${ROTATE_BACKUP}."
  ROTATE_STAGE=kept
  chmod 600 "$ROTATE_BACKUP" || refuse "could not make ${ROTATE_BACKUP} mode 0600."

  ROTATE_STEP='writing .env'
  ROTATE_STAGE=written
  APP_DB_PASSWORD="${new[APP_DB_PASSWORD]}" POSTGRES_PASSWORD="${new[POSTGRES_PASSWORD]}" \
    CLICKHOUSE_PASSWORD="${new[CLICKHOUSE_PASSWORD]:-}" MINIO_ROOT_PASSWORD="${new[MINIO_ROOT_PASSWORD]:-}" \
    "${SCRIPT_DIR}/env-upsert.sh" --from-env "$ENV_FILE" "${keys[@]}" >/dev/null ||
    fail "env-upsert.sh refused (above)"
  for key in "${keys[@]}"; do
    [ "$(env_value "$ENV_FILE" "$key")" = "${new[$key]}" ] || fail "${key} does not read back as written"
  done

  ROTATE_STEP='setting the roles to the new values'
  db_roles_init "$ENV_FILE" || fail "the project could not be read again"
  db_roles_set "$DB_ROLES_OWNER_PASSWORD" "$DB_ROLES_APP_PASSWORD" || fail "$DB_ROLES_WHY"

  ROTATE_STEP='proving the new values over the network and through the pooler'
  rc=0
  db_roles_prove "$DB_ROLES_OWNER_PASSWORD" "$DB_ROLES_APP_PASSWORD" || rc=$?
  if [ "$rc" -ne 0 ]; then
    show_proof >&2
    fail "a role did not accept its new value, or could not be asked (above)"
  fi

  ROTATE_STEP='checking that no shipped value opens a role'
  OPENED=0
  UNASKED=0
  db_roles_list || fail "the login roles could not be listed: ${DB_ROLES_WHY}"
  pg_roles_to_try
  check_pg_shipped "${PG_TRY[@]}"
  [ "$OPENED" -eq 0 ] || fail "a shipped value still opens a role (above)"
  [ "$UNASKED" -eq 0 ] || fail "a shipped value could not be asked (above)"

  # ---- Done ------------------------------------------------------------------------
  ROTATE_STAGE=''
  trap - EXIT INT TERM HUP
  rm -f -- "$ROTATE_BACKUP"
  say "done. Changed in ${ENV_RESOLVED}: ${keys[*]}. No value is printed, here or anywhere."
  say "${DB_ROLES_APP} and ${DB_ROLES_OWNER} accept the new values over the network and through the pooler, and no shipped value opens either."
  say "UNTIL THE CONTAINERS ARE RECREATED this stack's app cannot open new database connections:"
  say "  the API, the identity provider's admin connection and the Trigger.dev tasks still present the old values."
  if [ -n "$WITH_STORES" ]; then
    say "ClickHouse and MinIO take their new values when their containers are recreated; nothing was asked of them here."
    say "  If MinIO refuses the new pair on its old volume, what is lost is its packets store: old large run payloads."
  fi
  say "NEXT, the one step: E2E (managed) on main. It restores this .env, recreates every container whose settings changed,"
  say "  uploads DATABASE_URL and APP_DATABASE_URL to Trigger.dev again, and its smoke proves a task still connects."
  if [ -n "$gh_ready" ] && (cd "$REPO_ROOT" && gh workflow run e2e-managed.yml --ref main) >/dev/null 2>&1; then
    say "  Dispatched it (gh workflow run e2e-managed.yml --ref main)."
  else
    say "  Dispatch it: on GitHub, Actions, E2E (managed), Run workflow, on main."
  fi
  say "Once that run is green: ./deploy/compose/rotate-db-passwords.sh --check. It exits 0 when both controls open and nothing shipped does."
  say "For workplan 0132 T0's record (step 2), after that check: \"$(date -u +%Y-%m-%d): the OTA stack's database passwords changed; the shipped values refused.\" Never a value."
  exit 0
}

case "$MODE" in
  check) do_check ;;
  sync) do_sync ;;
  rotate) do_rotate ;;
esac
