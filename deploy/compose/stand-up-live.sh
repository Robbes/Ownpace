#!/usr/bin/env bash
# stand-up-live.sh — the first bring-up of ownpace-live, guided and resumable
# (workplan 0132 T1b to T1e, with T2's password check and T5).
#
# LIVE IS STOOD UP ONCE, AND DEPLOYED EVER AFTER. deploy-live.sh does every
# deploy after the first, and cannot do the first: it reads the hold from
# live's own database, which does not exist yet; a hold is opened in the web
# app by an operator, who does not exist yet either; and it takes the
# bring-up's "your turn" stops for a deploy that did not take. So the first
# time is bootstrap-managed.sh run phase by phase from a checkout parked on a
# release tag, with the steps around it that only live has. This script is
# those steps, in order, each one refusing what would be hard to undo.
#
# RUN IT FROM ~/ownpace-live, the checkout the daily-duties timer runs, parked
# (detached) on the release tag live is to run, with deploy/compose/.env a
# link to live's persisted .env (~/.persistent/<project>/.env, <project>
# being ownpace-live) holding COMPOSE_PROJECT_NAME=ownpace-live,
# STACK_KIND=production and live's settings. docs/managed-bring-up.md,
# "Standing up ownpace-live", has the steps before it that are the owner's
# alone: the machine, the ports, the routes, the checkout and the .env.
#
# IT REFUSES, BEFORE ANYTHING CHANGES, each with its own message and exit 1:
#
#   --with-demo anywhere: live never has the demo (0132 T5)
#   a shell started under tracing (bash -x, or xtrace in SHELLOPTS), which
#       would print every password this handles; COMPOSE_FILE or
#       COMPOSE_ENV_FILES in the shell; a COMPOSE_PROJECT_NAME there that the
#       checkout does not choose (compose_project); MANAGED_ENV_PERSIST_DIR
#       naming another directory than live's
#   a checkout that is not ~/ownpace-live
#   a deploy/compose/.env that is not a link to live's persisted .env, or one
#       whose file is missing; one without live's marker exactly
#       (stack_is_live) or without COMPOSE_PROJECT_NAME=ownpace-live
#   a HEAD on a branch, or at no tag named v…, or at a tag release-tag.sh
#       refuses (the rule deploy-live.sh applies: on origin, the same object
#       here, annotated, package.json's version); a tag without deploy-live.sh,
#       exposure-check.sh, box-duties.sh and stack-kind.sh
#   a working tree that is not clean
#   a deploy log with a line in it: live stands, and deploy-live.sh is the way
#   <project>_postgres_data already there, unless --resume says this is a
#       stand-up that stopped for you; a daemon that cannot list the volumes
#   in live's .env, every one named at once, by its key and never its value:
#       a line setting a key in a form env_value does not read and Compose
#       does (indented, a space before '=', or ':' for '='), which would set
#       what this checks empty behind its back; WEB_BIND, ZITADEL_BIND or
#       STATUS_BIND empty; POSTGRES_BIND, API_BIND or TRIGGER_BIND set; a bind
#       that is not one IPv4 address; any of the nine *_PORT (MAILPIT_PORT
#       among them) empty, one of the OTA stack's ports whatever its key (each
#       *_PORT its persisted .env sets, and the rest at the compose files'
#       default, NEXTCLOUD_PORT and the site's WWW_PORT among them), shared by
#       two keys, or, on a first run, in use on the machine; a port live
#       publishes (the nine, WWW_PORT while WWW_LIVE=true, 0139 T10's switch
#       once it lands, and any other *_PORT a `ports:` entry of managed.yml
#       names but the demo's) inside
#       the kernel's ephemeral port range and not reserved (check_ephemeral:
#       an outgoing connection can take it first), on a resume too;
#       TRIGGER_API_ORIGIN not on TRIGGER_PORT; TRIGGER_APP_ORIGIN or
#       TRIGGER_LOGIN_ORIGIN not on TRIGGER_TLS_PORT; TRIGGER_CLI_PROFILE
#       empty, the default, or the OTA stack's; an EXPOSURE_ALLOW that
#       exposure-check.sh refuses, or with which it would fail an address
#       either stack binds on (asked of exposure-check.sh itself, so loopback
#       needs no entry); WEB_URL
#       or CORS_ORIGIN not https://app.ownpace.eu; the identity provider not
#       at id.ownpace.eu on 443, secure, TLS ended in front; NODE_ENV not
#       production; TRUST_PROXY not a count of at least 2, the proxies in
#       front of the api (NetBird's and the web container's nginx, so the
#       api's log names the visitor: T3 (d)); BACKUP_RETENTION_DAYS empty, 0
#       or not a whole number above 0 (the most days a dump of live's
#       databases taken before a deploy is kept: 7, workplan 0134; the dump
#       and its deletion are the owner's steps, which nothing does yet);
#       OWNPACE_REACHABLE_HOSTS set;
#       APP_DB_USER not app_user; a gate placeholder client (gate-…,
#       gatedropboxappkey); SMTP_HOST empty or mailpit, SMTP_PORT empty or
#       not a port, NOTIFY_FROM or NOTIFY_TO empty or an address in .invalid,
#       any of those four in double quotes (live has a real relay from its
#       first day and no catcher: 0133); a database password a URL
#       cannot carry as it is; a password empty or published whose volume
#       exists
#   the three production names not resolving from this machine: the bring-up
#       reaches id.ownpace.eu by its name, so the routes come first (T1e)
#
# WHAT IT DOES, in order. Every step asks whether it is done first, so a run
# with --resume after a stop picks up without a state file.
#
#   1. POSTGRES_PASSWORD, APP_DB_PASSWORD, CLICKHOUSE_PASSWORD,
#      MINIO_ROOT_PASSWORD and TRIGGER_DB_PASSWORD (D8, T2): each one empty or
#      published, and whose volume does not exist yet, gets `openssl rand -hex
#      24`, written through `env-upsert.sh --stdin`. A value the owner set is
#      kept. No value is on any command line or printed.
#   2. bootstrap-managed.sh --only preflight, --only env (the other secrets;
#      it never rotates one), then DOCKER_RUNNER_NETWORKS as Compose renders
#      it must be <project>_ownpace-network (D9), then --only data.
#   3. app_user, created from APP_DB_PASSWORD before anything migrates, the
#      statement on psql's stdin: the baseline migration creates it with the
#      password this repository publishes only when it does not exist.
#   4. T2 step 2's check, over live's own network, the way every container
#      reaches Postgres: the two controls (the owner and app_user with .env's
#      values) must open, and the three published values must not, for the
#      owner, openmigrate and app_user. PGPASSWORD goes to `docker run` by
#      name.
#   5. bootstrap-managed.sh --from trigger. It stops twice for you (exit 2):
#      live's own Trigger.dev account, organisation and project on its
#      dashboard, then the deploy CLI's login under live's own profile. This
#      says what to do and exits 2; run it again with --resume.
#   6. apps/worker/package.json put back when the task deploy changed only its
#      last newline (deploy-live.sh refuses a tree that is not clean).
#   7. The checks, all of them, then the verdict: /api/version at
#      app.ownpace.eu names the tag's commit and version, /api/ready answers
#      200, /api/auth/mode answers managed, NODE_ENV is production in the api
#      container, id.ownpace.eu names itself as the issuer, live's two
#      networks are there and share no container with the OTA stack's, and
#      exposure-check.sh passes. Any failure exits 3 and logs nothing.
#   8. The first line of the deploy log, in deploy-live.sh's format:
#      <UTC date> <tag> <commit> took one-way, in live's persisted directory.
#   9. The timer's two units copied to ~/.config/systemd/user and systemd told
#      (daemon-reload). Enabling it, and `loginctl enable-linger`, which needs
#      sudo, are the owner's.
#  10. What is left, and only the owner can do: sign up, become the operator,
#      the timer, the hold and deploy-live.sh --dry-run rehearsal, the outside
#      probe's variable and NetBird's sign-in off (0139, item 8), the logs
#      checked for the visitor's address (T3 (d)), and the record in 0132's
#      Status block.
#
# WHAT IT PRINTS. Never a value from the .env, never an address and never a
# port: a refusal names the key. One exception: a port in the ephemeral range
# that is not reserved is named with its number, and so are the ports its fix
# lists, since the file that fixes it cannot be written without them. That
# refusal is for the person standing live up, on the machine: paste it nowhere
# public. Nothing that runs this may use `set -x`, and it refuses to run
# traced.
#
# Usage:  ./deploy/compose/stand-up-live.sh [--resume]     from ~/ownpace-live
#
# Exit: 0 live stands; 1 refused (nothing changed); 2 your turn (do what it
#       says, then run it again with --resume); 3 a step after the start
#       failed (fix it, then --resume).
#
# Env overrides:
#   STAND_UP_LIVE_CHECK_TRIES     tries per HTTP check (default 5)
#   STAND_UP_LIVE_CHECK_INTERVAL  seconds between them (default 3)
#   STAND_UP_LIVE_PROC_NET_DIR    where ip_local_port_range and
#                                 ip_local_reserved_ports are read (default
#                                 /proc/sys/net/ipv4; the guard's fixtures)
set -euo pipefail
# Before anything else: was this started traced? Then stop tracing, and refuse
# below, before a value is read.
case "$-" in *x*) STARTED_TRACED=1 ;; *) STARTED_TRACED=0 ;; esac
set +x

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

