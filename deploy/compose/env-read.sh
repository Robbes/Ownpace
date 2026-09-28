#!/usr/bin/env bash
# env-read.sh — the one way to read a value out of a compose `.env`.
#
# THERE WERE THREE PARSERS, AND ONLY TWO OF THEM WERE KNOWN ABOUT.
#
# `check-env-agreement.sh` exists because `deploy/compose/.env` is read both by
# Docker Compose's Go dotenv and by bash `source`, and they stop agreeing on any
# value holding whitespace, a dollar, a backslash or a quote. Its remedy is to
# SINGLE-QUOTE such a value: the one form neither of those two expands.
#
# On 2026-09-08 that advice met the third parser. Twenty-four places in
# `deploy/compose` read the file with a hand-rolled line of their own:
#
#     grep -E "^KEY=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//'
#
# which understands no quoting at all. Given `KEY='swordfish'` it returns
# `'swordfish'` — quotes included — and given `KEY='localhost nextcloud'` it
# returns `'localhost`, truncated at the first space. So the fix for one pair of
# parsers silently broke a third, and the first thing to break would have been
# `setup-zitadel.sh` configuring the Microsoft identity provider with a client
# secret two characters longer than the real one. A sign-in failure, hours
# later, naming nothing.
#
# That is the same class of defect the checker was written to prevent, so the
# checker's rule and this reader are now one thing: what
# `check-env-agreement.sh` ACCEPTS, this READS, and it reads it the way Compose
# and bash both would.
#
#   KEY=value                → value
#   KEY=value   # a comment  → value        (one whitespace-preceded comment)
#   KEY='value'              → value        (quotes stripped, as both parsers do)
#   KEY='two words'          → two words    (the space survives)
#   export KEY=value         → value
#   KEY=                     → the default
#   (key absent)             → the default
#
# It never sources the file: a `.env` is data, and `source` on one containing
# `$(...)` would run it. And it takes the LAST occurrence of a key, because
# that is the one Compose and `set -a; . .env` both put in force — one reader
# here used to take the first, and would have reported a value the running
# stack did not have.
#
# Usage:  . "${SCRIPT_DIR}/env-read.sh"
#         value="$(env_value "$ENV_FILE" SOME_KEY [default])"

# env_value <env-file> <key> [default]
env_value() {
  local file="${1:-}"
  local key="${2:-}"
  local default="${3:-}"
  local line value body

  if [ -z "$file" ] || [ -z "$key" ] || [ ! -f "$file" ]; then
    printf '%s' "$default"
    return 0
  fi

  line="$(grep -E "^(export[[:space:]]+)?${key}=" "$file" 2>/dev/null | tail -1 || true)"
  if [ -z "$line" ]; then
    printf '%s' "$default"
    return 0
  fi

  value="${line#*=}"

  case "$value" in
    "'"*)
      # Single-quoted: the value is everything up to the closing quote, and
      # what follows it is a comment or nothing. An UNCLOSED quote yields the
      # rest of the line — `check-env-agreement.sh` refuses that shape outright,
      # so it cannot reach a stack that runs the check first.
      body="${value#\'}"
      value="${body%%\'*}"
      ;;
    *)
      # Bare: strip one whitespace-preceded comment, as both parsers do, then
      # the whitespace it left behind.
      case "$value" in
        *[[:space:]]'#'*) value="${value%%[[:space:]]#*}" ;;
      esac
      value="${value%"${value##*[![:space:]]}"}"
      ;;
  esac

  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$default"
  fi
}

# stack_kind_clean <value> — a value of live's marker (stack-kind.sh) as it is
# compared: without surrounding whitespace or double quotes, in lower case.
# Here rather than in stack-kind.sh because compose_project below compares it
# too, and stack-kind.sh sources this file, never the other way round. Every
# caller of stack-kind.sh still has it.
stack_kind_clean() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  # A double-quoted value is live too: env_value strips single quotes only,
  # and a refusal must not hinge on which quotes somebody typed.
  value="${value#\"}"
  value="${value%\"}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value,,}"
}

