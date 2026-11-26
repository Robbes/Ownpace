-- WHO SENDS THE LINK (workplan 0176 §7, T3 and T6, step B; D11; the owner,
-- 2026-11-26).
--
-- A person who opens a link sees who sent it. Until now that was the sign-in
-- address of the member who made the link, and the organisation's number. The
-- owner, asked whether the page may name the member who asks: *"Yes"*; and on
-- a number shown as something to check: *"Yes, good idea. And we can
-- store/show the phone number."* So the page gives two things a reader can
-- check: a name, and a number.
--
-- How the reader knows the sender is kept nowhere. D7 had a fixed list for
-- it, per link; the owner, reading the pages' Dutch on 2026-11-26: *"can we do
-- without it? Does the relationship matter and need to be registered? I would
-- like not to..."* This file had run on no stack, so it was changed in place.
--
-- ## On the member: a name and a number (`tenant_member`)
--
-- `display_name` is the member's name as the people they send a link to know
-- them; `phone` is their own number. Each is written only by that member, from
-- their own sign-in (`PUT /api/tenants/{tenantId}/members/me`), never by
-- another member: it is what the member says about themselves. NULL is none
-- given. The page then names them by their sign-in address, as before, and
-- shows the organisation's number, saying whose it is (D11).
--
-- Both are held to a shape twice. In the code, which refuses anything else
-- with a sentence (`senderNameFrom` and `senderPhoneFrom`, `@openmig/shared`),
-- and here, so that a row written any other way still cannot carry a
-- sentence under Ownpace's name: a name of at most 60 characters, with no
-- space at either end and no control character; a number of the
-- organisation's number's characters, with 6 to 15 digits, at most 32
-- characters.
--
-- ## Whose page a progress link is (`person_link.made_from`)
--
-- The progress page names the sender too (T6). A progress link a member makes
-- is theirs (`created_by`). The one the ending hands over after a sign-in is
-- made by nobody (`created_by` is `granted-by-link`), and it speaks for the
-- grant link the person signed in through: `made_from` names that link, so
-- the page names the member who sent it.
-- Only a progress link is made from another. The key names `(id, tenant_id)`,
-- so a page can only be made from a link of its own organisation, and
-- deleting that link forgets where the page came from and nothing else
-- (`SET NULL (made_from)`, which names the one column, as 0061's key does:
-- the plain form would set `tenant_id` to NULL too).
--
-- ## Row security needs nothing new
--
-- The new columns are on rows the tables' own policies already hold to their
-- organisation, and `link_sees_itself` (0034) reads the same rows as before.
-- Erasure purges both tables whole (`PURGED_TABLES`), these columns with
-- them. The appliance applies no managed migration and has neither table.
--
-- Personal data: a member's name and number, which they choose to show to the
-- people they send a link to. The privacy text says so with step B (workplan
-- 0176 §14, for the lawyer).

-- ---- The member's name and number.

ALTER TABLE public.tenant_member ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.tenant_member ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.tenant_member DROP CONSTRAINT IF EXISTS tenant_member_display_name_check;
ALTER TABLE public.tenant_member
    ADD CONSTRAINT tenant_member_display_name_check CHECK (
      display_name IS NULL OR (
        char_length(display_name) BETWEEN 1 AND 60
        AND display_name = btrim(display_name)
        AND display_name !~ '[[:cntrl:]]'
      )
    );

ALTER TABLE public.tenant_member DROP CONSTRAINT IF EXISTS tenant_member_phone_check;
ALTER TABLE public.tenant_member
    ADD CONSTRAINT tenant_member_phone_check CHECK (
      phone IS NULL OR (
        char_length(phone) <= 32
        AND phone ~ '^\+?[0-9 ()./-]+$'
        AND char_length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 6 AND 15
      )
    );

COMMENT ON COLUMN public.tenant_member.display_name IS
  'The member''s name as the people they send a person''s link to know them (workplan 0176 T3), written only by that member. Shown on that person''s pages as the sender. NULL: named by the sign-in address.';
COMMENT ON COLUMN public.tenant_member.phone IS
  'The member''s own number, shown on a person''s pages as a number to check (workplan 0176 T3, D11), written only by that member. NULL: the organisation''s number is shown, said as the organisation''s.';

-- ---- The grant link a progress link speaks for.

ALTER TABLE public.person_link DROP CONSTRAINT IF EXISTS person_link_id_tenant_key;
ALTER TABLE public.person_link
    ADD CONSTRAINT person_link_id_tenant_key UNIQUE (id, tenant_id);

ALTER TABLE public.person_link ADD COLUMN IF NOT EXISTS made_from uuid;

ALTER TABLE public.person_link DROP CONSTRAINT IF EXISTS person_link_made_from_fkey;
ALTER TABLE public.person_link
    ADD CONSTRAINT person_link_made_from_fkey FOREIGN KEY (made_from, tenant_id)
      REFERENCES public.person_link (id, tenant_id)
      ON DELETE SET NULL (made_from);

ALTER TABLE public.person_link DROP CONSTRAINT IF EXISTS person_link_made_from_check;
ALTER TABLE public.person_link
    ADD CONSTRAINT person_link_made_from_check CHECK (made_from IS NULL OR purpose = 'view');

COMMENT ON COLUMN public.person_link.made_from IS
  'For a progress link the ending handed over after a sign-in: the grant link it was signed in through, whose member the page names (workplan 0176 T6). NULL for every other link.';
