#!/usr/bin/env bash
# rotate-db-passwords.sh — the stack's database passwords: which shipped value
# still opens a role, the roles set to what .env says, and new values made on
# this machine without ever being printed (workplan 0132 T0 step 2, T2).
#
#   ./deploy/compose/rotate-db-passwords.sh [--check]    ask; change nothing
#   ./deploy/compose/rotate-db-passwords.sh --sync
#       set the roles to .env
#   ./deploy/compose/rotate-db-passwords.sh --rotate
#       new values in .env and the roles
#
# --with-trigger-stores, which added Trigger.dev's three stores (trigger-db,
# ClickHouse, MinIO), is refused since alpha.18 removed them (workplan 0167
# T9); so are the steps of the --check below that asked them.
#
# WHICH STACK. --check runs on any stack, live included: it changes nothing,
# and 0132 T0 step 5 runs it on live. --sync and --rotate refuse a stack that
# may be live (stack_may_be_live, stack-kind.sh: live's marker, or anything
# that could be a slip of it), before they ask the stack anything.
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
#   4. and 5. asked ClickHouse, MinIO and trigger-db, Trigger.dev's stores,
#      until alpha.18 removed them;
#   6. asks the jobs role, `ownpace_jobs` (ADR-0054), with .env's
#      JOBS_DB_PASSWORD over the network and through the pooler, as the worker
#      will: a control, when the role is a login role here (the bring-up's
#      data phase makes it). It has no default and no shipped value, so
#      nothing else is tried; an empty key with the role there is a question
#      that cannot be asked.
#   One line per pair: the account, where the value comes from, opens or
#   refused. Never the value. A role that opens and is neither the owner nor
#   APP_DB_USER (the owner's old name, left with LOGIN after a rename) is one
#   --rotate does not change: for it, the advice is 0132 T2 step 5 by hand,
#   `ALTER ROLE <name> NOLOGIN`, never DROP, and not --rotate.
#
# --sync sets the owner's and app_user's passwords to what .env holds, in one
# transaction, over the socket as the owner (which the image trusts there, so
# it repairs a role whose password nobody has any more), then proves both over
# the network and through the pooler. It is idempotent. The bring-up's data
# phase does the same on every run, with the same functions (db-roles.sh).
# When the
# jobs role is a login role here, --sync asks the catalog whether it is fit
# (db_roles_jobs_fit) before it changes anything. When it is, once the two
# roles are proven, it sets the jobs role to .env's value, every setting on it
# cleared, and proves it over the network and through the pooler: what the
# data phase does on every run. When it is not, or JOBS_DB_PASSWORD is empty,
# the jobs role is named and left as it is, the two are still set, and --sync
# exits 1 (require_jobs says why it does not refuse the whole run).
# --rotate does not change it: a new value in .env, then --sync or the
# bring-up, is all a change of it takes.
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
#   anything but the project name typed back;
#   and, once the name is typed, a CI job on this machine or an E2E (managed)
#       run that started while the prompt waited: the two questions above are
#       asked again before anything is written, because the prompt waits for
#       as long as nobody types.
# Then it keeps a copy of .env (<persisted dir>/.env.before-rotation-<UTC>,
# mode 0600), generates `openssl rand -hex 24` for APP_DB_PASSWORD and
# POSTGRES_PASSWORD, writes them with env-upsert.sh --from-env, sets the
# roles (--sync), proves them, and checks that no shipped value opens either.
# On any failure after the write, and on an interrupt, it copies the kept
# .env's content back into the file (so a link stays a link), sets the roles
# back to it, proves that,
# and exits 1 naming the step. While it puts things back it ignores INT, TERM
# and HUP: a second Ctrl-C there would leave the roles on values stored
# nowhere. If the putting back does not complete, it keeps the copy and says
# what to run. On success it deletes the copy, and says what changed, that
# this stack's app cannot open new database
# connections until its containers are recreated, the one next step
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
#   --check   0 every control opens and no shipped value opens anything asked;
#             1 a shipped value opens (the lines above say which);
#             2 nothing established: a control did not open, or a question
#               could not be asked (zitadel-db-password.sh's convention). A
#               jobs role the bring-up's question refuses (NOLOGIN among
#               them) is a control that cannot open.
#   --sync    0 set and proven; 1 refused, the set failed, or a role refuses
#             the value it was just given; 2 set, or not, and not proven.
#             A jobs role left as it is (unfit, NOLOGIN, or no usable value
#             in .env) is 1, and 2 when its question could not be asked, by
#             the same rule: a refusal anywhere is 1, otherwise a question
#             not asked anywhere is 2. The two are set either way.
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
  echo "usage: ./deploy/compose/rotate-db-passwords.sh [--check | --sync | --rotate]   (--help for more)" >&2
  exit 2
}

