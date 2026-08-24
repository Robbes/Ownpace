#!/usr/bin/env bash
# trigger-version.sh — the Trigger.dev control plane's versions, and the
# backup that makes changing them reversible.
#
# WHY THIS EXISTS. Upgrading Trigger.dev is one number that has to agree in
# four places, and a database migration that goes one way. The webapp applies
# its own schema migrations on boot; Prisma has no down-migrations. So the
# documented rollback — put the old image tag back — restores the IMAGES and
# not the schema they migrated, and `triggerdb` holds the one thing on this
# machine that cannot be rebuilt unattended: the account, the project, its API
# keys, the worker group and the deployed-task records. Recreating those needs
# a person and a browser (see deploy-tasks.sh's ONE-TIME prerequisites).
#
# Nothing backed that database up. This does, and — because a backup nobody
# has restored is a hope rather than a backup — `drill` proves the round trip
# into a THROWAWAY database, which the managed gate runs on every pass.
#
# Usage:
#   trigger-version.sh list                 what is running, pinned, available
#   trigger-version.sh backup [label]       dump triggerdb, verified
#   trigger-version.sh backups              what dumps exist, newest first
#   trigger-version.sh drill                dump, restore into a throwaway, compare
#   trigger-version.sh restore <file|--latest> --yes    DESTRUCTIVE, see below
#   trigger-version.sh pin <version|--latest>           move all four places
#
# The order for an actual upgrade is in docs/managed-bring-up.md, and it is not
# optional: upgrading with runs in flight left the reference deployment looping
# on "Snapshot changed inside startRunAttempt" for every run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml")

# The same place the gate persists .env: OUTSIDE the checkout, because
# actions/checkout cleans ignored files before every run and would take the
# backups with them.
BACKUP_DIR="${MANAGED_BACKUP_DIR:-${MANAGED_ENV_PERSIST_DIR:-$HOME/.persistent/ownpace-managed}/trigger-backups}"

DB_CONTAINER="${TRIGGER_DB_CONTAINER:-trigger-db}"
DB_USER="${TRIGGER_DB_USER:-trigger}"
DB_NAME="${TRIGGER_DB_NAME:-triggerdb}"

# STDERR, BECAUSE ONE FUNCTION'S STDOUT IS ITS VALUE. `cmd_backup` returns the
# path it wrote by printing it, so anything else it says on stdout is part of
# that value to a caller — and `cmd_drill` captures it. Written to stdout
# first, and the drill's own live run proved it: "dumping" and "verified"
# never appeared in the job log, because `$(cmd_backup drill | tail -1)` ate
# them. Exactly the shape of the mint() bug in smoke-managed.sh, in a new
# file, one day later.
say() { echo "[trigger-version] $*" >&2; }
die() { echo "[trigger-version] FATAL: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null || die "$1 is required — install it and re-run"; }

# The tag the REPO pins, read from the compose default rather than from a
# second copy of the number. managed.env.example and apps/worker must agree
# with it; bootstrap-managed.sh refuses at bring-up when they do not, and
# bootstrap-managed.unit.test.ts refuses in CI.
repo_tag() {
  # HERE-STRING, NOT A PIPE. `head` closes the pipe after its limit and the
  # writer upstream dies of SIGPIPE — which `set -o pipefail` then reports as
  # the pipeline's failure. That is #519, fixed repo-wide and guarded by
  # no-pipeline-its-own-consumer-can-kill.unit.test.ts, and this script
  # reintroduced it four times over before that guard said so.
  local all
  all="$(grep -oE '\$\{TRIGGER_IMAGE_TAG:-v[^}]+\}' "${SCRIPT_DIR}/managed.yml")"
  sed 's/.*:-//;s/}//' <<<"$(head -1 <<<"$all")"
}

running_tag() { # what is ACTUALLY running, which is the only thing that is not a claim
  docker inspect --format '{{.Config.Image}}' trigger-api 2>/dev/null | sed 's/.*://' || true
}

# ------------------------------------------------------------------ list --

# ASKED BY MANIFEST, NOT BY THE TAG LIST — and that is not a style choice.
# ghcr's /tags/list is neither newest-first nor complete in one page: with
# n=1000 the newest v4.5.x it returns is v4.5.4, while v4.5.9 and v4.5.12 both
# exist and answer a manifest request with 200. Following the `last=` Link
# header would work and would walk thousands of SHA-shaped tags to do it. So
# versions are PROBED from the one already pinned: a bounded walk upward that
# asks the registry the only question it answers reliably — does THIS tag
# exist.
#
# A probe is not a catalogue, and the output says so: this finds what you can
# upgrade TO from here, which is the question being asked.

TOKEN_trigger_dev=""; TOKEN_supervisor=""
ghcr_token() { # ghcr_token <image> — fetched once per image per run
  local image="$1" var
  var="TOKEN_$(printf '%s' "$image" | tr '.-' '__')"
  if [ -z "${!var}" ]; then
    local t
    t="$(curl -sS --max-time 20 \
      "https://ghcr.io/token?scope=repository:triggerdotdev/${image}:pull&service=ghcr.io" \
      | jq -r '.token // empty')"
    [ -n "$t" ] || die "could not get a pull token for triggerdotdev/${image} — is ghcr.io reachable?"
    printf -v "$var" '%s' "$t"
  fi
  printf '%s' "${!var}"
}

