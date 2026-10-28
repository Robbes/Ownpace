#!/usr/bin/env bash
# tell-owner.sh — one plain-text mail to the owner, through live's alert relay
# (workplan 0142 T3).
#
# WHY. Live's daily duties (box-duties.sh) and its disk used to fail into the
# user journal, which nobody reads unless something else is already wrong.
# Two things send through this now:
#
#   box-checks.sh           what it finds every ten minutes (the disk, the
#                           daily duties late) and its summary once a day,
#                           each as `tell-owner.sh <name> <detail>`, the body
#                           on stdin;
#   ownpace-tell-owner@.service
#                           systemd's template for a unit that fails, started
#                           by OnFailure= in ownpace-box-duties.service, which
#                           runs `tell-owner.sh --unit <that unit>`. By hand,
#                           `systemctl --user start ownpace-tell-owner@test.service`
#                           sends the test mail.
#
# THE STATUS PAGE'S RELAY AND ADDRESSES (0142 T1), read from live's .env with
# the fallbacks managed.yml gives gatus, so one relay login serves both:
#
#   ALERT_SMTP_HOST, else SMTP_HOST      ALERT_SMTP_PORT, else SMTP_PORT, else 587
#   ALERT_SMTP_USER, else SMTP_USER      ALERT_SMTP_PASSWORD, else SMTP_PASSWORD
#   ALERT_FROM, else NOTIFY_FROM         ALERT_TO, else NOTIFY_TO (comma-separated)
#
# Always over TLS: implicit TLS (smtps) on port 465, or when the port is
# SMTP_PORT's and SMTP_SECURE is true, as the product's own mail reads it;
# otherwise STARTTLS, required (live's relay, on 587), so the login never goes
# in the clear. The envelope sender is the bare address of the From line: a
# relay such as Proton takes only the address it authenticated. A relay or an
# address that is empty, or managed.yml's `.invalid` placeholder, is refused.
#
# NOTHING ON A COMMAND LINE. curl gets every setting, the login among them, as
# a config on a file descriptor (`--config /dev/fd/3`), never as an argument,
# which `ps` shows every account on the machine, and never in its environment;
# the message goes on its stdin. It refuses to run traced (xtrace prints every
# value a command is given).
#
# NO ADDRESS OR SECRET IN THE BODY. The callers send numbers, names of duties,
# release tags, mount points, dates; the headers carry the From and To lines a
# mail needs.
# What it prints names the message and how many it went to, never an address.
#
# LIVE'S ONLY. It refuses a .env that does not carry live's marker exactly
# (stack_is_live), as box-duties.sh does: the OTA stack's mail goes to Mailpit.
#
# Usage:  ./deploy/compose/tell-owner.sh <name> [<detail>]    the body on stdin
#         ./deploy/compose/tell-owner.sh --unit <unit>         (systemd's template)
# Exit:   0 sent; 1 not sent (curl or the relay said no, above); 2 refused,
#         nothing sent (not live's .env, no relay, the usage, tracing).
case "$-" in *x*) TELL_TRACED=1 ;; *) TELL_TRACED='' ;; esac; set +x
if [ -n "$TELL_TRACED" ] || [ -n "${BASH_XTRACEFD+set}" ]; then
  echo "[tell-owner] REFUSED: this was started with xtrace (set -x, bash -x, SHELLOPTS or BASH_XTRACEFD). Tracing prints every value a command is given, and this handles the relay's password." >&2
  echo "[tell-owner] Nothing was sent." >&2
  exit 2
fi
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"

ENV_FILE="${SCRIPT_DIR}/.env"

# The messages this script names itself, by the names docs/incident-runbook.md
# gives their rows (a-runbook-for-every-alert reads these lines).
MSG_DUTIES_FAILED='Daily duties failed'
MSG_UNIT_FAILED='A unit failed'
MSG_TEST='Test mail'

# How fresh the duties' record must be to be this failure's: the mail starts
# as the run ends.
RECORD_FRESH_SECONDS=900

