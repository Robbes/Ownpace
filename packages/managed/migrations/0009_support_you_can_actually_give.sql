-- The operator's read model, and the log that has to earn it
-- (workplan 0110 T1 + T2; the owner chose standing access on 2026-08-27).
--
-- ## What the owner decided, and what it cost
--
-- Support access is ON by default and disclosed. The first draft had a
-- `tenant_support_access` consent row and a second `EXISTS` in every predicate
-- below; the owner's reason for dropping it is good — *"people expect me to be
-- able to see what they see in case I'm contacted"* — and a first support
-- conversation that opens with "please turn this on" spends trust at the
-- moment there is least of it.
--
-- But consent was doing work, and this migration is where its absence is felt:
-- **the only thing between an Ownpace login and every customer's migration
-- metadata is one row in `platform_operator`.** So the accountability moves to
-- the other end. Not *"did they allow it"* but ***"what was actually looked
-- at, by whom, when"*** — which is a weaker promise in one way and a stronger
-- one in another, because a consent row says an operator MIGHT have looked and
-- `support_read` says whether they DID.
--
-- ## These views bypass RLS. That is the point, and the danger.
--
-- Measured rather than assumed (the probe is now a test in
-- `support-views.unit.test.ts`): as `app_user` with no tenant GUC, a DIRECT
-- read of `tenant` returns zero rows, and a read through a view created here
-- returns them all. A view executes with its OWNER's privileges, the owner is
-- the migrating superuser, and a superuser is exempt from row security — so
-- `FORCE ROW LEVEL SECURITY` on the underlying tables does not reach through a
-- view the way it reaches a direct read.
--
-- **There is therefore no second net.** Everything rests on the `EXISTS`
-- predicate below being present and correct in every view. If one view is
-- added later without it, every tenant's rows are readable by any `app_user`
-- session — no error, no log line, nothing red. The tests assert the failure
-- direction (a non-operator sees zero) for every view by name, and a further
-- test fails when a view is added to this schema without the predicate, so a
-- seventh view cannot arrive quietly.
--
-- This is the "privileged pool" 0093 T6 deliberately avoided, wearing a
-- different hat. What makes it survivable rather than the same mistake is that
-- it is NARROW where a privileged connection would have been general: named
-- columns, one predicate, `GRANT SELECT` and nothing else, no ad-hoc SQL, and
-- a recorded read.
--
-- ## The column list IS the privacy boundary
--
-- The owner's other decision — metadata only — is enforced here rather than
-- remembered by a route. A view that does not select `last_error` cannot
-- return it, whatever a route asks for. `last_error` is free provider prose
-- that routinely carries a mailbox address; `last_error_category` (migration
-- 0033, six values) is the safe twin, which is why that column exists and why
-- 0110 T3 was built first.
--
-- Never selected anywhere below, and each for a reason: `secret_ref` and
-- `encrypted_credentials` (credentials), `config` and `settings` (may carry
-- hosts, paths and addresses a customer typed), `last_error` (prose),
-- `primary_address` and anything from `item` or `collection_mapping` (the
-- things being migrated). Widening any of these means editing this file, in a
-- diff somebody reads.
--
-- ## Managed chain, and it could not be otherwise
--
-- `platform_operator` exists only here. A policy on a LEDGER table referencing
-- it would fail at migration time on every appliance, which never runs this
-- chain (hard rule 5, ADR-0036). Views declared here read ledger tables
-- without the ledger chain knowing anything about operators — which is exactly
-- why views rather than policies.

-- ---------------------------------------------------------------------------
-- What was looked at, by whom, when
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.support_read (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    -- The operator's OIDC subject, the same identifier `platform_operator`
    -- keys on. Not their email: the subject is the identity.
    operator_user_id text NOT NULL,
    -- Whose data was read. NULL for the tenant LIST, which is a read of
    -- everybody and belongs in the log as exactly that rather than as N rows.
    tenant_id uuid,
    -- Which screen. A closed vocabulary so the log can be counted rather than
    -- grepped; the CHECK is deliberate here (unlike the failure categories,
    -- which are product vocabulary) because these three are the whole surface
    -- and a fourth is a design change, not a copy edit.
    view_name text NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_read_pkey PRIMARY KEY (id),
    CONSTRAINT support_read_view_name_check
      CHECK (view_name = ANY (ARRAY['tenants'::text, 'tenant'::text, 'migration'::text]))
);

