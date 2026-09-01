#!/usr/bin/env bash
# local-pg.sh — a real Postgres with both migration chains on it, without a
# container runtime.
#
# WHY THIS EXISTS. `pnpm test:integration` self-manages its stack through
# Testcontainers, which needs a docker daemon. A remote agent session has none:
# `docker` is on the PATH and there is no runtime behind it, so every
# integration test dies at `Could not find a working container runtime strategy`
# before a single test body runs. The effect is not that integration tests fail
# — it is that SQL stops being checkable at all, and queries get reasoned about
# instead of run.
#
# That is not hypothetical. On 2026-09-01 five housekeeping queries were written
# for `operator.sh check`, every one of them reviewed and none of them executed.
# The first run against a real database found `connection.display_name` is NOT
# NULL, in about a second. A unit test cannot find that: a query is a string
# until something parses it.
#
# So: initdb a throwaway cluster, apply `packages/ledger/migrations` then
# `packages/managed/migrations`, print the URL, and get out of the way.
#
#   ./scripts/local-pg.sh up       # start + migrate, print TEST_DATABASE_URL
#   ./scripts/local-pg.sh url      # print it again, for $(…)
#   ./scripts/local-pg.sh status   # is it up, and what is on it
#   ./scripts/local-pg.sh down     # stop and delete the cluster
#
# Typical use:
#
#   eval "$(./scripts/local-pg.sh up)"        # exports TEST_DATABASE_URL
#   npx vitest run --config <a config with no globalSetup> path/to.integration.test.ts
#   ./scripts/local-pg.sh down
#
# WHAT THIS IS NOT. It is not a replacement for `pnpm test:integration`, and CI
# still runs that: Testcontainers pins the server version the product is
# deployed against, and this uses whatever the machine has. It is the way to ASK
# THE DATABASE A QUESTION while writing the query — the gap between "I believe
# this SQL is right" and "I watched it answer".
#
# THE CLUSTER LIVES OUTSIDE THE REPO, deliberately. `git clean -ffdx` is a
# routine step on the runner and would take a data directory with it; the
# `Check for committed artifacts` CI job would refuse it besides.
set -euo pipefail

PGDIR="${LOCAL_PG_DIR:-/tmp/ownpace-local-pg}"
PGPORT_LOCAL="${LOCAL_PG_PORT:-55999}"
PGUSER_LOCAL="${LOCAL_PG_USER:-openmigrate}"
PGDB_LOCAL="${LOCAL_PG_DB:-openmigrate_test}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${PGDIR}/data"
SOCK="${PGDIR}/sock"
LOG="${PGDIR}/postgres.log"
URL="postgresql://${PGUSER_LOCAL}@127.0.0.1:${PGPORT_LOCAL}/${PGDB_LOCAL}"

# THE CHAINS, IN ORDER, AND THE ORDER IS LOAD-BEARING: every table in the
# managed chain references `public.tenant`, which the ledger chain creates.
# `vitest.global-setup.ts` says the same thing about the Testcontainers
# database, and for the same reason — this is the second reading of that.
CHAINS=("packages/ledger/migrations" "packages/managed/migrations")

# ---------------------------------------------------------------------------
# Finding the binaries, and refusing in a way somebody can act on
# ---------------------------------------------------------------------------

find_pgbin() {
  local candidate
  # A Debian/Ubuntu install puts them in a versioned directory that is NOT on
  # the PATH — only the client wrappers are. Highest version first.
  for candidate in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -rV); do
    if [ -x "${candidate}/initdb" ]; then printf '%s' "$candidate"; return 0; fi
  done
  # A Homebrew or source install has them on the PATH already.
  if command -v initdb >/dev/null 2>&1; then
    dirname "$(command -v initdb)"
    return 0
  fi
  return 1
}

