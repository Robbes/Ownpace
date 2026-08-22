# 0095 — Telling somebody they are in

## Status — 2026-08-22 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 **The account that does not exist** (owner) | ✅ **Decided 2026-08-22: A, self-registration — and built** | Granting creates the organisation and an invitation. It does **not** create an account at the identity provider, and [ADR-0042](../adr/0042-who-holds-the-passwords.md) forbids us from doing so. `setup-zitadel.sh` now turns self-registration on and **reads the setting back** rather than trusting the call — `api` runs `curl -sS` without `-f`, so an HTTP error exits 0, and this particular silent no-op surfaces days later in front of a customer who cannot sign in. Its refusal names the console path to set it by hand. 3 guard cases. |
| T1 The event and its two languages | ✅ **Done 2026-08-22** | A new `access_granted` kind on the existing union, EN + NL, with 0030 T1's compile-time key parity. Four cases, and the one that matters asserts the body carries **no link, code or token**: the only URL is the app address, and it has no query or fragment that could smuggle one in. |
| T2 A recipient who is not a member yet | ✅ **Done 2026-08-22** | `apps/api/src/access-notify.ts` — the digest's shape (one transport, many envelopes) for a recipient who is deliberately not a member. Returns one of three outcomes rather than deciding what they mean: `sent`, `off` (no SMTP — nobody will ever be told) and `failed` (we tried, something is broken). Those imply different next actions for the operator, so they stay three. 3 cases, including that it never rejects. |
| T3 The caller, outside the transaction | ✅ **Done 2026-08-22** | After the commit and outside it. The outcome is returned to the operator in the response, because "nobody was told" means the manual step is back and they are the only one who can take it. `WEB_URL` is **refused** rather than defaulted: a grant email carrying `http://localhost:3123` has told somebody to go nowhere, and would go out looking exactly like a successful one. |
| T4 Deliverability | 📋 Planned — **needs DNS, so it is the owner's** | SPF, DKIM and DMARC for the sending domain. Without them this lands in spam, and "we emailed you" becomes "we did nothing" from the customer's side. |
| T5 The decline email | 📋 Planned, and deliberately after T1–T4 | Saying no is a courtesy too, and a harder one to word. Not blocking the first customer. |

## The gap that is not about email at all

Workplan 0093 finished with the honest note that granting creates an organisation
and then *somebody has to tell the person by hand*. That reads like a missing
email. Underneath it is something bigger.

**A granted person has no account at the identity provider.** Granting writes an
Ownpace `tenant`, an `invited` `tenant_member` row addressed to their email, and
marks the request granted. All of that is in *our* database. Zitadel has never
heard of them.

The obvious fix — call Zitadel's management API and create the user — is
forbidden by ADR-0042's third operative rule:

> the integration must stay inside plain OIDC discovery + authorization-code +
> PKCE + JWKS. **No issuer-specific API**, no issuer-side tenancy model, no
> issuer-side roles.

That rule is what makes the issuer replaceable, it is enforced by
`no-issuer-lock-in.unit.test.ts`, and it was the owner's condition for accepting
Zitadel at all. So this is a real cost of a decision already made, surfacing where
decisions like that usually surface: two features later.

### Three ways out, and what each costs

| | What it means | Cost |
|---|---|---|
| **A. Self-registration at the issuer** *(recommended)* | Zitadel accepts anybody who registers. The email says "create your account with **this** address". `email_verified` then binds the invitation on first sign-in (0093 T6b), and somebody who registers **without** a grant lands on "your account is not part of an organisation yet" — the screen that already exists. | `setup-zitadel.sh` must configure it, and it is currently silent on the subject. Strangers can hold an issuer account that grants nothing. |
| **B. Create the user through Zitadel's API** | One call at grant time; the smoothest experience by far. | Breaks the operative rule, fails `no-issuer-lock-in.unit.test.ts`, and makes switching issuer a project again. Would need ADR-0042 amended, deliberately, in writing. |
| **C. The owner creates each account by hand** | Zitadel console, one user per customer. | Honest and free at five customers. Not a plan at fifty, and it puts a human step back in the middle of the flow this workplan exists to remove. |

**A is recommended** because the safety net it needs was already built: an
uninvited registrant sees a sentence explaining they are not in an organisation
yet, rather than a broken dashboard. That was written for a different reason
(0093 T7, platform operators) and turns out to cover this exactly.

What A is *not* is a security hole. An issuer account with no `tenant_member` row
can read nothing: every policy keys on `app.current_tenant` or `app.current_user`,
and `/api/me` answers "no organisations" without refusing. Registering gets you a
password and a sentence.

## What the email must not contain

**No token, no magic link.** The issuer owns identity (ADR-0042), so the mail
carries an address to visit and nothing that authorises anything. That is not a
limitation to apologise for — it is the property that means an intercepted or
forwarded invitation grants nobody anything, and it should be stated where the
next person is tempted to "improve" it by embedding a one-click link.

The binding happens on first sign-in against an address the issuer says it
**verified**, which is the check `see_own_invitation` and `claim_own_invitation`
enforce in the database (migration 0006).

## The shape T3 has to take

Granting is three writes or none, in one transaction. The email is **not** a
fourth write, and must not be inside it:

- a mail server that is down must not fail a grant **that already happened** —
  the row would roll back, the organisation would vanish, and the operator would
  see an error for something that was fine;
- equally the mail must only ever describe something that **did** happen, so it
  is sent after the commit, never before.

0030 T4 settled this exact ordering for `rollback_finished` and the reasoning
transfers verbatim: build the channel *before* acting so a misconfigured SMTP is
discovered while everything is still untouched, act, then send, and log a failed
send loudly without throwing.

**And the grant response should say which happened.** An operator who clicks
Grant deserves to know whether the person was told, because if not, the manual
step is back and they need to know to take it.

## What already exists, and is not being rebuilt

0030 built the whole channel and it is in good shape:

- the `Notifier` port with one method, so no policy accumulates in a transport;
- `MailTransport` as a *function type* in `@openmig/shared`, so the browser
  bundle never meets a mail library, with `smtp-transport.ts` the single
  nodemailer import in the workspace;
- `readNotifierConfig(env)` distinguishing **nothing set** (a stated default)
  from **half set** (somebody tried — it names the missing variables rather than
  going quietly off);
- EN/NL templates with compile-time key parity;
- managed already sending, from `managed-digest`.

This workplan adds one event kind, one recipient path and one caller. If it
starts to look like more than that, something has gone wrong.

## What the email deliberately does not do

**No link, no code, no token.** The issuer owns identity, so the mail authorises
nothing — which is what makes forwarding or intercepting it harmless. A test
asserts the only URL in the body is the app address and that it carries no query
or fragment, so the next person tempted to "improve" this into a one-click link
fails there first.

**It does not close with "open the app to take action."** Every other event does.
This one is read by somebody who has no account yet, so that line is an
instruction they cannot follow — and the one they DO need is three lines above.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-22).

T4 (SPF/DKIM/DMARC) and T5 (the decline email) remain. T4 needs DNS and is the
owner's; see [`first-live-run.md`](../first-live-run.md).
