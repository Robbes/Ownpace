# Workplan 0080 — whose words are these

## Status — 2026-08-19 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the probe says whose words it carries | ✅ **Built 2026-08-19** | The owner met *Connected. 12 folders visible.* in a Dutch UI and reported it (0068 T10d). **The naive fix — translate the probe result — is wrong**, and the reason is the whole design: half of what a probe returns is the PROVIDER's. When Dropbox answers `invalid_client`, that string is the one you paste into their console, and a Dutch rendering of it would be a Dutch rendering of somebody else's identifier (rule 9, `docs/i18n-prose-boundary.md`). `ProbeOutcome` makes the split explicit: our answers carry a **code and their data**, and `providerRefused` says the accompanying sentence is theirs. `detail`/`reason` stay populated either way — the appliance has no dictionary, and an API consumer should not have to build sentences to read an answer. |
| T2 the contract lives where both ends can see it | ✅ **Built 2026-08-19** | In `@openmig/shared`, not in `orchestration`: the probe writes it and the web reads it, and a contract with a copy on each side is a contract that drifts. That is the same reasoning that put the credential descriptor there (0063) and the same failure 0075 was still paying off. |
| T3 `t()` learned interpolation | ✅ **Built 2026-08-19** | It had none, so a sentence with values in it had to be concatenated from fragments at the call site — which bakes **English word order into the concatenation**. *The server at {url} answered {status}* and *De server op {url} antwoordde {status}* do not put those values in the same places, and no care at the call site fixes that: the ordering belongs to the sentence, so it belongs to the dictionary. A placeholder with no value is left visible rather than blanked — a stray `{count}` on screen is a bug report, an empty gap is a mystery. |
| T4 the rule that matters most | ✅ **Locked 2026-08-19** | **A provider's refusal renders untouched, in either language.** Mutation-verified: making `providerRefused` return a dictionary sentence fails both tests that assert it. A result with no outcome at all — an older API, a cached response, a route not taught yet — also falls through to what arrived, so this can never render *less* than it did before. |
| T5 a leak 0079 missed | ✅ **Fixed 2026-08-19** | `connections.ts` still answered `reason: String(error)` on the test route. 0079 claimed every site; the verification grep was `grep -v test`, which filters **lines**, not files — and that line reads `error: 'test_failed'`, so it hid itself from its own check. The lesson is about the check, not the code: a filter written to exclude test *files* silently excluded a real finding, and the count looked right. Now excluded by path (`\.test\.ts`), and the site uses `serverFault` like its ten siblings. |

## What is NOT done, and why it is a decision rather than an omission

The eleven `throw new Error(...)` in the source factories — *"dropbox source: clientId,
clientSecret, refreshToken are not set. A Dropbox migration authenticates as the account
that consented…"* — are **ours**, arrive through the provider channel, and therefore still
render in English.

Fixing that means giving those throws a type the probe can recognise, so it can emit a code
instead of passing the message through as if a provider had said it. That is eleven
factories, and it carries a real design question rather than just work:

**Where should that Dutch live?** The web dictionary is where every frame in workplans
0071–0080 went. But `apps/selfhost` surfaces these same factory errors and has **no
dictionary at all** — so putting the guidance in the web app means the appliance keeps only
English, and hard rule 5 says the two editions should not differ. The prose boundary's
class 4 (`APPLY_FLAG_WARNING_NL`) exists for exactly this shape: author both languages in
`shared`, beside each other, updated together or neither.

That is a recommendation, not a decision I should make while the owner is not looking at it.

## What this is

The last of the 0068 findings, and the one that took longest to become buildable — not
because it is hard, but because the obvious version of it is wrong in a way that only shows
up later. A product that translates the provider's own error text is a product where the
support answer *"paste that string into their console"* stops working, and nobody would
notice until somebody tried.

The general rule this leaves: **before translating a sentence, ask who wrote it.** The two
halves arriving through one channel is what made this a contract change rather than a string
edit, and it is why 0068 T10d said so in the first place.
