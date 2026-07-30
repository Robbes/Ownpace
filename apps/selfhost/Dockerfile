# syntax=docker/dockerfile:1
#
# Self-host appliance image (workplan 0010 T3).
#
# Single-tenant bundle for a NAS / mini-PC / Pi. On startup the entrypoint
# (apps/selfhost/src/index.ts) applies the ledger migrations under an advisory
# lock (T1), loads the mapping configs from /data/config, schedules them with
# the in-process croner scheduler, and serves /healthz + /status plus the
# operating UI at /ui (ADR-0026). It talks to the bundled Postgres from
# deploy/selfhost/compose.yml.
#
# The @openmig/* packages ship TypeScript source (package.json "main"/"exports"
# point at src/*.ts — there is no JS build), so the app runs under tsx rather
# than tsc→node. Copying the whole /app between stages preserves pnpm's
# node_modules symlink layout and keeps packages/ledger/migrations available at
# runtime (runMigrations resolves them relative to its own module URL).
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

# ---- build: install the whole workspace (source-ships-TS, run under tsx) ----
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# The operating UI (ADR-0026). This is the one thing in the image that IS
# compiled — the @openmig/* packages ship TypeScript and run under tsx, but a
# browser cannot. Built with `--base=/ui/` and VITE_EDITION=selfhost, which the
# `build:selfhost` script sets, so the bundle matches the mount the appliance
# serves it from and knows it has no login to offer.
RUN pnpm --filter @openmig/web build:selfhost

# ---- runtime: non-root, health-checked ----
FROM base AS runtime
ENV NODE_ENV=production
# Where the app reads mapping JSONs and stores state.
ENV CONFIG_DIR=/data/config
ENV PORT=8081
# Bind on all interfaces inside the container; publish is controlled by compose.
ENV HOST=0.0.0.0
# Where the entrypoint looks for the built UI. Set explicitly rather than left
# to the module-relative default so a change to the image layout fails loudly
# at /ui (which says how to build it) instead of silently serving nothing.
ENV SELFHOST_UI_DIR=/app/apps/web/dist-selfhost
COPY --from=build /app /app
# Copy default config into the image (can be overridden by mounted volume).
COPY deploy/selfhost/config /app/config
# Non-root runtime user; owns /app and the /data mount point.
RUN useradd --system --uid 10001 --home-dir /app appuser \
  && mkdir -p /data/config \
  && cp -r /app/config/* /data/config/ \
  && chown -R appuser:appuser /app /data
USER appuser
EXPOSE 8080
# DATABASE_URL and any tokenFromEnv/passwordFromEnv secrets come from the
# compose env-file. The status server answers /healthz once migrations applied.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@openmig/selfhost", "exec", "tsx", "src/index.ts"]
