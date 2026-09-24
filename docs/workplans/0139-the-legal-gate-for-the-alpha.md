# Workplan 0139 — The legal gate for the alpha

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that the
legal texts of the managed service are unpublished drafts with unfilled placeholders. It also
found that no screen shows them where a tester's data is collected, and that no tester accepts
anything. Several promises in the drafts are not what the code does. The owner answered that a
lawyer reads the texts before the first invitation, that the test is called an alpha, and that
the owner supplies the missing facts and updates the texts (§2). This plan is the single
checklist for that gate: the owner's facts (T0), the lawyer's pass (T1), the alpha conditions
(T2), the product changes that make the texts true where a tester meets them (T3, T4, T6, T7,
T10, T11), the names the texts owe (T5), the procedures behind them (T8), and the security
policy (T9).

It extends 0086 T5 and does not replace it. 0086 T5 still owns the legal surface for taking money:
the data-processing agreement for business customers and the paid journey (0086 T6). This plan
owns what must be true before the first tester is let in. Every legal sentence is the owner's to
write and the lawyer's to check. This plan names sections and never rewrites them.

Nothing is built. Four drafts elsewhere feed this plan. The grant page's links to the addresses
the site build writes, in the reader's language, and the legal README's list of those addresses
are drafted in the pending consistency PR, which is not merged. 0134 T2 drafts the paragraph on
backups, 0131 T1 drafts the alpha note, and 0137 T0 drafts the sentence on inviting others.

| Task | Status | Notes |
|---|---|---|
| T0 The owner's facts: the placeholders and the names | ⏳ **Owner** (D1) | §3. Nine placeholder names are still open, and five facts have no placeholder yet. Values never go in this plan, only dates. |
| T1 A lawyer's pass before the first invitation | ⏳ **Owner**; 📋 **Decided 2026-09-24** (D1) | §3. The two existing briefings, plus the questions this plan adds. |
| T2 The alpha conditions, in Dutch and English | 📋 **Decided 2026-09-24** (D1, D2) | §3. Free, a few weeks, no obligations, no backups, no availability promise, how it ends. The owner writes them. |
| T3 Acceptance recorded, with version and time, at first sign-in | 📋 **Proposed** | §3. A screen, one managed table, and no connection or migration before acceptance. |
| T4 A notice wherever a tester's data is collected | 📋 **Proposed** | §3. The request form, the identity provider's registration page (0135 T5), the Connect buttons, the report form. The grant page's addresses are drafted in the pending consistency PR. |
| T5 The sub-processors named | ⏳ **Owner** for the names; 📋 **Proposed** for the text | §3. The ingress in front of the OTA names, the mail relay (0133 T5), the support channel (0130). |
| T6 What is kept, and for how long, made true | 📋 **Proposed** | §3. Access requests, credentials, preflight counts, sign-in data, logs, the task runner's stores, run history. A code change or a wording change for each. |
| T7 A tester can end their account | 📋 **Proposed** | §3. An audited operator command for the close that exists without a screen, and the identity provider's account (0135 T8). |
| T8 A breach procedure, a record of processing, a light impact assessment | 📋 **Proposed** | §3. One page in `docs/`, and two documents the owner keeps. |
| T9 SECURITY.md covers the hosted service, with one channel | 📋 **Proposed**; the channel is the owner's | §3. Scope, supported versions, a response target, `security.txt`. |
| T10 The texts published where a tester can read them, with no placeholder left | 📋 **Proposed** | §3 and open question 1. A build that refuses placeholders without becoming indexable, and one setting for every link the app makes to them. |
| T11 A family member's permission, recorded | 📋 **Proposed**; waits on T1 | §3. Only if the lawyer confirms the household model the terms describe. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24, unless it says otherwise.
The review's findings this plan carries are `wp-0086-legal-and-stale-status`,
`journey-legal-drafts-block-public`, `legal-drafts-unpublished`,
`codecfg-legal-placeholders-block-public-site`, `legal-no-notice-at-entry`,
`legal-test-terms-mismatch`, `legal-access-request-kept-forever`,
`legal-netbird-unlisted-subprocessor`, `legal-credential-retention-overclaim`,
`legal-no-breach-ropa-dpia`, `legal-drafts-disagree-internally`,
`legal-social-signin-not-disclosed`, `journey-no-account-closure-path`,
`legal-idp-identity-not-erased`, `ops-no-incident-response`, `rootdocs-security-md-hosted-scope`,
`wp-0110-support-disclosure` and `legal-household-permission-uncaptured`. The review confirmed all
of them. Where its verifier added a limit, the limit is stated below.

### The texts, and why none can be published

- **Six drafts.** `site/legal/` holds the privacy policy and the terms in English and Dutch,
  the data-processing agreement (`dpa.md`) and the sub-processor list (`subprocessors.md`). The
  privacy policy and the terms say *"Version: 1.1 (draft for legal review — not yet published"*.
  The other two say *"draft v0.1"*. The README's heading is *"These are DRAFTS. Do not publish
  them yet."*
- **Two lawyer briefings already exist.** They are HTML comments at the top of `privacy.md` and
  `terms.md`, with ten numbered questions each. The site build strips them.
- **What the build renders.** `site/build.mjs` renders the privacy policy and the terms in both
  languages (`SOURCE`). It does not render the data-processing agreement or the sub-processor
  list. Run with `--check` against `app.ota.ownpace.eu`, it printed *"14 pages across 2 locales,
  22 unfilled placeholder(s)"*.
- **The public build refuses.** `--public` throws while any placeholder is rendered
  (`if (PUBLIC && drafts > 0)`). It also throws unless `OWNPACE_APP_URL` is
  `https://app.ownpace.eu` (`PUBLIC_APP_URL` in `site/prices.mjs`). A build without `--public` is
  noindex, and shows each placeholder visibly without stopping. The alpha runs at
  `app.ota.ownpace.eu` (D5). So today the only build that refuses placeholders is one whose
  buttons lead somewhere other than the alpha.
