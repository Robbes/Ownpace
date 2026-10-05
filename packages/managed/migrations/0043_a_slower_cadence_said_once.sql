-- A SLOWER CADENCE, SAID ONCE (workplan 0157 T7; the owner, 2026-10-05:
-- "sync slow down once a migration is in step: yes", with each step "said in
-- the app and by email").
--
-- A migration with no schedule of its own looks for changes every hour for 14
-- days, then every 6 hours, and once a day from 30 days on, counted from when
-- its first copy finished or its last visit, whichever is later (managed 0042,
-- `automaticScheduleFor` in packages/orchestration/src/sync-due.ts). A step
-- down is news to whoever runs the migration: *"Everything is in step. We now
-- look every 6 hours; choose more often any time."*
--
-- ## A step said is a row, one per migration
--
-- The morning job (`managed-cadence-email.ts`) claims a row before it mails,
-- so each step is said once, however often the job runs: the step, and what its
-- days counted from. A later step, or the same step counted from a later
-- moment, is news again; the same one is not. A row stands while its step is
-- in force: a visit deletes it, as the visit brings back the hour, and its
-- answer is what the migration's page says (*"Everything was in step, so we
-- looked every 6 hours. …"*). The job deletes one whose step is no longer in
-- force too.
--
-- `mailbox_mapping` gains no column: a managed thing hanging off a core table
-- becomes a row of its own (hard rule 5). The appliance keeps its own
-- schedules and has no table here.
--
-- ## Who reads and writes it
--
-- The morning job and the request path, each in the organisation's own scope
-- (`app_user`), and the purge of a closed organisation, by `tenant_id`
-- (`PURGED_TABLES` in offboarding.ts). No personal data: a step and two times,
-- keyed to a migration.

CREATE TABLE public.migration_cadence_said (
    mapping_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    -- The step said: `AutomaticStep` in sync-due.ts, never the hourly one,
    -- which is no news.
    step text NOT NULL,
    -- What the step's days counted from when it was said (`automaticSince`).
    counted_from timestamp with time zone NOT NULL,
    said_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT migration_cadence_said_pkey PRIMARY KEY (mapping_id),
    CONSTRAINT migration_cadence_said_step_check CHECK (step IN ('six-hourly', 'daily')),
    -- Deleting a migration deletes its row.
    CONSTRAINT migration_cadence_said_mapping_id_fkey FOREIGN KEY (mapping_id)
      REFERENCES public.mailbox_mapping(id) ON DELETE CASCADE,
    CONSTRAINT migration_cadence_said_tenant_id_fkey FOREIGN KEY (tenant_id)
      REFERENCES public.tenant(id) ON DELETE CASCADE
);

-- The job and the purge pick an organisation's rows by tenant.
CREATE INDEX migration_cadence_said_tenant_idx ON public.migration_cadence_said USING btree (tenant_id);

ALTER TABLE public.migration_cadence_said ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.migration_cadence_said FORCE ROW LEVEL SECURITY;

-- NULL-safe, as 0004 made the policies: an unset tenant reads as no rows. A row
-- names a migration of the organisation it is written in, as 0042's does.
CREATE POLICY tenant_isolation ON public.migration_cadence_said
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM public.mailbox_mapping m
       WHERE m.id = migration_cadence_said.mapping_id
         AND m.tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
    )
  );

-- The job claims a step (an insert, or an update of the one row) and deletes
-- one no longer in force; a visit deletes it.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.migration_cadence_said TO app_user;

-- The purge deletes an organisation's rows by the column it picks them with.
GRANT SELECT (tenant_id), DELETE ON TABLE public.migration_cadence_said TO ownpace_system;

COMMENT ON TABLE public.migration_cadence_said IS
  'The slower step of a migration''s automatic cadence, once said by email (workplan 0157 T7): every 6 hours, or daily, and what its days counted from. Claimed before the mail, so each step is said once; deleted by a visit, which brings back the hour.';
