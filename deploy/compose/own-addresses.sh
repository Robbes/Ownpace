#!/usr/bin/env bash
# own-addresses.sh — this machine's own addresses, as its .env names them, kept
# out of a log somebody else can read.
#
# THE GATE'S LOG IS PUBLIC, AND SO IS ITS EVIDENCE. The managed gate runs on
# the owner's machine, and its `.env` holds that machine's mesh address in
# every `*_BIND` a laptop or a front reaches, in TRIGGER_TLS_HOST, in the
# dashboard's origins and in Nextcloud's trusted domains. None of it is a
# secret, so GitHub masks none of it. A sweep on 2026-09-27 found sixteen
# places a run printed it: four on every run, the rest on a failure
# (`scripts/a-public-log-that-named-the-machine-it-ran-on.unit.test.ts`).
#
# The places that printed it no longer do. This is what stands behind them,
# for the message nobody has found yet:
#
#   --mask <env-file>     one `::add-mask::<value>` line per value, for the
#                         gate to run once the .env is restored. The runner
#                         prints `***` for each in every later step. A mask
#                         does NOT reach a file: an uploaded artifact, or a
#                         log somebody pastes from their own shell.
#   own_address_sed       a `sed -E` program that replaces each value with the
#                         key that holds it (`<MAILPIT_BIND>`) and any address
#                         in the mesh's range (100.64.0.0/10) with <mesh-ip>.
#                         The range covers what a mask cannot know: another
#                         peer's address in a container's access log.
#   --redact <env-file>   that program, as a filter from stdin to stdout.
#   shown_origin          an origin when its host is loopback, and otherwise
#                         the name of the key that holds it.
#
# WHAT COUNTS AS THIS MACHINE'S. Every `*_BIND`, TRIGGER_TLS_HOST, the hosts of
# TRIGGER_APP_ORIGIN and TRIGGER_LOGIN_ORIGIN, and each entry of
# NEXTCLOUD_TRUSTED_DOMAINS. Never loopback, every interface, an empty value, or
# the name of a service in managed.yml: `nextcloud` is in the trusted domains,
# and masked it would blank the word out of every line the job prints.
#
# The values are read with env-read.sh's `env_value`, the way Compose and bash
# both read them (a double-quoted one too), and never printed except on a mask
# line, which the runner consumes. So nothing that runs this may use `set -x`.
#
# Usage:  . "${SCRIPT_DIR}/env-read.sh"; . "${SCRIPT_DIR}/own-addresses.sh"
#         ./deploy/compose/own-addresses.sh --mask deploy/compose/.env

OWN_ADDRESSES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! declare -F env_value >/dev/null; then
  # shellcheck source=deploy/compose/env-read.sh
  . "${OWN_ADDRESSES_DIR}/env-read.sh"
fi

# The mesh's range, 100.64.0.0/10: what NetBird and Tailscale hand a peer.
OWN_ADDRESSES_MESH_RE='\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}\b'

# The host of an origin: no scheme, no credentials, no path, no port, and an
# IPv6 literal without its brackets.
_own_origin_host() {
  local h="${1#*://}"
  h="${h%%/*}"
  h="${h##*@}"
  case "$h" in
    '['*) h="${h#[}"; h="${h%%]*}" ;;
    *) h="${h%%:*}" ;;
  esac
  printf '%s' "$h"
}

# True for a value that names no machine in particular.
_own_is_nobody() {
  case "$1" in
    '' | localhost | *.localhost | 127.* | 0.0.0.0 | :: | '[::]' | ::1 | '[::1]' | host.docker.internal) return 0 ;;
  esac
  # A compose service's own name, which every stack built from managed.yml has.
  grep -qxF -- "$1" <<<"$(sed -n '/^services:/,/^[^[:space:]#]/s/^  \([A-Za-z0-9][A-Za-z0-9_.-]*\):[[:space:]]*$/\1/p' \
    "${OWN_ADDRESSES_DIR}/managed.yml" 2>/dev/null)"
}

