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
# The fallback is managed.yml's, not a second opinion — `ownpace-idp`, the
# provider's container name and its network alias. This said `localhost` while
# compose said the same thing, and that agreement was the bug: see the refusal
# below for why no containerised API can ever reach an issuer on loopback.
IDP_DOMAIN="$(read_env ZITADEL_EXTERNALDOMAIN ownpace-idp)"
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

# AN ISSUER ON LOOPBACK CANNOT WORK HERE, AND SAYING SO NOW SAVES A NIGHT.
#
# `localhost` names the API to the API. Every service in managed.yml runs in a
# container, so an issuer on loopback is one the thing that verifies tokens can
# never reach — and the failure is silent and four steps away. E2E (managed) #52
# and #59 are both exactly that: bring-up green in under four minutes, every
# service healthy, and then every authenticated request answering
#
#   HTTP 500 {"error":"auth_failed","reason":"... Reference a101bd7c ..."}
#
# because discovery threw ECONNREFUSED before a token was ever looked at. Not one
# of those refusals mentions an issuer, a token or a URL.
#
# Refused HERE, where the remedy is two lines, rather than found in a server log.
case "$IDP_DOMAIN" in
  localhost|localhost.localdomain|127.*|::1|'[::1]')
    die "ZITADEL_EXTERNALDOMAIN is '${IDP_DOMAIN}', and this stack cannot work with it.

Everything in managed.yml runs in a container, and inside the API's container
'localhost' is the API. So JWT_ISSUER would be ${ISSUER} — an address the host
can reach through the published port and the API can never reach at all. The
stack comes up healthy and every authenticated request answers HTTP 500.

It has to be a name that resolves to the provider from INSIDE the compose
network as well as from a browser. The default is 'ownpace-idp', which is this
provider's container name and a network alias:

    ${UPSERT} ${ENV_FILE} ZITADEL_EXTERNALDOMAIN=ownpace-idp
    echo '127.0.0.1  ownpace-idp' | sudo tee -a /etc/hosts   # only for a browser

