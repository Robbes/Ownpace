# 0099 — An invitation you can answer

## Status — 2026-08-23 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Stop claiming invitations silently | ✅ **Done 2026-08-23** | `claimInvitations` is gone. `pendingInvitations` READS; `acceptInvitation` and `declineInvitation` each act on ONE named organisation. `/api/me` reports rather than binds, and `authenticate` no longer joins anybody on the way past — its 403 now names the unanswered invitation instead of saying "no membership". |
| T2 Somewhere to record a refusal | ✅ **Done 2026-08-23** | Managed migration 0008: `'declined'` joins the status check, `decline_own_invitation` is bounded from both sides, and `see_own_answered_invitation` makes the produced row visible — see below, that last one is the whole difficulty. |
| T3 Reading the organisation that invited you | ✅ **Done 2026-08-23** | `see_tenant_you_were_invited_to` (managed 0008) plus ledger 0028, which stops the four `tenant` policies RAISING on the empty string. Either one missing gives the same broken screen. |
| T4 The three answers, on screen | ✅ **Done 2026-08-23** | `apps/web/src/pages/Invitations.tsx` — Join / Decline / **Not now**. `AuthCallback` routes there ahead of both existing cases, including for somebody who already belongs somewhere. EN + NL. |
| T5 Zitadel in the managed gate | ✅ **Done 2026-08-23** | Added to `bootstrap-managed.sh`'s explicit service list, and `setup-zitadel.sh` is now INVOKED — nothing had ever invoked it. `scripts/identity-in-the-gate.unit.test.ts` pins both. |
| T6 The smoke answers an invitation three ways | ✅ **Done 2026-08-23** | Accept, decline and skip over real HTTP against the running API, plus issuer discovery and JWKS. Skip is asserted as an ABSENCE — no request is made, and the guard fails if `T3` ever appears in a URL. |
| T7 A real browser sign-in in the smoke | 📋 **Planned, and honestly not done** | See "what is still owed". |

## What changed, and why it had to

An invitation used to accept ITSELF. `claimInvitations` bound every open
invitation addressed to your verified email the first time you signed in —
silently, as a side effect of reading your own account.

That was defensible while the only invitations were ones an operator had just
granted and emailed you about. It stopped being defensible the moment anybody
could be invited to a second organisation: **reading `/api/me` joined you to
things**, and there was no moment at which anyone could say no.

Adding "decline" is therefore not a feature bolted onto the side. It requires
the silent accept to go, because a choice you are never offered is not a choice.

## Three answers, and only two of them are writes

| | What happens |
|---|---|
| **Join** | `status` → `active`, and the row binds to this subject. Migration 0006's policy, unchanged. |
| **Decline** | `status` → `declined`, and the row binds to **nobody**. |
| **Not now** | Nothing at all. No request, no state. It is offered again next time. |

Skip having no endpoint is the design. "I have not decided" is the absence of a
decision; writing it down would turn a deferral into a record somebody has to
reason about later, and would need its own answer to "when does this expire".

## The hard part was not the refusal. It was seeing it.

The decline was refused by RLS with `new row violates row-level security policy`
from `ExecWithCheckOptions`, against a `WITH CHECK` whose every conjunct
evaluated **true** when queried in the same transaction. It was still refused
with the check reduced to a literal `true`.

Migration 0006 already records that an UPDATE whose WHERE clause reads the row
has SELECT policies applied to it as well. This is that lesson one step further:
**the SELECT policies must also admit the row the update PRODUCES.**

Accepting never noticed, and that is why nobody had hit this. Its new row
carries `user_id = <this subject>`, which `own_membership_select` matches — so
the destination was visible by accident of what accepting happens to write.

A declined row carries `status = 'declined'` with the `pending:` id still on it,
and matches nothing: not `see_own_invitation` (no longer `invited`), not
`own_membership_select` (the id is not this subject), not
`tenant_isolation_select` (no tenant scope). Invisible — so the write was
refused.

`see_own_answered_invitation` fixes it, and is right on its own terms: **you may
see the answer you gave.** Without it, declining is an act whose result you are
not allowed to look at.

## Declining names nobody, and that is enforced

The obvious implementation sets `user_id` the way accepting does. It must not:
that writes a permanent link between a person and an organisation they refused,
into a table that organisation's operator can read.

The `WITH CHECK` pins `user_id LIKE 'pending:%'`, and that half is load-bearing
for a second reason. Membership is unique per (organisation, subject), so

```sql
SET status = 'declined', user_id = '<victim>'
```

— the same statement with one field changed — would permanently block a chosen
person from ever joining a chosen organisation. A denial of service written as a
refusal. No application code distinguishes the two, which is why the bound is a
policy and not a code review.

## The identity provider was never in the gate

`zitadel` went into `managed.yml` in #496 and into **neither** of the two
hand-maintained lists that would have started it: `bootstrap-managed.sh`'s
explicit service list, and — it turns out — nothing at all invoked
`setup-zitadel.sh`, which is documented as a step a person runs by hand.

So for three weeks the identity provider was defined, its secrets were required
by every compose command (which is how E2E (managed) #34–#36 died, workplan
0098), and it was **never started and never configured**. The nightly was green
throughout and said nothing about whether anybody could sign in.

That is the fourth hand-maintained list to drift in four days — `MOUNTS` (0096),
the `pull_request` trigger filters (0097), the pre-flight env list (0098), and
these two. Same treatment: pinned by a test that reads the scripts.

**One wrinkle, stated rather than hidden.** `web` is BUILT before
`setup-zitadel.sh` runs, and `VITE_` values are baked in at build time. On a box
where this is the first ever run, the web bundle carries no OIDC client id until
the next bring-up rebuilds it. The API half reads `JWT_ISSUER` at run time and is
unaffected, so the smoke's checks are honest either way — but a first-run demo
box needs a second bring-up before its login page works.

## What is still owed

**T7: the smoke does not drive a real browser sign-in.** It asserts that the
issuer is running and serving the exact document `oidc.ts` and `auth.ts` both
read, that its `jwks_uri` is fetchable, and that the declared issuer matches byte
for byte — and it exercises the invitation logic end to end over real HTTP with
tokens minted from the API's own secret, as every other check in that script
does.

What it does not do is obtain a token FROM Zitadel through the authorization
code flow. That needs its session API and a PKCE exchange, and it was not
written here for a reason worth recording: this environment has no Docker to run
it against and no network access to Zitadel's API documentation, so it would
have been several hundred lines of unverifiable shell against remembered
endpoint shapes — the exact recipe for a confident PR that turns the nightly red
again, two days after 0098 turned it green.

It is worth doing properly, against the live gate, where each step can be seen to
work.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-23).

**The bring-up and smoke changes are not proved by running them**, for the same
reason as 0098: they need the Spark. The scripts are pinned by tests that read
them; whether the gate goes green is the next dispatch's answer.
