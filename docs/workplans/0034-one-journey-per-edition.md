# Workplan 0034 — One journey per edition (navigation & information architecture)

## Status — 2026-08-09 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The appliance can reach its own per-mapping hub | ⬜ Planned | — |
| T2 The appliance sidebar stops impersonating a login | ⬜ Planned | — |
| T3 "Where am I" on per-mapping screens | ⬜ Planned | — |
| T4 The cutover order is shown, not just implied | ⬜ Planned | — |
| T5 Wrong-edition routes answer honestly | ⬜ Planned | — |

> **2026-08-09, second pass:** an adversarial fleet re-verified this plan. Every
> load-bearing premise held (unreachable hub, fake login chrome, degrading
> MappingDetail, wreckage routes), with four corrections applied below: the
> brand-fallback header was attributed to the wrong edition; T3's highlight
> mechanism could not satisfy its own acceptance; T5's redirect lists missed
> `/mappings/new` (appliance) and the flat operating routes (managed).

## Why this exists

The 2026-08-09 UX review walked both editions' navigation as their operators
meet it, and found the two journeys sound in outline — managed descends
Mappings → hub → per-mapping screens; the appliance walks a flat nav in the
runbook's cutover order — but broken at specific joints, one of them freshly
self-inflicted:

- **The runs panel shipped on 2026-08-09 into a page the appliance cannot
  reach.** `RunsPanel` renders on `MappingDetail` (`/mappings/:id`), and the
  appliance nav (`Layout.tsx`) contains no Mappings entry, the Confirm page
  links only to `/deletions`, and the queue screens render the mapping id as a
  plain `<h3>` — nothing links to `/mappings/:id` anywhere in the selfhost UI.
  The panel built *because* a Windows operator spent a weekend in log tails is
  URL-only for exactly that operator.
- **The appliance sidebar impersonates a login.** `Layout.tsx` renders the
  user block unconditionally: an avatar letter "U", "User",
  "user\@example.com", and a **Sign out** button — on an edition with no
  accounts, where sign-out can only clear a store nothing reads. Fake identity
  chrome on a sovereignty product is not neutral polish debt.
- **Per-mapping screens don't say which mapping.** On managed, `/mappings/:id/...`
  matches the nav's `/mappings` entry by `startsWith` (`Layout.tsx:104,182`),
  so the header reads "Mappings" — lit, but naming no mapping. On selfhost
  per-mapping routes (reachable once T1 lands) the selfhost nav has no
  `/mappings` entry, so `navigation.find(...)` matches nothing, the title
  falls back to the brand name, and no nav item is highlighted. Either way
  the mapping id appears only in body text.
- **The order is implied, never stated.** The appliance nav lists
  Review → Deletions → Moves → Failures → Check → Finish in the runbook's
  cutover order — a genuinely good IA decision that nothing on any screen
  explains. A first-time operator has no way to know the list *is* a sequence,
  or where they are in it. (The managed hub has the same five links with
  blurbs, which is most of the answer already.)
- **Wrong-edition URLs render wreckage.** `/confirm` on managed calls the
  appliance-only `/status` root and error-screens — and the flat operating
  routes (`/deletions`, `/moves`, `/failures`, `/verify`, `/finish`) are
  equally typeable on managed, where they mount their queries with no
  mappingId and render `edition.ts`'s thrown developer string ("The managed
  edition needs a mappingId to read the … queue") verbatim as an operator
  error. On the appliance, `/billing`, `/tenants`, `/dashboard`, `/login`
  render against APIs that are not there — and `/mappings/new` mounts the
  managed six-step creation wizard on the edition whose config is read-only
  BY DESIGN (standing decision 6). None of it is linked, all of it is
  typeable.

## Guardrails

- **ADR-0026 / hard rule 5:** the flat-nav vs hub-descent split is a real
  edition difference and stays. This plan adds *links into* what exists; it
  does not merge the two IAs.
- The appliance deliberately has **no Mappings list page**; T1 links to the
  hub from where mapping ids already appear, it does not build a list.
