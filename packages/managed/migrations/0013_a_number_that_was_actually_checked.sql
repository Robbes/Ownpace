-- A VAT number that was actually checked (workplan 0111 T2).
--
-- Migration 0012 stores what the customer SAID: `billing_party.vat_number`,
-- explicitly unvalidated, with a comment promising that nothing may treat an
-- unchecked number as a defence. This table is the defence: one row per VIES
-- consultation, holding what VIES answered and — when the check was qualified
-- — the CONSULTATION NUMBER, which is the artefact a tax authority accepts as
-- proof the seller verified the buyer before reverse-charging.
--
-- ## Why a log and not columns on billing_party
--
-- Evidence and statement have different lifecycles. The statement is mutable
-- (a PUT replaces it); evidence is append-only, because a consultation that
-- can be edited afterwards proves nothing. So the row is INSERTed and never
-- touched again:
--
--   GRANT SELECT,INSERT — and REVOKE UPDATE and DELETE, the same doubled
--   narrowing `erasure_record` carries and for the same reason: the
--   baseline's ALTER DEFAULT PRIVILEGES hands every new table all four verbs,
--   so a narrower GRANT alone would change nothing.
--
-- Re-checking the same number is legitimate (numbers get deregistered) and
-- simply appends. Which consultation SPEAKS for the currently stored number
-- is a read-side question: the latest row matching what `billing_party`
-- currently says — a number changed since its last check has, correctly, no
-- consultation at all.
--
-- ## What a row is, and what it never is
--
-- A row is an ANSWER from VIES: valid or invalid, with VIES's own request
-- date kept verbatim beside our clock. An unreachable VIES
-- (MS_UNAVAILABLE, timeouts, the service's notorious member-state outages) is
-- NOT a row — "we could not ask" recorded as if it were an answer is exactly
-- the confusion this table exists to prevent. The caller is told to try
-- later, and nothing is stored.
--
-- `consultation_number` is NULL for an UNQUALIFIED check — VIES only issues
-- one when the requester supplies their own VAT number, which this deployment
-- configures via `VIES_REQUESTER_MEMBER_STATE` / `VIES_REQUESTER_VAT_NUMBER`
-- (an instance fact: the operating entity is still an accountant
-- conversation, so the number lives in the environment, never here). An
-- unqualified "valid" is better than nothing and honestly less than a
-- qualified one; the NULL says which kind this row is.
--
-- ## `country_code` is the VIES member state, not the address country
--
-- VIES speaks EL where ISO says GR, and XI (Northern Ireland) exists while GB
-- does not — a GB number cannot be consulted at VIES at all. The code stored
-- here is the one actually sent, derived from the number's own prefix first
-- and the billing address second, so the row can be replayed against VIES's
-- own re-verification page exactly as asked.
--
-- ## Erasure
--
-- Purged (`PURGED_TABLES`), consistent with the owner's T10 decision that the
-- invoice mirror itself is purged and Moneybird keeps the record. The row a
-- retained invoice would need is the consultation that justified ITS
-- treatment — and the honest home for that is the invoice document in the
-- bookkeeping system, so workplan 0111 T4 must carry the consultation number
-- into the Moneybird invoice it creates. A consultation row outliving the
-- customer here would be evidence detached from any record we still hold.

CREATE TABLE IF NOT EXISTS public.vat_consultation (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    -- The member state code as VIES speaks it (EL, XI) — what was ASKED.
    country_code text NOT NULL,
    -- Normalised, prefix stripped — what was ASKED, not what was typed.
    vat_number text NOT NULL,
    valid boolean NOT NULL,
    -- VIES's own stamp, verbatim. Their statement, so never parsed or
    -- reformatted; `checked_at` below is our clock.
    request_date text,
    -- The defence, when the check was qualified. NULL = unqualified.
    consultation_number text,
    -- What VIES said the number belongs to, when the member state discloses
    -- it ('---' answers are stored as NULL). Part of the evidence: a valid
    -- number belonging to somebody else entirely is its own warning.
    trader_name text,
    trader_address text,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vat_consultation_country_code_check
        CHECK ((country_code ~ '^[A-Z]{2}$'::text))
);

-- The read is "the latest consultation for what billing_party currently
-- says", so the index matches that question's shape.
CREATE INDEX IF NOT EXISTS ix_vat_consultation_lookup
    ON public.vat_consultation (tenant_id, country_code, vat_number, checked_at DESC);

ALTER TABLE public.vat_consultation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.vat_consultation FORCE ROW LEVEL SECURITY;

-- SELECT and INSERT policies only. There are deliberately no UPDATE or
-- DELETE policies to go with grants that do not exist: the request path
-- appends and reads, the erasure purge deletes through the owner connection,
-- and nothing edits evidence.
DROP POLICY IF EXISTS tenant_isolation_select ON public.vat_consultation;
CREATE POLICY tenant_isolation_select ON public.vat_consultation FOR SELECT
    USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
DROP POLICY IF EXISTS tenant_isolation_insert ON public.vat_consultation;
CREATE POLICY tenant_isolation_insert ON public.vat_consultation FOR INSERT
    WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

GRANT SELECT,INSERT ON TABLE public.vat_consultation TO app_user;
REVOKE UPDATE,DELETE ON TABLE public.vat_consultation FROM app_user;

COMMENT ON TABLE public.vat_consultation IS
  'Append-only VIES consultation log (workplan 0111 T2): what was asked, what VIES answered, and — for qualified checks — the consultation number that is the seller''s actual defence for reverse charging. A row is always an answer; an unreachable VIES stores nothing. Purged on erasure; the consultation that justified a retained invoice belongs on the invoice document itself (T4).';

COMMENT ON COLUMN public.vat_consultation.consultation_number IS
  'VIES requestIdentifier. Present only when the check was qualified (the deployment supplied its own VAT number via VIES_REQUESTER_MEMBER_STATE / VIES_REQUESTER_VAT_NUMBER); NULL marks an unqualified check, which proves less and says so.';
