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
# How long the identity provider gets to finish its own setup. A FIRST init
# applies every migration from scratch; #47 took roughly two minutes on the
# Spark, and a machine with slower disk will take longer.
IDP_READY_TIMEOUT="${IDP_READY_TIMEOUT:-300}"

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
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true
}

# env_or NAME DEFAULT — the value in force, or DEFAULT when unset OR EMPTY.
#
# `$(env_get X || echo default)` READS correctly and cannot work: env_get ends
# in `|| true` precisely so that "not set" is a normal answer rather than an
# error, so it always exits 0 and the `||` branch is unreachable. Both uses of
# that shape printed an empty string where a port belonged, and one of them
# reached an operator as:
#
#     Read what it caught:  http://localhost:
#
# The advice survived; the address it was about did not. A default has to test
# the VALUE, because the command already succeeded.
env_or() { # env_or NAME DEFAULT
  local value
  value="$(env_get "$1")"
  printf '%s' "${value:-$2}"
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
  # Same "check once, here" reasoning as the compose check below: every
  # compose-using phase passes through this function, including the `--from X`
  # resumes that skip preflight entirely — which is exactly how a divergent
  # .env reached a bring-up unremarked on 2026-08-24.
  note_env_divergence
  note_mail_goes_nowhere_real
  note_status_page_probes_itself
  note_site_row_half_configured

  local config_err
  if ! config_err="$("${COMPOSE[@]}" config -q 2>&1)"; then
    echo "!!! docker compose cannot read managed.yml:" >&2
    printf '%s\n' "$config_err" | sed 's/^/    /' >&2
    local var=""
    if [[ "$config_err" =~ required\ variable\ ([A-Za-z_][A-Za-z0-9_]*) ]]; then var="${BASH_REMATCH[1]}"; fi
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

# TWO .env FILES DESCRIBING ONE STACK.
#
# The Spark runs a SINGLE managed stack — `managed.yml` pins
# `name: ownpace-managed` and every service has a fixed `container_name`, both
# of which are global to the host — and drives it from two checkouts: the
# operator's, and the nightly gate's. The gate's cannot keep a `.env` at all
# (`actions/checkout` deletes ignored files before every run), so the workflow
# restores one from ~/.persistent/ownpace-managed/. That restore is a
# workaround for a checkout that cannot hold secrets. It is not a second
# configuration, and the day it became one cost an afternoon (0099):
#
#   the `zitadel` role's password matched the GATE's copy, a hand-run bring-up
#   presented the operator's, and the answer was 300 seconds of waiting
#   followed by `password authentication failed for user "zitadel"` — for a
#   password nobody had changed.
#
# A NOTE AND NOT A REFUSAL, deliberately. During a gate run the checkout's copy
# legitimately moves ahead of the persisted one — setup-zitadel.sh writes the
# issuer and the rotated PAT expiry into it, and the workflow persists it back
# at the end — so "these differ" is a normal mid-run state and refusing it
# would break the very thing that keeps them in step. What is NOT normal is
# nobody ever seeing it.
#
# KEY NAMES ONLY. The values are secrets (hard rule 3), and the names are
# enough to act on.
ENV_DIVERGENCE_REPORTED=0
note_env_divergence() {
  [ "$ENV_DIVERGENCE_REPORTED" = "1" ] && return 0
  ENV_DIVERGENCE_REPORTED=1

  local persisted="${MANAGED_ENV_PERSIST_DIR:-${HOME}/.persistent/ownpace-managed}/.env"
  [ -f "$persisted" ] || return 0
  # Already one file, by link or by bind mount: nothing to diverge.
  [ -L "$ENV_FILE" ] && return 0
  [ "$ENV_FILE" -ef "$persisted" ] && return 0

  local differing=() k a b
  # A here-string, NOT a pipe: `differing+=()` inside a piped `while` runs in a
  # subshell and the appends are thrown away at the end of it (0099).
  while IFS= read -r k; do
    [ -n "$k" ] || continue
    a="$(grep -E "^${k}=" "$persisted" | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
    b="$(grep -E "^${k}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
    [ "$a" = "$b" ] || differing+=("$k")
  done <<<"$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$persisted" | sort -u)"

  # TWO FILES IS THE HAZARD; DISAGREEING IS ONLY THE SYMPTOM.
  #
  # This used to return here when every key matched, which meant the note
  # arrived only once something had already drifted — i.e. after the damage,
  # not before it. Two separate files describing one stack WILL drift; the
  # question is whether anybody hears about it while it is still cheap.
  #
  # Skipped under CI, and that is not squeamishness about noise: the gate's
  # checkout CANNOT hold a symlink — `actions/checkout` runs `git clean -ffdx`
  # and deletes it like any other ignored file, which is why the workflow
  # restores a copy in the first place. Printing advice a runner is structurally
  # unable to take, on every run forever, is how a real warning gets tuned out.
  if [ "${#differing[@]}" -eq 0 ]; then
    [ -n "${CI:-}" ] && return 0
    note "TWO .env FILES DESCRIBE THIS ONE STACK. They agree right now:"
    note "  ${ENV_FILE}"
    note "  ${persisted}   (restored into the gate's checkout on every nightly run)"
    note "  Nothing keeps them that way. Make it one file:"
    note "      ln -sfn ${persisted} ${ENV_FILE}"
    return 0
  fi

  note "TWO .env FILES DESCRIBE THIS ONE STACK, and they disagree on ${#differing[@]} key(s):"
  for k in "${differing[@]}"; do note "      ${k}"; done
  note "  ${ENV_FILE}"
  note "  ${persisted}   (restored into the gate's checkout on every nightly run)"
  note "  Whichever ran last wins, and the other gets authentication failures"
  note "  against credentials nobody changed. Make it one file:"
  note "      ln -sfn ${persisted} ${ENV_FILE}"
  note "  (env-upsert.sh follows the link rather than replacing it.)"
}

