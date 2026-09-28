#!/usr/bin/env bash
# copy-before-update.sh — the one copy of live's databases made right before
# an update, and the rules that delete it (workplan 0139, "the copy before an
# update"; the owner's answers rec-copies (a) and rec-drill (a), 2026-09-28;
# 0132 T6 step 4 and T7).
#
# WHY. During the alpha live keeps no backups (0134 D1), with one exception the
# owner chose on 2026-09-28: "deletes only after proven successful upgrade, so
# we already have one backup copy of what actually works". One copy right
# before each update, deleted once the update is proven, and never kept past
# day 7. The privacy policy (§9) and the Alpha conditions (§6) promise exactly
# that: "until that update is shown to work, and never longer than 7 days".
# Until this script the dump was the owner's step, and nothing deleted one
# (0134 T0 step 4).
#
# WHERE. One directory, on the machine's persistent storage, never in the
# checkout:
#
#   ~/.persistent/<project>/copy-before-update/
#
# beside live's .env and deploys.log (0132 T1). It is readable by this account
# alone, and it holds one copy or nothing. It is NOT taken from the shell
# (MANAGED_ENV_PERSIST_DIR, MANAGED_BACKUP_DIR): the daily backstop looks here
# and nowhere else, so a copy put anywhere else would outlive the promise.
# Every file in it is part of the copy, a dump made there by hand included:
# on live, dump-idp.sh and trigger-version.sh backup write here and nowhere
# else (both source this file for the directory's name).
#
# WHAT A COPY HOLDS, taken by `take`, each part read back before it counts:
#
#   the app's database      pg_dump --format=custom of POSTGRES_DB in the
#                           stack's Postgres, read back with that server's own
#                           pg_restore --list
#   the sign-in service's database and the server's roles
#                           dump-idp.sh --dir <this directory>, which reads its
#                           dump back and writes its own note, with the way back
#   the task runner's database, only with --trigger, which deploy-live.sh
#                           passes when the tag moves the Trigger.dev pin:
#                           trigger-version.sh backup before-<tag>, verified
#   copy-before-update.txt  the note, written last: the lines above its first
#                           blank line are read back (taken=, taken_epoch=,
#                           before=, from=); below them, the files, the rule and
#                           the way back
#
# THE COMMANDS, from live's checkout:
#
#   copy-before-update.sh take [--dry-run] [--trigger] <tag>
#       deploy-live.sh runs it right before its checkout, with the hold on and
#       nothing in flight. With no copy here, it takes one. With a copy whose
#       update is not proven, it keeps that one and takes no other: it is the
#       copy of what ran before, and a deploy that did not take may already
#       have migrated the database. With --trigger it adds the task runner's
#       database to a kept copy that lacks it. With a copy whose update IS
#       proven, it refuses: one copy per update, delete that one first. Files
#       here without a note (a dump by hand) become part of the new copy.
#       --dry-run says which of these it would do, refuses what it would
#       refuse, and writes nothing, not even the directory.
#   copy-before-update.sh delete
#       The operator's step, once the update is proven. It refuses unless all
#       three hold, each read, never assumed:
#         deploys.log (deploy-live.sh's) has a `took` line at or after the
#           moment the copy was taken;
#         no hold that began at or before that line is still on (a hold for
#           the next update, begun after it, is not that one);
#         a pass (an initial copy or an incremental one) that started after
#           that line succeeded.
#       The database is read over the Postgres container's own socket, as the
#       owner the image created, which row security never binds; it checks
#       that, and every statement it sends is a SELECT. A database it cannot
#       read proves nothing. So does a note without its time.
#   copy-before-update.sh expire
#       box-duties.sh's daily backstop. It deletes the copy once it is older
#       than 6 days, proven or not, so that with one run a day it never
#       reaches day 7. A copy is as old as its note says, or as its oldest
#       file, whichever is older. On day 6 it keeps it and fails, saying to
#       roll back from it today if its update is not proven
#       (docs/operator-runbook.md, "The copy before an update"), or to delete
#       it. It reads no database and makes no dump.
#
# LIVE ONLY. Each command refuses a .env without live's marker exactly
# (stack_is_live, stack-kind.sh), and a project the reader refuses: the OTA
# stack follows main through the nightly gate and holds no tester's data.
#
# NOTHING SECRET, NO ADDRESS. A copy holds testers' data and the provider's
# password hashes: umask 077, the directory 700. It prints no value from the
# .env, and nothing that runs it may use `set -x`.
#
# Usage:  ./deploy/compose/copy-before-update.sh take [--dry-run] [--trigger] <tag>
#         ./deploy/compose/copy-before-update.sh delete
#         ./deploy/compose/copy-before-update.sh expire
# Exit:   0 done, kept, or nothing to do; 1 refused, or a part of a take
#         failed (nothing of that run is left), or expire on day 6; 2 usage.
#
# Sourced (dump-idp.sh, trigger-version.sh), it defines only the directory's
# name, below, and returns before anything runs.

