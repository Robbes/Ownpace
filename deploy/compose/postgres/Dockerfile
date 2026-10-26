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
# not root, so `-u 0` is how to be root in the container. The database's
# local connections are trusted as before (the image's pg_hba.conf), so
# `psql -U <role>`, pg_dump and pg_restore answer the same.
#
# THE BASE IS THE OFFICIAL IMAGE, by exact version and index digest, on Alpine.
# The same Alpine and musl: a Debian base collates text differently, and the
# indexes of a database made under one are not to be trusted under the other.
# Its pin moves by a pull request like every image in deploy/compose (the pin
# watch, scripts/idp-pin-watch.mjs, says when a newer tag is listed; the image
# scan, scripts/image-scan.mjs, builds this file and scans what it built), and
# that pull request moves the tag below too.
#
# THE NAME. managed.yml and dev.yml build this as
# `localhost/postgres:<base tag>-<12 hex>`, a name no registry serves, so the
# services say `pull_policy: never`. `up` builds an image only when the machine
# has none of that name, so the twelve hex digits are the SHA-256 of this
# file's instruction lines (comments and blank lines do not count), and a
# changed instruction is a name the machine does not have yet:
#   grep -Ev '^[[:space:]]*(#|$)' deploy/compose/postgres/Dockerfile | sha256sum | cut -c1-12
# scripts/a-database-started-as-root.unit.test.ts holds every postgres there to
# it, and says what to write.
#
# NOTHING BUILDS IT AGAIN WHILE THE MACHINE HAS IT. `up --build` builds every
# service in its scope that has a `build:`, dependencies included (api and web
# depend on both databases), and so does a `build` that names no service. From
# a pruned build cache that is a new image ID under the same name, and the next
# `up` that reaches a database recreates it; live and the OTA stack share one
# daemon, so one stack's rebuild restarts the other's databases. The bring-up
# builds `api web` by name and runs `up` without `--build`, and the same guard
# refuses any script or document that says otherwise.
FROM postgres:18.6-alpine@sha256:898c60cb390d1085bc97bdd6a1ae968757421df394b071848b52b1c09c89d6a5

# A plain rm: a base without gosu fails here, and this file has nothing left to do.
RUN rm /usr/local/bin/gosu

# uid 70's home is /var/lib/postgresql, the data volume. An interactive psql or
# shell in the container would leave its history there, kept for as long as the
# data; as root it was kept in /root, and went with the container.
ENV PSQL_HISTORY=/tmp/.psql_history
ENV HISTFILE=/tmp/.ash_history

USER 70:70
