# Workplan 0131 — The alpha, and who is let in

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** A read-only readiness review on 2026-09-23
listed what stands between the managed edition and a small public test: eleven groups of
blockers and a set of questions. The owner answered them on 2026-09-24 and asked that the test be
called an **alpha**. This plan is the umbrella for it. It records the decisions that shape the
alpha as a whole (§2, D1–D7), holds the three small builds that follow from them (T1–T3), asks
what happens when the alpha ends (T4), and keeps the list of what must be true before the first
invitation goes out (T5). The work itself is split over nine plans opened the same day, 0132 to
0140. Nothing in this plan is built. A few fixes it depended on were drafted in the consistency
PR, #1137. It merged on 2026-09-24, and each fix is named where it occurs.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137
merged.** Testers now use a second stack, `ownpace-live`, on the production names, while the OTA
stack stays CI's and the demo's (D3), so the nightly gate no longer reaches testers' data and open
question 2 is answered. T5's 0132 row is now 0132's new minimum, the fixes #1137 carried are
marked done where they occur, and §5 says which further work the owner had written up as 0141 to
0147.

| Task | Status | Notes |
|---|---|---|
| T1 The word "alpha" wherever a tester meets the service | 📋 **Decided 2026-09-24** (D1, D4) | §3. A note on every signed-in page, on the sign-in and request pages, and one sentence in the grant mail, in Dutch and English. Managed only. Off unless the deployment sets it. |
| T2 An "experimental" label on sources nobody has run against a real account | 📋 **Decided 2026-09-24** (D6) | §3. One table in shared, read by both doors and by the wizard's data-type step. Both editions. |
| T3 Billing says nothing is charged during the alpha | 📋 **Decided 2026-09-24** (D1) | §3. One sentence on the Billing page and one on the request form. Hiding the four metered cards, and leaving run rows unpruned for the alpha, are **Proposed**. |
| T4 What the end of the alpha does to organisations, credentials and identities | ⏳ **Owner** | §3 and open question 1. What exists today, three options, one recommended. |
| T5 Go/no-go before the first invitation | 📋 **Proposed** | §3. For each of 0132–0140, the minimum that must be true, plus the owner's own steps. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24. Where a fact comes from the
review and was not re-checked here, it says so.

**Nothing tells a tester it is a test.** No string in `apps/web/src/i18n/strings.ts` or
`packages/shared/src/notifications.ts` calls the service an alpha, a beta, a trial or a test.
"Alpha", "beta" and "trial" do not occur at all, and "test" occurs only for testing a
connection. The request page's introduction (`access.intro`) says *"Invite-only for now: tell us
what you want to move, and we will email you."* The grant mail's subject is *"Ownpace — your access is ready"*, and its body
does not mention a test. The website's front page says *"From … for the first month. Prices
published in full — no quote, no sales call."* (`heroFine` in `site/copy.mjs`).

**Billing shows prices, and nothing can charge.** `POST /api/billing/invoices/generate` answers
`409 billing_model_retired` to every owner or admin who calls it (`NO_TIER_BILLING_CODE` in
`apps/api/src/routes/billing/no-bill-we-do-not-sell.ts`), and no worker job issues an invoice.
`managed.env.example` says to leave
`MOLLIE_API_KEY` blank *"until billing is wired end-to-end"*. The Billing page
(`apps/web/src/pages/Billing.tsx`) is in the managed menu for owners and admins, and it still
reads like a bill:

- its subtitle is *"Manage your subscription, usage, and payments"*;
- four cards show Storage, Data Transfer, Compute Time and API calls. The first three are the
  quantities the metered model priced before ADR-0014 replaced it with tiers, and the fourth is a
  count from the same metering;
- the tier block shows the tier's set-up fee and monthly price.

The terms (`site/legal/terms.md` §8) say *"Billing is **monthly in arrears** … through our
payment provider Mollie."*

Billing nothing has one side effect. Managed retention prunes a tenant's run rows only as far back
as its newest issued invoice, and *"a tenant with none is skipped entirely, keeping all of its
runs"* (`apps/worker/src/jobs/managed-retention.ts`). Run logs (`run_event`) are pruned
regardless. So in a free alpha, no tenant's run rows are pruned.

**Unproven sources look like proven ones.** Both doors read one list of cards, `SOURCE_CARDS` in
`apps/web/src/components/front-door-cards.ts`. The wizard reads it through
`migratableSourceCards()`, and the connections page through `frontDoorCards()`.
`FrontDoorChooser` renders a name and a hint, and says nothing about proof. Whether a source has
met a real account is written down in two places, and the screen reads neither:
`docs/feature-matrix.md` (the ⏳ marker) and, for CI, `scripts/connector-coverage.unit.test.ts`
(driven, owed or uncoverable). By the matrix, the following are built but have not yet run
against a real account:

- the Microsoft 365 account's calendar, contacts, OneDrive and To Do faces (`graph-calendar`,
  `graph-contacts`, `graph-drive` and `graph-todo` in `source-face-builders.ts`: *"⏳ wired; a
  live connection Test, no migration measured"*);
- Dropbox and Box (⏳ in the Files table; the gap table at the end of the matrix does not list
  them);
