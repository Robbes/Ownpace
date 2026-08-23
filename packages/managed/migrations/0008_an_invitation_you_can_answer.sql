-- An invitation you can answer: accept, decline, or leave it (workplan 0099).
--
-- ## What this changes about a decision already made
--
-- Migration 0006 made an invitation CLAIMABLE, and `claimInvitations` claimed
-- every one of them silently on first sign-in. That was right for what existed
-- then — the only invitations were ones an operator had just granted, and the
-- email said so — but it means nobody was ever ASKED. There was no way to say
-- no to an organisation, and a person signing in for one reason could find
-- themselves a member of something they had never agreed to join.
--
-- Saying no needs somewhere to be recorded, which is what this migration adds.
--
-- ## Three answers, and only two of them are writes
--
--   accept   status 'invited' -> 'active', user_id becomes the real subject.
--            Migration 0006's `claim_own_invitation` already does exactly this
--            and is unchanged.
--   decline  status 'invited' -> 'declined'. New, below.
--   skip     NOTHING HAPPENS. The row stays 'invited' and is offered again next
--            time. Deliberately not a state: "I have not decided" is the
--            absence of a decision, and writing it down would turn a deferral
--            into a record somebody has to reason about later.
--
-- ## Declining does NOT bind the subject
--
-- The obvious implementation sets `user_id` to the decliner the way accepting
-- does. It must not. That would write a permanent link between a person and an
-- organisation they refused to join — into a table an operator can read — which
-- is the opposite of what declining means. The row keeps its `pending:` id, and
-- what it records is that THE ADDRESS was invited and said no.
--
-- The WITH CHECK enforces that rather than trusting the route, and it is the
-- half that matters:
--
--   * `user_id LIKE 'pending:%'` — a decline cannot write a real subject into
--     the row. Without it, `SET status='declined', user_id='<somebody else>'`
--     is the same statement, and `tenant_member` is unique per (tenant, user),
--     so it would let anybody permanently BLOCK a chosen person from ever
--     joining a chosen organisation. A denial of service written as a refusal.
--   * `email = current_setting(...)` — the address cannot be rewritten on the
--     way through, which would otherwise decline on somebody else's behalf.
--
-- USING is the same bound as 0006: an OPEN invitation addressed to the email in
-- `app.current_email`, which `auth.ts` sets only when the issuer asserted
-- `email_verified: true`. Email is not identity; a verified email is a claim
-- the issuer is willing to stand behind.
--
-- ## Reading the organisation that invited you
--
-- A person deciding needs its name, and an invitee has no membership and so no
-- tenant scope — `tenant_isolation_select` matches nothing for them (and, until
-- ledger 0028, RAISED). So they get a policy of their own, bounded by the
-- invitation itself: you may read a tenant that has an open invitation out to
-- your verified address, and nothing else about it beyond what `tenant` holds.
--
-- It lives in the managed chain because it references `tenant_member`, which is
-- managed-only (0001). The appliance has no such table and no such policy.

-- 'declined' joins the states this column may hold. Guarded so re-running is a
-- no-op, and the constraint is REPLACED rather than dropped-and-left: a table
-- briefly without its check is a table that will accept anything.
DO $$
BEGIN
  ALTER TABLE public.tenant_member DROP CONSTRAINT IF EXISTS tenant_member_status_check;
  ALTER TABLE public.tenant_member ADD CONSTRAINT tenant_member_status_check
    CHECK (status = ANY (ARRAY['active'::text, 'invited'::text, 'declined'::text,
                               'suspended'::text, 'removed'::text]));
END
$$;

-- THE NEW ROW HAS TO BE VISIBLE TOO, and this is the whole difficulty.
--
-- Migration 0006 records that an UPDATE whose WHERE clause reads the row has
-- SELECT policies applied to it as well, and that the claim silently no-opped
-- until `see_own_invitation` existed. This is that lesson one step further, and
-- it fails LOUDLY rather than silently: the SELECT policies must also admit the
-- row the update PRODUCES, not just the one it started from.
--
-- Accepting never noticed. Its new row carries `user_id = <this subject>`, which
-- `own_membership_select` (migration 0003) matches — so the destination was
-- visible by accident of what accepting writes.
--
-- Declining produces `status = 'declined'` with the `pending:` id still on it.
-- That row matches `see_own_invitation` (no — it is no longer 'invited'),
-- `own_membership_select` (no — the id is not this subject) and
-- `tenant_isolation_select` (no — there is no tenant scope). Invisible. So the
-- update was refused with `new row violates row-level security policy`, from
-- `ExecWithCheckOptions`, with a WITH CHECK that was verifiably true.
--
-- The refusal is right, and the missing policy is right on its own terms: you
-- may see the answer you gave. Without it, declining would be an act whose
-- result you are not allowed to look at.
CREATE POLICY see_own_answered_invitation ON public.tenant_member
  FOR SELECT USING (
    status = 'declined'
    AND email = current_setting('app.current_email'::text, true)
  );

-- Declining, bounded from both sides. `claim_own_invitation` (0006) is left
-- exactly as it is: accepting was never the problem, and rewriting a working
-- policy to sit beside a new one is how a rule that works becomes two rules
-- that nearly agree.
--
-- USING is the same bound as the claim: an OPEN invitation addressed to the
-- address in `app.current_email`, which `auth.ts` sets only when the issuer
-- asserted `email_verified: true`.
CREATE POLICY decline_own_invitation ON public.tenant_member
  FOR UPDATE
  USING (
    status = 'invited'
    AND email = current_setting('app.current_email'::text, true)
  )
  WITH CHECK (
    status = 'declined'
    AND email = current_setting('app.current_email'::text, true)
    -- The load-bearing half. Without it, `SET status='declined',
    -- user_id='<victim>'` is the same statement — and membership is unique per
    -- (organisation, subject), so it would permanently block a chosen person
    -- from ever joining a chosen organisation. A denial of service written as a
    -- refusal. Pinning `email` stops the address being rewritten on the way
    -- through, which would otherwise decline on somebody else's behalf.
    AND user_id LIKE 'pending:%'
  );

CREATE POLICY see_tenant_you_were_invited_to ON public.tenant
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tenant_member m
      WHERE m.tenant_id = tenant.id
        AND m.status = 'invited'
        AND m.email = current_setting('app.current_email'::text, true)
    )
  );
