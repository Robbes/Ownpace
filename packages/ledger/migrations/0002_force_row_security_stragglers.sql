-- FORCE ROW LEVEL SECURITY on the two tables the baseline missed.
--
-- `0001_baseline.sql` FORCEs 22 of its 24 RLS-enabled tables. The two
-- stragglers — `migration_discovery` and `migration_status` — were added by
-- later pre-squash migrations that wrote `ENABLE` and forgot `FORCE`, and the
-- squash preserved the omission faithfully. Found while fixing the larger
-- problem around it (the appliance serving as an RLS-exempt user — see
-- workplan 0016 P4 and `LedgerDriver.role`).
--
-- What FORCE changes, precisely: without it the table's OWNER is exempt from
-- row security even with `row_security = on`. Superusers are exempt either
-- way — FORCE cannot bind them, which is why this is invisible on the bundled
-- deployments (the postgres image's bootstrap user is a superuser, and PGlite
-- runs as `postgres`). It matters for the deployment hard rule 5 promises to
-- keep working: an operator pointing DATABASE_URL at their OWN Postgres, where
-- the appliance's user is an ordinary non-superuser owner. On that shape,
-- these two tables were the only ones whose rows an owner session could see
-- across tenants; now the posture is uniform, 24 of 24.
--
-- Serving traffic is unaffected on every shape: both editions serve as
-- `app_user` (managed via APP_DATABASE_URL, self-host via SET LOCAL ROLE in
-- withTenant), and app_user owns nothing.
--
-- `ONLY` to match the baseline's own FORCE statements; neither table has
-- partitions or inheritance children.

ALTER TABLE ONLY public.migration_discovery FORCE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.migration_status FORCE ROW LEVEL SECURITY;
