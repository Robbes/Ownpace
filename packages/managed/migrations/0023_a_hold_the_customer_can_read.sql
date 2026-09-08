-- A hold the operator declares and the customer can read.
--
-- ## Why this exists
--
-- Updating the platform means draining it: stop starting passes, let the ones
-- in flight finish, deploy, start again. The stopping half was possible before
-- this (stop the scheduler) and the SAYING half was not — nothing on a
-- customer's screen could carry a sentence from us. `PlatformStatus` (0110 T5)
-- is probed facts: readiness this process computes, and a status page whose
-- JSON we read. There is nothing writable in it, by design.
--
-- Of the three things that can stop a migration, this is the only one the
-- customer can neither derive nor wait out predictably. A pass deadline is
-- invisible and self-correcting; a daily download ceiling explains itself and
-- names its own reset time; a hold is a decision somebody made, and without a
-- row like this it looks exactly like a broken migration.
--
-- ## A log, not a switch
--
-- Rows accumulate: `started_at`, and `ended_at` when the hold is lifted. The
-- OPEN hold is the row with `ended_at IS NULL`, and the partial unique index
-- below means there can be at most one — the database refuses a second rather
-- than leaving two half-true holds for a screen to choose between.
--
-- History is kept because "when were we down, and what did we tell people"
-- is a question that gets asked afterwards, and an UPDATE-in-place switch
-- answers it with the current value and nothing else.
--
-- ## Platform-wide, in this version
--
-- The owner's answer of 2026-08-27, on the same question one level up:
-- *platform-wide is enough*. A per-tenant hold is a different feature (it
-- would need to say WHICH customer and why, and would arrive on a screen
-- beside a platform one), and nothing here forecloses it.
--
-- ## Who may read it, and who may write it
--
-- Everyone signed in may read the OPEN hold: it is the sentence that explains
-- their own screen, and withholding it is the failure this table exists to
-- fix. Only an operator may read the history, and only an operator may write
-- at all — enforced here, and again by `WHERE EXISTS` inside the writes
-- themselves (the `recordSupportRead` pattern from 0009), so a non-operator's
-- request changes nothing and is told nothing rather than being handed a
-- policy error to read meaning into.

CREATE TABLE public.platform_pause (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    started_at timestamptz NOT NULL DEFAULT now(),
    -- NULL means the hold is still on. Set when it is lifted; never unset.
    ended_at timestamptz,
    -- The operator's own words, shown VERBATIM to customers. Optional: the
    -- screen carries a default sentence, so a hold is never wordless because
    -- somebody was in a hurry.
    message text,
    -- The OIDC subject that started it, and the one that ended it. This IS the
    -- record of who did it — there is no separate audit row to fall out of
    -- step with the fact.
    started_by text NOT NULL,
    ended_by text,
    CONSTRAINT platform_pause_pkey PRIMARY KEY (id),
    -- A hold cannot end before it began.
    CONSTRAINT platform_pause_ends_after_start CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- At most one hold open at a time. Two would leave every reader choosing which
-- sentence is the real one, and a screen that picks is a screen that can pick
-- wrong.
CREATE UNIQUE INDEX platform_pause_one_open
    ON public.platform_pause ((ended_at IS NULL))
    WHERE ended_at IS NULL;

-- The tick reads this every minute; the index keeps that a lookup rather than
-- a scan that grows with the history the table deliberately keeps.
CREATE INDEX ix_platform_pause_open ON public.platform_pause (started_at DESC)
    WHERE ended_at IS NULL;

ALTER TABLE public.platform_pause ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.platform_pause FORCE ROW LEVEL SECURITY;

-- The open hold is public to signed-in users. No GUC is consulted on purpose:
-- this policy must hold for a customer read that resolved a TENANT and never
-- set `app.current_user`, and the row carries nothing tenant-specific.
CREATE POLICY open_hold_is_readable ON public.platform_pause
    FOR SELECT
    USING (ended_at IS NULL);

-- An operator sees all of it, open and closed.
CREATE POLICY operator_reads_every_hold ON public.platform_pause
    FOR SELECT
    USING (EXISTS (
      SELECT 1 FROM public.platform_operator
       WHERE user_id = current_setting('app.current_user'::text, true)
    ));

CREATE POLICY operator_starts_a_hold ON public.platform_pause
    FOR INSERT
    WITH CHECK (EXISTS (
      SELECT 1 FROM public.platform_operator
       WHERE user_id = current_setting('app.current_user'::text, true)
    ));

CREATE POLICY operator_ends_a_hold ON public.platform_pause
    FOR UPDATE
    USING (EXISTS (
      SELECT 1 FROM public.platform_operator
       WHERE user_id = current_setting('app.current_user'::text, true)
    ));

GRANT SELECT, INSERT, UPDATE ON TABLE public.platform_pause TO app_user;
-- A hold is never deleted: the history is the point.
REVOKE DELETE ON TABLE public.platform_pause FROM app_user;

COMMENT ON TABLE public.platform_pause IS
  'Operator holds on starting new sync passes. The open hold is the row with '
  'ended_at IS NULL, and at most one may exist. Readable by every signed-in '
  'user while open — it is the sentence that explains their screen — and '
  'writable only by a platform operator.';