if [ -n "$ROTATE_TRACED" ] || [ -n "${BASH_XTRACEFD+set}" ]; then
  refuse "this was started with xtrace (set -x, bash -x, SHELLOPTS or BASH_XTRACEFD). Tracing prints every value a command is given, and this handles passwords." \
    "Run it again without tracing."
fi

MODE=''
for arg in "$@"; do
  case "$arg" in
    --check | --sync | --rotate)
      [ -z "$MODE" ] || usage
      MODE="${arg#--}"
      ;;
    --with-trigger-stores)
      # Trigger.dev's stores went with it (workplan 0167 T9).
      refuse "--with-trigger-stores, and Trigger.dev's three stores (trigger-db, ClickHouse, MinIO) were removed with it in alpha.18 (workplan 0167 T9): there is nothing of theirs to set or rotate." \
        "Run it without --with-trigger-stores."
      ;;
    -h | --help)
      sed -n '2,/^case "\$-"/p' "${BASH_SOURCE[0]}" | sed '$d'
      exit 0
      ;;
    *) usage ;;
  esac
done
MODE="${MODE:-check}"
[ "$MODE" != check ] || REFUSE_EXIT=2

# env_value and compose_project, the one reader of a compose .env.
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# Live's marker, named once.
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"
# Which runner the jobs run on (workplan 0167 T7), for the containers that
# still present the old values after a rotation: the one reader.
# shellcheck source=deploy/compose/job-runner.sh
. "${SCRIPT_DIR}/job-runner.sh"

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
# The two roles' functions, shared with the bring-up's data phase.
# shellcheck source=deploy/compose/db-roles.sh
. "${SCRIPT_DIR}/db-roles.sh"
db_roles_init "$ENV_FILE" || refuse "the checkout's project could not be read (above)."

# ---------------------------------------------------------------------------
# What was shipped, and what the output calls it
# ---------------------------------------------------------------------------

# Named once, in shipped-passwords.sh, beside the bring-up's refusal and
# ensure-env-secrets.sh, so the three cannot disagree about what was shipped:
# SHIPPED_PG (app_password, the first migration's for app_user and
# APP_DB_PASSWORD's default; openmigrate_password, POSTGRES_PASSWORD's default;
# change-me-openmigrate, the example's), with its _FROM labels.
# shellcheck source=deploy/compose/shipped-passwords.sh
. "${SCRIPT_DIR}/shipped-passwords.sh"

# A shipped value is public, so it may be an argument; the values in .env and
# the generated ones never are.

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
# The jobs role's control refused: --sync sets it to .env's value.
JOBS_DISAGREES=''
# The jobs role is there and the bring-up's question refuses it.
JOBS_UNFIT=''
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

