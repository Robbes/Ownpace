# The product glossary (workplan 0035 T3)

One vocabulary, two languages. This file is the decision record for the words
the UI uses; the dictionary (`strings.ts`) implements it, and the state table
(`../components/StateChip.tsx`) implements the state rows. Change a word →
change it here first, then everywhere the family appears.

## The prose boundary (ADR-0024)

Two kinds of words render; only the first belongs to this glossary:

- **Client words** — names, states, labels the CLIENT chooses: translated,
  unified, listed here.
- **Server vocabulary** — verification findings (`PASS`/`FAIL`/`WARN`),
  evidence words (`reported`/`trashed`/`inferred`), refusal and effect prose,
  error text. The server's own claims, rendered VERBATIM, never translated,
  never restyled through StateChip. (Explanations *around* them — the
  `verify.help.*` keys — are client words and are translated.)

## The thing being managed

| concept | EN | NL | rule |
|---|---|---|---|
| The managed thing | **migration** | **migratie** | Nav, titles, buttons, empty states. Nobody "creates a mapping". |
| The technical identifier | **mapping** (id) | **mapping**(-id) | Only where the id itself is shown (config key, API path). Renaming those is out of scope. |

## Feature names

| feature | EN | NL | rule |
|---|---|---|---|
| Review & confirm (pre-start) | Review | **Controleren en bevestigen** | The *controleren* family belongs to Review. |
| The §20 gate | Check | **Verificatie** | The *verifiëren/verificatie* family belongs to Check — `verify.*` keys use it; generic "controleert steekproeven" prose inside intro sentences is fine, the FEATURE words are what must not blur. |
| A sync pass | pass | **ronde** | Run history and Finish step 3 use the same word — an operator sent from one to the other must recognize it. |
| Deciding (queues, §11.1) | decide/decided | **beslissen/beslist** | Verbs standardize on *beslist* ("Al beslist", "Er is nog niets beslist."); the nouns were already committed (*beslissing*, *beslissingswachtrij*). |
| Dismissing a decision | dismiss | **terzijde leggen** | Set-aside, not rejection (*afwijzen* is wrong — it claims the change was refused). |
| Auto-answers | presets / auto-answer | **vaste antwoorden** | `decisionStatus.auto_resolved` points back to this name. |
| The §11.2 detectors | detectors | **detectoren** | Not *wachters* (calque). |
| The §20 gate (as a noun) | gate | **controlepunt** | Not *poort* (calque). |
| Watching (deletions) | watching | **wordt in de gaten gehouden** | Not *onder observatie* (calque). |
| Electronic mail | mail | **mail** / **e-mail** | Never **post** — Dutch *post* is paper mail (owner correction, 2026-08-11: "dat verhuist niet mee met de post" read as letters). *Postvak* stays for mailbox — it is Microsoft's own NL term. |
| ADR-0014's billed unit: one migration × one data kind | path | **pad** | The operator's usage panel counts *paden*; the raw lifecycle tokens beside the count are server vocabulary and stay verbatim. |
| The capacity a path occupies | slot | **plek** | "Houdt nu een plek vast" — not *slot* (calque). A paused path keeps its *plek*, and the pricing wording says so. |
| A pricing tier | package | **pakket** | `access.tier` set it customer-side ("Welk pakket lijkt te passen?"); the operator's usage panel reads the same word, because the operator quotes it to the customer. |
| The MX/DNS switch (Finish step 4) | delivery | **e-mailbezorging**, verb **omzetten** | Not *verplaatsen*/*verhuizen* (same owner correction — bare *bezorging* + *verhuist* read as a house move). And not *migratie*: the migration is the copying that is already running; step 4 is the delivery cutover, a different event on the timeline. |

## States (the StateChip table — full list in `StateChip.tsx`)

| entity | states (EN) | notes |
|---|---|---|
| Mapping lifecycle | Active / Paused / In cutover / Done | NL: Actief / Gepauzeerd / In cutover / Afgerond |
| Domain pass | Pending / Syncing / Completed / Failed / Skipped | NL pending = **In afwachting** |
| Run | Pending / Running / Succeeded / Failed / Cancelled | `success` keeps "Succeeded"; NL pending = **In afwachting** (the *wachtrij* words are reserved for **queued**) |
| Decision | Decided / Decided by preset / Set aside | dismissed is gray, not green |
| Invoice | Draft / Sent / Paid / Overdue / Void | NL: Concept / Verzonden / Betaald / Achterstallig / Vervallen |

Different entities MAY keep different words for near ideas (Succeeded vs
Completed is deliberate — a run finishes, a domain's copy is complete). What
is banned is same-entity drift and raw enum renders.

## Register

NL is uniformly formal — **u**, never je/jij (verified across the whole
dictionary 2026-08-09).
