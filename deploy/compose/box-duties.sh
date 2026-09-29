#!/usr/bin/env bash
# box-duties.sh — what the nightly gate does for the OTA stack, done daily for
# live (workplan 0132 T7).
#
# THE GATE KEEPS THE OTA STACK ALIVE AS A SIDE EFFECT OF TESTING IT. Two of
# e2e-managed.yml's steps are maintenance, not tests: `setup-zitadel.sh` runs
# the identity provider's provisioning token's clock (the token lives seven
# days and a run replaces it in its last three; past its deadline no successor
# can be minted, because minting needs the token that died), and
# `trigger-version.sh drill` dumps the Trigger.dev database and proves the
# dump loads. Live never meets CI (T1g), so nothing did either for it.
#
# THE DRILL IS NOT LIVE'S (workplan 0139; the owner's answer rec-drill (a),
# 2026-09-28). It stays on the test stack, in the gate. Here it kept a daily
# dump of live's task runner database, the newest seven, and live keeps one
# copy of its databases, made right before an update and deleted once the
# update is proven, never past day 7 (the privacy policy's §9). That copy's
# backstop is the second duty instead.
#
# This runs six duties, from live's checkout (`~/ownpace-live`), once a day on
# a systemd timer (the units are in deploy/compose/systemd/, the install steps
# in docs/managed-bring-up.md, "Live's daily duties"):
#
#   token          setup-zitadel.sh --token-only: the token's clock, and nothing
#                  else. The full script also reconciles the provider's
#                  configuration, which 0135 hardens, and a timer must not do
#                  that behind the owner's back.
#   copies         copy-before-update.sh expire (workplan 0139, rec-copies
#                  (a)): the copy made before an update, in
#                  ~/.persistent/<project>/copy-before-update, is deleted once
#                  it is older than 6 days less an hour, proven or not, and a
#                  dump by hand there once it is, so a copy is never kept past
#                  day 7: the hour is for this run starting late, after the
#                  token duty's up to 20 minutes. The run before the one that
#                  deletes it keeps it and fails the duty, saying to roll back
#                  from it or delete it. It reads no database. The copy is
#                  SECRET-BEARING (testers' data, the provider's password
#                  hashes): this script never prints what is in it, and makes
#                  every file the duties write readable by this account alone
#                  (umask 077). Without this timer active,
#                  copy-before-update.sh take refuses, so no deploy takes a
#                  copy nothing would delete.
#   exposure       exposure-check.sh (0132 T3 (b)): every port any container on
#                  the machine publishes, both stacks at once. Outside the
#                  appliance nightly's hours, whose dev Nextcloud publishes on
#                  every interface while it runs; the timer's time says how.
#   organisations  setup-zitadel.sh --count-organisations (0135 T3): read-only,
#                  and a count that is not one fails the duty.
#   site           www-live.sh check (0139 T10): read-only. Fails when a
#                  container of live's project has the compose service `www`,
#                  where a bare `docker compose -f www.yml` in live's checkout
#                  puts the site and one --remove-orphans removes live or the
#                  site; and, when live's .env says WWW_LIVE=true, when
#                  live's copy of www.ownpace.eu (the project <project>-www)
#                  is not running and healthy.
#   strays         idp-strays.sh --remove --at-most 20 (0135 T8): the sign-in
#                  accounts nobody let in, older than 30 days, removed, which
#                  privacy §9 promises. More than 20 in one run removes none and
#                  fails the duty, so a person looks at them first. Its lines
#                  name an account's id, never its address.
#
# EACH DUTY RUNS WHATEVER THE ONE BEFORE IT DID. The token goes first, so the
# count asks with a token that is alive. A duty that fails, is missing from the
# checkout, or runs past BOX_DUTY_TIMEOUT seconds (default 1200) is recorded,
# and the next one starts. At the end the script names every duty that failed
# and exits 1; all six passing is exit 0. Nobody is told when it fails
# (0142 is where that changes); the journal has it.
#
# STOPPED IS STOPPED. `timeout` puts the duty in a process group of its own,
# so a terminal's Ctrl-C, which goes to the foreground group, reaches this
# script and never the duty. Left there, the duty ran on and the next duty
# started, the backstop on live's copy among them. So a SIGINT or SIGTERM to
# this script sends SIGTERM to the running duty's group (timeout gives it ten
# seconds, then kills it), waits for it and for its last words, says which
# duty was interrupted, and exits 130 or 143 without starting another.
# Under systemd, `systemctl stop` signals every process of the unit at once.
#
# THE JOURNAL, through systemd. Plain stdout and stderr, which the service
# unit hands to the journal under SyslogIdentifier=ownpace-box-duties, rather
# than `logger`, so a run by hand shows the same lines in the terminal. When
# stderr is the journal's stream (the one JOURNAL_STREAM names), a failure
# line starts with `<3>`, which journald reads as the error priority, so
# `journalctl -p err` finds it.
#
# LIVE'S DUTIES ONLY. It refuses, before any duty, a `.env` that does not carry
# live's marker exactly (stack_is_live, stack-kind.sh). The OTA stack's duties
# are the gate's, every night: from its checkout this would fail a count 0135
# T3 says only warns there, and the copy's backstop refuses the OTA stack's
# .env itself. And the reader of the project (compose_project) must
# agree, so a shell that exported the other stack's name is refused too.
#
# NOTHING SECRET, NO ADDRESS. It prints duty names, the project and what each
# duty says, with this machine's own addresses replaced by the key that holds
# them (own-addresses.sh). It never prints a value from the .env, and names a
# key when it refuses. Nothing that runs this may use `set -x`.
#
# Usage:  ./deploy/compose/box-duties.sh      (no arguments)
# Exit:   0 every duty passed; 1 one or more failed, each named; 2 refused
#         before any duty ran (not live's .env, the project, an argument);
#         130 or 143 interrupted by SIGINT or SIGTERM, no later duty started.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# Live's marker, named once.
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"
# shellcheck source=deploy/compose/own-addresses.sh
. "${SCRIPT_DIR}/own-addresses.sh"