- New strings are bilingual from birth (0024's standing rule).
- **Edition-mode tests (mechanism settled 2026-08-09, during 0033 T5):**
  `vi.stubEnv('VITE_EDITION', ...)` does NOT work — the flag is baked in by
  vite `define`, so it is a literal before any test runs (the first draft of
  this guardrail claimed otherwise; `edition.unit.test.ts` documents the
  reality). The sanctioned seams are: (a) mock the edition module in
  component tests (`vi.mock('../services/edition', ...)` with a mutable flag
  — `MappingDetail.unit.test.tsx` is the working example), or (b) extract
  `navigationFor(edition)` / route gating as pure functions per the file's
  own `*For(edition, ...)` pattern and test those. Prefer (b) for Layout/App
  work in this plan.

## Tasks

### T1 — the appliance can reach its own per-mapping hub

Everywhere the selfhost UI prints a mapping id as inert text, it becomes a link
to `/mappings/:id`: the Confirm page's card heading, the `QueueScreen` section
heading, and Verify/Finish's per-mapping sections. Verify `MappingDetail`
renders fully on selfhost (the managed-only detail query already degrades; the
runs route exists since #353) — the hub's five links and the runs panel are the
payoff.

**Acceptance:** on a selfhost build, an operator can click from Review to a
mapping's hub and see Run history; unit tests on ALL FOUR named sites —
`QueueScreen`, `Confirm`, Verify's per-mapping heading (`Verify.tsx:102`) and
Finish's (`Finish.tsx:257`) — assert the id renders as a link to the hub in
selfhost mode (Finish is the screen where "see the pass that failed" matters
most, and 0036 T3 depends on it being link-shaped).

### T2 — the appliance sidebar stops impersonating a login

On selfhost: no avatar block, no placeholder name/email, no Sign out. The
language switcher stays (it is real on both editions). On managed: replace the
`'User' / 'user@example.com'` fallbacks — the store always has real claims
after login, so the fallbacks are dead words; if they can render, that is a
bug to surface, not to paper over.

**Acceptance:** selfhost render test asserts no Sign out and no placeholder
identity; managed test asserts the signed-in email renders.

### T3 — "where am I" on per-mapping screens

The header shows the mapping context when one is in scope: on any
`/mappings/:id/...` route, title becomes `{screen} — {mappingId}` (id
truncated middle-out if long) with the id linking back to the hub, and the
parent nav item stays highlighted. **Highlight mechanism (corrected — plain
prefix-matching cannot light `/deletions` from `/mappings/acme/deletions`):**
on `/mappings/:id/:screen`, highlight the nav item whose href matches
`'/' + :screen` (selfhost) or `/mappings` (managed); elsewhere keep
first-segment prefix matching. One small breadcrumb-ish component, both
editions.

**Acceptance:** on `/mappings/acme/deletions` the header names Deletions and
acme, Deletions (selfhost) / Mappings (managed) is highlighted; test pins both
editions' variants.

### T4 — the cutover order is shown, not just implied

Cheapest honest form, not a wizard: the hub (`MappingDetail`) already lists the
five screens with blurbs — give that list explicit step numbering and one
intro sentence ("in the order a cutover runs"), and reuse the same numbered
framing as a short strip on the appliance's Confirm page active state ("next:
review Deletions → … → Finish"). No state machine, no gating — the screens
already gate themselves (Finish refuses over open failures).

**Acceptance:** an operator reading either edition can answer "what comes
after Check?" from the screen; strings EN/NL.

### T5 — wrong-edition routes answer honestly

Route-level gating in `App.tsx` mirroring the nav's edition split. Appliance
builds redirect `/dashboard|/mappings$|/mappings/new|/tenants|/billing|/login`
→ `/confirm` — `/mappings/new` matters most: it mounts the managed creation
wizard against a missing API on the edition whose config is read-only by
design (standing decision 6). Managed builds redirect `/confirm` AND the flat
operating routes `/deletions|/moves|/failures|/verify|/finish` → `/dashboard`
(they mount today with no mappingId and render internal exception text — the
per-mapping `/mappings/:id/...` forms are the real managed routes). A typed
URL lands somewhere true instead of on a screen erroring against an API that
does not exist. (Per-mapping routes stay shared — they are real in both
editions. Patterns should prefix-match so future sub-routes like
`/billing/invoices/:id` stay caught.)

**Acceptance:** render tests per edition assert the redirects — including
`/mappings/new` on the appliance and `/deletions` on managed; no screen in
the wrong edition ever mounts its query.

## Owner decisions queued by this plan

None — though T4's minimal form was chosen over a guided "journey" component;
if a fuller onboarding is ever wanted, that is a new conversation, not this
plan growing.
