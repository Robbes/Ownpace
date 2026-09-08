#!/usr/bin/env bash
# seed-demo-dav-content.sh — put real calendar, TASK, contact and file data into
# the demo Nextcloud SOURCE account, so the demo tenant B mapping has something
# to sync (workplan 0084, run #7; tasks added by 0113 T7).
#
# WHY THIS EXISTS
# ---------------
# `setup-nextcloud-users.sh` provisions ACCOUNTS. It creates no events, no
# contacts and no files — grep it for PUT and nothing comes back. So the demo
# DAV source has always been empty, every sync of demo tenant B has correctly
# copied nothing, and `item` has never held a `copied` row for that mapping.
#
# That is why `smoke-managed.sh`'s apply half found "no eligible item" on
# e2e-managed run #7 (2026-08-18) — the first run in which a skip was allowed
# to fail rather than pass. The apply half was never blocked by a bug in apply;
# it was blocked by a demo with nothing in it, for as long as the demo has
# existed. Mail looked different only because the Spark's Stalwart happens to
# hold three messages somebody put there by hand — nothing in this repo seeds
# those either, which is worth knowing before trusting the verify half's counts
# on a fresh machine.
#
# THE TASK LIST IS A COLLECTION OF ITS OWN, ON PURPOSE (0113 T7)
# --------------------------------------------------------------
# Nextcloud's default `personal` calendar declares `VEVENT,VTODO`, so a VTODO
# dropped in there would be carried by BOTH faces and would prove almost
# nothing: a mixed collection is the easy case, and it is already the one the
# unit tests cover. What 0113 is actually about is the collection that declares
# **VTODO and nothing else** — a task list, which for years this product read
# as a calendar and whose to-dos it labelled events.
#
# So this seeds one: `MKCALENDAR` with a `supported-calendar-component-set` of
# VTODO alone (RFC 4791 §5.2.3), and the VTODOs go in there. That single
# property is the whole difference on the wire, and it is what the gate now
# exercises end to end — the source must skip it under Calendar and list it
# under Tasks, and the writer must recreate it on the target declaring the same
# component. A regression in any of that shows up here as a missing item rather
# than as a customer's to-do list arriving in their calendar.
#
# MKCALENDAR is issued only when the collection is not already there, and 405
# (Method Not Allowed, which is what a server answers for a collection that
# exists) counts as "already there" rather than as a failure — bring-up calls
# this repeatedly and must converge (hard rule 1).
#
# WHAT IT DOES NOT DO
# -------------------
# It does not touch the ledger. Writing `status='copied'` rows directly would
# hand the smoke its precondition and prove nothing — worse, it would be a
# claim that a copy happened, in the table whose entire job is to record copies
# that did. The data goes into the SOURCE, and a real sync earns the rows.
#
# THE FIXED FIXTURE IS NOT RENEWABLE — WHY `--fresh` EXISTS (run #20)
# -------------------------------------------------------------------
# The names below are FIXED (`openmig-demo-event-1.ics` and friends), and the
# natural key the ledger stores is the VEVENT/vCard UID or the file path — so
# re-running this script re-PUTs the SAME natural keys. That is what makes the
# bring-up call idempotent, and it is also, on its own, a ratchet.
#
# `smoke-managed.sh`'s apply half applies a REAL deletion to one eligible item
# per run, and `applyDeletion` writes `status='tombstoned'`. `classifyKnownItem`
# then refuses to ever re-create a tombstoned key — deliberately, because it
# cannot tell a change of mind from an erasure request. So every green run of
# the managed gate permanently spends one of these six items, and re-seeding
# cannot give it back: the PUT succeeds, the sync sees the key again, and the
# only thing that happens is a "reappeared after removal" warning.
#
# Six items, one spent per green run. e2e-managed #19 (2026-08-19 13:11) spent
# the last one — 3 calendar + 4 contact + 2 file rows all `tombstoned`, 64 files
# `adopted` — and #20, four hours later, had nothing eligible left and failed
# with "no eligible item". Nothing regressed between them; the gate had simply
# eaten its own fixture, and would have failed every run from then on.
#
# `--fresh` is the way out: it seeds a triple whose UIDs and paths carry a tag
# unique to this invocation, so the natural keys have never been seen by the
# ledger and CANNOT collide with a tombstone. The smoke's prepare phase uses it;
# bring-up does not, because bring-up wants the same handful of demo resources
# every time.
#
# WHAT `--fresh` COSTS, stated rather than discovered later: it adds resources
# to a long-lived source instead of overwriting them. It seeds SIX (two per
# domain) and the smoke spends one per run, and it only ever runs when nothing
# eligible is left — so the steady state is roughly one new object per run, each
# a few hundred bytes.
#
# `--remove <tag>` is how that is bounded, and the smoke now calls it against
# BOTH accounts at the end of a run: the source it seeded, and the target the
# sync copied into. An earlier version of this note said to prune the source and
# never the ledger, "which is the record". That is right about pruning the
# LEDGER ALONE — rows deleted while their objects remain destroy the record of
# things that still exist. It is wrong about the coordinated removal the smoke
# does now: source object, target copy and ledger row go together, as one
# fixture being taken back, and what is left describes exactly what is there.
#
# The one row that STAYS is the tombstone. `applyDeletion` wrote it to say a key
# was erased and `classifyKnownItem` must never re-create it (ADR-0024, hard
# rule 2) — so the gate is net zero minus one tombstone per run, deliberately.
#
# USAGE
#   ./deploy/compose/seed-demo-dav-content.sh            # seed fixed demo content, then verify
#   ./deploy/compose/seed-demo-dav-content.sh --verify   # verify only
#   ./deploy/compose/seed-demo-dav-content.sh --fresh    # seed a uniquely-tagged set (never tombstoned)
#   ./deploy/compose/seed-demo-dav-content.sh --remove T # take one --fresh set back again
#   ./deploy/compose/seed-demo-dav-content.sh --big-sha256 T  # the large file's sha256, one line
#
# Env overrides:
#   NEXTCLOUD_CONTAINER  (default ownpace-nextcloud, matches managed.yml)
#   DAV_TASK_COLLECTION  the VTODO-only collection's name under calendars/
#                        (default openmig-tasks). Its own name rather than
#                        `personal`, because the point is a collection that
#                        declares VTODO and nothing else.
#   DAV_USER / DAV_PASSWORD  the demo SOURCE account; the defaults match
#                            seed-managed.ts's tenant B source credentials. Point
#                            them at the TARGET account and `--remove` cleans the
#                            copies the sync made there — same names, because the
#                            natural key IS the name.
#   SEED_DAV_TAG         the tag `--fresh` uses; defaults to a UTC timestamp
#                        plus this process's pid. Set it to make a run
#                        reproducible, never to a value used before.
#   SEED_DAV_BIG_FILE_MB the size of the one file that crosses the streaming
#                        threshold (default 32). Must be above 8 and below 256
#                        — the two constants in packages/connectors and
#                        packages/shared that decide whether a file is
#                        streamed, buffered, or refused. Seeded by `--fresh`
#                        only, from /dev/urandom inside the container, and
#                        never written into this repository.
#
# Every request runs INSIDE the Nextcloud container against http://localhost,
# which is always a trusted domain — so this needs no published port, no
# compose network membership and no NEXTCLOUD_TRUSTED_DOMAINS entry, the three
# things that made the surrounding demo scripts fiddly to run from anywhere but
# the host that happened to work.
set -uo pipefail

