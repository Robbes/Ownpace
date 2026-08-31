-- Finding a person, and the two reads that makes (owner decision 2026-08-31).
--
-- Migration 0018 put an organisation's people on its support screen. That
-- serves "who is in THIS organisation" and nothing else: to answer "somebody
-- contacted me, who are they", an operator has to guess which organisation to
-- open first. With one customer that is fine. With thirty it is not a surface,
-- it is a memory test — and the owner said so on the day it shipped: "I was
-- expecting ... a search for people or list with them."
--
-- The search itself needs no new view. `support_tenant_members` (0018) carries
-- the people and `support_tenants` (0009) carries the organisation's name, both
-- behind the same `platform_operator` predicate, so the route JOINS them and
-- neither fact gets a second authority. A third view would have been a copy of
-- one of them.
--
-- ## What this migration is actually for: the log
--
-- A search across every customer's people is the widest read this surface can
-- perform, and until now `support_read` could not describe it. The owner asked
-- for BOTH halves to be recorded — the search, and the opening of a result —
-- so the vocabulary grows by two.
--
-- `view_name`'s CHECK is deliberately closed, and 0009 said why: "a fourth is a
-- design change, not a copy edit". This is that design change, made the way
-- 0011 made its own — drop and re-add, with the whole list written out so the
-- vocabulary can be read in one place rather than assembled from three
-- migrations.
--
--   people  — a search was run. `tenant_id` is NULL, like the tenant LIST and
--             for the same reason 0009 gives: there is no tenant to name, and
--             it is a read of everybody.
--   person  — an operator followed a result THROUGH to that account at the
--             identity provider. `tenant_id` IS set: by then we know whose
--             organisation the person belongs to, and a read about one customer
--             belongs against that customer.
--
-- ## Why the query text is stored, and why that is safe here
--
-- "An operator ran a search" is a row that cannot be audited: it does not say
-- what was looked for or how many people came back, so it cannot distinguish
-- somebody answering one email from somebody enumerating the customer base.
-- Both facts are what make the row worth having.
--
-- The query is free text an operator typed, and it may well contain part of
-- somebody's address — which is precisely why it belongs in a log NOBODY can
-- survey. `support_read`'s existing policy lets an operator read their OWN
-- rows and no one else's (0009), so this adds no reader. Capped at 200
-- characters because a log entry is a record, not a payload.

ALTER TABLE public.support_read DROP CONSTRAINT IF EXISTS support_read_view_name_check;

ALTER TABLE public.support_read
  ADD CONSTRAINT support_read_view_name_check
  CHECK (view_name = ANY (ARRAY[
    'tenants'::text,
    'tenant'::text,
    'migration'::text,
    'retained_invoices'::text,
    'people'::text,
    'person'::text
  ]));

-- What was searched for, and how much came back. Nullable, because every other
-- view_name answers neither.
ALTER TABLE public.support_read ADD COLUMN IF NOT EXISTS query text;
ALTER TABLE public.support_read ADD COLUMN IF NOT EXISTS result_count integer;

-- AND THEY MAY NOT APPEAR ANYWHERE ELSE. Without this the columns are two more
-- nullable fields that any future caller could fill with anything, and the log
-- stops being countable — which is the property 0009 built the closed
-- vocabulary for. A search is the only read that HAS a query.
ALTER TABLE public.support_read DROP CONSTRAINT IF EXISTS support_read_query_is_a_search;

ALTER TABLE public.support_read
  ADD CONSTRAINT support_read_query_is_a_search
  CHECK (
    (view_name = 'people'::text AND query IS NOT NULL AND result_count IS NOT NULL)
    OR
    (view_name <> 'people'::text AND query IS NULL AND result_count IS NULL)
  );

ALTER TABLE public.support_read DROP CONSTRAINT IF EXISTS support_read_query_is_bounded;

ALTER TABLE public.support_read
  ADD CONSTRAINT support_read_query_is_bounded
  CHECK (query IS NULL OR char_length(query) <= 200);

-- A read ABOUT one person is a read about their organisation, so it must name
-- one — the log's whole value is being able to ask "who looked at this
-- customer" and get every answer.
ALTER TABLE public.support_read DROP CONSTRAINT IF EXISTS support_read_person_names_a_tenant;

ALTER TABLE public.support_read
  ADD CONSTRAINT support_read_person_names_a_tenant
  CHECK (view_name <> 'person'::text OR tenant_id IS NOT NULL);

COMMENT ON COLUMN public.support_read.query IS
  'What an operator searched for, for view_name = ''people'' and nothing else. Stored because "a search was run" cannot be audited: it distinguishes answering one email from enumerating the customer base. Readable only by the operator who wrote it (0009''s policy).';
COMMENT ON COLUMN public.support_read.result_count IS
  'How many people that search returned. The other half of what makes the row auditable.';
