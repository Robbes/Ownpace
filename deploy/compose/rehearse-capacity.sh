#!/usr/bin/env bash
# rehearse-capacity.sh — put the alpha's shape on a managed stack, sample the
# machine while it runs, and take it back again (workplan 0143 T9).
#
# WHY THIS EXISTS. Nobody knows how much the reference machine carries. It runs
# the OTA stack (the demo and the nightly gate), `ownpace-live` beside it, the
# appliance's nightly and CI, and the alpha adds up to twenty organisations
# making their first copies. The numbers that decide how many are let in, and
# how many passes run at once (0143 T0), are guesses until they have been
# measured on that machine once. This script is the measuring half; the sitting
# is the owner's (0143 T9, "The sitting").
#
#   --seed N M      N rehearsal organisations, M migrations each, on */15
#   --sample        one line every 10 s: the task containers, the host, the
#                   pooler and the database
#   --remove        takes back every row of the rehearsal, and counts it
#
# NEVER ON LIVE. The script refuses a `.env` carrying live's marker, in every
# mode and before it asks Docker anything (the marker is named once, in
# stack-kind.sh). It refuses any value of the marker that stack-kind.sh does
# not list as not live, since that could be a slip of live's, and it refuses
# the marker exported into the shell as well. It refuses a COMPOSE_PROJECT_NAME
# in the shell that is not the one this checkout's `.env` chooses: Compose
# follows the shell, so that checkout's containers could be another stack's.
# It names that `.env` to Compose itself (--env-file), so a COMPOSE_ENV_FILES
# in the shell cannot swap in another stack's. And it refuses to go on when
# the project Compose then reports is not the one the checkout chooses. The
# rehearsal also needs the demo servers, and only a stack brought up with
# --with-demo has them.
#
# WHAT --seed WRITES. Every id starts with ca9a0000-0000-4000-8000- (ID_PREFIX
# below), a family nothing else in the repository uses, the way the demo seed's
# ids start with a0000000 and b0000000. Per organisation:
#
#   a mail pair         copies of demo tenant A's connections: the demo IMAP
#                       mailbox as the source, the demo Stalwart over JMAP as
#                       the target
#   a Nextcloud pair    copies of demo tenant B's: the demo Nextcloud's source
#                       account (seed-demo-dav-content.sh) and its target
#                       account. Only when M is 2 or more.
#   M migrations        odd ones mail (email), even ones files (file), on
#                       `*/15 * * * *` — what the wizard sends for "every 15
#                       minutes". A migration that never ran is due at once
#                       (sync-due.ts), so every first copy starts on the next
#                       tick, and after that every pass falls due at the same
#                       quarter hour: the peaks worth measuring
#
# The connection rows copy the demo's sealed credentials as they are: nothing
# is decrypted or encrypted again, so the script needs no key. No member is
# written: nothing in a pass reads one, and the daily digest mails members.
#
# Each migration writes under a folder of its own, capacity-rehearsal-<tag>-
# oNN-mNN, where the tag is the UTC minute of the seed, or REHEARSAL_TAG. On
# the Nextcloud target that keeps every file migration's copy a first copy, in
# this seed and in a later one with another tag. On the JMAP target it does
# not: the JMAP writer adopts a message found anywhere in the account by its
# Message-ID (jmap-target.ts, `targetKeys`, ADR-0020), and demo tenant A has
# filed the same messages there already. So a rehearsal mail migration is a
# real pass (a container, an IMAP listing, the target's enumeration) that
# adopts rather than copies. The real mail load is the owner's own large
# mailbox (0143 T9, step 3).
#
# WHAT --remove TAKES BACK. Every row, in every table with a `tenant_id`, whose
# organisation carries the prefix — the seed's rows and everything the passes
# wrote under those organisations since (runs, events, items, budgets) — then
# the organisations. The tables are read from the schema, not listed here, so
# a table added later is covered. It counts each table before it deletes,
# checks that nothing is left, and does all of it in one transaction: either
# the rehearsal is gone or nothing changed.
#
# IT TAKES TWO RUNS. The tick enqueues a pass without writing a row; the pass
# opens its run row only when it starts. So no count of `running` rows can see
# the passes the plane has queued but not started, and they would start after
# the removal, on organisations that are gone. So:
#
#   1. While any migration of the rehearsal is active, --remove pauses them
#      all, so the tick enqueues no more, removes nothing, and says to run it
#      again in a few minutes. A queued pass that starts after that finds its
#      migration paused and stops before its first data type.
#   2. It removes nothing while a pass is running (a pass ends within the hour;
#      a run row older than the tick's own staleness window is a pass that
#      died, and is not waited for), nor while a pass started, or a migration
#      was paused, within the last REMOVE_QUIET_MINUTES: the queue may not
#      have drained yet.
#   3. Otherwise it removes.
#
# A plane that holds a queued pass for longer than that quiet time can still
# start it after the removal. That pass fails on its first write, because its
# organisation is gone, and writes nothing.
#
# WHAT IT LEAVES, and says so: the copies the passes wrote into the demo target
# accounts (named by folder when it removes), and the Trigger.dev plane's own
# records of the runs (0143 T7 is about those).
#
# HOW IT REACHES THE DATABASE. `docker compose exec postgres`, psql over the
# container's own socket, as the owner the postgres image created. That owner
# is a superuser, which row security never binds (docs/rls-guide.md), and it
# has to be: the rehearsal writes and removes rows of many organisations in
# one statement. The script checks it and refuses otherwise. It composes no
# connection string.
#
# Usage:
#   ./deploy/compose/rehearse-capacity.sh --seed N M          # N, M from 1 to 99
#   ./deploy/compose/rehearse-capacity.sh --sample [--count K] # until Ctrl-C, or K lines
#   ./deploy/compose/rehearse-capacity.sh --remove
#
# Env overrides:
#   MANAGED_ENV_PERSIST_DIR   the stack's persisted directory, where samples go
#                             (default ~/.persistent/<project>, the project
#                             Compose reports)
#   REHEARSAL_SAMPLE_FILE     the file samples are appended to (default
#                             <persisted>/rehearsal/samples-<UTC time>.log)
#   REHEARSAL_SAMPLE_SECONDS  seconds between samples (default 10)
#   REHEARSAL_TAG             the folder tag --seed uses (default the UTC
#                             minute). Letters and digits only. A tag used
#                             before makes the file migrations adopt the
#                             copies that seed left in the demo target,
#                             instead of making first copies.
#   REHEARSAL_PROC            where the host's meminfo and loadavg are read
#                             (default /proc)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
# env_value, the one reader of a compose .env. stack-kind.sh sources it too;
# it is named here because this script calls it itself.
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# Live's marker, named once.
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"
# The .env named to Compose, so that it reads the file checked below and not
# one a COMPOSE_ENV_FILES in the shell names.
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml" --env-file "${ENV_FILE}")

