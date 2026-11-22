-- THE ADDRESSES THAT CHANGE (ADR-0055, accepted 2026-11-22; workplan 0168 T2,
-- §4.2).
--
-- A person leaving an address they cannot take along (`‹name›@gmail.com`,
-- `‹name›@outlook.com`) arrives at a new one, often with a family or a team.
-- This is the organisation's ONE table of those changes, old to new. Every
-- migration of the organisation reads the same rows, so Mum's card for her son
-- and the son's own events agree about his new address (0168 §4.3).
--
-- In the SHARED chain, because the appliance needs it too (0168 §7) and the
-- rows are about addresses, not customers. Which person a row is for is a
-- managed row of its own, `address_change_person` in the managed chain (hard
-- rule 5: a managed thing hanging off a core table is a row, never a column).
--
-- ## One row per old address
--
-- `old_key` is the address in the form it is matched by (`addressKey`,
-- `@openmig/shared`): lower case, and for Gmail only, dots and a `+suffix`
-- dropped and `googlemail.com` read as `gmail.com`. It is the row's identity
-- in the organisation, so two rows for one old address cannot exist
-- (`already_changed`). `old_address` and `new_address` are kept as they were
-- typed, for the screens.
--
-- That a new address is never an old one (`chained`, 0168 §1.2) is a rule over
-- two rows, and is held by the routes inside one transaction under the
-- organisation's own advisory lock, not by a constraint here.
--
-- ## Only a confirmed row reaches a writer
--
-- `proposed` is shown and applied to nothing; `confirmed` is applied. The
-- machine may propose and never confirms (ADR-0055 decision 1). A confirmed row
-- says who confirmed it and when, and a proposed one says neither: the CHECKs
-- below pin both. `set_by` and `confirmed_by` are the decision idiom
-- `share_grant.decided_by` and `setup_step.decided_by` use: the sign-in's
-- subject on managed, `operator` for the appliance's own page, and the file's
-- name for the appliance's `address-changes.json`. The routes say them as a
-- person can read them, never as an id.
--
-- Only adding: a new table, empty, which no pass reads until the writers do
-- (0168 T4). An empty table changes no byte of any copy (ADR-0055 decision 2).

CREATE TABLE public.address_change (
    tenant_id uuid NOT NULL,
    old_key text NOT NULL,
    old_address text NOT NULL,
    new_address text NOT NULL,
    state text DEFAULT 'proposed'::text NOT NULL,
    set_by text NOT NULL,
    confirmed_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone,
    CONSTRAINT address_change_pkey PRIMARY KEY (tenant_id, old_key),
    CONSTRAINT address_change_state_check CHECK ((state = ANY (ARRAY['proposed'::text, 'confirmed'::text]))),
    -- A confirmed row says when, and a proposed one does not.
    CONSTRAINT address_change_confirmed_at_check CHECK (((state = 'confirmed'::text) = (confirmed_at IS NOT NULL))),
    -- And who, exactly when it says when.
    CONSTRAINT address_change_confirmed_by_check CHECK (((confirmed_at IS NULL) = (confirmed_by IS NULL))),
    -- RFC 5321's path, as `person.email` is held to.
    CONSTRAINT address_change_old_address_check CHECK ((char_length(old_address) BETWEEN 3 AND 254)),
    CONSTRAINT address_change_new_address_check CHECK ((char_length(new_address) BETWEEN 3 AND 254)),
    CONSTRAINT address_change_old_key_check CHECK ((char_length(old_key) BETWEEN 3 AND 254)),
    CONSTRAINT address_change_tenant_id_fkey FOREIGN KEY (tenant_id)
      REFERENCES public.tenant(id) ON DELETE CASCADE
);

ALTER TABLE public.address_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.address_change FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.address_change FOR SELECT USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_insert ON public.address_change FOR INSERT WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_update ON public.address_change FOR UPDATE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
CREATE POLICY tenant_isolation_delete ON public.address_change FOR DELETE USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.address_change TO app_user;

COMMENT ON TABLE public.address_change IS
  'The organisation''s addresses that change, old to new (ADR-0055; workplan 0168 §4.2). One row per old address, by its matching key. Only confirmed rows reach a writer, which applies them to contacts'' EMAIL and calendar ORGANIZER/ATTENDEE, never to mail. Purged on erasure.';

COMMENT ON COLUMN public.address_change.old_key IS
  'The old address as it is matched (addressKey): lower case, and for Gmail only, dots and a +suffix dropped and googlemail.com read as gmail.com. The row''s identity in the organisation.';

COMMENT ON COLUMN public.address_change.set_by IS
  'Who added the row: a sign-in subject on managed, operator for the appliance''s page, the file''s name for address-changes.json. Said to a person in words, never as an id.';
