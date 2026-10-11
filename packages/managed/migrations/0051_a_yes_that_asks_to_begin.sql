-- A YES THAT ASKS TO BEGIN (workplan 0111, T7, slice 7e; terms §7, 1.5; the
-- owner, 2026-10-11: "i do not want the tickbox, everyone who agrees with the
-- terms would normally start within 14 days").
--
-- A consumer who withdraws within the fourteen days pays for the days already
-- used only if they asked us to begin before the fourteen days were over
-- (article 14(4)(a)(ii) of the Consumer Rights Directive): without that
-- request, they owe nothing for them. The request is not a tick box. It is one
-- sentence at the order button, saying that we begin at once and what a
-- withdrawal then costs, repeated in the order's confirmation by email. So it
-- belongs to the yes the button records, and is a column of it:
--
--  - `began_on_request`: whether the order button this yes was given at said
--    that sentence, to a consumer whose yes begins within a withdrawal window
--    (`yesAsksToBegin`, `withdrawal.ts`). False for a business, which has no
--    right of withdrawal, and for every yes recorded before this column, none
--    of which was asked.
--
-- The window reads it from the yes that concluded the contract, the first
-- since Free (`readWithdrawalWindow`). Append-only as the rest of the row
-- (0037): what was asked at the button is never changed afterwards. app_user
-- inserts whole rows, so the table-level INSERT of 0037 covers it; the tick
-- reads no part of it (0041's column list stays as it is).

ALTER TABLE public.data_allowance
    ADD COLUMN IF NOT EXISTS began_on_request boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.data_allowance.began_on_request IS
  'Whether this yes was given at an order button that said we begin at once, within the fourteen days, and what a withdrawal then costs (0111 slice 7e; terms §7).';
