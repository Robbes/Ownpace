# Workplan 0083 — a refusal we wrote is not a provider's error

## Status — 2026-08-18 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 twelve credential refusals had no Dutch at all | ✅ **Fixed 2026-08-18** (owner decision) | Twelve `throw new Error(...)` sites across seven source factories — **twelve, not the eleven recorded earlier; `graph-domain` has three, not two.** They are the most-read prose the server produces (what a person meets on the first attempt at every provider) and the only operator prose with no Dutch. Now bilingual in `@openmig/shared`, the class-4 pattern `APPLY_FLAG_WARNING_NL` set. **In `shared` and not the web dictionary because `apps/selfhost` surfaces the same errors and has no dictionary at all** — a web-side translation would make the appliance permanently English-only for the sentences its owner most needs, which is hard rule 5's exact prohibition. |
| T2 the render-verbatim rule was applied to our own words | ✅ **Fixed 2026-08-18** | **The actual defect, and it is not "no translation existed".** These refusals reached the UI through the same `catch` as a real provider error and were labelled `providerRefused` — the outcome code meaning *this is somebody else's string, render it exactly*. So 0080's correct rule was being applied to sentences **we wrote**: `dropbox source: clientId … are not set` is not Dropbox's error. `ProbeOutcome` now separates them — `providerRefused` stays verbatim, `credentialsRefused` carries the pair — which is 0080's own design applied to a case it had misfiled. Mutation-verified on both sides; the probe half **had no test at all** until the mutation exposed it. |
| T3 the finding stays verbatim in both languages | ✅ **Built 2026-08-18** | `clientId`, `OAUTH2_CLIENT_ID`, `DROPBOX_APP_KEY` render identically in Dutch. They are the literal thing the operator must go and set; a Dutch rendering of `clientId` names a field that exists on no screen — **0071 T2's defect from the other direction**, where a refusal named a database column beside a form with no such box. Pinned per shape: every field name appears in the Dutch sentence too. |
| T4 `message` stays the English it always was | ✅ **Built 2026-08-18** | `CredentialRefusalError.message` is byte-identical to what these factories always threw, so every log line, every existing test and every caller that only knows about `Error` is untouched — 512 orchestration/shared tests passed unchanged. The pair rides on the error rather than a locale being chosen at throw time, because the factory has no idea who reads it: a log on the Spark, a probe panel on a phone, an API response. |
| T5 the appliance sends Dutch and logs English | ✅ **Built 2026-08-18** | A log is evidence — it gets grepped and pasted into an issue by somebody who may not read Dutch — so it stays English always. The **notification** is prose the owner reads, so a credential refusal goes out in `NOTIFY_LOCALE`. Everything that is not one of our refusals still reports verbatim, because `lastError` is a finding and the difference between a 507, a 403 and a parse error is the whole of its value. |
| T6 the two measurements 0082 said were missing | ✅ **Fixed 2026-08-18** (⚠️ lifted — it ran in CI) | The tick now reports its own duration every tick (not sampled — the interesting value is the tail) and warns above 30s of its 60s period. And `PgRateBudget` gets the contention test 0082 called *"the property that would break first"*: twelve real sessions against a bucket of eight, with a pool sized so node-postgres does not quietly queue them. ~~⚠️ No Docker in this session, so it has never executed.~~ **Lifted the same day:** `integration-tests` on PR #440 passed on **both** `ubuntu-24.04` and `ubuntu-24.04-arm`, and this file cannot silently skip — the integration project's glob is `**/*.integration.test.ts`, and the file throws at module scope when `TEST_DATABASE_URL` is unset. A green job therefore means it ran, against real Postgres, on two architectures. **The caveat was about this session's environment, not about CI's**, and I did not check the difference before writing it down. |
| T7 `rate_budget` was invisible to the ORM | ✅ **Fixed 2026-08-18** | Found while writing T6. Migration `0024` created the table and **nothing was added to `schema-pg.ts`** — `PgRateBudget` issues raw SQL, so nothing typed ever referenced it and the omission was invisible until something tried to read the balance it had just spent. A table the ORM cannot see is one nothing else can join, assert on, or notice the loss of. |

## What this is

The owner's decision on where the Dutch should live, carried out — and, in
carrying it out, a better diagnosis than the one the task started from.

The task was recorded as *"these messages have no Dutch"*. That was true and it
was the symptom. The cause is that **they were filed as somebody else's words.**
0080 built exactly the right distinction — our sentences get translated, a
provider's get rendered untouched, because `invalid_client` is the string you
paste into their console — and then a whole class of our own prose arrived
through the provider's channel and inherited the provider's rule. A translation
in the web dictionary would have "fixed" the Dutch while leaving the
misclassification in place, and the appliance still English.

## The generalisable bit

**Ask who wrote the sentence before asking what class it is.** Both 0080 and
this workplan turn on that question, and the answer is not visible from where
the sentence is caught — a refusal we authored and a refusal Dropbox authored
arrive at the same `catch`, as the same `Error` type, and read the same way in
a log. The channel is not the author.

The related habit worth keeping: **a fix that makes something appear in Dutch is
not the same as a fix that makes it ours.** The first is satisfied by any
translation anywhere; only the second survives the next screen that renders it.

## What was found rather than planned

- The count was wrong — twelve, not eleven — which is what happens when a
  number is carried between workplans instead of re-counted.
- The probe half of the wiring had **no test**, and passed a mutation that
  disabled it entirely. It was only caught because both halves were mutated
  rather than the one that looked interesting.
- `rate_budget` existed in Postgres and not in the schema (T7).
- One "does this look Dutch?" heuristic test was **replaced rather than
  widened** after it failed on a short-but-perfectly-Dutch sentence. Widening
  the word list until it passed would have left a check needing an edit every
  time a short refusal is added, catching nothing a reader would not. It now
  strips the verbatim field names and requires the remaining *frame* to differ,
  which is the real property and holds for any vocabulary.

## What is NOT done

- `pg_stat_statements` on the Spark — the third of 0082's three measurements,
  and the one that is an operator action rather than a code change.
- **PgBouncer (0082 T4) still has nothing that can verify it, and now we know
  why.** See below.

## The managed edition has no end-to-end test

Found while working out what the owner's green e2e runs actually covered
(2026-08-18). They ran the gate on both backends — Postgres and PGlite — and
both passed, which is real coverage of the migration chain, the appliance's
boot, and the idempotency property under everything 0082 changed.

What it does **not** touch, and cannot:

| | covered by the e2e gate | why not |
|---|---|---|
| `deploy/selfhost/compose.yml` (appliance) | ✅ both backends | — |
| `deploy/compose/managed.yml` | ❌ never | `e2e.yml` does not reference it at all |
| **PgBouncer** | ❌ | it only exists in `managed.yml` |
| **`PgRateBudget`** | ❌ | reached only via `buildDepsFromMapping`, the managed deps builder; the appliance goes through `runAllDomains` → `buildDeps` |

So the answer to *"why can't CI verify the pooler?"* is not "no Docker in that
session" — it is that **the managed edition has no end-to-end gate at all.**
The unit and integration tiers cover managed code; nothing stands the managed
STACK up. That is a gap in the testing story rather than in any one workplan,
and it is the reason 0082 T4 will stay owner-verified until somebody builds
one.

Not proposed as work here, because it is a real piece of infrastructure and an
owner decision about cost — the managed stack is Trigger.dev plus Postgres plus
Redis plus the API plus the web, and standing all of that up nightly is not
free. Recorded so the next person asking *"is the pooler tested?"* gets the
honest answer in one place.