- the Apple account (*"⏳ built, unproven"*);
- the Google account's Tasks face (*"unmeasured against a live account"*, 0126);
- whole-domain Google through delegation (*"⏳ built, awaiting first contact with a real
  Workspace"*, 0053).

Gmail, Google Calendar and Google Contacts are marked ✅, and the matrix says what that covers:
the owner's own Google account, *"not yet against a second one"*. The export archive card is a
different case. A managed pass cannot read a local path (0116 T4: *"a local path can never reach
a managed pass"*), yet the wizard asks for one (`sourceArchivePath` in `CreateMapping.tsx`). The
reader can also open an archive that sits inside the migration's own file target (`where` on the
archive source, 0116 T4), but no control in the wizard sets it; 0116 leaves that to the relay
page, which is not built. So a tester who picks this card on managed cannot get it to work.

**The machine.** The OTA stack (`app.ota.ownpace.eu`, `id.ota.ownpace.eu`) runs on the reference
machine, which is also this repository's self-hosted runner:

- `ci.yml` runs there on a push to `main`, and on GitHub-hosted runners for a pull request
  (`runs-on: ${{ github.event_name == 'push' && 'self-hosted' || 'ubuntu-24.04' }}`);
- the nightly gates `e2e.yml` and `e2e-managed.yml` run there on a schedule.

`e2e-managed.yml` brings the stack up with `bootstrap-managed.sh --from data --with-demo
--no-smoke`, and its header says *"the run recreates the halves it owns: the API, the web app,
the worker image and the seed."* `managed.yml` fixes the names of the compose project
(`ownpace-managed`) and the database container (`ownpace-db`). The review found that the gate
therefore rebuilds the same stack the OTA addresses serve. The same file gives 17 services a fixed
`container_name`, so a second compose project cannot start on the machine while this one's
containers exist (0132 T1). The runbook's own rule is that this
must end first: *"before the first non-demo tenant is onboarded, CI and production must not
share this machine"* (`docs/operator-runbook.md`, "This box also runs CI"). The same item is in
`docs/release.md`'s checklist.

The review also recorded that `e2e-managed.yml` failed its scheduled runs of 2026-09-21, 22 and
23. Each failure had a cause that has since been fixed or explained, and a run started by hand
passed on 2026-09-23. That was not re-checked here.

The repository does not settle whether a person off the mesh can reach the OTA addresses.
`docs/google-oauth-verification.md` says *"Anyone not on the mesh gets a timeout"*, and 0091
says *"Routing and TLS are netbird's, not this repository's."* The review's DNS lookup found the
OTA names resolving to the mesh provider's hosted ingress. 0132 T3 establishes which is true, for
these names and for the production names testers will use (D3).

**Letting someone in is already one person's act.** `/request-access` is public and managed-only
(`AppRoutes.tsx`). It stores a request and creates nothing. The operator's access queue
(`AccessRequests.tsx`, 0093 T7) grants or declines each request. Granting creates the
organisation and sends the grant mail (0095), and the person becomes its owner at first sign-in.
`POST /api/tenants` answers 501, so apart from the demo seed the queue is the only way a new
organisation is made.

The queue is not the only way into an organisation. An owner or admin of one can invite anyone
by email address (`POST /api/tenants/:tenantId/members`, `requireRole('owner', 'admin')`); no
mail is sent. The invited person signs in with that address, verified, accepts the invitation,
and is in without passing the queue. 0137 covers what they may then do, and open question 6 asks
whether testers may invite at all.

A request that was granted is purged with its organisation at erasure (`access_request` is in
`PURGED_TABLES` in `offboarding.ts`). An open or declined request names no organisation and is
kept: the application role has no DELETE on `access_request`, and no job removes one.

The form accepts 60 requests an hour, counted per `req.ip`. Since #1137 (merged 2026-09-24),
`managed.yml` passes `TRUST_PROXY` and `ACCESS_REQUEST_MAX_PER_HOUR` to the API. Both are empty
in `managed.env.example`, and with `TRUST_PROXY` empty the API trusts no proxy, so behind an
ingress every caller shares one count until a deployment sets it (`apps/api/src/knock-limit.ts`).
This is 0093 T2c, which the owner deferred on 2026-09-01 until self-service arrives: while
granting is the operator's act, sixty an hour for the whole service is enough. The alpha keeps
granting as the operator's act. The form has no spam protection.

**Ending an organisation has no button.** `POST /api/tenants/:tenantId/close` exists: owner only,
with a window of 0, 7, 30 or 90 days (`CLOSE_WINDOWS_DAYS` in
`packages/managed/src/offboarding.ts`). Nothing in the web app calls it.
`deploy/compose/operator.sh` has no close or erase command, and an operator belongs to no
organisation.

Erasure revokes stored credentials (`packages/orchestration/src/revoke-stored-credentials.ts`)
and purges an explicit list of tables. It does not remove the person's identity at the identity
provider: `offboarding.ts` makes no call to it, and ADR-0042 rules out an issuer-specific API.
Finishing a migration keeps its credentials on purpose (the finish route answers *"Set the
mapping's status back to 'active' to resume"*). Deleting a connection revokes its credential
(`revokeCredentialRow` in `connections.ts`). Deleting a migration removes the row and revokes
nothing, even when the row holds a credential (`apps/api/src/routes/migrations/index.ts`).

For a stop across the whole platform there is the operator hold (managed migration 0023). It
stops the sync tick from starting new passes (`readOpenPause` in `managed-sync-tick.ts`) and
shows every signed-in customer a sentence. A pass a customer starts by hand is not checked
against it: the manual sync route does not read the hold.

**Language.** The app has English and Dutch (`nl` is typed against the English keys), and it
picks Dutch for a Dutch browser. The in-app guides do not have Dutch: `Docs.tsx` serves
`docs/*-setup.md`, and those are English only.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words and the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — what the alpha is.** *Is the test free or paid, for how many people, for how long, and in
which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the posture of the
test: *"Free. A few weeks. No obligations both sides."* The name comes from the legal question
(D4): *"Alpha"*.

So the alpha is free and by invitation, for at most 20 people, in Dutch, for a few weeks, with no
obligations on either side. Nothing is invoiced: no route or job in the code can issue an invoice
today (§1).

**D2 — who lets people in.** Four answers bear on this:

- *What may a member and a viewer do, and should only owners and admins invite?* — *"I am the
  gate for letting people in the test."*
- *For Google: move the consent client to production, or keep it in Testing with pre-registered
  testers?* — *"Ill add people by hand"*
- *A tester stack separate from CI and the nightly gate, reachable from the internet?* — *"Yes,
  but its a controlled rest. I Let people in and support them. Max 10/20 people"* ("rest" is read
  as "test").
- *The Google client is in Testing, so tokens expire after about seven days* — *"I add people,
  controlled small test Group."*

So the owner grants every organisation from the access queue, adds each tester's Google address
as a test user by hand, and supports the testers directly. The first answer is about who enters
the alpha. One door is not the owner's today: a tester who owns an organisation can invite
others into it without the queue (§1). Whether that stays open during the alpha is open
question 6. What a member or a viewer may do inside a tester's organisation is still open, and
0137 covers it.

**D3 — where it runs.** *Where do testers run, and under which host names?* — *"This machine, ci
states. The OTA address. It's all controlled by me and invite only."* ("ci states" is read as
"CI stays".) On exposure: *Are ports 5432, 3001, 3090, 3443 and 3126 reachable from outside, were
the database passwords changed, and does the live identity provider hold other organisations?* —
*"No, these ports are not reachable outside of private network/NetBird. Usernamea changed. No
other organisations are hosted."*

