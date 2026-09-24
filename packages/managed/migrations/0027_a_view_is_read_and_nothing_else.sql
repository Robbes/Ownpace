-- A VIEW IS READ, AND NOTHING ELSE (found building 0026, 2026-09-24).
--
-- Every support view was to be `GRANT SELECT` and nothing else (0009), and
-- none of them was only that. The schema's default privileges (ledger 0001:
-- `ALTER DEFAULT PRIVILEGES … GRANT SELECT, INSERT, DELETE, UPDATE ON TABLES
-- TO app_user`) reach a view as they reach a table. So wherever the migrations
-- run as the role that set them, `app_user` also holds INSERT, UPDATE and
-- DELETE on every support view.
--
-- On a view over a join, an aggregate or a UNION that is inert: Postgres
-- cannot write through it. Six read a single table, and Postgres writes
-- through such a view with the view owner's rights, past that table's row
-- security:
--
--   support_tenants             tenant
--   support_tenant_connections  connection
--   support_tenant_migrations   mailbox_mapping
--   support_tenant_invoices     invoice
--   support_migration_domains   migration_status
--   support_tenant_members      tenant_member
--
-- So an operator's transaction could delete every customer: `DELETE FROM
-- support_tenants` ran, in a probe that rolled it back. No route writes through
-- a view, so it took a bug somewhere else to reach it. The database is where
-- this product says such a bug stops, and here it did not.
--
-- Every older support view is narrowed to SELECT by name, the joins and the
-- union included, so there is one rule to hold. `support_audit_export` (0026)
-- was made with its own REVOKE, and a view made later carries one too:
-- `support-views.unit.test.ts` reads each view's privileges from the catalog
-- and fails on anything but SELECT.

REVOKE INSERT, UPDATE, DELETE ON
  public.support_tenants,
  public.support_tenant_connections,
  public.support_tenant_migrations,
  public.support_tenant_invoices,
  public.support_migration_domains,
  public.support_retained_invoices,
  public.support_tenant_usage,
  public.support_tenant_members,
  public.support_log
FROM app_user;