NC="${NEXTCLOUD_CONTAINER:-ownpace-nextcloud}"
DAVUSER="${DAV_USER:-tenant-b-source}"
PASS="${DAV_PASSWORD:-tenant_b_source_pw}"
VERIFY_ONLY=0
# Empty TAG = the fixed, idempotent demo fixture. Non-empty = a set of natural
# keys the ledger has never seen, which is the only kind a tombstone cannot
# already own. See the header.
TAG=""

fail() { echo "ERROR: $*" >&2; exit 1; }

REMOVE_ONLY=0
BIG_SHA_ONLY=0
case "${1:-}" in
  --verify) VERIFY_ONLY=1 ;;
  --fresh) TAG="${2:-${SEED_DAV_TAG:-$(date -u +%Y%m%dT%H%M%SZ)-$$}}" ;;
  # `--remove <tag>` undoes one `--fresh <tag>`, and takes the tag as a REQUIRED
  # argument rather than defaulting it. A default here would be a timestamp
  # nothing was ever seeded under — harmless — or, worse, an environment
  # variable left over from a seed, which would delete a set somebody is still
  # using. A delete that guesses its own target is not a delete anybody should
  # write (hard rule 2).
  --remove)
    REMOVE_ONLY=1
    TAG="${2:-}"
    [ -n "$TAG" ] || fail "--remove needs the tag to remove: --remove <tag>"
    # The fixed fixture has no tag, and is the thing bring-up depends on. An
    # empty tag would match every resource in the account.
    ;;
  # `--big-sha256 <tag>` is READ ONLY, and prints ONE LINE: the sha256 of the
  # large file `--fresh <tag>` seeded, read back out of the SOURCE account.
  #
  # It exists so the managed smoke can compare that digest against the one the
  # ledger stored (0120 T6) without learning this account's password. The
  # alternative was for the smoke to parse a hash out of `--fresh`'s stdout,
  # which the tag comment above already rejects for the tag: a second source of
  # truth for one string. The file itself is the first and only one.
  --big-sha256)
    BIG_SHA_ONLY=1
    TAG="${2:-}"
    [ -n "$TAG" ] || fail "--big-sha256 needs the tag to read: --big-sha256 <tag>"
    ;;
  "") ;;
  *) fail "unknown argument '$1' (expected --verify, --fresh <tag>, --remove <tag>, --big-sha256 <tag>, or nothing)" ;;
