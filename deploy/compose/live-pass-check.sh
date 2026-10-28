#!/usr/bin/env bash
# live-pass-check.sh — one pass on the owner's own migration on live, started
# as Sync now starts it, and how it ended (workplan 0132 T9; the owner,
# 2026-10-28).
#
# WHY. deploy-live.sh skips the smoke on live: the deploy is checked by its
# version and its pages, and an update is proven only once a pass that started
# after it has succeeded (copy-before-update.sh's rule). Passes come hourly at
# best, and a migration that is in step looks every 6 hours or once a day, so
# after a deploy the owner waited for one. This starts one, on a small
# migration of the owner's own, the moment the hold is lifted, and says within
# 15 minutes how it ended.
#
# WHAT IT DOES, from live's checkout, once the hold is lifted after a deploy:
#
#   1. reads, as the owner over the postgres container's own socket (SELECTs
#      only): the open holds; the migration LIVE_PASS_CHECK_MIGRATION names,
#      its organisation, its status, whether a platform operator is an active
#      owner there, and how many data types it selects; and the passes in
#      flight, counted by the tick's own rule (managed-sync-tick.ts): running
#      initial copies and incremental passes younger than its staleness window
#   2. refuses while a hold is on, while the tick's caps are full
#      (MAX_PASSES_IN_FLIGHT, MAX_PASSES_PER_ORGANISATION, read from live's
#      .env as the tick reads them), while that migration has a pass running,
#      and a migration that is not running, selects nothing, or is not in an
#      organisation of a platform operator's. Sync now itself never counts
#      capacity; this is stricter
#   3. presses Sync now inside the api container: apps/api/src/scripts/
#      live-pass.ts, run by Node at its absolute path, as app_user under row
#      security, through the route's own gates and its one enqueue
#      (pressSyncNow): the close, the pause, a withdrawn grant, Free's pace and
#      the hold again, right before the enqueue. It records no visit, so the
#      migration keeps its cadence
#   4. follows the pass it started by its Trigger.dev run id (the run row's
#      orchestrator_ref), never by a time window, every
#      LIVE_PASS_CHECK_INTERVAL seconds for at most LIVE_PASS_CHECK_POLLS reads
#      (15 minutes by default), and says how it ended: its status, and whether
#      every data type it selects completed in it. A `succeeded` here is a pass
#      the box checks count when they prove the update
#      (copy-before-update.sh delete-if-proven)
#
# WHAT IT NEVER DOES. It writes no row, starts no hold and lifts none, and
# cancels no pass. It runs no smoke (smoke-managed.sh ends every open hold),
# triggers no task from this machine, mints no token, and makes no user or
# membership at the identity provider. Ctrl-C stops the watching only: the pass
# goes on, and the box checks count it when it succeeds.
#
# NOTHING SECRET. It prints no value from the .env but the two caps and the
# project's name (COMPOSE_PROJECT_NAME), never the migration's or the
# organisation's id, and never the hold's sentence: times, counts and the
# Trigger.dev run id. A refusal names the key, never its value.
# Nothing that runs it may use `set -x`.
#
# Usage:  ./deploy/compose/live-pass-check.sh      from live's checkout, no arguments
#
# Exit:   0 succeeded; 1 failed (after its retries) or cancelled; 2 refused,
#         nothing started (usage, configuration or the migration, or Sync
#         now's own refusal other than the hold); 3 refused, the hold is on; 4
#         refused, capacity is full; 5 timed out, nothing cancelled; 6 ended
#         unfinished; 7 could not tell. Ctrl-C ends with bash's own 130.
#
# Env overrides, from the process environment (never the .env):
#   LIVE_PASS_CHECK_POLLS      reads of the pass's row (default 90)
#   LIVE_PASS_CHECK_INTERVAL   seconds between them (default 10)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
# env_value, the one reader of a compose .env, and compose_project.
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# Live's marker, named once.
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"

