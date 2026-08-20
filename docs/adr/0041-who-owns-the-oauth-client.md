# ADR-0041: Who owns the OAuth client — the managed edition brings its own, the appliance never does

- **Status:** Proposed — owner decision pending. Written 2026-08-20 after the owner hit the
  Google Workspace setup manual while adding a contacts source and asked why it could not
  simply be a consent popup.
- **Date:** 2026-08-20
- **Deciders:** owner
- **Relates to:** [ADR-0003](./0003-two-editions-one-core.md) (two editions, one core — the
  reason a single answer cannot serve both), [ADR-0033](./0033-domain-wide-delegation.md)
  (the Google twin of the O365 access model; per-user tokens are the default, DWD is opt-in),
  [ADR-0035](./0035-who-signs-in-and-who-gets-a-link.md) (*"the owner decides who gets a link
  to manage and **grant** their own migration"* — the grant link is where a consent screen
  belongs), [ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md)
  (the boundary that keeps a managed-only secret out of the appliance, and the walk that
  enforces it), [ADR-0037](./0037-keys-credentials-and-transport-floors.md) (one credential
  store; the token this produces is stored exactly like any other),
  [ADR-0014](./0014-cost-recovery-billing.md) (where the verification cost has to land).
- **Enables:** [workplan 0089](../workplans/0089-a-consent-you-can-click.md).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **The appliance never carries an Ownpace OAuth client secret.** Shipping one publishes it,
  which breaks Google's terms and makes one leak everybody's problem. Bring-your-own client
  stays the appliance's only mode, and `no-managed-leakage` (ADR-0036) is what keeps it true.
- **The managed edition brings its own verified client, and it is a managed-only secret** —
  `@openmig/managed`, same store and key provider as every other credential (ADR-0037). A
  managed customer clicks **Allow**; nobody opens a Google Cloud console.
- **Verification is bought per scope class, cheapest first.** Contacts and calendar are
  *sensitive* — brand review only. Gmail and Drive are *restricted* — brand review **plus** an
  annual third-party security assessment. So contacts and calendar ship on the managed client
  first, and mail and files stay bring-your-own until the assessment is actually paid for.
  Whatever is not yet covered says so on the page rather than failing at the consent screen.
- **Owning a client never widens a grant.** Same scopes, same per-user consent, same read-only
  posture, same revocation by the account holder in their own Google settings. What changes is
  who registered the client, not what the token can read — and the consent screen must show the
  scopes rather than a friendly summary of them.
- **Never "External + Testing" for a real migration.** Google expires refresh tokens after
  **seven days** in that publishing status, which reads as a random `invalid_grant` weeks in.
  Both editions' setup paths must steer to Internal (Workspace) or Production (personal), and
  the refusal for an expired token must name this cause first.
- **The assessment buys CONVENIENCE, never CAPABILITY, so it is always deferrable.** Every
  source is migratable today at zero cost through the customer's own client — Workspace via
  Internal consent, personal Google via External+Production. What an assessment buys is a popup
  instead of a console, for consumers, in the managed edition. Nothing is ever gated behind it,
  and if it is paid it is funded like every other cost (ADR-0014), never as a line named after
  a Google audit.