- **Where the site is served.** `deploy/compose/www.yml` serves `site/dist`. Its header builds it
  with `OWNPACE_APP_URL=https://app.ota.ownpace.eu`, which is a noindex test build, and names
  `www.ota.ownpace.eu` as the test site. The review found that `www.ownpace.eu` does not serve
  this repository's site. That was not re-checked here.
- **The placeholders still open** in the documents (the README's table has twelve rows, of which
  three are filled and two are retired): `«REGISTERED_ADDRESS»`, `«VAT_NUMBER»`,
  `«HOSTING_PROVIDER»`, `«HOSTING_REGION»`, `«EMAIL_PROVIDER»`, `«EMAIL_REGION»`,
  `«LOG_RETENTION»`, `«SUBPROCESSORS_URL»` and `«PRIVACY_HISTORY_URL»`.
  `scripts/legal-docs.unit.test.ts` fails when `privacy.md` or `terms.md` uses a placeholder the
  README does not list. Its list of documents (`DOCS`) names those two only, so it does not read
  the Dutch files, the data-processing agreement or the sub-processor list.

**0086.** T5 is *"🟡 Drafted, not published"* and says *"Wants a lawyer, not this plan."* The
Status block is dated 2026-08-18 and says *"Nothing here is built"*, and T4 is still *"⬜
Planned"*, although 0093 built the request door that T4 plans, on 2026-08-22. This plan does not
edit 0086. Correcting its Status block belongs to whoever next works on 0086.

### Where a tester meets the texts today

- **The request form** (`RequestAccess.tsx`) shows one line, `access.privacy`: *"We keep what you
  type only to answer you; asking creates no account."* It has no link. The form stores an
  address, a name, an organisation and a note in the person's own words (managed migration 0002).
- **The grant page** (`Grant.tsx`) is the only screen that links the privacy policy and the
  terms. It links `https://www.ownpace.eu/privacy` and `/terms`, which are not files the build
  writes, and the site's nginx (`www-nginx.conf`, `try_files $uri $uri/ =404`) adds no `.html`.
  The pending consistency PR drafts links to the files the build writes, in the reader's
  language. The drafted links are still on `www.ownpace.eu`, which the review found does not
  serve this site (not re-checked here). T10 makes the host a setting.
- **The Connect buttons** (`ProviderConsentPanel` in `ProviderConsent.tsx`, the one path for
  Google, Microsoft and Dropbox) link neither text.
  `docs/google-oauth-verification.md` §5 requires *"Links to the privacy policy and terms sit
  beside the button, not in a footer."*
- **The report form** (`ReportProblem.tsx`, 0130) collects a description and a screenshot with no
  privacy link. 0130 T4 is 📋 Proposed.
- **The mails** in `packages/shared/src/notifications.ts` link neither text.
- **Acceptance.** Terms §1 says that creating an account or using the service is acceptance.
  Terms §7 relies on a customer's *"express request"* when the first migration is created. No
  screen presents the terms, and nothing in `apps/` or `packages/` records an acceptance. A search
  for `termsAccepted`, `terms_version` and similar names finds nothing.

### Terms written for a paid service

Terms §6 to §8 cover prices, the right of withdrawal and monthly billing through a payment
provider. Nothing is charged: `POST /api/billing/invoices/generate` answers
`409 billing_model_retired` (`NO_TIER_BILLING_CODE`). Terms §11 promises 30 days' notice before
the terms end, and 90 days' notice and an export if the service is discontinued. The alpha runs
for a few weeks (D2). Terms §9 already says there is no contractual uptime guarantee. Nothing in
the drafts covers a free test: that it may be reset or ended, or what happens to stored
credentials at its end.

### Promises the code does not keep

- **Access requests are never deleted.** Managed migration 0002 grants `app_user` INSERT on
  `access_request` and revokes DELETE. 0093 states the rule: *"No DELETE on `access_request` for
  anybody, operator included."* Offboarding purges only the rows that name the erased organisation
  (`PURGED_TABLES` in `packages/managed/src/offboarding.ts`), which is the granted request. Nothing
  prunes declined or open requests: neither `packages/ledger/src/retention.ts` nor a worker job
  names the table. The privacy policy has no section on access requests, in §4 or in §9. The
  review's *"nobody can delete them"* is slightly strong: the database owner can, and migration
  0020 did so for duplicates. There is no product path, runbook step or stated period.
- **Credentials outlive what §9 says.** Privacy §9 and the data-processing agreement's Annex A say
  credentials are destroyed when the migration ends or is deleted. The code differs in two places:
  - Finishing a migration (`POST /:mappingId/finish` in `operating-routes.ts`) keeps them on
    purpose. The answer says *"Set the mapping's status back to 'active' to resume"*.
  - Deleting a migration (`DELETE /:mappingId` in `apps/api/src/routes/migrations/index.ts`)
    deletes the row and revokes nothing. That row can hold a credential of its own
    (`mailbox_mapping.source_secret_ref`, written by `grant-ending.ts`).

  Deleting a connection does revoke (`revokeCredentialRow` in `connections.ts`, whose comment
  quotes the privacy promise). So does erasure (`revokeStoredCredentials`). A connection cannot
  be deleted while a migration uses it (`409 in_use`), so its credential lives until the
  connection goes, not until the migration ends.
- **Preflight counts.** Annex A says *"30 days if no customer relationship follows"*, and so does
  the privacy briefing's question 5. Privacy §4.3 and §9 say the counts go with their migration.
  The code agrees with §4.3: `migration_discovery` has `ON DELETE CASCADE` on its mapping (ledger
  baseline), and nothing prunes it after 30 days.
- **Account and sign-in data.** Privacy §9 says *"While your account exists, then 30 days"*.
  The close windows are 0, 7, 30 or 90 days, chosen by the customer (`CLOSE_WINDOWS_DAYS`). The
  identity provider's account is not erased at all: `offboarding.ts` never refers to it, the
  runbook's *Tenant offboarding* never mentions it, and ADR-0042 rules out an issuer-specific API
  in shipped code. 0135 T8 proposes the operator step.
