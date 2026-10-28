#!/usr/bin/env bash
# box-checks.sh — live's machine watched for its owner: the disk, the daily
# duties' last pass, and one summary a day, each sent by mail through
# tell-owner.sh (workplan 0142 T3).
#
# WHY. Both stacks, live and the OTA stack, fill one disk beside the nightly
# gate, and nothing looked at it after the bring-up's preflight. Live's daily
# duties (box-duties.sh) keep promises with clocks on them, the provisioning
# token's first among them, and systemd's OnFailure= tells the owner when a
# run fails but never when no run happens: a timer disabled or never enabled,
# unit copies removed, a machine that was off. This is the part that notices
# what did not happen.
#
# EVERY TEN MINUTES, from live's checkout, on a user timer
# (ownpace-box-checks.timer; the units are in deploy/compose/systemd/, the
# install steps in docs/managed-bring-up.md, "Live's daily duties"):
#
#   the disk     free space on the filesystem of Docker's data root (`docker
#                info`) and on that of live's persisted directory
#                (~/.persistent/<project>), against ALERT_DISK_FREE_GB in live's
#                .env (default 15, the figure the bring-up's preflight warns
#                at). One filesystem holding both is one check. A mail when a
#                filesystem goes below the floor ("Disk below the floor"), when
#                its free space cannot be read two runs in a row ("Disk not
#                read"; one run alone is a Docker daemon restarting, and the
#                journal's), and when it is back at or above the floor ("Disk
#                recovered"): one each time the state changes, never one every
#                ten minutes.
#   the duties   when all of box-duties.sh's duties last passed, from the
#                record it leaves (~/.persistent/<project>/box-duties/last-pass).
#                More than 26 hours ago, or none in the 26 hours since this
#                started watching, is one mail ("Daily duties late"): the dead
#                man's switch. A day's run at 13:17 UTC that failed has had its
#                own mail through OnFailure=; this is the one for the run that
#                never came.
#
# THE COPY BEFORE AN UPDATE (workplan 0132 T9; the owner, 2026-10-28), every
# run too: it asks copy-before-update.sh delete-if-proven, which deletes the
# copy of live's databases taken before an update once that update is proven,
# by `delete`'s rule and the stricter conditions it adds there. The deletion
# is that script's; this one deletes nothing itself. A copy deleted is one
# mail ("Update proven"), with the files' names in the journal, and while that
# mail is not sent it asks for no other delete. A copy kept is no mail: the
# summary says why. An answer it cannot judge is a NOT DONE and a failed exit,
# never a mail.
#
# ONCE A DAY, at its first run from 07:00 UTC, or now with --summary: "Daily
# summary", numbers only. Free space; the duties' last run and last pass,
# their timer, and the provisioning token's date (ZITADEL_PAT_EXPIRY); the
# size of every database in each stack's postgres and trigger-db, live's and
# the OTA stack's (managed.yml's own name); the five largest volumes of the two
# stacks; on live, the rows of run, run_event, item and app_event, the age of
# the sync tick's beat (0142 T2), and the copy before an update: none, kept
# and why, or deleted. It is also the channel's proof of life: a
# morning without it means this machine, this timer or the relay is broken.
# One that could not be sent is tried again an hour later, not at every run:
# each try asks both stacks' databases and Docker's volumes again.
#
# WHAT IT REMEMBERS, in ~/.persistent/<project>/box-checks, this account's
# alone (umask 077): each check's last state, when it started watching, the
# day of the last summary and when one last could not be sent, and the line of
# a deleted copy whose mail is not sent yet (copy-proven). A message that
# could not be sent leaves its state as it was, so the next run sends it again
# (the summary, an hour later).
#
# HOW IT READS THE DATABASES. `docker exec` into each stack's postgres and
# trigger-db containers, found by their compose labels (the project and the
# service, never a container's name), psql over the container's own socket as
# the owner the image created, the way deploy-live.sh's db_read asks. It sends
# SELECTs only and composes no connection string; docs/rls-guide.md §2 lists
# it among those that hold the owner at the machine, because its counts span
# every organisation. Live's row counts are given only when that role passes
# row security (a superuser), or they would count no organisation's rows.
# copy-before-update.sh reads live's database the same way for the copy's
# proof.
#
# NOTHING SECRET, NO ADDRESS. It sends and prints numbers, mount points, the
# names of databases, volumes and duties, release tags, and dates. Of the .env's values it
# reads ALERT_DISK_FREE_GB, a number, and ZITADEL_PAT_EXPIRY, a date, and
# prints that date. What a tool said when it failed goes to the journal, not
# into a mail.
#
# LIVE'S ONLY. It refuses a .env that does not carry live's marker exactly
# (stack_is_live), as box-duties.sh does: the OTA stack's maintenance is the
# nightly gate's.
#
# NOT ON OnFailure=. A check that failed every ten minutes would mail every ten
# minutes. Its own failures are in the journal (SyslogIdentifier
# ownpace-box-checks), and the summary's absence says it stopped.
#
# Usage:  ./deploy/compose/box-checks.sh [--summary]
# Exit:   0 everything checked, and every message due sent; 1 something could
#         not be checked, or a message could not be sent (each named; the next
#         run sends it again); 2 refused before any check (not live's .env, the
#         project, ALERT_DISK_FREE_GB, an argument, no tell-owner.sh).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"

