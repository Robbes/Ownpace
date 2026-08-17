-- Two migrations between the same two accounts must DIFFER (owner decision
-- 2026-08-18, workplan 0071 T6).
--
-- The baseline said a source/target mailbox pair may appear once, full stop.
-- That is nearly right and wrong in both directions:
--
--   * Too strict, because a pair CAN legitimately repeat when nothing overlaps
--     — the same two accounts with different target folder prefixes write into
--     different trees and never touch each other's items.
--   * Too loose in practice, because it was never the thing that refused. The
--     create route inserted a fresh `mailbox` row per connection with a
--     hardcoded external_id 'primary', so reusing a stored connection tripped
--     `mailbox_connection_id_external_id_key` FIRST and answered a 500 about a
--     unique index. Nobody ever reached this constraint through the wizard.
--
-- The owner's rule, in their words: *something needs to be difficult in the
-- source/target combination, like the optional folder — else it should not be
-- allowed*, because otherwise everything lands in the target twice.
--
-- COALESCE, not a plain three-column UNIQUE, and that is the whole point:
-- NULL means "merge into the account root", which is the DEFAULT and by far
-- the most common answer. Under Postgres's default NULLS DISTINCT two merges
-- into the same account would both be allowed — precisely the doubling this
-- exists to stop. Folding NULL to '' makes "merge" a value that collides with
-- itself. (`UNIQUE NULLS NOT DISTINCT` says the same thing on PG15+; the
-- expression index says it everywhere, PGlite included, which is where the
-- appliance runs.)

ALTER TABLE public.mailbox_mapping
  DROP CONSTRAINT IF EXISTS mailbox_mapping_source_mailbox_id_target_mailbox_id_key;

DROP INDEX IF EXISTS public.uk_mapping_source_target;

CREATE UNIQUE INDEX IF NOT EXISTS uk_mapping_source_target_prefix
  ON public.mailbox_mapping (
    source_mailbox_id,
    target_mailbox_id,
    (COALESCE(target_folder_prefix, ''))
  );

COMMENT ON INDEX public.uk_mapping_source_target_prefix IS
  'A source/target mailbox pair may repeat ONLY under a different target folder prefix, because two mappings that write the same items into the same place would double everything in the target. NULL (merge into the account root) is folded to '''' so that two merges between the same pair collide rather than both being accepted.';
