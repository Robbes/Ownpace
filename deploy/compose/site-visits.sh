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
# GOACCESS IS NEVER GIVEN AN ADDRESS, NOR ANY TEXT A VISITOR OR A LINK CHOSE
# BUT WHAT *What it cannot stop*, BELOW, NAMES, AND KEEPS NO DATABASE.
# GoAccess's own ways to keep totals and hide addresses would have made the
# sentence false. Read in its source at the tag v1.12
# (github.com/allinurl/goaccess, ef3c4f3c): --persist writes, for every day, a
# fingerprint per visitor, an unsalted 64-bit hash of the full address and the
# browser string (util.c, visitor_fingerprint), and per panel which visitor
# asked for which page; and --anonymize-ip masks the address only when the
# HOSTS panel is drawn (gholder.c, add_host_to_holder), never where it is
# stored. And GoAccess copies text from a request into its report word for
# word (review, 2026-10-06, each one run through GoAccess 1.12): the value of
# nine utm_ parameters (utm.c), read before --no-query-string cuts the query
# (parser.c); the path of a request that found no page (NOT_FOUND, REQUESTS);
# whatever is joined to a browser's or a system's version (browsers.c
# parse_browser, opesys.c); and a Referer's host, which can be an address. An
# email address in a newsletter's utm_content, a mistyped personal link, a
# home server's address would each have stood in the report. So:
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
#      v5.37.0, config/endpoint/endpoint.go): it is left out by that name, and
#      counted apart. Of each request it hands on:
#        - the time, the status and the size, which nginx writes. The time is
#          the one nginx writes last before the request, in $time_local's
#          exact shape, never a bracketed text before it (a Basic user's: see
#          the filter); a line that does not end its first piece in that time
#          is not counted as a request;
#        - the method, the path and the protocol, and never the query string.
#          The path only of a request answered 2xx or 3xx, and only when it is
#          a plain path (letters, digits, . _ - /, no `..`, no `//`): with
#          try_files, that is a page or a file of the site. Every other request
#          is `/(not shown)`: nginx answers any path, and a 404's is whatever
#          was asked for;
#        - the site the Referer names, scheme and host and nothing after, or
#          `(an address)` when the host is one;
#        - the User-Agent, word by word (a word ends at a space, `;`, `(`, `)`
#          or `,`): every version after a `/` cut to its digits and dots, so
#          `Firefox/128.0-` and an email address is `Firefox/128.0`; and a
#          word that still holds a character no browser's own string holds
#          (an @, a %, a quote, a backslash) left out whole.
#      Not the first field, NetBird's address on the mesh; not the user field
#      ($remote_user, which nginx fills from any Basic Authorization header
#      though the site asks for none: GoAccess always gets `-`); not the
#      visitor's address, which becomes a number that exists only while the
#      run lasts (v1, v2: the same address, the same number, so GoAccess still
#      tells visitors apart).
#   3. The filter streams into GoAccess: no copy of the log is ever written,
#      so a run that is killed outright leaves none behind. GoAccess runs in a
#      container with no network, no port and nothing of ours mounted, on a
#      read-only disk, as 65534 with no capability, and writes its HTML report
#      on its output. The image declares a volume (/var/www/goaccess, for its
#      real-time server): Docker gives each run an empty one, which only root
#      may write to and which --rm removes; and it exposes 7890, which
#      publishes nothing without -p.
#   4. The report is kept, one per container of the site, under
#      ~/.persistent/<project>/site-visits/ (live's: ownpace-live), readable by
#      this account alone, never in the checkout and never on a port, until
#      the website is taken down for good (privacy §9; the take-down in
#      docs/managed-bring-up.md deletes it). Its name is the day and time the
#      container was made: a deploy recreates the container and its log, so
#      each report covers one release's time on the site, and the earlier
#      reports stay beside the new one. Together they are the totals since the
#      site went up. The report holds counts per page, per day, per hour, per
#      referring site, per browser and system, per status; and the number of
#      visitors, as GoAccess counts them (an address and a browser, per day),
#      with no address or number in it. No campaigns.
#
# What it cannot stop: a word a visitor writes into their own browser's
# User-Agent, letters and digits joined to a browser's or a system's name,
# reaches the browser or system panel as they wrote it. And the Referer is the
# visitor's to set too: a host of letters, digits, dots and hyphens (and its
# port) is handed on as it was sent, so a Referer of
# https://jan.devries.example.nl/ reaches the referring sites panel as
# `https://jan.devries.example.nl`.
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
#   --ignore-panel=UTM_CAMPAIGNS campaigns, which the sentence does not name;
#                                the filter hands on no query string, so the
#                                panel would be empty, and stays so if a later
#                                edit hands one on
#   --anonymize-ip               change nothing while HOSTS is ignored and its
#   --anonymize-level=3          hosts are numbers; if a later edit draws the
#                                panel, it shows a /8 or a /32, not an address.
#                                They are not what keeps addresses out: 2. is
#   --no-query-string            pages without their parameters, the same
#   --ignore-crawlers            visits, not robots
#   --no-global-config           nothing from a configuration file in the image
#   --no-progress                no progress lines on stderr
#   - for the input              the log on its input
#
# and no -o: GoAccess 1.12 checks that the directory of an -o path is
# writable (util.c, is_writable_path), `-o html`'s `.` too, and refuses as
# 65534 on a read-only disk. Without -o, and with its output not a terminal,
# it writes the HTML report there (goaccess.c). Found by running the image's
# own binary this way on 2026-10-06. And never --persist, --restore, --db-path
# or --keep-last (no database at all), -a (a list of browsers per host),
# --real-time-html (a server), --enable-html-resolver (a lookup of hosts) or
# --geoip-database.
#
# THE IMAGE is GoAccess's own, pinned by digest, as managed.yml pins its
# images: Docker Hub's index of the tag 1.12, for amd64 and arm64 (read back
# from the registry on 2026-10-06). GoAccess 1.12 has no telemetry, update
# check or error report; what in it can reach a network is its lookup of hosts
# (gdns.c) and its WebSocket server (websocket.c, only with --real-time-html).
# It runs with --network none all the same
# (scripts/a-service-that-phones-home.unit.test.ts). Docker pulls the image the
# first time, from Docker Hub, as it pulls any other. Its base is Alpine
# 3.20.10, past its end of life (#1675), accepted for now because GoAccess runs
# offline (--network none) on input the filter has cut to a few fields, only
# musl lies on that input's path, and, on 2026-10-22, no release tag carries
# this script yet; it moves with an upstream release on a supported base, or to
# an image of our own if upstream's next release is still on 3.20 or the weekly
# image scan (security-scan.yml, #1674) reports a HIGH or CRITICAL finding in
# musl.
#
# WHEN IT RUNS. Once a day, as box-duties.sh's eighth duty, `visits`, and by
# hand whenever the owner wants a fresh report, and right before a deploy.
# Daily because the log goes with its container at every deploy: what nobody
# counted before then is never counted, so a daily run loses at most the hours
# since the last one. Each run reads the container's whole log again, so
# running it twice changes nothing, unless the `local` log driver rotated the
# log between the two: then the report covers what the log still holds.
#
# LIVE'S ONLY, AND ONLY ONCE THE POLICY SAYS SO. It refuses a .env without
# live's marker (stack_is_live), the OTA stack's among them: the OTA site is
# not counted. It refuses a project the reader refuses (compose_project), and
# a WWW_LIVE that is neither true nor false. While WWW_LIVE is not true, live
# serves no site, and it says so and reads nothing. And it refuses while the
# checkout's site/legal/privacy.md or privacy.nl.md, the texts the site
# publishes, lack §4.5's sentence or §5's purpose outside a comment: counting
# before then would be for a purpose the policy does not state, and live's
# duty runs from the tag it serves. It names keys and files, never a value from
# the .env, and prints counts, a container's short id and a path, never an
# address or a log line. Nothing that runs this may use `set -x`.
#
# Usage:  ./deploy/compose/site-visits.sh      (from live's checkout, no arguments)
# Exit:   0 counted, or nothing to count (WWW_LIVE not true, or no request
#         through the public name yet); 1 not counted, the reason named (no
#         container of the site, docker or GoAccess failing); 2 refused before
#         asking Docker anything (not live's .env, the project, the switch, an
#         argument, a privacy text that does not say it).
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

