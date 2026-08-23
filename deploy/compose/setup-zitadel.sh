#!/usr/bin/env bash
# setup-zitadel.sh — bring up the identity provider and provision what the app
# needs, without anybody opening its console (ADR-0042).
#
# WHAT IT DOES, and why each step is here rather than in a runbook:
#
#   1. Generates the secrets the provider needs, via ensure-env-secrets.sh.
#   2. Works out the issuer URL from the addresses already in .env, and writes
#      it back — because the issuer is baked into every token's `iss` claim and
#      the API verifies against it, so the two must be derived from one place
#      or they drift and every token fails with a message about signatures.
#   3. Starts the provider and WAITS FOR ITS OWN readiness signal, not a port.
#   4. Reads the machine token the provider wrote on first init.
#   5. Creates the project and the OIDC application over its API, and captures
#      the client id.
#   6. Writes JWT_ISSUER, JWT_AUDIENCE and the web app's client id into .env.
#
# It is IDEMPOTENT. Run it again and it finds the project and application it
# already made rather than making a second one, so it is safe to re-run after
# changing a redirect URI or losing track of what is configured.
#
# THE PROVISIONING TOKEN IS DELIBERATELY SHORT-LIVED. The provider writes it to
# a named volume on first init only, and this script sets its expiry to one day
# out by default. It exists to do the six steps above and then to become
# useless — a long-lived machine credential with organisation-owner rights,
# sitting in a volume, is the kind of thing that is fine until the day it is
# not. Re-provisioning after it expires means re-initialising, which the
# REPROVISIONING section at the bottom of this file explains.
#
# WHAT IT DOES NOT DO. It does not create your customers. Accounts arrive
# through the invite path (workplan 0093): a request, an owner's decision, an
# invitation. This script sets up the place those accounts will live.
#
# Usage:
#   ./deploy/compose/setup-zitadel.sh              # provision, idempotently
#   ./deploy/compose/setup-zitadel.sh --print      # show what is configured
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml")
UPSERT="${SCRIPT_DIR}/env-upsert.sh"

PROJECT_NAME="Ownpace"
APP_NAME="Ownpace Web"

say() { echo "[setup-zitadel] $*"; }
die() { echo "[setup-zitadel] FATAL: $*" >&2; exit 1; }

# --------------------------------------------------------------- environment --

[ -f "$ENV_FILE" ] || die ".env not found — run ./deploy/compose/bootstrap-managed.sh --only env first"

say "generating any missing secrets"
"${SCRIPT_DIR}/ensure-env-secrets.sh" >/dev/null

read_env() { # read_env <key> [default]
  local v
  v="$(grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  [ -n "$v" ] && printf '%s' "$v" || printf '%s' "${2:-}"
}

# THE ISSUER IS DERIVED, NEVER TYPED TWICE.
#
# It is what the provider stamps into every token's `iss`, and what the API
# checks it against. Two hand-written copies of a URL is how a stack ends up
# rejecting every token with a message about signatures, when the real cause is
# a trailing slash or a port.
IDP_DOMAIN="$(read_env ZITADEL_EXTERNALDOMAIN localhost)"
# Falls back to the PUBLISHED port, matching managed.yml's own fallback, so the
# issuer this script writes and the port the stack serves cannot disagree. On a
# plain bring-up they are one address seen from two sides; they separate only
# when something fronts the provider, and then ZITADEL_EXTERNALPORT is set.
IDP_PORT="$(read_env ZITADEL_EXTERNALPORT "$(read_env ZITADEL_PORT 3126)")"
IDP_SECURE="$(read_env ZITADEL_EXTERNALSECURE false)"
if [ "$IDP_SECURE" = "true" ]; then SCHEME=https; else SCHEME=http; fi
# The port is omitted when it is the scheme's default, because the provider
# omits it too — and `iss` has to match BYTE FOR BYTE.
if { [ "$SCHEME" = "https" ] && [ "$IDP_PORT" = "443" ]; } ||
   { [ "$SCHEME" = "http" ] && [ "$IDP_PORT" = "80" ]; }; then
  ISSUER="${SCHEME}://${IDP_DOMAIN}"
else
  ISSUER="${SCHEME}://${IDP_DOMAIN}:${IDP_PORT}"
fi

WEB_URL="$(read_env WEB_URL http://localhost:3123)"

