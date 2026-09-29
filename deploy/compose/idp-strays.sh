#!/usr/bin/env bash
# idp-strays.sh — the sign-in accounts nobody let in, listed, and removed when
# asked (workplan 0135 T8).
#
# WHY IT EXISTS. Anybody can create an account at the sign-in page: organisation
# registration is off (0135 T1), self-registration is not (0095 T0). Such an
# account opens nothing until an operator grants a request for its address, but
# the identity provider holds a name, an address, a password hash, sessions and
# their history for it. Privacy 1.2's §9 keeps it 30 days (0135 open question
# 6, answered 2026-09-28: "30 days is ok"). Nothing removed one.
#
# WHAT IT LISTS: a human account at this stack's identity provider that matches
# all five of these.
#
#   1. It has no membership: its subject is in no `tenant_member` row, whatever
#      the row's status.
#   2. It has no operator row: its subject is not in `platform_operator`.
#   3. No open access request carries its address.
#   4. No open invitation is addressed to it: no `tenant_member` row with
#      `status = 'invited'` carries its address. Such a row holds a `pending:`
#      placeholder where the subject will go, so the first condition cannot see
#      it, and a person granted after registering has one until they first sign
#      in to the app (the fifth condition, added 2026-09-28).
#   5. It is older than 30 days, by the date the provider says it was created.
#
# An address is compared without case. The provider's own members, of the
# instance and of the organisation, are never listed: the first human is one of
# them, and so is the machine user whose token this uses. Only humans are asked
# for. An account with no creation date the script can read is left alone.
#
# ONE ACCOUNT, AT ANY AGE (`--subject`). When an organisation is erased, its
# members' accounts stay at the provider (docs/operator-runbook.md, Tenant
# offboarding). After the purge, `--subject <sub> --remove` removes one of
# them. The fifth condition does not apply; the first four do, so the account
# of somebody who is still a member elsewhere, an operator, or holds an open
# request or invitation is refused, with the reason.
#
# WHAT IT NEVER DOES. Without `--remove` it removes nothing and writes nothing.
# It refuses, before removing anything, when any read failed or came back in a
# shape it does not know: a partial picture makes everybody look like a
# stranger. For the same reason it refuses when the database names people and
# none of them has an account at this provider, which is what the other
# stack's provider, or subjects that are not the provider's ids, would look
# like. It prints no token: the token goes to curl in a file only this account
# can read, never on a command line. A removal's line carries the account's id
# and date, never its address, so a log of a removal keeps no address of the
# account it removed.
#
# WHOSE STACK. The stack of the checkout it runs in, as dump-idp.sh: the
# project comes from `compose_project` (env-read.sh), the database is that
# project's `-db` container, and the provider is the one this checkout's `.env`
# names, asked with the provisioning token on its volume. The token is renewed
# by setup-zitadel.sh (`--token-only`, one of live's daily duties).
#
# Usage:
#   ./deploy/compose/idp-strays.sh                          list them
#   ./deploy/compose/idp-strays.sh --remove                 list them, then remove them
#   ./deploy/compose/idp-strays.sh --subject <sub>          one account, at any age
#   ./deploy/compose/idp-strays.sh --subject <sub> --remove
#
# Exit: 0 listed, or every listed account removed; 1 refused, or a removal
# failed, each said; 2 a usage error.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
ENV_FILE="${SCRIPT_DIR}/.env"

# The retention period, privacy 1.2's §9 (0135 open question 6).
DAYS=30

say() { echo "idp-strays: $*"; }
die() {
  echo "idp-strays: $*" >&2
  echo "idp-strays: nothing was removed." >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./deploy/compose/idp-strays.sh [--remove]
       ./deploy/compose/idp-strays.sh --subject <sub> [--remove]

Lists this stack's sign-in accounts that nobody let in: no membership, no
operator row, no open access request or invitation for the address, and older
than 30 days. --remove removes them. --subject asks about one account, at any
age, for an organisation that has been erased.
EOF
}

REMOVE=0
SUBJECT=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --remove) REMOVE=1; shift ;;
    --subject) SUBJECT="${2:-}"; [ -n "$SUBJECT" ] || { usage >&2; exit 2; }; shift 2 ;;
    --subject=*) SUBJECT="${1#--subject=}"; [ -n "$SUBJECT" ] || { usage >&2; exit 2; }; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "idp-strays: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
done
# The provider's ids are digits. A `pending:` placeholder is an invitation, not
# an account, and anything else would be pasted into a URL.
case "$SUBJECT" in
  '') ;;
  *[!A-Za-z0-9_-]*)
    echo "idp-strays: '${SUBJECT}' is not a subject: the provider's ids are letters and digits (GET /api/me's userId)." >&2
    exit 2
    ;;
