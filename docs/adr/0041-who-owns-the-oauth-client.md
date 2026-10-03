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
took five sections of `docs/google-workspace-setup.md` and Google's **OAuth Playground**, and the
owner asked: *why not just show me a Google popup, or take an app password?*
[Workplan 0089](../workplans/0089-a-consent-you-can-click.md) T1 built the missing flow; the
decision is the rest: *may Ownpace register **one** OAuth client that customers consent to, so
that adding a Google source is a popup instead of a console?*

## Decision

The owner accepted points 1–4 below as proposed on 2026-08-26, and added two things the proposal
had left open:

1. **Drive, later.** The assessment is intended for Drive eventually — not bought now, not
   scheduled, and nothing waits on it. Mail stays outside the assessment: bring-your-own plus the
   app-password fallback (0089 T7) cover it.
2. **One client per environment, starting now.** The client registered 2026-08-20 is the **test
   (OTA) client**; production gets its own client — with its own secret and exactly one redirect
   URI — before real customers exist.

### 1. Not in the appliance. Ever.

An appliance is software the customer runs: an Ownpace client secret inside it is published,
against Google's terms, and one extraction becomes everyone's incident. Bring-your-own stays its
only mode, and `no-managed-leakage`'s import walk
([`no-managed-leakage.unit.test.ts`](../../apps/selfhost/src/no-managed-leakage.unit.test.ts))
keeps managed-only code out. ADR-0003 in the ordinary way: the answer differs by who runs the
software.

### 2. Yes in the managed edition, as a managed-only secret

A managed deployment holds its own verified client as it holds its payment integration
(ADR-0036): adding a Google source is **Connect**, Google's consent screen, **Allow** — no
console, no Playground. The client is the deployment's configuration (option B, below); the
refresh token is stored like every other credential (ADR-0037).

**And this is where ADR-0035's grant link finally pays off**: *"only the migrated person holds
their own source credential"*, and a link that opens a consent screen makes that real.

### 3. The scope classes decide the order, because they decide the price

| class | examples | what Google requires |
|---|---|---|
| basic | `openid`, `email`, `profile` | nothing |
| **sensitive** | contacts, calendar, tasks | brand verification: privacy policy, domain ownership, a demo video, a review |
| **restricted** | Gmail (`https://mail.google.com/`), Drive (`drive.readonly`) | all of the above **plus an annual third-party security assessment** |

The owner read the classes in the project's console (2026-09-20; tasks 2026-09-23;
[`docs/google-oauth-verification.md`](../google-oauth-verification.md) §2). There is no
`.../auth/caldav` scope, as this ADR first had it: the product asks for `.../auth/calendar`, a row
the page did not list (a Stage 6 question in `docs/owner-test-runbook.md`).

So **the sensitive faces go first on the managed client; mail and files stay bring-your-own until
an assessment is paid for** — an intent is not a purchase — and what is not covered says so on the
page, not at the consent screen. This binds the client Ownpace publishes to strangers; a
deployment's own application declares for itself.

**The assessment buys convenience, never capability.** Every source migrates today at zero cost
through the customer's own client — Workspace via Internal consent, personal Google via External
+ Production, whose 100-user cap never binds when every customer has their own. It buys consumers
a popup instead of a console: always deferrable, nothing gated behind it, funded like every other
cost (ADR-0014).

### 4. Owning a client widens nothing, and the page must not let anyone think it does

Same scopes, same per-user consent, same read-only posture, same revocation by the account holder
in their own Google settings. Only the name on the consent screen changes, so the page shows the
scopes as scopes: "Ownpace wants to read your contacts", not "connect your account". And it says
the asymmetry: deleting a customer-owned client kills every token, their lever; a managed client's
nuclear lever is ours.

### A deployment's own application and its own client (owner, 2026-09-01)

Point 3 was a law about one client. A deployment whose own Google application genuinely carries
the restricted scopes — its owner registered them and accepts the consequences — declares
`GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`, and its account consent may offer mail and files too
(`providerAccountDomains` in [`provider-accounts.ts`](../../packages/shared/src/provider-accounts.ts)).
Any other value means `sensitive`; the appliance has no application. This separates the reference
deployment's own client, in Testing status with listed users, where the population the restricted
tier would be imposed on is the owner and people they named.

