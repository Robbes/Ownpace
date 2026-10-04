-- A yes says which limit asked for it (workplan 0109 T6, the path axis; the
-- owner's answer of 2026-10-04: one agreed tier for both axes).
--
-- `data_allowance` (managed 0037) holds every yes to a step up, and the
-- highest tier said yes to is the organisation's agreed tier on both axes:
-- how many migrations may run at the same time, and how much data may move.
-- A move up is asked at the data ceiling, or at a start that would run more
-- at the same time than the agreed tier does. The row is the same either way;
-- this column says which of the two asked, for the invoice line and for
-- whoever reads the record later.
--
-- Every row written before this is a data yes: 0037 had no other door. So the
-- default is `data`, and no row is rewritten (the table refuses UPDATE to the
-- app, and nothing here needs it to).

ALTER TABLE public.data_allowance
    ADD COLUMN IF NOT EXISTS axis text NOT NULL DEFAULT 'data'
        CONSTRAINT data_allowance_axis_check CHECK (axis IN ('data', 'paths'));

COMMENT ON COLUMN public.data_allowance.axis IS
  'Which limit asked for this yes: data (the data ceiling) or paths (a start past the agreed tier''s migrations at the same time). Before 0039, every row was data.';
