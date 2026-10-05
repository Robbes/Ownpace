#!/usr/bin/env bash
# site-visits.sh — visits to www.ownpace.eu, counted from its server log, as
# totals that identify nobody (privacy §4.5, §5 and §9).
#
# THE OWNER, 2026-10-05, verbatim: "go with GoAccess on the logs and the
# sentence. id and status we skip for now, no netbird api tokens..." It answers
# the recommendation to count visits to live's copy of the public site with
# GoAccess, reading the access log its nginx already writes (www-nginx.conf,
# format ownpace_site): no script, cookie or banner on the page, nothing
# leaving the machine, nothing counted on app., id. or status.ownpace.eu, and
# no NetBird API token, so NetBird's own log is not read. Privacy §4.5 says:
# "From these logs we also count visits to this website (pages, the site you
# came from, the kind of browser), as totals only, which identify nobody."
# This script is what makes that true.
#
# GOACCESS IS NEVER GIVEN AN ADDRESS, AND KEEPS NO DATABASE. GoAccess's own
# ways to keep totals and hide addresses would have made the sentence false.
# Read in its source at the tag v1.12 (github.com/allinurl/goaccess, ef3c4f3c):
# --persist writes, for every day, a fingerprint per visitor, an unsalted
# 64-bit hash of the full address and the browser string (util.c,
# visitor_fingerprint), and per panel which visitor asked for which page; and
# --anonymize-ip masks the address only when the HOSTS panel is drawn
# (gholder.c, add_host_to_holder), never where it is stored. So:
#
#   1. The log is read where Docker keeps it (`docker logs`, the container's
#      output: privacy §9's "until the part that wrote them is replaced"), the
#      whole of it on every run, and nginx's error lines (its stderr, which
#      name a client's address) are never read.
#   2. A filter keeps only the requests that came through the public name:
#      those with an X-Forwarded-For, which NetBird's proxy sets. The
#      healthcheck every 30 seconds and the deploy's own checks on loopback
#      have none, and are not visits. Nor is the status page's Website row
#      (gatus.yaml), which asks through the public name every 60 seconds once
#      STATUS_SITE_ENABLED is true, as Gatus/1.0 (Gatus's own User-Agent at
#      v5.36.0, client/client.go): it is left out by that name, and counted
#      apart. Of each request it hands on the time,
#      the request line, the status, the size, the site the Referer names
#      (scheme and host, nothing after) and the User-Agent. Not the first
#      field, NetBird's address on the mesh; not the visitor's address, which
#      becomes a number that exists only while the run lasts (v1, v2: the same
#      address, the same number, so GoAccess still tells visitors apart). The
#      lines go into a working copy in a directory only this account reads,
#      deleted when the run ends.
#   3. GoAccess reads them on its input and writes its HTML report on its
#      output, in a container with no network, no port, no mount and a
#      read-only disk: there is nowhere for it to keep anything, or send it.
#   4. The report is kept, one per container of the site, under
#      ~/.persistent/<project>/site-visits/ (live's: ownpace-live), readable by
#      this account alone, never in the checkout and never on a port. Its
#      name is the day and time the container was made: a deploy recreates the
#      container and its log, so each report covers one release's time on the
#      site, and the earlier reports stay beside the new one. Together they are
#      the totals since the site went up. The report holds counts per page, per
#      day, per hour, per referring site, per campaign, per browser and system,
#      per status; and the number of visitors, as GoAccess counts them (an
#      address and a browser, per day), with no address or number in it.
#
# GOACCESS'S FLAGS, AND WHY EACH (GOACCESS_FLAGS below):
#
#   --log-format=COMBINED        the shape the filter writes; its date and time
#                                formats come with it
#   --no-ip-validation           a host is v1, v2, never an address
#   --ignore-panel=HOSTS         the panel of hosts is never built
#   --ignore-panel=GEO_LOCATION  a place, and ASN a network: neither is in the
#   --ignore-panel=ASN           sentence, and the image has no database for
#                                them anyway
#   --ignore-panel=REFERRERS     the whole address of the page a visitor came
#                                from (a mailbox's link, a search); "the site
#                                you came from" is REFERRING_SITES, the host
#   --ignore-panel=REMOTE_USER   the site has no user names
#   --anonymize-ip               change nothing while HOSTS is ignored and its
#   --anonymize-level=3          hosts are numbers; if a later edit draws the
#                                panel, it shows a /8 or a /32, not an address.
#                                They are not what keeps addresses out: 2. is
#   --no-query-string            pages without their parameters; the UTM panel
#                                still counts campaigns, taken from the request
#                                before the query is cut (parser.c)
#   --ignore-crawlers            visits, not robots
#   --no-global-config           nothing from a configuration file in the image
#   --no-progress                no progress lines on stderr
#   -o html, and - for the input the report on its output, the log on its input
#
# and never --persist, --restore, --db-path or --keep-last (no database at
# all), -a (a list of browsers per host), --real-time-html (a server),
# --enable-html-resolver (a lookup of hosts) or --geoip-database.
#
# THE IMAGE is GoAccess's own, pinned by digest, as managed.yml pins its
# images. GoAccess 1.12 has no telemetry, update check or error report; what in
# it can reach a network is its lookup of hosts (gdns.c) and its WebSocket
# server (websocket.c, only with --real-time-html). It runs with
# --network none all the same (scripts/a-service-that-phones-home.unit.test.ts).
# Docker pulls the image the first time, from Docker Hub, as it pulls any
# other.
#
# WHEN IT RUNS. Once a day, as box-duties.sh's eighth duty, `visits`, and by
# hand whenever the owner wants a fresh report. Daily because the log goes with
# its container at every deploy: what nobody counted before then is never
# counted, so a daily run loses at most the hours since the last one. Each run
# reads the container's whole log again, so running it twice changes nothing.
#
# LIVE'S ONLY. It refuses a .env without live's marker (stack_is_live), the
# OTA stack's among them: the OTA site is not counted. It refuses a project the
# reader refuses (compose_project), and a WWW_LIVE that is neither true nor
# false. While WWW_LIVE is not true, live serves no site, and it says so and
# reads nothing. It names keys, never a value from the .env, and prints counts,
# a container's short id and a path, never an address or a log line. Nothing
# that runs this may use `set -x`.
#
# Usage:  ./deploy/compose/site-visits.sh      (from live's checkout, no arguments)
# Exit:   0 counted, or nothing to count (WWW_LIVE not true, or no request
#         through the public name yet); 1 not counted, the reason named (no
#         container of the site, docker or GoAccess failing); 2 refused before
#         asking Docker anything (not live's .env, the project, the switch, an
#         argument).
# scripts/a-visit-count-that-kept-the-visitor.unit.test.ts runs it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"
# shellcheck source=deploy/compose/own-addresses.sh
. "${SCRIPT_DIR}/own-addresses.sh"
# WWW_LIVE_KEY and www_live_switch: the switch, read as deploy-live.sh reads it.
# shellcheck source=deploy/compose/www-live.sh
. "${SCRIPT_DIR}/www-live.sh"

