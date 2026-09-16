-- The decks a policy will not carry, counted before the run (0042 T7,
-- ADR-0046, owner's decision 2026-09-16).
--
-- `export-office` carries a Google Doc and a Google Sheet correctly: measured
-- on a real tenant, both are byte-unstable ONLY in their zip container, and
-- ADR-0046's structural hash settles that. A Google SLIDES deck is not: five of
-- its members genuinely change content between two exports of an unchanged
-- file, so normalising the container leaves two draws still differing.
--
-- Exporting one anyway would make every later pass see a change nobody made,
-- re-copy the deck, and succeed — a library rewritten every night with nothing
-- in any report saying so. The connector therefore refuses a deck under that
-- policy, per item, inside the sync loop's boundary, so it lands in the
-- failures queue with its reason and the rest of the folder migrates.
--
-- ## Why the count is stored rather than left to the failures queue
--
-- The refusal is the GATE and it holds on its own. This column is the EARLY
-- WARNING, and they are not interchangeable: the queue tells an owner after the
-- first pass, and the confirm screen tells them before they press go. The
-- second is when the policy choice is still open.
--
-- `migration_discovery` already carries two facts of exactly this shape —
-- `generated_id_items` (items we will modify) and `target_existing` (what the
-- destination already holds) — and its own comment gives the reason: a number
-- the owner is being asked to approve can only be a choice if it is in front of
-- them.
--
-- ## Why jsonb and not an integer
--
-- The count is per Google editor kind — `{"presentation": 3}` — because the
-- sentence an owner reads has to name what will be left behind. "3 items will
-- not be copied" sends somebody hunting; "3 Google Slides" does not. A second
-- kind can join it when a measurement says so, and that is a value change
-- rather than another column.
--
-- ## Why nullable
--
-- NULL means "this run did not look", which is a different claim from `{}`,
-- "looked and found none". Every source but Google Drive leaves it NULL
-- permanently — they have no native editor files to refuse — and a Drive run
-- that found no decks writes `{}`. Reading NULL as zero would tell an owner
-- their Drive holds no Slides on the strength of a count nobody took, which is
-- the mistake `generated_id_items` was given the same nullability to avoid.

ALTER TABLE migration_discovery
  ADD COLUMN IF NOT EXISTS refused_native jsonb;

COMMENT ON COLUMN migration_discovery.refused_native IS
  'Native editor files this mapping''s export policy will refuse for MEASURED byte-instability, by Google editor kind, e.g. {"presentation": 3}. NULL = this run did not look (every non-Drive source, permanently); {} = looked and found none. The gate is the connector''s per-item refusal; this is the number the owner sees before pressing go. See 0042 T7 and ADR-0046.';
