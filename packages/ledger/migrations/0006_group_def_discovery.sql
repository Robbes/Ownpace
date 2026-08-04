-- What discovery needs before `group_def` can have a writer (0027 T1).
--
-- `group_def` shipped in ledger v1 — schema'd, RLS'd, `pending/created/error`
-- — and has never been read or written by anything. Giving it a writer turned
-- up three things it cannot record as it stands.
--
-- 1. `pattern`. §14.1's whole question is whether a shared address is a shared
--    MAILBOX (Pattern S, a store to copy) or a distribution LIST (Pattern D, a
--    definition to recreate). `mailbox_mapping.pattern` can say that about a
--    mapping, but discovery classifies a group BEFORE any mapping exists, and
--    a discovery record that cannot carry its own classification would force
--    the answer to be re-derived by whoever read the row next. Nullable and
--    unconstrained-by-default on purpose: `NULL` is "discovered, not yet
--    classified", which is a real and honest state — a mail-enabled group
--    whose type the directory did not tell us must land in the
--    `shared_address_pattern` decision queue rather than be guessed (rule 9).
--
-- 2. `display_name` and `source_group_id`. An operator confirming a migration
--    reads "All Staff", not an opaque address, and Graph's group id is the
--    identity that survives a rename. Both nullable: a source that has neither
--    (IMAP has no groups at all) still writes legal rows.
--
-- 3. `members_known`. `members` defaults to `[]`, and an empty array is a
--    perfectly good answer — plenty of groups have no members. It is also
--    what a FAILED member read would leave behind, and those two must not
--    look alike: Pattern D recreates a group FROM this list, so "we could not
--    read who is in it" silently recorded as "nobody is in it" would have T2
--    create an empty group on the target and call it done (rule 9). TRUE by
--    default, because every row written from here on states it explicitly and
--    there are no older rows to mislabel.
--
-- 4. A unique key. Discovery re-runs — every detector in this system does
--    (rule 1) — and without one, the second pass would insert a second row for
--    the same group, so which member list won would depend on read order. The
--    key is (tenant, source connection, address): an address is unique within
--    one source, and the same address discovered from a DIFFERENT connection
--    is genuinely a different finding. Safe to add unconditionally — the table
--    has no writers, so it holds no rows to conflict.

ALTER TABLE public.group_def
  ADD COLUMN pattern text,
  ADD COLUMN display_name text,
  ADD COLUMN source_group_id text,
  ADD COLUMN members_known boolean DEFAULT true NOT NULL;

ALTER TABLE public.group_def
  ADD CONSTRAINT group_def_pattern_check
  CHECK (pattern IS NULL OR (pattern = ANY (ARRAY['shared_s'::text, 'distribution_d'::text])));

CREATE UNIQUE INDEX uk_group_def_source_address
  ON public.group_def (tenant_id, source_connection_id, address);
