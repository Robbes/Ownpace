# 0097 — A pull request that runs nothing

## Status — 2026-08-23 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Find every trigger that can silence a check | ✅ **Done 2026-08-23** | Three of the four PR-triggered workflows carried `pull_request: branches: [main]` — `ci.yml`, `no-committed-artifacts.yml`, `security-scan.yml`. Between them that is every required status check on `main`. `images.yml` was already unfiltered on that axis. |
| T2 Remove the filter, and say why in the file | ✅ **Done 2026-08-23** | The filter is gone from all three, with the reasoning in `ci.yml`'s trigger block and a pointer to it in the other two. `push: branches: [main]` is untouched — a different question, and the thing that keeps other branches off the self-hosted runner. |
| T3 Make it unable to come back | ✅ **Done 2026-08-23** | `every-pr-gets-checked.unit.test.ts` — 4 cases. Refuses `branches:` and `branches-ignore:` on any `pull_request` trigger, asserts `push` keeps its filter, and carries a vacuity guard. Proved by reintroducing the filter: the case fails and names `security-scan.yml`. |

## What this fixes

A pull request opened against any branch other than `main` produced **no checks
at all.** Not failing checks — none.

That sounds harmless and is not. On 2026-08-23, #501 was opened against another
feature branch so its diff would show only its own commits. It reported zero
checks. Left that way, the branch underneath merges, GitHub retargets the pull
request to `main`, and **a retarget fires `pull_request.edited` — which is not in
the default activity set.** So still nothing runs.

The end state is a pull request to `main` carrying four required contexts that
can never be reported: *"Expected — waiting for status to be reported"*, nothing
queued in Actions to point at, and re-running fixes nothing. Only a fresh push
escapes it.

**It wedges rather than merging unverified**, and that distinction matters
because it changes who notices. An unverified merge is invisible until something
breaks; a wedged pull request is loudly stuck with no explanation, and the
tempting fix — "just merge it, CI is obviously fine" — is available to anybody
with the button.

## This is a failure the repo had already written down

`docs/testing.md` and `every-pr-check-is-classified.unit.test.ts` both describe
exactly this trap, for `images.yml`'s `paths:` filter:

> A required context that is never reported leaves the pull request at "Expected
> — waiting for status to be reported" with nothing queued in Actions to explain
> it, and no amount of re-running fixes it.

The hazard was understood. It was understood on one axis. The same shape sat on
`branches:` with nothing watching it, which is why T3 is the task that matters:
knowing about a failure mode is not a control.

## Why `paths:` stays allowed and `branches:` does not

They are not the same bet.

`paths:` says *"this check is about these files"*. A workflow it skips is one
whose subject the pull request did not touch, so the honest response is to leave
that check out of branch protection — which is what `NOT_REQUIRABLE` does for
`build`. The cost is recorded and paid.

`branches:` says *"this check is about these TARGETS"* — a claim about where a
change is going rather than what it is. No classification rescues that: the
check is required, it is legitimate, and it is unreportable. So it is refused
outright rather than documented.

## The security property is unchanged

Removing the filter does not widen what runs on the self-hosted Spark, which
holds the live managed stack, its `.env` and the encrypted connection
credentials.

Every `runs-on` in `ci.yml` keys on `github.event_name == 'push'`, never on the
branch:

```yaml
runs-on: ${{ github.event_name == 'push' && 'self-hosted' || 'ubuntu-24.04' }}
```

So a pull request from anywhere — including a fork, and this repository is
public — still runs on a GitHub-hosted runner. `push` keeps `branches: [main]`,
which is what makes that true, and is why T2 changed only the `pull_request`
half.

## What this does not do

Branch protection lives in GitHub's settings, not the repo, so neither the new
guard nor its sibling can read which contexts are actually required. This
asserts that every PR-triggered workflow is *reachable* from any base; whether
the resulting checks are *gated* is `every-pr-check-is-classified`'s question,
and whether the gating was applied is still a human reading `docs/testing.md`.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-23).
