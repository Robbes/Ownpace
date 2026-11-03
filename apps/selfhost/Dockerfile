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
# without one. Dependabot's image bump therefore moves both.
#
# Debian 13 ("trixie"), named in the tag, as in apps/api/Dockerfile, which says
# why. Node 26 since 2026-10-31, and the corepack that brings pnpm comes from npm
# because the Node 26 image ships none: apps/api/Dockerfile says why, and the
# line is the same string in all three Dockerfiles.

FROM node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS base
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
# an optimisation. The default config goes in beside it, as `config/`, which the
# runtime stage seeds /data/config from.
#
# Then the whole tree is made READABLE BY EVERYONE AND WRITABLE BY ROOT ALONE,
# whatever modes the checkout gave its files: a umask of 077 writes them 0600,
# and COPY keeps a mode, so a root-owned /app would keep them from the user the
# appliance runs as. CI's umask of 022 hides that. The runtime stage copies this
# tree as root's and chowns none of it, so the appliance reads its code and
# cannot rewrite it, as the API cannot since 0146 T13. Last in this stage, so
# nothing after it writes a file with another mode
# (scripts/an-appliance-that-could-rewrite-its-own-code.unit.test.ts).
RUN node scripts/package-appliance.mjs --out /payload \
 && cp -r deploy/selfhost/config /payload/config \
 && chmod -R u=rwX,go=rX /payload

# ---- runtime: non-root, health-checked ----
FROM base AS runtime
# NO PACKAGE MANAGER AT RUNTIME. CMD and the HEALTHCHECK run `node`, and nothing
# execs npm, npx, pnpm, yarn or corepack into this container. npm's bundled
# undici, brace-expansion and http-cache-semantics were the base image's 5
# high Node.js findings. The Windows payload's node.exe comes from nodejs.org,
# not from this image, so this changes nothing for it.
# The whole global-modules directory goes, not npm and corepack by name: they
# are all it holds in this base, and a package manager a later base stage
# installs with `npm install -g` (Node 25 and later ship no corepack) lands
# there too, so it goes with them.
RUN rm -rf /usr/local/lib/node_modules \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    /opt/yarn-v*
# NO DEBIAN ESSENTIALS THAT NOTHING RUNS (workplan 0119; the owner's decision
# of 2026-11-03, for alpha.4). util-linux, the eight other packages built from
# its source (mount, login, bsdutils, libblkid1, libmount1, libsmartcols1,
# libuuid1, liblastlog2-2) and libsqlite3-0 are purged. With npm gone, Trivy
# 0.76.1 read 0 critical and 44 high in this base on 2026-11-03, none with a
# Debian fix, and 37 of the 44 were in these ten: four util-linux CVEs in each
# of the nine, and one in SQLite. Nothing here runs them. CMD and both
# healthchecks start `node`, which links none of their libraries; a shell, where
# one is used, is dash, and `ls` and the like are coreutils, which stay; the
# payload has no native module (PGlite is WebAssembly, `pg` plain JavaScript);
# and nothing execs su, login, mount, getopt or any other of their programs
# into this container.
#
# Debian marks them Essential, and `login` protected as well, so dpkg removes
# them only with the two `--force-remove-*` flags below, and with nothing more:
# without `--force-depends` it refuses to remove a package that something
# installed still depends on, so a base that grows such a dependency stops this
# build rather than ship that package broken. `dpkg-query -W` first stops it
# when the base no longer has one of the ten (a renamed package is a list to
# read again, not a name to skip), and `apt-get check` last when what is left
# is not a state apt accepts. Debian does not test a system without its
# Essential packages; this one runs `node`. The tasks' runtime base purges the
# same ten (apps/worker/trigger.config.ts), and
# scripts/an-essential-nothing-runs.unit.test.ts holds the two to one list.
RUN dpkg-query -W util-linux mount login bsdutils libblkid1 libmount1 libsmartcols1 libuuid1 liblastlog2-2 libsqlite3-0 >/dev/null \
  && dpkg --purge --force-remove-essential --force-remove-protected \
    util-linux mount login bsdutils libblkid1 libmount1 libsmartcols1 libuuid1 liblastlog2-2 libsqlite3-0 \
  && apt-get check
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
# code it loads at its next start. Until 2026-11-03 the RUN below chowned /app
# to appuser as well, and that `chown -R` wrote every file of the payload again
# in a layer of its own: the published image carried the payload twice, an
# 11.3 MB layer (compressed, amd64) right after the COPY's 11.3 MB.
COPY --from=build /payload /app
# Non-root runtime user; owns the /data mount points, and nothing under /app.
#
# `/data/state` MUST exist here, empty, before the chown — even though compose
# mounts a named volume over it. Docker seeds a fresh named volume from the
# image path it covers, INCLUDING that directory's ownership; if the path does
# not exist in the image, Docker creates the mount point as root and the volume
# comes up root-owned. `appuser` (uid 10001) then cannot write to it.
#
# That was latent for as long as nothing wrote there: on the Postgres path the
# database lives in the `postgres` container's own `pgdata` volume, so `appdata`
# was declared, mounted, root-owned and unused. PGlite is the first thing to
# actually put a file in it, and it failed on the first boot of the e2e stack
# with `EACCES: permission denied, mkdir '/data/state/pglite'`.
RUN useradd --system --uid 10001 --home-dir /app appuser \
  && mkdir -p /data/config /data/state \
  && cp -r /app/config/* /data/config/ \
  && chown -R appuser:appuser /data
USER appuser
EXPOSE 8080
# DATABASE_URL and any tokenFromEnv/passwordFromEnv secrets come from the
# compose env-file. The status server answers /healthz once migrations applied.
#
# EXEC FORM: Docker runs `node` itself, with no `/bin/sh -c` around it. The
# probe needs no shell (Node reads PORT from its own environment, so nothing
# here is for a shell to expand), and an image without one, as the API's
# distroless runtime is, could not run the shell form at all.
# `deploy/selfhost/compose.yml` sets a healthcheck of its own for the `app`
# service, which takes the place of this one under compose; this one is what a
# plain `docker run` of the image gets.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
WORKDIR /app
CMD ["node", "start.mjs"]
