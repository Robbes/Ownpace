-- Who is in this organisation, and the one thing an operator does about it
-- somewhere else (owner request, 2026-08-31).
--
-- ## Why this widens a boundary that was drawn tight on purpose
--
-- Migration 0009 set the rule these views live by: metadata, never content,
-- and `support.tsx` states it as "there is no message, event, contact or file
-- here and there cannot be one". This view puts PEOPLE on the support surface
-- for the first time, so it is the diff somebody reads — which is exactly the
-- form 0009 said a widening had to take, rather than arriving quietly inside a
-- route.
--
-- The owner asked for it and named the use: an operator looking at an
-- organisation must be able to reach that person at the identity provider,
-- because the account-level things — a password nobody can reset, second
-- factor lost, an account to disable — are the provider's job and never
-- Ownpace's (ADR-0042). Without a name to click, "go and look in the console"
-- means searching a list by memory.
--
-- IT IS NOT A NEW CATEGORY OF EXPOSURE, which is the reason it is defensible
-- rather than merely wanted. An operator already reads customer email
-- addresses on the access queue and decides on them — `access_request` carries
-- the asker's address, and granting one is how these very memberships are
-- made. This is the same class of data, on the screen where support actually
-- happens, and every read of it is written to `support_read` against the
-- operator's name like every other read here.
--
-- ## What is NOT here
--
-- No name, no phone, no last-seen, no anything the person did. A membership is
-- an address, a role and a state — which is what "who may act on this
-- organisation, and how" needs and where it stops. `user_id` is the subject
-- the identity provider minted: opaque, useless to anybody who cannot already
-- sign in to that provider, and the ONLY thing that makes a link to the right
-- account possible at all.
--
-- REMOVED MEMBERS STAY VISIBLE, and that is deliberate: "this person used to
-- be the owner" is most of what a support conversation about a lost account is
-- about, and hiding it would make the screen answer a question it was not
-- asked. The state is served so the screen can say so rather than imply it.

CREATE OR REPLACE VIEW public.support_tenant_members AS
  SELECT
    m.tenant_id,
    -- The provider's subject. Never an Ownpace id, and never derived from the
    -- address: 0093 T6's rule that an operator is keyed on `sub` is the same
    -- rule, and for the same reason.
    m.user_id,
    m.email,
    m.role,
    m.status,
    m.invited_at,
    m.joined_at
  FROM public.tenant_member m
  WHERE EXISTS (
    SELECT 1 FROM public.platform_operator
     WHERE user_id = current_setting('app.current_user'::text, true)
  );

GRANT SELECT ON public.support_tenant_members TO app_user;

COMMENT ON VIEW public.support_tenant_members IS
  'Who may act on an organisation, for the operator''s screen: address, role, state, and the identity provider''s subject so the screen can link to that account where the account-level work is actually done (ADR-0042). The first support view carrying people — owner request 2026-08-31 — and no wider than a membership. Guarded by the same platform_operator predicate as every support view, and read through support_read like every other.';
