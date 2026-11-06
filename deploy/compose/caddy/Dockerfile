# The TLS front of the Trigger.dev dashboard (managed.yml's trigger-tls),
# built here: Caddy's official image at the pinned digest, with curl removed,
# and with it the libraries only curl pulled in (workplan 0119, 2026-10-31).
#
# WHY. Upstream's image adds curl itself, `apk add --no-cache ca-certificates
# curl libcap mailcap` (caddy-docker's 2.11/alpine/Dockerfile, since its
# commit f760f9dc of 2026-01-16, which gives no reason), and the image's
# history shows that line. libcurl needs brotli-libs, c-ares, libidn2, libpsl,
# nghttp2-libs and zstd-libs, and libidn2 and libpsl need libunistring;
# nothing else in the image needs any of them (read from its
# /lib/apk/db/installed). On 2026-10-31 that cost the service its one critical
# finding and two of its highs: `caddy:2.11.7-alpine`, on Alpine 3.23.7, read
# with Trivy v0.76.1 and its database of 2026-10-30, held 1 critical and 9
# high, three of them in with curl:
#   - CVE-2026-111497, critical, in brotli-libs 1.2.0-r0 (fixed in 1.2.1-r0);
#   - CVE-2026-92392, high, in curl and libcurl 8.22.0-r0 (fixed in 8.23.0-r0).
# The FROM below is v2.11.9, Caddy's newest tag, on Alpine 3.24.4, whose curl
# and libcurl 8.23.0-r0 and brotli-libs 1.2.1-r0 carry those fixes. curl goes
# all the same: nothing here runs it, and what is not installed brings no
# next finding. Docker Hub pushed the tag's linux/amd64 image (fc9cbc10…) on
# 2026-11-05 at 20:52 UTC, its linux/arm64 image (9ee99810…) at 23:52, and the
# index (the digest below) on 2026-11-06 at 08:52; both images hold the same
# packages, read from the registry on 2026-11-06.
#
# WHY NOTHING HERE NEEDS CURL. Caddy is one statically linked Go binary, and
# nothing in Caddy runs curl. Nothing else does in this container either: the
# service has no healthcheck (a probe would run inside the image, and
# smoke-managed.sh says why it has none), nothing in this repository runs
# `exec` in it, and the smoke asks the front from the host, with the host's
# own curl, over the published port. `tls internal` needs no network, and the
# trust store and its tool, ca-certificates, stay.
#
# WHAT IT IS. Upstream's image as it is, and one RUN. The RUN checks that the
# three packages are installed at the versions read above, and stops with
# "re-read the header" otherwise, because a base whose packages differ is not
# the one this file was written for. Then `apk del --no-network curl`, which
# needs no network: it removes curl and the eight libraries only curl needed
# (brotli-libs, c-ares, libcurl, libidn2, libpsl, libunistring, nghttp2-libs,
# zstd-libs), and nothing else (ssl_client stays, installed by busybox and
# libssl3). Then it proves the nine are gone, that upstream's three other
# packages are still there, that no curl is left on the PATH, and that
# `caddy version` still prints the release the FROM names. The user, the
# command, the working directory, the ports and the environment are
# upstream's: this file sets none of them. On v2.11.7 the image scan read the
# build at 0 critical and 7 high, 6 of them fixable (Security Scan run
# 41161126144, linux/arm64, 2026-10-31), all seven in the Caddy binary: Go's
# standard library v1.26.8 (four), golang.org/x/net v0.59.0 (one) and go-jose
# v4 v4.1.5 and v3 v3.0.5 (CVE-2026-116587 in each). v2.11.8, built with Go
# 1.27.3 and on golang.org/x/net v0.60.0, which carry the first five's fixes,
# read 0 critical and 2 high, 1 of them fixable, both go-jose (Security Scan
# run 42143936608, linux/arm64, 2026-11-06). v2.11.9's binary, read with `go
# version -m` on both platforms, has v2.11.8's modules but for go-jose v4, at
# v4.1.6, the fix; go-jose v3 stays at v3.0.5, which has none. So this build
# should read 0 critical and 1 high, with no fix, until go-jose v3 has one or
# Caddy drops it.
#
# THE NAME. managed.yml builds this as `localhost/caddy:<base tag>-<12 hex>`,
# a name no registry serves, with `pull_policy: never`, as
# deploy/compose/postgres/Dockerfile's header says for the databases. The
# twelve hex digits are the SHA-256 of this file's instruction lines, comments
# and blank lines left out,
#   grep -Ev '^[[:space:]]*(#|$)' deploy/compose/caddy/Dockerfile | sha256sum | cut -c1-12
# so a changed instruction is a name the machine does not have yet, and `up`
# builds it. Nothing builds it while the machine has the name (managed.yml's
# header). scripts/a-package-the-front-never-runs.unit.test.ts holds the image
# line to it, and when an instruction changes, its failure prints the `sed`
# that moves the line. A FROM and a RUN, and nothing else: no parser
# directive, no COPY, no ADD and no --mount, so the name is the content.
#
# HOW IT MOVES.
#   - A newer Caddy 2, or a rebuild of the tag: Dependabot's pull request
#     (.github/dependabot.yml, this directory's own entry, never a major). Its
#     build fails here until this file is read again: re-read the image's
#     packages and scan, then move the versions the RUN checks, the release it
#     asks `caddy version` for, and this header, or the RUN itself if upstream
#     no longer adds curl. That changes the name, which fails the guard until
#     managed.yml's image line moves too, and the failure prints the `sed`.
#     images.yml's `build (caddy)` builds it on the pull request, starts it
#     with trigger-tls.Caddyfile and asks it for TLS on 3443; then dispatch E2E
#     (managed) on the branch, whose smoke asks the same front.
#   - Another major: the owner's call, and Dependabot is told to leave it.
FROM caddy:2.11.9-alpine@sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee

# Not upstream's: curl out, and what only curl needed (the header).
RUN set -eu; \
    for want in curl=8.23.0-r0 libcurl=8.23.0-r0 brotli-libs=1.2.1-r0; do \
      awk -v want="$want" '/^P:/ { p = substr($0, 3) } /^V:/ && (p "=" substr($0, 3)) == want { found = 1 } END { exit !found }' /lib/apk/db/installed \
        || { echo "this base does not have $want, as this file's header read it: re-read the header" >&2; exit 1; }; \
    done; \
    apk del --no-network curl; \
    for gone in curl libcurl brotli-libs c-ares libidn2 libpsl libunistring nghttp2-libs zstd-libs; do \
      if grep -qx "P:$gone" /lib/apk/db/installed; then echo "$gone is still installed after apk del curl: re-read the header" >&2; exit 1; fi; \
    done; \
    for kept in ca-certificates libcap mailcap; do \
      grep -qx "P:$kept" /lib/apk/db/installed || { echo "$kept went with curl: re-read the header" >&2; exit 1; }; \
    done; \
    if command -v curl; then echo "a curl is still on the PATH: re-read the header" >&2; exit 1; fi; \
    version="$(caddy version)"; \
    case "$version" in v2.11.9|"v2.11.9 "*) ;; *) echo "caddy version printed '$version', not v2.11.9: re-read the header" >&2; exit 1 ;; esac
