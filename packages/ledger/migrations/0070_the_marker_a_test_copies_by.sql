-- THE MARKER A TEST COPIES BY (workplan 0162 T2; the owner's decisions of
-- 2026-11-20, §2).
--
-- A test organisation copies only the items whose own title carries its
-- marker, `[Ownpace-test]` by default (§2 (a)): a mail's subject, an event's
-- or a task's SUMMARY, a contact's FN, a file's own name. Each migration
-- created in such an organisation carries the marker from its creation,
-- here, on the migration itself (§2 (b)), and every builder of the
-- migration's source reads it and wraps the source it builds (`MarkedOnly`,
-- packages/orchestration), so discovery, every pass, the bin scan and the
-- apply jobs all see the same marked set (§2 (d)).
--
-- ## NULL is every migration that is not a test
--
-- Only adding: every existing row reads NULL, and NULL builds the source
-- exactly as before. Nothing in this change writes the column: the switch on
-- an organisation and the copy into a migration at its creation are T1's
-- (§3), which come with ADR-0053.
--
-- ## Written once, and the database holds it
--
-- §2 (c): the marker is written when the migration is created, and never
-- changed or removed. Removing it from a running migration would start
-- copying everything into a test target, which is the one thing a test
-- organisation exists to prevent; changing it would leave copies made under
-- the old marker that the new one does not explain. A real move is a new
-- migration, in an organisation that is not a test.
--
-- So an UPDATE that changes the column is refused for every role, by a
-- BEFORE UPDATE trigger, the defence managed 0015, 0016 and 0052 put on the
-- rows they freeze. Every other column of the row updates as it always did,
-- and an UPDATE that sets the marker to what it already is changes nothing
-- and is let through. Deleting the migration stays open: a test migration
-- ends by being deleted (§2 (e)).
--
-- ## Its form
--
-- 3 to 64 characters, none of them a control character: C0 (U+0001 to
-- U+001F; U+0000 cannot be stored in text at all), DEL and C1 (U+007F to
-- U+009F). Named by code point rather than by `[[:cntrl:]]`, whose meaning
-- follows the database's locale, so Postgres and PGlite refuse the same
-- markers. A marker of control characters would match nothing a person
-- typed, and one shorter than three would match almost every title. The
-- route that will write it (T1) trims what the operator typed and offers
-- the default; this is the floor beneath it.

ALTER TABLE public.mailbox_mapping
  ADD COLUMN IF NOT EXISTS test_marker text;

ALTER TABLE public.mailbox_mapping
  DROP CONSTRAINT IF EXISTS mailbox_mapping_test_marker_check;
ALTER TABLE public.mailbox_mapping
  ADD CONSTRAINT mailbox_mapping_test_marker_check CHECK (
    test_marker IS NULL
    OR (
      char_length(test_marker) BETWEEN 3 AND 64
      AND test_marker !~ '[\x01-\x1f\x7f-\x9f]'
    )
  );

CREATE OR REPLACE FUNCTION public.mailbox_mapping_test_marker_written_once()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.test_marker IS DISTINCT FROM OLD.test_marker THEN
    RAISE EXCEPTION 'mailbox_mapping %: its test marker is written when the migration is created and never changed or removed (workplan 0162, §2 (c)); a real move is a new migration',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mailbox_mapping_test_marker_written_once ON public.mailbox_mapping;
CREATE TRIGGER trg_mailbox_mapping_test_marker_written_once
  BEFORE UPDATE ON public.mailbox_mapping
  FOR EACH ROW
  EXECUTE FUNCTION public.mailbox_mapping_test_marker_written_once();

COMMENT ON COLUMN public.mailbox_mapping.test_marker IS
  'The marker a test migration copies by (workplan 0162): only items whose own title contains it, ignoring case, are listed, copied and counted (MarkedOnly). NULL for every migration that is not a test. Written when the migration is created and never changed or removed: a BEFORE UPDATE trigger refuses any change, for every role.';
