#!/usr/bin/env bash
# trigger-cli-lib.sh — shared helpers for the scripts that act on the
# Trigger.dev instance. Sourced, not run.
#
# EVERY CALLER RUNS `set -euo pipefail`, so the pipelines in here run under it
# even though a sourced file sets nothing itself. That sentence is also what
# keeps this file inside `no-pipeline-its-own-consumer-can-kill`'s scope, which
# is deliberate: it found a real SIGPIPE bug here the first time it looked.
#
# It began as helpers for the two scripts that shell out to the deploy CLI.
# `trigger_env` below is used by set-task-env.sh and trigger-credentials.sh
# too, neither of which touches the CLI — because the thing they have to agree
# about is which ENVIRONMENT they are acting on, and agreement needs one copy.
#
# WHICH TRIGGER ENVIRONMENT THIS STACK ACTS ON — one name, one resolution.
#
# Three scripts choose an environment, and until 2026-08-31 they disagreed
# about how, in three ways at once:
#
#   deploy-tasks.sh        read TRIGGER_ENV        after sourcing .env
#   set-task-env.sh        read TRIGGER_ENV_SLUG   BEFORE sourcing .env
#   trigger-credentials.sh read TRIGGER_ENV_SLUG   and never sources .env at all
#
# All three defaulted to `prod`, so they agreed only by the accident of a
# shared default. `managed.env.example` ships TRIGGER_ENV and
# docs/managed-bring-up.md §9 tells you to set TRIGGER_ENV — so following this
# repository's own documented procedure moved ONE of the three: tasks deployed
# to the new environment, task variables uploaded to the old one, and
# `trigger-credentials.sh --write` read the old environment's key and wrote it
# back over .env. deploy-tasks.sh's own refusal describes the result — "nothing
# errors; the runs never meet a deployed task."
#
# So: TRIGGER_ENV is the name, this is the only place it is resolved, and the
# answer does not depend on whether the caller happens to have sourced .env.
TRIGGER_ENV_DEFAULT=prod

# trigger_env [env_file] — the environment name, on stdout.
#
# Shell first (overriding one command), then the env file, then the default.
# Reading the FILE rather than requiring a sourced .env is what makes the three
# callers agree: one of them cannot source it, because it runs `docker compose
# exec` and exporting the whole file would put shell values in front of
# compose's own interpolation.
#
# Returns non-zero on an ambiguity rather than picking one, so callers use
# `X="$(trigger_env "$f")" || exit 1`. Guessing between two names that disagree
# is precisely how the deploy, the variables and the key came apart.
trigger_env() {
  local file="${1:-}" want legacy from_file="" legacy_file=""
  if [ -n "$file" ] && [ -f "$file" ]; then
    # `|| true`: under `set -o pipefail` a grep that finds nothing fails the
    # pipeline, and "this key is not set" is a normal answer (bootstrap's
    # env_get says the same thing for the same reason).
    from_file="$(grep -E '^TRIGGER_ENV=' "$file" | tail -1 | cut -d= -f2- || true)"
    legacy_file="$(grep -E '^TRIGGER_ENV_SLUG=' "$file" | tail -1 | cut -d= -f2- || true)"
  fi
  want="${TRIGGER_ENV:-$from_file}"
  legacy="${TRIGGER_ENV_SLUG:-$legacy_file}"

  if [ -n "$want" ] && [ -n "$legacy" ] && [ "$want" != "$legacy" ]; then
    echo "[trigger] TRIGGER_ENV='${want}' and TRIGGER_ENV_SLUG='${legacy}' disagree." >&2
    echo "[trigger] TRIGGER_ENV_SLUG is the OLD name for this one setting — delete it." >&2
    echo "[trigger] Refusing rather than picking: one of them would decide where the tasks" >&2
    echo "[trigger] deploy and the other where their variables and key come from, and that" >&2
    echo "[trigger] combination fails silently at run time rather than here." >&2
    return 1
  fi

  if [ -z "$want" ] && [ -n "$legacy" ]; then
    echo "[trigger] TRIGGER_ENV_SLUG is the old name for TRIGGER_ENV — using '${legacy}'." >&2
    echo "[trigger] Rename it in your env file; one name now decides all three." >&2
    printf '%s' "$legacy"
    return 0
  fi

  printf '%s' "${want:-$TRIGGER_ENV_DEFAULT}"
}

