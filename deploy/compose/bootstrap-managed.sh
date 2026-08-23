#!/usr/bin/env bash
# bootstrap-managed.sh — bring up the managed edition on a fresh machine.
#
# WHAT THIS IS FOR. The managed stack has been brought up by hand, from notes,
# more than once, and each time the notes were a little out of date. This is
# those notes as a program: every step that a machine can do, done; every step
# that genuinely needs a person, STOPPED at, with the exact thing to click and
# the exact command to resume. Nothing is left as "and then configure Trigger".
#
# WHAT IT CANNOT DO, STATED UP FRONT. The self-hosted Trigger.dev webapp signs
# you in by magic link and has no admin API, so creating the account,
# organisation and project is a human step and there is no version of this
# script that removes it. What the script does instead is make it the ONLY
# one: it finds the magic link for you (trigger-magic-link.sh), and it reads
# the project ref and production key back out of the instance afterwards
# (trigger-credentials.sh) rather than asking you to transcribe them.
#
# IDEMPOTENT AND RESUMABLE. Every phase checks whether it is already done. Run
# it again after a `git pull`, after a reboot, after fixing whatever it stopped
# on — it picks up rather than starts over. When a phase needs you, the script
# exits 2 (not 1: "your turn" is not a failure) and prints the resume command.
#
#   ./bootstrap-managed.sh                 run every phase, in order
#   ./bootstrap-managed.sh --from tasks    resume from a phase
#   ./bootstrap-managed.sh --only smoke    run exactly one phase
#   ./bootstrap-managed.sh --list          the phases, in order
#   ./bootstrap-managed.sh --with-demo     also provision the demo backend and
#                                          seed the two demo tenants — what a
#                                          demo box and the nightly managed
#                                          e2e need, and what a REAL deployment
#                                          must not have (it creates tenants
#                                          with fixed, published credentials)
#   ./bootstrap-managed.sh --no-smoke      stop before the live smoke
#   ./bootstrap-managed.sh --accept-defaults
#                                          do not stop after creating .env for
#                                          the first time — for a throwaway
#                                          demo box, where the shipped
#                                          passwords are the right answer
#
# The prose companion, with every dashboard screen written out and a failure
# table: docs/managed-bring-up.md. This script is the executable half of that
# document; neither is meant to be read without the other existing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml")

# What a log line looks like when it is reporting that something FAILED, across
# every image this stack runs: logfmt (Zitadel, Trigger.dev, Caddy), JSON, bare
# uppercase severities (Postgres `FATAL:`), Go panics, Node errors, Python
# tracebacks.
#
# Deliberately narrow. A pattern that also matched the word "error" anywhere
# would match Zitadel's own `verify` lines and half of Nextcloud's start-up, and
# a failure window the size of the log is a third copy of the log.
#
# Written with `[^A-Za-z]` rather than `[[:space:]]` so that the SAME string is
# a valid ERE for grep and a valid regex for the test that applies it to real
# captured log lines. A test that re-types the pattern tests its own copy.
FATAL_LINE_RE='level=(error|fatal)|"level":"(error|fatal)"|(^|[^A-Za-z])(FATAL|PANIC|ERROR)([^A-Za-z]|$)|panic:|(^|[ |])Error:|Traceback \(most recent call last\)'
# shellcheck source=trigger-cli-lib.sh
. "${SCRIPT_DIR}/trigger-cli-lib.sh"

PHASES=(preflight env data demo trigger account login app tasks smoke)
WITH_DEMO=0
NO_SMOKE=0
ACCEPT_DEFAULTS=0
FROM=""
ONLY=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --from) FROM="${2:?--from needs a phase name}"; shift 2 ;;
    --only) ONLY="${2:?--only needs a phase name}"; shift 2 ;;
    --with-demo) WITH_DEMO=1; shift ;;
    --no-smoke) NO_SMOKE=1; shift ;;
    --accept-defaults) ACCEPT_DEFAULTS=1; shift ;;
    --list) printf '%s\n' "${PHASES[@]}"; exit 0 ;;
    -h | --help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "bootstrap-managed.sh: unknown argument '$1' (try --help)" >&2; exit 1 ;;
  esac
done

known_phase() {
  local p
  for p in "${PHASES[@]}"; do [ "$p" = "$1" ] && return 0; done
  echo "bootstrap-managed.sh: no phase called '$1'. Phases: ${PHASES[*]}" >&2
  return 1
}
[ -n "$FROM" ] && known_phase "$FROM"
[ -n "$ONLY" ] && known_phase "$ONLY"

say() { echo; echo "=== [$1] $2"; }
note() { echo "    $*"; }
die() { echo "!!! $*" >&2; exit 1; }

# A phase that needs a person. Exit 2 rather than 1 so a wrapper (or the
# operator's own eye) can tell "waiting for you" from "broken", and always
# print how to carry on — the single most common way a half-finished bring-up
# becomes a re-done bring-up is not knowing where it stopped.
declare -a RESUME_ARGS=()
[ "$WITH_DEMO" -eq 1 ] && RESUME_ARGS+=(--with-demo)
[ "$NO_SMOKE" -eq 1 ] && RESUME_ARGS+=(--no-smoke)
[ "$ACCEPT_DEFAULTS" -eq 1 ] && RESUME_ARGS+=(--accept-defaults)
your_turn() { # your_turn <phase-to-resume-from>
  echo
  echo "--- Your turn. When you have done the above, carry on with:"
  local resume="./deploy/compose/bootstrap-managed.sh --from $1"
  [ "${#RESUME_ARGS[@]}" -gt 0 ] && resume="${resume} ${RESUME_ARGS[*]}"
  echo "      ${resume}"
  exit 2
}

