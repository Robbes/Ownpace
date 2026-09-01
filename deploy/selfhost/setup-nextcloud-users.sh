#!/bin/bash
set -euo pipefail

# Provision two Nextcloud user accounts (source + target) on top of the shared dev
# Nextcloud container (deploy/compose/dev.yml's `nextcloud` service) so the multi-domain
# e2e (workplan issue #114 follow-up) can prove calendar/contacts sync ACROSS accounts —
# not just within the admin account the DAV source/target integration tests already use.
#
# Requires the container to already be up (`docker compose -f deploy/compose/dev.yml up -d
# nextcloud`) — this script only waits for readiness, configures trusted domains, and
# provisions users; it does not start the container itself.
#
# Idempotent: re-running against already-provisioned users is safe (OCS returns 102 "user
# already exists", which this script tolerates).
#
# Env overrides (all optional except NEXTCLOUD_HOST_PORT):
#   NEXTCLOUD_CONTAINER      container name (default ownpace-dev-nextcloud)
#   NEXTCLOUD_HOST_PORT      the host port the container's :80 is published on (required —
#                            the e2e workflow picks this dynamically; see "Pick free host ports")
#   NEXTCLOUD_ADMIN_USER     admin username (default admin, matches dev.yml)
#   NEXTCLOUD_ADMIN_PASSWORD admin password (default admin_dev_pw, matches dev.yml)
#   NEXTCLOUD_SOURCE_USER    source account userid (default e2e-source)
#   NEXTCLOUD_SOURCE_PASSWORD source account password (required)
#   NEXTCLOUD_TARGET_USER    target account userid (default e2e-target)
#   NEXTCLOUD_TARGET_PASSWORD target account password (required)
#   NEXTCLOUD_URL            base URL every curl call in this script (readiness, user
#                            creation, home-set touches) actually uses (default
#                            http://127.0.0.1:$NEXTCLOUD_HOST_PORT). Override to
#                            http://nextcloud/ (the compose network alias, already a
#                            trusted domain -- see NEXTCLOUD_TRUSTED_DOMAINS in
#                            managed.yml) if you're calling this from a
#                            Docker-outside-of-Docker sandbox joined to that network:
#                            127.0.0.1:<published-port> can be unreachable from such a
#                            caller's own shell even though Nextcloud is genuinely up
#                            (same trap documented for Stalwart in
#                            docs/stalwart-integration-fix.md's DooD section --
#                            confirmed to affect this script too, 2026-07-25, via a
#                            PROPFIND that failed with curl status 000 while `docker
#                            exec ... occ status` confirmed the app was fully installed).

CONTAINER="${NEXTCLOUD_CONTAINER:-ownpace-dev-nextcloud}"
HOST_PORT="${NEXTCLOUD_HOST_PORT:?NEXTCLOUD_HOST_PORT is required}"
ADMIN_USER="${NEXTCLOUD_ADMIN_USER:-admin}"
ADMIN_PASSWORD="${NEXTCLOUD_ADMIN_PASSWORD:-admin_dev_pw}"
SOURCE_USER="${NEXTCLOUD_SOURCE_USER:-e2e-source}"
SOURCE_PASSWORD="${NEXTCLOUD_SOURCE_PASSWORD:?NEXTCLOUD_SOURCE_PASSWORD is required}"
TARGET_USER="${NEXTCLOUD_TARGET_USER:-e2e-target}"
TARGET_PASSWORD="${NEXTCLOUD_TARGET_PASSWORD:?NEXTCLOUD_TARGET_PASSWORD is required}"

BASE_URL="${NEXTCLOUD_URL:-http://127.0.0.1:${HOST_PORT}}"

echo "[setup-nextcloud-users] Waiting for internal readiness (status.php via docker exec)..."
internal_ready=false
for _ in $(seq 1 60); do
  code="$(docker exec "$CONTAINER" curl -s -o /dev/null -w '%{http_code}' http://localhost/status.php || echo 000)"
  if [ "$code" = "200" ]; then
    internal_ready=true
    break
  fi
  sleep 5
done
if [ "$internal_ready" != "true" ]; then
  echo "[setup-nextcloud-users] Nextcloud did not become internally ready" >&2
  exit 1
fi
echo "[setup-nextcloud-users] Internal readiness OK"

# Trusted domains: the appliance reaches this container by its compose service/alias name
# ("nextcloud", on ownpace_dev-network); this script and the seed step reach it via the
# dynamically-picked host-published port. Both host forms must be trusted or Nextcloud
# rejects every request with its "untrusted domain" error page.
echo "[setup-nextcloud-users] Registering trusted domains..."
docker exec "$CONTAINER" php occ config:system:set trusted_domains 0 --value=localhost
docker exec "$CONTAINER" php occ config:system:set trusted_domains 1 --value=nextcloud
docker exec "$CONTAINER" php occ config:system:set trusted_domains 2 --value="127.0.0.1:${HOST_PORT}"
sleep 2
echo "[setup-nextcloud-users] Trusted domains registered"

