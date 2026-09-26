-- A CUTOVER LEDGER PER DATA TYPE (workplan 0128 T5, slice 4; the owner's
-- decision of 2026-09-24, D8: "we need to split up cutover, since someone
-- might want to keep syncing some kinds, like keeps files running, while
-- email cutover/stops").
--
-- Mail will be cut over, copy through its grace period and stop, while files
-- keep running until their own cutover. So each data type gets a cutover
-- ledger of its own: `cutover_state` and `cutover_event` gain a `domain`, and
-- the ledger's key becomes (tenant, migration, data type). The state machine,
-- the grace window and `copies_through_grace` are unchanged; each row has its
-- own.
--
-- NULL IS THE WHOLE MIGRATION. Every row written before this migration has no
-- data type, and it stays the ledger of every data type in its migration: a
-- migration cut over before this slice was cut over whole, and each of its
-- data types reads that one row. A data type's own row, once it has one,
-- comes first for that data type (`CutoverStore`, `readCutoverWindows`).
-- Nothing writes one in this migration, nor in the code it ships with: the
-- cutover of one data type is slice 5.
--
-- THE KEY, BY ITS REAL NAME. The baseline named it
-- `cutover_state_tenant_id_mapping_id_key`; the Drizzle schema called it
-- `uk_cutover_state_mapping`, and a drop by that name would have dropped
-- nothing and left a key that refuses every data type's second row. The new
-- key treats NULLs as equal, so a migration still has one whole-migration
-- row, and the store's upsert still finds it (`ON CONFLICT (tenant_id,
-- mapping_id, domain)`). PGlite and every Postgres the product runs on are 15
-- or later, which `NULLS NOT DISTINCT` needs.
--
-- The CHECKs name the same five data types as every other domain column
-- (0036), so `a-fifth-domain-the-database-would-refuse` keeps them in step.

ALTER TABLE public.cutover_state
  ADD COLUMN IF NOT EXISTS domain text;
ALTER TABLE public.cutover_state DROP CONSTRAINT IF EXISTS cutover_state_domain_check;
ALTER TABLE public.cutover_state ADD CONSTRAINT cutover_state_domain_check CHECK (
  domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);

ALTER TABLE public.cutover_event
  ADD COLUMN IF NOT EXISTS domain text;
ALTER TABLE public.cutover_event DROP CONSTRAINT IF EXISTS cutover_event_domain_check;
ALTER TABLE public.cutover_event ADD CONSTRAINT cutover_event_domain_check CHECK (
  domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text, 'task'::text])
);

ALTER TABLE public.cutover_state DROP CONSTRAINT IF EXISTS cutover_state_tenant_id_mapping_id_key;
ALTER TABLE public.cutover_state DROP CONSTRAINT IF EXISTS cutover_state_tenant_id_mapping_id_domain_key;
ALTER TABLE public.cutover_state ADD CONSTRAINT cutover_state_tenant_id_mapping_id_domain_key
  UNIQUE NULLS NOT DISTINCT (tenant_id, mapping_id, domain);

COMMENT ON COLUMN public.cutover_state.domain IS
  'The data type whose cutover ledger this row is (workplan 0128 T5), or NULL for the whole migration: every row written before 0067, and the ledger of each of its data types that has none of its own.';
COMMENT ON COLUMN public.cutover_event.domain IS
  'The data type whose cutover ledger this event moved (workplan 0128 T5), or NULL for the whole migration''s.';