# The fixed prefix of every rehearsal id: `ca9a` for capacity.
ID_PREFIX='ca9a0000-0000-4000-8000-'
FOLDER_PREFIX='capacity-rehearsal-'
SCHEDULE='*/15 * * * *'
MAX_N=99
MAX_M=99
# The tick's STALE_RUN_AFTER_MS (2 × PASS_HARD_LIMIT_MS), in seconds. A
# `running` row older than this is a pass that died, not one in flight.
STALE_RUN_AFTER_SECONDS=7200
# How long --remove waits after the last pass of the rehearsal started, and
# after its migrations were paused, before it takes the queue for drained.
REMOVE_QUIET_MINUTES=5

# The demo rows the rehearsal copies (seed-managed.ts, tenants A and B).
DEMO_MAIL_SOURCE_CONNECTION='a0000000-0000-4000-8000-0000000000c1'
DEMO_MAIL_TARGET_CONNECTION='a0000000-0000-4000-8000-0000000000c2'
DEMO_MAIL_SOURCE_MAILBOX='a0000000-0000-4000-8000-0000000000b1'
DEMO_MAIL_TARGET_MAILBOX='a0000000-0000-4000-8000-0000000000b2'
DEMO_FILE_SOURCE_CONNECTION='b0000000-0000-4000-8000-0000000000c1'
DEMO_FILE_TARGET_CONNECTION='b0000000-0000-4000-8000-0000000000c2'
DEMO_FILE_SOURCE_MAILBOX='b0000000-0000-4000-8000-0000000000b1'
DEMO_FILE_TARGET_MAILBOX='b0000000-0000-4000-8000-0000000000b2'

say() { printf '[rehearsal] %s\n' "$@"; }
die() {
  printf '[rehearsal] %s\n' "$@" >&2
  exit 1
}
usage() {
  cat >&2 <<'EOF'
Usage:
  ./deploy/compose/rehearse-capacity.sh --seed N M           N organisations, M migrations each (1 to 99)
  ./deploy/compose/rehearse-capacity.sh --sample [--count K]  a line every 10 s, until Ctrl-C or K lines
  ./deploy/compose/rehearse-capacity.sh --remove              take the rehearsal back
EOF
  exit 2
}

MODE=""
N=""
M=""
COUNT=0
case "${1:-}" in
  --seed)
    [ "$#" -eq 3 ] || usage
    MODE=seed N="$2" M="$3"
    ;;
  --sample)
    MODE=sample
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --count) COUNT="${2:-}"; shift 2 || usage ;;
        *) usage ;;
      esac
    done
    [[ "$COUNT" =~ ^[0-9]+$ ]] || die "--count needs a whole number, not '${COUNT}'."
    ;;
  --remove)
    [ "$#" -eq 1 ] || usage
    MODE=remove
    ;;
  -h | --help)
    sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed '$d'
    exit 0
    ;;
  *) usage ;;
