# syntax=docker/dockerfile:1
#
# Builds the Vite React app to static assets and serves them with nginx on :80.
#
# Vite bakes VITE_* vars at BUILD time — managed.yml passes VITE_API_URL as a
# build arg (never as runtime env, which a static build would ignore). The
# default, /api, keeps API calls same-origin; nginx.conf.template proxies them
# to the api service (override the target with API_UPSTREAM at runtime).
# nginx runs as the image's own nginx user, uid 101, from its first process,
# master and workers alike (the runtime stage says what that takes); until
# 2026-11-19 its master ran as root, the official image's standard split.

# The same node tag and digest the selfhost image pins (apps/selfhost/Dockerfile).
# Node 26 since 2026-10-31; corepack comes from npm because the Node 26 image
# ships none (apps/api/Dockerfile says why), the same line in all three.
FROM node:26.13.1-trixie-slim@sha256:abe7e5a82b61a8ef67b315b85497c9e65173387ccf2f4a029248184b8e020be5 AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g --omit=dev corepack@0.36.0 && corepack enable
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
# A PATH AT THIS ORIGIN, NEVER AN ADDRESS (workplan 0158). The app's policy
# (nginx.conf.template) lets the page connect to its own origin and the sign-in
# host only. A bundle built to call its API at another address could reach
# nothing there: the sign-in page offered no way in, and nothing said why.
# The image's nginx proxies /api/ to the API, so the API is always at a path.
RUN case "$VITE_API_URL" in ''|/|/[!/]*) ;; *) echo "VITE_API_URL is not a path at the app's origin ($VITE_API_URL): the app's policy connects to its own origin and the sign-in host only" >&2; exit 1;; esac
ENV VITE_API_URL=$VITE_API_URL
# Surfaced by the sidebar's build stamp, and by GET /version on the api and
# selfhost images which already take this same argument. A static bundle cannot
# ask at runtime what it was built from, so it is stamped in here.
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
# THE ISSUER, WITHOUT WHICH THERE IS NO SIGN-IN BUTTON.
#
# `setup-zitadel.sh` writes these into `.env` and `bootstrap-managed.sh` reloads
# it with the comment "the build below has to see them". It could not: a compose
# build arg is a separate boundary from the shell's environment, and nothing
# declared these, so Vite inside this stage never saw them. `oidcConfig()`
# returned null on every managed build ever made, and `Login.tsx` rendered the
# paste box ALONE — the authorization-code flow ADR-0042 specifies was
# unreachable from the UI since the day it was written.
#
# Nothing caught it because nothing asked the BUNDLE. The smoke signs in against
# the provider's endpoints with curl, and the browser suite mocks `oidcConfig`
# and signs in by pasting a token, so both proved sign-in works while the screen
# offered no way to do it. Reported from the reference box on 2026-08-25.
ARG VITE_OIDC_ISSUER=
ENV VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER
ARG VITE_OIDC_CLIENT_ID=
ENV VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
# Where the legal pages live, for every link the app makes to them (workplan
# 0139 T10). Empty is the production site (`services/legal-links.ts`).
ARG VITE_LEGAL_SITE_URL=
ENV VITE_LEGAL_SITE_URL=$VITE_LEGAL_SITE_URL
# Where the support screen links one person's account at the provider. Empty is
# the honest default — the screen then shows the address as plain text.
ARG VITE_IDP_CONSOLE_USER_URL=
ENV VITE_IDP_CONSOLE_USER_URL=$VITE_IDP_CONSOLE_USER_URL
# Whether this deployment runs the alpha (workplan 0131 T1): `alpha` shows the
# note on the signed-in pages, the sign-in page and the request page. managed.yml
# passes it from OWNPACE_STAGE. Empty, the default, is no note.
ARG VITE_OWNPACE_STAGE=
ENV VITE_OWNPACE_STAGE=$VITE_OWNPACE_STAGE
# The address a tester writes to (workplan 0144 T6 (a)): a line on the pages
# before sign-in, and "Help: …" in the sidebar when the report form is off.
# managed.yml passes it from .env. Empty, the default, shows nothing new.
ARG VITE_SUPPORT_EMAIL=
ENV VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL
RUN pnpm --filter @openmig/web build

