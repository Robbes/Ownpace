-- Rename: these items are now MIGRATED, with a generated Message-ID written
-- into them, rather than left behind.
--
-- 0015 introduced `unmigratable_items` when mail without a Message-ID was
-- skipped. It is now copied — the sync derives a stable id from the message's
-- own bytes and writes it in as a real header — so the count means "items we
-- had to give an id to", and it is a SUBSET of `items` rather than a figure
-- excluded from it. Keeping the old name would misreport migrated mail as
-- abandoned.
--
-- Still nullable: null means "this run predates the column and did not look",
-- which is not the same claim as "there were none".

ALTER TABLE migration_discovery
  RENAME COLUMN unmigratable_items TO generated_id_items;