# compose_project <compose-dir>
#
# THE COMPOSE PROJECT THIS CHECKOUT DRIVES, found the way Compose finds it
# (workplan 0132 T1). Two stacks share one Docker daemon on the reference
# machine, the OTA stack and `ownpace-live`, and a daemon keeps them apart by
# NAMES only: every container, volume and network is named after its project.
# A script that spelled a name out reached whichever stack owned it; one that
# asks this reaches its own.
#
# Compose takes the project from, in order:
#
#   COMPOSE_PROJECT_NAME in the environment   even when it is set but EMPTY:
#                                             then the .env is not read and
#                                             managed.yml's `name:` applies
#   COMPOSE_PROJECT_NAME in the .env beside managed.yml
#   managed.yml's own `name:`                 the OTA stack's default
#
# Checked against Compose 5.1.1 on 2026-09-27 with `docker compose config`,
# which prints the name it chose. The scripts here never pass `-p`, so these
# three are every way a stack is chosen.
#
# THE CHECKOUT'S .env IS WHAT CHOOSES THE STACK, and a shell that says
# otherwise is refused rather than followed. `set -a; . deploy/compose/.env` in
# one checkout exports that stack's name (or an empty one) into the shell, and
# Compose then prefers it over the next checkout's own `.env`: the same command
# in live's checkout would act on the OTA stack. So when the environment and
# the file disagree, this names both and fails, and nothing gets built from
# either. A name Compose would refuse is refused here too.
#
# LIVE'S .env ON THE OTA STACK'S PROJECT IS REFUSED (workplan 0132 T1b, T1g).
# Live's .env carries live's marker (stack-kind.sh) and
# COMPOSE_PROJECT_NAME=ownpace-live. Without the second line the fallback above
# is managed.yml's `name:`, the OTA stack's, and every script in live's
# checkout would drive the OTA stack's containers and volumes with live's
# secrets, ports and production names. So when the project comes out as
# managed.yml's own name and the .env carries exactly live's marker (the rule
# stack_is_live has), this names the keys, never a value, and fails. The
# marker's key and value are read out of stack-kind.sh as data, not sourced,
# since stack-kind.sh sources this file. That stack-kind.sh is the one beside
# this file's real path, not beside the .env: a directory that links this
# reader in has the marker where the reader is. A checkout without it cannot
# tell live's .env from the OTA stack's, and is refused rather than guessed at.
#
# Usage:  COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")"
compose_project() {
  local dir="${1:-}"
  local declared from_file name marker marker_key marker_live

  declared="$(sed -n 's/^name:[[:space:]]*\([^[:space:]#]*\).*/\1/p' "${dir}/managed.yml" 2>/dev/null)"
  from_file="$(env_value "${dir}/.env" COMPOSE_PROJECT_NAME)"
  from_file="${from_file:-$declared}"

  if [ "${COMPOSE_PROJECT_NAME+set}" = "set" ]; then
    name="${COMPOSE_PROJECT_NAME:-$declared}"
    if [ "$name" != "$from_file" ]; then
      echo "compose_project: this shell has COMPOSE_PROJECT_NAME='${COMPOSE_PROJECT_NAME}', so Compose would drive '${name}'," >&2
      echo "  but ${dir}/.env chooses '${from_file:-nothing}'. Compose follows the shell, and this checkout is the other stack's." >&2
      echo "  Unset it (unset COMPOSE_PROJECT_NAME), or open a new shell, and run this again." >&2
      return 1
    fi
  else
    name="$from_file"
  fi

  case "$name" in
    '' )
      echo "compose_project: no project: COMPOSE_PROJECT_NAME is not set and ${dir}/managed.yml has no \`name:\`" >&2
      return 1
      ;;
    [!a-z0-9]* | *[!a-z0-9_-]* )
      echo "compose_project: COMPOSE_PROJECT_NAME='${name}' is not a name Compose accepts: lowercase letters, digits, '-' and '_', starting with a letter or digit" >&2
      return 1
      ;;
  esac

  if [ "$name" = "$declared" ]; then
    # Inside a function BASH_SOURCE[0] is the file that defined it: this one.
    marker="$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || printf '%s' "${BASH_SOURCE[0]}")")/stack-kind.sh"
    marker_key="$(env_value "$marker" STACK_KIND_KEY)"
    marker_live="$(env_value "$marker" STACK_KIND_LIVE)"
    if [ -z "$marker_key" ] || [ -z "$marker_live" ]; then
      echo "compose_project: cannot read live's marker from ${marker}, so cannot tell live's .env from the one of '${name}'." >&2
      echo "  That file belongs beside managed.yml in every checkout: restore it (git checkout -- deploy/compose/stack-kind.sh)." >&2
      return 1
    fi
    if [ "$(stack_kind_clean "$(env_value "${dir}/.env" "$marker_key")")" = "$marker_live" ]; then
      echo "compose_project: ${dir}/.env carries ${marker_key}, live's marker, and its project comes out as '${name}', managed.yml's own name." >&2
      echo "  That is the OTA stack's project: live's .env would be brought up on the OTA stack's containers and volumes. Its value is not printed." >&2
      echo "  Set COMPOSE_PROJECT_NAME=ownpace-live in that .env (workplan 0132 T1b), and run this again." >&2
      return 1
    fi
  fi
  printf '%s' "$name"
}
