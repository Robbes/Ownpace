-- THE PERSON YOU ARE (ADR-0050, amended 2026-11-19; workplan 0153 T4).
--
-- *Start a migration* asks *Who is it for?* (*Voor wie?*) first, and the
-- owner asked for their own name to be chosen there already (2026-11-19).
-- Choosing it needs to know which person on the list is the member who is
-- signed in, and nothing said: a person was a name, and optionally an
-- address for grant links. A name or an address matched against the sign-in
-- would be a guess, and a wrong one gives one person's migration to another.
-- Asked to choose between an explicit link, a match on the address and
-- choosing the only person, the owner chose the link.
--
-- ## A person may be one member's own
--
-- `person.user_id` is the member's sign-in subject, the same value as
-- `tenant_member.user_id`. Only that member writes it, from their own
-- sign-in (`people.ts`, behind `POST /api/people` with `myself` and
-- `PUT /api/people/{personId}/myself`), never from a request body. NULL is a
-- person who is nobody's account, which every person made before this is.
--
-- AT MOST ONE PERSON PER MEMBER in an organisation: a unique index on
-- `(tenant_id, user_id)` where `user_id` is set. Marking another person moves
-- the link, in one transaction, so the index is never what refuses it.
--
-- THE LINK GOES WITH THE MEMBERSHIP. The key names the member's own row by
-- `tenant_member`'s `(tenant_id, user_id)`, which is unique since 0001.
-- Removing a member (the Team page's Remove, the operator's tools) deletes
-- that row, and the key sets `user_id` back to NULL on their person: the
-- person stays, with their name and their migrations. `SET NULL (user_id)`
-- names the one column, because the plain form would set `tenant_id` to NULL
-- too, which the column and the person's other keys refuse. A membership row
-- whose subject is rewritten carries its person with it (`ON UPDATE CASCADE`).
-- Only an invitation being taken up rewrites one, and an invited row is
-- nobody's person yet.
--
-- ## Row security needs nothing new
--
-- `person`'s one policy holds a row to its organisation, whatever the row
-- holds, and the key holds `user_id` to a member of that same organisation.
-- A key is checked past row security, as `person_migration`'s are (0031). The
-- erasure purges `person` before `tenant_member` (`PURGED_TABLES`), so the
-- key has no person left to change by the time the members go. The appliance
-- applies no managed migration and has no `person` table.
--
-- Personal data: an opaque id the identity provider issued, which
-- `tenant_member` already holds for the same member. It goes with the person.

ALTER TABLE public.person ADD COLUMN IF NOT EXISTS user_id text;

ALTER TABLE public.person DROP CONSTRAINT IF EXISTS person_member_fkey;
ALTER TABLE public.person
    ADD CONSTRAINT person_member_fkey FOREIGN KEY (tenant_id, user_id)
      REFERENCES public.tenant_member (tenant_id, user_id)
      ON UPDATE CASCADE
      ON DELETE SET NULL (user_id);

-- One person per member, per organisation.
CREATE UNIQUE INDEX IF NOT EXISTS person_one_per_member
    ON public.person USING btree (tenant_id, user_id)
    WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.person.user_id IS
  'The member this person is, by their sign-in subject (tenant_member.user_id), written only by that member. NULL for a person who is no member''s. Removing the member sets it back to NULL (ADR-0050, amended 2026-11-19).';