# Wait for Nextcloud's own install/migration to finish via `occ status` (docker exec,
# no HTTP, no auth) BEFORE sending any Basic-Auth DAV request. Polling PROPFIND with
# real credentials while the app is still installing can hit its auth stack before the
# user backend is ready, drawing repeated 401s — Nextcloud's built-in brute-force
# protection (enabled by default) then throttles the IP, escalating to 429 for the rest
# of the run. `occ status` sidesteps that risk entirely: it never touches the web/auth
# stack, so it can't trigger the protection it's meant to check readiness for.
echo "[setup-nextcloud-users] Waiting for install to finish (occ status)..."
installed=false
for _ in $(seq 1 60); do
  status_json="$(docker exec "$CONTAINER" php occ status --output=json 2>/dev/null || echo '{}')"
  if grep -q '"installed":true' <<<"$status_json"; then
    installed=true
    break
  fi
  sleep 2
done
if [ "$installed" != "true" ]; then
  echo "[setup-nextcloud-users] Nextcloud did not finish installing" >&2
  exit 1
fi
echo "[setup-nextcloud-users] Install complete"

# THE GUARD THAT OUTLIVES THE RUN THAT TRIPPED IT. Nextcloud's brute-force
# protection counts failed logins PER SOURCE IP and keeps them for twelve
# hours; past its threshold every request from that IP is answered 429, and a
# CORRECT password does not clear the count. So a run with the wrong
# NEXTCLOUD_ADMIN_PASSWORD does not fail alone — it fails the next twelve
# hours of runs, after the password has been fixed.
#
# That is not hypothetical. E2E (managed) #117 died on 401: the password in
# .env was no longer the one inside the Nextcloud volume (changing it after
# the volume exists does not change the volume). #118 ran with the password
# repaired and Nextcloud healthy, and died anyway — 429, on the attempts #117
# had already banked against the runner's address.
#
# Allow-listing the ranges this stack talks over is not turning the protection
# off: anything arriving from outside them is still counted and still
# throttled. It exempts only the source that cannot be someone guessing
# credentials — this script's own readiness poll and the appliance beside it,
# which reach the published port from the host and so arrive from the Docker
# bridge gateway.
#
# AFTER the install wait, not before: unlike trusted_domains (which lands in
# config.php, a file) this writes to the appconfig TABLE, so it needs the
# schema the installer creates. Before the PROPFIND below, because the whole
# point is to be in force for the first authenticated request.
echo "[setup-nextcloud-users] Allow-listing the stack's own networks from brute-force protection..."
allowlist_range() {
  # stdout only — an occ failure still fails the script through set -e, and
  # its stderr still reaches the log. Nothing is swallowed; only the
  # "Config value ... set to ..." chatter is.
  docker exec "$CONTAINER" php occ config:app:set bruteForce "whitelist_$1" --value="$2" >/dev/null
}
allowlist_range 0 127.0.0.1/32
allowlist_range 1 10.0.0.0/8
allowlist_range 2 172.16.0.0/12
allowlist_range 3 192.168.0.0/16
echo "[setup-nextcloud-users] Brute-force allow-list in force"

# Sets `code` to the last status seen; 0 when the DAV endpoint answered 207.
poll_dav() {
  local attempts="$1" i
  for i in $(seq 1 "$attempts"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -X PROPFIND -H 'Depth: 0' \
      -u "${ADMIN_USER}:${ADMIN_PASSWORD}" "${BASE_URL}/remote.php/dav/" || echo 000)"
    if [ "$code" = "207" ]; then
      return 0
    fi
    # A 429 means the brute-force guard is already engaged (e.g. from a previous run's
    # leftover state) — back off much longer than the steady 2s cadence instead of
    # hammering it further and making the block last longer.
    if [ "$code" = "429" ]; then
      sleep 15
    else
      sleep 2
    fi
  done
  return 1
}

echo "[setup-nextcloud-users] Verifying external DAV readiness (PROPFIND)..."
propfind_ready=false
code=""
if poll_dav 10; then
  propfind_ready=true
elif [ "$code" = "401" ]; then
  # A 401 HERE IS DRIFT, NOT A DECISION. NEXTCLOUD_ADMIN_PASSWORD is what the
  # operator has declared the admin password to be — every other account on this
  # demo instance is already provisioned from the environment, and this is the
  # one that was not. The two fall out of step because Nextcloud reads that
  # variable ONCE, at first install: change it afterwards and compose hands the
  # container a value the volume has never heard of. Nothing announces that. It
  # surfaces as a 401 in a readiness poll, some number of runs later, and reads
  # like the service being broken.
  #
  # E2E (managed) #117 was exactly that, and it cost #118 as well: dying on 401
  # banked ten failed logins, and the guard above then refused a run whose
  # password was correct. So bring the volume into line with the declaration and
  # poll again, loudly, once — provisioning the admin from the environment the
  # same way the four demo accounts already are.
  #
  # OC_PASS is exported into docker's own environment and forwarded by name, so
  # the value never appears in an argument list.
  echo "[setup-nextcloud-users] 401 — the admin password inside the volume is not the one this" >&2
  echo "[setup-nextcloud-users] run was given. Aligning the volume with NEXTCLOUD_ADMIN_PASSWORD..." >&2
  OC_PASS="$ADMIN_PASSWORD" docker exec -e OC_PASS "$CONTAINER" \
    php occ user:resetpassword --password-from-env "$ADMIN_USER" >/dev/null
  echo "[setup-nextcloud-users] Admin password realigned; re-checking" >&2
  if poll_dav 5; then
    propfind_ready=true
  fi
