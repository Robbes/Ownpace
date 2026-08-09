# Workplan 0036 — As-of and aftermath (status honesty polish)

## Status — 2026-08-09 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Every number says as-of when | ✅ Done 2026-08-09 | `AsOf` component (relativeToNow, minute tick, manual refresh) on the three queue screens (shared scaffold) AND Decisions (`dataUpdatedAt`, with the 5-minute-default staleness noted in code); Verify keeps `finishedAt` and renders "Checked {time}"; LiveProgress renders `lastSyncedAt` per domain — pinned on BOTH adapters (hard rule 5). |
| T2 Aftermath parity across the queues | ✅ Done 2026-08-09 | Decisions INCLUDED via contract extension: shared `DECISION_EFFECTS` served by both editions' resolve/dismiss, rendered verbatim under the answered row. Failures states why accepted items leave (EN+NL). Per-screen pins: Moves got its first test file; Deletions/Decisions pins stand. |
| T3 Runs discoverability + bounds honesty | ✅ Done 2026-08-09 | `listRunsWithEvents` over-fetches by one → `{runs, truncated}` + per-run `eventsTruncated` (exact totals, not inference); both editions serve it; labels render only when the server says so (21-vs-exactly-20 integration walk). Failures→hub "see the pass that failed" link. |
| T4 What retry actually costs | ✅ Done 2026-08-09 | Bilingual sentence above the waiting list + on the button title; dictionary comment points at domain-sync.ts's cursor comment (~1158); pinned present-with-items / absent-without. |

> **2026-08-09, second pass:** an adversarial fleet re-verified this plan.
> Two substantive corrections: T2's headline directive ordered work that
> already shipped (Moves has had its "Already decided" section since #274),
> and T3's acceptance was unimplementable without a truncation signal the
> contract lacks — both rewritten below. T1 gains Decisions.tsx (the stalest
> decision surface was the one screen left out) and loses a hedge (the Verify
> timestamps already exist server-side; the client discards them).

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
- Aftermath differs by queue: Deletions, Decisions AND Moves have both
  "Waiting on you" and "Already decided" sections (the first draft claimed
  Moves lacked one — wrong; `Moves.tsx:104-112` has rendered
  `queue.acknowledged` since #274). Failures alone has only the waiting half
  (plus "still trying", which is right for it) — because accepted items
  genuinely leave the ledger's failed set (`resolveFailure` sets
  `left_behind`; `listFailures` filters `status='failed'`). True, but never
  stated on screen.
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

One small `AsOf` component (bilingual, `useFormatters().relativeToNow`,
updating each minute): rendered by the three queue screens AND `Decisions.tsx`
(react-query's `dataUpdatedAt` is the honest source — Decisions has no
per-query `staleTime`, inherits the app's 5-minute default, and is therefore
the STALEST decision surface in the product; the first draft left it out)
alongside a manual refresh affordance; by Verify at the top of each report;
and LiveProgress gains `lastSyncedAt` per domain where present. Discovery's
snapshot date already renders (#355) — this task makes that the norm, not
the exception.

**Verify needs no server work** (the first draft hedged "add it to the
payload if absent" — it is present, twice): `VerificationRunReport`'s done
state carries `startedAt`/`finishedAt` in both editions, and each per-mapping
`VerificationResult` carries its own `timestamp`. The client is the sole gap:
`Verify.tsx`'s poll handler does `setState({kind:'done', report: r.report})`,
discarding `finishedAt` on the floor. Keep it in component state and render
it at the top of each report.

**Sequencing (LiveProgress):** 0033 T5 extracts this component to a shared
file — extract first, then this task adds `lastSyncedAt` once; and the
managed data adapter MUST map `domainStatus.completedAt → lastSyncedAt`
(selfhost's `/status` route is what does that rename) so the as-of renders on
both editions — test both adapters, or the strip silently becomes a
selfhost-only feature, the invisible edition split hard rule 5 forbids.

**Acceptance:** each listed screen (including Decisions) shows an as-of;
tests pin queue as-of rendering from `dataUpdatedAt` and Verify's rendered
`finishedAt`; both LiveProgress adapters produce the as-of; nothing shows an
as-of it cannot substantiate.

### T2 — aftermath parity across the queues

(Rewritten — the first draft ordered Moves work that shipped in #274.)
For Failures, where accepted items genuinely leave the ledger's queue, say so
in the empty-ish state ("accepted items no longer appear here") instead of
leaving the asymmetry unexplained. Pin every existing "Already decided"
section (Deletions, Decisions, Moves) with a per-screen test — one screen
regressing to a silent success would be invisible.

On effect prose, the fleet found the first draft's premise false for one
screen: **the Decisions resolve/dismiss contract carries NO `effect`
sentence** — both editions return the bare closed `DecisionRow`, and
`Decisions.tsx`'s `act()` discards the response entirely. (The item queues'
`DecisionAccepted.effect` is real and rendered; Decisions is the odd one
out — nothing anywhere says what Dismiss actually did.) So: either add
effect prose to the decision resolve/dismiss responses server-side (shared
wording, both editions — e.g. dismiss: "Closed without acting; the detector
may raise it again if the situation persists") and render it via the same
outcome pattern the item queues use, or explicitly exclude Decisions from
this task's acceptance and open the contract change separately. Do not mark
this task done with the gap unstated.

**Acceptance:** each queue either shows decided items or states why not;
per-screen tests assert the effect text of a completed action renders — with
Decisions either included (contract extended) or excluded by a recorded
sentence.

### T3 — runs discoverability + bounds honesty

RunsPanel states its bounds when it hits them ("latest 20 passes" / "latest 25
entries" lines, only when truncated). **Missing scope the fleet caught: the
client cannot know it was truncated.** The 20/25 caps are applied server-side
(`listRunsWithEvents` defaults `limit = 20, eventsPerRun = 25`) and
`RunsResponse` is just `{runs}` — with exactly 20 runs returned the client
cannot distinguish "all 20" from "20 of 21". Extend `listRunsWithEvents` (one
shared reader, so one change, both editions' routes serve its result) to
report truncation — a `truncated`/`totalRuns` field on `RunsResponse` and a
per-run events-truncated marker (or fetch limit+1 and drop one) — THEN the
client label. (The fallback of labelling whenever `length === cap` is
consciously rejected: a technically-true "latest 20 passes" line on an
exactly-20 history is the species of almost-honest this plan exists to end.)

Failures links each mapping section to its hub's Run history ("see the pass
that failed") — the runs panel exists because failure diagnosis needed it;
the failure screen should know that.

**Acceptance:** truncation labels appear exactly when caps are hit (test with
21 runs and with exactly 20 — label present in the first, absent in the
second); the Failures→runs link navigates to `/mappings/:id` (works on both
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
