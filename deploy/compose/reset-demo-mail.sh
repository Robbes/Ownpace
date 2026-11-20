#!/usr/bin/env bash
# reset-demo-mail.sh — the OTA demo's mail lane, reset once, by hand, for the
# move of the test mail server from Stalwart v0.16.27 to v1.1.1 (workplan 0119;
# the owner's choice is quoted in ADR-0022's update of 2026-11-20).
#
# WHY A RESET. v1.1.1 refuses at start a data volume a v0.16 Stalwart made
# (setup-stalwart.sh's header), and v0.16.27 refuses one v1 made. The demo's
# Stalwart is long-lived on the OTA stack, so the move needs its volume made
# again. A new volume alone is not enough, because the stack's database
# outlives it. Demo organisation A's mail migration (seed-managed.ts) holds the
# messages seed-imap-source.mjs seeds, <seed-N@dev.local>, as copied. Mail has
# no source version, so a pass skips a message it has copied
# (`classifyKnownItem`, packages/core/src/domain-sync.ts), and nothing would
# reach the empty v1 target. The smoke would then fail twice: at its floor
# (smoke-managed.sh, `verify_mapping`: items at the source and none on the
# target), and at its cutover, whose gate counts the migration's rows against
# what the target lists and needs 0.99 of them to match
# (apps/worker/src/jobs/cutover-gate.ts).
#
# THE OWNER'S CHOICE, 2026-11-20: "One-time reset". Right after a nightly
# E2E (managed) of `main`, the owner runs this with --yes; E2E (managed) is
# then dispatched on the branch that moves the pin, and the merge follows
# before the next nightly. A nightly in between runs `main`'s v0.16.27, which
# makes the volume again and copies the demo into it: then this runs again,
# before the branch's run. Nothing in the gate or the bring-up calls this
# script, and nothing else here deletes any of it by itself.
#
# WHAT IT REMOVES FROM DOCKER, by the names setup-managed-demo.sh gives them.
# They are outside Compose, so the project does not scope them; this names them
# and reads no override from the shell, since a volume named in a shell is not
# one to remove:
#   ownpace-stalwart        the demo's Stalwart container
#   ownpace-stalwart-data   its data volume, the mailboxes v0.16 made
# The next bring-up with --with-demo, as the nightly gate runs it, makes the
# volume again under the same name with the Stalwart its checkout pins
# (setup-stalwart.sh), provisions the four accounts, and seeds five messages
# into the source mailbox (setup-managed-demo.sh). The name stays: nothing is
# left behind under it, and a second name would not let the two lines take
# turns, because one ledger, one container and one network alias `stalwart`
# serve both (docs/stalwart-integration-fix.md, "Moving the pin").
#
# WHAT IT KEEPS ON DOCKER:
#   ownpace-stalwart-config  config.json alone, which setup-stalwart.sh writes
#                            again on every run, the same file at v1.1.1. Both
#                            phases mount it read-only, so no Stalwart has
#                            written into it.
#
# WHAT IT CLEARS IN THE DATABASE: every row that holds the state of that one
# migration, mailbox_mapping a0000000-0000-4000-8000-0000000000d1 of
# organisation a0000000-0000-4000-8000-000000000001, so that its next pass is a
# first pass. Every statement names both ids; the run events are reached
# through the migration's own runs. In this order:
#   run_event            what each pass below logged
#   verification         the per-data-type verdicts of older verifications
#   item                 the ledger: each message copied, by its Message-ID,
#                        and anything a pass recorded about it (deletion
#                        reports and their answers included)
#   run                  the passes against the old server, with their counts
#   cursor               how far each folder was read: its UIDVALIDITY and next
#                        UID. A new mailbox numbers its messages from 1 again,
#                        and nothing promises it another UIDVALIDITY, so a
#                        cursor left behind could hide every message
#   sync_checkpoint      per-folder source tokens (nothing reads them today)
#   collection_mapping   source folder to target folder (nothing reads it today)
#   migration_status     each data type's last pass: state, counts, error, pause
#   migration_discovery  what discovery counted at the source and on the old
#                        target
#   verification_run     the verify reports, measured against the old target
#   cutover_event        the cutover's trail
#   cutover_state        the cutover ledgers, the whole migration's and each
#                        data type's: a preparation reads all of them first
#   cutover              the older cutover table
#   decision             the questions raised about this migration
#   apply_receipt        deletions and moves applied on the old target
#   share_grant          the sharing a pass found at the source
#
# WHAT IT KEEPS IN THE DATABASE:
#   - the migration itself: the organisation, its member seed:demo-owner-a, the
#     two connections, the two mailboxes, the mapping and its scope.
#     seed-managed.ts writes them again at every bring-up, and the smoke names
#     the mapping by its id;
#   - path_lifecycle, the migration's phase, which billing reads and only the
#     API's doors write: absent, it reads as `ready`, before Start, and nothing
#     would write it again;
#   - mapping_link, person_migration, migration_visit, migration_cadence_said
#     and backup_target: who the migration is for and its settings, not what
#     the server held;
#   - app_event and audit_log, which are logs: a migration's events stay even
#     when it is deleted (ledger migration 0059);
#   - group_def, which belongs to the source connection rather than the
#     migration: the morning's discovery reads it again from the new server;
#   - the organisation's meters and budgets. The first copy again adds the five
#     seeded messages to its first-copy meter (bytes_moved).
#
# NEVER ON LIVE, AND NEVER ANOTHER ORGANISATION. Before Docker is asked
# anything it refuses a .env carrying live's marker or anything that could be a
# slip of it, the marker exported into the shell, and a shell whose
# COMPOSE_PROJECT_NAME is not the one this checkout chooses (stack-kind.sh,
# env-read.sh). It names this checkout's .env to Compose itself. Then the
# database is asked, in the same call as everything else, whether the ids are
# the demo's: organisation A's mail migration from the demo Stalwart's
# source@dev.local to its target@dev.local, mail alone in its scope, and
# seed:demo-owner-a among its members, as seed-managed.ts writes them. Any other
# answer refuses, and nothing changes.
#
# HOW IT REACHES THE DATABASE: as the owner, POSTGRES_USER, the role
# operator.sh and seed-managed.sh compose their connection for, which row
# security never binds (the first statement checks it). It runs psql inside the
# stack's own postgres container, over its socket, as rehearse-capacity.sh and
# support-read-prune.sh do: those two compose a URL because they hand it to
# Node, and the machine needs no psql of its own for this. Direct, never
# through the pooler.
#
# IN WHICH ORDER, AND WHY. With --yes:
#   1. the database, read only: the ids checked, the rows counted, and any pass
#      of this migration still running (one started within the sync tick's
#      staleness window, two hours). A running pass refuses: it could write
#      the rows back. Nothing has changed yet.
#   2. the container, then the data volume. From here no pass can read the
#      old mailboxes, so none can write their messages back into the ledger.
#   3. the rows, in one transaction: the check again, the deletes, the counts
#      after, and a refusal unless every count is 0. Either the lane is empty
#      or no row changed. A pass the plane queued earlier can still start
#      afterwards; it finds no Stalwart and fails without copying anything.
# Run again, it finds nothing to remove and clears nothing: it converges.
#
# Usage:  ./deploy/compose/reset-demo-mail.sh          # say what it would do, with counts
#         ./deploy/compose/reset-demo-mail.sh --yes    # do it
# Exit:   0 shown, or done; 1 refused, or Docker or the database said no (the
#         reason is above it); 2 an argument it does not know.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
# env_value and compose_project, the one reader of a compose .env.
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# Live's marker, named once.
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"
# The .env named to Compose, so that it reads the file checked below and not
# one a COMPOSE_ENV_FILES in the shell names.
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml" --env-file "${ENV_FILE}")

