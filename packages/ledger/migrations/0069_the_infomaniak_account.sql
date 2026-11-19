-- The `infomaniak` connection kind: a destination account at Infomaniak
-- (workplan 0161 T1).
--
-- ## Soverin's shape, with two logins
--
-- One row, four faces: mail over IMAP from the server the account stores
-- (`mailHost`, mail.infomaniak.com), and calendars, contacts and task lists
-- over the one DAV host Infomaniak publishes, sync.infomaniak.com
-- (https://www.infomaniak.com/fr/support/faq/2427 and
-- https://www.infomaniak.com/fr/support/faq/1544, read 2026-11-19). So the
-- config this kind stores is the one a `soverin` row stores.
--
-- What differs is `secret_ref`. Infomaniak signs in to its calendars and
-- contacts with the account's sync login (a short username and an app
-- password) and to mail with the mailbox's own (the full address and the
-- password made for it on its Devices tab); an app password cannot sign in to
-- mail (https://www.infomaniak.com/fr/support/faq/2855). The one encrypted
-- secret holds both: `username`/`password` for the DAV faces and
-- `mailUsername`/`mailPassword` for mail. No column changes for that, because
-- the secret is one encrypted record and its keys are not the schema's.
--
-- ## What this kind does NOT carry
--
-- Files. kDrive has WebDAV at an address of its own per drive, and Infomaniak
-- does not offer it on every plan
-- (https://www.infomaniak.com/fr/support/faq/2409). When a files face
-- arrives (0161 T3), it is a face of this same kind, which is why this
-- migration widens the constraint by one kind and not by two.
--
-- WIDENING ONLY: every existing value stays valid, no row is touched, and the
-- constraint is dropped and recreated inside the migration's transaction,
-- the same shape as 0008/0012/0015/0018/0019/0034/0037/0038/0039/0068.

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
    'archive'::text,
    'cirrux'::text,
    'infomaniak'::text
  ])
);
