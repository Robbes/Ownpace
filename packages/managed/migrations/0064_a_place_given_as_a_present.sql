-- A PLACE GIVEN AS A PRESENT (workplan 0172; the owner, 2026-11-24, G1 and G3).
--
-- A person in the alpha may give one loved one a gift code. The code becomes
-- an access request marked as a gift from the giver, which the owner approves
-- like any other: a gift lets nobody in by itself. A gift is valid for two
-- years unless it is used or revoked first.
--
-- ## What a gift keeps, and what it never keeps
--
-- Who gave it (their subject, and the organisation they gave it from), a
-- fingerprint of the code, the card's language, its dates, and which access
-- request it became. NO column for the recipient: no address, no name, no
-- message. The recipient's own address lives in the access request they make
-- at the door, as every request's does (privacy §4.4). The code itself is
-- shown once and never stored, as a grant link's secret is (managed 0034).
-- `a-gift-that-keeps-no-recipient.unit.test.ts` reads this file's columns.
--
-- ## Who sees a gift
--
--  * The giver: their own, by `app.current_user`, to list, make and revoke.
--  * An operator: every gift, by `platform_operator`, as the access queue does
--    (managed 0005).
--  * The door, which is anonymous: exactly the row whose fingerprint is
--    `app.current_gift`, to read its state and spend it. Knowing a fingerprint
--    is knowing the code; nothing else reaches a row.
--
-- No policy casts a setting that can decay to '' (see `withSubject`), except
-- the tenant one, through NULLIF as every tenant policy here does.
--
-- ## The limit
--
-- `gift_rule` is one row: how many gifts each person may hold (1, G1).
-- `gift_allowance` is the operator's number for one person. Both are the
-- operator's to change without a deploy, and readable by the giver for their
-- own number.
--
-- ## The erasure
--
-- `gift` joins `PURGED_TABLES`, keyed by the giver's organisation, so closing
-- it erases the gifts made from it. The request a gift became is not the
-- giver's and stays; its mark goes with the gift.

CREATE TABLE public.gift (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    giver_user_id text NOT NULL,
    code_hash text NOT NULL,
    locale text DEFAULT 'en' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    redeemed_at timestamp with time zone,
    redeemed_request_id uuid,
    revoked_at timestamp with time zone,
    revoked_by text,
    CONSTRAINT gift_pkey PRIMARY KEY (id),
    CONSTRAINT gift_tenant_fkey FOREIGN KEY (tenant_id)
      REFERENCES public.tenant(id) ON DELETE CASCADE,
    CONSTRAINT gift_request_fkey FOREIGN KEY (redeemed_request_id)
      REFERENCES public.access_request(id) ON DELETE SET NULL,
    CONSTRAINT gift_code_hash_key UNIQUE (code_hash),
    CONSTRAINT gift_locale_check CHECK ((locale = ANY (ARRAY['en'::text, 'nl'::text]))),
    -- A request is named only by a redeemed gift. Not the other way round: the
    -- request may be pruned later (a declined one after 30 days), and the gift
    -- stays redeemed.
    CONSTRAINT gift_request_redeemed_check
      CHECK (((redeemed_request_id IS NULL) OR (redeemed_at IS NOT NULL))),
    -- Spent or switched off, never both.
    CONSTRAINT gift_one_ending_check
      CHECK (((redeemed_at IS NULL) OR (revoked_at IS NULL))),
    CONSTRAINT gift_revoked_by_check
      CHECK (((revoked_at IS NULL) = (revoked_by IS NULL)))
);

CREATE INDEX gift_giver_idx ON public.gift USING btree (giver_user_id, created_at DESC);
CREATE INDEX gift_request_idx ON public.gift USING btree (redeemed_request_id);
CREATE INDEX gift_tenant_idx ON public.gift USING btree (tenant_id);

ALTER TABLE public.gift ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.gift FORCE ROW LEVEL SECURITY;

CREATE POLICY giver_sees_own ON public.gift
  FOR SELECT USING (giver_user_id = current_setting('app.current_user'::text, true));
CREATE POLICY giver_gives ON public.gift
  FOR INSERT WITH CHECK (
    giver_user_id = current_setting('app.current_user'::text, true)
    AND tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid
  );