# own_addresses <env-file> — `value<TAB>KEY[,KEY…]`, one line per value, in the
# order the keys are met.
own_addresses() {
  local file="${1:-}" key value entry i found
  local -a values=() labels=()
  [ -f "$file" ] || return 0

  # A value as bash sources it: one pair of double quotes around it is quoting,
  # not part of the address. managed.env.example and load_env's remedy both
  # write NEXTCLOUD_TRUSTED_DOMAINS="localhost nextcloud …", env_value keeps a
  # double quote, and the mask runs before check-env-agreement.sh refuses it.
  _own_value() { # _own_value <file> <key>
    local v
    v="$(env_value "$1" "$2")"
    case "$v" in '"'*'"') v="${v#\"}"; v="${v%\"}" ;; esac
    printf '%s' "$v"
  }

  _own_add() { # _own_add <value> <key>
    _own_is_nobody "$1" && return 0
    found=""
    for i in "${!values[@]}"; do
      if [ "${values[$i]}" = "$1" ]; then
        found=1
        case ",${labels[$i]}," in *",$2,"*) ;; *) labels[i]="${labels[$i]},$2" ;; esac
      fi
    done
    [ -n "$found" ] && return 0
    values+=("$1")
    labels+=("$2")
  }

  # The lines env_value reads, and no others: the same keys the bring-up's bind
  # refusal holds to its rule.
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    _own_add "$(_own_value "$file" "$key")" "$key"
  done <<<"$(sed -n 's/^\(export[[:space:]][[:space:]]*\)\{0,1\}\([A-Za-z_][A-Za-z0-9_]*_BIND\)=.*/\2/p' "$file" | sort -u)"

  _own_add "$(_own_value "$file" TRIGGER_TLS_HOST)" TRIGGER_TLS_HOST
  for key in TRIGGER_APP_ORIGIN TRIGGER_LOGIN_ORIGIN; do
    value="$(_own_value "$file" "$key")"
    [ -n "$value" ] && _own_add "$(_own_origin_host "$value")" "$key"
  done
  # Space-separated, as the Nextcloud image reads it. An entry may carry a
  # port; an IPv6 literal carries more than one colon and keeps its own.
  local -a entries=()
  read -r -a entries <<<"$(_own_value "$file" NEXTCLOUD_TRUSTED_DOMAINS)"
  for entry in "${entries[@]}"; do
    case "$entry" in *:*:*) ;; *) entry="${entry%%:*}" ;; esac
    _own_add "$entry" NEXTCLOUD_TRUSTED_DOMAINS
  done
  # Comma-separated, as exposure-check.sh reads it (0132 T3 (b)). It lists every
  # address any container on the machine is published on, the other stack's
  # and the site's among them, which this file's own *_BIND lines may not name.
  local -a allowed=()
  IFS=',' read -r -a allowed <<<"$(_own_value "$file" EXPOSURE_ALLOW)"
  for entry in "${allowed[@]}"; do
    _own_add "${entry//[[:space:]]/}" EXPOSURE_ALLOW
  done

  unset -f _own_add _own_value
  for i in "${!values[@]}"; do printf '%s\t%s\n' "${values[$i]}" "${labels[$i]}"; done
}

# own_address_masks <env-file> — what the runner needs to hide each value.
own_address_masks() {
  local value label
  while IFS=$'\t' read -r value label; do
    [ -n "$value" ] && printf '::add-mask::%s\n' "$value"
  done <<<"$(own_addresses "${1:-}")"
  return 0
}

# own_address_sed <env-file> — a `sed -E` program: each value becomes the key
# that holds it, then any address left in the mesh's range becomes <mesh-ip>.
# Longest first, so a name is never cut by a shorter one inside it. A value is
# matched whole where its ends are word characters: 192.0.2.10 is replaced and
# 192.0.2.100 is not. GNU sed, for `\b`, as redact-evidence.sh already needs.
own_address_sed() {
  local value label escaped pre post
  while IFS=$'\t' read -r value label; do
    [ -n "$value" ] || continue
    escaped="$(printf '%s' "$value" | sed 's#[][\.*^$(){}+?|/]#\\&#g')"
    pre=""; post=""
    [[ "${value:0:1}" =~ [A-Za-z0-9_] ]] && pre='\b'
    [[ "${value: -1}" =~ [A-Za-z0-9_] ]] && post='\b'
    printf 's/%s%s%s/<%s>/g\n' "$pre" "$escaped" "$post" "$label"
  done <<<"$(own_addresses "${1:-}" | awk -F'\t' '{ print length($1) "\t" $0 }' | sort -rn | cut -f2-)"
  printf 's/%s/<mesh-ip>/g\n' "$OWN_ADDRESSES_MESH_RE"
}

# own_address_redact <env-file> — stdin to stdout, through that program. A
# program sed refuses would print nothing at all, and a diagnosis that vanished
# is worse than one with an address in it, so the range alone stands in.
own_address_redact() {
  local program
  program="$(own_address_sed "${1:-}")"
  sed -E -e "$program" </dev/null >/dev/null 2>&1 || program="$(own_address_sed /dev/null)"
  sed -E -e "$program"
}

# shown_origin <url> <key> — the url when its host is this machine's loopback,
# where printing it tells nobody anything; otherwise the key that holds it.
shown_origin() {
  case "$(_own_origin_host "${1:-}")" in
    localhost | 127.* | ::1) printf '%s' "$1" ;;
    *) printf 'the address in %s (not printed: it is this machine'"'"'s own)' "${2:-its key}" ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  case "${1:-}" in
    --mask)
      own_address_masks "${2:-}"
      echo "[own-addresses] $(own_addresses "${2:-}" | grep -c . || true) value(s) from ${2:-} masked for the rest of this job"
      ;;
    --redact) own_address_redact "${2:-}" ;;
    *)
      echo "usage: own-addresses.sh --mask <env-file> | --redact <env-file>" >&2
      exit 2
      ;;
  esac
fi
