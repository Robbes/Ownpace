#!/usr/bin/env bash
# remove-trigger-plane.sh — what Trigger.dev's plane left on this machine,
# removed by name, once, on the owner's word (workplan 0167 T9, ADR-0054).
#
# WHY. alpha.16 stopped the plane and kept it, in profile `trigger`, as the way
# back (OWNPACE_JOB_RUNNER=trigger). alpha.18 removed it from managed.yml: its
# eleven services, three networks and ten volumes. The bring-up's plane phase
# removes the stopped containers (they are orphans of a managed.yml that no
# longer names them). Compose never removes a volume a file stops declaring,
# and this bring-up never runs `down -v`, so the volumes stay until something
# removes them by name. This is that something. Run it once per stack, after
# the stack runs alpha.18 or later and its jobs are proven on pg-boss. It is
# ONE WAY: the volumes hold Trigger.dev's database, its event store, its object
# store, its task images and its TLS front's certificate, and nothing brings
# them back. alpha.16 and alpha.17 do not need them: they run their jobs on
# pg-boss and leave the plane stopped.
#
#   ./deploy/compose/remove-trigger-plane.sh          says what it would remove; removes nothing
#   ./deploy/compose/remove-trigger-plane.sh --yes    removes it
#   ./deploy/compose/remove-trigger-plane.sh --list   the plane's volumes still here, one a line
#
# WHAT, for this checkout's project (COMPOSE_PROJECT_NAME, else managed.yml's
# `name:`; compose_project in env-read.sh), every name built from it:
#
#   volumes   <project>_trigger_db_data     Trigger.dev's database (triggerdb)
#             <project>_redis_data          its Redis
#             <project>_trigger_shared      the worker token it shared with the supervisor
#             <project>_registry_data       the task images
#             <project>_minio_data_v2       its object store (Chainguard's MinIO)
#             <project>_minio_data          the Bitnami-era object store, undeclared since 0146 T7
#             <project>_trigger_tls_data    the dashboard's TLS front: its CA and certificate
#             <project>_trigger_tls_config  the same front's configuration
#             <project>_clickhouse_data_v2  its event store
#             <project>_clickhouse_data     the Bitnami-era event store
#             <project>_clickhouse_logs     the event store's logs
#   networks  <project>_trigger-event-store, <project>_trigger-docker-socket,
#             <project>_trigger-task-images
#
# Each one that exists is removed with `docker volume rm` or `docker network
# rm`, by that name and no other; one that does not is said and passed by, so
# a second run removes nothing and says so. Nothing else is touched: no other
# volume of the project, no container, no image.
#
# IT REFUSES, before it removes anything:
#   a value of OWNPACE_JOB_RUNNER this checkout refuses (`trigger` among them:
#       job-runner.sh), or a managed.yml that still defines a plane service
#       (a checkout from before alpha.18: its bring-up would want them);
#   a container of the plane still on the stack, running or stopped: the
#       bring-up's plane phase removes them first
#       (./deploy/compose/bootstrap-managed.sh --only plane).
#
# On live this is the owner's step, pasted once live's deploy of alpha.18 has
# taken and its jobs are proven on pg-boss (docs/managed-bring-up.md,
# "Trigger.dev's plane, removed"). The copy before an update holds none of
# these volumes. On the OTA stack the gate, E2E (managed), runs it once with
# --yes after its bring-up. scripts/a-plane-removed.unit.test.ts runs it
# against a docker stand-in.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# shellcheck source=deploy/compose/job-runner.sh
. "${SCRIPT_DIR}/job-runner.sh"
ENV_FILE="${SCRIPT_DIR}/.env"

# The plane, as alpha.17's managed.yml declared it.
PLANE_SERVICES=(trigger-supervisor trigger-api trigger-tls trigger-tls-init clickhouse trigger-registry
  trigger-docker-proxy minio minio-init trigger-redis trigger-db)
PLANE_VOLUMES=(trigger_db_data redis_data trigger_shared registry_data minio_data_v2 minio_data
  trigger_tls_data trigger_tls_config clickhouse_data_v2 clickhouse_data clickhouse_logs)
PLANE_NETWORKS=(trigger-event-store trigger-docker-socket trigger-task-images)

say() { printf '[remove-trigger-plane] %s\n' "$@"; }
refuse() {
  printf '[remove-trigger-plane] refused: %s\n' "$1" >&2
  shift
  [ "$#" -eq 0 ] || printf '  %s\n' "$@" >&2
  [ -n "${REMOVING:-}" ] || printf '[remove-trigger-plane] Nothing was removed.\n' >&2
  exit 1
}

MODE=show
case "${1:-}" in
  '') ;;
  --yes) MODE=yes ;;
  --list) MODE=list ;;
  -h | --help) sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed '$d'; exit 0 ;;
  *) printf 'usage: ./deploy/compose/remove-trigger-plane.sh [--yes | --list]\n' >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { printf 'usage: ./deploy/compose/remove-trigger-plane.sh [--yes | --list]\n' >&2; exit 2; }

# The stack comes from this checkout, never from the shell (env-read.sh).
COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || exit 1

# volume_here <name> / network_here <name> — 0 there, 1 not, 2 cannot tell.
volume_here() {
  local out
  out="$(docker volume inspect --format '{{.Name}}' "$1" 2>&1)" && return 0
  [[ "$out" == *"no such volume"* || "$out" == *"No such volume"* ]] && return 1
  WHY="$out"
  return 2
}
network_here() {
  local out
  out="$(docker network inspect --format '{{.Name}}' "$1" 2>&1)" && return 0
  [[ "$out" == *"not found"* || "$out" == *"No such network"* || "$out" == *"no such network"* ]] && return 1
  WHY="$out"
  return 2
}

WHY=''
VOLUMES_HERE=()
NETWORKS_HERE=()
for v in "${PLANE_VOLUMES[@]}"; do
  rc=0
  volume_here "${COMPOSE_PROJECT}_${v}" || rc=$?
  case "$rc" in
    0) VOLUMES_HERE+=("${COMPOSE_PROJECT}_${v}") ;;
    1) ;;
    *) refuse "Docker could not say whether the volume ${COMPOSE_PROJECT}_${v} is here: ${WHY}" ;;
  esac
done

if [ "$MODE" = list ]; then
  [ "${#VOLUMES_HERE[@]}" -eq 0 ] || printf '%s\n' "${VOLUMES_HERE[@]}"
  exit 0
fi

for n in "${PLANE_NETWORKS[@]}"; do
  rc=0
  network_here "${COMPOSE_PROJECT}_${n}" || rc=$?
  case "$rc" in
    0) NETWORKS_HERE+=("${COMPOSE_PROJECT}_${n}") ;;
    1) ;;
    *) refuse "Docker could not say whether the network ${COMPOSE_PROJECT}_${n} is here: ${WHY}" ;;
  esac
done

# THE CHECKOUT RUNS WITHOUT THE PLANE, and its switch says pg-boss.
job_runner_mode "$SCRIPT_DIR" "$ENV_FILE" || refuse "$JOB_RUNNER_WHY"
for svc in "${PLANE_SERVICES[@]}"; do
  if job_runner_has_service "$(cat "${SCRIPT_DIR}/managed.yml" 2>/dev/null)" "$svc"; then
    refuse "${SCRIPT_DIR}/managed.yml still defines ${svc}: this checkout is from before alpha.18, whose bring-up keeps the plane's volumes as the way back."
  fi
done

# NO CONTAINER OF THE PLANE LEFT: a volume in use is not removed, and one a
# stopped container still names would come back with it.
left=''
for svc in "${PLANE_SERVICES[@]}"; do
  ids="$(docker ps -a --filter "label=com.docker.compose.project=${COMPOSE_PROJECT}" \
    --filter "label=com.docker.compose.service=${svc}" --format '{{.Names}}')" ||
    refuse "Docker could not list the containers of ${svc} (above)."
  [ -z "$ids" ] || left="${left}${left:+, }${ids//$'\n'/, }"
done
if [ -n "$left" ]; then
  refuse "containers of the plane are still on ${COMPOSE_PROJECT}: ${left}." \
    "The bring-up's plane phase removes them first: ./deploy/compose/bootstrap-managed.sh --only plane. Then run this again."
fi

if [ "${#VOLUMES_HERE[@]}" -eq 0 ] && [ "${#NETWORKS_HERE[@]}" -eq 0 ]; then
  say "nothing of Trigger.dev's plane is left on ${COMPOSE_PROJECT}: none of its ${#PLANE_VOLUMES[@]} volumes or ${#PLANE_NETWORKS[@]} networks is here. Nothing to remove."
  exit 0
fi

if [ "$MODE" = show ]; then
  say "on ${COMPOSE_PROJECT}, with --yes, this removes, one way:"
  [ "${#VOLUMES_HERE[@]}" -eq 0 ] || printf '    volume  %s\n' "${VOLUMES_HERE[@]}"
  [ "${#NETWORKS_HERE[@]}" -eq 0 ] || printf '    network %s\n' "${NETWORKS_HERE[@]}"
  say "Nothing was removed. Run it again with --yes to remove them."
  exit 0
fi

REMOVING=1
for v in ${VOLUMES_HERE[@]+"${VOLUMES_HERE[@]}"}; do
  docker volume rm "$v" >/dev/null || refuse "docker volume rm ${v} failed (above). Volumes before it in the list are removed; it and those after it are not."
  say "removed the volume ${v}"
done
for n in ${NETWORKS_HERE[@]+"${NETWORKS_HERE[@]}"}; do
  docker network rm "$n" >/dev/null || refuse "docker network rm ${n} failed (above). Every volume is removed already."
  say "removed the network ${n}"
done
say "Trigger.dev's plane is gone from ${COMPOSE_PROJECT}: ${#VOLUMES_HERE[@]} volume(s) and ${#NETWORKS_HERE[@]} network(s) removed (workplan 0167 T9)."
