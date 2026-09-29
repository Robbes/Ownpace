#!/usr/bin/env bash
# idp-strays.sh — the sign-in accounts nobody let in, listed, and removed when
# asked (workplan 0135 T8).
#
# WHY IT EXISTS. Anybody can create an account at the sign-in page: organisation
# registration is off (0135 T1), self-registration is not (0095 T0). Such an
# account opens nothing until an operator grants a request for its address, but
# the identity provider holds a name, an address, a password hash, sessions and
# their history for it. Privacy 1.2's §9 keeps it 30 days (0135 open question
# 6, answered 2026-09-28: "30 days is ok"). Nothing removed one. The account of
# a member removed from an organisation goes too, 7 days after the removal
# (0135 open question 13, answered 2026-09-29: "Same number of days").
#
# WHAT IT LISTS: a human account at this stack's identity provider that matches
# all of these.
#
#   1. It has no membership: its subject is in no `tenant_member` row, whatever
#      the row's status.
#   2. It was not removed from an organisation here in the last 7 days. The
#      Team page's removal and `operator.sh leave` both delete the member row
#      and write an `audit_log` row with the action `member.removed`, the
#      subject in `detail.userId` (2026-09-29), and the row's own time, `at`,
#      says when. While the NEWEST such row for its subject is younger than 7
#      days, the account is kept. The 7 are the owner's (0135 open question
#      13, 2026-09-29: "Same number of days", and then "7 days"): the erasure
#      window, in which a closed organisation, or a tester who does not accept
#      the new conditions, is erased 7 days later. Privacy §9 says it. A record
#      that names no subject names no account, and is passed over. An
#      organisation's erasure deletes its audit rows, so after a purge the
#      account is weighed like any other, as the runbook's Tenant offboarding
#      means it to be.
#   3. It has no operator row: its subject is not in `platform_operator`.
#   4. No open access request carries its address.
#   5. No open invitation is addressed to it: no `tenant_member` row with
#      `status = 'invited'` carries its address. Such a row holds a `pending:`
#      placeholder where the subject will go, so the first condition cannot see
#      it, and a person granted after registering has one until they first sign
#      in to the app (added 2026-09-28).
#   6. It is older than 30 days, by the date the provider says it was created,
#      unless its removal is recorded (2). Privacy §9's 30 days are for an
#      account "that we never let in"; the owner's question was whether these
#      are unused accounts, answered "unused, yes" (site/legal/README.md). An
#      account whose removal is recorded was let in, and the owner's answer
#      counts its 7 days from the removal, so for it the date it was created
#      plays no part: created 10 days ago and removed 8 days ago, it goes. Nor
#      does a creation date the script cannot read keep it.
#   7. It belongs to this stack's organisation at the provider: its
#      `details.resourceOwner` is the id `GET /management/v1/orgs/me` answers.
#      An account of another organisation (0135 T3: one may be made on purpose)
#      was not made at our sign-in page, and is never weighed.
#   8. It holds no membership and no grant at the provider, asked of each
#      account the others would list (`/management/v1/users/{id}/memberships`,
#      `/management/v1/users/grants`): somebody gave it a role there by hand.
#
# An address is compared without case. The provider's own members, of the
# instance and of the organisation, are never listed: the first human is one of
# them, and so is the machine user whose token this uses. Only humans are asked
# for. An account with no creation date the script can read is left alone,
# unless its removal is recorded (6).
#
# ONE ACCOUNT, AT ANY AGE (`--subject`). When an organisation is erased, its
# members' accounts stay at the provider (docs/operator-runbook.md, Tenant
# offboarding). After the purge, `--subject <sub> --remove` removes one of
# them. The age condition does not apply; the others do, so the account of
# somebody who is still a member elsewhere, was removed from an organisation
# here less than 7 days ago, is an operator, holds an open request or
# invitation, belongs to another organisation, or holds a role at the
# provider is refused, with the reason.
#
# WHAT IT NEVER DOES. Without `--remove` it removes nothing and writes nothing.
# It refuses, before removing anything, when any read failed or came back in a
# shape it does not know: a partial picture makes everybody look like a
# stranger. The account listing is read to its end or refused: a page with
# accounts and no count, an empty page before the count is reached, or a count
# below the accounts already given would otherwise end it early and in
# silence. A membership or grant answer is read as the provider counts it, the
# larger of its list and its count, and one that counts roles it does not list
# where the provider lists them is refused, never read as "no role". For the
# same reason it refuses when the database names people and none of them has
# an account at this provider, which is what the other stack's provider, or
# subjects that are not the provider's ids, would look like; and, with
# `--remove`, when the database has no operator row. Live has one from
# managed-bring-up's "Become the operator" on, so a database without one is
# emptied or not live's, and every tester would look like a stranger;
# `--at-most` would not stop it at the alpha's scale. Listing, without
# `--remove`, still works on a fresh stack. An operator row does not prove the
# rest is there: live's database reset or restored while the provider keeps
# its accounts, with "Become the operator" done again first, names the operator
# and none of the testers, and nothing here tells that from a stack whose
# testers' organisations were all erased, where removing their accounts is the
# point. So the runbook holds the duty after such a reset until the members
# are back (docs/operator-runbook.md, "Sign-in accounts nobody let in"). It
# prints no token: the token goes to curl in a file only this account can read,
# never on a command line. A removal's line carries the account's id and date,
# never its address, so a log of a removal keeps no address of the account it
# removed.
#
# WHOSE STACK. The stack of the checkout it runs in, as dump-idp.sh: the
# project comes from `compose_project` (env-read.sh), the database is that
# project's `-db` container, and the provider is the one this checkout's `.env`
# names, asked with the provisioning token on its volume. The token is renewed
# by setup-zitadel.sh (`--token-only`, one of live's daily duties). The
# database is read at the machine, on the owner's connection: `psql` as
# `POSTGRES_USER` inside that container, the database's owner and a superuser,
# which row security does not hold back (docs/rls-guide.md). It has to be:
# `audit_log` and `tenant_member` FORCE row security, and as `app_user` they
# show one organisation's rows at a time, never every organisation's.
#
# Usage:
#   ./deploy/compose/idp-strays.sh                          list them
#   ./deploy/compose/idp-strays.sh --remove                 list them, then remove them
#   ./deploy/compose/idp-strays.sh --subject <sub>          one account, at any age
#   ./deploy/compose/idp-strays.sh --subject <sub> --remove
#   ./deploy/compose/idp-strays.sh --remove --at-most 20    as live's daily duty runs it
#
# AT MOST. `--at-most N` removes nothing when more than N would go. Live's
# daily duties run it so (box-duties.sh, 0135 T8 (b)): a day with more strays
# than a day brings waits for a person to look, rather than a run nobody
# watches removing them.
#
# Exit: 0 listed, or every listed account removed; 1 refused, or a removal
# failed, each said; 2 a usage error.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
ENV_FILE="${SCRIPT_DIR}/.env"