esac

command -v jq >/dev/null || die "jq is needed, and is not installed."
command -v curl >/dev/null || die "curl is needed, and is not installed."
[ -f "$ENV_FILE" ] || die "no .env beside this script (${ENV_FILE}): run it from the checkout of the stack it is for."

# The stack comes from this checkout, never from the shell: see env-read.sh.
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || exit 1
DB_CONTAINER="${COMPOSE_PROJECT}-db"

# The issuer, derived as setup-zitadel.sh derives it: the provider answers only
# for the origin it was initialised with.
env_or() { # env_or <key> <default>
  local v
  v="$(env_value "$ENV_FILE" "$1")"
  printf '%s' "${v:-$2}"
}
IDP_DOMAIN="$(env_or ZITADEL_EXTERNALDOMAIN ownpace-idp)"
IDP_PORT="$(env_or ZITADEL_EXTERNALPORT "$(env_or ZITADEL_PORT 3126)")"
if [ "$(env_or ZITADEL_EXTERNALSECURE false)" = "true" ]; then SCHEME=https; else SCHEME=http; fi
if { [ "$SCHEME" = "https" ] && [ "$IDP_PORT" = "443" ]; } ||
   { [ "$SCHEME" = "http" ] && [ "$IDP_PORT" = "80" ]; }; then
  ISSUER="${SCHEME}://${IDP_DOMAIN}"
else
  ISSUER="${SCHEME}://${IDP_DOMAIN}:${IDP_PORT}"
fi
# A compose network alias does not resolve on the host: present it, and connect
# to the published port, as setup-zitadel.sh does.
CURL_ORIGIN=()
if ! curl -sS --max-time 3 -o /dev/null "${ISSUER}/debug/healthz" 2>/dev/null; then
  CURL_ORIGIN=(--resolve "${IDP_DOMAIN}:${IDP_PORT}:127.0.0.1")
fi

umask 077
WORK="$(mktemp -d)" || die "no working directory could be made (mktemp)."
trap 'rm -rf "$WORK"' EXIT

# The provisioning token, read off its volume with busybox, as the smoke reads
# it (the provider's image has no shell), mounted read-only.
PAT="$(docker run --rm -v "${COMPOSE_PROJECT}_zitadel_machinekey:/machinekey:ro" \
  busybox:1.38 cat /machinekey/pat.txt 2>/dev/null | tr -d '\r\n')" || PAT=''
case "$PAT" in
  '' | *[[:space:]]*)
    die "no provisioning token could be read from the volume ${COMPOSE_PROJECT}_zitadel_machinekey. Is the stack's identity provider set up (setup-zitadel.sh)?" ;;
esac
[ "${#PAT}" -ge 20 ] || die "what the volume ${COMPOSE_PROJECT}_zitadel_machinekey holds is too short to be a token."
printf 'Authorization: Bearer %s\n' "$PAT" >"${WORK}/auth"
unset PAT

# api <method> <path> [json] — sets ANSWER and STATUS; true only on a 2xx.
ANSWER=''
STATUS=''
api() {
  local out
  local args=(-sS --max-time 30 "${CURL_ORIGIN[@]}" -X "$1" "${ISSUER}$2"
    -H "@${WORK}/auth" -H 'Content-Type: application/json' -w '\n%{http_code}')
  if [ -n "${3:-}" ]; then args+=(-d "$3"); fi
  if ! out="$(curl "${args[@]}" 2>/dev/null)"; then
    ANSWER=''
    STATUS=000
    return 1
  fi
  STATUS="${out##*$'\n'}"
  ANSWER="${out%$'\n'*}"
  case "$STATUS" in 2??) return 0 ;; *) return 1 ;; esac
}
# ask <what> <method> <path> [json] — api, or refuse with what the provider said.
ask() {
  local what="$1"
  shift
  api "$@" && return 0
  case "$STATUS" in
    000) die "${what}: no answer from the identity provider at ${ISSUER}. Is it running?" ;;
    401) die "${what}: the provider refused the provisioning token (HTTP 401). Its clock may have run out; ./deploy/compose/setup-zitadel.sh --token-only renews it." ;;
    *) die "${what}: the provider answered HTTP ${STATUS}: ${ANSWER:0:200}" ;;
  esac
}

# fields — the names of the fields in the last answer and in its first result,
# never their values: a refusal is printed, and an account's values are an
# address and a name.
fields() {
  local out
  out="$(jq -c '[keys, ((.result // [])[0] // {} | keys)]' <<<"$ANSWER" 2>/dev/null)" || out='none: not JSON'
  printf '%s' "${out:0:300}"
}

