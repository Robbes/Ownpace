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
  v="$(grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
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

AND IF THIS PROVIDER WAS ALREADY INITIALISED under the old name, changing the
variable IS still enough — this script registers the new origin as a TRUSTED
domain on the way past, and the instance then answers for it. Measured: E2E
(managed) #61 reached `issuer: http://ownpace-idp:3126 (declares its own name)`
from inside the API container, on an instance initialised as `localhost` and
never re-initialised.

Only if this script cannot reach the instance AT ALL — no origin it knows still
resolves, so it cannot even ask — is there nothing left but to initialise it
again. That destroys the provider's accounts and NOTHING else, and this script
rebuilds the project, the application and the client id on the next run:

    docker compose -f ${SCRIPT_DIR}/managed.yml rm -sf zitadel
    docker exec -i ownpace-db sh -c 'psql -U \"\$POSTGRES_USER\" -d postgres -c \"DROP DATABASE IF EXISTS zitadel WITH (FORCE)\"'
    docker volume rm -f ownpace-managed_zitadel_machinekey
    ${SCRIPT_DIR}/bootstrap-managed.sh --only app" ;;
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

# THE CREDENTIAL'S LIFETIME, in one place. The seed below is read by the
# provider exactly once — at FIRST INIT — and the rotation section further down
# ("the credential's clock") owns the token from then on, minting a successor
# whenever fewer than ZITADEL_PAT_ROTATE_BELOW_DAYS days remain. Seed and
# successor use the same lifetime, so the first credential and every later one
# live by the same rule.
PAT_LIFETIME_DAYS="$(read_env ZITADEL_PAT_LIFETIME_DAYS 7)"
PAT_ROTATE_BELOW_DAYS="$(read_env ZITADEL_PAT_ROTATE_BELOW_DAYS 3)"
[[ "$PAT_LIFETIME_DAYS" =~ ^[1-9][0-9]*$ ]] ||
  die "ZITADEL_PAT_LIFETIME_DAYS must be a whole number of days, not '${PAT_LIFETIME_DAYS}'"
[[ "$PAT_ROTATE_BELOW_DAYS" =~ ^[1-9][0-9]*$ ]] ||
  die "ZITADEL_PAT_ROTATE_BELOW_DAYS must be a whole number of days, not '${PAT_ROTATE_BELOW_DAYS}'"
[ "$PAT_ROTATE_BELOW_DAYS" -lt "$PAT_LIFETIME_DAYS" ] ||
  die "ZITADEL_PAT_ROTATE_BELOW_DAYS (${PAT_ROTATE_BELOW_DAYS}) must be smaller than
ZITADEL_PAT_LIFETIME_DAYS (${PAT_LIFETIME_DAYS}), or every single run would rotate the token"

future_iso() { # future_iso <days> — UTC, RFC3339; GNU date, then BSD
  date -u -d "+${1} day" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null && return 0
  date -u -v"+${1}d" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null && return 0
  return 1
}
iso_to_epoch() { # tolerates the provider stamping fractional seconds
  local iso="${1%%.*}"
  iso="${iso%Z}Z"
  date -u -d "$iso" +%s 2>/dev/null && return 0
  date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s 2>/dev/null && return 0
  return 1
}

# The seed. --if-absent, because on an already-provisioned stack this value is
# maintained by the rotation section against the LIVE token, and overwriting it
# here would put a date in the file that no credential actually carries. It is
# written before the container starts because first init is the one moment the
# provider reads it.
PAT_EXPIRY="$(future_iso "$PAT_LIFETIME_DAYS")" ||
  die "could not compute a date ${PAT_LIFETIME_DAYS} days from now — neither GNU nor BSD \`date\` worked"
"$UPSERT" --if-absent "$ENV_FILE" "ZITADEL_PAT_EXPIRY=${PAT_EXPIRY}" >/dev/null

# ------------------------------------------------------------------- bring up --

# The alias this container answers to on the network is decided from the same
# three values the issuer above is built from, and it has to be written before
# the container joins the network. Called here as well as from
# bootstrap-managed.sh because this script is also run on its own.
"${SCRIPT_DIR}/zitadel-network-alias.sh"

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
provider DECLINING it rather than something malformed reaching it. Two causes
cover nearly every case:

  IT EXPIRED. The token carries its own deadline. This script's note of it —
  ZITADEL_PAT_EXPIRY in ${ENV_FILE}, last written when a run last synced it —
  says: $(read_env ZITADEL_PAT_EXPIRY unknown).
  Every run of this script rotates the token when fewer than
  ${PAT_ROTATE_BELOW_DAYS} days remain, so an expired one means the gate has
  not run since before that window closed. The way back in without destroying
  anything: sign in at ${ISSUER}/ui/console as the first user, mint a new
  personal access token on the 'ownpace-setup' service user, and write it over
  /machinekey/pat.txt on the ${COMPOSE_PROJECT:-ownpace-managed}_zitadel_machinekey volume.

  IT BELONGS TO AN INSTANCE THAT NO LONGER EXISTS. /machinekey/pat.txt is
  written on FIRST INIT only, so clearing the zitadel DATABASE while keeping
  the machinekey VOLUME leaves exactly this.

The provider's own log says which:

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

Zitadel resolves the instance by the ORIGIN of a request — host AND PORT — and
refuses any other. This script adds \${IDP_DOMAIN} as a TRUSTED domain, which is
enough to make an instance answer for an origin it was not initialised with; but
it can only do that once it can reach the instance, and reaching it is what has
just failed. Something the instance already knows has to answer first.

CHECK THE PORT BEFORE ASSUMING THE HOST IS WRONG. \${IDP_DOMAIN}:8080 and
\${IDP_DOMAIN}:3126 are different origins, and an evening went into concluding
that trusted domains cannot work when the real fault was a provider LISTENING on
one port and stamping another into its issuer.

If nothing reaches it, the instance has to be initialised again. That destroys
the provider's own database and nothing else — no Ownpace data, no Trigger.dev
account — and this script rebuilds the project, the application and the client
id from scratch afterwards:

    docker compose -f ${SCRIPT_DIR}/managed.yml rm -sf zitadel
    docker exec -i ownpace-db sh -c 'psql -U \"\$POSTGRES_USER\" -d postgres -c \"DROP DATABASE IF EXISTS zitadel WITH (FORCE)\"'
    docker volume rm -f ownpace-managed_zitadel_machinekey
    ${SCRIPT_DIR}/bootstrap-managed.sh --only app" ;;
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
me="$(api GET /auth/v1/users/me)"
SETUP_UID="$(jq -r '.user.id // empty' <<<"$me")"
[ -n "$SETUP_UID" ] || die "the provider accepted the token but named no user id in its answer:
    ${me}"

# ------------------------------------------------------ the credential's clock --
#
# THE TOKEN THIS SCRIPT RUNS ON EXPIRES, AND UNTIL NOW NOTHING RENEWED IT. Its
# expiry is a FIRSTINSTANCE setting: the provider reads ZITADEL_PAT_EXPIRY from
# .env exactly once, at init, and the --if-absent seed above means that value
# was the timestamp of whichever run FIRST executed this script, plus a
# lifetime — it never moved again. E2E (managed) #66 MEASURED the note and the
# truth already apart: the gate's .env said 2026-08-24 while the live token
# holds 2026-12-31 — the lucky direction, and an accident of plumbing (the gate
# restores .env from a copy persisted before this script runs, so its writes
# evaporate and no seed ever reached an init). On a host where
# deploy/compose/.env is the real, durable file, the same drift arms the
# opposite trap: a re-init reads a seed that has meanwhile slipped into the
# past and mints a token BORN DEAD. And past any deadline no rotation is
# possible at all, because minting a successor needs the very token that died.
#
# So the credential keeps its own clock. Every run asks the PROVIDER when the
# token dies — the .env note is a note, not the truth — and inside the rotation
# window mints a successor, PROVES the successor works, writes it to the
# volume, reads it back, and only then deletes the predecessors. In that order:
# a failure at any step leaves a working token somewhere rather than none
# anywhere. A crash mid-rotation leaves two live tokens, and the next run's
# delete-everything-but-the-successor takes the extra one back.
#
# The .env note then moves to the successor's real expiry with a PLAIN upsert —
# --if-absent here would keep the stale date forever, which is the exact bug
# this section exists to end. That also un-poisons REPROVISIONING: a re-init
# now reads a seed at most one lifetime old, never one from the first bring-up.
say "asking the provider when this provisioning token expires"
pats="$(api POST "/management/v1/users/${SETUP_UID}/pats/_search" '{}')"
NEAREST="$(jq -r '[.result[]?.expirationDate | select(. != null)] | min // empty' <<<"$pats")"
[ -n "$NEAREST" ] || die "the provider lists no personal access tokens for user ${SETUP_UID},
yet one of them just authenticated this very call. Refusing to guess; it answered:
    ${pats}"
NEAREST="${NEAREST%%.*}"
NEAREST="${NEAREST%Z}Z"

EXP_EPOCH="$(iso_to_epoch "$NEAREST")" ||
  die "could not parse the expiry the provider reported: '${NEAREST}'"