So the alpha runs on the reference machine, and CI stays on it. The first answer placed it at the
OTA address. Later the same day the owner asked: *"check, can't i just (as a start) host a
'ownpace-live' as production, next to the current 'ownpace-managed' on OTA-domain? What would i
need to do to keep alle seperate from each other?"* The proposal back was to make that the
decision in 0132, with testers on `ownpace-live`. The owner's answer: *"Yes! The spark has a lot
free memory and disk, it will fit."*

Testers therefore use a second compose project, `ownpace-live`, beside the OTA stack
`ownpace-managed` on the same machine, at the production names of 0091: `app.ownpace.eu`,
`id.ownpace.eu` and, for the status page, `status.ownpace.eu` (`docs/status-page.md`). 0091 T4,
*"`app` stays dark until it means production"*, is thereby answered: it now means production.
`ownpace-managed` stays at `app.ota.ownpace.eu` and `id.ota.ownpace.eu`, as the nightly gate's
target and the demo, and CI never touches `ownpace-live`.

The separation is by name on one Docker daemon, not a security boundary: both stacks' Trigger.dev
planes can use the Docker socket, and so can the self-hosted runner (§4). That is accepted for a
hand-picked alpha. A separate virtual machine, or a rootless daemon for each stack, is the step if
the separation must become a boundary. So this still departs from the runbook's rule (§1), which
names a shared Docker daemon as the class of problem. 0132 records the decision and the work that
makes a second stack possible, starting with its T1, since today's fixed container names stop a
second project from starting (§1). It also covers what changes in the runbook and the release
checklist so that neither contradicts this decision.

**D4 — the legal surface comes first.** *A lawyer's pass before the first invitation, or a
labelled beta notice? And can you supply the address, the btw-id and the hosting details?* —
*"Yes before, Alpha, and i can supply."* On the legal blocker: *"I will update"*.

So the lawyer's pass happens before the first invitation, the test is labelled "Alpha", and the
owner supplies the facts the drafts leave as placeholders. 0139 carries this.

**D5 — no backups during the alpha.** *How much loss is acceptable, how fast must service come
back, and where are backups kept?* — *"None during the test"*. On the missing database backup:
*"No obligations during controlled test"*.

So nothing is backed up during the alpha, and testers are told so before they start. 0134 makes
that statement true everywhere the product now suggests otherwise.

**D6 — unproven sources are labelled.** *For sources nobody has run against a real account:
prove them first, hide them, or label them experimental?* — *"Label"*. This is T2.

**D7 — nobody else gets onto the machine.** *If the current stack is reused, its demo secrets
must be rotated* — *"Who would need/het credentials? I aupporrthe test. No one will be added to
NetBird network. Devs need to setup own private test/dev environments. GitHub PRs and git is the
bridge."* ("het" is read as "get", and "aupporrthe" as "support the".)

