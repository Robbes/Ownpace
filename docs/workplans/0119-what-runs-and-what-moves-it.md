# Workplan 0119 — What runs, what is current, and what moves it

> **In one line:** Audit and upgrade policy for container images, npm packages and GitHub Actions: Dependabot over Dockerfiles and compose files, `trigger-version.sh` for Trigger.dev, owner decisions on Zitadel, Redis, MinIO and pnpm `minimumReleaseAge`, and vitest 5.

## Status — 2026-10-30 (update this block at the end of every session)

**2026-10-30: the Docker socket proxy is built here, on HAProxy 3.4.7 (alpha.4, draft #1740).** The
image scan of 2026-10-29 (Security Scan run 40843566092) read `tecnativa/docker-socket-proxy:v0.5.0`
at 0 critical and 6 high on Alpine 3.24.1, all 6 fixed in newer Alpine packages. Docker Hub pushed
that tag once, on 2026-07-27, and lists no newer release (besides `latest`, which is v0.5.0 itself,
only `master`, `nightly` and builds of upstream's pull requests; v0.5.0 is upstream's newest git tag),
so neither a newer tag nor a new digest could move it, and the pin watch called it current. The
proxy sits between the Trigger.dev supervisor and the host's Docker socket. `deploy/compose/docker-socket-proxy/`
is upstream's Dockerfile at v0.5.0 (commit `2e118a0c`) with its `haproxy.cfg` and
`docker-entrypoint.sh` byte for byte, on `haproxy:3.4.7-alpine` by index digest `2caaf8b1…`, the
newest of the 3.4 line v0.5.0 chose (pushed 2026-10-24 17:56 UTC, past its floor; Alpine 3.24.3,
openssl 3.5.9, musl 1.2.6-r3, pcre2 10.49, zlib 1.3.2-r1). One RUN checks the two files by SHA-256,
so the name, which hashes the Dockerfile's instruction lines, moves when they do. `managed.yml` runs
it as `localhost/docker-socket-proxy:3.4.7-alpine-86292f1f80d6`, `pull_policy: never`, built by the
bring-up's `up` where the name is missing; its environment is upstream's interface, unchanged.
Dependabot moves the base within 3.4 (an entry of its own); the pin watch compares HAProxy within
its line and the release with upstream's tags; the image scan builds the directory under the
name `docker-socket-proxy`, as before; images.yml's `build (docker-socket-proxy)` builds it on a pull
request, starts it with managed.yml's environment and asks it what it must allow and refuse;
`scripts/a-tag-upstream-never-rebuilds.unit.test.ts` holds all of it. Measured on the branch:
Security Scan run 41012325563 (`image_scans`, on `1361e706`) reads `docker-socket-proxy`, built from
`deploy/compose/docker-socket-proxy` on linux/arm64, at 0 critical, 0 high and 0 fixable on Alpine
3.24.3, from 0, 6 and 6. The pull request's `build (docker-socket-proxy)` (Images run 41012498700,
on `61ea7c0a`) built it, the check read both files `OK`, and the proxy, started with managed.yml's
environment on the runner's socket, passed Docker's answer back for the nine requests the
supervisor's environment allows and answered 403 to the twelve it asked to be refused. Since the
review of 2026-10-30 the job asks more: a request Docker must answer passes only with Docker's
`Api-Version` header, and the proxy must answer its own 403, without that header, to seventeen
requests covering the sixteen endpoint switches upstream's v0.5.0 leaves off and managed.yml does not
turn on (auth, build, commit, configs, distribution, exec, grpc, info, nodes, plugins, secrets,
services, session, swarm, system, tasks); the job's first run as changed is owed on the branch. The guard reads those switches from
upstream's `haproxy.cfg` and ENV, and holds the job's verdict by running its step against a stub
that answers the probes wrongly, one kind of wrong answer per run (the proxy's own 403, 503 or 400,
or nothing, where Docker must answer; Docker's 200, 403 or 404, HAProxy's 503, or nothing, where the
proxy must refuse): each run must fail and name every probe. The review found that the
guard as first written passed the job with `exit "$failed"` turned into `exit 0`, and with its
commit, plugins and auth probes dropped, and the job took any status but 403 and 000, HAProxy's own
503 among them, for Docker's answer. HAProxy's notes for 3.4.3 to 3.4.7 are not read yet:
www.haproxy.org was not reachable from the session that took the pin. E2E (managed) on the branch:
owed, after the alpha.3 tag.

