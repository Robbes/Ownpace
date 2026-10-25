# GoAccess 1.12 for the site's visit count (site-visits.sh), on an Alpine its
# distribution still supports (#1675, workplan 0152).
#
# WHY IT IS BUILT HERE. Upstream's image, `allinurl/goaccess:1.12` and `latest`
# alike, is built on Alpine 3.20, past its end of life since 2026-04-01 (Trivy
# v0.76.1's table), and upstream's Dockerfile at `master` still says
# `FROM alpine:3.20` in both stages (read on 2026-10-25). Alpine's own package
# is GoAccess 1.10.2 on 3.24, and 1.12 only on edge. So this is upstream's own
# Dockerfile at the tag v1.12, with three changes and no other:
#
#   1. Both stages start from Alpine 3.24, by exact tag and the digest of its
#      index (amd64 and arm64 among its platforms, read from the registry on
#      2026-10-25). 3.24.3 carries musl 1.2.6-r3 (the fix in regcomp,
#      CVE-2026-107891), openssl 3.5.9 and zlib 1.3.2-r1, read from its arm64
#      layer's package database. Dependabot moves this pin
#      (.github/dependabot.yml), tag and digest together.
#   2. The source is fetched by its commit, the one the tag v1.12 names
#      (github.com/allinurl/goaccess, ef3c4f3c), the source the script and the
#      privacy text were read at, instead of upstream's `COPY .` of a checkout.
#      git checks every object against that hash.
#   3. The run stage installs the libraries the binary loads and no more:
#      libintl, libmaxminddb-libs, libncursesw, libssl3 and libcrypto3, with
#      tzdata as upstream has it. Upstream's `gettext-libs` is the gettext
#      tools' own libraries (GoAccess loads only libintl), its `openssl` is
#      the command, and its `libmaxminddb` brings curl and a weekly GeoIP
#      download job on 3.24 (aports 3.24-stable, main/libmaxminddb): nothing
#      GoAccess runs. The stage ends by running the binary once, so a missing
#      library fails the build, not the daily count.
#
# The configure flags, the compiler, the volume, the port, the entrypoint and
# the command are upstream's, so GoAccess behaves as the 1.12 the script was
# written against. The image sets no USER: site-visits.sh runs it as
# 65534:65534, with no network, read-only, with no capability.
#
# Built by site-visits.sh on the machine that counts (live's), as
# `localhost/goaccess:1.12`, a name no registry serves, and run with
# `--pull never`; and by the weekly image scan (security-scan.yml), which
# builds it on an arm64 runner and scans what it built.

# Build stage
FROM alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a AS builds
RUN apk add --no-cache \
    autoconf \
    automake \
    build-base \
    clang \
    gettext-dev \
    git \
    libmaxminddb-dev \
    openssl-dev \
    linux-headers \
    ncurses-dev \
    pkgconf \
    tzdata

# GoAccess v1.12
ARG GOACCESS_COMMIT=ef3c4f3c3e42b378e705fb3a1a5ef1c2e72e6348
WORKDIR /goaccess
RUN git init -q . \
    && git fetch -q --depth 1 https://github.com/allinurl/goaccess.git "$GOACCESS_COMMIT" \
    && git checkout -q FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "$GOACCESS_COMMIT" \
    && rm -rf .git
RUN autoreconf -fiv && rm -rf autom4te.cache
RUN CC="clang" CFLAGS="-O3" LIBS="$(pkg-config --libs openssl)" ./configure --prefix=/usr --enable-utf8 --with-openssl --enable-geoip=mmdb
RUN make -j$(nproc) && make DESTDIR=/dist install
# Check dynamic dependencies
RUN ldd /dist/usr/bin/goaccess && echo "Dependencies checked"

# Runtime stage
FROM alpine:3.24.3@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
RUN apk add --no-cache \
    libcrypto3 \
    libintl \
    libmaxminddb-libs \
    libncursesw \
    libssl3 \
    tzdata
# Copy GoAccess binary and assets
COPY --from=builds /dist/usr/bin/goaccess /usr/bin/goaccess
COPY --from=builds /dist/usr/share /usr/share
COPY --from=builds /usr/share/zoneinfo /usr/share/zoneinfo
# Every library it needs is here: the loader refuses to start it otherwise.
RUN /usr/bin/goaccess --version
# Set up volume and port
VOLUME /var/www/goaccess
EXPOSE 7890
ENTRYPOINT ["/usr/bin/goaccess"]
CMD ["--help"]
