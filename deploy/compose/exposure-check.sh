#!/usr/bin/env bash
# exposure-check.sh — what this machine publishes beyond loopback, read from
# Docker itself (workplan 0132 T3 (b)).
#
# THE FILES SAY LOOPBACK; THIS ASKS THE MACHINE. Since 0132 T3 (a) every
# `ports:` entry in managed.yml and www.yml answers on 127.0.0.1, and a
# `*_BIND` in a stack's `.env` adds one address: the front's for a routed port,
# the mesh's for a page opened from a laptop. `a-port-published-on-purpose`
# holds the files to that. It cannot see a container started before the change
# reached the machine, one started by hand, or the appliance nightly's dev
# Stalwart and Nextcloud, which publish on every interface while that run lasts.
#
# So this reads `docker ps` for EVERY running container on the host, not one
# project's: one run covers the OTA stack, live, the site and the demo's
# Stalwart. It fails for each port published
#
#   on every interface            0.0.0.0 or :: (Docker prints `[::]` or `:::`),
#                                 whatever EXPOSURE_ALLOW says
#   on any other address          unless it is loopback (any 127.x address, ::1) or
#                                 listed in EXPOSURE_ALLOW
#
# and for each publish it cannot read, rather than passing it. A container on
# the host's network publishes nothing Docker can show, so it is named as not
# checked and does not fail the run.
#
# EXPOSURE_ALLOW is read from the `.env` of the stack that runs this (the one
# beside this script, or --env-file), with env-read.sh's `env_value`, never
# from the shell: a shell that sourced the other stack's `.env` must not widen
# this one's list. It is a list of IP addresses separated by commas, with no
# space: `EXPOSURE_ALLOW=192.0.2.10,100.64.0.1`. A bare space makes the file one
# bash cannot source, and bootstrap-managed.sh refuses it before the nightly
# gate starts (E2E (managed) #163); single or double quotes around the list are
# read too. Because this reads every container on the daemon, the list is every
# address any container on the machine is published on on purpose, not only
# this stack's: both stacks' `*_BIND` values, the site's WWW_BIND and the
# demo's STALWART_BIND. An entry that is not an address, or that is every
# interface, stops the check (exit 2).
#
# THE OWNER'S OWN CONTAINERS THAT ARE NOT OWNPACE'S (EXPOSURE_NOT_OURS). The
# machine also runs services of the owner's that have nothing to do with
# Ownpace, and some publish on every interface. The owner, 2026-10-05: "leave
# the host services alone and continue. I just want to be able to bring the
# live up. The box is airgapd behind netbird, so no issue there." So
# EXPOSURE_NOT_OURS, read from the same `.env` the same way as EXPOSURE_ALLOW
# (commas, no space; quotes read; the last line in force), lists CONTAINER
# NAMES, matched exactly. For a container named there, a publish this would
# fail (every interface, or an address EXPOSURE_ALLOW does not list) is printed
# as a note instead, and does not fail the run; one it cannot read still
# fails. A listed name that is not running is a note too, naming the entry by
# its place, never repeating it. Naming an Ownpace container this check
# recognises stops the check (exit 2):
#
#   by its name         ownpace…, in any case, whether it runs or not:
#                       managed.yml and www.yml build each `container_name`
#                       from the project, every Ownpace project is named
#                       ownpace… (the OTA stack's, live's, both sites', the
#                       appliance's and the upgrade drill's), and the fixed
#                       names (the dev and demo Stalwarts, the dev Nextcloud,
#                       the appliance's) are ownpace… too. Not dev.yml's
#                       Postgres, which Compose names after its project.
#   by its Compose      Docker's own labels, the fourth and fifth fields of the
#   labels              listing, when such a container runs: a project named
#                       ownpace…, or files under deploy/compose/ or
#                       deploy/selfhost/, whatever the project (config_files),
#                       or a project named `compose` whose files are not said.
#                       `compose` is what dev.yml's stack runs as, with no
#                       `name:` of its own (the appliance nightly's dev stack,
#                       the dev Postgres by hand), and what any compose file
#                       kept in a directory called compose runs as, the
#                       owner's own among them; config_files tells them apart.
#
# NOT EVERY OWNPACE CONTAINER IS RECOGNISED. One started without Compose and
# without an ownpace… name, by hand or by tests, is not: a `docker run` of an
# Ownpace image, the Postgres scripts/squash-migrations.sh starts, the
# testcontainers of the CI jobs that run on this machine, Trigger.dev's task
# runs. Their names change from run to run, and they stay off the list; a 2- or
# 3-field --from listing carries no labels at all, so there only the name is
# read. An entry that is not a container name (an address among them) is
# refused without being repeated.
#
# IT NAMES THE CONTAINER AND THE PORT, NEVER THE ADDRESS. T6 runs it after
# every deploy of live and T7 daily, and what they print may reach a public
# job log; the address it would name is this machine's front or mesh address.
# Not loopback either, so a line can be pasted anywhere. Docker's own error is
# repeated with every address in it replaced. Nothing that runs this may use
# `set -x`.
#
# Usage:  ./deploy/compose/exposure-check.sh [--env-file <path>] [--from <file>|-]
#
#   --env-file <path>   the `.env` to read EXPOSURE_ALLOW from; default: the
#                       `.env` beside this script, which may be absent (then
#                       only loopback passes)
#   --from <file>|-     read recorded lines instead of asking Docker, in the
#                       format this asks for:
#                       docker ps --format '{{.Names}}\t{{.Ports}}\t{{.Networks}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.config_files"}}'
#                       (the third to fifth fields may be left out)
#
# Exit: 0 every publish on loopback, an allowed address, or of a container
# EXPOSURE_NOT_OURS accepts; 1 findings; 2 usage, a bad EXPOSURE_ALLOW or
# EXPOSURE_NOT_OURS, or Docker not answering.
# scripts/exposure-check.unit.test.ts feeds it recorded lines.