LEFT_SECONDS=$(( EXP_EPOCH - $(date -u +%s) ))

# THE POLICY OWNS BOTH ENDS. Too close to death is the obvious trigger; too
# far past the lifetime is the other half, because a fresh init mints under
# the compose default (months out) and without this branch that token would
# sail outside the policy until three days before New Year. Either way the
# successor lives exactly ZITADEL_PAT_LIFETIME_DAYS.
if [ "$LEFT_SECONDS" -lt $(( PAT_ROTATE_BELOW_DAYS * 86400 )) ] ||
   [ "$LEFT_SECONDS" -gt $(( PAT_LIFETIME_DAYS * 86400 )) ]; then
  if [ "$LEFT_SECONDS" -lt 0 ]; then
    say "the nearest token expiry is ${NEAREST} — already past. The token in use still works, so that one is a dead leftover; rotating and sweeping"
  elif [ "$LEFT_SECONDS" -gt $(( PAT_LIFETIME_DAYS * 86400 )) ]; then
    say "it expires ${NEAREST} — $(( LEFT_SECONDS / 86400 )) days out, LONGER than the ${PAT_LIFETIME_DAYS}-day policy (a first-init default, or hand-minted). Rotating it under the policy"
  else
    say "it expires ${NEAREST} — $(( LEFT_SECONDS / 3600 ))h from now, inside the ${PAT_ROTATE_BELOW_DAYS}-day window. Rotating it"
  fi

  NEW_EXPIRY="$(future_iso "$PAT_LIFETIME_DAYS")" ||
    die "could not compute a date ${PAT_LIFETIME_DAYS} days from now — neither GNU nor BSD \`date\` worked"
  minted="$(api POST "/management/v1/users/${SETUP_UID}/pats" \
    "$(jq -nc --arg d "$NEW_EXPIRY" '{expirationDate:$d}')")"
  # The answer holds a live credential: it is never printed, and every check on
  # it speaks in lengths, not bytes.
  NEW_TOKEN="$(jq -r '.token // empty' <<<"$minted")"
  NEW_TOKEN_ID="$(jq -r '.tokenId // empty' <<<"$minted")"
  [ -n "$NEW_TOKEN" ] && [ -n "$NEW_TOKEN_ID" ] ||
    die "the provider answered 2xx to the mint but returned no token or no token id — rotating nothing"
  case "$NEW_TOKEN" in *[[:space:]]*)
    die "the minted token contains whitespace, and no token does — rotating nothing" ;;
  esac
  [ "${#NEW_TOKEN}" -ge 20 ] ||
    die "the minted token is ${#NEW_TOKEN} characters long, too short to be one — rotating nothing"

  # PROVE THE SUCCESSOR before the predecessor is touched: the same question
  # the old token just answered.
  new_code="$(curl -sS "${CURL_ORIGIN[@]}" -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${NEW_TOKEN}" "${ISSUER}/auth/v1/users/me" || echo 000)"
  case "$new_code" in
    2*) : ;;
    *) die "the freshly minted token was refused (HTTP ${new_code}) — keeping the old one, rotating nothing" ;;
  esac

  # LAND IT IN THE VOLUME atomically — pat.txt.next, then mv — and READ IT
  # BACK, because a write this script cannot verify is the machinekey story
  # all over again.
  printf '%s' "$NEW_TOKEN" |
    "${COMPOSE[@]}" run --rm --quiet-pull -T zitadel-machinekey \
      sh -c 'cat > /machinekey/pat.txt.next && mv /machinekey/pat.txt.next /machinekey/pat.txt' ||
    die "could not write the rotated token into the machinekey volume — the old token stays in force"
  back="$(read_provisioning_token | tr -d '\r\n')"
  [ "$back" = "$NEW_TOKEN" ] ||
    die "wrote the rotated token (${#NEW_TOKEN} characters) and read ${#back} back — the volume did not keep the write; the old token stays in force"

  # THE SUCCESSOR TAKES OVER: every later call in this run — the deletions
  # right here first — authenticates with it, which is also its second proof.
  PAT="$NEW_TOKEN"
  removed=0
  while IFS= read -r old_id; do
    [ -n "$old_id" ] || continue
    [ "$old_id" = "$NEW_TOKEN_ID" ] && continue
    api DELETE "/management/v1/users/${SETUP_UID}/pats/${old_id}" >/dev/null
    removed=$(( removed + 1 ))
  done <<<"$(jq -r '.result[]?.id // empty' <<<"$pats")"

  "$UPSERT" "$ENV_FILE" "ZITADEL_PAT_EXPIRY=${NEW_EXPIRY}" >/dev/null
  say "rotated — the new token expires ${NEW_EXPIRY}, ${removed} predecessor(s) deleted"
else
  say "good until ${NEAREST} ($(( LEFT_SECONDS / 86400 )) days) — within policy, no rotation needed"
  # The note tracks the LIVE token even when nothing rotates, so the file never
  # again carries a date no credential holds.
  "$UPSERT" "$ENV_FILE" "ZITADEL_PAT_EXPIRY=${NEAREST}" >/dev/null
fi

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
      loginVersion:{loginV1:{}},
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
  # WHICH LOGIN UI THIS APPLICATION SENDS PEOPLE TO, read the same way. Left
  # unset it follows the instance default, which on a fresh v4 instance is a
  # login v2 this stack does not run — a redirect to a 404 on every sign-in.
  # See "the login page people get" below for the whole story; the instance
  # setting there and this one are deliberately both written, because either
  # alone leaves the choice to something that can change underneath it.
  CURRENT_LOGIN="$(jq -r 'if .app.oidcConfig.loginVersion.loginV1 then "v1" else "unset-or-v2" end' <<<"$app")"
  if [ "$CURRENT_DEV" != "$DEV_MODE" ] ||
     [ "$CURRENT_URIS" != "$REDIRECT_URIS" ] ||
     [ "$CURRENT_LOGIN" != "v1" ] ||
     [ "$CURRENT_USERINFO" != "true" ]; then
    say "its dev mode, redirect URIs, login page or claims do not match this stack — putting that right"
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
        loginVersion:{loginV1:{}},
        devMode:$dm}')" >/dev/null
  fi
fi
say "client ${CLIENT_ID}"

# ------------------------------------------------- the origin, made durable --
#
# THE ORIGIN THIS STACK USES IS REGISTERED AS A TRUSTED DOMAIN, so that it keeps
# resolving on an instance that was initialised under a different one.
#
# Zitadel decides which instance a request is for from its ORIGIN — host AND
# port — and refuses any other with 404 "Instance not found". A FRESH instance
# registers ${IDP_DOMAIN} at first init and needs nothing here. An instance
# initialised under an older ZITADEL_EXTERNALDOMAIN does not know the new one,
# and there is no AddInstanceDomain a provisioning token can reach: the Admin
# API has no such endpoint (404) and the System API refuses a PAT (401). A
# TRUSTED domain is the one thing that token can add, and it is enough.
#
# THE PORT IS WHY THIS LOOKED IMPOSSIBLE FOR AN EVENING. A trusted domain was
# added by hand while the provider still LISTENED on 8080 and published 3126, so
# every in-network probe went to ${IDP_DOMAIN}:8080 — an origin that could not
# match ${IDP_DOMAIN}:3126 whatever was trusted. The conclusion drawn was that
# trusted domains do not affect origin resolution and the instance had to be
# re-initialised. Both halves were wrong, and the same run that made the ports
# agree proved it: E2E (managed) #61, `issuer: http://ownpace-idp:3126 (declares
# its own name)` from inside the API container, on the instance that had been
# initialised as `localhost` and never re-initialised.
#
# So the stack repairs itself instead of asking somebody to destroy a database
# (hard rule 2). It is idempotent: read first, write only when it is missing.
say "checking ${IDP_DOMAIN} is an origin this instance answers for"
trusted="$(api POST /admin/v1/trusted_domains/_search '{}')"
if jq -e --arg d "$IDP_DOMAIN" '[.result[]?.domain] | index($d)' >/dev/null <<<"$trusted"; then
  say "it already is"
else
  say "adding it"
  api POST /admin/v1/trusted_domains "$(jq -nc --arg d "$IDP_DOMAIN" '{domain:$d}')" >/dev/null
fi

# ------------------------------------------------ mail this instance sends --
#
# ZITADEL SENDS ITS OWN MAIL, AND UNTIL NOW IT HAD NOWHERE TO SEND IT.
#
# Two things on this stack send mail and only one was ever wired. `managed.yml`
# hands the API SMTP_HOST and friends (#551), so an access-request digest
# reaches Mailpit. Zitadel's mail is its own and never touches the API: the
# verification link on a new account, an email-change confirmation, a password
# reset, the invitation to set a first password. This instance had no email
# provider configured at all, so every one of those was composed and dropped.
#
# IT FAILS INVISIBLY, which is the whole cost. The account is created, the screen
# says to check your mail, and Mailpit stays empty. Nothing anywhere says the
# provider had no way to send — so it reads as a broken feature rather than an
# unconfigured one, and the first place anybody looks is the half that works.
#
# ONE SETTING FOR BOTH SENDERS. SMTP_HOST/SMTP_PORT are the ones the API already
# reads, used here rather than given a ZITADEL_ prefix of their own — the reason
# STATUS_URL is derived rather than configured beside APP_URL: two settings that
# name one relay drift, and the day they disagree half the stack's mail vanishes
# and the other half does not.
#
# EMPTY MEANS OFF, exactly as it does for the API. A deployment that has not
# chosen a relay is not misconfigured, and refusing a bring-up over a channel
# the operator may not want yet would be this script inventing a requirement.
SMTP_RELAY="$(read_env SMTP_HOST '')"
SMTP_RELAY_PORT="$(read_env SMTP_PORT 1025)"
SMTP_SENDER="$(read_env NOTIFY_FROM '')"
SMTP_TLS="$(read_env SMTP_SECURE false)"

