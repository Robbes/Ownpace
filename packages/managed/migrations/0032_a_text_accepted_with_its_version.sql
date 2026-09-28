-- A TEXT ACCEPTED WITH ITS VERSION (workplan 0139 T3; the owner's decision of
-- 2026-09-28, terms-acceptance-route (b), "Build the in-app screen first").
--
-- Terms §1, the Alpha conditions §2 and privacy §4.4 say: when you create your
-- account, the app shows you these texts, each with its version number, asks
-- you to accept them, and records which version of each you accepted, and
-- when. The owner: "People that are accepted in the Alpha do need to create a
-- login for the app, accepting fits in there and should record what
-- time/version the accepted of what document." This is that record.
--
-- ## One row per person, text and version
--
-- `subject` is the signed-in person as `tenant_member.user_id` holds them (the
-- identity provider's `sub`). `document` is one of the three texts, `version`
-- the number on its Version line, `language` the language the screen showed it
-- in, and `accepted_at` the time. A new version of a text is a new row, beside
-- the old one, which stays: the record of what somebody accepted is never
-- rewritten. Accepting the same version again adds nothing (the unique key),
-- so the first time is the one kept.
--
-- Per organisation, like every tenant-scoped row: a person in two
-- organisations accepts in each, and the rows go with the organisation.
--
-- ## Appended and read, never changed
--
-- `app_user` may INSERT and SELECT its own organisation's rows, and nothing
-- else. UPDATE and DELETE are REVOKED from the baseline's default grant (a
-- narrower GRANT alone would change nothing), and there is no UPDATE or DELETE
-- policy either, so a grant given back by mistake still meets row security
-- that lets nothing through. A row may only name a member of the organisation
-- it is written in. The one deleter is the erasure purge, through the owner
-- connection (`PURGED_TABLES` in `offboarding.ts`), because privacy §9 keeps
-- the account, and §4.4 puts this record in the account, until the data is
-- erased (0139 open question 4, the proposal until the owner answers).
--
-- Personal data: which versions a named person accepted, and when.

CREATE TABLE public.legal_acceptance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    subject text NOT NULL,
    document text NOT NULL,
    version text NOT NULL,
    language text NOT NULL,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT legal_acceptance_pkey PRIMARY KEY (id),
    -- Once per person, text and version: a second press adds nothing.
    CONSTRAINT legal_acceptance_once UNIQUE (tenant_id, subject, document, version),
    CONSTRAINT legal_acceptance_tenant_id_fkey FOREIGN KEY (tenant_id)
      REFERENCES public.tenant(id) ON DELETE CASCADE,
    -- The three texts a tester accepts (`LEGAL_DOCUMENTS`, legal-versions.ts).
    CONSTRAINT legal_acceptance_document_check CHECK (document IN ('alpha', 'privacy', 'terms')),
    -- The two languages the texts are published in.
    CONSTRAINT legal_acceptance_language_check CHECK (language IN ('nl', 'en')),
    -- A number, never a draft marker (`VERSION_SHAPE`, legal-versions.ts).
    CONSTRAINT legal_acceptance_version_shape CHECK (version ~ '^[0-9]+(\.[0-9]+)*$' AND length(version) <= 20),
    CONSTRAINT legal_acceptance_subject_length CHECK (length(subject) BETWEEN 1 AND 255)
);

-- "What has this person accepted here": the only question the app asks.
CREATE INDEX legal_acceptance_subject_idx ON public.legal_acceptance USING btree (tenant_id, subject);

ALTER TABLE public.legal_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.legal_acceptance FORCE ROW LEVEL SECURITY;

-- NULL-safe, as 0004 made the policies: `''::uuid` raises, and an unset tenant
-- must read as no rows.
CREATE POLICY tenant_isolation_select ON public.legal_acceptance FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- Written only in the organisation it is for, and only naming one of its
-- members. The subquery reads `tenant_member` under that table's own policy,
-- and names the tenant itself so that it holds on a connection that policy
-- does not bind.
CREATE POLICY tenant_isolation_insert ON public.legal_acceptance FOR INSERT
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.tenant_member m
       WHERE m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
         AND m.user_id = legal_acceptance.subject
    )
  );

GRANT SELECT, INSERT ON TABLE public.legal_acceptance TO app_user;
REVOKE UPDATE, DELETE ON TABLE public.legal_acceptance FROM app_user;

COMMENT ON TABLE public.legal_acceptance IS
  'Which version of the Alpha conditions, the privacy policy and the terms a person accepted, in which language, and when (workplan 0139 T3). Appended and read, never changed: a new version is a new row, and a repeat adds nothing. Purged on erasure with the organisation (PURGED_TABLES).';
