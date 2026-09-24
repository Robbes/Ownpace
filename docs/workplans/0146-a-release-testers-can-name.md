# Workplan 0146 — A release testers can name

## Status — 2026-09-24 (update this block at the end of every session)

**2026-09-24: opened from the owner's answers.** Among the readiness review's findings of
2026-09-23 about versions and releases, these five shape this plan. The only release is
`v0.1.0-rc.1`, of 2026-08-04, and every build since calls itself that. The changelog stops in the
middle of August. The managed stack runs whatever commit was last checked out on the machine. The
tasks run on Node 21, while everything else runs Node 24. And several rules in the repository hold
only "pre-release", which nothing says when ends. The review's other findings on the upgrade
drill, the managed chain's upgrade gate, the frozen MinIO image and the pins Dependabot leaves
alone are taken up in T4, T7 and T8. The owner chose to have this plan written: *"W11 write, W12
write, W13 write, W14 write, W15 explaoin, W16 write, W17 write, W18 explain, W19 write"*. 0131 §5
calls this work W17. Its one-line summary there first said "a beta tag"; the owner's word is
*Alpha* (D1), so this plan proposes an alpha tag, and 0131 §5 now says so.

Later the same day the owner put testers on a stack of their own, `ownpace-live`, beside the OTA
stack on the same machine (0131 D3; 0132 D7 carries the second stack). That shapes this plan: the
OTA stack keeps following `main` through the nightly gate, and `ownpace-live` runs releases and
nothing else (T5).

Nothing in this plan is built. The consistency PR #1137 merged on 2026-09-24. It carried five
fixes this plan builds on, each named where it comes up: the managed gate and the live-target
lane run Node 24 (`ceb516c`); the version guard's header says what the worker runs (`1a2249b`);
`docs/deployment.md` separates the managed release controls that exist from the ones that do not
(`7eae92f`); the Trigger.dev version tools move every place the number lives (`6e0f8c0`); and
`SECURITY.md` names what Dependabot is told to leave alone (`0e720b6`).

**Before the first invitation.** This is the minimum, and it is kept small:

- T0, the owner's choice of a name (recommended: `v0.2.0-alpha.1`);
- T2, the bump and the tag, with a check that the tag, the version and the changelog agree, and
  the build written into every problem report;
- T5, `ownpace-live` deploys a release tag and nothing else;
- T6's setting and its guard: the tasks run the Node major the images run.

**After the first invitation:** T1, T3, T4 (apart from the drill from rc.1, which T2 runs because
`docs/release.md` requires it before a tag), T6's pull-request check that the task bundle loads,
T7 and T8. T7 is one sentence from the owner, and is best given with T0.

| Task | Status | Notes |
|---|---|---|
| T0 The alpha's version name, and whether any rename comes first | ⏳ **Owner** | §3. **Alpha minimum.** Recommended: `v0.2.0-alpha.1`, then `alpha.2`, `alpha.3` for each deploy; no renames, as ADR-0040 already decided. Two other names each have a trap (§1). |
| T1 A changelog section a reader can use | 📋 **Proposed** (D1, D6) | §3. After the first invitation, unless it is ready before the tag. Grouped by what a tester notices, with the experimental sources marked, and the stale lines corrected. |
| T2 The version bumped, the tag cut, and the build named where it is needed | 📋 **Proposed** (D1, D5) | §3. **Alpha minimum.** `docs/release.md`'s procedure, a check that the tag, `package.json` and the changelog agree before anything publishes, and a build line in every problem report. |
| T3 Pre-release ends at the alpha tag, and the repository holds to it | 📋 **Proposed** (D3) | §3. After the tag exists. The squash script refuses; no migration a release shipped may change; ADR-0045, the runner's message and the README say so. |
| T4 Upgrades rehearsed from rc.1 and from the alpha tag, on both chains | 📋 **Proposed** (D3) | §3. The container drill from rc.1 runs in T2. The rest follows the tag: both unit gates start from both tags, the managed chain included, on Postgres as well as PGlite. |
| T5 `ownpace-live` runs only a release tag | 📋 **Proposed** (D2, D3, D4) | §3. **Alpha minimum.** 0132 T6's procedure and script, with the tag always a release whose name, version and commit agree. The deploy says before the hold lifts whether it can be undone. |
| T6 The tasks run the Node the images run | 📋 **Proposed** | §3. **Alpha minimum:** `runtime: 'node-24'` in `trigger.config.ts` (supported by the pinned CLI, read from its package) and the version guard extended. **After the first invitation:** a pull-request check that the bundle loads. |
| T7 The object store: replace the frozen MinIO, or accept it for the alpha in writing | ⏳ **Owner** | §3. Recommended: accept it for the alpha, in writing, and replace it after the alpha in the next Trigger.dev drain window (0119 §3, item 5). |
| T8 A watch on the pinned images Dependabot leaves alone | 📋 **Proposed** | §3. After the first invitation. Extends 0135 T7's job (the identity provider) to Trigger.dev, ClickHouse, MinIO and the task base image. |

## 1. What there is today

Each fact below was checked at the current checkout on 2026-09-24 (`main` after the merge of
#1137), unless it says otherwise.

### The version a build gives

- **One number, and it has not moved.** The root `package.json` says `"version": "0.1.0-rc.1"`
  (line 3). The workspace packages stay `0.0.0` on purpose: `docs/release.md` makes the root file
  the single version source. `git ls-remote --tags origin` lists one tag, `v0.1.0-rc.1`, whose
  commit is dated 2026-08-04. The review also read GitHub's release list (one release, marked
  prerelease); that list was not re-read here.
- **Where the number shows.** The API's `/version` and `/api/version` (`apps/api/src/index.ts`,
  lines 115–118) answer `buildIdentity()`: the version from `OPENMIG_VERSION` or else the root
  `package.json`, and the commit from `OPENMIG_COMMIT` (`packages/core/src/build-identity.ts`,
  lines 20–33). The API image sets `OPENMIG_COMMIT` from the `GIT_SHA` build argument
  (`apps/api/Dockerfile`, lines 52–53). The web app's `BuildStamp` shows `v<version> · <commit>` at
  the bottom of the sidebar (`Layout.tsx`, lines 337–338), and on the pages outside it too:
  sign-in, invitations, grant, request access and view (`Login.tsx`, `Invitations.tsx`,
  `Grant.tsx`, `RequestAccess.tsx`, `View.tsx`). It shows the UI's build and the API's build
  separately when they differ (`apps/web/src/services/build-identity.ts`, `describeBuild`).
- So **every managed build since 2026-08-04 reads `v0.1.0-rc.1 · <commit>`**, and only the commit
  tells two builds apart.
- **A problem report does not carry the build.** Below the tester's description, the ticket 0130
  builds lists the page, the reference, the category and the organisation, and no build
  (`ticketFor` in `apps/api/src/problem-report.ts`, lines 146–154).