esac
# The names carry the tag in the middle, so `openmig-demo-event-` stays the
# prefix everything greps for — the verification below, and anybody reading the
# source account.
SUFFIX=""
[ -n "$TAG" ] && SUFFIX="${TAG}-"

docker exec "$NC" true 2>/dev/null || fail "cannot exec into Nextcloud container '$NC' (set NEXTCLOUD_CONTAINER)"
docker exec "$NC" sh -lc 'command -v curl >/dev/null' \
  || fail "no curl inside '$NC' — install it there, or run these PUTs from a host that can reach Nextcloud"

# dav <method> <path> [content-type] [body]  — path is relative to /remote.php/dav/
# The curl arguments are built as an ARRAY rather than with
# `${ctype:+-H "Content-Type: $ctype"}`. That conditional form does in fact
# survive word-splitting — bash honours the quotes inside the alternate value,
# and `text/calendar; charset=utf-8` arrives as one argument; I checked before
# writing this rather than after. The array is used because it is obvious at a
# glance that it holds, where the conditional form is a thing you have to know.
# THE ONE FILE BIGGER THAN A CHUNK (workplan 0120 T6).
#
# WHY A FIXTURE HAS TO BE THIS BIG. Every other fixture in this repository is a
# few hundred bytes, and that is exactly why buffering a whole file into memory
# went unnoticed for as long as it did: no gate ever handed the file path more
# than one chunk. `WebdavFileSource.fetch` streams above
# STREAM_FILES_LARGER_THAN_BYTES (8 MB) and buffers below it, so a fixture
# under that threshold exercises the branch the defect was NOT in.
#
# 32 MB: four times the threshold, an eighth of MAX_BUFFERED_FILE_BYTES (256
# MB). Above, so it streams; well below, so it never reaches the refusal —
# which is a different path and not what this proves. It is also small enough
# that the runner does not notice: the demo Nextcloud writes it to its own
# volume and the smoke reads it back once.
#
# RANDOM BYTES, NOT ZEROS. Zeros would hash to a constant and make the expected
# digest a literal, which is tempting and wrong: a stream that emitted its
# chunks out of order, or the same chunk twice, produces exactly the same file
# of zeros and the same digest. Random content makes the digest depend on every
# byte arriving once, in order. The cost is that the expected value cannot be
# written down, which is what `--big-sha256` is for.
#
# NEVER COMMITTED. Generated inside the container at seed time and deleted
# after. A 32 MB fixture in git is refused by the `No Committed Artifacts` job,
# and would be permanent in the history even once removed.
BIG_FILE_MB="${SEED_DAV_BIG_FILE_MB:-32}"
case "$BIG_FILE_MB" in
  '' | *[!0-9]*) fail "SEED_DAV_BIG_FILE_MB must be a whole number of megabytes, got '${BIG_FILE_MB}'" ;;
esac
# The two ends are named rather than assumed, because a size that drifts out of
# this range does not fail — it passes, having tested the wrong branch.
[ "$BIG_FILE_MB" -gt 8 ] \
  || fail "SEED_DAV_BIG_FILE_MB=${BIG_FILE_MB} is not above STREAM_FILES_LARGER_THAN_BYTES (8 MB).
    A file at or below the threshold is BUFFERED, so it proves the branch this
    fixture exists to avoid. See packages/connectors/src/webdav-source.ts."
[ "$BIG_FILE_MB" -lt 256 ] \
  || fail "SEED_DAV_BIG_FILE_MB=${BIG_FILE_MB} reaches MAX_BUFFERED_FILE_BYTES (256 MB).
    At the ceiling the path REFUSES the item rather than copying it — a
    different behaviour, correctly, and not the one 0120 T6 is about.
    See packages/shared/src/file-body.ts."

# The path of this run's large file. Empty in fixed-fixture mode: a 32 MB write
# on every bring-up buys nothing, and the fixed fixture's keys are single-use
# tombstones anyway — it is the `--fresh` set that actually gets synced.
BIG_FILE_NAME=""
[ -n "$TAG" ] && BIG_FILE_NAME="openmig-demo-bigfile-${SUFFIX}1.bin"

