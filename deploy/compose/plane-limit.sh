#!/usr/bin/env bash
# plane-limit.sh — how many runs this stack's Trigger.dev plane runs at once
# (workplan 0143 T1 step 3's plane half; open question 9, answered 2026-09-29).
#
# WHAT IT SETS. The environment the tasks deploy to (`prod` unless TRIGGER_ENV
# says otherwise) gets `"RuntimeEnvironment"."maximumConcurrencyLimit"` = the
# tick's cap plus two: MAX_PASSES_IN_FLIGHT from .env (blank is 3, the tick's
# own default) + 2, so 5 on the OTA stack and 8 on live. The plane counts every
# run, and the docker supervisor keeps a waiting run's slot. At exactly the
# cap, a stack full of passes would hold back the tick itself, and a cutover
# waiting on its final sync. So one slot above the cap is the tick's, and one
# is that cutover's. Without this, a self-hosted plane runs up to its default
# of 300 at once, and only the tick's own count stands between the machine and
# a crowd it cannot hold.
#
# WHY BEFORE THE DEPLOY. The run queue does not read this column. It reads a
# Redis key that the webapp writes from the column when a deploy registers its
# worker (`updateEnvConcurrencyLimits`, called from `createBackgroundWorker`
# and `finalizeDeployment` in Trigger.dev v4.5.16). So bootstrap-managed.sh
# runs this between set-task-env.sh and deploy-tasks.sh, and the deploy
# carries the number into the queue. A number set after a deploy waits for the
# next one.
#
# Read back every time, and said. `--check` only reads it, and fails when it
# is not the number above.
#
# Usage:
#   ./plane-limit.sh           # set it, then read it back
#   ./plane-limit.sh --check   # read it back only
#
# Overrides, as in trigger-credentials.sh:
#   TRIGGER_DB_PSQL        the command SQL is piped into. Default runs psql
#                          inside the trigger-db container; the unit tests set
#                          a stub.
#   TRIGGER_ENV            which runtime environment (default `prod`), read
#                          from .env as well, by the helper deploy-tasks.sh
#                          uses, so this sets the environment that deploys.
#   PLANE_LIMIT_ENV_FILE   the .env to read (default: the one beside this
#                          script), for the unit tests.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${PLANE_LIMIT_ENV_FILE:-${SCRIPT_DIR}/.env}"
# shellcheck source=trigger-cli-lib.sh
. "${SCRIPT_DIR}/trigger-cli-lib.sh"

CHECK_ONLY=0
case "${1:-}" in
  "") ;;
  --check) CHECK_ONLY=1 ;;
  -h | --help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
  *) echo "plane-limit.sh: unknown argument '$1'" >&2; exit 1 ;;
esac

say() { echo "[plane-limit] $*"; }
fail() { echo "[plane-limit] $*" >&2; exit 1; }

# This checkout's own stack, asked before anything is read or written: the
# query runs through Compose, which follows a COMPOSE_PROJECT_NAME exported in
# the shell. The reader refuses a shell that names the other stack.
compose_project "${SCRIPT_DIR}" >/dev/null || exit 1

ENV_SLUG="$(trigger_env "${ENV_FILE}")" || exit 1

# The project whose environment this is. A ref is letters, digits and `_`
# (`proj_…`), and it goes into SQL, so anything else is refused, not quoted.
REF="$(env_value "$ENV_FILE" TRIGGER_PROJECT_REF)"
[ -n "$REF" ] || fail "TRIGGER_PROJECT_REF is not set in ${ENV_FILE}: the 'account' phase has not been completed."
[[ "$REF" =~ ^[A-Za-z0-9_]+$ ]] || fail "TRIGGER_PROJECT_REF '${REF}' is not a project ref (letters, digits and _)."
[[ "$ENV_SLUG" =~ ^[A-Za-z0-9_-]+$ ]] || fail "the environment '${ENV_SLUG}' is not a slug."

