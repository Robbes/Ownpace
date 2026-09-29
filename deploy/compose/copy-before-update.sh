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
# else (both source this file for the directory's name). It is a DIRECTORY:
# find does not follow a symbolic link it is started on, so behind a link the
# backstop would see no copy and delete nothing. Every script that writes or
# deletes here refuses a link (mount a larger disk at the path instead).
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
# HOW OLD. The copy is as old as its note says. Every other file here, a dump
# by hand or one this copy found when it was taken, is as old as itself, and
# goes by its own age: a copy taken beside an old dump is not old with it.
#
# THE COMMANDS, from live's checkout:
#
#   copy-before-update.sh take [--dry-run] [--trigger] <tag>
#       deploy-live.sh runs it right before its checkout, with the hold on and
#       nothing in flight. It refuses first while the daily duties' timer
#       (ownpace-box-duties.timer, the user unit the bring-up installs) is not
#       active: nothing would delete what it takes. Then it applies the
#       backstop's rule (expire, below): what is past it goes. With no copy
#       here, it takes one. With a copy whose update is not proven, it keeps
#       that one and takes no other: it is the copy of what ran before, and a
#       deploy that did not take may already have migrated the database. With
#       --trigger it adds the task runner's database to a kept copy that lacks
#       it. It refuses a kept copy the next daily run deletes: the update after
#       it would have no copy from then on, so prove the previous update and
#       delete that copy, or roll back from it, first. The rollback's own
#       deploy, of the release the copy holds (its note's from=), goes ahead
#       and keeps it. With a copy whose update
#       IS proven, it refuses: one copy per update, delete that one first.
#       Files here without a note (a dump by hand) become part of the new copy.
#       A part that fails leaves nothing of that run behind, and what was here
#       before it as it was. --dry-run says which of these it would do,
#       refuses what it would refuse, and writes nothing, not even the
#       directory.
#   copy-before-update.sh delete
#       The operator's step, once the update is proven. It refuses unless all
#       three hold, each read, never assumed:
#         the LAST line deploys.log (deploy-live.sh's) has at or after the
#           moment the copy was taken says `took`: a deploy that did not take
#           after one that did leaves nothing proven, and the copy is of what
#           ran before both;
#         no hold that began at or before that line is still on (a hold for
#           the next update, begun after it, is not that one);
#         a pass (an initial copy or an incremental one) that started after
#           that line succeeded.
#       The database is read over the Postgres container's own socket, as the
#       owner the image created, which row security never binds; it checks
#       that, and every statement it sends is a SELECT. A database it cannot
#       read proves nothing. So does a note without its time.
#   copy-before-update.sh expire
#       box-duties.sh's daily backstop. It deletes the copy once its note is
#       older than 6 days less an hour, proven or not, and each other file here
#       once that file is: a run that starts late (the token duty before it
#       takes up to 20 minutes, the timer a minute) still deletes a copy before
#       its seventh day ends, so it is never kept past day 7. The run before the
#       one that deletes it keeps it and fails, saying to roll back from it
#       today if its update is not proven (docs/operator-runbook.md, "The copy
#       before an update"), or to delete it. It reads no database and makes no
#       dump.
#   copy-before-update.sh since
#       The rollback's first step, run with the stack's services stopped and
#       before the restore. It reads, from the database the copy is about to
#       replace, what a rollback would bring back that was erased, closed,
#       reopened or deleted after the copy: every organisation with its status
#       and its closure, every erasure record, the ids of every connection,
#       migration, person and membership, and each grant withdrawn. It writes
#       them into this directory as since-the-copy-<stamp>.sql, SQL that does
#       it all again in the restored database, in one transaction, and prints
#       the sign-in accounts to remove again. Every statement it sends is a
#       SELECT; the file holds ids and dates, no name, address or credential.
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
#         ./deploy/compose/copy-before-update.sh since
# Exit:   0 done, kept, or nothing to do; 1 refused, or a part of a take
#         failed (nothing of that run is left), or expire on the copy's last
#         day; 2 usage.
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
# Older than this many days, less COPY_MARGIN_SECONDS, the backstop deletes
# the copy, proven or not. The margin is for a daily run that starts late: the
# token duty before it takes up to BOX_DUTY_TIMEOUT (20 minutes), the timer a
# minute. With it, a copy is gone before its seventh day ends.
COPY_EXPIRE_DAYS=6
COPY_MARGIN_SECONDS=3600
COPY_EXPIRE_AFTER=$((COPY_EXPIRE_DAYS * 86400 - COPY_MARGIN_SECONDS))
# Older than this, the next daily run deletes the copy: its last day.
COPY_LAST_DAY_AFTER=$((COPY_EXPIRE_AFTER - 86400))
# The timer that runs that backstop (deploy/compose/systemd/), a user unit.
COPY_BACKSTOP_TIMER=ownpace-box-duties.timer

