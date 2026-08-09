# Workplan 0035 — One vocabulary, two languages (terminology & i18n completion)

## Status — 2026-08-09 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 One state vocabulary, one StateChip | ⬜ Planned | — |
| T2 The i18n completion sweep (the unrecorded screens) | ⬜ Planned | — |
| T3 One glossary: mapping/migration, and the NL feature names | ⬜ Planned | — |
| T4 The 0024-T5 question, answered (owner) | ⬜ Owner decision | — |
| T5 NL copy corrections (meaning drift found by the fleet) | ⬜ Planned | — |

> **2026-08-09, second pass:** an adversarial fleet re-verified this plan and
> read the entire NL dictionary end-to-end. Corrections applied: raw
> `in_progress` never actually renders (the leaked corner enum is the
> LIFECYCLE vocabulary — `active/paused/cutover/done`); the T2 sweep list was
> missing whole files (ApplyDeletionsPanel, ScopeManifestPanel) and most of
> DiscoveryCounts; T1 must sequence after 0033 T1 and choose NL words, not
> only EN; T3 grows the NL feature-name drift the fleet found; T5 is new —
> genuine NL meaning-drift fixes. The good news: the NL register is uniformly
> formal ("u" throughout, zero je/jij) and datetime.ts is correct — those
> worries are closed.

## Why this exists

The 2026-08-09 UX review read every screen as a bilingual copy editor and found
two systemic problems that per-screen fixes keep re-creating:

**The product speaks four dialects of "state".** The same underlying facts
render as different words depending on which screen you are on:

| where | words used |
|---|---|
| RunsPanel | Pending / Running / **Succeeded** / Failed / Cancelled |
| Confirm live progress | Pending / **Syncing** / **Completed** / Failed / Skipped |
| QueueScreen/Confirm corners (`/status` lifecycle) | `active`, `paused`, `cutover`, `done` — raw, untranslated |
| MappingDetail hub corner (`MappingDetail.tsx:70`) | the raw client-schema status enum |
| Billing invoice rows (`Billing.tsx:164`) | `{invoice.status}` — raw server enum |
| Mappings badge (post-0033) | active / paused / cutover / done |

Some of this is the **prose boundary working as designed** — `PASS`/`FAIL`,
evidence words (`reported`/`trashed`/`inferred`) and refusal text are server
vocabulary and stay verbatim (ADR-0024). But a raw lifecycle word in a gray
corner of a queue card is not server *prose*, it is an enum nobody chose to
render; and Succeeded-vs-Completed for the same idea is drift, not design.
(The first draft claimed `in_progress` renders raw — it does not: it is a
domain-pass state and always renders translated as "Syncing". What leaks is
the lifecycle vocabulary. The acceptance grep below is corrected to match.)

**Localization has unrecorded holes.** The recorded 0024-T5 debt names
Dashboard and Mappings. The review found EN-only or hardcoded strings beyond
that list, each verified in source:

- `QueueScreen.tsx`: "Loading…", "Could not load this queue.", "This is not
  the same as an empty queue…", "No mappings configured.", and the
  catch-fallback "The request did not complete." (line 110 — the identical
  sentence already exists as THREE separate dictionary keys,
  `deletions/tenants/decisions.requestFailed`; consolidate to one) — the
  shared scaffold of three bilingual screens carries hardcoded English.
- `DiscoveryCounts.tsx`: **the whole component**, not just the headers at
  68-73 — the `DOMAIN_LABEL` map (22-27, silently bypassing the existing
  `domain.*` keys), "Scanning your source (read-only)…" (57), "(N kept
  as-is)" (102), and both amber warning paragraphs (116-133), which the
  file's own header comment calls the two things the customer must be told
  before pressing start, with inline EN pluralization ("message{s}") that
  needs one/many key variants. Rendered on BOTH editions' confirm surfaces.
- `ApplyDeletionsPanel.tsx`: ~8 hardcoded EN strings (lines 59, 70-71, 87-88,
  92, 99, 104-107, 121-122) — gate 1 of the destructive path, on the exact
  screen the Windows operator used; in NL the Deletions screen renders half
  English today. The arm/confirm labels feed `DestructiveButton` (same shape
  as the existing `deletions.apply*` keys).
