# The tasks' prebuilt base, published by CI as ghcr.io/robbes/ownpace-task-base
# (workplan 0119 §3 item 13; the owner's decision of 2026-11-03, for alpha.5):
# distroless, with the three things the Trigger.dev CLI's runtime stage needs
# from a base it builds nothing into. Built, signed and published by
# `.github/workflows/images.yml` (the build job's `task-base` leg), from main
# only, and built and started there on a pull request.
#
# WHAT THE CLI DOES ON A BASE OF ITS OWN (trigger.dev 4.8.3,
# `generateNodeContainerfile` and `parseGenerateOptions` in
# `dist/esm/deploy/buildImage.js`). The build manifest's `image.base` becomes
# the Containerfile's first stage, `FROM <base> AS base`, and the runtime stage
# is `FROM base AS final`. With no layer instructions and no packages, the base
# stage holds `ENV DEBIAN_FRONTEND=noninteractive` and nothing else: no apt,
# no repair (`aptRepair` is written only after instructions), and none of its
# trust edits (`trustStoreHardening` leaves a custom base alone). With
# `image.buildBase` named, the build stage starts from that image, not from
# this one, so `npm i` and the indexer run there. The runtime stage runs no
# RUN at all: `USER node`, `WORKDIR /app`, ARG and ENV lines, three
# `COPY --chown=node:node` from the other stages, and
# `ENTRYPOINT [ "dumb-init", "node", "<the run controller>" ]`. So a base with
# no shell builds, if it carries what those lines name:
#   - a `node` user and group in /etc/passwd and /etc/group, which `USER node`
#     and `--chown=node:node` resolve at build time. uid and gid 1000, the
#     Node image's `node`, which the tasks ran as until now;
#   - `dumb-init` and `node` on the PATH, which the exec-form ENTRYPOINT and
#     then dumb-init look up. distroless keeps Node at /nodejs/bin/node, off
#     its PATH, so the PATH below puts that directory first;
#   - the CA bundle with the CLI's trust edits, which its own base images make
#     and a custom one must make itself: the four roots the CLI distrusts
#     (`EMSIGN_COMPROMISE_DISTRUSTED_ROOTS`) turned off in
#     /etc/ca-certificates.conf, and the eight eMudhra intermediates it rejects
#     (`EMSIGN_REJECT_DIR`), kept byte for byte in ./emsign-block. Node reads
#     the bundle under `--use-openssl-ca` and `SSL_CERT_FILE`, set below as the
#     CLI sets them.
# `scripts/a-task-base-the-cli-builds-nothing-into.unit.test.ts` runs the
# installed CLI's own generator and holds all of it: a CLI that starts to
# write a RUN into the base or the runtime stage fails it (item 13's revisit).
#
# WHAT IT IS BUILT FROM. The runtime is the API's: distroless Node at the
# digest apps/api/Dockerfile's runtime stage names (Node 26.13.0 there, read
# 2026-11-06, and at the digest below on 2026-11-11). The build stage is the
# image apps/api/Dockerfile builds FROM, Debian 13: apt installs
# `ca-certificates` and `dumb-init` there, the trust
# edits are made there, and only the bundle, dumb-init, the two account files,
# dumb-init's dpkg record and an empty home leave it. dumb-init needs no
# library but the C library, which distroless carries (the build refuses one
# that needs more). Its dpkg record goes where distroless keeps one per
# package (/var/lib/dpkg/status.d), so a scan reads its version.
# distroless's `ca-certificates` record stays: its
# version is the build stage's (20250419+deb13u1 on 2026-11-06, and
# distroless's the same at the digest below, read 2026-11-11), and the build
# below refuses another. Both digests move with apps/api/Dockerfile's, and the
# guard holds them equal: Dependabot's group takes a version's move to every
# directory at once, but a digest-only move comes alone in each, red until one
# pull request moves them together (workplan 0119, 2026-11-11).
#
# NOTHING RUNS IN THE RUNTIME STAGE: it has no shell to run it with. It is
# distroless's own files with five COPY lines over them, and its user, PATH,
# environment and entrypoint.
#
# What reads the published image: `apps/worker/trigger.config.ts`, which names
# it by its `sha-<commit>` tag and index digest (TASK_BASE_IMAGE, since
# 2026-11-06) and adds no layer to it; images.yml's `task-base-pin` job pulls
# and verifies that pin on a pull request, release-verify.mjs at the tag, and
# the pin watch lists it behind once main publishes a base with other layers.
# A change here that moves what the image is built from (a FROM line, what the
# build stage installs, the certificates) reaches the tasks only with that
# pin; one to these comments changes no layer.

FROM gcr.io/distroless/nodejs26-debian13:nonroot@sha256:33c86a63859efc2ebd88ea0a355863582ec6f1220d048de62baffb2584e709b3 AS distroless

