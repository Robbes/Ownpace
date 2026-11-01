#!/usr/bin/env bash
# release-tag.sh — what makes a tag a release live may run (workplan 0146 T5,
# 0132 T6 (a) and T1b). A library: sourced, never run.
#
# LIVE RUNS RELEASES, AND TWO SCRIPTS HAVE TO AGREE ON WHAT ONE IS.
# deploy-live.sh moves live to a tag; stand-up-live.sh stands live up for the
# first time from the tag its checkout is parked on. A tag one of them takes
# and the other refuses would be a release on one day and not on the next, so
# the rule is written once, here:
#
#   a name git accepts as a tag           git check-ref-format refs/tags/<tag>
#   on origin                             git ls-remote --tags origin: a tag only
#                                         this clone has is nobody's release
#   here, and the same object as origin's a tag moved here is not origin's
#   annotated                             git tag -a (docs/release.md §2); a
#                                         lightweight tag is refused
#   named v…                              the release's name
#   the version its commit's root         a release's tag is its package.json
#   package.json says, with a v in front  version with a v (docs/release.md §1)
#
# Each refusal about the tag carries 0146's sentence, "live runs releases:
# name a release tag", and every refusal is deploy-live.sh's own, word for
# word and line for line, so that script can source this one without its
# messages changing (a follow-up does; until then
# scripts/one-rule-for-a-release-tag.unit.test.ts drives both on the same tags
# and fails when any line of a refusal differs).
#
# TWO HALVES, because deploy-live.sh fetches between them. The first asks
# origin; the caller may then run `git fetch --tags origin`, which adds tags
# and moves none; the second asks this clone. stand-up-live.sh fetches
# nothing: its HEAD is already at the tag.
#
#   release_tag_on_origin <repo-root> <tag>
#       true when <tag> is a tag name origin has. Sets RELEASE_TAG_REMOTE_OBJECT,
#       origin's object for it.
#   release_tag_is_release <repo-root> <tag> <origin's object>
#       true when this clone's <tag> is that object, annotated, named v…, and
#       its commit's package.json says the version. Sets RELEASE_TAG_COMMIT and
#       RELEASE_TAG_VERSION.
#
# AND WHAT IT MUST CARRY. A release live runs must hold the scripts live is
# deployed, checked and kept by after it: deploy-live.sh, exposure-check.sh,
# box-duties.sh (the daily duties, the copy's backstop among them),
# stack-kind.sh and copy-before-update.sh (workplan 0132 T3, T6, T7; 0139). A
# tag cut before one of them would leave live without its daily duties or the
# backstop of the copy just taken, and the next deploy without a copy. Both
# scripts refuse such a tag, in the same words: stand-up-live.sh before live's
# first bring-up, deploy-live.sh before a deploy moves anything.
#
#   release_tag_carries <repo-root> <tag> <commit>
#       true when <commit> has every file in RELEASE_TAG_MUST_CARRY under
#       deploy/compose/.
#
# AND THE NODE THAT INSTALLS IT (workplan 0119, the move to Node 26 in
# alpha.4). deploy-live.sh runs `pnpm install --frozen-lockfile`, the task
# deploy and the site build on this host, and stand-up-live.sh's bring-up runs
# the install and the task deploy (deploy-tasks.sh): all on the node first on
# the PATH of the shell the script runs in. pnpm only warns when that node is
# below the release's `engines` (`WARN Unsupported engine`; the repository
# sets no engineStrict, the owner's to decide) and installs all the same, and
# the deploy goes straight on from the install to the rebuild, so nothing else
# stops a shell whose node is too old. Both scripts refuse it, in the same
# words, before anything moves: deploy-live.sh after its fetch, so that it
# reads the TAG's package.json, not the checkout's, and before it reads the
# version with node; stand-up-live.sh before it reads the version too.
#
#   release_tag_node <repo-root> <tag> <commit>
#       true when <commit>'s root package.json asks for no node (no
#       engines.node; a commit without a package.json is refused by the
#       version check instead), or asks for ">=N" or ">=N.N.N" and the node
#       first on PATH (`command -v node`, `node -v`) is that version or later.
#       Refuses an engines.node in any other form, which it cannot read and
#       does not guess at; an engines it cannot read whole (more than one
#       "engines" key in the file, an object inside engines, or node named
#       twice); no node on PATH; a `node -v` that fails (a Node 25
#       or later binary without libatomic1 does) or says no version; and a
#       node below what the tag asks for, naming the node's path and version
#       and the tag's engines. It reads package.json without node, which may
#       be what is wrong: a plain read of the engines block. Sets
#       RELEASE_TAG_NODE to the line to say when it passes.
#
# On a refusal each returns 1 with RELEASE_TAG_WHY holding the lines to print:
# the sentence first, then what to do. Neither prints anything itself, and
# neither exits: the caller refuses in its own words around these.
#
# Usage:  . "${SCRIPT_DIR}/release-tag.sh"
#         release_tag_on_origin "$REPO_ROOT" "$tag" || refuse "${RELEASE_TAG_WHY[@]}"