if [ "${1:-}" = "--print" ]; then
  echo "issuer:      $ISSUER"
  echo "web:         $WEB_URL"
  echo "JWT_ISSUER:  $(read_env JWT_ISSUER '(unset)')"
  echo "client id:   $(read_env VITE_OIDC_CLIENT_ID '(unset)')"
  exit 0
fi

# The provisioning token's expiry, computed now so it is short-lived rather
# than a date somebody picked once and left in a file for a year. Written
# BEFORE the container starts, because the provider reads it at first init.
if command -v date >/dev/null && date -u -d '+1 day' >/dev/null 2>&1; then
  PAT_EXPIRY="$(date -u -d '+1 day' +%Y-%m-%dT%H:%M:%SZ)"        # GNU
elif date -u -v+1d >/dev/null 2>&1; then
  PAT_EXPIRY="$(date -u -v+1d +%Y-%m-%dT%H:%M:%SZ)"              # BSD/macOS
else
  die "could not compute a date one day from now — neither GNU nor BSD \`date\` worked"
fi
"$UPSERT" --if-absent "$ENV_FILE" "ZITADEL_PAT_EXPIRY=${PAT_EXPIRY}" >/dev/null

# ------------------------------------------------------------------- bring up --

say "starting the identity provider (issuer will be ${ISSUER})"
"${COMPOSE[@]}" up -d zitadel

# ASKED FROM THE HOST, because the provider has no healthcheck to wait on.
#
# This waited for `"Health":"healthy"` until E2E (managed) #48, and that stopped
# being reachable the moment the healthcheck was removed — `zitadel ready` asks
# ExternalPort, which is by definition the address the OUTSIDE reaches Zitadel
# on, and nothing is bound to it inside the container. So this waited the full
# five minutes for a field that would never be set and died saying so.
#
# THE PUBLISHED PORT, not ${IDP_PORT}. That one carries ExternalPort for the
# ISSUER, and behind a front it is 443 — the address of the front, which may not
# be up, may not route here, and is not what `compose up` just published. The
# host can only reliably reach what compose published.
PUBLISHED_PORT="$(read_env ZITADEL_PORT 3126)"
READY_URL="http://localhost:${PUBLISHED_PORT}/debug/ready"
say "waiting for it to report ready at ${READY_URL} — its own readiness signal, not a port check"
ready=0
for _ in $(seq 1 60); do
  # The exited branch stays: a provider that died has its reason in its log, and
  # that is worth saying immediately rather than after five minutes of polling.
  state="$("${COMPOSE[@]}" ps --format json zitadel 2>/dev/null | tr -d '\n' || true)"
  case "$state" in
    *'"State":"exited"'*)
      "${COMPOSE[@]}" logs --tail 40 zitadel >&2
      die "the identity provider exited during start-up — its last 40 log lines are above"
      ;;
  esac
  if [ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$READY_URL" 2>/dev/null || echo 000)" = "200" ]; then
    ready=1
    break
  fi
  sleep 5
done
[ "$ready" -eq 1 ] || {
  "${COMPOSE[@]}" logs --tail 40 zitadel >&2
  die "it never answered 200 at ${READY_URL} within five minutes — last 40 log lines above.
    000 would mean nothing answered at all; anything else means it answered and said no."
}
say "ready"

# ---------------------------------------------------------------- credentials --

# Read from inside the container: the token is on a named volume precisely so
# it never lands in the working tree, where `git add -A` could reach it.
PAT="$("${COMPOSE[@]}" exec -T zitadel cat /machinekey/pat.txt 2>/dev/null | tr -d '\r\n' || true)"
[ -n "$PAT" ] || die "no provisioning token at /machinekey/pat.txt.

This file is written on FIRST INIT only. If this instance was initialised
before, see REPROVISIONING at the bottom of this script."

