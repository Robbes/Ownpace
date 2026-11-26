-- A RECOMMENDATION THAT LETS ITS PERSON IN (workplan 0177 §5 and §20; the
-- owner, 2026-11-26, D6: "one needs to be allow in straight away"; D14 (a),
-- D15 (a); D16: "alpha limited to 50 people I let in, en 50 max someone
-- invites (each let in user 1 invite)"; and D18: "no, not in the alpha. Yes
-- after the alpha").
--
-- Until now a code became an open access request that the owner answered
-- (0065). Now a free code lets its person in at once, in one transaction: the
-- request granted by nobody, an organisation of their own, its owner's
-- invitation, and the code spent and pointing to the request. All of it or
-- none. No table is added.
--
-- ## The two ceilings (§20.2)
--
-- Two numbers on the rule's one row, beside the number each person may give:
-- the most people the owner lets in, and the most people let in by a
-- recommendation. 50 each unless the owner changes them, on the operator's
-- Gifts screen. A number may be set under what is already counted: nobody is
-- taken out, and nobody new comes in until the count is under it again.
-- Nothing keeps a running total; every count is read from the requests and
-- the cards at the moment it is needed (§20.1). Nothing here refuses the
-- owner's own yes past the first number: the owner keeps count (D17), and
-- the operator's screens show it.
--
-- ## The plain door asks, and only asks
--
-- `anyone_may_ask` (0002) let any session insert a request in any state, a
-- granted one naming any organisation included. Nothing wrote one, but the
-- counts now read granted requests, and a code's session must be able to
-- write none of it by hand (§14). So it may insert an open request, as the
-- plain form does, and nothing else; a granted one is written only by the
-- function below, and by the operator's grant, which updates an open one.
--
-- ## The one function, and why it is a function
--
-- `let_in_by_a_recommendation` is everything a session that is not the
-- operator's may learn or do across rows about a recommendation:
--
--   * A session that holds an unused code (`app.current_gift`, the fingerprint
--     `withGiftCode` sets) and gives no address learns a word: `room`, or
--     `full` when the people let in by a recommendation fill the second
--     number. That is the door's check, and it writes nothing.
--   * The same session with an address is let in: `let_in`, with the request,
--     the organisation's id and name, and the address as the request holds
--     it. Or `full`; or `already_in` when the address already has access, a
--     membership that is active, invited or suspended; or `refused`. Only
--     `let_in` writes, and it writes once: behind the Alpha's one lock, with
--     the gift's row locked and spent in the same transaction.
--   * A member's own session and no code (`app.current_user` an active member
--     of `app.current_tenant`, as `withSubjectAndTenant` sets them) learns two
--     yes-or-nos about its own organisation and nobody else's: whether a new
--     card has room, the people let in by a recommendation and the cards not
--     used yet counted together (§20.3, rule 1), as `room` or `full`; and
--     whether its organisation was made by a request a card points to
--     (`by_recommendation`, D18 and §20.7), for during the Alpha only the
--     people the owner let in may recommend. Which stage it is the caller
--     knows, not the database. The caller takes the Alpha's lock first when
--     it then makes a card.
--   * Anybody else, and a used, withdrawn, expired or unknown code, is
--     `refused`, and learns nothing else.
--
-- Policies could not do this without lending a code's session other people's
-- rows: granting the waiting request of an address (D15 (a)) needs that
-- request found and read, and telling an address that already has access
-- needs every organisation's members read. A function reads them as its
-- owner and answers a word, never a row and never a number (§20.3, rule 4).
-- The managed edition's owner is a superuser (docs/rls-guide.md §2), so the
-- function reads past the policies; it is written to touch only the rows it
-- names. EXECUTE is `app_user`'s alone: PUBLIC's default is revoked, so the
-- system role may run no SECURITY DEFINER function
-- (a-system-role-that-is-not-the-owner.integration.test.ts), and the search
-- path is fixed so nothing a caller makes can stand in for what it calls.
--
-- ## What it writes, as a grant writes it (§3.6)
--
--  * The request: the waiting one of the address if there is one (D15 (a)),
--    keeping what the person wrote in it; else a new one, written open and
--    then granted, so that a request from the same address in the same moment
--    meets `ux_access_request_one_open_per_email`, and the door tries once
--    more and grants that one. Granted with `decided_by` NULL: nobody decided.
--  * A yes to the question about Google (D14 (a)) is one fixed English line
--    in its note, under a note the person wrote earlier. A no writes nothing.
--  * The organisation, named after the organisation the person named, else
--    their name, else the name typed at the door, else the address.
--  * Its owner's invitation: `pending:` and a fresh id, the request's
--    address, `owner`, `invited`, `requested`, bound on the first sign-in
--    with an address the sign-in service verified (0006, 0021).
--  * The code, spent, pointing to the request.

