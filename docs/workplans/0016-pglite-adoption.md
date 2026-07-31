# Workplan 0016 — Adopting PGlite (the whole-workspace driver switch)

## Status — 2026-07-31 — CLOSED (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| P0 Reproduce the drizzle double-resolution failure | ✅ **Done — and it is NOT a real blocker** | Reproduced exactly (2 instances, `SQL<unknown>` errors), then found the cause: `pnpm add` relinks partially. A full `pnpm install` converges every importer, and a CLEAN `--frozen-lockfile` install yields **one** instance. See below. |
| P1 Resolve it | ✅ **Done — nothing to resolve** | No overrides, no `.npmrc` change, no atomic workspace change. `@electric-sql/pglite` is a normal dependency of `packages/ledger`. |
| P2 `pgliteDriver()` implementing `LedgerDriver` | ✅ **Done** | `packages/ledger/src/pglite-driver.ts`. Serialises `acquire()`, resets rather than destroys on a failed rollback, loads the `pgcrypto` contrib, re-asserts `row_security` per acquire. |
| P3 Run RLS against PGlite | ✅ **Done — RLS genuinely ENFORCES** | `pglite-driver.unit.test.ts`: the real 2580-line baseline applies unmodified; tenant A sees only A's row, B only B's, cross-tenant INSERT refused — all under `SET LOCAL ROLE app_user`. **Mutation-verified**: removing the role switch fails all three, because a superuser bypasses RLS. 11 tests, ~6 s, **no Docker**. |
| **P6 Wire the appliance to it** | ✅ **Done — but it was only HALF done until the e2e said so** | `SELFHOST_PERSISTENCE=pglite` — `apps/selfhost` starts, migrates itself and serves the operating surface with **no `DATABASE_URL`** (4 startup tests). **That was the reading half.** The SYNC half went on opening its own `pg.Pool` from `DATABASE_URL` inside `buildDeps`, so no pass ever touched the appliance's database — invisible on the container path (a second pool to the same server), fatal on PGlite (`getaddrinfo ENOTFOUND postgres`). Fixed by threading the appliance's handle through all four worker entry points; `buildDeps` now REFUSES to open its own pool when `SELFHOST_PERSISTENCE=pglite`. 5 wiring tests, mutation-verified. See "P6 — the half that was missing". |
| P4 Decide + document the two-backend testing story | ✅ **Done — and it found a real hole** | Two backends ship. Asking the question surfaced that **RLS was inert on BOTH of the appliance's paths**: it connects as the owner (container) or as `postgres` (PGlite), and Postgres exempts owners and superusers from row security — so 96 policies were created, granted, tested and bypassed, while every RLS test stayed green by opening its own `app_user` pool the appliance never uses. Fixed with `LedgerDriver.role` (`SET LOCAL ROLE` inside `withTenant`'s transaction), and now proved through the production wiring on both backends: `rls-in-force.unit.test.ts` (PGlite, no Docker) and `rls-in-force.integration.test.ts` (real Postgres, on a superuser connection). Mutation-verified. |
| **P7 e2e on both backends** | ✅ **Done — GREEN on PGlite AND Postgres, 35 tests each** | Two dispatches at the same `seed_count`, one per backend: Restart-Resume 9, Verification 14, Apply-Deletion 12. All four domains sync, survive `docker compose restart app` with zero duplicates, the planted unmigratable item is isolated and accepted, a source-side move is reported and closed, binary and non-ASCII fidelity holds byte-for-byte, and `apply` removes the target copy — verified against the real Stalwart/Nextcloud rather than the appliance's own answer — with no resurrection on the next pass. **It took four dispatches and found three real bugs**: `/data/state` was never created in the image so Docker seeded `appdata` root-owned (`EACCES`); the sync path was never on the seam at all (P6); and the gate's own concurrency check used a fixed bar against a corpus-dependent measure. None was findable without running this. *(Since closure the gate has grown to **41 per backend** — #189 added the finish gate and pointed every e2e at the shipped payload rather than the source tree, green on both backends; the UI smoke adds 5 more on top.)* |
| P5 Concurrency, measured | ✅ **Done — serialisation costs nothing measurable** | `scripts/bench-pglite-concurrency.mjs` (`pnpm bench:pglite`), real hot path through real `withTenant`. Flat 3.6–3.9 ms/item across widths 1→16; width 8 vs 1 across three runs: **+6.8%, −0.0%, −6.2%** — noise. **Two corrections to the T0 numbers below.** Still not a real mailbox. |

> **This workplan exists so T1 is not left half-done indefinitely.** Workplan
> 0015 T0 proved PGlite runs our real schema; 0015 T1 built the seam. Neither
> delivers anything to a user on its own — the appliance still requires a
> Postgres server. This is the piece that cashes that in, and it is *blocked*
> rather than *unscheduled*, which is a different thing and easy to lose track
> of.
>
> **Closed 2026-07-31.** The appliance runs on PGlite with no `DATABASE_URL`,
> no container, no port and no `initdb`, and the full 35-test e2e gate is green
> on that backend and on Postgres. What it does NOT say is that PGlite is the
> default: `deploy/selfhost/compose.yml` still ships the Postgres service and
> `SELFHOST_PERSISTENCE=pglite` is opt-in. Making it the default is a separate,
> deliberate decision — see workplan 0015, which is where the installer that
> wants it lives.
>
> **The lesson this plan cost most to learn**: every one of its three real bugs
> was an INTERSECTION nobody tested. The startup test ran the appliance without
> running a pass; the e2e ran passes but always with Postgres present; the
> packaging test ran the bundle but with a stub UI and no server. Each was a
> good test. What shipped broken was the case none of them covered. When a
> claim spans two axes, test the corner.

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

## P0/P1 — the blocker was not what it looked like

**Resolved, and it never needed a workaround.** Recorded in full because the
wrong conclusion was load-bearing: it is what made adoption look like a
whole-workspace change and parked this plan.

What the T0 spike observed was real. Installing `@electric-sql/pglite`
*does* produce two `drizzle-orm` instances, and the workspace *does* then fail
to typecheck with `SQL<unknown>` mismatches — reproduced here exactly.

What it is not is a resolution conflict. `pnpm add` relinks incrementally: it
gave `packages/ledger` and the root the new pglite-flavoured instance and left
`apps/worker` pointing at the old one, so two importers disagreed about which
drizzle they meant. The lockfile was already consistent. A plain `pnpm install`
converges every importer, and a **clean** `--frozen-lockfile` install — which
is what CI and any new checkout does — produces exactly **one** instance:

```
node_modules/.pnpm: 1x drizzle-orm@0.45.2(@electric-sql/pglite@0.5.4)(...)
.               -> drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_...
packages/ledger -> drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_...
apps/worker     -> drizzle-orm@0.45.2_@electric-sql+pglite@0.5.4_...
```

So: no `pnpm.overrides`, no `.npmrc` dedupe, no atomic whole-workspace commit.
`@electric-sql/pglite` is an ordinary dependency of `packages/ledger`.

**The lesson worth keeping**: a mid-session `pnpm add` leaves the tree in a
state no fresh install reproduces. Re-run `pnpm install` before concluding a
dependency is incompatible.

## P2 — `pgliteDriver()` — done

`packages/ledger/src/pglite-driver.ts`. Four things it must do, each a finding:

- **`acquire()` serialises.** PGlite has one connection; two concurrent
  `withTenant` calls on it would produce `BEGIN` inside `BEGIN`, one `COMMIT`
  ending both, and `app.current_tenant` set by one tenant while another is
  mid-query. Cross-tenant exposure from concurrency alone, with every policy
  still correct.
- **`release(err)` resets rather than destroys**, because there is no second
  connection to switch to. `ROLLBACK; RESET ROLE;` and clear the tenant.
- **`row_security` is re-asserted on EVERY acquire — and the reason is not what
  0015 T0 recorded.** That spike concluded PGlite defaults the setting *off*
  where a server defaults it *on*. Measured here, a fresh PGlite 0.5.4 reports
  **`on`**. What turns it off is **our own migration**: `0001_baseline.sql` is a
  `pg_dump`, and line 43 of its preamble is `SET row_security = off;`.

  Harmless on a pool — session-scoped, dies with the client that migrated. On a
  single persistent connection the appliance migrates at startup and then serves
  every request on that same session, so one line of dump preamble would disable
  row security for the life of the process. Setting it once at open is not
  enough, because migrations run after that.

  **This is not a PGlite quirk.** Any driver reusing one long-lived connection
  across migrate-then-serve inherits it.
- **`pgcrypto` via the contrib import.** The baseline stays byte-identical to
  what real Postgres gets, so the squash equivalence proof stays valid.

A fifth thing the seam was missing, found only by running the real chain through
the real driver: **`LedgerConnection.exec()`**. Postgres has two wire protocols
and `query()` with parameters uses the EXTENDED one, which accepts a single
statement — a migration file full of them fails with *"cannot insert multiple
commands into a prepared statement"*. `pg` hides this by dropping to the simple
protocol when there are no parameters; PGlite exposes the two separately. The
seam now has both, and `applyOne` uses `exec` for the migration body.

## P3 — done, and it enforces

`pglite-driver.unit.test.ts`, 11 tests, ~6 s, **no Docker and no container**:

- the real 2580-line `0001_baseline.sql` applies unmodified — 26+ tables, 90+
  policies, `app_user`, `pgcrypto`, `gen_random_uuid()`;
- migrations are idempotent on a second run;
- **RLS enforces**: tenant A sees only A's row, B only B's, and a cross-tenant
  INSERT is refused — each under `SET LOCAL ROLE app_user`;
- the single connection serialises, and recovers from a failed transaction.

**Mutation-verified**: deleting the `SET LOCAL ROLE app_user` line fails all
three RLS tests, because PGlite runs as a superuser and superusers bypass RLS
unconditionally. Without that line the suite would pass against a database that
leaks every tenant's rows — which is exactly why "96 policies created" was never
the claim worth testing.

Worth noting for P4: this suite lives in the **unit** project. RLS enforcement
previously could not be tested without a Postgres container.

## P6 — the half that was missing

**Recorded in full because the wrong conclusion shipped in this file's own
status block, and shipped confidently.**

P6 read "Done — the appliance starts, migrates itself and serves the operating
surface with no `DATABASE_URL`". Every word of that is true. Every word of it is
about the half of the appliance that **reads**.

The half that **copies** was never on the seam:

```ts
// apps/worker/src/build-deps.ts — called once per pass, per domain
const databaseUrl = process.env.DATABASE_URL;
const db = createPgDb(databaseUrl, LEDGER_POOL_MAX);
const ledger  = new PgLedger(db);
const cursors = new PgCursorStore(db);
```

That is correct for the managed worker — stateless, a pass is a job, the pool
dies with it. On the appliance it means every pass opened its **own** pool,
never touching the database the appliance had migrated and was serving.

On the container path that was invisible: a second pool to the same Postgres.
Wasteful, and it worked. On PGlite there is no server to open a pool *to* —
it runs in-process and has no address — so `DATABASE_URL` still pointed at the
`postgres` service the override had disabled, and the first ledger query of
every domain died:

```
[Worker] email sync failed: Failed query: select "cursor_value" from "cursor" …
  cause: getaddrinfo ENOTFOUND postgres
```

All four domains, every pass, deterministically. The gate then waited its full
300 s for a completed pass that was never coming, which is why it looked like a
timeout.

### Why nothing caught it

- `pglite-startup.unit.test.ts` starts a real appliance on PGlite — and never
  runs a pass. It tests the HTTP surface.
- The e2e runs real passes — and always had a Postgres container, which the
  second pool connected to happily.

Neither test was wrong. Between them they covered every line and left the
intersection — *a pass, without Postgres present* — uncovered. That
intersection is the entire claim of this workplan.

### The fix

An optional `LedgerOptions { ledgerDb }` threaded through the four worker entry
points the appliance calls — `runAllDomains`, `discoverAllDomains`,
`verifyMapping`, `applyMappingDeletion` — into `buildDeps`/`buildDomainDeps`
and `createLedgerVerificationReader`. Managed passes nothing and is unchanged.

Three details that are not incidental:

- **An injected handle is never closed.** `withClose()` gets a no-op. The
  appliance has one database and hands the same handle to every pass; closing it
  afterwards would take the appliance down, and on PGlite there is no pool to
  reopen.
- **`buildDeps` REFUSES to fall back when `SELFHOST_PERSISTENCE=pglite`.** This
  is the part that makes the bug unrepeatable. `DATABASE_URL` is still set on
  that path — compose merges maps key by key, so an override cannot remove what
  the base file declares — so a fallback does not fail, it *succeeds against the
  wrong database*. We were lucky the host had gone away.
- **Tested as wiring, not as syncing.** `ledger-injection.unit.test.ts` asserts
  the handle passed in is the handle used, and that it is not closed. No
  connectors, no network, no database: the defect was plumbing, so plumbing is
  what is inspected. Mutation-verified — ignoring the injected handle fails 3 of
  the 5.

### The lesson worth keeping

"The appliance runs on PGlite" was asserted from the startup path and believed.
The question that would have caught it is not *"does it start?"* but **"which
database does the work land in?"** — and the only thing that could answer it was
running a real pass with the server genuinely absent.


## P4 — two backends, and the hole that asking about them found

Managed stays on server Postgres (PGlite is single-connection and
single-process — wrong for a multi-tenant API with a worker fleet), so **two
persistence backends ship**. Answering "must the RLS tests run against both?"
turned up something more serious than the question assumed.

### The finding: RLS was inert on BOTH of the appliance's backends

Not "untested on one backend". **Not in force on either.**

Postgres exempts two kinds of user from row security: a **superuser**, always
and unconditionally, and a table's **owner**, unless the table is `FORCE`d. The
appliance connects as the database owner on the container path
(`DATABASE_URL: postgresql://${POSTGRES_USER}...`) and as `postgres` on the
PGlite path. So every one of the 96 policies in `0001_baseline.sql` was created,
granted, tested — and skipped, on the shipped product, on both paths.

Measured, not deduced. Through the appliance's own wiring, seeding one
connection row for each of two tenants and then asking as tenant A:

```
current_user  : postgres
is superuser  : true
As tenant A, the appliance sees 2 connection row(s)
=> RLS IS INERT: tenant A can read tenant B
```

**And every existing RLS test passed throughout**, because each one opens its
own `pg.Pool` as `app_user` — a connection the appliance never makes. That is
the P4 hazard in its sharpest form: not "asserted against a database nobody
ships", but *asserted against a role nobody serves as*. `pglite-driver.unit.test.ts`
had the same shape — it proves enforcement by issuing `SET LOCAL ROLE app_user`
in the test body.

### The fix: `LedgerDriver.role`

`withTenant()` issues `SET LOCAL ROLE "<role>"` inside the transaction it
already opens, when the driver was given one. `pgDriver(pool, { role })` and
`pgliteDriver({ role })`; the appliance passes `app_user` on both paths.

- **`SET LOCAL`, not `SET`** — it has to revert at COMMIT/ROLLBACK. The
  migration chain creates the roles and the policies and must keep running as
  the owner; and on PGlite there is exactly one connection, so a role that
  leaked past a transaction would be the role the next startup migrated as.
- **The role is validated at construction and refused rather than escaped.**
  `SET ROLE` takes an identifier, and identifiers cannot be bound, so it is the
  one value that reaches SQL by concatenation.
- **Undefined by default, so managed is untouched** — it takes its role from
  the connection string it is deployed with.
- **No escape hatch.** `app_user` is created by our own baseline. If it has been
  dropped, `SET LOCAL ROLE` fails loudly, which beats serving with isolation
  silently off (hard rule 9).

### And the answer to the question P4 actually asked

Both backends, tested through the production wiring rather than beside it:

| | where | what it proves |
|---|---|---|
| `rls-in-force.unit.test.ts` | unit, PGlite, **no Docker** | the served path enforces; the role is `app_user` and not a superuser; a foreign-tenant write is refused AND not written; the role is given back at COMMIT |
| `rls-in-force.integration.test.ts` | integration, real Postgres | the same, over `pgDriver`, on a **superuser** connection — plus a test that *without* a role that connection still sees everything, so the isolation above is attributable to the switch |

Mutation-verified: removing the `SET LOCAL ROLE` line fails 3 of the 6 unit
tests, including "shows a tenant only its own rows".

The asymmetry noted originally still holds — self-host is single-tenant, so
this is defence in depth rather than the live boundary, and no shipped
deployment leaked anything. It is an argument for proportionate coverage, which
is what the table above is.

### The two backends, measured against each other

P4 asked whether a guarantee proved on one backend may be assumed on the other.
It now has an answer that is not a judgement call: **both backends ran the same
35-test gate at the same seed size, and agree domain-for-domain.**

Per-item concurrency, as a fraction of what the corpus can reach at width 4:

| domain | items | Postgres | PGlite |
|---|---:|---:|---:|
| email | 60 | 0.89 | 0.94 |
| calendar | 61 | 0.91 | 0.93 |
| contact | 61 | 0.91 | 0.87 |
| file | 245 | 0.96 | 0.96 |

So the role switch this task added, and the shared ledger handle P6 added, cost
nothing measurable on the server path — the thing hard rule 5 actually asks.

That is also the honest scope of the claim. It says the two backends behave the
same **on this corpus**: 60 messages, 61 calendar objects, 61 contacts, 245
files. It does not say they behave the same on a 48k mailbox, and
[P5](#p5--concurrency-measured) is an extrapolation, not a measurement.

### Left open at closure — since closed

**Two tables had `ENABLE ROW LEVEL SECURITY` without `FORCE`** — closed by
`0002_force_row_security_stragglers.sql`, once the deferral's precondition was
checked and found already met: managed serves as `app_user` via
`APP_DATABASE_URL` (its owner URL is migrations/seed only), so FORCE — which
only binds *owners* — changes nothing for any session either edition actually
serves with. `force-rls.unit.test.ts` asks the catalogs that no RLS table
exempts its owner (so the next forgotten FORCE fails by name), and proves
enforcement on the one shape where FORCE is observable at all: a NON-superuser
owner, manufactured by handing `app_user` ownership in a throwaway PGlite
database — every rig's own owner is a superuser, whom FORCE cannot bind by
design. Mutation-verified: removing the migration fails both.

## P5 — concurrency, measured

`pnpm bench:pglite` (`scripts/bench-pglite-concurrency.mjs`). It runs the REAL
ledger hot path — `find()` by natural key, then `recordIfAbsent()` — inside the
REAL `withTenant`, against the REAL schema. That pair is what `runShadowPass`
does per item and is the only database work in the loop.

Fresh in-memory database per width, 1500–2500 items each:

| width | first pass / item | items/s | re-run / item | items/s |
|---|---|---|---|---|
| 1 | 3.61–3.76 ms | 266–277 | 2.47–2.52 ms | 397–405 |
| 4 | 3.69 ms | 271 | 2.60 ms | 385 |
| 8 | 3.51–3.86 ms | 259–285 | 2.44–2.70 ms | 370–411 |
| 16 | 3.80 ms | 263 | 2.55 ms | 392 |

**Serialisation costs nothing measurable.** Width 8 against width 1, three runs:
`+6.8%`, `−0.0%`, `−6.2%`. The answer is zero within run-to-run noise, and there
is no cliff at 16 either. The sync path can keep `DEFAULT_CONCURRENCY` 8 on
PGlite without thinking about it.

### Two corrections to the T0 spike's numbers

Both matter because someone will otherwise plan against them.

1. **~1700 rows/s is not the throughput of this system.** That figure came from
   5,000 synthetic single-statement inserts. The real hot path is two statements
   per item, both through drizzle, both inside a transaction that sets
   `app.current_tenant` — and it runs at **~270 items/s**, six times slower.
2. **"Not the bottleneck by orders of magnitude" overstates it.** A 48k-message
   mailbox is ~170–185 s of ledger time against ~40 min of network at a
   conservative 50 ms/message fetch. That is ~13×, i.e. **one** order of
   magnitude, and the ledger is ~7% of wall clock. Comfortably not the
   bottleneck; not free either.

### A methodological note, because it changed the answer

The first version of this script reused one database across all widths, so each
width queried a table the previous widths had grown. It reported concurrency
costing **+29%** — almost all of which was table growth. A fresh database per
width costs ~4 s of migration each and is the difference between measuring the
flag and measuring something else.

### What this still does not tell you

A real mailbox has variable item sizes, cold caches, and a source that pushes
back. This bounds the ledger's contribution; it does not predict a migration.
The remaining unknown is whether a real corpus changes the SHAPE — and the
honest way to find out is to run one, not to extrapolate this.
