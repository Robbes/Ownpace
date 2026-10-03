# ADR-0041: Who owns the OAuth client — the managed edition brings its own, the appliance never does

- **Status:** **Accepted 2026-08-26** by the owner, as proposed, adding that the Drive assessment
  is intended **later** and that the client registered 2026-08-20 is the **test (OTA) client**,
  with production getting its own client before real customers exist; amended six times (latest
  2026-09-20); consolidated 2026-10-03 (ADR-0051)
- **Date:** 2026-08-20; accepted 2026-08-26; consolidated 2026-10-03
- **Deciders:** owner
- **Relates to:** [ADR-0003](./0003-two-editions-one-core.md) (two editions, one core),
  [ADR-0033](./0033-domain-wide-delegation.md) (domain-wide delegation, opt-in),
  [ADR-0035](./0035-who-signs-in-and-who-gets-a-link.md) (the grant link),
  [ADR-0036](./0036-the-managed-edition-is-its-own-package-and-its-own-chain.md) (the managed
  boundary and its walk), [ADR-0037](./0037-keys-credentials-and-transport-floors.md) (one
  credential store), [ADR-0014](./0014-cost-recovery-billing.md) (where a cost lands)
- **Enables:** [workplan 0089](../workplans/0089-a-consent-you-can-click.md)
- **History:** the record as it read before consolidation, word for word —
  [history/0041-who-owns-the-oauth-client.md](./history/0041-who-owns-the-oauth-client.md)

## Operative rules

<!-- What holds NOW, within the ADR-0051 budget: 8 bullets, 60 words a bullet, 300 words in
     all. Amend in place when a later decision changes it, then regenerate OPERATIVE.md:
     node scripts/adr-operative.mjs --write -->

- **The appliance never carries an Ownpace OAuth client secret**: bring-your-own is its only
  mode, held by `no-managed-leakage`. **A managed deployment brings its own verified client**, so
  a customer clicks **Allow** (*Decision* 1–2).
- **A connection's own client pair always wins; the deployment's** (`GOOGLE_OAUTH_CLIENT_ID`/
  `_SECRET`, option B) **is a fallback**, so the connection stores only its refresh token.
  **Both or neither**, at every door, API and worker alike
  (`a-client-the-worker-never-got.unit.test.ts`).
- **The assessment buys convenience, never capability**: every source migrates free through the
  customer's own client. Ownpace's published client adds Gmail and Drive (restricted) only once an
  assessment exists; Drive's is intended, not bought (*Decision* 3).
- **What a deployment's own application carries is declared** (`GOOGLE_ACCOUNT_SCOPE_CLASS`,
  default `sensitive`), and is not a capability: served by `/api/provider-accounts`, never
  mirrored into a build, gating making a mapping, never running one
  (`a-ceiling-the-screen-could-not-see.unit.test.ts`).
- **Owning a client never widens a grant**; the consent shows the scopes as scopes
  (`Grant.unit.test.tsx`, *Decision* 4).
- **Never "External + Testing" for a real migration.** Its refresh tokens die after **seven
  days**; setup steers to Internal or Production, and `invalid_grant` names that cause first
  (`google-token-provider.unit.test.ts`).
- **The client is registered exactly**: callback `/api/migrations/google/callback`, never
  `/webhooks/…`; no JavaScript origin; a client per environment; one canonical host. Its published
  surface and Limited Use commitments are true of the code (*Registering the client*).
- **Personal Gmail may use an app password** (not the closed account password): opt-in, never the
  default, Google's discouragement quoted (`gmail-source-factory.unit.test.ts`). Drive has no
  password path; nothing asks anyone to enable IMAP.

## Context

Every Google source authenticates with a per-user OAuth refresh token. On 2026-08-20 minting one
took five sections of `docs/google-workspace-setup.md` — a Cloud project, an API, a consent
screen, an OAuth client — and ended in Google's **OAuth Playground**, a developer tool. The owner
did that for a contacts folder and asked: *why not just show me a Google popup, or take an app
password?*

Three things were tangled there. **The Playground step was required by nothing**: Ownpace had no
OAuth flow of its own, a missing feature that [workplan 0089](../workplans/0089-a-consent-you-can-click.md)
T1 built against the customer's own client. **An app password exists for personal Gmail and for
nothing else** (*Mail and files without the assessment*). And **who owns the OAuth client is the
decision**: *may Ownpace register **one** OAuth client that customers consent to, so that adding a
Google source is a popup instead of a console?*