esac

# ---------------------------------------------------------------------------
# Never live. Everything above this line only read arguments; nothing below it
# runs until the stack is known not to be live's.
# ---------------------------------------------------------------------------
[ -f "$ENV_FILE" ] || die "${ENV_FILE} not found. The rehearsal runs from a managed stack's checkout."

if stack_is_live "$ENV_FILE"; then
  die "refused: ${ENV_FILE} carries ${STACK_KIND_KEY}=${STACK_KIND_LIVE}, live's marker." \
    "This stack holds testers' data, and rehearsal organisations never reach it." \
    "Run the rehearsal from the OTA stack's checkout, which has the demo servers it needs."
fi
if stack_may_be_live "$ENV_FILE"; then
  file_kind="$(stack_kind "$ENV_FILE")"
  die "refused: ${ENV_FILE} has a ${STACK_KIND_KEY} line${file_kind:+ ('${file_kind}')} that could be a slip of live's marker, ${STACK_KIND_KEY}=${STACK_KIND_LIVE}." \
    "A refusal errs towards live: only a .env without the key, or with a kind stack-kind.sh lists as not live, is rehearsed on." \
    "Look at that line. If this is live's .env, run the rehearsal from the OTA stack's checkout instead."
fi

shell_kind="$(stack_kind_clean "${!STACK_KIND_KEY:-}")"
if stack_kind_may_be_live "$shell_kind"; then
  die "refused: this shell has ${STACK_KIND_KEY}='${!STACK_KIND_KEY}' exported, which is live's marker or could be a slip of it." \
    "A live .env was sourced into it, and Compose would follow what came with it." \
    "Open a new shell and run this again."
fi

# The project this checkout chooses, from the one reader (env-read.sh,
# 0132 T1): the shell's COMPOSE_PROJECT_NAME, else this .env's, else
# managed.yml's `name:`. It refuses a shell whose COMPOSE_PROJECT_NAME the
# checkout does not choose: Compose follows the shell, so this would act on
# another stack than the checkout's. Said out loud, and the persisted
# directory's name.
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || exit 1

# The project Compose itself reports from here. Answering another one means
# something above was missed, and it would act on another stack's containers.
compose_reports_project() {
  local cfg
  if ! cfg="$("${COMPOSE[@]}" config 2>&1)"; then
    printf '%s\n' "$cfg" >&2
    return 1
  fi
  sed -n 's/^name:[[:space:]]*//p' <<<"$cfg"
}
REPORTED_PROJECT="$(compose_reports_project)" || die "docker compose could not read ${SCRIPT_DIR}/managed.yml with its .env (above)."
if [ "$REPORTED_PROJECT" != "$COMPOSE_PROJECT" ]; then
  die "refused: docker compose reports the project '${REPORTED_PROJECT:-none}', and this checkout chooses '${COMPOSE_PROJECT}'." \
    "Something in this shell points Compose at another stack. Open a new shell and run this again."
fi

