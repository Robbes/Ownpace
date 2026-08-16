-- The sharing queue's rows (ADR-0032, accepted 2026-08-16; workplan 0052 T1).
--
-- Until now a grant discovered by the §14.2 inventory lived only inside a
-- rendered Markdown report — a fact the owner could read but nothing could
-- TRACK. ADR-0032 turns grants into rows so the owner works a checklist
-- instead of a document: every row is open until a person (or, for `apply`,
-- a person pressing the gated button) settles it, and the settled states keep
-- who decided and when.
--
-- Decisions survive rescans BY DESIGN: `grant_hash` is the grant's identity
-- (subject + what it is on + grantee + role + link-ness), so a rescan updates
-- `scanned_at` on a known row and inserts only genuinely new grants — it
-- never resets an owner's answered rows back to open. A grant that changes
-- shape (a new role, a new grantee) is a NEW hash and a new open row, which
-- is correct: the owner has not decided about THAT grant.
--
-- Four states, one direction:
--   open        — discovered, waiting on the owner
--   applied     — re-created on the target through its own share API
--                 (ADR-0032 §4: the target's invite IS the notification)
--   done_manual — the owner did it by hand and ticked it off
--   skipped     — the owner decided NOT to carry it over (recorded, so the
--                 completion report can say "deliberately not carried")
-- `open` is the only state with no decider; the CHECK below pins that.
--
-- No FK on mapping_id, mirroring `item`: the appliance's mappings are born
-- in config files, not in mailbox_mapping rows.

CREATE TABLE public.share_grant (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    mapping_id uuid NOT NULL,
    grant_hash text NOT NULL,
    subject text NOT NULL,
    on_label text NOT NULL,
    grantee text,
    role text NOT NULL,
    via_link boolean DEFAULT false NOT NULL,
    raw text NOT NULL,
    verdict text NOT NULL,
    verdict_target text NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    state_reason text,
    decided_by text,
    decided_at timestamp with time zone,
    scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT share_grant_pkey PRIMARY KEY (id),
    CONSTRAINT share_grant_state_check CHECK ((state = ANY (ARRAY['open'::text, 'applied'::text, 'done_manual'::text, 'skipped'::text]))),
    CONSTRAINT share_grant_verdict_check CHECK ((verdict = ANY (ARRAY['clean'::text, 'manual'::text]))),
    -- An open row has no decision on it; a settled row must say whose and when.
    CONSTRAINT share_grant_decided_check CHECK (((state = 'open'::text) = (decided_at IS NULL)))
);

-- Rescans upsert against this: one row per grant identity per mapping.
CREATE UNIQUE INDEX uk_share_grant_identity
  ON public.share_grant (tenant_id, mapping_id, grant_hash);

ALTER TABLE public.share_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.share_grant FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.share_grant FOR SELECT USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_insert ON public.share_grant FOR INSERT WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_update ON public.share_grant FOR UPDATE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));
CREATE POLICY tenant_isolation_delete ON public.share_grant FOR DELETE USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.share_grant TO app_user;
