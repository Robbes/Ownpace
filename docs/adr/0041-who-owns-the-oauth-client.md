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
  mode, held by shipping none — the deployment's pair lives in a managed `.env` that only
  `managed.yml` names. **A managed deployment brings its own verified client**, so a customer
  clicks **Allow** (points 1–2).
- **A connection's own client pair always wins; the deployment's**
  (`GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`, option B) **is a fallback**, and a connection using it
  stores only its refresh token. **Both or neither**, for the deployment's variables and at every
  door: half a pair is no client, refused by the missing name. The worker gets the pair too
  (`a-client-the-worker-never-got.unit.test.ts`).
- **The assessment buys convenience, never capability**: every source migrates free through the
  customer's own client. Ownpace's published client adds Gmail and Drive (restricted) only once an
  assessment exists; Drive's is intended, not bought, and mail stays outside it (point 3).
- **What a deployment's own application carries is declared** (`GOOGLE_ACCOUNT_SCOPE_CLASS`,
  default `sensitive`), and is not a capability: served by `/api/provider-accounts`, never
  mirrored into a build, gating making a mapping, never running one
  (`a-ceiling-the-screen-could-not-see.unit.test.ts`).
- **Owning a client never widens a grant**; the consent page shows the scopes as scopes, not only
  as a paraphrase (`Grant.unit.test.tsx`, *Decision* 4).
- **Never "External + Testing" for a real migration.** Google expires refresh tokens after
  **seven days** in that publishing status, which reads as a random `invalid_grant` weeks in;
  setup steers to Internal or Production, and the refusal names that cause first
  (`google-token-provider.unit.test.ts`).
- **The client is registered exactly** (*Registering the client*): callback
  `/api/migrations/google/callback`, never `/webhooks/…`; no JavaScript origin; a client per
  environment; one canonical host; a published surface; Limited Use true of the code.
- **Personal Gmail may use an app password** (not the closed account password): opt-in, never the
  default, Google's discouragement quoted (`gmail-source-factory.unit.test.ts`). Drive has no
  password path; nothing asks anyone to enable IMAP.

## Context

On 2026-08-20 minting a Google source's per-user refresh token took five sections of
`docs/google-workspace-setup.md` and Google's **OAuth Playground**, and the owner asked: *why not
just show me a Google popup, or take an app password?*
[Workplan 0089](../workplans/0089-a-consent-you-can-click.md) T1 built the missing consent flow;
the decision is the rest: *may Ownpace register **one** OAuth client that customers consent to, so
that adding a Google source is a popup instead of a console?*

## Decision

Accepted 2026-08-26: points 1–4 below as proposed, and two additions by the owner.

1. **Drive, later.** The assessment is intended for Drive eventually — not bought now, not
   scheduled, and nothing waits on it. Mail stays outside the assessment: bring-your-own plus the
   app-password fallback (0089 T7) cover it.
2. **One client per environment, starting now.** The client registered 2026-08-20 is the **test
   (OTA) client**; production gets its own client — with its own secret and exactly one redirect
   URI — before real customers exist.

### 1. Not in the appliance. Ever.

An appliance is software the customer runs, so an Ownpace client secret inside it is published:
against Google's terms, and one extraction is everyone's incident. Bring-your-own stays its only
mode, and `no-managed-leakage`'s import walk
([`no-managed-leakage.unit.test.ts`](../../apps/selfhost/src/no-managed-leakage.unit.test.ts))
keeps managed-only code out. Two editions, one core (ADR-0003): the answer differs by who runs the
software.

### 2. Yes in the managed edition, as a managed-only secret

A managed deployment holds its own verified client in its configuration, as it holds its payment
integration (ADR-0036; option B, below): adding a Google source is **Connect**, Google's consent
screen, **Allow**. The refresh token is stored like every other credential (ADR-0037).

**And this is where ADR-0035's grant link finally pays off**: *"only the migrated person holds
their own source credential"*, and a link that opens a consent screen makes that real.

### 3. The scope classes decide the order, because they decide the price

The classes as the owner read them in the project's console (2026-09-20; tasks 2026-09-23;
[`docs/google-oauth-verification.md`](../google-oauth-verification.md) §2, the submission
checklist):

| class | examples | what Google requires |
|---|---|---|
| **sensitive** | contacts, calendar, tasks | brand verification: privacy policy, domain ownership, a demo video, a review |
| **restricted** | Gmail (`https://mail.google.com/`), Drive (`drive.readonly`) | all of the above **plus an annual third-party security assessment** |