ENV_FILE="${SCRIPT_DIR}/.env"
TELL="${SCRIPT_DIR}/tell-owner.sh"
COPY="${SCRIPT_DIR}/copy-before-update.sh"

# The messages, by the names docs/incident-runbook.md gives their rows
# (a-runbook-for-every-alert reads these lines).
MSG_DISK_LOW='Disk below the floor'
MSG_DISK_UNREAD='Disk not read'
MSG_DISK_OK='Disk recovered'
MSG_DUTIES_LATE='Daily duties late'
MSG_SUMMARY='Daily summary'
MSG_UPDATE_PROVEN='Update proven'

# A day's run, and two hours for it to start late and run long.
LATE_AFTER_SECONDS=$((26 * 3600))
# The summary's hour, in UTC: after the appliance nightly's, before the day.
SUMMARY_HOUR=7
# A summary that could not be sent waits this long for its next try.
SUMMARY_RETRY_SECONDS=3600

say() { echo "[box-checks] $*"; }
fail_line() { echo "[box-checks] $*" >&2; }
refuse() {
  fail_line "REFUSED: $*"
  fail_line "Nothing was checked."
  exit 2
}

# ---------------------------------------------------------------- before any check --

USAGE='Usage: ./deploy/compose/box-checks.sh [--summary]'
FORCE_SUMMARY=''
[ "$#" -le 1 ] || refuse "one argument at most. ${USAGE}"
case "${1-}" in
  '') ;;
  --summary) FORCE_SUMMARY=1 ;;
  *) refuse "'${1}' is not an argument this takes. ${USAGE}" ;;
esac

[ -f "$ENV_FILE" ] || refuse "no .env beside this script (${ENV_FILE}). These are live's checks, run from live's checkout."
stack_is_live "$ENV_FILE" ||
  refuse "${ENV_FILE} does not carry ${STACK_KIND_KEY} with live's value (workplan 0142 T3). These are live's checks; the OTA stack's are the nightly gate's. Its value, if any, is not printed."
# Prints its own reason when it refuses (env-read.sh).
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" ||
  refuse "the project this checkout drives could not be settled (the reason is above)"
# The OTA stack's project, managed.yml's own name: the other stack on this disk.
OTA_PROJECT="$(sed -n 's/^name:[[:space:]]*\([^[:space:]#]*\).*/\1/p' "${SCRIPT_DIR}/managed.yml")"
STACKS=("$COMPOSE_PROJECT")
[ -z "$OTA_PROJECT" ] || [ "$OTA_PROJECT" = "$COMPOSE_PROJECT" ] || STACKS+=("$OTA_PROJECT")

FLOOR_GB="$(env_value "$ENV_FILE" ALERT_DISK_FREE_GB 15)"
[[ "$FLOOR_GB" =~ ^[1-9][0-9]{0,5}$ ]] ||
  refuse "ALERT_DISK_FREE_GB in live's .env is not a whole number of GB from 1 (without it, 15)."

[ -x "$TELL" ] || refuse "tell-owner.sh is not beside this script, or cannot be run: nothing could reach the owner."

# The persisted directory is live's own, never one the shell names.
unset MANAGED_ENV_PERSIST_DIR
PERSIST="${HOME}/.persistent/${COMPOSE_PROJECT}"
STATE="${PERSIST}/box-checks"
DUTIES_RECORD="${PERSIST}/box-duties"
umask 077
mkdir -p "$STATE" || refuse "what it remembers has nowhere to go: ${STATE} could not be made (above)."

NOW="$(date -u +%s)"
TODAY="$(date -u -d "@${NOW}" +%F)"
HOUR="$(date -u -d "@${NOW}" +%H)"

# What could not be checked or sent, in words fit for the summary: what a tool
# said goes to the journal only.
PROBLEMS=()

