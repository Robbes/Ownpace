#!/usr/bin/env bash
# trigger-credentials.sh — read this instance's TRIGGER_PROJECT_REF and prod
# TRIGGER_SECRET_KEY out of the Trigger.dev database, so the one bring-up step
# that was pure hand-copying stops being one.
#
# WHY THIS IS NOT CHEATING. Creating the account, organisation and project is
# genuinely a human step: the self-hosted webapp signs you in by magic link and
# there is no admin API to do it for you. But everything AFTER that step is a
# lookup — the operator visits two dashboard pages and transcribes two opaque
# strings into deploy/compose/.env. Transcribing an opaque string is the kind
# of step that fails silently: a `tr_prod_` key one character short does not
# error at `compose up`, it makes every enqueue fail at runtime, hours later,
# on a screen nobody is watching.
#
# WHY IT IS NOT AUTHORITATIVE EITHER. The schema below belongs to Trigger.dev,
# not to this repository, and it can change under a version bump. So this
# script NEVER guesses: it introspects for the exact columns it needs, refuses
# with the manual instructions if the shape is not what it expects, and
# validates the shape of both values before printing either. A wrong answer
# here would be written into `.env` and believed, so the failure mode is
# deliberately "refuses and tells you which page to open", never "prints
# something plausible".
#
# SECRET-BEARING OUTPUT. A `tr_prod_` key is the credential the API enqueues
# with; treat this script's stdout exactly like the `.env` it is destined for.
# Do not paste a run of it into an issue.
#
# Usage:
#   ./trigger-credentials.sh                       # print KEY=VALUE lines
#   ./trigger-credentials.sh --project my-project  # when the instance has several
#   ./trigger-credentials.sh --write               # upsert them into .env for you
#
# Overrides:
#   TRIGGER_DB_PSQL   the command SQL is piped into. Default runs psql inside
#                     the trigger-db container. Set it to talk to a Trigger.dev
#                     instance that is not this compose stack's — or, in the
#                     unit tests, to a stub that returns a fixture.
#   TRIGGER_ENV_SLUG  which runtime environment's key to read (default `prod` —
#                     the one the API enqueues with; `dev` keys are personal to
#                     a CLI session and would not work from a container).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
PROJECT_FILTER=""
WRITE=0
ENV_SLUG="${TRIGGER_ENV_SLUG:-prod}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project) PROJECT_FILTER="${2:?--project needs a name}"; shift 2 ;;
    --write) WRITE=1; shift ;;
    -h | --help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "trigger-credentials.sh: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

# Unaligned, no header, psql's default `|` field separator — the shape the
# parsing below assumes. (`-F$'\t'` would be tidier, but this string is
# `eval`ed so the escape would arrive at psql as the letter t.) Only the
# third field, the project NAME, could contain a `|`, and it is last and used
# only for the you-have-several message.
DEFAULT_PSQL="docker compose -f ${SCRIPT_DIR}/managed.yml exec -T trigger-db psql -U trigger -d triggerdb -tA"
PSQL="${TRIGGER_DB_PSQL:-$DEFAULT_PSQL}"

run_sql() { printf '%s\n' "$1" | eval "$PSQL" 2>&1; }

manual_instructions() {
  cat >&2 <<'EOF'

  Read the two values by hand instead — both are in the dashboard:

    TRIGGER_PROJECT_REF   Project → Settings.  It looks like  proj_abc123…
    TRIGGER_SECRET_KEY    Project → API keys → the PROD environment's
                          secret key.  It looks like  tr_prod_abc123…

  Then put them in deploy/compose/.env and restart the API so it reads the key:

    ./deploy/compose/env-upsert.sh deploy/compose/.env \
      TRIGGER_PROJECT_REF=proj_… TRIGGER_SECRET_KEY=tr_prod_…
    docker compose -f deploy/compose/managed.yml up -d api
EOF
}

# ---------------------------------------------------------------------------
# Introspection first. Every column named here is named again in the query
# below, and nowhere else — so this list and that query cannot drift apart
# without this check failing first, which is the whole point of doing it.
# ---------------------------------------------------------------------------
NEEDED='Project.externalRef Project.id RuntimeEnvironment.apiKey RuntimeEnvironment.slug RuntimeEnvironment.projectId'
probe_sql="SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('Project','RuntimeEnvironment');"

