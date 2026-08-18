#!/usr/bin/env bash
# trigger-magic-link.sh — find the sign-in link the self-hosted Trigger.dev
# webapp printed into its own logs.
#
# The instance has no mail server, so its magic-link login does the only other
# thing it can: it writes the link to stdout, where it is buried in whatever
# else the webapp logged in the same second. Every bring-up so far has meant
# eyeballing `docker logs trigger-api` for a URL. That is the step this
# replaces — not the human decision (you still have to open the link and name
# an organisation), just the hunting.
#
# ORDER MATTERS AND IS NOT OBVIOUS: the link does not exist until you ask for
# it. Open the dashboard, type your email, press the button — THEN run this.
# Running it first finds nothing, which looks like a broken stack and is not.
#
# Each link is single-use and short-lived. If one has already been spent, ask
# the dashboard for another and re-run; this always prints the newest.
#
# Usage:
#   ./trigger-magic-link.sh            # newest link, on stdout
#   ./trigger-magic-link.sh --all      # every link still in the log buffer
#
# Overrides:
#   TRIGGER_LOG_CMD    the command whose output is searched. Default is
#                      `docker logs --tail 2000 trigger-api`. Point it at a
#                      file (`cat some.log`) to search a captured log — which
#                      is also how the unit tests drive it.
#   TRIGGER_CONTAINER  container name for the default command (default trigger-api).
set -euo pipefail

ALL=0
case "${1:-}" in
  --all) ALL=1 ;;
  -h | --help) sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
  '') : ;;
  *) echo "trigger-magic-link.sh: unknown argument '$1'" >&2; exit 1 ;;
esac

CONTAINER="${TRIGGER_CONTAINER:-trigger-api}"
LOG_CMD="${TRIGGER_LOG_CMD:-docker logs --tail 2000 ${CONTAINER}}"

# `2>&1`: the webapp logs this on stderr in some versions and stdout in
# others, and which one it is has never been the interesting question.
if ! log="$(eval "$LOG_CMD" 2>&1)"; then
  echo "[magic-link] could not read the logs (${LOG_CMD}):" >&2
  printf '%s\n' "$log" | tail -5 | sed 's/^/    /' >&2
  exit 1
fi

# Matched by SHAPE, not by the sentence around it. The webapp's wording for
# this line is its own and has changed between versions; what has not changed
# is that the thing is a URL with `magic` in its path. Anchoring on a log
# prefix would make a Trigger.dev copy-edit look like a broken bring-up.
#
# The trailing character class stops at quotes, angle brackets, commas and
# whitespace, because the URL is usually inside JSON or a sentence.
links="$(printf '%s\n' "$log" |
  grep -oE 'https?://[^][:space:]"'"'"'<>,\\]*magic[^][:space:]"'"'"'<>,\\]*' || true)"

if [ -z "$links" ]; then
  cat >&2 <<EOF
[magic-link] No sign-in link in the last logs of '${CONTAINER}'.

  The link is only written when one is REQUESTED. In order:
    1. Open the dashboard   (TRIGGER_APP_ORIGIN in deploy/compose/.env —
                             https://<host>:3443 by default, via trigger-tls;
                             plain http works only from localhost, because the
                             production-mode session cookie is Secure)
    2. Type any email address you want the account to be under, and submit.
    3. Re-run this script.

  If it is still empty, look by hand — the wording may have changed:
    docker logs --tail 200 ${CONTAINER} | grep -i -e magic -e 'sign.in' -e token
EOF
  exit 1
fi

if [ "$ALL" -eq 1 ]; then
  printf '%s\n' "$links"
  exit 0
fi

# Newest last: container logs are chronological, so the last match is the most
# recently issued link — and an older one may already have been spent.
printf '%s\n' "$links" | tail -1