if [ -z "$SMTP_RELAY" ]; then
  say "no SMTP_HOST in ${ENV_FILE} — this instance is left with no way to send mail"
  say "  sign-up and email-change verification will be composed and DROPPED until it is set"
  say "  for the OTA/dev stack that is: SMTP_HOST=mailpit, SMTP_PORT=1025"
elif [ -z "$SMTP_SENDER" ]; then
  # Zitadel requires a sender address, and guessing one is how a stack ends up
  # sending as `noreply@localhost`. Named rather than invented.
  say "SMTP_HOST is set but NOTIFY_FROM is not — leaving this instance's mail alone"
  say "  set NOTIFY_FROM to the address this stack should send as, then re-run --only app"
else
  SMTP_ADDR="${SMTP_RELAY}:${SMTP_RELAY_PORT}"
  say "checking this instance can send mail through ${SMTP_ADDR}"

  # THE POLICY THAT SILENTLY REFUSES THE CONFIG. Zitadel can require a sender
  # address whose domain matches the instance's own, which exists to stop one
  # org spoofing another on a SHARED instance. This instance is single-org and
  # operator-owned, and its domain is `ownpace-idp` — a compose alias no address
  # can be `@`. So the policy protects nothing here and blocks every sender
  # worth configuring. Read first, and relaxed only when it would actually bite.
  DOMAIN_POLICY="$(api GET /admin/v1/policies/domain)"
  if [ "$(jq -r '.policy.smtpSenderAddressMatchesInstanceDomain // false' <<<"$DOMAIN_POLICY")" = "true" ]; then
    say "relaxing the sender-must-match-instance-domain policy (single-org instance)"
    # A FULL update: the other two flags are re-sent as they were read, because
    # PUT replaces the policy and omitting them would reset them to false.
    api PUT /admin/v1/policies/domain "$(jq -c '{
      userLoginMustBeDomain: (.policy.userLoginMustBeDomain // false),
      validateOrgDomains: (.policy.validateOrgDomains // false),
      smtpSenderAddressMatchesInstanceDomain: false
    }' <<<"$DOMAIN_POLICY")" >/dev/null
  fi

  # Idempotent the same way trusted_domains is: read first, write only what is
  # missing. Matched on the RELAY ADDRESS rather than on "is there any provider",
  # so changing SMTP_HOST in .env and re-running actually moves the mail.
  PROVIDERS="$(api POST /admin/v1/email/_search '{}')"
  SMTP_ID="$(jq -r --arg h "$SMTP_ADDR" \
    'first(.result[]? | select(.smtp.host == $h) | .id) // empty' <<<"$PROVIDERS")"

  if [ -n "$SMTP_ID" ]; then
    say "already configured (${SMTP_ID})"
  else
    say "adding it"
    # `/email/smtp`, not `/smtp`: the latter is marked deprecated in this
    # version's admin.proto in favour of the email-provider endpoints.
    CREATED="$(api POST /admin/v1/email/smtp "$(jq -nc \
      --arg from "$SMTP_SENDER" --arg host "$SMTP_ADDR" --argjson tls "${SMTP_TLS:-false}" '{
        senderAddress: $from,
        senderName: "Ownpace",
        host: $host,
        tls: $tls,
        user: "",
        password: "",
        description: "ownpace-managed"
      }')")"
    SMTP_ID="$(jq -r '.id // empty' <<<"$CREATED")"
    [ -n "$SMTP_ID" ] || die "the provider accepted POST /admin/v1/email/smtp and the
answer carried no id. Body:

    ${CREATED}"
  fi

  # ACTIVATED, AND READ BACK. Adding a provider does not make it the one in use,
  # and an inactive provider drops mail exactly as silently as no provider at
  # all — the failure this whole section exists to end. The state is read from
  # the API rather than inferred from the call not erroring, for the reason
  # `read_allow_register` exists twenty lines below.
  STATE="$(jq -r --arg id "$SMTP_ID" \
    'first(.result[]? | select(.id == $id) | .state) // empty' <<<"$PROVIDERS")"
  if [ "$STATE" != "EMAIL_PROVIDER_ACTIVE" ]; then
    api POST "/admin/v1/email/${SMTP_ID}/_activate" '{}' >/dev/null || true
  fi
  FINAL="$(jq -r --arg id "$SMTP_ID" \
    'first(.result[]? | select(.id == $id) | .state) // empty' \
    <<<"$(api POST /admin/v1/email/_search '{}')")"
  [ "$FINAL" = "EMAIL_PROVIDER_ACTIVE" ] || die "the email provider ${SMTP_ID} is '${FINAL}',
not EMAIL_PROVIDER_ACTIVE. An inactive provider drops verification mail as
silently as no provider at all, which is the failure this configures away."
  say "mail from this instance goes to ${SMTP_ADDR} (sender ${SMTP_SENDER})"

  # PROVED HERE, BECAUSE THE GATE THAT PROVED IT CANNOT RUN HERE.
  #
  # smoke-managed.sh asserts this too, and on a REAL deployment it never runs:
  # `phase_smoke` returns early without --with-demo, because the smoke drives
  # the demo tenants. So the check that existed to prove the issuer can send
  # was live on the nightly and dead on every stack anybody actually uses —
  # the gatus shape again, a check that reads as coverage where it cannot
  # execute. Reported from the reference box on 2026-08-25.
  #
  # ONLY AGAINST THE CATCHER, and both conditions are required. A test send is
  # a REAL email: against a production relay this would mail somebody on every
  # `--only app`, which is not a thing a setup script may do uninvited. So it
  # runs when the relay is the catcher this stack ships AND that catcher
  # answers on the host — the second test being what stops a real relay that
  # happens to be called `mailpit` from being trusted as one.
  MAILPIT_API="http://localhost:$(read_env MAILPIT_PORT 3127)"
  if [ "$SMTP_RELAY" = "mailpit" ] && curl -fsS -o /dev/null -m 5 "${MAILPIT_API}/api/v1/messages" 2>/dev/null; then
    say "sending one test message, and reading the catcher for it"
    probe="setup-zitadel-$$@example.invalid"
    # `/smtp/{id}/_test`, WHICH THE PROTO MARKS DEPRECATED, AND THAT IS CORRECT.
    #
    # v4.17.1 declares `TestEmailProviderSMTPById` at `/email/smtp/{id}/_test`
    # and says to prefer it. The server has no implementation for it: the
    # reference box answered HTTP 501, `{"code":12, "message":"method
    # TestEmailProviderSMTPById not implemented"}` — gRPC UNIMPLEMENTED.
    # `internal/api/grpc/admin/smtp.go` at that tag implements exactly two test
    # verbs, `TestSMTPConfigById` and `TestSMTPConfig`, both on the deprecated
    # paths.
    #
    # DEPRECATED IS NOT ABSENT, AND DECLARED IS NOT IMPLEMENTED. The proto is an
    # interface; only the Go says what exists. Choosing the modern endpoint on
    # the proto's advice is what produced the 501 — after a 404 from getting the
    # path wrong the other way, on the same three lines.
    #
    # The CONFIG verbs above stay on `/email/smtp`, which IS implemented. It is
    # only the test verb that has no modern implementation yet.
    #
    # AND IT IS NOT FATAL, which matters more than the path. `api` dies on any
    # non-2xx, so that 404 exited the script MID-PHASE — before `up -d --build`
    # had built api and web, which is what `phase_app` exists to do. A check on
    # the mail channel took down the whole bring-up: the shape of a healthcheck
    # that kills the service it is watching. Delivery is REPORTED here and
    # asserted in smoke-managed.sh, which is the place where failing is the job.
    if ! probe_out="$( ( api POST "/admin/v1/smtp/${SMTP_ID}/_test" \
          "$(jq -nc --arg r "$probe" '{receiverAddress:$r}')" ) 2>&1 )"; then
      say "  the provider REFUSED the test send, so delivery is unproven:"
      say "  ${probe_out}"
    else
      # Zitadel answers the test before delivery completes, so the proof is the
      # message arriving rather than the call returning 200.
      landed=0
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        landed="$(curl -fsS --get "${MAILPIT_API}/api/v1/search" \
          --data-urlencode "query=${probe}" 2>/dev/null | jq -r '.messages_count // 0' || echo 0)"
        [ "${landed:-0}" -gt 0 ] && break
        sleep 1
      done
      if [ "${landed:-0}" -gt 0 ]; then
        say "  it arrived — this instance can send"
      else
        say "  the provider ACCEPTED the test send and nothing reached the catcher at"
        say "  ${MAILPIT_API}. The provider is configured and ACTIVE, so what is wrong is"
        say "  the relay address it holds (${SMTP_ADDR}) or the route to it from the"
        say "  identity provider's container. Every verification mail would be dropped."
      fi
    fi
  else
    # Said rather than skipped silently: "configured" and "proved to work" are
    # different claims, and this is only the first.
    say "  configured, not proved — a test send would mail a real address"
  fi
fi

# ---------------------------------------------- the login page people get --
#
# THIS INSTANCE IS POINTED AT THE LOGIN UI THIS STACK ACTUALLY RUNS.
#
# Zitadel v4 ships two login UIs. V1 is built into the server and served at
# ${ISSUER}/ui/login. V2 is a SEPARATE application — `ghcr.io/zitadel/zitadel-login`,
# a Next.js app that has to be deployed and routed at /ui/v2/login — which
# `managed.yml` does not run and this project has not adopted. A fresh v4
# instance nonetheless comes up with `loginV2.required = true` at instance
# scope, so the server sends every human sign-in to a path where nothing is
# listening.
#
# WHAT A PERSON SEES IS NOT A LOGIN PAGE. "Sign in" reaches
# ${ISSUER}/ui/v2/login/login?authRequest=V2_… and the browser renders the
# gRPC-gateway's not-found body — a JSON viewer showing `code: 5`,
# `message: "Not Found"`. Nothing on that screen names the login UI, the
# feature, or this stack, so the first guess is a routing fault at the reverse
# proxy. It cost an evening on the Spark (2026-08-25) before the feature flag
# was found.
#
# AND NO GATE WOULD HAVE CAUGHT IT. smoke-managed.sh signs in the way a machine
# does — /oauth/v2/authorize, then /v2/sessions and CreateCallback with a
# provisioning token — and never loads the login UI at all. The only thing this
# breaks is the path every human takes and no test took. The smoke now fetches
# the page a browser is sent to, for that reason.
#
# BOTH LEVELS ARE WRITTEN, and that is not belt-and-braces. The application's
# own `loginVersion` is set above, so the humans' client does not depend on this
# instance setting staying where it was put; this instance setting is written
# here, so a client that expresses no preference — the console, anything added
# later by hand — lands on the UI this stack serves rather than on a 404.
#
# THE GATE SIGNS IN THROUGH A CLIENT OF ITS OWN, pinned the other way. It
# finalises authorization requests with /v2/sessions and CreateCallback, which
# works on V2_-prefixed requests only, so it cannot use a client pinned to v1.
# `smoke-managed.sh` creates that client, uses it, and deletes it — the reason
# is written out where it happens.
#
# TO SERVE V2 INSTEAD: deploy the login container, route it under ${ISSUER},
# and set {"loginV2":{"required":true,"baseUri":"…"}} here. Until something
# answers on that path, requiring it is a promise this deployment cannot keep.
say "checking which login page this instance sends people to"
login_v2_required() { jq -r '.loginV2.required // false' <<<"$(api GET /v2/features/instance)"; }

if [ "$(login_v2_required)" = "true" ]; then
  say "it sends them to login v2, which this stack does not run — pointing it back at the built-in one"
  api PUT /v2/features/instance '{"loginV2":{"required":false}}' >/dev/null
  # READ BACK, because the answer to this PUT is a `details` block saying a
  # sequence advanced — it names no feature and does not say which way one
  # moved. Believing a write that did not take costs a stack where every
  # sign-in ends on a 404, so the SETTING decides and not the response.
  [ "$(login_v2_required)" = "false" ] || die "could not point this instance at the built-in login page.

It still requires login v2, and this stack runs no login v2 — so every sign-in
will end on a JSON 'Not Found' page instead of a login form.

Set it by hand with the provisioning token:
  curl -X PUT ${ISSUER}/v2/features/instance -H 'Content-Type: application/json' \\
    -H \"Authorization: Bearer \$PAT\" -d '{\"loginV2\":{\"required\":false}}'"
  say "it now sends them to the built-in login page"
else
  say "the built-in login page — which is the one this stack serves"
fi

# ------------------------------------------- signing in with a provider --
#
# FEDERATION IS CONFIGURATION, NOT CODE (ADR-0042, workplan 0102 T2).
#
# A "Login with Google" button in `apps/web/src` is the ONE implementation CI
# rejects: `no-issuer-lock-in.unit.test.ts` scans the app and the packages for
# provider names, because the moment one appears there the issuer stops being
# replaceable. The permitted shape is the one the ADR already bought — the
# upstream goes into Zitadel, Zitadel still mints the token, `iss` is still
# ours, `sub` is still a Zitadel subject, and `tenant_member` never learns
# anybody used Google. Which makes adding one a matter of credentials in .env
# and this block, and nothing else in the product.
#
# THE LINKING DECISION CAME FIRST, and that ordering is the point (0102 T2,
# owner decision 2026-08-25). ADR-0042's amended invariant is that
# `tenant_member.user_id` IS the token's `sub`: a flow that preserves `sub` is
# safe, and one that mints a NEW `sub` orphans a membership. Somebody who signed
# up by email in March and presses "Login with Google" in April is a different
# subject unless something links the two — they would find themselves locked out
# of an organisation they are still a member of, with no way to see why.
#
# So every provider here carries `autoLinking: EMAIL`: Zitadel asks "is this
# you?" when the upstream's VERIFIED email matches an existing account, and the
# person confirms. Not a silent merge — a prompt. And Zitadel shows no prompt
# at all when several users match, which is the ambiguous case failing closed
# rather than guessing.
#
# `isAutoUpdate` IS OFF, and that is not laziness. Workplan 0102 T3 makes
# `tenant_member.email` follow the verified claim on every sign-in. Turning auto
# update on would chain the two: the upstream asserts a different address,
# Zitadel rewrites the account, `/api/me` rewrites the membership label, and an
# organisation's members table follows Google. The membership itself is safe —
# it is keyed on `sub` — but the address colleagues see would not be ours to
# explain. Somebody can change their address deliberately; an upstream should
# not change it for them.
say "checking which sign-in providers this instance offers"

IDP_OPTIONS="$(jq -nc '{
  isLinkingAllowed: true,
  isCreationAllowed: true,
  isAutoCreation: true,
  isAutoUpdate: false,
  autoLinking: "AUTO_LINKING_OPTION_EMAIL"
}')"