# GoAccess 1.12, Docker Hub's digest for the tag (read 2026-10-05).
GOACCESS_IMAGE="allinurl/goaccess:1.12@sha256:9e6dfd4abce94bd7c2907c1840b7b35f666587d56b24ffbb930b4782a87ea172"

# The header says why each one.
GOACCESS_FLAGS=(
  --log-format=COMBINED
  --no-ip-validation
  --ignore-panel=HOSTS
  --ignore-panel=GEO_LOCATION
  --ignore-panel=ASN
  --ignore-panel=REFERRERS
  --ignore-panel=REMOTE_USER
  --anonymize-ip
  --anonymize-level=3
  --no-query-string
  --ignore-crawlers
  --no-global-config
  --no-progress
)

ENV_FILE="${SCRIPT_DIR}/.env"

say() { printf '[site-visits] %s\n' "$*"; }
fail() {
  printf '[site-visits] FAIL: %s\n' "$@" >&2
  exit 1
}
refuse() {
  printf '[site-visits] REFUSED: %s\n' "$@" >&2
  exit 2
}

# ---------------------------------------------------------- before docker --

[ "$#" -eq 0 ] ||
  refuse "this script takes no arguments. Usage: ./deploy/compose/site-visits.sh, from live's checkout."
[ -f "$ENV_FILE" ] ||
  refuse "no .env beside this script (${ENV_FILE}). The visits counted are www.ownpace.eu's, live's copy of the site, from live's checkout."
