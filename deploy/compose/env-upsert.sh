#!/usr/bin/env bash
# env-upsert.sh — set or replace keys in a compose `.env` file, in place,
# without duplicating them and without disturbing the comments around them.
#
# Every other script in this directory READS deploy/compose/.env; this is the
# one that WRITES it, and it exists because the three obvious one-liners are
# all wrong in a way that only shows up later:
#
#   echo "K=v" >> .env        duplicates the key. Compose takes the LAST one,
#                             `set -a; . .env` takes the last one too — but a
#                             human reading the file sees the first and
#                             debugs a value that is not in force.
#   sed -i "s|^K=.*|K=v|"     silently does nothing when the key is absent,
#                             which is exactly the first-bring-up case.
#   sed + echo fallback       loses the key's place in the file, so the value
#                             ends up under an unrelated comment header.
#
# So: an existing key is replaced WHERE IT ALREADY IS (every duplicate of it
# collapsed into that one line), and a new key is appended at the end. The file
# is rewritten atomically — a crash mid-write leaves the old file, not half of
# a new one, because half a `.env` is a stack that boots with the wrong
# credentials rather than one that refuses.
#
# Usage:
#   env-upsert.sh <env-file> KEY=VALUE [KEY=VALUE ...]
#   env-upsert.sh --if-absent <env-file> KEY=VALUE ...   # never overwrite
#
# --if-absent is for generated defaults (the host's DEPLOY_IMAGE_PLATFORM, say):
# it fills a key that is missing or empty and leaves an operator's own value
# alone. Without it, the given value wins — which is what you want when the
# value was just minted by the thing that owns it.
#
# Exit codes: 0 wrote (or had nothing to write), 1 refused. Refusals name the
# key and the reason; see VALUE RULES below.
set -euo pipefail

IF_ABSENT=0
if [ "${1:-}" = "--if-absent" ]; then
  IF_ABSENT=1
  shift
fi

ENV_FILE="${1:-}"
shift || true

if [ -z "$ENV_FILE" ] || [ "$#" -eq 0 ]; then
  echo "usage: env-upsert.sh [--if-absent] <env-file> KEY=VALUE [KEY=VALUE ...]" >&2
  exit 1
fi

# A SYMLINKED .env IS FOLLOWED, NOT REPLACED.
#
# The write below is write-temp-then-rename, and `mv -f tmp link` REPLACES THE
# LINK with a regular file. Silently: the next reader sees a perfectly good
# `.env`, and only the file it used to point at knows it has been orphaned.
#
# That matters because the Spark runs ONE managed stack from TWO checkouts —
# the operator's, and the gate's, which `actions/checkout` wipes of ignored
# files before every run and which therefore restores `.env` from
# `~/.persistent/ownpace-managed/`. The intended arrangement is one canonical
# file with the operator's checkout SYMLINKED to it, and a single upsert that
# quietly de-links it puts the two copies back out of step with nothing said.
#
# They did drift, on 2026-08-24, and the afternoon it cost is written up in
# workplan 0099: the `zitadel` role's password matched one copy, the bring-up
# presented the other, and the answer was a 300-second timeout followed by a
# crash loop that named a password nobody had changed.
#
# Resolving first also keeps the rename atomic. `mktemp "${ENV_FILE}.XXXXXX"`
# puts the temp file beside whatever ENV_FILE names — beside the LINK, on the
# link's filesystem, which need not be the target's. Renaming across
# filesystems is not atomic and `mv` falls back to copy-then-unlink.
if [ -L "$ENV_FILE" ]; then
  # `readlink -f` tolerates a missing FINAL component and nothing else, which
  # happens to be exactly the distinction worth making. A target file that does
  # not exist yet is a fresh machine — the operator linked to where the
  # persisted `.env` is going to live, and `touch` below creates it there. A
  # missing DIRECTORY on the way makes it fail, and refusing here is what stops
  # the run dying later inside `mktemp` with a bare "No such file or directory"
  # naming a path nobody typed.
  RESOLVED="$(readlink -f "$ENV_FILE" || true)"
  [ -n "$RESOLVED" ] || {
    echo "[env-upsert] REFUSED: ${ENV_FILE} is a symlink that cannot be resolved —" >&2
    echo "[env-upsert] a directory on the way to $(readlink "$ENV_FILE") does not exist." >&2
    echo "[env-upsert] Create it, or re-point the link. Nothing was written." >&2
    exit 1
  }
  ENV_FILE="$RESOLVED"
