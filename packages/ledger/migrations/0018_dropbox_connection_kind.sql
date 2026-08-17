-- Let a managed connection say it is a Dropbox (workplan 0055).
--
-- The same widening as 0008/0012/0015, for the same reason: `connection.kind`
-- is a CHECK constraint, and hard rule 5 says a source the appliance can be
-- pointed at is a source the managed edition can represent. Its own kind
-- because the credential shape is Dropbox's: an app key + app secret + refresh
-- token, from which short-lived access tokens are minted per request.
--
-- WIDENING ONLY: every existing value stays valid, no row is touched, and the
-- constraint is dropped and recreated inside the migration's transaction.

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
    'dropbox'::text
  ])
);