# THE ANSWER IS READ, NOT THROWN AWAY.
#
# This ran `curl -sS` with no `-f` and returned the body alone, so every caller
# was handed an error page and no way to know it was one. E2E (managed) #49 is
# what that costs:
#
#   [setup-zitadel] looking for an existing 'Ownpace' project
#   [setup-zitadel] creating it
#   [setup-zitadel] FATAL: could not create the project
#
# Three different failures reach that line — a token this instance will not
# accept, a machine user without the grant, a provider that answered something
# other than JSON — and it prints the same seven words for all of them. Worse,
# the SEARCH above it cannot fail at all: `.result[]?` turns an error body into
# no output, which is byte-identical to "no such project", so a refused search
# reports "there is no project" and the script confidently goes on to create
# one. An error swallowed into an empty result, which is the thing hard rule 9
# is about.
#
# The workaround for this already existed in ONE place — `read_allow_register`
# reads its setting back precisely because the call could not be trusted — and
# the note above it says why. Fixing the caller and not the callee is how the
# other nineteen instances of #519 survived. So it is fixed here, once.
api() { # api <method> <path> [json-body] — dies on any non-2xx, prints the body
  local method="$1" path="$2" body="${3:-}"
  # DECLARED, THEN ASSIGNED. `local out="$(curl …)"` makes the exit status
  # `local`'s, which is always 0, and the failure disappears.
  local out status rc
  local args=(-sS -X "$method" "${ISSUER}${path}"
    -H "Authorization: Bearer ${PAT}"
    -H "Content-Type: application/json"
    -w '\n%{http_code}')
  [ -n "$body" ] && args+=(-d "$body")

  out="$(curl "${args[@]}")"; rc=$?
  [ "$rc" -eq 0 ] || die "could not reach ${ISSUER}${path} at all (curl exited ${rc}).
Is the identity provider still up?  docker compose -f ${SCRIPT_DIR}/managed.yml ps zitadel"

  status="${out##*$'\n'}"
  out="${out%$'\n'*}"

  case "$status" in
    401)
      die "${method} ${path} answered HTTP 401 — the provisioning token was NOT accepted.
    ${out}

The token at /machinekey/pat.txt is written on FIRST INIT and belongs to the
instance initialised at that moment. A non-empty file is not a valid token: if
the zitadel DATABASE was cleared while the machinekey VOLUME was kept, this
file holds a token for an instance that no longer exists, and every call here
is refused exactly like this. See REPROVISIONING at the bottom of this script." ;;
    403)
      die "${method} ${path} answered HTTP 403 — the token is valid, and the machine
user behind it is not allowed to do this.
    ${out}

That is a GRANT, not a credential: 'ownpace-setup' exists but lacks the
permission this call needs. Sign in at ${ISSUER}/ui/console as the first user
and give it the org role it is missing, or see REPROVISIONING at the bottom of
this script." ;;
    2*) : ;;
    *)  die "${method} ${path} answered HTTP ${status}:
    ${out}" ;;
  esac

  # A 200 carrying an HTML error page from something in front of the provider
  # parses as neither JSON nor an answer, and `jq` would report `null` for it
  # in exactly the shape a real "not found" has.
  if [ -n "$out" ] && ! printf '%s' "$out" | jq -e . >/dev/null 2>&1; then
    die "${method} ${path} answered HTTP ${status} with something that is not JSON:
    ${out}

Something other than the identity provider may be answering on ${ISSUER}."
  fi

  printf '%s' "$out"
}

# THE ONE PLACE THAT MEANS "TRY IT". `api` dies on a non-2xx, which is what
# every call here wants except the login-policy pair below, where exactly one of
# two verbs is EXPECTED to fail and the setting is read back to decide. Running
# it in a subshell keeps its `exit` from taking the script with it — `|| true`
# does NOT catch an `exit`, which is how a stricter `api` would otherwise have
# turned a deliberate best-effort call into a fatal one.
api_try() { ( api "$@" ) >/dev/null 2>&1 || true; }

need_jq() { command -v jq >/dev/null || die "jq is required — install it and re-run"; }
need_jq

# A NON-EMPTY FILE IS NOT A VALID TOKEN, and the check above only proved the
# file. One call whose entire job is to make the provider say whether it still
# accepts this token, so a dead one is named HERE — where the remedy is — and
# not four calls later as "could not create the project".
say "checking the identity provider still accepts this provisioning token"
api GET /auth/v1/users/me >/dev/null

# ------------------------------------------------------------------- project --

say "looking for an existing '${PROJECT_NAME}' project"
projects="$(api POST /management/v1/projects/_search '{"queries":[]}')"
PROJECT_ID="$(jq -r --arg n "$PROJECT_NAME" '.result[]? | select(.name == $n) | .id' <<<"$projects" | awk 'NR==1')"

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "null" ]; then
  say "creating it"
  created="$(api POST /management/v1/projects "$(jq -nc --arg n "$PROJECT_NAME" '{name:$n}')")"
  PROJECT_ID="$(jq -r '.id // empty' <<<"$created")"
  [ -n "$PROJECT_ID" ] || die "the provider accepted POST /management/v1/projects and the
