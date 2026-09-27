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
# reader Compose's own values go through (env-read.sh), and compared without
# regard to case, so `Production` is live as well. A refusal errs towards live.
#
# Usage:  . "${SCRIPT_DIR}/stack-kind.sh"
#         if stack_is_live "$ENV_FILE"; then …refuse…; fi

STACK_KIND_KEY=STACK_KIND
STACK_KIND_LIVE=production

# env_value, from the one reader of a compose .env.
# shellcheck source=deploy/compose/env-read.sh
. "$(dirname "${BASH_SOURCE[0]}")/env-read.sh"

# stack_kind <env-file> — the marker's value in that file, in lower case, or
# nothing when the file does not carry the key.
stack_kind() {
  local value
  value="$(env_value "${1:-}" "$STACK_KIND_KEY")"
  # A double-quoted value is live too: env_value strips single quotes only,
  # and a refusal must not hinge on which quotes somebody typed.
  value="${value#\"}"
  value="${value%\"}"
  printf '%s' "${value,,}"
}

# stack_is_live <env-file> — true when that file carries live's marker.
stack_is_live() {
  [ "$(stack_kind "${1:-}")" = "$STACK_KIND_LIVE" ]
}
