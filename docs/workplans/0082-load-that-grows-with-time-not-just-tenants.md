# Workplan 0082 — load that grows with time, not just tenants

## Status — 2026-08-18 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 the sync tick re-read every run ever made | ✅ **Fixed 2026-08-18** | Two correlated subqueries per active mapping, once a minute: `max(started_at)` and `EXISTS (… status = 'running')`. The baseline indexed `run` on `(mapping_id, created_at DESC)` and `(tenant_id, created_at DESC)` — **neither carries `status`, and a `created_at` index cannot answer `max(started_at)`**. Both subqueries read every matching row. Migration `0023` adds a partial index for the EXISTS, a `started_at DESC` index for the max, a partial index for the tick's own `status = 'active'` scan, and one for billing, which filtered `item.last_synced_at` with nothing covering it. Pinned by `EXPLAIN` against a real planner (PGlite), not by asserting the DDL exists — an index can exist and go unused when a predicate misses its leading columns, when a partial index's WHERE is narrower than the query's, or when a cast makes an expression non-sargable, and all three look like a correct migration. The fixture carries a month of run history and 500 inactive mappings rather than forcing the plan with `enable_seqscan = off`, which would pass whether or not the index were any good. Mutation-verified by deleting the migration: four of five fail, and the fifth — the one asserting the tick still returns the right answers — keeps passing, which is exactly right. |
| T2 nothing in the ledger was ever deleted | ✅ **Fixed 2026-08-18** | `run_event` is one row per log line of every pass, forever, and the UI shows the newest twenty runs with twenty-five events each. Pruned in bounded batches, committing between them, reporting when the ceiling stops it early. **Most of the change is about what survives**: `item` is never pruned because it IS the idempotency ledger — deleting a row does not reclaim space, it tells the next pass to copy that item again; `audit_log` is not pruned because §17 makes its retention a legal question, and that is named so the omission reads as a decision; `run` stays because it is the answer to *when did this last work*, and 0023 means the tick no longer reads it anyway. Both editions, one env parser — the appliance is the machine that can least afford an ever-growing table. |
| T3 the tick did everything one at a time | ✅ **Fixed 2026-08-18** | `enabledDomains` was called inside the loop (N+1) and the triggers were `await`ed one after another, on a **one-minute cron** — so tick wall time was due-mappings × round trip, and crossing sixty seconds means ticks overlap. One query now, enqueues bounded at 8. **A defect found while in there and not in the plan:** an enqueue failure escaped the whole tick, so one bad mapping stopped every mapping after it in the list, once a minute, with nothing in the log. Each enqueue now fails alone and is counted. Mappings that never chose a schedule also stopped firing together — the default cadence is wall-clock aligned, so all of them were due at :00/:15/:30/:45 across every tenant. `defaultScheduleFor` gives each a stable offset from its id; an explicit schedule is left exactly as written. |
| T4 no pooler in front of managed Postgres | ✅ **Built 2026-08-18** — ⚠️ **not started even once** | PgBouncer in transaction mode. The audit came first, because transaction mode breaks anything holding session state across transactions — and the answer was better than expected: **`withTenant` was already safe**, setting the role with `SET LOCAL` and the tenant with `set_config(…, true)`, both transaction-scoped. That is the one that mattered, since `app.current_tenant` IS the RLS boundary and a session-scoped version of it under transaction pooling would be a cross-tenant read. Nothing else on the Postgres path uses LISTEN/NOTIFY, temp tables, session `SET` or named prepared statements. **Migrations are the only exception**: they hold `pg_advisory_lock` across many transactions, so they connect direct via `DIRECT_DATABASE_URL`. That failure would be silent — both replicas read an empty `schema_migrations` and both start applying `0001`. ⚠️ This session has no Docker: the YAML and both shell scripts parse and the TypeScript half is tested, but the service has never been started. **The first `compose up` on the Spark is the verification**; `docs/deployment.md` carries the `SHOW POOLS` check and the one-line rollback (`DB_HOST=postgres`, `DB_PORT=5432`). |
| T5 the rate budget was one copy per pass | ✅ **Fixed 2026-08-18** | `ThrottleLimiter` keyed its buckets by `(tenant, provider)` from the start — the design was right, the buckets' **home** was wrong: a `Map` on an instance built per `buildDepsFromMapping` call. Trigger.dev runs every task run in its own process, so two passes for one tenant each held a private full-size bucket, and scaling the service multiplied the copies of the limit. The resource is singular: §13 specifies **one** multi-tenant Entra app, so every customer spends the same quota. `RateBudget` is now a port with an in-process implementation (correct on the appliance) and a Postgres one (migration `0024`). Postgres over Redis because the Redis in the stack is Trigger.dev's private datastore and §12 keeps the orchestrator at arm's length; the cost settles it, an acquire being ~1 ms against a Graph call of 100+. Mutation-verified: making the budget instance-local again fails six of seven tests. |

## What this is

The owner asked how to keep managed load under control. The advice named three
regimes; the third is the one that was not written down anywhere.

**The initial copy** is the throughput constraint (§21 says so).
**Tenant count** is the scaling axis (§21 says that too).
And then there is the one nobody had named: **the sync tick degraded with
elapsed time.** Not with tenants, not with mailboxes — a single happy customer
got slower every month, because a query re-read a history that only ever grew.
A year-old customer was slower than a new one for no reason the customer could
see, and no amount of load testing at t=0 would have found it.

That is why T1 is first and why it is the cheapest thing here: it is the only
item that fixes a problem that already exists rather than one that arrives with
growth.

## The generalisable bit

**Three of the five were designs that were right, implemented at the wrong
scope.** The throttle limiter keyed by `(tenant, provider)` — and kept the
buckets in a process that is created per pass. The tick's overlap safety was
correct per mapping — and its enumeration was serial across all of them. The
retention story was "the ledger is a rebuildable cache" — and nothing ever
rebuilt it.

None of those look wrong in the file you are reading. They look wrong only when
you ask *how many of these exist at once, and for how long*. Worth asking of
anything that holds state: **what is this scoped to, and is that the same thing
the resource it protects is scoped to?**

## What was measured, and what was not

Stated plainly because the advice this workplan came from was explicit about it:
**none of the original diagnosis was measured.** It was derived from reading DDL
and call sites, and the fixes are pinned by `EXPLAIN` and by mutation rather
than by a benchmark. Two fixture mistakes in T5 make the point — a rate limiter
tested at 1000 req/s refills its whole bucket while the test runs, so the first
version of that test measured the machine and reported it as a bug in the code.

What is still missing, and would turn every claim here from argued into shown:

- `pg_stat_statements` on the Spark;
- the tick logging its own duration;
- an integration-tier test for `PgRateBudget` under genuine multi-connection
  contention — PGlite is a single connection, so what the unit test pins is that
  the operation is one indivisible statement, not that the row lock holds.
