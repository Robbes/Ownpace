-- Binding an invitation to the person it was addressed to (workplan 0093 T6).
--
-- ## The gap this closes, which predates T6
--
-- `POST /api/tenants/:id/members` has been writing invitations since workplan
-- 0039: a `tenant_member` row with `status = 'invited'` and a `pending:<uuid>`
-- placeholder for `user_id`, because the invitee has no subject until they sign
-- in. Its comment says the placeholder "is replaced with the real user id on
-- acceptance".
--
-- Nothing ever replaced it. `authenticate` matches `status = 'active'` only, so
-- every invitation ever written was a row the invitee could not use. Granting an
-- access request (T6) creates exactly such a row — an owner for the new
-- organisation — so without this the privileged provisioning path provisions
-- something nobody can enter.
--
-- ## Why this is a policy and not a route that knows better
--
-- The dangerous version of this feature is "look up an invitation by email
-- address and hand it over". Email is not an identity: whoever can create an
-- account bearing an address would inherit whatever was invited to it.
--
-- So the claim is bounded from BOTH sides, in the database:
--
--   USING       — the row must be an open invitation addressed to the email in
--                 `app.current_email`, which `withSubject` sets only when the
--                 caller passed one, and `auth.ts` passes one only when the
--                 issuer asserted `email_verified: true`. An issuer that does
--                 not assert it gets no claim rather than a trusting one.
--   WITH CHECK  — the row it becomes must name THIS subject and be active.
--                 So a claim cannot be turned into "set somebody else's user_id",
--                 which is the same statement with a different SET clause.
--
-- Neither half is enough alone. USING without WITH CHECK would let a claimant
-- rewrite the row into anything; WITH CHECK without USING would let them rewrite
-- rows that were never theirs.
--
-- ## The empty string, again
--
-- Both settings are compared as TEXT with no cast, which is what keeps this safe
-- on a pooled connection where a previous transaction left them as `''` rather
-- than unset (migration 0004): `email = ''` and `user_id = ''` are false, never
-- true, and never an error. An invitation's email is NOT NULL, so there is no
-- row this could accidentally match.
--
-- ## What it deliberately does not do
--
-- It does not create the invitation, choose its role, or let anybody invite
-- themselves: INSERT on `tenant_member` is still only the tenant-scoped policy,
-- so a row has to have been written by somebody already inside the organisation
-- (or by granting an access request). This turns an invitation into a
-- membership; it never turns a stranger into one.

-- SELECT FIRST, AND IT IS NOT OPTIONAL. An UPDATE whose WHERE clause reads the
-- row has SELECT policies applied to it as well, so without this the claim below
-- matches nothing: the invitation carries a `pending:` user id and no tenant
-- scope, which makes it invisible to both existing SELECT policies, and an
-- invisible row cannot be updated. The claim silently no-ops — which is exactly
-- what `claim-invitation-under-rls.unit.test.ts` caught.
--
-- It is also the right thing on its own terms: an invitation addressed to an
-- address you have proven you hold is yours to see.
CREATE POLICY see_own_invitation ON public.tenant_member
  FOR SELECT USING (
    status = 'invited'
    AND email = current_setting('app.current_email'::text, true)
  );

CREATE POLICY claim_own_invitation ON public.tenant_member
  FOR UPDATE
  USING (
    status = 'invited'
    AND email = current_setting('app.current_email'::text, true)
  )
  WITH CHECK (
    status = 'active'
    AND user_id = current_setting('app.current_user'::text, true)
  );
