#!/usr/bin/env bash
# deploy-live.sh — deploy a release tag to ownpace-live, and nothing else
# (workplan 0132 T6 (a), with 0146 T5 (a)).
#
# LIVE MOVES ONLY BY HAND, AND ONLY TO A RELEASE. The OTA stack follows `main`
# every night through the gate; ownpace-live, the stack testers use, runs the
# tag the owner names (0132 T1g, 0146 T5). Its checkout is always a release tag,
# detached, so the build stamp a tester sees, a problem report's build line, the
# deploy log and the GitHub release all name the same thing. `git pull` is never
# run there.
#
# WHAT IT DOES: 0132 T6's steps 3 and 5 to 7, and step 9. Run from live's
# checkout, with the hold already open (step 2):
#
#   3. checks that the drain is done: no pass in flight
#   5. git fetch --tags origin, git checkout --detach <tag>
#   6. pnpm install --frozen-lockfile, then
#      bootstrap-managed.sh --from data, never with --with-demo. The bring-up
#      builds the API and web images with GIT_SHA from `git rev-parse HEAD`,
#      which is now the tag's commit; it uploads the task environment and
#      deploys the tasks. Without the demo it skips its smoke, and step 7
#      stands in for it.
#   7. asks the app at the origin in WEB_URL: /api/version names the tag's
#      commit AND its version (0146 T5), /api/ready answers 200,
#      /api/auth/mode answers `managed`; and runs exposure-check.sh
#      (0132 T3 (b), on main since #1271), the tag's own copy, which must
#      pass. It reads EXPOSURE_ALLOW from live's .env, which the owner sets;
#      a tag cut before #1271 has no such script, and cannot pass
#   9. appends one line to deploys.log (below)
#
# WHAT IT DOES NOT DO. It does not open the hold (step 2) or dump the database
# (step 4): both are the owner's, before it; --dry-run (below) says whether
# the dump is the only way back. It does not LIFT the hold (step
# 8): the owner lifts it after looking at what this printed, and watches the
# tick's next summary and one of their own migrations complete a pass on the
# new tasks. It checks the drain; it does not wait for it. And it does not
# check NODE_ENV: 0132 T4's check is not built (managed.yml still defaults it
# to `development`), so there is nothing to ask yet, and it says so.
#
# IT REFUSES, BEFORE THE CHECKOUT OR THE STACK CHANGES, each with its own
# message and a non-zero exit. (To read a tag origin has and this clone does
# not, it runs the fetch of step 5 first; that adds tags and moves nothing.)
#
#   --with-demo anywhere in its arguments: live never has the demo, which
#       creates organisations with fixed, published credentials (0132 T5)
#   a .env without live's marker (stack_is_live, stack-kind.sh): this deploys
#       ownpace-live and nothing else; the OTA stack is the gate's
#   a .env with no WEB_URL, the origin the checks ask
#   COMPOSE_ENV_FILES or COMPOSE_FILE in the shell: the bring-up's Compose would
#       follow them to another stack's files
#   a working tree that is not clean, untracked files included: live runs what
#       the tag holds, and a checkout would carry a change across or stop on it
#   a ref that is not a tag; a tag that is not on origin; a tag here that is
#       not origin's; a lightweight tag; a tag whose name does not start with
#       `v`; a tag whose commit's root package.json version is not the tag
#       without its `v` (it names both). Each says 0146's sentence, "live runs
#       releases: name a release tag".
#   a database it cannot read, which is never taken for "nothing in flight"
#       (hard rule 9); a role row security would bind, which would count no
#       pass at all; no open hold; a pass still in flight; and a hold younger
#       than DEPLOY_LIVE_QUIET_MINUTES. The tick enqueues a pass without writing
#       a row, so a pass queued just before the hold began is in no count until
#       it starts (rehearse-capacity.sh met the same thing).
#   a deploy log it cannot append to (below): every deploy past the checkout is
#       logged, and the next deploy reads the log to say one-way or reversible.
#
# ONE-WAY OR REVERSIBLE (0146 T5). Before the checkout moves, and again at the
# end, it says whether the deploy can be undone by deploying a tag this stack
# has run again. It compares the new tag with each of:
#
#   the running tag, the one the last deploy that TOOK put there (deploys.log);
#   every deploy that did NOT take since then (deploys.log): its bring-up may
#       have run, and its API applied its migrations when it started;
#   the checkout's HEAD, when it is none of those (with an empty log, live's
#       first deploy by this script, it is the only one).
#
# It is ONE-WAY when, between any of them and the new tag, a file in either
# migration chain was added, changed or removed, or the Trigger.dev or
# identity-provider image pin in managed.yml moved: the API refuses an older
# build against a migrated schema (migrate.ts), and both planes migrate their
# own schemas one way (0119, 0135). Otherwise it is REVERSIBLE. A commit this
# clone does not have cannot be compared, and is called one-way, and so is
# what ran before the log's first line when no deploy has taken yet and that
# first deploy was one-way over it: the log does not name it. The error errs
# towards no way back.
#
# THE LOG. One line per deploy that got as far as the checkout, tab-separated:
#
#   <UTC date>  <tag>  <commit>  took|did-not-take  one-way|reversible
#
# in ${MANAGED_ENV_PERSIST_DIR:-~/.persistent/<project>}/deploys.log, the
# directory each stack keeps its .env and dumps in (0132 T1). A refusal is not
# a deploy and is not logged. It checks that the log can be appended to before
# the checkout moves. Should the line still fail to be written at the end, it
# says so and prints the line to add by hand, after what it says about the
# deploy; the exit stays the deploy's.
#
# A DEPLOY THAT DID NOT TAKE. When the dependencies, the bring-up or any check
# fails, it says the deploy did not take, which check failed, that the hold
# stays on, logs `did-not-take`, and exits 3. Fix the cause and run it again
# with the same tag (the checkout is already there), or name another; the next
# deploy is compared with this tag too.
#
# HOW IT REACHES THE DATABASE. `docker compose exec postgres`, psql over the
# container's own socket, as the owner the postgres image created, the way
# rehearse-capacity.sh does. It reads; every statement it sends is a SELECT.
# That role is a superuser, which row security never binds; it checks that, or
# it would count the passes of no organisation. It composes no connection
# string, so docs/rls-guide.md §2's list of scripts that do has no row for it.
#
# --dry-run: EVERY REFUSAL AND THE VERDICT, THEN STOP. It runs everything the
# deploy runs before the checkout moves: each refusal above, the fetch of step
# 5 (it adds tags and moves nothing), and one-way or reversible, said by the
# same function over the same deploys.log and HEAD, comparing through git's
# objects. Then it says that it stopped, and exits 0. It checks nothing out,
# runs no pnpm install, no bring-up and no check, and writes no line to
# deploys.log. Whether the log can be appended to it asks of what is there,
# the file or the nearest directory that exists, and makes neither. Run it
# with the hold on and the drain done, before step 4: when it says one-way, a
# dump taken then is the only way back that is not forward. A refusal exits 1,
# as in the deploy.
#
# WHAT IT PRINTS. Never a value from the .env: a refusal names the key. The
# checks name the path they asked and the key the origin came from, never the
# origin, which on a stack whose names are not public yet may be the machine's
# own address. Nothing that runs this may use `set -x`.
#
# Usage:  ./deploy/compose/deploy-live.sh [--dry-run] <tag>   from live's checkout
#
# Exit: 0 the deploy took (the hold is still on), or, with --dry-run, nothing
#       was refused and the verdict is printed (nothing moved); 1 refused (the
#       checkout and the stack as they were); 2 usage; 3 the deploy did not
#       take (the checkout is at the tag, the hold is still on).
#
# Env overrides:
#   MANAGED_ENV_PERSIST_DIR       where deploys.log goes (default
#                                 ~/.persistent/<project>)
#   DEPLOY_LIVE_QUIET_MINUTES     how old the hold must be (default 5)
#   DEPLOY_LIVE_CHECK_TRIES       tries per HTTP check (default 5)
#   DEPLOY_LIVE_CHECK_INTERVAL    seconds between them (default 3)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
# env_value, the one reader of a compose .env, and compose_project. stack-kind.sh
# sources it too; it is named here because this script calls both itself.
# shellcheck source=deploy/compose/env-read.sh
. "${SCRIPT_DIR}/env-read.sh"
# Live's marker, named once.
# shellcheck source=deploy/compose/stack-kind.sh
. "${SCRIPT_DIR}/stack-kind.sh"
# The .env named to Compose, so that it reads the file checked below.
COMPOSE=(docker compose -f "${SCRIPT_DIR}/managed.yml" --env-file "${ENV_FILE}")

