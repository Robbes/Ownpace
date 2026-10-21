-- An invitation binds to the signed-in address whatever its case or spaces
-- (workplan 0156 §3, its "Not done").
--
-- ## What was wrong
--
-- The five policies that let a person see, claim and answer an invitation
-- (migrations 0006 and 0008) compared the address EXACTLY:
--
--   email = current_setting('app.current_email', true)
--
-- So an organisation granted to `Jan@Example.nl`, or an invitation typed that
-- way on the Team page, never bound for somebody whose identity provider
-- verified `jan@example.nl`. They saw no invitation, the organisation stayed
-- `invited`, and nothing told them or the operator why. It is the Alpha's
-- front door: Microsoft sign-in often hands over an address with capitals,
-- and the request form gets whatever the tester typed.
--
-- ## The rule, and whose it is
--
-- `lower(btrim(...))` on both sides, because that is already how this system
-- decides two addresses are one person: 0020's index on `access_request`,
-- 0021's backfill of `origin`, `auth.ts`'s `labelsToUpdate`, and the access
-- queue's check for an address that already owns an organisation. This
-- follows that rule rather than adding another. Addresses are still STORED as
-- they were typed (trimmed); only the comparison changes.
--
-- ## An empty setting matches nothing
--
-- `app.current_email` is set only when the issuer asserted
-- `email_verified: true` (`auth.ts`, `withSubject`), and on a pooled connection
-- an earlier transaction leaves it as `''` rather than unset (migration 0004).
-- The exact comparison was safe on `''` because no row carries an empty
-- address. Trimming both sides would make `''` equal an address of spaces, so
-- the setting goes through `NULLIF(btrim(...), '')` first: an empty or blank
-- setting is NULL, and `= NULL` is never true. Still TEXT with no cast, so it
-- is never an error either.
--
-- ## What does not change
--
-- Every other clause, word for word: the status each policy requires, the
-- WITH CHECK that a claim must make the row active and name THIS subject, the
-- WITH CHECK that a decline must leave `user_id` a `pending:` placeholder, and
-- the decline's pin on the address. That pin now reads in any case too, or a
-- decline matched in another case would fail its own check. It still refuses
-- another person's address on the way through; what it allows is the same
-- address in another case, which by the rule above is the same person.
--
-- The verified-address requirement is untouched: no setting, no row.
--
-- ## Converging
--
-- Each policy is dropped if it exists and created again, so a re-run reaches
-- the same five policies (hard rule 1), as migration 0004 does for the
-- tenant policies on this table.

DROP POLICY IF EXISTS see_own_invitation ON public.tenant_member;
CREATE POLICY see_own_invitation ON public.tenant_member
  FOR SELECT USING (
    status = 'invited'
    AND lower(btrim(email)) = lower(NULLIF(btrim(current_setting('app.current_email'::text, true)), ''))
  );

DROP POLICY IF EXISTS claim_own_invitation ON public.tenant_member;
CREATE POLICY claim_own_invitation ON public.tenant_member
  FOR UPDATE
  USING (
    status = 'invited'
    AND lower(btrim(email)) = lower(NULLIF(btrim(current_setting('app.current_email'::text, true)), ''))
  )
  WITH CHECK (
    status = 'active'
    AND user_id = current_setting('app.current_user'::text, true)
  );

DROP POLICY IF EXISTS see_own_answered_invitation ON public.tenant_member;
CREATE POLICY see_own_answered_invitation ON public.tenant_member
  FOR SELECT USING (
    status = 'declined'
    AND lower(btrim(email)) = lower(NULLIF(btrim(current_setting('app.current_email'::text, true)), ''))
  );

DROP POLICY IF EXISTS decline_own_invitation ON public.tenant_member;
CREATE POLICY decline_own_invitation ON public.tenant_member
  FOR UPDATE
  USING (
    status = 'invited'
    AND lower(btrim(email)) = lower(NULLIF(btrim(current_setting('app.current_email'::text, true)), ''))
  )
  WITH CHECK (
    status = 'declined'
    AND lower(btrim(email)) = lower(NULLIF(btrim(current_setting('app.current_email'::text, true)), ''))
    -- Unchanged from 0008, and still the load-bearing half: a decline cannot
    -- write a real subject into the row, which would block that person from
    -- ever joining this organisation.
    AND user_id LIKE 'pending:%'
  );

DROP POLICY IF EXISTS see_tenant_you_were_invited_to ON public.tenant;
CREATE POLICY see_tenant_you_were_invited_to ON public.tenant
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.tenant_member m
      WHERE m.tenant_id = tenant.id
        AND m.status = 'invited'
        AND lower(btrim(m.email)) = lower(NULLIF(btrim(current_setting('app.current_email'::text, true)), ''))
    )
  );
