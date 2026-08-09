# Workplan 0033 — The managed screens tell the ledger's story

## Status — 2026-08-09 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The lifecycle enum the client cannot parse | ⬜ Planned | — |
| T2 A failed Mappings read renders as an empty table | ⬜ Planned | — |
| T3 Silent failures on manual sync and wizard submit | ⬜ Planned | — |
| T4 Dashboard tiles and "Recent Activity" count real things | ⬜ Planned | — |
| T5 Live per-domain progress on the MappingDetail hub | ⬜ Planned | — |

## Why this exists

A full UX review on 2026-08-09 (run after the first real Windows migration
weekend) found that the **managed** edition's two home screens are built on a
vocabulary the server never speaks — and fail closed at exactly the moment a
migration succeeds.

The core defect, verified against the code:

- `mailbox_mapping.status` is CHECK-constrained to
  `active | paused | cutover | done`
  (`packages/ledger/migrations/0001_baseline.sql:382`), and both mapping API
  routes pass it through verbatim (`apps/api/src/routes/migrations/index.ts:192`
  and `:482`, `status: mapping.status`).
- The web client's `MappingSchema` declares
  `z.enum(['draft', 'active', 'paused', 'completed', 'error'])`
  (`apps/web/src/services/mapping-service.ts:86`).

The overlap is `active` and `paused`. **The moment any mapping enters `cutover`
or `done` — the end every migration is supposed to reach — `MappingSchema.parse`
throws, and the Mappings list and the Dashboard hard-fail.** Meanwhile the
Dashboard's "Completed" and "Errors" tiles filter for words the server never
sends, so they are permanently zero, and the Mappings status badge colours by
`'error'`, a value that cannot occur. Nothing has noticed because no managed
mapping has yet been driven to `done` in front of these screens — which is the
same shape as every Windows finding this weekend: the gates test the artifact,
and this lives in what happens after somebody uses it.

Around that core, the same review found the managed home screens masking
failures the rest of the product is disciplined about (hard rule 9):

- `Mappings.tsx` never destructures `error` from its query; a failed read falls
  through `mappings?.length === 0` (undefined ≠ 0) into the table branch and
  renders **an empty table with headers** — a failed read presented as "no
  mappings", on the managed operator's main screen.
- `handleSync` catches a failed manual sync trigger with `console.error` only
  (`Mappings.tsx:29-31`); the operator who clicked sees nothing.
- `CreateMapping.tsx` renders no `createMutation.isError` state at all
  (verified by grep) — a failed wizard submit shows nothing.
- The Dashboard's "Recent Activity" is the *mappings list sorted by
  `lastSyncAt`*, presented as run history — while a real run-history endpoint
  with events has existed since #353.

## Guardrails (standing decisions this plan must respect)

- **ADR-0026 / hard rule 5:** fixes land in the ONE UI; nothing here forks by
  edition except where the data source genuinely differs (T5 names its seam).
- **Hard rule 9:** every fix here is in its service — a failed read must say
  so; this plan removes maskings, it must not add softer ones.
- **The prose boundary (ADR-0024):** server refusal text renders verbatim.
- These screens' body prose is EN-only **recorded debt** (0024 T5, owner-parked,
  refined by workplan 0035). This plan does not localize them — it must simply
  not ADD new hardcoded strings; new strings go through the dictionary.

## Tasks

### T1 — the lifecycle enum the client cannot parse

Align `MappingSchema.status` with the lifecycle the server actually serves:
`active | paused | cutover | done`. Remove `draft/completed/error` (nothing
produces them; the DB CHECK forbids them). Sweep every consumer of
`mapping.status` in `Dashboard.tsx` and `Mappings.tsx`: tiles, badge colours,
dot colours, and the `status === 'error'` branches, replacing them with the
real states (cutover and done need visual treatments; `MappingLifecycle` in
`@openmig/shared` is the type to import rather than re-declaring).

**Acceptance:** a fixture list containing one mapping in each of the four real
states parses and renders; a unit test feeds all four through the schema
(mutation check: reintroducing `'completed'` in a tile filter fails a test that
asserts the Done tile counts `done`). The screens never mention `draft`,
`completed` or `error` as mapping states again.

### T2 — a failed Mappings read renders as an empty table

Destructure `error`; render the same failed-read block the queue screens use
(verbatim message + "this is not the same as no mappings"). Same audit for
`Billing.tsx` and any other screen where `data === undefined` falls into an
empty-looking branch (Dashboard already renders its error; verify and pin it).

**Acceptance:** tests reject a fetch and assert the failure text renders and
the empty-state text does NOT (the exact pattern `Confirm.unit.test.tsx`
already pins for the appliance).

### T3 — silent failures on manual sync and wizard submit

`handleSync` surfaces its outcome per row (disabled while pending, server
refusal verbatim on failure — the queue screens' `act` bookkeeping is the
model, or a lighter inline variant). `CreateMapping` renders
`createMutation.isError` with the server's message verbatim above the buttons,
and the submit button disables while pending.

**Acceptance:** tests: a rejected `triggerSync` shows its message at the row; a
rejected create shows its message and keeps the form (no data loss); both
mutation-verified by removing the error render.

### T4 — Dashboard tiles and "Recent Activity" count real things

Tiles recount from the real lifecycle (T1). "Recent Activity" either becomes
real run history — `listRuns` per mapping exists since #353; the cheap honest
version renders the newest run per recent mapping with its outcome — or is
relabelled to what it is ("Recently synced migrations"). Prefer the former;
the fallback is acceptable if the N+1 fetch proves heavy, but say so in the
status block rather than shipping the mislabel.

**Acceptance:** whatever ships, the heading matches the data source, and a
failed run in the ledger is visibly a failed run on the Dashboard.

### T5 — live per-domain progress on the MappingDetail hub

The appliance's Confirm page gained a `LiveProgress` strip on 2026-08-09 (per
domain: state, synced, failed, retrying, `lastError` verbatim — the same
numbers `/status` serves). The managed operator has no equivalent anywhere: the
hub's detail card shows name and status only, while the managed
`GET /migrations/{id}` already returns `domainStatus` with identical fields.
Extract `LiveProgress` from `Confirm.tsx` into a shared component and render it
on `MappingDetail` for both editions — selfhost feeding it from `/status`
(filter to the one mapping), managed from the mapping detail. That is a data-
source seam, not a feature fork, and it lives in the service layer per
`edition.ts`'s pattern.

**Acceptance:** both editions' hub shows the strip with live numbers and the
error verbatim; the component is one file with two data adapters; unit tests
cover both shapes.

## Owner decisions queued by this plan

None. Everything here is correcting screens to the contract that already
exists.