# A CATCHER SERVING WHAT LOOKS LIKE A REAL DEPLOYMENT.
#
# SMTP_HOST defaults to `mailpit`, which accepts everything and delivers
# nothing. Right for this stack and wrong for a real one, and the failure is
# quiet in the worst way: every send reports `sent`, because it WAS sent — to a
# server whose job is to keep it. Nobody hears about a granted account until
# somebody asks why they never got the email.
#
# WEB_URL already says which kind of deployment this is. An https origin that
# is not localhost is somebody's real address, and the two facts can be
# compared rather than trusted to agree — the same shape as `--public` against
# OWNPACE_APP_URL in the site build.
#
# A NOTE, NOT A REFUSAL. A real deployment mid-setup legitimately passes
# through this state, and refusing would stop a bring-up over a thing that is
# about to be configured. Being told is the whole ask.
note_mail_goes_nowhere_real() {
  local smtp web
  smtp="$(env_get SMTP_HOST)"
  web="$(env_get WEB_URL)"
  [ "$smtp" = "mailpit" ] || return 0
  case "$web" in
    https://localhost*|https://127.0.0.1*|http://*) return 0 ;;
    https://*) : ;;
    *) return 0 ;;
  esac

  note "MAIL ON THIS STACK GOES TO THE CATCHER, and WEB_URL looks like a real"
  note "  deployment (${web}). Every notification will report as sent and no"
  note "  person will receive one — grants, declines and access requests alike."
  note "  Read what it caught:  http://localhost:$(env_or MAILPIT_PORT 3127)"
  note "  For real delivery, point SMTP_HOST at a relay and set NOTIFY_TO to an"
  note "  address somebody reads, then re-run ./deploy/compose/set-task-env.sh"
  note "  so the task containers see it too."
}

# A STATUS PAGE PROBING ITSELF.
#
# gatus reads `STATUS_WEB_URL`, which defaults to `WEB_URL` — the address a
# BROWSER uses, and rightly so: probing an internal service name would prove the
# stack talks to itself and say nothing about the path a customer takes.
#
# But the probe runs INSIDE the gatus container, and the shipped default is
# `http://localhost:3123`, where `localhost` is gatus. Nothing serves 3123
# there, so a perfectly healthy stack lights four red lamps — Web app, API,
# Database, Sign-in — and a status page that is wrong in that direction is as
# useless as one that is wrong in the other.
#
# This was invisible until now for one reason: the service had never been
# started. It is in this phase's list as of this change, so the first thing an
# operator would have seen on a page they had never seen before is four reds.
#
# A NOTE, NOT A REFUSAL: a local stack whose status page is red is a cosmetic
# problem, and refusing a bring-up over it would be absurd.
note_status_page_probes_itself() {
  local probe
  probe="$(env_get STATUS_WEB_URL)"
  [ -n "$probe" ] || probe="$(env_get WEB_URL)"
  case "$probe" in
    http://localhost*|https://localhost*|http://127.0.0.1*|https://127.0.0.1*) : ;;
    *) return 0 ;;
  esac

  note "THE STATUS PAGE WILL PROBE ITSELF, and show red for a healthy stack."
  note "  It asks ${probe} from INSIDE its own container, where localhost is"
  note "  gatus rather than the web app. Web app, API, Database and Sign-in"
  note "  will all be red at http://localhost:$(env_or STATUS_PORT 3124)."
  note "  Set STATUS_WEB_URL to an address that container can reach — e.g."
  note "      ./deploy/compose/env-upsert.sh ${ENV_FILE} STATUS_WEB_URL=http://web:80"
  note "  accepting that it then proves the stack talks to itself. WEB_URL must"
  note "  stay the browser address: the issuer and redirect URIs read it."
}

