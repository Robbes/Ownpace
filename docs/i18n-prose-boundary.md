# The i18n server-prose boundary (workplan 0024 T4, ADR-0013)

The web app is bilingual (EN + NL, ADR-0013). Not everything on screen may be
translated: some of what the UI renders is not *copy* but *findings* — words
the server produced about this migration, this item, this refusal. This doc
draws the line per prose class, so nobody building a screen has to re-derive
it (or worse, re-decide it).

**The rule in one line: translate the frame, never the finding.** The client
owns every word it authors; the server's words render as served; a stable
code or enum may carry a localized explanation *beside* it — never *instead
of* it.

## Classes that render VERBATIM (the server's words, as served)

| Class | Fields (operating contract) | Why |
|---|---|---|
| **Refusals** | `code` + `reason` (queue actions, apply-deletions), `error` + `hint` (Finish) | The gates' words are the gates' words (hard rule 2's protections, ADR-0024). A translation layer between a refusal and the operator is drift by design. Pinned by test: `i18n.unit.test.tsx` renders a refusal under `nl` and asserts the exact English words + code. |
| **Failure diagnostics** | `lastError` | Evidence, not copy (hard rule 9). The difference between a 507, a 403 and a parse error is the only thing that tells an operator whether `retry` has any chance of working; summarising or translating it removes exactly that. On managed, the API answers it in its own English for a host a tester typed (workplan 0136 T3, second step, `apps/api/src/failure-answer.ts`): our prose and the status stay, a server's words only as an error document we know. The screen still renders what it is served. |
| **Operating guidance** | `whatThisMeans`, `howToResolve` | The operator's text, API paths and field names included, deliberately authored once in `@openmig/shared` so the two editions cannot drift (ADR-0026), and served as it is to the API's callers. **The screens do not show it** (the owner, 2026-10-18): a tester read `POST /mappings/{mappingId}/moves/…/keep` under a Dutch heading. They show the customer's version, written the shared-package way (class 4 below, *the queues' guidance*). A web-side translation of either would fork it per language — the one thing the shared contract exists to prevent. |
| **Action outcomes** | `effect`, `ifYouNeedToResume` | Written (in the contract, on purpose) to be read verbatim by the person who just clicked. |
| **Verification findings** | `issues[].message`, `recommendations` | Findings about this run, same footing as `lastError`. On managed, the API answers them by the same rule, and a failed scan's `error` and a failed apply receipt's `error` too (workplan 0136 T3, second step). **Verify says four findings in the client's words** (the owner, 2026-10-18; a Dutch screen showed the server's English under *Problemen*): an issue whose id is `TARGET_FOLDER_MISSING_<type>`, `TARGET_UNREAD_<type>`, `MISSING_<type>` or `CHECKSUM_<type>`, matched whole, gets a sentence in the reader's language with what to do next (`issueSentence` in `apps/web/src/i18n/verdict-words.ts`; class 2 below). Any other finding keeps the server's text. The server's text of every finding, with its id and severity token, and the `recommendations` render as served, in a closed *Technical details* / *Technische details* fold under the list. |
| **Verdict + evidence tokens** | `PASS`/`WARN`/`FAIL`/`SKIPPED`/`NOT_VERIFIABLE`, an issue's `ERROR`/`WARNING`; `reported`/`trashed`/`inferred`; mapping status words | Server vocabulary an operator may need to quote in a support thread or grep in a log. The TOKEN stays: on the wire, in downloads, and in the title of the chip that shows it. **What the chip says is the client's word** (the owner, 2026-10-18; it said the token, in English on a Dutch screen): *Passed* / *Geslaagd* for `PASS`, *Reported by the source* / *Gemeld door de bron* for `reported`, the rest in `apps/web/src/i18n/GLOSSARY.md`. Its *explanation* is class 2 below. |

## Classes the client localizes

1. **Client-authored copy** — titles, intros, buttons, empty states, table
   headers, plurals: the typed dictionary (`apps/web/src/i18n/strings.ts`,
   compile-time key parity EN↔NL). It is composed from one file per area of
   the app in `apps/web/src/i18n/strings/`, each with its English and, below
   it in the same order, its Dutch; a new word goes in the area of the screen
   that says it (`one-area-per-key.unit.test.ts`).
