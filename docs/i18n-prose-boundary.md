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
| **Failure diagnostics** | `lastError` | Evidence, not copy (hard rule 9). The difference between a 507, a 403 and a parse error is the only thing that tells an operator whether `retry` has any chance of working; summarising or translating it removes exactly that. |
| **Operating guidance** | `whatThisMeans`, `howToResolve` | These ARE the operating semantics, deliberately authored once in `@openmig/shared` so the two editions cannot drift (ADR-0026). A web-side translation would fork them per language — the one thing the shared contract exists to prevent. If Dutch guidance is ever wanted, it is built the shared-package way (below), not translated in the client. |
| **Action outcomes** | `effect`, `ifYouNeedToResume` | Written (in the contract, on purpose) to be read verbatim by the person who just clicked. |
| **Verification findings** | `issues[].message`, `recommendations` | Findings about this run, same footing as `lastError`. |
| **Verdict + evidence vocabulary** | `PASS`/`WARN`/`FAIL`/`SKIPPED`/`NOT_VERIFIABLE`; `reported`/`trashed`/`inferred`; mapping status words | Server vocabulary an operator may need to quote in a support thread or grep in a log. The WORD stays; its *explanation* is class 2 below. |

## Classes the client localizes

1. **Client-authored copy** — titles, intros, buttons, empty states, table
   headers, plurals: the typed dictionary (`apps/web/src/i18n/strings.ts`,
   compile-time key parity EN↔NL).
2. **Explanations keyed off stable codes/enums** — lifecycle notes keyed on
   the mapping-status enum, hover help on verdict words, hover titles on
   evidence badges. The server's token is the handle; the localized prose
   sits beside it. This is the sanctioned path if client-side explanation of
   refusal `code`s is ever wanted — the `reason` still renders as served.
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
5. **Customer guides** (workplan 0148 T4) — the guides `/docs` serves, written
   for the person who connects an account:
   - documents authored in each language, side by side in `docs/guides/nl/`
     and `docs/guides/en/`, updated together or the missing one listed in
     `TRANSLATION_PENDING` (`apps/web/src/pages/Docs.unit.test.tsx`). A
     guide missing in the reader's language is shown in the other one, under
     one line in the reader's own (`docs.otherLanguage`), with `lang` on the
     article;
   - a provider's screen words in the provider's own words in that language;
   - the wizard's labels as `strings.ts` has them in that language;
   - a server finding or refusal quoted verbatim, in English, as it is shown.

   The `docs/*-setup.md` files are the operator and self-host documents, in
   English, and are not served (0148 T1).

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

Notifications do not exist yet; when they are built, their prose is
day-one-bilingual under the same classes (workplan 0024 T3's transfer note).
