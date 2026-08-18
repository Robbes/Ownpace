# Workplan 0085 — ending the service, and meaning it

## Status — 2026-08-18 (update this block at the end of every session)

**Nothing here is built.** This is a plan, written 2026-08-18 at the owner's
request, with four decisions already taken (recorded below).

| Task | Status | Notes |
|---|---|---|
| T1 the delete that already exists is dangerous | ⬜ **Planned** — ⚠️ **live today** | `DELETE /api/tenants/:tenantId` exists now (`routes/tenants/index.ts`), is owner-only, and does a hard `DELETE FROM tenant` that **cascades twenty-five tables** — `invoice` and `audit_log` among them. No confirmation, no grace, no receipt, no revocation, and nothing that says it happened. **This is the most urgent row in the workplan and it is a removal, not an addition:** the current endpoint should refuse before the staged flow replaces it, rather than sitting there as an unguarded one-call purge of a customer's billing history. |
| T2 close → grace → purge, customer picks the window | ⬜ **Planned** (owner decision) | Closing stops syncs and billing **immediately** and the account goes read-only. The purge runs after a window the customer chooses at close time: **immediate, 7, 30 or 90 days**. Four windows means four states to test, and `immediate` is the one that needs the type-the-name confirmation — it has no window in which to catch a mistake or a bug. |
| T3 what survives: invoices, detached, plus an erasure record | ⬜ **Planned** (owner decision) | Invoices and payment records survive **detached from the tenant** — company name, VAT id, amount, date; nothing about what was migrated. This is the GDPR art. 17(3)(b) carve-out: Dutch tax law wants invoices for years, and "erase everything" would put the operator in breach of a different law than the one they were trying to obey. Needs a schema change — the `ON DELETE CASCADE` from `invoice` to `tenant` is exactly what must not fire. |
| T4 a credential that is forgotten but still works is not forgotten | ⬜ **Planned** | Deleting a row containing a refresh token leaves a **live token** at Google, Microsoft, Dropbox or Box. Erasure must attempt provider-side **revocation** and record the outcome per connection — including when revocation fails, because the honest sentence is *"we deleted our copy and could not revoke it; here is how you revoke it yourself"*, not silence. |
| T5 backups are not covered by a DELETE | ⬜ **Planned** | A row deleted from the live database is still in last night's backup. Erasure is therefore **not complete at purge time**; it completes when the backup retention window rolls over. That window has to be stated to the customer as a number, and the number has to be true. Nobody has written it down yet. |
| T6 what erasure must NEVER touch | ⬜ **Planned** | **The source: nothing, ever** (hard rule 2). **The target: nothing, ever** — the migrated mail is the customer's, in the customer's own system; we forget our record of it, we do not reach into their new mailbox. This deserves saying loudly in the UI, because "delete my data" is exactly the phrase a person could reasonably expect to mean the opposite. |
| T7 a purge that cannot be proven did not happen | ⬜ **Planned** | An integration test that seeds a tenant across every one of the 25 cascading tables, purges, and asserts **table by table** what is gone and what remains. Not a count — a named list, for the same reason 0081's guard names each stray 500. Plus a receipt the customer can keep. |
| T8 mid-flight erasure is a duplication hazard | ⬜ **Planned** | `item` IS the idempotency ledger. Purging it while a mapping still runs tells the next pass to copy everything again — **into the customer's target**, duplicating the mail of somebody who just asked to leave. Close must stop and quiesce every pass before purge is allowed to start. |
| T9 what "forget" means on self-host | ⬜ **Planned** | Hard rule 5 says the editions must not differ, but here they genuinely do: on the appliance the operator owns the disk, and erasure is `docker compose down -v`. The honest answer is probably a documented procedure plus the same revocation helper, not a UI. **Decide it rather than inherit it.** |

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

## What is NOT in scope here

- **Per-user erasure inside a tenant.** This is tenant-level offboarding. An
  individual member asking to be forgotten while the tenant continues is a
  different and harder problem.
- **Erasure at the target.** Never ours to do (T6).
- **Automatic erasure on non-payment.** Ending the service for non-payment is a
  commercial policy that does not exist yet, and wiring it to a purge before
  the policy exists would be the worst possible order to build it in.
