-- A VISIT BRINGS BACK THE HOUR (workplan 0157 T7; the owner, 2026-10-05:
-- "sync slow down once a migration is in step: yes").
--
-- A migration with no schedule of its own looks for changes every hour for 14
-- days, then every 6 hours, and once a day from 30 days on
-- (`automaticScheduleFor` in packages/orchestration/src/sync-due.ts). The days
-- count from when its first copy finished, or from the last visit, whichever is
-- later: opening the migration's page, or pressing *Sync now*. Somebody who
-- looks is somebody checking, and gets the hour back for 14 days.
--
-- ## A visit is a row, one per migration
--
-- `mailbox_mapping` gains no column: it is a core table every appliance has,
-- and a managed thing hanging off a core table becomes a row of its own (hard
-- rule 5). The appliance keeps its own schedules and has no table here. One row
-- per migration, its key, moved forward by each visit; never who visited. The
-- API moves it at most once an hour, so a page opened all day writes once an
-- hour.
--
-- Both halves belong to the same organisation, as `person_migration`'s do
-- (managed 0031): the key proves the migration exists, and the policy proves
-- whose it is. Deleting a migration deletes its row.
--
-- ## Who reads and writes it
--
-- The request path writes it (`app_user`). The sync tick reads it across
-- organisations as the system role (managed 0033), by the three columns it
-- needs, and the purge of a closed organisation deletes it by `tenant_id`
-- (`PURGED_TABLES` in offboarding.ts). No personal data: a time, keyed to a
-- migration.

CREATE TABLE public.migration_visit (
    mapping_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    visited_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT migration_visit_pkey PRIMARY KEY (mapping_id),
    -- Deleting a migration deletes its row.
    CONSTRAINT migration_visit_mapping_id_fkey FOREIGN KEY (mapping_id)
      REFERENCES public.mailbox_mapping(id) ON DELETE CASCADE,
    CONSTRAINT migration_visit_tenant_id_fkey FOREIGN KEY (tenant_id)
      REFERENCES public.tenant(id) ON DELETE CASCADE
);

-- The purge picks an organisation's rows by tenant.
CREATE INDEX migration_visit_tenant_idx ON public.migration_visit USING btree (tenant_id);

ALTER TABLE public.migration_visit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.migration_visit FORCE ROW LEVEL SECURITY;

-- NULL-safe, as 0004 made the policies: an unset tenant reads as no rows. A row
-- names a migration of the organisation it is written in, as 0031's does.
CREATE POLICY tenant_isolation ON public.migration_visit
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.mailbox_mapping m
       WHERE m.id = migration_visit.mapping_id
         AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    )
  );

-- The request path records a visit: an insert, or an update of the one row.
GRANT SELECT, INSERT, UPDATE ON public.migration_visit TO app_user;

-- The tick reads when each migration was last visited; the purge deletes an
-- organisation's rows by the column it picks them with.
GRANT SELECT (tenant_id, mapping_id, visited_at), DELETE ON TABLE public.migration_visit TO ownpace_system;

COMMENT ON TABLE public.migration_visit IS
  'When a migration was last visited: its page opened, or Sync now pressed (workplan 0157 T7). A migration with no schedule looks every hour for 14 days from the later of this and its first copy, then every 6 hours, then daily from 30 days. One row per migration; never who visited.';