if ! present="$(run_sql "$probe_sql")"; then
  echo "[trigger-credentials] could not query the Trigger.dev database:" >&2
  echo "${present}" | sed 's/^/    /' >&2

  # Two very different failures arrive down this one pipe, and calling both of
  # them "is the stack up?" sent an operator looking at a Trigger.dev instance
  # that was running perfectly well (observed live, 2026-08-18).
  #
  # `docker compose exec` interpolates the WHOLE compose file before it runs
  # anything, so one `${VAR:?…}` with no value in .env makes every compose
  # command against managed.yml fail — including this one, which only wanted to
  # reach trigger-db and never touches the service that is missing a variable.
  if grep -qE 'required variable|error while interpolating' <<<"$present"; then
    var=""
    if [[ "$present" =~ required\ variable\ ([A-Za-z_][A-Za-z0-9_]*) ]]; then var="${BASH_REMATCH[1]}"; fi
    echo "[trigger-credentials] That is NOT a database problem, and probably not a stopped stack." >&2
    echo "[trigger-credentials] docker compose could not read managed.yml at all: ${var:-a required variable}" >&2
    echo "[trigger-credentials] has no value in deploy/compose/.env, and compose interpolates the" >&2
    echo "[trigger-credentials] whole file before running any command. Generate the missing secrets:" >&2
    echo "[trigger-credentials]   ./deploy/compose/ensure-env-secrets.sh" >&2
    echo "[trigger-credentials] then, if it was PGBOUNCER_AUTH_PASSWORD, create the matching role:" >&2
    echo "[trigger-credentials]   ./deploy/compose/bootstrap-managed.sh --only data" >&2
    exit 1
  fi

  echo "[trigger-credentials] Is the stack up?  docker compose -f deploy/compose/managed.yml up -d trigger-db" >&2
  manual_instructions
  exit 1
fi

# READ FROM A HERE-STRING, NOT THROUGH A PIPE.
#
# `printf '%s\n' "$present" | grep -qxF "$col"` is what stood here, and under
# `set -o pipefail` it reports failure when grep SUCCEEDS. `grep -q` exits the
# instant it matches, without draining its input; the producer's next write
# lands on a closed pipe and it dies of SIGPIPE. PIPESTATUS is then `(141 0)` —
# grep said yes, the producer was killed for being interrupted mid-sentence,
# and pipefail returns the 141. The column IS there and this loop calls it
# missing, which the block below reports as somebody else's schema being wrong.
#
# It is a race, so it needs a loaded machine to show itself: 0 in 15,000
# unloaded iterations, ~1 in 1,400 under CPU contention. That is exactly a
# CI runner with a full test suite in flight, and it turned `unit-tests` red
# on PR #518 claiming `Missing: Project.id` for a column the fixture defines.
#
# A here-string has no producer process to kill, so there is nothing to signal.
missing=""
for col in $NEEDED; do
  grep -qxF "$col" <<<"$present" || missing="${missing} ${col}"
done
if [ -n "$missing" ]; then
  echo "[trigger-credentials] This Trigger.dev instance's schema is not the one this script knows." >&2
  echo "[trigger-credentials] Missing:${missing}" >&2
  echo "[trigger-credentials] That is a Trigger.dev version difference, not a broken stack —" >&2
  echo "[trigger-credentials] the schema belongs to them. Nothing was written." >&2
  manual_instructions
  exit 1
fi

# ---------------------------------------------------------------------------
# The lookup. Deliberately no `deletedAt`/`createdAt`/`organizationId` filter:
# every column referenced here is one the probe above proved exists. If the
# instance holds more than one project, this script does not pick for you.
# ---------------------------------------------------------------------------
where_project=""
if [ -n "$PROJECT_FILTER" ]; then
  # Single-quote escaping for SQL: the only metacharacter that matters.
  escaped="${PROJECT_FILTER//\'/\'\'}"
  where_project=" AND p.name = '${escaped}'"
fi