COPY_BEFORE_UPDATE_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! declare -F env_value >/dev/null; then
  # shellcheck source=deploy/compose/env-read.sh
  . "${COPY_BEFORE_UPDATE_HERE}/env-read.sh"
fi

# The note, named once.
COPY_NOTE=copy-before-update.txt
# Older than this many days, the backstop deletes the copy, proven or not.
COPY_EXPIRE_DAYS=6

# copy_before_update_dir — the one directory of the copy, for the project the
# caller set in COMPOSE_PROJECT (the reader's, env-read.sh).
copy_before_update_dir() {
  printf '%s' "${HOME}/.persistent/${COMPOSE_PROJECT}/copy-before-update"
}

# Sourced: the definitions above are all a caller needs.
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi

set -euo pipefail

SCRIPT_DIR="$COPY_BEFORE_UPDATE_HERE"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
# Live's marker, named once.
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"

say() { printf '[copy-before-update] %s\n' "$@"; }
fail() { printf '[copy-before-update] %s\n' "$@" >&2; }
refuse() {
  fail "refused: $1"
  shift
  [ "$#" -eq 0 ] || printf '  %s\n' "$@" >&2
  exit 1
}
usage() {
  [ "$#" -eq 0 ] || fail "$1"
  cat >&2 <<'EOF'
usage: ./deploy/compose/copy-before-update.sh take [--dry-run] [--trigger] <tag>
       ./deploy/compose/copy-before-update.sh delete
       ./deploy/compose/copy-before-update.sh expire
(from live's checkout; --help for more)
EOF
  exit 2
}

# ---------------------------------------------------------------- arguments --

CMD="${1:-}"
[ "$#" -eq 0 ] || shift
DRY_RUN=''
TRIGGER=''
TAG=''
case "$CMD" in
  take)
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --trigger) TRIGGER=1 ;;
        -*) usage "unknown option '$1'" ;;
        *)
          [ -z "$TAG" ] || usage "one tag only"
          TAG="$1"
          ;;
      esac
      shift
    done
    [ -n "$TAG" ] || usage "take needs the tag the update moves to"
    # It lands in file names, so it is a release tag's shape and nothing else.
    [[ "$TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || usage "'${TAG}' is not a tag name"
    ;;
  delete | expire)
    [ "$#" -eq 0 ] || usage "${CMD} takes no arguments"
    ;;
  -h | --help)
    sed -n '2,/^# name, below, and returns before anything runs\.$/p' "${BASH_SOURCE[0]}"
    exit 0
    ;;
  *) usage ;;
esac

# ------------------------------------------------------------ live, and whose --

[ -f "$ENV_FILE" ] ||
  refuse "no .env beside this script (${ENV_FILE}). The copy before an update is live's, and runs from live's checkout."
stack_is_live "$ENV_FILE" ||
  refuse "${ENV_FILE} does not carry ${STACK_KIND_KEY} with live's value (stack-kind.sh). The copy before an update is live's: the OTA stack follows main through the nightly gate and holds no tester's data. Its value, if any, is not printed."
# Prints its own reason when it refuses (env-read.sh).
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" ||
  refuse "the project this checkout drives could not be settled (the reason is above)."

COPY_DIR="$(copy_before_update_dir)"
# Where deploy-live.sh appends its log, read the same way.
DEPLOY_LOG="${MANAGED_ENV_PERSIST_DIR:-$HOME/.persistent/${COMPOSE_PROJECT}}/deploys.log"
DB_CONTAINER="${COMPOSE_PROJECT}-db"
DB_NAME="$(env_value "$ENV_FILE" POSTGRES_DB)"
DB_NAME="${DB_NAME:-openmigrate}"
case "$DB_NAME" in
  '' | *[!A-Za-z0-9_]*) refuse "POSTGRES_DB in ${ENV_FILE} is not a plain database name. Its value is not printed." ;;
