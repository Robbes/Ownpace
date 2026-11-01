# Workplan 0146 — A release testers can name

> **In one line:** Cutting an alpha release after `v0.1.0-rc.1`: tag, version and changelog checks, the build in problem reports, `ownpace-live` deploying only tags, Trigger.dev tasks on Node 24, ending pre-release squashing, upgrade drills and the frozen MinIO image.

## Status — 2026-11-01 (update this block at the end of every session)

**2026-11-01: what merged for alpha.4 overnight, recorded (T1, T3, T4, T7, T16).** Docs only,
on the branch `claude/ownpace-public-readiness-y7orc6-e9-records`. Each pull request wrote its records as a draft, so
two entries below and five rows said *draft* or *not merged*; the rows say merged now, and the
entries' first lines name the merge.
- #1762, T7's MinIO digest `3b6e40c3…`, at 01:24 UTC (`db9e5c82`), after E2E (managed) run
  41240747301 on its branch.
- #1763, T16's npm and node-gyp's tree out of both Trigger.dev builds, at 01:48 UTC
  (`a94dd5b3`), after E2E (managed) run 41236579127 on its branch.
- #1766, T1's *since rc.1* part of `[Unreleased]` and T3 and T4's unit and Postgres legs, at
  02:13 UTC (`479f9230`).
- Merged the same night and recorded in their own plans: #1760 (0153 T5, 01:08 UTC), #1765
  (0140 T10, 02:41 UTC) and #1773 (0119, the Atlas pin, 04:13 UTC). Recorded in `CHANGELOG.md`'s
  `[Unreleased]` only: #1772 (the billing test, 00:40 UTC; a test-only fix, so nothing in 0121
  changes), its *Fixed* line, and #1771 (Dependabot's five npm updates, 00:53 UTC), its
  *Changed* line, which this entry's branch adds. `[Unreleased]` lacked #1771's line, and
  croner 11.0.0's (#1764, merged 2026-10-31), and held two *Added* sections; it has both lines
  and one *Added* now.

**2026-10-31, later: T1, T3 and T4's unit and Postgres legs built**, as draft #1766 on branch
`claude/ownpace-public-readiness-y7orc6-release-record-0146`, from `main` at `008fa74f`, not
merged then; merged 2026-11-01 at 02:13 UTC (`479f9230`). For alpha.4.

- **One file names the line (T3, T4).** `scripts/release-line.json`: `preReleaseEndedAt`
  `v0.2.0-alpha.1`, `releases` (rc.1 and the three alphas, in SemVer order) and, per chain, the
  oldest release an upgrade is still proved from (rc.1 for the ledger chain, alpha.1 for the
  managed one, the first with a managed chain). `packages/ledger/src/__tests__/release-line.ts` is
  the one reading of it the tests share. The fold adds the version it folds as the last of `releases`; until
  Release tags it, that entry is the release being prepared (`docs/release.md` §1).
- **T4, the unit legs.** Both unit gates, and the managed chain's new Postgres leg, start from
  their chain's oldest supported release and the newest release, or from `UPGRADE_FROM_REF`
  alone, which Release's preflight sets as before. Each starting point is a `describe` of its
  own, its two databases made and ended inside it. Read on the branch: the shared gate from rc.1
  and from alpha.3, the managed proof from alpha.1 and from alpha.3, 35 of 35 (from alpha.3 both
  say there is no migration to exercise; the shared chain is 65 files and the managed 59 at
  alpha.3 and on `main`). Until now a pull request proved rc.1 and alpha.1 alone.
- **T4, the Postgres leg.** `packages/managed/src/migrate-upgrade.integration.test.ts` runs the
  managed proof's database half on Postgres: the release's chains by the release's own
  migrators, then this build's, compared with a fresh install on every catalogue line, a
  further run, and the release's migrators refusing. The machinery both legs share moved,
  unchanged, from the unit file into `packages/managed/src/__tests__/upgrade-from-a-release.ts`,
  taking the release as a parameter (in `__tests__`, as `apps/api`'s helpers are, because the
  image guard reads every other file under `src` as runtime source). The integration job now checks out with `fetch-depth: 0`, as the unit
  job does. Run here against a local Postgres 16 (CI's is 18): 10 of 10; with
  `ALTER TABLE public.tenant ADD COLUMN …` appended to applied managed 0040, both legs red on
  `columns`, as expected.
- **T4's guard.** `scripts/every-release-is-a-starting-point.unit.test.ts`: the list in SemVer
  order, its end of pre-release and oldest releases from it; under `CI` every `v*` tag listed and
  every entry a tag but the one being prepared; the three gate files read their points from it;
  `startingPoints` on made-up lines. 13 of 13. Mutations, each red then restored: alpha.3 left out
  of the list; the managed gate's own default put back.
- **T3.** `squash-migrations.sh` refuses, exit 1, naming ADR-0045 and the tag, before it reads
  `ADMIN_URL`; its header no longer says a refused database must be dropped. ADR-0045's operative
  rule says pre-release ended with alpha.1 and both chains only grow, with a dated amendment, and
  `OPERATIVE.md` is regenerated. The runner's downgrade refusal names the two causes that remain
  (a build older than the database; a shipped file renamed or removed, a defect) and no squash;
  the shared gate's refusal case asserts that. `pnpm db:generate`'s refusal, `README.md`'s
  *Status* and `release.md` say it. The amendment and the guard's header say what the runner
  sees: its downgrade guard compares only a database's highest recorded name, so a missing
  newest file is refused, an earlier one removed goes unnoticed and one renamed is applied
  again (review of #1766).
- **T3's choice on comments.** T3 left the build to choose between (a) byte equality with managed
  0006 and 0008 put back to alpha.1's bytes, and (b) comments allowed. (a) as written cannot hold
  any more: #1650's notes in 0006 and 0008 shipped in alpha.2 and alpha.3, so alpha.1's bytes
  would now break theirs. Built instead: every file of either chain that a listed release from
  alpha.1 on shipped is still in the tree and byte for byte what the NEWEST such release shipped;
  against an older one it may differ in its comments alone, which the guard prints (0006 and
  0008, alpha.1 against alpha.3) and does not refuse. That is (a) from alpha.3 on, with no list of
  exceptions: a note added to a shipped file today is refused like any other edit. The managed
  upgrade proof keeps its comment-blind comparison, which this is stricter than. **The owner may
  prefer (b), or alpha.2 as the end of pre-release** (the tag the 2026-10-05 decision made the
  alpha tag, at which bytes hold with no history to explain); either is a one-line change.
- **T3's guard.** `scripts/a-chain-that-only-grows.unit.test.ts`, 14 of 14, 124 files compared
  with alpha.1, alpha.2 and alpha.3. Mutations, each red then restored: the squash script as on
  `main` (3); ADR-0045 as on `main` (2); a note added to managed 0059 (1); shared 0065 deleted
  (1); `migrate.ts` as on `main` (2, and the shared gate's refusal case). **Found on the way:**
  the first run of the squash-script mutation ran `main`'s script in place, under stubs that
  succeeded, and it squashed the working tree's shared chain (64 files deleted, the baseline
  rewritten from an empty dump; restored from git). The guard now runs a copy of the script in a
  temp tree laid out like the repository, with stubs that fail, and checks the copied chain is
  untouched.
- **T1.** The *since rc.1* part opens `CHANGELOG.md`'s `[Unreleased]`, so it becomes alpha.4's
  section at the fold: what the Alpha is, the sources proven or experimental as
  `SOURCE_PROOFS` reads on 2026-10-31 (the fold reads it again), the targets, signing in, silence,
  billing, the operator's Log page and problem report, and what is not in it. The pricing line
  and the *209 commits* introduction it names were corrected in alpha.1's section already. Its
  content is the owner's to read, and no guard checks it. After review: the owner lets each
  tester in from the access queue, and a grant link is what a tester sends the people they
  migrate (ADR-0035, ADR-0050), not how a tester gets in; *experimental* means not yet proven
  by a recorded run, since `SOURCE_PROOFS` notes an unrecorded run of *Via IMAP* and a
  measurement of the Microsoft 365 account's mail.
- **Not in this:** the container drill from the alpha tag, at the next release (`release.md`);
  `two-chains.unit.test.ts`, which still reads `UPGRADE_FROM_REF`; wiring `release-line.json`
  into Release's preflight.

**2026-10-31, later: npm and node-gyp's tree out of both Trigger.dev builds (T16, for
alpha.4), built as draft #1763, merged 2026-11-01 at 01:48 UTC (`a94dd5b3`)** on branch
`claude/ownpace-public-readiness-y7orc6-trigger-images-without-npm-and-node-gyp`, first from
`main` at `52f0275f` (v4.8.1), then with `main` at `5f160df5` and `008fa74f` merged in (v4.8.3,
#1755 and #1761), and at `db9e5c82` (below). The image scan of C (Security Scan run
41130684117, Trivy 0.76.1, linux/arm64, 2026-10-30) read
`localhost/trigger.dev:v4.8.1-d467cf5da6ef` at 1 critical, 137 high, 81 with a fix, and
`localhost/supervisor:v4.8.1-072042d10128` at 0, 25 and 25; #1755's (run 41159641513,
2026-10-31) read `localhost/trigger.dev:v4.8.3-b0cce1eaa578` at 1, 136, 80 and
`localhost/supervisor:v4.8.3-f44827c552a6` at 0, 25, 25.
- **What, measured on its parts.** No Docker here, and ghcr's blobs are refused, so the two
  trees were read on their own with the same Trivy. npm 11.19.1, which Node 24.22.1 bundles under
  `/usr/local/lib/node_modules/npm`, in `node:24.22.1-bookworm-slim@sha256:55fb5f5a…` (the FROM
  of upstream's runner stage) and `node:24.22.1-alpine@sha256:06d7adf3…` (the supervisor's),
  linux/arm64: brace-expansion 5.0.9 (CVE-2026-102276, CVE-2026-102278) and undici 6.28.0
  (CVE-2026-19534, CVE-2026-109383, CVE-2026-109869, CVE-2026-87018), six highs, each with a
  fix, the same in both. node-gyp's tree in pnpm 10.33.2 as npm published it, tar taken out as
  the builds already do, read with `trivy rootfs` at the copy's path: brace-expansion 2.1.0
  (CVE-2026-102276, CVE-2026-102278, CVE-2026-13149, CVE-2026-14257, CVE-2026-69152) and
  ip-address 10.1.0 (CVE-2026-69192), six more. What stays is code that runs: pnpm 10.33.2 itself
  (11 highs in each image), goose, the webapp's own packages and systeminformation.
- **Why nothing runs npm.** The webapp's entrypoint runs pnpm, goose, node and its own scripts;
  its migrations are `prisma migrate deploy`, `node scripts/migrate.mjs deploy` (which spawns
  prisma) and `node migrate.mjs` (drizzle, in process). The supervisor's entrypoint runs
  dumb-init with the CMD `pnpm run --filter supervisor start`, which is `node dist/index.js`.
  Both healthchecks are `node -e` fetch; the bring-up execs only `test` and `chown` into
  trigger-api, and nothing into the supervisor. In upstream's source at v4.8.1, and again at
  v4.8.3, the code the webapp runs spawns only `tar` and `rg` (the dashboard agent's repo
  tools), and the supervisor's spawns nothing. pnpm looks for npm in one place: @pnpm/npm-conf
  resolves it in a try, from Node's global folder, to read npm's builtin `npmrc`. Node
  24.22.1's npm carries none (its linux-arm64 tarball, and the Alpine image's layer, read), so
  without npm pnpm reads none, as before; only `pnpm doctor` says so. Corepack 0.36.0 is its own
  directory and stays.
- **Why nothing runs node-gyp's tree.** `dist/pnpm.cjs` and `dist/worker.js` bundle what pnpm
  itself runs. Outside `dist/node_modules`, pnpm 10.33.2's own files name three packages of it,
  each in a try: `pnpm.cjs` resolves `node-gyp/bin/node-gyp` at load, only to hand a package
  script its path as `npm_config_node_gyp`; its bundled fdir resolves `picomatch`, used only by a
  `glob()` nothing in pnpm calls (tinyglobby crawls with filters); and `bin/pnpm.cjs` requires
  `v8-compile-cache` only when `module.enableCompileCache()` answers nothing, which Node 24's
  never does, and from `bin/`, where no `node_modules` is. Run on Node 22.22.0 with
  `dist/node_modules` and `dist/node-gyp-bin` removed, pnpm 10.33.2's own files start, `pnpm
  --filter … exec` works, and `pnpm --filter … run` runs a script that sees no
  `npm_config_node_gyp` (with them: the path of node-gyp's `bin/node-gyp.js`); a script that
  calls `node-gyp` says `node-gyp: not found`. That is tar's risk again and the only one: a
  script that calls node-gyp, or an install that builds a native add-on, inside these
  containers. `pnpm exec`, the builds' proof, does not pass through pnpm's lifecycle code; the
  entrypoint's migrations and the supervisor's CMD are `pnpm run`s, which do, and E2E (managed)
  runs both.
- **The builds.** Each removing RUN, as root, before it removes anything: the kept copy's
  `dist/node_modules/node-gyp/bin/node-gyp.js` and `dist/node-gyp-bin` are there; every file of
  the copy outside `dist/node_modules` whose name ends in `js` names, by `require`,
  `require.resolve`, `import` or `resolveFrom`, exactly those three packages of it; npm's
  `package.json` says 11.19.1 and there is no `npmrc` beside it; `/usr/local/bin/npm` and `npx`
  are Node's links to `bin/npm-cli.js` and `bin/npx-cli.js`, and the only links in
  `/usr/local/bin` into npm's directory; corepack's `package.json` says 0.36.0. Then plain `rm`
  and `rm -r`, each path checked gone after, corepack 0.36.0 checked still there, and the
  existing proofs: as the service's user pnpm 10.33.2 starts offline and runs `pnpm --filter …
  exec node -e 0`, and as the other user it does not start. The checks ran on pnpm 10.33.2's
  real files under GNU tools and Alpine 3.24's busybox (amd64), and the link check on a tree
  laid out as Node's, which a third link into npm fails.
- **Guards.** `a-binary-the-stack-never-runs`: `REMOVED` has the kept copy's `dist/node_modules`
  (in place of its `tar`, which it holds) and `dist/node-gyp-bin`, npm and its two links, for
  both images, each with why and evidence. The stand-in tree has Node's npm and corepack with
  their links and node-gyp's tree with what pnpm's files name of it; run over it, each build
  removes exactly `REMOVED` and keeps corepack and its shims. Each new check fails, by name and
  before anything is removed, when its path is missing (npm, either link, corepack, node-gyp's
  bin, `node-gyp-bin`, `pnpm.cjs`), when a file of the copy names another package of the tree
  (`worker.js` requiring tar, an `import` of a scoped package's file, `pnpx.cjs` resolving
  brace-expansion) or stops naming one of the three, and when npm is another version, carries an
  `npmrc`, has a link that is not Node's or a third link into it, or corepack is another
  version. The shape test refuses each check dropped or moved after the first `rm`, and the
  corepack proof dropped. Mutations of the RUNs (npm not removed, the `import` form not
  searched, the search reaching into `dist/node_modules`, the link check loosened) each turn
  tests red.
- **v4.8.3, merged in.** #1755 landed first, so this branch merged `main`; both sides had changed
  the removing RUNs' files and the names. The merge keeps this branch's removals and checks and
  `main`'s FROMs (ghcr's v4.8.3 index digests) and `read_at=v4.8.3`; both headers cite the v4.8.3
  scan beside v4.8.1's, and the guard's new evidence and its two new tests read v4.8.3. Read
  again in upstream's repository at the v4.8.3 tag: `docker/Dockerfile` (its `NODE_IMAGE` still
  `node:24.22.1-bookworm-slim@sha256:55fb5f5a…`), `docker/scripts/entrypoint.sh`,
  `apps/supervisor/Containerfile` (still `FROM node:24.22.1-alpine@sha256:06d7adf3…`),
  `apps/supervisor/entrypoint.sh`, the root `package.json` (`pnpm@10.33.2`), the three migration
  packages' `package.json`, `run-ops-database`'s `scripts/migrate.mjs` (which spawns `prisma`)
  and `dashboard-agent-db`'s `migrate.mjs` are the same blobs as at v4.8.1;
  `apps/supervisor/package.json` differs in one devDependency (socket.io-client 4.7.5 to 4.8.4),
  and the supervisor's `src` still imports no `child_process`. The files of the webapp's tree
  that can spawn a process are the same six at both tags, and of them the webapp runs only the
  dashboard agent's repo tools; the 110 commits between add no `npm`, `npx` or `node-gyp`
  call. So npm 11.19.1, corepack 0.36.0 and pnpm 10.33.2's `dist/node_modules` and
  `dist/node-gyp-bin` are where the builds look, and each build checks every path before its
  `rm`.
- **Names.** `managed.yml` runs `localhost/trigger.dev:${TRIGGER_IMAGE_TAG:-v4.8.3}-0df1cbbe547c`
  and `localhost/supervisor:${TRIGGER_IMAGE_TAG:-v4.8.3}-d56a201c0e1f` (the guard's `sed`), so
  the next bring-up builds both. No upstream release or digest is taken; the FROMs are `main`'s,
  and neither the floor nor the v4.8.3 waiver is in question.
- **Measured on the branch.** The image scan dispatched there, against the scans above: at
  v4.8.1 (Security Scan run 41164463793 on `b0ba6280`, 2026-10-31 03:27 UTC) the webapp at 1
  critical, 126 high, 70 fixable (137 and 81 before: 11 fewer each), the supervisor at 0, 13, 13
  (12 fewer each), the webapp's baseline a day older and read with an older database; at v4.8.3
  (run 41233177801 on `ee023057`, 19:13 UTC, the same day as #1755's) the webapp at 1, 124, 68
  and the supervisor at 0, 13, 13, twelve fewer high and twelve fewer fixable in each, the one
  critical (zlib1g) unchanged. Each image is built in that run by the Dockerfile that checks every
  path before its `rm`, so the build proved them all at v4.8.3 on linux/arm64.
- **Proven on #1763 and the branch**, at `9e5c270e`. Images run 41233684732 passed `build
  (trigger, amd64)` and `build (trigger, arm64)`. E2E (managed) run 41236579127 was green
  (2026-10-31, 20:29–20:39 UTC; run 41235833275 before it was cancelled at 19:47). It built
  `localhost/trigger.dev:v4.8.3-0df1cbbe547c` and `localhost/supervisor:v4.8.3-d56a201c0e1f`
  from the pinned FROMs (`54aa67fa…`, `60808dde…`), and each build printed its proofs: the
  webapp's *"removed both names of depot and esbuild, node's copy of pnpm, node-gyp's tree from
  root's and npm; corepack 0.36.0 stays, and as root pnpm 10.33.2 starts and runs a workspace
  command offline"*, the supervisor's *"removed root's copy of pnpm, node-gyp's tree from node's
  and npm; corepack 0.36.0 stays"* and *"as node, pnpm 10.33.2 starts and runs a workspace
  command offline"*. Then *"all Trigger.dev services healthy"*, `trigger-api` and
  `trigger-supervisor` up and healthy under those names, and the verdict *"verify: done apply:
  applied"*, SMOKE PASS. So the entrypoint's migrations and the supervisor's CMD, both `pnpm
  run`s, ran without node-gyp's tree and without npm.
- **On `main` at `db9e5c82`.** The branch merged `main` again, at `e103699f` (#1764, #1758,
  #1752, #1753, #1757, #1759, #1756), at `ae64b64f` (#1772, the billing test's fix for the
  first hours of a month, which failed both integration jobs on the first merge), at
  `4a342e2d` (#1771's npm bumps), at `ae4ae13e` (#1760) and at `db9e5c82` (#1762, MinIO's
  digest). None of them touches either Dockerfile, the guard or the two services' lines in
  `managed.yml`; the CHANGELOG and 0119's Status entries kept both sides.

**2026-10-31: T16's two builds move to Trigger.dev v4.8.3** (0119's Status entry of that day,
issue #1738), before its three-day floor on the owner's waiver. Both Dockerfiles were read again
at v4.8.3: the entrypoints, `docker/Dockerfile`, the Containerfile, pnpm 10.33.2, @depot/cli
0.0.1-cli.2.80.0, esbuild 0.23.0 and dompurify 3.4.13 under posthog-js 1.407.3 and mermaid
11.16.1 are v4.8.1's, so every removal and the dompurify 3.4.17 swap stay, `read_at` is v4.8.3,
and the names move to `-b0cce1eaa578` and `-f44827c552a6`. The guard's fixtures read v4.8.3.
On #1755 `build (trigger, amd64|arm64)` (Images run 41159761482) proved every path and check at
v4.8.3 on both platforms, and the image scan (Security Scan run 41159641513) read the webapp's
build at 1 critical, 136 high, 80 fixable (1, 137, 81 at v4.8.1) and the supervisor's at 0, 25, 25.

**2026-10-30/31: `v0.2.0-alpha.3` is released, its nights waived, and live runs it (T2, T5,
T13, T16).** Read from GitHub on 2026-10-31, and from the owner's record of live's deploy (0132
Status, 2026-10-31). Times are UTC.

- **The waiver merged** as #1741 (`7e2fbbbe`), from the branch of the entry *the owner waives
  the counted nights for alpha.3*, below. Decision 9 is amended for `v0.2.0-alpha.3` only, by
  the owner's answer of 2026-10-30, and 0141 T14 says so.
- **After the fold** (#1739, `3a15c74d`), alpha.3 took four more: #1741 (`7e2fbbbe`); #1743
  (`04a5374b`), the site's search metadata (0152 T5 (c)); #1742 (`2a1666ae`), dompurify (T16);
  and #1740 (`e1b21aac`), the Docker socket proxy built here (0119). C is `e1b21aac`. On it, all
  green: CI run 41054716023 (#5004, the full suite), Security Scan run 41054716031 (#5043),
  Images run 41054716035, E2E (managed) run 41054735625 (#316) and E2E (self-hosted) run
  41056013045 (#316).
- **Release.** A preflight with the waiver on `7e2fbbbe` (run 41038773714, #14) refused
  nothing, and so did the one on C (run 41066007586, #15). Release run 41066208430 (#16), mode
  `release`, with the waiver, was dispatched at about 13:48 UTC on 2026-10-30 and waited at its
  approve job until the owner approved, about 21:00 UTC (the job ran at 21:03). Then the gate
  scan of C (Security Scan run 41128089460), the tag, the publishing (the scan on the tag, the
  images and the Windows zip) and verify all succeeded, the last at 21:09:52 UTC. The release
  is a pre-release with `bom.json` and the Windows zip.
- **The tag.** `v0.2.0-alpha.3` is tag object `b0d01c09…` on `e1b21aac`. Its message has the
  lines *Release run: https://github.com/Robbes/Ownpace/actions/runs/41066208430* and *Nights
  waived by Robbes, in their words: "I approve alpha.3 tag now, we skip the waiting days. No one
  is in the alpha yet."*, the acceptance 0132's deploy log cites.
- **Live (T5, T13, T16).** The owner deployed it on 2026-10-30 in the two runs T13 needs. The
  dry run said one-way, its reason *cannot be compared … on the Trigger.dev pin*, a take with
  `triggerdb`. Run 1, alpha.2's script, took the copy (6 files, `triggerdb` among them) and
  did not take at 23:34:53 UTC, on the `NODE_ENV` line alone, as expected. Run 2, the tag's own
  script, said *v4.7.6 -> v4.8.1* and *the deploy took* at 23:44:35 UTC, which it says only once
  `/api/version` and `/version.json` both name the tag's version and commit. After it: no
  container unhealthy, starting or restarting; the supervisor at v4.8.1; the task deployment's
  row `current|20261030.2|DEPLOYED|4.8.1|4.8.1|24.22.1|2026-10-30 23:44`; the tick
  `COMPLETED_SUCCESSFULLY` on 4.8.1. The hold was lifted at about 23:57 UTC.
- **The copy the entry *T16 moves into alpha.3 too* keeps was not kept.** The owner set
  `COPY_DELETE_WHEN_PROVEN=false` right after run 2, and then chose to remove that copy too
  (*"After successfully done that, we remove alpha 2"*): it went by hand early on 2026-10-31,
  and the key went back to `true`. The copy taken before alpha.2 had gone by hand before the
  deploy. No migration has run on live. So live's way back from alpha.3, the images built here
  included, is forward only: a fix, a pull request with E2E and a tag (T5, *Rollback, stated
  plainly*; T16's *Dropping them*).
- **The owner's readings on live, 2026-10-29, on alpha.2:** `/api/version` and `/version.json`
  both `0.2.0-alpha.2` `f62bcbe2`, PASS for those two. Not recorded: the build stamp in the
  sidebar, the task deploy's build output, and a problem report from live carrying the build
  line.
- **Superseded:** the entries below that wait for two counted nights on C (*the earliest is the
  E2E (managed) nightly of 2026-11-01*) and that date live's deploy after alpha.2's copy
  expires, about 2026-11-02 19:56 UTC.

**2026-10-30, after the fold: the webapp built here carries dompurify 3.4.17 (T16, an alpha.3
addition)**, on branch `claude/ownpace-public-readiness-y7orc6-webapp-dompurify`, from `main` at
the fold. It goes into alpha.3: after the fold, the owner chose on 2026-10-30 to put this and
0152 T5 (c) into alpha.3 rather than start alpha.4 with them. It merges after CI and E2E
(managed) on its branch. Its CHANGELOG line stays under `[Unreleased]` until it is moved into
alpha.3's section, which Release's preflight needs before C is tagged; #1741 and #1743, the
other alpha.3 additions, moved theirs in their own pull requests. A Security Scan dispatched
on the branch at the fold's tree (run 41004468330, Trivy 0.76.1, linux/arm64) read 2 critical
and 138 high findings in `localhost/trigger.dev:v4.8.1-38e6d59739c6`: zlib1g (CVE-2023-45853,
no fix in Debian), and GHSA-cg2g-xh64-v4q7 in dompurify 3.4.13, fixed in 3.4.17, in
`node_modules/.pnpm/dompurify@3.4.13/node_modules/dompurify/package.json`.
- **Who requires dompurify, read at v4.8.1.** Upstream's `pnpm-lock.yaml` names two packages:
  posthog-js 1.407.3, which `app/hooks/usePostHog.ts` imports, and mermaid 11.16.1, through
  streamdown 2.5.0, the dashboard's markdown. Neither path loads it. posthog-js's entry points
  (`dist/main.js`, `dist/module.js`) carry no DOMPurify; its one `require('dompurify')` is in
  `lib/src/extensions/product-tours`, which no entry point loads. The browser takes product
  tours from PostHog's own host once PostHog starts, and `POSTHOG_PROJECT_KEY: ""` keeps it from
  starting. streamdown 2.5.0 imports no mermaid: it draws a diagram only through the
  `@streamdown/mermaid` plugin, which the webapp neither installs nor passes. Nothing in the
  webapp's source, its internal packages or its packages imports dompurify or mermaid. So the
  earlier records' *which mermaid loads, and the dashboard may run* is corrected: no process of
  this stack loads dompurify. posthog-js's `dist/product-tours.js` bundles DOMPurify 3.3.2 into
  its own file; Trivy does not read it, and nothing here serves it.
- **What 3.4.14 to 3.4.17 change.** npm lists five advisories against 3.4.13 and none against
  3.4.17: GHSA-cg2g-xh64-v4q7 (critical: with `SAFE_FOR_TEMPLATES`, template expressions split
  across nodes survive in an attached shadow root's content, in the DOM output modes; up to
  3.4.16), GHSA-mrv2-3pqr-j5jr (high: `IN_PLACE` with a hook that removes a parent or sibling;
  up to 3.4.16), and three lows. Read in the two published tarballs, each checked against
  npm's integrity (no release notes were reachable from here). The 24 file names are the same.
  The entry points and exports (`main`, `module`, `browser`, `types`, `exports`) are unchanged,
  and `require()` of either CJS build gives the same keys. `package.json` differs only in the
  version, its scripts and its devDependencies (rollup became rolldown). The type declarations
  differ in the order of one import, and the CJS ones drop `export { _default as default }`
  and keep `export = _default`. The code changes are in `src/purify.ts`'s sanitising
  internals (the fixes), the helpers `src/utils.ts` adds for them, and `src/attrs.ts`, which
  allows two more SVG attributes, `pointer-events` and `vector-effect`. npm published 3.4.17 on
  2026-10-12 12:41 UTC, 18 days ago, and it is `latest`.
- **The build, in the style of the removals.** A third RUN in
  `deploy/compose/trigger.dev/Dockerfile`, as root, after the removing one. Before it changes
  anything it checks the package is the published 3.4.13 file for file (`from_tree`, the
  SHA-256 of `sha256sum` over its files sorted by path); that only posthog-js's, mermaid's and
  pnpm's hoisted link lead to it; that no other `dompurify/package.json` is in the image; and
  that nothing under `apps/webapp/build` or `apps/webapp/public` carries DOMPurify (its
  trusted-types attribute, `data-tt-policy-suffix`) or imports dompurify or mermaid by name. It
  fetches `dompurify-3.4.17.tgz` from the npm registry and refuses it unless its sha512 is
  `sha512-B/pSlYVH…`, the integrity npm published; unpacks it apart and checks it against
  `to_tree`; gives it the old directory's owner; and swaps the directory. Then it proves the
  directory is `to_tree`; that no other path in the image was added or removed and no other
  file's change time moved since a marker made before the fetch; and that from posthog-js's and
  mermaid's own directories `require('dompurify')` and `import('dompurify')` both load 3.4.17
  from it. Nothing the webapp's server starts with imports either package, so that is as far
  as module loading goes. One input is new: the machine reaches the npm registry when it builds
  the webapp's image, as it already does for the API's.
- **Guards.** `a-binary-the-stack-never-runs` holds a `REPLACED` table equal to what the RUN
  names (both versions, the address, the integrity, both trees, both requirers, past the
  floor), holds the RUN's order (each check before the swap, each proof after it, as root,
  before upstream's `USER node`), and runs it over the stand-in with a stand-in registry. It
  swaps the package and nothing else. Nineteen ways upstream or the registry could differ fail
  it with nothing changed, among them a link inside the old package or in the tarball, which
  the trees (files only) do not see, and a grep that exits 2, which is not "none found". The
  new files are given the old `package.json`'s owner: `stat` and `chown` are stood in for,
  since every file of the stand-in has one owner. Each proof after the swap fails on the change
  it is there to see: a file written, a path added, a link outside the package made again, a
  CJS or ES build that says another version, a `require` or `import` entry that is another
  file, and a requirer that resolves a copy of its own through a link the checks before the
  swap do not read. `managed.yml`'s name moves to `-d467cf5da6ef`. Thirty-seven mutations of
  the replacing RUN, each run with `managed.yml`'s name moved to the mutated file's hash so
  that the two name tests do not count, each turned at least one test red, and a line that
  does nothing turned none (the list and counts are in #1742).
- **Proven on the real image, on both platforms** (no Docker daemon here, so on GitHub's
  runners). Draft #1742's `build (trigger, amd64)` and `build (trigger, arm64)` are green on
  `0f2ae9fd`: every check before the swap held on upstream's image (the published 3.4.13 file
  for file, the three links, one `dompurify/package.json`, no DOMPurify and no import of
  dompurify or mermaid in the webapp's build), the tarball's sha512 was the published one, no
  other path or file of the image changed, and the log reads `require(dompurify):
  …/dompurify@3.4.13/node_modules/dompurify/dist/purify.cjs.js 3.4.17` and `import(dompurify):
  …/dist/purify.es.mjs 3.4.17` from each of the two requirers. The Security Scan dispatched on
  the branch at `0f2ae9fd` (run 41015259996) read `localhost/trigger.dev:v4.8.1-d467cf5da6ef`
  as **1 critical, 137 high**, 81 with a fix (2, 138 and 83 before, run 41004468330): the one
  critical left is zlib1g, CVE-2023-45853, which Debian has not fixed, and GHSA-mrv2-3pqr-j5jr
  went with GHSA-cg2g-xh64-v4q7. The supervisor reads 0 and 25, unchanged. E2E (managed) on
  the branch: run 41050861489 was green (the new image healthy, the smoke passed), and it merged as
  #1742 (`2a1666ae`).
- **The review of 2026-10-30** found four things, and each held when checked again. The
  records called this a draft for alpha.4, after the owner had put it into alpha.3, and T16's
  done-condition still read 2 and 0; it is an alpha.3 addition now, and 1 and 0. Seven of ten
  mutations of the replacing RUN left the guard's 30 tests green: the `require` proof without
  its version or its path check, the `import` proof without its path check, the `chown`
  dropped (every file of the stand-in had one owner, so the owner assertion held either way),
  the check that the old package holds only files and directories dropped, grep's exit 2 taken
  for "none found", and the change-time proof reading files only, which misses a link. The
  first build's counts (*at least 3 red*) also counted the two `managed.yml` name tests, which
  any change to the RUN turns red. The tarballs' comparison said more was equal than is (above).
  And the header still waited for the upstream issue's address, triggerdotdev/trigger.dev#5084.
  The RUN does not change, so the image's name, the builds and the scan above stand; the guard
  has the cases that catch each of the seven (Guards, above), and the header, `REPLACED` and
  these records say what the tarballs hold.

**2026-10-30, latest: the owner waives the counted nights for alpha.3, and Release can take
it (built as a draft, reviewed once).** The owner, 2026-10-30: *"I approve alpha.3 tag now, we
skip the waiting days. No one is in the alpha yet."* Release could not do that: its preflight
and its tag job refuse a commit the nights do not hold for, and the only way past was a tag
pushed by hand, the unordered path that broke alpha.1 (`docs/release.md` §2). Built on branch
`claude/ownpace-public-readiness-y7orc6-release-nights-waiver`, as a draft pull request:

- **`waive_nights`**, a new input of the Release workflow: the owner's reason, in their words.
  Empty is today's behaviour. **Set, it is taken only for a version in `WAIVER_VERSIONS`**
  (`scripts/release-nights.mjs`): `v0.2.0-alpha.3` alone, the version the owner named, and the
  guard holds that each listed version is a pre-release. A later waiver is a pull request that
  adds its version with the owner's words. **And only from a person's account:** a run whose
  actor is an app's bot is refused, since the tag would credit the owner's words to it.
- **Taken,** in preflight, rehearse and release mode the nights are read as always, and if they
  do not hold their refusals are notes, the first quoting it and naming the run's actor. The
  commit must be given: a waiver with `commit` empty is refused. The tag's message has a line
  of its own after *Proved by*, `Nights waived by <actor>, in their words: "<reason>"`, the
  reason a JSON string, and the summaries of the preflight and the tag job say it too.
  `verify` and `rehearse-tag` read no nights and refuse a waiver.
- **The tag job is bound by the preflight:** the check step's output `waived` reaches it as
  `PREFLIGHT_WAIVED`. When the nights held at the preflight, its summary says the waiver was
  not used, and the tag job reads the nights again as a run without one would, refusing if they
  stopped holding. A run that refused before it read the nights says so, and never that they
  were waived.
- **Nothing else is waived:** C on `main`'s first-parent line, the tag free, the names, the
  version, the changelog fold, C's push runs of CI (the whole suite) and Security Scan, the
  callees, the upgrade gates, the gate scan and the approval in the `release` environment.
- **The text is read as hostile:** one line, at most 300 characters, with a letter or a digit,
  and no backtick, `<`, `$(`, `${`, `@`, control character or character that shows nothing
  (private use, unassigned, a lone surrogate, a Hangul filler, the braille blank). A refusal
  says why and does not repeat it, and the text reaches the scripts through `env:` only. The
  preflight is no boundary against C's own code, which runs in its job before the check and
  the verdict; the tag job, a job of its own, reads the input itself.
- **It amends decision 9** of 2026-10-23 (*no override input*, below), and 0141 T14 says so.
- **The review of 2026-10-30** found eight things, and each held when checked again: the waiver
  worked for any version, stable ones included; the preflight said "not used" while the tag job
  would still use it; a blank-looking text (a Hangul filler, the braille blank, a private-use
  character, a lone surrogate) was taken; a `"` in the words could end the tag's quote; a run
  that refused before reading the nights said they were waived; a comment called the verdict
  step's env out of the candidate's reach; the CHANGELOG said "the release says so" where only
  the tag does; and a bot could be named as the waiver's author. All eight are fixed as above.
- **Proven on the branch:** the unit project, 1077 files, 16173 tests passed and 33 skipped;
  lint, typecheck, the conflict-marker check and both index checks. The three guards
  (`a-release-preflight-that-said-yes-too-soon`, `a-tag-that-already-pointed-elsewhere`,
  `a-tag-cut-only-on-green`) run the resolve, check, verdict and tag scripts as the workflow
  does: a command in the text is refused and makes nothing; the check step's output says
  whether it used the waiver; and the tag script, against a scripted API with no nights on
  record, posts the tag with the waiver's line and writes the summary when the preflight used
  it, and refuses and posts nothing when it did not. Each of 40 mutations of the first build
  and 25 of the review's fixes turned one of them red. Not run: the workflow itself (no
  dispatch from a branch).
- **For alpha.3:** C is the fold's squash, `3a15c74d` (#1739), or a later re-fold, which then
  folds this pull request's CHANGELOG line into alpha.3's section too: the preflight refuses a
  commit with a line under `[Unreleased]`. Release runs `main`'s copy of its scripts, so this
  merges first. C's own push runs on `3a15c74d` are green: CI #4983 and Security Scan #5020; a
  re-fold needs its own. Then the owner, from their own account, dispatches Release with
  `version` `v0.2.0-alpha.3`, `commit` C in full, `waive_nights` in their own words, first
  `mode=preflight`, then `mode=release`, and approves. That replaces the next entry's *"The
  earliest is the E2E (managed) nightly of 2026-11-01"*. The freeze kept the nights on C; with
  them waived, a merge after C costs only the note that counts the commits on `main` after it.

**2026-10-30, last: alpha.3 is folded.** Six pull requests merged on 2026-10-30, each after CI,
and each that changes what a stack runs after E2E on its branch:

- #1729 (0095 T6), the grant mail's link opens registration with the address filled in,
  `01779831`, E2E (managed) #307;
- #1736, pnpm 11.28.9, `70d44346`, CI only;
- #1722 (T16), Trigger.dev's webapp and supervisor built here, `30533c7f`, E2E (managed) #308;
- #1737, Trigger.dev's Redis 7.4.12, `2e42dae5`, E2E (managed) #309;
- #1732, the demo's Nextcloud 35.0.2 rebuild, `9c341f62`, E2E (managed) #310 and E2E
  (self-hosted) #314;
- #1733, the status page's Gatus v5.38.0, `0f18b51b`, E2E (managed) #311.

The fold moves `package.json` and the API contract to `0.2.0-alpha.3` and everything under
`[Unreleased]` to `## [0.2.0-alpha.3] - 2026-10-30`. Its squash is C, and `main` takes nothing
else until the tag. The tag needs two scheduled E2E (managed) runs on C, at most 30 hours apart,
and four scheduled E2E (self-hosted) runs on C between C reaching `main` and the newer of the two
(`scripts/release-nights.mjs`). The earliest is the E2E (managed) nightly of 2026-11-01. Then the
Release workflow (mode `release`) waits for the owner's approval in the `release` environment.
That replaces the 2026-10-29 entry's dates (Redis after its floor, the tag about 2026-11-02/03).
Live's deploy of the tag still waits for alpha.2's copy to go, about 2026-11-02 19:56 UTC, and
runs twice, and keeps the copy taken before it (the entries below). MinIO's newer `latest` (the pin watch,
issue #1671) is a rebuild with no finding to clear, three days old on 2026-11-01 03:00 UTC, so it
goes into alpha.4.

**2026-10-30, later: T16 (#1722) moves into alpha.3 too.** The owner: *"Can you put all in
alpha 3?"* and *"Put all alpha 4 into alpha 3."* T16 was the one item left for alpha.4 (#1729
moved first, below); nothing else queued for alpha.4 is built. It merges before the fold, after
CI, the built images' scan and E2E (managed) on its branch. That supersedes *Alpha.4 keeps
T16* below, the 2026-10-29 entry's *Alpha.4* item and *Left for alpha.4: T16*, and T16's row now
reads alpha.3. What changes for live's deploy from alpha.2:

- **The first run is judged by alpha.2's script**, which compares image lines, not versions
  (T16a is in alpha.3, not on live yet). It still says one-way and the copy still takes
  triggerdb (`--trigger`), as the move from v4.7.6 to v4.8.1 needs anyway; only the reason line
  changes, to *cannot be compared … on the Trigger.dev pin*. The second run, the tag's own
  script, says *v4.7.6 -> v4.8.1*. Upstream adds no migration between the two versions (0119
  Status), so a way back to alpha.2 has no schema to undo.
- **The images are built on the machine the first time a stack needs them**, from ghcr's v4.8.1
  by index digest (no Docker Hub, no npm). The OTA's E2E and nightly build them on the shared
  daemon first, so live normally finds both names and builds nothing.
- **No release on live runs ghcr's v4.8.1**, so a fault only the built images have has no
  same-version way back: the copy before the update (back to all of alpha.2, triggerdb
  included) or a fix forward (*Dropping them*, a pull request with E2E and a tag). So the
  owner's deploy keeps that copy: right after the second run says *the deploy took* and before
  *live-pass-check.sh*, `COPY_DELETE_WHEN_PROVEN=false` in live's `.env` (the bring-up guide,
  *The deploy from alpha.2 to alpha.3 runs twice*). It is deleted by hand once the task runner
  has run real work for a few days, and the key goes back before the next deploy.

