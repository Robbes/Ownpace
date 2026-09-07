-- A failure says WHICH SIDE it happened on (workplan 0094 T5, second slice).
--
-- ## Why a column, and why now
--
-- A migration signs in with two connections. When a pass failed, the row
-- could say what kind of failure it was (0033) and could not say which of the
-- two connections it was about — so the connections page put the same line on
-- both cards and asked the person to press Test to find out. Honest, and one
-- press too many for the commonest case: an expired credential on exactly one
-- side.
--
-- The side is known at one place only: the pass, at the moment it calls a
-- SOURCE closure (list, read, fetch) or a TARGET closure (ensure, write) and
-- the call throws. It is tagged there and written here, beside the category.
-- It is NEVER derived from `last_error`: that is provider prose, and 0110 T3
-- drew the line at parsing it for anything but the coarse category.
--
-- ## Two values and a CHECK, unlike the category
--
-- The category deliberately has no CHECK (six revisable words). A side is not
-- vocabulary — a migration has exactly two, by construction — so the database
-- may say so. NULL is the honest third state: the pass could not tell (the
-- ledger threw, a key could not be derived), or the row was written by a
-- build that predates this column. A screen reading NULL must say "one of the
-- two" rather than guess.
--
-- ## Cleared with the failure
--
-- Like the category, this is cleared by the next clean pass: a side that
-- outlived its failure would send somebody to rotate a credential that works.
--
-- ## Access
--
-- `migration_status` already carries RLS, FORCE and its tenant policies. A
-- column inherits them; nothing about access is restated here.

ALTER TABLE public.migration_status
  ADD COLUMN IF NOT EXISTS failed_side text
    CHECK (failed_side IN ('source', 'target'));

COMMENT ON COLUMN public.migration_status.failed_side IS
  'Which SIDE the last failure happened on — source or target — recorded by '
  'the pass at the closure that threw (workplan 0094 T5). NULL means the pass '
  'could not tell, or nothing has failed; a screen must then say "one of the '
  'two" rather than guess. Never derived from last_error. Cleared by the next '
  'clean pass, with the category.';