IDP_COUNT=0

# configure_idp <display name> <api path> <payload>
#
# Idempotent in the sense hard rule 1 means: it converges on the described
# state and says nothing when a stack is already correct. Read first, write only
# what is missing.
configure_idp() {
  local name="$1" path="$2" payload="$3" existing on_screen linked candidates id count aside off
  # THE LIST THE PROVIDER IS ACTUALLY ON. Google, Microsoft, GitHub and Apple
  # are TEMPLATE providers, created at /admin/v1/idps/{google,azure,...} and
  # listed by /admin/v1/idps/templates/_search. The deprecated
  # /admin/v1/idps/_search lists only the generic OIDC/JWT kind, and answered an
  # empty list for every provider this function had just created — so every
  # re-run of the app phase "added" one more, and the sign-in screen gained a
  # button per bring-up (nine Google buttons on the owner's box, 2026-09-02).
  # Oldest first: that is the one the earliest sign-ins were linked to, and the
  # one that stays on the screen if somebody removes the rest.
  #
  # ON THE SCREEN MEANS ON THE LOGIN POLICY, AND ACTIVE (the same day, two
  # hours later). Two switches take a provider off the sign-in screen without
  # deleting it, and the owner used one of them on seven of the eight: the
  # console's "available" toggle, which removes the provider's login-policy
  # link, and deactivation, which sets IDP_STATE_INACTIVE. A count of the
  # template list still said "8 buttons" after either. So "exists", "duplicates"
  # and the one this manages are read among providers of this name that are
  # active (no state on the wire counts as active, the safe direction), and a
  # button is one of those that is ALSO on the login policy.
  #
  # AND THE ONE ALREADY ON THE SCREEN COMES FIRST. The link step below puts the
  # managed provider on the login policy if it is not there — right for a fresh
  # provider, and exactly wrong if "the managed one" were the oldest while the
  # owner had just taken the oldest off the screen: every bring-up would put
  # the button back. Linked first, then oldest, and a person's choice holds.
  existing="$(api POST /admin/v1/idps/templates/_search '{}')"
  on_screen="$(api POST /admin/v1/policies/login/idps/_search '{}')"
  linked="$(jq -c '[.result[]?.idpId]' <<<"$on_screen")"
  candidates="$(jq -c --arg n "$name" --argjson linked "$linked" \
    '[.result[]? | select(.name == $n and .state != "IDP_STATE_INACTIVE")
      | .id as $i | {id: $i, linked: (($linked | index($i)) != null), created: (.details.creationDate // "")}]
     | sort_by((if .linked then 0 else 1 end), .created)' \
    <<<"$existing")"
  count="$(jq -r '[.[] | select(.linked)] | length' <<<"$candidates")"
  aside="$(jq -r '[.[] | select(.linked | not)] | length' <<<"$candidates")"
  off="$(jq -r --arg n "$name" \
    '[.result[]? | select(.name == $n and .state == "IDP_STATE_INACTIVE")] | length' \
    <<<"$existing")"
  id="$(jq -r '.[0].id // empty' <<<"$candidates")"

  if [ -z "$id" ] && [ "${off:-0}" -gt 0 ]; then
    # EVERY ONE OF THIS NAME IS SWITCHED OFF. A person did that, in the console,
    # and this script does not undo a person's switch (hard rule 2) — nor add
    # a second provider beside it, which is the defect above. It says so and
    # names both ways out; the login policy below then follows what is actually
    # offered, which is nothing.
    say "  ${name}: ${off} provider(s) of this name exist and every one is deactivated — the sign-in screen shows no ${name} button"
    say "      activate one in the console under Settings -> Identity Providers, or unset"
    say "      the IDP_*_CLIENT_ID for ${name} in ${ENV_FILE} if that is intended (this script"
    say "      adds no second provider beside a switched-off one)"
    return 0
  fi

  if [ -z "$id" ] || [ "$id" = "null" ]; then
    local created
    created="$(api POST "$path" "$payload")"
    id="$(jq -r '.id // empty' <<<"$created")"
    [ -n "$id" ] || die "could not add the ${name} sign-in provider:
    ${created}

Check the client id and secret in ${ENV_FILE}, and the redirect URI registered
with ${name}. Apple posts its answer, everyone else redirects, so they are not
the same URI:

    Google, Microsoft, GitHub   ${ISSUER}/ui/login/login/externalidp/callback
    Apple                       ${ISSUER}/ui/login/login/externalidp/callback/form"
    say "  ${name}: added"
  else
    # "ALREADY CONFIGURED" WOULD BE A CLAIM THIS HAS NOT CHECKED. All that was
    # established is a provider of this NAME — nothing here compared the client
    # id, the secret, or any option against what `.env` now says.
    #
    # THE SMTP BLOCK ABOVE IS THE PATTERN THIS ONE MISSED. It matches on
    # `.smtp.host` — the relay address out of `.env` — so changing SMTP_HOST and
    # re-running genuinely moves the mail, and its comment says so. This matches
    # on "Google", which is a constant, so no change to any credential can ever
    # make it look different.
    #
    # IT IS NOT SIMPLY FIXABLE THE SAME WAY, which is why this says something
    # instead of doing something. Matching on the client id would converge when
    # THAT changes and would then create a SECOND provider rather than update
    # the first, leaving two buttons and one of them broken. A secret cannot be
    # read back to compare at all. Converging properly needs
    # `PUT /admin/v1/idps/{google,azure,github,apple}/{id}`, whose behaviour on
    # an omitted secret this has not established — and guessing at that on a
    # live provider is how you take sign-in down.
    #
    # So it says what it knows. The case that makes the difference matter: fix
    # a mistyped secret in `.env`, re-run, and this leaves the old one in place
    # — every button still fails, and the log said "configured". Naming it here
    # is what turns that into a five-second answer rather than a search.
    if [ "$count" -gt 1 ]; then
      # DUPLICATES ARE REPORTED, NEVER REMOVED (hard rule 2): a provider may
      # hold the links of people who signed in through it. The oldest on the
      # screen stays; the person decides about the rest, in the console, with
      # the list in front of them — the "available" toggle takes one off the
      # screen and keeps it, which is the gentlest of the three switches.
      local others
      others="$(jq -r '[.[] | select(.linked)] | .[1:] | .[].id' <<<"$candidates" | tr '\n' ' ')"
      say "  ${name}: ${count} providers of this name exist on the sign-in screen — it shows ${count} ${name} buttons"
      say "      keeping the oldest of them (${id}); take the others off the screen in the console"
      say "      under Default settings -> Login Behaviour and Security -> Identity Providers"
      say "      (the INSTANCE page — an organisation's own login policy is reset by this script),"
      say "      or from this shell, which removes their LINKS and keeps every provider:"
      say "        PAT=\"\$(docker run --rm -v ${COMPOSE_PROJECT:-ownpace-managed}_zitadel_machinekey:/m:ro busybox:1.37 cat /m/pat.txt)\""
      say "        for id in ${others}; do"
      say "          curl -sS -X DELETE ${ISSUER}/admin/v1/policies/login/idps/\$id -H \"Authorization: Bearer \$PAT\""
      say "        done"
      say "      (a POST to the same path puts one back; this script never deletes a provider)"
    fi
    [ "${aside:-0}" -eq 0 ] \
      || say "  ${name}: ${aside} more of this name exist, taken off the sign-in screen — left as they are"
    [ "${off:-0}" -eq 0 ] \
      || say "  ${name}: ${off} more of this name are deactivated — on the list, off the sign-in screen"
    say "  ${name}: a provider of this name exists — left as it is"
    say "      credentials in ${ENV_FILE} are NOT re-sent; to change them,"
    say "      remove it in the console under Settings -> Identity Providers"
    say "      and run this again"
  fi

  # A PROVIDER THAT IS NOT ON THE LOGIN POLICY IS A PROVIDER NOBODY CAN SEE.
  # Creating the IdP configures it; adding it to the login policy is what puts
  # the button on the sign-in screen. Two steps, and skipping the second leaves
  # a stack that looks configured from the API and offers nothing to a person.
  if jq -e --arg i "$id" '[.result[]?.idpId] | index($i)' >/dev/null <<<"$on_screen"; then
    :
  else
    api POST /admin/v1/policies/login/idps "$(jq -nc --arg i "$id" '{idpId:$i}')" >/dev/null
    say "  ${name}: now offered on the sign-in screen"
  fi
  IDP_COUNT=$(( IDP_COUNT + 1 ))
}

IDP_GOOGLE_CLIENT_ID="$(read_env IDP_GOOGLE_CLIENT_ID)"
IDP_GOOGLE_CLIENT_SECRET="$(read_env IDP_GOOGLE_CLIENT_SECRET)"
if [ -n "$IDP_GOOGLE_CLIENT_ID" ] && [ -n "$IDP_GOOGLE_CLIENT_SECRET" ]; then
  configure_idp "Google" /admin/v1/idps/google "$(jq -nc \
    --arg c "$IDP_GOOGLE_CLIENT_ID" --arg s "$IDP_GOOGLE_CLIENT_SECRET" --argjson o "$IDP_OPTIONS" \
    '{name:"Google", clientId:$c, clientSecret:$s, scopes:["openid","profile","email"], providerOptions:$o}')"
fi

IDP_MICROSOFT_CLIENT_ID="$(read_env IDP_MICROSOFT_CLIENT_ID)"
IDP_MICROSOFT_CLIENT_SECRET="$(read_env IDP_MICROSOFT_CLIENT_SECRET)"
if [ -n "$IDP_MICROSOFT_CLIENT_ID" ] && [ -n "$IDP_MICROSOFT_CLIENT_SECRET" ]; then
  # WHICH MICROSOFT ACCOUNTS. `common` is every kind; a tenant id restricts it to
  # one organisation, which is what a deployment serving one customer wants.
  IDP_MICROSOFT_TENANT="$(read_env IDP_MICROSOFT_TENANT)"
  case "$IDP_MICROSOFT_TENANT" in
    ''|common)     tenant='{"tenantType":"AZURE_AD_TENANT_TYPE_COMMON"}' ;;
    organisations|organizations) tenant='{"tenantType":"AZURE_AD_TENANT_TYPE_ORGANISATIONS"}' ;;
    consumers)     tenant='{"tenantType":"AZURE_AD_TENANT_TYPE_CONSUMERS"}' ;;
    *)             tenant="$(jq -nc --arg t "$IDP_MICROSOFT_TENANT" '{tenantId:$t}')" ;;
  esac
  # `emailVerified: false`, DELIBERATELY, AND IT COSTS A CLICK.
  #
  # Zitadel's own note on this field: "Azure AD doesn't send if the email has
  # been verified. Enable this if the user email should always be added verified
  # in Zitadel (no verification emails will be sent)."
  #
  # Enabling it would mean this stack treats every address Entra asserts as
  # verified WITHOUT anybody verifying it — and `email_verified` is what binds
  # an invitation (migration 0006) and what moves a membership label (0102 T3).
  # An address asserted but never proved would be enough to answer an invitation
  # addressed to somebody else. So it stays off: Zitadel sends its own
  # verification mail, the person clicks it once, and every claim downstream
  # means what it says.
  configure_idp "Microsoft" /admin/v1/idps/azure "$(jq -nc \
    --arg c "$IDP_MICROSOFT_CLIENT_ID" --arg s "$IDP_MICROSOFT_CLIENT_SECRET" \
    --argjson t "$tenant" --argjson o "$IDP_OPTIONS" \
    '{name:"Microsoft", clientId:$c, clientSecret:$s, tenant:$t, emailVerified:false,
      scopes:["openid","profile","email","User.Read"], providerOptions:$o}')"
