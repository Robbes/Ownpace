# Workplan 0019 — finishing the managed operating surface

## Status — 2026-08-01 (update this block at the end of every session) — ALL TASKS CLOSED

| Task | Status | Evidence |
|---|---|---|
| T1 The apply client speaks the managed shape | ✅ **Done — merged (PR #223, CI green)** | `applyDeletion` returns a typed `ApplyOutcome` — `{mode:'immediate', result: DecisionAccepted}` on the appliance, `{mode:'queued', receipt: ApplyReceipt}` on managed — the ONE success-shape split ADR-0026 permits, branched via the `edition.ts` pattern and typed entirely from `@openmig/shared`. Refusals stay identical in both editions (403/404 → `DecisionRefusedError`, the gates' words preserved). New `fetchApplyReceipt` reads the receipt (a status read — safe to poll, starts nothing). |
| T2 The Deletions screen polls the receipt | ✅ **Done — merged (PR #223, CI green)** | One screen, two temporal shapes: the appliance's synchronous answer renders as before; on managed the screen polls the receipt to a terminal state with the Verify discipline (stop on EVERY terminal state; a missed poll keeps polling — a transient read failure must not strand the outcome as forever-queued; timers cleared on unmount). Each terminal state keeps its character (`ReceiptStatus` primitive): `applied` reports how final the removal was per `kind` (binned/deleted/unrecorded — reported, never inferred), `refused` renders the gates' code + prose verbatim (amber, not an error), `failed` is a red FAILURE with its reason (new `JobFailed` primitive — hard rule 9, never softened into a refusal). 4 new jsdom tests (queued→applied incl. kind text, refused verbatim + code, failed with reason, missed-poll-keeps-polling); 13/13 in the suite, 1195/1195 workspace unit tests. |
| T3 `allow_apply_deletions` gets an API and a switch | ✅ **Done — merged (PR #224, CI green incl. the 4 integration tests)** | Shared `ApplyDeletionsFlag` contract (`{allowApplyDeletions, source: 'mapping'\|'config'}`) + `APPLY_FLAG_WARNING` prose so the sentence before the switch cannot drift between editions. Managed: `GET .../apply-deletions` (any member — "the button will be refused" should be learned before clicking, not from a 403) and `PATCH` (OWNER only via `requireRole` — the role is a tenant_member row fact since 0020 T1), strict boolean body (a truthy string must not arm the destructive path). Appliance: `GET` reports the config-file value with `source:'config'`; `PATCH` answers an honest **405 naming the file**, not a 404. Web: `ApplyDeletionsPanel` on the Deletions screen — current value always visible, warning IN FRONT of a two-step enable (same arm/confirm ceremony as the delete button it enables), one-click disable, read-only on the appliance, refusals in the server's words. Tests in all three layers: route-pin list extended, 4 API integration tests (owner flips, viewer 403 with role-from-row proven, strict body 400, unknown 404), 4 appliance HTTP tests on the real-PGlite harness (absent-flag reads OFF; 405 names the file), 5 panel jsdom tests. 1204/1204 unit. |
| T4 Per-mapping navigation exists | ✅ **Done — merged (PR #225, CI green)** | `MappingDetail` is now a real hub: the five operating screens for THIS mapping (deletions/moves/failures/check/finish), in the cutover order, each with a one-line blurb. The links are the deliverable and survive the (managed-only, best-effort) detail read failing — navigation never dead-ends. Managed operators reach it Mappings → mapping → everything; no more typed URLs. 3 jsdom tests pin the five destinations + the degraded path. |
| T5 The managed Finish screen | ✅ **Done — merged (PR #225, CI green)** | `Finish` gains a per-mapping mode (`mappings/:mappingId/finish`, either edition): the lifecycle and failure count come from the QUEUE ENVELOPES themselves (never `/status`, which managed does not serve), links stay inside the mapping, unknown-mapping renders an honest "not the same as nothing to finish". The final-pass step speaks each edition's temporal shape via `requestFinalPass`: the appliance runs the pass and answers when it FINISHES; managed queues the delta-sync job and the screen says "Queued — lands in the run history" instead of blurring the two into one "done". A failed pass request says so (rule 9). 4 new jsdom tests (envelope-driven render + no `/status` call, in-mapping links, unknown-mapping honesty, queued reporting). |
| T6 Retire the appliance's synchronous `GET /verify` | ✅ **Done — merged (PR #226, CI green — all 9 checks incl. unit + integration)** | The route is gone from `apps/selfhost` — it survived exactly the one release 0017 T2 promised (PR #200 moved the e2e gate onto the pair; the first post-merge run was green through it; nothing in the repo called it since). The wiring test's pin FLIPPED: it now asserts `GET /verify` answers 404 on a real PGlite appliance, so a resurrection fails the suite. The runbook's finish-sequence step 1 and the quickstart's verify mention moved onto the pair (the REST of those docs stays 0021's); `orchestration.ts`'s `verifyMapping` comment brought current. Net diff 36+/36−. |

## Why this exists

0017 closed the last API gap (both editions serve the full operating contract)
and 0018 made the managed job loop real. What is left is everything between
those endpoints and an operator's hands — collected here from 0017's
"follow-ups this plan now owns" plus one latent bug the whole-repo review
(2026-08-01) surfaced, so none of it lives only in a follow-up bullet again.

## T1 — the apply client speaks the managed shape (a latent bug, not a feature)

`apps/web/src/services/operating-service.ts`'s `applyDeletion` expects the
appliance's synchronous `DecisionAccepted`. The managed route answers
**202 `ApplyQueuedResponse`** and the outcome arrives later on
`GET …/deletions/{hash}/receipt`. The shared Deletions screen therefore
renders on managed but its one destructive button mis-parses the reply — the
exact "shapes drift apart" failure ADR-0026 exists to prevent, on the one
route that destroys data. Fix the client to branch by edition (the queues'
`*PathFor` pattern), typed against `ApplyQueuedResponse`/`ApplyReceipt` from
`@openmig/shared`. This is first because everything else in this plan builds
on an honest client.

## T2 — the Deletions screen polls the receipt

On managed, "apply" is a receipt lifecycle: `202 queued` → poll →
`applied` (with `kind` — `binned` may still hold a copy) / `refused` (code +
operator prose verbatim) / `failed` (reason, hard rule 9). The screen shows
that lifecycle per item — same poll-to-terminal discipline as the Verify
screen (stop on every terminal state, a missed poll keeps polling, restarts
said out loud). On the appliance the synchronous answer renders as today;
one screen, two temporal shapes, no softening of `refused` into an error or
`failed` into silence.

## T3 — `allow_apply_deletions` gets an API and a switch

The flag is gate 1 of the only destructive path and today it is flipped by
SQL (`UPDATE mailbox_mapping SET allow_apply_deletions = true` — the recorded
interim from 0017 T4). Give it a managed API (`PATCH` on the mapping, owner
role) and a deliberately heavy UI switch: default off, the runbook warning in
front of the toggle, the current value visible on the mapping. The appliance
keeps its config-file flag; the CONTRACT for reading the flag should be
shared so the screen renders identically.

## T4 — per-mapping navigation exists

Every per-mapping screen — queues, verify, and T2/T5's additions — is
URL-reachable only. `Layout.tsx` renders operating links for self-host alone,
and `MappingDetail.tsx` links to nothing. A managed operator cannot reach the
decision queues without typing a URL, which makes §11.2's "the owner stays in
control" a claim about routes, not about people. Give `MappingDetail` (or a
per-mapping sub-nav) links to deletions / moves / failures / verify / finish
for that mapping. Small, jsdom-tested, and the moment it lands the managed
edition is operable by mouse.

## T5 — the managed Finish screen

`POST /:mappingId/finish` exists (0017-adjacent work); the Finish screen is
mounted flat and self-host-only. Same treatment verify got in the 0017
follow-up: per-mapping route, edition-aware path, the refusal-over-unresolved-
failures flow rendered with its `hint`.

## T6 — retire the appliance's synchronous `GET /verify`

Armed and waiting: PR #200 moved the e2e gate onto the pair, the first
post-merge run was green through it (46/46), and nothing in the repo calls
the synchronous route. T2 of 0017 promised it exactly one release of
survival. Remove the route and its lifecycle-test pins; `operator-runbook.md`
and `selfhost-quickstart.md` still teach it, so their verify sections move to
the pair in the same change (the rest of those docs is workplan 0021's).

## Hard rules that bite here

- **Rule 2 / ADR-0024:** T2 and T3 change how the gates are *reached and
  shown*, never what they permit. The refusal prose renders verbatim.
- **Rule 9:** a `failed` receipt renders as a failure with its reason —
  never as an empty state, never as "try again" without the why.
- **ADR-0026:** shapes stay in `@openmig/shared`; the ONLY edition split the
  client may contain is URLs (`edition.ts`) and, after T1, apply's documented
  success-shape difference.
