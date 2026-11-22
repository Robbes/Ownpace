#!/usr/bin/env bash
# job-runner.sh — the one reader of which runner the managed edition's jobs
# run on (workplan 0167 T7, ADR-0054). Sourced, never run.
#
# THE SWITCH. OWNPACE_JOB_RUNNER is `trigger` (self-hosted Trigger.dev, the
# eleven services of its plane) or `pg-boss` (the `worker` service, on our own
# Postgres). Unset or empty means managed.yml's default, and a managed.yml that
# gives none means `trigger`: alpha.14 and alpha.15 have no switch, and run
# Trigger.dev. Any other value is refused, in one sentence, before anything
# runs. The API, the worker, the E2E workflow and every script here read the
# same key; every script here reads it through this file, so there is one
# answer per checkout.
#
# READ AS COMPOSE READS IT, so the answer is what the containers get. A
# managed.yml that never names `${OWNPACE_JOB_RUNNER` gives its containers no
# switch: that release runs the plane when it carries Trigger.dev's image
# line, and the worker when it has a worker and no plane. Otherwise:
#   1. this shell's OWNPACE_JOB_RUNNER, when it is set and not empty (Compose
#      interpolates the shell's value over the .env's);
#   2. else the .env's line (env_value: the last one; one pair of surrounding
#      double quotes removed, as Compose and bash remove them);
#   3. else managed.yml's `${OWNPACE_JOB_RUNNER:-<default>}`, the way
#      db_roles_init reads compose's defaults; two different defaults in one
#      managed.yml are refused, since the services would disagree;
#   4. else `trigger`.
# The bring-up sources the .env with `set -a` in every phase, so from then on
# 1 and 2 are the same value.
#
#   job_runner_mode <compose-dir> [<env-file>]
#       sets JOB_RUNNER to `trigger` or `pg-boss` and returns 0, or sets
#       JOB_RUNNER_WHY to one sentence and returns 1. Prints nothing.
#   job_runner_mode_at <repo-root> <commit> [<env-file>]
#       the same, with the managed.yml that <commit> holds: the mode a tag's
#       own bring-up will run in after a checkout (deploy-live.sh).
#   job_runner_refuse_in_pg_boss <script> <what it does>
#       for a script that only means something to Trigger.dev: exits 1 with
#       one sentence when the mode is pg-boss, or cannot be read; returns 0 in
#       trigger mode. Needs SCRIPT_DIR, and ENV_FILE when it is not .env there.
#   job_runner_has_service <managed.yml text> <service>
#       true when that text defines the service at the top of `services:`.
#
# THE PLANE'S STOP ORDER (the plan's §6, block 4), for the bring-up in
# pg-boss mode: the supervisor first, so nothing new is dequeued; then, once
# no `runner-*` container is left on the stack's network, the rest in an
# order where nothing stopped is something a running one still needs. `stop`,
# never `rm -v`: the plane's volumes are the way back (OWNPACE_JOB_RUNNER=
# trigger, then the bring-up, starts it from them at the same version).
# minio-init and trigger-tls-init are one-shots, exited already.
#
# scripts/job-runner-mode.unit.test.ts runs every branch of this file.

JOB_RUNNER_KEY=OWNPACE_JOB_RUNNER
JOB_RUNNER_TRIGGER=trigger
JOB_RUNNER_PGBOSS=pg-boss
# shellcheck disable=SC2034 # read by the scripts that source this
JOB_RUNNER_PLANE_FIRST=(trigger-supervisor)
# shellcheck disable=SC2034
JOB_RUNNER_PLANE_REST=(trigger-api trigger-tls clickhouse trigger-registry trigger-docker-proxy minio trigger-redis trigger-db)
JOB_RUNNER=''
JOB_RUNNER_WHY=''

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

# job_runner_judge <value> <where it came from> — sets JOB_RUNNER, or WHY and 1.
job_runner_judge() {
  case "${1:-}" in
    "$JOB_RUNNER_TRIGGER" | "$JOB_RUNNER_PGBOSS")
      JOB_RUNNER="$1"
      return 0
      ;;
  esac
  JOB_RUNNER=''
  JOB_RUNNER_WHY="${JOB_RUNNER_KEY} in ${2} is neither ${JOB_RUNNER_TRIGGER} nor ${JOB_RUNNER_PGBOSS} (its value is not printed), so which runner the jobs run on cannot be said, and nothing has run."
  return 1
}

# job_runner_from <managed.yml text> <managed.yml's name> <env-file>
job_runner_from() {
  local text="${1:-}" where="${2:-managed.yml}" env_file="${3:-}" value default
  JOB_RUNNER_WHY=''
  # A managed.yml that never names the switch hands it to no container, so
  # that release runs the one runner it has, whatever the .env or the shell
  # says: the plane while it carries Trigger.dev's image line (alpha.14,
  # alpha.15), else the worker when it defines one (a release after the
  # plane's removal), else the plane.
  # shellcheck disable=SC2016 # the literal text of an interpolation
  if ! grep -qF '${OWNPACE_JOB_RUNNER' <<<"$text"; then
    # shellcheck disable=SC2016 # the literal text of an interpolation
    if grep -qF '${TRIGGER_IMAGE_TAG:-' <<<"$text" || ! job_runner_has_service "$text" worker; then
      JOB_RUNNER="$JOB_RUNNER_TRIGGER"
    else
      JOB_RUNNER="$JOB_RUNNER_PGBOSS"
    fi
    return 0
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
    JOB_RUNNER=''
    JOB_RUNNER_WHY="${where} gives ${JOB_RUNNER_KEY} two different defaults, so its services would not agree on which runner the jobs run on; nothing has run."
    return 1
  fi
  job_runner_judge "${default:-$JOB_RUNNER_TRIGGER}" "${where}'s default"
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

job_runner_refuse_in_pg_boss() { # job_runner_refuse_in_pg_boss <script> <what it does>
  local script="${1:-this script}" what="${2:-it only means something to Trigger.dev}"
  if ! job_runner_mode "$SCRIPT_DIR" "${ENV_FILE:-${SCRIPT_DIR}/.env}"; then
    echo "[${script}] refused: ${JOB_RUNNER_WHY}" >&2
    exit 1
  fi
  if [ "$JOB_RUNNER" = "$JOB_RUNNER_PGBOSS" ]; then
    echo "[${script}] refused: this stack's jobs run on pg-boss (${JOB_RUNNER_KEY}=${JOB_RUNNER_PGBOSS}), and ${what}; its plane is stopped and nothing here starts it (workplan 0167). Nothing was changed." >&2
    exit 1
  fi
  return 0
}
