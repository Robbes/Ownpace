-- What a tenant agreed to pay, kept apart from what the operator currently charges.
--
-- Prices were a hardcoded constant (two of them, actually — see
-- @openmig/shared's pricing.ts). Making them operator-configurable creates a
-- hazard that did not exist while they were frozen in code: editing the price
-- list would re-price every existing customer's open invoice, retroactively,
-- with nothing anywhere saying it had happened. An operator raising the
-- compute rate for new signups would bill the customers they already have at
-- the new rate for work those customers' jobs did last week.
--
-- So the template and the agreement are different things and live in
-- different places. The template is the `PRICING_*` environment; the
-- agreement is this column, written once per tenant and never followed back
-- to the template. `resolveTenantPricing` pins the template here the first
-- time a tenant is priced, so every tenant ends up with an answer to "what
-- did we agree" that is a stored fact rather than whatever the config said
-- most recently.
--
-- THE BACKFILL IS THE LOAD-BEARING HALF. Every tenant that exists right now
-- has been billed at the built-in numbers (999 / 10 / 20 / 5 cents), so those
-- exact numbers become their agreement. Leaving the column NULL and letting
-- the resolver pin "whatever the template says at first read" would hand
-- existing customers the operator's NEW price list the first time anyone
-- opened their billing page — the precise re-pricing this column exists to
-- prevent, arriving through the door built to stop it. Written literally, not
-- read from config, because the deployment applying this migration may
-- already have a different template configured.
--
-- VAT is deliberately absent: a tax rate is set by a government and changes
-- for everyone at once. Pinning it per tenant would encode "this customer
-- keeps the old VAT rate", which is not a discount, it is a tax error.
--
-- Nullable, not defaulted: NULL means "no agreement yet", which is a real and
-- distinguishable state (a tenant created after this migration, before its
-- first billing touch). A DEFAULT would make every future tenant silently
-- agree to today's numbers at INSERT time, in the schema, where no operator
-- would think to look for a price.

ALTER TABLE public.tenant ADD COLUMN IF NOT EXISTS pricing jsonb;

COMMENT ON COLUMN public.tenant.pricing IS
  'The prices this tenant agreed to, in integer cents (baseFee, storagePricePerGB, egressPricePerGB, computePricePerHour). Pinned once from the operator template; never follows it afterwards. NULL = not yet agreed.';

UPDATE public.tenant
   SET pricing = jsonb_build_object(
         'baseFee', 999,
         'storagePricePerGB', 10,
         'egressPricePerGB', 20,
         'computePricePerHour', 5
       )
 WHERE pricing IS NULL;
