# syntax=docker/dockerfile:1
#
# Self-host appliance image (workplan 0010 T3).
#
# Single-tenant bundle for a NAS / mini-PC / Pi. On startup it applies the
# ledger migrations under an advisory lock (T1), loads the mapping configs from
# /data/config, schedules them with the in-process croner scheduler, and serves
# /healthz + /status plus the operating UI at /ui (ADR-0026). It talks to the
# bundled Postgres from deploy/selfhost/compose.yml.
#
# ## The runtime stage runs the PAYLOAD, not the source tree
#
# `scripts/package-appliance.mjs` stages the directory a Windows installer
# copies (workplan 0015 T3). This image now ships that exact directory and runs
# `node start.mjs` out of it, where it used to `pnpm exec tsx src/index.ts` over
# the whole workspace.
#
# That is the point, not an optimisation. Before it, the container and the
# installer were two different programs we hoped agreed: the e2e gates proved
# the source tree under tsx, and the only thing that had ever run the bundle was
# a unit test — on Linux, with a stub UI, against no real server. Bundling is
# exactly where the interesting failures live (three of them in T3 alone: `pg`'s
# CommonJS `require` becoming esbuild's throwing `__require`, PGlite's WASM
# lookup following `import.meta.url` into the bundle, and `runMigrations`
# walking a package layout that bundling had collapsed) and NONE of that class
# is visible in a file listing. Running the payload here points all 35 existing
# e2e tests at the artefact that ships.
#
# It is also smaller and simpler: no pnpm at runtime, no corepack download on
# every container start, no workspace `node_modules`, no `tsx`.
#
# HARD RULE 5: this image must never pull in managed-only code (Trigger.dev,
# billing, RLS-app-user). The entrypoint imports @openmig/scheduler/in-process
# (a Trigger-free subpath), not the package index. The no-managed-leakage guard
# test (apps/selfhost/src/no-managed-leakage.unit.test.ts) enforces this.
#
# NOTE (§22.1): base images are digest-pinned for reproducibility.
#
# This FROM line is also the Windows payload's Node: `package-appliance.mjs
# --with-node` ships the node.exe of exactly this x.y.z, and refuses a line
# without one. Dependabot's image bump therefore moves both. Since 2026-11-06 it
# is the BUILD's base only, as in apps/api/Dockerfile: the runtime stage below
# is distroless, with a Node of its own, which must be this line's version.
#
# Debian 13 ("trixie"), named in the tag, as in apps/api/Dockerfile, which says
# why. Node 26 since 2026-10-31, and the corepack that brings pnpm comes from npm
# because the Node 26 image ships none: apps/api/Dockerfile says why, and the
# line is the same string in all three Dockerfiles.

FROM node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g --omit=dev corepack@0.36.0 && corepack enable
WORKDIR /app

