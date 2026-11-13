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
# (10a5c69a…), and since 2026-11-13 it is PostgreSQL 18.7 (75dcac3d…), the
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
# so that RUN is gone, and an appliance's first `up` after the release that
# moves the name needs Docker Hub alone again. 18.7's notes asked for no
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
FROM postgres:18.7-alpine@sha256:75dcac3dfb1cd01ca3536910bbc84128759362f8b118bf8c55b38a94f68f3b73

# A plain rm: a base without gosu fails here, and this file has nothing left to do.
RUN rm /usr/local/bin/gosu

# uid 70's home is /var/lib/postgresql, the data volume. An interactive psql or
# shell in the container would leave its history there, kept for as long as the
# data; as root it was kept in /root, and went with the container.
ENV PSQL_HISTORY=/tmp/.psql_history
ENV HISTFILE=/tmp/.ash_history

USER 70:70