stack_is_live "$ENV_FILE" ||
  refuse "${ENV_FILE} does not carry ${STACK_KIND_KEY} with live's value. Only live's copy of the site, www.ownpace.eu, is counted; the OTA site is not. Its value, if any, is not printed."
# Prints its own reason when it refuses (env-read.sh).
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" ||
  refuse "the project this checkout drives could not be settled (the reason is above)."
switch="$(www_live_switch "$ENV_FILE")" ||
  refuse "${WWW_LIVE_KEY} in ${ENV_FILE} is neither true nor false. Its value is not printed." \
    "Set ${WWW_LIVE_KEY}=true once live serves www.ownpace.eu (docs/managed-bring-up.md, www.ownpace.eu: live's copy), or false."
if [ "$switch" != on ]; then
  say "${WWW_LIVE_KEY} is not true in live's .env: this checkout serves no site, so there is nothing to count. Nothing was read."
  exit 0
fi

SITE_PROJECT="${COMPOSE_PROJECT}-www"
VISITS_DIR="${HOME}/.persistent/${COMPOSE_PROJECT}/site-visits"
# As printed: the home directory as ~, a path to paste, not a user name.
SHOWN_DIR="~/.persistent/${COMPOSE_PROJECT}/site-visits"

# The working copy and the reports are this account's alone.
umask 077
mkdir -p "$VISITS_DIR" || fail "${SHOWN_DIR} could not be made."
chmod 700 "$VISITS_DIR" || fail "${SHOWN_DIR} could not be made this account's alone."

# A working copy that a killed run left behind: a run lasts minutes (the daily
# duty stops one at 20), so one older than an hour is nobody's.
find "$VISITS_DIR" -maxdepth 1 -type d -name '.work.*' -mmin +60 -exec rm -rf {} + ||
  fail "an old working copy in ${SHOWN_DIR} could not be removed."

WORK="$(mktemp -d "${VISITS_DIR}/.work.XXXXXX")" || fail "no working directory could be made in ${SHOWN_DIR}."
trap 'rm -rf "$WORK"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ------------------------------------------------------------- the filter --
#
# One access line of ownpace_site (www-nginx.conf), split on `"`: nginx writes
# a `"` inside a field as \x22, so a quoted field holds none, and a line has
# nine pieces:
#
#   1 `<addr> - <user> [<time>] `   2 request   3 ` <status> <bytes> `
#   4 referer   5 ` `   6 user agent   7 ` `   8 X-Forwarded-For   9 ``
#
# A line of any other shape (the image's start-up lines) is not an access line.
# What it hands on is the combined format, a number for a host:
#
#   v1 - - [<time>] "<request>" <status> <bytes> "<site>" "<user agent>"
#
# In POSIX awk, for the machine's own (mawk on Ubuntu).
FILTER='
BEGIN { FS = "\""; counted = 0; direct = 0; probe = 0; other = 0; n = 0 }
{
  if (NF != 9 || $5 != " " || $7 != " " || $9 != "" ||
      $3 !~ /^ [0-9][0-9][0-9] [0-9]+ $/ || $1 !~ /^[^ ]+ - .* \[[^]]+\] $/) { other++; next }
  xff = $8
  if (xff == "" || xff == "-") { direct++; next }
  if ($6 ~ /^Gatus\//) { probe++; next }
  if (!(xff in seen)) seen[xff] = ++n
  match($1, /\[[^]]+\]/)
  when = substr($1, RSTART, RLENGTH)
  split($3, sb, " ")
  site = "-"
  if (match($4, /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\/?#]+/)) {
    site = substr($4, 1, RLENGTH)
    at = index(site, "://")
    scheme = substr(site, 1, at + 2)
    host = substr(site, at + 3)
    sub(/^.*@/, "", host)
    site = (host == "") ? "-" : (scheme host)
  }
  printf "v%d - - %s \"%s\" %s %s \"%s\" \"%s\"\n", seen[xff], when, $2, sb[1], sb[2], site, $6
  counted++
}
END { printf "%d %d %d %d %d\n", counted, direct, probe, other, n > counts }
'

# ------------------------------------------------------- each container ---

