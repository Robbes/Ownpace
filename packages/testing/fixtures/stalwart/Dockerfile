# The official Stalwart image with this directory's config.json baked in: the
# `stalwart-test-custom` image of 2026-07-05. Nothing here builds it any more:
# the integration tests (packages/testing/src/testcontainers-setup.ts) and
# setup-stalwart.sh start `stalwartlabs/stalwart` itself
# (docs/stalwart-integration-fix.md, "Verified Image"). It is one of the copies
# of the pin, which moves only by ADR-0022 ("Moving the pin"): the tag, with the
# digest of its index.
FROM stalwartlabs/stalwart:v1.1.1@sha256:5ebdf474b237161742fe4309396af4ae8797c938e8e6eb7e2d4837332c4f9851
COPY config.json /etc/stalwart/config.json
# The image's own user, stalwart, by number: its config's `User`, uid and gid
# 2000 in its /etc/passwd (read at the digest above, 2026-11-20).
USER 2000:2000