- **An ACCOUNT password is closed; an APP password is not. Do not conflate them** — this ADR did,
  in both directions, in one sitting. Google withdrew account-password sign-in for third-party
  clients ([answer/6010255](https://support.google.com/mail/answer/6010255)) **and separately
  keeps app passwords as the documented fallback** *"als Inloggen met Google niet beschikbaar is
  voor de app"* ([answer/185833](https://support.google.com/accounts/answer/185833)), 2SV
  required, and labelled *afgeraden*.
- **Personal Gmail may therefore be connected with an app password, as an opt-in fallback that is
  never the default.** Gmail is already an IMAP source (`gmail-source-factory.ts:218`) and
  `imapflow-source.ts:129–132` already carries the plain-password branch, so this is a credential
  choice rather than a connector — same folder view, same Message-ID natural key, no fidelity
  loss. It must be offered with Google's own discouragement quoted, not laundered.
- **It narrows the restricted-scope exposure to Drive alone**, which is the practical point:
  contacts and calendar are *sensitive* (cheap verification), personal mail can avoid OAuth
  entirely, and Drive is then the only product for which an assessment could ever be worth
  buying. Workspace cannot use this (app passwords are withdrawn or admin-disabled there) and
  does not need to — Internal consent is already free.
- **Drive has no password path at all and we do not invent one.** No such protocol exists, and
  Takeout is a snapshot rather than a sync — this product sells a period, not a copy.
- **Gmail IMAP is always on since March 2025** (*"Vanaf maart 2025 is de optie om IMAP aan of uit
  te zetten niet meer beschikbaar. IMAP-toegang staat altijd aan in Gmail"*), so no setup path
  should ask a personal-account user to enable it, and no refusal should suggest it as a cause.

## Context

Every Google source authenticates with a per-user OAuth refresh token, and
`docs/google-workspace-setup.md` is the manual for obtaining one. It runs to five sections and
routes an operator through the Google Cloud console — create a project, enable an API,
configure a consent screen, create an OAuth client, then mint the token in Google's **OAuth
Playground**, a developer tool with its own gear icon and its own vocabulary.

The owner did this to migrate a contacts folder and asked the obvious question: *why not just
show me a Google popup, or take an app password?*

**Three separate things are tangled in that experience, and only one of them is forced.**

**1. The Playground step is not required by anything.** A grep of the whole codebase for
`redirect_uri`, `authorization_code` or any callback route finds nothing outside built `dist`
bundles. Ownpace has no OAuth flow at all; it only ever *consumes* a refresh token obtained
elsewhere. The wizard could perfectly well run the authorization-code round-trip itself against
the customer's own client — same custody, same secret, three fewer steps and no developer tool.
That is a missing feature rather than a trade-off, and it is [workplan
0089](../workplans/0089-a-consent-you-can-click.md).

**2. An app password is available for personal Gmail and for nothing else** — see *"Is there a
way round the assessment?"* below. For contacts the door was never open at all: they go over
CardDAV — `packages/orchestration/src/google-dav-source-factory.ts:51` requests
`googleapis.com/carddav/v1/principals/…` with scope `.../auth/carddav`. Google's CardDAV and
CalDAV endpoints have been OAuth-only from the start and never accepted a password of any kind.
Separately, Google withdrew app-password and less-secure-app sign-in for Workspace accounts
(believed September 2024 — **verify before quoting**). There is no password path to build.

**3. Owning the OAuth client is the part that is genuinely a decision** — and it is this ADR.

### Is there a way round the assessment? For mail yes, for files no

Asked by the owner after the first draft: could mail go over IMAP with an app password, dodging
the restricted Gmail scope, and does Drive have anything similar?

**This section was written wrong twice before it was written right, and the reason is worth
keeping**: Google publishes two withdrawal-shaped statements about two different credentials, and
they read as one if you are not looking for the seam.

> **The account password is gone.** *"Je kunt Gmail niet meer gebruiken met apps of apparaten van
> derden waarmee je je gebruikersnaam en wachtwoord van Google moet delen … Zoek in plaats
> daarvan de optie Inloggen met Google."*
> ([answer/6010255](https://support.google.com/mail/answer/6010255))
>
> **The app password is not.** *"Een app-wachtwoord is een toegangscode van 16 cijfers waarmee
> een minder goed beveiligde app … toegang krijgt tot je Google-account … Als Inloggen met Google
> niet beschikbaar is voor de app, kun je het volgende doen: App-wachtwoorden gebruiken."*
> ([answer/185833](https://support.google.com/accounts/answer/185833)) — 2SV required, and
> Google's own word for it is *afgeraden*.

Both quoted as supplied by the owner: this sandbox's egress proxy blocks `support.google.com`,
so neither page could be read here. **Re-read both before acting on this section.**

So an app password is a *supported, discouraged, 2SV-gated fallback* — not a closed door, and
not a blessed path either.

**And it fits this product almost too neatly.** Gmail *is* already an IMAP source —
`packages/orchestration/src/gmail-source-factory.ts:218` builds `buildImapSourceFrom({ host:
'imap.gmail.com', port: 993, tls: true }, { authType: 'XOAUTH2', tokenProvider })` — and
`imapflow-source.ts:129–132` carries a plain-password branch beside XOAUTH2, so a password
credential would have been a *config change rather than a connector*, with no fidelity loss at
all: same `GmailFolderView`, same dropped `\All`/`\Flagged`/`\Important` views, same
Message-ID natural key.

**So it is offered, and it is offered honestly.** An opt-in fallback for a **personal** Gmail,
never the default, with three things said rather than smoothed over:

- **Google discourages it**, in that word, and the setup path should say so instead of presenting
  it as the easy option. Somebody who would rather use a consent screen should be able to see
  that we agree with Google about which is better.
- **It is not scoped.** An OAuth token carries `https://mail.google.com/`, which is already full
  mail access, so for *mail* the width is the same — but an app password is a credential class
  rather than a grant, and it is revoked from a different place. Say where: the account's own
  app-password list, one row, revocable without touching Ownpace.
- **It may be withdrawn.** Google's direction of travel is unambiguous even though the door is
  open, so this cannot be the only consumer on-ramp. Its failure mode is not a rejected login at
  setup time — it is a migration that runs for weeks and then stops, on the tier whose whole
  promise is that it takes as long as you like.
- **And it inherits a ceiling nobody here counts.** Gmail's IMAP endpoint is reported to cap
  downloads around 2,500 MB/day, with a temporary account lockout as the penalty — and this
  repository counts requests, not bytes, and wires no IMAP source to a budget at all. That
  governs the **OAuth path already shipping** as much as this one, which is why it is
  [workplan 0090](../workplans/0090-the-cap-we-do-not-count.md) rather than a caveat here.

**Workspace cannot use it and does not need to.** App passwords are withdrawn or
admin-disabled there, and Internal consent is already free and banner-free.

**What this actually buys is a narrower question.** Contacts and calendar are *sensitive* —
verification, no assessment. Personal mail can now skip OAuth entirely. So **Drive is the only
product for which an assessment could ever be worth buying**, which is a much smaller decision
than "do we pay for restricted scopes".

One useful thing falls out of the first page: *"Vanaf maart 2025 is de optie om IMAP aan of
uit te zetten niet meer beschikbaar. IMAP-toegang staat altijd aan in Gmail."* IMAP is always on
for personal accounts, so no setup path should ask anyone to enable it and no refusal should
offer it as a cause.

**Drive never had anything equivalent, and inventing one would cost more than the assessment.**
There is
no password protocol — no IMAP, no WebDAV, no FTP. Three near-misses, and what each really is:

- `drive.file` is genuinely non-restricted, but reaches only files the app created or the user
  picked through the Google Picker. Whether a picked folder's grant survives as a durable
  server-side refresh token is **unverified**, and per-selection consent fits continuous sync
  badly.
- **Google Takeout** needs no OAuth at all and therefore dodges everything — but it is a
  one-shot snapshot: no deltas, no continuous sync, no cutover. That is the "sell a copy" model
  ADR-0014 defines this product against. A fallback, never a substitute.
- Borrowing another tool's published client id is a terms violation and is not considered.

**And the reframe still matters more than either answer.** Underneath all of it is the thing
that is easy to miss: the assessment is not standing between anyone and a migration. The customer's-own-client path is already free for
everyone: Workspace through Internal consent, personal Google through External+Production, whose
100-user cap is *per client* and so never binds when every customer has their own. **CASA buys a
popup, not a capability.** It is deferrable for as long as we like, and the honest description of
it is a convenience purchase for consumers in the managed edition.

## The question

May Ownpace register **one** OAuth client that customers consent to, so that adding a Google
source is a popup instead of a console?

## Decision (proposed)

### 1. Not in the appliance. Ever.

An appliance is software the customer runs. Embedding Ownpace's client secret in it means
publishing it — that is what shipping a secret to every customer means — which breaks Google's
terms and turns one extraction into everyone's incident. The appliance keeps bring-your-own,
and `no-managed-leakage`'s transitive import walk is already the guard that would catch a
regression, at no new cost.

This is ADR-0003 biting in the ordinary way: two editions, one core, and the honest answer
differs by who is running the software.

### 2. Yes in the managed edition, as a managed-only secret

The managed service is a service. It already holds a payment integration, a pricing table and
seven tables nothing else may import (ADR-0036). An OAuth client secret is the same shape of
thing and lives in the same place, encrypted by the same key provider as every other credential
(ADR-0037).

For a managed customer, adding a Google source becomes: click **Connect**, see Google's own
consent screen, click **Allow**. No project, no console, no Playground.

**And this is where ADR-0035's grant link finally pays off.** That ADR already decided that
*"only the migrated person holds their own source credential"* and that the owner sends each
person a link to grant their own migration. A link that opens a Google consent screen is that
sentence made real; a link that opens a five-section manual is not.

### 3. The scope classes decide the order, because they decide the price

Google sorts scopes into three classes, and the class — not the product — sets what
verification costs.

| class | examples | what Google requires |
|---|---|---|
| basic | `openid`, `email`, `profile` | nothing |
| **sensitive** | contacts, calendar | brand verification: privacy policy, domain ownership, a demo video, a review |
| **restricted** | Gmail (`https://mail.google.com/`), Drive (`drive.readonly`) | all of the above **plus an annual third-party security assessment** |

The exact classification of `.../auth/carddav` and `.../auth/caldav` — the two this product
actually uses for contacts and calendar — is **not verified here** and is the first thing to
check when this ADR is picked up, because it is the difference between a free path and a paid
one. Google's own scope list is the source; this sandbox's egress proxy blocks
`support.google.com`, so it could not be read while writing this.

So the order is cheapest-first: **contacts and calendar on the managed client, mail and files
left bring-your-own** until somebody has actually decided to pay for an assessment. A tier that
promises mail through a consent popup before that is a promise the product cannot keep.

### 4. Owning a client widens nothing, and the page must not let anyone think it does

Same scopes. Same per-user consent. Same read-only tokens. Same revocation, by the account
holder, in their own Google security settings, without asking us. The only thing that changes is
whose name appears on the consent screen — which is precisely why the consent screen must show
the scopes rather than a friendly summary, and why "Ownpace wants to read your contacts" is the
honest headline rather than "connect your account".

There is a real asymmetry to state and not bury: with a customer-owned client, deleting the
client kills every token instantly and that lever is theirs. With a managed client, revocation
is per-account in Google's settings, and the nuclear lever belongs to us. That is a genuine
reduction in customer control, bought with an enormous reduction in ceremony, and the managed
customer should be told which trade they are taking.

## Where the cost is

Four places. Two are real money, one is real time, one is a trap that costs nothing to avoid
and a lot to hit.

**0. First, what it is not: a blocker.** See *"Is there a way round the assessment?"* above.
Every source migrates today at zero cost through the customer's own client — Workspace via
Internal consent, personal Google via External+Production, whose 100-user cap is per client and
so never binds — and personal mail has a second free path through an app password over the IMAP
connector that already exists. The figures below price a *convenience*, and can be deferred
indefinitely without any customer being unable to migrate anything.

**1. The annual security assessment (CASA) — the only large number, and only for mail and
files.** Restricted scopes require a third-party assessment every year. Google's published
guidance has historically quoted a wide band — roughly **$15,000–$75,000** — while an
authorised-lab self-scan route (CASA Tier 2) has been reported far cheaper, in the **hundreds to
low thousands**, and Google has at times subsidised it. **All of these figures are unverified
and possibly stale; none may be quoted at a customer or put in a budget until re-checked.**
What is certain is the shape: it recurs annually, it is per-project, and it applies to Gmail and
Drive scopes. That is the whole reason for the cheapest-first ordering above.

**2. Brand verification — time, not money.** A privacy policy on the verified domain, domain
ownership, a demo video, and a review that has historically taken days to several weeks.
`ownpace.eu` and ADR-0029's public site already supply most of the inputs. Cost: attention, and
a delay before the managed consent screen stops showing a warning.

**3. Engineering — small, and mostly already paid.** Workplan 0089's flow is one redirect
endpoint, one callback, one state parameter and a wizard button. It reuses
`SecretStore.encryptCredentials` and follows the shape of the existing
`/google-drive/shared-drives` route, which already takes credentials in a request and calls
Google with them. The managed-client half is a config lookup on top of the same flow.

**4. The seven-day trap — free to avoid, expensive to hit.** An External app in **Testing**
publishing status has its refresh tokens expired by Google after seven days. A migration that
runs for months therefore dies every week, with `invalid_grant`, weeks after the person who set
it up stopped thinking about it. The current manual lists four causes of `invalid_grant` and
this is not among them. Cost of avoiding: one sentence. Cost of hitting it: a migration that
looks broken for reasons nobody can find.

**And where the cost is not.** The Internal path — a Workspace account consenting inside its own
organisation — needs no verification, no assessment and shows no warning banner. It is free
today, it stays free, and it is the right answer for every Workspace customer. This ADR buys
nothing for them; it buys the personal-Google case, which is Tiny and Small in ADR-0014's
table — the people for whom "create a Google Cloud project" is an unanswerable ask.

## Consequences

- A managed customer connects Google contacts and calendar in one click. Mail and files keep
  the manual until an assessment is paid for, and the page says which is which.
- A self-hoster's experience improves anyway, because workplan 0089's flow works against their
  own client and removes the Playground regardless of how this ADR lands.
- Ownpace becomes a Google-verified brand, with the ongoing obligations that carries: the
  privacy policy must stay accurate, the scopes must stay minimal, and a scope added carelessly
  can trigger re-verification.
- A managed client is a compromise surface that did not previously exist. It is one secret, in
  the managed store, and its blast radius is "attacker can run a consent screen in our name" —
  not "attacker reads customer data", since tokens are still per-user and stored separately.
- The appliance keeps a property the managed edition gives up: delete the client, kill every
  token, no vendor involved.

## Alternatives considered

**Publish one client and ship it in both editions.** The obvious answer, and it fails on the
first question: a secret in the appliance is a published secret. Rejected on Google's terms and
on ADR-0003.

**A "desktop app" client type with a loopback redirect, so the appliance can use a popup too.**
Works only when the browser is on the same host as the appliance — which is exactly not the
owner's setup, browsing to the box over the network. Kept as an open question for workplan 0089
rather than a decision, along with Google's limited-input-device flow, whose supported scope
list needs checking before anyone relies on it.

**Domain-wide delegation for everybody.** Already decided in ADR-0033: it is a second mode,
opt-in, for Workspace tenants with an admin in the loop. It solves the N-consents problem, not
the one-person-with-a-personal-Gmail problem, and it needs a Cloud console too.

**Charge separately for the managed client, to fund the assessment.** Rejected: ADR-0014 puts
every cost in one cross-subsidised envelope, and a line item named after a Google audit is
exactly the kind of cost-recovery-through-a-strange-name that amendment removed.

**Skip Google entirely for consumers and support only IMAP/CalDAV providers.** Rejected as
absurd for a product whose stated purpose is moving people off US cloud: Google is the source
that matters most.