# A tool's stderr is kept apart from what is parsed: a warning on it must not
# become a path or a number.
ERR_FILE="${STATE}/.stderr"
trap 'rm -f "$ERR_FILE"' EXIT

# ------------------------------------------------------------------- helpers --

# capture <command…> — its stdout in OUT and its stderr in ERR_TEXT; its exit
# status. Stdin passes through.
capture() {
  local rc=0
  OUT="$("$@" 2>"$ERR_FILE")" || rc=$?
  ERR_TEXT="$(cat "$ERR_FILE" 2>/dev/null)" || ERR_TEXT=''
  return "$rc"
}

utc() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }

state_get() {
  local v=''
  [ ! -f "${STATE}/$1" ] || v="$(sed -n '1p' "${STATE}/$1")"
  printf '%s' "$v"
}
# state_set <name> <value> — written whole or not at all.
state_set() {
  if printf '%s\n' "$2" >"${STATE}/.$1.new" && mv -f "${STATE}/.$1.new" "${STATE}/$1"; then
    return 0
  fi
  PROBLEMS+=("what it remembers about $1 could not be written in ${STATE}")
  return 1
}

# tell <name> <detail> [<when it is sent again>] — one message, the body on
# stdin; true when it was sent.
tell() {
  if "$TELL" "$1" "$2"; then
    say "told the owner: $1: $2"
    return 0
  fi
  PROBLEMS+=("\"$1\" could not be sent (tell-owner.sh); ${3:-the next run sends it again}")
  return 1
}

# record <file> — sets REC_EPOCH, REC_STAMP, REC_RESULT and REC_NAMES from a
# record box-duties.sh left; false when there is none, or it is not one.
record() {
  local line
  REC_EPOCH='' REC_STAMP='' REC_RESULT='' REC_NAMES=''
  [ -f "$1" ] || return 1
  line="$(sed -n '1p' "$1")" || return 1
  read -r REC_EPOCH REC_STAMP REC_RESULT REC_NAMES <<<"$line"
  [[ "$REC_EPOCH" =~ ^[0-9]+$ ]] && [[ "$REC_STAMP" =~ ^[0-9T:Z-]+$ ]] &&
    [[ "$REC_RESULT" =~ ^(passed|failed|interrupted)$ ]] && [[ "$REC_NAMES" =~ ^([a-z,]+|-)$ ]]
}

timer_state() {
  local s=''
  # is-active exits non-zero for every state but active, and says which.
  s="$(systemctl --user is-active ownpace-box-duties.timer 2>/dev/null)" || true
  [[ "$s" =~ ^[a-z-]+$ ]] || s='could not be asked'
  printf '%s' "$s"
}