# The jobs role's control: .env's JOBS_DB_PASSWORD, asked the way the worker
# will connect. Nothing when the role is not a login role here yet.
check_jobs() {
  local rc=0 channel where
  # Not a login role: asked of the catalog, not taken for "not made yet". The
  # list holds login roles only, and a NOLOGIN ownpace_jobs is one the
  # bring-up refuses ("it cannot log in"), so it is no RESULT of 0.
  if ! db_roles_has "$DB_ROLES_JOBS"; then
    db_roles_jobs_fit || rc=$?
    if [ "$rc" -eq 1 ] && [ -n "$DB_ROLES_JOBS_MISSING" ]; then
      say "jobs role ${DB_ROLES_JOBS}: not a role in this database yet, so there is nothing to ask; the bring-up's data phase makes it (jobs-role.sql)"
    elif [ "$rc" -eq 2 ]; then
      say "jobs role ${DB_ROLES_JOBS}: what it may do could not be asked (${DB_ROLES_WHY})"
      UNASKED=1
    else
      say "jobs role: REFUSED by the bring-up's question, so its control cannot open: ${DB_ROLES_WHY}"
      CONTROLS_OPEN=''
      JOBS_UNFIT=1
    fi
    return 0
  fi
  if [ -z "$DB_ROLES_JOBS_PASSWORD" ]; then
    say "jobs role ${DB_ROLES_JOBS}: JOBS_DB_PASSWORD is empty in .env, so its control could not be asked; ensure-env-secrets.sh fills it in, and the bring-up then sets it"
    UNASKED=1
    return 0
  fi
  say "jobs role: .env's own value, asked the way the worker will connect:"
  for channel in network pooler; do
    rc=0
    db_roles_ask "$channel" "$DB_ROLES_JOBS" "$DB_ROLES_JOBS_PASSWORD" || rc=$?
    where='over the network'
    [ "$channel" = network ] || where='through the pooler'
    case "$rc" in
      0) item "${DB_ROLES_JOBS}, JOBS_DB_PASSWORD from .env, ${where}: opens" ;;
      1)
        item "${DB_ROLES_JOBS}, JOBS_DB_PASSWORD from .env, ${where}: REFUSED"
        CONTROLS_OPEN=''
        JOBS_DISAGREES=1
        ;;
      *)
        item "${DB_ROLES_JOBS}, JOBS_DB_PASSWORD from .env, ${where}: could not be asked (${DB_ROLES_WHY})"
        CONTROLS_OPEN=''
        UNASKED=1
        ;;
    esac
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
    for k in "${!SHIPPED_PG[@]}"; do
      rc=0
      db_roles_ask network "$role" "${SHIPPED_PG[$k]}" || rc=$?
      case "$rc" in
        0)
          item "${role}, ${SHIPPED_PG_FROM[$k]}: OPENS"
          OPENED=$((OPENED + 1))
          if [ "$role" != "$DB_ROLES_OWNER" ] && [ "$role" != "$DB_ROLES_APP" ]; then
            OPENED_OTHER=$((OPENED_OTHER + 1))
            [[ " ${OTHER_ROLES} " == *" ${role} "* ]] || OTHER_ROLES="${OTHER_ROLES:+${OTHER_ROLES} }${role}"
          fi
          ;;
        1) item "${role}, ${SHIPPED_PG_FROM[$k]}: refused" ;;
        *)
          item "${role}, ${SHIPPED_PG_FROM[$k]}: could not be asked (${DB_ROLES_WHY})"
          UNASKED=1
          ;;
      esac
    done
  done
}


