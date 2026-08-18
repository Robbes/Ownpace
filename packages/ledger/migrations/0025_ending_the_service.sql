-- Ending the service: close, wait, purge — and keep what law requires
-- (workplan 0085, owner decisions 2026-08-18).
--
-- Before this, `DELETE /api/tenants/:tenantId` did a hard `DELETE FROM tenant`
-- that cascaded twenty-five tables, `invoice` and `audit_log` among them, with
-- no confirmation and no way back. Two things were wrong with it and only one
-- is about safety: **a customer's billing history is not ours to destroy on
-- request.** Dutch tax law wants invoices kept for years, so "erase
-- everything" trades a GDPR obligation for a tax one.
--
-- Three changes here, and the middle one is the load-bearing one.

-- ---------------------------------------------------------------------------
-- 1. A tenant can be CLOSED, and closed is not deleted.
-- ---------------------------------------------------------------------------
--
-- Closing stops syncs and billing immediately and makes the account read-only.
-- The purge happens later, after a window the customer chose. `deleting` (which
-- the baseline already allowed) keeps its meaning: the purge is actually
-- running, which is brief. A tenant sitting for ninety days in `deleting` would
-- read as a stuck job to anybody looking at it.

ALTER TABLE public.tenant
  ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS purge_after timestamp with time zone,
  ADD COLUMN IF NOT EXISTS closed_by text;

ALTER TABLE public.tenant DROP CONSTRAINT IF EXISTS tenant_status_check;
ALTER TABLE public.tenant
  ADD CONSTRAINT tenant_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'closed'::text, 'deleting'::text]));

COMMENT ON COLUMN public.tenant.purge_after IS
  'When the purge becomes due. NULL while active. Set at close time from the window the customer chose (immediate, 7, 30 or 90 days) — immediate means now(), so one code path serves every window and there is no separate "delete straight away" branch to get wrong.';

-- ---------------------------------------------------------------------------
-- 2. An invoice must be able to outlive the tenant it billed.
-- ---------------------------------------------------------------------------
--
-- It could not before: `invoice.tenant_id` was NOT NULL and cascaded, so
-- erasing a tenant erased its invoices.
--
-- Detaching alone is not enough, and this is the part that is easy to miss:
-- **the invoice carried no identity of its own.** It had `tenant_id` and
-- amounts, and nothing else — so an invoice detached from its tenant could not
-- say who it was for. `billed_to_name` is captured at issue time, which is
-- also simply correct: an invoice records a moment, and a customer renaming
-- their company later must not silently rewrite invoices already issued.
--
-- NOT a claim that these are now legally complete invoices. There is still no
-- invoice number, no address and no VAT identification number anywhere in this
-- schema. That is real work and it belongs to workplan 0086 T5, which is about
-- being allowed to take money at all.

ALTER TABLE public.invoice
  ADD COLUMN IF NOT EXISTS billed_to_name text;

ALTER TABLE public.invoice ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_tenant_id_fkey;
ALTER TABLE public.invoice
  ADD CONSTRAINT invoice_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenant(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.invoice.tenant_id IS
  'NULL once the tenant has been erased. The invoice survives on purpose — tax retention outlives the customer relationship — and billed_to_name is what it says about who it was for.';

-- RLS on `invoice` is keyed on `tenant_id`, so a detached invoice is invisible
-- to every tenant-scoped reader. That is the correct outcome: nobody browsing
-- as a tenant should see the invoices of an erased one. Operator access to
-- them is out-of-band, through the owner connection, which is the same trust
-- boundary the sync tick documents.

-- ---------------------------------------------------------------------------
-- 3. The record that an erasure happened — without re-creating what it erased.
-- ---------------------------------------------------------------------------
--
-- This is the part most likely to be got wrong, and the failure is subtle: the
-- obvious implementation keeps the tenant id and the email of whoever asked,
-- which is a record OF A PERSON — the thing we just promised to delete.
--
-- So `tenant_ref` is a one-way hash of the tenant id, never the id. An auditor
-- holding the id can compute the hash and confirm we erased what we said, when
-- we said. Anybody who does not already know the id learns nothing, and the
-- table cannot be turned back into a list of former customers.
--
-- No tenant foreign key, deliberately — a record that cascades away with the
-- thing it describes is not a record. And no RLS, for the same reason
-- `rate_budget` has none: it is read by system-level code with no tenant
-- context, and a policy on `app.current_tenant` would hide every row from the
-- only code that reads it.

CREATE TABLE IF NOT EXISTS public.erasure_record (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    -- sha256 of the tenant id. NOT the id.
    tenant_ref text NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    window_days integer NOT NULL,
    purged_at timestamp with time zone,
    -- Which invoices were kept, so the retention decision is auditable.
    retained_invoice_ids uuid[] NOT NULL DEFAULT '{}',
    -- Per connection kind: revoked, failed, or not attempted. A credential we
    -- deleted but could not revoke is still live at the provider, and saying so
    -- is the difference between a receipt and a reassurance.
    revocations jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Rows removed per table: the receipt, and what the test asserts against.
    purged_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_erasure_record_ref ON public.erasure_record (tenant_ref);

COMMENT ON TABLE public.erasure_record IS
  'Proof that an erasure happened, holding no personal data of its own. tenant_ref is a one-way hash of the tenant id: an auditor holding the id can verify the record; the table cannot be read back into a list of former customers. Deliberately without a tenant foreign key (a record that cascades away with its subject is not a record) and without RLS (read by system-level code that has no tenant context).';