set -euo pipefail

# No command before docker has been looked for: the check must be able to say
# "no docker" on a PATH that has nothing else either.
SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
[ "$SCRIPT_DIR" = "${BASH_SOURCE[0]}" ] && SCRIPT_DIR=.
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"

say() { printf 'exposure-check: %s\n' "$*"; }
usage_error() {
  printf 'exposure-check: %s\n' "$*" >&2
  exit 2
}

ENV_FILE=""
FROM=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      [ "$#" -ge 2 ] || usage_error "--env-file needs a path"
      ENV_FILE="$2"
      shift 2
      ;;
    --from)
      [ "$#" -ge 2 ] || usage_error "--from needs a file, or - for stdin"
      FROM="$2"
      shift 2
      ;;
    -h | --help)
      sed -n '2,/^# scripts\/exposure-check/p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) usage_error "unknown argument '$1' (usage: exposure-check.sh [--env-file <path>] [--from <file>|-])" ;;
  esac
done

if [ -z "$FROM" ] && ! command -v docker >/dev/null 2>&1; then
  usage_error "no docker on this PATH, so there is nothing to ask what this machine publishes"
fi

if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || usage_error "--env-file ${ENV_FILE} does not exist"
else
  ENV_FILE="${SCRIPT_DIR}/.env"
fi

# Every IPv4 address, and anything in brackets, replaced: for Docker's own
# words, which may name the daemon's address.
without_addresses() {
  sed -E \
    -e 's/[0-9]{1,3}(\.[0-9]{1,3}){3}/<address>/g' \
    -e 's/\[[0-9A-Fa-f:.%a-z]*\]/<address>/g' \
    -e 's/(^|[^0-9A-Za-z])[0-9A-Fa-f]{0,4}(:[0-9A-Fa-f]{0,4}){2,7}/\1<address>/g'
}