- `ScopeManifestPanel.tsx:36-38`: the column titles "Migrates" / "Partial" /
  "Does not migrate" — client framing over server-prose entries; the file has
  no `useT` at all.
- `Login.tsx`: entire screen (title, labels, error, help text).
- `CreateMapping.tsx`: the six-step wizard (all but the one existing
  `createMapping.target.userOperated` key).
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
(`pending/running/success/failed/cancelled`), and decision status
(`resolved/dismissed/auto_resolved`). One `StateChip` component
(label + colour class per state, colour never the only signal — the text IS
the label) replaces the hand-rolled chip maps (`RunsPanel.STATUS_*`,
`Confirm.STATE_*`, the Mappings badge, the Decisions status chip) and the raw
enum renders: the `queue.migrationStatus` corner text, `MappingDetail.tsx:70`
(`{detail.data.status}`), and `Billing.tsx:164` (`{invoice.status}` — gets
its own entity row with the server's real enum, see workplan 0039). Pick ONE
word per entity **in BOTH languages** — the canonical state table lists the
EN and NL columns (run status keeps the API's `success → "Succeeded"`; domain
state keeps `completed → "Completed"`; different entities may keep different
words — what goes is *unchosen* raw enums and same-entity drift). NL notes
from the fleet's dictionary read: today "Pending" renders as both
"In wachtrij" (runs) and "In afwachting" (domains) while "Queued" is
"In de wachtrij" — reserve the wachtrij words for queued and use
"In afwachting" for pending. Prose LEAD words follow the table too: add the
`confirm.note.*` keys to the sweep (EN `confirm.note.active` opens with
"Running." — colliding with the run-status word — where NL already correctly
says "Actief.").

**Sequencing:** after 0033 T1 (MappingSchema aligned to `MappingLifecycle`);
until then StateChip cannot cover the Mappings badge or the MappingDetail
status corner.

**Acceptance:** grep finds no JSX rendering of `migrationStatus`,
`mapping.status`, `detail.data.status`, or `invoice.status` outside
StateChip; the chip maps are one component; the state table pins both
languages; NL parity compiles; a test pins that server-vocabulary words
(PASS, evidence) do NOT pass through StateChip.

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

### T3 — one glossary: mapping/migration, and the NL feature names

One glossary decision, applied: **"migration"** is the thing operators manage
(nav, titles, buttons, empty states — EN and NL *migratie*); **"mapping"**
remains the technical identifier's name where the id itself is shown (it is
the config key and the API path, and renaming those is out of scope).
**Correction from the fleet pass:** the nav label is the dictionary key
`nav.mappings` rendered by `Layout.tsx:41` — already localized and freely
editable, NOT inside the recorded-debt screens. So the nav rename
("Mappings" → "Migrations", NL "Koppelingen" → "Migraties") is a keys-only
edit T3 does unconditionally; only the in-page titles and tiles inside
Dashboard/Mappings (`Mappings.tsx:47` h1, Dashboard tile labels) ride on
T4's answer.

The fleet's NL read adds three glossary rows beyond mapping/migration:

- **Review vs Check (feature names).** NL uses *controleren/controle* for
  BOTH: nav "Verificatie" lands on a page titled "Controleer de migratie",
  nearly identical to Review's "Controleer en bevestig uw migratie". Pick one
  NL word per feature (proposal: Review = "Controleren en bevestigen",
  Check = "Verificatie", with `verify.*` swept to the verificatie family) and
  sweep `verify.*`, `nav.check`, `nav.review`, `hub.check.*`, `confirm.title`
  for agreement.
- **A sync pass is *ronde*.** Run history says "ronde" (5 uses); Finish step 3
  says "doorloop" — and `finish.step3.queued` points the operator at the runs
  screen that uses the other word. Standardize on *ronde*.
- **The *beslissen* family for decisions.** "Er is nog niets besloten." on
  Moves/Deletions vs "Er is nog niets beslist." on Decisions; "Al besloten"
  headers over chips saying "Beslist". The nouns already committed
  (*beslissing*, *beslissingswachtrij*) — standardize the verbs on *beslist*.