tag_exists() { # tag_exists <image> <tag>
  local image="$1" tag="$2" code
  code="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $(ghcr_token "$image")" \
    -H 'Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json' \
    "https://ghcr.io/v2/triggerdotdev/${image}/manifests/${tag}")"
  [ "$code" = "200" ]
}

# BOTH images or neither: the webapp and the supervisor run one tag by
# construction, so a half-published version is not a version you can move to.
tag_usable() { tag_exists trigger.dev "$1" && tag_exists supervisor "$1"; }

# probe_upgrades <vMAJOR.MINOR.PATCH> — every usable tag at or above it,
# newest first. Bounded: it stops after MISS_LIMIT consecutive gaps in a line
# rather than walking forever, and looks a fixed distance ahead for new minors.
MISS_LIMIT="${TRIGGER_PROBE_MISS_LIMIT:-4}"
probe_upgrades() {
  local from="$1" major minor patch found=() miss n
  [[ "$from" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "cannot parse a version from '${from}'"
  major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"; patch="${BASH_REMATCH[3]}"

  # This line, upward from the pinned patch.
  miss=0; n=$(( patch + 1 ))
  while [ "$miss" -lt "$MISS_LIMIT" ] && [ "$n" -lt $(( patch + 40 )) ]; do
    if tag_usable "v${major}.${minor}.${n}"; then found+=("v${major}.${minor}.${n}"); miss=0
    else miss=$(( miss + 1 )); fi
    n=$(( n + 1 ))
  done

  # And the next few minor lines, each from .0.
  local m mm p pmiss
  for m in 1 2 3; do
    mm=$(( minor + m ))
    tag_usable "v${major}.${mm}.0" || continue
    found+=("v${major}.${mm}.0")
    pmiss=0; p=1
    while [ "$pmiss" -lt "$MISS_LIMIT" ] && [ "$p" -lt 40 ]; do
      if tag_usable "v${major}.${mm}.${p}"; then found+=("v${major}.${mm}.${p}"); pmiss=0
      else pmiss=$(( pmiss + 1 )); fi
      p=$(( p + 1 ))
    done
  done

  [ "${#found[@]}" -eq 0 ] || printf '%s\n' "${found[@]}" | sort -V -r
}

cmd_list() {
  need curl; need jq
  local pinned running sdk newer latest
  pinned="$(repo_tag)"
  running="$(running_tag)"
  sdk="$(node -p "require('${REPO_ROOT}/apps/worker/package.json').dependencies['@trigger.dev/sdk']" 2>/dev/null || echo '?')"

  echo
  echo "  running   ${running:-<trigger-api is not up>}"
  echo "  pinned    ${pinned}   (managed.yml default)"
  echo "  SDK       ${sdk}   (apps/worker — must equal the pinned tag without its v)"
  if [ -n "$running" ] && [ "$running" != "$pinned" ]; then
    echo "  NOTE      what is running and what the repo pins DISAGREE. .env's"
    echo "            TRIGGER_IMAGE_TAG overrides the compose default, so check it."
  fi
  if [ "${pinned#v}" != "$sdk" ]; then
    echo "  NOTE      the pinned tag and the SDK disagree. The bring-up refuses on this."
  fi

  echo
  say "probing the registry upward from ${pinned} (both images must carry a tag)"
  newer="$(probe_upgrades "$pinned")"
  if [ -z "$newer" ]; then
    echo "    nothing newer is published — ${pinned} is the latest usable version."
    return 0
  fi
  echo
  echo "  you can move to:"
  local t
  while read -r t; do [ -n "$t" ] && printf '    %s\n' "$t"; done <<<"$newer"
  latest="$(head -1 <<<"$newer")"
  echo
  echo "  latest    ${latest}"
  echo
  echo "  next:     $0 pin ${latest}      (or: $0 pin --latest)"
  echo "            $0 backup before-${latest}"
}

# ---------------------------------------------------------------- backup --

verify_dump() { # verify_dump <file> — a file is not a backup until it looks like one
  local f="$1" on_disk plain
  [ -s "$f" ] || die "the dump at ${f} is empty. Nothing was backed up."
  # A gzip of an error message is still a valid gzip. Three checks, therefore:
  # the archive decompresses, what comes out is a pg_dump, and there is enough
  # of it to be a database.
  gzip -t "$f" 2>/dev/null || die "the dump at ${f} is not a valid gzip archive."
  # Decompressed ONCE into a variable: `head` and `grep -q` both stop reading
  # early, and either would kill `zcat` mid-stream (#519).
  local first
  first="$(zcat "$f" 2>/dev/null | sed -n '1,20p')"
  grep -q 'PostgreSQL database dump' <<<"$first" ||
    die "the dump at ${f} decompresses, but its first lines are not a pg_dump header.
Whatever is in there, it is not a backup:
$(sed -n '1,3p' <<<"$first")"
  # THE SIZE THAT MATTERS IS THE UNCOMPRESSED ONE. SQL compresses ferociously
  # — a real dump can land under a hundred KB on disk — so a floor on the
  # archive would reject good backups and accept a truncated one that happened
  # to compress badly. The question is how much SQL there is, so ask that.
  on_disk="$(wc -c <"$f")"
  plain="$(zcat "$f" | wc -c)"
  [ "$plain" -ge 4096 ] || die "the dump at ${f} decompresses to ${plain} bytes of SQL —
too little to be ${DB_NAME}. A dump that was cut short looks exactly like this."
  say "verified ${f} ($(numfmt --to=iec "$on_disk" 2>/dev/null || echo "${on_disk}B") on disk, $(numfmt --to=iec "$plain" 2>/dev/null || echo "${plain}B") of SQL)"
}

cmd_backup() {
  local label="${1:-}" stamp out
  docker inspect "$DB_CONTAINER" >/dev/null 2>&1 ||
    die "no container named ${DB_CONTAINER}. Is the stack up?
    ${COMPOSE[*]} ps trigger-db"
  mkdir -p "$BACKUP_DIR"
  # UTC, sortable, and the label is sanitised because it lands in a filename.
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  label="$(printf '%s' "$label" | tr -c 'A-Za-z0-9._-' '-' | sed 's/^-*//;s/-*$//')"
  out="${BACKUP_DIR}/${DB_NAME}-${stamp}${label:+-${label}}.sql.gz"

  say "dumping ${DB_NAME} from ${DB_CONTAINER}"
  # NOT `docker exec ... | gzip > file` alone: exec's exit status would be the
  # pipeline's first command and a failed dump would leave a valid gzip of
  # nothing. pipefail is set, and the dump is verified afterwards regardless.
  if ! docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=plain --no-owner \
       | gzip >"$out"; then
    rm -f "$out"
    die "pg_dump failed. Nothing was written; the previous backups are untouched."
  fi
  verify_dump "$out"
  echo "$out"
}

cmd_backups() {
  [ -d "$BACKUP_DIR" ] || { say "no backups yet at ${BACKUP_DIR}"; return 0; }
  local n
  n="$(find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.sql.gz" | wc -l)"
  [ "$n" -gt 0 ] || { say "no backups yet at ${BACKUP_DIR}"; return 0; }
  say "${n} backup(s) in ${BACKUP_DIR}, newest first:"
  find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.sql.gz" -printf '%T@ %p\n' \
    | sort -rn | cut -d' ' -f2- \
    | while read -r f; do printf '    %-12s %s\n' "$(du -h "$f" | cut -f1)" "$f"; done
}

latest_backup() {
  local listing
  listing="$(find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.sql.gz" -printf '%T@ %p\n' 2>/dev/null | sort -rn)"
  cut -d' ' -f2- <<<"$(head -1 <<<"$listing")"
}