So no tester, contributor or developer gets a login on the machine, a place on the mesh or a
copy of its secrets. Developers run their own environments, and code reaches the machine only
through a merged pull request. §4 answers the question inside this answer. With `ownpace-live`
(D3), testers are not on the current stack at all: live starts from its own `.env`, and the OTA
stack keeps its secrets as a demo (§4).

**The other answers, and the plans that carry them.**

| Question, in plain words | The answer, as given | Carried by |
|---|---|---|
| Which EU mail relay and sending domain, and does a person read support@? | *"I'll register a ownpace ampt, a todo"*. Read as: the owner will register a mail-sending (SMTP) account for Ownpace, as a to-do. | 0133 |
| Mail must leave the box | *"I will practically forward / help"* | 0133 |
| Close public organisation registration at the identity provider | *"Advice"* | 0135 |
| The database is published with a password the repository contains | *"Ill change user and pass. But not reached from internet."* | 0132 |
| Requests to hosts a tester types (SSRF) | *"Explain risk and Advice"* | 0136 |
| Roles do not restrict writes | *"Explain risk and advice. Are permissions not implemented?"* | 0137 |
| Microsoft: an ADR for the deployment's multi-tenant app, and publisher verification now? | *"Explain"* | 0140 |

## 3. What each task does

### T1 — the word "alpha" wherever a tester meets the service

**One setting, read in two places.** A deployment setting in `deploy/compose/.env` (for the
alpha, `ownpace-live`'s own), unset by default. Its name is for the build to settle;
`OWNPACE_STAGE=alpha` is the working name. `managed.yml` passes it to the web build as a build
argument, as it already does for `VITE_OIDC_ISSUER`. It also passes it to the API service, whose
environment is an explicit list.

It is a build argument, not a value the web app reads from the API, because the request page and
the sign-in page have no session. A note that disappears when a read fails would go silent exactly
when something is wrong. The appliance never sets the setting.

**Where it shows.**

- At the top of every signed-in page, in `Layout.tsx` beside `PlatformPauseBanner`. It uses the
  same amber `role="note"` shape, which the pause banner adopted so that two kinds of platform
  news do not look like two different kinds of thing.
- On `/login` and `/request-access`, under the title.
- In one sentence of the access-granted mail (`access_granted` in `notifications.ts`), in both
  languages.

**What it says.** This is a draft. It must match 0139's alpha conditions once they exist.

- EN: *"Alpha: a small invited group is trying this service out. Nothing is charged, nothing is
  backed up, and the alpha can end. Keep your old account until you have checked what arrived."*
- NL: *"Alfa: een kleine, uitgenodigde groep probeert deze dienst uit. Er wordt niets in rekening
  gebracht, er worden geen back-ups gemaakt en de alfa kan stoppen. Houd uw oude account tot u
  hebt gecontroleerd wat er is aangekomen."*

Once 0139 publishes the alpha conditions, the note links to them in the reader's language. A
tester guide, a known-limitations page and a close-account screen are not part of T1. They belong
to 0144 (W14, §5).

**Guards.** Each of these fails on today's code:

- `apps/web/src/components/an-alpha-said-out-loud.unit.test.tsx`: with the setting on, `Layout`,
  `Login` and `RequestAccess` render the note in English and Dutch. Without it, none of them do,
  and an appliance build never does.
- A test beside `notifications.ts` in shared: with the setting on, the access-granted mail carries
  the sentence in both languages, and without it the mail does not.
- `scripts/an-alpha-both-halves-know-about.unit.test.ts`: `managed.yml` passes the setting to
  both the web build and the API. Today it passes it to neither. The pattern to follow is
  `a-client-the-worker-never-got.unit.test.ts`.

### T2 — an "experimental" label, from one table

**The table.** It lives in `packages/shared/src/front-door.ts`, beside `FRONT_DOOR_FAMILIES`, so
that both doors and the wizard read the same thing. It holds a verdict for each source kind, and
for the account kinds a verdict for each face (the faces `source-face-builders.ts` maps in
orchestration). There are two verdicts:

- **proven**: a complete pass has run against a real account of this kind, and the entry says
  where that run is recorded;
- **experimental**: built, but not yet run against a real account.

Its first content is §1's list. A face moves to proven when its live run is recorded. The live
runs themselves belong to 0141 (W11, §5). The matrix stays the long-form record and
the table is what the screen reads. A change to one goes into the same PR as the matching change
to the other.

**Where it shows.**

- On the card, in `FrontDoorChooser`, so the wizard and the connections page both show it. It is a
  small tag, *"Experimental"* / *"Experimenteel"*, and uses the Hint component's *why* to say:
  *"Built, not yet run against a real account of this kind. Keep your old account and check what
  arrives."*
- In the wizard's data-type step (the domain list in `CreateMapping.tsx`), beside any face of the
  chosen account that is experimental, for example the Microsoft 365 account's calendar.
- Beside the whole-domain option on the Google cards.

**Both editions.** Whether a connector has met a real account is a fact about the connector, not
about the edition. The label therefore also shows on the appliance, which offers the same cards.

**The export archive on managed** is not experimental: as the wizard offers it, it cannot work
there at all (§1). The proposal
is a different tag on managed only, *"Appliance only"* / *"Alleen op de appliance"*, with the
card disabled. Open question 4 asks whether to hide it instead.

**Guards.** Each of these fails on today's code, because the table does not exist:

- `apps/web/src/components/a-card-that-says-it-is-unproven.unit.test.tsx`: every `SOURCE_CARDS`
  id has a verdict, and every *proven* verdict says where its run is recorded. An experimental
  card shows the tag in the wizard and on the connections page, and a proven card does not.
- In orchestration, beside `source-face-builders.ts`: every face that `everyFaceClaimedBy`
  returns for an account kind has a verdict. This stops a new face from arriving without one.

### T3 — Billing says nothing is charged during the alpha

**The Billing page, when the setting says alpha:**

- The subtitle is replaced, and the page opens with one line. EN: *"Nothing is charged during the
  alpha. What you see here is measured so you can see how it works; it is not a bill."* NL:
  *"Tijdens de alfa wordt niets in rekening gebracht. Wat u hier ziet, wordt gemeten zodat u kunt
  zien hoe het werkt; het is geen rekening."*
- The tier block stays, prices included, under that line. The measurement is one of the things
  worth trying: 0121 T4 records the owner's decision of 2026-09-09 that the customer gets to see
  it. The prices shown are ADR-0014's (`MANAGED_TIERS` in
  `packages/managed/src/tier-calculator.ts`), which `tier-calculator.unit.test.ts` holds to the
  ADR's table and to the site's calculator.