**Acceptance:** no screen offers to "create a migration" from a page titled
"Mappings"; NL uses *migratie* consistently for the managed thing; clicking
any nav entry lands on a page whose title uses the nav's own word family; the
glossary (all rows, both languages) is written down next to the dictionary.

### T4 — the 0024-T5 question, answered (owner)

The recorded question — "localize Dashboard/Mappings **if these screens
live**" — has an answer-shaped fact now: both screens live, and workplan 0033
is about to rework their body content anyway. Proposal to the owner: fold
their localization into 0033's T1/T2/T4 edits (strings move to the dictionary
as they are touched), closing 0024-T5 at near-zero marginal cost. The
alternative (park again) leaves the i18n guard carrying a permanent allowlist.

**Acceptance:** an owner answer recorded here, in 0024's status block, AND —
on a yes — in 0033's guardrails (whose "this plan does not localize them"
sentence becomes wrong the moment the fold is accepted; the two plans must
state the same scope). Whichever way, the guard's allowlist matches the
decision.

### T5 — NL copy corrections (meaning drift found by the fleet)

The 2026-08-09 fleet read all 347 key pairs as a native copy editor. The
register is uniformly formal (*u* throughout — that worry is closed) and most
of the Dutch is idiomatic; these are the surviving corrections, all verified
key-by-key. Meaning drift (fix first):

- `decisions.presets.newMailbox` (NL :648): "een postvak … dat niets
  migreert" flips subject and object — the default Dutch parse is "a mailbox
  that migrates nothing". Disambiguate: "…waarvoor niets migreert" or "…dat
  door geen enkele migratie wordt meegenomen". This label sits on the preset
  that decides auto-answering, exactly where a misreading changes what the
  operator thinks they are automating.
- `confirm.progress.retrying` (NL :479): "opnieuw geprobeerd" is past tense —
  work-done — for a counter that means work-in-retry. Use "wordt opnieuw
  geprobeerd" (or compact "in nieuwe poging").
- `decisions.dismiss`/`decisionStatus.dismissed` (NL :691/:711): "Afwijzen /
  Afgewezen" means rejecting the change — but dismissing sets the question
  aside; next to the two real answer buttons it reads as a third answer that
  reverses the detected change. Use "Terzijde leggen / Terzijde gelegd" (or
  "Negeren / Genegeerd").
- `hub.finish.blurb` (NL :415-416): "de ene bevestigde stap" says the step is
  already confirmed; EN "attested" means the step YOU must attest. Use "de
  ene stap die u zelf moet bevestigen".
- `decisionStatus.auto_resolved` (NL :710): "Beslist door voorkeuze" —
  *voorkeuze* appears nowhere else; the feature's own NL name is "Vaste
  antwoorden". Use "Beslist door vast antwoord" so the chip points back to
  the control that caused it.
- `moves.intro` (EN :81-82!): the ENGLISH is broken — "filed somewhere else
  where they came from" is missing its comparator; NL is the coherent one.
  Fix the EN: "filed somewhere other than where they came from".

Grammar and word choice (cheap, do in the same pass):

- `finish.step2.failures` (NL :555): "1 konden niet worden gekopieerd" —
  split into one/many keys ("kon"/"konden"), mirroring `failures.try.one/.many`.
- Calques: `deletions.watching` "Onder observatie" → "Wordt in de gaten
  gehouden" (and its empty state); "wachters" → "detectoren"; "poort" (§20
  gate) → "controlepunt". (`role.viewer` "Kijker" STAYS — it is Google
  Workspace's established NL term; the fleet's verifier struck that item.)

**Acceptance:** each listed key changed as specified (or a recorded reason
why not); the one/many split renders "1 kon" in a Finish unit test; EN
`moves.intro` parses.

## Owner decisions queued by this plan

- T4 (fold Dashboard/Mappings localization into 0033, or keep parked).
- T3's IN-PAGE renames inside Dashboard/Mappings ride on T4's answer (the
  nav-key rename itself does not — corrected above).
