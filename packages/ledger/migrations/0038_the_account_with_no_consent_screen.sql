-- One account, four faces, and no button: the `apple` connection kind
-- (workplan 0115).
--
-- ## This kind is the first one with nothing to press
--
-- `google` (0034), `dropbox` and `microsoft` (0037) each arrived with a consent
-- screen behind them: one credential, one grant, the faces you tick. **Apple
-- publishes no OAuth scope for Mail, Calendar, Contacts, Reminders or iCloud
-- Drive to anybody outside Apple.** Sign in with Apple grants a name and an
-- email address, which is an identity and not a mailbox.
--
-- So this row is reached the way `soverin` (0034's sibling shape) is: an
-- **app-specific password**, over IMAP, CalDAV and CardDAV. That is not a
-- workaround. Apple requires two-factor authentication on every Apple Account,
-- and a two-factor account's own password is refused by those three protocols
-- BY DESIGN; the app-specific password is Apple's own supported answer for
-- third-party clients, scoped to the one client it was made for, and revocable
-- at account.apple.com without changing anything else.
--
-- ## Four faces, and a different four
--
-- email, calendar, contact, task.
--
-- `task` is here ON THE DAY THE KIND ARRIVES, which no other provider account
-- managed. Apple Reminders are VTODO components in the same CalDAV account, and
-- 0113 taught this product to read a calendar collection that declares VTODO in
-- its supported-calendar-component-set (RFC 4791 §5.2.3). Google Tasks needs
-- its own API; Microsoft To Do needs a `graph-todo-source` that does not exist
-- (0114 T9). Apple needs nothing new.
--
-- `file` is absent, and unlike Google's absent mail face this absence is
-- APPLE'S rather than ours. There is no third-party API — public, partner or
-- paid — that reads a person's iCloud Drive; CloudKit Web Services reaches an
-- application's own container, never the user's Drive. It is a measured no with
-- a reason, not a face waiting on work, and no connector would change it. The
-- only route for those bytes is the person's own Data & Privacy export.
--
-- Checked and recorded so nobody re-checks it: Apple's DMA Article 6(9)
-- Account Data Transfer API, which a gatekeeper with no data API would be
-- exactly the place to find one, covers App Store transactions and downloads
-- and nothing else.
--
-- WIDENING ONLY: every existing value stays valid, no row is touched, and the
-- constraint is dropped and recreated inside the migration's transaction —
-- the same shape as 0008/0012/0015/0018/0019/0034/0037.

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
    'apple'::text
  ])
);