token_line() {
  local exp e
  exp="$(env_value "$ENV_FILE" ZITADEL_PAT_EXPIRY)"
  if [ -z "$exp" ]; then
    echo "The provisioning token (ZITADEL_PAT_EXPIRY): not in live's .env"
  elif ! [[ "$exp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
       ! e="$(date -u -d "$exp" +%s 2>/dev/null)"; then
    echo "The provisioning token (ZITADEL_PAT_EXPIRY): not a date this reads"
  elif [ "$e" -le "$NOW" ]; then
    echo "The provisioning token (ZITADEL_PAT_EXPIRY): ${exp}, past: only a console session can mint the next one (setup-zitadel.sh's 401 message)"
  else
    echo "The provisioning token (ZITADEL_PAT_EXPIRY): ${exp}, $(((e - NOW) / 86400)) days from now"
  fi
}

# ------------------------------------------------------------------- the disk --

# disk_free <path> — sets FREE_GB and MOUNT for the filesystem that holds
# <path>; false, with df's own words on stderr, when df cannot say.
disk_free() {
  local line avail mount
  if ! capture df -P -k -- "$1"; then
    fail_line "df ${1}: ${ERR_TEXT:-${OUT}}"
    return 1
  fi
  line="$(sed -n '2p' <<<"$OUT")"
  # -P: one line, and the mount point is everything from the sixth field on.
  read -r _ _ _ avail _ mount <<<"$line"
  if ! [[ "$avail" =~ ^[0-9]+$ ]] || [ -z "$mount" ]; then
    fail_line "df ${1}: an answer this cannot read: ${line}"
    return 1
  fi
  FREE_GB=$((avail / 1024 / 1024))
  MOUNT="$mount"
}

SEEN_MOUNTS=()
DISK_LINES=()
# check_disk <key> <what> <path> — one filesystem against the floor, and a
# message when its state changes. An empty path is one that was not found.
#
# Its state is ok, low or unread, or unread-once:<the state before>: a first
# run that could not read it. That one is the journal's and a failed exit, not
# a mail: a Docker daemon restarting (unattended upgrades, a boot) would
# otherwise send "Disk not read" and then "Disk recovered" ten minutes later.
# A second run in a row is the mail; a run that reads it compares with the
# state before.
check_disk() {
  local key="$1" what="$2" path="$3" was now m once=''
  was="$(state_get "disk-${key}")"
  case "$was" in
    unread-once:*) once=1; was="${was#unread-once:}" ;;
  esac
  FREE_GB=''
  MOUNT=''
  if [ -n "$path" ] && disk_free "$path"; then
    for m in "${SEEN_MOUNTS[@]}"; do
      if [ "$m" = "$MOUNT" ]; then
        DISK_LINES+=("${what}: on ${MOUNT}, above")
        return 0
      fi
    done
    SEEN_MOUNTS+=("$MOUNT")
    DISK_LINES+=("${MOUNT}: ${FREE_GB} GB free (${what})")
    if [ "$FREE_GB" -lt "$FLOOR_GB" ]; then now=low; else now=ok; fi
  else
    now=unread
    DISK_LINES+=("${what}: not read")
    PROBLEMS+=("the free space of ${what}")
  fi
  if [ "$now" = unread ] && [ "$was" != unread ] && [ -z "$once" ]; then
    say "${what}: not read; a second run in a row that cannot read it tells the owner"
    state_set "disk-${key}" "unread-once:${was}" || true
    return 0
  fi
  if [ "$now" = "$was" ]; then
    [ -z "$once" ] || state_set "disk-${key}" "$now" || true
    return 0
  fi
  case "$now" in
    low)
      tell "$MSG_DISK_LOW" "${MOUNT} has ${FREE_GB} GB free, under ${FLOOR_GB}" <<EOF || return 0
Free space on ${MOUNT}, where ${what} is: ${FREE_GB} GB. The floor is ${FLOOR_GB} GB (ALERT_DISK_FREE_GB in live's .env, 15 without it).

Both stacks and the nightly gate write to this disk. Look first, from ~/${COMPOSE_PROJECT}:
  docker system df
  df -h ${MOUNT}
What grows, and what is safe to remove, is workplan 0143's (section 1). This says it once; the next mail is the one that says it recovered.
EOF
      ;;
    unread)
      tell "$MSG_DISK_UNREAD" "$what" <<EOF || return 0
The free space of ${what} could not be read (df, or docker info for Docker's data root). The journal says what the tool answered:
  journalctl --user -u ownpace-box-checks -n 50 --no-pager
Until it can be read, nothing watches that disk.
EOF
      ;;
    ok)
      if [ -n "$was" ]; then
        tell "$MSG_DISK_OK" "${MOUNT} has ${FREE_GB} GB free, the floor is ${FLOOR_GB}" <<EOF || return 0
Free space on ${MOUNT}, where ${what} is: ${FREE_GB} GB, at or above the floor of ${FLOOR_GB} GB again.
EOF
      fi
      ;;
  esac
  state_set "disk-${key}" "$now" || true
}

# --------------------------------------------------------------- the duties --

DUTIES_LINES=()
check_duties() {
  local since ref age was now since_note=''
  since="$(state_get since)"
  if ! [[ "$since" =~ ^[0-9]+$ ]]; then
    since="$NOW"
    state_set since "$NOW" || true
  fi
  if record "${DUTIES_RECORD}/last-pass"; then
    ref="$REC_EPOCH"
    since_note="They last passed at ${REC_STAMP}."
  else
    ref="$since"
    since_note="No pass is recorded since box-checks.sh started watching, at $(utc "$since")."
  fi
  age=$((NOW - ref))
  [ "$age" -ge 0 ] || age=0
  was="$(state_get duties)"
  if [ "$age" -gt "$LATE_AFTER_SECONDS" ]; then now=late; else now=ok; fi
  [ "$now" != "$was" ] || return 0
  if [ "$now" = late ]; then
    tell "$MSG_DUTIES_LATE" "no pass in $((age / 3600)) hours" <<EOF || return 0
Live's daily duties have not all passed in $((age / 3600)) hours; they run once a day at 13:17 UTC. ${since_note}
A run that failed would have sent "Daily duties failed": this is the run that did not happen, or never finished.

Their timer (ownpace-box-duties.timer): $(timer_state)
$(token_line)

Look first, from ~/${COMPOSE_PROJECT}:
  systemctl --user list-timers ownpace-box-duties.timer --no-pager
  journalctl --user -u ownpace-box-duties -n 200 --no-pager
Until they run, keep the token alive by hand: ./deploy/compose/setup-zitadel.sh --token-only
EOF
  fi
  state_set duties "$now" || true
}