ENV_FILE="${SCRIPT_DIR}/.env"

say() { echo "[box-duties] $*"; }

# IS STDERR THE JOURNAL? systemd sets JOURNAL_STREAM to the device and inode of
# the stream it connected, and a shell started from a unit inherits the variable
# with a terminal on stderr. So the stream itself is compared, as systemd's
# documentation asks; fd 3 is stderr, looked at before stat's own is silenced.
TO_JOURNAL=""
if [ -n "${JOURNAL_STREAM:-}" ] &&
   [ "$(stat -L -c '%d:%i' /dev/fd/3 3>&2 2>/dev/null)" = "$JOURNAL_STREAM" ]; then
  TO_JOURNAL=1
fi
# A failure, at the journal's error priority when systemd is listening.
fail_line() {
  if [ -n "$TO_JOURNAL" ]; then
    echo "<3>[box-duties] $*" >&2
  else
    echo "[box-duties] $*" >&2
  fi
}
refuse() {
  fail_line "REFUSED: $*"
  fail_line "No duty ran."
  exit 2
}

# ---------------------------------------------------------------- before any duty --

[ "$#" -eq 0 ] || refuse "this script takes no arguments (got '${1}'). Usage: box-duties.sh"

BOX_DUTY_TIMEOUT="${BOX_DUTY_TIMEOUT:-1200}"
[[ "$BOX_DUTY_TIMEOUT" =~ ^[1-9][0-9]*$ ]] ||
  refuse "BOX_DUTY_TIMEOUT must be a whole number of seconds"

[ -f "$ENV_FILE" ] || refuse "no .env beside this script (${ENV_FILE}). These are live's duties, run from live's checkout."

stack_is_live "$ENV_FILE" ||
  refuse "${ENV_FILE} does not carry ${STACK_KIND_KEY} with live's value (workplan 0132 T7). These are live's duties; the OTA stack's are the nightly gate's. Its value, if any, is not printed."

# Prints its own reason when it refuses (env-read.sh).
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" ||
  refuse "the project this checkout drives could not be settled (the reason is above)"

# NO DUTY TAKES A DIRECTORY OR A CONTAINER FROM THE SHELL. The deploy scripts
# read MANAGED_BACKUP_DIR, MANAGED_ENV_PERSIST_DIR and TRIGGER_DB_CONTAINER
# before their defaults, and a shell that set one for the OTA stack would point
# a duty at the OTA stack's files or database. The copy's backstop does not
# read them, and no duty is handed them.
unset MANAGED_BACKUP_DIR MANAGED_ENV_PERSIST_DIR TRIGGER_DB_CONTAINER

# The copy is secret-bearing, and so is the .env the token's clock writes.
umask 077

