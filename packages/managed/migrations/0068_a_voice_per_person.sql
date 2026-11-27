-- A VOICE PER PERSON (workplan 0176 §11, T7; D8 (a); the owner, 2026-11-26:
-- *"Yes"* to *je* or *u* on a person's pages as the member chooses, and per
-- person rather than per organisation).
--
-- A member chooses, where they make a person's link, how that person's own
-- pages speak to them: Dutch with *u*, Dutch with *je*, or English. A mother
-- may be *je* and a grandfather *u* in one family, so the choice is the
-- person's row's, not the organisation's.
--
-- ## What it holds
--
-- `voice` is one of `nl-u`, `nl-je` and `en` (`PERSON_VOICES` in
-- `@openmig/shared`; `a-voice-per-person.unit.test.ts` holds this CHECK to
-- it). One column for the language and the register together, because only
-- three of their pairs exist: English has one *you*. NULL is unset, which is
-- every person made before this and today's page: the reader's browser
-- language, with *u*.
--
-- Where it holds: a person's link page and progress page, which the server's
-- answers tell (`language`, `register`); the server's own Dutch on those
-- pages, its refusals and its ending after a sign-in; and the message the
-- member is given to send with the link. Nowhere else: the member's own app
-- stays *u*. The page's language is this one until the reader picks another
-- with the switch, which then wins, as it did.
--
-- ## Who writes it
--
-- A member who may make the person's link, in the same request
-- (`POST /api/people/{personId}/links` with `voice`). Left out, it stays as it
-- was. Row security needs nothing new: `person`'s policy holds the row to its
-- organisation, whatever it holds. Erasure purges `person` whole. The
-- appliance applies no managed migration and has no `person` table.
--
-- Personal data: how a member chose to address one of their people. The
-- privacy text says so with step B (workplan 0176 §14).

ALTER TABLE public.person ADD COLUMN IF NOT EXISTS voice text;

ALTER TABLE public.person DROP CONSTRAINT IF EXISTS person_voice_check;
ALTER TABLE public.person
    ADD CONSTRAINT person_voice_check CHECK (
      voice IS NULL OR voice = ANY (ARRAY['nl-u'::text, 'nl-je'::text, 'en'::text])
    );

COMMENT ON COLUMN public.person.voice IS
  'How this person''s own pages speak to them, as a member chose it (workplan 0176 T7, D8 (a)): nl-u, nl-je or en. NULL: the browser''s language, with u.';