# The two chains a release can add a migration to (ADR-0036, ADR-0045).
MIGRATION_CHAINS=(packages/ledger/migrations packages/managed/migrations)
# The tick's STALE_RUN_AFTER_MS (2 × PASS_HARD_LIMIT_MS), in seconds. A
# `running` row older than this is a pass that died, not one in flight.
STALE_RUN_AFTER_SECONDS=7200
QUIET_MINUTES="${DEPLOY_LIVE_QUIET_MINUTES:-5}"
CHECK_TRIES="${DEPLOY_LIVE_CHECK_TRIES:-5}"
CHECK_INTERVAL="${DEPLOY_LIVE_CHECK_INTERVAL:-3}"

RELEASE_SENTENCE='live runs releases: name a release tag'
# The compose project this checkout drives, set by main from the one reader.
COMPOSE_PROJECT=''

say() { printf '[deploy-live] %s\n' "$@"; }
refuse() {
  printf '[deploy-live] refused: %s\n' "$1" >&2
  shift
  [ "$#" -eq 0 ] || printf '  %s\n' "$@" >&2
  printf '[deploy-live] The checkout and the stack are as they were.\n' >&2
  exit 1
}
usage() {
  echo "usage: ./deploy/compose/deploy-live.sh [--dry-run] <tag>      (from live's checkout; --help for more)" >&2
  exit 2
}

