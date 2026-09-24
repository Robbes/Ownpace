# Workplan 0141 — Proof before strangers

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** The readiness review of 2026-09-23 found that
most of the sources a tester can pick on the managed edition have never completed a pass against a
real account. It also found that the places that could say so automatically have not said it
yet: one workflow has never completed a run, and one lane is green because it stands down. The
owner answered *"Label"* (§2, D1). An unproven source is offered with 0131 T2's "experimental" tag.
It is not hidden, and it is not proven first. This plan says how that tag comes off: one recorded
live run for each source or target, and the tag goes only when that record exists.

The plan also carries the review's other proof items:

- 0103's organiser canary;
- 0027's shared mailboxes;
- the managed detectors that give a Connect-with-Microsoft tester a false reason;
- a browser walk of the managed journey;
- the O365 and live-target lanes;
- a readiness rule for the nightly managed gate.

The owner chose to write it: *"W11 write, W12 write, W13 write, W14 write, W15 explaoin, W16 write,
W17 write, W18 explain, W19 write"*. 0131 T2 and 0131 §5 call this work W11.

Nothing is built. Most tasks are sittings the owner runs. They need real accounts and real
consent screens, and nobody else holds those (D5). A few related items were fixed in #1137, which
merged on 2026-09-24, and each is named where it comes up. Every fact in §1 was re-checked on
2026-09-24, the last time at `main` after #1137 merged. The run histories were read from GitHub's
API the same day.

**2026-09-24, later: the owner chose ownpace-live beside ownpace-managed (0132 D-new), and #1137
merged.** Testers use a second compose project, `ownpace-live`, at the production names, and the
OTA stack stays the nightly gate's target and the demo (0131 D3, 0132 D7). So a proof runs on
live, the way a tester will (D4, T1, T2, T12), and T7 stays on the OTA stack, beside the lane it
arms (0132 T1g). The gate is no longer switched off for the alpha, so T14's count builds through
it, and T12(c)'s trigger, 0132 T8, is superseded. The demo Nextcloud stays on the OTA stack
(0132 T5 is parked there), so open question 3 now asks where proofs on live write to. #1137's
five items are marked fixed where they occur. No run of the managed gate has happened since the
merge: the latest is still #196.

**2026-09-24, cross-plan sync after 0148 and 0149.** Later the same day the owner answered W15
and W18, which T8 (c) and *Not in this plan* called not planned. W15 is 0148, *A guide written for
the person using it*, and W18 is 0149, *Removal fails closed, and reads stay reads*; both places
now point there. The export archive card's row in §1 follows 0148 D3: the card is hidden on
managed, not tagged.

**2026-09-24, cross-plan sync after 0148's answers.** The owner keeps the *Via IMAP* card on
managed: *"dont hide IMAP, i tested that once and will do that again."* (0148 D5). The run the
owner made is not recorded, and neither is the registration it used. The next run is recorded
under T1 as the `oauth2` card's proof, and 0148 T8 (b)'s recipe is checked against it. §1's row
for the card says so.

**Before the first invitation.** This is the minimum, and it is kept small:

- T1, the record;
- T9, the organiser canary;
- T12's walk with two strangers, on `ownpace-live`;
- T14's reading of the nightly gate, before live's first bring-up from a tag;
- T11's true sentence, if a first tester brings a Microsoft 365 account.

**Before a tester who uses that source is granted** (the owner sees the source in the request's
*"What are you moving?"*):

- T2, the Microsoft 365 account;
- T3's Dropbox half;
- T4, Apple;
- T5, Google Tasks;
- T7, Soverin as a target;
- T10's move to Partial, for anyone on a Microsoft card.

**After the first invitation**, during or after the alpha: everything else.

