-- Let a managed connection say it is a Gmail mailbox (workplan 0044).
--
-- The same move as 0008 (google_drive), for the same reason: `connection.kind`
-- is a CHECK constraint, so a provider not listed here cannot be stored at all,
-- and hard rule 5 says a source the appliance can be pointed at is a source the
-- managed edition can represent.
--
-- Why a kind of its own rather than `imap`: the credential shape is different.
-- An `imap` connection carries a password or a static token; a Gmail source
-- carries a Google OAuth client (id + secret) and a refresh token consented
-- with the `https://mail.google.com/` scope, from which access tokens are
-- minted per connection. Storing that under `imap` would make the credential
-- validation depend on inspecting the secret blob instead of the row's kind.
--
-- WIDENING ONLY. Every existing value stays valid, no row is touched, and the
-- constraint is dropped and recreated in the same statement pair, inside the
-- migration's transaction, so there is no window where the column is
-- unconstrained.

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
    'gmail'::text
  ])
);