FROM node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*
# The eight intermediates, byte for byte as the CLI writes them into its own images.
COPY emsign-block/ /usr/local/share/ca-certificates/emsign-block/
# The CLI's edit of the roots, as it writes it at 4.8.3, then the checks: each
# of the four that Debian still ships is off in the configuration and absent
# from the bundle, the eight are in it, and dumb-init is /usr/bin/dumb-init and
# needs no library but the C library.
RUN set -eu \
  && roots='emSign_ECC_Root_CA_-_G3 emSign_Root_CA_-_C1 emSign_ECC_Root_CA_-_C3 Comodo_AAA_Services_root' \
  && sed -i -E "s#^(mozilla/($(echo "$roots" | tr ' ' '|'))\\.crt)\$#!\\1#" /etc/ca-certificates.conf \
  && update-ca-certificates --fresh \
  && bundle=/etc/ssl/certs/ca-certificates.crt \
  && for root in $roots; do \
       pem="/usr/share/ca-certificates/mozilla/${root}.crt"; \
       if [ -e "$pem" ]; then \
         grep -qxF "!mozilla/${root}.crt" /etc/ca-certificates.conf || { echo "${root} is not turned off in /etc/ca-certificates.conf" >&2; exit 1; }; \
         if grep -qxF "$(sed -n 2p "$pem")" "$bundle"; then echo "${root} is still in ${bundle}" >&2; exit 1; fi; \
       fi; \
     done \
  && rejected="$(ls /usr/local/share/ca-certificates/emsign-block/*.crt | wc -l)" \
  && in_bundle="$(grep -c '^-----BEGIN TRUSTED CERTIFICATE-----$' "$bundle" || true)" \
  && if [ "$rejected" != 8 ] || [ "$in_bundle" != 8 ]; then echo "the bundle holds ${in_bundle} of the ${rejected} rejected intermediates, and both must be 8" >&2; exit 1; fi \
  && dumb_init="$(readlink -f "$(command -v dumb-init)")" \
  && if [ "$dumb_init" != /usr/bin/dumb-init ]; then echo "dumb-init is ${dumb_init}, not /usr/bin/dumb-init" >&2; exit 1; fi \
  && if ldd "$dumb_init" > /tmp/dumb-init.ldd 2>&1; then \
       needs="$(awk '$1 !~ /^(linux-vdso[.]so[.]1|libc[.]so[.]6|\/lib(64)?\/ld-linux[^ ]*)$/ { print $1 }' /tmp/dumb-init.ldd)"; \
       if [ -n "$needs" ]; then echo "${dumb_init} needs ${needs}, and the runtime stage copies it alone" >&2; exit 1; fi; \
     fi
COPY --from=distroless /etc/passwd /etc/group /out/etc/
COPY --from=distroless /var/lib/dpkg/status.d/ca-certificates /distroless/ca-certificates
# The account files: distroless's own, and `node` with the Node image's uid and
# gid, its home, and distroless's no-login shell. The rest of what leaves.
RUN set -eu \
  && want="$(dpkg-query -W -f '${Version}' ca-certificates)" \
  && have="$(sed -n 's/^Version: //p' /distroless/ca-certificates)" \
  && if [ "$have" != "$want" ]; then echo "distroless's ca-certificates is ${have}, and the bundle was made by ${want}: read the header again" >&2; exit 1; fi \
  && uid="$(id -u node)" && gid="$(id -g node)" \
  && if [ "$uid:$gid" != 1000:1000 ]; then echo "the Node image's node is ${uid}:${gid}, not 1000:1000" >&2; exit 1; fi \
  && if grep -q '^node:' /out/etc/passwd /out/etc/group; then echo "distroless already has a node account" >&2; exit 1; fi \
  && echo "node:x:${uid}:${gid}:node:/home/node:/sbin/nologin" >> /out/etc/passwd \
  && echo "node:x:${gid}:" >> /out/etc/group \
  && mkdir -p /out/etc/ssl/certs /out/usr/bin /out/var/lib/dpkg/status.d /out/home/node \
  && cp /etc/ssl/certs/ca-certificates.crt /out/etc/ssl/certs/ \
  && cp /usr/bin/dumb-init /out/usr/bin/ \
  && dpkg-query -s dumb-init > /out/var/lib/dpkg/status.d/dumb-init \
  && cp /var/lib/dpkg/info/dumb-init.md5sums /out/var/lib/dpkg/status.d/dumb-init.md5sums \
  && chown "${uid}:${gid}" /out/home/node

FROM distroless AS task-base
COPY --from=build /out/etc/passwd /out/etc/group /etc/
COPY --from=build /out/etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/usr/bin/dumb-init /usr/bin/dumb-init
COPY --from=build /out/var/lib/dpkg/status.d/ /var/lib/dpkg/status.d/
COPY --from=build --chown=1000:1000 /out/home/node /home/node
ENV PATH=/nodejs/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  NODE_OPTIONS=--use-openssl-ca \
  SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
USER node
WORKDIR /home/node
ENTRYPOINT ["dumb-init", "node"]