# The whole run is one function, read by bash before any of it runs: the
# checkout below replaces this very file with the tag's copy.
main() {
  local arg tag='' dry_run=''
  # --with-demo first, wherever it stands, before anything is read.
  for arg in "$@"; do
    if [ "$arg" = --with-demo ]; then
      refuse "--with-demo. ownpace-live never has the demo: it creates organisations with fixed, published credentials (workplan 0132 T5)." \
        "This script runs bootstrap-managed.sh --from data, never with --with-demo. Name the tag alone."
    fi
  done
  for arg in "$@"; do
    case "$arg" in
      -h | --help)
        sed -n '2,/^set -euo pipefail$/p' "${BASH_SOURCE[0]}" | sed '$d'
        exit 0
        ;;
      --dry-run) dry_run=1 ;;
      -*) echo "[deploy-live] unknown option '${arg}'" >&2; usage ;;
      *)
        [ -z "$tag" ] || usage
        tag="$arg"
        ;;
    esac
  done
  [ -n "$tag" ] || usage

  # ---- The stack: live's, and ready to be asked ------------------------------
  [ -f "$ENV_FILE" ] || refuse "${ENV_FILE} not found. This runs from live's checkout, whose deploy/compose/.env is live's."
  if ! stack_is_live "$ENV_FILE"; then
    refuse "${ENV_FILE} does not carry ${STACK_KIND_KEY}=${STACK_KIND_LIVE}, live's marker (stack-kind.sh). Its value, if any, is not printed." \
      "This script deploys ownpace-live and nothing else. The OTA stack follows main through the nightly gate, and is never deployed by hand from a tag." \
      "If this is live's checkout, its .env must carry that line exactly, beside COMPOSE_PROJECT_NAME=ownpace-live (workplan 0132 T1b)."
  fi
  local web_url app_origin
  web_url="$(env_value "$ENV_FILE" WEB_URL)"
  case "$web_url" in
    http://* | https://*) ;;
    *)
      refuse "WEB_URL in ${ENV_FILE} is empty or not an http(s) origin. The checks ask the app at that origin (on live, its public name)." \
        "Set it to the address browsers use for the web app, as the bring-up does."
      ;;
  esac
  app_origin="${web_url%/}"
  for arg in COMPOSE_ENV_FILES COMPOSE_FILE; do
    if [ -n "${!arg+set}" ]; then
      refuse "this shell has ${arg} set. The bring-up's Compose would follow it to another stack's files instead of this checkout's." \
        "Open a new shell (or: unset ${arg}) and run this again."
    fi
  done
  # The project this checkout chooses, from the one reader (env-read.sh, 0132
  # T1). It refuses a shell whose COMPOSE_PROJECT_NAME the checkout does not
  # choose, and live's marker on the OTA stack's project.
  local deploy_log
  COMPOSE_PROJECT="$(compose_project "${SCRIPT_DIR}")" || refuse "the checkout's project could not be read (above)."
  deploy_log="${MANAGED_ENV_PERSIST_DIR:-$HOME/.persistent/${COMPOSE_PROJECT}}/deploys.log"

  # ---- The checkout: clean -----------------------------------------------------
  local dirty
  dirty="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)" ||
    refuse "git could not read the working tree of ${REPO_ROOT}."
  if [ -n "$dirty" ]; then
    refuse "the working tree is not clean. Live runs what the tag holds, and a checkout would carry these across or stop on them:" \
      "$dirty" \
      "Look at each (git status, git diff). The task deploy is known to strip apps/worker/package.json's last newline; discard that with git checkout -- apps/worker/package.json."
  fi

  # ---- The tag: a release ---------------------------------------------------------
  git check-ref-format "refs/tags/${tag}" 2>/dev/null ||
    refuse "'${tag}' is not a tag name. ${RELEASE_SENTENCE}."
  local remote_tags remote_object
  remote_tags="$(git -C "$REPO_ROOT" ls-remote --tags origin)" ||
    refuse "git ls-remote --tags origin failed, so the tag cannot be checked against origin."
  remote_object="$(awk -v ref="refs/tags/${tag}" '$2 == ref { print $1 }' <<<"$remote_tags")"
  if [ -z "$remote_object" ]; then
    if git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
      refuse "the tag '${tag}' is not on origin. ${RELEASE_SENTENCE}." \
        "A release is cut on origin (docs/release.md, §2). A tag that exists only in this clone is nobody's release."
    fi
    if git -C "$REPO_ROOT" rev-parse -q --verify "${tag}^{commit}" >/dev/null; then
      refuse "'${tag}' is not a tag: it names a branch or a commit. ${RELEASE_SENTENCE}."
    fi
    refuse "there is no tag '${tag}' here or on origin. ${RELEASE_SENTENCE}."
  fi
  # T6 step 5, first half: it only adds tags, and refuses to move one this
  # clone already has.
  say "fetching tags from origin"
  git -C "$REPO_ROOT" fetch -q --tags origin ||
    refuse "git fetch --tags origin failed (above). A tag here that differs from origin's is one reason."
  local local_object
  local_object="$(git -C "$REPO_ROOT" rev-parse -q --verify "refs/tags/${tag}")" ||
    refuse "the tag '${tag}' is on origin but not here after the fetch."
  if [ "$local_object" != "$remote_object" ]; then
    refuse "the tag '${tag}' here is not origin's: here ${local_object}, on origin ${remote_object}. ${RELEASE_SENTENCE}." \
      "Delete the one here (git tag -d ${tag}) and run this again, which fetches origin's."
  fi
  if [ "$(git -C "$REPO_ROOT" cat-file -t "refs/tags/${tag}")" != tag ]; then
    refuse "'${tag}' is a lightweight tag. A release tag is annotated (git tag -a, docs/release.md §2). ${RELEASE_SENTENCE}."
  fi
  case "$tag" in
    v*) ;;
    *) refuse "the tag '${tag}' does not start with v. ${RELEASE_SENTENCE}." ;;
  esac
  local commit version
  commit="$(git -C "$REPO_ROOT" rev-parse "refs/tags/${tag}^{commit}")"
  version="$(git -C "$REPO_ROOT" show "${commit}:package.json" 2>/dev/null | json_string version)" || version=''
  if [ "$version" != "${tag#v}" ]; then
    refuse "the root package.json at ${tag} says version '${version:-none}', and the tag says '${tag#v}'. ${RELEASE_SENTENCE}." \
      "A release's tag is its package.json version with a v in front (docs/release.md §1)."
  fi
  say "${tag} is an annotated release tag on origin, at ${commit}, version ${version}"

  # ---- The database: a hold, and the drain done (T6 steps 2 and 3) ---------------
  local reported
  reported="$(compose_reports_project)" || refuse "docker compose could not read ${SCRIPT_DIR}/managed.yml with its .env (above)."
  if [ "$reported" != "$COMPOSE_PROJECT" ]; then
    refuse "docker compose reports the project '${reported:-none}', and this checkout chooses '${COMPOSE_PROJECT}'." \
      "Something in this shell points Compose at another stack. Open a new shell and run this again."
  fi
  local answer superuser open age in_flight
  answer="$(db_read)" ||
    refuse "could not read the hold and the passes in flight from ${COMPOSE_PROJECT}'s database (above). Is its postgres up?" \
      "A database that cannot be read is not one with nothing in flight."
  IFS='|' read -r superuser open age in_flight <<<"$answer"
  if ! [[ "$superuser" =~ ^(yes|no)$ && "$open" =~ ^[0-9]+$ && "$age" =~ ^-?[0-9]+$ && "$in_flight" =~ ^[0-9]+$ ]] ||
    [ "$(wc -l <<<"$answer")" -ne 1 ]; then
    refuse "could not read the hold and the passes in flight: the database answered something that is not a count." \
      "A database that cannot be read is not one with nothing in flight."
  fi
  if [ "$superuser" != yes ]; then
    refuse "the role the postgres container's psql connects as is not a superuser, so row security would show it the passes of no organisation, and a count of 0 would mean nothing."
  fi
  if [ "$open" -eq 0 ]; then
    refuse "no hold is open. Start it first, on the support screen under Hold new passes, with a sentence in Dutch (workplan 0132 T6 step 2), then wait for the drain." \
      "A deploy without one replaces the task containers under passes the tick keeps starting."
  fi
  if [ "$in_flight" -gt 0 ]; then
    refuse "${in_flight} pass(es) still in flight. Wait until the tick's log says 0 (workplan 0132 T6 step 3), then run this again." \
      "It logs every minute: [sync-tick] holding: … N pass(es) still in flight; the drain is done when that reaches 0."
  fi
  if [ "$age" -lt $((QUIET_MINUTES * 60)) ]; then
    refuse "the hold began $((age / 60)) minute(s) ago. A pass the tick queued just before it is in no count until it starts." \
      "Run this again once the hold is ${QUIET_MINUTES} minutes old."
  fi
  say "the hold is on and nothing is in flight"

  # ---- The log: one that can be appended to (T6 step 9) ----------------------------
  # Past the checkout every way out is logged, and the next deploy reads the log
  # to say one-way or reversible. Asked now, while nothing has moved.
  if ! log_appendable "$deploy_log" "$dry_run"; then
    refuse "${deploy_log} cannot be appended to. Every deploy that gets as far as the checkout is logged there (workplan 0132 T6 step 9), and the next deploy reads it to say one-way or reversible." \
      "Make its directory writable (or set MANAGED_ENV_PERSIST_DIR to one that is) and run this again."
  fi

  # ---- One-way or reversible (0146 T5) ---------------------------------------------
  local bases_read reversibility
  local -a bases=()
  bases_read="$(comparison_bases "$deploy_log")" ||
    refuse "could not read what this stack has run from ${deploy_log} and this checkout (above), so one-way or reversible cannot be said."
  mapfile -t bases <<<"$bases_read"
  reversibility="$(compare_releases "$commit" "$tag" "${bases[@]}")"
  local verdict="${reversibility%%$'\n'*}"
  printf '%s\n' "${reversibility#*$'\n'}"

  # ---- --dry-run stops here, before anything moves ---------------------------------
  if [ -n "$dry_run" ]; then
    echo
    say "dry run: a deploy of ${tag} now would be ${verdict}."
    if [ "$verdict" = one-way ]; then
      say "dry run: dump live's database now, with the hold still on, if you want a way back that is not forward (workplan 0132 T6 step 4; the operator runbook's Backup & restore). Then run this again without --dry-run."
    else
      say "dry run: run this again without --dry-run to deploy it."
    fi
    say "dry run: stopped before the checkout. Nothing was checked out, installed, built or deployed, no check was run, and deploys.log was not written. The checkout and the stack are as they were; the hold is as you left it."
    exit 0
  fi

  # ---- The deploy (T6 steps 5 and 6) -----------------------------------------------
  # From here on the checkout has moved, and every way out is logged.
  say "checking out ${tag}"
  git -C "$REPO_ROOT" -c advice.detachedHead=false checkout -q --detach "refs/tags/${tag}" ||
    refuse "git checkout --detach ${tag} failed (above)."
  if [ "$(git -C "$REPO_ROOT" rev-parse HEAD)" != "$commit" ]; then
    did_not_take "$deploy_log" "$tag" "$commit" "$verdict" "the checkout is not at ${commit} after git checkout --detach ${tag}."
  fi

  say "installing the tag's dependencies"
  if ! (cd "$REPO_ROOT" && pnpm install --frozen-lockfile); then
    did_not_take "$deploy_log" "$tag" "$commit" "$verdict" "pnpm install --frozen-lockfile failed (above). The task deploy builds from this checkout's node_modules."
  fi

  # The tag's own bring-up. GIT_SHA is `git rev-parse HEAD` inside it, which is
  # the tag's commit now (checked above).
  say "bootstrap-managed.sh --from data (never --with-demo)"
  local rc=0
  "${SCRIPT_DIR}/bootstrap-managed.sh" --from data || rc=$?
  if [ "$rc" -eq 2 ]; then
    did_not_take "$deploy_log" "$tag" "$commit" "$verdict" "bootstrap-managed.sh stopped for you (exit 2): do what it asks above, then run deploy-live.sh ${tag} again, not the resume line it printed."
  elif [ "$rc" -ne 0 ]; then
    did_not_take "$deploy_log" "$tag" "$commit" "$verdict" "bootstrap-managed.sh failed (exit ${rc}, above)."
  fi

  # ---- The checks (T6 step 7) -----------------------------------------------------
  local failures=()
  local body code got_commit got_version mode
  say "asking the app at the origin in WEB_URL"
  if http_get "$app_origin" /api/version body code; then
    got_commit="$(json_string commit <<<"$body")"
    got_version="$(json_string version <<<"$body")"
    if [ "$got_commit" != "$commit" ]; then
      failures+=("/api/version names commit '${got_commit:-none}', not the tag's ${commit}.")
    fi
    if [ "$got_version" != "$version" ]; then
      failures+=("/api/version names version '${got_version:-none}', not the tag's '${version}' (0146 T5).")
    fi
    if [ "$got_commit" = "$commit" ] && [ "$got_version" = "$version" ]; then
      say "  /api/version: ${commit}, ${version}"
    fi
  else
    failures+=("/api/version: ${code}.")
  fi
  if http_get "$app_origin" /api/ready body code; then
    say "  /api/ready: 200"
  else
    failures+=("/api/ready: ${code}.")
  fi
  if http_get "$app_origin" /api/auth/mode body code; then
    mode="$(json_string mode <<<"$body")"
    if [ "$mode" = managed ]; then
      say "  /api/auth/mode: managed"
    else
      failures+=("/api/auth/mode answers '${mode:-nothing}', not 'managed'.")
    fi
  else
    failures+=("/api/auth/mode: ${code}.")
  fi
  # 0132 T3 (b): every container on the machine, read from Docker. The tag's
  # own copy, beside this script after the checkout.
  if [ -x "${SCRIPT_DIR}/exposure-check.sh" ]; then
    say "exposure-check.sh"
    if ! "${SCRIPT_DIR}/exposure-check.sh" --env-file "$ENV_FILE"; then
      failures+=("the exposure check did not pass (above).")
    fi
  else
    failures+=("${SCRIPT_DIR}/exposure-check.sh is not in this tag, so the exposure check (0132 T3) could not run.")
  fi
  say "not checked: NODE_ENV. Workplan 0132 T4's check is not built (managed.yml still defaults NODE_ENV to development), so there is nothing to ask yet."

  if [ "${#failures[@]}" -gt 0 ]; then
    did_not_take "$deploy_log" "$tag" "$commit" "$verdict" "${failures[@]}"
  fi

  # ---- Took (T6 step 9; step 8 is the owner's) -------------------------------------
  # Said first, logged after: a log that cannot be written changes neither.
  echo
  say "the deploy took: ${tag} (${commit}) runs, and answered every check."
  printf '%s\n' "${reversibility#*$'\n'}"
  say "The hold is still on. Lift it yourself, after looking (workplan 0132 T6 step 8): the tick's next summary shows passes started, and one of your own migrations should complete a pass on the new tasks."
  log_deploy "$deploy_log" "$tag" "$commit" took "$verdict"
  # The next deploy refuses a tree that is not clean, so say it now.
  if ! dirty="$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)"; then
    say "NOTE: git could not read the working tree after the deploy (above); the next deploy asks again."
  elif [ -n "$dirty" ]; then
    say "NOTE: the deploy left the working tree changed, and the next deploy refuses that:" "$dirty" \
      "Look at it (git diff). The task deploy is known to strip apps/worker/package.json's last newline."
  fi
}