dav() {
  local method="$1" path="$2" ctype="${3:-}" body="${4:-}"
  local args=(-sS -o /dev/null -w '%{http_code}' -X "$method" -u "${DAVUSER}:${PASS}")
  # Schedule-Reply: F on every DELETE (RFC 6638 §8.1, 0103 T5): the take-back
  # removes organiser copies of events that can carry attendees — the canary
  # above does — and on a scheduling server a bare DELETE fans out CANCEL.
  # This header says "remove, tell nobody"; servers without scheduling ignore
  # an unknown header.
  [ "$method" = "DELETE" ] && args+=(-H 'Schedule-Reply: F')
  [ -n "$ctype" ] && args+=(-H "Content-Type: ${ctype}")
  [ -n "$body" ] && args+=(--data-binary @-)
  docker exec -i "$NC" curl "${args[@]}" "http://localhost/remote.php/dav/${path}" <<<"$body"
}

# dav_upload <path> <container-local file>  — PUT a file too big for a heredoc.
#
# `dav` pipes its body in through stdin, which is right for a vCard and wrong
# for 32 MB: the bytes would cross bash, the docker socket and a here-string,
# and bash would hold the whole thing as a variable first. `--upload-file` hands
# curl a path INSIDE the container, so the bytes never leave it.
dav_upload() {
  local path="$1" file="$2"
  docker exec "$NC" curl -sS -o /dev/null -w '%{http_code}' \
    -u "${DAVUSER}:${PASS}" --upload-file "$file" \
    "http://localhost/remote.php/dav/${path}"
}

# big_file_sha256 — the digest of the large file, read back out of the account.
#
# Downloaded to a file FIRST and hashed second, rather than piped. `curl | sha256sum`
# in a pipeline reports the exit status of sha256sum, so a 404 prints the digest of
# the empty string and returns 0 — a confident wrong answer, and one the smoke would
# then compare against the ledger and call a mismatch in the product.
big_file_sha256() {
  docker exec "$NC" sh -c '
    set -e
    tmp=$(mktemp)
    trap "rm -f \"$tmp\"" EXIT
    curl -sSf -u "$1:$2" -o "$tmp" "http://localhost/remote.php/dav/$3"
    sha256sum "$tmp" | cut -d" " -f1
  ' _ "$DAVUSER" "$PASS" "${FILES}${BIG_FILE_NAME}"
}

# The read-side twin of `dav`, and defined HERE rather than beside its first
# reader: `--remove` verifies its own work and runs long before the seeding
# section, so a definition further down is one bash reaches only after the
# deletes have already happened. `count: command not found`, after the fact.
count() { # count <collection> <needle>  — number of matching hrefs, not lines
  docker exec "$NC" curl -sS -X PROPFIND -H 'Depth: 1' -u "${DAVUSER}:${PASS}" \
    "http://localhost/remote.php/dav/$1" 2>/dev/null | grep -o "$2" | wc -l | tr -d ' '
}

# ocs <method> <path> [field=value...] — the OCS door beside dav()'s DAV one,
# for the share the inventory must find (0104 T2). Prints the JSON body; the
# caller reads the envelope.
ocs() {
  local method="$1" path="$2"; shift 2
  local args=(-sS -X "$method" -u "${DAVUSER}:${PASS}" -H 'OCS-APIRequest: true' -H 'Accept: application/json')
  local field
  for field in "$@"; do args+=(--data-urlencode "$field"); done
  docker exec "$NC" curl "${args[@]}" "http://localhost/ocs/v2.php/apps/files_sharing/api/v1/${path}?format=json"
}

# Nextcloud's own layout is not symmetric — calendars live under
# `calendars/<user>/`, address books under `addressbooks/users/<user>/`. Both
# spellings are tried rather than assumed, because getting it wrong produces a
# 404 that looks exactly like "the collection is missing".
discover() { # discover <candidate-path>...  — echoes the first that answers 207
  local p
  for p in "$@"; do
    if [ "$(docker exec "$NC" curl -sS -o /dev/null -w '%{http_code}' \
            -X PROPFIND -H 'Depth: 0' -u "${DAVUSER}:${PASS}" \
            "http://localhost/remote.php/dav/${p}")" = "207" ]; then
      echo "$p"; return 0
    fi
  done
  return 1
}

CAL="$(discover "calendars/${DAVUSER}/personal/" "calendars/users/${DAVUSER}/personal/")" \
  || fail "no personal calendar for '${DAVUSER}' — does the account exist? run setup-managed-demo.sh first"
ABK="$(discover "addressbooks/users/${DAVUSER}/contacts/" "addressbooks/${DAVUSER}/contacts/")" \
  || fail "no default address book for '${DAVUSER}' — does the account exist?"
FILES="files/${DAVUSER}/"
discover "$FILES" >/dev/null || fail "no files home for '${DAVUSER}' — does the account exist?"

# THE TASK LIST (0113 T7). Its own collection, declaring VTODO and nothing
# else — see the header. `discover` first, because MKCALENDAR against a
# collection that exists is a 405 and bring-up runs this every time.
TASK_COLLECTION="${DAV_TASK_COLLECTION:-openmig-tasks}"
TASKS="$(discover "calendars/${DAVUSER}/${TASK_COLLECTION}/" "calendars/users/${DAVUSER}/${TASK_COLLECTION}/" || true)"

# make_task_list — MKCALENDAR the VTODO-only collection, or accept the one
# already there. Echoes the path it settled on.
#
# The component set is the entire point of the request: a collection created
# WITHOUT it declares nothing, which RFC 4791 §5.2.3 reads as "may contain any
# component type" — and a gate seeded into that collection would pass whether
# or not the source can tell a task list from a calendar, which is the one
# thing it exists to check.
make_task_list() {
  local path="calendars/${DAVUSER}/${TASK_COLLECTION}/"
  local code
  code=$(dav MKCALENDAR "$path" 'application/xml; charset=utf-8' \
"<?xml version=\"1.0\" encoding=\"utf-8\"?>
<C:mkcalendar xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\">
  <D:set>
    <D:prop>
      <D:displayname>Ownpace demo tasks</D:displayname>
      <C:supported-calendar-component-set>
        <C:comp name=\"VTODO\"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>")
  case "$code" in
    201|204) echo "$path" ;;
    # 405 is a collection that already exists — the converging answer, not a
    # failure. So is 403 from a server that reserves MKCALENDAR: if the
    # collection is really there, `discover` above would have found it, so
    # reaching here with a 403 means it is not, and that IS a failure.
    405) echo "$path" ;;
    *) return 1 ;;
  esac
}

