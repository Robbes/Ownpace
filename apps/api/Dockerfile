# syntax=docker/dockerfile:1
#
# Runs the managed API. The workspace packages (@openmig/*) ship TypeScript
# source (their package.json "main"/"exports" point at src/*.ts, there is no JS
# build), so the app runs the .ts entrypoint directly. Node does that itself
# since 22.18 — it ERASES the types and runs the result, no transpiler in the
# image. tsx used to do this job and no longer needs to.
#
# Two source-level invariants make that possible, both enforced by
# tsconfig.base.json rather than by hope: `erasableSyntaxOnly` (nothing that
# needs emitting, e.g. parameter properties) and `verbatimModuleSyntax` (every
# type-only import marked, because an eraser cannot infer it). Every relative
# import also carries its file extension, because Node's resolver does not
# guess. Break any of the three and this CMD fails at startup.
#
# Copying the whole /app between stages preserves pnpm's node_modules symlink
# layout.

# Same node:24-slim digest the selfhost image pins (apps/selfhost/Dockerfile).
FROM node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
# `--filter @openmig/api...` = this app AND its workspace dependencies. Measured
# against an unfiltered install of the same tree: 698 packages instead of 800,
# and no node_modules for apps/web, apps/worker, apps/selfhost or
# packages/testing — none of which this image runs.
#
# It does NOT drop the workspace ROOT's dependencies; pnpm installs those
# whatever the filter says, so the root's devDependencies land here regardless
# of the filter. See apps/web/Dockerfile, where believing otherwise cost a
# wrong claim. CMD no longer depends on that being true — it invokes `node`
# directly — but the install still behaves this way.
#
# THIS IS A RUNTIME IMAGE, not a build one, so a pruned package is a resolution
# failure in production rather than a red build. Two things cover that:
# `scripts/workspace-deps.unit.test.ts` asserts every `@openmig/*` specifier in
# this app's source — static, dynamic `import()` and `require()` alike — is a
# DECLARED dependency, which is exactly what the filter follows; and the managed
# gate's first preflight is `curl $API/health`, so an image that cannot resolve
# its own modules fails loudly at the top of the run.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @openmig/api...

FROM base AS runtime
ENV NODE_ENV=production
# Surfaced by GET /version (buildIdentity in @openmig/core).
ARG GIT_SHA=unknown
ENV OPENMIG_COMMIT=$GIT_SHA
COPY --from=build /app /app
# Non-root runtime user.
RUN useradd --system --uid 10001 --home-dir /app appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# DATABASE_URL / APP_DATABASE_URL / JWT_SECRET / SECRET_ENCRYPTION_KEY come from compose env.
CMD ["node", "apps/api/src/index.ts"]
