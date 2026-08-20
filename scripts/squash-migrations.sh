#!/usr/bin/env bash
# Copyright 2026 The Ownpace authors (Apache-2.0)
#
# Squash packages/ledger/migrations/*.sql into ONE baseline file, by applying the
# existing chain to a throwaway database and dumping the result — never by
# hand-merging the SQL.
#
# WHY BY DUMP RATHER THAN BY HAND. The chain is not just CREATE TABLEs: 0002/0008/
# 0011 build and then rewrite RLS policies, 0009 creates a role and grants, 0017
# replaces a CHECK constraint, and a dozen later files add columns and indexes to
# `item`. Hand-merging that means predicting the end state, and a silent
# divergence in an RLS policy is a tenant-isolation bug that no test would
# necessarily catch. A dump of the actually-applied schema is correct by
# construction, and this script then PROVES it: it applies the generated baseline
# to a second database and refuses unless the two dumps are byte-identical.
#
# ONLY SAFE PRE-RELEASE. Squashing rewrites history the migration runner keys on
# (`schema_migrations.version` is the filename), so any database that already
# recorded the old chain will trip the runner's downgrade guard and refuse to
# start. That is the correct outcome — such a database must be dropped and
# recreated. Do not run this once real data exists anywhere.
#
# Usage:
#   ADMIN_URL='postgres://postgres@127.0.0.1:5432' scripts/squash-migrations.sh          # dry run
#   ADMIN_URL='postgres://postgres@127.0.0.1:5432' scripts/squash-migrations.sh --apply  # write it
#
# ADMIN_URL must be a superuser/owner connection WITHOUT a database name — the
# script creates and drops its own scratch databases. Migrations create roles and
# RLS policies, so a plain app role is not enough.
#
# A throwaway Postgres is enough, e.g.:
#   docker run --rm -d -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust --name pgsquash postgres:18

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/packages/ledger/migrations"
BASELINE_NAME="0001_baseline.sql"

APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

if [[ -z "${ADMIN_URL:-}" ]]; then
  echo "error: ADMIN_URL is required (superuser connection, no database name)." >&2
  echo "       see the header of this script for an example." >&2
  exit 2
fi

OLD_DB=openmig_squash_old
NEW_DB=openmig_squash_new
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

psql_admin() { psql "$ADMIN_URL/postgres" -v ON_ERROR_STOP=1 -q "$@"; }
psql_db() { psql "$ADMIN_URL/$1" -v ON_ERROR_STOP=1 -q "${@:2}"; }

# Identical flags for both dumps, so any difference is a real schema difference.
#   --schema-only  : DDL, no rows
#   --no-owner     : never bake in whichever role happened to run this
dump_schema() { pg_dump "$ADMIN_URL/$1" --schema-only --no-owner; }

