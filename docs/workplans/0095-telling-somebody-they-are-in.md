# 0095 — Telling somebody they are in

> **In one line:** Emailing granted and declined access requesters through `access_granted` and `access_declined` notifier events carrying no link or token, with Zitadel self-registration turned on by `setup-zitadel.sh`, and SPF/DKIM/DMARC for the sending domain.

## Status — 2026-10-30 (update this block at the end of every session)

**2026-10-30: T6 lands in alpha.3, not alpha.4 (the owner: *"I want #1729 earlier"*).** It merges
before alpha.3's CHANGELOG fold, after CI and E2E (managed) on its branch, so live takes it with
the alpha.3 tag. Live's proof is that deploy's smoke, which reads the registration page the link
leads to, and a grant on live after it: the registration form shows the granted address.

**2026-10-29: T6, the grant mail's link fills in the address at registration.** The owner,
after their own grant on live: *"I needed to register an account again. While I thought I
already filled in my data when asking access to the alpha."* The link now ends in `#register=`
and the granted address, and the sign-in page offers "Create your account", which asks the
issuer for registration with that address filled in (§T6 below). Still no token, and T0's
answer stands: we create no account. Branch `claude/ownpace-public-readiness-y7orc6-grant-prefill`,
draft, for alpha.4.

**2026-09-27: the sentence below that A is *not* a security hole holds only while every account
at the identity provider is in the project's own organisation.** Workplan 0135 §1 found the
chain that breaks it: anybody could found an organisation of their own there, and its owner can
make an account whose address the provider calls verified, which is what a grant is bound to.
0135 T1 and T2 close it: public organisation registration off, and the project admitting its own
organisation only, both set and read back by `setup-zitadel.sh` (branch
`claude/mailbox-sync-errors-c2xsw2-an-organisation-a-stranger-could-found`, not merged).
Self-registration, T0's choice, stays on.

| Task | Status | Evidence |
|---|---|---|
| T0 **The account that does not exist** (owner) | ✅ **Decided 2026-08-22: A, self-registration — and built** | Granting creates the organisation and an invitation. It does **not** create an account at the identity provider, and [ADR-0042](../adr/0042-who-holds-the-passwords.md) forbids us from doing so. `setup-zitadel.sh` now turns self-registration on and **reads the setting back** rather than trusting the call — `api` runs `curl -sS` without `-f`, so an HTTP error exits 0, and this particular silent no-op surfaces days later in front of a customer who cannot sign in. Its refusal names the console path to set it by hand. 3 guard cases. |
| T1 The event and its two languages | ✅ **Done 2026-08-22** | A new `access_granted` kind on the existing union, EN + NL, with 0030 T1's compile-time key parity. Four cases, and the one that matters asserts the body carries **no link, code or token**: the only URL is the app address, and it has no query or fragment that could smuggle one in. *2026-10-29 (T6):* the query is the mail's language (2026-10-17) and the fragment is the address the mail prints; still no token. |
| T2 A recipient who is not a member yet | ✅ **Done 2026-08-22** | `apps/api/src/access-notify.ts` — the digest's shape (one transport, many envelopes) for a recipient who is deliberately not a member. Returns one of three outcomes rather than deciding what they mean: `sent`, `off` (no SMTP — nobody will ever be told) and `failed` (we tried, something is broken). Those imply different next actions for the operator, so they stay three. 3 cases, including that it never rejects. |
| T3 The caller, outside the transaction | ✅ **Done 2026-08-22** | After the commit and outside it. The outcome is returned to the operator in the response, because "nobody was told" means the manual step is back and they are the only one who can take it. `WEB_URL` is **refused** rather than defaulted: a grant email carrying `http://localhost:3123` has told somebody to go nowhere, and would go out looking exactly like a successful one. |
| T4 Deliverability | 📋 Planned — **needs DNS, so it is the owner's** | SPF, DKIM and DMARC for the sending domain. Without them this lands in spam, and "we emailed you" becomes "we did nothing" from the customer's side. |
| T6 **A link that fills in the address** (owner, 2026-10-29) | ✅ **Built 2026-10-29; #1729, for alpha.3 (the owner, 2026-10-30)** | The grant mail's link ends in `#register=<address>` (`registrationLink`, `packages/shared/src/registration-link.ts`); the invitation mail keeps the bare page. Opened from it, `Login.tsx` shows "Create your account" / "Maak uw account aan" with the address, then "Already have an account?" and Sign in, and no request link; the button sends `prompt=create`, `login_hint` and `ui_locales`, plain Sign in sends exactly the seven parameters it always did. Only behind the request link's own gate (`acceptsSeedToken: false`). `smoke-managed.sh` reads the provider's registration page. Owner's choices: a button, not a redirect; the provider's `login hint invalid` info line accepted (§T6). |
| T5 The decline email | ✅ **Done 2026-08-22** | Saying no is a courtesy too. `access_declined` carries **no fields at all** — no reason, no organisation, and above all not the operator's note, which the queue labels "not for them". An **"email them if you decline" toggle, defaulted ON**, lets an operator clear junk without mailing a stranger, and the four outcomes (`sent` / `off` / `failed` / `skipped`) now reach the screen instead of stopping at the API. |

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

*2026-09-27:* this holds while nobody can found a second organisation at the identity provider.
See the Status block above, and workplan 0135 T1 and T2.

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