# The tick's cap, read by the same rule the tick reads it: blank is 3, and
# anything but a whole number of at least 1 stops, naming it.
CAP="$(env_value "$ENV_FILE" MAX_PASSES_IN_FLIGHT)"
CAP="${CAP:-3}"
[[ "$CAP" =~ ^[1-9][0-9]*$ ]] ||
  fail "MAX_PASSES_IN_FLIGHT is '${CAP}', not a whole number of at least 1. The tick refuses it too."
LIMIT=$((CAP + 2))

DEFAULT_PSQL="docker compose -f ${SCRIPT_DIR}/managed.yml exec -T trigger-db psql -U trigger -d triggerdb -tA -v ON_ERROR_STOP=1"
PSQL="${TRIGGER_DB_PSQL:-$DEFAULT_PSQL}"
run_sql() { printf '%s\n' "$1" | eval "$PSQL" 2>&1; }

# Introspection first, as trigger-credentials.sh does: every column the two
# statements below name is named here, so a Trigger.dev version that renamed
# one is said as that, before anything is written.
NEEDED='Project.externalRef Project.id RuntimeEnvironment.maximumConcurrencyLimit RuntimeEnvironment.projectId RuntimeEnvironment.slug'
probe_sql="SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('Project','RuntimeEnvironment');"
if ! present="$(run_sql "$probe_sql")"; then
  echo "[plane-limit] could not query the Trigger.dev database:" >&2
  printf '%s\n' "$present" | sed 's/^/    /' >&2
  fail "Is the stack up?  docker compose -f deploy/compose/managed.yml up -d trigger-db"
fi
missing=""
for col in $NEEDED; do
  # A here-string, not a pipe: `grep -q` leaves a pipe early, and under
  # pipefail its producer's SIGPIPE would report a column as missing.
  grep -qxF "$col" <<<"$present" || missing="${missing} ${col}"
done
[ -z "$missing" ] ||
  fail "this Trigger.dev instance's schema is not the one this script knows. Missing:${missing}. Nothing was written."

WHERE="e.\"projectId\" = p.id AND p.\"externalRef\" = '${REF}' AND e.slug = '${ENV_SLUG}'"

if [ "$CHECK_ONLY" -eq 0 ]; then
  if ! written="$(run_sql "UPDATE \"RuntimeEnvironment\" e SET \"maximumConcurrencyLimit\" = ${LIMIT} FROM \"Project\" p WHERE ${WHERE} RETURNING e.\"maximumConcurrencyLimit\";")"; then
    printf '%s\n' "$written" | sed 's/^/    /' >&2
    fail "the limit could not be written."
  fi
  rows="$(printf '%s\n' "$written" | grep -cE '^[0-9]+$' || true)"
  [ "$rows" = "1" ] ||
    fail "expected one '${ENV_SLUG}' environment of project ${REF}, and the update changed ${rows}. Is TRIGGER_PROJECT_REF this stack's?"
fi

if ! read_back="$(run_sql "SELECT e.\"maximumConcurrencyLimit\" FROM \"RuntimeEnvironment\" e JOIN \"Project\" p ON ${WHERE};")"; then
  printf '%s\n' "$read_back" | sed 's/^/    /' >&2
  fail "the limit could not be read back."
fi
read_back="$(printf '%s\n' "$read_back" | grep -E '^[0-9]+$' || true)"
[ -n "$read_back" ] || fail "no '${ENV_SLUG}' environment of project ${REF} was found to read back."
[ "$read_back" = "$LIMIT" ] ||
  fail "the '${ENV_SLUG}' environment runs at most ${read_back} at once, where the tick's cap of ${CAP} asks for ${LIMIT}. Run ./deploy/compose/plane-limit.sh, then deploy the tasks."

say "the '${ENV_SLUG}' environment runs at most ${LIMIT} at once: the tick's cap of ${CAP}, one for the tick, and one for a cutover waiting on its pass (read back)"
if [ "$CHECK_ONLY" -eq 0 ]; then
  say "the next task deploy carries it into the run queue"
fi