say() { echo "[tell-owner] $*"; }
fail_line() { echo "[tell-owner] $*" >&2; }
refuse() {
  fail_line "REFUSED: $*"
  fail_line "Nothing was sent."
  exit 2
}
USAGE='Usage: tell-owner.sh <name> [<detail>] (the body on stdin), or tell-owner.sh --unit <unit>'

# ---------------------------------------------------------------- the arguments --

NAME=''
DETAIL=''
UNIT=''
[ "$#" -ge 1 ] || refuse "no message named. ${USAGE}"
if [ "$1" = --unit ]; then
  [ "$#" -eq 2 ] || refuse "--unit takes one unit's name. ${USAGE}"
  UNIT="$2"
  [[ "$UNIT" =~ ^[A-Za-z0-9@._:-]{1,200}$ ]] || refuse "--unit takes a unit's name, and that is not one. ${USAGE}"
else
  [ "$#" -le 2 ] || refuse "a name and at most one detail, each one argument. ${USAGE}"
  NAME="$1"
  DETAIL="${2-}"
  case "${NAME}${DETAIL}" in
    *$'\n'* | *$'\r'*) refuse "a name and a detail are one line each: they become the mail's subject." ;;
  esac
  [ -n "$NAME" ] && [ "${NAME#-}" = "$NAME" ] || refuse "no message named. ${USAGE}"
fi

# ---------------------------------------------------------------- live's .env --

[ -f "$ENV_FILE" ] || refuse "no .env beside this script (${ENV_FILE}). This sends live's mail, from live's checkout."
stack_is_live "$ENV_FILE" ||
  refuse "${ENV_FILE} does not carry ${STACK_KIND_KEY} with live's value (workplan 0142 T3). This tells the owner about live; the OTA stack's mail goes to Mailpit. Its value, if any, is not printed."
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" ||
  refuse "the project this checkout drives could not be settled (the reason is above)"