# psql as the owner, over the postgres container's own socket. SQL on stdin.
db() {
  "${COMPOSE[@]}" exec -T postgres sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# An id under the prefix: kind (2 digits), organisation (4), item (6).
#   01 organisation   02 connection   03 mailbox   04 migration   05 scope
rid() { printf '%s%s%04d%06d' "$ID_PREFIX" "$1" "$2" "$3"; }

# The owner check both --seed and --remove open with.
OWNER_CHECK="IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'refused: the role % is not a superuser. The rehearsal writes and removes rows of many organisations at once, and row security would show this role one of them at most. Run it as the owner the postgres image created, which is what this script''s own psql does.', current_user;
  END IF;"

# ---------------------------------------------------------------------------
# --seed N M
# ---------------------------------------------------------------------------
seed_sql() {
  local n="$1" m="$2" tag="$3"
  local files=0 per_org_connections=2 o k tid kind folder name sep
  [ "$m" -ge 2 ] && files=1
  [ "$files" -eq 1 ] && per_org_connections=4

  local needed_connections="'${DEMO_MAIL_SOURCE_CONNECTION}', '${DEMO_MAIL_TARGET_CONNECTION}'"
  local needed_mailboxes="'${DEMO_MAIL_SOURCE_MAILBOX}', '${DEMO_MAIL_TARGET_MAILBOX}'"
  if [ "$files" -eq 1 ]; then
    needed_connections+=", '${DEMO_FILE_SOURCE_CONNECTION}', '${DEMO_FILE_TARGET_CONNECTION}'"
    needed_mailboxes+=", '${DEMO_FILE_SOURCE_MAILBOX}', '${DEMO_FILE_TARGET_MAILBOX}'"
  fi

  cat <<SQL
BEGIN;
DO \$check\$
DECLARE
  n bigint;
BEGIN
  ${OWNER_CHECK}
  SELECT count(*) INTO n FROM tenant WHERE id::text LIKE '${ID_PREFIX}%';
  IF n > 0 THEN
    RAISE EXCEPTION 'refused: % organisations of an earlier rehearsal are still here. Take them back first with --remove, so that every migration of this one starts from nothing.', n;
  END IF;
  SELECT count(*) INTO n FROM connection c
   WHERE c.id IN (${needed_connections}) AND c.secret_ref IS NOT NULL
     AND EXISTS (SELECT 1 FROM mailbox b WHERE b.connection_id = c.id AND b.id IN (${needed_mailboxes}));
  IF n <> ${per_org_connections} THEN
    RAISE EXCEPTION 'refused: found % of the % demo connections this rehearsal copies. They are the demo servers'' accounts, which only a stack brought up with --with-demo has (seed-managed.sh writes them).', n, ${per_org_connections};
  END IF;
END
\$check\$;
SQL

  # Organisations.
  printf 'INSERT INTO tenant (id, name) VALUES\n'
  sep=''
  for ((o = 1; o <= n; o++)); do
    printf "%s  ('%s', 'Capacity rehearsal %02d')" "$sep" "$(rid 01 "$o" 0)" "$o"
    sep=$',\n'
  done
  printf ';\n'

  # Connections and mailboxes, copied from the demo's.
  printf 'INSERT INTO connection (id, tenant_id, role, kind, display_name, config, secret_ref, qualification)\n'
  printf "SELECT v.id::uuid, v.tenant_id::uuid, c.role, c.kind, 'Capacity rehearsal: ' || c.display_name, c.config, c.secret_ref, c.qualification\n"
  printf '  FROM (VALUES\n'
  sep=''
  for ((o = 1; o <= n; o++)); do
    tid="$(rid 01 "$o" 0)"
    printf "%s    ('%s', '%s', '%s')" "$sep" "$(rid 02 "$o" 1)" "$tid" "$DEMO_MAIL_SOURCE_CONNECTION"
    sep=$',\n'
    printf "%s    ('%s', '%s', '%s')" "$sep" "$(rid 02 "$o" 2)" "$tid" "$DEMO_MAIL_TARGET_CONNECTION"
    if [ "$files" -eq 1 ]; then
      printf "%s    ('%s', '%s', '%s')" "$sep" "$(rid 02 "$o" 3)" "$tid" "$DEMO_FILE_SOURCE_CONNECTION"
      printf "%s    ('%s', '%s', '%s')" "$sep" "$(rid 02 "$o" 4)" "$tid" "$DEMO_FILE_TARGET_CONNECTION"
    fi
  done
  printf '\n  ) AS v(id, tenant_id, demo) JOIN connection c ON c.id = v.demo::uuid;\n'

  printf 'INSERT INTO mailbox (id, tenant_id, connection_id, external_id, kind, primary_address, display_name)\n'
  printf "SELECT v.id::uuid, v.tenant_id::uuid, v.connection_id::uuid, b.external_id, b.kind, b.primary_address, 'Capacity rehearsal: ' || coalesce(b.display_name, b.external_id, 'mailbox')\n"
  printf '  FROM (VALUES\n'
  sep=''
  for ((o = 1; o <= n; o++)); do
    tid="$(rid 01 "$o" 0)"
    printf "%s    ('%s', '%s', '%s', '%s')" "$sep" "$(rid 03 "$o" 1)" "$tid" "$(rid 02 "$o" 1)" "$DEMO_MAIL_SOURCE_MAILBOX"
    sep=$',\n'
    printf "%s    ('%s', '%s', '%s', '%s')" "$sep" "$(rid 03 "$o" 2)" "$tid" "$(rid 02 "$o" 2)" "$DEMO_MAIL_TARGET_MAILBOX"
    if [ "$files" -eq 1 ]; then
      printf "%s    ('%s', '%s', '%s', '%s')" "$sep" "$(rid 03 "$o" 3)" "$tid" "$(rid 02 "$o" 3)" "$DEMO_FILE_SOURCE_MAILBOX"
      printf "%s    ('%s', '%s', '%s', '%s')" "$sep" "$(rid 03 "$o" 4)" "$tid" "$(rid 02 "$o" 4)" "$DEMO_FILE_TARGET_MAILBOX"
    fi
  done
  printf '\n  ) AS v(id, tenant_id, connection_id, demo) JOIN mailbox b ON b.id = v.demo::uuid;\n'

  # Migrations: odd ones mail, even ones files, each under a folder of its own.
  local mappings='' scopes='' src dst domain
  sep=''
  for ((o = 1; o <= n; o++)); do
    tid="$(rid 01 "$o" 0)"
    for ((k = 1; k <= m; k++)); do
      if ((k % 2 == 1)); then
        kind=mail domain=email src="$(rid 03 "$o" 1)" dst="$(rid 03 "$o" 2)"
      else
        kind=files domain=file src="$(rid 03 "$o" 3)" dst="$(rid 03 "$o" 4)"
      fi
      folder="$(printf '%s%s-o%02d-m%02d' "$FOLDER_PREFIX" "$tag" "$o" "$k")"
      name="$(printf 'Rehearsal %02d.%02d (%s)' "$o" "$k" "$kind")"
      mappings+="$(printf "%s  ('%s', '%s', '%s', '%s', 'mirror', 'active', '%s', '%s', '%s')" \
        "$sep" "$(rid 04 "$o" "$k")" "$tid" "$src" "$dst" "$name" "$SCHEDULE" "$folder")"
      scopes+="$(printf "%s  ('%s', '%s', '%s', '%s', true, '{}')" \
        "$sep" "$(rid 05 "$o" "$k")" "$tid" "$(rid 04 "$o" "$k")" "$domain")"
      sep=$',\n'
    done
  done
  printf 'INSERT INTO mailbox_mapping (id, tenant_id, source_mailbox_id, target_mailbox_id, mode, status, name, schedule, target_folder_prefix) VALUES\n%s;\n' "$mappings"
  printf 'INSERT INTO scope_selection (id, tenant_id, mapping_id, domain, included, filters) VALUES\n%s;\n' "$scopes"

  # What was written is what was meant, or none of it is.
  cat <<SQL
DO \$verify\$
DECLARE
  got text;
  want text := '${n} $((n * per_org_connections)) $((n * per_org_connections)) $((n * m)) $((n * m))';
BEGIN
  SELECT concat_ws(' ',
      (SELECT count(*) FROM tenant WHERE id::text LIKE '${ID_PREFIX}%'),
      (SELECT count(*) FROM connection WHERE tenant_id::text LIKE '${ID_PREFIX}%'),
      (SELECT count(*) FROM mailbox WHERE tenant_id::text LIKE '${ID_PREFIX}%'),
      (SELECT count(*) FROM mailbox_mapping WHERE tenant_id::text LIKE '${ID_PREFIX}%'),
      (SELECT count(*) FROM scope_selection WHERE tenant_id::text LIKE '${ID_PREFIX}%'))
    INTO got;
  IF got <> want THEN
    RAISE EXCEPTION 'the seed wrote % (organisations, connections, mailboxes, migrations, scopes) where it meant %; nothing was kept.', got, want;
  END IF;
END
\$verify\$;
SELECT 'seeded ' || t || ' ' || n FROM (VALUES
    (1, 'tenant', (SELECT count(*) FROM tenant WHERE id::text LIKE '${ID_PREFIX}%')),
    (2, 'connection', (SELECT count(*) FROM connection WHERE tenant_id::text LIKE '${ID_PREFIX}%')),
    (3, 'mailbox', (SELECT count(*) FROM mailbox WHERE tenant_id::text LIKE '${ID_PREFIX}%')),
    (4, 'mailbox_mapping', (SELECT count(*) FROM mailbox_mapping WHERE tenant_id::text LIKE '${ID_PREFIX}%')),
    (5, 'scope_selection', (SELECT count(*) FROM scope_selection WHERE tenant_id::text LIKE '${ID_PREFIX}%'))
  ) AS x(o, t, n) ORDER BY o;
COMMIT;
SQL
}

do_seed() {
  [[ "$N" =~ ^[1-9][0-9]*$ ]] && [ "$N" -le "$MAX_N" ] || die "N must be a whole number from 1 to ${MAX_N}, not '${N}'."
  [[ "$M" =~ ^[1-9][0-9]*$ ]] && [ "$M" -le "$MAX_M" ] || die "M must be a whole number from 1 to ${MAX_M}, not '${M}'."
  local tag="${REHEARSAL_TAG:-$(date -u +%Y%m%dT%H%M)}"
  [[ "$tag" =~ ^[A-Za-z0-9]+$ ]] || die "REHEARSAL_TAG must be letters and digits only, not '${tag}'."

  say "compose project '${COMPOSE_PROJECT}': --seed ${N} ${M}"
  local out line rows=()
  if ! out="$(seed_sql "$N" "$M" "$tag" | db 2>&1)"; then
    printf '%s\n' "$out" >&2
    die "the seed was refused or failed (above). Nothing was written: it is one transaction."
  fi
  while IFS= read -r line; do
    case "$line" in
      'seeded '*) rows+=("${line#seeded }") ;;
      '') ;;
      *) printf '%s\n' "$line" ;;
    esac
  done <<<"$out"
  say "rows written:"
  printf '  %s\n' "${rows[@]}"
  local mail=$((N * ((M + 1) / 2))) files=$((N * (M / 2)))
  say "seeded ${N} organisations, $((N * M)) migrations (${mail} mail, ${files} files), on ${SCHEDULE}," \
    "each under its own folder ${FOLDER_PREFIX}${tag}-oNN-mNN on the demo targets." \
    "A migration that never ran is due at once, so the tick starts all of them within the minute, and then every quarter hour." \
    "Start --sample first, and --remove when the sitting ends."
}

