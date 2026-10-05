-- A TIER A PERSON PICKS (workplan 0157 T6; ADR-0014, Amendment 2026-10-04,
-- evening: "A person may pick a tier higher than their use needs, for its pace
-- or its room. The month bills the higher of the picked tier and the derived
-- one, and the automatic downgrade stops at the picked tier. Picking is the
-- person's own yes").
--
-- ## A pick is a row, one per pick
--
-- Append-only, as a yes is (managed 0037): a pick that could be edited
-- afterwards agrees to nothing. A raise counts at once and a lower pick from
-- the next month (0157 §6), and one rule says both: a month bills at least the
-- pick standing when it began, and every pick made during it
-- (`pickedFloorOf`, packages/managed/src/tier-pick.ts). So a lower pick is a
-- row like any other, and Free is the pick of no floor. Months are UTC, as the
-- peak's are (managed 0015).
--
-- ## A pick above the agreed tier is a yes as well
--
-- The request path records it in `data_allowance` too, in the same
-- transaction, with `axis` 'pick' (below). The agreed tier is the highest said
-- yes to, on both axes (managed 0039), so a pick of Large brings Large's room
-- with it. A lower pick takes no yes back: what was agreed stays agreed, and a
-- month still bills what it used, never above it.
--
-- ## Who reads and writes it
--
-- The Billing page, in the organisation's own scope (`app_user`): it reads the
-- picks and appends one. The tick reads the tier each organisation's month
-- bills as the system role (managed 0041), so it reads which tier was picked
-- and when, never who picked it or the price. The purge of a closed
-- organisation deletes the rows by `tenant_id` (`PURGED_TABLES`).

CREATE TABLE IF NOT EXISTS public.tier_pick (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    -- Free is the pick of no floor: what was used decides again.
    tier_id text NOT NULL,
    -- The monthly price the person was shown, in whole euros, as a yes stores
    -- it (`data_allowance.price_eur`): nothing for Free.
    price_eur integer NOT NULL,
    -- Who picked: the signed-in member's id, as the audit log names them.
    picked_by text NOT NULL,
    picked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tier_pick_tier_check CHECK (tier_id IN ('free', 'small', 'medium', 'large', 'xl')),
    CONSTRAINT tier_pick_price_check CHECK (price_eur >= 0)
);

-- The floor reads an organisation's picks in the order they were made.
CREATE INDEX IF NOT EXISTS tier_pick_tenant_idx ON public.tier_pick (tenant_id, picked_at);

ALTER TABLE public.tier_pick ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.tier_pick FORCE ROW LEVEL SECURITY;

-- NULL-safe, as 0004 made the policies: an unset tenant reads as no rows.
DROP POLICY IF EXISTS tenant_isolation_select ON public.tier_pick;
CREATE POLICY tenant_isolation_select ON public.tier_pick FOR SELECT
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
DROP POLICY IF EXISTS tenant_isolation_insert ON public.tier_pick;
CREATE POLICY tenant_isolation_insert ON public.tier_pick FOR INSERT
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

-- The request path appends and reads. The baseline grants UPDATE and DELETE
-- by default, so they are taken back, as 0037 takes them back from a yes.
GRANT SELECT, INSERT ON TABLE public.tier_pick TO app_user;
REVOKE UPDATE, DELETE ON TABLE public.tier_pick FROM app_user;

-- The tick: which tier, and when. The purge: the rows, by the column it picks
-- them with. Never who picked, or the price.
GRANT SELECT (tenant_id, tier_id, picked_at), DELETE ON TABLE public.tier_pick TO ownpace_system;

COMMENT ON TABLE public.tier_pick IS
  'Each tier a person picked (workplan 0157 T6, ADR-0014 2026-10-04, evening): a month bills at least the pick standing when it began and every pick made during it, so a raise counts at once and a lower pick from the next month. Free is no floor. Append-only.';

-- A yes may come with a pick: which limit asked, or the person.
ALTER TABLE public.data_allowance DROP CONSTRAINT IF EXISTS data_allowance_axis_check;
ALTER TABLE public.data_allowance
    ADD CONSTRAINT data_allowance_axis_check CHECK (axis IN ('data', 'paths', 'pick'));

COMMENT ON COLUMN public.data_allowance.axis IS
  'Which limit asked for this yes: data (the data ceiling) or paths (a start past the agreed tier''s migrations at the same time); or pick, a tier the person picked above the agreed one (0044). Before 0039, every row was data.';