# ------------------------------------------------- the copy before an update --

# What copy-before-update.sh delete-if-proven may put in its one line: times
# in deploys.log's format, release tags, counts, and nothing else.
ISO_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
TAG_RE='^[A-Za-z0-9][A-Za-z0-9._-]*$'
COPY_LINE='The copy before an update: not read'

# deleted_fields <line> — sets D_TAKEN, D_BEFORE, D_TOOK, D_TAG, D_PASSES and
# D_FILES from the line delete-if-proven prints when it deleted the copy;
# false when it is not that line, field by field.
deleted_fields() {
  local kind
  IFS=$'\t' read -r kind D_TAKEN D_BEFORE D_TOOK D_TAG D_PASSES D_FILES <<<"$1"
  [ "$kind" = deleted ] && [ "$(wc -l <<<"$1")" -eq 1 ] &&
    [[ "$D_TAKEN" =~ $ISO_RE ]] && [[ "$D_TOOK" =~ $ISO_RE ]] &&
    [[ "$D_BEFORE" =~ $TAG_RE ]] && [[ "$D_TAG" =~ $TAG_RE ]] &&
    [[ "$D_PASSES" =~ ^[1-9][0-9]*$ ]] && [[ "$D_FILES" =~ ^[1-9][0-9]*$ ]]
}

# tell_proven <line> — "Update proven", from a deleted copy's line; true when
# it was sent.
tell_proven() {
  deleted_fields "$1" || return 1
  tell "$MSG_UPDATE_PROVEN" "$D_TAG" 'the next run sends it again, and asks for no other delete until it is sent' <<EOF
The update to ${D_TAG} is proven, by the rule of ./deploy/compose/copy-before-update.sh delete and the box checks' own: the deploy of ${D_TAG} took at ${D_TOOK} (deploys.log), the hold that covered it was lifted at least an hour ago and no hold is on now, the checkout is at the commit that took, and ${D_PASSES} pass(es) that started after it succeeded and have a data type of their migration completed.

So the copy of live's databases taken at ${D_TAKEN}, before ${D_BEFORE}, is deleted, as that command deletes it: ${D_FILES} file(s). Live holds no copy until the next deploy takes one; a bad update from here is fixed forward with a new tag.

Nothing to do. The files' names are in the journal:
  journalctl --user -u ownpace-box-checks -n 50 --no-pager
To keep the next copy until you delete it yourself: COPY_DELETE_WHEN_PROVEN=false in live's .env.
EOF
}

# copy_reason <code> — why delete-if-proven kept the copy, in the summary's
# words; false for a code it does not give.
copy_reason() {
  case "$1" in
    no-note) echo "files without a copy's note (a dump by hand), each deleted by its own age after day 6" ;;
    off) echo 'COPY_DELETE_WHEN_PROVEN is false: deleting it is yours (copy-before-update.sh delete)' ;;
    no-took) echo 'no deploy has taken since it was taken' ;;
    did-not-take) echo 'the last deploy since it was taken did not take' ;;
    hold-on) echo 'the hold that covered the deploy is still on: lift it after looking' ;;
    no-pass) echo 'no pass that started after the deploy has succeeded yet: ./deploy/compose/live-pass-check.sh starts one' ;;
    unfinished) echo 'passes since the deploy succeeded, but none has a data type of its migration completed yet' ;;
    held) echo 'a hold is on now: the box checks delete nothing while one is' ;;
    grace) echo 'proven, and deleted once an hour has passed since the hold was last lifted' ;;
    head-moved) echo 'the checkout is not at the commit the deploy took' ;;
    unlisted) echo 'a file beside it is not in its note: delete it yourself (copy-before-update.sh delete), or day 6 does' ;;
    *) return 1 ;;
  esac
}

# unread_code <code> — whether delete-if-proven gives it when it cannot tell.
unread_code() {
  case "$1" in
    note-time | log-unread | log-garbled | db | answer | not-superuser | git | switch | note-unread | delete-incomplete) return 0 ;;
  esac
  return 1
}