So **the sensitive faces go first on the managed client; mail and files stay bring-your-own until
an assessment is paid for.** An intent is not a purchase, and what is not covered says so on the
page, not at the consent screen.

**The assessment buys convenience, never capability.** Every source migrates today at zero cost
through the customer's own client — Workspace via Internal consent, personal Google via External
+ Production, whose 100-user cap never binds when every customer has their own. It buys consumers
a popup instead of a console: always deferrable, nothing gated behind it, funded like every other
cost (ADR-0014).

### 4. Owning a client widens nothing, and the page must not let anyone think it does

Same scopes, per-user consent, read-only posture, and revocation by the account holder in their
own Google settings. Only the name on the consent screen changes, so the page shows the scopes as
scopes — "Ownpace wants to read your contacts", not "connect your account" — and says the
asymmetry: deleting a customer-owned client kills every token, their lever; a managed client's
nuclear lever is ours.

### A deployment's own application and its own client (2026-09-01 and 2026-09-02)

**What a deployment's own application carries is a fact about that deployment, and it is
declared.** Point 3 still binds the client Ownpace publishes to strangers. A deployment whose own
application genuinely carries the restricted scopes — its owner registered them and accepts the
consequences — declares `GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`, and its account consent may then
offer mail and files ([`provider-accounts.ts`](../../packages/shared/src/provider-accounts.ts));
any other value means `sensitive` (the appliance has no application). This separates the
reference deployment's own client, in Testing status with listed users, where the population the
restricted tier would be imposed on is the owner and people they named.

- **A declaration is not a capability**: it decides which consent this product will **build**,
  and if the application does not carry the scopes, Google still refuses at its own screen — a
  refusal with the scope in hand, never a silent narrowing. Testing's seven-day cost is documented beside it
  ([`a-scope-class-the-product-does-not-decide.unit.test.ts`](../../scripts/a-scope-class-the-product-does-not-decide.unit.test.ts)).
- **It is served, never mirrored into a build** (`GET /api/provider-accounts`), and every failure
  to ask falls back to the narrow answer
  ([`a-ceiling-the-screen-could-not-see.unit.test.ts`](../../scripts/a-ceiling-the-screen-could-not-see.unit.test.ts)).
- **It gates making a mapping, never running one**: the consent and the create door follow it,
  the source builders do not (`build-deps-from-mapping.ts`).

**Option B.** `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are configured once and
read when a token is minted: nobody types a client secret into a wizard, **the connection stores
neither half** (only its refresh token, the per-account half, never optional), and rotation is one
`.env` edit and a restart. **Both variables or neither**: a half-set pair is no client, and the
refusal names the missing variable — never mixed with the other half. The cost: a connection no
longer describes itself; moved to another deployment, it needs that deployment's client.

- **A connection carrying its own pair always wins** — a fallback, never an override, because
  owning a client is a real choice
  ([`deployment-application.ts`](../../packages/orchestration/src/deployment-application.ts)).
- **Both or neither, at every door** — wizard, API, add-form, rotation, consent: half a pair is
  refused by the missing name, never completed from the deployment's, and no consent runs on an
  application the caller did not name
  ([`google-deployment-client.ts`](../../packages/shared/src/google-deployment-client.ts)).
- **Google connection kinds only**, so no other provider is ever handed Google's pair.
- **The API and the worker are supplied separately, and both must be** (`managed.yml`,
  `set-task-env.sh`, since a Trigger.dev task container inherits nothing from compose): a worker
  without the pair fails every pass where nobody looks
  ([`a-client-the-worker-never-got.unit.test.ts`](../../scripts/a-client-the-worker-never-got.unit.test.ts)).

### Mail and files without the assessment

**An account password is closed; an app password is not. Do not conflate them** — this ADR did,
both ways, in one sitting. Google withdrew account-password sign-in for third-party clients
([answer/6010255](https://support.google.com/mail/answer/6010255)) and keeps app passwords as the
documented fallback ([answer/185833](https://support.google.com/accounts/answer/185833)), 2SV
required, labelled *afgeraden*. Both rest on the owner's reading of Google's pages: **re-read both
before acting on them**.

So **personal Gmail may use an app password, opt-in and never the default** (0089 T7): a
credential choice on the existing IMAP source, reached only without domain-wide delegation or a
whole OAuth trio ([`gmail-source-factory.ts`](../../packages/orchestration/src/gmail-source-factory.ts)).
It comes with Google's discouragement quoted, as an unscoped credential rather than a grant (for
mail no wider than `https://mail.google.com/`, but revoked only in the account's own app-password
list), never as the only consumer on-ramp (Google may withdraw
it), and under the same metered IMAP ceiling as OAuth (workplan 0090).