| Task | Status | Notes |
|---|---|---|
| T1 The live-proof record: where a proof is written, and what counts | 📋 **Proposed** (D1) | §3. A "Live proofs" table in the feature matrix. 0131 T2's verdicts point at its rows. **Before the first invitation.** |
| T2 The Microsoft 365 account: all five faces, one pass on the owner's own account | ⏳ **Owner** (D1, D4) | §3. It starts with the calendar, because a "no" there means a rebuild (0059 T5). **Before a tester who uses it.** |
| T3 Dropbox and Box | ⏳ **Owner** (D1, D3) | §3. Dropbox on the owner's own account, **before a tester who uses it**. Box with the first Box tester, supervised (0140 T8), **after**. |
| T4 The Apple account (iCloud) | ⏳ **Owner** | §3. Part 1 of `apple-supervised-run.md`, then the separate first pass it asks for. **Before a tester who uses it.** |
| T5 Google Tasks | ⏳ **Owner** | §3. 0126 T8 as written. **Before a tester who ticks Tasks.** |
| T6 A second Google account, and Drive's open live items | ⏳ **Owner**, with a tester's agreement | §3. **After.** Whole-domain delegation is 🅿️ **Parked (trigger: a Workspace the owner administers, or a tester who asks for it)**. |
| T7 Soverin as a target | ⏳ **Owner** | §3. 0105 T3's sitting. Its step H needs a correction first. **Before a tester who picks the Soverin card.** |
| T8 Nextcloud and JMAP targets beyond our own servers | 📋 **Proposed** (the JMAP legs); ⏳ **Owner** (a hosted Nextcloud) | §3. **After.** Until then, a tester's contacts and files go to CardDAV or WebDAV rather than JMAP. |
| T9 The organiser canary (0103 T3) | ⏳ **Owner**; the gate's fixture 📋 **Proposed** | §3. **Before the first invitation**, because nearly every tester moves a calendar. |
| T10 Shared mailboxes: Partial until one is copied | 📋 **Proposed** (the move); ⏳ **Owner** (0027 T0's consent run, after) | §3. **Before a tester on a Microsoft card.** |
| T11 The detectors and the permission report tell a Connect-with-Microsoft tester the truth | 📋 **Proposed** | §3. The finding was checked again on 2026-09-24. The true sentence goes in **before the first Microsoft 365 tester**. Per-tenant credentials come **after**, with an ADR. |
| T12 The managed journey in a browser | ⏳ **Owner** (the walk); 📋 **Proposed** (fixture cases, and the real-API journey) | §3. The two-stranger walk happens on `ownpace-live` **before the first invitation**. The real-API journey comes **after**, in the gate on the OTA stack; it was parked on 0132 T8, which 0132 D7 superseded. |
| T13 The O365 lane and the live-target lane | ⏳ **Owner** (runner label, secrets); 📋 **Proposed** (code) | §3. **After.** A green run counts only when it ran the product's code against a real account. |
| T14 The nightly managed gate's readiness rule | ⏳ **Owner** (names N); 📋 **Proposed** (the rule) | §3. Worked out with 0132 T6 step 1. It is read **before the first invitation**, before live's first bring-up from a tag, and again before each later deploy to live. |

## 1. What there is today

### What a tester can pick, and what it rests on

Both doors read one list: `SOURCE_CARDS` and `TARGET_CARDS` in
`apps/web/src/components/front-door-cards.ts` (:60-108). The wizard's types match that list
(`CreateMapping.tsx`:74-75). An account card carries several faces:

- `microsoft`: email, calendar, contact, file, task (`provider-accounts.ts`:111);
- `google`: calendar, contact, task (:84);
- `apple`: email, calendar, contact, task (:129).

The `microsoft` faces are the `graph-*` connectors (`source-face-builders.ts`:137-142).

**Sources.**

| Card | Face | Today | What it rests on |
|---|---|---|---|
| IMAP (`imap`) | mail | proven on a server we run | Driven every night against Stalwart (`scripts/connector-coverage.unit.test.ts`:71, the `imap-oauth2` type). |
| Microsoft 365 account (`microsoft`) | mail (`graph-mail`) | ✅ in the matrix for the same reader under the `graph` card; no run through this card is recorded | 0114's connection Test on the owner's account, 2026-09-06: *"Measured: Email 25 messages · Contacts 0 cards · Files 3.8 GB"* (0114:5-8). That is a measurement, not a pass. |
| ″ | calendar, contacts, files, tasks | experimental | The matrix says *"⏳ wired; a live connection Test, no migration measured"* (`docs/feature-matrix.md`:399). The owner's first Microsoft preflight never finished counting Files. That was fixed on 2026-09-22, *"not yet proven on a live tenant"* (0058:13-14). 0059 T5(a) is open (below). |
| Microsoft 365 via IMAP (`oauth2`), via Graph (`graph`) | mail | ✅ in the matrix; the run behind it is not linked | 0008 T7 is marked ✅ Done (0008:13), but its acceptance, *"documented green run linked in this Status block"* (:114), has not been met. `e2e-o365.yml` has never completed a run (below). These cards need the tester's own Entra app registration. The owner has run the *Via IMAP* card once, a run nobody recorded, and will run it again (0148 D5). |
| Google account (`google`) | calendar, contacts | proven on one account | *"run against the owner's real Google account routinely for weeks"*, and *"NOT … a SECOND account"* (matrix :10-16). The matrix says it of the product cards; the owner's live migration runs on the `google` account kind (`permissions.ts`:280-281). |
| ″ | tasks | experimental | 0126 T8 is ⏳ (0126:71). The matrix's gap row marks it ✅ and *"unmeasured against a live account"* (:408). |
| ″ (whole-domain option) | all | experimental | *"Real-endpoint proof — DWD-minted tokens against live Drive/Gmail/Calendar/Contacts"* is ⛔ (0053:10). Matrix :402. |
| Google Drive, Gmail, Google Calendar, Google Contacts | — | proven on one account | Matrix :29, :78, :181 and the Files table. Drive: owner runbook Stage 1 *"Done 2026-09-16 and 17"* (`owner-test-runbook.md`:52), and 0042 T8, *"what the first live run left open"*. An edit made in Drive reaching the copy is *"proven in tests, not yet seen on a live run"* (0042:82-83). |
| Dropbox | files | experimental | *"(a) Real-endpoint proof — ⏳ … unproven here"* (0055:11). Matrix Files table ⏳, and the open-gaps row :400. |
| Box | files | experimental | The same words in 0056:10. Matrix Files table ⏳, and the open-gaps row :401. |
| Apple account (`apple`) | mail, calendar, contacts, tasks | experimental | *"Still **not measured against a live iCloud account**"* (0115:68-69). Matrix :405. Part 1 of `docs/apple-supervised-run.md` is still open. |
| Export archive (`archive`) | — | cannot work on managed as the wizard offers it | 0131 §1. The owner chose to hide it on managed rather than tag it (0148 D3, T3). It is not a proof question. |

**Targets.**

| Card | Face | Today | What it rests on |
|---|---|---|---|
| JMAP | mail | proven on a server we run | Stalwart, every night (`connector-coverage.unit.test.ts`:152). |
| JMAP | contacts, files | integration tests only | 0031 T2 *"Not yet in the nightly e2e"* (0031:9) and T3 (:10). `jmap-contact-target.integration.test.ts` and `jmap-file-target.integration.test.ts` exist. The only e2e fixture that uses `jmap` maps mail (`selfhost-restart-resume.mapping.json`). Calendars are not offered to JMAP (`target-domains.ts`:47). |
| IMAP | mail | proven on a server we run | `imap-dav` is driven against Stalwart on every pull request (`connector-coverage.unit.test.ts`:156-161). |
| CalDAV, CardDAV, WebDAV | — | proven on a server we run | Nextcloud, every night (:153-155). |
| Nextcloud (`nextcloud`) | calendar, contacts, files, tasks | proven on a server we run | The managed gate syncs demo tenant B's mapping, whose target is a `nextcloud` connection carrying calendars, contacts, files and tasks (`apps/api/src/scripts/seed-managed.ts`:151-161), into the demo Nextcloud, and verifies all four (`smoke-managed.sh`:2081, :2107). The smoke's *Nextcloud door* block writes nothing to Nextcloud: a probe, and a paused draft mapping with sentinel Dropbox credentials that it takes back (:4516-4636). 0103's run of 2026-09-22 was the owner's live Google → Nextcloud migration. A Nextcloud somebody else runs has not been a target. |
| Soverin (`soverin`) | mail, calendar, contacts, tasks | experimental as a target | 0105 T1 is *"door prepped"* and T3 is *"runbook ready … the sitting itself waits for the owner"* (0105:9, :11). That Status is dated 2026-08-26. The review found a live Soverin run only as a *source*. |

"Proven on a server we run" is weaker than it sounds. A tester's own Nextcloud, or a hosted JMAP
service (the matrix names La Suite and mosa.cloud, :32), meets the same writers on a server
configured by someone else.

Two lines of the matrix contradict its legend. The legend says ⏳ means *"built, awaiting first
contact with reality"* (:19-20). The gap rows for Microsoft To Do and Google Tasks carry ✅ beside
*"unmeasured against a live tenant"* and *"unmeasured against a live account"* (:407, :408). The
open-gaps table lists Dropbox and Box as *"⏳ built, unproven"* (:400, :401) since #1137, merged
2026-09-24.

0131 T2's table holds source kinds and their faces only. No tag marks an unproven target such as
Soverin; 0131 open question 5 asks whether one should. Until it is answered, the owner's grant is
the only gate in front of a target card (D3).

### Three things that look like evidence and are not

**1. `e2e-o365.yml` has never completed a run, and a green run would not prove the product.**

- GitHub records two runs, both dispatched on 2026-09-06 and both `cancelled`. The review found
  that the second waited 24 hours without a runner. The job asks for
  `runs-on: [self-hosted, linux, arm64, spark]` (:85), while the three other nightly jobs on the
  machine ask for `[self-hosted, linux, arm64]` (`e2e.yml`:149, `e2e-managed.yml`:120,
  `e2e-live-target.yml`:64). #1137 left the label to the owner, because the job reads a real
  tenant and the pin may be intended.
- The soak switch set `SOAKE_TEST_24H`, while the suite reads `SOAK_TEST_24H`
  (`o365-scenario.e2e.test.ts`:155). Fixed in #1137, merged 2026-09-24: `:81` now sets
  `SOAK_TEST_24H`.
- The workflow refuses to run without `O365_CLIENT_ID` and `O365_TENANT_ID` (:87-92). The suite
  underneath it still skips without them (`o365-scenario.e2e.test.ts`:21).

This plan found one more thing. `test/e2e/o365-scenario.ts` imports nothing from the product. Its
imports are `node:crypto` and `@azure/msal-node` (:14-15). It reads Graph through a client of its
own (`class O365GraphClient`, :385), over `/me/…` URLs with its own `$select` (:467). It never calls
`graph-calendar-source.ts`, which fetches each event from `…/events/{id}/$value` with
`Prefer: outlook.body-content-type="icalendar"` (:334, :340). Whether Graph serves that is exactly
what 0059 T5(a) leaves open: *"if it does not, the calendar source has no iCal to parse and the ⏳
becomes a rebuild"* (0059:11).

There is a further consequence, reasoned from Graph's documented behaviour and not run here. Graph
serves `/me` only to a delegated token, so with only the application secret set, the scenario's
reads would fail.

**2. The live-target lane is green because it stands down.**

- GitHub shows 28 runs, all `success`, the latest (#28) on 2026-09-23.
- Unconfigured, the lane *"STANDS DOWN loudly-but-green"* (`e2e-live-target.yml`:12-15). The
  review read the latest log, which showed zero `LIVE_*` lines and a stand-down. This plan read only
  the run list.
- The lane is armed by step H of 0105 T3's sitting (`docs/soverin-supervised-run.md`), which has
  not happened.

Step H, as written, arms the lane in *mint mode*: `LIVE_TARGET_JWT_SECRET=<the stack's own
JWT_SECRET>`. That cannot sign in to the OTA stack:

- `selectAuthMode` returns `managed` whenever `JWT_ISSUER` is set (`apps/api/src/middleware/auth.ts`:820-824);
- the smoke says of that case: *"ON A PROVISIONED STACK THE API WILL NOT ACCEPT WHAT THIS MINTS"*
  (`smoke-managed.sh`:236).

On that stack, the lane needs its other mode, `LIVE_TARGET_API_TOKEN`, which the workflow header
describes as *"a long-lived token from a real issuer"*. Step H names that mode in one sentence
(*"On a stack that verifies only against a real issuer, set `LIVE_TARGET_API_TOKEN=<a long-lived
token>` instead"*), but its block and its explanation are written for mint mode, and it does not
say whose token that is or how it is made. Under 0132 D7 the lane stays with the OTA stack: it
reads that stack's persisted `.env` (0132 T1g), and step H points `LIVE_TARGET_API_URL` at
`http://localhost:3001`, the OTA stack's API while live takes ports of its own (0132 T1b).

**3. The coverage table cannot speak for most of what a tester picks.**

- `connector-coverage.unit.test.ts` marks `microsoft`, `google`, `gmail` and the other three Google
  product types, `dropbox` and `box` as `uncoverable` (:99-123), and the five `graph-*` types as `owed`
  (:83-98).
- Its lists come from what `config.ts` accepts (:57-65). The managed connection kinds `apple`,
  `soverin` and `nextcloud` are not config types (`config.ts` has a `google` and a `microsoft`
  branch, and none for these three), so no verdict speaks for them at all.
- Its one `jmap` target verdict reads *"the mail target every nightly writes into"* (:152) and
  stands for the whole type.

### The detectors read the stack's credentials, and look for the wrong kind

Checked on 2026-09-24:

- Drift detection finds a tenant's Microsoft source with `kind = 'o365'`
  (`managed-drift-detect.ts`:104-106). It then asks `directoryAvailability(process.env,
  graphTenantId)` (:117) and mints the token with the stack's client for the customer's tenant
  (:121-127). The permission report does the same lookup and the same call (`permissions.ts`:259-265).
  Group discovery visits every source, and branches on the kind in code rather than in SQL
  (`managed-group-discovery.ts`:73-85, :104).
- `directoryAvailability` reads only `OAUTH2_CLIENT_ID`, `OAUTH2_CLIENT_SECRET` and
  `OAUTH2_REFRESH_TOKEN` (`directory-availability.ts`:23-27). There is one set for the whole stack
  (`managed.env.example`:59-62), uploaded to the tasks by `set-task-env.sh` (:185-188).
- Only the `oauth2` and `graph` cards are stored as `o365` (`credential-fields.ts`:641-644). A
  Connect-with-Microsoft connection is stored as `microsoft`, so for that tester `graphTenantId` is
  undefined. The answer is then *"this tenant has no Microsoft 365 source connection, and only
  Graph can enumerate a directory"* (`directory-availability.ts`:44-53). Group discovery gives
  every non-`o365` source IMAP's answer (`managed-group-discovery.ts`:104): *"IMAP has no directory
  …"* (`imap-groups.ts`:30-40).
- Who reads these sentences:
  - The two jobs write their blind spots to the worker log (`run-new-mailbox-detection.ts`:99-103,
    `run-group-discovery.ts`:119), so the operator reads the wrong reason.
  - The permission report is read by the tester. The Finish step's `PermissionsHandover` fetches
    `/permissions/report` (`operating-service.ts`:219-223), and the report's calendar section
    carries the sentence (`permissions.ts`:322-350).
- The true answer for a `microsoft` connection would be different anyway. Its grant is delegated:
  `Mail.Read` and the other read scopes over the signed-in person's own data
  (`microsoft-scopes.ts`:52-58). No stack credential
  lets it read a directory. The matrix says as much: *"another user's store still needs
  `oauth2`/`graph` with application permissions"* (:399).
- For a tester on the `oauth2` or `graph` cards with their own registration and secret, the three
  consumers ignore that stored credential and use the stack's. 0026 row 14 says the managed edition
  reads *"from the per-connection encrypted credential store … nothing global to verify"*. That is
  true of the migration. It is not true of these three.

Since #1137, merged 2026-09-24, `managed.yml` passes `GRAPH_FILES_READ_CONSENTED` to the API
(:868), which the report reads. It does not change anything above.

### Shared mailboxes are promised to a card that cannot read them

`scope-manifest.ts`:207-213 lists *"Shared mailboxes — Copied like any other mailbox, with the same
checks."* under `migrates` (:164). It applies to the `microsoft` scope family (:209), and the
`microsoft` card belongs to that family (:40). The folded text adds *"Needs application permissions
on the source"*. The `microsoft` card's grant has no application permissions (above).

So a Connect-with-Microsoft tester's confirm page promises something that card cannot do. And
nobody has copied a real shared mailbox with any card:

- 0027 T0: *"the live proof is the only thing left, and it waits on the owner running the consent
  steps"* (0027:7, Status 2026-08-04);
- 0028 T2 and T3 wait on the same step, and so does 0029 T1.

The acceptance is a live read *"against the tenant the deployment's own `OAUTH2_*` credentials point
at"*, on Tenant A, whose only Global Administrator is the owner (`docs/test-tenant.md`:16-18,
:74-80).

### The organiser canary is open

0103's Status (2026-09-22, :5-13) records the first live update: an attendee was added, the copy
changed, and the catcher heard nothing. It also says: *"**T3's canary, an event the owner
organises, stays open**"*. The gate's canary event has a third-party organiser (0103:20).

### Nothing drives the managed journey in a browser against a real API

- `test/ui/managed-ui.ui.test.ts` says: *"Pixel diffs, wizard flows and money paths are out of
  scope"* (:23-24), and *"No API, no database, no Docker"* (:26). It covers booting and styling,
  the same-origin check, the migrations list, the build stamp, Report a problem, both languages, and
  the operator's screens. The appliance has a real-stack browser test
  (`test/e2e/selfhost-ui.e2e.test.ts`).
- The managed smoke signs in for real (`smoke-managed.sh`:371, :927), and files and grants an
  access request (:3396-3419). It creates its identity-provider users already verified (:427), and
  it drives no browser.
- Grant links are Google only (`grant.ts`:267-274, `/:link/google/authorize`).
  `gate-coverage.unit.test.ts`:89-95 exempts `/api/grant` and gives the reason.
- The API only prepares a cutover (`run-rollback.ts`:27-29). Whether the §20 completeness gate
  passes over real volumes is owner runbook Stage 7 (:327-333), and no outcome is recorded there.

### The nightly managed gate has not been green on schedule since 2026-09-20

This was read from GitHub on 2026-09-24:

| Run | Date | Trigger | Result |
|---|---|---|---|
| #191 | 2026-09-20 | scheduled | success (the last scheduled one) |
| #193 | 2026-09-21 | scheduled | failure |
| #194 | 2026-09-22 | scheduled | failure |
| #195 | 2026-09-23 | scheduled | failure |
| #196 | 2026-09-23, 11:07 UTC | dispatched | success |

The review gives the causes:

- #193 and #194: the tasks run Node 21, whose `node:zlib` has no `crc32`. 65c0926 stopped
  depending on it; the tasks still run Node 21, because `trigger.config.ts` names no runtime
  (0146 T6 carries that);
- #195: the API restarted in the middle of the run (0132 §1).

The cron is 03:30 UTC (`e2e-managed.yml`:86). GitHub started the three scheduled runs between 08:41
and 09:10 UTC.

#1137, merged 2026-09-24, moved the managed gate and the lane to Node 24 (`e2e-managed.yml`:127,
`e2e-live-target.yml`:71). Its description asks for one dispatched run of the gate after the
merge; none had run when this was checked. Under 0132 D7 the gate keeps running nightly on the OTA
stack through the alpha, and live is deployed by hand from a tag whose commit the gate ran green
(0132 T1g, T6 step 1). T14 says how many green runs that takes.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words, then the answer as given, typos included.

**D1 — the label.** *For sources nobody has run against a real account: prove them first, hide
them, or label them experimental?* — *"Label"*. So no source waits for its proof to be offered. The
proof is what takes the label away (T1).

**D2 — how big the alpha is, and for how long.** *Is the test free or paid, for how many people, for
how long, and in which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On the
test's posture: *"Free. A few weeks. No obligations both sides."* So at most 20 testers, over a few
weeks, each naming what they want to move. A proof matters for the sources those testers name, and
not for all of them at once.

**D3 — the owner lets each tester in, and supports them.** On roles: *"I am the gate for letting
people in the test."* On a separate tester stack: *"Yes, but its a controlled rest. I Let people in
and support them. Max 10/20 people"* ("rest" is read as "test", as 0131 reads it). So the owner can
hold a request until its source is proven. For a source only a tester can bring, such as Box, the
owner can sit beside that tester's first run.

**D4 — where the proofs run.** *Where do testers run, and under which host names?* — *"This
machine, ci states. The OTA address. It's all controlled by me and invite only."* ("ci states" is
read as "CI stays".) Later the same day the owner put testers on a second stack on the same
machine, `ownpace-live`, at the production names, and kept the OTA stack as the nightly gate's
target and the demo (0132 D7, where the owner's words are quoted; 0131 D3). So a proof runs
through the managed wizard the way a tester will: on `ownpace-live` (0131 §5). A sitting that
needs the OTA stack's demo or its lane, as T7 does, runs there, and the record says which stack.
CI's lanes stay with the OTA stack, on the same machine (0132 T1g).

**D5 — who can run a live proof.** *If the current stack is reused, its demo secrets must be
rotated* — *"Who would need/het credentials? I aupporrthe test. No one will be added to NetBird
network. Devs need to setup own private test/dev environments. GitHub PRs and git is the bridge."*
("het" is read as "get", and "aupporrthe" as "support the".) So only the owner holds the real
accounts, the stack and the consents. A contributor can build a harness in their own environment
and send it as a pull request, and the owner runs it. That is why most tasks below are the owner's.

## 3. What each task does

### T1 — the live-proof record (proposed; before the first invitation)

**What counts as a live proof.** All of the following:

1. **The product's own path.** The managed wizard on `ownpace-live`, or on the OTA stack where a
   sitting needs it (D4), or the appliance with a mapping file. The run uses the product's own
   connector for that kind and face. A harness with a client of
   its own does not count (§1, the O365 scenario).
2. **A real account at the provider**, with data a person made. A fixture does not count. A server
   we run counts only as "proven on a server we run", and the record says so.
3. **A completed pass.** It ends `completed`, not paused, failed or stopped.
4. **Counts for each face:** what the preflight found, what was copied, and what was skipped or
   refused, with the reason.
5. **A verification.** For that face, Verify says PASS. Where Verify does not cover the face, the
   owner compares the counts with the provider's own screen and writes down both numbers.
6. **A second pass that creates nothing.**
7. **Silence.** For calendars and tasks with attendees, the catcher or catch-all stayed silent
   (T9's rule).

These do not count: a connection Test, a preflight on its own, a gate that stood down, and a run
of a harness that imports none of the product's connectors.

**Where it is written.**

- **A new section in `docs/feature-matrix.md`, "Live proofs".** One row per proof:
  - date;
  - kind and face;
  - edition, stack, and the deployed tag or commit (live runs tags, 0146);
  - account class: the owner's own, a second account, or a tester's (supervised, with their
    agreement);
  - target kind;
  - counts: found / copied / skipped / created on the second pass;
  - the verification;
  - the workplan whose Status holds the detail.

  A row holds no address, no name and no tenant id: counts and classes only.
- **The source's workplan Status:** a dated paragraph with the same numbers, and anything the run
  found.
- **0131 T2's table.** The verdict flips to proven in the same pull request, and its "where" names
  the matrix row. The matrix's ⏳ for that face becomes ✅, with "one account" or "two accounts".

A face whose connector is rebuilt goes back to experimental in the pull request that rebuilds it.
T2's calendar is the likely case.

**Guard.** `scripts/a-proof-that-was-written-down.unit.test.ts`:

- every Live proofs row has every field, numeric counts, a second pass of 0, and a verification;
- no row in the open-gaps table carries ✅ beside "unmeasured" or "unproven";
- once 0131 T2's table exists, every proven verdict names a Live proofs row with the same kind and
  face, and no experimental verdict has one.

It fails today: the section does not exist, and the open-gaps rows at :407 and :408 break the
second rule. Fixing those two rows means marking them ⏳, as the legend asks. That goes in the same
pull request.

### T2 — the Microsoft 365 account, all five faces (owner; before a tester who uses it)

**The sitting.** It runs on `ownpace-live` (D4), once Microsoft knows live's callback (0140 T11).
The owner uses *Connect with Microsoft* with their own
account, the one 0114's Test measured, and ticks all five faces. Calendars, contacts, files and
tasks go to a Nextcloud the owner holds, and mail goes to a mail target the owner controls. Live
has no demo servers, so open question 3 asks which. The faces go in this order:

1. **Calendar first, on its own.** Preflight, then one pass over calendars only. If events arrive
   without bodies, or the pass cannot parse them, 0059 T5(a) is answered "no". The face is then
   hidden until it is rebuilt, and the rebuild is its own plan. A tag that says "not yet run" must
   not stand in front of a face known to be broken. Check a recurring event, an all-day event and
   one with attendees (T9's silence).
2. **Contacts.** Cards from the default folder, which 0114 moved to `/me/contacts`, and photos,
   which have been read since 2026-09-23 (matrix :181).
3. **Files.** The preflight finishes counting (0058 T7/T8). Nested paths arrive nested; 0058 T6(b)
   says *"the first live run settles it"*. Include one name with a space and one with an accent.
4. **Tasks.** A To Do list with a checklist and a repeating task. What To Do drops is 0126 T7's to
   report.
5. **Mail**, through this card.

Each face is recorded by T1's rule. The counts are compared with what Outlook shows.

**With 0140.** 0140 T6 runs one foreign organisation and one personal account through the
registration live uses (0140 T11), and it records the consent side. If its pass completes, it is also a
second-account proof for these faces.

**When.** Before a tester who picks the Microsoft 365 account card is granted. This is the proof
0131 open question 3 singles out.

No code, so there is no guard.

### T3 — Dropbox and Box (owner)

**Dropbox, before a tester who uses it.** Live needs a real Dropbox app first. 0140 T7(a) asks
whether one exists: the OTA stack's `DROPBOX_OAUTH_CLIENT_ID` may be the gate's placeholder, and
live's starts empty. If there is none, the owner decides whether to register one for live (0140
T7(a) and its open questions 5 and 8). The sitting, on live:

- the owner's own Dropbox account, holding a tree with nested folders;
- the target is a Nextcloud the owner holds (open question 3);
- after the first pass, rename one file and delete another. The deletion arrives in the Deletions
  queue as `trashed`-class evidence (matrix, Files).

Once 0140 T7(b) narrows the consent to read scopes, the first consent is also recorded there. This
proof does not cover Dropbox Business team folders, which 0055 T3(c) left untouched. 0144 T2's
known-limitations page says so, in its alpha part.

**Box, after.** Box needs a Box Platform app approved in a Box enterprise (0140 T8).

- If the owner has such an account, the sitting has the same shape. The bin read lets a Box
  deletion be applied, not only reported (matrix, Files). Box Notes arrive as their JSON bytes
  (0056 T3(d)).
- If not, the first Box tester's run is the proof. The owner supervises it, as 0140 T8 already
  says, with the tester's agreement, and records counts only (open question 2).

No code, so there is no guard.

### T4 — the Apple account (owner; before a tester who uses it)

The sitting has two parts:

1. **Part 1 of `docs/apple-supervised-run.md`** (1a to 1e): the app-specific password, the
   deliberate first failure, the dash question, the username question, and what Test says.
2. **The first pass.** Part 1 stops at Test on purpose: *"a first real run against a personal Apple
   account is a separate, deliberate sitting with a scratch target"* (1f). That run is the proof,
   on live, into scratch targets as 1f asks: calendars, contacts and Reminders to a scratch
   Nextcloud account, and mail to a scratch mailbox.

Check the two hosts and the home set on the partitioned host (matrix :120-123), and Reminders
arriving as `VTODO`. Record in 0115 and in the matrix row at :405. The guide says the owner has an
Apple account with real data in it.

No code, so there is no guard.

### T5 — Google Tasks (owner; before a tester who ticks Tasks)

0126 T8 as written: reconnect with Tasks ticked, and add Tasks to the migration. Its checks
(0126:71) include:

- the preflight counts completed tasks too;
- subtasks arrive nested;
- a second pass creates nothing;
- an edit in Google reaches Nextcloud;
- Mailpit stays silent.

The same sitting answers 0126 T6's last question: what Nextcloud does with an MKCALENDAR that
carries no component set. 0126 T7, which says what does not carry, is built after, as 0126 says.

No code, so there is no guard.

### T6 — a second Google account, and Drive's open live items (owner; after)

- **A second account.** The first Google tester's pass counts, with their agreement, as "a
  tester's, supervised", counts only. It moves the matrix row at :394 from one account to two. A
  grant link opened by an account other than the owner's is part of T12's walk.
- **Drive, on the owner's own account:**
  - an edit made in Drive reaches the copy on a live run (0042:82-83);
  - a renamed Google document pairs by its Drive id (0042 T10 (a)).
- **Question zero** (`owner-test-runbook.md`:302-309): does Google's CalDAV accept
  `calendar.readonly`? 0144 open question 6 hands its record to this plan. The answer, either way,
  is written in the Live proofs table and in 0045's Status. If the answer is yes, the code narrows
  the scope in its own plan, and 0144 names one product fewer.
- **Whole-domain delegation** stays labelled (0131 T2). It is 🅿️ **Parked (trigger: a Workspace
  the owner administers, or a tester who asks for it)**. It grants access to a whole domain, and the
  first run of it should not be on a stranger's organisation (review).

None of this is a label. The Google product cards are proven on one account.

No code, so there is no guard.

### T7 — Soverin as a target (owner; before a tester who picks the Soverin card)

0105 T3's sitting, `docs/soverin-supervised-run.md` steps A to H. Before it, two things change
and one is settled:

- **Step H's sign-in (a change).** Mint mode cannot sign in to the OTA stack (§1). Step H is
  rewritten for `LIVE_TARGET_API_TOKEN`, which today it names in one sentence only. The rewrite
  says whose token it is, how it is minted, and how long it lives, and it goes into the runbook
  before the sitting.
- **The stack (settled).** The runbook seeds the OTA stack's demo Nextcloud as the source (its *Before the
  sitting*: *"it plays the SOURCE, because we may seed only what we host"*), and step H arms the
  lane in that stack's `.env`. Under 0132 D7 both stay: 0132 T5 is parked for the OTA stack,
  which remains the demo, and the lane stays there (0132 T1g). So this sitting runs on the OTA
  stack, not on live, and its row in T1's table says so.
- **T9's event (a change).** Step B gains one event whose organiser is the Soverin account's own address, so
  the sitting also answers the canary on a target we do not run. Step B's event 1 has a third-party
  organiser (`owner@example-source.invalid`).

The sitting also arms the lane (T13). Record in 0105 and in the matrix's Live proofs.

No code, so there is no guard. The runbook edit is documentation.

### T8 — Nextcloud and JMAP targets beyond our own servers (after)

**(a) JMAP contacts and files in the nightly (proposed).**

- The appliance nightly (`e2e.yml`, Stalwart) gets a leg that maps contacts and files to `jmap`.
  Nothing in 0132 stops that nightly during the alpha.
- The coverage table's `jmap` verdict is split into one verdict per domain.
- **Guard:** a rule in `scripts/connector-coverage.unit.test.ts`. A target verdict names each domain
  it covers, and every domain it calls driven is mapped to that target in an e2e fixture. It fails
  today: the one `jmap` verdict covers the type, and the only e2e fixture that uses `jmap` maps
  mail.

Until this lands, a tester who wants JMAP for contacts or files is pointed at CardDAV or WebDAV
(`target-domains.ts`:47-51).

**(b) A Nextcloud we do not run (owner).** Either the first tester whose target is a hosted
Nextcloud, supervised, with counts only; or the live-target lane armed at a hosted Nextcloud.

**(c) Removal on targets we do not run** (DAV 412 on create, `If-Match` on delete) is W18, now
0149: its T1 to T3, in its alpha minimum.

### T9 — the organiser canary (owner, before the first invitation; the gate's fixture proposed)

**Why it matters.** A person moving their own domain keeps their address. On the target, the event's
organiser is then the target account's own address. RFC 6638's implicit scheduling acts for the
organiser, so a server that ignored `SCHEDULE-AGENT=CLIENT` would mail every attendee: the most
visible failure a tester could meet. What has been proven so far:

- the writer neutralises at write (0103 T1, ADR-0043);
- T2's gate proved silence for a third-party organiser;
- the update of 2026-09-22 was silent, but its organiser was not confirmed.

**(a) The sitting (owner).**

1. Set up a Nextcloud target the owner holds (open question 3). Where the owner runs it, point its
   SMTP at a catcher, as 0103 T2 arms the demo one; at a provider, the catch-all is the only ear.
2. Set the Nextcloud user's email to the source account's address.
3. In Google, create an event the owner organises, with one attendee at a tag address on the
   `ownpace.eu` catch-all. The address must be deliverable, as `soverin-supervised-run.md` step B
   says.
4. Migrate it. Then add a second attendee in Google. Then delete the event in Google and apply the
   deletion.

**Checks.** The copy carries `SCHEDULE-AGENT=CLIENT`, as T2's gate asserts. The catcher and the
catch-all stay silent after the create, the update and the delete. Record in 0103 T3. T7's sitting
repeats this for a target we do not run.

**(b) The gate re-proves it (proposed, after).** The managed smoke's fixture gains an event whose
organiser is the demo target user's own address, so the nightly proves it every night on the OTA
stack. The demo target user's Nextcloud email is set to that address, or the server has nothing to
match and the case proves nothing. The source's seeding account must not carry it, or the seed
itself would schedule (`seed-demo-dav-content.sh`:470-478). **Guard:** a rule in
`scripts/the-mail-nobody-should-get.unit.test.ts`: the smoke seeds an event whose `ORGANIZER` is the
target account's own address. It fails today, because T2's fixture has only a third-party
organiser (0103:20; `seed-demo-dav-content.sh`:483).

### T10 — shared mailboxes: Partial until one is copied

**(a) The move (proposed; before a tester on a Microsoft card).** "Shared mailboxes" moves from
`migrates` to `partial`. Its one line (`scope-manifest.ts`:81 asks for one) says: *"Needs your own
app registration with application permissions; not yet copied from a real shared mailbox."* The
folded text says that the *Microsoft 365 account* button reads the signed-in person's own mailbox
only.

**Guard.** `packages/shared/src/a-shared-mailbox-promise-with-its-proof.unit.test.ts`: "Shared
mailboxes" may sit under `migrates` only when T1's Live proofs table has a shared-mailbox row. It
fails today.

**(b) The consent run (owner, after).** 0027 T0's consent runbook and `check-access` on Tenant A,
then one Pattern S copy of a real shared mailbox through the `graph` card, recorded by T1's rule.
The row then moves back. This also gives 0028 T2/T3 and 0029 T1 their live reads.

Their acceptance needs a stack whose `OAUTH2_*` point at Tenant A. On the managed edition that is
T11's open question, so the appliance, whose single-tenant `OAUTH2_*` model fits, is the natural
place for the run. `ownpace-live` keeps `OAUTH2_*` empty (T11).

### T11 — the detectors and the permission report tell a Connect-with-Microsoft tester the truth

**Why not just switch them off.** Switching off is not the smaller change:

- both jobs are scheduled in code (`cron: '0 7 * * *'` in `managed-drift-detect.ts`:71,
  `'30 6 * * *'` in `managed-group-discovery.ts`:66), and no setting stops them;
- the report is part of the Finish step.

**The minimum (proposed; before the first Microsoft 365 tester).**

- `directoryAvailability` takes the source's kind. For `microsoft` it has a reason of its own. The
  account's grant is delegated and reads the signed-in person's own data. The directory, other
  people's mailboxes and calendar sharing need an administrator's registration with application
  permissions. Note them by hand before cutover.
- Drift detection and the report find the Microsoft source by every Microsoft kind, not by
  `kind = 'o365'` alone: `o365`, plus what `connectionKindsWithFace('email', 'graph-mail')`
  returns, the way `permissions.ts` already asks for Drive (:286-294, after the defect its comment
  describes). The helper alone is not enough: `o365` is in neither of the tables it reads, so
  today it answers `microsoft` only (`source-face-builders.ts`:239-245).
- Group discovery's branch (`managed-group-discovery.ts`:104) gives a `microsoft` source that
  reason, not IMAP's.
- On `ownpace-live`, `OAUTH2_*` stays empty. That check belongs with 0132 T0's step 5. For an `o365`
  source, the report's sentence (*"… is not set, so no application …"*) is written for an operator.
  The tester's version says that this deployment does not yet read the directory with the
  customer's own registration.

**Guards.** Each fails today:

- `apps/api/src/routes/a-report-that-knows-the-microsoft-account.unit.test.ts`: a tenant whose only
  source is `microsoft` gets a calendar section that does not say *"has no Microsoft 365 source
  connection"*, and that names the delegated grant.
- `apps/worker/src/jobs/a-detector-that-knows-the-microsoft-account.unit.test.ts`: drift detection
  and group discovery give a `microsoft` source the delegated reason, and neither IMAP's nor "no
  Microsoft 365 source".
- `scripts/a-microsoft-source-found-by-its-faces.unit.test.ts`: no SQL in `apps/` finds a tenant's
  Microsoft source by `kind = 'o365'` alone, and no job branches on `kind !== 'o365'` alone. It
  fails today on three files: two queries (`managed-drift-detect.ts`:106, `permissions.ts`:261) and
  one branch (`managed-group-discovery.ts`:104).

**After (proposed; a decision first).** Per-tenant credentials, with two possible models:

- an `o365` connection that holds a client secret and no refresh token is read with that
  connection's stored credential, decrypted as the migration decrypts it, and not with the stack's;
- or the deployment's multi-tenant app, with an administrator's consent in each tenant. That is
  0140 T4's ADR.

Open question 7 asks which. Either way it needs an ADR, because 0026 row 14's sentence has to
become true.

### T12 — the managed journey in a browser

**(a) The walk with two strangers (owner; before the first invitation).** A new stage in
`docs/owner-test-runbook.md`, *"Stage 8 — two strangers"*, with an expected outcome for each step.
It is walked on `ownpace-live` after 0133 T4 (the mail half, walked there too) and with 0131 T1
and T2 in place. The two accounts are fresh, and neither is on the owner's domains. A uses a Dutch
browser and B an English one. It follows on from 0133 T4's step 4 (joined as owner):

1. The dashboard is in the browser's language, and the page's `lang` follows the switch (fixed in
   #1137, merged 2026-09-24). The alpha note shows (0131 T1).
2. **A** adds a Google account. It is a test user first (0140 T0). **B** adds a personal Microsoft
   account. That is also 0140 T6's personal-account consent, and 0140 T6 records what happens.
3. The wizard reaches its confirm step. Experimental cards and faces carry the tag (0131 T2). The
   scope manifest shows what applies to that source, and nothing about shared mailboxes under
   Migrates (T10).
4. Start. The progress strip moves, and the first pass completes into a target account the owner
   provides for the walk.
5. Issue a view link, and open it signed out in a private window. It shows progress and nothing
   else.
6. On A's migration page, a grant link is issued for a Google source that names A's Google
   account (`docs/grant-links.md`, *Issuing one*).
   - Opened while signed in to Google with any other account, it is refused, and nothing is
     stored (`grant.ts`:29-34).
   - Opened as A, it is accepted.
   - Opened again, it cannot be used a second time.
7. *Report a problem* reaches the owner (0130), if the stack has a Zammad; otherwise the address
   in the alpha conditions (0131 T5).
8. The Finish step's permission handover says only true things (T11).

For each step, record pass or fail, the date, live's tag and the language seen. Never an
address. The phone half of this walk is 0145's.

**(b) Fixture-backed browser cases (proposed).** Three cases in `test/ui/managed-ui.ui.test.ts`:
the wizard to its confirm step, a grant link's page, and a view link's page. They run on every pull
request (`ci.yml` `ui-tests`, :550-605). They catch a screen that does not render, and they prove
nothing about the API. Each is proved by breaking: remove the route or the component, and watch the
case fail.

**(c) The real-API journey (proposed, after).** The managed counterpart of
`selfhost-ui.e2e.test.ts` in the gate. It uses the smoke's real sign-in and runs request → grant →
wizard → first pass → view link. It needs a gate stack that is not the alpha's. It was parked on
0132 T8, a stack of the gate's own; 0132 D7 superseded T8 by giving testers `ownpace-live`
instead, so the OTA stack the gate rebuilds every night now holds no tester's data, and the journey
can run there.

**(d) Stage 7 on the owner's own real mapping (owner; before a tester prepares a cutover).** The
§20 gate over real volumes. It touches no DNS and stops nothing (`owner-test-runbook.md`:335-338).

### T13 — the O365 lane and the live-target lane (after)

**(a) The runner and the secrets (owner).** Either add the `spark` label to the runner, or drop it
from `runs-on` (`e2e-o365.yml`:85). #1137 left this choice to the owner. Also check in the
repository settings that the `O365_*` secrets exist for the flow the owner wants.

**(b) The scenario drives the product (proposed).**

- `test/e2e/o365-scenario.ts` is rewritten to build the product's `graph-*` sources through
  `source-face-builders.ts`, against Tenant A with application permissions (the `/users/{id}`
  scope). It discovers and fetches, including a handful of event bodies through `$value`, and
  writes nothing. The existing check on the token's claims keeps it read-only.
- Only then does a green run move `graph-*` from `owed` to `driven`. It also settles 0059 T5(a) for
  the application scope.
- The `microsoft` card stays `uncoverable`, because its delegated consent is a person's press, so T2
  remains its proof.
- 0008 T7 is marked ✅ Done with no run linked (0008:13, :114). Correcting it to 🟡 is 0147 T3
  (a)'s note, not this plan's. A green run of this lane is what then gets linked there.
- **Guard:** `scripts/an-o365-harness-that-runs-the-product.unit.test.ts`. The scenario imports the
  product's Graph source builders and defines no Graph client of its own, and `connector-coverage`
  refuses a `driven` verdict whose harness imports none of that connector. It fails today
  (`o365-scenario.ts`:385).

**(c) The live-target lane says when it stood down (proposed).**

- A first job decides whether the lane is armed. The lane job runs only when it is, so an unarmed
  night shows the lane job as *skipped*.
- GitHub has no neutral conclusion for a job, and a run whose only remaining job was skipped still
  shows green. T1's rule is therefore what makes the lane evidence: a proof may cite a run only when
  its lane job ran.
- Arming is T7's step H, with an API token.
- **Guard:** `scripts/a-lane-that-stood-down-is-not-green.unit.test.ts`. `e2e-live-target.yml`
  runs the lane job only on the deciding job's `armed` output, and the driver writes that output. It
  fails today: there is one job, and a stand-down exits 0.

When either lane goes red, someone has to be told. That is 0142.

### T14 — the nightly managed gate's readiness rule (owner names N; before the first invitation)

**The rule (proposed).** Live's first deploy is from a tag whose commit C (0132 T6 step 1) meets
both of these:

- **The managed gate.** The last N *scheduled* runs of `e2e-managed.yml` on `main` are green, and
  the newest of them ran C.
  - Dispatched runs do not count, because somebody chose their moment.
  - A failed or cancelled scheduled run resets the count.
- **The appliance nightly.** At the same time, the last N scheduled runs of `e2e.yml` are green.
  Each of its two nightly schedules counts as a run.

The live-target lane is not part of the rule until it is armed (T13).

**Today the count is 0.** See §1's table: the last scheduled green is #191, and #196 was
dispatched.

**The order, with 0132.** Under 0132 D7 the gate is not switched off: it keeps running on the OTA
stack every night, before and during the alpha (0132 T0, T1g). So the count builds on its own. The
owner reads it before live's first bring-up from a tag (0132 T0 step 3), or accepts fewer in
writing (0131 T5's rule). With N = 5 and one scheduled run a night, that takes at least five
nights from the first green scheduled run. #1137, merged 2026-09-24, asks for one dispatched run
of the gate first, for Node 24. That run is a precondition, not part of the count.

**During the alpha,** each later deploy to live meets the same rule for its tag, or the owner
accepts fewer in writing. Either way it is written in 0132's deploy log (0132 T6 step 9).

**Reading it:**

```bash
gh run list --workflow e2e-managed.yml --event schedule --branch main --limit 5 \
  --json number,conclusion,headSha,createdAt
gh run list --workflow e2e.yml --event schedule --branch main --limit 5 \
  --json number,conclusion,headSha,createdAt
```

The numbers and C are written in this block. No code, so there is no guard.

## 4. Order

1. **Code, as pull requests:** T1 (the record, with 0131 T2's table), T11's minimum and T10's move.
   T13 and T12(b) can follow at any time.
2. **Counting (T14)** starts once #1137's dispatched run of the gate is green (#1137 merged on
   2026-09-24). It runs in parallel with everything else.
3. **T14 is read, and live is brought up from that tag** (0132 T0 step 3, T6 step 1).
4. **The owner's sittings, cheapest first:** T9, T5, T4, T2 and T3's Dropbox half, on live once it
   stands, into the targets open question 3 settles. T7 runs on the OTA stack, whose demo
   Nextcloud is its source; it does not wait for live.
5. **T12's walk,** on live, after 0133 T4.
6. **The first invitation.** Each later tester is granted once the sources they named have their
   proof, or have the label and nothing more, as open question 1 settles.

## Not in this plan

- The label itself, and the table behind it: 0131 T2.
- Consent screens, test users and the Microsoft registration: 0140.
- The mail half of the walk: 0133 T4.
- Phones, screen readers and in-app browsers: 0145.
- Being told when a lane or the gate goes red: 0142.
- Capacity, including Google's project quota shared by every tenant with no 429 backoff outside
  Tasks (0126 T5): 0143.
- A known-limitations page that lists what T1's record says is unproven: 0144.
- A release name testers can quote, and which commit C was: 0146.
- In-app guides a tester can use: W15, now 0148.
- Removal that fails closed on targets: W18, now 0149.

## Open questions

1. **Does a tester who names a source wait for that source's proof?** This plan proposes waiting
   for the cheap proofs on the owner's own accounts (T2, T3's Dropbox half, T4, T5 and T7), and
   letting the label alone carry Box, a second Google account and whole-domain delegation. The
   alternative is 0131 open question 3 (a), which 0131 recommends: the label is enough for every
   source. Recommended here: wait, because each of those proofs is one sitting, and the Microsoft
   calendar may need a rebuild rather than a fix.
2. **Box.** Does the owner have a Box account in which a Platform app can be approved? If not, the
   first Box tester's supervised run is the proof (T3).
3. **Where proofs on live write to.** Live has no demo Nextcloud or Stalwart (0132 T1b, T5), and
   once 0136 T1 lands, live refuses a target inside the OTA stack, as it refuses every private
   address and the other stack's ports. So a sitting on live needs a target a tester could also
   reach: a Nextcloud and a mailbox the owner holds at a provider, or ones the owner runs outside
   both stacks under a public name. Which does the owner use for T2 to T5 and T9? T7 is not
   affected: it runs on the OTA stack, whose demo Nextcloud stays (0132 T5 is parked there).
4. **Shared mailboxes.** Partial for the alpha (T10 (a), recommended), or the consent run first
   (T10 (b))?
5. **The O365 runner.** Add the `spark` label to the runner, or drop it from the workflow? Are the
   `O365_*` secrets set?
6. **N, and dispatched runs.** Recommended: N = 5, the review's number, and scheduled runs only.
   0132 T6 step 1 reads the same N.
7. **The credential model for directory reads on managed** (T11, after). Each tenant's stored
   registration, or the deployment's app with an administrator's consent in each tenant (0140 T4)?
   0026 row 14 records the owner's decision of 2026-08-09 that *"per-customer app registration is
   the model"*, which points at the first. Recommended: the first, for the `oauth2` and `graph`
   cards, while the `microsoft` card keeps the delegated reason from T11's minimum.
8. **A tester's pass as a proof.** With the tester's agreement, counts only, recorded as "a
   tester's, supervised"? Recommended: yes. It is the only route for Box, and the natural one for a
   second Google account.
