#!/usr/bin/env bash
# refuse-live-env.sh — the nightly managed gate never restores live's .env
# (workplan 0132 T1g).
#
# The gate restores the OTA stack's .env from the directory
# MANAGED_ENV_PERSIST_DIR names (default ~/.persistent/<project>), and then
# writes to it: ensure-env-secrets.sh fills what is missing, the backfill adds
# the example's defaults and its placeholder client pairs, and the copy-back
# writes the result into that directory again. Live's directory sits beside the
# OTA stack's on the same machine, and live's checkout links to the .env in it.
# A repository variable pointed there by mistake would have had the gate write
# into live's .env, and bring up the demo on the project it names.
#
# So the gate asks this about the persisted file before it copies anything out
# of that directory. It refuses a file carrying live's marker or anything that
# could be a slip of it (stack_may_be_live, stack-kind.sh: the marker is named
# once, there). It names the key and never a value: the gate's log is public.
#
# Its advice follows MANAGED_ENV_PERSIST_DIR. The workflow always exports it,
# empty when the repository variable is absent, so a non-empty value is what
# tells, not whether it is set. Empty, the refused file is the workflow's own
# default, the OTA stack's directory, and the variable is not the thing to fix.
#
# Usage:  refuse-live-env.sh <env-file>
#   exit 0   the file does not carry live's marker
#   exit 1   it does, or could: refused
#   exit 2   no file named, or no such file
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Live's marker, named once.
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"

ENV_FILE="${1:-}"
if [ "$#" -ne 1 ] || [ -z "$ENV_FILE" ]; then
  echo "usage: refuse-live-env.sh <env-file>" >&2
  exit 2
fi
if [ ! -f "$ENV_FILE" ]; then
  # Asked about a file that is not there, it says so rather than "not live".
  echo "refuse-live-env.sh: ${ENV_FILE} not found" >&2
  exit 2
fi

if stack_may_be_live "$ENV_FILE"; then
  echo "::error::refused: ${ENV_FILE} has a ${STACK_KIND_KEY} line, live's marker or a slip of it (workplan 0132 T1g). Its value is not printed." >&2
  if [ -n "${MANAGED_ENV_PERSIST_DIR:-}" ]; then
    echo "That is the .env of the stack testers use, and this gate never restores it, writes to it or brings a stack up from it. Nothing was copied." >&2
    echo "MANAGED_ENV_PERSIST_DIR points at live's directory. Point it back at the OTA stack's (Settings -> Secrets and variables -> Actions -> Variables), or delete the variable: this workflow's own default is the OTA stack's directory." >&2
  else
    echo "MANAGED_ENV_PERSIST_DIR is not set, so this is the OTA stack's own directory, and its .env carries the key. Nothing was copied." >&2
    echo "Take that line out of it. If the OTA stack was given a kind of its own, list that kind in STACK_KINDS_NOT_LIVE (deploy/compose/stack-kind.sh) instead." >&2
  fi
  exit 1
fi