CREATE POLICY giver_revokes_own ON public.gift
  FOR UPDATE USING (giver_user_id = current_setting('app.current_user'::text, true))
  WITH CHECK (giver_user_id = current_setting('app.current_user'::text, true));

CREATE POLICY operator_sees_gifts ON public.gift
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.platform_operator
             WHERE user_id = current_setting('app.current_user'::text, true))
  );
CREATE POLICY operator_revokes_gifts ON public.gift
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.platform_operator
             WHERE user_id = current_setting('app.current_user'::text, true))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.platform_operator
             WHERE user_id = current_setting('app.current_user'::text, true))
  );

CREATE POLICY gift_sees_itself ON public.gift
  FOR SELECT USING (code_hash = current_setting('app.current_gift'::text, true));
CREATE POLICY gift_spends_itself ON public.gift
  FOR UPDATE USING (code_hash = current_setting('app.current_gift'::text, true))
  WITH CHECK (code_hash = current_setting('app.current_gift'::text, true));

GRANT SELECT, INSERT, UPDATE ON TABLE public.gift TO app_user;
REVOKE DELETE ON TABLE public.gift FROM app_user;

GRANT SELECT (tenant_id), DELETE ON TABLE public.gift TO ownpace_system;

COMMENT ON TABLE public.gift IS
  'A place in the alpha given as a present (workplan 0172). Shown once and kept as a fingerprint; valid two years; becomes an access request marked as a gift, which the owner approves. Keeps nothing about the recipient. Purged with the giver''s organisation.';
COMMENT ON COLUMN public.gift.code_hash IS
  'sha256 of the code as read (gift1:), never the code: a leaked table must not hand out places.';

CREATE TABLE public.gift_rule (
    id boolean DEFAULT true NOT NULL,
    gifts_per_person integer DEFAULT 1 NOT NULL,
    set_by text,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gift_rule_pkey PRIMARY KEY (id),
    CONSTRAINT gift_rule_one_row_check CHECK (id),
    CONSTRAINT gift_rule_range_check CHECK (((gifts_per_person >= 0) AND (gifts_per_person <= 20)))
);

INSERT INTO public.gift_rule (id, gifts_per_person) VALUES (true, 1);

ALTER TABLE public.gift_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.gift_rule FORCE ROW LEVEL SECURITY;

CREATE POLICY anyone_reads_the_rule ON public.gift_rule FOR SELECT USING (true);
CREATE POLICY operator_sets_the_rule ON public.gift_rule
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.platform_operator
             WHERE user_id = current_setting('app.current_user'::text, true))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.platform_operator
             WHERE user_id = current_setting('app.current_user'::text, true))
  );

-- INSERT too, as the request path holds on every table it reaches; no policy
-- lets anybody insert, and the one-row key would refuse a second row anyway.
GRANT SELECT, INSERT, UPDATE ON TABLE public.gift_rule TO app_user;
REVOKE DELETE ON TABLE public.gift_rule FROM app_user;

COMMENT ON TABLE public.gift_rule IS
  'How many gifts each person may hold (workplan 0172, G1: one while in alpha). One row; the operator changes it without a deploy.';

CREATE TABLE public.gift_allowance (
    user_id text NOT NULL,
    gifts integer NOT NULL,
    set_by text NOT NULL,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    CONSTRAINT gift_allowance_pkey PRIMARY KEY (user_id),
    CONSTRAINT gift_allowance_range_check CHECK (((gifts >= 0) AND (gifts <= 20)))
);

ALTER TABLE public.gift_allowance ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.gift_allowance FORCE ROW LEVEL SECURITY;

CREATE POLICY own_allowance ON public.gift_allowance
  FOR SELECT USING (user_id = current_setting('app.current_user'::text, true));
CREATE POLICY operator_sees_allowances ON public.gift_allowance
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.platform_operator
             WHERE user_id = current_setting('app.current_user'::text, true))
  );
CREATE POLICY operator_sets_allowances ON public.gift_allowance
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.platform_operator
             WHERE user_id = current_setting('app.current_user'::text, true))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.platform_operator
             WHERE user_id = current_setting('app.current_user'::text, true))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gift_allowance TO app_user;

COMMENT ON TABLE public.gift_allowance IS
  'The operator''s number of gifts for one person, by their subject (workplan 0172). Overrides gift_rule for them.';