fi

touch "$ENV_FILE"

# VALUE RULES. Every consumer of this file sources it with `set -a; . .env`
# (deploy-tasks.sh, set-task-env.sh, the e2e workflow), so the file is not
# just read as data — it is EXECUTED by a shell. A value containing a quote,
# a backtick, a `$` or whitespace either changes meaning on the way in or runs
# as a command, and compose's own parser would disagree with the shell about
# which happened. None of the values this repo writes needs any of them, so
# rather than invent a quoting convention two parsers must agree on, refuse.
#
# The refusal is the feature: it fires at the moment a password with a `$` in
# it is being written, naming the key, instead of at the next `docker compose
# up` with a login failure that looks like the wrong password.
reject() {
  echo "[env-upsert] REFUSED ${1}: ${2}" >&2
  echo "[env-upsert] Nothing was written to ${ENV_FILE}." >&2
  exit 1
}

declare -a NAMES=()
declare -a VALUES=()
for pair in "$@"; do
  case "$pair" in
    *=*) : ;;
    *) reject "$pair" "not a KEY=VALUE pair" ;;
  esac
  name="${pair%%=*}"
  value="${pair#*=}"
  [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
    reject "$name" "not a valid environment variable name"
  [[ "$value" == *$'\n'* ]] && reject "$name" "value contains a newline"
  case "$value" in
    *[[:space:]]* | *\"* | *\'* | *\$* | *\`* | *\\*)
      reject "$name" "value contains whitespace or one of \" ' \$ \` \\ — every consumer sources this file with \`. .env\`, so such a value would be re-interpreted by the shell"
      ;;
  esac
  NAMES+=("$name")
  VALUES+=("$value")
done

# --if-absent: drop the pairs whose key already carries a non-empty value.
# `^K=.` rather than `^K=`: a bare `K=` left behind by copying
# managed.env.example is an absent value, not a set one.
declare -a PENDING_NAMES=()
declare -a PENDING_VALUES=()
for i in "${!NAMES[@]}"; do
  if [ "$IF_ABSENT" -eq 1 ] && grep -qE "^${NAMES[$i]}=." "$ENV_FILE"; then
    continue
  fi
  PENDING_NAMES+=("${NAMES[$i]}")
  PENDING_VALUES+=("${VALUES[$i]}")
done

if [ "${#PENDING_NAMES[@]}" -eq 0 ]; then
  exit 0
fi

# The rewrite. awk rather than sed: sed would need one pass per key and could
# not both replace-in-place and append-if-missing in the same pass, which is
# how the "lost its place in the file" bug gets in.
#
# Keys and values reach awk through the ENVIRON array, never through the
# program text or -v, so a value containing an awk metacharacter is data.
TMP="$(mktemp "${ENV_FILE}.upsert.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

UPSERT_COUNT="${#PENDING_NAMES[@]}" \
UPSERT_NAMES="$(printf '%s\n' "${PENDING_NAMES[@]}")" \
UPSERT_VALUES="$(printf '%s\n' "${PENDING_VALUES[@]}")" \
  awk '
  BEGIN {
    n = ENVIRON["UPSERT_COUNT"] + 0
    split(ENVIRON["UPSERT_NAMES"], names, "\n")
    split(ENVIRON["UPSERT_VALUES"], values, "\n")
    for (i = 1; i <= n; i++) { want[names[i]] = values[i]; seen[names[i]] = 0 }
  }
  {
    line = $0
    key = ""
    if (match(line, /^[A-Za-z_][A-Za-z0-9_]*=/)) {
      key = substr(line, 1, RLENGTH - 1)
    }
    if (key != "" && (key in want)) {
      if (seen[key] == 0) {
        # First occurrence keeps its place; later duplicates disappear, so the
        # value a reader sees and the value in force are the same line.
        print key "=" want[key]
        seen[key] = 1
      }
      next
    }
    print line
  }
  END {
    for (i = 1; i <= n; i++) {
      k = names[i]
      if (seen[k] == 0) print k "=" want[k]
    }
  }
' "$ENV_FILE" >"$TMP"

# Same directory, so this is a rename within one filesystem: atomic.
chmod --reference="$ENV_FILE" "$TMP" 2>/dev/null || chmod 600 "$TMP"
mv -f "$TMP" "$ENV_FILE"
trap - EXIT

for name in "${PENDING_NAMES[@]}"; do
  echo "[env-upsert] set ${name}"
done
