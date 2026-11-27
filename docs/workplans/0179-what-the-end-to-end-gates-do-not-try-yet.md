# Workplan 0179 — What the end-to-end gates do not try yet

> **In one line:** A read of the three E2E workflows and the managed UI smoke as they stand on `main` at `4283d37`: what a person does with Ownpace that no gate tries end to end, in what order to add it, and what each costs on the one self-hosted runner.

## Status — 2026-11-27 (update this block at the end of every session)

**2026-11-27, T2 to T4 merged, and T5 built.** #2217 merged as `dc1ac95a`, after its second
managed E2E, run 45987424991 on `79ddb717`, passed: `SMOKE PASS`, T2's spent-gift check read
`1/1/1`, and the section's take-back at its start removed the gift run 45976766670 had left. T3 and
T4 passed as before. **T5, the upgrade gate (D2 (a)), is built on
`claude/ownpace-public-readiness-y7orc6-a22-e2e-upgrade-gate` and waits for its first self-hosted
Postgres E2E.** A last step group of `e2e.yml`, on the Postgres night and a Postgres dispatch only:
`scripts/previous-release.mjs` names the release (the newest `CHANGELOG.md` release whose tag is
published and is not this commit; today `0.2.0-alpha.21`), the step reads its index digest and
verifies it with both `cosign verify` calls `release-verify.mjs` makes, and
`test/e2e/selfhost-upgrade.e2e.test.ts` starts that appliance by digest in a project of its own,
lets it copy the seeded sources, starts this build on the same volumes, and checks the migrations,
the ledger's counts before and after, and a pass after the upgrade. Proved off the stack: 9 cases
for the release's resolution, 10 for the gate's arithmetic. Not yet measured: its run time, which
the step prints. **A correction to §2 and Table B (G5):** they said only the schema upgrade was
tested. There is also `scripts/upgrade-drill.sh` (workplan 0025 T5), run by hand before a release
(`docs/release.md`, its checklist): the released image on PGlite, swapped in place to the
checkout's build, healthy after a restart. It copies no data and runs no pass, so G5 stood, but the
plan should have named it.