env_get() { # env_get NAME — the value in force, i.e. the last one
  [ -f "$ENV_FILE" ] || return 0
  # `|| true` for the same reason as in ensure-env-secrets.sh: under
  # `set -o pipefail` a grep that finds nothing fails the whole pipeline, and
  # "this key is not set" is a normal answer, not an error.
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true
}

# Load .env for our own use. Only after the `env` phase has had a chance to
# create it, hence a function rather than a line at the top.
load_env() {
  [ -f "$ENV_FILE" ] || die "$ENV_FILE does not exist yet — run the 'env' phase first."
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a

  # Compose interpolates the WHOLE file before running any command, so ONE
  # `${VAR:?…}` with no value in .env breaks every compose call against
  # managed.yml — including ones that never touch the service that is missing
  # it. The resulting message names a service the operator was not thinking
  # about, which reads as "that service is broken" rather than "your .env is
  # incomplete". Seen live on the Spark, 2026-08-18: an `exec` into trigger-db
  # failed on pgbouncer's PGBOUNCER_AUTH_PASSWORD, and the honest reading of
  # that error was that Trigger.dev was down. It was not.
  #
  # So: check once, here, where every compose-using phase passes through, and
  # name the actual fix.
  local config_err
  if ! config_err="$("${COMPOSE[@]}" config -q 2>&1)"; then
    echo "!!! docker compose cannot read managed.yml:" >&2
    printf '%s\n' "$config_err" | sed 's/^/    /' >&2
    local var
    var="$(printf '%s\n' "$config_err" | grep -oE 'required variable [A-Za-z_][A-Za-z0-9_]*' | head -1 | awk '{print $3}')"
    if [ -n "$var" ]; then
      echo "!!! ${var} has no value in ${ENV_FILE}." >&2
      echo "!!! This breaks EVERY compose command, not just the service named above." >&2
      echo "!!! Generate the missing secrets (idempotent — it rotates nothing):" >&2
      echo "!!!   ./deploy/compose/ensure-env-secrets.sh" >&2
      if [ "$var" = "PGBOUNCER_AUTH_PASSWORD" ]; then
        echo "!!! then create the matching Postgres role and start the pooler:" >&2
        echo "!!!   ./deploy/compose/bootstrap-managed.sh --only data" >&2
      fi
    fi
    exit 1
  fi
}

# Bring services up, and on failure show WHY rather than the one line compose
# prints. `up --wait` reports `container X is unhealthy` and stops — which
# names the service and not the reason, and the reason is always in that
# container's own log. Waiting for somebody to think of `docker logs` is a
# minute of confusion per occurrence, every time, forever.
up_wait() { # up_wait <service> [service...]
  if "${COMPOSE[@]}" up -d --wait "$@"; then return 0; fi
  explain_failure "$@"
}

