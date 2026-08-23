#!/usr/bin/env bash
# Copyright 2026 The Ownpace authors (Apache-2.0)
#
# The CONTAINER-level N-1 -> N upgrade drill (workplan 0025 T5, SAD §22.1).
#
# The unit gate (`packages/ledger/src/migrate-upgrade.unit.test.ts`) proves the
# SCHEMA upgrades: the released migrations apply, the new ones apply on top,
# the result matches a fresh install, and an older build is refused. It runs on
# every PR and needs nothing but git.
#
# THIS drill proves the three things that one cannot, because it uses a single
# build of everything for both sides:
#
#   1. The new image can OPEN A STATE DIRECTORY THE OLD IMAGE WROTE. PGlite is
#      Postgres compiled to WASM, and its on-disk format is its own business —
#      a format change between releases would break every appliance upgrade in
#      the field, and no amount of SQL-level testing would see it coming.
#   2. Migrations run through the APPLIANCE'S OWN STARTUP PATH (advisory lock,
#      driver seam, the real boot sequence) rather than a test calling
#      `runMigrations` directly.
#   3. The container comes back HEALTHY against a pre-existing volume, and
#      still reports the mappings it had.
#
# SAFETY: its own compose project, its own volumes AND its own container name.
# The last of those needs `compose.drill.yml`, because `container_name` in the
# base file is a fixed string that `-p` does not namespace — without the
# override a drill run would collide with a real appliance rather than ignore
# it. It removes only what it created.
#
# HONESTY: while the release tag and HEAD are the same commit, this proves the
# MECHANICS and nothing about version skew — both sides are the same software.
# It gains its real teeth at the next release. The script says which case it is
# rather than printing a green tick either way.
#
#   Usage:  scripts/upgrade-drill.sh [FROM_TAG]
#   e.g.    scripts/upgrade-drill.sh v0.1.0-rc.1
#
# Requires: docker, docker compose, curl, git. No source/target servers — this
# drills the appliance's own upgrade, not a migration.

set -euo pipefail

FROM_TAG="${1:-v0.1.0-rc.1}"
FROM_VERSION="${FROM_TAG#v}"

# The registry path depends on WHICH release we are upgrading FROM, because the
# product was renamed (ADR-0040) and an image already published does not move.
# Everything up to and including v0.1.0-rc.1 was pushed as `open-migrate-selfhost`;
# from v0.1.0 on it is `ownpace-selfhost`. Deriving this from the tag is the whole
# point: hardcoding either one makes the drill pull a tag that does not exist —
# silently, from a script whose entire job is to prove upgrades work.
case "$FROM_VERSION" in
  0.1.0-rc.*) REGISTRY="ghcr.io/robbes/open-migrate-selfhost" ;;
  *)          REGISTRY="ghcr.io/robbes/ownpace-selfhost" ;;
esac
PROJECT="ownpace-upgrade-drill"
PORT="${DRILL_PORT:-8099}"
BASE="http://127.0.0.1:${PORT}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# PGlite path on purpose: one container, no server, and it is the shape a
# native installer ships — so the state directory is the thing being upgraded,
# which is exactly the risk this drill exists for.
# `compose.drill.yml` carries the two isolations `-p` does not give: a
# container name of its own, and a mounted config so the appliance actually
# has a mapping to lose. See that file for why both are load-bearing.
DRILL_CONFIG_DIR="$(mktemp -d)"
export DRILL_CONFIG_DIR
COMPOSE=(docker compose -p "$PROJECT"
  -f deploy/selfhost/compose.yml
  -f deploy/selfhost/compose.pglite.yml
  -f deploy/selfhost/compose.drill.yml)

say() { printf '\n=== %s\n' "$*"; }
fail() { printf '\nDRILL FAILED: %s\n' "$*" >&2; exit 1; }