- **Closing.** Terms §11 says *"You may close your account at any time."*
  `POST /api/tenants/:tenantId/close` exists with `requireRole('owner')`. Nothing in the web app
  calls it. `deploy/compose/operator.sh` has no close or erase command (its sub-commands are
  `list`, `add`, `remove`, `memberships`, `leave`, `check`, `clean` and `secrets`). The runbook's
  example calls the route with `$OWNER_TOKEN`, and an operator belongs to no organisation. So
  neither a tester nor the owner can close an organisation without raw API or database access.
- **Operators see service metadata.** 0110 turned support access on by default and disclosed it
  in privacy §4.5. That disclosure is in the unpublished draft only.
- **Social sign-in.** `managed.env.example` has `IDP_GOOGLE_CLIENT_ID`,
  `IDP_MICROSOFT_CLIENT_ID`, `IDP_GITHUB_CLIENT_ID` and `IDP_APPLE_CLIENT_ID` for sign-in
  buttons at the identity provider. The privacy policy mentions none of them, and §8 says there is
  no transfer to a third country *"by us"*. The keys are blank by default. Whether the OTA stack
  sets any of them is not visible from the repository. 0135 open question 10 asks this for GitHub.
- **Isolation in the database.** Privacy §11, its Dutch mirror and the data-processing
  agreement's Annex B say tenant isolation is enforced *"in the database itself through
  row-level security"*, and Annex B adds that database roles hold least privilege. 0138 found
  that the eight per-tenant jobs in `apps/worker/src/jobs/` open their pool from
  `DATABASE_URL`, which `set-task-env.sh` composes from the owner role. Checked here: all eight
  `run-*.ts` jobs read `process.env.DATABASE_URL`. So the sentence holds for the application's
  requests and not yet for the background tasks. 0138 hands the wording to this plan.
- **A separately held key.** Privacy §11 says credentials are encrypted *"under a separately held
  key"*. 0134 §1 notes that the key is held apart from the database, in `.env`, but on the same
  machine, and hands the wording to this plan.
- **Who in an organisation sees what.** 0137 found that the privacy policy does not say this, and
  that §4.2 leaves out display names and stored error text. The finding was only partly confirmed.
- **A family member's permission.** Terms §3 requires it before another person's account is
  connected. `grant-ending.ts` enforces it on the grant-link path (*"The account that signed in
  must be the one the migration names"*). The password paths (app passwords, IMAP, an Apple
  app-specific password) record nothing.

### Who else handles the data

Privacy §7 and `subprocessors.md` list two current rows, both placeholders: the hosting and the
mail relay. `subprocessors.md` also has one planned row, for invoicing. None mentions an ingress.
The repository says that TLS for the OTA names is terminated by NetBird. `managed.yml` says so in
its comment on `ZITADEL_EXTERNALPORT` (*"netbird terminating TLS on 443"*), 0091 says *"Routing
and TLS are netbird's, not this repository's."*, and the troubleshooting table in
`docs/managed-bring-up.md` says that behind netbird the identity provider's port is 443,
*"terminated by something that is not Zitadel"*. The repository does not say whether that
terminator runs on the reference machine or is a service the mesh provider operates. The review's
DNS lookup found the OTA names resolving to the mesh provider's hosted ingress. That was not
re-checked here, and the region and legal entity were not confirmed.
`docs/google-oauth-verification.md` still says that anyone off the mesh gets a timeout. 0132 T3
records the path a tester's request takes. No file in `site/legal/` mentions NetBird.

### Procedures

- **No breach procedure.** The data-processing agreement's §7 promises to notify a controller
  *"without undue delay after becoming aware"* of a breach. No runbook in `docs/` describes what
  happens then. A search of `docs/`, `site/` and `SECURITY.md` for a breach procedure, a record of
  processing activities or an impact assessment finds only that promise.
- **Two vulnerability channels.** `SECURITY.md` says GitHub Security Advisories is *"the only
  reporting channel"*. Privacy §11 says to write to support@ownpace.eu.
- **The security policy's scope.** `SECURITY.md` has a reporting section and principles. It has
  no scope for the hosted service, no supported versions and no response target. The site has no
  `security.txt`.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words, then the answer as given, typos included. Where
an answer needed a reading, the reading is stated.

**D1 — a lawyer first, and the owner writes.** *A lawyer's pass before the first invitation, or a
labelled beta notice? And can you supply the registered address, the btw-id and the hosting
details?* — *"Yes before, Alpha, and i can supply."* On the legal blocker (the drafts are
unpublished and full of placeholders, nothing is shown where data is collected, and no tester
accepts anything): *"I will update"*.

So the lawyer's pass happens before the first invitation, the test is labelled "Alpha", the owner
supplies the facts, and the owner updates the texts. This plan prepares what the owner and the
lawyer need. It does not write the texts.

**D2 — what the alpha is.** *Is the test free or paid, for how many people, for how long, and in
which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the posture of the
test: *"Free. A few weeks. No obligations both sides."* On the missing database backup: *"No
obligations during controlled test"*.

"No obligations both sides" is read as the contract: no service level, no payment, no minimum
term, and either side may stop. It cannot switch off the duties the GDPR places on whoever
controls personal data: telling people what happens to it, keeping it secure, notifying a breach,
and answering rights. The alpha processes whole mailboxes from the first tester on. So T4 to T8
stay necessary in a free alpha, and they are sized for 20 people.

**D3 — no backups.** *How much loss is acceptable, how fast must service come back, and where are
backups kept?* — *"None during the test"*. 0134 carries it. T2 includes 0134 T2's paragraph.

**D4 — the owner is the gate, and supports each tester.** *What may a member and a viewer do, and
should only owners and admins invite?* — *"I am the gate for letting people in the test."* On a
tester stack apart from CI and the nightly gate, reachable from the internet: *"Yes, but its a
controlled rest. I Let people in and support them. Max 10/20 people"* ("rest" is read as
"test"). *Should the Google client move to
production, or stay in Testing with each tester registered in advance?* — *"Ill add people by
hand"*. On its tokens, which expire after about seven days in Testing: *"I add people,
controlled small test Group."*