# GoAccess 1.12: Docker Hub's index digest for the tag (amd64 and arm64),
# read from its listing on 2026-10-05 and from the registry on 2026-10-06.
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
  --ignore-panel=UTM_CAMPAIGNS
  --anonymize-ip
  --anonymize-level=3
  --no-query-string
  --ignore-crawlers
  --no-global-config
  --no-progress
)

ENV_FILE="${SCRIPT_DIR}/.env"
# The texts the site publishes, from this checkout (site/build.mjs).
LEGAL_DIR="${SCRIPT_DIR}/../../site/legal"

say() { printf '[site-visits] %s\n' "$*"; }
fail() {
  printf '[site-visits] FAIL: %s\n' "$@" >&2
  exit 1
}
refuse() {
  printf '[site-visits] REFUSED: %s\n' "$@" >&2
  exit 2
}

# published_text <markdown file> — what a reader of the page sees of it: the
# file on one line, its HTML comments taken out and its white space squeezed.
# A comment can quote the sentence (privacy 1.2's does) without the page
# saying it.
published_text() {
  awk '
    { s = s " " $0 }
    END {
      out = ""
      while ((i = index(s, "<!--")) > 0) {
        out = out substr(s, 1, i - 1)
        s = substr(s, i + 4)
        j = index(s, "-->")
        if (j == 0) { s = ""; break }
        s = substr(s, j + 3)
      }
      out = out s
      gsub(/[ \t\r]+/, " ", out)
      print out
    }' "$1"
}

