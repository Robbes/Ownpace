#!/usr/bin/env bash
# plane-tokens.sh — release the concurrency tokens a dead worker left behind
# (workplan 0143 T1 step 3's plane half, the half plane-limit.sh cannot fix).
#
# WHAT THIS FIXES. The run queue counts a run against the environment's
# `maximumConcurrencyLimit` by keeping its id in a Redis set, and the id leaves
# the set only when the run reaches a terminal status through the engine. A
# worker that dies mid-run — a container killed by an update, a host reboot, an
# OOM — never runs that code, so its id stays in the set forever. The run row
# stays `PENDING`/`DEQUEUED`, locked to a worker that no longer exists.
#
# A leaked token is invisible everywhere except in the one number that matters:
# the queue. `plane-limit.sh` sets the limit, and the queue obeys it, so when
# the leaks equal the limit NOTHING dequeues, on any queue in that environment,
# forever. E2E (managed) #247 and #248 are what that reads like: the tick's
# beat froze at the exact second the deploy that lowered the plane from 300 to
# 5 registered its worker, because five runs from September 17 were still
# holding slots. 2,366 ticks queued behind them and none of them ran.
#
# WHY NOT JUST RAISE THE LIMIT. The leak is not the limit's fault, and a
# higher limit only postpones the freeze by the number of extra slots. The
# tokens have to be released, and released by something that runs on a
# schedule, because a stack that is updated often leaks often.
#
# WHAT COUNTS AS LEAKED. A token is released when its run is
#   1. in a terminal status (`COMPLETED_*`, `CANCELED`, `CRASHED`, `TIMED_OUT`,
#      `EXPIRED`, `SYSTEM_FAILURE`, `INTERRUPTED`) — the engine forgot to drop
#      it, which is the common case after a crash;
#   2. gone from the database entirely;
#   3. `PENDING` or `DEQUEUED` with a lock older than the run's own
#      `maxDurationInSeconds` (floor: 1 hour). A lock that old is a worker that
#      died, not a run that is slow: the run's own ceiling has passed.
# A run in a live status with a fresh lock is a run that is genuinely taking
# its slot, and is left alone.
#
# WHAT THIS DOES NOT DO. It touches no run row. It releases the Redis token
# only, and the queue then dequeues the run normally — the engine re-checks the
# row before it runs, so releasing a token for a finished run is a no-op, and
# releasing one for a queued run is exactly the repair. Cancelling rows is a
# human decision about history; this is a repair of a counter.
#
# Usage:
#   ./plane-tokens.sh           # release the leaks, say what was released
#   ./plane-tokens.sh --check   # report only, and exit non-zero if any leak
#
# Overrides, as in plane-limit.sh:
#   TRIGGER_DB_PSQL        the command SQL is piped into (default: psql inside
#                          the trigger-db container).
#   TRIGGER_REDIS_CLI      the command Redis is spoken to (default: redis-cli
#                          inside the trigger-redis container).
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
  -h | --help) sed -n '2,44p' "${BASH_SOURCE[0]}"; exit 0 ;;
  *) echo "plane-tokens.sh: unknown argument '$1'" >&2; exit 1 ;;
esac

say() { echo "[plane-tokens] $*"; }
fail() { echo "[plane-tokens] $*" >&2; exit 1; }

# This checkout's own stack, asked before anything is read or written, exactly
# as plane-limit.sh does: the queries run through Compose, which follows a
# COMPOSE_PROJECT_NAME exported in the shell.
compose_project "${SCRIPT_DIR}" >/dev/null || exit 1

ENV_SLUG="$(trigger_env "${ENV_FILE}")" || exit 1
REF="$(env_value "$ENV_FILE" TRIGGER_PROJECT_REF)"
[ -n "$REF" ] || fail "TRIGGER_PROJECT_REF is not set in ${ENV_FILE}: the 'account' phase has not been completed."
[[ "$REF" =~ ^[A-Za-z0-9_]+$ ]] || fail "TRIGGER_PROJECT_REF '${REF}' is not a project ref (letters, digits and _)."
[[ "$ENV_SLUG" =~ ^[A-Za-z0-9_-]+$ ]] || fail "the environment '${ENV_SLUG}' is not a slug."

DEFAULT_PSQL="docker compose -f ${SCRIPT_DIR}/managed.yml exec -T trigger-db psql -U trigger -d triggerdb -tA -v ON_ERROR_STOP=1"
PSQL="${TRIGGER_DB_PSQL:-$DEFAULT_PSQL}"
run_sql() { printf '%s\n' "$1" | eval "$PSQL" 2>&1; }

DEFAULT_REDIS="docker compose -f ${SCRIPT_DIR}/managed.yml exec -T trigger-redis redis-cli"
REDIS="${TRIGGER_REDIS_CLI:-$DEFAULT_REDIS}"
run_redis() { eval "$REDIS $1" 2>&1; }

# Introspection first, as plane-limit.sh does: every column named below is
# named here, so a Trigger.dev version that renamed one is said as that,
# before anything is read.
NEEDED='Project.externalRef Project.id RuntimeEnvironment.slug TaskRun.id TaskRun.status TaskRun.lockedAt TaskRun.maxDurationInSeconds'
probe_sql="SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('Project','RuntimeEnvironment','TaskRun');"
if ! present="$(run_sql "$probe_sql")"; then
  echo "[plane-tokens] could not query the Trigger.dev database:" >&2
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
  fail "this Trigger.dev instance's schema is not the one this script knows. Missing:${missing}. Nothing was touched."

