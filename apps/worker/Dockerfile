# syntax=docker/dockerfile:1
#
# Runs the managed edition's job worker (ADR-0054, workplan 0167 T7): pg-boss
# on the ledger's Postgres, one forked Node process per run. Built the way
# apps/api/Dockerfile builds the API, on its two images, and read beside it:
# its header says why each line below is what it is, and this one says only
# where the two differ.
#
# THE SAME TWO FROM LINES AS apps/api/Dockerfile, tag and digest, in the same
# order. The worker runs the same workspace packages as the API, on the same
# Node, and the managed smoke holds the API's Node to the FROM node line's
# version; one pair of pins for both keeps that check true of the worker too.
# Dependabot moves this directory in the API's group (.github/dependabot.yml),
# and scripts/a-worker-image-on-the-apis-base.unit.test.ts fails while the two
# files' FROM lines differ, or the runtime stage stops being what it is below.
FROM node:26.13.1-trixie-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g --omit=dev corepack@0.36.0 && corepack enable
WORKDIR /app

FROM base AS deps
COPY . .
# PRODUCTION DEPENDENCIES OF THE WORKER ONLY: `--filter-prod @openmig/worker...`
# is the worker and the workspace packages its `dependencies` reach, along
# production edges, and `--prod` installs their production dependencies and
# nothing else (scripts/an-image-that-shipped-what-it-never-runs.unit.test.ts
# walks the same closure and holds every package its runtime source loads to
# that package's own `dependencies`). pg-boss comes with @openmig/scheduler.
# Nothing of Trigger.dev's comes since alpha.18, which removed it (0167 T9).
#
# Then /app readable by everyone and writable by root alone, as the API's: the
# worker, uid 65532, reads its code and cannot rewrite it.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter-prod @openmig/worker... \
 && chmod -R u=rwX,go=rX /app

# THE RUNTIME IS THE API'S DISTROLESS, by the same digest: Node at
# /nodejs/bin/node, off the PATH, no shell, no package manager, no RUN
# possible. The worker writes nothing to disk but what a run's own child may
# put in /tmp, which the compose service keeps in memory on a read-only root
# (deploy/compose/managed.yml, `worker`), and it logs to stdout and stderr
# only.
FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:ffa8a7545403036c94ec76674b5dbac2d425af2d679147cdf3e30180071487b7 AS runtime
ENV NODE_ENV=production
# THE COMMIT IN THE IMAGE, as the API's (images.yml passes GIT_SHA, and the
# bring-up builds the api with it; it builds this one the same way once it
# starts the worker): a new commit is a new image, so every release replaces the
# worker's container as it replaces the API's, and the output that went with
# the old one (privacy §9: server logs go at each update of the service).
# scripts/a-worker-image-on-the-apis-base.unit.test.ts holds the two lines.
ARG GIT_SHA=unknown
ENV OPENMIG_COMMIT=$GIT_SHA
COPY --from=deps /app /app
WORKDIR /app
USER 65532:65532
# The worker's health answers on loopback inside its own container, and nowhere
# else: no EXPOSE, no published port. 200 once the runner has started (schema
# checked, queues declared, workers started), 503 while it starts or stops.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# JOBS_DATABASE_URL, SYSTEM_DATABASE_URL, APP_DATABASE_URL and the rest come
# from the compose service's environment; never the owner's URL.
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["apps/worker/src/runner/main.ts"]
