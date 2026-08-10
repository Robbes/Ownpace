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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @openmig/web build

FROM nginx:1.27-alpine AS runtime
ENV API_UPSTREAM=api:3001
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:80/ || exit 1