# ------------------------------------------------------------ what the stack knows --

# db <file> <sql> — one value per line into <file>, over the database's own
# superuser, which row security does not hold back.
db() {
  local why
  if ! docker exec "$DB_CONTAINER" sh -c 'psql -X -q -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$2" >"$1" 2>"${WORK}/db-error"; then
    why="$(cat "${WORK}/db-error")"
    die "the database of '${COMPOSE_PROJECT}' (${DB_CONTAINER}) could not be read: ${why:0:300}"
  fi
}
db "${WORK}/members" "SELECT DISTINCT user_id FROM tenant_member"
db "${WORK}/operators" "SELECT user_id FROM platform_operator"
db "${WORK}/requests" "SELECT DISTINCT email FROM access_request WHERE state = 'open'"
db "${WORK}/invited" "SELECT DISTINCT email FROM tenant_member WHERE status = 'invited'"

# ------------------------------------------------------------ what the provider holds --

ask "the instance's members" POST /admin/v1/members/_search '{"query":{"limit":1000}}'
jq -e '(.result // []) | type == "array" and length > 0 and all(has("userId"))' >/dev/null 2>&1 <<<"$ANSWER" ||
  die "the provider lists no members of its instance in a shape this knows, yet its own token needs to be one to ask. Its answer's fields: $(fields)"
jq -r '.result[].userId' <<<"$ANSWER" >"${WORK}/own"
ask "the organisation's members" POST /management/v1/orgs/me/members/_search '{"query":{"limit":1000}}'
jq -e '(.result // []) | type == "array" and all(has("userId"))' >/dev/null 2>&1 <<<"$ANSWER" ||
  die "the organisation's members came back in a shape this does not know. Its answer's fields: $(fields)"
jq -r '(.result // [])[].userId' <<<"$ANSWER" >>"${WORK}/own"

# Every human, a page at a time.
: >"${WORK}/humans"
OFFSET=0
PAGES=0
while :; do
  ask "the accounts" POST /v2/users \
    "$(jq -nc --argjson o "$OFFSET" '{query:{offset:$o, limit:100, asc:true}, queries:[{typeQuery:{type:"TYPE_HUMAN"}}]}')"
  # A renamed field would read as "nobody let in" or as "everybody": refuse.
  jq -e '(.result // []) | all(has("userId") and has("details"))' >/dev/null 2>&1 <<<"$ANSWER" ||
    die "the account listing does not look like one (no userId or details). Its answer's fields: $(fields)"
  jq -c '(.result // [])[]' <<<"$ANSWER" >>"${WORK}/humans"
  GOT="$(jq '(.result // []) | length' <<<"$ANSWER")"
  TOTAL="$(jq -r '.details.totalResult // "0" | tonumber' <<<"$ANSWER")"
  OFFSET=$((OFFSET + GOT))
  PAGES=$((PAGES + 1))
  if [ "$GOT" -eq 0 ] || [ "$OFFSET" -ge "$TOTAL" ]; then break; fi
  [ "$PAGES" -lt 1000 ] || die "the account listing did not end after 1000 pages."
done

# ------------------------------------------------------------ who is let in --