rows="$(run_sql "SELECT p.\"externalRef\", e.\"apiKey\", p.name FROM \"Project\" p JOIN \"RuntimeEnvironment\" e ON e.\"projectId\" = p.id WHERE e.slug = '${ENV_SLUG}'${where_project};")"
rows="$(printf '%s\n' "$rows" | grep -v '^[[:space:]]*$' || true)"

count="$(printf '%s\n' "$rows" | grep -c . || true)"
if [ "${count:-0}" -eq 0 ]; then
  echo "[trigger-credentials] No project with a '${ENV_SLUG}' environment exists yet on this instance." >&2
  echo "[trigger-credentials] That is the expected answer BEFORE the one human step:" >&2
  echo "[trigger-credentials] sign in to the dashboard and create an organisation and a project." >&2
  manual_instructions
  exit 1
fi
if [ "$count" -gt 1 ]; then
  echo "[trigger-credentials] ${count} projects have a '${ENV_SLUG}' environment. Refusing to choose:" >&2
  printf '%s\n' "$rows" | cut -d'|' -f3 | sed 's/^/    /' >&2
  echo "[trigger-credentials] Re-run with:  --project <name>" >&2
  exit 1
fi

ref="$(printf '%s\n' "$rows" | cut -d'|' -f1)"
key="$(printf '%s\n' "$rows" | cut -d'|' -f2)"

# Shape checks. These are what makes reading somebody else's schema safe: a
# column that turns out to hold something else fails HERE, before the value is
# written into .env and believed for the rest of the deployment's life.
if ! grep -qE '^proj_[A-Za-z0-9]+$' <<<"$ref"; then
  echo "[trigger-credentials] The project ref does not look like a project ref (expected proj_…)." >&2
  echo "[trigger-credentials] Refusing to write it. Nothing was changed." >&2
  manual_instructions
  exit 1
fi
if ! grep -qE "^tr_${ENV_SLUG}_[A-Za-z0-9]+$" <<<"$key"; then
  echo "[trigger-credentials] The '${ENV_SLUG}' key does not look like a tr_${ENV_SLUG}_ key." >&2
  echo "[trigger-credentials] Refusing to write it. Nothing was changed." >&2
  manual_instructions
  exit 1
fi

printf 'TRIGGER_PROJECT_REF=%s\n' "$ref"
printf 'TRIGGER_SECRET_KEY=%s\n' "$key"

if [ "$WRITE" -eq 1 ]; then
  "${SCRIPT_DIR}/env-upsert.sh" "$ENV_FILE" \
    "TRIGGER_PROJECT_REF=${ref}" "TRIGGER_SECRET_KEY=${key}" >&2
  echo "[trigger-credentials] written to ${ENV_FILE} — restart the api so it reads the key:" >&2
  echo "[trigger-credentials]   docker compose -f deploy/compose/managed.yml up -d api" >&2

  # THE CHECKOUT IS NOT THE ONLY COPY. The CI runner restores .env from a
  # persist directory outside any checkout (actions/checkout cleans ignored
  # files), so fixing the working tree leaves the persisted copy stale — and
  # bootstrap-managed.sh's `account` phase short-circuits on "already in .env",
  # unable to tell a stale ref from a good one. e2e-managed #27 failed exactly
  # that way, uploading task env to a project ref belonging to a destroyed
  # instance, hours after the working checkout had been repaired.
  #
  # Compared rather than announced unconditionally: a line printed every time
  # is a line nobody reads. This speaks only when the two copies disagree.
  PERSIST_DIR="${MANAGED_ENV_PERSIST_DIR:-$HOME/.persistent/ownpace-managed}"
  if [ -f "${PERSIST_DIR}/.env" ] && ! cmp -s "$ENV_FILE" "${PERSIST_DIR}/.env"; then
    echo "[trigger-credentials]" >&2
    echo "[trigger-credentials] WARNING: ${PERSIST_DIR}/.env differs and is what CI restores." >&2
    echo "[trigger-credentials] It still holds whatever credentials it had; this run did not touch it." >&2
    echo "[trigger-credentials]   cp ${ENV_FILE} ${PERSIST_DIR}/.env" >&2
  fi
fi
