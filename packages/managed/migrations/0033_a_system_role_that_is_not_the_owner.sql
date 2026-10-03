-- A system role that is not the owner (workplan 0138 T3 step 2).
--
-- ## Why this exists
--
-- Three Trigger.dev jobs span organisations whole: the sync tick (which
-- mappings are due, across every organisation), retention (prunes across
-- them, each only as far as its last issued invoice) and the purge of closed
-- organisations (revokes their stored credentials and removes their data).
-- Two narrower things cross organisations beside them: the list of active
-- organisations the digest, the drift detector and group discovery visit
-- (`activeOrganisations`, 0138 T2), and every task's audit key, which ledger
-- migration 0062 closes to `app_user`.
--
-- Until this migration all of them connected as the database owner, through
-- `DATABASE_URL`, which `deploy/compose/set-task-env.sh` put in the
-- environment of every run of every task. On the managed stack the owner is a
-- superuser: Postgres applies no row security to it, and it may run programs
-- on the database server (`COPY … TO PROGRAM`), read the server's files,
-- create and change any role, and alter the schema. Every run held that
-- credential while it parsed what servers on the internet send it.
--
-- They connect as this role instead, through `SYSTEM_DATABASE_URL`; the owner
-- answered 0138's open question 2 on 2026-09-28: "For the Alpha, the jobs that
-- span organisations get their own account, one that is not a superuser."
--
-- ## What it is
--
--   LOGIN          the jobs connect as it, through PgBouncer like `app_user`
--                  (`auth_query` looks every role up in Postgres).
--   NOSUPERUSER    no program on the server, no file of the server's, and row
--                  security stops being skipped for any reason but the next.
--   NOCREATEROLE   it can make no role, change no other, and give nobody a
--                  place in itself. It can still change its own password and
--                  its own settings, as any role can (`ALTER ROLE
--                  ownpace_system SET default_transaction_read_only = on`
--                  would stop every write the jobs make): the bring-up sets
--                  the password again and clears every setting on every run.
--   NOCREATEDB     it can make no database.
--   NOREPLICATION  it can stream nothing.
--   BYPASSRLS      REQUIRED, and the one thing it shares with the owner. The
--                  jobs ask questions across organisations (which mappings
--                  are due, which organisations are closed and past their
--                  window), and every one of those tables is row-secured and
--                  FORCEd. With no organisation set, a role that row security
--                  binds reads no row there: the tick would start nothing, the
--                  purge would erase nobody, the list would name nobody, and
--                  each would say so as a quiet night. BYPASSRLS reads past
--                  the policies on the tables it is GRANTED, and nowhere else.
--   no password    none is written here: a value in a public repository is
--                  not a secret. `deploy/compose/ensure-env-secrets.sh`
--                  generates `SYSTEM_DB_PASSWORD` into `.env`, and the
--                  bring-up (`bootstrap-managed.sh`, its `tasks` phase, which
--                  the nightly gate, `deploy-live.sh` and `stand-up-live.sh`
--                  all run) sets it with ALTER ROLE over the database's socket
--                  on every run, after it has asked Postgres that this role is
--                  still no superuser, may create no role or database, belongs
--                  to no role and has no role belonging to it, and refused to
--                  go on if it is or may. `set-task-env.sh` asks the same
--                  before every upload of its URL, the bring-up's or one run
--                  by hand. Until the password is set it cannot log in with
--                  any password at all.
--
-- It is a member of no role, and no role is a member of it. Both ways matter:
-- a member of the owner could `SET ROLE` to it and be a superuser again, and
-- a role that is a member of THIS one (`GRANT ownpace_system TO app_user`)
-- could `SET ROLE ownpace_system` and read every organisation's rows past row
-- security. The bring-up refuses either.
--
-- ## What it may do, and nothing more
--
-- A grant for each statement the jobs send, per table, and per column where
-- a job only picks rows by a column and never reads them. No default
-- privileges: a table added later is not the role's until a migration says
-- so, and the integration guard runs each job's own `run` as this role, so a
-- statement it lacks a grant for fails there. The guard also compares what
-- the role may ACTUALLY do with this list, a grant to PUBLIC included: with
-- BYPASSRLS, `GRANT SELECT ON <a tenant table> TO PUBLIC`, which reads as
-- harmless under row security for `app_user`, is every organisation's rows
-- for this role. On the database it has what PUBLIC has on every database,
-- CONNECT and TEMPORARY: it can make a temporary table, which lives and dies
-- with its own session, and no permanent one.
--
--   Read, and deleted by the purge: what the tick reads across organisations
--   (the mappings, their runs, statuses, cutovers, paths and scope, and each
--   organisation's status), what the purge's revocation reads (the
--   connections, and the mailboxes that join a mapping's own token to its
--   source), and what the purge reads to find who is due (`tenant_closure`).
--   Deleted, and read only by the column that picks the rows: every other
--   table the purge empties (`PURGED_TABLES`, `packages/managed/src/
--   offboarding.ts`), so the role reads nobody's mail ledger, audit trail,
--   decisions, members, budgets, VAT log, or the people being moved and
--   which migration is whose (`person`, `person_migration`, managed
--   migration 0031), or who accepted which texts (`legal_acceptance`,
--   managed migration 0032).
--   The rest, each for its one job: the hold and the beat (the tick); the
--   invoices' period and status (retention) and their detaching, with the
--   buyer's name (the purge); declined access requests by their decision
--   (retention); the erasure receipt (the purge); the audit key; and the
--   operator's log page, which every one of them writes and retention prunes.
--   Run rows are also written by the purge, landing one no runner holds.
--
-- A cascade the purge or retention sets off (a run's events, a verification's
-- run) runs as the table's owner, as Postgres runs every referential action,
-- and needs nothing here.
--
-- ## What it does not change
--
-- BYPASSRLS still reads past the policies on every table granted below, and
-- every run still receives this role's URL, because Trigger.dev stores
-- variables per environment and not per task. `scripts/a-pass-that-opened-
-- the-owners-pool.unit.test.ts` holds who reads it: the three jobs and
-- `task-pools.ts`, and nothing else. A run that had been taken over still
-- could. 0138 T3 step 3, parked until the service admits people the owner has
-- not let in, replaces this role with functions the owner owns.
--
-- Idempotent where it can be: roles are cluster-global, so a second database
-- on the same cluster (the integration harness, a second stack's) finds the
-- role and gives it its grants in that database too.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ownpace_system') THEN
    CREATE ROLE ownpace_system LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION BYPASSRLS;
  END IF;
END
$$;
-- Stated again whatever was there: a role of that name made by hand gets
-- exactly these attributes, and no password this repository holds.
ALTER ROLE ownpace_system LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION BYPASSRLS;

GRANT USAGE ON SCHEMA public TO ownpace_system;

-- Read, and deleted by the purge.
GRANT SELECT, DELETE ON TABLE
  public.tenant_closure,
  public.run_event,
  public.mailbox_mapping,
  public.mailbox,
  public.connection,
  public.migration_status,
  public.cutover_state,
  public.path_lifecycle,
  public.scope_selection
  TO ownpace_system;
-- The organisation's status: read by the list, the tick and the purge,
-- marked `deleting` by the purge, and deleted by it.
GRANT SELECT, DELETE ON TABLE public.tenant TO ownpace_system;
GRANT UPDATE (status) ON TABLE public.tenant TO ownpace_system;
-- Runs: counted by the tick, pruned by retention, a stale one landed by the purge.
GRANT SELECT, DELETE ON TABLE public.run TO ownpace_system;
GRANT UPDATE (status, finished_at, stats) ON TABLE public.run TO ownpace_system;

-- Deleted by the purge, and read only by the column that picks the rows.
GRANT SELECT (tenant_id), DELETE ON TABLE
  public.item,
  public.sync_checkpoint,
  public.cursor,
  public.collection_mapping,
  public.verification_run,
  public.verification,
  public.cutover_event,
  public.cutover,
  public.migration_discovery,
  public.decision,
  public.policy_preset,
  public.group_def,
  public.share_grant,
  public.apply_receipt,
  public.setup_step,
  public.backup_target,
  public.mapping_link,
  public.vat_consultation,
  public.occupancy_peak,
  public.bytes_moved,
  public.grant_link_allowance,
  public.payment_method,
  public.usage_metric,
  public.tenant_member,
  public.tenant_pricing,
  public.audit_log,
  public.rate_budget,
  public.byte_budget,
  public.support_read,
  public.person_migration,
  public.person,
  public.legal_acceptance
  TO ownpace_system;
-- The buyer's name, which the purge stamps on the invoices it keeps.
GRANT SELECT (tenant_id, name), DELETE ON TABLE public.billing_party TO ownpace_system;
-- Declined requests, by their decision (retention), and the one that made the
-- organisation (the purge). Never the person's name or address.
GRANT SELECT (id, tenant_id, state, decided_at), DELETE ON TABLE public.access_request TO ownpace_system;

-- Invoices: up to which period each organisation was billed, by status
-- (retention), and detached from an erased one with its buyer's name (the
-- purge). Never an amount, a payment or a line.
GRANT SELECT (id, tenant_id, period_end, status, billed_to_name) ON TABLE public.invoice TO ownpace_system;
GRANT UPDATE (tenant_id, billed_to_name) ON TABLE public.invoice TO ownpace_system;
-- The erasure receipt, written at close, completed by the purge.
GRANT SELECT (tenant_ref, purged_at) ON TABLE public.erasure_record TO ownpace_system;
GRANT UPDATE (purged_at, retained_invoice_ids, purged_counts, revocations) ON TABLE public.erasure_record TO ownpace_system;

-- The tick: whether an operator holds the platform, and its beat.
GRANT SELECT ON TABLE public.platform_pause TO ownpace_system;
GRANT SELECT, INSERT ON TABLE public.sync_tick_beat TO ownpace_system;
GRANT UPDATE (beat_at) ON TABLE public.sync_tick_beat TO ownpace_system;
-- The audit key (ledger migration 0062), made the first time it is asked for.
GRANT SELECT, INSERT ON TABLE public.deployment_key TO ownpace_system;
-- The operator's log page: written by every job, pruned by retention.
GRANT SELECT, INSERT, DELETE ON TABLE public.app_event TO ownpace_system;
