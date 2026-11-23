# The official Stalwart image with this directory's config.json baked in: the
# `stalwart-test-custom` image of 2026-07-05. Nothing here builds it any more:
# the integration tests (packages/testing/src/testcontainers-setup.ts) and
# setup-stalwart.sh start `stalwartlabs/stalwart` itself
# (docs/stalwart-integration-fix.md, "Verified Image"). It is one of the copies
# of the pin, which moves only by ADR-0022 ("Moving the pin"): the tag, with the
# digest of its index.
FROM stalwartlabs/stalwart:v1.1.1-alpine@sha256:53ce86ed60f3730a031b09721b9b83b80e062f2f2095ea0e9b343bdd4ff6cc2e
COPY config.json /etc/stalwart/config.json
# The image's own user, stalwart, by number: its config's `User`, uid and gid
# 2000 in its /etc/passwd (read at the Debian build's digest on 2026-11-20, and
# at the Alpine build's above, for linux/amd64 and linux/arm64, on 2026-11-23).
USER 2000:2000
