# 0102 — Who your account is, and how you change it

## Status — 2026-08-25 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Record the invariant | ✅ **Done 2026-08-25** | `sub` is the identity, email is a label. ADR-0042 amended below. Nothing here is built yet; this is the decision the three tasks depend on. |
| T1 Gate the paste box on the API's runtime mode | ✅ **Done 2026-08-25** | `GET /api/auth/mode` answers `acceptsSeedToken`, derived from `selectAuthMode` in one place. `Login.tsx` renders nothing until it has that answer, hides the box entirely in managed mode, and names the state where neither credential is available. Rules in `scripts/a-box-the-api-would-refuse.unit.test.ts`. |
| T2 Federation, with account linking decided BEFORE it is offered | ⬜ Not started | — |
| T3 Change your address, verified before the switch | ✅ **Done 2026-08-25** | `/api/me` reports the verified claim and now RECONCILES the stored label to it — only on a verified claim, only on rows already carrying that subject, never on an invitation. The statement's `user_id` predicate is proved by an integration test that seeds a second member of the same organisation and shows they are untouched. Rules in `middleware/a-label-that-follows-the-claim.unit.test.ts`. |

## The invariant everything here rests on

**`tenant_member.user_id` is the token's `sub`.** Not the email. `lookupMemberships`
filters on `userId` and `status = 'active'`, and `resolveTenant` refuses when it
finds nothing — a 403 the web app turns into a forced sign-out.

Two consequences, and they point in opposite directions:

- **Changing somebody's email inside their existing account is safe by
  construction.** Same `sub`, same rows, nothing in Ownpace notices or needs to.
- **Anything that mints a NEW `sub` orphans the membership.** A second account
  for the same person — signed up by email in March, "Login with Google" in
  April — is a different subject, finds no `tenant_member` row, and is locked
  out of an organisation they are still a member of.

So the whole of this workplan is one question asked three times: *does this flow
preserve `sub`?*

## T1 — The paste box, gated on what the API will actually accept

`Login.tsx` renders the seed-token box whenever `oidcConfig()` is falsy, and
folds it behind a disclosure when it is not. That reads `VITE_OIDC_ISSUER`, a
**build-time** value.

The authority is elsewhere. `selectAuthMode(JWT_ISSUER, JWT_SECRET)` runs in the
API at **request time**, and the moment `JWT_ISSUER` is set it returns `managed`,
verifies against the provider's JWKS, and never falls back to `JWT_SECRET` —
deliberately, so a lingering secret cannot silently downgrade verification. A
seed token is signed with that secret. On such a stack it is well-formed,
unexpired, and unusable.

The two agree today only because `setup-zitadel.sh` writes both. They are still
two values in two processes, and the page is guessing.

**The break-glass argument for keeping the box is false**, and worth writing down
so nobody re-derives it: "if the provider is down, at least there is a way in"
does not hold, because managed mode refuses the seed token whether the provider
is up or down. It is not a safety net. It looks like one, which is worse.

**It cannot go unconditionally either.** A deployment that has not run identity
setup has no issuer, runs in `local` mode, and the seed token genuinely is the
only way in.

So: the API reports its mode, and the page renders what the API will accept. A
real break-glass path — if one is wanted — is a separate decision with its own
security argument, not a leftover textarea.

### Done 2026-08-25

`GET /api/auth/mode` — unauthenticated, like `/health`, because its reader has
no credential yet and it discloses only what the sign-in page already shows.

**It answers the question, not the inputs.** The body is
`{ mode, acceptsSeedToken }`, and the page renders on the second. Handing over
only `mode` would have made the page re-derive "managed means no" — the same
rule in a second process, which is the defect this task is about, moved one
layer down rather than removed. `mode` is reported alongside it for an operator
reading an answer that surprises them.

**Three states, all named.** The box shows only where `acceptsSeedToken`; in
managed mode it is gone rather than folded away, because a disclosure holding a
credential the API refuses is a drawer with nothing usable in it. Where the API
is managed and the bundle carries no issuer — the state #562 left behind — the
page says exactly that, naming `VITE_OIDC_ISSUER` and `VITE_OIDC_CLIENT_ID`,
since only an operator can fix it and they need the words to search for.

**A failure is not a fallback.** If the mode cannot be fetched, the page offers
neither credential and says why. Falling back to the box would invent a way in
on precisely the stacks that refuse it — and an API that cannot answer this
cannot verify a token either.

**Nothing renders while the answer is outstanding.** A box that appears and is
then taken away has offered a way in that was never there, which is the same
flicker, one frame earlier.

**Still to do, and deliberately not done here:** the issuer and client id
reaching the page the same way. They are still build-time values, which is why
the misconfigured state above can exist at all — the API could report them and
the bundle would stop needing a rebuild to change issuer. That is a change to
how the OIDC client bootstraps, with its own argument to make, not a rider on
this one.

## T2 — Federation, and the linking decision that must come first

ADR-0042's third operative rule forbids provider-specific code in the app, and
`no-issuer-lock-in.unit.test.ts` enforces it by scanning `apps/api/src`,
`apps/web/src` and `packages`. **A "Login with Google" button in the web app is
the one implementation CI will reject**, and correctly.

The permitted shape is the one the ADR already bought: Google goes into Zitadel
as a federated upstream. Zitadel still mints the token, `iss` is still ours,
`sub` is still a Zitadel subject. `tenant_member` never learns anyone used
Google. Adding it is deployment configuration, not app code — which is exactly
what "the issuer is replaceable" was supposed to buy.