# ---------------------------------------------------------------------------
# 1. Apply the existing chain, in the same linear filename order the runner uses.
# ---------------------------------------------------------------------------
mapfile -t CHAIN < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -printf '%f\n' | sort)
if [[ ${#CHAIN[@]} -eq 0 ]]; then
  echo "error: no .sql files in $MIGRATIONS_DIR" >&2
  exit 1
fi
if [[ ${#CHAIN[@]} -eq 1 && "${CHAIN[0]}" == "$BASELINE_NAME" ]]; then
  echo "Already squashed: $MIGRATIONS_DIR contains only $BASELINE_NAME. Nothing to do."
  exit 0
fi

echo "==> Applying ${#CHAIN[@]} migration(s) to $OLD_DB"
psql_admin -c "DROP DATABASE IF EXISTS $OLD_DB" -c "CREATE DATABASE $OLD_DB"
for f in "${CHAIN[@]}"; do
  # -1: one transaction per file, matching the runner's applyOne().
  psql_db "$OLD_DB" -1 -f "$MIGRATIONS_DIR/$f"
done
dump_schema "$OLD_DB" > "$WORK/old.sql"
echo "    dumped $(wc -l < "$WORK/old.sql") lines of schema"

# ---------------------------------------------------------------------------
# 2. Turn the dump into a migration the runner can actually execute.
#
# Three things in a raw pg_dump would break it, all of them silently until run:
#   - `\restrict` / `\unrestrict` are PSQL META-COMMANDS. The runner executes SQL
#     through node-postgres, which has no psql, so these are syntax errors.
#   - `SELECT pg_catalog.set_config('search_path', '', false)` sets an EMPTY
#     search_path for the whole session (false = not transaction-local). The
#     runner's very next statement is `INSERT INTO schema_migrations` — unqualified
#     — which would then fail to resolve. The dump schema-qualifies everything as
#     `public.`, so dropping this is safe.
#   - `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ...` bakes in the name of
#     whichever role produced the dump. Rewritten to the unqualified form (which
#     applies to the current role), matching what 0009 originally wrote.
#
# And one thing pg_dump legitimately CANNOT know: roles are cluster-global, not
# per-database, so `app_user` is absent from the dump. Its (idempotent) creation
# is prepended, carried over verbatim from 0009.
# ---------------------------------------------------------------------------
echo "==> Building $BASELINE_NAME"
{
  cat <<'HEADER'
-- Baseline schema for the ledger (squashed).
--
-- GENERATED — do not hand-edit. Produced by scripts/squash-migrations.sh, which
-- applies the previous migration chain to a throwaway database and dumps the
-- result, then proves the baseline reproduces that schema byte-for-byte.
--
-- This replaces the original 0001..0028 chain, squashed while the product was
-- still pre-release and no database anywhere held real data. The chain is kept in
-- git history; nothing is lost. To add a schema change, write a NEW numbered file
-- alongside this one exactly as before — this file is only ever regenerated by
-- squashing again, which is a deliberate pre-release-only operation.
--
-- Roles are cluster-global, so pg_dump omits them; `app_user` (from the old 0009)
-- is created here first. Everything below is pg_dump output.

-- Application role for RLS enforcement. A non-superuser, because superusers
-- bypass row-level security even when it is FORCEd — so the application must not
-- connect as one. Idempotent: re-running finds the role and does nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_password';
  END IF;
END
$$;

HEADER
  sed -E \
    -e '/^\\(un)?restrict /d' \
    -e "/^SELECT pg_catalog\.set_config\('search_path'/d" \
    -e 's/^ALTER DEFAULT PRIVILEGES FOR ROLE [A-Za-z0-9_"]+ /ALTER DEFAULT PRIVILEGES /' \
    "$WORK/old.sql"
} > "$WORK/$BASELINE_NAME"

# ---------------------------------------------------------------------------
# 3. PROVE equivalence: apply the baseline to a clean database and require that
#    its dump matches the original chain's dump exactly.
# ---------------------------------------------------------------------------
echo "==> Verifying $BASELINE_NAME reproduces the same schema"
psql_admin -c "DROP DATABASE IF EXISTS $NEW_DB" -c "CREATE DATABASE $NEW_DB"
psql_db "$NEW_DB" -1 -f "$WORK/$BASELINE_NAME"
dump_schema "$NEW_DB" > "$WORK/new.sql"

# The `\restrict` token is random per dump, so normalise it away on both sides
# before comparing; it carries no schema meaning.
normalise() { sed -E -e '/^\\(un)?restrict /d' -e '/^-- Dumped (from|by)/d' "$1"; }
normalise "$WORK/old.sql" > "$WORK/old.norm"
normalise "$WORK/new.sql" > "$WORK/new.norm"

if ! diff -u "$WORK/old.norm" "$WORK/new.norm" > "$WORK/schema.diff"; then
  echo "FAILED: the baseline does not reproduce the chain's schema." >&2
  echo "        (this is the whole point of the check — do not apply it)" >&2
  head -100 "$WORK/schema.diff" >&2
  exit 1
fi
echo "    identical: $(wc -l < "$WORK/old.norm") lines, 0 differences"

psql_admin -c "DROP DATABASE IF EXISTS $OLD_DB" -c "DROP DATABASE IF EXISTS $NEW_DB"

# ---------------------------------------------------------------------------
# 4. Swap it in (only with --apply).
# ---------------------------------------------------------------------------
if [[ "$APPLY" != true ]]; then
  echo ""
  echo "Dry run. Verified equivalent but nothing written."
  echo "Re-run with --apply to replace ${#CHAIN[@]} files with $BASELINE_NAME."
  exit 0
fi

for f in "${CHAIN[@]}"; do rm -f "$MIGRATIONS_DIR/$f"; done
cp "$WORK/$BASELINE_NAME" "$MIGRATIONS_DIR/$BASELINE_NAME"
echo ""
echo "Wrote $MIGRATIONS_DIR/$BASELINE_NAME and removed ${#CHAIN[@]} superseded file(s)."
echo "Every existing dev/CI database must now be dropped and recreated — the"
echo "runner's downgrade guard will refuse to start against one that recorded the"
echo "old chain."