answer carries no project id:
    ${created}"
else
  say "found it"
fi
say "project ${PROJECT_ID}"

# --------------------------------------------------------------- application --

# PKCE AND NO CLIENT SECRET, because the client is a single-page app in a
# browser. A confidential client would mean shipping a secret to every visitor,
# which is not a secret. This is also why ADR-0042 can call the integration
# "plain OIDC": authorization-code + PKCE is the same flow at every provider.
REDIRECT_URIS="$(jq -nc --arg w "$WEB_URL" '[$w + "/auth/callback"]')"
LOGOUT_URIS="$(jq -nc --arg w "$WEB_URL" '[$w + "/login"]')"

say "looking for an existing '${APP_NAME}' application"
apps="$(api POST "/management/v1/projects/${PROJECT_ID}/apps/_search" '{"queries":[]}')"
APP_ID="$(jq -r --arg n "$APP_NAME" '.result[]? | select(.name == $n) | .id' <<<"$apps" | awk 'NR==1')"

if [ -z "$APP_ID" ] || [ "$APP_ID" = "null" ]; then
  say "creating it (authorization-code + PKCE, no client secret)"
  CREATED="$(api POST "/management/v1/projects/${PROJECT_ID}/apps/oidc" "$(jq -nc \
    --arg n "$APP_NAME" \
    --argjson r "$REDIRECT_URIS" \
    --argjson l "$LOGOUT_URIS" \
    '{name:$n,
      redirectUris:$r,
      postLogoutRedirectUris:$l,
      responseTypes:["OIDC_RESPONSE_TYPE_CODE"],
      grantTypes:["OIDC_GRANT_TYPE_AUTHORIZATION_CODE","OIDC_GRANT_TYPE_REFRESH_TOKEN"],
      appType:"OIDC_APP_TYPE_USER_AGENT",
      authMethodType:"OIDC_AUTH_METHOD_TYPE_NONE",
      accessTokenType:"OIDC_TOKEN_TYPE_JWT",
      devMode:false}')")"
  CLIENT_ID="$(echo "$CREATED" | jq -r '.clientId')"
  APP_ID="$(echo "$CREATED" | jq -r '.appId')"
  [ -n "$CLIENT_ID" ] && [ "$CLIENT_ID" != "null" ] || die "could not create the application: $CREATED"
else
  say "found it — reading its client id"
  app="$(api GET "/management/v1/projects/${PROJECT_ID}/apps/${APP_ID}")"
  CLIENT_ID="$(jq -r '.app.oidcConfig.clientId // empty' <<<"$app")"
  [ -n "$CLIENT_ID" ] && [ "$CLIENT_ID" != "null" ] || die "the application exists but has no client id"
fi
say "client ${CLIENT_ID}"

# ------------------------------------------------------- letting people in --
#
# SELF-REGISTRATION, ON (owner decision 2026-08-22, workplan 0095 T0).
#
# Granting an access request creates the organisation and an INVITATION — a
# `tenant_member` row addressed to an email with no subject on it yet. Nothing
# creates the person's account here, and nothing may: ADR-0042's third operative
# rule keeps the integration inside plain OIDC, and calling this provider's
# user-management API is exactly the coupling that would make switching provider
# a project again. So the invited person has to be able to make their own
# account, or a granted request dead-ends at a sign-in page they cannot pass.
#
# THIS IS NOT AN OPEN DOOR. An account here grants nothing on its own: every
# policy in Ownpace keys on `app.current_tenant` or `app.current_user`, and a
# subject with no `tenant_member` row sees no organisation, no migration and no
# queue — `GET /api/me` answers "none" without refusing, and the web app says so
# in a sentence. Registering gets somebody a password and an explanation.
#
# What binds them to the organisation is the email address, and ONLY when this
# provider says it verified it (`email_verified`, migration 0006). Which is why
# the two settings below travel together: self-registration without verified
# email would mean whoever types an address inherits what was granted to it.
say "allowing people to register, with a verified email"
# Two readers, deliberately. The PROBE runs before anything has been written and
# must survive an organisation that has no login policy of its own; the DECIDER
# runs after the writes, where a call that cannot be made is the answer.
probe_allow_register() { jq -r '.policy.allowRegister // empty' <<<"$( ( api GET /management/v1/policies/login ) 2>/dev/null || true)"; }
read_allow_register() { jq -r '.policy.allowRegister // empty' <<<"$(api GET /management/v1/policies/login)"; }

