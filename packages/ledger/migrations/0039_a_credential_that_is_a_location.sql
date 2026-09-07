-- The `archive` connection kind: a source whose credential is a LOCATION
-- (workplan 0116 T1).
--
-- ## Every other kind names an account. This one names a file.
--
-- `google`, `microsoft`, `apple`, `dropbox`, `box`, `imap` — each of those rows
-- says WHO we sign in as and holds something that proves it. An `archive` row
-- says WHICH EXPORT and WHERE IT IS, because that is the entire answer a
-- gatekeeper gives to a data-portability request: Google hands the person a
-- Takeout download and Apple hands them a Data & Privacy download, and neither
-- offers an API that would let this product fetch the same bytes itself.
--
-- Two consequences the schema should be read with:
--
--  * `secret_ref` stays NULL on these rows, legitimately. A path is not a
--    password. Nothing about an archive connection is encrypted because there
--    is nothing on it to encrypt, and a row with no secret is this kind's
--    correct shape rather than a half-finished one.
--  * The config carries `provider` — `google-takeout` or `apple-privacy` — and
--    that value is not decoration. It selects the reader. Opening an Apple
--    export with Google's reader does not fail; it reports an archive
--    containing nothing, which is the single worst answer available to
--    somebody who just waited a week for a 25 GB download.
--
-- ## One kind, not one per export
--
-- The obvious alternative was `google_takeout` and `apple_privacy` as separate
-- kinds. It is rejected here on the same ground workplan 0116 §2 rejects it in
-- code: a third export — Meta, Dropbox, Microsoft — must be a new READER and
-- nothing else. As separate kinds it would instead be a new card, a new icon,
-- a new branch in `sourceKindFor`, a new credential descriptor, a new refusal
-- and another one of these migrations. This product has done that fan-out
-- enough times to have a number for it (#597).
--
-- ## What this kind does NOT do yet
--
-- It connects, it is tested, and its measure is read (0116 T7). Migrating FROM
-- one is T5/T6 and is not built: the create-mapping door refuses an archive
-- source by name, saying so. A kind that can be added and cannot yet be used
-- is a visible gap; a kind that silently produces an empty migration is not.
--
-- WIDENING ONLY: every existing value stays valid, no row is touched, and the
-- constraint is dropped and recreated inside the migration's transaction —
-- the same shape as 0008/0012/0015/0018/0019/0034/0037/0038.

ALTER TABLE public.connection DROP CONSTRAINT IF EXISTS connection_kind_check;

ALTER TABLE public.connection ADD CONSTRAINT connection_kind_check CHECK (
  kind = ANY (ARRAY[
    'o365'::text,
    'soverin'::text,
    'nextcloud'::text,
    'proton'::text,
    'imap'::text,
    'caldav'::text,
    'carddav'::text,
    'webdav'::text,
    'selfhosted_mail'::text,
    'jmap'::text,
    'google_drive'::text,
    'gmail'::text,
    'google_calendar'::text,
    'google_contacts'::text,
    'dropbox'::text,
    'box'::text,
    'google'::text,
    'microsoft'::text,
    'apple'::text,
    'archive'::text
  ])
);