for helper in env-read.sh stack-kind.sh release-tag.sh; do
  if [ ! -f "${SCRIPT_DIR}/${helper}" ]; then
    printf '[stand-up-live] refused: deploy/compose/%s is not in this checkout, and this script needs it. The tag is older than this script; stand live up from a release cut after it.\n' "$helper" >&2
    exit 1
  fi
done
# env_value, the one reader of a compose .env, and compose_project.
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# Live's marker, named once.
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"
# What a release tag is, the rule deploy-live.sh applies.
# shellcheck source=deploy/compose/release-tag.sh
. "${SCRIPT_DIR}/release-tag.sh"

LIVE_PROJECT=ownpace-live
LIVE_APP=app.ownpace.eu
LIVE_IDP=id.ownpace.eu
LIVE_STATUS=status.ownpace.eu
# Every port a script that brings live up can publish, Mailpit's included.
# ONE RULE DECIDES WHICH: a service is live's when bootstrap-managed.sh starts
# it for a setting live's .env can hold. It names its services and never runs
# a bare `up` (phase_app), so what a bare `up` would start decides nothing.
# Live runs no catcher (its SMTP_HOST is a relay, 0133), but bootstrap starts
# one whenever SMTP_HOST is mailpit (catcher_needed, 0133 T3 (b)): this script
# refuses that, deploy-live.sh does not check it, and the guide keeps the
# by-hand procedure for live in case the owner's answer changes. So
# MAILPIT_PORT is set apart from the OTA stack's like the rest, whose default,
# 3127, it would otherwise take.
LIVE_PORT_KEYS=(POSTGRES_PORT TRIGGER_PORT TRIGGER_TLS_PORT ZITADEL_PORT API_PORT WEB_PORT STATUS_PORT REGISTRY_PORT MAILPIT_PORT)
# A port managed.yml publishes that live never does, by the same rule: the
# demo's Nextcloud starts only with --with-demo, which this script and
# deploy-live.sh both refuse (T5).
DEMO_PORT_KEYS=' NEXTCLOUD_PORT '
# The site's switch, once workplan 0139 T10 lands: on its own branch, not
# merged on 2026-09-28, deploy-live.sh serves live's copy of www.ownpace.eu on
# WWW_PORT while WWW_LIVE=true. Until it lands no script reads WWW_LIVE and
# managed.env.example does not define it, so nothing here asks WWW_PORT. The
# guard checks the name and the value against that script's once it is here.
SITE_SWITCH_KEY=WWW_LIVE
# What a tag must carry for live to be deployed, checked and kept after this.
TAG_MUST_CARRY=(deploy-live.sh exposure-check.sh box-duties.sh stack-kind.sh)
# Each password this may generate, and the volume that takes it at its first
# initialisation and keeps it.
PASSWORDS=(
  'POSTGRES_PASSWORD postgres_data'
  'APP_DB_PASSWORD postgres_data'
  'CLICKHOUSE_PASSWORD clickhouse_data_v2'
  'MINIO_ROOT_PASSWORD minio_data'
  'TRIGGER_DB_PASSWORD trigger_db_data'
)
# managed.yml puts these in a URL, so only characters a URL carries as they are.
URL_PASSWORDS=' POSTGRES_PASSWORD APP_DB_PASSWORD CLICKHOUSE_PASSWORD TRIGGER_DB_PASSWORD '
# Values this repository publishes for one password or another.
PUBLISHED_PASSWORDS=' app_password openmigrate_password trigger_password password very-safe-password '
# The .env named to Compose, so that it reads the file checked below.
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml" --env-file "${ENV_FILE}")
CHECK_TRIES="${STAND_UP_LIVE_CHECK_TRIES:-5}"
CHECK_INTERVAL="${STAND_UP_LIVE_CHECK_INTERVAL:-3}"
PROC_NET_DIR="${STAND_UP_LIVE_PROC_NET_DIR:-/proc/sys/net/ipv4}"
RESUME_LINE='./deploy/compose/stand-up-live.sh --resume'

# Set by main.
COMPOSE_PROJECT=''
OTA_PROJECT=''
VOLUMES=''

say() { printf '[stand-up-live] %s\n' "$@"; }
refuse() {
  printf '[stand-up-live] refused: %s\n' "$1" >&2
  shift
  [ "$#" -eq 0 ] || printf '  %s\n' "$@" >&2
  printf '[stand-up-live] Nothing was changed: no value in .env, no volume, no container.\n' >&2
  exit 1
}
# After the first change: say what stopped it, and how to carry on.
stopped() {
  printf '[stand-up-live] stopped: %s\n' "$1" >&2
  shift
  [ "$#" -eq 0 ] || printf '  %s\n' "$@" >&2
  printf '[stand-up-live] Fix that, then run this again: %s\n' "$RESUME_LINE" >&2
  exit 3
}

# persisted_dir <project> — where a stack keeps its .env, dumps and deploy log:
# ~/.persistent/<project> (workplan 0132 T1).
persisted_dir() { printf '%s/%s' "${HOME}/.persistent" "$1"; }