**2026-10-30: #1729 (0095 T6) moves into alpha.3.** The owner, 2026-10-30: *"I want #1729
earlier."* The grant mail's link that opens registration with the address filled in merges
before alpha.3's CHANGELOG fold, after CI and E2E (managed) on its branch; the entry below that
names it for alpha.4 is superseded. Alpha.4 keeps T16 (#1722).

**2026-10-29: alpha.3's tag and live deploy, dated; what waits for alpha.4.**

- **Alpha.3.** The owner's decision of 2026-10-28 still holds (below): Redis 7.4.12-bookworm
  once its floor ends, 2026-10-31 06:05 UTC; then the CHANGELOG fold, two counted nights and the
  tag, about 2026-11-02/03. Live's deploy of the tag waits until alpha.2's copy before the
  update is gone: it is not proven, since no migration has run on live and so no pass has, and
  unless one runs and succeeds first it expires at the daily duties' first run after about
  2026-11-02 19:56 UTC (0132 Status, 2026-10-29). The deploy runs `deploy-live.sh` twice (T13), with
  `TRIGGER_IMAGE_TAG=v4.8.1` set first and `COMPOSE_PROGRESS=plain` on the first run, as the
  bring-up guide's *The deploy from alpha.2 to alpha.3 runs twice* says.
- **Alpha.4.** T16, #1722. The owner has filed the upstream issue for what it patches,
  triggerdotdev/trigger.dev#5084 (the owner's checklist of 2026-10-26, L7). Also #1729, a draft for 0095 T6: the grant
  mail's link opens registration with the address filled in. It follows the owner's decision of
  2026-10-29, which also accepts the sign-in service's `login hint invalid` info line; 0095 on
  that branch records it.

**2026-10-27, later: T16's review, and tar out of the copy of pnpm each service runs** (same
branch, still a draft for alpha.4).
- **The owner's second decision, 2026-10-27**, asked with the risk stated: remove tar 7.5.13
  (CVE-2026-59873) from the copy of pnpm 10.33.2 each service *keeps* too, so the webapp goes
  from 8 critical findings to 2 (zlib1g, no fix in Debian; dompurify via mermaid) and the
  supervisor from 2 to 0. Re-read here before building it: in the published pnpm 10.33.2 (its
  sha512 the registry's) the one `require('tar')` in `dist` is the bundled node-gyp's
  `lib/install.js`, which downloads and unpacks Node's headers for a native build; `pnpm.cjs`
  and `worker.js` name no tar (they bundle tar-stream). node-gyp runs only when a package script
  calls it or an install builds a native add-on; the webapp's entrypoint runs three migration
  scripts through pnpm and the supervisor's CMD runs `node dist/index.js` through pnpm, and
  neither installs. Corepack is **0.36.0** in Node 24.22.1 (not 0.34.0, as recorded before; the
  records are corrected), and its `installVersion` reuses a copy by its `.corepack` file alone,
  so the copy without tar runs as it is and is never fetched. The environment's own pnpm
  (10.28.0, the same layout), copied without tar, ran `--version`, a workspace script and
  `--filter … exec` offline. **The one risk, accepted:** a `pnpm install` inside these
  containers that builds a native add-on would fail; nothing there installs. Each build tests
  the directory, checks node-gyp's `install.js` is still the one file of the copy requiring
  tar, removes it with a plain `rm -r`, and proves pnpm starts and runs `--filter <its package>
  exec node -e 0` offline as the service's user (root for the webapp, node for the supervisor;
  the final `USER` stays upstream's node). The kept copies stay where they were: the webapp
  keeps root's (`trigger-api` runs `user: root`), the supervisor node's.
- **The review, sixteen findings, each checked; all held and are fixed.** (1) A blocker:
  `pnpm -s typecheck` failed on the branch (an `as const` was missing in
  `an-image-nobody-scanned`). (2) *A release nobody read*: the depot and esbuild paths are the
  same in 4.7.6, 4.8.0 and 4.8.1, so a move re-proved paths, never that nothing reaches them;
  each removing RUN now names `read_at=v4.8.1`, refuses any other version before it removes
  anything, and the guard holds `read_at` to the FROM, so `pin` leaves a move red until someone
  reads the reasons again. (3) *Who runs pnpm is upstream's too*: each RUN pins the entrypoint
  it was read with by SHA-256, and `build (trigger, …)` checks the base's user, command and
  entrypoint are the ones read, before it builds. (4) The guard of that job read its text only;
  it now runs the step under bash with a stub docker and sees each refusal stop it. (5) The way
  back: `restore` and `pin` said to put the old tag back or pin the old version, which builds
  this checkout's Dockerfile at a version it refuses; both, the bring-up's drift check and
  *Upgrading Trigger.dev* now say to run the checkout that pinned that version (a revert, or the
  release tag before), never a `pin` backwards. (6) Order: the builds' proof now comes before
  the drain, the backup and any `.env` change, in `pin`'s steps, the pin watch's issue and the
  upgrade order; a T35-style step for a future move waits on `build (trigger, amd64)` and
  `(arm64)` green. (7) `pin` no longer stops half-way, `list` shows the build and not only the
  version, the depot gate is `DEPOT_TOKEN` and `DEPOT_ORG_ID` (`DEPOT_REGION` has a default),
  the `.env` no longer "chooses" the version (it names it, and must equal the checkout's), and
  the scan's headers name these builds. (8) **live's verdict at alpha.4 depends on alpha.3**:
  the verdict is computed by the previous checkout's `deploy-live.sh`, so `4628488b` (the
  reader of the Trigger.dev pin as a version) must reach live in alpha.3, as its own pull
  request: T16a below. Without it, alpha.3's script says alpha.4 is one-way ("cannot be
  compared … on the Trigger.dev pin") and copies triggerdb too; that is conservative, and
  alpha.3 stays a way back all the same (a rollback run from alpha.4's checkout compares the
  version, and says reversible).
- **Proven here:** every guard named, the new cases each seen to fail on the mutation it names
  (the tar removal dropped, its proof dropped or run as the other user, `read_at` and the
  entrypoint check removed, five mutations of `images.yml`'s step, the half-move, the restore
  text, the step order, the drift remedy). **Not proven here** (no Docker daemon; ghcr's blobs
  unreachable): the builds themselves. The draft's `build (trigger, amd64|arm64)` does that
  first, including the expected base configuration (`"node" ["./scripts/entrypoint.sh"]
  ["docker-entrypoint.sh"]` and `"node" ["pnpm","run","--filter","supervisor","start"]
  ["/app/entrypoint.sh"]`, read from upstream's Dockerfiles, not from the images) and the two
  entrypoint hashes; then a dispatched image scan (expected 2 and 0), then E2E (managed).

**2026-10-27: T16, the Trigger.dev webapp and supervisor built here without the files nothing
runs, as a draft for alpha.4**, on branch `claude/ownpace-public-readiness-y7orc6-trigger-patched`.
It is stacked on #1716 (and so #1697), with #1717 (and so #1678) merged in, because it builds the
way #1717 builds the managed Postgres. Not merged; the draft pull request names all four.
- **The decision.** The owner, 2026-10-26, on the weekly scan's critical findings in Trigger.dev
  v4.8.1 (Trivy 0.76.1, linux/arm64): *"Both"*. The owner files an issue upstream (drafted;
  its address goes into both Dockerfiles' headers once it exists), and this build deletes only
  files that never run in this stack, until upstream ships the fixes.
- **What goes, read from source:** upstream at v4.8.1, and the published `@depot/cli`
  0.0.1-cli.2.80.0, `esbuild` 0.23.0, their four platform packages and pnpm 10.33.2, each
  tarball's sha512 the lockfile's.
  - depot's Go binary (3 criticals). Loading `@depot/cli` only defines functions; the binary is
    looked up inside `depot(...)`, whose one call is the `depot push` of
    `finalizeDeploymentV2.server.ts`, reached only with `DEPOT_TOKEN` and `DEPOT_ORG_ID` set
    (`DEPOT_REGION` has a default). trigger-api sets neither, and `a-service-that-phones-home` refuses the
    token. The webapp loads the package at start (the finalize routes import it), which is
    harmless without the binary.
  - esbuild 0.23.0's Go binary (1 critical), spawned only by a build, transform or context
    call. It is installed because the `trigger.dev` CLI (`packages/cli-v3`) depends on it, and
    the CLI enters the webapp's pruned `pnpm install --prod` through
    `internal-packages/dashboard-agent`'s devDependency `"trigger.dev": "workspace:*"`; nothing
    in the image calls it. tsdown and tsx are not in the production set at all, so the
    upstream draft's item 3 was corrected.
  - The copy of pnpm the service's user does not run (1 critical in each image, tar 7.5.13).
- **Two premises corrected.** (a) *Which copy of pnpm is unused.* trigger-api runs
  `user: root` (`managed.yml`), so HOME is `/root` and every pnpm of the entrypoint runs root's
  copy: the webapp's build removes node's copy and keeps root's. trigger-supervisor has no
  `user:`, so it is the other way round. Deleting root's copy in the webapp, as first briefed,
  would have made corepack download pnpm (and an unscanned tar) from the npm registry at every
  start. The targets stayed 8 to 3 and 2 to 1 (2 and 0 since the later entry). Both services now set
  `COREPACK_ENABLE_NETWORK: "0"`, so a mismatch fails the start rather than fetching. (b) *Two
  names per binary.* Each postinstall hard-links the platform binary over its package's
  `bin/` shim, the layer stores the second name as a tar hard link, and Trivy 0.76.1's walker
  skips hard links, so the scan reported one path per binary. Both names go, and the build
  checks that every one starts with ELF's magic first.
- **The build.** `deploy/compose/trigger.dev/Dockerfile` and `deploy/compose/supervisor/Dockerfile`:
  one FROM each, upstream's image by `v4.8.1` and index digest (`bcce9e8f…` and `9907be3e…`,
  read from ghcr's manifests on 2026-10-26 and again on 2026-10-27); `ARG TRIGGER_IMAGE_TAG`,
  which only refuses a `.env` naming another version than the image's `@trigger.dev/core`;
  FROM, ARG, USER and RUN only, `USER node` last. Every path names a version: the build
  refuses another packageManager than `pnpm@10.33.2` or a platform other than linux-arm64 or
  linux-x64, tests each path before a plain `rm`, fails if any `depot` or `esbuild` under
  `node_modules/.pnpm` is still an ELF, proves both packages still load, and proves pnpm
  starts offline as the service's user and refuses as the other. `managed.yml` then ran
  `localhost/trigger.dev:${TRIGGER_IMAGE_TAG:-v4.8.1}-72939d99d1b8` and
  `localhost/supervisor:${TRIGGER_IMAGE_TAG:-v4.8.1}-8d594a98a98b` (-38e6d59739c6 and
  -072042d10128 since the later entry, whose removals changed the instructions) (#1717's hash rule), built
  from `./trigger.dev` and `./supervisor` with the version as their one argument,
  `pull_policy: never`. Checked with compose 5.6.1's `config`: unset, `v4.8.1` and `v4.9.0`
  in `.env` give the names and arguments meant.
- **The version mechanism is kept.** Still exactly two `${TRIGGER_IMAGE_TAG:-v…}` defaults,
  so the drift check, `repo_tag`, the bring-up's test, the pin watch and the runbook read what
  they did; checklist steps T15 and T35 are unchanged for this draft (a T35-style step for a
  future move waits on both builds green: the later entry). `trigger-version.sh pin` now asks
  ghcr for both tags' index digests (`tag_digest`, an index or manifest list only; run here
  against ghcr: both v4.8.1 digests, and a refusal for a tag that does not exist), moves both
  FROMs and writes the new hash into both names; a dropped directory is skipped. `list` reads
  the running tag without the hash. The pin watch's Trigger.dev row fails when a Dockerfile's
  FROM is not the pin, and its issue says what to do with the builds on a move.
- **Live.** `deploy-live.sh` reads the Trigger.dev pin as the version (`trigger_pin`), not the
  image lines: a change to the builds alone, and ghcr's image replaced by the build at the same
  version, are reversible and take no copy of triggerdb; a version move stays one-way with
  `--trigger`. The verdict is computed by the script of the checkout that runs before the
  deploy, so this reader should reach live in alpha.3, as a small pull request of its own. If
  it does not, alpha.4's deploy says one-way ("cannot be compared on the Trigger.dev pin") and
  copies triggerdb too: conservative, and harmless.
- **CI.** `images.yml`'s pull-request job `build (trigger, amd64|arm64)` builds both
  Dockerfiles natively on each platform with managed.yml's version, and checks the user,
  command, entrypoint and working directory are upstream's: the only place the linux-x64 paths
  are exercised. Not required (its `paths:` filter). The weekly and dispatched image scan
  builds both on arm64 under the same names, so the SARIF categories and issues continue.
- **Guards.** New: `scripts/a-binary-the-stack-never-runs.unit.test.ts`. It runs both
  Dockerfiles' RUN instructions, as their users, over a stand-in of each image's tree on both
  platforms, and shows each removes exactly its REMOVED table, and that every path upstream
  could move fails the build by name before anything is removed. It also holds the shape,
  the names, the `user:` coupling, why each removal stays safe, the CI job and Dependabot's
  silence. Changed: `a-database-started-as-root` (no `build` of any service whose image is
  built here), `a-service-that-phones-home` (both rows read `build`, held to the FROM;
  `COREPACK_ENABLE_NETWORK` in `WEBAPP_KEYS`), `an-image-nobody-scanned`,
  `a-pin-that-knows-it-is-behind`, `trigger-version.unit` (the rewrite on both Dockerfiles,
  its hash equal to the pin watch's, a dropped directory, `running_tag`, `tag_digest`),
  `a-deploy-from-a-named-tag` (both forms; three new cases) and `every-pr-check-is-classified`.
  Each new case was seen to fail on the mutation it names.
- **Not proven here** (no Docker daemon, and ghcr's blobs are unreachable from this session):
  that the two Dockerfiles build, which proves the hard links, the paths and the corepack
  copies on the real images. The draft's `build (trigger, amd64|arm64)` does that first; then
  a Security Scan dispatched on the branch with `image_scans` (expected: `trigger.dev` 3
  critical, `supervisor` 1, and the webapp leg's time against its 30 minutes), then E2E
  (managed) on the branch, whose task deploy goes through the finalize route that loads
  `@depot/cli`. No version moves, so no window is needed.
- **Not in this draft:** deleting tar inside the copy of pnpm that does run (only pnpm's bundled
  node-gyp requires it). That would take the counts to 2 and 0, and is a separate step with the
  owner's OK. *Since given, 2026-10-27, and built: the entry above.*

**2026-10-28: alpha.3's work landed on main, T9 to T15b, T7's digest and the cosign, each
after its own proof.** After the alpha.2 tag (`v0.2.0-alpha.2`, `f62bcbe2`), 28 pull requests
merged to `main` between 2026-10-27 21:58 UTC and 2026-10-28 22:38 UTC, one at a time: 9 after
CI, and 19 after a green E2E on the branch as well. `main` is at `9a58872c`. Times below are UTC
on 2026-10-28 unless dated.

- **This plan's, on CI:** the cosign v3.1.4 (#1702, 2026-10-27 22:22, `3188e9e1`); T16a,
  `deploy-live.sh` reading the Trigger.dev pin as a version (#1721, 2026-10-27 23:37,
  `991bd21c`); T10, the image scan building the tasks' image as a deploy does (#1700,
  2026-10-27 23:53, `ee9be30f`).
- **This plan's, after E2E:**
  - T15, #1717 at 02:22 (`6f9af7f2`): E2E (managed) run 40616652331 (01:42–02:21), on #1678's
    pin, which merged at 01:35 (`afe17fef`);
  - T15b, #1719 at 03:16 (`fb0fea2e`): E2E (self-hosted) run 40621523504;
  - T12a, #1707 at 04:06 (`53fb6453`): E2E (managed) run 40626664067 (03:26–04:05);
  - T11 (a), Mailpit v1.32.0, #1699 at 04:53 (`e33d7902`): E2E (managed) run 40631369534
    (04:16–04:52);
  - T11 (b), Stalwart v0.16.27, #1698 at 05:42 (`29d1d7e0`): E2E (managed) run 40635727901
    (05:03–05:41);
  - T9, #1687 at 09:14 (`9480e898`): E2E (managed) run 40656320601 (08:22–08:56) and E2E
    (self-hosted) run 40661756633. The scheduled E2E (managed) on `main`, run 40667933035, ran
    on `9480e898` (09:54–10:15), green;
  - T12, #1708 at 10:24 (`13e2300e`): E2E (managed) run 40663045583 (09:17–09:57) and E2E
    (self-hosted) run 40669572838. Dependabot's #1713, #1714 and #1715 were closed as
    superseded by it;
  - T13a, #1710 at 10:37 (`f34588e6`): E2E (managed) run 40671926123 (10:24–10:35);
  - T13, #1709 at 12:00 (`b13d303e`): E2E (managed) run 40673664905 (10:38–11:14) and E2E
    (self-hosted) run 40679655003;
  - T7's digest, Chainguard's MinIO at `268d68a2…` (its build of 2026-10-25), #1726 at 14:45
    (`0f3fda25`): E2E (managed) run 40706723499 (14:31–14:39);
  - T14, #1716 at 20:11 (`98802571`): E2E (managed) run 40758865207 (19:56–20:07). Trigger.dev
    v4.8.1 (#1697), which it was stacked on, merged first at 19:55 (`f387b175`), after E2E
    (managed) run 40756746457 (19:42–19:55); the owner had moved the OTA's `.env` to v4.8.1
    first (checklist T35), with the backup taken before v4.8.1 verified.
- **Other plans', the same way.** On CI: #1701 pnpm 11.28.8 (`4cd87405`), #1723 qs 6.16.1
  (`01073963`), #1711 the actions group (`145ca694`), #1718 the weekly scan naming every
  critical (`86de86d3`), #1705 the Nextcloud suites against 35 (`d6acd430`, 0119 T5) and #1703
  GoAccess 1.12 on Alpine 3.24 (`fcb3d50f`). After E2E: #1678 the floating images by exact tag
  and digest (`afe17fef`, 0119), #1704 (`3fb0dc29`, 0104 T5), #1712 fifteen npm bumps
  (`f8f8e289`), #1725 plain compose progress (`719fdc67`), #1724 (`24864dcc`, 0132 T9),
  #1720 the demo, dev and test Nextcloud on 35.0.2 (`3d2f129e`, 0119 T5) and, last, #1727
  systeminformation 5.33.16 (`9a58872c`, 22:38), which closed Dependabot alerts 6 and 7.
- **Left for alpha.3: Redis 7.4.12** (the owner's decision of 2026-10-28: alpha.3 waits for it).
  Docker Hub re-pushed the tag on 2026-10-28, so its three-day floor ends 2026-10-31 06:05 UTC.
  Then the CHANGELOG fold and two counted nights on it. Live runs alpha.2 since the owner's
  deploy (checklist T21 to T25), so its deploy to alpha.3 is the one that runs twice (T13,
  below).
- **Left for alpha.4: T16**, the Trigger.dev images built here, #1722, still a draft; the work
  it was stacked on is on `main` now, its base.

**2026-10-26: T14, the tasks on the API image's own base with no package manager, merged as
#1716 (`98802571`)** on 2026-10-28 at 20:11 UTC, in alpha.3, from branch
`claude/ownpace-public-readiness-y7orc6-tasks-trixie-base`. It was stacked on the Trigger.dev
v4.8.1 branch (#1697), which merged first, at 19:55 UTC (`f387b175`).
- **What changes.** `apps/worker/trigger.config.ts` sets the build manifest's `image.base` to
  the image `apps/api/Dockerfile` builds FROM. It sets `image.buildBase` to the CLI's own build
  image for `node-24`: `triggerdotdev/node:24-bookworm-build@sha256:34a3f455…`, which is
  trigger.dev 4.8.1's `BUILD_IMAGE`, pushed 2026-10-22 08:03 UTC.
  - The layer that copied the API image's Node over the CLI's base (#1689) is gone. The tasks
    run that image's own Node binary, and Dependabot's move of the FROM line is the only way
    the tasks' Node or Debian moves.
  - One layer remains:
    - it runs `apt-get upgrade`, then installs `ca-certificates` and `dumb-init`;
    - it removes every package manager (`/usr/local/lib/node_modules`, the npm, npx, corepack,
      pnpm, pnpx, yarn and yarnpkg links, `/opt/yarn-v*`) wherever no `g++` is on the PATH;
    - it makes the trust edits the CLI makes to its own images, which it leaves out on a custom
      base (`trustStoreHardening` in `deploy/buildImage.js`): four roots distrusted, eight
      eMudhra intermediates rejected (vendored byte for byte in
      `apps/worker/task-image/emsign-block/`), and `NODE_OPTIONS=--use-openssl-ca` with
      `SSL_CERT_FILE`.
- **Why the manifest.** CLI 4.8.1 has no `trigger.config.ts` option for a base image. A
  custom base reaches its Containerfile through the build manifest's `image.base` and
  `image.buildBase`. Upstream's documented way to fill them is an instance setting:
  `DEPLOY_BASE_IMAGES` and `DEPLOY_BUILD_BASE_IMAGES` on the webapp (`self-hosting/overview.mdx`
  at v4.8.1). That would name the image in `managed.yml` too, a second place for the Node to
  move. The extension sets the fields in `onBuildComplete` instead, on the manifest the CLI
  hands it, reading the FROM line at the start of every deploy as before.
  - An instance setting would be laid over this key by key (`applyServerBaseImages` in
    `commands/deploy.js`; the webapp sends only the keys it has, `resolveDeployBaseImages`): a
    base named there replaces the config's, and a build base it leaves out keeps the config's.
    Either way it is a second place the image moves. The guard holds that `managed.yml` and
    `managed.env.example` set neither.
  - Official extensions do not write the manifest, so this rests on the CLI's code, not on
    a documented API. The CLI passes the manifest it then writes the Containerfile from
    (`build/buildWorker.js`). A CLI move reads that again.
- **Why the build stage is named.** With a layer and no build base, the CLI builds its build
  stage FROM the runtime base and runs `npm i` there for the externals. With npm gone, that
  install would fail. Named, the build stage starts from the CLI's prebuilt `-build` image.
  - The CLI replays the layer there. The removal skips it because the image has g++ 12.2.0,
    and its npm 11.19.1, python3 and make stay (read with Trivy's package list, linux/arm64).
  - A cache-miss deploy no longer installs python3, make and g++ with apt.
  - Only `node_modules` and `index.json` leave that stage. Its Node is the CLI's 24.22.1 build:
    it installs two packages and runs the indexer, and the tasks never run on it.
- **What the runtime uses**, read from the trigger.dev 4.8.1 tarball and upstream at `v4.8.1`:
  - The final stage's ENTRYPOINT is `dumb-init node <managed-run-controller>`.
  - The controller forks the task worker with `execPath: process.execPath`
    (`executions/taskRunProcess.js`). That is the only `child_process` use in the 19 files the
    two runtime entry points import.
  - `@trigger.dev/core` 4.8.1 uses no `child_process` at all, and no task does: only
    `packages/testing` does, and no task imports it.
  - The supervisor (`apps/supervisor/src/workloadManager/docker.ts`) creates the container with
    the image's own entrypoint and runs nothing in it, and the smoke reads runner containers
    with `docker logs` only.

  So the runtime needs dumb-init, and `ca-certificates` for `--use-openssl-ca`, and openssl
  comes with it as a dependency. It needs no busybox, git, npm or toolchain. The CLI's base
  images carry busybox, ca-certificates, dumb-init, git and openssl
  (`base-images/images.json`), and its `-build` images add python3, make and g++.
- **The trust edits on Debian 13.** trixie-security's `ca-certificates` `20250419+deb13u1`
  (2026-10-20) already drops "emSign ECC Root CA - G3" and "Comodo AAA Services root". It still
  ships `emSign_Root_CA_-_C1`, `emSign_ECC_Root_CA_-_C3` and `emSign_Root_CA_-_G1`. Run on that
  package's `/etc/ca-certificates.conf`, the layer's `sed` marks C1 and C3, and the two others
  are no-ops. The eight rejected intermediates are issued by emSign Root TLS CA - G3 or emSign
  Root CS CA - G3, and every use is rejected.
  - The CLI's list is now this repository's to keep. Its digest is in the guard (`f4b2b13e…`),
    and a CLI move compares it with the new `emsignRejectedIntermediates.js`.
  - The version gate fails when `apps/worker`'s `@trigger.dev/sdk`, the CLI a deploy runs,
    leaves 4.8.1, and names the three things to read again: `BUILD_IMAGE['node-24']`,
    `EMSIGN_COMPROMISE_DISTRUSTED_ROOTS` and `emsignRejectedIntermediates.js`. A watch for a
    change in that list between moves is not built (below).
- **Measured** with Trivy 0.76.1, DB of 2026-10-25 19:10 UTC, CRITICAL and HIGH. The figures
  are the same on linux/amd64 and linux/arm64. The first four rows are base images as their
  registry serves them; the tasks run each with a layer on top:

  | Image | Critical | High | With a fix |
  |---|---|---|---|
  | the CLI 4.7.6 base `triggerdotdev/node:24-bookworm@sha256:d2d0c018…`, raw (what `main` deployed on until #1697) | 14 | 119 | 56 |
  | the CLI 4.8.1 base `…@sha256:3cdc8242…`, raw (#1697) | 1 | 83 | 7 |
  | `node:24.22.1-slim@sha256:16818628…`, raw (Debian 12.15, the API's FROM until #1708) | 1 | 61 | 4 |
  | `node:24.22.1-trixie-slim@sha256:43b9ba11…`, raw (#1708's pin) | 0 | 48 | 4 |
  | the same with this layer's packages, and without the package managers | 0 | 43 | 0 |

  Compared like for like, with what each deploy adds:
  - **`main`**, until #1697, deployed the 4.7.6 base with #1689's layer, whose `apt-get -y
    upgrade` clears the Debian findings that have a fix (12 critical and 31 high), and whose Node
    copy leaves npm's bundled packages. That leaves about **2 critical and 88 high**.
  - **#1697** does the same on the 4.8.1 base (3 high with a fix), so about **1 and 80**.
  - **This branch**, on #1708's base, reads **0 and 43**.

  Both "about" figures are counted from the raw reports, taking out the Debian findings with a
  fixed version. They assume the upgrade finds every one of those fixes in Debian's archive;
  nothing was built here.

  How the last row was made:
  - It is an OCI layout of the trixie image's own blobs plus one layer, scanned with `trivy
    image --input`.
  - That layer holds dpkg status entries and whiteouts for the removed paths. The entries are
    `ca-certificates` `20250419+deb13u1` and `openssl` `3.5.7-1~deb13u3`, the versions trixie
    serves today (read from `buildpack-deps:trixie-curl`), and `dumb-init`.
  - Debian's archive cannot be reached from this session, so nothing was installed. A probe
    with `dumb-init` at version 0.0.1 adds no finding, so the database holds no advisory for it
    in Debian 13.

  The 43 are #1708's, none with a fix: util-linux's packages (36), ncurses (3), libsystemd0
  and libudev1 (2), perl-base (1) and libacl1 (1). The 5 that leave are npm's bundled undici
  (2), brace-expansion (2) and http-cache-semantics (1).
- **Without #1708**, `apps/api/Dockerfile` names `node:24.22.1-slim@sha256:16818628…`
  (Debian 12.15), so the tasks build on that, with the same layer. The trixie figures hold from
  when both are in. The CLI's own `generateContainerfile` from the trigger.dev 4.8.1 package,
  run on the manifest the extension leaves, writes the following:
  - `FROM node:24.22.1-slim@sha256:16818628… AS base`;
  - `FROM triggerdotdev/node:24-bookworm-build@sha256:34a3f455… AS build`;
  - the layer in both stages, followed by its own `apt-get --fix-broken` repair and no trust
    edits of its own;
  - `FROM base AS final` and `ENTRYPOINT [ "dumb-init", "node", … ]`.

  The layer's shell bodies were run under `dash` against a scratch tree:
  - with no `g++` on the PATH, every package manager goes and `node` stays;
  - with one on the PATH, nothing goes;
  - the eight files are written byte for byte.
- **The weekly scan follows the base (review of 2026-10-26).** `imagesToScan` in
  `scripts/image-scan.mjs` lists `apps/api/Dockerfile`'s FROM image as `trigger-task-base`
  wherever the config carries the pin watch's `TASK_ON_API_IMAGE` mark, and the CLI's
  `BASE_IMAGE` only where it does not. The name, and so the SARIF category, stays.
  - `scripts/an-image-nobody-scanned.unit.test.ts` runs the config's own extensions as the CLI
    does and fails when the listed reference is not the manifest's `image.base`. It fails on
    the old list (2 cases), and on a list that never falls back (3 cases).
  - Without T10's build of the layer, the scan reads the base alone. It still reads the npm the
    layer removes (4 high with a fix, 1 without), and not the `ca-certificates`, `openssl` and
    `dumb-init` the layer installs: 1/61 while the FROM line is Debian 12, 0/48 on #1708's
    (the table above).
  - The SARIF location moves from `triggerdotdev/node` to `library/node`. So the first Monday
    scan after this merges closes every alert the category opened under `triggerdotdev/node`,
    and the findings open again under new numbers. That is right, because the image is a
    different one.
- **What #1700 (T10) changes in turn.** It merged first, on 2026-10-27 (`ee9be30f`), so on
  `main` the scan builds the layer, and this branch merged second.
  - Its `imagesToScan` edits the same lines, so whichever merges second keeps this branch's
    choice of `ref` and adds #1700's `build` field and wording, and keeps this branch's cases.
  - Its `taskBaseStage` then writes `FROM <the API base>` as it stands, since it writes the
    listed `ref`. Reading the manifest back, `FROM ${manifest.image?.base ?? base}`, would hold
    it to the config itself; `image.buildBase` is ignored, because the build stage is not
    scanned.
  - Its `DEPLOY_BASE_IMAGES` check and its refusal of `image.pkgs` stay; the layer uses no
    `pkgs`.
  - The leg's build runs this layer's apt on its runner, and runs the removal, because the
    runtime base has no `g++`.
- **Other branches.**
  - #1709 (alpha.3, the owner's decision of 2026-10-26) merged first, on 2026-10-28
    (`b13d303e`); it edits the same comment block in `trigger.config.ts`.
  - #1708's runtime-stage comment in `apps/api/Dockerfile` said the tasks copy the FROM image's
    Node. #1708 merged first, and this branch, merging second, made it "build on" that image.
- **Proved here:**
  - The version gate's new cases failed on the old config (8 of 8), and pass now.
  - The version gate's CLI case fails with `apps/worker`'s SDK set to 4.9.0, and only it.
  - Every guard that reads a touched file passes, and so do `pnpm typecheck` and eslint (the
    branch's pull request has the counts).
- **Owed:**
  - E2E (managed) on the branch after #1697 merges, and after #1708 for the Debian 13 base. Its
    log should show the task deploy building `FROM node:24.22.1-trixie-slim@sha256:43b9ba11…
    AS base` and `FROM triggerdotdev/node:24-bookworm-build@sha256:34a3f455… AS build`, the
    smoke runs ending `COMPLETED_SUCCESSFULLY`, and the drill passing. Run 40758865207
    (2026-10-28, 19:56–20:07 UTC), after both had merged, was green, and #1716 merged at 20:11 UTC.
  - The first task deploy after it is the slow one: a new base in both stages, apt in both, and
    the Debian archive reachable.
- **Not done, on purpose:**
  - No watch for the CLI's trust list or build image moving. A CLI move is read by hand (0119
    §2), the version gate fails until it is, and a stale build image still builds.
  - No `DEPLOY_BASE_IMAGES` route, for the reason above.
  - busybox and git are not installed, because nothing runs them.

**2026-10-26, decision: T13 ships in alpha.3, with T13a (#1710), and the alpha.2 to alpha.3
live deploy runs twice** (the owner's decision of 2026-10-26, asked with that cost stated).
#1709 (T13) and #1710 (T13a) both go to `main` after the alpha.2 tag and ship together in
alpha.3, instead of #1709 in alpha.4 or later after #1710 had been on live. #1710's branch is
unchanged; #1709's carries it merged, and these records say both ship in alpha.3. Both merged
on 2026-10-28: #1710 at 10:37 UTC (`f34588e6`) and #1709 at 12:00 UTC (`b13d303e`).

- **The cost, read from alpha.2's script.** `deploy-live.sh` runs the copy the checkout had
  before it moved, and `v0.2.0-alpha.2`'s (`main` at `f62bcbe2`, the release commit) asks the api
  container `printenv NODE_ENV` after the bring-up, inside an `if` and with its error thrown
  away. It differs from this branch's script only in that check and the `api_env` T13a added. On
  the distroless image the exec fails, and the script does what it does for any failed check:
  the bring-up has run, `/api/version` and `/version.json` name the tag's commit and version,
  `/api/ready` and `/api/auth/mode` answer, the site step and the exposure check run, and then it
  prints `the deploy did not take: v0.2.0-alpha.3 is checked out, and` over `NODE_ENV: the api
  container could not be asked (docker compose exec -T api printenv NODE_ENV).`, keeps the hold
  and the copy before the update, logs `did-not-take` and exits 3. `did_not_take` rolls nothing
  back and leaves no half state: live runs the tag. The task deploy may leave
  `apps/worker/package.json` without its last newline, which the next run refuses before
  anything moves (exit 1, naming `git checkout -- apps/worker/package.json`). The second run,
  from the checkout now at the tag, is the tag's script: the copy's take keeps the copy of
  alpha.2, its update not proven (`copy-before-update.sh`'s *a copy is here already*), the
  bring-up runs again over a stack already at the tag, `NODE_ENV` is read from Docker, and it
  says `the deploy took`, exit 0, with a `took` line; the copy is proven by that line as after
  any deploy. It is the re-run with the same tag that the script has always offered after a
  deploy that did not take.
- **Run, not only read.** `scripts/a-deploy-from-a-named-tag.unit.test.ts` gains the case: a
  checkout of alpha.2 whose script is today's with alpha.2's NODE_ENV check put back word for
  word (`diff` against the tag's file shows only the uncalled `api_env`), a `deploys.log` whose
  last `took` is alpha.2, the docker stub answering an exec into the api as Docker does on
  distroless, and the task deploy stripping `apps/worker/package.json`'s last newline. First
  run: exit 3, ending with did_not_take's five lines word for word, the checkout at the tag, one
  bring-up, one take, `did-not-take`, no write to the database. Run again as the tree is:
  refused, exit 1, naming that file, nothing moved. After the procedures' own `git checkout --
  apps/worker/package.json`, the tree clean: exit 0, `NODE_ENV in the api container:
  production`, `the deploy took`, a second bring-up and take, `took`. The same case, given
  alpha.2's own file, passed the same way (again on 2026-10-27, with the five lines).
- **The procedures say it, word for word**, as the first round of #1709 had: `managed-bring-up.md`
  gains *The deploy from alpha.2 to alpha.3 runs twice* (the first run's last five lines, the
  second run's commands, and what that run prints), and `release.md` §5, `ending-the-alpha.md`
  step 5 (with the first run's first three lines), the operator runbook's *Upgrade* and both
  CHANGELOG lines carry the step and point at it. The second run names `<tag>`, the tag the
  first run named, so that a deploy of a later tag from alpha.2 is not run a second time to
  alpha.3. `ending-the-alpha.md` step 6 says its task environment line is in the first run's
  output: the second finds the stage already deleted and prints none. `deploy-live.sh`'s
  `api_env` comment says the same. `an-api-image-with-nothing-to-exec`'s new section 6 holds the
  five to it, in the step that names the deploys: alpha.2 in the words that lead to "runs
  twice", the decision next to them; in the three that spell it out, the first run's lines as
  alpha.2's `did_not_take` prints them, the same tag in each, and the put-back before the second
  run; the pointers to the section by its heading, its anchor and its name; and the CHANGELOG's
  step above alpha.2's section. Section 2 reads the one quoted failure line as output, and the
  same exec anywhere else, or that line wrapped, as an exec. Fourteen deliberate regressions
  each turned the two guards red: in the docs, the step gone from the runbook or the CHANGELOG,
  the quoted line changed, wrapped or missing, the put-back gone or after the second run, the
  second run gone, the same exec as a command elsewhere, and the runbook not naming alpha.2; in
  `deploy-live.sh`, `did_not_take` rolling the checkout back, exiting 0, or logging nothing,
  and the tag's own check back on `printenv`. The review of that round (2026-10-27) found the
  check of the step read the whole file, the lines around the failure line and the pointers
  unheld, and the CHANGELOG's place unchecked; 17 more regressions turned the guard red after
  the fix (release.md's step not naming alpha.2; a quoted line reworded (the first, the hold
  line, the log line), dropped (the copy line, the hold line) or given another tag; the failure
  line wrapped; the heading renamed; each of the four pointers
  gone; the CHANGELOG's decision gone, or its bullet moved under alpha.2; the put-back after the
  second run; the second run gone), and three more the two-run case (the copy line reworded, a
  line after the log line, the stand-in dirtying another file).
- **Which deploys.** Any tag from alpha.3 on, deployed from a checkout of alpha.2 or earlier,
  and the first deploy forward after a rollback of live to such a tag. A deploy started from
  alpha.3 or later runs once, to any tag.
- **Not run on live**, which runs alpha.2 since the owner's deploy (checklist T21 to T25); nothing
  here booted a stack (no Docker daemon in this session).

**2026-10-26, build: T13, the API's runtime on distroless, for alpha.3 with T13a, merged as
#1709 (`b13d303e`)** on 2026-10-28 at 12:00 UTC, from branch
`claude/ownpace-public-readiness-y7orc6-api-distroless`. Its base was #1708's branch until #1708
(T12) merged, then #1710's (T13a) until that merged, then `main`; #1687 (T9) also changes
`apps/api/Dockerfile`. It ships in alpha.3 together with #1710 (the owner's decision of
2026-10-26, above; first written for alpha.4 or later, after #1710 had been on live), and merged
after E2E (managed) run 40673664905 and E2E (self-hosted) run 40679655003 were green on it.
Rebuilt the same day on a merge of #1708 and #1710: the readers below are #1710's, and #1709
itself is the runtime switch.

- **What changes.** `apps/api/Dockerfile`'s runtime stage builds FROM
  `gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325…`: Debian 13.7, fourteen
  packages (libc6, libssl3t64, libstdc++6, ca-certificates, tzdata and the like) and Node
  24.22.1, with no shell, coreutils, package manager, perl, util-linux or ncurses. GCR uploaded
  that index on 2026-10-23 at 23:31 UTC, and it was still the `nonroot` tag's at 23:40 UTC on
  2026-10-25, read again from the registry; it is three days old, CONTRIBUTING.md's age, at
  2026-10-26 23:31 UTC. The build stages keep T12's `node:24.22.1-trixie-slim`. The runtime
  has no RUN (nothing could run one); it copies `/app` as root's (the build stage's last RUN,
  `chmod -R u=rwX,go=rX /app`, makes it readable by all and writable by root alone), runs as
  `USER 65532:65532`, starts `ENTRYPOINT ["/nodejs/bin/node"]` with `CMD
  ["apps/api/src/index.ts"]`, and its HEALTHCHECK is the same fetch, exec form, on
  `/nodejs/bin/node`. Node is off the image's PATH.
- **Measured here**, Trivy 0.76.1 (DB of 2026-10-25 19:10 UTC), the remote index on
  linux/amd64 and linux/arm64 alike: 0 critical and 0 high, 23 medium and 8 low, none with a
  fix. T12's base under the api reads 0 and 43 and `node:24.22.1-slim`, `main`'s until #1708, 1
  and 61. `/nodejs/bin/node`, read out of the distroless layers, is the trixie image's
  `/usr/local/bin/node` byte for byte: sha256 `e32e2d16081cf644…` on amd64 and
  `c8c5721679d8d1a0…` on arm64, both read again here from both images' layers.
- **The exec sites, every one (T13a, #1710).** Seven read a variable with `printenv` in the container
  (`e2e-managed.yml`'s DIRECT_DATABASE_URL, `deploy-live.sh`'s and `stand-up-live.sh`'s
  NODE_ENV, and the smoke's JWT_ISSUER, JWT_SECRET, JWT_AUDIENCE and JWT_JWKS_URI); three ran a
  bare `node -e` (the smoke's minio, docker-proxy and issuer probes); two docs execed
  `printenv` (`managed-bring-up.md` §8g and the mail section) and one `sh -c`
  (`ending-the-alpha.md`'s first check), and a third doc line described `deploy-live.sh`'s.
  Variables are now read from Docker, `docker container inspect`'s `.Config.Env` (the
  image's ENV with Compose's environment over it, which is what the process got and what
  `printenv` printed), by `api_env` in the three scripts and in the workflow step, and in the
  docs, with a new section, *Reading what the api container was started with*. It needs
  nothing in the image, so it answers the same for an image from before T13: a stack not
  rebuilt since a pull, and a deploy of an older tag, which `deploy-live.sh` runs from the
  newer checkout. `container` inspect, because a bare `docker inspect` of a name that is no
  container answers with the image Compose built under the same name. The probes need Node
  inside the container's network, so they run it by path: the smoke's preflights find it with
  `api_node`, `/nodejs/bin/node` and then `/usr/local/bin/node`, and stop when neither runs.
  `release-verify.mjs`'s `docker exec … node -e` asks the selfhost image, which T13 leaves
  alone; no scan or SBOM step looks inside the API image for a shell or a path.
- **The tasks do not change.** `apps/worker/trigger.config.ts` reads the Dockerfile's
  `FROM node:…@sha256:…` line, which is now the build stage's and is T12's string, so its
  `COPY --from=` instruction is the same text and the task image the same. Their Node is the
  API's version, and was the same file on 2026-10-25. The two pins now move apart (Dependabot
  moves the node tag weekly and the distroless digest when `nonroot` moves), on the one major
  that `a-gate-on-a-version-nothing-ships` holds, and the smoke's preflights hold the version:
  `api_node` keeps what the API container's Node says to `--version` and `dockerfile_node`
  reads the `x.y.z` of the `FROM node:` line, and a difference stops the run with both named
  (`preflights OK (… /nodejs/bin/node v24.22.1 runs in the API container, the Dockerfile's
  Node)` otherwise). Nothing else would say it: the `nonroot` tag names no version, and Trivy
  0.76.1 with `--list-all-pkgs` lists no Node runtime in either image (the distroless index's
  14 Debian packages; the trixie image's 79 and npm's 146).
- **The user.** It was a system `appuser`, uid 10001, owning `/app`; it is distroless's
  `nonroot`, 65532, and owns nothing there: `/app` is root's, mode 0644 for files and 0755 for
  directories (and for files that were executable), so a compromised API cannot rewrite the code
  it loads at its next start. The modes are set in the build stage because COPY keeps them, and
  a checkout made under a umask of 077 has 0600 files. The API writes nothing to disk and the
  `api` service mounts no volume, so no file outside the image ever had to be 10001's. The
  review of 2026-10-26 booted the PR head's `/app`, root-owned at those modes, as 65532 in the
  distroless filesystem: all 59 migrations read, `/health` and `/ready` 200.
- **Guards.** `scripts/an-api-image-with-nothing-to-exec.unit.test.ts`'s section 1, added here,
  holds the runtime stage (distroless by digest on the build's Node major and Debian, no RUN, a
  numeric non-root USER that owns nothing it copies, the stage it copies from ending with the
  `chmod`, the ENTRYPOINT and the exec-form HEALTHCHECK on `/nodejs/bin/node`), and a compose
  healthcheck or entrypoint on the API image, and an exec into the api container that names a
  path, may name `/nodejs/bin/node` only: `/usr/local/bin/node` by name is refused, and a
  rolled-back stack is the smoke's `api_node`, which tries both through a variable. Sections 2 to 5
  are T13a's (#1710): no shell, `printenv` or bare `node` exec'd into the api container in
  `deploy/`, `scripts/`, `test/`, the workflows and `docs/` (records aside), each script's
  `api_env` and the smoke's `api_node` and version check against a stub docker, and no
  `CMD-SHELL` healthcheck on a compose service built from the API image. 21 deliberate
  regressions each turned it red, among them `printenv` back in one smoke read, `sh -c` back in
  the doc, a bare `docker inspect`, a prefix match in `api_env`, and a `RUN` in the runtime.
  `a-base-image-that-carried-what-nothing-runs` keeps the package-manager rule for the selfhost
  runtime alone; the transpiler, image-scan, identity, verdict and the two live-script guards
  read the new forms.
- **What the owner sees change.** `docker compose … exec api sh`, `printenv` or a bare `node`
  no longer work by hand; `/nodejs/bin/node` does, and the read-backs in `managed-bring-up.md`
  and `ending-the-alpha.md` read from Docker since T13a. **The live deploy from alpha.2 to
  alpha.3 runs `deploy-live.sh` twice** (the owner's decision of 2026-10-26, above): alpha.2's
  script asks with `printenv` and says the deploy did not take, though the stack has moved, and
  a second run, from the checkout now at the tag, reads from Docker and takes. So does any tag
  from alpha.3 on deployed from alpha.2 or earlier, and the first deploy forward after a
  rollback of live to such a tag; the procedures say so. A deploy started from alpha.3 or later
  runs once, and deploying an older tag from a checkout with T13 works as before.
- **The review of 2026-10-26** (two reviews; no blockers). Both preferred to split T13: the
  readers one release before the runtime switch, so that a deploy of the distroless API from
  that release or later meets no older script. Done the same day: the readers are T13a, #1710, for alpha.3, and
  #1709 was rebuilt on a merge of #1708 and #1710 with the switch alone on top, so the two-run
  step the first round had documented in `managed-bring-up.md`, `release.md`,
  `ending-the-alpha.md` and the operator runbook, and the guard's check of it, were gone (back,
  for the alpha.2 to alpha.3 deploy, since the owner's decision above). Fixed
  in the first round and kept: the Node version check above; `/app` root's; `api_env` in the two
  live scripts lets Docker's error through and says when Compose names no api container; the
  guard also reads `test/`. 17 deliberate regressions turned the guard red then (`--chown`
  back, as the uid or by name; the `chmod` gone, weakened, joined with `||`, or followed by a
  command or a RUN; an exec of `printenv` in `test/`; `2>/dev/null` back, and the silent empty
  id; `api_node` without the version; the mismatch not stopping, or comparing majors only; the
  `FROM` read losing its patch; a missing Dockerfile passing; and two notes since removed). The
  review of the split, the same day, found `/usr/local/bin/node` by name still passing the
  scan, a `printenv` exec'd by the container's id or a variable holding it passing too (fixed
  in #1710 and merged here), the skip past alpha.3 unrecorded, and the troubleshooting row's
  HEALTHCHECK not naming `/nodejs/bin/node`; all four are fixed.
- **Not booted here.** No Docker daemon in this session; `images.yml` builds the api image on
  the pull request (linux/amd64). E2E (managed) has to show the image built on the arm64
  runner, the container healthy by its own HEALTHCHECK, the smoke's preflights naming
  `/nodejs/bin/node`, the issuer, minio and docker-proxy probes passing, and the pooler step
  reading DIRECT_DATABASE_URL; E2E (self-hosted) that the appliance is untouched. Both were
  green before the merge: runs 40673664905 (2026-10-28, 10:38–11:14 UTC) and 40679655003.
- **One-way:** none. Reverting the runtime stage restores T12's, and every read above works on
  both.


**2026-10-26, build: T13a, the readers first, for alpha.3, merged as #1710 (`f34588e6`)** on
2026-10-28 at 10:37 UTC, from branch `claude/ownpace-public-readiness-y7orc6-api-readers`,
against `main`. It merged after the alpha.2 tag, once E2E (managed) run 40671926123 was green on
it, and ships in alpha.3 together with T13 (#1709, merged after it as `b13d303e`), which puts the
API's runtime on distroless (the owner's decision of 2026-10-26, above; first written to ship a
release before T13).

- **Why first.** The review of #1709 on 2026-10-26 (two reviews) preferred to split T13.
  `deploy-live.sh` runs the copy the checkout had before it moves to the tag (its header, *Like
  every step*), and a copy that asks the api container its `NODE_ENV` with `printenv` reports a
  deploy of the distroless image as one that did not take, though the stack has moved. With the
  readers on live a release earlier, a deploy of that image from alpha.3 or later meets no such
  copy, and the two-run step #1709 had documented for the owner is not needed. The owner chose
  on 2026-10-26 to ship both in alpha.3 instead, and to run the alpha.2 to alpha.3 deploy twice
  (above).
- **What changes.** Every site that exec'd a shell, `printenv` or a bare `node` into the api
  container now does what works on the Node image and on distroless alike. A variable the API
  was started with is read from Docker, `docker container inspect`'s `.Config.Env` (the image's
  ENV with Compose's environment over it, which is what the process got and what `printenv`
  printed): by `api_env` in `deploy-live.sh` and `stand-up-live.sh` (NODE_ENV, through `compose
  ps -q api`, with Docker's own error on stderr and "no api container" told apart from "not
  set"), in the smoke (JWT_ISSUER, JWT_SECRET, JWT_AUDIENCE, JWT_JWKS_URI), and in
  `e2e-managed.yml`'s pooler step (DIRECT_DATABASE_URL). `container` inspect, because a bare
  `docker inspect` of a name that is no container answers with the image Compose built under the
  same name. The smoke's three probes (minio, docker-proxy, issuer) run Node by the path its
  preflights find (`api_node`: `/nodejs/bin/node`, then `/usr/local/bin/node`), and the
  preflights stop when that Node's version is not the `x.y.z` of the Dockerfile's `FROM node:`
  line, the Node the tasks copy (`dockerfile_node`). On today's image that finds
  `/usr/local/bin/node`, the line's own Node, and passes; on distroless, whose digest moves
  apart from the node tag, it is the only thing that would say the two differ. The docs'
  read-backs read from Docker: `managed-bring-up.md`'s new *Reading what the api container was
  started with*, BACKUP_RETENTION_DAYS, the mail variables, `env_of`, `deploy-live.sh`'s checks
  and the issuer row, and `ending-the-alpha.md`'s empty-stage check. No Dockerfile changes.
- **Guards.** `scripts/an-api-image-with-nothing-to-exec.unit.test.ts`, #1709's sections 2 to
  5: no shell, `printenv` or bare `node` exec'd into the api container in `deploy/`, `scripts/`,
  `test/`, the workflows or `docs/` (records aside); `api_env` in the three scripts and the
  smoke's `api_node` run against a stub docker for both image layouts; no `CMD-SHELL` or
  shell-string healthcheck, and no shell, `printenv` or bare `node` as `command` or
  `entrypoint`, on a compose service built from the API image; the version check passing and
  stopping by either path. Section 1, the runtime stage, stays with T13.
  `a-deploy-from-a-named-tag`, `a-first-bring-up-of-live`, `identity-in-the-gate` and
  `smoke-managed-verdict` read the new forms. The scan knows the container by its service, its
  name, the id `"$(docker compose … ps -q api)"` gives (read to its own `)`, the form the docs'
  read-backs teach), and a variable the same file sets to that id (the gate's `api_id`, the
  live scripts' `id`): the review of the split found a `printenv` exec'd by either id form
  stayed green, and five deliberate regressions by those forms (the doc, the gate, both live
  scripts, a bare `node`) now turn it red.
- **Not run here.** No Docker daemon in this session. E2E (managed) has to show the smoke's
  preflights naming `/usr/local/bin/node v24.22.1`, the minio, docker-proxy and issuer probes
  passing, and the pooler step reading DIRECT_DATABASE_URL. Run 40671926123 (2026-10-28,
  10:24–10:35 UTC) was green before the merge.
- **What is left.** With T13 in the same release, the deploy from a tag before T13a (alpha.2 or
  earlier) to alpha.3 or later meets the T13 image with the older tag's script, which says the
  deploy did not take, though the stack has moved; a second run, from the checkout now at the
  tag, reads from Docker. So does the first deploy forward after live was rolled back to such a
  tag. The procedures say so, word for word (the owner's decision of 2026-10-26, above).
- **One-way:** none. Every read works on the image of every earlier tag too.

**2026-10-26, last of all: T15b after its review, thirteen findings, twelve fixed as found and
one in a narrower form**, on the same branch. No fault was found in the Dockerfile, its name or its
Dependabot entry.
- **The documented upgrade never reached the database** (found twice). Compose.yml and
  `deploy/selfhost/postgres/Dockerfile` come from the checkout, and the quickstart's upgrade only
  pulled the app's image, so an appliance upgraded as documented kept the official image, gosu
  and all, while the CHANGELOG said there was nothing to do. The upgrade now updates the checkout
  first (`git pull --ff-only` on `edge`, the release's tag on a release; a copied
  `deploy/selfhost/` is copied again, `postgres/` included), and the quickstart, the README's
  one-line upgrade and the CHANGELOG say the database's image follows the checkout.
- **The build needs a current buildx where there is one** (narrower than found). Compose v5.6.1
  without a buildx plugin builds with the engine's classic builder (run here with the plugin
  hidden: it went on to the engine), and refuses a buildx older than 0.17.0 with `compose build
  requires buildx 0.17.0 or later` (run here with a plugin reporting v0.10.4); `DOCKER_BUILDKIT=0`
  takes it past that to the classic builder. "What you need" and Troubleshooting say so.
- **No gate started the build on an existing appliance's volume.** `build (postgres)` now starts
  the appliance's on one: the Dockerfile's own FROM, gosu and all, initialises the compose file's
  `pgdata` as root (PGDATA uid 70's, `/var/lib/postgresql/18` root's) and writes a row; the build
  then starts on it and must read the row back. dev.yml's still starts on a new volume, and E2E
  (self-hosted) and its drill start the appliance on new ones. Run here against a stand-in
  `docker` for the flow and the failure (no daemon here); the pull request's run is the proof.
- **The bind-mount advice assumed rootful Docker, and said `chown 70:70` in two places and
  `chown -R 70:70` in three.** Every place says `-R` now, and the quickstart gives the form
  that works under rootless Docker too: `docker compose … run --rm --no-deps -u 0 --entrypoint
  chown postgres -R 70:70 /var/lib/postgresql`, which chowns in the container's own uid mapping.
- **`an-image-nobody-scanned` failed on a correct Dependabot pull request.** It held the two
  built names apart, and the records expect them to meet: with the appliance's FROM set to
  managed's and the printed `sed` applied, two of its tests failed and every other guard passed.
  It now holds that the names are equal exactly when the two Dockerfiles' hashes are, and its
  meeting case meets on a made-up name. The same simulation passes all six guards now.
- **The rebuild guard missed three ways in.** It read neither the appliance's E2E tests, which
  run `docker compose ${COMPOSE_FILES} up -d postgres` on the runner the managed stacks share,
  nor `scripts/*.sh` (`upgrade-drill.sh`); and it read a command continued with a backslash one
  line at a time, so `--build` on the next line went unseen. It reads `test/e2e` and
  `scripts/*.sh` now, and joins continued lines, keeping the first line's number.
- **The job check was a text match.** `exit 0` before the appliance's `prove`, an `if false`
  around it, or `return 0` at the top of `prove()` left every line in place and passed. The
  guard now reads the step's statements outside its functions as an exact sequence, each
  function's first statements, and refuses `exit 0`, `return` and a trailing `|| true`; each of
  those, and the new volume proof taken out or run as uid 70, is a case in the guard.
- **Three records said what is not so.** `docs/deployment.md` said Dependabot keeps "the three
  Dockerfiles" and reads nothing in `deploy/compose` (five Dockerfiles since T15 and T15b, two
  of them the databases'); 0119 and `dependabot.yml` said the pin watch reads nothing in
  `deploy/selfhost` (it reads `setup-stalwart.sh`'s Stalwart pin); the Dockerfile and the bullet
  below read as if E2E (self-hosted) ran on Dependabot's pull request by itself (it runs nightly
  and on dispatch, so it is dispatched on that branch).
- **Mutation-checked**, each red and then restored: the E2E drill's `up -d postgres` given
  `--build`; the quickstart's upgrade written as a continued `up -d --build`; `upgrade-drill.sh`
  building every service; `exit 0` before, and `if false` around, the appliance's proof in
  images.yml; the root-initialised start removed; the two names equal on two contents.

**2026-10-26, last: T15b, the appliance's PostgreSQL without gosu, merged as #1719
(`fb0fea2e`)** on 2026-10-28 at 03:16 UTC, from branch
`claude/ownpace-public-readiness-y7orc6-appliance-postgres-without-gosu`, stacked on #1717
(whose guard, scan leg and job it extends), after the alpha.2 tag, after #1717, and once E2E
(self-hosted) run 40621523504 was green on it.
- **What the scan counted.** The appliance's `postgres:18.6-alpine@sha256:77f58511…` reads 1
  critical and 26 high with Trivy v0.76.1 on linux/arm64 (2026-10-26; the weekly scan's
  `postgres-selfhost` leg is this image): the critical is CVE-2025-68121, Go 1.24.6's standard library in
  `/usr/local/bin/gosu` (fixed in Go 1.24.13 and 1.25.7). The newest digest of the tag
  (`10a5c69a…`, pushed 2026-10-26 04:10 UTC) ships the same gosu, so no move of the pin fixes it;
  removing gosu does, as T15 measured for the managed build (0 critical, 1 high).
- **What was built.** `deploy/selfhost/postgres/Dockerfile`: the managed Dockerfile's
  instructions (`RUN rm /usr/local/bin/gosu`, `PSQL_HISTORY` and `HISTFILE` in `/tmp`, `USER
  70:70`) on the appliance's own base, `77f58511…`. `deploy/selfhost/compose.yml`'s postgres runs
  it as `localhost/postgres:18.6-alpine-b18f51417292` with `build: ./postgres` and `pull_policy:
  never`, the twelve hex digits being the SHA-256 of its instruction lines as for T15. The
  directory is where `builtImage()` and the image scan look (`<dir of the compose file>/<name>`).
- **The base kept, and why.** `898c60cb…`, the managed stacks' rebuild of the same tag, was
  pushed 2026-10-22 and is past the three-day floor; `10a5c69a…` is not. The appliance keeps the
  digest it ran, so removing gosu is the only change an appliance's first `up` makes to its
  database, and a new base stays a move of its own: Dependabot's, as it moved this pin on
  2026-09-24, with E2E (self-hosted) dispatched on its branch before it merges (it runs nightly
  and on dispatch, never on a pull request). While the two FROMs differ the two names do too;
  when they meet, so do the names, which is the same content.
- **Dependabot.** The pin left the docker-compose entry's view (it moves image lines, and this
  one names a build now) for a `docker` entry of its own, `/deploy/selfhost/postgres`,
  `chore(postgres)`, with the major ignore that entry had. The docker-compose entry would still
  read `localhost/postgres:…` in compose.yml, and read it as a Docker Hub repository: in
  dependabot-core's `SharedFileParser` (read on `main`, 2026-10-26) a registry is a host with a
  dot in it, so it would have asked Docker Hub for `localhost/postgres`'s tags every Monday. It
  now ignores `localhost/postgres` outright, and `Job#allowed_update?` drops a dependency every
  version of which is ignored before any update checker runs. What that entry still reads is the
  app's line, Ownpace's own `edge`; `a-dependabot-directory-with-nothing-to-read` holds as before.
- **The scan, the job and the E2E.** `scripts/image-scan.mjs` already builds any
  `localhost/<name>` of the files it reads, so the `postgres-selfhost` leg now builds
  `deploy/selfhost/postgres` on arm64 under the same name and category; no code changed there.
  `images.yml`'s `build (postgres)` brings up the appliance's postgres after dev.yml's, on a new
  volume, with the same checks (image user `70:70`; `exec`, the server and PGDATA uid 70; no
  gosu; `psql` answers), one check name, so `every-pr-check-is-classified` needs no new row. E2E
  (self-hosted) built the appliance with `up -d --build`, which now builds the database too, on a
  runner whose Docker the managed stacks share, and whose names meet theirs once the FROMs do; it
  now builds `app` by name and runs `up` without `--build`, as the managed bring-up does since
  T15's review, and `compose.dev.yml`'s header says the same.
- **Guards.** `scripts/a-database-started-as-root.unit.test.ts`: the appliance's Dockerfile by
  every rule the managed one meets, and the managed one's instructions but for the FROM; its
  image line by its own hash, failing with its own `sed`, which the guard runs on a copy; never
  pulled, never root, and no override among the appliance's compose files putting root, a pull or
  another build back; its own Dependabot entry and the compose entry's ignore; `build (postgres)`
  proving both Dockerfiles; E2E (self-hosted) building `app` by name; and the commands it reads
  for a rebuild now include deploy/selfhost's, `$SELFHOST_COMPOSE_FILES` among them. The named
  exception for the appliance is gone: no compose file under deploy/ may run the official image.
  `an-image-nobody-scanned` (the `postgres-selfhost` leg builds its directory) and
  `a-service-that-phones-home` (the row reads the Dockerfile's FROM) follow. Mutation-checked:
  eighteen breakages, each one red in these guards, every one restored (the
  appliance Dockerfile with an instruction more and the name left, with gosu, `USER 0` or another
  FROM; compose.yml without `pull_policy`, on the official image, or as root; an override as
  root; the Dependabot entry gone or offering a major, the compose entry asking for
  `localhost/postgres` (an ignore with update types) or ignoring `postgres` again, which
  `a-dependabot-directory-with-nothing-to-read` refuses; `build (postgres)` without the appliance or
  its file; E2E with `up --build` again; `compose.dev.yml` or the quickstart giving a rebuild; the
  managed Dockerfile with an instruction the appliance's lacks).
- **What an appliance sees.** Once its checkout is updated (the quickstart's upgrade says so
  since the review below), its next `up -d` builds the image and recreates the database once,
  on the same volume, whose PGDATA the root entrypoint left uid 70's. `docker compose exec
  postgres` is uid 70 (`-u 0` for root); the quickstart's backup and restore commands answer the
  same. A host directory bound in place of the named volume must be uid 70's for a new database;
  no document told anyone to bind one, and the quickstart, compose.yml and the Dockerfile now say
  how (`chown -R 70:70`, or under rootless Docker a `run … chown` inside the container). The PGlite appliance and the Windows appliance (ADR-0027) run no
  database server and build nothing.
- **Not proven here, and what proves it.** That the Dockerfile builds and starts (no Docker
  daemon here): `build (postgres)` on the pull request, and E2E (self-hosted) dispatched on the
  branch with `persistence: postgres`, whose backup and restore drill also starts it on a second
  new volume. That an appliance's existing, root-initialised volume starts as uid 70:
  `build (postgres)`, which since the review below starts the appliance's build on a volume the
  official image initialised as root and reads back the row written there (e2e.yml begins with
  `down -v`); T15's chroot run measured the same path of the same entrypoint. The image scan's
  `postgres-selfhost` on a dispatch with the image scans. E2E (self-hosted) run 40621523504 was
  green before the merge.

**2026-10-26, later still: T15, the built image's name asked again, on #1717.** The
question: is `localhost/postgres:18.6-alpine-6b2d97623fb5` tied to what it builds? If not, live
and the OTA stack, on one daemon and one name, would share whatever was built last, and a stack
that had the name would never build a moved base.
- **It is.** `6b2d97623fb5` is neither the Dockerfile's SHA-256 (`c6953866…`) nor the base's
  digest (`898c60cb…`): it is the first twelve hex digits of the SHA-256 of the Dockerfile's
  instruction lines, comments and blank lines left out (`builtTag` in `scripts/idp-pin-watch.mjs`;
  `grep -Ev '^[[:space:]]*(#|$)' deploy/compose/postgres/Dockerfile | sha256sum | cut -c1-12`
  prints it), and `a-database-started-as-root` has compared the three image lines with it since
  `d885817b`. So a changed instruction is a name no stack has: the OTA stack builds `main`'s
  under another name and live keeps its own, and a stack's next `up_wait postgres` finds the new
  name missing and builds it. Comments are left out on purpose: a comment-only edit would
  otherwise rename the image and restart both databases of every stack at its next `up`, for no
  change in what runs.
- **Compose builds a missing image under `pull_policy: never`.** Read in compose's source at
  v5.1.1 and v5.6.1: `up` hands build options for every service in its scope to `create` unless
  `--no-build` (`cmd/compose/up.go`), `build` passes a service by only when its image is present
  and its policy is not `build` (`pkg/compose/build.go`), and `mustPull` is false for `never`
  (`pkg/compose/pull.go`). Run: `build (postgres)` on `186440f4` brought up dev.yml's postgres on a
  runner without the image, every step `success`. Nothing in the bring-up passes `--no-build`.
- **What was missing, now fixed.** (1) A stale name failed as three lines, each saying the name
  to write and none how. Now one failure lists every stale line by file and line and prints the
  `sed` that moves them; the guard runs that `sed` on copies of the compose files and finds them
  whole after it. Red first: with `ENV HISTFILE` changed in the real Dockerfile and the names
  left, the guard failed naming `managed.yml:125` (postgres), `managed.yml:241` (trigger-db) and
  `dev.yml:21`, with the new name `18.6-alpine-d0dcb792c87f`; the printed `sed` applied, it passed
  but for the Dependabot case below; both restored. (2) Inputs the hash does not cover: a parser
  directive (`# syntax=`, `# escape=`, a comment to the hash), COPY, ADD or `--mount`, and a
  `build:` mapping (args, a target) are now refused, each case red with its check removed. The
  context holds the Dockerfile alone. (3) **Dependabot did not read the Dockerfile**: its
  `docker` entry lists `/apps/api`, `/apps/web` and `/apps/selfhost`. It now has an entry of its
  own (`/deploy/compose/postgres`, `chore(postgres)`, no major), the shape #1703 asks of every
  Dockerfile under `deploy/compose`; its pull request fails the guard until the names move, and
  the failure says how. The guard holds the entry; it was red until it was added.

**2026-10-26, later: T15 after its review, three findings, all fixed on #1717.** No fault
was found in how the image starts, in the uids, or in any script that execs into a database, and
the review's own Trivy v0.76.1 runs read the same 1/26 and gosu's 1/25.
- **Every bring-up rebuilt the databases' image, which could restart live's databases outside a
  hold.** The entry below said compose builds the image only when the machine has none of its
  name; that holds for `up`, not for `up --build`, which builds every service in its scope that
  has a `build:`, dependencies included (compose 5.1.1, `cmd/compose/create.go` and `up.go`,
  read in its source). The app phase ran `up -d --build --wait` over a list that names both
  databases, and api and web depend on them. With BuildKit's cache that is the same image ID and
  nothing restarts; from a pruned cache it is a new ID under the same name, the next `up` that
  reaches a database recreates it (`mustRecreate` compares the image label), and live and the OTA
  stack share one daemon. Fixed: the app phase builds `api web` by name (with `GIT_SHA`, and `die`
  when they do not build) and brings its list up through `up_wait`, without `--build`. Every
  command that said otherwise was rewritten to build by name: `setup-zitadel.sh`'s closing hint,
  `setup-managed-demo.sh`'s run order, managed.yml's build comment,
  `docs/managed-bring-up.md` (the app phase, the identity hint, the stage and support-mail
  rebuilds, the after-a-pull sequence), `docs/billing-rehearsal-on-ota.md` (twice) and
  `docs/TROUBLESHOOTING.md` (twice). The Dockerfile, managed.yml's header, the pin watch's
  `builtTag` and the bring-up doc now say when it is built again and why nothing asks.
- **`docker compose pull` failed on the build, and the first `up` asked the host's own port 443
  for it.** No registry serves `localhost/postgres`; compose's default policy pulls a missing
  image first, and a pull of a buildable image is collected into `pull`'s error
  (`pkg/compose/pull.go`). Fixed: `pull_policy: never` on the three services. `pull` passes them
  by, `up` builds a missing one without asking (`build.go` builds when the image is absent,
  whatever the policy), and `--build` would still override it. `docker compose config` resolves
  both files with it (compose v5.6.1 here).
- **No pull request built the Dockerfile.** `images.yml` now has `build (postgres)`, on a pull
  request only (its paths filter includes `deploy/**`): it brings up dev.yml's postgres on a
  runner without the image, so compose builds it, waits for TCP, and checks the image's user is
  `70:70`, that `exec`, the server (PID 1) and PGDATA are uid 70, that gosu is gone, and that
  `psql` answers. It publishes nothing and is not requirable: `every-pr-check-is-classified`
  lists it beside `build`, silenced by the same `paths:` filter (docs/testing.md, ci.yml's
  comment).
- **Guard.** `scripts/a-database-started-as-root.unit.test.ts` gained four tests and a policy
  check: 5 of its 11 failed before the fix (the policy, the thirteen commands, phase_app, the
  missing job). Each regression put back fails it: `--build` on phase_app's `up` (2 tests), no
  `pull_policy` on trigger-db (2), an `up --build` in a document (1), a bare `build` in the
  identity hint (1), the job removed, building with `docker build`, or without its gosu check (1
  each). `identity-in-the-gate.unit.test.ts` now finds the web build by its `build api web`.
- **For E2E (managed) on the branch, in addition:** a second bring-up's app phase shows
  `postgres` and `trigger-db` *Running*, not *Recreated*, and `docker image inspect` gives the
  same ID for `localhost/postgres:18.6-alpine-6b2d97623fb5` before and after it.

**2026-10-26: T15, both PostgreSQL databases of the managed stacks without gosu, merged as
#1717 (`6f9af7f2`)** on 2026-10-28 at 02:22 UTC, from branch
`claude/ownpace-public-readiness-y7orc6-postgres-without-gosu`, stacked on #1678 (whose pin it
builds on, merged before it as `afe17fef`), after the alpha.2 tag, once E2E (managed) run
40616652331 was green on it.
- **What the scan counted.** `postgres:18.6-alpine` at #1678's index digest (`898c60cb…`,
  built 2026-10-21) reads 1 critical and 26 high with Trivy v0.76.1 on arm64 and on amd64 alike:
  25 high and the critical (CVE-2025-68121) are Go 1.24.6's standard library in
  `/usr/local/bin/gosu` (gosu 1.19), and one high is Alpine's brotli-libs 1.2.0-r1
  (CVE-2026-111497, fixed in 1.2.1-r0, which docker-library has not rebuilt 18.6-alpine with
  yet). The appliance's digest (`77f58511…`) is the same image line, Dependabot's.
- **Why gosu can go.** `docker-entrypoint.sh` at that digest runs gosu only when it starts as
  root: as root it chowns every file in PGDATA and `/var/run/postgresql` that uid 70 does not
  own, then re-executes itself through gosu as uid 70. Started as uid 70 it skips both.
- **What was built.** `deploy/compose/postgres/Dockerfile`: that digest, `RUN rm
  /usr/local/bin/gosu`, `PSQL_HISTORY` and `HISTFILE` in `/tmp`, `USER 70:70`. `managed.yml`'s
  `postgres` and `trigger-db` and `dev.yml`'s `postgres` run it as
  `localhost/postgres:18.6-alpine-6b2d97623fb5` with `build: ./postgres`; the twelve hex digits
  are the SHA-256 of the Dockerfile's instruction lines, because compose builds an image only
  when the machine has none of its name. The integration tests start the same base with
  `.withUser('70:70')`. `db-roles.sh` and `stand-up-live.sh` read the build from managed.yml.
  The image scan builds the directory on GitHub's arm64 runner and scans what it built, under the
  category the pulled image had (`postgres-managed`); the pin watch compares the Dockerfile's
  FROM. Guard: `scripts/a-database-started-as-root.unit.test.ts`, with the six it touches.
- **Measured here, without a Docker daemon.** The base's layers for both platforms, read from
  Docker Hub by digest, with one layer added holding only the whiteout for
  `usr/local/bin/gosu` and the config's user set to `70:70` (what the RUN and USER leave),
  scanned as an OCI layout with Trivy v0.76.1: **0 critical and 1 high on arm64 and on amd64**,
  brotli-libs alone. The same layout with the whiteout naming another file reads 1/26, gosu
  included, so the whiteout is what removed it.
- **Run here, as the stacks will run it.** The amd64 image's own root filesystem, its own
  `docker-entrypoint.sh` and PostgreSQL 18.6 binaries, in a chroot with private mount, network
  and PID namespaces, with managed.yml's environment and command: (1) a volume shaped as Docker
  makes a new one (the image's `/var/lib/postgresql`, uid 70, mode 1777), started as root with
  gosu, initialised; nothing in PGDATA was left owned by anyone but uid 70, and only
  `/var/lib/postgresql/18` is root's; (2) gosu removed, the same volume started as uid 70:
  *"Skipping initialization"*, ready, the server uid 70; (3) a new volume started as uid 70:
  initdb as uid 70, everything uid 70's; (4) as uid 70, the scripts' own commands: `psql -U`
  over the socket, `pg_dump --format=custom` and `pg_restore --list` (copy-before-update.sh,
  dump-idp.sh), `pg_dumpall --roles-only`, `pg_dump --format=plain --no-owner` restored into a
  new database (trigger-version.sh's drill), `pg_restore --clean --if-exists --create`, a role's
  password from a psql variable (db-roles.sh), a `PGOPTIONS` session setting, and
  `pg_stat_statements` loaded; every one answered. And the two failures, as the Dockerfile
  says: started as root without gosu, *"exec: gosu: not found"*; a root-owned host directory
  started as uid 70, *"mkdir: can't create directory '/var/lib/postgresql/18/': Permission
  denied"*. An interactive psql and shell as uid 70 wrote their history into the volume's root
  without the two variables, and into `/tmp` with them.
- **Not proven here, and what proves it.** That the Dockerfile builds (no daemon here): E2E
  (managed) on the branch builds it on the Spark, and a dispatch of Security Scan with the image
  scans on the branch builds and scans it on arm64. That the stacks' real volumes start as uid
  70: E2E (managed) runs against the OTA stack's existing volumes, and its first `up` recreates
  both databases on the build. That a new Docker volume initialises as uid 70: the integration
  tests, on both runners, on every pull request that runs them. E2E (managed) run 40616652331
  (2026-10-28, 01:42–02:21 UTC) was green before the merge.
- **Decided against, with the reasons in the Dockerfile and `docs/managed-bring-up.md`.** The
  appliance's Postgres: its pin is Dependabot's, which moves an image line and no build, and an
  appliance may keep its data in a bind mount, which a start as uid 70 cannot initialise.
  Building the image in the integration tests: the build only removes gosu, so starting its base
  as uid 70 runs the same entrypoint path without a build per run. `apk upgrade brotli-libs` in
  the build: it would reach Alpine's mirrors at every build and make the image a function of the
  day it was built. A Debian base: it collates text differently from the musl the databases were
  made under.
  *Revisited 2026-10-31:* both builds take brotli-libs 1.2.1-r0 and libcurl 8.23.0-r0 at exact
  versions, until PostgreSQL 18.7 carries them (0119 Status, #1758).

**2026-10-25: T12a, the web image's nginx on -alpine-slim, built for alpha.3, merged as #1707 (`53fb6453`) on 2026-10-28.** (Numbered T12 until 2026-10-27, when the alpha.3 landing rehearsal found #1708's Node task numbered T12 as well; this one, named in the fewest places, became T12a.)
1.31.8-alpine's one finding in the scan, brotli-libs CVE-2026-111497 (high, fixed in
1.2.1-r0), is in a package -alpine adds over -alpine-slim, with 50 others nothing here loads;
slim reads 0/0 on linux/arm64 and linux/amd64 (Trivy 0.76.1). Branch
`claude/ownpace-public-readiness-y7orc6-nginx-alpine-slim`, based on #1678's, merged after
it, after the alpha.2 tag and not before 19:51 UTC on 2026-10-27, once E2E (managed) run
40626664067 was green on it. T12a's row and 0119's Status entry of 2026-10-25 (evening) have the
measurement.

**2026-10-25, build: T9, the API image carries production dependencies only, for alpha.3,
merged as #1687 (`9480e898`)** on 2026-10-28 at 09:14 UTC, from branch
`claude/ownpace-public-readiness-y7orc6-api-image-prod-deps`. Main was frozen from the alpha.2
fold to its tag; this merged after the tag, once E2E (managed) run 40656320601 and E2E
(self-hosted) run 40661756633 were green on the branch.

- **What changes.** `apps/api/Dockerfile`'s install stage, renamed `deps`, runs
  `pnpm install --frozen-lockfile --prod --filter-prod @openmig/api...`, and the runtime stage
  copies it. `apps/api` now declares drizzle-orm, and `packages/orchestration` drizzle-orm and
  pg: they loaded them through the root's devDependencies, which `--prod` no longer installs. Not
  `pnpm deploy --prod`: it copies the workspace packages into `node_modules`, where Node refuses
  to strip types (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, measured on 2026-10-23).
  `scripts/an-image-that-shipped-what-it-never-runs.unit.test.ts` holds both halves: no stage the
  runtime takes files from installs devDependencies, and every package a runtime file of the
  API's closure loads is in its own package's `dependencies`.
- **Brought up to main** with merge commit `62af1e8d`: Trigger.dev v4.7.6 and the tasks on the
  API image's Node (#1689), body-parser 2.4.0 (#1691) and fast-uri 3.1.9 (#1693) merged without
  a conflict. The `FROM` line `apps/worker/trigger.config.ts` reads is unchanged, so the tasks
  still take the API image's Node. Merged again with `d775def7`, up to `0029db4a`, the MinIO
  swap (#1692): its T7 and T8 rows were taken over this branch's, which had not changed them.
  GitHub runs no pull-request workflow on a branch that conflicts with its base, so without it
  the `--filter-prod` commit below would have had no CI until after the tag.
- **The changelog line sits at the top of `[Unreleased]`, under its own `### Fixed`**, from the
  review of `3f1bc91d`. Under the section's other `### Fixed`, the merge of main after the
  alpha.2 fold met no conflict and filed it under `## [0.2.0-alpha.2]`, crediting alpha.2 with a
  fix its image lacks. At the top, a trial merge with the fold's head (`841d63c0`) conflicts
  right under `## [Unreleased]`, so neither that merge nor GitHub's squash can file it
  silently. Keeping both sides, this branch's first, leaves the line in `[Unreleased]`, and the
  diff against the fold then touches `[Unreleased]` alone.
- **Proved here, on the merged tree, without Docker.** In a copy of the branch made with
  `git archive`, less `.github` as `.dockerignore` says, the runtime stage's install under Node
  24.22.1 (the image's, nodejs.org's archive checked against its `SHASUMS256.txt`) and pnpm
  11.28.6 added 250 packages, body-parser 2.4.0 among them, and no esbuild, TypeScript,
  drizzle-kit, tsx or vitest. Started from that tree with `NODE_ENV=production` and only
  `DATABASE_URL` set, against an empty database on a throwaway cluster from
  `scripts/local-pg.sh`, the API applied both chains itself (65 ledger and 59 managed
  migrations) and answered `GET /health` and `GET /version` with 200. Trivy v0.76.1 (its DB of
  2026-10-25 07:10 UTC), `rootfs --scanners vuln --severity HIGH,CRITICAL`: that tree 0
  critical and 0 high; main's install of the same filter (622 packages) 2 and 65, all of them in
  three Go binaries: esbuild 0.25.12's, counted twice at 1/25, and TypeScript 7.0.2's native
  `tsc`, 0/15. The root `node_modules` went from 375 MiB to 141 MiB (apparent size, hard links
  counted).
- **`--filter-prod`, not `--filter`**, from the review of `76c1db67`. Under `--filter`, pnpm's
  `@openmig/api...` also follows devDependencies, and `@openmig/core` and `@openmig/ledger` list
  workspace packages there. Today those are in the production closure anyway, so both flags
  select the same 9 of 14 projects: in two `git archive` copies of `76c1db67`, the two installs
  each added 250 packages, and their `node_modules/.pnpm` entries and every symlink outside it
  were the same, target for target. In a copy with `@openmig/testing` added as a devDependency of
  core, `pnpm ls -r --depth -1 --filter @openmig/api...` listed it and `--filter-prod` did not;
  the image would have installed a test package's production dependencies past `--prod`. The
  guard now refuses a `--prod` install that selects with `--filter x...`, and its closure walks
  `dependencies`, `optionalDependencies` and `peerDependencies`, the edges `--filter-prod`
  follows; with `--filter` put back in the Dockerfile, two of its cases fail. The boot above was
  not repeated, since the tree is the same.
- **Not proved here.** The image itself, since this session has no Docker daemon: CI's
  `images.yml` builds it on the pull request, and E2E (managed) is what boots, migrates and
  serves it. The cluster here is Postgres 16; the stacks run 18. The image scan has two
  categories for the API (`scripts/image-scan.mjs`): `ownpace-api-edge` reads `main`'s `:edge`,
  and its alerts close at the first Security Scan with image scans on `main` after the merge;
  what should remain is the Node base's, 1/60 on 2026-10-23. `ownpace-api-release` reads the
  newest `v*` tag's image, and alpha.2's is built with the full install, so its esbuild and
  native `tsc` alerts stay open until an image scan after the alpha.3 tag; live, which runs
  tags only, ships them until it runs alpha.3.
- **One-way:** none. No migration and no setting; reverting the Dockerfile and the two
  `package.json` lines restores the full install.

**2026-10-25, build: T12, the images' Node base on Debian 13, with no package manager in the
api and selfhost runtimes, for alpha.3, merged as #1708 (`13e2300e`)** on 2026-10-28 at 10:24
UTC, from branch `claude/ownpace-public-readiness-y7orc6-node-trixie-slim`. It merged after the
alpha.2 tag and after #1687 (T9), which changes the same runtime stage of `apps/api/Dockerfile`,
once E2E (managed) run 40663045583 and E2E (self-hosted) run 40669572838 were green on the
branch. Dependabot's #1713, #1714 and #1715 were closed as superseded by it.

- **What changes.** The three `FROM node` lines (`apps/api`, `apps/selfhost`, `apps/web`) move
  from `node:24.22.1-slim@sha256:16818628…` (Debian 12.15) to
  `node:24.22.1-trixie-slim@sha256:43b9ba11…` (Debian 13.7). That is the index Docker Hub
  serves for the tag: its amd64 (`e79437bb…`) and arm64/v8 (`401346cb…`) images were pushed on
  2026-10-21 at 14:41 UTC and the index last at 17:39 UTC (ppc64le), so it is past the three
  days. The api and selfhost runtime stages remove, in one RUN before `USER`, the whole
  `/usr/local/lib/node_modules` (npm and corepack, all it holds in this base), the npm, npx,
  corepack, corepack's pnpm, pnpx, yarn and yarnpkg links, and yarn 1 under `/opt`. The
  directory goes whole, not by package, since the review of 2026-10-25: named, a base stage
  that installs a package manager with `npm install -g`, as one must once the Node image ships
  no corepack (Node 25 and later), left it in the runtime with the guard green.
  `scripts/a-base-image-that-carried-what-nothing-runs.unit.test.ts` holds the three lines to
  one string whose tag names a Debian release that is not bookworm, the removal before `USER`
  with nothing after it putting a package manager back, and every CMD, HEALTHCHECK and
  ENTRYPOINT of those stages, and every compose `command`, `entrypoint` and `healthcheck` of the
  services built from them, on `node`. Six mutations each turned it red: the web line back on
  `-slim`, all three on `-bookworm-slim`, yarn kept, the removal after `USER`, `corepack enable`
  after it, and `npx` in the self-host compose's healthcheck.
  `scripts/package-appliance.unit.test.ts` read the selfhost line as `-slim@sha256:`, and now
  takes any variant: the version is what the packager reads.
- **Measured here**, Trivy 0.76.1 (DB of 2026-10-25 19:10 UTC), CRITICAL and HIGH, the same on
  linux/amd64 and linux/arm64: `node:24.22.1-slim` 1 critical and 61 high, 4 with a fix;
  `node:24.22.1-trixie-slim` 0 and 48, 4 with a fix, all four in npm; and that image with one
  more layer holding the RUN's removals as whiteouts, assembled as an OCI layout and scanned with
  `--input`, 0 and 43, none with a fix. The 43 are util-linux, 4 CVEs over 9 packages (36
  findings), libsystemd0 and libudev1 (2), ncurses (3), perl-base (1) and libacl1 (1); perl-base
  and util-linux are Essential packages. The 5 that leave are npm's bundled undici 6.28.0 (2),
  brace-expansion 5.0.9 (2) and http-cache-semantics 4.2.0 (1). `/usr/local/bin/node`, read out
  of both images' layers, is the same file in both: sha256 `e32e2d16…` on amd64 and `c8c57216…`
  on arm64. So the tasks' layer, which copies the Node of the API's FROM image
  (`apps/worker/trigger.config.ts`), gets the same bytes, and that file's comment, which
  already allowed a trixie Node on the base image's bookworm, needed no change.
- **What still works, read in the trixie image's layers:** bash and dash, `printenv`,
  `useradd`, `chown`, `cp` and `mkdir`, and `docker-entrypoint.sh`, so the images'
  HEALTHCHECKs, the self-host compose's `CMD-SHELL` healthcheck, the runtime RUNs and the
  `docker exec` sites (`printenv` in `e2e-managed.yml`, `deploy-live.sh`, `stand-up-live.sh`
  and `smoke-managed.sh`; `node -e` in `smoke-managed.sh`; `sh -c` with `printf` in
  `docs/ending-the-alpha.md` and with `ls` in `scripts/upgrade-drill.sh`) are unchanged.
- **Expected after it merges.** The scan's `ownpace-api-edge` and `ownpace-selfhost-edge` read
  about 0/43 at the first Security Scan with image scans on `main` (the API's with T9's `--prod`
  install, whose `node_modules` read 0/0). `ownpace-api-release`, `ownpace-selfhost-release`
  and live follow with the alpha.3 tag; alpha.2's images keep the Debian 12 base. The first
  task deploy after the merge misses the `trigger` builder's cache, because the `COPY --from=`
  text changes: it runs apt in both of the CLI's stages, takes longer and needs the Debian
  archive.
- **Built, not booted here.** This session has no Docker daemon. CI's `build (api)`,
  `build (selfhost)` and `build (web)` built all three images on linux/amd64 at the branch's
  `f7faa08b` (Images run 40233342532), so `useradd`, `chown`, the RUN and the selfhost
  stage's full `pnpm install` work on trixie; a pull request builds amd64 only. E2E (managed)
  and E2E (self-hosted) build and boot them on the arm64 runners, and the push to `main` builds
  both architectures.
- **Left out.** Distroless `nodejs24-debian13` (0/0, Node 24.22.1) for the API alone: no shell
  or `printenv` for seven script sites and four doc lines, Node off `PATH`, no RUN in the
  runtime stage, and no exact version tag to pin beside the digest; a decision of its own after
  alpha.3 (since: T13, in alpha.3 with T13a, the owner's decision of 2026-10-26). Alpine (0/5): a musl Node, which the tasks' bookworm image cannot take. Chainguard's
  free `node:latest` is Node 26, a major `engines` and Dependabot's ignore rule refuse. An
  `apt-get upgrade` at build: neither Debian base has an OS finding with a fix today, and it
  would make two builds of one commit differ.
- **One-way:** none. Reverting the three lines and the two RUNs restores the old base.

**2026-10-25: T7 merged, and alpha.2 is folded.** Chainguard's MinIO merged as #1692 at 11:38 UTC
(`0029db4a`), after E2E (managed) #281 on its branch was green (11:26 to 11:37 UTC):
`chainguard/minio` at its index digest came up healthy on the new volume `minio_data_v2`,
`minio-init` made `store/packets`, the API reached it on the stack network, and the smoke passed.
The OTA's Bitnami-era `minio_data` stays on disk until the owner removes it, after a green run of
`main` with the change (T27 of the owner's steps holds the read-only checks). Live takes it from
`v0.2.0-alpha.2`, after the task runner's drain, starting empty. The CHANGELOG fold, the last
merge before the two counted nights, carries it.

**2026-10-25, built: Stalwart v0.16.27, T11 (b), merged as #1698 (`29d1d7e0`) on 2026-10-28**
from branch `claude/ownpace-public-readiness-y7orc6-stalwart-0-16-27`, after the alpha.2 tag. The
owner decided yes on 2026-10-25. ADR-0022 records the decision in a dated update and an operative
bullet, AGENTS.md now says the pin moves only that way, and `docs/stalwart-integration-fix.md`
names the new pin and, under "Moving the pin", the rule and the checklist for the next move.

- **Moved together:** `IMAGE` in `deploy/selfhost/setup-stalwart.sh`, both phases in
  `packages/testing/src/testcontainers-setup.ts`, `packages/testing/fixtures/stalwart/Dockerfile`
  and `STALWART` in `scripts/a-service-that-phones-home.unit.test.ts`, the four copies the pin
  watch reads, with the comments, `docs/testing.md` and `e2e.yml`'s header that named v0.16.10.
  Nothing pins `stalwart-cli`: CI, `e2e.yml` and `e2e-managed.yml` install the installer's
  `latest`, v1.0.13 of 2026-09-28, which main has run against v0.16.10 since. `managed.yml` does
  not run Stalwart.
- **Read upstream:** Stalwart's changelog v0.16.11 to v0.16.27 (nothing this repository uses is
  renamed; v0.16.26's x86-64-v2 floor for x86_64 images; v0.16.22's clear-text `AUTHENTICATE`
  refusal and `r` right for a shared mailbox), `defaults.rs` and `application.rs` at v0.16.27
  (the WebUI from release v1.0.11 and in recovery mode too; ASN lists from
  `github.com/sapics/ip-location-db` on a new database, jsDelivr kept on an old one, which
  `stalwart-cli snapshot` read back), and `stalwart-cli`'s changelog to v1.0.13. Docker Hub pushed
  v0.16.27 on 2026-10-18 at 19:26 UTC (index `sha256:c429b311…`), so CONTRIBUTING.md's three
  days passed on 2026-10-21.
- **Proved here,** with a local Docker daemon on x86_64: `setup-stalwart.sh` at v0.16.27, five
  upserts, IMAPS and a JMAP session; the eleven integration files that use Stalwart and not
  Nextcloud, 44 tests passed; `scripts/jmap-target-spike.ts`, `recurrenceRules` still refused on
  all three rungs, so 0031 T1 stays parked; and one volume made at v0.16.10, taken to v0.16.27,
  back and forward again, mail and contacts read back each time. So no step is one way: a
  branch's E2E (managed) leaves the OTA demo's volume usable for main's next night.
- **CI on the pull request, green at `06ca97c8`:** every check passed, `integration-tests` on
  `ubuntu-24.04` and on `ubuntu-24.04-arm` included, so a GitHub-hosted x86_64 runner has the
  x86-64-v2 floor, and arm64 ran v0.16.27 for the first time. A review then found no blocker;
  its fixes (the port comment, `docs/testing.md` and the two SMTP comments now say 25 and 4190
  are bound but not published, and that the tests reach SMTP only as SMTPS on 465; "Moving the
  pin" asks for a `git grep` of the old tag) and a merge of `main` after #1692 followed.
- **Before the merge:** after the tag, merge `main` again, keeping the `CHANGELOG.md` line under
  the new `[Unreleased]` and not in the alpha.2 section; then E2E (self-hosted) and E2E (managed) on the
  branch. Watch their logs for *"other side closed"* on a JMAP request: v0.16.24 started closing
  idle HTTP keep-alive connections (*"HTTP: Idle keep-alive connections are never closed."*,
  under Fixed), and a reused socket would fail that way. CI's integration run did not show it.
  E2E (managed) run 40635727901 (2026-10-28, 05:03–05:41 UTC) was green before the merge.
- **Not in this:** switching Stalwart's downloads off (0139's follow-up) and pinning
  `stalwart-cli`.

**2026-10-25, build: T11 (a), Mailpit v1.31.6 → v1.32.0, for alpha.3, merged as #1699
(`e33d7902`)** on 2026-10-28 at 04:53 UTC, from branch
`claude/ownpace-public-readiness-y7orc6-mailpit-1-32-0`; refs #1671, the pin watch's summary
issue, which lists Mailpit v1.31.6 as behind v1.32.0 (it stays open for Stalwart, T11 (b)). Main
was frozen from the alpha.2 fold to its tag; this merged after the tag, once E2E (managed) run
40631369534 was green on it.
- **The pin.** `axllent/mailpit:v1.32.0@sha256:0790692b…` in `managed.yml`, the index digest
  Docker Hub's tag listing gives and a HEAD of the tag on `registry-1.docker.io` returns (an OCI
  index: amd64, arm64 and 386). `scripts/a-service-that-phones-home.unit.test.ts` pins the same
  reference. No other file runs Mailpit: no `dev.yml` service, no Testcontainers setup, no
  workflow; `docs/managed-bring-up.md`'s *Nothing phones home* row, 0119's inventory row and an
  example in `idp-pin-watch.mjs`'s comment move with it. The released `CHANGELOG.md` line naming
  v1.31.6 and the release fixture that copies it stay as written.
- **Why.** v1.31.6's binary is built with Go 1.27.2 and v1.32.0's with Go 1.27.3 (`go version -m`
  on `/mailpit` from each image's amd64 layer). Go 1.27.3 is two commits on go1.27.2, one of
  them *"crypto/x509: distrust a handful of intermediates … Fixes CVE-2026-111943"* (golang/go
  `90617fb`), the finding the 2026-10-23 triage read on v1.31.6 (0/1) and not on v1.32.0 (0/0).
  Mailpit's own release closes a second hole, GHSA-379p-g4f4-hq5h (high, CVSS 7.5, every version
  to v1.31.6, read on GitHub): `GET /api/v1/message/{ID}/part/{PartID}/thumb` read an image
  attachment's EXIF with goexif, whose walker caught only a directory that points at itself, so a
  JPEG whose directories point at each other held the request in a loop, a core busy and memory
  growing until the process was killed; v1.32.0 replaces goexif with a small orientation reader.
  Here that needed a mail from this stack's own services, since SMTP is not published, or a caller
  of the web port, which is on loopback unless `MAILPIT_BIND` names another address. The release
  also strips `<base>` and `<meta http-equiv="refresh">` tags from the `/view/{ID}.html` output.
  The image is Alpine 3.24.3.
- **Read:** Mailpit's `CHANGELOG.md` at v1.32.0 and `git diff v1.31.6 v1.32.0` (24 commits).
  The release check is as it was: `internal/stats/stats.go` and `cmd/root.go` did not change, so
  `MP_DISABLE_VERSION_CHECK` still answers `"disabled"` before any request, and the variable is
  still read as `1`, `true` or `yes`. The webhook, the HTML and link checks and the screenshot
  proxy did not change either. The API the smoke and `setup-zitadel.sh` read (`/api/v1/messages`,
  `/api/v1/search`) did not change, nor did `/mailpit readyz`, the healthcheck. New: SMTP, POP3
  and HTTP each hold back or refuse a connection past 1 000 open at once
  (`internal/connlimit`), far above what the gate opens.
- **One schema step, not one way.** The first start on the kept `mailpit_data` volume applies
  `internal/storage/schemas/1.32.0.sql` to `mailpit.db`: the index `idx_message_tags_id` is
  dropped and made again on `(ID, TagID)`, and a row `1.32.0` goes into its `schemas` table.
  v1.31.6 opens that file if rolled back: `dbApplySchemas` applies only the scripts it carries
  that have no row yet, so a row it has no script for changes nothing, and the index keeps its
  name and still leads with `ID`.
  Nothing to do before or after.
- **Three days.** The tag was pushed at 2026-10-22T22:13:49Z (Docker Hub's `tag_last_pushed`;
  upstream's release commit `ce798cfd` is from 22:02Z), so it is three days old at
  2026-10-25T22:13Z, before this can merge.
- **Proved here:** the 115 guards in `scripts/` that read `managed.yml`, Mailpit, or a file this
  changes pass (3 682 tests); with the old pin put back in `managed.yml`, the phone-home guard
  fails on the Mailpit row, as it should. `node scripts/idp-pin-watch.mjs` on the branch reads
  *"axllent/mailpit v1.32.0 v1.32.0 current"*. Not proved here: a stack running v1.32.0.
  That is E2E (managed), on the OTA stack, where Mailpit is the catcher every mail assertion of
  the smoke reads.
- **Main merged in, 2026-10-25.** #1692 (Chainguard's MinIO) merged after the branch was cut and
  rewrote the rows next to Mailpit's, so the branch merged main: the bring-up table and the
  phone-home guard's header keep main's MinIO row and this Mailpit row, the `CHANGELOG.md` keeps
  both entries, and the index is regenerated. The guards were run again on the merge.
- **One draft at a time on the OTA stack.** E2E (managed) brings up the dispatched branch's
  `managed.yml` on the one OTA stack, so a head that lacks a merged change rolls that change back
  there (this branch before the merge would have put `bitnamilegacy/minio` back on the old
  `minio_data` volume), and a head that lacks another draft's change undoes that draft's E2E
  (Trigger.dev v4.8.1, #1697, downgraded to v4.7.6 against a database v4.8.1 had migrated). So
  the drafts for alpha.3 go one at a time: one draft's E2E, then its merge; the next merges main
  before its own E2E. This one merges main again after the fold (#1706) and the alpha.2 tag, and
  its E2E is dispatched only on a head that holds the tag's commit. A nightly on `main` between
  that E2E and the merge puts v1.31.6 back on the database v1.32.0 changed, the rollback read
  above and not run. Text: #1698 (Stalwart) changes this same T11 row, so whichever merges second
  keeps (a) from this and (b) from that; #1697 and #1698 also meet this in `CHANGELOG.md`, #1697
  in 0119, and the fold in this Status block and the index.

**2026-10-25, build: T10, the image scan reads the tasks' image as a deploy builds it, for
alpha.3, merged as #1700 (`ee9be30f`)** on 2026-10-27 at 23:53 UTC, from branch
`claude/ownpace-public-readiness-y7orc6-tasks-image-scan`. Main was frozen from the alpha.2 fold
to its tag; this merged after the tag, once CI was green. It changes the weekly
image scan and nothing a stack runs, so no E2E reads it; the proof is a dispatch of Security Scan.

- **What the leg reads now.** The leg named `trigger-task-base` builds the `base` stage of the
  Containerfile a task deploy writes, and Trivy scans that. `scripts/image-scan.mjs containerfile
  <base>` imports `apps/worker/trigger.config.ts`, runs its build extensions as the CLI does (every
  `onBuildStart`, then every `onBuildComplete`, with `target: 'deploy'`) and writes
  `FROM <base> AS base`, `ENV DEBIAN_FRONTEND=noninteractive` and each layer's
  `image.instructions` in order: today the API image's Node copied over the base image's, and
  `apt-get -y upgrade`. So nothing in the scan repeats an instruction or a version. The base is
  still the one the list reads from the CLI that `apps/worker/package.json` pins, so the v4.8.1
  branch moves it with no change here. The leg runs on `ubuntu-24.04-arm`, GitHub's arm64 runner
  (free on a public repository, as ci.yml's integration tests already use it), so the build is
  native for linux/arm64, the platform every leg scans; it installs the workspace first, because
  the config imports `@trigger.dev/sdk`. Trivy reads the image from that runner's Docker alone
  (`TRIVY_IMAGE_SRC` is `docker` on that leg), so a build that left nothing cannot be read from a
  registry instead. Every other leg is as it was.
- **The category stays `trivy-image-trigger-task-base`.** The name is kept and now means the
  stage it is: the CLI's `base`, which every later stage starts from. The first image scan on
  `main` after the merge (Monday's schedule, or a dispatch on `main`) uploads the built stage's
  findings under it, and code scanning closes every alert that analysis no longer has. Nothing is
  deleted by hand, and the release preflight's grouped note drops with it. The local tag is in the
  base's own repository, `triggerdotdev/node:trigger-task-base-built` (`taskBuildTag`), never
  pushed: Trivy's SARIF gives a Debian finding the image's repository as its location and no
  fingerprint, so code scanning tells alerts apart by rule and location. The first draft's
  `trigger-task-base:built` would have moved every Debian alert to `library/trigger-task-base`:
  all of them closed on the first scan, fixed or not, and the unfixed ones opened again under new
  numbers, their triage left behind (found in review). The base read 14
  critical and 119 high on 2026-10-25 (Security Scan #4763), and the triage of 2026-10-23 worked
  out from the base's report that the upgraded image would keep 2 critical and 87 high (T10's
  row): the dispatch says what it reads. What stays: zlib1g's CVE-2023-45853, which has no fix,
  and npm's own bundled packages under `/usr/local/lib/node_modules/npm`, tar 7.5.15's
  CVE-2026-59873 the critical among them, since the layer copies only the Node binary.
- **What it leaves out, and says so.** The CLI's two steps after the layers install nothing
  (an `apt-get --fix-broken install` and the CA trust edits). The task code and the externals the
  CLI installs with `npm i` (`pg`, `@electric-sql/pglite`) are npm packages: their own versions
  are the ones installed here, which the repository scan of the lockfile reads, and what npm
  resolves under them at a deploy neither scan reads. A layer with `image.pkgs` is refused, since
  the CLI installs those in this stage; so is any throw in an extension, which the CLI would log
  and deploy past. A deploy that the CLI's builder serves from its cache keeps the Debian packages
  of the build that filled it, so the scan can read newer packages than a stack runs, as with a
  floating tag; the summary says so under the table. The base is the CLI's own: an instance can
  name others for its deploys (the webapp's `DEPLOY_BASE_IMAGES` and `DEPLOY_BUILD_BASE_IMAGES`),
  and `managed.yml`, which hands its Trigger.dev services only the keys it lists, sets neither;
  the guard holds that. The Containerfile has no `# syntax=` line, though the CLI's has one: it
  would pull the floating `docker/dockerfile:1` frontend on every scan, and the stage needs
  nothing beyond the builder's own.
- **After the second review (2026-10-25).** The leg checks the repository out under `src/` and
  installs and builds there. Trivy reads a `.trivyignore` and a `trivy.yaml` from its working
  directory when trivy-action names neither (it sets `TRIVY_IGNOREFILE` and `TRIVY_CONFIG` only
  when asked), and the Trivy step and `trivy convert` run in `$GITHUB_WORKSPACE`, which on this
  leg alone was the repository's root: a file there would have dropped findings from this leg's
  SARIF, and code scanning would have called them fixed. Neither file exists today; reproduced
  with Trivy v0.76.1's `trivy convert` on a one-finding report. A failed install or build is now
  named in the leg's last step (the `install` and `build` outcomes, counted only when `failure`
  or `cancelled`, since the other legs skip both), where before it read only as the Trivy step
  ended `skipped`. And the guard holds the three jobs' `if:` whole: it held them to contain the
  condition, which `github.event_name == 'pull_request' || <the condition>` also does.
- **Read for this:** trigger.dev 4.7.6's npm tarball, `dist/esm/deploy/buildImage.js`
  (`generateNodeContainerfile`, `parseGenerateOptions`, `BASE_IMAGE`) and
  `dist/esm/build/extensions.js` (the order the hooks run in, and `onBuildComplete`'s errors
  logged, not thrown) and `dist/esm/commands/deploy.js` (`applyServerBaseImages`, with
  `supportsInstanceBaseImages: true`); the webapp's `apps/webapp/app/env.server.ts` at v4.7.6
  (`DEPLOY_BASE_IMAGES`, `DEPLOY_BUILD_BASE_IMAGES`); trivy-action v0.36.0's `action.yaml` and `entrypoint.sh` (`image-ref` is
  the positional reference, `TRIVY_IMAGE_SRC` passes through), and Trivy v0.76.1's
  `pkg/fanal/image/daemon.go` (an image from Docker is inspected by name, `--platform` not
  consulted) and `pkg/report/sarif.go` (`ToPathUri`: an operating-system finding's location is
  the image's repository, with Docker Hub's `library/` for a one-part name). GitHub's changelog of 2025-08-07: arm64 hosted runners are generally available
  and free in public repositories.
- **Proved here:** `scripts/an-image-nobody-scanned.unit.test.ts`, 43 tests, among them the
  built stage against the config's own layers, the CLI's hook order, the refusals, the command
  line under plain Node, a pin move of the SDK that keeps the name and the build tag, the
  build tag's SARIF location against the base's (Trivy's rule written out, with the first
  draft's tag as its vacuity case), `managed.yml` naming no instance base image, and the
  workflow's five build steps on that leg alone. Each of three mutations of `image-scan.mjs`
  (hooks interleaved, the `pkgs` refusal gone, the `build` field gone) failed exactly its case in
  the first draft, and each of three after the review does in this one (the first draft's tag
  back, the `# syntax=` line back, a `DEPLOY_BASE_IMAGES` in `managed.yml`). After the second
  review, each of five mutations of the workflow fails exactly one case: the checkout back at the
  root, the Trivy step moved into `src/`, a pull request added to the scan's `if:` and to the
  report's, and the install's outcome dropped from the last step.
  Not proved here: the leg itself. No workflow was dispatched from this session; a dispatch of
  Security Scan on this branch with `image_scans` on runs it, and its SARIF goes to the branch's
  ref, not `main`'s.
- **One-way:** none. Reverting restores the base-image scan, and its next upload under the same
  category reopens what the base has.

**2026-10-25, build: the cosign that signs and checks the images is named, v3.1.4, where
cosign-installer's default gave v3.0.6, for alpha.3, merged as #1702 (`3188e9e1`)** on
2026-10-27 at 22:22 UTC, from branch
`claude/ownpace-public-readiness-y7orc6-dependabot-invisible-pins`. Main was frozen from the
alpha.2 fold to its tag; this merged after the tag, once CI was green. #1671 listed it under
*Also known*: *"cosign: cosign-installer v4.1.2 installs v3.0.6 (its default), and the newest
cosign is v3.1.4"*. Its two other rows, Mailpit and Stalwart, are T11 (a) and (b), merged as
#1699 and #1698.
- **The pin.** `cosign-release: 'v3.1.4'` in `images.yml`'s *Install cosign* step, whose cosign
  signs every published image by digest, and in `release.yml`'s verify job, whose cosign checks
  those signatures. Nothing would have moved it: v4.1.2 is cosign-installer's newest release and
  still installs v3.0.6, and its main branch says v3.1.3, unreleased. Dependabot moves the
  installer, never an input.
- **The watch.** A named cosign is a pin nothing else moves, as Trivy's is, so
  `idp-pin-watch.mjs` reads it as a routine row from both files (`COSIGN_FILES`), held together
  (*the copies disagree* when they do), against cosign's tags of its major. Left to the
  installer's default it stays the status line it was. Run on the branch,
  `node scripts/idp-pin-watch.mjs` reads *"cosign v3.1.4 v3.1.4 current"* and prints no status
  line. `a-pin-that-knows-it-is-behind` gains three cases and changes three; with `release.yml`
  set back to v3.1.3 six fail.
- **Read:** cosign's release notes from v3.0.6 to v3.1.4. v3.1.0 was never published and
  v3.1.1 is identical to it: signing runs through sigstore-go, the protobuf bundle (the default
  since v3.0) is the format for signing and verifying, and flags for trust material given by
  hand are deprecated. v3.1.2 deprecates `--payload`; v3.1.3 fixes GHSA-fx35-mq7g-6g98; v3.1.4
  deprecates `--use-signing-config` and fixes signing and verify bugs. The workflows use
  `cosign sign --yes` on a digest and `cosign verify` with an identity or identity regexp and
  the OIDC issuer, and neither form is deprecated. GHSA-fx35-mq7g-6g98 (high, up to v3.1.2) is
  a bypass of `verify-blob` with a legacy JSON bundle. The advisory says `cosign verify` of a
  container image and the protobuf bundle are not affected, so this is routine and not a
  security move here.
- **What naming the release costs.** Left to its default, cosign-installer checks the v3.0.6
  binary against a hash its `action.yml` carries. With a release named, it downloads v3.1.4 and
  checks it with the bootstrap v3.0.6's `verify-blob --bundle`, once keyless and once with
  `--key` (`action.yml` at the pinned commit). v3.0.6 reads any bundle that is not a protobuf
  one as a legacy bundle (`checkNewBundle` in `cmd/cosign/cli/verify/verify_bundle.go`), and
  that is the path GHSA-fx35-mq7g-6g98 covers: a crafted legacy bundle skips the identity
  check, and its embedded key replaces `--key`. So that check is weaker than the hash, in front
  of a job that holds `packages: write` and `id-token: write`. What holds it is that v3.1.4 is
  an immutable release (its page: *"Immutable release. Only release title and notes can be
  modified."*), so its assets cannot be swapped after publication, and its binary was checked
  here against `cosign_checksums.txt`. A hash check of our own after the installer was not
  added: the sign step does not run on a pull request, so a later move of the release that
  missed the hash would fail only on `main`, after the images are pushed unsigned.
- **Waited for.** v3.1.4 was published 2026-10-20 at 18:27:42 UTC (the release feed's
  `updated`; its assets' `Last-Modified` is 18:02 to 18:04 UTC), three days old on 2026-10-23
  at 18:27 UTC.
- **Proved here, by hand, the installer's own path for a named release.** The bootstrap v3.0.6
  binary hashes to the `c956e5df…` v4.1.2 carries; `release/release-cosign.pub` at v3.1.4
  hashes to its `f4cea466…`; v3.0.6's `verify-blob` reads *"Verified OK"* for v3.1.4's
  `cosign-linux-amd64` with both its keyless bundle and its KMS-key bundle; the binary's hash
  is the one in `cosign_checksums.txt`, and it reports `GitVersion: v3.1.4`. The trusted root
  was sigstore/root-signing's `targets/trusted_root.json`, given as `--trusted-root`, because
  the session's network refuses the TUF host; on a runner the installer reads it from TUF.
- **Not proved here.** No signature has been made with v3.1.4, and v3.1.4 has not checked one
  made with v3.0.6: a signature's bundle is a blob ghcr hands out from a host the session's
  network refuses, so both versions read *"no signatures found"* here, for that reason alone. The
  pull request runs neither step. The first signing is `images.yml` on the merge commit, which
  every push to `main` starts, and its sign step fails loud. The first check is the next
  release's verify job, or a `verify` dispatch of Release from `main` on alpha.2 after this
  merges (the owner's call). It cannot be run before: Release refuses a dispatch from any
  branch but `main` (`dispatchedFromMain` in `release-preflight.mjs`).
- **One way:** nothing. Going back is the two `cosign-release:` lines.

**2026-10-24: T7 answered and being built.** The owner, on 2026-10-23 at 19:05 UTC: *"T7 no,
fix already within the alpha"*. The frozen `bitnamilegacy/minio` is not accepted for the Alpha.
Chainguard's maintained MinIO replaces it on branch
`claude/ownpace-public-readiness-y7orc6-object-store-swap`, not merged: by index digest, on a
new volume, with a one-shot that makes `packets`, and the guard §3 T7 asked for. It needs E2E
(managed) on the branch before it merges, then live from the tag that carries it, starting
empty. T7's row, §3 T7 and 0119's Status entry of 2026-10-24 have the detail.

**2026-10-24, merged: Trivy v0.76.1 in both Security Scan steps**, as #1685, from branch
`claude/ownpace-public-readiness-y7orc6-trivy-0-76-1`. T8's watch named it in
#1671: *"`Trivy` (.github/workflows/security-scan.yml): v0.76.0, newest **v0.76.1**"*. The
filesystem scan and the image scan move together, as `an-image-nobody-scanned` holds them.
v0.76.1, tagged 2026-10-21, is v0.76.0 with three dependency groups backported from Trivy's
main line: the AWS SDK for Go (six modules), Docker's and moby's (buildkit 0.34.0, the moby API
1.56.1 and client 0.6.1) and a common group (azcore 1.23.3, go-getter 1.8.10, go-redis 9.23.0),
each with its indirect modules. Between the two tags only `go.mod`, `go.sum` and the release's
own files change, so detection and the report formats are v0.76.0's. trivy-action installs it
with setup-trivy's `install.sh`, which checks the archive against the release's own
`trivy_0.76.1_checksums.txt`; this repository pins no checksum of its own for Trivy.

- **Proved here.** Moving only the filesystem scan's pin failed four cases: the image scan's
  *same named Trivy* in `an-image-nobody-scanned`, and three of `a-pin-that-knows-it-is-behind`'s
  routine-pin cases, which read the lower pin as behind. With both moved, the three guards pass
  (102 tests). `node scripts/idp-pin-watch.mjs` on the branch reads *"Trivy v0.76.1 v0.76.1
  current"*.
- **Waited for.** The release is three days old, CONTRIBUTING.md's age, on 2026-10-24 at 11:18 UTC,
  when its assets came out: `trivy_0.76.1_checksums.txt` was uploaded at 11:18:28 UTC
  (its `Last-Modified`), the Linux archive at 11:18:17 and Docker Hub's `aquasec/trivy:0.76.1`
  at 11:16:41. The tag's commit, e713f67f, is from 10:20 UTC, the tag's own time only. The
  merge waited for 11:18 UTC. The pull request's `Trivy` check is the first run of v0.76.1 (the
  filesystem scan, on a GitHub-hosted runner); the image legs run it first on a dispatch of
  Security Scan or on Monday's schedule. #1671 stays open for its other rows, and the watch's
  next run drops the Trivy row.

**2026-10-23, recorded: the open code-scanning alerts read and triaged before the
fold, and their follow-ups made T9 to T11.** Release run 7 (Actions run
39928937434), `preflight` for `v0.2.0-alpha.2` on `main` at `47bf5c13` at 09:02
UTC, was the first to print #1683's grouped note: *"69 critical and 1330 high
code-scanning alert(s) open on main, in 18 group(s) by tool and category below:
reported, not refused"*. Every group is one image's `trivy-image-<name>`
category. The repository's own filesystem scan has none open, and `trivy fs
--include-dev-deps` over `pnpm-lock.yaml` read 0 critical and 0 high the same
day. A group counts each alert once, under the category of its most recent
instance, so an alert several images share sits in one of them and the groups
do not add up image by image: the edge images have no group, and the
supervisor's 0/6 is less than its own scan's 3/58. Security Scan #4726 (run
39927323151, dispatched on `main` at `54e4c3d2` at 08:48 UTC with image scans)
gave each image's own count, linux/arm64, and closed the alerts #1657's pins
had fixed: pgbouncer's, gatus's, mailpit's and most of the registry's.

- **Each group, by exposure and by what alpha.2 changes.** Exposure is
  `managed.yml`, `www.yml` and `deploy/selfhost/compose.yml` as they stand,
  every port on `127.0.0.1` or a `*_BIND` variable, and live as it runs: the
  web app (whose nginx proxies the API), Zitadel, Gatus and www are reached
  from the internet through the host's reverse proxy, and nothing else is.
  "alpha.2" assumes #1680 (Zitadel v4.20.0) and the Trigger.dev v4.7.6 branch
  (`claude/ownpace-public-readiness-y7orc6-trigger-4-7-6`) merge before the
  fold, as planned; neither has yet. Counts are critical/high.

  | Group, open on `main` | From the internet | What alpha.2 changes | Then |
  |---|---|---|---|
  | `minio` 26/259 | no: publishes no port | nothing | T7, the owner's |
  | `trigger-task-base` 13/105 | no: the tasks' runtime | v4.7.6 upgrades the built image, but the scan reads the base: open | T10 |
  | `trigger.dev` 10/278 | no: dashboard behind `trigger-tls`, loopback or the mesh | v4.7.6: 13/286 → 9/245 by image | the next Trigger.dev move (T8) |
  | `ownpace-api-release` 7/136 | yes, through the web app's nginx | the scan reads alpha.2's image; `:edge` reads 3/125 | T9, for 2/65 of it |
  | `nextcloud` 4/237 | no: the demo and test target | nothing | none has a fix |
  | `ownpace-selfhost-release` 4/61 | no: not on live; `SELFHOST_BIND`, loopback unset | alpha.2's image; `:edge` reads 1/60 | the Node base's, 3 with a fix |
  | `stalwart` 3/114 | no: the test fixture (`setup-stalwart.sh`) | nothing | T11 (b), the owner's |
  | `redis` 1/57 | no | nothing | none has a fix; stays on `7.4-bookworm` (0119) |
  | `postgres-managed` 1/25 | no: loopback or `POSTGRES_BIND` | nothing | all 26 are in `gosu`'s Go and have a fix upstream; today's build of the tag carries none of them |
  | `zitadel` 0/14 | yes | v4.20.0 (#1680): 0/0 | — |
  | `gatus` 0/11 | yes | nothing | stays: v5.37.0 is the newest release |
  | `docker-socket-proxy` 0/6 | no | nothing | stays: v0.5.0 is the newest release |
  | `registry` 0/6 | no: loopback | nothing | stays: 3.1.2 is the newest |
  | `supervisor` 0/6 | no | v4.7.6: 3/58 → 3/56 by image | with Trigger.dev |
  | `caddy` 0/5 | no: `trigger-tls`, loopback or the mesh | nothing | stays: 2.11.7 is the newest |
  | `ownpace-web-release` 0/5 | yes | alpha.2's image; `:edge` reads 0/0 | — |
  | `clickhouse-server` 0/4 | no | nothing: 26.2 is accepted for the Alpha | T11 (c), after the Alpha |
  | `mailpit` 0/1 | no: the mail catcher | nothing | T11 (a) |

- **None of it blocks the tag.** Under decision 11 open alerts are reported and
  never refused, because the pull request's `Trivy` check already blocks a new
  one and the advisory gate is what refuses a tag.
- **Two exposed findings outside the Node base remain after alpha.2.** Gatus:
  11 high, each with a fixed version upstream, and v5.37.0 is the newest
  release, so there is nothing to move to. And the API image's dev tools: if
  alpha.2's image reads like `:edge`'s 3/125, then 1/60 is the base's
  (`node:24.22.1-slim`, Debian 12.15: 3 with a fix, and the critical, zlib's
  CVE-2023-45853, is in minizip, which `zlib1g` does not ship) and 2/65 are Go
  binaries in `node_modules` that the image carries and never executes:
  esbuild 0.25.12 (built with Go 1.23.12; drizzle-kit 0.31.11's own `^0.25.4`
  and `@esbuild-kit/esm-loader`'s), 1 critical (CVE-2025-68121) and 25 high,
  each counted twice (`esbuild/bin` and `@esbuild/linux-*`); and TypeScript
  7.0.2's native compiler (`@typescript/typescript-linux-*`, Go 1.26.4), 13 high
  in the standard library and 2 in `golang.org/x/text`. They are there because
  `apps/api/Dockerfile`'s runtime stage copies the build stage's whole `/app`,
  where `pnpm install --filter @openmig/api...` installed devDependencies too;
  `CMD` is `node apps/api/src/index.ts`. T9.
- **The other internet-facing images.** Zitadel v4.20.0 read 0/0 on #1680's
  branch (Security Scan run 39927406125; v4.19.5: 0/14). The web image and
  www float `nginx:1.31-alpine`, which read 0/0 as Docker Hub serves it today,
  1.31.8 (Alpine 3.24.3). That need not be the copy live runs: nothing
  re-pulls a floating tag, which is #1678's premise, so www runs whatever the
  box pulled last, and the web image takes what the tag serves when its build
  runs. 1.31.7-alpine (`892bb215…`, Alpine 3.24.2) has two high, libexpat
  CVE-2026-77214 and libx11 CVE-2026-88806, two of alpha.1's web image's five.
  Draft #1678 now pins 1.31.8 (`1ef7ca94…`, commit `93364f90`) and merges
  after the launch, as its body says, so alpha.2 does not carry the pin; 0119's
  nginx row says so on that branch.
- **Trigger.dev v4.7.6, read on its branch** (Security Scan run 39927368805):
  the webapp 9/245, 189 with a fix (v4.7.2: 13/286, 234), and the supervisor
  3/56, 55 (3/58, 57). Its repository-scan job was red only because pnpm's
  three-day floor (`minimumReleaseAge: 4320`) refuses `@trigger.dev/core` and
  `@trigger.dev/sdk` 4.7.6 until about 18:25 UTC on 2026-10-23 by the publish
  times pnpm itself prints (npm's full metadata says 18:30), so by 18:31 UTC
  at the latest. The branch overlays the tasks' image with `apt-get -y
  upgrade` at build, which fixes the 42 Debian findings that have a fix: 30
  high and 12 of `trigger-task-base`'s 14 criticals, all Perl, fixed in
  5.36.0-7+deb12u4. The other two criticals are zlib1g's CVE-2023-45853, which
  has no fix, and npm's bundled tar 7.5.15 (CVE-2026-59873, fixed in 7.5.19),
  which the upgrade does not touch, since the overlay copies only
  `/usr/local/bin/node`. Whatever the build fixes, `scripts/image-scan.mjs`
  scans the CLI's base image (`triggerdotdev/node:24-bookworm` by digest), not
  the task image built from it, so those alerts stay open after it merges.
  T10.
- **Read locally, the session's own Trivy 0.76.0, linux/amd64:** Mailpit
  v1.32.0 0/0 (v1.31.6: CVE-2026-111943, Go's `crypto/x509`); Stalwart
  v0.16.27 (Debian 13.7) 0/47, none with a fix (v0.16.10: 3/114);
  clickhouse-server 26.3.59 (Ubuntu 22.04) 0/0 (26.2.19.43: CVE-2026-45447 and
  CVE-2026-84782 in openssl); `node:24.22.1-slim` 1/60, as above. Upstream,
  read the same day: Caddy's newest is 2.11.7 (a Go 1.26.8 build), the
  registry's 3.1.2 (the same Go), Gatus's v5.37.0 and docker-socket-proxy's
  newest release v0.5.0, so none has a newer build to move to; Redis stays on
  `7.4-bookworm` because the 7.4 Alpine images are on Alpine 3.21 (0119).
- **The follow-ups, after the first invitation, are task rows now:** T9 (the
  API image without devDependencies, a draft being built on branch
  `claude/ownpace-public-readiness-y7orc6-api-image-prod-deps`), T10 (the image
  scan reads the tasks' image as it is built) and T11 (Mailpit v1.32.0;
  Stalwart v0.16.27, the owner's call; ClickHouse 26.3, after the Alpha).
- **T7 is still the owner's.** MinIO has the most criticals of any group,
  26/259 open, and its own scan reads 26 critical and 259 high, 206 of them
  fixed in a newer package: the same as on 2026-10-22, since a frozen image
  does not move. It publishes no port. T7's row and 0119 §3 item 5 are not
  changed here.

**2026-10-23, recorded: the Release workflow merged and proven on `main`, and
alpha.1's release text pasted by the owner.** #1681 merged at 02:14 UTC
(`b357add8`) and #1682 at 03:05 UTC (`54e4c3d2`). `54e4c3d2`'s own push runs
on `main` were green: CI #4704 and Security Scan #4720. Six dispatches of
`release.yml` from `main` at `54e4c3d2` (C in runs 1 and 2) gave what the entry
below owed after the merge.

- **Run 1, `preflight` for `v0.2.0-alpha.2`.** It refused seven lines, each a
  thing not done yet rather than a fault: `changelog-folded` twice
  (`[Unreleased]` held 171 lines, and the alpha.2 section is dated
  2026-10-11), `ci-green` (CI #4704 was still queued), `scan-green-on-main`
  (Security Scan #4720 was still running), and three `nights` lines (E2E
  (managed) #265 ran `91b49de9` and #262 ran `29693244`, and `54e4c3d2`
  reached `main` after #265, so no counted night has run it). It passed
  `names-agree`, `tag-free`, `openapi-agrees`, `callees`, `upgrade-ledger`
  (65 → 65) and `upgrade-managed` (46 → 59). It noted that the `release`
  environment asks for a reviewer, the core of the owner's one setting
  (`docs/release.md`, *Settings the owner makes once*). That is all the
  preflight reads of it: the setting's `main`-only deployment branches,
  *Prevent self-reviews* off and no wait timer were not read.
- **Run 2, `rehearse` with `commit=54e4c3d2`.** The gate scan ran Security
  Scan #4721 on `release-gate/v0.2.0-alpha.2` at C, green with its three image
  jobs skipped, and deleted the branch. The run ended red on its last step
  only, as a rehearsal of a commit the preflight refuses must: *"the real run
  would have stopped at the preflight: 6 refused"* (run 1's seven, less the
  scan on `main`, green by then).
- **Run 3, `rehearse-tag`.** The workflow's token made the annotated tag
  `rehearsal-3` at `main`'s head. Security Scan, dispatched on it as #4722,
  ran on the tag and refused at its names check (*"not a release name"*), so
  no release was made, and the tag was deleted.
- **Runs 4, 5 and 6, `verify` on `v0.2.0-alpha.1`.** Each passed every image
  (both architectures), the revision label, the `sha-` tag, `latest`
  withheld, cosign with the exact identity and with the documented regexp,
  the zip's `SHA256SUMS.txt` for all 389 files, and `/version`. Runs 4 and 5
  refused `bom.json` and the body: run 4's (03:12 UTC) held no generated
  block, and run 5's (05:33 UTC) had a block that did not link
  `CHANGELOG.md` at the tag. Run 6 (05:44 UTC), after the owner's paste as it
  stands now, refused only `bom.json`.
- **alpha.1's release text, pasted by the owner on 2026-10-23** (decision
  12): the standard text without its `bom.json` sentence, and a note on the
  failed tag-time scan that says what the four advisories mean for anyone
  running alpha.1. It is still a pre-release, with its zip as its one asset.
  Its `bom.json` stays missing by choice, so `mode=verify` on alpha.1 stays
  red on that one line. The note says proxy-addr's affected code runs only
  when `TRUST_PROXY` names an address or a subnet; the owner confirmed that
  live's is a hop count, 2, as `docs/managed-bring-up.md` asks, so that path
  was never used on live. `docs/release.md` (*`mode=verify` on an existing
  tag*) and alpha.1's section of `CHANGELOG.md` now say the paste is done.
- **Still owed for `v0.2.0-alpha.2`:** the fold, which is C and starts the
  freeze (0141 T14); the two nights on it; and then `mode=release`, with the
  owner's approval.

**2026-10-23, build: the preflight's code-scanning note, grouped, merged as #1683
(`47bf5c13`)** from branch
`claude/ownpace-public-readiness-y7orc6-scan-alerts-breakdown`. Release's first preflight on `main` printed one line, *"67 critical and 100
high code-scanning alert(s) open on main: reported, not refused"*, and the 100
was the page size: it read one page of each severity. Now
`scripts/release-preflight.mjs` reads every page (`getAll` in
`release-github.mjs`, which errors past its cap rather than count short),
keeps an alert only as far as the new whitelist `slimAlert` does (the API's
alert names the accounts that dismissed it or were assigned it), and prints
the total and then one note per tool and analysis category (the repository's
filesystem scan; each `trivy-image-<name>` category, naming the image) with
its counts and its five most alerted rule ids, critical first. Still a note,
never a refusal (decision 11), and a list that cannot be read is a note that
says why. Proven by the preflight's guard on a fixture written by hand in the
API's shape and kept through `slimAlert`, since this session's token gets 403
from code scanning; the real breakdown is the next preflight dispatch's log.
The review's mutations (the rules unsorted, alerts keyed by place and not by
number, the API's reason dropped) each turn the guard red: it pins one
group's sentence whole, prints the same notes for the fixture reversed and
shuffled, counts an alert answered twice once, and reads the check step's
notes through `openAlertsNotes` with a client that is refused.

**2026-10-23, build: the Release workflow, merged as #1682 (`54e4c3d2`)** from
branch `claude/ownpace-public-readiness-y7orc6-release-workflow`. T2's
steps 4 to 6 (the gates, the commit, the tag) and §3's checks become one
dispatchable workflow, `.github/workflows/release.yml`, with the procedure in
`docs/release.md`. It runs from `main` on GitHub-hosted runners only and never
reaches the self-hosted machine or live.

- **Why: alpha.1 shipped on a red scan, recorded here for the first time.**
  `v0.2.0-alpha.1` was pushed by hand on 2026-10-06 (`90a23e9b`). Its tag's
  Security Scan, run 37523297841, failed at the advisory gate (seroval
  GHSA-p6vx-979v-rg4c critical and GHSA-jp82-f5mq-hwhp high, proxy-addr
  GHSA-jqcg-44mw-7w3h critical, source-map-js GHSA-68fv-2mgg-jv7q high, dev
  only), though the same commit's scan on `main` (run 37396505448) had been
  green that morning. Every step after the gate was skipped: its release has no
  generated body and no `bom.json`, while the images were pushed and signed
  and `windows-payload.yml` attached the zip to a release it created bodiless.
  §4's go/no-go ("published with its images and SBOM") does not hold for
  alpha.1. Decision 12, as the owner answered it on 2026-10-23: a session may
  not edit releases, so the owner pastes into alpha.1's release page by hand
  the standard text (what Security Scan's *Compose release body* writes,
  without its last sentence, which says an attached `bom.json` is the SBOM)
  and a note on the failed tag-time scan, which says `bom.json` is missing.
  Its `bom.json` stays missing: nothing regenerates it, and a re-run of the
  tag's scan fails the same way on the tag's lockfile. `CHANGELOG.md`'s
  alpha.1 section says so, and `mode=verify` on the tag refuses for the
  missing `bom.json` (and for the body, until the paste).
- **The order.** preflight (read only), approve (the `release` environment:
  the owner's recorded say-so, a guard against accidents and not a boundary),
  a gate scan of exactly C on a branch `release-gate/<tag>`, the tag (nights
  and tag read again just before `POST git/tags`, then `POST git/refs` with the
  workflow's token), Security Scan on the tag first, `images.yml` and
  `windows-payload.yml` after it, and verify. A token-made tag starts no push
  workflow, so each publisher is dispatched on the tag ref and waited for; a
  failed publisher run is re-run (`rerun-failed-jobs`), never re-dispatched,
  and a dispatch is never sent twice.
- **The owner's decisions taken (2026-10-23), the design's recommendations:**
  the workflow's own token and dispatches on the tag ref (1); both nights on C
  and the four appliance runs of those nights (2), a failed attempt does not
  count (3), and the freeze (4), all written once in 0141 T14; the approval
  environment (5); no CI on a Release-made tag, C's own push run must have run
  lint, unit, UI and integration (6); the changelog section dated within the
  week before the run (8); no override input (9; amended on 2026-10-30 by the owner's waiver of
  the nights, `waive_nights`, Status of that day); open code-scanning alerts
  reported, not refused (11); immutable releases off (13); hand-pushed tags
  unchanged, as break-glass (14). The tag ruleset (10) is optional, and the
  owner's answer of 2026-10-23 is "not now": `docs/release.md`'s *Settings the
  owner makes once* lists only the `release` environment (required reviewer:
  the owner; deployment branches: `main`), and the ruleset is an optional note
  beside it.
  `[Unreleased]` must be empty: the preflight refuses otherwise, so the hand
  path's names check is unchanged.
- **Decision 7, the upgrade proof, is shared with the managed chain's own
  test.** The preflight runs `packages/ledger/src/migrate-upgrade.unit.test.ts`
  and `packages/managed/src/migrate-upgrade.unit.test.ts` with
  `UPGRADE_FROM_REF` set to the release before, reads vitest's report, and
  refuses unless every case ran and passed; a chain whose file does not exist
  at C is "not exercised" and refuses. The managed file is #1681's, merged
  2026-10-23 (`b357add8`; its entry below), and `main` is merged into this
  branch. `two-chains.unit.test.ts` is not counted: it adopts a pre-split
  database. Run from alpha.1, the ledger gate failed one case ("still finds
  every leftover it declares"): its pre-split leftovers are rc.1's. Both pull
  requests fixed that case, each in its own way; the merge keeps #1681's
  (merged, and green in CI), the allow-list held to releases with no
  `packages/managed/migrations`, and drops this branch's.
- **Proven so far, in this session:** the guards, written first and shown red
  (eight files, seven on missing modules); the preflight run by hand against
  the live record on `main`'s head `a5ae29d1`, which refused, as it should, on
  the changelog (161 lines under `[Unreleased]`, the section dated 2026-10-11),
  the nights (#265 and #262 on two other commits), the missing `image_scans`
  input, the ledger case above and the missing managed test, and passed CI run
  #4697 and Security Scan run #4713; and verify run by hand against alpha.1:
  no generated body, no `bom.json`, `SHA256SUMS.txt` holding for all 389 files
  of its zip, both architectures and the `sha-` tag for all three images,
  `latest` withheld. Owed on `main` after the merge: four proof dispatches
  (preflight; rehearse with an explicit commit; rehearse-tag; verify on
  alpha.1), and from the owner, the `release` environment (`docs/release.md`,
  *Settings the owner makes once*) and alpha.1's release text, pasted by hand.
- **The review of the build (2026-10-23), applied on the same branch.** Two
  blocking: a rehearsal carried every refusal, so a commit that is not on
  `main` still reached the gate scan, which makes a branch at it and runs that
  commit's own `security-scan.yml` with a write token; now a refusal of which
  commit it is ends a rehearsal at the preflight, the gate scan starts only on
  the preflight's `candidate`, and the gate branch is made only when `compare`
  puts C on `main`. And the changelog guard read the live `CHANGELOG.md`, so
  the fold `docs/release.md` asks for would have turned it red on the fold's
  own pull request; it reads a frozen copy of 2026-10-23 now. The minor ones:
  before each publisher, the tag is checked to be Release's at C with no
  branch of its name (a dispatch names the tag by its short name); a cancelled
  run stops (`!cancelled()`; `always()` only on the two clean-ups); the tag
  job peels first, so a re-run over its own tag carries on without reading
  the nights; a tag counts as Release's only when the run it names ran its
  `tag` job; the candidate's names check runs in a step of its own with no
  token; the gate scan passes only when every image job skipped; the
  `openapi.yaml` guard derives the next version instead of naming alpha.3;
  and 0139 and `site/legal/README.md` point at 0141 T14 for the freeze.
- **Merged with `main` after #1681, 2026-10-23.** The ledger gate is #1681's,
  and `scripts/an-upgrade-gate-that-skipped-itself.unit.test.ts` says so; its
  ledger reports are recorded again from that file (from alpha.1, from rc.1,
  and with the tag missing: only the case's new title differs), and the
  managed gate's own report from alpha.1 takes the place of the ledger's
  copied under its name. `docs/release.md` keeps §1's Release-centred list
  with #1681's facts in it: both gates' commands with
  `UPGRADE_FROM_REF=<previous-tag>`, the managed gate as the managed chain's
  proof with its count, seven, and the drill not applicable for alpha.2 and
  why. Decisions 10 and 12 follow the owner's answers (above). **The upgrade
  gates, run for real** on the merge, with `v0.2.0-alpha.1` fetched
  (`node scripts/release-upgrade-gates.mjs --candidate . --from
  v0.2.0-alpha.1`): *"pass upgrade-ledger: all 8 cases ran and passed, 7 of
  them upgrading from v0.2.0-alpha.1; 65 → 65 migrations: nothing to upgrade
  on this chain, so the gate ran its mechanics and no migration"* and *"pass
  upgrade-managed: all 12 cases ran and passed, 8 of them upgrading from
  v0.2.0-alpha.1; 46 → 59 migrations"*.

**2026-10-23, build: the managed chain's upgrade proof, merged as #1681 (`b357add8`)** from
branch `claude/ownpace-public-readiness-y7orc6-managed-upgrade-test`. Part of T4, and what the
release workflow's preflight needs to prove `v0.2.0-alpha.1` to the next tag.

- **Why the drill is not applicable for `alpha.2`.** `v0.2.0-alpha.1` carries 46 managed
  migrations and `main` 59; the shared chain is 65 files in both, byte for byte
  (`git diff v0.2.0-alpha.1 -- packages/ledger/migrations` is empty). The container drill
  (`upgrade-drill.sh`) upgrades the appliance, which applies the shared chain only, so from
  alpha.1 it would exercise no migration and say so itself (*"both carry 65 migrations"*); the
  shared chain's unit gate likewise. The alpha is managed-only (open question 3), so no tester
  runs an appliance. What the drill alone would still show is an appliance opening a PGlite
  directory alpha.1's image wrote, across PGlite 0.5.8 to 0.5.10: the appliance's question, for
  the first release an appliance tester runs. If a shared migration lands before the tag, the
  drill applies again. `release.md` §1 says the same.
- **The test.** `packages/managed/src/migrate-upgrade.unit.test.ts`, in the unit project on
  PGlite like the shared gate, from `UPGRADE_FROM_REF` or `v0.2.0-alpha.1`; it throws under `CI`
  when the ref is missing, and refuses a ref with no managed chain (rc.1) by name. It writes both
  chains AND both migrators (`migrate.ts`, `migrate-managed.ts`) at the ref into a temp tree laid
  out like the repository, and applies the ref's chains with the ref's own migrators, shared
  first, as the API at the ref did; then this build's two chains with this build's migrators.
  Seven `skipIf(!HAVE_REF)` cases: nothing lost and every new file after the ref's last; only
  the added files apply (names, count, order) and the ref's bookkeeping rows are untouched;
  every file the ref applied is still its SQL (the migrator records names, never content, so an
  edit reaches fresh installs only; comments are compared away, and 0006 and 0008's notes from
  #1650 are reported); the upgraded catalogue equals a fresh install's (relations with their row
  security and grants, columns with their collation, column order, column grants, indexes,
  constraints, policies, triggers, functions, views, types, default privileges, roles, extensions
  and comments), with no allow-list; a further
  run applies nothing; and the ref's own migrators refuse the upgraded database on each chain
  that moved. Four more cases hold the comment-stripping comparison.
- **Read on the branch, 2026-10-23,** from alpha.1: shared 65 -> 65 (0 added), managed 46 -> 59
  (13 added); compared 75 relations, 704 columns, 106 column grants, 158 indexes, 696
  constraints, 191 policies, 7 triggers, 7 functions, 12 views, 2 default privileges, 3 roles and
  2 extensions; 12 of 12 passed. **Mutations**, each restored: a column added to applied 0044
  (2 cases red: the SQL, the columns); a new 0060 dropping the column 0044 was edited to lack
  (red: the SQL), and the same without `IF EXISTS` (red: the SQL, the fresh install fails); a
  data-only edit to applied 0040 (red: the SQL, which no catalogue sees); a statement appended
  to an applied shared file (red); a new file numbered `0045a_` (red: order, applied); an applied
  file renumbered as new (red: lost, schema); this build's managed bookkeeping table renamed
  (4 red: what proves the ref's migrators, not this build's, applied the ref). Green: a
  comment-only edit, a new 0060 dropping a column, and a new shared `0068_` (both chains move,
  and the ref's shared migrator refuses too).
- **The shared gate from alpha.1 was red.** With `UPGRADE_FROM_REF=v0.2.0-alpha.1`, `main`'s
  `packages/ledger/src/migrate-upgrade.unit.test.ts` failed one case: `MOVED_TO_MANAGED_CHAIN`'s
  four tables are rc.1's leftovers, and alpha.1's shared chain never made them. The allow-list
  now holds only from a release with no `packages/managed/migrations`; from a later one the stale
  check asserts the four are absent. Green from rc.1 and from alpha.1 (8 of 8 each); with the
  condition forced false, rc.1 turns 2 cases red.
- **`release.md` §1.** Both gates' commands carry `UPGRADE_FROM_REF=<previous-tag>` (the shared
  one ran without it, so from rc.1); the managed gate is listed with its count, seven, and
  `two-chains.unit.test.ts` is named as not an upgrade proof. `a-release-that-names-itself` now
  checks the count written after each gate's path against that file (red on `main`'s
  `release.md`, and with the managed count written as six).
- **Unlike T4 as written:** the alpha leg is a file of its own rather than cases in the shared
  gate and `two-chains.unit.test.ts`, and it starts from `UPGRADE_FROM_REF` (the release
  workflow sets it) rather than a `release-line.json`.
- **Not in this:** wiring it into the release workflow's preflight, which is that pull request's;
  the Postgres leg (T4); `two-chains.unit.test.ts`, which still reads `UPGRADE_FROM_REF` for a
  case that means something only from a release before the split.
- **Review, 2026-10-23.** Three minor findings, all taken. The header said an import in the
  release's migrator resolves as in the repository; an `@openmig/*` one does not, vitest's aliases
  send it to this build's source (`@openmig/shared`, for `log`, which a migrator given a logger
  never calls), and the header says so. The catalogue left out column order, collation and
  `COMMENT ON`; it now has a `column order` line per table (live columns, so a dropped column's
  gap does not count), `collate=` on each column, and a digest per comment (106, with a floor of
  50 so a filter that reads none is red). Each was shown on applied 0044: two columns swapped,
  `COLLATE "C"` on one, a comment's text changed. The catalogue went red on `column order`,
  `columns` and `comments` respectively, besides the SQL case; as first pushed, only the SQL case
  saw any of them. 12 of 12 green from alpha.1. Third, the comparison that accepts comment-only
  edits is looser than T3's *"no migration a release shipped may change"*; T3 now names that as
  its own decision (byte equality with 0006 and 0008 put back, proposed, or comments allowed)
  rather than inheriting it.

**2026-10-22, recorded: Dependabot alerts and security updates are on.** The owner turned on both
repository settings that `.github/dependabot.yml`'s header leans on for security updates; the API
read `dependabot_security_updates: enabled` the same evening, and alert email was already on. So a
published advisory against a dependency now opens a pull request by itself, instead of turning up
only when the audit gate turns an unrelated pull request red (2026-10-03, 10-07 and 10-21). What it
does not cover stays as the header says: transitive pnpm fixes Dependabot cannot make, and the
ignored names that still move by hand.

**2026-10-22, recorded: T8's scan half merged** as #1674 on 2026-10-22 (`51a0d267`), so both
halves of T8 are in. Security Scan dispatched on the branch (run 4692, on `10725955`) listed 26
images and scanned and reported every one, and it opened #1675: the GoAccess image
`site-visits.sh` runs is on Alpine 3.20.10, past its end of life. #1675 is open. The pull
request's required `Trivy` check was green on its last head (`2e418c92`), and Security Scan
dispatched on main after the merge (run 4700, on `51a0d267`) was green. The watch half,
dispatched once on main after its merge (`idp-pin-watch.yml` run 7, on `6bd020f6`), opened the
four issues the 2026-10-21 entry expected: #1668 (Trigger.dev), #1669 (the tasks' Node), #1670
(pnpm) and #1671 (the routine pins). Still owed from *Owed* below: a pull request opened or
refreshed after run 4700, and its required `Trivy` check read; and, when an image leaves the
stacks or is renamed, its configuration deleted by hand.

**2026-10-22, build: T8's scan half, on branch
`claude/ownpace-public-readiness-y7orc6-image-scan`, not merged.** The watch half below merged as
#1663 (`087183b7`) on 2026-10-21. Nothing scanned a container image: Security Scan's Trivy reads
the repository's files (`scan-type: fs`), so an operating system past its end of life, or a CVE
in an image whose tag never moved, was reported by nothing.

- **The scan.** Three jobs after `security-scan` in `security-scan.yml`, on the weekly schedule
  and on dispatch only, on `ubuntu-24.04`; the `security-scan` job and its step names are as they
  were. `image-list` runs `scripts/image-scan.mjs list`, which reads with the pin watch's reader
  (`readImages`: a `${VAR:-default}` as its default, a digest kept) every `image:` line of
  `managed.yml`, `dev.yml`, `www.yml` and `deploy/selfhost/compose.yml`; the images the scripts
  name (GoAccess, the demo's Stalwart, `db-roles.sh`'s client); the tasks' base image the pinned
  Trigger.dev CLI names (the pin watch's `cliBaseImage`, now exported); and
  `ownpace-{api,web,selfhost}` at `:edge` and at the newest `v*` tag, since live builds the tag it
  deploys. 26 images on 2026-10-22, each listed once per stack (`managed` for `deploy/compose`,
  `selfhost` for `deploy/selfhost`) and named after its repository's last part, with the stack
  added where both stacks run that name: so a pin that moves, or two stacks' pins that meet on
  one reference (the floating-images pull request puts both postgres on one digest), keep their
  names. `image-scan` is one leg per image: trivy-action at the fs scan's SHA and Trivy v0.76.0,
  `scan-type: image`, `scanners: vuln`, `format: json`, HIGH and CRITICAL, `exit-code: 0`,
  linux/arm64 read from the registry; the JSON kept for the report job, `trivy convert` to
  SARIF, uploaded under `trivy-image-<name>`, and a last step that fails the leg unless the scan,
  a non-empty JSON and SARIF and the upload all happened.
  `image-scan-report` reads every report. A missing one is an `::error::` and fails the run. An
  operating system Trivy calls past its end of life (`.Metadata.OS.EOSL`, in the JSON only)
  gets a `::warning::`, a line in the summary and one issue per image, *An image's operating
  system is past its end of life: <name>*, closed when that ends. Findings fail nothing.
- **Guards.** `scripts/an-image-nobody-scanned.unit.test.ts`, 33 cases: on main it does not load
  (no `image-scan.mjs`), and with the script but before the workflow, 10 failed. Six mutations
  (fail-fast, a self-hosted runner, the end of life never read, strays closed while a report is
  missing, the scripts unread, release tags in text order) each fail it. `a-scan-that-skipped-itself`
  now reads its check step only to the end of its job: with the new jobs after it, the existing
  step's `::warning::` could be removed and the guard still passed (shown by mutation).
- **Review, 2026-10-22.** The guard read today's pins as literals (`redis:7-alpine`,
  `postgres:18-alpine`, PgBouncer's tag), so the compose-pins pull request (#1657) turned it red
  (shown with its `managed.yml` and `site-visits.sh` in place: 1 failed). It now reads every pin
  from the files, and is green with #1657's files and with the floating-images pull request's
  postgres pins and computed `db-roles.sh` client in place. Names were per reference, so those
  two postgres pins meeting on one digest would have renamed both scans: now per stack, held by
  a case that moves them together and apart (red on the old naming). The report's exit code is
  held from the command line (red with `failed` forced false). The image scan runs the
  vulnerability scanner only, so code scanning and the report count the same findings.
- **Read on the branch, 2026-10-22,** with Trivy v0.76.0 locally, linux/arm64: `redis:7-alpine`
  is Alpine 3.21.9, not past its end of life until 2026-11-01; the frozen MinIO image has 26
  critical and 259 high findings, 206 of them fixed in a newer package; `alpine:3.18` reads
  `EOSL: true` in the JSON and nothing of it in the SARIF.
- **Not in this:** acting on any finding; a ghcr login (Ownpace's three images are public, so the
  scan job has no `packages: read`); pinning the floating tags, which is its own pull request;
  the image jobs in a workflow of their own (the weekly run now holds the
  `security-scan-refs/heads/main` group for the matrix, so a push to main in that time waits:
  accepted, and said in the workflow's concurrency comment).
- **Owed.** Before the merge: Security Scan dispatched on the branch; then this pull request's
  own required `Trivy` check read again, and Security Scan re-run on the pull request if it
  changed. After the first scheduled or dispatched run on main: a pull request opened or
  refreshed, and its required `Trivy` check read, which must still conclude success or neutral
  with main's `trivy-image-*` configurations that no pull request uploads. Whenever an image
  leaves the stacks or is renamed: its old `trivy-image-<name>` configuration deleted on the code
  scanning tool status page.

**2026-10-21, build: T8's watch half, on branch
`claude/ownpace-public-readiness-y7orc6-pin-watch`, not merged.** The owner asked for *"Life
cycle management on what needs it"*, and the survey of that day found that Dependabot had read
no file in `deploy/compose` since 2026-09-06: its compose fetcher reads only names like
`compose.yml`. So T8 is wider than §3 wrote it: every pin Dependabot cannot see, not only the
images it ignores by name.

- **The watch.** `scripts/idp-pin-watch.mjs` is a table of rows now, run by the same workflow
  (`idp-pin-watch.yml`, its name, `'23 6 * * 1'` and `ubuntu-24.04` unchanged). One issue each,
  kept open while the row is behind: the identity provider (its title unchanged, so #1643 is
  the issue it keeps); Trigger.dev against the newest tag both ghcr images carry, by the probe
  `trigger-version.sh list` runs, now also `trigger-version.sh probe`, which refuses when the
  tag it starts from does not answer; ClickHouse against what Trigger.dev's own
  `docker/docker-compose.yml` pins at that tag, with its line's row in ClickHouse's SECURITY.md
  as text; the tasks' Node against Node's newest security release, until `trigger.config.ts`
  copies the API image's Node; `packageManager` against the newest pnpm of its major; and the
  TypeScript split's exit, as a cleanup notice. One summary issue for the routine pins: every
  other image line of `managed.yml`, `dev.yml` and `www.yml` against its registry's tags of the
  same major and scheme, the busybox copies in the scripts, `www.yml`'s nginx against
  `apps/web/Dockerfile`'s, Stalwart's copies and its newest v0.16.x, GoAccess, and the Trivy the
  Security Scan runs; cosign-installer's default is a status line. A row that cannot read its
  upstream touches no issue and fails the run.
- **Read on the branch, 2026-10-21** (`node scripts/idp-pin-watch.mjs`, no `--issue`): the
  identity provider v4.19.4 against v4.19.5; Trigger.dev v4.7.2 against v4.7.6; ClickHouse
  current with Trigger.dev's pin, 26.2 not supported by ClickHouse; the tasks' Node 24.18.0
  against 24.22.1, and trigger.dev 4.7.6 still on 24.18.0; pnpm 11.22.0 against 11.28.6 (pnpm 12
  is `latest`); the split not yet due (typescript-eslint 8.72.0, `<6.1.0`); behind in the
  summary: pgbouncer v1.25.2-p0 (v1.26.1-p0), the registry 3.1.1 (3.1.2), gatus v5.36.0
  (v5.37.0), mailpit v1.31.1 (v1.31.6), Stalwart v0.16.10 (v0.16.27) and Trivy v0.70.0
  (v0.76.1). So its first scheduled run opens four issues and edits #1643.
- **Dependabot.** `/deploy/compose` is no longer listed for `docker-compose`, with the nine
  ignores that applied only there; the self-host `postgres` major ignore stays. The header says
  security updates come from the repository setting and what they do not cover, and the
  TypeScript ignore says it is inert. The guard
  `scripts/a-dependabot-directory-with-nothing-to-read.unit.test.ts` (red on main: two cases)
  holds every listed directory to a file the fetcher reads, and every ignore to an image there.
- **The identity provider's dump.** The issue's step 5 and `dump-idp.sh`, on a stack that is not
  live, say when the OTA dump can go: once main's first scheduled E2E (managed) on the new pin
  is green.
- **Review, the same day.** On the probe's walk above the pin only a 404 is a missing tag; any
  other answer (a 429, a 5xx, a timeout, the 403 an empty token gets) refuses, so a registry
  that flakes halfway cannot lower the newest tag or close the Trigger.dev issue. A routine pin
  ahead of every tag listed counts as a read that failed, so it cannot close the summary issue.
  The summary issue says that Stalwart moves only by `docs/stalwart-integration-fix.md` and
  ADR-0022, and ADR-0042's amendment log says its ignore by name is gone.
- **Not in this:** the scan half (§3's Trivy image scan, report only), MinIO's replacement (T7),
  and moving any pin the watch reports. Each of those is its own pull request.

**2026-10-05: two tags: `v0.2.0-alpha.1` to stand live up and rehearse, `v0.2.0-alpha.2` with
the final texts before the first invitation.** Plans only; no tag is cut. Asked what
`v0.2.0-alpha.1` waits for, the owner chose *"Two tags"*:

- **`v0.2.0-alpha.1`** is cut as soon as these are on `main`: 0132 T2 step B,
  `trigger-db`'s key (#1527, merged 2026-10-05); the identity provider at Zitadel v4.19.4
  (#1528, merged 2026-10-05); 0144 T3 (b), the site copy in the owner's option B of 2026-10-05
  (#1529, open); and this tag's `CHANGELOG.md` entry. Live is stood up from it (0132 T0 step 3,
  T1b), and the rehearsal runs on it. No tester is invited on it.
- **`v0.2.0-alpha.2`** carries the final legal texts (0139: the owner's approval, D1's amendment
  of the same day). It has its own freeze (0141 T14 says what a freeze is), its own two green scheduled nights (0141 T14, T2 step
  5) and its own deploy to live (T5), all before the first invitation.
- So the tag the first invitation waits for, in §4 and in 0131 T5's row for this plan, is
  `alpha.2`. T0's rule holds: `alpha.1` for the first deploy to live, `alpha.2` for the second.
- T2's steps 4 to 6 run for each tag. Open question 3, the drill from rc.1, is about `alpha.1`.
  Open question 4, the checklist for `alpha.2` and later, is not otherwise answered by this.
- T2's row and a dated note at §4 say so.

**2026-09-28: T0 answered.** The owner's words were *"The version name (0146 T0): ok, what do I
do?"*, and later *"3. The version name: List what i need to do and when."* The owner named no
option and no item. "ok" was read as accepting T0's whole recommendation: `v0.2.0-alpha.1`, then
`alpha.2`, `alpha.3` for each deploy to `ownpace-live`; no rename before the alpha or on a live
stack; and no last squash. That is a reading of one word, not three answers given one by one. The
owner has not objected since: the later message asks what to do and when, and names no other
version, rename or squash. Open questions 1 and 2 are recorded as answered on that reading.

**2026-09-28, build: T2 step 1, built on branch
`claude/ownpace-public-readiness-y7orc6-a-release-named-v0-2-0-alpha-1`, not merged.** Nothing is
tagged. Steps 4 to 6 are the owner's.

- **The version.** The root `package.json` says `0.2.0-alpha.1`. The workspace packages stay
  `0.0.0`, as `docs/release.md` says.
- **The changelog.** A new, empty `[Unreleased]` is at the top. The old one is now
  `## [0.2.0-alpha.1] - 2026-09-29`, the planned tag date, with T2's floor. Its first paragraph
  says the section lists changes only up to mid-August (the newest date it names is 2026-08-11)
  and points to `docs/feature-matrix.md`. It replaces *"Everything since rc.1 — 209 commits"*,
  which is no longer true. The pricing sentence no longer names `@openmig/shared`, where the prices
  are not, and names no package: `pricing.ts` in `@openmig/managed` is where they moved on
  2026-08-19 (ADR-0036), after the mid-August the first paragraph stops at. *"A single source"* is
  true on both sides of the move. The rest of the text is unchanged. T1's curated section is
  for a later alpha. If the tag comes later than 2026-09-29, the heading's date is early: a fix
  must land before the commit that is tagged, or it is not in the tag.
- **The issue template.** `bug_report.yml`'s Build field shows the stamp's form,
  `v0.2.0-alpha.1 · abc1234`, and says where it is: the bottom of the sidebar on the managed
  service and the self-host Docker image, and on managed the sign-in page too. It sends a Windows
  appliance tester to the first log line, `[appliance] build 0.2.0-alpha.1 (abc1234def56)`, and
  says a Docker image prints that line with `unknown` for the commit. Where it has a commit,
  `start.mjs` prints twelve characters of it (`git rev-parse --short=12` in
  `scripts/package-appliance.mjs`), not the six the old example showed. The placeholder is the
  managed form.
- **`docs/release.md`** says six `skipIf(!HAVE_REF)` tests, as
  `packages/ledger/src/migrate-upgrade.unit.test.ts` has.
- **The guard.** `scripts/a-release-that-names-itself.unit.test.ts` has a block (c) with four
  cases. The Build field's managed example is what `describeBuild` renders, and the pages it names
  (`Layout.tsx`, `Login.tsx`) render `BuildStamp`. Its appliance example is the line the packager
  writes, with the packager's commit length. Its placeholder is one of the two examples. And
  `release.md`'s count is the file's. All four failed on the unchanged code, and the 25 other
  cases passed. The existing case that ties the root version to a dated `CHANGELOG.md` section
  passed before and after.
- **The check.** `node scripts/release-names-agree.mjs v0.2.0-alpha.1`, run in the worktree after
  `git fetch --tags`, printed: *"v0.2.0-alpha.1: the tag, package.json (0.2.0-alpha.1) and
  CHANGELOG.md's section agree, and it comes after every release already tagged
  (v0.1.0-rc.1)."*
- **Mutations:** twelve, each turned the guard red. The bump without the changelog section, and
  the heading without its date, fail the existing case, and the check refuses both. In the
  template: a seven-character appliance commit, an eight-character managed commit, the managed
  form without its `v`, the sidebar and sign-in page dropped, and a placeholder in neither form.
  In the code: `BuildStamp` removed from `Login.tsx`, `--short=7` in the packager, and the
  packager's line reworded. In the count: `release.md` back to five, and a seventh gated test in
  the gate.
- **The shared-chain gate, on this branch.** With `v0.1.0-rc.1` fetched, all six
  `skipIf(!HAVE_REF)` tests in `migrate-upgrade.unit.test.ts` ran, and none was skipped. This is
  not the tagged commit, so `release.md`'s run at that commit still counts.
- **The review, the same day.** Four nits, in the same branch.
  - `apps/api/docs/openapi.yaml`'s `info.version` still said `0.1.0-rc.1`, a fourth copy of the
    version. It says `0.2.0-alpha.1`, the guard's new block (d) holds it to the root
    `package.json`, and `release.md`'s bump step names it. The other `0.1.0-rc.1`s are not copies
    of the current version, and stay. They name rc.1 as the release before: `README.md`,
    `deploy/selfhost/README.md` and `selfhost.env.example`, the default reference of
    `migrate-upgrade.unit.test.ts`, `two-chains.unit.test.ts` and `upgrade-drill.sh`, and workflow
    comments. Or they use it as a tag that exists, in the check's own tests. Or they are examples
    of a form: the `Version` schema's example in the same file, the Windows runbook's log line, and
    the web tests' fixtures.
  - On a Docker self-host the log line says `unknown` where the commit goes. `.dockerignore` keeps
    `.git` out of the image build, so the packager's `git rev-parse` fails, while the image's
    `GIT_SHA` reaches the bundle and `OPENMIG_COMMIT`, so the stamp has it. The stamp is in the
    sidebar in both editions (`Layout.tsx` renders it outside every edition condition); the
    sign-in page is managed-only (`ManagedOnly` in `AppRoutes.tsx`). The form said so, and sent
    every self-host tester to the sidebar first; the second review, below, narrowed that. Block
    (c) gained a case: the form sends a self-host tester to the sidebar before the log line and
    says what a Docker image prints, the image's build context has no `.git`, the image stages its
    payload with the packager, and the packager's commit is `unknown` unless git answers.
    `Layout.unit.test.tsx` rendered the stamp in each edition.
  - T0's record above quotes the owner's words in full and says how "ok" was read.
  - The changelog's pricing sentence names no package (the changelog bullet above).
  - **Mutations: nine, each red, each restored.** `openapi.yaml` back at `0.1.0-rc.1`, and the
    root version bumped alone, fail (d). The form's text before the review, the form without the
    Docker sentence, the form with the log line before the sidebar, `.git` dropped from
    `.dockerignore`, the packager's commit read from `GIT_SHA`, and the Dockerfile without its
    packager step fail the new case in (c). `<BuildStamp />` in `Layout.tsx`
    behind `!selfHost` fails the appliance's case in `Layout.unit.test.tsx`.
- **The second review, the same day.** Four minor findings, all taken, in the same branch.
  - The Windows appliance's sidebar does not show `v0.2.0-alpha.1 · abc1234`.
    `windows-payload.yml` and `pnpm package:appliance` build the bundle without `GIT_SHA`, so the
    bundle has no commit while the server's `/version` has the packager's, and `describeBuild`
    renders `UI v0.2.0-alpha.1 · API v0.2.0-alpha.1 · <commit>`, which reads like a stale bundle.
    The form now sends managed and Docker testers to the sidebar, and Windows testers to the log
    line, which has the commit there. Block (c)'s case holds that sentence by sentence: one sends
    a Docker tester to the sidebar, each that names the sidebar names managed or Docker and
    neither Windows nor both editions, and the Windows appliance is sent to the log line. Its
    check that the sidebar comes before the log line went with the advice it held. A new case
    holds the half the first review only asserted, that a published Docker image's sidebar has
    the commit: `images.yml` passes `GIT_SHA=${{ github.sha }}` in both of its build steps, the
    Dockerfile's build stage puts it in the environment before `build:selfhost`, `vite.config.ts`
    reads it into `VITE_COMMIT`, the runtime stage sets `OPENMIG_COMMIT` from it, and `start.mjs`
    does not overwrite that (`??=`). The guard's comment says an image built without `GIT_SHA`
    shows the version alone.
  - `Layout.unit.test.tsx` looked for the stamp anywhere on the page. It now looks in the
    `<aside>` only, and checks that nothing in the sidebar comes after it.
  - `release.md`'s opening still called the root `package.json` the *single* version source. It
    now calls it the version source, and names `openapi.yaml`'s `info.version` as a copy the guard
    holds to it.
  - The T2 row lists the reviews' work.
  - **Mutations: eleven, each red, each restored.** The form with the first review's text, with
    the Windows appliance sent to the sidebar, with no Docker tester sent there, and with "the
    appliance" for "the Windows appliance" fail the form's case. `images.yml`'s retry step without
    `GIT_SHA`, the Dockerfile's `ENV GIT_SHA` after the bundle's build, its runtime stage without
    `OPENMIG_COMMIT`, `vite.config.ts` reading `VITE_COMMIT` alone, and `start.mjs` assigning
    `OPENMIG_COMMIT` with `=` fail the new case. `<BuildStamp />` moved into the top bar fails
    both of `Layout.unit.test.tsx`'s cases; moved above Sign out, it fails the managed one.
  - **Not done here.** `windows-payload.yml` and `pnpm package:appliance` should pass `GIT_SHA`
    to `build:selfhost`, so that the Windows sidebar stops showing a false mismatch. That is
    outside this branch, and the form stays true after it.
- **Not proved.** No tag is cut, so the check has not run on a real one. Nothing has run on
  `ownpace-live`, which is not stood up (0132 T1b). No Docker image was built for the review: the
  `unknown` is read from the Dockerfile, `.dockerignore` and the packager, not from a container's
  log. No Windows payload was built either: its sidebar's `UI … · API …` is read from
  `windows-payload.yml`, `vite.config.ts` and `describeBuild`.
- **Waits for the owner.** The pull request's merge, before the commit to tag is picked: the
  tagged commit must carry the bump. Step 4, the drill from rc.1 on the reference machine (open
  question 3). Step 5, the commit: the managed gate's last two scheduled runs green, the newer on
  that commit, and the appliance nightly's four runs over the same two nights green (0141 T14).
  Step 6, `git tag -a v0.2.0-alpha.1` on that commit, the push, and `release.md` §3's checks.
- **Open.** 0131's go/no-go row for 0146 and its W17 line still say 0146 T0 *recommends*
  `v0.2.0-alpha.1`. They follow in the post-merge sweep, as 0131's other cells have after their
  merges, not on this branch.

**2026-09-28, later: the first drill across a real gap stopped on defects in the drill, three of
them, fixed on branch `claude/ownpace-public-readiness-y7orc6-a-drill-that-keeps-its-mapping`, not
merged.** The owner ran `./scripts/upgrade-drill.sh v0.1.0-rc.1` on `main` at `a0897c0b`, in a
clone of its own, after the release name was accepted. It pulled rc.1, started it healthy, and
stopped at step 1: *"DRILL FAILED: the released appliance configured NO mappings"*, with `rm:
cannot remove '/tmp/tmp.…': Operation not permitted` on the way out. The guard that refuses an
empty comparison did its job. The drill had not run since its fix of 2026-08-04 (`7cb1af4e`):

- **Step 1 removed the mapping it had just written.** It called `cleanup`, whose last line removes
  the config directory. Docker then created the missing mount source itself, empty and owned by
  root, which is also why the run's own `rm` could not remove it. Step 1 now calls
  `down_project`, the project half of `cleanup`, and refuses to start the appliance unless the
  mapping is there.
- **The upgraded appliance could not have started** (found by the review, before the owner's next
  run). `compose.drill.yml` mounted the directory read-only at `/data/config`, and the launcher of
  every build since 2026-08-06 (`start.mjs`, from `scripts/package-appliance.mjs`, the image's
  `CMD`) writes and removes a probe file in `CONFIG_DIR` before it starts, and exits when it
  cannot. rc.1 has no probe, so step 1 would have passed and step 3 failed. The drill now mounts
  the one file, `mapping.json`, read-only, and `/data/config` stays the image's own directory,
  owned by appuser and writable. Since the rest of that directory is what step 2 builds from the
  checkout, the drill refuses, before anything starts, a checkout holding any other `*.json` in
  `deploy/selfhost/config/` (a second mapping, or the files the selfhost e2e gate writes): the
  upgraded appliance would load it and the released one would not (the second review round).
- **The file's mode was the umask's.** The appliance runs as appuser, uid 10001
  (`apps/selfhost/Dockerfile`), neither the file's owner nor in its group. The drill sets 644. The
  file holds the example's values and the names of environment variables, no credential.
- **The mapping is the one the tag shipped.** `git show <tag>:deploy/selfhost/config/mapping.json.example`,
  the file an operator of that release copied, so "same mappings before and after" also says the
  new build reads an old release's config. rc.1's example parses with `main`'s parser (checked with
  `parseMappingConfigJson`, and by the review with `loadConfigDir`), including its `baseUrl` with a
  path.

Guard: `scripts/a-drill-that-keeps-its-mapping.unit.test.ts` runs the drill under umask 077 against
a throwaway repository holding the real `compose.drill.yml`, with `docker`, `curl` and `sleep` as
stubs and nothing of the machine's git. The docker stub reads the config mount from that file and
plays each appliance: both need the mapping readable by a process that is neither its owner nor in
its group, and the upgraded one needs `/data/config` writable; without the override it has no
mapping at all. Six cases. It fails on `main`'s drill (the released appliance) and on this branch's
first commit (the upgraded one); the old step 1, the file without its mode, the directory mounted
read-only, a stray config in the checkout and a drill without its override each fail as they would
for real, and the passing run's every `up` is the drill's own project with the override.
**Open:** the owner's run on `main` once this merges, and the required run on the commit to be
tagged (T2).

**2026-09-28, later still: the drill passed on `main`.** The fix merged as #1291 (`f7c3404f`). The
owner ran `./scripts/upgrade-drill.sh v0.1.0-rc.1` again, in a clone of its own, on `main` at
`fb70284a`. The run ended: *"DRILL PASSED"*, *"Upgraded across 59 migration(s), in place, on the
released artifact."* That is the first drill from rc.1 that is not vacuous (0025 T5): 59
migrations lie between rc.1 and that commit. It is not the commit to be tagged, so T2's step 4
still runs once more, on that commit, before the tag (`release.md`).

**2026-09-28: T5 (a) built with 0132 T6 (a), on branch
`claude/ownpace-public-readiness-y7orc6-a-deploy-from-a-named-tag`, not merged.** The rule is in
`deploy/compose/deploy-live.sh`; 0132's Status entry of the same date has the script as a whole.
Nothing has run on `ownpace-live`, which is not stood up (0132 T1b).

- **Only a release tag.** A tag on origin (`git ls-remote --tags origin`), the same object here and
  there, annotated, named `v…`, whose commit's root `package.json` version is the tag without its
  `v`. Anything else is refused before the checkout or the stack changes, with *"live runs
  releases: name a release tag"*; the version refusal names both values.
- **The tag's commit as `GIT_SHA`.** The bring-up takes it from `git rev-parse HEAD`; the script
  checks that `HEAD` is the tag's commit after `git checkout --detach` and before the bring-up.
- **`/api/version`, commit and version.** After the bring-up, both must be the tag's. A right commit
  with another version is a deploy that did not take: the script says so, the hold stays, it logs
  `did-not-take` and exits 3.
- **One-way or reversible**, said before the checkout moves and again before the owner lifts the
  hold, and written as the last field of the deploy log's line. One-way when a file in either
  chain was added, changed or removed since the running tag, or the Trigger.dev
  (`triggerdotdev/`) or identity-provider (`zitadel/zitadel`) `image:` lines in `managed.yml`
  differ; otherwise reversible. It compares the new tag with the running tag, the last one the
  deploy log says took, and also with every deploy since that did not take (its bring-up may have
  migrated the database) and the checkout's `HEAD`: going back to the running tag after a failed
  deploy with a migration is one-way, which the first build called reversible (fixed on review,
  the same day; 0132's entry has the three findings).
- **`--external-id <tag>` on the task deploy: deferred, and `deploy-tasks.sh` is unchanged.** Read
  in the published CLI, `trigger.dev@4.5.16`, `dist/esm/commands/deploy.js`: the flag exists
  (line 86), and on an id already deployed the CLI builds nothing (lines 346 to 376), syncs no
  environment variables, and, when that version is not the current deployment, only warns: *"This
  version is not the current deployment."*, with *"Promote it from the dashboard, or deploy again
  with --force to build a new version."* (lines 758 to 763). A redeploy of the previous tag is
  the one case the id is for, and there the tasks could stay on the newer version while every
  check on the API passes. What the self-hosted server does on a repeat is unchecked, as this task
  says. So it waits for open question 6, and for a redeploy of one id on the OTA stack that shows
  whether the server promotes it.
- **The guard's four cases** are in `scripts/a-deploy-from-a-named-tag.unit.test.ts` (0132 T6's
  guard, 61 cases as first built, 84 since `--dry-run` and the one-line exit): a lightweight tag and a tag not on
  origin refused; a `package.json` naming another version refused, naming both; `/api/version`
  with the right commit and another version failing the deploy; a migration file in either chain
  or either pin moved printing one-way (four cases, the pins moved in the real `managed.yml`),
  and neither printing reversible; since the review, a return to the running tag after a failed
  deploy with a migration printing one-way too. All failed without the script.
- **Said before anything moves, too (later the same day).** `deploy-live.sh --dry-run <tag>` runs
  every refusal of the deploy, the release rule's included, prints the same one-way or reversible
  by the same comparison, and stops before the checkout: nothing checked out, installed, built,
  deployed or logged. The owner runs it with the hold on, and dumps the database when it says
  one-way and a way back is wanted. Its cases in the guard: one-way for a tag adding a migration
  to either chain and reversible for one adding none, each matching the verdict the real deploy
  then logs; a lightweight tag, a tag not on origin and another `package.json` version still
  refused. 0132's entry has the rest, and the mutations.
- **Docs.** `docs/managed-bring-up.md`'s *Updating a running deployment* has the `ownpace-live`
  paragraph, rollback stated plainly included, and `docs/release.md` has §5, *Deploying a release
  to ownpace-live*, pointing to 0132's procedure.
- **Open.** T0's name and T2's tag, the first release this can deploy; 0132 T1b, live standing;
  open question 6.

**2026-09-28, build: T2 steps 2 and 3, built on branch
`claude/ownpace-public-readiness-y7orc6-a-release-that-names-itself`, not merged.** Steps 1 and 4
to 6 wait for T0, the owner's choice of the name, and for the owner. Nothing is bumped, renamed or
tagged: the root `package.json` still says `0.1.0-rc.1`, `[Unreleased]` keeps its name, and
`bug_report.yml`'s example is unchanged.

- **Step 2, the build in the problem report.** `ticketFor` (`apps/api/src/problem-report.ts`) ends
  the ticket's facts with `Build: v<version> · <commit>`, from `buildIdentity()`, the value
  `/version` answers. The commit is its first seven characters, as the page's build stamp writes it
  (`describeBuild`). One difference: with no commit the stamp shows the version alone, and the
  ticket says `commit unknown`, since a bare `v0.1.0-rc.1` reads as that release. `ticketFor`
  takes the build as a fourth argument that defaults to `buildIdentity()`; the route passes none.
  The link report (`linkReportTicketFor`, 0108 T8 (d)) has no build line. It is not a tester's
  problem report, and step 2 names only `ticketFor`.
- **Guard 1.** `a-report-that-reaches-a-person.unit.test.ts` has two new cases and two extended
  ones. The ticket names the build from `buildIdentity()`, with `OPENMIG_VERSION` stamped and
  without it (then the root `package.json`'s version). A build with no commit says so. The
  exact-body case and the route case carry the line. On the unchanged code four cases failed and
  21 passed.
- **Step 3, the check.** `scripts/release-names-agree.mjs` exports `checkReleaseNames`,
  `compareSemVer` and `parseSemVer`, and is a command: `node scripts/release-names-agree.mjs
  [<tag>]`, with the tag from the argument or `GITHUB_REF_NAME` and the existing tags from
  `git tag --list 'v*'`. It refuses a tag that is not `v` plus the root version, a version with no
  `## [<version>] - <YYYY-MM-DD>` heading, and a tag SemVer orders at or below an existing release
  tag. It names every disagreement at once. The SemVer order is semver.org's section 11, written
  out in the script: `semver` is in the lockfile only as another package's dependency, and the
  check runs before any install, so it imports only Node's own modules. Its types are in
  `release-names-agree.d.mts`.
- **Wired.** `images.yml` (job `build`), `security-scan.yml` (job `security-scan`) and
  `windows-payload.yml` (job `build`) run it as the first step after the checkout, under
  `if: startsWith(github.ref, 'refs/tags/')`, the condition the release steps of the last two
  already use. The step first fetches the `v*` tags at depth 1, because the checkout is shallow
  and holds only the tag being cut. Runs on a branch, a pull request or the schedule skip it.
  `ci.yml` is not wired, as §3 says. Its detect-changes filter now selects `CHANGELOG.md`, which
  the new guard reads, so a change to it alone runs the tests (the rule
  `a-doc-a-test-reads-that-ci-skipped` holds). `docs/release.md` §2 names the check.
- **Guard 2.** `scripts/a-release-that-names-itself.unit.test.ts`, 23 cases. (a) The three shapes
  §3 names are refused and a set that agrees is accepted; SemVer's order, the changelog heading
  and the command, in a throwaway repository, are tested too. (b) Every workflow that runs on a tag
  and has a publishing step calls the check before its first publishing step. The test reads this
  from the YAML, by rules its header states and small cases test. Before the script existed the
  file did not load. With the script and before the wiring, the two workflow cases failed and named
  the three jobs.
- **Mutations:** twelve, each turned a guard red. In the API: no build line (4 cases fail), eight
  commit characters (2), a version not from `buildIdentity()` (1). In the script: ASCII order
  reversed (5), the changelog not read (4), the version not compared (3), equal precedence allowed
  (1), the tag read from `GITHUB_REF` (1). In the workflows: the check moved after the push in
  `images.yml` (2), the tag fetch removed in `security-scan.yml` (1), the check under
  `refs/heads/main` in `windows-payload.yml` (1), `|| true` after it in `images.yml` (1).
- **Not proved.** No tag has been cut since rc.1, so the check has not run on one. A re-run of an
  older tag's workflows, once a newer release is tagged, is refused as well.
- **Open.** Step 1, the bump, the rename and the issue template's example: T0, the owner's name
  (open question 1). Step 4, the upgrade gates against rc.1 on the reference machine: open question
  3. Steps 5 and 6, the commit and the tag: the owner. The pull request's merge: the owner.

**2026-09-27, evening: 0131 T5's row follows T6 (a).** #1231 merged T6 (a) on 2026-09-27, so
the row's *Today* cell no longer says the tasks run Node 21. It says `trigger.config.ts` names
`runtime: 'node-24'` since #1231, and that `ownpace-live`, whose deploy output the minimum reads, is
not stood up (0132 T1b). T6's task row reads ✅ **done** in #1231 for (a); Guard 2 is still not
built. The note below keeps *not merged*, which held when it was written.

**2026-09-27, build: T6 (a), the setting and Guard 1, built on branch
`claude/ownpace-public-readiness-y7orc6-tasks-on-node-24`, not merged (0131 §6, group R7, step
5).** Guard 2, the pull-request check that the task bundle loads, comes after the first
invitation and is not built here.

- **The setting.** `apps/worker/trigger.config.ts` declares `runtime: 'node-24'`. Its comment
  says what §3 asks: 24 is the images' Node major (the api and selfhost images run it, the web
  image builds on it and serves from nginx), the version guard holds the two together, and
  without the line the CLI takes the server project's default runtime, or else its own `node`,
  which in 4.5.16 is Node 21. It also names the base image the CLI builds on, and says a change
  there takes a task re-deploy.
- **Checked against the pinned packages.** `apps/worker/package.json` pins `@trigger.dev/sdk`
  4.5.16, and the root `package.json` pins it and `@trigger.dev/core` at 4.5.16. The SDK's
  `defineConfig` takes core's `TriggerConfig`, whose `runtime` is a `ConfigRuntime`: `node`,
  `node-22`, `node-24`, `node-26`, the two deprecated `experimental-` aliases, and `bun` (core's
  `dist/esm/v3/schemas/build.d.ts`, line 15). Core's `resolveBuildRuntime` returns `node-24`
  unchanged. The published CLI, `trigger.dev@4.5.16`, read again from npm for this build, builds
  `node-24` on `triggerdotdev/node:24-bookworm@sha256:d2d0c018…` (`dist/esm/deploy/buildImage.js`,
  line 451) and `node` on `triggerdotdev/node:21-bookworm@sha256:49c6575c…` (line 449). It reads
  the evaluated config's `runtime` (`dist/esm/config.js`, line 102), passes it through that same
  `resolveBuildRuntime` (line 103), and keeps it: the server project's default replaces it only
  when the config names none (`runtimeWasExplicit`, `dist/esm/commands/deploy.js`, line 268).
- **The comments are corrected.** The headers of `crc32.ts` and
  `a-checksum-the-runtime-did-not-have.unit.test.ts` now say the CLI is pinned, the config named
  no runtime, the CLI's default was Node 21, and the config names `node-24` since this task. The
  CRC-32 module stays, as §3 says.
- **Guard 1.** `scripts/a-gate-on-a-version-nothing-ships.unit.test.ts` has a third block, *the
  tasks run the Node major the images ship*, with three cases. It imports the config and reads
  its evaluated `runtime`, the value the CLI reads, not the file's text. The config names a
  runtime. It is `node-<N>`, where N is the images' one major. And the pinned core's
  `resolveBuildRuntime`, the function the CLI calls on the value, returns it unchanged. The
  header's *Not read here* paragraph is now a section that says what the block holds and what it
  does not prove.
- **Failed first.** All three cases failed on the unchanged config, and the six existing cases
  passed. The messages were `expected undefined to be defined`, `expected undefined to be
  'node-24'` and `Unsupported runtime undefined in trigger.config`. **Mutations:** six, each
  turned the block red. `node-22` failed one case, `experimental-node-24` two, the line commented
  out with `//` three, the line inside a `/* … */` block comment three, and a second
  `runtime: 'node-22'` after the first one (the later key wins, for the CLI and for the guard).
  Moving the three images and the runtime to 25 together failed the third case, because the
  pinned core has no `node-25` (the `setup-node` case failed too).
- **Review fixes (2026-09-27).** The first version of the block read the config as text, with a
  regex for a `runtime:` line. The review found that a line inside a block comment still matched:
  with it, all nine cases passed while importing the config gave `runtime` as `undefined`, which
  is what the CLI would have seen. The block now imports the config, and on that same mutation
  all three of its cases fail. The review also found the two `buildImage.js` line numbers above
  in the wrong order, the config's comment saying the web image runs Node 24 (it only builds on
  it), and the comment above `isTest` leaving out that, with no runtime named, the server
  project's default comes before the CLI's own. All three are corrected.
- **Departures from §3.** The third case is new. Before this build, `pnpm typecheck` did not read
  `apps/worker/trigger.config.ts`: the root `tsconfig.json` takes `apps/*/src/**`, `scripts/**`
  and root-level `*.config.ts`, and `tsc --listFilesOnly` did not list the file. The guard's
  import now brings it in through `scripts/**`, so typecheck refuses a runtime the pinned SDK does
  not know, and a duplicate key (TS1117). The third case stays: typecheck accepts the deprecated
  `experimental-node-24`, and the case does not rest on typecheck having run. The test's comment
  above `isTest` repeated the *"a CLI this repository does not pin"* claim; it is corrected too,
  though §3 names only lines 12 to 16.
- **What to look for on the machine.** The proof is the first scheduled run of the managed gate
  (`e2e-managed.yml`) after this merges. Its task deploy (`bootstrap-managed.sh`, which runs
  `deploy-tasks.sh`) builds the task image, and the build output should name
  `triggerdotdev/node:24-bookworm@sha256:d2d0c018…` where run #193's named
  `node:21-bookworm@sha256:49c6575c…`. A green run also shows that the self-hosted supervisor at
  `v4.5.16` runs the image. A task's log line with `process.version`, or `node -v` in the image,
  answers which Node 24 minor it carries. Neither is verified yet (§3). For `ownpace-live`, §4's
  row asks the same of its first deploy from the alpha tag.
- **Open.** Reading that run's build output, after the merge: the R session. Guard 2, after the
  first invitation: the R session. 0131 T5's go/no-go row for 0146 still says in its *Today*
  column that `trigger.config.ts` names no runtime. It is updated in the post-merge sweep, as
  0131's other *Today* cells have been after their merges, not on this branch: the R session. The
  pull request's merge: the owner.

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
T7, T8, T9, T10, T11 (its (c) after the Alpha) and T12a. T7 is one sentence from the owner, and is
best given with T0.

| Task | Status | Notes |
|---|---|---|
| T0 The alpha's version name, and whether any rename comes first | ✅ **Answered 2026-09-28**: *"The version name (0146 T0): ok, what do I do?"*, read as accepting the whole recommendation: `v0.2.0-alpha.1`, then `alpha.2`, `alpha.3` for each deploy; no rename; no last squash. The owner named no item, and has not objected since (Status, 2026-09-28) — *was:* ⏳ **Owner** | §3. **Alpha minimum.** Recommended: `v0.2.0-alpha.1`, then `alpha.2`, `alpha.3` for each deploy; no renames, as ADR-0040 already decided. Two other names each have a trap (§1). |
| T1 A changelog section a reader can use | ✅ **Merged** as #1766 on 2026-11-01 (`479f9230`; *was:* 🔨 built as draft #1766 on branch `claude/ownpace-public-readiness-y7orc6-release-record-0146`, not merged, 2026-10-31): the *since rc.1* part at the top of `[Unreleased]`, which the fold makes alpha.4's section, its verdicts read from `SOURCE_PROOFS` on 2026-10-31 (Status, 2026-10-31, later) — *was:* 📋 **Proposed** (D1, D6) | §3. After the first invitation, unless it is ready before the tag. Grouped by what a tester notices, with the experimental sources marked, and the stale lines corrected. |
| T2 The version bumped, the tag cut, and the build named where it is needed | ✅ Steps 4 to 6's **Release workflow done** in #1682, merged 2026-10-23 (`54e4c3d2`), and proven on `main` the same day by Release runs 1 to 6 (Status, 2026-10-23); `v0.2.0-alpha.2`'s tag ✅ cut 2026-10-27 on the fold, `f62bcbe2` (#1706); `v0.2.0-alpha.3`'s ✅ cut 2026-10-30 on `e1b21aac` by Release run 41066208430 (#16), the counted nights waived by the owner for that version alone (#1741), and published with `bom.json` and the Windows zip (Status, 2026-10-31). The preflight reads the fold, CI and the scan on C, the nights and both chains' upgrade gates (the managed chain's is T4's, #1681); the tag and the publishing are the workflow's after the owner's approval (Status, 2026-10-23); Step 1 ✅ **done** in #1305, merged 2026-09-28 (`0c1a8d8c`): the root version `0.2.0-alpha.1`, `CHANGELOG.md`'s `[0.2.0-alpha.1] - 2026-09-29` with T2's floor, the issue template's Build example, `release.md`'s count of six, and (reviews, 2026-09-28) `openapi.yaml`'s `info.version` held to the root version by guard block (d) and named in `release.md`, the Build field sending managed and Docker testers to the sidebar and Windows testers to the log line, and the stamp held at the bottom of the sidebar in both editions. Steps 2 and 3 ✅ **done** in #1274, merged 2026-09-28 (`1353f062`): the build line in the problem report, `scripts/release-names-agree.mjs` in the three publishing workflows, and both guards. Steps 4 to 6 📋 the owner's: the drill from rc.1, the commit by the two-green-scheduled-nights rule (0141 T14), and the tag and its push; `v0.2.0-alpha.1` is tagged, 2026-10-06 (on `90a23e9b`), and `v0.2.0-alpha.2` is the version since #1558 (merged 2026-10-11) but not yet tagged (both read from the remote 2026-10-16); 📋 **Decided 2026-10-05**, *"Two tags"*: `v0.2.0-alpha.1` once the pull requests in flight merge, to stand live up and rehearse, then `v0.2.0-alpha.2` with the final texts, its own freeze, two nights and deploy, before the first invitation (Status, 2026-10-05) — *was:* steps 4 to 6 🔨 through the Release workflow on branch `claude/ownpace-public-readiness-y7orc6-release-workflow`, not merged (2026-10-23); step 1 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-a-release-named-v0-2-0-alpha-1`, not merged (2026-09-28); steps 1 and 4 to 6 📋 waiting for T0 (the name) and the owner (2026-09-28); 🔨 steps 2 and 3 built on branch `claude/ownpace-public-readiness-y7orc6-a-release-that-names-itself`, not merged (2026-09-28); 📋 **Proposed** (D1, D5) | §3. **Alpha minimum.** `docs/release.md`'s procedure, a check that the tag, `package.json` and the changelog agree before anything publishes, and a build line in every problem report. |
| T3 Pre-release ends at the alpha tag, and the repository holds to it | ✅ **Merged** as #1766 on 2026-11-01 (`479f9230`; *was:* 🔨 built as draft #1766 on branch `claude/ownpace-public-readiness-y7orc6-release-record-0146`, not merged, 2026-10-31): `release-line.json` (`v0.2.0-alpha.1`), the script's refusal, ADR-0045 amended, the runner's message, the README, and `a-chain-that-only-grows`, with byte equality against the newest release that shipped each file (Status, 2026-10-31, later) — *was:* 📋 **Proposed** (D3) | §3. After the tag exists. The squash script refuses; no migration a release shipped may change; ADR-0045, the runner's message and the README say so. |
| T4 Upgrades rehearsed from rc.1 and from the alpha tag, on both chains | The managed chain's upgrade proof from the alpha tag ✅ **done** in #1681, merged 2026-10-23 (`b357add8`): `packages/managed/src/migrate-upgrade.unit.test.ts`, from `UPGRADE_FROM_REF` or `v0.2.0-alpha.1`, both chains, with the shared gate's allow-list held to releases before the split (Status, 2026-10-23); the unit legs from both starting points, the Postgres leg and `every-release-is-a-starting-point` ✅ **merged** as #1766 on 2026-11-01 (`479f9230`; *was:* 🔨 built as draft #1766, not merged, 2026-10-31); the container drill from the alpha tag stays the next release's (`release.md`) — *was:* the rest 📋 **Proposed** (D3); 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-managed-upgrade-test`, not merged (2026-10-23) | §3. The container drill from rc.1 runs in T2. The rest follows the tag: both unit gates start from both tags, the managed chain included, on Postgres as well as PGlite. |
| T5 `ownpace-live` runs only a release tag | (a) ✅ **done** in #1277, merged 2026-09-28 (`2cfe7cd6`), in 0132 T6's `deploy-live.sh`, first run on live 2026-10-27/28 for `v0.2.0-alpha.2` (0132 Status, 2026-10-29), and on 2026-10-30 for `v0.2.0-alpha.3`, which live runs from its tag since, deployed in the two runs T13 needs, the second saying *the deploy took* at 23:44:35 UTC (0132 Status, 2026-10-31): the release rule, `/api/version`'s version, one-way or reversible, and the guard's four cases. `--external-id` is deferred (open question 6) — *was:* (a) 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-a-deploy-from-a-named-tag`, not merged (2026-09-28); 📋 **Proposed** (D2, D3, D4) | §3. **Alpha minimum.** 0132 T6's procedure and script, with the tag always a release whose name, version and commit agree. The deploy says before the hold lifts whether it can be undone. |
| T6 The tasks run the Node the images run | ✅ **done** in #1231, merged 2026-09-27: (a), `runtime: 'node-24'` and Guard 1. Guard 2, the bundle-load check, not built (after the first invitation) — *was:* 📋 Proposed | §3. **Alpha minimum:** `runtime: 'node-24'` in `trigger.config.ts` (supported by the pinned CLI, read from its package) and the version guard extended. **After the first invitation:** a pull-request check that the bundle loads. |
| T7 The object store: replace the frozen MinIO, or accept it for the alpha in writing | ✅ **Merged** as #1692 on 2026-10-25 (`0029db4a`), after E2E (managed) #281 was green; its digest moved to `268d68a2…` (the fork's RELEASE.2026-10-23T20-06-51Z) in #1726, merged 2026-10-28 (`0f3fda25`) after E2E (managed) run 40706723499 was green, in alpha.3 (0119 Status); to `3b6e40c3…` (Wolfi's -r2 of the same release, with go-jose 4.1.6 for CVE-2026-116587), before its floor under the security-fix exception, ✅ merged as #1762 on 2026-11-01 (`db9e5c82`; *was:* 🔨 on branch `claude/ownpace-public-readiness-y7orc6-minio-3b6e40c3`, not merged), for alpha.4, E2E (managed) run 41240747301 green on its `ca44caca`, with Trigger.dev v4.8.3 (0119 Status, 2026-10-31); *was:* 🔨 being built on branch `claude/ownpace-public-readiness-y7orc6-object-store-swap` (2026-10-24): Chainguard's MinIO by index digest on a new volume, `minio-init` making `packets`, and the guard; **answered 2026-10-23**: *"T7 no, fix already within the alpha"*, so the frozen image is not accepted, and is replaced within the Alpha. Done since: live runs it from alpha.2 (deployed 2026-10-27/28, on a new volume), and the owner removed the Bitnami-era volume on both stacks, `ownpace-managed_minio_data` and `ownpace-live_minio_data`, with the old images, on 2026-10-28 at about 22:30 UTC (§3 step 4). Because of that, a rollback of live to alpha.1 can no longer bring its packet store back (the operator runbook, *Rolling back from it, by day 6*) — *was:* Remains: live from the tag that carries it (alpha.2) after the drain, starting empty, and the old volume removed by the owner on each stack (§3) — *was:* ⏳ **Owner** | §3. The owner declined the recommendation to accept it for the alpha and replace it at its end: Chainguard's maintained MinIO build replaces it now, with versitygw still the fallback (0119 §3, item 5, decided 2026-10-23 and built 2026-10-24). |
| T8 A watch on the pinned images Dependabot leaves alone | Watch half ✅ **done** in #1663, merged 2026-10-21 (`087183b7`): every pin Dependabot cannot see, one issue per owner's-call row and one summary issue, and `/deploy/compose` out of `dependabot.yml` (Status, 2026-10-21); scan half ✅ **done** in #1674, merged 2026-10-22 (`51a0d267`): a weekly, report-only Trivy scan of every image the stacks run, with one issue per image past its end of life (Status, 2026-10-22) — *was:* scan half 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-image-scan`, not merged (2026-10-22); watch half 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-pin-watch`, not merged (2026-10-21), scan half 📋 Proposed; 📋 **Proposed** | §3. Widened 2026-10-21: Dependabot read no file in `deploy/compose`, so the watch covers every image line of its `managed.yml`, `dev.yml` and `www.yml` and the busybox and GoAccess copies in its scripts, `packageManager`, the Trivy the scan runs and the TypeScript split as well as Trigger.dev, ClickHouse and the task base image. MinIO has no upstream to compare with and is left to the scan half; since 0146 T7 (on its branch, not merged, 2026-10-24), Chainguard's MinIO `latest` is compared by its index digest, and `bitnamilegacy/minio` leaves the watch's list of images compared elsewhere. |
| T9 The API image runs without the dev tools | ✅ **Merged** as #1687 on 2026-10-28 (`9480e898`), after E2E (managed) run 40656320601 and E2E (self-hosted) run 40661756633 were green; in alpha.3: the install takes `--prod`, two packages declare what they load, and the merged tree boots, migrates and reads 0 critical and 0 high (Status, 2026-10-25) — *was:* 🔨 being built as draft #1687 on branch `claude/ownpace-public-readiness-y7orc6-api-image-prod-deps`, for after the alpha.2 tag (2026-10-25); 🔨 being built as a draft, for after the first invitation (2026-10-23) | Status, 2026-10-23 (the scan triage). `apps/api/Dockerfile`'s runtime stage copies the build stage's whole `/app`, where `pnpm install --filter @openmig/api...` installed the devDependencies too, the root's included, and `CMD` (`node apps/api/src/index.ts`) needs none of them. Their Go binaries are 2 critical and 65 high of the image's 3/125 on 2026-10-23: esbuild 0.25.12 (Go 1.23.12; drizzle-kit's and `@esbuild-kit/esm-loader`'s), counted twice, and TypeScript 7's native compiler (Go 1.26.4). The lockfile itself, dev dependencies included, reads 0/0. Done when the runtime image holds production dependencies only, a dependency it still needs and lacks fails at start, which the managed gate's first `curl $API/health` catches, and the image scan of `main`'s `:edge` (`ownpace-api-edge`) finds the Node base's findings alone; `ownpace-api-release`, which reads the newest tag, and live follow with the alpha.3 tag. |
| T10 The image scan reads the tasks' image as it is built | ✅ **Merged** as #1700 on 2026-10-27 (`ee9be30f`), after CI was green; in alpha.3: the leg builds the deploy's `base` stage from `trigger.config.ts`'s own extensions on GitHub's arm64 runner and scans it under the same category, its local tag in the base's repository so the alerts keep their location (Status, 2026-10-25) — *was:* 🔨 being built as draft #1700 on branch `claude/ownpace-public-readiness-y7orc6-tasks-image-scan`, for after the alpha.2 tag (2026-10-25); 📋 Proposed (2026-10-23) | Status, 2026-10-23 (the scan triage). `scripts/image-scan.mjs` scans the base image the pinned CLI names (`triggerdotdev/node:24-bookworm` by digest, category `trigger-task-base`, 14/117 on 2026-10-23), not the tasks' image that `deploy-tasks.sh` builds from it. The Trigger.dev v4.7.6 branch upgrades that image's Debian packages at build (`apt-get -y upgrade`), which fixes the 42 Debian findings that have a fix (12 critical, all Perl, fixed in 5.36.0-7+deb12u4, and 30 high). It leaves npm's bundled packages under `/usr/local/lib/node_modules/npm`, since the overlay copies only `/usr/local/bin/node` (tar 7.5.15's CVE-2026-59873, critical, fixed in 7.5.19, and 12 high, 11 of them with a fix), and the 76 Debian findings without a fix, zlib1g's CVE-2023-45853 among them: the built image would still carry 2 critical and 87 high of the 131 (read with Trivy 0.76.0, 2026-10-23). The scan cannot see the upgrade, so the category keeps alerts for 42 findings the built image no longer has. The scan runs on a GitHub-hosted runner, which cannot read the stack's own registry, so the proposal is to build the image in the scan job as the deploy builds it. The old category, if renamed, has its configuration deleted by hand (T8). |
| T11 The patch and minor moves that clear findings | (a) ✅ **Merged** as #1699 on 2026-10-28 (`e33d7902`), after E2E (managed) run 40631369534 was green; in alpha.3 (Status, 2026-10-25); (b) ✅ **Merged** as #1698 on 2026-10-28 (`29d1d7e0`), after E2E (managed) run 40635727901 was green; in alpha.3 (the owner's yes, ADR-0022); (c) 📋 **Proposed**, after the Alpha (2026-10-23) — *was:* (a) 🔨 being built as draft #1699 on branch `claude/ownpace-public-readiness-y7orc6-mailpit-1-32-0`, for alpha.3 (2026-10-25); (b) 🟡 built 2026-10-25, draft #1698, to merge after the alpha.2 tag | Status, 2026-10-23 (the scan triage), read with Trivy 0.76.0 on linux/amd64. (a) **Mailpit v1.32.0**: 0/0, where v1.31.6 has CVE-2026-111943 (Go's `crypto/x509`); for alpha.3 (*was:* after the first invitation), by hand in `managed.yml` and in `scripts/a-service-that-phones-home.unit.test.ts`, which pins the reference by tag and digest and records Mailpit's release check as read at v1.31.6, so that fact is read again at v1.32.0 in the same change. Done so on the branch: the release check read again at v1.32.0, unchanged. (b) **Stalwart v0.16.27** (Debian 13.7): 0 critical and 47 high, none with a fix, where v0.16.10 has 3/114. The owner's call: `docs/stalwart-integration-fix.md` pins v0.16.10 and says *"DO NOT change the pinned version"* (AGENTS.md puts its decisions in ADR-0022), and every copy moves together: `setup-stalwart.sh`, the fixture's Dockerfile, the Testcontainers setup, the fix doc and the guards that name it. (c) **ClickHouse 26.3** (26.3.59, Ubuntu 22.04): 0/0, where 26.2.19.43 has CVE-2026-45447 and CVE-2026-84782 in openssl. After the Alpha: the owner accepted 26.2 for it on 2026-10-23 (0119 §3 item 9 on the Trigger.dev v4.7.6 branch), and 26.3 is ahead of the 26.2 Trigger.dev's own compose pins, which the pin watch compares with (T8). It moves in `managed.yml` and in `scripts/a-service-that-phones-home.unit.test.ts` together: the guard pins the reference by tag and digest and records the crash-report default as read at `v26.2.19.43-stable`, as `clickhouse-no-crash-reports.xml`'s comment does, so both are read again at 26.3. |
| T12 The images' Node base on a named Debian, with no package manager at runtime | ✅ **Merged** as #1708 on 2026-10-28 (`13e2300e`), after #1687 and after E2E (managed) run 40663045583 and E2E (self-hosted) run 40669572838 were green; in alpha.3 — *was:* 🔨 being built as draft #1708 on branch `claude/ownpace-public-readiness-y7orc6-node-trixie-slim`, for after the alpha.2 tag and #1687 (2026-10-25) | Status, 2026-10-25. The api, selfhost and web images built on `node:24.22.1-slim`, Debian 12.15: 1 critical and 61 high on 2026-10-25. `node:24.22.1-trixie-slim`, Debian 13.7, reads 0/48 with the same Node binary, and 0/43 without npm and corepack, which nothing in the api or selfhost container runs. Done when the three FROM lines name Debian 13 by tag and digest, the two runtime stages carry no package manager, E2E (managed) and E2E (self-hosted) are green on it, and the scan's `-edge` categories read the base's 0/43 (the API's with T9). Distroless `nodejs24-debian13` (0/0) for the API is T13 (#1709), in alpha.3 with T13a, the owner's decision of 2026-10-26. |
| T12a The web image's nginx carries only what it loads | ✅ **Merged** as #1707 on 2026-10-28 (`53fb6453`), after #1678 and after E2E (managed) run 40626664067 was green; in alpha.3 — *was:* 🔨 being built as a draft on branch `claude/ownpace-public-readiness-y7orc6-nginx-alpine-slim`, based on #1678's, for alpha.3 (2026-10-25) | Status, 2026-10-25, and 0119's of the same evening. `nginx:1.31.8-alpine-slim` by index digest `f45171d3…` in `apps/web/Dockerfile`'s runtime and `deploy/compose/www.yml`, in place of 1.31.8-alpine `1ef7ca94…`: the same nginx package on the same base layers, without the 51 packages -alpine adds (curl, the njs, xslt, geoip, image-filter and acme modules, and their libraries). Trivy 0.76.1 on linux/arm64 and linux/amd64: -alpine 0/1 (brotli-libs 1.2.0-r1, CVE-2026-111497, fixed in 1.2.1-r0), slim 0/0; the stable line's 1.30.6-alpine 0/1 as well. Neither `nginx.conf.template` nor `www-nginx.conf` loads a module, the API upstream is plain HTTP and both health checks are busybox's `wget`; `scripts/an-nginx-that-carries-only-what-it-loads.unit.test.ts` holds the variant in both files and refuses a dropped module's directive or a curl in a health check or a runbook's look inside, since nothing runs `www.yml` to see one. Merged after #1678 and the alpha.2 tag, not before 19:51 UTC on 2026-10-27 (three days after the slim index was pushed, to add riscv64), with E2E (managed) on the branch. The OTA site moves when a person brings `www.yml` up again; live's www with the next deploy while `WWW_LIVE` is true; live's web image with the release tag that carries it. |
| T13a The readers first | ✅ **Merged** as #1710 on 2026-10-28 (`f34588e6`), after E2E (managed) run 40671926123 was green; in alpha.3, which live runs since 2026-10-30 (Status, 2026-10-31) — *was:* 🔨 being built as draft #1710 on branch `claude/ownpace-public-readiness-y7orc6-api-readers`, for alpha.3 (2026-10-26) | Status, 2026-10-26. The half of T13 (#1709) that works before the switch: the smoke, the managed gate, `deploy-live.sh`, `stand-up-live.sh` and the docs read the api container's variables with `docker container inspect` and run Node there by its path, on the Node image and on distroless alike, and the smoke stops when the API's Node is not the version the tasks get. It ships in alpha.3 with T13, the owner's decision of 2026-10-26: every deploy started from alpha.3 or later runs a `deploy-live.sh` that reads from Docker, and the alpha.2 to alpha.3 live deploy runs twice, its first run alpha.2's script, which asks with `printenv` (Status, 2026-10-26; the procedures say so). Done when E2E (managed) is green on it (the smoke's preflights naming `/usr/local/bin/node v24.22.1`) and live runs alpha.3. |
| T13 The API's runtime on distroless | ✅ **Merged** as #1709 on 2026-10-28 (`b13d303e`), after #1708 (T12), #1710 (T13a) and #1687 (T9), and after E2E (managed) run 40673664905 and E2E (self-hosted) run 40679655003 were green; alpha.3, with #1710, the owner's decision of 2026-10-26, the alpha.2 to alpha.3 live deploy runs twice; live runs it from the tag since 2026-10-30: alpha.2's script did not take at 23:34:53 UTC on the `NODE_ENV` line alone, as expected, and the tag's took at 23:44:35 UTC (Status, 2026-10-31) — *was:* 🔨 being built as draft #1709 on branch `claude/ownpace-public-readiness-y7orc6-api-distroless` (2026-10-26) | Status, 2026-10-26. The API, the container the internet reaches through `/api`, runs on `gcr.io/distroless/nodejs24-debian13:nonroot` by digest: 0 critical and 0 high on amd64 and arm64, against T12's 0/43, with the same Node binary, and no shell, `printenv` or Node on PATH, and `/app` root's. Every script, workflow and doc that exec'd a shell, `printenv` or a bare `node` into it reads from `docker container inspect` or runs Node by its path instead, on old and new images alike, since T13a (#1710), in the same release. The tasks keep T12's Node line, and the smoke stops when the API's Node is not that line's version. Done when E2E (managed) and E2E (self-hosted) are green on it (the smoke's preflights naming `/nodejs/bin/node v24.22.1`), live runs a tag that carries it (from alpha.2, a deploy run twice, as the procedures say), and the scan's `ownpace-api-edge` reads the distroless base's 0/0 (with T9's `--prod` install). |
| T14 The tasks build on the API image's own base, with no package manager | ✅ **Merged** as #1716 on 2026-10-28 (`98802571`), after #1697 (`f387b175`) and #1708, and after E2E (managed) run 40758865207 was green; in alpha.3 — *was:* 🔨 being built (2026-10-26) as draft #1716 on branch `claude/ownpace-public-readiness-y7orc6-tasks-trixie-base`, stacked on #1697 | Status, 2026-10-26. `apps/worker/trigger.config.ts` sets the build manifest's `image.base` to `apps/api/Dockerfile`'s FROM image and `image.buildBase` to the CLI's own `-build` image, and one layer installs `ca-certificates` and `dumb-init`, makes the CLI's trust edits and drops every package manager where no `g++` is. On #1708's `node:24.22.1-trixie-slim` the runtime stage reads 0 critical and 43 high, none fixable, where the image a deploy builds on the CLI's base read about 2/88 on 4.7.6 (`main` until #1697) and 1/80 on #1697 (Trivy 0.76.1, amd64 and arm64). The weekly scan lists that base as `trigger-task-base`, and #1700 (T10) builds the layer on it. A Trigger.dev move fails the version gate until the CLI's build image and trust list are read again. E2E (managed) after #1697 and #1708: run 40758865207, green before the merge. |
| T15 Both databases of the managed stacks start as uid 70, from the official image without gosu | ✅ **Merged** as #1717 on 2026-10-28 (`6f9af7f2`), after #1678 and after E2E (managed) run 40616652331 was green; in alpha.3, which live has taken from the tag on 2026-10-30: before the deploy both databases' data files read owned by `postgres`, and after it no container was unhealthy, starting or restarting (Status, 2026-10-31) — *was:* 🔨 being built as draft #1717 on branch `claude/ownpace-public-readiness-y7orc6-postgres-without-gosu`, stacked on #1678, for after the alpha.2 tag (2026-10-26) | Status, 2026-10-26. `postgres:18.6-alpine` reads 1 critical and 26 high (Trivy v0.76.1, arm64 and amd64); the critical and 25 highs are Go's standard library in gosu, which the entrypoint runs only when it starts as root. `deploy/compose/postgres/Dockerfile` removes it and starts as uid 70, the user gosu dropped to; `managed.yml`'s `postgres` and `trigger-db` and `dev.yml`'s run it, and the scan builds and scans it. Done when E2E (managed) is green on the branch (the OTA stack's existing volumes, started as uid 70, and a second bring-up leaving both databases running on the same image ID), `build (postgres)` is green on the pull request, the image scan's `postgres-managed` reads 0 critical and 1 high (brotli-libs, until docker-library rebuilds 18.6-alpine), and live has taken it from a tag. The appliance's Postgres is T15b. |
| T15b The appliance's Postgres starts as uid 70, from the official image without gosu | ✅ **Merged** as #1719 on 2026-10-28 (`fb0fea2e`), after #1717 and after E2E (self-hosted) run 40621523504 was green; in alpha.3 — *was:* 🔨 being built on branch `claude/ownpace-public-readiness-y7orc6-appliance-postgres-without-gosu`, stacked on #1717, for after the alpha.2 tag (2026-10-26) | Status, 2026-10-26, last. The appliance's `postgres:18.6-alpine` (`77f58511…`) reads 1 critical and 26 high (Trivy v0.76.1, arm64); the critical is gosu's Go, and no newer digest drops it. `deploy/selfhost/postgres/Dockerfile` is T15's instructions on the appliance's own base, `deploy/selfhost/compose.yml` runs it as `localhost/postgres:18.6-alpine-b18f51417292` (never pulled), Dependabot moves its FROM in an entry of its own, the scan's `postgres-selfhost` leg builds it, `build (postgres)` proves it on a pull request, and E2E (self-hosted) builds `app` by name. Done when `build (postgres)` is green on the pull request (the appliance's build started on a volume the official image initialised as root), E2E (self-hosted) is green on the branch with `persistence: postgres`, the image scan's `postgres-selfhost` reads 0 critical, and a release tag carries it. |
| T16 The Trigger.dev images run without the files nothing here runs | ✅ **Merged** as #1722 on 2026-10-30 (`30533c7f`), with the dompurify swap as #1742 (`2a1666ae`), both in alpha.3, **which live runs since 2026-10-30**: the dry run said one-way, *cannot be compared … on the Trigger.dev pin*, a take with `triggerdb`; the second run said *v4.7.6 -> v4.8.1*; no container unhealthy, starting or restarting, the supervisor at v4.8.1 and the tick `COMPLETED_SUCCESSFULLY` on 4.8.1. The copy before the update was **not kept** as the done-condition asks: the owner removed it by hand early on 2026-10-31 and set `COPY_DELETE_WHEN_PROVEN` back to `true`, so the way back is a fix forward (Status, 2026-10-31); built (2026-10-27) on branch `claude/ownpace-public-readiness-y7orc6-trigger-patched`, stacked on #1716 with #1717 merged in; #1722, **in alpha.3** (the owner, 2026-10-30: *"Put all alpha 4 into alpha 3"*; first planned for alpha.4); **decided 2026-10-26** by the owner: *"Both"*, an issue upstream and this build until upstream ships the fixes; and **2026-10-27**: tar out of the copy of pnpm each service runs too | Status, 2026-10-27 (both entries). `deploy/compose/trigger.dev/Dockerfile` and `deploy/compose/supervisor/Dockerfile` build on upstream's images by tag and digest (v4.8.1 when built; v4.8.3, `read_at` with it, since the move of 2026-10-31, 0119) and delete depot's and esbuild's Go binaries (both names each), node's copy of pnpm and the tar in root's from the webapp, root's copy of pnpm and the tar in node's from the supervisor: 8 critical findings to 2, and 2 to 0 (risk accepted: a native `pnpm install` in these containers would fail). Since 2026-10-30, an alpha.3 addition (Status, *after the fold*): the webapp's build also replaces dompurify 3.4.13's files with 3.4.17's, fetched from the npm registry and refused unless their sha512 is the one npm published, and proves nothing else in the image changed; nothing here loads dompurify, so no code that runs changes, and the webapp's 2 go to 1 (zlib1g). Dropped when upstream moves dompurify past 3.4.13. Since 2026-10-31, for alpha.4 (Status, *npm and node-gyp's tree out of both Trigger.dev builds*, #1763, merged 2026-11-01 (`a94dd5b3`; *was:* draft #1763): `build (trigger, amd64|arm64)` green in Images run 41233684732, and E2E (managed) run 41236579127 green on `9e5c270e`, 2026-10-31 20:29–20:39 UTC): both builds also remove npm 11.19.1, which Node bundles and nothing here runs, with its `npm` and `npx` links, and the rest of node-gyp's tree in the copy each service runs (`dist/node_modules`, tar in it, and `dist/node-gyp-bin`), under tar's risk: twelve fixable highs in each image, after checking pnpm's own files name only the three packages of it read and that corepack 0.36.0 stays. Every removal names a version-locked path and fails the build by name when upstream moves it; each build refuses a release other than its `read_at` and an entrypoint other than the one read; `trigger-version.sh pin` moves both FROMs and names, never `read_at`; a move's pull request has both builds green before any window; both services set `COREPACK_ENABLE_NETWORK: "0"`. Done when `build (trigger, amd64|arm64)` is green on the pull request, a dispatched image scan reads 1 and 0 (2 and 0 before the dompurify swap; after npm and node-gyp's tree, 68 and 13 fixable, measured on the branch at v4.8.3), E2E (managed) is green on the branch and live has taken it from a tag: live's deploy from alpha.2 (first run, alpha.2's script) says one-way, *cannot be compared … on the Trigger.dev pin*, and copies triggerdb; the second run (the tag's script) says *v4.7.6 -> v4.8.1*; both services run healthy from the `localhost/` names; and the copy is kept (`COPY_DELETE_WHEN_PROVEN=false`) until the task runner has run real work on them. From then on, T16a judges every deploy by the version: a later change to the builds alone at v4.8.1 is reversible. Dropped removal by removal as upstream fixes them. |
| T16a `deploy-live.sh` reads the Trigger.dev pin as a version, in alpha.3 | ✅ **Merged** 2026-10-27 as #1721 (`991bd21c`), commit `4628488b` alone, in alpha.3 (T16's review asked for it on its own, for the alpha.3 merge order) | Status, 2026-10-27, later. The one-way or reversible verdict of a deploy, and whether its copy holds triggerdb, are computed by the `deploy-live.sh` of the checkout that runs before the deploy. alpha.3's must read `${TRIGGER_IMAGE_TAG:-v…}` as the version (`trigger_pin`), or alpha.4's `localhost/` image lines read as a pin it cannot compare. CI only (the deploy guard, `a-deploy-from-a-named-tag`); no window. Done when it is in the alpha.3 tag live deploys. With T16 in alpha.3 as well (2026-10-30), it judges every deploy after alpha.3; alpha.3's own deploy from alpha.2 is judged by alpha.2's script (T16's row). |

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
    model is wanted, at the price of more ceremony at bring-up. Re-read on 2026-10-23 (0119 §3
    item 5): a maintained free build exists, Chainguard's `chainguard/minio`, which is now the
    candidate; versitygw is the fallback.
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
  ADR-0040's own warning (its *Renamed to `ownpace-*`* rule).
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
     *executed* (`release.md` said five until 2026-09-28; the file has six);
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
  gate compares byte for byte with a release today (T4's upgrade proof, below, compares it with
  its comments removed). rc.1 stays outside the rule: its `0001_baseline.sql` differs from HEAD's
  today (checked on 2026-09-24), under the allow-list §1 names.
- **Comment-only edits: T3 decides, it does not inherit.** The managed chain's upgrade proof
  (T4, `packages/managed/src/migrate-upgrade.unit.test.ts`, 2026-10-23) is looser than the rule
  above. It compares an applied file with its comments removed, and accepts an edit to comments
  alone, saying which files had one. It has to, today: `main` already carries #1650's notes in
  managed 0006 and 0008, added after alpha.1 and pointing at 0059. So the rule as written fails on
  `main` the day T3 lands. T3's build chooses one of two:
  - **(a) byte equality, as written.** The same pull request puts 0006 and 0008 back to alpha.1's
    bytes (0059's header already names both, so the notes lose nothing), and the upgrade proof's
    comparison is tightened to bytes to match. **Proposed**: a note the database never reads costs
    nothing to keep in a new file, and a byte comparison does not depend on an SQL reader being
    right.
  - **(b) comments may change.** The rule says *"no statement of a migration a release shipped may
    change"*, ADR-0045's amendment says the same, and T3's guard compares as the upgrade proof does.

  Until T3 lands, the upgrade proof's comparison is the only check that a managed file a release
  shipped is unchanged, and it reports every comment-only edit it accepts.
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

**Built 2026-09-28** in 0132 T6's script (on branch
`claude/ownpace-public-readiness-y7orc6-a-deploy-from-a-named-tag`, not merged), all but
`--external-id`, which is deferred; the Status block says why.

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
- **(b) Replace it before `ownpace-live`'s first deploy, with versitygw** (0119's candidate on
  2026-09-24; since the re-read of 2026-10-23 the candidate is Chainguard's MinIO build, with
  versitygw as the fallback, 0119 §3 item 5). `ownpace-live`'s object store starts empty, so this
  is the one moment the swap needs no copy. But:
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
  (0131 T4). Re-read on 2026-10-23: *at the end of the alpha*, because one `managed.yml` serves
  both stacks, the swap merges to `main` only once the next tag live will deploy is the
  end-of-Alpha switch's (the T7 row above).

*Recommended: (a) now, then (c).* Under (a), the acceptance is written in this block with its date,
and the same line goes into 0119 §3's item 5 (0119 T3, the owner's decisions).

**The owner's answer, 2026-10-23, 19:05 UTC:** *"T7 no, fix already within the alpha"*. Not (a):
the frozen image is not accepted for the Alpha. Replace it during the Alpha: (b)'s replacement,
later than (b) named it and sooner than (c). Live runs alpha.1 with no testers yet, so its store
can still start empty without losing anything a tester sent.

**Status, 2026-10-24: being built**, on branch
`claude/ownpace-public-readiness-y7orc6-object-store-swap`, not merged. `managed.yml` runs
`chainguard/minio:latest` by its index digest on a new volume, `minio_data_v2`, at `/data`, with
upstream's `mc ready` health check; a one-shot, `minio-init`, from the same pinned image, makes
`packets` with `mc mb --ignore-existing` once the store is healthy, and `trigger-api` waits for it
to exit 0. 0119 §3 item 5 has what each choice was read from. What remains, in order:

1. **E2E (managed) on the branch**, on the OTA stack, after Trigger.dev v4.7.6 (#1689) merges and
   not before 2026-10-25 11:25 UTC, when the pinned build is three days old. **First, `main` with
   #1689 merged into the branch** (a merge, since the branch is never force-pushed), and
   `managed.yml`'s `TRIGGER_IMAGE_TAG` default read as `v4.7.6` on the branch, with
   `apps/worker`'s `@trigger.dev/sdk` at 4.7.6. Without it the branch still pins v4.7.2: the run
   either stops on the bring-up's SDK and image check, or puts v4.7.2 back on a `triggerdb` that
   `main`'s nightly has already migrated to v4.7.6, which Prisma cannot undo. The merge also takes
   #1689's change to 0119, which conflicts with this branch's. It is the first time
   anything pulls or runs the image. Its bring-up recreates `minio` on the new,
   empty volume and runs `minio-init`; the smoke asserts the store from the API container. It
   writes and reads no object: nothing in the smoke offloads a payload or an output, so the run
   proves the store, the bucket and the wiring, not a packet's round trip.
2. **The merge**, before alpha.2's changelog fold (2026-10-25 23:30 UTC) if the run is green;
   otherwise with the first release after the launch.
3. **Live from the tag that carries it** (alpha.2's deploy is planned for 2026-10-28), inside the
   hold, after the Trigger.dev drain that deploy needs anyway, on a store that starts empty.
   `deploy-live.sh` checks Ownpace's own passes only, not Trigger.dev's runs, so before it, from
   live's checkout, read-only: `docker compose -f deploy/compose/managed.yml exec -T trigger-db
   psql -X -At -U trigger -d triggerdb -c "SELECT \"taskIdentifier\", status, count(*) FROM
   \"TaskRun\" WHERE status IN ('DELAYED','PENDING','PENDING_VERSION','WAITING_FOR_DEPLOY',
   'DEQUEUED','EXECUTING','WAITING_TO_RESUME','RETRYING_AFTER_FAILURE','PAUSED') GROUP BY 1, 2"`
   (the non-final statuses of v4.7.6's `TaskRunStatus`). It should print nothing, or only a
   scheduled task's run for the minute it takes to finish; `docs/managed-bring-up.md`, beside
   the MinIO pin, says what to do with anything else.
4. **The old volume removed by the owner**, on the OTA stack once the change is on `main` and a
   nightly on `main` has run green with it (until the merge, `main`'s nightly brings the Bitnami
   image back on the old volume), and on live once the deploy that carries it is green. Read-only
   checks first, from the stack's checkout, as `docs/managed-bring-up.md` says beside the MinIO
   pin: `docker volume inspect` of both volumes, `docker ps -a --filter
   volume=<project>_minio_data` (it must name nothing), and `mc ready` inside the new store; then
   `docker volume rm <project>_minio_data`, which cannot be undone.

**The guard**, `scripts/an-object-store-with-a-maintainer.unit.test.ts`, is built on the branch:
it fails while any service in `managed.yml` runs a `bitnamilegacy/*` image, and checks that
`minio-init` makes `packets` and `trigger-api` waits for it, that the store is
`chainguard/minio:latest` by digest with the digest's date (in the sentence that names it) and
both architectures beside it, on a new volume at `/data`, with the release check off and no port
published. Since the branch's review (2026-10-24) it also checks that `minio-init` carries the
store's pair in its own environment and reads it with `$${…}` inside the container, and that
neither service sets a `network_mode`.

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

*2026-10-21, built (Status, 2026-10-21): wider than written here. The watched set is every
`image:` line of `deploy/compose/{managed,dev,www}.yml`, compared with its registry or named in
`COMPARED_ELSEWHERE` with a reason, not "the images `dependabot.yml` ignores by name": those
ignores applied to a directory Dependabot never read, and are gone. MinIO is named there, with
no upstream to compare with. The scan below is still to build.*

*2026-10-22, the scan half built (Status, 2026-10-22): every image the stacks run, not only "the
four images, and the task base image", Ownpace's own at `:edge` and at the newest release among
them, scanned as linux/arm64. An issue is kept only for an image whose operating system is past
its end of life; its high and critical findings go to code scanning, one category per image, so
an open issue always names something to move. A category outlives its image: one that leaves
the stacks, or is renamed, leaves its configuration to be deleted by hand on the code scanning
tool status page.*

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

*2026-10-05: two tags (Status, 2026-10-05). For this row, "the alpha tag" is `v0.2.0-alpha.2`,
which carries the final texts. `v0.2.0-alpha.1` comes first, to stand live up and rehearse.*

**Also before the first invitation, but carried elsewhere:** the identity provider's release watch
and response window (0135 T7).

**After the first invitation:**

- **T1**, unless it is ready before the tag;
- **T3**, as soon as the tag exists;
- **T4's** unit legs, by the next alpha tag;
- **T6's Guard 2**, the pull-request check that the task bundle loads;
- **T7's** sentence, best given with T0 (given 2026-10-23: replace it within the Alpha);
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
- In-app guides a tester can use: W15, now 0148.

## Open questions

1. **The name (T0).** `v0.2.0-alpha.1` (recommended), `v0.1.0-rc.2`, or another? And is every
   deploy to `ownpace-live` during the alpha a new `alpha.N` tag (recommended, since T5 deploys
   only tags)? *Answered 2026-09-28: `v0.2.0-alpha.1`, and `alpha.N` for each deploy, as
   recommended.* The owner: *"The version name (0146 T0): ok, what do I do?"*, read as accepting
   all of T0's recommendation (Status, 2026-09-28).
2. **Renames (T0).** None before the alpha, and none on a live stack after it (recommended, and what
   ADR-0040 already says)? Or is there a name the owner wants changed while it is still cheap?
   *Answered 2026-09-28, with question 1 and on the same reading of "ok": no rename, and no last
   squash (T0 items 2 and 3).*
3. **The drill from rc.1 (T2).** `release.md` requires it before a tag, and it has never run
   non-vacuously. It needs the reference machine for as long as the drill takes. Run it before the
   alpha tag (recommended), or tag without it and record the skip as a hole, since the alpha is
   managed-only and no tester runs the appliance?
4. **The checklist for `alpha.2` and later.** `release.md`'s full list for every alpha tag, or a
   short one: CI green, both unit upgrade gates executed, and the nightly gate green on the commit
   on the OTA stack? The short list is recommended for the alpha's fixes, and the full list for the
   tag that ends the alpha.
5. **The object store (T7).** (a) accept it for the alpha in writing, then (c) replace it after the
   alpha (recommended); or (b) replace it before `ownpace-live`'s first deploy? *Answered
   2026-10-23: "T7 no, fix already within the alpha": replace it during the Alpha (§3 T7).*
6. **The task deploy's name (T5).** Keep `--external-id <tag>` if the self-hosted server records it,
   or leave the task plane's deployments unnamed and rely on the deploy log?