esac
# The parts' own scripts must not be pointed anywhere else from the shell:
# trigger-version.sh takes its directory and its container from these.
unset MANAGED_BACKUP_DIR MANAGED_ENV_PERSIST_DIR TRIGGER_DB_CONTAINER
# A copy holds testers' data and the provider's password hashes.
umask 077

# ------------------------------------------------------------------ reading --

# copy_files — the name of every entry in the directory, one per line, sorted,
# or nothing when there is no directory.
copy_files() {
  [ -d "$COPY_DIR" ] || return 0
  find "$COPY_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort
}

# note_value <key> — the key's value in the note's header, above its first
# blank line, or nothing.
note_value() {
  [ -f "${COPY_DIR}/${COPY_NOTE}" ] || return 0
  sed -n "/^\$/q;s/^${1}=//p" "${COPY_DIR}/${COPY_NOTE}"
}

# copy_oldest_epoch — the copy's age, as the second it began: the time its
# note says it was taken, or its oldest file's, whichever is older. Nothing
# when the directory holds nothing.
copy_oldest_epoch() {
  local times oldest='' taken
  times="$(find "$COPY_DIR" -mindepth 1 -printf '%T@\n' | LC_ALL=C sort -n)"
  times="${times%%$'\n'*}"
  times="${times%%.*}"
  [ -z "$times" ] || oldest="$times"
  taken="$(note_value taken_epoch)"
  if [[ "$taken" =~ ^[0-9]+$ ]] && { [ -z "$oldest" ] || [ "$taken" -lt "$oldest" ]; }; then
    oldest="$taken"
  fi
  printf '%s' "$oldest"
}

# copy_day — which day of its life the copy is on: 1 for its first 24 hours.
copy_day() {
  local oldest
  oldest="$(copy_oldest_epoch)"
  [ -n "$oldest" ] || { printf '1'; return 0; }
  printf '%s' "$(( ($(date +%s) - oldest) / 86400 + 1 ))"
}

# proof_read <took> — one line, `superuser|holds still on|passes since`, read
# as the owner over the Postgres container's own socket. Reads only. The holds
# are those that began at or before <took>, the deploy's line in deploys.log;
# the passes are the tick's kinds (managed-sync-tick.ts) that started after it
# and succeeded.
proof_read() {
  docker exec -i "$DB_CONTAINER" sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$DB_NAME" <<SQL
SELECT (SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'yes' ELSE 'no' END
          FROM pg_roles WHERE rolname = current_user) AS superuser,
       (SELECT count(*) FROM platform_pause
         WHERE ended_at IS NULL AND started_at <= '${1}'::timestamptz) AS holds_still_on,
       (SELECT count(*) FROM run
         WHERE kind IN ('initial_copy', 'incremental') AND status = 'succeeded'
           AND started_at > '${1}'::timestamptz) AS passes_since;
SQL
}

ISO_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'

# prove — whether the update the copy was taken for is proven. Sets WHY to what
# was found, and returns 0 when proven, 1 when not. It never exits: `take`
# keeps a copy it cannot prove, and `delete` refuses it.
WHY=''
prove() {
  local taken line took took_tag answer superuser holds passes
  taken="$(note_value taken)"
  if ! [[ "$taken" =~ $ISO_RE ]]; then
    WHY="the note (${COPY_NOTE}) does not say when the copy was taken, so no deploy can be shown to have taken after it"
    return 1
  fi
  if [ ! -e "$DEPLOY_LOG" ]; then
    WHY="there is no ${DEPLOY_LOG}, so no deploy has taken since the copy was taken, ${taken}"
    return 1
  fi
  if ! line="$(awk -F '\t' -v since="$taken" '$4 == "took" && $1 >= since { l = $1 "\t" $2 } END { if (l != "") print l }' "$DEPLOY_LOG")"; then
    WHY="${DEPLOY_LOG} could not be read (above)"
    return 1
  fi
  if [ -z "$line" ]; then
    WHY="no deploy has taken since the copy was taken, ${taken}: ${DEPLOY_LOG} has no took line at or after it"
    return 1
  fi
  took="${line%%$'\t'*}"
  took_tag="${line#*$'\t'}"
  if ! [[ "$took" =~ $ISO_RE ]]; then
    WHY="the took line in ${DEPLOY_LOG} does not start with a time in deploy-live.sh's format"
    return 1
  fi
  if ! answer="$(proof_read "$took")"; then
    WHY="the database could not be read (above), and a database that cannot be read proves nothing"
    return 1
  fi
  IFS='|' read -r superuser holds passes <<<"$answer"
  if ! [[ "$superuser" =~ ^(yes|no)$ && "$holds" =~ ^[0-9]+$ && "$passes" =~ ^[0-9]+$ ]] ||
    [ "$(wc -l <<<"$answer")" -ne 1 ]; then
    WHY="the database answered something that is not the counts asked for, and that proves nothing"
    return 1
  fi
  if [ "$superuser" != yes ]; then
    WHY="the role psql connects as is not a superuser, so row security would hide the holds and the passes, and a count of them would mean nothing"
    return 1
  fi
  if [ "$holds" -gt 0 ]; then
    WHY="the deploy of ${took_tag} took at ${took}, and the hold that covered it is still on: lift it after looking (0132 T6 step 8)"
    return 1
  fi
  if [ "$passes" -eq 0 ]; then
    WHY="the deploy of ${took_tag} took at ${took} and its hold is lifted, but no pass that started after it has succeeded yet"
    return 1
  fi
  WHY="the deploy of ${took_tag} took at ${took} (deploys.log), the hold that covered it is lifted, and ${passes} pass(es) that started after it succeeded"
  return 0
}

