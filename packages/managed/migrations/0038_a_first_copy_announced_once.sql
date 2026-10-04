-- A FIRST COPY ANNOUNCED ONCE PER PERSON (workplan 0154 T7; the owner,
-- 2026-09-28: "One per person").
--
-- The first-copy email goes out once per person, when the last of their
-- migrations finishes its first complete pass. Two of one person's migrations
-- can finish together on two runners, so "once" cannot be a check followed by
-- a send. It is this column, claimed by a pass that finds everything in:
--
--   UPDATE person SET first_copy_announced_at = now()
--    WHERE id = $1 AND tenant_id = $2 AND first_copy_announced_at IS NULL
--
-- and only the pass whose update changed the row sends. Each pass marks its
-- own data types done before it asks, so of two that finish together at least
-- one sees the other's, and the claim lets only one of them through.
--
-- NULL until then. A person made before this column is mailed only when a pass
-- finishes a first copy of theirs from now on: a pass asks only when it has
-- just finished one, so nobody is told today about a copy that arrived weeks
-- ago.

ALTER TABLE public.person ADD COLUMN first_copy_announced_at timestamptz;

COMMENT ON COLUMN public.person.first_copy_announced_at IS
  'When the email saying everything of this person''s has arrived was claimed (workplan 0154 T7): set once, by the pass that found the last first copy in, and never cleared.';
