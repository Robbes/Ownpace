# Workplan 0068 — what an hour of real testing found, on an Android phone

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the refusals nobody could read | ✅ **Fixed 2026-08-17** | Deleting a connection in use answered **"Request failed with status code 409"**. Rotating with a bad secret answered **400**. Both are `err.message` — axios's transport wrapper — while the server's actual sentence sat unread in `err.response.data`. The helper that reads it, `serverMessage`, **already existed** and was written for exactly this; `Connections.tsx` and five other screens simply never called it. Worse, it only knew one of the two body shapes this API answers with — the routes split 44 `{error, message}` to 24 `{error, reason}`, and **every connections route is in the second group**, so even once called it would have rendered the bare code `in_use`. Both halves fixed, 5 tests, mutation-verified (deleting the `reason` branch fails two of them). |
| T2 the checklist everybody shared | ✅ **Fixed 2026-08-17** | `Layout.tsx` linked the Setup nav to a **hardcoded** `/setup/source/box`, so every tenant's checklist was Box's whatever they were migrating. The owner hit it in under a minute and reasonably asked whether it was demo data. `/setup` now renders a provider chooser and the hardcoded href is gone. |
| T3 the checklist that asked who you are | ✅ **Built 2026-08-17** (owner decision) | A checklist showing seven steps to somebody who can only do four reads as more work than it is. It now asks **"Do you administer this system for your organisation?"** first, and on *no* splits the list into "What you can do yourself" and "What your administrator has to do" — separated, never hidden, because hiding work does not make it go away and somebody still has to chase it. The answer is **per browser, not per tenant**: a step's state is a fact about the tenant that a colleague inherits, but "am I an admin?" is a fact about whoever is looking, and storing it per tenant would let the first person to answer decide what the second one sees. |
| T4 the refusal that explained nothing | ✅ **Fixed 2026-08-17** (owner decision) | With T1 fixed the 409 finally reached the screen — and said only that mailboxes still used the connection. It now answers the three questions the owner actually asked: **why** (deleting it would also delete everything recorded about those migrations, so the next run would start from nothing), **what to do first** (remove the migrations), and **where** (under Migrations). It names them — `"Acme mail"` rather than `3 mailboxes` — because a name is something a person can go and act on. |
| T5 Dutch that read as broken | ✅ **Fixed 2026-08-17** | `'Vul om verder te gaan in:'` — the separable verb *invullen* split around an interpolated field list, so the sentence ended mid-verb before the list. Now `'Nog invullen om verder te gaan:'`, which is plural-safe; the owner's own suggestion works for one field but the list can hold several. |
| T6 internal references on customer screens | ✅ **Fixed 2026-08-17** | The wizard's target panel cited **(ADR-0011)** to a customer, and the hub cited **§20**. Both removed from both locales. |
| T7 the field that followed you between providers | ✅ **Fixed 2026-08-17** | Box's "Client ID" and Dropbox's "App-sleutel" are the same form field underneath, so switching provider carried the value across and presented it under the new provider's label. `clearedSourceFields` resets the provider-specific inputs on a switch. **The bug under the bug:** `sourceConnectionId` survived too, and while the picker only *offers* matching kinds, the create route verified a reused connection's tenant and role — **not its kind**. A Box connection could therefore be attached to a Dropbox mapping and handed to the Dropbox factory. Fixed on both sides: the client clears it, and the route now refuses by name. |
| T8 guides written for the wrong people | ✅ **Fixed 2026-08-17** (owner decision) | Workplan 0063 T5 inlined the repo's own `*-setup.md` into `/docs` so guides could not drift from connectors. That reasoning holds; the **audience** was wrong. The owner read `box-setup.md` on a phone and found ADR citations, workplan numbers, and paragraphs about the appliance that a managed customer will never need. The decision was a lint rather than a second set of documents — a separate guide is exactly the drift 0063 avoided. `end-user-docs.unit.test.tsx` reads the guides through the **page's own import** and bans internal references and edition asides, then pins each guide against `credentialFieldsFor` so a provider gaining a required field fails here rather than in front of a customer at step four. It found 11 real violations across four guides on first run; all four are rewritten. |
| T9 Android | ✅ **Fixed 2026-08-17** | The password manager's overlay covered the bottom buttons with nothing left to scroll to (`pb-24` on small screens), and the Connections action row was a nowrap flex that pushed its last button off-screen (`flex-wrap`, and `ml-auto` only from `sm:`). |
| T10 what is still open | ⛔ | (a) **The wizard still loses everything on navigation**, which blocked the owner's reuse test. Not persisting half-typed *secrets* is deliberate and stays; the name, schedule and checkboxes could persist safely and would have unblocked them. (b) **A created-then-vanished migration is unexplained.** The owner created one with false credentials, saw a confirm page, navigated away, and could not find it. With T1 fixed the next attempt will say something; until it is reproduced this is a report, not a diagnosis. (c) The 500 on create now returns a **reference id** matching the log line, but there is no correlation id on any other route. (d) Probe *results* are still English in a Dutch UI — our framing should be localised while the provider's own text (Google's `invalid_client` JSON) stays verbatim, since that is the string you paste into their console. Not done here; it needs the probe to return a key plus data rather than a finished sentence. |

## What this is

An hour of the owner testing the merged build on a real phone, and it found more than the
last three test suites did — including two defects with a shipped-and-invisible shape.

The pattern worth keeping: **every one of T1, T2, T5 and T7 was invisible to the tests
because the tests asserted the thing worked, not the thing a person would see.** The delete
refusal had two passing tests proving the server refuses and names the migrations; nobody
asserted the sentence reaches a screen. The Setup checklist had five passing tests; none of
them clicked the nav. The reuse picker had a round-trip test over connection kinds; none of
them switched provider afterwards.

The one to take seriously is T1, because it is the second time this exact shape has appeared.
`serverMessage` exists **because** an earlier screen rendered a wrapper and discarded the
server's sentence — its own doc comment says so. A new screen was then written that did the
same thing, next to the helper, in the same directory. A helper is not a guarantee; only a
test that reads what the person reads is. The `serverMessage` tests added here are that, and
they are mutation-verified.

T8 is the honest correction. "Keep the guides in-repo so they cannot drift" was right and is
unchanged. "Therefore serve the developer's copy to the customer" did not follow, and I never
noticed the leap because I was the wrong reader for it.
