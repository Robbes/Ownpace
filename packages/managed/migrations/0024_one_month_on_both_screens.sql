-- The operator's screen and the customer's screen read the same month.
--
-- `support_tenant_usage` (migration 0017) joins this month's recorded peak
-- with:
--
--     AND p.month = date_trunc('month', now())::date
--
-- `now()` is a `timestamptz`, and `date_trunc` truncates one of those in the
-- SESSION's timezone — then `::date` applies that zone again. Nothing in this
-- codebase sets a session timezone, so the expression means whatever the
-- server was installed with. Measured on PGlite, 2026-09-09, at the instant
-- 2026-09-30T23:30:00Z:
--
--     TimeZone = UTC                -> 2026-09-01
--     TimeZone = Europe/Amsterdam   -> 2026-10-01
--     TimeZone = America/New_York   -> 2026-09-01
--
-- The customer's own screen (`GET /api/billing/usage`) reads the same row
-- through `PgOccupancyPeakStore.forMonth`, which computes the month with
-- `Date.UTC` and therefore always asks for 2026-09-01. So on an appliance in
-- the Netherlands — the deployment this product actually ships to — the two
-- screens read DIFFERENT MONTHS for the last two hours of every month in
-- summer and the last hour in winter. The operator, whose whole purpose here
-- is to be the earlier pair of eyes on a number before a customer sees it,
-- would have been looking at a different number.
--
-- `occupancy_peak.month` is documented in migration 0015 as "First day of the
-- calendar month, UTC". The reader honours that and this view did not, so this
-- is the view moving to the column's stated contract, not a change of meaning.
-- The writer moved in the same commit (`recordCurrentOccupancy`), which was
-- wrong in the same way and for the same reason.
--
-- ## Why `AT TIME ZONE 'UTC'` and not `date_trunc('month', now(), 'UTC')`
--
-- The three-argument form returns a `timestamptz` at midnight UTC on the
-- first; casting THAT to `date` re-applies the session zone, and west of
-- Greenwich midnight UTC is the previous evening — measured on the same run,
-- `America/New_York` yields 2026-08-31, which is not even the first of a
-- month. `AT TIME ZONE 'UTC'` yields a plain `timestamp`, and a plain
-- timestamp casts to a date with no zone left to interfere.
--
-- ## No rows are repaired here
--
-- A peak filed under the wrong month cannot be moved by this migration:
-- `month` is half the primary key, the true month may already hold a row, and
-- migration 0015's trigger refuses any update that lowers a peak. It is also
-- not yet load-bearing — `POST /api/billing/invoices/generate` has refused
-- with 409 since workplan 0109 T0, so no invoice has been priced from these
-- rows. Fixing the three writers and readers stops new rows being misfiled;
-- if a misfiled row is ever found, moving it is a decision with evidence in
-- front of it, not a blind UPDATE in a migration.
--
-- Only the join condition changes. The column list, the operator predicate,
-- the grant and the comment are 0017's, repeated because `CREATE OR REPLACE
-- VIEW` needs the whole definition and because this file — not 0017 — is now
-- the authority on what the view is.

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
    -- UTC, because that is what the column holds and what the reader asks for.
   AND p.month = date_trunc('month', now() AT TIME ZONE 'UTC')::date
  LEFT JOIN public.bytes_moved b
    ON b.tenant_id = t.id
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

GRANT SELECT ON public.support_tenant_usage TO app_user;

COMMENT ON VIEW public.support_tenant_usage IS
  'The tier evidence, per tenant, for the operator''s screen (0109 T4 surfaced): this month''s recorded peak — this month in UTC, the same month the customer''s own screen reads — the lifetime first-copy meter, and live path counts per state. Reads only — the true-up that prices a month belongs to the tier calculator, not to somebody looking. Guarded by the same platform_operator predicate as every support view.';
