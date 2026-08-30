-- The meter counts the first copy (workplan 0109 T3).
--
-- ADR-0014's data axis is CUMULATIVE and counts each item's FIRST successful
-- copy: the cost it stands for — transit and the compute that moves bytes —
-- is spent once, on the initial copy. Re-copies, retries, updates and delta
-- passes never count, tombstones never subtract, and the number only rises,
-- which is what lets it set the FLOOR the ADR promises the pricing page will
-- announce ("finishing paths lowers your bill; the size of what you moved
-- sets a floor").
--
-- ## Where the number comes from
--
-- The engine reports `firstCopyBytes` on every pass result — a neutral
-- statistic computed at the exact moment of a target CREATE (adopted items
-- moved no bytes; rewrites re-copied bytes already counted; the ledger makes
-- re-runs converge, so a retried pass re-creates nothing). The MANAGED worker
-- adds that number here after each pass; the appliance ignores it, which is
-- the whole edition split (hard rule 5) in one sentence.
--
-- ## Never the same query as 0090's byte budget
--
-- Unchanged rule (ledger migration 0030 says it in as many words). The budget
-- protects the SOURCE account today — per (tenant, provider), resets daily,
-- wiped at erasure. This meter prices what has EVER moved — per tenant,
-- cumulative, purged only with the tenant. They share no table, no query and
-- no semantics.
--
-- ## What this deliberately under-counts
--
-- A worker that dies between a pass finishing and this row being raised loses
-- that pass's bytes, and the retried pass re-copies nothing, so they never
-- arrive later; an item whose source offered no size contributes 0; history
-- from before this migration is not back-filled. All three err in the
-- direction that cannot over-bill.

CREATE TABLE IF NOT EXISTS public.bytes_moved (
    tenant_id uuid NOT NULL PRIMARY KEY REFERENCES public.tenant(id) ON DELETE CASCADE,
    -- Lifetime first-copy bytes. bigint: a family's 400 GB photo library is
    -- ~4.3e11, and bigint holds nine more orders of magnitude past that.
    bytes bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    -- A negative total is a contradiction whichever code path wrote it.
    CONSTRAINT bytes_moved_bytes_check CHECK ((bytes >= 0))
);

ALTER TABLE public.bytes_moved ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.bytes_moved FORCE ROW LEVEL SECURITY;

-- The four tenant_isolation policies, exactly as every other tenant table has
-- them (managed 0001's pattern). DROP IF EXISTS first, so this file is the
-- authority on the definition rather than whatever wrote it.
DROP POLICY IF EXISTS tenant_isolation_select ON public.bytes_moved;
CREATE POLICY tenant_isolation_select ON public.bytes_moved FOR SELECT
    USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
DROP POLICY IF EXISTS tenant_isolation_insert ON public.bytes_moved;
CREATE POLICY tenant_isolation_insert ON public.bytes_moved FOR INSERT
    WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
DROP POLICY IF EXISTS tenant_isolation_update ON public.bytes_moved;
CREATE POLICY tenant_isolation_update ON public.bytes_moved FOR UPDATE
    USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid))
    WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
DROP POLICY IF EXISTS tenant_isolation_delete ON public.bytes_moved;
CREATE POLICY tenant_isolation_delete ON public.bytes_moved FOR DELETE
    USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

-- The meter falls only when the erasure purge removes the tenant wholesale,
-- and the purge runs on the owner connection — so `app_user` has no DELETE.
-- Spelled out rather than left to the baseline's ALTER DEFAULT PRIVILEGES
-- (managed 0002's doctrine); default privileges already granted all four, so
-- the narrowing has to be a REVOKE.
GRANT SELECT,INSERT,UPDATE ON TABLE public.bytes_moved TO app_user;
REVOKE DELETE ON TABLE public.bytes_moved FROM app_user;

-- The refusal, for every role (migration 0014's defence-in-depth, 0015's
-- twin): the data axis never falls, and a row never changes whose it is.
CREATE OR REPLACE FUNCTION public.bytes_moved_only_rises()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'bytes_moved %: the identity of a meter row is frozen',
            OLD.tenant_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.bytes < OLD.bytes THEN
        RAISE EXCEPTION 'bytes_moved %: the data axis never falls (% -> %) — tombstones do not subtract, and a meter that can be lowered prices nothing (ADR-0014)',
            OLD.tenant_id, OLD.bytes, NEW.bytes
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bytes_moved_only_rises ON public.bytes_moved;
CREATE TRIGGER trg_bytes_moved_only_rises
    BEFORE UPDATE ON public.bytes_moved
    FOR EACH ROW
    EXECUTE FUNCTION public.bytes_moved_only_rises();

COMMENT ON TABLE public.bytes_moved IS
  'Cumulative first-copy bytes per tenant (workplan 0109 T3; ADR-0014''s data axis). Raised by the managed worker from each pass''s firstCopyBytes; a BEFORE UPDATE trigger refuses any lowering, for every role. Never joined to 0090''s byte_budget — different meter, different question. Absence means nothing has moved.';