jq -n \
  --slurpfile humans "${WORK}/humans" \
  --rawfile members "${WORK}/members" \
  --rawfile operators "${WORK}/operators" \
  --rawfile requests "${WORK}/requests" \
  --rawfile invited "${WORK}/invited" \
  --rawfile own "${WORK}/own" \
  --arg subject "$SUBJECT" \
  --argjson now "$(date -u +%s)" \
  --argjson days "$DAYS" '
  def lines: split("\n") | map(select(length > 0));
  # The provider stamps fractions of a second, which fromdateiso8601 does not read.
  def epoch: sub("\\.[0-9]+"; "") | fromdateiso8601;
  ($members | lines) as $m
  | ($operators | lines) as $o
  | ($requests | lines | map(ascii_downcase)) as $r
  | ($invited | lines | map(ascii_downcase)) as $i
  | ($own | lines) as $p
  | [ $humans[] | select(has("human")) | .userId ] as $ids
  | ($m + $o | map(select(startswith("pending:") | not)) | unique) as $known
  | {
      # The database names people, and none of them is an account here.
      strangers: (($known | length) > 0 and (($known | any(. as $k | $ids | any(. == $k))) | not)),
      accounts: [
        $humans[]
        | select(has("human"))
        | select($subject == "" or .userId == $subject)
        | .userId as $id
        | (.human.email.email // "" | ascii_downcase) as $e
        | (try (.details.creationDate | epoch) catch null) as $born
        | {
            id: $id,
            login: (.preferredLoginName // .username // ""),
            created: ((.details.creationDate // "") | .[0:10]),
            days: (if $born == null then null else (($now - $born) / 86400 | floor) end),
            kept: (
              if ($p | any(. == $id)) then "own"
              elif ($m | any(. == $id)) then "member"
              elif ($o | any(. == $id)) then "operator"
              elif $e != "" and ($r | any(. == $e)) then "request"
              elif $e != "" and ($i | any(. == $e)) then "invitation"
              elif $subject != "" then null
              elif $born == null then "undated"
              elif ($now - $born) <= ($days * 86400) then "young"
              else null end)
          }
      ]
    }' >"${WORK}/verdict" || die "the accounts could not be weighed (jq failed)."

if [ "$(jq -r '.strangers' "${WORK}/verdict")" = "true" ]; then
  die "the database of '${COMPOSE_PROJECT}' names members and operators, and none of them has an account at ${ISSUER}. That is the other stack's provider, or subjects that are not the provider's ids; either way everybody would look like a stranger."
fi

ACCOUNTS="$(jq '.accounts | length' "${WORK}/verdict")"
STRAYS="$(jq '[.accounts[] | select(.kept == null)] | length' "${WORK}/verdict")"

if [ -n "$SUBJECT" ]; then
  [ "$ACCOUNTS" -gt 0 ] || die "no account ${SUBJECT} at the provider of '${COMPOSE_PROJECT}'."
  WHY="$(jq -r '{
      own: "it is one of the provider'"'"'s own members",
      member: "it is a member of an organisation here",
      operator: "it is an operator",
      request: "an open access request carries its address",
      invitation: "an open invitation is addressed to it"
    }[.accounts[0].kept // ""] // empty' "${WORK}/verdict")"
  [ -z "$WHY" ] || die "account ${SUBJECT} is left alone: ${WHY}."
  say "stack '${COMPOSE_PROJECT}': account ${SUBJECT} belongs to nobody here."
else
  say "stack '${COMPOSE_PROJECT}': ${ACCOUNTS} accounts at the provider, ${STRAYS} nobody let in and older than ${DAYS} days."
  LEFT="$(jq -r --argjson days "$DAYS" '
    [ ["own", "the provider'"'"'s own members"], ["member", "members of an organisation"],
      ["operator", "operators"], ["request", "with an open access request"],
      ["invitation", "with an open invitation"], ["young", "younger than \($days) days"],
      ["undated", "with no creation date"] ] as $labels
    | [.accounts[].kept | select(. != null)] as $kept
    | [ $labels[] | . as [$code, $label] | ($kept | map(select(. == $code)) | length) as $n
        | select($n > 0) | "\($n) \($label)" ]
    | join(", ")' "${WORK}/verdict")"
  [ -z "$LEFT" ] || say "left alone: ${LEFT}."
fi

if [ "$REMOVE" -eq 0 ]; then
  jq -r '.accounts[] | select(.kept == null)
    | "  \(.id)  \(.login)  created \(.created)\(if .days == null then "" else ", \(.days) days ago" end)"' "${WORK}/verdict"
  if [ -n "$SUBJECT" ]; then
    say "nothing was removed. To remove it: ./deploy/compose/idp-strays.sh --subject ${SUBJECT} --remove"
  elif [ "$STRAYS" -eq 1 ]; then
    say "nothing was removed. To remove it: ./deploy/compose/idp-strays.sh --remove"
  elif [ "$STRAYS" -gt 1 ]; then
    say "nothing was removed. To remove these ${STRAYS}: ./deploy/compose/idp-strays.sh --remove"
  fi
  exit 0
fi

REMOVED=0
FAILED=0
while IFS=$'\t' read -r id created; do
  [ -n "$id" ] || continue
  if api DELETE "/v2/users/${id}"; then
    echo "  removed ${id}, created ${created}"
    REMOVED=$((REMOVED + 1))
  elif [ "$STATUS" = "404" ]; then
    echo "  ${id} was gone already"
  else
    echo "idp-strays: could not remove ${id}: HTTP ${STATUS} ${ANSWER:0:200}" >&2
    FAILED=$((FAILED + 1))
  fi
done < <(jq -r '.accounts[] | select(.kept == null) | [.id, .created] | @tsv' "${WORK}/verdict")

if [ "$FAILED" -gt 0 ]; then
  echo "idp-strays: removed ${REMOVED} of ${STRAYS}; ${FAILED} could not be removed, each named above." >&2
  exit 1
fi
say "removed ${REMOVED} of ${STRAYS}."
