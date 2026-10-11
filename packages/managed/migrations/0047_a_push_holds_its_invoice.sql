-- A PUSH HOLDS ITS INVOICE (workplan 0111, slice 5 of §"The build, sliced";
-- "one writer by construction, a lease on the row").
--
-- The hourly push (`managed-invoice-push`) sends each draft to Moneybird,
-- which numbers it. Two pushes of one draft at the same moment could each
-- find no invoice under its reference at Moneybird and each make one:
-- Moneybird's reference is not unique, ours is. So a push first claims the
-- draft for a while, `push_lease_until`, in an update only one claim can win,
-- and talks to Moneybird only about a draft it holds. A push that dies leaves
-- the lease to run out; the next run takes the draft again, finds Moneybird's
-- invoice by its reference, and sends nothing twice.
--
-- At issue the push writes Moneybird's due date beside its number, so
-- `due_date` joins the columns the app may write while the row is a draft
-- (0045's list). The trigger has frozen it past draft since 0014, and still
-- does. The lease is lifecycle: it is cleared at issue and never read after.

ALTER TABLE public.invoice
    ADD COLUMN IF NOT EXISTS push_lease_until timestamp with time zone;

GRANT UPDATE (push_lease_until, due_date) ON TABLE public.invoice TO app_user;

COMMENT ON COLUMN public.invoice.push_lease_until IS
  'Until when a push holds this draft (0111 slice 5): one writer talks to Moneybird about it at a time. Cleared at issue (0047).';