- The issue template asks for the build with the example *"`[appliance] build 0.1.0-rc.1
  (abc123)`"* (`.github/ISSUE_TEMPLATE/bug_report.yml`, lines 30–32). 0144's tester guide asks a
  tester for *"the build shown at the bottom of the page (0146 names it)"*.

### The changelog

- `[Unreleased]` runs from line 5 to line 126 of `CHANGELOG.md`, and its introduction says
  *"Everything since rc.1 — 209 commits"* (line 7). The newest workplans it cites are 0031 to 0039,
  and its newest date is 2026-08-11 (line 51). No line names Google, Gmail, Dropbox, Apple or
  Takeout; a case-insensitive grep for the five counts zero. The workplans on `main` run to 0130.
- **One line is wrong now.** Line 94 says prices are *"Now a single source in `@openmig/shared`,
  configurable per deployment via `PRICING_*`"*. `packages/shared/src` has no pricing module; the
  prices live in `packages/managed/src/pricing.ts` (line 77, `baseFee: 'PRICING_BASE_FEE_CENTS'`)
  under ADR-0036. The review's second doubt, about the Microsoft registration at lines 33–36, was
  judged still true by its own verifier; it was not re-checked here.
- The `[0.1.0-rc.1]` section (from line 127) is a good model: it says what works, and at the same
  length what is not in it.

### How a release is cut, and two names that would go wrong

- **The procedure** is `docs/release.md`, in four steps:
  - before the tag: rename `[Unreleased]` to the version and date, bump the root version, and run
    the upgrade gates against the previous release. The unit gate must have *executed*, and the
    container drill (`scripts/upgrade-drill.sh`) must not have been vacuous;
  - the tag: `git tag -a`;
  - what the tag fires: `ci.yml`'s test gate, and the three that publish, `images.yml`,
    `security-scan.yml` and `windows-payload.yml`;
  - after the tag: `GET /version` on a pulled image names the new version.
- **A hyphen makes a pre-release.** The GitHub release is marked prerelease
  (`security-scan.yml`, line 263), and the images get no `latest` tag (`images.yml`, lines 15–23).
- **Nothing checks that the names agree.** No workflow compares the tag with `package.json`, or
  looks for the tag's changelog section. `security-scan.yml` uses the tag's name only to write the
  release body (lines 228–230) and to mark the release prerelease (line 263). A tag pushed
  without the bump would publish images tagged with the new version whose `/version` says
  `0.1.0-rc.1`.
- **`rc.2` would send the drill to the wrong registry.** ADR-0040's operative rules say: *"An image
  already published never moves. Tags up to `v0.1.0-rc.1` live at
  `ghcr.io/…/open-migrate-selfhost` forever; `v0.1.0` on lives at `ownpace-selfhost`."*
  `scripts/upgrade-drill.sh` derives its registry from the tag it upgrades from (lines 52–55):
  `0.1.0-rc.*` → `open-migrate-selfhost`, anything else → `ownpace-selfhost`. `images.yml` now
  pushes only `ownpace-<image>` (line 84). So a `v0.1.0-rc.2` would be published under
  `ownpace-selfhost`, but the next release's drill from it would look under the old name, where it
  does not exist.
- **`0.1.0-alpha.1` would sort before rc.1.** SemVer compares pre-release identifiers in ASCII
  order, and `alpha` sorts before `rc`. So to anything that compares versions, `0.1.0-alpha.1` is
  older than the build of 2026-08-04.

### Where "pre-release" is a condition

- `scripts/squash-migrations.sh`, lines 17–21: *"ONLY SAFE PRE-RELEASE. Squashing rewrites history
  the migration runner keys on … any database that already recorded the old chain will trip the
  runner's downgrade guard and refuse to start. That is the correct outcome — such a database must
  be dropped and recreated. Do not run this once real data exists anywhere."*
  - Its only switch is `--apply` (lines 40–41). It works on a scratch server named by `ADMIN_URL`,
    so it cannot see any deployment's tenants. It refuses a missing `ADMIN_URL` and a baseline that
    does not reproduce the schema, but nothing in it refuses because a release exists.
  - It squashes only the shared chain (`MIGRATIONS_DIR`, line 37). The managed chain has no squash
    script.
- ADR-0045's operative rule, line 17: *"Pre-release only, `scripts/squash-migrations.sh` folds the
  chain into `0001_baseline.sql`"*. `scripts/how-migrations-are-authored.mjs` repeats it (line 95),
  and so does `docs/adr/OPERATIVE.md` (line 718), which `scripts/adr-operative.mjs` generates from
  the ADRs.
- `packages/ledger/migrations/0001_baseline.sql`, lines 7–11: the chain was *"squashed while the
  product was still pre-release and no database anywhere held real data"*, and squashing again is
  *"a deliberate pre-release-only operation"*.
- **ADR-0040.**
  - The compose project, container, network and volume names were renamed to `ownpace-*`, and
    *"This is not a rename on a live stack … Done here only because nothing was live"* (lines
    53–57).
  - Kept, on purpose: *"Kept, deliberately: the npm scope **`@openmig/*`** (13 packages, all
    `private: true`), and everything that follows it — the `openmigrate` Postgres role/database
    and the **`openmigrate_*` Prometheus metric prefix**"* (lines 58–62).
- **A shipped migration has already been edited once.** ADR-0036's section *"This is a pre-release
  schema break, and the upgrade gate said so"* records that `0001_baseline.sql` was changed after
  rc.1 shipped it. The upgrade gate carries an allow-list for that change (`MOVED_TO_MANAGED_CHAIN`
  in `migrate-upgrade.unit.test.ts`).
- **The runner's own advice assumes nothing is live.** The downgrade guard in
  `packages/ledger/src/migrate.ts` (lines 158–168) refuses a database newer than the build, and its
  message says that a squash *"only ever happens pre-release, and the fix for it is to drop and
  recreate the database; the ledger is a rebuildable cache (ADR-0020), so nothing irreplaceable
  lives here."*
  - That is true of an appliance's items. It is not true of a managed stack.
  - On managed, the same database holds `tenant`, `connection` with its stored credentials, and
    `audit_log` (all created in `0001_baseline.sql`). It also holds the managed chain's tables,
    which reference `public.tenant` (`packages/managed/src/migrate-managed.ts`, line 13).
- `README.md` line 103: *"Active development, pre-release."* No document says when pre-release
  ends. A grep of `docs/*.md`, `docs/adr/`, `README.md`, `SECURITY.md` and `AGENTS.md` finds,
  besides the ones above, only `release.md`'s SemVer meaning, `deployment.md`'s channel rule
  ("non-prerelease"), and in ADR-0036 a heading (line 148) and a link text (line 16).
- 0134 T3 proposes *"No squash of either migration chain during the alpha."*

**What already stops a squash, in part.** The shared chain's upgrade gate fails when a file present
at the released tag is gone from the tree (`migrate-upgrade.unit.test.ts`, lines 299–302). rc.1
carries six shared-chain files, `0001_baseline.sql` to `0006_group_def_discovery.sql`. So a new
squash of the shared chain already fails that gate on any pull request. Nothing like it covers the
managed chain: rc.1 predates the chain, and `two-chains.unit.test.ts` materialises only the shared
chain from the released tag (lines 140–152).

### The upgrade gates

- `packages/ledger/src/migrate-upgrade.unit.test.ts`:
  - it starts from `UPGRADE_FROM_REF || 'v0.1.0-rc.1'` (line 99);
  - it runs on PGlite (lines 252–253);
  - it gates every pull request, because the unit job checks out with tags (`ci.yml`, line 510);
  - it asserts that an upgraded schema equals a fresh one, that the upgrade is idempotent, and that
    the released build is refused against the upgraded database.
- `packages/managed/src/two-chains.unit.test.ts`:
  - it starts from `RELEASED_REF`, the same default (line 75);
  - it materialises the shared chain at that tag and runs the managed chain over it: *"this is the
    UPGRADE case — a database that predates the chain split"*;
  - it too runs on PGlite. The managed edition runs `postgres:18-alpine` (`managed.yml`, line 39).
- **The container drill** (`scripts/upgrade-drill.sh`) is the appliance's. Its one recorded run, on
  2026-08-04, was with the tag at about HEAD, so as a migration drill it was vacuous (0025 T5). No
  later run is recorded.
- **What has changed since rc.1.** The shared chain now runs to
  `0062_a_key_the_audit_export_is_pseudonymised_with.sql`, and the managed chain to
  `0025_a_log_the_operator_can_read.sql`. rc.1 has no managed chain at all.

### How the managed stack is deployed

- **From source, not from the release images.** `managed.yml` builds the API and the web app from
  the checkout (`build: context: ../..`, lines 782–785 and 960–963), with `GIT_SHA` (lines 791 and
  969). No service in it pulls an `ownpace-*` image. `images.yml`'s signed images are the
  appliance's channel.
- **The web image cannot simply be swapped in.** It bakes `VITE_OIDC_ISSUER` and
  `VITE_OIDC_CLIENT_ID` in at build time (lines 977–978), so a published web image is not a
  drop-in for a managed stack.
- **The OTA stack has two writers.** The nightly gate rebuilds it from `main` (0132 §1). The
  bring-up's *Updating a running deployment* (`docs/managed-bring-up.md`, lines 1914–1926) is
  `git pull`, then `up -d --build --wait api web`, then `deploy-tasks.sh`. So what runs is
  whatever commit was checked out last.
- **No staged rollout, and no backup before migrating.** `docs/deployment.md` line 25 says
  neither is built (fixed in #1137). `migrate.ts` refuses an older build against a newer schema, so
  without a dump a deploy only goes forward (0132 §1).
- **What is proposed for live.** 0132 T6 proposes one procedure and a script,
  `deploy/compose/deploy-live.sh <tag>`, that refuses a ref that is not a tag. 0132 T1g leaves it
  to this plan to say how tags are cut. Nothing checks yet that a tag is a release: that its name,
  the version the build reports and the changelog agree.

### The tasks' Node

**What the repository sets.**

- `apps/worker/trigger.config.ts` (lines 24–51) sets no `runtime`.
- The SDK is `4.5.16` (`apps/worker/package.json`, line 22). The deploy CLI is pinned to it:
  `deploy-tasks.sh` reads the SDK's version (line 88) and runs
  `npx -y "trigger.dev@${CLI_VERSION}" deploy` (line 300). In its own words, *"The CLI version is
  pinned to the SDK version … by construction"* (lines 66–67).

**What the pinned CLI does with that.** This plan read the CLI's published package,
`trigger.dev@4.5.16` from npm, and the installed `@trigger.dev/core@4.5.16`:

- **The default.** The default runtime is `"node"` (`DEFAULT_RUNTIME` in core's
  `dist/esm/v3/build/runtime.js`, line 6). `dist/esm/deploy/buildImage.js` (lines 448–459) maps
  `node` to `triggerdotdev/node:21-bookworm@sha256:49c6575c…`.
- **The alternatives.** It maps `node-22`, `node-24` and `node-26` to their own `bookworm` images.
- **What the config accepts.** `node`, `node-22`, `node-24`, `node-26` and `bun` (`ConfigRuntime`
  in core's `dist/esm/v3/schemas/build.js`, lines 9–19). `experimental-node-24` is a deprecated
  alias of `node-24`.
- **When the config names none,** the CLI takes the server project's default runtime, if the
  server has one (`if (!resolvedConfig.runtimeWasExplicit && projectClient.defaultRuntime)`, in
  `dist/esm/commands/deploy.js`).

**What runs, and what it should be.**

- The review read the managed gate's run #193 build log:
  `FROM docker.io/triggerdotdev/node:21-bookworm@sha256:49c6575c…`. That is the same digest the
  CLI names for `node`. This plan did not re-read the log.
- So the tasks, which hold every tenant's credentials while they run, run Node 21.
- Everything else says 24:
  - the images are `node:24.21.0-slim` (`apps/api/Dockerfile` line 20, `apps/selfhost/Dockerfile`
    line 39, `apps/web/Dockerfile` line 13);
  - `package.json` says `"engines": { "node": ">=24" }`;
  - every `setup-node` step now asks for `'24'` (fixed in #1137).
- Node 21 is an odd-numbered line: it was never an LTS, and its support ended in 2024. That comes
  from the Node.js release schedule, outside this repository, and was not re-checked here.
- Which Node 24 minor `triggerdotdev/node:24-bookworm` carries was not checked.

**What the comments say.**

- `packages/connectors/src/crc32.ts` (lines 5–15) and
  `a-checksum-the-runtime-did-not-have.unit.test.ts` (lines 12–16) blame *"a CLI this repository
  does not pin"*. The CLI is pinned. What was left unset is the runtime.
- #1137's version guard now says so in its header
  (`scripts/a-gate-on-a-version-nothing-ships.unit.test.ts`, lines 25–29), but it does not test
  it.
- No pull-request job bundles the task files, or imports them under any Node. Only the nightly
  managed gate does, when it deploys the tasks through the CLI (`e2e-managed.yml` runs
  `bootstrap-managed.sh`, which runs `deploy-tasks.sh`). That is where the `crc32` import failed:
  the scheduled runs #193 and #194 (0141 §1), not a pull request.

### Pins nobody watches

- **What Dependabot leaves alone.** `.github/dependabot.yml` ignores by name:
  - the Trigger.dev webapp and supervisor images, the identity provider, ClickHouse and MinIO
    (lines 103–113);
  - every `@trigger.dev/*` package (lines 25–32).

  `SECURITY.md` line 16 names these exceptions (fixed in #1137). The Trivy scan scans files, not
  images (0135 §1). The task base image is named by the CLI rather than by any file here, so
  nothing reads it at all.
- **Trigger.dev.**
  - It is pinned at `v4.5.16` (`managed.yml`, lines 148 and 374).
  - `deploy/compose/trigger-version.sh list` probes upward for newer tags that both images carry
    (lines 161–196), when somebody runs it. Its `pin` moves every place the number lives, every
    `@trigger.dev/*` manifest included, since #1137 (`6e0f8c0`).
  - `git ls-remote` on 2026-09-24 lists repository tags up to `v4.6.4`, and npm published CLI
    `4.6.4` on 2026-09-22. Whether both images exist at those tags is what `list` probes; it was not
    run for this plan.
- **The identity provider** is pinned at `v4.17.3` (line 546). `v4.18.0`, `v4.19.0` and `v4.19.1`
  are newer. 0135 T7 carries it.
- **ClickHouse.**
  - It is pinned to a 26.2 build by digest, *"as read from trigger.dev's own
    docker/docker-compose.yml at v4.5.12"* (lines 271–275).
  - At `v4.5.16` that file pins the same image and the same digest (read on 2026-09-24 from
    `raw.githubusercontent.com`).
- **MinIO.**
  - The image is `bitnamilegacy/minio:2025.5.24-debian-12-r5`, by digest (line 441). The comment
    above it (lines 421–440) explains the pin.
  - 0119 §3 item 5 (lines 228–242) says *"There is no maintained free MinIO image to move to"*.
    It names versitygw as the drop-in candidate, and Garage if a store with its own integrity
    model is wanted, at the price of more ceremony at bring-up.
  - Upstream's own self-hosting compose at `v4.5.16` still defaults to
    `bitnamilegacy/minio:${MINIO_IMAGE_TAG:-latest}` (`hosting/docker/webapp/docker-compose.yml`,
    read the same day).
  - The `minio` service publishes no port (lines 441–451: environment, volumes and networks only).
    It sits on the compose network with the API and the tasks, and its password defaults to
    `very-safe-password` (line 446). 0132 has live generate its own before the first bring-up
    (T1b), and T2 replaces the OTA stack's.
- **Two stale lines in 0119, for its next session.**
  - §4 (line 327) still names `${TRIGGER_IMAGE_TAG:-v4.5.12}`.
  - §2.4 says the images run 24.20.0; the Dockerfiles say 24.21.0.

## 2. The owner's decisions (2026-09-24)

Each decision gives the question in plain words and the answer as given, typos included. Where
an answer needed a reading, the reading is stated. None of the answers names a version; that is
T0.

**D1 — what the alpha is, and what it is called.** *Is the test free or paid, for how many people,
for how long, and in which language?* — *"Free and invite only. 10 to 20 people max. Dutch."* On
the posture of the test: *"Free. A few weeks. No obligations both sides."* And asked whether a
lawyer's pass comes first, whether the test is labelled, and whether the owner can supply the
facts: *"Yes before, Alpha, and i can supply."*

So the name is the owner's: *Alpha*. A version that testers read at the bottom of the page should
say the same word (T0). The alpha is a few weeks long, so it may see several deploys, and each
needs a name of its own.

**D2 — where testers run.** *Where do testers run, and under which host names?* — *"This machine,
ci states. The OTA address. It's all controlled by me and invite only."* ("ci states" is read as
"CI stays", as 0131 reads it.) Asked about a tester stack separate from CI and the nightly gate:
*"Yes, but its a controlled rest. I Let people in and support them. Max 10/20 people"* ("rest" is
read as "test"). Later the same day, as 0131 D3 records, the owner asked: *"check, can't i just (as
a start) host a 'ownpace-live' as production, next to the current 'ownpace-managed' on OTA-domain?
What would i need to do to keep alle seperate from each other?"* The proposal back was to make it
so. The answer: *"Yes! The spark has a lot free memory and disk, it will fit."*

So testers use `ownpace-live`, on the same machine as the OTA stack `ownpace-managed`, at the
production names (0131 D3, 0132 D7). The OTA stack stays the nightly gate's target and follows
`main`. That is what makes T5 possible: one stack for "whatever `main` is tonight", and one for "a
release, named".

**D3 — no backups, no way back.** *How much loss is acceptable, how fast must service come back,
and where are backups kept?* — *"None during the test"*. On the missing database backup: *"No
obligations during controlled test"*.

So a deploy to `ownpace-live` that migrates the schema cannot be taken back, unless the owner
chooses to take a dump first (0132's open question on a way back, 0134). T5 therefore says, before
the hold is lifted, whether a deploy is one-way. And T3 matters: the runner's advice to drop and
recreate the database would, on `ownpace-live`, be the testers' organisations.

**D4 — git is the bridge.** Asked whether the demo secrets must be rotated if the current stack is
reused: *"Who would need/het credentials? I aupporrthe test. No one will be added to NetBird
network. Devs need to setup own private test/dev environments. GitHub PRs and git is the bridge."*
("het" is read as "get", and "aupporrthe" as "support the", as 0131 reads them.)

So code reaches the machine only through git. A tag is git's own name for one commit, and it is the
one thing the owner, a tester, a GitHub release and a deploy log can all quote (T5).

**D5 — one person lets testers in and supports them.** *What may a member and a viewer do, and
should only owners and admins invite?* — *"I am the gate for letting people in the test."*

So the owner is also the person who reads every problem report. T2 puts the build into the report,
so the owner does not have to ask for it.

**D6 — unproven sources are labelled.** *For sources nobody has run against a real account: prove
them first, hide them, or label them experimental?* — *"Label"*. 0131 T2 builds the label. T1's
changelog uses the same verdicts, so the release notes do not call a source proven that the
screen calls experimental.

## 3. What each task does

### T0 — the version name, and the renames (owner)

**1. The name.** Three options:

- **(a) `v0.2.0-alpha.1`.** *Recommended.*
  - It says what the owner called the test (D1).
  - SemVer orders it after `v0.1.0-rc.1`, because the minor is higher.
  - `upgrade-drill.sh` already looks for it under `ownpace-selfhost`, which is where `images.yml`
    publishes it.
  - Each later deploy to `ownpace-live` is `alpha.2`, `alpha.3` and so on (T5).
  - What follows the alpha (a beta, or `0.2.0`) is not decided here.
- **(b) `v0.1.0-rc.2`.** It continues the line, but:
  - "release candidate" claims a readiness the alpha itself denies;
  - `upgrade-drill.sh`'s `0.1.0-rc.*` case would look for it under the old image name (§1). That
    case would have to name `0.1.0-rc.1` exactly, with a test that `v0.1.0-rc.2` resolves to
    `ownpace-selfhost`.
- **(c) `v0.1.0-alpha.1`.** *Not recommended.* It sorts before rc.1 (§1), so the alpha would be
  "older" than August's build to `sort -V`, to SemVer libraries and to anything else that compares
  versions. T2's check refuses it.

**2. Renames: before the alpha, or never.** ADR-0040 already kept the npm scope `@openmig/*`, the
`openmigrate` role and database, and the `openmigrate_*` metric prefix, *"deliberately"*. The
alpha changes the cost of only some of the names:

- **The names a live stack carries.** From the first tester, `ownpace-live` holds data. A rename of
  its compose project, a volume, the database or a role detaches or strands that data, which is
  ADR-0040's own warning (lines 53–57).
- **The npm scope.** Its 13 packages are private and unpublished, so no outside consumer exists, and
  the alpha does not change what a rename would cost. ADR-0040 measured that as a mechanical sweep.
- **The database user names.** Asked whether the database passwords had been changed, the owner
  answered, among other things, *"Usernamea changed"* (0131 D3; "Usernamea" is read as
  "usernames"). A user name is a setting in a stack's `.env` (`POSTGRES_USER`, whose default is
  `openmigrate`), not a rename in the repository, and 0132 T2 deals with the roles.

*Recommended: no rename before the alpha, and none on a live stack after it.* Nothing asks for one.
The npm scope stays renameable later as a code change, should the owner ever want it.

**3. One last squash before the tag?** *Not recommended.* rc.1 is public, and the upgrade gate
already refuses a squash that removes rc.1's files (§1). A squash would gain nothing, and T3 closes
the door after the tag.

The answers are written in this block, dated.

### T1 — a changelog section a reader can use

The section for the alpha tag, in English. It is the release's prose, and the release body links
to it. Testers read the Dutch tester guide and the known limitations (0144); this section is for
the repository's readers and the release page.

**What it contains, grouped by what a tester notices rather than by workplan:**

- **What the alpha is**, in a few lines: managed, by invitation, free, a few weeks, no backups (D1,
  D3). A link to `docs/feature-matrix.md` and to 0144's known limitations.
- **Sources.**
  - The Google account (Gmail, Calendar, Contacts, Drive, Tasks).
  - The Microsoft account, including To Do.
  - Apple, Dropbox and Box.
  - The export archives (Takeout and Apple's export), marked appliance-only on managed, as 0131 T2
    proposes.

  Each is marked *proven* or *experimental* from 0131 T2's table on the day of the tag (D6).
- **Targets:** the Soverin and Nextcloud account kinds, and JMAP.
- **Signing in** through the identity provider (ADR-0042), and grant links.
- **Migrations are silent by default** (ADR-0043), and invoices are not ours to write (ADR-0044).
  Billing is not live during the alpha (0131 T3).
- **For the operator:** the log page (0129) and the problem report (0130).
- **What is not in it**, at the same length, as rc.1's section did it:
  - no backups (0134);
  - the experimental sources;
  - the Windows payload at this tag is unsigned, as rc.1's was (0025 T6 stays deferred until
    `v0.1.0` proper);
  - the appliance at this tag is the same code, but the alpha is about the managed edition.
- **Corrections.** Line 94's pricing sentence names `@openmig/managed`'s `pricing.ts` under
  ADR-0036. The *"209 commits"* introduction goes.

**Source material:** the status blocks of the workplans since 0040, and the merged pull requests
since the rc.1 tag.

**Timing.** Best before the tag, so that the alpha's section is the curated one. A released section
is not rewritten afterwards: 0025 T2 allowed that only because rc.1 had not yet been published. If
T1 is not ready, T2's floor applies:

- the section keeps today's text;
- the pricing line is corrected;
- a first paragraph says the section lists changes only up to mid-August, and points to the feature
  matrix.

T1 then becomes the *"since rc.1"* part of the next alpha's section.

**Guard.** No code guard of its own. T2's check refuses a tag whose changelog section is missing,
and the content is the owner's to read.

### T2 — the version bumped, the tag cut, and the build named where it is needed

**The procedure** is `docs/release.md`, with these particulars:

1. **On a branch:**
   - the root `package.json` goes to the version T0 chose;
   - `[Unreleased]` becomes `[0.2.0-alpha.1] - <date>`, holding T1's text or T2's floor;
   - `bug_report.yml`'s example shows the new form, and says where the managed service shows it:
     the bottom of the sidebar, and the sign-in page.
2. **The problem report names the build.** `ticketFor` adds a line `Build: v<version> · <commit>`
   from `buildIdentity()`. Every report then says which build the tester was on, whether or not
   the tester read it off the page (D5). The API already imports `buildIdentity`.
3. **A check that the names agree, before anything publishes.**
   - A small script, `scripts/release-names-agree.mjs`, runs as the first step of each job that
     publishes on a `v*` tag: `images.yml`, the release step of `security-scan.yml`, and
     `windows-payload.yml`. `ci.yml` runs on tags too, but it does not stop the other three.
   - It refuses when the tag is not `v` plus the root version, or when `CHANGELOG.md` has no
     `## [<version>] - <date>` heading.
   - It also refuses a tag that SemVer orders at or below an existing release tag. That turns T0's
     option (c) into a refusal rather than a surprise.
4. **Merge, then the upgrade gates against rc.1**, as `release.md` asks:
   - `git fetch origin tag v0.1.0-rc.1`, and the shared-chain gate's `skipIf(!HAVE_REF)` tests
     *executed* (`release.md` says five; the file has six today);
   - `scripts/upgrade-drill.sh v0.1.0-rc.1` on the reference machine. This is the first run that is
     not vacuous (0025 T5), since `main` is far past rc.1. The drill is the appliance's, and it runs
     under its own compose project and container name (`compose.drill.yml`), so neither stack is
     touched.

   The date and the drill's verdict line are written in this block. This is T4's first half; it is
   here because `release.md` makes it a condition of the tag. Open question 3 asks whether the owner
   would rather tag without it, with the skip recorded.
5. **Pick the commit.** The commit to tag is one the nightly gates ran green, the managed one on
   the OTA stack among them, since those gates keep running for `main` (D2). 0131 T5 and 0132 T6
   (step 1) ask for the last N scheduled runs to be green, and the owner names N; the tag uses the
   same condition, so the commit tagged is the commit live may deploy.
6. **Tag and push:** `git tag -a v0.2.0-alpha.1 -m "Ownpace v0.2.0-alpha.1"`. Then check
   `release.md` §3:
   - the three images are published at `0.2.0-alpha.1`, and there is no `latest`;
   - the GitHub release is marked prerelease, with the SBOM and its body;
   - the Windows payload is attached.

**After the tag,** `main` still says `0.2.0-alpha.1` until the next cut. An OTA build then reads
`v0.2.0-alpha.1 · <another commit>`; the commit is what tells it from the release. Marking such
builds (for example `+dev`) is not proposed, because testers never see them: `ownpace-live` runs
only tags (T5).

**Guards.** Each of these fails on today's code:

- In the API's `a-report-that-reaches-a-person` tests: `ticketFor`'s article body carries
  `Build: v<version> · <short commit>`, taken from `buildIdentity()`.
- `scripts/a-release-that-names-itself.unit.test.ts`, which checks two things:
  - The check function refuses three shapes: `v0.2.0-alpha.1` with a `package.json` that says
    `0.1.0-rc.1`; a version with no changelog section; and `v0.1.0-alpha.1` when `v0.1.0-rc.1`
    exists. It accepts a tag, version and section that agree.
  - Every workflow that runs on `tags: ['v*']` and publishes calls the check before its first
    publishing step. The test reads this from the YAML.

### T3 — pre-release ends at the alpha tag, and the repository holds to it

**Why the tag, and not "once a non-demo tenant exists".** The squash script works on a scratch
server and cannot see any deployment's tenants (§1). The tag, on the other hand, is a fact in the
repository that CI can read. Under D2 it is also the moment testers' data starts to exist, because
live's first deploy is the alpha tag.

**One place names the tag.** A small file, `scripts/release-line.json` (the build settles the
name), says `"preReleaseEndedAt": "v0.2.0-alpha.1"`. T4 keeps its list of upgrade starting points
in the same file.

**What changes:**

- **`scripts/squash-migrations.sh` refuses** before it connects to anything, naming ADR-0045 and the
  tag. The file stays: other files point to it, and it records how the baseline was made.
- **ADR-0045's operative rule** is amended in place (ADR-0038). Pre-release ended with the alpha tag
  on its date, and from then on both chains only grow. `node scripts/adr-operative.mjs --write`
  regenerates `docs/adr/OPERATIVE.md`, and `how-migrations-are-authored.mjs` line 95 follows it.
- **No migration a release shipped may change.** Every file of either chain at the alpha tag, or
  at any later release tag, must be byte-identical at HEAD. That covers squashing, editing in place
  (what ADR-0036 did to rc.1's baseline) and deleting, and it covers the managed chain, which no
  gate compares with a release today. rc.1 stays outside the rule: its `0001_baseline.sql`
  differs from HEAD's today (checked on 2026-09-24), under the allow-list §1 names.
- **The runner's message stops advising a drop.** `migrate.ts`'s downgrade message drops the squash
  explanation and the *"nothing irreplaceable lives here"* sentence. It names the two causes that
  remain: a build older than the database (deploy the newer release), and a chain edited after a
  release (a defect, and the gate above should have refused it). It also says that on a managed
  stack the database holds organisations, credentials and the audit log, and must not be dropped.
- **`README.md` line 103** says the project is in alpha, from the tag, and `docs/release.md` gets
  one line: pre-release ended with the alpha tag, see ADR-0045.
- `0001_baseline.sql`'s header is generated (*"do not hand-edit"*) and stays: it describes when it
  was made.

**Guard.** `scripts/a-chain-that-only-grows.unit.test.ts`. It fails on today's code, because the
file, the refusal and the amendment do not exist. It checks four things:

- It runs `squash-migrations.sh` with stub `psql` and `pg_dump` on `PATH` that record every call,
  and expects exit 1, ADR-0045 and the tag on stderr, and no call recorded.
- ADR-0045's operative rules name the tag, and no longer say *"Pre-release only, …
  folds the chain"*.
- `migrate.ts`'s downgrade message no longer contains *"nothing irreplaceable"*.
- For both chains, every file at `preReleaseEndedAt`, and at every later release tag in
  `release-line.json`'s list, is byte-identical in the working tree. The tags must be reachable
  under `CI`, and the test fails hard if one is not; locally it warns, as the existing upgrade
  gate does.

**Order.** T3 lands after the tag exists, because its last check needs the tag. Until then, 0134
T3's rule (*"No squash of either migration chain during the alpha"*) and the existing gate (§1)
stand in for it.

### T4 — upgrades rehearsed from rc.1 and from the alpha tag, on both chains

**From rc.1: the container drill.** This is part of T2, as `release.md` requires.

**From both tags: the unit gates.** After the tag, both unit gates take their starting points from
`release-line.json`: `v0.1.0-rc.1`, the oldest supported, and the alpha tag, the previous release.
The architecture document's §22.1 asks for exactly this: *"from **N-1** (and at least one older) to
N"*.

- The rc.1 leg stays as it is, with its allow-list.
- The alpha leg materialises **both** chains at the tag, applies HEAD's two chains in order (the
  shared chain first; the managed chain references `public.tenant`), and asserts:
  - the upgraded database equals a fresh install at HEAD, for the tables of both chains;
  - no file of either chain at the tag is gone;
  - the tag's build is refused against the upgraded database by both runners' downgrade guards.
    The managed runner is `runMigrations` with its own bookkeeping table (`migrate-managed.ts`).
- The alpha leg has no allow-list. An entry for a tag after pre-release ended would itself be a
  defect (T3).

**On Postgres too.** The same alpha leg runs in the integration project against Postgres 18, as the
integration suite already does with Testcontainers. The managed edition runs Postgres, and PGlite
carries its own engine version inside an npm package.

**From the alpha tag: the container drill,** at the next release (`release.md`). `upgrade-drill.sh`
already finds `0.2.0-alpha.1` under `ownpace-selfhost`.

**On `ownpace-live` itself.** Its first upgrade (alpha.1 to alpha.2) runs on testers' data, with no
backup (D3). Before it, three things hold:

- the new tag's commit has passed the nightly gate on the OTA stack, whose database has taken every
  migration in between one commit at a time, on demo data (the review's verifier called that a real
  incremental exercise);
- both unit gates, and the Postgres leg, are green on that commit;
- T5 says whether the deploy is one-way.

Whether the owner dumps the database first is 0132's and 0134's question, not this plan's.

**Guards.**

- `scripts/every-release-is-a-starting-point.unit.test.ts`: under `CI`, the newest `v*` tag in
  SemVer order is in `release-line.json`'s list. It fails today, because the file does not exist.
  Once the file lists rc.1, it passes while rc.1 is the only tag, and fails the moment the alpha
  tag is pushed without being added there with the alpha leg below, which is when it matters.
- The alpha leg's own tests, in `migrate-upgrade.unit.test.ts`, `two-chains.unit.test.ts` and a new
  integration test beside them. Each fails without this task, because nothing materialises the
  managed chain from a tag.

### T5 — `ownpace-live` runs only a release tag

**The rule.** `ownpace-live`'s checkout is always a `v*` tag, detached. The OTA stack keeps
following `main` through the nightly gate (D2). Then these all name the same thing:

- a tester's build stamp;
- a problem report's build line (T2);
- the owner's deploy log;
- the GitHub release.

0141's walks and records name the tag or commit they ran against (*"which commit C was: 0146"*);
on live that is always a tag. 0143 T9's rehearsal runs on any managed stack except live, so it
names a commit of `main`, and says which release tag, if any, that commit is.

**The procedure** is 0132 T6, *one way to deploy live, from a tag*: hold, drain, a tag whose
commit the nightly gate ran green on the OTA stack, `git checkout --detach <tag>` in
`~/ownpace-live`, the bring-up without the demo, the checks, lift the hold. 0132 T1g says that live
moves only by hand, from a tag, and that this plan decides how tags are cut. `git pull` is never
run on live.

**The code.** 0132 T6 proposes `deploy/compose/deploy-live.sh <tag>`. It refuses a ref that is not
a tag, and a `.env` without live's marker (0132 T1g; working name `STACK_KIND=production`). This
task adds what makes the tag a *release* rather than any tag, and what the owner needs to know
before the hold lifts. On live, the script:

- **accepts only a release tag:** a `v*` tag that is annotated, is on origin (`git ls-remote --tags
  origin`), and whose commit's root `package.json` version is the tag without its `v`. Anything
  else is refused, with the sentence *"live runs releases: name a release tag"*;
- builds with the tag's commit as `GIT_SHA`;
- **after the bring-up, asks `/api/version`.** 0132 T6 checks that the answer names the tag's
  commit; this task also checks the version. If either is wrong, the script says the deploy did not
  take, and the hold stays;
- **says, before the hold is lifted, whether the deploy is one-way.** It lists the migration files
  the new tag adds to either chain over the running tag, and whether the Trigger.dev or identity
  provider pin in `managed.yml` differs between the two tags. Both of those migrate their own
  schemas one way (0119, 0135).
  - With none of these, the previous tag can be redeployed if the new one misbehaves.
  - With any, the only way is forward: `migrate.ts` refuses the older build, the two planes cannot
    go back without their dumps, and D3 says no backups.
- **names the task deployment after the release:** it passes `--external-id <tag>` to the task
  deploy. The 4.5.16 CLI has that flag. Its help says that deploying the same id again returns the
  existing version instead of building it again, which is what a redeploy of the previous tag
  wants, if the server then makes that version the current one. Whether the self-hosted server of
  the same version records the id, and what it does on a repeat, was not checked. The first live
  deploy shows the first, a redeploy on the OTA stack can show the second, and the flag is dropped
  if the server ignores it;
- adds "one-way" or "reversible" to the line 0132 T6 appends to live's deploy log.

On the OTA stack nothing changes: the nightly gate still deploys `main`, and it never runs this
script.

**Rollback, stated plainly.** During the alpha, a bad deploy is fixed by going forward: a fix, a new
`alpha.N` tag, and a deploy. The one exception is a deploy the script called reversible: then the
previous tag can be deployed again. `docs/managed-bring-up.md`'s *Updating a running deployment*
gains a paragraph for `ownpace-live`. `docs/release.md` gains a §5, *Deploying a release to
ownpace-live*, which points to 0132's procedure.

**Guard.** 0132 T6's guard, `scripts/a-deploy-from-a-named-tag.unit.test.ts`, drives the script
with stubbed `git`, `docker` and `curl`. This task adds four cases to it. They fail today, because
neither the script nor these rules exist; they land with 0132 T6's script or on top of it:

- a lightweight tag, or a tag that is not on origin, is refused;
- a tag whose `package.json` says another version is refused, and the refusal names both;
- a `/api/version` that answers the right commit but another version fails the deploy;
- a tag that adds a migration file to either chain, or moves either pin, prints "one-way", and one
  that does neither prints "reversible".

### T6 — the tasks run the Node the images run

**The setting.** `apps/worker/trigger.config.ts` gets `runtime: 'node-24'`, with a comment:

- 24 is the images' major, and the version guard holds the two together;
- the runtime is set explicitly because without it the CLI takes the server project's default, or
  else its own `node`, which in the 4.5.16 CLI is Node 21 (§1).

**What was verified, and what was not.**

- *Verified from the packages:* the pinned CLI and core accept `node-24` as a runtime in its own
  right (the `experimental-` spelling is only a deprecated alias of it). The CLI builds it on
  `triggerdotdev/node:24-bookworm@sha256:d2d0c018…`.
- *To check on the first deploy:*
  - which Node 24 minor that image carries. A task's own log line with `process.version` answers
    it, or `node -v` in the image;
  - that the self-hosted supervisor at `v4.5.16` runs the image unchanged. That is expected, since
    the runtime is chosen when the image is built, but it has not been verified.

**Order.** The setting and Guard 1 are the alpha minimum. The change lands on `main`, and the
nightly gate deploys the tasks on the OTA stack under `node-24`; that is the proof on a managed
stack, with demo data. The alpha tag then includes it. `ownpace-live` starts fresh at the tag, so
if T6's setting lands before the tag, no tester's pass ever runs on Node 21. Guard 2 follows
after the first invitation: it is there for the next mismatch, and until it lands the nightly
deploy on the OTA stack is still where one would show.

**The comments are corrected.** `crc32.ts` (lines 5–15) and
`a-checksum-the-runtime-did-not-have.unit.test.ts` (lines 12–16) say the runtime was left unset,
not that the CLI was unpinned. The CRC-32 module stays: it is still correct, it is twenty lines,
and it takes nothing from the platform.

**Guard 1: the setting.** `scripts/a-gate-on-a-version-nothing-ships.unit.test.ts` (#1137) gets a
third block: `trigger.config.ts` declares `runtime: 'node-<N>'`, where N is the images' one major.
It fails today, because the key is absent.

**Guard 2 (after the first invitation): a pull request shows the bundle loads.**
`scripts/a-task-bundle-the-runtime-can-load.mjs`:

- **What it does.** It bundles each task file under the config's `dirs`, test files excepted, with
  `esbuild` (already a root dev dependency). It keeps the config's `build.external` list
  (`@electric-sql/pglite`, `pg`) external, and uses `platform: 'node'`, `format: 'esm'` and the
  runtime's major as the target. Then it imports each output in a child `node` process.
- **Where it runs.** A job in `ci.yml` runs it on pull requests, on GitHub-hosted runners, with a
  `setup-node` step. The version guard already holds every `setup-node` to the images' major, and
  Guard 1 holds the runtime to the same major.
- **What it catches.** An ESM link error, of the kind the `node:zlib` `crc32` import caused on
  Node 21, fails the pull request instead of the nightly deploy. On Node 24 that particular import
  would load, which is right: the check follows the runtime T6 names, and it is there for the next
  such mismatch.
- **Its self-test.** `scripts/a-task-bundle-the-runtime-can-load.unit.test.ts` runs the check on a
  fixture task that imports an export `node:zlib` does not have, and expects it to fail, and on a
  fixture that imports nothing unusual, and expects it to pass. It fails today, because the script
  does not exist.
- **Its limits, stated.** This is not the CLI's own build. The CLI adds its own entry points and
  shims, and takes further externals from the server. So the check catches the class of failure
  that bit (an API or an export the runtime lacks, an import that does not resolve), not everything.
  The full proof stays the nightly deploy on the OTA stack.

### T7 — the object store (owner)

**The options.**

- **(a) Accept it for the alpha, in writing.** *Recommended for the alpha's few weeks.*
  - Why it is tolerable:
    - it publishes no port, and only the stack's own services can reach it;
    - once 0132 is done, its password is not the shipped one: live generates its own before its
      first bring-up (0132 T1b), and 0132 T2 replaces the OTA stack's;
    - 0136 T1 proposes to refuse a host a tester types when it is a compose service name.
  - What it costs: the image is frozen, so a vulnerability found in it stays.
  - What it holds is Trigger.dev's large payloads and run artifacts. What those contain for this
    product was not measured here; 0139 T6 covers how long task payloads may keep a tester's data.
- **(b) Replace it before `ownpace-live`'s first deploy, with versitygw** (0119's candidate).
  `ownpace-live`'s object store starts empty, so this is the one moment the swap needs no copy.
  But:
  - nobody has run Trigger.dev `v4.5.16` against versitygw;
  - the `packets` bucket has to be created some other way, because `MINIO_DEFAULT_BUCKETS` is a
    bitnami convenience (`docs/managed-bring-up.md`, lines 2112–2122, lists what a non-bitnami
    image needs);
  - `managed.yml` serves both stacks, so the OTA stack moves too. Its store can start empty; the
    bring-up says what that loses: historical large payloads, not deployments;
  - it needs a green managed gate on the OTA stack first.

  That is more than the first invitation should wait for, unless the owner wants it.
- **(c) Replace it after the alpha,** in the same drain window as the next Trigger.dev upgrade,
  which is 0119's own advice. That is also when `ownpace-live` is either reset or carried on
  (0131 T4).

*Recommended: (a) now, then (c).* Under (a), the acceptance is written in this block with its date,
and the same line goes into 0119 §3's item 5 (0119 T3, the owner's decisions).

**Guard, when (b) or (c) is built.** `scripts/an-object-store-with-a-maintainer.unit.test.ts` fails
while `managed.yml` runs a `bitnamilegacy/*` image. It also checks that the service that replaces
MinIO creates the `packets` bucket.

### T8 — a watch on the pinned images Dependabot leaves alone

**What is watched.**

- The images `dependabot.yml` ignores by name: the Trigger.dev webapp and supervisor, ClickHouse
  and MinIO. The identity provider is 0135 T7.
- The `@trigger.dev/*` packages, which move with the images.
- The task base image the pinned CLI names for T6's runtime.

**One weekly job, on a GitHub-hosted runner.** It extends the job 0135 T7 (b) proposes for the
identity provider, rather than adding a second one.

- **Trigger.dev:** the newest upstream tag that both images carry, against `managed.yml`'s pin. The
  job uses the same probe `trigger-version.sh list` runs; the probe is factored out, so that the
  script and the job share it.
- **ClickHouse:** the pin, against what Trigger.dev's `docker/docker-compose.yml` pins at the pinned
  tag and at the newest tag. It is "behind" only when upstream moved. On 2026-09-24 both pins
  matched at `v4.5.16` (§1).
- **MinIO:** there is no upstream to compare with, so the job scans instead.
- **A scan as well as a comparison.** `security-scan.yml`'s weekly scheduled run (line 25), which
  runs on `ubuntu-24.04` when not pushed to `main` (line 69), also runs a Trivy image scan of the
  pinned digests: the four images, and the task base image. A known vulnerability then shows even
  when no newer tag exists.
- **What it reports.** One issue per image, kept open while the image is behind or has an open
  high or critical finding, and closed when the pin moves. The repository is public, so the issue
  names a public image and a public version, and nothing about the machine.

**How fast to act.** There are no obligations to testers (D1), so this is the owner's own window,
not a promise.

- A security release in something a tester's request can reach (the identity provider, or the API's
  own dependencies) follows 0135's window: seven days is proposed there.
- ClickHouse and MinIO publish no port, and 0132 T3 binds Trigger.dev's two to loopback in both
  stacks. Once that has landed, a release for these three is read within a week and applied in the
  next drain window, by 0119 §3's route.

**Guard.** `scripts/a-pin-that-knows-it-is-behind.unit.test.ts` is the name 0135 T7 gives it, and
this task extends it. It fails today, because no watch exists. Given stubbed tag lists and a
stubbed upstream compose file, it checks that:

- Trigger.dev at `v4.5.16` is reported behind `v4.6.4` when both images exist, and current when the
  tags are equal;
- ClickHouse is reported behind when upstream's pin differs;
- every pin is read from `managed.yml`, not from a copy;
- the watched set equals the set of images `dependabot.yml`'s `docker-compose` block ignores by
  name. So a new ignore without a watch fails.

## 4. The alpha: the minimum, and what comes after

**Before the first invitation: T0, T2, T5, and T6's setting with its guard.**

- **T0**, because T2 needs a name.
- **T2**, because otherwise every tester's build reads `v0.1.0-rc.1 · <commit>`, the build of
  2026-08-04, and a report says nothing about the build. The drill from rc.1 is inside T2 because
  `release.md` requires it (open question 3).
- **T5**, because otherwise `ownpace-live` runs whatever was checked out last, and "which build was
  the tester on?" has no answer the owner can look up.
- **T6's setting and Guard 1**, because otherwise every tester's pass runs on Node 21, which no
  test covers.

For 0131 T5's go/no-go table, this plan's row is:

- the alpha tag exists, and its release is published with its images and SBOM;
- `ownpace-live`'s build stamp and `/api/version` name that tag's version and commit;
- if the report form is on at `ownpace-live` (0131 T5's row for 0130 allows an address instead),
  a problem report sent from there carries the build line;
- the tasks on `ownpace-live` were built on `node-24`: the task deploy's build output names
  `triggerdotdev/node:24-bookworm`, where run #193's named `node:21-bookworm`;
- T0's answers are written in this block.

As with the other rows, the owner may instead accept a gap in writing, dated, with the reason.

**Also before the first invitation, but carried elsewhere:** the identity provider's release watch
and response window (0135 T7).

**After the first invitation:**

- **T1**, unless it is ready before the tag;
- **T3**, as soon as the tag exists;
- **T4's** unit legs, by the next alpha tag;
- **T6's Guard 2**, the pull-request check that the task bundle loads;
- **T7's** sentence, best given with T0;
- **T8.**

## Not in this plan

- The second stack, its names and its deploy procedure: 0132.
- Backups, and whether a dump before a deploy becomes a rule: 0134.
- The identity provider's release watch and response window: 0135 T7.
- Being told when a watch opens an issue, or a scheduled gate goes red: 0142 T6, through GitHub's
  own notifications. A deploy to live is run by the owner, who reads its outcome (T5).
- Live proof of the sources, and the record of which tag each sitting used: 0141.
- The tester guide, which tells a tester where the build stamp is: 0144.
- The workplan index, whose line for 0025 still calls T6 *"the one open item"*: 0147.
- In-app guides a tester can use: W15, not planned yet.

## Open questions

1. **The name (T0).** `v0.2.0-alpha.1` (recommended), `v0.1.0-rc.2`, or another? And is every
   deploy to `ownpace-live` during the alpha a new `alpha.N` tag (recommended, since T5 deploys
   only tags)?
2. **Renames (T0).** None before the alpha, and none on a live stack after it (recommended, and what
   ADR-0040 already says)? Or is there a name the owner wants changed while it is still cheap?
3. **The drill from rc.1 (T2).** `release.md` requires it before a tag, and it has never run
   non-vacuously. It needs the reference machine for as long as the drill takes. Run it before the
   alpha tag (recommended), or tag without it and record the skip as a hole, since the alpha is
   managed-only and no tester runs the appliance?
4. **The checklist for `alpha.2` and later.** `release.md`'s full list for every alpha tag, or a
   short one: CI green, both unit upgrade gates executed, and the nightly gate green on the commit
   on the OTA stack? The short list is recommended for the alpha's fixes, and the full list for the
   tag that ends the alpha.
5. **The object store (T7).** (a) accept it for the alpha in writing, then (c) replace it after the
   alpha (recommended); or (b) replace it before `ownpace-live`'s first deploy?
6. **The task deploy's name (T5).** Keep `--external-id <tag>` if the self-hosted server records it,
   or leave the task plane's deployments unnamed and rely on the deploy log?