# A SITE ROW SET UP HALFWAY.
#
# The Website row on the status page needs an address AND a switch, because
# gatus cannot skip an endpoint whose URL is empty — it refuses to load the
# config at all and the page goes down with it. Two settings means two ways to
# set only one of them, and either way the operator gets silence: a row that
# never appears, or a row permanently red about a `.invalid` hostname.
#
# A NOTE, NOT A REFUSAL — like the probe warning above, an incomplete status
# page is cosmetic and refusing a bring-up over it would be absurd.
note_site_row_half_configured() {
  local url on
  url="$(env_get STATUS_SITE_URL)"
  on="$(env_get STATUS_SITE_ENABLED)"

  if [ -n "$url" ] && [ "$on" != "true" ]; then
    note "THE STATUS PAGE'S WEBSITE ROW IS SET UP BUT SWITCHED OFF."
    note "  STATUS_SITE_URL is ${url}, and STATUS_SITE_ENABLED is not 'true',"
    note "  so the row will not appear at all. Turn it on with"
    note "      ./deploy/compose/env-upsert.sh ${ENV_FILE} STATUS_SITE_ENABLED=true"
    return 0
  fi

  if [ "$on" = "true" ] && [ -z "$url" ]; then
    note "THE STATUS PAGE'S WEBSITE ROW IS ON WITH NO ADDRESS TO PROBE."
    note "  It will show red against a placeholder hostname that cannot resolve,"
    note "  which says nothing about the site. Give it the address a visitor"
    note "  uses:"
    note "      ./deploy/compose/env-upsert.sh ${ENV_FILE} STATUS_SITE_URL=https://www.example.com"
  fi
}

