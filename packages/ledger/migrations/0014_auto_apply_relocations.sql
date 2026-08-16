-- Per-mapping opt-in for unattended relocation apply (ADR-0031, accepted
-- 2026-08-16).
--
-- DEFAULT FALSE, like allow_apply_deletions beside it: a capability that
-- destroys data is opted into, never out of — and this one runs without a
-- human pressing the button, which is why ADR-0031 puts four extra gates in
-- front of it (unique pairing, survived-a-pass, breaker-decides-for-the-pass,
-- per-pass cap) on top of every manual gate. Deletions are never auto-applied;
-- this flag governs relocations only.

ALTER TABLE public.mailbox_mapping
  ADD COLUMN auto_apply_relocations boolean NOT NULL DEFAULT false;
