# Workplan 0085 — ending the service, and meaning it

> **In one line:** Tenant offboarding: close, grace window and purge replacing the cascading tenant DELETE, detached invoices and an `erasure_record`, token revocation also on connection delete, standing-grant reminders, backup retention wording and self-host `forget-me`.

## Status — 2026-09-28 (update this block at the end of every session)

**2026-09-28: a closed organisation kept syncing. It no longer does (T2).**

- **The owner's report.** Closing an organisation did not stop later sync
  passes, so the stored access kept being used until the purge, up to 90 days
  later. That broke the alpha conditions (`site/legal/alpha.md` §10, *"If you
  close your account, nothing uses it from then on, and it is destroyed when
  your data is erased"*, and `alpha.nl.md`) and T2's own row below.
- **Why.** `closeTenant` set `tenant.status` to `closed` and nothing that
  starts work read it. The tick chose migrations by their own status. A pass
  already queued, or a retry, read only the migration's phases. No door
  refused. The close cancels only runs whose rows say `running` or `queued`,
  and a pass has a row only once a runner starts it (nothing writes `queued`),
  so a pass the tick queued just before the close, or a retry, was out of its
  reach.
- **The owner's two answers.** On the design: *"Read tenant status
  (Recommended)"*. The tick and the doors read `tenant.status`; the close does
  not pause the migrations; a reopen needs no migration code, and the next tick
  resumes. On how far read-only goes: *"Every write door (Recommended)"*.
  Everything that starts a pass, re-arms one, or uses the stored access is
  refused. Reading, export, the reopen and the erasure stay open.
- **What was built.**
  - *The tick.* `ACTIVE_MAPPINGS_SQL` asks `AN_OPEN_ORGANISATION_WHERE`
    (`packages/ledger/src/organisation-open.ts`) over all three of its branches:
    active or continuous, a cutover in its grace period, a data type kept in the
    lane.
  - *The pass.* A new halt, `organisation_closed`, read in the same
    transaction as the migration's phases and before them. It comes before any
    credential is built, ends the pass without an error (so no retry), and is
    said in the run log and in a cutover's final sync.
  - *The builders.* Both credential builders refuse a closed organisation before
    any decrypt (`refuseAClosedOrganisation`), which covers discovery,
    verification, confirmation, both applies and the cutover gate. The fan-out
    that opens a verification's, a confirmation's and a gate's targets leaves
    out a data type it cannot open; the close's refusal it passes up
    (`target-fan-out.ts`), so none of them records a verdict of nothing for a
    closed organisation.
  - *The doors.* One reader, `readOrganisationClosure` in
    `packages/managed/src/offboarding.ts`, under row security. `enqueueUnlessHeld`
    asks it before the hold, so all eight enqueueing doors refuse. Every other
    write door on the owner's list asks it itself (`closed-organisation.ts`):
    creating a migration, a PUT into the continuous lane, adding, resuming or
    keeping a data type, adding, testing or re-keying a connection, the
    permission report, the sharing rescan and the share applies, a grant link's
    page and consent, the consent's callback (before the code exchange), and
    the grant ending (in its own transaction: no token stored, no withdrawal
    lifted, the link not spent). Start and Sync now ask it before the
    migration's own state, so a migration the close left running is refused
    too. The answer is 409 `account_closed` with a sentence in English and
    Dutch that names the day of the close and the day the data is removed.
    Never in `authenticate`: the owner reopens through it.
  - *The spec and the docs.* `AccountClosed` in `apps/api/docs/openapi.yaml` on
    every such door; `docs/operator-runbook.md`, Tenant offboarding, says what
    stops and what stays open, and its table now names `windowDays`,
    `canReopenUntil`, `passesStopped`, `outlivingAccess` and `neverTouched`.
- **The guards.** `apps/worker/src/jobs/a-closed-organisation-gets-no-pass.unit.test.ts`
  (the tick and the pass, on one set of rows, closed and reopened),
  `apps/api/src/an-organisation-closed-at-every-door.unit.test.ts` (every door
  closed through the owner's Close; every door but two open, and reopened
  through the real `authenticate`; the spec; a grant arriving after the close)
  and
  `packages/orchestration/src/a-closed-organisation-is-read-by-nobody.integration.test.ts`
  (both builders and a verification's fan-out, nothing decrypted). All three
  failed before the fix. The two doors the door guard presses only closed are
  applying one share and applying every open share: pressed open on PGlite's
  one connection, they wait for themselves.
  `a-share-waits-for-its-own-cutover.integration.test.ts` presses both open,
  over Postgres. Applying one folder's shares is pressed open without a
  folder, so there it reaches only its own 400.
- **Review fixes, the same day.** Rebased on #1302 and #1303: the permission
  report asks the close on the pool its reads already use. Start and Sync now
  ask the close first; before, Start on a migration the close left running
  answered 200, and a paused one answered with its own state. The fan-out
  passes the close's refusal up (above); before, a verification queued before
  the close finished as a report of nothing but NOT_VERIFIABLE, still the
  latest after a reopen. The door guard now also counts, per file, every call
  that uses the stored access, and a file that makes one asks the close or
  says why it need not, so a new use fails until its door is looked at;
  before, it caught a check taken out and not one never written. The sentence itself has a test
  of its own (`packages/shared/src/a-reopen-offered-only-while-it-can-happen.unit.test.ts`):
  the reopen is offered only while the removal is ahead, in both languages.
- **Not changed.** What a close does to billing was not examined here. Links
  can still be issued for a closed organisation's migrations; a grant link is
  refused where it is used. The wizard's probes of credentials typed into it,
  which store nothing, are not refused.

**Complete (2026-08-18, finished 2026-08-19).** T1–T9 are done. T9 was a
decision as much as a task; the owner chose option A (a documented procedure
plus the revocation helper, not a UI) and it is built.

**A defect found while building T9, worth reading before the table.** Extracting
T4a's revocation so both editions could share it exposed that it had never
worked. It read `connection.encrypted_credentials` — a real column, from the
baseline, never dropped — but **nothing has written to it for a long time**:
every write path stores `secret_ref`, and so does every read on the live sync
side. So it found NULL on every row and recorded *"No credentials were stored
for this connection."* For every connection. Always. Google's revocation is the
one that genuinely withdraws a token and it never ran, while the erasure record
told the customer there had been nothing to revoke.

That is the failure T4a was written to avoid, with the sign flipped. Its own
argument was that *"a row of green ticks, four-fifths of them nothing, would be
worse than no revocation at all, because it would stop the customer doing the
one thing that works"* — and a false "nothing to do" stops them just as
effectively, and is harder to doubt. Both columns are read now, `secret_ref`
first. Owner decisions recorded below, including the backup
retention window — **7 days** — which T5 was blocked on.

| Task | Status | Notes |
|---|---|---|
| T1 the delete that already exists is dangerous | ✅ **Fixed 2026-08-18** | `DELETE /api/tenants/:tenantId` exists now (`routes/tenants/index.ts`), is owner-only, and does a hard `DELETE FROM tenant` that **cascades twenty-five tables** — `invoice` and `audit_log` among them. No confirmation, no grace, no receipt, no revocation, and nothing that says it happened. **This is the most urgent row in the workplan and it is a removal, not an addition:** the current endpoint should refuse before the staged flow replaces it, rather than sitting there as an unguarded one-call purge of a customer's billing history. |
| T2 close → grace → purge, customer picks the window | ✅ **Built 2026-08-18** (owner decision); **syncs stopped 2026-09-28** | Closing stops syncs and billing **immediately** and the account goes read-only. **2026-09-28: the syncs half was not true until then** (Status above): the tick, a queued pass and every door went on. Now nothing starts and nothing uses the access, every write door answers `account_closed`, and reading stays open. The purge runs after a window the customer chooses at close time: **immediate, 7, 30 or 90 days**. Four windows means four states to test, and `immediate` is the one that needs the type-the-name confirmation — it has no window in which to catch a mistake or a bug. |
| T3 what survives: invoices, detached, plus an erasure record | ✅ **Built 2026-08-18** (owner decision) | Invoices and payment records survive **detached from the tenant** — company name, VAT id, amount, date; nothing about what was migrated. This is the GDPR art. 17(3)(b) carve-out: Dutch tax law wants invoices for years, and "erase everything" would put the operator in breach of a different law than the one they were trying to obey. Needs a schema change — the `ON DELETE CASCADE` from `invoice` to `tenant` is exactly what must not fire. |
| T4a a credential that is forgotten but still works is not forgotten | ✅ **Built 2026-08-18** | **The task was not what it looked like.** It read as "call revoke on each provider"; the useful work was finding out that **most of these providers have no revocation we can call**. Google has one and it is implemented (`HttpTokenRevoker`, revoking the REFRESH token because revoking an access token leaves the thing that mints more of them untouched). Microsoft publishes **no** OAuth revocation endpoint — consent withdrawal is the customer's or their admin's. Dropbox's revoke call disables the access token presented with it, not the app link. Box CCG mints short-lived tokens from OUR secret, so there is no customer credential in play. Everything else authenticates with a password only its owner can change. So the outcome for most kinds is `unsupported` **with the reason**, and the receipt says that rather than implying a revocation happened: **a row of green ticks, four-fifths of them nothing, would be worse than no revocation at all, because it would stop the customer doing the one thing that works.** An unknown kind defaults to `unsupported`, never to silence. Revocation runs BEFORE the purge (it needs the rows the purge deletes) and OUTSIDE its transaction (network calls must not hold one open), and is **never** a reason to refuse an erasure — a provider being down records `failed` and the purge proceeds. This and T4b are two halves of one honest sentence: we revoked what we could, deleted our copy of the rest, and here is what only you can remove. **2026-09-20 — the everyday delete button revokes too.** `DELETE /api/connections/:id` deleted our copy and never called this helper, while the privacy text promised, for exactly that press, that the credential is *destroyed, and the grant revoked where the provider supports it*: a deleted Google connection left a live refresh token at Google that nobody held. The route now reads the row inside its tenant transaction, deletes, and revokes AFTER the delete has gone through (a refused delete must leave a working credential; a network call must not hold the transaction), answering 200 with the outcome (`revoked` / `failed` / `unsupported` / `no_credential`) where it answered 204 with nothing; the Connections page says it in the reader's language, the provider's reason verbatim after the frame. The per-row half of this helper is exported for it, so the two paths cannot drift. |
| T4b the grant only THEY can remove | ✅ **Built 2026-08-18**, **widened 2026-08-18** (owner's findings) | Revoking a token is not withdrawing a consent. `standing-grants.ts` names the four provider consoles bilingually, for the kinds a tenant actually used, keyed on BOTH vocabularies so the reminder cannot silently never fire. **Widened after the owner's second finding** — *"they just need to be reminded … and not leave credentials wandering around"*. The original list excluded password kinds on the reasoning that an IMAP connection has *"no consent object sitting in a console"*. **Half right, and the wrong half was load-bearing:** there is no consent object, but there is very often a **credential** object — an app password we deleted our copy of that still authenticates. Same risk, different screen. `CREDENTIAL_RETIREMENTS` now covers every password-shaped kind, with a coverage-lock test so a kind added to the schema without an entry fails rather than going silently unmentioned. Where we can name the screen (Nextcloud, Proton) we do; where we cannot — a generic IMAP or WebDAV account belongs to a provider we do not know — we name **what to look for** ("app password", "application-specific password"), because the customer knows who their provider is and that is the half they cannot supply. Saying nothing rather than something imprecise would leave a working credential in place. `accessThatOutlivesErasure()` merges both, **credentials first**: a consent is a permission sitting unused, a live app password is a working way in. Surfaced at CLOSE (the API response) and at FINISH (the completion report, now with a "Passwords that still work" section above "Permissions you granted"). A test that asserted an IMAP migration says nothing was **replaced, not widened** — its premise was the gap. |
| T5 backups are not covered by a DELETE | ✅ **Built 2026-08-18** (owner decision) | **Retention is 7 days** (owner, 2026-08-18), and the wording is the split the owner asked for: removed from the live service on the day the chosen window runs out, gone from backups a further 7 days after that. `packages/shared/src/erasure-timeline.ts` is the pure calculation plus the bilingual sentence; `BACKUP_RETENTION_DAYS` makes the number a deployment property, because a self-hoster with monthly tapes would otherwise promise something untrue on our authority. **The window is measured from the PURGE, not from the close** — a backup taken the hour before the purge is the last one that can contain anything and has its full retention still to run; dating it from the close would promise a date that arrives while the data is still restorable (mutation-verified: anchoring it to the close fails four tests). Migration 0026 records both the number and the derived date on `erasure_record`, because the retention can change and the date the customer was given cannot. A zero-retention deployment gets its own sentence rather than the same date twice. **What this does not claim:** that backups are scrubbed — nobody surgically edits a backup; they expire, and the wording says so. **2026-09-27 — the 7 days assume backups exist, and none do yet** ([0134](./0134-no-backups-during-the-alpha-said-truthfully.md) T1). Nothing in this repository backs up the managed application database, so a blank `BACKUP_RETENTION_DAYS` names backups the stack does not make. `ownpace-live`, the stack testers use, takes no backups during the alpha and sets `0` (0134 T0), so its close response says *"This deployment keeps no backups"*. The default stays 7, for the reason 0134 §3 gives. The API now warns about a blank value at start in production, and refuses to start with one when `OWNPACE_STAGE=alpha`. The 7 comes back when 0134 T5 builds the backups. |
| T6 what erasure must NEVER touch | ✅ **Built 2026-08-19** | `packages/shared/src/erasure-scope.ts` — the source and the target, bilingual, structured so each surface can place them. **The opener does the real work:** it names the ambiguity (*"delete my data" here means our data about you — not your own data*) instead of hoping the reader resolves it correctly, because two of the three readings a person can plausibly take are wrong and both wrong ones are frightening. The target entry is the longer of the two on purpose — that is the reading that costs something, so it says the copies **stay**, that closing does not reach into the new mailbox, and that what we erase is our RECORD of the move and not the copies themselves. Surfaced at **close** (the moment of decision) and on the **`DELETE` refusal** (the other way somebody tries to end the relationship). There is no close UI to put it in yet — 0086 T1 is that front door — so the API response is the surface that exists, and per the T4a gap below, close is the delivery point anyway: at purge time the tenant row is gone and there is nobody left to tell. Tests pin **meaning, not phrasing** — both sides present, the target explicitly not reached into, record distinguished from copies — because the failure to guard against is a rewrite that quietly drops one reassurance, not a typo. Five mutations, all caught. |
| T7 a purge that cannot be proven did not happen | ✅ **Built 2026-08-18** | An integration test that seeds a tenant across every one of the 25 cascading tables, purges, and asserts **table by table** what is gone and what remains. Not a count — a named list, for the same reason 0081's guard names each stray 500. Plus a receipt the customer can keep. |
| T8 mid-flight erasure is a duplication hazard | ✅ **Finished 2026-08-19** | `item` IS the idempotency ledger, so purging under a live pass re-copies everything **into the leaving customer's target**. The skip enforced that and nothing here weakens it. What was missing was the other direction: the skip was unconditional, so a row saying `running` after a worker was killed blocked the purge on every hourly attempt **for ever**, past the date T5 promised, with a warning nobody reads. **A row saying `running` is a claim by a process that may no longer exist**, so it is no longer taken at its word. `orchestratorRef` is now recorded (`ctx.run.id` — it was left unset as *"wire it when the v4 task model lands"*, and v4 is what we run), which makes the question answerable at all. `quiescePlan` decides from what the orchestrator says: **finished** rows are landed with the reason on the row and the purge proceeds; **live** ones are asked to stop and waited for; **anything we could not ask about blocks**. That last one is the asymmetry the whole design rests on — duplicating a leaving customer's mailbox is a data incident they experience, an erasure running late is a broken promise that is visible and recoverable, so *not knowing is not permission*, and it is reported as `needsAttention` rather than as ordinary waiting. Liveness is identified **positively in both directions** with anything unrecognised falling through to blocking, because reading `isCompleted` alone would be a guess and if it meant "succeeded" a failed run would block for ever — the exact bug being fixed. Close now asks in-flight passes to stop (active quiescing) but deliberately does **not** land their rows: a cancellation is a request, and landing a row while the pass is still mid-write is precisely the state that duplicates. Six mutations, including flipping the unknown verdict to allow purging, all caught. |
| T9 what "forget" means on self-host | ✅ **Decided and built 2026-08-19** (owner decision: option A) | Decided rather than inherited. **Three quarters of the managed flow does not transfer and building it anyway would be theatre:** the *window* exists so a mistaken click can be caught, and an operator with root needs no permission we could withhold; the *receipt* is evidence WE produce for a customer, and here the operator is both; *invoice retention* is a tax obligation on us as a processor, and theirs is theirs. **What does transfer is the whole reason this exists:** `docker compose down -v` destroys our copy of a credential and does nothing to the grant it authenticates with — a Google refresh token still mints tokens, a Nextcloud app password still logs in. So T9 is `forget-me` (`apps/selfhost/src/forget-me.ts`) plus `docs/selfhost-ending-the-service.md`, not a UI. **The ordering is the point and it is not recoverable:** revocation needs the credentials the wipe destroys, so the command REFUSES when there is nothing to read rather than printing a tidy zero — a reassuring summary is the one genuinely harmful thing to say at that moment. The refusal names each provider console, and allows for the other reading of "no tenants" (a wrong `DATABASE_URL` looks identical to an already-wiped appliance). `--dry-run` hands over `NO_REVOCATION` rather than trusting a boolean check downstream. |

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