PGBIN=""
require_pgbin() {
  if ! PGBIN="$(find_pgbin)"; then
    cat >&2 <<'MSG'
FATAL: no PostgreSQL server binaries on this machine (initdb was not found).

This script needs the SERVER, not just the psql client — `psql` alone is a
client for somebody else's database, and there isn't one here.

  Debian/Ubuntu   apt-get install -y postgresql
  macOS           brew install postgresql@16

If you have a database already, skip this script entirely and point the tests
at it:  TEST_DATABASE_URL=postgresql://user@host:port/db
MSG
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# initdb and pg_ctl refuse to run as root, so drop to `postgres` when we are
# ---------------------------------------------------------------------------
#
# A remote agent session is root; a developer's laptop is not. Both are ordinary
# and the difference is one `su`. Getting this wrong costs a confusing
# `initdb: error: cannot be run as root` that reads like the script is broken.
#
# `psql` is NOT run this way: it connects over TCP with `trust` auth, so any
# local user may be the owner, and running it as root keeps file redirection
# and $? behaving normally.
as_server_user() {
  if [ "$(id -u)" = "0" ]; then
    su postgres -s /bin/sh -c "PATH='${PGBIN}':\$PATH; $1"
  else
    PATH="${PGBIN}:$PATH" /bin/sh -c "$1"
  fi
}

is_running() {
  [ -f "${DATA}/postmaster.pid" ] && as_server_user "pg_ctl -D '${DATA}' status" >/dev/null 2>&1
}

port_is_taken() {
  # No `| grep -q`: under pipefail a matching grep kills the producer and hands
  # back 141 (hard rule 10). A here-string has no producer to kill.
  local listeners
  listeners="$( (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) )"
  [[ "$listeners" =~ :${PGPORT_LOCAL}[[:space:]] ]]
}

# ---------------------------------------------------------------------------

cmd_up() {
  require_pgbin

  if is_running; then
    echo "[local-pg] already running on ${PGPORT_LOCAL} — reusing it" >&2
    cmd_url
    return 0
  fi

  if port_is_taken; then
    echo "FATAL: something is already listening on ${PGPORT_LOCAL}, and it is not a cluster" >&2
    echo "       this script started. Pick another:  LOCAL_PG_PORT=55998 $0 up" >&2
    exit 1
  fi

  echo "[local-pg] creating a cluster in ${DATA}" >&2
  rm -rf "${PGDIR}"
  mkdir -p "${DATA}" "${SOCK}"
  if [ "$(id -u)" = "0" ]; then
    # The parents must be TRAVERSABLE by postgres, not just the leaf owned by
    # it — an initdb that cannot cd into its own data directory fails with
    # "Permission denied" and no hint about which component.
    chmod 755 "${PGDIR}"
    chown -R postgres:postgres "${PGDIR}"
  fi
  chmod 700 "${DATA}"

  # `trust` because this cluster is reachable only from this machine, holds only
  # fixtures, and lives for the length of one piece of work. It is also why
  # nothing here has a password to leak into a shell history.
  as_server_user "initdb -D '${DATA}' -U '${PGUSER_LOCAL}' --auth=trust" >/dev/null

  as_server_user "pg_ctl -D '${DATA}' \
    -o '-p ${PGPORT_LOCAL} -k ${SOCK} -c listen_addresses=127.0.0.1' \
    -l '${LOG}' start" >/dev/null

  # pg_ctl returns when the postmaster reports ready, but a first connection
  # immediately after can still race the socket. Ask, rather than sleep.
  local tries=0
  until psql -h 127.0.0.1 -p "${PGPORT_LOCAL}" -U "${PGUSER_LOCAL}" -d postgres \
             -Atc 'SELECT 1' >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 30 ]; then
      echo "FATAL: the cluster started but never accepted a connection. Its log:" >&2
      tail -20 "${LOG}" >&2 || true
      exit 1
    fi
    sleep 0.5
  done

  psql -h 127.0.0.1 -p "${PGPORT_LOCAL}" -U "${PGUSER_LOCAL}" -d postgres \
       -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE ${PGDB_LOCAL};"

  cmd_migrate
  echo "[local-pg] ready" >&2
  cmd_url
}

cmd_migrate() {
  local chain dir file
  for chain in "${CHAINS[@]}"; do
    dir="${REPO_ROOT}/${chain}"
    [ -d "$dir" ] || { echo "FATAL: no migrations at ${chain}" >&2; exit 1; }
    echo "[local-pg] applying ${chain}" >&2
    # `ON_ERROR_STOP=1` is the whole point: without it psql reports every
    # failed statement and still exits 0, and the cluster comes up missing a
    # table that nothing said it was missing. Rule 9, in one flag.
    for file in "$dir"/*.sql; do
      # `client_min_messages=warning` silences the NOTICE every idempotent
      # `DROP … IF EXISTS` emits — forty of them per run, which buries the two
      # lines that matter. Warnings and errors still print, and ON_ERROR_STOP
      # still stops.
      PGOPTIONS='-c client_min_messages=warning' \
        psql -h 127.0.0.1 -p "${PGPORT_LOCAL}" -U "${PGUSER_LOCAL}" -d "${PGDB_LOCAL}" \
             -v ON_ERROR_STOP=1 -q -f "$file"
    done
  done
}

cmd_url() {
  # On stdout, alone and eval-able. Everything else this script says goes to
  # stderr precisely so that `eval "$(local-pg.sh up)"` works.
  echo "export TEST_DATABASE_URL='${URL}'"
}

cmd_status() {
  # `require_pgbin` here and not only in `up`: is_running() shells out to
  # pg_ctl, and with PGBIN unset it fails for want of a binary rather than for
  # want of a cluster — reporting "not running" about one that is. Found by
  # running this script's own `status` a minute after its own `up`.
  require_pgbin
  if ! is_running; then
    echo "[local-pg] not running (${DATA})" >&2
    exit 1
  fi
  local tables
  tables="$(psql -h 127.0.0.1 -p "${PGPORT_LOCAL}" -U "${PGUSER_LOCAL}" -d "${PGDB_LOCAL}" -Atc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
  echo "[local-pg] running on ${PGPORT_LOCAL}, ${tables} tables in ${PGDB_LOCAL}" >&2
  cmd_url
}

cmd_down() {
  if [ ! -d "${PGDIR}" ]; then
    echo "[local-pg] nothing to remove at ${PGDIR}" >&2
    return 0
  fi
  if PGBIN="$(find_pgbin)" && is_running; then
    as_server_user "pg_ctl -D '${DATA}' stop -m fast" >/dev/null 2>&1 || true
  fi
  # Only ever the directory this script was configured to create. A `down` that
  # took a path from somewhere else is the one bug in here that could cost
  # somebody real data.
  rm -rf "${PGDIR}"
  echo "[local-pg] removed ${PGDIR}" >&2
}

case "${1:-}" in
up) cmd_up ;;
url) cmd_url ;;
status) cmd_status ;;
down) cmd_down ;;
*)
  cat >&2 <<MSG
usage: $0 {up|url|status|down}

  up      create a cluster in ${PGDIR}, apply both migration chains, print the URL
  url     print the URL of the cluster this script manages
  status  say whether it is running and how many tables it has
  down    stop it and delete ${PGDIR}

  LOCAL_PG_DIR   where the cluster lives   (${PGDIR})
  LOCAL_PG_PORT  what it listens on        (${PGPORT_LOCAL})
  LOCAL_PG_DB    the database it creates   (${PGDB_LOCAL})
MSG
  exit 2
  ;;
esac