# ---- What Docker says ---------------------------------------------------------

# The whole daemon on purpose: no --filter, no compose project
# (two-stacks-on-one-box exempts this one listing).
PS_FORMAT='{{.Names}}\t{{.Ports}}\t{{.Networks}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.config_files"}}'
if [ -z "$FROM" ]; then
  err_file="$(mktemp)"
  trap 'rm -f "$err_file"' EXIT
  if ! listing="$(docker ps --format "$PS_FORMAT" 2>"$err_file")"; then
    {
      printf 'exposure-check: docker ps failed, so nothing was checked. Docker said:\n'
      without_addresses <"$err_file" | sed 's/^/  /'
    } >&2
    exit 2
  fi
elif [ "$FROM" = "-" ]; then
  listing="$(cat)"
else
  [ -f "$FROM" ] || usage_error "--from ${FROM} does not exist"
  listing="$(cat -- "$FROM")"
fi

# ---- What may be published beyond loopback --------------------------------------

is_every_interface() {
  case "$1" in
    '' | 0.0.0.0 | :: | 0:0:0:0:0:0:0:0) return 0 ;;
  esac
  return 1
}

is_ipv4() {
  local a="$1" octet
  local -a octets
  [[ "$a" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
  IFS=. read -r -a octets <<<"$a"
  for octet in "${octets[@]}"; do
    [ "$((10#$octet))" -le 255 ] || return 1
    # 010 is not 10 to everything that reads it; refuse the ambiguity.
    [[ "$octet" =~ ^(0|[1-9][0-9]*)$ ]] || return 1
  done
  return 0
}

is_ipv6() {
  [[ "$1" =~ ^[0-9A-Fa-f:.]+$ ]] && [[ "$1" == *:*:* ]]
}

is_loopback() {
  case "$1" in
    ::1 | 0:0:0:0:0:0:0:1) return 0 ;;
    127.*) is_ipv4 "$1" && return 0 ;;
  esac
  return 1
}

declare -A ALLOWED=()
allow_raw="$(env_value "$ENV_FILE" EXPOSURE_ALLOW)"
# One pair of double quotes around the list is quoting, as bash sources it:
# env_value strips single quotes only, and bootstrap-managed.sh's remedy for a
# bare space is KEY="first second".
case "$allow_raw" in '"'*'"') allow_raw="${allow_raw#\"}"; allow_raw="${allow_raw%\"}" ;; esac
IFS=$', \t' read -r -a allow_entries <<<"$allow_raw"
n=0
for entry in ${allow_entries[@]+"${allow_entries[@]}"}; do
  [ -n "$entry" ] || continue
  n=$((n + 1))
  entry="${entry#[}"
  entry="${entry%]}"
  if is_every_interface "$entry"; then
    usage_error "EXPOSURE_ALLOW in ${ENV_FILE}, entry ${n}, is every interface, which this check never allows. List the addresses the binds on this machine use (docs/managed-bring-up.md, \"Which address a port answers on\")."
  fi
  if ! is_ipv4 "$entry" && ! is_ipv6 "$entry"; then
    usage_error "EXPOSURE_ALLOW in ${ENV_FILE}, entry ${n}, is not an IP address. List addresses separated by commas, never a name or a range."
  fi
  ALLOWED["${entry,,}"]=1
done

# ---- Containers that are not Ownpace's ------------------------------------------

