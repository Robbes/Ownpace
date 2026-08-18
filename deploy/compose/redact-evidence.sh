#!/usr/bin/env bash
# Strip secrets out of managed-stack evidence before it becomes a CI artifact
# (workplan 0084 T5).
#
# `smoke-managed.sh`'s own header warns that runner debug logs print the FULL
# task environment — DATABASE_URL, SECRET_ENCRYPTION_KEY, the tr_prod_ key.
# Uploading that unmodified is a credential disclosure with a retention policy
# attached, and CI artifacts are downloadable by anyone who can read the repo.
#
# A separate script rather than inline YAML because this is the one step whose
# bug is a disclosure, and a shell block inside a workflow cannot be tested.
# `redact-evidence.unit.test.ts` feeds it a log full of real-shaped secrets and
# asserts none survive.
#
# Two passes, and the second is the one that matters:
#
#   1. **By value**, for every secret we can name from .env. Value-based rather
#      than key-based because the logs print `KEY=value` in some places and
#      bare values in others, and only the value is secret.
#   2. **By shape**, for connection strings and token-looking strings. This
#      catches the passwords we could NOT name — a value set directly in the
#      Trigger.dev dashboard, or one that arrived through a container's own
#      environment. Pass 1 alone would have missed exactly those, which are the
#      ones nobody remembers to add.
#
# Usage: redact-evidence.sh <dir>   (edits in place)

set -euo pipefail

DIR="${1:?usage: redact-evidence.sh <dir>}"
[ -d "$DIR" ] || { echo "[redact] no such directory: $DIR" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${REDACT_ENV_FILE:-${SCRIPT_DIR}/.env}"

# --- pass 1: every value in .env that looks like a secret --------------------
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in ''|\#*) continue ;; esac
    # Only values worth hiding, and long enough that replacing them cannot
    # mangle unrelated text. A three-character value would match everywhere.
    case "$key" in
      *SECRET*|*PASSWORD*|*KEY*|*TOKEN*|*_PW) : ;;
      *) continue ;;
    esac
    [ "${#value}" -ge 8 ] || continue
    # Escape for sed: the value can contain slashes and ampersands.
    escaped=$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')
    find "$DIR" -type f -exec sed -i "s|${escaped}|[REDACTED]|g" {} +
  done < "$ENV_FILE"
fi

# --- pass 2: by shape, for the ones we could not name ------------------------
find "$DIR" -type f -print0 | while IFS= read -r -d '' f; do
  sed -i -E \
    -e 's#(postgres(ql)?://[^:[:space:]]+):[^@[:space:]]+@#\1:[REDACTED]@#g' \
    -e 's#\btr_(prod|dev)_[A-Za-z0-9]{8,}#tr_\1_[REDACTED]#g' \
    -e 's#\b(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+#[REDACTED_JWT]#g' \
    "$f"
done

echo "[redact] cleaned $(find "$DIR" -type f | wc -l) file(s) in $DIR"
