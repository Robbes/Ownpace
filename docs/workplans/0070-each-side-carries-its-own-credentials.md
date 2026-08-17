# Workplan 0070 — each side carries its own credentials

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the shape | ✅ **Built 2026-08-17** | The owner's words: *pick provider, enter credentials, test, saved — then one step to finalise between two connections.* Six steps become four — `source`, `target`, `migration`, `review`. Each side is now self-contained, which is what 0069's test-and-save was missing: a side you can finish is a side you can save. |
| T2 credentials move to their own side | ✅ **Built 2026-08-17** | `renderSourceCredentials()` / `renderTargetCredentials()` render on the step that owns them and collapse to nothing when a stored connection is chosen. They used to share a step two screens later, which is why 0067 found the reuse picker unreachable and why testing could not save — by the time you could prove a credential, the wizard had already asked for the other side's. |
| T3 one probe per side | ✅ **Built 2026-08-17** | `runProbe(side)` replaces the both-sides-at-once probe. Probing the target from the source step would report on credentials the person has not been asked for yet, and a red panel about a field two screens away is worse than no panel. A side already reusing a stored connection gets the plain read-only check, and says so. |
| T4 one gate per step, from one list | ✅ **Built 2026-08-17** | `sideStepMissing(side)` drives both `canProceed` and `missingFields` for both sides. This is the third time this file's gates have been the defect — 0037 T1, then 0067 T1/T2 — and every time the cause was two switch statements agreeing by hand until somebody added a provider to one of them. One list per step, or it happens again. |
| T5 the tests | ✅ **Green 2026-08-17** | All eight rewritten by hand, one walk at a time, and **2764 of 2764 unit tests pass**. Each now describes where its fields actually are: the credential-attribute test asserts the same pair on each side's own step instead of expecting two of everything on one; the Graph walk keeps gating after the tenant and client id, because the account and the client secret gate there too; the cron walk stops clicking through steps that no longer exist. Two assertions got *stronger* rather than looser — the Drive and Gmail walks used to hand their fields to `satisfySourceStep()` and then assert on values it had overwritten, so they typed the credentials they check and now pin what is actually posted. |
| T5a two defects the fixtures were hiding | ✅ **Fixed 2026-08-17** | Rewriting the walks surfaced source bugs, not just stale fixtures. **(a)** The migration step's JSX was mis-closed: a `);` left mid-element made the schedule block a sibling of the data types and compiled **two literal `");"` text nodes onto the page** — visible to anyone using the wizard, and invisible to every test, because no test asserted on the step's text. **(b)** `blockedReason()` returned the domain refusal *or null* before it ever reached the cron branch. That was harmless while data types and the schedule were separate steps; sharing one step, a valid domain answered on a broken cron's behalf and Next went back to being disabled and silent — the exact defect 0037 T3 exists to prevent. Both are the "dubious vintage" T6 warns about, and both were redone rather than patched. |
| T6 how the last attempt went wrong | ⚠️ **Recorded, because it matters** | The attempt before this one tried to finish T5 with regex passes across the test file and **broke a test that had already started passing** — 7 failing went back to 8. That is what triggered a full revert of this work. Bulk pattern-matching does not converge on this file. The walks were finished by hand instead, one at a time: read what the test asserts, then rewrite its navigation. T5a is what that found; a regex pass would have found neither. |
| T7 the guard that had to keep working | ✅ **Fixed before committing 2026-08-17** | 0069's `NEVER writes a secret into session storage` was among the failures — not because a secret leaked, but because it could no longer reach the step it tests. **A security test that cannot run protects nothing**, so it was rewritten for the new flow before this was committed: it now types into every masked input on BOTH sides and still asserts on the stored payload. It passes. The other eight are fixtures; this one was the guard, and the difference is the reason it was not left for later. |

## The flow a walk now takes

1. **Source** — pick provider, fill its config *and* its credentials (account + secret, plus a refresh token where the provider needs one), Next.
2. **Target** — pick protocol, host, account, password, Next.
3. **Migration** — name, data types (usually preselected by the source), schedule (empty = the default cadence), Next.
4. **Review** — submit.

## What this is

The restructure 0069 implied and did not do.

Workplan 0069 made testing the moment that saves a credential, which was right — but it left the credentials themselves two steps from the provider they belong to, so a person still could not *finish a side*. This puts each side's question, answer and proof in one place, and leaves one step for what is true of the migration rather than of either system.

The honest note is T6. The eight tests that failed on the WIP commit were **correct to fail** — they described a six-step wizard that no longer exists — and they were rewritten to describe the new flow rather than loosened to accept it. T5a is the reason that distinction is worth the extra work: two of the failures were only *mostly* stale fixtures, and hand-rewriting the walks is what separated "this test is out of date" from "this test is out of date and the code beneath it is wrong."