do_check() {
  local role
  check_controls
  if [ -n "$DB_ROLES_LIST" ]; then
    check_jobs
    pg_roles_to_try
    check_pg_shipped "${PG_TRY[@]}"
  fi
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
        say "  Then, on the OTA stack, change the rest with --rotate at a quiet time: docs/managed-bring-up.md, \"Changing the database passwords\"."
      else
        say "  On the OTA stack, change them with --rotate at a quiet time: docs/managed-bring-up.md, \"Changing the database passwords\"."
      fi
      say "  On live, they are its own .env's, set before its first bring-up (workplan 0132 D8)."
    fi
    exit 1
  fi
  if [ -z "$CONTROLS_OPEN" ]; then
    say "RESULT: NOT ESTABLISHED. A control did not open, so a refused shipped value proves nothing."
    say "  If .env and the database disagree, set the roles to .env's values: ./deploy/compose/rotate-db-passwords.sh --sync"
    [ -z "$JOBS_DISAGREES" ] ||
      say "  It is the jobs role's control that is refused: ./deploy/compose/rotate-db-passwords.sh --sync sets ${DB_ROLES_JOBS} too."
    [ -z "$JOBS_UNFIT" ] ||
      say "  The jobs role is not as jobs-role.sql makes it, which --sync does not repair: docs/managed-bring-up.md, \"The jobs role\"."
    say "  (read zitadel-db-password.sh's header first if a second .env exists on this machine)."
    exit 2
  fi
  if [ "$UNASKED" -ne 0 ]; then
    say "RESULT: NOT ESTABLISHED. A question above could not be asked; nothing opened among those that were."
    exit 2
  fi
  say "RESULT: every control opens, and no shipped value opens anything asked."
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


# The jobs role, judged before --sync changes anything: JOBS_SYNC says
# whether it is to be set, and JOBS_SKIP why it is not when it is there and
# cannot be (JOBS_SKIP_RC: 1 unfit or no usable value, 2 could not ask). Not a
# login role yet: nothing to set, and nothing wrong.
#
# AN UNFIT JOBS ROLE DOES NOT BLOCK THE OTHER TWO. --sync is how the operator
# puts the owner and app_user back when .env and the database disagree, which
# is the moment the stack may be down; a jobs role somebody changed is a
# separate fault with a separate remedy. So it is named, left exactly as it
# is, and --sync goes on with the two (and trigger-db's with the flag), then
# exits 1 (2 when the question could not be asked): the two were set, and the
# run is still not a success while the jobs role is unfit.
JOBS_SYNC=''
JOBS_SKIP=''
JOBS_SKIP_RC=0
require_jobs() {
  local rc=0
  # Not a login role: asked, not taken for "not made yet" (check_jobs says why).
  if ! db_roles_has "$DB_ROLES_JOBS"; then
    db_roles_jobs_fit || rc=$?
    if [ "$rc" -eq 1 ] && [ -n "$DB_ROLES_JOBS_MISSING" ]; then return 0; fi
    if [ "$rc" -eq 2 ]; then
      JOBS_SKIP="could not ask Postgres what ${DB_ROLES_JOBS} may do: ${DB_ROLES_WHY}"
      JOBS_SKIP_RC=2
    else
      JOBS_SKIP="REFUSED: ${DB_ROLES_WHY}. Nothing here repairs the role: docs/managed-bring-up.md, 'The jobs role', says how to put it back as jobs-role.sql makes it."
      JOBS_SKIP_RC=1
    fi
    return 0
  fi
  if [ -z "$DB_ROLES_JOBS_PASSWORD" ]; then
    JOBS_SKIP="${DB_ROLES_JOBS} is a login role here, and JOBS_DB_PASSWORD is empty in .env, so it cannot be set to it. ./deploy/compose/ensure-env-secrets.sh --only JOBS_DB_PASSWORD fills it in; then run this again."
    JOBS_SKIP_RC=1
    return 0
  fi
  if ! [[ "$DB_ROLES_JOBS_PASSWORD" =~ ^[A-Za-z0-9._~-]+$ ]]; then
    JOBS_SKIP="JOBS_DB_PASSWORD holds a character a URL does not carry as it is, and the worker puts it in JOBS_DATABASE_URL. Use hex (openssl rand -hex 24), as ensure-env-secrets.sh makes. Its value is not printed."
    JOBS_SKIP_RC=1
    return 0
  fi
  db_roles_jobs_fit || rc=$?
  case "$rc" in
    0) JOBS_SYNC=1 ;;
    1)
      JOBS_SKIP="REFUSED: ${DB_ROLES_WHY}. Nothing here repairs the role: docs/managed-bring-up.md, 'The jobs role', says how to put it back as jobs-role.sql makes it."
      JOBS_SKIP_RC=1
      ;;
    *)
      JOBS_SKIP="could not ask Postgres what ${DB_ROLES_JOBS} may do: ${DB_ROLES_WHY}"
      JOBS_SKIP_RC=2
      ;;
  esac
}

