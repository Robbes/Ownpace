# Workplan 0075 — one order, the one the descriptor declares

## Status — 2026-08-19 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the source step asked in two groups | ✅ **Fixed 2026-08-19** | The wizard rendered a hand-written block per provider holding its config, then a shared blue **Credentials** panel bolted on after it holding the account, the secret and the refresh token. On a Drive source the order a person met was *Client ID → Root folder ID → Service account key → Source Username → Source client secret → Refresh token*: **the three values that come from one page of the Google console, separated by two fields belonging to neither.** The owner reported it three rounds running (0071 T4, 0072 T5, 0073 T4). The step now renders from `credentialFieldsFor('source', type)`, which has declared the right order since 0063 and which this file had never read. **463 lines of JSX out, 239 in.** |
| T2 the red asterisks disagreed with the gate | ✅ **Fixed 2026-08-19** | On the Google sources, Client ID and Refresh token were marked required unconditionally, while `sideStepMissing` stops requiring them the moment a service-account key is pasted (ADR-0033's either-flow). So the screen went on demanding two fields Next no longer wanted — the mirror image of 0067's *Next names a field that is not there*, and just as confusing. `sourceFieldRequiredNow()` is the same condition the gate uses, in one place. |
| T3 the presentation lived in four files | ✅ **Built 2026-08-19** | Placeholders, hints, autocomplete, which secret gets a reveal toggle, and which field survives a reused connection were all facts about a provider's fields expressed as hand-written JSX. They now sit on the descriptor beside `key`/`labelKey`/`required` — so a provider gains a field in ONE place, and the wizard and the Connections page can no longer disagree about what Dropbox asks for. `revealable` is deliberately not "every secret": a masked password is worth proofreading after a paste, while an eye icon beside a refresh token or a pasted key file only widens the shoulder-surfing window. |

## How this was done, which matters more than what it did

**Every one of the 45 existing wizard tests passes unchanged.** That was the guardrail set
before the first edit, and it is the whole reason this refactor was safe to attempt:

> Do the refactor. If any *existing* wizard test needs its assertions changed, stop and fall
> back to reordering the JSX by hand. Test changes limited to *adding* new ones.

Workplan 0070 T6 records what happens otherwise — a previous session rewrote this file's
tests to match its edits, broke a test that had already started passing, and the whole
change was reverted. A refactor that preserves every placeholder, label, hint and
required-ness is one the suite can actually check; a refactor that rewrites the suite is one
nobody can.

The new tests assert **order**, because order was the defect: that the OAuth trio is
contiguous, that the account comes first, that the per-mapping "where" fields come after the
credentials. Mutation-verified — moving `USER` back down the Google list fails the Drive
case alone.

## What this leaves

The descriptor is now the single answer to *what does this provider ask for, in what order,
looking like what*. Two doors read it (the wizard's source step, the Connections add/rotate
form) and a third still does not: **the wizard's TARGET step**, deliberately untouched here
to halve the blast radius of one change. It is the obvious next application, and it is
smaller than this one was — every target speaks the same four fields.
