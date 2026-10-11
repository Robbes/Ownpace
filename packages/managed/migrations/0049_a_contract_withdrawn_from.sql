-- A CONTRACT WITHDRAWN FROM (workplan 0111, T7, slice 7b; decision 15, the
-- owner, 2026-10-05: "Back to Free from that moment, account and migrations
-- kept; the days used billed in proportion, the excess credited with a credit
-- note; a confirmation e-mail in the organisation's language"; terms §7).
--
-- ## A withdrawal is a row, one per withdrawal
--
-- Append-only, as a yes is (managed 0037) and a pick (0044): a withdrawal that
-- could be edited afterwards records nothing. It keeps what the withdrawal
-- function of article 11a of the Consumer Rights Directive asks the consumer
-- for, and what the confirmation repeats: the name they gave, the contract they
-- withdrew from (when it was concluded, and at which tier), and where the
-- confirmation goes; with when, by whom, in which language, and whether they
-- had asked us to begin before the fourteen days were over (terms §7: without
-- that request, they owe nothing for the days used).
--
-- ## Read where the tier is read
--
-- From the moment of the latest withdrawal, the yeses and the picks before it
-- count for nothing (`PgDataAllowanceStore.grants`, `PgTierPickStore.picks`),
-- so every reader of the tier reads Free: the Billing page, the month's invoice
-- (which makes nothing for Free), the pace, and the tick. A yes after it counts
-- again, and opens a new contract.
--
-- ## Who reads and writes it
--
-- The Billing page, in the organisation's own scope (`app_user`): it reads the
-- withdrawals and appends one. The tick reads the tier as the system role
-- (managed 0041), so it reads when the organisation withdrew, never who did or
-- the name and address they gave. The purge of a closed organisation deletes
-- the rows by `tenant_id` (`PURGED_TABLES`): they name a person, and the credit
-- notes that carry the money out are documents of their own.

CREATE TABLE IF NOT EXISTS public.contract_withdrawal (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    withdrawn_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Who pressed it: the signed-in member's id, as the audit log names them.
    withdrawn_by text NOT NULL,
    -- The name the consumer gave, and where the confirmation goes.
    name text NOT NULL,
    confirm_to text NOT NULL,
    -- The contract withdrawn from: when it was concluded (the first yes after
    -- Free), and the tier it stood at.
    contract_since timestamp with time zone NOT NULL,
    tier_id text NOT NULL,
    -- Whether the consumer asked us to begin before the fourteen days were
    -- over (terms §7). Without it, the days used are not billed.
    began_on_request boolean NOT NULL,
    language text NOT NULL,
    via text DEFAULT 'screen' NOT NULL,
    CONSTRAINT contract_withdrawal_tier_check CHECK (tier_id IN ('small', 'medium', 'large', 'xl')),
    CONSTRAINT contract_withdrawal_language_check CHECK (language IN ('en', 'nl')),
    CONSTRAINT contract_withdrawal_via_check CHECK (via IN ('screen', 'support')),
    CONSTRAINT contract_withdrawal_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT contract_withdrawal_confirm_to_check CHECK (confirm_to ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
    CONSTRAINT contract_withdrawal_since_check CHECK (contract_since <= withdrawn_at)
);

-- The readers ask for an organisation's latest withdrawal.
CREATE INDEX IF NOT EXISTS contract_withdrawal_tenant_idx ON public.contract_withdrawal (tenant_id, withdrawn_at);

ALTER TABLE public.contract_withdrawal ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.contract_withdrawal FORCE ROW LEVEL SECURITY;

-- NULL-safe, as 0004 made the policies: an unset tenant reads as no rows.
DROP POLICY IF EXISTS tenant_isolation_select ON public.contract_withdrawal;
CREATE POLICY tenant_isolation_select ON public.contract_withdrawal FOR SELECT
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));
DROP POLICY IF EXISTS tenant_isolation_insert ON public.contract_withdrawal;
CREATE POLICY tenant_isolation_insert ON public.contract_withdrawal FOR INSERT
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''))::uuid));

-- The request path appends and reads. The baseline grants UPDATE and DELETE
-- by default, so they are taken back, as 0037 and 0044 take them back.
GRANT SELECT, INSERT ON TABLE public.contract_withdrawal TO app_user;
REVOKE UPDATE, DELETE ON TABLE public.contract_withdrawal FROM app_user;

-- The tick: when. The purge: the rows, by the column it picks them with.
GRANT SELECT (tenant_id, withdrawn_at), DELETE ON TABLE public.contract_withdrawal TO ownpace_system;

COMMENT ON TABLE public.contract_withdrawal IS
  'Each withdrawal from a paid contract (workplan 0111 T7, decision 15; terms §7): from its moment the yeses and picks before it count for nothing, so the organisation is on Free. Append-only.';