# ---------------------------------------------------------------------------
# --remove
# ---------------------------------------------------------------------------
remove_sql() {
  cat <<SQL
BEGIN;
CREATE TEMP TABLE rehearsal_count (tbl text PRIMARY KEY, nrows bigint NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE rehearsal_out (ord int NOT NULL, line text NOT NULL) ON COMMIT DROP;
DO \$remove\$
DECLARE
  p CONSTANT text := '${ID_PREFIX}%';
  t text;
  n bigint;
  failed int;
  progress boolean;
  left_over text := '';
BEGIN
  ${OWNER_CHECK}

  -- First, always: stop the tick enqueuing passes, and come back later. The
  -- passes it queued already have no run row yet, so nothing below could
  -- count them; they start later, find their migration paused and stop.
  UPDATE mailbox_mapping SET status = 'paused', updated_at = now()
   WHERE tenant_id::text LIKE p AND status IN ('active', 'continuous');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    INSERT INTO rehearsal_out VALUES (0, 'paused ' || n);
    RETURN;
  END IF;

  -- A pass still running writes into what this would delete.
  SELECT count(*) INTO n FROM run
   WHERE tenant_id::text LIKE p AND status = 'running'
     AND started_at > now() - interval '${STALE_RUN_AFTER_SECONDS} seconds';
  IF n > 0 THEN
    INSERT INTO rehearsal_out VALUES (0, 'in_flight ' || n);
    RETURN;
  END IF;

  -- A pass that started, or a migration paused, a short while ago: the plane
  -- may still hold queued passes of the rehearsal.
  SELECT (SELECT count(*) FROM run
           WHERE tenant_id::text LIKE p AND started_at > now() - interval '${REMOVE_QUIET_MINUTES} minutes')
       + (SELECT count(*) FROM mailbox_mapping
           WHERE tenant_id::text LIKE p AND updated_at > now() - interval '${REMOVE_QUIET_MINUTES} minutes')
    INTO n;
  IF n > 0 THEN
    INSERT INTO rehearsal_out VALUES (0, 'recent');
    RETURN;
  END IF;

  -- Every table with a tenant_id, read from the schema.
  FOR t IN
    SELECT c.table_name::text FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id::text LIKE \$1', t) INTO n USING p;
    IF n > 0 THEN
      INSERT INTO rehearsal_count VALUES (t, n);
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM tenant WHERE id::text LIKE p;
  IF n > 0 THEN
    INSERT INTO rehearsal_count VALUES ('tenant', n);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM rehearsal_count) THEN
    INSERT INTO rehearsal_out VALUES (0, 'nothing');
    RETURN;
  END IF;

  INSERT INTO rehearsal_out
    SELECT DISTINCT 1, 'folder ' || target_folder_prefix FROM mailbox_mapping
     WHERE tenant_id::text LIKE p AND target_folder_prefix IS NOT NULL;

  -- Children before parents, without a list of which is which: a delete a
  -- foreign key still refuses is tried again in the next round, after the rows
  -- that pointed at it are gone. A round that removes nothing and still has a
  -- refusal is stuck, and says where.
  LOOP
    failed := 0;
    progress := false;
    FOR t IN SELECT tbl FROM rehearsal_count WHERE tbl <> 'tenant' ORDER BY tbl LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE tenant_id::text LIKE \$1', t) USING p;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN
          progress := true;
        END IF;
      EXCEPTION WHEN foreign_key_violation THEN
        failed := failed + 1;
        left_over := t;
      END;
    END LOOP;
    EXIT WHEN failed = 0;
    IF NOT progress THEN
      RAISE EXCEPTION 'a foreign key keeps rows of % in place, from a table without a tenant_id. Nothing was removed.', left_over;
    END IF;
  END LOOP;
  DELETE FROM tenant WHERE id::text LIKE p;

  -- Nothing of the rehearsal is left, or nothing was removed.
  left_over := '';
  FOR t IN
    SELECT c.table_name::text FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id::text LIKE \$1', t) INTO n USING p;
    IF n > 0 THEN
      left_over := left_over || ' ' || t || '=' || n;
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM tenant WHERE id::text LIKE p;
  IF n > 0 THEN
    left_over := left_over || ' tenant=' || n;
  END IF;
  IF left_over <> '' THEN
    RAISE EXCEPTION 'rows of the rehearsal were still there after removing it (%). Nothing was removed.', trim(left_over);
  END IF;

  INSERT INTO rehearsal_out SELECT 2, 'removed ' || tbl || ' ' || nrows FROM rehearsal_count;
END
\$remove\$;
SELECT line FROM rehearsal_out ORDER BY ord, line;
COMMIT;
SQL
}