# Demo organisation A, as seed-managed.ts writes it (DEMO_TENANTS, the first),
# and the mail migration smoke-managed.sh verifies and cuts over.
DEMO_TENANT='a0000000-0000-4000-8000-000000000001'
DEMO_MAPPING='a0000000-0000-4000-8000-0000000000d1'
DEMO_SOURCE_MAILBOX='a0000000-0000-4000-8000-0000000000b1'
DEMO_TARGET_MAILBOX='a0000000-0000-4000-8000-0000000000b2'
DEMO_SOURCE_CONNECTION='a0000000-0000-4000-8000-0000000000c1'
DEMO_TARGET_CONNECTION='a0000000-0000-4000-8000-0000000000c2'
DEMO_OWNER='seed:demo-owner-a'

# The demo's Stalwart, by setup-managed-demo.sh's names.
DEMO_STALWART='ownpace-stalwart'
DEMO_STALWART_DATA='ownpace-stalwart-data'
DEMO_STALWART_CONFIG='ownpace-stalwart-config'

# The tables cleared, in the order they are cleared: each is named in the
# header with what it holds.
CLEARED=(
  run_event verification item run cursor sync_checkpoint collection_mapping
  migration_status migration_discovery verification_run cutover_event
  cutover_state cutover decision apply_receipt share_grant
)

