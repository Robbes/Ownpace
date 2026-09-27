-- A tick that says it ran (workplan 0142 T2).
--
-- `managed-sync-tick` starts every scheduled sync pass, once a minute. When it
-- stops running, nothing says so: the status page's rows read the API and the
-- database, and both stay up. The first to notice is a tester whose migration
-- stopped moving. So the tick writes a beat at the end of every run it
-- completes, into this table, and the API's `GET /api/ready/scheduler` answers
-- `down` once the beat is older than five minutes.
--
-- One row per scheduled task, keyed by the task's id. The sync tick is the
-- first; the daily and hourly tasks can beat into the same table later without
-- another migration.
--
-- NO ROW-LEVEL SECURITY, deliberately, for the reasons `app_event` (ledger
-- 0059) gives, adapted:
--
--   * It is written by system-level code with no tenant context: the tick, over
--     the owner connection it already uses.
--   * It carries no personal data, by construction: a task's id, held to a
--     name's shape by the CHECK below, and a time.
--   * No customer can change it. `app_user` may SELECT and nothing else, so the
--     readiness route can read the beat and no request can forge one.

CREATE TABLE public.sync_tick_beat (
    task text NOT NULL PRIMARY KEY
        CONSTRAINT sync_tick_beat_task CHECK (task ~ '^[a-z][a-z0-9-]{0,63}$'),
    beat_at timestamp with time zone NOT NULL
);

-- Read-only for the application's role. The baseline's default privileges
-- would otherwise have given it INSERT, UPDATE and DELETE as well.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.sync_tick_beat FROM app_user;
GRANT SELECT ON TABLE public.sync_tick_beat TO app_user;

COMMENT ON TABLE public.sync_tick_beat IS
  'When each scheduled task last completed a run. Written by the task over the '
  'owner connection; read by GET /api/ready/scheduler. No personal data.';