# THE PROFILE NAME'S DEFAULT, IN ONE PLACE.
#
# `openmig` is pre-rename branding (ADR-0040) and stays the default on
# purpose: a machine already logged in under it — the gate's runner, most
# likely — would be stranded by a default that moved under it (workplan 0099).
#
# It lives HERE rather than as a literal in each caller because both callers
# now do two different things with it: RESOLVE the profile from it, and PRINT
# it when they refuse. A default that is applied in one place and described in
# another is two copies, and the described copy is the one that goes stale
# without anything failing.
TRIGGER_CLI_PROFILE_DEFAULT=openmig

# WHERE THE PROFILE NAME CAME FROM — a sentence, for a refusal to print.
#
# Both refusals used to say "(default '<resolved profile>')", which labels the
# RESOLVED value as the default. With TRIGGER_CLI_PROFILE set, that hands an
# operator their own setting back as though it were the built-in one, hiding
# both that they set it and what the default actually is.
#
# On 2026-08-31 the owner read exactly that, mid bring-up: `.env` said
# `ownpace`, the host's CLI store held only `openmig`, and this message said
# the default was `ownpace`. Three facts, two of them true, and the false one
# was the one that looked like the answer — it sent him looking for `openmig`
# wired into a repository that does not wire it anywhere but here.
#
# So which name is in use, and where that name came from, are two facts and
# get printed as two (hard rule 10).
# It answers ONLY "where did this name come from". It deliberately does not
# print the default: a caller that wants it prints
# $TRIGGER_CLI_PROFILE_DEFAULT itself, on its own line, so the default a
# message shows is the same string the resolution above applied — not a
# second rendering of it that can disagree.
trigger_cli_profile_origin() {
  if [ -n "${TRIGGER_CLI_PROFILE:-}" ]; then
    printf "set as TRIGGER_CLI_PROFILE"
  else
    printf "nothing set it; TRIGGER_CLI_PROFILE is empty here"
  fi
}

