#!/usr/bin/env bash
# job-runner.sh — the one reader of which runner the managed edition's jobs
# run on (workplan 0167 T7 and T9, ADR-0054). Sourced, never run.
#
# THE SWITCH. OWNPACE_JOB_RUNNER names the runner: `pg-boss` (the `worker`
# service, on our own Postgres), the only one since alpha.18. Unset or empty
# means managed.yml's default, `pg-boss`. `trigger`, self-hosted Trigger.dev,
# was the way back from alpha.16 to alpha.17; alpha.18 removed it, so an old
# .env that still says so is refused, in one sentence that says to remove the
# key, never ignored. Any other value is refused too. The API, the worker and
# every script here read the same key and refuse the same values; every script
# here reads it through this file, so there is one answer per checkout.
#
# READ AS COMPOSE READS IT, so the answer is what the containers get:
#   1. this shell's OWNPACE_JOB_RUNNER, when it is set and not empty (Compose
#      interpolates the shell's value over the .env's);
#   2. else the .env's line (env_value: the last one; one pair of surrounding
#      double quotes removed, as Compose and bash remove them);
#   3. else managed.yml's `${OWNPACE_JOB_RUNNER:-<default>}`; two different
#      defaults in one managed.yml are refused, since the services would
#      disagree;
#   4. else `pg-boss`.
#
#   job_runner_mode <compose-dir> [<env-file>]
#       sets JOB_RUNNER to `pg-boss` and returns 0, or sets JOB_RUNNER_WHY to
#       one sentence and returns 1. Prints nothing.
#   job_runner_mode_at <repo-root> <commit> [<env-file>]
#       the same, with the managed.yml that <commit> holds: the mode a tag's
#       own bring-up will run in after a checkout (deploy-live.sh). A tag from
#       before alpha.16 has no switch and runs Trigger.dev; it is refused,
#       since its bring-up would start a plane this checkout no longer has.
#   job_runner_has_service <managed.yml text> <service>
#       true when that text defines the service at the top of `services:`.
#
# scripts/job-runner-mode.unit.test.ts runs every branch of this file.

JOB_RUNNER_KEY=OWNPACE_JOB_RUNNER
# shellcheck disable=SC2034 # read by the scripts that source this
JOB_RUNNER_PGBOSS=pg-boss
# The value alpha.18 refuses: Trigger.dev, removed (workplan 0167 T9).
JOB_RUNNER_REMOVED=trigger
JOB_RUNNER=''
JOB_RUNNER_WHY=''
# Where the answer came from, in words, for the line a script says it in:
# "this shell's environment", "<env-file>", or "<managed.yml>'s default".
JOB_RUNNER_FROM=''

# env_value, for the .env's line, unless the caller has it already. SCRIPT_DIR
# is the caller's.
if ! declare -F env_value >/dev/null; then
  # shellcheck source=deploy/compose/env-read.sh
  . "${SCRIPT_DIR}/env-read.sh"
fi

# job_runner_default_in <managed.yml text> — the default, or nothing; 1 when
# the text gives two different ones.
job_runner_default_in() {
  local found
  found="$(grep -oE '\$\{OWNPACE_JOB_RUNNER:-[^}]*\}' <<<"${1:-}")" || return 0
  found="$(sed 's/^[^-]*:-//; s/}$//' <<<"$found" | sort -u)"
  [[ "$found" != *$'\n'* ]] || return 1
  printf '%s' "$found"
}

# job_runner_judge <value> <where it came from> — sets JOB_RUNNER and
# JOB_RUNNER_FROM, or WHY and 1.
job_runner_judge() {
  JOB_RUNNER=''
  JOB_RUNNER_FROM=''
  case "${1:-}" in
    "$JOB_RUNNER_PGBOSS")
      JOB_RUNNER="$1"
      # shellcheck disable=SC2034 # read by the scripts that source this
      JOB_RUNNER_FROM="${2:-}"
      return 0
      ;;
    "$JOB_RUNNER_REMOVED")
      JOB_RUNNER_WHY="${JOB_RUNNER_KEY} in ${2} is ${JOB_RUNNER_REMOVED}, but Trigger.dev was removed in alpha.18, so remove the key from the .env or set it to ${JOB_RUNNER_PGBOSS}; nothing has run."
      return 1
      ;;
  esac
  JOB_RUNNER_WHY="${JOB_RUNNER_KEY} in ${2} is not ${JOB_RUNNER_PGBOSS} (its value is not printed), so which runner the jobs run on cannot be said, and nothing has run."
  return 1
}

# job_runner_from <managed.yml text> <managed.yml's name> <env-file>
job_runner_from() {
  local text="${1:-}" where="${2:-managed.yml}" env_file="${3:-}" value default
  JOB_RUNNER_WHY=''
  JOB_RUNNER_FROM=''
  JOB_RUNNER=''
  # A managed.yml that never names the switch is a release from before
  # alpha.16, which runs Trigger.dev's plane and nothing else.
  # shellcheck disable=SC2016 # the literal text of an interpolation
  if ! grep -qF '${OWNPACE_JOB_RUNNER' <<<"$text"; then
    JOB_RUNNER_WHY="${where} names no ${JOB_RUNNER_KEY}: it is a release from before alpha.16, whose jobs run on Trigger.dev, which this checkout removed (alpha.18); nothing has run."
    return 1
  fi
  if [ -n "${OWNPACE_JOB_RUNNER:-}" ]; then
    job_runner_judge "$OWNPACE_JOB_RUNNER" "this shell's environment"
    return
  fi
  value="$(env_value "$env_file" "$JOB_RUNNER_KEY")"
  if [ "${#value}" -ge 2 ] && [ "${value:0:1}" = '"' ] && [ "${value: -1}" = '"' ]; then
    value="${value:1:${#value}-2}"
  fi
  if [ -n "$value" ]; then
    job_runner_judge "$value" "${env_file}"
    return
  fi
  if ! default="$(job_runner_default_in "$text")"; then
    JOB_RUNNER_WHY="${where} gives ${JOB_RUNNER_KEY} two different defaults, so its services would not agree on which runner the jobs run on; nothing has run."
    return 1
  fi
  job_runner_judge "${default:-$JOB_RUNNER_PGBOSS}" "${where}'s default"
}

job_runner_mode() { # job_runner_mode <compose-dir> [<env-file>]
  local dir="${1:-$SCRIPT_DIR}"
  job_runner_from "$(cat "${dir}/managed.yml" 2>/dev/null)" "${dir}/managed.yml" "${2:-${dir}/.env}"
}

job_runner_mode_at() { # job_runner_mode_at <repo-root> <commit> [<env-file>]
  local text
  text="$(git -C "${1:-.}" show "${2:-HEAD}:deploy/compose/managed.yml" 2>/dev/null)" || text=''
  job_runner_from "$text" "managed.yml at ${2:-HEAD}" "${3:-}"
}

job_runner_has_service() { # job_runner_has_service <managed.yml text> <service>
  local name="${2:-}"
  awk -v want="  ${name}:" '
    /^services:/ { in_services = 1; next }
    /^[^[:space:]#]/ { in_services = 0 }
    in_services && $0 == want { found = 1 }
    END { exit found ? 0 : 1 }' <<<"${1:-}"
}