say() { printf '[reset-demo-mail] %s\n' "$@"; }
die() {
  printf '[reset-demo-mail] %s\n' "$@" >&2
  exit 1
}
usage() {
  cat >&2 <<'EOF'
Usage:
  ./deploy/compose/reset-demo-mail.sh          say what it would do, with counts; changes nothing
  ./deploy/compose/reset-demo-mail.sh --yes    remove the demo's Stalwart and its data volume, and clear the demo mail migration's rows
EOF
  exit 2
}

YES=0
case "$#:${1:-}" in
  0:) ;;
  1:--yes) YES=1 ;;
  1:-h | 1:--help)
    sed -n '2,/^set -euo pipefail$/{/^set /d;s/^# \{0,1\}//;p;}' "${BASH_SOURCE[0]}"
    exit 0
    ;;
  *) usage ;;
esac

# ---------------------------------------------------------------------------
# Never live. Nothing below this asks Docker anything until the stack is known
# not to be live's.
# ---------------------------------------------------------------------------
[ -f "$ENV_FILE" ] || die "${ENV_FILE} not found. This runs from the OTA stack's checkout, beside its .env."

if stack_may_be_live "$ENV_FILE"; then
  die "refused: ${ENV_FILE} has a ${STACK_KIND_KEY} line: live's marker, ${STACK_KIND_KEY}=${STACK_KIND_LIVE}, or something that could be a slip of it. Its value is not printed." \
    "The stack testers use runs no demo, and nothing here touches it. Nothing was changed." \
    "Run this from the OTA stack's checkout."
fi

shell_kind="$(stack_kind_clean "${!STACK_KIND_KEY:-}")"
if stack_kind_may_be_live "$shell_kind"; then
  die "refused: this shell has ${STACK_KIND_KEY}='${!STACK_KIND_KEY}' exported, which is live's marker or could be a slip of it." \
    "A live .env was sourced into it, and Compose would follow what came with it. Nothing was changed." \
    "Open a new shell and run this again."
fi

# The project this checkout chooses (env-read.sh, workplan 0132 T1). It refuses
# a shell whose COMPOSE_PROJECT_NAME the checkout does not choose.
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || exit 1

# psql as the owner, over the postgres container's own socket. SQL on stdin.
db() {
  # shellcheck disable=SC2016  # expanded by the container's shell
  "${COMPOSE[@]}" exec -T postgres sh -c 'exec psql -X -q -At -F "|" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# rows_of <table> — the demo mail migration's rows in that table, as a WHERE
# clause naming both of its ids.
rows_of() {
  case "$1" in
    run_event)
      printf "tenant_id = '%s' AND run_id IN (SELECT id FROM public.run WHERE tenant_id = '%s' AND mapping_id = '%s')" \
        "$DEMO_TENANT" "$DEMO_TENANT" "$DEMO_MAPPING"
      ;;
    *) printf "tenant_id = '%s' AND mapping_id = '%s'" "$DEMO_TENANT" "$DEMO_MAPPING" ;;
  esac
}

