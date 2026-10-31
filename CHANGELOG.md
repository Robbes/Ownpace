# Changelog

All notable changes are documented here (Keep a Changelog format; SemVer once released).

## [Unreleased]

### Security

- **The Trigger.dev dashboard's TLS front is built here without curl**
  (workplan 0119): `caddy:2.11.7-alpine`, Caddy's newest release, carries
  curl, which its upstream adds and nothing on this stack runs, and curl's
  libraries carried the image's one critical finding (brotli-libs) and two of
  its highs (curl and libcurl). `deploy/compose/caddy` builds the same image,
  at the same digest, with curl and the eight libraries only curl needed
  removed, where Trivy reads 0 critical and 7 high instead of 1 and 9; the 7
  are in Caddy's own binary and wait for a Caddy release. Caddy, its
  configuration and its certificate are unchanged.
- **Both Postgres builds take Alpine's brotli-libs 1.2.1-r0 and libcurl
  8.23.0-r0, which clears their critical** (workplan 0119): with gosu gone,
  `postgres:18.6-alpine` still read 1 critical and 1 high, CVE-2026-111497
  in brotli's decoder and CVE-2026-92392 in libcurl's HTTP/2 uploads, and no
  digest of the tag fixes them before 18.7. One RUN in each Dockerfile takes
  exactly those two versions from Alpine's signed repository and refuses
  anything else, so the scan reads 0 and 0; only libpq-oauth links libcurl,
  and nothing here connects with OAuth. Both builds also move to upstream's
  rebuild of 2026-10-26 (`10a5c69a…`) and share the name
  `localhost/postgres:18.6-alpine-1af6bb314e8d`, so every Postgres, the
  appliance's too, is rebuilt and restarted once. **Building these images
  now needs Alpine's mirror, `dl-cdn.alpinelinux.org`, as well as Docker
  Hub**: the box's next `up`, and an appliance's first `up` after the
  update. The RUN is temporary, until PostgreSQL 18.7 (due about
  2026-11-12) carries both fixes. Alpine serves only the newest build of a
  package, so once it moves either one, a machine without the image can no
  longer build this release's database: the build then says so, and tells an
  appliance's operator to update Ownpace to its newest release (the
  self-host quickstart's Troubleshooting).
- **Trigger.dev's object store runs Chainguard's MinIO build of 2026-10-29,
  taken before its three-day floor as a security fix** (workplan 0119, 0146
  T7): the image scan of 2026-10-31 found a high in the build before it,
  whose server links go-jose 4.1.4, and Wolfi's rebuild moves go-jose to 4.1.6
  for CVE-2026-116587 (GHSA-mgcc-cww5-fp2q), where a JWK with degenerate RSA
  parameters could make parsing use excessive CPU. It is the same MinIO
  release at the same commit, with Go modules moved and no source changed,
  golang.org/x/net 0.62.0 among them. Nothing a stack sets changes; the next
  bring-up pulls it, and the data volume carries over.

### Changed

