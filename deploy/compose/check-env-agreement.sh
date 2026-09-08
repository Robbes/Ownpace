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
#      `$`, no backtick, no backslash, no quote. Almost every value our own
#      tooling writes is this shape (`ensure-env-secrets.sh` generates hex), so
#      the ordinary file passes untouched.
#
# `env-upsert.sh` — the one script that WRITES this file — applies the same two
# rules from the other side: bare when the value is bare-safe, single-quoted
# when it is not. So what it writes, this accepts, and `env-read.sh` reads
# either. One rule, stated in three places, tested against itself.
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
# ## `--fix`, because retyping a secret is its own hazard
#
# The first real deployment this ran against refused five values, and four of
# them were secrets: an admin password, two OAuth client secrets, and a console
# URL carrying a query string. Hand-editing a line that holds a secret in order
# to add two characters is a chance to mistype the secret — and a mistyped
# SECRET_ENCRYPTION_KEY is precisely the failure above, arrived at through the
# remedy instead of the bug.
#
# So `--fix` wraps the bytes that are already on the line. It never retypes a
# value, never prints one, backs the file up first with its mode preserved, and
# reports keys and line numbers only.
#
# It declines the three shapes where quoting would change the meaning rather
# than settle it, and leaves them refused for a human to decide:
#
#   - a value holding a SINGLE QUOTE — there is no form both parsers read
#     identically, so the value itself has to change;
#   - a DOLLAR SIGN — only the operator knows whether `$HOME` was meant to
#     expand or to be literal, and quoting silently picks one;
#   - a BACKSLASH — an escape one parser expands and the other does not, so
#     freezing it also picks a side.
#
# `env-upsert.sh` is deliberately less shy about the dollar: its caller passed
# the value it wants stored, so the bytes ARE the value and there is nothing to
# guess. Here there is only text of unknown provenance, and guessing wrong is
# silent.
#
# ## It never sources the file
#
# Scanning, never executing. A `.env` containing `KEY=$(rm -rf ~)` is precisely
# the kind of file this exists to catch, and `source` would run it while finding
# out. So this reads text and makes no assignments — in `--fix` too, which
# rewrites lines as text and evaluates none of them.
#
# ## It does not print values
#
# Every message names a KEY and a LINE NUMBER and stops there. The file holds
# credentials, this runs inside CI on the managed gate, and a refusal that
# quotes the offending value would put a secret in a log in order to complain
# about it.

set -uo pipefail

usage() {
  echo "usage: check-env-agreement.sh [--fix] <env-file>" >&2
  echo "  --fix   single-quote the values that can be quoted losslessly," >&2
  echo "          after backing the file up. Values are never retyped or printed." >&2
}

FIX=0
FILE=""
for arg in "$@"; do
  case "$arg" in
    --fix) FIX=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "check-env-agreement: unknown option ${arg}" >&2
      usage
      exit 64
      ;;
    *)
      if [ -n "$FILE" ]; then
        echo "check-env-agreement: one file at a time (already had ${FILE})" >&2
        exit 64
      fi
      FILE="$arg"
      ;;
  esac
done

if [ -z "$FILE" ]; then
  usage
  exit 64
fi
if [ ! -f "$FILE" ]; then
  echo "check-env-agreement: $FILE not found" >&2
  exit 64
fi
if [ "$FIX" = 1 ] && { [ ! -w "$FILE" ] || [ ! -w "$(dirname "$FILE")" ]; }; then
  echo "check-env-agreement: --fix needs to write ${FILE} and its directory." >&2
  exit 64
fi

# The characters that mean the same thing to everybody. Deliberately short: a
# value outside it is not necessarily wrong, it is UNDECIDED, and the remedy is
# to say which you meant by quoting it.
BARE_SAFE='^[A-Za-z0-9_@%+=:,./-]*$'

problems=0
fixed=0
lineno=0
tmp=""

if [ "$FIX" = 1 ]; then
  # 077 so the rewritten copy is never briefly world-readable — it holds the
  # same secrets the original does. The real mode is restored before the move.
  umask 077
  tmp="$(mktemp "${FILE}.fix.XXXXXX")" || {
    echo "check-env-agreement: could not create a working copy beside ${FILE}" >&2
    exit 70
  }
fi

# Carry a line through to the rewritten file. A no-op unless --fix is on, so
# the scan and the rewrite are one pass over one parser rather than two that
# could disagree with each other.
emit() {
  if [ "$FIX" = 1 ]; then
    printf '%s\n' "$1" >>"$tmp"
  fi
  return 0
}

# Say WHY a value is undecided. Called only when refusing, so a fixed value
# never gets a lecture about a problem that is no longer there.
explain() {
  case "$1" in
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
    *"'"*)
      # Named specifically, unlike the other characters, because this is the
      # one case where "wrap it in single quotes" is not available and an
      # operator following that advice would get nowhere.
      echo "      It contains a SINGLE QUOTE, which is the one character with no form both" >&2
      echo "      parsers read identically — quoting cannot settle this one." >&2
      ;;
    *)
      # The case Rob's deployment hit on 2026-09-08: three of five refusals
      # matched none of the branches above and so named nothing at all. A
      # refusal an operator cannot act on is a refusal they switch off.
      echo "      It holds a character outside the set both parsers read the same way:" >&2
      echo "      letters, digits and  _ @ % + = : , . / -  . An ampersand or a semicolon" >&2
      echo "      ends the assignment for \`source\` and not for Compose; a tilde may expand" >&2
      echo "      for one of them; the rest are simply undecided." >&2
      echo "      Which character it is is NOT printed: this value may be a secret." >&2
      ;;
  esac
}

