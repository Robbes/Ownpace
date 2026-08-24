#!/usr/bin/env bash
# trigger-cli-lib.sh — shared helpers for scripts that shell out to the
# Trigger.dev deploy CLI. Sourced, not run.
#
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
  local out
  out="$(eval "$cmd" 2>&1)"
  if printf '%s\n' "$out" | sed 's/^[^A-Za-z]*//' | grep -q "^User ID:[[:space:]]*[A-Za-z0-9]"; then
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
