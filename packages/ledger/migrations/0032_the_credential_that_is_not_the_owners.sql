-- A credential home on the MAPPING, for the credential that is not the owner's
-- (workplan 0108 T4, ADR-0035 decision 4).
--
-- ## The blocker this closes, named verbatim in the ADR
--
-- ADR-0035 decision 4: *"`secret_ref` exists on `connection` and
-- `backup_target` and NOT on `mailbox_mapping` — a per-mapping credential home
-- must exist before a migrator can grant one mapping without touching a
-- connection shared by others."*
--
-- That is not a storage inconvenience, it is the whole model. A connection
-- answers **"as whom do we sign in"**, and it can be shared by several
-- mappings. When the person being migrated grants access to their OWN account,
-- what they hand over belongs to one mapping and to nobody else. Writing it
-- onto the connection would either overwrite somebody else's grant or silently
-- give every mapping on that connection the reach of this one person's
-- account.
--
-- ## It is MERGED over the connection's, key by key
--
-- Exactly the shape `source_config_override` established in migration 0021,
-- and for the same reason. The composite a Google source needs is
-- `{clientId, clientSecret, refreshToken}` — and the two halves have
-- **different owners**: the client id and secret are the OWNER's, configured
-- once on the connection, while the refresh token is the MIGRATOR's, produced
-- by their own consent. So this column holds only what the migrator supplied,
-- and it wins key by key over what the connection said. An absent key changes
-- nothing, which is why every mapping created before today keeps behaving
-- exactly as it did.
--
-- ## Encrypted, through the one credential store
--
-- ADR-0037: one credential store, no special case. The value is the same
-- `EncryptedSecret` JSON that `connection.secret_ref` holds, produced by
-- `SecretStore.encryptCredentials` and readable only by a process holding the
-- key. A `text` column, like its sibling — deliberately NOT `jsonb`, so no
-- query can reach inside a credential and no index can be built across one.
--
-- ## Nothing is granted to anyone new
--
-- `mailbox_mapping` already has RLS, FORCE, its four tenant policies and its
-- grants. A column inherits all of them, so this migration adds a column and
-- says nothing about access — the row's protection was already the right
-- protection, and restating it here would create a second place to get it
-- wrong. Erasure needs no change either: the column travels with the row, and
-- `mailbox_mapping` is already on the purge list.

ALTER TABLE public.mailbox_mapping
  ADD COLUMN IF NOT EXISTS source_secret_ref text;

COMMENT ON COLUMN public.mailbox_mapping.source_secret_ref IS
  'Encrypted credentials belonging to THIS mapping alone (workplan 0108 T4, '
  'ADR-0035 decision 4) — in practice the refresh token the migrated person '
  'granted through their own link. Merged key-by-key OVER the source '
  'connection''s credentials, so the owner''s client id and secret still come '
  'from the shared connection. Same EncryptedSecret JSON as connection.secret_ref.';
