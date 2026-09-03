-- One account, four faces: the `microsoft` connection kind (workplan 0114).
--
-- ## What was wrong with two kinds
--
-- Microsoft is `oauth2` and `graph`, and both mean the same thing about the
-- person in front of the screen: **they registered an application in Microsoft
-- Entra ID.** `credential-fields.ts` asks them for a tenant ID, a client ID and
-- a client secret, because *"oauth2 and graph authenticate with the customer's
-- OWN Entra app registration"* (0037 T6, ADR-0006's row-14 model).
--
-- That is a reasonable ask of an IT department and an unreasonable one of a
-- family. Google and Dropbox both got a grant button in September 2026;
-- Microsoft was the last of the three big sources still demanding an app
-- registration from the person leaving it.
--
-- ## The asymmetry with `google` runs the OTHER way
--
-- `google` (migration 0034) carries calendar and contacts by default, and not
-- mail or files, because Google prices `https://mail.google.com/` and
-- `drive.readonly` as RESTRICTED scopes needing an annual third-party security
-- assessment. Microsoft's delegated equivalents — Mail.Read, Calendars.Read,
-- Contacts.Read, Files.Read, over the signed-in user's own data — carry no
-- such tier. So this kind offers all four faces from the first day, and the
-- one it does NOT offer is tasks: Graph serves To Do lists at /me/todo/lists
-- under Tasks.Read, and this product has no connector that reads them yet
-- (0114 T9). That absence is ours and is named as ours, in the refusal a
-- customer sees.
--
-- ## `oauth2` and `graph` STAY, and that is the plan rather than debt
--
-- The same cohabitation `google` has with its four single-purpose kinds. A
-- customer who already registered an application keeps using it — their
-- registration may carry application permissions this kind's delegated grant
-- never will, which is exactly what an administrator migrating other people's
-- mailboxes needs. Every connection anybody has already made keeps working.
--
-- ## Why the wizard word and the kind are the same word
--
-- No underscore to translate, unlike `google_drive` or `google_calendar`,
-- whose kinds predate the wizard vocabulary. `microsoft` is new on both sides
-- at once, so `sourceKindFor` needs no case and `wizardTypeForConnectionKind`
-- needs no reverse case — the same reason `google` needed neither.
--
-- WIDENING ONLY: every existing value stays valid, no row is touched, and the
-- constraint is dropped and recreated inside the migration's transaction —
-- the same shape as 0008/0012/0015/0018/0019/0034.

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
    'microsoft'::text
  ])
);
