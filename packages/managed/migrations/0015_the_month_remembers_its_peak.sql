-- The month remembers its peak (workplan 0109 T2).
--
-- ADR-0014 bills the month's PEAK path occupancy and wants the invoice to say
-- it in words — "Medium — 6 paths at the same time on 12 August". A peak
-- cannot be recovered after the fact from current state: by invoice time the
-- six paths are three, and no table says they were ever six. So it is written
-- as it happens: one high-water row per tenant per calendar month, raised —
-- never lowered — each time a path takes a slot.
--
-- ## Why this is a MANAGED table
--
-- `path_lifecycle` (ledger 0035) is the PRODUCT's: an appliance owner cuts
-- over mail while calendar keeps running, edition-identically (hard rule 5).
-- The month's peak exists only to price a tier, and an appliance is never
-- invoiced (ADR-0036) — so the peak lives in the managed chain, which no
-- appliance database ever runs. The leakage guard's table list derives from
-- this chain's own SQL, so this table is appliance-forbidden the moment this
-- file exists, without anybody editing a list (the guard's own lesson).
--
-- ## Raise-only, enforced in the schema
--
-- The writer's upsert only raises (its WHERE compares), but a peak that can
-- fall is not a peak whatever the writer intends — so a BEFORE UPDATE trigger
-- refuses a lowering for EVERY role, the same defence-in-depth migration 0014
-- installed on `invoice`. Identity (tenant, month) is frozen by the same
-- trigger: moving a peak to another month is not a correction of anything.
--
-- ## The tie keeps its first date
--
-- `peak_at` is evidence ("on 12 August"). When the same occupancy recurs
-- later in the month, the writer's strict `<` leaves the row alone, so the
-- date stays the moment the high-water was SET — re-reaching a level is not
-- setting it.
--
-- ## What this deliberately under-records
--
-- Two concurrent activations can each count slots before the other commits,
-- so a simultaneous burst can record the lower number. And a month in which
-- no path activates writes no row at all, even while paths run all month —
-- absence is not "zero paths ran", it is "nothing raised the mark". Both are
-- in the direction that cannot over-bill; the tier calculator (T4) trues up
-- the current month from live occupancy before reading, which closes the
-- second gap at the moment it matters.

CREATE TABLE IF NOT EXISTS public.occupancy_peak (
    tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    -- First day of the calendar month, UTC — a real date, so range queries
    -- and "which month is this invoice for" need no parsing.
    month date NOT NULL,
    peak_paths integer NOT NULL,
    -- When the high-water was set: the "on 12 August" the invoice quotes.
    peak_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT occupancy_peak_pkey PRIMARY KEY (tenant_id, month),
    -- A recorded peak of zero is a contradiction: the writer records when a
    -- path ACTIVATES, so there was at least one.
    CONSTRAINT occupancy_peak_paths_check CHECK ((peak_paths > 0)),
    -- The month column means "a month", not "a moment": anything but the
    -- first of a month is a writer bug.
    CONSTRAINT occupancy_peak_month_check
        CHECK ((month = date_trunc('month'::text, (month)::timestamp with time zone)::date))
);

ALTER TABLE public.occupancy_peak ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.occupancy_peak FORCE ROW LEVEL SECURITY;

-- The four tenant_isolation policies, exactly as every other tenant table has
-- them (managed 0001's pattern). DROP IF EXISTS first, so this file is the
-- authority on the definition rather than whatever wrote it.
DROP POLICY IF EXISTS tenant_isolation_select ON public.occupancy_peak;
CREATE POLICY tenant_isolation_select ON public.occupancy_peak FOR SELECT
    USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
DROP POLICY IF EXISTS tenant_isolation_insert ON public.occupancy_peak;
CREATE POLICY tenant_isolation_insert ON public.occupancy_peak FOR INSERT
    WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
DROP POLICY IF EXISTS tenant_isolation_update ON public.occupancy_peak;
CREATE POLICY tenant_isolation_update ON public.occupancy_peak FOR UPDATE
    USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid))
    WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
DROP POLICY IF EXISTS tenant_isolation_delete ON public.occupancy_peak;
CREATE POLICY tenant_isolation_delete ON public.occupancy_peak FOR DELETE
    USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

-- A peak only ever falls when the erasure purge removes the tenant wholesale,
-- and the purge runs on the owner connection — so `app_user` has no DELETE.
-- Spelled out rather than left to the baseline's ALTER DEFAULT PRIVILEGES
-- (managed 0002's doctrine); default privileges already granted all four, so
-- the narrowing has to be a REVOKE.
GRANT SELECT,INSERT,UPDATE ON TABLE public.occupancy_peak TO app_user;
REVOKE DELETE ON TABLE public.occupancy_peak FROM app_user;

-- The refusal, for every role (migration 0014's defence-in-depth): a peak
-- never falls, and a row never changes which month or whose it is.
CREATE OR REPLACE FUNCTION public.occupancy_peak_only_rises()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.month IS DISTINCT FROM OLD.month THEN
        RAISE EXCEPTION 'occupancy_peak %/%: the identity of a peak row is frozen — record the other month''s peak in its own row',
            OLD.tenant_id, OLD.month
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.peak_paths < OLD.peak_paths THEN
        RAISE EXCEPTION 'occupancy_peak %/%: a peak never falls (% -> %) — a high-water mark that can be lowered proves nothing at invoice time',
            OLD.tenant_id, OLD.month, OLD.peak_paths, NEW.peak_paths
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_occupancy_peak_only_rises ON public.occupancy_peak;
CREATE TRIGGER trg_occupancy_peak_only_rises
    BEFORE UPDATE ON public.occupancy_peak
    FOR EACH ROW
    EXECUTE FUNCTION public.occupancy_peak_only_rises();

COMMENT ON TABLE public.occupancy_peak IS
  'Per-tenant, per-calendar-month high-water mark of slot-holding paths (workplan 0109 T2; ADR-0014''s path axis). Raised in the same transaction as a path activation; a BEFORE UPDATE trigger refuses any lowering, for every role. Absence means nothing raised the mark that month — the tier calculator trues up the current month from live occupancy before reading.';

COMMENT ON COLUMN public.occupancy_peak.peak_at IS
  'When the high-water was SET — the "6 paths at the same time on 12 August" the invoice quotes. A tie later in the month keeps the first date: re-reaching a level is not setting it.';
