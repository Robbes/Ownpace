-- A tenant can be CLOSED, and closed is not deleted (workplan 0085, owner
-- decisions 2026-08-18).
--
-- Closing stops syncs and billing immediately and makes the account read-only.
-- The purge happens later, after a window the customer chose. `deleting` (which
-- the baseline already allowed) keeps its meaning: the purge is actually
-- running, which is brief. A tenant sitting for ninety days in `deleting` would
-- read as a stuck job to anybody looking at it.
--
-- WHAT USED TO BE HERE AND IS NOT ANY MORE (ADR-0036). This migration also
-- added `closed_at`, `purge_after` and `closed_by` to `tenant`, altered
-- `invoice` so it could outlive the tenant it billed, and created
-- `erasure_record`. All of that moved to the managed chain
-- (`packages/managed/migrations/`), because all of it is a promise made to a
-- CUSTOMER — the window they chose, the invoice we must keep for the tax
-- authority, the receipt we produce as their processor. An appliance's operator
-- is the customer, has root, and ends the service with `forget-me`, which
-- revokes the credentials the wipe is about to destroy and does not wait.
--
-- WHAT STAYED, and why the split falls here. A CHECK constraint is a statement
-- about what is ALLOWED, not about what is used. `closed` costs an appliance
-- nothing, and moving it would mean the managed chain rewriting a constraint
-- the shared chain owns — a cross-chain dependency, which is a much worse thing
-- to carry than an allowed-but-unused value.

ALTER TABLE public.tenant DROP CONSTRAINT IF EXISTS tenant_status_check;
ALTER TABLE public.tenant
  ADD CONSTRAINT tenant_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'closed'::text, 'deleting'::text]));
