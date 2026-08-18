# Workplan 0079 — a 500 that does not answer with the bug

## Status — 2026-08-19 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 ten routes handed their internals to the browser | ✅ **Fixed 2026-08-19** | They answered `{ error: 'list_failed', reason: String(error) }`. A driver failure stringifies to something that can carry a **connection string, a query or a host** — and the create route had already stopped doing exactly this, with a comment saying why (workplan 0068). Ten other places went on doing it: `setup` ×2, `connections` ×4, `migrations` ×4. `serverFault()` replaces all of them; no `String(error)` remains in any route. Mutation-verified — putting `String(error)` back fails all four tests, including one that plants a DSN with a password in the error and asserts it never reaches the body. |
| T2 0068 T10c, finally applied everywhere | ✅ **Done 2026-08-19** | 0068 T10c recorded that the create route's 500 returns a reference matching its log line *and no other route does*. Reference `e133a809` is the only reason that 500 was ever diagnosed rather than guessed at, so the asymmetry mattered: every other fault was a red box with nothing to quote. The same reference now goes on every fault the helper serves, and a test pins that the log line and the body carry the **same** one — a reference that does not match the log is worse than none, because it looks like it should work. |
| T3 the sentence says whose fault it is | ✅ **Done 2026-08-19** | *"…this is a fault on our side, not something your input caused."* A 500 that reads like a refusal sends somebody hunting through their own input for a mistake they did not make. That wording came from the create route and is now what every fault says. |

| T4 a credential that fails is kept, and now says so | ✅ **Fixed 2026-08-19** | `POST /connections` stores a credential that does not work *yet* on purpose — somebody mid-setup waiting on an administrator should not lose it (0063 T4). The wizard showed only the provider's refusal, so the storing was invisible, and the reasonable inference from a red panel is that nothing was saved and the whole form has to be retyped. That is the opposite of what happened. Recorded as 0069 T7c and closed here because it is the same idea as the rest of this workplan: **a thing the code did, that the screen did not say.** Shown only where there is something of ours saved — `draftConnection[side]` is set by the add/rotate path and never by the read-only probe of a connection already being reused, and a test pins that distinction. |

## What this is

A finding that surfaced while looking for something else — 0068 T10c asked only for
correlation ids on the other routes, and the routes turned out to have a worse problem than
the one being fixed.

The shape is one this project keeps meeting: **a rule written down in the place it was
learned, and nowhere else.** `serverMessage` existed and five screens did not call it (0068
T1). The credential descriptor existed and the wizard did not read it (0075). Here, the
create route learned in 0068 not to stringify an error into a response, wrote the reason in
a comment beside itself, and ten sibling routes kept the old habit — not out of
carelessness, but because a comment protects the file it is in and nothing else.

The generalisable bit: when a fix comes with a *reason*, the reason is usually broader than
the fix. Worth asking, each time, "where else is this true?" — the answer here was ten
places, and one of them could have put a database password on a phone screen.

## What is NOT done — ✅ **done in workplan 0081**

`billing`, `tenants`, `decisions`, `shared-addresses`, `permissions` and
`migrations/operating-routes` still have ~43 `res.status(500)` sites between them. **None of
them leaks `String(error)`** — that was the whole of the defect and it is closed. What they
lack is the reference id, which is a smaller loss and a much larger diff; they are left for
a pass that can be reviewed on its own rather than smuggled in behind a security fix.

**Closed 2026-08-18 by workplan 0081**, and with one correction to this workplan's own
record: T2 above says the reference *"now goes on every fault the helper serves"*, which was
true and read as a broader claim than it was — the helper served eleven of fifty-four sites.
0081 converts the rest and replaces this paragraph with a test, because a paragraph saying
what is not done cannot tell when it becomes untrue.