CREATE INDEX IF NOT EXISTS ix_support_read_tenant_at ON public.support_read (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS ix_support_read_operator_at ON public.support_read (operator_user_id, at DESC);

COMMENT ON TABLE public.support_read IS
  'One row per operator view served (workplan 0110 T1). With support access '
  'standing rather than consented, this log IS the accountability: a consent '
  'row would have said an operator MIGHT have looked, and this says whether '
  'they did. Append-only by grant — no UPDATE, no DELETE for app_user.';

ALTER TABLE public.support_read ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.support_read FORCE ROW LEVEL SECURITY;

-- An operator may read their OWN reads, and append. They may not read anybody
-- else's — a log somebody can survey is a log that tells them what their
-- colleagues are investigating, which is not what it is for.
CREATE POLICY operator_reads_own_log ON public.support_read
  FOR SELECT USING (operator_user_id = current_setting('app.current_user'::text, true));

-- INSERT is not narrowed to the caller's own subject on purpose: the check
-- belongs where the row is written (one helper, one call site), and a policy
-- that re-derived it would be a second place to get it right. What matters
-- here is that nothing can UPDATE or DELETE.
CREATE POLICY operator_appends_log ON public.support_read
  FOR INSERT WITH CHECK (true);

GRANT SELECT, INSERT ON TABLE public.support_read TO app_user;
REVOKE UPDATE, DELETE ON TABLE public.support_read FROM app_user;

-- ---------------------------------------------------------------------------
-- The three views. Every one carries the same predicate, spelled out.
-- ---------------------------------------------------------------------------
--
-- Written out in each view rather than factored into a function, deliberately.
-- A helper would be one place to get right AND one place to forget to call:
-- a view without the predicate is silently total access, so the predicate is
-- visible in every view a reviewer reads, and `support-views.unit.test.ts`
-- fails on any view in this schema that lacks it.

-- Level 1: every organisation. Name, when they joined, how many migrations,
-- and whether anything is failing. No settings, no addresses, no counts of
-- what is inside anybody's mailbox.
CREATE OR REPLACE VIEW public.support_tenants AS
  SELECT
    t.id            AS tenant_id,
    t.name          AS tenant_name,
    t.status        AS tenant_status,
    t.created_at    AS joined_at,
    (SELECT count(*) FROM public.mailbox_mapping m WHERE m.tenant_id = t.id)
                    AS migration_count,
    (SELECT count(*) FROM public.migration_status s
      WHERE s.tenant_id = t.id AND s.state = 'failed')
                    AS failing_domain_count
  FROM public.tenant t
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

-- Level 2: one organisation's connections and migrations. `kind`, the display
-- name the owner chose, and status — never `config` (hosts and paths somebody
-- typed) and never `secret_ref`.
CREATE OR REPLACE VIEW public.support_tenant_connections AS
  SELECT
    c.tenant_id,
    c.id            AS connection_id,
    c.role,
    c.kind,
    c.display_name,
    c.status,
    c.created_at,
    c.updated_at
  FROM public.connection c
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

CREATE OR REPLACE VIEW public.support_tenant_migrations AS
  SELECT
    m.tenant_id,
    m.id            AS mapping_id,
    m.name,
    m.status        AS lifecycle,
    m.mode,
    m.pattern,
    m.schedule,
    m.created_at,
    m.updated_at
  FROM public.mailbox_mapping m
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

CREATE OR REPLACE VIEW public.support_tenant_invoices AS
  SELECT
    i.tenant_id,
    i.id            AS invoice_id,
    i.period_start,
    i.period_end,
    i.status,
    i.total,
    i.currency,
    i.paid_at
  FROM public.invoice i
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

-- Level 3: one migration, per domain. Counts, timings, and the failure
-- CATEGORY — never `last_error` itself, which is the whole reason 0110 T3
-- exists. `last_pass_metrics` is included because its own schema comment
-- already binds it: "Counts and durations only — never folder names or
-- addresses."
CREATE OR REPLACE VIEW public.support_migration_domains AS
  SELECT
    s.tenant_id,
    s.mapping_id,
    s.domain,
    s.state,
    s.started_at,
    s.updated_at,
    s.completed_at,
    s.last_error_category,
    s.last_pass_metrics
  FROM public.migration_status s
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

GRANT SELECT ON public.support_tenants TO app_user;
GRANT SELECT ON public.support_tenant_connections TO app_user;
GRANT SELECT ON public.support_tenant_migrations TO app_user;
GRANT SELECT ON public.support_tenant_invoices TO app_user;
GRANT SELECT ON public.support_migration_domains TO app_user;