- **Proposed:** the four metered cards are hidden while the setting says alpha. They show the
  quantities of the model ADR-0014 replaced, and on a page that says nothing is charged they look
  like a meter that is running. Whether they go for good is a question for 0121, not for this plan.
- Unchanged: the invoice list, which is empty, and the payment methods, where the page offers
  no way to add one. The *"Invoice details"* form (who invoices are addressed to, with an address
  and a VAT number) also stays as it is; the alpha asks nobody to fill it in, and T1's note says
  nothing is charged.

**The request page.** The package question (*"Which package looks right?"*) stays, because it
tells the owner roughly how large a request is. Its hint gains the sentence *"Nothing is charged
during the alpha."*

**Nothing to build on the server.** The invoice route already refuses every call.
`ownpace-live` keeps `MOLLIE_API_KEY` empty, which is a T5 check.

**Run rows (Proposed).** Accept that run rows are not pruned during the alpha while nothing is
invoiced. The rows grow with every pass, but the growth stops when the alpha ends, and it covers
at most 20 organisations over a few weeks. A retention rule for tenants that are never billed
belongs with capacity (0143, W13 in §5). This is revisited if the alpha is extended.

**Guard.** `apps/web/src/pages/a-bill-nobody-will-send.unit.test.tsx`: with the setting on, the
Billing page shows the line in both languages and none of the four metered labels. Without the
setting, the page is as it is today; that half is the control. The first half fails on today's
code.

### T4 — the end of the alpha

**What there is to end, for each tester:**

- an organisation and its members;
- migrations that keep running on their schedule;
- stored credentials, on connections and on migration rows;
- an identity at the identity provider;
- an access request;
- a Google test-user entry;
- run history.

Two things are not the service's to end: the copies at the tester's target, which belong to the
tester, and the source account, which no connector writes to.

**The options.**

- **(a) Everything ends.** The owner starts the operator hold, which stops scheduled passes, and
  its sentence says the alpha has ended. A pass a tester starts by hand is not held (§1). Each
  organisation is then closed with a 0-day or short window. The close route stops that
  organisation's passes in flight (`stopPassesInFlight`), and erasure revokes its stored
  credentials when the window ends. The owner deletes each tester's identity at
  `ownpace-live`'s identity provider and removes their Google test-user entry. Testers keep what
  arrived at their targets. *Recommended as the default.* D1's *"No obligations both sides"* is
  only true at the end if none of a tester's credentials is still stored.
- **(b) Everything carries on** into whatever follows, a longer test or the paid service, and new
  conditions are accepted first.
- **(c) Each tester chooses** between (a) and (b), and anyone who does not answer gets (a).

**What (a) needs that does not exist yet.**

- A way for the owner to close an organisation. The close API is for an organisation's own owner,
  and neither the web app nor `operator.sh` offers a path. A close screen is 0144's (W14); an
  audited operator command is the smaller build.
- A runbook step for the identity provider, because erasure does not reach it.
- An answer for credentials whose migration a tester deleted before the end. That row is gone, so
  erasure can no longer revoke its credential, and the delete did not revoke it either (§1). 0139
  T6 proposes that deleting a migration revokes its credential, as deleting a connection does,
  and owns the wording that promises revocation.

Under (a), each tester's granted access request goes with their organisation, because erasure
purges it (§1). A declined request is kept under every option, and nothing removes it. 0139 T6
proposes how long it is kept and what the privacy policy says about it.

### T5 — go/no-go before the first invitation

The first invitation goes out when every row below is either done or has the owner's written,
dated acceptance beside it. The table is the minimum, not the whole plan: each sibling plan
contains more than its row.

