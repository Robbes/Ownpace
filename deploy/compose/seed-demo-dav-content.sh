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
# USAGE
#   ./deploy/compose/seed-demo-dav-content.sh            # seed, then verify
#   ./deploy/compose/seed-demo-dav-content.sh --verify   # verify only
#
# Env overrides:
#   NEXTCLOUD_CONTAINER  (default open-migrate-nextcloud, matches managed.yml)
#   DAV_USER / DAV_PASSWORD  the demo SOURCE account; the defaults match
#                            seed-managed.ts's tenant B source credentials.
#
# Every request runs INSIDE the Nextcloud container against http://localhost,
# which is always a trusted domain — so this needs no published port, no
# compose network membership and no NEXTCLOUD_TRUSTED_DOMAINS entry, the three
# things that made the surrounding demo scripts fiddly to run from anywhere but
# the host that happened to work.
set -uo pipefail

NC="${NEXTCLOUD_CONTAINER:-open-migrate-nextcloud}"
DAVUSER="${DAV_USER:-tenant-b-source}"
PASS="${DAV_PASSWORD:-tenant_b_source_pw}"
VERIFY_ONLY=0
[ "${1:-}" = "--verify" ] && VERIFY_ONLY=1

fail() { echo "ERROR: $*" >&2; exit 1; }

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

if [ "$VERIFY_ONLY" = "0" ]; then
  for n in 1 2; do
    code=$(dav PUT "${CAL}openmig-demo-event-${n}.ics" 'text/calendar; charset=utf-8' \
"BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenMigrate//demo//EN
BEGIN:VEVENT
UID:openmig-demo-event-${n}
DTSTAMP:20260101T000000Z
DTSTART:2026010${n}T100000Z
DTEND:2026010${n}T110000Z
SUMMARY:Open Migrate demo event ${n}
DESCRIPTION:Seeded by seed-demo-dav-content.sh so the demo has something to sync.
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR")
    echo "[seed-dav] event ${n}: HTTP ${code}"
    case "$code" in 201|204) ;; *) fail "calendar PUT ${n} returned ${code}" ;; esac

    code=$(dav PUT "${ABK}openmig-demo-contact-${n}.vcf" 'text/vcard; charset=utf-8' \
"BEGIN:VCARD
VERSION:3.0
UID:openmig-demo-contact-${n}
FN:Demo Contact ${n}
N:Contact;Demo ${n};;;
EMAIL;TYPE=INTERNET:demo${n}@demo.openmigrate.test
END:VCARD")
    echo "[seed-dav] contact ${n}: HTTP ${code}"
    case "$code" in 201|204) ;; *) fail "contact PUT ${n} returned ${code}" ;; esac

    code=$(dav PUT "${FILES}openmig-demo-file-${n}.txt" 'text/plain' \
"Open Migrate demo file ${n}. Seeded so the file lane has something to copy.")
    echo "[seed-dav] file ${n}: HTTP ${code}"
    case "$code" in 201|204) ;; *) fail "file PUT ${n} returned ${code}" ;; esac
  done
fi

# ---------- verify, because "the PUTs returned 201" is not "the data is there" ----------
# The same distinction this whole workplan is about: a script that reports what
# it attempted rather than what is true is how the gate came to be green while
# its apply half had never run.
count() { # count <collection> <needle>
  docker exec "$NC" curl -sS -X PROPFIND -H 'Depth: 1' -u "${DAVUSER}:${PASS}" \
    "http://localhost/remote.php/dav/$1" 2>/dev/null | grep -c "$2" || true
}
ev=$(count "$CAL" 'openmig-demo-event-')
ct=$(count "$ABK" 'openmig-demo-contact-')
fl=$(count "$FILES" 'openmig-demo-file-')
echo "[seed-dav] present now — events:${ev} contacts:${ct} files:${fl}"
[ "$ev" -ge 1 ] && [ "$ct" -ge 1 ] && [ "$fl" -ge 1 ] \
  || fail "seeding did not stick — nothing to sync, so the apply half would still find no item"

cat <<'NEXT'

[seed-dav] OK. What happens next, and what still has to be true:
  1. The scheduler's sync tick copies these into the demo TARGET account.
  2. That pass writes `item` rows with status='copied' and a target_ref id.
  3. Only then does smoke-managed.sh's apply half have an eligible item.
Watch it land:
  docker exec open-migrate-db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
    "SELECT item_type, status, count(*) FROM item WHERE mapping_id='b0000000-0000-4000-8000-0000000000d1' GROUP BY 1,2"
NEXT
