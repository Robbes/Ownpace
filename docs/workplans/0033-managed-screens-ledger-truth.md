# Workplan 0033 — The managed screens tell the ledger's story

## Status — 2026-08-09 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The client schema matches no payload the server sends | ✅ Done 2026-08-09 | One schema per response shape, each mirroring its route's literal mapper; lifecycle from shared `MAPPING_LIFECYCLES`; the list route serves real connection kinds + camelCase `tenantId` + `domains` + `lastSyncAt`; `mappingApi.update` deleted (no callers, unparseable response — 0026 T2 precedent). `mapping-service.unit.test.ts` fixtures are route-mapper copies; the OLD list shape pinned as a must-throw. |
| T2 A failed Mappings read renders as an empty table | ✅ Done 2026-08-09 | Failed-read blocks on Mappings AND both Billing reads (audit found usage + invoices both masked); `serverMessage()` prefers the JSON body over axios's wrapper; Dashboard repinned to the server's words. Mutation-checked. |
| T3 Silent failures on manual sync and wizard submit | ✅ Done 2026-08-09 | Create failure renders server words + form kept; sync refusal renders per row (the paused 409's hint finally visible); 0037 T1 pulled forward (step gates check only their own fields) because no wizard test could exist without it. Mutation-checked both renders. |
| T4 Dashboard tiles and "Recent Activity" count real things | ✅ Done 2026-08-09 | Five tiles = the four real states + total; Recent Activity renders the newest RUN per recent mapping via `fetchRuns` (the preferred form, not the relabel fallback); a failed run is visibly failed; failed run-history reads say so (mutation-checked). |
| T5 Live per-domain progress on the MappingDetail hub | ✅ Done 2026-08-09 | `LiveProgress` extracted to `components/LiveProgress.tsx`; the ROW DERIVATION moved to shared (`buildDomainStatusReports`) and the managed `GET /migrations/{id}` calls it (fetching failures in the same transaction), so both editions serve identical `DomainStatusReport` rows — the fleet's field-parity finding fixed at the root. Both adapters unit-tested. **Selfhost: URL-only until 0034 T1 lands the links.** Edition seam in component tests = mock the edition module (vite `define` bakes the flag; `vi.stubEnv` cannot reach it — 0034's guardrail corrected). |

> **2026-08-09, second pass:** an adversarial review fleet re-verified every claim
> in this plan against source and found the original framing UNDERSTATED the
> defect. The first draft said the parse breaks "the moment any mapping enters
> cutover or done". Wrong: it breaks on **every non-empty response, today, in
> any status** — see the corrected core defect below. T1 was rewritten from a
> status-enum fix into a full payload-vs-schema reconciliation; T3/T4/T5 carry
> corrections of the same species.

## Why this exists

A full UX review on 2026-08-09 (run after the first real Windows migration
weekend) found that the **managed** edition's two home screens are built on a
vocabulary the server never speaks — and fail closed the moment a tenant has
any mapping at all.

The core defect, verified against the code (twice — the fleet re-checked):

- `MappingSchema` (`apps/web/src/services/mapping-service.ts:62-90`) requires
  `tenantId`, `sourceConfig`, `targetConfig`, `syncConfig`, and declares
  `status: z.enum(['draft', 'active', 'paused', 'completed', 'error'])`.
- `GET /migrations` (`apps/api/src/routes/migrations/index.ts:186-197`)
  returns list items with `tenant_id` (snake case), NO `sourceConfig`,
  `targetConfig` or `syncConfig`, never `lastSyncAt`, and hardcodes
  `sourceType: 'imap'` / `targetType: 'jmap'` regardless of what the wizard
  chose (the real kinds live on connection rows the list query never joins).
- The DB CHECK constrains `mailbox_mapping.status` to
  `active | paused | cutover | done`
  (`packages/ledger/migrations/0001_baseline.sql:382`), and the routes pass it
  through verbatim — so three of the client's five status words can never
  arrive, and two of the server's four crash the enum.

**Consequence: `z.array(MappingSchema).parse` throws for EVERY non-empty
mappings list, in any status.** The Mappings screen and Dashboard "work" today
only for tenants with zero mappings — and the failure is invisible because of
the T2 masking below (a failed read renders as an empty table). The same
schema also rejects the server's own successful `POST /migrations` response
(no configs in the 201 body, `index.ts:321-333`), so `mappingApi.create`
throws on success and the wizard's `onSuccess` never runs. And
`Mappings.tsx:110` renders `mapping.syncConfig.domains.join(', ')` — a field
the list endpoint never sends.

