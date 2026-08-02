# Workplan 0024 — the bilingual UI (ADR-0013, kept and being built)

## Status — 2026-08-02 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The i18n foundation + chrome + the destructive path | ✅ **Done — merged (PR #239, CI green)** | Hand-rolled typed dictionary (`apps/web/src/i18n/` — no i18n framework dependency; two languages and compile-time key parity don't need one): `LocaleProvider` + `useLocale()`/`useT()`, locale persisted (`openmig.locale`), default from `navigator.language` (`nl*` → nl, else en). `Layout` fully localized (nav, heading lookup, Sign out) + an EN/NL switcher in the user section. The destructive path speaks Dutch: `APPLY_FLAG_WARNING_NL` lives ADJACENT to the EN constant in `@openmig/shared` (same file, same source of truth — they cannot drift apart silently) and `ApplyDeletionsPanel` picks by locale. Tests: dictionary key parity EN↔NL (runtime assertion on top of the compile-time type), default-EN, NL via storage, toggle flips + persists, `applyFlagWarning()` selection; the existing panel suite passes unmodified (default locale is EN). |
| T2 The operating screens | ✅ **Done — merged in five slices (PRs #241, #242, #243, #244, #245 — all CI green)** | Slice 1 (#241): the queue **primitives** (domain tags, evidence-badge titles, guidance summary, receipt lifecycle prose incl. the `JobFailed` prefix — with REFUSALS deliberately left as the server's verbatim words, rule 2, pinned by a test), the `QueueScreen` lifecycle note (key-based `LIFECYCLE_NOTE_KEY`), and the **`MappingDetail` hub** (five names + blurbs, fallback title, no-id and degraded-detail messages). Slice 2 (#242): **Moves and Failures bodies** — titles, intros, section headings (shared `queue.waitingOnYou`/`queue.alreadyDecided` keys), empty states, action labels (keep/retry/accept) and the try/tries plural, `lastError` + guidance verbatim. Slice 3 (#243): the **Deletions body** — headings, empty states, keep label, the destructive button's label + armed label, the transport-failure fallback; refusal words and `whatThisMeans` verbatim. Slice 4 (#244): **Confirm and Verify bodies** — Confirm's full client surface (server error messages verbatim) and Verify's: status hover-help ×5 (the status WORD stays server vocabulary), shared `domain.*` labels, checksum-cell fragments, not-measured + title, banners, all seven table headers, buttons, hints, error messages — `issues[].message`/`recommendations` verbatim. Slice 5 (#245): the **Finish body** — the whole five-step checklist (lifecycle notes, step titles/bodies, queue-count link phrases, the pass-state trio, step 4's warning + attestation checkbox, step 5's nothing-changes framing, the force button, the finish button + disabled title, unknown-mapping/read-error messages, the left-unmigrated plural) — refusal `error`/`hint`, `effect`, `ifYouNeedToResume` verbatim. **Every screen T2 names is bilingual; every slice kept all pre-existing web suites passing unmodified (default EN).** |
| T3 Locale-aware dates/times + notifications | ✅ **Done — merged (PR #246, CI green; the lint failure on the first push was the root typecheck sweeping `.ts` files without `--jsx` — fixed by keeping `datetime.ts` pure functions and moving the `useFormatters()` hook into `index.tsx`)** | One shared helper, `apps/web/src/i18n/datetime.ts`, keyed on the ACTIVE locale (not the browser's): `formatRelativeToNow` (`Intl.RelativeTimeFormat`, largest-fitting-unit, `numeric: 'auto'` so "yesterday"/"gisteren" come out right), `formatDateTime` (`Intl.DateTimeFormat`, medium date + short time), `formatNumber` (`Intl.NumberFormat` — en `1,234` vs nl `1.234`), and a `useFormatters()` hook with the same documented English fallback outside a provider that `useLocale()` has. Wired everywhere a date or count renders: Dashboard + Mappings "last sync" relative times (plus their `Last sync:`/`Never` labels, the only strings sitting inside the date expression — the REST of those two admin screens is still EN-only and is called out below), Verify's five count cells (previously `toLocaleString()`, i.e. silently the BROWSER's locale — now the app's), and Verify's running state now shows "Running since {time}" from the `startedAt` the async rewrite stored but never rendered. **`date-fns` left the dependency list** — its one caller was `formatDistanceToNow`, which `Intl.RelativeTimeFormat` replaces in both our languages for free. Notifications half: nothing to build — notifications still do not exist; the day-one-bilingual requirement transfers to whatever plan builds them. Tests: 8 new (both languages, unit ladder, `numeric: 'auto'`, ISO-string input, absolute-format language split, number separators, hook binding + un-provided fallback); suites pin injected `now` + `timeZone: 'UTC'` so they are time/place independent. Typecheck + lint clean, 1273/1273 unit tests. **Deliberately left EN-only: the body prose of Dashboard/Mappings** (stats cards, table headers, empty states — legacy admin screens outside T2's named list); localizing them is a candidate T5 if wanted. |
| T4 The server-prose boundary | ✅ **Done — merged (PR #247, CI green)** | **`docs/i18n-prose-boundary.md`** — the rule in one line: *translate the frame, never the finding.* Verbatim classes (with the why per class): refusals (`code`/`reason`, `error`/`hint` — test-pinned), failure diagnostics (`lastError`, hard rule 9), operating guidance (`whatThisMeans`/`howToResolve` — they ARE the contract's semantics; a web-side translation would fork what ADR-0026 exists to keep single), action outcomes (`effect`/`ifYouNeedToResume`), verification findings (`issues[].message`/`recommendations`), and the verdict/evidence vocabulary (the WORD stays; its explanation may localize). Localized classes: client-authored copy (the typed dictionary), explanations keyed off stable codes/enums (beside, never instead of, the server's word), dates/times/numbers (T3's helpers), and shared operator prose needed in both languages via the `@openmig/shared` NL-beside-EN pattern (T1's flag warning) — the sanctioned route for any future bilingual server prose, never a client-side translation layer. Includes an authoring-time rule for future contract fields. Indexed in `docs/README.md`; ADR-0013 update note records the whole plan as built. |

## Why this exists

Owner decision 2026-08-02 (workplan 0021 T5): ADR-0013's bilingual EN+NL
promise is **kept**. The initial end-user audience is Dutch- and
English-speaking; the SAD (§5, §23) has promised an accessible bilingual UI
since v1.0, and until this plan there was zero i18n in `apps/web` — Dutch
existed only in the cutover comms templates.

## Decisions that shape the build

- **No i18n framework.** Two locales, one app, compile-time key parity via a
  `Record<keyof typeof en, string>` type — react-i18next would add a
  dependency to solve problems (plurals across many languages, lazy loading,
  ICU) this product does not have. Revisit if a third language ever lands.
- **Shared prose stays in `@openmig/shared`, NL beside EN.** ADR-0026's rule
  is that operator prose must not drift between editions; the same rule
  applies between languages, so `APPLY_FLAG_WARNING_NL` sits next to its EN
  source in the same file rather than in a web-app dictionary.
- **Server refusal prose is NOT translated.** Rule 2/ADR-0024: the gates'
  code + prose render verbatim. A translation layer between a refusal and
  the operator is drift by design; the `code` field is the stable handle if
  client-side explanation is ever wanted (T4's question, not T1's).
- **Locale is a client concern.** Persisted per browser; no server state, no
  per-tenant setting (a per-member preference could join the managed edition
  later — deliberately out of scope now).

## Hard rules that bite here

- **Rule 2/ADR-0024:** refusals verbatim — translation must never touch the
  gates' words.
- **ADR-0026:** one contract, both editions — shared prose lives in shared,
  in both languages, or the editions drift language-by-language.
- **WCAG 2.2 AA (§23):** the switcher is a real button pair with text
  labels, not an icon-only control.
