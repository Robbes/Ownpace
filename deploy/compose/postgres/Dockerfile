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
# pull request moves the name below too.
#
# FOUR OF ALPINE'S SECURITY UPDATES, TAKEN AT BUILD (workplan 0119,
# 2026-10-31 and 2026-11-12), UNTIL POSTGRESQL 18.7 CARRIES THEM. This RUN is
# temporary: it comes out with the move to an 18.7 image whose base carries
# all four fixes, and the check below says when that is. 18.7 was due
# 2026-11-12, and Docker Hub listed no 18.7-alpine at 14:24 UTC that day.
# With gosu gone, Trivy v0.76.1 read two findings in the base on 2026-10-31,
# on arm64 and amd64 alike, each with a fix in Alpine 3.24:
#   - brotli-libs 1.2.0-r1, CVE-2026-111497 (critical, an out-of-bounds write
#     in brotli's decoder), fixed in 1.2.1-r0;
#   - libcurl 8.22.0-r0, CVE-2026-92392 (high, a use-after-free in HTTP/2
#     uploads), fixed in 8.23.0-r0.
# Upstream's rebuild of 2026-10-26, the FROM above, re-pushed the index over
# the same images of 2026-10-22, so no move of the pin cleared them. Only
# libpq-oauth (/usr/local/lib/libpq-oauth-18.so, the client's OAuth flow)
# links libcurl, and only libcurl links brotli's decoder. Nothing here
# connects with OAuth, so nothing these stacks run loads either.
# The image scan of 2026-11-12 (Trivy v0.76.2, linux/arm64) read 19 highs
# more, where the week's scan of 2026-11-09 had read none, each fixed in
# Alpine's 3.24-stable since 2026-11-10:
#   - krb5-libs 1.22.2-r1, 16 findings (CVE-2026-40355, CVE-2026-40356,
#     CVE-2026-71199, CVE-2026-71200 and 12 more), fixed in 1.22.3-r0, MIT
#     krb5 1.22.3 (2026-11-09);
#   - libxslt 1.1.43-r3, 3 findings (CVE-2026-9947, CVE-2026-87636,
#     CVE-2026-125350), fixed in 1.1.43-r4.
# The newest 18.6-alpine (9ba53c7d…, pushed 2026-11-11, its images of
# 2026-11-05) carries neither. libxslt is as the two above: only contrib's
# xml2 (/usr/local/lib/postgresql/pgxml.so) links it, and nothing here
# creates that extension. krb5-libs is not: postgres and libpq link its
# GSS-API library, so every postgres process loads it, and a client's GSSAPI
# encryption request on a TCP connection reaches gss_accept_sec_context()
# before pg_hba.conf is consulted. Nothing here signs in with Kerberos
# (pg_hba.conf is the image's own: the socket and the loopback trust, every
# other host scram-sha-256), the image has no keytab, realm or NegoEx
# mechanism, and MIT's notes put most of 1.22.3's fixes in the KDC, kadmind,
# libgssrpc or a ticket's checks, which nothing here runs or reaches without a
# keytab. What is left is denial of service, for a client that can open a
# TCP connection to the database: this stack's containers, and what reaches a
# published port (managed.yml's postgres on the host's loopback and
# POSTGRES_BIND, trigger-db on none; dev.yml's, a development stack's, on
# every interface). So the RUN clears findings almost certainly out of
# anybody's reach here, but krb5's, unlike libcurl's, are in code the server
# loads. It upgrades all four and deletes nothing, because the image's
# .postgresql-rundeps needs so:libcurl.so.4, so:libgssapi_krb5.so.2 and
# so:libxslt.so.1.
#
# The RUN takes them from Alpine's own repository, the base's
# /etc/apk/repositories, which apk checks against the index Alpine signs with
# the keys in the base, at the exact versions it names: never a floor, so a
# later day cannot build anything else under the same name. It fails loudly
#   - before it installs, when the base's copy of any of the four is no older
#     than its fixed version. Upstream's image carries that fix then: take the
#     package out of the RUN, and the RUN and this paragraph out once it names
#     none. Dependabot's pull request that moves the FROM is where that shows;
#   - when apk cannot install those exact versions, with a message of its own
#     after apk's, for whoever runs the build: an appliance's operator as much
#     as this box's. Either the machine cannot reach Alpine's mirror, and the
#     same command goes through once it can, or the mirror no longer serves
#     those versions. Alpine keeps only the newest build of a package in a
#     stable branch, so once it moves any of the four, a machine without this
#     name cannot build it, anywhere: an appliance then updates Ownpace to its
#     newest release, and here a pull request of its own moves the version,
#     which moves the name, or the FROM to a base that carries the fix;
#   - after it installs, unless exactly those four packages changed, to
#     exactly those versions, and nothing else was installed, upgraded or
#     removed.
# What it costs: a build reaches Alpine's mirror (dl-cdn.alpinelinux.org) as
# well as Docker Hub. That is once per machine and name (THE NAME, below):
# the box's `up` where the name is missing, and an appliance's first `up`
# after the release that moves it. Until 2026-10-31 the build needed the base
# alone.
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
# What the build reads from outside them is the base, by its digest, and the
# RUN's four packages, from Alpine's signed repository at the exact versions
# the instruction line names (as deploy/compose/goaccess's `apk add` takes
# its packages from the same repository); the RUN refuses anything else.
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
FROM postgres:18.6-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5