# check_copy — copy-before-update.sh delete-if-proven, its one line read and
# nothing else of what it printed: COPY_LINE for the summary, one mail for a
# copy deleted, and a NOT DONE for an answer it cannot judge. A deleted copy's
# line is kept (copy-proven) until its mail is sent, and no other delete is
# asked for while it is.
check_copy() {
  local pending rc=0 kind='' code='' taken='' before='' day='' reason l
  pending="$(state_get copy-proven)"
  if [ -n "$pending" ]; then
    if ! deleted_fields "$pending"; then
      PROBLEMS+=("the copy before an update: copy-proven in what it remembers is not a line it wrote; nothing more is deleted until that file is gone")
      return 0
    fi
    if ! tell_proven "$pending"; then
      COPY_LINE="The copy before an update: deleted (the update to ${D_TAG} is proven); the mail saying so is not sent yet"
      return 0
    fi
    state_set copy-proven '' || return 0
  fi
  if [ ! -x "$COPY" ]; then
    PROBLEMS+=("the copy before an update: copy-before-update.sh is not beside this script, or cannot be run")
    return 0
  fi
  capture "$COPY" delete-if-proven </dev/null || rc=$?
  if [ "$(wc -l <<<"$OUT")" -eq 1 ]; then
    IFS=$'\t' read -r kind code taken before day <<<"$OUT"
  fi
  if [ "$rc" -eq 0 ] && [ "$OUT" = none ]; then
    COPY_LINE='The copy before an update: none here'
  elif [ "$rc" -eq 0 ] && [ "$kind" = kept ] && reason="$(copy_reason "$code")" &&
    [[ "$taken" =~ $ISO_RE || "$taken" = - ]] && [[ "$before" =~ $TAG_RE || "$before" = - ]] &&
    [[ "$day" =~ ^[1-9][0-9]*$ || "$day" = - ]]; then
    COPY_LINE="The copy before an update: taken ${taken}, before ${before}, day ${day} of at most 7: kept, ${reason}"
  elif [ "$rc" -eq 0 ] && deleted_fields "$OUT"; then
    # The files it deleted, by name, for the journal.
    while IFS= read -r l; do [ -z "$l" ] || fail_line "$l"; done <<<"$ERR_TEXT"
    # Kept before the mail is tried: a deletion is told, by this run or the next.
    state_set copy-proven "$OUT" || true
    if tell_proven "$OUT"; then
      state_set copy-proven '' || true
      COPY_LINE="The copy before an update: deleted at $(utc "$NOW"): the update to ${D_TAG} is proven"
    else
      COPY_LINE="The copy before an update: deleted (the update to ${D_TAG} is proven); the mail saying so is not sent yet"
    fi
  elif [ "$rc" -eq 1 ] && [ "$kind" = unread ] && [ -z "$taken" ] && unread_code "$code"; then
    while IFS= read -r l; do [ -z "$l" ] || fail_line "$l"; done <<<"$ERR_TEXT"
    PROBLEMS+=("the copy before an update: whether its update is proven (${code})")
  else
    # Nothing of what it printed on stdout goes anywhere: it is not a line
    # this reads.
    fail_line "copy-before-update.sh delete-if-proven (exit ${rc}): ${ERR_TEXT:-it said nothing}"
    PROBLEMS+=("the copy before an update: copy-before-update.sh delete-if-proven answered nothing this reads (exit ${rc})")
  fi
}

# -------------------------------------------------------------- the summary --

# container <project> <service> — sets CONTAINER to the id of that service's
# running container, found by its compose labels, or empty when none runs;
# false when docker could not be asked.
container() {
  CONTAINER=''
  if ! capture docker ps -q --filter "label=com.docker.compose.project=$1" --filter "label=com.docker.compose.service=$2"; then
    fail_line "the containers of ${1}'s ${2} could not be listed: ${ERR_TEXT}"
    return 1
  fi
  CONTAINER="${OUT%%$'\n'*}"
}