ALTER TABLE public.gift_rule
    ADD COLUMN IF NOT EXISTS owner_ceiling integer DEFAULT 50 NOT NULL,
    ADD COLUMN IF NOT EXISTS recommendation_ceiling integer DEFAULT 50 NOT NULL;

ALTER TABLE public.gift_rule DROP CONSTRAINT IF EXISTS gift_rule_owner_ceiling_check;
ALTER TABLE public.gift_rule
    ADD CONSTRAINT gift_rule_owner_ceiling_check CHECK ((owner_ceiling >= 0));
ALTER TABLE public.gift_rule DROP CONSTRAINT IF EXISTS gift_rule_recommendation_ceiling_check;
ALTER TABLE public.gift_rule
    ADD CONSTRAINT gift_rule_recommendation_ceiling_check CHECK ((recommendation_ceiling >= 0));

COMMENT ON COLUMN public.gift_rule.owner_ceiling IS
  'The most people the owner lets in during the Alpha: granted requests that no card points to (workplan 0177 §20). Shown; whether it refuses a grant is the owner''s D17.';
COMMENT ON COLUMN public.gift_rule.recommendation_ceiling IS
  'The most people let in by a recommendation during the Alpha: requests a card points to, granted or waiting (workplan 0177 §20). At it the door lets nobody in, and with the cards not used yet it stops a new card.';

DROP POLICY IF EXISTS anyone_may_ask ON public.access_request;
CREATE POLICY anyone_may_ask ON public.access_request
  FOR INSERT WITH CHECK (state = 'open' AND decided_by IS NULL AND decision_note IS NULL);