main() {
  local arg resume=''
  [ "$STARTED_TRACED" = 0 ] ||
    refuse "this was started with tracing on (bash -x, or xtrace exported through SHELLOPTS). Tracing prints every value a script handles, and this one generates live's database passwords." \
      "Run it as ./deploy/compose/stand-up-live.sh from a shell without set -x."
  for arg in "$@"; do
    if [ "$arg" = --with-demo ]; then
      refuse "--with-demo. ownpace-live never has the demo: it creates organisations with fixed, published credentials (workplan 0132 T5)." \
        "This script runs the bring-up without it. Run it with no argument, or with --resume."
    fi
  done
  for arg in "$@"; do
    case "$arg" in
      --resume) resume=1 ;;
      -h | --help)
        sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed '$d'
        exit 0
        ;;
      *) refuse "unknown argument '${arg}'." "Usage: ./deploy/compose/stand-up-live.sh [--resume]   (from ~/${LIVE_PROJECT}; --help for more)" ;;
    esac
  done

  # ---- The shell ----------------------------------------------------------------
  for arg in COMPOSE_ENV_FILES COMPOSE_FILE; do
    if [ -n "${!arg+set}" ]; then
      refuse "this shell has ${arg} set. The bring-up's Compose would follow it to another stack's files instead of this checkout's." \
        "Open a new shell (or: unset ${arg}) and run this again."
    fi
  done
  local persist
  persist="$(persisted_dir "$LIVE_PROJECT")"
  if [ -n "${MANAGED_ENV_PERSIST_DIR:-}" ] && [ "${MANAGED_ENV_PERSIST_DIR%/}" != "$persist" ]; then
    refuse "this shell has MANAGED_ENV_PERSIST_DIR set to another directory than ${persist}. The bring-up would look for live's .env and keep its dumps there, and the timer and deploy-live.sh look in ${persist}." \
      "Open a new shell (or: unset MANAGED_ENV_PERSIST_DIR) and run this again."
  fi

  # ---- The checkout: ~/ownpace-live --------------------------------------------
  local here want
  here="$(cd "$REPO_ROOT" && pwd -P)"
  want="$(cd "${HOME}/${LIVE_PROJECT}" 2>/dev/null && pwd -P)" || want=''
  if [ -z "$want" ] || [ "$here" != "$want" ]; then
    refuse "this checkout is not ~/${LIVE_PROJECT}. Live's checkout is there and nowhere else: its daily-duties timer runs ~/${LIVE_PROJECT}/deploy/compose/box-duties.sh (workplan 0132 T1b step 1, T7)." \
      "Clone it there (docs/managed-bring-up.md, \"Standing up ownpace-live\"), and run this from it."
  fi

  # ---- The .env: live's own, linked to where it persists ------------------------
  local target persisted_env
  persisted_env="${persist}/.env"
  if [ ! -L "$ENV_FILE" ]; then
    refuse "${ENV_FILE} is not a link. Live's .env is ${persisted_env}, and the checkout's deploy/compose/.env links to it, so a checkout of another tag keeps it (workplan 0132 T1b step 2)." \
      "Copy it there first, then link it: docs/managed-bring-up.md, \"Standing up ownpace-live\"."
  fi
  target="$(readlink -f "$ENV_FILE" 2>/dev/null)" || target=''
  if [ -z "$target" ] || [ "$target" != "$(readlink -f "$persisted_env" 2>/dev/null || true)" ]; then
    refuse "${ENV_FILE} links somewhere other than ${persisted_env}, live's persisted .env (workplan 0132 T1b step 2)." \
      "Point it there: ln -sfn ${persisted_env} ${ENV_FILE}"
  fi
  if [ ! -f "$target" ]; then
    refuse "${persisted_env}, which ${ENV_FILE} links to, does not exist yet." \
      "Copy managed.env.example there first, then fill it in: docs/managed-bring-up.md, \"Standing up ownpace-live\"."
  fi
  if ! stack_is_live "$ENV_FILE"; then
    refuse "${ENV_FILE} does not carry ${STACK_KIND_KEY}=${STACK_KIND_LIVE}, live's marker (stack-kind.sh). Its value, if any, is not printed." \
      "Add it beside the project's name (workplan 0132 T1b step 2):" \
      "  ./deploy/compose/env-upsert.sh deploy/compose/.env COMPOSE_PROJECT_NAME=${LIVE_PROJECT} ${STACK_KIND_KEY}=${STACK_KIND_LIVE}"
  fi
  if [ "$(env_value "$ENV_FILE" COMPOSE_PROJECT_NAME)" != "$LIVE_PROJECT" ]; then
    refuse "${ENV_FILE} does not carry COMPOSE_PROJECT_NAME=${LIVE_PROJECT}. Its value, if any, is not printed. Without it every name this bring-up makes is another stack's (workplan 0132 T1)." \
      "  ./deploy/compose/env-upsert.sh deploy/compose/.env COMPOSE_PROJECT_NAME=${LIVE_PROJECT}"
  fi
  # The one reader of the project (env-read.sh, 0132 T1). It refuses a shell
  # whose COMPOSE_PROJECT_NAME the checkout does not choose.
  COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || refuse "the checkout's project could not be read (above)."
  [ "$COMPOSE_PROJECT" = "$LIVE_PROJECT" ] || refuse "this checkout drives the project '${COMPOSE_PROJECT}', not ${LIVE_PROJECT}."
  # The OTA stack's project is managed.yml's own name (0132 T1).
  OTA_PROJECT="$(sed -n 's/^name:[[:space:]]*\([^[:space:]#]*\).*/\1/p' "${SCRIPT_DIR}/managed.yml")"

  # ---- The tag: a release, parked on -------------------------------------------
  local branch dirty head tags_text tag='' t head_version f
  local -a missing=()
  if branch="$(git -C "$REPO_ROOT" symbolic-ref -q --short HEAD)"; then
    refuse "HEAD is on the branch '${branch}', not detached at a release tag. ${RELEASE_SENTENCE}." \
      "Live's checkout is parked on the tag it runs: git fetch --tags origin && git checkout --detach <tag>"
  fi
  dirty="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)" ||
    refuse "git could not read the working tree of ${REPO_ROOT}."
  if [ -n "$dirty" ]; then
    refuse "the working tree is not clean. Live runs what the tag holds, and deploy-live.sh refuses a tree that is not clean:" \
      "$dirty" \
      "Look at each (git status, git diff). The task deploy is known to strip apps/worker/package.json's last newline; discard that with git checkout -- apps/worker/package.json."
  fi
  head="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  tags_text="$(git -C "$REPO_ROOT" tag --points-at HEAD --list 'v*')" || refuse "git could not list the tags at HEAD."
  if [ -z "$tags_text" ]; then
    refuse "HEAD (${head}) is at no tag named v…. ${RELEASE_SENTENCE}." \
      "Check out the release live is to run: git fetch --tags origin && git checkout --detach <tag>"
  fi
  # Of the tags here, the one package.json names, when there are several.
  head_version="$(release_tag_version_at "$REPO_ROOT" "$head")" || head_version=''
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    [ -n "$tag" ] || tag="$t"
    [ "$t" != "v${head_version}" ] || tag="$t"
  done <<<"$tags_text"
  release_tag_on_origin "$REPO_ROOT" "$tag" || refuse "${RELEASE_TAG_WHY[@]}"
  release_tag_is_release "$REPO_ROOT" "$tag" "$RELEASE_TAG_REMOTE_OBJECT" || refuse "${RELEASE_TAG_WHY[@]}"
  local commit="$RELEASE_TAG_COMMIT" version="$RELEASE_TAG_VERSION"
  [ "$commit" = "$head" ] || refuse "${tag} is at ${commit}, and HEAD at ${head}."
  for f in "${TAG_MUST_CARRY[@]}"; do
    git -C "$REPO_ROOT" cat-file -e "${commit}:deploy/compose/${f}" 2>/dev/null || missing+=("deploy/compose/${f}")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    refuse "${tag} does not carry ${missing[*]}. Live is deployed, checked and kept by them after this (workplan 0132 T3, T6, T7)." \
      "Cut the release from a commit of main that has them (docs/release.md §2)."
  fi
  say "${tag} is an annotated release tag on origin, at ${commit}, version ${version}"

  # ---- Stood up already? ----------------------------------------------------------
  local deploy_log="${persist}/deploys.log"
  if [ -s "$deploy_log" ]; then
    refuse "${deploy_log} already has a line: live has been stood up. This script is for its first bring-up only." \
      "Every deploy after the first is deploy-live.sh (docs/managed-bring-up.md, \"ownpace-live: a release tag, with deploy-live.sh\")."
  fi
  [ -w "$persist" ] || refuse "${persist} is not writable, and the first line of live's deploy log goes there."

  # ---- Live's database: new, or a stand-up that stopped --------------------------
  VOLUMES="$(docker volume ls -q --filter "name=${COMPOSE_PROJECT}_")" ||
    refuse "docker could not list the volumes (above), so this cannot tell whether live has a database already. A daemon that does not answer is not one without volumes."
  if has_volume postgres_data && [ -z "$resume" ]; then
    refuse "${COMPOSE_PROJECT}_postgres_data exists: live has a database already." \
      "If this is a stand-up that stopped for you (it exits 2 and says so), run it again with --resume: ${RESUME_LINE}" \
      "If live is running, this is not the script to run: deploy-live.sh is."
  fi
  if [ -n "$resume" ]; then
    say "resuming: each step below asks whether it is done before it does anything"
  fi

  # ---- Live's .env, key by key ------------------------------------------------------
  local -a problems=()
  local -a generate=()
  check_settings problems
  check_ports problems "$( has_volume postgres_data && echo resume || echo first )"
  check_ephemeral problems
  check_names problems
  check_passwords problems generate
  if [ "${#problems[@]}" -gt 0 ]; then
    refuse "live's .env is not ready for its first bring-up. Each line names a key or a name and no value, but for a port in the ephemeral range, which its fix has to list; docs/managed-bring-up.md, \"Standing up ownpace-live\", says what each should be:" \
      "${problems[@]/#/- }"
  fi
  say "every refusal passed: ${tag}, live's .env, its ports and its names"

  # ==== From here on, things change. =================================================

  # ---- 1. The database passwords (D8) ------------------------------------------------
  if [ "${#generate[@]}" -gt 0 ]; then
    local key secret pairs=''
    for key in "${generate[@]}"; do
      secret="$(openssl rand -hex 24)" || refuse "openssl rand failed (above). Nothing was written to .env."
      [[ "$secret" =~ ^[0-9a-f]{48}$ ]] || refuse "openssl rand -hex 24 did not give 48 hex characters. Nothing was written to .env."
      pairs+="${key}=${secret}"$'\n'
    done
    secret=''
    if ! printf '%s' "$pairs" | "${SCRIPT_DIR}/env-upsert.sh" --stdin "$ENV_FILE" >/dev/null; then
      pairs=''
      refuse "env-upsert.sh could not write the passwords into live's .env (above)."
    fi
    pairs=''
    say "generated ${generate[*]} on this machine, into live's .env; no value was printed (workplan 0132 D8)"
  else
    say "the database passwords are live's own already; none was generated"
  fi

  # ---- 2. The first half of the bring-up ------------------------------------------
  bring_up --only preflight
  bring_up --only env
  check_runner_network
  bring_up --only data

  # ---- 3. app_user, before anything migrates --------------------------------------
  create_app_user

  # ---- 4. The passwords, asked the way every container asks (T2 step 2) -------------
  check_db_passwords

  # ---- 5. Trigger.dev, the account, the login, the app and the tasks ---------------
  local rc=0
  say "bootstrap-managed.sh --from trigger (never --with-demo)"
  "${SCRIPT_DIR}/bootstrap-managed.sh" --from trigger || rc=$?
  # ---- 6. What the task deploy leaves behind ------------------------------------------
  restore_worker_newline
  if [ "$rc" -eq 2 ]; then
    if [ -z "$(env_value "$ENV_FILE" TRIGGER_PROJECT_REF)" ] || [ -z "$(env_value "$ENV_FILE" TRIGGER_SECRET_KEY)" ]; then
      your_turn_account
    fi
    your_turn_login
  elif [ "$rc" -ne 0 ]; then
    stopped "bootstrap-managed.sh --from trigger failed (exit ${rc}, above)."
  fi

  # ---- 7. The checks ------------------------------------------------------------------
  local -a failures=()
  run_checks failures "$commit" "$version"
  if [ "${#failures[@]}" -gt 0 ]; then
    stopped "live is up and did not pass every check. Nothing was logged; the stand-up is not finished:" "${failures[@]}"
  fi

  # ---- 8. The first line of the deploy log --------------------------------------------
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ)"$'\t'"${tag}"$'\t'"${commit}"$'\t'took$'\t'one-way
  echo
  say "ownpace-live stands: ${tag} (${commit}) is up, and answered every check."
  if { printf '%s\n' "$line" >>"$deploy_log"; } 2>/dev/null; then
    say "Logged in ${deploy_log} as took, one-way, in deploy-live.sh's format: the next deploy is compared with it."
  else
    say "could not append to ${deploy_log}. Add this line to it by hand, or deploy-live.sh compares the next tag with the checkout alone:" "$line"
  fi

  # ---- 9. The timer's units -------------------------------------------------------------
  local timer_note
  timer_note="$(install_timer_units)"

  # ---- 10. What is left, and only the owner can do ------------------------------------------
  owner_steps "$tag" "$timer_note"
}