# How long an account nobody let in is kept, from the date the provider says
# it was created: privacy 1.2's §9 (0135 open question 6, 2026-09-28: "30
# days is ok").
DAYS=30
# How long the account of a member removed from an organisation is kept, from
# the newest removal recorded for it: the erasure window's 7 days, the owner's
# answer to 0135 open question 13 (2026-09-29: "Same number of days", and then
# "7 days"). Privacy §9 says it beside the 30.
REMOVED_DAYS=7

say() { echo "idp-strays: $*"; }
die() {
  echo "idp-strays: $*" >&2
  echo "idp-strays: nothing was removed." >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: ./deploy/compose/idp-strays.sh [--remove [--at-most N]]
       ./deploy/compose/idp-strays.sh --subject <sub> [--remove]

Lists this stack's sign-in accounts that nobody let in: no membership, no
operator row, no open access request or invitation for the address, of our
own organisation at the provider with no role there, and older than 30 days;
and those of members removed from an organisation 7 or more days ago, on the
same conditions but the age. --remove removes them, and refuses while the
database has no operator row. --subject asks about one account, at any age,
for an organisation that has been erased. --at-most N removes nothing when
more than N would go.
EOF
}

REMOVE=0
SUBJECT=''
AT_MOST=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --remove) REMOVE=1; shift ;;
    --subject) SUBJECT="${2:-}"; [ -n "$SUBJECT" ] || { usage >&2; exit 2; }; shift 2 ;;
    --subject=*) SUBJECT="${1#--subject=}"; [ -n "$SUBJECT" ] || { usage >&2; exit 2; }; shift ;;
    --at-most) AT_MOST="${2:-}"; [ -n "$AT_MOST" ] || { usage >&2; exit 2; }; shift 2 ;;
    --at-most=*) AT_MOST="${1#--at-most=}"; [ -n "$AT_MOST" ] || { usage >&2; exit 2; }; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "idp-strays: unknown argument '$1'" >&2; usage >&2; exit 2 ;;
  esac