Around that core, the review found the managed home screens masking failures
the rest of the product is disciplined about (hard rule 9):

- `Mappings.tsx` never destructures `error` from its query; a failed read falls
  through `mappings?.length === 0` (undefined ≠ 0) into the table branch and
  renders **an empty table with headers** — a failed read presented as "no
  mappings", on the managed operator's main screen. (This masking is exactly
  what has hidden the parse failure above.)
- `handleSync` catches a failed manual sync trigger with `console.error` only
  (`Mappings.tsx:29-31`); the operator who clicked sees nothing.
- `CreateMapping.tsx` renders no `createMutation.isError` state at all
  (verified by grep) — a failed wizard submit shows nothing.
- The Dashboard's "Recent Activity" is the *mappings list sorted by
  `lastSyncAt`*, presented as run history — while a real run-history endpoint
  with events has existed since #353 (`fetchRuns` in `operating-service.ts`,
  `GET /migrations/:id/runs`, served by `RunStore.listRunsWithEvents`;
  RunsPanel is the existing consumer).

## Guardrails (standing decisions this plan must respect)

- **ADR-0026 / hard rule 5:** fixes land in the ONE UI; nothing here forks by
  edition except where the data source genuinely differs (T5 names its seam).
- **Hard rule 9:** every fix here is in its service — a failed read must say
  so; this plan removes maskings, it must not add softer ones.
