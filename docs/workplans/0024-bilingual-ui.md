# Workplan 0024 — the bilingual UI (ADR-0013, kept and being built)

## Status — 2026-08-02 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 The i18n foundation + chrome + the destructive path | ✅ **Done — merged (PR #239, CI green)** | Hand-rolled typed dictionary (`apps/web/src/i18n/` — no i18n framework dependency; two languages and compile-time key parity don't need one): `LocaleProvider` + `useLocale()`/`useT()`, locale persisted (`openmig.locale`), default from `navigator.language` (`nl*` → nl, else en). `Layout` fully localized (nav, heading lookup, Sign out) + an EN/NL switcher in the user section. The destructive path speaks Dutch: `APPLY_FLAG_WARNING_NL` lives ADJACENT to the EN constant in `@openmig/shared` (same file, same source of truth — they cannot drift apart silently) and `ApplyDeletionsPanel` picks by locale. Tests: dictionary key parity EN↔NL (runtime assertion on top of the compile-time type), default-EN, NL via storage, toggle flips + persists, `applyFlagWarning()` selection; the existing panel suite passes unmodified (default locale is EN). |
| T2 The operating screens | 🟡 **First slice built, PR open** | The shared layer speaks Dutch: the queue **primitives** (domain tags, evidence-badge titles, guidance summary, receipt lifecycle prose incl. the `JobFailed` prefix — with REFUSALS deliberately left as the server's verbatim words, rule 2, now pinned by a test), the `QueueScreen` lifecycle note (key-based `LIFECYCLE_NOTE_KEY`), and the **`MappingDetail` hub** (five names + blurbs, fallback title, no-id and degraded-detail messages). All 13 existing web suites pass unmodified (default EN); an NL spot test proves Dutch rendering + the verbatim refusal. Remaining slice: the screen bodies (Deletions/Moves/Failures/Verify/Finish/Confirm labels and messages). |
| T3 Locale-aware dates/times + notifications | ⬜ Not started | `Intl.DateTimeFormat` through one shared helper keyed on the active locale; notification prose (when notifications land — they do not exist yet) bilingual from day one. |
| T4 The server-prose boundary | ⬜ Not started | Decide + document per prose class. The standing rule already decided the hard case: **refusal prose renders VERBATIM** (rule 2/ADR-0024 — the gates' words are the gates' words), so server refusals stay as-served; candidate approach for the rest is code-keyed client-side prose like T1 did for the flag warning. |

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
