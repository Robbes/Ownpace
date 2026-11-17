-- An organisation the operator can close, and a list that shows which ones
-- nobody uses (workplan 0139 T7 (b)).
--
-- ## What the list could not say
--
-- `support_tenants` (0009, 0010) served a name, a status, the day an
-- organisation joined and three counts about its migrations. Two questions an
-- operator asks of that list had no answer on it:
--
--   - **Is anybody using this?** An organisation made by a granted request
--     whose invitation nobody claimed, with no connection and no migration,
--     reads the same as a quiet one. The two the owner's own test grants made
--     on live are that: one member each, the invitation nobody claimed
--     (0139's Status, 2026-11-16).
--   - **When does it go?** `tenant_status` said `closed` and nothing else: not
--     the day it was closed, not the day the purge erases it, and so not
--     whether it can still be reopened.
--
-- So five columns join the view, appended, because `CREATE OR REPLACE VIEW`
-- may add columns at the end and never reorder them (0010's rule):
--
--   connection_count  the organisation's connections, sources and targets.
--   member_count      its ACTIVE members: people who signed in and are in it.
--                     An invitation nobody claimed is not somebody using it.
--   last_pass_at      when its latest pass began (`run.created_at`: a runner
--                     writes the row as it starts, `startRun`). A migration
--                     that runs is in use, whoever last signed in.
--   closed_at         from `tenant_closure`: the close, NULL while open.
--   purge_after       from `tenant_closure`: the day the purge erases it. A
--                     reopen is possible until then, and never for a window
--                     of 0 (`reopenTenant`).
--
-- Counts and dates only, as every column here: no address, no setting, no
-- name of anything inside the organisation. `closed_by` is not served; the
-- audit row (`tenant.closed`) names who closed it, on the log the operator
-- already reads (`support_log`, 0025).
--
-- ## Not the audit log's last line
--
-- "Last activity" read from `audit_log` was the obvious column and the wrong
-- one: the digest writes an audit row each time it mails an organisation
-- (`digest_sent_daily`, as `system:digest`), so an organisation nobody had
-- touched in a month could read as active this morning. A pass is the service
-- doing work the organisation set up, which is the question.
--
-- ## The same guard
--
-- The `platform_operator` predicate is written out in full, as in every
-- support view; `support-views.unit.test.ts` fails on any `support_%` view that
-- lacks it. `CREATE OR REPLACE` keeps the view's grants, including 0027's
-- revocation of every write.

CREATE OR REPLACE VIEW public.support_tenants AS
  SELECT
    t.id            AS tenant_id,
    t.name          AS tenant_name,
    t.status        AS tenant_status,
    t.created_at    AS joined_at,
    (SELECT count(*) FROM public.mailbox_mapping m WHERE m.tenant_id = t.id)
                    AS migration_count,
    (SELECT count(*) FROM public.migration_status s
      WHERE s.tenant_id = t.id AND s.state = 'failed')
                    AS failing_domain_count,
    (SELECT count(*) FROM public.decision d
      WHERE d.tenant_id = t.id AND d.status = 'pending')
                    AS pending_decision_count,
    -- Appended by this migration, in this order.
    (SELECT count(*) FROM public.connection c WHERE c.tenant_id = t.id)
                    AS connection_count,
    (SELECT count(*) FROM public.tenant_member tm
      WHERE tm.tenant_id = t.id AND tm.status = 'active')
                    AS member_count,
    (SELECT max(r.created_at) FROM public.run r WHERE r.tenant_id = t.id)
                    AS last_pass_at,
    tc.closed_at    AS closed_at,
    tc.purge_after  AS purge_after
  FROM public.tenant t
  LEFT JOIN public.tenant_closure tc ON tc.tenant_id = t.id
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

COMMENT ON VIEW public.support_tenants IS
  'Level 1 of the operator surface (workplan 0110 T2, T5; 0139 T7 (b)): every '
  'organisation, metadata only. `pending_decision_count` is a COUNT and never '
  'the decisions themselves; their summary and detail carry addresses. '
  '`member_count` counts ACTIVE members only, and `last_pass_at` is the latest '
  'pass, not the audit log''s last line, which the digest writes too. '
  '`closed_at` and `purge_after` are NULL while the organisation is open.';