# ---- build: install the whole workspace (packages ship TS source) ----
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# The operating UI (ADR-0026). This is the one thing in the image that IS
# compiled — the @openmig/* packages ship TypeScript that Node erases and runs
# as-is, but a browser cannot. Built with `--base=/ui/` and VITE_EDITION=selfhost, which the
# `build:selfhost` script sets, so the bundle matches the mount the appliance
# serves it from and knows it has no login to offer.
# The BUNDLE's stamp. The runtime stage below sets OPENMIG_COMMIT for the
# server's own GET /version; this is the other half, and it has to be here
# because the bundle is built in this stage.
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
RUN pnpm --filter @openmig/web build:selfhost
# Stage the SHIPPED artefact (workplan 0015 T3). The image now runs this, not
# the source tree — see the runtime stage for why that is the point rather than
# an optimisation. The default config goes in beside it, as `config/`.
#
# And /data, the tree the appliance owns, made HERE, where there is a shell:
# the runtime stage is distroless and can run nothing (workplan 0119 §3 item
# 12). `/data/config` is seeded from the payload's `config/`, and `/data/state`
# is made empty, the mount point of the `appdata` volume (the runtime stage
# says why it must exist). The runtime stage copies it in as uid 10001's.
#
# Then both trees are made READABLE BY EVERYONE AND WRITABLE BY THEIR OWNER
# ALONE, whatever modes the checkout gave its files: a umask of 077 writes them
# 0600 (and `mkdir` 0700), and COPY keeps a mode, so a root-owned /app would
# keep them from the user the appliance runs as. CI's umask of 022 hides that.
# The runtime stage copies /payload as root's and chowns none of it, so the
# appliance reads its code and cannot rewrite it, as the API cannot since 0146
# T13; it copies /data as the appliance's, 0755 and 0644 as the RUN that made
# it in the runtime stage until 2026-11-06 left it. Last in this stage, so
# nothing after it writes a file with another mode
# (scripts/an-appliance-that-could-rewrite-its-own-code.unit.test.ts).
RUN node scripts/package-appliance.mjs --out /payload \
 && cp -r deploy/selfhost/config /payload/config \
 && mkdir -p /data/config /data/state \
 && cp -r /payload/config/* /data/config/ \
 && chmod -R u=rwX,go=rX /payload /data

# ---- runtime: distroless, non-root, health-checked ----
#
# THE RUNTIME IS DISTROLESS (workplan 0119 §3 item 12; the owner's decision of
# 2026-11-03, for alpha.5), at the same line, tag and digest as
# apps/api/Dockerfile's runtime stage, which says what the image is: Debian 13
# with fourteen packages and Node at /nodejs/bin/node, and nothing else. No
# shell, no coreutils, no package manager, no perl, util-linux or ncurses. Until
# 2026-11-06 this stage ran on the Node image above, and removed what nothing in
# it runs: the package managers (0146 T12), then the Debian Essentials (0119 §3
# item 11, alpha.4); none of that is here to remove now.
#
# One line in two Dockerfiles, so the API's checks are the appliance's too:
# the managed smoke stops when the API's /nodejs/bin/node is not the `FROM
# node:` line's x.y.z (deploy/compose/smoke-managed.sh, `api_node`), the three
# `FROM node:` lines are one string, and the Windows payload's node.exe is that
# x.y.z (package-appliance.mjs). E2E (self-hosted) asks this image's Node as
# well. Dependabot moves the digest when the `nonroot` tag moves, and the two
# files move together or the guard below fails; a new Node major is a new
# image name, by hand.
#
# What that takes, wherever the container is reached:
# - No RUN in this stage: there is nothing to run one with. Everything comes
#   in by COPY from the build stage, whose last RUN made it.
# - Node is /nodejs/bin/node and is NOT on the PATH. ENTRYPOINT and the
#   HEALTHCHECK name it, and so does compose.yml's healthcheck for `app`, in
#   exec form: its `CMD-SHELL` until 2026-11-06 needed /bin/sh, which this
#   image has not got, so a `compose.yml` older than this image reports `app`
#   unhealthy while it serves (the CHANGELOG says so). Nothing execs a shell
#   or a bare `node` into the container: the upgrade drill and E2E
#   (self-hosted) ask Node by its path, and release-verify.mjs too.
# - The user is uid 10001, as it has been since the appliance had a user, NOT
#   distroless's `nonroot` (65532): every existing `appdata` volume is uid
#   10001's, and so is a state directory a self-hoster bound in its place, as
#   apps/selfhost/src/index.ts's startup hint tells them (10001:10001). The
#   Node image's `useradd --system` gave it gid 999 (measured 2026-11-06); its
#   files on an existing volume keep that group, which nothing reads, and the
#   owner's bits are uid 10001's either way.
#   scripts/an-appliance-with-nothing-to-exec.unit.test.ts holds all of this.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:9b945e92c1b5463a4b75f11e8417515e4bea7355f6adfd79ec220fbbe905dda8 AS runtime
ENV NODE_ENV=production
# Surfaced by GET /version (buildIdentity in @openmig/core).
ARG GIT_SHA=unknown
ENV OPENMIG_COMMIT=$GIT_SHA
# Where the app reads mapping JSONs and stores state.
ENV CONFIG_DIR=/data/config
ENV PORT=8081
# Bind on all interfaces inside the container; publish is controlled by compose.
ENV HOST=0.0.0.0
# The image's persistence posture, declared rather than inherited.
#
# `start.mjs` in the payload defaults to PGlite, which is right for the Windows
# installer it was built for — there is no server to point at. A container is a
# different deployment: `compose.yml` ships a `postgres` service and always has.
# Saying so here keeps `docker run` on this image behaving as it always did, and
# leaves `compose.pglite.yml` free to override it.
ENV SELFHOST_PERSISTENCE=postgres
# Where PGlite keeps its database when this image runs it, declared here for the
# same reason: `start.mjs` defaults it into the payload (`<payload>/data/pglite`,
# so `/app/data/pglite`), which is right for a payload unpacked where its user
# may write and wrong here, where /app is root's. Without this line a
# `docker run -e SELFHOST_PERSISTENCE=pglite` of this image stops at start with
# "The appliance cannot write its database directory". It is the directory
# `compose.pglite.yml` names, inside the state volume, so the override and a
# plain `docker run` keep one database in one place.
ENV SELFHOST_PGLITE_DIR=/data/state/pglite
# HOME AS IT WAS. uid 10001 has no line in distroless's /etc/passwd, so Docker
# would set HOME=/; the Node image's `appuser` had /app, and this keeps it. The
# one reader in the payload is `pg`'s pgpass, which looks for `$HOME/.pgpass`
# when DATABASE_URL carries no password; neither directory is the appliance's
# to write. Without a passwd line `os.userInfo()` throws (ENOENT), and nothing
# in the payload calls it (scripts/package-appliance.unit.test.ts).
ENV HOME=/app
# `/app` IS the payload — the same directory `pnpm package:appliance` produces
# for an installer to copy, with the default config (`config/`) beside it. It
# carries its own `ui/` and `migrations/`, which `start.mjs` resolves relative
# to itself, so no *_DIR variable is needed for either and none is set: a stale
# override is the failure mode that would put `/ui` back to "here is how to
# build it" while everything else looked fine.
#
# ROOT'S, AND READ-ONLY TO THE APPLIANCE. Copied without --chown, so root owns
# it, with the modes the build stage set last (everyone reads, root alone
# writes). The appliance writes only under /data (CONFIG_DIR and
# SELFHOST_PGLITE_DIR above), so a compromised appliance cannot rewrite the
# code it loads at its next start. Until 2026-11-03 a RUN here chowned /app to
# the appliance's user as well, and that `chown -R` wrote every file of the
# payload again in a layer of its own: the published image carried the payload
# twice, an 11.3 MB layer (compressed, amd64) right after the COPY's 11.3 MB.
COPY --from=build /payload /app
# /data IS THE APPLIANCE'S: copied as uid 10001's, the config and the empty
# mount point the build stage made, and nothing else.
#
# `/data/state` MUST exist here, empty and the appliance's — even though compose
# mounts a named volume over it. Docker seeds a fresh named volume from the
# image path it covers, INCLUDING that directory's ownership; if the path does
# not exist in the image, Docker creates the mount point as root and the volume
# comes up root-owned. uid 10001 then cannot write to it.
#
# That was latent for as long as nothing wrote there: on the Postgres path the
# database lives in the `postgres` container's own `pgdata` volume, so `appdata`
# was declared, mounted, root-owned and unused. PGlite is the first thing to
# actually put a file in it, and it failed on the first boot of the e2e stack
# with `EACCES: permission denied, mkdir '/data/state/pglite'`.
COPY --from=build --chown=10001:10001 /data /data
# By number, so nothing resolves it from a passwd file (there is none for it).
USER 10001:10001
EXPOSE 8080
# DATABASE_URL and any tokenFromEnv/passwordFromEnv secrets come from the
# compose env-file. The status server answers /healthz once migrations applied.
#
# EXEC FORM, on /nodejs/bin/node by its path: Docker runs Node itself, with no
# `/bin/sh -c` around it, which this image has not got. The probe needs no
# shell (Node reads PORT from its own environment, so nothing here is for a
# shell to expand). `deploy/selfhost/compose.yml` sets a healthcheck of its own
# for the `app` service, which takes the place of this one under compose; this
# one is what a plain `docker run` of the image gets.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
WORKDIR /app
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["start.mjs"]
