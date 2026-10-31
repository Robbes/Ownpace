# The TLS front of the Trigger.dev dashboard (managed.yml's trigger-tls),
# built here: Caddy's official image at the pinned digest, with curl removed,
# and with it the libraries only curl pulled in (workplan 0119, 2026-10-31).
#
# WHY. The service ran `caddy:2.11.7-alpine` by the index digest below. Read on
# 2026-10-31 with Trivy v0.76.1 and its database of 2026-10-30, the image scan's
# reading (high and critical, vulnerabilities only), it holds 1 critical and 9
# high findings, 9 of them fixed in a newer package, on linux/arm64 and
# linux/amd64 alike. Three are in the operating system, Alpine 3.23.7:
#   - CVE-2026-111497, critical, in brotli-libs 1.2.0-r0 (fixed in 1.2.1-r0);
#   - CVE-2026-92392, high, in curl and libcurl 8.22.0-r0 (fixed in 8.23.0-r0).
# All three come in with curl. Upstream's Dockerfile adds it itself,
# `apk add --no-cache ca-certificates curl libcap mailcap` (caddy-docker's
# 2.11/alpine/Dockerfile, since its commit f760f9dc of 2026-01-16, which gives
# no reason), and the image's history shows that line. libcurl needs
# brotli-libs, c-ares, libidn2, libpsl, nghttp2-libs and zstd-libs, and
# libidn2 and libpsl need libunistring; nothing else in the image needs any of
# them (read from its /lib/apk/db/installed). Upstream will not move it soon:
# v2.11.7 is Caddy's newest tag, and Docker Hub's re-push of the tag on
# 2026-10-30 changed its riscv64 image only, so its linux/amd64 (04913b1d…)
# and linux/arm64 (cc447f14…) images are still the builds of 2026-10-21 that
# the digest below names.
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
# upstream's: this file sets none of them. Read with Trivy as an image with
# the nine packages and their files removed, it holds 0 critical and 7 high
# findings, 6 of them fixable, all in the Caddy binary, on both platforms:
#   - github.com/go-jose/go-jose/v4 v4.1.5, CVE-2026-116587 (fixed in 4.1.6);
#   - github.com/go-jose/go-jose/v3 v3.0.5, the same CVE, with no fix;
#   - golang.org/x/net v0.59.0, CVE-2026-78669 (fixed in 0.60.0);
#   - the Go standard library v1.26.8, CVE-2026-111943, CVE-2026-78667,
#     CVE-2026-78669 and CVE-2026-97031 (fixed in 1.26.9 and 1.26.10).
# Those leave with a Caddy release built on newer modules and a newer Go.
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
FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f

# Not upstream's: curl out, and what only curl needed (the header).
RUN set -eu; \
    for want in curl=8.22.0-r0 libcurl=8.22.0-r0 brotli-libs=1.2.0-r0; do \
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
    case "$version" in v2.11.7|"v2.11.7 "*) ;; *) echo "caddy version printed '$version', not v2.11.7: re-read the header" >&2; exit 1 ;; esac