done
if [ -n "$AT_MOST" ] && ! [[ "$AT_MOST" =~ ^[1-9][0-9]*$ ]]; then
  echo "idp-strays: --at-most takes a whole number of accounts, one or more." >&2
  exit 2
fi
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
# address and a name. A `result` that is not a list of objects has no first
# result's names to give.
fields() {
  local out
  out="$(jq -rc '
    if type != "object" then "none: the answer is a JSON \(type)"
    else [keys, (if (.result | type) == "array" and (.result[0] | type) == "object" then .result[0] | keys else [] end)]
    end' <<<"$ANSWER" 2>/dev/null)" || out='none: not JSON'
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
# The subjects let in and removed since, and when: the Team page's removal
# (members.ts, MEMBER_REMOVED_ACTION) and `operator.sh leave`
# (MEMBERSHIP_REMOVED_ACTION) record `member.removed` with the subject in
# `detail.userId`, and the row's own `at` is when. Every such row, as the
# subject and whole seconds since 1970; the newest of each subject counts.
db "${WORK}/removed" "SELECT detail->>'userId', extract(epoch FROM at)::bigint FROM audit_log WHERE action = 'member.removed'"
db "${WORK}/operators" "SELECT user_id FROM platform_operator"
db "${WORK}/requests" "SELECT DISTINCT email FROM access_request WHERE state = 'open'"
db "${WORK}/invited" "SELECT DISTINCT email FROM tenant_member WHERE status = 'invited'"

# Each removal is a subject, a bar, and whole seconds, as psql -At prints the
# two columns. A line in another shape would read as a subject nobody removed,
# or as a time long past: refuse. Its words are not printed.
if grep -qvE '^[^|]*[|][0-9]+$' "${WORK}/removed"; then
  die "the record of removals came back in a shape this does not know: a line of audit_log's member.removed is not a subject and a time in whole seconds."
fi

# A database that names no operator is not live's as it runs: live has one from
# "Become the operator" on (docs/managed-bring-up.md). Emptied or another
# stack's, it would make every tester a stranger, so nothing is removed from
# it. Before the provider is asked anything. (A reset that brought the operator
# row back first is the runbook's to hold: see the header.)
OPERATORS="$(grep -c . "${WORK}/operators" || true)"
if [ "$REMOVE" -eq 1 ] && [ "$OPERATORS" -eq 0 ]; then
  die "the database of '${COMPOSE_PROJECT}' has no operator row (platform_operator), so it does not name the people who were let in: an emptied database, or another stack's, would make every tester look like a stranger. Live has one from docs/managed-bring-up.md's 'Become the operator' on. Listing, without --remove, still works."
fi

# ------------------------------------------------------------ what the provider holds --

ask "the instance's members" POST /admin/v1/members/_search '{"query":{"limit":1000}}'
jq -e '(.result // []) | type == "array" and length > 0 and all(has("userId"))' >/dev/null 2>&1 <<<"$ANSWER" ||
  die "the provider lists no members of its instance in a shape this knows, yet its own token needs to be one to ask. Its answer's fields: $(fields)"
jq -r '.result[].userId' <<<"$ANSWER" >"${WORK}/own"
ask "the organisation's members" POST /management/v1/orgs/me/members/_search '{"query":{"limit":1000}}'
jq -e '(.result // []) | type == "array" and all(has("userId"))' >/dev/null 2>&1 <<<"$ANSWER" ||
  die "the organisation's members came back in a shape this does not know. Its answer's fields: $(fields)"
jq -r '(.result // [])[].userId' <<<"$ANSWER" >>"${WORK}/own"

# Our own organisation: only its accounts were made at our sign-in page.
ask "the organisation of the provisioning token" GET /management/v1/orgs/me
ORG_ID="$(jq -r '.org.id // empty' <<<"$ANSWER" 2>/dev/null)" || ORG_ID=''
[[ "$ORG_ID" =~ ^[A-Za-z0-9_-]+$ ]] ||
  die "the provider named no organisation for the provisioning token. Its answer's fields: $(fields)"

# Every human, a page at a time, to the end the count says. proto3 JSON leaves
# a count of zero out, so an empty page with no count is an empty listing; a
# page with accounts and no count, or an empty page before the count is
# reached, would end the listing early and in silence, and the accounts past it
# would never be weighed.
: >"${WORK}/humans"
OFFSET=0
TOTAL=0
PAGES=0
while :; do
  ask "the accounts" POST /v2/users \
    "$(jq -nc --argjson o "$OFFSET" '{query:{offset:$o, limit:100, asc:true}, queries:[{typeQuery:{type:"TYPE_HUMAN"}}]}')"
  # A renamed field would read as "nobody let in" or as "everybody": refuse.
  jq -e '(.result // []) | all(has("userId") and has("details"))' >/dev/null 2>&1 <<<"$ANSWER" ||
    die "the account listing does not look like one (no userId or details). Its answer's fields: $(fields)"
  jq -e '(.result // []) | all(if has("human") then (.details | has("resourceOwner")) else true end)' >/dev/null 2>&1 <<<"$ANSWER" ||
    die "the account listing names no organisation (details.resourceOwner) for an account, so whose account it is cannot be told."
  jq -c '(.result // [])[]' <<<"$ANSWER" >>"${WORK}/humans"
  GOT="$(jq '(.result // []) | length' <<<"$ANSWER")"
  COUNT="$(jq -r '.details.totalResult // empty' <<<"$ANSWER")"
  if [ -n "$COUNT" ]; then
    [[ "$COUNT" =~ ^[0-9]+$ ]] || die "the account listing's count is not a number."
    # A count below what the listing has already given ("0" beside a full
    # page, say) would read as the last page.
    [ "$COUNT" -ge "$((OFFSET + GOT))" ] ||
      die "the account listing counts ${COUNT} accounts and has already given $((OFFSET + GOT)), so where it ends cannot be told."
    TOTAL="$COUNT"
  elif [ "$GOT" -gt 0 ]; then
    die "a page of the account listing holds ${GOT} accounts and no count (details.totalResult), so the listing cannot be read to its end."
  fi
  if [ "$GOT" -eq 0 ]; then
    [ "$OFFSET" -ge "$TOTAL" ] ||
      die "the account listing stopped at ${OFFSET} of the ${TOTAL} accounts it counted: an empty page before its end."
    break
  fi
  OFFSET=$((OFFSET + GOT))
  PAGES=$((PAGES + 1))
  [ "$OFFSET" -lt "$TOTAL" ] || break
  [ "$PAGES" -lt 1000 ] || die "the account listing did not end after 1000 pages."
done

# ------------------------------------------------------------ who is let in --

jq -n \
  --slurpfile humans "${WORK}/humans" \
  --rawfile members "${WORK}/members" \
  --rawfile removed "${WORK}/removed" \
  --rawfile operators "${WORK}/operators" \
  --rawfile requests "${WORK}/requests" \
  --rawfile invited "${WORK}/invited" \
  --rawfile own "${WORK}/own" \
  --arg subject "$SUBJECT" \
  --arg org "$ORG_ID" \
  --argjson now "$(date -u +%s)" \
  --argjson days "$DAYS" \
  --argjson removedDays "$REMOVED_DAYS" '
  def lines: split("\n") | map(select(length > 0));
  # The provider stamps fractions of a second, which fromdateiso8601 does not read.
  def epoch: sub("\\.[0-9]+"; "") | fromdateiso8601;
  ($members | lines) as $m
  # The newest removal of each subject named, in seconds since 1970.
  | ($removed | lines
     | map(capture("^(?<id>.*)[|](?<at>[0-9]+)$") | select(.id != ""))
     | group_by(.id) | map({ key: .[0].id, value: (map(.at | tonumber) | max) }) | from_entries) as $x
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
        | $x[$id] as $gone
        | {
            id: $id,
            login: (.preferredLoginName // .username // ""),
            created: ((.details.creationDate // "") | .[0:10]),
            days: (if $born == null then null else (($now - $born) / 86400 | floor) end),
            # Days since the newest removal, when one is recorded.
            removed: (if $gone == null then null else (($now - $gone) / 86400 | floor) end),
            kept: (
              if ($p | any(. == $id)) then "own"
              elif ($m | any(. == $id)) then "member"
              elif $gone != null and ($now - $gone) < ($removedDays * 86400) then "removed"
              elif ($o | any(. == $id)) then "operator"
              elif $e != "" and ($r | any(. == $e)) then "request"
              elif $e != "" and ($i | any(. == $e)) then "invitation"
              elif (.details.resourceOwner // "") != $org then "elsewhere"
              elif $subject != "" then null
              # Let in, and removed 7 days ago or more: its days count from
              # the removal, and the date it was created plays no part.
              elif $gone != null then null
              elif $born == null then "undated"
              elif ($now - $born) <= ($days * 86400) then "young"
              else null end)
          }
      ]
    }' >"${WORK}/verdict" || die "the accounts could not be weighed (jq failed)."

if [ "$(jq -r '.strangers' "${WORK}/verdict")" = "true" ]; then
  die "the database of '${COMPOSE_PROJECT}' names members and operators, and none of them has an account at ${ISSUER}. That is the other stack's provider, or subjects that are not the provider's ids; either way everybody would look like a stranger."
fi

# A role at the provider, given by hand in the console: a membership (of a
# project, say) or a user grant. Asked only of the accounts the rest would
# list, so a day with none asks nothing more. A search that fails refuses.
: >"${WORK}/held"
# results <what> — how many roles the last answer holds, or refuse. These
# searches have met stand-ins only, and an answer misread as "none" removes an
# account somebody gave a role, so it is read as the provider counts it: the
# larger of the list's length and `details.totalResult`. An answer whose list
# is not a list, whose count is not a number, or that counts roles and has no
# list at all is in a shape this does not know. proto3 JSON leaves an empty
# list and a count of zero out, so `{"details":{}}` is none.
results() {
  local n
  n="$(jq -r '
    (.details // {}) as $d
    | (if ($d | type) != "object" then null
       else ($d.totalResult // "0") as $t
         | if ($t | type) == "string" and ($t | test("^[0-9]+$")) then ($t | tonumber)
           elif ($t | type) == "number" and $t >= 0 and ($t | floor) == $t then $t
           else null end
       end) as $count
    | if $count == null then ""
      elif has("result") and (.result | type) != "array" then ""
      elif $count > 0 and (has("result") | not) then ""
      else [$count, (.result // [] | length)] | max end' <<<"$ANSWER" 2>/dev/null)" || n=''
  [[ "$n" =~ ^[0-9]+$ ]] || die "$1 came back in a shape this does not know. Its answer's fields: $(fields)"
  printf '%s' "$n"
}
while IFS= read -r id; do
  [ -n "$id" ] || continue
  # The provider's ids are letters and digits; anything else stays out of a URL.
  [[ "$id" =~ ^[A-Za-z0-9_-]+$ ]] || die "the provider listed an account id that is not one."
  ask "the memberships of account ${id}" POST "/management/v1/users/${id}/memberships/_search" '{}'
  HELD="$(results "the memberships of account ${id}")" || exit 1
  if [ "$HELD" -eq 0 ]; then
    ask "the grants of account ${id}" POST /management/v1/users/grants/_search \
      "$(printf '{"queries":[{"userIdQuery":{"userId":"%s"}}]}' "$id")"
    HELD="$(results "the grants of account ${id}")" || exit 1
  fi
  [ "$HELD" -eq 0 ] || printf '%s\n' "$id" >>"${WORK}/held"
done < <(jq -r '.accounts[] | select(.kept == null) | .id' "${WORK}/verdict")
jq --rawfile held "${WORK}/held" '
  ($held | split("\n") | map(select(length > 0))) as $h
  | .accounts |= map(if .kept == null and (.id as $id | $h | any(. == $id)) then .kept = "provider" else . end)' \
  "${WORK}/verdict" >"${WORK}/verdict.next" || die "the accounts could not be weighed (jq failed)."
mv "${WORK}/verdict.next" "${WORK}/verdict"

ACCOUNTS="$(jq '.accounts | length' "${WORK}/verdict")"
STRAYS="$(jq '[.accounts[] | select(.kept == null)] | length' "${WORK}/verdict")"
# Of those, the accounts of members removed 7 or more days ago.
GONE="$(jq '[.accounts[] | select(.kept == null and .removed != null)] | length' "${WORK}/verdict")"

if [ -n "$SUBJECT" ]; then
  [ "$ACCOUNTS" -gt 0 ] || die "no account ${SUBJECT} at the provider of '${COMPOSE_PROJECT}'."
  WHY="$(jq -r --argjson removedDays "$REMOVED_DAYS" '.accounts[0] as $a | {
      own: "it is one of the provider'"'"'s own members",
      member: "it is a member of an organisation here",
      removed: "it was removed from an organisation here \($a.removed) days ago, and is kept until \($removedDays) days after that",
      operator: "it is an operator",
      request: "an open access request carries its address",
      invitation: "an open invitation is addressed to it",
      elsewhere: "it belongs to another organisation at the provider",
      provider: "it holds a membership or a grant at the provider"
    }[$a.kept // ""] // empty' "${WORK}/verdict")"
  [ -z "$WHY" ] || die "account ${SUBJECT} is left alone: ${WHY}."
  say "stack '${COMPOSE_PROJECT}': account ${SUBJECT} belongs to nobody here."
else
  if [ "$GONE" -gt 0 ]; then
    say "stack '${COMPOSE_PROJECT}': ${ACCOUNTS} accounts at the provider, $((STRAYS - GONE)) nobody let in and older than ${DAYS} days, and ${GONE} removed from an organisation ${REMOVED_DAYS} or more days ago."
  else
    say "stack '${COMPOSE_PROJECT}': ${ACCOUNTS} accounts at the provider, ${STRAYS} nobody let in and older than ${DAYS} days."
  fi
  LEFT="$(jq -r --argjson days "$DAYS" --argjson removedDays "$REMOVED_DAYS" '
    [ ["own", "the provider'"'"'s own members"], ["member", "members of an organisation"],
      ["removed", "removed from an organisation less than \($removedDays) days ago"],
      ["operator", "operators"], ["request", "with an open access request"],
      ["invitation", "with an open invitation"],
      ["elsewhere", "of another organisation at the provider"],
      ["provider", "with a membership or a grant at the provider"],
      ["young", "younger than \($days) days"],
      ["undated", "with no creation date"] ] as $labels
    | [.accounts[].kept | select(. != null)] as $kept
    | [ $labels[] | . as [$code, $label] | ($kept | map(select(. == $code)) | length) as $n
        | select($n > 0) | "\($n) \($label)" ]
    | join(", ")' "${WORK}/verdict")"
  [ -z "$LEFT" ] || say "left alone: ${LEFT}."
fi

if [ "$REMOVE" -eq 0 ]; then
  jq -r '.accounts[] | select(.kept == null)
    | "  \(.id)  \(.login)  created \(.created)\(if .days == null then "" else ", \(.days) days ago" end)\(
        if .removed == null then "" else ", removed from an organisation \(.removed) days ago" end)"' "${WORK}/verdict"
  if [ "$OPERATORS" -eq 0 ]; then
    say "nothing was removed, and --remove refuses while the database names no operator (platform_operator): docs/managed-bring-up.md, 'Become the operator'."
  elif [ -n "$SUBJECT" ]; then
    say "nothing was removed. To remove it: ./deploy/compose/idp-strays.sh --subject ${SUBJECT} --remove"
  elif [ "$STRAYS" -eq 1 ]; then
    say "nothing was removed. To remove it: ./deploy/compose/idp-strays.sh --remove"
  elif [ "$STRAYS" -gt 1 ]; then
    say "nothing was removed. To remove these ${STRAYS}: ./deploy/compose/idp-strays.sh --remove"
  fi
  exit 0
fi

if [ -n "$AT_MOST" ] && [ "$STRAYS" -gt "$AT_MOST" ]; then
  die "${STRAYS} accounts would be removed, more than the ${AT_MOST} this run may remove (--at-most). Look at them first: ./deploy/compose/idp-strays.sh lists them. If they are right, remove them with --remove alone."
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
