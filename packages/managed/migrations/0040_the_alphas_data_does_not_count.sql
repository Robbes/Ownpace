-- The alpha's data does not count (workplan 0109 T6; the owner, 2026-10-04:
-- *"In total for ever, and the alpha's data doesn't count"*).
--
-- `bytes_moved` (managed 0016) is the organisation's first-copy meter: in
-- total, for ever, never falling. It stays that: the record of what was moved.
-- What a ceiling, a hold and a tier COUNT is that total less what was moved
-- during the alpha, which was promised free: `bytes - alpha_bytes`.
--
-- `alpha_bytes` rises with `bytes` while the deployment's stage is `alpha`
-- (the worker knows it from `OWNPACE_STAGE`), and stops rising when the alpha
-- ends, so it holds what the alpha moved without anyone having to mark the
-- moment. A tenant that first moves anything after the alpha has 0.
--
-- Every byte on the meter before this migration was moved during the alpha:
-- the managed edition has not left it (no yes has been taken, and nothing has
-- been charged). So the existing rows are counted as the alpha's, once; the
-- runner records this file and never runs it again.

ALTER TABLE public.bytes_moved
    ADD COLUMN IF NOT EXISTS alpha_bytes bigint NOT NULL DEFAULT 0;

UPDATE public.bytes_moved SET alpha_bytes = bytes;

ALTER TABLE public.bytes_moved
    DROP CONSTRAINT IF EXISTS bytes_moved_alpha_bytes_check;
ALTER TABLE public.bytes_moved
    ADD CONSTRAINT bytes_moved_alpha_bytes_check CHECK (alpha_bytes >= 0 AND alpha_bytes <= bytes);

COMMENT ON COLUMN public.bytes_moved.alpha_bytes IS
  'First-copy bytes moved while the stage was alpha, which never count (the owner, 2026-10-04). Rises with bytes during the alpha and never after; never falls. What counts is bytes - alpha_bytes.';

-- Neither number falls, for every role: the alpha's share no more than the
-- total, or the count would rise by a write nobody made.
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
    IF NEW.alpha_bytes < OLD.alpha_bytes THEN
        RAISE EXCEPTION 'bytes_moved %: what the alpha moved never falls (% -> %), or its data would start to count',
            OLD.tenant_id, OLD.alpha_bytes, NEW.alpha_bytes
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- The operator's usage view reads the meter as the tier counts it (0029's
-- rule: the view counts what the tier counts). Everything else is 0029's view.
CREATE OR REPLACE VIEW public.support_tenant_usage AS
  SELECT
    t.id            AS tenant_id,
    p.peak_paths,
    p.peak_at,
    -- What counts: the meter less what the alpha moved. NULL when nothing has
    -- ever moved.
    b.bytes - b.alpha_bytes AS bytes_moved,
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
  'The tier evidence, per tenant, for the operator''s screen (0109 T4 surfaced): this month''s recorded peak — this month in UTC, the same month the customer''s own screen reads — the first-copy meter as the tier counts it (less what the alpha moved, managed 0040), and live counts of the paths the migrations carry, per state and per stop (0128 T4). Reads only — the true-up that prices a month belongs to the tier calculator, not to somebody looking. Guarded by the same platform_operator predicate as every support view.';
