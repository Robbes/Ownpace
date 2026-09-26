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
| The cutover's grace period: from execute until it ends, a migration that was running keeps copying (workplan 0128 T2) | grace period | **overgangsperiode** | Not *respijt*/*gratieperiode* (a payment's grace). The period is a transition, both systems live, and the prose around it calls the cutover *overstap*, as `lane.title` does. |
| One data type of a running migration no longer following the source, and following it again (workplan 0128 T4) | stop / resume; *stopped by you* | **stoppen** / **hervatten**; *door u gestopt* | Not *pauzeren*: a pause holds the whole migration, a stop one data type. Not *uitschakelen* either: *switched off* / *uitgeschakeld* stays the word for one the mapping file turned off, whose way back is the file and not a button. |
| A customer guide at `/docs` (workplan 0148 T1): written for the person who connects an account | guide / setup guide | **handleiding** / **instelhandleiding** | The nav says *Handleidingen*. A guide never names the operator: it says *deze dienst* / *this service*, and where the reader needs help, *wie deze dienst beheert* / *whoever runs it*. |
| The operator and self-host documents in the repository's `docs/` (workplan 0148 D9) | operator documents | **beheerdersdocumenten** | Named only in the appliance's `/docs` line, whose reader runs the appliance. Not *operatordocumenten*. |
| An app a person creates at Google, Dropbox or Microsoft instead of this service's (workplan 0148 T2) | your own app | **eigen app** | The service's is *de eigen app van deze dienst*; the guide's fold reads *Alleen als u een eigen app wilt gebruiken*. |
| The test phase the managed service is in (workplan 0131 D1, D4) | alpha | **alfa** | Not *bèta*, *test* or *proef*: the owner named it *"Alpha"*. Lower case in running text (*de alfa kan stoppen*), capitalised only where it opens the note (*Alfa: …*). The note, the grant mail, 0131 T3's Billing line and request hint, and 0144's tester guide use this word. |
| Money a customer pays, as the alpha promises there is none (workplan 0131 T3) | charged | **in rekening gebracht** | *Nothing is charged* / *Er wordt niets in rekening gebracht*: the alpha note, the Billing line's first sentence and the request hint. Not *invoiced* / *gefactureerd*, which is what a tier says (0109 T8, *"Free: nothing is invoiced on this tier"*): a tier's word is about the invoice, and the alpha's covers every tier, the paid ones too. The Billing line's second sentence is the free tier's own, *"nothing is invoiced"* included, by the owner's choice (0131 open question 7). |
| The MX/DNS switch (Finish step 4) | delivery | **e-mailbezorging**, verb **omzetten** | Not *verplaatsen*/*verhuizen* (same owner correction — bare *bezorging* + *verhuist* read as a house move). And not *migratie*: the migration is the copying that is already running; step 4 is the delivery cutover, a different event on the timeline. |
| A source not yet run against a real account (workplan 0131 T2) | experimental | **experimenteel** | The tag on a source card at both doors, on a face in the wizard's data-type step and on Google's whole-domain option, read from `SOURCE_PROOFS` in shared. Not *bèta*, *proef* or *test*: it says that one connector has not yet met a real account, not that the service is a trial. Its opposite is never shown; a card without the tag is the plain case. |
| What Ownpace does at a source, and what the provider's permission allows (workplan 0144 T3) | only reads / read-only | **leest alleen** / **alleen-lezen** | Two facts, never one word. *Only reads* / *leest alleen* is the software's promise and true of every source. *Read-only* / *alleen-lezen* (*Alleen lezen.* where it opens the grant page's box) describes a PERMISSION, and is said only where the provider enforces it: Google Drive, Google Tasks, and Microsoft through *Connect with Microsoft*. For Gmail, Google Calendar and Google Contacts the permission also allows changes, and the grant page and the line beside *Connect with Google* say so. The permission is *toestemming*, as on the grant page (*grant.scopeIntro*). |

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