do_remove() {
  say "compose project '${COMPOSE_PROJECT}': taking the rehearsal back"
  local out
  if ! out="$(remove_sql | db 2>&1)"; then
    printf '%s\n' "$out" >&2
    die "the removal failed (above). Nothing was removed: it is one transaction."
  fi

  local line paused='' in_flight='' recent=0 nothing=0 answered=0 total=0 removed=() folders=()
  while IFS= read -r line; do
    case "$line" in
      'paused '*) paused="${line#paused }" answered=1 ;;
      'in_flight '*) in_flight="${line#in_flight }" answered=1 ;;
      recent) recent=1 answered=1 ;;
      nothing) nothing=1 answered=1 ;;
      'folder '*) folders+=("${line#folder }") ;;
      'removed '*)
        removed+=("${line#removed }")
        total=$((total + ${line##* }))
        answered=1
        ;;
      '') ;;
      *) printf '%s\n' "$line" ;;
    esac
  done <<<"$out"

  # An answer is one of the lines above, or the removal did not say what it
  # did, and "removed 0 rows" would be a guess.
  [ "$answered" -eq 1 ] || die "the removal gave no answer the script knows (above, if anything). Nothing is known to be removed."
  if [ -n "$paused" ]; then
    die "${paused} migration(s) of the rehearsal were active. They are paused now, so the tick enqueues no more passes." \
      "Passes it had queued already still start, find their migration paused and stop." \
      "Nothing was removed. Run --remove again in a few minutes."
  fi
  if [ -n "$in_flight" ]; then
    die "${in_flight} pass(es) of the rehearsal are still running. Its migrations are paused, so the tick starts no more." \
      "Nothing was removed. Run --remove again when they have finished; a pass ends within the hour."
  fi
  if [ "$recent" -eq 1 ]; then
    die "a pass of the rehearsal started, or its migrations were paused, within the last ${REMOVE_QUIET_MINUTES} minutes." \
      "The plane may still hold passes it queued before the pause." \
      "Nothing was removed. Run --remove again in a few minutes."
  fi
  if [ "$nothing" -eq 1 ]; then
    say "nothing to remove: no organisation carries the prefix ${ID_PREFIX}."
    return 0
  fi

  say "removed ${total} rows:"
  printf '  %s\n' "${removed[@]}"
  if [ "${#folders[@]}" -gt 0 ]; then
    say "left in the demo target accounts: the copies its passes wrote, under these folders." \
      "A later seed with another tag writes beside them, not into them; one with this tag would adopt them."
    printf '  %s\n' "${folders[@]}"
  fi
  say "also left: the Trigger.dev plane's records of the rehearsal's runs (workplan 0143 T7)."
}