# copy_before_update_dir — the one directory of the copy, for the project the
# caller set in COMPOSE_PROJECT (the reader's, env-read.sh).
copy_before_update_dir() {
  printf '%s' "${HOME}/.persistent/${COMPOSE_PROJECT}/copy-before-update"
}

# copy_before_update_link_refusal — the sentence every script that writes or
# deletes in the directory refuses a symbolic link there with.
copy_before_update_link_refusal() {
  printf '%s' "$(copy_before_update_dir) is a symbolic link. The copy's directory is a directory on this machine's persistent storage: the daily backstop does not follow a link, so what went through it would never be deleted, and the promise that a copy goes after day 6 would not hold. Replace the link with a directory (mount a larger disk at that path if you need the room). Nothing was written."
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
       ./deploy/compose/copy-before-update.sh since
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
  delete | expire | since)
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
[ ! -L "$COPY_DIR" ] || refuse "$(copy_before_update_link_refusal)"
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

# copy_epoch — the copy's age, as the second it began: the time its note
# says it was taken, or the note's own time, whichever is older. Nothing when
# there is no note.
copy_epoch() {
  local taken mtime
  [ -f "${COPY_DIR}/${COPY_NOTE}" ] || return 0
  mtime="$(stat -c '%Y' -- "${COPY_DIR}/${COPY_NOTE}")"
  taken="$(note_value taken_epoch)"
  if [[ "$taken" =~ ^[0-9]+$ ]] && [ "$taken" -lt "$mtime" ]; then
    printf '%s' "$taken"
  else
    printf '%s' "$mtime"
  fi
}

