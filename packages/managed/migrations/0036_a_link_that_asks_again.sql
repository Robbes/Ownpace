-- A PERSON'S LINK THAT ASKS AGAIN (ADR-0035, amended 2026-09-29; workplan
-- 0153 T5 (b)).
--
-- A person's grant link asks each Google account of theirs that is not
-- connected, and is spent once every one is (0034). That left no way to ask
-- again for an account whose connection stopped working: a grant can be taken
-- back at Google, or lapse, and while a Google application is in testing it
-- expires after seven days. The migration still holds the token it can no
-- longer use, so the account reads as connected. A migration's own link asked
-- for whatever its migration needed, connected or not, and was the way back.
-- Since the owner's answer of 2026-10-03 (*"yes, replace the per-migration
-- links"*) none is made.
--
-- So a link made while every account of the person's is connected asks each
-- of them again, and remembers which migrations it asks for: `asks_again`.
-- Each migration leaves the list as its account is connected through the
-- link, and the link is spent once none is left and every account is
-- connected. NULL is a link made while something was not connected, which
-- asks only for that, as 0034's did.
--
-- Migration ids, not accounts: the row stays free of addresses, and a
-- migration that leaves the person stops being asked for. 0035 is another
-- branch's (the system role's purge of this table), so this is 0036.

ALTER TABLE public.person_link ADD COLUMN asks_again uuid[];

COMMENT ON COLUMN public.person_link.asks_again IS
  'The migrations a grant link made while every account of the person''s was connected asks to connect again; each leaves as its account is connected through the link. NULL: the link asks only for what is not connected.';