# ----------------------------------------------------------------- deleting --

# delete_all — every entry in the directory, the directory kept. Checked
# afterwards: a delete that left something is not a delete (hard rule 9).
delete_all() {
  local left
  find "$COPY_DIR" -mindepth 1 -delete
  left="$(copy_files)"
  if [ -n "$left" ]; then
    fail "these are still in ${COPY_DIR} after the delete:" "${left//$'\n'/, }"
    return 1
  fi
}

# ------------------------------------------------------------------- taking --

# The entries that were in the directory before this run. On a failure, every
# other entry is removed: a copy is whole or it is not there.
BEFORE=()
DONE=''
remove_this_runs() {
  local f k mine
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    mine=1
    for k in ${BEFORE[@]+"${BEFORE[@]}"}; do
      if [ "$k" = "$f" ]; then mine=''; break; fi
    done
    [ -z "$mine" ] || rm -rf -- "${COPY_DIR:?}/${f}"
  done <<<"$(copy_files)"
}
on_exit() {
  [ -z "$DONE" ] || return 0
  remove_this_runs
  fail "nothing of this run was kept, and no copy was taken by it."
}
part_failed() {
  fail "$1"
  exit 1
}

# trigger_part — trigger-version.sh backup before-<tag>, which on live writes
# into this directory (it sources this file for its name) and verifies what it
# wrote.
trigger_part() {
  say "the task runner's database: trigger-version.sh backup before-${TAG}"
  "${SCRIPT_DIR}/trigger-version.sh" backup "before-${TAG}" >/dev/null ||
    part_failed "trigger-version.sh backup failed (above): the task runner's database is not in the copy, and nothing of this run was kept."
}

# has_trigger_part — whether the copy already holds the task runner's database.
has_trigger_part() {
  local f
  while IFS= read -r f; do
    case "$f" in triggerdb-*.sql.gz) return 0 ;; esac
  done <<<"$(copy_files)"
  return 1
}