2. **Explanations keyed off stable codes/enums** — lifecycle notes keyed on
   the mapping-status enum, hover help on verdict words, hover titles on
   evidence badges, and the words on those chips themselves (the owner,
   2026-10-18). The server's token is the handle; the localized prose sits
   beside it, and a chip that says the client's word keeps the token at the
   end of its title, as *(reported)*. This is the sanctioned path if
   client-side explanation of refusal `code`s is ever wanted — the `reason`
   still renders as served. Verify's sentences for the four findings it knows
   by their id are the same kind (*Verification findings* above): the id is
   the handle, and the server's text stays in the fold beside it.

   **A Test at an address the tester typed is the one place the client says
   the `reason` itself** (workplan 0136 T3). On managed, that `reason` is not
   the server's diagnostic: the API writes it from the refusal's parts (a
   status, a server's own words only when they came as an error document we
   know, or what kind of failure it was) and never passes on the remote's
   bytes. So the answer, and each refused face of the qualification, keeps
   the parts as `said`, with the reference that finds the full text in the
   log. The screens say them from the dictionary (`saidText` in
   `apps/web/src/i18n/probe-text.ts`), with the server's words verbatim inside
   our sentence in both languages. Parts without a reference are not such an
   answer, and the text as served renders, as before. The English is one
   sentence on both sides: `scripts/a-sentence-the-screen-and-the-api-word-apart.unit.test.ts`
   fails when either side rewords it.
3. **Dates, times and numbers** — through the shared `Intl` helpers
   (`apps/web/src/i18n/datetime.ts` via `useFormatters()`), keyed on the
   active app locale, never the browser's.
4. **Shared operator prose needed in both languages** — the pattern T1 set
   with `APPLY_FLAG_WARNING_NL`: the Dutch lives BESIDE its English source in
   `@openmig/shared` (same file, updated together or neither), so both
   editions and both languages share one source of truth. This — not a
   client-side translation — is how any future server-authored prose goes
   bilingual. `credential-refusals.ts` is the second and larger application of
   it (workplan 0083): twelve build-time refusals across seven source
   factories, each carrying `en` and `nl` plus the `fields` it names.

   **A refusal we wrote is not a provider's diagnostic, and the difference is
   easy to lose.** Those twelve reached the UI through the same `catch` as a
   real provider error, were labelled `providerRefused`, and so rendered
   verbatim under `nl` — the render-verbatim rule, correctly applied to the
   wrong sentence. `ProbeOutcome` now separates them: `providerRefused` is
   theirs and stays verbatim; `credentialsRefused` is ours and carries the
   pair. When adding server prose, ask **who wrote this sentence** before
   asking which class it is.

   **What a link holder reads is the third application** (workplan 0145 T6).
   A grant link or a progress link is opened by somebody with no account, on a
   page in the language they chose, so the refusals the server writes for
   them have their Dutch beside them in `link-holder-refusals.ts`: the link
   that cannot be used, the *"not ready"* frame and its reasons, the two
   sign-in wrappers, and the callback's refusals. The grant ending's own
   sentences are paired in `google-consent.ts` (`GRANT_ENDING`). The
   withdrawal and report-a-link refusals, and the ending for an unknown or
   expired consent state, are not paired yet (0145 Status). On the wire a pair
   travels as `reason` and `reasonNl` (`message` and `messageNl` for the link
   check), and the page shows the half in its language, or the English as
   served when there is no Dutch half. A failure the server wrote no sentence
   for (no connection, a timeout, an answer the page cannot read) is the
   page's own, from the dictionary (`link.unreachable`, `link.unreadable`),
   and never the transport's English. Inside a pair a finding stays verbatim
   in both halves: the word Google sent back (`access_denied`), the addresses
   somebody signed in with, the operator's own refusal of a callback address.
   The pages the API renders after a provider's consent choose their language
   the same way, from the language the authorize call named, which the server
   records on the pending consent and never reads back from the redirect.

   **A share the new system refused is the fourth** (workplan 0136 T3, a
   share's refusal on apply). On managed, the target's OCS reply is not
   passed on: the address is one a tester typed. The API says a sentence of
   ours, chosen by the status and OCS's code, from `share-refusals.ts`, as
   `reason` and `reasonNl` on `…/sharing/:grantId/decision` and on each
   refused row of `apply-all` and `apply-folder`, each ending with the
   reference the target's words are logged under. The Sharing page shows the
   half in its reader's language: a row's own press under the row, and the
   rows a folder press did not share under the folder, one line per person
   and reason, and again in each row's card (`apply-all` has no caller on the
   page). A refusal of our own gates has no Dutch half. From a folder press
   it is shown in English, marked `lang="en"` under a Dutch page, under the
   folder and in the row's card; a row's own press shows it unmarked. The
   appliance answers with the target's words, as served.

   **The queues' guidance is the fifth** (the owner, 2026-10-18, option A of
   the UX sweep's word choices). *What this means and what you can do* on
   Deletions, Moves and Failures says `QUEUE_GUIDANCE` from
   `packages/shared/src/queue-guidance.ts`: what the rows are and what each
   button does, written for the person reading them, English and Dutch side
   by side, beside the operator's `whatThisMeans` and `howToResolve`, which
   the API keeps serving unchanged. The screen only picks the language
   (`GuidancePanel`). Each option is labelled with the button it is about,
   and `apps/web/src/components/queues/primitives.unit.test.tsx` holds every
   label to the dictionary's word for that button, in both languages.
   ADR-0026 stands: the operator's text stays in the contract.

   **What a decision asks is the sixth** (the owner, 2026-10-18). *Needs
   you* / *Wacht op u* says each decision's sentence from
   `packages/shared/src/decision-words.ts`, built from its category and
   detail, English and Dutch side by side (`decisionSummary`), and a new
   mailbox's button says what pressing it does (`NEW_MAILBOX_ANSWER`). The
   detectors store the English as the decision's `summary`, which the
   notification mail says. **The stored `summary` is now the fallback**: a
   decision these functions cannot say (another category, or a detail
   without an address) shows it as served, marked `lang="en"`, and another
   category's button is its stored proposal, marked the same way. A shared
   address's reason is kept in the detail in both languages (`reason`,
   `reasonNl`) from 2026-10-18 on; an older row is asked without one. The
   line after an answer (`DECISION_EFFECTS`, an action outcome) has no Dutch
   twin yet and stays English, marked `lang="en"` (workplan 0159 §6).