## Decision

The owner accepted points 1–4 below as proposed on 2026-08-26, and added two things the proposal
had left open:

1. **Drive, later.** The assessment is intended for Drive eventually — not bought now, not
   scheduled, and nothing waits on it (it buys convenience, never capability). Mail stays outside
   the assessment: bring-your-own plus the app-password fallback (0089 T7) cover it.
2. **One client per environment, starting now.** The client registered 2026-08-20 is the **test
   (OTA) client**; production gets its own client — with its own secret and exactly one redirect
   URI — before real customers exist. The configuration record is
   [`docs/google-oauth-verification.md`](../google-oauth-verification.md) §4b.

### 1. Not in the appliance. Ever.

An appliance is software the customer runs, so an Ownpace client secret inside it is a published
secret: against Google's terms, and one extraction becomes everyone's incident. Bring-your-own
stays the appliance's only mode, and `no-managed-leakage`'s transitive import walk
([`no-managed-leakage.unit.test.ts`](../../apps/selfhost/src/no-managed-leakage.unit.test.ts))
keeps managed-only code out of it. This is ADR-0003 biting in the ordinary way: two editions, one
core, and the honest answer differs by who runs the software.

### 2. Yes in the managed edition, as a managed-only secret

A managed deployment brings its own verified client — the same shape of thing as the service's
payment integration (ADR-0036) — so adding a Google source is: click **Connect**, see Google's own
consent screen, click **Allow**. No project, no console, no Playground. The client is the
deployment's configuration, stored by no connection (*The deployment's own client*, below); the
refresh token a consent returns is stored like every other credential (ADR-0037).

**And this is where ADR-0035's grant link finally pays off.** That ADR decided that *"only the
migrated person holds their own source credential"*, and that the owner sends each person a link
to grant their own migration. A link that opens a Google consent screen is that sentence made
real; a link that opens a five-section manual is not.

### 3. The scope classes decide the order, because they decide the price

| class | examples | what Google requires |
|---|---|---|
| basic | `openid`, `email`, `profile` | nothing |
| **sensitive** | contacts, calendar, tasks | brand verification: privacy policy, domain ownership, a demo video, a review |
| **restricted** | Gmail (`https://mail.google.com/`), Drive (`drive.readonly`) | all of the above **plus an annual third-party security assessment** |

The owner read the classes from the project's own console (2026-09-20; tasks 2026-09-23):
[`docs/google-oauth-verification.md`](../google-oauth-verification.md) §2. There is no
`.../auth/caldav` scope, a name this ADR first used: the product asks for `.../auth/calendar`,
whose row the page did not show, and whether its read-only sibling suffices over CalDAV is a
Stage 6 question in `docs/owner-test-runbook.md`.

So the order is cheapest first: **the sensitive faces on the managed client, mail and files left
bring-your-own** until an assessment has actually been paid for. An intent is not a purchase, and
a tier that promises mail through a consent popup before then is a promise the product cannot
keep. Whatever is not covered says so on the page rather than failing at the consent screen.
This binds the client Ownpace publishes to strangers; a deployment's own application declares for
itself (below).

### 4. Owning a client widens nothing, and the page must not let anyone think it does

Same scopes, same per-user consent, same read-only posture, same revocation by the account holder
in their own Google settings. Only the name on the consent screen changes, which is why the page
shows the scopes as scopes rather than a friendly summary: "Ownpace wants to read your contacts",
not "connect your account".

One asymmetry is stated, not buried: deleting a customer-owned client kills every token at once,
and that lever is theirs; with a managed client, revocation is per account and the nuclear lever
is ours. The managed customer is told which trade they are taking.

### What a deployment's own application carries is declared (owner, 2026-09-01)

Point 3 was a law about one client, written when there was one. A deployment whose own Google
application genuinely carries the restricted scopes — its owner registered them and accepts the
consequences — declares `GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`, and its account consent may then
offer mail and files too (`providerAccountDomains` in
[`provider-accounts.ts`](../../packages/shared/src/provider-accounts.ts)). Any other value means
`sensitive`, and the appliance never has an application at all. What this separates is the
reference deployment's own client, in Testing status with listed users, where the population the
restricted tier would be imposed on is the owner and people they named.

- **A declaration is not a capability.** It changes which consent this product is willing to
  **build**; Google still refuses at its own screen if the application lacks the scopes, so a
  wrong answer costs a refusal with the scope in hand, never a silent narrowing. The setting's
  documentation names the seven-day cost of Testing beside it
  ([`a-scope-class-the-product-does-not-decide.unit.test.ts`](../../scripts/a-scope-class-the-product-does-not-decide.unit.test.ts)).