# The diagnosis half, separated from the `up` half so that a bring-up which
# cannot go through `up_wait` — the app services need `--build` and a GIT_SHA —
# can still reach it. It used to be inlined here, and the two calls that could
# not use the wrapper therefore had no diagnosis at all: E2E (managed) #39
# reported `ownpace-idp Restarting (1)` and not one word about why, because the
# zitadel bring-up added in #504 called compose directly.
explain_failure() { # explain_failure <service> [service...]
  echo >&2
  echo "!!! compose could not bring these up healthy: $*" >&2
  for svc in "$@"; do
    local state
    state="$("${COMPOSE[@]}" ps --format '{{.State}} {{.Health}}' "$svc" 2>/dev/null | tail -1)"
    # BOTH ENDS OF THE LOG, and the first half is the one that matters.
    # A misconfigured service says why at START-UP and then loops on the
    # consequence, so a `--tail 30` window shows thirty copies of the symptom
    # and none of the cause. That is not hypothetical: PgBouncer's
    # `could not open auth_file … Permission denied` sat one line above the
    # visible window for three rounds of debugging (Spark, 2026-08-18) while
    # the repeating authentication failures below it got all the attention.
    #
    # READ ONCE, PRINT TWICE, AND LET NEITHER PIPELINE KILL THE SCRIPT.
    #
    # `docker compose logs "$svc" | head -20` looks harmless and is not. `head`
    # closes the pipe after twenty lines; a container with a LONG log is still
    # writing, gets SIGPIPE, and under `set -euo pipefail` that failed pipeline
    # aborts the whole function — after the first window and before the second.
    #
    # E2E (managed) #40 is what that costs. The first twenty lines were
    # Zitadel's initialisation, which says nothing, and the run died there with
    # exit 255. The `last 20` window — where `PasswordComplexityPolicy.HasUpper`
    # was waiting on the fatal line — never printed, and neither did the pointer
    # to the failure table. The diagnosis cut itself off one line before the
    # answer.
    #
    # It had never bitten before because every container this ran on had a log
    # SHORTER than twenty lines, so `head` read to EOF and nothing was signalled.
    #
    # SLICED FROM AN ARRAY, NOT THROUGH A PIPE. `|| true` kept the SIGPIPE from
    # killing the function, but the pipe still fired and E2E (managed) #43 still
    # printed `bootstrap-managed.sh: line 203: printf: write error: Broken pipe`
    # into the middle of its own diagnosis. A window that cannot break does not
    # need forgiving.
    local full
    full="$("${COMPOSE[@]}" logs "$svc" 2>&1 || true)"
    local -a lines=()
    # `if`, not `[ … ] && mapfile`: under `set -e` an && list whose left side
    # fails is exempt only by a rule subtle enough that nobody should have to
    # know it to read a diagnosis.
    if [ -n "$full" ]; then mapfile -t lines <<<"$full"; fi
    local n=${#lines[@]}

    echo "!!! --- ${svc} (${state:-not running}) — ${n} log lines. FIRST 20 (start-up):" >&2
    if [ "$n" -eq 0 ]; then
      echo "    (this container produced no output at all — that IS the finding)" >&2
    else
      printf '    %s\n' "${lines[@]:0:20}" >&2
    fi
    if [ "$n" -gt 20 ]; then
      echo "!!! --- ${svc} — last 20:" >&2
      printf '    %s\n' "${lines[@]: -20}" >&2
    fi

    # THE THIRD WINDOW, AND ON A RESTARTING CONTAINER IT IS THE ONLY ONE THAT
    # CAN HOLD THE CAUSE.
    #
    # Both windows above assume the log has two interesting ends. A container
    # under `restart: unless-stopped` has neither: it fails, restarts, fails
    # again, and after a few minutes the head is the FIRST attempt's start-up
    # and the tail is the LATEST attempt's — with every failure in between.
    #
    # E2E (managed) #43 is what that costs. Zitadel's first attempt failed
    # part-way through `03_default_instance` at 12:59:57; twelve minutes and
    # some dozens of restarts later the tail showed 13:12:08 failing on
    # `Errors.Instance.Domain.AlreadyExists` — a CONSEQUENCE of the first
    # failure, reported as though it were the cause, which is what sent the
    # last four rounds of debugging at the database instead of at the reason.
    #
    # So: every line in the whole log that says something FAILED, oldest first.
    # In a crash loop the first one is the cause and the rest are its echoes.
    local -a errs=()
    if [ "$n" -gt 0 ]; then
      mapfile -t errs < <(grep -aE "$FATAL_LINE_RE" <<<"$full" || true)
    fi
    if [ "${#errs[@]}" -gt 0 ]; then
      echo "!!! --- ${svc} — ${#errs[@]} line(s) reporting a failure. THE FIRST 10, OLDEST FIRST:" >&2
      printf '    %s\n' "${errs[@]:0:10}" >&2
      echo "!!! ^ on a container that restarts, read the OLDEST of these. The newest" >&2
      echo "!!!   is what the first failure left behind, not what went wrong." >&2
    fi

    # A HALF-INITIALISED ZITADEL CANNOT RECOVER, AND LIES ABOUT WHY.
    #
    # `setup failed, skipping cleanup` is Zitadel saying it aborted a migration
    # and deliberately did NOT roll back what that migration had already
    # written. `03_default_instance` registers the instance domain BEFORE it
    # creates the first human, so a failure at the human — a password the
    # default complexity policy rejects, say — leaves the domain behind. Every
    # restart after that dies on the leftover unique constraint with
    # `Errors.Instance.Domain.AlreadyExists`, which names the leftover and
    # never the failure that left it.
    #
    # Naming the remedy here rather than only in the failure table because this
    # is the one failure in the stack where the visible error is reliably the
    # wrong one, and an operator who acts on it clears the database, watches the
    # same thing happen again, and has learned nothing.
    case "$full" in
      *'setup failed, skipping cleanup'*)
        echo "!!! ---" >&2
        echo "!!! ${svc} FAILED PART-WAY THROUGH ITS OWN SETUP and does not roll back." >&2
        echo "!!! Whatever it reports NOW is the leftover, not the cause. The cause is" >&2
        echo "!!! the OLDEST line in the failure window above." >&2
        echo "!!! Fix that first. The half-written state then has to be cleared by hand," >&2
        echo "!!! because dropping a database is not a thing a bring-up may decide to do:" >&2
        echo "!!!   ${COMPOSE[*]} rm -sf ${svc}" >&2
        echo "!!!   docker exec -i ownpace-db psql -U \"\$POSTGRES_USER\" -d postgres \\" >&2
        echo "!!!     -c 'DROP DATABASE zitadel WITH (FORCE)'" >&2
        echo "!!!   docker volume rm ownpace-managed_zitadel_machinekey" >&2
        ;;
    esac
  done
  echo "!!! docs/managed-bring-up.md has a failure table; the log above is the answer." >&2
  exit 1
}

# ---------------------------------------------------------------------------
phase_preflight() {
  say preflight "the tools this needs, and the one setting that cannot be fixed later"
  local missing=()
  for tool in docker node pnpm openssl curl; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  docker compose version >/dev/null 2>&1 || missing+=("docker compose (v2 plugin)")
  [ "${#missing[@]}" -eq 0 ] || die "missing: ${missing[*]}"
  docker info >/dev/null 2>&1 || die "the docker daemon is not reachable from this shell."
  note "docker, compose v2, node $(node -v), pnpm $(pnpm -v), openssl, curl"

  [ -d "${REPO_ROOT}/node_modules" ] ||
    die "dependencies are not installed — run: pnpm install --frozen-lockfile"

  # Disk. A managed stack is roughly ten images plus ClickHouse and MinIO
  # volumes; running out halfway through `up --build` leaves a stack that is
  # partly built and wholly confusing.
  local free_gb
  free_gb="$(df -Pk "${REPO_ROOT}" | awk 'NR==2 {print int($4/1024/1024)}')"
  if [ "${free_gb:-99}" -lt 15 ]; then
    note "WARNING: only ${free_gb}GB free. A full bring-up pulls and builds ~15GB."
  else
    note "${free_gb}GB free"
  fi
}