So every tester is someone the owner granted, and the owner is their contact. The conditions (T2)
say how to reach the owner.

**D5 — where it runs, and who can reach the machine.** *Where do testers run, and under which host
names?* — *"This machine, ci states. The OTA address. It's all controlled by me and invite only."*
("ci states" is read as "CI stays".) *Are ports 5432, 3001, 3090, 3443 and 3126 reachable from
outside, were the database passwords changed, and does the live identity provider hold other
organisations?* — *"No, these ports are not reachable outside of private network/NetBird.
Usernamea changed. No other organisations are hosted."* ("Usernamea" is read as "usernames".)
On rotating the demo secrets if the current stack is reused: *"Who would need/het credentials? I
aupporrthe test. No one will be added to NetBird network. Devs need to setup own private test/dev
environments. GitHub PRs and git is the bridge."* ("het" is read as "get", and "aupporrthe" as
"support the".)

So the alpha runs on the reference machine at `app.ota.ownpace.eu` and `id.ota.ownpace.eu`, and
only the owner administers it. The hosting placeholders (T0) and the record of processing (T8)
must describe that truthfully.

**D6 — mail.** *Which EU mail relay and sending domain, and does a person read support@?* —
*"I'll register a ownpace ampt, a todo"*. This is read as: the owner will register a
mail-sending (SMTP) account for Ownpace, as a to-do. On mail leaving the machine: *"I will
practically forward / help"*. So `«EMAIL_PROVIDER»` and `«EMAIL_REGION»` wait for 0133 T0, and
until then the owner forwards by hand (T5 covers what that means for the texts).

**D7 — unproven sources are labelled.** *For sources nobody has run against a real account:
prove them first, hide them, or label them experimental?* — *"Label"*. 0131 T2 builds the label,
and T2's conditions say what it means.

## 3. What each task does

### T0 — the owner's facts (owner)

**The placeholders.** The owner supplies a value for each of these, or says where it comes from.
Values go into the legal files, never into this plan.

| Placeholder | Where it comes from |
|---|---|
| `«REGISTERED_ADDRESS»` | The owner, in the printed form the owner chooses (the README leaves the form open). |
| `«VAT_NUMBER»` | The owner (D1). |
| `«HOSTING_PROVIDER»`, `«HOSTING_REGION»` | The owner. The README warns against naming a host the service is not on. During the alpha the service runs on the reference machine (D5), and the value must describe that. The lawyer checks the wording. |
| `«EMAIL_PROVIDER»`, `«EMAIL_REGION»` | The relay from 0133 T0, with its data-processing agreement. Until it exists, see T5. |
| `«LOG_RETENTION»` | 0129 D2 already gives the numbers: one month for the application's errors and warnings and for container output, two months for a pass's lines, and the audit log until the customer is erased. The owner confirms which of these the row states. T6 says where the alpha differs. |
| `«SUBPROCESSORS_URL»` | Follows from T10: the address where the sub-processor list is published. |
| `«PRIVACY_HISTORY_URL»` | The owner chooses where earlier versions are kept. One option is the file's history in this public repository. The lawyer says whether that meets privacy §13's promise. |

The data-processing agreement also carries `«REGISTERED_ADDRESS»` and `«SUBPROCESSORS_URL»`. It
is not rendered by the build, and 0086 T5 owns it.

**The facts that have no placeholder yet.**

1. **Where TLS ends for the OTA names** (T5). Is it on the reference machine, or at a service
   the mesh provider operates? If the latter, which legal entity, and in which region? 0132 T3
   records the path, and this answer decides whether the ingress is a sub-processor.
2. **The support mailbox.** Which provider hosts `support@ownpace.eu`, and does a person read it
   during the alpha (0133 open question 3)? Privacy §1 says *"A person reads that address."*
3. **Zammad.** Is the report form (0130) configured on the OTA stack, and where does that Zammad
   run?
4. **Social sign-in.** Which of the four `IDP_*_CLIENT_ID` keys are set on the OTA stack?
5. **Organisations in the alpha.** Is any tester a business rather than a household (open
   question 6)?

The dates on which each fact was supplied go in the Status block.

### T1 — the lawyer's pass before the first invitation (owner; decided, D1)

The lawyer reads the privacy policy and the terms in both languages, T2's conditions, the
sub-processor list, and T8's breach procedure, record and assessment. The two briefings at the top
of `privacy.md` and `terms.md` stay the brief. Their questions are still open. This plan adds the
following, which the owner can paste under them:

1. **The contract for a free alpha.** Are T2's conditions an addendum to terms v1.1 that says
   which sections do not apply (§6 to §8 on money, the notice periods in §11), or stand-alone
   conditions? And does *"No obligations both sides"* hold against Dutch consumer law, given terms
   §10's liability cap of what was paid in twelve months, which is nothing?
2. **Dutch first.** The alpha is Dutch (D2). The terms briefing's question 6, whether English can
   prevail over the Dutch text for a Dutch consumer, is now the live case.
3. **The retention truths** of T6, as decided by the owner.
4. **What the identity provider holds**, from 0135 T5: name, address, user name, a password hash,
   links to social sign-ins, and sessions. Plus whether removing an account also removes the
   personal data in its earlier events, which 0135 T8 did not check.
5. **Social sign-in**, if T0 says it is on: one sentence in §4.4 and §7, and whether §8's *"no
   transfer … by us"* still reads correctly. With it, 0140's sentence on who holds a Microsoft
   credential: the client secret is the deployment's, and the refresh token sits in the
   service's encrypted store, as it does for Google.
6. **Support.** 0130 T4's paragraph on problem reports, and privacy §4.5 (operators see service
   metadata, 0110) now reaching a tester for the first time.
7. **Who in an organisation sees what**, and §4.2's display names and stored error text (0137,
   partly confirmed).
8. **The lists the owner keeps for the alpha**: the testers' names and addresses off the machine
   (0134 T4), and each tester's Google address entered as a test user at Google (0140).
