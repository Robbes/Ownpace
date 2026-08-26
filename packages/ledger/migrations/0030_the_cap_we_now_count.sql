-- One byte meter per (tenant, provider), shared across processes
-- (workplan 0090 T2).
--
-- Gmail's IMAP endpoint caps DOWNLOADS at 2,500 MB per account per day
-- (verified from Google's own bandwidth-limits page, 0090 T1), and the
-- reported penalty for exceeding it is a ~24-hour lockout of the customer's
-- own live mailbox. `rate_budget` (migration 0024) cannot express that limit:
-- it paces requests per second, and a daily byte ceiling is a different
-- dimension with a different correct response — at the ceiling the pass must
-- STOP AND SAY SO (0090 T4), not wait, so this row is a meter to read, never
-- a bucket to block on.
--
-- The window is a fixed 24 hours anchored at the first byte after a reset
-- (`window_started_at`). Google's own reset rule is unobserved — the open
-- residue of 0090 T1 — and a fixed window can admit up to twice the ceiling
-- across two adjacent windows where a true rolling sum would not; the
-- configured ceiling is per mapping (migration 0017's throttle_config)
-- precisely so an operator can set headroom under it.
--
-- Counted on FETCH, not on write: the cap is on what the provider sends, so a
-- retry that re-fetches spends the meter again even though the ledger records
-- the item once. That is deliberately the opposite of ADR-0014's
-- first-copy-only billing rule, and the two must never share a query.
--
-- NO ROW-LEVEL SECURITY, deliberately, for exactly the three reasons
-- `rate_budget` records: it is consulted by system-level code with no tenant
-- context (under an app.current_tenant policy every read would see nothing
-- and every pass would mint itself a fresh, empty meter — silently
-- uncounted, the exact failure this table exists to fix); it carries no
-- personal data (a tenant UUID, a provider name, a byte count); and a
-- cross-tenant read of it grants and reveals nothing.

CREATE TABLE IF NOT EXISTS public.byte_budget (
    tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    provider text NOT NULL,
    window_started_at timestamp with time zone NOT NULL DEFAULT now(),
    -- bigint, not double: bytes are counted, never fractional, and a day of
    -- them at any real ceiling fits comfortably.
    spent_bytes bigint NOT NULL,
    PRIMARY KEY (tenant_id, provider)
);

COMMENT ON TABLE public.byte_budget IS
  'Daily byte meter per (tenant, provider), shared by every process — workplan 0090. Counted on fetch, never on write, and never joined with billing (ADR-0014 counts first copies; this counts what the provider sent, re-fetches included). Deliberately without RLS for the same reasons as rate_budget: system-level readers have no tenant context, and a policy would make the meter silently count nothing.';

COMMENT ON COLUMN public.byte_budget.window_started_at IS
  'Start of the current fixed 24-hour window, anchored at the first byte after a reset. The provider''s own reset rule is unobserved (0090 T1 residue), which is why the ceiling is configurable with headroom rather than pretended exact.';
