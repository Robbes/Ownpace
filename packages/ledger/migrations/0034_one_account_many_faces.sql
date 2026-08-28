-- One account, several faces: the `google` connection kind (workplan 0106 T3b,
-- the owner's decision of 2026-08-27).
--
-- ## What was wrong with four kinds
--
-- Google is `gmail`, `google_calendar`, `google_contacts` and `google_drive`,
-- and each serves exactly ONE domain (`SOURCE_TYPE_DOMAINS`). So one Google
-- account being migrated for mail and calendar is two connections, two OAuth
-- grants, two consent screens — for one account, one person, one password.
-- That is not how anybody thinks about their own Google account, and 0106's
-- whole premise (*"reuse credentials across discovered object types"*) stopped
-- at the provider most customers actually come from.
--
-- `soverin` already showed the other way (0106 T4): one row, one credential,
-- three domains, capability read off the measured record and `kind` used only
-- to resolve a protocol.
--
-- ## Provider-shaped, not Google-shaped
--
-- The owner's framing, and it is the more useful design: *"one can tick
-- 'google' and pick the object types to ask a grant for… since we will have
-- this more often — Soverin will add Nextcloud for files later this year."*
--
-- So this migration adds a kind, and the code above it adds a ROW to a
-- provider table rather than a Google branch. When Soverin gains a file face,
-- that is one entry in `PROVIDER_DOMAINS`, not a second implementation. The
-- #597 guard still holds: no new `switch (kind)` fork — kind resolves the
-- protocol and nothing else, capability is read off the record.
--
-- ## Why this kind carries calendar and contacts, and not yet mail or files
--
-- Not a technical limit — a pricing one, and Google's rather than ours.
-- `docs/google-oauth-verification.md:50-51` records the tiers: calendar and
-- carddav are **sensitive** scopes (brand verification; free), while Gmail's
-- `https://mail.google.com/` and `drive.readonly` are **restricted** (the
-- above PLUS an annual third-party security assessment). A single consent
-- inviting all four would push the MANAGED client into the restricted tier for
-- every customer, including one who only ever wanted their contacts.
--
-- That binds the managed client alone. An appliance registers its own OAuth
-- client and does its own verification (ADR-0041), so nothing here is a
-- limit on the code — only on what the managed service may currently ask for.
--
-- ## The four existing kinds STAY, and that is the plan rather than debt
--
-- `gmail`, `google_calendar`, `google_contacts` and `google_drive` remain
-- valid and untouched. The owner's words: *"during we do not yet support all
-- 4, it can cohabite."* Every connection anybody has already made keeps
-- working exactly as it did; a person who wants mail today still uses `gmail`.
-- When the assessment is bought, mail and files join `google`'s domain list
-- and the single-domain kinds become the migration path rather than the shape.
--
-- WIDENING ONLY: every existing value stays valid, no row is touched, and the
-- constraint is dropped and recreated inside the migration's transaction —
-- the same shape as 0008/0012/0015/0018/0019.

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
    'google'::text
  ])
);