do_sync() {
  local rc=0 jobs_rc=0
  require_roles
  require_jobs
  [ -z "$JOBS_SKIP" ] || say "${DB_ROLES_JOBS} is left as it is, and the rest goes on: ${JOBS_SKIP}" >&2
  say "setting ${DB_ROLES_APP} and ${DB_ROLES_OWNER} to the values in .env: one transaction, over the socket as ${DB_ROLES_OWNER}"
  if ! db_roles_set "$DB_ROLES_OWNER_PASSWORD" "$DB_ROLES_APP_PASSWORD"; then
    say "FAILED: the roles were not changed: ${DB_ROLES_WHY}" >&2
    exit 1
  fi
  db_roles_prove "$DB_ROLES_OWNER_PASSWORD" "$DB_ROLES_APP_PASSWORD" || rc=$?
  say "asked the way the stack's containers ask:"
  show_proof
  if [ -n "$JOBS_SYNC" ]; then
    say "setting ${DB_ROLES_JOBS} to JOBS_DB_PASSWORD from .env, every setting on it cleared, over the socket as ${DB_ROLES_OWNER}"
    if ! db_roles_jobs_set "$DB_ROLES_JOBS_PASSWORD"; then
      say "FAILED: ${DB_ROLES_JOBS} was not changed: ${DB_ROLES_WHY}" >&2
      exit 1
    fi
    db_roles_jobs_prove "$DB_ROLES_JOBS_PASSWORD" || jobs_rc=$?
    show_proof
    # A refusal anywhere is 1; otherwise a question not asked anywhere is 2.
    if [ "$jobs_rc" -eq 1 ] || { [ "$jobs_rc" -ne 0 ] && [ "$rc" -eq 0 ]; }; then rc="$jobs_rc"; fi
  elif [ -z "$JOBS_SKIP" ]; then
    say "${DB_ROLES_JOBS} is not a login role in this database yet: the bring-up's data phase makes it, so there is nothing of it to set"
  fi
  # A jobs role left as it is: said whatever the two's proof found, and merged
  # into the exit by the rule above: a refusal anywhere is 1, otherwise a
  # question not asked anywhere is 2.
  if [ -n "$JOBS_SKIP" ]; then
    local stores='' proven='accept'
    [ "$rc" -eq 0 ] || proven='were set; their proof is above, and'
    if [ "$JOBS_SKIP_RC" -eq 1 ] || { [ "$JOBS_SKIP_RC" -ne 0 ] && [ "$rc" -eq 0 ]; }; then rc="$JOBS_SKIP_RC"; fi
    if [ "$proven" = accept ]; then
      say "NOT DONE: ${DB_ROLES_APP} and ${DB_ROLES_OWNER}${stores} accept .env's values, and ${DB_ROLES_JOBS} was left as it is: ${JOBS_SKIP}" >&2
    else
      say "NOT DONE: ${DB_ROLES_APP} and ${DB_ROLES_OWNER}${stores} ${proven} ${DB_ROLES_JOBS} was left as it is: ${JOBS_SKIP}" >&2
    fi
    exit "$rc"
  fi
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
# Set once trigger-db's ALTER is on its way: from then on it may have taken,
# so putting things back sets trigger-db's role back too.

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

# A run of the gate on this machine: it restores the persisted .env when it
# starts and copies its own back when it ends, so one that overlaps the
# rotation undoes it. Asked before the prompt, and asked again once the project
# name is typed, before anything is written: the prompt waits for as long as
# nobody types, and a run can start meanwhile (the schedule, or a dispatch).
# GitHub is asked the second time only when it was asked the first, and
# GATE_ASKS_GH says so (the dispatch at the end uses it too).
GATE_ASKS_GH=''
refuse_a_busy_gate() { # refuse_a_busy_gate [again]
  local rc active now=''
  local -a meanwhile=()
  if [ -n "${1:-}" ]; then
    now=', after the project name was typed'
    meanwhile=("Before the prompt the answer was none: it started while this waited for the name.")
  fi
  command -v pgrep >/dev/null 2>&1 || refuse "pgrep is not installed, so a CI job running on this machine cannot be ruled out."
  rc=0
  pgrep -f Runner.Worker >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) refuse "a GitHub Actions job is running on this machine${now} (a Runner.Worker process). A gate run that overlaps copies its old .env back over the persisted one." \
      ${meanwhile[@]+"${meanwhile[@]}"} \
      "Wait until it has finished (pgrep -c -f Runner.Worker prints 0), and run this again." ;;
    1) ;;
    *) refuse "pgrep could not be asked whether a CI job is running here (exit ${rc})." ;;
  esac
  if [ -z "${1:-}" ]; then
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
      GATE_ASKS_GH=1
    else
      say "gh is not signed in here, so GitHub was not asked whether E2E (managed) is queued."
      say "  Look at Actions, E2E (managed), before you type the name below: nothing may be queued or in progress."
    fi
  fi
  [ -n "$GATE_ASKS_GH" ] || return 0
  active="$(cd "$REPO_ROOT" && gh run list --workflow e2e-managed.yml --limit 20 --json status \
    --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null)" ||
    refuse "gh is signed in, and could not list E2E (managed)'s runs${now}, so a queued run cannot be ruled out." \
      "Look at Actions, E2E (managed) on GitHub, and run this again when nothing is queued or in progress."
  [[ "$active" =~ ^[0-9]+$ ]] || refuse "gh answered something that is not a count when asked for E2E (managed)'s runs${now}."
  [ "$active" -eq 0 ] ||
    refuse "E2E (managed) has ${active} run(s) queued or in progress${now}. A run that overlaps copies its old .env back over the persisted one." \
      ${meanwhile[@]+"${meanwhile[@]}"} \
      "Run this again after it has finished."
}

