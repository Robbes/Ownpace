# Workplan 0038 — The endgame earns the finish

## Status — 2026-08-09 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Force is offered only when the refusal explained it | ✅ Done 2026-08-09 | Stable `code` on the refusal contract (both editions); force renders only on `unresolved_failures`; paused refusal = hint, no force; transport failure = plain error + force=false retry. The fleet's missing test (generic Error → no "Finish anyway") exists. |
| T2 A done mapping keeps its aftermath | ✅ Done 2026-08-09 | Handover + "What remains available" (verify report, run history) render on done and after success; step 3's catch keeps the server message and stops claiming "nothing ran". |
| T3 The checklist checks what it claims to check | ✅ Done 2026-08-09 | Step 1 reads the verify outcome (passed+as-of / status-word-verbatim+as-of / no-run); step 2 surfaces failed queue reads verbatim ("not the same as clear"), finish stays usable. |
| T4 The appliance operator is not locked out or misled | ✅ Done 2026-08-09 | `canManage = isSelfHost() \|\| role` (named hard-rule-5 seam); no role caption on selfhost; failed preset save names its reason beside the reverted value; `finish.note.paused` reworded edition-neutral. |
| T5 Decisions rows tell their whole story | ✅ Done 2026-08-09 | `resolution` + `resolvedBy` on answered rows; `detail` behind a per-row disclosure (verbatim key:value); dismissed's neutral chip (via 0035 StateChip) pinned. |
| T6 Verify keeps its report; scope said out loud | ✅ Done 2026-08-09 | Mount reads the report once (starts nothing — the pinned test now asserts no START call): stored done report renders with its as-of, running scan is rejoined. Appliance scope sentence pinned present on selfhost / absent on managed. |
| T7 Refusals reach the operator in operator words | ✅ Done 2026-08-09 | Transport: the text-request fetches parse string JSON error bodies (tested with the STRING shape axios actually delivers — the server sentences could never render before). Wording: lifecycle hints reworded surface-neutral in shared; **merging the PR is the owner approval this row queued** (the two sentences are called out in the PR body). |

## Why this exists

The 2026-08-09 review fleet went deep on the surfaces where a migration ends
— Finish, PermissionsHandover, Decisions, Verify — the moment when a wrong
impression converts directly to data loss or a Monday-morning lockout. Every
finding was independently re-verified by an adversarial second agent. The
checklist's core order-safety design is sound and well-tested; what fails is
the aftermath and the edges:

- **The force button arms after ANY failure** (`Finish.tsx:137-156`): the
  catch maps a network timeout, a 500, or the "paused" refusal to the same
  `blocked` state whose render unconditionally offers "Finish anyway, leaving
  them behind" — the screen's own comment says force is "offered only after
  the refusal has said what it costs", and that is exactly what a transport
  error never did. Clicking after a timeout retries with `force=true` and can
  silently skip the one gate the refusal design exists to make informed.
- **Finishing hides the handover**: everything renders only while lifecycle
  is `active|cutover` (`Finish.tsx:245,262,291`). The moment a mapping is
  `done` — including a reload right after success — PermissionsHandover
  vanishes, though both servers happily serve the report and the component's
  own header names the post-cutover Monday morning as its purpose.
- **Step 1 is a permanently gray circle**: Finish never reads the verify
  outcome both editions serve as a cheap status read; an operator can finish
  over a FAIL report (or none) with the checklist showing nothing amiss —
  while the header claims "checked, not taken on trust".
- **The appliance operator is locked out of their own presets**: Decisions'
  `canManage` requires a managed role; on selfhost `user` is always null, so
  the standing-answers control is permanently disabled and captioned "An
  owner or admin sets these." — roles that do not exist there, while the
  appliance server accepts the PUT from its single operator.

## Guardrails

- **Hard rule 9 / the errors-verbatim rule** is the spine of most tasks here:
  failed reads must say so, server refusals must reach the screen.
- **The prose boundary (ADR-0024):** where the words that mislead are the
  SERVER's (T7), the fix is server-side shared-contract wording, rendered
  verbatim exactly as today — never a client paraphrase.
- **Hard rule 5:** T4's selfhost seams are genuine edition differences (the
  appliance has one operator and no roles) — legitimate, named seams.
- The finish flow's weight and order stay; nothing here adds gating the
  screens don't already have, and nothing softens the refusal design.

## Tasks

### T1 — force is offered only when the refusal explained it

Carry a discriminant on the outcome ("refused" vs "failed"): only a
`FinishRefusedError` whose refusal is the unresolved-failures one renders the
force affordance. Transport failures render as a plain error with a plain
retry (`force=false`). The "paused" refusal gets no force button — force
cannot satisfy it (`lifecycle.ts:64-79`), so today's button lies about what
force does.

**Acceptance:** a rejected finish with a generic `Error` does NOT render
"Finish anyway" (the missing test); the paused refusal renders its hint
without the force button; the failures refusal renders count + hint + force
exactly as today.

### T2 — a done mapping keeps its aftermath

Render PermissionsHandover for `done` mappings and in the success branch,
plus a short "what remains available" block: permission report, verify
report, run history links. The checklist steps can stay hidden; the take-away
document must not. Also (fleet: END-15) Finish step 3's catch discards the
error and claims "The pass request failed — nothing ran. Try again." — on the
appliance the request can time out while the single-flight pass keeps
running. Render the server's message verbatim with framing softened to what
is known (the request failed; a pass may still be running — re-check the
queues).