# has_volume <name> — true when this stack has the volume <project>_<name>,
# from the listing main made.
has_volume() {
  grep -qx -- "${COMPOSE_PROJECT}_$1" <<<"$VOLUMES"
}

# compose_default <KEY> — the default the compose files give ${KEY:-…}
# (managed.yml, then the site's www.yml), or nothing.
compose_default() {
  local f value
  for f in "${SCRIPT_DIR}/managed.yml" "${SCRIPT_DIR}/www.yml"; do
    [ -f "$f" ] || continue
    value="$(sed -n "/\${${1}:-/{s/.*\${${1}:-\([^}]*\)}.*/\1/p;q}" "$f")"
    if [ -n "$value" ]; then
      printf '%s' "$value"
      return 0
    fi
  done
}

# origin_port <origin> — the port written in it, or nothing.
origin_port() {
  local o="${1#*://}"
  o="${o%%/*}"
  case "$o" in
    *:*) printf '%s' "${o##*:}" ;;
  esac
}

# is_ipv4 <value> — one IPv4 address, and not every interface.
is_ipv4() {
  local octet
  [[ "$1" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  [ "$1" != 0.0.0.0 ] || return 1
  for octet in "${BASH_REMATCH[@]:1}"; do
    if [[ "$octet" =~ ^0[0-9] ]] || [ "$octet" -gt 255 ]; then return 1; fi
  done
}

# keys_ending <env-file> <suffix> — every key the file sets whose name ends in
# <suffix> (_BIND, _PORT), one per line.
keys_ending() {
  [ -f "$1" ] || return 0
  sed -n "s/^\\(export[[:space:]][[:space:]]*\\)\\{0,1\\}\\([A-Za-z_][A-Za-z0-9_]*${2}\\)=.*/\\2/p" "$1" | sort -u
}

# unread_keys <env-file> — each line that sets a key in a form env_value does
# not read and Compose does: indented, a space before '=', or YAML's ':' for
# '=' (compose-go's dotenv takes all three, and bash the indented one). As
# <line>:<key>, one per line. Only the key's name is taken from the line, never
# its value: the awk test stack_may_be_live makes for the marker, for every key.
unread_keys() {
  [ -f "$1" ] || return 0
  awk '
    /^(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=/ { next }
    match($0, /^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*[=:]/) {
      key = substr($0, 1, RLENGTH)
      sub(/^[[:space:]]*(export[[:space:]]+)?/, "", key)
      sub(/[[:space:]]*[=:]$/, "", key)
      print NR ":" key
    }' "$1"
}

# check_settings <problems-array> — every setting of live's .env that is wrong
# for live, by its key.
check_settings() {
  local -n _p="$1"
  local key value ota_env profile default_profile smtp line
  ota_env="$(persisted_dir "$OTA_PROJECT")/.env"

  # First, a line every check below would miss: env_value reads the key at the
  # start of its line, Compose reads it indented too, and the last one wins.
  # An indented POSTGRES_BIND=<address> after the example's empty one would
  # publish Postgres while this read it empty.
  while IFS=: read -r line key; do
    [ -n "$line" ] || continue
    _p+=("${key}: set on line ${line} in a form this script does not read (indented, a space before '=', or ':' for '='), and Compose reads it all the same. Write it KEY=value at the start of its line.")
  done <<<"$(unread_keys "$ENV_FILE")"

  for key in WEB_BIND ZITADEL_BIND STATUS_BIND; do
    [ -n "$(env_value "$ENV_FILE" "$key")" ] ||
      _p+=("${key}: empty. The production names are routed to the front's address, and without a bind there the port answers on 127.0.0.1 only (workplan 0132 T1b step 3, T1e).")
  done
  for key in POSTGRES_BIND API_BIND TRIGGER_BIND; do
    [ -z "$(env_value "$ENV_FILE" "$key")" ] ||
      _p+=("${key}: set. It stays empty on live: nothing off this machine needs that port (T1b step 3).")
  done
  # Each bind against EXPOSURE_ALLOW, as exposure-check.sh reads the list
  # (exposure_passes): first whether it reads the list at all.
  local allow_read=1 rc=0
  exposure_passes 127.0.0.1 || rc=$?
  case "$rc" in
    0) ;;
    2)
      allow_read=''
      _p+=("EXPOSURE_ALLOW: exposure-check.sh refuses it: ${EXPOSURE_REFUSED} Step 7 runs that check, and would stop there, after the bring-up (workplan 0132 T3).")
      ;;
    *)
      allow_read=''
      _p+=("EXPOSURE_ALLOW: deploy/compose/exposure-check.sh could not be run (exit ${rc}), so whether it passes live's binds cannot be asked.")
      ;;
  esac
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    value="$(env_value "$ENV_FILE" "$key")"
    [ -n "$value" ] || continue
    if ! is_ipv4 "$value"; then
      _p+=("${key}: not one IPv4 address. A bind takes an IP address of this machine, never a name and never every interface (docs/managed-bring-up.md, \"Which address a port answers on\").")
      continue
    fi
    [ -n "$allow_read" ] || continue
    exposure_passes "$value" ||
      _p+=("EXPOSURE_ALLOW: does not list the address in live's ${key}. exposure-check.sh reads every container on the machine, and fails each port published on an address the list does not name, loopback aside (workplan 0132 T3).")
  done <<<"$(keys_ending "$ENV_FILE" _BIND)"
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    value="$(env_value "$ota_env" "$key")"
    [ -n "$value" ] || continue
    [ -n "$allow_read" ] || continue
    exposure_passes "$value" ||
      _p+=("EXPOSURE_ALLOW: with it, exposure-check.sh would fail a port on the address in the OTA stack's ${key}. The check reads both stacks at once, so the list is every address any container on the machine is published on, loopback aside (workplan 0132 T3).")
  done <<<"$(keys_ending "$ota_env" _BIND)"

  value="$(env_value "$ENV_FILE" TRIGGER_PORT)"
  if [ -z "$value" ] || [ "$(origin_port "$(env_value "$ENV_FILE" TRIGGER_API_ORIGIN)")" != "$value" ]; then
    _p+=("TRIGGER_API_ORIGIN: its port is not TRIGGER_PORT. set-task-env.sh and deploy-tasks.sh send live's settings and tasks there; on another port they reach whichever plane answers, the OTA stack's (T1c).")
  fi
  value="$(env_value "$ENV_FILE" TRIGGER_TLS_PORT)"
  for key in TRIGGER_APP_ORIGIN TRIGGER_LOGIN_ORIGIN; do
    if [ -z "$value" ] || [ "$(origin_port "$(env_value "$ENV_FILE" "$key")")" != "$value" ]; then
      _p+=("${key}: not on TRIGGER_TLS_PORT, where live's own dashboard answers (T1c).")
    fi
  done
  profile="$(env_value "$ENV_FILE" TRIGGER_CLI_PROFILE)"
  default_profile="$(env_value "${SCRIPT_DIR}/trigger-cli-lib.sh" TRIGGER_CLI_PROFILE_DEFAULT)"
  if [ -z "$profile" ] || [ "$profile" = "$default_profile" ]; then
    _p+=("TRIGGER_CLI_PROFILE: empty or the default. Live logs the deploy CLI in under a profile of its own, so a login to one plane is never used against the other (T1c).")
  elif [ "$profile" = "$(env_value "$ota_env" TRIGGER_CLI_PROFILE "$default_profile")" ]; then
    _p+=("TRIGGER_CLI_PROFILE: the OTA stack's too. Each plane has its own login (T1c).")
  fi

  [ "$(env_value "$ENV_FILE" WEB_URL)" = "https://${LIVE_APP}" ] ||
    _p+=("WEB_URL: not https://${LIVE_APP}, live's production name (T1b step 4).")
  [ "$(env_value "$ENV_FILE" CORS_ORIGIN)" = "https://${LIVE_APP}" ] ||
    _p+=("CORS_ORIGIN: not https://${LIVE_APP}, live's production name (T1b step 4).")
  [ "$(env_value "$ENV_FILE" ZITADEL_EXTERNALDOMAIN)" = "$LIVE_IDP" ] ||
    _p+=("ZITADEL_EXTERNALDOMAIN: not ${LIVE_IDP}. It goes into every token's issuer at the provider's first start, and cannot be changed after (T1d).")
  [ "$(env_value "$ENV_FILE" ZITADEL_EXTERNALPORT)" = 443 ] ||
    _p+=("ZITADEL_EXTERNALPORT: not 443, the port browsers reach ${LIVE_IDP} on (T1b step 4).")
  [ "$(env_value "$ENV_FILE" ZITADEL_EXTERNALSECURE)" = true ] ||
    _p+=("ZITADEL_EXTERNALSECURE: not true: the issuer is https (T1b step 4).")
  [ "$(env_value "$ENV_FILE" ZITADEL_TLS_MODE)" = external ] ||
    _p+=("ZITADEL_TLS_MODE: not external: TLS ends in front of the provider (T1b step 4).")
  [ "$(env_value "$ENV_FILE" NODE_ENV)" = production ] ||
    _p+=("NODE_ENV: not production (T4).")
  # The visitor's address in the api's log and its per-caller limit (the
  # owner, 2026-09-28, ops-trust-proxy (b); privacy §4.5; T3 (d)). Two proxies
  # stand in front of live's api: NetBird's, which sets X-Forwarded-For to the
  # visitor's address, and the web container's nginx, which appends NetBird's.
  # Empty names the web container for every visitor, 1 names NetBird, and
  # `true` believes whatever a caller sends. A count of 2 or more; T3 (d)'s
  # request with a forged header, on live, says whether it is 2.
  [[ "$(env_value "$ENV_FILE" TRUST_PROXY)" =~ ^([2-9]|[1-9][0-9]+)$ ]] ||
    _p+=("TRUST_PROXY: empty, or not a count of at least 2. Live's api is behind two proxies, NetBird's and the web container's nginx, so it is 2: then the api names the visitor, whose address NetBird passes on, as privacy §4.5 says; with less it names one of the proxies for every visitor (T3 (d)).")
  # Live's databases are dumped before each deploy and each dump is deleted
  # after at most this many days: the owner's answer to 0134's open question
  # 1, (b), with 7 days, on 2026-09-28. Both are the owner's steps for now
  # (0132 T6 step 4; 0134 T0): deploy-live.sh takes no dump, and nothing
  # deletes one. The number is set before the first dump, so it is a whole
  # number above 0 from the first bring-up, and the erasure sentence names it.
  # 0 would say there is no copy; a blank reads as 7 and the api refuses to
  # start on one while OWNPACE_STAGE=alpha.
  [[ "$(env_value "$ENV_FILE" BACKUP_RETENTION_DAYS)" =~ ^[1-9][0-9]*$ ]] ||
    _p+=("BACKUP_RETENTION_DAYS: empty, 0, or not a whole number of days above 0. On live it is the most days a dump of its databases taken before a deploy is kept, 7 (workplan 0134, open question 1 (b)), and the erasure sentence a closing organisation is given names it. Taking the dump and deleting it by then are your steps (0132 T6 step 4): no script takes it or deletes it yet.")
  [ -z "$(env_value "$ENV_FILE" OWNPACE_REACHABLE_HOSTS)" ] ||
    _p+=("OWNPACE_REACHABLE_HOSTS: set. It admits the demo's hosts on the OTA stack; live's stays empty (0136 T2).")
  value="$(env_value "$ENV_FILE" APP_DB_USER)"
  [ -z "$value" ] || [ "$value" = app_user ] ||
    _p+=("APP_DB_USER: not app_user. The migrations grant to app_user by name (workplan 0132 T2 step 5).")
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    case "$(env_value "$ENV_FILE" "$key")" in
      gate-* | gatedropboxappkey)
        _p+=("${key}: the nightly gate's placeholder. Live offers only a client that exists: empty it, or set live's own (0132 T5, 0140).") ;;
    esac
  done <<<"$(sed -n 's/^\(GOOGLE_OAUTH_[A-Z_]*\|DROPBOX_OAUTH_[A-Z_]*\|MICROSOFT_OAUTH_[A-Z_]*\|IDP_GOOGLE_[A-Z_]*\)=.*/\1/p' "$ENV_FILE" | sort -u)"
  # Mail: a real relay from live's first day, and no catcher (the owner's
  # answer to 0133's open questions 1 and 5, 2026-09-28). The sign-up's
  # verification code is the first mail live sends.
  #
  # FIRST, DOUBLE QUOTES. env_value takes off single quotes and not double
  # ones (env-read.sh), so NOTIFY_TO="" reads here as two characters and would
  # pass every check below, while Compose takes the quotes off and hands the
  # containers an empty value; SMTP_HOST="mailpit" would pass as a relay. The
  # quotes cannot be taken off here instead: setup-zitadel.sh reads SMTP_HOST,
  # SMTP_PORT and NOTIFY_FROM with env_value too, and would hand the identity
  # provider a host, a port or a sender with its quotes, so even a real relay
  # in double quotes sends no verification code. NOTIFY_TO, which only Compose
  # and a sourced .env read, is held to the same rule, so the four are written
  # one way. A key in double quotes is refused, and asked nothing more.
  local -A dquoted=()
  for key in SMTP_HOST SMTP_PORT NOTIFY_FROM NOTIFY_TO; do
    case "$(env_value "$ENV_FILE" "$key")" in
      '"'*'"')
        dquoted[$key]=1
        _p+=("${key}: in double quotes. Compose takes them off and hands the containers what is inside, which may be nothing, while env_value, the reader of this script and of setup-zitadel.sh (which gives the identity provider its mail settings), keeps them as part of the value. Write it bare, or in single quotes (workplan 0133).")
        ;;
    esac
  done
  smtp="$(env_value "$ENV_FILE" SMTP_HOST)"
  if [ -z "${dquoted[SMTP_HOST]:-}" ] && { [ -z "$smtp" ] || [ "${smtp,,}" = mailpit ]; }; then
    _p+=("SMTP_HOST: empty or mailpit. Live sends through a real relay from its first bring-up and runs no catcher (workplan 0133): empty sends nothing, and mailpit keeps every mail on this machine, the sign-up's verification code among them.")
  fi
  value="$(env_value "$ENV_FILE" SMTP_PORT)"
  if [ -z "${dquoted[SMTP_PORT]:-}" ] && { ! [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] || [ "$value" -gt 65535 ]; }; then
    _p+=("SMTP_PORT: empty or not a port. The identity provider's mail setup (setup-zitadel.sh) takes 1025, the catcher's port, when it is empty; a relay's submission port is usually 587, with STARTTLS (workplan 0133).")
  fi
  for key in NOTIFY_FROM NOTIFY_TO; do
    [ -z "${dquoted[$key]:-}" ] || continue
    value="$(env_value "$ENV_FILE" "$key")"
    if [ -z "$value" ]; then
      case "$key" in
        NOTIFY_FROM) _p+=("NOTIFY_FROM: empty. It is the address live sends from, the one the relay's login and token are for; without it setup-zitadel.sh leaves the identity provider's mail alone (workplan 0133).") ;;
        *) _p+=("NOTIFY_TO: empty. It is where an access request's notice and the digest go: an address you read (workplan 0133).") ;;
      esac
    elif in_dot_invalid "$value"; then
      _p+=("${key}: an address in .invalid, which a relay refuses or bounces, so nobody would read what live sends (workplan 0133 T3 (c)).")
    fi
  done
}

