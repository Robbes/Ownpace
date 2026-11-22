-- THE TABLE AN ITEM WAS WRITTEN UNDER (ADR-0055 decision 5; workplan 0168 §3.1,
-- T2, used from T4).
--
-- A contact or an event copied with an address changed is no longer the
-- source's bytes, and that must never be silent. Each item records the digest
-- of the confirmed address table it was written under: a SHA-256 over the
-- confirmed rows sorted by old key (`addressTableDigest`, `@openmig/shared`),
-- hex. Verification and the confirmed list count and name it, and an item
-- under an older digest is never reported as a match (0168 T5). A pass that
-- finds an item's digest differs from the one it would get now rewrites it,
-- under every rule a rewrite keeps (0168 §3.3, T4).
--
-- NULL when nothing changed: every row written before this column, every mail
-- and file row always (mail is never changed, ADR-0055 decision 4), and every
-- contact or event the table did not touch. Not backfilled: a row written
-- before today was written with no change, and NULL says exactly that.
--
-- Written in the same change as the table itself (0071), so every migration
-- file of this feature lands together. Nothing writes the column until the
-- writers do (T4).
--
-- Only adding a nullable column with no default: no row is rewritten, and the
-- lock is the brief one an `ADD COLUMN` takes.

ALTER TABLE public.item ADD COLUMN address_digest text;

ALTER TABLE public.item ADD CONSTRAINT item_address_digest_check
  CHECK (((address_digest IS NULL) OR (address_digest ~ '^[0-9a-f]{64}$'::text))) NOT VALID;

COMMENT ON COLUMN public.item.address_digest IS
  'The digest of the confirmed address table (ADR-0055) this copy was written under, SHA-256 hex; NULL when no address in it was changed.';
