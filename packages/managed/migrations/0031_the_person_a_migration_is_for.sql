-- THE PERSON A MIGRATION IS FOR (ADR-0050, amended by the owner on 2026-09-28;
-- workplan 0153 T2).
--
-- The Migrations page lists people: one card per person being moved, with
-- their migrations under it (0153 T3). Somebody leaving Google for Soverin and
-- Nextcloud has two migrations or more, each with its own consent, progress
-- and Finish, and until this nothing said they were one person's.
--
-- ## A person is a row, and so is belonging to one
--
-- `person` is a name, and optionally an email address for grant links (0108),
-- in one organisation. `person_migration` says which person a migration is
-- for. `mailbox_mapping` gains no column: it is a core table every appliance
-- has, and a managed thing hanging off a core table becomes a row of its own
-- (hard rule 5). The appliance has no table here: it moves one person, and
-- answers the same API with one implicit person holding every migration it is
-- configured with.
--
-- A MIGRATION BELONGS TO AT MOST ONE PERSON: the migration is the key of
-- `person_migration`. One that belongs to nobody, which is every migration
-- made before this, shows on the page without a person.
--
-- A PERSON CHANGES NOTHING ABOUT A MIGRATION. The engine runs migrations, the
-- ledger keys items per migration, ADR-0014 bills paths, and none of them
-- reads these tables. Deleting a person deletes no migration: its rows here
-- go, and its migrations belong to nobody again. Deleting a migration takes
-- its row here with it, and leaves the person.
--
-- ## Both halves of a row belong to the same organisation
--
-- The person's half is a key: `(person_id, tenant_id)` references the
-- person's own `(id, tenant_id)`, so a row cannot name another organisation's
-- person, whoever writes it. The migration's half is the policy.
-- `mailbox_mapping` is a core table and gains no key for this, and a foreign
-- key is checked as the table's owner, past row security: the key below
-- proves the migration exists, and only the policy proves whose it is. So a
-- row may be written only for a migration of the organisation it is written
-- in.
--
-- ## Why the word is "person"
--
-- ADR-0050 called this a *move*. `/moves` already answers the queue of items a
-- source put somewhere else (§11.2) on the appliance, and the web app has a
-- page there. Asked, the owner chose "person / people" on 2026-09-28. On
-- screen the grouping still has no noun: a card carries the person's name
-- (0153 D6).
--
-- Personal data: a name, and an address when somebody gives one. Erasure
-- purges both tables (`PURGED_TABLES` in `offboarding.ts`).

CREATE TABLE public.person (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    display_name text NOT NULL,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT person_pkey PRIMARY KEY (id),
    -- What `person_migration`'s key points at: the person AND the organisation.
    CONSTRAINT person_id_tenant_key UNIQUE (id, tenant_id),
    CONSTRAINT person_tenant_id_fkey FOREIGN KEY (tenant_id)
      REFERENCES public.tenant(id) ON DELETE CASCADE,
    -- A name that titles a card: something, and not a page of text.
    CONSTRAINT person_display_name_length CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
    -- The API checks the address properly. This is the floor under it.
    CONSTRAINT person_email_shape CHECK (
      email IS NULL OR (length(email) <= 254 AND position('@' in email) > 1)
    )
);

-- The page lists an organisation's people, oldest first.
CREATE INDEX person_tenant_idx ON public.person USING btree (tenant_id, created_at);

CREATE TABLE public.person_migration (
    mapping_id uuid NOT NULL,
    person_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    -- At most one person per migration.
    CONSTRAINT person_migration_pkey PRIMARY KEY (mapping_id),
    -- Deleting a person deletes this row, and never the migration.
    CONSTRAINT person_migration_person_fkey FOREIGN KEY (person_id, tenant_id)
      REFERENCES public.person(id, tenant_id) ON DELETE CASCADE,
    -- Deleting a migration deletes this row, and never the person.
    CONSTRAINT person_migration_mapping_id_fkey FOREIGN KEY (mapping_id)
      REFERENCES public.mailbox_mapping(id) ON DELETE CASCADE,
    CONSTRAINT person_migration_tenant_id_fkey FOREIGN KEY (tenant_id)
      REFERENCES public.tenant(id) ON DELETE CASCADE
);

-- A person's migrations, and a person's delete.
CREATE INDEX person_migration_person_idx ON public.person_migration USING btree (person_id);

ALTER TABLE public.person ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.person FORCE ROW LEVEL SECURITY;
ALTER TABLE public.person_migration ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.person_migration FORCE ROW LEVEL SECURITY;

-- NULL-safe, as 0004 made the policies a subject-scoped read runs beside:
-- `''::uuid` raises, and an unset tenant must read as no rows.
CREATE POLICY tenant_isolation ON public.person
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- The migration's half, as the header says: a row names a migration of the
-- organisation it is written in. The subquery reads `mailbox_mapping` under
-- that table's own policy too, and names the tenant itself so that it holds
-- on a connection that policy does not bind.
CREATE POLICY tenant_isolation ON public.person_migration
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.mailbox_mapping m
       WHERE m.id = person_migration.mapping_id
         AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    )
  );

-- The request path reads and writes both: the Migrations page lists people,
-- and a member creates one, adds a migration to one, and deletes one.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.person TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.person_migration TO app_user;

COMMENT ON TABLE public.person IS
  'A person being moved: a name, and optionally an email address for grant links (ADR-0050, amended 2026-09-28: "person", because /moves is the moved-items queue). No state of its own: what a screen says about a person is their migrations'' states. Purged on erasure.';
COMMENT ON TABLE public.person_migration IS
  'Which person a migration is for. At most one per migration (the key). Deleting either side deletes only this row. Written only for a migration of the organisation it is written in (the policy).';