# The tick's STALE_RUN_AFTER_MS (2 × PASS_HARD_LIMIT_MS), in seconds, as
# deploy-live.sh counts it. A `running` row older than this is a pass that
# died, not one in flight.
STALE_RUN_AFTER_SECONDS=7200
# The tick's defaults for its two caps (managed-sync-tick.ts), for a blank line.
DEFAULT_MAX_PASSES_IN_FLIGHT=3
DEFAULT_MAX_PASSES_PER_ORGANISATION=2
# run-delta-sync's attempts (apps/worker/trigger.config.ts: maxAttempts 3), and
# how long a failed attempt waits for its retry before it is the last: the
# backoff is at most 60 s, plus a runner's start.
ATTEMPTS=3
RETRY_GRACE_SECONDS=180

say() { printf '[live-pass-check] %s\n' "$@"; }
# refuse <exit> <sentence> — the verdict on stderr, and the run ends with that code.
refuse() {
  printf '[live-pass-check] verdict: %s\n' "$2" >&2
  exit "$1"
}
# verdict <exit> <sentence> — how the pass ended, and the run ends with that code.
verdict() {
  say "verdict: $2"
  exit "$1"
}

# The whole run is one function, read by bash before any of it runs: a checkout
# that moves while this watches does not change what runs.
main() {
  [ "$#" -eq 0 ] ||
    refuse 2 "refused, nothing was started: this takes no arguments. Usage: ./deploy/compose/live-pass-check.sh, from live's checkout; the migration is LIVE_PASS_CHECK_MIGRATION in its .env."

  # ---- Live, and its settings: refused before anything asks Docker -----------------
  [ -f "$ENV_FILE" ] ||
    refuse 2 "refused, nothing was started: no .env beside this script. The pass check is live's, and runs from live's checkout."
  stack_is_live "$ENV_FILE" ||
    refuse 2 "refused, nothing was started: this .env does not carry ${STACK_KIND_KEY} with live's value (stack-kind.sh). The pass check is live's: the OTA stack's passes are the nightly gate's. Its value, if any, is not printed."
  # Prints its own reason when it refuses (env-read.sh).
  COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" ||
    refuse 2 "refused, nothing was started: the project this checkout drives could not be settled (the reason is above)."

  MAPPING="$(env_value "$ENV_FILE" LIVE_PASS_CHECK_MIGRATION)"
  MAPPING="${MAPPING,,}"
  [ -n "$MAPPING" ] ||
    refuse 2 "refused, nothing was started: LIVE_PASS_CHECK_MIGRATION in live's .env is empty. Name one of your own migrations there, by its id (the last part of its page's address, /mappings/<id>). Its value is not printed."
  [[ "$MAPPING" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
    refuse 2 "refused, nothing was started: LIVE_PASS_CHECK_MIGRATION in live's .env is not a migration's id (the last part of its page's address, /mappings/<id>). Its value is not printed."

  MAX_IN_FLIGHT="$(env_value "$ENV_FILE" MAX_PASSES_IN_FLIGHT "$DEFAULT_MAX_PASSES_IN_FLIGHT")"
  [[ "$MAX_IN_FLIGHT" =~ ^[1-9][0-9]*$ ]] ||
    refuse 2 "refused, nothing was started: MAX_PASSES_IN_FLIGHT in live's .env is not a whole number of at least 1, so the tick stops on it too. Its value is not printed."
  MAX_PER_ORG="$(env_value "$ENV_FILE" MAX_PASSES_PER_ORGANISATION "$DEFAULT_MAX_PASSES_PER_ORGANISATION")"
  [[ "$MAX_PER_ORG" =~ ^[1-9][0-9]*$ ]] ||
    refuse 2 "refused, nothing was started: MAX_PASSES_PER_ORGANISATION in live's .env is not a whole number of at least 1, so the tick stops on it too. Its value is not printed."

  POLLS="${LIVE_PASS_CHECK_POLLS:-90}"
  [[ "$POLLS" =~ ^[1-9][0-9]*$ ]] ||
    refuse 2 "refused, nothing was started: LIVE_PASS_CHECK_POLLS is not a whole number of at least 1."
  INTERVAL="${LIVE_PASS_CHECK_INTERVAL:-10}"
  [[ "$INTERVAL" =~ ^[0-9]+$ ]] ||
    refuse 2 "refused, nothing was started: LIVE_PASS_CHECK_INTERVAL is not a whole number of seconds."

  # The .env named to Compose, so that it reads the file checked above.
  COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml" --env-file "$ENV_FILE")

  # ---- The migration, the hold and the room (one read) -----------------------------
  local answer superuser holds tenant status owners selected in_flight in_flight_org running_here
  answer="$(pre_read)" ||
    refuse 7 "could not tell: the database could not be read (above). A database that cannot be read is not one with room. Nothing was started."
  [[ "$answer" =~ ^(yes|no)[|][0-9]+[|]([0-9a-f-]{36}|-)[|]([a-z_]+|-)[|][0-9]+[|][0-9]+[|][0-9]+[|][0-9]+[|][0-9]+$ ]] ||
    refuse 7 "could not tell: the database answered something that is not the counts asked for. Nothing was started."
  IFS='|' read -r superuser holds tenant status owners selected in_flight in_flight_org running_here <<<"$answer"
  [ "$superuser" = yes ] ||
    refuse 7 "could not tell: the role psql connects as is bound by row security, so the counts would mean nothing. Nothing was started."

  [ "$tenant" != - ] ||
    refuse 2 "refused, nothing was started: LIVE_PASS_CHECK_MIGRATION names no migration on this stack. Its value is not printed."
  [ "$owners" -gt 0 ] ||
    refuse 2 "refused, nothing was started: the migration LIVE_PASS_CHECK_MIGRATION names is not in an organisation where a platform operator is an active owner: name one of your own (./deploy/compose/operator.sh list)."
  # PASS_RUNNING_STATES (packages/shared/src/lifecycle.ts): the states a pass runs in.
  case "$status" in
    active | continuous) ;;
    *) refuse 2 "refused, nothing was started: the migration is ${status}, not running: a pass on it would stop before its first data type and still close as succeeded." ;;
  esac
  [ "$selected" -gt 0 ] ||
    refuse 2 "refused, nothing was started: the migration selects no data type."

  [ "$holds" -eq 0 ] ||
    refuse 3 "refused, the hold is on: nothing was started. Lift it yourself, after looking (workplan 0132 T6 step 8), then run this again."

  local full=''
  if [ "$running_here" -gt 0 ]; then
    full='a pass of this migration is running already: one would wait behind it'
  elif [ "$in_flight" -ge "$MAX_IN_FLIGHT" ]; then
    full="${in_flight} pass(es) in flight on live, and MAX_PASSES_IN_FLIGHT allows ${MAX_IN_FLIGHT}"
  elif [ "$in_flight_org" -ge "$MAX_PER_ORG" ]; then
    full="${in_flight_org} of this organisation's, and MAX_PASSES_PER_ORGANISATION allows ${MAX_PER_ORG}"
  fi
  [ -z "$full" ] ||
    refuse 4 "refused, capacity is full: ${full}; nothing was started. Run this again once a pass ends."
  say "${COMPOSE_PROJECT}: no hold is on, ${in_flight} of ${MAX_IN_FLIGHT} pass(es) in flight, ${in_flight_org} of ${MAX_PER_ORG} of this organisation's"

  # ---- The press: Sync now, inside the api container ------------------------------
  local api_node_path rc=0 pressed run_id='' code=''
  api_node_path="$(api_node)" ||
    refuse 7 "could not tell: the api container could not be asked (is it up?): nothing was started."
  SECONDS=0
  # Its stdout is the one line read below; its stderr is fixed words, and passes through.
  pressed="$("${COMPOSE[@]}" exec -T api "$api_node_path" apps/api/src/scripts/live-pass.ts "$tenant" "$MAPPING")" || rc=$?
  local tab=$'\t'
  local started_re="^started${tab}(run_[A-Za-z0-9]+)$"
  local refused_re="^refused${tab}[0-9]{3}${tab}([a-z_]+)$"
  case "$rc" in
    0)
      [[ "$pressed" =~ $started_re ]] ||
        refuse 7 "could not tell: not known whether a pass started (the press answered nothing this reads): the migration's page says."
      run_id="${BASH_REMATCH[1]}"
      ;;
    4)
      [[ "$pressed" =~ $refused_re ]] ||
        refuse 7 "could not tell: not known whether a pass started (the press answered nothing this reads): the migration's page says."
      code="${BASH_REMATCH[1]}"
      case "$code" in
        platform_held) refuse 3 "refused, the hold is on: a hold was started after the first read: nothing was started. Lift it yourself, after looking (workplan 0132 T6 step 8), then run this again." ;;
        not_found) refuse 2 "refused, nothing was started: Sync now found no such migration in its organisation." ;;
        account_closed) refuse 2 "refused, nothing was started: its organisation is closed." ;;
        paused) refuse 2 "refused, nothing was started: the migration is paused." ;;
        grant_withdrawn) refuse 2 "refused, nothing was started: its person withdrew the grant." ;;
        free_pace) refuse 2 "refused, nothing was started: Free's pace holds it until its next pass." ;;
        *) refuse 2 "refused, nothing was started: Sync now refused it (${code})." ;;
      esac
      ;;
    2) refuse 2 "refused, nothing was started: the press refused its arguments, or the api container has no APP_DATABASE_URL." ;;
    *) refuse 7 "could not tell: not known whether a pass started (the press answered nothing this reads): the migration's page says." ;;
  esac
  say "started one pass on your migration, as Sync now starts it (Trigger.dev run ${run_id})"

  # ---- The follow: by the run's own id, never a time window ------------------------
  local row attempts state started since_finished done_count items i shown='' now=''
  local unread="could not tell: could not read the pass's row; it was started (run ${run_id}): the migration's page says how it ends."
  for ((i = 1; i <= POLLS; i++)); do
    row="$(follow_read "$run_id")" || refuse 7 "$unread"
    [[ "$row" =~ ^[0-9]+[|](queued|running|succeeded|failed|cancelled|-)[|]([0-9TZ:-]{20}|-)[|]([0-9]+|-)[|][0-9]+[|][0-9]+[|]([0-9]+|-)$ ]] ||
      refuse 7 "$unread"
    IFS='|' read -r attempts state started since_finished selected done_count items <<<"$row"
    case "$state" in
      succeeded)
        if [ "$selected" -gt 0 ] && [ "$done_count" -ge "$selected" ]; then
          verdict 0 "succeeded after ${SECONDS} s: every data type it selects finished in this pass (${done_count} of ${selected}), $(items_said "$items"). An hour after you lifted the hold, the box checks delete the copy before the update and mail Update proven (unless COPY_DELETE_WHEN_PROVEN is false in live's .env)."
        fi
        verdict 6 "ended unfinished: the pass succeeded, and $((selected - done_count)) of ${selected} data types did not finish in it; its run log on the migration's page says why (its deadline, a halt or a budget)."
        ;;
      failed)
        if [ "$attempts" -ge "$ATTEMPTS" ] || { [ "$since_finished" != - ] && [ "$since_finished" -ge "$RETRY_GRACE_SECONDS" ]; }; then
          verdict 1 "failed after ${attempts} attempt(s): the migration's page and its run log say why."
        fi
        now="attempt ${attempts} failed; waiting up to ${RETRY_GRACE_SECONDS} s for its retry"
        ;;
      cancelled)
        verdict 1 "cancelled: the pass was stopped before it ended; the migration's page and its run log say why."
        ;;
      running) now="running since ${started}" ;;
      *) now='queued: no runner has started it yet' ;;
    esac
    if [ "$now" != "$shown" ]; then
      say "$now"
      shown="$now"
    fi
    [ "$i" -eq "$POLLS" ] || sleep "$INTERVAL"
  done
  if [ "$state" = failed ]; then
    verdict 1 "failed after ${attempts} attempt(s): the migration's page and its run log say why; a retry may still come."
  fi
  [ "$state" = running ] || state=queued
  verdict 5 "timed out after ${SECONDS} s: the pass is ${state}; nothing was cancelled, and the box checks count it when it succeeds."
}

