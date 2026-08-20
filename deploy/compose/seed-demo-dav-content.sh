#!/usr/bin/env bash
# seed-demo-dav-content.sh — put real calendar, contact and file data into the
# demo Nextcloud SOURCE account, so the demo tenant B mapping has something to
# sync (workplan 0084, run #7).
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
# a few hundred bytes. If that ever needs bounding, prune the tagged resources
# from the source; do NOT prune the ledger rows, which are the record.
#
# USAGE
#   ./deploy/compose/seed-demo-dav-content.sh            # seed fixed demo content, then verify
#   ./deploy/compose/seed-demo-dav-content.sh --verify   # verify only
#   ./deploy/compose/seed-demo-dav-content.sh --fresh    # seed a uniquely-tagged set (never tombstoned)
#
# Env overrides:
#   NEXTCLOUD_CONTAINER  (default ownpace-nextcloud, matches managed.yml)
#   DAV_USER / DAV_PASSWORD  the demo SOURCE account; the defaults match
#                            seed-managed.ts's tenant B source credentials.
#   SEED_DAV_TAG         the tag `--fresh` uses; defaults to a UTC timestamp
#                        plus this process's pid. Set it to make a run
#                        reproducible, never to a value used before.
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

case "${1:-}" in
  --verify) VERIFY_ONLY=1 ;;
  --fresh) TAG="${2:-${SEED_DAV_TAG:-$(date -u +%Y%m%dT%H%M%SZ)-$$}}" ;;
  "") ;;
  *) fail "unknown argument '$1' (expected --verify, --fresh, or nothing)" ;;
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
dav() {
  local method="$1" path="$2" ctype="${3:-}" body="${4:-}"
  local args=(-sS -o /dev/null -w '%{http_code}' -X "$method" -u "${DAVUSER}:${PASS}")
  [ -n "$ctype" ] && args+=(-H "Content-Type: ${ctype}")
  [ -n "$body" ] && args+=(--data-binary @-)
  docker exec -i "$NC" curl "${args[@]}" "http://localhost/remote.php/dav/${path}" <<<"$body"
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

echo "[seed-dav] account ${DAVUSER}"
echo "[seed-dav]   calendar     ${CAL}"
echo "[seed-dav]   addressbook  ${ABK}"
echo "[seed-dav]   files        ${FILES}"
if [ -n "$TAG" ]; then
  echo "[seed-dav]   mode         FRESH, tag ${TAG} — natural keys the ledger has never seen"
else
  echo "[seed-dav]   mode         fixed demo fixture (openmig-demo-*-1, -2), overwritten in place"
fi

if [ "$VERIFY_ONLY" = "0" ]; then
  for n in 1 2; do
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
END:VEVENT
END:VCALENDAR")
    echo "[seed-dav] event ${SUFFIX}${n}: HTTP ${code}"
    case "$code" in 201|204) ;; *) fail "calendar PUT ${SUFFIX}${n} returned ${code}" ;; esac

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
count() { # count <collection> <needle>  — number of matching hrefs, not lines
  docker exec "$NC" curl -sS -X PROPFIND -H 'Depth: 1' -u "${DAVUSER}:${PASS}" \
    "http://localhost/remote.php/dav/$1" 2>/dev/null | grep -o "$2" | wc -l | tr -d ' '
}
# In `--fresh` mode the needle carries the tag: the fixed resources are almost
# certainly still sitting there from bring-up, and counting them would let a
# fresh seed that wrote nothing at all report itself present.
ev=$(count "$CAL" "openmig-demo-event-${SUFFIX}")
ct=$(count "$ABK" "openmig-demo-contact-${SUFFIX}")
fl=$(count "$FILES" "openmig-demo-file-${SUFFIX}")
echo "[seed-dav] present now — events:${ev} contacts:${ct} files:${fl}"
[ "$ev" -ge 1 ] && [ "$ct" -ge 1 ] && [ "$fl" -ge 1 ] \
  || fail "seeding did not stick — nothing to sync, so the apply half would still find no item"

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
  -- ('email','calendar','contact','file') is what the ledger writes, and
  -- `item_type` is a legacy column nothing maintains, NOT NULL with
  -- DEFAULT 'mail'. Grouping by it answers `mail` for every row on a
  -- calendar/contact/file mapping — a confident wrong answer, which is
  -- worse than an error. See ledger.ts's note on the unique constraint.
NEXT
