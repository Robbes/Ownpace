# The appliance's PostgreSQL: the official image without gosu, started as the
# image's own postgres user, uid 70 (workplan 0146 T15b, 2026-10-26). It is
# deploy/compose/postgres/Dockerfile on the appliance's own base, and that
# file's comment is the long version of everything below.
#
# WHY. The official image starts as root, makes the data directory uid 70's
# and then runs gosu (/usr/local/bin/gosu) once, to become uid 70 for good.
# gosu 1.19 is built with Go 1.24.6, and Trivy v0.76.1 counts the Go standard
# library in it as this image's one critical (CVE-2025-68121, fixed in Go
# 1.24.13 and 1.25.7) on linux/arm64 (2026-10-26). The newest 18.6-alpine
# digest ships the same gosu, so no move of the pin fixes it; removing gosu
# does. docker-entrypoint.sh runs gosu only when it starts as root (`id -u`
# is 0), so started as uid 70 it never does.
#
# WHAT A START AS UID 70 MEANS FOR AN APPLIANCE.
#   - The data stays where it is. compose.yml mounts the named volume
#     `pgdata`, and the root entrypoint chowned every file in PGDATA
#     (/var/lib/postgresql/18/docker) to uid 70 on every start, so an existing
#     appliance's data is uid 70's already. A new volume takes the image's
#     /var/lib/postgresql, uid 70's and mode 1777, and initialises as uid 70.
#   - A bind mount of a host directory in place of the volume takes the host's
#     owner. One the root entrypoint ever started on works, if uid 70 may
#     enter it: PGDATA in it is uid 70's. A new one owned by root does not:
#     `mkdir: can't create directory '/var/lib/postgresql/18/': Permission
#     denied`. `chown -R 70:70` the host directory first, or under rootless
#     Docker from inside the container (docs/selfhost-quickstart.md, "What
#     you need" and Troubleshooting).
#   - `docker compose exec postgres …` runs as uid 70, not root, and the
#     image's pg_hba.conf trusts local connections as before: the backup's
#     pg_dump and the restore's psql answer the same. `-u 0` is root.
#   - The PGlite appliance (compose.pglite.yml) and the Windows appliance
#     (scripts/package-appliance.mjs, ADR-0027) run no Postgres server, and
#     build nothing here.
#
# THE BASE IS THE APPLIANCE'S OWN PIN, by exact version and index digest.
# Until 2026-10-31 it was the digest compose.yml ran before this file
# (77f58511…), so removing gosu was the only change an appliance's first `up`
# made to its database. Since then it is upstream's rebuild of 2026-10-26
# (10a5c69a…), the managed stacks' base too, taken with the RUN below, so the
# two Dockerfiles have the same instructions and build under one name. A new
# base is a move of its own, which Dependabot offers for this directory (its
# own `docker` entry, never a major). E2E (self-hosted) runs nightly and on
# dispatch, never on a pull request, so it is dispatched on that pull
# request's branch before it merges.
# The same Alpine and musl, so the database's collation is untouched.
#
# TWO OF ALPINE'S SECURITY UPDATES (workplan 0119, 2026-10-31): brotli-libs
# 1.2.1-r0 (CVE-2026-111497, critical) and libcurl 8.23.0-r0 (CVE-2026-92392,
# high), the base's only findings once gosu is gone, which no digest of
# 18.6-alpine carries yet. The RUN takes exactly those versions from Alpine's
# signed repository, fails before it installs once the base carries either
# fix, fails when the mirror no longer serves them, and fails unless those two
# packages are all it changed. Nothing the appliance runs loads either (only
# libpq-oauth links libcurl). An appliance's first `up` after the release
# that moves the name now reaches Alpine's mirror (dl-cdn.alpinelinux.org) as
# well as Docker Hub. deploy/compose/postgres/Dockerfile's header has the rest.
#
# THE NAME. compose.yml builds this as `localhost/postgres:<base tag>-<12
# hex>`, the hex being the SHA-256 of this file's instruction lines (comments
# and blank lines do not count), with `pull_policy: never`:
#   grep -Ev '^[[:space:]]*(#|$)' deploy/selfhost/postgres/Dockerfile | sha256sum | cut -c1-12
# `up` builds an image only when the machine has none of that name, so a
# changed instruction is a new name, which an appliance's next `up -d` builds.
# While the two Dockerfiles' FROMs differ, the appliance's name is not the
# managed stacks'; where they meet, the name is the same content. Nothing
# builds the image while the machine has it: E2E (self-hosted) builds `app` by
# name and runs `up` without `--build`, on a runner whose Docker the managed
# stacks share. scripts/a-database-started-as-root.unit.test.ts holds the
# image line to the hash, prints the `sed` that moves it, and holds this file
# to deploy/compose/postgres/Dockerfile's instructions but for the FROM; no
# parser directive, COPY, ADD or --mount, which the hash would not cover, and
# no package but at the exact version the instruction line names.
FROM postgres:18.6-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5

# A plain rm: a base without gosu fails here, and this file has nothing left to do.
RUN rm /usr/local/bin/gosu

# brotli-libs 1.2.1-r0 and libcurl 8.23.0-r0, exactly, from Alpine's signed
# repository, and nothing else (the header above).
RUN set -eu; \
    installed() { awk '/^P:/ { name = substr($0, 3) } /^V:/ { print name "=" substr($0, 3) }' /lib/apk/db/installed | sort; }; \
    for pin in brotli-libs=1.2.1-r0 libcurl=8.23.0-r0; do \
      name="${pin%%=*}"; fixed="${pin#*=}"; \
      have="$(installed | awk -F= -v name="$name" '$1 == name { print $2 }')"; \
      if [ -z "$have" ] || [ "$(apk version -t "$have" "$fixed")" != '<' ]; then \
        echo "The base's ${name} is '${have}', not older than ${fixed}: upstream's image carries that fix. Take ${name} out of this RUN, and the RUN and its paragraph in the header out once it names none." >&2; \
        exit 1; \
      fi; \
    done; \
    installed > /tmp/apk-before; \
    apk add --no-cache brotli-libs=1.2.1-r0 libcurl=8.23.0-r0; \
    installed > /tmp/apk-after; \
    added="$(awk 'NR == FNR { was[$0] = 1; next } !($0 in was)' /tmp/apk-before /tmp/apk-after)"; \
    gone="$(awk 'NR == FNR { now[$0] = 1; next } !($0 in now) { sub(/=.*/, ""); print }' /tmp/apk-after /tmp/apk-before)"; \
    rm /tmp/apk-before /tmp/apk-after; \
    if [ "$added" != "$(printf 'brotli-libs=1.2.1-r0\nlibcurl=8.23.0-r0')" ] || [ "$gone" != "$(printf 'brotli-libs\nlibcurl')" ]; then \
      echo "The install changed more than brotli-libs and libcurl, or took other versions of them. Installed: $(echo $added). Replaced or removed: $(echo $gone)." >&2; \
      exit 1; \
    fi

# uid 70's home is /var/lib/postgresql, the data volume. An interactive psql or
# shell in the container would leave its history there, kept for as long as the
# data; as root it was kept in /root, and went with the container.
ENV PSQL_HISTORY=/tmp/.psql_history
ENV HISTFILE=/tmp/.ash_history

USER 70:70