# json_string <field> — the string value of that field of the JSON object on
# stdin, or nothing. node is there: the bring-up needs it.
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

# The project Compose itself reports from here. Answering another one means
# something above was missed. The rendered config holds secrets, so only its
# name line leaves this function; on a failure Compose prints its error alone.
compose_reports_project() {
  local cfg
  if ! cfg="$("${COMPOSE[@]}" config 2>&1)"; then
    printf '%s\n' "$cfg" >&2
    return 1
  fi
  sed -n 's/^name:[[:space:]]*//p' <<<"$cfg"
}

# One line, `superuser|open holds|age of the open hold in seconds|passes in
# flight`, read as the owner over the postgres container's own socket. Reads
# only. The in-flight count is the tick's own (managed-sync-tick.ts): `running`
# rows younger than STALE_RUN_AFTER_MS.
db_read() {
  "${COMPOSE[@]}" exec -T postgres sh -c 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<SQL
SELECT (SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'yes' ELSE 'no' END
          FROM pg_roles WHERE rolname = current_user) AS superuser,
       (SELECT count(*) FROM platform_pause WHERE ended_at IS NULL) AS open_holds,
       (SELECT coalesce(floor(extract(epoch FROM now() - max(started_at)))::bigint, -1)
          FROM platform_pause WHERE ended_at IS NULL) AS hold_age_seconds,
       (SELECT count(*) FROM run
         WHERE status = 'running'
           AND started_at > now() - interval '${STALE_RUN_AFTER_SECONDS} seconds') AS in_flight;
SQL
}

