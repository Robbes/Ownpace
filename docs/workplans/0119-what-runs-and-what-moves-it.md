# Workplan 0119 — What runs, what is current, and what moves it

## Status — 2026-09-09 (update this block at the end of every session)

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
| T3 The owner's decisions | 🔨 In progress | Taken 2026-09-06: `@azure/msal-node` 6 (#819; the O365 gate on main is the proof, queued for the self-hosted runner), Node 26 declined (#820), `nodemailer` 10 (#823), registry 3.1.1 (#825), Zitadel v4.17.3 (#826, applied by the gate run in the owner's window), Trigger.dev v4.5.16 pinned (#827, applied the same way after the drain and the backup). Still the owner's, §3: Redis (item 3, with the facts corrected), the object store (item 5, with a candidate named) and the release-age gate — item 8, raised and **taken** on 2026-09-09 (`minimumReleaseAge: 4320`, three days; seven fossil exclude entries removed; guard added). |
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
| `node` (24-slim) | `apps/api`, `apps/web`, `apps/selfhost` Dockerfiles | digest `6f7b03f7…`, no tag | 24.20.0-slim (2026-08-27), digest `ba849c60…` | patches within 24 | Dependabot `docker` | **T2** — and T1 gives it its tag |
| `nginx` | `apps/web/Dockerfile` runtime, `deploy/compose/www.yml` | 1.27-alpine | 1.30.4-alpine stable, 1.31.5 mainline (2026-09-03) | 1.27 is a 2024 mainline, past its end | Dependabot `docker` + `docker-compose` | **T2** took 1.30-alpine, the stable line; #813 moved the web image to 1.31 the same morning and the line is mainline since, because Dependabot cannot express "stable" (the odd minor is always the higher version); `www.yml` follows |
| `postgres` (self-host) | `deploy/selfhost/compose.yml` | digest `9a8afca5…` = 18.4-alpine, no tag | 18.6-alpine (2026-08-15), digest `d3e1620b…` | two patch releases | Dependabot `docker-compose` | **T2** — a patch upgrades in place; `e2e.yml`'s restart-resume proves it |
| `postgres` (managed ×2, dev) | `managed.yml`, `dev.yml` | 18-alpine, floating | 18.6 | none, it floats within 18 | `docker compose pull` | stays floating; a major (`pg_upgrade`) is ignored in Dependabot and is the owner's |
| `edoburu/pgbouncer` | `managed.yml` | v1.24.1-p1 | v1.25.2-p0 (2026-06-10) | one minor | Dependabot `docker-compose` | **T2** — stateless; the managed gate proves it |
| `redis` | `managed.yml` | 7-alpine, floating (7.4.11) | 8.8.2-alpine | one major | owner | **§3** — the licence changed at 7.4, which is the line this floats on; 8 *adds* AGPLv3; Valkey is the BSD drop-in. The facts and a recommendation in item 3 |
| `ghcr.io/triggerdotdev/trigger.dev` + `supervisor` | `managed.yml` ×2, `managed.env.example`, `apps/worker/package.json` | v4.5.12; v4.5.16 pinned in #827 | v4.5.16 | — once #827 is applied | `trigger-version.sh` only | **§3, pinned** — one way (three Prisma migrations, one ClickHouse); the gate run in the owner's window applies it, not the merge. Dependabot told to leave all four places alone |
| `clickhouse/clickhouse-server` | `managed.yml` | 26.2.19.43 by digest | — | — | nobody | stays: pinned to what Trigger.dev's own compose pins, on purpose (`managed-bring-up.md`) |
| `registry` | `managed.yml` | 3.1.1 (#825) | 3.1.1 (2026-06-23) | current | Dependabot `docker-compose` for patches and minors; a major stays the owner's | **§3, taken** — the "configuration rewrite" did not reach a service that mounts no config file |
| `tecnativa/docker-socket-proxy` | `managed.yml` | v0.5.0 | v0.5.0 | current | Dependabot `docker-compose` | — |
| `bitnamilegacy/minio` | `managed.yml` | 2025.5.24-debian-12-r5 by digest | none: `bitnamilegacy` stopped at 2025.7.23 (pushed 2025-08-19); `minio/minio` stopped at RELEASE.2025-09-07 | no upstream | owner | **§3** — the object store has no maintained free image; a replacement is a decision, and item 5 names a candidate |
| `caddy` | `managed.yml` | 2-alpine, floating (2.11.4) | 2.11.4 | current | `docker compose pull` | stays floating; a major is ignored and is the owner's |
| `ghcr.io/zitadel/zitadel` | `managed.yml` | v4.17.3 (#826) | v4.17.3 | current | owner; ignored by name | **§3, taken** — migrates its schema on boot on the persistent stack, so the gate run in the owner's window applies it |
| `busybox` | `managed.yml`; `smoke-managed.sh`, `bootstrap-managed.sh`, `setup-zitadel.sh`; one test pins the printed command | 1.37 | 1.38 | one minor | Dependabot for the compose line; the scripts by hand, and the test says so | **T2** |
| `ghcr.io/twin/gatus` | `managed.yml` | v5.36.0 | v5.36.0 | current | Dependabot `docker-compose` | — |
| `axllent/mailpit` | `managed.yml` | v1.31.0 by digest | v1.31.1, digest `98b916bd…` | one patch | Dependabot `docker-compose` | **T2** — a mail catcher for the gate |
| `nextcloud` | `managed.yml`, `dev.yml` | 34-apache, floating (34.0.3) | 34.0.3 (2026-09-02) | current | `docker compose pull` | stays floating; a fixture and a demo target; a major is ignored |
| `ghcr.io/robbes/ownpace-selfhost` | `deploy/selfhost/compose.yml` | `edge` | ours | — | `images.yml` | — |

Ignored by name in the new Dependabot entries, so that a green tick cannot make these
decisions: the two Trigger.dev images and Zitadel (one way), ClickHouse and the object
store (deliberate pins), and the majors of `postgres`, `redis`, `registry`, `nextcloud`
and `caddy`.

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
24.20.0. pnpm 11.22.0. PostgreSQL 18 on both stacks; PGlite (npm) current. Prisma current.

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
   the stack asks for an 8-only feature. The owner's call, on record when made.
4. **registry 2 → 3.** The 2 line has had no release since 2.8.3; 3.0 rewrote the
   configuration file. The registry only serves Trigger.dev's deploy images inside the
   stack; moving it is a config rewrite plus a bring-up, not a patch. **Taken
   2026-09-06** (#825), and the rewrite turned out not to reach this service: checked
   against the image's own default config at v2.8.3 and v3.1.1, the file's path moved to
   `/etc/distribution/config.yml`, the blob-descriptor cache defaults to memory instead of
   a redis that was never there, unused mail hooks and notification endpoints went, and
   the storage layout under `/var/lib/registry` is the same — and this service mounts no
   config file at all. Pinned 3.1.1; Dependabot moves patches and minors from here, and
   the major ignore now guards against 4. The managed gate is the proof (the CLI pushes
   through it, the smoke runs a task pulled from it).
5. **The object store.** `bitnamilegacy/minio` was pinned by digest after `latest` stopped
   moving (`managed-bring-up.md`); tonight's check shows the other free image,
   `minio/minio`, stopped too, at RELEASE.2025-09-07. There is no maintained free MinIO
   image to move to. The pin is safe as long as it is honest about what it is: frozen
   software with no fixes coming. The decision is whether Trigger.dev's object store should
   be something else (an S3-compatible store that is still published), and that is a design
   choice with a migration behind it, not a version bump. **A candidate, 2026-09-06.**
   Upstream's own compose floats on the same frozen bitnamilegacy image. Suggested:
   **versitygw** (Apache-2.0, `versity/versitygw:v1.8.0`, released monthly, a single binary
   whose bucket is a directory of files on the volume, keys from the environment like
   MinIO's, arm64 published) as the drop-in; **Garage** (AGPLv3, `dxflrs/garage:v2.3.0`)
   if a store with its own integrity model is wanted, at the price of a layout and key
   ceremony at bring-up; SeaweedFS is heavier than this needs; RustFS is still a release
   candidate. The swap belongs in the same drain window as the Trigger.dev upgrade: the
   bucket holds large run payloads, so copy it over or start empty. The owner's call.
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

## 4. Not done, honestly

- **The floating tags stay floating.** `postgres:18-alpine`, `redis:7-alpine`, `caddy:2-alpine`,
  `nextcloud:34-apache` move on every `docker compose pull`, within their major, with no PR.
  That is the intended behaviour for a fixture and for stores that upgrade in place, and the
  majors are what the owner decides — so Dependabot is told to ignore their majors rather
  than pin them. A reader who wants reproducibility on the managed stack should know that
  the bring-up records what it pulled; that is where the exact version lives.
- **ClickHouse** is not checked against anything but Trigger.dev's own compose, and that
  is by design; the version that rejected a migration is the reason it is pinned at all.
- **Whether Dependabot reads `${TRIGGER_IMAGE_TAG:-v4.5.12}`** correctly is not tested here;
  those two lines are ignored by name, so the answer does not matter for them.
- **The three actions behind by a patch or a minor** are left to Monday's group rather than
  moved tonight: the group's PR exists precisely so that they arrive together, once.