RELEASE_SENTENCE='live runs releases: name a release tag'
# What a release tag must carry for live to be deployed, checked and kept
# after it, under deploy/compose/ (above).
RELEASE_TAG_MUST_CARRY=(deploy-live.sh exposure-check.sh box-duties.sh stack-kind.sh copy-before-update.sh)
RELEASE_TAG_WHY=()
RELEASE_TAG_REMOTE_OBJECT=''
RELEASE_TAG_COMMIT=''
RELEASE_TAG_VERSION=''
RELEASE_TAG_NODE=''

# release_tag_on_origin <repo-root> <tag>
release_tag_on_origin() {
  local root="$1" tag="$2" remote_tags
  RELEASE_TAG_WHY=()
  RELEASE_TAG_REMOTE_OBJECT=''
  if ! git check-ref-format "refs/tags/${tag}" 2>/dev/null; then
    RELEASE_TAG_WHY=("'${tag}' is not a tag name. ${RELEASE_SENTENCE}.")
    return 1
  fi
  if ! remote_tags="$(git -C "$root" ls-remote --tags origin)"; then
    RELEASE_TAG_WHY=("git ls-remote --tags origin failed, so the tag cannot be checked against origin.")
    return 1
  fi
  RELEASE_TAG_REMOTE_OBJECT="$(awk -v ref="refs/tags/${tag}" '$2 == ref { print $1 }' <<<"$remote_tags")"
  [ -z "$RELEASE_TAG_REMOTE_OBJECT" ] || return 0
  if git -C "$root" rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
    RELEASE_TAG_WHY=("the tag '${tag}' is not on origin. ${RELEASE_SENTENCE}."
      "A release is cut on origin (docs/release.md, §2). A tag that exists only in this clone is nobody's release.")
  elif git -C "$root" rev-parse -q --verify "${tag}^{commit}" >/dev/null; then
    RELEASE_TAG_WHY=("'${tag}' is not a tag: it names a branch or a commit. ${RELEASE_SENTENCE}.")
  else
    RELEASE_TAG_WHY=("there is no tag '${tag}' here or on origin. ${RELEASE_SENTENCE}.")
  fi
  return 1
}

# release_tag_is_release <repo-root> <tag> <origin's object>
release_tag_is_release() {
  local root="$1" tag="$2" remote_object="$3" local_object commit version
  RELEASE_TAG_WHY=()
  RELEASE_TAG_COMMIT=''
  RELEASE_TAG_VERSION=''
  # deploy-live.sh's words, word for word: it asks this after its fetch, which
  # is when a tag origin has can still be missing here. stand-up-live.sh never
  # reaches it: the tag it asks about is one this clone lists at HEAD.
  if ! local_object="$(git -C "$root" rev-parse -q --verify "refs/tags/${tag}")"; then
    RELEASE_TAG_WHY=("the tag '${tag}' is on origin but not here after the fetch.")
    return 1
  fi
  if [ "$local_object" != "$remote_object" ]; then
    RELEASE_TAG_WHY=("the tag '${tag}' here is not origin's: here ${local_object}, on origin ${remote_object}. ${RELEASE_SENTENCE}."
      "Delete the one here (git tag -d ${tag}) and run this again, which fetches origin's.")
    return 1
  fi
  if [ "$(git -C "$root" cat-file -t "refs/tags/${tag}")" != tag ]; then
    RELEASE_TAG_WHY=("'${tag}' is a lightweight tag. A release tag is annotated (git tag -a, docs/release.md §2). ${RELEASE_SENTENCE}.")
    return 1
  fi
  case "$tag" in
    v*) ;;
    *)
      RELEASE_TAG_WHY=("the tag '${tag}' does not start with v. ${RELEASE_SENTENCE}.")
      return 1
      ;;
  esac
  commit="$(git -C "$root" rev-parse "refs/tags/${tag}^{commit}")"
  version="$(release_tag_version_at "$root" "$commit")" || version=''
  if [ "$version" != "${tag#v}" ]; then
    RELEASE_TAG_WHY=("the root package.json at ${tag} says version '${version:-none}', and the tag says '${tag#v}'. ${RELEASE_SENTENCE}."
      "A release's tag is its package.json version with a v in front (docs/release.md §1).")
    return 1
  fi
  RELEASE_TAG_COMMIT="$commit"
  RELEASE_TAG_VERSION="$version"
}