CREATE OR REPLACE FUNCTION public.let_in_by_a_recommendation(
    p_email text,
    p_name text,
    p_locale text,
    p_google boolean
) RETURNS TABLE (answer text, request_id uuid, tenant_id uuid, organisation text, email text, by_recommendation boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_code       text := NULLIF(current_setting('app.current_gift', true), '');
  v_user       text := NULLIF(current_setting('app.current_user', true), '');
  v_own        text := NULLIF(current_setting('app.current_tenant', true), '');
  v_email      text := NULLIF(btrim(p_email), '');
  v_typed      text := NULLIF(btrim(p_name), '');
  v_gift       uuid;
  v_ceiling    integer;
  v_in         integer;
  v_cards      integer;
  v_request    uuid;
  v_found      uuid;
  v_asked_as   text;
  v_their_name text;
  v_their_org  text;
  v_tenant     uuid;
  v_name       text;
  v_constraint text;
BEGIN
  SELECT r.recommendation_ceiling INTO v_ceiling FROM public.gift_rule r;
  v_ceiling := COALESCE(v_ceiling, 0);
  -- The people let in by a recommendation (§20.1): requests a card points
  -- to, granted or still waiting. A declined one and an erased one do not count.
  SELECT count(*) INTO v_in
    FROM public.access_request r
   WHERE r.state IN ('open', 'granted')
     AND EXISTS (SELECT 1 FROM public.gift g WHERE g.redeemed_request_id = r.id);

  -- No code: a member's own session may ask about its own organisation.
  -- Compared as text: a setting that is not an id names no organisation.
  IF v_code IS NULL THEN
    IF v_email IS NOT NULL OR v_user IS NULL OR v_own IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.tenant_member m
       WHERE m.user_id = v_user AND m.tenant_id::text = v_own AND m.status = 'active'
    ) THEN
      answer := 'refused';
      RETURN NEXT;
      RETURN;
    END IF;
    SELECT count(*) INTO v_cards
      FROM public.gift g
     WHERE g.redeemed_at IS NULL AND g.revoked_at IS NULL AND g.expires_at > now();
    answer := CASE WHEN v_in + v_cards < v_ceiling THEN 'room' ELSE 'full' END;
    by_recommendation := EXISTS (
      SELECT 1 FROM public.access_request r
       WHERE r.tenant_id::text = v_own AND r.state = 'granted'
         AND EXISTS (SELECT 1 FROM public.gift g WHERE g.redeemed_request_id = r.id)
    );
    RETURN NEXT;
    RETURN;
  END IF;

  -- A code, while it is unused. Letting in takes the Alpha's one lock first,
  -- then the gift's row, and counts again behind them.
  IF v_email IS NULL THEN
    SELECT g.id INTO v_gift
      FROM public.gift g
     WHERE g.code_hash = v_code AND g.redeemed_at IS NULL AND g.revoked_at IS NULL AND g.expires_at > now();
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('alpha:recommendations', 0));
    SELECT g.id INTO v_gift
      FROM public.gift g
     WHERE g.code_hash = v_code AND g.redeemed_at IS NULL AND g.revoked_at IS NULL AND g.expires_at > now()
       FOR UPDATE;
    SELECT count(*) INTO v_in
      FROM public.access_request r
     WHERE r.state IN ('open', 'granted')
       AND EXISTS (SELECT 1 FROM public.gift g WHERE g.redeemed_request_id = r.id);
  END IF;
  IF v_gift IS NULL THEN
    answer := 'refused';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_in >= v_ceiling THEN
    answer := 'full';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_email IS NULL THEN
    answer := 'room';
    RETURN NEXT;
    RETURN;
  END IF;

  -- An address that already has access gets no second organisation (§5).
  IF EXISTS (
    SELECT 1 FROM public.tenant_member m
     WHERE lower(btrim(m.email)) = lower(v_email) AND m.status NOT IN ('removed', 'declined')
  ) THEN
    answer := 'already_in';
    RETURN NEXT;
    RETURN;
  END IF;

  -- The request: the address's waiting one (D15 (a)), or a new one.
  SELECT r.id, r.email, r.name, r.organisation INTO v_found, v_asked_as, v_their_name, v_their_org
    FROM public.access_request r
   WHERE r.state = 'open' AND lower(btrim(r.email)) = lower(v_email)
     FOR UPDATE;
  IF v_found IS NULL THEN
    BEGIN
      v_request := gen_random_uuid();
      INSERT INTO public.access_request (id, email, name, locale)
      VALUES (v_request, v_email, v_typed, COALESCE(p_locale, 'en'));
      v_asked_as := v_email;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint IS DISTINCT FROM 'ux_access_request_one_open_per_email' THEN
        RAISE;
      END IF;
      -- One arrived from the same address in the same moment: that one is granted.
      SELECT r.id, r.email, r.name, r.organisation INTO v_found, v_asked_as, v_their_name, v_their_org
        FROM public.access_request r
       WHERE r.state = 'open' AND lower(btrim(r.email)) = lower(v_email)
         FOR UPDATE;
      IF v_found IS NULL THEN
        RAISE;
      END IF;
    END;
  END IF;
  IF v_found IS NOT NULL THEN
    v_request := v_found;
  END IF;

  v_name := COALESCE(NULLIF(btrim(v_their_org), ''), NULLIF(btrim(v_their_name), ''), v_typed, v_asked_as);
  v_tenant := gen_random_uuid();
  INSERT INTO public.tenant (id, name, status, settings) VALUES (v_tenant, v_name, 'active', '{}'::jsonb);
  INSERT INTO public.tenant_member (tenant_id, user_id, email, role, status, origin, invited_at)
  VALUES (v_tenant, 'pending:' || gen_random_uuid()::text, v_asked_as, 'owner', 'invited', 'requested', now());
  UPDATE public.access_request r
     SET state = 'granted',
         tenant_id = v_tenant,
         decided_by = NULL,
         decided_at = now(),
         note = CASE
                  WHEN p_google THEN concat_ws(E'\n\n', NULLIF(r.note, ''),
                                               'Said at the door: this address is a Google account to move.')
                  ELSE r.note
                END
   WHERE r.id = v_request;
  UPDATE public.gift g
     SET redeemed_at = now(), redeemed_request_id = v_request
   WHERE g.id = v_gift AND g.redeemed_at IS NULL AND g.revoked_at IS NULL;
  IF NOT FOUND THEN
    -- The row is locked above, so this cannot happen; if it ever does, nothing stays.
    RAISE EXCEPTION 'gift %: spent while it was being used (workplan 0177 §5)', v_gift;
  END IF;

  answer := 'let_in';
  request_id := v_request;
  tenant_id := v_tenant;
  organisation := v_name;
  email := v_asked_as;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.let_in_by_a_recommendation(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.let_in_by_a_recommendation(text, text, text, boolean) TO app_user;

COMMENT ON FUNCTION public.let_in_by_a_recommendation(text, text, text, boolean) IS
  'Workplan 0177 §5 and §20: with an unused code in app.current_gift, room or full (no address), or let_in, full, already_in (an address); with no code, for an active member of app.current_tenant, whether a new card has room and whether a card''s request made that organisation (D18); refused for anybody else. A word or a yes, never a row and never a number. Writes only on let_in, once, behind the Alpha''s one lock.';
