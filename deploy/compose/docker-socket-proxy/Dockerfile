# The Docker socket proxy between the Trigger.dev supervisor and the host's
# Docker socket (managed.yml's trigger-docker-proxy), built here: Tecnativa's
# docker-socket-proxy at its release v0.5.0, on the newest HAProxy of the same
# line (workplan 0119, 2026-10-30).
#
# WHY IT IS BUILT HERE. The service ran `tecnativa/docker-socket-proxy:v0.5.0`,
# pushed to Docker Hub on 2026-07-27 and not rebuilt since. Docker Hub lists no
# newer release, only `master` and `nightly`, which are no release. That image
# is upstream's Dockerfile at v0.5.0 on `haproxy:3.4.2-alpine` as the tag was
# then, Alpine 3.24.1, and the image scan of 2026-10-29 (Security Scan run
# 40843566092, Trivy v0.76.1, linux/arm64) read 0 critical and 6 high findings
# in it, all 6 fixed in a newer Alpine package. Read from the two images'
# package databases (linux/arm64, 2026-10-30), the packages that differ between
# that base and this one are apk-tools and libapk 3.0.6 to 3.0.8,
# ca-certificates 20260611 to 20261020, libcrypto3 and libssl3 (openssl) 3.5.7
# to 3.5.9, musl and musl-utils 1.2.6-r2 to -r3, pcre2 10.47 to 10.49 and zlib
# 1.3.2-r0 to -r1. Upstream's image had exactly 3.4.2-alpine's packages.
#
# WHAT IT IS. Upstream's own Dockerfile at the tag v0.5.0
# (github.com/Tecnativa/docker-socket-proxy, commit 2e118a0c), with the two
# files it copies beside it, byte for byte: haproxy.cfg (git blob d61b1d4d) and
# docker-entrypoint.sh (git blob 2303cee2, mode 755). Upstream's licence is
# Apache-2.0, as this repository's is. Two things differ, and nothing else:
#
#   1. The base. Upstream's FROM is `haproxy:3.4.2-alpine`, by tag alone. This
#      one is the newest release of the same line, 3.4.7, on Alpine 3.24.3, by
#      the digest of its index, pushed by Docker Hub on 2026-10-24 17:56 UTC and
#      taken on 2026-10-30, past the three-day floor (CONTRIBUTING.md). Its
#      platforms include linux/amd64 and linux/arm64. The base's user,
#      entrypoint, command, working directory and stop signal are the same at
#      3.4.2 and 3.4.7, read from the registry on 2026-10-30.
#   2. One RUN, after the two COPY lines, that checks both files by SHA-256 and
#      the entrypoint's executable bit. The name managed.yml builds this under
#      hashes this file's instruction lines and nothing else (THE NAME, below),
#      so the files' hashes are written into one: a file that changes fails the
#      build until that line moves, and the name moves with it. It adds nothing
#      to the image.
#
# The rest is upstream's, in upstream's order: the port, every environment
# variable with its default, the two COPY lines, the server-state file, `USER
# root` and the command. So the image takes the environment managed.yml sets
# (CONTAINERS, IMAGES, NETWORKS, VOLUMES and POST) and allows and refuses what
# upstream's v0.5.0 does. images.yml's `build (docker-socket-proxy)` builds it
# on a pull request that touches deploy/, starts it on the runner's Docker
# socket with managed.yml's environment, and asks it for what the supervisor
# uses and for what it must refuse.
#
# THE NAME. managed.yml builds this as
# `localhost/docker-socket-proxy:<base tag>-<12 hex>`, a name no registry
# serves, with `pull_policy: never`, as deploy/compose/postgres/Dockerfile's
# header says for the databases. The twelve hex digits are the SHA-256 of this
# file's instruction lines, comments and blank lines left out,
#   grep -Ev '^[[:space:]]*(#|$)' deploy/compose/docker-socket-proxy/Dockerfile | sha256sum | cut -c1-12
# so a changed instruction is a name the machine does not have yet, and `up`
# builds it. Nothing builds it while the machine has the name (managed.yml's
# header). scripts/a-tag-upstream-never-rebuilds.unit.test.ts holds the image
# line to it, and when an instruction changes, its failure prints the `sed`
# that moves the line. No parser directive, no ADD and no --mount, and no COPY
# but upstream's two, of the files the check names.
#
# HOW IT MOVES.
#   - A newer HAProxy 3.4, or a rebuild of the tag: Dependabot's pull request
#     (.github/dependabot.yml, this directory's own entry, patches and digests
#     only). It fails the guard until the image line moves too, and the failure
#     prints the `sed`. Read HAProxy's notes for the release, and dispatch E2E
#     (managed) on its branch: the supervisor starts every task run through
#     this proxy.
#   - A newer release of docker-socket-proxy: the pin watch's summary issue
#     lists it (scripts/idp-pin-watch.mjs, against upstream's git tags). In a
#     pull request of its own, copy haproxy.cfg and docker-entrypoint.sh at the
#     new tag, write its Dockerfile's instructions here, with its FROM's tag by
#     the digest of its index, and move the release named below, the two
#     hashes, the name, and the guard's record of upstream's files.
#   - Another HAProxy line (3.4 to 3.5, or the next long-term 3.6): the
#     owner's call. Upstream chose 3.4 at v0.5.0, and Dependabot is told to
#     leave the line alone.
#
# docker-socket-proxy v0.5.0
FROM haproxy:3.4.7-alpine@sha256:2caaf8b1a1ef67f3f1ea9b721f2821675d3ba4500fb518e23884fecb93e8dbaa

EXPOSE 2375
ENV ALLOW_RESTARTS=0 \
    ALLOW_STOP=0 \
    ALLOW_START=0 \
    AUTH=0 \
    BUILD=0 \
    COMMIT=0 \
    CONFIGS=0 \
    CONTAINERS=0 \
    DISABLE_IPV6=0 \
    DISTRIBUTION=0 \
    EVENTS=1 \
    EXEC=0 \
    GRPC=0 \
    IMAGES=0 \
    INFO=0 \
    LOG_LEVEL=info \
    NETWORKS=0 \
    NODES=0 \
    PING=1 \
    PLUGINS=0 \
    POST=0 \
    SECRETS=0 \
    SERVICES=0 \
    SESSION=0 \
    SOCKET_PATH=/var/run/docker.sock \
    SWARM=0 \
    SYSTEM=0 \
    TASKS=0 \
    VERSION=1 \
    VOLUMES=0
COPY docker-entrypoint.sh /usr/local/bin/
COPY haproxy.cfg /usr/local/etc/haproxy/haproxy.cfg.template
# Not upstream's: the two files above by SHA-256, so the name covers them (the header).
RUN printf '%s  %s\n' \
      2cd4c4414b7693fed10160386b2ba394b6e3bca55c61a773fb5225ea45606059 /usr/local/bin/docker-entrypoint.sh \
      2de85de4cac6c8ae93de8be68d69b655533a77e1f5170b625e0eed4b126e8b4d /usr/local/etc/haproxy/haproxy.cfg.template \
    | sha256sum -c - \
    && test -x /usr/local/bin/docker-entrypoint.sh
RUN touch /var/lib/haproxy/server-state
USER root
CMD ["haproxy", "-f", "/tmp/haproxy.cfg"]