# `--big-sha256` answers and stops, ABOVE the banner below, because its whole
# contract is one line on stdout that a caller can put in a variable. A script
# that also prints where it looked is a script whose output has to be parsed.
if [ "$BIG_SHA_ONLY" = "1" ]; then
  big_file_sha256 \
    || fail "could not read ${FILES}${BIG_FILE_NAME} from ${DAVUSER} — was --fresh ${TAG} ever run,
    and did its large-file PUT succeed? A digest is only meaningful if the file
    is there; this refuses rather than printing the digest of nothing."
  exit 0
fi

echo "[seed-dav] account ${DAVUSER}"
echo "[seed-dav]   calendar     ${CAL}"
echo "[seed-dav]   addressbook  ${ABK}"
echo "[seed-dav]   files        ${FILES}"
echo "[seed-dav]   task list    ${TASKS:-<absent>}"
if [ "$REMOVE_ONLY" = "1" ]; then
  echo "[seed-dav]   mode         REMOVE, tag ${TAG} — undoing one --fresh seed"
elif [ -n "$TAG" ]; then
  echo "[seed-dav]   mode         FRESH, tag ${TAG} — natural keys the ledger has never seen"
else
  echo "[seed-dav]   mode         fixed demo fixture (openmig-demo-*-1, -2), overwritten in place"
fi

if [ "$REMOVE_ONLY" = "1" ]; then
  # WHY THIS EXISTS. `--fresh` adds three resources per invocation and the
  # managed gate calls it whenever nothing is eligible, so the demo SOURCE grew
  # by a set that nothing ever took away — for as long as the gate kept running.
  # That is a measurement changing the thing it measures.
  #
  # Removal is bounded by the tag and by the `openmig-demo-` prefix, both. The
  # tag alone would already be narrow; the prefix means a mistyped tag deletes
  # nothing rather than something, which is the direction an error should fall.
  #
  # 404 is SUCCESS here. The point is that the resource is gone, and a set that
  # was already removed — a re-run, or a seed that half-failed — must converge
  # rather than refuse (hard rule 1).
  gone=0
  for n in 1 2; do
    # The task list is only in this loop when it EXISTS. `--remove` never
    # creates a collection: making one in order to empty it would be a write on
    # the take-back path, and an absent collection already means the tasks
    # under it are absent too (hard rule 2 — a removal that guesses its own
    # target is not one anybody should write).
    task_spec=""
    [ -n "$TASKS" ] && task_spec="${TASKS}openmig-demo-task-${SUFFIX}${n}.ics"
    # The large file is seeded once per set (n=1), so it is removed once too.
    # It MUST be in this list: it is 32 MB, `--fresh` runs whenever the gate
    # finds nothing eligible, and a set that nothing takes away would grow the
    # demo source by a third of a gigabyte a month — the measurement changing
    # the thing it measures, which is the whole reason `--remove` exists.
    big_spec=""
    [ "$n" = "1" ] && [ -n "$BIG_FILE_NAME" ] && big_spec="${FILES}${BIG_FILE_NAME}"
    for spec in "${CAL}openmig-demo-event-${SUFFIX}${n}.ics" \
                ${task_spec:+"$task_spec"} \
                "${ABK}openmig-demo-contact-${SUFFIX}${n}.vcf" \
                "${FILES}openmig-demo-file-${SUFFIX}${n}.txt" \
                ${big_spec:+"$big_spec"}; do
      code=$(dav DELETE "$spec")
      case "$code" in
        204|200|404) gone=$((gone + 1)) ;;
        *) fail "DELETE ${spec} returned ${code} — refusing to report a removal that did not happen" ;;
      esac
    done
  done
  echo "[seed-dav] removed (or already absent): ${gone} resources under tag ${TAG}"

  # And PROVE it, rather than trusting six status codes — the same distinction
  # the verification below was written for.
  left=$(( $(count "$CAL" "openmig-demo-event-${SUFFIX}") \
         + $(count "$ABK" "openmig-demo-contact-${SUFFIX}") \
         + $(count "$FILES" "openmig-demo-file-${SUFFIX}") \
         + $(count "$FILES" "openmig-demo-bigfile-${SUFFIX}") ))
  [ -n "$TASKS" ] && left=$(( left + $(count "$TASKS" "openmig-demo-task-${SUFFIX}") ))
  [ "$left" = "0" ] || fail "${left} resource(s) tagged ${TAG} are still present after removal"
  echo "[seed-dav] source is clean of tag ${TAG}"
  exit 0