# ---------------------------------------------------------------------------
phase_env() {
  say env "deploy/compose/.env — created, secrets generated, arch pinned"
  local freshly_created=0
  if [ ! -f "$ENV_FILE" ]; then
    cp "${SCRIPT_DIR}/managed.env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    freshly_created=1
    note "created $ENV_FILE from managed.env.example"
  else
    note "$ENV_FILE already exists — left alone (existing values are never rotated)"
  fi

  "${SCRIPT_DIR}/ensure-env-secrets.sh"

  # DEPLOY_IMAGE_PLATFORM is the setting that cannot be fixed later without a
  # redeploy, and the one whose failure is worst: task images built for the
  # wrong architecture produce runners that die at exec in under a second with
  # AutoRemove deleting the evidence. managed.env.example ships linux/amd64,
  # so on an arm64 box the DEFAULT is wrong — this is not a hypothetical.
  # deploy-tasks.sh checks the same thing and refuses; here we fix it, because
  # here we are the thing that owns the file.
  if [ "${SKIP_PLATFORM_CHECK:-0}" != "1" ]; then
    local host_platform=""
    case "$(uname -m)" in
      x86_64) host_platform="linux/amd64" ;;
      aarch64 | arm64) host_platform="linux/arm64" ;;
    esac
    if [ -n "$host_platform" ]; then
      local configured
      configured="$(env_get DEPLOY_IMAGE_PLATFORM)"
      if [ "$configured" != "$host_platform" ]; then
        "${SCRIPT_DIR}/env-upsert.sh" "$ENV_FILE" "DEPLOY_IMAGE_PLATFORM=${host_platform}"
        note "DEPLOY_IMAGE_PLATFORM was '${configured:-unset}', this host is $(uname -m) — set to ${host_platform}"
      else
        note "DEPLOY_IMAGE_PLATFORM=${host_platform} matches this host"
      fi
    fi
  fi

  # The values a human must decide. Left as shipped they are not broken —
  # a localhost-only demo box works — so this reports rather than refuses.
  local placeholders=()
  local k
  for k in POSTGRES_PASSWORD APP_DB_PASSWORD CLICKHOUSE_PASSWORD MINIO_ROOT_PASSWORD NEXTCLOUD_ADMIN_PASSWORD; do
    case "$(env_get "$k")" in
      change-me* | app_password) placeholders+=("$k") ;;
    esac
  done
  if [ "${#placeholders[@]}" -gt 0 ]; then
    note "STILL AT THEIR SHIPPED DEFAULTS: ${placeholders[*]}"
    note "  Fine for a demo box on localhost. Not fine for anything a customer reaches."
    note "  Change them BEFORE the 'data' phase — changing POSTGRES_PASSWORD after"
    note "  the volume exists does not change the password inside it."
  fi

  local host
  host="$(env_get TRIGGER_TLS_HOST)"
  if [ "$host" = "localhost" ]; then
    note "TRIGGER_TLS_HOST=localhost — the dashboard will only be usable FROM this"
    note "  machine. To reach it from your laptop, set TRIGGER_TLS_HOST (and the"
    note "  https half of TRIGGER_APP_ORIGIN / TRIGGER_LOGIN_ORIGIN) to the address"
    note "  the browser actually uses, then re-run --from trigger."
  fi

  # The file has just been created, so NONE of the decisions above have been
  # made. Stop here rather than run straight on into `data` — which creates the
  # Postgres volume, after which changing POSTGRES_PASSWORD in this file
  # changes nothing at all, and the stack looks configured while failing to
  # authenticate. This is the one place a pause is worth more than momentum.
  if [ "$freshly_created" -eq 1 ] && [ "$ACCEPT_DEFAULTS" -eq 0 ]; then
    cat <<EOF

    ${ENV_FILE} has just been created. Read it before anything uses it —
    the passwords, the public URLs (CORS_ORIGIN / WEB_URL / API_URL), the
    prices in PRICING_* (integer CENTS), and TRIGGER_TLS_HOST are decisions,
    not defaults. docs/managed-bring-up.md, phase 2, says what each one costs.

    Edit it directly, or:
      ./deploy/compose/env-upsert.sh ${ENV_FILE} KEY=VALUE …

    Building a throwaway demo box where the shipped values are the right
    answer? Add --accept-defaults and this pause goes away.
EOF
    your_turn data
  fi
}

