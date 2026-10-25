# Workplan 0146 — A release testers can name

> **In one line:** Cutting an alpha release after `v0.1.0-rc.1`: tag, version and changelog checks, the build in problem reports, `ownpace-live` deploying only tags, Trigger.dev tasks on Node 24, ending pre-release squashing, upgrade drills and the frozen MinIO image.

## Status — 2026-10-25 (update this block at the end of every session)

**2026-10-25: T7 merged, and alpha.2 is folded.** Chainguard's MinIO merged as #1692 at 11:38 UTC
(`0029db4a`), after E2E (managed) #281 on its branch was green (11:26 to 11:37 UTC):
`chainguard/minio` at its index digest came up healthy on the new volume `minio_data_v2`,
`minio-init` made `store/packets`, the API reached it on the stack network, and the smoke passed.
The OTA's Bitnami-era `minio_data` stays on disk until the owner removes it, after a green run of
`main` with the change (T27 of the owner's steps holds the read-only checks). Live takes it from
`v0.2.0-alpha.2`, after the task runner's drain, starting empty. The CHANGELOG fold, the last
merge before the two counted nights, carries it.

**2026-10-25, build: T11 (a), Mailpit v1.31.6 → v1.32.0, a draft for alpha.3**, as draft #1699
on branch `claude/ownpace-public-readiness-y7orc6-mailpit-1-32-0`; refs #1671, the pin watch's summary
issue, which lists Mailpit v1.31.6 as behind v1.32.0 (it stays open for Stalwart, T11 (b)). Main is
frozen from the alpha.2 fold to its tag; this merges after the tag, once E2E (managed) has run on it.
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
  week before the run (8); no override input (9); open code-scanning alerts
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
T7, T8, T9, T10 and T11 (its (c) after the Alpha). T7 is one sentence from the owner, and is
best given with T0.

| Task | Status | Notes |
|---|---|---|
| T0 The alpha's version name, and whether any rename comes first | ✅ **Answered 2026-09-28**: *"The version name (0146 T0): ok, what do I do?"*, read as accepting the whole recommendation: `v0.2.0-alpha.1`, then `alpha.2`, `alpha.3` for each deploy; no rename; no last squash. The owner named no item, and has not objected since (Status, 2026-09-28) — *was:* ⏳ **Owner** | §3. **Alpha minimum.** Recommended: `v0.2.0-alpha.1`, then `alpha.2`, `alpha.3` for each deploy; no renames, as ADR-0040 already decided. Two other names each have a trap (§1). |
| T1 A changelog section a reader can use | 📋 **Proposed** (D1, D6) | §3. After the first invitation, unless it is ready before the tag. Grouped by what a tester notices, with the experimental sources marked, and the stale lines corrected. |
| T2 The version bumped, the tag cut, and the build named where it is needed | ✅ Steps 4 to 6's **Release workflow done** in #1682, merged 2026-10-23 (`54e4c3d2`), and proven on `main` the same day by Release runs 1 to 6 (Status, 2026-10-23); `v0.2.0-alpha.2`'s tag 📋 waits for the fold and its two nights. The preflight reads the fold, CI and the scan on C, the nights and both chains' upgrade gates (the managed chain's is T4's, #1681); the tag and the publishing are the workflow's after the owner's approval (Status, 2026-10-23); Step 1 ✅ **done** in #1305, merged 2026-09-28 (`0c1a8d8c`): the root version `0.2.0-alpha.1`, `CHANGELOG.md`'s `[0.2.0-alpha.1] - 2026-09-29` with T2's floor, the issue template's Build example, `release.md`'s count of six, and (reviews, 2026-09-28) `openapi.yaml`'s `info.version` held to the root version by guard block (d) and named in `release.md`, the Build field sending managed and Docker testers to the sidebar and Windows testers to the log line, and the stamp held at the bottom of the sidebar in both editions. Steps 2 and 3 ✅ **done** in #1274, merged 2026-09-28 (`1353f062`): the build line in the problem report, `scripts/release-names-agree.mjs` in the three publishing workflows, and both guards. Steps 4 to 6 📋 the owner's: the drill from rc.1, the commit by the two-green-scheduled-nights rule (0141 T14), and the tag and its push; `v0.2.0-alpha.1` is tagged, 2026-10-06 (on `90a23e9b`), and `v0.2.0-alpha.2` is the version since #1558 (merged 2026-10-11) but not yet tagged (both read from the remote 2026-10-16); 📋 **Decided 2026-10-05**, *"Two tags"*: `v0.2.0-alpha.1` once the pull requests in flight merge, to stand live up and rehearse, then `v0.2.0-alpha.2` with the final texts, its own freeze, two nights and deploy, before the first invitation (Status, 2026-10-05) — *was:* steps 4 to 6 🔨 through the Release workflow on branch `claude/ownpace-public-readiness-y7orc6-release-workflow`, not merged (2026-10-23); step 1 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-a-release-named-v0-2-0-alpha-1`, not merged (2026-09-28); steps 1 and 4 to 6 📋 waiting for T0 (the name) and the owner (2026-09-28); 🔨 steps 2 and 3 built on branch `claude/ownpace-public-readiness-y7orc6-a-release-that-names-itself`, not merged (2026-09-28); 📋 **Proposed** (D1, D5) | §3. **Alpha minimum.** `docs/release.md`'s procedure, a check that the tag, `package.json` and the changelog agree before anything publishes, and a build line in every problem report. |
| T3 Pre-release ends at the alpha tag, and the repository holds to it | 📋 **Proposed** (D3) | §3. After the tag exists. The squash script refuses; no migration a release shipped may change; ADR-0045, the runner's message and the README say so. |
| T4 Upgrades rehearsed from rc.1 and from the alpha tag, on both chains | The managed chain's upgrade proof from the alpha tag ✅ **done** in #1681, merged 2026-10-23 (`b357add8`): `packages/managed/src/migrate-upgrade.unit.test.ts`, from `UPGRADE_FROM_REF` or `v0.2.0-alpha.1`, both chains, with the shared gate's allow-list held to releases before the split (Status, 2026-10-23); the rest 📋 **Proposed** (D3) — *was:* 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-managed-upgrade-test`, not merged (2026-10-23) | §3. The container drill from rc.1 runs in T2. The rest follows the tag: both unit gates start from both tags, the managed chain included, on Postgres as well as PGlite. |
| T5 `ownpace-live` runs only a release tag | (a) ✅ **done** in #1277, merged 2026-09-28 (`2cfe7cd6`), in 0132 T6's `deploy-live.sh`, not yet run on live: the release rule, `/api/version`'s version, one-way or reversible, and the guard's four cases. `--external-id` is deferred (open question 6) — *was:* (a) 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-a-deploy-from-a-named-tag`, not merged (2026-09-28); 📋 **Proposed** (D2, D3, D4) | §3. **Alpha minimum.** 0132 T6's procedure and script, with the tag always a release whose name, version and commit agree. The deploy says before the hold lifts whether it can be undone. |
| T6 The tasks run the Node the images run | ✅ **done** in #1231, merged 2026-09-27: (a), `runtime: 'node-24'` and Guard 1. Guard 2, the bundle-load check, not built (after the first invitation) — *was:* 📋 Proposed | §3. **Alpha minimum:** `runtime: 'node-24'` in `trigger.config.ts` (supported by the pinned CLI, read from its package) and the version guard extended. **After the first invitation:** a pull-request check that the bundle loads. |
| T7 The object store: replace the frozen MinIO, or accept it for the alpha in writing | ✅ **Merged** as #1692 on 2026-10-25 (`0029db4a`), after E2E (managed) #281 was green; *was:* 🔨 being built on branch `claude/ownpace-public-readiness-y7orc6-object-store-swap` (2026-10-24): Chainguard's MinIO by index digest on a new volume, `minio-init` making `packets`, and the guard; **answered 2026-10-23**: *"T7 no, fix already within the alpha"*, so the frozen image is not accepted, and is replaced within the Alpha. Remains: live from the tag that carries it (alpha.2) after the drain, starting empty, and the old volume removed by the owner on each stack (§3) — *was:* ⏳ **Owner** | §3. The owner declined the recommendation to accept it for the alpha and replace it at its end: Chainguard's maintained MinIO build replaces it now, with versitygw still the fallback (0119 §3, item 5, decided 2026-10-23 and built 2026-10-24). |
| T8 A watch on the pinned images Dependabot leaves alone | Watch half ✅ **done** in #1663, merged 2026-10-21 (`087183b7`): every pin Dependabot cannot see, one issue per owner's-call row and one summary issue, and `/deploy/compose` out of `dependabot.yml` (Status, 2026-10-21); scan half ✅ **done** in #1674, merged 2026-10-22 (`51a0d267`): a weekly, report-only Trivy scan of every image the stacks run, with one issue per image past its end of life (Status, 2026-10-22) — *was:* scan half 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-image-scan`, not merged (2026-10-22); watch half 🔨 built on branch `claude/ownpace-public-readiness-y7orc6-pin-watch`, not merged (2026-10-21), scan half 📋 Proposed; 📋 **Proposed** | §3. Widened 2026-10-21: Dependabot read no file in `deploy/compose`, so the watch covers every image line of its `managed.yml`, `dev.yml` and `www.yml` and the busybox and GoAccess copies in its scripts, `packageManager`, the Trivy the scan runs and the TypeScript split as well as Trigger.dev, ClickHouse and the task base image. MinIO has no upstream to compare with and is left to the scan half; since 0146 T7 (on its branch, not merged, 2026-10-24), Chainguard's MinIO `latest` is compared by its index digest, and `bitnamilegacy/minio` leaves the watch's list of images compared elsewhere. |
| T9 The API image runs without the dev tools | 🔨 **Being built** as a draft on branch `claude/ownpace-public-readiness-y7orc6-api-image-prod-deps`, for after the first invitation (2026-10-23) | Status, 2026-10-23 (the scan triage). `apps/api/Dockerfile`'s runtime stage copies the build stage's whole `/app`, where `pnpm install --filter @openmig/api...` installed the devDependencies too, the root's included, and `CMD` (`node apps/api/src/index.ts`) needs none of them. Their Go binaries are 2 critical and 65 high of the image's 3/125 on 2026-10-23: esbuild 0.25.12 (Go 1.23.12; drizzle-kit's and `@esbuild-kit/esm-loader`'s), counted twice, and TypeScript 7's native compiler (Go 1.26.4). The lockfile itself, dev dependencies included, reads 0/0. Done when the runtime image holds production dependencies only, a dependency it still needs and lacks fails at start, which the managed gate's first `curl $API/health` catches, and the image scan finds the Node base's findings alone. |
| T10 The image scan reads the tasks' image as it is built | 📋 **Proposed** (2026-10-23) | Status, 2026-10-23 (the scan triage). `scripts/image-scan.mjs` scans the base image the pinned CLI names (`triggerdotdev/node:24-bookworm` by digest, category `trigger-task-base`, 14/117 on 2026-10-23), not the tasks' image that `deploy-tasks.sh` builds from it. The Trigger.dev v4.7.6 branch upgrades that image's Debian packages at build (`apt-get -y upgrade`), which fixes the 42 Debian findings that have a fix (12 critical, all Perl, fixed in 5.36.0-7+deb12u4, and 30 high). It leaves npm's bundled packages under `/usr/local/lib/node_modules/npm`, since the overlay copies only `/usr/local/bin/node` (tar 7.5.15's CVE-2026-59873, critical, fixed in 7.5.19, and 12 high, 11 of them with a fix), and the 76 Debian findings without a fix, zlib1g's CVE-2023-45853 among them: the built image would still carry 2 critical and 87 high of the 131 (read with Trivy 0.76.0, 2026-10-23). The scan cannot see the upgrade, so the category keeps alerts for 42 findings the built image no longer has. The scan runs on a GitHub-hosted runner, which cannot read the stack's own registry, so the proposal is to build the image in the scan job as the deploy builds it. The old category, if renamed, has its configuration deleted by hand (T8). |
| T11 The patch and minor moves that clear findings | (a) 🔨 **Being built** as draft #1699 on branch `claude/ownpace-public-readiness-y7orc6-mailpit-1-32-0`, for alpha.3 (Status, 2026-10-25); (b) ⏳ **Owner**; (c) 📋 **Proposed**, after the Alpha (2026-10-23) | Status, 2026-10-23 (the scan triage), read with Trivy 0.76.0 on linux/amd64. (a) **Mailpit v1.32.0**: 0/0, where v1.31.6 has CVE-2026-111943 (Go's `crypto/x509`); for alpha.3 (*was:* after the first invitation), by hand in `managed.yml` and in `scripts/a-service-that-phones-home.unit.test.ts`, which pins the reference by tag and digest and records Mailpit's release check as read at v1.31.6, so that fact is read again at v1.32.0 in the same change. Done so on the branch: the release check read again at v1.32.0, unchanged. (b) **Stalwart v0.16.27** (Debian 13.7): 0 critical and 47 high, none with a fix, where v0.16.10 has 3/114. The owner's call: `docs/stalwart-integration-fix.md` pins v0.16.10 and says *"DO NOT change the pinned version"* (AGENTS.md puts its decisions in ADR-0022), and every copy moves together: `setup-stalwart.sh`, the fixture's Dockerfile, the Testcontainers setup, the fix doc and the guards that name it. (c) **ClickHouse 26.3** (26.3.59, Ubuntu 22.04): 0/0, where 26.2.19.43 has CVE-2026-45447 and CVE-2026-84782 in openssl. After the Alpha: the owner accepted 26.2 for it on 2026-10-23 (0119 §3 item 9 on the Trigger.dev v4.7.6 branch), and 26.3 is ahead of the 26.2 Trigger.dev's own compose pins, which the pin watch compares with (T8). It moves in `managed.yml` and in `scripts/a-service-that-phones-home.unit.test.ts` together: the guard pins the reference by tag and digest and records the crash-report default as read at `v26.2.19.43-stable`, as `clickhouse-no-crash-reports.xml`'s comment does, so both are read again at 26.3. |

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