fi

# THE SCHEDULING CANARY (0103 T2 / ADR-0043). Fresh event 1 carries an
# ORGANIZER and an ATTENDEE, tag-addressed so one run's mail can never answer
# for another's (the SMOKE_MAIL_RUN lesson). The ORGANIZER is deliberately a
# THIRD PARTY — not the seeding account — which is what a migrated mailbox
# mostly holds: other people's meetings. Sabre-family servers schedule only
# when the collection owner matches ORGANIZER or an ATTENDEE, so seeding this
# does not mail; what the smoke then asserts is that syncing and taking it
# back did not either, and that the copy on the target carries
# SCHEDULE-AGENT=CLIENT — the writer's neutralising, observed on real bytes.
# Fixed-fixture mode (no tag) stays canary-free: those two events belong to
# the demo UI, not to this gate.
SCHED_PROPS=""
if [ -n "$TAG" ]; then
  SCHED_PROPS="ORGANIZER;CN=Someone Else:mailto:openmig-organizer-${TAG}@example.invalid
ATTENDEE;CN=Migration Canary;PARTSTAT=NEEDS-ACTION:mailto:openmig-attendee-${TAG}@example.invalid
"
fi

if [ "$VERIFY_ONLY" = "0" ]; then
  # The collection has to exist before anything can be PUT into it, and it is
  # created here rather than at discovery time so `--verify` and `--remove`
  # stay read-only about it.
  if [ -z "$TASKS" ]; then
    TASKS="$(make_task_list)" \
      || fail "could not create the VTODO-only task list at calendars/${DAVUSER}/${TASK_COLLECTION}/"
    echo "[seed-dav]   task list    ${TASKS} (created, declares VTODO only)"
  fi

  for n in 1 2; do
    # Injected by PARAMETER expansion, never command substitution: `$(...)`
    # strips every trailing newline, which glued END:VEVENT onto the ATTENDEE
    # line — one unterminated VEVENT, Sabre answered 415, and the whole fresh
    # seed died (E2E managed #87). `${EVENT_PROPS}` hands the value over
    # byte-for-byte, trailing newline included.
    EVENT_PROPS=""
    if [ "$n" = "1" ]; then EVENT_PROPS="$SCHED_PROPS"; fi
    code=$(dav PUT "${CAL}openmig-demo-event-${SUFFIX}${n}.ics" 'text/calendar; charset=utf-8' \
"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenMigrate//demo//EN
BEGIN:VEVENT
UID:openmig-demo-event-${SUFFIX}${n}
DTSTAMP:20260101T000000Z
DTSTART:2026010${n}T100000Z
DTEND:2026010${n}T110000Z
SUMMARY:Ownpace demo event ${SUFFIX}${n}
DESCRIPTION:Seeded by seed-demo-dav-content.sh so the demo has something to sync.
STATUS:CONFIRMED
${EVENT_PROPS}END:VEVENT
END:VCALENDAR")
    echo "[seed-dav] event ${SUFFIX}${n}: HTTP ${code}"
    case "$code" in 201|204) ;; *) fail "calendar PUT ${SUFFIX}${n} returned ${code}" ;; esac

    # THE TASK (0113 T7). A VTODO, in the VTODO-only collection — the shape
    # this product spent its first four domains unable to tell from an event.
    # No ORGANIZER or ATTENDEE: a task carries no scheduling, so the canary
    # above has nothing to say here, and adding one would make this fixture
    # test two things at once.
    code=$(dav PUT "${TASKS}openmig-demo-task-${SUFFIX}${n}.ics" 'text/calendar; charset=utf-8' \
"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenMigrate//demo//EN
BEGIN:VTODO
UID:openmig-demo-task-${SUFFIX}${n}
DTSTAMP:20260101T000000Z
DUE:2026010${n}T170000Z
SUMMARY:Ownpace demo task ${SUFFIX}${n}
DESCRIPTION:Seeded by seed-demo-dav-content.sh so the task lane has something to copy.
STATUS:NEEDS-ACTION
PERCENT-COMPLETE:0
END:VTODO
END:VCALENDAR")
    echo "[seed-dav] task ${SUFFIX}${n}: HTTP ${code}"
    case "$code" in 201|204) ;; *) fail "task PUT ${SUFFIX}${n} returned ${code}" ;; esac

    code=$(dav PUT "${ABK}openmig-demo-contact-${SUFFIX}${n}.vcf" 'text/vcard; charset=utf-8' \
"BEGIN:VCARD
VERSION:3.0
UID:openmig-demo-contact-${SUFFIX}${n}
FN:Demo Contact ${SUFFIX}${n}
N:Contact;Demo ${SUFFIX}${n};;;
EMAIL;TYPE=INTERNET:demo${n}@demo.openmigrate.test
END:VCARD")
    echo "[seed-dav] contact ${SUFFIX}${n}: HTTP ${code}"
    case "$code" in 201|204) ;; *) fail "contact PUT ${SUFFIX}${n} returned ${code}" ;; esac

    code=$(dav PUT "${FILES}openmig-demo-file-${SUFFIX}${n}.txt" 'text/plain' \
"Ownpace demo file ${n}. Seeded so the file lane has something to copy.")
    echo "[seed-dav] file ${SUFFIX}${n}: HTTP ${code}"
    case "$code" in 201|204) ;; *) fail "file PUT ${SUFFIX}${n} returned ${code}" ;; esac

    # THE ONE FILE BIGGER THAN A CHUNK (0120 T6). Once per fresh set, not once
    # per n: the point is that ONE file crosses the streaming threshold, and a
    # second would double the seed's cost to prove the same thing twice.
    #
    # Fresh sets only, for the same reason the canary above is: the fixed demo
    # fixture belongs to the demo UI, and 32 MB rewritten on every bring-up is
    # a cost with nothing behind it.
    if [ "$n" = "1" ] && [ -n "$BIG_FILE_NAME" ]; then
      # Generated in the container's own /tmp and removed in the same command,
      # whichever way the PUT went. `conv=fsync` because the upload reads the
      # file back immediately and a partially-flushed 32 MB would upload short
      # and hash differently — a failure that would read as a streaming bug.
      big_sha=$(docker exec "$NC" sh -c '
        set -e
        dd if=/dev/urandom of=/tmp/openmig-bigfile.bin bs=1M count="$1" conv=fsync 2>/dev/null
        sha256sum /tmp/openmig-bigfile.bin | cut -d" " -f1
      ' _ "$BIG_FILE_MB") \
        || fail "could not generate the ${BIG_FILE_MB} MB fixture inside ${NC}"

      code=$(dav_upload "${FILES}${BIG_FILE_NAME}" /tmp/openmig-bigfile.bin)
      docker exec "$NC" rm -f /tmp/openmig-bigfile.bin || true
      echo "[seed-dav] big file ${BIG_FILE_NAME}: HTTP ${code} (${BIG_FILE_MB} MB, sha256 ${big_sha})"
      case "$code" in
        201|204) ;;
        # 413 is the one worth naming: Nextcloud's PHP limits, not this script.
        413) fail "the ${BIG_FILE_MB} MB fixture was REFUSED as too large (413).
    Raise upload_max_filesize/post_max_size in the Nextcloud container, or lower
    SEED_DAV_BIG_FILE_MB — but never below 8, or it stops proving anything." ;;
        *) fail "big file PUT ${BIG_FILE_NAME} returned ${code}" ;;
      esac

      # Read it BACK and compare. The PUT's status code says the server accepted
      # a request; it does not say the bytes on the other side are the bytes that
      # left. This is the same distinction the verification section below the
      # loop was written for, and the whole gate downstream rests on this file's
      # digest being the one the ledger will be asked to match.
      landed=$(big_file_sha256) \
        || fail "the big file was PUT and cannot be read back — ${FILES}${BIG_FILE_NAME}"
      [ "$landed" = "$big_sha" ] \
        || fail "the big file changed in transit: wrote ${big_sha}, read back ${landed}.
    Nothing downstream can be trusted while that is true — the smoke compares the
    ledger's content_hash against what this account holds."
    fi

    # THE SHARE THE INVENTORY MUST FIND (0104 T2). The source really shares
    # its tagged file BY MAIL with a tag-addressed outsider — which SENDS ONE
    # MAIL FROM THE SOURCE, here, at seed time: the seed's own act, caught by
    # the catcher like everything else, and told apart from the press's later
    # mail by the note only the press writes. Tag-gated like the canary: the
    # fixed demo fixture stays share-free. Deleting the file at --remove
    # takes the share with it (Nextcloud removes shares with their subject),
    # so the take-back needs no extra verb.
    if [ "$n" = "1" ] && [ -n "$TAG" ]; then
      share_body="$(ocs POST shares \
        "path=/openmig-demo-file-${SUFFIX}1.txt" \
        "shareType=4" \
        "shareWith=openmig-grantee-${TAG}@example.invalid")"
      if grep -q '"status":"ok"' <<<"$share_body"; then
        echo "[seed-dav] source share ${SUFFIX}1 -> openmig-grantee-${TAG}@example.invalid (by mail)"
      else
        fail "source share for ${SUFFIX}1 was refused: $(head -c 200 <<<"$share_body")"
      fi
    fi
  done