# ---------------------------------------------------------------------------
phase_data() {
  say data "postgres, the pooler's lookup role, pgbouncer"
  load_env

  up_wait postgres
  note "postgres healthy"

  # ORDER. pgbouncer's healthcheck authenticates as `pgbouncer_auth`, and that
  # role is created by setup-auth.sql — which needs postgres up. So on a fresh
  # box, bringing postgres and pgbouncer up together hangs at the healthcheck
  # with a message about a password, and the cause is a role that does not
  # exist yet. Between the two, always.
  local pw
  pw="$(env_get PGBOUNCER_AUTH_PASSWORD)"
  [ -n "$pw" ] || die "PGBOUNCER_AUTH_PASSWORD is empty — re-run the 'env' phase."
  # The password reaches the script as the GUC it actually reads. setup-auth.sql
  # takes it from `current_setting('my.pw')`, so PGOPTIONS sets it for the
  # session at connect — one mechanism, no ordering between a -c and a -f.
  "${COMPOSE[@]}" exec -T -e PGOPTIONS="-c my.pw=${pw}" postgres psql \
    -v ON_ERROR_STOP=1 \
    -U "${POSTGRES_USER:-openmigrate}" -d "${POSTGRES_DB:-openmigrate}" \
    -f - <"${SCRIPT_DIR}/pgbouncer/setup-auth.sql" >/dev/null
  note "pgbouncer_auth role + user_lookup() present (idempotent)"

  # pgbouncer.ini's auth_dbname is a literal — compose mounts that file
  # verbatim, so it cannot read POSTGRES_DB. A mismatch does not fail at
  # start-up; it fails later, as an authentication error naming a database
  # nobody configured. Check it here, where both values are in hand.
  local ini="${SCRIPT_DIR}/pgbouncer/pgbouncer.ini"
  local auth_db configured_db
  auth_db="$(grep -oE 'auth_dbname=[A-Za-z0-9_]+' "$ini" | head -1 | cut -d= -f2)"
  configured_db="${POSTGRES_DB:-openmigrate}"
  if [ -n "$auth_db" ] && [ "$auth_db" != "$configured_db" ]; then
    echo "!!! pgbouncer.ini runs auth_query in '${auth_db}', but POSTGRES_DB is '${configured_db}'." >&2
    echo "!!! pgbouncer_auth.user_lookup() only exists in the latter, so every login would fail." >&2
    echo "!!! Set them to the same value:" >&2
    echo "!!!   ${ini}            (auth_dbname=…)" >&2
    echo "!!!   ${ENV_FILE}       (POSTGRES_DB=…)" >&2
    exit 1
  fi

  # The pooler reads userlist.txt as a user that is not the one who wrote it.
  # Checked here rather than discovered as `no such user: pgbouncer_auth` after
  # an 80-second healthcheck timeout.
  local userlist="${SCRIPT_DIR}/pgbouncer/userlist.txt"
  if [ -f "$userlist" ] && [ ! "$(stat -c '%a' "$userlist" 2>/dev/null)" = "644" ]; then
    chmod 644 "$userlist"
    note "userlist.txt was not readable inside the container — set to 644 (see ensure-env-secrets.sh)"
  fi

  # RECREATE A POOLER THAT IS RUNNING BUT UNHEALTHY, rather than waiting on it.
  #
  # pgbouncer.ini is a bind mount and PgBouncer reads it once, at start-up. So
  # after a `git pull` that fixes the config, plain `up -d` does NOTHING: compose
  # sees an existing container whose spec has not changed, leaves it alone, and
  # waits on the same unhealthy process still running the OLD file. The fix
  # looks like it did not work, and the log shows the same error it showed
  # before — which is exactly what happened on the Spark, 2026-08-18, and cost a
  # round trip.
  #
  # Only when it is unhealthy: a pooler that is serving is left alone, because
  # recreating it drops every client connection for no reason.
  if [ "$("${COMPOSE[@]}" ps --format '{{.Health}}' pgbouncer 2>/dev/null | tail -1)" = "unhealthy" ]; then
    note "pgbouncer is running but unhealthy — recreating it so it re-reads pgbouncer.ini"
    "${COMPOSE[@]}" up -d --force-recreate --no-deps pgbouncer >/dev/null
  fi

  up_wait pgbouncer
  note "pgbouncer healthy, in transaction mode (auth_query in ${configured_db})"

  if [ "$WITH_DEMO" -eq 1 ]; then
    up_wait nextcloud
    note "nextcloud healthy (demo DAV backend)"
  fi
}

# ---------------------------------------------------------------------------
phase_demo() {
  if [ "$WITH_DEMO" -eq 0 ]; then
    say demo "skipped (pass --with-demo for a demo box or the nightly e2e)"
    return 0
  fi
  say demo "demo mail + DAV backends, and the two demo tenants"
  load_env

  "${SCRIPT_DIR}/setup-managed-demo.sh"

  # One implementation, in seed-managed.sh — which is also what a person runs
  # by hand, so the by-hand path and the scripted one cannot drift.
  "${SCRIPT_DIR}/seed-managed.sh"
  note "migrations applied and demo tenants seeded (idempotent)"
}