# ----------------------------------------------------------------- drill --

# THE ROUND TRIP, PROVED, WITHOUT TOUCHING THE LIVE DATABASE. Restore into a
# throwaway and compare — a dump that cannot be loaded is not a backup, and
# the only way to know is to load it. The live database is never dropped here;
# `restore` is the only thing that does that, and it asks first.
cmd_drill() {
  local dump drill_db="${DB_NAME}_drill" live_tables drill_tables live_rows drill_rows
  dump="$(cmd_backup drill | tail -1)"

  q() { docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$1" -tAc "$2"; }

  say "restoring it into ${drill_db} — the live ${DB_NAME} is not touched"
  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS ${drill_db} WITH (FORCE)" \
    -c "CREATE DATABASE ${drill_db} OWNER ${DB_USER}" >/dev/null
  # Always drop the throwaway, including when the load below dies.
  trap 'docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS '"${drill_db}"' WITH (FORCE)" >/dev/null 2>&1 || true' EXIT

  if ! zcat "$dump" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$drill_db" -v ON_ERROR_STOP=1 >/dev/null; then
    die "the dump would not load. It is NOT a backup:
    ${dump}"
  fi

  live_tables="$(q "$DB_NAME"  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  drill_tables="$(q "$drill_db" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  [ "$live_tables" = "$drill_tables" ] ||
    die "the restore has ${drill_tables} tables and the live database has ${live_tables}. Not a faithful copy."
  [ "${live_tables:-0}" -ge 10 ] ||
    die "the live ${DB_NAME} reports ${live_tables} tables, which is too few to be a Trigger.dev schema.
Comparing two empty databases would pass this drill while proving nothing."

  # One table with rows that MATTER: a project is the thing a person cannot
  # recreate without a browser. Compared by count, on both sides.
  live_rows="$(q "$DB_NAME"  "SELECT count(*) FROM \"Project\"" 2>/dev/null || echo skip)"
  drill_rows="$(q "$drill_db" "SELECT count(*) FROM \"Project\"" 2>/dev/null || echo skip)"
  if [ "$live_rows" = "skip" ]; then
    say "note: no \"Project\" table to compare — schema names changed upstream. Tables matched (${live_tables})."
  else
    [ "$live_rows" = "$drill_rows" ] ||
      die "the restore holds ${drill_rows} projects and the live database holds ${live_rows}."
    say "round trip proved: ${live_tables} tables, ${live_rows} project(s), restored and compared"
  fi
}