if [ "$(probe_allow_register)" = "true" ]; then
  say "already allowed"
else
  POLICY="$(jq -nc '{allowRegister:true, allowUsernamePassword:true, allowExternalIdp:false}')"
  # An organisation may not have a login policy of its own yet, in which case it
  # inherits the instance default and the PUT has nothing to update — so both
  # verbs are attempted and NEITHER is trusted.
  #
  # NEITHER VERB IS TRUSTED, even now that `api` reports what it was told.
  # `api_try` is used precisely because one of these two is expected to be
  # refused, so "it did not error" cannot mean "it took". For this setting a
  # call that changed nothing means a granted person reaches a sign-in page
  # they cannot pass — a failure that surfaces days later, in front of a
  # customer. So the setting is READ BACK, and that is what decides.
  api_try PUT /management/v1/policies/login "$POLICY"
  api_try POST /management/v1/policies/login "$POLICY"

  [ "$(read_allow_register)" = "true" ] \
    || die "could not allow people to register.

Granting an access request creates an invitation, not an account — ADR-0042
forbids us from creating one at the provider — so without this a granted person
reaches a sign-in page they cannot get past.

Set it by hand: the console at ${ISSUER}/ui/console, under
Organisation -> Login Behaviour, tick 'Register allowed'."
  say "allowed"
fi

# ACCESS TOKENS AS JWT, above, is what makes the API's JWKS path work at all.
# The default is an opaque token, which the API cannot verify locally — it would
# have to call the provider's introspection endpoint on every request, which is
# both slower and exactly the provider-specific coupling ADR-0042 forbids.

# ------------------------------------------------------------------- writing --

say "writing the configuration into .env"
"$UPSERT" "$ENV_FILE" \
  "JWT_ISSUER=${ISSUER}" \
  "JWT_AUDIENCE=${PROJECT_ID}" \
  "VITE_OIDC_ISSUER=${ISSUER}" \
  "VITE_OIDC_CLIENT_ID=${CLIENT_ID}"

cat <<EOF

[setup-zitadel] done.

  issuer     ${ISSUER}
  audience   ${PROJECT_ID}
  client     ${CLIENT_ID}
  console    ${ISSUER}/ui/console
  first user $(read_env ZITADEL_ADMIN_USERNAME owner)@${IDP_DOMAIN}
             password is ZITADEL_ADMIN_PASSWORD in .env, and must be changed
             on first sign-in

The API picks the issuer up on restart, and prefers it over JWT_SECRET from
that moment on:

  docker compose -f deploy/compose/managed.yml up -d --force-recreate api

The web app bakes VITE_OIDC_* in at BUILD time, so it needs rebuilding:

  docker compose -f deploy/compose/managed.yml up -d --build web

EOF

# ------------------------------------------------------------ REPROVISIONING --
#
# The provisioning token is written on FIRST INIT and expires. If this script
# says it cannot find one, the instance is already initialised and the token is
# gone or stale. Two honest ways forward:
#
#   Keep the instance. Sign in at ${ISSUER}/ui/console as the first user, and
#   read the client id from the Ownpace project's application. Then:
#     ./deploy/compose/env-upsert.sh deploy/compose/.env \
#        JWT_ISSUER=... JWT_AUDIENCE=... VITE_OIDC_CLIENT_ID=...
#
#   Start over, which DESTROYS every account it holds. THE DATABASE AND THE
#   VOLUME GO TOGETHER, and doing half of it is what produces the refusal you
#   are probably reading: the token is written at FIRST INIT only, so a cleared
#   database with a kept volume leaves a token for an instance that is gone,
#   and a kept database with a cleared volume leaves no token at all.
#
#     docker compose -f deploy/compose/managed.yml rm -sf zitadel
#     docker exec -i ownpace-db sh -c 'psql -U "\$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS zitadel WITH (FORCE)"'
#     docker volume rm ownpace-managed_zitadel_machinekey
#     ./deploy/compose/setup-zitadel.sh
#
#   The `zitadel` ROLE can stay — setup reuses it with the unchanged
#   ZITADEL_DB_PASSWORD. Only reasonable before there are real customers in it.
