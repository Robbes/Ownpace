#!/usr/bin/env bash
# trigger-remember-token.sh — put the CLI's own access token into .env, so a
# deploy never asks for a browser again.
#
# THE DANCE THIS EXISTS TO END (owner, 2026-09-03: "this is no fun at all").
# `deploy-tasks.sh` stopped mid-bring-up with "Not logged in under the profile
# 'openmig'", and getting past it took four commands and a browser: logout
# first (login alone short-circuits on the stale token and reports success),
# then login, then open a self-signed https URL, then re-run the deploy. That
# is the SECOND time the same wall was hit on the same machine, and the walls
# are not the same wall twice by accident — a CLI profile lives in
# `~/.config/trigger/config.json`, on the HOST, and outlives every `down -v`,
# wipe and rename the instance goes through. The token in it is then a
# credential for an account the instance no longer has.
#
# THE ANSWER WAS ALREADY IN THE REPOSITORY, unused on a self-hosted box.
# `TRIGGER_ACCESS_TOKEN` short-circuits the whole login path: the CLI's
# `deploy` calls `login({embedded:true})`, whose FIRST branch reads that
# variable, validates it against the server and returns — no browser, no
# profile file (trigger-cli-lib.sh says so at length, from the CLI's own
# source). It is the CLI's documented answer for CI, and the E2E workflow has
# used it as a repository secret since #460. Nothing ever put one in the .env
# of a real stack, so every operator kept doing it by hand.
#
# So: lift the token the CLI has ALREADY minted into the file the stack reads.
# One login, ever. After that `bootstrap-managed.sh --from app` runs start to
# finish with nobody watching, which is the property the whole script has been
# missing.
#
# WHAT IT WILL NOT DO
#
#   * Print the token, or any part of it. It is a credential with the same
#     reach as the deploy itself; it goes from one file to another and is
#     never rendered. The only output is which key was written, and where.
#   * Overwrite a token already in .env. One deliberately placed there — a
#     long-lived PAT minted at Account -> Personal Access Tokens — outranks
#     whatever a profile happens to hold. `--force` says otherwise.
#   * Guess between two candidates. A profile file with several tokens and no
#     entry under the profile's own name is an ambiguity, and this refuses it
#     the way `trigger_env` refuses two environment names: naming both beats
#     picking one.
#
# Usage:
#   ./trigger-remember-token.sh                 # remember it, if .env has none
#   ./trigger-remember-token.sh --force         # replace what .env holds
#   ./trigger-remember-token.sh --print-key     # say which key, write nothing
#
# Overrides:
#   TRIGGER_CLI_CONFIG   the profile file (default ~/.config/trigger/config.json)
#   TRIGGER_CLI_PROFILE  the profile to read (default from .env, then 'default')
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
KEY=TRIGGER_ACCESS_TOKEN

say() { echo "[remember-token] $*" >&2; }
die() { echo "[remember-token] $*" >&2; exit 1; }

FORCE=0
case "${1:-}" in
  --force) FORCE=1 ;;
  --print-key) echo "$KEY"; exit 0 ;;
  -h | --help) sed -n '2,50p' "${BASH_SOURCE[0]}"; exit 0 ;;
  '') : ;;
  *) die "unknown argument '$1' (try --help)" ;;
esac

command -v jq >/dev/null 2>&1 || die "jq is required to read the profile file."

CONFIG="${TRIGGER_CLI_CONFIG:-${HOME}/.config/trigger/config.json}"
[ -f "$CONFIG" ] || die "no CLI profile file at ${CONFIG} — log in once first."

# The profile name, resolved the way every other script here resolves it:
# this shell first, then the file, then the CLI's own default.
profile="${TRIGGER_CLI_PROFILE:-}"
if [ -z "$profile" ] && [ -f "$ENV_FILE" ]; then
  profile="$(grep -E '^TRIGGER_CLI_PROFILE=' "$ENV_FILE" | tail -1 | cut -d= -f2- | sed 's/[[:space:]].*$//' || true)"
fi
profile="${profile:-default}"

# WHY THIS DOES NOT NAME A JSON PATH. The CLI owns that file's shape and has
# changed it across major versions; a hard-coded `.profiles[$p].accessToken`
# would read as working right up until an upgrade moved it, and then quietly
# find nothing — which looks exactly like "not logged in" and sends the
# operator back into the dance. What IS stable is the token's own prefix,
# which the CLI prints when it mints one (`Logged in with token tr_pat_…`).
# So: find the object keyed by this profile ANYWHERE in the document, and take
# the `tr_pat_` string inside it, wherever it sits.
token="$(jq -r --arg p "$profile" '
  [ .. | objects | select(has($p)) | .[$p] | .. | strings | select(startswith("tr_pat_")) ]
  | .[0] // empty
' "$CONFIG" 2>/dev/null || true)"

if [ -z "$token" ]; then
  # No entry under that name. Fall back to the whole document — but only when
  # there is exactly ONE token in it, so a machine with several profiles is
  # told rather than guessed at.
  mapfile -t all < <(jq -r '[ .. | strings | select(startswith("tr_pat_")) ] | unique | .[]' "$CONFIG" 2>/dev/null || true)
  case "${#all[@]}" in
    0) die "no access token found in ${CONFIG} for profile '${profile}'. Log in once first." ;;
    1) token="${all[0]}"; say "no entry named '${profile}'; using the only token in the file" ;;
    *) die "profile '${profile}' is not in ${CONFIG}, and it holds ${#all[@]} tokens — refusing to pick one. Set TRIGGER_CLI_PROFILE to the right name." ;;
  esac
fi

if [ -f "$ENV_FILE" ] && grep -qE "^${KEY}=." "$ENV_FILE" && [ "$FORCE" -eq 0 ]; then
  say "${ENV_FILE} already holds ${KEY} — left alone. --force replaces it."
  exit 0
fi

"${SCRIPT_DIR}/env-upsert.sh" "$ENV_FILE" "${KEY}=${token}" >/dev/null

# The value is never echoed — not even masked. What an operator needs to know
# is that the file now answers for the login, and where to look.
say "${KEY} written to ${ENV_FILE}: deploys no longer need a browser."
say "It is a credential — the file is already where this stack's secrets live."
say "To revoke it, delete the token at the dashboard's Personal Access Tokens."
