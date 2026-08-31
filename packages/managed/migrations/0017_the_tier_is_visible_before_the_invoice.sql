-- The tier is visible before the invoice (workplan 0109 T4's follow-up:
-- the support screen surfaces what the calculator derives).
--
-- 0109 built the measurement layer bottom-up: the peak that only rises (T2),
-- the meter that only counts the first copy (T3), and the calculator that
-- turns both into a tier with evidence (T4). Until T5 sends an invoice,
-- nothing SHOWS any of it — so the first time a number is wrong, the person
-- finding out is a customer reading a bill. This view is the earlier pair of
-- eyes: the operator's tenant screen renders the same evidence the invoice
-- will quote, months before the first invoice exists.
--
-- ## Why a view, and why the operator predicate
--
-- `occupancy_peak`, `bytes_moved` and `path_lifecycle` all carry tenant RLS,
-- and an operator has no tenant — a direct read returns zero rows (proved in
-- `support-views.unit.test.ts`). Migration 0009's doctrine applies unchanged:
-- a view executes with its owner's privileges, so it crosses row security,
-- and the ONE thing standing between any signed-in caller and every
-- customer's numbers is the `EXISTS (… platform_operator …)` predicate below.
-- The catalog test fails on any `support_` view that lacks it.
--
-- ## Reads only — the true-up is not this view's to run
--
-- The tier calculator (T4) trues up the month's peak from live occupancy
-- before deriving, because it reads at a moment that prices something. An
-- operator LOOKING must not move a billing mark: this view therefore serves
-- the recorded peak AND the live per-state counts side by side, and the route
-- derives from the higher of them in code — the same answer `currentTier`
-- would give, with nothing written. Which states hold a slot is `holdsASlot`'s
-- call (one authority, in `@openmig/ledger`); this view deliberately does NOT
-- restate that list in SQL, it serves the raw counts per state and lets the
-- code decide. A copy of the slot rule here is exactly the drift the ledger's
-- own SLOT_HOLDING_STATES comment records being bitten by.
--
-- ## The column list is the boundary, as everywhere on this surface
--
-- Counts, one meter total, and two timestamps. No mapping ids, no domains, no
-- names of anything: which PATHS are running is level 2/3's business through
-- the views that already exist; this one answers only "what would this month
-- cost, and on what evidence".

CREATE OR REPLACE VIEW public.support_tenant_usage AS
  SELECT
    t.id            AS tenant_id,
    -- This month's recorded high-water mark, or NULL when nothing raised it —
    -- absence means "no activation recorded", never "nothing ran", which is
    -- why the live counts sit beside it.
    p.peak_paths,
    p.peak_at,
    -- The lifetime first-copy meter, or NULL when nothing has ever moved.
    b.bytes         AS bytes_moved,
    -- Every path row, counted per state — `{"active": 2, "paused": 1}`. The
    -- closed CHECK vocabulary of `path_lifecycle.state` is all a key can be,
    -- and a count is all a value can be.
    (SELECT COALESCE(jsonb_object_agg(pl.state, pl.n), '{}'::jsonb)
       FROM (SELECT state, count(*) AS n
               FROM public.path_lifecycle
              WHERE tenant_id = t.id
              GROUP BY state) pl) AS paths_by_state
  FROM public.tenant t
  LEFT JOIN public.occupancy_peak p
    ON p.tenant_id = t.id
   AND p.month = date_trunc('month', now())::date
  LEFT JOIN public.bytes_moved b
    ON b.tenant_id = t.id
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

GRANT SELECT ON public.support_tenant_usage TO app_user;

COMMENT ON VIEW public.support_tenant_usage IS
  'The tier evidence, per tenant, for the operator''s screen (0109 T4 surfaced): this month''s recorded peak, the lifetime first-copy meter, and live path counts per state. Reads only — the true-up that prices a month belongs to the tier calculator, not to somebody looking. Guarded by the same platform_operator predicate as every support view.';
