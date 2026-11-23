# Workplan 0166 — The code scanning list, read and cleared

> **In one line:** The 253 open code scanning alerts rebuilt from the uploads that make them (Trivy's image scans, one category per image, Trivy's repository scan and Semgrep), counted per category and severity, with what alpha.14 can fix, what waits on upstream, what is accepted and what only the owner can dismiss.

## Status — 2026-11-23 (update this block at the end of every session)

**2026-11-23: an outside, read-only check of `5b51a82b`, read on `main` at `db37bf49`. Docs only:
nothing moved, and why.** On `claude/ownpace-public-readiness-y7orc6-dockerfiles` (T9). The
Trigger.dev files it named (`deploy/compose/trigger.dev`, `supervisor`, `docker-socket-proxy`,
`redis`, `caddy`, `apps/worker/task-image`) are not read here: they go with Trigger.dev's removal
for alpha.18, on another branch.
- **The Stalwart base (high), `packages/testing/fixtures/stalwart/Dockerfile:8`: still there, and
  the pin cannot move to a fix.** Security Scan run 45149289024 (its report job, 137607804040)
  reads `stalwartlabs/stalwart:v1.1.1` at 0 critical and 110 high, 57 of them with a fix, all in
  Debian 13.7: krb5's four (`libgssapi-krb5-2`, `libk5crypto3`, `libkrb5-3`, `libkrb5support0`)
  at 1.21.3-5+deb13u1, 14 findings each (CVE-2026-71199, CVE-2026-71200, CVE-2026-107364,
  CVE-2026-112315 and 10 more), fixed in +deb13u2; and `zlib1g` 1:1.3.dfsg+really1.3.1-1+b1,
  CVE-2026-85091, fixed in -1+deb13u1. Read the same day:
  - Docker Hub's tag list: v1.1.1 is still the newest release, and still the index `5ebdf474…`
    pushed 2026-11-16 at 11:47:29 UTC, as `v1`, `v1.1` and `latest` are. No patch release after
    it and no rebuild of it, so ADR-0022's move has no tag to move to, the owner's waiver of
    2026-11-23 notwithstanding. The release cadence since v1.0.0 (2026-10-26) has been about one a
    week (v1.0.1, v1.0.2, v1.0.3, v1.1.0, v1.1.1).
  - The image itself, the linux/amd64 layers of `5ebdf474…` (`544760db…`), each blob checked
    against its digest, nothing run: Debian 13.7, krb5 at 1.21.3-5+deb13u1 and zlib1g at
    1:1.3.dfsg+really1.3.1-1+b1, as the scan says.
  - The other variant of the same release, `v1.1.1-alpine` (`53ce86ed…`, linux/amd64
    `75f72758…` layers read the same way): Alpine 3.24.4, no krb5 at all, and zlib 1.3.2-r1,
    the build Alpine fixed CVE-2026-85091 in (the pgbouncer Dockerfile's header). It is another
    base (musl), so it is not a move ADR-0022 allows without the owner, and the two-phase run,
    `stalwart-cli` and E2E (self-hosted) would have to be proved on it first.
  - The image is test-only: the integration tests, E2E (self-hosted) and the OTA demo start it,
    live never does, and its findings go to the scan's report, not to code scanning (§2).
  - **The fixture Dockerfile is dead code, and removing it does not close this.** Nothing builds
    it (its own header); the image the tests start is the same pin, by `setup-stalwart.sh` and
    `testcontainers-setup.ts`. Taking it out is a separate cleanup: the fix doc's "Moving the pin"
    list, `scripts/idp-pin-watch.mjs`'s copies, and the guards `a-fixture-that-named-no-user`,
    `a-float-nothing-ever-pulled` and `a-dockerfile-that-ends-as-root` name it. Not done here.
  - **What closes it:** Stalwart's next v1.x release, or a rebuild of v1.1.1, on a Debian with
    krb5 +deb13u2 and zlib1g +deb13u1, moved by ADR-0022's procedure; the pin watch's Stalwart
    row lists the tag. Taken inside its three-day floor for alpha.18 under the owner's words of
    2026-11-23: *"ill waive the waiting for alpha 18, also the 3day limit for LCM, so we could
    take newer verrsion more early."* Or, on the owner's decision, `v1.1.1-alpine` now.
- **The Dockerfile rules (low), hadolint 2.15.1**, the image `hadolint.yml` pins, read from
  Docker Hub by its index digest `32dac941…` (linux/amd64 `fdf19d02…`, its one layer
  `83cf56c1…`, each checked against its digest) and run as `/bin/hadolint`, with hadolint's
  defaults and again with `.hadolint.yaml`:
  - `deploy/compose/goaccess/Dockerfile`: DL3018 at lines 52 and 86 (`apk add --no-cache`
    without versions), with the defaults only; nothing with the repository's config.
  - `deploy/compose/pgbouncer/Dockerfile`: DL3066 (info) at line 148 (`USER root`) and line 178
    (`USER postgres`), with either.
  - `deploy/compose/postgres/Dockerfile`: nothing, with either.
  - **No rule fires on a file as a whole.** With DL3057 (`HEALTHCHECK` missing, off by default in
    hadolint) switched on, it fires on every stage's FROM: goaccess lines 51 and 85, pgbouncer
    142, postgres 86. That is the likeliest reading of the check's three file-level findings, and
    none of the three images has a HEALTHCHECK.
- **Why none of them changes,** each the repository's own decision, written down where it was
  taken:
  - **DL3018, unpinned apk (goaccess).** The owner's answer of 2026-11-19 (`.hadolint.yaml`):
    every base is pinned by digest, the weekly image scan reports a package behind its fix, and
    an exact version stops the next fresh build the day Alpine drops it from its mirror. Pinning
    would need a watch that moves the pins, as `a-rebuild-upstream-has-not-made` and the libxml2
    RUN show for the two builds that pin one on purpose, each with its way out. **Advice: keep
    the decision**; GoAccess is the visit count's batch tool, and an exact pin there buys a build
    that breaks on Alpine's schedule for nothing the scan does not already say.
  - **DL3066, a named USER (pgbouncer).** The file is temporary by design: it exists until
    upstream's image carries the five Alpine fixes (its header's THE WAY OUT), and then goes
    whole. Until then `images.yml`'s `build (pgbouncer, …)` holds the built image's `User` to
    upstream's, `postgres`, string for string, the second RUN proves `postgres` is uid 70, and
    the job proves process 1 runs as uid 70. `USER 70:70` would turn that equality into a
    translation the job and `a-rebuild-upstream-has-not-made` would have to learn, and rename
    the image, for an info-level rule on a file that is meant to go. `USER root` cannot go: apk
    needs root. **Advice: keep it**; `a-dockerfile-that-ends-as-root`'s EXCEPTIONS already fail
    once the names become numbers and the exception stays, so nothing more is needed to hold it.
  - **DL3057, no HEALTHCHECK (all three).** `a-dockerfile-that-ends-as-root`'s header: compose
    gives each service its probe, or none on purpose. `managed.yml` probes postgres
    (`pg_isready`) and pgbouncer (`psql … SHOW POOLS`, which needs the password the image does
    not have), and compose's healthcheck replaces an image's. GoAccess runs once and exits, so a
    probe means nothing. An image HEALTHCHECK in the Postgres build would also rename both
    Postgres images (the guard holds the appliance's copy to the same instructions), so every
    stack would rebuild and restart its databases, for a probe no stack reads. **Advice: keep the
    decision.**
- **No new check,** since nothing was fixed: the guards above hold the state as decided.

**2026-11-21, last: the branch image scans of T3 and T4, and two findings §1 does not have.**
- **T3** (#2015, Security Scan run 44932855500 on its branch): `postgres-managed` and
  `postgres-selfhost` read 0 critical and 0 high; CVE-2026-86144 is gone from both.
- **T4** (#2016, Security Scan run 44932858060 on its branch): the four `libpam*` findings are gone
  from `redis` (1/11 to 1/7) and `trigger.dev` (1/14 to 1/10), and nothing was added.
- **T5's condition:** run 44932855500 scanned `trigger.dev` at v4.8.8 without the PAM purge, and
  its 15 findings are the v4.8.5 scan's, effect 3.21.2's CVE-2026-121707 among them, as
  v4.8.8's lockfile says (the Status entry of 2026-11-21, after the answers: T5).
- **New since §1, in both runs and not in run 44878860013:** the vulnerability database moved.
  Read from the report job of run 44932855500 (136933963788):
  - `stdlib` CVE-2026-97054 (high) in `gatus` (Go 1.27.3, fixed in 1.27.4), `zitadel` (1.26.10,
    fixed in 1.26.11), `caddy` (1.27.3, fixed in 1.27.4) and `registry` (1.26.8, its `stdlib`
    line now fixed in 1.26.11). A fix exists, in Go; each binary is upstream's, so each closes
    with an upstream release or rebuild on that Go, the §3 B trigger each already has. Caddy's
    build here keeps upstream's binary, so it is the same.
  - `libssl3t64` 3.5.7-1~deb13u3 (high) in `ownpace-api-edge`, `ownpace-api-release`,
    `trigger-task-base`, `ownpace-selfhost-edge` and `ownpace-selfhost-release` (and the
    test-only `nextcloud` and `stalwart`). The report lists it under *no fix yet*: Debian 13 has no
    fixed `libssl3t64`, so a rebuild on today's Debian takes nothing, and nothing changes for
    alpha.14. It goes to §3 B, its trigger Debian's fix, which a rebuild of each image then takes.
  - Neither is in code scanning on `main` yet: `main`'s next image scan (the weekly run of
    2026-11-23) uploads them, 4 and 5 alerts by the counting of §1.2.

**2026-11-21, later still: T1 and T7, the list read and the five dismissed, by the owner.**
- **T1, the count.** The owner read the open list on 2026-11-21: 46 open after the first two
  dismissals, so 48 before them, one fewer than the 49 of §1.2. The total after all five was not
  read; 43 is what the arithmetic gives, not a count.
- **T7, the dismissals,** made by the owner between about 17:32 and 17:50 UTC, each with the reason
  §3 D gives:
  - #1679 (`trivy-image-trigger.dev`) and #1760 (`trivy-image-redis`), CVE-2023-45853 in `zlib1g`,
    as *Won't fix*: minizip is not in `zlib1g`, and nothing in the image uses it;
  - Semgrep's `path-join-resolve-traversal` (`apps/worker/src/index.ts`),
    `unknown-value-with-script-tag` (`apps/api/src/routes/migrations/google-consent.ts`) and
    `js-open-redirect-from-function` (`apps/web/src/pages/Billing.tsx`), as *False positive*, with
    0163 §4.3's reasons and #1990's.
- **Left of Semgrep:** one alert, #1919, `gcm-no-tag-length` in the Cirrux test fake, which #2014
  (T2) fixes. So Semgrep had 4 before the dismissals, as §1.6 says, and the one alert missing from
  the 49 is a Trivy one.
- **Which one, from the uploads.** No upload after §1's could have closed it. After the image scan
  of Security Scan run 44878860013 (07:08 UTC) no run on `main` scanned the images: the runs on
  `main` since were pushes (44880510965 to 44933026519), which upload the repository scan, 617
  bytes and no result, and Semgrep, 4 spots from 16:06 UTC. So the image categories held what
  run 44878860013 sent. The likeliest reading is one alert where §1.2 counts two findings: in
  `trivy-image-registry`, CVE-2026-78669 is in two packages of the same binary, `bin/registry`'s
  `golang.org/x/net` and its Go `stdlib` (§1.4). The report counts 8 findings with 7 distinct
  ids there, and code scanning keeps one alert per rule and location. That was not read on the
  list; the registry's category there shows 7 alerts if it holds. Whether two findings with one
  id are one alert depends on the location Trivy's SARIF gives each, which was not read here; in
  the Debian images the four PAM packages are four alerts (#1864 to #1867).
- **§1.2, read with that:** 44 Trivy alerts and 4 Semgrep, 48, not 45 and 4.

**2026-11-21, after the answers: T5, effect 3.22.4 in the Trigger.dev webapp, built (D2).** On
`claude/ownpace-public-readiness-y7orc6-effect-swap`, from `main` at `66138ba9`.
- **v4.8.8's lockfile, read first.** Upstream's `pnpm-lock.yaml` at v4.8.8 resolves effect 3.21.2
  alone (its override `effect@>=3 <3.20.0` to ^3.20.0), linked by the webapp (`^3.21.2`),
  `@trigger.dev/schema-to-json` 4.8.8 (`^3`) and `@prisma/config` 6.14.0 and 6.19.0. So D2's swap
  applies.
- **Which release.** 3.22.4, published 2026-10-22 20:49 UTC: in every range above, past its
  floor, and the release this build swapped in until v4.8.5. 3.22.5, npm's newest 3.x, was
  published 2026-11-19 21:22 UTC, inside its three-day floor, so not it. Both tarballs read by
  their integrity: the same main, module, types, dependencies and 179 exports, and 7 files more
  (`internal/stackTraceLimit`). 3.22.4's tree is the one pinned for it before (`b7d6b7cb…`),
  which checks the reading.
- **What changed.** The webapp's Dockerfile has the swap-table RUN it had until v4.8.5, after
  the undici relink and before the purge, with one row, and a header section with its way out.
  Its name moves to `…:v4.8.8}-c8ebb4044c16`.
- **The guard.** `a-binary-the-stack-never-runs` holds the RUN to `EFFECT` (`effectProblems`,
  ported from the guard of the table until v4.8.5), checks the floor, and runs the RUN over a
  stand-in store with a stand-in registry: it swaps, fetches that one tarball and loads from
  each requirer, and stops with nothing changed on the pinned trees, another release where 3.21.2
  was, another requirer, a wrong sha512, a registry that does not answer, a tarball that is gone
  and a bundled copy. Taking the sha512 check out of the RUN fails it three ways.
- **Owed before the merge:** the image scan on the branch (`trigger.dev`) and E2E (managed).

**2026-11-21, after the answers: T3, libxml2 2.13.9-r3 in both Postgres builds, built (D3), merged as #2015 on 2026-11-21 (`6e9c1d04`).**
On `claude/ownpace-public-readiness-y7orc6-postgres-libxml2`, from `main` at `6afa68cd`.
- **What changed.** `deploy/compose/postgres/Dockerfile` and `deploy/selfhost/postgres/Dockerfile`
  gain one RUN, word for word the same in both: it reads libxml2's version from
  `/lib/apk/db/installed`, stops unless the base carries 2.13.9-r2, runs `apk add --no-cache
  libxml2=2.13.9-r3`, and stops unless the version is then 2.13.9-r3. The builds' name is
  `localhost/postgres:18.7-alpine-6adabb723757` now, in `managed.yml`, `dev.yml` and the
  appliance's `compose.yml`.
- **How it goes.** Once the base carries -r3 or later (a rebuild of the tag, or the next
  PostgreSQL release Dependabot offers), the first check stops the build. The RUN and its comment
  are then deleted in both Dockerfiles, the names move by the `sed` the guard prints, and the four
  documents go back to *Docker Hub alone*. Alpine's mirror keeps only a package's newest build,
  so a newer libxml2 there also stops a fresh build: the same way out, or a newer exact version.
- **The guard.** `a-database-started-as-root` already admitted an exact-version `apk add`. It
  now holds the Dockerfile to that one package at that version, and to both checks, read from
  apk's database. Four mutations each fail it: the check before removed, the check after removed,
  another version, and another file read. All 22 tests pass.
- **Docs.** The self-host quickstart (the first start, and a new troubleshooting entry),
  `docs/testing.md`, `deploy/selfhost/README.md` and `docs/managed-bring-up.md` say the build
  takes libxml2 from Alpine's mirror.
- **Proved before the merge.** The image scan on the branch (Security Scan run 44932855500, on
  `df5e42fb`): `postgres-managed` and `postgres-selfhost` read 0 critical and 0 high, CVE-2026-86144
  gone from both and nothing added. E2E (managed) run 44936647689 and E2E (self-hosted, on
  Postgres) run 44938011033 passed, and CI run 44936646316 with Images run 44936646343 on the head
  that merged, `d5de7b8c`.

**2026-11-21, after the answers: T4, PAM out of the Redis and Trigger.dev webapp builds, built
(D1), merged as #2016 on 2026-11-21 (`2d249b3c`).** On `claude/ownpace-public-readiness-y7orc6-pam-purge`, from `main` at `6afa68cd`.
- **What depends on the four.** Read as text from the images' dpkg status on 2026-11-21:
  Redis's fourth layer (`sha256:1b21ec79…`, linux/arm64), Debian 12.15's base layer
  (`sha256:2d66c782…`, the first of both images) and `node:24.22.3-bookworm-slim`'s fourth, which
  is the webapp's fourth. In each, libpam0g, libpam-modules, libpam-modules-bin and
  libpam-runtime are depended on only by each other, util-linux (already purged), `login` and
  `passwd`; `passwd` only by `adduser`, and `adduser` only by `apt` (already purged). So seven go:
  the four, `login` (Essential), `passwd` and `adduser`. Their purge scripts remove their own
  configuration with `rm`, `rmdir`, debconf and `dpkg-maintscript-helper`, which stay.
- **What links them.** Every ELF file of the base layer (693) and of Redis's fourth (9) and of
  Node's layers (one more, `node`), read as bytes: only files of the seven and util-linux's `su`
  and `runuser` name `libpam.so.0`, `libpam_misc.so.0` or `libpamc.so.0`. Nothing execs a
  program of the seven into either container (`redis-cli` and `find` into Redis; `chown` and
  `test` into the webapp). The webapp's runner-stage layer is on GHCR's blob host, which this
  session cannot reach; the build's dpkg refusal and its checks read it.
- **What changed.** Both purge RUNs name the twenty packages and the eleven libraries, with the
  same two flags. The checks after the purge (no file of a removed library left, no ELF file
  needing or naming one) cover the three new libraries. The headers say why each may go. Redis's
  name moves to `localhost/redis:7.4.12-bookworm-65e47a4df92f`, the webapp's to
  `…:v4.8.8}-4b33ed9f685b`, both in `managed.yml`.
- **Guards.** `an-essential-nothing-runs` holds both lists, each package's reason and the
  headers' reasons, and refuses the thirteen of before (two new cases) and a list without
  `adduser`. `a-binary-the-stack-never-runs`'s stand-in Debian 12 carries the seven's
  dependencies, `login` as Essential and the three libraries. The scripts unit project passes
  but for `every-release-is-a-starting-point`, which reads local tags this shallow clone lacks.
- **Proved before the merge.** The image scan on the branch (Security Scan run 44932858060, on
  `0a967bc2`): the four libpam packages are gone from `redis` (1 critical and 11 high before, 1
  and 7 after) and from `trigger.dev` (1 and 14 before, 1 and 10 after), and nothing was added.
  E2E (managed) run 44934069888 passed on `656c9787`, with `main` at `2e5d4c8a` merged in,
  from 18:10 to 18:19 UTC. CI run 44935158670 with Images run 44935158695 passed on the head that
  merged, `a385bc6b`.

**2026-11-21, after the answers: T2, the Cirrux test fake's decipher, built, merged as #2014 on
2026-11-21 (`8c24f286`).** On
`claude/ownpace-public-readiness-y7orc6-cirrux-fake-tag-length`, from `main` at `58e10d96`.
- **What changed.** `decryptCxdrv2` in `packages/connectors/src/__testing__/cirrux-fake.ts` calls
  `createDecipheriv('aes-256-gcm', p.key, iv, { authTagLength: 16 })`, as #1985 did in
  `secrets.ts`. Its length check before stays.
- **Tests.** `cirrux-drive-format.unit.test.ts` has a new case: a tag cut four bytes short is
  refused, and the fake's one `createDecipheriv` names the length. Taking the option out fails it.
  The other 22 cases pass unchanged.
- **The alert** (`gcm-no-tag-length`, Semgrep) closes at the first Semgrep upload from `main`
  after the merge.
- **Proved before the merge:** CI run 44933122412 on `ca5b978b`, with `main` at `2e5d4c8a`
  merged in. CI only: it changes test code and builds no image.
- **After the merge.** `main`'s Semgrep run 44935053956 on `8c24f286` (18:22 UTC) uploaded 3 spots,
  the three the owner dismissed, and no `gcm-no-tag-length`, so code scanning should close #1919
  as fixed. Not read on the list.

**2026-11-21, later: the owner's answers, all as advised.** Asked D1 to D5 (§4), the owner
answered at about 16:52 UTC: *"D1 yes, D2 yes, D3 pin, D4 yes, D5 keep it"*. So:
- **D1, yes:** the four `libpam*` packages are purged in the Redis and Trigger.dev webapp builds
  (T4).
- **D2, yes:** v4.8.8's lockfile is read first, and effect is swapped only if it still resolves
  3.21.2 (T5).
- **D3, the pin:** an exact `apk add` of `libxml2` 2.13.9-r3 in both Postgres builds (T3).
- **D4, yes:** the owner dismisses the five alerts of §3 D in the UI (T7).
- **D5, keep it:** 0119 §3 item 10 stands; no hardened bases for this.

**2026-11-21: read and planned. Docs only; nothing was built until the owner answered §4.** On
`claude/ownpace-public-readiness-y7orc6-code-scanning-plan`, from `main` at `2448f0a8`.
- **How the list was read.** The code scanning REST API answers 403 to the integration this
  session uses, so the list was rebuilt from the three steps that upload SARIF (§1.1) and the
  newest run of each on `main`: the image scan's report job of Security Scan run 44878860013
  (a dispatch on `main` at `45dfead1`, 07:08 UTC), the repository scan of Security Scan run
  44922596764 (a push of `2448f0a8`, 16:05 UTC) and Semgrep run 44922596746 (the same push).
- **The count.** 45 image findings in 8 of the 23 image categories that upload, 0 in the
  repository scan, and 208 Semgrep spots before 16:06 UTC: **253**, the owner's number.
  The image findings are 2 critical and 43 high.
- **Semgrep's upload after #2006 has run.** Semgrep run 44922596746 on `2448f0a8` uploaded 4 spots
  at 16:06 UTC and kept 204 under the two ReDoS rules in its job summary. Code scanning should
  close those 204 as fixed, so **49 alerts should be open now**: 45 image findings and 4
  Semgrep spots. That was not read here (the API refuses it); T1 checks it on the list.
- **No stale category is left.** The three test-only images' categories stopped on 2026-11-03,
  and the owner dismissed their 294 alerts and deleted their configurations that day (0119
  Status, 2026-11-03). Every other category uploaded in the run above (§2).
- **What alpha.14 can fix** (§3 A): 12 of the 49, if the owner says yes to D1 to D3. **What needs
  the owner:** D1 to D5 (§4), and 5 dismissals in the UI (§3 D).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The decisions | owner | ✅ **Decided 2026-11-21** (D1 to D5, as advised) | §4. The owner's answer is quoted in the Status entry of 2026-11-21, later. |
| T1 Read the list after Semgrep's upload | owner | ✅ **Read 2026-11-21**: 48 open, not 49 (the Status entry of 2026-11-21, later still) | Security, Code scanning, open alerts: about 49 expected (45 Trivy, 4 Semgrep). A number far from 49 means a category this plan does not know of: name it and it is added to §1. |
| T2 The Cirrux test fake's decipher | builder | ✅ **Merged** as #2014 on 2026-11-21 (`8c24f286`) (0163 T4; the Status entry of 2026-11-21, after the answers) | `authTagLength` on `createDecipheriv` in `packages/connectors/src/__testing__/cirrux-fake.ts:135`, as #1985 did for `secrets.ts`. Closes Semgrep's `gcm-no-tag-length` at the next push to `main`. |
| T3 libxml2 in both Postgres builds | builder | ✅ **Merged** as #2015 on 2026-11-21 (`6e9c1d04`) (D3: the pin; the Status entry of 2026-11-21, after the answers: T3) | CVE-2026-86144, 2.13.9-r2 → -r3, in `trivy-image-postgres-managed` and `trivy-image-postgres-selfhost`. |
| T4 PAM out of the Redis and Trigger.dev webapp builds | builder | ✅ **Merged** as #2016 on 2026-11-21 (`2d249b3c`) (D1: yes; the Status entry of 2026-11-21, after the answers: T4) | The four `libpam*` packages, 8 alerts. Read first which installed packages depend on them. |
| T5 effect in the Trigger.dev webapp | builder | 🔨 **Built 2026-11-21** (D2: yes; the Status entry of 2026-11-21, after the answers: T5) | CVE-2026-121707 in effect 3.21.2, fixed in 3.22.1. Read v4.8.8's lockfile and Monday's scan first, and whether anything passes request input to `deepmerge-ts` (§3 C). |
| T6 Monday's scan, read into §1 | builder | 📋 **Planned** | The weekly run of 2026-11-23 is the first image scan of the v4.8.8 builds (`trigger.dev`, `supervisor`). Update §1's counts, and §3 if a row moves. |
| T7 The owner's dismissals | owner | ✅ **Done 2026-11-21** (D4), the five of §3 D, 17:32 to 17:50 UTC | The 5 alerts of §3 D, each with its reason. |
| T8 What waits on upstream | builder | 📋 **Planned** | §3 B: each trigger is a row of the pin watch or a release to read. Nothing to build until one fires. |
| T9 The outside check of 2026-11-23 | builder | ✅ **Read 2026-11-23**, nothing moved (the Status entry of 2026-11-23) | The Stalwart base's krb5 and zlib1g wait for Stalwart's next v1.x release (or `v1.1.1-alpine`, the owner's call); the Dockerfile rules stand as decided. The Trigger.dev files go with its removal. |

## 1. The inventory

### 1.1 What uploads SARIF

Three steps upload to code scanning. No other workflow does (`grep sarif .github/workflows`):

| Upload | Workflow and job | Category | When it runs on `main` | Newest run on `main` |
|---|---|---|---|---|
| Trivy, the repository (`scan-type: fs`, HIGH and CRITICAL) | `security-scan.yml`, `security-scan` | none set, so code scanning's default for the workflow and job | every push, the weekly schedule, every dispatch | 44922596764, 2026-11-21 16:05, `2448f0a8` |
| Trivy, each image (`scan-type: image`, HIGH and CRITICAL, `scanners: vuln`) | `security-scan.yml`, `image-scan` (a matrix) | `trivy-image-<name>`, one per image, test-only images not uploaded | the weekly schedule (Monday 06:00 UTC) and a dispatch with `image_scans` on | 44878860013, 2026-11-21 07:08, `45dfead1` (a dispatch) |
| Semgrep, the eight named rules | `semgrep.yml`, `semgrep` | none set, so the default for the workflow and job | every push | 44922596746, 2026-11-21 16:05, `2448f0a8` |

A pull request's runs also upload the repository scan, under the pull request's own ref; those
alerts are not in `main`'s list. Release's two dispatches pass `image_scans: false` and upload the
repository scan alone, on a tag or a `release-gate/` branch.

### 1.2 Counts per category and severity

| Category | Image (tier) | Critical | High | Total | With a fix |
|---|---|---|---|---|---|
| `trivy-image-trigger.dev` | the Trigger.dev webapp, `localhost/trigger.dev:v4.8.5-f7b52b1d2670` (production-internal) | 1 | 14 | 15 | 3 |
| `trivy-image-redis` | `localhost/redis:7.4.12-bookworm-d5301e0623d4` (production-internal) | 1 | 11 | 12 | 0 |
| `trivy-image-registry` | `registry:3.1.2` (production-internal) | 0 | 8 | 8 | 8 |
| `trivy-image-gatus` | `ghcr.io/twin/gatus:v5.38.0` (production-public) | 0 | 5 | 5 | 5 |
| `trivy-image-caddy` | `localhost/caddy:2.11.9-alpine-9c1f752119a3` (production-internal) | 0 | 2 | 2 | 1 |
| `trivy-image-zitadel` | `ghcr.io/zitadel/zitadel:v4.20.4` (production-public) | 0 | 1 | 1 | 1 |
| `trivy-image-postgres-managed` | `localhost/postgres:18.7-alpine-2d3b1894d8f1` (production-internal) | 0 | 1 | 1 | 1 |
| `trivy-image-postgres-selfhost` | the same build, from `deploy/selfhost/postgres` (shipped) | 0 | 1 | 1 | 1 |
| 15 other image categories | nginx, pgbouncer, clickhouse-server, docker-socket-proxy, supervisor, minio, busybox, goaccess, trigger-task-base, and Ownpace's api, web and selfhost at `:edge` and `0.2.0-alpha.13` | 0 | 0 | 0 | 0 |
| Trivy, the repository | the checkout | 0 | 0 | 0 | — |
| **Trivy, in all** | | **2** | **43** | **45** | **20** |
| Semgrep, before 16:06 UTC | `detect-non-literal-regexp` 185, `detect-redos` 19, the six that may block 4 | | | 208 | |
| **Before Semgrep's upload of 16:06** | | | | **253** | |
| Semgrep, after it | the six that may block | | | 4 | |
| **Expected open now** | | | | **49** | |

The image counts are the report job's of run 44878860013, which counts one finding per
package and advisory, as code scanning makes one alert per package (the four PAM packages are
alerts #1864 to #1867 in `trigger.dev`). The repository scan wrote 617 bytes of SARIF, which is
the shape of a run with no results. Semgrep's counts are its job's own lines. Semgrep's spots
have no CVSS-style severity here; code scanning shows them by the rule's level, which the job
log does not carry.

### 1.3 `trivy-image-trigger.dev` and `trivy-image-redis`: Debian 12.15, the same 12 in both

Both run on Debian 12.15 (upstream's `node:24.22.3-bookworm-slim` runner stage for the webapp,
`redis:7.4.12-bookworm` for Redis), and both builds already purge the thirteen packages nothing
runs (0119 §3 item 11; the header of each Dockerfile). What is left is the same in both:

| Package | Installed | Advisory | Severity | Fixed | Where it comes from, and why it stays |
|---|---|---|---|---|---|
| `zlib1g` | 1:1.2.13.dfsg-1 | CVE-2023-45853 (minizip's `zipOpenNewFileInZip4_6`; #1679, #1760) | critical | none | the base; dpkg needs it. minizip is not in `zlib1g`, and neither Redis nor the webapp uses it |
| `zlib1g` | 1:1.2.13.dfsg-1 | the `gz_vacate()` heap overflow (#1742); its id is not in the job summary | high | none | as above |
| `gzip` | 1.12-1 | the LZH finding (#1627); id not in the job summary | high | none | Essential |
| `libacl1` | 2.3.1-3 | the symlink traversal (#1628); id not in the job summary | high | none | coreutils, sed and tar need it |
| `libtinfo6`, `ncurses-base`, `ncurses-bin` | 6.4-4 | the ncurses buffer overflow (#1649, #1663, #1664 in `trigger.dev`); id not in the job summary | high, one each | none | bash needs `libtinfo6`; the other two are Essential |
| `perl-base` | 5.36.0-7+deb12u4 | the Archive-Tar DoS (#1666) | high | none | Essential; Redis's build runs its checks with it |
| `libpam0g`, `libpam-modules`, `libpam-modules-bin`, `libpam-runtime` | 1.5.2-6+deb12u2 | linux-pam's directory traversal (#1864 to #1867 in `trigger.dev`, #1860 to #1863 in `redis`) | high, one each | none | the base; new since the scan of 2026-11-19 (0146 T16) |

That is 1 critical and 11 high in each: 12. The report job names the package, version and worst
severity of a finding with no fix, and not its id; the ids named above are those 0119 and the
Dockerfiles record, and the alert numbers are the owner's screenshot's. The webapp has three more,
each with a fix, in its JavaScript:

| Package | Installed | Advisory | Severity | Fixed | Where it comes from |
|---|---|---|---|---|---|
| `effect` | 3.21.2 | CVE-2026-121707 (ReDoS in `Schema.TemplateLiteral`; #1875) | high | 3.22.1 | upstream's lockfile at v4.8.5, under its own override `effect ^3.20.0`, which resolves 3.21.2 alone |
| `deepmerge-ts` | 7.1.5 | CVE-2026-40345 (stack exhaustion; #757) | high | 8.0.0 | `@prisma/config`'s (0119, 0146 T16), which the Prisma CLI loads; only the next major fixes it |
| `turbo-stream` | 2.4.1 | CVE-2026-34077 (the react-router DoS and XSS; #813) | high | 3.0.0 | an exact pin of `@remix-run/react` and `server-runtime` 2.17.5; only the next major fixes it |

The scan read v4.8.5's builds. `main` builds v4.8.8 since #2009 (`c27eb47f`, 15:47 UTC), and no
image scan has read it yet. Its lockfile resolves `turbo-stream` 2.4.1 and `deepmerge-ts` 7.1.5
as v4.8.5's did (the webapp's Dockerfile, *WHAT STAYS*); `effect` at v4.8.8 was not read.

### 1.4 The Go binaries: `registry`, `gatus`, `caddy`, `zitadel`

| Category | Package | Installed | Advisory | Severity | Fixed |
|---|---|---|---|---|---|
| `trivy-image-registry` (`bin/registry`) | `github.com/go-jose/go-jose/v4` | v4.1.4 | CVE-2026-116587 | high | 4.1.6 |
| | `github.com/klauspost/compress` | v1.18.4 | CVE-2026-63209 | high | 1.18.7 |
| | `golang.org/x/net` | v0.59.0 | CVE-2026-78661, CVE-2026-78669 | high, 2 | 0.62.0 |
| | `stdlib` | v1.26.8 | CVE-2026-78667, CVE-2026-78669, CVE-2026-97031, CVE-2026-111943 | high, 4 | 1.26.10 |
| `trivy-image-gatus` (`gatus`) | `github.com/go-jose/go-jose/v4` | v4.1.4 | CVE-2026-116587 | high | 4.1.6 |
| | `github.com/klauspost/compress` | v1.18.6 | CVE-2026-63209 | high | 1.18.7 |
| | `golang.org/x/image` | v0.40.0 | CVE-2026-46603 | high | 0.45.0 |
| | `golang.org/x/net` | v0.58.0 | CVE-2026-78661, CVE-2026-78669 | high, 2 | 0.62.0 |
| `trivy-image-caddy` (`usr/bin/caddy`) | `golang.org/x/net` | v0.60.0 | CVE-2026-78661 (the `x/net/html` DoS; #1750) | high | 0.62.0 |
| | `github.com/go-jose/go-jose/v3` | v3.0.5 | the JWKS DoS (#1682); id not in the job summary | high | none |
| `trivy-image-zitadel` (`app/zitadel`) | `golang.org/x/net` | v0.61.0 | CVE-2026-78661 | high | 0.62.0 |

Each is in the upstream binary: none of these images is built from source here (Caddy's build
removes curl and keeps upstream's binary).

### 1.5 `trivy-image-postgres-managed` and `trivy-image-postgres-selfhost`

| Package | Installed | Advisory | Severity | Fixed | Where it comes from |
|---|---|---|---|---|---|
| `libxml2` | 2.13.9-r2 | CVE-2026-86144 (the `parseFlags` finding; #2084, opened 2026-11-21) | high | 2.13.9-r3 | `postgres:18.7-alpine`'s Alpine 3.24.4, which PostgreSQL links for its `xml` type |

### 1.6 Semgrep

Before 16:06 UTC, 208 alerts: 185 under `detect-non-literal-regexp` and 19 under `detect-redos`,
the two rules that never block (0163 D3), and 4 under the six that may. Since the upload of
16:06 only the 4 are sent, with every rule listed, so code scanning should close the 204:

| Rule | Spot | 0163's reading |
|---|---|---|
| `path-join-resolve-traversal` | `apps/worker/src/index.ts:92` | known: the worker CLI's own `--config` (§4.3) |
| `unknown-value-with-script-tag` | `apps/api/src/routes/migrations/google-consent.ts:834` | known: the value goes through `jsString` (§4.3) |
| `js-open-redirect-from-function` | `apps/web/src/pages/Billing.tsx:770` | to read: safe since #1990, which follows only an `https:` address on Mollie's host; the rule does not take `checkoutToFollow` for a check |
| `gcm-no-tag-length` | `packages/connectors/src/__testing__/cirrux-fake.ts:135` | to read: the Cirrux test server's decipher wants `authTagLength` (0163 T4) |

### 1.7 What could not be accounted for

- **The list itself.** Not read: the counts are rebuilt, not read off code scanning. That they
  add to the owner's 253 exactly is the check; T1 is the second one.
- **The ids of the no-fix Debian findings** but CVE-2023-45853, and of go-jose v3's: the report job
  names package, version and severity only, and the scan's JSON artifacts could not be downloaded
  from this session (the artifact host answered 403). The alert pages carry them.
- **Semgrep's severities** as code scanning shows them.
- **Whether v4.8.8's builds read the same.** T6.

## 2. Stale categories

A category whose uploads stop keeps its alerts open: code scanning closes an alert only when a
newer analysis of the same category no longer finds it.

| Category | Stopped | State | How it closes |
|---|---|---|---|
| `trivy-image-nextcloud`, `trivy-image-stalwart`, `trivy-image-mailpit` | 2026-11-03, when test-only images left code scanning (#1800) | closed: the owner dismissed 294 alerts as *used in tests* (245 and 49; Mailpit had none) and deleted the three configurations on the tool status page | done |
| `trigger-task-base`'s old findings under `library/node` | 2026-11-06, when the leg moved from building the deploy's `base` stage to pulling the prebuilt base | not stale: the category is the same, so its first upload of the prebuilt base closed them | done |
| Semgrep's 204 under the two ReDoS rules | not stopped: the same category, its rules kept whole | should be closed since 16:06 UTC | T1 checks it |

Every other image category uploaded in run 44878860013, and the image list has had the same 26
names in every image run since the first, on 2026-10-22 (runs 39809564949, 40174770235,
40321430984, 41465604476, 42642704967, 43890128363 and 44878860013). So nothing else is stale.
A category goes stale again when an image's name changes (0119's note above `image-list` says
when): its configuration is then deleted by hand on the tool status page, in the same pull
request's follow-up.

## 3. The plan

### A. Fix for alpha.14

| What | Alerts | The change | Decision |
|---|---|---|---|
| The Cirrux test fake's decipher | 1 (Semgrep `gcm-no-tag-length`) | `authTagLength: 16` on its `createDecipheriv`, as #1985 did in `secrets.ts`; closes at the next push to `main` | 0163 T4, already planned |
| libxml2 in both Postgres builds | 2 | an `apk add --no-cache libxml2=2.13.9-r3` RUN in `deploy/compose/postgres/Dockerfile` and `deploy/selfhost/postgres/Dockerfile`, as the RUN of 2026-10-31 to 2026-11-13 took Alpine's updates; or Docker Hub's rebuild of `18.7-alpine`, its digest moved | D3 |
| PAM out of Redis and the webapp | 8 | the four `libpam*` packages added to each build's purge, with whatever depends on them only if nothing runs it | D1 |
| effect in the webapp | 1 | if v4.8.8 still resolves 3.21.2: the build replaces its files with 3.22.x by the sha512 npm published, as it did for effect 3.17.1 until v4.8.5 | D2 |

That is 12 of the 49.

### B. Wait for upstream

| What | Alerts | Trigger |
|---|---|---|
| `registry` 3.1.2: go-jose v4, compress, x/net, Go 1.26.8 | 8 | a release or a Docker Hub rebuild of `registry:3.1.2` built past them; the pin watch lists a new tag or digest |
| `gatus` v5.38.0: go-jose v4, compress, x/image, x/net | 5 | a gatus release past v5.38.0; the pin watch's row |
| `caddy` 2.11.9: x/net v0.60.0 | 1 | a Caddy release on x/net 0.62.0 or later; Dependabot or the pin watch |
| `caddy` 2.11.9: go-jose v3 v3.0.5 | 1 | a go-jose v3 fix, or Caddy dropping v3 (the Caddy Dockerfile's note) |
| `zitadel` v4.20.4: x/net v0.61.0 | 1 | a release on x/net 0.62.0. v4.20.5, which issue #1934 offers, still names x/net v0.61.0 in its `go.mod` (read 2026-11-21) |
| `turbo-stream` 2.4.1 and `deepmerge-ts` 7.1.5 in the webapp | 2 | a Trigger.dev release that leaves Remix 2's exact pin and `@prisma/config`'s; asked upstream in triggerdotdev/trigger.dev#5084 |
| The Debian 12 findings with no fix in both Debian images | 16 (8 each), 2 of them dismissed in D | a Debian fix, which a rebuild of the base takes; or the base leaving Debian 12 (Redis: 0119 §3 item 3's revisit; the webapp: upstream's runner stage) |

### C. Accept, with the reason

The 16 Debian findings of B stay open and accepted until then: no fix exists, the builds already
purge what nothing runs, and what stays is something that stays needs (zlib1g for dpkg, libacl1
for coreutils, libtinfo6 for bash, the rest Essential). `deepmerge-ts` is accepted on the same
footing while T5 reads the webapp: it is `@prisma/config`'s, which merges the Prisma
configuration in the image; if T5 finds it reached by request input, it moves to A. Nothing in C is dismissed: an accepted alert left open closes by itself when its
fix ships, and stays visible until then.

### D. Only the owner can dismiss these, in the UI

| Rule | Package or spot | Category | Reason to give |
|---|---|---|---|
| CVE-2023-45853 | `zlib1g` 1:1.2.13.dfsg-1 | `trivy-image-trigger.dev` | *Won't fix*: minizip is not in `zlib1g`, and nothing in the image uses it |
| CVE-2023-45853 | `zlib1g` 1:1.2.13.dfsg-1 | `trivy-image-redis` | the same |
| `path-join-resolve-traversal` | `apps/worker/src/index.ts:92` | Semgrep | *False positive*: the path is the worker CLI's own `--config` (0163 §4.3) |
| `unknown-value-with-script-tag` | `apps/api/src/routes/migrations/google-consent.ts:834` | Semgrep | *False positive*: the value goes through `jsString` (0163 §4.3) |
| `js-open-redirect-from-function` | `apps/web/src/pages/Billing.tsx:770` | Semgrep | *False positive*: the address is followed only when it is `https:` on Mollie's host (#1990) |

With A and D done, 32 stay open, all in B: 14 Debian findings and 18 in upstream binaries and
packages.

## 4. Decisions for the owner

- **D1** (✅ **decided 2026-11-21: yes**, as advised). **PAM out of Redis and the Trigger.dev webapp, for alpha.14?** The four `libpam*` packages
  are new findings with no fix, 8 alerts. Nothing in either container logs anyone in or changes a
  password. Purging them takes the same two force flags the builds already use, and whatever
  depends on them in the base (to read: expected `login` and `passwd`) goes too, or the build
  stops on dpkg's refusal. **Advice: yes**, with the same proof as the purge of 2026-11-08: the
  build's own checks, the branch's image scan and E2E (managed); if it is not green before
  alpha.14's fold, alpha.15.
- **D2** (✅ **decided 2026-11-21: yes**, as advised). **effect in the webapp.** **Advice:** read v4.8.8's lockfile first (T5); if it still resolves
  3.21.2, swap it for 3.22.x by its sha512 in the build, for alpha.14, as was done until v4.8.5,
  with the guard's row and its way out when upstream's override moves.
- **D3** (✅ **decided 2026-11-21: the exact `apk add`**, as advised). **libxml2 in both Postgres builds: an exact `apk add` now, or wait for Docker Hub's
  rebuild?** Either one changes the builds' names, so each stack rebuilds and restarts its
  databases at its next bring-up. **Advice: the `apk add` for alpha.14**, the guard already
  admits it at an exact version, and it goes when the base carries -r3.
- **D4** (✅ **decided 2026-11-21: yes**, as advised). **The 5 dismissals of §3 D.** **Advice: yes, all five**, with the reasons given. What C
  accepts stays open.
- **D5** (✅ **decided 2026-11-21: keep it**, as advised). **No hardened bases for this.** DHI for Caddy, the registry and Redis would clear most of B,
  and 0119 §3 item 10 said not now, with its revisit after the Alpha. **Advice: keep that
  decision**; this list does not change it.

## 5. Tasks

The task table in the Status block is the list: T0 the decisions, T1 the count after Semgrep's upload, T2 to
T5 the fixes of §3 A, T6 Monday's scan, T7 the dismissals and T8 the wait list. Each fix is its
own pull request, with its image scan on the branch (a dispatch the owner makes) and, for an image
of `managed.yml`, E2E (managed).

## 6. What was read

- `.github/workflows/security-scan.yml` and `semgrep.yml`, every `upload-sarif` step and its
  category.
- Security Scan runs 44878860013 (the image scan report job, 136770230691) and 44922596764 (the
  repository scan job, 136901667193); Semgrep run 44922596746 (job 136901666643); the image
  scan jobs of runs 39809564949, 40174770235, 40321430984, 41465604476, 42642704967 and
  43890128363 for the names.
- Workplan 0119 §3 items 3, 10, 11 and 14 and its Status of 2026-11-03; 0146 T16 through the
  webapp's Dockerfile (*WHAT STAYS*, *WHAT UPSTREAM NOW SHIPS FIXED*); 0163's Status, §4.3 and T4.
- `deploy/compose/trigger.dev`, `supervisor`, `redis`, `postgres` and `caddy` Dockerfiles.
- The pin watch's open issues #1671, #1934 and #1935, and Zitadel's `go.mod` at v4.20.4 and
  v4.20.5.
