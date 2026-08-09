# Workplan 0036 — As-of and aftermath (status honesty polish)

## Status — 2026-08-09 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Every number says as-of when | ⬜ Planned | — |
| T2 Aftermath parity across the queues | ⬜ Planned | — |
| T3 Runs discoverability + bounds honesty | ⬜ Planned | — |
| T4 What retry actually costs | ⬜ Planned | — |

## Why this exists

The Windows weekend's most expensive confusions were all one species: **a
number on screen with no statement of what it counted or when** — the
discovery snapshot read against the live ledger (510 vs 1149), a stale
`lastError` beside a success, `pass complete (0 created)` over a failed
domain. The worst offenders were fixed at their sites (#348, #355). The
2026-08-09 review audited every remaining number on every screen for the same
species and found the pattern, not yet the discipline:

- The queue screens fetch with `staleTime: 30_000` and refetch on focus — a
  good policy that is invisible: nothing says when the list was read, so an
  operator deciding about deletions cannot tell a fresh list from a
  half-minute-old one, and nothing invites a manual re-read.
- The Confirm page's LiveProgress strip (new in #355) shows synced/failed per
  domain but not `lastSyncedAt`, which the payload carries.
- Verify renders a report with no timestamp — a report generated before a
  further pass reads as current.
- Aftermath differs by queue: Deletions and Decisions have both
  "Waiting on you" and "Already decided" sections; Moves and Failures have
  only the waiting half (Failures adds "retrying", which is right for it), so
  what "keep" did remains visible on one screen and vanishes on another —
  partly data-model-driven, never stated.
- RunsPanel silently truncates at 20 runs / 25 events per run — correct
  bounds, invisible ("silent truncation reads as covered everything").
- Failures' `retry` clears the mapping's cursors (a full re-list on the next
  pass — deliberate, documented in `domain-sync.ts`); the button says "Try
  again" with no hint that the next pass will be a long one.

## Guardrails

- **Hard rule 9 cuts both ways:** an as-of label must state what IS known —
  never soften an error, never imply freshness that polling does not provide.
- Server prose stays verbatim; everything added here is client framing,
  bilingual from birth.
- No polling added beyond what exists — this plan labels reality; changing
  fetch cadence is out of scope.

## Tasks

### T1 — every number says as-of when

One small `AsOf` component (bilingual, `formatRelativeToNow`, updating each
minute): rendered by the three queue screens (react-query's `dataUpdatedAt`
is the honest source) alongside a manual refresh affordance; by Verify at the
top of each report (the report's own generation time — add it to the payload
if absent, server-side, both editions' routes); and LiveProgress gains
`lastSyncedAt` per domain where present. Discovery's snapshot date already
renders (#355) — this task makes that the norm, not the exception.

**Acceptance:** each listed screen shows an as-of; tests pin queue as-of
rendering from `dataUpdatedAt` and Verify's report timestamp; nothing shows
an as-of it cannot substantiate.

### T2 — aftermath parity across the queues

Bring Moves to the Deletions/Decisions shape ("Already decided" from whatever
the server retains — `acknowledged` rows exist for it); for Failures, where
accepted items genuinely leave the ledger's queue, say so in the empty-ish
state ("accepted items no longer appear here") instead of leaving asymmetry
unexplained. Verify every action's `effect` prose renders on every queue (the
`act` bookkeeping does this — pin it per screen with a test, since one screen
regressing to a silent success would be invisible).

**Acceptance:** each queue either shows decided items or states why not;
per-screen tests assert the effect text of a completed action renders.

### T3 — runs discoverability + bounds honesty

RunsPanel states its bounds when it hits them ("latest 20 passes" / "latest 25
entries" lines, only when truncated). Failures links each mapping section to
its hub's Run history ("see the pass that failed") — the runs panel exists
because failure diagnosis needed it; the failure screen should know that.

**Acceptance:** truncation labels appear exactly when caps are hit (test with
21 runs); the Failures→runs link navigates to `/mappings/:id` (works on both
editions once 0034 T1 lands; sequence after it).

### T4 — what retry actually costs

The Failures retry affordance carries one honest sentence (title/help,
bilingual): retrying re-lists the whole mapping on its next pass — that is
what makes the retry reachable — so the next pass takes longer; nothing is
re-copied (the ledger skips what landed). Wording sourced from
`domain-sync.ts`'s own cursor comment so UI and engine cannot disagree.

**Acceptance:** the sentence renders at the retry control; a test pins it;
the engine comment is referenced in the string's dictionary comment.

## Owner decisions queued by this plan

None.
