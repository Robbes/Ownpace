# syntax=docker/dockerfile:1
#
# Builds the Vite React app to static assets and serves them with nginx on :80.
#
# Vite bakes VITE_* vars at BUILD time — managed.yml passes VITE_API_URL as a
# build arg (never as runtime env, which a static build would ignore). The
# default, /api, keeps API calls same-origin; nginx.conf.template proxies them
# to the api service (override the target with API_UPSTREAM at runtime).
# nginx master runs as root, its workers as the image's nginx user — the
# official image's standard split.

# Same node:24-slim digest the selfhost image pins (apps/selfhost/Dockerfile).
FROM node@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
# `--filter @openmig/web...` = this package AND its workspace dependencies.
# Building a static SPA does not need the other twelve projects linked: it
# saves 67 of 800 packages in the virtual store and skips a node_modules tree
# for each app and package the web build never imports. Measured, not assumed.
#
# WHAT IT DOES NOT DO, because I claimed otherwise first and was wrong: it does
# not stop `cpu-features` failing to compile. pnpm installs the WORKSPACE
# ROOT's dependencies whatever the filter says, and that is where
# `testcontainers` lives — so ssh2's optional native dep is pulled in either
# way. The evidence that looked like success was a warm pnpm store, which had
# the package already built and printed nothing. That is denied in
# `pnpm-workspace.yaml`'s allowBuilds instead, where it takes effect for every
# install rather than this one image.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @openmig/web...

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# Surfaced by the sidebar's build stamp, and by GET /version on the api and
# selfhost images which already take this same argument. A static bundle cannot
# ask at runtime what it was built from, so it is stamped in here.
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
RUN pnpm --filter @openmig/web build

FROM nginx:1.27-alpine AS runtime
ENV API_UPSTREAM=api:3001
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:80/ || exit 1
