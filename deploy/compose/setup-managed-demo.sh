#!/bin/bash
set -euo pipefail

# Provision the T7 managed-edition demo backend: a real mail (Stalwart) source+target
# and a real DAV (Nextcloud) source+target for each of the two demo tenants
# seed-managed.ts creates, so a real shadow pass can actually complete against the
# managed compose stack instead of failing at "no credentials configured".
#
# This does NOT reinvent bring-up for either backend — it reuses the two canonical,
# already-proven scripts unchanged, just pointed at this stack's network/containers:
#   - deploy/selfhost/setup-stalwart.sh   (mail: IMAP source + JMAP target, two-phase
#     startup — see that script's header for why it can't be a compose service)
#   - deploy/selfhost/setup-nextcloud-users.sh (DAV: CalDAV/CardDAV/WebDAV accounts on
#     top of an already-running Nextcloud compose service)
#
# Run order:
#   1. docker compose -f deploy/compose/managed.yml up -d postgres nextcloud
#   2. ./deploy/compose/setup-managed-demo.sh
#   3. ./deploy/compose/seed-managed.sh          (reads the fixed demo creds below;
#      wraps `pnpm --filter @openmig/api seed:managed`, which on its own cannot
#      find DATABASE_URL/JWT_SECRET/SECRET_ENCRYPTION_KEY — it runs on the host
#      and inherits nothing)
#   4. docker compose -f deploy/compose/managed.yml up -d --build (rest of the stack)
#   5. ./deploy/compose/deploy-tasks.sh          (Trigger.dev tasks — needed for
#      verify/apply's job loop; one-time dashboard steps in that script's header)
#
# Idempotent: both underlying scripts are safe to re-run.
#
# Env overrides (all optional):
#   MANAGED_NETWORK          the ACTUAL compose network name the worker/api containers are on
#                             (default open-migrate-managed_open-migrate-network -- Compose
#                             prefixes managed.yml's `open-migrate-network` key with its pinned
#                             project name `open-migrate-managed`; verify with `docker compose -f
#                             managed.yml config` if that pinned name ever changes)
#   NEXTCLOUD_CONTAINER       (default open-migrate-nextcloud, matches managed.yml)
#   NEXTCLOUD_HOST_PORT       host port nextcloud's :80 is published on
#                             (default 8083, matches managed.yml's NEXTCLOUD_PORT default)
#   STALWART_CONTAINER/VOLUME/CONFIG_VOLUME/JMAP_PORT/IMAPS_PORT — forwarded to
#     setup-stalwart.sh with managed-specific defaults so this never collides with the
#     dev/e2e Stalwart instance (deploy/compose/dev.yml + setup-stalwart.sh's own
#     defaults) if both run on one host.
#   STALWART_CLI_URL — forwarded to setup-stalwart.sh. If you're running this from a
#     Docker-outside-of-Docker sandbox (only reaches Docker via a mounted docker.sock),
#     127.0.0.1:<published-port> may not be reachable from your own shell even though
#     Stalwart is genuinely up (see docs/stalwart-integration-fix.md's DooD section).
#     Join your own container to $MANAGED_NETWORK (`docker network connect
#     open-migrate-managed_open-migrate-network <your-container>`) and set
#     STALWART_CLI_URL=http://stalwart:8080 if the default doesn't work.
#   NEXTCLOUD_URL — forwarded to setup-nextcloud-users.sh, same DooD caveat as
#     STALWART_CLI_URL above (confirmed to affect this script too, 2026-07-25). Join
#     $MANAGED_NETWORK as above and set NEXTCLOUD_URL=http://nextcloud/ if the default
#     127.0.0.1:$NEXTCLOUD_HOST_PORT doesn't work.
#   NEXTCLOUD_ADMIN_PASSWORD — the admin password to authenticate account-provisioning
#     requests with. Read from deploy/compose/.env automatically if not set in your own
#     environment (falls back to the same admin_managed_pw default docker-compose itself
#     uses for the fallback case where .env doesn't set it either -- see managed.yml). Set
#     it explicitly only if your .env genuinely differs from what actually created the
#     running container (e.g. you changed .env after `docker compose up` without
#     recreating nextcloud). Getting this wrong doesn't error at bring-up: it makes every
#     account-provisioning request 401, which then trips Nextcloud's brute-force guard
#     into 429s on top (confirmed live on the Spark box, 2026-07-25 -- managed.env.example
#     ships NEXTCLOUD_ADMIN_PASSWORD=change-me-nextcloud-admin, NOT this script's old
#     hardcoded admin_managed_pw fallback, and the manual .env setup walkthrough never
#     overrides it).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

COMPOSE_ENV_FILE="${REPO_ROOT}/deploy/compose/.env"
if [ -z "${NEXTCLOUD_ADMIN_PASSWORD:-}" ] && [ -f "$COMPOSE_ENV_FILE" ]; then
  NEXTCLOUD_ADMIN_PASSWORD="$(grep -E '^NEXTCLOUD_ADMIN_PASSWORD=' "$COMPOSE_ENV_FILE" | tail -1 | cut -d= -f2-)"
fi