# counts_sql <tag> — one `<tag>|<table>|<rows>` line per cleared table, in order.
counts_sql() {
  local t sep='' i=0
  printf "SELECT '%s', t, n FROM (VALUES\n" "$1"
  for t in "${CLEARED[@]}"; do
    i=$((i + 1))
    printf "%s  (%d, '%s', (SELECT count(*) FROM public.%s WHERE %s))" "$sep" "$i" "$t" "$t" "$(rows_of "$t")"
    sep=$',\n'
  done
  printf '\n) AS v(o, t, n) ORDER BY o;\n'
}

# A pass of this migration that is still running: started within the sync
# tick's staleness window (STALE_RUN_AFTER_MS, apps/worker/src/jobs/
# managed-sync-tick.ts, two hours). A `running` row older than that is a pass
# that died, and is not waited for.
RUNNING="$(rows_of run) AND status = 'running' AND started_at > now() - interval '2 hours'"

# The check both calls open with: the owner passes row security, and the ids
# are the demo's, as seed-managed.ts writes them.
DEMO_CHECK="DO \$demo\$
BEGIN
  IF NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'reset-demo-mail: refused: the role % does not pass row security, so it would see none of the rows to clear', current_user;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.mailbox_mapping m
      JOIN public.mailbox sm ON sm.id = m.source_mailbox_id AND sm.tenant_id = m.tenant_id
      JOIN public.mailbox tm ON tm.id = m.target_mailbox_id AND tm.tenant_id = m.tenant_id
      JOIN public.connection sc ON sc.id = sm.connection_id AND sc.tenant_id = m.tenant_id
      JOIN public.connection tc ON tc.id = tm.connection_id AND tc.tenant_id = m.tenant_id
     WHERE m.tenant_id = '${DEMO_TENANT}' AND m.id = '${DEMO_MAPPING}'
       AND sm.id = '${DEMO_SOURCE_MAILBOX}' AND tm.id = '${DEMO_TARGET_MAILBOX}'
       AND sc.id = '${DEMO_SOURCE_CONNECTION}' AND sc.role = 'source' AND sc.kind = 'imap'
       AND sc.config->>'host' = 'stalwart' AND sc.config->>'user' = 'source@dev.local'
       AND tc.id = '${DEMO_TARGET_CONNECTION}' AND tc.role = 'target' AND tc.kind = 'jmap'
       AND tc.config->>'baseUrl' = 'http://stalwart:8080' AND tc.config->>'user' = 'target@dev.local'
  ) THEN
    RAISE EXCEPTION 'reset-demo-mail: refused: % is not the demo mail migration seed-managed.ts writes, from the demo Stalwart source@dev.local to its target@dev.local, with these mailboxes and connections', '${DEMO_MAPPING}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_member WHERE tenant_id = '${DEMO_TENANT}' AND user_id = '${DEMO_OWNER}') THEN
    RAISE EXCEPTION 'reset-demo-mail: refused: organisation % has no member ${DEMO_OWNER}, the subject seed-managed.ts writes', '${DEMO_TENANT}';
  END IF;
  IF (SELECT array_agg(domain ORDER BY domain) FROM public.scope_selection
       WHERE tenant_id = '${DEMO_TENANT}' AND mapping_id = '${DEMO_MAPPING}' AND included) IS DISTINCT FROM ARRAY['email']::text[] THEN
    RAISE EXCEPTION 'reset-demo-mail: refused: the migration % does not carry mail alone, as the demo one does', '${DEMO_MAPPING}';
  END IF;
END
\$demo\$;"

