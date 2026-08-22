-- "No tenant set" must mean NO ROWS, not a 500 (ADR-0042, workplan 0093 T5c).
--
-- ## The bug this fixes, found by CI on its first real request
--
-- Migration 0003 made `tenant_member` the one table that can be read WITHOUT a
-- tenant: `withSubject` sets `app.current_user`, `own_membership_select` matches
-- on it, and the four tenant-scoped policies were expected to simply not match.
--
-- They do not simply not match. They THROW:
--
--     invalid input syntax for type uuid: ""
--
-- Permissive policies are OR'd, and Postgres evaluates all of them — so the
-- tenant policies run on a subject-scoped read too. Their expression is
-- `current_setting('app.current_tenant', true)::uuid`, and after any earlier
-- transaction on that connection has `SET LOCAL` the setting, it does not revert
-- to unset: it reverts to the empty string. `''::uuid` is an error, and an error
-- inside a policy is a failed query, which is a 500.
--
-- ## Why nothing caught it
--
-- `own-membership-under-rls.unit.test.ts` runs on a PGlite connection that has
-- never held a tenant, where `current_setting(…, true)` really is NULL and
-- `NULL::uuid` is NULL. The decay needs a connection that served a tenant-scoped
-- request FIRST — which is what every real request does and no unit test did.
-- `GET /api/me` therefore returned 500 for five of its seven integration cases,
-- and would have done so in production for any caller whose pooled connection
-- had been used before. `guc-decay-under-rls.unit.test.ts` now reproduces the
-- decay explicitly and fails without this migration.
--
-- ## The fix
--
-- `NULLIF(…, '')` before the cast, so an unset-or-decayed setting is NULL and
-- `tenant_id = NULL` is NULL — not true, and not an error. This is the same
-- outcome the policies were always documented to have; it is the cast that was
-- wrong, not the intent. `set_config('app.current_tenant', NULL, true)` was the
-- other candidate and does NOT work: it leaves the setting as `''` too.
--
-- ## Scope, deliberately
--
-- ONLY `tenant_member`. The other 116 tenant policies key on tables that are
-- only ever reached through `withTenant`, which always sets a real uuid, so the
-- empty string cannot reach their cast. Rewriting them all would be 116
-- hand-edited security predicates to fix a condition that cannot arise — the
-- kind of churn where one typo silently opens a table. The rule to hold instead
-- is stated and asserted: a table reachable under `withSubject` must have
-- NULL-safe tenant policies, and `tenant_member` is the only such table today.
--
-- Behaviour is otherwise unchanged: same tables, same commands, same subjects.
-- A request that HAS a tenant set sees exactly what it saw before, because
-- NULLIF only affects the empty string.

DROP POLICY IF EXISTS tenant_isolation_select ON public.tenant_member;
CREATE POLICY tenant_isolation_select ON public.tenant_member
  FOR SELECT USING (
    tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  );

DROP POLICY IF EXISTS tenant_isolation_insert ON public.tenant_member;
CREATE POLICY tenant_isolation_insert ON public.tenant_member
  FOR INSERT WITH CHECK (
    tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  );

DROP POLICY IF EXISTS tenant_isolation_update ON public.tenant_member;
CREATE POLICY tenant_isolation_update ON public.tenant_member
  FOR UPDATE USING (
    tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  ) WITH CHECK (
    tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  );

DROP POLICY IF EXISTS tenant_isolation_delete ON public.tenant_member;
CREATE POLICY tenant_isolation_delete ON public.tenant_member
  FOR DELETE USING (
    tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  );
