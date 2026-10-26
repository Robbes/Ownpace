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
# (apps/selfhost/Dockerfile, apps/web/Dockerfile). Here it is the BUILD's base
# only: the install runs on it, and the runtime stage below is distroless, with
# a Node of its own. That Node must be this tag's version, and the managed smoke
# checks it on every run (deploy/compose/smoke-managed.sh, the preflights).
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
#
# Then /app is made READABLE BY EVERYONE AND WRITABLE BY ROOT ALONE, whatever
# modes the checkout gave its files (a umask of 077 writes them 0600, and COPY
# keeps a mode). The runtime stage copies this tree as root's, and the API,
# which runs as 65532, reads its code and cannot rewrite it (workplan 0146
# T13). In the install's own RUN, so node_modules is written once and not copied
# up into a second layer, and last in the stage the runtime copies from, so
# nothing after it writes a file with another mode.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @openmig/api... \
 && chmod -R u=rwX,go=rX /app

# THE RUNTIME IS DISTROLESS (workplan 0146 T13): Google's
# gcr.io/distroless/nodejs24-debian13 at its `nonroot` tag, by digest. Debian
# 13.7 with fourteen packages (libc6, libssl3t64, libstdc++6, ca-certificates,
# tzdata and the like) and Node, and nothing else: no shell, no coreutils, no
# package manager, no perl, util-linux or ncurses. On 2026-10-25 Trivy 0.76.1
# read 0 critical and 0 high findings in it, on amd64 and arm64 alike, where
# the Node image above, with the package managers removed that this stage
# removed until T13, read 0 and 43 (none with a fix), and Debian 12's
# `node:24.22.1-slim` 1 and 61. On that day its /nodejs/bin/node was the base
# stage's /usr/local/bin/node byte for byte (sha256 e32e2d16... on amd64,
# c8c57216... on arm64).
#
# THE SAME NODE VERSION AS THE FROM NODE LINE ABOVE, CHECKED, NOT ASSUMED. The
# managed tasks copy Node out of that line (apps/worker/trigger.config.ts), and
# the two pins move apart: Dependabot moves the node tag, and this digest when
# the `nonroot` tag moves. Nothing reads the version off this image either (the
# `nonroot` tag names none, and Trivy lists no Node runtime in it). So the
# managed smoke's preflights ask the API container's Node for its version and
# stop when it is not that line's x.y.z: an E2E (managed) on a change that moves
# one pin and not the other goes red there (deploy/compose/smoke-managed.sh,
# `api_node` and `dockerfile_node`).
#
# What that takes, wherever the container is reached:
# - No RUN in this stage: there is nothing to run one with. The files come in
#   by COPY as root's, readable by all and writable by root alone (the build
#   stage's last RUN): the API reads its code and cannot rewrite it.
# - Node is /nodejs/bin/node and is NOT on the PATH. ENTRYPOINT and the
#   HEALTHCHECK name it; `docker exec <api> node ...` finds nothing.
# - Nothing execs a shell, `printenv` or a bare `node` into this container. A
#   variable the API was started with is read from Docker (`docker container
#   inspect`, `.Config.Env`), which answers the same for this image and the
#   Node images before it; a probe from inside the container's network runs
#   Node by its absolute path, and the smoke's `api_node` also finds
#   /usr/local/bin/node on an older image (deploy/compose/smoke-managed.sh).
# - The user is distroless's `nonroot`, uid and gid 65532; it was a system
#   `appuser`, uid 10001, which owned /app. The API writes nothing to disk, and
#   the api service mounts no volume (deploy/compose/managed.yml), so no file
#   outside the image was ever that uid's, and none inside it is now.
#
# The digest is the `nonroot` tag's, and Dependabot moves it when the tag
# moves. The tag names no Node version; the image's name names the major, so a
# new Node major is a new name, which is an edit somebody makes.
# scripts/an-api-image-with-nothing-to-exec.unit.test.ts holds all of the above.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8 AS runtime
ENV NODE_ENV=production
# Surfaced by GET /version (buildIdentity in @openmig/core).
ARG GIT_SHA=unknown
ENV OPENMIG_COMMIT=$GIT_SHA
COPY --from=build /app /app
WORKDIR /app
USER 65532:65532
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# DATABASE_URL / APP_DATABASE_URL / JWT_SECRET / SECRET_ENCRYPTION_KEY come from compose env.
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["apps/api/src/index.ts"]