# What --yes would act on, read only, in one transaction.
READ_SQL="BEGIN TRANSACTION READ ONLY;
${DEMO_CHECK}
$(counts_sql count)
SELECT 'items', status, count(*) FROM public.item WHERE $(rows_of item) GROUP BY status ORDER BY status;
SELECT 'running', to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') FROM public.run WHERE ${RUNNING} ORDER BY started_at;
ROLLBACK;
SELECT 'checked';"

# The clearing, in one transaction: either the lane is empty, or no row changed.
# shellcheck disable=SC2016  # PL/pgSQL's dollar quotes, not the shell's
clear_sql() {
  local t
  printf 'BEGIN;\n'
  # A pass holding a row would otherwise keep this waiting for as long as it runs.
  printf "SET LOCAL lock_timeout = '10s';\n"
  printf '%s\n' "$DEMO_CHECK"
  printf 'DO $quiet$\nBEGIN\n'
  printf '  IF EXISTS (SELECT 1 FROM public.run WHERE %s) THEN\n' "$RUNNING"
  printf "    RAISE EXCEPTION 'reset-demo-mail: refused: a pass of the demo mail migration started running since this was read. It could write the rows back. No row was changed';\n"
  printf '  END IF;\nEND\n$quiet$;\n'
  for t in "${CLEARED[@]}"; do
    printf "WITH gone AS (DELETE FROM public.%s WHERE %s RETURNING 1) SELECT 'deleted', '%s', count(*) FROM gone;\n" \
      "$t" "$(rows_of "$t")" "$t"
  done
  counts_sql after
  printf 'DO $empty$\nBEGIN\n  IF'
  local sep=''
  for t in "${CLEARED[@]}"; do
    printf '%s EXISTS (SELECT 1 FROM public.%s WHERE %s)' "$sep" "$t" "$(rows_of "$t")"
    sep=$'\n    OR'
  done
  printf " THEN\n    RAISE EXCEPTION 'reset-demo-mail: refused: rows of the demo mail migration came back while this ran. No row was changed';\n"
  printf '  END IF;\nEND\n$empty$;\n'
  printf 'COMMIT;\n'
  printf "SELECT 'committed';\n"
}

# docker_container — `<image>|<state>` of the demo's Stalwart, or `absent`.
# Any other answer from Docker is its own failure, said, never read as absent.
docker_container() {
  local out
  if out="$(docker container inspect --format '{{.Config.Image}}|{{.State.Status}}' "$DEMO_STALWART" 2>&1)"; then
    printf '%s' "$out"
    return 0
  fi
  case "$out" in
    *"No such container"* | *"No such object"*) printf 'absent' ;;
    *) printf '%s\n' "$out" >&2; return 1 ;;
  esac
}

# docker_volume <name> — `present` or `absent`, as docker_container answers.
docker_volume() {
  local out
  if out="$(docker volume inspect --format '{{.Name}}' "$1" 2>&1)"; then
    printf 'present'
    return 0
  fi
  case "$out" in
    *"no such volume"* | *"No such volume"*) printf 'absent' ;;
    *) printf '%s\n' "$out" >&2; return 1 ;;
  esac
}

# show <tag> <answer> — the `<tag>|<table>|<rows>` lines of a database answer.
show() {
  local tag t n
  while IFS='|' read -r tag t n; do
    [ "$tag" = "$1" ] && printf '[reset-demo-mail]     %-20s %s\n' "$t" "$n"
  done <<<"$2"
  return 0
}

# ---------------------------------------------------------------------------
# What there is
# ---------------------------------------------------------------------------
say "stack: ${COMPOSE_PROJECT}; its .env carries no live marker"

container="$(docker_container)" || die "Docker could not be asked about the container ${DEMO_STALWART} (above). Nothing was changed."
data="$(docker_volume "$DEMO_STALWART_DATA")" || die "Docker could not be asked about the volume ${DEMO_STALWART_DATA} (above). Nothing was changed."
config="$(docker_volume "$DEMO_STALWART_CONFIG")" || die "Docker could not be asked about the volume ${DEMO_STALWART_CONFIG} (above). Nothing was changed."