# in_dot_invalid <addresses> — true when any address of a comma-separated
# list, bare or as `Name <address>`, ends in .invalid, a domain nobody owns.
in_dot_invalid() {
  local a
  local -a list=()
  IFS=',' read -r -a list <<<"$1"
  for a in ${list[@]+"${list[@]}"}; do
    # What may follow the domain: a closing '>', quotes, spaces.
    while :; do
      case "$a" in
        *[[:space:]] | *'>' | *'"' | *"'") a="${a%?}" ;;
        *) break ;;
      esac
    done
    case "${a,,}" in *.invalid) return 0 ;; esac
  done
  return 1
}

# exposure_passes <address> — whether the tag's exposure-check.sh, with live's
# EXPOSURE_ALLOW, would pass a port published on <address>: 0 it would
# (loopback, or an address the list names), 1 it would not, 2 it refuses the
# list itself (EXPOSURE_REFUSED then holds its words, which name an entry by
# its place and never its value), anything else it could not be run.
#
# THE LIST IS READ BY THE CHECK THAT DECIDES. exposure-check.sh runs at step
# 7 and every day after (T3 (b), T7). A reading of the list of this script's
# own accepted less than it does (a list in double quotes, a space after a
# comma), asked for a loopback bind it never needs listed, and passed a list
# it refuses (a name, every interface), which would stop the bring-up at its
# last step. So the address goes to exposure-check.sh as one line of recorded
# `docker ps` output on its stdin (--from -): a container publishing port 1
# there. Only its exit is kept; what it prints names no address anyway.
EXPOSURE_REFUSED=''
exposure_passes() {
  local listing out rc=0
  case "$1" in
    *:*) listing="bind"$'\t'"[$1]:1->1/tcp" ;;
    *) listing="bind"$'\t'"$1:1->1/tcp" ;;
  esac
  out="$("${SCRIPT_DIR}/exposure-check.sh" --env-file "$ENV_FILE" --from - <<<"$listing" 2>&1)" || rc=$?
  if [ "$rc" -eq 2 ]; then
    EXPOSURE_REFUSED="${out%%$'\n'*}"
    EXPOSURE_REFUSED="${EXPOSURE_REFUSED#exposure-check: }"
  fi
  return "$rc"
}

# ota_ports <ota-env-file> — every port the OTA stack publishes or sets, one
# per line: live's nine keys, NEXTCLOUD_PORT, the site's WWW_PORT and every
# other *_PORT its persisted .env sets, each from that .env, or else the
# compose files' default.
ota_ports() {
  local key value
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    value="$(env_value "$1" "$key" "$(compose_default "$key")")"
    [[ "$value" =~ ^[0-9]+$ ]] && printf '%s\n' "$value"
  done <<<"$(
    printf '%s\n' "${LIVE_PORT_KEYS[@]}" NEXTCLOUD_PORT WWW_PORT
    keys_ending "$1" _PORT
  )"
  return 0
}