# privacy_says <file> <words>... — true when the page shows every one.
privacy_says() {
  local file="$1" text words
  shift
  [ -f "$file" ] || return 1
  text="$(published_text "$file")" || return 1
  for words in "$@"; do
    [[ "$text" == *"$words"* ]] || return 1
  done
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

# The owner's words (2026-10-05), as privacy 1.2 publishes them: §4.5's
# sentence and §5's purpose for the server logs, in both languages.
privacy_says "${LEGAL_DIR}/privacy.md" \
  'From these logs we also count visits to this website' \
  'counting visits in totals' ||
  refuse "site/legal/privacy.md in this checkout does not say that visits are counted (§4.5: \"From these logs we also count visits to this website ...\", and §5's purpose \"and counting visits in totals\"), or says it only in a comment. Nothing is counted before the site publishes it: deploy a tag that carries privacy 1.2 (workplan 0139)."
privacy_says "${LEGAL_DIR}/privacy.nl.md" \
  'Uit deze logs tellen we ook bezoeken aan deze website' \
  'bezoeken in totalen tellen' ||
  refuse "site/legal/privacy.nl.md in this checkout does not say that visits are counted (§4.5: \"Uit deze logs tellen we ook bezoeken aan deze website ...\", and §5's purpose \"en bezoeken in totalen tellen\"), or says it only in a comment. Nothing is counted before the site publishes it: deploy a tag that carries privacy 1.2 (workplan 0139)."

SITE_PROJECT="${COMPOSE_PROJECT}-www"
VISITS_DIR="${HOME}/.persistent/${COMPOSE_PROJECT}/site-visits"
# As printed: the home directory as ~, a path to paste, not a user name.
SHOWN_DIR="~/.persistent/${COMPOSE_PROJECT}/site-visits"

# The reports are this account's alone, and so is the run's directory.
umask 077
mkdir -p "$VISITS_DIR" || fail "${SHOWN_DIR} could not be made."
chmod 700 "$VISITS_DIR" || fail "${SHOWN_DIR} could not be made this account's alone."

# A run's directory that a killed run left behind: a run lasts minutes (the
# daily duty stops one at 20), so one older than an hour is nobody's. It holds
# counts and a report of totals at most, never a line of the log.
find "$VISITS_DIR" -maxdepth 1 -type d -name '.work.*' -mmin +60 -exec rm -rf {} + ||
  fail "an old run's directory in ${SHOWN_DIR} could not be removed."

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
# <user> is $remote_user: nginx fills it from any Basic Authorization header,
# though the site asks for none, and escapes only quotes, backslashes and bytes
# below 32 or above 126, so a visitor can put spaces and brackets in it, a text
# or a time of their own (#1675). So the time is nginx's $time_local where nginx
# writes it, at the END of piece 1, in its exact shape (dd/Mon/yyyy:hh:mm:ss
# +zzzz, bracket expressions only, for mawk), and never the first bracketed
# group, which a user can supply. The user itself is never handed on.
# A line of any other shape (the image's start-up lines, a piece 1 that does
# not end in that time) is not an access line.
# What it hands on is the combined format, a number for a host and no user:
#
#   v1 - - [<time>] "<method> <path> <protocol>" <status> <bytes> "<site>" "<user agent>"
#
# In POSIX awk, for the machine's own (mawk on Ubuntu).
FILTER='
function request(line, status,    n, rq, path) {
  n = split(line, rq, " ")
  if (n != 3 || rq[1] !~ /^(GET|HEAD|POST|PUT|DELETE|OPTIONS|PATCH)$/ || rq[3] !~ /^HTTP\/[0-9](\.[0-9])?$/)
    return "/(not shown)"
  path = rq[2]
  sub(/[?#].*$/, "", path)
  if (status !~ /^[23]/ || path !~ /^\/[A-Za-z0-9._\/-]*$/ || path ~ /\/\// || path ~ /(^|\/)\.\.?(\/|$)/)
    path = "/(not shown)"
  return rq[1] " " path " " rq[3]
}
function site(referer,    s, at, scheme, host, bare) {
  if (!match(referer, /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\/?#]+/)) return "-"
  s = substr(referer, 1, RLENGTH)
  at = index(s, "://")
  scheme = substr(s, 1, at + 2)
  host = substr(s, at + 3)
  sub(/^.*@/, "", host)
  bare = host
  sub(/:[0-9]*$/, "", bare)
  if (host ~ /^\[/ || bare ~ /^[0-9.]+$/ || bare ~ /[0-9]+[.-][0-9]+[.-][0-9]+[.-][0-9]+/) return scheme "(an address)"
  if (host !~ /^[A-Za-z0-9.-]+(:[0-9]+)?$/) return "-"
  return scheme host
}
function word_kept(w,    at, v) {
  at = index(w, "/")
  if (at > 0) {
    v = substr(w, at + 1)
    match(v, /^[0-9.]*/)
    w = substr(w, 1, at) substr(v, 1, RLENGTH)
  }
  if (w ~ /[^A-Za-z0-9._:+\/-]/) return ""
  return w
}
function agent(ua,    i, n, c, out, w) {
  out = ""
  w = ""
  n = length(ua)
  for (i = 1; i <= n + 1; i++) {
    c = (i <= n) ? substr(ua, i, 1) : ""
    if (c == "" || c ~ /[ ;(),]/) {
      out = out word_kept(w) c
      w = ""
    } else
      w = w c
  }
  gsub(/  +/, " ", out)
  sub(/^ /, "", out)
  sub(/ $/, "", out)
  return (out == "") ? "-" : out
}
BEGIN { FS = "\""; counted = 0; direct = 0; probe = 0; other = 0; n = 0 }
{
  if (NF != 9 || $5 != " " || $7 != " " || $9 != "" ||
      $3 !~ /^ [0-9][0-9][0-9] [0-9]+ $/ ||
      $1 !~ /^[^ ]+ - .* \[[0-9][0-9]\/[A-Z][a-z][a-z]\/[0-9][0-9][0-9][0-9]:[0-9][0-9]:[0-9][0-9]:[0-9][0-9] [+-][0-9][0-9][0-9][0-9]\] $/) { other++; next }
  xff = $8
  if (xff == "" || xff == "-") { direct++; next }
  if ($6 ~ /^Gatus\//) { probe++; next }
  if (!(xff in seen)) seen[xff] = ++n
  # The same time, anchored at the end: the bracketed group nginx wrote last,
  # without the space after it.
  match($1, /\[[0-9][0-9]\/[A-Z][a-z][a-z]\/[0-9][0-9][0-9][0-9]:[0-9][0-9]:[0-9][0-9]:[0-9][0-9] [+-][0-9][0-9][0-9][0-9]\] $/)
  when = substr($1, RSTART, RLENGTH - 1)
  split($3, sb, " ")
  printf "v%d - - %s \"%s\" %s %s \"%s\" \"%s\"\n", seen[xff], when, request($2, sb[1]), sb[1], sb[2], site($4), agent($6)
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

  counts="${WORK}/counts"
  statuses="${WORK}/statuses"
  tmp="${WORK}/report.html"
  rm -f "$counts" "$statuses" "$tmp"
  # The log streams from Docker through the filter into GoAccess: no copy of
  # it is written anywhere. stdout only: the container's stderr is nginx's
  # error log, which names a client's address on most lines, and is neither
  # read nor printed. What the filter and docker run say on stderr is held in
  # this variable, never in a file, and GoAccess's words are shown below only
  # where they quote nothing.
  set +e
  words="$(
    {
      docker logs "$id" 2>/dev/null | awk -v counts="$counts" "$FILTER" |
        docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
          --user 65534:65534 "$GOACCESS_IMAGE" "${GOACCESS_FLAGS[@]}" \
          "--html-report-title=www.ownpace.eu: visits from the server log since ${since}" \
          - >"$tmp"
      printf '%s %s %s\n' "${PIPESTATUS[@]}" >"$statuses"
    } 2>&1
  )"
  set -e
  read -r st_logs st_filter st_run <"$statuses" ||
    fail "the run on ${short}'s log left no status to read."
  if [ "$st_logs" -ne 0 ]; then
    fail "docker logs ${short} failed (exit ${st_logs}). Its words are not printed: Docker gives them back on the stream that carries nginx's error log, whose lines name visitors' addresses. ${SITE_PROJECT}'s state: ./deploy/compose/www-live.sh check"
  fi
  [ "$st_filter" -eq 0 ] && [ -s "$counts" ] ||
    fail "the filter could not read ${short}'s log (exit ${st_filter})."
  read -r counted direct probe other visitors <"$counts" ||
    fail "the filter's counts for ${short} could not be read."
  say "${SITE_PROJECT}, ${short}, made ${since}: ${counted} request(s) came through the public name, from ${visitors} address(es); ${direct} did not (the healthcheck, the deploy's own checks), ${probe} were the status page's probe, and ${other} line(s) were not requests. Only the first are counted."

  if [ "$st_run" -eq 125 ]; then
    # Docker's own: the container never started, so GoAccess read nothing,
    # and nothing of the log is in what docker says.
    own_address_redact "$ENV_FILE" <<<"$words" >&2 ||
      say "  docker's words could not be filtered, and are not shown."
    fail "docker could not run GoAccess (exit 125, docker's words above): ${GOACCESS_IMAGE%@*}, pinned by digest. ${SHOWN_DIR}/${name}, if there is one, is as it was."
  fi
  if [ "$st_run" -ne 0 ]; then
    # GoAccess quotes a piece of a line it could not read ('Token '...''). The
    # lines it is given hold no address and no text a visitor chose, but they
    # are rows of requests, and are not shown: only its lines with no quote.
    unquoted="$(grep -v "[\"']" <<<"$words" || true)"
    quoting="$(grep -c "[\"']" <<<"$words" || true)"
    own_address_redact "$ENV_FILE" <<<"$unquoted" >&2 ||
      say "  GoAccess's words could not be filtered, and are not shown."
    fail "GoAccess failed on ${short}'s log (exit ${st_run}, its words above). ${quoting} of GoAccess's lines quote the log, and are not shown. ${SHOWN_DIR}/${name}, if there is one, is as it was."
  fi

  if [ "$counted" -eq 0 ]; then
    rm -f "$tmp"
    say "  nothing to count yet: no report for ${short}."
    continue
  fi
  # Rule 9: a report that is not one is not a count.
  head_of_report="$(head -c 512 "$tmp")"
  [[ "$head_of_report" == *'<html'* ]] ||
    fail "GoAccess exited 0 and wrote not an HTML report for ${short}. ${SHOWN_DIR}/${name}, if there is one, is as it was."
  mv -f "$tmp" "${VISITS_DIR}/${name}" || fail "the report could not be put in ${SHOWN_DIR}."
  say "  the report: ${SHOWN_DIR}/${name}"
done

say "every report in ${SHOWN_DIR}, one per container of the site; the newest is the current one."
