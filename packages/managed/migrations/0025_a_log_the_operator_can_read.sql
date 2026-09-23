-- A log the operator can read (workplan 0129 T2, the managed half).
--
-- The owner asked for a log page the operator can read and search, kept basic,
-- and decided what it shows (0129 D1, D3): the audit log and the application's
-- own errors and warnings, one timeline, metadata only, searchable; and, the
-- same day, "do add the actor in auditlog page". This is that timeline, as one
-- more support view.
--
-- ## One view over two tables
--
-- `audit_log` (who did what, per customer, since the baseline) and `app_event`
-- (ledger 0059: the application's errors and warnings) have different shapes.
-- The view gives them one: time, level, customer, migration, event, category,
-- reference, actor. An audit row is `info`: somebody did something, nothing
-- went wrong. It has no category and no reference. An application event has
-- no actor: the process acted.
--
-- ## What it cannot select
--
-- `audit_log.detail`. It is what an audit event changed, and some writers put
-- an address or a name in it. The owner's words: "The details we don't need,
-- only when investigating, and we can then query them". So it stays in
-- `audit_log`, for a database query. The one thing read out of it is the
-- migration id that writers keep there, and only after it is checked to BE a
-- uuid.
--
-- Nor any text a person wrote. `app_event` cannot hold any: its CHECKs admit
-- names from code only. `audit_log.action` and `audit_log.actor` have no
-- CHECK, so the view applies one here. An action that is not a name from code
-- is served as `audit.unnamed`. An actor that is neither a member's address
-- nor an identifier is served as nothing.
--
-- ## Who acted
--
-- `audit_log.actor` is the identity provider's subject for a person, or the
-- process's own name (`system:digest`, `grant-link`, `operator`, ...). A subject
-- is opaque, so the view shows the member's address instead, when the
-- organisation has that member: the address `support_tenant_members` already
-- serves this screen's operator. `tenant_member` is unique per (tenant_id,
-- user_id), so the join cannot repeat a row.
--
-- ## The same guard, and the same log
--
-- The `platform_operator` predicate is written out in full, as in every
-- support view: `support-views.unit.test.ts` fails on any `support_%` view
-- that lacks it. And every page of it served is a `support_read` row: `log`
-- joins the closed vocabulary, and like `people` it records what was searched
-- for and how many rows came back (0019).

CREATE VIEW public.support_log AS
  WITH entry AS (
    SELECT
      a.id,
      a.at,
      'audit'::text AS source,
      'info'::text  AS level,
      a.tenant_id,
      CASE
        WHEN (a.detail ->> 'mappingId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (a.detail ->> 'mappingId')::uuid
      END           AS mapping_id,
      CASE
        WHEN a.action ~ '^[a-z][a-z0-9_.:-]{0,63}$' THEN a.action
        ELSE 'audit.unnamed'
      END           AS event,
      NULL::text    AS category,
      NULL::text    AS reference,
      COALESCE(
        m.email,
        CASE WHEN a.actor ~ '^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$' THEN a.actor END
      )             AS actor
    FROM public.audit_log a
    LEFT JOIN public.tenant_member m
      ON m.tenant_id = a.tenant_id AND m.user_id = a.actor
    UNION ALL
    SELECT
      e.id,
      e.at,
      'app'::text   AS source,
      e.level,
      e.tenant_id,
      e.mapping_id,
      e.event,
      e.category,
      e.reference,
      NULL::text    AS actor
    FROM public.app_event e
  )
  SELECT
    entry.id,
    entry.at,
    entry.source,
    entry.level,
    entry.tenant_id,
    t.name          AS tenant_name,
    entry.mapping_id,
    g.name          AS migration_name,
    entry.event,
    entry.category,
    entry.reference,
    entry.actor
  FROM entry
  LEFT JOIN public.tenant t ON t.id = entry.tenant_id
  LEFT JOIN public.mailbox_mapping g ON g.id = entry.mapping_id
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

GRANT SELECT ON public.support_log TO app_user;

COMMENT ON VIEW public.support_log IS
  'The operator''s log page (workplan 0129 T2): the audit log and the application''s errors and warnings, one timeline, metadata only. Never audit_log.detail, which an investigation reads with a database query. Guarded by the same platform_operator predicate as every support view, and read through support_read like every other.';

-- `log` joins the closed vocabulary. The whole list is written out again, as
-- 0011 and 0019 did: the constraint is dropped and re-added as it grows.
ALTER TABLE public.support_read DROP CONSTRAINT IF EXISTS support_read_view_name_check;

ALTER TABLE public.support_read
  ADD CONSTRAINT support_read_view_name_check
  CHECK (view_name = ANY (ARRAY[
    'tenants'::text,
    'tenant'::text,
    'migration'::text,
    'retained_invoices'::text,
    'people'::text,
    'person'::text,
    'log'::text
  ]));

-- A read of the log is a search, like `people`: which filters, and how many
-- rows came back. Filters on one customer are recorded under that customer
-- (`tenant_id`), so "who looked at this customer" finds these reads too.
ALTER TABLE public.support_read DROP CONSTRAINT IF EXISTS support_read_query_is_a_search;

ALTER TABLE public.support_read
  ADD CONSTRAINT support_read_query_is_a_search
  CHECK (
    (view_name = ANY (ARRAY['people'::text, 'log'::text])
      AND query IS NOT NULL AND result_count IS NOT NULL)
    OR
    (view_name <> ALL (ARRAY['people'::text, 'log'::text])
      AND query IS NULL AND result_count IS NULL)
  );