# nginx's -alpine-slim (workplan 0146 T12a): the same nginx package on the same
# base layers as -alpine, without the dynamic modules -alpine adds (njs, xslt,
# geoip, image-filter, acme) or curl, none of which nginx.conf.template loads.
# envsubst and the entrypoint's template step are in slim; the health check
# below is busybox's wget, which slim keeps.
FROM nginx:1.31.10-alpine-slim@sha256:c293b28729906d97fa5302fce3bd79bd27a3ea9a5d9604e21c6ff0ebf14549fc AS runtime
ENV API_UPSTREAM=api:3001
# THE SIGN-IN HOST, FOR THE APP'S POLICY (workplan 0158). nginx.conf.template
# names it in the policy's connect-src, so the page may fetch the issuer's
# discovery document and token endpoint, and no other host. It is the argument
# the bundle above was built with, declared again because a stage sees only
# the arguments it declares, and handed to the template step as ENV. A policy
# source with a path matches that one path, so sign-in could not fetch its
# discovery document: an issuer with a path is refused here instead. That
# includes Keycloak's /realms/<name>; switching to such an issuer means the
# policy names its origin instead (ADR-0042, amended 2026-10-05).
ARG VITE_OIDC_ISSUER=
RUN case "$VITE_OIDC_ISSUER" in *://*/?*) echo "VITE_OIDC_ISSUER has a path ($VITE_OIDC_ISSUER): the app's policy needs scheme://host[:port]" >&2; exit 1;; esac
ENV VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf
# AS NGINX'S OWN USER, FROM ITS FIRST PROCESS (workplan 0119, 2026-11-19). The
# official image starts nginx's master as root, which chowns its temp
# directories to `nginx` and drops its workers to it, so managed.yml kept
# CHOWN, NET_BIND_SERVICE, SETGID and SETUID for it. Here all of nginx runs as
# `nginx`, uid and gid 101 in the image's /etc/passwd, with no capability. It
# writes in three places, and only those become its own:
#   - /etc/nginx/conf.d, where the image's entrypoint renders the template at
#     every start. 20-envsubst-on-templates.sh renders nothing into a
#     directory it cannot write: it says "ERROR: ... is not writable", and
#     nginx starts without the app's server;
#   - /var/cache/nginx, where nginx makes its temp directories at start;
#   - its pid file, which the image's nginx.conf puts in /run, root's: it moves
#     to /tmp.
# nginx.conf's `user  nginx;` goes too: a master that is not root ignores it,
# and says so at every start. Each line is read before it is changed, so a
# base whose nginx.conf moved stops the build here. The rest of nginx.conf is
# the image's: its main level, and the http block the template is included in
# (scripts/an-error-log-that-kept-the-link.unit.test.ts runs that main level).
# Port 80 stays the container's: managed.yml's service sets
# net.ipv4.ip_unprivileged_port_start=0, as Docker does by default, so uid 101
# binds it.
RUN set -eu; \
    conf=/etc/nginx/nginx.conf; \
    for line in 'user  nginx;' 'pid        /run/nginx.pid;'; do \
      grep -qxF "$line" "$conf" || { echo "$conf has no line '$line': read apps/web/Dockerfile's runtime stage again against this nginx" >&2; exit 1; }; \
    done; \
    sed -i -e '/^user  nginx;$/d' -e 's|^pid        /run/nginx\.pid;$|pid        /tmp/nginx.pid;|' "$conf"; \
    if grep -q '^user[[:space:]]' "$conf" || ! grep -qxF 'pid        /tmp/nginx.pid;' "$conf"; then echo "$conf still names a user, or no pid file in /tmp" >&2; exit 1; fi; \
    [ "$(id -u nginx):$(id -g nginx)" = 101:101 ] || { echo "the image's nginx is $(id -u nginx):$(id -g nginx), not 101:101" >&2; exit 1; }; \
    chown 101:101 /etc/nginx/conf.d /var/cache/nginx
USER 101:101
EXPOSE 80
# Exec form: busybox's wget, which slim keeps, found on the PATH with no shell
# between. Docker counts any exit but 0 as a failed check, so it needs no
# `|| exit 1`.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["wget", "-qO", "/dev/null", "http://127.0.0.1:80/"]
