# Workplan 0076 — a connection you can name

## Status — 2026-08-19 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the name is asked for where the answer is known | ✅ **Built 2026-08-19** (owner request) | Testing is what SAVES a credential (0069 T2), and it saved under an auto-name — `dropbox · anna@acme.example` — with no chance to say what it was for and no rename afterwards (0069 T7b). The owner asked for the name **at the moment of testing**, which is exactly when they know the answer; asking later would mean asking on a screen they have no reason to open. The field sits in the probe panel, is **optional**, and falls back to the same auto-name it always used — a name is an improvement on the old behaviour, not a new obligation at the end of a long form. It disappears when a stored connection is being reused, because then there is nothing of ours to save and so nothing to name. |
| T2 two connections, one name | ✅ **Warned 2026-08-19** | The owner met two connections carrying the identical auto-name and said it plainly: *that is asking for issues*. It now says so at the moment of creation, from the list the wizard already holds. **A warning, not a refusal**, and that is a decision rather than laziness: nothing keys off `display_name`, two connections may legitimately share one, and blocking the save would be friction at the worst possible moment — you have just proved a credential and the next thing the product would do is refuse to keep it. What a name is FOR is telling two things apart, so the honest move is to say when it has stopped doing that, and let the person decide. |
| T3 the reachability tests were order-dependent | ✅ **Fixed 2026-08-19** | Found while writing T1's tests: `CreateMapping.reachability.unit.test.tsx` had no `sessionStorage.clear()`, so every test in it inherited whatever the previous one typed. The file predates the draft feature (0069) and nothing had yet typed enough for it to matter — the first test that set a provider AND a name is what surfaced it, by failing in the suite and passing alone. That is 0069 T6's lesson arriving a second time in a second file, so the clear is file-level rather than per-describe: a draft outlives a describe block too. |

## What this is

The smallest of the open items, and the one the owner asked for in their own words.

The interesting part is T2, because the obvious implementation is the wrong one. A unique
constraint on `display_name` would be easy, would look rigorous, and would refuse a save at
the exact moment somebody has finally got a credential working — turning a naming nicety
into a wall in front of the expensive thing. Nothing in the product keys off the name; the
cost of a duplicate is entirely "I cannot tell these apart later", which is a cost the
person is better placed to judge than the schema is. So it warns, in the reader's own
language, and saves anyway.

T3 is the free finding that comes with writing tests for a stateful screen: a test file that
passes only in a particular order is not passing, it is agreeing.