# copy_day <age in seconds> — which day of its life that is: 1 for its first
# 24 hours.
copy_day() {
  printf '%s' "$(($1 / 86400 + 1))"
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
  local taken line took took_tag outcome answer superuser holds passes
  taken="$(note_value taken)"
  if ! [[ "$taken" =~ $ISO_RE ]]; then
    WHY="the note (${COPY_NOTE}) does not say when the copy was taken, so no deploy can be shown to have taken after it"
    return 1
  fi
  if [ ! -e "$DEPLOY_LOG" ]; then
    WHY="there is no ${DEPLOY_LOG}, so no deploy has taken since the copy was taken, ${taken}"
    return 1
  fi
  # The LAST deploy since the copy, of either outcome: a did-not-take after a
  # took leaves nothing proven, whatever the hold and the passes say since,
  # because what runs now is the checkout that did not take.
  if ! line="$(awk -F '\t' -v since="$taken" '$1 >= since && ($4 == "took" || $4 == "did-not-take") { l = $1 "\t" $2 "\t" $4 } END { if (l != "") print l }' "$DEPLOY_LOG")"; then
    WHY="${DEPLOY_LOG} could not be read (above)"
    return 1
  fi
  if [ -z "$line" ]; then
    WHY="no deploy has taken since the copy was taken, ${taken}: ${DEPLOY_LOG} has no took line at or after it"
    return 1
  fi
  IFS=$'\t' read -r took took_tag outcome <<<"$line"
  if ! [[ "$took" =~ $ISO_RE ]]; then
    WHY="the last line in ${DEPLOY_LOG} since the copy does not start with a time in deploy-live.sh's format"
    return 1
  fi
  if [ "$outcome" != took ]; then
    WHY="the last deploy since the copy was taken, of ${took_tag} at ${took}, did not take (${DEPLOY_LOG}): what runs now is that checkout, and the copy is of what ran before it. It is proven only once a deploy since takes, its hold is lifted and a pass after it succeeds"
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

# expire_due <dry> — the backstop's rule, applied: the whole copy once its
# note is older than COPY_EXPIRE_AFTER, and else each entry that is, by its
# own time. A copy's own files are no older than its note, so only a file
# that is not the copy's own (a dump by hand, or one the copy found when it
# was taken) goes alone. With <dry> set it says what it would delete and
# deletes nothing. Sets EXPIRED to what went (or would go), and EXPIRED_COPY
# when that was the whole copy. Returns 1 when a delete left something.
EXPIRED=''
EXPIRED_COPY=''
expire_due() {
  local dry="$1" now epoch listing mtime name left=''
  EXPIRED=''
  EXPIRED_COPY=''
  [ -d "$COPY_DIR" ] || return 0
  now="$(date +%s)"
  epoch="$(copy_epoch)"
  if [ -n "$epoch" ] && [ $((now - epoch)) -gt "$COPY_EXPIRE_AFTER" ]; then
    EXPIRED="$(copy_files)"
    EXPIRED_COPY=1
    [ -n "$dry" ] || delete_all || return 1
    return 0
  fi
  listing="$(find "$COPY_DIR" -mindepth 1 -maxdepth 1 -printf '%T@ %f\n' | LC_ALL=C sort -k2)"
  while read -r mtime name; do
    [ -n "$name" ] || continue
    mtime="${mtime%%.*}"
    [ $((now - mtime)) -gt "$COPY_EXPIRE_AFTER" ] || continue
    EXPIRED="${EXPIRED:+${EXPIRED}$'\n'}${name}"
    [ -n "$dry" ] || rm -rf -- "${COPY_DIR:?}/${name}"
    if [ -z "$dry" ] && [ -e "${COPY_DIR}/${name}" ]; then left="${left:+${left}, }${name}"; fi
  done <<<"$listing"
  if [ -n "$left" ]; then
    fail "these are still in ${COPY_DIR} after the delete: ${left}"
    return 1
  fi
}

# the_timer_runs — whether the daily duties' timer is active for this account:
# without it nothing deletes a copy, and a copy taken would outlive the
# promise. Asked of the user manager, the account's own.
the_timer_runs() {
  systemctl --user is-active --quiet "$COPY_BACKSTOP_TIMER"
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

THE RULE. It is deleted once the update is proven: the last deploy logged in
deploys.log since it was taken took, the hold that covered that deploy is
lifted, and a pass that started after it succeeded. Then, from live's
checkout:

    ./deploy/compose/copy-before-update.sh delete

It is never kept past day 7: the daily duties (box-duties.sh, copies) delete
it once it is older than ${COPY_EXPIRE_DAYS} days less an hour, proven or not. If the
update is not proven by day 6, roll back from it that day, starting with
./deploy/compose/copy-before-update.sh since: docs/operator-runbook.md, "The
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
  local files taken before from n parts age f k mine
  # Nothing may be taken that nothing deletes.
  if ! the_timer_runs; then
    refuse "the daily duties' timer, ${COPY_BACKSTOP_TIMER}, is not active for this account (systemctl --user is-active ${COPY_BACKSTOP_TIMER}). It runs the backstop that deletes a copy after day 6; without it a copy taken now would outlive the promise that it is never kept past day 7." \
      "Install and enable it (docs/managed-bring-up.md, \"Live's daily duties\"), as the account that owns live's checkout, from a session of its own, then run this again. Nothing was written."
  fi

  # The backstop's rule first: what it would delete today goes, or, in a dry
  # run, would go.
  expire_due "$DRY_RUN" || refuse "what the backstop's rule deletes could not be deleted in full (above)."
  if [ -n "$EXPIRED" ]; then
    if [ -n "$DRY_RUN" ]; then
      say "dry run: older than ${COPY_EXPIRE_DAYS} days less an hour, as the daily backstop would, a take would delete first: ${EXPIRED//$'\n'/, }."
    else
      say "older than ${COPY_EXPIRE_DAYS} days less an hour, deleted first, as the daily backstop would, whether or not an update was proven: ${EXPIRED//$'\n'/, }."
    fi
  fi

  files="$(copy_files)"
  if [ -f "${COPY_DIR}/${COPY_NOTE}" ] && [ -z "$EXPIRED_COPY" ]; then
    taken="$(note_value taken)"
    before="$(note_value before)"
    if prove; then
      refuse "the copy in ${COPY_DIR}, taken ${taken:-at a time its note does not say} before ${before:-a tag its note does not name}, belongs to an update that is proven: ${WHY}." \
        "One copy per update: delete it first (./deploy/compose/copy-before-update.sh delete), then run this again."
    fi
    age=$(($(date +%s) - $(copy_epoch)))
    from="$(note_value from)"
    # The rollback deploys the release the copy holds, its note's from=: the
    # databases are the copy's again, so that is no new update, and refusing
    # it would leave them under the code of the update rolled back from.
    if [ "$age" -gt "$COPY_LAST_DAY_AFTER" ] && [ "$TAG" = "${from%% (*}" ]; then
      say "the copy in ${COPY_DIR} is on day $(copy_day "$age"), its last, and ${TAG} is the release it holds (from=): the rollback's deploy. The copy is kept for it."
    elif [ "$age" -gt "$COPY_LAST_DAY_AFTER" ]; then
      refuse "the copy in ${COPY_DIR}, taken ${taken:-at a time its note does not say} before ${before:-a tag its note does not name}, is on day $(copy_day "$age"), and the next daily run deletes it, proven or not. Its update is not proven: ${WHY}." \
        "Kept for this update too, it would be gone before this update could be proven, and this update would have no copy from then on." \
        "First prove the previous update and delete its copy (./deploy/compose/copy-before-update.sh delete), or roll back from it (docs/operator-runbook.md, \"The copy before an update\"), whose deploy of ${from:-the release it holds} this lets through. Then run this again."
    fi
    say "a copy is here already, taken ${taken:-at a time its note does not say} before ${before:-a tag its note does not name}, on day $(copy_day "$age") of at most 7, and its update is not proven: ${WHY}."
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
    # What a take would find: what is here, less what the rule deletes first.
    n=0
    if [ -n "$EXPIRED_COPY" ]; then
      files=''
    elif [ -n "$EXPIRED" ]; then
      files="$(LC_ALL=C comm -23 <(printf '%s\n' "$files") <(printf '%s\n' "$EXPIRED" | LC_ALL=C sort))"
    fi
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
  local files age day
  files="$(copy_files)"
  if [ -z "$files" ]; then
    say "no copy in ${COPY_DIR}: nothing to do."
    return 0
  fi
  if ! expire_due ''; then
    fail "what is older than ${COPY_EXPIRE_DAYS} days less an hour could not be deleted in full (above)."
    return 1
  fi
  if [ -n "$EXPIRED_COPY" ]; then
    say "deleted the copy in ${COPY_DIR}: older than ${COPY_EXPIRE_DAYS} days less an hour, it goes whether or not its update was proven, so it is never kept past day 7. Deleted: ${EXPIRED//$'\n'/, }."
    return 0
  fi
  [ -z "$EXPIRED" ] ||
    say "deleted from ${COPY_DIR}, each older than ${COPY_EXPIRE_DAYS} days less an hour by its own time: ${EXPIRED//$'\n'/, }."
  if [ ! -f "${COPY_DIR}/${COPY_NOTE}" ]; then
    files="$(copy_files)"
    if [ -n "$files" ]; then
      say "kept, each until it is older than ${COPY_EXPIRE_DAYS} days less an hour: ${files//$'\n'/, } (no copy's note: a dump by hand)."
    else
      say "nothing else in ${COPY_DIR}."
    fi
    return 0
  fi
  age=$(($(date +%s) - $(copy_epoch)))
  day="$(copy_day "$age")"
  if [ "$age" -gt "$COPY_LAST_DAY_AFTER" ]; then
    fail "day ${day}: the copy in ${COPY_DIR} is kept today, and the next daily run deletes it."
    fail "If its update is not proven, roll back from it today (docs/operator-runbook.md, \"The copy before an update\"). If it is, delete it now: ./deploy/compose/copy-before-update.sh delete"
    return 1
  fi
  say "the copy in ${COPY_DIR} is on day ${day} of at most 7: kept. It goes once its update is proven, and after day ${COPY_EXPIRE_DAYS} whatever happens."
}

# -------------------------------------------------------------------- since --

# since_read <sql> — one value, read as the owner over the Postgres
# container's own socket. Every statement it is given is a SELECT.
since_read() {
  docker exec -i "$DB_CONTAINER" sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"' sh "$DB_NAME" <<<"$1"
}

# since_part <what> <sql> — one part of the file's data: nothing, or the rows
# of one VALUES list, each `  (...)`. Refuses what is neither: a list read in
# part would do again only part of what changed.
since_part() {
  local out
  out="$(since_read "$2")" ||
    refuse "the database could not be read for ${1} (above). Nothing was written."
  if [ -n "$out" ] && [ "${out:0:3}" != '  (' ]; then
    refuse "the database answered something that is not ${1}. Nothing was written."
  fi
  printf '%s' "$out"
}

# since_ts <column> — that timestamptz as text that reads back exactly on any
# server, whatever its DateStyle: ISO 8601 in UTC, to the microsecond.
since_ts() {
  printf "to_char(%s AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')" "$1"
}

cmd_since() {
  local taken before answer has_person people='' tenants erasures kept withdrawn stamp when out
  [ -f "${COPY_DIR}/${COPY_NOTE}" ] ||
    refuse "no copy's note in ${COPY_DIR}: there is no copy to roll back to, and so nothing to write down since. Nothing was written."
  taken="$(note_value taken)"
  before="$(note_value before)"
  [[ "$taken" =~ $ISO_RE ]] ||
    refuse "the note (${COPY_NOTE}) does not say when the copy was taken. Nothing was written."

  answer="$(since_read "SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'yes' ELSE 'no' END FROM pg_roles WHERE rolname = current_user;")" ||
    refuse "the database could not be read (above). Nothing was written."
  [ "$answer" = yes ] ||
    refuse "the role psql connects as is not a superuser, so row security would hide organisations, and a list without them would have them erased again after the rollback. Nothing was written."
  has_person="$(since_read "SELECT CASE WHEN to_regclass('public.person') IS NULL THEN 'no' ELSE 'yes' END;")" ||
    refuse "the database could not be read (above). Nothing was written."
  [ "$has_person" != yes ] ||
    people=", (SELECT string_agg(format('  (%L, %L)', 'person', id), E',\n' ORDER BY id) FROM person)"

  tenants="$(since_part 'the organisations' "SELECT string_agg(format('  (%L::uuid, %L, %L::timestamptz, %L::timestamptz, %L)', t.id, t.status, $(since_ts c.closed_at), $(since_ts c.purge_after), c.closed_by), E',\n' ORDER BY t.id) FROM tenant t LEFT JOIN tenant_closure c ON c.tenant_id = t.id;")"
  erasures="$(since_part 'the erasure records' "SELECT string_agg(format('  (%L::uuid, %L, %L::timestamptz, %L::integer, %L::integer, %L::timestamptz, %L::timestamptz, %L::uuid[], %L::jsonb, %L::jsonb, %L::timestamptz)', id, tenant_ref, $(since_ts requested_at), window_days, backup_retention_days, $(since_ts backups_expire_at), $(since_ts purged_at), retained_invoice_ids, revocations, purged_counts, $(since_ts created_at)), E',\n' ORDER BY created_at, id) FROM erasure_record;")"
  kept="$(since_part 'what is kept' "SELECT concat_ws(E',\n', (SELECT string_agg(format('  (%L, %L)', 'connection', id), E',\n' ORDER BY id) FROM connection), (SELECT string_agg(format('  (%L, %L)', 'mailbox_mapping', id), E',\n' ORDER BY id) FROM mailbox_mapping), (SELECT string_agg(format('  (%L, %L)', 'tenant_member', tenant_id::text || ' ' || user_id), E',\n' ORDER BY tenant_id, user_id) FROM tenant_member)${people});")"
  withdrawn="$(since_part 'the grants withdrawn' "SELECT string_agg(format('  (%L::uuid, %L::timestamptz)', id, $(since_ts grant_withdrawn_at)), E',\n' ORDER BY id) FROM mailbox_mapping WHERE source_secret_ref IS NULL AND grant_withdrawn_at IS NOT NULL;")"

  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  when="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  out="${COPY_DIR}/since-the-copy-${stamp}.sql"
  [ ! -e "$out" ] || refuse "$(basename "$out") exists already. Nothing was written."
  {
    cat <<HEAD
-- THE ROLLBACK FROM THE COPY BEFORE AN UPDATE: what changed after the copy,
-- done again in the restored app database. Written ${when} by
-- deploy/compose/copy-before-update.sh since, from '${DB_NAME}' in ${DB_CONTAINER},
-- for the copy taken ${taken} before ${before:-a tag its note does not name}
-- (docs/operator-runbook.md, "The copy before an update").
--
-- Apply it once, AFTER the app's database is restored from the copy and BEFORE
-- the stack comes back, as the owner, from live's checkout:
--
--   docker exec -i ${DB_CONTAINER} sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "\$POSTGRES_USER" -d ${DB_NAME}' < $(basename "$out")
--
-- One transaction: an error stops it, and nothing it did stays. It refuses a
-- database none of whose organisations it lists. It prints what it did, and,
-- last, the sign-in accounts to remove again once the hourly purge has erased
-- the organisations in 1.
--
-- What it does again: organisations erased since are closed and due at once,
-- for the hourly purge (managed-purge-closed); every other organisation's
-- status and closure are as they were when this was written; the erasure
-- records are all of them; connections, migrations, people and memberships
-- deleted since are deleted again; a grant withdrawn since loses its token
-- again. Everything else testers did after the copy is lost with the rollback.
--
-- It holds ids and dates: no name, address or credential. It is part of the
-- copy, and goes with it.

BEGIN;

CREATE TEMP TABLE since_tenant (id uuid PRIMARY KEY, status text NOT NULL, closed_at timestamptz, purge_after timestamptz, closed_by text) ON COMMIT DROP;
CREATE TEMP TABLE since_erasure (id uuid PRIMARY KEY, tenant_ref text NOT NULL, requested_at timestamptz NOT NULL, window_days integer NOT NULL, backup_retention_days integer, backups_expire_at timestamptz, purged_at timestamptz, retained_invoice_ids uuid[] NOT NULL, revocations jsonb NOT NULL, purged_counts jsonb NOT NULL, created_at timestamptz NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE since_kept (kind text NOT NULL, key text NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE since_withdrawn (id uuid PRIMARY KEY, at timestamptz NOT NULL) ON COMMIT DROP;
HEAD
    [ -z "$tenants" ] || printf '\n-- Every organisation when this was written.\nINSERT INTO since_tenant (id, status, closed_at, purge_after, closed_by) VALUES\n%s;\n' "$tenants"
    [ -z "$erasures" ] || printf '\n-- Every erasure record when this was written.\nINSERT INTO since_erasure (id, tenant_ref, requested_at, window_days, backup_retention_days, backups_expire_at, purged_at, retained_invoice_ids, revocations, purged_counts, created_at) VALUES\n%s;\n' "$erasures"
    [ -z "$kept" ] || printf '\n-- Every connection, migration and membership%s when this was written.\nINSERT INTO since_kept (kind, key) VALUES\n%s;\n' "${people:+, and every person}" "$kept"
    [ -z "$withdrawn" ] || printf '\n-- Every migration whose granted token was withdrawn, and when.\nINSERT INTO since_withdrawn (id, at) VALUES\n%s;\n' "$withdrawn"
    cat <<'CHECK'

-- The database this is applied to must be the one the copy was taken from.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM since_tenant) AND EXISTS (SELECT 1 FROM tenant)
     AND NOT EXISTS (SELECT 1 FROM tenant t JOIN since_tenant s ON s.id = t.id) THEN
    RAISE EXCEPTION 'none of the organisations this file lists is in this database, so it is not the database the copy was taken from. Nothing was changed.';
  END IF;
END
$check$;

-- 1. Organisations erased since the copy, back with the restore: closed, and
--    due at once, so that the hourly purge erases them again. The closure
--    keeps the time the erasure was asked for, where its record says it.
CREATE TEMP TABLE since_erased ON COMMIT DROP AS
  SELECT t.id FROM tenant t WHERE NOT EXISTS (SELECT 1 FROM since_tenant s WHERE s.id = t.id);
-- The sign-in accounts to remove again, read before the memberships go.
CREATE TEMP TABLE since_subjects ON COMMIT DROP AS
  SELECT DISTINCT m.user_id FROM tenant_member m
   WHERE m.tenant_id IN (SELECT id FROM since_erased)
      OR (m.tenant_id IN (SELECT id FROM since_tenant)
          AND NOT EXISTS (SELECT 1 FROM since_kept k
                           WHERE k.kind = 'tenant_member' AND k.key = m.tenant_id::text || ' ' || m.user_id));
UPDATE tenant SET status = 'closed' WHERE id IN (SELECT id FROM since_erased);
INSERT INTO tenant_closure (tenant_id, closed_at, purge_after, closed_by)
  SELECT e.id,
         coalesce((SELECT min(r.requested_at) FROM since_erasure r
                    WHERE r.tenant_ref = encode(sha256(convert_to(e.id::text, 'UTF8')), 'hex')), now()),
         now(), 'the rollback from the copy before an update'
    FROM since_erased e
  ON CONFLICT (tenant_id) DO UPDATE SET purge_after = least(tenant_closure.purge_after, EXCLUDED.purge_after);

-- 2. Every other organisation: its status and its closure as they were when
--    this was written. Closed since: closed, with the dates it was given.
--    Reopened since: open, and nothing scheduled.
UPDATE tenant t SET status = s.status FROM since_tenant s WHERE s.id = t.id AND t.status IS DISTINCT FROM s.status;
DELETE FROM tenant_closure c USING since_tenant s WHERE s.id = c.tenant_id AND s.closed_at IS NULL;
INSERT INTO tenant_closure (tenant_id, closed_at, purge_after, closed_by)
  SELECT s.id, s.closed_at, s.purge_after, s.closed_by FROM since_tenant s JOIN tenant t ON t.id = s.id
   WHERE s.closed_at IS NOT NULL
  ON CONFLICT (tenant_id) DO UPDATE
     SET closed_at = EXCLUDED.closed_at, purge_after = EXCLUDED.purge_after, closed_by = EXCLUDED.closed_by;

-- 3. The erasure records, all of them: nothing deletes one, so the copy's are
--    a part of these, and each says what it said when this was written.
INSERT INTO erasure_record (id, tenant_ref, requested_at, window_days, backup_retention_days, backups_expire_at,
                            purged_at, retained_invoice_ids, revocations, purged_counts, created_at)
  SELECT id, tenant_ref, requested_at, window_days, backup_retention_days, backups_expire_at,
         purged_at, retained_invoice_ids, revocations, purged_counts, created_at
    FROM since_erasure
  ON CONFLICT (id) DO UPDATE
     SET tenant_ref = EXCLUDED.tenant_ref, requested_at = EXCLUDED.requested_at, window_days = EXCLUDED.window_days,
         backup_retention_days = EXCLUDED.backup_retention_days, backups_expire_at = EXCLUDED.backups_expire_at,
         purged_at = EXCLUDED.purged_at, retained_invoice_ids = EXCLUDED.retained_invoice_ids,
         revocations = EXCLUDED.revocations, purged_counts = EXCLUDED.purged_counts, created_at = EXCLUDED.created_at;

-- 4. Deleted since the copy, in the organisations still here, deleted again:
--    migrations, then connections (and the access each held), then people,
--    then memberships. The erased organisations go whole with the purge.
DELETE FROM mailbox_mapping m USING since_tenant s
 WHERE s.id = m.tenant_id
   AND NOT EXISTS (SELECT 1 FROM since_kept k WHERE k.kind = 'mailbox_mapping' AND k.key = m.id::text);
DELETE FROM connection c USING since_tenant s
 WHERE s.id = c.tenant_id
   AND NOT EXISTS (SELECT 1 FROM since_kept k WHERE k.kind = 'connection' AND k.key = c.id::text);
CHECK
    # Only when the people were listed: a table this did not list is left as
    # the restore made it, never emptied.
    if [ -n "$people" ]; then
      cat <<'PEOPLE'
DO $people$
BEGIN
  IF to_regclass('public.person') IS NOT NULL THEN
    DELETE FROM person p USING since_tenant s
     WHERE s.id = p.tenant_id
       AND NOT EXISTS (SELECT 1 FROM since_kept k WHERE k.kind = 'person' AND k.key = p.id::text);
  END IF;
END
$people$;
PEOPLE
    fi
    cat <<'TAIL'
DELETE FROM tenant_member m USING since_tenant s
 WHERE s.id = m.tenant_id
   AND NOT EXISTS (SELECT 1 FROM since_kept k
                    WHERE k.kind = 'tenant_member' AND k.key = m.tenant_id::text || ' ' || m.user_id);

-- 5. A grant withdrawn since the copy: its token gone again, and the
--    withdrawal as it was.
UPDATE mailbox_mapping m SET source_secret_ref = NULL, grant_withdrawn_at = w.at
  FROM since_withdrawn w
 WHERE w.id = m.id AND (m.source_secret_ref IS NOT NULL OR m.grant_withdrawn_at IS DISTINCT FROM w.at);

-- What it did, and the sign-in accounts to remove again once the hourly purge
-- has erased the organisations in 1 (idp-strays.sh refuses one that still
-- belongs somewhere).
SELECT format('since: %s organisation(s) erased after the copy are closed and due; the hourly purge erases them again.', count(*)) FROM since_erased;
SELECT './deploy/compose/idp-strays.sh --subject ' || user_id || ' --remove' FROM since_subjects ORDER BY 1;

COMMIT;
TAIL
  } >"${out}.partial" || {
    rm -f -- "${out}.partial"
    refuse "$(basename "$out") could not be written. Nothing was written."
  }
  mv -- "${out}.partial" "$out"
  say "written: ${out}"
  say "It holds what was erased, closed, reopened or deleted after the copy taken ${taken}. Apply it to the app's database once that is restored from the copy, before the stack comes back:"
  say "  docker exec -i ${DB_CONTAINER} sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d ${DB_NAME}' < ${out}"
  say "(docs/operator-runbook.md, \"The copy before an update\"). It goes with the copy."
}

case "$CMD" in
  take) cmd_take ;;
  delete) cmd_delete ;;
  expire) cmd_expire ;;
  since) cmd_since ;;
esac