**Acceptance:** a `done` mapping's Finish page shows the handover panel and
the aftermath links (test); step 3's failure text renders the caught server
message and no longer claims "nothing ran" unconditionally.

### T3 — the checklist checks what it claims to check

- **Step 1 reads the verify outcome** (both editions serve it): done +
  `canProceedToCutover` → checked, "passed, as-of"; done + not-ready → amber
  with the overall status word verbatim and the link; never-run → open
  circle with "no check has run". Sequence with 0036 T1 so the as-of exists.
- **Step 2 stops masking failed reads**: `loadError` reads only
  `failures.error`/`status.error`; a failed moves or deletions query leaves
  its `.data` undefined and step 2 renders "Reading…" forever — a failed
  read shown as loading, at the exact moment the operator decides the queues
  are clear. Surface `moves.error`/`deletions.error` verbatim ("Could not
  read the moves queue: … — not the same as clear") and keep the finish
  button usable (the server re-checks anyway).

**Acceptance:** tests: verify-report states render the three step-1 forms; a
rejected `fetchMoves` shows its error text and "Reading…" does NOT render.

### T4 — the appliance operator is not locked out or misled by managed chrome

- Decisions presets: `canManage = isSelfHost() || role check`; the
  "An owner or admin sets these." caption never renders on selfhost. (The
  appliance server already accepts the PUT — this is client chrome only.)
- A failed preset save currently reverts the dropdown silently
  (`catch { setPresetDraft(null) }`) — keep the revert (correct), add an
  inline error with the server's message verbatim (the file's own
  `errorText()` helper is right there).
- `finish.note.paused` tells managed operators to "Remove it from the config
  directory" — an appliance instruction. Split the key by edition or reword
  edition-neutrally (the dictionary is client framing; a variant is
  legitimate).

**Acceptance:** selfhost-mode test: `user` null → preset select enabled, no
read-only caption; a rejected preset save shows the failure and the stored
value; managed finish page never mentions a config directory.

### T5 — Decisions rows tell their whole story

The contract carries `detail` ("structured facts behind the summary"),
`resolution` ("the owner's answer, recorded verbatim") and `resolvedBy` —
the screen renders none of them (its own header comment claims `detail`
renders; it never does). And every non-pending status chip is green,
including `dismissed` — closed-without-acting wears the same color as
handled. Render `resolution` + `resolvedBy` on answered rows, `detail`
behind a per-row disclosure (verbatim key: value lines), and give
`dismissed` a neutral chip (coordinate the chip with 0035 T1's StateChip).

**Acceptance:** an auto-resolved row shows what was answered and by which
preset; dismissed ≠ green (test); frame strings bilingual.

### T6 — Verify keeps its report; scope said out loud

- **Navigation must not cost a re-scan**: Verify starts `idle` and reads
  nothing on mount — the operator who runs the minutes-long check, visits
  Deletions, and returns finds it gone, though both servers retain the last
  run. On mount, GET the report endpoint once (a documented safe status read
  — it starts nothing): render a done report labeled as the last completed
  run (0036 T1's timestamp makes that honest; sequence after it), resume
  polling on a running one. Adjust the pinned mount test to assert no START
  call rather than no calls at all (it currently over-applies the
  behind-a-button rationale).
- **The appliance-wide scope is stated**: on selfhost the per-mapping verify
  route runs the whole-appliance scan (`verifyPathFor` ignores the id) and
  renders every mapping's report. One bilingual sentence by the button ("On
  this appliance the check always covers every configured migration"), and
  on the per-mapping route either filter the rendered reports to the route's
  mapping with an "N others were also checked" note, or keep all and say
  why. (A per-mapping scan on the appliance is a server change nobody asked
  for — out of scope.)

**Acceptance:** mount fetches report only (no start); a stored done report
renders with its as-of; selfhost verify states its scope (test pins the
sentence in selfhost mode).

### T7 — refusals reach the operator in operator words

- **Transport bug first (no owner needed):** `fetchPermissionReport` uses
  `responseType: 'text'`, so JSON error bodies arrive as unparsed strings
  and the component's `.message`/`.reason` probes get undefined — the
  carefully-written server sentences ("This migration does not record which
  mailbox it reads…") can NEVER render in production; the unit test passes
  only because it mocks an already-parsed object. Parse the string body
  (try/catch, fall through to the generic), fix the test to reject with the
  shape axios actually delivers. Same latent shape in `fetchGroupRunbook`.
- **Owner wording decision:** the shared finish refusal hints speak curl to a
  UI operator — "Resolve them at GET /failures … re-send with ?force=true"
  rendered beside a link and button that already do those things, and the
  paused hint says "remove it from the config directory" on managed. Per the
  prose boundary the fix is rewording in `packages/shared/src/lifecycle.ts`
  (both editions emit it; UI keeps rendering verbatim) — surface-neutral
  operator language. Owner confirms the rewrite since these strings are the
  shared contract's operating semantics.

**Acceptance:** a test rejects `fetchPermissionReport` with a STRING body and
asserts the server's reason renders; lifecycle hint tests updated with the
owner-approved wording.

## Owner decisions queued by this plan

- T7's hint rewrite (shared-contract wording; owner approves the new
  sentences).
- T2 note: invite-shaped duplicates and billing findings live in 0039, not
  here.