# psql_in <container> — the SQL on stdin, as the image's owner over the
# container's own socket. Reads only.
psql_in() {
  docker exec -i "$1" sh -c 'psql -X -q -At -F "|" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# db_sizes <project> — sets DB_LINE: each database in the stack's postgres and
# trigger-db, in MB.
db_sizes() {
  local p="$1" svc sizes parts=() joined=''
  for svc in postgres trigger-db; do
    if ! container "$p" "$svc"; then
      parts+=("${svc}: not read")
      PROBLEMS+=("the databases of ${p}'s ${svc}")
      continue
    fi
    if [ -z "$CONTAINER" ]; then
      parts+=("${svc}: not running here")
      continue
    fi
    if ! capture psql_in "$CONTAINER" <<<"SELECT datname || ' ' || pg_database_size(datname) FROM pg_database WHERE NOT datistemplate ORDER BY datname;"; then
      fail_line "the database sizes in ${p}'s ${svc}: ${ERR_TEXT}"
      parts+=("${svc}: not read")
      PROBLEMS+=("the databases of ${p}'s ${svc}")
      continue
    fi
    sizes="$(awk 'NF == 2 && $2 ~ /^[0-9]+$/ { printf "%s%s %.0f MB", sep, $1, $2 / 1048576; sep = ", " }' <<<"$OUT")"
    parts+=("${svc}: ${sizes:-none}")
  done
  for svc in "${parts[@]}"; do joined+="${joined:+; }${svc}"; done
  DB_LINE="$joined"
}

# live_rows — sets ROWS_LINE and BEAT_LINE: live's rows, and the age of the
# sync tick's beat.
live_rows() {
  local su run ev item app beat
  ROWS_LINE="Live's rows: not read"
  BEAT_LINE="The sync tick's beat: not read"
  if ! container "$COMPOSE_PROJECT" postgres || [ -z "$CONTAINER" ]; then
    fail_line "live's rows: no running postgres in ${COMPOSE_PROJECT} was found"
    PROBLEMS+=("live's rows and the tick's beat")
    return 0
  fi
  if ! capture psql_in "$CONTAINER" <<'SQL'
SELECT (SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'yes' ELSE 'no' END
          FROM pg_roles WHERE rolname = current_user),
       (SELECT count(*) FROM run),
       (SELECT count(*) FROM run_event),
       (SELECT count(*) FROM item),
       (SELECT count(*) FROM app_event),
       coalesce((SELECT floor(extract(epoch FROM now() - beat_at))::bigint
                   FROM sync_tick_beat WHERE task = 'managed-sync-tick'), -1);
SQL
  then
    fail_line "live's rows: ${ERR_TEXT}"
    PROBLEMS+=("live's rows and the tick's beat")
    return 0
  fi
  IFS='|' read -r su run ev item app beat <<<"$OUT"
  if [ "$su" != yes ]; then
    ROWS_LINE="Live's rows: not given: the role psql used is bound by row security, and would count no organisation's rows"
  elif [[ "$run" =~ ^[0-9]+$ ]] && [[ "$ev" =~ ^[0-9]+$ ]] && [[ "$item" =~ ^[0-9]+$ ]] && [[ "$app" =~ ^[0-9]+$ ]]; then
    ROWS_LINE="Live's rows: run ${run}, run_event ${ev}, item ${item}, app_event ${app}"
  else
    fail_line "live's rows: an answer this cannot read"
    PROBLEMS+=("live's rows")
  fi
  if [[ "$beat" =~ ^[0-9]+$ ]]; then
    BEAT_LINE="The sync tick's beat: ${beat} seconds old"
  elif [ "$beat" = -1 ]; then
    BEAT_LINE="The sync tick's beat: none recorded"
  else
    PROBLEMS+=("the tick's beat")
  fi
}

# largest_volumes — sets VOLUME_LINES: the five largest volumes of the two
# stacks, largest first, with the sizes `docker system df -v` gives them. The
# table is read as Docker prints it; a table it cannot find, or a size in a
# unit it does not know, is "not read", never "none" (AGENTS rule 9).
largest_volumes() {
  local rows sorted rc=0
  VOLUME_LINES='  not read'
  if ! capture docker system df -v; then
    fail_line "docker system df -v: ${ERR_TEXT}"
    PROBLEMS+=("the volumes")
    return 0
  fi
  # Exit 3: no volumes table, or no header row in it; 4: a size it cannot read.
  rows="$(awk -v a="${STACKS[0]}_" -v b="${STACKS[1]:-${STACKS[0]}}_" '
    /^Local Volumes space usage:/ { s = 1; next }
    s == 1 && /^VOLUME NAME/      { s = 2; next }
    s == 2 && NF == 0             { exit }
    s == 2 && (index($1, a) == 1 || index($1, b) == 1) {
      n = $NF; u = $NF
      sub(/[A-Za-z]+$/, "", n); sub(/^[0-9.]+/, "", u)
      m = (u == "B") ? 1 : (u == "kB") ? 1e3 : (u == "MB") ? 1e6 : (u == "GB") ? 1e9 : (u == "TB") ? 1e12 : (u == "PB") ? 1e15 : 0
      if (m == 0 || n !~ /^[0-9]+(\.[0-9]+)?$/) { bad = 1; exit }
      printf "%.0f %s %s\n", n * m, $1, $NF
    }
    END { if (bad) exit 4; if (s < 2) exit 3 }' <<<"$OUT")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    case "$rc" in
      3) fail_line "docker system df -v: no \"Local Volumes space usage:\" table with a VOLUME NAME row in what it printed" ;;
      4) fail_line "docker system df -v: a volume's size this cannot read" ;;
      *) fail_line "docker system df -v: its table could not be read (awk exit ${rc})" ;;
    esac
    PROBLEMS+=("the volumes")
    return 0
  fi
  if [ -z "$rows" ]; then
    VOLUME_LINES='  none of the two stacks'
    return 0
  fi
  sorted="$(sort -rn -k1,1 <<<"$rows")"
  VOLUME_LINES="$(awk 'NR <= 5 { printf "  %s  %s\n", $2, $3 }' <<<"$sorted")"
}

