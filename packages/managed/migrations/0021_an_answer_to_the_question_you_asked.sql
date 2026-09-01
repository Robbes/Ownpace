-- The answer to a question you asked is not an invitation (owner decision,
-- 2026-09-01).
--
-- The owner walked the whole path tonight — asked for access from
-- rhberentsen@gmail.com, granted it as operator, signed in with Google — and
-- met a screen headed "You have been invited", with Join / Decline / Not now
-- and the sentence "Joining is your choice. Nothing happens until you make
-- it.". His words: *"weird to again need to accept the join after I myself
-- requested the invite, and I got granted with it… over the top if you ask
-- me."*
--
-- He is right, and the reason is that ONE COLUMN WAS MISSING. Two different
-- events were writing the same row:
--
--   * `members.ts` — somebody already inside an organisation adds YOUR address
--     to THEIR organisation. You were not asked. Workplan 0099 made that a
--     question precisely because the old code bound it silently, and being
--     joined to a stranger's organisation by reading your own account is a
--     real defect. That decision stands, entirely.
--
--   * `access-requests.ts` grant — you asked for an organisation, a human
--     operator read the ask and said yes, and the organisation was created FOR
--     YOU with you as its only owner. Nobody pulled you anywhere. Asking "do
--     you want to join the thing you asked for?" is asking the same question
--     twice, and the second time in somebody else's words.
--
-- `tenant_member` could not tell them apart: both wrote `status = 'invited'`
-- with a `pending:` user id, so both surfaced as invitations. This records
-- WHERE THE ROW CAME FROM, which is the fact the screen needed and did not
-- have.
--
-- ## What it does NOT change
--
-- Not the policies. Migration 0006's `claim_own_invitation` already governs
-- binding — open invitation to `app.current_email`, result must be active and
-- name this subject — and a `requested` row satisfies it exactly as an
-- `invited` one does. This column narrows a STATEMENT; it grants nothing, and
-- `origin` is never written by the claim.
--
-- Not the verified-email requirement. A row is still bound only against an
-- address the issuer says it verified. Email is not identity, and a grant to
-- an address does not become somebody's organisation because they typed it.
--
-- ## The default is 'invited', which is the safe direction
--
-- A row whose origin nobody recorded is treated as somebody else's invitation
-- and still asks. Getting this wrong the other way would auto-join people to
-- organisations they never asked for, which is the 0099 defect returning by
-- the back door.
--
-- ## And the rows that already exist
--
-- Backfilled from `access_request`, which is where the fact actually lives: a
-- granted request names the tenant it created and the address it was granted
-- to. `lower(btrim(...))` because that is already how this system decides two
-- addresses are the same person (0020's index, `auth.ts`'s comparison), not a
-- third rule invented here. A membership with no granted request behind it
-- keeps the default and keeps asking, which is correct: it was an invitation.

ALTER TABLE public.tenant_member
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'invited';

-- Dropped first so a re-run reaches the same constraint rather than failing on
-- one that already exists (hard rule 1 — a migration converges).
ALTER TABLE public.tenant_member
  DROP CONSTRAINT IF EXISTS ck_tenant_member_origin;
ALTER TABLE public.tenant_member
  ADD CONSTRAINT ck_tenant_member_origin CHECK (origin IN ('invited', 'requested'));

UPDATE public.tenant_member m
   SET origin = 'requested'
  FROM public.access_request r
 WHERE r.tenant_id = m.tenant_id
   AND r.state = 'granted'
   AND lower(btrim(r.email)) = lower(btrim(m.email))
   AND m.origin <> 'requested';

COMMENT ON COLUMN public.tenant_member.origin IS
  'Where this membership came from: ''invited'' (somebody added this address to their organisation — 0099 says ask) or ''requested'' (this address asked for an organisation and an operator granted it — asking again is asking twice).';
