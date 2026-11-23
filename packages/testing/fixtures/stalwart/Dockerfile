# The official Stalwart image with this directory's config.json baked in: the
# `stalwart-test-custom` image of 2026-07-05. Nothing here builds it any more:
# the integration tests (packages/testing/src/testcontainers-setup.ts) and
# setup-stalwart.sh start `stalwartlabs/stalwart` itself
# (docs/stalwart-integration-fix.md, "Verified Image"). It is one of the copies
# of the pin, which moves only by ADR-0022 ("Moving the pin"): the tag, with the
# digest of its index.
FROM stalwartlabs/stalwart:v1.2.0-alpine@sha256:2b7dfee66dfd116a903607826e03e4f8af8841207fae28098aa908c568ca919a
COPY config.json /etc/stalwart/config.json
# The image's own user, stalwart, by number: its config's `User`, uid and gid
# 2000 in its /etc/passwd (read at v1.1.1's digest on 2026-11-20, and at
# v1.2.0-alpine's above, for linux/amd64 and linux/arm64, on 2026-11-23).
USER 2000:2000