# What this recognises as Ownpace's (above). A container's files are never
# printed: they are paths on this machine.
is_ownpace_name() { [[ "${1,,}" == ownpace* ]]; }
# is_ownpace_compose <project> <config_files>
is_ownpace_compose() {
  case "${1,,}" in ownpace*) return 0 ;; esac
  case "$2" in *deploy/compose/* | *deploy/selfhost/*) return 0 ;; esac
  [ "${1,,}" = compose ] && [ -z "$2" ]
}

CONTAINER_NAME='^[A-Za-z0-9][A-Za-z0-9_.-]+$'
HAS_IPV4='[0-9]{1,3}(\.[0-9]{1,3}){3}'
declare -A NOT_OURS=()
NOT_OURS_LISTED=()
NOT_OURS_PLACE=()
not_ours_raw="$(env_value "$ENV_FILE" EXPOSURE_NOT_OURS)"
case "$not_ours_raw" in '"'*'"') not_ours_raw="${not_ours_raw#\"}"; not_ours_raw="${not_ours_raw%\"}" ;; esac
IFS=$', \t' read -r -a not_ours_entries <<<"$not_ours_raw"
n=0
for entry in ${not_ours_entries[@]+"${not_ours_entries[@]}"}; do
  [ -n "$entry" ] || continue
  n=$((n + 1))
  if ! [[ "$entry" =~ $CONTAINER_NAME ]] || [[ "$entry" =~ $HAS_IPV4 ]]; then
    usage_error "EXPOSURE_NOT_OURS in ${ENV_FILE}, entry ${n}, is not a container name. List the names docker ps prints, separated by commas, never an address (docs/managed-bring-up.md, \"Which address a port answers on\")."
  fi
  if is_ownpace_name "$entry"; then
    usage_error "EXPOSURE_NOT_OURS in ${ENV_FILE}, entry ${n}, is named like Ownpace's own containers (ownpace…), and an Ownpace container can never be accepted as not Ownpace's. Publish it on loopback or an address EXPOSURE_ALLOW lists, and take it out of the list."
  fi
  if [ -z "${NOT_OURS[$entry]+set}" ]; then
    NOT_OURS[$entry]=''
    NOT_OURS_LISTED+=("$entry")
    NOT_OURS_PLACE+=("$n")
  fi
done

# ---- Each container, each publish -----------------------------------------------

declare -A SEEN=()
FINDINGS=()
ACCEPTED=()
containers=0
publishes=0

finding() {
  if [ -z "${SEEN[$1]+set}" ]; then
    SEEN[$1]=1
    FINDINGS+=("$1")
  fi
}

# beyond <words>: a publish reachable beyond loopback and EXPOSURE_ALLOW. A
# finding, unless EXPOSURE_NOT_OURS names the container ($not_ours).
beyond() {
  if [ -z "$not_ours" ]; then
    finding "$1"
  elif [ -z "${SEEN[$1]+set}" ]; then
    SEEN[$1]=1
    ACCEPTED+=("$1")
  fi
}

line_no=0
while IFS= read -r line || [ -n "$line" ]; do
  line_no=$((line_no + 1))
  [ -n "$line" ] || continue
  case "$line" in
    *$'\t'*) ;;
    *) usage_error "line ${line_no} of the listing has no tab, so it is not '{{.Names}}<TAB>{{.Ports}}[<TAB>{{.Networks}}[<TAB>{{.Label \"com.docker.compose.project\"}}]]'" ;;
  esac
  name="${line%%$'\t'*}"
  rest="${line#*$'\t'}"
  ports="${rest%%$'\t'*}"
  networks=""
  project=""
  files=""
  [ "$rest" = "$ports" ] || networks="${rest#*$'\t'}"
  case "$networks" in
    *$'\t'*)
      project="${networks#*$'\t'}"
      networks="${networks%%$'\t'*}"
      case "$project" in
        *$'\t'*)
          files="${project#*$'\t'}"
          files="${files%%$'\t'*}"
          project="${project%%$'\t'*}"
          ;;
      esac
      ;;
  esac
  containers=$((containers + 1))

  not_ours=''
  # Docker never prints an empty name, a recorded listing may: no list entry.
  if [ -n "$name" ] && [ -n "${NOT_OURS[$name]+set}" ]; then
    if is_ownpace_compose "$project" "$files"; then
      usage_error "EXPOSURE_NOT_OURS in ${ENV_FILE} names ${name}, a container Docker labels as Ownpace's own Compose stack (its project is ownpace…, its files are under deploy/compose/ or deploy/selfhost/, or its project is compose, dev.yml's, with no files said): an Ownpace container can never be accepted as not Ownpace's. Take it out of the list."
    fi
    NOT_OURS[$name]=running
    not_ours=1
  fi

  case ",${networks// /}," in
    *,host,*)
      say "note: ${name} is on the host's network, where docker ps shows no publish; not checked"
      ;;
  esac

  [ -n "${ports// /}" ] || continue
  IFS=',' read -r -a entries <<<"$ports"
  for entry in "${entries[@]}"; do
    entry="${entry#"${entry%%[![:space:]]*}"}"
    entry="${entry%"${entry##*[![:space:]]}"}"
    [ -n "$entry" ] || continue
    # `5432/tcp`: exposed by the image, published nowhere.
    case "$entry" in *'->'*) ;; *) continue ;; esac
    publishes=$((publishes + 1))

    left="${entry%%->*}"
    right="${entry#*->}"
    if ! [[ "$right" =~ ^[0-9]+(-[0-9]+)?/(tcp|udp|sctp)$ ]]; then
      finding "${name} publishes something this check cannot read"
      continue
    fi
    proto="${right#*/}"
    case "$left" in
      '['*']:'*)
        addr="${left#[}"
        addr="${addr%%]*}"
        port="${left##*]:}"
        ;;
      *:*)
        addr="${left%:*}"
        port="${left##*:}"
        ;;
      *)
        finding "${name} publishes something this check cannot read (to ${right} in the container)"
        continue
        ;;
    esac
    if ! [[ "$port" =~ ^[0-9]+(-[0-9]+)?$ ]]; then
      finding "${name} publishes something this check cannot read (to ${right} in the container)"
      continue
    fi

    if is_every_interface "$addr"; then
      beyond "${name} publishes ${port}/${proto} on every interface"
    elif is_loopback "$addr"; then
      :
    elif [ -n "${ALLOWED[${addr,,}]+set}" ]; then
      :
    elif is_ipv4 "$addr" || is_ipv6 "$addr"; then
      beyond "${name} publishes ${port}/${proto} on an address EXPOSURE_ALLOW does not list"
    else
      finding "${name} publishes something this check cannot read (to ${right} in the container)"
    fi
  done
