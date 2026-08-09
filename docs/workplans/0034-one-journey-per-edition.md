# Workplan 0034 — One journey per edition (navigation & information architecture)

## Status — 2026-08-09 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The appliance can reach its own per-mapping hub | ⬜ Planned | — |
| T2 The appliance sidebar stops impersonating a login | ⬜ Planned | — |
| T3 "Where am I" on per-mapping screens | ⬜ Planned | — |
| T4 The cutover order is shown, not just implied | ⬜ Planned | — |
| T5 Wrong-edition routes answer honestly | ⬜ Planned | — |

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
- **Per-mapping screens don't say which mapping.** The header title comes from
  `navigation.find(...)` by path prefix; on `/mappings/:id/...` (managed) it
  falls back to the brand name, and the active-nav highlight goes dark. The
  mapping id appears only in body text.
- **The order is implied, never stated.** The appliance nav lists
  Review → Deletions → Moves → Failures → Check → Finish in the runbook's
  cutover order — a genuinely good IA decision that nothing on any screen
  explains. A first-time operator has no way to know the list *is* a sequence,
  or where they are in it. (The managed hub has the same five links with
  blurbs, which is most of the answer already.)
- **Wrong-edition URLs render wreckage.** `/confirm` on managed calls the
  appliance-only `/status` root and error-screens; `/billing`, `/tenants`,
  `/dashboard`, `/login` on the appliance render against APIs that are not
  there. None of it is linked, all of it is typeable.

## Guardrails

- **ADR-0026 / hard rule 5:** the flat-nav vs hub-descent split is a real
  edition difference and stays. This plan adds *links into* what exists; it
  does not merge the two IAs.
- The appliance deliberately has **no Mappings list page**; T1 links to the
  hub from where mapping ids already appear, it does not build a list.
- New strings are bilingual from birth (0024's standing rule).

## Tasks

### T1 — the appliance can reach its own per-mapping hub

Everywhere the selfhost UI prints a mapping id as inert text, it becomes a link
to `/mappings/:id`: the Confirm page's card heading, the `QueueScreen` section
heading, and Verify/Finish's per-mapping sections. Verify `MappingDetail`
renders fully on selfhost (the managed-only detail query already degrades; the
runs route exists since #353) — the hub's five links and the runs panel are the
payoff.

**Acceptance:** on a selfhost build, an operator can click from Review to a
mapping's hub and see Run history; a unit test on `QueueScreen` and `Confirm`
asserts the id renders as a link to the hub in selfhost mode.

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
parent nav item stays highlighted (prefix-match on the nav href against the
path *segments*, not the raw string). One small breadcrumb-ish component,
both editions.

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

Route-level gating in `App.tsx` mirroring the nav's edition split: appliance
builds redirect `/dashboard|/mappings$|/tenants|/billing|/login` → `/confirm`;
managed builds redirect `/confirm` → `/dashboard`. A typed URL lands somewhere
true instead of on a screen erroring against an API that does not exist.
(Per-mapping routes stay shared — they are real in both editions.)

**Acceptance:** render tests per edition assert the redirects; no screen in
the wrong edition ever mounts its query.

## Owner decisions queued by this plan

None — though T4's minimal form was chosen over a guided "journey" component;
if a fuller onboarding is ever wanted, that is a new conversation, not this
plan growing.