cleanup() {
  say "Cleaning up the drill's own project (your appliances are untouched)"
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  [ -n "${DRILL_CONFIG_DIR:-}" ] && rm -rf "$DRILL_CONFIG_DIR"
  return 0
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 0. Preconditions, stated before anything is created.
# ---------------------------------------------------------------------------
command -v docker >/dev/null || fail "docker is not installed"
git rev-parse --verify "${FROM_TAG}^{commit}" >/dev/null 2>&1 \
  || fail "$FROM_TAG is not reachable. Run: git fetch origin --tags"

# `env_file:` is not optional to compose — a missing .env aborts the whole run
# with a message about the file rather than about the drill.
if [ ! -f deploy/selfhost/.env ]; then
  say "Creating a throwaway deploy/selfhost/.env for the drill"
  printf 'POSTGRES_PASSWORD=drill-only-not-a-secret\n' > deploy/selfhost/.env
fi

# Is there actually a version difference to drill? Reported, never assumed.
FROM_MIGRATIONS="$(git ls-tree --name-only "$FROM_TAG" packages/ledger/migrations/ | grep -c '\.sql$' || true)"
HEAD_MIGRATIONS="$(find packages/ledger/migrations -name '*.sql' | wc -l | tr -d ' ')"
if [ "$FROM_MIGRATIONS" = "$HEAD_MIGRATIONS" ]; then
  VACUOUS=1
  say "NOTE: $FROM_TAG and the working tree both carry $HEAD_MIGRATIONS migrations."
  echo "    This run proves the MECHANICS — old image writes state, new image"
  echo "    opens it, migrates on startup and comes back healthy. It exercises"
  echo "    NO migration. It gains teeth at the next release."
else
  VACUOUS=0
  say "Upgrading across $((HEAD_MIGRATIONS - FROM_MIGRATIONS)) new migration(s)."
fi

# One real mapping, from the shipped example. The appliance has to CONFIGURE
# it and keep reporting it across the upgrade; it never has to reach anything,
# because this drills an appliance upgrade, not a migration.
cp deploy/selfhost/config/mapping.json.example "$DRILL_CONFIG_DIR/mapping.json"

wait_healthy() {
  local what="$1" i
  for i in $(seq 1 60); do
    if curl -sf "${BASE}/healthz" >/dev/null 2>&1; then
      echo "    $what is healthy (after $((i * 2))s)"
      return 0
    fi
    sleep 2
  done
  "${COMPOSE[@]}" logs app --no-color --tail 80 || true
  fail "$what never became healthy at ${BASE}"
}

# ---------------------------------------------------------------------------
# 1. The RELEASED appliance, from the registry. Not built — pulled, so this is
#    the artifact an operator would actually be running.
# ---------------------------------------------------------------------------
say "1/5  Starting the released appliance ($REGISTRY:$FROM_VERSION)"
cleanup                                     # a stale drill project would poison the result
export SELFHOST_IMAGE="${REGISTRY}:${FROM_VERSION}"
export SELFHOST_PORT="$PORT"
export SELFHOST_BIND=127.0.0.1
"${COMPOSE[@]}" pull app || fail "could not pull ${SELFHOST_IMAGE} — is the tag published?"
"${COMPOSE[@]}" up -d --no-build app
wait_healthy "released appliance"

BEFORE_STATUS="$(curl -sf "${BASE}/status")" || fail "released appliance served no /status"
echo "${BEFORE_STATUS:0:400}"

# THE GUARD THAT MAKES STEP 4 MEAN SOMETHING. With no mappings configured, the
# "same mappings before and after" comparison is empty-set against empty-set —
# it passes while proving nothing, which is how the first real run of this
# drill (2026-08-04) reported success on `"mappings":[]`. Refuse to continue.
if ! grep -q '"mappingId"' <<<"$BEFORE_STATUS"; then
  fail "the released appliance configured NO mappings, so nothing downstream can be compared.
    Check $DRILL_CONFIG_DIR/mapping.json — the appliance logs will say why it was rejected:
      ${COMPOSE[*]} logs app"
fi

# Proof the OLD image really did create the database, rather than the drill
# passing against a directory nothing ever wrote.
"${COMPOSE[@]}" exec -T app sh -c 'ls /data/state/pglite >/dev/null' \
  || fail "the released image left no PGlite state directory — nothing to upgrade"
say "    released image wrote its PGlite state directory"

# ---------------------------------------------------------------------------
# 2. Build HEAD. Same volumes, same project — this is an upgrade in place, not
#    a fresh install beside it.
# ---------------------------------------------------------------------------
say "2/5  Building the appliance from the working tree"
export SELFHOST_IMAGE="ownpace-selfhost:upgrade-drill-head"
"${COMPOSE[@]}" build app

say "3/5  Swapping the image in place (volumes kept)"
"${COMPOSE[@]}" up -d --no-deps --force-recreate app
wait_healthy "upgraded appliance"

# ---------------------------------------------------------------------------
# 3. What the upgrade has to have done.
# ---------------------------------------------------------------------------
say "4/5  Checking what the upgraded appliance reports"
AFTER_STATUS="$(curl -sf "${BASE}/status")" || fail "upgraded appliance served no /status"

# The startup migration path ran at all. Its own log line is the evidence; an
# upgrade that silently skipped migrations is the failure mode with no symptom
# until a query hits a missing column.
app_log="$("${COMPOSE[@]}" logs app --no-color --tail 200)"
if ! grep -qi 'migrat' <<<"$app_log"; then
  "${COMPOSE[@]}" logs app --no-color --tail 60
  fail "the upgraded appliance logged nothing about migrations on startup"
fi
say "    startup migration path ran"

# The mappings it knew about are still there. Comparing the mapping id set
# rather than the whole payload: counters legitimately move between two reads,
# the set of configured migrations does not.
ids_of() { echo "$1" | grep -o '"mappingId":"[^"]*"' | sort -u; }
[ -n "$(ids_of "$AFTER_STATUS")" ] || fail "the upgraded appliance reports no mappings at all"
if [ "$(ids_of "$BEFORE_STATUS")" != "$(ids_of "$AFTER_STATUS")" ]; then
  printf 'before: %s\nafter:  %s\n' "$(ids_of "$BEFORE_STATUS")" "$(ids_of "$AFTER_STATUS")"
  fail "the upgraded appliance reports a different set of mappings"
fi
say "    same mappings before and after ($(ids_of "$AFTER_STATUS" | wc -l | tr -d ' ') configured)"

# ---------------------------------------------------------------------------
# 4. Restart once more. An upgrade that only works the first time is a bomb on
#    the next reboot — migrations must be idempotent through the real boot.
# ---------------------------------------------------------------------------
say "5/5  Restarting the upgraded appliance (migrations must be a no-op)"
"${COMPOSE[@]}" restart app >/dev/null
wait_healthy "restarted appliance"
curl -sf "${BASE}/status" >/dev/null || fail "restarted appliance served no /status"

say "DRILL PASSED"
if [ "$VACUOUS" = "1" ]; then
  echo "    Mechanics only: $FROM_TAG and HEAD are the same schema."
  echo "    Re-run this after the next release for the real thing."
else
  echo "    Upgraded across $((HEAD_MIGRATIONS - FROM_MIGRATIONS)) migration(s), in place, on the released artifact."
fi