Workspace cannot use one and needs none, since Internal consent is free. That leaves **Drive the
only product an assessment could ever be worth buying for**, and Drive has no password path; we
invent none. **Gmail IMAP is always on since March 2025**: nothing asks anyone to enable it or
names it as a cause.

### Registering the client

- **The redirect endpoint is `/api/migrations/google/callback`, never `/webhooks/…`**
  ([`google-oauth-routes.ts`](../../apps/api/src/routes/migrations/google-oauth-routes.ts)), and
  the URIs registered in §4b of the verification document must carry the path the code serves.
- **No authorized JavaScript origin.**
- **Environments get separate clients**; one client serving both gets separate hosts at minimum.
- **The canonical host is registered exactly** — the host the service actually serves on, and the
  same host the privacy policy and home page are verified on, `www` or apex — because Google
  matches byte for byte before our redirects.
- **Never "External + Testing" for a real migration.** Google expires refresh tokens after **seven
  days** in that publishing status, which reads as a random `invalid_grant` weeks in. Both
  editions' setup paths steer to Internal (Workspace) or Production (personal), and the
  expired-token refusal names this cause first (`hintFor` in
  [`google-token-provider.ts`](../../packages/connectors/src/google-token-provider.ts)).
- **Verification has a published surface, the same one the GDPR needs**: privacy policy and terms
  on `ownpace.eu`, **support@ownpace.eu** answered by a person, a logo of at least 120×120, a
  disclosure before consent ([`site/legal/`](../../site/legal/), [`site/brand/`](../../site/brand/)).
- **The Limited Use commitments are made in the privacy policy and true of the code**: the
  configured migration and chosen target only, no advertising or model training, nobody reading
  the data outside the policy's narrow cases. **Google is never a migration target**; **nothing
  is ever deleted at the source**.

## Consequences

- A managed customer connects contacts, calendar and tasks with one consent; mail and files wait
  for an assessment on the client Ownpace publishes, while a deployment whose own application
  carries them may declare them, and the page says which.
- Ownpace becomes a Google-verified brand, held to an accurate privacy policy and minimal scopes.
- The managed client is one new secret: its blast radius is a consent screen in our name, not
  customer data, since tokens are per user. The appliance keeps what the managed edition gives up:
  delete the client, every token dies.
- **The cost**: an annual, per-project assessment for restricted scopes only, at unverified
  figures (hundreds to tens of thousands of dollars) never quoted or budgeted until re-checked;
  days to weeks of brand review. Internal consent costs Workspace nothing; this buys the
  personal-Google case.