On a self-hosted runner, edit the PERSISTED .env as well or instead — the
checkout's copy is restored from it at the top of every run and anything written
here is destroyed by the next \`actions/checkout\` clean:

    \${MANAGED_ENV_PERSIST_DIR:-~/.persistent/ownpace-managed}/.env

A deployment with real DNS sets its real hostname instead and needs no hosts
entry, because DNS answers for both sides.

AND IF THIS PROVIDER HAS ALREADY BEEN INITIALISED under the old name, changing
the variable is not enough: the origin is fixed at first init and no API adds
one afterwards. The provider's own database has to go — that destroys the
provider's accounts and NOTHING else, and this script rebuilds the project, the
application and the client id on the next run:

    docker compose -f ${SCRIPT_DIR}/managed.yml rm -sf zitadel
    docker exec -i ownpace-db sh -c 'psql -U \"\$POSTGRES_USER\" -d postgres -c \"DROP DATABASE IF EXISTS zitadel WITH (FORCE)\"'
    docker volume rm -f ownpace-managed_zitadel_machinekey
    docker compose -f ${SCRIPT_DIR}/managed.yml up -d zitadel
    ${SCRIPT_DIR}/setup-zitadel.sh" ;;
esac

# THIS SCRIPT RUNS ON THE HOST, AND THE ORIGIN IS NOT THE HOST'S TO RESOLVE.
#
# The provider answers only for the origin it was initialised with, and refuses
# every other one with 404 "Instance not found" — so every call below has to
# present ${IDP_DOMAIN}:${IDP_PORT}. But that name is a COMPOSE NETWORK ALIAS:
# it resolves inside the stack's network and, on a plain bring-up, nowhere else.
# The host has the published port and not the name; the API container has the
# name and not the port.
#
# `curl --resolve` is exactly this: connect to an address of our choosing while
# presenting the Host we were asked to. Only used when this machine genuinely
# cannot reach the origin on its own, so a deployment with real DNS — where the
# provider may not even be on this machine — is left alone.
CURL_ORIGIN=()
if ! curl -sS --max-time 3 -o /dev/null "${ISSUER}/debug/healthz" 2>/dev/null; then
  CURL_ORIGIN=(--resolve "${IDP_DOMAIN}:${IDP_PORT}:127.0.0.1")
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

# READ THE VOLUME, NOT THE PROVIDER — AND THEN CHECK WHAT CAME BACK.
#
# `exec -T zitadel cat /machinekey/pat.txt` is what stood here. The Zitadel
# image has no `cat`: no shell, no coreutils, nothing. Docker reports that on
# STDOUT, not stderr, and exits 127:
#
#   OCI runtime exec failed: exec failed: unable to start container process:
#   exec: "cat": executable file not found in $PATH
#
# So `2>/dev/null` silenced the wrong stream, `|| true` swallowed the 127, and
# `[ -n "$PAT" ]` — "is it non-empty" — was satisfied by the error message.
# Zitadel was then handed that sentence as a Bearer token, and said so exactly:
#
#   illegal base64 data at input byte 3
#
# Byte 3 is the space after `OCI`. E2E (managed) #49, #50 and #51 all died of
# it, and two full clear-downs of a database and volume that were never at
# fault were spent chasing it.
#
# THIS WAS ALREADY KNOWN IN THIS REPOSITORY. `prepare_machinekey_volume` reads
# `/etc/passwd` out of this same image with `docker create` + `docker cp`
# precisely because nothing can be assumed to exist inside it, and says so in a
# comment. The lesson was written next to one caller and not applied to the
# other — the same shape as #519 and #521.
#
# busybox has `cat`, and the VOLUME is what actually holds the file. The
# `zitadel-machinekey` service already mounts it for exactly this reason, so
# its command is overridden rather than a second definition invented.
read_provisioning_token() {
  local out rc
  out="$("${COMPOSE[@]}" run --rm --quiet-pull -T zitadel-machinekey cat /machinekey/pat.txt)"
  rc=$?
  [ "$rc" -eq 0 ] || die "could not read /machinekey/pat.txt (exit ${rc}):
    ${out}

That is a failure to READ the file, not a missing token. The file lives on the
${COMPOSE_PROJECT:-ownpace-managed}_zitadel_machinekey volume; this reads it
with busybox because the provider's own image has no shell."
  printf '%s' "$out"
}

PAT="$(read_provisioning_token | tr -d '\r\n')"

# A TOKEN IS NOT MERELY NON-EMPTY. Whatever produced these bytes, they are about
# to be sent to the provider as a credential, so they are checked for the shape
# of one first. An error message is non-empty; so is a progress line, a warning,
# and a YAML dump. Every one of those has a space in it, and no token does.
case "$PAT" in
  '')            die "no provisioning token at /machinekey/pat.txt.

This file is written on FIRST INIT only. If this instance was initialised
before, see REPROVISIONING at the bottom of this script." ;;
  *[[:space:]]*) die "what came back from /machinekey/pat.txt is not a token —
it contains whitespace, and a provisioning token does not:

    ${PAT}

Read that line: it is far more likely to be something's error message than a
credential. Nothing was sent to the provider." ;;
esac
[ "${#PAT}" -ge 20 ] || die "the provisioning token at /machinekey/pat.txt is
${#PAT} characters long, which is too short to be one:

    ${PAT}"

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
  local args=(-sS "${CURL_ORIGIN[@]}" -X "$method" "${ISSUER}${path}"
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

The token was READ successfully and has the shape of one, so this is the
provider DECLINING it rather than something malformed reaching it.

The likeliest reason is that it belongs to an instance that no longer exists:
/machinekey/pat.txt is written on FIRST INIT only, so clearing the zitadel
DATABASE while keeping the machinekey VOLUME leaves exactly this. It is NOT the
only reason, and the provider's own log says which:

    docker compose -f ${SCRIPT_DIR}/managed.yml logs zitadel --no-color | tail -40

Read that before clearing anything. E2E (managed) #49-#51 were spent on an
earlier version of this message naming one cause for a code that has several,
and on two clear-downs of a database and a volume that were never at fault.
See REPROVISIONING at the bottom of this script." ;;
    403)
      die "${method} ${path} answered HTTP 403 — the token is valid, and the machine
user behind it is not allowed to do this.
    ${out}

That is a GRANT, not a credential: 'ownpace-setup' exists but lacks the
permission this call needs. Sign in at ${ISSUER}/ui/console as the first user
and give it the org role it is missing, or see REPROVISIONING at the bottom of
this script." ;;
    2*) : ;;
    404)
      case "$out" in
        *"Instance not found"*|*"unable to set instance using origin"*)
          die "${method} ${path} answered HTTP 404 — the provider does not recognise
the origin this script is presenting.
    ${out}

    presenting:  ${IDP_DOMAIN}:${IDP_PORT}

Zitadel resolves the instance by the ORIGIN of the request and refuses any other,
and the origin is fixed AT FIRST INIT from ZITADEL_EXTERNALDOMAIN. There is no
API that adds one afterwards with this token: AddInstanceDomain lives on the
System API, which a provisioning token cannot reach, and an instance TRUSTED
domain does not change origin resolution.

So an instance initialised under a DIFFERENT domain has to be initialised again.
That destroys the provider's own database and nothing else — no Ownpace data, no
Trigger.dev account — and this script rebuilds the project, the application and
the client id from scratch afterwards:

    docker compose -f ${SCRIPT_DIR}/managed.yml rm -sf zitadel
    docker exec -i ownpace-db sh -c 'psql -U \"\$POSTGRES_USER\" -d postgres -c \"DROP DATABASE IF EXISTS zitadel WITH (FORCE)\"'
    docker volume rm -f ownpace-managed_zitadel_machinekey
    docker compose -f ${SCRIPT_DIR}/managed.yml up -d zitadel
    ${SCRIPT_DIR}/setup-zitadel.sh" ;;
        *) die "${method} ${path} answered HTTP 404:
    ${out}" ;;
      esac ;;
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

# AND `idTokenUserinfoAssertion` IS WHAT PUTS AN EMAIL ADDRESS IN THE TOKEN.
#
# The API requires `sub` AND `email` and nothing else (ADR-0042): invitations are
# addressed to an email address, and somebody signing in for the first time has
# no row anywhere to look one up in. Zitadel puts user info claims in the ID
# token and NOT in the access token — measured on a live instance with the flag
# both off and on:
#
#   access token  iss sub aud exp iat nbf client_id jti          (both ways)
#   ID token      ... + email email_verified name given_name ...  (flag ON)
#
# Without it the sign-in completes and every subsequent request is refused for
# "Missing required claims in token payload". `apps/web/src/services/oidc.ts`
# sends the ID token for the same reason, and says so.

# DEV MODE IS NOT A PREFERENCE. IT IS WHAT AN http REDIRECT URI REQUIRES.
#
# Zitadel refuses a plaintext redirect_uri outright unless the application is in
# dev mode, and it refuses it at /oauth/v2/authorize — before any login screen,
# before the user has typed anything:
#
#   {"error":"invalid_request","error_description":"This client's redirect_uri
#    is http and is not allowed. If you have any questions, you may contact the
#    administrator of the application."}
#
# Provisioned with devMode:false against the default WEB_URL of
# http://localhost:3123, the sign-in button on the web app could not work, and
# NOTHING SAID SO: the project was created, the application was created, the
# client id was written to .env, and this script said "done". The whole of
# workplan 0099's sign-in was dead on arrival and every check passed.
#
# So it is DERIVED from the scheme of WEB_URL, for the same reason
# ZITADEL_EXTERNALPORT is derived from ZITADEL_PORT: two values that have to
# agree, written in two places, are two values that will one day disagree.
case "$WEB_URL" in
  https://*) DEV_MODE=false ;;
  http://*)  DEV_MODE=true  ;;
  *) die "WEB_URL must be an http:// or https:// URL — it is '${WEB_URL}'.
It is the address a browser comes back to after signing in, so the provider has
to be told the scheme; it refuses a plaintext one unless the application is in
dev mode, and this script cannot decide that without knowing which it is." ;;
esac

say "looking for an existing '${APP_NAME}' application"
apps="$(api POST "/management/v1/projects/${PROJECT_ID}/apps/_search" '{"queries":[]}')"
APP_ID="$(jq -r --arg n "$APP_NAME" '.result[]? | select(.name == $n) | .id' <<<"$apps" | awk 'NR==1')"

if [ -z "$APP_ID" ] || [ "$APP_ID" = "null" ]; then
  say "creating it (authorization-code + PKCE, no client secret)"
  CREATED="$(api POST "/management/v1/projects/${PROJECT_ID}/apps/oidc" "$(jq -nc \
    --arg n "$APP_NAME" \
    --argjson r "$REDIRECT_URIS" \
    --argjson l "$LOGOUT_URIS" \
    --argjson dm "$DEV_MODE" \
    '{name:$n,
      redirectUris:$r,
      postLogoutRedirectUris:$l,
      responseTypes:["OIDC_RESPONSE_TYPE_CODE"],
      grantTypes:["OIDC_GRANT_TYPE_AUTHORIZATION_CODE","OIDC_GRANT_TYPE_REFRESH_TOKEN"],
      appType:"OIDC_APP_TYPE_USER_AGENT",
      authMethodType:"OIDC_AUTH_METHOD_TYPE_NONE",
      accessTokenType:"OIDC_TOKEN_TYPE_JWT",
      idTokenUserinfoAssertion:true,
      devMode:$dm}')")"
  CLIENT_ID="$(echo "$CREATED" | jq -r '.clientId')"
  APP_ID="$(echo "$CREATED" | jq -r '.appId')"
  [ -n "$CLIENT_ID" ] && [ "$CLIENT_ID" != "null" ] || die "could not create the application: $CREATED"
else
  say "found it — reading its configuration"
  app="$(api GET "/management/v1/projects/${PROJECT_ID}/apps/${APP_ID}")"
  CLIENT_ID="$(jq -r '.app.oidcConfig.clientId // empty' <<<"$app")"
  [ -n "$CLIENT_ID" ] && [ "$CLIENT_ID" != "null" ] || die "the application exists but has no client id"

  # RECONCILED, NOT MERELY READ — and this is the half that matters, because the
  # stack that already exists is the broken one. An application provisioned by
  # an earlier version of this script has devMode:false and cannot complete a
  # sign-in; a stack whose WEB_URL has since moved has redirect URIs pointing
  # somewhere else. Neither is fixed by a script that, finding an application,
  # reads one field off it and stops.
  #
  # Idempotent means "converges on the described state" (hard rule 1), not
  # "does nothing the second time". Only writes when something actually
  # differs, so a correct stack is untouched and the log stays quiet.
  CURRENT_DEV="$(jq -r '.app.oidcConfig.devMode // false' <<<"$app")"
  CURRENT_URIS="$(jq -c '.app.oidcConfig.redirectUris // []' <<<"$app")"
  CURRENT_USERINFO="$(jq -r '.app.oidcConfig.idTokenUserinfoAssertion // false' <<<"$app")"
  if [ "$CURRENT_DEV" != "$DEV_MODE" ] ||
     [ "$CURRENT_URIS" != "$REDIRECT_URIS" ] ||
     [ "$CURRENT_USERINFO" != "true" ]; then
    say "its dev mode, redirect URIs or claims do not match this stack — putting that right"
    api PUT "/management/v1/projects/${PROJECT_ID}/apps/${APP_ID}/oidc_config" "$(jq -nc \
      --argjson r "$REDIRECT_URIS" \
      --argjson l "$LOGOUT_URIS" \
      --argjson dm "$DEV_MODE" \
      '{redirectUris:$r,
        postLogoutRedirectUris:$l,
        responseTypes:["OIDC_RESPONSE_TYPE_CODE"],
        grantTypes:["OIDC_GRANT_TYPE_AUTHORIZATION_CODE","OIDC_GRANT_TYPE_REFRESH_TOKEN"],
        appType:"OIDC_APP_TYPE_USER_AGENT",
        authMethodType:"OIDC_AUTH_METHOD_TYPE_NONE",
        accessTokenType:"OIDC_TOKEN_TYPE_JWT",
        idTokenUserinfoAssertion:true,
        devMode:$dm}')" >/dev/null
  fi
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
#     docker exec -i ownpace-db sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS zitadel WITH (FORCE)"'
#     docker volume rm ownpace-managed_zitadel_machinekey
#     ./deploy/compose/setup-zitadel.sh
#
#   The `zitadel` ROLE can stay — setup reuses it with the unchanged
#   ZITADEL_DB_PASSWORD. Only reasonable before there are real customers in it.