9. **Internal disagreements to settle in the same pass.** Annex A's preflight retention against
   privacy §4.3 and the code. The privacy briefing's *"counts kept 30 days"*. The terms briefing's
   item 10, which describes a revision that privacy v1.1 has already made. Privacy §11's
   vulnerability channel against `SECURITY.md` (T9).
10. **The household model**, terms §3 and the privacy briefing's questions 1, 2 and 6, which
    decide T11.
11. **What the security sections promise.** Isolation *"in the database itself"* (privacy §11,
    Annex B) holds for the application's requests and not yet for the background tasks (§1,
    0138). Either 0138 T1 to T3 land before the texts are published, or the texts say where row
    security applies and where it does not yet. And *"a separately held key"*: held apart from
    the database, but on the same machine (0134).

The owner records the date of the pass and the version numbers it approved in the Status block.
The first invitation waits for it (0131 T5).

### T2 — the alpha conditions, in Dutch and English (decided, D1 and D2)

**Where.** `site/legal/alpha.nl.md` and `site/legal/alpha.md`, rendered by the site build beside
the privacy policy and the terms, with a *Version* line like theirs. Dutch first, because testers
read Dutch (D2). Which language governs is T1's question 2.

**What they must say.** The owner writes the text. Each point has its source:

- **What the alpha is.** A trial of the managed service by a small group the owner invited, for a
  few weeks (D2, D4). The end date or the notice of the end is open question 7.
- **Free.** Nothing is charged, and the sections of the terms about money do not apply (T1 point
  1). 0131 T3 says the same on the Billing page.
- **No obligations either side.** No service level. The tester may leave at any time, and T7 says
  how. The owner may stop the alpha.
- **No availability promise.** The alpha may be paused (the operator hold, managed migration
  0023), reset or ended. Terms §9 already says there is no uptime guarantee.
- **No backups.** 0134 T2's paragraph, which the lawyer's pass decides.
- **Experimental sources.** What the label from 0131 T2 means, and that the tester should keep
  the old account until they have checked what arrived. Terms §10 already says that.
- **The end.** What the end does to organisations, credentials, sign-in accounts and access
  requests, as 0131 T4 decides. What was copied to the target stays.
- **The account is the tester's own.** It is not to be shared (0136). Inviting others follows
  0137 T0's sentence.
- **Google asks again.** While the Google client is in Testing, a tester must reconnect after
  about seven days (0140).
- **How to reach a person.** The report form (0130) or the support address (0133 open question 3).

0131 T1's short note and the grant mail's sentence must match these conditions, and they link to
them once they exist.

**Guard.** `scripts/legal-docs.unit.test.ts` gains a case that fails today: both files exist,
each carries a *Version* line, and the site build renders them in both locales. `alpha.md` joins
that file's `DOCS` list, so its placeholders must be in the README's table. The case in
`site.unit.test.ts` that *"ships a Dutch translation of each legal document"* names `privacy`
and `terms` only; `alpha` joins its list.

### T3 — acceptance recorded, with version and time, at first sign-in (proposed)

**What the tester sees.** After the first sign-in, and before any other page, there is one screen:
the alpha conditions, the privacy policy and the terms, each linked in the reader's language, and
one button to accept. It appears again when any of the three changes version. An invited member
(0099) sees it too, at their own first sign-in.

**What is recorded.** A new table in the managed migration chain (`packages/managed/migrations`,
never the shared chain), with the working name `legal_acceptance`: organisation, subject,
document (`alpha`, `privacy` or `terms`), version, language and time. `app_user` may insert and
read its own organisation's rows under row security. It may not update or delete them, so an
acceptance cannot be rewritten. A new version is a new row.

**Where it is checked.** `GET /api/me` reports whether acceptance is due, beside the membership
it already binds at first sign-in (`claimRequestedMembership`). `POST /api/me/acceptance` takes the
version and the language, and refuses any version but the current one, so a stale tab cannot
accept an old text. On the server, creating a connection or a migration answers
`409 conditions_not_accepted` until the current versions are accepted. The screen is the notice.
The refusal makes sure no credential is stored before it.

**The version.** The current versions are constants in `packages/managed`, because the app may not
import `site/legal/` (the README forbids it). A guard compares them with the texts.

**When it is on.** Off unless the deployment sets it, like 0131 T1's alpha setting, which can be
the same switch. The alpha stack sets it. The appliance never has it: the table, the constants and
the check live in `packages/managed` and the managed API, and the web app shows the screen only
when `GET /api/me` says acceptance is due. `no-managed-leakage.unit.test.ts` already refuses
`@openmig/managed` anywhere in the appliance's import graph, so a module there is kept out
without a change to the guard. Whether the paid service later turns it on for everyone is 0086's
question.

**Erasure.** The new table must be named in `PURGED_TABLES` or `RETAINED_TABLES`. The proposal is
to purge it with the organisation (open question 4).

**Guards.** Each fails today:

- `apps/api/src/routes/an-acceptance-with-its-version.integration.test.ts`. With the setting on,
  `GET /api/me` reports acceptance due, and creating a connection or a migration answers 409.
  Accepting the current version writes one row per document with version, language and time, and
  the same calls then succeed. An old version answers 409. With the setting off, nothing changes.
- `apps/web/src/pages/an-acceptance-before-the-first-connection.unit.test.tsx`. The screen shows
  the three links in both languages when acceptance is due, and does not appear once it is given.
- `scripts/a-version-the-tester-accepted.unit.test.ts`. The constants equal the *Version* lines of
  `alpha.md`, `privacy.md` and `terms.md` and their Dutch files.