# A plain rm: a base without gosu fails here, and this file has nothing left to do.
RUN rm /usr/local/bin/gosu

# brotli-libs 1.2.1-r0, krb5-libs 1.22.3-r0, libcurl 8.23.0-r0 and libxslt
# 1.1.43-r4, exactly, from Alpine's signed repository, and nothing else (FOUR
# OF ALPINE'S SECURITY UPDATES, above).
RUN set -eu; \
    installed() { awk '/^P:/ { name = substr($0, 3) } /^V:/ { print name "=" substr($0, 3) }' /lib/apk/db/installed | sort; }; \
    for pin in brotli-libs=1.2.1-r0 krb5-libs=1.22.3-r0 libcurl=8.23.0-r0 libxslt=1.1.43-r4; do \
      name="${pin%%=*}"; fixed="${pin#*=}"; \
      have="$(installed | awk -F= -v name="$name" '$1 == name { print $2 }')"; \
      if [ -z "$have" ] || [ "$(apk version -t "$have" "$fixed")" != '<' ]; then \
        echo "The base's ${name} is '${have}', not older than ${fixed}: upstream's image carries that fix. Take ${name} out of this RUN, and the RUN and its paragraph in the header out once it names none." >&2; \
        exit 1; \
      fi; \
    done; \
    installed > /tmp/apk-before; \
    apk add --no-cache brotli-libs=1.2.1-r0 krb5-libs=1.22.3-r0 libcurl=8.23.0-r0 libxslt=1.1.43-r4 || { \
      echo "Alpine's brotli-libs 1.2.1-r0, krb5-libs 1.22.3-r0, libcurl 8.23.0-r0 and libxslt 1.1.43-r4 could not be installed (the error above). If this machine cannot reach Alpine's mirror, dl-cdn.alpinelinux.org, let it and run the same command again. If it can, the mirror no longer serves those versions, and this release's database image can no longer be built: update Ownpace to its newest release (docs/selfhost-quickstart.md, Troubleshooting)." >&2; \
      exit 1; \
    }; \
    installed > /tmp/apk-after; \
    added="$(awk 'NR == FNR { was[$0] = 1; next } !($0 in was)' /tmp/apk-before /tmp/apk-after)"; \
    gone="$(awk 'NR == FNR { now[$0] = 1; next } !($0 in now) { sub(/=.*/, ""); print }' /tmp/apk-after /tmp/apk-before)"; \
    rm /tmp/apk-before /tmp/apk-after; \
    if [ "$added" != "$(printf 'brotli-libs=1.2.1-r0\nkrb5-libs=1.22.3-r0\nlibcurl=8.23.0-r0\nlibxslt=1.1.43-r4')" ] || [ "$gone" != "$(printf 'brotli-libs\nkrb5-libs\nlibcurl\nlibxslt')" ]; then \
      echo "The install changed more than brotli-libs, krb5-libs, libcurl and libxslt, or took other versions of them. Installed: $(echo $added). Replaced or removed: $(echo $gone)." >&2; \
      exit 1; \
    fi

# uid 70's home is /var/lib/postgresql, the data volume. An interactive psql or
# shell in the container would leave its history there, kept for as long as the
# data; as root it was kept in /root, and went with the container.
ENV PSQL_HISTORY=/tmp/.psql_history
ENV HISTFILE=/tmp/.ash_history

USER 70:70
