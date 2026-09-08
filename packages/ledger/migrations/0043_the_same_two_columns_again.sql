-- The same two columns, one table over.
--
-- Migration 0042 gave `verification_run.mapping_id` and
-- `apply_receipt.mapping_id` a stated fate, because an omitted ON DELETE
-- clause reads as NO ACTION and a customer pressing Delete on a migration met
-- a 500 with no way forward. Auditing the rest of the schema afterwards found
-- the identical accident on the same two tables' OTHER foreign key.
--
-- Thirty-eight references point at `tenant`:
--
--   34  cascade
--    1  set null    `invoice` — it outlives the tenant, for tax retention
--    1  restrict    `access_request` — chosen, and it reads `r` in the
--                   catalogue rather than the `a` an omission produces
--    2  NO ACTION   `verification_run`, `apply_receipt`
--
-- Both of those two were written `.references(() => tenant.id)` — the same
-- shape, in the same two table definitions, as the pair 0042 fixed. Nobody
-- chose restrict for them; it is what you get by writing nothing.
--
-- ## Nothing is broken today, and that is not a reason to leave it
--
-- Neither caller trips over it. `purgeTenant` deletes both tables explicitly
-- and BEFORE the tenant, and `clean empty-tenant` only ever removes a tenant
-- with no mapping at all — and both of these tables require a mapping, so
-- neither can hold a row for such a tenant. The trap is live and unsprung.
--
-- It is worth removing anyway, for the reason 0042 exists: the erasure path
-- had already MET this family on 2026-08-27 and worked around it for itself,
-- in `PURGED_TABLES`, whose comment names
-- `verification_run_mapping_id_fkey` exactly. That fixed one caller and left
-- the trap for every other one, and the customer's Delete button was among
-- them for five weeks. A default nobody chose, in a place nobody looks, is
-- how that happens twice.
--
-- ## What does not change
--
-- `purgeTenant` still names both tables, and must: `erasure_record.purged_counts`
-- is a receipt for what an erasure removed, and a row swept by a cascade is a
-- row the receipt cannot count. Under-reporting an erasure is the one thing a
-- receipt must not do. `access_request` still restricts — that is a decision,
-- and this migration does not touch it.

ALTER TABLE public.verification_run
  DROP CONSTRAINT IF EXISTS verification_run_tenant_id_fkey;

ALTER TABLE public.verification_run
  ADD CONSTRAINT verification_run_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;

ALTER TABLE public.apply_receipt
  DROP CONSTRAINT IF EXISTS apply_receipt_tenant_id_fkey;

ALTER TABLE public.apply_receipt
  ADD CONSTRAINT apply_receipt_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE;

COMMENT ON CONSTRAINT verification_run_tenant_id_fkey ON public.verification_run IS
  'Cascades, like the thirty-four other references to a tenant. The erasure '
  'path still deletes this table explicitly and first, because a row swept by '
  'a cascade is a row erasure_record.purged_counts cannot count.';

COMMENT ON CONSTRAINT apply_receipt_tenant_id_fkey ON public.apply_receipt IS
  'Cascades; see verification_run for why the erasure path still names this '
  'table explicitly.';
