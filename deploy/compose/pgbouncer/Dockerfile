# PgBouncer as edoburu/pgbouncer builds it, with five of Alpine's packages at
# the versions that carry their fixes, until upstream's image carries them
# (workplan 0119, 2026-11-13, for alpha.8).
#
# WHY. managed.yml's pgbouncer ran `edoburu/pgbouncer:v1.26.1-p0` as pulled.
# The image scan of main on 2026-11-13 (Security Scan run 43492635512, Trivy,
# linux/arm64) read it at 0 critical and 79 high, every one with a fix, in
# five packages of its base, Alpine 3.24.2:
#   - libpq 18.6-r0, 38 findings, and postgresql18-client 18.6-r0, the same
#     38 (CVE-2026-6460, CVE-2026-6467, CVE-2026-14661, CVE-2026-18447 and 34
#     more): PostgreSQL 18.7, the security release of 2026-11-12, as Alpine
#     packages it, 18.7-r0;
#   - musl and musl-utils 1.2.6-r2, CVE-2026-107891 (an integer overflow in
#     regcomp), fixed in 1.2.6-r3;
#   - zlib 1.3.2-r0, CVE-2026-85091, fixed in 1.3.2-r1.
# No move of the pin clears them. v1.26.1-p0 is upstream's newest tag, pushed
# 2026-10-19 (Docker Hub's tag list, read 2026-11-13: nothing newer among its
# 32 tags), and its package layer is older than the tag: the image's history
# dates its `apk add --no-cache libevent postgresql-client` 2026-09-30, a
# layer the build of 2026-10-19 reused. Upstream pushes its images by hand
# (managed.yml's comment), so nothing says when the next one comes.
#
# WHAT LOADS THEM, read on 2026-11-13 from the layers of both platform images
# (linux/arm64 3e89f389…, linux/amd64 a26a00a5…, each blob checked against its
# digest, nothing run) and from this repository:
#   - pgbouncer links libevent, libssl, libcrypto and musl (readelf -d
#     /usr/bin/pgbouncer): not libpq, and not zlib.
#   - libpq and the client are psql's. managed.yml's healthcheck runs psql
#     every 15 seconds, and db-roles.sh, rehearse-capacity.sh and E2E
#     (managed) run it by `exec`, each time against the container's own
#     pooler, on its loopback, port 6432. Nothing else runs in this container.
#   - musl is every process's libc. The fix is in regcomp(), which takes a
#     pattern: pgbouncer compiles its own, for the admin console's commands,
#     and the entrypoint's grep and sed theirs. No client hands either one.
#   - zlib: apk, and pg_dump and six more of the client's programs, which
#     nothing here runs. Not psql.
# So these are almost certainly out of anybody's reach here, as the Postgres
# image's were (#1880). They go all the same: a finding nobody can reach
# still hides the next one that somebody can, and the scan counts 79.
#
# WHAT IT IS. Upstream's image as it is, and two RUNs. The first, as root,
# takes the five from Alpine's own repository, the base's
# /etc/apk/repositories, which apk checks against the index Alpine signs with
# the keys in the base, at the exact versions it names: never a floor, so a
# later day cannot build anything else under the same name. zlib is 1.4-r0,
# not the 1.3.2-r1 the scan names as the first fix: Alpine's 3.24 moved to
# 1.4 on 2026-11-06 (aports 3.24-stable, bdf501c8), and keeps only the newest
# build of a package in a stable branch. The RUN fails loudly
#   - before it installs, when the base's copy of any of the five is no older
#     than the version named here. Upstream's image carries that fix then:
#     THE WAY OUT, below;
#   - when apk cannot install those exact versions, with a message of its own
#     after apk's. Either the machine cannot reach Alpine's mirror
#     (dl-cdn.alpinelinux.org), and the same command goes through once it
#     can, or the mirror no longer serves those versions: THE RISK, below;
#   - after it installs, unless exactly those five packages changed, to
#     exactly those versions, and nothing else was installed, upgraded or
#     removed.
# Then the user is upstream's again, `postgres` (uid 70), as the image's
# config names it, and the second RUN proves as that user that the pooler
# still starts and is the release the FROM names, and that psql starts and
# is 18.7. The entrypoint (/entrypoint.sh), the command (/usr/bin/pgbouncer
# /etc/pgbouncer/pgbouncer.ini), the working directory, the port and the
# environment are upstream's: this file sets none of them, and images.yml's
# `build (pgbouncer, …)` holds each to the base's.
#
# WHAT WAS READ FOR THE VERSIONS. This session could not read Alpine's index
# (dl-cdn.alpinelinux.org and Alpine's other hosts were refused to it). Read
# instead, on 2026-11-13: aports' 3.24-stable at fb7df047 (postgresql18
# 18.7-r0 since 2026-11-12 22:44 UTC, musl 1.2.6-r3 since 2026-10-21, zlib
# 1.4-r0 since 2026-11-06 18:22 UTC; postgresql-common, readline, lz4 and
# zstd, which the client needs, at the base's versions); `alpine:3.24.4`,
# which carries musl and musl-utils 1.2.6-r3 on both platforms; and the
# package list of `postgres:18.7-alpine@75dcac3d…`, built 2026-11-12, which
# carries zlib 1.4-r0 on both. No image read carries Alpine's libpq 18.7-r0
# yet: that the mirror serves it for arm64 and amd64 is first proven by this
# file's build on both, in images.yml.
#
# THE RISK, taken as #1880 took it for the databases. A build reaches Alpine's
# mirror as well as Docker Hub, once per machine and name (THE NAME, below).
# And Alpine keeps only its newest build of a package: the day it moves one
# of the five again, a machine without this name cannot build it, and `up`
# stops at the build with the RUN's message. A machine that has the name is
# not touched, so neither stack shows it. It shows first where the image is
# built afresh: the weekly image scan's pgbouncer leg (security-scan.yml,
# Mondays at 06:00 UTC, on main), which then has no image to scan, writes no
# report and fails its run; and images.yml's `build (pgbouncer, …)` on a
# pull request that touches deploy/. The remedy is a pull request that moves
# the version here, which moves the name, or THE WAY OUT.
#
# THE WAY OUT is upstream's next image, and it comes one of two ways.
#   - A newer PgBouncer, `v1.26.2-p0`, is Dependabot's pull request: it reads
#     this directory (.github/dependabot.yml, its own entry). So is this tag
#     pushed again under a new digest, by Dependabot's source, which can also
#     hold a digest-only update back behind a switch whose state on GitHub
#     was not read; the pin watch compares tags and sees no re-push.
#   - A rebuild of the same PgBouncer is a new tag, `v1.26.1-p1`, as
#     v1.24.1-p1 and v1.23.1-p1 to -p3 were (Docker Hub's tag list, read
#     2026-11-13). Dependabot opens no pull request for it: it proposes only
#     tags that end as the pinned one does, `-p0` (read on 2026-11-13 in
#     dependabot-core at 6f880ece, docker/lib/dependabot/docker/tag.rb,
#     `comparable_to?`; not run), and where a newer PgBouncer has a `-p1`
#     too, it proposes the `-p0`. Only the pin watch's summary issue lists
#     such a tag, and says it is moved by hand: a pull request of its own
#     that moves this FROM's tag and digest, and then managed.yml's image
#     line, by the `sed` the guard's failure prints.
# Either pull request fails here until this file is read again: when the new
# base carries a package at the version named, the first RUN says so by
# name. Take that package out of the RUN, its three lists and the two
# messages that name the five, and out of the guard in the same change:
# scripts/a-rebuild-upstream-has-not-made.unit.test.ts holds the RUN to its
# own list, PINS, and until that loses the package too its failures ask for
# the package back; then they name its cases that still mention it. Once the
# lists are empty, upstream's image carries all five, and the whole build
# goes: managed.yml's pgbouncer runs `edoburu/pgbouncer:<tag>@<digest>`
# again, without `build:` and `pull_policy:`, and this file, its job in
# images.yml, its Dependabot entry and its guard are deleted.
#
# THE NAME. managed.yml builds this as `localhost/pgbouncer:<base tag>-<12
# hex>`, a name no registry serves, with `pull_policy: never`, as
# deploy/compose/postgres/Dockerfile's header says for the databases. The
# twelve hex digits are the SHA-256 of this file's instruction lines, comments
# and blank lines left out,
#   grep -Ev '^[[:space:]]*(#|$)' deploy/compose/pgbouncer/Dockerfile | sha256sum | cut -c1-12
# so a changed instruction is a name the machine does not have yet, and `up`
# builds it. Nothing builds it while the machine has the name (managed.yml's
# header). scripts/a-rebuild-upstream-has-not-made.unit.test.ts holds the
# image line to it, and when an instruction changes, its failure prints the
# `sed` that moves the line. No parser directive, no COPY, no ADD and no
# --mount, so the name is the content: the build reads nothing from this
# directory, which also holds the pooler's pgbouncer.ini and setup-auth.sql
# and, on a machine, may hold its userlist.
FROM edoburu/pgbouncer:v1.26.1-p0@sha256:488422e38cff912895d0d65d8963fcd306e6ac589a724398b6eb8e294e94d624

