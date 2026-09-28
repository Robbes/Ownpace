#!/usr/bin/env bash
# www-live.sh — live's copy of the public site, www.ownpace.eu (workplan 0139
# T10, with 0132 T6 and T7).
#
# WWW.OWNPACE.EU IS SERVED FROM LIVE'S OWN CHECKOUT, AT THE RELEASE TAG. The
# texts a tester accepts are the ones of the release that runs (0139 T3), and
# the site's footer names that release. So deploy-live.sh builds the site from
# the tag it deploys and brings it up, after the app's bring-up, whenever
# live's .env says
#
#   WWW_LIVE=true
#
# beside a WWW_PORT and a WWW_BIND of its own. Anything but `true`, `false` or
# nothing is refused, naming the key: a typo must not switch the site off in
# silence. The OTA site (www.ota.ownpace.eu, `ownpace-www`, from the OTA
# stack's checkout) is not this, and nothing here touches it.
#
# ONE PROJECT OF ITS OWN, AND NOBODY TYPES IT. Live's copy is the Compose
# project named after live's with `-www` after it:
#
#   <project>-www          (live's project is ownpace-live, 0132 T1b)
#
# and every command for it carries that project and live's .env:
#
#   docker compose -p <project>-www -f deploy/compose/www.yml --env-file deploy/compose/.env …
#
# The same command WITHOUT `-p`, in live's checkout, puts the site in live's
# own project, because www.yml reads the .env beside it and live's sets
# COMPOSE_PROJECT_NAME (www.yml's header, workplan 0139 T10 (b)). There each
# file sees the other's containers as orphans, and one `--remove-orphans` from
# either removes the other: live, or the site. Nothing in a compose file can
# refuse that. So deploy-live.sh refuses to deploy while a container of live's
# project has the compose service `www`, and the daily duty below fails on it
# (PR #1275's option 4).
#
# WHAT IT DEFINES, sourced by deploy-live.sh, which sets COMPOSE_PROJECT (the
# project reader's, env-read.sh) before it calls any of them:
#
#   WWW_LIVE_KEY, WWW_LIVE_APP_URL
#   www_live_switch <env-file>     `on` or `off`; fails on another value
#   www_in_project                 the names of COMPOSE_PROJECT's containers
#                                  with the compose service `www`, running or
#                                  stopped
#   www_live_state                 `<state> <health>` of each container of
#                                  live's copy, one per line, or nothing
#
# Each Docker read filters by a name built from the project, as every
# `docker ps` in deploy/compose does (two-stacks-on-one-box.unit.test.ts), and
# fails when docker does: a daemon that cannot be asked is never taken for
# "nothing there" (hard rule 9).
#
# AND ONE COMMAND, box-duties.sh's fifth duty, `site`:
#
#   ./deploy/compose/www-live.sh check      from live's checkout
#
# Read-only. It fails when a container of live's project has the compose
# service `www`, whatever the switch; and, with WWW_LIVE=true, when live's
# copy has no container, or one that is not running and healthy. With the
# switch off it does not ask about live's copy at all. It refuses a .env
# without live's marker (stack_is_live) and a project the reader refuses
# (compose_project). It prints no value from the .env, and nothing that runs
# it may use `set -x`.
#
# Exit (check): 0 as it should be; 1 a finding, each named; 2 not asked (not
#       live's .env, the project, the switch, docker that cannot be asked, an
#       argument).

WWW_LIVE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! declare -F env_value >/dev/null; then
  # shellcheck source=deploy/compose/env-read.sh
  . "${WWW_LIVE_DIR}/env-read.sh"
fi

# The switch in live's .env.
WWW_LIVE_KEY=WWW_LIVE
# The app a --public build must name (site/prices.mjs, PUBLIC_APP_URL).
WWW_LIVE_APP_URL=https://app.ownpace.eu