# THE `zitadel` ROLE'S PASSWORD, ASKED BEFORE THE CONTAINER IS STARTED.
#
# Zitadel finds an existing role, logs `user already exists, skipping
# creation`, and does NOT reset its password — so a `.env` whose
# ZITADEL_DB_PASSWORD does not match what the role actually has produces a
# container that crash-loops on every restart. `wait_for_idp_ready` cannot tell
# that from a slow boot, so the operator waits the full IDP_READY_TIMEOUT
# before seeing a single word about it.
#
# One query answers it in a second, and it is the SAME question the container
# is about to ask.
#
# ASKED BY THE SCRIPT, NOT HERE. This used to be an inline `docker exec ...
# psql -U zitadel`, a copy of the one in zitadel-db-password.sh. Both connected
# over the Unix socket, which pg_hba.conf answers with `trust` — so both
# reported a pass without the password being looked at, and on 2026-08-24 they
# said so three times while Zitadel crash-looped on 28P01 behind the 300-second
# timeout. Two copies of a question is how a wrong answer gets given twice:
# fixing one would have left the other lying. There is now one, and it is the
# same script the refusal below tells you to run.
assert_zitadel_role_password() {
  local user pass out rc=0
  user="$(env_get ZITADEL_DB_USER)"; user="${user:-zitadel}"
  pass="$(env_get ZITADEL_DB_PASSWORD)"
  # Unset is managed.yml's `:?` to report, not ours — it names the fix already.
  [ -n "$pass" ] || return 0

  out="$("${SCRIPT_DIR}/zitadel-db-password.sh" --check 2>&1)" || rc=$?
  printf '%s\n' "$out" | sed 's/^/    /'

  case "$rc" in
    0) return 0 ;;
    1)
      echo >&2
      echo "!!! the ${user} Postgres role will NOT accept the password in ${ENV_FILE}." >&2
      echo "!!! Zitadel is about to present exactly this and be refused. It logs" >&2
      echo "!!!   user already exists, skipping creation" >&2
      echo "!!! and then crash-loops, which looks identical to a slow boot until" >&2
      echo "!!! the ${IDP_READY_TIMEOUT}s readiness timeout runs out." >&2
      echo "!!!" >&2
      echo "!!! Zitadel does not reset an existing role's password, so one of the two" >&2
      echo "!!! has to move. To point the ROLE at this file (Zitadel's data is untouched):" >&2
      echo "!!!   ./deploy/compose/zitadel-db-password.sh --sync" >&2
      echo "!!!" >&2
      echo "!!! BEFORE YOU DO: if a second .env exists, the role may be matching THAT" >&2
      echo "!!! one and this file may be the stale copy — changing the role would then" >&2
      echo "!!! break the other consumer instead. Any divergence is listed above." >&2
      exit 1 ;;
    *)
      # Says what it established, which is nothing — rather than reporting a
      # pass it never got (hard rule 9). Exit 2 from the script means the
      # question could not be asked at all: an unreachable database, a wrong
      # container, a Postgres still starting.
      note "the ${user} role was NOT verified here — the check above could not run" ;;
  esac
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

    # THE HEALTHCHECK'S OWN OUTPUT, WHICH IS IN NEITHER WINDOW ABOVE BECAUSE IT
    # IS NOT IN THE LOG AT ALL.
    #
    # `docker compose logs` shows what the CONTAINER wrote. A healthcheck runs
    # beside it and its stdout goes somewhere else entirely: Docker keeps the
    # last few probe attempts in `.State.Health.Log`, reachable only through
    # `docker inspect`. Nothing in this file had ever looked there.
    #
    # E2E (managed) #47 is what that costs, and it is a failure shape none of
    # the three windows above can describe. Zitadel v4.17.1 came up perfectly:
    # every migration applied, OIDC routes registered, `server is listening
    # address=[::]:8080`, and ZERO lines in the failure window. The container
    # sat at `Up 5 minutes (unhealthy)` and the run died at `--wait` — with a
    # diagnosis that could only say the log was clean, which it was.
    #
    # A container that is RUNNING and unhealthy is the one case where the log
    # is not the answer. The probe is the answer, and it was one `docker
    # inspect` away the whole time.
    local cname
    cname="$("${COMPOSE[@]}" ps --format '{{.Name}}' "$svc" 2>/dev/null | tail -1)"
    if [ -n "$cname" ]; then
      # `{{if .State.Health}}` because a service with no healthcheck has none,
      # and a template that assumes otherwise fails rather than saying so.
      local probe
      probe="$(docker inspect "$cname" \
        --format '{{if .State.Health}}{{range .State.Health.Log}}--- exit={{.ExitCode}}: {{.Output}}{{end}}{{end}}' \
        2>/dev/null || true)"
      if [ -n "$probe" ]; then
        echo "!!! --- ${svc} — what the HEALTHCHECK said (not in the log above):" >&2
        printf '%s\n' "$probe" | sed 's/^/    /' >&2 || true
      fi
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
        # `sh -c '...'` in SINGLE quotes, and that is the whole point: the
        # operator pastes this into THEIR shell, where POSTGRES_USER is not set.
        # Printed bare it expands to nothing, psql falls back to the host
        # username, and the answer is `FATAL: role "root" does not exist` —
        # which is exactly what this line did to an operator on 2026-08-23,
        # having shipped in #511 the same afternoon. Single quotes defer the
        # expansion to the container, which HAS the variable. IF EXISTS so a
        # second paste is not an error.
        echo "!!!   docker exec -i ownpace-db sh -c 'psql -U \"\$POSTGRES_USER\" -d postgres -c \"DROP DATABASE IF EXISTS zitadel WITH (FORCE)\"'" >&2
        # THE DELETION AND THE REBUILD ARE PRINTED TOGETHER, and the second one
        # is not optional. Deleting the volume leaves Docker to recreate it
        # owned by root, while this image declares a USER — so first init dies
        # on `open /machinekey/pat.txt: permission denied`, having ALREADY
        # registered the instance domain, and every restart after that reports
        # its own leftover (Errors.Instance.Domain.AlreadyExists) rather than
        # the cause. prepare_machinekey_volume, in phase_app, is the only thing
        # in this repository that chowns it. Found 2026-09-01, on a recipe that
        # stopped one line short of working.
        echo "!!!   docker volume rm ownpace-managed_zitadel_machinekey" >&2
        echo "!!!   ./deploy/compose/bootstrap-managed.sh --only app" >&2
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

  # ---- IS THIS A STACK ENV AT ALL? ----
  #
  # Checked BEFORE ensure-env-secrets.sh, because after it has run the damage is
  # already done: it writes generated secrets THROUGH the symlink, into whatever
  # the file really is.
  #
  # Found live on the Spark, 2026-09-01. `deploy/compose/.env` there is a
  # symlink into the gate runner's persist directory — the shape THIS SCRIPT
  # RECOMMENDS, so the link is not the problem and refusing on it would refuse
  # the advice. The file behind it is not a stack env: it is the DURABLE SET,
  # the seven values `git clean -ffdx` must not destroy because volumes depend
  # on them (the Postgres roles, and ZITADEL_MASTERKEY, which encrypts the
  # identity provider's own data). Everything else is regenerated into the
  # gate's checkout on every run.
  #
  # Pointed at that file, this script did exactly what it is written to do:
  # generated the eight secrets it found missing, wrote them into the durable
  # set, and walked into "WEB_URL has no value" two phases later — an error
  # about the last symptom rather than the first, on a box where the answer was
  # never "fix WEB_URL" but "you are on the machine that already has a stack".
  #
  # THE DISCRIMINATOR IS SIZE, not the symlink and not a missing key. A real
  # `.env` begins as a copy of managed.env.example and keeps every key name
  # from its first minute, blank values included — so "WEB_URL is empty" is the
  # ordinary state of a half-configured install and would refuse the supported
  # edit-and-resume flow. A durable set defines a handful of keys and never had
  # the rest. Counting is also what makes the refusal legible: it can say what
  # it counted rather than asserting a shape.
  if [ "$freshly_created" -eq 0 ]; then
    local env_keys example_keys resolved
    env_keys="$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "$ENV_FILE" | sort -u | wc -l)"
    example_keys="$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' "${SCRIPT_DIR}/managed.env.example" | sort -u | wc -l)"
    # A quarter, not a fixed number: the example grows, and a threshold that
    # does not grow with it turns into a refusal nobody can explain.
    resolved="$(readlink -f "$ENV_FILE" 2>/dev/null || printf '%s' "$ENV_FILE")"
    # AND IT WRITES OUTSIDE THE CHECKOUT. Without this clause the refusal fires
    # in CI and takes the gate with it: the workflow restores that same small
    # file INTO `deploy/compose/.env` and then runs this script precisely so it
    # can top the rest up. There the file is a plain copy the bring-up owns;
    # here it is a link to the one file it must not own. Same content, opposite
    # meaning, and the difference is where a write lands.
    if [ "$env_keys" -gt 0 ] && [ "$example_keys" -gt 0 ] &&
       [ $(( env_keys * 4 )) -lt "$example_keys" ] &&
       [ "$resolved" != "$ENV_FILE" ]; then
      echo "!!! ${ENV_FILE} is not a stack env." >&2
      echo "!!! It defines ${env_keys} keys; managed.env.example defines ${example_keys}." >&2
      [ "$resolved" = "$ENV_FILE" ] || echo "!!! It is a link to ${resolved}" >&2
      echo "!!!" >&2
      echo "!!! That is the shape of a GATE RUNNER'S DURABLE SET — the few values a" >&2
      echo "!!! checkout clean must not destroy, restored into the gate's workspace on" >&2
      echo "!!! every run and topped up there. A stack is already brought up from it." >&2
      echo "!!! NOTHING HAS BEEN WRITTEN. Continuing would generate secrets into it and" >&2
      echo "!!! change what the next run of that gate brings up." >&2
      echo "!!!" >&2
      echo "!!! On the machine that runs the gate, you do not run this script: dispatch" >&2
      echo "!!!   the E2E (managed) workflow to exercise a branch on the real stack." >&2
      echo "!!! To build a SEPARATE stack from this checkout, give it an env of its own:" >&2
      echo "!!!   unlink ${ENV_FILE} && ${0}" >&2
      echo "!!! To edit the durable set, edit ${resolved} directly — nothing here writes" >&2
      echo "!!!   to it on purpose." >&2
      exit 1
    fi
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
  auth_db="$(grep -oE 'auth_dbname=[A-Za-z0-9_]+' "$ini" | awk 'NR==1' | cut -d= -f2)"
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
  local cli_version profile url origin
  cli_version="$(node -p "require('${REPO_ROOT}/apps/worker/package.json').dependencies['@trigger.dev/sdk']")"
  profile="${TRIGGER_CLI_PROFILE:-$TRIGGER_CLI_PROFILE_DEFAULT}"
  url="http://localhost:${TRIGGER_PORT:-3090}"
  # Computed BEFORE the refusals so both branches print the same sentence, and
  # so the resolved name and its origin cannot be described by two expressions
  # that disagree.
  origin="$(trigger_cli_profile_origin)"

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

    The deploy CLI is not logged in on this machine under the profile
    '${profile}'. Run this yourself — it opens a browser and waits for you,
    which is why the script does not run it for you:

      npx -y trigger.dev@${cli_version} login -a ${url} --profile ${profile}

    Note the address is the PLAIN http api origin, not the https front. The
    CLI follows the server-advertised API origin and must not meet a
    self-signed certificate on the way (0018 T5: deploys died with a bare
    "Connection error" when it did).

