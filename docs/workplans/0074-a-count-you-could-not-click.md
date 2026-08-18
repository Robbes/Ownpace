# Workplan 0074 — a count you could not click, and a provider nobody could name

## Status — 2026-08-19 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the setup checklist named a key, not a provider | ✅ **Fixed 2026-08-19** | `Setup.tsx` rendered `data.provider` — the wizard type — as its heading, in its admin question and as every card in the chooser. So an operator was told to go and configure **`oauth2`**, and the owner asked the question that makes it obvious: *how should a user guess that is for Entra ID?* `providerDisplayName()` lives beside the field descriptor in `@openmig/shared`, for the reason the descriptor lives there: these are the PROVIDER's vocabulary, identical in every language, and must not drift between the doors that show them. The Microsoft pair is named for the product an admin buys — *Microsoft 365 (OAuth2)* / *(Microsoft Graph)* — because they differ by transport and nobody arrives thinking "I need the OAuth2 one". A coverage lock fails when a type has no name. **The test found a third site I had missed** (the admin question), which is why it asserts on both. |
| T2 back went somewhere you had never been | ✅ **Fixed 2026-08-19** | The checklist's back link was a hardcoded *← Back to the migration wizard*. Reaching it from **Connections** — which links there by design since 0065 — therefore sent you into a wizard you had not opened. The two linking screens now say where they are (`state={{ from }}`) and the checklist honours it; a direct URL still defaults to the wizard, because that is where most people arrive from and a bookmark has no origin to honour. |
| T3 a count you could not click | ✅ **Fixed 2026-08-19** | The dashboard's five tiles counted the lifecycle states and were plain `<div>`s. The only interesting follow-up to *3 paused* is *which three*, and the screen had no way to say — the owner asked why they were not clickable. Each tile is now the filtered list it counts, via `/mappings?status=…`. The filter is a **URL** rather than component state so it survives a refresh and can be shared, and it renders a visible, clearable banner: a list quietly showing a subset is how somebody comes to report a missing migration. An unknown status filters to **nothing** rather than silently showing everything — an empty list under a named filter is an answer; a full list under a filter that did not apply is a lie. |

## What this is

The three findings from the third phone round that were plain UX rather than defects —
picked up while the deeper ones (the blue credentials panel, naming a connection) wait for
a session with the owner awake.

They share a shape worth naming, and it is not "polish". Each was a screen that **knew the
answer and would not say it**: the checklist knew which provider it was describing and
printed the key instead; the back link knew there was a way back and hardcoded the wrong
one; the tiles knew exactly which migrations they had counted and dropped the list on the
floor. None of them is a missing feature. All three are a fact the code already held,
withheld from the person in front of it.

The lock in T1 is the durable part: `providerDisplayNamesCoverEveryType()` means the next
provider added to the descriptor cannot reach a screen as a bare key.
