# Workplan 0035 — One vocabulary, two languages (terminology & i18n completion)

## Status — 2026-08-09 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 One state vocabulary, one StateChip | ⬜ Planned | — |
| T2 The i18n completion sweep (the unrecorded screens) | ⬜ Planned | — |
| T3 Mapping vs migration, EN and NL | ⬜ Planned | — |
| T4 The 0024-T5 question, answered (owner) | ⬜ Owner decision | — |

## Why this exists

The 2026-08-09 UX review read every screen as a bilingual copy editor and found
two systemic problems that per-screen fixes keep re-creating:

**The product speaks four dialects of "state".** The same underlying facts
render as different words depending on which screen you are on:

| where | words used |
|---|---|
| RunsPanel | Pending / Running / **Succeeded** / Failed / Cancelled |
| Confirm live progress | Pending / **Syncing** / **Completed** / Failed / Skipped |
| `/status` API + QueueScreen corner | `in_progress`, `active`, `paused` — raw, untranslated |
| Mappings badge (post-0033) | active / paused / cutover / done |

Some of this is the **prose boundary working as designed** — `PASS`/`FAIL`,
evidence words (`reported`/`trashed`/`inferred`) and refusal text are server
vocabulary and stay verbatim (ADR-0024). But `in_progress` in a gray corner of
a queue card is not server *prose*, it is an enum nobody chose to render; and
Succeeded-vs-Completed for the same idea is drift, not design.

**Localization has unrecorded holes.** The recorded 0024-T5 debt names
Dashboard and Mappings. The review found EN-only or hardcoded strings beyond
that list, each verified in source:

- `QueueScreen.tsx`: "Loading…", "Could not load this queue.", "This is not
  the same as an empty queue…", "No mappings configured." — the shared
  scaffold of three bilingual screens carries hardcoded English.
- `DiscoveryCounts.tsx:68-73`: the table headers (Type / Collections / Items /
  Size / Needs an ID / Already on the destination) — rendered on BOTH
  editions' confirm surfaces, including the appliance's flagship screen.
- `Login.tsx`: entire screen (title, labels, error, help text).
- `CreateMapping.tsx`: the entire six-step wizard.
- `Billing.tsx`: entire screen.
- `Layout.tsx`: the `'User'` / `'user@example.com'` fallbacks (0034 T2 deletes
  these) and the brand-title fallback.

(`ConfirmMigration.tsx` was the same class and was fixed 2026-08-09 in #355 —
this sweep is "find the rest of that class".)

**And one naming wobble:** nav and list say **Mappings**, buttons and empty
states say **Create Migration**, the hub calls it a migration, NL says
*koppeling* in some places and *migratie* in others.

## Guardrails

- **The prose boundary is the constraint, not the victim.** T1 must produce a
  written rule for which words are server-vocabulary (verbatim, untranslated:
  verification statuses, evidence words, refusal/effect prose, error text) and
  which are client states (translated, unified). The rule lives beside the
  dictionary and each StateChip call site says which side it is on.
- **Compile-time key parity stays the mechanism** (typed `nl` against `en`);
  no runtime i18n framework enters (0024's decision).
- Dashboard/Mappings body prose is owner-parked (T4 asks; T2 does not touch
  those two screens until it is answered).

## Tasks

### T1 — one state vocabulary, one StateChip

Define the canonical client-state words once, per entity, in the dictionary:
mapping lifecycle (`active/paused/cutover/done`), domain pass state
(`pending/in_progress/completed/failed/skipped`), run status
(`pending/running/success/failed/cancelled`). One `StateChip` component
(label + colour class per state, colour never the only signal — the text IS
the label) replaces the three hand-rolled chip maps (`RunsPanel.STATUS_*`,
`Confirm.STATE_*`, the Mappings badge) and the raw `queue.migrationStatus`
corner text. Pick ONE English word where screens currently differ (proposal:
run status keeps the API's `success → "Succeeded"`; domain state keeps
`completed → "Completed"`; the two are different entities and may keep
different words — what goes is *unchosen* raw enums and same-entity drift).

**Acceptance:** grep finds no raw `in_progress`/`migrationStatus` rendered to
users; the three chip maps are one component; NL parity compiles; a test pins
that server-vocabulary words (PASS, evidence) do NOT pass through StateChip.

### T2 — the i18n completion sweep

Localize the enumerated unrecorded screens/strings (QueueScreen scaffold,
DiscoveryCounts headers, Login, CreateMapping, Billing), EN+NL, reusing
existing keys where the sentence already exists. Then add the guard that ends
the class: a unit test (or lint rule) over `pages/` and `components/` that
fails on JSX text literals outside `t()` in the covered screens — imperfect
heuristics are fine if the failure message says how to annotate a deliberate
exception (server-prose passthroughs are the known one).

**Acceptance:** the listed screens render fully in NL; the guard catches a
seeded regression; recorded-debt screens (Dashboard/Mappings) are untouched
and still listed as open in the guard's allowlist WITH the 0024-T5 reference.

### T3 — mapping vs migration, EN and NL

One glossary decision, applied: **"migration"** is the thing operators manage
(nav, titles, buttons, empty states — EN and NL *migratie*); **"mapping"**
remains the technical identifier's name where the id itself is shown (it is
the config key and the API path, and renaming those is out of scope). Sweep
titles/buttons for agreement (nav "Mappings" → "Migrations" is part of this —
it is inside the recorded-debt screens, so it lands together with T4's answer
or is done keys-only if T4 stays parked).

**Acceptance:** no screen offers to "create a migration" from a page titled
"Mappings"; NL uses *migratie* consistently for the managed thing.

### T4 — the 0024-T5 question, answered (owner)

The recorded question — "localize Dashboard/Mappings **if these screens
live**" — has an answer-shaped fact now: both screens live, and workplan 0033
is about to rework their body content anyway. Proposal to the owner: fold
their localization into 0033's T1/T2/T4 edits (strings move to the dictionary
as they are touched), closing 0024-T5 at near-zero marginal cost. The
alternative (park again) leaves the i18n guard carrying a permanent allowlist.

**Acceptance:** an owner answer recorded here and in 0024's status block;
whichever way, the guard's allowlist matches the decision.

## Owner decisions queued by this plan

- T4 (fold Dashboard/Mappings localization into 0033, or keep parked).
- T3's nav rename ("Mappings" → "Migrations") rides on T4's answer.
