-- What the DESTINATION already holds, counted at discovery time.
--
-- Discovery counted the source only, so the confirm screen described every
-- migration as if it were going into an empty account. It very often is not:
-- the customer may already be using the destination, and a freshly provisioned
-- one ships with the provider's own starter content.
--
-- `target_existing` is everything already there. `target_colliding` is the
-- subset sharing a natural key with a source item — those will be ADOPTED:
-- recorded as migrated and left exactly as the destination has them, never
-- overwritten (hard rule 2). That second number is the one that changes what
-- the customer ends up with, so it is the one they have to see before starting.
--
-- Both nullable, and deliberately so: null means "we could not enumerate the
-- destination", which is a different claim from 0, "the destination is empty".
-- Defaulting to 0 would state the second while meaning the first.

ALTER TABLE migration_discovery
  ADD COLUMN IF NOT EXISTS target_existing  integer,
  ADD COLUMN IF NOT EXISTS target_colliding integer;
