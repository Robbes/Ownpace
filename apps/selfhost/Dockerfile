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

FROM node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
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
RUN pnpm --filter @openmig/web build:selfhost
# Stage the SHIPPED artefact (workplan 0015 T3). The image now runs this, not
# the source tree — see the runtime stage for why that is the point rather than
# an optimisation.
RUN node scripts/package-appliance.mjs --out /payload

# ---- runtime: non-root, health-checked ----
FROM base AS runtime
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
# `/app` IS the payload — the same directory `pnpm package:appliance` produces
# for an installer to copy. It carries its own `ui/` and `migrations/`, which
# `start.mjs` resolves relative to itself, so no *_DIR variable is needed for
# either and none is set: a stale override is the failure mode that would put
# `/ui` back to "here is how to build it" while everything else looked fine.
COPY --from=build /payload /app
# Copy default config into the image (can be overridden by mounted volume).
COPY deploy/selfhost/config /app/config
# Non-root runtime user; owns /app and the /data mount points.
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
  && chown -R appuser:appuser /app /data
USER appuser
EXPOSE 8080
# DATABASE_URL and any tokenFromEnv/passwordFromEnv secrets come from the
# compose env-file. The status server answers /healthz once migrations applied.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app
CMD ["node", "start.mjs"]