# check_ports <problems-array> <first|resume> — each of live's ports set, none
# of the OTA stack's whatever its key, not another key's, and on a first run
# not in use.
check_ports() {
  local -n _p="$1"
  local when="$2" key value ota_env listening='' taken
  local -A seen=() ota=()
  ota_env="$(persisted_dir "$OTA_PROJECT")/.env"
  while IFS= read -r taken; do
    [ -z "$taken" ] || ota[$taken]=1
  done <<<"$(ota_ports "$ota_env")"
  if [ "$when" = first ]; then
    if ! command -v ss >/dev/null 2>&1; then
      _p+=("ss: not on this machine (iproute2), so whether live's ports are free cannot be asked.")
    elif ! listening="$(ss -Htln | awk '{ n = split($4, a, ":"); print a[n] }' | sort -u)"; then
      _p+=("ss: could not list the ports in use (above).")
      listening=''
    fi
  fi
  for key in "${LIVE_PORT_KEYS[@]}"; do
    value="$(env_value "$ENV_FILE" "$key")"
    if ! [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] || [ "$value" -gt 65535 ]; then
      _p+=("${key}: empty or not a port. Live sets every port of its own, and none may be the OTA stack's (T1b step 3).")
      continue
    fi
    [ -z "${ota[$value]:-}" ] ||
      _p+=("${key}: one of the OTA stack's ports, under this key or another (its persisted .env, or the compose files' default where that sets none; NEXTCLOUD_PORT and the site's WWW_PORT among them). Two stacks cannot publish one port, and the OTA stack need not be up for this to bite.")
    if [ -n "${seen[$value]:-}" ]; then
      _p+=("${key}: the same port as ${seen[$value]}.")
    else
      seen[$value]="$key"
    fi
    if [ -n "$listening" ] && grep -qx -- "$value" <<<"$listening"; then
      _p+=("${key}: already in use on this machine (ss -tln).")
    fi
  done
}

# live_port_keys — every *_PORT live publishes, one per line: the nine; any
# other key a `ports:` entry of managed.yml names, but the demo's, which live
# never runs (T5); and the site's WWW_PORT while WWW_LIVE=true, the switch with
# which deploy-live.sh serves live's copy of www.ownpace.eu once 0139 T10
# lands (SITE_SWITCH_KEY).
live_port_keys() {
  local key
  local -A seen=()
  while IFS= read -r key; do
    [ -n "$key" ] && [ -z "${seen[$key]:-}" ] || continue
    [[ "$DEMO_PORT_KEYS" != *" ${key} "* ]] || continue
    seen[$key]=1
    printf '%s\n' "$key"
  done <<<"$(
    printf '%s\n' "${LIVE_PORT_KEYS[@]}"
    sed -n 's/^[[:space:]]*-[[:space:]]*"[^"]*\${\([A-Za-z_][A-Za-z0-9_]*_PORT\)[:}].*/\1/p' "${SCRIPT_DIR}/managed.yml"
    [ "$(env_value "$ENV_FILE" "$SITE_SWITCH_KEY")" != true ] || echo WWW_PORT
  )"
}

# port_reserved <port> <list> — true when <list>, the kernel's
# ip_local_reserved_ports (ports and ranges, separated by commas), covers
# <port>.
port_reserved() {
  local port="$1" entry lo hi
  local -a entries=()
  IFS=',' read -r -a entries <<<"$2"
  for entry in ${entries[@]+"${entries[@]}"}; do
    entry="${entry//[[:space:]]/}"
    case "$entry" in
      '') continue ;;
      *-*) lo="${entry%%-*}" hi="${entry#*-}" ;;
      *) lo="$entry" hi="$entry" ;;
    esac
    [[ "$lo" =~ ^[0-9]+$ && "$hi" =~ ^[0-9]+$ ]] || continue
    if [ "$port" -ge "$((10#$lo))" ] && [ "$port" -le "$((10#$hi))" ]; then
      return 0
    fi
  done
  return 1
}

# check_ephemeral <problems-array> — no port live publishes in the kernel's
# ephemeral range unless it is reserved, on a first run and on a resume.
#
# WHY. Linux gives each outgoing connection that does not choose its own
# source port one from net.ipv4.ip_local_port_range (32768 to 60999 unless
# changed): an image pull, a DNS lookup over TCP, a mail to the relay, a
# browser on this machine. A port live publishes inside that range can be
# held that way at the moment Docker binds it, after a reboot or at a
# recreate, and the container that publishes it then fails to start with
# "address already in use". Nothing on the machine is listening there, so the
# `ss` check above cannot see it coming, and it goes away by itself, so a
# retry works and nobody learns why. net.ipv4.ip_local_reserved_ports takes
# ports out of that pool while a program may still bind them on purpose, so a
# port of live's inside the range is refused unless it is listed there. The
# refusal names the port, the one place this script prints one: the fix is a
# line listing it.
check_ephemeral() {
  local -n _p="$1"
  local range reserved low high key value
  local -a caught=() ports=()
  if ! range="$(cat -- "${PROC_NET_DIR}/ip_local_port_range" 2>/dev/null)"; then
    _p+=("ip_local_port_range: ${PROC_NET_DIR}/ip_local_port_range could not be read, so whether live's ports lie in the range the kernel hands to outgoing connections cannot be asked.")
    return 0
  fi
  read -r low high <<<"$range"
  if ! [[ "${low:-}" =~ ^[0-9]+$ && "${high:-}" =~ ^[0-9]+$ ]]; then
    _p+=("ip_local_port_range: ${PROC_NET_DIR}/ip_local_port_range does not hold two port numbers, so whether live's ports lie in the range the kernel hands to outgoing connections cannot be asked.")
    return 0
  fi
  if ! reserved="$(cat -- "${PROC_NET_DIR}/ip_local_reserved_ports" 2>/dev/null)"; then
    _p+=("ip_local_reserved_ports: ${PROC_NET_DIR}/ip_local_reserved_ports could not be read, so whether live's ports in the ephemeral range are reserved cannot be asked.")
    return 0
  fi
  reserved="${reserved//[[:space:]]/}"
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    value="$(env_value "$ENV_FILE" "$key" "$(compose_default "$key")")"
    [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] || continue
    [ "$value" -ge "$low" ] && [ "$value" -le "$high" ] || continue
    port_reserved "$value" "$reserved" && continue
    caught+=("${key}: ${value} lies in this machine's ephemeral port range (net.ipv4.ip_local_port_range, ${low} to ${high}) and is not in net.ipv4.ip_local_reserved_ports. The kernel may hand it to an outgoing connection as its source port, and the container that publishes it then fails to start with \"address already in use\".")
    ports+=("$value")
  done <<<"$(live_port_keys)"
  [ "${#caught[@]}" -gt 0 ] || return 0
  local list
  list="$(printf '%s\n' "${ports[@]}" | sort -nu | tr '\n' ',')"
  list="${list%,}"
  [ -z "$reserved" ] || list="${reserved},${list}"
  _p+=("${caught[@]}")
  _p+=("the fix for the port(s) above: reserve them, keeping what is reserved now, in a file of /etc/sysctl.d, then have the kernel read it:
      echo 'net.ipv4.ip_local_reserved_ports = ${list}' | sudo tee /etc/sysctl.d/90-ownpace-reserved-ports.conf
      sudo sysctl --system
    sysctl --system reads the files there in name order, and the last to set a key wins: if another file sets it already, put the line in that file instead. Then run this again.")
}

# check_names <problems-array> — the three production names resolve here.
check_names() {
  local -n _p="$1"
  local name
  if ! command -v getent >/dev/null 2>&1; then
    _p+=("getent: not on this machine, so whether the production names resolve cannot be asked.")
    return 0
  fi
  for name in "$LIVE_APP" "$LIVE_IDP" "$LIVE_STATUS"; do
    getent hosts "$name" >/dev/null 2>&1 ||
      _p+=("${name}: does not resolve from this machine. Route the three production names in NetBird BEFORE this bring-up: its sign-in setup reaches ${LIVE_IDP} by that name (workplan 0132 T1e).")
  done
}

# is_published <key> <value> — empty, a change-me…, or a value this repository
# publishes (managed.yml's default for it among them).
is_published() {
  case "$2" in
    '' | change-me* | changeme*) return 0 ;;
  esac
  case "$PUBLISHED_PASSWORDS" in
    *" $2 "*) return 0 ;;
  esac
  [ "$2" = "$(compose_default "$1")" ]
}

# check_passwords <problems-array> <generate-array> — which passwords to
# generate, and which cannot be: published, with the volume that keeps them.
check_passwords() {
  local -n _p="$1" _g="$2"
  local entry key vol value
  for entry in "${PASSWORDS[@]}"; do
    read -r key vol <<<"$entry"
    value="$(env_value "$ENV_FILE" "$key")"
    if is_published "$key" "$value"; then
      if has_volume "$vol"; then
        _p+=("${key}: empty or a value this repository publishes, and ${COMPOSE_PROJECT}_${vol} exists, which took it at its first start and keeps it. $(password_remedy "$vol")")
      else
        _g+=("$key")
      fi
    elif [[ "$URL_PASSWORDS" == *" ${key} "* ]] && ! [[ "$value" =~ ^[A-Za-z0-9._~-]+$ ]]; then
      _p+=("${key}: holds a character a URL does not carry as it is, and managed.yml puts it in a database URL. Use hex (openssl rand -hex 24).")
    fi
  done
}