# ---------------------------------------------------------------------------
# --sample
# ---------------------------------------------------------------------------
PROC_ROOT="${REHEARSAL_PROC:-/proc}"

# "tasks=… task_mem_mib=… task_mem_max_mib=…" for every runner container on
# this Docker daemon — both stacks', because the machine is what is measured.
# A runner whose memory `docker stats` could not read (it prints `-- / --` for
# one that exited while it collected, which is what runners do at the quarter
# hour) is counted, and written as `name:?`; the largest is taken over the
# ones it could read, and is `?` when it could read none. Only a failed
# `docker stats` makes all three `?`.
task_fields() {
  local stats
  if ! stats="$(docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}' 2>&1)"; then
    printf '[rehearsal] docker stats failed: %s\n' "$stats" >&2
    printf 'tasks=? task_mem_mib=? task_mem_max_mib=?'
    return 0
  fi
  if ! awk -F'|' '
      function mib(v,   num, unit) {
        num = v; sub(/[A-Za-z]+$/, "", num)
        unit = v; sub(/^[0-9.]+/, "", unit)
        if (unit == "B") return num / 1048576
        if (unit == "KiB" || unit == "kB" || unit == "KB") return num / 1024
        if (unit == "MiB" || unit == "MB") return num + 0
        if (unit == "GiB" || unit == "GB") return num * 1024
        if (unit == "TiB" || unit == "TB") return num * 1048576
        return -1
      }
      $1 ~ /^runner-/ {
        split($2, parts, " / ")
        m = mib(parts[1])
        if (m < 0) {
          r = "?"
        } else {
          r = int(m + 0.5)
          if (!nread || r > max) max = r
          nread++
        }
        list = list (n ? "," : "") $1 ":" r
        n++
      }
      END {
        printf "tasks=%d task_mem_mib=%s task_mem_max_mib=%s", n, (n ? list : "none"), (nread || !n ? max + 0 : "?")
      }' <<<"$stats"; then
    printf 'tasks=? task_mem_mib=? task_mem_max_mib=?'
  fi
}