fi

IDP_GITHUB_CLIENT_ID="$(read_env IDP_GITHUB_CLIENT_ID)"
IDP_GITHUB_CLIENT_SECRET="$(read_env IDP_GITHUB_CLIENT_SECRET)"
if [ -n "$IDP_GITHUB_CLIENT_ID" ] && [ -n "$IDP_GITHUB_CLIENT_SECRET" ]; then
  # `user:email` rather than the whole profile: an address is the only thing
  # this product needs from GitHub, and asking for more would be asking for what
  # we cannot say we use.
  configure_idp "GitHub" /admin/v1/idps/github "$(jq -nc \
    --arg c "$IDP_GITHUB_CLIENT_ID" --arg s "$IDP_GITHUB_CLIENT_SECRET" --argjson o "$IDP_OPTIONS" \
    '{name:"GitHub", clientId:$c, clientSecret:$s, scopes:["user:email"], providerOptions:$o}')"
fi

IDP_APPLE_CLIENT_ID="$(read_env IDP_APPLE_CLIENT_ID)"
IDP_APPLE_TEAM_ID="$(read_env IDP_APPLE_TEAM_ID)"
IDP_APPLE_KEY_ID="$(read_env IDP_APPLE_KEY_ID)"
IDP_APPLE_PRIVATE_KEY="$(read_env IDP_APPLE_PRIVATE_KEY)"
if [ -n "$IDP_APPLE_CLIENT_ID" ] && [ -n "$IDP_APPLE_PRIVATE_KEY" ]; then
  # FOUR VALUES, NOT TWO, and a key file rather than a secret. Apple signs with
  # an ES256 key (.p8) identified by a team and a key id; `privateKey` is a
  # protobuf `bytes` field, so .env carries it BASE64-ENCODED — see
  # managed.env.example for the one-liner that produces it.
  [ -n "$IDP_APPLE_TEAM_ID" ] && [ -n "$IDP_APPLE_KEY_ID" ] || die \
    "IDP_APPLE_CLIENT_ID is set but IDP_APPLE_TEAM_ID or IDP_APPLE_KEY_ID is not.