fi

# ---------- verify, because "the PUTs returned 201" is not "the data is there" ----------
# The same distinction this whole workplan is about: a script that reports what
# it attempted rather than what is true is how the gate came to be green while
# its apply half had never run.
#
# `grep -o | wc -l` counts OCCURRENCES, not matching lines. `grep -c` counts
# lines, and Nextcloud returns the whole multistatus on ONE line — so it
# answered `1` however many resources were there, and the evidence for run #20
# reads "event 1: HTTP 204 / event 2: HTTP 204 / present now — events:1". Two
# writes, one reported. A verification step that cannot tell one from two is
# most of the way back to trusting the PUT's own status code.
# In `--fresh` mode the needle carries the tag: the fixed resources are almost
# certainly still sitting there from bring-up, and counting them would let a
# fresh seed that wrote nothing at all report itself present.
ev=$(count "$CAL" "openmig-demo-event-${SUFFIX}")
ct=$(count "$ABK" "openmig-demo-contact-${SUFFIX}")
# `openmig-demo-file-` does NOT match `openmig-demo-bigfile-`, so the two counts
# are independent and neither can answer for the other. Counted separately for
# exactly that reason: a fresh set whose small files landed and whose 32 MB one
# did not would otherwise report `files:2` and look complete, while the one
# fixture that crosses the streaming threshold was missing.
fl=$(count "$FILES" "openmig-demo-file-${SUFFIX}")
bg=0
[ -n "$BIG_FILE_NAME" ] && bg=$(count "$FILES" "openmig-demo-bigfile-${SUFFIX}")
tk=0
[ -n "$TASKS" ] && tk=$(count "$TASKS" "openmig-demo-task-${SUFFIX}")
echo "[seed-dav] present now — events:${ev} tasks:${tk} contacts:${ct} files:${fl} big:${bg}"
[ "$ev" -ge 1 ] && [ "$ct" -ge 1 ] && [ "$fl" -ge 1 ] && [ "$tk" -ge 1 ] \
  || fail "seeding did not stick — nothing to sync, so the apply half would still find no item"