- **Trigger.dev is v4.8.3, taken before its three-day floor on the owner's
  waiver** (workplan 0119, issue #1738): *"I waive the wait for v4.8.3, just
  go with it"* (2026-10-31). It skips v4.8.2. The webapp and the supervisor
  are still built here without the files nothing runs, now on v4.8.3, and the
  tasks deploy with CLI 4.8.3. It is one way: six Prisma migrations and two
  ClickHouse ones, which drop a search table and its view this stack never
  filled. A stack whose `.env` sets `TRIGGER_IMAGE_TAG` sets `v4.8.3` there
  first, with no run executing and after the backup, or its bring-up stops at
  the `trigger` phase. A new `trigger.dev login` is started with
  `--no-browser`, as the bring-up and `deploy-tasks.sh` now print it: without
  it, CLI 4.8.3 on a machine that can open a browser takes the approval on its
  own `127.0.0.1`, which a browser on another machine cannot reach.
- **Live's deploy refuses a host on its reachable-hosts list, and Mollie's key
  during the Alpha** (workplans 0136 T2 and 0131 §3 T3, #1752): `deploy-live.sh`
  refuses live's settings, in the deploy and its dry run, while
  `OWNPACE_REACHABLE_HOSTS` names a host, whatever the stage, and while
  `MOLLIE_API_KEY` is set and the stage is the Alpha, each read as the app
  reads it. Mollie's live key goes in with the switch that ends the Alpha
  (`docs/ending-the-alpha.md`, step 4). Both refusals first apply at the
  deploy after the one that moves live onto this release: `deploy-live.sh`
  runs its copy from before the checkout moves.

### Added

- **The outside probe asks whether anybody can found an organisation at live's
  sign-in service** (workplan 0135 T1, the ask 0132 T3 records): every dispatch
  of *Exposure probe* asks `https://id.ownpace.eu/ui/login/register/org`
  without following a redirect, and fails unless it answers 404, the answer
  once `disallowPublicOrgRegistration` holds. A 2xx is the form served; a
  redirect is not the refusal, and is named by its host, never its query;
  NetBird's own page fails whatever its status; any other status, and no
  answer at all, fail, as the discovery document's do. No dispatch input or
  repository variable makes it a note. The smoke asks the same page on the OTA
  instance every night and never runs on live, so a Zitadel upgrade or a
  setting that served the form again on live went unseen until now.

### Added

- **The nightly managed gate proves that copying a meeting the target account
  organises itself invites nobody** (workplan 0141 T9 (b), the organiser
  canary): each fresh set now carries an event 3 organised by the demo target
  account's own address, dated next January, with the canary attendee. There
  the target's server is the organiser's, so without `SCHEDULE-AGENT=CLIENT`
  the sync's PUT would invite the attendee; event 1's silence held whatever the
  writer did, because its organiser is a third party. The take-back is not
  re-proved by it: its DELETE sends `Schedule-Reply: F`, which alone keeps
  Nextcloud from sending a CANCEL (0103 T5). The demo bring-up gives
  `tenant-b-target` an address, the seeder refuses before writing when the
  target has none, when the source shares it, or when either account's
  addresses cannot be read, and the smoke reads the copy and asks the target's
  server whether it matches its organiser.

### Fixed

- **follow-redirects 1.16.2 closes a third high advisory** (GHSA-mrwp-f3q8-3g9p,
  workplan 0119): a `sensitiveHeaders` array made in another realm was
  discarded, so custom credential headers could follow a redirect to another
  host. The override's floor moves from 1.16.1 to 1.16.2 (published
  2026-10-25, past the three-day cooldown), whose one change is that check. Its
  one copy sits under the web app's axios, whose browser build leaves it out
  of the bundle; the advisory gate had refused `main` and every pull request
  on it since 2026-10-31.

## [0.2.0-alpha.3] - 2026-10-30

A tester's grant mail now opens registration with the address it was sent to
already filled in, and a share press that meets Nextcloud's limit on new shares
stops there and says when to apply again. Underneath, most of what runs moved.
The managed API runs on a distroless Debian 13 image with production
dependencies only, and nothing execs a shell into it; the web image and the
public site run nginx 1.31.8-alpine-slim; both databases, and the appliance's,
start as PostgreSQL's own user. Trigger.dev moves to v4.8.1, with its webapp
and supervisor built here without the files nothing runs and its tasks on the
API image's own base; its object store runs Chainguard's MinIO build of
2026-10-25 and its queues Redis 7.4.12. The demo Nextcloud moves to 35.0.2, and
the status page to Gatus v5.38.0. The webapp built here carries dompurify
3.4.17, the Docker socket proxy is built here on HAProxy 3.4.7, and the public
site names each page's full address and its other language's, and lists its
pages in llms.txt. Live proves an update by itself, a deploy no longer waits
without end on a compose step, and the weekly image scan names every critical
finding. Live's deploy from alpha.2 takes two runs of the deploy script, and
keeps the copy taken before it until the task runner has run real work.

### Security

- **The Docker socket proxy is built here, on a current HAProxy** (workplan 0119):
  `tecnativa/docker-socket-proxy:v0.5.0` was built once, on 2026-07-27, on HAProxy 3.4.2 and
  Alpine 3.24.1, and the image scan of 2026-10-29 found 6 high findings in it, all fixed in
  newer Alpine packages, with no newer release to move to. `deploy/compose/docker-socket-proxy`
  builds upstream's v0.5.0, its configuration and entrypoint byte for byte, on
  `haproxy:3.4.7-alpine` (Alpine 3.24.3), where the scan reads 0 critical and 0 high. What the
  Trigger.dev supervisor may ask Docker, and what it may not, is unchanged.
- **The api, selfhost and web images build on Debian 13, and the api and
  selfhost images carry no package manager** (workplan 0146 T12, #1708): the
  three built `FROM node:24.22.1-slim`, which is Debian 12, where Trivy read
  1 critical and 61 high findings. `node:24.22.1-trixie-slim`, Debian 13.7,
  reads 0 and 48, and its Node is the same binary, byte for byte. The api and
  selfhost runtime stages also remove npm, npx, corepack, pnpm and yarn,
  which nothing in either container runs; npm's bundled packages were 5 of
  the highs, so the base under both reads 0 critical and 43 high, none of
  which Debian has fixed. The managed tasks build on the same image
  (workplan 0146 T14, #1716, in this release too). Nothing a stack sets
  changes.
- **The managed API runs on a distroless image** (workplan 0146 T13,
  #1709): its runtime is `gcr.io/distroless/nodejs24-debian13:nonroot` by
  digest, Debian 13.7 with Node and fourteen packages and no shell, where
  Trivy reads 0 critical and 0 high on amd64 and arm64, against 0 and 43 on
  the Debian 13 Node image under it before. The Node is the same binary, and
  the managed tasks keep building on the Node image (T14); the smoke stops when the API's Node is not
  the version the tasks get. The container runs as uid 65532 instead of
  10001 and can no longer write its own code, which is root's; it mounts
  nothing. Nothing execs a shell or `printenv` into it: every script and doc
  reads its variables with `docker container inspect` and runs Node by its
  path (T13a, #1710, in this release too). **The live deploy from
  `v0.2.0-alpha.2` or earlier to this release runs `deploy-live.sh` twice**
  (the owner's decision of 2026-10-26). The first run is the older
  checkout's script, which asks with `printenv` and says `NODE_ENV: the api
  container could not be asked`, exit 3, though live has moved to the tag
  and nothing was rolled back. Then `git checkout --
  apps/worker/package.json` and the same `./deploy/compose/deploy-live.sh
  <tag>` again, which reads from Docker and takes (docs/managed-bring-up.md,
  *The deploy from alpha.2 to alpha.3 runs twice*). A deploy from this
  release on runs once. `docker compose … exec api sh` or `printenv` by hand
  no longer works; `/nodejs/bin/node` does.
- **The managed tasks run on the API image's own base, with no package
  manager** (workplan 0146 T14, #1716): a task deploy builds them on the
  image `apps/api/Dockerfile` builds FROM instead of Trigger.dev's
  `triggerdotdev/node:24-bookworm`, so they run that image's Node and
  Debian, which Dependabot moves. They keep dumb-init, Debian's CA store and
  the distrust of the compromised eMudhra roots and intermediates that the
  CLI gives its own images, and lose npm, corepack and yarn, which nothing in
  them runs. On Debian 13 (#1708) the tasks' image reads 0 critical and 43
  high findings, none with a fix, where the one a deploy builds on the CLI's
  v4.8.1 base reads about 1 and 80. The weekly image scan reads the tasks on
  that base too. The first task deploy after this is slow: a new image in
  both build stages, with the Debian archive reachable.
- **The Trigger.dev webapp and supervisor run without files nothing here
  runs** (workplan 0146 T16): both are built on the machine from upstream's
  v4.8.1 images, by tag and digest, without depot's and esbuild's Go binaries,
  without the copy of pnpm their user does not run, and without the tar inside
  the copy it does run (the owner's decision of 2026-10-27: only pnpm's
  bundled node-gyp needs it, to build a native add-on, and nothing in these
  containers installs; such an install there would now fail). Those held 6 of
  the 8 critical findings the image scan read in the webapp on 2026-10-26, and
  both of the supervisor's; the zlib1g and dompurify findings stay until
  Debian and upstream move. The first bring-up after this builds both images
  where the machine lacks them, pulling upstream's from ghcr as before, and
  `.env` needs nothing new: `TRIGGER_IMAGE_TAG` names the version, and must be
  the checkout's (the build refuses another). Both services set
  `COREPACK_ENABLE_NETWORK: "0"`, so a start never fetches pnpm from the npm
  registry. `trigger-version.sh pin` moves the builds with the version; the
  builds refuse a release nobody has read them against, so the pull request
  of a move reads them again and rebuilds them on amd64 and arm64 before the
  window. Rolling back runs the checkout that pinned the older version.
- **Trigger.dev's Redis is 7.4.12, a security release** (workplan 0119):
  `redis:7.4.12-bookworm@sha256:b6b6e3dc…`, upstream's fix for a heap buffer
  overflow when a message over 4 GB is propagated over the cluster bus. This
  stack runs no cluster. Taken a day before its three-day floor, under the
  floor's exception for a security fix. The run queues' file carries over.
- **The demo's Nextcloud is upstream's rebuild of 35.0.2, which clears a critical**
  (workplan 0119 T5): `nextcloud:35.0.2-apache@sha256:e0b1a2af…`, pushed by Docker Hub on
  2026-10-28, carries `libbrotli1` 1.1.0-2+deb13u1 for CVE-2026-111497. Same Nextcloud and PHP,
  so nothing to upgrade on the demo's volume. `managed.yml`, `dev.yml` and the Testcontainers
  default move together. Live runs no Nextcloud.
- **The Trigger.dev webapp built here carries dompurify 3.4.17, which clears
  its last fixable critical** (workplan 0146 T16): the image scan read
  GHSA-cg2g-xh64-v4q7 (critical) and GHSA-mrv2-3pqr-j5jr (high) in dompurify
  3.4.13, under the webapp's `node_modules`. Its build now fetches dompurify
  3.4.17 (published 2026-10-12) from the npm registry, refuses it unless its
  sha512 is the one npm published, and puts its files in place of 3.4.13's. It
  proves that nothing else in the image changed and that both packages that
  require dompurify load the new release. Nothing in this stack loads
  dompurify (the dashboard's PostHog stays off, and its markdown draws no
  diagrams), so no code that runs changes. The webapp's critical findings go
  from 2 to 1: zlib1g, which Debian has not fixed. The first bring-up after
  this builds the webapp's image again, with the npm registry reachable, as the
  API's build needs it already.

### Changed

- **The owner can waive the counted nights in writing, and the release tag
  says so** (workplan 0146, the owner's words of 2026-10-30 for alpha.3). The
  Release workflow takes `waive_nights`, the owner's reason, for a version the
  owner named (alpha.3 only) and from a person's account: the nights'
  refusals become notes that quote it, the commit must be given, and the
  tag's message and the run's summaries say the nights were waived, by whom
  and in what words. The tag job uses it only when the preflight did. Nothing
  else is waived. Before, the only way past the nights was a tag pushed by
  hand, the unordered path that broke alpha.1.
- **pnpm is 11.28.9** (workplan 0119, issues #1694 and #1735, #1701): the
  lockfile is unchanged, and the installs, the images' filtered installs and
  the advisory gate give what 11.28.6 gave. When pnpm next re-resolves the
  tree it also records an optional peer that a package's own dependency
  supplies, and reuses a version the same install already resolved, so the
  next dependency update may move a few lockfile lines it did not ask for.
  11.28.8 differs from 11.28.7 only in the Node.js inside the standalone
  `@pnpm/exe`, which CI and the images do not run. 11.28.9 takes undici
  7.30.1 against a registry response that could crash it
  (GHSA-xjj6-f33q-929c), and sizes its install workers by a container's CPU
  quota.
- **The images are signed with cosign v3.1.4, and the release checks them
  with the same** (#1671, #1702): `images.yml` and `release.yml`'s verify job name
  the release, where cosign-installer's default installed v3.0.6, and the pin
  watch compares it with cosign's newest and holds the two together.
  Signing stays keyless and by digest, and the `cosign verify` line
  `deploy/selfhost/README.md` gives does not change.
- **The weekly image scan names every critical finding, not only how many.**
  Below its table, the run's summary lists each critical one by one: the CVE,
  the package and its version, the version that fixes it or **no fix yet**,
  and where in the image it sits. A count did not say whether a rebuild, a
  newer tag or only upstream could clear it, and code scanning's detail is
  shown only to those with write access.
- **A live deploy judges a Trigger.dev move by its version, not by how its
  image lines are written.** `deploy-live.sh` says whether a deploy is one way
  or reversible, and whether the copy taken before it must hold the task
  runner's database, by comparing the Trigger.dev versions the two releases
  pin. It no longer compares their image lines. The verdicts are unchanged for
  today's lines. It ships with the Trigger.dev images built here, whose lines
  name no upstream image: a deploy is judged by the script that runs before it,
  so live's deploy from alpha.2 says one-way on the Trigger.dev pin, as the
  move from v4.7.6 to v4.8.1 makes it anyway, and every later deploy is judged
  by the version.
- **The site's visit count builds GoAccess 1.12 on Alpine 3.24, because
  upstream's image is on Alpine 3.20, past its end of life** (workplan 0152,
  #1675, #1703): no upstream release has moved off 3.20, and Alpine's own package is
  1.10.2. `site-visits.sh` now builds `deploy/compose/goaccess/Dockerfile`,
  upstream's own at `v1.12` on `alpine:3.24.3` by tag and digest, from the
  commit the tag names and with only the libraries GoAccess loads, as
  `localhost/goaccess:1.12` at the start of each run, and never pulls it. The
  first run after the deploy that brings it builds for a few minutes and needs
  Docker Hub, Alpine's package mirrors and `github.com`; a build that fails
  reads no log and fails the duty `visits`. A pull request that changes that
  directory builds it on an arm64 runner (the new *Images the scripts build*,
  `.github/workflows/script-images.yml`), and Dependabot moves its Alpine pin
  in a pull request of its own, which that build covers. The weekly image scan
  builds it too and scans it under the name it had, `goaccess`, so #1675
  closes on the first scan on `main` that reads it: the scan's report now
  keeps its issues from a run on `main` only, so a scan dispatched on a pull
  request's branch reports what it found and opens or closes no issue. The
  pin watch compares the GoAccess release it builds with upstream's tags, a
  three-part patch release included.
- **The managed stack's databases, Redis, dashboard front and demo Nextcloud,
  and the web image's nginx, run by exact version and digest** (workplan 0119
  §4, #1678): postgres 18.6, redis 7.4.11, caddy 2.11.7, nextcloud 34.0.5
  (35.0.2 since, below) and nginx 1.31.8. They floated within their lines and
  nothing ever pulled them, so each stack ran whatever copy its machine had
  pulled first. The next `up`
  pulls each digest and recreates its service, so each database restarts
  once; the site's nginx moves only when `www.yml` is brought up again.
  The dashboard's front overrides none of Caddy 2.11.7's new defaults: it
  answers 431 to request headers over 16 KiB and closes a connection idle for
  a minute. The demo Nextcloud upgrades its volume to 34.0.5 and refuses an
  older image on it afterwards, and runs with PHP's session upload progress
  off, upstream's mitigation for CVE-2026-115560. `db-roles.sh` runs the
  postgres client `managed.yml` pins. When the bring-up replaces the postgres
  container, it now recreates PgBouncer too: the pooler had cached a login
  that failed while the old server shut down, and refused `app_user` for 15
  seconds (E2E (managed) #285).
- **Both databases of the managed stack start as PostgreSQL's own user, from
  the official image without gosu** (workplan 0146 T15, #1717): the scan's one
  critical and 25 of its 26 high findings in `postgres:18.6-alpine` were the Go
  runtime in gosu, which the image ran only to drop from root to that user.
  Compose builds `deploy/compose/postgres` on the first `up`, and both
  databases restart once; their data needs nothing, being that user's already.
  `docker compose exec postgres` now runs as that user (add `-u 0` for root);
  every script's `psql`, `pg_dump` and `pg_restore` answers as before. Rebuild
  the web or API image by name (`docker compose … build web`, then `up -d
  web`): `up --build` would rebuild the databases' image too and could restart
  them.
- **The self-hosted appliance's database starts as PostgreSQL's own user too,
  from the official image without gosu** (workplan 0146 T15b, #1719): gosu was the
  one critical finding in the appliance's `postgres:18.6-alpine`, and no newer
  digest of the tag drops it. The database's image follows the checkout, not
  the app's image: after updating the checkout (`git pull`, or the release's
  tag), the first `docker compose -f deploy/selfhost/compose.yml up -d` builds
  `deploy/selfhost/postgres` and restarts the database once, on the same base
  and the same data, which is that user's already; nothing else to do. An
  appliance upgraded by `pull app` alone keeps the official image, gosu
  included; the quickstart's upgrade now updates the checkout first. That
  build needs a buildx plugin of 0.17.0 or later where the host has one. A
  data directory bound from the host instead of the named volume must belong
  to uid 70 (`chown -R 70:70`, or the quickstart's `run … chown` under rootless
  Docker) before a new database can start in it. `docker compose exec
  postgres` runs as that user (`-u 0` for root), and the backup's `pg_dump` and
  the restore's `psql` answer as before. The PGlite appliance and the Windows
  appliance run no database server and are unchanged.
- **The web image and the public site run nginx 1.31.8-alpine-slim** (workplan
  0146 T12a, #1707): the same nginx on the same base, without the modules and tools
  the `-alpine` image adds and nothing here loads, 51 packages in all. The
  image scan reads 0 critical and 0 high where `-alpine` reads 1 high
  (brotli-libs, CVE-2026-111497). The site's nginx moves when `www.yml` is
  brought up again.
- **The test stack's mail catcher is Mailpit v1.32.0** (workplan 0146 T11,
  #1699): it closes GHSA-379p-g4f4-hq5h (high), in which an image
  attachment whose EXIF directories point at each other held Mailpit's
  thumbnail endpoint in a loop, a core busy and memory growing until the
  process was killed, and it is built with Go 1.27.3, which fixes
  CVE-2026-111943 in `crypto/x509` that v1.31.6's Go 1.27.2 has. It also
  strips `<base>` and refresh tags from a message's HTML view. The stack's
  exposure to the loop was small: SMTP is reachable only from the stack's
  own services, and the web page and its API only on the address
  `MAILPIT_BIND` names, loopback by default. Its release check is still
  off, read again at v1.32.0. The first start rebuilds one index in the kept
  `mailpit.db`; v1.31.6 still opens that file. Live runs no catcher.
- **The Stalwart the tests and the demo start is v0.16.27** (workplan 0146
  T11 (b), ADR-0022, #1698): the integration tests, the self-hosted
  end-to-end run and the OTA demo run it, live never does. v0.16.10's image
  carried 3 critical and 114 high findings, v0.16.27's carries no critical
  and 47 high, none with a fix. On x86_64 its image needs a CPU with
  x86-64-v2, so a virtual machine with a generic CPU model refuses to start
  it. Its WebUI now comes from release v1.0.11, in recovery mode too, and a
  new database fetches its ASN lists from GitHub instead of jsDelivr. A data
  volume v0.16.10 made works under v0.16.27 and back again. The pin moves
  only on the owner's decision, recorded in ADR-0022, every copy together.
- **Nothing execs a shell or `printenv` into the managed api container any
  more** (workplan 0146 T13a, #1710): the smoke, the managed gate, `deploy-live.sh`,
  `stand-up-live.sh` and the docs read its variables with `docker container
  inspect`, and the smoke runs Node there by its path and stops when that
  Node is not the version the managed tasks get. It works on the Node image
  and on the distroless one this release moves the API to (T13, #1709, the
  owner's decision of 2026-10-26), so every deploy started from this release
  on runs a `deploy-live.sh` that reads it this way; the deploy to this
  release from an older one runs twice (above). Nothing a stack sets changes.
- **Trigger.dev's object store runs Chainguard's MinIO build of 2026-10-25**
  (workplan 0146 T7, #1726): `latest` by the digest it had that day, taken once
  three days old. Its server is the fork's RELEASE.2026-10-23T20-06-51Z, which moves
  nine Go modules, golang.org/x/net, x/crypto and klauspost/compress among
  them, and changes no MinIO code; Trivy reads no finding in it, as in the
  build before. Nothing a stack sets changes; the next bring-up pulls it.
- **Trigger.dev is v4.8.1** (workplan 0119, issue #1668, #1697): the webapp
  and the supervisor run on Node 24.22.1, October's security release, where
  they ran 24.18.0, and the supervisor now distrusts the roots behind the
  compromised eMudhra intermediates and the Sectigo AAA cross-sign, as the
  webapp has since v4.7.6. It carries no database or ClickHouse migration,
  but a stack whose `.env` sets `TRIGGER_IMAGE_TAG` sets `v4.8.1` there
  first, with no run executing and after the backup, or its bring-up stops
  at the `trigger` phase. The tasks build on the API image's own base (T14,
  #1716, in this release too), so the first task deploy after this one is
  the slow one. ClickHouse stays on 26.2,
  which Trigger.dev still pins.
- **The demo, development and integration-test Nextcloud move to 35.0.2**
  (workplan 0119 T5, #1720), by digest, from 34.0.5; the second-major leg moves to
  34.0.5 in their place. Every suite that talks to Nextcloud had passed
  against 35 first. On the OTA stack the move is one way: the first `up`
  upgrades the demo's volume and its database in the stack's Postgres
  (`occ upgrade`), and 34 refuses them afterwards. `docs/managed-bring-up.md`,
  *A Nextcloud major on the OTA stack*, gives the order and the way back, and
  the bring-up stops when the demo Nextcloud answers its healthcheck but is in
  maintenance mode or still owes an upgrade, which the healthcheck cannot
  tell. Live runs no Nextcloud. A developer's `dev.yml` Nextcloud upgrades its
  volume on the next `up`.
- **The outside probe knows a port the front answers by itself** (workplan
  0132 T3 (c), #1730; the owner, 2026-10-29). TCP 5432 answered on both of live's
  front addresses, and a capture on the machine during a probe run showed
  nothing arriving there. The optional repository variable
  `EXPOSURE_PROBE_FRONT_PORTS` lists such ports: on a production name's
  address a listed port answering is a note, once PostgreSQL's SSLRequest
  sent to it gets no PostgreSQL answer; an `S` or `N` back, or a tripwire that
  cannot ask, fails. The machine's own address, and an address only the OTA
  names resolve to, fail on every answer as before; a listed port is tried
  everywhere, and one that stops answering is said, so the list can shrink.
- **The grant mail's link opens registration with the address filled in**
  (workplan 0095 T6; the owner, 2026-10-29). The link ends in `#register=` and
  the address the mail was sent to. Opened from it, the sign-in page offers
  *Create your account* / *Maak uw account aan*, which asks the sign-in
  service for registration (`prompt=create`) with that address (`login_hint`)
  in the page's language (`ui_locales`), and *Sign in* as the second choice.
  The address travels after `#`, which no request carries: it leaves the
  browser only when the button is pressed, to the sign-in service, which logs
  an address that matches no account yet at info (accepted; the comment beside
  privacy §4.5). That service still verifies it with a code before it binds
  anybody. Live's sign-in service fills the field in; where Google is
  offered too (OTA, E2E), it first asks how to register, and the field stays
  empty. Invitations are unchanged. `smoke-managed.sh` reads the registration
  page the link leads to.
- **The status page's Gatus is v5.38.0** (workplan 0119): built with Go 1.27.3
  and gRPC 1.84.0, which clears 7 of the 12 highs the image scan of 2026-10-29
  found in v5.37.0; the other five wait on a Gatus release. The configuration,
  the page and its stored history are unchanged, and the comments that read
  Gatus's source now name the version they were checked at.

### Added

- **Every page of the public site names its own address and its other
  language's in full, and `llms.txt` lists them** (workplan 0152 T5 (c);
  ADR-0029): each page's `<head>` carries a canonical link to its address on
  `https://www.ownpace.eu`, and its hreflang links (English, Dutch and
  `x-default`, the English page the root serves) are absolute where they were
  relative. The 404 page, served at whatever address was wrong, names none.
  The build writes `llms.txt` at the site's root: one line per page per
  language, by the page's own title and description, under *English* and
  *Nederlands*, for every page a visitor reaches from the home page. The
  Alpha's conditions and its guide, which the nav leaves out for the people
  taking part, are left out of it too, and keep their canonical and hreflang
  links. It lists the site's pages only: the links to the maintained
  documentation that ADR-0029 also asks of `llms.txt` are still owed. nginx
  serves the site's text as UTF-8 (`charset utf-8` in `www-nginx.conf`), so
  `llms.txt`, its first file with text outside ASCII, says so in its
  `Content-Type`. The address comes from `PUBLIC_SITE_URL`, the one place the
  site writes it, and the build follows it there. A test build names the same
  addresses and keeps its `noindex`; they take effect where `--public` makes
  the site indexable, which live's deploy does with `WWW_LIVE=true`. No visible
  sentence changes. `site/a-page-that-names-its-address-in-full.unit.test.ts`
  holds it, and `site/calculator.unit.test.ts` the charset.
- **The suites that talk to Nextcloud also run against the major the demo
  does not run** (workplan 0119): `.github/workflows/nextcloud-second-major.yml`
  runs the WebDAV, CalDAV, CardDAV, chunked-upload and share suites against
  `nextcloud:34.0.5-apache`, pinned by digest (against `35.0.2-apache` until
  the demo moved to 35, above), on a push to `main` that touches their code,
  weekly, and on a pull request that changes the leg itself; not on every pull
  request. A customer's own Nextcloud may run either major. The run fails when
  Nextcloud does not start, when the server that answered is not the version
  the tag names, and when any test skipped. The integration tier also gained
  its first suite for the share verb against a real server: a user share, the
  listing that reads it back, and a grantee the server does not know.
- **Live proves an update by itself, and its owner can start one pass to see
  it** (workplan 0132 T9, #1724): every ten minutes live's box checks run
  `copy-before-update.sh delete-if-proven`. It deletes the copy before an
  update by `delete`'s own rule and, stricter, only with no hold on, the
  checkout at the commit that took, a data type of the proving pass's
  migration completed, nothing in the copy's directory that its note does not
  name, and an hour after the hold was last lifted. The box checks then mail
  *Update proven* once (`COPY_DELETE_WHEN_PROVEN=false` in live's `.env`
  leaves the delete to the owner). `deploy/compose/live-pass-check.sh` starts
  one pass on the migration `LIVE_PASS_CHECK_MIGRATION` names, through *Sync
  now*'s own gates, refuses while the hold is on or the passes in flight are
  at the tick's caps, and says within 15 minutes how it ended.

### Fixed

- **qs 6.16.1 closes another denial of service in `qs.stringify`**
  (GHSA-6pq8-jhm2-2vcw, moderate, #1723): with `arrayFormat: 'comma'`, an array
  element carrying a non-callable own `toString` threw an uncaught TypeError.
  The override's floor moves from 6.16.0 to 6.16.1 (published 2026-10-14, past
  the three-day cooldown), which express and the tests' superagent now take.
  The API only parses query strings through express, so it could not be
  reached there.
- **The weekly image scan reads the tasks' image as a task deploy builds it**
  (workplan 0146 T10, #1700): it read only the base image Trigger.dev's CLI
  names, while every deploy copied the API image's Node over that base and
  upgraded its Debian packages, so the alerts for what the upgrade fixes could
  never close. The scan now builds that stage itself, from the deploy config,
  and reports it under the same code-scanning category and alert location, so
  the first scan on `main` after this closes them, and the alerts it still has
  keep their numbers.
- **A share press stops at the new system's limit on new shares, and says
  when to apply again** (workplan 0104 T5, #1704): Nextcloud 31 to 35 let one
  account create 20 shares in 10 minutes and answer the next one 429, and a
  press asks twice for each person without an account there, so a one-go
  press over more than about ten of them reported every row after the limit
  as refused, under the generic sentence. A 429 now has its own sentence, in
  English and Dutch, on both editions, with what `Retry-After` asked, up to a
  day, or Nextcloud's ten minutes. `apply-all` and `apply-folder` stop at the
  first one and list that row and the rows after it as `waitingForLimit`,
  open and untried, apart from `refused`, with the sentence as `limit`; the
  Sharing page says them under the folder as waiting, with the time to apply
  again on the reader's clock. A refused row stays open and is asked for
  again first, at the same cost, so a press that met the limit after
  refusals says to settle those rows first, and to check the password first
  when the sign-in was refused. A grantee that looks like an e-mail address
  still gets the user share first: a Nextcloud login may be an address.
- **The API image carries production dependencies only, so the dev tools'
  Go binaries leave it** (workplan 0146 T9, #1687): it copied an install that
  held every devDependency, the root's included, and the Go builds of
  esbuild 0.25.12 and TypeScript 7's native compiler in it were 2 critical
  and 65 high of the `edge` image's 3 and 125 findings, though nothing in the
  container runs them. The install now takes `--prod`, and the API and
  `packages/orchestration` declare the drizzle-orm and pg they load, which
  they used to find among the root's devDependencies. Nothing a stack sets
  changes.
- **A deploy no longer waits without end on a compose step** (live's deploy of
  alpha.2, 2026-10-28, #1725): the bring-up asked compose to pull the identity
  provider's image before reading its user, even when the machine had it, and
  on live that pull printed "Pulled" and never returned, so the deploy waited
  sixteen minutes, until the pull was killed, and then did not take. Compose
  v5.0.x's progress, drawn in a terminal, can deadlock at the end of a command
  (docker/compose#13639); the nights run without a terminal and never met it.
  `bootstrap-managed.sh` and `deploy-live.sh` now ask compose for plain
  progress (`COMPOSE_PROGRESS=plain`), the bring-up pulls that image only when
  the machine lacks it, and a pull that does not end is stopped after
  `ZITADEL_PULL_TIMEOUT` (600 seconds) with a sentence saying what to do. The
  operator runbook says how to end such a step and go on.
- **systeminformation 5.33.16 closes two advisories in `networkStats()`**
  (GHSA-4vjg-vx72-qq4g, low, and GHSA-7648-jmwf-vw7j, moderate), which
  Trigger.dev's SDK carries through `@opentelemetry/host-metrics`. On Linux an
  interface name could reach a file outside `/sys/class/net` through a symlink,
  which needs a local user and a caller that passes it untrusted input; the
  prototype pollution affects the BSDs only. A floor at 5.33.14, the Linux fix
  (published 2026-09-28, past the three-day cooldown), takes the tree from
  5.33.1 to 5.33.16.

## [0.2.0-alpha.2] - 2026-10-25

The Alpha's texts are final at version 1.0, and testers are asked to accept
them once, at their first sign-in on this release. Every screen a tester meets
in the app and on the site was swept: plainer words in English and Dutch, and
the queues, Verify, Confirmed, Team, Billing and the site's legal pages now
read on a phone. For whoever runs it, the identity provider moves to Zitadel
v4.20.0 and the task runner to Trigger.dev v4.7.6, with its tasks on the API
image's Node and its object store on Chainguard's maintained MinIO, and the
security fixes since `v0.2.0-alpha.1` reach PgBouncer, Node and the
dependencies of the API and the web app. A release is now cut by the Release
workflow, which tags a commit only with the owner's approval and once its
checks, its nights and a scan of that exact commit are green.

### Changed

- **Trigger.dev's object store runs Chainguard's maintained MinIO, and starts
  empty** (workplan 0146 T7, the owner's answer of 2026-10-23, #1692): the
  frozen `bitnamilegacy/minio` image, in which the scan read 26 critical and
  259 high findings, 206 of them fixed in packages it would never get, is
  replaced by `chainguard/minio`, the same server built from a maintained
  fork, pinned by digest. It keeps its data on a new volume, `minio_data_v2`,
  which starts empty, and a one-shot, `minio-init`, makes the `packets`
  bucket before Trigger.dev starts. A stack takes it at its next bring-up
  after the drain a Trigger.dev upgrade needs: nothing running or waiting
  that owns a stored payload, because old runs' large payloads and outputs
  are not carried over. The Bitnami-era volume stays on disk until it is
  removed by hand, once the stack runs the change from `main` or a release
  tag and a nightly or a deploy after it was green. The weekly pin watch says
  when Chainguard has rebuilt the image.
- **Trigger.dev is v4.7.6, its tasks run the API image's Node, and ClickHouse
  26.2 is accepted for the Alpha** (workplan 0119, issues #1668 and #1669,
  #1689): since v4.7.4, a magic link signs in only the browser that asked
  for it and always points at `TRIGGER_LOGIN_ORIGIN`, so ask for it there;
  the webapp and the task images distrust the roots behind the compromised
  eMudhra intermediates and the Sectigo AAA cross-sign, and the tasks verify
  TLS against Debian's certificate store instead of Node's own list. Each
  task deploy now copies Node out of the image `apps/api/Dockerfile` builds
  from (24.22.1), where the tasks ran Trigger.dev's Node 24.18.0, and
  upgrades the base image's packages, so the tasks move with the API; the
  first deploy after that image moves is the slow one and needs the Debian
  archive. The move is one way (twelve database and six ClickHouse
  migrations): a stack whose `.env` sets `TRIGGER_IMAGE_TAG` sets `v4.7.6`
  there first, with no run executing and after the backup, or its bring-up
  stops at the `trigger` phase, and a rollback sets it back first. v4.7.7, a
  security release of 2026-10-22, waits until after the launch: its task
  half is what the Node layer gives, and its supervisor makes no TLS
  connection here. ClickHouse stays on 26.2, which ClickHouse no longer
  supports, as Trigger.dev's own compose pins it: reachable on the compose
  network only, and revisited when Trigger.dev moves off it, when an
  advisory reaches it, or in 2027-03. `docs/ending-the-alpha.md`'s list of
  the stores the task runner writes was read at v4.7.2 and says so.
- **The release preflight lists the open critical and high code-scanning
  alerts by tool and category** (workplan 0146, #1683): every page of them,
  the repository's filesystem scan and each scanned image apart, with their
  counts and their most alerted CVEs, where it printed one count of the first
  page. Still reported, never refused: the pull request's Trivy check blocks
  new findings, and the advisory gate refuses a tag. The triage of 2026-10-23
  is in 0146's Status.
- **The identity provider is Zitadel v4.20.0, which carries v4.19.5's three
  security fixes and is built with a Go that is still fixed** (workplan 0135
  T7, #1651, #1680): v4.19.5 makes device authorizations need the user's
  consent, has login v2 sign its proofs with a server secret, and refuses an
  invalid public host header instead of ignoring it; none of them reaches a
  flow this stack uses. v4.20.0 is built with Go 1.26.10, where v4.19.5 was
  built with Go 1.25, a line Go no longer fixes: it closes a CPU hole in the
  file server that serves the console and the sign-in page's files to anyone,
  signed in or not (CVE-2026-78667), and one in the HTTP/2 server behind the
  provider's port (CVE-2026-78669). The console now takes its API address
  from the issuer's origin, so the mixed-content mismatch
  `bootstrap-managed.sh` checks for cannot arise on it. Neither move runs a
  setup step. Outbound TLS now refuses chains through the compromised eMudhra
  intermediates, which on live reaches the mail relay alone: live takes it
  from a release tag, after a dump of its `zitadel` database, and then sends
  one mail through its relay and signs in once, because no gate run proves
  that path.
- **PgBouncer 1.26.1 closes three holes this stack's settings left open, and
  Trigger.dev's Redis leaves Alpine 3.21** (workplan 0119, #1657): each hole
  was open to a client that had not logged in (CVE-2026-19888, CVE-2026-6668
  and CVE-2026-107349), and a fourth, CVE-2026-107350, was probably closed by
  the settings already. 1.26.0 is skipped, because it ignored this stack's
  `ignore_startup_parameters = search_path`. Redis stays on 7.4 and runs on
  Debian 12, since Alpine 3.21's security support ends on 2026-11-01. Mailpit
  v1.31.6, Gatus v5.37.0 and registry 3.1.2 are current.
- **The API, web and appliance images build on Node 24.22.1, the October
  security release, and the Windows appliance ships the same Node** (workplan
  0119, #1658): the packager reads the version from the appliance image's
  `FROM` line, so each bump of that image moves the zip's Node too. pnpm is
  11.28.6.
- **The managed stacks' container output is capped by size** (workplan 0129,
  #1661): every service in `managed.yml` keeps five files of 20 MB, about
  100 MB at most, where Docker's default kept all of it until the container
  was removed. The website's container stays uncapped, because the visit
  count reads its whole log.
- **imapflow 2.5.6 and nodemailer 10.1.7** (from 2.2.1 and 10.0.13), with
  express 5.3.0, @azure/msal-node 7.1.0, @electric-sql/pglite 0.5.10, undici
  8.12.2, drizzle-orm 0.45.4, zod 4.6.7, React 19.3.1, @tanstack/react-query
  and its devtools 5.104.4 and lucide-react 1.59.0, and the development tools
  with them (Dependabot, #1587, #1642, #1673).
- **CI on the Spark takes the newest Node 24, and the security scan names its
  Trivy** (#1659): every setup-node step asks for the newest 24.x, where the
  Spark's jobs had kept 24.18.0; Security Scan sets up pnpm and Node as every
  other job does and installs from the lockfile; Trivy is held at v0.76.0,
  and at v0.76.1 in both scan steps since the pin watch named it behind
  (#1671, #1685).
- **Live refuses a sign-in provider's key, so its sign-in page stays email and
  password only** (workplan 0140 T10, #1644): the stand-up and the deploy
  refuse live's settings while a Google, Microsoft, GitHub or Apple sign-in key
  holds a value, as privacy §4.4, §7 and §8 say.
- **Deletions and Moves say what was decided on each row under *Already
  decided*** (workplan 0159 follow-up 6, #1652): kept, deleted on the new
  system too, or, for a moved item, its old copy removed.
- **The Alpha conditions, the terms and the privacy statement, reworded and
  still version 1.0** (workplan 0159 row 24, the owner's approval of
  2026-10-19, #1639): the two deletion switches carry the app's names; the
  Dutch texts say *aanmelden* and *afmelden*; the count before a migration is
  *the count when you review your migration*, no longer a *preflight*; and the
  privacy statement says what two-factor sign-in, passkeys and the lock after
  ten wrong passwords keep, on which basis, for how long, and that you can
  object. #1639 numbered the words 1.1; on 2026-10-21 the owner kept them on
  1.0, edited in place, because no tester had accepted any version yet
  (#1655). They apply from publication.
- **On a phone, a migration draws its two tiles once, under its name** (workplan
  0159 row 19, #1638); each data type keeps its icon, name, state and sentence,
  and a computer shows the page as before.
- **The permission report comes in the reader's language** (workplan 0144,
  #1609): the Finish page asks for it in the screen's language (`lang=nl` or
  `lang=en` on `GET /api/permissions/report` and the appliance's
  `/permissions/report`), and its headings, table headers and fixed sentences
  follow, and each blind spot is said in Dutch where its sentence has Dutch.
  Addresses, folder names and rights such as FullAccess and SendAs stay as
  they were found; where a reason or a measurement is still English, the
  Dutch report says so. Without `lang`, or with any other value, it is
  English.
- **The identity provider's mails, in Ownpace's words, in Dutch and English**
  (workplan 0135 T6): the sign-up, address-change and password-reset mails
  (#1604), and the notice that a password was changed and the link to add a
  passkey (#1611). Each names Ownpace and the address to write to.
- **The sign-in page locks an account after ten wrong passwords, offers a
  second factor, and live's organisation is called Ownpace** (workplan 0135
  T4 and open questions 2, 3 and 8, the owner's answers of 2026-10-17,
  #1612): ten wrong passwords in a row lock the account until an operator
  unlocks it; an authenticator app or a security key may be added and is
  never required; and the organisation on live's sign-in page is named
  Ownpace.
- **Every screen of the app and the site, swept for a tester** (workplan 0159,
  #1613 to #1628):
  - each screen names itself once, in the top bar and the browser tab, and a
    migration is called by its name, never its id;
  - the pages before sign-in have an English/Dutch switch, and *Not now* on an
    invitation no longer loops back to sign-in;
  - *Start a migration* says what each step does, step 5's button is *Set up* /
    *Klaarzetten*, and step 6 lists only the data types chosen;
  - the queues, Verify, Confirmed, Team and Billing read on a phone, and links
    inside sentences are underlined;
  - Dutch screens give answers, refusals and numbers in Dutch (18.734, 3,4 GB);
  - the site writes Dutch prices the Dutch way (€2,50), and its legal pages
    stack their tables on a phone.
- **The owner's word choices from the sweep** (workplan 0159 §5, the owner's
  answers of 2026-10-18, #1630 to #1636): Dutch signs in and out with
  *Aanmelden* / *Afmelden*, and says *aanbieder*, never *provider*; the
  check's verdicts and Deletions' chips are words, with the server's token in
  the title; Verify explains its four common findings and keeps the server's
  text in a closed *Technical details*; the queues' *What this means and what
  you can do* is written for the reader, in their language; a new mailbox's
  and a shared address's decision ask in the reader's language, and the new
  mailbox's button says what it does; a share has one name on the sharing
  checklist, the report and Finish; and the site's estimate, pricing and
  archive guide no longer promise a *free preflight* (the privacy statement
  kept the word until #1639). Two items, the tiles on a phone and
  the legal texts' wording, were asked again.
- **The sentences a tester meets, in a tester's words rather than a
  developer's, in English and Dutch** (workplans 0144, 0148 and 0143, the
  owner's scan of 2026-10-14, #1591, #1592, #1595, #1598, #1605), with any
  technical detail in a closed *Technical details* or a log:
  - the hint beside each Connect button says *sign-in page* and *give Ownpace
    access*, not *consent screen* or *refresh token*, and the grant page says
    each Google permission in words, with the exact scope in a closed
    *Technical details*;
  - a service that cannot be reached is said in the reader's language, never
    as *Network Error*;
  - a missing credential for Box, Dropbox, Google or Gmail names the field as
    the Accounts form does, and says to fix it there;
  - a Connect with Google, Dropbox or Microsoft that fails at the end, and a
    sign-in nobody is waiting for, each get a plain sentence;
  - the permission report and the Sharing checklist say what was not read in
    words that fit the source, naming Exchange PowerShell only for an
    organisation's own Microsoft 365, and the checklist has its Dutch; on
    managed, the OneDrive and SharePoint line no longer points to a setting
    or a document a tester cannot reach.
- **The *What migrates, and what does not* panel is in plain words, in Dutch
  too** (workplan 0013, #1596): no architecture words on *Start a migration*
  and *Review and start*, and Google Photos, mail with no Message-ID and
  Microsoft's permissions promise only what the code does.
- **A share the new system refused is said in Ownpace's words, in English and
  Dutch** (workplan 0136 T3, #1606): on one decision or a folder press, a
  managed tester reads which case it was (the sign-in refused, no such person
  or item, a 403, nothing answered, a certificate, and more) with a
  reference, and the target's own reply goes only to the server log under
  that reference; the API's apply-all answers the same. The appliance still
  shows the target's words.
- **An organisation may run six migrations at once by default, as the terms
  and the site's prices say** (workplan 0143, #1598), where it was five; the
  refusal past six is in the reader's language and says to contact us for
  more.
- **The operator's screens and mail are in English only** (ADR-0013, #1573):
  the support screens, the access queue and the redirect URIs, whatever
  language the app is shown in, and the *Somebody asked for access* mail,
  whatever `NOTIFY_LOCALE` says. Everything a customer reads stays in Dutch
  and English.
- **The texts testers accept are final** (workplan 0139): the privacy policy
  **1.0** and the terms of service **1.0**, beside the Alpha conditions 1.0, no
  longer marked draft (numbered 1.0 on the owner's decision of 2026-10-14,
  #1597: no tester had accepted the drafts' numbers, so the first version
  testers accept is 1.0), so the app asks every member to accept them before the
  first connection (#1532, #1556, #1557, #1559, #1580, and 0111's slices that
  changed §7 and §8 of the terms and §4.4 of the privacy policy). Closing an account is said as the code does it; the Dutch
  page's note keeps the exception for mandatory consumer law.
- **The owner's own review of the app's words, in Dutch and English** (#1556):
  plainer sentences throughout, the glossary's new Dutch terms (*gemigreerd*,
  *Overgestapt*, *Frequentie om naar wijzigingen te kijken*, *Controleer en
  start*), and the help pages and the tester guide quoting the new labels.
- **Visits to www.ownpace.eu are counted from its own server log, as totals**
  (privacy §4.5): GoAccess, run by the box duties, with no script, cookie or
  banner on the pages, no address handed to it and no database kept.

### Added

- **A release is cut by the Release workflow, and published in an order that
  holds** (`.github/workflows/release.yml`, `docs/release.md`, workplan 0146,
  #1682): dispatched from `main`, it reads the record (the changelog folded, CI
  and the scan green on the commit, two scheduled nights green on it as
  workplan 0141 T14 defines them, both migration chains' upgrade tests from the
  release before, the managed chain's new in #1681), waits for the owner's
  approval, scans the exact commit, cuts the annotated tag itself, and only
  then publishes: Security Scan on the tag first, the images and the Windows
  zip after it, then checks what was published. A hand-pushed tag still
  works, as the break-glass path. It exists because `v0.2.0-alpha.1` shipped
  on a red scan: see that release's section.
- **A weekly scan of every image the stacks run** (workplan 0146 T8, #1674):
  Trivy, report only. Findings go to code scanning, and an image whose
  operating system is past its end of life gets an issue of its own. The first
  run found one, the GoAccess image on Alpine 3.20 (#1675).
- **The end of the Alpha empties the task runner's history** (workplan 0139,
  #1667): `docs/ending-the-alpha.md` now has the step privacy §9 promises, on
  live and under the hold: Trigger.dev's database reset, the volumes of its
  ClickHouse, Redis and MinIO removed, and a check before the hold lifts.
- **A daily watch on the dates nothing else warned about** (#1666): the
  production certificates, and, once their repository variables are set, the
  website's `security.txt` and the Entra client secret. One issue stays open
  while any of them is inside its window.
- **Live's daily duties and its disk tell the owner by mail** (workplan 0142
  T3, #1664), once the owner has installed the units on live: a failed run of
  the duties, no pass for 26 hours, free space below its floor, and a summary
  once a day.
- **A weekly watch on every pin Dependabot cannot see** (workplan 0146 T8,
  #1663): Dependabot had read none of the files in `deploy/compose`, so every
  pin it cannot see (the images in `deploy/compose`, the tasks' Node and pnpm)
  is compared every Monday with what it should follow, and an issue stays open
  while one is behind.
- **The operator's log says who deleted a migration or a connection, replaced
  an account's sign-in or prepared a cutover** (workplan 0137 T4, #1648). No
  address, user name or password goes in the record.
- **The grant and progress link pages are opened in a real browser on every
  pull request** (workplan 0141 T12 (b), #1646), in English and in Dutch, and on
  a phone, where neither may scroll sideways.
- **The operator's guides say more before it is needed** (#1572, #1601,
  #1603): the managed bring-up gives the books and payments a step of their
  own (8i) and says, before you start, the memory and CPU a stack needs, as
  the plan's estimates until they are measured (workplan 0143 T1); the
  operator runbook says how to hand a customer their migration records on
  request, by hand, until a command does it (workplan 0155 T0).
- **A tester of the hosted Alpha who opens an issue on GitHub is sent to a
  person first** (workplan 0144 T6 (c), #1600): the issue chooser's first
  link leads to the tester guide's help, and says to use *Report a problem*
  in the app and never to post mailbox contents, addresses or screenshots of
  their data.
- **Every page of the site names the company that runs Ownpace** (workplan
  0152 T8 (c), #1599): its footer carries privacy §1's own sentence, with the
  Chamber of Commerce and VAT numbers, read from the privacy text in the
  page's language.
- **A refusal links the guide that explains it** (workplan 0148 T6 (b) and
  T7, #1584, #1585): a refused start or account test, and the *What
  migrates* panel, show *Guide: …* / *Handleiding: …*, which opens the guide
  at its section, where a refusal used to name a `docs/` file a tester cannot
  open. The guide page can now draw tables, which scroll inside their own box
  on a phone, quotes and the lines and lists inside a list item, which no
  guide uses yet; the CalDAV, CardDAV and WebDAV guide's italics no longer
  show their asterisks.
- **Money owed back reaches the operator** (workplan 0111, managed migration
  0055, #1576): a credit note paid other than through Mollie, a refund Mollie
  ended failed or canceled, or one still going after a week sends one mail to
  `NOTIFY_TO` and is listed on the support screen *Money to give back*, where
  the operator marks what was paid back by transfer, once, in their own name.
- **An erasure deletes the organisation's invoice copies and keeps their
  numbers** (workplan 0111 T10, ADR-0044, managed migration 0054, #1571): the
  books keep each issued invoice, so the purge deletes Ownpace's copies and
  its drafts and keeps their Moneybird numbers on the erasure record, which
  the operator's *Invoices kept after an erasure* lists. An issued invoice
  the books do not hold is kept, as the only record of itself.
- **Invoices through Moneybird** (workplan 0111, slices 5a–6): each month's
  draft numbered by Moneybird, the Billing page naming an invoice by that
  number and offering *Pay* and Moneybird's own PDF only on an issued one, an
  invoice address on *Invoice details*, and the books proved by hand and every
  night (`operator.sh moneybird proof`).
- **Payments, credit notes and the withdrawal function** (workplan 0111,
  slices 5f–7e): a payment through Mollie booked on its invoice, paid and late
  read back from the books every hour, a credit note as Moneybird's own credit
  invoice, money back refunded through Mollie and followed until it ends, the
  withdrawal function on the Billing page (*Withdraw from contract here*), and
  the order button that asks to begin within the 14 days without a tick box.
- **A year paid ahead** (workplan 0111 T11): ordered on the Billing page, its
  credit drawn month by month, and one email a month before it runs out.

Billing stays off during the Alpha (`OWNPACE_STAGE=alpha`, an empty
`OWNPACE_BILLING_FROM`): nothing is charged. What must happen before it is
switched on is in `docs/ending-the-alpha.md`.

### Fixed

- **The managed smoke gate settles the share rows it made, so one run's
  leftovers no longer spend the next run's shares** (workplan 0104, #1696):
  Nextcloud lets an account create 20 shares in 10 minutes, and every press
  retried the rows earlier presses had refused, so E2E (managed) #277's second
  attempt came back 429, as the demo Nextcloud's access log shows.
  `smoke-managed.sh` now skips every still-open share row a run of the gate
  seeded, through the product's own decision route, and prints each refused
  row whole, with the target's status.
- **body-parser 2.4.0 closes a denial of service through compressed request
  bodies** (GHSA-27r3-jxmh-p828, CVE-2026-111181, high, #1691): trailing
  bytes after a compressed body could tie up the API, which inflates JSON
  bodies by default, before anyone signs in. The API takes 2.4.0 through
  express. It was published on 2026-10-22, inside the three-day cooldown, so
  the lockfile's policy names it as the deliberate exception that list is
  for.
- **The visit count gives GoAccess nginx's own time, never a visitor's text**
  (workplan 0152, #1676): the time is read only from the end of a log line's
  first piece, in nginx's own shape, and the user field is never handed on,
  so a user name sent in a Basic Authorization header can no longer reach
  GoAccess or backdate a visit.
- **The identity provider's provisioning token gets its first date before the
  provider first starts** (#1660): a new stack, a new runner or live's
  recovery no longer takes compose's fixed 2026-12-31, which from 2027-01-01
  would have kept the provider restarting. A date still ahead is kept.
- **The managed smoke gate's reads of the identity provider ride out a 502
  from the front** (#1672): `smoke-managed.sh` asks a read again on no answer
  or a 502, 503 or 504, on the same `IDP_READ_ATTEMPTS` budget, and still sends
  each write once, the one-time token request included.
- **The managed bring-up's reads of the identity provider ride out a 502 from
  the front** (#1662): `setup-zitadel.sh` asks a read again on a 502, 503 or
  504, as it already did on a dropped connection, and still sends each write
  once. A read asked again no longer puts the retry line in front of its
  answer.
- **Dependency overrides get upper bounds** (#1656): express is back on
  cookie 0.7.2, where the 2.0.1 it had been given has no `serialize` and
  `res.cookie()` would have thrown, and the override no longer lets
  @opentelemetry/core reach 3.0.0, which would have broken the task image. The
  web app drops recharts, croner, autoprefixer and postcss, which it never
  imported.
- **follow-redirects 1.16.1 closes two high advisories** (#1647): credential
  headers could survive a redirect to another host (GHSA-8r9p-f939-6h3c,
  GHSA-q3jh-wrc6-jgq8). Its one copy sits under the web app's axios; the
  advisory gate had refused every pull request on it.
- **An IMAP account is shown what an IMAP server holds** (workplan 0013,
  #1610): a migration from the IMAP card is told about its mail, and no
  longer about calendars, contacts, files or tasks. An Apple account keeps
  every row it had.
- **The *What migrates* panel tells each source only what it carries**
  (workplan 0013, #1602): a Dropbox, Box or Takeout export is no longer told
  its mail moves; Microsoft To Do is listed under *Migrates* and Apple's task
  lists under *Partial*.
- **The warning before deletions are switched on says what each data type's
  check does** (workplan 0144 T4 and 0149 T6, #1607), where it promised that
  every removal spared a copy someone had since edited: a file, calendar
  entry or contact someone changed in the new system since Ownpace wrote it
  is not removed, nor when that cannot be checked; mail is not checked for
  changes. The guidance the API and the appliance return with a deletion
  says the same.
- **Sharing says which shares a folder press could not make, and why**
  (workplan 0136 T3, #1645), in Dutch where the server gave Dutch and in
  English otherwise, under the folder and in each row's card.
- **The line under an answered or set-aside decision is in Dutch on a Dutch
  screen** (workplan 0159 follow-up 12, #1649).
- **An invitation reaches the person whatever capitals or spaces their address
  was typed with** (workplan 0156 T3, managed migration 0059, #1650), and so
  does the organisation a granted access request makes.
- **The managed nightly's sandbox invoice asks Moneybird once more when it says
  try later** (workplan 0111 slice 5d, #1653): it waits out a 429's Retry-After
  of up to two minutes rather than asking early, and never posts a payment
  twice.
- **The advisories `v0.2.0-alpha.1`'s tag scan failed on are closed**
  (#1545): proxy-addr 2.0.8, which the API takes through express
  (GHSA-jqcg-44mw-7w3h, critical: an address spoofed through an IPv4-mapped
  IPv6 address in a trusted subnet); seroval 1.6.3 or later, under the web
  app's query devtools (GHSA-p6vx-979v-rg4c, critical, and
  GHSA-jp82-f5mq-hwhp, high); and source-map-js 1.2.2, a development tool's
  (GHSA-68fv-2mgg-jv7q, high).
- **After cutover the new system is left alone** (the owner's decisions of
  2026-10-05, #1566): nothing there is removed or overwritten because of what
  happens at the old system any more. A manual *Apply* of a deletion or a
  move is refused, the button is gone for those data types (a rollback
  brings it back), relocations are no longer auto-applied, a pass running
  across the cutover concludes nothing about deletions, and changes at the
  old system no longer overwrite the copies; new items still arrive.
- `ci-complete` fails when a gate that should have run never did, whatever
  GitHub calls it (#1536).
- The exposure check tells the development stack's compose project from the
  owner's other services by its files (#1538).
- A first bring-up with no Zitadel role yet is said as such, not as a refused
  password (#1545); the sender's display name reaches Zitadel split correctly
  (#1548).
- The report form is offered to a signed-in person, not only to a tenant
  (#1549).
- The managed smoke accepts the texts before it connects anything, and the
  control plane's leaked tokens are released (#1550).

## [0.2.0-alpha.1] - 2026-10-07

This section lists changes only up to mid-August 2026: apart from the pause
fix of 2026-09-29 (under *Fixed*), the newest date it names is 2026-08-11, and
what changed after that is not in it. What this release can migrate, source by
source and target by target, is in the [feature matrix](docs/feature-matrix.md).

Grouped by what an operator would notice, not by workplan; the workplan status
blocks in `docs/workplans/` remain the detailed record.

**Its release page has no generated body (the standard text was pasted by hand
on 2026-10-23) and no `bom.json`** (recorded 2026-10-23, workplan 0146). The
tag's Security Scan, run 37523297841 on 2026-10-06, failed at its advisory
gate, though the same commit's scan on `main` had been green about nineteen
hours before: seroval (critical, GHSA-p6vx-979v-rg4c; high,
GHSA-jp82-f5mq-hwhp), proxy-addr (critical, GHSA-jqcg-44mw-7w3h) and
source-map-js (high, development only, GHSA-68fv-2mgg-jv7q). The steps after
it, the SBOM, the release body and the SBOM's attachment, did not run. The
images had already been pushed and signed, and the Windows zip was attached to
a release `windows-payload.yml` created without a body. The standard release
text, without its sentence about an attached `bom.json`, and a note on this
failed scan, which says the `bom.json` is missing, were added to the release
page by hand on 2026-10-23. The `bom.json` stays missing: nothing regenerates
it, and a re-run of that scan would fail the same way on the tag's lockfile.
The Release workflow's `mode=verify` refuses the tag for it.

### Added

- **JMAP as a full target** (workplan 0031): contacts and files now migrate to
  a JMAP server alongside mail — contacts split per the fidelity spike's
  findings, files through JMAP's parent-chain model (no path, only a chain,
  and the blobId you read back is not the one you uploaded). A capability
  probe (`probeJmapCapabilities`) asks the server which domains it can carry
  and reports a rejected credential as a rejected credential. **Calendar over
  JMAP stays parked** by owner decision: Stalwart cannot yet store a
  recurrence rule; the spike script re-runs on each Stalwart bump.
- **The Windows appliance, end to end** (workplan 0015): the payload bundles
  its own checksum-verified Node runtime (nothing to install), registers via
  Task Scheduler with install/uninstall scripts and `.cmd` wrappers, keeps
  secrets out of Program Files (ACLed `secrets.cmd`, granted by SID because
  account names are localised), collects diagnosis-grade evidence, and prints
  which build is running as its first line. Proven on real Windows 11:
  510 messages, 0 failed, survived two force-kills and a reboot. Built on CI
  (`windows-payload` workflow) — and now attached to release tags (unsigned;
  SmartScreen will prompt until the code-signing decision is taken).
- **The managed wizard reaches the finish line** (workplan 0037): completable
  end to end, a confirm/green-light screen with a real URL that survives
  refresh, incoherent target/domain combinations and garbage cron refused at
  create with the same words the wizard shows, oauth2/graph sources collect
  the customer's own Entra app registration (tenant ID, client ID, client
  secret — the ADR-0006 per-customer model) instead of pretending to be IMAP.
- **The operating screens tell the truth as a set** (workplans 0033–0036,
  0038): real run history, LiveProgress on the mapping hub, one state
  vocabulary and StateChip, every number stamped as-of when, aftermath parity
  across the queues, a finish checklist that reads the real verify report and
  refuses to show a failed read as "clear", and full EN/NL coverage with a
  compile-time guard against hardcoded strings.
- **Billing truth pass** (workplan 0039): role guards on billing writes *and*
  reads (owner/admin), server-side money contract, duplicate invites refused,
  self-demotion armed like the destructive action it is.
- **`GET /version` on both editions** (and `/api/version` through the web
  proxy): version + commit, so "what are you running" has an answer. The
  container images stamp the commit at build; the Windows launcher's build
  stamp feeds the same endpoint.
- **A real browser now opens the managed UI on every PR** (`pnpm test:ui`).
  The 2026-08-11 session found three defects that had shipped and that 2202
  green unit tests could not see, because none of them had ever opened a page:
  a stylesheet that never compiled, a bundle calling an absolute origin
  instead of its own, and list rows with a hover state and no click handler.
  Eight tests against the production build, served by a fixture server that
  plays nginx's part — no API, no database, no Docker, ~20 seconds including
  the build. All three defects were reproduced and confirmed caught.
- **imapflow replaces imap-simple** (workplan 0032): both the source and the
  write path, behind a mutation-verified parity harness that caught a defect
  in the *proven* client before retiring it (RFC822.SIZE was never asked
  for). The old client and its advisories are gone from all four manifests.

### Fixed

- **A pause is heard inside a running pass** (workplan 0022 T2, 2026-09-29). On the managed
  service, pressing Pause, taking a grant back, closing the organisation or stopping one data
  type now reaches a pass that is already copying: within about fifteen seconds it stops
  starting new items, and it finishes the ones it has begun (a very large file can take
  longer). It used to wait for the pass's own deadline, up to fifty minutes. The appliance has
  no Pause button, grant withdrawal or organisation close; there the same holds for a Finish,
  a data type its owner stopped, and a status changed by hand, which used to wait for the end
  of the firing. Neither edition auto-applies a relocation after a pass that was told to stop,
  and both ask once more right before that apply.

- **IMAP certificate verification was hardcoded OFF for every connection** —
  on, with a named `tlsVerify` opt-out per mapping and the knob named in the
  refusal message. A dropped IMAP socket no longer kills the whole appliance.
- **The managed web container can reach the API**: the nginx stage now
  proxies `/api` to the api service (the SPA used to get `index.html` back as
  JSON on every API call in a compose deploy); the compose env's
  `VITE_API_URL` no longer points at the web port; the smoke script asserts
  the proxy path. The api/web Dockerfiles lose their DRAFT banners:
  digest-pinned bases, healthchecks on both.
- **Localhost fallbacks fail closed**: in production with billing live, a
  localhost/unset `API_URL` or `WEB_URL` refuses to boot naming the
  consequence (unreachable Mollie webhooks / stranded redirects); a localhost
  `CORS_ORIGIN` warns.
- A successful status pass no longer reports the last failure; verification
  reports the coverage that was measured, not requested; the confirm screen
  stops calling a running migration unstarted; wrong-edition routes land
  somewhere true; failed reads across Mappings/Dashboard/Billing say so
  instead of rendering as empty.
- **What the meter measured was the calendar, not the work** (workplan 0039
  T7): billable compute time was `completedAt - startedAt` from a
  `started_at` written once when the row was created and never again — the
  age of the row, growing on its own. A demo that had done seconds of work
  showed 24.3 billable hours. Alongside it, the managed sync's email path
  never wrote that status row at all, so the mapping list reported "last
  sync: 9 days ago" for a mapping syncing cleanly every 15 minutes. Both
  fixed together, because giving email the row is what starts metering it.
- **Prices are one number in one place, and a tenant keeps the one it
  agreed to.** The API invoiced from one constant while the worker metered
  against another, and a third VAT rate was the one stamped on invoice rows.
  Now a single source, configurable per deployment via `PRICING_*`
  (integer cents — a euros-shaped typo refuses to boot rather than billing
  a hundredth of the intended amount). Each tenant's prices are
  pinned when first billed and never follow the template again, so changing
  what new customers pay cannot re-price an existing one. Operator controls
  are `.env` plus a runbook section; there is no pricing screen to misclick.
- **A run log accounts for the domains that did not run**, naming an
  unselected domain as the owner's own scoping decision rather than leaving
  its absence to be read as an oversight — the same courtesy the §20 verify
  report already extended.
- **A manual "run now" obeys the mapping's domain selection**: the API's
  enqueue passes no domain list, and the job used to read that as "all
  four", attempting a calendar sync against an email-only mapping's IMAP
  credentials. `scope_selection` is the owner's call on every path now, not
  just the scheduled one.
- **The Migraties rows open the migration.** The list rendered rows that
  looked clickable but weren't; the only way in was a small edit icon.
- **Dutch that a Dutch speaker would use**: *post* is paper mail, so the
  digital kind is *mail*, and the MX/DNS step is *de e-mailbezorging
  omzetten* rather than language that reads like a house move. Recorded in
  the UI glossary, not just fixed in place.
- Ten test-gap commits from the fleet's sweep: gates that passed while
  proving nothing, credential-encryption suites that ran nowhere, the
  unrevertable deletion outcome nobody was testing.

### Release infrastructure

- Release refs are test-gated (`ci.yml` now runs on `v*` tags); a failed SBOM
  can no longer silently suppress release creation on a tag; releases get a
  generated body (pull lines, cosign verify, changelog link) instead of an
  empty page; the Windows payload attaches to the release. The release
  procedure lives in `docs/release.md`.

## [0.1.0-rc.1] - 2026-08-04

The first tagged artifact. A **release candidate**, deliberately: the pipeline
that produces it is proven, the feature set is still moving, and a version
people might pin should not imply otherwise (owner decision 2026-08-03,
workplan 0025 T2).

> **On the date.** This entry was first written on 2026-08-03 against the
> commit that prepared it, and was **not tagged then**. Tagging that commit a
> day later would have published a signed image carrying `socket.io-parser`
> 4.2.6 (CVE-2026-69185, HIGH), fixed on main the following morning — a poor
> first artifact for anyone to pin. So rc.1 is cut from 2026-08-04 instead and
> this entry was rewritten to describe that tree (owner decision 2026-08-04).
> Rewriting it is legitimate precisely because **rc.1 was never published**:
> the rule that a released entry must not quietly change protects readers who
> already have the artifact, and there were none.

### What is in it, and actually works

- **Shadow sync, one way, idempotent.** Mail, calendar, contacts and files from
  Microsoft 365 to JMAP (Stalwart) and to the IMAP/DAV family (Soverin,
  openDesk, Nextcloud). Re-running a pass creates nothing twice — the natural
  key is the same on both transports, so switching between IMAP and Graph
  cannot duplicate a mailbox. Proven end to end in CI against real servers,
  nightly, on both persistence backends.
- **The three item queues** — deletions, moves, failures — each reporting what
  is waiting on a person and what the machine is still retrying, with the
  server's own diagnostics carried verbatim.
- **`apply`, the one destructive operation**, behind seven gates including a
  mass-deletion circuit breaker. Off unless a mapping opts in.
- **Verification and cutover**, with the count/checksum gate that must pass
  before the DNS switch, and a rollback path that reactivates the source.
- **Both editions**: the self-host appliance (PGlite or Postgres, in-process
  scheduler, no Docker required for the packaged payload) and the managed stack
  (Trigger.dev tasks, RLS-isolated tenants, billing).
- **Bilingual EN/NL** across the operating screens, with compile-time key
  parity — a missing translation is a type error, not a silent fallback.
- **Email notifications**: ad hoc events plus a daily/weekly "what needs
  attention" digest, per edition. An empty digest is never sent; a queue that
  could not be read always is.
- **Supply chain**: multi-arch images signed with cosign (keyless, by digest),
  a CycloneDX SBOM per build, every GitHub Action pinned by commit SHA.

### In it, but not yet proven against a live tenant

These four are **built, tested and running on schedule**, and not one of them
has read a real Microsoft 365 directory. They all wait on the same thing: admin
consent on a tenant (`docs/o365-application-access.md`). Until that happens
they run daily and report, honestly and per tenant, that they could not look —
which is the correct behaviour, and becomes real output with no further code.

Read this section as *the machinery exists*, not as *this works for you yet*.

- **Shared addresses are discovered and classified** (workplan 0027).
  Mail-enabled groups are read from the source directory and sorted into
  §14.1's two patterns: a shared MAILBOX, whose store is copied like any other
  mailbox, or a distribution LIST, which has no store and whose definition and
  members have to be recreated. Where the directory does not say which, **you
  are asked instead of guessed at** — both wrong guesses cost real work, one
  silently leaving a mailbox full of mail behind and the other leaving an
  address that reaches nobody after cutover.
- **A shared mailbox migrates as an ordinary mapping** (0027 T3):
  `source.mailbox` names the shared address and the full folder tree is copied
  with the same idempotency and verification as any mailbox. See
  `docs/shared-mailboxes.md` for the target convention — a dedicated mailbox at
  its own address, team access by per-person app passwords, Send-As.
- **A step-by-step list for distribution lists** (0027 T2), with each address
  and exactly who must receive its mail. Manual by necessity: no target
  platform this tool supports offers a way to create a mail group for you, and
  the document says so on its first line rather than implying otherwise. Lists
  whose membership could not be read are named as such rather than presented as
  empty groups to recreate.
- **Drift detection** (workplan 0028). A daily pass notices a mailbox on the
  source that no migration covers, raises it as a decision, and tells you.
  Re-running converges on the same open questions instead of growing the queue,
  and a tenant whose coverage cannot be established raises nothing and says why.
  Standing answers (`auto`/`ask`, per category) let a category answer itself,
  recording that a rule closed it rather than a person.
- **The permission inventory** (workplan 0029, SAD §14.2). A report per
  mailbox, reachable from the Finish checklist: who can see whose calendar,
  what each right corresponds to on the target, and which items only a person
  can carry across. **Nothing is applied automatically** — the write half is
  deferred by decision.
- **`check-access`**, which tells you whether the consent above actually
  worked. One small question per consented permission, each reported
  separately, because they are granted separately and refused separately. It
  replaces the previous answer to *did that work?*, which was to wait for the
  next morning's scheduled pass and read a log.

### What is NOT in it — read this before pointing anyone at it

- **Nothing in the section above has read a real tenant.** It is the single
  most important limit in this release: four features that will report *I could
  not look* on every run until somebody completes the consent runbook.
- **Distribution lists are not created for you.** The runbook tells a person
  what to make; no target platform this tool supports offers an API to do it.
- **OneDrive and SharePoint sharing is not inventoried by default.** It needs
  `Files.Read.All`, and unlike every other permission this product asks for, an
  Exchange Application Access Policy cannot narrow it — granting it would mean
  read access to every file in the tenant. Declined for the reference
  deployment (owner decision 2026-08-04); a deployment that has granted the
  scope sets `GRAPH_FILES_READ_CONSENTED=true`. Off, the report names the
  section as uninventoried and says why, which is not the same as saying
  nothing is shared.
- **Mailbox delegation cannot be inventoried at all.** FullAccess, SendAs and
  SendOnBehalf are Exchange recipient permissions that the Microsoft Graph API
  this tool speaks does not expose. Every permission report says so and names
  the Exchange Online PowerShell cmdlets that do read them. This is the class of
  right most likely to break silently at cutover, so it is reported rather than
  omitted.
- **IMAP sources cannot discover shared addresses at all** — the protocol has
  no directory. Such a source reports that it could not look, never an empty
  list.
- **Permissions are never applied.** Inventory and guidance only; the write
  half is deferred by decision and has no code.
- **One-way only.** Bidirectional sync and post-cutover reverse sync were
  **retracted** on 2026-08-03, not deferred: writing back to the source would
  mean modifying the system being migrated away from. The source itself is the
  fallback — it is never deleted from.
- **DNS is verify-only.** The MX switch and any revert are manual operator
  steps. Nothing here writes DNS.
- **No signed installers.** The Windows MSI is unbuilt and no code-signing
  certificate has been bought, so a desktop installer will show SmartScreen and
  Gatekeeper warnings when one exists.
- **Byte-level parity is not measured** on the target for every domain; where
  it is not, verification reports "not measured" rather than a fabricated
  match.

### Fixed since the 2026-08-03 preparation

- A managed migration could be created declaring itself a distribution list,
  which would have connected, copied nothing, and reported success. Both
  editions now refuse it in the same words.
- A recurring meeting and its modified occurrences share a UID under RFC 5545,
  and the calendar natural key used the UID alone — so an edited occurrence
  collided with its series. The key now includes `RECURRENCE-ID`.
- Seven dependencies with published advisories are pinned to their fixed
  versions, including one in the runtime path shared by the managed worker and
  the appliance image (`socket.io-parser`, CVE-2026-69185, HIGH). **This is the
  reason rc.1 is cut from 2026-08-04 rather than the day before.**

### Notes for anyone running it

- Prerelease images do **not** take the `latest` tag — pin the explicit
  `0.1.0-rc.1` tag or a digest.
- Verify a signature before running anything:
  `cosign verify ghcr.io/robbes/open-migrate-selfhost@sha256:… --certificate-identity-regexp '^https://github.com/Robbes/open-migrate/' --certificate-oidc-issuer https://token.actions.githubusercontent.com`
- Back up the control-plane database before upgrading. The N-1 → N upgrade
  path becomes testable from this tag onward and is not yet proven.
- **If you are migrating from Microsoft 365, do the consent runbook first**
  (`docs/o365-application-access.md`) and finish with its step 6,
  `check-access`. Four of the features above do nothing until it passes, and
  they will tell you so on every run rather than failing loudly.
- **This cycle (2026-08-02): 0019 and 0021 closed; ADR-0006's Graph-mail fallback built end to end (workplan 0023); two dormant ADR promises became real or were corrected.** In order: **workplan 0019 closed** — the apply client speaks the managed receipt shape (the one success-shape edition split ADR-0026 permits), the Deletions screen polls receipts to their terminal states, `allow_apply_deletions` got its owner-only API and a deliberately heavy two-step switch, `MappingDetail` became a real per-mapping hub, `Finish` gained a queue-envelope-driven per-mapping mode, and the appliance's deprecated synchronous `GET /verify` was retired exactly one release after 0017 promised it (the wiring test now pins the 404). **Workplan 0021, the documentation truth pass** — the SAD bumped to v1.2 (engine-name sweep, ADR-0011's real self-hosted-targets position, the corrected `TargetRemover` claim, PGlite named, the bilingual promise marked unbuilt, ADR index through 0028); the cutover runbook was rewritten against the code and **found a real bug doing it**: the CLI's `execute` attempted `CUTOVER_IN_PROGRESS→COMPLETED`, an edge the state machine rejects — the happy path threw AFTER the operator had switched DNS. Fixed: `execute` lands in `GRACE_PERIOD` and a new `--yes`-gated `complete` closes it; `rls-guide.md` was rewritten around the real FORCE-RLS/`app_user`/`withTenant` model (26 tables, all FORCEd); `testing.md` dropped its deleted-engine tutorial and gained a tree-verified untested-seams appendix; six READMEs stopped lying about env vars, ports and architecture. **Two ADR promises with no code behind them got owner decisions and same-day builds**: the **Atlas migration lint** is a CI job (`migration-lint` — replays the whole migration dir against a disposable Postgres, fails on destructive changes; ADR-0017), and **ADR-0006's Graph-mail fallback is real end to end** (workplan 0023): a `GraphMailSource` connector keyed on the same `internetMessageId` natural key as IMAP (a transport switch cannot duplicate a mailbox), wired through both editions' dep builders with fail-closed credential contracts, and a runtime `MailSourceWithGraphFallback` that answers an auth-refused IMAP mailbox with one self-verifying Graph probe and continues the run over Graph, loudly — because O365 answers disabled-IMAP and bad-credential with the same prose, so the honest detection is to prove the alternative works rather than parse the error.
- **The managed edition runs on ONE execution plane (workplans 0020+0022, all closed 2026-08-01 with live evidence).** The day started with two security findings and ended with the polling scheduler deleted. In order: `authenticate` now confirms tenant **membership** and takes the role from the `tenant_member` row, never the token — proven in production with two identically-signed tokens (member → 200, non-member → 403, where before both were served); every secret is `:?`-required with zero committed fallbacks and the API refuses to boot in production on a known placeholder (`ensure-env-secrets.sh` generates per-install values); the dashboard's TLS front became a compose service; the hand-run verify+apply smoke became **`smoke-managed.sh`**, the one-command acceptance test for every stack change; the managed runbook was rewritten around the real bring-up (the initdb-mount instruction that crashed the API is gone); task env vars upload via **`set-task-env.sh`** instead of a dashboard ritual; and a hardening sweep deleted 204 lines of pretend-code (the unauthenticated webhook sink, the rotten `managed-simple.yml`). Then the owner decision: **syncs moved onto the `managed-sync-tick` scheduled task** — one declarative every-minute tick evaluating each mapping's own cron against the DB (no per-mapping schedule state to reconcile), explicit enabled-domains, per-mapping concurrency 1 — and the polling `managed-scheduler`, its Dockerfile and its compose service were **deleted** (−487 lines). The staged cutover earned its keep: the tick's first due firing surfaced a real in-runner networking bug (the platform injects the HOST-perspective API URL into runners; this was the first task to call the API from inside one), fixed with the poller one command from resuming and zero data impact. Every claim above has Spark-stack evidence in the 0020/0022 status blocks.
- **Catch-up entry (2026-08-01) — the changelog had fallen behind the tree; the whole-repo review brings it current.** Since the last entry: **`apply` and `verify` landed in the managed edition** (workplan 0017 — verify as a start+poll pair over `verification_run`, apply as evaluate-then-enqueue with an `apply_receipt` lifecycle; every gate answered synchronously with the appliance's exact refusal codes; ledger migrations 0003/0004), which retracts this file's older claim below that they are "deliberately absent from the managed API" — that was true when written and is not anymore. **The Trigger.dev tasks actually deploy and run** (workplan 0018): `apps/worker/trigger.config.ts`, one env contract (`TRIGGER_API_URL`/`TRIGGER_SECRET_KEY` — the SDK's own names, replacing three disagreeing ones), a compose execution plane (local registry, docker-socket proxy, supervisor, ClickHouse, MinIO, all with restart policies), `deploy/compose/deploy-tasks.sh`, and `DEPLOY_IMAGE_PLATFORM` for arm64 hosts. Verified live on real hardware, both halves: an API `202` became a real runner executing `run-verification` and landing a per-domain PASS report in 1.7 s, and the apply path landed a live receipt `applied`/`kind: deleted` in ~6 s after re-running every gate in the job — the managed edition's destructive path is proven end to end. **The e2e gate now runs both persistence backends** (Postgres + PGlite, 46 tests each) and moved onto the verify start+poll pair. **Jobs now respect the scope selection**: apply/verify touch only domains enabled in `scope_selection` instead of building connectors for all four (PR #207). Housekeeping from the review: the committed `.env.managed` was removed and gitignored, ADR-0028 records the PGlite architecture decision post-hoc, and workplans 0019 (managed operating surface), 0020 (managed-stack productionization, incl. two security findings) and 0021 (documentation truth pass) collect all known leftover work.
- **The Windows packaging shell is decided: a Service plus a Start-menu shortcut, no native shell ([ADR-0027](docs/adr/0027-windows-packaging-shell.md), workplan 0015 T2).** This had been framed as "Tauri versus Node SEA", which is a false pair: **Tauri is a Rust shell and cannot run our TypeScript**, so it needs the Node backend as a sidecar — meaning the backend must be packaged first, which is the whole job. Tauri is that work *plus* a second toolchain, not an alternative to it. And the requirement — end users never touching bash, a Linux filesystem or Docker — says nothing about a native window; a shortcut to `http://localhost:8081/ui` satisfies it. The payload is identical either way and was **measured rather than assumed**: esbuild bundles the appliance into a single **3.6 MB** ESM file in 166 ms with no errors, alongside ~26 MB of PGlite WASM, the 500 KB web bundle and 88 KB of migrations SQL. The Node runtime (~110 MB) is the largest line and the only place worth looking if size becomes a complaint — the shell is not. Node SEA was rejected specifically: experimental, needs a CommonJS entry (three `import.meta.url` sites work against that), and the WASM ships alongside regardless — so it takes the constraints without delivering the single-file result that is the only reason to want it. Electron was rejected on footprint as ADR-0019 already had. **Tauri is deferred, not rejected**, with a named revisit condition: when "it must look like a native application" becomes a stated requirement rather than a preference — at which point the sidecar it needs already exists, so it wraps working software instead of being a packaging rewrite.
- **Measured what PGlite's serialisation actually costs, and it is nothing (workplan 0016 P5, `pnpm bench:pglite`).** PGlite has one connection, so `withTenant` serialises on it; the sync path runs at concurrency 8, and whether that mattered was the last open question before PGlite could be a default. Running the real ledger hot path — `find()` by natural key then `recordIfAbsent()`, inside the real `withTenant`, against the real schema — it is **flat at 3.6–3.9 ms/item across widths 1, 4, 8 and 16**, with width 8 against width 1 landing at +6.8%, −0.0% and −6.2% over three runs. Zero within noise, and no cliff at 16. **Two corrections to the T0 spike's numbers**, because someone would otherwise plan against them: the quoted ~1700 rows/s came from synthetic single-statement inserts and the real path runs at **~270 items/s**, six times slower; and "not the bottleneck by orders of magnitude" is really ~13× — one order of magnitude, with the ledger at **~7% of wall clock** for a 48k-message mailbox (~170–185 s of ledger against ~40 min of network at 50 ms/message). Comfortably not the bottleneck; not free either. One methodological note worth keeping: the first version of the benchmark shared a database across widths and reported concurrency costing +29%, almost all of which was the table growing — a fresh database per width is the difference between measuring the flag and measuring something else.
- **The appliance's entry point had no automated coverage, and two behaviour changes shipped through that gap.** The e2e suite drives `/status`, the three queues, `/verify` and `/mappings/{id}/run`, and its fixtures arrive already active — so it never calls `GET /` or `POST /mappings/{id}/start`, the first two things a user actually touches. Both changed under ADR-0026 (`/` went from rendering HTML to redirecting to `/ui/confirm`; `start` went from `303 See Other` to JSON, because `fetch` follows a redirect silently and the button would have "worked" while navigating somewhere nobody asked for), and neither broke anything — but nothing was watching. Now covered: a mapping starts `paused`, `start` answers JSON and reports `activated`, a second click reports `activated: false` rather than pretending to work, the mapping is genuinely `active` afterwards, and an unknown mapping 404s. These run against a REAL appliance over real HTTP in the unit project, with no container — PGlite makes starting one cheap enough to do in a test.
- **The Restart-Resume e2e can now run against the PGlite appliance** — `deploy/selfhost/compose.pglite.yml` (no Postgres container at all) plus `SELFHOST_COMPOSE_OVERRIDE`. Restart-durability is a genuinely different claim there: the database is a directory inside the app's own container rather than a separate service. Validated with `docker compose config`; **not yet executed**, since it needs a runner.
- **The self-host appliance can now run with no Postgres server at all (`SELFHOST_PERSISTENCE=pglite`, workplans 0015 T1 / 0016).** PGlite is Postgres compiled to WASM running in-process: no service, no port, no `initdb`, no `DATABASE_URL`, and no major-version upgrade to perform on somebody's laptop. Same SQL, same migrations, same schema, same RLS policies (ADR-0023) — the *server* goes away, not Postgres. **Postgres was the last native dependency the appliance had**, so nothing now blocks a native Windows installer on runtime grounds. The container path is untouched and remains the default. Three findings came out of doing it rather than spiking it: the whole-workspace dependency blocker recorded in 0015 T0 **was not real** (an incremental `pnpm add` relinks partially; a clean `--frozen-lockfile` install resolves exactly one `drizzle-orm`); the seam was missing `exec()`, because `query()` with parameters uses Postgres's EXTENDED protocol and rejects the multi-statement SQL a migration file is made of; and **`row_security` is turned off by our own migration**, not by PGlite — `0001_baseline.sql` is a `pg_dump` whose preamble line 43 is `SET row_security = off;`, which is harmless on a pool but would disable row security for the life of the process on one persistent connection, so the driver re-asserts it per acquire. **RLS was verified to genuinely enforce**, not merely exist: tenant A sees only A's row, B only B's, cross-tenant INSERT refused — under `SET LOCAL ROLE app_user`, and mutation-verified by deleting that line, which fails all three because a superuser bypasses RLS. Notably this suite needs **no Docker**, so RLS enforcement is now testable anywhere Node runs.
- **The confirm page is folded into the React app, so the appliance runs one UI technology instead of two (ADR-0026).** `apps/selfhost/src/confirm-page.ts` — 135 lines of hand-rolled HTML that were the appliance's only screen — is deleted; `GET /` redirects to `/ui/confirm`. The duplication it left behind was not hypothetical: the discovery counts table, the scope manifest, and the two warnings that tell a customer what we will change (generated Message-IDs written onto **their copy**, not the original; matching items on the destination **adopted rather than overwritten**) existed twice in two languages, and had already drifted — the React copy was typed against a stale local `DiscoveryRecord` that silently dropped the adoption count, which is the one number a customer is supposed to see before pressing start. Both editions now render the same `DiscoveryCounts` and `ScopeManifestPanel`. Two containers remain deliberately: the appliance lists EVERY configured mapping on a landing screen, while a managed customer confirms the ONE mapping they just created as a wizard step — different flows over the same pieces. **One capability was given up and is worth stating**: the appliance previously had a usable screen with no build step, and now needs `pnpm --filter @openmig/web build:selfhost` (which the image runs); a source checkout that skips it gets the "not built" message naming the command rather than a working page. `POST /mappings/:id/start` now answers JSON instead of `303 See Other` — that redirect existed for the deleted HTML form, and `fetch` follows it silently — and reports `activated`, so a first click and an idempotent second one are distinguishable.
- **The managed edition implements the operating contract (ADR-0026), so "one app, both editions" is a fact rather than a claim.** `apps/api` had *none* of §11.2's decision queues — the asymmetry ran the opposite way to the usual assumption, with the appliance well ahead. It now serves the three queues, the `keep`/`retry`/`accept` decisions and `finish`, from the same `@openmig/shared` shapes and the same operator-facing prose, so the same React screens render against either edition. `retry` clears cursors there too (ADR-0020), because a button that quietly did less in one edition would be the same word meaning two different things. `startTransition`/`finishTransition` moved to shared as well: the refusal rules — most importantly that finishing is blocked while items await a decision — are operating semantics, and an edition that allowed what the other refused would be a different product wearing the same UI. **One refinement to the ADR:** the editions share the SHAPES but not the URLs. The appliance answers `/deletions` for every configured mapping; a managed tenant can have many, so its queues are scoped to one (`/api/migrations/{id}/deletions`), and asking without naming a mapping now THROWS rather than defaulting — "all of them" would be unbounded and picking one would show somebody another migration's data. Both still return the contract's `ByMapping<T>`, so screens iterate unchanged; the difference is confined to one function. **`apply` and `verify` are deliberately absent from the managed API** *(no longer true — workplan 0017 later added both in the asynchronous shape this reasoning demands; see the 2026-08-01 catch-up entry above)*: both touch the target, and in that edition target I/O belongs to the worker behind Trigger.dev (ADR-0004), not to a request thread holding connector credentials for minutes — a synchronous version would make the editions differ in exactly the operation that destroys data.
- **Fixed before it shipped: the managed operating routes would have stopped the API from starting.** The failure action was written as an Express 4-style regex path parameter, `:action(retry|accept)` — **Express 5 removed those and throws at route REGISTRATION**, so the API would not boot, and neither `tsc` nor eslint says a word because it is a valid string in a valid call. Validation moved into the handler, and there is now a unit test that imports the router and asserts the registered paths, which is the cheapest thing that reproduces API startup; reintroducing the regex fails the suite outright.
- **`runMigrations()` goes through the connection seam too, and can now run with no connection string at all (workplan 0015 T1).** It opened its own `pg.Pool` from a `connectionString`, which is the one signature that would have kept the appliance tied to a running Postgres long after every query became portable — **PGlite is a file, not a server, so there is no connection string to give it.** It now accepts a `driver` instead, with the ownership rule stated and tested in both directions: a driver the caller supplied is never closed here (the appliance passes the same driver it will then serve requests with, and closing it would take the database out from under a process that just started), while one opened from a connection string is. Passing neither is refused outright rather than opening a pool to nowhere — `new Pool({connectionString: undefined})` does not throw, it falls back to libpq environment defaults and tries to reach whatever `PGHOST` happens to say, so the failure would have surfaced as a confusing connection error against someone else's database. Five new unit tests run the real migration runner against a fake driver with **no database anywhere**, which is only possible because the seam now reaches this far; the advisory lock and per-migration transactions are asserted there so the seam cannot quietly drop them. Applying the seam to this second call site also corrected it: `LedgerConnection.query()` returned `unknown` and now returns `{ rows }` — the intersection of what `pg` and PGlite both provide, and the one thing a caller reading `schema_migrations` should not have to cast away.
- **The ledger gains a connection seam, so the appliance can one day run on PGlite (workplan 0015 T1).** `withTenant()` — the RLS gate — now takes a `LedgerDriver` rather than reaching into a `pg.Pool` directly, with `pgDriver(pool)` as the only implementation so far. It still accepts a pool, so all 45 existing call sites were untouched. **The reason this is an interface and not a find-and-replace is a correctness one, not a tidiness one:** `pg.Pool` hands out N independent connections and PGlite has exactly one, so two concurrent `withTenant` calls on a single connection would produce `BEGIN` inside `BEGIN`, one `COMMIT` ending both, and `app.current_tenant` set by one tenant while another is mid-query — cross-tenant exposure caused by concurrency alone, with every RLS policy still correctly written and every integration test still green. So `acquire()` is allowed to WAIT: a single-connection driver serialises by not resolving until the previous holder releases, and `withTenant` needs no knowledge of which kind it holds. PGlite itself is deliberately NOT adopted here — installing it makes pnpm resolve a second `drizzle-orm` (it is an optional peer, so the store key changes) and the workspace then typechecks two incompatible `SQL<unknown>` types against each other and fails outright, so the switch has to be one whole-workspace change. The single-connection behaviour is not left untested for it: five unit tests exercise `withTenant` against a fake driver with PGlite's constraint, including that the original error survives a failed rollback and that the connection is then marked unusable — and the serialisation test was verified to fail when the serialisation is removed.
- **The §20 check and the end of a migration get screens — and `finish` is a checklist, not a button (ADR-0026).** `verify` sits behind an explicit button and is never run on mount or polled: it counts and samples the TARGET for every enabled domain, so it is real network work rather than a status read, and the screen says so *before* the operator presses it. Its report is rendered without softening — `NOT_VERIFIABLE` is shown as "the domain is on and nobody could check it" rather than dressed as a pass, and `totalBytesTarget: null` reads "not measured" rather than borrowing the source figure, which would look like byte parity nobody established. **`finish` is the runbook's five-step cutover sequence rendered as a screen**, because the order is the whole safety argument: while a mapping is active, items still arriving on the old system are being copied across, and finishing is what stops that. A bare "Finish" button invites somebody to press it before mail delivery has moved — after which everything arriving on the old system is never copied, and nothing reports it, because the appliance has stopped watching. Steps 1–3 (check the copy, clear the queues, run a final pass) the appliance verifies for itself; **step 4 is MX/DNS, outside the tool entirely**, so it is the one precondition the operator is asked to attest to and the finish button stays disabled until they do. Unresolved failures are surfaced *before* the first click rather than only as a server refusal, and `force` is offered *only after* that refusal has stated what would be left behind. Eight tests, with the delivery gate verified against a mutated source.
- **`/status` now reports each mapping's lifecycle.** It carried per-domain states only, which left the one case that matters ambiguous: a finished migration and a stalled one both show their last completed pass and nothing since. `/status` is what anyone watching a migration polls, and "is this still syncing?" is the first question they have. Additive to the payload.
- **The §20 verification report types moved to `@openmig/shared`** (`verification-report.ts`), re-exported from `@openmig/core` so every existing `import type { VerificationResult } from '@openmig/core'` keeps working. The report is something a UI renders and both editions serve; a browser bundle should not have to reach into the reconcile package to learn the shape of a JSON document it was handed. The engine, its sampling config and its dependencies stay in core, and there is still exactly one declaration.
- **The appliance now serves the operating UI itself, at `/ui` — which is what closes "no terminal".** The decision-queue screens existed but were not reachable on the edition that actually gets installed. `apps/selfhost` now serves the built React bundle from its own process — no CDN, no second container, no separate web server. **The `/ui` prefix is load-bearing, not cosmetic**: that server already answers `GET /deletions`, `/moves` and `/failures` with JSON, and the router wants exactly those paths for its own screens, so a root-mounted SPA would have to arbitrate between them by sniffing `Accept` headers — which fails differently for a browser, `curl` and a script. The prefix makes the collision impossible instead, and the documented API paths do not move; there is a test asserting the handler declines each of those endpoints, because a regression there would serve HTML where every existing consumer expects JSON, silently. The bundle is built with `--base=/ui/` and `VITE_EDITION=selfhost` (`build:selfhost`), and the router's basename comes from Vite's own `BASE_URL`, so the mount point and the asset URLs cannot disagree. **Path resolution is separately tested and was probed over a raw socket** against the real built bundle — not `fetch`, which normalises the path client-side and would have tested nothing — with literal, URL-encoded and mixed-encoding traversals all confined to the bundle directory. Note that a traversal is *confined* rather than *refused*: `path.normalize` collapses a leading `..` at the root, so `/ui/../secret` resolves inside the bundle, does not exist, and 404s. A missing **asset** 404s while a missing **route** falls back to `index.html` (serving the page for a missing asset is the classic SPA bug — the browser asks for JavaScript, gets HTML, and reports a syntax error that says nothing about the real problem); fingerprinted assets cache `immutable` and `index.html` does not, or an upgraded appliance keeps serving the old bundle. If the bundle has not been built, `/ui` says how to build it and notes the JSON endpoints work regardless. The confirm page — where an operator lands, and until now where they stopped — links through to the queues once a mapping has started.
- **The decision queues get a UI, and the operating surface becomes a shared contract (ADR-0026).** §11.2's decision queues — the concrete form of §11.1's "the owner stays in control" — were reachable only by `curl http://localhost:8081/deletions` and reading a hash out of the response, and that included **`apply`**, the one destructive operation in the product. The self-host appliance's UI was a single page: discovery counts, the scope manifest, and a "Start migration" button. Everything after that button was untyped JSON. The wire shapes now live in `packages/shared/src/operating-contract.ts` and are **extracted from what self-host already serves** rather than designed fresh — that edition is the one with working operating semantics and an e2e gate over them, and the managed edition (which implements *none* of these endpoints) now has a specification with a working reference rather than an unwritten intention. Response bodies are unchanged, so the existing gates keep their meaning. The operator-facing prose moves with the shapes, deliberately: `whatThisMeans` and `howToResolve` are the operating semantics, and if each edition wrote its own the drift would land in exactly the explanations that stop somebody destroying data by accident. **Deletions, moves and failures are now React screens** with keep/apply/retry/accept. The `apply` button is imported from the contract rather than re-derived (`mayOfferApply`), so an inferred deletion appears in the queue and can be decided about but gets no destructive option **at all** — not a disabled one, because a greyed-out button invites somebody to go looking for how to enable it; it arms on first click and fires on the second; and a refusal renders the server's own words beside the item, because the gates live where the UI cannot see them and "not enabled" versus "somebody edited the target copy" call for completely different responses. A queue that fails to load says so rather than rendering empty, since an empty decision queue means "nothing needs you" (hard rule 9). Nine tests, mostly asserting what does *not* appear, with the apply gate verified against a mutated source. Still endpoint-only: `verify` and `finish`.
- **Fixed: `apps/web` was not typechecked by anything, and had drifted as a result.** The root tsconfig includes `apps/*/src/**/*.ts` and never `.tsx`, so 9 of the web app's files were in the gate and every page and component was invisible to it; its own `tsc` had been failing on `main`. Root `typecheck` now also runs the web app's own config. What that had allowed: `apps/web` carried its **own zod copy of `DiscoveryRecord`**, which fell behind the shared type when `targetExisting`/`targetColliding` and `excluded` were added — and because `z.object` strips unknown keys, those fields were being **dropped at runtime** as well as missing from the type. The stripped set included the adoption count, which is the number that changes what the customer ends up with and the one thing they are supposed to see before pressing start. The schema now lists them and the exported type is the shared one. Also removed four dead symbols in `throttling.ts` that blocked any green web typecheck (a never-read `retryDelays` map; unused parameters on `handleRateLimited` and `executeWithConcurrencyAndThrottling`, underscored rather than removed because four connectors pass them).
- **Proton Drive as a files target: assessed, and deferred on authentication rather than on effort (ADR-0025, workplan 0014).** The architecture's "weak/no sync API" line was out of date — Proton shipped an official Drive **SDK** (MIT, with a TypeScript client) and an official Drive **CLI** in 2026, and the SDK's surface (folder listing, upload, download, move, rename, trash, event-based change polling) maps onto `FileTargetWriter` + `TargetReindexer` + `TargetRemover` with nothing left over, trash giving an honest `binned` removal kind, and no shell-out reintroduced. The conclusion is unchanged and the reason moved: **authentication is browser-interactive with no headless path** — no app passwords, no API keys, no long-lived tokens — and this product is a headless worker on a schedule, so a Proton Drive target could be written but could not be run the way this product runs. Behind that: the SDK is pre-GA ("not ready for third-party production use", interfaces changing until end 2026 / early 2027) and deliberately excludes the login/session layer that is doing the blocking; E2E encryption would put the user's key material in the worker, which is defensible self-host and not defensible managed; and there is still no WebDAV, so this can never be a `webdav` target with a different URL. The reverse-engineered rclone `protondrive` route is rejected outright — Beta, implemented by observing browser traffic because Proton publishes no API docs, self-declared incompatible with some accounts, and hard rule 1 does not survive a target that may behave differently per account. Two named revisit conditions, the second being the real gate. Nothing in `parseTarget` changes, so there is no half-supported option for an operator to find and be disappointed by.
- **`apply` now works for the IMAP/DAV mail target, which completes the set — `apply` is now implemented for EVERY target this product has.** `ImapDavMailTarget` implements `TargetRemover`: it moves the message into whatever mailbox the server flags `\Trash` (RFC 6154 — Stalwart and Exchange both call theirs "Deleted Items", so matching on the name would find no bin and silently expunge instead of binning), reports `binned`; expunges with **UID EXPUNGE** only where the account has no such mailbox, reports `deleted`. Never a bare `EXPUNGE`, which also destroys every other message in the mailbox that anyone has flagged `\Deleted`, so a server without UIDPLUS gets a refusal rather than a broader deletion than was asked for. Every removal is read back and refuses to be recorded if the message is still there. Two contract changes this needed: **`TargetRemover.removeItem` takes the ledger row's `collection`**, because an IMAP UID is mailbox-scoped and the same number names a different message in the next folder — the writer refuses rather than guessing INBOX, and rows with no collection recorded cannot be applied at all; and **`targetVersion` for this target is the mailbox's UIDVALIDITY**, not an ETag, since an IMAP message cannot be edited in place — what invalidates our handle is the mailbox being recreated, which re-issues every UID. Verified against a real Stalwart, not only a fake.
- **Fixed: the IMAP/DAV target could only ever see INBOX, and could not create a folder at all.** Both `ensureMailbox` and `listEntries` called `conn.imap.getBoxes` — node-imap's **callback-only** method — with zero arguments and awaited the `undefined` it returns. Nothing threw, so the `catch` that exists precisely to refuse a partial view never fired: the ADR-0020 reindexer fell through to its `['INBOX']` fallback and rebuilt a ledger that *looks* complete while missing every other mailbox, which makes the next sync re-append all of them — recovery turning into mass duplication. The same wrong answer made `ensureMailbox` decide every folder was absent and call `addMailbox`, a method that exists on neither imap-simple nor node-imap (it is `addBox`), so creating a folder threw `addMailbox is not a function` and this target could only write into folders the account already had. Both now go through imap-simple's promisified `getBoxes()` and the shared `foldersFromImapMailboxTree()`, which also means nested mailboxes resolve to fully-qualified paths and special use is read from `attribs`. Same root cause, same fix, as the `ImapSource.listFolders()` bug below. Also removed a `setFlags(mailbox, ['\Trash'], true)` call that existed on nothing and only ever logged its own TypeError as a warning — RFC 6154 special use is assigned at CREATE time or by server policy, never afterwards; the bin is found by reading the flags the server assigned. The test helper `cleanTargetMailboxes` had the identical `getBoxes` bug and so had only ever cleaned INBOX between tests. New unit suite against a fake IMAP server (16 tests) plus real-Stalwart integration coverage; the enumeration regression tests were verified to fail against the pre-fix source.
- **Fixed: `upsertEmail` guessed a UID when the header search came up empty**, falling back to "the highest UID in the mailbox" — which a concurrent delivery, or any message the account already held, makes the wrong message. The ledger row then pointed our natural key at somebody else's mail. Harmless while nothing acted on a mail `target_id`; `apply` does, so it would have removed the wrong message. Now re-scans and matches the Message-ID, and throws rather than recording a guess.
- **Deleted the four unused shell-out engines** — `imapsync-wrapper.ts` (Perl/imapsync), `caldav-sync.ts` and `carddav-sync.ts` (Python/vdirsyncer), `webdav-sync.ts` (rclone) — and their exports from `@openmig/engines`. Nothing imported any of them: the migration path is `runShadowPass` → `runDomainSync` over the connectors and target writers, which is pure JavaScript for all four domains. They were not merely dead but **misleading**, since their presence said this product needs a Perl runtime and two Python tools installed to migrate anything — the first question anyone asks when packaging it (ADR-0019), answered wrongly, in the source. ADR-0019 gains an update note recording that its "prefer JS-native where fidelity is equal" went all the way, and that the one native dependency left in the self-host edition is **Postgres**; `docs/imapsync-bulk-sync.md` is banner-marked as withdrawn per the repo's history-in-place policy.
- **Restart-Resume e2e drives passes instead of sleeping on the cron.** The fixture schedules `* * * * *`, so twelve "wait for the next completed pass" points were each up to 60s of watching a clock — roughly 166s of the gate's 364s. They now `POST /mappings/{id}/run` between polls. The one property this could have quietly stopped testing is kept explicitly: after the restart, the gate first waits for one **unprompted** pass, because "the scheduler re-armed itself" is half of what a gate called Restart-Resume is for and every assertion after it would pass on a pass we asked for ourselves.
- **Step 5 — finishing a migration, and a "sync now" endpoint.** A shadow sync ran indefinitely by design and had no way to end: `mailbox_mapping.status = 'done'` was a legal value nothing ever set, so a finished migration went on polling a source nobody used and reporting drift nobody would act on. **`POST /mappings/{id}/finish`** ends it — the mapping goes to `done` and is unscheduled, so copying and drift/deletion/move reporting both stop, while **nothing changes on either system**: it is a statement about what the tool does next, not an action on anyone's data. It refuses while items are still awaiting a decision in the failure queue (finishing over those quietly turns "still working on it" into "this is what you got"), with `?force=true` to override and `leftUnmigrated` reported so the choice is on the record; it is idempotent, answering `alreadyDone` rather than pretending to work. Two supporting fixes: `runMapping` now re-reads the mapping status **every pass** rather than only at startup, so a mapping marked done stops syncing at once instead of at the next restart; and the three decision queues report `migrationStatus`, marking a finished migration's entries `reportingClosed` — kept as a record, no longer a list of things to do. Also adds **`POST /mappings/{id}/run`**, which runs a pass and answers when it finishes: an operator feature in its own right (after fixing a credential, before a cutover) that also lets the e2e suite **drive** passes instead of sleeping up to 60s each on the fixture's `* * * * *` cron. Built on `scheduler.runOnce`, which is single-flight per mapping, so it can never start a second concurrent pass — with the sharp edge stated in both the API response and the runbook: the pass you get back may have started before you asked, so the e2e helpers re-check and ask again rather than trusting one call. The cutover-and-cleanup order is now documented end to end in the operator runbook.
- **Squashed the 28-file migration chain into one generated baseline** (`packages/ledger/migrations/0001_baseline.sql`), taking the one-off opportunity that exists only while the product is pre-release and no database anywhere holds real data. Produced by a new **`scripts/squash-migrations.sh`**, which applies the old chain to a throwaway database and dumps the result — never by hand-merging, because the chain builds and then *rewrites* RLS policies (0002/0008/0011), replaces a CHECK constraint (0017), and adds a dozen columns to `item`, so predicting the end state by hand risks a silent tenant-isolation divergence no test would catch. The script then **proves** equivalence: it applies the generated baseline to a second database and refuses unless the two `pg_dump`s are byte-identical. Verified here two ways — old chain vs generated baseline (2553 lines, 0 differences), and old chain via `psql` vs baseline via the real node-pg `runMigrations()` code path (also identical), because the runner wraps each file in a transaction and `psql` does not. Three raw-dump traps are stripped in the process, each of which would have failed only at runtime: `\restrict`/`\unrestrict` psql meta-commands (node-postgres has no psql), a session-wide `search_path` reset (the runner's next statement is an unqualified `INSERT INTO schema_migrations`), and `ALTER DEFAULT PRIVILEGES FOR ROLE <dumping-role>` (bakes in whoever ran the dump); the cluster-global `app_user` role, which `pg_dump` cannot know about, is carried over from the old 0009. **Every existing dev/CI database must be dropped and recreated** — the runner keys `schema_migrations` on filenames, so one that recorded the old chain now trips the downgrade guard, whose message was expanded to name the squash as a cause and point at the fix rather than only saying "upgrade the application". The old chain remains in git history; the ledger is a rebuildable cache (ADR-0020), so nothing irreplaceable was in it.
- **Fixed: every mail item's `target_id` in the ledger was the literal string `"0"`.** `JmapTargetWriter.upsertEmail` read the created message's id as `Object.keys(importResponse.created)[0]` — but `Email/import`'s `created` map is keyed by the **creation id the request chose** (this writer always sends `"0"`), and the server's real id is `.id` on the value (RFC 8620 §5.3). So every message ever migrated recorded `target_id: "0"`. It stayed invisible because nothing fed a mail row's `target_id` back into a JMAP call: §20 verification re-derives ids from `Email/query`, and the adopt path takes its id from `Email/get`. `apply` (ADR-0024) is the first code to act on it, and it failed against a real Stalwart with `Email/set … notFound` for an id named `"0"` — after four rounds of differently-wrong fixes aimed at the symptom. No test asserted the created path's `target_id` at all, and one test passed only because both sides of its comparison were equally wrong; there is now a regression test that fails against the old code. **Existing installs:** mail rows written before this fix carry the bogus id, so `apply` will refuse them (`target_cannot_remove`/not found) until the ledger is rebuilt — which is exactly what ADR-0020's reindex path is for. Nothing else read the value, so no migrated data is affected.
- **Fixed: the real IMAP source never actually detected special-use folders.** `ImapSource.listFolders()` read `mailbox.attributes`, but node-imap's own `Folder` type (and everything that populates a real `getBoxes()` response) calls the field `attribs`. `mailbox.attributes` was therefore always `undefined`, `mapImapSpecialUse` always received `[]`, and **every** IMAP folder — including Trash and Junk — resolved to `specialUse: 'normal'`. Two silent consequences: `excludeSpecialUse` never actually excluded Trash/Junk from content sync (the default `['trash', 'junk']` had nothing to match against), and the mail deletion signal (ADR-0024/§11.1's `evidence: 'trashed'`) never found a bin to scan, so a deleted message never appeared in `GET /deletions`. Found by the new self-host e2e Apply-Deletion Gate against a real Stalwart (500+ message mailbox) — no existing test had ever exercised `listFolders()` against a `getBoxes()`-shaped fixture using the correct property name. Fixed by extracting a pure, now-unit-tested `foldersFromImapMailboxTree()` that reads `attribs` correctly and also recurses into nested mailboxes (`children`), which the previous flat loop never did either.
- **Dependency lifecycle + supply-chain hardening.** Cleared the two **HIGH** dependency CVEs Trivy was surfacing into GitHub code-scanning — `engine.io` (GHSA-r635-g3xr-vw7x, production via `@trigger.dev → socket.io`) and `brace-expansion` (GHSA-3jxr-9vmj-r5cp, dev/CI) — plus `body-parser` (LOW, via express), all via version-scoped `pnpm-workspace` overrides (`esbuild`'s moderate dev-only advisory left to Dependabot). Added **`.github/dependabot.yml`** (npm + github-actions, grouped weekly) so updates get PR'd instead of accumulating. Then rebased/validated the batch of major bumps Dependabot opened: **vitest 3→4** (aligned a latent `react-dom` 18→19 mismatch that v4 exposed, plus a typed `fetch` mock), **zod 3→4** (`.default({})`→`.prefault({})` for the schemaTask job schemas, `ZodError.errors`→`.issues`), **react-router-dom 6→7**, **helmet 7→8**, **recharts 2→3**. All green: typecheck, lint, `--frozen-lockfile`, and unit suites (web/api/worker/selfhost).
- **Managed edition 0011 — T1–T6 complete (PRs #43–#56); only T7 (container images + live compose run) remains.** This cycle landed **T5** (billing + Mollie test-mode e2e: invoice generation from metered usage priced per ADR-0014, and a real idempotent webhook state machine driving invoices to `paid`/`void` via fetch-on-webhook), **T6** (web UI on the real API — runnable component tests via jsdom + testing-library, real bearer-token login, contract-path fixes, and several real bugs the tests caught), and closed the two discovered backend mocks: **real run-history endpoints** and **real create-mapping persistence** (full connection→mailbox→mapping chain, credentials **encrypted** via `SecretStore`; migration `0013` added `name`/`schedule` to `mailbox_mapping`; `jmap` added to the Drizzle `connection.kind` enum). T7's app-tier Dockerfiles + `SECRET_ENCRYPTION_KEY` wiring are drafted (PR #57, needs a Docker host to verify) with a completion brief in `docs/design/0011-t7-dockerfiles-handoff.md`.
- Pre-publish hygiene for the GitHub upload: replaced the **LICENSE stub with the full verbatim Apache-2.0 text**; removed **11 redundant `.gitkeep`** files from now-populated directories (kept the 8 in genuinely empty dirs so those survive in git); noted that `.openhands/setup.sh` needs `chmod +x` at commit time (the packaging mount does not persist exec bits — running it via `bash` also works).
- Refreshed `docs/workplans/0001-start-prompt.md`: `@openmig` scope, tasks **T0 → T9**, an explicit list of the **pre-built components** (build against, don't rewrite; the unit property tests are the spec), the Stalwart `v0.16.10` pin, and a pointer to `docs/performance.md`.
- **Renamed the internal abbreviation `sovmig` → `openmig`** across the whole repo (66 occurrences, 39 files): package scope `@openmig/*`, dev DB name/user/password, compose network `openmig_dev-network`, `DATABASE_URL`s, the optional `$openmig` marker keyword (ADR-0020), and the lockfile — verified consistent under `--frozen-lockfile` with zero leftovers. The project name (`sovereign-migration-stack`) and repo folder are unchanged.
- Final improvement sweep (verified; **39 unit tests**): **pinned Stalwart to `v0.16.10`** (v0.17+ renames the bootstrap env vars our dev recovery-admin setup relies on — re-verify before bumping); **wired optional incremental cursors into `runShadowPass`** (new `CursorStore` port; per-folder cursors persisted only after a folder completes; steady-state passes now list only changed items once connectors honor cursors — proven by two new unit tests incl. lost-cursor re-scan); **hardened `.openhands/setup.sh`** to self-bootstrap Node 24 via nvm when the agent sandbox lacks Node.
- Further perf/resource work (verified offline; **37 unit tests**): made `mapWithConcurrency` **fail-fast** — on the first worker error it stops scheduling new fetches/writes, lets in-flight work settle, then rejects (saves wasted work on the reconcile hot path). Added **`docs/performance.md`** recording what's already optimized (bounded concurrency, ledger fast-path before fetch, body-free recovery) and the prioritized levers for the agent to apply/measure with real data: JMAP request batching, IMAP pipelining + `CONDSTORE`/`QRESYNC`, incremental cursors, batched ledger lookups (with the memory trade-off), SQL indexes/prepared statements, and streaming large bodies.
- Final offline step + a throughput/memory optimization (both verified; **36 unit tests**, no new deps): added a **dependency-free typed config loader** (`parseMappingConfig` / `parseMappingConfigJson` in `@openmig/shared`) for `mapping.example.json`, completing the non-stack half of T7. **Optimized `runShadowPass`**: per-folder items now process with **bounded concurrency** (`mapWithConcurrency`, default 4) — parallel I/O for higher throughput while capping in-flight message bodies to bound peak memory; race-free because folder items have distinct Message-IDs and writes are create-if-absent. Added an optional `concurrency` knob to `ReconcileDeps` and `MappingConfig`.
- Pre-built the **in-process scheduler concurrency core** (T6, offline-verified): `SingleFlight` (per-key promise coalescing) + `InProcessScheduler.runOnce` in `@openmig/scheduler`, unit-tested (concurrent coalescing, re-run after completion, independent jobs, error-path cleanup). Added the `@openmig/scheduler → @openmig/shared` workspace edge; **lockfile regenerated**, `--frozen-lockfile` re-verified. **Unit tests: 23.** croner wiring in `schedule(...)` remains the agent's (needs the dep + real timing).
- Pre-built the **stack-independent core** and verified it offline (lint, typecheck, **18 unit tests**): implemented `runShadowPass` (T4) and `reindexFromTarget` (T9) in `@openmig/core` with in-memory fakes (`MemorySource`/`MemoryTarget`/`MemoryLedger`) and **property tests proving idempotency, delta, and lost-ledger recovery**. Added `@openmig/shared` helpers — `keywords` (IMAP flag ↔ JMAP keyword), `specialUse` (RFC 6154 detection with name fallback), `cursor` (IMAP `UIDVALIDITY:UIDNEXT` codec) — each with tests, and a `mapping.example.json` (T7 placeholder; secrets via env). No new deps; lockfile unchanged. Connectors (T2/T3), SQL ledger (T0), scheduler (T6), and worker CLI (T7) remain stubs for the agent (stack-bound).
- **ADR-0021 (knowledge-enrichment add-in):** optional, opt-in, **local-only** parallel `KnowledgeSink` that emits an **OKF** bundle (markdown + YAML frontmatter; file-path = concept identity) describing the migrated corpus — pluggable writers (OKF first; JSON-LD/RDF later), a small producer-defined ontology vocabulary, **deterministic metadata first** (LLM enrichment a further opt-in layer), idempotent via the natural key, **never on the migration critical path, not in the MVP**. Cross-referenced in SAD §24/§25.
- Stubbed the **reindex seam** for ADR-0020 / workplan T9: a `TargetReindexer` port (`listEntries` → `TargetEntry` stream) + `findByNaturalKey` on `TargetWriter` (create-if-absent existence check) in `@openmig/shared`, and a `reindexFromTarget` skeleton in `@openmig/core` (control flow documented; `NotImplementedError` body). No new deps; lockfile unchanged. Green: lint, typecheck, unit 6/6.
- Stubbed the **Ledger impl shell** `SqlLedger` in `@openmig/ledger` (`find` / `recordIfAbsent` as `NotImplementedError`, with the `ON CONFLICT … DO NOTHING RETURNING` semantics in comments); added the workspace edge `@openmig/ledger → @openmig/shared`; **lockfile regenerated** and `--frozen-lockfile` re-verified. Green: lint, typecheck, unit 6/6.
- **ADR-0020 (lost-ledger recovery):** the ledger is a **rebuildable cache** — idempotency is anchored on the natural key carried on **both** source and target; writes are **create-if-absent by natural key**; a **reindex/adopt** step rehydrates the ledger from the target on a fresh install (added as workplan **T9**). Tightened the `TargetWriter` contract accordingly.
- Stubbed **T4 `runShadowPass`** in `@openmig/core` (full control flow documented; `NotImplementedError` body) and added the first workspace edge **`@openmig/core` → `@openmig/shared`**; **`pnpm-lock.yaml` regenerated** and `--frozen-lockfile` re-verified. Green: lint, typecheck, unit 6/6.
- **ADR-0019 (packaging & runtime targets):** container-first; **Windows 11 via Docker Desktop/WSL2** works today; optional **Tauri** system-tray variant (planned, chosen over Electron); **prefer JS-native engines for portability** (refines ADR-0007). Cross-referenced in SAD §24/§25, AGENTS.md, and deployment.md.
- **Build-enablement layer for the coding agent:** added `docs/workplans/0001-first-slice-jmap-mail.md` (JMAP-first vertical slice — O365 → Stalwart mail, Sent + one Pattern-S mailbox, one-way shadow, with the idempotency property test as the acceptance gate) and `docs/workplans/0001-start-prompt.md`; added `.openhands/setup.sh` + `.openhands/microagents/repo.md`; refreshed **AGENTS.md** to the JMAP-first / Stalwart reality.
- Stubbed the **T1 typed seams** in `@openmig/shared` (no new deps, lockfile intact): domain types (`MailItem`, `MailFolder`, special-use, keywords), idempotency hashing (`naturalKeyHash` / `contentHash`, with unit tests), and the port interfaces (`SourceConnector`, `TargetWriter`, `Ledger`, `Scheduler`) + reconcile DI/result types. Verified green: lint, typecheck, unit **6/6**. Added **`docs/workplans/0002-imap-dav-target.md`** (sketch: IMAP/DAV target family, reusing the 0001 engine).
- Verified current versions: **PostgreSQL 18**, **Nextcloud 34-apache** (Hub 26 "Spring"), CI Node runtime **24 (Active LTS)**. Verified all base-image OS are current: **Alpine 3.x** (postgres-alpine), **Debian 13 "Trixie"** (Nextcloud via the php image; also the Stalwart image base), and **Ubuntu 24.04 LTS** on the Spark runner (26.04 LTS has been available since Apr 2026; 24.04 stays supported to 2029).
- **JMAP-first pivot (ADR-0018):** JMAP is now the **primary target protocol**; IMAP/CalDAV/CardDAV/WebDAV is the parallel **second** family; **both in MVP**. The O365 **source** stays IMAP+OAuth2/Graph (Microsoft has no JMAP), so JMAP applies to the target write-path + internal model. Reframed SAD §13 (two target families), §13.2 (JMAP primary), and the §24 first slice.
- Dev/e2e stack rebuilt around **Stalwart** as the single reference target (speaks JMAP **and** IMAP/SMTP/CalDAV/CardDAV/WebDAV), **replacing GreenMail**; **Nextcloud 34** kept as the secondary DAV/files target; `e2e.yml` now polls Stalwart and exposes `JMAP_BASE_URL`.
- Architecture §9.3: **mosa.cloud** (and the Dutch **MijnBureau**) confirmed as SaaS resellers of the **La Suite** bricks — same family as **openDesk**. The La Suite **Messages** brick ships **no IMAP, by design** (JMAP-inspired), so this family is reached via the **JMAP adapter** (the primary path). **openDesk** (Open-Xchange + Nextcloud) remains supported via IMAP/DAV with no new connectors.
- Runnable monorepo skeleton (pnpm + Node 24, 12 workspace projects); scripts wired to CI; committed `pnpm-lock.yaml`; verified green (lint, typecheck, unit 2/2, integration & e2e).
- pnpm 11 settings in `pnpm-workspace.yaml` (`onlyBuiltDependencies: [esbuild]`, `verifyDepsBeforeRun: false`).
- CI/CD workflows (ci, security-scan, e2e self-hosted arm64, no-committed-artifacts) mirroring team conventions in TS/Node.
- Architecture v1.1; ledger schema v1 (`packages/ledger`); canonical docs `docs/testing.md`, `docs/deployment.md`.
- ADRs 0001-0018 (incl. **0018 JMAP primary target / IMAP-DAV second / both MVP**; 0017 Drizzle Kit + Atlas not Liquibase; 0016 ledger schema; 0011 self-hosted email = user-operated).
