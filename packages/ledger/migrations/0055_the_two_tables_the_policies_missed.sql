-- THE TWO TABLES THE POLICIES MISSED: row-level security for the cutover
-- ledger (workplan 0009 T11, owner 2026-09-20).
--
-- Every tenant table in this schema carries the four tenant policies and is
-- FORCEd — `0001_baseline.sql` for the first 22, `0002` for the two it
-- missed, and each migration since for the table it created (`0003`, `0004`,
-- `0035`). Two never did: `cutover_state` and `cutover_event`, the cutover's
-- own ledger. They have a `tenant_id`, they have grants to `app_user`, and
-- they have no policy at all: not ENABLEd, not FORCEd. Found on 2026-09-20
-- while the API's cutover door started reading `cutover_state` through the
-- tenant-scoped database (PR #1026) — the read was correct because the
-- query filters by tenant, and the discipline the rest of the schema has was
-- simply absent underneath it.
--
-- Why it was invisible: nothing served these tables as `app_user` until that
-- door. The cutover job, the rollback job and the operator CLI all read them
-- through DATABASE_URL — the owner, a superuser on the bundled deployments,
-- whom row security never binds — and the guard that closes the class
-- (`force-rls.unit.test.ts`) asked "which RLS tables are not FORCEd", a
-- question a table with no RLS does not appear in. It now also asks "which
-- tables with a tenant_id have no RLS", and this migration is what makes
-- that list empty — save for the two that answer it on purpose, `rate_budget`
-- (0024) and `byte_budget` (0030), whose migrations say "NO ROW-LEVEL
-- SECURITY, deliberately" and why; the guard reads that sentence as the
-- exemption. (0024 also called itself "the only table in the schema without
-- it", which these two cutover tables had quietly made untrue.)
--
-- What changes for the callers: as everywhere else, a session that is not a
-- superuser sees these rows only with `app.current_tenant` set — the guide's
-- fail-closed rule (`docs/rls-guide.md`). The cutover job, the rollback job
-- and the CLI now go through `tenantCutoverStore`, which runs every call
-- inside `withTenant`, so on hard rule 5's deployment shape — an operator
-- pointing DATABASE_URL at their own Postgres with an ordinary owner — the
-- cutover ledger keeps answering. The API door already reads through
-- `withTenantDb`.
--
-- The NULL-safe policy form migration 0004 established, because a bare cast
-- of an empty GUC RAISES and a permissive policy that raises takes the whole
-- query with it. `ONLY` on FORCE, as the baseline writes it; neither table
-- has partitions or inheritance children. The grants already exist (baseline).

ALTER TABLE public.cutover_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.cutover_state FORCE ROW LEVEL SECURITY;

CREATE POLICY cutover_state_tenant_select ON public.cutover_state
  FOR SELECT USING (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);
CREATE POLICY cutover_state_tenant_insert ON public.cutover_state
  FOR INSERT WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);
CREATE POLICY cutover_state_tenant_update ON public.cutover_state
  FOR UPDATE USING (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);
CREATE POLICY cutover_state_tenant_delete ON public.cutover_state
  FOR DELETE USING (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);

ALTER TABLE public.cutover_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.cutover_event FORCE ROW LEVEL SECURITY;

CREATE POLICY cutover_event_tenant_select ON public.cutover_event
  FOR SELECT USING (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);
CREATE POLICY cutover_event_tenant_insert ON public.cutover_event
  FOR INSERT WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);
CREATE POLICY cutover_event_tenant_update ON public.cutover_event
  FOR UPDATE USING (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);
CREATE POLICY cutover_event_tenant_delete ON public.cutover_event
  FOR DELETE USING (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);