fi
if [ "$propfind_ready" != "true" ]; then
  echo "[setup-nextcloud-users] External DAV did not become ready (last PROPFIND status: ${code:-unknown})" >&2
  # THE STATUS IS THE DIAGNOSIS, so say what it means and what clears it. Two
  # consecutive managed runs (#117, #118) were spent reading a bare status
  # code off a log and guessing at it from the outside; each of the three
  # below has a different cause and a different remedy, and the script is the
  # only place that knows which one it just saw.
  note() { echo "[setup-nextcloud-users]   $1" >&2; }
  case "$code" in
  401)
    note "401 AFTER the realignment above, so this is not the ordinary drift"
    note "between .env and the volume — that step would have ended it. Either the"
    note "reset did not take, or '${ADMIN_USER}' is not an administrator on this"
    note "instance and never was. Ask it who is:"
    note "  docker exec ${CONTAINER} php occ group:list"
    note "and set NEXTCLOUD_ADMIN_USER to a name in the admin group."
    ;;
  429)
    note "429 = brute-force protection is throttling this source. It counts failed"
    note "logins for twelve hours, so an EARLIER run's wrong password can refuse"
    note "this one even with the password now correct. The allow-list applied"
    note "above should have prevented this; if it did not, read it back with:"
    note "  docker exec ${CONTAINER} php occ config:app:get bruteForce whitelist_0"
    note "and clear the banked attempts for the address with:"
    note "  docker exec ${CONTAINER} php occ security:bruteforce:reset <ip>"
    ;;
  000)
    note "000 = curl never got an answer, which is about REACHABILITY and not"
    note "about Nextcloud: ${BASE_URL} is not routable from this shell. From a"
    note "Docker-outside-of-Docker caller joined to the compose network, set"
    note "NEXTCLOUD_URL=http://nextcloud/ instead (see this file's header)."
    ;;
  esac
  exit 1
fi
echo "[setup-nextcloud-users] External DAV ready at ${BASE_URL}"

create_user() {
  local userid="$1" password="$2"
  echo "[setup-nextcloud-users] Creating user '${userid}'..."
  local body
  body="$(curl -s -u "${ADMIN_USER}:${ADMIN_PASSWORD}" \
    -H 'OCS-APIRequest: true' \
    -d "userid=${userid}" --data-urlencode "password=${password}" \
    "${BASE_URL}/ocs/v1.php/cloud/users")"
  # statuscode 100 = created, 102 = user already exists — both fine (idempotent re-run).
  if grep -qE '<statuscode>(100|102)</statuscode>' <<<"$body"; then
    echo "[setup-nextcloud-users] User '${userid}' ready"
  else
    echo "[setup-nextcloud-users] Unexpected OCS response creating '${userid}':" >&2
    echo "$body" >&2
    exit 1
  fi
}

create_user "$SOURCE_USER" "$SOURCE_PASSWORD"
create_user "$TARGET_USER" "$TARGET_PASSWORD"

# Touch each account's calendar-home-set / addressbook-home-set once as that user — this is
# what makes Nextcloud lazily auto-provision the default 'personal' calendar and 'contacts'
# address book (the same lazy-provision the existing caldav-source/carddav-source integration
# tests rely on for the admin account; freshly-created OCS users get it on first DAV touch too).
# MUST be Depth: 1 (enumerate children), not Depth: 0 (just the home-set collection's own
# properties) — Nextcloud's CalDAV/CardDAV backends provision the default collection lazily
# when the children are LISTED, exactly what CalDAVSource/CarddavSource.listFolders() does
# via a Depth: 1 PROPFIND; a Depth: 0 touch on the home-set itself does not trigger it.
for user_pass in "${SOURCE_USER}:${SOURCE_PASSWORD}" "${TARGET_USER}:${TARGET_PASSWORD}"; do
  user="${user_pass%%:*}"
  pass="${user_pass#*:}"
  curl -s -o /dev/null -X PROPFIND -H 'Depth: 1' -u "${user}:${pass}" "${BASE_URL}/remote.php/dav/calendars/${user}/" || true
  curl -s -o /dev/null -X PROPFIND -H 'Depth: 1' -u "${user}:${pass}" "${BASE_URL}/remote.php/dav/addressbooks/users/${user}/" || true
done

echo "[setup-nextcloud-users] Done: source='${SOURCE_USER}', target='${TARGET_USER}'"