# The environment's own id, so the Redis keys are named and not guessed. The
# queue keys are `engine:runqueue:{org:…}:proj:…:env:<id>:…`; the id is the
# RuntimeEnvironment row of this project's ref and slug.
WHERE="e.\"projectId\" = p.id AND p.\"externalRef\" = '${REF}' AND e.slug = '${ENV_SLUG}'"
if ! env_rows="$(run_sql "SELECT e.id FROM \"RuntimeEnvironment\" e JOIN \"Project\" p ON ${WHERE};")"; then
  printf '%s\n' "$env_rows" | sed 's/^/    /' >&2
  fail "the environment could not be found."
fi
env_rows="$(printf '%s\n' "$env_rows" | grep -E '^[a-z0-9]+$' || true)"
[ -n "$env_rows" ] || fail "no '${ENV_SLUG}' environment of project ${REF} was found. Is TRIGGER_PROJECT_REF this stack's?"

# Every concurrency set belonging to this stack's environments. Scanned, not
# built: the queue names are the tasks', and a queue added tomorrow is a queue
# that can leak today.
TOKEN_SETS=""
for env_id in $env_rows; do
  for pattern in '*currentConcurrency' '*currentDequeued'; do
    found="$(run_redis "--scan --pattern 'engine:runqueue:*:env:${env_id}:${pattern}'" | tr -d '\r')"
    [ -n "$found" ] && TOKEN_SETS="${TOKEN_SETS}${found}
"
  done
done
TOKEN_SETS="$(printf '%s\n' "$TOKEN_SETS" | grep -E '^engine:runqueue:' | sort -u || true)"
if [ -z "$TOKEN_SETS" ]; then
  say "the plane holds no concurrency sets for ${ENV_SLUG} — nothing is counted, nothing can be stuck"
  exit 0
fi

# The ids in those sets, as one list.
IDS=""
while IFS= read -r set_key; do
  [ -n "$set_key" ] || continue
  members="$(run_redis "SMEMBERS '${set_key}'" | tr -d '\r')"
  [ -n "$members" ] && IDS="${IDS}${members}
"
done <<<"$TOKEN_SETS"
IDS="$(printf '%s\n' "$IDS" | grep -E '^[a-z0-9_]+$' | sort -u || true)"
if [ -z "$IDS" ]; then
  say "the plane's concurrency sets are empty — nothing is counted, nothing can be stuck"
  exit 0
fi

HELD_COUNT="$(printf '%s\n' "$IDS" | wc -l | tr -d ' ')"

# One query for all of them. Ids are `[a-z0-9]+` (checked above), so the list
# is safe to interpolate. The row answers with its status, the age of its lock
# in seconds, and its own ceiling in seconds.
IN_LIST="$(printf '%s\n' "$IDS" | sed "s/^/'/; s/$/'/" | paste -sd, -)"
rows="$(run_sql "SELECT id || '|' || status || '|' || coalesce(floor(extract(epoch from now() - \"lockedAt\"))::text,'-') || '|' || coalesce(\"maxDurationInSeconds\"::text,'-') FROM \"TaskRun\" WHERE id IN (${IN_LIST});")"
[ -n "$rows" ] || rows=""

# Decide. A token is released when its run is terminal, missing, or locked
# beyond its own ceiling (floored at 3600s, so a slow-but-live run keeps its
# slot).
RELEASE=""
SEEN_IDS=""
while IFS='|' read -r rid rstatus rage rceiling; do
  [ -n "$rid" ] || continue
  SEEN_IDS="${SEEN_IDS}${rid}
"
  case " ${rstatus} " in
    " PENDING " | " DEQUEUED ")
      if [ "$rage" != "-" ] && [ "$rceiling" != "-" ]; then
        floor_ceiling="$rceiling"
        [ "$floor_ceiling" -lt 3600 ] && floor_ceiling=3600
        if [ "$rage" -gt "$floor_ceiling" ]; then
          RELEASE="${RELEASE}${rid}
"
          say "released ${rid}: ${rstatus} with a lock ${rage}s old, past the run's own ceiling of ${floor_ceiling}s — the worker that took it is gone"
        fi
      fi
      ;;
    " EXECUTING " | " WAITING_TO_RESUME " | " RETRYING_AFTER_FAILURE " | " PAUSED " | " WAITING_FOR_DEPLOY " | " DELAYED " | " PENDING_VERSION ")
      ;; # a live status: the run is genuinely taking its slot
    *)
      RELEASE="${RELEASE}${rid}
"
      say "released ${rid}: the run is ${rstatus} and the engine never dropped its token"
      ;;
  esac
done <<<"$rows"

# Rows the database does not have at all.
for id in $IDS; do
  printf '%s\n' "$SEEN_IDS" | grep -qxF "$id" && continue
  RELEASE="${RELEASE}${id}
"
  say "released ${id}: the run row is gone from the database"
done

RELEASE="$(printf '%s\n' "$RELEASE" | grep -E '^[a-z0-9_]+$' | sort -u || true)"
if [ -z "$RELEASE" ]; then
  say "the plane holds ${HELD_COUNT} token(s) and every one of them is a live run — nothing to release"
  exit 0
fi

LEAK_COUNT="$(printf '%s\n' "$RELEASE" | wc -l | tr -d ' ')"
if [ "$CHECK_ONLY" -eq 1 ]; then
  say "${LEAK_COUNT} leaked token(s) of ${HELD_COUNT} held — run ./deploy/compose/plane-tokens.sh to release them"
  exit 1
fi

while IFS= read -r set_key; do
  [ -n "$set_key" ] || continue
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    run_redis "SREM '${set_key}' '${id}'" >/dev/null
  done <<<"$RELEASE"
done <<<"$TOKEN_SETS"
say "released ${LEAK_COUNT} leaked token(s) of ${HELD_COUNT} held; the queue can dequeue again"
