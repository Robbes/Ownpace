-- The ledger learns a fifth domain: `task` (workplan 0113 T2).
--
-- The owner, walking his own Soverin account (2026-09-03): *"i found 'Tasks',
-- is that a Dav to? Perhaps we need to add it as objecttype?"* Yes — tasks are
-- CalDAV `VTODO` components in a calendar collection whose
-- `supported-calendar-component-set` says so (RFC 4791 §5.2.3, RFC 5545
-- §3.6.2), reachable over the protocol this product already speaks with the
-- credential it already holds.
--
-- THIS MIGRATION GOES FIRST, AND ALONE. Nothing in the product produces a
-- `task` row yet: `DISCOVERY_DOMAINS` still names four, so no source lists a
-- task collection and no pass writes one. That order is deliberate. A database
-- that accepts a value nobody sends is inert; code that sends a value the
-- database refuses is a run that dies mid-pass with a constraint violation and
-- a half-copied mailbox behind it. Additive first, always.
--
-- WIDENING ONLY. Every existing value stays valid, no row is read or written,
-- and each constraint is dropped and recreated inside this migration's own
-- transaction — the same shape as 0008/0012/0015/0018/0019, which widened
-- `connection.kind` five times between them.
--
-- EIGHT CONSTRAINTS, one per table that stores a domain: seven declared in
-- `0001_baseline.sql` and one added by `0035_a_lifecycle_per_path.sql`. The
-- ninth below is `item.item_type`, which is a different vocabulary ('mail'
-- rather than 'email') on a LEGACY column: the code stores an item's domain in
-- `item.domain` and has never written `item_type`, which keeps its 'mail'
-- default. It is widened anyway, because a constraint that would refuse a
-- correct value is a trap whether or not anything walks into it today, and
-- leaving one of nine narrower than its siblings is exactly the drift 0113 T1
-- spent eighty edits removing.

ALTER TABLE public.collection_mapping DROP CONSTRAINT IF EXISTS collection_mapping_domain_check;
ALTER TABLE public.collection_mapping ADD CONSTRAINT collection_mapping_domain_check CHECK (
  domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);

ALTER TABLE public.item DROP CONSTRAINT IF EXISTS item_domain_check;
ALTER TABLE public.item ADD CONSTRAINT item_domain_check CHECK (
  domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);

-- The legacy column described above: 'mail' where the others say 'email'.
ALTER TABLE public.item DROP CONSTRAINT IF EXISTS item_item_type_check;
ALTER TABLE public.item ADD CONSTRAINT item_item_type_check CHECK (
  item_type = ANY (ARRAY['mail'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);

ALTER TABLE public.migration_discovery DROP CONSTRAINT IF EXISTS migration_discovery_domain_check;
ALTER TABLE public.migration_discovery ADD CONSTRAINT migration_discovery_domain_check CHECK (
  domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);

ALTER TABLE public.migration_status DROP CONSTRAINT IF EXISTS migration_status_domain_check;
ALTER TABLE public.migration_status ADD CONSTRAINT migration_status_domain_check CHECK (
  domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);

ALTER TABLE public.scope_selection DROP CONSTRAINT IF EXISTS scope_selection_domain_check;
ALTER TABLE public.scope_selection ADD CONSTRAINT scope_selection_domain_check CHECK (
  domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);

ALTER TABLE public.sync_checkpoint DROP CONSTRAINT IF EXISTS sync_checkpoint_domain_check;
ALTER TABLE public.sync_checkpoint ADD CONSTRAINT sync_checkpoint_domain_check CHECK (
  domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);

ALTER TABLE public.verification DROP CONSTRAINT IF EXISTS verification_domain_check;
ALTER TABLE public.verification ADD CONSTRAINT verification_domain_check CHECK (
  domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);

ALTER TABLE public.path_lifecycle DROP CONSTRAINT IF EXISTS path_lifecycle_domain_check;
ALTER TABLE public.path_lifecycle ADD CONSTRAINT path_lifecycle_domain_check CHECK (
  domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);