fail() { # fail <why> — the EXIT trap puts things back
  ROTATE_WHY="${1:-}"
  exit 1
}

# The kept .env's content back into the file (a link stays a link), the roles
# set back to it, and that proven; trigger-db's role too once its ALTER was
# sent, to the old .env's value as Compose reads it (managed.yml's fallback
# when that key was empty). 0 when every role accepts its old value.
rotate_restore() {
  local rc=0 reason
  local -a why=()
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
    why+=("a role does not accept its old value again: $(printf '%s' "$DB_ROLES_PROOF" | awk -F'|' '$3 != 0 { printf "%s %s (%s) ", $1, $2, ($3 == 1 ? "refused" : $4) }')")
  fi
  [ "${#why[@]}" -eq 0 ] && return 0
  for reason in "${why[@]}"; do ROTATE_RESTORE_WHY+="${ROTATE_RESTORE_WHY:+; }${reason% }"; done
  return 1
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
  local v key rc typed

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

  # A CI job on this machine, or an E2E (managed) run queued: asked again
  # after the prompt, below.
  refuse_a_busy_gate

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
  # trigger-db's role is set the same way, so its control has to open too: a
  # new value set over one nobody knows could not be put back.

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
  local roles="${DB_ROLES_APP} and ${DB_ROLES_OWNER}"
  say "This makes new values for ${keys[*]}, writes them to ${ENV_RESOLVED},"
  say "and sets the roles ${roles} to them. No value is printed."
  say "From then until the containers are recreated, this stack's app cannot open new database connections."
  printf '[rotate-db-passwords] Type the project name (%s) to go on: ' "$COMPOSE_PROJECT"
  typed=''
  IFS= read -r typed || true
  printf '\n'
  [ "$typed" = "$COMPOSE_PROJECT" ] || refuse "what was typed is not the project name."

  # ---- Still no gate run, now that the name is typed ------------------------------
  # The prompt waited for as long as nobody typed; a run that started meanwhile
  # would copy its old .env back over the one written below.
  refuse_a_busy_gate again

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
    TRIGGER_DB_PASSWORD="${new[TRIGGER_DB_PASSWORD]:-}" \
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

  # trigger-db after the two: a failure before this leaves it untouched.

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
  # The jobs present app_user's value too, in the worker (pg-boss; Trigger.dev
  # was removed in alpha.18, workplan 0167 T9). A switch this checkout refuses
  # is said, rather than stopping after the change.
  local jobs_hold='the worker'
  job_runner_mode "$SCRIPT_DIR" "$ENV_FILE" || say "  (${JOB_RUNNER_WHY})"
  say "  the API, the identity provider's admin connection and ${jobs_hold} still present the old values."
  say "NEXT, the one step: E2E (managed) on main. It restores this .env, recreates every container whose settings changed,"
  say "  the worker among them (it reads APP_DATABASE_URL when it is created, and nothing is uploaded),"
  say "  and this script does not rotate the system role's or the jobs role's password: the bring-up sets .env's SYSTEM_DB_PASSWORD"
  say "  and JOBS_DB_PASSWORD on every run),"
  say "  and its smoke proves the worker still connects."
  if [ -n "$GATE_ASKS_GH" ] && (cd "$REPO_ROOT" && gh workflow run e2e-managed.yml --ref main) >/dev/null 2>&1; then
    say "  Dispatched it (gh workflow run e2e-managed.yml --ref main)."
  else
    say "  Dispatch it: on GitHub, Actions, E2E (managed), Run workflow, on main."
  fi
  say "Once that run is green: ./deploy/compose/rotate-db-passwords.sh --check. It exits 0 when every control opens and nothing shipped does."
  local record="the OTA stack's database passwords changed; the shipped values refused."
  say "For workplan 0132 T0's record (step 2), after that check: \"$(date -u +%Y-%m-%d): ${record}\" Never a value."
  exit 0
}

case "$MODE" in
  check) do_check ;;
  sync) do_sync ;;
  rotate) do_rotate ;;
esac
