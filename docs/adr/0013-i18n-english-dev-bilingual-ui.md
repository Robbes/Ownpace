# ADR-0013: English for development; bilingual (EN+NL) end-user UI

- **Status:** Accepted
- **Date:** 2026-06-20

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **English** for code, comments, docs and ADRs; the end-user UI is **bilingual EN+NL** (built: typed dictionary in `@openmig/shared`, `Intl` formatting keyed on app locale).
- The prose boundary (docs/i18n-prose-boundary.md): **translate the frame, never the finding** — server refusal prose renders verbatim, untranslated.

> **Update 2026-08-02 (workplan 0021 T5, owner decision: keep + build).** The
> bilingual promise had zero i18n behind it for the project's whole life —
> Dutch existed only in the cutover comms templates. Kept, and the build is
> **workplan 0024**: T1 (the typed EN/NL dictionary + LocaleProvider, the
> localized chrome with a WCAG-compliant language switcher, and the
> destructive-path warning in both languages — the Dutch living BESIDE its
> English source in @openmig/shared so they cannot drift apart) is built;
> T2 (the operating screens), T3 (locale-aware dates + notifications) and
> T4 (the server-prose boundary) follow there. One boundary is already
> decided: server REFUSAL prose renders verbatim (rule 2/ADR-0024) and is
> deliberately not translated.
>
> **Update 2026-08-02 (later the same day): built.** All four tasks landed —
> T2 made every operating screen bilingual (five slices), T3 routed dates,
> times and numbers through shared `Intl` helpers keyed on the app locale
> (retiring `date-fns`), and T4 drew the full server-prose boundary per
> class in **`docs/i18n-prose-boundary.md`** — the rule in one line:
> *translate the frame, never the finding.* Notifications still do not
> exist; when built, their prose is day-one-bilingual under those classes.

## Context
The project is built with coding agents and may attract international contributors; the initial end-user audience is Dutch and English speaking.

## Decision
**English** is the language for code, comments, documentation and ADRs. The **end-user UI and interaction are bilingual: English + Dutch** (full i18n, locale-aware formatting, bilingual notifications and cutover comms templates).

## Consequences
- Lower contributor barrier; consistent docs.
- UI must be built i18n-first; copy maintained in EN + NL.

## Alternatives considered
- Dutch-first: rejected — limits contribution and reuse.