summary_due() {
  local tried
  [ -z "$FORCE_SUMMARY" ] || return 0
  [ "$((10#$HOUR))" -ge "$SUMMARY_HOUR" ] || return 1
  [ "$(state_get summary)" != "$TODAY" ] || return 1
  tried="$(state_get summary-failed)"
  if [[ "$tried" =~ ^[0-9]+$ ]] && [ "$((NOW - tried))" -ge 0 ] && [ "$((NOW - tried))" -lt "$SUMMARY_RETRY_SECONDS" ]; then
    say "the summary could not be sent at $(utc "$tried"); it is tried again from $(utc "$((tried + SUMMARY_RETRY_SECONDS))")"
    return 1
  fi
}

send_summary() {
  local body p last_run last_pass databases='' i
  if record "${DUTIES_RECORD}/last-run"; then
    last_run="${REC_STAMP}, ${REC_RESULT}"
    [ "$REC_NAMES" = - ] || last_run+=": ${REC_NAMES//,/, }"
  else
    last_run='none recorded'
  fi
  if record "${DUTIES_RECORD}/last-pass"; then
    last_pass="${REC_STAMP}, $(((NOW - REC_EPOCH) / 3600)) hours ago"
  else
    last_pass='none recorded'
  fi
  for p in "${STACKS[@]}"; do
    db_sizes "$p"
    databases+="  ${p}: ${DB_LINE}"$'\n'
  done
  largest_volumes
  live_rows
  body="Live's machine, ${COMPOSE_PROJECT}, at $(utc "$NOW"). Numbers only.

Free space (the floor is ${FLOOR_GB} GB, ALERT_DISK_FREE_GB)
$(printf '  %s\n' "${DISK_LINES[@]}")

The daily duties
  Last run: ${last_run}
  Last pass: ${last_pass}
  Their timer (ownpace-box-duties.timer): $(timer_state)
  $(token_line)

Databases, per stack
${databases%$'\n'}

The five largest volumes of the two stacks
${VOLUME_LINES}

On ${COMPOSE_PROJECT}
  ${ROWS_LINE}
  ${BEAT_LINE}
  ${COPY_LINE}"
  if [ "${#PROBLEMS[@]}" -gt 0 ]; then
    body+="

What could not be read"
    for ((i = 0; i < ${#PROBLEMS[@]}; i++)); do body+=$'\n'"  ${PROBLEMS[$i]}"; done
    body+=$'\n'"The journal has what each tool answered: journalctl --user -u ownpace-box-checks -n 100 --no-pager"
  fi
  if tell "$MSG_SUMMARY" "$TODAY" "a run tries again from $(utc "$((NOW + SUMMARY_RETRY_SECONDS))")" <<<"$body"; then
    state_set summary "$TODAY" || true
  else
    state_set summary-failed "$NOW" || true
  fi
}

# ------------------------------------------------------------------- the run --

DOCKER_ROOT=''
if capture docker info --format '{{.DockerRootDir}}' && [[ "$OUT" =~ ^/[^$'\n']*$ ]]; then
  DOCKER_ROOT="$OUT"
else
  fail_line "docker info: ${ERR_TEXT:-it named no data root}"
fi
check_disk docker "Docker's data root" "$DOCKER_ROOT"
check_disk persistent "live's persisted directory" "$PERSIST"
check_duties
check_copy
if summary_due; then send_summary; fi

if [ "${#PROBLEMS[@]}" -gt 0 ]; then
  for p in "${PROBLEMS[@]}"; do fail_line "NOT DONE: ${p}"; done
  exit 1
fi
say "checked: ${#SEEN_MOUNTS[@]} filesystem(s) against ${FLOOR_GB} GB, the duties' last pass, the copy before an update"
