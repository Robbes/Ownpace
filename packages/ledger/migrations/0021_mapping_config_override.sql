-- Where a migration is rooted, when its connection is shared (workplan 0066).
--
-- Connection reuse (0064) let a second mapping borrow a connection's stored
-- credentials instead of re-pasting them. It also made the connection's whole
-- `config` apply — so a mapping reusing a Drive connection silently inherited
-- its `rootFolderId`, and "same account, different folder" was impossible
-- without a duplicate connection holding the same secret twice.
--
-- The split these columns encode:
--
--   the CONNECTION answers  "as whom do we sign in?"   (credentials, provider)
--   the MAPPING    answers  "whose data, and where?"   (subject, root folder)
--
-- That is the honest division. A Box subject user id, a Drive root folder, a
-- Dropbox root path and a Graph mailbox are all decisions about THIS
-- migration, not properties of the account we authenticate as — and ADR-0033
-- already says a mapping's blast radius is one subject, which a shared
-- connection cannot express on its own.
--
-- NULL means "nothing to override", which is every mapping created before
-- this and every mapping whose connection is not shared. The merge is
-- override-over-connection, so a key absent here keeps whatever the
-- connection said and nothing changes for existing rows.

ALTER TABLE public.mailbox_mapping
  ADD COLUMN IF NOT EXISTS source_config_override jsonb,
  ADD COLUMN IF NOT EXISTS target_config_override jsonb;