# --------------------------------------------------------------- restore --

cmd_restore() {
  local which="${1:-}" confirm="${2:-}" dump
  [ -n "$which" ] || die "restore needs a file, or --latest. See: $0 backups"
  if [ "$which" = "--latest" ]; then
    dump="$(latest_backup)"
    [ -n "$dump" ] || die "no backups in ${BACKUP_DIR}. Nothing to restore."
  else
    dump="$which"
  fi
  [ -f "$dump" ] || die "no such backup: ${dump}"
  verify_dump "$dump"

  # DESTRUCTIVE, so it says so and refuses without --yes (hard rule 2). The
  # refusal prints the command that would have run, so agreeing is one paste.
  if [ "$confirm" != "--yes" ]; then
    cat >&2 <<EOF
[trigger-version] REFUSING: restoring DROPS the live ${DB_NAME} and replaces it with

    ${dump}

Everything written to Trigger.dev since that dump — runs, deployments, keys
minted after it — is gone. This is the right move when an upgrade went wrong,
and the wrong one at any other time.

Stop the consumers first, or the webapp will write into a database being
replaced underneath it:

    ${COMPOSE[*]} stop trigger-api trigger-supervisor
    $0 restore ${dump} --yes
    ${COMPOSE[*]} up -d trigger-api trigger-supervisor
EOF
    exit 1
  fi

  # Refuse while the webapp is up, rather than half-replacing a live database.
  if [ "$(docker inspect --format '{{.State.Running}}' trigger-api 2>/dev/null || echo false)" = "true" ]; then
    die "trigger-api is still running. Stop it first:
    ${COMPOSE[*]} stop trigger-api trigger-supervisor"
  fi

  say "restoring ${dump} into ${DB_NAME}"
  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)" \
    -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}" >/dev/null
  zcat "$dump" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 >/dev/null ||
    die "the restore failed part way. ${DB_NAME} is now INCOMPLETE — load the dump by hand and read the error:
    zcat ${dump} | docker exec -i ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME}"
  say "restored. Put TRIGGER_IMAGE_TAG and the SDK back to the version that dump came from, then:"
  say "  ${COMPOSE[*]} up -d trigger-api trigger-supervisor"
}