- **A declaration is not a capability**: it decides which consent this product will **build**, and
  Google still refuses at its own screen, so a wrong answer costs a refusal with the scope in hand,
  never a silent narrowing. Testing's seven-day cost is documented beside the setting
  ([`a-scope-class-the-product-does-not-decide.unit.test.ts`](../../scripts/a-scope-class-the-product-does-not-decide.unit.test.ts)).
- **It is served, never mirrored into a build**: answered at run time by
  `GET /api/provider-accounts`; every failure to ask falls back to the narrow answer
  ([`a-ceiling-the-screen-could-not-see.unit.test.ts`](../../scripts/a-ceiling-the-screen-could-not-see.unit.test.ts)).
- **It gates making a mapping, never running one**: the consent and the create door follow it,
  the source builders do not (`build-deps-from-mapping.ts`).

**Option B.** `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are configured once and
read when a token is minted, so nobody types a client secret into a wizard, **the connection
stores neither half** — only its refresh token, the per-account half, never optional — and
rotation is one `.env` edit. The cost: a connection no longer describes itself, and moving one
needs a client at the other deployment too.

- **A connection carrying its own pair always wins** — a fallback, never an override, because
  owning a client is a real choice
  ([`deployment-application.ts`](../../packages/orchestration/src/deployment-application.ts)).
- **Both or neither, at every door** — wizard, API, add-form, rotation and the consent itself
  ([`google-deployment-client.ts`](../../packages/shared/src/google-deployment-client.ts)).
- **Google connection kinds only.**
- **The API and the worker are supplied separately, and both must be** (`managed.yml`,
  `set-task-env.sh`;
  [`a-client-the-worker-never-got.unit.test.ts`](../../scripts/a-client-the-worker-never-got.unit.test.ts)).

### Mail and files without the assessment

**An account password is closed; an app password is not. Do not conflate them** — this ADR did,
both ways, the day it was written. Google withdrew account-password sign-in for third-party
clients ([answer/6010255](https://support.google.com/mail/answer/6010255)) and keeps app passwords
as the documented fallback ([answer/185833](https://support.google.com/accounts/answer/185833)),
2SV required, labelled *afgeraden*. Both were quoted as the owner supplied them: **re-read both
before acting on them**.

So **personal Gmail may use an app password, opt-in and never the default** (0089 T7): a
credential choice on the existing IMAP source, losing nothing, reached only without domain-wide
delegation or a whole OAuth trio
([`gmail-source-factory.ts`](../../packages/orchestration/src/gmail-source-factory.ts)). It comes
with Google's discouragement quoted, as the wider credential (the whole mailbox) revoked in the
account's own app-password list, never as the only consumer on-ramp (Google may withdraw it), and
under the OAuth path's metered IMAP ceiling (workplan 0090).

Workspace cannot use one and needs none: Internal consent is free. So **Drive is the only product
for which an assessment could ever be worth buying**; it has no password path, and we invent none.
**Gmail IMAP is always on since March 2025**: nothing asks anyone to enable it or offers it as a
cause.

### Registering the client

Entered in §4b of the verification document.

- **The redirect endpoint is `/api/migrations/google/callback`, never `/webhooks/…`**
  ([`google-oauth-routes.ts`](../../apps/api/src/routes/migrations/google-oauth-routes.ts)), and
  the registered URIs carry the path the code serves.
- **No authorized JavaScript origin.**
- **Environments get separate clients**; one client serving both gets separate hosts at minimum.
- **The canonical host is registered exactly**: Google matches byte for byte before any redirect
  of ours, so `www` or apex is a real choice.
- **Never "External + Testing" for a real migration.** Google expires refresh tokens after **seven
  days** in that publishing status, which reads as a random `invalid_grant` weeks in. Setup steers
  to Internal (Workspace) or Production (personal), and the expired-token refusal names this cause
  first (`hintFor` in
  [`google-token-provider.ts`](../../packages/connectors/src/google-token-provider.ts)).
- **Verification has a published surface, the same one the GDPR needs**: privacy policy and terms
  on `ownpace.eu`, **support@ownpace.eu** answered by a person, a logo of at least 120×120, a
  disclosure before consent ([`site/legal/`](../../site/legal/), [`site/brand/`](../../site/brand/)).
- **The Limited Use commitments are true of the code**: the configured migration and chosen target
  only, never advertising or model training, nobody reading the data outside the privacy policy's
  narrow cases. **Google is never a migration target**; **nothing is ever deleted at the source**.

## Consequences

- A managed customer connects contacts, calendar and tasks with one consent; mail and files wait
  for an assessment or a declaration, and the page says which.
- Self-hosters got the consent flow against their own client: the Playground is gone.
- Ownpace becomes a Google-verified brand: the privacy policy stays accurate and the scopes
  minimal, since a scope added carelessly can trigger re-verification.
- The managed client is one new secret, whose blast radius is a consent screen in our name, not
  customer data. The appliance keeps what managed gives up: delete the client, every token dies.
- **The cost**: an annual, per-project assessment for restricted scopes only, at figures (hundreds
  to tens of thousands of dollars) unverified and not quoted until re-checked; days to weeks of
  brand review; engineering already built (0089 T1, T5, T7). Internal consent costs Workspace
  nothing.
- **Open:** the verification submission (the owner's, 0089 T5) and the production client
  ([workplan 0140](../workplans/0140-consent-screens-a-tester-can-pass.md) T11).

## Alternatives considered

**Publish one client and ship it in both editions.** A secret in the appliance is a published
secret: against Google's terms and ADR-0003.

**A "desktop app" client with a loopback redirect, for an appliance popup.** It needs the browser
on the appliance's host, unlike the owner's setup; left open for workplan 0089, with Google's
limited-input-device flow (its scope list unchecked).

**Domain-wide delegation for everybody.** ADR-0033's opt-in mode for Workspace admins solves N
consents, not one person's Gmail, and needs a Cloud console too.

**Charge separately for the managed client, to fund the assessment.** ADR-0014 keeps every cost in
one cross-subsidised envelope; a line named after a Google audit is what its amendment removed.

**Skip Google for consumers.** Absurd for a product moving people off US cloud: Google is the
source that matters most.

**Mail and files bring-your-own on every deployment until the assessment is paid** (point 3's
reading until 2026-09-01). A law about one client.

**A `VITE_` twin of the declaration.** Two settable copies of one fact: a screen offering what the
server refuses, or a consent asking for scopes no mapping can carry.

**Gating the source builders on the declaration.** Unsetting a variable would break migrations
that hold a grant, and Google already refuses a token that never carried the scope.

**Copying the deployment's pair into every connection's store** (the other option of 2026-09-01).
Rotation becomes a migration.

**A deployment default that overrides a connection's own pair.** It would silently take away the
choice of owning a client.

**Completing half a pair with the deployment's other half.** A mixed pair fails at Google's token
endpoint hours later, from a sync log.

**The fallback for every connection kind.** Dropbox keeps its own pair under the same
`clientId`/`clientSecret` names and would be handed Google's.

**The callback under `/webhooks/…`.** A webhook is an unauthenticated server-to-server POST; that
route tree skips CSRF and accepts POST — the mapping hijack 0089 T1's signed `state` prevents.

**An authorized JavaScript origin.** Only browser-side OAuth needs one; an unused one widens the
client.

**Test and production as `/x/` and `/_ota_/x/` on one origin.** They share a cookie jar and a
`state`-signing context, so a test bug reaches production; separate clients keep a leaked test
secret out of production.

**An app password for contacts, calendar or Workspace.** CardDAV and CalDAV are OAuth-only, and
Workspace withdrew or admin-disables app passwords (believed September 2024 — verify before
quoting).

**`drive.file`, keeping Drive out of the restricted class.** It reaches only files the app created
or the user picked; a durable grant for a picked folder is unverified, and per-selection consent
fits continuous sync badly.

**Google Takeout for Drive.** No OAuth, but a one-shot snapshot without deltas, continuous sync or
cutover — the "sell a copy" model ADR-0014 defines this product against.

**Borrowing another tool's published client id.** A terms violation; not considered.

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
  Record: *Operative rules*, the two bullets in capitals after the scope-class bullet.
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