**Account linking is not a detail to settle afterwards.** It is the difference
between the invariant above holding and being violated on the first user who
tries both doors. Decide, before the second method is offered:

- Auto-link on a verified email, or prompt the person to link?
- What happens when the upstream asserts an email that already belongs to a
  different Zitadel user?
- What happens when the upstream will not assert `email_verified` at all?
  (Migration 0006 already keys invitation binding on that claim.)

**On the product tension**, since it will come up: signing in with Google does
not put migrated data in Google — the custody claim is about the mail and files.
But for somebody whose goal is to leave Google, making Google the key to their
Ownpace account rebuilds the dependency somewhere new. Offer it; do not default
to it; and do not let it become the only method on an account.

## T3 — Changing your address, verified before the switch

Safe by the invariant — same `sub` — provided the change happens *inside* the
existing account rather than by creating a second one.

Verification before the switch, for two reasons. The obvious one: an unverified
address is a typo or somebody else's inbox. The second is specific to this
product — **open invitations are matched on the verified email**, so a change
that skipped verification would silently stop matching invitations addressed to
the old address without saying anything.

This is Zitadel's own flow, so T3 is mostly: make sure it is reachable, make
sure it sends (see #560 — the instance had no email provider at all until
2026-08-25, so every verification mail it composed was dropped), and make sure
the app reads the new address from `/api/me` rather than caching the old one.

### Where it already stands, 2026-08-25

**The app half is true.** `/api/me` answers `email: req.userEmail` — the
verified claim off the token, explicitly not the database — so the moment
somebody signs in after changing their address, the app shows the new one.

**The provider's half is reachable and its mail lands.** Sign-in through the
built-in login UI works end to end (#566, #571 — the outage was an ingress
rewriting the `Host` header, not this stack), and the instance now has an email
provider, proved by a verification mail arriving in the catcher.

### The gap this left, found by looking rather than by breaking

**`tenant_member.email` is written once and never updated.** Nothing in
`apps/api/src` writes that column after the row is created. So after a verified
address change:

- `/api/me` is right, because it reports the claim;
- the **member list other people see** is wrong — `routes/tenants/members.ts`
  selects `tenantMember.email`, so colleagues keep seeing the address somebody
  has just moved off;
- anything that later mails a member from that row would mail an inbox they no
  longer control. Nothing does today — `access-notify.ts` takes an explicit
  recipient — which is exactly why this is worth writing down before something
  does.

### What closing it would take, and why it is not done here

The label follows the verified claim, reconciled in `/api/me` — the one call
made once per sign-in, which is also the moment the claim is fresh. Four
constraints, and the last is why this is a decision rather than a tidy-up:

1. **Only when `email_verified` is true.** An unverified claim is a typo or
   somebody else's inbox, and migration 0006 already refuses to bind an
   invitation on one.
2. **Only rows already carrying this `user_id`.** An `invited` row is addressed
   to an email with no subject on it yet; rewriting one would be *claiming* an
   invitation, which workplan 0099 deliberately made an offer somebody answers.
3. **Through the tenant-scoped UPDATE policy**, not a new self-service one.
   Migration 0003 reasoned it out when it added `own_membership_select`:
   "reading which tenants you belong to is answering a question about yourself;
   changing your own role or admitting yourself to a tenant is not". That
   reasoning still holds — a self-service UPDATE policy could not restrict which
   COLUMN changes, because RLS is row-level.
4. **The statement must carry `user_id = <subject>`.** Without it, the
   tenant-scoped policy would happily rewrite the address of every member in
   that tenant. That blast radius is the reason this was recorded rather than
   built on the way past: it is a data-mutation path added to a read route, and
   it wanted a deliberate review rather than a commit at the end of a long
   afternoon.

### Built 2026-08-25, after that review

`reconcileMemberEmail` in `middleware/auth.ts`, called from `/api/me` — the one
request made on every sign-in, and the moment the claim is freshest.

**The decision is pure and the write is bounded.** `labelsToUpdate(rows, claimed,
verified)` returns the organisations whose label is behind, and nothing else
decides. It is case-insensitive, because the comparison decides whether to
WRITE: a provider that starts asserting `Rob@…` where it asserted `rob@…` is
asserting the same address, and calling that a change would put an UPDATE on
every sign-in for the life of the deployment.

**Read before write.** The ordinary sign-in — the one where nothing has changed
— costs one SELECT and no UPDATE at all. An integration case asserts
`updated_at` does not move on a second identical sign-in, because "idempotent"
is a claim worth measuring rather than asserting.

**The predicate is proved, not reviewed.** `me.integration.test.ts` seeds a
second member of the same organisation and checks their label is exactly as it
was found. That case fails if the `user_id` clause is ever deleted — which every
unit test that does not read the source would pass. A source-scanning rule
catches the same deletion in a unit run seconds after somebody makes it; the
integration case is what makes it true rather than merely written down.

**Reported, never masked, if it fails.** A label that could not be written must
not cost somebody their sign-in, so the error goes to the log with the subject
on it — never the address, which is what this endpoint exists not to publish —
and `/api/me` answers either way.

## What this workplan does NOT cover

Calendar and file **scheduling mail sent by a migration target** — issue #493.
Same catcher, entirely different failure: writing an event with `ATTENDEE`s can
make the target invite every attendee to a meeting that already happened, and
mail cannot be un-sent. It belongs with the migration domains, not with identity.