say "the demo's Stalwart, outside Compose:"
if [ "$container" = absent ]; then
  say "  container ${DEMO_STALWART}: absent, nothing to remove"
else
  image="${container%%|*}"
  case "$image" in
    stalwartlabs/stalwart:*) ;;
    *) die "refused: the container ${DEMO_STALWART} runs ${image}, which is not Stalwart, so it is not the demo's. Nothing was changed." ;;
  esac
  say "  container ${DEMO_STALWART}: ${image}, ${container#*|}; --yes removes it"
fi
if [ "$data" = absent ]; then
  say "  volume ${DEMO_STALWART_DATA}: absent, nothing to remove"
else
  say "  volume ${DEMO_STALWART_DATA}: present; --yes removes it"
fi
say "  volume ${DEMO_STALWART_CONFIG}: ${config}; kept, config.json alone, written again by every setup"

plan="$(db <<<"$READ_SQL")" ||
  die "the database refused, or could not be asked (the reason is above). Nothing was changed."
# The answer's last line is the SELECT after the ROLLBACK: without it, the
# check above it is not known to have run to the end.
[ "${plan##*$'\n'}" = checked ] ||
  die "the database's answer stopped short of its end, so the check is not known to have passed. Nothing was changed."

say "demo organisation A's mail migration ${DEMO_MAPPING}: the demo's, checked"
say "  its rows now, which --yes clears:"
show count "$plan"
items=''
running=''
while IFS='|' read -r tag a b; do
  case "$tag" in
    items) items="${items:+${items}, }${a} ${b}" ;;
    running) running="${running:+${running}, }${a} UTC" ;;
  esac
done <<<"$plan"
say "  its items by status: ${items:-none}"

if [ -n "$running" ]; then
  if [ "$YES" -eq 1 ]; then
    die "refused: a pass of the demo mail migration is running (started ${running}), and it could write the rows back." \
      "A pass ends within the hour; run this again then. Nothing was changed."
  fi
  say "  a pass of it is running, started ${running}: --yes refuses until it has ended"
fi

if [ "$YES" -eq 0 ]; then
  say "nothing was changed. With --yes it removes what is marked so above, and clears the rows counted above."
  exit 0
fi

# ---------------------------------------------------------------------------
# --yes: the container, the volume, then the rows (the header says why)
# ---------------------------------------------------------------------------
if [ "$container" != absent ]; then
  docker rm -f "$DEMO_STALWART" >/dev/null ||
    die "Docker did not remove the container ${DEMO_STALWART} (above). Nothing was changed."
  say "removed the container ${DEMO_STALWART}"
fi
if [ "$data" != absent ]; then
  docker volume rm "$DEMO_STALWART_DATA" >/dev/null ||
    die "Docker did not remove the volume ${DEMO_STALWART_DATA} (above): something else still mounts it." \
      "The container is gone, and no row was changed. Run this again once it is free."
  say "removed the volume ${DEMO_STALWART_DATA}"
fi

done_sql="$(db <<<"$(clear_sql)")" ||
  die "the database refused (the reason is above), so the transaction was rolled back and no row was changed." \
    "The container and its data volume are gone. Run this again with --yes once the reason is gone."
# The last line is the SELECT after the COMMIT, as above.
[ "${done_sql##*$'\n'}" = committed ] ||
  die "the database's answer stopped short of its commit, so the rows are not known to be cleared. Run this again with --yes."

say "cleared, in one transaction; rows deleted:"
show deleted "$done_sql"
say "its rows, after:"
show after "$done_sql"
say "done. The next bring-up with --with-demo makes ${DEMO_STALWART_DATA} again with the Stalwart its checkout pins," \
  "and seeds the source; the first pass then copies it as a first copy: E2E (managed) on the branch that moves the pin." \
  "If a nightly of main runs before that, it makes the volume again with v0.16: run this again first."
