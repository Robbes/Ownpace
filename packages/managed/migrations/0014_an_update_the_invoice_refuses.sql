-- An update the invoice refuses (workplan 0111 §"The refusal, designed" —
-- T5/T7's mechanism, landed early on the CURRENT table by owner decision,
-- 2026-08-30).
--
-- ADR-0044: an issued invoice is immutable; the correction instrument is a
-- credit note, never an edit. "Issued" is pinned to the status machine's
-- `draft -> sent` line — today that is the pay route initiating payment, and
-- under T5 it becomes the moment Moneybird assigns the legal number. The
-- design said the refusal would land WITH T5's mirror reshape; it lands now
-- because the hole is live now: the generation upsert's guard skipped only
-- paid/void, so a SENT invoice's amounts could be rewritten by a re-run.
-- T5's migration extends the column lists below when the mirror columns
-- (the legal number, the Moneybird id, the buyer snapshot) arrive; the
-- mechanism does not change.
--
-- Two layers, because neither suffices alone. Column-level grants are
-- unconditional per role — they cannot say "amounts may change while draft,
-- never after" — so the trigger owns the state-conditional half; a trigger
-- alone leaves the never-writable columns formally granted and invisible in
-- the catalog, so the grants own the unconditional half, the same
-- catalog-visible narrowing `vat_consultation` (0013) and `erasure_record`
-- carry.

-- ## Layer 1 — the trigger: fires for EVERY role, owner included
--
-- A repair that genuinely must edit an issued row drops this trigger inside
-- its own migration — a visible, reviewable act — never through a quiet role
-- exception.
CREATE OR REPLACE FUNCTION public.invoice_refuse_illegal_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- The status machine. Same-to-same passes: idempotent re-deliveries and
    -- lifecycle-only touches must not throw. `paid -> void` is deliberately
    -- absent — undoing a paid document is T7's credit note, never a status
    -- flip. Nothing sets `overdue` today (a failed payment leaves the
    -- invoice `sent` and payable — the document is not the payment); the
    -- arcs exist so the state means something the day dunning does.
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

    -- The document freeze. Past draft, the document columns are corrected by
    -- credit note, never edited. Carved out: the lifecycle columns (status,
    -- payment_method, payment_id, paid_at, sent_at, metadata, updated_at)
    -- and — until T10 replaces detach with purge — billed_to_name/tenant_id,
    -- which the erasure detach stamps on invoices of any status.
    IF OLD.status <> 'draft' THEN
        IF NEW.id           IS DISTINCT FROM OLD.id
           OR NEW.period_start IS DISTINCT FROM OLD.period_start
           OR NEW.period_end   IS DISTINCT FROM OLD.period_end
           OR NEW.subtotal     IS DISTINCT FROM OLD.subtotal
           OR NEW.tax_rate     IS DISTINCT FROM OLD.tax_rate
           OR NEW.tax_amount   IS DISTINCT FROM OLD.tax_amount
           OR NEW.total        IS DISTINCT FROM OLD.total
           OR NEW.currency     IS DISTINCT FROM OLD.currency
           OR NEW.due_date     IS DISTINCT FROM OLD.due_date
           OR NEW.created_at   IS DISTINCT FROM OLD.created_at
        THEN
            RAISE EXCEPTION 'invoice %: issued invoices are immutable — corrections are credit notes (0111 T7), never edits',
                OLD.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_refusal ON public.invoice;
CREATE TRIGGER trg_invoice_refusal
    BEFORE UPDATE ON public.invoice
    FOR EACH ROW
    EXECUTE FUNCTION public.invoice_refuse_illegal_update();

-- ## Layer 2 — narrowed grants: what no app path may EVER touch
--
-- The baseline's ALTER DEFAULT PRIVILEGES hands every table all four verbs,
-- so the REVOKE is load-bearing, not ceremony (the 0013 lesson). What stays
-- granted is the lifecycle surface plus the amount columns the generation
-- upsert legitimately rewrites WHILE DRAFT — the trigger supplies the
-- "while draft" that a grant cannot express. Identity and period columns
-- leave the app's reach entirely; the erasure detach's columns
-- (billed_to_name, tenant_id) are owner-path by construction — it must see
-- across tenants and leave rows tenant-less, which no RLS-scoped app_user
-- context can.
REVOKE UPDATE ON TABLE public.invoice FROM app_user;
GRANT UPDATE (status, subtotal, tax_rate, tax_amount, total,
              payment_method, payment_id, paid_at, sent_at,
              metadata, updated_at)
    ON TABLE public.invoice TO app_user;

COMMENT ON FUNCTION public.invoice_refuse_illegal_update() IS
  'ADR-0044 at the database (0111 T5/T7, landed 2026-08-30): enforces the invoice status machine (draft->sent/void, sent->paid/overdue/void, overdue->paid/void, terminal states final) and freezes document columns once past draft. Fires for every role; a repair drops the trigger in its own migration, visibly. Corrections to issued invoices are credit notes, never edits.';