*2026-10-29 (T6):* the URL now carries the mail's language as its query (the UX sweep,
2026-10-17) and, in the grant mail only, the granted address as its fragment. The test now
pins exactly that link, one `#`, and an address that reads back as the one the mail prints;
it still fails on anything token-shaped. A link with an address in it authorises nothing: the
binding still waits for the issuer to verify that address with a code.

**It does not close with "open the app to take action."** Every other event does.
This one is read by somebody who has no account yet, so that line is an
instruction they cannot follow — and the one they DO need is three lines above.

## T5 — saying no

### The note is not the reason, and the type is what keeps it that way

The queue's decision field is labelled **"Note (for you, not for them)"** in both
languages. That is a promise made on a screen, and the place to keep it is not a
careful `renderEvent`: it is a type with **no fields**. `access_declined` carries
nothing, so there is nothing to pass in and nothing to leak — a later "just
include the reason, it is friendlier" has to change the shape first, and fails at
the test that asserts the event is only its kind.

There is also frequently no reason that would help. *"Not right now"* is the
honest one; *"not yet"* is a promise nobody made, and naming criteria invites an
argument about them with somebody who is already disappointed. The body says a
person read it and that a reply reaches a person, and stops.

### Declining can be quiet. Granting cannot.

The access form is public and rate-limited, so junk reaches the queue —
and mailing a refusal to a forged address means mailing a stranger who never
wrote to us. So a decline carries a **`notify` flag, defaulted to `true`**:
silence is something an operator chooses, never something they fall into by
forgetting to tick a box, and the confirmation dialog asks the matching question
rather than one wording for both.

A grant has nothing to opt out of. An unannounced grant is one the person can
never use, because the email is the only thing that tells them the door exists.
The asymmetry is the point, and it is why `notify` lives on `DeclineSchema`
rather than on the shared `DecisionSchema`.

### `skipped` is a fourth outcome, not a fourth kind of failure

`tell` still returns three: `sent`, `off`, `failed`. `skipped` is a decision a
human made, so it is added by the **route**, not by the module that reports on
attempts — this was not one. They are four rather than a boolean because each
asks something different of the operator, and collapsing `off` into `skipped`
would tell somebody to go and email a person they had deliberately ignored.

### The answer reached nobody until now

T3 returned `notified` to the operator, and the screen threw it away: the card
that knew the outcome unmounts the moment the row leaves the tab it was in. So a
grant that emailed nobody looked exactly like one that did. The outcome is now
lifted to the page and reported on both decisions, which is the half of T3 that
was only true down to the API boundary.

## T6 — a link that fills in the address

The owner asked for access on live, was granted, and at the sign-in service typed the same
address again, with first and last name, a password twice and the terms (2026-10-29). Only the
address can be carried over: OpenID Connect has no standard parameter for names, and the
registration form has no passkey option (a passkey is added after sign-in, as today).

**How.** `registrationLink(appUrl, locale, email)` writes `…/login?locale=<l>#register=<encoded
address>`; `addressFromRegistrationLink(hash)` reads it back, and anything that is not an
address of at most 320 characters reads as null, which is today's page. One module for both
halves, so the key and the encoding cannot drift apart. `beginSignIn(config, { create,
loginHint, uiLocales })` adds `prompt=create` (Initiating User Registration via OpenID Connect
1.0), `login_hint` and `ui_locales` (OIDC Core §3.1.2.1): standard parameters, read from no
provider's URL shapes, so ADR-0042's replaceable issuer holds and needs no amendment.

**Where the address goes.** After `#`, so no request carries it from the link: not our nginx
log, not the API, not the reverse proxy in front of the stack. The page never sends it to the API either, so
it cannot be used to learn whether an address was granted, and its words claim no grant. It
leaves the browser only when the person presses the button, as the `login_hint` of the
authorize request to the provider, which is where they would have typed it anyway.

**One new log line, accepted (owner, 2026-10-29).** Zitadel logs `login hint invalid` at info
with the hint, for every hint that matches no account, which is everybody the button is for. It
lands in the provider's own container log on our own machine, kept as that log is kept
(privacy §9). Privacy 1.0 stays literally true (§4.5: server logs "are not free of names"); an
HTML comment there names the line, and the sentence goes into the next privacy version. Turning
the provider's log level to `warn` was the alternative, and it also takes away the lines the
bring-up guide reads.

**A button, not a redirect.** A mail scanner that runs scripts would otherwise start
registrations; somebody who already has an account gets the choice; and the page already
waits for the API's answer about what it accepts.

**What the person sees depends on the login policy.** Zitadel's login v1 fills in the address
only where registration offers no outside provider (`renderRegisterOption` at v4.20.0). Live
refuses every `IDP_*` key, so live gets the filled-in form. OTA and E2E (managed) offer Google,
so there the provider asks "how do you want to register" first, and the address field after it
is empty: expected, and no prediction for live. `smoke-managed.sh` knows both answers and reads
the policy to choose. If the hint matches an account that exists, Zitadel selects it and asks
for its password instead, so somebody who registered already falls through to sign-in.

**Unchanged.** The invitation mail (`member_invited`) keeps the bare sign-in page; the mail's
words, including "Use this account:" with the same address; the request form and its
always-201 answer; the binding, which still needs an address the issuer verified.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-22).

T4 (SPF/DKIM/DMARC) remains. It needs DNS and is the owner's; see
[`first-live-run.md`](../first-live-run.md).
