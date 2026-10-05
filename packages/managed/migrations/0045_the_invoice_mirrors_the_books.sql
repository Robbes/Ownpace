-- THE INVOICE MIRRORS THE BOOKS (workplan 0111 T5, slice 3 of §"The build,
-- sliced"; ADR-0044: Moneybird numbers, renders and files the document, and
-- Ownpace is upstream of the record and a mirror of it).
--
-- ## What a row gains
--
-- Ours, set when the row is made, as a draft:
--
--   reference            the key a push is idempotent on, here and at
--                        Moneybird: `ownpace-{organisation}-m-{YYYY-MM}-{tier}`
--                        (`-t-` a top-up, `-c-` a credit note). Unique.
--                        NULL only on rows the retired generator made, which
--                        can never be pushed: a row with Moneybird's id must
--                        carry one.
--   kind                 'invoice' or 'credit_note'.
--   credited_invoice_id  the invoice a credit note corrects (T7): set exactly
--                        when the row is a credit note.
--   evidence             what the line quotes: the tier, the peak and its
--                        date, the pick (0109 T5).
--
-- Written while the row is a draft, by the push, as the document is sent:
--
--   vat_treatment, tax_rate_id, lines
--
-- Moneybird's, written once, at issue (draft -> sent):
--
--   moneybird_administration_id, moneybird_id, invoice_number, invoice_date
--
-- ## What the refusal learns (0014's trigger, extended)
--
-- Issued means numbered: draft -> sent needs the legal number and Moneybird's
-- id, so nothing issues a draft by any other road. The pay route did: it set
-- a draft `sent` while asking Mollie for money. It now refuses a draft before
-- Mollie is asked anything (apps/api/src/routes/billing/index.ts). A draft has
-- no number, and a row is born without one: the number is Moneybird's, read
-- back after the send, never minted here. Once written, the number, its date
-- and Moneybird's ids never change. Past draft, every document column is
-- frozen, the new ones included, so an issued document is corrected by a
-- credit note and by nothing else.
--
-- Not enforced here: that a row is born a draft. The writers insert drafts
-- (the retired generator, and slice 4's month task), test fixtures insert
-- issued rows directly, and a transition rule cannot see an INSERT. What an
-- INSERT can never do is carry a number.
--
-- The (tenant_id, period_start) key stays until slice 4 removes the retired
-- generator, whose upsert names it. Invoiced in advance (decision 6), a month
-- will have one invoice per step up, and the reference is the key then.
--
-- ## The pin
--
-- `invoice-refusal-under-rls.unit.test.ts` classifies every column of this
-- table, as identity, document, at issue, lifecycle or detach, and fails on
-- one it does not know: a new column cannot stay editable after issue
-- unnoticed.

ALTER TABLE public.invoice
    ADD COLUMN IF NOT EXISTS reference text,
    ADD COLUMN IF NOT EXISTS kind text DEFAULT 'invoice'::text NOT NULL,
    ADD COLUMN IF NOT EXISTS credited_invoice_id uuid REFERENCES public.invoice(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    ADD COLUMN IF NOT EXISTS vat_treatment text,
    ADD COLUMN IF NOT EXISTS tax_rate_id text,
    ADD COLUMN IF NOT EXISTS lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    ADD COLUMN IF NOT EXISTS moneybird_administration_id text,
    ADD COLUMN IF NOT EXISTS moneybird_id text,
    ADD COLUMN IF NOT EXISTS invoice_number text,
    ADD COLUMN IF NOT EXISTS invoice_date date;

ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_kind_check;
ALTER TABLE public.invoice
    ADD CONSTRAINT invoice_kind_check CHECK (kind IN ('invoice', 'credit_note'));

-- A credit note names the invoice it corrects, and only a credit note does.
ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_credit_note_check;
ALTER TABLE public.invoice
    ADD CONSTRAINT invoice_credit_note_check
    CHECK ((kind = 'credit_note') = (credited_invoice_id IS NOT NULL));

-- What a vat_treatment can be (packages/managed/src/vat-treatment.ts).
ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_vat_treatment_check;
ALTER TABLE public.invoice
    ADD CONSTRAINT invoice_vat_treatment_check
    CHECK (vat_treatment IS NULL
           OR vat_treatment IN ('domestic_standard', 'reverse_charge', 'destination_oss', 'outside_eu'));

-- Moneybird's facts come together: a number with Moneybird's id and its date,
-- an id with the administration it is in, and a pushed row carries our
-- reference. A draft has no number.
ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_numbered_check;
ALTER TABLE public.invoice
    ADD CONSTRAINT invoice_numbered_check CHECK (
        (invoice_number IS NULL OR (moneybird_id IS NOT NULL AND invoice_date IS NOT NULL))
        AND (invoice_date IS NULL OR invoice_number IS NOT NULL)
        AND (moneybird_id IS NULL OR (moneybird_administration_id IS NOT NULL AND reference IS NOT NULL))
        AND (status <> 'draft' OR invoice_number IS NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS uk_invoice_reference
    ON public.invoice USING btree (reference)
    WHERE reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_invoice_moneybird
    ON public.invoice USING btree (moneybird_administration_id, moneybird_id)
    WHERE moneybird_id IS NOT NULL;

-- ## Layer 1 — the trigger, extended. Fires for EVERY role, owner included.
CREATE OR REPLACE FUNCTION public.invoice_refuse_illegal_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- The status machine (0014, unchanged). Same-to-same passes.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'draft'   AND NEW.status IN ('sent', 'void')) OR
            (OLD.status = 'sent'    AND NEW.status IN ('paid', 'overdue', 'void')) OR
            (OLD.status = 'overdue' AND NEW.status IN ('paid', 'void'))
        ) THEN
            RAISE EXCEPTION 'invoice %: illegal status transition % -> % — paid and void are final, and undoing a paid document is a credit note (0111 T7), never a status flip',
                OLD.id, OLD.status, NEW.status;
        END IF;
    END IF;

    -- Issued means numbered (0045): Moneybird's number and id arrive with the
    -- step out of draft, or the step is refused.
    IF OLD.status = 'draft' AND NEW.status = 'sent'
       AND (NEW.invoice_number IS NULL OR NEW.moneybird_id IS NULL) THEN
        RAISE EXCEPTION 'invoice %: draft -> sent needs Moneybird''s number and id — an invoice is issued when Moneybird numbers it (0111 T5), never by asking for payment',
            OLD.id;
    END IF;

    -- Moneybird's facts are written once (0045): what is set is never changed.
    IF (OLD.invoice_number IS NOT NULL AND NEW.invoice_number IS DISTINCT FROM OLD.invoice_number)
       OR (OLD.invoice_date IS NOT NULL AND NEW.invoice_date IS DISTINCT FROM OLD.invoice_date)
       OR (OLD.moneybird_id IS NOT NULL AND NEW.moneybird_id IS DISTINCT FROM OLD.moneybird_id)
       OR (OLD.moneybird_administration_id IS NOT NULL
           AND NEW.moneybird_administration_id IS DISTINCT FROM OLD.moneybird_administration_id)
    THEN
        RAISE EXCEPTION 'invoice %: Moneybird''s number, date and ids are written once, at issue, and never changed (0111 T5)',
            OLD.id;
    END IF;

    -- The document freeze (0014, with 0045's columns). Past draft, the
    -- document is corrected by credit note, never edited. Carved out: the
    -- lifecycle columns (status, payment_method, payment_id, paid_at,
    -- sent_at, metadata, updated_at) and, until T10 replaces detach with
    -- purge, billed_to_name and tenant_id, which the erasure detach stamps on
    -- invoices of any status.
    IF OLD.status <> 'draft' THEN
        IF NEW.id                  IS DISTINCT FROM OLD.id
           OR NEW.period_start     IS DISTINCT FROM OLD.period_start
           OR NEW.period_end       IS DISTINCT FROM OLD.period_end
           OR NEW.subtotal         IS DISTINCT FROM OLD.subtotal
           OR NEW.tax_rate         IS DISTINCT FROM OLD.tax_rate
           OR NEW.tax_amount       IS DISTINCT FROM OLD.tax_amount
           OR NEW.total            IS DISTINCT FROM OLD.total
           OR NEW.currency         IS DISTINCT FROM OLD.currency
           OR NEW.due_date         IS DISTINCT FROM OLD.due_date
           OR NEW.created_at       IS DISTINCT FROM OLD.created_at
           OR NEW.reference        IS DISTINCT FROM OLD.reference
           OR NEW.kind             IS DISTINCT FROM OLD.kind
           OR NEW.credited_invoice_id IS DISTINCT FROM OLD.credited_invoice_id
           OR NEW.evidence         IS DISTINCT FROM OLD.evidence
           OR NEW.vat_treatment    IS DISTINCT FROM OLD.vat_treatment
           OR NEW.tax_rate_id      IS DISTINCT FROM OLD.tax_rate_id
           OR NEW.lines            IS DISTINCT FROM OLD.lines
           OR NEW.moneybird_administration_id IS DISTINCT FROM OLD.moneybird_administration_id
           OR NEW.moneybird_id     IS DISTINCT FROM OLD.moneybird_id
           OR NEW.invoice_number   IS DISTINCT FROM OLD.invoice_number
           OR NEW.invoice_date     IS DISTINCT FROM OLD.invoice_date
        THEN
            RAISE EXCEPTION 'invoice %: issued invoices are immutable — corrections are credit notes (0111 T7), never edits',
                OLD.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- A row is born without a number (0045). Fires for every role.
CREATE OR REPLACE FUNCTION public.invoice_refuse_a_number_at_birth()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.invoice_number IS NOT NULL OR NEW.invoice_date IS NOT NULL OR NEW.moneybird_id IS NOT NULL THEN
        RAISE EXCEPTION 'invoice %: a row is born without Moneybird''s number, date or id — they are written at issue, after Moneybird numbers it (0111 T5)',
            NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_born_unnumbered ON public.invoice;
CREATE TRIGGER trg_invoice_born_unnumbered
    BEFORE INSERT ON public.invoice
    FOR EACH ROW
    EXECUTE FUNCTION public.invoice_refuse_a_number_at_birth();

-- ## Layer 2 — the grants, extended
--
-- The app may write, while the row is a draft, what the push writes: the
-- treatment, the rate, the lines, and Moneybird's facts at issue. The trigger
-- supplies "while draft" and "once", which a grant cannot express. Identity
-- (reference, kind, credited_invoice_id) and evidence are set at INSERT and
-- never updated by the app.
GRANT UPDATE (vat_treatment, tax_rate_id, lines,
              moneybird_administration_id, moneybird_id, invoice_number, invoice_date)
    ON TABLE public.invoice TO app_user;

COMMENT ON COLUMN public.invoice.reference IS
  'Ours, and the key a push is idempotent on, here and at Moneybird: ownpace-{organisation}-m-{YYYY-MM}-{tier} (-t- a top-up, -c- a credit note). Unique; NULL only on rows the retired generator made, which can never be pushed (0045).';
COMMENT ON COLUMN public.invoice.invoice_number IS
  'The legal number, Moneybird''s: written once, at issue (draft -> sent), never minted here, never changed (ADR-0044, 0045).';
COMMENT ON COLUMN public.invoice.evidence IS
  'What the line quotes: the tier, the peak and its date, the pick (0109 T5). Set when the row is made; frozen past draft.';

COMMENT ON FUNCTION public.invoice_refuse_illegal_update() IS
  'ADR-0044 at the database (0111 T5/T7; 0014, extended by 0045): the invoice status machine (draft->sent/void, sent->paid/overdue/void, overdue->paid/void, terminal states final); draft->sent only with Moneybird''s number and id; Moneybird''s number, date and ids written once; every document column frozen past draft. Fires for every role; a repair drops the trigger in its own migration, visibly. Corrections to issued invoices are credit notes, never edits.';
COMMENT ON FUNCTION public.invoice_refuse_a_number_at_birth() IS
  'A row is born without Moneybird''s number, date or id; they are written at issue (0111 T5, 0045).';
