-- A CARD WE CORRECTED, recorded on the row (the owner's word, 2026-09-18,
-- workplan 0124 T1).
--
-- ## The only column here that records something we did TO somebody's content
--
-- Every other column on `item` describes what happened to an item: where it
-- went, how big it was, what refused it. This one says we changed the bytes
-- before sending them, and it exists so that doing so is never silent.
--
-- ## What is corrected, and why it is not a content change
--
-- `;` separates vCard PARAMETERS. `,` separates VALUES inside one parameter:
--
--   BDAY;VALUE=DATE,X-APPLE-OMIT-YEAR=1604:16041105
--
-- `VALUE` is not holding two value types there. It is holding `DATE` and an
-- entire second parameter, folded into its value list by a `,` standing where
-- a `;` belongs — and the array Sabre builds from it, printed in the owner's
-- own Nextcloud log, is the proof. That is malformed by the grammar rather
-- than a stylistic choice, which is what makes restoring the separator
-- different in kind from rewriting somebody's data. The date is never touched.
--
-- Two of the owner's 1,400 contacts carried it, refused five times each since
-- his first real run. An Apple-written card synced into Google is an extremely
-- ordinary shape, and "ask every customer to hand-edit their own cards" is not
-- a product. #994 found the cause and deliberately stopped at a READER,
-- because repairing somebody's card needed his word:
--
--   *"Still a reader and not a repair. `carddav-source.ts` hands the PUT
--   exactly what the source served, so the comma is in the customer's card and
--   restoring the semicolon would rewrite their content on our reading of it.
--   That needs the owner's word, not a bug fix."*
--
-- He gave it, and chose to repair on the way out rather than only after a
-- refusal: *"we already now it needs repairing, because else it will not land
-- in the target."*
--
-- ## What this column may hold
--
-- One sentence per correction, naming the LINE, the PROPERTY and the
-- PARAMETER — never a value. That boundary belongs to
-- `dav-payload-defects.ts`, where the diagnosis keeps it for the same reason,
-- and it is pinned by that module's own test. So this column is safe for an
-- operator to read where `last_error` is not: it carries no birthday, no
-- address and no phone number.
--
-- ## Rows written before today
--
-- Keep NULL, and are not backfilled. A row written before this was sent
-- verbatim, and saying otherwise would be a claim about bytes nobody re-read.
-- NULL therefore means exactly one thing — nothing was corrected — and not
-- "we did not look": the repair runs on every card and answers empty for a
-- well-formed one.
--
-- `text` with no CHECK, for the reason migration 0033 gave about a different
-- column: these are sentences a person reads, not a vocabulary anything
-- branches on, and nothing in the product decides anything from this value.
--
-- ## Access
--
-- Unchanged. `item` carries RLS, FORCE and its tenant policies; a column
-- inherits them.

ALTER TABLE public.item
  ADD COLUMN IF NOT EXISTS repaired text;

COMMENT ON COLUMN public.item.repaired IS
  'What this tool CORRECTED in the item''s own bytes before sending it '
  '(workplan 0124 T1). The only column on this table that records something '
  'done TO a customer''s content rather than about it, and it exists so that '
  'doing so is never silent. Today one shape only: a vCard parameter '
  'separator, where a '','' standing in place of a '';'' folds the next '
  'parameter into the previous one''s value list and a spec-compliant parser '
  'is entitled to refuse the card. The VALUE is never touched. One sentence '
  'per correction, naming the line, the property and the parameter and never '
  'a value — so this is safe for an operator to read where last_error is not. '
  'NULL means nothing was corrected, which is every row written before this '
  'column and almost every row after it; it does NOT mean nothing was looked '
  'at, because the repair runs on every card. Not backfilled: a row written '
  'earlier was sent verbatim.';
