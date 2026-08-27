-- A failure carries a CATEGORY, beside the prose and never instead of it
-- (workplan 0110 T3, the owner's six accepted and reframed 2026-08-27).
--
-- ## Why a column rather than a computation
--
-- `last_error` already holds what the provider said, and it is the precise
-- answer. It is also, for the person whose migration stopped, unactionable:
-- `{"error":"invalid_grant","error_description":"Token has been expired or
-- revoked."}` tells a customer nothing they can do. The category is the
-- coarse, actionable twin — six values, each chosen because it changes what
-- the reader does next.
--
-- Stored rather than derived on read, for two reasons. It is classified at the
-- moment of failure, where the message is freshest and nothing has travelled;
-- and re-deriving on every read would mean the answer silently changing under
-- a customer when the matcher is next edited, which is the opposite of a
-- record.
--
-- ## Who reads it, and why that decided the design
--
-- The CUSTOMER first — the owner's reframing on 2026-08-27: *"most of it must
-- be self-service. I'm to be contacted in rare / edge cases."* So this lives
-- in the SHARED chain, not the managed one: a self-hosted owner reading their
-- own failure deserves the same sentence, and the appliance has nobody to
-- escalate to at all.
--
-- The operator is the second reader (workplan 0110's metadata-only views).
-- That is the other half of why this column exists: `last_error` is free
-- provider prose that routinely carries a mailbox address, so an operator
-- under the metadata-only boundary may never see it. Without a category,
-- metadata-only support can see THAT a migration failed and never why.
--
-- ## Deliberately not an enum type, and deliberately not NOT NULL
--
-- `text` with no CHECK: the six are product vocabulary, expected to be
-- revisited against real incidents (`unknown` staying large is the signal),
-- and a database enum makes each revision a migration with a lock. The
-- application owns the vocabulary; `isFailureCategory` is the guard on the
-- way back in.
--
-- Nullable because a row that has never failed has no category, and 'unknown'
-- would be a claim rather than an absence. NULL means "no failure recorded";
-- 'unknown' means "a failure we could not classify" — and those are different
-- things a screen must not conflate.
--
-- ## Access
--
-- `migration_status` already has RLS, FORCE and its tenant policies. A column
-- inherits them, so this migration adds a column and says nothing about
-- access: the row's protection was already the right protection, and
-- restating it here would make a second place to get it wrong.

ALTER TABLE public.migration_status
  ADD COLUMN IF NOT EXISTS last_error_category text;

COMMENT ON COLUMN public.migration_status.last_error_category IS
  'What KIND of failure last_error was, in six values (workplan 0110 T3): '
  'auth_expired, rate_limited, quota_exceeded, target_refused, network, '
  'unknown. Beside the prose, never instead of it — last_error stays verbatim. '
  'NULL means no failure has been recorded; ''unknown'' means one was recorded '
  'and could not be classified, which is a different thing. Safe for an '
  'operator to read where last_error is not: it carries no address, no folder '
  'name and no subject.';