# `trigger.dev whoami` cannot be trusted by exit code.
#
# Read from the installed CLI's own source (dist/esm/commands/whoami.js +
# cli/common.js, trigger.dev@4.5.9 and 4.5.11 — both the same): on an auth
# failure it returns `{success:false}` AS DATA rather than throwing, and
# `wrapCommandAction` only marks the process failed when something THROWS.
# So `whoami --profile X >/dev/null 2>&1; echo $?` prints 0 whether you are
# logged in, your token was revoked, or you were never logged in at all.
#
# This bit twice on one machine the same day (2026-08-18): the local CLI
# profile at ~/.config/trigger/config.json survives `reset-trigger.sh`
# untouched — same api-url, a token the new instance has never heard of —
# and both bootstrap-managed.sh's `login` phase and deploy-tasks.sh's
# preflight trusted the exit code, reported "already logged in", and skipped
# the human step. `deploy` only failed for real once it tried to USE the
# token somewhere that genuinely throws:
#
#   ◇  Failed to check account details. You may want to r[un logout...]
#   ■  Error: Unable to validate existing personal access token
#   X Error: You must login first. Use the `login` CLI command.
#
# So: run it for real and look for the one line only a genuine successful
# lookup prints — `User ID:`, from `whoami.js`'s success path. Anything
# else (a login prompt, a fetch failure, an exception) is "not logged in",
# regardless of what the process exited with.
trigger_cli_logged_in() { # trigger_cli_logged_in <cli_version> <profile>
  local cli_version="$1" profile="$2"

  # TRIGGER_ACCESS_TOKEN short-circuits this entirely, and has to: `whoami`
  # (dist/esm/commands/whoami.js) calls isLoggedIn(), which reads ONLY the
  # local profile file and never looks at this variable — confirmed from the
  # installed CLI's own source. `deploy` is different: it calls
  # login({embedded:true}) internally, and login()'s FIRST branch checks
  # TRIGGER_ACCESS_TOKEN before ever touching the profile file, validates it
  # against the server, and returns success or throws — no browser, no file.
  #
  # This is also the CLI's own documented answer for CI: login() throws
  # "Authentication required in CI environment. Please set the
  # TRIGGER_ACCESS_TOKEN environment variable..." when it detects it cannot
  # run the interactive flow. So a `whoami`-based check cannot see this
  # token no matter how it is invoked, but `deploy` uses it successfully
  # regardless — trust it directly rather than trying to make `whoami`
  # agree. A bad token still fails, loudly, inside `deploy` itself; that is
  # an acceptable failure mode for a value meant to be minted at the
  # platform's own UI (Account -> Personal Access Tokens) and verified once,
  # by hand, before it is ever stored as a CI secret.
  [ -n "${TRIGGER_ACCESS_TOKEN:-}" ] && return 0

  local cmd="${TRIGGER_CLI_WHOAMI_CMD:-npx -y trigger.dev@${cli_version} whoami --profile ${profile}}"

  # WHY THIS IS NOT `grep -q "^User ID:"`, which is what it used to be.
  #
  # The CLI draws its account details inside a box, so the line it actually
  # prints is:
  #
  #     |  User ID: cmt0uv3zg0005r05dwkrmhgfy  |
  #
  # (with U+2502 boxes, not ASCII pipes). An anchored match can never see that,
  # so a correctly logged-in operator was told "Not logged in" immediately after
  # a successful `login` — and the advice was to run `login` again, which
  # short-circuits on "already logged in". A loop with no exit.
  #
  # Presentation is the CLI's business and changes under version bumps, so the
  # matcher tolerates decoration instead of assuming a layout: strip any leading
  # non-letter bytes (box characters, pipes, whitespace) and THEN anchor. That
  # keeps the property the anchor was there for — an error dump saying "no User
  # ID: field was present" begins with a letter, so nothing is stripped and it
  # still does not match — while accepting both the bare and boxed forms.
  #
  # Requiring an alphanumeric AFTER the colon is the other half: it asserts a
  # lookup returned a value, rather than that the words appeared.
  local out normalised
  out="$(eval "$cmd" 2>&1)"
  # `grep -q` READS FROM A HERE-STRING, NOT FROM A PIPE, and that is not style.
  # It exits at the first match without draining, so a producer still writing
  # dies of SIGPIPE and `set -o pipefail` — which every caller of this file
  # sets — hands back 141 for a match that SUCCEEDED. Short output finishes
  # first and hides it, which is why this passed for months while sitting in
  # the "am I logged in" check itself. Found 2026-08-31 by
  # `no-pipeline-its-own-consumer-can-kill`, the moment this file came into its
  # scope; `sed` below drains its input, so that half is safe as a pipe.
  normalised="$(printf '%s\n' "$out" | sed 's/^[^A-Za-z]*//')"
  if grep -q "^User ID:[[:space:]]*[A-Za-z0-9]" <<<"$normalised"; then
    return 0
  fi
  # Say what the CLI actually answered. The previous silence is what made this
  # take a human several rounds: "Not logged in" with no evidence is
  # indistinguishable from a detector that cannot read a valid answer.
  if [ "${TRIGGER_CLI_EXPLAIN:-1}" != "0" ]; then
    printf '%s\n' "$out" | sed 's/^/    [whoami] /' >&2
  fi
  return 1
}

# WHICH PROFILES THIS MACHINE IS LOGGED IN UNDER.
#
# "Not logged in, run login --profile openmig" is a true statement and a
# useless one when you ARE logged in, as `ownpace`, and nothing on screen
# mentions that a profile NAME is configurable at all. That happened on the
# Spark (0099): the operator ran the printed command with a different profile,
# it succeeded, and the phase refused again — because the script kept asking
# about `openmig`, which is pre-rename branding nobody had reason to guess.
#
# `openmig` stays the DEFAULT deliberately: the gate's runner may be logged in
# under it, and silently moving the default would strand that instead. What is
# fixed is that the refusal now names TRIGGER_CLI_PROFILE and shows what is
# actually there, so the operator can point the variable at what they have
# rather than log in a second time.
#
# STDOUT IS THIS FUNCTION'S VALUE — one profile name per line, nothing else,
# and nothing at all when the answer is unknown. A caller decides how to say
# it; guessing here would put prose where a list was expected.
trigger_cli_profiles_present() {
  local file
  # Both layouts seen across 4.x. Whichever exists is read; a machine with
  # neither has never logged in, which the caller already knows.
  for file in "${HOME}/.config/trigger/config.json" "${HOME}/.config/.trigger/config.json"; do
    [ -f "$file" ] || continue
    command -v jq >/dev/null 2>&1 || return 0
    # Two shapes, again version-dependent: profiles under a `profiles` key, or
    # as the top-level object itself. `// empty` and the `?` keep a shape this
    # does not recognise silent rather than noisy — an unreadable config is not
    # evidence about what is logged in.
    jq -r 'if type == "object" then (if has("profiles") then .profiles else . end | keys[]?) else empty end' \
      "$file" 2>/dev/null || true
    return 0
  done
}
