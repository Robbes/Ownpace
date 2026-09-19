-- WHERE A SHARED THING SITS, recorded on the row (workplan 0123 T4).
--
-- ## The 482 rows, and why they cannot be collapsed today
--
-- The owner's Sharing page showed 482 rows for what he thinks of as a handful
-- of shared folders. Drive populates `permissions` on every CHILD of a shared
-- folder as well as on the folder, so one folder shared with one person yields
-- a row for the folder and a row per file beneath it. Every one of those rows
-- is true. Together they are unreadable.
--
-- Collapsing them needs one fact this table has never held: WHICH CONTAINER
-- each row's subject sits in. `on_label` is a display name, `raw` is evidence
-- that must never be parsed for meaning (see its own comment), and neither
-- answers it.
--
-- ## Why these three columns and not `inherited`
--
-- 0123 §5 named two designs and said the choice had to be MEASURED against the
-- live API rather than assumed. It was, on the owner's own Drive, 2026-09-18:
--
--   inline: 0/10    permissions.list: 10/10    with inheritedFrom: 0/10
--
-- Drive returns `permissionDetails` and will say a grant IS inherited. It does
-- NOT return `inheritedFrom`, so it will not say what from — and the design
-- that groups children under the folder they inherit from needs exactly that.
-- The measurement therefore picked §5's other design: group by the container,
-- compare grant sets, and treat a child whose grants differ from its folder's
-- as a deviation that keeps its own row.
--
-- It is also the cheaper design, which is the second half of the same finding.
-- `inherited` is only on `permissions.list` — ONE REQUEST PER ITEM, 482 extra
-- Drive calls on the owner's Drive per scan, against the 0090 budget. The
-- container rides along on the `files.list` the scan already makes, for free.
--
-- ## Every column NULLABLE, and that is the point
--
-- Hard rule 9: "I could not look" and "there is nothing" must never look the
-- same. A source that cannot say where an item sits leaves these NULL, and a
-- NULL row is rendered on its own exactly as every row is rendered today —
-- never folded into a group on a guess. `is_container` is nullable for the
-- same reason: `false` means the source said "this is not a container", and
-- NULL means it said nothing. A NOT NULL DEFAULT false would have made those
-- two indistinguishable on every row written before today.
--
-- ## Rows written before today
--
-- Keep NULL, and are not backfilled. Backfilling would mean re-deriving a
-- parent for a grant scanned weeks ago from a Drive that has since moved on,
-- which is a claim about a hierarchy nobody re-read. They group again the next
-- time the scan runs, because the scan is the thing that knows.
--
-- ## Not a foreign key
--
-- `parent_key` holds the SOURCE's own id for a container, not a `share_grant`
-- id. The container is very often not a row in this table at all — a folder
-- can hold shared files without being shared itself — and a FK would refuse
-- exactly the rows most worth grouping. The grouping resolves it in memory
-- against the rows it actually has, and a key naming nothing simply does not
-- group.
--
-- ## Access
--
-- Unchanged. `share_grant` carries RLS, FORCE and its tenant policies; a
-- column inherits them.

ALTER TABLE public.share_grant
  ADD COLUMN IF NOT EXISTS item_key text,
  ADD COLUMN IF NOT EXISTS parent_key text,
  ADD COLUMN IF NOT EXISTS is_container boolean;

COMMENT ON COLUMN public.share_grant.item_key IS
  'The SOURCE''s own id for the thing this grant is on — a Drive file id, not '
  'anything of ours (workplan 0123 T4). What a child''s parent_key points AT '
  'when the sharing queue groups a folder''s contents under the folder. NULL '
  'means the source did not say, never that the item has no identity, and a '
  'NULL row is listed on its own rather than folded into a group on a guess.';

COMMENT ON COLUMN public.share_grant.parent_key IS
  'The SOURCE''s own id for the container holding this item (workplan 0123 '
  'T4) — the key the sharing queue groups on, chosen over Drive''s own '
  'inheritance reporting because `inheritedFrom` was measured ABSENT for My '
  'Drive items on 2026-09-18 while `parents` rides along on the listing the '
  'scan already makes. Not a foreign key: it names a container that is very '
  'often not a row in this table, and a key naming nothing simply does not '
  'group. NULL means the source did not say.';

COMMENT ON COLUMN public.share_grant.is_container IS
  'Whether this row''s subject is itself a container — the folder a group '
  'hangs under, rather than something inside one (workplan 0123 T4). Three '
  'values on purpose: true, false, and NULL for a source that did not say. '
  'A NOT NULL DEFAULT false would have made "not a folder" and "nobody '
  'looked" the same answer on every row written before this column, which is '
  'the confusion hard rule 9 exists to forbid.';