| Plan | The minimum before the first invitation | Today |
|---|---|---|
| 0131 The alpha (this plan) | T1 and T3 on `ownpace-live` with the setting on. T2 built. T4 decided, and 0139's conditions say what the end does. Open question 6 answered, and the answer in place. | Nothing built. Any owner or admin can invite by email address (§1). |
| 0132 ownpace-live beside the nightly gate, on one box | 0132's T1, T1b to T1e, and T3 (D3). **T1:** container names and scripts take the stack from `COMPOSE_PROJECT_NAME`, and a guard fails on a fixed stack name. **T1b:** `ownpace-live` has its own checkout and `.env`, fresh secrets from its first bring-up, its own ports and no demo. Its database passwords are generated before that bring-up, and its application role is created with its own password before anything migrates, because otherwise the baseline creates it with the repository's literal. **T1c:** its own Trigger.dev plane, never the OTA one. **T1d:** its own identity provider at `id.ownpace.eu`, and a web build that names it as the issuer. **T1e:** the production names routed to live's ports. **T3:** checked from a machine off the mesh, port 443 on the production names answers over TLS, the OTA names answer as 0132's open question 7 decides, and nothing else answers; every port that need not be reachable is bound to loopback in both stacks (T1f). The result is written in 0132. Deploying live by hand from a tag (T1g) goes with 0146. The tag live first runs names a commit on which both nightly gates are green on their last N scheduled runs (0132 T6, step 1). The review suggested five, and the owner names N. The runbook and the release checklist say what D3 decided (0132 T1g). | `managed.yml` pins `name: ownpace-managed` and gives 17 services a fixed `container_name`, and scripts address containers by those names, so a second stack cannot start beside the OTA one (0132 §1). The owner reports the ports unreachable off the mesh (D3). `managed.yml` publishes seven ports (the database, the API, the web app, the status page, the identity provider and two for Trigger.dev) on all interfaces, and `www.yml` the site's, unless the host restricts them. The application role's password is a literal in the shared baseline migration (`packages/ledger/migrations/0001_baseline.sql`), and `ensure-env-secrets.sh` generates neither that password nor the database owner's. |
| 0133 Mail that reaches a tester | On `ownpace-live`, one address outside the owner's own domains walks through the request, the grant mail, the identity provider's verification mail and the first sign-in, and every mail arrives in that inbox. SPF, DKIM and DMARC pass for the sending domain. Live's API and its identity provider both send through the relay, the provider with a login: `setup-zitadel.sh` hands it `SMTP_USER` and `SMTP_PASSWORD` since #1137 (merged 2026-09-24). The notice that a request has arrived reaches the owner. | `managed.env.example` defaults `SMTP_HOST` to `mailpit`, and every bring-up starts Mailpit, with or without the demo (`bootstrap-managed.sh`), so mail stays on the box until live's `.env` names the relay. |
| 0134 No backups during the alpha, said truthfully | The alpha conditions, T1's note and the grant mail say that nothing is backed up. Nothing the product shows promises a backup that does not exist. The owner has written down what a lost database costs a tester. | The application database has no backup (review); on `ownpace-live` it will hold the testers' data. The runbook's manual recipe dumps the zitadel database and the roles as well since #1137 (merged 2026-09-24), and says neither dump is usable without the stack's `.env`. |
| 0135 The sign-in page is the front door | Public organisation registration is off at `ownpace-live`'s identity provider (`id.ownpace.eu`), and the setting has been read back; 0135 applies the same to the OTA instance. A user of another organisation cannot sign in to the project. | Open, which is the upstream default (review), so a new instance starts open. The owner reports that no other organisations are hosted on the OTA instance (D3). |
| 0136 A host we are asked to reach | 0136's minimum, after its explanation. A host a tester types is refused before any connection when it resolves to loopback, a private or link-local range, or a compose service name, and redirects are checked too. The Docker networks and their gateway are among the refused ranges, because through them a container can reach the other stack's host-published ports (D3). The alternative is the owner's written acceptance, given in the knowledge that every tester is someone the owner let in. | No check (review). |
| 0137 Roles that mean what they say | A viewer or member cannot delete, cut over, repoint credentials or apply deletions. Until that is built, testers invite nobody below admin, and the conditions say so. An admin cannot invite an owner: done in #1137 (merged 2026-09-24), where the invite route answers 403. | Most writes are open to every role (review, including an integration test that asserts it). |
| 0138 Tasks under row security | Built, or accepted in writing with the reason stated. | Tasks read and write tenant data as the database owner, so row security does not apply in the worker plane (review). |
| 0139 The legal gate for the alpha | The lawyer's pass is done (D4) and the placeholders hold the owner's facts. The alpha conditions are published in Dutch and English: free, no obligations, a few weeks, no backups, and how it ends. The pages describe the service at the production names (D3). The privacy policy and the conditions are linked from the request page and the grant page; since #1137 (merged 2026-09-24) the grant page links to the privacy policy and the terms on `www.ownpace.eu`, in the reader's language. Each tester's acceptance is recorded with the version and the time. | Drafts with placeholders. `site/build.mjs` refuses `--public` while any placeholder is unfilled. |
| 0140 Consent screens a tester can pass | `ownpace-live` uses the production Google client, separate from the OTA stack's test client, and Microsoft and Dropbox know live's redirect addresses (D3). Each tester's Google address is a test user before they connect. Testers know Google will ask them to reconnect: after about seven days while the client is in Testing, a figure to confirm on Google's pages. A tester with a Microsoft work or school account knows, before pressing Connect, what their organisation's consent policy may do (0140 explains). Dropbox, Box and Apple carry T2's label. | The client registered on 2026-08-20 is the test (OTA) client, and production gets its own (`docs/google-oauth-verification.md` §4b). The client is in Testing (0089 T2 names the seven-day expiry). |
| 0093 T2c The request door | `TRUST_PROXY` and `ACCESS_REQUEST_MAX_PER_HOUR` reach the API (done in #1137, merged 2026-09-24), and `TRUST_PROXY` is set in `ownpace-live`'s `.env` for the ingress that 0132 settles. Spam protection is 🅿️ **Parked (trigger: junk in the queue, or the request address published)**: the owner reads every request, and a decline can be quiet. | Both are empty by default, so every caller shares one count (§1). |
| 0130 A problem report that reaches a person | A tester can reach a person. Either the report form works on `ownpace-live`, with a Zammad configured, or the conditions name an address the owner reads. | Built. On 2026-09-24 `managed.yml` does not pass `ZAMMAD_URL`, `ZAMMAD_TOKEN` or `ZAMMAD_GROUP` to the API, whose environment is an explicit list, so on a managed stack the form stays off whatever `.env` says, although step 8f of `docs/managed-bring-up.md` says to set them there. |

**The owner's own steps.**

1. The lawyer's pass, with the registered address, the btw-id and the hosting details supplied to
   0139 (D4).
2. The mail-sending account, and the DNS records for the sending domain (0133).
3. `ownpace-live` brought up from its own checkout and `.env`, never a copy of the OTA stack's,
   with its database passwords generated before the first bring-up and the application role
   created with its own password before anything migrates (0132 T1b). D3's answer says the user
   names are changed, and the answer on the database says the user and password will be; that was
   about the OTA stack, where 0132 T2 changes them with `ALTER ROLE`, and 0132 records which of
   these is done there.
4. Live's own Trigger.dev account, project and access token, and the production names routed to
   `ownpace-live` in NetBird (0132 T1c, T1e).
5. For each tester, before they connect: grant their request in `ownpace-live`'s access queue,
   and add their Google address as a test user of the production client (D2, 0140).
6. On `ownpace-live`: the alpha setting from T1 switched on, and `MOLLIE_API_KEY` left empty.
7. Name N for the nightly gates (0132 T6), and answer the open questions below.

## 4. Explaining the risk: who would need the credentials (D7)

The owner asked: *"Who would need/het credentials?"* Nobody. Rotation is not about who will be
given the secrets. It is about copies that already exist outside the owner's control.

- Workplan 0020 records that the stack's generated values (the database password,
  `SECRET_ENCRYPTION_KEY` and a Trigger.dev key) *"have appeared in pasted logs"*. It also says
  that *"trigger runner debug output prints the full task env, so treat runner logs as
  secret-bearing."* 0020 does not say where those logs were pasted. The machine also runs this
  public repository's CI (D3), and a public repository's workflow logs are not private.