**2026-10-30, last: what alpha.3 moves, folded.** The fold (0146 Status, 2026-10-30) closes
alpha.3 with the moves of 2026-10-30 in it: pnpm 11.28.9 (#1736), Trigger.dev's webapp and
supervisor built here (#1722), Redis 7.4.12 (#1737), the demo's Nextcloud 35.0.2 rebuild
(#1732) and Gatus v5.38.0 (#1733). The pin watch (issue #1671) now has one image behind:
Chainguard's MinIO `latest` at `0dab2f9f…`, a rebuild of the same tag. The pin `268d68a2…` had no
finding of any severity on 2026-10-28, so the newer one is no security fix and waits for its
floor, 2026-11-01 03:00 UTC, and for the tag. It is a pull request of its own for alpha.4, with
its scan read and E2E (managed) on its branch, as the watch says. The issue closes when none is
behind.

**2026-10-30: the Trigger.dev images built here (0146 T16, #1722) are in alpha.3, not alpha.4.**
The owner: *"Put all alpha 4 into alpha 3."* #1722 merges before alpha.3's fold, after CI, the
built images' scan and E2E (managed) on its branch; the entries below that name it for alpha.4
are superseded. The pin is still v4.8.1 by version; the FROMs are ghcr's v4.8.1 index digests
pushed 2026-10-23, so no floor restarts. 0146's Status of 2026-10-30 has what changes for live's
deploy from alpha.2.

**2026-10-30: Trigger.dev's Redis moves to 7.4.12, a security release, before its floor.** The
owner, 2026-10-30: *"3 pr's are still open, merge them in, continue with fixing the
vulnerabilities, work to the new defined alpha as next version. Still no one is in the alpha."*
Redis 7.4.12 (released 2026-10-26) is marked SECURITY upstream: a heap buffer overflow when a
`PUBLISH` or `SPUBLISH` message over 4 GB is propagated over the cluster bus. This stack runs no
cluster, so it is not reachable here, but it is the release alpha.3 was to wait for (the owner,
2026-10-28). `7.4.12-bookworm` is digest `b6b6e3dc…`, pushed by Docker Hub 2026-10-28 06:05 UTC,
still Debian 12; its three-day floor would end 2026-10-31 06:05 UTC, and it is taken a day early
under the floor's one exception, a security fix (CONTRIBUTING.md), with E2E (managed) green on
its branch. The append-only file and uid 999 are unchanged, so `redis_data` carries over and the
way back is the old digest.

**2026-10-30: the demo's Nextcloud rebuild (#1732) merges before its floor.** The owner,
2026-10-30: *"3 pr's are still open, merge them in, continue with fixing the vulnerabilities,
work to the new defined alpha as next version. Still no one is in the alpha."* The rebuild clears
a critical (CVE-2026-111497, entry below), so it is taken a day before its three-day floor
(2026-10-31 16:51 UTC) under the floor's one exception, a security fix (CONTRIBUTING.md), with
E2E (managed) and E2E (self-hosted) green on its branch as planned.

**2026-10-30: Gatus v5.38.0 (#1733) merges before its floor.** The owner, 2026-10-30: *"3 pr's
are still open, merge them in, continue with fixing the vulnerabilities, work to the new defined
alpha as next version. Still no one is in the alpha."* v5.38.0 clears 7 of the status page's 12
highs (Go's standard library and gRPC, entry below), so it is taken a day before its three-day
floor (2026-10-31 21:17 UTC) under the floor's one exception, a security fix (CONTRIBUTING.md),
with E2E (managed) green on its branch as planned.

**2026-10-29: pnpm 11.28.9, the one `packageManager` line (issue #1735).** npm dates it
2026-10-27 00:32 UTC, so it passes the three-day floor at 2026-10-30 00:33 UTC, and its pull
request merges after that. Under it `pnpm install` leaves `pnpm-lock.yaml` byte-identical, and
`pnpm audit` reads no advisory. Read for it: the 11.28.9 entry of the package's own
`CHANGELOG.md`. It takes undici 7.30.1 for GHSA-xjj6-f33q-929c (a registry response with too
many content encodings crashed pnpm), and sizes the install workers by a container's CPU quota.
It also re-acts on changed store and linker settings, and `pnpm audit --ignore` now exits
non-zero when advisories remain. The advisory gate runs `pnpm audit --audit-level=moderate
--json` without `--ignore`, the images install into fresh stages, and nothing here uses
registry prefixes, so none of it changes what this repository does. CI only; no E2E.

**2026-10-29: the demo's Nextcloud 35.0.2 moves to upstream's rebuild, which clears a critical
(T5).** The image scan of 2026-10-29 on `main` (Security Scan run 40843566092) found one fixable
critical in `nextcloud:35.0.2-apache@sha256:89af7ee7…`: CVE-2026-111497 in `libbrotli1`
1.1.0-2+b7. Upstream rebuilt the same tag on 2026-10-28 (Docker Hub push 16:51 UTC), digest
`e0b1a2af…`: the same Nextcloud 35.0.2 and PHP 8.5.12, on Debian's snapshot of 2026-10-27, with
`libbrotli1` 1.1.0-2+deb13u1, read from the image's dpkg status on amd64 and arm64. The other
packages that moved are libheif 1.23.4 to 1.23.6 and tzdata 2026c to 2026e. `managed.yml`,
`dev.yml` and the Testcontainers default move together (`a-float-nothing-ever-pulled`). It merges
once three days old, after 2026-10-31 16:51 UTC (CONTRIBUTING's age, counted from the registry's
push), with E2E (managed) and E2E (self-hosted) green on its branch, before the next nightly. No
`occ upgrade` and no data migration: the old digest can still start on the demo's volume.
`nextcloud-second-major.yml`'s 34.0.5 leg stays as it is (CI only). The image's other criticals
(libopenexr, libxml2, linux-libc-dev) have no fix yet.

**2026-10-29: the status page's Gatus moves to v5.38.0, which clears 7 of its 12 highs.** The
image scan of 2026-10-29 on `main` (Security Scan run 40843566092) found 12 fixable highs in
`ghcr.io/twin/gatus:v5.37.0`, all in the Go binary. v5.38.0 (Docker Hub push 2026-10-28 21:16
UTC) is built with Go 1.27.3 and gRPC 1.84.0, which clear the four standard-library ones and the
three gRPC ones. The other five, in modules v5.38.0 did not move (go-jose 4.1.4,
klauspost/compress 1.18.6, golang.org/x/image 0.40.0 twice, golang.org/x/net 0.58.0), wait on a
Gatus release. Its source, diffed against v5.37.0: the
Dockerfile, `main.go`, `alert.go` and the page's static files are the same, `config.go` adds a
Resend alert type (used only when configured; ours is not) and logging, the User-Agent is still
`Gatus/1.0`, and the SQLite store needs no migration. So every comment that read its source at
v5.37.0 holds at v5.38.0, and says so. The pin stays by tag, as `status-page`'s guard holds it.
It merges once three days old, after 2026-10-31 21:17 UTC, with E2E (managed) green on its
branch. Rollback is the old tag.

**2026-10-28, about 22:30 UTC: the owner removed the OTA demo's way back to Nextcloud 34, and
both stacks' Bitnami-era MinIO volumes.** Earlier than planned: *A Nextcloud major on the OTA
stack* (the bring-up guide) removes the copy of the demo's volume and the dump of its database
once the move has held for a night or two, and the owner removed them the same evening. E2E
(managed) run 40774398411 had already brought the OTA demo up healthy on 35.0.2 (T5, #1720), so
the copies of 34 were no longer needed. The old MinIO volumes, `ownpace-managed_minio_data` and
`ownpace-live_minio_data`, went the same evening with the old images (0146 T7). So item 5's
restore plan, the old image on the old volume, no longer exists on either stack. On live that
also ends the way back to alpha.1 (0132 Status, 2026-10-29; the operator runbook, *Rolling back
from it, by day 6*).

**2026-10-27, later: tar out of the copy of pnpm each Trigger.dev service runs, and T16's
review** (0146 T16, the same draft; 0146's later Status entry of the day has the detail). The
owner chose on 2026-10-27, asked with the risk stated, to remove tar 7.5.13 from the copy of
pnpm each service keeps too: in pnpm 10.33.2 only the bundled node-gyp requires it, and these
containers run scripts and install nothing, so a native `pnpm install` there is the one thing
that would now fail. The criticals go from 8 to 2 (webapp: zlib1g, dompurify) and from 2 to 0
(supervisor). The webapp keeps root's copy (`trigger-api` runs `user: root`), the supervisor
node's. From the review: each build refuses a release other than its `read_at`, so a version
move reads the reasons again before its `build (trigger, …)` jobs can be green, and those come
before any window; the `.env` names the version and must be the checkout's; going back to an
older version runs the checkout that pinned it, never `trigger-version.sh pin` backwards.

**2026-10-27: Trigger.dev's two images built here without the files nothing runs, a draft for
alpha.4** (0146 T16, branch `claude/ownpace-public-readiness-y7orc6-trigger-patched`, stacked on
#1716 with #1717 merged in; the owner's *"Both"* of 2026-10-26; 0146's Status entry of the same
day has the detail). The pin is still the version: two `${TRIGGER_IMAGE_TAG:-v…}` defaults in
`managed.yml`, which `.env` names (it must be the checkout's) and the drift check holds to the SDK. What changes is
where the images come from: `trigger-api` and `trigger-supervisor` run
`localhost/trigger.dev:${TRIGGER_IMAGE_TAG:-v4.8.1}-<hash>` and `localhost/supervisor:…`, built
from `deploy/compose/trigger.dev` and `deploy/compose/supervisor`, whose FROM is ghcr's v4.8.1
image by index digest (`bcce9e8f…`, `9907be3e…`). They delete depot's and esbuild's Go
binaries and the copy of pnpm the service's user does not run: the scan's criticals go from 8
to 3 and from 2 to 1 (2 and 0 since the entry above), once a dispatched scan on the branch confirms it. `trigger-version.sh pin`
moves the FROMs and the names; Dependabot reads neither directory, on purpose. The inventory's
Trigger.dev row says so. Dropped, removal by removal, as upstream fixes each.

**2026-10-28: alpha.3's work landed on main, the demo's Nextcloud 35 last.** Twenty-eight pull
requests merged after the alpha.2 tag (`f62bcbe2`), from 2026-10-27 21:58 to 2026-10-28 22:38 UTC;
`main`'s head is `9a58872c`. This plan's and 0146's, with what proved each before its merge:
- **On CI:** pnpm 11.28.8 (#1701, `4cd87405`), cosign v3.1.4 (#1671; #1702, `3188e9e1`), qs
  6.16.1 (#1723, `01073963`), the actions group (#1711, `145ca694`), the weekly scan naming every
  critical (#1718, `86de86d3`, with §3 item 10), the suites against Nextcloud 35 in CI (T5; #1705,
  `d6acd430`), 0146 T16a (#1721, `991bd21c`) and T10 (#1700, `ee9be30f`), and GoAccess 1.12 on
  Alpine 3.24 (#1675; #1703, `fcb3d50f`).
- **One E2E at a time** (E2E (managed) runs, the self-hosted ones marked): the floating images
  by exact tag and digest (#1678, `afe17fef`; 40610883300, self-hosted 40614623319); 0146 T15
  (#1717, `6f9af7f2`; 40616652331) and T15b (#1719, `fb0fea2e`; self-hosted 40621523504); T12a,
  nginx 1.31.8-alpine-slim (#1707, `53fb6453`; 40626664067); T11 (a), Mailpit v1.32.0 (#1699,
  `e33d7902`; 40631369534), and (b), Stalwart v0.16.27 (#1698, `29d1d7e0`; 40635727901); the 15
  npm minor and patch bumps (#1712, `f8f8e289`; 40648562117, self-hosted 40654078776); T9 (#1687,
  `9480e898`; 40656320601, self-hosted 40661756633); T12 (#1708, `13e2300e`; 40663045583,
  self-hosted 40669572838; Dependabot's #1713, #1714 and #1715 closed as superseded by it); T13a
  (#1710, `f34588e6`; 40671926123) and T13 (#1709, `b13d303e`; 40673664905, self-hosted
  40679655003); T7, MinIO's digest `268d68a2…` (#1726, `0f3fda25`; 40706723499).
  The scheduled E2E (managed) of 2026-10-28 ran on `9480e898`, 09:54–10:15 UTC, green
  (40667933035).
- **Trigger.dev v4.8.1** (#1668; #1697, `f387b175`): the owner moved the OTA stack's `.env` to
  v4.8.1 first (checklist T35), the backup `before-v4.8.1` verified; E2E (managed) 40756746457,
  19:42–19:55 UTC. Then 0146 T14, the tasks on the API image's own base (#1716, `98802571`;
  40758865207).
- **Nextcloud 35.0.2 for the demo, the dev stack and the tier, the leg on 34.0.5** (T5; #1720,
  `3d2f129e`), on the owner's OK of 2026-10-26: the owner took the way back first (the volume
  copied, the database dumped), and E2E (managed) 40774398411, 21:44–21:52 UTC, was the OTA
  demo's upgrade to 35 (`nextcloud:35.0.2` healthy). The merge followed at 21:54 UTC.
- **Then systeminformation 5.33.16** (#1727, `9a58872c`, 22:38 UTC): Dependabot alerts 6 and 7,
  GHSA-4vjg-vx72-qq4g (low) and GHSA-7648-jmwf-vw7j (moderate), both published that day, in the
  copy Trigger.dev's SDK carries through `@opentelemetry/host-metrics`. A floor at 5.33.14 in
  `pnpm-workspace.yaml`; E2E (managed) 40778814997, 22:17–22:37 UTC.
- The other three, #1704 (0104 T5), #1724 (0132 T9) and #1725, are neither plan's. Live runs
  alpha.2 since the owner's deploy (checklist T21–T25).
- **Still for alpha.3:** Redis 7.4.12. The owner decided on 2026-10-28 that alpha.3 waits for
  it; Docker Hub pushed the tag again that day, so its three-day floor ends 2026-10-31 06:05 UTC.
  Then the CHANGELOG fold and two counted nights.
- **For alpha.4:** #1722 (0146 T16, the Trigger.dev images built here), a draft whose stacked
  work is now on `main`'s base.

**2026-10-26: the demo, the dev stack and the integration tier move to Nextcloud 35.0.2, and
the second-major leg to 34.0.5, in alpha.3, merged 2026-10-28** (T5, `3d2f129e`), on the branch
`claude/ownpace-public-readiness-y7orc6-nextcloud-35-demo`: #1678's head (`72c6cff6`, every
floating image pinned) with #1705's (`b09d6f4f`, the leg on 35.0.2) merged in, as #1720.
**The owner's OK, 2026-10-26: "Yes, in alpha.3"**, late in the alpha.3 queue, after the riskier
items, with the copies of *A Nextcloud major on the OTA stack* taken before its E2E (managed).
A major is the owner's call (§2.1's row; the pin watch moves nothing and names the route); the
owner had kept the demo on 34 for alpha.2, and on the OTA stack the move is one way. `main` was
frozen until the alpha.2 tag (`f62bcbe2`), so nothing moved before it.
- **The merge.** Five files conflicted. `testcontainers-setup.ts` took #1705's one-line ternary
  with `dev.yml`'s reference as the literal, the resolution both entries below name; the
  CHANGELOG keeps both bullets under `[Unreleased]` (`### Added` before `### Changed`); this
  Status keeps both 2026-10-25 entries; §2.1 keeps #1678's pinned row and adds #1705's; §4 keeps
  #1678's "pinned" bullet in place of #1705's stale "stay floating" one, and adds #1705's bullet
  on the leg; `docs/LESSONS.md` and the workplan index were regenerated.
- **What moves.** `managed.yml`, `dev.yml` and the Testcontainers default, from
  `nextcloud:34.0.5-apache@sha256:1f9212ad…` to `nextcloud:35.0.2-apache@sha256:89af7ee7…`
  (pushed 2026-10-23 19:50 UTC, PHP 8.5.12, past the three-day floor at 19:51 UTC today). Read
  again on Docker Hub this evening: `89af7ee7…` is still what `35.0.2-apache` and `35-apache`
  name, and `1f9212ad…` what `34.0.5-apache` and `34-apache` name, each index with linux/amd64
  and linux/arm64. `nextcloud-second-major.yml`'s `NEXTCLOUD_IMAGE` goes the other way, to
  #1678's 34.0.5 digest. `a-nextcloud-the-demo-does-not-run`'s rule did not change and made the
  flip one change: with the three moved and the leg left on 35 it failed, "the same major".
- **Why 34 for the leg.** Nextcloud maintains 34 until 2027-06 and 33 until 2027-02 (the server
  wiki's *Maintenance and Release Schedule*, read today); 34 is the major a customer who has not
  taken 35 yet most likely runs, and the one this code was measured on. 34.0.6 and 35.0.3 are
  due 2026-11-12. The pin watch reads 35 in the compose files from here on, and nothing reads
  the leg's 34 (§4).
- **Read for it**, at the server's `v35.0.2`, nextcloud/docker `7e9e152f` (`35/apache`), and
  activity, notifications and nextcloud_announcements at `stable35`:
  - *The upgrade.* `version.php` upgrades from 34.0 and 35.0 only. The image's entrypoint, the
    same file for 34 and 35 at `7e9e152f`, refuses a data version newer than the image and a jump
    of more than one major, copies the code into the volume, runs `occ upgrade` and prints any app
    the upgrade disabled; when `occ upgrade` fails it exits, and Nextcloud keeps maintenance mode
    on ("Maintenance mode is kept active", `core/Command/Upgrade.php`). `status.php` answers 200
    in maintenance mode and with an upgrade owed, so the healthcheck cannot tell; since the
    review below, the bring-up asks `occ status` after `up_wait nextcloud` and stops on either.
  - *Its database.* PostgreSQL 18 is 35's recommended version (the admin manual's system
    requirements at `stable35`); SQLite stays for `dev.yml` and the tier, as on 34.
  - *Apps.* Nothing here installs or enables one: there is no `app:install` or `app:enable` in
    `deploy/`, `scripts/` or the workflows (the smoke names `occ app:enable sharebymail` only as
    a remedy). The demo uses what ships enabled: dav, files, files_sharing, sharebymail,
    provisioning_api (`setup-nextcloud-users.sh` makes the accounts over OCS) and the brute-force
    allow-list, which 35 reads from the same `bruteForce` `whitelist_*` keys. 35 ships every app
    34 ships, enables the same 46 by default, and adds one, `sharing`, always enabled: share APIs
    and occ commands, no background job. #1705's leg ran the share suite green against it.
    That is what the repository enables, not what the OTA box holds: its app store is left on,
    and an app installed there by hand (calendar, contacts, tasks and deck do not ship with the
    server) is `occ upgrade`'s to update from the app store or disable, which the entrypoint
    only prints ("The following apps have been disabled:"). So the bring-up doc has the owner
    list `occ app:list --shipped=false` before the run and compare it after (review below).
  - *The smoke's drain.* The five jobs that can mail (`NC_MAIL_JOBS`) are the same classes at 35,
    each listed as a job in its app's `info.xml`; none of the seven jobs 35's shipped apps add
    (app_api one, circles four, notifications one, serverinfo one) mails anybody.
    `CronService` is the same (14 minutes, job classes on `cron.php`'s command line, "Starting
    job"), and `background-job:list --class … --output=json` still prints `class`.
  - *Phoning home.* `config.sample.php`'s `updatechecker`, `appstoreenabled`,
    `has_internet_connection` and four connectivity sites are as at `stable34`, and the crawler,
    the connectivity check and the lookup-server retry read `has_internet_connection` as on 34.
    `a-service-that-phones-home`'s two Nextcloud rows move to `nextcloud:35`; until then they
    failed on the new pin, as they are meant to.
  - *PHP.* 35.0.2's image still sets `opcache.jit=1255` in `opcache-recommended.ini`, so
    `zz-ownpace-no-jit.ini` is still needed and still sorts after it; it sets
    `session.upload_progress.enabled=0` and `APACHE_BODY_LIMIT` as 34.0.5's build does.
- **What upgrades, and when.** Only the OTA demo has data that lasts: its `nextcloud_data`
  volume and its `nextcloud` database in the stack's Postgres
  (`a-demo-nextcloud-on-the-stacks-postgres`). Live runs no Nextcloud: `deploy-live.sh` and
  `stand-up-live.sh` refuse `--with-demo` by name, and without it the bring-up does not start one
  (`docs/managed-bring-up.md` says so). The self-host E2E removes `dev.yml`'s container before
  each run, so 35 installs afresh there, and the tier starts a new one per run; a developer's
  `dev.yml` keeps the image's anonymous volume and upgrades it on the next `up`. **E2E (managed)
  on this branch is the first thing that upgrades the OTA volume**: the gate brings the branch's
  `managed.yml` up in the OTA project (`bootstrap-managed.sh --from data --with-demo`, then
  `up_wait nextcloud`), so that run is the upgrade, not a test before it, and every nightly of
  `main` is red at `up_wait nextcloud` from then until this merges. That run, 40774398411, ended
  at 21:52 UTC on 2026-10-28, and #1720 merged at 21:54 UTC, before the next nightly.
- **The way back, written for the owner**, in `docs/managed-bring-up.md`, *A Nextcloud major on
  the OTA stack*: the order (the OK; after the alpha.2 tag and never between counted nights; the
  migrations paused a few minutes before the copies and until the branch merges; the room checked
  against live's disk floor; the apps that do not ship listed, then the volume copied and the
  database dumped, with the demo stopped, by a block that refuses an earlier try's leftovers and
  ends with a line that says it is done, and a block that puts the demo back when it stops
  partway; E2E (managed) dispatched when the branch is otherwise ready, and merged before the next
  nightly is created, 03:30 UTC; `occ status`, the entrypoint's disabled-apps line and the app
  list asked), and what to do when the run goes wrong: a wait that gave up while the upgrade ran
  on (dispatch again), a failed `occ upgrade` (put the cause right, then maintenance mode off,
  `occ upgrade` by hand, `occ status`), back to 34 (both copies together), and with no copies a
  fresh demo (drop the volume and the database; the next bring-up installs it and makes the four
  accounts and their seed again, and what the owner's own migrations wrote there is lost). Each
  block runs as one subshell under `set -eu`, so a pasted block stops at its first failure.
- **Not re-proven on 35:** `nextcloud-to-postgres.sh --convert` and `nextcloud-counters.sql`,
  shown on 34.0.4 for an install still on SQLite. None is known: the OTA demo has been on
  Postgres since 2026-09-29 and a fresh install starts there.
- **Proved here** (no Docker daemon in this session): the unit guards that read the changed
  files, `scripts/`, `packages/testing` and the classification guard (268 files, 5 994 tests, 33
  skipped) and the four `apps/api` ones that read them; ESLint on the changed TypeScript; `pnpm
  typecheck`. Five mutations, each red and put back: the leg left on 35, `dev.yml`,
  `managed.yml` or the Testcontainers default left on 34, and the phones-home row left at 34.
  Before the leg moved, the three pins moved alone failed `a-nextcloud-the-demo-does-not-run`
  ("the same major"), and before the rows moved, `a-service-that-phones-home` ("re-read them at
  the new pin").
  **Owed, in this order:** CI on the pull request (the integration tier on 35.0.2 on both
  architectures, and the second-major leg on 34.0.5, which the change to
  `testcontainers-setup.ts` starts); E2E (self-hosted) on the branch, where `dev.yml`'s 35
  installs afresh and is provisioned, seeded and migrated into; then, after the owner's OK and
  the alpha.2 tag, E2E (managed) on the branch, which is the OTA demo's upgrade, in the order the
  bring-up doc gives. At the merge, these records say what happened in place of what waits:
  T5's row and §2.1's two `nextcloud` rows the merge's date and the E2E (managed) run that
  upgraded the OTA volume, in place of "on the branch …" and "a draft waiting on the owner's
  OK"; this entry the date of the OK. The comments elsewhere name the move by its pull request
  and T5, not by the day it was written, and need no new date. Done on 2026-10-28: the owner took
  the way back's copies (the volume copied, the database dumped), E2E (managed) on the branch ran
  as 40774398411, 21:44–21:52 UTC (`nextcloud:35.0.2` healthy), and #1720 merged at 21:54 UTC
  (`3d2f129e`).
- **Review of `48dff04e`, the same evening** (eleven findings, every one held). The failed
  `occ upgrade` recovery was wrong: with maintenance mode kept on, Nextcloud's updater leaves it
  on after a good upgrade (it turns it off only when it was off as the upgrade started,
  `lib/private/Updater.php` at `v35.0.2`), and when the core already upgraded, `occ upgrade`
  does not run at all ("Nextcloud is in maintenance mode … call this script again", exit 2,
  `core/Command/Upgrade.php`); the doc now turns it off first, then upgrades, then asks
  `occ status`. The recovery blocks set the compose project themselves and run as one subshell
  under `set -eu`, so an empty project never reaches `pg_restore` or `DROP DATABASE`. The order
  lists and compares the apps that do not ship. `bootstrap-managed.sh` asks `occ status` after
  `up_wait nextcloud` (`nextcloud_upgrade_done`) and stops on maintenance, an upgrade owed or no
  answer, with the way on, and `a-demo-nextcloud-on-the-stacks-postgres` holds it with the
  stand-in answering as v35.0.2's `core/Command/Status.php` prints: four mutations (no
  maintenance check, no upgrade check, no installed check, the call dropped from `phase_data`),
  each red and put back. The comments that said "35 since 2026-10-26" name the move by its pull
  request and T5 (the day the draft was written is not the day it lands, and the OTA demo moves
  at E2E (managed) on the branch); the guard's title reads either way; the one-way note in
  *Updating a running deployment* names the way back for a major; "Back to 34" names `main`'s
  34 pin, floating `34-apache` until #1678 merged (2026-10-28, `afe17fef`); #1678's CHANGELOG
  bullet points at 35.0.2.

**2026-10-26: the tasks build on the API image's own base, stacked on v4.8.1** (0146
T14, #1716 from branch `claude/ownpace-public-readiness-y7orc6-tasks-trixie-base`, merged
2026-10-28 (`98802571`); 0146's Status entry of the same day has the detail and the figures).
- **What moves the tasks' image.** `apps/worker/trigger.config.ts` builds the tasks on the image
  `apps/api/Dockerfile` builds FROM, through the build manifest's `image.base`, so the CLI's
  `triggerdotdev/node:24-bookworm` is in nothing a deploy builds. Dependabot's move of that FROM
  line is the only way the tasks' Node or Debian moves; #1689's copy of the Node binary is gone.
- **One new pin, which moves with the CLI.** The build stage names the CLI's own build image,
  `triggerdotdev/node:24-bookworm-build@sha256:34a3f455…` (trigger.dev 4.8.1's `BUILD_IMAGE`,
  pushed 2026-10-22). It is needed because the CLI runs `npm i` there, and the runtime stage
  now has no npm. A Trigger.dev move reads two things from the new CLI's `dist/esm/deploy/` and
  carries them over by hand:
  - `buildImage.js`'s `BUILD_IMAGE['node-24']`, into `TASK_BUILD_IMAGE`;
  - `EMSIGN_COMPROMISE_DISTRUSTED_ROOTS` and `emsignRejectedIntermediates.js`, into the config's
    `DISTRUSTED_ROOTS` and `apps/worker/task-image/emsign-block/`.

  The version gate pins the CLI 4.8.1 values, and fails when `apps/worker`'s
  `@trigger.dev/sdk` leaves 4.8.1, naming those three to read again. Dependabot sees none of
  them, and `trigger-version.sh` does not move them. A stale build image still builds: only
  `node_modules` and `index.json` leave that stage.
- **The weekly image scan follows.** `scripts/image-scan.mjs` lists the API's FROM image as
  `trigger-task-base` while the config builds the tasks on it, so the 2026-10-25 entry's "reads
  the base from the pinned CLI" holds only for a config that names no base.
- **Measured** (Trivy 0.76.1, amd64 and arm64): the tasks' runtime stage on #1708's
  `node:24.22.1-trixie-slim` reads 0 critical and 43 high, none fixable. What a deploy builds
  on the CLI's base, its layer's upgrade included, reads about 2/88 on `main` (4.7.6) and about
  1/80 on #1697; the raw bases read 14/119 and 1/83.

**2026-10-25: Trigger.dev v4.7.6 → v4.8.1, in alpha.3**, on the branch
`claude/ownpace-public-readiness-y7orc6-trigger-4-8-1` (issue #1668; the owner chose v4.8.1
directly on 2026-10-25). Main was frozen from the alpha.2 fold to its tag; this merged after the
tag, as #1697 on 2026-10-28 (`f387b175`).
- **`trigger-version.sh pin v4.8.1`** in every place. It found the tag in both images on ghcr by
  manifest (index digests `trigger.dev` `sha256:bcce9e8f…`, `supervisor` `sha256:9907be3e…`).
  The lockfile moves `@trigger.dev/core` and `@trigger.dev/sdk` only; their dependency ranges
  did not change (`npm view` of both versions).
- **Read:** the release commits of v4.7.7, v4.8.0 and v4.8.1 (the notes GitHub shows, and their
  `.server-changes`), and `git diff v4.7.6 v4.8.1` (51 commits). v4.7.7 was cut on upstream's
  hotfix branch and is not an ancestor of v4.8.0; everything it carries is in v4.8.0 too.
  **No database or ClickHouse migration:** `internal-packages/database/prisma/migrations` and
  `internal-packages/clickhouse/schema` are the same at both tags (the newest still
  `20261020120002_drop_oidc_signing_key_status_live_key` and 054), and so are the entrypoint
  and the dashboard agent's database. So, unlike v4.7.6, this move does not move the schema;
  the backup before it is taken anyway, as for every move. **No new required setting:**
  `env.server.ts` adds `RUN_ENGINE_SNAPSHOT_STORE_COMPLETED_TTL_MS` (inert without a
  snapshot-store Redis, which these stacks do not configure), renames `ALERT_QUERY_CONCURRENCY`
  to `ALERTS_QUERY_CONCURRENCY_LIMIT` and drops the two webhook endpoint cache keys, none of
  which `managed.yml` sets; the supervisor adds `KUBERNETES_POD_RESERVED_SOURCE_PORTS`, for
  Kubernetes only. The features (hosted webhooks, `chat.agent` channels for Slack and Linear,
  alerts on query results checked every minute) are unused here, and the routing of runs
  without a compute template concerns Trigger.dev's own compute worker groups, not a Docker
  supervisor.
- **What it fixes.** The webapp and supervisor images run Node 24.22.1, where v4.7.6 ran
  24.18.0 (`docker/Dockerfile`, `apps/supervisor/Containerfile`): Node's October 2026 security
  releases, which upstream's v4.7.7 notes say fix CVE-2026-111497 (an out-of-bounds write in the
  Brotli decoder) and several TLS hostname verification bypasses. Goose is built with Go
  1.26.10, and the supervisor distrusts the compromised emSign roots and the Sectigo AAA
  cross-sign through a new entrypoint that preloads `distrust-cas.cjs`; `managed.yml` sets no
  `entrypoint` or `command` for it, so that runs as shipped. Upstream's advisories page lists
  none published after 2026-10-20; GHSA-65rr-73jq-6qhf of that day (a CLI login reactivating a
  revoked personal access token) is fixed from v4.7.4.
- **The tasks' Node (#1669).** CLI 4.8.1 names `triggerdotdev/node:24-bookworm@sha256:3cdc8242…`
  for `node-24`, rebuilt on `node:24.22.1-bookworm-slim` (upstream's `base-images/images.json`),
  where 4.7.6 named `…@sha256:d2d0c018…` on 24.18.0. The layer #1689 added still copies the API
  image's Node over it (24.22.1 today, the same version), so the tasks keep running the API
  image's Node and move with Dependabot's FROM line; v4.8.1 changes the base under that, not
  the rule. A new base digest misses the builder's cache, so the first task deploy after this
  is the slow one (apt in both stages, the Debian archive reachable), as *Re-deploy the tasks*
  in `managed-bring-up.md` says for a move of the CLI's base image. The one CLI fix in v4.8.1
  (stages on a custom base image keep that image's trust store) does not reach this config,
  which names no custom image: the tasks keep `--use-openssl-ca` on Debian's store.
  `scripts/image-scan.mjs` reads the base from the pinned CLI, so `trigger-task-base` (0146 T10)
  is scanned at the new digest by the first Security Scan that runs its image legs on a tree
  carrying this change. A pull request's run is not one: those legs run only on the Monday
  schedule and on a dispatch that leaves `image_scans` on (`security-scan.yml`, the
  `image-list`, `image-scan` and `image-scan-report` jobs), and on this branch's runs all three
  are skipped. So the counts for the new base and the two v4.8.1 images were not read here
  (no Trivy in this session, the registry blobs behind its proxy); they come from the first
  Monday scan after the merge, or before it from a hand dispatch on this branch.
- **Upstream's compose at v4.8.1** (`docker/docker-compose.yml`, `hosting/docker/`, the same as
  at v4.7.6): ClickHouse `26.2.19.43@sha256:c2f26055…` (`26.2` in `hosting/`), Redis 7,
  Postgres 14, MinIO as `chainguard/minio` by digest (development) and `bitnamilegacy/minio`
  (`hosting/`), registry 2. ClickHouse did not move, so it stays on 26.2 here (§3 item 9);
  0146 T11 (c)'s 26.3 waits for upstream to move. The other stores are this repository's own
  choices and do not follow upstream's.
- **The telemetry, re-read at v4.8.1:** of the files read at v4.7.6 only `env.server.ts` and
  `root.tsx` (one line, `publicAppOrigin`) changed, no new key switches a third party on, and
  prisma 6.14.0, pnpm 10.33.2 and goose v3.27.1 are unchanged. The CLI's `environment.ts` did not
  change, so `deploy-tasks.sh`'s `--env` note holds.
- **The three-day floor.** pnpm dates `@trigger.dev/core` and `@trigger.dev/sdk` 4.8.1 at
  2026-10-23 14:28:03 and 14:28:06 UTC, the signing times of their provenance, so every frozen
  install refuses this branch's lockfile (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, seen here,
  with those two dates) until about 14:29 UTC on 2026-10-26, and accepts it after with nothing
  changed. `npm view … time` dates them later, 14:29:05 (sdk) and 14:29:45 (core), when they
  reached the registry; the floor goes by pnpm's dates, not those. The npm packages carry no
  security fix, so no exclude entry; the lockfile was written with the floor lifted for that one
  command only. The deploy CLI is fetched by `npx`, which the floor does not cover;
  `trigger.dev@4.8.1` is of the same day.
- Proved here: the unit guards that read these files, `a-service-that-phones-home` red on the old
  tag first. Done on 2026-10-25: main merged in after the fold (#1706, `7c8226a3`), with this
  change's CHANGELOG line under `## [Unreleased]` (the fold renames that heading to
  `## [0.2.0-alpha.2]`, and git leaves the line beneath it, in a conflict or without one). Owed
  before merge, after the alpha.2 tag and never during the counted nights: checklist T15 on the OTA
  stack (the hold, nothing `EXECUTING`, `trigger-version.sh backup before-v4.8.1`,
  `TRIGGER_IMAGE_TAG=v4.8.1` in its persisted `.env`), then E2E (managed) on the branch, merged
  within the hour. **That is one window, with no other E2E (managed) in it and the scheduled nightly
  outside it** (its cron says 03:30 UTC, but GitHub has started it between about 08:10 and 09:10
  UTC; the window ends before 08:00 UTC): once the persisted `.env` names v4.8.1,
  `bootstrap-managed.sh` stops at the `trigger` phase (exit 1, on the drift from the SDK) for every
  tree whose `apps/worker` still pins 4.7.6, main and every other branch. If the merge does not
  follow, the tag goes back to v4.7.6 before anything else runs; after it, other branches merge main
  before their own E2E (managed). Live takes it from the alpha.3 tag, after
  `TRIGGER_IMAGE_TAG=v4.8.1` in its `.env`. `deploy-live.sh --dry-run` will call that tag one-way
  over alpha.2 for this move alone, although v4.8.1 adds no migration: it counts any move of the
  Trigger.dev pin in `managed.yml` as one-way (`differences()`), and the way back is then the copy
  before the update, as for any one-way deploy. Done on 2026-10-28: the owner moved the OTA stack's
  `.env` to v4.8.1 (checklist T35), the backup `before-v4.8.1` verified; then E2E (managed) run
  40756746457 on the branch, 19:42–19:55 UTC, and the merge at 19:55 UTC (#1697, `f387b175`).

**2026-10-28: MinIO's digest moves to Chainguard's build of 2026-10-25 (0146 T7).**
`chainguard/minio:latest` by the index digest `268d68a2…` (linux/amd64 and linux/arm64),
built 2026-10-25 01:49 UTC and pushed as `latest` at 14:29 UTC, so three days old at
2026-10-28 14:29 UTC; `e70b2b1e…`, pushed 2026-10-27, is not. Its apk databases, both
architectures: Wolfi's `minio` 0.20261023.200651-r0, the fork's
`RELEASE.2026-10-23T20-06-51Z`, and `mc` 0.20250813.083541-r27 as before. The fork's two
commits since `RELEASE.2026-09-22T19-25-18Z` (`d88920d6…`'s) move nine Go modules (golang.org/x/net
to 0.60.0, x/crypto to 0.57.0 and klauspost/compress to 1.18.7 among them) and the Go of their
VulnCheck workflow, and change nothing under `cmd/` or `internal/`, so the release check and call-home that `a-service-that-phones-home` holds off
are the code read at the earlier tag. Trivy 0.76.1 read no finding of any severity in it
on 2026-10-28, on both architectures, as in `d88920d6…`. Nothing a stack sets changes; the
next bring-up pulls it. Merged 2026-10-28 as #1726 (`0f3fda25`), after E2E (managed) run
40706723499 on the branch (14:31–14:39 UTC).

**2026-10-26: the API runs on distroless, built on a branch, merged 2026-10-28 (0146 T13,
#1709, `b13d303e`).** A new
row, `gcr.io/distroless/nodejs24-debian13`, at its `nonroot` tag by index digest
`cb606325…` (Debian 13.7, Node 24.22.1), is the API's runtime stage; the `node` row stays the
API's build stage and the web and selfhost images' base, and the tasks' Node. Dependabot
`docker` moves the distroless digest when the `nonroot` tag moves, a tag that names no
version, so it offers digest moves only; a new Node major is a new image name, by hand. The
two rows now move apart and must agree on the Node version, since the tasks take the `node`
row's: the managed smoke's preflights stop when the API container's Node is not the `node`
row's `x.y.z`, so a move of one without the other goes red on its E2E (managed). 0146's
Status entry of 2026-10-26 has the measurements: 0 critical and 0 high on both architectures,
against T12's 0 and 43, with the same Node binary.

**2026-10-25: the images' Node base names its Debian, built on a branch, merged 2026-10-28
(0146 T12, #1708, `13e2300e`).** The `node` row's pin moves from `24.22.1-slim` (Debian 12.15) to
`24.22.1-trixie-slim` (Debian 13.7) by index digest `43b9ba11…`, the same Node 24.22.1, on
#1708 from branch `claude/ownpace-public-readiness-y7orc6-node-trixie-slim`, merged after the
alpha.2 tag and #1687. Dependabot `docker` keeps the `-trixie-slim` suffix when it moves the
tag, so the Node patch still moves weekly and the Debian release only by hand; a guard holds
the three `FROM node` lines to one string on a named release. The api and selfhost runtimes
also drop npm and corepack, which nothing in them runs. 0146's Status entry of 2026-10-25 has
the measurements: the base from 1 critical and 61 high to 0 and 43, with the same Node binary.

**2026-10-26, later: the appliance's Postgres pin moves into a Dockerfile too** (0146 T15b,
branch `claude/ownpace-public-readiness-y7orc6-appliance-postgres-without-gosu`, stacked on
#1717; merged 2026-10-28 as #1719, `fb0fea2e`). `deploy/selfhost/compose.yml`'s `postgres` runs
`localhost/postgres:18.6-alpine-b18f51417292`, built from `deploy/selfhost/postgres/Dockerfile`:
the appliance's own digest (`77f58511…`, kept, so that removing gosu is the only change) without
gosu, as uid 70. Its pin is that FROM, which Dependabot moves in a `docker` entry of its own
(`/deploy/selfhost/postgres`, `chore(postgres)`, never a major: the ignore moved there from the
docker-compose entry). The docker-compose entry for `/deploy/selfhost` stays, reads the app's
line, and ignores `localhost/postgres` outright, which its parser would otherwise ask Docker Hub
for. The pin watch reads neither `deploy/selfhost/compose.yml` nor
`deploy/selfhost/postgres/Dockerfile` (in `deploy/selfhost` it reads only `setup-stalwart.sh`'s
Stalwart pin). 0146's Status has the rest.

**2026-10-26: the managed stacks' Postgres pin moves into a Dockerfile, for after
the alpha.2 tag** (0146 T15, #1717, merged 2026-10-28 as `6f9af7f2`, branch
`claude/ownpace-public-readiness-y7orc6-postgres-without-gosu`, stacked on #1678). `managed.yml`'s
`postgres` and `trigger-db` and `dev.yml`'s `postgres` run
`localhost/postgres:18.6-alpine-6b2d97623fb5`, built by compose from
`deploy/compose/postgres/Dockerfile`: #1678's `postgres:18.6-alpine` digest (`898c60cb…`)
without gosu, as uid 70. The pin is the Dockerfile's FROM, by tag and digest; the twelve hex
digits after it are the hash of the Dockerfile's instructions, so a moved pin is a new name
compose builds. The pin watch compares the FROM with Docker Hub's tags (read on the real
registry: *"postgres 18.6-alpine current"*), the image scan builds and scans it, and Dependabot
still reads no file in `deploy/compose`. The appliance's line (`77f58511…`) stays the official
image and Dependabot's. 0146's Status of 2026-10-26 has the measurements and what was run.
After its review (the same day): the three services say `pull_policy: never`, nothing builds the
image while the machine has it (the bring-up builds `api web` by name, and no document gives an
`up --build`), and a pull request touching `deploy/` builds and starts it (`images.yml`,
`build (postgres)`). Asked again the same day: the name is the content (the SHA-256 of the
Dockerfile's instruction lines, as above), and Dependabot did not read the Dockerfile; it does
now, in a `docker` entry of its own with no major, and its pull request fails
`a-database-started-as-root` until the three names move, with the `sed` that moves them (0146's
Status has the rest).

**2026-10-25, evening: the web image and www run nginx 1.31.8-alpine-slim (0146 T12a)**, on
the branch `claude/ownpace-public-readiness-y7orc6-nginx-alpine-slim`, #1707, based on #1678's
branch, because both change the same two lines. It merged after #1678, after the alpha.2 tag,
and not before 19:51 UTC on 2026-10-27, three days after Docker Hub pushed the slim tag's index,
`f45171d3…`. That push added the riscv64 image (built 16:24 UTC on 2026-10-24); the amd64 and
arm64 images under it, `f9238a4a…` and `0e0bc470…`, were built at 22:47 and 23:13 UTC on
2026-10-21 and pushed at 01:50 UTC on 2026-10-22, the same hour as -alpine's.
- **Read with Trivy 0.76.1** (database of 19:10 UTC today), remote image source, critical and
  high, on linux/arm64 and linux/amd64: 1.31.8-alpine `1ef7ca94…` reads 0/1 on both, brotli-libs
  1.2.0-r1, CVE-2026-111497, fixed in 1.2.1-r0; 1.31.8-alpine-slim reads 0/0 on both. The
  stable line's 1.30.6-alpine reads 0/1 too (arm64), so moving lines would gain nothing.
- **What slim leaves out.** Slim has 21 packages and -alpine 72; slim's 21 are among -alpine's
  at the same versions (nginx 1.31.8-r1 on Alpine 3.24.3, busybox, gettext-envsubst, tzdata).
  -alpine adds 51: curl, ca-certificates, brotli-libs, libxml2, libxslt, libexpat, libx11,
  libgd, tiff, libwebp, libavif, geoip, `nginx-module-{njs,xslt,geoip,image-filter,acme}` and
  their libraries. libexpat and libx11 were 1.31.7-alpine's two highs (0146's Status of
  2026-10-23); slim ships neither. Each architecture's slim manifest is the first seven of
  -alpine's eight layers, the same digests, read from the registry: -alpine is slim plus one
  layer, so the entrypoint's template step and its envsubst are the ones the web image has run.
- **Nothing here uses what it drops:** no `load_module`, `js_`, `xslt`, `geoip`,
  `image_filter` or `proxy_ssl` in `apps/web/nginx.conf.template` or
  `deploy/compose/www-nginx.conf`; the API upstream is plain `http://api:3001`; both health
  checks and the incident runbook's look from inside the web container are busybox's `wget`;
  nothing in `deploy/`, `scripts/` or `.github/` runs curl in either container.
- **Held by `scripts/an-nginx-that-carries-only-what-it-loads.unit.test.ts`** (the review):
  both references are -alpine-slim by tag and digest, neither config names a directive of the
  modules slim lacks, and no health check of a container running it, nor a runbook's look
  from inside the web or www container, asks with curl, which slim does not have. Nothing
  else would see a curl check on `www.yml`: no workflow brings it up.
- Proved here: the 31 unit guards that read `apps/web/Dockerfile`, `www.yml` or
  `scripts/nginx-on-this-machine.ts` (the two that run a real nginx skip without one, as on
  any machine without it; CI runs them), and the new guard, which fails on each mutation
  tried: a curl health check in `www.yml` or the Dockerfile, -alpine in either file, a
  `js_import` in `www-nginx.conf`, a curl in the incident runbook's look. Owed: the pull
  request's image build, E2E (managed) on the branch once #1678 is in it, and the OTA site
  recreated by hand after the merge (no workflow runs `www.yml`). Merged 2026-10-28 as #1707
  (`53fb6453`), after E2E (managed) run 40626664067 on the branch (03:26–04:05 UTC).

**2026-10-25: the five pins read again with `main` merged in, and Nextcloud's moved to
upstream's rebuild of 2026-10-23**, on the branch
`claude/ownpace-public-readiness-y7orc6-floating-images-pinned` (#1678). Main was
frozen from the alpha.2 fold to its tag; this merged after the tag, for alpha.3, on 2026-10-28
(`afe17fef`).
- **Read at 10:47 UTC:** Docker Hub's tag API for each exact tag (digest, push time, the
  images under it), and both Nextcloud indexes and their arm64 images' configs through
  `mirror.gcr.io`, because Docker Hub's registry had stopped answering anonymous pulls for the
  hour. Four are unchanged and still the tag's: postgres 18.6-alpine `898c60cb…` (pushed
  2026-10-22 13:08 UTC), redis 7.4.11-bookworm `44960b31…` (2026-10-21 06:05), caddy
  2.11.7-alpine `eb4d35b7…` (2026-10-22 17:52) and nginx 1.31.8-alpine `1ef7ca94…` (2026-10-22
  16:51). Each index carries linux/amd64 and linux/arm64, and each tag is still the newest in
  its line.
- **Nextcloud's tag moved.** `34.0.5-apache` was rebuilt at 17:17 UTC on 2026-10-23 as
  `1f9212ad…` (official-images `c1edc1f7`, building nextcloud/docker `7e9e152f`, "Set
  session.upload_progress.enabled=0"), and the pin names it now in `managed.yml`, `dev.yml` and
  the Testcontainers setup. Both builds are Nextcloud 34.0.5 on PHP 8.5.12 over the same
  `php:8.5-apache-trixie` images (amd64 `54264bcb…`, arm64 `0b3da8b9…`); the new one adds that
  one line to the image's PHP settings. PHP 8.5.12 (2026-10-21) carries the fixes for
  CVE-2026-109618 and CVE-2026-109619 (php-src GHSA-w8hw-w9fx-j79w and GHSA-6wmf-4rv5-p3rp, both
  critical, unauthenticated), so `9dbdc711…` already had those. The second advisory names
  session upload progress as one way in and says turning it off may be prudent even after the
  update; upstream's commit takes it off as "the recommended mitigation for the upcoming
  CVE-2026-115560", citing PHP's news of 2026-10-23, which was not reachable from here. Nothing
  here uses upload progress: it reports a form POST's progress into the PHP session, and the
  writer, the seed and the gate write over WebDAV. Both are 34.0.5, so the move is not one way:
  the demo's volume stays at 34.0.5 under either.
- **The three-day floor.** postgres passes it at 13:08 UTC today, nginx at 16:51 and caddy at
  17:52; Nextcloud's new build at 17:17 UTC on 2026-10-26. It is taken before then as a
  security fix, the floor's one exception, and the merge waited for the alpha.2 tag anyway.
- **The OTA machine retags once, before the fold.** The release checklist's T17 points
  `main`'s floating tags at these five digests tonight, at 18:00 UTC or later and before the
  fold merges, so that the E2E on `main` before the fold, the two counted nights and this
  branch all run the same bytes. Nextcloud's is `1f9212ad…`, about 49 hours old at 18:00 UTC,
  on the same exception. The other choice is to keep `9dbdc711…` for both counted nights and
  let this pull request move it after the tag. Never a retag between the two counted nights:
  they would run two Nextcloud builds on one commit. Both builds are 34.0.5, so neither
  choice is one way.
- **Ordering with #1705** (Nextcloud 35 in CI, merged 2026-10-27). Both change the line of the
  Testcontainers setup that starts Nextcloud. Whichever merges second resolves it to #1705's
  one-line `(asked ? new GenericContainer(asked) : new GenericContainer('…'))` with `dev.yml`'s
  reference, this branch's digest, as the literal. Tried in a scratch merge of the two: that
  form passes `a-float-nothing-ever-pulled`, #1705's `a-nextcloud-the-demo-does-not-run` and
  `nextcloud-image` (47 of 47); keeping #1705's `nextcloud:34-apache` fails the first, and
  the same ternary wrapped over three lines fails the second. The two also meet in this Status
  block, `docs/workplans/README.md` and `docs/LESSONS.md`, as text.
- **Reviewed the same day.** `main` merged in again for #1692 (MinIO, on `main` since 11:38
  UTC): text conflicts in the CHANGELOG, this Status block and the inventory's MinIO row. A
  guard now holds `dev.yml`'s Postgres and Nextcloud to `managed.yml`'s, every postgres line
  there one reference and every nextcloud line one: the pin watch compares tags, not digests,
  so the move above, missed in `dev.yml`, would have been reported by nothing. The old guard
  passed with only `managed.yml`'s Nextcloud digest moved; the new one fails on that, and on
  one of `managed.yml`'s two postgres lines moved alone.
- Proved here: the guards that read the files this touches, listed in the pull request, and
  CI on `0b581fdc`, integration on amd64 and arm64 among it. Owed before merge: E2E (managed)
  and E2E (self-hosted) on the branch; after the fold, `main` merged in once more, so that
  the CHANGELOG line lands in the new `[Unreleased]` and not in alpha.2's section, and CI
  again on that merge. Done before the merge of 2026-10-28: E2E (managed) run 40610883300
  (00:46–01:21 UTC, on `9586a8c8`) and E2E (self-hosted) run 40614623319; on `main` the line
  sits under `[Unreleased]`.

**2026-10-25: the suites that talk to Nextcloud run against 35 too, in CI only**, on the branch
`claude/ownpace-public-readiness-y7orc6-nextcloud-35-ci` (T5), merged after the alpha.2
tag. Nothing on either stack moves and nothing here is one way: the demo, the dev stack and the
integration tier stay on 34 for alpha.2, and the demo's move to 35, which is one way (Nextcloud's
data never goes back a version), is a decision for after the tag. What this gives that decision is
the answer to "does our code work against 35", where until now the first to ask would have been a
customer whose own Nextcloud already runs it.
- **What runs.** `.github/workflows/nextcloud-second-major.yml` runs every
  `*.integration.test.ts` that reads a `NEXTCLOUD_` variable, found by `scripts/nextcloud-suites.mjs`
  rather than listed: WebDAV, CalDAV and CardDAV sources, the DAV sync and update propagation, the
  chunked upload (0156) and a new share suite. None needs Stalwart, so Stalwart is not started. On a
  GitHub-hosted amd64 runner, never the Spark: on a push to `main` that touches `packages/**` or the
  test setup, Mondays at 05:17 UTC, on demand, and on a pull request that changes the leg itself. Not
  on every pull request, since `ci.yml` already runs every suite against 34 on two architectures.
  Not a required check (`every-pr-check-is-classified` lists it with the reason).
- **The pin.** `nextcloud:35.0.2-apache@sha256:89af7ee7…`, the digest pushed 2026-10-23 at
  19:50 UTC (the image rebuild that sets `session.upload_progress.enabled=0`, and on 2026-10-26
  still the digest `35-apache` and `latest` name), on PHP 8.5.12 of 2026-10-22, which closes
  CVE-2026-109618 and CVE-2026-109619 (php-src `NEWS` at `php-8.5.12`). The `34-apache` the
  integration job pulls (34.0.5, rebuilt the same day) carries the same PHP, so the two legs now
  differ in Nextcloud's major only. Moved on 2026-10-26 from `35.0.1-apache@sha256:8f2f0e93…`
  (pushed 2026-10-10, PHP 8.5.11) once 35.0.2's digest had passed the three-day wait at 19:51 UTC.
  Not sooner: the image runs on a throwaway CI runner with no data and nothing that can reach it;
  and the newest advisories on nextcloud/security-advisories are of 2026-10-08, before 35.0.2, none
  of the ten on its first page naming a 35 release. It moves by hand, the workflow line and §2.1's
  row: Dependabot reads no workflow `env:` and the pin watch reads no workflow file (§4).
- **The setup, when `NEXTCLOUD_IMAGE` names an image** (`packages/testing/src/nextcloud-image.ts`):
  a Nextcloud that does not start fails the run, where the default warns and lets the DAV suites
  skip; the version `status.php` reports must be the one the tag names; and the step after the run
  fails a vitest report with any skipped test. Every run of the tier now logs which Nextcloud
  answered.
- **The share verb against a real server, for the first time in this tier**
  (`packages/connectors/src/nextcloud-ocs.integration.test.ts`): a folder shared with an account the
  server knows is a user share with the editor bits; `scanNextcloudShares` reads it back with its
  grantee, note and place; a grantee the server does not know and who is no address is refused as
  `notAnAccount` after the user attempt's OCS 404 and share-by-mail's. Three create calls, inside
  the 20 per account in ten minutes. It runs in `ci.yml`'s integration job against 34 as well.
- **Read for it.** The admin and developer manuals' *Upgrade to Nextcloud 35*
  (nextcloud/documentation, `master`): PHP 8.2 dropped, Debian 13 the minimum, MariaDB 10.11 and
  MySQL 8.4 the minimums, phpseclib 3, the Remote API and some Calendar resource methods removed;
  nothing about WebDAV paths, the OCS share API or chunking. nextcloud/server `stable34` against
  `stable35`, file by file:
  - `ShareAPIController::createShare` is identical (232 lines), `#[UserRateLimit(limit: 20,
    period: 600)]` on both, so the share press's limit is the same on 35;
  - `remote.php`, `RootCollection`, `Server`, `ChunkingPlugin`, `UploadHome`, `Directory`, `File`,
    `FilesPlugin`, `QuotaPlugin`, `TrashbinPlugin`, `AssemblyStream` and `CardDavBackend`: no
    change in behaviour (typed constants, l10n lookups, exception classes);
  - `ChunkingV2Plugin`: the upload session's metadata in the distributed cache now has a sliding
    24-hour lifetime, renewed by every piece, where 34 set it once at the MKCOL; on 34 a v2 transfer
    longer than 24 hours fails with "Missing metadata for chunked upload". Only with a distributed
    cache: the test image has none and takes the v1 assembly path (`nextcloud-chunked-upload.ts`);
  - `CalDavBackend::getDenormalizedData`: an object made only of recurrence exceptions, with no
    series master, is stored, where 34 answers 400 *"A valid calendar object must contain at least
    one VJOURNAL, VEVENT, or VTODO component type"*. More permissive; nothing here relies on the
    refusal.

  The image (nextcloud/docker `master`, `35/apache/Dockerfile` at `7e9e152` and at `6edd06e`, the
  commit 35.0.1 was built from; `docker-library/official-images`' `library/nextcloud`): the same
  base line as 34, `php:8.5-apache-trixie` (the builds differ in PHP's patch release, see the pin),
  and the same `opcache-recommended.ini`, by that name, with
  `opcache.jit=1255` and `opcache.jit_buffer_size=8M`. So `zz-ownpace-no-jit.ini`
  (`deploy/compose/nextcloud-php.ini`) still sorts after it and is still needed when the demo moves
  (`a-jit-that-compiled-a-crash`), and `APACHE_BODY_LIMIT` works as on 34. `latest` and `apache`
  point at 35 (read 2026-10-25), so a customer who pulls `nextcloud` without a tag runs 35.
- **Proved on the pull request (#1705, head `40a2dba5`).** Nextcloud second major #1 (run
  40187374651), 11:04 to 11:07 UTC: *"Nextcloud 35.0.1 answered"*, 7 files and 36 tests passed,
  none skipped (`numPendingTests: 0`), the share suite's 3 among them. CI #4762: both
  `integration-tests` legs logged *"Nextcloud 34.0.5 answered"* and passed 96 files and 814 tests,
  the share suite's 3 among them; `ci-complete` green. So nothing in the DAV, chunked-upload or share
  code needs to change for 35.0.1. The session that wrote this has no Docker daemon (`docker ps`: no
  socket), so those runs are the only ones. Proved before the push: the unit tests of
  `nextcloud-image.ts` (22) and the guard
  `a-nextcloud-the-demo-does-not-run` (14), red on nine mutations of the workflow and the setup
  (no `paths:` on the pull request trigger, the self-hosted runner, the default's major, a floating
  tag, Stalwart started, skips allowed, a finder failure unseen, no throw when the asked image does
  not start, the version check off); the workflow guards and the classification guard.
- **Ordering.** #1678 changes the same line of `testcontainers-setup.ts` (the default to
  `nextcloud:34.0.5-apache@sha256:…`), and its guard finds the default as a literal
  `new GenericContainer('nextcloud:…')`. This keeps the default a literal call of its own, so that
  guard still finds it; whichever merges second resolves the one line. When the demo and the tier
  move to 35, this guard fails until the leg names another major, most likely 34, which customers
  will still run: the pull request that moves the demo makes that choice. #1720 chose 34.0.5
  (merged 2026-10-28, `3d2f129e`).
- **Reviewed the same day, and `main` merged in** (`0029db4a`, the 2026-10-24 entry below kept
  under this heading). The review's two findings that hold until the merge: after the fold of
  `[Unreleased]` into alpha.2 (#1706) lands on `main`, a merge of `main` into this branch carries
  the CHANGELOG bullet under alpha.2 with no conflict and no guard noticing, so that merge moves it
  back under the new `[Unreleased]` by hand; and the pin moves to 35.0.2 (above). Fixed on the
  branch: the leg also runs on a push that touches `apps/**`, where the finder also looks, and on a
  pull request that changes `vitest.config.ts`, which defines the integration project; the guard
  compares the leg's major with `dev.yml`'s too, requires `.numPassedTests == .numTotalTests` with
  every clause of the report check joined by `and`, and refuses a `continue-on-error` or an `if:`
  on the run, the report step or the job, each red on its own mutation (nine); the classification
  entry sits above the security-scan comment it had split from its list; `docs/testing.md` lists
  the workflow in its CI mapping.
- **Before the merge, in this order.** (1) On or after 2026-10-26 at 19:51 UTC, re-read
  35.0.2-apache's index digest; if it is still `sha256:89af7ee7…`, pin it in `NEXTCLOUD_IMAGE` and
  its comment, this Status's pin bullet, §2.1's row and the CHANGELOG bullet, and let the leg
  re-run on the pull request (the workflow changed, so it does); if upstream pushed a newer digest,
  that one waits its own three days. (2) After #1706 has merged, merge `main` in and move the
  CHANGELOG bullet under `[Unreleased]`. (3) After #1678, if it merges first, resolve the one line
  of `testcontainers-setup.ts` (Ordering, above). (1) and (2) were done before the merge (T5's
  row). #1705 merged first, on 2026-10-27 (`d6acd430`), so #1678's merge of 2026-10-28
  (`afe17fef`) resolved the line, to #1705's ternary with `dev.yml`'s reference as the literal.

**2026-10-25, 22:13 UTC: 11.28.8, the one `packageManager` line.** It passed the three-day floor
at 22:09 UTC (npm dates it 2026-10-22 22:08 UTC). Under it, `pnpm install --frozen-lockfile`
leaves `pnpm-lock.yaml` byte-identical and `pnpm audit` reads no advisory at any severity. #1694
closes with this pull request. The entry below, written for 11.28.7 earlier the same day, holds
for 11.28.8: the two differ only in the Node.js the standalone `@pnpm/exe` embeds. Merged
2026-10-27 as #1701 (`4cd87405`).

**2026-10-25: pnpm 11.28.7, on the branch `claude/ownpace-public-readiness-y7orc6-pnpm-pin`**
(issue #1694 is the pin watch's record). Its entry stayed on its branch until it merged, after
the alpha.2 tag. `packageManager` moves from 11.28.6 to 11.28.7, the newest pnpm 11 past the
three-day floor today: npm dates it 2026-10-21 11:14 UTC. `latest-11` is 11.28.8, dated
2026-10-22 22:08 UTC, which passes the floor at 2026-10-25 22:09 UTC; this pull request's CI
would have fetched it before then, through corepack and `pnpm/action-setup`, which keep no
floor of their own. Between the two tags the `pnpm11/` source differs in comments and in one
constant, the Node.js the standalone `@pnpm/exe` embeds (26.0.0 → 26.12.1, for the
certificate authorities Node.js distrusted in October). CI and the three Dockerfiles run the
npm `pnpm` package on their own Node, through corepack, never `@pnpm/exe`. The hosts are
taken from the documented installs, not checked one by one: `corepack enable pnpm` (README)
and `npm install -g pnpm@11` (TROUBLESHOOTING) are the same package. A host that installed
pnpm's standalone build instead would switch to `@pnpm/exe@11.28.7`, since pnpm 11 keeps the
running build's name when it switches (`installPnpm.ts`), and so run the Node that 11.28.8
replaces; `readlink -f "$(command -v pnpm)"` names a path under `@pnpm/exe` or
`~/.local/share/pnpm` on such a host. Taking 11.28.8 is the one `packageManager` line, and
#1694 stays open until then.
- **Read for it:** the GitHub release notes of 11.28.7 and 11.28.8, and pnpm's `pnpm11/`
  source at both tags (`switchCliVersion.ts`, `shouldPersistLockfile` in the config reader,
  `installPnpm.ts`), and Node v24.22.1's `deps/corepack/package.json` (corepack 0.36.0).
  What reaches this repository:
  - a re-resolution records every peer a package declares, also one its own dependency
    supplies, and reuses a version the same install already resolved instead of keeping the
    lockfile's and adding a second copy;
  - `trustPolicy` now applies to the version `packageManager` pins; this repository sets none;
  - registry revisions (a `revision` field in the lockfile, a `+rN` specifier) fail with
    `ERR_PNPM_REGISTRY_REVISIONS_UNSUPPORTED`; the lockfile has neither;
  - with `minimumReleaseAge` set, cached metadata is revalidated with one ETag request; the
    floor and `minimumReleaseAgeExclude` are read as before;
  - a `workspace:` path in `overrides` resolves from the workspace root; none is written here;
  - the store keeps its `v11` layout, so the images' cache mounts and the hosts' stores carry
    over. The version switch writes nothing to `pnpm-lock.yaml` for a pin below major 12
    (`shouldPersistLockfile`), so the pin itself never shows in the lockfile.
- **Proved here**, with 11.28.7 and the same commands under 11.28.6 beside it: `pnpm install`
  and `pnpm install --frozen-lockfile` leave `pnpm-lock.yaml` byte-identical, in the worktree
  and in a fresh copy with no `node_modules`; the api and web Dockerfiles' filtered frozen
  installs install the same 622 and 642 packages as 11.28.6 and leave the lockfile alone; the
  advisory gate's `pnpm audit --json` is the same document under both (828 dependencies, no
  advisory); corepack 0.36.0, the one Node 24.22.1 carries into the three images, fetches,
  verifies and runs 11.28.7 from an empty `COREPACK_HOME`, and so does 0.34.0. A full
  re-resolution (`pnpm install --lockfile-only --resolution-only`) adds five lines,
  `ajv-formats@3.0.1`'s optional peer `ajv`, where 11.28.6's leaves the file identical: the
  first item above. Not taken here; it comes with the next update that re-resolves.
- Owed before merge: CI on the pull request. The images do not build on it (`images.yml`
  builds on a pull request only when a Dockerfile, `deploy/**` or itself changes), so the
  first image built with 11.28.7 is `main`'s push run after the merge. Also owed: after the
  alpha.2 fold (#1706) lands, `main` merged in again and the entry's section read with
  `awk '/^## \[/{s=$0} /pnpm is 11\.28/{print s}' CHANGELOG.md`, which must print
  `## [Unreleased]`. The fold puts `## [0.2.0-alpha.2] - 2026-10-25` between
  `## [Unreleased]` and the `### Changed` this entry sits under, so a merge raises no conflict
  and moves the entry into the release: tried on 2026-10-25 with `git merge-file` against the
  fold's head, 841d63c0, the entry landed under `## [0.2.0-alpha.2]`. No guard catches it.
  Done: CI on the pull request, and #1701 merged 2026-10-27 (`4cd87405`); on `main` that `awk`
  prints `## [Unreleased]`.

**2026-10-24: the object store moves to Chainguard's MinIO, built on a branch, merged 2026-10-25
(0146 T7, #1692).** The owner's answer of 2026-10-23, 19:05 UTC, on the recommendation to accept the
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
entry stayed on its branch until it merged. No E2E on the branch before 2026-10-25 18:00 UTC,
when the three same-tag rebuilds of 2026-10-22 it pins are three days old. Nextcloud's data
never goes back a version, so either the floating tags `main`'s nightly uses are first pointed
at the pinned digests, or the branch E2E runs only when it is ready to merge and it merges
before the next nightly. The plan is to merge it after the Alpha launch and before PostgreSQL
18.7 (2026-11-12). It merged on 2026-10-28 (`afe17fef`), in alpha.3.

**2026-10-22, recorded: the four pins and Redis merged** as #1657 on 2026-10-22 (`cead33f6`):
the 2026-10-21 entry on PgBouncer, Mailpit, Gatus, the registry and Redis, below. E2E (managed)
#273 ran on its head `a7180578` before the merge, green. `main`'s first scheduled nightly with
them is 2026-10-23's.

**2026-10-22: the floating tags pinned, by exact version and digest (§4).** `postgres:18-alpine`
(both databases, `dev.yml`, the Testcontainers setup), `redis:7.4-bookworm`, `caddy:2-alpine`,
`nextcloud:34-apache` (`managed.yml`, `dev.yml`, Testcontainers) and `nginx:1.31-alpine`
(`www.yml` and the web image's runtime) floated, and nothing ever pulled them, so both stacks
ran whatever copy the machine pulled first; §4 said the bring-up records what it pulled, and
nothing did. Pinned at postgres 18.6-alpine `898c60cb…`, redis 7.4.11-bookworm `44960b31…`,
caddy 2.11.7-alpine `eb4d35b7…`, nextcloud 34.0.5-apache `9dbdc711…` and nginx 1.31.8-alpine
`1ef7ca94…`: the index digest Docker Hub served for each tag on the day, its tag list and the
registry agreeing, every index with linux/arm64 and amd64. Three are that day's rebuilds, not
the digests read on 2026-10-21: postgres (13:08 UTC; the self-host line's `77f58511…` is the
tag's earlier build, which Dependabot moves there), nextcloud (07:51) and caddy (17:52). nginx
was first pinned at 1.31.7-alpine `892bb215…` and moved to 1.31.8 on 2026-10-23, its digest
read that day: 1.31.8 itself (pushed 16:51 UTC on 2026-10-22) is four bug fixes and one change,
no security fix, where 1.31.7 (2026-10-14) fixed five CVEs, but its image is built on Alpine
3.24.3 and 1.31.7's on 3.24.2, which Trivy 0.76.0 finds two high CVEs in that 3.24.3 fixes
(libexpat CVE-2026-77214, libx11 CVE-2026-88806). Pinned at 1.31.7, the web image would have
gone from no high finding (`ownpace-web:edge`, Alpine 3.24.3) to two.
`db-roles.sh` reads its client from `managed.yml`'s first postgres line, as `stand-up-live.sh`
does, up to the first space or `#`, and `db_roles_init` refuses a file without one. Guards:
`a-float-nothing-ever-pulled`, new (no float in the three compose files but busybox, named with
its reason; every outside `FROM` by digest; the Testcontainers images equal to `dev.yml`'s;
`managed.yml`'s postgres lines end at the reference, which `stand-up-live.sh` reads to the end
of the line); `rotate-db-passwords` (the client follows a moved pin, a comment after it is not
part of it, and none is refused); the caddy and Nextcloud rows of
`a-service-that-phones-home` compare repository and major line, the line their facts were read
for; `zitadel-image-matches-postgres` and `an-error-log-that-kept-the-link` read a digest.
Proved here: the `scripts` unit project, 254 files and 5 717 tests, with the new cases red on
`main` first and five mutations caught. Not run here: integration (no Docker daemon). Owed
before merge: E2E (managed) and E2E (self-hosted) on the branch, and integration in CI. After
merge the OTA stack recreates postgres, trigger-db, trigger-redis, trigger-tls and nextcloud at
its next nightly gate and builds web on the pinned base; live takes them at its next
`deploy-live.sh`; the OTA site when somebody runs `docker compose -f deploy/compose/www.yml up
-d` in its checkout. The owed E2E ran before #1678 merged on 2026-10-28 (`afe17fef`): E2E (managed)
40610883300 and E2E (self-hosted) 40614623319.

**Before E2E (managed) runs on that branch (the review, 2026-10-22).** The run recreates the
OTA stack's demo Nextcloud from 34.0.5, and the image upgrades the `nextcloud_data` volume to
it. Every nightly of `main` after it, and every other branch's E2E, would start Nextcloud from
the machine's `nextcloud:34-apache` again, which §2.1 recorded as 34.0.3 and nothing has pulled
since, and Nextcloud refuses data newer than its image ("downgrading is not supported"): red at
`up_wait nextcloud` until this merges, and again after a revert. The databases would go from
18.6 back to an older 18.x the same way, which a minor tolerates. So one of two, first: on the
machine, the floating tags `main` still names are pointed at the pinned images by digest
(`docker pull <repo>@<digest>`, then `docker tag` onto the float; never a plain `docker pull`
of the float, which can land past the pin and make the branch the downgrade), so that `main`
and the branch run the same bytes, live takes them at its next deploy, and a revert stays
possible; or the branch E2E is dispatched only when the branch is ready to merge, and it merges
before the next 03:30 UTC nightly. Either way not before 2026-10-25 18:00 UTC: the three
rebuilds, and redis 7.4.11's build of 2026-10-21 06:05 UTC, are then older than the three days
`minimumReleaseAge` asks of a package (there is no written rule for images). They were taken
over the older builds because a rebuild under the same tag carries its base's newer packages,
and the merge waits for launch, past that age anyway. After this one, every Nextcloud pin moves
one way: `managed-bring-up.md`, *Updating a running deployment*.

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
| T3 The owner's decisions | 🔨 In progress | Taken 2026-09-06: `@azure/msal-node` 6 (#819; the O365 gate on main is the proof, queued for the self-hosted runner), Node 26 declined (#820), `nodemailer` 10 (#823), registry 3.1.1 (#825), Zitadel v4.17.3 (#826, applied by the gate run in the owner's window), Trigger.dev v4.5.16 pinned (#827, applied the same way after the drain and the backup). Taken 2026-09-09: Redis (item 3 — **stay on 7.4**, with a revisit trigger) and the release-age gate (item 8 — `minimumReleaseAge: 4320`, three days; seven fossil exclude entries removed; guard added). Taken 2026-10-23: ClickHouse 26.2 for the Alpha (item 9). The object store (item 5): taken 2026-10-23, *"T7 no, fix already within the alpha"* (0146 T7), and ✅ merged as #1692 on 2026-10-25 (`0029db4a`, E2E (managed) #281 green) — *was:* still the owner's, with a candidate named. |
| T4 vitest 5 | ✅ Done 2026-09-06 | `vitest` and `@vitest/coverage-v8` 4.1.11 → 5.0.0, every declaring package together. Green on Node 22 (508 files, 6 326 tests) and on Node 24 as CI runs it (509 files, 6 411 tests); the v8 provider loads and reports. Two things the major needed first, found by trying it and landed as their own PR (#810) because they are right under vitest 4 too: the alias map's missing subpath pins — `@openmig/core/archive-reader` and thirteen more, plus a guard — and the exclude patterns in their documented form, since vitest 5 follows pnpm's workspace symlinks when it crawls and a bare `node_modules` matched only the top level. The bump is its own PR, stacked on #810. |
| T5 The second Nextcloud major in CI | ✅ Done 2026-10-28 | 2026-10-25: `nextcloud-second-major.yml` runs the suites that talk to Nextcloud against 35.0.1 by digest (35.0.2 since 2026-10-26), the setup refuses a Nextcloud that did not start or is not the version named, and the tier has a share suite. Green on its pull request (#1705: 36 tests against 35.0.1, 814 against 34.0.5 on both architectures); merged after the alpha.2 tag, on 2026-10-27 as #1705 (`d6acd430`). Reviewed and `main` merged in the same day; after the fold (#1706), the CHANGELOG bullet back under `[Unreleased]`; on 2026-10-26, once its digest was three days old, 35.0.2 by digest (PHP 8.5.12) (Status). CI only, not one way. 2026-10-26, for alpha.3 on `…-nextcloud-35-demo` (#1678 and #1705 merged), merged 2026-10-28 as #1720 (`3d2f129e`): the demo, the dev stack and the tier to 35.0.2 by digest and the leg to 34.0.5, the major customers who have not upgraded still run; **the owner's OK came on 2026-10-26** ("Yes, in alpha.3", Status), and E2E (managed) run 40774398411 on it (2026-10-28, 21:44–21:52 UTC, `nextcloud:35.0.2` healthy) was the OTA demo's one-way upgrade, after the copies (Status of 2026-10-26; the way back in `managed-bring-up.md`). |

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
| `node` (24-trixie-slim; 24-slim until 0146 T12) | `apps/api` (its build stage only, since 0146 T13), `apps/web`, `apps/selfhost` Dockerfiles; the managed tasks, which build on it (`apps/worker/trigger.config.ts`, 0146 T14, #1716); the Windows payload's node.exe follows `apps/selfhost` | 24.22.1-trixie-slim by index digest `43b9ba11…`, Debian 13.7 (0146 T12, 2026-10-25; 24.22.1-slim, Debian 12.15, from 2026-10-21, the October security release; digest `6f7b03f7…` with no tag at the audit, 24.20.0-slim from T2) | 24.22.1-trixie-slim (Node released 2026-10-20); the tag's digest moves as more architectures land (ppc64le at 17:39 UTC on 2026-10-21) and Dependabot offers each move | current: the pin is the tag's index | Dependabot `docker`, which keeps the `-trixie-slim` suffix and moves the payload with it since 2026-10-21; the Debian release by hand | **T2** — and T1 gives it its tag; Debian 13, and no package manager in the api and selfhost runtimes, from 0146 T12 |
| `gcr.io/distroless/nodejs24-debian13` (`nonroot`) | `apps/api/Dockerfile`'s runtime stage, since 0146 T13 | the `nonroot` tag by index digest `cb606325…`, Debian 13.7 and Node 24.22.1 (uploaded 2026-10-23 23:31 UTC) | the tag's index, as read 2026-10-25 23:40 UTC | current | Dependabot `docker`, digest moves only (the tag names no version); a new Node major or Debian is a new image name, by hand. Its Node version must be the `node` row's: the managed smoke stops otherwise | **0146 T13**: no shell, `printenv` or package manager, Node at `/nodejs/bin/node` off PATH; 0 critical and 0 high (Trivy 0.76.1, 2026-10-25) |
| `nginx` | `apps/web/Dockerfile` runtime, `deploy/compose/www.yml` | 1.31.8-alpine-slim by digest `f45171d3…` (2026-10-25, 0146 T12a: the same nginx package and base layers as -alpine, without its dynamic modules, curl and the 51 packages they bring; 1.31.8-alpine `1ef7ca94…` from 2026-10-23, 1.31.7-alpine `892bb215…` the day before that, 1.27-alpine at the audit, 1.30-alpine from T2, `1.31-alpine` floating from #813, which no build or `up` ever pulled again) | 1.31.8-alpine-slim, its index pushed 2026-10-24 19:51 UTC to add riscv64 over the amd64 and arm64 images pushed 2026-10-22 01:50 UTC; 1.31.8 itself: four bug fixes and one change (changes.xml, 2026-10-21) on Alpine 3.24.3, which fixes the two high CVEs 1.31.7's image carries on 3.24.2 (libexpat CVE-2026-77214, libx11 CVE-2026-88806); 1.31.7 (2026-10-14) fixed five: CVE-2026-15176, CVE-2026-93479, CVE-2026-95101, CVE-2026-97629 and CVE-2026-97205 | current | Dependabot `docker` for the Dockerfile; `www.yml` by hand after it, and the pin watch (0146 T8) says when the two differ | **T2** took 1.30-alpine, the stable line; #813 moved the web image to 1.31 the same morning and the line is mainline since, because Dependabot cannot express "stable" (the odd minor is always the higher version); `www.yml` follows; -alpine-slim since 2026-10-25 (0146 T12a), because nothing here loads what -alpine adds and the scan counts it |
| `postgres` (self-host) | `deploy/selfhost/postgres/Dockerfile`'s FROM, built as `localhost/postgres:<tag>-<hash>` by `deploy/selfhost/compose.yml` since 0146 T15b (#1719, merged 2026-10-28, `fb0fea2e`: gosu removed, started as uid 70; `pull_policy: never`, built only where the name is missing) | 18.6-alpine by digest `77f58511…` (Dependabot's move of 2026-09-24 to a rebuild of the tag; `d3e1620b…` from T2, digest `9a8afca5…` = 18.4-alpine with no tag at the audit) | 18.6-alpine, rebuilt 2026-10-22 as `898c60cb…`, which the managed stacks pin, and again 2026-10-26 as `10a5c69a…` (inside the three-day floor) | the same release; Dependabot offers the rebuild | Dependabot `docker` on `/deploy/selfhost/postgres` (its own entry, no major; `docker-compose` before T15b, which now ignores `localhost/postgres`), whose PR fails `a-database-started-as-root` until compose.yml's image line moves, and prints the `sed` that moves it | **T2** — a patch upgrades in place; `e2e.yml`'s restart-resume proves it |
| `postgres` (managed ×2, dev) | `deploy/compose/postgres/Dockerfile`'s FROM, built as `localhost/postgres:<tag>-<hash>` by `managed.yml` and `dev.yml` since 0146 T15 (#1717, merged 2026-10-28, `6f9af7f2`: gosu removed, started as uid 70; `pull_policy: never`, built only where the name is missing); the Testcontainers setup starts the same FROM as uid 70; `db-roles.sh` and `stand-up-live.sh` read `managed.yml`'s | 18.6-alpine by digest `898c60cb…` (2026-10-22; `18-alpine` floating before, never pulled by anything, §4) | 18.6 (2026-08-13); 18.7 is due 2026-11-12 | current | Dependabot's PR on the Dockerfile (its own `docker` entry, no major; #1717's second review), which fails `a-database-started-as-root` until the three image lines move, and prints the `sed` that moves them; or by hand, in its own PR, when the pin watch's summary issue lists a newer 18.x or the image scan counts fixable findings in the digest (0146 T8) | **pinned 2026-10-22** (§4); a minor upgrades in place, a major (`pg_upgrade`) is the owner's |
| `edoburu/pgbouncer` | `managed.yml` | v1.26.1-p0 (2026-10-21, for the three CVEs this stack's `pgbouncer.ini` is open to from v1.25.2, and a fourth it probably is not; v1.24.1-p1 at the audit, v1.25.2-p0 from T2) | v1.26.1-p0 (2026-10-19), index `488422e3…`, no git tag upstream | current | by hand, in its own PR, when the pin watch's summary issue says it is behind (0146 T8; Dependabot reads no file in `deploy/compose`) | **T2** — stateless; the managed gate proves it |
| `redis` | `managed.yml` | 7.4.12-bookworm by digest `b6b6e3dc…` (2026-10-30, a security release, before its floor under the floor's exception: Status, 2026-10-30); before it 7.4.11-bookworm by digest `44960b31…` (2026-10-22; `7.4-bookworm` floating from 2026-10-21, `7-alpine` on Alpine 3.21 before) | 8.8.2-alpine | one major | owner for a major; a 7.4 patch by hand when the pin watch lists it | **§3** — the licence changed at 7.4, which is the line this is pinned on; 8 *adds* AGPLv3; Valkey is the BSD drop-in. The facts and a recommendation in item 3 |
| `ghcr.io/triggerdotdev/trigger.dev` + `supervisor` | `managed.yml` ×2, `managed.env.example`, every `@trigger.dev/*` in the root, `apps/worker` and `packages/scheduler` `package.json`; since 0146 T16 (#1722, alpha.3) the FROM, by tag and index digest, of `deploy/compose/trigger.dev/Dockerfile` and `deploy/compose/supervisor/Dockerfile`, which `managed.yml` builds as `localhost/trigger.dev` and `localhost/supervisor` without files nothing here runs (depot's and esbuild's binaries, the copy of pnpm the service's user does not run, and since the owner's decision of 2026-10-27 the tar in the copy it does run: 8 criticals to 2, 2 to 0) | v4.8.1 (2026-10-25; v4.7.6 from 2026-10-23, v4.7.2 before it, v4.5.12 at the audit) | v4.8.1 (2026-10-23) | current | `trigger-version.sh` only, which moves the two FROMs and the builds' names too (0146 T16), never their `read_at`: a move reads the Dockerfiles again at the new release, and its pull request's `build (trigger, amd64|arm64)` is green before any window; the pin watch keeps an issue open while a newer tag is in both images (0146 T8), and fails while a FROM is not the pin. Back to an older version: the checkout that pinned it, never a `pin` backwards | **§3, pinned** — one way (at v4.7.6: twelve Prisma migrations and ClickHouse 049 to 054; v4.8.1 adds none; the status block); the gate run in the owner's window applies it, not the merge. Dependabot told to leave every `@trigger.dev/*` alone, and it reads no file in `deploy/compose` |
| `triggerdotdev/node` (24-bookworm-build) | `apps/worker/trigger.config.ts` (`TASK_BUILD_IMAGE`, the tasks' build stage; 0146 T14, #1716) | by digest `34a3f455…`, trigger.dev 4.8.1's `BUILD_IMAGE['node-24']` (pushed 2026-10-22) | what the pinned CLI names | none while they agree | by hand, with each Trigger.dev move, read from the new CLI's `deploy/buildImage.js` (the Status entry of 2026-10-26) | not shipped: only `node_modules` and `index.json` leave the stage, so a stale one still builds |
| `clickhouse/clickhouse-server` | `managed.yml` | 26.2.19.43 by digest | — | — | by hand, with Trigger.dev; the pin watch keeps an issue open while it differs from what Trigger.dev's own compose pins (0146 T8) | stays: pinned to what Trigger.dev's own compose pins, on purpose (`managed-bring-up.md`); 26.2 is out of ClickHouse's support, **accepted for the Alpha** (§3 item 9) |
| `registry` | `managed.yml` | 3.1.2 (2026-10-21; 3.1.1 from #825) | 3.1.2 (2026-09-29) | current | by hand for patches and minors, when the pin watch's summary issue says (0146 T8); a major stays the owner's | **§3, taken** — the "configuration rewrite" did not reach a service that mounts no config file |
| `haproxy` (the Docker socket proxy's base; `tecnativa/docker-socket-proxy:v0.5.0` itself until 2026-10-30) | `deploy/compose/docker-socket-proxy/Dockerfile`'s FROM, built as `localhost/docker-socket-proxy:<tag>-<hash>` by `managed.yml` (`trigger-docker-proxy`) since 2026-10-30: upstream's v0.5.0 Dockerfile, `haproxy.cfg` and entrypoint byte for byte (commit `2e118a0c`), the base the only change; `pull_policy: never`, built only where the name is missing | 3.4.7-alpine by index digest `2caaf8b1…` (pushed 2026-10-24 17:56 UTC, Alpine 3.24.3, taken 2026-10-30; 0 critical and 0 high built, Security Scan run 41012325563); before it upstream's image, built once on 2026-07-27 on 3.4.2-alpine (Alpine 3.24.1), 0 critical and 6 high on 2026-10-29 | 3.4.7 (2026-10-24); docker-socket-proxy v0.5.0 (2026-07-27) | current | Dependabot `docker`, its own entry, for 3.4 patches and digests; a docker-socket-proxy release by hand, when the pin watch's summary issue lists it (against upstream's tags) | another HAProxy line (3.5, 3.6) is the owner's, taken with a docker-socket-proxy release; Dependabot ignores HAProxy's minors and majors |
| `chainguard/minio` (0146 T7, #1692; `bitnamilegacy/minio` 2025.5.24-debian-12-r5 until alpha.2) | `managed.yml` (`minio`, `minio-init`) | `latest` by index digest `268d68a2…` (built 2026-10-25, pushed as `latest` 14:29 UTC, taken 2026-10-28: the fork's RELEASE.2026-10-23T20-06-51Z; `d88920d6…`, its RELEASE.2026-09-22T19-25-18Z, from #1692) | `latest` `e70b2b1e…` (pushed 2026-10-27) | three rebuilds since (pushed 2026-10-26 17:11, 2026-10-27 01:51 and 21:51 UTC), none yet three days old | by hand when the pin watch says `latest` was rebuilt, once three days old (0146 T8) | **§3, taken 2026-10-23** — Chainguard's maintained build replaced the frozen Bitnami image in alpha.2 (item 5) |
| `caddy` | `managed.yml` | 2.11.7-alpine by digest `eb4d35b7…` (2026-10-22; `2-alpine` floating before, never pulled, 2.11.4 when recorded) | 2.11.7 | current | by hand, in its own PR, when the pin watch lists a newer 2.x or the image scan counts fixable findings | **pinned 2026-10-22** (§4); a major is the owner's. The move from 2.11.4 crosses the breaking changes 2.11.6 lists (in the code since 2.11.5): request headers capped at 16 KiB (431 above it), one-minute idle read and write timeouts, header names with a `.` dropped. Checked against `trigger-tls.Caddyfile` (`default_sni`, `tls internal`, `reverse_proxy trigger-api:3000` over HTTP), which sets none of them; the path to watch after the nightly is the dashboard over the mesh |
| `ghcr.io/zitadel/zitadel` | `managed.yml` | v4.19.2 (2026-09-28, the patch after v4.19.1, whose three security fixes are in nothing this stack switches on; v4.19.1 before, #1285, for GHSA-4hgj-wm6c-q7p2) | v4.19.2 | current | owner; releases and advisories watched, and the pin watch keeps its issue (#1643) open while the pin is behind the newest release (0135 T7, 0146 T8) | **§3, taken** — migrates its schema on boot on the persistent stack, so the gate run in the owner's window applies it |
| `busybox` | `managed.yml`; `smoke-managed.sh`, `bootstrap-managed.sh`, `setup-zitadel.sh`, `idp-strays.sh`; one test pins the printed command | 1.38, floating (T2; 1.37 at the audit), the one float `a-float-nothing-ever-pulled` names, with its reason | 1.38 (1.38.0) | current | by hand, the compose line and the scripts together; the pin watch says when either is behind (0146 T8) | **T2** |
| `ghcr.io/twin/gatus` | `managed.yml` | v5.38.0 (2026-10-30, a day before its floor under the security-fix exception: Status, 2026-10-29 and 2026-10-30; before it v5.37.0 from 2026-10-21) | v5.38.0 (2026-10-28) | current | by hand, when the pin watch's summary issue says (0146 T8) | — |
| `axllent/mailpit` | `managed.yml` | v1.32.0 by digest (2026-10-25, for CVE-2026-111943 in v1.31.6's Go, 0146 T11 (a); v1.31.6 from 2026-10-21, v1.31.1 from T2) | v1.32.0 (2026-10-22), digest `0790692b…` | current | by hand, when the pin watch's summary issue says (0146 T8) | **T2** — a mail catcher for the gate |
| `nextcloud` | `managed.yml`, `dev.yml`, the Testcontainers setup | 35.0.2-apache by digest `e0b1a2af…`, upstream's rebuild of 2026-10-28 (Docker Hub push 16:51 UTC) on Debian's snapshot of 2026-10-27, with `libbrotli1` 1.1.0-2+deb13u1 for the critical CVE-2026-111497, taken 2026-10-30, a day before its floor, under the security-fix exception (Status, 2026-10-29 and 2026-10-30); before it `89af7ee7…` since 2026-10-28 (T5; #1720, `3d2f129e`, the owner's OK of 2026-10-26 for alpha.3; the OTA volume upgraded by E2E (managed) run 40774398411); before it 34.0.5-apache by digest `1f9212ad…` (2026-10-25, upstream's rebuild of 2026-10-23 with `session.upload_progress.enabled=0`, PHP's mitigation for CVE-2026-115560; `9dbdc711…` from 2026-10-22, `34-apache` floating before, never pulled) | 35.0.2 (2026-10-15) on PHP 8.5.12; 35.0.3 due 2026-11-12 | current | by hand, in its own PR, when the pin watch lists a newer 35.x (34.x before the move) or the image scan counts fixable findings; its branch E2E only when it is ready to merge, merged before the next nightly | **pinned 2026-10-22** (§4); a fixture and a demo target; a major is the owner's. One way: the image upgrades the demo's volume and its database and refuses an older image on them, so a bad move is fixed forward or put back from a copy taken before it (`managed-bring-up.md`, *Updating a running deployment* and *A Nextcloud major on the OTA stack*) |
| `nextcloud` (the second major) | `.github/workflows/nextcloud-second-major.yml` `NEXTCLOUD_IMAGE` (2026-10-25, T5) | 34.0.5-apache by digest `1f9212ad…` (PHP 8.5.12) since 2026-10-28, flipped in the pull request that moved the demo (T5; #1720, `3d2f129e`, after E2E (managed) run 40774398411 upgraded the OTA volume); before it 35.0.2-apache by digest `89af7ee7…` from 2026-10-26, 35.0.1 from 2026-10-25 | 34.0.5; 34.0.6 due 2026-11-12 | current | by hand; the pin watch reads no workflow file (§4) | a CI fixture: the other major customers may run (35 while the demo ran 34, 34 since), never deployed |
| `ghcr.io/robbes/ownpace-selfhost` | `deploy/selfhost/compose.yml` | `edge` | ours | — | `images.yml` | — |

Ignored by name in the new Dependabot entries, so that a green tick cannot make these
decisions: the two Trigger.dev images and Zitadel (one way), ClickHouse and the object
store (deliberate pins), and the majors of `postgres`, `redis`, `registry`, `nextcloud`
and `caddy`; and since 2026-10-30 HAProxy's minors and majors in the Docker socket proxy's
entry, because its line is the one the docker-socket-proxy release chose.

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
pnpm 11.28.9 (11.22.0 at the audit), moved by hand: Dependabot never touches `packageManager`,
so a bump is the newest pnpm 11 that is three days old (`latest-11` once it is), then
`pnpm install` to show the lockfile unchanged. PostgreSQL 18 on both stacks; PGlite (npm) current. Prisma current.

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
   **2026-10-26: asked again after the scan triage, and the answer is the same: stay on 7.4.**
   The owner's word: *"Stay on Redis 7.4"*. Measured with Trivy 0.76.1 on 2026-10-25, on
   arm64 and amd64: `7.4.11-bookworm` (this pin) reads 1 critical and 57 high, none with a
   Debian fix (the critical is zlib's minizip, which `zlib1g` does not ship and Redis does not
   use; 48 of the highs are six util-linux CVEs counted once per package); `7.4.11-alpine`
   reads 0/0 but runs on Alpine 3.21, whose support ends on 2026-11-01, the reason the stack
   left it; `8.10.2-alpine` reads 0/0 and `8.10.2-trixie` 0/43, both a one-way major under
   the licence above. Redis is reachable on the compose network only. The revisit trigger
   is unchanged.
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
   after the launch. Live takes it from the tag that carries it (alpha.2, which live runs since
   the owner's deploy, checklist T21–T25), after the drain that deploy needs anyway, on a store
   that starts empty.
   Live has had no testers on alpha.1, so what it loses is nothing a tester sent.

   **Built 2026-10-24, on branch `claude/ownpace-public-readiness-y7orc6-object-store-swap`;
   merged 2026-10-25 as #1692, in alpha.2; the digest moved to `268d68a2…` on 2026-10-28
   (Status).** What it does, each point read off the image or upstream rather than assumed:
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
   the same digest, in `docker/docker-compose.yml` at v4.7.2, v4.7.6, v4.7.7 and v4.8.1 (`26.2` in
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


10. **Hardened images (Docker Hardened Images, Chainguard, distroless) — NOT NOW, 2026-10-26.**
    The owner asked whether the stacks already run hardened images. They do in one place:
    `chainguard/minio` since #1692 (0146 T7). The API's distroless runtime is #1709, which
    the owner moved into alpha.3 the same day; it merged 2026-10-28 (`b13d303e`). Everything
    else runs the official or upstream image, trimmed by the drafts then queued (no gosu, no npm
    or corepack, slim variants), merged 2026-10-28 too. A survey
    on 2026-10-26 compared every image the stacks run with Docker Hardened Images (DHI), free
    under Apache 2.0 since 2025-12-17, with Chainguard's free tier (`latest` only) and with
    distroless. It read Docker's docs source, the DHI catalog's definitions and Docker Hub's
    catalog pages, and scanned the Docker Hub candidates with Trivy 0.76.1 on linux/arm64.
    `dhi.io` itself could not be reached from the session, so no DHI image was pulled or
    scanned here; Docker Scout's counts are Docker's.

    - **Every DHI pull needs `docker login dhi.io`**: on the OTA box, on live, in CI (a
      Dependabot secret too, since Dependabot's pull requests get no others), and on every
      self-hoster's machine for the appliance, unless the image is republished.
    - **Postgres cannot simply switch.** DHI keeps data in `18/data` where ours is
      `18/docker`, so it would start an empty cluster on our volumes. Most hardened Postgres
      images run glibc, and ours is Alpine (musl). Measured with the official `18.6-trixie`
      (glibc 2.41) on data made under musl: no warning at start, then amcheck reports an order
      violation, primary keys accept duplicates, and REINDEX fails once they exist. A move is a
      dump and restore in a window. `scripts/a-database-started-as-root.unit.test.ts` (0146
      T15) already holds both Postgres builds to the official `-alpine` image.
    - **Redis.** DHI offers 7.4 only as 7.4.12 on Debian 13, with an end of life of
      2026-11-30; Chainguard's free Redis is 8.x (AGPLv3). Item 3 stands.
    - **Where DHI would help:** Caddy, the registry and Redis, by Docker Scout's counts (not
      reproduced). Each would also need its volume chowned to uid 65532.

    **The owner's decision: not now.** No `dhi.io` credential on the boxes or in CI before the
    Alpha. The queued drafts already bring this repository's own images to 0 critical.
    **Revisit** after the Alpha, starting with Caddy and the registry; and whenever a DHI image
    would clear a critical that no other move can.

## 4. Not done, honestly

- **The floating tags are pinned, 2026-10-22.** `postgres:18-alpine`, `redis:7.4-bookworm`
  (`redis:7-alpine` until 2026-10-21, §3 item 3), `caddy:2-alpine`, `nextcloud:34-apache` and
  `nginx:1.31-alpine` were to move on every `docker compose pull`, within their line, and
  nothing ever ran one: Compose pulls only an image the machine does not have, and the web
  image was built with `up --build` and no `--pull`. So both stacks, both sites and the web
  image ran whatever copy the machine pulled first. This bullet said the bring-up records what
  it pulled; nothing did. Each is pinned now by its exact version and index digest, in
  `managed.yml`, `dev.yml`, `www.yml`, `apps/web/Dockerfile` and the Testcontainers setup,
  moves by a pull request that E2E (managed) proves on its branch, and reaches live in a
  release tag. The pin watch lists a newer tag, the weekly image scan counts what a rebuild
  under the same tag would fix, and Dependabot moves the web image's FROM, which `www.yml`
  follows. The majors stay the owner's. `busybox:1.38` is the one float left, named with its
  reason in `scripts/a-float-nothing-ever-pulled.unit.test.ts`, which refuses a new one.
- **The second Nextcloud major's pin is moved by hand** (T5): nothing watches
  `nextcloud-second-major.yml`'s `NEXTCLOUD_IMAGE`. A row in the pin watch reading it is the
  follow-up, once the open pull requests that change `scripts/idp-pin-watch.mjs` have merged.
  Since the flip (T5, in the pull request that moved the demo) the leg names 34.0.5 and the
  compose files 35, so the pin watch reads 35 and 34.0.6 (due 2026-11-12) is nobody's to report
  until that row exists.
- **ClickHouse** is not checked against anything but Trigger.dev's own compose, and that
  is by design; the version that rejected a migration is the reason it is pinned at all. That
  pin, 26.2, has been out of ClickHouse's support since 2026-05-21: accepted for the Alpha, with
  its revisit triggers (§3 item 9).
- **Whether Dependabot reads `${TRIGGER_IMAGE_TAG:-v4.5.12}`** correctly is not tested here;
  those two lines are ignored by name, so the answer does not matter for them.
- **The three actions behind by a patch or a minor** are left to Monday's group rather than
  moved tonight: the group's PR exists precisely so that they arrive together, once.