password_remedy() {
  case "$1" in
    postgres_data) printf '%s' "Workplan 0132 T2 steps 3 and 4 change the role with ALTER ROLE; nothing on live uses it yet." ;;
    trigger_db_data) printf '%s' "Before live's Trigger.dev account exists, ./deploy/compose/reset-trigger.sh --yes removes that database, and this script then sets a new password." ;;
    *) printf '%s' "Workplan 0132 T2, the paragraph on ClickHouse and MinIO." ;;
  esac
}

# bring_up <args> — one call of the bring-up, which must finish.
bring_up() {
  local rc=0
  say "bootstrap-managed.sh $*"
  "${SCRIPT_DIR}/bootstrap-managed.sh" "$@" || rc=$?
  [ "$rc" -eq 0 ] && return 0
  if [ "$rc" -eq 2 ]; then
    stopped "bootstrap-managed.sh $* stopped for you (exit 2): do what it asks above." \
      "Then run this script again, not the resume line it printed."
  fi
  stopped "bootstrap-managed.sh $* failed (exit ${rc}, above)."
}

# Task runs start on the network DOCKER_RUNNER_NETWORKS names, and must start
# on live's own (D9). The rendered configuration holds secrets: only that one
# value leaves this function.
check_runner_network() {
  local cfg net
  cfg="$("${COMPOSE[@]}" config)" || stopped "docker compose could not render managed.yml with live's .env (above)."
  net="$(sed -n 's/^[[:space:]]*DOCKER_RUNNER_NETWORKS:[[:space:]]*//p' <<<"$cfg")"
  cfg=''
  net="${net//\"/}"
  net="${net//\'/}"
  if [ "$net" != "${COMPOSE_PROJECT}_ownpace-network" ]; then
    stopped "DOCKER_RUNNER_NETWORKS renders as '${net:-nothing}', not ${COMPOSE_PROJECT}_ownpace-network. Live's task runs would join another stack's network, where postgres is that stack's database (workplan 0132 D9)."
  fi
  say "task runs start on ${net} (DOCKER_RUNNER_NETWORKS, as Compose renders it)"
}

# psql as the owner, over the postgres container's own socket, the SQL on stdin.
db_psql() {
  "${COMPOSE[@]}" exec -T postgres sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

# app_user with APP_DB_PASSWORD, before the API's first start migrates. The
# baseline creates the role with the password this repository publishes, and
# only when it does not exist. The statement reaches psql on stdin, and a
# failing statement is kept out of the database's log.
create_app_user() {
  local exists pw
  exists="$(printf "SELECT 1 FROM pg_roles WHERE rolname = 'app_user';\n" | db_psql)" ||
    stopped "could not ask live's database whether app_user exists (above)."
  if [ "$exists" = 1 ]; then
    say "app_user exists already; its password is checked below"
    return 0
  fi
  pw="$(env_value "$ENV_FILE" APP_DB_PASSWORD)"
  if ! { printf 'SET log_min_error_statement = panic;\n'; printf "CREATE ROLE app_user LOGIN PASSWORD '%s';\n" "${pw//\'/\'\'}"; } | db_psql >/dev/null; then
    pw=''
    stopped "could not create app_user in live's database (above). Nothing has migrated yet: the API first starts after this."
  fi
  pw=''
  say "created app_user with APP_DB_PASSWORD, handed to psql on stdin: the baseline migration finds it and leaves it alone"
}

# db_opens <role> <password> — true when Postgres takes that pair over live's
# own network, as every other container asks it. The password reaches
# `docker run` as PGPASSWORD, by name; the socket, which trusts everything,
# is never asked (the-check-postgres-never-made).
db_opens() {
  PGPASSWORD="$2" docker run --rm -e PGPASSWORD --network "${COMPOSE_PROJECT}_ownpace-network" "$PG_CHECK_IMAGE" \
    psql -h postgres -U "$1" -d "$PG_CHECK_DB" -tAc 'SELECT 1' >/dev/null 2>&1
}

# Workplan 0132 T2 step 2, on live: the two controls must open, and the three
# values this repository publishes must not, for the owner, openmigrate and
# app_user. Every pair is asked, then the verdict.
check_db_passwords() {
  local owner owner_pw app_pw u label pw entry control_failed='' opened=''
  local -a lines=() users=()
  PG_CHECK_IMAGE="$(sed -n '/^[[:space:]]*image:[[:space:]]*postgres:/{s/^[[:space:]]*image:[[:space:]]*//p;q}' "${SCRIPT_DIR}/managed.yml")"
  [ -n "$PG_CHECK_IMAGE" ] || stopped "managed.yml names no postgres image to ask the database with."
  PG_CHECK_DB="$(env_value "$ENV_FILE" POSTGRES_DB openmigrate)"
  owner="$(env_value "$ENV_FILE" POSTGRES_USER openmigrate)"
  owner_pw="$(env_value "$ENV_FILE" POSTGRES_PASSWORD)"
  app_pw="$(env_value "$ENV_FILE" APP_DB_PASSWORD)"
  say "asking live's database over ${COMPOSE_PROJECT}_ownpace-network, as every container does"
  if db_opens "$owner" "$owner_pw"; then
    lines+=("control, the owner role (POSTGRES_USER) with POSTGRES_PASSWORD: opens")
  else
    lines+=("CONTROL FAILED: the owner role (POSTGRES_USER) with POSTGRES_PASSWORD")
    control_failed=1
  fi
  if db_opens app_user "$app_pw"; then
    lines+=("control, app_user with APP_DB_PASSWORD: opens")
  else
    lines+=("CONTROL FAILED: app_user with APP_DB_PASSWORD")
    control_failed=1
  fi
  owner_pw=''
  app_pw=''
  users=("$owner")
  [ "$owner" = openmigrate ] || users+=(openmigrate)
  users+=(app_user)
  for u in "${users[@]}"; do
    label="$u"
    [ "$u" != "$owner" ] || [ "$u" = openmigrate ] || label='the owner role (POSTGRES_USER)'
    for entry in "app_password:the migration's password" "openmigrate_password:compose's default" "change-me-openmigrate:the example's value"; do
      pw="${entry%%:*}"
      if db_opens "$u" "$pw"; then
        lines+=("OPENS: ${label}, with ${entry#*:}")
        opened=1
      fi
    done
  done
  printf '  %s\n' "${lines[@]}"
  if [ -n "$control_failed" ]; then
    stopped "a control did not open, so this check tells nothing about the published values: live's database and its .env disagree, or it cannot be reached on its network." \
      "Look at what is above. A migration that ran before app_user was created gave it the migration's password: workplan 0132 T2 steps 3 and 4 set it with ALTER ROLE."
  fi
  if [ -n "$opened" ]; then
    stopped "live's database takes a password this repository publishes (above)." \
      "Workplan 0132 T2 steps 3 and 4 change it with ALTER ROLE; nothing on live uses these roles yet."
  fi
  say "the controls open, and the three published values are refused for ${users[*]} (workplan 0132 T2 step 2)"
}

# The task deploy strips apps/worker/package.json's last newline. Put back
# when that is all it changed; said, and left, when it is more.
restore_worker_newline() {
  local f=apps/worker/package.json changed
  changed="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no -- "$f")" || return 0
  [ -n "$changed" ] || return 0
  if [ -f "${REPO_ROOT}/${f}" ] && [ "$(git -C "$REPO_ROOT" show "HEAD:${f}")" = "$(cat "${REPO_ROOT}/${f}")" ]; then
    git -C "$REPO_ROOT" checkout -q -- "$f"
    say "put back ${f}'s last newline, which the task deploy strips (deploy-live.sh refuses a tree that is not clean)"
  else
    say "NOTE: ${f} changed beyond its last newline, and is left as it is. deploy-live.sh refuses a tree that is not clean: look at git diff ${f}."
  fi
}

# http_get <origin> <path> <body-var> <code-var> — true on a 200. Tries
# CHECK_TRIES times, a CHECK_INTERVAL apart. Never prints curl's own words,
# which may name an address.
http_get() {
  local origin="$1" path="$2" tmp http rc try=1
  local -n _body="$3" _code="$4"
  tmp="$(mktemp)"
  while :; do
    rc=0
    http="$(curl -sS --max-time 20 -o "$tmp" -w '%{http_code}' "${origin}${path}" 2>/dev/null)" || rc=$?
    if [ "$rc" -eq 0 ] && [ "$http" = 200 ]; then
      _body="$(cat "$tmp")"
      _code=200
      rm -f "$tmp"
      return 0
    fi
    if [ "$rc" -ne 0 ]; then
      _code="not reached (curl exit ${rc}: 6 is no such name, 7 no connection, 28 a timeout, 35 or 60 TLS)"
    else
      _code="answered HTTP ${http:-nothing}, not 200"
    fi
    [ "$try" -lt "$CHECK_TRIES" ] || break
    try=$((try + 1))
    sleep "$CHECK_INTERVAL"
  done
  _body=''
  rm -f "$tmp"
  return 1
}

# json_string <field> — the string value of that field of the JSON object on
# stdin, or nothing.
json_string() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const v = JSON.parse(s)[process.argv[1]];
        if (typeof v === "string") process.stdout.write(v);
      } catch {}
    });' "$1"
}

