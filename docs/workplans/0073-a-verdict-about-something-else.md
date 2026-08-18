# Workplan 0073 — a verdict about something else

## Status — 2026-08-19 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 a probe verdict outlived its credential | ✅ **Fixed 2026-08-19** | `setProbeResults` was only ever added to — nothing retired a result. So the green *the credentials still work* from the connection you tested stayed on screen after you picked a **different** connection from the picker, and after you switched **provider entirely**: the owner watched a Dropbox verdict sit above a different source type. That is worse than no verdict — it is a verdict about something else, on the one button whose whole job is to be trustworthy. `forgetProbe(side)` is now called where the SUBJECT changes (provider switch, target protocol switch, either picker), deliberately not from an effect: `runProbe` sets `sourceConnectionId` itself when a probe saves, and an effect keyed on that would wipe the result it had just earned. Mutation-verified — stubbing `forgetProbe` to a no-op fails both new tests by name. |
| T2 Delete was unreachable on a phone | ✅ **Fixed 2026-08-19** | `Mappings.tsx` wrapped a five-column `whitespace-nowrap` table in `overflow-hidden`. On Android the table is wider than the viewport and the overflow was **clipped with no way to scroll to it**, so the actions column — Delete included — could not be touched at all. The owner reported not finding the button; it was rendered the whole time, two hundred pixels past the edge. `overflow-x-auto`. **Every existing test passed throughout**, because jsdom renders a button whether or not a human could reach it — the same blind spot as 0068 T9, which was this exact defect in a flex row. |
| T3 rotation asks for values it already has | ✅ **Answered and fixed 2026-08-19 — workplan 0078** (the owner chose config-only prefill; what that deliberately does NOT cover is 0078 T2) | Opening *Inloggegevens vervangen* presents every field empty, so rotating a Dropbox credential means re-typing the App key that has not changed. Two different fixes hide behind that, and only the first is free: (a) values stored in `connection.config` — Box's user id, a target's host and port, Dropbox's root path — are **not secret and not encrypted**, and could be returned and prefilled today; (b) the App key, the account name and O365's client id live in the **encrypted credential record**, so prefilling those means returning part of a decrypted credential. An OAuth client id is an identifier rather than a secret, and `credential-fields.ts` already says so (`secret: false`) — but this route's stated posture is *SECRETS NEVER COME BACK OUT*, and narrowing that sentence is the owner's call, not a display tweak. **The question: may non-secret identifiers be read back out of a stored connection so a rotation only asks for what actually changed?** |
| T4 the blue credentials panel | ✅ **Fixed 2026-08-19 — see workplan 0075** | Confirmed three rounds running, and fixed by making the source step render from the descriptor that has declared the right order since 0063. 463 lines of hand-written JSX out, 239 in, and all 45 existing wizard tests pass unchanged. |
| T5 a connection you cannot name | ✅ **Fixed 2026-08-19 — workplan 0076** | Unchanged. |

## What this is

The round after the reuse path started working — and the first two findings are both the
same species as 0072's, one layer out.

0072 was *a screen that stopped asking for values, still being driven by them*. T1 here is
**a screen that kept showing an answer after the question changed**, and T2 is **a control
that exists but cannot be touched**. In all three the code is confident and the person is
misled, and in all three the tests passed the entire time — because a test asserts what
the DOM contains, and none of these defects is about what the DOM contains. One is about
what a string still *means* after state moves under it; one is about whether a rendered
node is within reach of a thumb.

T2 is the second time this exact thing has shipped (0068 T9 was the Connections row). The
pin added here is weak by construction — jsdom has no layout, so it can only assert the
container permits overflow — and it is in the file anyway, because the alternative is
nothing and the defect has now cost the owner two testing sessions.
