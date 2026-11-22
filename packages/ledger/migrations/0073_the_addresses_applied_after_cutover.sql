-- THE NEW ADDRESSES, APPLIED AFTER A CUTOVER ON A PERSON'S PRESS (ADR-0055
-- decision 6; workplan 0168 §3.4, D5, T4).
--
-- Once a data type is past its cutover, the target is the person's live
-- system, and rewriting a copy they have been using is a change to their live
-- data. So a change to the organisation's address table reaches such a copy
-- only when someone presses *Apply the new addresses here too* on that
-- migration (`POST /api/migrations/{mappingId}/address-changes/apply`, and the
-- appliance's `POST /address-changes/apply`).
--
-- The press is recorded as the digest of the confirmed table it was made
-- for (`addressTableDigest`, `@openmig/shared`). A pass applies the table past
-- the cutover only while that digest is the table's digest now: a later change
-- to the table waits for a press of its own. Before the cutover nothing reads
-- these columns.
--
-- `address_changes_applied_by` is the decision idiom of `setup_step.decided_by`:
-- the sign-in's subject on managed, `operator` for the appliance's own page.
--
-- Only adding nullable columns with no default: no row is rewritten, and the
-- lock is the brief one an `ADD COLUMN` takes. NULL is "nobody pressed it".

ALTER TABLE public.mailbox_mapping
  ADD COLUMN address_changes_applied_digest text,
  ADD COLUMN address_changes_applied_by text,
  ADD COLUMN address_changes_applied_at timestamp with time zone;

ALTER TABLE public.mailbox_mapping ADD CONSTRAINT mailbox_mapping_address_changes_applied_digest_check
  CHECK (((address_changes_applied_digest IS NULL) OR (address_changes_applied_digest ~ '^[0-9a-f]{64}$'::text))) NOT VALID;

-- A press says who and when, and no press says neither.
ALTER TABLE public.mailbox_mapping ADD CONSTRAINT mailbox_mapping_address_changes_applied_check
  CHECK ((((address_changes_applied_digest IS NULL) = (address_changes_applied_at IS NULL))
      AND ((address_changes_applied_at IS NULL) = (address_changes_applied_by IS NULL)))) NOT VALID;

COMMENT ON COLUMN public.mailbox_mapping.address_changes_applied_digest IS
  'The confirmed address table (ADR-0055) a person last pressed Apply the new addresses here too for, SHA-256 hex. Past a data type''s cutover a pass applies the table only while this is its digest now (workplan 0168 D5). NULL when nobody pressed it.';
