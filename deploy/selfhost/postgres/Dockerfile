# The appliance's PostgreSQL: the official image without gosu, started as the
# image's own postgres user, uid 70 (workplan 0146 T15b, 2026-10-26). It is
# deploy/compose/postgres/Dockerfile on the appliance's own base, and that
# file's comment is the long version of everything below.
#
# WHY. The official image starts as root, makes the data directory uid 70's
# and then runs gosu (/usr/local/bin/gosu) once, to become uid 70 for good.
# gosu 1.19 is built with Go 1.24.6, and Trivy v0.76.1 counts the Go standard
# library in it as this image's one critical (CVE-2025-68121, fixed in Go
# 1.24.13 and 1.25.7) on linux/arm64 (2026-10-26). PostgreSQL 18.7's image
# (2026-11-12) ships the same gosu, so no move of the pin fixes it; removing
# gosu does. docker-entrypoint.sh runs gosu only when it starts as root (`id -u`
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
#     pg_dump and the restore's psql answer the same. `-u 0` is root, and
#     since compose.yml drops every capability (2026-11-03) root without
#     root's powers: `exec --privileged -u 0` for a repair, `run --cap-add`
#     for a one-off (docs/selfhost-quickstart.md).
#   - The PGlite appliance (compose.pglite.yml) and the Windows appliance
#     (scripts/package-appliance.mjs, ADR-0027) run no Postgres server, and
#     build nothing here.
#
# THE BASE IS THE APPLIANCE'S OWN PIN, by exact version and index digest.
# Until 2026-10-31 it was the digest compose.yml ran before this file
# (77f58511…), so removing gosu was the only change an appliance's first `up`
# made to its database. Then it was upstream's rebuild of 2026-10-26
# (10a5c69a…), since 2026-11-13 PostgreSQL 18.7 (75dcac3d…), and since
# alpha.20 upstream's rebuild of 18.7 of 2026-11-21 (0115267a…, gosu 1.20), the
# managed stacks' base too each time, so the two Dockerfiles have the same
# instructions and build under one name. A new base is a move of its own,
# which Dependabot offers for this directory (its own `docker` entry, never a
# major). E2E (self-hosted) runs nightly and on dispatch, never on a pull
# request, so it is dispatched on that pull request's branch before it merges.
# The move from 77f58511… took Alpine 3.24.2 to 3.24.3: musl 1.2.6-r2 to
# 1.2.6-r3, OpenSSL 3.5.8 to 3.5.9 and a few libraries more. The move to 18.7
# took 3.24.3 to 3.24.4, with musl at 1.2.6-r3 in both. ICU is 78.1-r0 in all
# three, so the database's collation is untouched.
# From 2026-10-31 to 2026-11-13 a RUN here also took four of Alpine's security
# updates from Alpine's mirror (workplan 0119). 18.7's base carries all four,
# so that RUN went, and an appliance's first `up` needed Docker Hub alone
# again, until the libxml2 RUN below (2026-11-21, workplan 0166 T3), which
# needs Alpine's mirror too. 18.7's notes asked for no
# REINDEX of anything the appliance's database holds.
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
FROM postgres:18.7-alpine@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71

# A plain rm: a base without gosu fails here, and this file has nothing left to do.
RUN rm /usr/local/bin/gosu

# LIBXML2 2.13.9-r5, WITH ALPINE'S FIX FOR CVE-2026-86144 (workplan 0166 T3, the
# owner's D3 of 2026-11-21: "pin"). The base's Alpine 3.24.4 carries libxml2
# 2.13.9-r2, which the image scan reads at one high (Security Scan run
# 44878860013), and PostgreSQL links it for its xml type. -r3 is Alpine's fix.
# This RUN takes -r5 from Alpine's signed repository at that exact version, as
# a RUN here took four of Alpine's updates from 2026-10-31 to 2026-11-13. It
# took -r3 until 2026-11-26, when the mirror served -r5 instead. So the build
# needs Alpine's mirror again, as well as Docker Hub.
# It reads the installed version from apk's own database, before and after:
#   - before, the base must carry -r2. A base that carries -r3 or later (a
#     rebuild of the tag, or the next PostgreSQL release, which Dependabot
#     offers) stops the build here, and THE WAY OUT is to delete this RUN and
#     its comment in both Postgres Dockerfiles, move the names the guard
#     prints, and say again in the four documents the guard names that the
#     build needs Docker Hub alone;
#   - after, it must be -r5.
# Alpine's mirror keeps only a package's newest build. Once it serves a newer
# libxml2 than -r5, this exact version can no longer be fetched, and a machine
# without the image cannot build it: the same way out, or a newer exact
# version.
RUN set -eu; \
    installed() { awk -v want="$1" '$0 == "P:" want { found = 1; next } found && /^V:/ { print substr($0, 3); exit }' /lib/apk/db/installed; }; \
    was="$(installed libxml2)"; \
    if [ "$was" != 2.13.9-r2 ]; then echo "libxml2 is '$was' in the base, not 2.13.9-r2: the base carries its own, so this RUN goes (THE WAY OUT, above)"; exit 1; fi; \
    apk add --no-cache libxml2=2.13.9-r5; \
    now="$(installed libxml2)"; \
    if [ "$now" != 2.13.9-r5 ]; then echo "libxml2 is '$now' after the add, not 2.13.9-r5"; exit 1; fi; \
    echo "libxml2 $was -> $now"

# uid 70's home is /var/lib/postgresql, the data volume. An interactive psql or
# shell in the container would leave its history there, kept for as long as the
# data; as root it was kept in /root, and went with the container.
ENV PSQL_HISTORY=/tmp/.psql_history
ENV HISTFILE=/tmp/.ash_history

USER 70:70
