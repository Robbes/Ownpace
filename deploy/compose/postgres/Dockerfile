# PostgreSQL as the official image builds it, without gosu, started as the
# image's own postgres user, uid 70 (workplan 0146 T15, 2026-10-26).
#
# WHY. The official image starts as root. Its entrypoint makes the data
# directory uid 70's and then runs gosu (/usr/local/bin/gosu) once, to become
# uid 70 for good. gosu 1.19 is built with Go 1.24.6, and Trivy v0.76.1 counts
# the Go standard library in it as the image's one critical (CVE-2025-68121)
# and 25 of its 26 highs, on arm64 and amd64 alike (2026-10-26). The
# entrypoint runs gosu only when it starts as root (`id -u` is 0), so started
# as uid 70 it never does, and gosu can go.
#
# WHAT A START AS UID 70 LEAVES OUT, read in docker-entrypoint.sh at this
# digest: as root, it chowns every file in PGDATA (/var/lib/postgresql/18/docker)
# and /var/run/postgresql that uid 70 does not own, and then runs gosu.
#   - A volume the root entrypoint ever started on is uid 70's already: that
#     chown ran on every start, and since then only the server (uid 70) writes
#     there, unless a root `exec` did, which nothing in this repository does.
#     Only the directory above PGDATA (/var/lib/postgresql/18) stays root's,
#     and nothing writes there.
#   - A new volume takes the image's /var/lib/postgresql, uid 70's and mode
#     1777, so uid 70 makes PGDATA itself, and initdb runs as uid 70 as before.
#   - A bind mount of a host directory takes the host's owner instead, and uid
#     70 cannot make PGDATA in one root owns: `mkdir: can't create directory
#     '/var/lib/postgresql/18/': Permission denied`. The stacks here use named
#     volumes only.
# The server, initdb and every client run as uid 70 exactly as they did after
# gosu. What changes is `docker compose exec postgres …`: it runs as uid 70,
# not root. `-u 0` is root, and since managed.yml drops every capability
# (2026-11-03) root without root's powers: `exec --privileged -u 0` is a repair
# that needs them. The database's
# local connections are trusted as before (the image's pg_hba.conf), so
# `psql -U <role>`, pg_dump and pg_restore answer the same.
#
# THE BASE IS THE OFFICIAL IMAGE, by exact version and index digest, on Alpine.
# The same Alpine and musl: a Debian base collates text differently, and the
# indexes of a database made under one are not to be trusted under the other.
# Its pin moves by a pull request: Dependabot opens it (.github/dependabot.yml,
# this directory's own entry, never a major), the pin watch
# (scripts/idp-pin-watch.mjs) says when a newer tag is listed, and the image
# scan (scripts/image-scan.mjs) builds this file and scans what it built. That
# pull request moves the name below too. A new minor's release notes can ask
# for a REINDEX of some kinds of index: read them against the indexes these
# databases hold before the move merges.
# The move to PostgreSQL 18.7 (2026-11-13, workplan 0119) took Alpine 3.24.3
# to 3.24.4, with musl at 1.2.6-r3 and ICU at 78.1-r0 in both, so the
# collation is untouched. docker-entrypoint.sh and docker-ensure-initdb.sh are
# the same files as 18.6's, and 18.7's notes asked for no REINDEX here.
#
# THE NAME. managed.yml and dev.yml build this as
# `localhost/postgres:<base tag>-<12 hex>`, a name no registry serves, so the
# services say `pull_policy: never`. `up` builds an image only when the machine
# has none of that name, so the twelve hex digits are the SHA-256 of this
# file's instruction lines (comments and blank lines do not count), and a
# changed instruction is a name no stack on the machine has yet: live, on its
# tag's Dockerfile, keeps its own name while the OTA stack builds main's under
# another, on the same daemon.
#   grep -Ev '^[[:space:]]*(#|$)' deploy/compose/postgres/Dockerfile | sha256sum | cut -c1-12
# scripts/a-database-started-as-root.unit.test.ts holds the three image lines
# to it, and when an instruction changes its failure prints the `sed` that
# moves them. Nothing but those lines may change what is built: this file has
# no parser directive (`# syntax=`, `# escape=`: a comment to the hash, an
# instruction to the builder) and no COPY, ADD or --mount (they read files the
# hash does not cover), and `build:` names this directory and nothing more.
# What the build reads from outside them is the base, by its digest, and
# nothing else. From 2026-10-31 to 2026-11-13 a RUN here also took four of
# Alpine's security updates from Alpine's mirror (workplan 0119). PostgreSQL
# 18.7's base carries all four, so that RUN went, and a build needed Docker Hub
# alone until 2026-11-21, when the libxml2 RUN below came (workplan 0166 T3). The guard still refuses an `apk add` that does not name each
# package at its exact version.
#
# THE APPLIANCE'S COPY. deploy/selfhost/postgres/Dockerfile is this file on
# the appliance's own base (workplan 0146 T15b): compose builds
# `localhost/<name>` from `<name>/Dockerfile` beside the compose file, and each
# pin moves on its own. The same guard holds the two to the same instructions
# but for the FROM, so an instruction changed here is changed there too, and
# moves the appliance's name as well.
#
# NOTHING BUILDS IT AGAIN WHILE THE MACHINE HAS IT. `up --build` builds every
# service in its scope that has a `build:`, dependencies included (api and web
# depend on both databases), and so does a `build` that names no service. From
# a pruned build cache that is a new image ID under the same name, and the next
# `up` that reaches a database recreates it; live and the OTA stack share one
# daemon, so one stack's rebuild restarts the other's databases. The bring-up
# builds `api web` by name and runs `up` without `--build`, and the same guard
# refuses any script or document that says otherwise.
FROM postgres:18.7-alpine@sha256:0115267ab5a509022df9319c77be365cef335adb71556c75f60f5360ee247e71

