# 0102 — Who your account is, and how you change it

## Status — 2026-08-25 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Record the invariant | ✅ **Done 2026-08-25** | `sub` is the identity, email is a label. ADR-0042 amended below. Nothing here is built yet; this is the decision the three tasks depend on. |
| T1 Gate the paste box on the API's runtime mode | ✅ **Done 2026-08-25** | `GET /api/auth/mode` answers `acceptsSeedToken`, derived from `selectAuthMode` in one place. `Login.tsx` renders nothing until it has that answer, hides the box entirely in managed mode, and names the state where neither credential is available. Rules in `scripts/a-box-the-api-would-refuse.unit.test.ts`. |
| T2 Federation, with account linking decided BEFORE it is offered | ⬜ Not started | — |
| T3 Change your address, verified before the switch | ⬜ Not started | — |

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

## What this workplan does NOT cover

Calendar and file **scheduling mail sent by a migration target** — issue #493.
Same catcher, entirely different failure: writing an event with `ATTENDEE`s can
make the target invite every attendee to a meeting that already happened, and
mail cannot be un-sent. It belongs with the migration domains, not with identity.
