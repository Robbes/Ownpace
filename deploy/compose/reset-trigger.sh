#!/usr/bin/env bash
# reset-trigger.sh — destroy the Trigger.dev orchestration state and start over.
#
# WHEN THIS IS THE RIGHT ANSWER. The self-hosted platform keeps its own database,
# and some of what it holds cannot be repaired through its API — most sharply, a
# secret encrypted under a discarded TRIGGER_ENCRYPTION_KEY. `envvars.upload`
# READS before it writes, so it fails on exactly the value that needs replacing;
# `envvars.del` reported the variable missing while the row plainly existed. When
# every route in and out of a value goes through code that cannot read it, there
# is nothing left to fix and this is faster than being clever.
#
# WHAT IT DESTROYS: the Trigger.dev database — the account, the organisation, the
# project (so its `proj_` ref and `tr_prod_` key), every deployment, and the run
# history.
#
# WHAT IT DOES NOT TOUCH: `ownpace-db`. Tenants, mappings, items,
# connections, invoices and the audit log are in a different database and a
# different volume, and this script names the one it removes rather than
# sweeping. The API and the pooler keep serving throughout.
#
# WHY IT IS A SCRIPT. The sequence has a trap that cost a round on the reference
# box: the volume belongs to `trigger-db`, so stopping `trigger-api` and
# `trigger-supervisor` is not enough — `docker volume rm` refuses while the
# database container still holds it, and the bring-up afterwards then quietly
# reuses the old state and fails in the same way as before. And the stale
# `TRIGGER_PROJECT_REF` in .env has to be cleared, or the `account` phase sees it
# populated, decides there is nothing to do, and skips the human step that is now
# mandatory.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml")
VOLUME="ownpace-managed_trigger_db_data"

if [ "${1:-}" != "--yes" ]; then
  cat >&2 <<EOF
reset-trigger.sh destroys the Trigger.dev database:

  - the account, organisation and project (its proj_ ref and tr_prod_ key)
  - every deployment
  - the entire run history

It does NOT touch ownpace-db — tenants, mappings, items, connections and
invoices are in a different database and are not affected.

Afterwards you do the one human step again (dashboard: sign in, name an
organisation and a project), and the bootstrap walks the rest.

Re-run with --yes if that is what you want:
  ./deploy/compose/reset-trigger.sh --yes
EOF
  exit 1
fi

echo "[reset-trigger] stopping everything that holds the volume open"
# trigger-db is the one that matters — the others are stopped because they hold
# connections to it and would reconnect to a half-gone database.
"${COMPOSE[@]}" stop trigger-supervisor trigger-api trigger-db
"${COMPOSE[@]}" rm -f trigger-supervisor trigger-api trigger-db

echo "[reset-trigger] removing ${VOLUME}"
if docker volume rm "$VOLUME"; then
  echo "[reset-trigger] removed"
else
  echo "[reset-trigger] ERROR: could not remove ${VOLUME}." >&2
  echo "[reset-trigger] Something still has it open. Find out what, rather than" >&2
  echo "[reset-trigger] continuing — a bring-up on the old database fails the same" >&2
  echo "[reset-trigger] way it did before, which is how this trap wastes a round:" >&2
  echo "[reset-trigger]   docker ps -a --filter volume=${VOLUME}" >&2
  exit 1
fi

# The old project's identity must go too. Left in place, bootstrap-managed.sh's
# `account` phase sees them populated, reports "nothing to do", and skips the
# human step — then everything downstream addresses a project that no longer
# exists.
echo "[reset-trigger] clearing the old project identity from .env"
"${SCRIPT_DIR}/env-upsert.sh" "$ENV_FILE" TRIGGER_PROJECT_REF= TRIGGER_SECRET_KEY=

cat <<'EOF'

[reset-trigger] done. Next:

  ./deploy/compose/bootstrap-managed.sh --from trigger

It will bring the plane up empty and STOP at the `account` phase with the
browser steps. After you have named an organisation and a project:

  ./deploy/compose/bootstrap-managed.sh --from account

which reads the new project's credentials, stops once for the CLI login (the
old token died with the old instance), and then finishes: app, task
environment, deploy.
EOF