# run_checks <failures-array> <commit> <version> — T0 step 5 and T6 step 7,
# every one, whatever the one before it said.
run_checks() {
  local -n _f="$1"
  local commit="$2" version="$3" body code got got_version node_env nets n members c before
  say "the checks (workplan 0132 T0 step 5, T6 step 7)"
  if http_get "https://${LIVE_APP}" /api/version body code; then
    got="$(json_string commit <<<"$body")"
    got_version="$(json_string version <<<"$body")"
    [ "$got" = "$commit" ] || _f+=("/api/version names commit '${got:-none}', not the tag's ${commit}.")
    [ "$got_version" = "$version" ] || _f+=("/api/version names version '${got_version:-none}', not the tag's '${version}' (0146 T5).")
    if [ "$got" = "$commit" ] && [ "$got_version" = "$version" ]; then say "  /api/version: ${commit}, ${version}"; fi
  else
    _f+=("/api/version at ${LIVE_APP}: ${code}.")
  fi
  if http_get "https://${LIVE_APP}" /api/ready body code; then
    say "  /api/ready: 200"
  else
    _f+=("/api/ready at ${LIVE_APP}: ${code}.")
  fi
  if http_get "https://${LIVE_APP}" /api/auth/mode body code; then
    got="$(json_string mode <<<"$body")"
    if [ "$got" = managed ]; then say "  /api/auth/mode: managed"; else _f+=("/api/auth/mode answers '${got:-nothing}', not managed."); fi
  else
    _f+=("/api/auth/mode at ${LIVE_APP}: ${code}.")
  fi
  if node_env="$("${COMPOSE[@]}" exec -T api printenv NODE_ENV 2>/dev/null)"; then
    if [ "$node_env" = production ]; then say "  NODE_ENV in the api container: production"; else _f+=("NODE_ENV in the api container is '${node_env:-empty}', not production (T4)."); fi
  else
    _f+=("NODE_ENV: the api container could not be asked.")
  fi
  if http_get "https://${LIVE_IDP}" /.well-known/openid-configuration body code; then
    got="$(json_string issuer <<<"$body")"
    if [ "$got" = "https://${LIVE_IDP}" ]; then
      say "  the issuer: https://${LIVE_IDP}"
    else
      _f+=("the provider at ${LIVE_IDP} names another issuer than https://${LIVE_IDP}, so the sign-in button leads elsewhere (T1d, T1e).")
    fi
  else
    _f+=("the issuer at ${LIVE_IDP}: ${code}.")
  fi
  # Live's networks are its own (D9).
  before="${#_f[@]}"
  if nets="$(docker network ls --filter "name=${COMPOSE_PROJECT}_" --format '{{.Name}}')"; then
    for n in ownpace-network status-probe; do
      grep -qx -- "${COMPOSE_PROJECT}_${n}" <<<"$nets" || _f+=("the network ${COMPOSE_PROJECT}_${n} is not there (workplan 0132 D9).")
    done
  else
    _f+=("docker network ls failed, so live's networks could not be checked.")
  fi
  if members="$(docker network inspect "${COMPOSE_PROJECT}_ownpace-network" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null)"; then
    for c in $members; do
      case "$c" in "${OTA_PROJECT}-"*) _f+=("${c}, the OTA stack's, is on ${COMPOSE_PROJECT}_ownpace-network (D9).") ;; esac
    done
  else
    _f+=("${COMPOSE_PROJECT}_ownpace-network could not be inspected.")
  fi
  if members="$(docker network inspect "${OTA_PROJECT}_ownpace-network" --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null)"; then
    for c in $members; do
      case "$c" in "${COMPOSE_PROJECT}-"*) _f+=("${c}, live's, is on the OTA stack's ${OTA_PROJECT}_ownpace-network (D9).") ;; esac
    done
  fi
  [ "${#_f[@]}" -ne "$before" ] || say "  live's networks are its own, and share no container with the OTA stack's (D9)"
  # 0132 T3 (b), the tag's own copy: every container on the machine.
  say "exposure-check.sh"
  "${SCRIPT_DIR}/exposure-check.sh" --env-file "$ENV_FILE" || _f+=("the exposure check did not pass (above).")
  [ "${#_f[@]}" -gt 0 ] || say "  every check passed"
}

# The timer's two units, copied (not linked: a checkout of another tag must
# not change them), and systemd told. Prints one line for owner_steps.
install_timer_units() {
  local dir="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user" unit
  if ! mkdir -p "$dir" 2>/dev/null; then
    printf 'copy the two units yourself (%s could not be made), then systemctl --user daemon-reload' "$dir"
    return 0
  fi
  for unit in ownpace-box-duties.service ownpace-box-duties.timer; do
    cmp -s "${SCRIPT_DIR}/systemd/${unit}" "${dir}/${unit}" || cp "${SCRIPT_DIR}/systemd/${unit}" "${dir}/${unit}"
  done
  if command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload >/dev/null 2>&1; then
    printf 'the two units are in %s, and systemd has read them' "$dir"
  else
    printf 'the two units are in %s; run systemctl --user daemon-reload once this account has a user manager (after enable-linger)' "$dir"
  fi
}

your_turn_account() {
  cat <<'EOF'

[stand-up-live] Your turn: live's own Trigger.dev account, organisation and project
  (workplan 0132 T1c). bootstrap-managed.sh stopped for it, as it must: the dashboard
  signs in by magic link and has no admin API.

  1. Open live's dashboard, https://localhost:<TRIGGER_TLS_PORT>, where
     <TRIGGER_TLS_PORT> is that key's number in live's .env, in a browser on
     this machine. From a laptop, open a tunnel first and use the same address
     there (this form is not tried yet):
       ssh -N -L <TRIGGER_TLS_PORT>:127.0.0.1:<TRIGGER_TLS_PORT> <you>@<this machine>
     It serves a self-signed certificate: accept it.
  2. Type your email address and press Continue. No mail is sent; fetch the
     link with
       ./deploy/compose/trigger-magic-link.sh
     and open it in the same browser. A link works once.
  3. Name an organisation and a project (Ownpace and ownpace, say). Nothing
     here depends on either name.
  4. Do not copy the project ref or the key: the next run reads both out of
     live's instance.

  Then run this again, with --resume (not the resume line bootstrap-managed.sh
  printed above: this script runs the steps around it):
    ./deploy/compose/stand-up-live.sh --resume
EOF
  exit 2
}

your_turn_login() {
  cat <<'EOF'

[stand-up-live] Your turn: log the deploy CLI in to live's plane, under live's own
  profile (TRIGGER_CLI_PROFILE; workplan 0132 T1c). bootstrap-managed.sh stopped for it.

  Run the `npx -y trigger.dev@… login …` line it printed above, in a shell on
  this machine. It opens a browser and waits (Chromium worked where Firefox did
  not). The address in it is live's plain http API on loopback, not the
  dashboard.

  Then run this again, with --resume:
    ./deploy/compose/stand-up-live.sh --resume
EOF
  exit 2
}

# owner_steps <tag> <timer note> — what is left, in order.
owner_steps() {
  cat <<EOF

[stand-up-live] What is left is yours (docs/managed-bring-up.md, "Standing up ownpace-live"):

  1. Sign up at https://${LIVE_APP}, with an address you read. The
     identity provider sends the verification code through live's relay,
     the first mail live sends (workplan 0133 T4). Live runs no catcher: if
     the code does not arrive, the zitadel service's log and the relay's
     say why.
  2. Become the operator. Your userId is on /api/me once you are signed in
     (the bring-up guide, 8c); then, from ~/${LIVE_PROJECT}:
       ./deploy/compose/operator.sh add <userId> <your email> "owner"
       ./deploy/compose/operator.sh list        (you, and nobody else)
  3. The daily duties (workplan 0132 T7): $2.
     Then, once (the first line needs sudo: this account's timers run when
     nobody is signed in):
       sudo loginctl enable-linger "\$USER"
       systemctl --user enable --now ownpace-box-duties.timer
       systemctl --user start ownpace-box-duties.service
       journalctl --user -u ownpace-box-duties -n 200 --no-pager   (all four duties pass)
     Start it in daytime: while the appliance nightly runs, its dev Nextcloud
     fails the exposure duty.
  4. Rehearse the next deploy. Open a hold on the support screen with a Dutch
     sentence, wait five minutes, then:
       ./deploy/compose/deploy-live.sh --dry-run $1
     It must pass every refusal, say reversible (the same tag), and move
     nothing. Then lift the hold. Every deploy from here on is deploy-live.sh.
  5. Set the repository variable EXPOSURE_PROBE_LIVE_PORTS to live's published
     ports, and dispatch the Exposure probe workflow (workplan 0132 T3 (c)).
     It fails while NetBird's sign-in answers app., id., status. or
     www.ownpace.eu instead of the service: switch it off on all four before
     the first invitation (workplan 0139, item 8).
  6. Check that live's logs name the visitor: one request from outside with a
     forged X-Forwarded-For, then one line of the api's, the web's and the
     site's log (the bring-up guide, "After the script", step 6; workplan
     0132 T3 (d)). Paste those lines nowhere public.
  7. Write the date, the tag and each check's outcome, never a value, in
     workplan 0132's Status block (T0 step 6).
EOF
}

# ONE LINE, as deploy-live.sh ends: nothing after main is read.
main "$@"; exit $?
