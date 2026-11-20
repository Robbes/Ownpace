# The Docker socket proxy between the Trigger.dev supervisor and the host's
# Docker socket (managed.yml's trigger-docker-proxy), built here: Tecnativa's
# docker-socket-proxy at its release v0.6.0, on the newest HAProxy of the same
# line (workplan 0119, 2026-10-30; v0.6.0 since 2026-11-20, v0.5.0 before).
#
# WHY IT IS BUILT HERE. The service ran `tecnativa/docker-socket-proxy:v0.5.0`,
# pushed to Docker Hub on 2026-07-27 and not rebuilt since. Docker Hub lists no
# newer release: besides `latest`, which is v0.5.0 itself, only `master`,
# `nightly` and builds of upstream's pull requests, which are no release, and
# v0.5.0 is upstream's newest git tag. That image is upstream's Dockerfile at
# v0.5.0 on `haproxy:3.4.2-alpine` as the tag was then, Alpine 3.24.1, and the
# image scan of 2026-10-29 (Security Scan run 40843566092, Trivy v0.76.1,
# linux/arm64) read 0 critical and 6 high findings in it, all 6 fixed in a
# newer Alpine package. Read from the two images' package databases
# (linux/arm64, 2026-10-30), the packages that differ between that base and
# 3.4.7's build of 2026-10-24 were apk-tools and libapk 3.0.6 to 3.0.8,
# ca-certificates 20260611 to 20261020, libcrypto3 and libssl3 (openssl) 3.5.7
# to 3.5.9, musl and musl-utils 1.2.6-r2 to -r3, pcre2 10.47 to 10.49 and zlib
# 1.3.2-r0 to -r1. Upstream's image had exactly 3.4.2-alpine's packages.
# v0.6.0 pushes no image named for its release either: Docker Hub lists its
# build of 2026-11-17 as `lts`, `latest` (the same image) and `3.4` alone, and
# its README says those three are rebuilt weekly. A digest of one would pin a
# week's build, whose packages are what Alpine served that week, under a tag
# that names no release, so it is still built here.
#
# WHAT IT IS. Upstream's own Dockerfile at the tag v0.6.0
# (github.com/Tecnativa/docker-socket-proxy, commit 1d296629, the Dockerfile's
# git blob 8e06e203), with the directory it copies beside it, byte for byte:
# system_files/, whose two files are usr/local/bin/docker-entrypoint.sh (git
# blob 2303cee2, mode 755) and usr/local/etc/haproxy/haproxy.cfg.template (git
# blob d61b1d4d). They are v0.5.0's two files, the same blobs, which that
# release kept at the top as docker-entrypoint.sh and haproxy.cfg and copied
# one by one to the same two paths. Upstream's licence is Apache-2.0, as this
# repository's is. Three things differ, and nothing else:
#
#   1. The base. Upstream's is five lines: `ARG HAPROXY_VERSION=lts` and `FROM
#      haproxy:${HAPROXY_VERSION}-alpine`, HAProxy's long-term line by tag
#      alone, then `USER root`, `RUN apk upgrade --no-cache` and `USER
#      haproxy`, which upgrade every Alpine package while the image builds and
#      give the base's user back (v0.5.0's was `FROM haproxy:3.4.2-alpine`
#      alone). This one is one FROM: the newest release of the same line,
#      3.4.7, by the digest of its index: Docker Hub's rebuild of the tag on
#      Alpine 3.24.4, whose index it pushed on 2026-11-05 at 23:56 UTC, taken
#      on 2026-11-09, past the three-day floor (CONTRIBUTING.md). Its platforms
#      include linux/amd64 and linux/arm64. Against the tag's build of
#      2026-10-24 on Alpine 3.24.3, taken on 2026-10-30, the rebuild moves
#      alpine-release, apk-tools and libapk (3.0.8 to 3.0.9) and nothing else
#      but the build's own `.haproxy-rundeps` marker, on both platforms;
#      HAProxy is the same 3.4.7 source. Nothing upgrades it while it builds:
#      an upgrade installs what Alpine serves on the day of the build, which
#      the name below does not say, and the base moves by its digest instead,
#      in Dependabot's pull requests (HOW IT MOVES), where each move is read
#      and is a new name. `lts` named 3.4 when v0.6.0 was taken (Docker Hub's
#      `lts-alpine` was the index of `3.4-alpine` and `3.4.8-alpine`,
#      2026-11-20), the line v0.5.0 chose, and upstream builds `3.4` by name
#      too (its docker-bake.hcl), so the line stays. The base's user,
#      entrypoint, command, working directory and stop signal are the same at
#      3.4.2 and 3.4.7, read from the registry on 2026-10-30, and the
#      rebuild's again on 2026-11-09 and 2026-11-20. Its user is haproxy, so
#      upstream's `USER root` and `USER haproxy` around the upgrade end where
#      the base starts, and the two RUNs after the COPY run as haproxy here,
#      as upstream's one does.
#   2. One RUN, after the COPY, that checks both files by SHA-256 and the
#      entrypoint's executable bit. The name managed.yml builds this under
#      hashes this file's instruction lines and nothing else (THE NAME, below),
#      so the files' hashes are written into one: a file that changes fails the
#      build until that line moves, and the name moves with it. It adds nothing
#      to the image. Since 2026-11-19 it hashes each file on its own and
#      compares the hash with the one it names; until then it piped a list
#      into `sha256sum -c -`, and a RUN with no pipe needs no `pipefail`
#      (hadolint's DL4006).
#   3. The user it ends as: `USER 99:99`, the base's own haproxy user and
#      group by number, in the place of upstream's `USER root` (HOW IT RUNS,
#      below; since 2026-11-20).
#
# The rest is upstream's, in upstream's order: the port, every environment
# variable with its default, the COPY, the server-state file and the command.
# So the image takes the environment managed.yml sets
# (CONTAINERS, IMAGES, NETWORKS, VOLUMES and POST) and allows and refuses what
# upstream's v0.6.0 does, which is what v0.5.0 did: the same configuration,
# entrypoint and defaults, and its README lists the same switches (read on
# 2026-11-20). images.yml's `build (docker-socket-proxy)` builds it on a pull
# request that touches deploy/, starts it on the runner's Docker socket with
# managed.yml's environment, and asks it for what the supervisor uses, which
# Docker must answer, and for every endpoint switch left off, which the proxy
# must refuse with its own 403.
#
# HOW IT RUNS (since 2026-11-20, workplan 0119; until then `USER root`, as
# upstream's, which an outside, read-only check of the repository reported as
# GEN-21). As uid 99, the base's haproxy, which owns the server-state file the
# RUN above creates. Nothing the entrypoint or HAProxy does needs root here:
# the entrypoint renders haproxy.cfg into /tmp, and its `ulimit -n` may fail
# and is ignored; HAProxy writes its pidfile to /run, binds 2375, above 1024,
# and only reads the server-state file. managed.yml mounts /tmp and /run as
# tmpfs on a read-only root filesystem, which uid 99 can write. The socket is
# root's and a group's at mode 0660, whose id differs from host to host, so
# managed.yml adds that group to the container (`group_add`), read from the
# socket itself (`stat -L -c %g`) by seed_docker_socket_gid in env-read.sh,
# which ensure-env-secrets.sh and every bootstrap-managed.sh run write into
# .env, so nobody types it. Unset, Compose refuses to run anything: no
# fallback to root or to no group. With it, managed.yml still gives the proxy
# no capability, no-new-privileges and one internal network, which the
# supervisor alone shares: whoever can use the socket holds the host either
# way. images.yml's job starts it so on the runner's socket, with the
# socket's group, and fails unless the image's user is 99:99 and the running
# process is uid 99, not 0.
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
# but upstream's one, of system_files/, which holds the two files the check
# names and nothing else.
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
#     pull request of its own, copy system_files/ at the new tag, write its
#     Dockerfile's instructions here, its base as one FROM of the line's
#     newest release by the digest of its index, and move the release named
#     below, the two hashes, the name, and the guard's record of upstream's
#     Dockerfile and files.
#   - Another HAProxy line (3.4 to 3.5, or the next long-term 3.6): the
#     owner's call. Upstream chose 3.4 at v0.5.0, and at v0.6.0 builds `lts`,
#     which is 3.4 until the next long-term line, and `3.4` by name; Dependabot
#     is told to leave the line alone.
#
# docker-socket-proxy v0.6.0
FROM haproxy:3.4.7-alpine@sha256:5312d37032c079c4937d45ef63758852434351f3b425a3703521fd999837abcf

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
COPY system_files/ /
# Not upstream's: the two files the COPY puts in place, by SHA-256, so the name covers them (the header).
RUN test "$(sha256sum < /usr/local/bin/docker-entrypoint.sh)" = '2cd4c4414b7693fed10160386b2ba394b6e3bca55c61a773fb5225ea45606059  -' \
      || { echo '/usr/local/bin/docker-entrypoint.sh is not the file this Dockerfile names by its SHA-256' >&2; exit 1; }; \
    test "$(sha256sum < /usr/local/etc/haproxy/haproxy.cfg.template)" = '2de85de4cac6c8ae93de8be68d69b655533a77e1f5170b625e0eed4b126e8b4d  -' \
      || { echo '/usr/local/etc/haproxy/haproxy.cfg.template is not the file this Dockerfile names by its SHA-256' >&2; exit 1; }; \
    test -x /usr/local/bin/docker-entrypoint.sh
RUN touch /var/lib/haproxy/server-state
USER 99:99
CMD ["haproxy", "-f", "/tmp/haproxy.cfg"]
