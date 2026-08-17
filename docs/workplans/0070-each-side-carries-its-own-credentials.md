# Workplan 0070 — each side carries its own credentials

> ## ⚠️ THIS COMMIT IS DELIBERATELY INCOMPLETE
>
> **8 tests fail**, all in `apps/web/src/pages/CreateMapping.unit.test.tsx`, and they are
> listed by name in T5 below. Typecheck and lint are clean; 2756 of 2764 unit tests pass.
>
> It is on the branch at the owner's explicit instruction, so the next session can continue
> from git rather than from a patch file in an ephemeral scratchpad. **Do not open a pull
> request from this commit as it stands.**

## Status — 2026-08-17 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the shape | ✅ **Built 2026-08-17** | The owner's words: *pick provider, enter credentials, test, saved — then one step to finalise between two connections.* Six steps become four — `source`, `target`, `migration`, `review`. Each side is now self-contained, which is what 0069's test-and-save was missing: a side you can finish is a side you can save. |
| T2 credentials move to their own side | ✅ **Built 2026-08-17** | `renderSourceCredentials()` / `renderTargetCredentials()` render on the step that owns them and collapse to nothing when a stored connection is chosen. They used to share a step two screens later, which is why 0067 found the reuse picker unreachable and why testing could not save — by the time you could prove a credential, the wizard had already asked for the other side's. |
| T3 one probe per side | ✅ **Built 2026-08-17** | `runProbe(side)` replaces the both-sides-at-once probe. Probing the target from the source step would report on credentials the person has not been asked for yet, and a red panel about a field two screens away is worse than no panel. A side already reusing a stored connection gets the plain read-only check, and says so. |
| T4 one gate per step, from one list | ✅ **Built 2026-08-17** | `sideStepMissing(side)` drives both `canProceed` and `missingFields` for both sides. This is the third time this file's gates have been the defect — 0037 T1, then 0067 T1/T2 — and every time the cause was two switch statements agreeing by hand until somebody added a provider to one of them. One list per step, or it happens again. |
| T5 the tests, NOT done | ⛔ **8 failing, by name** | `the credential inputs carry autocomplete attributes and a show/hide toggle` · `garbage cron blocks Next with the reason; a valid one echoes its next runs` · `selecting Graph swaps host/port for tenant + client ID, explains the model, and gates by name` · `a graph mapping gates on the client secret and submits the app registration, not a host` · `selecting Google Drive pins the file domain, keeps a file-capable target, and walks to submit` · `domains beyond file are not offerable for a Drive source` · `selecting Gmail pins the email domain, keeps a mail-capable target, and walks to submit` · `domains beyond email are not offerable for a Gmail source`. All eight encode the old six-step flow: they click Next a fixed number of times and reach for fields by position. The dominant error is `Unable to find placeholder jmap.example.com` — Next no longer advances from the source step, because that step now also demands the account and the provider's secret, so they never reach the target. |
| T6 how the last attempt went wrong | ⚠️ **Recorded, because it matters** | I tried to finish T5 with regex passes across the test file and **broke a test that had already started passing** — 7 failing went back to 8. That is what triggered a full revert of this work. Bulk pattern-matching does not converge on this file. Rewrite each of the eight walks by hand: read what the test asserts, then rewrite its navigation. Some of the mechanical edits already in this commit are of that dubious vintage and are worth redoing rather than patching further. |
| T7 the guard that had to keep working | ✅ **Fixed before committing 2026-08-17** | 0069's `NEVER writes a secret into session storage` was among the failures — not because a secret leaked, but because it could no longer reach the step it tests. **A security test that cannot run protects nothing**, so it was rewritten for the new flow before this was committed: it now types into every masked input on BOTH sides and still asserts on the stored payload. It passes. The other eight are fixtures; this one was the guard, and the difference is the reason it was not left for later. |

## The flow a walk now takes

1. **Source** — pick provider, fill its config *and* its credentials (account + secret, plus a refresh token where the provider needs one), Next.
2. **Target** — pick protocol, host, account, password, Next.
3. **Migration** — name, data types (usually preselected by the source), schedule (empty = the default cadence), Next.
4. **Review** — submit.

## What this is

The restructure 0069 implied and did not do.

Workplan 0069 made testing the moment that saves a credential, which was right — but it left the credentials themselves two steps from the provider they belong to, so a person still could not *finish a side*. This puts each side's question, answer and proof in one place, and leaves one step for what is true of the migration rather than of either system.

The honest note is T6. The source changes here are done and typecheck clean; the test suite describing a six-step wizard is not, and the failing tests are **correct to fail** — the component's contract genuinely changed. Fix the fixtures to describe the new flow; never loosen an assertion to make one pass.
