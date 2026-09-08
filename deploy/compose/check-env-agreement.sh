#!/usr/bin/env bash
# check-env-agreement.sh — refuse a .env value that two parsers read differently.
#
# ONE FILE, TWO PARSERS, AND THEY ONLY MOSTLY AGREE.
#
# `deploy/compose/.env` is read by at least two things that are not the same
# program:
#
#   - Docker Compose, through `env_file:` in managed.yml and `--env-file`, with
#     its own Go dotenv implementation;
#   - `set-task-env.sh`, with `set -a` and bash `source`, to carry those values
#     into the Trigger.dev task environment.
#
# For a plain single-line value they agree, which is why this has never been a
# problem for `LOG_LEVEL=info`. They stop agreeing the moment a value contains a
# dollar sign, a backslash, a quote, whitespace, or a newline — and then the api
# container holds one value and the task containers hold another, for the same
# key, both looking correct in isolation.
#
# For SECRET_ENCRYPTION_KEY that is not a configuration problem, it is data
# loss: the api encrypts a credential under one value and a task cannot decrypt
# it under the other. The failure surfaces as
#
#     Authentication failed: encrypted secret may be tampered or encrypted
#     with different key
#
# inside a sync pass, once a minute, naming nothing — which is exactly the shape
# that cost the reference deployment a tenth of its runs for several hours on
# 2026-09-08. (That instance turned out to be an old key rather than a parser
# disagreement; the owner's first instinct was "I had some issues with multiline
# in .env yesterday", and he was right that the mechanism exists. Nothing
# refused it, so nothing could have told him.)
#
# ## The rule, and why it is this one
#
# A value is safe when both parsers must read it identically:
#
#   1. SINGLE-QUOTED, with no internal single quote. Neither parser expands
#      anything inside single quotes — this is the one form with no ambiguity
#      at all, and it is the fix this script tells you to apply.
#   2. BARE and boring: only `A-Za-z0-9` and `_@%+=:,./-`. No whitespace, no
#      `$`, no backtick, no backslash, no quote. Every value our own tooling
#      writes is this shape (`env-upsert.sh` writes unquoted, and
#      `ensure-env-secrets.sh` generates hex), so the ordinary file passes
#      untouched.
#
# A trailing ` # comment` is stripped before the value is judged, because both
# parsers strip one: bash because `#` starts a comment, Compose because it
# strips an inline comment preceded by whitespace. That much they agree on, and
# the file this repository ships relies on it.
#
# A `#` INSIDE a bare value — `a#b`, no space — is refused even though today's
# bash and today's Compose both keep it. Compose's inline-comment handling has
# moved between versions, and a value whose meaning depends on which Compose is
# installed is the definition of what this script is for. Single-quoting it
# costs two characters and settles it for every version.
#
# DOUBLE QUOTES ARE REFUSED even though they often work, and that is deliberate.
# Inside double quotes Compose's dotenv expands `\n` to a newline and bash's
# `source` does not — so `"a\nb"` is two different values depending on who is
# reading, which is the whole subject of this file. Single quotes cost one
# keystroke more and cannot do that.
#
# ## It never sources the file
#
# Scanning, never executing. A `.env` containing `KEY=$(rm -rf ~)` is precisely
# the kind of file this exists to catch, and `source` would run it while finding
# out. So this reads text and makes no assignments.

set -uo pipefail

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "usage: check-env-agreement.sh <env-file>" >&2
  exit 64
fi
if [ ! -f "$FILE" ]; then
  echo "check-env-agreement: $FILE not found" >&2
  exit 64
fi

# The characters that mean the same thing to everybody. Deliberately short: a
# value outside it is not necessarily wrong, it is UNDECIDED, and the remedy is
# to say which you meant by quoting it.
BARE_SAFE='^[A-Za-z0-9_@%+=:,./-]*$'

problems=0
lineno=0