# Root for the one RUN that needs it: apk replaces files root owns.
USER root

# libpq 18.7-r0, musl 1.2.6-r3, musl-utils 1.2.6-r3, postgresql18-client
# 18.7-r0 and zlib 1.4-r0, exactly, from Alpine's signed repository, and
# nothing else (WHAT IT IS, above).
RUN set -eu; \
    installed() { awk '/^P:/ { name = substr($0, 3) } /^V:/ { print name "=" substr($0, 3) }' /lib/apk/db/installed | sort; }; \
    for pin in libpq=18.7-r0 musl=1.2.6-r3 musl-utils=1.2.6-r3 postgresql18-client=18.7-r0 zlib=1.4-r0; do \
      name="${pin%%=*}"; fixed="${pin#*=}"; \
      have="$(installed | awk -F= -v name="$name" '$1 == name { print $2 }')"; \
      if [ -z "$have" ] || [ "$(apk version -t "$have" "$fixed")" != '<' ]; then \
        echo "The base's ${name} is '${have}', not older than ${fixed}: upstream's image carries that fix. Take ${name} out of this RUN, and the whole build out once it names none (this file's header, THE WAY OUT)." >&2; \
        exit 1; \
      fi; \
    done; \
    installed > /tmp/apk-before; \
    apk add --no-cache libpq=18.7-r0 musl=1.2.6-r3 musl-utils=1.2.6-r3 postgresql18-client=18.7-r0 zlib=1.4-r0 || { \
      echo "Alpine's libpq 18.7-r0, musl 1.2.6-r3, musl-utils 1.2.6-r3, postgresql18-client 18.7-r0 and zlib 1.4-r0 could not be installed (the error above). If this machine cannot reach Alpine's mirror, dl-cdn.alpinelinux.org, let it and run the same command again. If it can, the mirror no longer serves those versions, and this checkout's pooler image can no longer be built: a machine that has the image keeps running it, and a pull request moves the versions deploy/compose/pgbouncer/Dockerfile names (its header, THE RISK)." >&2; \
      exit 1; \
    }; \
    installed > /tmp/apk-after; \
    added="$(awk 'NR == FNR { was[$0] = 1; next } !($0 in was)' /tmp/apk-before /tmp/apk-after)"; \
    gone="$(awk 'NR == FNR { now[$0] = 1; next } !($0 in now) { sub(/=.*/, ""); print }' /tmp/apk-after /tmp/apk-before)"; \
    rm /tmp/apk-before /tmp/apk-after; \
    if [ "$added" != "$(printf 'libpq=18.7-r0\nmusl-utils=1.2.6-r3\nmusl=1.2.6-r3\npostgresql18-client=18.7-r0\nzlib=1.4-r0')" ] || [ "$gone" != "$(printf 'libpq\nmusl-utils\nmusl\npostgresql18-client\nzlib')" ]; then \
      echo "The install changed more than libpq, musl, musl-utils, postgresql18-client and zlib, or took other versions of them. Installed: $(echo $added). Replaced or removed: $(echo $gone)." >&2; \
      exit 1; \
    fi

# Upstream's user again, as its image's config names it: postgres, uid 70.
USER postgres

# As postgres: the pooler starts and is the release the FROM names, and the
# client the healthcheck runs starts and is PostgreSQL 18.7's.
RUN set -eu; \
    me=deploy/compose/pgbouncer/Dockerfile; \
    who="$(id -un):$(id -u)"; \
    [ "$who" = postgres:70 ] || { echo "$me: this RUN runs as $who, not postgres:70: the USER above is not upstream's. Re-read the header's WHAT IT IS against this image." >&2; exit 1; }; \
    pooler="$(pgbouncer --version | sed -n 1p)"; \
    [ "$pooler" = 'PgBouncer 1.26.1' ] || { echo "$me: pgbouncer --version printed '$pooler', not PgBouncer 1.26.1, the FROM's release: re-read the header." >&2; exit 1; }; \
    client="$(psql --version)"; \
    [ "$client" = 'psql (PostgreSQL) 18.7' ] || { echo "$me: psql --version printed '$client', not psql (PostgreSQL) 18.7, the client this file installs: re-read the header." >&2; exit 1; }; \
    echo "$me: as $who, $pooler and $client start."