# release_tag_carries <repo-root> <tag> <commit>
release_tag_carries() {
  local root="$1" tag="$2" commit="$3" f
  local -a missing=()
  RELEASE_TAG_WHY=()
  for f in "${RELEASE_TAG_MUST_CARRY[@]}"; do
    git -C "$root" cat-file -e "${commit}:deploy/compose/${f}" 2>/dev/null || missing+=("deploy/compose/${f}")
  done
  [ "${#missing[@]}" -gt 0 ] || return 0
  RELEASE_TAG_WHY=("${tag} does not carry ${missing[*]}. Live is deployed, checked and kept by them after this (workplan 0132 T3, T6, T7; 0139)."
    "Cut the release from a commit of main that has them (docs/release.md §2).")
  return 1
}

# release_tag_node <repo-root> <tag> <commit>
release_tag_node() {
  local root="$1" tag="$2" commit="$3" text block='' unread want node_path said rc=0 major
  local re_engines='"engines"[[:space:]]*:'
  local re_block='"engines"[[:space:]]*:[[:space:]]*\{([^}]*)\}'
  local re_key='"node"[[:space:]]*:'
  local re_value='"node"[[:space:]]*:[[:space:]]*"([^"]*)"'
  local re_want='^>=[[:space:]]*([0-9]+)(\.([0-9]+)\.([0-9]+))?$'
  local re_have='^v([0-9]+)\.([0-9]+)\.([0-9]+)'
  local -a need=() have=() tail=()
  RELEASE_TAG_WHY=()
  RELEASE_TAG_NODE=''
  # No package.json at the commit: no engines to read here, and the version
  # check that follows refuses the tag ("says version 'none'").
  if ! text="$(git -C "$root" show "${commit}:package.json" 2>/dev/null)"; then
    RELEASE_TAG_NODE="Node: ${tag} has no root package.json to ask for one (the version check says more)"
    return 0
  fi
  if ! [[ "$text" =~ $re_engines ]]; then
    RELEASE_TAG_NODE="Node: ${tag} asks for none (no engines in its package.json), so the node on this shell's PATH is not checked"
    return 0
  fi
  # The read below takes the first "engines" key and stops at the first }, so
  # it holds only for one engines, of plain strings, naming node once. Any
  # other shape (an engines nested under another key, an object inside
  # engines, node given twice, where JSON keeps the last) could be read as
  # asking for no node or the wrong one, so it is refused as unread instead.
  unread=''
  if [[ "${text#*"${BASH_REMATCH[0]}"}" =~ $re_engines ]]; then
    unread='more than one "engines" key, and a read without node cannot tell which is the root one'
  elif ! [[ "$text" =~ $re_block ]] || [[ "${BASH_REMATCH[1]}" == *'{'* ]]; then
    unread='not an object of plain strings'
  else
    block="${BASH_REMATCH[1]}"
    if [[ "$block" =~ $re_key ]] && [[ "${block#*"${BASH_REMATCH[0]}"}" =~ $re_key ]]; then
      unread='engines.node more than once'
    fi
  fi
  if [ -n "$unread" ]; then
    RELEASE_TAG_WHY=("${tag}'s package.json has an engines this script cannot read (${unread}), so it cannot say which Node the release asks for, and it does not guess."
      "Keep one engines in the root package.json on main, of plain strings, with engines.node written once as \">=N\" (scripts/a-gate-on-a-version-nothing-ships.unit.test.ts holds it so), and cut a new release (docs/release.md §2).")
    return 1
  fi
  if ! [[ "$block" =~ $re_key ]]; then
    RELEASE_TAG_NODE="Node: ${tag} asks for none (no engines.node in its package.json), so the node on this shell's PATH is not checked"
    return 0
  fi
  want=''
  [[ "$block" =~ $re_value ]] && want="${BASH_REMATCH[1]}"
  want="${want#"${want%%[![:space:]]*}"}"
  want="${want%"${want##*[![:space:]]}"}"
  if ! [[ "$want" =~ $re_want ]]; then
    RELEASE_TAG_WHY=("${tag}'s package.json asks for Node '${want:-not a string}' (engines.node), a form this script cannot read: it reads \">=N\" and \">=N.N.N\", and does not guess at the rest."
      "Write engines.node as \">=N\" in the root package.json on main (scripts/a-gate-on-a-version-nothing-ships.unit.test.ts holds it so) and cut a new release (docs/release.md §2).")
    return 1
  fi
  need=("$((10#${BASH_REMATCH[1]}))" "$((10#${BASH_REMATCH[3]:-0}))" "$((10#${BASH_REMATCH[4]:-0}))")
  major="${need[0]}"
  # The same three lines after each refusal about the node itself, in both
  # scripts' words (docs/managed-bring-up.md has the section they name).
  tail=("pnpm install, the task deploy and, on a deploy, the site build run on this host, on the node first on this shell's PATH. pnpm only warns when that node is below engines (WARN Unsupported engine) and installs all the same, so nothing else would stop it."
    "Put a Node ${major} first on the PATH of the shell you run this from, and read it there: command -v node; node -v (docs/managed-bring-up.md, The Node in the shell you deploy from). A system Node another service on the host uses can stay as it is."
    "Run this as yourself, not under sudo: sudo sets PATH to its secure_path, the system's own directories, so the node it finds is the system's, not the one in your shell.")
  if ! node_path="$(command -v node)"; then
    RELEASE_TAG_WHY=("there is no node on this shell's PATH, and ${tag} asks for Node ${want} (engines in its package.json)." "${tail[@]}")
    return 1
  fi
  said="$(node -v 2>&1)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    RELEASE_TAG_WHY=("node -v failed (exit ${rc}) for ${node_path}, the node first on this shell's PATH, so its version cannot be read, and ${tag} asks for Node ${want} (engines in its package.json). It said: ${said%%$'\n'*}"
      "A Node 25 or later binary stops this way on a host without libatomic1 (error while loading shared libraries: libatomic.so.1): sudo apt-get install libatomic1, then run this again." "${tail[@]}")
    return 1
  fi
  said="${said%%$'\n'*}"
  if ! [[ "$said" =~ $re_have ]]; then
    RELEASE_TAG_WHY=("node -v for ${node_path}, the node first on this shell's PATH, said '${said}', not a version this script can read (vN.N.N), and ${tag} asks for Node ${want} (engines in its package.json)." "${tail[@]}")
    return 1
  fi
  have=("$((10#${BASH_REMATCH[1]}))" "$((10#${BASH_REMATCH[2]}))" "$((10#${BASH_REMATCH[3]}))")
  if [ "${have[0]}" -lt "${need[0]}" ] ||
    { [ "${have[0]}" -eq "${need[0]}" ] && { [ "${have[1]}" -lt "${need[1]}" ] ||
      { [ "${have[1]}" -eq "${need[1]}" ] && [ "${have[2]}" -lt "${need[2]}" ]; }; }; }; then
    RELEASE_TAG_WHY=("the node first on this shell's PATH is ${said} (${node_path}), and ${tag} asks for Node ${want} (engines in its package.json)." "${tail[@]}")
    return 1
  fi
  RELEASE_TAG_NODE="Node: ${node_path} is ${said}, and ${tag} asks for ${want} (engines in its package.json)"
}

# release_tag_version_at <repo-root> <commit> — the root package.json's
# version at that commit, or nothing. node is there: the bring-up needs it,
# and both scripts ask release_tag_node about it before they read this.
release_tag_version_at() {
  git -C "$1" show "${2}:package.json" 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const v = JSON.parse(s).version;
        if (typeof v === "string") process.stdout.write(v);
      } catch {}
    });'
}
