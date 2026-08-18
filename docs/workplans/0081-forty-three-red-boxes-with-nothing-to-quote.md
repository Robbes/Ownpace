# Workplan 0081 — forty-three red boxes with nothing to quote

## Status — 2026-08-18 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the pass 0079 deferred, done | ✅ **Fixed 2026-08-18** | `billing`, `tenants`, `tenants/members`, `decisions`, `shared-addresses`, `permissions`, `migrations/index`, `migrations/operating-routes`, `billing/webhooks`, the auth middleware and the app's own unhandled-error handler answered `{ error: 'Internal server error', message: 'Failed to list mappings' }` — **safe, and undiagnosable**. 43 sites now go through `serverFault`, plus the 19 call sites of `operating-routes`' own `serverError` helper, which was the same body behind one function. Three `res.status(500)` remain in `apps/api/src`: the helper itself and two deliberate exceptions (T3). |
| T2 the create route stops being the exception | ✅ **Done 2026-08-18** | 0068 T10c gave the create route a reference by hand, and 0079 T2 claimed *"the same reference now goes on every fault the helper serves"* — true, and the helper served eleven of fifty-four. Create's hand-rolled block is deleted; it now calls the helper like everything else, so the wording can never drift between the one route somebody debugged and the rest. `randomUUID` and `log` fell out of four files as unused imports, which is the honest measure of how much of their logging existed only on the 500 path. |
| T3 two 500s that must NOT carry a reference | ✅ **Decided 2026-08-18** | `AuthNotConfiguredError` names the environment variable an operator has to set; the Mollie branch says the API key is not configured. **Their message is the fix.** Replacing it with *"something went wrong on our side, quote reference 1a2b3c4d"* would swap the only actionable sentence for a lookup in a log the operator is trying to get the server to start writing. They are named in an allow-list with the reason beside each, so a third one is a deliberate edit rather than drift. |
| T4 the check is a test, because the grep was the bug | ✅ **Built 2026-08-18** | 0079's verification was `grep -v test` — which filters **lines, not files** — and the line it needed to catch reads `error: 'test_failed'`, so the finding hid inside the filter meant to exclude test files, and the count looked right. `every-500-carries-a-reference.unit.test.ts` walks the source tree, excludes test files **by path**, and asserts the stray list is empty *by naming each site*, not by counting. It also asserts the sweep is not silently empty, since a walk that finds nothing passes an is-empty test perfectly. Mutation-verified: putting one hand-rolled 500 back into `decisions.ts` fails it, naming the file and line. |
| T5 the web fixtures stop modelling a body the API no longer sends | ✅ **Fixed 2026-08-18** | `Mappings.unit.test.tsx` built `{ error: 'Internal server error', message }`. Those tests would have gone on passing untouched, because `serverMessage` reads `message` first and `reason` second — so the fixture could stay wrong forever while proving nothing about the real answer. Both now carry the real `{error, reason}` shape, and both assert the **reference** is on screen, which is the part that has to survive. |
| T6 each operating queue names itself | ✅ **Fixed 2026-08-18** (owner decision) | The first cut gave all 19 `operating-routes` sites one shared `operating_failed`, on the grounds that the old body gave all 19 the identical `'Internal server error'` so it was no regression. Raised as an open question on PR #438 and answered: **each queue names itself.** The reasoning holds up better than the shortcut did — those 19 routes serve six queues, and a caller that cannot tell *the deletions queue would not load* from *the verification report would not assemble* is back where this workplan started. Naming them also surfaced something the shared code was hiding: **three routes answered the byte-identical sentence _recording the decision_** — deletions-keep, moves-keep and failures-action — and two more each said _queuing the removal_ and _reading the removal receipt_ for the deletion and the relocation paths alike. So `what` is now distinct per route too, which is the half a person actually reads. Pinned by a test that asserts all 19 codes differ and reports **which** collided, because the way this regresses is a copy-pasted catch block. Mutation-verified: pointing moves-keep at the deletions-keep code fails it, naming `deletion_keep_failed`. |

## What this is

The pass 0079 wrote down and left, done as its own reviewable diff — which is why it was
left: a security fix and a 43-site mechanical sweep do not belong in one review.

The defect is not a leak. Not one of these sites handed anything internal to a browser;
0079 closed that entirely. What they did was answer *Failed to list mappings* — a sentence
with no handle on it. The owner meets a red box on a phone; the stack is in a log on the
Spark; and nothing in the box says which of the day's requests it was.

The measure of what that costs is already in the record: **reference `e133a809` is the only
reason the create-route 500 was diagnosed rather than guessed at** (0071 T6). That
reference existed because one route had been fixed by hand, in 0068, after the owner hit it.
Every other fault in the API was still the version of that bug that had not been met yet.

## The generalisable bit

0079 ended by asking "where else is this true?" and answered it for the leak. The same
question had a second answer it did not chase, and the reason it did not is worth keeping:
**the leak was scary and the missing reference was merely expensive**, so the scary one got
the pass and the expensive one got a paragraph. A paragraph in a workplan is not a check.

Hence T4. The rule this leaves behind: **when a workplan records what is NOT done, the thing
that stops it drifting is a test, not the paragraph.** The paragraph explains; the test
holds. This one holds by naming what it found, because a check that reports a number is a
check you cannot debug when it goes red.

And T5 is the small version of the same idea. A fixture written to mimic a server is a
second copy of that server's contract, and it does not fail when the original changes — it
just quietly stops describing anything. The only thing that catches it is asserting the part
that would actually be missing.
