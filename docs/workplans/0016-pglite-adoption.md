# Workplan 0016 — Adopting PGlite (the whole-workspace driver switch)

## Status — 2026-07-30 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| P0 Reproduce the drizzle double-resolution failure | ⬜ Not started | The blocker. Must be understood before anything else is attempted. |
| P1 Resolve it (pin/alias/override, or accept the workspace churn) | ⬜ Not started | Blocks everything below. |
| P2 `pgliteDriver()` implementing `LedgerDriver` | ⬜ Not started | The seam already exists — see below. |
| P3 Run the RLS integration suite against PGlite | ⬜ Not started | The point of the whole exercise. |
| P4 Decide + document the two-backend testing story | ⬜ Not started | Open question 1 in [0015](./0015-native-windows-installer.md). |
| P5 Re-measure concurrency against a real corpus | ⬜ Not started | Open question 2 in [0015](./0015-native-windows-installer.md). |

> **This workplan exists so T1 is not left half-done indefinitely.** Workplan
> 0015 T0 proved PGlite runs our real schema; 0015 T1 built the seam. Neither
> delivers anything to a user on its own — the appliance still requires a
> Postgres server. This is the piece that cashes that in, and it is *blocked*
> rather than *unscheduled*, which is a different thing and easy to lose track
> of.

## What is already done (do not redo)

- **[0015 T0](./0015-native-windows-installer.md) — the feasibility spike, PASS 15/15.**
  `scripts/spike-pglite-windows.mjs` applies the REAL 2580-line
  `0001_baseline.sql` unmodified: 26 tables, 96 RLS policies, the `app_user`
  role, `gen_random_uuid()`, `pg_advisory_lock`, transaction-local
  `set_config` — and **RLS genuinely enforcing** as `app_user`, not merely
  created. ~1700 rows/s, 3 ms indexed lookups, survives restart.
- **0015 T1 — the connection seam.** `packages/ledger/src/driver.ts` defines
  `LedgerDriver`/`LedgerConnection`; `pgDriver(pool)` implements it; both
  entry points go through it — `withTenant()` (the query path) and
  `runMigrations()` (the startup path, which now accepts a driver INSTEAD of a
  connection string, because PGlite is a file and has none).
- **The single-connection hazard is already tested**, against a fake driver
  with PGlite's constraint (`driver.unit.test.ts`), including a
  mutation-verified check that two tenants never overlap on one connection.

So P2 is genuinely small: implement two methods. Everything hard is either
already done or is P1.

## P0/P1 — the blocker, stated precisely

Installing `@electric-sql/pglite` into the workspace makes pnpm resolve a
**second copy of `drizzle-orm`**. Drizzle declares pglite as an *optional peer
dependency*, so adding it changes drizzle's store key; the workspace then ends
up with two drizzle instances, and typechecks two structurally-identical but
nominally-distinct `SQL<unknown>` types against each other. It fails outright —
this is a build break, not a warning.

Discovered during the T0 spike, which is why that script resolves PGlite from an
explicit `PGLITE_DIR` via `pnpm dlx` rather than depending on it.

Things to try, cheapest first:

1. **`pnpm.overrides` / `resolutions`** pinning `drizzle-orm` to one version for
   the whole workspace. Most likely to just work.
2. **`dedupe-peer-dependents`** / `public-hoist-pattern` in `.npmrc`, so the two
   resolutions collapse.
3. **Accept the churn**: make the switch atomic across every package in one
   commit, which is what the T0 note assumed. Least attractive — a whole-workspace
   change that cannot be bisected is a bad shape for a change that touches the
   RLS gate.

Whatever works, **record WHY in this file**, because the next person to add a
package with an optional peer on drizzle will hit the same wall.

## P2 — `pgliteDriver()`

Two methods, and one of them is the whole safety argument:

- **`acquire()` MUST serialise.** PGlite has exactly one connection. Two
  concurrent `withTenant` calls on it produce `BEGIN` inside `BEGIN`, one
  `COMMIT` ending both, and `app.current_tenant` set by one tenant while another
  is mid-query — cross-tenant exposure caused by concurrency alone, with every
  RLS policy still correctly written. The seam already permits `acquire()` to
  wait; the driver has to actually do it.
- **`release(err)` cannot destroy the connection**, because there is only one.
  Where `pg` discards a client whose ROLLBACK failed, this driver must *reset*
  it — at minimum re-issuing `ROLLBACK` and clearing `app.current_tenant`, and
  failing loudly if it cannot. A connection left in an aborted transaction still
  carrying a tenant id is the exact state the pool path refuses to reuse.
- **`row_security` must be set explicitly on every session** (0015 T0, finding
  1). PGlite defaults it *off* where a real server defaults it *on*. Off, a
  query that would be filtered *errors* rather than silently returning every
  tenant's rows — loud, which is the right direction to be wrong in — but it
  must be set and **asserted in a test**, because "fixing" that error by
  disabling RLS would be catastrophic and silent.
- **`pgcrypto` needs the contrib import** (`@electric-sql/pglite/contrib/pgcrypto`)
  or `CREATE EXTENSION pgcrypto` fails. Nothing in the schema calls a pgcrypto
  function — it is a `pg_dump` artefact — so load the contrib rather than editing
  the baseline, keeping it byte-identical to what real Postgres gets so the
  squash equivalence proof stays valid.

## P3 — the test that matters

Run the existing RLS integration suite against PGlite. "96 policies created" is
not the same claim as "96 policies doing anything": Postgres bypasses RLS for
superusers and owners, and an in-process WASM database runs as exactly that.
The spike tested enforcement specifically, under `SET ROLE app_user`, and the
integration suite must do the same or it proves nothing.

## P4 — two backends, or one?

If managed stays on server Postgres (almost certainly — PGlite is
single-connection and single-process, wrong for a multi-tenant API with a worker
fleet), then **two persistence backends ship**, and the RLS integration tests
have to run against both. Otherwise self-host's tenant isolation is asserted
against a database nobody ships.

Note the asymmetry that makes this less alarming than it sounds: self-host is
**single-tenant**, so its RLS is defence in depth rather than the primary
boundary. That is an argument for proportionate coverage, not for skipping it.

## P5 — concurrency, measured

The sync path runs at `DEFAULT_CONCURRENCY` 8; PGlite serialises DB access. The
T0 numbers say the ledger is not the bottleneck by orders of magnitude, but they
came from 5,000 synthetic inserts, not a real corpus.

Measure against a real mailbox before relying on it. And keep the failure shape
in mind when tuning: **serialising fails slow, not serialising fails
cross-tenant**, so serialise first and measure second.

## What would make this not worth doing

Worth stating so it can be checked rather than assumed:

- If P1 has no answer short of vendoring drizzle or forking it, stop. The
  bundled-Postgres path (ADR-0023 as it stands) keeps working and is merely
  heavier.
- If P3 shows RLS cannot be enforced under PGlite the way it is on a server,
  stop — and reopen ADR-0023, because that would be a real difference in the
  security model between editions rather than a packaging detail.
- If P5 shows serialisation actually is the bottleneck on a real corpus, the
  answer is probably still PGlite for the single-user appliance, but the
  managed/self-host split then has to be stated explicitly rather than assumed.
