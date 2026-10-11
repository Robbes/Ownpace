-- A MONTH MAY HAVE MORE THAN ONE INVOICE (workplan 0111, slice 4a of
-- §"The build, sliced"; decision 6, the owner, 2026-10-05: "no, please
-- invoice in advance of the month").
--
-- Invoiced in advance, a month is invoiced on its first day at the tier it
-- starts on, and a move up during it is invoiced for the difference. So one
-- organisation's month can have two invoices, or three, and the key that said
-- it has one, (tenant_id, period_start), goes. What keeps a push from minting
-- two invoices for one step is the reference (managed 0045): ours, unique, one
-- per step, `ownpace-{organisation}-m-{YYYY-MM}-{tier}`.
--
-- The key was the retired generator's: its upsert named it, and the generator
-- is gone in the same change (apps/api/src/services/invoice-generation.ts and
-- its route, refused with a 409 since 0109 T0). The two indexes on
-- (tenant_id, period_start) and (status, period_start) stay: they serve reads.

ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_tenant_id_period_start_key;