# Can this value be single-quoted without changing what it means? Sets
# FIXED_VALUE on success. The three refusals here are the ones where quoting
# would DECIDE something rather than record it — that decision is the
# operator's, not this script's.
FIXED_VALUE=""
plan_fix() {
  local raw="$1"
  local body
  case "$raw" in
    '"'*'"')
      body="${raw#\"}"
      body="${body%\"}"
      ;;
    '"'*) return 1 ;; # opens a double quote and never closes it
    *) body="$raw" ;;
  esac
  case "$body" in
    *"'"*) return 1 ;;  # no form both parsers read identically
    *'$'*) return 1 ;;  # expand or literal? only the operator knows
    *'\'*) return 1 ;;  # an escape one expands and the other does not
    *'"'*) return 1 ;;  # a stray double quote inside — meaning unclear
  esac
  FIXED_VALUE="'${body}'"
  return 0
}

# `|| [ -n "$line" ]` so a final line with no trailing newline is still read.
while IFS= read -r line || [ -n "$line" ]; do
  lineno=$((lineno + 1))
  original="$line"

  # Blank, or a whole-line comment.
  case "$line" in
    '' | [[:space:]]* | '#'*)
      emit "$original"
      continue
      ;;
  esac

  # `export KEY=value` is valid in both, and the export is not the subject.
  prefix=""
  case "$line" in
    'export '*)
      prefix="export "
      line="${line#export }"
      ;;
  esac

  case "$line" in
    [A-Za-z_]*'='*) ;;
    *)
      # Deliberately not echoed. The commonest way to get here is the SECOND
      # line of a value somebody wrapped across two lines — which holds the
      # tail of whatever that value was, secret included.
      echo "  line ${lineno}: not KEY=value and not a comment. Look at that line;" >&2
      echo "      if it is the continuation of a value wrapped across two lines, that" >&2
      echo "      value is already two different things to the two parsers." >&2
      problems=$((problems + 1))
      emit "$original"
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
        emit "$original"
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
      emit "$original"
      continue
      ;;
  esac

  # Not quoted: split off one trailing whitespace-preceded comment, as both do.
  bare="$value"
  comment=""
  case "$bare" in
    *[[:space:]]'#'*)
      comment="${bare#"${bare%%[[:space:]]#*}"}"
      bare="${bare%%[[:space:]]#*}"
      ;;
  esac
  # And the trailing whitespace the comment left behind. Kept, not discarded:
  # --fix puts the line back together and the file should look like itself.
  trailing_ws="${bare##*[![:space:]]}"
  bare="${bare%"$trailing_ws"}"
  comment="${trailing_ws}${comment}"

  if [[ "$bare" =~ $BARE_SAFE ]]; then
    emit "$original"
    continue
  fi

  if [ "$FIX" = 1 ] && plan_fix "$bare"; then
    emit "${prefix}${key}=${FIXED_VALUE}${comment}"
    echo "  ${key} (line ${lineno}): single-quoted. The value itself was not touched." >&2
    fixed=$((fixed + 1))
    continue
  fi

  echo "  ${key} (line ${lineno}): the value is read differently by different parsers." >&2
  explain "$bare"
  if [ "$FIX" = 1 ]; then
    echo "      NOT fixed automatically: quoting this would decide what it means, and" >&2
    echo "      that decision is yours. Edit this one by hand." >&2
  fi
  case "$bare" in
    *"'"*)
      echo "      Fix: the VALUE has to change — regenerate the secret, or take the quote" >&2
      echo "      out of it. Every other shape here can be quoted; this one cannot." >&2
      ;;
    *)
      echo "      Fix: wrap it in SINGLE quotes — ${key}='...' — which both read literally." >&2
      ;;
  esac
  problems=$((problems + 1))
  emit "$original"
done <"$FILE"

if [ "$FIX" = 1 ]; then
  if [ "$fixed" -gt 0 ]; then
    backup="${FILE}.bak-$(date -u +%Y%m%dT%H%M%SZ)"
    if ! cp -p "$FILE" "$backup"; then
      rm -f "$tmp"
      echo "check-env-agreement: could not write ${backup}; NOTHING was changed." >&2
      exit 70
    fi
    chmod --reference="$FILE" "$tmp" 2>/dev/null || chmod 600 "$tmp"
    if ! mv "$tmp" "$FILE"; then
      echo "check-env-agreement: could not replace ${FILE}; it is unchanged and the" >&2
      echo "backup at ${backup} is identical to it." >&2
      exit 70
    fi
    echo "" >&2
    echo "check-env-agreement: single-quoted ${fixed} value(s) in ${FILE}." >&2
    echo "The file as it was is at ${backup} — same mode, same bytes." >&2
    echo "Nothing was retyped: each value is the bytes that were already there," >&2
    echo "with a quote either side." >&2
  else
    rm -f "$tmp"
  fi
fi

if [ "$problems" -gt 0 ]; then
  echo "" >&2
  echo "check-env-agreement: ${problems} value(s) in ${FILE} are ambiguous." >&2
  echo "" >&2
  echo "This is refused rather than warned about because the damage is silent: the api" >&2
  echo "container and the task containers would hold DIFFERENT values for the same key," >&2
  echo "each looking correct on its own. For SECRET_ENCRYPTION_KEY that means credentials" >&2
  echo "written by one and unreadable by the other, surfacing much later as" >&2
  echo "'encrypted with different key' inside a sync pass." >&2
  if [ "$FIX" != 1 ]; then
    echo "" >&2
    echo "Most of these can be quoted for you, without retyping or printing the value:" >&2
    echo "    ${0} --fix ${FILE}" >&2
  fi
  exit 1
fi

exit 0
