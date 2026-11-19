-- The `cirrux` connection kind: a destination account at Cirrux (workplan
-- 0160 T1).
--
-- ## Soverin's shape, for a second provider
--
-- One row, one app password, four faces: mail over IMAP from the server the
-- account stores (`mailHost`), and calendars, contacts and task lists over
-- the one DAV host Cirrux publishes. Cirrux's setup page lists that host for
-- Calendar, Contacts and Reminders alike, and its IMAP server beside it
-- (https://cirrux.co/help/setup, read 2026-11-19). So the config this kind
-- stores is the one a `soverin` row stores, and `secret_ref` holds the
-- username and the app password, exactly as there.
--
-- ## What this kind does NOT carry
--
-- Files. Cirrux Drive speaks no WebDAV; it is reached through Cirrux's own
-- HTTP API, with a person's OAuth sign-in (https://cirrux.co/help/api/drive).
-- That is a connector of its own (0160 T5), and when it arrives it is a face
-- of this same kind, which is why this migration widens the constraint by one
-- kind and not by two.
--
-- WIDENING ONLY: every existing value stays valid, no row is touched, and the
-- constraint is dropped and recreated inside the migration's transaction —
-- the same shape as 0008/0012/0015/0018/0019/0034/0037/0038/0039.

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
    'cirrux'::text
  ])
);