# Only in fresh mode: the fixed fixture has never carried a large file and is
# not the set the gate syncs.
if [ -n "$BIG_FILE_NAME" ]; then
  [ "$bg" -ge 1 ] \
    || fail "the ${BIG_FILE_MB} MB fixture is not in the source (0120 T6).
    Without it every file this set copies is under the 8 MB streaming threshold,
    so the gate would run green having exercised only the buffered branch."
fi

# The heredoc below stays QUOTED. It contains `$POSTGRES_USER`, `$POSTGRES_DB`
# and backticked words, all of which are meant to reach the reader literally —
# unquoting it to interpolate one tag would expand the first two to nothing and
# RUN the backticks as commands. So the tag is printed on its own line first.
[ -n "$TAG" ] && echo "[seed-dav] seeded under tag ${TAG} — these keys are new to the ledger."
cat <<'NEXT'

[seed-dav] OK. What happens next, and what still has to be true:
  1. The scheduler's sync tick copies these into the demo TARGET account.
  2. That pass writes `item` rows with status='copied' and a target_ref id.
  3. Only then does smoke-managed.sh's apply half have an eligible item.
Watch it land (the scheduler ticks every minute, so give it one):
  docker exec -i ownpace-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
  SELECT domain, status, count(*) FROM item
   WHERE mapping_id='b0000000-0000-4000-8000-0000000000d1'
   GROUP BY 1,2;
SQL
  -- `domain`, NOT `item_type`. The item table carries both: `domain`
  -- ('email','calendar','contact','file','task') is what the ledger writes, and
  -- `item_type` is a legacy column nothing maintains, NOT NULL with
  -- DEFAULT 'mail'. Grouping by it answers `mail` for every row on a
  -- calendar/contact/file mapping — a confident wrong answer, which is
  -- worse than an error. See ledger.ts's note on the unique constraint.
NEXT