- **It is served, never mirrored into a build**: the API reads it at run time and answers at
  `GET /api/provider-accounts`, and every failure to ask falls back to the narrow answer, the one
  that cannot over-ask
  ([`a-ceiling-the-screen-could-not-see.unit.test.ts`](../../scripts/a-ceiling-the-screen-could-not-see.unit.test.ts)).
- **It gates making a mapping, never running one**: the consent and the create door follow it,
  the source builders do not (`build-deps-from-mapping.ts`). A grant is the authority once it
  exists, and Google refuses a token that never carried the scope.

### The deployment's own client, and a connection that stores neither half (owner, 2026-09-01, option B)

`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are configured once, so nobody types a
client secret into a wizard. A connection on that client keeps only its refresh token — the
per-account half, never optional — and the client is read when a token is minted, so rotation is
one `.env` edit and a restart. The cost is real: a connection is no longer self-describing, and
moving one to another deployment needs a client there too.

- **A connection carrying its own pair always wins**: the deployment's is a fallback, never an
  override, or owning a client would stop being a choice
  ([`deployment-application.ts`](../../packages/orchestration/src/deployment-application.ts)).
- **Both or neither, at every door** — wizard, API, add-form, rotation and the consent itself.
  Half a pair is refused where it is sent, never completed with the deployment's other half, and
  a half-configured deployment is refused by the missing name
  ([`google-deployment-client.ts`](../../packages/shared/src/google-deployment-client.ts)).
- **Google connection kinds only**: other kinds keep their own pairs under the same key names.
- **The API and the worker are supplied by different mechanisms, and both must be**:
  `deploy/compose/managed.yml` for the API, `deploy/compose/set-task-env.sh` for the worker, whose
  task container inherits nothing from compose
  ([`a-client-the-worker-never-got.unit.test.ts`](../../scripts/a-client-the-worker-never-got.unit.test.ts)).

### The assessment buys convenience, never capability

Every source migrates today at zero cost through the customer's own client: Workspace via
Internal consent, personal Google via External + Production, whose 100-user cap never binds when
every customer has their own client. An assessment buys a popup instead of a console, for
consumers, in the managed edition. So it is always deferrable, nothing is gated behind it, and if
it is paid it is funded like every other cost (ADR-0014).

### Mail and files without the assessment

**An account password is closed; an app password is not. Do not conflate them** — this ADR did,
both ways, on the day it was written. Google withdrew account-password sign-in for third-party
clients ([answer/6010255](https://support.google.com/mail/answer/6010255)) and keeps app passwords
as the documented fallback *"als Inloggen met Google niet beschikbaar is voor de app"*
([answer/185833](https://support.google.com/accounts/answer/185833)), 2SV required, and labelled
*afgeraden*. Both were quoted as the owner supplied them, since this sandbox's proxy blocks
`support.google.com`: **re-read both before acting on them.**

So **personal Gmail may use an app password, opt-in and never the default** (0089 T7). Gmail is
already an IMAP source whose connector carries a plain-password branch, so this is a credential
choice rather than a connector: same folder view, same Message-ID natural key, no fidelity loss.
Never the default is structural: `buildGmailSourceFrom` reaches the app password only without
domain-wide delegation or a whole OAuth trio
([`gmail-source-factory.ts`](../../packages/orchestration/src/gmail-source-factory.ts)). It is
offered with Google's discouragement quoted, not laundered; as the wider credential (the whole
mailbox), revoked in the account's own app-password list without Ownpace; never as the only
consumer on-ramp, since Google may withdraw it; and under the same metered 2,500 MB/day IMAP
ceiling as the OAuth path (workplan 0090).

Workspace cannot use an app password and does not need to: Internal consent is free. So **Drive
is the only product for which an assessment could ever be worth buying**, and Drive has no
password path, nor do we invent one. **Gmail IMAP is always on since March 2025**: no setup path
asks anyone to enable it, and no refusal offers it as a cause.

### Registering the client

Each entry is in §4b of [`docs/google-oauth-verification.md`](../google-oauth-verification.md);
why the alternatives were refused is below.

- **The redirect endpoint is `/api/migrations/google/callback`, never `/webhooks/…`**
  ([`google-oauth-routes.ts`](../../apps/api/src/routes/migrations/google-oauth-routes.ts)): an
  OAuth redirect is a browser GET carrying the user's authorization code. The registered URIs
  carry the path the code serves.
- **No authorized JavaScript origin**: the flow is server-side authorization-code.
- **Environments get separate clients, not separate paths on one host**; where one client must
  serve both, separate hosts at minimum.
- **The canonical host is decided once and registered exactly.** Google matches the redirect URI
  byte for byte before any redirect of ours runs, so `www` versus apex is a real choice: the host
  the service serves on, where its privacy policy and home page are verified.
- **Never "External + Testing" for a real migration.** Google expires refresh tokens after
  **seven days** in that publishing status, which reads as a random `invalid_grant` weeks in.
  Setup paths steer to Internal (Workspace) or Production (personal), and the refusal for an
  expired token names this cause first (`hintFor` in
  [`google-token-provider.ts`](../../packages/connectors/src/google-token-provider.ts)).
- **Verification has a published surface, and it is the same surface the GDPR needs**: a privacy
  policy and terms on `ownpace.eu`, a support address a person answers (**support@ownpace.eu**), a
  logo of at least 120×120, and an in-product disclosure before the consent screen
  ([`site/legal/`](../../site/legal/), [`site/brand/`](../../site/brand/)).
- **The Limited Use commitments are made in the privacy policy and are true of the code**: the
  data serves only the migration the user configured, goes only to the target they chose, is never
  used for advertising or model training, and is never read by a person outside the narrow cases
  the policy names. **Google is never a migration target**, and **nothing is ever deleted at the
  source**.

## Consequences

- A managed customer connects contacts, calendar and tasks with one consent; mail and files wait
  for an assessment or a deployment's declaration, and the page says which is which.
- Self-hosters got the same consent flow against their own client: the Playground is gone for
  everyone.
- Ownpace becomes a Google-verified brand: the privacy policy stays accurate, the scopes minimal,
  and a scope added carelessly can trigger re-verification.
- The managed client is a new compromise surface: one secret, in the deployment's configuration,
  whose blast radius is a consent screen run in our name — not customer data, since tokens are per
  user and stored apart. The appliance keeps what the managed edition gives up: delete the
  client, kill every token, no vendor involved.
- **The cost.** The assessment is annual, per-project and for restricted scopes only; the figures
  in circulation ($15,000–$75,000 historically, a CASA Tier 2 self-scan reported in the hundreds
  to low thousands, at times subsidised) are unverified and are not quoted or budgeted until
  re-checked. Brand verification costs time — a review of days to weeks — with most inputs in
  place (`ownpace.eu`, ADR-0029's site). The engineering was small and is built (0089 T1, T5's
  mechanics, T7). **Not a cost:** Internal consent is free and banner-free for every Workspace
  customer; this ADR buys the personal-Google case, the people for whom "create a Google Cloud
  project" is an unanswerable ask.
- **Open:** the verification submission (the owner's, 0089 T5); the production client
  ([workplan 0140](../workplans/0140-consent-screens-a-tester-can-pass.md) T11); the class of the
  full `.../auth/calendar` scope.

## Alternatives considered

**Publish one client and ship it in both editions.** A secret in the appliance is a published
secret: rejected on Google's terms and on ADR-0003.

**A "desktop app" client with a loopback redirect, so the appliance gets a popup too.** It works
only with the browser on the appliance's own host, which is not how the owner reaches the box.
Kept as an open question for workplan 0089, with Google's limited-input-device flow, whose scope
list needs checking first.

**Domain-wide delegation for everybody.** ADR-0033's opt-in second mode, for Workspace with an
admin in the loop: it solves the N-consents problem, not one person with a personal Gmail, and it
needs a Cloud console too.

**Charge separately for the managed client, to fund the assessment.** ADR-0014 puts every cost in
one cross-subsidised envelope; a line item named after a Google audit is the cost recovery through
a strange name that its amendment removed.

**Skip Google for consumers; support only IMAP/CalDAV providers.** Absurd for a product whose
purpose is moving people off US cloud: Google is the source that matters most.

**One law for every deployment — mail and files bring-your-own until the assessment is paid.**
Point 3's reading until 2026-09-01. It was a law about one client; a deployment's own application
declares instead.

**A `VITE_` twin of the declaration.** Two separately settable copies of one fact: how a screen
comes to offer what the server refuses, and worse, how a consent comes to ask for scopes no mapping
can carry.

**Gating the source builders on the declaration.** Unsetting a variable would silently break
migrations that already hold a grant.

**Copying the deployment's pair into every connection's encrypted store** (the option not chosen
on 2026-09-01). It works, and it makes rotation a migration: every connection keeps the old value
until it is edited.

**A deployment default that overrides a connection's own pair.** It would take away the choice of
owning a client, silently, until a consent screen showed the wrong application's name.

**Completing half a pair with the deployment's other half.** The fallback fills only the missing
key, and a mixed pair fails at Google's token endpoint hours later, from a sync log.

**The fallback for every connection kind.** `clientId`/`clientSecret` are shared key names:
Dropbox keeps its App key and secret under them, and would be handed Google's application.

**The callback under `/webhooks/…`.** A webhook is an unauthenticated server-to-server POST, and a
webhook path is how a callback lands in a router that skips CSRF and accepts POST — the mapping
hijack 0089 T1's signed `state` exists to prevent.

**An authorized JavaScript origin.** Only browser-side OAuth needs one; registering one nothing
uses widens the client for no benefit.

**Test and production as `/x/` and `/_ota_/x/` on one origin.** They would share a cookie jar and
a `state`-signing context, so a bug in test reaches production sessions; separate clients also
keep a leaked test secret from being a production incident.

**An app password for contacts, calendar or a Workspace account.** Google's CardDAV and CalDAV
have been OAuth-only from the start, and Workspace withdrew or admin-disables app passwords
(believed September 2024 — verify before quoting).

**`drive.file`, to keep Drive out of the restricted class.** It reaches only files the app created
or the user picked through the Google Picker; whether a picked folder's grant survives as a durable
server-side refresh token is unverified, and per-selection consent fits continuous sync badly.

**Google Takeout for Drive.** No OAuth, but a one-shot snapshot — no deltas, no continuous sync, no
cutover: the "sell a copy" model ADR-0014 defines this product against. A fallback, never a
substitute.

**Borrowing another tool's published client id.** A terms violation, and not considered.

## Amendment log

- **2026-08-20** — Proposed after the owner met the setup manual (workplan 0089). Revised twice the
  same day, before acceptance: an app password is open for personal Gmail, so the assessment buys
  convenience and only Drive could need it (0089 T7, workplan 0090); and the client's published
  surface, Limited Use and console rules. Record: *Operative rules*; *Is there a way round the
  assessment? For mail yes, for files no*; *Where the cost is*.
- **2026-08-26** — Accepted by the owner as proposed, adding *Drive, later* and *one client per
  environment*; the redirect rule corrected to the route 0089 T1 shipped. Record: *Decision
  (accepted 2026-08-26)*; the redirect bullet in *Operative rules*.
- **2026-09-01** — What a deployment's own application carries is declared in
  `GOOGLE_ACCOUNT_SCOPE_CLASS`, and a declaration is not a capability (owner decision; #701).
  Record: *Operative rules*, the two bullets in capitals that follow the scope-class bullet.
- **2026-09-01** — The declaration is served, never mirrored into a build, and gates making a
  mapping, never running one (built with the screen that reads it; #701). Record: *Operative
  rules*.
- **2026-09-01** — A deployment may carry its own client and the connection stores neither half;
  its own pair wins, both or neither, Google kinds only, API and worker both supplied (owner
  decision, option B; 0089 T5, #703). Record: *Operative rules*.
- **2026-09-01** — Half of a connection's own pair is refused at every door — wizard, API,
  add-form, rotation — never completed with the deployment's other half (#707). Record:
  *Operative rules*, the option B bullet.
- **2026-09-02** — The consent itself joins those doors: none runs against an application the
  caller did not name (#710). Record: the same bullet.
- **2026-09-20** — The console's labels close 0089 T5's first gate: carddav and the read-only
  calendar scope sensitive, Drive and every Gmail scope restricted, no `.../auth/caldav` scope
  (#1031). Record: *Decision (accepted 2026-08-26)*, "Closed 2026-09-20"; point 3, "Read
  2026-09-20 from the console".
- **2026-10-03** — Consolidated in place (ADR-0051); nothing was decided. Where the record had
  fallen behind the code, this text follows the code: tasks is a sensitive face (workplan 0126),
  the managed client is the deployment's configuration (option B), not a stored credential, and
  Gmail's IMAP ceiling is metered (workplan 0090).

The full record, word for word as it read before this consolidation:
[history/0041-who-owns-the-oauth-client.md](./history/0041-who-owns-the-oauth-client.md).
