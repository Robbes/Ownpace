-- When was this item's move RECORDED (ADR-0031, accepted 2026-08-16).
--
-- Until now the moves queue could not answer "how long has this report been
-- sitting here": `updated_at` is touched by every pass, so it always reads
-- "just now". The operator reading the queue needs the age to triage, and
-- ADR-0031's survived-a-pass gate needs it before anything may be applied
-- unattended — a correlation born of a flaky listing looks exactly like a real
-- move for one pass, and self-corrects on the next.
--
-- Stamped when a move is recorded; RE-stamped when the destination changes
-- (a move somewhere new is a new report, exactly the rule moveAcknowledgedAt
-- follows in reverse); cleared with the move.
--
-- The backfill uses `updated_at` — the row's last touch — which for an open
-- move is approximately "the last pass", the honest lower bound available.
-- That makes existing open moves eligible for ADR-0031's age gate one pass
-- after this migration runs, rather than never (NULL) or instantly (now()
-- minus an invented age).

ALTER TABLE public.item ADD COLUMN moved_recorded_at timestamptz;

UPDATE public.item
SET moved_recorded_at = updated_at
WHERE moved_to_collection IS NOT NULL;
