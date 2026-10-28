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

FROM base AS deps
COPY . .
# PRODUCTION DEPENDENCIES ONLY (`--prod`), and nothing builds: there is no JS
# build, and Node erases the types at start. This stage used to install
# everything, and the runtime copied it, so drizzle-kit's esbuild and TypeScript
# 7's native compiler were in the image, and their Go binaries were 2 of its 3
# critical and 65 of its 125 high findings (the edge image, 2026-10-23). Nothing
# in the container runs them. CMD and the HEALTHCHECK are `node`; the smoke
# gate's `docker exec` probes are `node -e` with Node's own fetch, or
# `printenv`; the operator scripts and the demo seed run on the HOST, from the
# checkout (deploy/compose/operator.sh, seed-managed.sh); the migrations are the
# API's own start-up code, which reads the SQL in packages/*/migrations.
#
# `--filter-prod @openmig/api...` = this app AND the workspace packages its
# `dependencies` reach (pnpm follows `optionalDependencies` and
# `peerDependencies` too); the workspace root's `dependencies` come too,
# whatever the filter says (apps/web/Dockerfile). Not `--filter`: its `...`
# also follows devDependencies, and @openmig/core and @openmig/ledger list
# workspace packages there, so a workspace package only a test reaches would
# be selected and `--prod` would install ITS production dependencies. Measured
# on 2026-10-25: 9 of the 14 workspace projects and 250 packages, the same
# tree `--filter` gave that day; the full install of the same filter had 622.
#
# Not `pnpm deploy --prod`. It copies each workspace package INTO node_modules,
# and Node refuses to strip types under a node_modules path: the deployed tree
# failed at its first import with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
# A plain install keeps apps/api/node_modules/@openmig/* as symlinks into
# packages/, outside node_modules.
#
# THIS IS A RUNTIME IMAGE, not a build one, so a missing package is a
# resolution failure in production rather than a red build. With `--prod` that
# includes anything a runtime file imports that its own package declares only
# as a devDependency, or not at all: it used to resolve through the root's
# devDependencies, and now nothing installs those. apps/api and
# packages/orchestration imported drizzle-orm (and orchestration pg) that way
# until they declared them. Three things cover it:
# `scripts/an-image-that-shipped-what-it-never-runs.unit.test.ts` asserts every
# package a runtime file of this closure loads is in its own `dependencies`,
# and that no stage the runtime takes files from installs devDependencies;
# `scripts/workspace-deps.unit.test.ts` asserts every `@openmig/*` specifier is
# declared, which is what the filter follows; and the managed gate's first
# preflight is `curl $API/health`, so an image that cannot resolve its own
# modules fails loudly at the top of the run.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter-prod @openmig/api...

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
COPY --from=deps /app /app
# Non-root runtime user.
RUN useradd --system --uid 10001 --home-dir /app appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# DATABASE_URL / APP_DATABASE_URL / JWT_SECRET / SECRET_ENCRYPTION_KEY come from compose env.
CMD ["node", "apps/api/src/index.ts"]
