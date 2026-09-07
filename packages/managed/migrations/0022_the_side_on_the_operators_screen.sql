-- The operator's level-3 view carries WHICH SIDE a failure happened on
-- (workplan 0094 T5, second slice; ledger migration 0040 added the column).
--
-- The customer's own screens already say it. Metadata-only support (0110)
-- exists so that the person who phones and the person they phone read the
-- same sentence — and "the source side" is exactly the kind of fact that
-- decides a call: reconnect the old account, or look at the new one.
--
-- It passes the column-list boundary the way `last_error_category` does:
-- two words, `source` or `target`, held to those by the ledger's CHECK. No
-- address, no folder, no subject. `last_error` stays unselected, as it must.
--
-- CREATE OR REPLACE VIEW can only ADD columns, and only at the end — which is
-- what this does. The grant on the view survives the replace.

CREATE OR REPLACE VIEW public.support_migration_domains AS
  SELECT
    s.tenant_id,
    s.mapping_id,
    s.domain,
    s.state,
    s.started_at,
    s.updated_at,
    s.completed_at,
    s.last_error_category,
    s.last_pass_metrics,
    s.failed_side
  FROM public.migration_status s
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );
