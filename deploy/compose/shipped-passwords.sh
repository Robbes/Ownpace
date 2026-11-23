#!/usr/bin/env bash
# shipped-passwords.sh — the database passwords this repository publishes,
# named once (workplan 0132 T2).
#
# A VALUE IN A PUBLIC REPOSITORY IS NOT A PASSWORD. Each value below was given
# to a stack at some point:
#
#   compose's defaults     managed.yml's ${KEY:-…}, which a container gets when
#                          .env leaves the key empty;
#   the migration's        0001_baseline.sql creates app_user with it, when the
#                          role does not exist yet;
#   the example's          what managed.env.example carried until 2026-10-05.
#                          A .env copied from it may hold them still. The
#                          example now ships the keys below empty, and
#                          ensure-env-secrets.sh generates them.
#
# Sourced, never run, by every script that judges one of these values:
#
#   rotate-db-passwords.sh   --check tries each against the roles and stores
#   bootstrap-managed.sh     load_env refuses them on a real address, and
#                            notes them on localhost (a developer's own stack)
#   ensure-env-secrets.sh    generates a key that is empty or holds one, while
#                            the key's volume does not exist; refuses once it does
#   stand-up-live.sh         generates them for live's new volumes
#
# scripts/a-password-the-repository-knows.unit.test.ts reads managed.yml's
# defaults and the migration's literal from their own files, fails when one is
# missing here, and fails when one of the scripts above spells a value itself.
#
# TRIGGER.DEV'S THREE WENT WITH IT (alpha.18, workplan 0167 T9): ClickHouse's,
# MinIO's and trigger-db's passwords, which were three of the five from
# 2026-10-05 (0132 T2, step B). Their stores are no longer in managed.yml.

# Postgres: tried against every login role among the owner, app_user,
# openmigrate and APP_DB_USER (rotate-db-passwords.sh --check).
SHIPPED_PG=(app_password openmigrate_password change-me-openmigrate)
SHIPPED_PG_FROM=("the migration's default" "compose's default" "the example's value")

# The keys the bring-up refuses on a real address and ensure-env-secrets.sh
# generates, each with the volume whose existence ends that: "KEY volume".
# Postgres reads its password when its volume is first initialised, and keeps
# it. On a stack whose volume exists, a new value goes through
# rotate-db-passwords.sh --rotate, which sets the roles. stand-up-live.sh
# keeps a list of its own with the same keys (PASSWORDS);
# a-password-the-repository-knows.unit.test.ts holds the two equal.
SHIPPED_PASSWORD_KEYS=(
  'POSTGRES_PASSWORD postgres_data'
  'APP_DB_PASSWORD postgres_data'
)

# shipped_password <value> — 0 when the value is one this repository
# publishes: empty (compose's default then applies), a change-me… value, or one
# listed above. Compare the value as Compose reads it: without surrounding
# double quotes (shipped_password_bare).
shipped_password() {
  local value="${1:-}" known
  case "$value" in
    '' | change-me* | changeme*) return 0 ;;
  esac
  for known in "${SHIPPED_PG[@]}"; do
    [ "$value" = "$known" ] && return 0
  done
  return 1
}

# shipped_password_bare <value> — the value without one pair of surrounding
# double quotes. env_value keeps them; Compose and bash do not, so `KEY=""` is
# empty to both.
shipped_password_bare() {
  local value="${1:-}"
  if [ "${#value}" -ge 2 ] && [ "${value:0:1}" = '"' ] && [ "${value: -1}" = '"' ]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}
