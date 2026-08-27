-- Whether anything is WAITING on somebody (workplan 0110 T5, from §5's own
-- list of what the three levels show).
--
-- ## The question this answers, and why counting it is the whole feature
--
-- §5 asks each level to say "whether anything sits in a decision queue".
-- Migration 0009 gave the operator states and failure categories: enough to
-- answer *"is it stuck"*. It could not answer the other half — *"is it stuck
-- because WE are waiting for THEM"* — and those are opposite support
-- conversations. A migration paused on a drift decision is not broken; it is
-- waiting for a person who probably does not know they are being waited for.
--
-- Without this, an operator looking at a healthy-looking migration that has
-- not moved in a week has nothing to say. With it, the first sentence of the
-- call is "there are two things waiting for you on your decisions screen".
--
-- ## A COUNT, and deliberately nothing else
--
-- Not the decisions themselves. `decision.summary` is prose a detector wrote
-- about a specific mailbox, and `decision.detail` is a jsonb bag that has
-- carried addresses since 0028 T1 — both are exactly the class of thing the
-- column list exists to keep out. A number says whether to mention it; the
-- customer's own screen says what it is, and that is the right division.
--
-- `status = 'pending'` only. Resolved and dismissed decisions are history, and
-- an operator counting them would be reading how many judgements a customer
-- has made rather than what is outstanding.
--
-- ## Two grains, because decisions have two
--
-- `decision.mapping_id` is NULLABLE by design (schema-pg.ts:530, 0028 T1): a
-- newly discovered mailbox belongs to no migration yet. So the tenant view
-- counts EVERY pending decision the organisation has, and the migration view
-- counts only its own. The two do not add up, and that is correct rather than
-- a bug — the difference is exactly the decisions that belong to the tenant
-- and to no migration.
--
-- ## Replacing views rather than adding one
--
-- `CREATE OR REPLACE VIEW` appends a column to an existing view without
-- dropping it, so no grant is lost and nothing that reads the old columns
-- breaks. The predicate is written out again in full for the same reason
-- migration 0009 wrote it out five times: a view without it is silently total
-- access across every customer, and `support-views.unit.test.ts` fails on any
-- `support_%` view in the catalog that lacks it — including these, after the
-- replacement.

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
    -- EVERY pending decision the organisation has, including the ones that
    -- belong to no migration yet. Appended last: replacing a view may add
    -- columns at the end, never reorder them.
    (SELECT count(*) FROM public.decision d
      WHERE d.tenant_id = t.id AND d.status = 'pending')
                    AS pending_decision_count
  FROM public.tenant t
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

CREATE OR REPLACE VIEW public.support_tenant_migrations AS
  SELECT
    m.tenant_id,
    m.id            AS mapping_id,
    m.name,
    m.status        AS lifecycle,
    m.mode,
    m.pattern,
    m.schedule,
    m.created_at,
    m.updated_at,
    -- THIS migration's own pending decisions. Scoped by mapping_id AND
    -- tenant_id: the column is nullable and a join on it alone would count a
    -- tenant-level decision against every migration the tenant has.
    (SELECT count(*) FROM public.decision d
      WHERE d.tenant_id = m.tenant_id AND d.mapping_id = m.id AND d.status = 'pending')
                    AS pending_decision_count
  FROM public.mailbox_mapping m
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

COMMENT ON VIEW public.support_tenants IS
  'Level 1 of the operator surface (workplan 0110 T2, T5): every organisation, '
  'metadata only. `pending_decision_count` is a COUNT and never the decisions '
  'themselves — their summary and detail carry addresses.';

COMMENT ON VIEW public.support_tenant_migrations IS
  'Level 2/3 of the operator surface (workplan 0110 T2, T5): one migration, '
  'metadata only. `pending_decision_count` counts THIS mapping''s pending '
  'decisions; the tenant view''s counts every one the organisation has, '
  'including those belonging to no migration. The two are not meant to agree.';