# comparison_bases <deploy-log> — what the new tag is compared with, one per
# line, `<commit>\t<name>\t<what it is>`, each commit once: the last deploy
# that took; every deploy that did not take since (its bring-up may have run);
# and the checkout's HEAD. With no deploy that took, what ran before the log's
# first line is not named anywhere: when that first deploy was reversible over
# it, its chains and pins were the same, so its own line stands in; otherwise
# it is a `-` line, which cannot be compared.
comparison_bases() {
  local log="$1" head head_name
  head="$(git -C "$REPO_ROOT" rev-parse HEAD)" || return 1
  head_name="$(git -C "$REPO_ROOT" describe --tags --exact-match HEAD 2>/dev/null || printf '%s' "$head")"
  [ -f "$log" ] || log=/dev/null
  awk -F '\t' -v head="$head" -v head_name="$head_name" '
    function out(k, nm, wh) {
      if (k in seen) return
      seen[k] = 1
      printf "%s\t%s\t%s\n", k, nm, wh
    }
    BEGIN { n = 0 }
    $4 == "took" { took_c = $3; took_t = $2; n = 0; next }
    $4 == "did-not-take" {
      if (n_all++ == 0) { first_t = $2; first_v = $5 }
      c[n] = $3; t[n] = $2; n++
    }
    END {
      if (took_c != "") out(took_c, took_t, "the last deploy that took (deploys.log)")
      else if (n > 0 && first_v != "reversible")
        out("-", "what ran before " first_t, "deploys.log records no deploy that took, and " first_t ", its first, was one-way over it")
      for (i = 0; i < n; i++)
        out(c[i], t[i], "a deploy that did not take (deploys.log), whose bring-up may have migrated the database")
      out(head, head_name, (took_c == "" && n == 0) ? "this checkout'"'"'s HEAD (deploys.log records no deploy yet)" : "this checkout'"'"'s HEAD")
    }' "$log"
}