# ---------------------------------------------------------------------------
phase_trigger() {
  say trigger "the Trigger.dev plane"
  load_env

  # ONE VERSION NUMBER, TWO PLACES, AND THEY MUST AGREE (0018 T0).
  #
  # managed.yml runs the webapp and the supervisor at ${TRIGGER_IMAGE_TAG}, and
  # the deploy CLI runs at the @trigger.dev/sdk version in
  # apps/worker/package.json. Its own comment records this drifting twice
  # already, and the reason it matters is that "the 4.5.x family is
  # SDK-compatible" is a hope, not a deploy story.
  #
  # Checked rather than corrected: which way to reconcile is a judgement about
  # what to run, and the two directions have different consequences — bumping
  # the tag pulls images that may not exist yet, pinning the SDK back changes
  # what the tasks are built with. Naming both is the useful thing a script can
  # do here.
  local sdk_version tag_version
  sdk_version="$(node -p "require('${REPO_ROOT}/apps/worker/package.json').dependencies['@trigger.dev/sdk']")"
  tag_version="${TRIGGER_IMAGE_TAG:-v4.5.9}"
  if [ "${tag_version#v}" != "$sdk_version" ]; then
    echo "!!! Trigger.dev version drift (0018 T0):" >&2
    echo "!!!   images:  ${tag_version}   (TRIGGER_IMAGE_TAG, or managed.yml's default when unset)" >&2
    echo "!!!   SDK/CLI: ${sdk_version}   (apps/worker/package.json)" >&2
    echo "!!! These run the same protocol and are only compatible by coincidence when they differ." >&2
    echo "!!! Reconcile, in whichever direction you mean:" >&2
    echo "!!!   ./deploy/compose/env-upsert.sh ${ENV_FILE} TRIGGER_IMAGE_TAG=v${sdk_version}" >&2
    echo "!!!     then re-run this phase — the webapp and supervisor are recreated at the new tag" >&2
    echo "!!!   or pin @trigger.dev/sdk back to ${tag_version#v} in apps/worker/package.json" >&2
    echo "!!!     and pnpm install --frozen-lockfile" >&2
    exit 1
  fi
  note "Trigger.dev images and SDK agree at ${sdk_version}"
  # THE SUPERVISOR COMES UP LAST, AND NOT ONLY FOR ORDERING.
  #
  # trigger-api bootstraps a worker group and writes its token into the SHARED
  # volume (TRIGGER_BOOTSTRAP_WORKER_TOKEN_PATH). It writes it as **root, mode
  # 0600**. trigger-supervisor reads that same file as **node**, so on a FRESH
  # trigger_shared volume the supervisor cannot open its own credential:
  #
  #   Unable to read worker token from file: EACCES: permission denied,
  #   open '/home/node/shared/worker_token'
  #
  # and it crash-loops. That is not cosmetic — a stack without a supervisor
  # dequeues nothing, so every run sits EXECUTING forever while the rest of the
  # stack reports healthy. It only shows up on a fresh volume, which is exactly
  # when nobody is looking for it: first install, or after a `down -v`.
  #
  # Fixed by OWNERSHIP, not mode: the token is a credential, and root bypasses
  # permissions anyway, so chown lets the supervisor read it without making it
  # world-readable. Same failure shape as pgbouncer's userlist.txt — 0600 by one
  # uid, read by another — which is the second time this stack has been bitten
  # by a secret file whose writer and reader are different users.
  up_wait trigger-db trigger-redis clickhouse minio trigger-registry \
    trigger-docker-proxy trigger-api trigger-tls

  local waited=0
  until "${COMPOSE[@]}" exec -T -u 0 trigger-api \
          test -f /home/node/shared/worker_token >/dev/null 2>&1; do
    if [ "$waited" -ge 60 ]; then
      echo "!!! trigger-api has not written /home/node/shared/worker_token after ${waited}s." >&2
      echo "!!! The supervisor cannot start without it. Check that bootstrap is on:" >&2
      echo "!!!   docker logs trigger-api 2>&1 | grep -i bootstrap" >&2
      exit 1
    fi
    sleep 3
    waited=$((waited + 3))
  done
  "${COMPOSE[@]}" exec -T -u 0 trigger-api \
    chown node:node /home/node/shared/worker_token >/dev/null 2>&1 || true
  note "worker token present and readable by the supervisor"

  up_wait trigger-supervisor
  note "all Trigger.dev services healthy"
  note "dashboard: ${TRIGGER_APP_ORIGIN:-https://localhost:3443}  (api: ${TRIGGER_API_ORIGIN:-http://localhost:3090})"
}

