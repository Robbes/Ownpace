-- Everything a mapping writes, under one folder on the TARGET (owner decision
-- 2026-08-16).
--
-- The choice this encodes: when several sources migrate into one target
-- account, some owners want them MERGED -- one inbox, one tree, the new
-- platform as the single place -- and some want a subfolder per source
-- (Gmail/..., O365/...). NULL means merge, which is the default and the
-- owner's stated philosophy; the prefix is the opt-in for the other camp.
--
-- Root-relative, no leading/trailing slash, no '.'/'..' segments -- enforced
-- by the shared parser both editions validate with (hard rule 5), not by a
-- CHECK, because the refusal must carry the reason in a sentence.

ALTER TABLE public.mailbox_mapping
  ADD COLUMN IF NOT EXISTS target_folder_prefix text;

COMMENT ON COLUMN public.mailbox_mapping.target_folder_prefix IS
  'Folder under the target account root that everything this mapping writes lands in. NULL = merge into the account root (the default). Mail folders and file directories only; the ledger keeps recording SOURCE collections, and the destructive path prefixes at the moment of acting.';