take_new() {
  local taken epoch stamp app listing entries from commit f k line
  taken="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  epoch="$(date -u +%s)"
  mkdir -p "$COPY_DIR"
  chmod 700 "$COPY_DIR"
  mapfile -t BEFORE < <(copy_files)
  trap on_exit EXIT

  # The app's database, read back by the server's own pg_restore.
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  app="${COPY_DIR}/${DB_NAME}-${COMPOSE_PROJECT}-${stamp}.dump"
  [ ! -e "$app" ] || part_failed "$(basename "$app") exists already."
  say "the app's database: dumping '${DB_NAME}' from ${DB_CONTAINER}"
  docker exec "$DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom' sh "$DB_NAME" >"${app}.partial" ||
    part_failed "pg_dump of the app's database failed in ${DB_CONTAINER} (above); nothing of this run was kept."
  [ -s "${app}.partial" ] || part_failed "the app's database dumped to nothing; nothing of this run was kept."
  listing="$(docker exec -i "$DB_CONTAINER" pg_restore --list <"${app}.partial")" ||
    part_failed "the app's dump does not read back (pg_restore --list failed); nothing of this run was kept."
  entries="$(sed -n '/^;[[:space:]]*TOC Entries:/{s/^;[[:space:]]*TOC Entries:[[:space:]]*\([0-9]*\).*/\1/p;q;}' <<<"$listing")"
  if [ -z "$entries" ] || [ "$entries" -eq 0 ]; then
    part_failed "the app's dump reads back with no entries; nothing of this run was kept."
  fi
  mv -- "${app}.partial" "$app"
  say "  $(basename "$app"): ${entries} entries read back"

  # The sign-in service's database and the server's roles: dump-idp.sh, which
  # reads its dump back and writes its own note with the way back.
  say "the sign-in service's database and the roles: dump-idp.sh --dir <this directory>"
  "${SCRIPT_DIR}/dump-idp.sh" --dir "$COPY_DIR" ||
    part_failed "dump-idp.sh failed (above): the sign-in service's database is not in the copy, and nothing of this run was kept."

  [ -z "$TRIGGER" ] || trigger_part

  # The note, last: a directory with a note holds a whole copy.
  commit="$(git -C "$REPO_ROOT" rev-parse -q --verify HEAD 2>/dev/null)" || commit=''
  from="$(git -C "$REPO_ROOT" describe --tags --exact-match HEAD 2>/dev/null)" || from=''
  from="${from:-${commit:-unknown}}${commit:+ (${commit})}"
  {
    printf 'taken=%s\ntaken_epoch=%s\nbefore=%s\nfrom=%s\n\n' "$taken" "$epoch" "$TAG" "$from"
    cat <<EOF
THE COPY BEFORE AN UPDATE of the stack '${COMPOSE_PROJECT}', taken ${taken} by
deploy/compose/copy-before-update.sh, right before ${TAG}, with ${from} running.
It exists only to undo that update if it fails (workplan 0139, rec-copies (a)).

  Files:
EOF
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      [ "$f" != "$COPY_NOTE" ] || continue
      line="$(wc -c <"${COPY_DIR}/${f}" | tr -d ' ') bytes"
      for k in ${BEFORE[@]+"${BEFORE[@]}"}; do
        if [ "$k" = "$f" ]; then line="${line}, found here, made by hand before this copy"; break; fi
      done
      printf '    %s   %s\n' "$f" "$line"
    done <<<"$(copy_files)"
    cat <<EOF

THE RULE. It is deleted once the update is proven: a deploy logged as took in
deploys.log since it was taken, the hold that covered that deploy lifted, and
a pass that started after it succeeded. Then, from live's checkout:

    ./deploy/compose/copy-before-update.sh delete

It is never kept past day 7: the daily duties (box-duties.sh, copies) delete
it once it is older than ${COPY_EXPIRE_DAYS} days, proven or not. If the update is not
proven by day 6, roll back from it that day: docs/operator-runbook.md, "The
copy before an update". The sign-in service's part has its own note beside
it (the .txt dump-idp.sh wrote), with that part's way back.
EOF
  } >"${COPY_DIR}/${COPY_NOTE}.partial"
  mv -- "${COPY_DIR}/${COPY_NOTE}.partial" "${COPY_DIR}/${COPY_NOTE}"
  DONE=1
  trap - EXIT
  say "the copy before ${TAG} is taken, in ${COPY_DIR}:"
  while IFS= read -r f; do
    [ -z "$f" ] || say "  ${f}"
  done <<<"$(copy_files)"
  say "It goes once the update is proven (./deploy/compose/copy-before-update.sh delete), and after day ${COPY_EXPIRE_DAYS} whatever happens."
}

# ------------------------------------------------------------------ commands --