- The erasure guard in `offboarding.unit.test.ts` (*"every tenant-scoped table has a DECIDED
  fate — purged, or retained with a reason"*) fails until the table is named.
  `force-rls-managed.unit.test.ts` then finds its row security forced, and a
  `legal-acceptance-under-rls` test beside the other `*-under-rls` tests shows that an
  organisation reads only its own rows and that nobody can update or delete one.

### T4 — a notice wherever a tester's data is collected (proposed)

| Where | What changes |
|---|---|
| The request form (`RequestAccess.tsx`) | The privacy policy and the alpha conditions linked under the form, in the reader's language. `access.privacy` states the period T6 decides, instead of saying nothing about how long. |
| The identity provider's registration and sign-in pages | 0135 T5: the instance privacy policy's links, set from `.env` and read back. They point at T10's addresses. |
| The Connect buttons (`ProviderConsentPanel`) | The privacy policy and the terms beside the button, as `docs/google-oauth-verification.md` §5 requires. |
| The report form (`ReportProblem.tsx`) | The privacy policy linked beside what the form says it will send. 0130 T4's paragraph is the policy's half. |
| The grant page (`Grant.tsx`) | Already links both texts. The addresses of the files the build writes, per language, are drafted in the pending consistency PR. T10 moves them into one module. |
| The access-granted mail | The link to the alpha conditions, with 0131 T1's sentence. |

**Guard.** `apps/web/src/components/a-notice-where-data-is-collected.unit.test.tsx` fails today.
It renders the request form, the Connect panel and the report form in both languages, and finds
the privacy link in the reader's language, taken from T10's module.

### T5 — the sub-processors named (owner for the names; proposed for the text)

The owner supplies each name (T0), and the lawyer checks the rows (T1). Privacy §7, its Dutch
mirror and `subprocessors.md` carry the same rows.

- **The ingress in front of the OTA names**: the application, the identity provider, the status
  page and the test site. The owner confirms it this way. If TLS ends at a service the mesh
  provider operates, that service sees every request in plain text: sign-ins, OAuth codes, app
  passwords typed into the wizard, and every page of metadata. It is then a sub-processor, named
  with its region under a data-processing agreement. If TLS ends on the reference machine and
  the provider carries only encrypted traffic, the texts need no row for it. The alternative to
  a new row is to move TLS termination onto the machine. No plan carries that yet; 0132 T3's
  record of the path is where it would start.
- **The mail relay**: 0133 T5 fills `«EMAIL_PROVIDER»` and `«EMAIL_REGION»`. Until the relay
  exists, the owner forwards mail by hand (D6). That mail then leaves through the account the owner
  forwards from, and its provider is the one the texts name for that period.
- **The support channel.** Whoever hosts `support@ownpace.eu` handles every rights request and
  support mail. The same goes for the Zammad that holds problem reports (0130), unless it runs on
  the machine the hosting row already covers.

No code changes, so there is no guard. T10 renders `subprocessors.md`, which gives
`«SUBPROCESSORS_URL»` an address.

### T6 — what is kept, and for how long, made true (proposed)

For each promise in §1, either the code changes or the text does. The owner decides which (open
questions 2 and 3), and the lawyer checks the words.

- **Access requests.** Proposed: a declined request is deleted 30 days after the decision. A
  granted one goes with its organisation, as today. An open one stays while it is open, because
  the owner answers every request (D4). The delete runs in the managed retention job
  (`apps/worker/src/jobs/managed-retention.ts`) over the owner's connection, so `app_user` and the
  operator still cannot delete a decision. 0093's rule becomes: a decision is not erased by a
  person, and it ages out on a stated date. Privacy §4 and §9 gain a row for access requests. The
  alternative is in open question 2.
  **Guard:** `packages/managed/src/a-request-nobody-keeps-forever.integration.test.ts` fails
  today. It checks that a declined request older than 30 days is gone, and that a younger one, an
  open one and a granted one stay.
- **Credentials on delete.** Deleting a migration revokes the credential its own row holds, after
  the delete, with `revokeCredentialRow`, as deleting a connection does. This matches the text
  whichever way open question 3 goes.
  **Guard:** `apps/api/src/routes/migrations/a-deleted-migration-revokes-its-grant.unit.test.ts`
  fails today. With a stub revoker, deleting a migration whose row holds `source_secret_ref`
  revokes once, after the row is gone. A 404 revokes nothing.
- **Credentials on finish.** Finishing keeps access on purpose: the finish answer says to set
  the status back to `active` to resume, and today the continuous lane is a second step after
  finishing (0128 §3, T3). Both need the credential. So the proposal changes the text, not the
  code: credentials are kept until the connection or migration is deleted, or the account is
  closed (open question 3).
- **Preflight counts.** Annex A follows privacy §4.3 and the code (T1 point 9).
- **Account and sign-in data.** §9 names the close window the tester chooses (0, 7, 30 or 90
  days), that there are no backups during the alpha (0134 T1), and the identity provider's step
  (T7, 0135 T8). It also names how long an account at the identity provider that nobody let in
  is kept: 0135 T8 proposes 30 days, and 0135 open question 6 asks the owner.
- **The task runner's stores.** 0134 T1 reads what each task returns and what a failed run's
  error can carry. The task events (ClickHouse) and large payloads (MinIO) that `managed.yml`
  describes are not backups, but they can outlive an erasure, and 0134 hands that finding to this
  task. If they can hold a tester's personal data, the text says how long they are kept, or they
  are pruned to match. Neither 0134 nor this plan has checked their retention.
- **Logs** (`«LOG_RETENTION»`, T0). One month for the application's errors and warnings is built
  (0129 T3). Whether container output on the reference machine keeps one month depends on the host
  setting 0129 T3's guide describes. That is not visible from the repository, and the owner checks
  it.
- **Run history.** The texts do not name it. 0129 D2 keeps a pass's lines and runs for two
  months. But managed retention prunes a tenant's runs only as far back as its newest invoice,
  and a free tenant has none (0131 §1). So in the alpha, run rows stay until the alpha ends or the
  organisation is erased. The text says so, or W13 (0131 §5) changes the rule.

### T7 — a tester can end their account (proposed)

The self-serve close screen belongs to W14 (0131 §5). The smaller build that makes terms §11
true in the alpha is an operator command.

- **`operator.sh close <tenant-id> <window>`**, through a new `close` sub-command of
  `apps/api/src/scripts/operator.ts`. The route does four things: it reads the grants only the
  customer can withdraw, calls `closeTenant` from `@openmig/managed`, asks the orchestrator to
  stop passes in flight (`stopPassesInFlight`), and answers the dates and the sentence in both
  languages. Those four move into one function that the route and the command both call, so the
  two cannot drift. The command passes the operator's subject as `closedBy`, takes a reference to
  the tester's request, and records both in the audit log. The window must be one of
  `CLOSE_WINDOWS_DAYS`.
- **The identity provider's account.** The runbook's *Tenant offboarding* gains 0135 T8's step
  after the purge. Until 0135 T8's script exists, the owner removes the account in the console.
- **The path a tester takes.** T2 says it: ask the owner through the report form or the support
  address, and choose a window. The owner closes within a stated number of days.
- **The end of the alpha** (0131 T4, option a) uses the same command for every organisation.

**Guard.** `apps/api/src/scripts/an-account-a-tester-can-end.integration.test.ts` fails today,
because the sub-command does not exist. For the same tenant and window, the command's result
equals the route's: the dates, the sentence and the standing grants. The command refuses a window
outside the list, and the audit row names the operator and the reference.

### T8 — a breach procedure, a record of processing, a light impact assessment (proposed)

**The breach procedure: one page in `docs/`**, working name `docs/breach-procedure.md`. A
procedure holds no secrets, so it belongs in the public repository. It covers:

1. **Contain.** The operator hold (managed migration 0023) stops the sync tick from starting new
   passes (`readOpenPause` in `managed-sync-tick.ts`). A pass a tester starts by hand is not
   checked against it (0131 §1), so the page also says how to stop those. If the nightly gate
   still runs on the machine, pause it first, because a rebuild destroys evidence (0132 T1).
2. **Keep the evidence.** Copy the application's events (`app_event`, pruned at 30 days) and the
   container output (kept a month where 0129 T3's guide is followed) off the machine before they
   age out, with the audit log beside them. 0129 T4's export covers the audit log once it is
   built. Until then, and for the rest, it is a query and a copy of the journal.
3. **Assess.** What data, which testers, and how likely a risk to them is.
4. **Notify the Autoriteit Persoonsgegevens** without undue delay, and where feasible within 72
   hours of becoming aware (Art. 33), unless the breach is unlikely to result in a risk.
5. **Tell the testers**, in Dutch, when the risk to them is high (Art. 34). For a business tester
   under the data-processing agreement, tell the controller (its §7).
6. **Register every breach**, notified or not (Art. 33(5)).

It includes the tester message as a template in Dutch and English, and one line on key rotation.
`SECURITY.md` says stored credentials have *"no rotation"*, so a leaked `SECRET_ENCRYPTION_KEY`
means every tester reconnects.

**The record of processing (Art. 30) and the light impact assessment.** Both are kept by the
owner and not in this repository. They record facts the repository deliberately does not hold,
such as the hosting details of T0 and the list of testers of 0134 T4. The record lists each
activity with its purpose, data, people, recipients, retention and measures: access requests,
sign-in accounts, stored credentials, the ledger's metadata, preflight counts, run history, logs,
the audit and support-read logs, problem reports, mail, the owner's list of testers, and the Google
test-user list. The review's reading is that the Art. 30(5) exemption does not apply, because the
processing is not occasional. The lawyer confirms it.

The assessment covers the household role (privacy §3), the correspondents in a mailbox who never
contracted with anyone, children's mail (privacy §12), where the service runs and who can reach it
(D5, 0132), and the ingress (T5). Whether a full assessment is required is T1's question. The
light one is done either way.

No code, so there is no guard. The Status block records the dates.

### T9 — SECURITY.md covers the hosted service, with one channel (proposed; owner's channel)

- **Scope.** The code in this repository, both editions, and the hosted service at the OTA
  addresses during the alpha. Also a sentence that testing against the hosted service needs the
  owner's permission first, because it holds testers' credentials. Anyone can bring up their own
  stack instead (`docs/selfhost-quickstart.md`, `docs/managed-bring-up.md`), and D5 says the same
  for developers.
- **Supported versions.** Stated by the owner. Before there is a release line, that is `main`.
- **A response target.** A number of working days to acknowledge a report, named by the owner.
- **One channel, stated the same way everywhere.** Recommended: the GitHub advisory form, which
  `SECURITY.md` already names, with `support@ownpace.eu` as the fallback for someone without a
  GitHub account. Privacy §11 then says the same in the lawyer's pass.
- **`security.txt`** at `/.well-known/security.txt` on the site, written by the site build, with
  `Contact`, `Expires`, `Preferred-Languages` and `Canonical`.

**Guard.** `scripts/one-way-to-report-a-vulnerability.unit.test.ts` fails today. It checks that
`SECURITY.md` has a scope section naming the hosted service, and that privacy §11 in both
languages and the built `security.txt` name the channel `SECURITY.md` names, in the same order.
It also checks that `security.txt`'s `Expires` is in the future and less than a year away.

### T10 — the texts published where a tester can read them, with no placeholder left (proposed)

- **A build that refuses a draft without becoming indexable.** A new switch, working name
  `--no-drafts`: the build throws while any placeholder is rendered, as `--public` does, but stays
  noindex and accepts the test app's address. The alpha's pages are built with it (open question
  1). `--public` is unchanged.
- **What it renders.** The privacy policy and the terms, as today, plus T2's conditions and
  `subprocessors.md`, so `«SUBPROCESSORS_URL»` has an address. The data-processing agreement stays
  0086 T5's.
- **One setting for every link the app makes.** Where the legal pages live is a build argument for
  the web app, which `managed.yml` passes as it passes `VITE_OIDC_ISSUER`. One module in the web
  app turns it into an address per page and per language. The grant page, the request form, the
  Connect panel, the report form and T3's screen all read that module. 0135 T5's
  `IDP_PRIVACY_URL` and `IDP_TOS_URL` are set to the same addresses.

**Guards.** Each fails today:

- In `site/site.unit.test.ts`: a `--no-drafts` build with a placeholder left throws, and without
  one it writes noindex pages.
- `scripts/a-policy-link-that-answers.unit.test.ts`: every address the module produces is a file
  the site build writes for that language, including the conditions and the sub-processor list.
  `managed.yml` passes the setting to the web build. This is the check that would have caught the
  grant page's addresses.

Beside them, `scripts/legal-docs.unit.test.ts`'s `DOCS` list gains every file the build renders,
including `subprocessors.md`. That passes today, and keeps a new placeholder in any of them from
going unlisted.

### T11 — a family member's permission, recorded (proposed; waits on T1)

Only if the lawyer confirms the household model of terms §3. When a password-type connection (an
app password, IMAP, an Apple app-specific password) is created for an address that is not the
signed-in person's verified address, the form asks for one acknowledgement: this is my account,
or I have this person's permission, or I am their parent or guardian. The acknowledgement is
written to the audit log. The grant-link path needs nothing, because it already checks whose
account signed in.

**Guard.** `apps/api/src/routes/a-permission-that-was-given.integration.test.ts` fails today. It
checks that such a connection without the acknowledgement answers 400 naming the field, that one
with it writes the audit row, and that a connection for the person's own address asks nothing.

## 4. Order

**Before the first invitation.** 0131 T5's row for this plan names a minimum: the lawyer's pass
and the owner's facts, the conditions published in Dutch and English, the privacy policy and the
conditions linked from the request page and the grant page, and each acceptance recorded. That
is T0 to T3, T10, and T4's request and grant rows. This plan recommends the rest of T4, and T5 to
T9, before the first invitation as well, for the reasons given with each (open question 8):

1. T0, then T1. The owner's facts go to the lawyer with the drafts.
2. T2 and T5, written by the owner, in the same pass.
3. T10's build switch and link module, T4 and T3. These are code, and can be built while the
   lawyer reads. T3 goes on with the versions the lawyer approves.
4. T6: the migration-delete revocation (code), and the wording or the purge for everything else.
5. T7's operator command. Terms §11 promises a close *"at any time"*, and today nobody can carry
   one out.
6. T8's breach page and the owner's two documents. The duty to notify starts with the first
   tester's data.
7. T9, which is small, in the same docs PR as T8.

**After the lawyer's answer:** T11.

Each code task is its own PR with its guard. The legal files change only in the owner's PR after
the lawyer's pass.

## Cross-references

- **0086 T5**: the legal surface for taking money, the data-processing agreement and the paid
  journey. This plan extends it and does not replace it.
- **0131**: T1's note and T3's Billing sentence must match T2, T4 decides the end that T2
  describes, and T5 holds this plan's go/no-go row.
- **0132**: T3 records the path a tester's request takes, which decides T5's ingress row. T1's gate
  pause is the first step of T8's procedure.
- **0133**: T0's relay and T5's rows. Open question 3 (support@) feeds T0.
- **0134**: T1's erasure sentence and T2's paragraph feed T2 and T6, and T1's finding on the task
  runner's stores feeds T6. T4's list of testers is in T8's record. The wording on the key held
  apart from the database is T1's point 11.
- **0135**: T5's links at the identity provider (T4, T10), and T8's step for the identity
  provider's account (T6, T7). Open question 6 there sets the period for accounts nobody let in
  (T6).
- **0136** and **0137**: the sentences on sharing an account and inviting others (T2), and who in
  an organisation sees what (T1).
- **0138**: the sentence on isolation in the database (T1's point 11).
- **0128**: today the continuous lane is a step after finishing, which T3 turns into a choice at
  the end. It is one reason finishing keeps credentials (T6).
- **0129**: D2's log periods (T0's `«LOG_RETENTION»`, T6), and T4's audit export for T8's
  evidence.
- **0130**: T4's paragraph on support requests (T1), and the report form as a way to reach a person.
- **0140**: the Google test-user list (T8), the reconnect every seven days or so (T2), the sentence
  on who holds a Microsoft credential (T1), and the entity facts publisher verification needs
  (T0).
- **W14** (0131 §5): the close-account screen that T7's command stands in for.

## Open questions

1. **Where the texts are published during the alpha (T10).**
   - **(a)** On the test site, noindex, built with `--no-drafts`, and linked from the alpha stack.
     *Recommended.* The alpha is by invitation, it lives at the OTA addresses (D5), and the
     public build's buttons lead to `app.ownpace.eu`.
   - **(b)** On `www.ownpace.eu`, built with `--public`. Its buttons then lead to
     `app.ownpace.eu`, which the alpha does not use.
2. **Access requests (T6).**
   - **(a)** A declined request is deleted 30 days after the decision. *Recommended.*
   - **(b)** The texts say requests are kept until the alpha ends, and the owner deletes them by
     hand as the database owner at the end, with a runbook step.
3. **Credentials when a migration is finished (T6).**
   - **(a)** Keep them, and the texts say so: until you delete the connection or migration, or
     close your account. *Recommended*, because resuming a finished migration, and today's step
     into the continuous lane after finishing (0128 T3), need them.
   - **(b)** Destroy them at finish, and the tester reconnects to resume.
4. **The acceptance record after erasure (T3).** Purged with the organisation, which is
   recommended, or retained with a stated reason?
5. **The vulnerability channel (T9).** The advisory form with support@ as fallback, as
   recommended, the advisory form alone, or an address alone? And the response target?
6. **Businesses in the alpha.** Households only, or may a tester be an organisation? If one is,
   privacy §3 makes the data-processing agreement part of its contract, and its draft is 0086
   T5's.
7. **The end of the alpha.** How much notice do testers get before it ends or is reset? Terms §11
   says 30 days' notice before the terms end, and 90 days' notice and an export if the service is
   discontinued. The conditions state the alpha's own notice period.
8. **What waits for the first invitation (§4).** 0131 T5's row asks for T0 to T3, T10, and T4's
   request and grant rows. This plan recommends the rest of T4, and T5 to T9, as well: notices on
   the Connect buttons and the report form, the sub-processors named, retention made true, a way
   to close an account, a breach procedure, and one vulnerability channel. Which of these must be
   in place first? 0131 T5's row is then updated to match.
