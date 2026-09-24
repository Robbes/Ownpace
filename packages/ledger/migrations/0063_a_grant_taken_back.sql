-- A GRANT TAKEN BACK (workplan 0108 T8 (c), the owner's decision of
-- 2026-09-23: "C: yes, after B. Also: if we cannot revoke at the sources, we
-- do revoke/remove in our system and tell the person that revokes.").
--
-- The person who granted a migration access through a link can take it back
-- from their progress page. The granted token is revoked at Google where
-- Google will, and deleted here whatever Google answers: `source_secret_ref`
-- goes back to NULL.
--
-- That alone does not stop the migration. A pass would find no token and fail
-- every hour with a sentence about a missing credential, or, where the
-- connection holds a credential of its own, quietly read the account on that
-- one: the one thing the person has just said no to. So the mapping keeps WHEN
-- its grant was withdrawn, and while it does, nothing reads the account. The
-- tick does not start a pass for it, a pass already running stops before its
-- next data type, and building a source for it is refused by name. The owner's
-- Start and Sync now say why.
--
-- A new grant clears it, in the transaction that stores the new token
-- (`storeGrantedToken`), which is the one writer of `source_secret_ref`.

ALTER TABLE public.mailbox_mapping
  ADD COLUMN IF NOT EXISTS grant_withdrawn_at timestamptz;

COMMENT ON COLUMN public.mailbox_mapping.grant_withdrawn_at IS
  'When the person who granted this migration access through a link took it back (workplan 0108 T8 (c)). While set, nothing reads the source account. Cleared by the next grant.';
