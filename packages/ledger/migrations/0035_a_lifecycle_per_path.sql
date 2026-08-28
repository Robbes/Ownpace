-- A lifecycle per PATH, not per mapping (workplan 0109 T1; the owner chose a
-- sibling table over columns on `scope_selection`, 2026-08-27).
--
-- ## The grain mismatch this closes
--
-- ADR-0014 bills a PATH: *"one kind of thing, from one account, to one
-- account"* — mail, calendar, contacts and files are four separate paths, and
-- a tier is a CAPACITY, how many run at the same time. A path takes a slot
-- when first activated and gives it back when it ends.
--
-- But the lifecycle in this schema is per MAPPING. `mailbox_mapping.status`
-- carries one `active`/`paused`/`cutover`/`done` for all four domains, and
-- `scope_selection` — which IS the path row, `(mapping_id, domain)`, unique on
-- both — has no state at all. So **a customer cannot cut over mail while
-- calendar keeps running**, which is precisely the behaviour the tier model is
-- built on: paths end one at a time, slots free one at a time, the tier falls
-- by itself.
--
-- ADR-0014 calls this a prerequisite for the pricing model rather than a
-- refinement of it, and it is right: until it exists, the published tiers
-- describe what the service will do.
--
-- ## Why a sibling table and not columns on `scope_selection`
--
-- The owner's decision, and the reasons are worth keeping where the table is:
--
--  1. `scope_selection` is read by the SYNC JOB on every pass to decide scope.
--     Billing columns there put a billing concern in a hot read path, and
--     every future billing column widens the row the engine depends on.
--  2. T2 wants the month's PEAK, which means history. A separate table can
--     become append-only without disturbing the sync path; a column cannot.
--
-- What it costs, written here rather than discovered later: a join to ask
-- "which paths are active", a second row to keep aligned with
-- `scope_selection`, and the possibility of a path with no lifecycle row —
-- handled by reading ABSENT AS `ready`, which is the correct default anyway
-- and is ADR-0014's own column default. `ready` is free and holds no slot, so
-- an absent row can never over-bill; it can only ever under-claim, which is
-- the safe direction for a number somebody pays.
--
-- ## LEDGER chain, not managed — and that is a decision, not an oversight
--
-- 0109 T7 asks that the managed-leakage guard's table list grow BEFORE a
-- billing table exists rather than after. This table is deliberately NOT on
-- that list, because it is not a billing table: **the lifecycle is the
-- product's and billing is a reader of it.** An appliance owner has exactly
-- the same need to cut over mail while calendar keeps running, and putting the
-- per-path lifecycle in the managed chain would make that a paid feature by
-- accident — an edition difference hard rule 5 forbids. ADR-0014 pointing at
-- `scope_selection` (a ledger table) or "a sibling at that grain" says the
-- same thing.
--
-- The tables T7 is actually about — a tier calculator's peak, the byte meter —
-- are 0109 T2/T3's, and they are managed-only when they arrive.
--
-- ## Nothing changes behaviour yet
--
-- This migration adds a table and nobody writes to it. `mailbox_mapping.status`
-- remains the lifecycle the routes read and set. Making cutover and start
-- per-path is the next task, and it is a behaviour change that deserves its
-- own diff: `cutover_state`'s unique index is per mapping
-- (`uk_cutover_state_mapping`), and `POST /:mappingId/start` refuses at the
-- mapping grain. Both have to move before a path can end on its own.

CREATE TABLE IF NOT EXISTS public.path_lifecycle (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    mapping_id uuid NOT NULL,
    -- The same four the product drives and `scope_selection` keys on.
    domain text NOT NULL,
    -- ADR-0014's four states plus `ready`, which `mailbox_mapping.status` has
    -- never had: configured, connection-tested, never run — free, and the
    -- default. `paused` STILL HOLDS A SLOT (it is reserved capacity, and the
    -- pricing page says so); only `cutover`/`done` release one.
    state text DEFAULT 'ready' NOT NULL,
    -- When this path FIRST took a slot. Never overwritten by a later
    -- activation: "has this ever run" is a different question from "is it
    -- running", and an invoice reconstructed months later needs the first.
    first_activated_at timestamp with time zone,
    -- When it released one. NULL while it still holds a slot.
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT path_lifecycle_pkey PRIMARY KEY (id),
    CONSTRAINT path_lifecycle_domain_check
      CHECK (domain = ANY (ARRAY['email'::text, 'calendar'::text, 'contact'::text, 'file'::text])),
    -- A CHECK rather than application vocabulary, unlike the failure
    -- categories: these five are ADR-0014's operative rule, and a sixth is an
    -- amendment to a pricing decision, not a copy edit.
    CONSTRAINT path_lifecycle_state_check
      CHECK (state = ANY (ARRAY['ready'::text, 'active'::text, 'paused'::text, 'cutover'::text, 'done'::text])),
    CONSTRAINT path_lifecycle_mapping_fkey
      FOREIGN KEY (mapping_id) REFERENCES public.mailbox_mapping(id) ON DELETE CASCADE,
    CONSTRAINT path_lifecycle_tenant_fkey
      FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE CASCADE
);

-- One lifecycle per path. The same key `scope_selection` is unique on, because
-- it is the same identity.
CREATE UNIQUE INDEX IF NOT EXISTS uk_path_lifecycle_mapping_domain
  ON public.path_lifecycle (mapping_id, domain);

-- The question the tier calculator asks: which paths hold a slot, per tenant.
CREATE INDEX IF NOT EXISTS ix_path_lifecycle_tenant_state
  ON public.path_lifecycle (tenant_id, state);

COMMENT ON TABLE public.path_lifecycle IS
  'The lifecycle of one PATH — (mapping, domain) — which is the unit ADR-0014 '
  'bills and the grain at which paths must be able to end one at a time '
  '(workplan 0109 T1). A sibling of scope_selection rather than columns on it, '
  'because the sync job reads that row on every pass. ABSENT MEANS ready: free, '
  'holds no slot, and the safe direction for a number somebody pays.';

ALTER TABLE public.path_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.path_lifecycle FORCE ROW LEVEL SECURITY;

-- The four tenant policies every ledger table carries, in the NULL-safe form
-- migration 0004 established: a bare cast of an empty GUC RAISES, and a
-- permissive policy that raises takes the whole query with it.
CREATE POLICY path_lifecycle_tenant_select ON public.path_lifecycle
  FOR SELECT USING (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);
CREATE POLICY path_lifecycle_tenant_insert ON public.path_lifecycle
  FOR INSERT WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);
CREATE POLICY path_lifecycle_tenant_update ON public.path_lifecycle
  FOR UPDATE USING (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);
CREATE POLICY path_lifecycle_tenant_delete ON public.path_lifecycle
  FOR DELETE USING (tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.path_lifecycle TO app_user;