# db — the SQL on stdin, answered as the owner over the postgres container's own
# socket, which row security never binds (the answer says whether it did): one
# row per line, `|` between columns. Reads only: every statement is a SELECT.
db() {
  "${COMPOSE[@]}" exec -T postgres sh -c 'psql -X -q -At -F "|" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# pre_read — one line, `superuser|open holds|organisation or -|status or -|
# operator owners|data types selected|in flight|in flight of its organisation|
# running of this migration`. The in-flight counts are the tick's own
# (managed-sync-tick.ts): running initial copies and incremental passes younger
# than STALE_RUN_AFTER_MS.
pre_read() {
  db <<SQL
SELECT (SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'yes' ELSE 'no' END
          FROM pg_roles WHERE rolname = current_user),
       (SELECT count(*) FROM platform_pause WHERE ended_at IS NULL),
       coalesce((SELECT tenant_id::text FROM mailbox_mapping WHERE id = '${MAPPING}'), '-'),
       coalesce((SELECT status FROM mailbox_mapping WHERE id = '${MAPPING}'), '-'),
       (SELECT count(*) FROM mailbox_mapping m
          JOIN tenant_member tm ON tm.tenant_id = m.tenant_id AND tm.role = 'owner' AND tm.status = 'active'
          JOIN platform_operator po ON po.user_id = tm.user_id
         WHERE m.id = '${MAPPING}'),
       (SELECT count(*) FROM scope_selection WHERE mapping_id = '${MAPPING}' AND included),
       (SELECT count(*) FROM run
         WHERE status = 'running' AND kind IN ('initial_copy', 'incremental')
           AND started_at > now() - interval '${STALE_RUN_AFTER_SECONDS} seconds'),
       (SELECT count(*) FROM run r JOIN mailbox_mapping m ON m.tenant_id = r.tenant_id
         WHERE m.id = '${MAPPING}' AND r.status = 'running' AND r.kind IN ('initial_copy', 'incremental')
           AND r.started_at > now() - interval '${STALE_RUN_AFTER_SECONDS} seconds'),
       (SELECT count(*) FROM run
         WHERE mapping_id = '${MAPPING}' AND status = 'running' AND kind IN ('initial_copy', 'incremental')
           AND started_at > now() - interval '${STALE_RUN_AFTER_SECONDS} seconds');
SQL
}

# follow_read <run id> — one line about the pass that run id started,
# `attempts|status of the newest|its start, UTC|seconds since it finished|
# data types selected|of those, completed at or after it started|items`, with
# `-` for what is not there yet. Each attempt opens a row of its own under the
# same orchestrator_ref (run-delta-sync.ts), so the newest says where it is.
follow_read() {
  db <<SQL
WITH newest AS (
  SELECT status, started_at, finished_at, stats FROM run
   WHERE mapping_id = '${MAPPING}' AND orchestrator_ref = '${1}'
   ORDER BY started_at DESC NULLS LAST, created_at DESC LIMIT 1
)
SELECT (SELECT count(*) FROM run WHERE mapping_id = '${MAPPING}' AND orchestrator_ref = '${1}'),
       coalesce((SELECT status FROM newest), '-'),
       coalesce((SELECT to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM newest), '-'),
       coalesce((SELECT floor(extract(epoch FROM now() - finished_at))::bigint::text FROM newest
                  WHERE finished_at IS NOT NULL), '-'),
       (SELECT count(*) FROM scope_selection WHERE mapping_id = '${MAPPING}' AND included),
       (SELECT count(*) FROM scope_selection sel
          JOIN migration_status s ON s.tenant_id = sel.tenant_id AND s.mapping_id = sel.mapping_id
                                 AND s.domain = sel.domain
         WHERE sel.mapping_id = '${MAPPING}' AND sel.included
           AND s.completed_at >= (SELECT started_at FROM newest)),
       coalesce((SELECT stats->>'itemsProcessed' FROM newest), '-');
SQL
}

# api_node — Node in the api container, by its absolute path: the distroless
# image's (workplan 0146 T13), then the Node image's. Nothing, and 1, when
# neither answers. The distroless image has no shell to ask `command -v`, so
# each is tried.
api_node() {
  local p
  for p in /nodejs/bin/node /usr/local/bin/node; do
    if "${COMPOSE[@]}" exec -T api "$p" --version >/dev/null 2>&1; then
      printf '%s' "$p"
      return 0
    fi
  done
  return 1
}

# items_said <count or -> — the pass's items, as its run row counts them.
items_said() {
  if [ "$1" = - ]; then
    printf '%s' 'its row counts no items'
  else
    printf '%s item(s) handled' "$1"
  fi
}

main "$@"
