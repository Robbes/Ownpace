-- One rate budget per (tenant, provider), shared across processes
-- (workplan 0082 T5).
--
-- `ThrottleLimiter` already keyed its token buckets by exactly this pair — the
-- design was right. What was wrong is where the buckets LIVED: a `Map` on an
-- instance built per `buildDepsFromMapping` call, which is per mapping pass.
--
-- In managed that is close to no limit at all. Trigger.dev runs every task run
-- in its own TaskRunProcess, so two passes for the same tenant each got a
-- private full-size bucket, and the more the service scaled the more copies of
-- the "limit" existed. Meanwhile the resource being protected is shared and
-- singular: SAD §13 says ONE multi-tenant Entra app, so Microsoft's per-app
-- and per-tenant quotas are consumed by every customer through the same
-- credential. §16 and §21 promised per-(tenant, provider) budgets; this is the
-- table that makes the promise true across processes.
--
-- A token bucket, refilled by elapsed time rather than by a timer: there is no
-- process to run the timer in, and elapsed-time refill is exact under any
-- schedule of callers.
--
-- NO ROW-LEVEL SECURITY, deliberately, and the only table in the schema
-- without it. Three reasons, all necessary:
--
--   * It is consulted by SYSTEM-level code with no tenant context — the same
--     trust boundary the sync tick documents. Under a policy keyed on
--     `app.current_tenant`, which is unset there, every row would be invisible
--     and every acquire would insert a fresh full bucket. The limiter would
--     silently stop limiting, which is the exact failure this table fixes.
--   * It carries no personal data. A tenant UUID, a provider name and a token
--     count — not the addresses and folder names §17's metadata nuance is about.
--   * Cross-tenant reads of it are meaningless: knowing another tenant has 7.3
--     tokens left grants nothing and reveals nothing about their data.

CREATE TABLE IF NOT EXISTS public.rate_budget (
    tenant_id uuid NOT NULL REFERENCES public.tenant(id) ON DELETE CASCADE,
    provider text NOT NULL,
    -- Fractional on purpose: a budget of 10 req/s refills 0.4 tokens in 40ms,
    -- and rounding that to zero would make short gaps refill nothing at all.
    tokens double precision NOT NULL,
    refilled_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, provider)
);

COMMENT ON TABLE public.rate_budget IS
  'Token bucket per (tenant, provider), shared by every process. Deliberately without RLS: it is read by system-level code that has no tenant context, and a policy on app.current_tenant would make every acquire see an empty table and mint itself a fresh full bucket — the limiter would stop limiting exactly where it is needed most.';

COMMENT ON COLUMN public.rate_budget.tokens IS
  'Tokens remaining at refilled_at. Refilled by ELAPSED TIME on each acquire rather than by a timer, because there is no process to hold the timer and elapsed-time refill is exact under any schedule of callers.';