# www_live_switch <env-file> — `on` for true, `off` for false or nothing.
# Fails on anything else; the caller names the key, never the value.
www_live_switch() {
  case "$(env_value "${1:-}" "$WWW_LIVE_KEY")" in
    true) printf 'on' ;;
    false | '') printf 'off' ;;
    *) return 1 ;;
  esac
}

# www_in_project — the names of the containers of COMPOSE_PROJECT (live's)
# with the compose service `www`, running or stopped, one per line.
www_in_project() {
  docker ps -a --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" --filter "label=com.docker.compose.service=www" --format '{{.Names}}'
}

# www_live_state — `<state> <health>` for each container of live's copy of the
# site, the project `${COMPOSE_PROJECT}-www`, one per line (`none` for a
# container without a healthcheck), or nothing.
www_live_state() {
  local ids id
  ids="$(docker ps -a --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}-www" --filter "label=com.docker.compose.service=www" --format '{{.ID}}')" || return 1
  for id in $ids; do
    docker inspect \
      --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
      "$id" || return 1
  done
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  # shellcheck source=deploy/compose/stack-kind.sh
  . "${WWW_LIVE_DIR}/stack-kind.sh"

  www_say() { printf '[www-live] %s\n' "$@"; }
  www_stop() {
    printf '[www-live] %s\n' "$@" >&2
    exit 2
  }

  [ "$#" -eq 1 ] && [ "$1" = check ] ||
    www_stop "usage: ./deploy/compose/www-live.sh check      (from live's checkout; the header says more)"

  # Run, not sourced: this script's own directory, as every script names it.
  SCRIPT_DIR="$WWW_LIVE_DIR"
  env_file="${SCRIPT_DIR}/.env"
  [ -f "$env_file" ] || www_stop "no .env beside this script (${env_file}). This is live's copy of the site, checked from live's checkout."
  stack_is_live "$env_file" ||
    www_stop "${env_file} does not carry ${STACK_KIND_KEY} with live's value. This checks live's copy of the site; the OTA site is not it. Its value, if any, is not printed."
  COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" ||
    www_stop "the project this checkout drives could not be settled (the reason is above)."
  site_project="${COMPOSE_PROJECT}-www"
  switch="$(www_live_switch "$env_file")" ||
    www_stop "${WWW_LIVE_KEY} in ${env_file} is neither true nor false. Its value is not printed. Set ${WWW_LIVE_KEY}=true to serve www.ownpace.eu from live's checkout, or false."

  findings=()
  names="$(www_in_project)" ||
    www_stop "docker could not be asked which containers of ${COMPOSE_PROJECT} have the compose service www (above)."
  if [ -n "$names" ]; then
    findings+=("a container of ${COMPOSE_PROJECT} has the compose service www: ${names//$'\n'/, }. The site is in live's own project, where one --remove-orphans removes live or the site. Remove it by that name (docker rm -f <name>), never with a compose command in live's project; live's copy is ${site_project}, which deploy-live.sh brings up.")
  else
    www_say "no container of ${COMPOSE_PROJECT} has the compose service www"
  fi

  if [ "$switch" = on ]; then
    state="$(www_live_state)" ||
      www_stop "docker could not be asked about ${site_project} (above)."
    case "$state" in
      'running healthy') www_say "${site_project}: running healthy" ;;
      '') findings+=("${WWW_LIVE_KEY} is true, and ${site_project} has no container. deploy-live.sh brings it up with each deploy of live.") ;;
      *) findings+=("${site_project} is ${state//$'\n'/, }, not running healthy. Its log: docker compose -p ${site_project} -f deploy/compose/www.yml --env-file deploy/compose/.env logs --tail 100") ;;
    esac
  else
    www_say "${WWW_LIVE_KEY} is not true in live's .env: ${site_project} not asked"
  fi

  if [ "${#findings[@]}" -gt 0 ]; then
    printf '[www-live] FAIL: %s\n' "${findings[@]}" >&2
    exit 1
  fi
  www_say "ok"
fi
