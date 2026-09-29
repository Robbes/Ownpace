#!/usr/bin/env bash
# support-read-prune.sh — the support screens' reads recorded with no
# organisation, deleted 12 months after they were recorded (privacy §4.5 and
# §9; the owner's privacy-search-records (a), 2026-09-28; workplan 0139 T6).
#
# WHAT IT DELETES. Every support-screen read is a `support_read` row (managed
# migration 0009): who looked, at whose organisation, at which screen, when,
# and for a search what was searched for. An erasure deletes the rows that name
# the erased organisation (`PURGED_TABLES`, packages/managed/src/offboarding.ts).
# The rows that name none stay: a search by address across every customer
# (`people`), a download of the audit log (`audit_export`), the organisation
# list (`tenants`), the invoices kept after an erasure (`retained_invoices`,
# managed migration 0011), a log page not filtered to one organisation (`log`).
# Privacy §4.5: "they stay after that, and are deleted 12 months after they
# were recorded". This deletes exactly those: `tenant_id IS NULL` and `at` more
# than 12 months ago. A row that names an organisation is never touched here,
# whatever its screen (`tenant`, `person`, `migration`, a `log` page filtered
# to one organisation); it goes with that organisation's erasure.
#
# WHY AT THE MACHINE, OVER THE OWNER'S CONNECTION. `app_user`, the role every
# request runs as, cannot delete from this log, by design: 0009 grants it
# SELECT and INSERT and revokes UPDATE and DELETE (the shared chain's default
# privileges would otherwise have given it DELETE), and the table's row
# security is FORCEd with a SELECT policy (an operator's own rows) and an
# INSERT policy, and none for DELETE. A log the app could shorten would not be
# the record 0110 built it to be. One task does delete from it: the purge of
# closed organisations, an erased organisation's rows (`PURGED_TABLES`). Today
# it runs as the owner, since every Trigger.dev run still receives the owner's
# URL as DATABASE_URL (set-task-env.sh). 0138 T3 step 2 moves the tasks to
# their system role, `ownpace_system`, whose grant here is SELECT on
# `tenant_id` and DELETE: it can pick rows by organisation, never by their
# age, though it could delete every row with no organisation at once, and the
# purge is the only task that deletes here. The 12-month prune picks rows by
# age, so it stays at the machine on the owner's connection: this runs `psql`
# as the database's owner (`POSTGRES_USER`) inside this stack's own Postgres
# container, and `box-duties.sh` runs it daily on live with --delete. That
# connection is not this script's alone (the API holds it too, for its
# migrations and its audit key), but nothing else deletes from this log by
# age.
#
# ONLY AN OWNER THAT PASSES ROW SECURITY. FORCE applies the policies to the
# table's owner too, so an owner that is neither a superuser nor BYPASSRLS
# would delete nothing, without an error, and print "deleted 0" every day while
# the 12 months lapsed. Today's `POSTGRES_USER` is a superuser; the first
# statement asks anyway, in the same call, and stops the call before anything
# is counted or deleted if it is not (as `operator.sh leave` refuses a delete
# that matched nothing, apps/api/src/scripts/operator.ts).
#
# WHAT IT PRINTS. A count, and the moment it counted from. Never an operator, a
# query, an organisation or a value from the .env.
#
# Usage:  ./deploy/compose/support-read-prune.sh            # count, delete nothing
#         ./deploy/compose/support-read-prune.sh --delete   # delete them
# Exit:   0 counted, or deleted; 1 the database could not be asked, its
#         connection does not pass row security, or its answer was not a
#         count; 2 an argument it does not know.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"

say() { echo "[support-read-prune] $*"; }
die() { echo "[support-read-prune] FATAL: $*" >&2; exit 1; }

DELETE=0
case "$#:${1:-}" in
  0:) ;;
  1:--delete) DELETE=1 ;;
  1:-h | 1:--help) sed -n '2,/^set -euo pipefail$/{/^set /d;s/^# \{0,1\}//;p;}' "$0"; exit 0 ;;
  *) echo "[support-read-prune] usage: $(basename "$0") [--delete]" >&2; exit 2 ;;
esac

# The stack comes from this checkout, never from the shell: see env-read.sh.
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || exit 1
DB_CONTAINER="${COMPOSE_PROJECT}-db"

# THE RULE, in one place, for the count and the delete alike. `now()` is the
# database's clock; 12 calendar months, as the privacy policy says.
KEPT_FOR="12 months"
PAST_ITS_YEAR="WHERE tenant_id IS NULL AND at < now() - interval '${KEPT_FOR}'"

# First, whether this connection passes row security at all; RAISE, so that
# ON_ERROR_STOP ends the call there and psql exits non-zero with the reason.
BYPASSES="DO \$\$
BEGIN
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'support-read-prune: the role % does not pass row security on support_read, and would find no row to remove', current_user;
  END IF;
END
\$\$;"

if [ "$DELETE" -eq 1 ]; then
  SQL="${BYPASSES}
WITH gone AS (DELETE FROM public.support_read ${PAST_ITS_YEAR} RETURNING 1)
SELECT count(*) FROM gone;"
else
  SQL="${BYPASSES}
SELECT count(*) FROM public.support_read ${PAST_ITS_YEAR};"
fi

# As the owner, over the container's own socket: `app_user` may not delete
# here, and the tasks' system role may not pick a row by its age.
# ON_ERROR_STOP so a failed statement is a failed run, never a quiet empty
# answer (hard rule 9); -X so no ~/.psqlrc changes the output.
if ! answer="$(docker exec -i "$DB_CONTAINER" \
    sh -c 'exec psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<<"$SQL")"; then
  die "the database in ${DB_CONTAINER} could not be asked, or its connection does not pass row security (the reason is above); nothing was deleted"
fi
[[ "$answer" =~ ^[0-9]+$ ]] ||
  die "the database in ${DB_CONTAINER} answered something that is not a count; nothing is known to be deleted"

if [ "$DELETE" -eq 1 ]; then
  say "${COMPOSE_PROJECT}: support-screen reads with no organisation, recorded more than ${KEPT_FOR} ago: deleted ${answer}"
else
  say "${COMPOSE_PROJECT}: support-screen reads with no organisation, recorded more than ${KEPT_FOR} ago: ${answer}"
  say "nothing deleted: --delete deletes them"
fi
