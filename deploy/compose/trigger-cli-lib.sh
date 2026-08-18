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
  local cmd="${TRIGGER_CLI_WHOAMI_CMD:-npx -y trigger.dev@${cli_version} whoami --profile ${profile}}"
  eval "$cmd" 2>&1 | grep -q "^User ID:"
}