**2026-11-27, the first managed E2E of T2 to T4, and its fix.** E2E (managed) 45976766670 ran
the branch at `5a3bf08a`. On the real stack T3 and T4 passed whole: Start on the waiting migration
answered `awaiting_grant` with `startsWhenGranted`, the grant started it and its pass completed
(it met `adopted=3`), the page spoke *je*, the stop held the migration, the second stop was
refused in *je*, and the take-back ran. In T2 the check, the 410 for a code nobody made, the 201
and the spent code's two refusals passed; one check failed, `organisation/owner-invitation/
spent-gift = 1/1/0`. The cause: on the real stack the owner is signed in through the identity
provider, a fresh subject each run, so the gift's giver is `APPLY_SUBJECT`, and the section asked
by `APPLY_SUB`, the seed's subject. So its take-back deleted no gift either, and one spent gift of
that run stayed in demo organisation B. Fixed: the section asks by `APPLY_SUBJECT`, and its
take-back removes a gift of demo organisation B that points at a request this gate made, or whose
giver is this run's subject, or that points at no request and whose giver is a member of no
organisation, which is that run's leftover. The harness now signs the owner in as a subject that
is not the seed's: on the section as it ran, three cases fail; on the fix, all 22 pass. Waiting
for the managed E2E again.

**2026-11-27, later: T2 to T4 built, waiting for their managed E2E.** Two new sections of
`deploy/compose/smoke-managed.sh`, as D1 (a) says, on
`claude/ownpace-public-readiness-y7orc6-a22-e2e-managed-flows`: *a recommendation's code, at its
own door* (T2) and *a person's grant that starts their migration, and their stop* (T3, and T4's
voice). Proved here: `scripts/a-door-and-a-grant-the-gate-walks.unit.test.ts` runs both sections
as the script has them against a fake API, database and DAV server, 20 cases; three mutations of
the sections (the `startsWhenGranted` check, the *je* check, the removal of a copy) each turn it
red. **Not proved yet:** that the sections pass against the real acceptance stack; that is the
managed E2E, which the maintainer dispatches. Not covered: the first sign-in of the person a
code let in (G1's last step); the sections stop at their invitation in the database.

**2026-11-27, the maintainer's answers, and T1 done.** The maintainer answered on 2026-11-27:
*"D1: a / D2: a / D3: a / D4: b / E2E: as advised"*. So the advice stands for all four
decisions (§3.2) and for the order in §3.1. T1 is done in this plan's pull request, docs only:
§2.3's finding is in `docs/testing.md` (the `e2e-managed.yml` entry), in
`docs/managed-bring-up.md` (beside *Nextcloud's pin moves one way*), and a line in
`.github/pull_request_template.md`. Every claim about the code cites a file and a line as read on
`main` at `4283d37`; after `main` was merged in at `e083778` (#2212, #2214), the archive gates'
lines and §4.2 were read again there.

| Task | Owner | State | Note |
|---|---|---|---|
| T0 The read and this plan | builder | ✅ Written | This file. |
| T1 §2.3 written down | builder | ✅ Done | In this plan's pull request: `docs/testing.md`, `docs/managed-bring-up.md`, the pull request template. |
| T2 The recommendation door, on the managed smoke | builder | ✅ Merged, #2217 (`dc1ac95a`) | Run 45987424991 passed, after 45976766670's one failure was fixed. |
| T3 A grant that copies, and *Stop copying*, on the managed smoke | builder | ✅ Merged, #2217 (`dc1ac95a`) | Runs 45976766670 and 45987424991 passed. |
| T4 The voice chosen for a person, on the managed smoke | builder | ✅ Merged, #2217 (`dc1ac95a`) | Inside T3's section; both runs passed. |
| T5 The appliance upgraded from the previous release | builder | 🔧 Built, self-hosted Postgres E2E to run | D2 (a): the last steps of `e2e.yml`, Postgres only; `selfhost-upgrade.e2e.test.ts`. |
| T6 The owner's appliance flows | — | 🕓 After alpha.22 | |
| T7 A real browser against the real managed API | — | 🕓 After alpha.22 | D4 (b). |
| T8 Soverin | — | 🕓 Later | D3 (a): stand-ins first, a real account later. |

## 1. In short

- **The self-hosted gates** (`e2e.yml`) try a migration's machinery well: five data types
  copied, a restart with no duplicates, verification, deleting by hand on three data types,
  finish, backup and restore, and three archive routes, on Postgres and on PGlite. They do not
  try **an upgrade from the previous release**, or what an owner does on the appliance's screens
  beyond five checks: **adding people and migrations, the sharing queue, ending a data type,
  stopping and resuming one, retrying a failure, applying a move**.
- **The managed gate** (`e2e-managed.yml`, `smoke-managed.sh`) is broad: sign-in, invitations,
  access requests, verify and apply, sharing, the cutover door, closing an organisation, the
  books, a person's progress link, and the passwords a person types on a grant link. It does not
  try **alpha.21's recommendation door** (`/code`), **a person's grant that then copies**, **a
  person's *Stop copying***, or **the *je* or *u* chosen for a person**. And no gate drives **a
  real browser against the real managed API**: the managed UI smoke answers from fixtures.
- **One process lesson, not written down for migrations:** a branch's managed E2E applies its
  migrations to the long-lived acceptance stack, and every other branch then refuses to start
  until that migration is on `main` (§2.3). The docs say this for Nextcloud's pin, not for
  migrations.
- **Advice:** first write the migration lesson down (S, docs only); then the recommendation door
  and a grant that copies on the managed smoke (M each); then the appliance upgrade from the
  previous release (M); then the appliance's owner flows (M). A real browser against the real
  managed API is worth it but large (L); real providers need real accounts (§4.3).

## 2. What the gates try today, and how they are run

### 2.1 Four gates

- **E2E (self-hosted)**, `.github/workflows/e2e.yml`: nightly, Postgres at 23:30 UTC and PGlite
  at 01:30 UTC (`:89-91`), and on dispatch; a fresh stack every run (`:268-271`, `down -v`).
  Table A (§6) lists its gates.
- **E2E (managed)**, `.github/workflows/e2e-managed.yml`: nightly at 03:30 UTC (`:91`) and on
  dispatch, against **a long-lived stack** it does not tear down; it says itself that it
  "does not prove bring-up from scratch" (`:52-54`). It runs `deploy/compose/smoke-managed.sh`
  (`:760-788`), whose sections are listed in Table A.
- **E2E (live target)**, `.github/workflows/e2e-live-target.yml`: nightly at 04:30 UTC (`:55`),
  a soft lane against a target nobody here hosts; unarmed it stands down green (`:12-15`).
  Red means investigate and it blocks nothing (`:10-11`).
- **The managed UI smoke**, `test/ui/managed-ui.ui.test.ts`, run by `ci.yml`'s `ui-tests` job on
  every pull request (`ci.yml:1017-1029`): a real Chromium over the built bundle, but the API is
  **an in-process server answering from fixtures** (`ci.yml:1026-1028`). It checks that the
  bundle asks only for endpoints the API serves (`managed-ui.ui.test.ts:952`), not that those
  endpoints answer what the fixtures say.

The real Microsoft 365 source is read by hand only, never in CI (`docs/testing.md:42-43`;
`test/e2e/o365-scenario.e2e.test.ts:49` and on are `skipIf`).

### 2.2 What a release needs from them

A tag needs the newest two scheduled managed runs on `main` and the four self-hosted runs of
those nights green on the tagged commit (`docs/testing.md:468-474`). So every gate added to
these workflows becomes part of what a release waits for, and a flaky one delays a release by a
night each time it fails.

### 2.3 Finding: a branch's managed migration locks the acceptance stack until it merges

The managed gate brings the **branch's** stack up on the long-lived acceptance stack
(`e2e-managed.yml:525-550`, `bootstrap-managed.sh --from data --with-demo`). The API applies both
migration chains at start (`apps/api/src/index.ts:418-423`), and the runner refuses to start on a
database whose highest applied migration is newer than the build's highest
(`packages/ledger/src/migrate.ts:190-212`, the downgrade guard). So once a branch carrying
managed migration `0069` has run its managed E2E, `main`'s nightly and every other branch's
managed E2E carry `0068` as their highest and their API refuses to start, until `0069` is on
`main` and they take it in. The same holds for the shared chain (`packages/ledger/migrations`),
which the API applies too. Seen on 2026-11-26: run 580 of E2E (managed) merged `main` in first
"so that this branch's managed build carries its migration 0066".

**What the docs say:** `docs/managed-bring-up.md:4556-4568` says exactly this for **Nextcloud's
pin** (dispatch such a branch's E2E when it is ready to merge, and merge before the next 03:30
nightly). Nothing in `docs/testing.md`, `docs/managed-bring-up.md` or `e2e-managed.yml` says it
for a **migration** (searched for *branch* and *migration* together; the only hits are the
Nextcloud paragraphs). So a pull request with a migration of either chain should run its managed
E2E last, and merge soon after it; T1 writes that down.

## 3. Order and decisions

### 3.1 The order, with advice

Sizes: S is under a day, M one to three days, L more. Run time is per run, on the one runner.

| # | What | Size | Adds to a run | Why here |
|---|---|---|---|---|
| T1 | Write §2.3 down: `docs/testing.md`'s `e2e-managed.yml` entry and the Nextcloud paragraph of `docs/managed-bring-up.md` say it for both migration chains; a line in the pull request checklist | S | nothing | It already cost runs, and it costs nothing to say. |
| T2 | Managed: the recommendation door, end to end (G1 in Table B) | M | about 30 s | alpha.21's newest door has no HTTP-level test at all, and it creates an organisation. |
| T3 | Managed: a person's grant that then copies, and their *Stop copying* (G2, G3) | M | 1 to 2 min | The smoke proves a password is stored, not that a migration then runs, nor that a stop holds it. |
| T4 | Managed: the *je* or *u* chosen for a person, on the server's own pages (G4) | S | seconds | One field on the link the smoke already makes. |
| T5 | Self-hosted: the appliance upgraded from the previous release with its data (G5) | M | 3 to 5 min | Every self-hoster does it; CI tests only the schema upgrade (`ci.yml:938-941`), and `scripts/upgrade-drill.sh` runs by hand, with no data. |
| T6 | Self-hosted: the owner's appliance flows (G6 to G9) | M | 1 to 3 min | Real routes with no E2E caller. |
| T7 | A real browser against the real managed API, on a person's link (G10) | L | 2 to 4 min | Where the fixtures and the API can drift apart. |
| T8 | Soverin, personal and Suite (0175, alpha.22) (G11) | M, or L with an account | — | Only with a decision on D3. |

**Advice: T1 now; T2 and T3 together in alpha.22 (one pull request touching only the smoke);
T4 with them if cheap; T5 next; T6 and T7 after alpha.22.** T2 and T3 come first because they
are alpha.21's own promises to a person who has no account and no one to ask, and a regression
there reaches them before the owner notices. T5 comes before T6 because an upgrade that breaks
breaks every appliance at once, while each T6 flow breaks for one owner who can see it.

### 3.2 Decisions for the maintainer

**Answered by the maintainer on 2026-11-27:** *"D1: a / D2: a / D3: a / D4: b / E2E: as
advised"*. Each answer is the advice below.

- **D1. Where the managed additions go.** (a) New sections of `smoke-managed.sh`, as every
  managed check so far; (b) a separate script the workflow runs after it. **Advice: (a)**, as
  the smoke already holds the demo organisations, the token minting and the balance step that
  takes back what a run added (`smoke-managed.sh:6572`); (b) only if the smoke's 7,700 lines
  become the problem, which is a decision of its own.
- **D2. The upgrade gate's shape (T5).** (a) A step in `e2e.yml` that starts the previous
  release's appliance image, runs one pass, then this build's on the same volume; (b) a
  workflow of its own, on dispatch and before a tag. **Advice: (a)** on the Postgres night only,
  so it costs one night of two; PGlite next once it holds.
- **D3. Soverin (T8).** (a) Prove only what a stand-in can (a Stalwart answering as personal, a
  Stalwart with a Nextcloud as Suite) in the self-hosted stack; (b) add a real Soverin account to
  the live-target lane; (c) leave it to by-hand testing. **Advice: (a) now, (b) when an account
  exists for it.** No account is named here.
- **D4. The real browser against the real API (T7).** (a) Playwright from the managed gate's
  host against the acceptance stack, one walk of a person's link; (b) wait. **Advice: (b) for
  alpha.22**, as T2 and T3 cover the server side of the same flows at a fraction of the run time.

## 4. Costs and limits

### 4.1 Run time on the one runner

Measured from the runs on 2026-11-26 and 2026-11-27: E2E (self-hosted) takes about five minutes
(run 539, 05:14 to 05:19 UTC), E2E (managed) about six (run 587, 03:17 to 03:23 UTC). The
schedule spaces them two hours apart (`e2e-managed.yml:75-79`) and the concurrency groups queue
rather than cancel (`e2e.yml:109-111`, `e2e-managed.yml:93-99`). Everything in §3.1 together
adds under ten minutes to a night, well inside the spacing. The cost that matters is **daytime
dispatches**: a branch's E2E set is one self-hosted run per backend plus one managed run, about
sixteen minutes, and on 2026-11-26 there were eight managed dispatches in one evening. Each
minute added to a gate is a minute on every one of them.

### 4.2 Flakiness risks

- **A status read across the schedule's minute (found and fixed 2026-11-27).** The fixtures
  schedule a pass every minute, so a gate that asks for one pass and reads the status once can
  read `in_progress` from a scheduled pass that started in between. Fixed on `main` by #2212
  (`f284fd80`): `statusAfterAPass` (`test/e2e/apply-deletion-lib.ts:313`) asks again while a pass
  runs, and the three archive gates read through it (`selfhost-archive-zip-import.e2e.test.ts:191`,
  `selfhost-archive-in-target-import.e2e.test.ts:247`, `selfhost-archive-import.e2e.test.ts:163`).
  **Every new appliance gate in T5 and T6 reads status through it**, or it brings the race back.
- **The voice check of the same day was a unit test, not an E2E gate**
  (`apps/api/src/routes/a-page-in-the-voice-chosen-for-them.unit.test.ts`: a random link token
  holding `-Uw` read as a word), fixed on `main` by #2191 (`11e1df10`). It is no risk to the
  gates, and T4 need not wait on it.
- **The long-lived stack.** A managed check that leaves rows or files behind changes the next
  run's starting point. Each managed addition takes back what it added, as the balance section
  does, and is written to pass on a stack where a previous run of it failed halfway.
- **Shared state across organisations.** The smoke has twice been taught to wait only for its own
  organisations' jobs (#2181, #2201). A new section that counts jobs or rows counts its own.

### 4.3 What needs a real provider account

Said without naming one: a real **Google** account (the consent screen and the warning a
person's link tells before it comes; `docs/workplans/0176-a-persons-own-pages-in-steps-on-one-link.md:1501`), a real **Microsoft 365**
tenant (only by hand, read-only, `docs/testing.md:42-43`), a real **Dropbox**, **Apple**
(app-specific password), **Cirrux**, **Infomaniak** and **Soverin** login (0174's own list of
what nothing proves, `CHANGELOG.md` alpha.21, *Grant links for every account*: "Not proven
against a real Apple, Cirrux, Infomaniak or Soverin login"). A stand-in can prove the protocol
and our side of the door; only a real account proves the provider's screens and limits. The
live-target lane is where such an account would go (D3 (b)), with its credentials in the
machine's persisted file, never in GitHub (`e2e-live-target.yml:33-37`).

## 5. Done means

For each of T2 to T8 the maintainer chooses: a test that fails on the code before the flow
works (or on a mutation of it), green on both backends where it is the appliance's, its run
time stated in the pull request, and a line in `docs/testing.md`.

## 6. The long tables

### Table A — what the gates try today

| Flow | Gate | Edition | Backend | Asserted at |
|---|---|---|---|---|
| The operating UI boots; queue screens in the reader's words; deep links; Verify does not start a run; no managed navigation | UI smoke (appliance) | self-hosted | Postgres, PGlite | `test/e2e/selfhost-ui.e2e.test.ts:172`, `:186`, `:234`, `:246`, `:280` |
| First pass copies mail, calendar, tasks, contacts, files | restart-resume | self-hosted | both | `test/e2e/selfhost-restart-resume.e2e.test.ts:363` |
| Items made on the source after the first copy are picked up | restart-resume | self-hosted | both | `selfhost-restart-resume.e2e.test.ts:527` |
| A restart resumes with no duplicates | restart-resume | self-hosted | both | `selfhost-restart-resume.e2e.test.ts:622` |
| One item that cannot migrate is isolated, and accepted | restart-resume | self-hosted | both | `selfhost-restart-resume.e2e.test.ts:714` |
| An event moved on the source is reported and kept | restart-resume | self-hosted | both | `selfhost-restart-resume.e2e.test.ts:806` |
| Verification against the real targets; byte-identical files; reminders | verification | self-hosted | both | `test/e2e/selfhost-verification.e2e.test.ts:178`, `:318`, `:396` |
| A new address through the file, on card, event and mail | address changes | self-hosted | both | `test/e2e/selfhost-address-changes.e2e.test.ts:156`, `:171`, `:185` |
| Deleting by hand, checked on the real target; a second press refused | apply-deletion | self-hosted | both | `test/e2e/selfhost-apply-deletion-mail.e2e.test.ts:85`, `-file…:78`, `-calendar…:78` |
| Backup and restore of the appliance | drill | self-hosted | both | `test/e2e/selfhost-backup-restore.e2e.test.ts:258`, `:373` |
| Finish refused over an open decision, then accepted, idempotent | finish | self-hosted | both | `test/e2e/selfhost-finish.e2e.test.ts:94`, `:112`, `:158` |
| A Takeout imported (folder, zip, in the target) and a second import writes nothing | archive | self-hosted | both | `test/e2e/selfhost-archive-import.e2e.test.ts:114`, `-zip-import…:135`, `-in-target-import…:176` |
| Stack healthy; app through the pooler, migrations direct | managed workflow | managed | Postgres | `.github/workflows/e2e-managed.yml:645-730` |
| Identity provider's database dumped and restored | managed workflow | managed | Postgres | `e2e-managed.yml:744-747` |
| Signing in; an invitation answered three ways; an access request and its mail | smoke | managed | Postgres | `deploy/compose/smoke-managed.sh:1293`, `:3747`, `:3891` |
| Verify to a terminal state; apply (delete by hand) applied or refused | smoke | managed | Postgres | `smoke-managed.sh:2614`, `:3093`, `:3212` |
| Closing an organisation and reopening it | smoke | managed | Postgres | `smoke-managed.sh:3821` |
| Readiness, shared addresses, permissions, billing reports | smoke | managed | Postgres | `smoke-managed.sh:4083` |
| The export archive; the Nextcloud door; the sharing queue | smoke | managed | Postgres | `smoke-managed.sh:4443`, `:5956`, `:6425-6531` |
| A person's progress link: issued, opened, refused as a grant, revoked | smoke | managed | Postgres | `smoke-managed.sh:6738-6890` |
| A person's own passwords on their grant link: five wrong, locked, right, never logged | smoke | managed | Postgres | `smoke-managed.sh:6949`, `:7153` |
| The status page; the cutover door; jobs across organisations; one sandbox invoice | smoke | managed | Postgres | `smoke-managed.sh:7364`, `:7456`, `:7636`, `:7682` |
| Every job on pg-boss completed; no runner started | smoke | managed | Postgres | `smoke-managed.sh:7700` |
| The managed screens, a person's link walked, the door of a code, the card printed | UI smoke (fixtures) | managed UI | none (fixtures) | `test/ui/managed-ui.ui.test.ts:2228`, `:2592`, `:2695`; fixtures `ci.yml:1026` |
| A mail through a real provider arrives; a canary never does | live target | managed | — (unarmed: stands down) | `.github/workflows/e2e-live-target.yml:19-31` |

### Table B — what no gate tries

| # | The flow a person does | What breaks for whom if it regresses | Evidence no gate covers it | Size |
|---|---|---|---|---|
| G1 | Someone given a recommendation types its code at `/code`, answers, and is let in: request granted, organisation, invitation, code spent; then signs in | The person holding the card cannot get in, or is let in twice; the giver's place is lost | `smoke-managed.sh` has no `gift`, `redeem` or `/code` (searched); `POST /redeem` (`apps/api/src/routes/gifts.ts:322`) is held by unit tests on PGlite (`packages/managed/src/gift-under-rls.unit.test.ts:317`) and the fixture UI smoke (`managed-ui.ui.test.ts:2592`), never over HTTP on a real stack | M |
| G2 | A person grants on their link, and their migration then copies | A family member grants and nothing ever moves; nobody is told | The smoke's 0174 section keeps both migrations drafts: "a grant starts nothing … and no pass writes into a demo account" (`smoke-managed.sh:6937-6939`) | M |
| G3 | A person presses *Stop copying* on their progress page, or removes a destination's password | The copy goes on after the person said stop | No call to `/api/view/:link/withdraw` (`apps/api/src/routes/view.ts:254-255`) in the smoke (searched `withdraw`) | S |
| G4 | A member chooses *je*, *u* or English for a person; the person's pages and the server's own pages speak that way | A person is spoken to in the wrong register or language | The smoke makes links with `purpose` and `expiryDays` only (`smoke-managed.sh:6787-6788`, `:7096`); no `voice` anywhere in it | S |
| G5 | A self-hoster upgrades the appliance from the previous release, keeping their data | Every appliance stops, or loses its ledger, at the upgrade | `e2e.yml` starts from fresh volumes (`:268-271`); only the schema upgrade is tested in CI (`ci.yml:938-941`); `scripts/upgrade-drill.sh` runs by hand before a release, on PGlite, with no data and no pass (correction of 2026-11-27) | M |
| G6 | An owner adds a person and a migration on the appliance's screens | A new self-hoster cannot start | `/people` and `/people/:id/migrations` (`apps/selfhost/src/index.ts:1923-1935`) have no caller in `test/e2e/` (searched) | M |
| G7 | An owner ends or keeps one data type, or stops and resumes it | A data type keeps copying after its cutover, or will not stop | `/mappings/:id/domains/:d/(end\|keep)` and `(stop\|resume)` (`index.ts:3755`, `:3668`) have no E2E caller | M |
| G8 | An owner answers the sharing queue on the appliance | Shares are not recreated, or recreated twice | `/mappings/:id/sharing/…` (`index.ts:2591-2815`) has no E2E caller on the appliance; the managed smoke tries the managed one (`smoke-managed.sh:6425-6531`) | M |
| G9 | An owner retries a failed item, or applies a move | A fixed item stays failed; a moved file stays in two places | `/failures/:h/retry` and `/moves/:h/apply` (`index.ts:3583`, `:3398`) have no E2E caller; the gates press `accept` and `keep` only | S |
| G10 | A person opens their link in a browser and grants, against the real API | A screen that the fixtures pass breaks against a real answer | The managed UI smoke has no services (`ci.yml:1026-1028`); the managed gate has no browser | L |
| G11 | An owner tests a Soverin account; personal or Suite is found, files only with Suite (0175, alpha.22) | The wrong data types are offered or copied | Not built yet; no gate names Soverin (searched) | M (stand-in), L (real) |
| G12 | The managed stack brought up from nothing | A new deployment fails on a step only a first bring-up runs | `e2e-managed.yml:52-54` says so itself | L |
