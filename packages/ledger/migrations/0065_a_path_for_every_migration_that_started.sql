-- A path row for every migration that has started (workplan 0128 T5, slice 2a).
--
-- `path_lifecycle` (0035) holds each data type's phase, and only the managed
-- API's doors have written it, since 2026-08-30. A migration started before
-- that, or written by hand, has no rows. For billing, absent means `ready` and
-- holds nothing; the gates that will read a data type's phase from its row
-- fall back to the migration's status when there is none. But a cutover per
-- data type moves rows, and a row that is not there cannot be moved. So every
-- migration that has started gets its rows here, from its own status:
--
--   * `active` and `continuous`: always. Started, and holding its slots.
--   * `paused`: only once it has run a pass. One that never ran is a draft,
--     and a draft's paths are `ready`: free, and absent.
--   * `cutover` and `done`: always, `ended_at` at the migration's last change,
--     which is when the slots were released.
--
-- `first_activated_at` is the first pass, or the migration's creation when no
-- pass was recorded. A row that exists is left alone. Only included data
-- types are paths.
--
-- This is the same rule `pathsFromTheMapping` (ledger, a-path-for-every-
-- migration.ts) applies to one migration; a test runs both on the same rows.
-- An appliance has no scope rows yet when this runs, so nothing here is
-- written for it: it writes its scope rows from its configuration, and its
-- path rows by that function, at every start-up.
--
-- Run as the migration role, like 0046's backfill: the superuser every
-- deployment migrates as, so row security does not hide a tenant's rows.

INSERT INTO public.path_lifecycle
  (tenant_id, mapping_id, domain, state, first_activated_at, ended_at, updated_at)
SELECT s.tenant_id, s.mapping_id, s.domain, m.status,
       COALESCE((SELECT min(r.started_at) FROM public.run r
                  WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id),
                m.created_at),
       CASE WHEN m.status IN ('cutover', 'done') THEN m.updated_at END,
       now()
  FROM public.scope_selection s
  JOIN public.mailbox_mapping m ON m.id = s.mapping_id AND m.tenant_id = s.tenant_id
 WHERE s.included
   AND (m.status <> 'paused'
        OR EXISTS (SELECT 1 FROM public.run r WHERE r.tenant_id = m.tenant_id AND r.mapping_id = m.id))
ON CONFLICT (mapping_id, domain) DO NOTHING;