cmd_take() {
  local files taken before n f k mine parts
  files="$(copy_files)"
  if [ -f "${COPY_DIR}/${COPY_NOTE}" ]; then
    taken="$(note_value taken)"
    before="$(note_value before)"
    if prove; then
      refuse "the copy in ${COPY_DIR}, taken ${taken:-at a time its note does not say} before ${before:-a tag its note does not name}, belongs to an update that is proven: ${WHY}." \
        "One copy per update: delete it first (./deploy/compose/copy-before-update.sh delete), then run this again."
    fi
    say "a copy is here already, taken ${taken:-at a time its note does not say} before ${before:-a tag its note does not name}, on day $(copy_day) of at most 7, and its update is not proven: ${WHY}."
    say "It is the copy of what ran before, so it is kept, and no second copy is taken. It goes once the update is proven (./deploy/compose/copy-before-update.sh delete), and after day ${COPY_EXPIRE_DAYS} whatever happens."
    if [ -n "$TRIGGER" ] && ! has_trigger_part; then
      if [ -n "$DRY_RUN" ]; then
        say "dry run: ${TAG} moves the Trigger.dev pin, and the kept copy has no task runner's database: a take would add it. Nothing was written."
        return 0
      fi
      mapfile -t BEFORE < <(copy_files)
      trap on_exit EXIT
      trigger_part
      while IFS= read -r f; do
        case "$f" in
          triggerdb-*.sql.gz)
            mine=1
            for k in ${BEFORE[@]+"${BEFORE[@]}"}; do [ "$k" != "$f" ] || mine=''; done
            [ -z "$mine" ] ||
              printf '\nADDED %s, before %s, which moves the Trigger.dev pin: the task runner'"'"'s\ndatabase, %s.\n' \
                "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG" "$f" >>"${COPY_DIR}/${COPY_NOTE}"
            ;;
        esac
      done <<<"$(copy_files)"
      DONE=1
      trap - EXIT
      say "the task runner's database is added to the kept copy."
    elif [ -n "$DRY_RUN" ]; then
      say "dry run: nothing was written."
    fi
    return 0
  fi

  if [ -n "$DRY_RUN" ]; then
    n=0
    [ -z "$files" ] || n="$(wc -l <<<"$files")"
    parts="the app's database, the sign-in service's database and the roles"
    [ -z "$TRIGGER" ] || parts="${parts}, and the task runner's database (the tag moves the Trigger.dev pin)"
    say "dry run: a take would take the copy before ${TAG} into ${COPY_DIR}: ${parts}."
    [ "$n" -eq 0 ] || say "dry run: ${n} file(s) already there without a note, a dump by hand, would become part of it."
    say "dry run: nothing was written."
    return 0
  fi
  take_new
}

cmd_delete() {
  local files taken before
  files="$(copy_files)"
  if [ -z "$files" ]; then
    say "no copy in ${COPY_DIR}: nothing to delete."
    return 0
  fi
  if [ ! -f "${COPY_DIR}/${COPY_NOTE}" ]; then
    refuse "${COPY_DIR} holds files without a copy's note, so no update is theirs to prove: ${files//$'\n'/, }." \
      "They are a dump made by hand (on live dump-idp.sh and trigger-version.sh backup write here). The next copy takes them in, and the daily duties delete them after day ${COPY_EXPIRE_DAYS}; remove them by hand if you want them gone sooner."
  fi
  taken="$(note_value taken)"
  before="$(note_value before)"
  if ! prove; then
    refuse "the copy taken ${taken:-at a time its note does not say} before ${before:-a tag its note does not name} stays: its update is not proven: ${WHY}." \
      "It goes once it is, or after day ${COPY_EXPIRE_DAYS} (the daily duties). Not proven by day 6: roll back from it (docs/operator-runbook.md, \"The copy before an update\")."
  fi
  say "proven: ${WHY}."
  delete_all || refuse "the copy could not be deleted in full (above)."
  say "deleted the copy taken ${taken} before ${before}: ${files//$'\n'/, }."
}

cmd_expire() {
  local files oldest age day
  files="$(copy_files)"
  if [ -z "$files" ]; then
    say "no copy in ${COPY_DIR}: nothing to do."
    return 0
  fi
  oldest="$(copy_oldest_epoch)"
  age=$(($(date +%s) - oldest))
  if [ "$age" -gt $((COPY_EXPIRE_DAYS * 86400)) ]; then
    delete_all || {
      fail "the copy is older than ${COPY_EXPIRE_DAYS} days, and could not be deleted in full (above)."
      return 1
    }
    say "deleted the copy in ${COPY_DIR}, $((age / 86400)) days old: older than ${COPY_EXPIRE_DAYS} days, it goes whether or not its update was proven (never past day 7). Deleted: ${files//$'\n'/, }."
    return 0
  fi
  day=$((age / 86400 + 1))
  if [ "$day" -ge "$COPY_EXPIRE_DAYS" ]; then
    fail "day ${day}: the copy in ${COPY_DIR} is kept today, and the next run deletes it."
    fail "If its update is not proven, roll back from it today (docs/operator-runbook.md, \"The copy before an update\"). If it is, delete it now: ./deploy/compose/copy-before-update.sh delete"
    return 1
  fi
  say "the copy in ${COPY_DIR} is on day ${day} of at most 7: kept. It goes once its update is proven, and after day ${COPY_EXPIRE_DAYS} whatever happens."
}

case "$CMD" in
  take) cmd_take ;;
  delete) cmd_delete ;;
  expire) cmd_expire ;;
esac