- The application role's password is a literal in the shared baseline migration
  (`packages/ledger/migrations/0001_baseline.sql`), which this public repository contains.
  Nothing in the repository changes it (0132 T2), and the baseline creates the role with it on
  every new stack.
- The demo seed (`--with-demo`) creates demo organisations whose credentials are in the
  repository's scripts.

D7 stops new copies from being made. It does nothing about the copies that already exist.

**What D3 changes.** The logged values are the OTA stack's. `ownpace-live` does not inherit them:
it has its own `.env`, and at its first bring-up `ensure-env-secrets.sh` generates fresh values
for the secrets it knows (the signing and encryption keys, Trigger.dev's secrets, the identity
provider's master key and passwords, and the pooler's password). Live is never brought up with
`--with-demo`. So 0026 row 24 closes for `ownpace-live`, which never had demo secrets, and stays
parked with its trigger for the OTA stack, which remains a demo (0132 T5). The script does not
generate the database passwords: the database owner's is whatever live's `.env` says at the first
bring-up, and the application role gets the baseline's literal unless it is created with its own
password before anything migrates (0132 T1b).

**The advice.**

- For `ownpace-live`: copy nothing from the OTA stack's `.env`. Before the first bring-up, set
  the database owner's password in live's `.env`, and ClickHouse's and MinIO's, which
  `bootstrap-managed.sh` reports while they are at their shipped defaults. Changing the database
  owner's password once the volume exists changes nothing inside it (`bootstrap-managed.sh`).
  Create the application role with its own password before anything migrates (0132 T1b); if the
  baseline got there first, change it with `ALTER ROLE` before the first invitation (0132 T2).
  Keep live's `SECRET_ENCRYPTION_KEY` as its first bring-up made it. Stored credentials are
  encrypted under that key, and SECURITY.md states there is *"no rotation"*: a new key after
  testers have connected would make every stored credential unreadable, and every tester would
  have to reconnect.
- For the OTA stack: row 24's rotation waits for its trigger. When it fires, re-running
  `ensure-env-secrets.sh`, which row 24 names as the way to rotate, does not do it: the script
  says *"re-running it never rotates anything"*. 0132 carries the steps.