# ------------------------------------------------------------------- pin --

# All four places at once, because moving one is the drift that broke the gate
# on 2026-08-24: dependabot bumped apps/worker's SDK alone and every managed
# run died at the bring-up.
cmd_pin() {
  need curl; need jq
  local want="${1:-}" bare
  [ -n "$want" ] || die "pin needs a version (v4.5.12), or --latest. See: $0 list"
  if [ "$want" = "--latest" ]; then
    want="$(head -1 <<<"$(probe_upgrades "$(repo_tag)")")"
    [ -n "$want" ] || die "nothing newer than $(repo_tag) is published — already on the latest."
    say "latest published in both images: ${want}"
  fi
  case "$want" in v[0-9]*.[0-9]*.[0-9]*) : ;; *) die "expected a tag like v4.5.12, got '${want}'" ;; esac

  # Both images, checked by manifest rather than by the paginated tag list.
  tag_exists trigger.dev "$want" || die "ghcr.io/triggerdotdev/trigger.dev:${want} is not published."
  tag_exists supervisor  "$want" || die "ghcr.io/triggerdotdev/supervisor:${want} is not published — the
webapp and the supervisor run ONE tag, so a half-published version is not usable."

  bare="${want#v}"
  say "moving all four places to ${want}"
  sed -i -E "s|\\\$\\{TRIGGER_IMAGE_TAG:-v[0-9]+\.[0-9]+\.[0-9]+\\}|\${TRIGGER_IMAGE_TAG:-${want}}|g" "${SCRIPT_DIR}/managed.yml"
  sed -i -E "s|^TRIGGER_IMAGE_TAG=v[0-9]+\.[0-9]+\.[0-9]+$|TRIGGER_IMAGE_TAG=${want}|" "${SCRIPT_DIR}/managed.env.example"
  sed -i -E "s|(\"@trigger\.dev/sdk\": \")[0-9]+\.[0-9]+\.[0-9]+(\")|\1${bare}\2|" "${REPO_ROOT}/apps/worker/package.json"

  cat <<EOF

[trigger-version] the repo now pins ${want}. NOT YET APPLIED — this changed
files, nothing running. What remains, in this order:

  1. pnpm install                      # the lockfile has to follow the SDK
  2. git diff                          # four places should have moved, no more
  3. $0 backup before-${want}          # the schema migration is ONE WAY
  4. read docs/managed-bring-up.md's upgrade order — do NOT upgrade with runs
     in flight; drain EXECUTING first, or every run loops on
     "Snapshot changed inside startRunAttempt"
  5. open a PR; the gate's own run performs the upgrade on this machine

Rolling back means: $0 restore --latest --yes, and pinning the old version.
EOF
}

case "${1:-}" in
  list)    shift; cmd_list "$@" ;;
  backup)  shift; cmd_backup "$@" ;;
  backups) shift; cmd_backups "$@" ;;
  drill)   shift; cmd_drill "$@" ;;
  restore) shift; cmd_restore "$@" ;;
  pin)     shift; cmd_pin "$@" ;;
  *) sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# \?//' >&2; exit 1 ;;
esac