Apple needs all four: the Services ID, the team id, the key id and the .p8 key.
See ${ENV_FILE} for what each one is and where Apple shows it."
  configure_idp "Apple" /admin/v1/idps/apple "$(jq -nc \
    --arg c "$IDP_APPLE_CLIENT_ID" --arg t "$IDP_APPLE_TEAM_ID" \
    --arg k "$IDP_APPLE_KEY_ID" --arg p "$IDP_APPLE_PRIVATE_KEY" --argjson o "$IDP_OPTIONS" \
    '{name:"Apple", clientId:$c, teamId:$t, keyId:$k, privateKey:$p,
      scopes:["name","email"], providerOptions:$o}')"
fi

if [ "$IDP_COUNT" -eq 0 ]; then
  say "  none configured — sign-in is this instance's own accounts only"
fi

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

# THE ORGANISATION MUST NOT CARRY A LOGIN POLICY OF ITS OWN.
#
# This wrote the ORG's login policy, with both verbs, because exactly one of
# them is right for an org that may or may not already have one:
#
#     PUT  /management/v1/policies/login   {allowRegister, allowUsernamePassword, allowExternalIdp}
#     POST /management/v1/policies/login   (the same three)
#
# The POST is `AddCustomLoginPolicy`. It MINTS a custom org policy out of the
# body it is handed, and a login policy has sixteen more fields than these
# three. Every one of them arrived at its proto3 default, which for the five
# `Duration` fields is ZERO. Read off the OTA instance, custom org policy
# beside the instance default it shadowed:
#
#     password_check_lifetime          0    vs   864000000000000 ns (10 days)
#     external_login_check_lifetime    0    vs    43200000000000
#     second_factor_check_lifetime     0    vs    64800000000000
#     multi_factor_check_lifetime      0    vs    43200000000000
#     mfa_init_skip_lifetime           0    vs  2592000000000000
#
# A password check valid for zero seconds is a password check that is never
# valid. Zitadel checks the password, records the moment it did, and then asks
# whether that moment plus the lifetime is still in the future — which for a
# lifetime of zero it never is, not even in the same millisecond. So the step
# it computes next is the password step again:
#
#     POST /ui/login/password  ->  200, the same login page, no error at all
#
# Nobody could sign in to that instance. Every user, both browsers, correct
# passwords — while a WRONG password still said so, because that path returns
# before the lifetime is ever consulted. Six days of looking at a stack that
# was healthy from every angle it could be asked from: the API answered, the
# projections were current, and the policy read back `allowRegister: true`
# exactly as this script had asked for it.
#
# THE PUT IS NO SAFER THAN THE POST. `UpdateCustomLoginPolicy` replaces the
# policy from the body too, so the second run re-zeroed what the first minted,
# and there was no run that could have healed it. This is the same lesson the
# domain policy 400 lines above already carries in a comment — "PUT replaces
# the policy and omitting them would reset them to false" — written next to one
# caller and not applied to the other, which is the shape of #519 and #521.
#
# AND THE SHADOW POLICY BROKE THE PROVIDER BUTTONS TOO, silently, in the other
# direction. `configure_idp` adds an IdP to the INSTANCE policy
# (`/admin/v1/policies/login/idps`), which is where it belongs. A custom ORG
# policy shadows the instance one wholesale, its IdP list included — so with
# one in place, `allowExternalIdp: true` was being set on a policy carrying no
# providers, and the button this script logs as "now offered on the sign-in
# screen" could never appear on it.
#
# So the org gets no policy of its own, and these three settings go where the
# IdPs already go. This instance serves ONE organisation — the domain-policy
# block above says so, and nothing creates a second: granting an access request
# creates an Ownpace tenant, never an org at the provider (ADR-0042's third
# operative rule forbids us the user-management API that would) — so the
# instance policy is the only one anybody resolves.

# It follows what is actually configured, rather than being a knob of its own.
# On for a deployment with providers, off for one without — and a deployment
# that removes its last provider gets it turned back off on the next run, which
# is what "converges on the described state" means (hard rule 1).
WANT_EXTERNAL=false
[ "${IDP_COUNT:-0}" -gt 0 ] && WANT_EXTERNAL=true