# ---------------------------------------------------------------------------
phase_account() {
  say account "the account, organisation and project — the one human step"
  load_env

  # Already done? Then say so and move on. This is what makes re-running the
  # whole script after a reboot cost nothing.
  if [ -n "$(env_get TRIGGER_PROJECT_REF)" ] && [ -n "$(env_get TRIGGER_SECRET_KEY)" ]; then
    note "TRIGGER_PROJECT_REF and TRIGGER_SECRET_KEY are already in .env — nothing to do"
    return 0
  fi

  # Perhaps the project exists and only .env is behind (a re-clone, a rotated
  # file). Ask the instance before asking the person.
  local probe rc=0
  probe="$("${SCRIPT_DIR}/trigger-credentials.sh" --write 2>&1)" || rc=$?
  if [ "$rc" -eq 0 ]; then
    note "found an existing project on this instance and wrote its credentials to .env"
    "${COMPOSE[@]}" up -d api >/dev/null 2>&1 || true
    return 0
  fi
  # It failed. Show WHY before assuming the reason is "no project yet" — a
  # schema mismatch or an unreachable database says something quite different,
  # and swallowing it here is how an operator ends up creating a second project
  # to fix a problem that was never about projects.
  printf '%s\n' "$probe" | sed 's/^/    /'

  cat <<EOF

    This instance has no project yet. It cannot be created without you:
    the self-hosted dashboard signs in by magic link and has no admin API.

    1. Open  ${TRIGGER_APP_ORIGIN:-https://localhost:3443}
       It serves a SELF-SIGNED certificate. Accept the warning — this is the
       trigger-tls front, and it exists because the dashboard's session cookie
       is Secure in production mode, so plain http works only from localhost.

    2. Type the email address the account should belong to. Press "Continue".
       No mail is sent (there is no mail server); the link goes to the log.

    3. Fetch the link:
         ./deploy/compose/trigger-magic-link.sh
       Open it in the SAME browser. Links are single-use — if one is spent,
       ask for another and re-run that command.

    4. The dashboard now asks for an organisation name, then a project name.
       Both are yours to choose; nothing in this repository depends on either.
       (Suggestion: organisation "Ownpace", project "ownpace".)

    5. That is all. Do NOT hand-copy the project ref or the API key —
       the resume command below reads both out of the instance and checks
       their shape before writing them.

EOF
  your_turn account
}

# ---------------------------------------------------------------------------
phase_login() {
  say login "the deploy CLI, once per machine"
  load_env
  local cli_version profile url
  cli_version="$(node -p "require('${REPO_ROOT}/apps/worker/package.json').dependencies['@trigger.dev/sdk']")"
  profile="${TRIGGER_CLI_PROFILE:-openmig}"
  url="http://localhost:${TRIGGER_PORT:-3090}"

  if trigger_cli_logged_in "$cli_version" "$profile"; then
    # SAY WHICH ANSWER THIS IS. `trigger_cli_logged_in` short-circuits on
    # TRIGGER_ACCESS_TOKEN without validating it — deliberately, since `whoami`
    # structurally cannot see that variable — so on CI this phase reports
    # success for a token it never checked. e2e-managed then printed "already
    # logged in" and died three steps later inside `deploy` with "Invalid or
    # Missing Access Token", because the token was a PAT minted against a
    # Trigger.dev instance that had since been destroyed.
    #
    # The trust is fine; claiming to have verified it is not. A phase that says
    # what it actually established costs one line and saves reading the deploy
    # log to find out what "logged in" meant (hard rule 9).
    if [ -n "${TRIGGER_ACCESS_TOKEN:-}" ]; then
      note "trusting TRIGGER_ACCESS_TOKEN — NOT verified here; a stale one fails inside deploy"
    else
      note "already logged in (profile ${profile}, CLI ${cli_version})"
    fi
    return 0
  fi

  cat <<EOF

    The deploy CLI is not logged in on this machine. Run this yourself — it
    opens a browser and waits for you, which is why the script does not run it
    for you:

      npx -y trigger.dev@${cli_version} login -a ${url} --profile ${profile}

    Note the address is the PLAIN http api origin, not the https front. The
    CLI follows the server-advertised API origin and must not meet a
    self-signed certificate on the way (0018 T5: deploys died with a bare
    "Connection error" when it did).

EOF
  your_turn login
}

# ---------------------------------------------------------------------------
# Make the machinekey volume writable by the user the identity provider RUNS AS.
#
# The user is read off the image rather than written down here. Zitadel's image
# is built FROM scratch — there is no shell in it to ask — but `docker image
# inspect` reads the same config the daemon applies, so this cannot disagree
# with reality the way a number in a comment can. A version bump that changes
# the user is then handled rather than discovered in a nightly.
#
# An EMPTY answer is not a failure and not a default: it means the image
# declares no USER, so it runs as root, and root needs no help writing to a
# root-owned directory. Saying so is the honest branch; substituting a guessed
# uid there would be inventing a fact (hard rule 9).
prepare_machinekey_volume() {
  # Explicit pull first: `inspect` reads the LOCAL image, and on a fresh machine
  # the image arrives with `up` — which is after this. Cached, this is a no-op.
  "${COMPOSE[@]}" pull -q zitadel

  # ASKED BY NAME, not by position. `config --images zitadel` looks like the
  # obvious call and is a trap: it prints the service's DEPENDENCIES too —
  # `postgres:18-alpine` came back on the second line here — so taking the first
  # line is a coin flip on an ordering nothing documents, and losing it means
  # inspecting Postgres and chowning the volume to whatever user THAT runs as.
  # A silently wrong answer is worse than an error. `jq` is already required by
  # setup-zitadel.sh and smoke-managed.sh, so this adds no new dependency.
  local image user
  image="$("${COMPOSE[@]}" config --format json | jq -r '.services.zitadel.image // empty')"
  [ -n "$image" ] || die "compose could not name the zitadel image — cannot tell what user it runs as."

  user="$(docker image inspect "$image" --format '{{.Config.User}}')"

  if [ -z "$user" ]; then
    note "$image declares no USER, so it runs as root — /machinekey needs no preparation"
    return 0
  fi

  # NUMERIC ONLY, and refusing is the point. `chown` inside busybox resolves a
  # NAME against busybox's own /etc/passwd, where a name from another image does
  # not exist — so `USER nonroot` would fail there with `unknown user`, one
  # layer further from the cause than the failure it is supposed to prevent.
  # Zitadel's image is FROM scratch and therefore cannot use a name today (there
  # is no passwd file in it for Docker to resolve one against), but that is a
  # property of the current base image, not a guarantee. Saying so beats
  # inventing a uid.
  case "$user" in
    *[!0-9:]* | '' | *::* )
      die "$image runs as '${user}', which is not a numeric uid[:gid].
    The machinekey volume is prepared by a busybox container, and \`chown\` there
    can only resolve numbers — a name from another image is not in its passwd.
    Prepare the volume by hand with the right owner, then re-run:
      docker run --rm -v ownpace-managed_zitadel_machinekey:/machinekey busybox:1.37 \\
        sh -c 'mkdir -p /machinekey && chown <uid> /machinekey && chmod 700 /machinekey'" ;;
  esac

  note "$image runs as ${user}; making the machinekey volume writable by it"
  ZITADEL_UID="$user" "${COMPOSE[@]}" run --rm --quiet-pull zitadel-machinekey
}
# ---------------------------------------------------------------------------
phase_app() {
  say app "api, web, and anything else not yet running"
  load_env
  # Nextcloud is in managed.yml for the demo only, and a bare `up -d` would
  # start it — publishing an admin panel whose password is `change-me-…` by
  # default. So without --with-demo the services are named explicitly rather
  # than swept up. (Not a `profiles:` key on the service: the nightly e2e and
  # setup-managed-demo.sh both address it by name today, and changing what
  # `up` means for an existing stack is a bigger change than this needs.)
  local services=(
    postgres pgbouncer
    trigger-db trigger-redis clickhouse minio trigger-registry
    trigger-docker-proxy trigger-api trigger-tls trigger-supervisor
    # The identity provider (ADR-0042). It was in managed.yml from #496 and NOT
    # in this list, so it was defined, interpolated, required in .env — and
    # never started. Every compose command had to satisfy ZITADEL_MASTERKEY for
    # a container that did not exist, which is how E2E (managed) #34-#36 died,
    # and it meant the nightly said nothing whatsoever about whether anybody
    # could sign in. A service the product cannot run without is not optional
    # scenery (workplan 0099).
    zitadel
    api web
  )
  [ "$WITH_DEMO" -eq 1 ] && services+=(nextcloud)

  # GIT_SHA so `GET /version` answers with a commit rather than "unknown".
  # THE IDENTITY PROVIDER IS PROVISIONED BEFORE `web` IS BUILT, and the order is
  # the whole point.
  #
  # setup-zitadel.sh writes VITE_OIDC_ISSUER and VITE_OIDC_CLIENT_ID into .env,
  # and `VITE_` values are baked into the web bundle AT BUILD TIME. Provision
  # after the build and the first bring-up on any box produces a login page that
  # knows no client id — correct only from the second run onwards, which is the
  # kind of instruction nobody should have to be given.
  #
  # So zitadel comes up on its own first (it already declares
  # `depends_on: postgres: service_healthy`, and its healthcheck is the
  # provider's own `ready`, not a port probe — it listens well before its
  # migrations are done). The second `up` below is idempotent for anything
  # already running.
  #
  # Until workplan 0099 NOTHING invoked this script at all: it was documented as
  # a step somebody runs by hand, so a bring-up produced a stack whose sign-in
  # had never been configured, and a nightly that could not have noticed.
  # Idempotent by construction — it reads its settings back rather than trusting
  # its writes — so running it every pass is safe.
  # THROUGH `up_wait`, like every other bring-up in this file. Calling compose
  # directly here is what made E2E (managed) #39 unreadable: the container
  # exited 1 on every restart and the run reported only that it was restarting.
  # THE PROVISIONING TOKEN'S DIRECTORY, MADE WRITABLE BEFORE ANYTHING NEEDS IT.
  #
  # E2E (managed) #44's oldest failure line, from the first attempt on a clean
  # database — and this had never once worked:
  #
  #   migration failed  name=03_default_instance
  #     error="open /machinekey/pat.txt: permission denied"
  #
  # Docker creates a new named volume's mount point owned by root; the Zitadel
  # image runs as a non-root user. See managed.yml's zitadel-machinekey service
  # for the whole story, including why this is `run` and not a dependency.
  prepare_machinekey_volume
  up_wait zitadel
  "${SCRIPT_DIR}/setup-zitadel.sh"
  note "identity provider provisioned before the web build (idempotent)"

  # Re-read: the script above just wrote JWT_ISSUER, JWT_AUDIENCE and the two
  # VITE_ values, and the build below has to see them.
  load_env

  # `|| explain_failure` because this one cannot go through `up_wait`: it needs
  # `--build` and a GIT_SHA in the environment. Without it, a web or api image
  # that starts and dies reports one line naming the service and nothing about
  # the cause — the same blindness as the zitadel call above.
  GIT_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)" \
    "${COMPOSE[@]}" up -d --build --wait "${services[@]}" || explain_failure "${services[@]}"
  note "up and healthy: ${services[*]}"
  note "api: ${API_URL:-http://localhost:3001}   web: ${WEB_URL:-http://localhost:3123}"
}

# ---------------------------------------------------------------------------
phase_tasks() {
  say tasks "task environment variables, then the deploy"
  load_env
  [ -n "$(env_get TRIGGER_PROJECT_REF)" ] ||
    die "TRIGGER_PROJECT_REF is not set — the 'account' phase has not been completed."

  # Env before deploy, deliberately. Task containers inherit NOTHING from
  # compose; a deploy that lands before the environment exists runs once
  # against no database and fails in a way that reads like a broken task.
  "${SCRIPT_DIR}/set-task-env.sh"
  "${SCRIPT_DIR}/deploy-tasks.sh"
}

# ---------------------------------------------------------------------------
phase_smoke() {
  if [ "$NO_SMOKE" -eq 1 ]; then
    say smoke "skipped (--no-smoke)"
    return 0
  fi
  if [ "$WITH_DEMO" -eq 0 ]; then
    say smoke "skipped — the smoke drives the DEMO tenants, which this stack does not have"
    note "A real deployment is verified by its own first migration, not by this."
    note "To run it anyway, bring the demo up: --from demo --with-demo"
    return 0
  fi
  say smoke "the live verify + apply smoke — the only proof that counts"
  load_env
  "${SCRIPT_DIR}/smoke-managed.sh"
}

# ---------------------------------------------------------------------------
started=0
[ -n "$FROM" ] || started=1
for phase in "${PHASES[@]}"; do
  if [ -n "$ONLY" ]; then
    [ "$phase" = "$ONLY" ] || continue
  else
    [ "$phase" = "$FROM" ] && started=1
    [ "$started" -eq 1 ] || continue
  fi
  "phase_${phase}"
done

echo
echo "=== done."
if [ "$WITH_DEMO" -eq 1 ] && [ "$NO_SMOKE" -eq 0 ]; then
  echo "    A green smoke means an enqueue became a runner container on this machine."
else
  echo "    Nothing has proven a task actually RUNS here. Before trusting this stack,"
  echo "    run the smoke against a demo stack, or watch the first real sync through."
fi
echo "    The prose companion, including what to do when a step fails:"
echo "      docs/managed-bring-up.md"
