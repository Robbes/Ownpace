# Workplan 0119 — What runs, what is current, and what moves it

> **In one line:** Audit and upgrade policy for container images, npm packages and GitHub Actions: Dependabot over Dockerfiles and compose files, `trigger-version.sh` for Trigger.dev, owner decisions on Zitadel, Redis, MinIO and pnpm `minimumReleaseAge`, and vitest 5.

## Status — 2026-10-24 (update this block at the end of every session)

**2026-10-24: the object store moves to Chainguard's MinIO, built on a branch, not merged
(0146 T7).** The owner's answer of 2026-10-23, 19:05 UTC, on the recommendation to accept the
frozen image for the Alpha: *"T7 no, fix already within the alpha"*. Branch
`claude/ownpace-public-readiness-y7orc6-object-store-swap` runs `chainguard/minio:latest` by
the index digest it had on 2026-10-22, `d88920d6a50b…` (linux/amd64 and linux/arm64): the
build this plan's Trivy read 0/0 on 2026-10-23, and three days old at 2026-10-25 11:25 UTC,
before the branch's E2E. It is on a new volume, `minio_data_v2`, with `server /data` and upstream's `mc ready` health check, and a
one-shot `minio-init` from the same image that makes `packets` before `trigger-api` starts.
The Bitnami-era `minio_data` is no longer mounted or declared and stays on disk for the owner
to remove. Read for it: the image's config and last layer on both architectures, Chainguard's
locked image config, Trigger.dev v4.7.6's development compose, the fork's release check at
its tag, mc's `ready`, `mb` and update check at its last tag, and compose's `--wait` handling
of a one-shot. Proved here: unit, with the new guard red on `main` (nine problems) and green
on the branch, and two mutations caught (a digest-only pin read as current whatever the
registry says; `minio-init` dropped from the trigger phase); typecheck and lint; and Compose
v5.6.1's `config`, with no daemon, accepts the file and resolves `trigger-api`'s wait on
`minio-init`. Owed: `main` with Trigger.dev v4.7.6 (#1689) merged into the branch, then E2E
(managed) on it, which is the first time anything pulls or runs the image; the merge;
live from the tag that carries it, after the drain, starting empty; then the old volume
removed on each stack (`managed-bring-up.md`, the note on the MinIO pin). §3 item 5 has the
decision and the build. Reviewed the same day: the drain now has a read of Trigger.dev's
unfinished runs, the guard catches three more ways to break `minio` and `minio-init`, and
`stand-up-live.sh` refuses a `MINIO_ROOT_PASSWORD` that `mc` would misread.

**2026-10-23: Trigger.dev v4.7.6, the tasks on the API image's Node, and ClickHouse 26.2
accepted for the Alpha**, on the branch `claude/ownpace-public-readiness-y7orc6-trigger-4-7-6`
(issues #1668 and #1669 are the pin watch's records of the first two). The owner chose both
moves now, in alpha.2, and option (a) for ClickHouse, the plan's recommendation (2026-10-23).
- **v4.7.2 → v4.7.6** with `trigger-version.sh pin v4.7.6` in every place; the lockfile moves
  `@trigger.dev/core` and `@trigger.dev/sdk` only, whose dependency ranges did not change.
  The notes between the tags, read from each release commit's `.server-changes` files and
  the CLI's changelog: the run trace API stops returning internal debug events (v4.7.5); the
  webapp image and the deploy images distrust the roots behind the compromised eMudhra
  intermediates and the Sectigo AAA cross-sign (v4.7.6); a magic link signs in only in the
  browser that asked for it (v4.7.4, on by default), which the runbook already asks for, and
  the link always points at `LOGIN_ORIGIN` (v4.7.4), so the bring-up's phase 6 and the runbook
  now say to ask for it on `TRIGGER_LOGIN_ORIGIN`, not through a tunnel to the http port; a
  revoked personal access token stays revoked (v4.7.4); `POST /api/v1/sessions` needs two
  permissions (v4.7.3; nothing here calls it); `deploy` refuses an `--env` that differs from
  the environment of an environment key in `TRIGGER_ACCESS_TOKEN` (v4.7.5; this stack's is a
  personal token, `deploy-tasks.sh` says so). Twelve Prisma migrations
  (`20260928120000_webhook_shared_endpoints` to `20261020120002_drop_oidc_signing_key_status_live_key`)
  and six ClickHouse ones (049 to 054) ride on it: one way, applied by E2E (managed) on the
  branch. `docs/ending-the-alpha.md` step 3 stays as read at v4.7.2 and now says so: its list
  of the stores the task runner writes was not read again at v4.7.6, so 049 to 054 (webhook
  tables among them) are not checked against it.
- **The telemetry, re-read at v4.7.6** (the webapp's `env.server.ts`, `telemetry.server.ts`,
  `postAuth.server.ts`, `usePostHog.ts` and `docker/scripts/entrypoint.sh`, the supervisor's
  `env.ts`, the CLI's `common.ts`): nothing new is on by default. Cloudflare Turnstile and AWS
  KMS joined the guard's list of keys that switch a third party on.
- **v4.7.7 exists** (2026-10-22) and is a security release: deploy images on Node 24.22.1, and
  the supervisor distrusting the same roots. Not taken: it passes the three-day floor only at
  2026-10-25 08:45 UTC. Its task half is what the overlay below gives; the supervisor makes no
  TLS connection on these stacks (the webapp, the socket proxy and the registry are plain HTTP
  on the compose network or loopback). #1668 will name v4.7.7 at the next weekly watch; take
  it after the launch, by the same route.
- **The tasks' Node.** Every CLI from 4.7.2 to 4.7.6 builds the task image on
  `triggerdotdev/node:24-bookworm@sha256:d2d0c018…`, Node 24.18.0 on a Debian snapshot of
  2026-07-13. `apps/worker/trigger.config.ts` now adds one layer for every target but
  `trigger dev`: Node copied from the image `apps/api/Dockerfile` builds FROM (24.22.1 by
  digest), and the base image's packages upgraded. Dependabot moves that line, and the tasks
  move with it at their next deploy. The upgrade is cached by the CLI's persistent `trigger`
  builder, so the packages are refreshed when the Node image moves (the COPY above it breaks
  the cache), not at every deploy; that first deploy after a move is the slow one, with apt in
  the first and build stages (`managed-bring-up.md`, *Re-deploy the tasks*). The Dockerfile
  is read in `onBuildStart`, where a throw stops the deploy (one in `onBuildComplete` is only
  logged). The guard holds the layer to the FROM line and the pin watch's `TASK_OVERLAY` to
  the config's text, which closes #1669.
- **The tasks' trust store moves too.** CLI 4.7.6 builds every task image with
  `NODE_OPTIONS=--use-openssl-ca` and `SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE` on Debian's store,
  after `update-ca-certificates` distrusts emSign G3, C1 and C3 and `Comodo_AAA_Services_root`
  (`distrustCompromisedRoots` in its `buildImage.js`, not there at 4.7.2). The tasks then verify
  a provider's TLS against Debian's `ca-certificates`, which the overlay's upgrade keeps
  current, instead of the list built into Node. Sectigo chains should still validate through
  USERTrust; a TLS verification error to a provider in the branch E2E's smoke points here.
- **ClickHouse**: item 9 of §3, with the exposure and the revisit triggers.
- **The lockfile and the three-day floor.** pnpm dates the two 4.7.6 packages 2026-10-20 at
  18:30 UTC, so every frozen install refuses this branch's lockfile until 2026-10-23 at about
  18:31 UTC, and accepts it after with nothing changed. No exclude entry was added.
- Proved here: the unit guards that read these files, red first, four mutations of the
  overlay caught. Owed before merge: checklist T15 on the OTA stack (hold, nothing
  `EXECUTING`, `trigger-version.sh backup before-v4.7.6`, `TRIGGER_IMAGE_TAG=v4.7.6` in its
  `.env`), then E2E (managed) on the branch, whose task deploy should log the `COPY --from`
  line and whose smoke runs should end `COMPLETED_SUCCESSFULLY` (a TLS verification error to a
  provider there is the trust store above), merged within the hour. Live
  takes it from the alpha.2 tag, after `TRIGGER_IMAGE_TAG=v4.7.6` in its `.env`;
  `deploy-live.sh` takes the task runner's dump into the copy by itself.

**2026-10-23: the object store re-read for 0146 T7, docs only.** Read for it: Trigger.dev
v4.7.6 at its tag (`166db1ca`), the webapp's object-store client, its packet, session and
run-retrieve routes, the SDK's packet offload and `runs.retrieve`, and both of upstream's
compose files; Docker Hub's API for every candidate's tags; each candidate's source at its
newest tag (MinIO's last release and its README history, the Chainguard fork of MinIO, Wolfi's
package of it and Chainguard's locked image config, versitygw, Garage, SeaweedFS, RustFS); five
Trivy 0.76.0 scans on linux/arm64; and what in `scripts/`, `deploy/compose` and the docs pins
MinIO today. One fact changed since 2026-09-06: Docker Hub no longer serves `minio/minio` and
`minio/mc` (Trigger.dev's CI moved off them on 2026-09-12). Two were missed on 2026-09-06.
MinIO's README has said *"Maintenance Mode"* since 2025-12-03 and *"THIS REPOSITORY IS NO
LONGER MAINTAINED"* since 2026-02-12. And Chainguard's maintained MinIO has been free on Docker
Hub as `chainguard/minio` since 2025-10-24, with fork releases since 2026-03-04; Trivy scans it
clean, and it carries `mc` and bash, so `rotate-db-passwords.sh`'s checks run in it
unchanged. §3 item 5 has the read and a recommendation. The question stays the owner's (T3, 0146 T7). Nothing in
`managed.yml`, the scripts or the guards changed.

**2026-10-22: the floating tags' pull request opened as a draft**, #1678 (head `b900ccf3`, with
`main` merged in): postgres, redis, caddy, nextcloud and nginx by exact tag and digest. Its
entry stays on its branch until it merges. No E2E on the branch before 2026-10-25 18:00 UTC,
when the three same-tag rebuilds of 2026-10-22 it pins are three days old. Nextcloud's data
never goes back a version, so either the floating tags `main`'s nightly uses are first pointed
at the pinned digests, or the branch E2E runs only when it is ready to merge and it merges
before the next nightly. The plan is to merge it after the Alpha launch and before PostgreSQL
18.7 (2026-11-12).

**2026-10-22, recorded: the four pins and Redis merged** as #1657 on 2026-10-22 (`cead33f6`):
the 2026-10-21 entry on PgBouncer, Mailpit, Gatus, the registry and Redis, below. E2E (managed)
#273 ran on its head `a7180578` before the merge, green. `main`'s first scheduled nightly with
them is 2026-10-23's.

**2026-10-22, recorded: the entry below merged** as #1658 on 2026-10-22 (`5abadbe4`). What it
owed before merge ran on its head `8ae7c733`, all green: the three images built on the pull
request, E2E (managed) #272, E2E (self-hosted) #289 and the Windows payload workflow #16
(win-x64). §2.1's *Moves by* cells for the `deploy/compose` images, and its dated note on why
Dependabot never moved them, came with #1663, merged 2026-10-21 (`087183b7`; 0146 T8).

**2026-10-21: Node 24.22.1 in the three images and the Windows payload, which now follows the
self-host image; pnpm 11.28.6.** v24.22.1 is the October security release, HIGH for 24.x (DNS,
TLS hostname checks and the Brotli decoder among its fixes; OpenSSL 3.5.9). Dependabot would
have moved the images on 2026-10-26 and never the payload: `package-appliance.mjs` pinned
node.exe to v24.19.0 in a constant nothing moved, while the images went to 24.22.0, and the
v0.2.0-alpha.1 zip ships it. The packager now reads the exact `x.y.z` from
`apps/selfhost/Dockerfile`'s `FROM` line and refuses a line without one, so each image bump
moves the zip too. The digest is the tag's second push (amd64 and arm64); its first was an
index listing no image at all, which no build can pull; a third that evening only added
ppc64le around the same two images, a digest-only move Dependabot will offer. pnpm 11.22.0 →
11.28.6, `latest-11` and six days old — the three-day rule is kept by hand here, since
corepack and `pnpm/action-setup` fetch pnpm itself past it — with the lockfile
byte-identical; pnpm 11 is supported until 2027-04-30 (pnpm's `SECURITY.md`). Proved here:
unit, with the two new cases red first and three mutations caught; a `--with-node win-x64`
staging whose node.exe hashes to the published `d702daa8…` and reports 24.22.1. Owed before
merge: the images built on the PR, E2E (self-hosted) and E2E (managed) on the branch, and the
Windows payload workflow (win-x64) on the branch, the first run of the 24.22.1 download
outside this machine.

**2026-10-21: four pins moved by hand, and Redis off Alpine 3.21.** PgBouncer v1.26.1-p0
closes three holes this stack's `pgbouncer.ini` leaves open in v1.25.2, each to a client
that has not logged in: 1.26.0's CVE-2026-19888 (a SCRAM message without a nonce crashes
the pooler; `auth_type = scram-sha-256`) and CVE-2026-6668 (a hang; `max_packet_size` left
at its default), and 1.26.1's CVE-2026-107349 (a spin that stops the pooler;
`ignore_startup_parameters` set without `options`). The fourth, CVE-2026-107350 (whoever
knows the password of the user in `auth_file` logs in as any other SCRAM user), needs a
database PgBouncer does not know, which the `*` line in `[databases]` should leave none
of; it is closed anyway. Not 1.26.0, whose default tracking of `search_path` overrode that
same line for the startup packet until 1.26.1 restored 1.25's behaviour. The image tag has
no git tag upstream and is pushed by hand, so `managed.yml` keeps the index digest read today.
Mailpit v1.31.6 by digest, Gatus v5.37.0 and the registry 3.1.2 go with it, each re-read
where a fact is pinned on its version: Mailpit's release check, Gatus's alert rules and
User-Agent, the registry's trace exporter. Redis stays on 7.4 (§3 item 3) and moves to
`7.4-bookworm`, because the 7.4 Alpine images sit on Alpine 3.21, out of security support
on 2026-11-01. Dependabot moved none of the four; the "Moves by" column below is corrected
separately.
Proved here: the unit guards that read these lines. The gate is E2E (managed) on the branch
before merge (its run is recorded with the round), which recreates pgbouncer, trigger-redis,
the registry, the status page and mailpit on the OTA stack; live takes them at its next
deploy, inside the hold.

**2026-09-09, evening: Redis decided — stay on 7.4 — and the Trigger.dev pin applied.**
Item 3 closed with a revisit trigger rather than a shrug: `redis:7-alpine` is already
7.4.11, it is what upstream's own compose tests against, and RSALv2 permits this use since
Redis here is Trigger.dev's internal queue and not a service offered to anyone. Item 1 was
applied on the reference machine in the owner's window — drain (0 `EXECUTING`), verified
backup, `--from trigger`, task redeploy — and verified by the run counters: successes
advancing one per minute-tick while `COMPLETED_WITH_ERRORS` and `SYSTEM_FAILURE` stayed
frozen. Assembling those commands found a related defect, fixed in #893: the "four places"
that must agree were six, and the root `package.json` plus `packages/scheduler` had been
left on 4.5.12 while the images moved to v4.5.16. Only the object store (item 5) is still
the owner's.

**2026-09-09, later: the gate is on at three days, and the list is half its old size.** The
owner took item 8 the same day it was raised: `minimumReleaseAge: 4320`. Three facts decided
the number, all measured rather than read: the unit is **minutes** (a bare `3` would be three
minutes); at resolution the gate prefers an older version *silently*; and pnpm verifies the
**whole lockfile** on every install including `--frozen-lockfile`, exiting 1 — so the floor
reaches all twelve CI installs and the three Dockerfiles, and a value set too high turns
everything red at once. Against the real lockfile, 3 days flags nothing, 7 flags ten, 14 flags
forty-nine. No new cadence is needed: the check only ever gets easier with time, so a red pull
request goes green on its own. Seven of the fourteen exclude entries were fossils naming
superseded versions and were removed with the switch-on; a guard now refuses the list without
the setting, a value under a day, a bare package name, and an entry the lockfile does not
carry.

**2026-09-09: a control that was never switched on, found while closing something else.**
`minimumReleaseAgeExclude` in `pnpm-workspace.yaml` has been maintained entry by entry
since 2026-08-18 and every entry on it is inert: `minimumReleaseAge` is not set here or
anywhere, and never has been in the whole history of this repository. Measured, not
recalled — the three commands are in §3 item 8, together with the two ways to close it and
a recommendation. It is on this board rather than fixed in passing because switching a
supply-chain gate on is a policy with no recorded owner intent behind it; the file itself
now says the list does nothing, so nobody maintains it in the belief that it does. It
matters more this week than last: the advisory gate blocks a merge at high since #890, so
fix versions will be taken the day they publish — the one moment a release-age gate stands
in the way, and exactly what the exclude list is for.

**2026-09-06, afternoon: four go-aheads, one lamp, and two facts corrected.** The owner
said go on Trigger.dev v4.5.16, Zitadel v4.17.3, registry 3 and `nodemailer` 10, each its
own PR: `nodemailer` 10 (#823, on its bundled types; the one breaking change is Node 20),
registry 3.1.1 (#825 — the "configuration rewrite" the audit recorded does not reach a
service that mounts no config file: the two image defaults differ in the file's path and
in a cache that was never redis), Zitadel v4.17.3 (#826: three security fixes, no schema
migration, the three pinned facts re-read against the tag), and Trigger.dev v4.5.16 pinned
in all four places (#827), with the gate run in the owner's window as the step that
applies it — three Prisma migrations and one ClickHouse migration ride on it, so drain and
backup first, as the bring-up says; neither self-hosted gate runs on a pull request, so a
merge applies nothing until the nightly does. Two corrections to §3: Redis's licence
changed at 7.4, not 8.0, and `redis:7-alpine` already resolves to 7.4.11, so the stack has
been on RSALv2/SSPLv1 since that tag moved past 7.2; and the object store has a candidate,
named in item 5. One thing that was not lifecycle at all: the status page showed the
identity provider red for an hour while people signed in, because the page's probe and the
API had been sharing one route through the provider's network alias (#824).

**2026-09-06, morning: the owner took three of the decisions, and Dependabot's first run
showed its hand.** Merged: the safe moves (#808), the Monday group re-cut by Dependabot
against the new main (#818), `@azure/msal-node` 6 (#819) with the O365 gate dispatched on
main behind it and still queued for the self-hosted runner, and nginx 1.31 in the web image
(#813), which settles the nginx line as mainline: Dependabot cannot say "the stable line"
and offers the odd minor every time it appears, so the pin follows it and `www.yml` follows
the web image in this slice. Declined: Node 26 in the images, three PRs in one morning for
the Current line; Dependabot is told (#820) and the major moves by hand with `engines` and
CI. One lesson for the record: a comment posted through the assistant's tooling cannot
address Dependabot, its mentions are defanged, so a stale group PR is recreated by
Dependabot on its own clock or by hand, never by a rebase request from here.

**2026-09-06, night: the audit, and the two holes it found.** The owner asked for the
lifecycle of every component to be checked and for upgrades "in a safe manner". Detection
already ran (`security-scan.yml`: Trivy and `pnpm audit`, weekly) and Dependabot already
moved the npm packages and the GitHub Actions, weekly and grouped. What nobody watched was
the **container images**: eighteen image references across three Dockerfiles and four
compose files, none under Dependabot, three of them pinned by digest alone so that no tool
could even say which version they were. Measured on the night of 2026-09-06, against the
registries themselves (§2): four images current, seven behind by a patch or a minor, one
behind by a major, one behind by four patch releases that are one-way, and one whose
upstream has stopped publishing altogether.

Two holes, both closed in T1: Dependabot learns the Dockerfiles and the compose files, and
`@trigger.dev/*` leaves the weekly npm group, because the SDK may only move with the image
(the drift that broke the managed gate on 2026-08-24 was Dependabot moving the SDK alone).
The safe moves are T2, one PR, proven by the image build and both E2E gates. The rest is
a decision each, §3, for the owner.

| Task | Status | Notes |
|---|---|---|
| T0 The audit | ✅ Done 2026-09-06 | §2. Registries queried directly (Docker Hub v2 API, GHCR token + paginated tag list, `git ls-remote` for the actions); `pnpm outdated -r` for npm. |
| T1 Dependabot learns the images | ✅ Done 2026-09-06 | `docker` over the three Dockerfiles, `docker-compose` over `deploy/compose` and `deploy/selfhost`, weekly, minor+patch grouped, majors one PR each. The one-way images and the deliberate pins are ignored by name (§2.1). `@trigger.dev/*` ignored in npm: it moves through `trigger-version.sh` or not at all. The three digest-only pins (`node@sha256:…` ×3, `postgres@sha256:…`) carry their tag now — same digests, no version moved — because Dependabot compares tags, and a bare digest has nothing to compare. |
| T2 The safe moves | ✅ Done 2026-09-06 | node 24.20.0-slim (three Dockerfiles), postgres 18.6-alpine (self-host), pgbouncer v1.25.2-p0, mailpit v1.31.1, busybox 1.38 (compose, three scripts, one test, the bring-up doc), nginx 1.30-alpine (web image and www; both on 1.31 since the morning, see the status block); three action version comments set to the tag their SHA is. Stateless, or a fixture, or a patch of a store that upgrades in place. Proved on the branch before merge: **E2E (self-hosted) #189 green** (the postgres and node moves, restart-resume included) and **E2E (managed) #161 green** (pgbouncer in front of the API, mailpit, busybox, nginx behind www), both dispatched at 01:57 UTC; `images.yml` built the three images from the moved FROM lines; the `unit` scripts guards 92 files, 1 567 tests. |
| T3 The owner's decisions | 🔨 In progress | Taken 2026-09-06: `@azure/msal-node` 6 (#819; the O365 gate on main is the proof, queued for the self-hosted runner), Node 26 declined (#820), `nodemailer` 10 (#823), registry 3.1.1 (#825), Zitadel v4.17.3 (#826, applied by the gate run in the owner's window), Trigger.dev v4.5.16 pinned (#827, applied the same way after the drain and the backup). Taken 2026-09-09: Redis (item 3 — **stay on 7.4**, with a revisit trigger) and the release-age gate (item 8 — `minimumReleaseAge: 4320`, three days; seven fossil exclude entries removed; guard added). Taken 2026-10-23: ClickHouse 26.2 for the Alpha (item 9). The object store (item 5): taken 2026-10-23, *"T7 no, fix already within the alpha"* (0146 T7), and 🔨 being built on branch `claude/ownpace-public-readiness-y7orc6-object-store-swap`, not merged (2026-10-24) — *was:* still the owner's, with a candidate named. |
| T4 vitest 5 | ✅ Done 2026-09-06 | `vitest` and `@vitest/coverage-v8` 4.1.11 → 5.0.0, every declaring package together. Green on Node 22 (508 files, 6 326 tests) and on Node 24 as CI runs it (509 files, 6 411 tests); the v8 provider loads and reports. Two things the major needed first, found by trying it and landed as their own PR (#810) because they are right under vitest 4 too: the alias map's missing subpath pins — `@openmig/core/archive-reader` and thirteen more, plus a guard — and the exclude patterns in their documented form, since vitest 5 follows pnpm's workspace symlinks when it crawls and a bare `node_modules` matched only the top level. The bump is its own PR, stacked on #810. |

## 1. Why this exists

A component that nobody is responsible for moving does not stay where it is; it falls
behind, silently, until a CVE or a removed tag forces the move on the worst day. This
repository had the detection half (the weekly scan) and, for npm and the actions, the
moving half (Dependabot). For the images it had neither, and the pins were written in
three different shapes: a bare digest (`node@sha256:…`), a tag with a digest
(`axllent/mailpit:v1.31.0@sha256:…`), and a floating tag (`postgres:18-alpine`). Only the
middle shape says what it is *and* what it was when it was pinned.

The rule this workplan settles is short: **everything moves by a tool on a schedule,
except what a person must decide, and those are named.** A patch or a minor of a stateless
image, a fixture, or a store that upgrades in place moves in the weekly group. A major, a
one-way schema migration on the persistent stack, a licence change, or an upstream that has
stopped publishing is a decision, listed in §3 with its reason, and the tool is told to
leave it alone so the decision is not made by a green tick at 06:00 on a Monday.

## 2. The inventory (measured 2026-09-06, 01:45 UTC)

### 2.1 Images

Distance is from the pinned version to the newest published in the same line; *moves by*
is who moves it after T1.

| Image | Where | Pinned | Newest | Distance | Moves by | Decision |
|---|---|---|---|---|---|---|
| `node` (24-slim) | `apps/api`, `apps/web`, `apps/selfhost` Dockerfiles; the Windows payload's node.exe follows `apps/selfhost` | 24.22.1-slim by digest (2026-10-21, the October security release; digest `6f7b03f7…` with no tag at the audit, 24.20.0-slim from T2) | 24.22.1-slim (Node released 2026-10-20); the tag's digest moves as more architectures land (ppc64le at 17:39 UTC on 2026-10-21) and Dependabot offers each move | current: the pin's amd64 and arm64 images are the tag's | Dependabot `docker`, which moves the payload with it since 2026-10-21 | **T2** — and T1 gives it its tag |
| `nginx` | `apps/web/Dockerfile` runtime, `deploy/compose/www.yml` | 1.27-alpine | 1.30.4-alpine stable, 1.31.5 mainline (2026-09-03) | 1.27 is a 2024 mainline, past its end | Dependabot `docker` for the Dockerfile; `www.yml` by hand after it, and the pin watch (0146 T8) says when the two differ | **T2** took 1.30-alpine, the stable line; #813 moved the web image to 1.31 the same morning and the line is mainline since, because Dependabot cannot express "stable" (the odd minor is always the higher version); `www.yml` follows |
| `postgres` (self-host) | `deploy/selfhost/compose.yml` | digest `9a8afca5…` = 18.4-alpine, no tag | 18.6-alpine (2026-08-15), digest `d3e1620b…` | two patch releases | Dependabot `docker-compose` | **T2** — a patch upgrades in place; `e2e.yml`'s restart-resume proves it |
| `postgres` (managed ×2, dev) | `managed.yml`, `dev.yml` | 18-alpine, floating | 18.6 | none, it floats within 18 | `docker compose pull` | stays floating; a major (`pg_upgrade`) is ignored in Dependabot and is the owner's |
| `edoburu/pgbouncer` | `managed.yml` | v1.26.1-p0 (2026-10-21, for the three CVEs this stack's `pgbouncer.ini` is open to from v1.25.2, and a fourth it probably is not; v1.24.1-p1 at the audit, v1.25.2-p0 from T2) | v1.26.1-p0 (2026-10-19), index `488422e3…`, no git tag upstream | current | by hand, in its own PR, when the pin watch's summary issue says it is behind (0146 T8; Dependabot reads no file in `deploy/compose`) | **T2** — stateless; the managed gate proves it |
| `redis` | `managed.yml` | 7.4-bookworm, floating (7.4.11 on Debian 12; 7-alpine, on Alpine 3.21, until 2026-10-21) | 8.8.2-alpine | one major | owner | **§3** — the licence changed at 7.4, which is the line this floats on; 8 *adds* AGPLv3; Valkey is the BSD drop-in. The facts and a recommendation in item 3 |
| `ghcr.io/triggerdotdev/trigger.dev` + `supervisor` | `managed.yml` ×2, `managed.env.example`, `apps/worker/package.json` | v4.7.6 (2026-10-23; v4.7.2 before it, v4.5.12 at the audit) | v4.7.7 (2026-10-22), past the three-day floor on 2026-10-25 | one patch release | `trigger-version.sh` only; the pin watch keeps an issue open while a newer tag is in both images (0146 T8) | **§3, pinned** — one way (at v4.7.6: twelve Prisma migrations and ClickHouse 049 to 054; the status block); the gate run in the owner's window applies it, not the merge. Dependabot told to leave all four places alone |
| `clickhouse/clickhouse-server` | `managed.yml` | 26.2.19.43 by digest | — | — | by hand, with Trigger.dev; the pin watch keeps an issue open while it differs from what Trigger.dev's own compose pins (0146 T8) | stays: pinned to what Trigger.dev's own compose pins, on purpose (`managed-bring-up.md`); 26.2 is out of ClickHouse's support, **accepted for the Alpha** (§3 item 9) |
| `registry` | `managed.yml` | 3.1.2 (2026-10-21; 3.1.1 from #825) | 3.1.2 (2026-09-29) | current | by hand for patches and minors, when the pin watch's summary issue says (0146 T8); a major stays the owner's | **§3, taken** — the "configuration rewrite" did not reach a service that mounts no config file |
| `tecnativa/docker-socket-proxy` | `managed.yml` | v0.5.0 | v0.5.0 | current | by hand, when the pin watch's summary issue says (0146 T8) | — |
| `bitnamilegacy/minio`; `chainguard/minio` on branch `claude/ownpace-public-readiness-y7orc6-object-store-swap` (0146 T7) | `managed.yml` (`minio`, and on the branch `minio-init`) | 2025.5.24-debian-12-r5 by digest; on the branch `latest` by index digest `d88920d6…` (built 2026-10-22, read 2026-10-24) | none for Bitnami's: `bitnamilegacy` stopped at 2025.7.23 (pushed 2025-08-19); `minio/minio` stopped at RELEASE.2025-09-07. Chainguard's `latest` is rebuilt about daily | no upstream for Bitnami's | owner; on the branch, by hand when the pin watch says `latest` was rebuilt (0146 T8) | **§3, taken 2026-10-23** — replace it within the Alpha with Chainguard's maintained build (item 5) |
| `caddy` | `managed.yml` | 2-alpine, floating (2.11.4) | 2.11.4 | current | `docker compose pull` | stays floating; a major is ignored and is the owner's |
| `ghcr.io/zitadel/zitadel` | `managed.yml` | v4.19.2 (2026-09-28, the patch after v4.19.1, whose three security fixes are in nothing this stack switches on; v4.19.1 before, #1285, for GHSA-4hgj-wm6c-q7p2) | v4.19.2 | current | owner; releases and advisories watched, and the pin watch keeps its issue (#1643) open while the pin is behind the newest release (0135 T7, 0146 T8) | **§3, taken** — migrates its schema on boot on the persistent stack, so the gate run in the owner's window applies it |
| `busybox` | `managed.yml`; `smoke-managed.sh`, `bootstrap-managed.sh`, `setup-zitadel.sh`; one test pins the printed command | 1.37 | 1.38 | one minor | by hand, the compose line and the scripts together; the pin watch says when either is behind (0146 T8) | **T2** |
| `ghcr.io/twin/gatus` | `managed.yml` | v5.37.0 (2026-10-21) | v5.37.0 (2026-09-24) | current | by hand, when the pin watch's summary issue says (0146 T8) | — |
| `axllent/mailpit` | `managed.yml` | v1.31.6 by digest (2026-10-21; v1.31.1 from T2) | v1.31.6 (2026-10-15), digest `23fe39e8…` | current | by hand, when the pin watch's summary issue says (0146 T8) | **T2** — a mail catcher for the gate |
| `nextcloud` | `managed.yml`, `dev.yml` | 34-apache, floating (34.0.3) | 34.0.3 (2026-09-02) | current | `docker compose pull` | stays floating; a fixture and a demo target; a major is ignored |
| `ghcr.io/robbes/ownpace-selfhost` | `deploy/selfhost/compose.yml` | `edge` | ours | — | `images.yml` | — |

Ignored by name in the new Dependabot entries, so that a green tick cannot make these
decisions: the two Trigger.dev images and Zitadel (one way), ClickHouse and the object
store (deliberate pins), and the majors of `postgres`, `redis`, `registry`, `nextcloud`
and `caddy`.

*2026-10-21 (workplan 0146 T8): the `docker-compose` entry for `deploy/compose` never read a
file. Dependabot's compose fetcher reads only names like `compose.yml`, and `managed.yml`,
`www.yml` and `dev.yml` all miss, so no image there was ever moved by it and the ignores above
for those images ignored nothing. The entry and those ignores are gone; the self-host compose
keeps its `postgres` major ignore. `scripts/idp-pin-watch.mjs` compares the `deploy/compose`
images with their registries every Monday instead and keeps an issue open while one is behind,
which is what the "Moves by" cells above now say.*

### 2.2 npm (`pnpm outdated -r`, 23 packages)

| Distance | Packages | Moves by |
|---|---|---|
| patch (12) | `@testing-library/user-event`, `@types/node`, `@types/react-dom`, `autoprefixer`, `imapflow`, `jmap-jam`, `jose`, `postcss`, `react-router`, `tsx`; **not** `@trigger.dev/core` and `@trigger.dev/sdk` 4.5.12 → 4.5.16 | Dependabot's Monday group, except the SDK (T1: it moves with the image, §3) |
| minor (7) | `@typescript-eslint/*` and `typescript-eslint` 8.68 → 8.69, `eslint` 10.9 → 10.10, `lucide-react` 1.34 → 1.41, `morgan` 1.11 → 1.12, `zod` 4.4 → 4.5 | Dependabot's Monday group |
| major (4) | `vitest` and `@vitest/coverage-v8` 4.1 → 5.0 (dev); `@azure/msal-node` 5.6 → 6.0 and `nodemailer` 9.0 → 10.0 (production code in `packages/connectors`) | T4 for the dev pair; §3 for the two in production code — `@azure/msal-node` 6 taken 2026-09-06 (#819), `nodemailer` 10 taken the same day (#823) |

TypeScript 7 stays ignored by configuration (workplan 0026 row 22: `typescript-eslint`
refuses to load under it; revisit when 7.1 ships).

### 2.3 GitHub Actions (`git ls-remote`, every pinned SHA resolved to its tag)

Nine of twelve actions are pinned at their newest tag. Behind: `pnpm/action-setup`
v6.0.10 → v6.1.0, `softprops/action-gh-release` v3.0.2 → v3.0.3,
`docker/setup-qemu-action` v4.2.0 → v4.3.0 — Dependabot's Monday group, nothing to do.

What the audit did find is that **three comments lie**. The SHA beside `actions/checkout`
is v7.0.1 and its sixteen comments say `v4.5.0`; `actions/setup-node`'s SHA is v7.0.0 and
two of its nine comments say `v6.0.0`; `actions/upload-artifact`'s SHA is v7.0.1 and its
comments say `v4.6.0` seven times and `v5.0.0` once. The code that runs is current; the
label a reviewer reads is not, and Dependabot only rewrites a comment when it moves the SHA,
which for a current SHA is never. T2 sets the three labels to the truth.

### 2.4 Runtimes

Node 24 everywhere it matters: `engines` says `>=24`, CI installs `24`, the images run
24.22.1 (24.20.0 at the audit), and the Windows payload ships the self-host image's version.
pnpm 11.28.6 (11.22.0 at the audit), moved by hand: Dependabot never touches `packageManager`,
so a bump is `latest-11` once it is three days old, then `pnpm install` to show the lockfile
unchanged. PostgreSQL 18 on both stacks; PGlite (npm) current. Prisma current.

## 3. The owner's decisions

Each of these is an upgrade the audit found and deliberately did **not** make. The reason
is beside each; none is urgent tonight.

1. **Trigger.dev v4.5.12 → v4.5.16.** Four patch releases, but a Trigger.dev upgrade is a
   schema migration on the persistent stack and is one way (`managed-bring-up.md`,
   *Upgrading Trigger.dev*). The path exists and is scripted: `trigger-version.sh backup`,
   drain, `pin v4.5.16`, `pnpm install`, bring up. It needs a person at the keyboard for the
   drain. Until it is taken, Dependabot no longer offers the SDK half on its own (T1).
   **Pinned 2026-09-06** (#827): all four places moved with the tool and the lockfile
   followed. Between the tags: three Prisma migrations and one ClickHouse migration, and
   upstream's compose still pins the ClickHouse line this stack runs. The merge applies
   nothing; the gate run in the owner's window does — drain `EXECUTING`,
   `trigger-version.sh backup before-v4.5.16`, dispatch the gate on the branch, merge at
   once so no v4.5.12 run follows it on the migrated database.
2. **Zitadel v4.17.1 → v4.17.3.** Two patch releases; Zitadel migrates its own schema at
   boot, on the same persistent stack. Three guards mention v4.17.1 by name — the SMTP-test
   endpoint that answers 501, the defaults file, the image-matches-postgres floor — and
   should be re-read against the release notes before the tag moves. Its own PR, gated by
   `e2e-managed.yml`, when the owner says so. **Taken 2026-09-06** (#826): v4.17.2 and
   v4.17.3, three security fixes (TOTP reuse, IDP intent tokens under authenticated
   encryption, the auth-method permission on the user's own organisation), no schema
   migration; `cmd/defaults.yaml`'s LoginV2 lines and the admin SMTP handler are unchanged
   between the tags, so the three guards hold. Applied by the gate run in the owner's window.
3. **Redis 7 → 8 — the facts, corrected 2026-09-06.** The licence changed at **7.4**
   (RSALv2 / SSPLv1, March 2024), not at 8.0; 8.0 (May 2025) *added* AGPLv3 as a third
   option. `redis:7-alpine` resolves to 7.4.11, so this stack has run source-available
   Redis since that tag moved past 7.2. For this use — Trigger.dev's own queue, not Redis
   offered to anyone as a service — RSALv2 permits it, so there is nothing to fix. The
   choices: stay on 7.4, which is what Trigger.dev's own compose tests against and which
   still receives patches (recommended); Redis 8 under AGPLv3 when upstream's compose
   moves; or Valkey 8.1 (BSD-3, Linux Foundation, `valkey/valkey:8.1.10-alpine`,
   protocol-compatible with the 7.2 line) if OSI-only components are the rule. Nothing in
   the stack asks for an 8-only feature. **TAKEN 2026-09-09: stay on 7.4.** The owner's
   word: *"2: stay"*. Nothing moves, and that is the point — `redis:7-alpine` already
   resolves to 7.4.11, it is the line Trigger.dev's own compose tests against, it still
   receives patches, and RSALv2 permits this use because Redis here is Trigger.dev's
   internal queue rather than a service offered to anyone. **The revisit trigger, so this
   is not a decision that quietly expires:** upstream's compose moving to Redis 8, or the
   7.4 line going out of patch support. Valkey stays the answer if OSI-only components
   ever become the rule; that would be a new decision, not this one.
   **2026-10-21: the base moved, not the line.** `redis:7-alpine` is built on Alpine 3.21,
   whose security support ends on 2026-11-01; only the Redis 8 images moved to a newer
   Alpine. The stack now runs `redis:7.4-bookworm`, still 7.4.11 and still this decision,
   on Debian 12, whose LTS runs to 2028-06-30. The revisit trigger did not fire: the Redis
   line is supported, and only the OS under it would not be from 2026-11-01. Both images
   run Redis as uid 999, so the append-only file in `redis_data` carries over, and back
   again if it has to.
4. **registry 2 → 3.** The 2 line has had no release since 2.8.3; 3.0 rewrote the
   configuration file. The registry only serves Trigger.dev's deploy images inside the
   stack; moving it is a config rewrite plus a bring-up, not a patch. **Taken
   2026-09-06** (#825), and the rewrite turned out not to reach this service: checked
   against the image's own default config at v2.8.3 and v3.1.1, the file's path moved to
   `/etc/distribution/config.yml`, the blob-descriptor cache defaults to memory instead of
   a redis that was never there, unused mail hooks and notification endpoints went, and
   the storage layout under `/var/lib/registry` is the same — and this service mounts no
   config file at all. Pinned 3.1.1 (3.1.2 since 2026-10-21); Dependabot moves patches and minors from here, and
   the major ignore now guards against 4. The managed gate is the proof (the CLI pushes
   through it, the smoke runs a task pulled from it).
5. **The object store.** `bitnamilegacy/minio` was pinned by digest after `latest` stopped
   moving (`managed-bring-up.md`); tonight's check shows the other free image,
   `minio/minio`, stopped too, at RELEASE.2025-09-07 (and since 2026-09-12 Docker Hub no
   longer serves it). That check, and the candidate below, found no maintained free MinIO
   image to move to. Both missed one: Chainguard's, free on Docker Hub since 2025-10-24 (the
   re-read below). The pin is safe as long as it is honest about what it is: frozen software
   with no fixes coming. The decision is whether Trigger.dev's object
   store should be something else (an S3-compatible store that is still published), and
   that is a design choice with a migration behind it, not a version bump. **A candidate,
   2026-09-06.** Upstream's own compose floats on the same frozen bitnamilegacy image.
   Suggested: **versitygw** (Apache-2.0, `versity/versitygw:v1.8.0`, v1.10.0 by 2026-10-23,
   released monthly, a single binary whose bucket is a directory of files on the volume,
   keys from the environment like MinIO's, arm64 published) as the drop-in; **Garage**
   (AGPLv3, `dxflrs/garage:v2.3.0`, v2.4.1 by 2026-10-23) if a store with its own integrity
   model is wanted, at the price of a layout and key ceremony at bring-up; SeaweedFS is
   heavier than this needs; RustFS was still a release candidate (1.0.0 came on
   2026-09-16). The swap belongs in the same drain window as the Trigger.dev upgrade: the
   bucket holds large run payloads, so copy it over or start empty. The owner's call.

   **Re-read 2026-10-23, for 0146 T7. Docs only: nothing in `managed.yml` moved.**

   *What runs.* `bitnamilegacy/minio:2025.5.24-debian-12-r5` by digest `451fe685…`, built
   2025-06-06 and pushed 2025-07-03. Docker Hub labels the repository *"Legacy Bitnami images
   (no longer updated)"*. Its last push was 2025-08-19, and its newest tag,
   `2025.7.23-debian-12-r5`, is just as frozen. Security Scan #4726 (its *Image scan report*
   job, linux/arm64) counts 26 critical and 259 high findings, 206 of them fixed in a newer
   package. The split by what carries them comes from a local Trivy 0.76.0 read of the same
   digest, whose totals match CI's:
   - Debian 12.11: 17 critical and 140 high, 84 of them fixable, OpenSSL and Perl most of all;
   - the `mc` client: 2 critical and 50 high, built with Go 1.23.10;
   - the `minio` server: 7 critical and 69 high, built with Go 1.24.2.

   Seven of the server's findings are MinIO's own, and only CVE-2025-62506 has a fixed version.
   The two criticals with no fix are CVE-2026-33322, *"JWT Algorithm Confusion in OIDC
   Authentication"*, and CVE-2026-33419, *"LDAP login brute-force via user enumeration and
   missing rate limit"*. This service sets neither OIDC nor LDAP: its environment holds the root
   pair, the bucket and the two phone-home switches. By their titles, two highs need nothing
   this stack lacks: CVE-2026-40344 and CVE-2026-41145, an *"Unauthenticated Object Write"* in
   unsigned-trailer uploads. They are open to anything that reaches `minio:9000`. The service
   publishes no port, and it sits on the compose network with the API and the tasks.

   *What Trigger.dev v4.7.6 asks of it.* Read at the tag:
   `apps/webapp/app/v3/objectStoreClient.server.ts`, `objectStore.server.ts`, the packet routes
   and `packages/core/src/v3/utils/ioSerialization.ts`. `managed.yml` sets an access key and a
   secret, so the webapp signs with `aws4fetch` 1.0.18 and not the AWS SDK. That means:
   - **Path-style addressing** on `OBJECT_STORE_BASE_URL`. The bucket is the key's first
     segment: `packets/<project ref>/<environment>/<file>`. `OBJECT_STORE_BUCKET` is unset, and
     only IAM mode reads it.
   - **SigV4 in a header**, with `X-Amz-Content-Sha256: UNSIGNED-PAYLOAD` and the service `s3`.
     The region is `us-east-1`, `aws4fetch`'s default, since `OBJECT_STORE_REGION` is unset. A
     store that checks the region must expect that one.
   - **Presigned URLs** for `PUT` and `GET`, valid for five minutes, with SigV4 in the query,
     only `host` signed and the payload unsigned. The task processes use them directly: they
     upload a payload or output of 128 KB or more (`OFFLOAD_IO_PACKET_LENGTH_LIMIT`) and fetch
     stored ones. So the task containers must reach the store at the same `minio:9000`.
   - **One `PUT` per object**, with a string body and a `Content-Type` that `GET` gives back.
     For chat sessions' transcripts, and only for them, `GET` takes `Range` (a span or a
     suffix) and `If-Match` (a mismatch must answer 412) and returns `Content-Range` and
     `ETag` (`services/realtime/transcriptPage.server.ts`), and the dashboard's transcript
     download asks `HEAD`, which answers 404 for a missing key. No task here is a chat agent
     (nothing in `apps/` or `packages/` imports `@trigger.dev/sdk/ai`), so a run's packets need
     a plain `PUT` and `GET`.
   - **Nothing else:** no multipart upload, no `x-amz-checksum-*` header, no `DeleteObject`, no
     listing and no bucket call. So `packets` must exist before the first write.

   Deployment artifacts would use a store of their own (`ARTIFACTS_OBJECT_STORE_*`), and
   `managed.yml` sets none. Upstream's two compose files at v4.7.6 run different images:
   - its self-hosting compose (`hosting/docker/webapp/docker-compose.yml`) still runs
     `bitnamilegacy/minio:${MINIO_IMAGE_TAG:-latest}`, with `MINIO_DEFAULT_BUCKETS: packets`,
     its two ports published on loopback, and a `curl` health check;
   - its development compose (`docker/docker-compose.yml`) runs `chainguard/minio:latest` by
     digest with `command: server /data --console-address ":9001"`, health-checks it with
     `mc ready local` inside that container, and makes `packets` with a
     `chainguard/minio-client` service that runs `mc mb --ignore-existing local/packets`. It
     moved there on 2026-09-28 (Trigger.dev #4985), from Quay's MinIO images, which it had
     taken on 2026-09-12 because Docker Hub no longer served `minio/minio`.

   *The candidates*, read on 2026-10-23. Tags come from Docker Hub's API, and sources were read
   at the tag named. The scans are Trivy 0.76.0, linux/arm64, high and critical only, run
   between 10:13 and 10:15 UTC. They cover Docker Hub images only, and there are five of them
   because of the registry's pull limit.

   | Store | Maintained | Newest (date) | arm64 image | Licence | Fits the list above | Weight | Trivy: critical / high / fixable |
   |---|---|---|---|---|---|---|---|
   | `bitnamilegacy/minio` | no: *"no longer updated"* | `2025.7.23-debian-12-r5` (2025-08-19) | yes | AGPLv3 server | yes: it is today's | today's | not scanned; ours, 2025.5.24: 26 / 259 / 206 |
   | MinIO's own, `minio/minio` | no: its README has opened *"Maintenance Mode"* since 2025-12-03 and *"THIS REPOSITORY IS NO LONGER MAINTAINED"* since its last commit, on 2026-02-12, and it has been source only since its last release | `RELEASE.2025-10-15T17-29-55Z` (2025-10-15) | none: `minio/minio` and `minio/mc` are gone from Docker Hub, and the `minio` organisation lists neither | AGPLv3 | yes | — | nothing to scan |
   | MinIO built here from a tag | as maintained as the tag it builds: upstream's last tag fixes only CVE-2025-62506 of the seven; the fork's tag (next row) fixes more | — | ours to build | AGPLv3 | yes | an image this repository builds, scans and moves itself, for both architectures | not built |
   | Chainguard's MinIO, `chainguard/minio` | yes. Its source, `chainguard-forks/minio`, calls itself *"a supported replacement of the original minio repository"* and promises best-effort CVE fixes. It has been free on Docker Hub since 2025-10-24, and the fork has eleven release tags in 2026, the first on 2026-03-04. Its fixes include CVE-2026-33322, -34204, -40344, -41145 and -42600, plus an LDAP rate limit and an S3 Select CSV bound that match the titles of CVE-2026-33419 and -39414 (not checked against those advisories) | fork tag `RELEASE.2026-09-22T19-25-18Z`; image `latest` built 2026-10-22 (Wolfi's `minio` package `0.20260922.192518`, epoch 4, Go 1.27) | yes | AGPLv3 server. The free tags are `latest` and `latest-dev`, and older tags need a subscription. Whether an old digest stays pullable was not checked | yes: the same server | today's server, with `mc` and bash (as `/bin/sh`) inside, but no `MINIO_DEFAULT_BUCKETS`. Its entrypoint is `/usr/bin/minio`, so it needs `command: server /data`, with the data at `/data`, and it runs as uid 65532 (bitnami's is 1001). Chainguard's locked image config (`chainguard-images/images`, `images/minio/locked_config.json`) lists `bash`, `bash-binsh`, `coreutils`, `mc` and `minio` with their libraries | 0 / 0 / 0. Trivy reads the server as Wolfi's `minio` package, against Wolfi's advisories, not as a Go binary |
   | versitygw, `versity/versitygw` | yes, about monthly: v1.8.0 (2026-09-04), v1.9.0 (2026-10-13), v1.10.0 | v1.10.0 (2026-10-22) | yes | Apache-2.0 | yes, read in source: path style, SigV4 in a header and in the query, the unsigned payload, `Range` and `If-Match`. It checks the region against `VGW_REGION`, whose default is `us-east-1` | one Go binary on Alpine 3.24, run as root unless told otherwise. Keys come from `ROOT_ACCESS_KEY` and `ROOT_SECRET_KEY`, and it listens on port 7070 by default. A bucket is a directory, with metadata in extended attributes or a sidecar directory | 0 / 0 / 0, its Go binary read too |
   | Garage, `dxflrs/garage` | yes: v2.4.0 (2026-09-06), v2.4.1 (2026-09-08); v1.3.1 for the 1.x line | v2.4.1 (2026-09-08) | yes | AGPLv3 | yes, read in source. The region must match `s3_region`, so set it to `us-east-1` | a `FROM scratch` image with one binary and no shell, and a `garage.toml` with an RPC secret. At first start: a layout assign and apply, then `key import`, `bucket create` and `bucket allow`, each through `docker compose exec`. `key import` needs an id of 8 characters or more, so `admin` is refused | 0 / 0 / 0, but Trivy found nothing it could read: no OS, and no package list in the Rust binary. So it says nothing |
   | SeaweedFS, `chrislusf/seaweedfs` | yes, about weekly: 4.44 (2026-08-22) to 4.48 (2026-09-28). Git tag 4.49 is from 2026-10-23, with no standard or arm64 4.49 image yet (only an amd64 `4.49_large_disk_foundationdb`, pushed at 07:31 UTC) | 4.48 image (2026-09-28) | yes | Apache-2.0 | yes, read in source: conditional reads, presigned SigV4, keys from `AWS_ACCESS_KEY_ID` | master, volume, filer and S3 gateway in one `weed server -s3`; 502 MB unpacked on arm64 | 0 / 5 / 5: Go 1.26.8's standard library and `x/net` |
   | RustFS, `rustfs/rustfs` | yes, but young: 1.0.0 on 2026-09-16, then 1.0.1, 1.0.2 and 1.0.3 by 2026-10-17. Its security policy supports the latest release only | 1.0.3 (2026-10-17) | yes | Apache-2.0 | MinIO-like by design. Not read here beyond its keys (`RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`) and its `/data` | one binary on Alpine 3.24 | 0 / 0 / 0 for Alpine only. The Rust binary is not read |

   *What moving costs.*
   - **What `packets` holds, and for how long.** It holds four kinds of run packet:
     - a payload of 512 KB or more when a run is triggered (`TASK_PAYLOAD_OFFLOAD_THRESHOLD` is
       unset here, so its default holds);
     - a batch item's payload;
     - a waitpoint's completion;
     - what a task process offloads itself: a payload or output of 128 KB or more.

     Chat sessions' snapshots and transcripts go there too
     (`api.v1.sessions.$sessionId.snapshot-url.ts` and `transcript.ts`), and no task here
     writes them.

     Nothing in Trigger.dev v4.7.6 deletes a packet. Its client has no delete call, and no
     lifecycle rule is set, so the bucket only grows. A packet is needed while something can
     still read it: its run starting, a retry, or a parent waiting on it. When a
     `triggerAndWait` resumes, the parent reads the output: `run-cutover.ts` reads the final
     sync's output that way. After that, the packet is history. It is read by the dashboard, a
     replay, and `runs.retrieve`. For a stored payload or output, the server only presigns a
     `GET` and never checks that the object is there (`ApiRetrieveRunPresenter.server.ts`).
     The SDK then fetches it, and when the fetch fails it gives `payload` or `output` as
     undefined and does not throw (`resolvePresignedPacketUrl` in `ioSerialization.ts`, called
     from `retrieveRun` in `packages/trigger-sdk/src/v3/runs.ts`). Ours calls `runs.retrieve`
     in `managed-purge-closed.ts`, only for runs the ledger still counts as live, and reads
     only the run's status flags (`isExecuting`, `isQueued`, `isWaiting`, `isCompleted`,
     `isFailed`, `isCancelled`), so an emptied bucket changes nothing there. So after a drain
     the bucket can be thrown away, and what is lost is old runs'
     large payloads and outputs, as `managed-bring-up.md` already says. How much it holds on
     either stack was not measured. This prints its size and object count, and no secret:
     `docker compose -f deploy/compose/managed.yml exec -T minio sh -c 'MC_HOST_l="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:9000" mc --config-dir /tmp/mc du l/packets'`.
   - **The drain.** The hold waits for the passes in flight to finish, which is what the
     bring-up's upgrade order asks: nothing `EXECUTING`. A run that is queued, delayed or
     waiting can also own a stored payload. So a swap that starts empty also waits until
     `TaskRun` has none of those, or it copies the bucket. The hold and `deploy-live.sh` count
     Ownpace's passes only; Trigger.dev's runs that have not finished are read with
     `docker compose -f deploy/compose/managed.yml exec -T trigger-db psql -X -At -U trigger -d triggerdb -c "SELECT \"taskIdentifier\", status, count(*) FROM \"TaskRun\" WHERE status IN ('DELAYED','PENDING','PENDING_VERSION','WAITING_FOR_DEPLOY','DEQUEUED','EXECUTING','WAITING_TO_RESUME','RETRYING_AFTER_FAILURE','PAUSED') GROUP BY 1, 2"`,
     the non-final statuses of v4.7.6's `TaskRunStatus` (added 2026-10-24, in review of the
     branch below; `managed-bring-up.md`, beside the MinIO pin, says what output is accepted).
   - **The copy**, when one is wanted. Use `mc mirror` (from `chainguard/minio-client` on the
     compose network) or `rclone sync` between two S3 remotes, from `minio:9000` to the new
     service, with `trigger-api` and the tasks stopped. Chainguard's MinIO has a shorter road:
     it is the same server and should read its own on-disk format. Copy the volume, as
     ClickHouse moved to `clickhouse_data_v2`, mount the copy at `/data`, and run the server as
     bitnami's uid 1001. It should come up with `packets` and its objects in place. That was not
     tried here, and it is the first thing the pull request that builds it proves on the OTA
     stack.
   - **The restore plan.** The old `minio_data` volume stays untouched beside the new one, and
     rolling back means the old image line on it again. What the new store took in meanwhile is
     lost on the way back, and that is again only large payloads and outputs.
   - **Live needs no copy at the end of the Alpha.** `ending-the-alpha.md` step 3 removes
     `ownpace-live_minio_data` anyway, with `triggerdb`, so no run refers to an old packet. A
     replacement that live first runs in that window starts empty by design.
   - **What pins MinIO today.** The pull request that builds the swap reads each of these
     again. `grep -ril minio scripts deploy/compose docs/ending-the-alpha.md docs/managed-bring-up.md`
     finds 28 files: the ones below, and others that name MinIO only in a comment or a test
     fixture (`reset-trigger.sh`, `clickhouse-disable-system-logs.xml`,
     `bootstrap-managed.unit.test.ts`, `an-image-nobody-scanned.unit.test.ts`,
     `every-service-somebody-starts.unit.test.ts` and two release fixtures). Chainguard's MinIO
     keeps the service name, the `MINIO_ROOT_*` keys, `sh` and `mc`, so with it most of these
     stay as they are; another store changes all of them.
     - `managed.yml` itself: the image line, `MINIO_DEFAULT_BUCKETS` and the volume's mount
       path change. The service name `minio`, in `OBJECT_STORE_BASE_URL` and in
       `bootstrap-managed.sh`'s `up_wait` lines, stays if the replacement keeps it.
     - `a-service-that-phones-home.unit.test.ts`, which pins the bitnami reference as the place
       where `MINIO_UPDATE` and `MINIO_CALLHOME_ENABLE` were read. Chainguard's fork still runs
       the release check at start, gated the same way.
     - `rotate-db-passwords.sh` and its test. They check MinIO's pair with `sh -c` and `mc`
       inside the container. Chainguard's image has both, so those checks run unchanged in it.
     - `shipped-passwords.sh`, `ensure-env-secrets.sh`, `stand-up-live.sh`,
       `managed.env.example` (`MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`),
       `a-password-the-repository-knows.unit.test.ts` and
       `a-first-bring-up-of-live.unit.test.ts`, which pair `MINIO_ROOT_PASSWORD` with the
       volume `minio_data`.
     - `a-demo-on-a-real-address.unit.test.ts` and `a-retention-the-bring-up-states.unit.test.ts`,
       which list `MINIO_ROOT_PASSWORD` among the stack's passwords, and
       `a-disk-that-says-it-is-filling.unit.test.ts`, with a MinIO volume in its fixture.
     - `ending-the-alpha.md` and `the-end-of-the-alpha-empties-the-task-history.unit.test.ts`,
       which name the store and its volume.
     - `smoke-managed.sh` and `smoke-managed-verdict.unit.test.ts`, which want any HTTP answer
       on `minio:9000` from the API container.
     - `two-stacks-on-one-box.unit.test.ts`, for the container name `trigger-minio`.
     - `idp-pin-watch.mjs`, which skips `bitnamilegacy/minio` as having no upstream. An image
       with only a `latest` tag needs its digest watched instead.
     - `managed-bring-up.md`'s notes on the MinIO pin and its row in the phone-home table.

     0146 T7's guard, `an-object-store-with-a-maintainer.unit.test.ts`, comes with that build.

   *Recommendation, 2026-10-23.*
   - **Accept the frozen image for the alpha, in writing**, as before. It publishes no port.
     The two criticals with no fix sit in OIDC and LDAP, which it does not use. The
     unsigned-trailer writes need a foothold on the compose network.
   - **Replace it at the end of the alpha with Chainguard's MinIO build.** Pin it by digest,
     with the fork's release in the comment, and make the bucket with a `chainguard/minio-client`
     service. It is the same server, with `sh` and `mc` inside, so nothing in the list above is
     new to it. It is what Trigger.dev's own development compose runs, and it may keep today's
     data. It goes to the OTA stack first, proven by the managed gate, and to live in the
     end-of-Alpha switch, which empties the store anyway. One `managed.yml` serves both stacks:
     the OTA stack's nightly gate deploys `main`, and live deploys release tags. So the swap
     merges to `main` only once the next tag live will deploy is the one the end-of-Alpha
     switch deploys. Merged sooner, it would reach live at its next alpha tag, onto a store
     that is not empty. If the owner wants it on live before then, live takes it at its first
     tag that carries it, under the hold, after the drain above, and starting empty; what is
     lost is old runs' large payloads and outputs.
   - **The fallback is versitygw.** It is also the better choice if the store should not depend
     on one vendor's free tier. It has the cleanest scan that reads the binary, it is
     Apache-2.0, and it is released monthly. The price: nobody has run Trigger.dev against it,
     and the swap needs a copy or an empty start.
   - **If Chainguard's free image goes away**, build the fork's tag here.
   - **Not the others.** Garage asks the most ceremony. SeaweedFS is heavier than one bucket
     needs. RustFS's 1.0 line is five weeks old.

   Still the owner's call.

   **Decided 2026-10-23, 19:05 UTC (0146 T7): replace it within the Alpha.** The owner, on
   the recommendation above: *"T7 no, fix already within the alpha"*. So the frozen image is
   not accepted for the Alpha, and the swap does not wait for the end-of-Alpha switch. The
   timing above changes with it. The plan: E2E (managed) on the branch on the OTA stack this
   weekend, once Trigger.dev v4.7.6 (#1689) has merged and the pinned build is three days old
   (2026-10-25 11:25 UTC), with `main` carrying #1689 merged into the branch before the run, so
   that it runs v4.7.6 like `main`'s nightly and not v4.7.2 on a `triggerdb` already migrated
   past it (0146 §3 T7, step 1), and the merge before alpha.2's
   changelog fold (2026-10-25 23:30 UTC) if it is green; otherwise it rides the first release
   after the launch. Live takes it from the tag that carries it (alpha.2's deploy is planned
   for 2026-10-28), after the drain that deploy needs anyway, on a store that starts empty.
   Live has had no testers on alpha.1, so what it loses is nothing a tester sent.

   **Built 2026-10-24, on branch `claude/ownpace-public-readiness-y7orc6-object-store-swap`, not
   merged.** What it does, each point read off the image or upstream rather than assumed:
   - `chainguard/minio:latest` by an index digest read from Docker Hub's API and its registry
     on 2026-10-24: `d88920d6a50b…`, built 2026-10-22 09:59 UTC and pushed as `latest` at
     11:25 UTC that day (its attestation's push time; the tag moved on at 2026-10-23 18:05
     UTC), linux/amd64 and linux/arm64. So it is the build the scans above read on 2026-10-23
     between 10:13 and 10:15 UTC, 0 critical and 0 high, and it is three days old at
     2026-10-25 11:25 UTC, before the branch's E2E. Not the newest `latest`, `c47b1779bfd1…`
     (built 2026-10-23 17:13 UTC, pushed 2026-10-24 02:01 UTC), which nothing here scanned
     and which is three days old only on 2026-10-27. The two apk databases differ in brotli's
     three libraries alone, 1.2.1-r0 against -r1; both name Wolfi's `minio`
     0.20260922.192518-r5 (the fork's `RELEASE.2026-09-22T19-25-18Z`) and `mc`
     0.20250813.083541-r27. (The candidates table says epoch 4; this image's apk database
     says r5.) Trigger.dev's own digest from its move of 2026-09-28 still resolved on Docker
     Hub on 2026-10-24, so an old digest stays pullable for weeks at least.
   - The image's config and last layer, both architectures: entrypoint `/usr/bin/minio` with
     no arguments, user `65532`, `/data` root-owned with mode 0777 and `/data/.minio.sys`
     owned by 65532 (Chainguard's `locked_config.json` lists the same paths), `/tmp` 1777,
     `/home/nonroot` 65532's. Docker gives a new named volume the image directory's
     ownership and mode at its first mount, so `minio_data_v2` mounted at `/data` is
     writable by 65532 with no chown step. `command: ["server", "/data"]`.
   - `minio_data` is no longer mounted or declared, and stays on disk. The store starts
     empty on both stacks; what that loses is old runs' large payloads and outputs (*What
     moving costs*, above).
   - `minio-init`, a one-shot from the same pinned image, runs
     `mc --config-dir /tmp/mc mb --ignore-existing store/packets` with the root pair taken
     from its own environment inside the container, once `minio` is healthy. `trigger-api`
     depends on it with `service_completed_successfully`, which is also what makes
     `up -d --wait` take its exit 0 as done (compose's `getDependencyCondition`, the same
     from v2.20.0 to v5.6.1). The bring-up names it beside `minio` so a failure prints its
     log, and on success prints its last line, mc's, which names the bucket.
   - A health check, upstream's `mc ready local` with `--config-dir /tmp/mc`, and
     `MC_HOST_local: http://127.0.0.1:9000`: `mc ready` uses an anonymous client
     (`cmd/ready-main.go`, `cmd/client-admin.go` at mc's `RELEASE.2025-08-13T08-35-41Z`), so
     no password goes into it.
   - The release check stays off, read again at the fork's tag: `cmd/server-main.go`,
     `cmd/common-main.go` and `cmd/update.go` still ask `dl.min.io` with the same User-Agent
     unless `MINIO_UPDATE` is `off`, and call-home ships off. mc asks `dl.min.io` only when it
     is run with no command (`cmd/main.go`), which neither the probe nor the one-shot does.
   - The guard `an-object-store-with-a-maintainer` (0146 T7) fails on `main`'s `managed.yml`
     with nine problems and passes on the branch. The pin watch compares a pin with no number,
     held by its digest, with the digest its registry names for the tag today, read with a
     HEAD; since Chainguard rebuilds `latest` about daily, the summary issue will list it most
     weeks, and from its first run, since the pin is not the newest `latest` on purpose. `MINIO_ROOT_PASSWORD` pairs with `minio_data_v2` in `shipped-passwords.sh` and
     `stand-up-live.sh`; both stacks' `.env` already hold a generated value, so neither
     changes.
   - What it does not prove: no Docker daemon was available, so nothing here pulled or ran
     the image. The branch's E2E (managed) on the Spark is the first run.
6. **`@azure/msal-node` 5 → 6** — taken 2026-09-06 (#819). Its one breaking change removes
   the interactive loopback flow, which the connectors never call: they use the
   client-credential, refresh-token and username-password paths only. The O365 gate
   (`e2e-o365.yml`) on main is the proof, queued for the self-hosted runner.
   **`nodemailer` 9 → 10** — taken 2026-09-06 (#823). Read first: one breaking change,
   Node 20 or newer, against an `engines` of 24; the rest of the major is the move to
   TypeScript with ESM and CommonJS builds, and the package ships its own types now, so
   `@types/nodemailer` went with it. Two call sites, both read. CI's integration lane runs
   the SMTP transport against Stalwart; the E2E gates follow when the runner is back.
7. **Node 26 in the images** — declined 2026-09-06. It is the Current line, not LTS until
   October; CI installs 24 and `engines` says `>=24`. The runtime's major moves by hand
   with both, when the next LTS line is current, and Dependabot is told (#820).
8. **The release-age gate that was never switched on — TAKEN 2026-09-09: three days.**
   `pnpm-workspace.yaml` carried a `minimumReleaseAgeExclude` list of fourteen entries,
   maintained entry by entry since 2026-08-18 (#443), one annotated *"Dependabot-pinned major
   bump, newer than the release-age gate; reviewed via its PR."* It read exactly like the
   escape hatch of a live control. **`minimumReleaseAge` was not set** — measured three ways
   rather than recalled: `pnpm config get minimumReleaseAge` answered `undefined`, there was
   no `.npmrc`, and `git log -S'minimumReleaseAge:'` over this file and `package.json`
   returned nothing in the whole history. Every entry was inert.

   **What it does, measured from pnpm 11.22.0's own resolver and by experiment, because two
   of the three facts are counter-intuitive.**

   - **The unit is minutes.** pnpm computes the cutoff as
     `Date.now() - minimumReleaseAge * 60 * 1000`. Set to `5256000` (ten years), `pnpm add
     lodash` installed **4.15.0**, from August 2016. So `3` would mean three minutes: the
     value is `4320`.
   - **At resolution it prefers an older version SILENTLY.** It filters the registry metadata
     to versions past the floor, remaps `latest` onto the newest of them, and picks that —
     printing only a mild `(4.18.1 is available)`. It errors
     (`ERR_PNPM_NO_MATURE_MATCHING_VERSION`) only when nothing in the requested range
     qualifies.
   - **It verifies the WHOLE LOCKFILE on every install, `--frozen-lockfile` included, and
     exits 1** (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`). This is the one that decides the
     value: it reaches all twelve `pnpm install --frozen-lockfile` steps in CI and the three
     Dockerfiles, so a floor set too high turns every build and every image red at once.

   **Why three days and not seven.** Measured against the real lockfile on 2026-09-09, one
   floor at a time:

   | floor | lockfile entries that would fail |
   |---|---|
   | 2 days | 0 |
   | **3 days** | **0** |
   | 5 days | 0 |
   | 7 days | 10 |
   | 14 days | 49 |
   | 30 days | 80 |

   Three days costs nothing today and still covers the threat this exists for — a compromised
   publish is installed and yanked within hours to a day or two. Seven would have flagged ten
   packages on day one (this week's `vitest` 5, `nodemailer` 10, `@trigger.dev/*` 4.5.16,
   `lucide-react`, `postcss`, `@types/react-dom`) and would put a speed bump on nearly every
   Dependabot pull request — which is how a control decays into a box people tick.

   **It needs no new cadence.** The gate is a floor on age at install time, not a schedule:
   nothing expires, nothing needs checking every three days, and **the check only ever gets
   easier with time** — a pull request red on it goes green on its own, so a commit that was
   green can never turn red on this later. What changes is one narrow event: a Dependabot bump
   published within three days of its CI run arrives red, naming the package and its publish
   date. The rule, written where the reader lands (the `pnpm-workspace.yaml` comment):
   **wait and re-run** unless it is a security fix the advisory gate is blocking a merge on,
   in which case add `name@version` to the exclude list in that same pull request with a
   one-line reason.

   **Seven of the fourteen entries were fossils** and went with the switch-on: they named
   versions the tree had moved past (`fast-uri@3.1.6` against an installed 3.1.7,
   `body-parser@1.20.6` against 2.3.0, `recharts@3.10.0` against 3.10.1, `engine.io@6.6.7`
   against nothing at all). Versioned entries are meant to expire that way;
   `scripts/a-gate-that-was-never-switched-on.unit.test.ts` now fails when one does not, and
   also when the list exists without the setting, when the value is under a day, and when an
   entry is a bare package name — which pnpm treats as "exempt this package for ever".
9. **ClickHouse 26.2, out of support since 2026-05-21 — ACCEPTED FOR THE ALPHA, 2026-10-23.**
   ClickHouse's `SECURITY.md` (read 2026-10-23) supports 26.9, 26.8, 26.7 and 26.3, and not
   26.2; 26.2.19.43 (2026-05-21) is that line's last patch. Trigger.dev pins exactly that, by
   the same digest, in `docker/docker-compose.yml` at v4.7.2, v4.7.6 and v4.7.7 (`26.2` in
   `hosting/docker/webapp/docker-compose.yml`; its Helm values state a floor, "requires
   ClickHouse >= 25.8", and its test containers run 26.2.19.43). This stack follows that pin
   because the one ClickHouse it ran that upstream had not tested crash-looped the v4.5.12
   upgrade (`managed-bring-up.md`, *Upgrading Trigger.dev*). The choices were (a) keep 26.2
   for the Alpha, recommended, and (b) 26.8.32.14 LTS now, one way. **The owner took (a).**

   **Exposure.** Reachable on the compose network only: no published port, one client
   (`trigger-api`), a password `ensure-env-secrets.sh` mints and `shipped-passwords.sh`
   refuses at its shipped value. What it holds, as read at v4.7.2, is the task processes'
   metrics (`trigger_dev.metrics_v1`, kept 60 days); the run events are in `triggerdb`, since
   `EVENT_REPOSITORY_DEFAULT_STORE` is not set (`docs/ending-the-alpha.md`, step 3). The
   fallback for a broken store is a new, empty volume (`managed.yml`'s comment on
   `clickhouse_data_v2`).

   **What is not known.** CVE-2026-51992 (published 2026-07-29: SQL injection through the
   source parameters of `CREATE DICTIONARY`, rated critical by third-party trackers, which list
   ClickHouse "up to 26.3.9.8"). ClickHouse's own advisory was not found, so whether
   26.2.19.43 carries the fix is not established. Its changelog does backport one fix for SQL
   injection through dictionary sources (string keys of PostgreSQL, Cassandra and XDBC
   sources, ClickHouse#104009), which may or may not be this CVE. Either way it needs a SQL
   session allowed to create a dictionary, which here means the password above. Also not in
   26.2: 26.3.10's lower limits on HTTP headers before authentication.

   **Revisit**, whichever comes first: Trigger.dev's `docker/docker-compose.yml` moves off 26.2
   (the pin watch's ClickHouse row says so every Monday, 0146 T8, and *Upgrading Trigger.dev*
   compares the line at every move); a ClickHouse advisory dated after 2026-05-21 that affects
   authenticated SQL or the HTTP interface, CVE-2026-51992 included once its fixed versions are
   known; and 2027-03 at the latest. Moving is then (b) or whatever upstream pins, one way, and
   it also moves `scripts/a-service-that-phones-home.unit.test.ts`'s ClickHouse row and the
   reading behind `clickhouse-no-crash-reports.xml`.

## 4. Not done, honestly

- **The floating tags stay floating.** `postgres:18-alpine`, `redis:7.4-bookworm` (`redis:7-alpine`
  until 2026-10-21, §3 item 3), `caddy:2-alpine`,
  `nextcloud:34-apache` move on every `docker compose pull`, within their major (redis within
  7.4), with no PR.
  That is the intended behaviour for a fixture and for stores that upgrade in place, and the
  majors are what the owner decides — so Dependabot is told to ignore their majors rather
  than pin them. A reader who wants reproducibility on the managed stack should know that
  the bring-up records what it pulled; that is where the exact version lives.
- **ClickHouse** is not checked against anything but Trigger.dev's own compose, and that
  is by design; the version that rejected a migration is the reason it is pinned at all. That
  pin, 26.2, has been out of ClickHouse's support since 2026-05-21: accepted for the Alpha, with
  its revisit triggers (§3 item 9).
- **Whether Dependabot reads `${TRIGGER_IMAGE_TAG:-v4.5.12}`** correctly is not tested here;
  those two lines are ignored by name, so the answer does not matter for them.
- **The three actions behind by a patch or a minor** are left to Monday's group rather than
  moved tonight: the group's PR exists precisely so that they arrive together, once.