ids="$(docker ps -a --filter "label=com.docker.compose.project=${SITE_PROJECT}" --filter "label=com.docker.compose.service=www" --format '{{.ID}}')" ||
  fail "docker could not be asked which containers ${SITE_PROJECT} has (above)."
[ -n "$ids" ] ||
  fail "${WWW_LIVE_KEY} is true, and ${SITE_PROJECT} has no container, so there is no log to count. deploy-live.sh brings it up with each deploy of live; the daily duty site says what it finds."

for id in $ids; do
  short="${id:0:12}"
  created="$(docker inspect --format '{{.Created}}' "$id")" ||
    fail "docker could not be asked when ${short} of ${SITE_PROJECT} was made (above)."
  # 2026-10-07T03:12:45.123456789Z: Docker gives it in UTC.
  [[ "$created" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2}) ]] ||
    fail "docker gave ${short} of ${SITE_PROJECT} a creation time this does not read."
  made="${BASH_REMATCH[1]}"
  hhmmss="${BASH_REMATCH[2]}${BASH_REMATCH[3]}${BASH_REMATCH[4]}"
  since="${made} ${BASH_REMATCH[2]}:${BASH_REMATCH[3]} UTC"
  name="${made}-${hhmmss}-${short}.html"

  lines="${WORK}/lines"
  counts="${WORK}/counts"
  rm -f "$lines" "$counts"
  # stdout only: the container's stderr is nginx's error log, which names a
  # client's address on most lines, and is neither read nor printed.
  set +e
  docker logs "$id" 2>/dev/null | awk -v counts="$counts" "$FILTER" >"$lines"
  st=("${PIPESTATUS[@]}")
  set -e
  if [ "${st[0]}" -ne 0 ]; then
    fail "docker logs ${short} failed (exit ${st[0]}). Its words are not printed: Docker gives them back on the stream that carries nginx's error log, whose lines name visitors' addresses. ${SITE_PROJECT}'s state: ./deploy/compose/www-live.sh check"
  fi
  [ "${st[1]}" -eq 0 ] && [ -s "$counts" ] ||
    fail "the filter could not read ${short}'s log (exit ${st[1]})."
  read -r counted direct probe other visitors <"$counts" ||
    fail "the filter's counts for ${short} could not be read."

  say "${SITE_PROJECT}, ${short}, made ${since}: ${counted} request(s) came through the public name, from ${visitors} address(es); ${direct} did not (the healthcheck, the deploy's own checks), ${probe} were the status page's probe, and ${other} line(s) were not requests. Only the first are counted."
  if [ "$counted" -eq 0 ]; then
    rm -f "$lines"
    say "  nothing to count yet: no report for ${short}."
    continue
  fi

  tmp="${WORK}/report.html"
  set +e
  docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --user 65534:65534 "$GOACCESS_IMAGE" "${GOACCESS_FLAGS[@]}" \
    "--html-report-title=www.ownpace.eu: visits from the server log since ${since}" \
    -o html - <"$lines" >"$tmp" 2>"${WORK}/goaccess.err"
  rc=$?
  set -e
  # The working copy goes as soon as GoAccess has read it.
  rm -f "$lines"
  if [ "$rc" -ne 0 ]; then
    # GoAccess was given no address, so its words hold none; this machine's own
    # are taken out all the same (own-addresses.sh).
    own_address_redact "$ENV_FILE" <"${WORK}/goaccess.err" >&2 ||
      say "  GoAccess's words could not be filtered, and are not shown."
    fail "GoAccess failed on ${short}'s log (exit ${rc}, its words above). ${SHOWN_DIR}/${name}, if there is one, is as it was."
  fi
  # Rule 9: a report that is not one is not a count.
  head_of_report="$(head -c 512 "$tmp")"
  [[ "$head_of_report" == *'<html'* ]] ||
    fail "GoAccess exited 0 and wrote not an HTML report for ${short}. ${SHOWN_DIR}/${name}, if there is one, is as it was."
  mv -f "$tmp" "${VISITS_DIR}/${name}" || fail "the report could not be put in ${SHOWN_DIR}."
  say "  the report: ${SHOWN_DIR}/${name}"
done

say "every report in ${SHOWN_DIR}, one per container of the site; the newest is the current one."
