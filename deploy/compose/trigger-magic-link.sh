#!/usr/bin/env bash
# trigger-magic-link.sh — find the sign-in link the self-hosted Trigger.dev
# webapp printed into its own logs.
#
# The instance has no mail server, so its magic-link login does the only other
# thing it can: it writes the link to stdout, where it is buried in whatever
# else the webapp logged in the same second. Every bring-up so far has meant
# eyeballing the `trigger-api` service's log for a URL. That is the step this
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
#   TRIGGER_LOG_CMD    the command whose output is searched. Default is the
#                      last 2000 lines of the `trigger-api` service, through
#                      `docker compose logs`, so of THIS checkout's stack and
#                      no other on the machine (workplan 0132 T1). Point it at
#                      a file (`cat some.log`) to search a captured log — which
#                      is also how the unit tests drive it.
#   TRIGGER_CONTAINER  a container to read with `docker logs` instead.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ALL=0
case "${1:-}" in
  --all) ALL=1 ;;
  -h | --help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
  '') : ;;
  *) echo "trigger-magic-link.sh: unknown argument '$1'" >&2; exit 1 ;;
esac

# Through Compose, which picks the stack the checkout's own .env names; a bare
# `docker logs` of a fixed name read whichever stack owned that name.
if [ -n "${TRIGGER_CONTAINER:-}" ]; then
  SOURCE="container '${TRIGGER_CONTAINER}'"
  DEFAULT_LOG_CMD="docker logs --tail 2000 $(printf '%q' "${TRIGGER_CONTAINER}")"
  BY_HAND="docker logs --tail 200 $(printf '%q' "${TRIGGER_CONTAINER}")"
else
  SOURCE="the trigger-api service"
  DEFAULT_LOG_CMD="docker compose -f $(printf '%q' "${SCRIPT_DIR}/managed.yml") logs --no-color --no-log-prefix --tail 2000 trigger-api"
  BY_HAND="docker compose -f $(printf '%q' "${SCRIPT_DIR}/managed.yml") logs --no-color --no-log-prefix --tail 200 trigger-api"
fi
LOG_CMD="${TRIGGER_LOG_CMD:-${DEFAULT_LOG_CMD}}"

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
[magic-link] No sign-in link in the last logs of ${SOURCE}.

  The link is only written when one is REQUESTED. In order:
    1. Open the dashboard   (TRIGGER_APP_ORIGIN in deploy/compose/.env —
                             https://<host>:3443 by default, via trigger-tls;
                             plain http works only from localhost, because the
                             production-mode session cookie is Secure)
    2. Type any email address you want the account to be under, and submit.
    3. Re-run this script.

  If it is still empty, look by hand — the wording may have changed:
    ${BY_HAND} | grep -i -e magic -e 'sign.in' -e token
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