**The bridge D7 names is also a gate.** A pull request runs on GitHub-hosted runners (`ci.yml`),
so a contributor's code does not run on the machine before the owner merges it. After the merge
it does: a push to `main` runs on the self-hosted runner, and the nightly gates build `main`
there. SECURITY.md says of that runner: *"trusted workflows only (docker socket + root = RCE
risk)"*. So the owner's merge is the gate for code, just as the access queue is the gate for
people. The advice is to keep the self-hosted runner off `pull_request` events, as it is today,
and to read any change to `.github/workflows/` before merging it with the same care as a change to
the stack itself. D3's separation is by name on one Docker daemon, so a workflow that runs on that
runner can reach `ownpace-live` as well as the OTA stack.

## 5. Further work, and where it is planned

The review found more than the ten plans above cover, and this section first named the rest W11
to W19 so that they were not lost. On 2026-09-24 the owner chose, item by item: *"W11 write, W12
write, W13 write, W14 write, W15 explaoin, W16 write, W17 write, W18 explain, W19 write"*
("explaoin" is read as "explain"). The seven the owner said "write" to were opened the same day,
each under the next free number. The two the owner asked to have explained were explained and are
not planned yet; each gets the next free number when the owner chooses it.

**Opened 2026-09-24, at the owner's word "write":**

- **W11 → 0141 Proof before strangers:** live runs of the sources T2 labels, the 0103 organiser
  canary, the 0105 Soverin supervised run, and a browser smoke test on managed. Live proofs run on
  `ownpace-live`; the OTA stack's nightly gate stays the CI signal (D3).
- **W12 → 0142 Alerts someone reads:** somebody is told when the stack, the tick, the disk or a
  pass fails, on `ownpace-live` first.
- **W13 → 0143 A box with a known size:** capacity for both stacks on the one machine, each with
  its own Trigger.dev plane (D3), per-tenant caps, run retention for tenants that are never
  billed, and JMAP files over 8 MB. A manual sync's `concurrencyKey` is done: since #1137
  (merged 2026-09-24) the manual sync route sets it to the mapping's id.
- **W14 → 0144 Saying what is true to a tester:** the full notice, a tester guide, known
  limitations, the "read-only" wording, and a close-account screen.
- **W16 → 0145 Phones, screen readers and in-app browsers.**
- **W17 → 0146 A release testers can name:** a beta tag, the Node runtime of the tasks, and a
  watch on identity provider releases. `ownpace-live` is deployed by hand from a tag, while the
  OTA stack keeps following `main` nightly (0132 T1g).
- **W19 → 0147 An index that writes itself:** the workplan index regenerated, for the workplan
  session.

**Explained to the owner, not planned yet:**

- **W15 Help a tester can use:** in-app guides written for customers rather than operators, in
  Dutch.
- **W18 Removal fails closed:** DAV 412 on create, `If-Match` on delete, and 0009 T9.

## Open questions

1. **The end of the alpha (T4).** (a) everything ends, which is recommended; (b) everything
   carries on under new conditions; or (c) each tester chooses, with (a) for anyone who does not
   answer.
2. **Is the nightly managed gate paused during the alpha?** *Answered 2026-09-24, by D3: no.* The
   gate, scheduled for 03:30 UTC (`cron: '30 3 * * *'`), keeps rebuilding and seeding the OTA
   stack `--with-demo`, and testers are on `ownpace-live`, which CI never touches. 0132's earlier
   options for its T1, pausing the gate for the alpha's weeks among them, are superseded.
   `ownpace-live` is deployed by hand from a tag (0132 T1g, 0146).
3. **Does the first invitation wait for 0141's live proofs (W11) of the sources a tester will use?**
   (a) No: the label is the answer (D6), and the request's *"What are you moving?"* tells the owner
   which sources a person needs before the owner grants. (b) Yes, for the sources the first
   testers name. (a) is recommended, with one exception worth weighing. The Microsoft 365
   account's calendar face fetches each event from `…/events/{id}/$value` with an iCalendar
   preference header (`graph-calendar-source.ts`), and 0059 T5 records that nobody has confirmed
   Graph serves that combination. If it does not, the face needs rebuilding, not fixing.
4. **The export archive card on managed:** keep it with an "Appliance only" tag and disabled
   (T2's proposal), or hide it on managed? 0136 open question 3 is the same question: 0136 T5
   makes the managed API refuse the disk path and advises hiding the card. One answer serves
   both plans.
5. **Target cards:** should T2's label also go on targets? Soverin has no recorded live run as a
   target: 0105 T3's supervised run still waits for the owner. 0031 T2 says JMAP contacts are
   *"Not yet in the nightly e2e"*. The review says the same of JMAP files (0031 T3); that half
   was not re-checked here.
6. **Invitations inside a tester's organisation.** The owner is the gate for organisations (D2),
   but an owner or admin of one can invite anyone by email address, and that person gets in
   without the queue (§1). (a) Keep invitations during the alpha, limited to owner and admin as
   0137 T7 proposes, and let the conditions say that whoever a tester invites is the tester's
   responsibility. (b) Turn invitations off on `ownpace-live`, so that every person passes the
   queue. (b) matches *"I am the gate for letting people in the test."* more closely; (a) keeps a
   family or a small office able to try the service together. 0137 open question 1 asks the same
   question from the side of roles, with (b) here as its option (d).