5. **Customer guides** (workplan 0148 T4) — the guides `/docs` serves, written
   for the person who connects an account:
   - documents authored in each language, side by side in `docs/guides/nl/`
     and `docs/guides/en/`, updated together or the missing one listed in
     `TRANSLATION_PENDING` (`apps/web/src/pages/Docs.unit.test.tsx`). A
     guide missing in the reader's language is shown in the other one, under
     one line in the reader's own (`docs.otherLanguage`), with `lang` on the
     article;
   - a provider's screen words in the provider's own words in that language.
     Until 0148 T0 reads the Dutch guides against live's screens, a Dutch
     guide may name a provider's screens by the English names the provider's
     documentation uses, under a line saying the provider shows them in the
     reader's language. Where `strings.ts` already carries the provider's
     Dutch word (*Geautoriseerde omleidings-URI’s*, *Domeinbrede delegatie*,
     *Admin-console*), the guide uses that word, so the screens and the guide
     do not give one control two names;
   - the screens' labels (*Start a migration*, the Accounts page) as
     `strings.ts` has them in that language;
   - a server finding or refusal quoted verbatim, in English, as it is shown.

   The `docs/*-setup.md` files are the operator and self-host documents, in
   English, and are not served (0148 T1).

## Not translated at all: the operator's screens

ADR-0013 makes what a **customer** reads bilingual. What only the platform
operator reads is English only (amended 2026-10-11; the owner, *"for me as
operator English would suffice; multi language is only important for end
users"*):

- **The screens:** the support screens, the access queue, the redirect URIs,
  and their three entries in the menu. Their words are in
  `apps/web/src/i18n/operator-strings.ts`, which has no Dutch, and
  `strings.ts` holds none of them (`operator-strings.unit.test.tsx`). Their
  pages say them through `useOperatorT()`.
- **What is shared on them:** their routes render inside `EnglishOnly`, so a
  dictionary word on such a screen (a button, the log's table, a date) is
  English too, under `lang="en"`, and the page does not turn Dutch halfway.
  The menu around it keeps the app's language; the three entries carry
  `lang="en"`.
- **The mail:** *somebody asked for access* and *money owed back to a
  customer*, to `NOTIFY_TO`, are English whatever `NOTIFY_LOCALE` says.

Not part of it: anything a customer reads, even when an operator writes it.
The hold's sentence is typed by the operator for the organisations and shown
to each in its own language, and the access request page is a stranger's.

## For future prose

Adding a field to the operating contract that a person will read? Decide its
class **in the contract**, at authoring time:

- A finding/diagnostic/gate → one language, rendered verbatim; give the UI a
  stable `code` beside it if screens may want to explain it.
- **The field names inside our own prose are findings even when the sentence
  around them is not.** `clientId`, `OAUTH2_CLIENT_ID` and `DROPBOX_APP_KEY`
  render identically in both languages, because they are the literal thing the
  operator must go and set — translating one names a box that is on no screen,
  which is 0071 T2's defect from the other direction.
- Operator prose that must exist in Dutch → author both languages in
  `@openmig/shared`, adjacent, with the update-both-or-neither comment.
- A screen or mail only the platform operator reads → English only, in
  `operator-strings.ts` (above). "Operator" in the paragraph before means the
  appliance's owner and the person running a migration, who are customers.

Notifications do not exist yet; when they are built, their prose is
day-one-bilingual under the same classes (workplan 0024 T3's transfer note).
