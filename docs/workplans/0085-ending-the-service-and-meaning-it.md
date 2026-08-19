# Workplan 0085 — ending the service, and meaning it

## Status — 2026-08-18 (update this block at the end of every session)

**Nearly complete (2026-08-18, continued 2026-08-19).** T1–T8 are done.
**T9 is the only task left, and it is a decision rather than an implementation**
— see "T9: what forget means on self-host" below. Owner decisions recorded below, including the backup
retention window — **7 days** — which T5 was blocked on.

| Task | Status | Notes |
|---|---|---|
| T1 the delete that already exists is dangerous | ✅ **Fixed 2026-08-18** | `DELETE /api/tenants/:tenantId` exists now (`routes/tenants/index.ts`), is owner-only, and does a hard `DELETE FROM tenant` that **cascades twenty-five tables** — `invoice` and `audit_log` among them. No confirmation, no grace, no receipt, no revocation, and nothing that says it happened. **This is the most urgent row in the workplan and it is a removal, not an addition:** the current endpoint should refuse before the staged flow replaces it, rather than sitting there as an unguarded one-call purge of a customer's billing history. |
| T2 close → grace → purge, customer picks the window | ✅ **Built 2026-08-18** (owner decision) | Closing stops syncs and billing **immediately** and the account goes read-only. The purge runs after a window the customer chooses at close time: **immediate, 7, 30 or 90 days**. Four windows means four states to test, and `immediate` is the one that needs the type-the-name confirmation — it has no window in which to catch a mistake or a bug. |
| T3 what survives: invoices, detached, plus an erasure record | ✅ **Built 2026-08-18** (owner decision) | Invoices and payment records survive **detached from the tenant** — company name, VAT id, amount, date; nothing about what was migrated. This is the GDPR art. 17(3)(b) carve-out: Dutch tax law wants invoices for years, and "erase everything" would put the operator in breach of a different law than the one they were trying to obey. Needs a schema change — the `ON DELETE CASCADE` from `invoice` to `tenant` is exactly what must not fire. |
| T4a a credential that is forgotten but still works is not forgotten | ✅ **Built 2026-08-18** | **The task was not what it looked like.** It read as "call revoke on each provider"; the useful work was finding out that **most of these providers have no revocation we can call**. Google has one and it is implemented (`HttpTokenRevoker`, revoking the REFRESH token because revoking an access token leaves the thing that mints more of them untouched). Microsoft publishes **no** OAuth revocation endpoint — consent withdrawal is the customer's or their admin's. Dropbox's revoke call disables the access token presented with it, not the app link. Box CCG mints short-lived tokens from OUR secret, so there is no customer credential in play. Everything else authenticates with a password only its owner can change. So the outcome for most kinds is `unsupported` **with the reason**, and the receipt says that rather than implying a revocation happened: **a row of green ticks, four-fifths of them nothing, would be worse than no revocation at all, because it would stop the customer doing the one thing that works.** An unknown kind defaults to `unsupported`, never to silence. Revocation runs BEFORE the purge (it needs the rows the purge deletes) and OUTSIDE its transaction (network calls must not hold one open), and is **never** a reason to refuse an erasure — a provider being down records `failed` and the purge proceeds. This and T4b are two halves of one honest sentence: we revoked what we could, deleted our copy of the rest, and here is what only you can remove. |
| T4b the grant only THEY can remove | ✅ **Built 2026-08-18**, **widened 2026-08-18** (owner's findings) | Revoking a token is not withdrawing a consent. `standing-grants.ts` names the four provider consoles bilingually, for the kinds a tenant actually used, keyed on BOTH vocabularies so the reminder cannot silently never fire. **Widened after the owner's second finding** — *"they just need to be reminded … and not leave credentials wandering around"*. The original list excluded password kinds on the reasoning that an IMAP connection has *"no consent object sitting in a console"*. **Half right, and the wrong half was load-bearing:** there is no consent object, but there is very often a **credential** object — an app password we deleted our copy of that still authenticates. Same risk, different screen. `CREDENTIAL_RETIREMENTS` now covers every password-shaped kind, with a coverage-lock test so a kind added to the schema without an entry fails rather than going silently unmentioned. Where we can name the screen (Nextcloud, Proton) we do; where we cannot — a generic IMAP or WebDAV account belongs to a provider we do not know — we name **what to look for** ("app password", "application-specific password"), because the customer knows who their provider is and that is the half they cannot supply. Saying nothing rather than something imprecise would leave a working credential in place. `accessThatOutlivesErasure()` merges both, **credentials first**: a consent is a permission sitting unused, a live app password is a working way in. Surfaced at CLOSE (the API response) and at FINISH (the completion report, now with a "Passwords that still work" section above "Permissions you granted"). A test that asserted an IMAP migration says nothing was **replaced, not widened** — its premise was the gap. |
| T5 backups are not covered by a DELETE | ✅ **Built 2026-08-18** (owner decision) | **Retention is 7 days** (owner, 2026-08-18), and the wording is the split the owner asked for: removed from the live service on the day the chosen window runs out, gone from backups a further 7 days after that. `packages/shared/src/erasure-timeline.ts` is the pure calculation plus the bilingual sentence; `BACKUP_RETENTION_DAYS` makes the number a deployment property, because a self-hoster with monthly tapes would otherwise promise something untrue on our authority. **The window is measured from the PURGE, not from the close** — a backup taken the hour before the purge is the last one that can contain anything and has its full retention still to run; dating it from the close would promise a date that arrives while the data is still restorable (mutation-verified: anchoring it to the close fails four tests). Migration 0026 records both the number and the derived date on `erasure_record`, because the retention can change and the date the customer was given cannot. A zero-retention deployment gets its own sentence rather than the same date twice. **What this does not claim:** that backups are scrubbed — nobody surgically edits a backup; they expire, and the wording says so. |
| T6 what erasure must NEVER touch | ✅ **Built 2026-08-19** | `packages/shared/src/erasure-scope.ts` — the source and the target, bilingual, structured so each surface can place them. **The opener does the real work:** it names the ambiguity (*"delete my data" here means our data about you — not your own data*) instead of hoping the reader resolves it correctly, because two of the three readings a person can plausibly take are wrong and both wrong ones are frightening. The target entry is the longer of the two on purpose — that is the reading that costs something, so it says the copies **stay**, that closing does not reach into the new mailbox, and that what we erase is our RECORD of the move and not the copies themselves. Surfaced at **close** (the moment of decision) and on the **`DELETE` refusal** (the other way somebody tries to end the relationship). There is no close UI to put it in yet — 0086 T1 is that front door — so the API response is the surface that exists, and per the T4a gap below, close is the delivery point anyway: at purge time the tenant row is gone and there is nobody left to tell. Tests pin **meaning, not phrasing** — both sides present, the target explicitly not reached into, record distinguished from copies — because the failure to guard against is a rewrite that quietly drops one reassurance, not a typo. Five mutations, all caught. |
| T7 a purge that cannot be proven did not happen | ✅ **Built 2026-08-18** | An integration test that seeds a tenant across every one of the 25 cascading tables, purges, and asserts **table by table** what is gone and what remains. Not a count — a named list, for the same reason 0081's guard names each stray 500. Plus a receipt the customer can keep. |
| T8 mid-flight erasure is a duplication hazard | ✅ **Finished 2026-08-19** | `item` IS the idempotency ledger, so purging under a live pass re-copies everything **into the leaving customer's target**. The skip enforced that and nothing here weakens it. What was missing was the other direction: the skip was unconditional, so a row saying `running` after a worker was killed blocked the purge on every hourly attempt **for ever**, past the date T5 promised, with a warning nobody reads. **A row saying `running` is a claim by a process that may no longer exist**, so it is no longer taken at its word. `orchestratorRef` is now recorded (`ctx.run.id` — it was left unset as *"wire it when the v4 task model lands"*, and v4 is what we run), which makes the question answerable at all. `quiescePlan` decides from what the orchestrator says: **finished** rows are landed with the reason on the row and the purge proceeds; **live** ones are asked to stop and waited for; **anything we could not ask about blocks**. That last one is the asymmetry the whole design rests on — duplicating a leaving customer's mailbox is a data incident they experience, an erasure running late is a broken promise that is visible and recoverable, so *not knowing is not permission*, and it is reported as `needsAttention` rather than as ordinary waiting. Liveness is identified **positively in both directions** with anything unrecognised falling through to blocking, because reading `isCompleted` alone would be a guess and if it meant "succeeded" a failed run would block for ever — the exact bug being fixed. Close now asks in-flight passes to stop (active quiescing) but deliberately does **not** land their rows: a cancellation is a request, and landing a row while the pass is still mid-write is precisely the state that duplicates. Six mutations, including flipping the unknown verdict to allow purging, all caught. |
| T9 what "forget" means on self-host | ⬜ **Planned** | Hard rule 5 says the editions must not differ, but here they genuinely do: on the appliance the operator owns the disk, and erasure is `docker compose down -v`. The honest answer is probably a documented procedure plus the same revocation helper, not a UI. **Decide it rather than inherit it.** |

## The gap T4a leaves, named rather than discovered later

The revocation outcomes are recorded in `erasure_record` and warned about in the
purge log. **They are not delivered to the customer**, and with today's design
they cannot be: the purge runs after the window expires, by which point the
tenant row is gone and there is nobody left to authenticate. So the person who
most needs the sentence *"we could not revoke this one — go and withdraw it
yourself"* is the one person who cannot currently read it.

`revocationSummaryText()` exists, bilingual, ready for whoever wires the
delivery. The options are an email at purge time to an address captured at
close, or telling the customer at CLOSE what will and will not be revocable —
which is knowable then, because the capability table is a function of the
connection kinds they already have.

**The second is probably right**, and it is a decision rather than a task: it
means the close response, not the erasure record, is where this belongs, and
the erasure record becomes the evidence rather than the notification. Left open
deliberately instead of guessed at.

## What this is

The owner's requirement: *"someone needs to be able to end the service and we
delete their data."* Two things, and they are not the same thing — ending the
service is a commercial act, erasing the data is a legal one, and the second
must not be the silent side effect of the first.

Scoping it turned up that a hard delete **already exists and is live**. That
reframes the work: this is not "build erasure", it is "replace an unguarded
purge with a defensible one", and the ordering matters because the unguarded one
is reachable today by any tenant owner with a session.

## Decisions already taken (owner, 2026-08-18)

| Question | Answer |
|---|---|
| What survives? | Invoices + payment records, detached, plus a minimal tamper-evident erasure record |
| How does it run? | Staged: close → grace → purge, **with the customer choosing the window** (immediate / 7 / 30 / 90 days) |

## The thing most likely to go wrong

Not the purge. **The erasure record.**

It has to prove an erasure happened without re-creating the personal data it
erased — and the obvious implementation, "keep the tenant id and the email of
whoever asked", is a record *of a person*, which is the thing we just promised
to delete. It also has to survive the purge it describes, which means it cannot
live in a table that cascades from `tenant`.

The likely shape is: a one-way hash of the tenant identifier, the timestamps,
the chosen window, the retained invoice numbers, and the revocation outcomes —
enough to answer *"did you erase tenant X when you said you would?"* to an
auditor holding X, and useless to anybody who is not.

This needs an ADR, because it is a decision about what we deliberately keep
about people who asked to be forgotten, and a future reader will want the
reasoning and not just the schema.

## A bug that reached CI, and the guard it bought

The `billed_to_name` column was added to `schema-pg.ts` with an anchored
replace whose anchor — `tenantId … references(…)` followed by `periodStart` —
**matches two tables**. It landed on `usage_metric`, which is defined first;
`invoice` was never touched.

Every unit test passed. PGlite runs the real migrations, so the *database* was
right, and nothing in the unit tier inserts into `usage_metric` through
Drizzle. It failed in the integration tier, on a table nobody had edited.

That is the worst shape available: **the two halves of one change drift, and
the tests that would notice are the ones nobody thought to run.** The same
anchored-replace mistake had already happened once this session (Dutch strings
landing in the English block, 0083) and once before it (0071 T2's note about a
replace matching the wrong occurrence). Being more careful is not a fix for a
mistake that recurs.

So `schema-matches-migrations.unit.test.ts` compares the ORM's column names
against the migrated database's, both directions, in the unit tier. It found
two pre-existing undeclared columns immediately — `item.item_type` and
`connection.encrypted_credentials` — both real, both used, and both allow-listed
**with reasons** rather than declared, because each carries a decision worth
making on its own:

- declaring `item_type` would let `recordFailure` use `ON CONFLICT DO UPDATE`
  instead of UPDATE-then-INSERT — an improvement, and a behaviour change;
- declaring `encrypted_credentials` would make it appear in every `select()` on
  `connection`, and several call sites select the whole row. The failure mode is
  credential disclosure in an API response.

## A second CI failure, and what it was really about

The close route returned 500 in the integration tier while every unit test
passed. The cause was a comment of mine that reasoned confidently and
backwards:

> *Deliberately NOT inside `withTenantDb`: closing writes the erasure record,
> which has no tenant column to be scoped by and must outlive the tenant.*

`erasure_record` outliving the tenant is about **the absence of a foreign
key**, not about which transaction writes it — it has no RLS policies, so
writing it inside a tenant transaction is unrestricted. Meanwhile `tenant` is
`FORCE ROW LEVEL SECURITY` with an UPDATE policy on `app.current_tenant`, and
the API connects as `app_user`. Outside the context the UPDATE matched **zero
rows**, and close correctly reported a tenant that does not exist.

**Why no unit test caught it:** `offboarding.unit.test.ts` drives PGlite as the
owner, where Postgres skips row security. Every offboarding assertion was made
in a world where RLS does not apply, about code that only ever runs in a world
where it does. `offboarding-under-rls.unit.test.ts` now drives the same
functions as `app_user` through `withTenant`, which is the arrangement
`rls-in-force.unit.test.ts` established for exactly this reason.

Two smaller things fell out of it:

- A first attempt "fixed" this as a missing GRANT. It was not — the baseline's
  `ALTER DEFAULT PRIVILEGES` already grants all four on every new table, so the
  narrower GRANT changed nothing. **A grant cannot take away what default
  privileges already gave**, so denying the request path DELETE on
  `erasure_record` needs an explicit `REVOKE` — which is worth having, since a
  request path that can delete an erasure record can erase the evidence that it
  erased something.
- The "fails without the tenant context" test was written and then **removed**:
  under that arrangement the UPDATE aborts the transaction rather than
  returning zero rows, so the test asserted Postgres's error semantics and
  poisoned the connection for whatever ran next. The route-level property is
  pinned where it belongs — the integration test that calls `POST /close` and
  expects 200.

## What is NOT in scope here

- **Per-user erasure inside a tenant.** This is tenant-level offboarding. An
  individual member asking to be forgotten while the tenant continues is a
  different and harder problem.
- **Erasure at the target.** Never ours to do (T6).
- **Automatic erasure on non-payment.** Ending the service for non-payment is a
  commercial policy that does not exist yet, and wiring it to a purge before
  the policy exists would be the worst possible order to build it in.
