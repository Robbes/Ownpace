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

# The same node tag and digest the selfhost and web images pin
# (apps/selfhost/Dockerfile, apps/web/Dockerfile).
#
# DEBIAN 13 ("trixie"), NAMED IN THE TAG. The bare `-slim` tag is Debian 12
# ("bookworm"): on 2026-10-25 Trivy 0.76.1 read 1 critical and 61 high findings
# in `node:24.22.1-slim` and 0 and 48 in this image, on amd64 and arm64 alike,
# and none of the 43 Debian ones left has a fix. Node is the same file in both,
# byte for byte, and the managed tasks copy it out of this image
# (apps/worker/trigger.config.ts). Dependabot keeps the suffix when it moves the
# tag. scripts/a-base-image-that-carried-what-nothing-runs.unit.test.ts holds
# the three FROM lines to one string and the tag to a named Debian release.
FROM node:24.22.1-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS base
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
# NO PACKAGE MANAGER AT RUNTIME. CMD and the HEALTHCHECK run `node`, and nothing
# execs npm, npx, pnpm, yarn or corepack into this container. npm's bundled
# undici, brace-expansion and http-cache-semantics were the base image's 5
# high Node.js findings. The tasks copy /usr/local/bin/node out of the FROM
# image, not out of this stage, so this changes nothing for them.
# The whole global-modules directory goes, not npm and corepack by name: they
# are all it holds in this base, and a package manager a later base stage
# installs with `npm install -g` (Node 25 and later ship no corepack) lands
# there too, so it goes with them.
RUN rm -rf /usr/local/lib/node_modules \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    /opt/yarn-v*
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