# One pipe from a duty to the address filter, in a directory only this account
# reads. A pipe by name, not `|`, so the duty's PID is known to stop it by.
WORK_DIR="$(mktemp -d)" || refuse "no directory for the duties' output could be made (mktemp)"
trap 'rm -rf "$WORK_DIR"' EXIT
DUTY_OUT="${WORK_DIR}/duty-output"
mkfifo "$DUTY_OUT" || refuse "no pipe for the duties' output could be made (mkfifo)"

# ---------------------------------------------------------------------- duties --

FAILED=()
RUNNING=""
FILTER_PID=""

# on_signal <name> <exit> — stop the running duty, and start no other.
on_signal() {
  trap '' INT TERM
  local pid
  # Every job still running is this duty's `timeout` or its filter. timeout
  # leads its own process group once it has started; before that, it is
  # signalled alone. The filter, once it is known, is left to read to the end:
  # the duty starts first, so a filter with no duty to read never waits.
  for pid in $(jobs -rp); do
    [ "$pid" = "$FILTER_PID" ] && continue
    kill -TERM -- "-${pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  wait || true
  if [ -n "$RUNNING" ]; then
    fail_line "interrupted (SIG$1) during ${RUNNING}; no later duty ran"
  else
    fail_line "interrupted (SIG$1) between duties; no later duty ran"
  fi
  if [ "${#FAILED[@]}" -gt 0 ]; then
    local names="${FAILED[*]}"
    fail_line "FAILED before it: ${names// /, }. Each one's own words are above."
  fi
  exit "$2"
}
trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM

# run_duty <name> <what> <script> [args…] — run one duty, its stdout and
# stderr through the address filter, and record it when it fails. Exits only
# on a signal.
run_duty() {
  local name="$1" what="$2" script="$3" rc=0 filter=0 duty_pid
  shift 3
  say "${name}: ${what}"
  if [ ! -f "$script" ] || [ ! -x "$script" ]; then
    fail_line "${name}: $(basename "$script") is not in this checkout, or cannot be run"
    FAILED+=("$name")
    return 0
  fi
  RUNNING="$name"
  timeout --kill-after=10 "$BOX_DUTY_TIMEOUT" "$script" "$@" </dev/null >"$DUTY_OUT" 2>&1 &
  duty_pid=$!
  # The filter ignores a Ctrl-C and a SIGTERM to the group, so it reads what
  # a stopped duty said to the end: a signal that reaches it drops its buffer.
  (
    trap '' INT TERM
    own_address_redact "$ENV_FILE"
  ) <"$DUTY_OUT" &
  FILTER_PID=$!
  wait "$duty_pid" || rc=$?
  wait "$FILTER_PID" || filter=$?
  FILTER_PID=""
  RUNNING=""
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    fail_line "${name}: timed out after ${BOX_DUTY_TIMEOUT}s"
    FAILED+=("$name")
  elif [ "$rc" -ne 0 ]; then
    fail_line "${name}: failed (exit ${rc})"
    FAILED+=("$name")
  elif [ "$filter" -ne 0 ]; then
    # Rule 9: a duty whose words were lost has not been seen to pass.
    fail_line "${name}: its output could not be filtered (exit ${filter}), so its result is not known"
    FAILED+=("$name")
  else
    say "${name}: ok"
  fi
  return 0
}

say "${COMPOSE_PROJECT}: six duties, each one run whatever the one before it did"

run_duty token "live's provisioning token, its clock only" \
  "${SCRIPT_DIR}/setup-zitadel.sh" --token-only
run_duty copies "the copy made before an update, deleted once older than 6 days less an hour, whether or not its update was proven; its last day fails (~/.persistent/${COMPOSE_PROJECT}/copy-before-update)" \
  "${SCRIPT_DIR}/copy-before-update.sh" expire
run_duty exposure "every port this machine publishes, both stacks" \
  "${SCRIPT_DIR}/exposure-check.sh"
run_duty organisations "the organisations on live's identity provider, read-only; more than one fails" \
  "${SCRIPT_DIR}/setup-zitadel.sh" --count-organisations
run_duty site "live's copy of the public site, read-only: no www service in live's project, and the site's own project healthy when WWW_LIVE is true" \
  "${SCRIPT_DIR}/www-live.sh" check
run_duty strays "sign-in accounts nobody let in, older than 30 days, removed; more than 20 at once removes none" \
  "${SCRIPT_DIR}/idp-strays.sh" --remove --at-most 20

if [ "${#FAILED[@]}" -gt 0 ]; then
  names="${FAILED[*]}"
  fail_line "FAILED: ${names// /, } (${#FAILED[@]} of 6 duties). Each one's own words are above."
  exit 1
fi
say "all 6 duties passed"