# A plain rm: a base without gosu fails here, and this file has nothing left to do.
RUN rm /usr/local/bin/gosu

# LIBXML2 2.13.9-r3, ALPINE'S FIX FOR CVE-2026-86144 (workplan 0166 T3, the
# owner's D3 of 2026-11-21: "pin"). The base's Alpine 3.24.4 carries libxml2
# 2.13.9-r2, which the image scan reads at one high (Security Scan run
# 44878860013), and PostgreSQL links it for its xml type. This RUN takes -r3
# from Alpine's signed repository at that exact version, as a RUN here took
# four of Alpine's updates from 2026-10-31 to 2026-11-13. So the build needs
# Alpine's mirror again, as well as Docker Hub.
# It reads the installed version from apk's own database, before and after:
#   - before, the base must carry -r2. A base that carries -r3 or later (a
#     rebuild of the tag, or the next PostgreSQL release, which Dependabot
#     offers) stops the build here, and THE WAY OUT is to delete this RUN and
#     its comment in both Postgres Dockerfiles, move the names the guard
#     prints, and say again in the four documents the guard names that the
#     build needs Docker Hub alone;
#   - after, it must be -r3.
# Alpine's mirror keeps only a package's newest build. Once it serves a newer
# libxml2 than -r3, this exact version can no longer be fetched, and a machine
# without the image cannot build it: the same way out, or a newer exact
# version.
RUN set -eu; \
    installed() { awk -v want="$1" '$0 == "P:" want { found = 1; next } found && /^V:/ { print substr($0, 3); exit }' /lib/apk/db/installed; }; \
    was="$(installed libxml2)"; \
    if [ "$was" != 2.13.9-r2 ]; then echo "libxml2 is '$was' in the base, not 2.13.9-r2: the base carries its own, so this RUN goes (THE WAY OUT, above)"; exit 1; fi; \
    apk add --no-cache libxml2=2.13.9-r3; \
    now="$(installed libxml2)"; \
    if [ "$now" != 2.13.9-r3 ]; then echo "libxml2 is '$now' after the add, not 2.13.9-r3"; exit 1; fi; \
    echo "libxml2 $was -> $now"

# uid 70's home is /var/lib/postgresql, the data volume. An interactive psql or
# shell in the container would leave its history there, kept for as long as the
# data; as root it was kept in /root, and went with the container.
ENV PSQL_HISTORY=/tmp/.psql_history
ENV HISTFILE=/tmp/.ash_history

USER 70:70