# A BOOLEAN `false` IS AN ANSWER, AND `//` SWALLOWS IT.
#
# jq's `//` fires on `false` exactly as it fires on `null`, so
# `.policy.allowExternalIdp // empty` can NEVER report a genuine `false` — it
# reports "absent" instead, and the two become indistinguishable. For a flag
# whose whole job is to be true or false that is not a nuance, it is a reader
# that cannot read half its domain.
#
# It cost E2E (managed) #85, which failed the entire bring-up with
#
#     FATAL: could not set whether a sign-in provider may be offered.
#     0 provider(s) are configured, so 'External IDP allowed' should be
#     false — and it is not.
#
# on an instance where it HAD just been set to false, correctly. The refusal
# was true about what it read and wrong about the world, and it took the
# bring-up down with it — so nothing else could run either.
#
# AND ABSENT MEANS FALSE HERE, WHICH IS THE HALF THE FIRST FIX GOT WRONG.
#
# The first attempt at this mapped a missing value to "" and still refused a
# correctly-configured instance, because of what Zitadel actually puts on the
# wire. Asked on the live box, with `allowExternalIdp` genuinely off:
#
#     { "allowRegister": true, "allowUsernamePassword": true,
#       "allowExternalIdp": null }
#
# The two true flags are there and the false one is NOT. That is proto3 JSON:
# a field holding its default — `false` for a bool — is omitted from the
# response unless the server asks for defaults to be emitted. So `null` is not
# "unknown" here, it is how `false` arrives, every time, and a reader that
# treats it as unknown can no more report a false than `// empty` could.
#
# THE SAME OMISSION IS WHY A ZERO LIFETIME IS INVISIBLE. A `Duration` holding
# its default is omitted too, so the policy that locked everyone out answered
# with no `passwordCheckLifetime` field at all rather than with a nought. Every
# reader below therefore treats absent and zero as the one answer they are.
#
# So within a policy that exists, absent is false — and `// false` is exactly
# right for that, collapsing null and false onto the one answer they share.
# The empty string is kept for the case it genuinely means: no policy at all.
policy_flag() {   # <key> — reads the policy JSON on stdin
  jq -r --arg k "$1" '
    if (has("policy") | not) then ""
    else ((.policy[$k] // false) | tostring) end' 2>/dev/null || true
}

# ASK WHAT A PERSON SIGNING IN RESOLVES, NEVER WHAT WAS WRITTEN.
#
# `/management/v1/policies/login` answers with the org's own policy if it has
# one and the instance default if it has not — which is the question that
# matters, and the one this block stopped asking. The instance policy being
# right proves nothing at all while something shadows it: that is not a
# hypothetical, it is what happened.
#
# Two readers, deliberately. The PROBE runs before anything has been written
# and must survive an organisation that has no login policy of its own; the
# DECIDERS run after the writes, where a call that cannot be made is the answer.
probe_policy() { ( api GET /management/v1/policies/login ) 2>/dev/null || true; }
read_allow_register() { policy_flag allowRegister <<<"$(api GET /management/v1/policies/login)"; }
# AND WHETHER A PROVIDER BUTTON IS ALLOWED TO APPEAR AT ALL. Configuring an IdP
# and adding it to the login policy still shows nobody anything while this is
# false — a third way to have a stack that looks configured and offers nothing.
read_allow_external() { policy_flag allowExternalIdp <<<"$(api GET /management/v1/policies/login)"; }
# `isDefault` is how the answer says WHICH policy it is: true when the org
# inherits the instance's, false when it carries one of its own.
read_inherits() { policy_flag isDefault <<<"$(api GET /management/v1/policies/login)"; }
# NOT `policy_flag`, for this one: its `// false` is right for a bool and
# nonsense for a duration — "answers false for passwordCheckLifetime" is not
# a sentence a refusal should print. Absent still collapses onto the same
# answer as zero; it just says so in a word somebody can read.
read_password_life() { jq -r '.policy.passwordCheckLifetime // "unset"' <<<"$(api GET /management/v1/policies/login)" 2>/dev/null || true; }

# A DURATION IS RIGHT ONLY IF IT IS POSITIVE. protojson writes one as a string
# of seconds — "864000s" — and omits it when it is zero, so `// "0s"` is what
# collapses the two ways of being nought, and `tonumber?` refuses to guess at
# a shape it does not recognise (which then reads as zero, and writes).
positive_password_life() {   # reads a login-policy JSON on stdin
  jq -e '((.policy.passwordCheckLifetime // "0s") | sub("s$";"") | (tonumber? // 0)) > 0' \
    >/dev/null 2>&1
}

# WHAT "ALREADY RIGHT" MEANS, IN FULL. Four facts, not two: the pair this block
# is named for, plus the pair the shadow policy got wrong without saying so —
# that nothing shadows the instance policy, and that a password check lasts
# longer than no time at all. A probe that checked only the first two would
# look at the locked-out instance, find `allowRegister: true`, print "already
# allowed" and leave every person on the sign-in page. Converging on the
# described state (hard rule 1) means the description has to include the part
# that broke.
policy_is_right() {   # reads a login-policy JSON on stdin
  local json; json="$(cat)"
  jq -e --argjson x "$WANT_EXTERNAL" '
    .policy as $p
    | ($p != null)
      and ($p.isDefault // false)
      and ($p.allowRegister // false)
      and ($p.allowUsernamePassword // false)
      and (($p.allowExternalIdp // false) == $x)
  ' >/dev/null 2>&1 <<<"$json" && positive_password_life <<<"$json"
}

PROBED="$(probe_policy)"
if policy_is_right <<<"$PROBED"; then
  say "already allowed"
else
  # SAY WHAT THE PROBE SAW, before anything is reset or written. Two writes
  # follow, and a reader of the log deserves the reason for them — E2E
  # (managed) #130 died a few lines further down with nothing here to say why.
  say "the policy people resolve is not the described one yet:"
  say "  $(jq -r --argjson x "$WANT_EXTERNAL" '
      .policy as $p
      | if $p == null then "no login policy could be read"
        else "isDefault=\($p.isDefault // false) allowRegister=\($p.allowRegister // false) allowUsernamePassword=\($p.allowUsernamePassword // false) allowExternalIdp=\($p.allowExternalIdp // false) (want \($x)) passwordCheckLifetime=\($p.passwordCheckLifetime // "unset")"
        end' <<<"$PROBED" 2>/dev/null || echo "(unreadable: ${PROBED:-nothing at all})")"
  # RESET FIRST. On an instance an older version of this script has run
  # against, the custom org policy is the thing that has to go — the settings
  # below land on the instance policy, which nobody resolves while a shadow
  # sits in front of it.
  #
  # `api_try`, because an org with no policy of its own has nothing to reset
  # and the provider says so with a 4xx. A reset that did not take is not this
  # call's to report either: the read-back below asks the only question that
  # decides, which is what the org resolves NOW.
  api_try DELETE /management/v1/policies/login

  # ECHO WHAT IS THERE, OVERRIDE ONLY THE THREE. `UpdateLoginPolicy` replaces
  # the policy from the body, so every field omitted here is a field reset to
  # its zero — which is the whole bug this block exists to have fixed. The
  # lifetimes especially are Zitadel's own defaults and are NOT restated in
  # this repository: they are read off the instance and handed straight back,
  # so there is no second copy of them here to drift from the first.
  INSTANCE="$(api GET /admin/v1/policies/login)"
  POLICY="$(jq -c --argjson x "$WANT_EXTERNAL" '.policy | {
      allowRegister: true,
      allowUsernamePassword: true,
      allowExternalIdp: $x,
      forceMfa: (.forceMfa // false),
      forceMfaLocalOnly: (.forceMfaLocalOnly // false),
      passwordlessType: (.passwordlessType // "PASSWORDLESS_TYPE_NOT_ALLOWED"),
      hidePasswordReset: (.hidePasswordReset // false),
      ignoreUnknownUsernames: (.ignoreUnknownUsernames // false),
      allowDomainDiscovery: (.allowDomainDiscovery // false),
      disableLoginWithEmail: (.disableLoginWithEmail // false),
      disableLoginWithPhone: (.disableLoginWithPhone // false),
      defaultRedirectUri: (.defaultRedirectUri // ""),
      passwordCheckLifetime: .passwordCheckLifetime,
      externalLoginCheckLifetime: .externalLoginCheckLifetime,
      mfaInitSkipLifetime: .mfaInitSkipLifetime,
      secondFactorCheckLifetime: .secondFactorCheckLifetime,
      multiFactorCheckLifetime: .multiFactorCheckLifetime
    }' <<<"$INSTANCE")"

  # AND REFUSE TO SEND A ZERO. Echoing the instance back is only safe while the
  # instance is sane; if one of its lifetimes is already nought or missing,
  # writing it back is how this bug reproduces itself one level up, on the
  # policy EVERY organisation inherits. There is no right number to substitute
  # — Zitadel's defaults are Zitadel's — so this says what it found and stops
  # rather than inventing one.
  ZEROED="$(jq -r '[to_entries[] | select(.key | endswith("Lifetime"))
                    | select(((.value // "0s") | sub("s$";"") | (tonumber? // 0)) <= 0)
                    | .key] | join(", ")' <<<"$POLICY")"
  [ -z "$ZEROED" ] || die "the instance login policy has no time on it: ${ZEROED}

A check that is valid for zero seconds is a check that is never valid, and
sign-in becomes a page that reloads itself with no error on it. Nothing was
written — sending these back would put the same nought on the policy every
organisation inherits.

Read what is there with:

    curl -sS -X GET ${ISSUER}/admin/v1/policies/login \\
      -H \"Authorization: Bearer \$PAT\" | jq .policy

Zitadel's own defaults are 864000s for the password check; set them in the
console at ${ISSUER}/ui/console under Settings -> Login Behaviour, or re-run
this against an instance whose defaults have not been overwritten."

  # WRITE ONLY WHAT WOULD CHANGE. Everything in the body but the three flags
  # is the instance's own answer handed back, so the write changes something
  # exactly when one of the three differs — and Zitadel REFUSES a write that
  # changes nothing: `PUT /admin/v1/policies/login` answers HTTP 400 "Default
  # Login Policy has not been changed". That is how E2E (managed) #130 died on
  # 2026-09-02: the organisation's own policy was the only thing wrong, the
  # reset above had already removed it, and the instance policy was right all
  # along — so the bring-up failed on a write it had no reason to send.
  SAME="$(jq -r --argjson x "$WANT_EXTERNAL" '.policy | ((.allowRegister // false) and (.allowUsernamePassword // false) and ((.allowExternalIdp // false) == $x))' <<<"$INSTANCE")"
  if [ "$SAME" = "true" ]; then
    say "the instance policy already reads that way — nothing to write; what people resolve is read back below"
  # AND IF THE PROVIDER STILL CALLS IT UNCHANGED, THAT IS AN ANSWER, NOT A
  # FAILURE: nothing was lost, and the read-backs below are what decide.
  # Anything else it refuses is printed and fatal, exactly as before.
  elif ! written="$( (api PUT /admin/v1/policies/login "$POLICY") 2>&1 )"; then
    case "$written" in
      *"has not been changed"*) say "the provider answered that the policy already reads that way — nothing was changed" ;;
      *) printf '%s\n' "$written" >&2; exit 1 ;;
    esac
  fi

  # READ BACK, AND SEPARATELY. Four settings that fail in four different ways,
  # and a person reading the log deserves to know WHICH one did not take.
  [ "$(read_allow_register)" = "true" ] \
    || die "could not allow people to register.

Granting an access request creates an invitation, not an account — ADR-0042
forbids us from creating one at the provider — so without this a granted person
reaches a sign-in page they cannot get past.

Set it by hand: the console at ${ISSUER}/ui/console, under
Settings -> Login Behaviour, tick 'Register allowed'."

  # READ ONCE, AND REPORT WHAT CAME BACK. The version of this that shipped in
  # #576 said "and it is not", which asserted a value it never showed — and
  # then sent the reader to a console switch without saying which way to move
  # it. On the 0-provider path the wanted value is OFF, so "set it by hand" was
  # an invitation to turn ON exactly the thing being refused. A remedy that can
  # be followed backwards is worse than none.
  GOT_EXTERNAL="$(read_allow_external)"
  [ "$GOT_EXTERNAL" = "$WANT_EXTERNAL" ] \
    || die "could not set whether a sign-in provider may be offered.

${IDP_COUNT:-0} provider(s) are configured, so 'External IDP allowed' should be
${WANT_EXTERNAL}. Asked just now, this instance answered: ${GOT_EXTERNAL:-(nothing at all)}

CHECK THE VALUE BEFORE CHANGING ANYTHING. If it already reads ${WANT_EXTERNAL},
the setting is right and this refusal is the bug — nothing in the console needs
touching. Read it directly with:

    curl -sS -X GET ${ISSUER}/management/v1/policies/login \\
      -H \"Authorization: Bearer \$PAT\" | jq .policy.allowExternalIdp

If it genuinely disagrees, the console at ${ISSUER}/ui/console under
Settings -> Login Behaviour holds it — and the value to leave it on is
${WANT_EXTERNAL}, which with ${IDP_COUNT:-0} provider(s) configured means the
box stays $([ "$WANT_EXTERNAL" = "true" ] && echo TICKED || echo UNTICKED)."

  # THE TWO THE SHADOW POLICY GOT WRONG WITHOUT SAYING SO. Both refusals below
  # describe a stack where every other check above has just passed and nobody
  # can sign in, so they say that outright rather than naming a setting.
  GOT_INHERITS="$(read_inherits)"
  [ "$GOT_INHERITS" = "true" ] \
    || die "the organisation still carries a login policy of its own.

It shadows the instance policy wholesale — the sign-in lifetimes, and the list
of providers this script just put buttons on. Both settings above read back
correctly and they were read off the shadow, so this is a stack that will look
configured and let nobody in.

Remove it, so the organisation inherits the instance policy:

    curl -sS -X DELETE ${ISSUER}/management/v1/policies/login \\
      -H \"Authorization: Bearer \$PAT\"

or in the console at ${ISSUER}/ui/console, under Organisation -> Login
Behaviour, 'Reset to default'. Then run this again."

  GOT_LIFE="$(read_password_life)"
  positive_password_life <<<"$(api GET /management/v1/policies/login)" \
    || die "a password check on this instance is valid for no time at all.

The policy people actually resolve answers ${GOT_LIFE:-(nothing at all)} for
passwordCheckLifetime, and a check valid for zero seconds is a check that is
never valid: the right password returns 200 to the same sign-in page, with no
error on it, for everybody.

Read the whole policy — the other four lifetimes fail the same way — with:

    curl -sS -X GET ${ISSUER}/management/v1/policies/login \\
      -H \"Authorization: Bearer \$PAT\" | jq .policy

The console at ${ISSUER}/ui/console under Settings -> Login Behaviour holds
them; Zitadel's own default for this one is 864000s (10 days)."

  say "allowed (providers offered: ${WANT_EXTERNAL}, password check: ${GOT_LIFE})"
fi

# ACCESS TOKENS AS JWT, above, is what makes the API's JWKS path work at all.
# The default is an opaque token, which the API cannot verify locally — it would
# have to call the provider's introspection endpoint on every request, which is
# both slower and exactly the provider-specific coupling ADR-0042 forbids.

# ------------------------------------------------------------------- writing --

say "writing the configuration into .env"
# THE CONSOLE PATH IS COMPOSED HERE AND NOWHERE ELSE.
#
# The support screen links an operator through to a person's account at the
# provider, because the account-level work — a password nobody can reset, a
# second factor lost with a phone — is the provider's and never Ownpace's
# (ADR-0042). The obvious way to build that link is `${issuer}` plus the path,
# in the screen. It would work, and it is exactly the decay ADR-0042's third
# rule exists to stop: an admin console is not an OIDC concept and no two
# providers spell it the same way.
#
#     Zitadel    /ui/console/users/<sub>
#     Keycloak   /admin/master/console/#/<realm>/users/<sub>/settings
#     Authentik  /if/admin/#/identity/users/<sub>
#
# `no-issuer-lock-in.unit.test.ts` now refuses all three shapes in shipped
# source. THIS file is where they belong — a deployment has to name what it
# deploys, and that guard does not scan the compose file, this script, or the
# docs, for exactly that reason. Switching provider stays what the owner made
# the condition of accepting one: variables and a rebuild.
#
# `{sub}` is substituted by the web app. The route is Zitadel's own
# `users/:id` (console routing, v4), the same one `users/me` sits beside.
#
# IDP_UPSTREAM_CALLBACK_URL is the same address this script prints under
# "register at each upstream" — where Google, Microsoft and GitHub return the
# browser during a social sign-in. Written here so the app's Redirect URIs
# page can SHOW it without composing a Zitadel path in shipped source (the
# lock-in guard refuses that, correctly). Apple wants the `/form` variant;
# the printed list carries both.
"$UPSERT" "$ENV_FILE" \
  "JWT_ISSUER=${ISSUER}" \
  "JWT_AUDIENCE=${PROJECT_ID}" \
  "VITE_OIDC_ISSUER=${ISSUER}" \
  "VITE_OIDC_CLIENT_ID=${CLIENT_ID}" \
  "VITE_IDP_CONSOLE_USER_URL=${ISSUER}/ui/console/users/{sub}" \
  "IDP_UPSTREAM_CALLBACK_URL=${ISSUER}/ui/login/login/externalidp/callback"

# THE LOGIN NAME IS USER@ORGANISATION-DOMAIN, not user@instance. Zitadel
# generates the first organisation's primary domain from its NAME (the default
# organisation "ZITADEL" becomes zitadel.<external domain>), and that is what a
# person types on the sign-in screen. This printed owner@${IDP_DOMAIN} until
# 2026-09-02, and the owner's first attempt answered "is not known". Read the
# real one from the instance; fall back to the old form only if it cannot be
# read, and say so rather than print a guess as a fact.
# The setup service user lives in that first organisation, so /orgs/me with
# its token IS the owner's organisation. Read first, then parse — a `$(api |
# jq)` pipeline would abort on pipefail alone, and this is a summary line, not
# a gate: a failure here prints the fallback, it does not fail the run.
org_me="$(api GET /management/v1/orgs/me 2>/dev/null || true)"
ORG_DOMAIN="$(jq -r '.org.primaryDomain // empty' <<<"$org_me" 2>/dev/null || true)"
if [ -z "$ORG_DOMAIN" ]; then
  ORG_DOMAIN="${IDP_DOMAIN}   (could not read the organisation's domain — check Organisation -> Domains in the console)"
fi

cat <<EOF

[setup-zitadel] done.

  issuer     ${ISSUER}
  audience   ${PROJECT_ID}
  client     ${CLIENT_ID}
  console    ${ISSUER}/ui/console
  first user $(read_env ZITADEL_ADMIN_USERNAME owner)@${ORG_DOMAIN}
             (the login name carries the ORGANISATION's domain, not the issuer's)
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
# The provisioning token is written on FIRST INIT, and every later run of this
# script rotates it before it expires ("the credential's clock" above) — a
# stack the gate visits at least every few days renews itself. If this script
# says it cannot find one, or the 401 above named an expiry the gate slept
# through, the instance is initialised and the token is gone or stale. Two
# honest ways forward:
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
#     ./deploy/compose/bootstrap-managed.sh --only app
#
#   THE LAST LINE IS NOT `setup-zitadel.sh`, AND THAT IS THE WHOLE POINT OF IT.
#   A volume Docker has just recreated is owned by root, and this provider's
#   image declares a USER — `ghcr.io/zitadel/zitadel` runs as uid 1000. First
#   init therefore cannot write its own token:
#
#     migration failed  name=03_default_instance
#       err.parent="open /machinekey/pat.txt: permission denied"
#
#   `bootstrap-managed.sh`'s phase_app calls prepare_machinekey_volume, which
#   reads the image's own Config.User, resolves a name to a uid through the
#   image's passwd, and chowns the volume before anything starts. Nothing else
#   in this repository does that, so a recipe ending at setup-zitadel.sh cannot
#   succeed on the volume it just told you to delete.
#
#   WORSE, IT FAILS TWICE AND ONLY THE SECOND ONE IS VISIBLE. Init registers the
#   instance domain, hits the permission error, and exits saying `setup failed,
#   skipping cleanup` — leaving the domain behind. `restart: unless-stopped`
#   then brings the container back, and every attempt after the first reports
#
#     Errors.Instance.Domain.AlreadyExists
#     Key (instance_id, unique_type, unique_field)=(, instance_domain, …)
#
#   which is its own leftover, not a cause. The first attempt is at the HEAD of
#   `docker compose logs zitadel`, not the tail. Found 2026-09-01, by running
#   this very block.
#
#   The `zitadel` ROLE can stay — setup reuses it with the unchanged
#   ZITADEL_DB_PASSWORD. Only reasonable before there are real customers in it.