# `|| [ -n "$line" ]` so a final line with no trailing newline is still read.
while IFS= read -r line || [ -n "$line" ]; do
  lineno=$((lineno + 1))

  # Blank, or a whole-line comment.
  case "$line" in '' | [[:space:]]* | '#'*) continue ;; esac

  # `export KEY=value` is valid in both, and the export is not the subject.
  line="${line#export }"

  case "$line" in
    [A-Za-z_]*'='*) ;;
    *)
      echo "  line ${lineno}: not KEY=value and not a comment — ${line}" >&2
      problems=$((problems + 1))
      continue
      ;;
  esac

  key="${line%%=*}"
  value="${line#*=}"

  # SINGLE-QUOTED: safe, and the only form that is safe unconditionally. The
  # value must OPEN and CLOSE with a quote and hold none in between — a second
  # quote would end the literal early and hand the rest to the parser's own
  # rules, which is where the two diverge again.
  case "$value" in
    "'"*)
      inner="${value#\'}"
      body="${inner%%\'*}"
      rest="${inner#"$body"}"
      if [ "${rest#\'}" = "$rest" ]; then
        echo "  ${key} (line ${lineno}): opens a single quote and never closes it." >&2
        echo "      An unclosed quote swallows the lines below it in one parser and not" >&2
        echo "      the other, so the file means two different things." >&2
        problems=$((problems + 1))
        continue
      fi
      # Anything after the closing quote must be only whitespace or a comment.
      tail_after="${rest#\'}"
      case "$tail_after" in
        '' | [[:space:]]*'#'* | [[:space:]]*) ;;
        *)
          echo "  ${key} (line ${lineno}): text after the closing quote." >&2
          echo "      Both parsers stop at the quote and then disagree about the rest." >&2
          problems=$((problems + 1))
          ;;
      esac
      continue
      ;;
  esac

  # Not quoted: strip one trailing whitespace-preceded comment, as both do.
  bare="$value"
  case "$bare" in
    *[[:space:]]'#'*) bare="${bare%%[[:space:]]#*}" ;;
  esac
  # And the trailing whitespace the comment left behind.
  bare="${bare%"${bare##*[![:space:]]}"}"

  if [[ "$bare" =~ $BARE_SAFE ]]; then
    continue
  fi

  echo "  ${key} (line ${lineno}): the value is read differently by different parsers." >&2
  case "$bare" in
    '"'*)
      echo "      It is DOUBLE-quoted. Compose expands \\n inside double quotes and bash's" >&2
      echo "      \`source\` does not, so this is two values depending on who reads it." >&2
      ;;
    *'$('* | *'`'*)
      echo "      It contains a command substitution. \`source\` would EXECUTE it; Compose" >&2
      echo "      would not. A .env file is data, and this script never sources one." >&2
      ;;
    *'$'*)
      echo "      It contains a dollar sign, which one parser expands and the other may not." >&2
      ;;
    *[[:space:]]*)
      echo "      It contains whitespace, which ends the value for one parser and not the other." >&2
      ;;
    *'#'*)
      echo "      It contains a '#'. Compose's inline-comment handling has changed between" >&2
      echo "      versions, so where this value ends depends on which Compose is installed." >&2
      ;;
  esac
  echo "      Fix: wrap it in SINGLE quotes — ${key}='...' — which both read literally." >&2
  problems=$((problems + 1))
done <"$FILE"

if [ "$problems" -gt 0 ]; then
  echo "" >&2
  echo "check-env-agreement: ${problems} value(s) in ${FILE} are ambiguous." >&2
  echo "" >&2
  echo "This is refused rather than warned about because the damage is silent: the api" >&2
  echo "container and the task containers would hold DIFFERENT values for the same key," >&2
  echo "each looking correct on its own. For SECRET_ENCRYPTION_KEY that means credentials" >&2
  echo "written by one and unreadable by the other, surfacing much later as" >&2
  echo "'encrypted with different key' inside a sync pass." >&2
  exit 1
fi

exit 0