- **The prose boundary (ADR-0024):** server refusal text renders verbatim.
- ~~These screens' body prose is EN-only recorded debt~~ **CLOSED 2026-08-09:
  0035 T2/T4 executed the fold (this plan had already shipped, so the
  localization landed in 0035's sweep rather than riding these edits) —
  Dashboard/Mappings/Billing are fully bilingual and the i18n guard test
  carries no allowlist entry for them.**

## Tasks

### T1 — the client schema matches no payload the server sends

Reconcile `MappingSchema` with what the routes actually serve — this is a
payload-vs-schema reconciliation, not an enum edit. All four parse sites are
in scope (`mappingApi.list/get/create/update`, `mapping-service.ts:218-258`):

- **Decide which side moves per field.** `tenant_id` vs `tenantId`; the list's
  missing `sourceConfig`/`targetConfig`/`syncConfig`/`lastSyncAt` (either a
  `MappingListItemSchema` matching the list's real shape, or the route grows
  to the full shape — joining connections for real `sourceType`/`targetType`
  like `GET /:mappingId` already does, which also fixes the hardcoded
  `imap`/`jmap` placeholders misreporting the wizard's choices);
  the create 201 body (no configs — the schema that parses it must accept it,
  or the route must echo the configs with passwords masked, matching GET).
- **Status:** align with the lifecycle the server serves:
  `active | paused | cutover | done` (import `MappingLifecycle` from
  `@openmig/shared` rather than re-declaring). Remove `draft/completed/error`.
  Note the detail route sends `sourceType: sourceConn?.kind ?? 'unknown'`
  (`index.ts:463-466`) — either admit `'unknown'` or fix the route; today it
  fails the client enum whenever a connection row is missing.
- **Beware `z.object` stripping:** the schema drops unknown keys (the file
  documents this hazard at lines 157-171), so `mappingApi.get` silently
  discards `domainStatus`/`mode`/`pattern` today — T5 needs the detail schema
  to carry `domainStatus` (with a test that parsing does not strip it).
- Sweep every consumer of `mapping.status` in `Dashboard.tsx` and
  `Mappings.tsx`: tiles, badge colours, dot colours, and the
  `status === 'error'` branches, replacing them with the real states (cutover
  and done need visual treatments). Drop or repoint the
  `syncConfig.domains` render at `Mappings.tsx:110`.

**Acceptance:** the T1 fixtures are the routes' LITERAL response shapes (not
hand-built ideals) — one list fixture with a mapping in each of the four real
states, the real 201 create body, and a detail body — and all parse and
render; a rejected-shape mutation check (reintroducing `'completed'` in a tile
filter, or `tenantId` where the route sends `tenant_id`) fails a test. The
screens never mention `draft`, `completed` or `error` as mapping states again.

### T2 — a failed Mappings read renders as an empty table

Destructure `error`; render the same failed-read block the queue screens use
(verbatim message + "this is not the same as no mappings"). Same audit for
`Billing.tsx` and any other screen where `data === undefined` falls into an
empty-looking branch (Dashboard already renders A message — but it renders
`error.message`, which for axios failures is the generic "Request failed with
status code 500": pin the SERVER's message, `error.response.data.message`
verbatim, same as the queue screens, for both Dashboard and the new Mappings
failed-read block).

**Acceptance:** tests reject a fetch and assert the server's failure text
renders and the empty-state text does NOT (the exact pattern
`Confirm.unit.test.tsx` already pins for the appliance).

### T3 — silent failures on manual sync and wizard submit

First, the success path (T1's create-response reconciliation) must land —
otherwise the isError render added here would display a ZodError **for every
create that succeeded**, inviting duplicate resubmits. Then:
`handleSync` surfaces its outcome per row (disabled while pending, server
refusal verbatim on failure — the queue screens' `act` bookkeeping is the
model, or a lighter inline variant; note the 409 a paused mapping's Play
button gets carries a hint naming `POST /start`). `CreateMapping` renders
`createMutation.isError` with the server's message verbatim above the buttons.
(The submit button already disables while pending, `CreateMapping.tsx:644-647`
— keep that as an existing-behavior assertion, it is not work.)

**Acceptance:** a 201 with the route's real response shape reaches `onSuccess`
(mutation check: reintroducing the parse mismatch fails it); a rejected
`triggerSync` shows its message at the row; a rejected create shows its
message and keeps the form (no data loss); both mutation-verified by removing
the error render.

### T4 — Dashboard tiles and "Recent Activity" count real things

Tiles recount from the real lifecycle (T1). "Recent Activity" either becomes
real run history — `fetchRuns` (`operating-service.ts:67`) against
`GET /migrations/:id/runs` exists since #353; the cheap honest version renders
the newest run per recent mapping with its outcome — or is relabelled to what
it is ("Recently synced migrations"). **The fallback has a precondition the
first draft missed:** the list endpoint never serves `lastSyncAt` (only the
per-id detail computes it, `index.ts:441-447`), so today the relabel would
label a section that can never show anything. Either way the list route must
serve `lastSyncAt` (or runs must be fetched per mapping). Prefer the run
history; the fallback is acceptable if the N+1 fetch proves heavy, but say so
in the status block rather than shipping the mislabel.

**Acceptance:** whatever ships, the heading matches the data source, the data
source can actually be non-empty for a synced mapping (test seeds one), and a
failed run in the ledger is visibly a failed run on the Dashboard.

### T5 — live per-domain progress on the MappingDetail hub

The appliance's Confirm page gained a `LiveProgress` strip on 2026-08-09 (per
domain: state, synced, failed, retrying, `lastError` verbatim). The managed
operator has no equivalent anywhere. Extract `LiveProgress` from `Confirm.tsx`
into a shared component and render it on `MappingDetail` for both editions —
selfhost feeding it from `/status` (filter to the one mapping), managed from
`GET /migrations/{id}`'s `domainStatus`. That is a data-source seam, not a
feature fork, and it lives in the service layer per `edition.ts`'s pattern.

**Corrections from the fleet pass — the two payloads are NOT identical:**

- Managed `domainStatus` comes from `PgMigrationStatusStore.getStatus`, which
  carries `completedAt` but NOT `itemsRetrying`/`itemsNeedingDecision` — those
  are computed only in the selfhost `/status` route
  (`apps/selfhost/src/status.ts:44-45`, derived from the failures queue).
  Rendering the strip on the managed feed without deriving them would silently
  never show a retrying count (`undefined > 0`) — a soft masking this plan's
  own guardrail forbids. Either derive them in the managed route (join
  failures the way `status.ts` does) or in the client adapter; if deliberately
  deferred, the status block says so.
- The managed adapter must map `completedAt → lastSyncedAt` (selfhost's
  `/status` does that rename) so 0036 T1's as-of renders on both editions.
- `mappingApi.get` strips `domainStatus` today (see T1's z.object note) — the
  detail schema must carry it.

**Sequencing:** extract-first — 0036 T1 adds `lastSyncedAt` to this component
AFTER the extraction (whoever lands second rebases). The selfhost half of the
acceptance depends on 0034 T1 (hub reachability on the appliance); either land
0034 T1 first or record in the status block that the selfhost strip is
URL-only until it lands.

**Acceptance:** both editions' hub shows the strip with live numbers, the
retrying count, and the error verbatim; the component is one file with two
data adapters; unit tests cover both real payload shapes (including the
managed adapter's field derivations).

## Owner decisions queued by this plan

None. Everything here is correcting screens to the contract that already
exists.
