#!/usr/bin/env bash
# zitadel-network-alias.sh — decide which name the provider answers to ON THE
# COMPOSE NETWORK, and write it into .env before anything starts.
#
# THE ALIAS THAT SHADOWED THE FRONT.
#
# `managed.yml` gives the zitadel service a network alias so that the origin the
# instance was initialised with resolves to it from everywhere on the stack's
# network. That was added in #1f6a699 for a real failure: `ZITADEL_EXTERNALDOMAIN`
# defaulted to `localhost`, `JWT_ISSUER` became `http://localhost:3126`, and
# inside the API container `localhost` is the API — so every authenticated
# request answered 500 with `ECONNREFUSED 127.0.0.1:3126`.
#
# It is the right answer for a stack where the provider IS the address. It is
# the wrong answer for one where something fronts it.
#
# On a fronted deployment the browser reaches `https://id.example.eu` on 443,
# where a reverse proxy terminates TLS and forwards to the container's 3126. The
# API has to reach that same origin, because `iss` must match byte for byte —
# and it would, through the front, except that the alias pins the name to the
# container INSIDE the network. The API then connects to the container on 443,
# where nothing listens:
#
#     [ready] the issuer's key source at
#     https://id.ota.ownpace.eu/.well-known/openid-configuration is unreachable
#       Error: connect ECONNREFUSED 172.23.0.21:443
#
# Same 500, same shape, opposite cause — and measured rather than reasoned: a
# container on the DEFAULT bridge, where the alias cannot reach, fetched that
# exact URL and got 200 (Spark, 2026-09-01).
#
# So the alias is derived rather than assumed. The provider owns the name only
# when the external address is one it actually serves; otherwise the front owns
# it and this stays out of the way.
#
# Usage:
#   ./deploy/compose/zitadel-network-alias.sh            # decide and write
#   ./deploy/compose/zitadel-network-alias.sh --print    # decide, write nothing
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
UPSERT="${SCRIPT_DIR}/env-upsert.sh"

say() { echo "[zitadel-network-alias] $*"; }
die() { echo "[zitadel-network-alias] FATAL: $*" >&2; exit 1; }

PRINT_ONLY=0
case "${1:-}" in
  --print) PRINT_ONLY=1 ;;
  '') ;;
  *) die "unknown argument '${1}'. Usage: $(basename "$0") [--print]" ;;
esac

[ -f "$ENV_FILE" ] || die "${ENV_FILE} does not exist — run bootstrap-managed.sh --only env first."

# Cut at the first whitespace: managed.env.example documents keys with a comment
# on the same line, and env-upsert.sh refuses any value containing whitespace,
# so everything past the first space is a comment. See
# scripts/two-readings-of-one-env-file.unit.test.ts.
read_env() { # read_env <key> [default]
  local v
  v="$(grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
  [ -n "$v" ] && printf '%s' "$v" || printf '%s' "${2:-}"
}

# The container's OWN port. Not the published one and not the external one: this
# is what Zitadel listens on inside the network, and the only port the alias can
# ever deliver a connection to.
PORT_SELF="$(read_env ZITADEL_PORT 3126)"
PORT_EXT="$(read_env ZITADEL_EXTERNALPORT "$PORT_SELF")"
SECURE="$(read_env ZITADEL_EXTERNALSECURE false)"
DOMAIN="$(read_env ZITADEL_EXTERNALDOMAIN ownpace-idp)"

# TLS is the decisive half. Zitadel serves plain HTTP on its own port; a `true`
# here means something else is terminating TLS, which means something else owns
# the name. A differing port says the same thing in the other direction.
if [ "$SECURE" = "true" ] || [ "$PORT_EXT" != "$PORT_SELF" ]; then
  ALIAS="ownpace-idp"
  say "the external origin is fronted (secure=${SECURE}, external port ${PORT_EXT}, own port ${PORT_SELF})"
  say "so '${DOMAIN}' is NOT aliased on this network — the front answers for it, and"
  say "the API reaches the issuer the same way a browser does."
else
  ALIAS="$DOMAIN"
  say "the provider serves its own external origin (http on ${PORT_SELF})"
  say "so '${DOMAIN}' resolves to the container on this network, which is what lets"
  say "the API present the very origin the instance was initialised with."
fi

if [ "$PRINT_ONLY" -eq 1 ]; then
  printf '%s\n' "$ALIAS"
  exit 0
fi

"$UPSERT" "$ENV_FILE" "ZITADEL_NETWORK_ALIAS=${ALIAS}" >/dev/null
say "ZITADEL_NETWORK_ALIAS=${ALIAS}"