# image_pins <commit> <pattern> — the image lines of managed.yml at that commit
# that match, sorted, or nothing.
image_pins() {
  git -C "$REPO_ROOT" show "$1:deploy/compose/managed.yml" 2>/dev/null |
    sed -n "s/^[[:space:]]*image:[[:space:]]*\(.*${2}.*\)$/\1/p" | sort -u
}

# differences <base> <new> — what <new> does over <base> that makes it
# one-way, one line each, or nothing.
differences() {
  local base="$1" new="$2" changed kind file line old_pins new_pins nl=$'\n'
  if [ "$base" = - ]; then
    echo "cannot be compared with it: deploys.log does not name it"
    return 0
  fi
  if ! git -C "$REPO_ROOT" cat-file -e "${base}^{commit}" 2>/dev/null; then
    echo "cannot be compared with it: ${base} is not in this clone"
    return 0
  fi
  if ! changed="$(git -C "$REPO_ROOT" diff --name-status --no-renames "$base" "$new" -- "${MIGRATION_CHAINS[@]}")"; then
    echo "cannot be compared with it on the migration chains: git diff failed"
  fi
  while IFS=$'\t' read -r kind file; do
    [ -n "$file" ] || continue
    case "$kind" in
      A) echo "adds ${file}" ;;
      D) echo "removes ${file}" ;;
      *) echo "changes ${file}" ;;
    esac
  done <<<"$changed"
  for line in 'Trigger.dev:triggerdotdev\/' 'identity provider:zitadel\/zitadel'; do
    old_pins="$(image_pins "$base" "${line#*:}")"
    new_pins="$(image_pins "$new" "${line#*:}")"
    if [ -z "$old_pins" ] || [ -z "$new_pins" ]; then
      echo "cannot be compared with it on the ${line%%:*} pin: managed.yml at one of the two has no image line naming it"
    elif [ "$old_pins" != "$new_pins" ]; then
      echo "moves the ${line%%:*} pin in managed.yml: ${old_pins//$nl/, } -> ${new_pins//$nl/, }"
    fi
  done
}

# compare_releases <new> <tag> <base>… — each base a comparison_bases line.
# First line `one-way` or `reversible`, then what to tell the owner.
compare_releases() {
  local new="$1" tag="$2"
  shift 2
  local entry base name what found line back=''
  local -a listed=() over=()
  for entry in "$@"; do
    IFS=$'\t' read -r base name what <<<"$entry"
    [ -n "$base" ] || continue
    # The way back, when there is one: the first, the running release.
    [ "${#listed[@]}" -gt 0 ] || [ "$name" = "$tag" ] || back="$name"
    listed+=("${name}: ${what}")
    found="$(differences "$base" "$new")"
    if [ -n "$found" ]; then
      over+=("over ${name}, ${tag}")
      while IFS= read -r line; do over+=("  ${line}"); done <<<"$found"
    fi
  done
  if [ "${#listed[@]}" -eq 0 ]; then
    listed+=("nothing: neither deploys.log nor this checkout names a release")
    over+=("cannot be compared with what runs: nothing names it")
  fi
  if [ "${#over[@]}" -gt 0 ]; then echo one-way; else echo reversible; fi
  say "compared with what this stack has run:"
  printf '    %s\n' "${listed[@]}"
  if [ "${#over[@]}" -gt 0 ]; then
    say "one-way: after ${tag}, deploying a tag this stack ran before is no way back."
    printf '    %s\n' "${over[@]}"
    say "  The API refuses an older build against a migrated schema, and the Trigger.dev and identity-provider planes migrate their own schemas one way (workplan 0146 T5)."
    say "  The way back, if this tag misbehaves, is forward: a fix, a new tag, this script. A dump taken before this deploy (0132 T6 step 4) is the only other."
  else
    say "reversible: over each of those, ${tag} adds, changes or removes no migration file in either chain, and moves neither the Trigger.dev nor the identity-provider pin in managed.yml."
    say "  If it misbehaves, ${back:-the release that ran before it} can be deployed again with this script."
  fi
}

# http_get <origin> <path> <body-var> <code-var> — true on a 200. Tries
# CHECK_TRIES times, a CHECK_INTERVAL apart, while the answer is not a 200.
# Never prints the origin or curl's own words, which name the host.
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
      _code="not reached at the origin in WEB_URL (curl exit ${rc}: 6 is no such name, 7 no connection, 28 a timeout, 35 or 60 TLS)"
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

# log_appendable <log> <dry-run> — whether a line could be appended to the log.
# The deploy makes the directory and the file when they are missing (an empty
# append), so that the line at the end meets what was checked. A dry run makes
# nothing: it asks of the file, when there is one, or else of the nearest
# directory that exists, in which the deploy would make the rest.
log_appendable() {
  local log="$1" dir
  if [ -z "$2" ]; then
    { mkdir -p "$(dirname "$log")" && : >>"$log"; } 2>/dev/null
    return
  fi
  if [ -e "$log" ]; then
    [ -f "$log" ] && [ -w "$log" ]
    return
  fi
  dir="$(dirname "$log")"
  while [ ! -e "$dir" ]; do dir="$(dirname "$dir")"; done
  [ -d "$dir" ] && [ -w "$dir" ] && [ -x "$dir" ]
}

# log_deploy <log> <tag> <commit> <outcome> <one-way|reversible> — appends the
# line and says where; when it cannot, says so and prints the line to add by
# hand. It never fails: the exit is the deploy's, not the log's.
log_deploy() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ)"$'\t'"$2"$'\t'"$3"$'\t'"$4"$'\t'"$5"
  if { mkdir -p "$(dirname "$1")" && printf '%s\n' "$line" >>"$1"; } 2>/dev/null; then
    say "Logged as $4 in $1."
  else
    say "could not append to $1, so this deploy is not logged. Add this line to it by hand:" "${line}"
  fi
}

# did_not_take <log> <tag> <commit> <one-way|reversible> <why>… — says so, then
# logs it, and exits 3.
did_not_take() {
  local log="$1" tag="$2" commit="$3" verdict="$4"
  shift 4
  {
    echo
    printf '[deploy-live] the deploy did not take: %s is checked out, and\n' "$tag"
    printf '    %s\n' "$@"
    printf '[deploy-live] The hold stays on. Nothing was lifted. Fix the cause and run this again with %s, or name another tag; the next deploy is compared with %s too.\n' "$tag" "$tag"
    log_deploy "$log" "$tag" "$commit" did-not-take "$verdict"
  } >&2
  exit 3
}

# ONE LINE, ON PURPOSE. The checkout above replaces this file with the tag's
# copy while it runs. Bash reads a script as it goes, so a line after `main`
# would be read from whatever is on disk by then; `exit` on the same line is
# read before `main` starts.
main "$@"; exit $?
