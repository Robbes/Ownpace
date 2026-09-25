-- THE USAGE VIEW COUNTS WHAT THE TIER COUNTS (workplan 0128 T4, T5 slice 3a;
-- the owner's D2 (c), 2026-09-24).
--
-- `support_tenant_usage` (0017, 0024) serves the live path counts per state,
-- and the operator's screen decides which hold a slot with `holdsASlot`, in
-- code, so the view never restates the rule. Two things now decide a slot
-- that a state alone does not say:
--
--   * **Only the data types a migration carries are paths.** `slotsHeld`, the
--     number the tier is read off, counts included paths only. A row left
--     behind for a data type the migration no longer carries is not a path,
--     and the view counted it.
--   * **A stop in the continuous lane releases its slot** (D2 (c)). A stopped
--     data type keeps its phase, so a state alone cannot say it.
--
-- So the view counts included paths only, and a stopped path under its state
-- with ` (stopped)` after it: `{"active": 2, "continuous (stopped)": 1}`. The
-- rule stays in code: the screen reads the state and the stop from the key
-- and asks `holdsASlot` for both. A build that does not know the key counts it
-- as holding nothing, the direction that cannot overstate a bill. The screen
-- renders the keys raw, as every lifecycle word on these screens.
--
-- Everything else is 0024's view, unchanged.

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
    -- Every path the migrations carry, counted per state, and per stop —
    -- `{"active": 2, "continuous (stopped)": 1}`. The closed CHECK vocabulary
    -- of `path_lifecycle.state`, with or without ` (stopped)`, is all a key
    -- can be, and a count is all a value can be.
    (SELECT COALESCE(jsonb_object_agg(pl.key, pl.n), '{}'::jsonb)
       FROM (SELECT pa.state || CASE WHEN pa.stopped_at IS NULL THEN '' ELSE ' (stopped)' END AS key,
                    count(*) AS n
               FROM public.path_lifecycle pa
               JOIN public.scope_selection s
                 ON s.mapping_id = pa.mapping_id AND s.domain = pa.domain AND s.included
              WHERE pa.tenant_id = t.id
              GROUP BY 1) pl) AS paths_by_state
  FROM public.tenant t
  LEFT JOIN public.occupancy_peak p
    ON p.tenant_id = t.id
    -- UTC, because that is what the column holds and what the reader asks for.
   AND p.month = date_trunc('month', now() AT TIME ZONE 'UTC')::date
  LEFT JOIN public.bytes_moved b
    ON b.tenant_id = t.id
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

-- Replacing a view keeps its privileges; said again, so the file holds its own
-- rule (0027): read, and nothing else.
GRANT SELECT ON public.support_tenant_usage TO app_user;
REVOKE INSERT, UPDATE, DELETE ON public.support_tenant_usage FROM app_user;

COMMENT ON VIEW public.support_tenant_usage IS
  'The tier evidence, per tenant, for the operator''s screen (0109 T4 surfaced): this month''s recorded peak — this month in UTC, the same month the customer''s own screen reads — the lifetime first-copy meter, and live counts of the paths the migrations carry, per state and per stop (0128 T4). Reads only — the true-up that prices a month belongs to the tier calculator, not to somebody looking. Guarded by the same platform_operator predicate as every support view.';
