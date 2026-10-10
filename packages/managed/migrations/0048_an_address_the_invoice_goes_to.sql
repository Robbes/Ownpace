-- AN ADDRESS THE INVOICE GOES TO (workplan 0111, decision 11, the owner,
-- 2026-10-05: "ok"; slice 5 of §"The build, sliced").
--
-- Moneybird e-mails the invoice to an invoice address the Invoice details
-- card asks for. A person's own sign-in address is not that: an organisation's
-- invoices often go to its bookkeeping, and a consumer may want them apart
-- from their mail. So the card asks for one, beside the address the invoice
-- is made out to, and the push hands it to Moneybird's contact.
--
-- Optional here: until it is given, e-mail delivery is refused by name for
-- that organisation (invoice-push.ts), and a Manual stack never needs it. Its
-- shape is pinned loosely, one `@` with something on either side: whether
-- the mailbox exists is Moneybird's delivery to find out, not a pattern's.
-- Purged on erasure with the rest of the row (`billing_party` is on
-- PURGED_TABLES): it is a person's address.

ALTER TABLE public.billing_party
    ADD COLUMN IF NOT EXISTS invoice_email text;

ALTER TABLE public.billing_party DROP CONSTRAINT IF EXISTS billing_party_invoice_email_check;
ALTER TABLE public.billing_party
    ADD CONSTRAINT billing_party_invoice_email_check
    CHECK (invoice_email IS NULL OR invoice_email ~ '^[^@[:space:]]+@[^@[:space:]]+$');

COMMENT ON COLUMN public.billing_party.invoice_email IS
  'Where Moneybird e-mails the invoice (0111 decision 11). Optional; e-mail delivery is refused without it (0048).';
