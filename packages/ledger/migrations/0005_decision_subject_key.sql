-- What the drift decision queue needs before it can have a writer (0028 T1).
--
-- The `decision` table shipped in ledger v1 with no readers or writers, and
-- nothing to make raising idempotent: a detector that re-runs (they all do —
-- rule 1) had no way to say "this exact question is already pending" without
-- an application-level read-then-insert race. `subject_key` is the detector's
-- stable identifier for WHAT the decision is about — a mailbox address for
-- `new_mailbox`, a group id for `shared_address_pattern` — and the partial
-- unique index makes re-raising the same pending question a no-op at the
-- database, not merely in whoever remembered to check.
--
-- PENDING only, on purpose: once the owner resolves or dismisses a decision,
-- the same subject may legitimately need asking again (a mailbox deleted and
-- re-created, a group whose store appeared later). History stays; only the
-- open question is unique.
--
-- Nullable, on purpose: rows raised before this column existed (there are
-- none in practice — the table has no writers — but the migration must not
-- invent a fact) and any future category with no natural subject stay legal;
-- the index simply does not cover them.

ALTER TABLE public.decision
  ADD COLUMN subject_key text;

CREATE UNIQUE INDEX uk_decision_pending_subject
  ON public.decision (tenant_id, category, subject_key)
  WHERE status = 'pending' AND subject_key IS NOT NULL;
