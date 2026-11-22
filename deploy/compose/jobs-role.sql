-- The jobs' own role and schema: `ownpace_jobs`, owning `pgboss` and nothing
-- else (ADR-0054, workplan 0167 T7's first part).
--
-- pg-boss keeps its queues in tables of its own, in the ledger's database,
-- and the managed edition's worker will reach them as this role, through
-- PgBouncer in transaction mode (JOBS_DATABASE_URL, a later change). Nothing
-- connects as it yet. It is a plain role: no superuser, no CREATEDB, no
-- CREATEROLE, no REPLICATION, no BYPASSRLS, NOINHERIT, a member of no role,
-- and no privilege on any table of `public`. pg-boss's tables hold job ids
-- and payloads of ids, never an organisation's rows, so they carry no row
-- security; no grant on them goes to `app_user` or anyone else, so no other
-- role but a superuser reads them (docs/rls-guide.md, "Where row security
-- holds today").
--
-- MADE BY THE BRING-UP, NOT BY A MIGRATION, as pgbouncer/setup-auth.sql's role
-- is: bootstrap-managed.sh's data phase runs this file on every run, as the
-- database's owner over the socket (db-roles.sh, db_roles_jobs_ensure), then
-- asks the catalog whether the role is fit (db_roles_jobs_fit), sets its
-- password from .env's JOBS_DB_PASSWORD (db_roles_jobs_set) and proves it over
-- the network and through the pooler (db_roles_jobs_prove). A migration would
-- make live's deploy of this release one-way (deploy-live.sh's rule).
--
-- IDEMPOTENT, AND IT REPAIRS NOTHING. The role is created with its attributes
-- when it does not exist, and left as it is when it does: a role that was
-- changed since is for db_roles_jobs_fit to refuse, naming why, never for this
-- file to put right without a word. The schema is created when it does not
-- exist; one that exists and is not the role's is refused by the same
-- question. A second run changes nothing (a-jobs-role-that-owns-only-its-queue,
-- integration, holds that).
--
-- No password here: the role is made with none, so it cannot log in until the
-- bring-up sets .env's value on it, and this file carries no value at all.
-- Plain SQL, no psql meta-command, so the integration test runs this very file
-- as it is. Run with ON_ERROR_STOP:
--
--   psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < jobs-role.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ownpace_jobs') THEN
    CREATE ROLE ownpace_jobs LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- The role may not create a schema in this database (it has no CREATE on it),
-- so the schema is made for it here, owned by it: pg-boss then creates its
-- tables, functions and types inside it as that role.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ownpace_jobs;

-- A new schema grants PUBLIC nothing already; said here, so that it stays so
-- whatever the server's defaults become.
REVOKE ALL ON SCHEMA pgboss FROM PUBLIC;