# setting <ALERT key> <fallback key> [default] — the value managed.yml gives gatus.
setting() {
  local v
  v="$(env_value "$ENV_FILE" "$1")"
  [ -n "$v" ] || v="$(env_value "$ENV_FILE" "$2" "${3:-}")"
  printf '%s' "$v"
}
# bare_address <a From or To entry> — the address inside <…>, or the entry
# itself, trimmed.
bare_address() {
  local v="$1"
  if [[ "$v" =~ \<([^\<\>]*)\> ]]; then v="${BASH_REMATCH[1]}"; fi
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}
# an_address <address> — one address, and not managed.yml's placeholder.
an_address() {
  [[ "$1" =~ ^[^[:space:]@\<\>\",]+@[^[:space:]@\<\>\",]+$ ]] && [[ "$1" != *.invalid ]]
}

HOST="$(setting ALERT_SMTP_HOST SMTP_HOST)"
ALERT_PORT="$(env_value "$ENV_FILE" ALERT_SMTP_PORT)"
PORT="$(setting ALERT_SMTP_PORT SMTP_PORT 587)"
LOGIN="$(setting ALERT_SMTP_USER SMTP_USER)"
PASSWORD="$(setting ALERT_SMTP_PASSWORD SMTP_PASSWORD)"
FROM="$(setting ALERT_FROM NOTIFY_FROM)"
TO="$(setting ALERT_TO NOTIFY_TO)"
SECURE="$(env_value "$ENV_FILE" SMTP_SECURE)"

problems=()
if [ -z "$HOST" ] || [[ "$HOST" == *.invalid ]] || ! [[ "$HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  problems+=("ALERT_SMTP_HOST, or SMTP_HOST: no relay's host name")
fi
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] || problems+=("ALERT_SMTP_PORT, or SMTP_PORT: not a port number")
FROM_BARE="$(bare_address "$FROM")"
an_address "$FROM_BARE" || problems+=("ALERT_FROM, or NOTIFY_FROM: no sender's address")
RCPTS=()
IFS=',' read -r -a to_entries <<<"$TO"
for entry in "${to_entries[@]}"; do
  entry="$(bare_address "$entry")"
  [ -n "$entry" ] || continue
  if an_address "$entry"; then RCPTS+=("$entry"); else problems+=("ALERT_TO, or NOTIFY_TO: an entry that is not an address"); fi
done
[ "${#RCPTS[@]}" -gt 0 ] || problems+=("ALERT_TO, or NOTIFY_TO: no address to send to")
if [ "${#problems[@]}" -gt 0 ]; then
  refuse "live's .env does not name the relay or the addresses the status page's alerts use (workplan 0142 T1): $(printf '%s; ' "${problems[@]}")no value is printed. docs/managed-bring-up.md, 8d, names the keys."
fi

SCHEME=smtp
if [ "$PORT" = 465 ] || { [ -z "$ALERT_PORT" ] && [ "${SECURE,,}" = true ]; }; then SCHEME=smtps; fi

# --------------------------------------------------------- the message for a unit --

# record_line <file> — sets REC_EPOCH, REC_STAMP, REC_RESULT and REC_NAMES from a
# record box-duties.sh left; false when there is none, or it is not one.
record_line() {
  local line
  REC_EPOCH='' REC_STAMP='' REC_RESULT='' REC_NAMES=''
  [ -f "$1" ] || return 1
  line="$(sed -n '1p' "$1")" || return 1
  read -r REC_EPOCH REC_STAMP REC_RESULT REC_NAMES <<<"$line"
  [[ "$REC_EPOCH" =~ ^[0-9]+$ ]] && [[ "$REC_STAMP" =~ ^[0-9T:Z-]+$ ]] &&
    [[ "$REC_RESULT" =~ ^(passed|failed|interrupted)$ ]] && [[ "$REC_NAMES" =~ ^([a-z,]+|-)$ ]]
}

# token_line — the provisioning token's date, as its duty last wrote it, and
# how far off it is. A date, never another value.
token_line() {
  local exp e now
  exp="$(env_value "$ENV_FILE" ZITADEL_PAT_EXPIRY)"
  if [ -z "$exp" ]; then
    echo "The provisioning token (ZITADEL_PAT_EXPIRY): not in live's .env."
    return 0
  fi
  if ! [[ "$exp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] ||
     ! e="$(date -u -d "$exp" +%s 2>/dev/null)" || ! now="$(date -u +%s)"; then
    echo "The provisioning token (ZITADEL_PAT_EXPIRY): not a date this reads."
    return 0
  fi
  if [ "$e" -le "$now" ]; then
    echo "The provisioning token (ZITADEL_PAT_EXPIRY): ${exp}, past. Only a console session can mint the next one: setup-zitadel.sh's 401 message says how."
  else
    echo "The provisioning token (ZITADEL_PAT_EXPIRY): ${exp}, $(((e - now) / 86400)) days from now. The duty replaces it when fewer than 3 are left."
  fi
}

BODY=''
if [ -n "$UNIT" ]; then
  case "$UNIT" in
    test)
      NAME="$MSG_TEST"
      DETAIL='sent by hand'
      BODY="A test of the mail live sends its owner, started by hand through systemd, the way a unit that fails starts it (workplan 0142 T3). It arrived, so the relay, the addresses and the template unit work.

$(token_line)"
      ;;
    ownpace-box-duties.service)
      NAME="$MSG_DUTIES_FAILED"
      result=''
      result="$(systemctl --user show -p Result --value "$UNIT" 2>/dev/null)" || result=''
      [[ "$result" =~ ^[a-z-]+$ ]] || result='not known (systemctl could not be asked)'
      now="$(date -u +%s)"
      rec="${HOME}/.persistent/${COMPOSE_PROJECT}/box-duties/last-run"
      if record_line "$rec" && [ "$REC_RESULT" != passed ] && [ "$((now - REC_EPOCH))" -le "$RECORD_FRESH_SECONDS" ]; then
        if [ "$REC_NAMES" = - ]; then
          what="No duty had failed when it stopped"
          DETAIL="${REC_RESULT}"
        else
          what="Failed: ${REC_NAMES//,/, }"
          DETAIL="${REC_NAMES//,/, }"
        fi
        if [ "$REC_RESULT" = interrupted ]; then
          what="It was stopped at ${REC_STAMP}, and no later duty ran. ${what}."
        else
          what="${what}, at ${REC_STAMP}."
        fi
      else
        DETAIL="result ${result}"
        what="This run left no record of its own: it was refused before any duty ran, stopped, or cut short by its time limit (TimeoutStartSec). The journal says which."
      fi
      BODY="Live's daily duties failed (ownpace-box-duties.service, result: ${result}).
${what}

$(token_line)

Look first: journalctl --user -u ownpace-box-duties -n 200 --no-pager
What each duty does: docs/managed-bring-up.md, \"Live's daily duties\"."
      ;;
    *)
      NAME="$MSG_UNIT_FAILED"
      DETAIL="$UNIT"
      BODY="systemd started this mail because ${UNIT} failed.

Look first: journalctl --user -u ${UNIT} -n 200 --no-pager"
      ;;
  esac
else
  BODY="$(cat)"
fi

# ------------------------------------------------------------------- the mail --

# cfg_value <text> — a curl config value: double-quoted, with \ and " escaped.
cfg_value() {
  local v="${1//\\/\\\\}"
  v="${v//\"/\\\"}"
  printf '"%s"' "$v"
}

SUBJECT="[${COMPOSE_PROJECT}] ${NAME}${DETAIL:+: ${DETAIL}}"
TO_LINE="$(printf '%s, ' "${RCPTS[@]}")"
TO_LINE="${TO_LINE%, }"
# A Message-ID of its own, on the sender's domain: some receivers refuse a mail
# without one (Gmail answers 550 5.7.1), and whether a relay adds one is the
# relay's to decide. The time, this process and two random numbers: unique per
# mail, and nothing about the machine.
MESSAGE_ID="<$(date -u +%s).$$.${RANDOM}${RANDOM}@${FROM_BARE##*@}>"
MESSAGE="From: ${FROM}
To: ${TO_LINE}
Subject: ${SUBJECT}
Date: $(date -u -R)
Message-ID: ${MESSAGE_ID}
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: 8bit
Auto-Submitted: auto-generated

${BODY//$'\r'/}

--
What \"${NAME}\" means, and the first thing to do: docs/incident-runbook.md, the row \"${NAME}\".
Sent by deploy/compose/tell-owner.sh from ~/${COMPOSE_PROJECT}."

CONFIG="url = $(cfg_value "${SCHEME}://${HOST}:${PORT}")"$'\n'
[ "$SCHEME" = smtps ] || CONFIG+=$'ssl-reqd\n'
CONFIG+="mail-from = $(cfg_value "$FROM_BARE")"$'\n'
for rcpt in "${RCPTS[@]}"; do
  CONFIG+="mail-rcpt = $(cfg_value "$rcpt")"$'\n'
done
[ -z "$LOGIN" ] || CONFIG+="user = $(cfg_value "${LOGIN}:${PASSWORD}")"$'\n'
# crlf: the message is written with LF line ends, and curl's SMTP sends them as
# they are without it. A relay hardened against SMTP smuggling refuses or
# rewrites bare LF (Postfix's smtpd_forbid_bare_newline, for one).
CONFIG+=$'upload-file = "-"\ncrlf\nconnect-timeout = 20\nmax-time = 60\nsilent\nshow-error\n'
unset PASSWORD

# Both from here-strings: a pipe into curl would hand back printf's SIGPIPE,
# not curl's answer, when curl stops reading (AGENTS rule 10).
rc=0
out="$(curl --config /dev/fd/3 3<<<"$CONFIG" <<<"$MESSAGE" 2>&1)" || rc=$?
unset CONFIG
if [ "$rc" -ne 0 ]; then
  fail_line "NOT SENT: \"${NAME}\". curl exit ${rc}: ${out:-it said nothing}"
  exit 1
fi
say "sent \"${NAME}\"${DETAIL:+ (${DETAIL})} to the owner, ${#RCPTS[@]} address(es) of ALERT_TO or NOTIFY_TO, over ${SCHEME}"