EOF

  # THE PROFILE NAME IS A SETTING, and until this said so an operator already
  # logged in under another name had nothing to go on: they ran the command
  # above with the name they knew, it succeeded, and this phase refused again.
  local present
  present="$(trigger_cli_profiles_present)"
  if [ -n "$present" ]; then
    cat <<EOF
    This machine IS logged in under:

$(printf '      %s\n' $present)
    The profile name is a SETTING, and these are two different facts:

      in use    '${profile}' — ${origin}
      default   '${TRIGGER_CLI_PROFILE_DEFAULT}'

    It is read from this shell's environment, or from:
      ${ENV_FILE}

    If one of the above is the account you want, point the setting at it
    instead of logging in a second time:

      ./deploy/compose/env-upsert.sh ${ENV_FILE} TRIGGER_CLI_PROFILE=<name>

EOF
  else
    cat <<EOF
    The profile name is a SETTING, and these are two different facts:

      in use    '${profile}' — ${origin}
      default   '${TRIGGER_CLI_PROFILE_DEFAULT}'

    It is read from this shell's environment, or from ${ENV_FILE}.
    So if you are already logged in under a different one, set that here
    rather than logging in again:

      ./deploy/compose/env-upsert.sh ${ENV_FILE} TRIGGER_CLI_PROFILE=<name>

