-- Let a managed connection say it is a Google Calendar or Google Contacts
-- source (workplan 0045).
--
-- The same move as 0008 (google_drive) and 0012 (gmail), for the same reason:
-- `connection.kind` is a CHECK constraint, so a provider not listed cannot be
-- stored, and hard rule 5 says a source the appliance can be pointed at is a
-- source the managed edition can represent.
--
-- Their own kinds rather than `caldav`/`carddav`, because the credential shape
-- differs the same way gmail's differs from imap: a Google OAuth client and a
-- refresh token that mints Bearer tokens, not a username and password. The
-- row's kind is what routes the builder to the right credential vocabulary.
--
-- WIDENING ONLY. Every existing value stays valid, no row is touched, and the
-- constraint is dropped and recreated in the same statement pair, inside the
-- migration's transaction.

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
    'google_contacts'::text
  ])
);
