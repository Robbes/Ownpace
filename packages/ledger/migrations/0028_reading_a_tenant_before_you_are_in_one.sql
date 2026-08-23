-- The four `tenant` policies stop raising when there is no tenant (0099).
--
-- ## Why now, and why not in 0004
--
-- Managed migration 0004 fixed exactly this hazard on `tenant_member`'s four
-- policies and deliberately left the other 116 alone, on stated reasoning: a
-- policy is only dangerous here if some path REACHES it without a tenant scope,
-- and nothing did.
--
-- Something does now. Answering an invitation means reading the organisation
-- that issued it, and the person reading has — by construction — no membership
-- and therefore no tenant scope. `/api/me` runs with a subject and a verified
-- email and nothing else.
--
-- ## What goes wrong without this
--
-- `SET LOCAL` reverts to the SESSION value, and for a custom setting that was
-- never assigned that value is the empty string, not NULL. So on a pooled
-- connection `current_setting('app.current_tenant', true)` is `''`, and
-- `''::uuid` RAISES rather than returning no rows:
--
--     invalid input syntax for type uuid: ""
--
-- Permissive policies are OR'd, so it does not matter that a NEW policy would
-- have matched: an error inside any policy evaluated for the query is the
-- query's error. A reader with a legitimate invitation would get a 500 instead
-- of their organisation's name.
--
-- `NULLIF(…, '')` before the cast makes an unset-or-decayed setting NULL, and a
-- comparison with NULL is NULL — no rows, which is the honest answer to "which
-- tenant am I scoped to" when the answer is none. It changes nothing for a
-- request that HAS a tenant: NULLIF only affects the empty string, and a real
-- uuid is not one.
--
-- ## This is the shared chain on purpose
--
-- `tenant` is a shared table (ledger 0001), so the appliance has these policies
-- too. The appliance never reads a tenant without one — it is single-tenant —
-- but a fix that stops a policy raising belongs beside the policy, not in the
-- edition that happened to notice. Migration 0004's `tenant_member` fix lives in
-- the managed chain because THAT table is managed-only.
--
-- Non-destructive: policies are dropped and recreated because that is how a
-- policy definition is amended, and each recreation is the same rule with a
-- guarded cast. No grant, table or row is touched.

DROP POLICY IF EXISTS tenant_isolation_select ON public.tenant;
CREATE POLICY tenant_isolation_select ON public.tenant
  FOR SELECT USING (
    id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  );

DROP POLICY IF EXISTS tenant_isolation_insert ON public.tenant;
CREATE POLICY tenant_isolation_insert ON public.tenant
  FOR INSERT WITH CHECK (
    id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  );

DROP POLICY IF EXISTS tenant_isolation_update ON public.tenant;
CREATE POLICY tenant_isolation_update ON public.tenant
  FOR UPDATE
  USING (
    id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  )
  WITH CHECK (
    id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  );

DROP POLICY IF EXISTS tenant_isolation_delete ON public.tenant;
CREATE POLICY tenant_isolation_delete ON public.tenant
  FOR DELETE USING (
    id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  );