# "mem_available_mib=… mem_total_mib=… swap_used_mib=… load1=… load5=… load15=…"
host_fields() {
  if ! awk '
      FILENAME ~ /meminfo$/ { v[$1] = $2 }
      FILENAME ~ /loadavg$/ { l1 = $1; l5 = $2; l15 = $3 }
      END {
        if (!("MemAvailable:" in v) || !("MemTotal:" in v) || l1 == "") exit 2
        printf "mem_available_mib=%d mem_total_mib=%d swap_used_mib=%d load1=%s load5=%s load15=%s",
          v["MemAvailable:"] / 1024, v["MemTotal:"] / 1024, (v["SwapTotal:"] - v["SwapFree:"]) / 1024, l1, l5, l15
      }' "${PROC_ROOT}/meminfo" "${PROC_ROOT}/loadavg" 2>/dev/null; then
    printf 'mem_available_mib=? mem_total_mib=? swap_used_mib=? load1=? load5=? load15=?'
  fi
}

# "pool_cl_waiting=… pool_maxwait_s=…": PgBouncer's SHOW POOLS, clients
# waiting summed over every pool, and the longest wait. Read by column name,
# because the columns move between PgBouncer versions. Asked over 127.0.0.1
# inside the PgBouncer container, which is what managed.yml's healthcheck
# asks every 15 s, so the address is known to answer.
pool_fields() {
  local pools
  if ! pools="$("${COMPOSE[@]}" exec -T pgbouncer sh -c 'PGPASSWORD="$PGBOUNCER_AUTH_PASSWORD" psql -X -A -F "|" -P footer=off -h 127.0.0.1 -p 6432 -U pgbouncer_auth -d pgbouncer -c "SHOW POOLS"' 2>&1)"; then
    printf '[rehearsal] SHOW POOLS failed: %s\n' "$pools" >&2
    printf 'pool_cl_waiting=? pool_maxwait_s=?'
    return 0
  fi
  if ! awk -F'|' '
      NR == 1 {
        for (i = 1; i <= NF; i++) col[$i] = i
        if (!("cl_waiting" in col) || !("maxwait" in col)) bad = 1
        next
      }
      NF > 1 {
        waiting += $col["cl_waiting"]
        w = $col["maxwait"] + (("maxwait_us" in col) ? $col["maxwait_us"] / 1000000 : 0)
        if (w > longest) longest = w
      }
      END {
        if (bad || NR == 0) exit 2
        printf "pool_cl_waiting=%d pool_maxwait_s=%g", waiting, longest
      }' <<<"$pools"; then
    printf 'pool_cl_waiting=? pool_maxwait_s=?'
  fi
}

# "numbackends=…": connections to every database in the stack's Postgres.
backend_fields() {
  local nb
  if ! nb="$(printf 'SELECT sum(numbackends) FROM pg_stat_database;\n' | db 2>&1)" || ! [[ "$nb" =~ ^[0-9]+$ ]]; then
    printf '[rehearsal] numbackends could not be read: %s\n' "$nb" >&2
    nb='?'
  fi
  printf 'numbackends=%s' "$nb"
}

sample_line() {
  printf '%s %s %s %s %s' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(task_fields)" "$(host_fields)" "$(pool_fields)" "$(backend_fields)"
}

do_sample() {
  local interval="${REHEARSAL_SAMPLE_SECONDS:-10}"
  [[ "$interval" =~ ^[1-9][0-9]*$ ]] || die "REHEARSAL_SAMPLE_SECONDS must be a whole number of seconds, not '${interval}'."
  local persist="${MANAGED_ENV_PERSIST_DIR:-${HOME}/.persistent/${COMPOSE_PROJECT}}"
  local file="${REHEARSAL_SAMPLE_FILE:-${persist}/rehearsal/samples-$(date -u +%Y%m%dT%H%M%S).log}"
  mkdir -p "$(dirname "$file")"
  if [ ! -s "$file" ]; then
    {
      printf '# rehearse-capacity.sh --sample on compose project %s, every %s s (workplan 0143 T9).\n' "$COMPOSE_PROJECT" "$interval"
      printf '# tasks, task_mem_mib: runner containers on this Docker daemon (both stacks) and each one'"'"'s memory.\n'
      printf '# mem_*, swap_used_mib, load*: the host. pool_*: PgBouncer SHOW POOLS, clients waiting and the longest wait.\n'
      printf '# numbackends: connections to this stack'"'"'s Postgres. ? means the value could not be read, never 0.\n'
    } >>"$file"
  fi
  say "compose project '${COMPOSE_PROJECT}': a line every ${interval} s, appended to ${file}. Ctrl-C ends it."

  local i=0 start now next line
  start="$(date +%s)"
  while :; do
    line="$(sample_line)"
    printf '%s\n' "$line" >>"$file"
    printf '%s\n' "$line"
    i=$((i + 1))
    if [ "$COUNT" -gt 0 ] && [ "$i" -ge "$COUNT" ]; then
      break
    fi
    next=$((start + i * interval))
    now="$(date +%s)"
    if [ "$next" -gt "$now" ]; then
      sleep "$((next - now))"
    fi
  done
}

case "$MODE" in
  seed) do_seed ;;
  remove) do_remove ;;
  sample) do_sample ;;
esac