EOF
  fi
  your_turn login
}

# ---------------------------------------------------------------------------
# Make the machinekey volume writable by the user the identity provider RUNS AS.
#
# The user is read off the image rather than written down here. Zitadel's image
# carries no shell this can rely on, but `docker image inspect` reads the same
# config the daemon applies, so this cannot disagree with reality the way a
# number in a comment can. A version bump that changes the user is then handled
# rather than discovered in a nightly — which is not hypothetical: v4.6.2
# reported `zitadel`, a NAME, and a hardcoded 1000 would have chowned the token
# directory to whoever else holds that uid. The pin has moved since; the lookup
# is what makes that a non-event.
#
# An EMPTY answer is not a failure and not a default: it means the image
# declares no USER, so it runs as root, and root needs no help writing to a
# root-owned directory. Saying so is the honest branch; substituting a guessed
# uid there would be inventing a fact (hard rule 9).
# Turn the NAME an image declares into the number `chown` needs.
#
# E2E (managed) #45 is why this exists. `ghcr.io/zitadel/zitadel:v4.6.2` reported
# `Config.User` as `zitadel`, not a uid, and the bring-up refused — correctly,
# because `chown zitadel` inside busybox resolves against BUSYBOX's passwd,
# where no such user exists. But refusing is half an answer when the number is
# readable.
#
# AND IT IS READABLE, which corrected an assumption written into #512: that
# comment said the image is FROM scratch and therefore has no passwd to resolve
# a name against. It cannot be: Docker resolves `USER zitadel` against the
# IMAGE'S OWN /etc/passwd when it starts the container, so that file is in
# there. A scratch image can carry one — COPYing a prepared passwd into scratch
# is a common way to get a non-root user without a distro.
#
# `docker create` makes a container WITHOUT STARTING IT, and `docker cp` reads
# files out of one. So this needs no shell, no entrypoint and no running
# process — which matters, because what is in that image beyond the binary is
# exactly what nothing here can assume.
resolve_image_uid() { # resolve_image_uid <image> <user-from-config>
  local image="$1" name="${2%%:*}" cid passwd
  cid="$(docker create "$image")" || return 0
  # `|| true` on the read and an unconditional `rm`: a container created and not
  # removed is litter on a long-lived box, and it must go whether or not the
  # file came back. The empty answer is handled by the caller.
  passwd="$(docker cp "${cid}:/etc/passwd" - 2>/dev/null | tar -xO 2>/dev/null || true)"
  docker rm -f "$cid" >/dev/null 2>&1 || true
  printf '%s\n' "$passwd" | awk -F: -v u="$name" '$1 == u { print $3; exit }'
}

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

  # A NAME is not an error any more — it is a lookup. Only a name the image's
  # own passwd does not explain is an error, and that one stays a refusal
  # rather than a guess: chowning a token directory to a number nobody can
  # justify is how a credential ends up owned by whoever happens to hold it.
  case "$user" in
    *[!0-9:]*)
      local resolved
      resolved="$(resolve_image_uid "$image" "$user")"
      [ -n "$resolved" ] ||
        die "$image runs as '${user}', and that name is not in the image's own /etc/passwd.
    The machinekey volume is prepared by a busybox container, and \`chown\` there
    can only resolve numbers — a name from another image is not in its passwd.
    Find the uid and prepare the volume by hand, then re-run:
      docker run --rm -v ownpace-managed_zitadel_machinekey:/machinekey busybox:1.37 \\
        sh -c 'mkdir -p /machinekey && chown <uid> /machinekey && chmod 700 /machinekey'"
      note "$image runs as '${user}', which is uid ${resolved} in its own /etc/passwd"
      user="$resolved"
      ;;
  esac

  note "$image runs as ${user}; making the machinekey volume writable by it"
  ZITADEL_UID="$user" "${COMPOSE[@]}" run --rm --quiet-pull zitadel-machinekey
}
# ---------------------------------------------------------------------------
# Wait for the identity provider to be READY, from the one side that can ask.
#
# E2E (managed) #47: Zitadel v4.17.1 came up perfectly — every migration applied,
# OIDC routes registered, `server is listening address=[::]:8080` — and compose
# reported `container ownpace-idp is unhealthy` for thirty-one minutes. The probe
# was wrong, not the provider:
#
#   docker inspect  →  "Output":"Error: not ready", FailingStreak: 188
#   curl http://localhost:3126/debug/ready  (from the host)  →  200
#
# `zitadel ready` builds its URL from ExternalPort, and ExternalPort is by
# definition the address the OUTSIDE reaches Zitadel on. Inside the container
# nothing is listening there: on this stack 3126 is a published port, and on a
# fronted deployment it is 443, terminated by something that is not Zitadel. So
# the probe asks an address that cannot answer, and v4.17.1 reports an
# unreachable endpoint as `Error: not ready` — indistinguishable, from inside,
# from a considered no.
#
# A container-side healthcheck therefore cannot express this readiness at all,
# and the compose healthcheck was removed rather than left failing. This is NOT
# the check being weakened: it is the same check, asked from the side that can
# ask it, by something that can say what went wrong. `--wait` cannot gate on it,
# so this does, and a timeout still goes through `explain_failure`.
#
# The PUBLISHED port, deliberately, not ExternalPort. They are the same number
# on a plain bring-up and they are not behind a front, and the host can only
# reach what compose published.
wait_for_idp_ready() {
  local port url waited=0
  port="$(env_get ZITADEL_PORT)"
  port="${port:-3126}"
  url="http://localhost:${port}/debug/ready"

  note "waiting for the identity provider at ${url} (up to ${IDP_READY_TIMEOUT}s)"
  while [ "$waited" -lt "$IDP_READY_TIMEOUT" ]; do
    # `-o /dev/null -w %{http_code}` and a comparison to 200: `curl -f` would
    # collapse "not ready yet" and "no such host" into the same silence, and the
    # difference between those two is the whole reason this function exists.
    if [ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)" = "200" ]; then
      note "identity provider is ready after ${waited}s"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done

  echo >&2
  echo "!!! the identity provider never became ready at ${url} (${IDP_READY_TIMEOUT}s)" >&2
  echo "!!! 000 above means nothing answered; any other code means it answered and said no." >&2
  explain_failure zitadel
}

# THE ONE THING ONLY A BROWSER COULD SEE, ASKED HERE INSTEAD.
#
# Found on the OTA stack on 2026-08-31, weeks after it started: the admin
# console showed a bare red "NetworkError" and nothing else anywhere had a
# word to say about it. Every check we had looked from a side where it was
# invisible — the smoke asks the issuer from INSIDE the API container, and
# from there everything was genuinely fine.
#
# The console reads `/ui/console/assets/environment.json` at boot to learn
# where its API is. With `ZITADEL_TLS_MODE=disabled` behind a proxy that
# terminates TLS, Zitadel writes `api: http://…` there while `issuer` stays
# `https://…` (that one follows ZITADEL_EXTERNALSECURE). The page is served
# over https, so the browser refuses the http call as MIXED CONTENT before it
# leaves: no status code, no CORS message, no server log. Unfindable from the
# server, and one line to see from here.
#
# WHAT IS ASSERTED IS AGREEMENT, NOT HTTPS. A local bring-up is http on both
# and perfectly correct; a fronted one is https on both. Only a document that
# disagrees with ITSELF is broken, in every deployment shape, which is what
# makes this safe to run everywhere rather than only where TLS is expected.
#
# NOT FATAL. The stack works — sign-in, the API, every migration; it is the
# admin console alone that cannot load, and failing a bring-up over it would
# refuse an operator a working system to fix a screen they may not need
# today. It is loud, it names the variable, and it leaves the choice with the
# person reading it.
#
# The Host header, because Zitadel resolves the instance by ORIGIN and answers
# 404 "Instance not found" for any other — the same rule that made
# ZITADEL_EXTERNALDOMAIN matter so much. localhost reaches the published port;
# the header makes the request look like the one a browser sends.
check_idp_console_config() {
  local port domain body api issuer
  port="$(env_get ZITADEL_PORT)"; port="${port:-3126}"
  domain="$(env_get ZITADEL_EXTERNALDOMAIN)"; domain="${domain:-ownpace-idp}"

  body="$(curl -sS --max-time 5 -H "Host: ${domain}" \
    "http://localhost:${port}/ui/console/assets/environment.json" 2>/dev/null || true)"

  api="$(printf '%s' "$body" | sed -n 's/.*"api" *: *"\([^"]*\)".*/\1/p')"
  issuer="$(printf '%s' "$body" | sed -n 's/.*"issuer" *: *"\([^"]*\)".*/\1/p')"

  # Say nothing rather than guess. A body we could not read is not evidence of
  # a mismatch, and a false alarm here would teach an operator to skip the
  # real one.
  if [ -z "$api" ] || [ -z "$issuer" ]; then
    note "could not read the console's environment.json — skipping its scheme check"
    return 0
  fi

  if [ "${api%%:*}" = "${issuer%%:*}" ]; then
    note "the console's api and issuer agree on ${api%%:*}"
    return 0
  fi

  echo >&2
  echo "!!! THE ADMIN CONSOLE WILL NOT LOAD, and it will not say why." >&2
  echo "!!!   api    ${api}" >&2
  echo "!!!   issuer ${issuer}" >&2
  echo "!!! A page served over ${issuer%%:*} may not call ${api%%:*} — the browser refuses it" >&2
  echo "!!! as mixed content before the request leaves, so the console shows a bare" >&2
  echo "!!! NetworkError and no server anywhere logs a thing." >&2
  echo "!!! ZITADEL_EXTERNALSECURE fixes the issuer; the api follows ZITADEL_TLS_MODE." >&2
  echo "!!! Behind a proxy that terminates TLS, set in ${ENV_FILE}:" >&2
  echo "!!!   ZITADEL_TLS_MODE=external" >&2
  echo "!!!   docker compose -f managed.yml up -d zitadel" >&2
  echo "!!! Everything else — sign-in, the API, tokens — is unaffected either way." >&2
  echo >&2
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
    # The mail catcher. In the list for the same reason zitadel is: it is
    # defined, interpolated and depended on, and a service the product's
    # notifications cannot work without is not optional scenery. Every
    # notification this stack sends lands here and is readable in a browser;
    # nothing reaches a real inbox unless SMTP_HOST is changed on purpose.
    mailpit
    api web
    # The status page (workplan 0094). It was in managed.yml, had STATUS_PORT in
    # managed.env.example, a section in docs/managed-bring-up.md claiming it
    # "starts with everything else", and its own status-page.md — and it was
    # named NOWHERE in this script, so no bring-up had ever started it. Exactly
    # what happened to zitadel above, discovered the same way: a `docker ps` on
    # the Spark with no `ownpace-status` in it.
    #
    # It has no `depends_on` by design — "a status page that will not start
    # until the thing it is watching is healthy is a status page that is never
    # there when it matters" — so it can come up anywhere in this list.
    gatus
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
  # Postgres first and on its own, so the credential Zitadel is about to
  # present can be TRIED before the container that presents it exists. Zitadel
  # declares this dependency anyway, so this costs nothing on the happy path —
  # it only moves a `up -d` that was going to happen either way.
  up_wait postgres
  assert_zitadel_role_password
  # `up -d`, NOT `up_wait`: the container has no healthcheck to wait on any
  # more, for the reason wait_for_idp_ready's header sets out. Readiness is
  # asked from the host immediately below, and a timeout there still lands in
  # `explain_failure` — so the diagnosis path is unchanged, only the asker is.
  # BEFORE THE PROVIDER STARTS, because a network alias is fixed when the
  # container joins the network — changing it afterwards means recreating it.
  "${SCRIPT_DIR}/zitadel-network-alias.sh"
  "${COMPOSE[@]}" up -d zitadel || explain_failure zitadel
  wait_for_idp_ready
  check_idp_console_config
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
