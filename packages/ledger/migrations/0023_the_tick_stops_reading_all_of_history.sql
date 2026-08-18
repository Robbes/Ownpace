-- The managed sync tick re-read every run a mapping had ever produced, every
-- minute (workplan 0082 T1).
--
-- `managed-sync-tick.ts` asks two questions per active mapping:
--
--     (SELECT max(r.started_at) FROM run r WHERE r.tenant_id = … AND r.mapping_id = …)
--     EXISTS (SELECT 1 FROM run r WHERE … AND r.status = 'running')
--
-- and the baseline gave `run` two indexes, `(mapping_id, created_at DESC)` and
-- `(tenant_id, created_at DESC)`. Neither carries `status`, and an index on
-- `created_at` cannot answer `max(started_at)` — they are different columns.
-- So both subqueries read every matching row.
--
-- **This is the one that gets worse on its own.** Not with tenants, not with
-- mailboxes: with elapsed time. At the default `*/15` cadence a single mapping
-- writes ~2,900 run rows a month, forever, and the tick re-reads all of them
-- sixty times an hour. Worse, the EXISTS is fastest in the case that never
-- happens (a run IS in flight, so it stops at the first hit) and does the full
-- scan in the case that always happens (nothing running). A year-old customer
-- is slower than a new one for no reason the customer can see.
--
-- Plain CREATE INDEX, not CONCURRENTLY, and that is forced rather than chosen:
-- `migrate.ts` wraps each file in BEGIN/COMMIT and CONCURRENTLY cannot run
-- inside a transaction. It is also the right call at this sizing (SAD §21: ~25
-- mailboxes per tenant) — the write lock is milliseconds on tables this size.
-- If a tenant ever grows enough for that to matter, the answer is a separate
-- out-of-band index build, not a change to the runner's transaction discipline.

-- The EXISTS. Partial, so the index holds only rows that are actually running
-- — which is almost none of them, almost always. The common answer ("nothing
-- is running") becomes an empty-range probe instead of a full history scan.
CREATE INDEX IF NOT EXISTS ix_run_active
  ON public.run (tenant_id, mapping_id)
  WHERE status = 'running';

COMMENT ON INDEX public.ix_run_active IS
  'The managed sync tick asks, once a minute per active mapping, whether a run is already in flight. Partial on status = ''running'' because the answer is nearly always no, and a full index would make the cheap answer proportional to a history that only ever grows.';

-- The max(started_at). Leading (tenant_id, mapping_id) matches both the
-- subquery predicate and RLS; started_at DESC lets the planner take the first
-- row of a backward scan rather than aggregating the group.
CREATE INDEX IF NOT EXISTS ix_run_started
  ON public.run (tenant_id, mapping_id, started_at DESC);

COMMENT ON INDEX public.ix_run_started IS
  'Serves max(started_at) per mapping for the sync tick. The baseline''s ix_run_mapping is on created_at, which is a different column and cannot answer this.';

-- The tick's own outer scan: `FROM mailbox_mapping WHERE status = 'active'`,
-- with no index on status at all. The table is small (one row per mapping), so
-- this is the least urgent of the three — but a partial index makes the scan
-- proportional to the number of ACTIVE mappings rather than to every mapping
-- ever created, including the paused, the completed and the abandoned.
CREATE INDEX IF NOT EXISTS ix_mapping_active
  ON public.mailbox_mapping (tenant_id, id)
  WHERE status = 'active';

COMMENT ON INDEX public.ix_mapping_active IS
  'The sync tick enumerates active mappings across all tenants once a minute. Partial so the scan is proportional to what is running, not to everything ever created.';

-- Billing derives storage and egress by filtering `item` on last_synced_at
-- (usage-metering.ts), and no index covered that column: invoicing scanned the
-- largest table in the schema.
--
-- Worth stating plainly, because it argues against itself: this is a NINTH
-- index on `item`, and `item` takes the write volume of the initial copy. The
-- reason it is still right is that the initial copy is bound by the network
-- round trip to Graph or JMAP — hundreds of milliseconds an item — not by a
-- sub-millisecond index update. A ninth btree costs the copy nothing it can
-- measure, and saves a full-table scan per tenant per invoice.
CREATE INDEX IF NOT EXISTS ix_item_last_synced
  ON public.item (tenant_id, last_synced_at)
  WHERE last_synced_at IS NOT NULL;

COMMENT ON INDEX public.ix_item_last_synced IS
  'Billing derives per-period storage and egress by filtering item.last_synced_at within a tenant. Partial because an item that has never synced has nothing to bill for, which keeps the index off the rows the initial copy is still creating.';