done <<<"$listing"

for a in ${ACCEPTED[@]+"${ACCEPTED[@]}"}; do
  say "note: ${a}; not Ownpace's, accepted in EXPOSURE_NOT_OURS"
done
# By its place: an entry Docker did not print may be a mistyped host name.
for i in ${NOT_OURS_LISTED[@]+"${!NOT_OURS_LISTED[@]}"}; do
  [ -n "${NOT_OURS[${NOT_OURS_LISTED[$i]}]}" ] || say "note: entry ${NOT_OURS_PLACE[$i]} of EXPOSURE_NOT_OURS names no running container"
done
for f in ${FINDINGS[@]+"${FINDINGS[@]}"}; do
  say "$f"
done

if [ "${#FINDINGS[@]}" -gt 0 ]; then
  say "FAIL: ${#FINDINGS[@]} publish(es) reachable beyond loopback and EXPOSURE_ALLOW, among ${containers} running container(s). Publish each on loopback, or set its *_BIND to an address EXPOSURE_ALLOW lists (docs/managed-bring-up.md, \"Which address a port answers on\")."
  exit 1
fi
accepted=''
[ "${#ACCEPTED[@]}" -eq 0 ] || accepted="; ${#ACCEPTED[@]} accepted as not Ownpace's (EXPOSURE_NOT_OURS)"
say "ok: ${containers} running container(s), ${publishes} publish(es), each on loopback or an address EXPOSURE_ALLOW lists${accepted}"