- **Open:** the verification submission (the owner's, 0089 T5); the production client
  ([workplan 0140](../workplans/0140-consent-screens-a-tester-can-pass.md) T11); whether
  `.../auth/calendar.readonly` suffices over CalDAV (a Stage 6 question in
  `docs/owner-test-runbook.md`), and otherwise the class of the full `.../auth/calendar`, not yet
  read in the console (there is no `.../auth/caldav`, as this ADR first had it).

## Alternatives considered

**One client, shipped in both editions.** A secret in the appliance is a published secret:
against Google's terms and ADR-0003.

**A loopback "desktop app" client, for an appliance popup.** It needs the browser on the
appliance's host, unlike the owner's setup; an open question for workplan 0089, with Google's
limited-input-device flow (scopes unchecked).

**Domain-wide delegation for everybody.** ADR-0033's opt-in mode for Workspace admins solves N
consents, not one person's Gmail, and needs a Cloud console too.

**A separate charge to fund the assessment.** ADR-0014 keeps every cost in one cross-subsidised
envelope; a line named after a Google audit is what its amendment removed.

**Skip Google for consumers.** Absurd for a product moving people off US cloud: Google is the
source that matters most.

**Point 3 as a law for every deployment** (its reading until 2026-09-01). It was a law about one
client.

**A `VITE_` twin of the declaration.** Two settable copies of one fact: a screen offering what the
server refuses, or a consent asking for scopes no mapping can carry.

**Gating the source builders on the declaration.** Unsetting a variable would break migrations
holding a grant; Google already refuses a token without the scope.

**Copying the deployment's pair into every connection's store** (the other option of 2026-09-01).
Rotation becomes a migration.

**Overriding a connection's own pair.** It would silently take away the choice of owning a
client.

**Completing a half pair from the deployment's.** A mixed pair fails at Google's token endpoint
hours later, from a sync log.

**The fallback for every connection kind.** Dropbox keeps its own pair under the same
`clientId`/`clientSecret` names and would be handed Google's.

**The callback under `/webhooks/…`.** A webhook is an unauthenticated server-to-server POST, not a
browser GET carrying an authorization code; its path lands a callback in a router that skips CSRF
and accepts POST — the mapping hijack 0089 T1's signed `state` prevents.

**An authorized JavaScript origin.** The flow is server-side authorization-code; an origin nothing
uses widens the client for no benefit.

**Test and production as `/x/` and `/_ota_/x/` on one origin.** A shared cookie jar and
`state`-signing context let a test bug reach production, and a leaked test secret becomes a
production incident.

**An app password for contacts, calendar or Workspace.** CardDAV and CalDAV are OAuth-only, and
Workspace withdrew or admin-disables app passwords (believed September 2024 — verify before
quoting).

**`drive.file`, which is not restricted.** It reaches only files the app created or the user
picked; a picked folder's durable grant is unverified; per-selection consent fits continuous sync
badly.

**Google Takeout for Drive.** No OAuth, but a one-shot snapshot without deltas, continuous sync or
cutover — the "sell a copy" model ADR-0014 defines this product against.

**Borrowing another tool's published client id.** A terms violation; not considered.

## Amendment log

- **2026-08-20** — Proposed after the owner met the setup manual (workplan 0089). Revised twice
  the same day, before acceptance: an app password is open for personal Gmail, so the assessment
  buys convenience and only Drive could need it (0089 T7, workplan 0090); and the client's
  published surface, Limited Use and console rules. Record: *Operative rules*; *Is there a way
  round the assessment? For mail yes, for files no*; *Where the cost is*.
- **2026-08-26** — Accepted by the owner as proposed, adding *Drive, later* and *one client per
  environment*; the redirect rule corrected from the planned `/oauth/google/callback` to the route
  0089 T1 shipped. Record: *Decision (accepted 2026-08-26)*; the redirect bullet in *Operative
  rules*.
- **2026-09-01** — What a deployment's own application carries is declared in
  `GOOGLE_ACCOUNT_SCOPE_CLASS`, and a declaration is not a capability (owner decision; #701).
  Record: *Operative rules*, "WHAT A DEPLOYMENT'S OWN APPLICATION CARRIES…" and "A DECLARATION IS
  NOT A CAPABILITY".
- **2026-09-01** — The declaration is served, never mirrored into a build, and gates making a
  mapping, never running one (built with the screen that reads it; #701). Record: *Operative
  rules*, "THE DECLARATION IS SERVED…" and "The declaration gates MAKING a mapping…".
- **2026-09-01** — A deployment may carry its own client and the connection stores neither half;
  its own pair wins, both or neither, Google kinds only, API and worker both supplied (owner
  decision, option B; 0089 T5, #703). Record: *Operative rules*, "A DEPLOYMENT MAY CARRY ITS OWN
  CLIENT…" and "The API and the WORKER…".
- **2026-09-01** — Half of a connection's own pair is refused at every door — wizard, API,
  add-form, rotation — never completed with the deployment's other half (#707). Record:
  *Operative rules*, "A DEPLOYMENT MAY CARRY ITS OWN CLIENT…".
- **2026-09-02** — The consent itself joins those doors: none runs against an application the
  caller did not name (#710). Record: the same bullet.
- **2026-09-20** — The console's labels close 0089 T5's first gate: carddav and the read-only
  calendar scope sensitive, Drive and every Gmail scope restricted, no `.../auth/caldav` scope
  (#1031). Record: *Decision (accepted 2026-08-26)*, "Closed 2026-09-20"; point 3, "Read
  2026-09-20 from the console".
- **2026-10-03** — Consolidated in place (ADR-0051); nothing was decided. Where the record had
  fallen behind the code, this text follows the code: tasks is a sensitive face (workplan 0126),
  the managed client is the deployment's configuration (option B), not a stored credential,
  Gmail's IMAP ceiling is metered (workplan 0090), and point 4 says read-only *posture* where it
  said read-only tokens, since `https://mail.google.com/` is full mail access.

The full record, word for word as it read before this consolidation:
[history/0041-who-owns-the-oauth-client.md](./history/0041-who-owns-the-oauth-client.md).
