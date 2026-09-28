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
# On a refusal each returns 1 with RELEASE_TAG_WHY holding the lines to print:
# the sentence first, then what to do. Neither prints anything itself, and
# neither exits: the caller refuses in its own words around these.
#
# Usage:  . "${SCRIPT_DIR}/release-tag.sh"
#         release_tag_on_origin "$REPO_ROOT" "$tag" || refuse "${RELEASE_TAG_WHY[@]}"

RELEASE_SENTENCE='live runs releases: name a release tag'
RELEASE_TAG_WHY=()
RELEASE_TAG_REMOTE_OBJECT=''
RELEASE_TAG_COMMIT=''
RELEASE_TAG_VERSION=''

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

# release_tag_version_at <repo-root> <commit> — the root package.json's
# version at that commit, or nothing. node is there: the bring-up needs it.
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
