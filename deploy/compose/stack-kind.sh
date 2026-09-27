#!/usr/bin/env bash
# stack-kind.sh — the one place live's marker is named (workplan 0132 T1g,
# 0143 T9).
#
# TWO STACKS SHARE THE REFERENCE MACHINE. The OTA stack is the demo and the
# nightly gate's target, rebuilt from `main` every night. `ownpace-live` holds
# testers' data and moves only by hand, from a tag (0132 D7). Several scripts
# have to tell them apart before they write anything:
#
#   rehearse-capacity.sh        refuses live: rehearsal organisations never
#                               reach the stack testers use (0143 T9, built)
#   the managed gate            refuses a restored .env that is live's, before
#                               it writes to it (0132 T1g, not built yet)
#   bootstrap-managed.sh        refuses --with-demo on live (0132 T5, not
#                               built yet)
#   deploy-live.sh              refuses a .env WITHOUT the marker (0132 T6, not
#                               built yet)
#
# Each of them reads the marker's name from here, so it is spelled once. Live's
# .env carries the line
#
#   STACK_KIND=production
#
# and the OTA stack's does not carry the key at all. The value says what the
# stack holds: people's data. It is read from the .env FILE, with the same
# reader Compose's own values go through (env-read.sh). Surrounding whitespace,
# double quotes and case make no difference, so `"Production "` is live too.
#
# TWO QUESTIONS, TWO ANSWERS. A refusal and a permission need different ones.
#
#   stack_is_live       exactly live's marker. For a check that must FIND it
#                       before going on: deploy-live.sh (0132 T6).
#   stack_may_be_live   live's marker, or anything that could be a slip of it:
#                       any value that is not a kind listed below as not live,
#                       and a line naming the key that the reader cannot read
#                       (indented, or with spaces around `=`). For a REFUSAL,
#                       which errs towards live: the rehearsal, the gate, and
#                       --with-demo.
#
# Usage:  . "${SCRIPT_DIR}/stack-kind.sh"
#         if stack_may_be_live "$ENV_FILE"; then …refuse…; fi

STACK_KIND_KEY=STACK_KIND
STACK_KIND_LIVE=production
# The kinds known NOT to be live. None yet: the OTA stack's .env does not carry
# the key. A kind given to the OTA stack later goes here, or every refusal
# takes it for live's.
STACK_KINDS_NOT_LIVE=()

# env_value, from the one reader of a compose .env.
# shellcheck source=deploy/compose/env-read.sh
. "$(dirname "${BASH_SOURCE[0]}")/env-read.sh"

# stack_kind_clean <value> — a value of the marker as it is compared: without
# surrounding whitespace or double quotes, in lower case. For a value that did
# not come from a file, such as one exported into a shell.
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

# stack_kind <env-file> — the marker's value in that file, cleaned, or nothing
# when the file does not carry the key (or carries it empty).
stack_kind() {
  stack_kind_clean "$(env_value "${1:-}" "$STACK_KIND_KEY")"
}

# stack_is_live <env-file> — true when that file carries exactly live's marker.
stack_is_live() {
  [ "$(stack_kind "${1:-}")" = "$STACK_KIND_LIVE" ]
}

# stack_kind_may_be_live <cleaned value> — true for any value but nothing and
# the kinds known not to be live.
stack_kind_may_be_live() {
  local kind="${1:-}" known
  [ -n "$kind" ] || return 1
  for known in ${STACK_KINDS_NOT_LIVE[@]+"${STACK_KINDS_NOT_LIVE[@]}"}; do
    [ "$kind" = "$known" ] && return 1
  done
  return 0
}

# stack_may_be_live <env-file> — true when that file carries live's marker or
# something that could be a slip of it (the header says which).
stack_may_be_live() {
  local file="${1:-}"
  stack_kind_may_be_live "$(stack_kind "$file")" && return 0
  # The key on a line env_value does not read. Only its presence is asked
  # here, never its value: that stays env_value's.
  [ -f "$file" ] || return 1
  awk -v k="$STACK_KIND_KEY" '
    $0 ~ ("^[[:space:]]*(export[[:space:]]+)?" k "[[:space:]]*=") && $0 !~ ("^(export[[:space:]]+)?" k "=") { found = 1 }
    END { exit found ? 0 : 1 }' "$file"
}
