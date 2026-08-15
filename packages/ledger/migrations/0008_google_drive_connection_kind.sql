-- Let a managed connection say it is a Google Drive (workplan 0042 T5).
--
-- `connection.kind` is a CHECK constraint, not a lookup table, so a provider
-- that is not listed here cannot be stored at all: the appliance could be
-- pointed at a Drive by its mapping file while the managed edition could not
-- represent one. Hard rule 5 says the editions do not differ in behaviour, and
-- a row that cannot be inserted is a difference.
--
-- WIDENING ONLY. Every existing value stays valid, no row is touched, and
-- nothing is dropped except the constraint itself — which is recreated in the
-- same statement pair, inside the migration's transaction, so there is no
-- window where the column is unconstrained.
--
-- THE SPELLING. `google_drive`, underscored, matching `selfhosted_mail` and the
-- rest of this column. A mapping FILE spells the same provider `google-drive`,
-- matching `graph-mail` and `imap-oauth2` there. Each follows the convention of
-- the place it lives; they never meet, and `GOOGLE_DRIVE_CONNECTION_KIND`
-- (drive-source-factory.ts) is the one place the managed spelling is written.

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
    'google_drive'::text
  ])
);
