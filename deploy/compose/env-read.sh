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