# Must match the ACTUAL Docker network name docker compose creates for managed.yml's
# `open-migrate-network` key, which Compose prefixes with the project name (managed.yml pins
# `name: open-migrate-managed`, so this is fixed/predictable -- verify with `docker compose -f
# managed.yml config` if you ever change that pinned name). Getting this wrong doesn't error: it
# just makes setup-stalwart.sh silently create and join an ISOLATED network of its own, leaving
# Stalwart unreachable from api/worker with no obvious symptom until a sync actually tries to
# connect (confirmed live on the Spark box, 2026-07-25, while chasing an unrelated Postgres bug).
MANAGED_NETWORK="${MANAGED_NETWORK:-open-migrate-managed_open-migrate-network}"
NEXTCLOUD_CONTAINER="${NEXTCLOUD_CONTAINER:-open-migrate-nextcloud}"
NEXTCLOUD_HOST_PORT="${NEXTCLOUD_HOST_PORT:-8083}"

echo "[setup-managed-demo] Provisioning demo Stalwart (mail source+target)..."
STALWART_CONTAINER="${STALWART_CONTAINER:-open-migrate-stalwart}" \
STALWART_VOLUME="${STALWART_VOLUME:-open-migrate-stalwart-data}" \
STALWART_CONFIG_VOLUME="${STALWART_CONFIG_VOLUME:-open-migrate-stalwart-config}" \
STALWART_NETWORK="${MANAGED_NETWORK}" \
STALWART_JMAP_PORT="${STALWART_JMAP_PORT:-18081}" \
STALWART_IMAPS_PORT="${STALWART_IMAPS_PORT:-1994}" \
  "${REPO_ROOT}/deploy/selfhost/setup-stalwart.sh"
# Fixed demo accounts provisioned above (see setup-stalwart.sh's PLAN_FILE):
#   Tenant A: source@dev.local / source_password  ->  target@dev.local / target_password
#   Tenant B: shared@dev.local / shared_password  ->  target-shared@dev.local / target-shared_password
# seed-managed.ts's DEMO_TENANTS credentials must match these exactly.

echo "[setup-managed-demo] Provisioning demo Nextcloud accounts (DAV source+target)..."
NEXTCLOUD_CONTAINER="${NEXTCLOUD_CONTAINER}" \
NEXTCLOUD_HOST_PORT="${NEXTCLOUD_HOST_PORT}" \
NEXTCLOUD_URL="${NEXTCLOUD_URL:-}" \
NEXTCLOUD_ADMIN_PASSWORD="${NEXTCLOUD_ADMIN_PASSWORD:-admin_managed_pw}" \
NEXTCLOUD_SOURCE_USER=tenant-a-source NEXTCLOUD_SOURCE_PASSWORD=tenant_a_source_pw \
NEXTCLOUD_TARGET_USER=tenant-a-target NEXTCLOUD_TARGET_PASSWORD=tenant_a_target_pw \
  "${REPO_ROOT}/deploy/selfhost/setup-nextcloud-users.sh"

NEXTCLOUD_CONTAINER="${NEXTCLOUD_CONTAINER}" \
NEXTCLOUD_HOST_PORT="${NEXTCLOUD_HOST_PORT}" \
NEXTCLOUD_URL="${NEXTCLOUD_URL:-}" \
NEXTCLOUD_ADMIN_PASSWORD="${NEXTCLOUD_ADMIN_PASSWORD:-admin_managed_pw}" \
NEXTCLOUD_SOURCE_USER=tenant-b-source NEXTCLOUD_SOURCE_PASSWORD=tenant_b_source_pw \
NEXTCLOUD_TARGET_USER=tenant-b-target NEXTCLOUD_TARGET_PASSWORD=tenant_b_target_pw \
  "${REPO_ROOT}/deploy/selfhost/setup-nextcloud-users.sh"

# CONTENT, not just accounts (workplan 0084 "what is still owed").
#
# `setup-nextcloud-users.sh` above provisions ACCOUNTS — grep it for PUT and
# nothing comes back. So the demo DAV source was empty for as long as the demo
# existed, every sync of demo tenant B correctly copied nothing, and the
# managed smoke's apply half found "no eligible item" the first night a skip
# was allowed to fail rather than pass (run #7).
#
# It was seeded from the SMOKE's prepare phase, which only fires when the apply
# half has nothing to act on. A precondition that appears only once something
# is already missing is one nobody can reason about: on a stack that happened
# to have content it never ran, so nothing exercised it, and on a fresh one it
# ran in the middle of a gate that was already in trouble. It belongs at
# bring-up, next to the accounts it fills — where the by-hand path and the
# nightly get the same demo.
#
# NO "only if empty" GUARD, unlike the mail seeder. That one APPENDS, so an
# unguarded re-run on this long-lived stack would leave the mailbox a few
# messages larger every night. This one PUTs to fixed paths
# (`openmig-demo-event-1.ics` and friends) and accepts 201 or 204 — created or
# overwritten — so re-running converges on the same handful of resources
# instead of growing. Idempotent by construction rather than by a check.
#
# It fails the phase if it cannot write, deliberately: a demo backend with no
# content in it is the exact condition that cost run #7, and finding out at
# bring-up is cheaper than finding out from a smoke three hours later.
echo "[setup-managed-demo] Seeding calendar, contact and file content into the demo DAV source..."
NEXTCLOUD_CONTAINER="${NEXTCLOUD_CONTAINER}" \
DAV_USER=tenant-b-source DAV_PASSWORD=tenant_b_source_pw \
  "${REPO_ROOT}/deploy/compose/seed-demo-dav-content.sh"

echo "[setup-managed-demo] Done. Demo backend ready for seed-managed.ts:"
echo "[setup-managed-demo]   Mail:  stalwart:993 (IMAPS) / stalwart:8080 (JMAP) on ${MANAGED_NETWORK}"
echo "[setup-managed-demo]   DAV:   http://nextcloud/ on ${MANAGED_NETWORK}"
